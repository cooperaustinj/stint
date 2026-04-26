import type { Database } from 'bun:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

function ensureMigrationsTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `)
}

export function getAppliedMigrations(db: Database): Set<string> {
  ensureMigrationsTable(db)
  const rows = db.query('SELECT version FROM schema_migrations').all() as Array<{ version: string }>
  return new Set(rows.map(row => row.version))
}

export function getMigrationFiles(migrationsDir: string): string[] {
  return readdirSync(migrationsDir)
    .filter(name => name.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b))
}

export function applyPendingMigrations(db: Database, migrationsDir: string): string[] {
  const applied = getAppliedMigrations(db)
  const files = getMigrationFiles(migrationsDir)
  const appliedNow: string[] = []

  for (const file of files) {
    if (applied.has(file)) {
      continue
    }

    const sql = readFileSync(join(migrationsDir, file), 'utf8')
    db.transaction(() => {
      db.run(sql)
      db.query('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(file, new Date().toISOString())
    })()
    appliedNow.push(file)
  }

  return appliedNow
}
