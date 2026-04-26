import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { StintConfig } from './types'

export function loadConfig(configPath: string): StintConfig {
  if (!existsSync(configPath)) {
    return {}
  }
  const raw = readFileSync(configPath, 'utf8')
  if (!raw.trim()) {
    return {}
  }
  return JSON.parse(raw) as StintConfig
}

export function saveConfig(configPath: string, config: StintConfig): void {
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8')
}
