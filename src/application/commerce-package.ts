import { z } from 'zod'
import { commercePackageSchema, UNKNOWN, type CommercePackage, type ProductKnowledge } from '../domain/schema.js'
import { withRetry } from '../infrastructure/retry.js'
import type { LlmProvider } from '../providers/llm.js'

const COMMERCE_PACKAGE_JSON_SCHEMA = z.toJSONSchema(commercePackageSchema) as Record<string, unknown>
delete COMMERCE_PACKAGE_JSON_SCHEMA.$schema
const SELLER_BRAND_PREFIX = 'KOMEX x'

const SYSTEM_PROMPT = `You are a senior Vietnamese ecommerce strategist for Shopee.
Create a conversion-focused but evidence-safe Commerce Package from the supplied Product Knowledge.
Hard rules:
- Use only facts present in Product Knowledge. Never invent specifications, package contents, warranty, compatibility, certifications, discounts, or performance claims.
- Unknown or conflicting facts must not become selling claims.
- Keep model variants separate.
- The recommended Shopee title must begin with "KOMEX x", be entirely natural Vietnamese, and follow this SEO order: seller brand + product brand + exact model + Vietnamese product type + strongest verified search claims. Never leave an English product-type phrase such as "Security Camera" or "Pan and tilt indoor security camera" in the title.
- Analyze verified USP, customer insight, pain points, customer benefits and practical communication angles after research. Clearly distinguish product facts from marketing interpretation.
- Shopee attributes must contain only known facts; omit unknown attributes.
- Pricing must come from Product Knowledge observed offers. Treat it as a market reference. Never invent a price, discount, margin, or profitability claim. A final recommended selling price requires cost and margin review.
- Create exactly four square image briefs in this order: cover, feature_1, feature_2, feature_3.
- Image prompts must preserve the exact product geometry, ports, logo placement, color and accessories from a supplied reference image when available.
- Image text must use only short verified claims. Ask for clean typography and no fake badges, fake ratings, prices, discounts, warranties or certifications.
- The video plan is a storyboard/script only, not a claim source.
- Output JSON only.`

export async function buildCommercePackage(options: {
  knowledge: ProductKnowledge
  llm: LlmProvider | null
  retryAttempts?: number
  signal?: AbortSignal
}): Promise<CommercePackage> {
  const fallback = buildFallbackPackage(options.knowledge)
  if (!options.llm) return fallback
  try {
    const candidate = await withRetry(
      () => options.llm!.generateJson<unknown>(
        SYSTEM_PROMPT,
        JSON.stringify({
          task: 'Build a Vietnamese Shopee listing, campaign plan, 4-image plan and short-video storyboard.',
          product_knowledge: options.knowledge,
          required_output_template: fallback,
        }),
        options.signal,
        COMMERCE_PACKAGE_JSON_SCHEMA,
      ),
      { attempts: options.retryAttempts ?? 2, baseDelayMs: 800 },
    )
    const parsed = commercePackageSchema.safeParse(candidate)
    if (parsed.success) return finalizePackage(parsed.data, options.knowledge)
    fallback.warnings.push('Commerce LLM trả về cấu trúc chưa hợp lệ; đã dùng template an toàn.')
    return fallback
  } catch (error) {
    fallback.warnings.push(`Không tạo được Commerce Package bằng LLM; đã dùng fallback: ${error instanceof Error ? error.message : 'Unknown error'}`)
    return fallback
  }
}

