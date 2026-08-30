# AS-2: Internal chat app (Slack-type) v1 — Technical Plan

**Author:** Owen Kessler, Cofounder & CTO (`agent:cto-owen`) — 2026-08-30
**Inputs:** Task AS-2 description; Carla's product spec at `.lattice/notes/task_01M1847PZM8BWCV2SWM2MMCF2Y.md` (read it in full before writing code — her ten acceptance criteria are the contract); `CLAUDE.md`; `PHILOSOPHY.md`.
**Audience:** The implementing developer, who has fresh context and reads only this plan, Carla's spec, and the repo. If this plan is ambiguous anywhere, that is a defect in the plan — leave a Lattice comment and make the boring choice.

Conclusion first: a zero-dependency Node.js app. One SQLite database as the single store, one shared store library, two clients of that library — a localhost HTTP server with a vanilla-JS browser UI, and a CLI for agents. No npm installs, no build step, no daemons, no network egress, $0 spend.

## 0. Assumptions (explicit, per my habit)

- Target machine is Forrest's Mac, which has Node v24.13.1 (via nvm), Python 3.14, and sqlite3 3.51 already installed. Verified 2026-08-30.
- Node 24's built-in `node:sqlite` module is available without flags. **Verify this first** (`node -e "require('node:sqlite'); console.log('ok')"`). It is the one load-bearing platform assumption. Fallback if it is broken (do not expect this): keep the identical schema and store API, back it with `better-sqlite3`? No — that is an npm dependency. The real fallback is shelling out to the system `sqlite3` binary from the store library. Ugly but dependency-free. Flag it in a Lattice comment if you have to take the fallback; I do not expect you will.
- The company is small (≤ ~10 identities, ≤ tens of thousands of messages) for the life of v1. Every design choice below is allowed to assume this. Do not add pagination, caching, or indexes beyond what is listed.
- `.lattice/` files may be freely read by employee-built tools (CLAUDE.md, in-fiction framing). The chat app reads `.lattice/` but **never writes it**.

## 1. Architecture and stack

**Stack: Node.js 24, standard library only.** `node:sqlite` for storage, `node:http` for the server, `node:test` for tests, vanilla HTML/CSS/JS for the UI (no frameworks, no CDN links — the browser must make zero external requests, per AC10). No `package.json` dependencies; a minimal `package.json` may exist for `"type": "module"` and npm scripts only.

Why boring wins here: this app's job is to be *always runnable* on one machine with what is already installed. Every dependency is a way for it to stop working while nobody is watching. Node over Python because the server/JSON ergonomics are better in stdlib and the UI is JS anyway; SQLite over flat JSONL because "what's new for me" (Carla's §2.2) is a query, and queries against append-only text files grow into hand-rolled databases. SQLite already solved concurrent single-machine writers; I am not re-solving it.

**Layout:**

```
apps/chat/
  package.json          # {"type":"module"} + scripts; NO dependencies
  README.md             # how to run server, CLI usage, port, DB location
  lib/store.js          # ALL domain logic: schema, identities, channels, DMs,
                        # threads, posting, unread, read-state, lattice resolve+ingest
  lib/lattice.js        # read-only .lattice/ access: ids.json, tasks/*.json, events/*.jsonl
  server.js             # node:http server: static files + JSON API; 127.0.0.1 only
  bin/chat.js           # agent-facing CLI; thin wrapper over lib/store.js
  public/
    index.html
    app.js              # vanilla JS
    style.css
  test/
    store.test.js       # unit tests against a temp-file DB
    api.test.js         # integration tests: real server on ephemeral port, fetch()
    lattice.test.js     # ingest + shortcode resolution against fixture .lattice dirs
  data/                 # gitignored; created on first run
    chat.db
```

