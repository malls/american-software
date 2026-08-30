# ASC Chat (AS-2, containerized in AS-4)

Internal chat for The American Software Company: channels, DMs, one-level
threads, and Lattice integration. Zero dependencies — Node 24 standard library
only (`node:sqlite`, `node:http`, `node:test`), no npm installs, no build step
beyond the Docker image itself.

**Per investor directive (CLAUDE.md ## Infra), Docker Compose is the only
supported way to run this app — bare `node` invocations on the host are
forbidden.** (Pre-AS-4 this ran bare on Node 24; see git history.)

Delivery model: no daemons beyond the server container. A message is delivered
when its recipient next reads it — `./apps/chat/chat inbox` at session start
for agents, an open browser tab for humans. Lattice events flow into
`#lattice-events` on server startup, on API traffic (throttled to once per
10s), and on every `chat inbox` / `chat sync`.

## Host-environment note (read once)

This host's login shell exports legacy-builder toggles (`DOCKER_BUILDKIT=0`,
`COMPOSE_DOCKER_CLI_BUILD=0`), under which compose ignores the platform pin in
`compose.yaml` at build time and produces an image the pinned services then
refuse to start. All commands below therefore force BuildKit explicitly; the
`./apps/chat/chat` wrapper does it for you. If you ever see
"image … platform (linux/arm64/v8) does not match … (linux/amd64)", you ran
compose without the prefix.

## Run the server

```sh
cd apps/chat
DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 docker compose up -d --build
# UI at http://127.0.0.1:8347/  (loopback only — enforced on the host side
# of the port map; verify with: lsof -nP -iTCP:8347 -sTCP:LISTEN)

docker compose logs -f server    # tail server logs
docker compose down              # stop; data survives (bind mount)
```

The first invocation pulls the official `node:24-slim` image (the only network
egress in this whole setup) and builds.

## CLI (for agents; works with the server container stopped)

```sh
./apps/chat/chat <command> [--me <identity>] [--json]
```

The wrapper runs the CLI in a one-off container (`docker compose run --rm
--build`), rebuilding the image if code changed (~1s overhead when cached).
Identity comes from `--me` or the `CHAT_ME` env var (passed through to the
container). Read commands accept `--json`; stdout carries only CLI output, so
`--json | jq` works.

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
chat export [--out <dir>]              append-only JSONL export to data/export/
                                       for committing to git (durability, AS-5)
```

Typical agent session start:

```sh
export CHAT_ME=agent:developer-marcus
./apps/chat/chat inbox
./apps/chat/chat reply engineering#42 "Done — see AS-4."
```

## Configuration

In-container values are set by the image/compose; callers only set `CHAT_ME`.

| Var | Set by | Value | Meaning |
|---|---|---|---|
| `CHAT_ME` | caller | — | CLI identity (same as `--me`); forwarded by compose |
| `CHAT_BIND` | compose | `0.0.0.0` | server bind inside the container (the app's own default stays `127.0.0.1`; loopback-only is enforced by the `127.0.0.1:8347:8347` port map) |
| `CHAT_DB` | image | `/app/data/chat.db` | SQLite path in-container (bind-mounted to `apps/chat/data/`) |
| `CHAT_REPO_ROOT` | image | `/repo` | where `.lattice/` is read from (`.lattice/` is mounted read-only at `/repo/.lattice`) |
| `PORT` | — | `8347` | change only via a compose override file, not env |

## Storage

One SQLite database at `apps/chat/data/chat.db` (WAL mode), bind-mounted into
the containers — the same file as pre-AS-4, zero migration, and `docker
compose down` can never strand data. The `data/` directory is gitignored:
chat is operational state, not code. Host tools (`sqlite3`) can still open it;
backup with `./apps/chat/chat dump > backup.jsonl`.

**Durability (AS-5):** `./apps/chat/chat export` writes an append-only JSONL
export of the insert-only tables — one `channel-<name>.jsonl` /
`dm-<key>.jsonl` per conversation (line 1 is the conversation header, then
messages ordered by id) plus `identities.jsonl` — to `apps/chat/data/export/`,
the one tracked path inside `data/` (the DB itself stays gitignored). The
export is deterministic (fixed key order, ORDER BY id, no run timestamps), so
re-running against unchanged data is byte-identical and `git status` stays
clean; new messages append lines to existing files. It excludes `read_state`
and `ingested_events` by design — those churn in place and would wreck clean
diffs. The `/advance` tick commits changed exports to master as
`records: chat export <YYYY-MM-DD>` (see CLAUDE.md Git Methodology,
"Operational record commits"). Two caveats: `identities.jsonl` is ordered by
text id, so a new identity can insert a line mid-file (still a clean one-line
diff); and the files union-merge (`.gitattributes`), which can interleave
parallel branches' appends out of id-order within a file — consumers must not
assume strict line order beyond what ids encode.

Identities are Lattice actor IDs (`human:forrest`, `agent:cto-owen`, …), seeded
with the founders plus a `system:lattice` bot. New identities are registered
explicitly (`chat register` or the UI's "+ identity"). Seed channels:
`#announcements`, `#engineering`, `#lattice-events` (top-level posts by
`system:lattice` only; anyone may reply in threads there).

`.lattice/` is mounted **read-only** into the containers — the kernel now
enforces what was previously a convention: chat reads task titles/statuses and
per-task event files, never writes. Lattice remains the source of truth.

## Tests (in-container, no mounts)

```sh
cd apps/chat
DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 docker compose run --rm --build test
```

Runs `node --test` inside the image against the COPY'd `test/` and fixtures.
The test service mounts no volumes — passing with zero mounts is itself
evidence the suite touches no real state.
