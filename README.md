# Stint

Simple CLI time tracking app built with Bun + TypeScript.

## Stack

- Turborepo workspace
- Bun runtime/package manager
- `yargs` for CLI commands
- `@clack/prompts` for interactive flows
- `bun:sqlite` with SQL file migrations
- `oxlint` + `oxfmt`

## Quick Start

```sh
bun install
bun run check-types
bun run test
```

## Dev Data Mode

Use repo-local data/config while developing:

```sh
bun run dev -- config
```

This writes to:

- `.stint/dev/stint.db`
- `.stint/dev/config.json`

For production-style runs, use:

```sh
bun run prod -- config
```

or the linked global command `stint ...`, which always uses production profile by default.

To force an isolated SQLite file (useful for smoke checks):

```sh
bun run dev -- --db /tmp/stint-smoke.db config
```

You can also use `STINT_DB_PATH=/tmp/stint-smoke.db`.

## Local Global Install (No npm publish)

From repo root:

```sh
bun run link
```

Then run production-style:

```sh
stint --help
```

## Core Commands

```sh
bun run dev -- client add client_key "Client Name"
bun run dev -- project add project_key "Project Name" --client client_key
bun run dev -- add client_key:project_key 2h "work note"
bun run dev -- track start client_key:project_key "starting work"
bun run dev -- track status
bun run dev -- track stop
bun run dev -- report
```

Interactive add:

```sh
bun run dev -- add --interactive
```

Generate completions:

```sh
stint config
stint config set-defaults --client client_key --project project_key --report-last 20
stint config reset-defaults --yes
stint completion fish
stint completion bash
stint completion zsh
```
