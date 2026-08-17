import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { productInputSchema } from '../src/domain/schema.js'
import { JobStore } from '../src/infrastructure/job-store.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('JobStore', () => {
  it('persists jobs and action logs across reopen', () => {
    const directory = mkdtempSync(join(tmpdir(), 'commerce-store-'))
    tempDirs.push(directory)
    const databasePath = join(directory, 'commerce.sqlite')
    const input = productInputSchema.parse({ productName: 'Test Model 100' })

    const first = new JobStore(databasePath)
    const session = first.createSession('Footwear research', 'session-1')
    first.createJob('job-1', input, session.id)
    first.updateStatus('job-1', 'researching')
    first.addEvent('job-1', 'info', 'search_web', 'Searching...')
    first.close()

    const second = new JobStore(databasePath)
    const restored = second.getJob('job-1')
    expect(restored?.input.productName).toBe('Test Model 100')
    expect(restored?.status).toBe('researching')
    expect(restored?.sessionId).toBe('session-1')
    expect(restored?.events.map(event => event.stage)).toEqual(['created', 'search_web'])
    expect(second.listSessions()).toMatchObject([{ id: 'session-1', name: 'Footwear research', jobCount: 1 }])
    expect(second.listJobs(30, 'another-session')).toEqual([])
    second.close()
  })

  it('moves jobs from the old schema into Previous work', () => {
    const directory = mkdtempSync(join(tmpdir(), 'commerce-migration-'))
    tempDirs.push(directory)
    const databasePath = join(directory, 'commerce.sqlite')
    const legacy = new DatabaseSync(databasePath)
    legacy.exec(`
      CREATE TABLE product_jobs (
        id TEXT PRIMARY KEY, status TEXT NOT NULL, input_json TEXT NOT NULL,
        research_json TEXT, product_knowledge_json TEXT, error_message TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT
      );
    `)
    const now = new Date().toISOString()
    legacy.prepare(`
      INSERT INTO product_jobs(id, status, input_json, created_at, updated_at)
      VALUES ('legacy-job', 'created', ?, ?, ?)
    `).run(JSON.stringify(productInputSchema.parse({ productName: 'Legacy product' })), now, now)
    legacy.close()

    const migrated = new JobStore(databasePath)
    expect(migrated.getJob('legacy-job')?.sessionId).toBe('previous-work')
    expect(migrated.listSessions()).toMatchObject([{ id: 'previous-work', name: 'Previous work', jobCount: 1 }])
    migrated.close()
  })
})