**Message store location and git status: `apps/chat/data/chat.db`, gitignored.** Justification, since I was asked to make this call explicitly: git is for code and durable company documents; Lattice is the audit trail for work; chat is operational state. Committing the DB means a binary-blob diff on every message — churn with no reviewable content, guaranteed merge conflicts the moment two agents commit, and git history bloat forever. Carla's durability requirement (AC9) is about surviving process restarts, which the disk file satisfies; nothing requires surviving `git clone` to a second machine, which doesn't exist. Escape hatch: `chat dump` (below) exports the whole store as deterministic JSONL to stdout, so a human-readable backup or future migration is one shell redirect away. Add `apps/chat/data/` to the repo root `.gitignore`.

**Server:** binds `127.0.0.1` (never `0.0.0.0`), default port `8347`, overridable with `PORT` env var. Start with `node apps/chat/server.js`. No TLS, no auth (per spec non-goal). Static files served from `public/`; everything else under `/api/*` as JSON. Content-Security-Policy header `default-src 'self'` — cheap enforcement of the no-egress rule.

**Concurrency:** the server and any number of CLI invocations write the same DB file. Open every connection with WAL mode (`PRAGMA journal_mode=WAL`) and `busy_timeout = 5000ms`. Every multi-statement mutation wraps in a transaction. This is the entire concurrency story; do not add locking on top.

## 2. Data model

Schema DDL (create in `store.js` on open, idempotent `CREATE TABLE IF NOT EXISTS`; set `PRAGMA foreign_keys=ON`):

```sql
CREATE TABLE IF NOT EXISTS identities (
  id          TEXT PRIMARY KEY,          -- canonical Lattice actor ID: 'human:forrest',
                                         -- 'agent:cto-owen', 'agent:ceo-carla', 'system:lattice'
  display_name TEXT NOT NULL,            -- 'Forrest (Investor)', 'Owen Kessler (CTO)'
  kind        TEXT NOT NULL CHECK (kind IN ('human','agent','system')),
  created_at  TEXT NOT NULL              -- UTC ISO-8601, e.g. 2026-08-30T02:00:00Z
);

CREATE TABLE IF NOT EXISTS conversations (
  id          INTEGER PRIMARY KEY,
  type        TEXT NOT NULL CHECK (type IN ('channel','dm')),
  name        TEXT UNIQUE,               -- channels: unique human-readable name, e.g. 'announcements'
                                         -- dms: NULL
  purpose     TEXT,                      -- channels: one-line purpose; dms: NULL
  dm_key      TEXT UNIQUE,               -- dms: the two identity IDs sorted lexically, joined by '|'
                                         -- e.g. 'agent:cto-owen|human:forrest'; channels: NULL
  created_by  TEXT NOT NULL REFERENCES identities(id),
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dm_members (
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  identity_id     TEXT NOT NULL REFERENCES identities(id),
  PRIMARY KEY (conversation_id, identity_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id              INTEGER PRIMARY KEY,   -- AUTOINCREMENT semantics via rowid; monotonic, global order
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  thread_root_id  INTEGER REFERENCES messages(id),  -- NULL = top-level; else id of the TOP-LEVEL parent
  author_id       TEXT NOT NULL REFERENCES identities(id),
  body            TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, id);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_root_id);

CREATE TABLE IF NOT EXISTS read_state (
  identity_id     TEXT NOT NULL REFERENCES identities(id),
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  last_read_id    INTEGER NOT NULL DEFAULT 0,       -- highest messages.id seen in this conversation
  PRIMARY KEY (identity_id, conversation_id)
);

CREATE TABLE IF NOT EXISTS ingested_events (
  event_id    TEXT PRIMARY KEY,          -- Lattice ev_* ULID; presence = already posted to chat
  ingested_at TEXT NOT NULL
);
```

