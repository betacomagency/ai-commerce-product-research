import { emptyProductKnowledge } from '../domain/defaults.js'
import { z } from 'zod'
import {
  UNKNOWN,
  fieldEvidenceSchema,
  missingInformationSchema,
  productKnowledgeSchema,
  type FetchedSource,
  type InputAnalysis,
  type ProductInput,
  type ProductKnowledge,
  type ProductSource,
} from '../domain/schema.js'
import type { LlmProvider } from '../providers/llm.js'
import { withRetry } from '../infrastructure/retry.js'

const PRODUCT_KNOWLEDGE_JSON_SCHEMA = z.toJSONSchema(productKnowledgeSchema) as Record<string, unknown>
delete PRODUCT_KNOWLEDGE_JSON_SCHEMA.$schema

export async function buildProductKnowledge(options: {
  input: ProductInput
  analysis: InputAnalysis
  sources: FetchedSource[]
  llm: LlmProvider | null
  retryAttempts?: number
  signal?: AbortSignal
}): Promise<ProductKnowledge> {
  const { input, analysis, sources, llm, signal } = options
  const sourceRecords = sources.map(toProductSource)

  if (llm && sources.length > 0) {
    try {
      const candidate = await withRetry(
        () => llm.generateJson<unknown>(SYSTEM_PROMPT, buildSynthesisPrompt(input, analysis, sources), signal, PRODUCT_KNOWLEDGE_JSON_SCHEMA),
        { attempts: options.retryAttempts ?? 3, baseDelayMs: 700 },
      )
      const normalized = normalizeModelKnowledge(candidate, sourceRecords)
      return finalizeKnowledge(enforceEvidenceRules(normalized, input, sourceRecords))
    } catch (error) {
      const fallback = buildConservativeKnowledge(input, analysis, sourceRecords)
      fallback.warnings.push(`LLM synthesis không dùng được; đã chuyển sang fallback an toàn: ${error instanceof Error ? error.message : 'Unknown error'}`)
      return finalizeKnowledge(fallback)
    }
  }

  return finalizeKnowledge(buildConservativeKnowledge(input, analysis, sourceRecords))
}

