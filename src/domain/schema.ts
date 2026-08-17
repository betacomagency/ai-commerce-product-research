import { z } from 'zod'

export const UNKNOWN = 'Unknown' as const

const unknownable = z.string().min(1).default(UNKNOWN)

export const productSourceSchema = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  title: z.string().min(1),
  domain: z.string().min(1),
  source_type: z.enum([
    'official_brand',
    'official_marketplace',
    'official_document',
    'major_retailer',
    'marketplace_listing',
    'other',
  ]),
  reliability_score: z.number().min(0).max(1),
  accessed_at: z.string(),
  published_at: z.string().nullable().default(null),
  excerpt: z.string().default(''),
  retrieval_status: z.enum(['full', 'snippet_only']).default('full'),
  content_chars: z.number().int().min(0).default(0),
})

export const fieldEvidenceSchema = z.object({
  field_path: z.string().min(1),
  value_summary: z.string().min(1),
  source_ids: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
  status: z.enum(['verified', 'user_provided', 'inferred', 'conflicting', 'unknown']),
  note: z.string().default(''),
})

export const missingInformationSchema = z.object({
  field_path: z.string().min(1),
  reason: z.string().min(1),
  priority: z.enum(['high', 'medium', 'low']),
})

export const productKnowledgeSchema = z.object({
  schema_version: z.literal('1.0'),
  researched_at: z.string(),
  language: z.string().default('vi'),
  product_identity: z.object({
    product_name: unknownable,
    brand: unknownable,
    model: unknownable,
    product_type: unknownable,
    identifiers: z.record(z.string(), z.string()).default({}),
  }),
  specifications: z.object({
    color: z.array(z.string()).default([]),
    material: unknownable,
    dimensions: unknownable,
    weight: unknownable,
    features: z.array(z.string()).default([]),
    variants: z.array(z.string()).default([]),
    technical_attributes: z.record(z.string(), z.union([z.string(), z.array(z.string())])).default({}),
  }),
  category: z.object({
    general_category: unknownable,
    sub_category: unknownable,
  }),
  marketing: z.object({
    potential_usps: z.array(z.string()).default([]),
    communication_keywords: z.array(z.string()).default([]),
    target_customer: z.array(z.string()).default([]),
    use_cases: z.array(z.string()).default([]),
  }),
  pricing: z.object({
    currency: z.string().min(1).default('VND'),
    observed_offers: z.array(z.object({
      amount: z.number().positive(),
      seller: z.string().default(''),
      source_id: z.string().min(1),
      note: z.string().default(''),
    })).default([]),
    market_min: z.number().positive().nullable().default(null),
    market_max: z.number().positive().nullable().default(null),
    status: z.enum(['unknown', 'observed', 'conflicting']).default('unknown'),
  }).default({ currency: 'VND', observed_offers: [], market_min: null, market_max: null, status: 'unknown' }),
  sources: z.array(productSourceSchema).default([]),
  evidence: z.array(fieldEvidenceSchema).default([]),
  missing_information: z.array(missingInformationSchema).default([]),
  conflicts: z.array(z.object({
    field_path: z.string(),
    values: z.array(z.object({ value: z.string(), source_ids: z.array(z.string()) })),
    resolution: z.string(),
  })).default([]),
  confidence: z.object({
    overall: z.number().min(0).max(1),
    coverage: z.number().min(0).max(1),
    source_quality: z.number().min(0).max(1),
  }),
  readiness: z.object({
    status: z.enum(['blocked', 'needs_review', 'ready_for_content']),
    downstream_allowed: z.boolean(),
    blockers: z.array(z.string()),
    next_phase: z.literal('content_and_creative'),
  }).default({
    status: 'blocked',
    downstream_allowed: false,
    blockers: ['Product Knowledge cũ chưa được đánh giá readiness.'],
    next_phase: 'content_and_creative',
  }),
  warnings: z.array(z.string()).default([]),
})

export type ProductKnowledge = z.infer<typeof productKnowledgeSchema>
export type ProductSource = z.infer<typeof productSourceSchema>

export const commerceAssetBriefSchema = z.object({
  slot: z.enum(['cover', 'feature_1', 'feature_2', 'feature_3']),
  label: z.string().min(1),
  purpose: z.string().min(1),
  headline: z.string().default(''),
  supporting_copy: z.array(z.string()).default([]),
  visual_direction: z.string().min(1),
  generation_prompt: z.string().min(1),
})