**Identity.** One canonical identity per participant, **equal to their Lattice actor ID** — `human:forrest`, `agent:ceo-carla`, `agent:cto-owen`, plus one `system:lattice` bot identity that authors event messages. This satisfies Carla's "one identity must not fragment" requirement by construction: chat and Lattice share a namespace. Seed these four at first DB open. New identities are registered explicitly (`chat register` / the UI identity picker's "add identity" flow), not auto-created on message insert — a typo'd actor should be an error, not a new employee.

**Channels.** All public, all readable/writable by any identity. Names: lowercase, `[a-z0-9-]+`, unique. Seed at first open: `announcements` ("Company-wide announcements"), `engineering` ("Engineering discussion"), `lattice-events` ("Automated feed of Lattice task events; read-only by convention" — enforce writes-by-`system:lattice`-only in the store layer to keep the feed clean; humans/agents discuss in threads on those messages, which IS allowed).

**DMs.** A DM conversation is identified by its unordered identity pair, normalized as `dm_key` = the two IDs sorted lexically and joined with `|`. Opening a DM is get-or-create on `dm_key`; history is therefore reconstructable forever (Carla §3.2). Exactly two members in v1; no group DMs.

**Threads (Slack model, one level).** A reply to top-level message M gets `thread_root_id = M.id`. A reply *to a reply* also gets the root's id — threads do not nest. Top-level conversation view shows only `thread_root_id IS NULL` messages, each with a reply count; a thread view shows the root + its replies. A thread is addressable as `<conversation>#<root_message_id>` (e.g. `engineering#42`) — the UI links each thread with a `#msg-42` anchor/URL, and that string is stable enough to paste into a Lattice comment.

**Unread / "what's new for me" — the exact semantics.** Per (identity, conversation) high-water mark `last_read_id`. A message is *new for identity X* iff `messages.id > last_read_id` for that conversation (missing row = 0, i.e. everything is new) **and** the conversation is visible to X (any channel, or a DM X belongs to) **and** `author_id != X` (you never unread your own words). Thread replies are ordinary messages in this definition, so "a reply to a thread I'm in is new for me" holds; in fact any channel activity is new-for-everyone until read — at five minds and an investor, that is the honest model, and it makes Carla's AC6 arithmetic exact: read everything, receive 1 channel message + 1 DM + 1 thread reply, and the what's-new query returns exactly those three rows. Marking read: viewing a conversation in the UI, or `chat read`/`chat catchup` in the CLI, sets `last_read_id` to the max visible message id at that moment. No per-message read receipts.

**Lattice task references.** Message bodies are stored as plain text, never rewritten. At render/serve time, occurrences of `\bAS-\d+\b` are resolved via `lib/lattice.js` (reads `.lattice/ids.json` → `tasks/<task_id>.json`) to `{shortId, title, status, exists}`. The API returns this as a `refs` array alongside each message; the web UI renders the short code as a link opening a small task panel (title + status + task id); the CLI prints `[AS-2 "…title…" — in_progress]` after the message. Unresolvable codes render as plain text. Lattice stays the source of truth; chat only annotates (Carla §3.4).

**Lattice event ingestion — no daemons.** `lib/lattice.js` exposes `ingestNewEvents(store)`:
1. Read every `.lattice/events/task_*.jsonl` (skip `_lifecycle.jsonl` — its task events are duplicated into per-task files; verify this against the two existing task files, and if per-task files are NOT complete, use `_lifecycle.jsonl` alone instead. Either way, read exactly one of the two sources — never both, or you double-post).
2. For each line, parse JSON; select `type in ('task_created','status_changed')` (comments are deliberately excluded — too noisy for a feed; revisit in v2).
3. Skip any `id` already in `ingested_events`; otherwise, inside one transaction, insert the event id and post to `lattice-events` as `system:lattice`. Formats:
   - `task_created` → `AS-2 created by human:forrest — "Internal chat app (Slack-type) v1…" [backlog]`
   - `status_changed` → `AS-2: in_planning → planned — by agent:cto-owen`
4. Order ingestion by event `ts` then `id` across files, so the feed reads chronologically on first backfill.

