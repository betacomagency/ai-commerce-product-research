import { describe, expect, it } from 'vitest'
import { analyzeProductInput } from '../src/application/input-analysis.js'
import { buildProductKnowledge } from '../src/application/synthesizer.js'
import { productInputSchema, type FetchedSource } from '../src/domain/schema.js'
import type { LlmProvider } from '../src/providers/llm.js'

describe('Product Knowledge synthesis', () => {
  it('uses structured extraction while keeping sources and readiness under application control', async () => {
    const input = productInputSchema.parse({ productName: 'Camera A52P' })
    const analysis = analyzeProductInput(input, {
      visible_brand: 'Imou',
      visible_model: 'A52P (Ranger 2)',
      visible_product_type: 'Security Camera',
    })
    const sources: FetchedSource[] = [
      {
        sourceId: 'src_1', title: 'Imou A52P Ranger 2 5MP', url: 'https://imou.example/a52p',
        snippet: 'A52P Ranger 2 5MP security camera', rank: 1, domain: 'imou.example',
        sourceType: 'official_brand', reliabilityScore: 0.95,
        content: 'Imou A52P Ranger 2 security camera. Resolution 5MP. Pan and tilt.',
        fetchedAt: new Date().toISOString(),
      },
      {
        sourceId: 'src_2', title: 'Imou A52P specs', url: 'https://retailer.example/a52p',
        snippet: 'Imou A52P 5MP', rank: 2, domain: 'retailer.example',
        sourceType: 'major_retailer', reliabilityScore: 0.72,
        content: 'Imou A52P indoor security camera with 5MP resolution.',
        fetchedAt: new Date().toISOString(),
      },
    ]
    let receivedSchema = false
    const llm: LlmProvider = {
      name: 'test-structured-llm',
      async generateJson<T>(_system: string, _user: string, _signal?: AbortSignal, jsonSchema?: unknown): Promise<T> {
        receivedSchema = Boolean(jsonSchema)
        return {
          product_identity: { product_name: 'Imou A52P (Ranger 2)', brand: 'Imou', model: 'A52P (Ranger 2)', product_type: 'Security Camera', identifiers: {} },
          specifications: { color: ['White'], material: 'Unknown', dimensions: 'Unknown', weight: 'Unknown', features: ['5MP resolution', 'Pan and tilt'], variants: [], technical_attributes: { resolution: '5MP' } },
          category: { general_category: 'Electronics', sub_category: 'Indoor security camera' },
          marketing: { potential_usps: ['5MP image'], communication_keywords: ['indoor monitoring'], target_customer: ['Home users'], use_cases: ['Indoor monitoring'] },
          pricing: {
            currency: 'VND',
            observed_offers: [
              { amount: 599000, seller: 'Imou', source_id: 'src_1', note: 'Giá bán đang hiển thị' },
              { amount: 549000, seller: 'Retailer', source_id: 'src_2', note: 'Giá bán đang hiển thị' },
              { amount: 1, seller: 'Không rõ', source_id: 'rogue', note: 'Nguồn không thuộc research' },
            ],
            market_min: 1,
            market_max: 599000,
            status: 'conflicting',
          },
          sources: [{ malformed: true }], evidence: [{ malformed: true }], missing_information: [], conflicts: [],
          confidence: { overall: 1, coverage: 1, source_quality: 1 }, warnings: [],
        } as T
      },
    }

    const result = await buildProductKnowledge({ input, analysis, sources, llm, retryAttempts: 1 })
    expect(receivedSchema).toBe(true)
    expect(result.product_identity).toMatchObject({ brand: 'Imou', model: 'A52P (Ranger 2)', product_type: 'Security Camera' })
    expect(result.specifications.technical_attributes).toMatchObject({ resolution: '5MP' })
    expect(result.sources.map(source => source.id)).toEqual(['src_1', 'src_2'])
    expect(result.evidence).toEqual([])
    expect(result.pricing.observed_offers.map(offer => offer.source_id)).toEqual(['src_1', 'src_2'])
    expect(result.pricing).toMatchObject({ market_min: 549000, market_max: 599000, status: 'observed' })
    expect(result.confidence.overall).toBeLessThan(1)
    expect(result.readiness.downstream_allowed).toBe(false)
  })
})
