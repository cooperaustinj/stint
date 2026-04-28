import { intro, isCancel, outro, select, text } from '@clack/prompts'
import { hideBin } from 'yargs/helpers'
import yargs from 'yargs'
import { join } from 'node:path'
import { completionScript, installCompletionScript } from './completion/scripts'
import { openDatabase } from './db/connection'
import { applyPendingMigrations, getAppliedMigrations, getMigrationFiles } from './db/migrations'
import {
    addInvoiceEntryById,
    addInvoiceExpense,
    archiveClient,
    archiveProject,
    attachInvoiceTimeItemsFromFilters,
    backfillDraftInvoiceRatesForClient,
    createInvoiceDraft,
    createClient,
    createProject,
    editClient,
    editProject,
    getActiveTrackingEntry,
    getEntryById,
    getInvoiceSnapshot,
    insertEntry,
    listInvoices,
    listActiveClients,
    listActiveProjects,
    listClients,
    listProjects,
    markInvoiceGenerated,
    queryEntries,
    removeInvoiceEntryById,
    removeInvoiceExpense,
    resolveInvoiceId,
    restoreEntry,
    setClientInvoiceProfile,
    startTrackingEntry,
    stopTrackingEntry,
    softDeleteEntry,
    updateEntry,
} from './db/repository'
import { buildEntryInput } from './lib/entry-input'
import { loadConfig, saveConfig } from './lib/config'
import { resolveDataPaths } from './lib/paths'
import { printTable } from './lib/table'
import {
    defaultInvoiceOutputDir,
    formatUsd,
    parseMoneyToCents,
    printInvoicePreview,
    todayIso,
    writeTypstInvoice,
    type InvoicePreviewView,
} from './lib/invoice'
import { keychainGetPaymentSecret, keychainSetPaymentSecret } from './lib/keychain'
import {
    formatIsoUtcForDisplay,
    minutesToHuman,
    parseDurationMinutes,
    parseTrackStartTimeOverride,
    todayIsoLocal,
} from './lib/time'
import type { Shell } from './lib/types'
import { mkdirSync } from 'node:fs'

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
        const durationInput = await text({
            message: 'Duration (e.g. 2h, 15m, 1.5h)',
            initialValue: defaults.duration ?? '1h',
        })
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
        throw new Error(
            `No active projects found for client ${selectedClientKey}. Add one with \`stint project add\` first.`,
        )
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

