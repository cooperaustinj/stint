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
    'invoice',
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

complete -c stint -n '__fish_seen_subcommand_from client' -a 'add list edit archive billing'
complete -c stint -n '__fish_seen_subcommand_from project' -a 'add list edit archive'
complete -c stint -n '__fish_seen_subcommand_from track' -a 'start stop status'
complete -c stint -n '__fish_seen_subcommand_from migrate' -a 'up status'
complete -c stint -n '__fish_seen_subcommand_from config' -a 'show invoice-contractor'
complete -c stint -n '__fish_seen_subcommand_from completion' -a 'fish bash zsh'
complete -c stint -n '__fish_seen_subcommand_from invoice' -a 'create list show preview generate entries expense payment'

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
  local words=("${'$'}{COMP_WORDS[@]}")
  local cmd="${'$'}{COMP_WORDS[1]}"
  local sub="${'$'}{COMP_WORDS[2]}"

  _stint_clients() {
    command stint __complete clients 2>/dev/null
  }

  _stint_projects() {
    local c="${'$'}1"
    if [[ -n "${'$'}c" ]]; then
      command stint __complete projects --client "${'$'}c" 2>/dev/null
    else
      command stint __complete projects 2>/dev/null
    fi
  }

  _stint_targets() {
    command stint __complete targets 2>/dev/null
  }

  _stint_find_client_flag() {
    local i
    for ((i=1; i<${'$'}{#words[@]}; i++)); do
      if [[ "${'$'}{words[$i]}" == "--client" ]]; then
        echo "${'$'}{words[$((i+1))]}"
        return 0
      fi
      if [[ "${'$'}{words[$i]}" == --client=* ]]; then
        echo "${'$'}{words[$i]#--client=}"
        return 0
      fi
    done
    return 0
  }

  if [[ ${'$'}COMP_CWORD -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "${topLevel.join(' ')}" -- "${'$'}cur") )
    return 0
  fi

  if [[ "${'$'}prev" == "--client" ]]; then
    COMPREPLY=( $(compgen -W "$(_stint_clients)" -- "${'$'}cur") )
    return 0
  fi
  if [[ "${'$'}prev" == "--project" ]]; then
    local client_val
    client_val="$(_stint_find_client_flag)"
    COMPREPLY=( $(compgen -W "$(_stint_projects "${'$'}client_val")" -- "${'$'}cur") )
    return 0
  fi

  if [[ ${'$'}COMP_CWORD -eq 2 ]]; then
    case "${'$'}cmd" in
      client) COMPREPLY=( $(compgen -W "add list edit archive billing" -- "${'$'}cur") ); return 0 ;;
      project) COMPREPLY=( $(compgen -W "add list edit archive" -- "${'$'}cur") ); return 0 ;;
      track) COMPREPLY=( $(compgen -W "start stop status" -- "${'$'}cur") ); return 0 ;;
      migrate) COMPREPLY=( $(compgen -W "up status" -- "${'$'}cur") ); return 0 ;;
      config) COMPREPLY=( $(compgen -W "show invoice-contractor" -- "${'$'}cur") ); return 0 ;;
      completion) COMPREPLY=( $(compgen -W "fish bash zsh" -- "${'$'}cur") ); return 0 ;;
      invoice) COMPREPLY=( $(compgen -W "create list show preview generate entries expense payment" -- "${'$'}cur") ); return 0 ;;
    esac
  fi

  if [[ "${'$'}cmd" == "add" || ("${'$'}cmd" == "track" && "${'$'}sub" == "start") ]]; then
    if [[ ${'$'}COMP_CWORD -eq 2 ]]; then
      COMPREPLY=( $(compgen -W "$(_stint_targets)" -- "${'$'}cur") )
      return 0
    fi
  fi

  if [[ "${'$'}cmd" == "client" && ("${'$'}sub" == "edit" || "${'$'}sub" == "archive" || "${'$'}sub" == "billing") ]]; then
    if [[ ${'$'}COMP_CWORD -eq 3 ]]; then
      COMPREPLY=( $(compgen -W "$(_stint_clients)" -- "${'$'}cur") )
      return 0
    fi
  fi

  if [[ "${'$'}cmd" == "project" && "${'$'}sub" != "add" && "${'$'}sub" != "list" ]]; then
    if [[ ${'$'}COMP_CWORD -eq 3 ]]; then
      COMPREPLY=( $(compgen -W "$(_stint_projects)" -- "${'$'}cur") )
      return 0
    fi
  fi

  if [[ "${'$'}cur" == --* ]]; then
    COMPREPLY=( $(compgen -W "${globalFlags.map(flag => `--${flag}`).join(' ')}" -- "${'$'}cur") )
    return 0
  fi
}
complete -F _stint_complete stint
`
        case 'zsh':
            return `#compdef stint

