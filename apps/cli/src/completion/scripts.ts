import type { Shell } from '../lib/types'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const topLevel = [
  'add',
  'edit',
  'delete',
  'restore',
  'report',
  'list',
  'track',
  'client',
  'project',
  'completion',
  'migrate',
  'config',
]
const globalFlags = ['help', 'version', 'profile', 'db']

export function completionScript(shell: Shell): string {
  switch (shell) {
    case 'fish':
      return `complete -c stint -f
complete -c stint -n '__fish_use_subcommand' -a '${topLevel.join(' ')}'

function __stint_clients
  command stint __complete clients 2>/dev/null
end

function __stint_targets
  command stint __complete targets 2>/dev/null
end

function __stint_projects
  set -l client ''
  set -l tokens (commandline -opc)
  for i in (seq (count $tokens))
    if test "$tokens[$i]" = '--client'
      set -l next (math $i + 1)
      if test $next -le (count $tokens)
        set client $tokens[$next]
      end
    end
  end

  if test -n "$client"
    command stint __complete projects --client "$client" 2>/dev/null
  else
    command stint __complete projects 2>/dev/null
  end
end

complete -c stint -l help
complete -c stint -l version
complete -c stint -l profile -a 'development production'
complete -c stint -l db -r

complete -c stint -n '__fish_seen_subcommand_from client' -a 'add list edit archive'
complete -c stint -n '__fish_seen_subcommand_from project' -a 'add list edit archive'
complete -c stint -n '__fish_seen_subcommand_from track' -a 'start stop status'
complete -c stint -n '__fish_seen_subcommand_from migrate' -a 'up status'
complete -c stint -n '__fish_seen_subcommand_from config' -a 'show set-defaults reset-defaults'
complete -c stint -n '__fish_seen_subcommand_from completion' -a 'fish bash zsh'

complete -c stint -n '__fish_seen_subcommand_from add track' -a '(__stint_targets)'
complete -c stint -n '__fish_seen_subcommand_from client' -a '(__stint_clients)'
complete -c stint -n '__fish_seen_subcommand_from project' -a '(__stint_projects)'

complete -c stint -l client -r -a '(__stint_clients)'
complete -c stint -l project -r -a '(__stint_projects)'
`
    case 'bash':
      return `# bash completion for stint
_stint_complete() {
  local cur prev
  COMPREPLY=()
  cur="${'$'}{COMP_WORDS[COMP_CWORD]}"
  prev="${'$'}{COMP_WORDS[COMP_CWORD-1]}"
  if [[ ${'$'}COMP_CWORD -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "${topLevel.join(' ')}" -- "${'$'}cur") )
    return 0
  fi
  if [[ "${'$'}cur" == --* ]]; then
    COMPREPLY=( $(compgen -W "${globalFlags.map(flag => `--${flag}`).join(' ')}" -- "${'$'}cur") )
    return 0
  fi
}
complete -F _stint_complete stint
`
    case 'zsh':
      return `#compdef stint\n_arguments '1: :(${topLevel.join(' ')})'\n`
  }
}

function resolveHome(env: NodeJS.ProcessEnv): string {
  const home = env.HOME ?? env.USERPROFILE
  if (!home) {
    throw new Error('Cannot resolve home directory for completion install')
  }
  return home
}

function expandHomePath(inputPath: string, env: NodeJS.ProcessEnv): string {
  if (inputPath === '~') {
    return resolveHome(env)
  }
  if (inputPath.startsWith('~/')) {
    return join(resolveHome(env), inputPath.slice(2))
  }
  return inputPath
}

export function defaultCompletionInstallPath(shell: Shell, env: NodeJS.ProcessEnv = process.env): string {
  const home = resolveHome(env)
  const xdgConfig = env.XDG_CONFIG_HOME ?? join(home, '.config')
  const xdgData = env.XDG_DATA_HOME ?? join(home, '.local', 'share')

  switch (shell) {
    case 'fish':
      return join(xdgConfig, 'fish', 'completions', 'stint.fish')
    case 'bash':
      return join(xdgData, 'bash-completion', 'completions', 'stint')
    case 'zsh':
      return join(xdgData, 'zsh', 'site-functions', '_stint')
  }
}

export function installCompletionScript(
  shell: Shell,
  script: string,
  options?: {
    path?: string
    env?: NodeJS.ProcessEnv
  },
): string {
  const env = options?.env ?? process.env
  const resolvedPath = options?.path
    ? expandHomePath(options.path, env)
    : defaultCompletionInstallPath(shell, env)
  const parent = dirname(resolvedPath)
  mkdirSync(parent, { recursive: true })
  writeFileSync(resolvedPath, script, 'utf8')
  return resolvedPath
}
