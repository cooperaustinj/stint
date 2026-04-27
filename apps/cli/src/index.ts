import { intro, isCancel, outro, select, text } from '@clack/prompts'
import { hideBin } from 'yargs/helpers'
import yargs from 'yargs'
import { join } from 'node:path'
import { completionScript, installCompletionScript } from './completion/scripts'
import { openDatabase } from './db/connection'
import { applyPendingMigrations, getAppliedMigrations, getMigrationFiles } from './db/migrations'
import {
  archiveClient,
  archiveProject,
  createClient,
  createProject,
  editClient,
  editProject,
  getActiveTrackingEntry,
  getEntryById,
  insertEntry,
  listActiveClients,
  listActiveProjects,
  listClients,
  listProjects,
  queryEntries,
  restoreEntry,
  startTrackingEntry,
  stopTrackingEntry,
  softDeleteEntry,
  updateEntry,
} from './db/repository'
import { buildEntryInput } from './lib/entry-input'
import { loadConfig, saveConfig } from './lib/config'
import { resolveDataPaths } from './lib/paths'
import { printTable } from './lib/table'
import { minutesToHuman, parseDurationMinutes, todayIsoLocal } from './lib/time'
import type { Shell } from './lib/types'

function resolveProfileArg(): 'development' | 'production' {
  const index = process.argv.findIndex(arg => arg === '--profile')
  if (index >= 0) {
    const next = process.argv[index + 1]
    if (next === 'development' || next === 'production') {
      return next
    }
  }

  const inline = process.argv.find(arg => arg.startsWith('--profile='))
  if (inline) {
    const value = inline.split('=')[1]
    if (value === 'development' || value === 'production') {
      return value
    }
  }

  return process.env.STINT_ENV === 'development' ? 'development' : 'production'
}

function resolveDbPathArg(): string | undefined {
  const index = process.argv.findIndex(arg => arg === '--db')
  if (index >= 0) {
    const next = process.argv[index + 1]
    if (next && !next.startsWith('-')) {
      return next
    }
  }

  const inline = process.argv.find(arg => arg.startsWith('--db='))
  if (inline) {
    const value = inline.slice('--db='.length)
    if (value.trim()) {
      return value
    }
  }

  if (typeof process.env.STINT_DB_PATH === 'string' && process.env.STINT_DB_PATH.trim()) {
    return process.env.STINT_DB_PATH
  }

  return undefined
}

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function assertNotCancel(value: unknown, message: string): asserts value {
  if (isCancel(value)) {
    throw new Error(message)
  }
}

function parseTarget(target: string): { clientKey: string; projectKey: string } {
  const [clientPart, projectPart, ...extra] = target.split(':')
  if (extra.length > 0 || !clientPart || !projectPart) {
    throw new Error('Invalid target format. Expected client:project (e.g. acme:backend)')
  }
  return { clientKey: clientPart.trim(), projectKey: projectPart.trim() }
}

