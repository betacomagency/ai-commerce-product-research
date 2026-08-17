import { isIP } from 'node:net'
import * as cheerio from 'cheerio'
import type { FetchedSource, ProductSource, SearchResult } from '../domain/schema.js'

const MAJOR_RETAILERS = [
  'amazon.', 'walmart.', 'target.', 'bestbuy.', 'guardian.', 'watsons.', 'sephora.', 'thegioididong.', 'dienmayxanh.',
]
const MARKETPLACES = ['shopee.', 'lazada.', 'tiki.', 'aliexpress.', 'ebay.']

export class SourceFetcher {
  constructor(
    private readonly timeoutMs: number,
    private readonly maxChars: number,
  ) {}

  async fetch(result: SearchResult, sourceId: string, brand: string): Promise<FetchedSource> {
    const parsed = validatePublicHttpUrl(result.url)
    const classification = classifySource(parsed.hostname, result.title, brand)
    const base: Omit<FetchedSource, 'content'> = {
      ...result,
      sourceId,
      domain: parsed.hostname.replace(/^www\./, ''),
      sourceType: classification.type,
      reliabilityScore: classification.reliability,
      fetchedAt: new Date().toISOString(),
    }

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
      try {
        const response = await fetchWithSafeRedirects(parsed, controller.signal)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const contentType = response.headers.get('content-type') ?? ''
        if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
          throw new Error(`Định dạng nguồn chưa hỗ trợ: ${contentType || 'unknown'}`)
        }
        const html = await response.text()
        const content = extractReadableText(html).slice(0, this.maxChars)
        if (content.length < 250) throw new Error('Không trích xuất được nội dung sản phẩm đủ dùng')
        return { ...base, content }
      } finally {
        clearTimeout(timeout)
      }
    } catch (error) {
      return {
        ...base,
        content: result.snippet.slice(0, this.maxChars),
        fetchError: error instanceof Error ? error.message : 'Không đọc được nguồn.',
      }
    }
  }
}

async function fetchWithSafeRedirects(initialUrl: URL, signal: AbortSignal): Promise<Response> {
  let current = initialUrl
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const response = await fetch(current, {
      redirect: 'manual',
      signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; AIProductResearch/0.1; +local-mvp)',
        accept: 'text/html,text/plain;q=0.9',
      },
    })
    if (![301, 302, 303, 307, 308].includes(response.status)) return response
    const location = response.headers.get('location')
    if (!location) return response
    current = validatePublicHttpUrl(new URL(location, current).href)
  }
  throw new Error('Nguồn chuyển hướng quá nhiều lần.')
}

function validatePublicHttpUrl(raw: string): URL {
  const url = new URL(raw)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Chỉ hỗ trợ nguồn HTTP/HTTPS.')
  const hostname = url.hostname.toLowerCase()
  if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error('Không cho phép truy cập địa chỉ nội bộ.')
  }
  if (isIP(hostname) && isPrivateIp(hostname)) throw new Error('Không cho phép truy cập IP nội bộ.')
  return url
}

function isPrivateIp(ip: string): boolean {
  return ip === '::1'
    || ip.startsWith('fc')
    || ip.startsWith('fd')
    || ip.startsWith('fe80:')
    || ip.startsWith('10.')
    || ip.startsWith('127.')
    || ip.startsWith('169.254.')
    || ip.startsWith('192.168.')
    || /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
}

function extractReadableText(html: string): string {
  const $ = cheerio.load(html)
  $('script, style, noscript, svg, nav, footer, header, form').remove()
  return $('main, article, body').first().text().replace(/\s+/g, ' ').trim()
}

function classifySource(domain: string, title: string, brand: string): { type: ProductSource['source_type']; reliability: number } {
  const host = domain.toLowerCase()
  const haystack = `${host} ${title}`.toLowerCase()
  const brandToken = brand.toLowerCase().replace(/[^a-z0-9]/g, '')
  const normalizedHost = host.replace(/[^a-z0-9]/g, '')

  const domainLabels = host.split('.').map(label => label.replace(/[^a-z0-9]/g, ''))
  if (brandToken.length >= 3 && domainLabels.includes(brandToken)) return { type: 'official_brand', reliability: 0.95 }
  if (MARKETPLACES.some(value => host.includes(value))) {
    if (/official|chính hãng|mall/.test(haystack)) return { type: 'official_marketplace', reliability: 0.85 }
    return { type: 'marketplace_listing', reliability: 0.55 }
  }
  if (/catalog|catalogue|datasheet|manual|specification/.test(haystack)) return { type: 'official_document', reliability: 0.88 }
  if (MAJOR_RETAILERS.some(value => host.includes(value))) return { type: 'major_retailer', reliability: 0.72 }
  return { type: 'other', reliability: 0.45 }
}
