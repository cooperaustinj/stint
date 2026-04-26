import type { Database } from 'bun:sqlite'
import { join } from 'node:path'
import { openInMemoryDatabase } from '../../src/db/connection'
import { applyPendingMigrations } from '../../src/db/migrations'

export type TestDbContext = {
  db: Database
  close: () => void
}

export function createInMemoryTestDb(): TestDbContext {
  const db = openInMemoryDatabase()
  const migrationsDir = join(import.meta.dir, '..', '..', 'migrations')
  applyPendingMigrations(db, migrationsDir)

  return {
    db,
    close: () => db.close(),
  }
}
