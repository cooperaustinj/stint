import { Database } from 'bun:sqlite'
import { dirname } from 'node:path'
import { mkdirSync } from 'node:fs'

function configureDatabase(db: Database): Database {
    db.run('PRAGMA journal_mode = WAL;')
    db.run('PRAGMA foreign_keys = ON;')
    return db
}

export function openDatabase(path: string): Database {
    mkdirSync(dirname(path), { recursive: true })
    return configureDatabase(new Database(path, { create: true, strict: true }))
}

export function openInMemoryDatabase(): Database {
    return configureDatabase(new Database(':memory:', { strict: true }))
}
