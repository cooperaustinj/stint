# AGENTS.md

## Local Testing Safety (Do Not Pollute User Data)

When running manual CLI checks, never use the repository development database at `.stint/dev/stint.db`.

### Rules
- Do not run manual smoke commands against `--profile development`.
- Use `--db` (or `STINT_DB_PATH`) to point manual checks at an isolated DB file under `/tmp`.
- Keep automated tests on in-memory SQLite (or temp DB paths under `/tmp`).
- If any manual data was created accidentally, report it immediately.

### Why
`development` profile writes to repo-local `.stint/dev/*`, which is shared with the user and should be treated as user-owned data.

### Safe manual smoke test pattern (`--db`)
```bash
TMP_DB="/tmp/stint-agent-$USER-$$.db"
bun run dev -- --profile production --db "$TMP_DB" config
bun run dev -- --profile production --db "$TMP_DB" client add "Example Client"
bun run dev -- --profile production --db "$TMP_DB" project add example "Example Project" --client example-client
bun run dev -- --profile production --db "$TMP_DB" add example-client:example 30m "smoke test"
```

### Safe linked-command pattern
```bash
TMP_DB="/tmp/stint-agent-$USER-$$.db"
stint --profile production --db "$TMP_DB" config
```

### Cleanup example
```bash
rm -f "$TMP_DB"
```

### Optional quick helper
```bash
alias stint_tmp='TMP_DB="/tmp/stint-agent-$USER-$$.db"; stint --profile production --db "$TMP_DB"'
```

Then run:
```bash
stint_tmp config
```
