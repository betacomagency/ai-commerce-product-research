import { analyzeProductInput, generateSearchQueries } from './input-analysis.js'
import { buildCommercePackage } from './commerce-package.js'
import { buildProductKnowledge } from './synthesizer.js'
import { UNKNOWN, type FetchedSource, type ProductJob, type SearchResult } from '../domain/schema.js'
import type { JobStore } from '../infrastructure/job-store.js'
import { withRetry } from '../infrastructure/retry.js'
import type { LlmProvider } from '../providers/llm.js'
import type { SearchProvider } from '../providers/search.js'
import type { VisionProvider } from '../providers/vision.js'

export interface ProductSourceFetcher {
  fetch(result: SearchResult, sourceId: string, brand: string): Promise<FetchedSource>
}

export interface ResearchHarnessOptions {
  maxSearchQueries: number
  maxSources: number
  retryAttempts: number
}

export class CommerceResearchHarness {
  readonly #running = new Set<string>()

  constructor(
    private readonly store: JobStore,
    private readonly search: SearchProvider,
    private readonly fetcher: ProductSourceFetcher,
    private readonly llm: LlmProvider | null,
    private readonly vision: VisionProvider | null,
    private readonly options: ResearchHarnessOptions,
  ) {}

  enqueue(jobId: string): void {
    if (this.#running.has(jobId)) return
    this.#running.add(jobId)
    setImmediate(() => {
      void this.run(jobId).finally(() => this.#running.delete(jobId))
    })
  }

  async run(jobId: string): Promise<void> {
    const job = this.requireJob(jobId)
    try {
      this.transition(jobId, 'analyzing', 'analyze_input', 'Đang phân tích input sản phẩm...')
      let imageObservations: Record<string, string | string[]> = {}
      if (job.input.imagePath) {
        if (this.vision && job.input.imageMimeType) {
          this.log(jobId, 'info', 'analyze_image', 'Đang phân tích ảnh bằng Vision Model...')
          try {
            imageObservations = await withRetry(
              () => this.vision!.analyzeImage(job.input.imagePath!, job.input.imageMimeType!),
              { attempts: this.options.retryAttempts },
            )
          } catch (error) {
            this.log(jobId, 'warning', 'analyze_image', `Vision lỗi; tiếp tục bằng input còn lại: ${errorMessage(error)}`)
          }
        } else {
          this.log(jobId, 'warning', 'analyze_image', 'Có ảnh nhưng chưa cấu hình GEMINI_API_KEY; không suy đoán nội dung ảnh.')
        }
      }

      const analysis = analyzeProductInput(job.input, imageObservations)
      if (analysis.normalizedName === UNKNOWN && Object.keys(imageObservations).length === 0) {
        this.store.updateStatus(jobId, 'needs_input', 'Không nhận diện được sản phẩm. Vui lòng thêm tên hoặc mô tả.')
        this.log(jobId, 'warning', 'needs_input', 'Cần thêm tên hoặc mô tả để research chính xác.')
        return
      }

      this.transition(jobId, 'researching', 'generate_queries', 'Đang tạo search queries...')
      const queries = generateSearchQueries(analysis, this.options.maxSearchQueries)
      this.log(jobId, 'info', 'generate_queries', `Đã tạo ${queries.length} search queries.`)
      const searchResults = await this.searchAll(jobId, queries)
      const selected = selectDiverseResults(
        rankResults(deduplicateResults(searchResults), analysis),
        this.options.maxSources,
      )
      const sources: FetchedSource[] = []
      for (const [index, result] of selected.entries()) {
        this.log(jobId, 'info', 'fetch_source', `Đang đọc nguồn ${index + 1}/${selected.length}: ${safeTitle(result.title)}`)
        const source = await this.fetcher.fetch(result, `src_${index + 1}`, analysis.likelyBrand)
        sources.push(source)
        if (source.fetchError) {
          this.log(jobId, 'warning', 'fetch_source', `Nguồn ${index + 1} chỉ dùng snippet (${source.domain}): ${source.fetchError}`)
        } else {
          this.log(jobId, 'info', 'fetch_source', `Đã đọc nguồn ${index + 1}: ${source.domain} · ${source.content.length} ký tự.`)
        }
      }
      this.log(jobId, 'info', 'cross_check', `Đang đối chiếu ${sources.length} nguồn...`)

      this.store.saveResearch(jobId, {
        analysis,
        searchQueries: queries,
        sources,
        providerInfo: {
          llm: this.llm?.name ?? 'conservative-heuristic',
          vision: this.vision?.name ?? 'not-configured',
          search: this.search.name,
        },
      })

      this.transition(jobId, 'synthesizing', 'build_knowledge', 'Đang xây dựng Product Knowledge...')
      const knowledge = await buildProductKnowledge({
        input: job.input,
        analysis,
        sources,
        llm: this.llm,
        retryAttempts: this.options.retryAttempts,
      })
      this.store.saveProductKnowledge(jobId, knowledge)
      this.transition(jobId, 'contenting', 'build_commerce_package', 'Đang tạo tiêu đề, mô tả, thuộc tính Shopee và kế hoạch truyền thông...')
      const commercePackage = await buildCommercePackage({
        knowledge,
        llm: this.llm,
        retryAttempts: this.options.retryAttempts,
      })
      this.store.saveCommercePackage(jobId, commercePackage)
      this.store.updateStatus(jobId, 'completed')
      this.log(jobId, 'info', 'completed', 'Workflow hoàn tất. Product Knowledge và Commerce Package đã được lưu.')
    } catch (error) {
      const message = errorMessage(error)
      this.store.updateStatus(jobId, 'failed', message)
      this.log(jobId, 'error', 'failed', `Research thất bại: ${message}`)
    }
  }

  private async searchAll(jobId: string, queries: string[]): Promise<SearchResult[]> {
    const all: SearchResult[] = []
    for (const [index, query] of queries.entries()) {
      this.log(jobId, 'info', 'search_web', `Đang search ${index + 1}/${queries.length}: ${query}`)
      try {
        const results = await withRetry(
          () => this.search.search(query, Math.max(3, this.options.maxSources)),
          { attempts: this.options.retryAttempts },
        )
        this.log(jobId, 'info', 'search_web', `Tìm thấy ${results.length} kết quả cho query ${index + 1}.`)
        all.push(...results)
      } catch (error) {
        this.log(jobId, 'warning', 'search_web', `Search query lỗi; tiếp tục query khác: ${errorMessage(error)}`)
      }
    }
    if (all.length === 0) this.log(jobId, 'warning', 'search_web', 'Không tìm thấy kết quả web. Sẽ tạo bản Product Knowledge thận trọng từ input.')
    return all
  }

  private requireJob(jobId: string): ProductJob {
    const job = this.store.getJob(jobId)
    if (!job) throw new Error(`Không tìm thấy job ${jobId}.`)
    return job
  }

  private transition(jobId: string, status: 'analyzing' | 'researching' | 'synthesizing' | 'contenting', stage: string, message: string): void {
    this.store.updateStatus(jobId, status)
    this.log(jobId, 'info', stage, message)
  }

  private log(jobId: string, level: 'info' | 'warning' | 'error', stage: string, message: string): void {
    this.store.addEvent(jobId, level, stage, message)
  }
}

function deduplicateResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>()
  return results.filter(result => {
    try {
      const url = new URL(result.url)
      url.hash = ''
      const key = url.href.replace(/\/$/, '')
      if (seen.has(key)) return false
      seen.add(key)
      return true
    } catch {
      return false
    }
  })
}

function rankResults(results: SearchResult[], analysis: { likelyBrand: string; likelyModel: string; normalizedName: string }): SearchResult[] {
  const brand = analysis.likelyBrand === UNKNOWN ? '' : normalize(analysis.likelyBrand)
  const model = analysis.likelyModel === UNKNOWN ? '' : normalize(analysis.likelyModel)
  const identityTokens = normalize(analysis.normalizedName).split(' ').filter(token => token.length >= 2)

  const scored = results.map((result, index) => {
    const text = normalize(`${result.title} ${result.url} ${result.snippet}`)
    let score = -index * 0.01
    if (model && text.includes(model)) score += 12
    if (brand && text.includes(brand)) score += 4
    score += identityTokens.filter(token => text.includes(token)).length
    const host = safeHostname(result.url)
    if (brand && normalize(host).includes(brand)) score += 5
    if (/official|chính hãng|mall|manual|datasheet|specification|thông số/.test(text)) score += 2
    if (/shopee|lazada|tiki|tripmap|youtube|facebook/.test(host)) score -= 1.5
    return { result, score, exactModel: Boolean(model && text.includes(model)) }
  })

  const exactMatches = scored.filter(item => item.exactModel)
  const pool = exactMatches.length >= 2 ? exactMatches : scored
  return pool.sort((a, b) => b.score - a.score).map(item => item.result)
}

function selectDiverseResults(results: SearchResult[], limit: number): SearchResult[] {
  const selected: SearchResult[] = []
  const domainCounts = new Map<string, number>()
  for (const result of results) {
    const domain = safeHostname(result.url)
    if (!domain || (domainCounts.get(domain) ?? 0) >= 2) continue
    selected.push(result)
    domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1)
    if (selected.length >= limit) break
  }
  if (selected.length < limit) {
    for (const result of results) {
      if (selected.includes(result)) continue
      selected.push(result)
      if (selected.length >= limit) break
    }
  }
  return selected
}

function safeHostname(value: string): string {
  try { return new URL(value).hostname.replace(/^www\./, '').toLowerCase() } catch { return '' }
}

function normalize(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function safeTitle(value: string): string {
  return value.replace(/\s+/g, ' ').slice(0, 90)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Lỗi không xác định.'
}
