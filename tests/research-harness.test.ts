import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CommerceResearchHarness, type ProductSourceFetcher } from '../src/application/research-harness.js'
import { productInputSchema, type FetchedSource, type SearchResult } from '../src/domain/schema.js'
import { JobStore } from '../src/infrastructure/job-store.js'
import type { SearchProvider } from '../src/providers/search.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('CommerceResearchHarness', () => {
  it('runs a durable keyless job end-to-end without inventing specs', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'commerce-harness-'))
    tempDirs.push(directory)
    const store = new JobStore(join(directory, 'commerce.sqlite'))
    const input = productInputSchema.parse({ productName: 'Erosska EL084', additionalInfo: 'Giày búp bê nữ\nMàu nâu' })
    store.createJob('job-1', input)

    const search: SearchProvider = {
      name: 'test-search',
      async search(): Promise<SearchResult[]> {
        return [{ title: 'Erosska EL084', url: 'https://example.com/el084', snippet: 'Product page', rank: 1 }]
      },
    }
    const fetcher: ProductSourceFetcher = {
      async fetch(result, sourceId): Promise<FetchedSource> {
        return {
          ...result,
          sourceId,
          domain: 'example.com',
          sourceType: 'other',
          reliabilityScore: 0.45,
          content: 'Erosska EL084 product page without verified material, dimensions or weight.',
          fetchedAt: new Date().toISOString(),
        }
      },
    }
    const harness = new CommerceResearchHarness(store, search, fetcher, null, null, {
      maxSearchQueries: 2,
      maxSources: 2,
      retryAttempts: 1,
    })

    await harness.run('job-1')
    const job = store.getJob('job-1')
    expect(job?.status).toBe('completed')
    expect(job?.productKnowledge?.product_identity.model).toBe('EL084')
    expect(job?.productKnowledge?.specifications.material).toBe('Unknown')
    expect(job?.productKnowledge?.sources).toHaveLength(1)
    expect(job?.productKnowledge?.readiness.status).toBe('needs_review')
    expect(job?.productKnowledge?.readiness.downstream_allowed).toBe(false)
    expect(job?.commercePackage?.publication_status).toBe('review_required')
    expect(job?.commercePackage?.media_plan.assets.map(asset => asset.slot)).toEqual([
      'cover', 'feature_1', 'feature_2', 'feature_3',
    ])
    expect(Object.values(job?.commercePackage?.shopee.attributes ?? {})).not.toContain('Unknown')
    expect(job?.generatedAssets).toEqual([])
    expect(job?.events.map(event => event.stage)).toEqual(expect.arrayContaining([
      'build_knowledge', 'build_commerce_package', 'completed',
    ]))
    expect(job!.events.findIndex(event => event.stage === 'build_commerce_package'))
      .toBeGreaterThan(job!.events.findIndex(event => event.stage === 'build_knowledge'))
    expect(job?.events.at(-1)?.stage).toBe('completed')
    store.close()
  })
})
