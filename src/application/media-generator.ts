import { randomUUID } from 'node:crypto'
import type { GeneratedAsset, ProductJob } from '../domain/schema.js'
import type { LocalFileStorage } from '../infrastructure/file-storage.js'
import type { JobStore } from '../infrastructure/job-store.js'
import { withRetry } from '../infrastructure/retry.js'
import type { ImageGenerationProvider } from '../providers/image-generation.js'

export class CommerceMediaGenerator {
  readonly #running = new Set<string>()

  constructor(
    private readonly store: JobStore,
    private readonly storage: LocalFileStorage,
    private readonly provider: ImageGenerationProvider,
    private readonly retryAttempts = 2,
  ) {}

  enqueue(jobId: string): void {
    if (this.#running.has(jobId)) return
    this.#running.add(jobId)
    setImmediate(() => void this.run(jobId).finally(() => this.#running.delete(jobId)))
  }

  async run(jobId: string): Promise<void> {
    const job = this.requireReadyJob(jobId)
    const assets: GeneratedAsset[] = []
    this.store.updateStatus(jobId, 'generating_media')
    this.store.addEvent(jobId, 'info', 'generate_media', `Đang tạo 4 ảnh Shopee bằng ${this.provider.name}...`)
    try {
      for (const [index, brief] of job.commercePackage!.media_plan.assets.entries()) {
        this.store.addEvent(jobId, 'info', 'generate_media', `Đang tạo ảnh ${index + 1}/4: ${brief.label}`)
        const buffer = await withRetry(
          () => this.provider.generate(
            brief.generation_prompt,
            job.input.imagePath && job.input.imageMimeType
              ? { path: job.input.imagePath, mimeType: job.input.imageMimeType }
              : null,
          ),
          { attempts: this.retryAttempts, baseDelayMs: 1_500 },
        )
        const id = randomUUID()
        const fileName = `${String(index + 1).padStart(2, '0')}-${brief.slot}.png`
        const path = await this.storage.saveGeneratedImage(jobId, fileName, buffer)
        assets.push({
          id,
          slot: brief.slot,
          label: brief.label,
          fileName,
          mimeType: 'image/png',
          path,
          url: `/api/jobs/${encodeURIComponent(jobId)}/assets/${encodeURIComponent(id)}`,
          model: this.provider.name,
          prompt: brief.generation_prompt,
          createdAt: new Date().toISOString(),
        })
        this.store.saveGeneratedAssets(jobId, assets)
        this.store.addEvent(jobId, 'info', 'generate_media', `Đã lưu ảnh ${index + 1}/4: ${brief.label}`)
      }
      this.store.updateStatus(jobId, 'completed')
      this.store.addEvent(jobId, 'info', 'generate_media_completed', 'Đã tạo xong 1 ảnh bìa và 3 ảnh mô tả sản phẩm.')
    } catch (error) {
      this.store.updateStatus(jobId, 'completed')
      this.store.addEvent(jobId, 'error', 'generate_media_failed', `Tạo ảnh dừng sau ${assets.length}/4 ảnh: ${errorMessage(error)}`)
    }
  }

  private requireReadyJob(jobId: string): ProductJob {
    const job = this.store.getJob(jobId)
    if (!job) throw new Error('Không tìm thấy Product Job.')
    if (!job.commercePackage) throw new Error('Job chưa có Commerce Package.')
    return job
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Lỗi không xác định.'
}
