import type { Shell } from '../lib/types'

const topLevel = ['add', 'edit', 'report', 'list', 'client', 'project', 'delete', 'restore', 'completion', 'migrate', 'config']

export function completionScript(shell: Shell): string {
  switch (shell) {
    case 'fish':
      return `complete -c stint -f\ncomplete -c stint -n '__fish_use_subcommand' -a '${topLevel.join(' ')}'\n`
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
}
complete -F _stint_complete stint
`
    case 'zsh':
      return `#compdef stint\n_arguments '1: :(${topLevel.join(' ')})'\n`
  }
}