function buildFallbackPackage(knowledge: ProductKnowledge): CommercePackage {
  const identity = knowledge.product_identity
  const name = identity.product_name !== UNKNOWN
    ? identity.product_name
    : [identity.brand, identity.model, identity.product_type].filter(value => value !== UNKNOWN).join(' ') || 'Sản phẩm cần xác minh'
  const type = identity.product_type === UNKNOWN ? 'sản phẩm' : identity.product_type
  const features = knowledge.specifications.features.slice(0, 5)
  const verifiedClaims = knowledge.evidence
    .filter(item => item.status === 'verified' || item.status === 'user_provided')
    .filter(item => item.field_path.startsWith('specifications.'))
    .filter(item => item.value_summary !== UNKNOWN)
    .slice(0, 6)
    .map(item => item.value_summary)
  const highlights = unique([...features, ...verifiedClaims]).slice(0, 6)
  const keywords = unique([
    identity.brand, identity.model, type,
    ...knowledge.marketing.communication_keywords,
    ...knowledge.marketing.use_cases,
  ].filter(value => value !== UNKNOWN)).slice(0, 15)
  const attributeEntries: Array<[string, string]> = [
    ['Thương hiệu', identity.brand],
    ['Model', identity.model],
    ['Loại sản phẩm', identity.product_type],
    ['Màu sắc', knowledge.specifications.color.join(', ')],
    ['Chất liệu', knowledge.specifications.material],
    ['Kích thước', knowledge.specifications.dimensions],
    ['Khối lượng', knowledge.specifications.weight],
    ...Object.entries(knowledge.specifications.technical_attributes).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : value] as [string, string]),
  ]
  const attributes = Object.fromEntries(attributeEntries.filter(([, value]) => value && value !== UNKNOWN))
  const titleBase = buildSeoTitle(knowledge)
  const shortDescription = highlights.length
    ? `${name} nổi bật với ${highlights.slice(0, 3).join(', ')}. Thông tin được tổng hợp từ nguồn đã đối chiếu; vui lòng kiểm tra biến thể trước khi đặt hàng.`
    : `${name}. Vui lòng kiểm tra thông số và biến thể trong phần thuộc tính trước khi đặt hàng.`
  const factsText = highlights.length ? highlights.map(item => `• ${item}`).join('\n') : '• Thông số chi tiết đang được tiếp tục xác minh.'
  const sourceGuardrails = knowledge.readiness.blockers.length
    ? knowledge.readiness.blockers
    : ['Chỉ dùng các field có evidence khi xuất bản.']
  const observedAmounts = knowledge.pricing.observed_offers.map(offer => offer.amount).sort((a, b) => a - b)
  const priceRange = observedAmounts.length
    ? `${formatMoney(observedAmounts[0]!, knowledge.pricing.currency)}${observedAmounts.length > 1 ? ` – ${formatMoney(observedAmounts.at(-1)!, knowledge.pricing.currency)}` : ''}`
    : UNKNOWN
  const referencePrice = observedAmounts.length >= 2
    ? formatMoney(observedAmounts[Math.floor((observedAmounts.length - 1) / 2)]!, knowledge.pricing.currency)
    : UNKNOWN

  const makePrompt = (purpose: string, headline: string, direction: string) => [
    `Create a premium 1:1 Vietnamese ecommerce image for ${name}.`,
    'If a reference product image is supplied, preserve the exact product identity, geometry, proportions, colors, logo placement, ports and included accessories. Do not redesign the product.',
    `Purpose: ${purpose}. Visual direction: ${direction}.`,
    headline ? `Use this exact short Vietnamese headline only if typography is clean and legible: "${headline}".` : 'No text.',
    highlights.length ? `Only verified product claims allowed: ${highlights.slice(0, 4).join(' | ')}.` : 'Do not show specification claims.',
    'No price, discount, rating, certification, warranty badge, marketplace logo, watermark or invented accessory. Square 1024x1024, generous safe margins.',
  ].join(' ')

  return commercePackageSchema.parse({
    schema_version: '1.0',
    generated_at: new Date().toISOString(),
    language: 'vi',
    publication_status: knowledge.readiness.downstream_allowed ? 'ready' : 'review_required',
    listing: {
      recommended_title: titleBase,
      title_options: buildSeoTitleOptions(knowledge),
      short_description: shortDescription,
      full_description: `${shortDescription}\n\nĐIỂM NỔI BẬT\n${factsText}\n\nTHÔNG TIN SẢN PHẨM\n${Object.entries(attributes).map(([key, value]) => `• ${key}: ${value}`).join('\n') || '• Vui lòng xem thông tin đã xác minh.'}\n\nLƯU Ý\n• Kiểm tra đúng model/biến thể trước khi đặt hàng.\n• Hình ảnh truyền thông cần được duyệt trước khi đăng bán.`,
      highlights,
      search_keywords: keywords,
      hashtags: keywords.slice(0, 6).map(value => `#${value.replace(/[^\p{L}\p{N}]+/gu, '')}`).filter(value => value.length > 1),
    },
    shopee: {
      category_suggestion: [knowledge.category.general_category, knowledge.category.sub_category].filter(value => value !== UNKNOWN).join(' > ') || type,
      attributes,
      variation_strategy: knowledge.specifications.variants,
      package_contents: [],
      compliance_notes: ['Không đăng claim chưa có evidence.', 'Kiểm tra chính sách ngành hàng và thuộc tính bắt buộc của Shopee trước khi publish.'],
    },
    pricing: {
      market_range: priceRange,
      recommended_price: referencePrice,
      rationale: observedAmounts.length >= 2
        ? `Giá tham khảo lấy theo trung vị của ${observedAmounts.length} mức giá quan sát. Cần đối chiếu giá vốn, phí sàn, voucher và biên lợi nhuận trước khi chốt.`
        : observedAmounts.length === 1
          ? 'Mới có một mức giá quan sát; chưa đủ cơ sở đề xuất giá bán. Cần thêm nguồn và dữ liệu giá vốn.'
          : 'Chưa tìm thấy giá đúng model/biến thể từ nguồn đủ rõ ràng. Cần bổ sung giá thị trường và giá vốn.',
      status: observedAmounts.length >= 2 ? 'needs_cost_review' : 'unknown',
    },
    campaign: {
      positioning: `${name} — tập trung vào thông tin rõ ràng, đúng model và các lợi ích đã được kiểm chứng.`,
      target_audience: knowledge.marketing.target_customer,
      communication_keywords: keywords,
      message_pillars: highlights.slice(0, 4),
      hooks: highlights.slice(0, 3).map(item => `${item} — phù hợp nhu cầu nào?`),
      usp_analysis: unique([...knowledge.marketing.potential_usps, ...highlights]).slice(0, 5),
      customer_insights: knowledge.marketing.target_customer.slice(0, 4).map(audience => `${audience} cần thông tin dễ hiểu, đúng model và có thể kiểm chứng trước khi quyết định mua.`),
      pain_points: knowledge.marketing.use_cases.slice(0, 4).map(useCase => `Khó lựa chọn giải pháp phù hợp cho nhu cầu: ${useCase}.`),
      customer_benefits: highlights.slice(0, 5),
      content_angles: unique([
        ...highlights.slice(0, 2).map(item => `Chứng minh lợi ích “${item}” trong tình huống sử dụng thực tế.`),
        ...knowledge.marketing.use_cases.slice(0, 2).map(item => `Tình huống sử dụng: ${item}.`),
      ]),
      call_to_action: 'Xem kỹ thông số và chọn đúng phiên bản phù hợp nhu cầu của bạn.',
    },
    media_plan: {
      format: 'shopee_square_1_1',
      visual_system: 'Nền sáng sạch, tương phản cao, sản phẩm là chủ thể chính, typography ngắn gọn và nhất quán giữa bốn ảnh.',
      assets: [
        { slot: 'cover', label: 'Ảnh bìa Shopee', purpose: 'Nhận diện sản phẩm ngay trên trang kết quả tìm kiếm', headline: truncate(titleBase, 42), supporting_copy: highlights.slice(0, 2), visual_direction: 'Hero product shot trên nền sáng, sản phẩm chiếm 70–80% khung hình, ít chữ.', generation_prompt: makePrompt('Shopee cover image', truncate(titleBase, 42), 'clean premium hero product shot, bright background, product occupies 70-80 percent') },
        { slot: 'feature_1', label: 'Ảnh mô tả 1 · Lợi ích chính', purpose: 'Truyền đạt lợi ích nổi bật đã xác minh', headline: highlights[0] || 'Điểm nổi bật', supporting_copy: highlights.slice(0, 3), visual_direction: 'Infographic gọn với một lợi ích chính và tối đa ba callout.', generation_prompt: makePrompt('verified key benefit infographic', highlights[0] || '', 'clean infographic with one hero benefit and up to three concise callouts') },
        { slot: 'feature_2', label: 'Ảnh mô tả 2 · Ngữ cảnh sử dụng', purpose: 'Giúp khách hình dung tình huống sử dụng', headline: knowledge.marketing.use_cases[0] || 'Phù hợp nhu cầu thực tế', supporting_copy: knowledge.marketing.use_cases.slice(0, 3), visual_direction: 'Lifestyle scene chân thực nhưng vẫn giữ sản phẩm chính xác theo ảnh tham chiếu.', generation_prompt: makePrompt('lifestyle use-case image', knowledge.marketing.use_cases[0] || '', 'realistic Vietnamese lifestyle context, product remains visually exact and prominent') },
        { slot: 'feature_3', label: 'Ảnh mô tả 3 · Thông số & tin cậy', purpose: 'Tóm tắt thông số đã kiểm chứng và hỗ trợ quyết định mua', headline: 'Thông tin cần biết', supporting_copy: Object.entries(attributes).slice(0, 4).map(([key, value]) => `${key}: ${value}`), visual_direction: 'Specification card rõ ràng, tối đa bốn dòng, bố cục dễ đọc trên mobile.', generation_prompt: makePrompt('verified specification summary', 'Thông tin cần biết', 'mobile-readable specification card with at most four verified facts') },
      ],
    },
    video_plan: {
      duration_seconds: 15,
      concept: `Video dọc 15 giây giới thiệu ${name} bằng các lợi ích đã xác minh.`,
      opening_hook: highlights[0] ? `${highlights[0]} có phù hợp với bạn?` : `Đây có phải ${type} bạn đang tìm?`,
      scenes: [
        { order: 1, duration_seconds: 3, visual: 'Cận cảnh sản phẩm, chuyển động máy quay nhẹ.', overlay_text: truncate(titleBase, 40), voiceover: `Đây là ${name}.` },
        { order: 2, duration_seconds: 5, visual: 'Minh họa lợi ích chính trong ngữ cảnh sử dụng.', overlay_text: highlights[0] || '', voiceover: highlights[0] || 'Xem thông tin nổi bật của sản phẩm.' },
        { order: 3, duration_seconds: 4, visual: 'Hiển thị tối đa ba thông số đã xác minh.', overlay_text: highlights.slice(1, 3).join(' • '), voiceover: highlights.slice(1, 3).join(', ') },
        { order: 4, duration_seconds: 3, visual: 'Hero shot và lời kêu gọi hành động.', overlay_text: 'Chọn đúng model', voiceover: 'Kiểm tra đúng model và xem chi tiết ngay.' },
      ],
      caption: `${shortDescription}\n${keywords.slice(0, 5).map(value => `#${value.replace(/[^\p{L}\p{N}]+/gu, '')}`).join(' ')}`,
    },
    source_guardrails: sourceGuardrails,
    warnings: knowledge.readiness.downstream_allowed ? [] : ['Commerce Package là bản nháp vì Product Knowledge chưa đạt readiness. Cần duyệt claim trước khi đăng bán.'],
  })
}

