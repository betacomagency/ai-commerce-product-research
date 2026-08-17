import * as cheerio from 'cheerio'
import type { SearchResult } from '../domain/schema.js'

export interface SearchProvider {
  readonly name: string
  search(query: string, limit: number, signal?: AbortSignal): Promise<SearchResult[]>
}

export class TavilySearchProvider implements SearchProvider {
  readonly name = 'tavily'

  constructor(private readonly apiKey: string) {}

  async search(query: string, limit: number, signal?: AbortSignal): Promise<SearchResult[]> {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: this.apiKey,
        query,
        topic: 'general',
        search_depth: 'advanced',
        max_results: limit,
        include_answer: false,
        include_raw_content: false,
      }),
      signal: signal ?? null,
    })
    if (!response.ok) throw new Error(`Tavily Search lỗi ${response.status}.`)
    const payload = await response.json() as {
      results?: Array<{ title?: string; url?: string; content?: string }>
    }
    return (payload.results ?? []).flatMap((result, index) => {
      if (!result.url) return []
      return [{
        title: result.title?.trim() || result.url,
        url: result.url,
        snippet: result.content?.trim() || '',
        rank: index + 1,
      }]
    })
  }
}

export class DuckDuckGoSearchProvider implements SearchProvider {
  readonly name = 'duckduckgo-html'

  async search(query: string, limit: number, signal?: AbortSignal): Promise<SearchResult[]> {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
    const response = await fetch(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; AIProductResearch/0.1; +local-mvp)',
        accept: 'text/html,application/xhtml+xml',
      },
      signal: signal ?? null,
    })
    if (!response.ok) throw new Error(`DuckDuckGo Search lỗi ${response.status}.`)
    const $ = cheerio.load(await response.text())
    const results: SearchResult[] = []

    $('.result').each((_index, element) => {
      if (results.length >= limit) return false
      const link = $(element).find('.result__a').first()
      const rawUrl = link.attr('href')
      if (!rawUrl) return
      const resolved = unwrapDuckDuckGoUrl(rawUrl)
      if (!resolved.startsWith('http')) return
      results.push({
        title: link.text().replace(/\s+/g, ' ').trim() || resolved,
        url: resolved,
        snippet: $(element).find('.result__snippet').text().replace(/\s+/g, ' ').trim(),
        rank: results.length + 1,
      })
    })

    return results
  }
}

export class BraveSearchProvider implements SearchProvider {
  readonly name = 'brave-search-html'

  async search(query: string, limit: number, signal?: AbortSignal): Promise<SearchResult[]> {
    const url = `https://search.brave.com/search?q=${encodeURIComponent(query)}&source=web`
    const response = await fetch(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36',
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'vi,en;q=0.8',
      },
      signal: signal ?? null,
    })
    if (!response.ok) throw new Error(`Brave Search lỗi ${response.status}.`)
    const $ = cheerio.load(await response.text())
    const results: SearchResult[] = []

    $('.snippet[data-type="web"]').each((_index, element) => {
      if (results.length >= limit) return false
      const container = $(element)
      const link = container.find('.result-content > a[href]').first()
      const rawUrl = link.attr('href')
      if (!rawUrl?.startsWith('http')) return
      const title = link.find('.search-snippet-title').first().text().replace(/\s+/g, ' ').trim()
      const snippet = container.find('.generic-snippet .content, .product-review .line-clamp-2').first().text().replace(/\s+/g, ' ').trim()
      results.push({
        title: title || link.attr('title')?.trim() || rawUrl,
        url: rawUrl,
        snippet,
        rank: results.length + 1,
      })
    })

    return results
  }
}

function unwrapDuckDuckGoUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl, 'https://duckduckgo.com')
    return url.searchParams.get('uddg') || url.href
  } catch {
    return rawUrl
  }
}
