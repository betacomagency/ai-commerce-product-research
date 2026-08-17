import { mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  commercePackageSchema,
  generatedAssetSchema,
  jobStatusSchema,
  productInputSchema,
  productKnowledgeSchema,
  type CommercePackage,
  type GeneratedAsset,
  type JobStatus,
  type ProductInput,
  type ProductJob,
  type ProductKnowledge,
  type ProgressEvent,
  type ResearchSession,
  type ResearchSnapshot,
} from '../domain/schema.js'

interface JobRow {
  id: string
  session_id: string
  status: string
  input_json: string
  research_json: string | null
  product_knowledge_json: string | null
  commerce_package_json: string | null
  generated_assets_json: string | null
  error_message: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
}

interface SessionRow {
  id: string
  name: string
  created_at: string
  updated_at: string
  job_count?: number
  activity_at?: string
}

interface EventRow {
  id: number
  job_id: string
  level: string
  stage: string
  message: string
  created_at: string
}

export class JobStore {
  readonly #db: DatabaseSync

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true })
    this.#db = new DatabaseSync(databasePath)
    this.#db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
    this.migrate()
  }

  migrate(): void {
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS research_sessions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS product_jobs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        input_json TEXT NOT NULL,
        research_json TEXT,
        product_knowledge_json TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS progress_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL REFERENCES product_jobs(id) ON DELETE CASCADE,
        level TEXT NOT NULL,
        stage TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_product_jobs_updated_at ON product_jobs(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_progress_events_job_id ON progress_events(job_id, id);

      INSERT OR IGNORE INTO schema_migrations(version, applied_at)
      VALUES (1, datetime('now'));
    `)

    const columns = this.#db.prepare('PRAGMA table_info(product_jobs)').all() as unknown as Array<{ name: string }>
    if (!columns.some(column => column.name === 'session_id')) {
      this.#db.exec('ALTER TABLE product_jobs ADD COLUMN session_id TEXT REFERENCES research_sessions(id);')
    }
    if (!columns.some(column => column.name === 'commerce_package_json')) {
      this.#db.exec('ALTER TABLE product_jobs ADD COLUMN commerce_package_json TEXT;')
    }
    if (!columns.some(column => column.name === 'generated_assets_json')) {
      this.#db.exec("ALTER TABLE product_jobs ADD COLUMN generated_assets_json TEXT NOT NULL DEFAULT '[]';")
    }

    const orphaned = this.#db.prepare('SELECT COUNT(*) AS count FROM product_jobs WHERE session_id IS NULL')
      .get() as { count: number }
    if (Number(orphaned.count) > 0) {
      const now = new Date().toISOString()
      this.#db.prepare(`
        INSERT OR IGNORE INTO research_sessions(id, name, created_at, updated_at)
        VALUES ('previous-work', 'Previous work', ?, ?)
      `).run(now, now)
      this.#db.prepare(`UPDATE product_jobs SET session_id = 'previous-work' WHERE session_id IS NULL`).run()
    }

    this.#db.exec(`
      CREATE INDEX IF NOT EXISTS idx_product_jobs_session_updated
      ON product_jobs(session_id, updated_at DESC);

      INSERT OR IGNORE INTO schema_migrations(version, applied_at)
      VALUES (2, datetime('now'));

      INSERT OR IGNORE INTO schema_migrations(version, applied_at)
      VALUES (3, datetime('now'));
    `)
  }

  createSession(name = 'New session', id: string = randomUUID()): ResearchSession {
    const cleanName = name.trim() || 'New session'
    const now = new Date().toISOString()
    this.#db.prepare(`
      INSERT INTO research_sessions(id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(id, cleanName, now, now)
    return this.getSession(id) as ResearchSession
  }

  getSession(id: string): ResearchSession | null {
    const row = this.#db.prepare(`
      SELECT s.*, COUNT(j.id) AS job_count,
             CASE WHEN MAX(j.updated_at) IS NULL OR s.updated_at > MAX(j.updated_at)
               THEN s.updated_at ELSE MAX(j.updated_at) END AS activity_at
      FROM research_sessions s
      LEFT JOIN product_jobs j ON j.session_id = s.id
      WHERE s.id = ?
      GROUP BY s.id
    `).get(id) as SessionRow | undefined
    return row ? this.mapSession(row) : null
  }

  listSessions(): ResearchSession[] {
    const rows = this.#db.prepare(`
      SELECT s.*, COUNT(j.id) AS job_count,
             CASE WHEN MAX(j.updated_at) IS NULL OR s.updated_at > MAX(j.updated_at)
               THEN s.updated_at ELSE MAX(j.updated_at) END AS activity_at
      FROM research_sessions s
      LEFT JOIN product_jobs j ON j.session_id = s.id
      GROUP BY s.id
      ORDER BY activity_at DESC
    `).all() as unknown as SessionRow[]
    return rows.map(row => this.mapSession(row))
  }

  renameSession(id: string, name: string): ResearchSession | null {
    const now = new Date().toISOString()
    const result = this.#db.prepare(`
      UPDATE research_sessions SET name = ?, updated_at = ? WHERE id = ?
    `).run(name.trim(), now, id)
    return Number(result.changes) > 0 ? this.getSession(id) : null
  }

  ensureSession(): ResearchSession {
    return this.listSessions()[0] ?? this.createSession('My research')
  }

  recoverInterruptedJobs(): number {
    const now = new Date().toISOString()
    const result = this.#db.prepare(`
      UPDATE product_jobs
      SET status = 'failed',
          error_message = 'Research bị gián đoạn do server dừng. Hãy chọn Research Again.',
          updated_at = ?
      WHERE status IN ('analyzing', 'researching', 'synthesizing', 'contenting', 'generating_media')
    `).run(now)
    return Number(result.changes)
  }

  createJob(id: string, input: ProductInput, sessionId?: string): ProductJob {
    const now = new Date().toISOString()
    const targetSession = sessionId ? this.getSession(sessionId) : this.ensureSession()
    if (!targetSession) throw new Error('Research session không tồn tại.')
    this.#db.prepare(`
      INSERT INTO product_jobs(id, session_id, status, input_json, created_at, updated_at)
      VALUES (?, ?, 'created', ?, ?, ?)
    `).run(id, targetSession.id, JSON.stringify(input), now, now)
    this.#db.prepare('UPDATE research_sessions SET updated_at = ? WHERE id = ?').run(now, targetSession.id)
    this.addEvent(id, 'info', 'created', 'Đã tạo Product Job.')
    return this.getJob(id) as ProductJob
  }

  getJob(id: string): ProductJob | null {
    const row = this.#db.prepare('SELECT * FROM product_jobs WHERE id = ?').get(id) as JobRow | undefined
    if (!row) return null
    return this.mapJob(row)
  }

  listJobs(limit = 30, sessionId?: string): ProductJob[] {
    const safeLimit = Math.min(100, Math.max(1, limit))
    const rows = sessionId
      ? this.#db.prepare('SELECT * FROM product_jobs WHERE session_id = ? ORDER BY updated_at DESC LIMIT ?')
        .all(sessionId, safeLimit) as unknown as JobRow[]
      : this.#db.prepare('SELECT * FROM product_jobs ORDER BY updated_at DESC LIMIT ?')
        .all(safeLimit) as unknown as JobRow[]
    return rows.map(row => this.mapJob(row))
  }

  updateStatus(id: string, status: JobStatus, errorMessage: string | null = null): void {
    const parsedStatus = jobStatusSchema.parse(status)
    const now = new Date().toISOString()
    const completedAt = ['completed', 'needs_input', 'failed'].includes(parsedStatus) ? now : null
    this.#db.prepare(`
      UPDATE product_jobs
      SET status = ?, error_message = ?, updated_at = ?, completed_at = ?
      WHERE id = ?
    `).run(parsedStatus, errorMessage, now, completedAt, id)
  }

  saveResearch(id: string, research: ResearchSnapshot): void {
    const now = new Date().toISOString()
    this.#db.prepare('UPDATE product_jobs SET research_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(research), now, id)
  }

  saveProductKnowledge(id: string, knowledge: ProductKnowledge): void {
    const parsed = productKnowledgeSchema.parse(knowledge)
    const now = new Date().toISOString()
    this.#db.prepare(`
      UPDATE product_jobs
      SET product_knowledge_json = ?, updated_at = ?
      WHERE id = ?
    `).run(JSON.stringify(parsed), now, id)
  }

  saveCommercePackage(id: string, value: CommercePackage): void {
    const parsed = commercePackageSchema.parse(value)
    const now = new Date().toISOString()
    this.#db.prepare('UPDATE product_jobs SET commerce_package_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(parsed), now, id)
  }

  saveGeneratedAssets(id: string, assets: GeneratedAsset[]): void {
    const parsed = assets.map(asset => generatedAssetSchema.parse(asset))
    const now = new Date().toISOString()
    this.#db.prepare('UPDATE product_jobs SET generated_assets_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(parsed), now, id)
  }

  addEvent(jobId: string, level: ProgressEvent['level'], stage: string, message: string): void {
    this.#db.prepare(`
      INSERT INTO progress_events(job_id, level, stage, message, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(jobId, level, stage, message, new Date().toISOString())
  }

  close(): void {
    this.#db.close()
  }

  private mapJob(row: JobRow): ProductJob {
    const events = this.#db.prepare('SELECT * FROM progress_events WHERE job_id = ? ORDER BY id ASC')
      .all(row.id) as unknown as EventRow[]

    return {
      id: row.id,
      sessionId: row.session_id,
      status: jobStatusSchema.parse(row.status),
      input: productInputSchema.parse(JSON.parse(row.input_json) as unknown),
      research: row.research_json ? JSON.parse(row.research_json) as ResearchSnapshot : null,
      productKnowledge: row.product_knowledge_json
        ? productKnowledgeSchema.parse(JSON.parse(row.product_knowledge_json) as unknown)
        : null,
      commercePackage: row.commerce_package_json
        ? commercePackageSchema.parse(JSON.parse(row.commerce_package_json) as unknown)
        : null,
      generatedAssets: row.generated_assets_json
        ? (JSON.parse(row.generated_assets_json) as unknown[]).map(asset => generatedAssetSchema.parse(asset))
        : [],
      errorMessage: row.error_message,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
      events: events.map(event => ({
        id: event.id,
        jobId: event.job_id,
        level: event.level as ProgressEvent['level'],
        stage: event.stage,
        message: event.message,
        createdAt: event.created_at,
      })),
    }
  }

  private mapSession(row: SessionRow): ResearchSession {
    return {
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.activity_at ?? row.updated_at,
      jobCount: Number(row.job_count ?? 0),
    }
  }
}