function finalizePackage(value: CommercePackage, knowledge: ProductKnowledge): CommercePackage {
  const seoTitle = buildSeoTitle(knowledge)
  const seoOptions = buildSeoTitleOptions(knowledge)
  return commercePackageSchema.parse({
    ...value,
    schema_version: '1.0',
    generated_at: new Date().toISOString(),
    publication_status: knowledge.readiness.downstream_allowed ? value.publication_status : 'review_required',
    listing: {
      ...value.listing,
      recommended_title: seoTitle,
      title_options: unique([...seoOptions, ...value.listing.title_options.filter(title => title.startsWith(SELLER_BRAND_PREFIX))]).slice(0, 4),
    },
    source_guardrails: unique([...value.source_guardrails, ...knowledge.readiness.blockers]),
    warnings: knowledge.readiness.downstream_allowed
      ? value.warnings
      : unique([...value.warnings, 'Bản nháp: Product Knowledge chưa đạt readiness; không publish tự động.']),
  })
}

function buildSeoTitle(knowledge: ProductKnowledge): string {
  const identity = knowledge.product_identity
  const brand = identity.brand !== UNKNOWN ? identity.brand.toLocaleUpperCase('vi') : ''
  const model = identity.model !== UNKNOWN ? identity.model.toLocaleUpperCase('vi') : ''
  const productType = localizeProductType(identity.product_type, knowledge.category.sub_category)
  const claims = verifiedSeoClaims(knowledge)
  return truncate([SELLER_BRAND_PREFIX, brand, model, productType, claims.length ? `- ${claims.join(', ')}` : ''].filter(Boolean).join(' '), 120)
}

