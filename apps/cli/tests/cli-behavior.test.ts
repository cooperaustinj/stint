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
    expect(out.output).toContain(`\"dbPath\": \"${dbPath}\"`)
  })

  test('config set-defaults requires at least one flag', () => {
    const cwd = makeTempCwd()
    const out = runCli(['config', 'set-defaults'], cwd)
    expect(out.code).toBe(1)
    expect(out.output).toContain('Provide at least one of --client, --project, --report-last')
  })

  test('config reset-defaults requires --yes', () => {
    const cwd = makeTempCwd()
    const out = runCli(['config', 'reset-defaults'], cwd)
    expect(out.code).toBe(1)
    expect(out.output).toContain('reset-defaults requires --yes')
  })

  test('config reset-defaults clears stored defaults', () => {
    const cwd = makeTempCwd()
    const set = runCli(['config', 'set-defaults', '--client', 'client_key', '--project', 'project_key', '--report-last', '5'], cwd)
    expect(set.code).toBe(0)

    const reset = runCli(['config', 'reset-defaults', '--yes'], cwd)
    expect(reset.code).toBe(0)
    expect(reset.output).toContain('Cleared stored defaults')

    const show = runCli(['config'], cwd)
    expect(show.output).toContain('"config": {}')
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
})