async function interactiveEntryInput(
  defaults: {
    date?: string
    note?: string
    client?: string
    project?: string
    duration?: string
    start?: string
    end?: string
  },
  config: { defaultClientKey?: string; defaultProjectKey?: string },
  db: ReturnType<typeof openDatabase>,
) {
  intro('Stint interactive entry')

  const date = await text({ message: 'Date (YYYY-MM-DD)', initialValue: defaults.date ?? todayIsoLocal() })
  assertNotCancel(date, 'Cancelled')

  const mode = await select({
    message: 'How do you want to enter time?',
    options: [
      { label: 'Duration', value: 'duration' },
      { label: 'Start/End range', value: 'range' },
    ],
    initialValue: defaults.start || defaults.end ? 'range' : 'duration',
  })
  assertNotCancel(mode, 'Cancelled')

  let duration: string | undefined
  let start: string | undefined
  let end: string | undefined

  if (mode === 'duration') {
    const durationInput = await text({ message: 'Duration (e.g. 2h, 15m, 1.5h)', initialValue: defaults.duration ?? '1h' })
    assertNotCancel(durationInput, 'Cancelled')
    duration = String(durationInput)
  } else {
    const startInput = await text({ message: 'Start time (e.g. 3:13am)', initialValue: defaults.start ?? '9:00am' })
    assertNotCancel(startInput, 'Cancelled')
    const endInput = await text({ message: 'End time (e.g. 4pm)', initialValue: defaults.end ?? '5:00pm' })
    assertNotCancel(endInput, 'Cancelled')
    start = String(startInput)
    end = String(endInput)
  }

  const note = await text({ message: 'Note', initialValue: defaults.note ?? '' })
  assertNotCancel(note, 'Cancelled')

  const clients = listActiveClients(db)
  if (clients.length === 0) {
    throw new Error('No active clients found. Add one with `stint client add` first.')
  }
  const selectedClient = await select({
    message: 'Client',
    options: clients.map(client => ({ label: `${client.key} (${client.name})`, value: client.key })),
    initialValue: defaults.client ?? config.defaultClientKey,
  })
  assertNotCancel(selectedClient, 'Cancelled')
  const selectedClientKey = String(selectedClient)

  const projects = listActiveProjects(db, selectedClientKey)
  if (projects.length === 0) {
    throw new Error(`No active projects found for client ${selectedClientKey}. Add one with \`stint project add\` first.`)
  }
  const selectedProject = await select({
    message: 'Project',
    options: projects.map(project => ({ label: `${project.key} (${project.name})`, value: project.key })),
    initialValue: defaults.project ?? config.defaultProjectKey,
  })
  assertNotCancel(selectedProject, 'Cancelled')
  const selectedProjectKey = String(selectedProject)

  outro('Entry captured')

  return buildEntryInput(
    {
      date: String(date),
      note: String(note),
      duration,
      start,
      end,
      client: selectedClientKey,
      project: selectedProjectKey,
    },
    config,
  )
}

function printEntries(
  rows: ReturnType<typeof queryEntries>,
  options?: {
    showDeleted?: boolean
    showOverlap?: boolean
  },
) {
  if (rows.length === 0) {
    console.log('No entries found.')
    return
  }

  const showDeleted = Boolean(options?.showDeleted)
  const showOverlap = Boolean(options?.showOverlap)
  const totalMinutes = rows.reduce((sum, row) => sum + row.duration_minutes, 0)
  const headers = ['ID', 'Date', 'Client', 'Project', 'Duration', 'Note']
  if (showDeleted) {
    headers.push('Deleted')
  }
  if (showOverlap) {
    headers.push('Overlap')
  }
  const durationColumnIndex = headers.indexOf('Duration')
  const colAligns = headers.map((_, idx) => (idx === durationColumnIndex ? 'right' : 'left')) as Array<
    'left' | 'right' | 'center'
  >

  const formatDurationForReport = (minutes: number): string => {
    const hours = Math.floor(minutes / 60)
    const remainderMinutes = minutes % 60
    if (hours > 0) {
      return `${hours}h ${String(remainderMinutes).padStart(2, '0')}m`
    }
    return `${remainderMinutes}m`
  }

  printTable(
    headers,
    rows.map(row => {
      const values = [
        String(row.id),
        row.entry_date,
        row.client_key,
        row.project_key,
        formatDurationForReport(row.duration_minutes),
        row.note,
      ]
      if (showDeleted) {
        values.push(row.deleted_at ? 'yes' : 'no')
      }
      if (showOverlap) {
        values.push(row.overlap_warning ? 'yes' : 'no')
      }
      return values
    }),
    { colAligns },
  )
  console.log(`\nTotal: ${minutesToHuman(totalMinutes)} across ${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}`)
}

