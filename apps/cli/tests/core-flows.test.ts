import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DateTime } from 'luxon'
import { completionScript, defaultCompletionInstallPath, installCompletionScript } from '../src/completion/scripts'
import { applyPendingMigrations, getAppliedMigrations } from '../src/db/migrations'
import {
  archiveClient,
  archiveProject,
  createClient,
  createProject,
  editClient,
  getActiveTrackingEntry,
  getEntryById,
  insertEntry,
  listActiveClients,
  listActiveProjects,
  listClients,
  mustGetProject,
  queryEntries,
  restoreEntry,
  startTrackingEntry,
  stopTrackingEntry,
  softDeleteEntry,
  updateEntry,
} from '../src/db/repository'
import { buildEntryInput } from '../src/lib/entry-input'
import { buildRangeFromLocalTimes, minutesToHuman, parseDateInput, parseDurationMinutes } from '../src/lib/time'
import { createInMemoryTestDb } from './helpers/db'

const openDbs = new Set<{ close: () => void }>()
const openDirs: string[] = []

function withDb() {
  const ctx = createInMemoryTestDb()
  openDbs.add(ctx)
  return ctx
}

function seedClientProject(db: ReturnType<typeof withDb>['db']) {
  createClient(db, 'client_key', 'Client Name')
  createProject(db, 'project_key', 'Project Name', 'client_key')
}

