# Stint

Stint is a CLI-first time tracker focused on fast entry capture.

It is designed for simple, high-frequency workflows:

- Log a duration quickly (`2h`, `15m`, `1h30m`)
- Optionally log start/end ranges (`3:13am - 4pm`)
- Assign work to `client:project`
- Start/stop active tracking with a single in-progress timer
- Report recent work with practical filters

## Quick Start

### 1. Install dependencies

```sh
bun install
```

### 2. Install `stint` locally on your machine

From the repo root:

```sh
bun run link
```

This registers the CLI command so you can run `stint` directly.

### 3. Verify install

```sh
stint --help
```

### 4. Create your first client/project

```sh
stint client add acme "Acme"
stint project add backend "Backend" --client acme
```

### 5. Add an entry

```sh
stint add acme:backend 2h "worked on API"
```

### 6. View recent entries

```sh
stint report
```

## Command Reference

Use `stint <command> --help` for full flags and examples.

### Entries

Add an entry:

```sh
stint add <client:project> <duration> <note...>
```

Examples:

```sh
stint add acme:backend 2h "worked on API"
stint add acme:backend 1h30m "code review"
stint add acme:backend --start 9:15am --end 11am "incident follow-up"
stint add acme:backend 2h "backfill" --date 2026-04-20
stint add --interactive
```

Edit/delete/restore entries:

```sh
stint edit <id> [--date YYYY-MM-DD] [--duration ...] [--start ... --end ...] [--note-text ...]
stint delete <id>
stint restore <id>
```

### Tracking (Start/Stop)

Start an active timer:

```sh
stint track start <client:project> <note...>
```

Check status:

```sh
stint track status
```

Stop timer:

```sh
stint track stop
```

Non-interactive stop with overrides:

```sh
stint track stop --non-interactive --duration-override 1h30m --note-text "final note"
```

### Reporting

Default report:

```sh
stint report
```

Filters:

```sh
stint report --last 25
stint report --from 2026-04-01 --to 2026-04-30
stint report --client acme --project backend
```

Soft-deleted entries:

```sh
stint report --include-deleted
stint report --only-deleted
```

Optional technical columns:

```sh
stint report --show-deleted --show-overlap
```

`list` is an alias for `report`.

### Clients and Projects

Clients:

```sh
stint client add acme "Acme"
stint client list
stint client edit acme "Acme Corp"
stint client archive acme
```

Projects:

```sh
stint project add backend "Backend" --client acme
stint project list
stint project edit backend "Backend API"
stint project archive backend
```

### Configuration

Show active profile, resolved DB/config paths, and config:

```sh
stint config
```

Contractor invoice header profile:

```sh
stint config invoice-contractor --name "Your Name" --company "Your Co" --email you@example.com
```

### Migrations

Migrations auto-run on startup before command execution.

Manual commands:

```sh
stint migrate status
stint migrate up
```

### Shell Completions

Print completion scripts:

```sh
stint completion fish
stint completion zsh
stint completion bash
```

Install completion files directly:

```sh
stint completion fish --install
stint completion zsh --install
stint completion bash --install
```

Fish completions include dynamic values from your local Stint data (client keys, project keys, and `client:project` targets).

Install to a custom path:

```sh
stint completion fish --install --path ~/.config/fish/completions/stint.fish
```

### Invoicing

Set client billing profile/rate:

```sh
stint client billing acme --hourly-rate 125 --billing-name "Acme Accounts Payable" --billing-email ap@acme.com
```

Store payment details in macOS Keychain:

```sh
stint invoice payment set --account-name "Your Name" --bank-name "Bank" --routing-number 111000111 --account-number 123456789
```

Create a draft invoice from date range + client (optional project):

```sh
stint invoice create --client acme --from 2026-04-01 --to 2026-04-30
```

Preview invoice data in terminal:

```sh
stint invoice preview @1000
```

Add and manage expenses:

```sh
stint invoice expense @1000 add --amount 25.00 --description "Hosting"
stint invoice expense @1000 list
stint invoice expense @1000 remove --expense-id 1
```

Generate PDF with Typst:

```sh
stint invoice generate @1000 --preview
```

Default output location is `~/Downloads` unless you pass `--out`.

## Local Development

Use these commands when developing the project itself.

### Run in development profile

```sh
bun run dev -- config
```

Development profile stores data in repo-local paths:

- `.stint/dev/stint.db`
- `.stint/dev/config.json`

### Run in production profile from source

```sh
bun run prod -- config
```

Production profile uses OS-specific app data/config directories.

### Use an explicit SQLite file during testing/smoke runs

```sh
stint --profile production --db /tmp/stint-smoke.db report
```

or:

```sh
STINT_DB_PATH=/tmp/stint-smoke.db stint report
```

### Workspace tooling

```sh
bun run check-types
bun run test
bun run lint
bun run format:check
```

## Data Model Notes

- `entries` supports completed and active tracking rows.
- Effective duration is persisted in `duration_minutes`.
- Tracking rows keep:
  - `calculated_duration_minutes`
  - optional `duration_override_minutes`
- Only one active tracking row is allowed at a time (enforced in SQLite).

## License

This project is licensed under the GNU Affero General Public License v3.0.
See [LICENSE](./LICENSE).
