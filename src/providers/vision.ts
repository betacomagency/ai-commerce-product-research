import type { LocalFileStorage } from '../infrastructure/file-storage.js'

export interface VisionProvider {
  readonly name: string
  analyzeImage(path: string, mimeType: string, signal?: AbortSignal): Promise<Record<string, string | string[]>>
}

export class GeminiVisionProvider implements VisionProvider {
  readonly name: string

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly storage: LocalFileStorage,
  ) {
    this.name = `gemini:${model}`
  }

  async analyzeImage(path: string, mimeType: string, signal?: AbortSignal): Promise<Record<string, string | string[]>> {
    const image = await this.storage.readBase64(path)
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [
          { text: 'Analyze this product image. Return JSON only with visible_product_type, visible_brand, visible_model, colors, visible_text, visible_features, packaging_claims. Use "Unknown" when not visible. Do not infer hidden properties such as material, weight, origin, ingredients, or performance.' },
          { inline_data: { mime_type: mimeType, data: image } },
        ] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      }),
      signal: signal ?? null,
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Gemini Vision lỗi ${response.status}: ${body.slice(0, 300)}`)
    }

    const payload = await response.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const text = payload.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) throw new Error('Gemini Vision không trả về kết quả.')
    return JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) as Record<string, string | string[]>
  }
}
