import { afterEach, describe, expect, it, vi } from 'vitest'
import { SourceFetcher } from '../src/providers/source-fetcher.js'

afterEach(() => vi.unstubAllGlobals())

describe('SourceFetcher trust classification', () => {
  it('does not mark a domain official merely because it contains the brand name', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(`<html><main>${'Detailed product information. '.repeat(30)}</main></html>`, {
      status: 200, headers: { 'content-type': 'text/html' },
    })))
    const fetcher = new SourceFetcher(2_000, 5_000)
    const reseller = await fetcher.fetch({ title: 'Imou A52P', url: 'https://imouhome.vn/a52p', snippet: '', rank: 1 }, 'src_1', 'Imou')
    const official = await fetcher.fetch({ title: 'Imou products', url: 'https://store.imou.com/products', snippet: '', rank: 2 }, 'src_2', 'Imou')

    expect(reseller.sourceType).toBe('other')
    expect(official.sourceType).toBe('official_brand')
  })

  it('falls back to the search snippet when readable page content is empty', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html><body></body></html>', {
      status: 200, headers: { 'content-type': 'text/html' },
    })))
    const fetcher = new SourceFetcher(2_000, 5_000)
    const source = await fetcher.fetch({ title: 'Listing', url: 'https://shop.example/item', snippet: 'Useful search snippet', rank: 1 }, 'src_1', 'Brand')
    expect(source.content).toBe('Useful search snippet')
    expect(source.fetchError).toMatch(/không trích xuất/i)
  })
})