function buildSeoTitleOptions(knowledge: ProductKnowledge): string[] {
  const identity = knowledge.product_identity
  const brand = identity.brand !== UNKNOWN ? identity.brand.toLocaleUpperCase('vi') : ''
  const model = identity.model !== UNKNOWN ? identity.model.toLocaleUpperCase('vi') : ''
  const type = localizeProductType(identity.product_type, knowledge.category.sub_category)
  const claims = verifiedSeoClaims(knowledge)
  const base = [SELLER_BRAND_PREFIX, brand, model, type].filter(Boolean).join(' ')
  return unique([
    buildSeoTitle(knowledge),
    truncate(`${base}${claims[0] ? ` - ${claims[0]}` : ''}`, 120),
    truncate(`${base}${claims.slice(0, 2).length ? ` - ${claims.slice(0, 2).join(', ')}` : ''}`, 120),
  ])
}

function localizeProductType(productType: string, subCategory: string): string {
  const source = `${productType} ${subCategory}`.toLocaleLowerCase('vi')
  if (/indoor.*security camera|security camera.*indoor|camera.*trong nhà/.test(source)) return 'Camera an ninh trong nhà'
  if (/security camera|camera ip|camera wifi|camera/.test(source)) return 'Camera an ninh'
  if (/shoe|giày/.test(source)) return 'Giày'
  if (/shirt|áo/.test(source)) return 'Áo'
  if (/trouser|pants|quần/.test(source)) return 'Quần'
  if (productType !== UNKNOWN && /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(productType)) return productType
  if (subCategory !== UNKNOWN && /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(subCategory)) return subCategory
  return 'Sản phẩm chính hãng'
}