Idempotent by construction; safe to run any number of times. **Trigger points:** (a) server startup; (b) on any `/api/*` request, throttled to at most once per 10 seconds (in-memory timestamp — a page refresh is what makes the feed current, which is the honest no-daemon delivery model); (c) every `chat inbox` and `chat sync` CLI invocation. First run backfills all historical events — that is desired, the feed becomes a readable history of the board.

## 3. Interfaces (parity against the same store)

Both interfaces call the same `lib/store.js` functions. No logic in `server.js` or `bin/chat.js` beyond argument parsing, HTTP plumbing, and formatting — that is what makes parity structural instead of aspirational.

### 3a. HTTP API (JSON; all under `/api`)

| Method & path | Purpose |
|---|---|
| `GET  /api/identities` | list identities |
| `POST /api/identities` | `{id, displayName, kind}` register |
| `GET  /api/conversations?me=<id>` | channels + my DMs, with unread counts |
| `POST /api/channels` | `{name, purpose, actor}` create channel |
| `POST /api/dms` | `{me, other}` get-or-create DM, returns conversation |
| `GET  /api/messages?conversation=<id>&me=<id>` | top-level messages + reply counts + lattice `refs`; also returns thread replies grouped by root (payloads are small; one shape for UI and tests) |
| `POST /api/messages` | `{conversation, author, body, threadRoot?}` post message or thread reply |
| `GET  /api/unread?me=<id>` | the what's-new answer: every unread message, grouped by conversation, with refs |
| `POST /api/read` | `{me, conversation, upTo}` advance watermark |
| `GET  /api/task/<shortId>` | resolve a Lattice short code (task panel data) |

Errors: non-2xx with `{error: "..."}`. Unknown identity, unknown conversation, posting to `lattice-events` as non-system, malformed channel names → 4xx with a message that says exactly what to fix.

### 3b. Web UI (`public/`)

Single page, three columns in spirit: (1) sidebar listing channels and DMs with unread badges plus the identity picker; (2) message pane for the selected conversation — top-level messages with author, timestamp, thread-reply count; (3) a thread panel that opens when a thread is clicked. Composer at the bottom; "reply in thread" on each message; "new channel" and "new DM" affordances. Identity picker is a dropdown of registered identities (choice persisted in `localStorage`); no auth, per spec. Viewing a conversation posts `/api/read`. Polling: `setInterval` fetch every 5s on the open conversation and sidebar unread counts — this is localhost polling for a human's browser tab, not a daemon, and stays within the no-live-wake-up rule (agents are never woken; Forrest's own open tab refreshing is just a UI). Rendering rules: escape ALL user content (no innerHTML of raw bodies — XSS via a chat message is dumb even on localhost), preserve newlines, linkify `AS-n` references from the server-provided `refs`, show timestamps in local time with UTC in a tooltip. Skimmability (Carla §3.1): clear message boundaries, bold author, muted timestamp, collapsed threads by default.

### 3c. CLI (`apps/chat/bin/chat.js`)