_stint_clients() {
  reply=($(command stint __complete clients 2>/dev/null))
}

_stint_projects() {
  local client="$1"
  if [[ -n "$client" ]]; then
    reply=($(command stint __complete projects --client "$client" 2>/dev/null))
  else
    reply=($(command stint __complete projects 2>/dev/null))
  fi
}

_stint_targets() {
  reply=($(command stint __complete targets 2>/dev/null))
}

_stint() {
  local context state line
  typeset -A opt_args
  local -a subcommands
  subcommands=(${topLevel.join(' ')})

  _arguments -C \
    '--help[Show help]' \
    '--version[Show version]' \
    '--profile[Data profile]:profile:(development production)' \
    '--db[Override SQLite DB path]:db path:_files' \
    '1:command:->command' \
    '*::args:->args'

  case "$state" in
    command)
      _describe 'command' subcommands
      return
      ;;
    args)
      case "$line[1]" in
        add)
          if (( CURRENT == 2 )); then
            _stint_targets
            _describe 'target' reply
            return
          fi
          ;;
        track)
          if (( CURRENT == 2 )); then
            _describe 'action' "start stop status"
            return
          fi
          if [[ "$line[2]" == "start" && CURRENT -eq 3 ]]; then
            _stint_targets
            _describe 'target' reply
            return
          fi
          ;;
        client)
          if (( CURRENT == 2 )); then
            _describe 'action' "add list edit archive billing"
            return
          fi
          if [[ "$line[2]" == "edit" || "$line[2]" == "archive" || "$line[2]" == "billing" ]] && (( CURRENT == 3 )); then
            _stint_clients
            _describe 'client' reply
            return
          fi
          ;;
        project)
          if (( CURRENT == 2 )); then
            _describe 'action' "add list edit archive"
            return
          fi
          if [[ "$line[2]" == "edit" || "$line[2]" == "archive" ]] && (( CURRENT == 3 )); then
            _stint_projects ""
            _describe 'project' reply
            return
          fi
          ;;
        invoice)
          if (( CURRENT == 2 )); then
            _describe 'action' "create list show preview generate entries expense payment"
            return
          fi
          ;;
        completion)
          if (( CURRENT == 2 )); then
            _describe 'shell' "fish bash zsh"
            return
          fi
          ;;
        migrate)
          if (( CURRENT == 2 )); then
            _describe 'action' "up status"
            return
          fi
          ;;
        config)
          if (( CURRENT == 2 )); then
            _describe 'action' "show invoice-contractor"
            return
          fi
          ;;
      esac

      if [[ "$words[CURRENT-1]" == "--client" ]]; then
        _stint_clients
        _describe 'client' reply
        return
      fi

      if [[ "$words[CURRENT-1]" == "--project" ]]; then
        local client=""
        integer i
        for ((i=1; i<$#words; i++)); do
          if [[ "$words[i]" == "--client" && $((i+1)) -le $#words ]]; then
            client="$words[i+1]"
          elif [[ "$words[i]" == --client=* ]]; then
            client="${'$'}{words[i]#--client=}"
          fi
        done
        _stint_projects "$client"
        _describe 'project' reply
        return
      fi
      ;;
  esac
}

_stint "$@"
`
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
    const resolvedPath = options?.path ? expandHomePath(options.path, env) : defaultCompletionInstallPath(shell, env)
    const parent = dirname(resolvedPath)
    mkdirSync(parent, { recursive: true })
    writeFileSync(resolvedPath, script, 'utf8')
    return resolvedPath
}