function verifiedSeoClaims(knowledge: ProductKnowledge): string[] {
  const raw = [
    ...knowledge.specifications.features,
    ...Object.values(knowledge.specifications.technical_attributes).flatMap(value => Array.isArray(value) ? value : [value]),
    ...knowledge.marketing.potential_usps,
  ]
  const claims: string[] = []
  for (const value of raw) {
    const normalized = value.toLocaleLowerCase('vi')
    const resolution = value.match(/\b\d+(?:\.\d+)?\s*mp\b/i)?.[0]
    if (resolution) claims.push(`Hình ảnh ${resolution.toLocaleUpperCase('vi')}`)
    if (/two.?way|2 chiều|đàm thoại/.test(normalized)) claims.push('Đàm thoại 2 chiều')
    if (/pan|tilt|xoay|quay quét/.test(normalized)) claims.push('Xoay quét linh hoạt')
    if (/wi-?fi\s*6/.test(normalized)) claims.push('Wi-Fi 6')
    const nightVision = value.match(/(?:night vision|hồng ngoại)[^\d]{0,8}(\d+)\s*m/i)
    if (nightVision?.[1]) claims.push(`Hồng ngoại ${nightVision[1]}m`)
    if (/motion detection|phát hiện chuyển động/.test(normalized)) claims.push('Phát hiện chuyển động')
  }
  return unique(claims).slice(0, 4)
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))]
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trim()}…`
}

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount)
  } catch {
    return `${new Intl.NumberFormat('vi-VN').format(amount)} ${currency}`
  }
}
