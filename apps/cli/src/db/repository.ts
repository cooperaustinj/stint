import type { Database } from 'bun:sqlite'
import type { EntryInput, EntryRow } from '../lib/types'

export function mustGetClient(db: Database, key: string): { id: number; key: string; name: string } {
  const row = db
    .query('SELECT id, key, name FROM clients WHERE key = ? AND archived_at IS NULL AND active = 1')
    .get(key) as { id: number; key: string; name: string } | null
  if (!row) {
    throw new Error(`Client not found or archived: ${key}`)
  }
  return row
}

export function mustGetProject(db: Database, key: string): { id: number; key: string; client_id: number; name: string } {
  const row = db
    .query('SELECT id, key, client_id, name FROM projects WHERE key = ? AND archived_at IS NULL AND active = 1')
    .get(key) as { id: number; key: string; client_id: number; name: string } | null
  if (!row) {
    throw new Error(`Project not found or archived: ${key}`)
  }
  return row
}

export function createClient(db: Database, key: string, name: string): void {
  const now = new Date().toISOString()
  db.query(
    'INSERT INTO clients (key, name, active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)',
  ).run(key, name, now, now)
}

export function listClients(db: Database): Array<{ key: string; name: string; active: number; archived_at: string | null }> {
  return db
    .query('SELECT key, name, active, archived_at FROM clients ORDER BY key')
    .all() as Array<{ key: string; name: string; active: number; archived_at: string | null }>
}

export function listActiveClients(db: Database): Array<{ key: string; name: string }> {
  return db
    .query('SELECT key, name FROM clients WHERE archived_at IS NULL AND active = 1 ORDER BY key')
    .all() as Array<{ key: string; name: string }>
}

export function editClient(db: Database, key: string, name: string): void {
  const now = new Date().toISOString()
  db.query('UPDATE clients SET name = ?, updated_at = ? WHERE key = ?').run(name, now, key)
}

export function archiveClient(db: Database, key: string): void {
  const now = new Date().toISOString()
  db.query('UPDATE clients SET archived_at = ?, active = 0, updated_at = ? WHERE key = ?').run(now, now, key)
}

export function createProject(db: Database, key: string, name: string, clientKey: string): void {
  const client = mustGetClient(db, clientKey)
  const now = new Date().toISOString()
  db.query(
    'INSERT INTO projects (key, client_id, name, active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)',
  ).run(key, client.id, name, now, now)
}

export function listProjects(
  db: Database,
): Array<{ key: string; name: string; client_key: string; active: number; archived_at: string | null }> {
  return db
    .query(
      `SELECT p.key, p.name, c.key as client_key, p.active, p.archived_at
       FROM projects p
       JOIN clients c ON c.id = p.client_id
       ORDER BY c.key, p.key`,
    )
    .all() as Array<{ key: string; name: string; client_key: string; active: number; archived_at: string | null }>
}

export function listActiveProjects(
  db: Database,
  clientKey?: string,
): Array<{ key: string; name: string; client_key: string }> {
  const baseSql = `SELECT p.key, p.name, c.key as client_key\n       FROM projects p\n       JOIN clients c ON c.id = p.client_id\n       WHERE p.archived_at IS NULL AND p.active = 1`

  if (clientKey) {
    return db.query(`${baseSql} AND c.key = ? ORDER BY p.key`).all(clientKey) as Array<{
      key: string
      name: string
      client_key: string
    }>
  }

  return db.query(`${baseSql} ORDER BY c.key, p.key`).all() as Array<{ key: string; name: string; client_key: string }>
}

export function editProject(db: Database, key: string, name: string): void {
  const now = new Date().toISOString()
  db.query('UPDATE projects SET name = ?, updated_at = ? WHERE key = ?').run(name, now, key)
}

export function archiveProject(db: Database, key: string): void {
  const now = new Date().toISOString()
  db.query('UPDATE projects SET archived_at = ?, active = 0, updated_at = ? WHERE key = ?').run(now, now, key)
}