function normalizeModelKnowledge(candidate: unknown, sourceRecords: ProductSource[]): ProductKnowledge {
  const base = emptyProductKnowledge()
  const raw = isRecord(candidate) ? candidate : {}
  const identity = isRecord(raw.product_identity) ? raw.product_identity : {}
  const specifications = isRecord(raw.specifications) ? raw.specifications : {}
  const category = isRecord(raw.category) ? raw.category : {}
  const marketing = isRecord(raw.marketing) ? raw.marketing : {}
  const pricing = isRecord(raw.pricing) ? raw.pricing : {}
  const confidence = isRecord(raw.confidence) ? raw.confidence : {}
  const evidence = Array.isArray(raw.evidence)
    ? raw.evidence.flatMap(item => {
      const parsed = fieldEvidenceSchema.safeParse(item)
      return parsed.success ? [parsed.data] : []
    })
    : []
  const missing = Array.isArray(raw.missing_information)
    ? raw.missing_information.flatMap(item => {
      const parsed = missingInformationSchema.safeParse(item)
      return parsed.success ? [parsed.data] : []
    })
    : []

  return productKnowledgeSchema.parse({
    ...base,
    ...raw,
    schema_version: '1.0',
    researched_at: new Date().toISOString(),
    language: typeof raw.language === 'string' ? raw.language : 'vi',
    product_identity: { ...base.product_identity, ...identity },
    specifications: { ...base.specifications, ...specifications },
    category: { ...base.category, ...category },
    marketing: { ...base.marketing, ...marketing },
    pricing: { ...base.pricing, ...pricing },
    sources: sourceRecords,
    evidence,
    missing_information: missing,
    conflicts: Array.isArray(raw.conflicts) ? raw.conflicts : [],
    confidence: { ...base.confidence, ...confidence },
    readiness: base.readiness,
    warnings: Array.isArray(raw.warnings) ? raw.warnings.filter(value => typeof value === 'string') : [],
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const SYSTEM_PROMPT = `You build a durable Product Knowledge record from user input and retrieved sources.
Return one JSON object matching the exact schema demonstrated by the requested keys.
Hard rules:
- Never invent a product fact. Use the exact string "Unknown" when not verifiable.
- A user statement is user_provided, not verified unless a source supports it.
- A verified fact must cite one or more source_ids. Prefer two independent sources, or one official source.
- Marketplace listings without official indicators are weak evidence.
- Keep conflicts instead of silently selecting a value.
- Marketing fields are only potential hypotheses and evidence status must be inferred.
- Source IDs may only be selected from the supplied source list.
- Overall confidence must reflect coverage and source quality, not writing fluency.
- Prefer explicit text read from the product image for brand/model/type over heuristic parsing of a listing title.
- Do not combine specifications from another model or variant into the target model.
- Extract current visible selling prices only when the exact target model/variant and source are clear. Store numeric amounts in pricing.observed_offers with the matching source_id. Do not treat crossed-out prices, coupons, installment amounts, or ambiguous variant ranges as a product price.
- Pricing is market observation, not a guaranteed selling-price recommendation.
- readiness is a server-controlled field; copy the template value and do not decide downstream eligibility.
- Output JSON only.`

function buildSynthesisPrompt(input: ProductInput, analysis: InputAnalysis, sources: FetchedSource[]): string {
  const compactSources = sources.map(source => ({
    source_id: source.sourceId,
    title: source.title,
    url: source.url,
    source_type: source.sourceType,
    reliability_score: source.reliabilityScore,
    snippet: source.snippet,
    content: source.content,
  }))
  const template = emptyProductKnowledge()
  return JSON.stringify({
    task: 'Synthesize Product Knowledge in Vietnamese when the source is Vietnamese; retain original model/spec terms.',
    user_input: {
      product_name: input.productName,
      additional_info: input.additionalInfo,
      image_observations: analysis.imageObservations,
    },
    parsed_input: analysis,
    allowed_sources: compactSources,
    required_output_template: template,
  })
}

function buildConservativeKnowledge(input: ProductInput, analysis: InputAnalysis, sources: ProductSource[]): ProductKnowledge {
  const result = emptyProductKnowledge()
  result.sources = sources
  result.product_identity.product_name = analysis.normalizedName || input.productName
  result.product_identity.brand = analysis.likelyBrand
  result.product_identity.model = analysis.likelyModel
  result.product_identity.product_type = analysis.likelyProductType

  const inputText = input.additionalInfo
  const colors = extractUserList(inputText, /(?:màu|color)\s*[:\-]?\s*([^\n,;.]+)/gi)
  if (colors.length > 0) result.specifications.color = colors

  addInputEvidence(result, 'product_identity.product_name', result.product_identity.product_name, Boolean(input.productName))
  addInferredEvidence(result, 'product_identity.brand', result.product_identity.brand)
  addInferredEvidence(result, 'product_identity.model', result.product_identity.model)
  addInferredEvidence(result, 'product_identity.product_type', result.product_identity.product_type)
  if (colors.length > 0) addInputEvidence(result, 'specifications.color', colors.join(', '), true)

  const verifiedFieldCount = verifyIdentityFromSources(result, sources)

  const unknownFields = [
    ['specifications.material', result.specifications.material, 'Chưa có nguồn đủ tin cậy xác nhận chất liệu.', 'high'],
    ['specifications.dimensions', result.specifications.dimensions, 'Chưa tìm thấy kích thước được xác minh.', 'medium'],
    ['specifications.weight', result.specifications.weight, 'Chưa tìm thấy khối lượng được xác minh.', 'medium'],
    ['category.general_category', result.category.general_category, 'Cần model hoặc nguồn xác nhận ngành hàng.', 'medium'],
    ['category.sub_category', result.category.sub_category, 'Cần model hoặc nguồn xác nhận ngành hàng chi tiết.', 'low'],
  ] as const
  for (const [fieldPath, value, reason, priority] of unknownFields) {
    if (value === UNKNOWN) {
      result.missing_information.push({ field_path: fieldPath, reason, priority })
      result.evidence.push({ field_path: fieldPath, value_summary: UNKNOWN, source_ids: [], confidence: 0, status: 'unknown', note: reason })
    }
  }
  if (result.product_identity.brand === UNKNOWN) result.missing_information.unshift({ field_path: 'product_identity.brand', reason: 'Không xác định được thương hiệu.', priority: 'high' })
  if (result.product_identity.product_name === UNKNOWN) result.missing_information.unshift({ field_path: 'product_identity.product_name', reason: 'Không xác định được sản phẩm từ input/ảnh.', priority: 'high' })

  recalculateConfidence(result)
  result.warnings.push('Đang dùng synthesis fallback thận trọng. Thêm DEEPSEEK_API_KEY để trích xuất và đối chiếu chi tiết hơn.')
  if (sources.length === 0) result.warnings.push('Không tìm thấy nguồn web có thể sử dụng; các giá trị hiện có chỉ đến từ input hoặc inference được đánh dấu rõ.')
  return result
}

function verifyIdentityFromSources(result: ProductKnowledge, sources: ProductSource[]): number {
  let verified = 0
  const candidates = [
    ['product_identity.brand', result.product_identity.brand],
    ['product_identity.model', result.product_identity.model],
    ['product_identity.product_type', result.product_identity.product_type],
  ] as const

  for (const [fieldPath, value] of candidates) {
    if (value === UNKNOWN) continue
    const token = normalizeForMatch(value)
    const matching = sources.filter(source => containsNormalizedPhrase(`${source.title} ${source.excerpt}`, token))
    const support = [...new Map(matching.map(source => [source.domain, source])).values()]
    const strongSingle = support.some(source => ['official_brand', 'official_marketplace', 'official_document'].includes(source.source_type))
    if (support.length < 2 && !strongSingle) continue
    result.evidence = result.evidence.filter(item => item.field_path !== fieldPath)
    result.evidence.push({
      field_path: fieldPath,
      value_summary: value,
      source_ids: support.map(source => source.id),
      confidence: strongSingle ? 0.9 : 0.78,
      status: 'verified',
      note: strongSingle ? 'Được xác nhận bởi nguồn ưu tiên.' : 'Xuất hiện nhất quán trong ít nhất hai nguồn độc lập.',
    })
    verified += 1
  }
  return verified
}

function enforceEvidenceRules(knowledge: ProductKnowledge, input: ProductInput, allowedSources: ProductSource[]): ProductKnowledge {
  const allowedIds = new Set(allowedSources.map(source => source.id))
  knowledge.sources = allowedSources
  knowledge.researched_at = new Date().toISOString()
  knowledge.evidence = knowledge.evidence.map(item => {
    const sourceIds = item.source_ids.filter(id => allowedIds.has(id))
    const citedSources = allowedSources.filter(source => sourceIds.includes(source.id))
    const independentDomains = new Set(citedSources.map(source => source.domain)).size
    const hasStrongSource = citedSources.some(source => ['official_brand', 'official_marketplace', 'official_document'].includes(source.source_type))
    if (item.status === 'verified' && sourceIds.length === 0) {
      return { ...item, source_ids: [], status: 'unknown' as const, confidence: 0, value_summary: UNKNOWN, note: 'Model không cung cấp nguồn hợp lệ cho fact này.' }
    }
    if (item.status === 'verified' && !hasStrongSource && independentDomains < 2) {
      return { ...item, source_ids: sourceIds, status: 'inferred' as const, confidence: Math.min(item.confidence, 0.55), note: 'Chưa đủ hai nguồn độc lập hoặc một nguồn official để xác minh.' }
    }
    return { ...item, source_ids: sourceIds }
  })
  knowledge.pricing.observed_offers = knowledge.pricing.observed_offers
    .filter(offer => allowedIds.has(offer.source_id) && Number.isFinite(offer.amount) && offer.amount > 0)
  if (knowledge.pricing.observed_offers.length > 0) {
    const amounts = knowledge.pricing.observed_offers.map(offer => offer.amount)
    knowledge.pricing.market_min = Math.min(...amounts)
    knowledge.pricing.market_max = Math.max(...amounts)
    knowledge.pricing.status = 'observed'
  } else {
    knowledge.pricing.market_min = null
    knowledge.pricing.market_max = null
    knowledge.pricing.status = 'unknown'
  }
  if (input.productName && knowledge.product_identity.product_name === UNKNOWN) {
    knowledge.product_identity.product_name = input.productName
    addInputEvidence(knowledge, 'product_identity.product_name', input.productName, true)
  }
  const modelCodes = input.productName.match(/\b(?=[A-Z0-9-]*\d)[A-Z][A-Z0-9-]{2,}\b/gi) ?? []
  if (modelCodes.length > 1
    && knowledge.product_identity.brand !== UNKNOWN
    && knowledge.product_identity.model !== UNKNOWN) {
    knowledge.product_identity.product_name = `${knowledge.product_identity.brand} ${knowledge.product_identity.model}`
  }
  recalculateConfidence(knowledge)
  return productKnowledgeSchema.parse(knowledge)
}

function finalizeKnowledge(knowledge: ProductKnowledge): ProductKnowledge {
  recalculateConfidence(knowledge)
  const blockers: string[] = []
  const identity = knowledge.product_identity
  if (identity.product_name === UNKNOWN) blockers.push('Chưa xác định được tên sản phẩm chuẩn.')
  if (identity.brand === UNKNOWN) blockers.push('Chưa xác minh được thương hiệu.')
  if (identity.product_type === UNKNOWN) blockers.push('Chưa xác định được loại sản phẩm.')
  if (knowledge.sources.length < 2) blockers.push('Cần ít nhất hai nguồn sản phẩm có thể đối chiếu.')
  const verifiedCount = knowledge.evidence.filter(item => item.status === 'verified').length
  if (verifiedCount < 2) blockers.push('Chưa có đủ field được xác minh bằng evidence.')
  const trusted = knowledge.sources.some(source => ['official_brand', 'official_marketplace', 'official_document', 'major_retailer'].includes(source.source_type))
  const trustedIds = new Set(knowledge.sources
    .filter(source => ['official_brand', 'official_marketplace', 'official_document', 'major_retailer'].includes(source.source_type))
    .map(source => source.id))
  const trustedEvidence = knowledge.evidence.some(item => item.status === 'verified' && item.source_ids.some(id => trustedIds.has(id)))
  if (!trusted || !trustedEvidence) blockers.push('Chưa có fact được xác minh từ nguồn official hoặc retailer uy tín.')
  if (knowledge.conflicts.length > 0) blockers.push('Còn xung đột thông tin chưa được giải quyết.')
  if (knowledge.confidence.overall < 0.68) blockers.push('Overall confidence cần đạt tối thiểu 68%.')

  const hardBlocked = identity.product_name === UNKNOWN || identity.brand === UNKNOWN || identity.product_type === UNKNOWN || knowledge.sources.length === 0
  knowledge.readiness = {
    status: blockers.length === 0 ? 'ready_for_content' : hardBlocked ? 'blocked' : 'needs_review',
    downstream_allowed: blockers.length === 0,
    blockers,
    next_phase: 'content_and_creative',
  }
  if ((!trusted || !trustedEvidence) && knowledge.sources.length > 0 && !knowledge.warnings.includes('Chưa có evidence từ nguồn official hoặc retailer uy tín; không dùng dữ liệu này để publish tự động.')) {
    knowledge.warnings.push('Chưa có evidence từ nguồn official hoặc retailer uy tín; không dùng dữ liệu này để publish tự động.')
  }
  return productKnowledgeSchema.parse(knowledge)
}

function recalculateConfidence(knowledge: ProductKnowledge): void {
  const identity = knowledge.product_identity
  const specs = knowledge.specifications
  const values: Array<string | string[]> = [
    identity.product_name, identity.brand, identity.model, identity.product_type,
    specs.color, specs.material, specs.dimensions, specs.weight, specs.features,
    knowledge.category.general_category, knowledge.category.sub_category,
  ]
  const knownCount = values.filter(value => Array.isArray(value) ? value.length > 0 : value !== UNKNOWN && value.trim().length > 0).length
  const coverage = knownCount / values.length
  const sourceQuality = calculateSourceQuality(knowledge.sources)
  const verified = knowledge.evidence.filter(item => item.status === 'verified')
  const evidenceQuality = verified.length === 0 ? 0 : average(verified.map(item => item.confidence))
  knowledge.confidence.coverage = round2(coverage)
  knowledge.confidence.source_quality = sourceQuality
  const rawOverall = (coverage * 0.55) + (sourceQuality * 0.3) + (evidenceQuality * 0.15)
  const sourceCap = sourceQuality < 0.4 ? 0.67 : sourceQuality < 0.55 ? 0.79 : 1
  knowledge.confidence.overall = round2(Math.min(rawOverall, sourceCap))
}

function calculateSourceQuality(sources: ProductSource[]): number {
  if (sources.length === 0) return 0
  const independent = [...new Map(sources.map(source => [source.domain, source])).values()]
  const averageReliability = average(independent.map(source => source.reliability_score * (source.retrieval_status === 'full' ? 1 : 0.55)))
  const diversity = Math.min(1, independent.length / 3)
  const trusted = independent.some(source => ['official_brand', 'official_marketplace', 'official_document', 'major_retailer'].includes(source.source_type))
  return round2(averageReliability * (0.6 + (0.4 * diversity)) * (trusted ? 1 : 0.78))
}

function addInputEvidence(result: ProductKnowledge, fieldPath: string, value: string, supplied: boolean): void {
  if (!supplied || value === UNKNOWN) return
  result.evidence.push({ field_path: fieldPath, value_summary: value, source_ids: [], confidence: 0.7, status: 'user_provided', note: 'Giá trị do người dùng cung cấp; chưa tự động coi là fact đã xác minh.' })
}

function addInferredEvidence(result: ProductKnowledge, fieldPath: string, value: string): void {
  if (value === UNKNOWN) return
  result.evidence.push({ field_path: fieldPath, value_summary: value, source_ids: [], confidence: 0.45, status: 'inferred', note: 'Tách heuristic từ tên/mô tả; cần nguồn xác nhận.' })
}

function extractUserList(text: string, pattern: RegExp): string[] {
  const values: string[] = []
  for (const match of text.matchAll(pattern)) {
    const value = match[1]?.trim()
    if (value) values.push(value)
  }
  return [...new Set(values)]
}

function toProductSource(source: FetchedSource): ProductSource {
  return {
    id: source.sourceId,
    url: source.url,
    title: source.title,
    domain: source.domain,
    source_type: source.sourceType,
    reliability_score: source.reliabilityScore,
    accessed_at: source.fetchedAt,
    published_at: null,
    excerpt: (source.content || source.snippet).slice(0, 500),
    retrieval_status: source.fetchError ? 'snippet_only' : 'full',
    content_chars: source.content.length,
  }
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function normalizeForMatch(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function containsNormalizedPhrase(haystack: string, normalizedNeedle: string): boolean {
  const haystackTokens = normalizeForMatch(haystack).split(' ').filter(Boolean)
  const needleTokens = normalizedNeedle.split(' ').filter(Boolean)
  if (needleTokens.length === 0 || needleTokens.length > haystackTokens.length) return false
  return haystackTokens.some((_token, index) => needleTokens.every((part, offset) => haystackTokens[index + offset] === part))
}
