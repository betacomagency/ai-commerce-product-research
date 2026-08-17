import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildServer } from '../src/server.js'
import { loadConfig } from '../src/config.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('HTTP server', () => {
  it('reports health and provider capabilities without exposing secrets', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'commerce-server-'))
    tempDirs.push(directory)
    const { app } = await buildServer({
      ...loadConfig(),
      dataDir: directory,
      llmProvider: 'heuristic',
      deepseekApiKey: undefined,
      geminiApiKey: undefined,
      tavilyApiKey: undefined,
      tokenRouterApiKey: undefined,
      searchProvider: 'duckduckgo',
    })

    const health = await app.inject({ method: 'GET', url: '/api/health' })
    expect(health.statusCode).toBe(200)
    expect(health.json()).toMatchObject({ status: 'ok', providers: { llm: 'conservative-heuristic', search: 'duckduckgo-html' } })

    const config = await app.inject({ method: 'GET', url: '/api/config' })
    expect(config.json()).not.toHaveProperty('deepseekApiKey')
    expect(config.json()).not.toHaveProperty('tokenRouterApiKey')
    expect(config.json()).toMatchObject({ capabilities: { imageGenerationConfigured: false } })

    const missingJob = await app.inject({ method: 'POST', url: '/api/jobs/not-found/generate-images' })
    expect(missingJob.statusCode).toBe(404)

    const initial = await app.inject({ method: 'GET', url: '/api/sessions' })
    expect(initial.statusCode).toBe(200)
    expect(initial.json().sessions).toHaveLength(1)

    const created = await app.inject({
      method: 'POST', url: '/api/sessions',
      payload: { name: 'Summer campaign' },
    })
    expect(created.statusCode).toBe(201)
    const sessionId = created.json().id as string

    const renamed = await app.inject({
      method: 'PATCH', url: `/api/sessions/${sessionId}`,
      payload: { name: 'Autumn campaign' },
    })
    expect(renamed.json()).toMatchObject({ id: sessionId, name: 'Autumn campaign', jobCount: 0 })

    const jobs = await app.inject({ method: 'GET', url: `/api/jobs?sessionId=${sessionId}` })
    expect(jobs.json()).toEqual({ jobs: [] })
    await app.close()
  })
})
