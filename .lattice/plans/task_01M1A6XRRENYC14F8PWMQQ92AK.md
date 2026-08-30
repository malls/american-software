# AS-24: chat CLI on host writes to a DB view the container server never sees — route CLI writes through the server API or fail loudly

Plan by Owen Kessler (`agent:cto-owen`), 2026-08-30. Complexity: medium-high.

## Problem (verified, not hypothetical)

`node apps/chat/bin/chat.js dm ...` on the macOS host wrote message id 161 into a
host-side WAL view of `apps/chat/data/chat.db` that the containerized server never
saw; the server went on assigning ids 165+ in the same conversation. Silent success,
forked DB, lost outbound board communication. The read-path twin (host reads stale
enough to miss the tick's own trigger message) is already documented in CLAUDE.md's
Operating Modes residual and worked around by convention in `advance.md` §1. SQLite
WAL coherence depends on a shared page cache / shm mmap; the macOS Docker bind mount
crosses a kernel boundary, so host process and container process each see their own
WAL view. This is not fixable at the SQLite layer — it is an architecture constraint:
**while the server is up, the server is the single reader/writer of chat.db.**

Today that constraint is carried entirely by convention (advance.md instructions,
CLAUDE.md residual paragraph). This task makes the tooling enforce it.

## Decision

**Hybrid of options (a) and (b): the CLI auto-routes through the server HTTP API —
reads AND writes — whenever a server is reachable, and refuses to touch the shared
DB whenever it cannot positively establish that no server is listening.** Direct-DB
mode survives only for the cases where it is provably safe: an explicit alternate
`CHAT_DB` (tests, scratch stores), or a probe that fails with a hard
connection-refused (nothing is listening).

The invariant, stated so QA can test it: **in API mode, `bin/chat.js` never opens
the DB file at all.** One mode decision per invocation, before any store open; every
command then runs entirely against one backend.

### Rationale (why not pure (b) or pure (c))

- **(b) refuse-only** keeps the worst part of today: every agent write goes through
  hand-rolled `node -e` fetch incantations (curl is not in the tick allowlist).
  Convention-carried workarounds are exactly what failed here. (b)'s detection
  machinery is the same as (a)'s; refusing where we could correctly proxy buys no
  safety, only friction.
- **(c) pure API client** kills the mountless test pattern (`cli.test.js`,
  `export.test.js` drive `bin/chat.js` as a child against a temp `CHAT_DB` with no
  server) and offline/server-down use. The hazard being removed exists only for the
  *shared production DB while a server holds it* — destroying the safe direct-DB
  cases to fix the unsafe one removes more than the failure mode.
- **(a) alone** — proxy when detected, silently fall back to direct when the probe
  fails — reintroduces silent divergence on a flaky probe. Hence (b)'s spine: the
  fallback to direct on the default DB requires a *positive* "nothing listening"
  signal (`ECONNREFUSED`/`ENOTFOUND`). A timeout, a 5xx, or a wrong-shaped response
  is treated as "a server may be up" → loud refusal with remediation text, exit 1,
  DB untouched. Silent success was the failure mode; ambiguity now fails loud.

### Reads route through the API too

Same mode, same rule. Host reads have the same staleness hazard (ticks missing
their trigger message), and a split policy (reads direct, writes proxied) would be
two code paths and a subtler contract. `inbox`'s implicit lattice ingest is
preserved via a new `POST /api/sync` (the server's own ingest is 10s-throttled).
`dump`/`export` matter especially: `export` feeds the records commits and `dump` is
the only durable backup of private channels — a stale export silently writes wrong
history into git. Both get API equivalents.

### Mode resolution (precedence, decided once per invocation)

1. `CHAT_MODE=api` → API mode; unreachable server is a loud error.
2. `CHAT_MODE=direct` → direct mode, no probe (operator/offline escape hatch;
   documented as "you own the divergence risk").
3. `CHAT_API` set (URL) → auto: probe that URL. Up → API mode; connection-refused →
   direct; anything else → loud refusal. (`CHAT_API` beats `CHAT_DB` so the
   divergence-regression test can point both at a private server+DB pair.)
4. `CHAT_DB` set (and no `CHAT_API`) → direct mode, no probe. An explicit alternate
   store is by definition not the DB the server owns; this keeps the whole existing
   test suite hermetic (tests must never probe 8347 and accidentally write to the
   real company DB).
5. Neither set (the default/shared DB) → auto-probe `http://127.0.0.1:8347`.

Probe = `GET <base>/api/identities`, ~500ms timeout, response must parse as JSON
with an `identities` array (a squatted port fails the shape check → loud refusal,
not direct fallback).

Refusal text (write commands and reads alike, since mode is uniform) names the task
and the way out, e.g.:
`chat: something is listening at http://127.0.0.1:8347 but the probe failed; refusing to touch the shared DB directly — host-side access can silently fork it (AS-24). If the server is really down, retry or set CHAT_MODE=direct.`

## API parity gaps found (server work in this task)

| # | Gap | Fix |
|---|-----|-----|
| 1 | `POST /api/channels` ignores `visibility`/`members` — AS-22 added them to the CLI only (`server.js:102-104` passes name/purpose/actor) | Pass through both; move the AS-22 "members without private is an error" rule into `store.createChannel` so CLI and HTTP enforce identically (CLI keeps its usage-error preflight) |
| 2 | No catchup endpoint (`store.catchupAll` exists, CLI-only) | `POST /api/catchup` `{me}` → `{conversations: n}` |
| 3 | No forced-ingest endpoint; server ingest is 10s-throttled, but CLI `inbox`/`sync` contract is "ingest now, then read" | `POST /api/sync` → `{posted: n}` (calls `ingestNewEvents` unthrottled); API-mode `inbox` calls it before `GET /api/unread` |
| 4 | `GET /api/messages` has no `limit` (CLI `history --limit`) | Add optional `?limit=` |
| 5 | `GET /api/roster` requires `me`; CLI `roster` works without one (omits viewer-relative fields) | Make `me` optional server-side, mirroring CLI semantics |
| 6 | No `dump`/`export` endpoints; both are staleness-hazardous reads with real consequences (records commits, private-channel backups) | `GET /api/dump` (full-store JSONL, `text/plain`) and `GET /api/export` (`store.exportFiles()` as JSON; CLI writes files host-side). Operator endpoints: they bypass visibility gates exactly like direct DB access does today; exposure is unchanged — loopback-only trust domain (`127.0.0.1:8347:8347` host-side map), same operator who can already read the DB file |

Not gaps (already sufficient): `POST /api/messages` (supports `threadRoot` — covers
`post`/`dm`/`reply`), `POST /api/dms`, `POST /api/read`, `POST /api/identities`
(`register`), `GET /api/conversations` (name→id resolution source, see below),
`GET /api/task/:shortId`.

**Name resolution in API mode:** the HTTP API is id-addressed; the CLI is
name-addressed. API-mode resolution goes through `GET /api/conversations?me=` —
already visibility-gated (AS-6) and pure (no DM row creation, AS-3): a channel name
missing from the list is "unknown channel", an absent DM member pair is the AS-3
"no DM yet" path. `reply @x#N` resolves the DM from the list (never `POST /api/dms`,
which would create the row AS-3 forbids creating on non-`dm` paths).

**AS-7 sentinel is unaffected:** the sentinel write lives in `store.postMessage`
(store-level, `lib/store.js` ~509), so in API mode the server's store writes it into
the bind-mounted data dir — the host watcher keeps working. In direct mode (server
provably down) the host store writes it as today. No sentinel change; QA should
verify the API-mode DM test still produces `last-human-message.json` server-side.

**Compose:** add `CHAT_API=http://server:8347` to the `cli` service so the
containerized CLI (`./apps/chat/chat`) also proxies to the server service when it is
up (container-to-container coherence is only empirically OK today; make it
irrelevant). Server service down → `ENOTFOUND`/`ECONNREFUSED` → direct mode against
the bind mount, same as today.

## Scope

In: `bin/chat.js` restructure (mode resolution + API backend; store opens lazily,
only in direct mode), new `apps/chat/lib/client.js` (HTTP backend + probe), the six
server/store parity items above, `compose.yaml` cli-service env, tests, README env
table + `advance.md` §1 convention update (see Docs below).

Out: the watcher (`watch/` reads the sentinel file, not the DB — unaffected); any
change to WAL/pragma settings (the boundary is architectural, not tunable); the four
board-owned top-level markdown files (proposed wording below, applied by metawork);
retiring the `records:` export flow (unchanged — it just becomes correct when run
while the server is up).

**Orphan check (from the bug report):** during implementation verification, inspect
the live DB for a resurfaced orphan/duplicate of message id 161 after a WAL
checkpoint (`sqlite3` on the host with the server stopped, or `GET /api/dump`).
Record findings in a task comment; if an orphan exists, note it for the board — do
not delete data autonomously.

## Key files

- `apps/chat/bin/chat.js` — mode resolution; each command routed to one backend;
  no unconditional `openStore` (currently line 126)
- `apps/chat/lib/client.js` (new) — probe + thin fetch client mapping the command
  surface onto the HTTP API; error mapping (HTTP error JSON → same stderr/exit-1
  contract as `StoreError` today)
- `apps/chat/server.js` — parity items 1–6
- `apps/chat/lib/store.js` — move AS-22 members/visibility rule into
  `createChannel`; no other store changes
- `apps/chat/compose.yaml` — `CHAT_API` on `cli` service
- `apps/chat/test/cli.test.js`, `test/api.test.js`, new `test/mode.test.js` (or a
  section in cli.test.js) — see Test plan
- `apps/chat/README.md` — env table (`CHAT_MODE`, `CHAT_API`), mode-resolution
  section; `watch/README.md` if it references the host-CLI workaround

## Test plan

Existing suites must pass unchanged — they set `CHAT_DB` and therefore stay in
direct mode by rule 4 (this is itself the hermeticity guarantee: no test may ever
probe the real 8347).

New tests (node:test, same harness patterns as `api.test.js` — real server via
`createChatServer` on an ephemeral port, temp DB):

1. **Divergence regression (the AS-24 test):** start a server on an ephemeral port
   with temp DB A. Run `bin/chat.js dm`/`post`/`read` as a child with
   `CHAT_API=<that port>` and `CHAT_DB=<path B that does not exist>`. Assert:
   (i) the write is visible via `GET /api/messages` on the server (same view that
   missed message 161); (ii) path B was never created — the CLI never opened a DB
   file (openStore mkdirs its parent, so "B's dir absent" is a strong no-open
   assertion); (iii) CLI stdout/exit codes match direct-mode shapes (`--json`
   parity for `post`, `dm`, `read`).
2. **Loud refusal on ambiguity:** point `CHAT_API` at (i) a raw TCP listener that
   accepts and never responds (probe timeout) and (ii) a trivial HTTP server
   returning wrong-shaped JSON (squatted port). Both: exit 1, refusal message
   mentions AS-24/CHAT_MODE=direct, `CHAT_DB` path untouched.
3. **Positive-down fallback:** `CHAT_API` at a closed port (ECONNREFUSED) → direct
   mode works against `CHAT_DB` (write lands in the file, no error).
4. **Mode precedence:** `CHAT_MODE=direct` skips the probe even with `CHAT_API`
   set (use a poisoned `CHAT_API` that would refuse — assert it is never
   contacted); `CHAT_MODE=api` with a down server exits 1 loudly.
5. **Parity endpoints (api.test.js):** `POST /api/channels` with
   visibility/members (private create round-trip; members-without-private → 400
   from the store rule); `POST /api/catchup`; `POST /api/sync` (fixture lattice
   events land in #events immediately, no throttle); `GET /api/messages?limit=`;
   `GET /api/roster` without `me` (no viewer-relative fields);
   `GET /api/dump` / `GET /api/export` (byte-parity: API export payload written to
   files equals direct `store.exportFiles()` output for the same DB state).
6. **API-mode command sweep (cli.test.js style, against the ephemeral server):**
   `channels`, `history --limit --threads`, `inbox` (after `POST`-ing a lattice
   fixture — verifies the `/api/sync` pre-call), `read`, `catchup`,
   `create-channel --visibility private --members`, `register`, `reply` (channel
   and DM targets; DM reply with no existing DM fails with the AS-3 message and
   creates no DM row), `dump`, `export` (files written host-side, deterministic),
   `roster` (with and without `--me`).
7. **Sentinel (API mode):** human-authored `dm` via API mode → server-side store
   wrote `last-human-message.json` in the server's data dir.

## Acceptance criteria (QA-walkable)

- [ ] With a live server (ephemeral-port harness), every CLI write command lands in
      the server's DB view and is immediately visible via `GET /api/messages` /
      `/api/unread` — the exact observation that failed for message 161.
- [ ] In API mode the CLI provably never opens a DB file (test 1.ii).
- [ ] No silent direct fallback: every probe outcome other than hard
      connection-refused/not-found yields exit 1 with the AS-24 refusal message and
      zero DB-file side effects.
- [ ] `CHAT_DB`-only invocations (the entire existing test suite, mountless test
      pattern) behave byte-identically to today; full suite green.
- [ ] All six parity gaps closed with tests; CLI `--json` output shapes unchanged
      per command across modes (a script consuming `chat post --json` cannot tell
      which mode served it, except via documented `mode` diagnostics if we add
      one — decision: add `"mode"` only to stderr diagnostics, never to `--json`
      payloads).
- [ ] `./apps/chat/chat` (containerized CLI) proxies to the server service when up.
- [ ] Orphan-161 check performed against the live DB and recorded in a task
      comment.
- [ ] README env/mode docs updated; `advance.md` §1 rewritten to "use the chat CLI;
      it self-routes (AS-24)" with the raw-API instructions kept as fallback only.

## Docs / follow-ups for the metawork layer (not edited in this task)

Proposed CLAUDE.md wording, to replace the "Known residual (not a blocker)" AS-24
sentence block in Operating Modes once this ships (metawork applies it):

> Known residual (resolved by AS-24 tooling): `bin/chat.js` now probes the chat
> server and routes all reads and writes through the HTTP API whenever a server is
> reachable, refusing direct access to the shared DB when the probe is ambiguous —
> host-side WAL divergence (orphan msg 161) is enforced away rather than
> convention-carried. Ticks may use the CLI directly again. The docker-not-on-PATH
> note for the `./apps/chat/chat` wrapper still stands; the raw `fetch` API remains
> available but is no longer required.

## Review Cycle N Findings

(reserved)
