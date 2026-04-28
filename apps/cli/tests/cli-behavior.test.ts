import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tempDirs: string[] = []

function makeTempCwd(): string {
    const dir = mkdtempSync(join(tmpdir(), 'stint-cli-test-'))
    tempDirs.push(dir)
    return dir
}

function runCli(args: string[], cwd: string): { code: number; output: string } {
    const cliPath = join('/Users/cooper/Code/stint/apps/cli/src/index.ts')
    const proc = Bun.spawnSync({
        cmd: ['bun', cliPath, '--profile', 'development', ...args],
        cwd,
        stdout: 'pipe',
        stderr: 'pipe',
    })

    return {
        code: proc.exitCode,
        output: `${proc.stdout.toString()}\n${proc.stderr.toString()}`,
    }
}

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true })
    }
})

describe('CLI behavior', () => {
    test('config show includes profile and resolved paths', () => {
        const cwd = makeTempCwd()
        const out = runCli(['config'], cwd)
        expect(out.code).toBe(0)
        expect(out.output).toContain('"mode": "development"')
        expect(out.output).toContain('"dbPath"')
        expect(out.output).toContain('"configPath"')
    })

    test('db override uses explicit sqlite path', () => {
        const cwd = makeTempCwd()
        const dbPath = join(cwd, 'isolated', 'stint-test.db')
        const out = runCli(['--db', dbPath, 'config'], cwd)
        expect(out.code).toBe(0)
        expect(out.output).toContain(`"dbPath": "${dbPath}"`)
    })

    test('config rejects removed set-defaults action', () => {
        const cwd = makeTempCwd()
        const out = runCli(['config', 'set-defaults'], cwd)
        expect(out.code).toBe(1)
        expect(out.output).toContain('Invalid values:')
        expect(out.output).toContain('Given: "set-defaults"')
    })

    test('config rejects removed reset-defaults action', () => {
        const cwd = makeTempCwd()
        const out = runCli(['config', 'reset-defaults'], cwd)
        expect(out.code).toBe(1)
        expect(out.output).toContain('Invalid values:')
        expect(out.output).toContain('Given: "reset-defaults"')
    })

    test('track start/status/stop success path', () => {
        const cwd = makeTempCwd()
        expect(runCli(['client', 'add', 'clientkey', 'Client Name'], cwd).code).toBe(0)
        expect(runCli(['project', 'add', 'projectkey', 'Project Name', '--client', 'clientkey'], cwd).code).toBe(0)

        const start = runCli(['track', 'start', 'clientkey:projectkey', 'starting work'], cwd)
        expect(start.code).toBe(0)
        expect(start.output).toContain('Started tracking entry')

        const status = runCli(['track', 'status'], cwd)
        expect(status.code).toBe(0)
        expect(status.output).toContain('Active: clientkey:projectkey')

        const stop = runCli(['track', 'stop', '--non-interactive'], cwd)
        expect(stop.code).toBe(0)
        expect(stop.output).toContain('Stopped tracking entry')
    })

    test('track stop fails when no active timer exists', () => {
        const cwd = makeTempCwd()
        const out = runCli(['track', 'stop', '--non-interactive'], cwd)
        expect(out.code).toBe(1)
        expect(out.output).toContain('No active tracking entry to stop')
    })

    test('track start rejects invalid target format', () => {
        const cwd = makeTempCwd()
        const out = runCli(['track', 'start', 'not-valid-target', 'note'], cwd)
        expect(out.code).toBe(1)
        expect(out.output).toContain('Invalid target format')
    })

    test('track start accepts --time override', () => {
        const cwd = makeTempCwd()
        expect(runCli(['client', 'add', 'clientkey', 'Client Name'], cwd).code).toBe(0)
        expect(runCli(['project', 'add', 'projectkey', 'Project Name', '--client', 'clientkey'], cwd).code).toBe(0)

        const start = runCli(['track', 'start', 'clientkey:projectkey', 'late start', '--time', '9am'], cwd)
        expect(start.code).toBe(0)
        expect(start.output).toContain('Started tracking entry')

        const status = runCli(['track', 'status'], cwd)
        expect(status.code).toBe(0)
        expect(status.output).toMatch(/started \d{4}-\d{2}-\d{2} \d{1,2}:\d{2} [AP]M/)
    })

    test('track start accepts --time with note before flag', () => {
        const cwd = makeTempCwd()
        expect(runCli(['client', 'add', 'clientkey', 'Client Name'], cwd).code).toBe(0)
        expect(runCli(['project', 'add', 'projectkey', 'Project Name', '--client', 'clientkey'], cwd).code).toBe(0)

        const start = runCli(
            ['track', 'start', 'clientkey:projectkey', 'Working', 'on', 'details', '--time', '9am'],
            cwd,
        )
        expect(start.code).toBe(0)
        expect(start.output).toContain('Started tracking entry')

        const status = runCli(['track', 'status'], cwd)
        expect(status.code).toBe(0)
        expect(status.output).toContain('Note: Working on details')
    })

    test('track start accepts --time= inline form', () => {
        const cwd = makeTempCwd()
        expect(runCli(['client', 'add', 'clientkey', 'Client Name'], cwd).code).toBe(0)
        expect(runCli(['project', 'add', 'projectkey', 'Project Name', '--client', 'clientkey'], cwd).code).toBe(0)

        const start = runCli(['track', 'start', 'clientkey:projectkey', '--time=10:15am', 'Stage', 'two'], cwd)
        expect(start.code).toBe(0)
        expect(start.output).toContain('Started tracking entry')
        const status = runCli(['track', 'status'], cwd)
        expect(status.code).toBe(0)
        expect(status.output).toContain('Note: Stage two')
    })

    test('track start rejects invalid --time', () => {
        const cwd = makeTempCwd()
        expect(runCli(['client', 'add', 'clientkey', 'Client Name'], cwd).code).toBe(0)
        expect(runCli(['project', 'add', 'projectkey', 'Project Name', '--client', 'clientkey'], cwd).code).toBe(0)

        const out = runCli(['track', 'start', 'clientkey:projectkey', 'note', '--time', 'not-a-time'], cwd)
        expect(out.code).toBe(1)
        expect(out.output).toContain('Could not parse time')
    })

    test('completion backend returns dynamic clients/projects/targets', () => {
        const cwd = makeTempCwd()
        expect(runCli(['client', 'add', 'acme', 'Acme'], cwd).code).toBe(0)
        expect(runCli(['project', 'add', 'backend', 'Backend', '--client', 'acme'], cwd).code).toBe(0)

        const clients = runCli(['__complete', 'clients'], cwd)
        expect(clients.code).toBe(0)
        expect(clients.output).toContain('acme')

        const projects = runCli(['__complete', 'projects', '--client', 'acme'], cwd)
        expect(projects.code).toBe(0)
        expect(projects.output).toContain('backend')

        const targets = runCli(['__complete', 'targets'], cwd)
        expect(targets.code).toBe(0)
        expect(targets.output).toContain('acme:backend')
    })

    test('report supports only-deleted filter', () => {
        const cwd = makeTempCwd()
        expect(runCli(['client', 'add', 'clientkey', 'Client Name'], cwd).code).toBe(0)
        expect(runCli(['project', 'add', 'projectkey', 'Project Name', '--client', 'clientkey'], cwd).code).toBe(0)
        expect(runCli(['add', 'clientkey:projectkey', '30m', 'keep me'], cwd).code).toBe(0)
        expect(runCli(['delete', '1'], cwd).code).toBe(0)

        const defaultReport = runCli(['report'], cwd)
        expect(defaultReport.code).toBe(0)
        expect(defaultReport.output).toContain('No entries found.')

        const deletedOnly = runCli(['report', '--only-deleted'], cwd)
        expect(deletedOnly.code).toBe(0)
        expect(deletedOnly.output).toContain('keep me')
    })

    test('report can show technical columns with flags', () => {
        const cwd = makeTempCwd()
        expect(runCli(['client', 'add', 'clientkey', 'Client Name'], cwd).code).toBe(0)
        expect(runCli(['project', 'add', 'projectkey', 'Project Name', '--client', 'clientkey'], cwd).code).toBe(0)
        expect(runCli(['add', 'clientkey:projectkey', '45m', 'show columns'], cwd).code).toBe(0)

        const out = runCli(['report', '--show-deleted', '--show-overlap'], cwd)
        expect(out.code).toBe(0)
        expect(out.output).toContain('Deleted')
        expect(out.output).toContain('Overlap')
    })

    test('invoice preview shows core sections and omits expenses when none', () => {
        const cwd = makeTempCwd()
        expect(runCli(['config', 'invoice-contractor', '--name', 'Jane Contractor'], cwd).code).toBe(0)
        expect(runCli(['client', 'add', 'acme', 'Acme Corp'], cwd).code).toBe(0)
        expect(
            runCli(
                [
                    'client',
                    'billing',
                    'acme',
                    '--hourly-rate',
                    '100',
                    '--billing-name',
                    'Acme Billing',
                    '--billing-email',
                    'billing@acme.test',
                ],
                cwd,
            ).code,
        ).toBe(0)
        expect(runCli(['project', 'add', 'backend', 'Backend', '--client', 'acme'], cwd).code).toBe(0)
        expect(runCli(['add', 'acme:backend', '--date', '2026-04-26', '1h', 'Invoiceable'], cwd).code).toBe(0)
        expect(
            runCli(['invoice', 'create', '--client', 'acme', '--from', '2026-04-01', '--to', '2026-04-30'], cwd).code,
        ).toBe(0)

        const preview = runCli(['invoice', 'preview', '@1000'], cwd)
        expect(preview.code).toBe(0)
        expect(preview.output).toContain('INVOICE # 1000')
        expect(preview.output).toContain('Time Entries')
        expect(preview.output).toContain('Totals')
        expect(preview.output).not.toContain('Additional Expenses')
    })

    test('invoice preview includes expenses section when expenses exist', () => {
        const cwd = makeTempCwd()
        expect(runCli(['client', 'add', 'acme', 'Acme Corp'], cwd).code).toBe(0)
        expect(runCli(['project', 'add', 'backend', 'Backend', '--client', 'acme'], cwd).code).toBe(0)
        expect(runCli(['add', 'acme:backend', '--date', '2026-04-26', '1h', 'Invoiceable'], cwd).code).toBe(0)
        expect(
            runCli(['invoice', 'create', '--client', 'acme', '--from', '2026-04-01', '--to', '2026-04-30'], cwd).code,
        ).toBe(0)
        expect(
            runCli(
                [
                    'invoice',
                    'expense',
                    '@1000',
                    'add',
                    '--amount',
                    '25.00',
                    '--description',
                    'Hosting',
                    '--date',
                    '2026-04-26',
                ],
                cwd,
            ).code,
        ).toBe(0)
        const preview = runCli(['invoice', 'preview', '@1000'], cwd)
        expect(preview.code).toBe(0)
        expect(preview.output).toContain('Billable Expenses')
        expect(preview.output).toContain('Hosting')
    })

    test('invoice payment set accepts subcommand without invoice token', () => {
        const cwd = makeTempCwd()
        const out = runCli(
            [
                'invoice',
                'payment',
                'set',
                '--account-name',
                'Jane Contractor',
                '--bank-name',
                'Example Bank',
                '--routing-number',
                '111000111',
                '--account-number',
                '123456789',
            ],
            cwd,
        )
        expect(out.code).toBe(0)
        expect(out.output).toContain('Stored payment details in macOS Keychain.')
    })

    test('invoice expense add rejects negative amount', () => {
        const cwd = makeTempCwd()
        expect(runCli(['client', 'add', 'acme', 'Acme Corp'], cwd).code).toBe(0)
        expect(runCli(['project', 'add', 'backend', 'Backend', '--client', 'acme'], cwd).code).toBe(0)
        expect(runCli(['add', 'acme:backend', '--date', '2026-04-26', '1h', 'Invoiceable'], cwd).code).toBe(0)
        expect(
            runCli(['invoice', 'create', '--client', 'acme', '--from', '2026-04-01', '--to', '2026-04-30'], cwd).code,
        ).toBe(0)

        const out = runCli(['invoice', 'expense', '@1000', 'add', '--amount', '-5.00', '--description', 'Bad'], cwd)
        expect(out.code).toBe(1)
        expect(out.output).toContain('Invalid money amount')
    })

    test('setting client hourly rate backfills zero-rate draft invoice items', () => {
        const cwd = makeTempCwd()
        expect(runCli(['client', 'add', 'tau9', 'Tau9'], cwd).code).toBe(0)
        expect(runCli(['project', 'add', 'hexion', 'Hexion', '--client', 'tau9'], cwd).code).toBe(0)
        expect(runCli(['add', 'tau9:hexion', '--date', '2026-04-26', '1h', 'Drafted before rate'], cwd).code).toBe(0)
        expect(
            runCli(['invoice', 'create', '--client', 'tau9', '--from', '2026-04-01', '--to', '2026-04-30'], cwd).code,
        ).toBe(0)

        const before = runCli(['invoice', 'preview', '@1000'], cwd)
        expect(before.code).toBe(0)
        expect(before.output).toContain('$0.00')

        const setRate = runCli(['client', 'billing', 'tau9', '--hourly-rate', '160'], cwd)
        expect(setRate.code).toBe(0)
        expect(setRate.output).toContain('Backfilled')

        const after = runCli(['invoice', 'preview', '@1000'], cwd)
        expect(after.code).toBe(0)
        expect(after.output).toContain('$160.00')
    })

    test('invoice generate fails when entries already exist on another invoice', () => {
        const cwd = makeTempCwd()
        expect(runCli(['client', 'add', 'acme', 'Acme Corp'], cwd).code).toBe(0)
        expect(runCli(['project', 'add', 'backend', 'Backend', '--client', 'acme'], cwd).code).toBe(0)
        expect(runCli(['add', 'acme:backend', '--date', '2026-04-26', '1h', 'Invoiceable once'], cwd).code).toBe(0)
        expect(
            runCli(['invoice', 'create', '--client', 'acme', '--from', '2026-04-01', '--to', '2026-04-30'], cwd).code,
        ).toBe(0)
        expect(
            runCli(['invoice', 'create', '--client', 'acme', '--from', '2026-04-01', '--to', '2026-04-30'], cwd).code,
        ).toBe(0)

        const out = runCli(['invoice', 'generate', '@1001'], cwd)
        expect(out.code).toBe(1)
        expect(out.output).toContain('Cannot generate invoice:')
        expect(out.output).toContain('already included on another invoice')
        expect(out.output).toContain('@1000')
    })
})
