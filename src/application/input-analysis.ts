import { UNKNOWN, type InputAnalysis, type ProductInput } from '../domain/schema.js'

const PRODUCT_TYPE_HINTS = [
  'sữa rửa mặt', 'điện thoại', 'tai nghe', 'máy ảnh', 'camera an ninh', 'security camera',
  'giày', 'dép', 'áo', 'quần', 'váy', 'túi', 'son', 'kem', 'serum', 'camera',
  'laptop', 'nồi', 'chảo', 'bàn', 'ghế', 'đèn', 'shoe', 'sandal', 'shirt', 'dress',
  'bag', 'lipstick', 'cream', 'phone', 'headphone',
]

const GENERIC_LEADING_WORDS = new Set([
  'camera', 'product', 'san pham', 'giay', 'dep', 'ao', 'quan', 'vay', 'tui', 'son',
  'kem', 'serum', 'dien thoai', 'laptop', 'tai nghe', 'may anh', 'noi', 'chao', 'ban',
  'ghe', 'den', 'shoe', 'sandal', 'shirt', 'dress', 'bag', 'phone', 'headphone',
])

export function analyzeProductInput(input: ProductInput, imageObservations: Record<string, string | string[]> = {}): InputAnalysis {
  const combined = `${input.productName}\n${input.additionalInfo}`.trim()
  const tokens = input.productName.split(/\s+/).filter(Boolean)
  const visibleBrand = resolveVisibleBrand(scalarObservation(imageObservations.visible_brand), input.productName)
  const visibleModel = scalarObservation(imageObservations.visible_model)
  const visibleProductType = scalarObservation(imageObservations.visible_product_type)
  const firstToken = tokens[0]
  const inferredBrand = firstToken
    && /^[\p{L}\d][\p{L}\d&.-]+$/u.test(firstToken)
    && !GENERIC_LEADING_WORDS.has(normalizePhrase(firstToken))
    ? firstToken
    : undefined
  const inferredModel = tokens.find(token => /^(?=.*\d)[A-Z\d][A-Z\d._-]{2,}$/i.test(token))
  const likelyBrand = visibleBrand ?? inferredBrand ?? UNKNOWN
  const likelyModel = visibleModel ?? inferredModel ?? UNKNOWN
  const likelyProductType = visibleProductType ?? findProductType(combined) ?? UNKNOWN

  const known: Record<string, string | string[]> = {}
  if (input.productName) known.product_name = input.productName
  if (input.additionalInfo) known.user_description = input.additionalInfo
  if (input.imagePath) known.image = input.originalImageName ?? 'product-image'
  for (const [key, value] of Object.entries(imageObservations)) known[`vision.${key}`] = value

  const missing = [
    !input.productName && scalarObservation(imageObservations.visible_product_type) === undefined ? 'product_identity.product_name' : '',
    likelyBrand === UNKNOWN ? 'product_identity.brand' : '',
    likelyModel === UNKNOWN ? 'product_identity.model' : '',
    likelyProductType === UNKNOWN ? 'product_identity.product_type' : '',
    'specifications.material',
    'specifications.dimensions',
    'specifications.weight',
  ].filter(Boolean)

  return {
    known,
    missing,
    likelyBrand,
    likelyModel,
    likelyProductType,
    normalizedName: visibleBrand && visibleModel
      ? `${visibleBrand} ${visibleModel}`
      : input.productName.trim() || scalarObservation(imageObservations.visible_text) || UNKNOWN,
    imageObservations,
  }
}

function scalarObservation(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string' && value && value !== UNKNOWN) return value
  if (Array.isArray(value)) return value.find(item => item && item !== UNKNOWN)
  return undefined
}

export function generateSearchQueries(analysis: InputAnalysis, maxQueries: number): string[] {
  const identity = [analysis.likelyBrand, analysis.likelyModel]
    .filter(value => value !== UNKNOWN)
    .join(' ')
    || analysis.normalizedName
  if (identity === UNKNOWN) return []

  const baseName = analysis.normalizedName === UNKNOWN ? identity : analysis.normalizedName
  const suppliedName = typeof analysis.known.product_name === 'string' ? analysis.known.product_name : ''
  const productType = analysis.likelyProductType === UNKNOWN ? '' : analysis.likelyProductType
  const observedIdentity = [analysis.likelyBrand, analysis.likelyModel]
    .filter(value => value !== UNKNOWN)
    .join(' ')
  const officialIdentity = observedIdentity || identity
  const candidates = [
    observedIdentity,
    baseName,
    suppliedName,
    `${officialIdentity} ${productType} thông số kỹ thuật`,
    `${officialIdentity} specifications features`,
    `${officialIdentity} official`,
    `${officialIdentity} manual datasheet`,
    `${officialIdentity} review`,
  ]
  return [...new Set(candidates.map(query => query.replace(/\s+/g, ' ').trim()).filter(Boolean))].slice(0, maxQueries)
}

function findProductType(value: string): string | undefined {
  const tokens = normalizePhrase(value).split(' ').filter(Boolean)
  return PRODUCT_TYPE_HINTS.find(hint => containsTokenSequence(tokens, normalizePhrase(hint).split(' ')))
}

function containsTokenSequence(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false
  return haystack.some((_token, index) => needle.every((part, offset) => haystack[index + offset] === part))
}

function normalizePhrase(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function resolveVisibleBrand(rawBrand: string | undefined, productName: string): string | undefined {
  if (!rawBrand) return undefined
  const candidates = rawBrand.split(/\s*(?:,|\/|\||&|\bx\b|×)\s*/i).map(value => value.trim()).filter(Boolean)
  if (candidates.length <= 1) return rawBrand
  const productTokens = normalizePhrase(productName).split(' ').filter(Boolean)
  const matching = candidates.find(candidate => containsTokenSequence(productTokens, normalizePhrase(candidate).split(' ')))
  return matching ?? rawBrand
}
