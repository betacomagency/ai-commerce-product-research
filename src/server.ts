import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import { CommerceResearchHarness } from './application/research-harness.js'
import { buildCommercePackage } from './application/commerce-package.js'
import { CommerceMediaGenerator } from './application/media-generator.js'
import { loadConfig, type AppConfig } from './config.js'
import { productInputSchema, type ProductInput } from './domain/schema.js'
import { LocalFileStorage } from './infrastructure/file-storage.js'
import { JobStore } from './infrastructure/job-store.js'
import { DeepSeekLlmProvider, GeminiLlmProvider, type LlmProvider } from './providers/llm.js'
import { BraveSearchProvider, DuckDuckGoSearchProvider, TavilySearchProvider, type SearchProvider } from './providers/search.js'
import { SourceFetcher } from './providers/source-fetcher.js'
import { GeminiVisionProvider, type VisionProvider } from './providers/vision.js'
import { TokenRouterImageGenerationProvider } from './providers/image-generation.js'

export interface AppServices {
  config: AppConfig
  store: JobStore
  storage: LocalFileStorage
  harness: CommerceResearchHarness
  llm: LlmProvider | null
  mediaGenerator: CommerceMediaGenerator | null
  providerNames: { llm: string; vision: string; search: string; image: string }
}

export async function buildServer(config = loadConfig()): Promise<{ app: FastifyInstance; services: AppServices }> {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL || 'info' }, bodyLimit: config.maxUploadBytes + 1_000_000 })
  const store = new JobStore(join(config.dataDir, 'commerce.sqlite'))
  const storage = new LocalFileStorage(config.dataDir)
  const search = createSearchProvider(config)
  const llm = createLlmProvider(config)
  const vision = createVisionProvider(config, storage)
  const harness = new CommerceResearchHarness(
    store,
    search,
    new SourceFetcher(config.fetchTimeoutMs, config.maxSourceChars),
    llm,
    vision,
    { maxSearchQueries: config.maxSearchQueries, maxSources: config.maxSources, retryAttempts: config.jobRetryAttempts + 1 },
  )
  const imageProvider = config.tokenRouterApiKey
    ? new TokenRouterImageGenerationProvider(
      config.tokenRouterApiKey,
      config.tokenRouterImageModel,
      config.tokenRouterImageQuality,
      config.tokenRouterBaseUrl,
    )
    : null
  const mediaGenerator = imageProvider
    ? new CommerceMediaGenerator(store, storage, imageProvider, config.jobRetryAttempts + 1)
    : null
  const services: AppServices = {
    config,
    store,
    storage,
    harness,
    llm,
    mediaGenerator,
    providerNames: {
      llm: llm?.name ?? 'conservative-heuristic',
      vision: vision?.name ?? 'not-configured',
      search: search.name,
      image: imageProvider?.name ?? 'not-configured',
    },
  }

  const recovered = store.recoverInterruptedJobs()
  if (recovered > 0) app.log.warn({ recovered }, 'Marked interrupted research jobs as failed')

  await app.register(multipart, {
    limits: { fileSize: config.maxUploadBytes, files: 1, fields: 10 },
  })
  await app.register(fastifyStatic, {
    root: join(process.cwd(), 'public'),
    prefix: '/',
  })

  registerApiRoutes(app, services)
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) return reply.code(404).send({ error: 'API endpoint không tồn tại.' })
    return reply.sendFile('index.html')
  })
  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error)
    const candidate = error as { statusCode?: unknown; message?: unknown }
    const status = typeof candidate.statusCode === 'number' ? candidate.statusCode : 500
    const message = typeof candidate.message === 'string' ? candidate.message : 'Yêu cầu không hợp lệ.'
    return reply.code(status).send({ error: status >= 500 ? 'Server gặp lỗi. Vui lòng thử lại.' : message })
  })
  app.addHook('onClose', async () => store.close())

  return { app, services }
}