export const commercePackageSchema = z.object({
  schema_version: z.literal('1.0'),
  generated_at: z.string(),
  language: z.string().default('vi'),
  publication_status: z.enum(['draft', 'review_required', 'ready']),
  listing: z.object({
    recommended_title: z.string().min(1),
    title_options: z.array(z.string()).min(1),
    short_description: z.string().min(1),
    full_description: z.string().min(1),
    highlights: z.array(z.string()).default([]),
    search_keywords: z.array(z.string()).default([]),
    hashtags: z.array(z.string()).default([]),
  }),
  shopee: z.object({
    category_suggestion: z.string().min(1),
    attributes: z.record(z.string(), z.string()).default({}),
    variation_strategy: z.array(z.string()).default([]),
    package_contents: z.array(z.string()).default([]),
    compliance_notes: z.array(z.string()).default([]),
  }),
  pricing: z.object({
    market_range: z.string().min(1),
    recommended_price: z.string().min(1),
    rationale: z.string().min(1),
    status: z.enum(['unknown', 'market_reference', 'needs_cost_review']),
  }).default({
    market_range: UNKNOWN,
    recommended_price: UNKNOWN,
    rationale: 'Chưa có dữ liệu giá đủ tin cậy. Cần bổ sung giá vốn và biên lợi nhuận trước khi quyết định.',
    status: 'unknown',
  }),
  campaign: z.object({
    positioning: z.string().min(1),
    target_audience: z.array(z.string()).default([]),
    communication_keywords: z.array(z.string()).default([]),
    message_pillars: z.array(z.string()).default([]),
    hooks: z.array(z.string()).default([]),
    usp_analysis: z.array(z.string()).default([]),
    customer_insights: z.array(z.string()).default([]),
    pain_points: z.array(z.string()).default([]),
    customer_benefits: z.array(z.string()).default([]),
    content_angles: z.array(z.string()).default([]),
    call_to_action: z.string().min(1),
  }),
  media_plan: z.object({
    format: z.literal('shopee_square_1_1'),
    visual_system: z.string().min(1),
    assets: z.array(commerceAssetBriefSchema).length(4),
  }),
  video_plan: z.object({
    duration_seconds: z.number().int().min(5).max(60),
    concept: z.string().min(1),
    opening_hook: z.string().min(1),
    scenes: z.array(z.object({
      order: z.number().int().positive(),
      duration_seconds: z.number().positive(),
      visual: z.string().min(1),
      overlay_text: z.string().default(''),
      voiceover: z.string().default(''),
    })).default([]),
    caption: z.string().min(1),
  }),
  source_guardrails: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
})

export type CommercePackage = z.infer<typeof commercePackageSchema>

export const generatedAssetSchema = z.object({
  id: z.string().min(1),
  slot: commerceAssetBriefSchema.shape.slot,
  label: z.string().min(1),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  path: z.string().min(1),
  url: z.string().min(1),
  model: z.string().min(1),
  prompt: z.string().min(1),
  createdAt: z.string(),
})

export type GeneratedAsset = z.infer<typeof generatedAssetSchema>

export const jobStatusSchema = z.enum([
  'created',
  'analyzing',
  'researching',
  'synthesizing',
  'contenting',
  'generating_media',
  'completed',
  'needs_input',
  'failed',
])

export type JobStatus = z.infer<typeof jobStatusSchema>

export const productInputSchema = z.object({
  productName: z.string().trim().max(300).default(''),
  additionalInfo: z.string().trim().max(10_000).default(''),
  imagePath: z.string().nullable().default(null),
  imageMimeType: z.string().nullable().default(null),
  originalImageName: z.string().nullable().default(null),
}).refine(
  value => Boolean(value.productName || value.additionalInfo || value.imagePath),
  { message: 'Cần nhập tên, thông tin sản phẩm hoặc tải ít nhất một ảnh.' },
)

export type ProductInput = z.infer<typeof productInputSchema>

export interface ProgressEvent {
  id: number
  jobId: string
  level: 'info' | 'warning' | 'error'
  stage: string
  message: string
  createdAt: string
}

export interface ProductJob {
  id: string
  sessionId: string
  status: JobStatus
  input: ProductInput
  research: ResearchSnapshot | null
  productKnowledge: ProductKnowledge | null
  commercePackage: CommercePackage | null
  generatedAssets: GeneratedAsset[]
  errorMessage: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
  events: ProgressEvent[]
}

export interface ResearchSession {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  jobCount: number
}

export interface SearchResult {
  title: string
  url: string
  snippet: string
  rank: number
}

export interface FetchedSource extends SearchResult {
  sourceId: string
  domain: string
  sourceType: ProductSource['source_type']
  reliabilityScore: number
  content: string
  fetchedAt: string
  fetchError?: string
}

export interface InputAnalysis {
  known: Record<string, string | string[]>
  missing: string[]
  likelyBrand: string
  likelyModel: string
  likelyProductType: string
  normalizedName: string
  imageObservations: Record<string, string | string[]>
}

export interface ResearchSnapshot {
  analysis: InputAnalysis
  searchQueries: string[]
  sources: FetchedSource[]
  providerInfo: {
    llm: string
    vision: string
    search: string
  }
}
