import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildCommercePackage } from '../src/application/commerce-package.js'
import { CommerceMediaGenerator } from '../src/application/media-generator.js'
import { productInputSchema, productKnowledgeSchema } from '../src/domain/schema.js'
import { LocalFileStorage } from '../src/infrastructure/file-storage.js'
import { JobStore } from '../src/infrastructure/job-store.js'
import type { ImageGenerationProvider } from '../src/providers/image-generation.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('CommerceMediaGenerator', () => {
  it('creates and persists one cover plus three feature images', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'commerce-media-'))
    tempDirs.push(directory)
    const store = new JobStore(join(directory, 'commerce.sqlite'))
    const storage = new LocalFileStorage(directory)
    store.createJob('job-1', productInputSchema.parse({ productName: 'IMOU A52P' }))
    const knowledge = productKnowledgeSchema.parse({
      schema_version: '1.0', researched_at: new Date().toISOString(),
      product_identity: { product_name: 'Camera IMOU A52P', brand: 'IMOU', model: 'A52P', product_type: 'Camera IP', identifiers: {} },
      specifications: { color: ['trắng'], material: 'Unknown', dimensions: 'Unknown', weight: 'Unknown', features: ['Độ phân giải 5MP'], variants: [], technical_attributes: {} },
      category: { general_category: 'Thiết bị điện tử', sub_category: 'Camera giám sát' },
      marketing: { potential_usps: [], communication_keywords: ['camera trong nhà'], target_customer: ['gia đình'], use_cases: ['giám sát trong nhà'] },
      sources: [], evidence: [], missing_information: [], conflicts: [],
      confidence: { overall: 0.8, coverage: 0.8, source_quality: 0.8 },
      readiness: { status: 'ready_for_content', downstream_allowed: true, blockers: [], next_phase: 'content_and_creative' },
      warnings: [],
    })
    const commercePackage = await buildCommercePackage({ knowledge, llm: null })
    expect(commercePackage.listing.recommended_title).toMatch(/^KOMEX x IMOU A52P Camera an ninh/)
    expect(commercePackage.listing.recommended_title).not.toContain('Security Camera')
    expect(commercePackage.campaign.usp_analysis).not.toHaveLength(0)
    expect(commercePackage.campaign.customer_insights).not.toHaveLength(0)
    expect(commercePackage.campaign.pain_points).not.toHaveLength(0)
    store.saveProductKnowledge('job-1', knowledge)
    store.saveCommercePackage('job-1', commercePackage)

    const calls: string[] = []
    const provider: ImageGenerationProvider = {
      name: 'test-image-provider',
      async generate(prompt) { calls.push(prompt); return Buffer.from('fake-png') },
    }
    await new CommerceMediaGenerator(store, storage, provider, 1).run('job-1')

    const job = store.getJob('job-1')
    expect(calls).toHaveLength(4)
    expect(job?.generatedAssets.map(asset => asset.slot)).toEqual(['cover', 'feature_1', 'feature_2', 'feature_3'])
    expect(job?.status).toBe('completed')
    expect(readFileSync(job!.generatedAssets[0]!.path).toString()).toBe('fake-png')
    store.close()
  })
})
