export interface LlmProvider {
  readonly name: string
  generateJson<T>(systemPrompt: string, userPrompt: string, signal?: AbortSignal, jsonSchema?: unknown): Promise<T>
}

function parseJsonResponse<T>(text: string): T {
  const cleaned = text.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  return JSON.parse(cleaned) as T
}

export class DeepSeekLlmProvider implements LlmProvider {
  readonly name: string

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly model: string,
  ) {
    this.name = `deepseek:${model}`
  }

  async generateJson<T>(systemPrompt: string, userPrompt: string, signal?: AbortSignal, _jsonSchema?: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: signal ?? null,
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`DeepSeek API lỗi ${response.status}: ${body.slice(0, 300)}`)
    }

    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = payload.choices?.[0]?.message?.content
    if (!content) throw new Error('DeepSeek không trả về nội dung JSON.')
    return parseJsonResponse<T>(content)
  }
}

export class GeminiLlmProvider implements LlmProvider {
  readonly name: string

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {
    this.name = `gemini:${model}`
  }

  async generateJson<T>(systemPrompt: string, userPrompt: string, signal?: AbortSignal, jsonSchema?: unknown): Promise<T> {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': this.apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${systemPrompt}\n\nINPUT DATA:\n${userPrompt}` }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
          ...(jsonSchema ? { responseJsonSchema: jsonSchema } : {}),
        },
      }),
      signal: signal ?? null,
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Gemini LLM lỗi ${response.status}: ${body.slice(0, 300)}`)
    }

    const payload = await response.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const content = payload.candidates?.[0]?.content?.parts?.[0]?.text
    if (!content) throw new Error('Gemini LLM không trả về nội dung JSON.')
    return parseJsonResponse<T>(content)
  }
}