function detectOverlap(
  db: Database,
  startAtUtc: string | null | undefined,
  endAtUtc: string | null | undefined,
  excludeEntryId?: number,
): boolean {
  if (!startAtUtc || !endAtUtc) {
    return false
  }

  if (excludeEntryId) {
    const row = db
      .query(
        `SELECT 1 as overlap
         FROM entries
         WHERE deleted_at IS NULL
           AND id != ?
           AND start_at_utc IS NOT NULL
           AND end_at_utc IS NOT NULL
           AND start_at_utc < ?
           AND end_at_utc > ?
         LIMIT 1`,
      )
      .get(excludeEntryId, endAtUtc, startAtUtc) as { overlap: number } | null
    return Boolean(row)
  }

  const row = db
    .query(
      `SELECT 1 as overlap
       FROM entries
       WHERE deleted_at IS NULL
         AND start_at_utc IS NOT NULL
         AND end_at_utc IS NOT NULL
         AND start_at_utc < ?
         AND end_at_utc > ?
       LIMIT 1`,
    )
    .get(endAtUtc, startAtUtc) as { overlap: number } | null
  return Boolean(row)
}

export function insertEntry(db: Database, input: EntryInput): { id: number; overlapWarning: boolean } {
  const client = mustGetClient(db, input.clientKey)
  const project = mustGetProject(db, input.projectKey)
  if (project.client_id !== client.id) {
    throw new Error(`Project ${project.key} does not belong to client ${client.key}`)
  }

  const overlapWarning = detectOverlap(db, input.startAtUtc, input.endAtUtc)
  const now = new Date().toISOString()

  const result = db
    .query(
      `INSERT INTO entries (
        entry_date, start_at_utc, end_at_utc, duration_minutes, calculated_duration_minutes, duration_override_minutes,
        status, note, client_id, project_id, overlap_warning, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.entryDate,
      input.startAtUtc ?? null,
      input.endAtUtc ?? null,
      input.durationMinutes,
      input.durationMinutes,
      null,
      'completed',
      input.note,
      client.id,
      project.id,
      overlapWarning ? 1 : 0,
      now,
      now,
    )

  return { id: Number(result.lastInsertRowid), overlapWarning }
}

export function getEntryById(db: Database, id: number): EntryRow | null {
  return db
    .query(
      `SELECT e.id, e.entry_date, e.start_at_utc, e.end_at_utc, e.duration_minutes,
              e.calculated_duration_minutes, e.duration_override_minutes, e.status,
              e.note, e.overlap_warning, e.deleted_at,
              c.key as client_key, p.key as project_key, c.name as client_name, p.name as project_name
       FROM entries e
       JOIN clients c ON c.id = e.client_id
       JOIN projects p ON p.id = e.project_id
       WHERE e.id = ?`,
    )
    .get(id) as EntryRow | null
}

export function updateEntry(db: Database, id: number, input: EntryInput): { overlapWarning: boolean } {
  const client = mustGetClient(db, input.clientKey)
  const project = mustGetProject(db, input.projectKey)
  if (project.client_id !== client.id) {
    throw new Error(`Project ${project.key} does not belong to client ${client.key}`)
  }

  const overlapWarning = detectOverlap(db, input.startAtUtc, input.endAtUtc, id)
  const now = new Date().toISOString()

  db.query(
    `UPDATE entries
     SET entry_date = ?,
         start_at_utc = ?,
         end_at_utc = ?,
         duration_minutes = ?,
         calculated_duration_minutes = ?,
         duration_override_minutes = NULL,
         status = 'completed',
         note = ?,
         client_id = ?,
         project_id = ?,
         overlap_warning = ?,
         updated_at = ?
     WHERE id = ?`,
  ).run(
    input.entryDate,
    input.startAtUtc ?? null,
    input.endAtUtc ?? null,
    input.durationMinutes,
    input.durationMinutes,
    input.note,
    client.id,
    project.id,
    overlapWarning ? 1 : 0,
    now,
    id,
  )

  return { overlapWarning }
}

export type ActiveTrackingRow = {
  id: number
  entry_date: string
  start_at_utc: string
  note: string
  client_key: string
  project_key: string
  client_name: string
  project_name: string
}

export function getActiveTrackingEntry(db: Database): ActiveTrackingRow | null {
  return db
    .query(
      `SELECT e.id, e.entry_date, e.start_at_utc, e.note,
              c.key as client_key, p.key as project_key, c.name as client_name, p.name as project_name
       FROM entries e
       JOIN clients c ON c.id = e.client_id
       JOIN projects p ON p.id = e.project_id
       WHERE e.status = 'tracking' AND e.deleted_at IS NULL
       LIMIT 1`,
    )
    .get() as ActiveTrackingRow | null
}

export function startTrackingEntry(
  db: Database,
  input: { clientKey: string; projectKey: string; note: string; startAtUtc: string; entryDate: string },
): { id: number } {
  const client = mustGetClient(db, input.clientKey)
  const project = mustGetProject(db, input.projectKey)
  if (project.client_id !== client.id) {
    throw new Error(`Project ${project.key} does not belong to client ${client.key}`)
  }

  const now = new Date().toISOString()
  try {
    const result = db
      .query(
        `INSERT INTO entries (
          entry_date, start_at_utc, end_at_utc,
          duration_minutes, calculated_duration_minutes, duration_override_minutes,
          status, note, client_id, project_id, overlap_warning, created_at, updated_at
        ) VALUES (?, ?, NULL, 0, 0, NULL, 'tracking', ?, ?, ?, 0, ?, ?)`,
      )
      .run(input.entryDate, input.startAtUtc, input.note, client.id, project.id, now, now)

    return { id: Number(result.lastInsertRowid) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('idx_entries_single_tracking') || message.includes('UNIQUE constraint failed: entries.status')) {
      throw new Error('A tracking entry is already active. Stop it first with `stint track stop`.', { cause: error })
    }
    throw error
  }
}

export function stopTrackingEntry(
  db: Database,
  input: { id: number; endAtUtc: string; note: string; calculatedDurationMinutes: number; durationOverrideMinutes?: number | null },
): { effectiveDurationMinutes: number } {
  const effective = input.durationOverrideMinutes ?? input.calculatedDurationMinutes
  db.query(
    `UPDATE entries
     SET end_at_utc = ?,
         note = ?,
         status = 'completed',
         calculated_duration_minutes = ?,
         duration_override_minutes = ?,
         duration_minutes = ?,
         updated_at = ?
     WHERE id = ?`,
  ).run(
    input.endAtUtc,
    input.note,
    input.calculatedDurationMinutes,
    input.durationOverrideMinutes ?? null,
    effective,
    new Date().toISOString(),
    input.id,
  )

  return { effectiveDurationMinutes: effective }
}

export function softDeleteEntry(db: Database, id: number): void {
  db.query('UPDATE entries SET deleted_at = ?, updated_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    new Date().toISOString(),
    id,
  )
}

export function restoreEntry(db: Database, id: number): void {
  db.query('UPDATE entries SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(new Date().toISOString(), id)
}

export function queryEntries(
  db: Database,
  filters: {
    last: number
    from?: string
    to?: string
    client?: string
    project?: string
    includeDeleted?: boolean
    onlyDeleted?: boolean
  },
): EntryRow[] {
  const conditions: string[] = []
  const params: Array<string | number> = []

  conditions.push("e.status = 'completed'")

  if (filters.onlyDeleted) {
    conditions.push('e.deleted_at IS NOT NULL')
  } else if (!filters.includeDeleted) {
    conditions.push('e.deleted_at IS NULL')
  }
  if (filters.from) {
    conditions.push('e.entry_date >= ?')
    params.push(filters.from)
  }
  if (filters.to) {
    conditions.push('e.entry_date <= ?')
    params.push(filters.to)
  }
  if (filters.client) {
    conditions.push('c.key = ?')
    params.push(filters.client)
  }
  if (filters.project) {
    conditions.push('p.key = ?')
    params.push(filters.project)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const sql = `
    SELECT * FROM (
      SELECT e.id, e.entry_date, e.start_at_utc, e.end_at_utc, e.duration_minutes,
             e.calculated_duration_minutes, e.duration_override_minutes, e.status,
             e.note, e.overlap_warning, e.deleted_at,
             c.key as client_key, p.key as project_key, c.name as client_name, p.name as project_name
      FROM entries e
      JOIN clients c ON c.id = e.client_id
      JOIN projects p ON p.id = e.project_id
      ${where}
      ORDER BY e.entry_date DESC, e.id DESC
      LIMIT ?
    ) recent
    ORDER BY recent.entry_date ASC, recent.id ASC
  `

  return db.query(sql).all(...params, filters.last) as EntryRow[]
}
