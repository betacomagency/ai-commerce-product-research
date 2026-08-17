import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import OpenAI, { toFile } from 'openai'

export interface ImageGenerationProvider {
  readonly name: string
  generate(prompt: string, reference?: { path: string; mimeType: string } | null, signal?: AbortSignal): Promise<Buffer>
}

export class TokenRouterImageGenerationProvider implements ImageGenerationProvider {
  readonly name: string
  readonly #client: OpenAI

  constructor(
    apiKey: string,
    private readonly model = 'openai/gpt-5-image',
    private readonly quality: 'low' | 'medium' | 'high' = 'medium',
    baseURL = 'https://api.tokenrouter.com/v1',
  ) {
    this.name = `tokenrouter:${model}`
    this.#client = new OpenAI({ apiKey, baseURL })
  }

  async generate(prompt: string, reference?: { path: string; mimeType: string } | null, signal?: AbortSignal): Promise<Buffer> {
    const response = reference
      ? await this.#client.images.edit({
        model: this.model,
        image: await toFile(await readFile(reference.path), basename(reference.path), { type: reference.mimeType }),
        prompt,
        size: '1024x1024',
        quality: this.quality,
      }, { signal })
      : await this.#client.images.generate({
        model: this.model,
        prompt,
        size: '1024x1024',
        quality: this.quality,
      }, { signal })

    const image = response.data?.[0]
    if (image?.b64_json) return Buffer.from(image.b64_json, 'base64')
    if (image?.url) return downloadGeneratedImage(image.url, signal)
    throw new Error('TokenRouter Image API không trả về URL hoặc dữ liệu ảnh base64.')
  }
}

async function downloadGeneratedImage(value: string, signal?: AbortSignal): Promise<Buffer> {
  if (value.startsWith('data:image/')) {
    const encoded = value.split(',', 2)[1]
    if (!encoded) throw new Error('TokenRouter trả về data URL ảnh không hợp lệ.')
    return Buffer.from(encoded, 'base64')
  }

  const url = new URL(value)
  if (url.protocol !== 'https:') throw new Error('TokenRouter trả về URL ảnh không dùng HTTPS.')
  const timeoutSignal = AbortSignal.timeout(60_000)
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
  const response = await fetch(url, { redirect: 'follow', signal: combinedSignal })
  if (!response.ok) throw new Error(`Không tải được ảnh TokenRouter: HTTP ${response.status}.`)
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.startsWith('image/')) throw new Error('TokenRouter trả về URL không phải file ảnh.')
  const contentLength = Number(response.headers.get('content-length') ?? '0')
  if (contentLength > 25 * 1024 * 1024) throw new Error('Ảnh TokenRouter vượt quá giới hạn 25MB.')
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length > 25 * 1024 * 1024) throw new Error('Ảnh TokenRouter vượt quá giới hạn 25MB.')
  return buffer
}
