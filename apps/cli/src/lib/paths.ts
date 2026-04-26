import envPaths from 'env-paths'
import { mkdirSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'

function findWorkspaceRoot(start: string): string {
  let current = start
  while (true) {
    if (Bun.file(join(current, 'turbo.json')).size > 0) {
      return current
    }
    const parent = dirname(current)
    if (parent === current) {
      return start
    }
    current = parent
  }
}

export function resolveDataPaths(
  mode: 'development' | 'production',
  cwd = process.cwd(),
  options?: {
    dbPathOverride?: string
  },
): {
  dbPath: string
  configPath: string
  mode: 'development' | 'production'
} {
  const overrideRaw = options?.dbPathOverride?.trim()
  const overrideDbPath = overrideRaw ? (isAbsolute(overrideRaw) ? overrideRaw : resolve(cwd, overrideRaw)) : undefined
  if (overrideDbPath) {
    mkdirSync(dirname(overrideDbPath), { recursive: true })
  }

  if (mode === 'development') {
    const root = findWorkspaceRoot(cwd)
    const baseDir = join(root, '.stint', 'dev')
    mkdirSync(baseDir, { recursive: true })
    return {
      dbPath: overrideDbPath ?? join(baseDir, 'stint.db'),
      configPath: join(baseDir, 'config.json'),
      mode: 'development',
    }
  }

  const paths = envPaths('stint', { suffix: '' })
  mkdirSync(paths.data, { recursive: true })
  mkdirSync(paths.config, { recursive: true })

  return {
    dbPath: overrideDbPath ?? join(paths.data, 'stint.db'),
    configPath: join(paths.config, 'config.json'),
    mode,
  }
}