Runnable as `node apps/chat/bin/chat.js <cmd>`; also add `"bin"` in package.json. `--me <identity>` on every command (or `CHAT_ME` env var). `--json` flag on read commands for machine-readable output; human output is compact text. The CLI talks to the DB directly through `lib/store.js` — it does not require the server to be running (AC4's "no manual data munging" is satisfied because both paths hit the same store functions).

```
chat channels                          # list channels + unread counts
chat create-channel <name> --purpose "…"
chat post <channel> "<body>"           # top-level message
chat dm <identity> "<body>"            # get-or-create DM, post into it
chat reply <conversation>#<msgid> "…"  # thread reply (e.g. chat reply engineering#42 "…")
chat history <channel|@identity> [--limit N] [--threads]
chat inbox                             # THE session-start command: runs lattice ingest, then
                                       # prints every unread message grouped by conversation,
                                       # with thread context and AS-n resolutions
chat read <channel|@identity>          # mark one conversation read
chat catchup                           # mark everything read
chat register <id> "<display name>" --kind agent|human
chat sync                              # run lattice event ingestion explicitly
chat dump                              # full store as JSONL on stdout (backup/debug)
```

`chat inbox` is the product's core promise to agents (Carla §2): one command, exact answer, cheap. It must exit 0 with "Nothing new." when clean.

Document in `apps/chat/README.md` and add a short "Chat" section to the repo README if one exists (do not touch CLAUDE.md).

## 4. Hiring plan

Two hires, both new roles, personas created at implementation time per CLAUDE.md conventions (unique first name; dossier in `personnel/<role>-<name>.md` with hire date 2026-08-30, MBTI, resume; agent definition in `.claude/agents/<role>-<name>.md`; actor ID `agent:<role>-<name>`):

1. **`developer-<name>` — Software Engineer, full-stack (1).** Implements this plan end to end. Resume should plausibly cover Node, SQLite, and vanilla-JS frontends. Reads: this plan, Carla's spec, the repo. Owns the implementation commits and moves AS-2 `in_progress → review`.
2. **`qa-<name>` — QA Engineer (1).** Fresh context, did not write the code. Reviews the diff against Carla's ten ACs and my technical ACs below, runs the test suite, exercises the UI and CLI by hand, records findings with `lattice comment --role review`, and moves to `done` or recommends rework per the CLAUDE.md review loop.

No PM hire: the spec (Carla) and the plan (me) already exist; a third document would be ceremony. I remain the responsible manager/orchestrator for the lifecycle.

## 5. Implementation sequence, testing, technical acceptance criteria

**Sequence** (each milestone leaves the tree working and tested; commit at least per milestone):

- **M0 — Preflight.** Verify `node:sqlite` loads on Node 24 (assumption in §0). Create branch `feat/AS-2-chat-app`; `lattice branch-link AS-2 feat/AS-2-chat-app --actor agent:developer-<name>`. Scaffold `apps/chat/`, gitignore `apps/chat/data/`.
- **M1 — Store core.** `lib/store.js`: schema, WAL, identities (seed 4), channels (seed 3), DMs, messages, threads, read-state/unread. Unit tests green.
- **M2 — CLI.** All commands in §3c except `sync` (stub ingestion). This unblocks agent-side usage earliest.
- **M3 — Server + UI.** API of §3a, static UI of §3b, polling, read-marking. Integration tests green.
- **M4 — Lattice integration.** `lib/lattice.js`: short-code resolution (UI + CLI render) and event ingestion with idempotency + throttled triggers. Fixture-based tests green.
- **M5 — Hardening & handoff.** `chat dump`, README, full AC pass against Carla's ten criteria by hand, post an announcement message in `announcements` (as yourself — real seed data), final commit, move AS-2 to `review`.

**Testing approach.** `node --test apps/chat/test/` — stdlib runner, no dependencies. Unit tests (store) run against a temp-dir DB per test; integration tests boot the real server on port 0 (ephemeral) with a temp DB and drive it with `fetch`; lattice tests use a fixture `.lattice/` directory in `test/fixtures/` — tests never read or write the repo's real `.lattice/` or real `data/`. Concurrency smoke test: two store connections interleaving writes under WAL. Manual pass: QA walks Carla's AC1–AC10 in a real browser + CLI and records the result per criterion in the review comment.

**Technical acceptance criteria** (mine, additive to Carla's ten — hers are restated by reference, not duplicated):

| # | Criterion | Backs Carla's AC |
|---|---|---|
| T1 | `git clone` state + Node 24 + `node apps/chat/server.js` is the entire setup: no `npm install`, no build step, `package.json` has zero dependencies | AC10 |
| T2 | Server binds 127.0.0.1 only; UI makes zero non-localhost requests (verify: devtools network tab; CSP `default-src 'self'` header present) | AC1, AC10 |
| T3 | Every CLI read command has `--json`; `chat inbox` output is exact per the §2 unread semantics | AC3, AC6 |
| T4 | CLI post → visible in browser on refresh; browser post → visible in `chat history`/`chat inbox`; byte-identical bodies | AC4 |
| T5 | Thread replies never appear top-level in either interface; `<conv>#<id>` addresses resolve in UI and CLI | AC5 |
| T6 | Event ingestion is idempotent: running `chat sync` five times posts each Lattice event exactly once; events post with task short code, transition, and actor | AC8 |
| T7 | Kill server, run CLI, restart server: all data + read-state intact (single store on disk, `data/chat.db`) | AC9 |
| T8 | All user content HTML-escaped in the UI (test with a `<script>` body); unknown identities/conversations rejected with clear 4xx | — |
| T9 | `node --test` suite passes clean from a fresh clone | — |
| T10 | `chat dump` round-trip: output is valid JSONL containing every table's rows | AC9 |

## 6. Commit discipline

- **Commit:** everything under `apps/chat/` (except `data/`, which must be gitignored — verify `git status` shows no `chat.db`); the new-hire dossiers `personnel/developer-<name>.md`, `personnel/qa-<name>.md`; their agent definitions `.claude/agents/developer-<name>.md`, `.claude/agents/qa-<name>.md`; the `.gitignore` addition.
- **Never commit:** `CLAUDE.md`, `PHILOSOPHY.md`, anything in `.lattice/` beyond what the `lattice` CLI itself manages when you write plans/notes/comments through it, `apps/chat/data/`, editor droppings. Do not touch existing GitHub remotes, repos, or any DigitalOcean anything — work stays on the local branch; no pushing without direction.
- Branch `feat/AS-2-chat-app` off `master`, linked to AS-2. Small commits per milestone with messages referencing `AS-2`. Commit messages end with the Co-Authored-By line per house style.
- **Shared worktree:** other agents may be active. Before committing, `git status` and attribute anything unfamiliar before proceeding; never sweep unknown files into your commits, never revert what you can't attribute.

## 7. Risks and open questions (time-boxed)

1. **`node:sqlite` maturity** — the one platform bet. Preflight in M0; fallback documented in §0. Time-box: if the preflight fails, take the fallback the same day and leave a comment; do not research alternatives.
2. **Per-task event files vs `_lifecycle.jsonl`** — §2 ingestion tells you to verify which is the complete stream and use exactly one. Decide in M4 with a 30-minute box; default: per-task files.
3. **Unread-spans-all-channels semantics** — deliberate (§2). If it proves noisy as the company grows, channel mute/subscribe is a v2 task, not a v1 change. Noting for Carla per her §6 "what am I missing": none of her ten criteria forced a bad trade-off; this is the only place I chose semantics she left open, and I chose the strict-superset reading.

## 8. Portability note (added 2026-08-30, post-approval)

CLAUDE.md now records that company services will eventually be hosted on Digital Ocean. This does **not** rescope v1 — v1 is local-only per the approved plan above. But the design should not fight a future deployment, and mostly it already doesn't. Three things for the implementer to observe, all zero-cost now: (1) keep every environment-specific value (port, bind address, DB path) readable from env vars with the current local defaults — `PORT` and `CHAT_DB` and `CHAT_BIND`, no config framework; (2) keep ALL filesystem knowledge of `.lattice/` inside `lib/lattice.js` with the repo root as a single configurable path, since a hosted deployment's Lattice access will work differently and should require changing one module, not grep; (3) SQLite-behind-one-store-module is already the right shape — if a hosted version ever needs a networked DB, `lib/store.js` is the seam, so no SQL outside it. Do not add Docker, deploy scripts, or DO config to v1 — deployment is its own future Lattice task.

— Owen
