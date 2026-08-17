import { UNKNOWN, type ProductKnowledge } from './schema.js'

export function emptyProductKnowledge(now = new Date().toISOString()): ProductKnowledge {
  return {
    schema_version: '1.0',
    researched_at: now,
    language: 'vi',
    product_identity: {
      product_name: UNKNOWN,
      brand: UNKNOWN,
      model: UNKNOWN,
      product_type: UNKNOWN,
      identifiers: {},
    },
    specifications: {
      color: [],
      material: UNKNOWN,
      dimensions: UNKNOWN,
      weight: UNKNOWN,
      features: [],
      variants: [],
      technical_attributes: {},
    },
    category: {
      general_category: UNKNOWN,
      sub_category: UNKNOWN,
    },
    marketing: {
      potential_usps: [],
      communication_keywords: [],
      target_customer: [],
      use_cases: [],
    },
    pricing: {
      currency: 'VND',
      observed_offers: [],
      market_min: null,
      market_max: null,
      status: 'unknown',
    },
    sources: [],
    evidence: [],
    missing_information: [],
    conflicts: [],
    confidence: {
      overall: 0,
      coverage: 0,
      source_quality: 0,
    },
    readiness: {
      status: 'blocked',
      downstream_allowed: false,
      blockers: ['Research chưa hoàn tất.'],
      next_phase: 'content_and_creative',
    },
    warnings: [],
  }
}
