import { resolve } from 'node:path'

function intFromEnv(name: string, fallback: number, min: number, max: number): number {
  const value = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

export interface AppConfig {
  host: string
  port: number
  appBaseUrl: string
  dataDir: string
  maxUploadBytes: number
  llmProvider: string
  deepseekApiKey: string | undefined
  deepseekBaseUrl: string
  deepseekModel: string
  geminiLlmModel: string
  visionProvider: string
  geminiApiKey: string | undefined
  geminiVisionModel: string
  searchProvider: string
  tavilyApiKey: string | undefined
  maxSearchQueries: number
  maxSources: number
  fetchTimeoutMs: number
  maxSourceChars: number
  jobRetryAttempts: number
  tokenRouterApiKey: string | undefined
  tokenRouterBaseUrl: string
  tokenRouterImageModel: string
  tokenRouterImageQuality: 'low' | 'medium' | 'high'
}

export function loadConfig(): AppConfig {
  const port = intFromEnv('PORT', 3000, 1, 65_535)
  const host = process.env.HOST?.trim() || '127.0.0.1'
  const optional = (name: string): string | undefined => process.env[name]?.trim() || undefined

  const imageQuality = process.env.TOKENROUTER_IMAGE_QUALITY?.trim()
  return {
    host,
    port,
    appBaseUrl: process.env.APP_BASE_URL?.trim() || `http://${host}:${port}`,
    dataDir: resolve(process.env.DATA_DIR?.trim() || './data'),
    maxUploadBytes: intFromEnv('MAX_UPLOAD_MB', 10, 1, 50) * 1024 * 1024,
    llmProvider: process.env.LLM_PROVIDER?.trim() || 'auto',
    deepseekApiKey: optional('DEEPSEEK_API_KEY'),
    deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL?.trim() || 'https://api.deepseek.com',
    deepseekModel: process.env.DEEPSEEK_MODEL?.trim() || 'deepseek-chat',
    geminiLlmModel: process.env.GEMINI_LLM_MODEL?.trim() || 'gemini-flash-lite-latest',
    visionProvider: process.env.VISION_PROVIDER?.trim() || 'auto',
    geminiApiKey: optional('GEMINI_API_KEY'),
    geminiVisionModel: process.env.GEMINI_VISION_MODEL?.trim() || 'gemini-2.5-flash',
    searchProvider: process.env.SEARCH_PROVIDER?.trim() || 'auto',
    tavilyApiKey: optional('TAVILY_API_KEY'),
    maxSearchQueries: intFromEnv('MAX_SEARCH_QUERIES', 7, 1, 10),
    maxSources: intFromEnv('MAX_SOURCES', 8, 1, 12),
    fetchTimeoutMs: intFromEnv('FETCH_TIMEOUT_MS', 12_000, 2_000, 30_000),
    maxSourceChars: intFromEnv('MAX_SOURCE_CHARS', 12_000, 2_000, 50_000),
    jobRetryAttempts: intFromEnv('JOB_RETRY_ATTEMPTS', 2, 0, 4),
    tokenRouterApiKey: optional('TOKENROUTER_API_KEY'),
    tokenRouterBaseUrl: process.env.TOKENROUTER_BASE_URL?.trim() || 'https://api.tokenrouter.com/v1',
    tokenRouterImageModel: process.env.TOKENROUTER_IMAGE_MODEL?.trim() || 'openai/gpt-5-image',
    tokenRouterImageQuality: imageQuality === 'low' || imageQuality === 'high' ? imageQuality : 'medium',
  }
}
