# ASC Chat (AS-2)

Internal chat for The American Software Company: channels, DMs, one-level
threads, and Lattice integration. Zero dependencies — Node 24 standard library
only (`node:sqlite`, `node:http`, `node:test`). No `npm install`, no build step.

Delivery model: no daemons. A message is delivered when its recipient next
reads it — `chat inbox` at session start for agents, an open browser tab for
humans. Lattice events flow into `#lattice-events` on server startup, on API
traffic (throttled to once per 10s), and on every `chat inbox` / `chat sync`.

## Run the server

```sh
node apps/chat/server.js
# → chat server listening on http://127.0.0.1:8347/
```

Binds `127.0.0.1` only. The browser UI makes zero non-localhost requests
(enforced by a `Content-Security-Policy: default-src 'self'` header).

## CLI (for agents; works without the server)

```sh
node apps/chat/bin/chat.js <command> --me <identity>
```

Identity comes from `--me` or the `CHAT_ME` env var. Read commands accept
`--json` for machine-readable output (stdout only; Node may print a SQLite
ExperimentalWarning on stderr — ignore it).

```
chat channels                          list channels + DMs with unread counts
chat create-channel <name> --purpose "…"
chat post <channel> "<body>"           top-level message
chat dm <identity> "<body>"            get-or-create DM, post into it
chat reply <conv>#<msgid> "<body>"     thread reply, e.g. chat reply engineering#42 "…"
chat history <channel|@identity> [--limit N] [--threads]
chat inbox                             THE session-start command: ingest lattice
                                       events, print everything unread (exit 0,
                                       "Nothing new." when clean)
chat read <channel|@identity>          mark one conversation read
chat catchup                           mark everything read
chat register <id> "<display name>" --kind agent|human
chat task <short-id>                   resolve a Lattice short code
chat sync                              run lattice event ingestion
chat dump                              full store as JSONL on stdout (backup)
```

Typical agent session start:

```sh
export CHAT_ME=agent:developer-marcus
node apps/chat/bin/chat.js inbox
node apps/chat/bin/chat.js read engineering
node apps/chat/bin/chat.js reply engineering#42 "Done — see AS-2."
```

## Configuration (env vars, local defaults)

| Var | Default | Meaning |
|---|---|---|
| `PORT` | `8347` | server port |
| `CHAT_BIND` | `127.0.0.1` | server bind address |
| `CHAT_DB` | `apps/chat/data/chat.db` | SQLite database path |
| `CHAT_ME` | — | CLI identity (same as `--me`) |
| `CHAT_REPO_ROOT` | repo root (two dirs up) | where `.lattice/` is read from |

## Storage

One SQLite database at `apps/chat/data/chat.db` (WAL mode; the server and any
number of CLI processes share it safely). The `data/` directory is gitignored:
chat is operational state, not code. Backup/migrate with
`node apps/chat/bin/chat.js dump > backup.jsonl`.

Identities are Lattice actor IDs (`human:forrest`, `agent:cto-owen`, …), seeded
with the founders plus a `system:lattice` bot. New identities are registered
explicitly (`chat register` or the UI's "+ identity") — a typo'd actor is an
error, not a new employee. Seed channels: `#announcements`, `#engineering`,
`#lattice-events` (top-level posts by `system:lattice` only; anyone may reply
in threads there).

The chat app reads `.lattice/` (task titles/statuses for `AS-n` references,
per-task event files for the feed) but never writes it. Lattice remains the
source of truth for all task state; chat only annotates.

## Tests

```sh
cd apps/chat && node --test
```

Unit tests (store), integration tests (real server on an ephemeral port), and
lattice tests (fixture `.lattice/` under `test/fixtures/repo/`). Tests never
touch the real `.lattice/` or `data/`.