afterEach(() => {
  for (const ctx of openDbs) {
    ctx.close()
  }
  openDbs.clear()

  for (const dir of openDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('test harness', () => {
  test('initializes in-memory SQLite with all migrations applied', () => {
    const { db } = withDb()
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('clients','projects','entries','schema_migrations')")
      .all() as Array<{ name: string }>

    expect(tables.length).toBe(4)

    const columns = db.query("PRAGMA table_info(entries)").all() as Array<{ name: string }>
    const names = columns.map(column => column.name)
    expect(names).toContain('status')
    expect(names).toContain('calculated_duration_minutes')
    expect(names).toContain('duration_override_minutes')
  })
})

describe('time parsing', () => {
  test('parseDurationMinutes: accepts integer hour shorthand', () => {
    expect(parseDurationMinutes('2h')).toBe(120)
  })

  test('parseDurationMinutes: accepts integer minute shorthand', () => {
    expect(parseDurationMinutes('45m')).toBe(45)
  })

  test('parseDurationMinutes: accepts decimal hour shorthand', () => {
    expect(parseDurationMinutes('1.5h')).toBe(90)
  })

  test('parseDurationMinutes: accepts combined tokens with whitespace', () => {
    expect(parseDurationMinutes('1h 30m')).toBe(90)
  })

  test('parseDurationMinutes: accepts combined tokens without whitespace', () => {
    expect(parseDurationMinutes('1h30m')).toBe(90)
  })

  test('parseDurationMinutes: accepts extra whitespace around tokens', () => {
    expect(parseDurationMinutes('  1h   30m  ')).toBe(90)
  })

  test('parseDurationMinutes: accepts uppercase unit variants', () => {
    expect(parseDurationMinutes('1H30M')).toBe(90)
  })

  test('parseDurationMinutes: accepts leading-zero minute tokens', () => {
    expect(parseDurationMinutes('1h05m')).toBe(65)
  })

  test('parseDurationMinutes: rejects empty string', () => {
    expect(() => parseDurationMinutes('')).toThrow('Duration cannot be empty')
  })

  test('parseDurationMinutes: rejects unsupported units', () => {
    expect(() => parseDurationMinutes('1d')).toThrow('Could not parse positive duration')
  })

  test('parseDurationMinutes: rejects malformed token ordering', () => {
    expect(() => parseDurationMinutes('h30')).toThrow('Could not parse positive duration')
  })

  test('parseDurationMinutes: rejects negative values', () => {
    expect(() => parseDurationMinutes('-1h')).toThrow('Unsupported duration format')
  })

  test('buildRangeFromLocalTimes: computes same-day ranges', () => {
    const out = buildRangeFromLocalTimes('2026-01-01', '9:00am', '10:15am')
    expect(out.durationMinutes).toBe(75)
    expect(out.startAtUtc).toContain('T')
    expect(out.endAtUtc).toContain('T')
  })

  test('buildRangeFromLocalTimes: rolls end time into next day', () => {
    const out = buildRangeFromLocalTimes('2026-01-01', '11pm', '1am')
    expect(out.durationMinutes).toBe(120)
    const start = DateTime.fromISO(out.startAtUtc, { zone: 'utc' })
    const end = DateTime.fromISO(out.endAtUtc, { zone: 'utc' })
    expect(end > start).toBe(true)
    expect(Math.round(end.diff(start, 'minutes').minutes)).toBe(120)
  })

  test('buildRangeFromLocalTimes: rejects invalid start time formats', () => {
    expect(() => buildRangeFromLocalTimes('2026-01-01', 'nope', '1am')).toThrow('Could not parse time')
  })

  test('buildRangeFromLocalTimes: rejects invalid end time formats', () => {
    expect(() => buildRangeFromLocalTimes('2026-01-01', '1am', 'nah')).toThrow('Could not parse time')
  })

  test('parseDateInput: accepts ISO date strings', () => {
    const out = parseDateInput('2026-04-26')
    expect(out.isValid).toBe(true)
    expect(out.toISODate()).toBe('2026-04-26')
  })

  test('parseDateInput: rejects non-ISO date strings', () => {
    expect(() => parseDateInput('04/26/2026')).toThrow('Invalid date format')
  })

  test('minutesToHuman: formats hour-only durations', () => {
    expect(minutesToHuman(120)).toBe('2h')
  })

  test('minutesToHuman: formats mixed hour-minute durations', () => {
    expect(minutesToHuman(95)).toBe('1h 35m')
  })
})

describe('entry input', () => {
  test('buildEntryInput: accepts duration-only entry with explicit client/project', () => {
    const out = buildEntryInput(
      { duration: '2h', note: 'work', date: '2026-04-26', client: 'client_key', project: 'project_key' },
      {},
    )
    expect(out.durationMinutes).toBe(120)
    expect(out.startAtUtc).toBeNull()
    expect(out.endAtUtc).toBeNull()
  })

  test('buildEntryInput: accepts start/end entry with explicit client/project', () => {
    const out = buildEntryInput(
      { start: '9am', end: '10am', note: 'work', date: '2026-04-26', client: 'client_key', project: 'project_key' },
      {},
    )
    expect(out.durationMinutes).toBe(60)
    expect(out.startAtUtc).toBeString()
    expect(out.endAtUtc).toBeString()
  })

  test('buildEntryInput: rejects when both duration and start/end are provided', () => {
    expect(() =>
      buildEntryInput(
        { duration: '2h', start: '9am', end: '11am', note: 'work', client: 'client_key', project: 'project_key' },
        {},
      ),
    ).toThrow('Provide either duration or start/end, not both')
  })

  test('buildEntryInput: rejects when no time source is provided', () => {
    expect(() => buildEntryInput({ note: 'work', client: 'client_key', project: 'project_key' }, {})).toThrow(
      'Provide either duration or start/end',
    )
  })

  test('buildEntryInput: rejects when note is empty', () => {
    expect(() => buildEntryInput({ duration: '1h', note: '  ', client: 'client_key', project: 'project_key' }, {})).toThrow(
      'Note is required',
    )
  })

  test('buildEntryInput: uses default client/project from config', () => {
    const out = buildEntryInput({ duration: '1h', note: 'work' }, { defaultClientKey: 'a', defaultProjectKey: 'b' })
    expect(out.clientKey).toBe('a')
    expect(out.projectKey).toBe('b')
  })

  test('buildEntryInput: rejects when client is missing and no default exists', () => {
    expect(() => buildEntryInput({ duration: '1h', note: 'work', project: 'project_key' }, {})).toThrow('Client is required')
  })

  test('buildEntryInput: rejects when project is missing and no default exists', () => {
    expect(() => buildEntryInput({ duration: '1h', note: 'work', client: 'client_key' }, {})).toThrow('Project is required')
  })

  test('buildEntryInput: defaults entry date to local today', () => {
    const out = buildEntryInput({ duration: '1h', note: 'work', client: 'client_key', project: 'project_key' }, {})
    expect(out.entryDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  test('buildEntryInput: preserves explicit entry date override', () => {
    const out = buildEntryInput(
      { duration: '1h', note: 'work', date: '2026-05-01', client: 'client_key', project: 'project_key' },
      {},
    )
    expect(out.entryDate).toBe('2026-05-01')
  })
})

describe('repository client/project (in-memory sqlite)', () => {
  test('createClient: inserts client row with active status', () => {
    const { db } = withDb()
    createClient(db, 'client_key', 'Client Name')
    const row = listClients(db)[0]
    expect(row?.key).toBe('client_key')
    expect(row?.active).toBe(1)
  })

  test('createClient: enforces unique client key constraint', () => {
    const { db } = withDb()
    createClient(db, 'client_key', 'Client Name')
    expect(() => createClient(db, 'client_key', 'Client Name 2')).toThrow()
  })

  test('editClient: updates display name and updated_at timestamp', () => {
    const { db } = withDb()
    createClient(db, 'client_key', 'Client Name')
    editClient(db, 'client_key', 'Client Name Updated')
    expect(listClients(db)[0]?.name).toBe('Client Name Updated')
  })

  test('archiveClient: marks client inactive and archived', () => {
    const { db } = withDb()
    createClient(db, 'client_key', 'Client Name')
    archiveClient(db, 'client_key')
    const row = listClients(db)[0]
    expect(row?.active).toBe(0)
    expect(row?.archived_at).toBeString()
  })

  test('listActiveClients: excludes archived clients', () => {
    const { db } = withDb()
    createClient(db, 'active', 'Active')
    createClient(db, 'archived', 'Archived')
    archiveClient(db, 'archived')
    const rows = listActiveClients(db)
    expect(rows.map(r => r.key)).toEqual(['active'])
  })

  test('createProject: inserts project linked to existing client', () => {
    const { db } = withDb()
    createClient(db, 'client_key', 'Client Name')
    createProject(db, 'project_key', 'Project Name', 'client_key')
    const row = listActiveProjects(db)[0]
    expect(row?.client_key).toBe('client_key')
  })

  test('createProject: fails for unknown client key', () => {
    const { db } = withDb()
    expect(() => createProject(db, 'project_key', 'Project Name', 'missing')).toThrow('Client not found')
  })

  test('archiveProject: marks project inactive and archived', () => {
    const { db } = withDb()
    seedClientProject(db)
    archiveProject(db, 'project_key')
    expect(listActiveProjects(db).length).toBe(0)
  })

  test('listActiveProjects: filters by client when requested', () => {
    const { db } = withDb()
    createClient(db, 'a', 'A')
    createClient(db, 'b', 'B')
    createProject(db, 'pa', 'PA', 'a')
    createProject(db, 'pb', 'PB', 'b')
    const rows = listActiveProjects(db, 'a')
    expect(rows.map(r => r.key)).toEqual(['pa'])
  })

  test('mustGetProject: rejects archived project keys', () => {
    const { db } = withDb()
    seedClientProject(db)
    archiveProject(db, 'project_key')
    expect(() => mustGetProject(db, 'project_key')).toThrow('Project not found or archived')
  })
})

describe('repository entry/report (in-memory sqlite)', () => {
  test('insertEntry: creates duration-only entry with null start/end', () => {
    const { db } = withDb()
    seedClientProject(db)
    const inserted = insertEntry(db, {
      entryDate: '2026-04-26',
      durationMinutes: 60,
      note: 'duration-only',
      clientKey: 'client_key',
      projectKey: 'project_key',
      startAtUtc: null,
      endAtUtc: null,
    })
    const row = getEntryById(db, inserted.id)
    expect(row?.start_at_utc).toBeNull()
    expect(row?.end_at_utc).toBeNull()
    expect(row?.status).toBe('completed')
    expect(row?.calculated_duration_minutes).toBe(60)
    expect(row?.duration_override_minutes).toBeNull()
  })

  test('insertEntry: creates timed entry with overlap_warning false by default', () => {
    const { db } = withDb()
    seedClientProject(db)
    const inserted = insertEntry(db, {
      entryDate: '2026-04-26',
      durationMinutes: 60,
      note: 'timed',
      clientKey: 'client_key',
      projectKey: 'project_key',
      startAtUtc: '2026-04-26T16:00:00.000Z',
      endAtUtc: '2026-04-26T17:00:00.000Z',
    })
    expect(inserted.overlapWarning).toBe(false)
  })

  test('insertEntry: marks overlap_warning true on overlapping timed entries', () => {
    const { db } = withDb()
    seedClientProject(db)
    insertEntry(db, {
      entryDate: '2026-04-26',
      durationMinutes: 60,
      note: 'first',
      clientKey: 'client_key',
      projectKey: 'project_key',
      startAtUtc: '2026-04-26T16:00:00.000Z',
      endAtUtc: '2026-04-26T17:00:00.000Z',
    })
    const second = insertEntry(db, {
      entryDate: '2026-04-26',
      durationMinutes: 30,
      note: 'second',
      clientKey: 'client_key',
      projectKey: 'project_key',
      startAtUtc: '2026-04-26T16:30:00.000Z',
      endAtUtc: '2026-04-26T17:00:00.000Z',
    })
    expect(second.overlapWarning).toBe(true)
  })

  test('insertEntry: rejects project that belongs to a different client', () => {
    const { db } = withDb()
    createClient(db, 'c1', 'Client 1')
    createClient(db, 'c2', 'Client 2')
    createProject(db, 'p2', 'Project 2', 'c2')

    expect(() =>
      insertEntry(db, {
        entryDate: '2026-04-26',
        durationMinutes: 60,
        note: 'bad relation',
        clientKey: 'c1',
        projectKey: 'p2',
        startAtUtc: null,
        endAtUtc: null,
      }),
    ).toThrow('does not belong to client')
  })

  test('getEntryById: returns joined client/project fields', () => {
    const { db } = withDb()
    seedClientProject(db)
    const inserted = insertEntry(db, {
      entryDate: '2026-04-26',
      durationMinutes: 60,
      note: 'joined',
      clientKey: 'client_key',
      projectKey: 'project_key',
      startAtUtc: null,
      endAtUtc: null,
    })
    const row = getEntryById(db, inserted.id)
    expect(row?.client_name).toBe('Client Name')
    expect(row?.project_name).toBe('Project Name')
  })

  test('updateEntry: updates note/date/duration fields correctly', () => {
    const { db } = withDb()
    seedClientProject(db)
    const inserted = insertEntry(db, {
      entryDate: '2026-04-26',
      durationMinutes: 60,
      note: 'old',
      clientKey: 'client_key',
      projectKey: 'project_key',
      startAtUtc: null,
      endAtUtc: null,
    })

    updateEntry(db, inserted.id, {
      entryDate: '2026-04-27',
      durationMinutes: 90,
      note: 'new',
      clientKey: 'client_key',
      projectKey: 'project_key',
      startAtUtc: null,
      endAtUtc: null,
    })

    const row = getEntryById(db, inserted.id)
    expect(row?.entry_date).toBe('2026-04-27')
    expect(row?.duration_minutes).toBe(90)
    expect(row?.calculated_duration_minutes).toBe(90)
    expect(row?.duration_override_minutes).toBeNull()
    expect(row?.note).toBe('new')
  })

  test('updateEntry: recomputes overlap_warning excluding self entry', () => {
    const { db } = withDb()
    seedClientProject(db)
    const inserted = insertEntry(db, {
      entryDate: '2026-04-26',
      durationMinutes: 60,
      note: 'self',
      clientKey: 'client_key',
      projectKey: 'project_key',
      startAtUtc: '2026-04-26T16:00:00.000Z',
      endAtUtc: '2026-04-26T17:00:00.000Z',
    })

    const out = updateEntry(db, inserted.id, {
      entryDate: '2026-04-26',
      durationMinutes: 60,
      note: 'self updated',
      clientKey: 'client_key',
      projectKey: 'project_key',
      startAtUtc: '2026-04-26T16:00:00.000Z',
      endAtUtc: '2026-04-26T17:00:00.000Z',
    })

    expect(out.overlapWarning).toBe(false)
  })

  test('softDeleteEntry: sets deleted_at and hides entry from default report', () => {
    const { db } = withDb()
    seedClientProject(db)
    const inserted = insertEntry(db, {
      entryDate: '2026-04-26',
      durationMinutes: 30,
      note: 'to delete',
      clientKey: 'client_key',
      projectKey: 'project_key',
      startAtUtc: null,
      endAtUtc: null,
    })

    softDeleteEntry(db, inserted.id)
    const rows = queryEntries(db, { last: 10 })
    expect(rows.length).toBe(0)
  })

  test('restoreEntry: clears deleted_at and re-includes entry in default report', () => {
    const { db } = withDb()
    seedClientProject(db)
    const inserted = insertEntry(db, {
      entryDate: '2026-04-26',
      durationMinutes: 30,
      note: 'to restore',
      clientKey: 'client_key',
      projectKey: 'project_key',
      startAtUtc: null,
      endAtUtc: null,
    })

    softDeleteEntry(db, inserted.id)
    restoreEntry(db, inserted.id)
    const rows = queryEntries(db, { last: 10 })
    expect(rows.length).toBe(1)
  })

  test('queryEntries: supports last-N ordering by entry_date then id descending', () => {
    const { db } = withDb()
    seedClientProject(db)
    insertEntry(db, {
      entryDate: '2026-04-25',
      durationMinutes: 10,
      note: 'older',
      clientKey: 'client_key',
      projectKey: 'project_key',
      startAtUtc: null,
      endAtUtc: null,
    })
    const second = insertEntry(db, {
      entryDate: '2026-04-26',
      durationMinutes: 20,
      note: 'newer',
      clientKey: 'client_key',
      projectKey: 'project_key',
      startAtUtc: null,
      endAtUtc: null,
    })
    const rows = queryEntries(db, { last: 1 })
    expect(rows.length).toBe(1)
    expect(rows[0]?.id).toBe(second.id)
  })

  test('queryEntries: supports date-range filtering', () => {
    const { db } = withDb()
    seedClientProject(db)
    insertEntry(db, {
      entryDate: '2026-04-20',
      durationMinutes: 10,
      note: 'outside',
      clientKey: 'client_key',
      projectKey: 'project_key',
      startAtUtc: null,
      endAtUtc: null,
    })
    insertEntry(db, {
      entryDate: '2026-04-26',
      durationMinutes: 20,
      note: 'inside',
      clientKey: 'client_key',
      projectKey: 'project_key',
      startAtUtc: null,
      endAtUtc: null,
    })
    const rows = queryEntries(db, { last: 10, from: '2026-04-25', to: '2026-04-27' })
    expect(rows.length).toBe(1)
    expect(rows[0]?.note).toBe('inside')
  })

  test('queryEntries: supports client and project key filtering', () => {
    const { db } = withDb()
    createClient(db, 'client_key', 'Client 1')
    createClient(db, 'other_client', 'Client 2')
    createProject(db, 'project_key', 'Project 1', 'client_key')
    createProject(db, 'other_project', 'Project 2', 'other_client')

    insertEntry(db, {
      entryDate: '2026-04-26',
      durationMinutes: 20,
      note: 'target',
      clientKey: 'client_key',
      projectKey: 'project_key',
      startAtUtc: null,
      endAtUtc: null,
    })
    insertEntry(db, {
      entryDate: '2026-04-26',
      durationMinutes: 20,
      note: 'other',
      clientKey: 'other_client',
      projectKey: 'other_project',
      startAtUtc: null,
      endAtUtc: null,
    })

    const rows = queryEntries(db, { last: 10, client: 'client_key', project: 'project_key' })
    expect(rows.length).toBe(1)
    expect(rows[0]?.note).toBe('target')
  })

  test('queryEntries: includeDeleted=true returns soft-deleted rows', () => {
    const { db } = withDb()
    seedClientProject(db)
    const inserted = insertEntry(db, {
      entryDate: '2026-04-26',
      durationMinutes: 30,
      note: 'deleted',
      clientKey: 'client_key',
      projectKey: 'project_key',
      startAtUtc: null,
      endAtUtc: null,
    })

    softDeleteEntry(db, inserted.id)
    const rows = queryEntries(db, { last: 10, includeDeleted: true })
    expect(rows.length).toBe(1)
    expect(rows[0]?.deleted_at).toBeString()
  })

  test('startTrackingEntry: creates active tracking row', () => {
    const { db } = withDb()
    seedClientProject(db)
    const created = startTrackingEntry(db, {
      clientKey: 'client_key',
      projectKey: 'project_key',
      note: 'in progress',
      startAtUtc: '2026-04-26T10:00:00.000Z',
      entryDate: '2026-04-26',
    })

    const active = getActiveTrackingEntry(db)
    expect(active?.id).toBe(created.id)
    expect(active?.note).toBe('in progress')
  })

  test('startTrackingEntry: rejects second active timer', () => {
    const { db } = withDb()
    seedClientProject(db)
    startTrackingEntry(db, {
      clientKey: 'client_key',
      projectKey: 'project_key',
      note: 'first',
      startAtUtc: '2026-04-26T10:00:00.000Z',
      entryDate: '2026-04-26',
    })

    expect(() =>
      startTrackingEntry(db, {
        clientKey: 'client_key',
        projectKey: 'project_key',
        note: 'second',
        startAtUtc: '2026-04-26T11:00:00.000Z',
        entryDate: '2026-04-26',
      }),
    ).toThrow('already active')
  })

  test('stopTrackingEntry: finalizes active row with calculated duration', () => {
    const { db } = withDb()
    seedClientProject(db)
    const started = startTrackingEntry(db, {
      clientKey: 'client_key',
      projectKey: 'project_key',
      note: 'in progress',
      startAtUtc: '2026-04-26T10:00:00.000Z',
      entryDate: '2026-04-26',
    })

    const out = stopTrackingEntry(db, {
      id: started.id,
      endAtUtc: '2026-04-26T10:30:00.000Z',
      note: 'final note',
      calculatedDurationMinutes: 30,
      durationOverrideMinutes: null,
    })
    expect(out.effectiveDurationMinutes).toBe(30)

    const row = getEntryById(db, started.id)
    expect(row?.status).toBe('completed')
    expect(row?.duration_minutes).toBe(30)
    expect(row?.calculated_duration_minutes).toBe(30)
    expect(row?.duration_override_minutes).toBeNull()
    expect(row?.note).toBe('final note')
  })

  test('stopTrackingEntry: applies optional duration override', () => {
    const { db } = withDb()
    seedClientProject(db)
    const started = startTrackingEntry(db, {
      clientKey: 'client_key',
      projectKey: 'project_key',
      note: 'in progress',
      startAtUtc: '2026-04-26T10:00:00.000Z',
      entryDate: '2026-04-26',
    })

    const out = stopTrackingEntry(db, {
      id: started.id,
      endAtUtc: '2026-04-26T11:00:00.000Z',
      note: 'final note',
      calculatedDurationMinutes: 60,
      durationOverrideMinutes: 45,
    })
    expect(out.effectiveDurationMinutes).toBe(45)

    const row = getEntryById(db, started.id)
    expect(row?.duration_minutes).toBe(45)
    expect(row?.calculated_duration_minutes).toBe(60)
    expect(row?.duration_override_minutes).toBe(45)
  })
})

describe('migration and completion', () => {
  test('applyPendingMigrations: applies all SQL files once in lexicographic order', () => {
    const { db } = withDb()

    const dir = mkdtempSync(join(tmpdir(), 'stint-migrations-'))
    openDirs.push(dir)
    writeFileSync(join(dir, '0002_second.sql'), 'CREATE TABLE IF NOT EXISTS two(id INTEGER);')
    writeFileSync(join(dir, '0001_first.sql'), 'CREATE TABLE IF NOT EXISTS one(id INTEGER);')

    const applied = applyPendingMigrations(db, dir)
    expect(applied).toEqual(['0001_first.sql', '0002_second.sql'])
  })

  test('applyPendingMigrations: is idempotent on repeated invocation', () => {
    const { db } = withDb()

    const dir = mkdtempSync(join(tmpdir(), 'stint-migrations-'))
    openDirs.push(dir)
    writeFileSync(join(dir, '0001_first.sql'), 'CREATE TABLE IF NOT EXISTS one(id INTEGER);')

    const first = applyPendingMigrations(db, dir)
    const second = applyPendingMigrations(db, dir)
    const applied = getAppliedMigrations(db)

    expect(first).toEqual(['0001_first.sql'])
    expect(second).toEqual([])
    expect(applied.has('0001_first.sql')).toBe(true)
  })

  test('completionScript: fish output includes top-level command suggestions', () => {
    const out = completionScript('fish')
    expect(out).toContain('complete -c stint')
    expect(out).toContain('add edit delete restore report list track client project completion migrate config')
    expect(out).toContain("__fish_seen_subcommand_from track")
  })

  test('completionScript: bash and zsh outputs are non-empty and command-scoped', () => {
    const bash = completionScript('bash')
    const zsh = completionScript('zsh')
    expect(bash.length).toBeGreaterThan(10)
    expect(zsh.length).toBeGreaterThan(10)
    expect(bash).toContain('stint')
    expect(zsh).toContain('#compdef stint')
  })

  test('defaultCompletionInstallPath: fish uses XDG config dir when provided', () => {
    const path = defaultCompletionInstallPath('fish', {
      HOME: '/tmp/home',
      XDG_CONFIG_HOME: '/tmp/xdg-config',
    } as NodeJS.ProcessEnv)
    expect(path).toBe('/tmp/xdg-config/fish/completions/stint.fish')
  })

  test('installCompletionScript: writes completion file to path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'stint-completion-'))
    openDirs.push(dir)
    const path = join(dir, 'stint.fish')

    const installedPath = installCompletionScript('fish', completionScript('fish'), { path })
    expect(installedPath).toBe(path)

    const content = await Bun.file(path).text()
    expect(content).toContain('complete -c stint')
  })
})