async function main() {
  const runtimeProfile = resolveProfileArg()
  const dbPathOverride = resolveDbPathArg()
  const paths = resolveDataPaths(runtimeProfile, process.cwd(), { dbPathOverride })
  const config = loadConfig(paths.configPath)
  const db = openDatabase(paths.dbPath)
  const migrationsDir = join(import.meta.dir, '..', 'migrations')
  try {
    applyPendingMigrations(db, migrationsDir)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed applying database migrations: ${message}`, { cause: error })
  }

  const cli = yargs(hideBin(process.argv))
    .scriptName('stint')
    .option('profile', {
      choices: ['development', 'production'] as const,
      default: runtimeProfile,
      describe: 'Data profile: development (repo-local) or production (OS app-data)',
      global: true,
    })
    .option('db', {
      type: 'string',
      default: dbPathOverride,
      describe: 'Override SQLite DB file path (or set STINT_DB_PATH)',
      global: true,
    })
    .strict()
    .demandCommand(1, 'Choose a command. Example: stint add client_key:project_key 2h "work note"')
    .fail((message, error, y) => {
      if (error) {
        console.error(error.message)
      } else if (message) {
        console.error(message)
      }
      console.error('\nRun `stint <command> --help` for command-specific examples.\n')
      y.showHelp()
      process.exit(1)
    })
    .help()

  cli.command(
    'add [target] [input] [note..]',
    'Add a time entry',
    (y: any) =>
      y
        .positional('target', { type: 'string', describe: 'Billing target in client:project format' })
        .positional('input', { type: 'string', describe: 'Duration shorthand or first note token' })
        .positional('note', { type: 'string', array: true, describe: 'Entry note text' })
        .option('date', { type: 'string', describe: 'Entry date (YYYY-MM-DD)', default: todayIsoLocal() })
        .option('duration', { type: 'string', describe: 'Duration string override' })
        .option('start', { type: 'string', describe: 'Start time, e.g. 3:13am' })
        .option('end', { type: 'string', describe: 'End time, e.g. 4pm' })
        .option('note-text', { type: 'string', describe: 'Note text' })
        .option('client', { type: 'string', describe: 'Client key' })
        .option('project', { type: 'string', describe: 'Project key' })
        .option('interactive', { type: 'boolean', default: false, describe: 'Interactive mode' })
        .example('$0 add client_key:project_key 2h "work note"', 'Create a 2h entry with positional target')
        .example('$0 add client_key:project_key --start 9am --end 10:30am "work note"', 'Create timed entry'),
    async (argv: any) => {
      const targetToken = typeof argv.target === 'string' ? argv.target.trim() : ''
      let clientFromTarget: string | undefined
      let projectFromTarget: string | undefined
      if (targetToken) {
        const parsed = parseTarget(targetToken)
        clientFromTarget = parsed.clientKey
        projectFromTarget = parsed.projectKey
      }

      const inputToken = typeof argv.input === 'string' ? argv.input.trim() : ''
      let durationInput = typeof argv.duration === 'string' ? argv.duration.trim() : ''
      let noteArg = Array.isArray(argv.note) ? argv.note.join(' ').trim() : ''

      // Heuristic:
      // - range mode: positional input belongs to note
      // - duration mode: positional input is duration unless it is not parseable
      const hasRangeFlags = Boolean(argv.start || argv.end)
      if (inputToken) {
        if (hasRangeFlags) {
          noteArg = noteArg ? `${inputToken} ${noteArg}` : inputToken
        } else if (!durationInput) {
          try {
            parseDurationMinutes(inputToken)
            durationInput = inputToken
          } catch {
            noteArg = noteArg ? `${inputToken} ${noteArg}` : inputToken
          }
        } else {
          noteArg = noteArg ? `${inputToken} ${noteArg}` : inputToken
        }
      }

      const needsInteractive =
        argv.interactive || (!targetToken && !inputToken && !argv.duration && !argv.start && !argv.end && !noteArg)

      const input = needsInteractive
        ? await interactiveEntryInput(
            {
              date: argv.date,
              note: argv['note-text'] ?? noteArg,
              client: argv.client ?? clientFromTarget,
              project: argv.project ?? projectFromTarget,
              duration: durationInput,
              start: argv.start,
              end: argv.end,
            },
            config,
            db,
          )
        : buildEntryInput(
            {
              date: argv.date,
              durationArg: durationInput,
              duration: durationInput,
              start: argv.start,
              end: argv.end,
              noteArg,
              note: argv['note-text'],
              client: argv.client ?? clientFromTarget,
              project: argv.project ?? projectFromTarget,
            },
            config,
          )

      const created = insertEntry(db, input)
      console.log(`Created entry ${created.id} (${minutesToHuman(input.durationMinutes)})`)
      if (created.overlapWarning) {
        console.log('Warning: this entry overlaps with an existing timed entry.')
      }
    },
  )

  cli.command(
    'track <action> [target] [note..]',
    'Track in-progress work',
    (y: any) =>
      y
        .positional('action', { choices: ['start', 'stop', 'status'] as const })
        .positional('target', { type: 'string', describe: 'client:project for start' })
        .positional('note', { type: 'string', array: true, describe: 'Initial note for start' })
        .option('note-text', { type: 'string', describe: 'Updated note for stop (skip prompt)' })
        .option('duration-override', { type: 'string', describe: 'Override duration on stop (e.g. 1h30m)' })
        .option('non-interactive', { type: 'boolean', default: false, describe: 'Skip prompts for stop' })
        .example('$0 track start client_key:project_key "starting work"', 'Start tracking')
        .example('$0 track stop', 'Stop active tracking with interactive confirmation')
        .example('$0 track status', 'Show active tracking status'),
    async (argv: any) => {
      if (argv.action === 'status') {
        const active = getActiveTrackingEntry(db)
        if (!active) {
          console.log('No active tracking entry.')
          return
        }
        const elapsed = Math.max(
          0,
          Math.round((Date.now() - new Date(active.start_at_utc).getTime()) / (1000 * 60)),
        )
        console.log(
          `Active: ${active.client_key}:${active.project_key} | started ${active.start_at_utc} | elapsed ${minutesToHuman(elapsed)}`,
        )
        console.log(`Note: ${active.note}`)
        return
      }

      if (argv.action === 'start') {
        const target = typeof argv.target === 'string' ? argv.target.trim() : ''
        if (!target) {
          throw new Error('track start requires target client:project')
        }
        const note = (argv['note-text'] ?? (Array.isArray(argv.note) ? argv.note.join(' ') : '')).trim()
        if (!note) {
          throw new Error('track start requires an initial note')
        }
        const parsed = parseTarget(target)
        const started = startTrackingEntry(db, {
          clientKey: parsed.clientKey,
          projectKey: parsed.projectKey,
          note,
          startAtUtc: new Date().toISOString(),
          entryDate: todayIsoLocal(),
        })
        console.log(`Started tracking entry ${started.id} for ${parsed.clientKey}:${parsed.projectKey}`)
        return
      }

      const active = getActiveTrackingEntry(db)
      if (!active) {
        throw new Error('No active tracking entry to stop. Start one with `stint track start`.')
      }

      const stopAt = new Date().toISOString()
      const calculatedMinutes = Math.max(
        1,
        Math.round((new Date(stopAt).getTime() - new Date(active.start_at_utc).getTime()) / (1000 * 60)),
      )

      let finalNote = active.note
      let durationOverrideMinutes: number | null = null

      if (argv['non-interactive'] || argv['note-text'] || argv['duration-override']) {
        finalNote = (argv['note-text'] ?? active.note).trim()
        if (!finalNote) {
          throw new Error('Final note cannot be empty')
        }
        if (argv['duration-override']) {
          durationOverrideMinutes = parseDurationMinutes(String(argv['duration-override']))
        }
      } else {
        intro('Stop tracking')
        console.log(`Computed duration: ${minutesToHuman(calculatedMinutes)}`)
        const override = await text({
          message: 'Override duration? (leave blank to keep computed)',
          placeholder: 'e.g. 1h30m',
        })
        assertNotCancel(override, 'Cancelled')
        const note = await text({
          message: 'Final note',
          initialValue: active.note,
        })
        assertNotCancel(note, 'Cancelled')
        finalNote = String(note).trim()
        if (!finalNote) {
          throw new Error('Final note cannot be empty')
        }
        const overrideText = String(override).trim()
        if (overrideText) {
          durationOverrideMinutes = parseDurationMinutes(overrideText)
        }
        outro('Tracking stopped')
      }

      const stopped = stopTrackingEntry(db, {
        id: active.id,
        endAtUtc: stopAt,
        note: finalNote,
        calculatedDurationMinutes: calculatedMinutes,
        durationOverrideMinutes,
      })
      console.log(`Stopped tracking entry ${active.id} (${minutesToHuman(stopped.effectiveDurationMinutes)})`)
    },
  )

  cli.command(
    'edit <id>',
    'Edit an existing entry',
    (y: any) =>
      y
        .positional('id', { type: 'number', demandOption: true })
        .option('date', { type: 'string', describe: 'Entry date (YYYY-MM-DD)' })
        .option('duration', { type: 'string' })
        .option('start', { type: 'string' })
        .option('end', { type: 'string' })
        .option('note-text', { type: 'string' })
        .option('client', { type: 'string' })
        .option('project', { type: 'string' })
        .option('interactive', { type: 'boolean', default: false }),
    async (argv: any) => {
      const existing = getEntryById(db, argv.id)
      if (!existing) {
        throw new Error(`Entry not found: ${argv.id}`)
      }

      const hasAnyTimeArg = Boolean(argv.duration || argv.start || argv.end)
      const input = argv.interactive
        ? await interactiveEntryInput(
            {
              date: argv.date ?? existing.entry_date,
              note: argv['note-text'] ?? existing.note,
              client: argv.client ?? existing.client_key,
              project: argv.project ?? existing.project_key,
              duration: argv.duration ?? minutesToHuman(existing.duration_minutes),
              start: argv.start,
              end: argv.end,
            },
            config,
            db,
          )
        : hasAnyTimeArg
          ? buildEntryInput(
              {
                date: argv.date ?? existing.entry_date,
                duration: argv.duration,
                start: argv.start,
                end: argv.end,
                note: argv['note-text'] ?? existing.note,
                client: argv.client ?? existing.client_key,
                project: argv.project ?? existing.project_key,
              },
              config,
            )
          : {
              entryDate: argv.date ?? existing.entry_date,
              durationMinutes: existing.duration_minutes,
              note: argv['note-text'] ?? existing.note,
              clientKey: argv.client ?? existing.client_key,
              projectKey: argv.project ?? existing.project_key,
              startAtUtc: existing.start_at_utc,
              endAtUtc: existing.end_at_utc,
            }

      const updated = updateEntry(db, argv.id, input)
      console.log(`Updated entry ${argv.id}`)
      if (updated.overlapWarning) {
        console.log('Warning: this entry overlaps with an existing timed entry.')
      }
    },
  )

  cli.command('delete <id>', 'Soft delete an entry', (y: any) => y.positional('id', { type: 'number' }), (argv: any) => {
    softDeleteEntry(db, argv.id)
    console.log(`Deleted entry ${argv.id}`)
  })

  cli.command(
    'restore <id>',
    'Restore a soft deleted entry',
    (y: any) => y.positional('id', { type: 'number' }),
    (argv: any) => {
    restoreEntry(db, argv.id)
    console.log(`Restored entry ${argv.id}`)
    },
  )

  const reportBuilder = (y: any) =>
    y
      .option('last', { type: 'number', default: config.defaultReportLast ?? 10 })
      .option('from', { type: 'string', describe: 'From date YYYY-MM-DD' })
      .option('to', { type: 'string', describe: 'To date YYYY-MM-DD' })
      .option('client', { type: 'string', describe: 'Filter by client key' })
      .option('project', { type: 'string', describe: 'Filter by project key' })
      .option('include-deleted', { type: 'boolean', default: false, describe: 'Include soft-deleted entries in results' })
      .option('only-deleted', { type: 'boolean', default: false, describe: 'Show only soft-deleted entries' })
      .option('show-deleted', { type: 'boolean', default: false, describe: 'Show Deleted column in report output' })
      .option('show-overlap', { type: 'boolean', default: false, describe: 'Show Overlap column in report output' })

  cli.command('report', 'Show recent entries/report', reportBuilder, (argv: any) => {
    const includeDeleted = argv['include-deleted'] || argv['only-deleted']
    const rows = queryEntries(db, {
      last: argv.last,
      from: argv.from,
      to: argv.to,
      client: argv.client,
      project: argv.project,
      includeDeleted,
      onlyDeleted: argv['only-deleted'],
    })
    printEntries(rows, {
      showDeleted: argv['show-deleted'],
      showOverlap: argv['show-overlap'],
    })
  })

  cli.command('list', 'Alias for report', reportBuilder, (argv: any) => {
    const includeDeleted = argv['include-deleted'] || argv['only-deleted']
    const rows = queryEntries(db, {
      last: argv.last,
      from: argv.from,
      to: argv.to,
      client: argv.client,
      project: argv.project,
      includeDeleted,
      onlyDeleted: argv['only-deleted'],
    })
    printEntries(rows, {
      showDeleted: argv['show-deleted'],
      showOverlap: argv['show-overlap'],
    })
  })

  cli.command(
    'client <action> [key] [name..]',
    'Manage clients',
    (y: any) =>
      y
        .positional('action', { choices: ['add', 'list', 'edit', 'archive'] as const })
        .positional('key', { type: 'string' })
        .positional('name', { type: 'string', array: true })
        .option('name-text', { type: 'string', describe: 'Explicit name text' }),
    (argv: any) => {
      const action = argv.action
      const key = typeof argv.key === 'string' ? argv.key.trim() : ''
      const name = (argv['name-text'] ?? (Array.isArray(argv.name) ? argv.name.join(' ') : '')).trim()

      if (action === 'add') {
        if (!name && !key) {
          throw new Error('Client add requires a name. Example: stint client add "Client Name"')
        }
        const finalName = name || key
        const finalKey = key ? slugify(key) : slugify(finalName)
        createClient(db, finalKey, finalName)
        if (!name && key) {
          console.log(`Created client ${finalKey} (name defaulted to "${finalName}")`)
          console.log('Tip: pass a display name too, e.g. stint client add client_key "Client Name"')
        } else {
          console.log(`Created client ${finalKey}`)
        }
        return
      }

      if (action === 'list') {
        const rows = listClients(db)
        printTable(
          ['Key', 'Name', 'Active', 'Archived'],
          rows.map(row => [row.key, row.name, row.active ? 'yes' : 'no', row.archived_at ? 'yes' : 'no']),
        )
        return
      }

      if (!key) {
        throw new Error('Client key is required')
      }

      if (action === 'edit') {
        if (!key || !name) {
          throw new Error(
            'Client edit requires key and name. Example: stint client edit client_key "Client Name Updated"',
          )
        }
        editClient(db, key, name)
        console.log(`Updated client ${key}`)
        return
      }

      archiveClient(db, key)
      console.log(`Archived client ${key}`)
    },
  )

  cli.command(
    'project <action> [key] [name..]',
    'Manage projects',
    (y: any) =>
      y
        .positional('action', { choices: ['add', 'list', 'edit', 'archive'] as const })
        .positional('key', { type: 'string' })
        .positional('name', { type: 'string', array: true })
        .option('name-text', { type: 'string' })
        .option('client', { type: 'string', describe: 'Client key for add' }),
    (argv: any) => {
      const action = argv.action
      const key = typeof argv.key === 'string' ? argv.key.trim() : ''
      const name = (argv['name-text'] ?? (Array.isArray(argv.name) ? argv.name.join(' ') : '')).trim()

      if (action === 'add') {
        if (!argv.client) {
          throw new Error(
            'Project add requires --client. Example: stint project add project_key "Project Name" --client client_key',
          )
        }
        if (!name && !key) {
          throw new Error(
            'Project add requires at least a key or name. Example: stint project add project_key "Project Name" --client client_key',
          )
        }
        const finalName = name || key
        const finalKey = key ? slugify(key) : slugify(finalName)
        createProject(db, finalKey, finalName, argv.client)
        if (!name && key) {
          console.log(`Created project ${finalKey} (name defaulted to "${finalName}")`)
          console.log(
            'Tip: pass a display name too, e.g. stint project add project_key "Project Name" --client client_key',
          )
        } else {
          console.log(`Created project ${finalKey}`)
        }
        return
      }

      if (action === 'list') {
        const rows = listProjects(db)
        printTable(
          ['Key', 'Name', 'Client', 'Active', 'Archived'],
          rows.map(row => [row.key, row.name, row.client_key, row.active ? 'yes' : 'no', row.archived_at ? 'yes' : 'no']),
        )
        return
      }

      if (!key) {
        throw new Error('Project key is required')
      }

      if (action === 'edit') {
        if (!key || !name) {
          throw new Error('Project edit requires key and name. Example: stint project edit project_key "Project Name Updated"')
        }
        editProject(db, key, name)
        console.log(`Updated project ${key}`)
        return
      }

      archiveProject(db, key)
      console.log(`Archived project ${key}`)
    },
  )

  cli.command(
    'completion <shell>',
    'Generate or install shell completion script',
    (y: any) =>
      y
        .positional('shell', { choices: ['fish', 'bash', 'zsh'] as const })
        .option('install', { type: 'boolean', default: false, describe: 'Install completion file to default shell path' })
        .option('path', { type: 'string', describe: 'Custom file path for completion install' }),
    (argv: any) => {
      const shell = argv.shell as Shell
      const script = completionScript(shell)
      if (!argv.install) {
        console.log(script)
        return
      }

      const installedPath = installCompletionScript(shell, script, { path: argv.path })
      console.log(`Installed ${shell} completion to ${installedPath}`)
      if (shell === 'fish') {
        console.log('Fish will load this automatically in new shells.')
        return
      }
      if (shell === 'bash') {
        console.log('Load it with: source ~/.local/share/bash-completion/completions/stint')
        return
      }
      console.log('Ensure this directory is in your fpath, then run: autoload -Uz compinit && compinit')
    },
  )

  cli.command(
    'migrate <action>',
    'Run or inspect SQL migrations',
    (y: any) => y.positional('action', { choices: ['up', 'status'] as const }),
    (argv: any) => {
      if (argv.action === 'up') {
        const applied = applyPendingMigrations(db, migrationsDir)
        console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'No pending migrations')
        return
      }
      const files = getMigrationFiles(migrationsDir)
      const applied = getAppliedMigrations(db)
      printTable(
        ['Migration', 'Applied'],
        files.map(file => [file, applied.has(file) ? 'yes' : 'no']),
      )
    },
  )

  cli.command(
    'config [action]',
    'Show or update config defaults and paths',
    (y: any) =>
      y
        .positional('action', { choices: ['show', 'set-defaults', 'reset-defaults'] as const, default: 'show' })
        .option('client', { type: 'string', describe: 'Default client key used by add/edit flows' })
        .option('project', { type: 'string', describe: 'Default project key used by add/edit flows' })
        .option('report-last', { type: 'number', describe: 'Default --last value for report/list commands' })
        .option('yes', { type: 'boolean', default: false, describe: 'Confirm destructive reset-defaults action' })
        .example('$0 config', 'Show profile, paths, and current defaults')
        .example('$0 config set-defaults --client client_key --project project_key', 'Set defaults')
        .example('$0 config reset-defaults --yes', 'Clear stored defaults'),
    (argv: any) => {
      const action = argv.action ?? 'show'

      if (action === 'show') {
        console.log(
          JSON.stringify(
            {
              mode: paths.mode,
              dbPath: paths.dbPath,
              configPath: paths.configPath,
              config,
            },
            null,
            2,
          ),
        )
        return
      }

      if (action === 'reset-defaults') {
        if (!argv.yes) {
          throw new Error('reset-defaults requires --yes')
        }
        const updated = { ...config }
        delete updated.defaultClientKey
        delete updated.defaultProjectKey
        delete updated.defaultReportLast
        saveConfig(paths.configPath, updated)
        console.log('Cleared stored defaults')
        console.log(JSON.stringify(updated, null, 2))
        return
      }

      const hasAny =
        typeof argv.client === 'string' || typeof argv.project === 'string' || typeof argv['report-last'] === 'number'
      if (!hasAny) {
        throw new Error('Provide at least one of --client, --project, --report-last')
      }

      const updated = {
        ...config,
        defaultClientKey: argv.client ?? config.defaultClientKey,
        defaultProjectKey: argv.project ?? config.defaultProjectKey,
        defaultReportLast: argv['report-last'] ?? config.defaultReportLast,
      }
      saveConfig(paths.configPath, updated)
      console.log('Updated defaults')
      console.log(JSON.stringify(updated, null, 2))
    },
  )

  try {
    await cli.parseAsync()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    console.error('')
    cli.showHelp()
    process.exit(1)
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