function registerApiRoutes(app: FastifyInstance, services: AppServices): void {
  app.get('/api/health', async () => ({ status: 'ok', providers: services.providerNames }))
  app.get('/api/config', async () => ({
    providers: services.providerNames,
    capabilities: {
      llmConfigured: services.providerNames.llm !== 'conservative-heuristic',
      visionConfigured: services.providerNames.vision !== 'not-configured',
      imageGenerationConfigured: services.providerNames.image !== 'not-configured',
      keylessSearch: ['brave-search-html', 'duckduckgo-html'].includes(services.providerNames.search),
    },
    maxUploadMb: Math.round(services.config.maxUploadBytes / 1024 / 1024),
  }))

  app.get('/api/sessions', async () => {
    if (services.store.listSessions().length === 0) services.store.createSession('My research')
    return { sessions: services.store.listSessions() }
  })

  app.post('/api/sessions', async (request, reply) => {
    const body = (request.body ?? {}) as { name?: unknown }
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (name.length > 100) return reply.code(400).send({ error: 'Tên session tối đa 100 ký tự.' })
    const session = services.store.createSession(name || 'New session')
    return reply.code(201).send(session)
  })

  app.patch('/api/sessions/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = (request.body ?? {}) as { name?: unknown }
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name || name.length > 100) return reply.code(400).send({ error: 'Tên session phải có từ 1 đến 100 ký tự.' })
    const session = services.store.renameSession(id, name)
    return session ?? reply.code(404).send({ error: 'Không tìm thấy session.' })
  })

  app.get('/api/jobs', async request => {
    const query = request.query as { limit?: string; sessionId?: string }
    const limit = Number.parseInt(query.limit ?? '30', 10)
    return { jobs: services.store.listJobs(Number.isFinite(limit) ? limit : 30, query.sessionId) }
  })

  app.get('/api/jobs/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const job = services.store.getJob(id)
    return job ?? reply.code(404).send({ error: 'Không tìm thấy Product Job.' })
  })

  app.post('/api/jobs', async (request, reply) => {
    if (!request.isMultipart()) return reply.code(415).send({ error: 'Yêu cầu phải dùng multipart/form-data.' })
    const jobId = randomUUID()
    const fields: Record<string, string> = {}
    let image: { buffer: Buffer; filename: string; mimetype: string } | null = null
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (!part.mimetype.startsWith('image/')) return reply.code(400).send({ error: 'File upload phải là ảnh.' })
        image = { buffer: await part.toBuffer(), filename: part.filename, mimetype: part.mimetype }
      } else {
        fields[part.fieldname] = String(part.value ?? '')
      }
    }

    let storedImage = null
    if (image) storedImage = await services.storage.saveProductImage(jobId, image.filename, image.mimetype, image.buffer)
    const input = productInputSchema.safeParse({
      productName: fields.productName ?? '',
      additionalInfo: fields.additionalInfo ?? '',
      imagePath: storedImage?.path ?? null,
      imageMimeType: storedImage?.mimeType ?? null,
      originalImageName: storedImage?.originalName ?? null,
    })
    if (!input.success) return reply.code(400).send({ error: input.error.issues[0]?.message ?? 'Input không hợp lệ.' })

    if (fields.sessionId && !services.store.getSession(fields.sessionId)) {
      return reply.code(400).send({ error: 'Research session không tồn tại.' })
    }
    const job = services.store.createJob(jobId, input.data, fields.sessionId || undefined)
    services.harness.enqueue(jobId)
    return reply.code(202).send(job)
  })

  app.post('/api/harness/jobs', async (request, reply) => {
    const body = (request.body ?? {}) as Partial<ProductInput> & { sessionId?: string }
    const input = productInputSchema.safeParse({
      productName: body.productName ?? '',
      additionalInfo: body.additionalInfo ?? '',
      imagePath: null,
      imageMimeType: null,
      originalImageName: null,
    })
    if (!input.success) return reply.code(400).send({ error: input.error.issues[0]?.message ?? 'Input không hợp lệ.' })
    const jobId = randomUUID()
    if (body.sessionId && !services.store.getSession(body.sessionId)) {
      return reply.code(400).send({ error: 'Research session không tồn tại.' })
    }
    const job = services.store.createJob(jobId, input.data, body.sessionId)
    services.harness.enqueue(jobId)
    return reply.code(202).send(job)
  })

  app.post('/api/jobs/:id/research-again', async (request, reply) => {
    const { id } = request.params as { id: string }
    const previous = services.store.getJob(id)
    if (!previous) return reply.code(404).send({ error: 'Không tìm thấy Product Job.' })
    const jobId = randomUUID()
    const job = services.store.createJob(jobId, previous.input, previous.sessionId)
    services.harness.enqueue(jobId)
    return reply.code(202).send(job)
  })

  app.post('/api/jobs/:id/commerce-package', async (request, reply) => {
    const { id } = request.params as { id: string }
    const job = services.store.getJob(id)
    if (!job) return reply.code(404).send({ error: 'Không tìm thấy Product Job.' })
    if (!job.productKnowledge) return reply.code(409).send({ error: 'Research chưa hoàn tất nên chưa thể tạo Commerce Package.' })
    services.store.updateStatus(id, 'contenting')
    services.store.addEvent(id, 'info', 'build_commerce_package', 'Đang tạo lại nội dung Shopee và kế hoạch truyền thông...')
    try {
      const value = await buildCommercePackage({
        knowledge: job.productKnowledge,
        llm: services.llm,
        retryAttempts: services.config.jobRetryAttempts + 1,
      })
      services.store.saveCommercePackage(id, value)
      services.store.updateStatus(id, 'completed')
      services.store.addEvent(id, 'info', 'build_commerce_package', 'Đã lưu Commerce Package.')
      return reply.send(services.store.getJob(id))
    } catch (error) {
      services.store.updateStatus(id, 'completed')
      return reply.code(500).send({ error: error instanceof Error ? error.message : 'Không tạo được Commerce Package.' })
    }
  })

  app.post('/api/jobs/:id/generate-images', async (request, reply) => {
    const { id } = request.params as { id: string }
    const job = services.store.getJob(id)
    if (!job) return reply.code(404).send({ error: 'Không tìm thấy Product Job.' })
    if (!job.commercePackage) return reply.code(409).send({ error: 'Hãy tạo Commerce Package trước khi tạo ảnh.' })
    if (!services.mediaGenerator) return reply.code(503).send({ error: 'Chưa cấu hình TOKENROUTER_API_KEY cho Image API.' })
    services.mediaGenerator.enqueue(id)
    return reply.code(202).send(job)
  })

  app.get('/api/jobs/:id/assets/:assetId', async (request, reply) => {
    const { id, assetId } = request.params as { id: string; assetId: string }
    const job = services.store.getJob(id)
    const asset = job?.generatedAssets.find(item => item.id === assetId)
    if (!asset) return reply.code(404).send({ error: 'Không tìm thấy ảnh đã tạo.' })
    const buffer = await services.storage.read(asset.path)
    return reply.type(asset.mimeType).header('cache-control', 'private, max-age=3600').send(buffer)
  })
}