function formatDurationForReport(minutes: number): string {
    const hours = Math.floor(minutes / 60)
    const remainderMinutes = minutes % 60
    if (hours > 0) {
        return `${hours}h ${String(remainderMinutes).padStart(2, '0')}m`
    }
    return `${remainderMinutes}m`
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

function nextInvoiceNumber(config: { invoiceNextNumber?: number }): { display: string; next: number } {
    const current = Number.isFinite(config.invoiceNextNumber) ? Math.max(1000, Number(config.invoiceNextNumber)) : 1000
    return { display: String(current).padStart(4, '0'), next: current + 1 }
}

function buildInvoicePreviewView(
    snapshot: ReturnType<typeof getInvoiceSnapshot>,
    config: ReturnType<typeof loadConfig>,
): InvoicePreviewView {
    const timeSubtotalCents = snapshot.timeItems.reduce((sum, item) => sum + item.amount_cents, 0)
    const expenseSubtotalCents = snapshot.expenses.reduce((sum, item) => sum + item.amount_cents, 0)
    const totalHours = snapshot.timeItems.reduce((sum, item) => sum + item.duration_minutes, 0) / 60
    const warnings: string[] = []
    const contractor = {
        name: config.invoiceContractor?.name,
        company: config.invoiceContractor?.company,
        email: config.invoiceContractor?.email,
        phone: config.invoiceContractor?.phone,
        addressLine1: config.invoiceContractor?.addressLine1,
        addressLine2: config.invoiceContractor?.addressLine2,
        addressCity: config.invoiceContractor?.city,
        addressState: config.invoiceContractor?.state,
        addressPostalCode: config.invoiceContractor?.postalCode,
        addressCountry: config.invoiceContractor?.country,
    }

    if (!contractor.name && !contractor.company) {
        warnings.push(
            'Missing contractor header profile (run `stint config invoice-contractor --name "Your Name" --company "Your Company"`).',
        )
    }
    if (!snapshot.invoice.billing_name) {
        warnings.push(
            `Missing client billing name for ${snapshot.invoice.client_key} (run \`stint client billing ${snapshot.invoice.client_key} --billing-name "..."\`).`,
        )
    }
    if (!keychainGetPaymentSecret()) {
        warnings.push('Missing payment secret in macOS Keychain (run `stint invoice payment set ...`).')
    }
    if (snapshot.timeItems.some(item => item.hourly_rate_cents <= 0)) {
        warnings.push(
            `Some line items have zero hourly rate. Set it via \`stint client billing ${snapshot.invoice.client_key} --hourly-rate 125\`.`,
        )
    }

    return {
        invoice: {
            id: snapshot.invoice.id,
            invoiceNumber: snapshot.invoice.invoice_number,
            status: snapshot.invoice.status,
            issueDate: snapshot.invoice.issue_date,
            fromDate: snapshot.invoice.from_date,
            toDate: snapshot.invoice.to_date,
            currency: snapshot.invoice.currency,
            clientKey: snapshot.invoice.client_key,
            clientName: snapshot.invoice.client_name,
            projectKey: snapshot.invoice.project_key,
            projectName: snapshot.invoice.project_name,
            notes: snapshot.invoice.notes,
        },
        contractor,
        clientBilling: {
            name: snapshot.invoice.billing_name ?? undefined,
            email: snapshot.invoice.billing_email ?? undefined,
            addressLine1: snapshot.invoice.billing_address_line1 ?? undefined,
            addressLine2: snapshot.invoice.billing_address_line2 ?? undefined,
            addressCity: snapshot.invoice.billing_city ?? undefined,
            addressState: snapshot.invoice.billing_state ?? undefined,
            addressPostalCode: snapshot.invoice.billing_postal_code ?? undefined,
            addressCountry: snapshot.invoice.billing_country ?? undefined,
        },
        timeItems: snapshot.timeItems.map(item => ({
            entryId: item.entry_id,
            entryDate: item.entry_date,
            projectName: item.project_name,
            note: item.note,
            durationMinutes: item.duration_minutes,
            hourlyRateCents: item.hourly_rate_cents,
            amountCents: item.amount_cents,
        })),
        expenses: snapshot.expenses.map(item => ({
            id: item.id,
            expenseDate: item.expense_date,
            description: item.description,
            amountCents: item.amount_cents,
        })),
        totals: {
            timeSubtotalCents,
            expenseSubtotalCents,
            grandTotalCents: timeSubtotalCents + expenseSubtotalCents,
            totalHours,
        },
        warnings,
        paymentInfoPresent: Boolean(keychainGetPaymentSecret()),
    }
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
        '__complete <kind>',
        false,
        (y: any) =>
            y
                .positional('kind', { choices: ['clients', 'projects', 'targets'] as const })
                .option('client', { type: 'string', describe: 'Client key filter for projects' }),
        (argv: any) => {
            const kind = argv.kind as 'clients' | 'projects' | 'targets'
            if (kind === 'clients') {
                const clients = listActiveClients(db)
                for (const client of clients) {
                    console.log(client.key)
                }
                return
            }

            if (kind === 'projects') {
                const projects = listActiveProjects(db, argv.client)
                for (const project of projects) {
                    console.log(project.key)
                }
                return
            }

            const projects = listActiveProjects(db)
            for (const project of projects) {
                console.log(`${project.client_key}:${project.key}`)
            }
        },
    )

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
                argv.interactive ||
                (!targetToken && !inputToken && !argv.duration && !argv.start && !argv.end && !noteArg)

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
                .option('time', {
                    type: 'string',
                    describe: 'Actual start time for start (e.g. 9:30am); defaults to now',
                })
                .option('non-interactive', { type: 'boolean', default: false, describe: 'Skip prompts for stop' })
                .example('$0 track start client_key:project_key "starting work"', 'Start tracking')
                .example(
                    '$0 track start client_key:project_key "starting work" --time 9:15am',
                    'Start with backfilled start time',
                )
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
                    `Active: ${active.client_key}:${active.project_key} | started ${formatIsoUtcForDisplay(active.start_at_utc)} | elapsed ${minutesToHuman(elapsed)}`,
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
                const timeOverride = typeof argv.time === 'string' ? argv.time.trim() : ''
                const { startAtUtc, entryDate } = timeOverride
                    ? parseTrackStartTimeOverride(timeOverride)
                    : { startAtUtc: new Date().toISOString(), entryDate: todayIsoLocal() }
                const started = startTrackingEntry(db, {
                    clientKey: parsed.clientKey,
                    projectKey: parsed.projectKey,
                    note,
                    startAtUtc,
                    entryDate,
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
                .positional('id', { type: 'number', demandOption: true, describe: 'Entry ID to edit' })
                .option('date', { type: 'string', describe: 'Entry date (YYYY-MM-DD)' })
                .option('duration', { type: 'string', describe: 'Duration string (e.g. 1h30m)' })
                .option('start', { type: 'string', describe: 'Start time (e.g. 9:15am)' })
                .option('end', { type: 'string', describe: 'End time (e.g. 11:00am)' })
                .option('note-text', { type: 'string', describe: 'Replacement note text' })
                .option('client', { type: 'string', describe: 'Client key override' })
                .option('project', { type: 'string', describe: 'Project key override' })
                .option('interactive', { type: 'boolean', default: false, describe: 'Interactive edit prompts' }),
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

    cli.command(
        'delete <id>',
        'Soft delete an entry',
        (y: any) => y.positional('id', { type: 'number', describe: 'Entry ID to soft-delete' }),
        (argv: any) => {
            softDeleteEntry(db, argv.id)
            console.log(`Deleted entry ${argv.id}`)
        },
    )

    cli.command(
        'restore <id>',
        'Restore a soft deleted entry',
        (y: any) => y.positional('id', { type: 'number', describe: 'Entry ID to restore' }),
        (argv: any) => {
            restoreEntry(db, argv.id)
            console.log(`Restored entry ${argv.id}`)
        },
    )

    const reportBuilder = (y: any) =>
        y
            .option('last', {
                type: 'number',
                default: config.defaultReportLast ?? 10,
                describe: 'Max rows when no --from/--to (ignored if either date bound is set)',
            })
            .option('from', {
                type: 'string',
                describe: 'From date YYYY-MM-DD (shows all matches in range; --last ignored)',
            })
            .option('to', {
                type: 'string',
                describe: 'To date YYYY-MM-DD (shows all matches in range; --last ignored)',
            })
            .option('client', { type: 'string', describe: 'Filter by client key' })
            .option('project', { type: 'string', describe: 'Filter by project key' })
            .option('include-deleted', {
                type: 'boolean',
                default: false,
                describe: 'Include soft-deleted entries in results',
            })
            .option('only-deleted', { type: 'boolean', default: false, describe: 'Show only soft-deleted entries' })
            .option('show-deleted', {
                type: 'boolean',
                default: false,
                describe: 'Show Deleted column in report output',
            })
            .option('show-overlap', {
                type: 'boolean',
                default: false,
                describe: 'Show Overlap column in report output',
            })

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
                .positional('action', { choices: ['add', 'list', 'edit', 'archive', 'billing'] as const })
                .positional('key', { type: 'string', describe: 'Client key (required for edit/archive/billing)' })
                .positional('name', { type: 'string', array: true, describe: 'Client name words for add/edit' })
                .option('name-text', { type: 'string', describe: 'Explicit name text' })
                .option('hourly-rate', { type: 'string', describe: 'Client hourly rate in USD, e.g. 125 or 125.50' })
                .option('billing-name', { type: 'string', describe: 'Billing display name for invoices' })
                .option('billing-email', { type: 'string', describe: 'Billing contact email' })
                .option('billing-address-line1', { type: 'string', describe: 'Billing address line 1' })
                .option('billing-address-line2', { type: 'string', describe: 'Billing address line 2' })
                .option('billing-city', { type: 'string', describe: 'Billing city' })
                .option('billing-state', { type: 'string', describe: 'Billing state/region' })
                .option('billing-postal-code', { type: 'string', describe: 'Billing postal code' })
                .option('billing-country', { type: 'string', describe: 'Billing country' }),
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

            if (action === 'billing') {
                const hasAny =
                    Boolean(argv['hourly-rate']) ||
                    Boolean(argv['billing-name']) ||
                    Boolean(argv['billing-email']) ||
                    Boolean(argv['billing-address-line1']) ||
                    Boolean(argv['billing-address-line2']) ||
                    Boolean(argv['billing-city']) ||
                    Boolean(argv['billing-state']) ||
                    Boolean(argv['billing-postal-code']) ||
                    Boolean(argv['billing-country'])
                if (!hasAny) {
                    throw new Error('Provide at least one billing/profile field')
                }
                setClientInvoiceProfile(db, key, {
                    hourlyRateCents: argv['hourly-rate'] ? parseMoneyToCents(String(argv['hourly-rate'])) : null,
                    billingName: argv['billing-name'] ?? null,
                    billingEmail: argv['billing-email'] ?? null,
                    billingAddressLine1: argv['billing-address-line1'] ?? null,
                    billingAddressLine2: argv['billing-address-line2'] ?? null,
                    billingCity: argv['billing-city'] ?? null,
                    billingState: argv['billing-state'] ?? null,
                    billingPostalCode: argv['billing-postal-code'] ?? null,
                    billingCountry: argv['billing-country'] ?? null,
                })
                const updatedRate = argv['hourly-rate'] ? parseMoneyToCents(String(argv['hourly-rate'])) : null
                let backfilled = 0
                if (updatedRate) {
                    backfilled = backfillDraftInvoiceRatesForClient(db, key, updatedRate)
                }
                console.log(`Updated billing profile for client ${key}`)
                if (updatedRate) {
                    console.log(
                        `Backfilled ${backfilled} zero-rate draft invoice line item${backfilled === 1 ? '' : 's'}.`,
                    )
                }
                return
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
                .positional('key', { type: 'string', describe: 'Project key (required for edit/archive)' })
                .positional('name', { type: 'string', array: true, describe: 'Project name words for add/edit' })
                .option('name-text', { type: 'string', describe: 'Explicit project name text' })
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
                    rows.map(row => [
                        row.key,
                        row.name,
                        row.client_key,
                        row.active ? 'yes' : 'no',
                        row.archived_at ? 'yes' : 'no',
                    ]),
                )
                return
            }

            if (!key) {
                throw new Error('Project key is required')
            }

            if (action === 'edit') {
                if (!key || !name) {
                    throw new Error(
                        'Project edit requires key and name. Example: stint project edit project_key "Project Name Updated"',
                    )
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
        'invoice <action> [invoice] [subaction]',
        'Manage invoice drafts and generation',
        (y: any) =>
            y
                .positional('action', {
                    choices: [
                        'create',
                        'list',
                        'show',
                        'preview',
                        'generate',
                        'entries',
                        'expense',
                        'payment',
                    ] as const,
                })
                .positional('invoice', {
                    type: 'string',
                    describe: 'Invoice token: id (e.g. 1) or number (e.g. @1000)',
                })
                .positional('subaction', { type: 'string', describe: 'Subaction for entries/expense/payment groups' })
                .option('client', { type: 'string', describe: 'Client key filter/selection' })
                .option('project', { type: 'string', describe: 'Project key filter/selection' })
                .option('from', { type: 'string', describe: 'Start date (YYYY-MM-DD)' })
                .option('to', { type: 'string', describe: 'End date (YYYY-MM-DD)' })
                .option('issue-date', { type: 'string', describe: 'Invoice issue date (YYYY-MM-DD)' })
                .option('note', { type: 'string', describe: 'Invoice note text' })
                .option('status', {
                    choices: ['draft', 'generated'] as const,
                    describe: 'Filter invoice list by status',
                })
                .option('id', { type: 'array', describe: 'Entry IDs for include/exclude' })
                .option('amount', { type: 'string', describe: 'Expense amount in USD (e.g. 25.00)' })
                .option('description', { type: 'string', describe: 'Expense description text' })
                .option('date', { type: 'string', describe: 'Expense date (YYYY-MM-DD)' })
                .option('expense-id', { type: 'number', describe: 'Expense ID to remove' })
                .option('interactive', {
                    type: 'boolean',
                    default: false,
                    describe: 'Interactive prompts for supported actions',
                })
                .option('out', { type: 'string', describe: 'Output directory for generated Typst/PDF files' })
                .option('preview', {
                    type: 'boolean',
                    default: false,
                    describe: 'Print terminal preview before PDF generation',
                })
                .option('account-name', { type: 'string', describe: 'Payment account holder name (Keychain)' })
                .option('bank-name', { type: 'string', describe: 'Payment bank name (Keychain)' })
                .option('routing-number', { type: 'string', describe: 'Payment routing number (Keychain)' })
                .option('account-number', { type: 'string', describe: 'Payment account number (Keychain)' }),
        async (argv: any) => {
            if (argv.action === 'payment') {
                const sub = String(argv.subaction ?? argv.invoice ?? '').trim()
                if (sub !== 'set') {
                    const has = Boolean(keychainGetPaymentSecret())
                    console.log(`Payment secret in keychain: ${has ? 'present' : 'missing'}`)
                    return
                }
                const payload = {
                    accountName: String(argv['account-name'] ?? '').trim(),
                    bankName: String(argv['bank-name'] ?? '').trim(),
                    routingNumber: String(argv['routing-number'] ?? '').trim(),
                    accountNumber: String(argv['account-number'] ?? '').trim(),
                }
                if (!payload.accountName || !payload.bankName || !payload.routingNumber || !payload.accountNumber) {
                    throw new Error('payment set requires --account-name --bank-name --routing-number --account-number')
                }
                keychainSetPaymentSecret(JSON.stringify(payload))
                console.log('Stored payment details in macOS Keychain.')
                return
            }

            if (argv.action === 'create') {
                if (!argv.client || !argv.from || !argv.to) {
                    throw new Error('invoice create requires --client --from --to')
                }
                const next = nextInvoiceNumber(config)
                const issueDate = argv['issue-date'] ?? todayIso()
                const created = createInvoiceDraft(db, {
                    invoiceNumber: next.display,
                    issueDate,
                    fromDate: argv.from,
                    toDate: argv.to,
                    clientKey: argv.client,
                    projectKey: argv.project,
                    notes: argv.note,
                })
                const attached = attachInvoiceTimeItemsFromFilters(db, created.id)
                saveConfig(paths.configPath, { ...config, invoiceNextNumber: next.next })
                console.log(
                    `Created invoice ${next.display} (id=${created.id}); attached ${attached} time entr${attached === 1 ? 'y' : 'ies'}.`,
                )
                return
            }

            if (argv.action === 'list') {
                const rows = listInvoices(db, { client: argv.client, status: argv.status })
                if (rows.length === 0) {
                    console.log('No invoices found.')
                    return
                }
                printTable(
                    ['ID', 'Number', 'Status', 'Issue', 'From', 'To', 'Client', 'Project'],
                    rows.map(row => [
                        String(row.id),
                        row.invoice_number,
                        row.status,
                        row.issue_date,
                        row.from_date,
                        row.to_date,
                        row.client_key,
                        row.project_key ?? 'all',
                    ]),
                )
                return
            }

            if (!argv.invoice) {
                throw new Error('Invoice id or number is required')
            }
            const invoiceId = resolveInvoiceId(db, String(argv.invoice))

            if (argv.action === 'entries') {
                const sub = String(argv.subaction ?? '').trim()
                const ids = (Array.isArray(argv.id) ? argv.id : [])
                    .map((id: unknown) => Number(id))
                    .filter((id: number) => Number.isFinite(id))
                if (ids.length === 0) {
                    throw new Error('Provide at least one --id value')
                }
                if (sub === 'include') {
                    for (const id of ids) {
                        addInvoiceEntryById(db, invoiceId, id)
                    }
                    console.log(
                        `Included ${ids.length} entr${ids.length === 1 ? 'y' : 'ies'} into invoice ${invoiceId}`,
                    )
                    return
                }
                if (sub === 'exclude') {
                    for (const id of ids) {
                        removeInvoiceEntryById(db, invoiceId, id)
                    }
                    console.log(
                        `Excluded ${ids.length} entr${ids.length === 1 ? 'y' : 'ies'} from invoice ${invoiceId}`,
                    )
                    return
                }
                throw new Error('invoice entries requires subaction include|exclude')
            }

            if (argv.action === 'expense') {
                const sub = String(argv.subaction ?? '').trim()
                if (sub === 'add') {
                    let amount = String(argv.amount ?? '').trim()
                    let description = String(argv.description ?? '').trim()
                    let expenseDate = String(argv.date ?? todayIso()).trim()
                    if (argv.interactive) {
                        const a = await text({ message: 'Expense amount (USD)', initialValue: amount || '0.00' })
                        assertNotCancel(a, 'Cancelled')
                        amount = String(a).trim()
                        const d = await text({ message: 'Expense description', initialValue: description })
                        assertNotCancel(d, 'Cancelled')
                        description = String(d).trim()
                        const ed = await text({ message: 'Expense date (YYYY-MM-DD)', initialValue: expenseDate })
                        assertNotCancel(ed, 'Cancelled')
                        expenseDate = String(ed).trim()
                    }
                    if (!amount || !description) {
                        throw new Error('expense add requires --amount and --description (or --interactive)')
                    }
                    const created = addInvoiceExpense(db, {
                        invoiceId,
                        amountCents: parseMoneyToCents(amount),
                        description,
                        expenseDate,
                    })
                    console.log(`Added expense ${created.id} to invoice ${invoiceId}`)
                    return
                }
                if (sub === 'list') {
                    const snapshot = getInvoiceSnapshot(db, invoiceId)
                    if (snapshot.expenses.length === 0) {
                        console.log('No expenses found.')
                        return
                    }
                    printTable(
                        ['ID', 'Date', 'Description', 'Amount'],
                        snapshot.expenses.map(expense => [
                            String(expense.id),
                            expense.expense_date,
                            expense.description,
                            formatUsd(expense.amount_cents),
                        ]),
                        { colAligns: ['right', 'left', 'left', 'right'] },
                    )
                    return
                }
                if (sub === 'remove') {
                    if (!argv['expense-id']) {
                        throw new Error('expense remove requires --expense-id')
                    }
                    removeInvoiceExpense(db, invoiceId, Number(argv['expense-id']))
                    console.log(`Removed expense ${argv['expense-id']} from invoice ${invoiceId}`)
                    return
                }
                throw new Error('invoice expense requires subaction add|list|remove')
            }

            const snapshot = getInvoiceSnapshot(db, invoiceId)
            const view = buildInvoicePreviewView(snapshot, loadConfig(paths.configPath))

            if (argv.action === 'show' || argv.action === 'preview') {
                printInvoicePreview(view)
                return
            }

            if (argv.action === 'generate') {
                if (snapshot.duplicateEntries.length > 0) {
                    const duplicatedEntryIds = Array.from(new Set(snapshot.duplicateEntries.map(item => item.entry_id)))
                    const duplicateInvoiceRefs = Array.from(
                        new Set(snapshot.duplicateEntries.map(item => `@${item.invoice_number}`)),
                    )
                    throw new Error(
                        `Cannot generate invoice: ${duplicatedEntryIds.length} entr${
                            duplicatedEntryIds.length === 1 ? 'y is' : 'ies are'
                        } already included on another invoice (${duplicateInvoiceRefs.join(', ')}).`,
                    )
                }
                if (argv.preview) {
                    printInvoicePreview(view)
                    console.log('')
                }
                const hasTypst = Bun.spawnSync({ cmd: ['typst', '--version'], stdout: 'pipe', stderr: 'pipe' })
                if (hasTypst.exitCode !== 0) {
                    throw new Error('Typst binary not found. Install typst first, then re-run invoice generate.')
                }
                const outputDir = String(argv.out ?? defaultInvoiceOutputDir()).trim()
                mkdirSync(outputDir, { recursive: true })
                const { typPath, pdfPath } = writeTypstInvoice(view, outputDir)
                const compiled = Bun.spawnSync({
                    cmd: ['typst', 'compile', typPath, pdfPath],
                    stdout: 'pipe',
                    stderr: 'pipe',
                })
                if (compiled.exitCode !== 0) {
                    throw new Error(`Typst compile failed: ${compiled.stderr.toString().trim() || 'unknown error'}`)
                }
                markInvoiceGenerated(db, invoiceId, pdfPath)
                console.log(`Generated invoice PDF: ${pdfPath}`)
                return
            }

            throw new Error(`Unsupported invoice action: ${argv.action}`)
        },
    )

    cli.command(
        'completion <shell>',
        'Generate or install shell completion script',
        (y: any) =>
            y
                .positional('shell', { choices: ['fish', 'bash', 'zsh'] as const })
                .option('install', {
                    type: 'boolean',
                    default: false,
                    describe: 'Install completion file to default shell path',
                })
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
        (y: any) =>
            y.positional('action', {
                choices: ['up', 'status'] as const,
                describe: 'Migration action: apply pending migrations or inspect status',
            }),
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
        'Show or update config and invoice header profile',
        (y: any) =>
            y
                .positional('action', {
                    choices: ['show', 'invoice-contractor'] as const,
                    default: 'show',
                })
                .option('name', { type: 'string', describe: 'Contractor full name' })
                .option('company', { type: 'string', describe: 'Contractor company/legal name' })
                .option('email', { type: 'string', describe: 'Contractor contact email' })
                .option('phone', { type: 'string', describe: 'Contractor contact phone' })
                .option('address-line1', { type: 'string', describe: 'Contractor address line 1' })
                .option('address-line2', { type: 'string', describe: 'Contractor address line 2' })
                .option('city', { type: 'string', describe: 'Contractor city' })
                .option('state', { type: 'string', describe: 'Contractor state/region' })
                .option('postal-code', { type: 'string', describe: 'Contractor postal code' })
                .option('country', { type: 'string', describe: 'Contractor country' })
                .example('$0 config', 'Show profile, paths, and current config')
                .example(
                    '$0 config invoice-contractor --name "Your Name" --company "Your Company"',
                    'Set contractor header',
                ),
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

            if (action === 'invoice-contractor') {
                const hasAny =
                    Boolean(argv.name) ||
                    Boolean(argv.company) ||
                    Boolean(argv.email) ||
                    Boolean(argv.phone) ||
                    Boolean(argv['address-line1']) ||
                    Boolean(argv['address-line2']) ||
                    Boolean(argv.city) ||
                    Boolean(argv.state) ||
                    Boolean(argv['postal-code']) ||
                    Boolean(argv.country)
                if (!hasAny) {
                    console.log(JSON.stringify(config.invoiceContractor ?? {}, null, 2))
                    return
                }
                const updated = {
                    ...config,
                    invoiceContractor: {
                        ...config.invoiceContractor,
                        name: argv.name ?? config.invoiceContractor?.name,
                        company: argv.company ?? config.invoiceContractor?.company,
                        email: argv.email ?? config.invoiceContractor?.email,
                        phone: argv.phone ?? config.invoiceContractor?.phone,
                        addressLine1: argv['address-line1'] ?? config.invoiceContractor?.addressLine1,
                        addressLine2: argv['address-line2'] ?? config.invoiceContractor?.addressLine2,
                        city: argv.city ?? config.invoiceContractor?.city,
                        state: argv.state ?? config.invoiceContractor?.state,
                        postalCode: argv['postal-code'] ?? config.invoiceContractor?.postalCode,
                        country: argv.country ?? config.invoiceContractor?.country,
                    },
                }
                saveConfig(paths.configPath, updated)
                console.log('Updated invoice contractor profile')
                console.log(JSON.stringify(updated.invoiceContractor, null, 2))
                return
            }
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