function createLlmProvider(config: AppConfig): LlmProvider | null {
  if (config.llmProvider === 'heuristic') return null
  if (config.llmProvider === 'deepseek' && !config.deepseekApiKey) throw new Error('LLM_PROVIDER=deepseek yêu cầu DEEPSEEK_API_KEY.')
  if (config.llmProvider === 'gemini' && !config.geminiApiKey) throw new Error('LLM_PROVIDER=gemini yêu cầu GEMINI_API_KEY.')
  if (config.llmProvider === 'deepseek' || (config.llmProvider === 'auto' && config.deepseekApiKey)) {
    return config.deepseekApiKey
      ? new DeepSeekLlmProvider(config.deepseekApiKey, config.deepseekBaseUrl, config.deepseekModel)
      : null
  }
  return config.geminiApiKey ? new GeminiLlmProvider(config.geminiApiKey, config.geminiLlmModel) : null
}

function createVisionProvider(config: AppConfig, storage: LocalFileStorage): VisionProvider | null {
  if (config.visionProvider === 'none') return null
  if (config.visionProvider === 'gemini' && !config.geminiApiKey) throw new Error('VISION_PROVIDER=gemini yêu cầu GEMINI_API_KEY.')
  return config.geminiApiKey ? new GeminiVisionProvider(config.geminiApiKey, config.geminiVisionModel, storage) : null
}

function createSearchProvider(config: AppConfig): SearchProvider {
  if (config.searchProvider === 'tavily' && !config.tavilyApiKey) throw new Error('SEARCH_PROVIDER=tavily yêu cầu TAVILY_API_KEY.')
  if (config.searchProvider === 'duckduckgo') return new DuckDuckGoSearchProvider()
  if (config.searchProvider === 'brave') return new BraveSearchProvider()
  return config.tavilyApiKey ? new TavilySearchProvider(config.tavilyApiKey) : new BraveSearchProvider()
}

const isMain = process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]
if (isMain) {
  const config = loadConfig()
  const { app } = await buildServer(config)
  await app.listen({ host: config.host, port: config.port })
}
