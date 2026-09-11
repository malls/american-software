# AS-100: Chat: structured company-events feed — tick, stage, and sub-agent lifecycle events the UI can project (foreman-view substrate)

SOURCE: board DM msg 658 (human:forrest, 2026-09-10T20:36Z): the long-term goal is a 'foreman of the factory' view of work in progress -- possibly anthropomorphic, 'full visualization, like a simulator video game' -- and the standing instruction is to put as much observability in place as possible. Filed by the CTO on the board member's behalf; the CTO's full reply is in the cto-owen/forrest DM (msgs 661 onward) and the AS-99 north-star comment.

WHAT IS MISSING (the gap this task closes): everything the company emits today is either STATE (advance.lock, deploy-state.json, git worktree list, .lattice task status, the roster) or COARSE EVENTS (Lattice status_changed / assignment_changed / branch_linked / comment_added at stage granularity). Nothing records the lifecycle of a LANE while it runs: when a tick started and ended and with what outcome; when a stage's sub-agent was spawned, for which task, as which employee, in which worktree; when it exited and whether it finished, errored, or was cut by the 30-minute tick timeout (AS-95's implementation stage was cut this way on 2026-09-10 and the only record is a board-commit message). Stage timers, per-lane liveness, and any future employee 'figure' state machine all need these events; none can be derived from the existing signals.

WHAT (v1, the plan refines): an append-only, typed, attributed JSONL stream of company events, written on the host by the tick and the watcher, read by the chat server, exposed as an API and pushed over the existing /api/stream. Event types, minimum set: tick_started {source, pid, nonce, startedAt}; tick_ended {outcome: ok|timeout|error|noop, lanesTouched[]}; stage_started {task, stage, actor, worktree, branch, ts}; stage_ended {task, stage, actor, outcome: completed|cut_by_timeout|error, ts}; subagent_spawned / subagent_exited {task, actor, stage, ts, exit}. Same envelope discipline as .lattice/events (schema_version, id, ts, actor, data) so a consumer that already parses Lattice events parses these. Producer: a tiny CLI in the mould of apps/chat/bin/chat.js (e.g. node apps/chat/bin/events.js emit stage_started --task AS-n --actor agent:x ...) that the orchestrator calls at stage boundaries -- the tick procedure already narrates every one of these in prose, so the change to .claude/commands/advance.md is one line per boundary (proposed wording goes in the plan for the metawork layer to apply; employees do not edit it). The watcher emits tick_started/tick_ended itself in fire()/settle(). Location: apps/chat/data/events/ (host-side, bind-mounted like deploy-state.json), gitignored like the rest of data/ unless the plan argues otherwise.

CONSUMER CONTRACT: the AS-99 lane projection (lanes[] with task, stage, employee, worktree, branch, ahead, dirty, lastCommit, stale) gains liveness fields (subagentAlive, stageStartedAt, stageElapsedS, lastEvent) from this stream with NO change to the lane card's shape. That is the acceptance test for 'extensible, not a one-off': AS-99's view consumes this feed by adding fields, not by rewriting.

DOCTRINE: one event stream, many projections -- the same rule as the derived org chart (AS-33) and the Lattice deep links (AS-93). Views never own state. Guards are proven by breaking them (M4): the plan names the falsifier for 'a stage cut by the tick timeout is recorded as cut_by_timeout, never as completed'.

EXPLICITLY NOT IN v1: tool-level activity of a running employee (reading a file, running tests) -- we do not own the harness and will not fake it; token/cost per stage (no source yet; note the slot in the schema); any spatial/animated rendering (that is the foreman floor, a later task over this stream); retention/compaction of the stream (append-only until it is a measured problem).

ORDERING: Chat set (tag chat, priority critical). Fourth, directly behind AS-99 -- CTO call under the board's delegation (DM msg 614); the metawork layer records the sentence in CLAUDE.md section Scheduling priority. Does not start before AS-95 lands: the lanes are only worth watching when they run unattended.

---

## Technical plan (cto-owen, 2026-09-11, loop tick 2 / watcher:76266)

**DEPENDENCY — HOLD AT `planned` UNTIL AS-99 MERGES.** This task extends AS-99's
`composeLanes` (T4 there) and its `lanesKey` change-only push; it is planned against
AS-99's *written* plan, not against code on `feat/AS-99-lane-view`, which is mid-implementation
in a parallel lane. The orchestrator moves this to `in_progress` only after AS-99 is `done` and
merged on master, and the implementer reads the merged `lib/lanes.js` first. If the merged
composer differs from the AS-99 plan in a way that touches the two reserved slots, that is a
plan-level finding on this task, not a quiet adaptation.

Terms, so nobody guesses: an **event** is one JSON line in the stream; the **stream** is the
single append-only file; a **producer** is anything that appends (the watcher, the emit CLI);
the **reconciler** is the watcher code that closes what a dead tick left open; the
**projection** is what the server serves and pushes; a **stage** is one of the three lifecycle
stages of the Employee Execution Model (`plan`, `implement`, `review`); a **sub-agent** is one
employee process spawned inside a stage.

### T1. The stream — decisions

**File: one append-only file, `apps/chat/data/events/company.jsonl`.** Rejected: daily
files. A daily split buys a bounded file size, which is retention's job and retention is
explicitly out of scope; it costs a multi-file cursor for `?since=`, a multi-file reconciler
scan, and a midnight seam where an open stage's start and end sit in different files. One
file makes the cursor an id, the tail a byte offset, and the reconciler a single read. The
`events/` directory (not a bare `data/events.jsonl`) is kept so a future rotation task can add
files beside the live one without moving it. Override for tests and tooling:
`CHAT_EVENTS_PATH` (the `CHAT_DB` pattern); the server default is `join(dataDir, 'events',
'company.jsonl')` so `loopFixture`-style scratch dirs plant it like the other four files.

**Container access: the existing `./data:/app/data` rw mount, nothing new.** The file lives
under `apps/chat/data/`, which compose already mounts and `test/deploy-shape.test.js` already
pins (`/app/data` ↔ `apps/chat/data`, rw). No compose change, no Dockerfile change. The
server only ever *reads* it (views never own state); the rw mode is the mount's existing
property, not something this task uses.

**Git: stays ignored** (`.gitignore` already has `apps/chat/data/*`). The stream is
operational state of the same kind as `advance.lock` and `deploy-state.json`; committing it
would make every tick dirty master. Alternative recorded, not taken: a `records: events
export <date>` step in the AS-5 mould if the board later wants the lifecycle durable in git.
Default: no. Revisit only if the board asks.

**Envelope: byte-compatible in shape with `.lattice/events`.** Exactly the seven keys, written
in sorted key order like Lattice's own lines:

```json
{"actor":"agent:cto-owen","data":{"actor":"agent:developer-lena","branch":"feat/AS-100-events-feed","cycle":null,"stage":"implement","task":"AS-100","worktree":".worktrees/AS-100"},"id":"cev_01M27K3Q8T9ZV6X0F2N4B7C1DE","schema_version":1,"task_id":"task_01M26H1TA8K3E2SSS9DY672PH1","ts":"2026-09-11T05:12:03.117Z","type":"stage_started"}
```

- `id`: `cev_` + a 26-char Crockford-base32 ULID (48-bit ms timestamp + 80 random bits,
  monotonic within one process by incrementing the random part on a same-ms collision).
  ~25 lines in `lib/events.js` on `node:crypto`; zero dependencies preserved. Lexically
  sortable, so `?since=<id>` is a plain string compare. Rejected: reusing Lattice's `ev_`
  prefix — a consumer that dedupes both streams by id must never be able to collide them,
  and the prefix says which producer wrote the line. Rejected: `<ms>-<random>` — not
  sortable at equal ms and not the format the rest of the company's ids use.
- `ts`: ISO-8601 with milliseconds (`toISOString()`); Lattice writes seconds. Both parse
  with `Date.parse`, and the `readTaskEvents` sort (`ts`, then `id`) is the sort here too.
- `actor`: the **emitter** — the orchestrating employee (`--actor` on the CLI) or
  `system:watcher` for the watcher's own lines. `system:*` is the company's existing form for a
  machine actor (`system:lattice` posts the ingested Lattice events); a process is not an
  employee, and attributing its lines to a person would be a false record. The employee a
  stage/sub-agent event is *about* is `data.actor`, always present on those four types, so the
  projection's "who" never depends on who typed the command.
- `task_id`: the full Lattice id resolved from `data.task` through `ids.json` (read-only,
  `lib/lattice.js`); `null` for tick events and for a short id that does not resolve
  (the event is still written — a missing join must not lose the record; the CLI warns on
  stderr and exits 0).
- `schema_version: 1`.

**Types and `data` shapes — exactly six types, each an exact key list (`EVENT_SHAPES` in
`lib/events.js`, the projection whitelist of T4):**

| type | `data` keys (all present; `null` when unknown) |
|---|---|
| `tick_started` | `source` (`watcher`), `pid`, `startedAt`, `messageId`, `loopTick` |
| `tick_ended` | `tickId` (id of the matching `tick_started`), `outcome` (`ok`\|`timeout`\|`error`\|`noop`), `code`, `signal`, `timedOut`, `headMoved`, `lanesTouched` (short ids), `stagesClosed` |
| `stage_started` | `task` (short id), `stage` (`plan`\|`implement`\|`review`), `actor` (employee), `worktree` (repo-relative or null), `branch`, `cycle` (rework cycle number or null) |
| `stage_ended` | `task`, `stage`, `actor`, `outcome` (`completed`\|`error`\|`cut_by_timeout`\|`unclosed`), `reason` (free text or null), `closedBy` (`orchestrator`\|`watcher-settle`\|`watcher-sweep`), `startedId`, `durationS` |
| `subagent_spawned` | `task`, `stage`, `actor` (employee), `model` (string or null) |
| `subagent_exited` | `task`, `stage`, `actor`, `exit` (`ok`\|`error`\|`cut_by_timeout`\|`unclosed`), `closedBy`, `spawnedId`, `durationS`, `tokens` (null — reserved), `costUsd` (null — reserved) |

Two deliberate deviations from the description's minimum set, both recorded here so the
next reader does not re-derive them:

1. **No `nonce` on `tick_started`.** AS-27 established that the fire nonce is the lock's
   anti-spoof token and never reaches a client (`loop-status.js` builds the tick field by
   field for exactly this reason). `/api/events` is a read-back endpoint; a nonce written to
   the stream would be served to every browser tab. The tick's identity in the stream is the
   `tick_started` event's own id, which `tick_ended.tickId` references. Stage events carry no
   tick id at all: single-flight means a stage event belongs to the tick whose `tick_started`
   precedes it with no `tick_ended` between — derived, never declared.
2. **A fourth stage outcome, `unclosed`.** A tick that exits cleanly (code 0, not timed out)
   with a stage still open means the orchestrator never emitted `stage_ended` — the procedure
   was not followed, and the stage may or may not have completed. Recording that as
   `completed` invents a fact; recording it as `error` blames the stage for the orchestrator's
   omission. `unclosed` is the honest word, and the count of them per week is a direct measure
   of whether the tick procedure is being followed. Same value on `subagent_exited.exit`.

Stage names map to the board: `plan` brackets `in_planning → planned`; `implement` brackets
`in_progress → review`; `review` brackets `review → done | in_progress | in_planning`. A stage
the orchestrator performs itself (a cofounder writing a plan in-session, as here) emits
`stage_*` only — no `subagent_*` — which is why the two pairs exist: the board stage and the
process are different facts.

**Write discipline.** One `appendFileSync(path, line + '\n')` per event — one write syscall,
whole line — after `mkdirSync(dirname, { recursive: true })`. A line over 8 KiB is refused
(exit 1, nothing written): every shape above serialises in well under 1 KiB, and the cap keeps
single-write atomicity on every local filesystem we run on. Writers never overlap in practice
(the sweep is gated off while a tick child runs; `settle()` runs after the child has exited;
sub-agents never emit — only the orchestrator does), and O_APPEND single-write is the belt.
The reader's tolerant line parser (skip and count malformed lines, `readTaskEvents`'s rule) is
the suspenders. **Volume:** ~10 events per tick × ≤ 24 ticks per loop × ~350 B ≈ 85 KB per
full day of loops; the whole-file reads below are cheap for months. Revisit trigger for a
retention task: the file passes 8 MiB or `/api/events` p50 passes 50 ms (measured, not
guessed).

### T2. The reconciler — the M4 property and its falsifier

**Property (from the description):** a stage cut by the tick timeout is recorded as
`cut_by_timeout`, never as `completed`. The orchestrator that would have emitted `stage_ended`
is dead when this matters, so it cannot be the one to write it.

**Who closes:** the watcher, in two places, both in a new `makeEventsOps` factory (the fourth
beside `makeLockOps` / `makeDeployOps` / `makeLoopOps`, same injection style, `main()` keeps
only wiring):

1. **`settle()` — exact, immediate.** The existing `settle(code, signal)` closure in `fire()`
   is the only code that knows `timedOut`, `code`, `signal` and `headBefore/headAfter`, and it
   runs after the child has exited. It calls `eventsOps.tickEnded({...})`, which (a) reads the
   open set (below), (b) writes one `subagent_exited` per open sub-agent and one `stage_ended`
   per open stage with `closedBy: 'watcher-settle'` and outcome
   `timedOut ? 'cut_by_timeout' : (code !== 0 || signal) ? 'error' : 'unclosed'`, then (c)
   writes `tick_ended` with `outcome = timedOut ? 'timeout' : (code !== 0 || signal) ? 'error'
   : (no stage_started in this tick && !headMoved) ? 'noop' : 'ok'`, `lanesTouched` = the
   distinct `data.task` of this tick's `stage_started` events, `stagesClosed` = the count from
   (b). Order (b)-before-(c) is a stated property: a consumer must never observe a closed tick
   with a stage still open. Single-flight is what makes (a) correct: exactly one tick runs at a
   time, so anything open at settle belongs to the tick that just ended, or to an even older
   corpse — dead either way.
2. **`sweep()` — level-triggered, for ticks the watcher did not fire.** Every
   `DEFAULTS.eventsSweepS = 60` (`ADVANCE_EVENTS_SWEEP_S`), skipped while our own child runs
   or any *fresh* lock is held (the deploy's `lockIsBusy` rule, injected as `lockBusy()` so
   there is one staleness rule, not two). When it runs: every open stage/sub-agent whose
   `ts` is ≥ `tickTimeoutMin` old is closed with `cut_by_timeout`, `closedBy: 'watcher-sweep'`;
   younger ones are left alone (a live-session tick that released its lock between stages, or
   an orchestrator about to emit). Also: an open `tick_started` with no `tick_ended` and no
   fresh lock (the watcher died mid-tick and was relaunched) is closed as
   `tick_ended{outcome: 'error', reason: 'watcher-restarted'}` — a resumed loop (AS-95 F2)
   must not leave the previous process's tick open forever.

**What "open" is and where it lives: derived from the stream, every time.** `openItems()`
does one tolerant read of the file and folds it: a `stage_started` is open until a
`stage_ended` with the same `(task, stage, actor)` arrives after it (matching on
`startedId` when present, else on the triple); same for sub-agents on `spawnedId` / triple.
There is no open-set file, no in-memory set that outlives one call, and nothing the
orchestrator has to tell the watcher. If the orchestrator's own `stage_ended` lands, the
watcher's next read sees it closed. That is the doctrine applied to the reconciler itself:
one stream, and the reconciler is just another projection of it that happens to write back.

**Falsifiers (AC-7, AC-8, AC-9, AC-10 in T7):** a planted open `stage_started`, a settle with
`timedOut: true` → the file gains `stage_ended{outcome: 'cut_by_timeout'}` *before*
`tick_ended{outcome: 'timeout'}`; the mutant that writes `completed` is red. A planted open
stage 31 min old, no lock, no child → the sweep closes it `cut_by_timeout`; 29 min → untouched;
a fresh lock → untouched at any age. A `stage_ended` planted by hand between two
`openItems()` calls → the second call no longer lists it.

**Known gap, recorded with its default:** live-session ticks (`/loop /advance`, lock source
`loop`/`manual`) produce stage events but no `tick_*` — the watcher is the only tick-event
producer in v1. Their orphaned stages are still closed by the sweep. The target operating
model is the watcher loop (CLAUDE.md § Operating Modes), so the gap shrinks on its own.
Default answer: leave it. Revisit trigger: a foreman-floor task needs tick correlation for a
live-session tick. Time-box: not before that.

### T3. The producer CLI — `apps/chat/bin/events.js`

Zero dependencies, `node:*` only, the `bin/chat.js` mould (`parseArgs` with an explicit flag
list, `fail()` exits 1 with usage, `--json` for machine output). It never opens the chat DB
and never talks to the server: the stream is a host file the CLI owns end to end, so the
AS-24 mode question does not arise. Argv surface, exact:

```
events emit <type> --actor <emitter> [type flags] [--json]
  stage_started     --task AS-<n> --stage plan|implement|review --employee <id> [--worktree <rel>] [--branch <name>] [--cycle <k>]
  stage_ended       --task AS-<n> --stage <stage> --employee <id> --outcome completed|error [--reason "…"]
  subagent_spawned  --task AS-<n> --stage <stage> --employee <id> [--model <name>]
  subagent_exited   --task AS-<n> --stage <stage> --employee <id> --exit ok|error
  tick_started / tick_ended — accepted for completeness (watcher-shaped flags), never used by the tick procedure
events tail [--since <id>] [--limit <n>] [--task AS-<n>] [--json]   read-only, host file, same filters as /api/events
events open [--json]                                                 the open set (T2), for a tick's "assess state" step
```

- `--actor` is the emitter and lands in the envelope; `--employee` is `data.actor`. Both
  required on the four stage/sub-agent types; no defaulting of one from the other, because
  "who decided" and "who is doing the stage" are different questions and the record should
  not guess. Ids must match `^(agent|human|system):[a-z0-9-]+$`.
- Validation is exhaustive before the write: unknown type, missing required flag, a `stage`
  or `outcome`/`exit` outside its enum, a `--cycle` that is not a positive integer → exit 1,
  zero bytes written. `cut_by_timeout` and `unclosed` are **not** accepted from the CLI
  (`--outcome`/`--exit` enums are `completed|error` and `ok|error`): only the reconciler may
  say a stage was cut, so a human or an orchestrator cannot narrate a timeout that did not
  happen.
- `--task` resolves through `ids.json` (`CHAT_REPO_ROOT`, `latticeRoot()`); an unresolvable
  short id warns and still emits with `task_id: null` (T1).
- Output: the envelope's id on stdout (`--json`: the whole envelope). `stage_ended` /
  `subagent_exited` from the CLI fill `startedId` / `spawnedId` / `durationS` by reading the
  stream for the matching open item (best effort; null when none — the event is still
  written) and set `closedBy: 'orchestrator'`.
- All emit logic is `lib/events.js` (`makeEvent`, `appendEvent`, `parseJsonl`,
  `readStream`, `foldEvent`, `reduceLiveness`, `openItems`, `EVENT_SHAPES`, `ulid`) so the
  CLI, the watcher and the server share one implementation and cannot drift.

### T4. The projection — server, SSE, and the AS-99 composer extension

**HTTP: `GET /api/events?since=<id>&task=AS-<n>&limit=<n>` → `{ stream, events }`.** No `me`,
no store, no visibility gate — the same contract as `/api/lanes` and `/api/loop-status`;
nothing here is viewer-relative or private (actor ids and task ids are repo-public, worktree
paths are repo-relative). `since` is exclusive by id; `limit` defaults to 200, caps at 1000;
`task` filters on `data.task`. Events are read from the file per request through the tolerant
parser and sorted `(ts, id)`. `stream` ∈ `{ reason: 'ok' | 'no-stream' | 'unreadable-stream'
| 'truncated', path: null, lastId, lastTs, malformed, open: { stages: n, subagents: n } }`
(`path` is deliberately not the host path — nonce rule by analogy). `no-stream` is a 200 with
`events: []`: a pre-AS-100 watcher writes no file, and that is not an error. Every event is
passed through `projectEvent(ev)` — envelope keys exact, `data` keys exactly `EVENT_SHAPES[type]`
— so a grown line never leaks a field (the AS-27 rule; AC-12).

**SSE: `event: company`, one frame per new event, data = the projected envelope.** The
server tails the file on `EVENTS_POLL_MS = 2_000` (exported, pinned like `LOOP_POLL_MS`) by
byte offset: stat, read from offset, split complete lines, keep the partial tail, push one
frame per parsed line in file order to every open connection (no visibility gate). A file
shorter than the offset is a truncation: reset the offset to 0, reset the fold, report
`stream.reason: 'truncated'` until the next append — a fact, never a crash (AC-14). **No
`company` frame on connect** and no replay: a log has no "current"; `/api/events?since=` is
the catch-up, and AS-99's `openStream` helper therefore needs no change beyond the one AS-99
already makes. Reserved and named here so consumers subscribe without guessing (board ruling
DM msg 668, recorded on this task): `event: company` = this persisted stream; `event:
activity` = AS-103's ephemeral tool-level frames, which have **no** HTTP read-back and are
never written to this file. This plan does not implement `activity`.

**The composer extension.** `composeLanes` (AS-99, `lib/lanes.js`) gains one optional input,
`liveness` (default `null`), produced by `reduceLiveness(events, { nowMs, tickLive,
tickTimeoutMs })` in `lib/events.js` — pure, and the same `foldEvent` the server's incremental
tail uses (AC-15 holds the two equal). `readLanes()` in `server.js` passes the tail's current
fold; the lanes poll's `lanesKey` gains the liveness fields that should earn a frame
(`stageStartedAt`, `subAgent.alive`, `subAgent.lastEvent.id`) and excludes `elapsedS`, which
moves every poll (AC-17). Per lane, keyed by `lane.key` (AS-99's join key) ↔ `data.task`:

- `stageStartedAt` — `ts` of the most recent `stage_started` for the lane (open or not);
  `null` when the stream has no stage event for it.
- `subAgent` — `null` when no `stage_started` exists for the lane; else
  `{ actor, stage, alive, startedAt, elapsedS, lastEvent: { id, type, ts, outcome } }` where
  `actor`/`startedAt` come from the most recent `subagent_spawned` inside the current stage
  when there is one, else from the `stage_started` itself; `elapsedS` is `now − startedAt`
  while alive and `durationS` (or `endedAt − startedAt`) once ended; `lastEvent` is the last
  stage/sub-agent event for the lane, `outcome` from `stage_ended.outcome` /
  `subagent_exited.exit`, null on start events.
- The description's four names map onto these two slots — `subagentAlive` → `subAgent.alive`,
  `stageStartedAt` → itself, `stageElapsedS` → `subAgent.elapsedS`, `lastEvent` →
  `subAgent.lastEvent` — **so the lane card's key set is byte-identical to AS-99's** (AC-16),
  which is the description's own acceptance test for "extensible, not a one-off". Rejected: a
  top-level `lastEvent` key — it would change the card's key set and force an edit to AS-99's
  own whitelist test, which is exactly the rewrite the contract forbids.
- Projection top level gains one sibling of `snapshot`: `events` = the `stream` object above
  (same reason enum; the `snapshot.reason` discipline for the third input). The lanes render
  regardless of `events.reason` — the git and Lattice halves are independent — and the two
  slots read from `events.reason` when the stream is missing ("no event stream" caption),
  never a bare null in the UI. `lanes` goes `null` only on AS-99's own `no-snapshot` /
  `unreadable-snapshot`, unchanged.

**Liveness — decided from events alone, bounded by the tick clock.**
`alive = open ∧ (tickLive ∨ ageMs < tickTimeoutMs)` where `open` = `stage_started` (or
`subagent_spawned`) with no matching end event; `tickLive` = `deriveLoopStatus(...).tick !==
null` (a fresh lock, the one existing rule for "a tick is running", imported rather than
restated); `tickTimeoutMs` = `DEFAULTS.tickTimeoutMin * 60_000` from the watcher (the server
already imports `DEFAULTS`). While a watcher tick holds its lock every open stage is alive
(it will be closed by `settle()` the moment the tick ends); once no lock is held an open
stage counts as alive for at most the tick box, after which `alive: false` with
`lastEvent.type === 'stage_started'` — the UI reads that pair as "no signal since HH:MM
(tick box expired)", never as "running" (AC-18). The sweep closes it as `cut_by_timeout`
within one sweep interval, at which point `lastEvent` becomes the `stage_ended`.

**UI (`public/lanes.js`, `public/app.js`):** fill AS-99's two placeholder slots from
`stageStartedAt`/`subAgent` — "planning · developer-lena · 4 m 12 s" while alive; "review
ended 3 m ago · completed"; "implement · cut by tick timeout 04:21"; "unclosed at tick end"
— and the pane caption line for `events.reason`. Elapsed is recomputed client-side on the
existing 15 s render timer from `startedAt` (the AS-27 pattern; `elapsedS` is a convenience
for non-browser consumers). No new pane, no new element ids, no spatial layout: the foreman
floor is a later task over this stream.

### T5. The tick-procedure change — proposed wording for `.claude/commands/advance.md`

Employees do not edit that file; the metawork layer applies this verbatim. Tick start and end
need **no** wording: the watcher owns them, and the procedure must say so, or an orchestrator
will helpfully double-emit. Proposed insertion at the end of step 3 ("Execute via employees"):

> **Company events (AS-100).** Tick start and end are recorded by the watcher; the orchestrator never emits `tick_*`. At each stage boundary the orchestrator runs the emit CLI as a plain top-level Bash command — never inside `$(…)`, a pipeline, or a compound command, which the headless permission layer denies (AS-92) — with `--actor` set to the orchestrating employee and `--employee` to the employee doing the stage:
> - **Before spawning a stage's employee:** `node apps/chat/bin/events.js emit stage_started --task AS-<n> --stage plan|implement|review --employee agent:<employee-id> --actor agent:<orchestrator-id> --worktree .worktrees/AS-<n> --branch feat/AS-<n>-<slug>` (omit the last two when no branch is cut yet; add `--cycle <k>` on a rework cycle), then `node apps/chat/bin/events.js emit subagent_spawned --task AS-<n> --stage <stage> --employee agent:<employee-id> --actor agent:<orchestrator-id>`. A stage the orchestrator performs itself emits `stage_started` only.
> - **When the employee returns:** `node apps/chat/bin/events.js emit subagent_exited --task AS-<n> --stage <stage> --employee agent:<employee-id> --actor agent:<orchestrator-id> --exit ok|error`.
> - **After the stage's board transition is recorded** (`planned`, `review`, `done`, or a rework transition): `node apps/chat/bin/events.js emit stage_ended --task AS-<n> --stage <stage> --employee agent:<employee-id> --actor agent:<orchestrator-id> --outcome completed|error`.
>
> If an emit is denied or exits non-zero, write one line in the tick report naming the boundary ("events: emit denied at stage_ended AS-<n>") and carry on — never write the JSONL by hand, never retry inside a compound command, and never emit an event for something that did not happen. A stage left open is closed by the watcher when the tick ends (`cut_by_timeout` on a timeout, `unclosed` on a clean exit), and the count of `unclosed` stages is how the board sees whether this paragraph is being followed. `node apps/chat/bin/events.js open` in step 1 lists what an earlier tick left open, for the same reason `git worktree list` is read there.

And one sentence in the Bounds list, after the WIP-limit bullet the metawork layer is already
applying: "Every stage started in a tick is either ended by its own `stage_ended` emit or
closed by the watcher — a tick never deletes or edits a line in `apps/chat/data/events/`."

The metawork layer should also append to CLAUDE.md § "Observability north star" one sentence
naming the two SSE event names: "`event: company` is the persisted AS-100 stream (HTTP
read-back at `/api/events`); `event: activity` is reserved for AS-103's ephemeral frames (no
read-back)." Proposed here per the DM-668 ruling comment on this task.

### T6. File / change table

| File | Change |
|---|---|
| `apps/chat/lib/events.js` (new) | Pure core: `ulid()`, `EVENT_TYPES`, `EVENT_SHAPES`, `makeEvent({type, actor, taskId, data, now})` (validates type, enums, required keys; sorted-key serialise), `appendEvent(path, ev, {append, mkdir})` (mkdir recursive; 8 KiB cap; one append), `parseJsonl(text)` → `{events, malformed}`, `readStream(path, {readFile})` → `{events, malformed, reason}`, `sortEvents`, `foldEvent(state, ev)`, `reduceLiveness(events, {nowMs, tickLive, tickTimeoutMs})`, `openItems(events)`, `projectEvent(ev)` (whitelist), `tickOutcome({code, signal, timedOut, stagesStarted, headMoved})`, `stageCloseOutcome({code, signal, timedOut})`. No fs by default, no clock, no process; every effect injectable. |
| `apps/chat/lib/lattice.js` | `readTaskEvents` switches its line loop to `parseJsonl` (one parser for both streams — AC-1's mechanism). Behaviour-preserving; existing `lattice.test.js` stays green unmodified. |
| `apps/chat/bin/events.js` (new) | The CLI of T3. `CHAT_EVENTS_PATH` override; `CHAT_REPO_ROOT` for id resolution. |
| `apps/chat/watch/advance-watcher.mjs` | `DEFAULTS.eventsSweepS = 60` + `ADVANCE_EVENTS_SWEEP_S` in `loadConfig`; `makeEventsOps({streamPath, tickTimeoutMs, lockBusy, isBusy, log, now, readFile, append, mkdir})` with `tickStarted()`, `tickEnded()`, `sweep()`, `openItems()`, never throws (a failed append degrades the feed, not the tick — the `persist()` pattern); wiring in `main()`: construct after `deployOps` (it borrows `lockIsBusy` via an exported helper or an injected closure), `eventsOps.tickStarted({source: 'watcher', pid, messageId, loopTick})` in `fire()` immediately after the highwater write, `eventsOps.tickEnded({code, signal, timedOut, headBefore, headAfter})` in `settle()` after `releaseLock()` and before `loopOps.settle()`, `setInterval(sweep, eventsSweepS*1000).unref()`, `clearInterval` in `shutdown`, startup log line naming the cadence and the path. `tickArgv`/`tickChildEnv` untouched (the CLI needs neither; their pin tests stay green). |
| `apps/chat/server.js` | `EVENTS_PATH = join(loopDir, 'events', 'company.jsonl')` (env override honoured); `EVENTS_POLL_MS = 2_000` exported; tail state `{offset, partial, fold, reason}`; `eventsPoll` interval (push `company` frames, update fold, detect truncation); `GET /api/events`; `readLanes()` passes `liveness` from the fold and `tickLive` from `readLoopStatus()`; `lanesKey` extended per T4; `clearInterval(eventsPoll)` in `close()`. |
| `apps/chat/lib/lanes.js` (AS-99, merged) | `composeLanes({..., liveness = null})`: fill `stageStartedAt`/`subAgent` from `liveness[lane.key]`, add top-level `events`. No key renamed, none removed, none added to the lane card. |
| `apps/chat/public/lanes.js`, `public/app.js` | `describeLane` fills the two slots; `EVENTS_REASONS` sentence table (exact key set); caption for `events.reason`; client-side elapsed on the 15 s timer. `index.html`/`style.css`: no new ids expected (AS-99's placeholders are the targets); a class for the `--cut`/`--unclosed` tones at most. |
| `apps/chat/watch/README.md` | Files table: `events/company.jsonl` row (producers, reconciler, sweep cadence). |
| `apps/chat/README.md` | New section "Company events (AS-100)": the file, the envelope, the six types, the CLI, `/api/events`, `event: company` vs `event: activity`, the liveness rule, the `unclosed` meaning, the retention trigger. |
| tests | `test/events.test.js` (pure core: ulid, shapes, parse, fold/reduce, outcomes, projectEvent), `test/events-cli.test.js` (spawn the bin against a temp `CHAT_EVENTS_PATH` + fixture `CHAT_REPO_ROOT`, the `cli.test.js` harness), `test/watcher-events.test.js` (`makeEventsOps` on injected fs/clock/lock — never `main()`), additions to `test/api.test.js` (`/api/events` from planted files via `loopFixture` — which gains an `eventsBody` key, planted at `events/company.jsonl` — key whitelist, `EVENTS_POLL_MS` pinned), `test/stream.test.js` (`company` frames: change-only, order, truncation; `lanes` frame on liveness change and not on elapsed), `test/lanes.test.js` (composer with and without `liveness`; AC-16). |
| `test/deploy-shape.test.js`, `compose.yaml`, `Dockerfile`, `IMAGE_INPUTS` | **No change.** `bin/`, `lib/`, `watch/`, `test/`, `public/` are already image inputs, so this merge rebuilds the image and restarts the watcher on its own (AS-75). If the implementer finds a mount change is needed, that is a plan-level finding. |

### T7. Acceptance criteria — each property names its falsifier (M4)

The counted run is `DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 docker compose run --rm
--build test` from `apps/chat`, valid only with the `Image … Built` receipt. **Baseline
recorded at planning: host `node --test` on master = 367 tests, 0 failing** (2026-09-11, this
tick; the compose count at the AS-99 merge is the baseline the implementer records before
the first commit). A headless tick cannot run docker (AS-92); implementer and reviewer quote
host `node --test` numbers **labelled as the host run**, and the compose run is a merge
precondition supplied from a session with docker and recorded on the task with the receipt
line before `done`. Mutants run on a **scratch copy**, matched to the intended site (the
AS-95 sharpening: assert the mutation landed where you meant it before reading a survivor as
a weak guard). Test names are the ids; a wider or narrower red set is itself a finding.

1. **AC-1 envelope compatibility.** An emitted line parsed by `parseJsonl` — the same
   function `readTaskEvents` now uses — has keys deepEqual
   `['actor','data','id','schema_version','task_id','ts','type']` in that (sorted) order,
   `schema_version === 1`, finite `Date.parse(ts)`; a file mixing one Lattice line and one
   company line parses to two events sorted `(ts, id)`. Mutant: drop `schema_version` from
   `makeEvent` → red `events-envelope-keys`. Mutant: `readTaskEvents` keeps its private loop →
   red `lattice-events-share-parser` (asserts the import, the one structural test in the set).
2. **AC-2 ids.** 1 000 `ulid()` calls in one process: all `^cev_[0-9A-HJKMNP-TV-Z]{26}$`,
   strictly increasing lexically, none equal. Mutant: no same-ms increment → red
   `events-id-monotonic`.
3. **AC-3 append-only.** Emit A then B → file has exactly 2 lines and line 1 is byte-identical
   to the file after A alone; a third emit into a pre-existing file with a trailing partial
   line still starts on a fresh line. Mutant: `writeFileSync` for `appendFileSync` → red
   `events-append-only`. Falsifier stated in the description ("reopen and truncate"): the
   only code path that can shorten the file is absent from `lib/events.js` and `bin/events.js`
   — `grep -c 'truncate\|writeFileSync' apps/chat/lib/events.js apps/chat/bin/events.js` is 0,
   asserted as `events-no-truncating-path`.
4. **AC-4 CLI validation is exhaustive and side-effect-free.** Table of bad invocations
   (unknown type; missing `--actor`; missing `--employee` on `stage_started`; `--stage qa`;
   `--outcome cut_by_timeout`; `--exit unclosed`; `--cycle 0`; bad actor id) → each exit 1
   with usage on stderr and the stream file absent afterwards. Cardinality first: 8 cases, 8
   refusals. Mutant: accept `cut_by_timeout` from the CLI → red `events-cli-rejects-cut`.
5. **AC-5 task resolution never blocks the record.** `--task AS-7` against the fixture root →
   `task_id` filled from `ids.json`; `--task AS-999` → `task_id: null`, exit 0, one stderr
   warning, line written. Mutant: exit 1 on unresolved → red
   `events-cli-unresolved-task-still-emits`.
6. **AC-6 tick outcome mapping** (`tickOutcome`): `{timedOut}` → `timeout`; `{code: 1}` and
   `{signal: 'SIGTERM'}` → `error`; `{code: 0, stagesStarted: 0, headMoved: false}` → `noop`;
   `{code: 0, stagesStarted: 1}` and `{code: 0, headMoved: true}` → `ok`. Mutant: `timedOut` →
   `error` → red `watcher-events-outcome-timeout`.
7. **AC-7 THE FALSIFIER FROM THE DESCRIPTION.** Planted stream: `tick_started`, one
   `stage_started` (AS-95, implement, developer-marcus), nothing else. `tickEnded({timedOut:
   true, code: null, signal: 'SIGTERM'})` → the file gains exactly two lines, in order:
   `stage_ended{task: 'AS-95', outcome: 'cut_by_timeout', closedBy: 'watcher-settle',
   startedId: <the stage_started id>}` then `tick_ended{outcome: 'timeout', lanesTouched:
   ['AS-95'], stagesClosed: 1, tickId: <the tick_started id>}`. Assert `outcome !==
   'completed'` explicitly, and that an open `subagent_spawned` is closed the same way with
   `exit: 'cut_by_timeout'`. Mutant: outcome `'completed'` → red
   `watcher-events-timeout-closes-as-cut`. Mutant: write `tick_ended` first → red
   `watcher-events-close-before-tick-ended`.
8. **AC-8 sweep honours the tick box and the lock.** Open stage 31 min old, `lockBusy()` false,
   `isBusy()` false → closed `cut_by_timeout`, `closedBy: 'watcher-sweep'`; 29 min → untouched;
   31 min with `lockBusy()` true → untouched; 31 min with `isBusy()` true → untouched; an open
   `tick_started` (source watcher) with no lock → `tick_ended{outcome: 'error', reason:
   'watcher-restarted'}`. Mutant: drop the lock gate → red `watcher-events-sweep-respects-lock`.
   Mutant: compare against `2 * tickTimeoutMs` → red `watcher-events-sweep-boundary`.
9. **AC-9 the open set is derived, never stored.** `openItems()` lists the planted open stage;
   append a matching `stage_ended` by hand (simulating the orchestrator's emit); `openItems()`
   again → empty, with no method on `eventsOps` having been told. Mutant: cache the open set
   at construction → red `watcher-events-open-derived-from-stream`.
10. **AC-10 a clean exit with an open stage is `unclosed`.** `tickEnded({code: 0})` over an
    open stage → `stage_ended{outcome: 'unclosed'}`, `tick_ended{outcome: 'ok'}`. Mutant:
    `'completed'` → red `watcher-events-unclosed-not-completed`.
11. **AC-11 `/api/events`.** Planted file of 5 events plus one malformed line: no query → 5 in
    `(ts, id)` order and `stream.malformed === 1`; `since=<id of #3>` → exactly `[#4, #5]`;
    `task=AS-7` → the matching subset; `limit=2` → 2; `limit=5000` → capped at 1000 (asserted
    via a 1 001-line fixture); absent file → 200, `events: []`, `stream.reason: 'no-stream'`;
    garbage file → `'unreadable-stream'`. Mutant: `since` inclusive → red
    `api-events-since-exclusive`.
12. **AC-12 key whitelist on the projection.** For every type, an event planted with an extra
    `data.secret` and an extra envelope key `host`: `/api/events` and the `company` frame
    carry `Object.keys(data)` deepEqual `EVENT_SHAPES[type]` and the envelope's exact seven
    keys; `JSON.stringify(payload)` does not contain `secret` or the host path. Mutant: spread
    `ev.data` → red `api-events-key-whitelist`.
13. **AC-13 change-only push, in order.** Stream open; append one line → exactly one `company`
    frame within three polls (`EVENTS_POLL_MS` injected small, as `loopPollMs` is), carrying
    that id; ten further polls untouched → zero frames; two lines appended in one write → two
    frames in file order. Mutant: re-emit the last event each poll → red
    `stream-company-change-only`.
14. **AC-14 truncation is a fact, not a crash.** After two frames, truncate the file to 0 and
    append one new line → the server stays up, `stream.reason === 'truncated'` on
    the lanes projection's `events` block, `/api/events` stays 200 and returns the
    post-truncate content, exactly one further `company` frame (the new line), and the next
    append clears the reason. Mutant: throw on `size < offset` → red
    `stream-company-truncation`. *(Amended 2026-09-11 by the plan owner at cycle 4, from
    Lena's deviation note: `/api/events` re-reads the file through `readStream()`, so after a
    truncate the file it reads is intact — "truncated" is a fact about this process's byte
    cursor, which only the tail, and therefore only the lanes projection, holds. The original
    wording asked `/api/events` to report the tail's reason, which contradicts the cycle-3
    decision that the two doors are separate readers.)*
15. **AC-15 liveness reducer.** Cases: open + 5 min + no tick → `alive: true`; open + 31 min +
    no tick → `alive: false`, `lastEvent.type === 'stage_started'`; open + 31 min + `tickLive`
    → `alive: true`; ended `completed` → `alive: false`, `elapsedS === durationS`,
    `lastEvent.outcome === 'completed'`; `subagent_spawned` after `stage_started` → `subAgent
    .actor` is the spawned employee; two lanes interleaved → independent; a lane with only a
    `subagent_exited` (orphan) → `subAgent: null`, never a throw. Property: `reduceLiveness(all)`
    deepEqual the incremental `foldEvent` over the same list in any prefix split. Mutant:
    bound by `2 * tickTimeoutMs` → red `events-liveness-bound`. Mutant: incremental path skips
    `subagent_exited` → red `events-fold-incremental-equals-batch`.
16. **AC-16 AS-99 card shape unchanged.** `composeLanes` without `liveness` → output deepEqual
    AS-99's own fixture expectation (`stageStartedAt: null`, `subAgent: null`), and AS-99's
    `api-lanes-key-whitelist` test passes **unmodified** — the implementer does not edit its
    expected key list. With `liveness` present: `Object.keys(lane)` deepEqual the same list,
    both slots non-null, `Object.keys(lane.subAgent)` deepEqual `['actor','stage','alive',
    'startedAt','elapsedS','lastEvent']`, `Object.keys(lane.subAgent.lastEvent)` deepEqual
    `['id','type','ts','outcome']`, and the projection's top-level keys are AS-99's plus
    `events`. Mutant: add a top-level `lastEvent` to the lane → red
    `lanes-liveness-shape-unchanged` (and AS-99's whitelist test, which is the point).
17. **AC-17 a stage change earns a `lanes` frame; elapsed does not.** With a planted snapshot
    and task, append `stage_started` → exactly one `lanes` frame whose lane has
    `subAgent.alive === true`; ten polls later with nothing appended → zero frames (elapsed
    moved, key did not); append `stage_ended` → one frame with `alive === false`. Mutant:
    include `elapsedS` in `lanesKey` → red `stream-lanes-liveness-change-only`.
18. **AC-18 the words the board reads.** Every `events.reason` maps to a sentence (exact
    key-set assertion, the `BUILD_REASONS` pattern); every `stage_ended.outcome` and
    `subagent_exited.exit` value maps to a sentence; `describeLane` with `subAgent: null` reads
    "no stage events yet"; `alive: false` with `lastEvent.type === 'stage_started'` reads "no
    signal since …" and never contains "running"; `events.reason === 'no-stream'` fills both
    slots with "no event stream". Mutant: return "running" for the stale-open case → red
    `lanes-label-stale-open-not-running`.
19. **AC-19 first emit creates the directory.** `CHAT_EVENTS_PATH` pointing into a
    non-existent `events/` dir → emit exits 0 and the file exists with one line. Mutant: drop
    the `mkdirSync` → red `events-cli-creates-dir`.

**Review probes past the list (M6, budgeted):** run a real emit on the host against a scratch
`CHAT_EVENTS_PATH` while the container's server tails it (bind mount): confirm the `company`
frame arrives in the browser within ~2 s and the lane slot fills; kill the watcher with an
open planted stage and confirm the slot flips to "no signal" at the tick box and to "cut by
tick timeout" within one sweep after a restart; append a 9 KiB line by hand and confirm the
CLI refuses it but the reader tolerates it (`malformed` counts, nothing crashes); open
`/api/events?since=` with a nonsense id and with a Lattice `ev_` id (both: empty result, 200);
confirm the Escape chain and AS-99's pane are untouched by this diff.

### T8. Scope, key files, branch, people

**In scope:** everything in T6; the six types; the CLI; the reconciler (settle + sweep);
`/api/events`; `event: company`; the composer extension and the two filled slots; the
proposed wording in T5 for the metawork layer.

**Out of scope (deliberately, repeating the description):** tool-level activity of a running
employee (AS-103; `event: activity` is reserved, not built); token/cost per stage (the
`tokens`/`costUsd` slots exist and stay null); any spatial or animated rendering; retention or
compaction (append-only until the T1 trigger is measured); `tick_*` from live-session ticks
(T2 gap); a `Last-Event-ID` replay for any stream; changes to `advance.md`, `CLAUDE.md`,
compose, or the Dockerfile by an employee.

**Key files:** `apps/chat/lib/events.js` (new), `apps/chat/bin/events.js` (new),
`apps/chat/watch/advance-watcher.mjs`, `apps/chat/server.js`, `apps/chat/lib/lanes.js` (AS-99,
merged first), `apps/chat/lib/lattice.js`, `apps/chat/public/{lanes.js, app.js}`,
`apps/chat/test/{events, events-cli, watcher-events}.test.js` (new), `apps/chat/test/{api,
stream, lanes}.test.js`, both READMEs.

**Branch:** `feat/AS-100-events-feed`, worktree `.worktrees/AS-100`.

**Implementer: `agent:developer-lena`.** Marcus holds AS-99 and, under lane doctrine, the
seam between the two is the composer — which is why this waits for his merge rather than
racing it. Lena is free, and the shape here is two factory-and-pure-core modules with an
injected-fs test harness, the pattern she has worked in on the watcher and the stream. She
reads the merged `lib/lanes.js` first and treats any drift from AS-99's T4 as a plan-level
finding on this task. **QA: `agent:qa-priya`**, default — Ruben is the AS-99 reviewer and
will likely be mid-review when this enters `review`; if AS-99 is closed by then, Ruben is the
better fit for the tail/truncation and settle-ordering seams. Either way the tasking message
gives the reviewer T7's criteria and the mutant descriptions, **not** the predicted red sets
as results (AS-36 rule), and tells them not to read any auto-review daemon note first.

**Time-box note (my own failure mode, recorded):** the tick-correlation question — should
stage events carry a tick id, should live-session ticks get `tick_*` — could absorb a week.
Default taken: interval correlation under single-flight, watcher-only tick events, the gap
written in T2 with its revisit trigger. The `unclosed` outcome is the one place I widened the
description's enum, and I did it because the alternative was a recorded lie.

---

## Implementation notes — cycle 1 (developer-lena, 2026-09-11T05:42Z, watcher:25355; hard-stopped by the tick clock, tree clean)

**Done (commits 145ad17, 7ff7860, 0205cc7, efadfac):** T6 rows 1, 2 and 5 — `lib/events.js` + `test/events.test.js`, the `lib/lattice.js` parser switch, `bin/events.js` + `test/events-cli.test.js`, the `lib/lanes.js` composer half + `test/lanes.test.js`. Host run at efadfac: 441/441 (baseline 423). 13 mutants, 13 red, 0 survivors (one first-run survivor was a genuinely weak guard, fixed in efadfac; drivers and logs in `scratchpad/developer-lena/`).

**Remaining, in order:** (1) `watch/advance-watcher.mjs` `makeEventsOps` + wiring + `test/watcher-events.test.js` (AC-6..10); (2) `server.js` `/api/events`, `company` SSE, tail/truncation, `readLanes()` liveness, `loopFixture.eventsBody` (AC-11..14, 17); (3) `public/lanes.js`/`app.js` words (AC-18) + both READMEs.

**Plan-level correction for row (2), T4 `lanesKey`:** the merged `lanesKey` in `server.js` (~line 321) serialises `lanes: p.lanes` wholesale, not field by field. AC-17 therefore cannot be met by adding fields: `lanesKey` must be restructured to map each lane to a reduced projection (`key`, the existing git/task fields, `stageStartedAt`, `subAgent.alive`, `subAgent.lastEvent.id`) so `elapsedS` stays out of the key. Required change, not an addition. The two reserved slots in `lib/lanes.js` match T4 exactly.

**Quiet adaptations already on the branch:** AC-3's grep narrowed to call sites (the literal `truncate` matched the reader's `'truncated'` reason string; M5 proves the narrowed pattern still catches a real call); the projection's top-level key list in `test/api.test.js` gains `events` (the one AS-99 assertion edited, as AC-16 sanctions — the lane-card list and `api-lanes-key-whitelist` are untouched); `stage_ended` and `tick_ended` carry a `reason` key (T2 requires it on the sweep's `tick_ended`; T1's table had omitted it). **Recorded weakness:** AC-15's `events-fold-incremental-equals-batch` is near-vacuous by construction because both paths share `foldEvent`; kept as a regression lock, and the plan's named mutant for it cannot be built — M8 covers the reducer's real content instead.

## Implementation notes — cycle 2 (developer-lena, 2026-09-11T05:56Z; stopped inside the tick box, tree clean)

**Done (commits f6e92b5, f8f98b1, 27c7b6d, 9415934):** T6 row 4 in full — `makeEventsOps` (`tickStarted`/`tickEnded`/`sweep`/`openItems`, never throws) plus every line of main()/fire()/settle()/shutdown wiring, `DEFAULTS.eventsSweepS = 60` / `ADVANCE_EVENTS_SWEEP_S`, `paths.events`; `test/watcher-events.test.js` (AC-6..AC-10, 13 tests); and the `watch/README.md` files-table row. `makeDeployOps` now exports its existing `lockIsBusy` on its return object so the sweep borrows the one staleness rule instead of restating it. Host run: 441 → 453, 0 failing (no compose count — a headless tick has no docker). 7 mutants, 7 red, 0 survivors (`scratchpad/developer-lena/mutants-row6.{mjs,log}`); M15 is the description's falsifier and reddens four tests because it replaces the `stageCloseOutcome` call rather than one branch.

**Remaining, in order:** (1) `server.js` — `/api/events`, `company` SSE frames via byte-offset tail with truncation detection, `readLanes()` liveness from the fold, the `lanesKey` restructure cycle 1 recorded as required for AC-17, `loopFixture.eventsBody`, and the `test/api.test.js` + `test/stream.test.js` cases (AC-11..14, AC-17); (2) `public/lanes.js`/`app.js` words (AC-18) and the `apps/chat/README.md` "Company events (AS-100)" section.

**Correction to T2, applied:** the plan describes the sweep's orphan-tick case as "an open `tick_started` with no `tick_ended`", but the merged fold carries no `open` flag on the tick — `foldEvent` sets `state.tick` on `tick_started` and clears it to `null` on `tick_ended`, so non-null *is* open. The first implementation tested `open.tick.open` and silently never closed an orphaned tick; `watcher-events-sweep-closes-open-tick-as-error` caught it. While fixing it, the hand-rolled tick-scope scan was replaced by the fold's own `tick.lanesTouched` / `tick.stagesStarted`, so `tick_ended.lanesTouched` cannot drift from the projection the server serves.

**Test-id hygiene, fixed on the branch:** AC-6's id `watcher-events-outcome-timeout` was already claimed by cycle 1 in `test/events.test.js` (it covers `tickOutcome` and `stageCloseOutcome` together, both pure core). Cycle 2 briefly declared a second test under the same name; two tests sharing one id makes a mutant's red set ambiguous about which guard fired. The duplicate was removed and its one extra case folded into the cycle-1 test. Rule for the rest of this task: one id names exactly one test.

## Implementation notes — cycle 3 (developer-lena, 2026-09-11T06:21Z; stopped by the tick clock, tree clean)

**Done (commits 0de28a7, 1411753):** the `server.js` half of T6 row 2 — `EVENTS_PATH`
(`CHAT_EVENTS_PATH` override, else `<loopDir>/events/company.jsonl`), exported
`EVENTS_POLL_MS = 2_000` with an injectable `eventsPollMs`, the byte-offset tail
(`{offset, partial, fold, reason, lastId, lastTs, malformed}` + `tailEvents()`), the
`eventsPoll` interval pushing one `company` frame per newly-appended event in file order,
`GET /api/events?since=&task=&limit=` served from a fresh `readStream()` read rather than the
tail, `readLanes()` passing `liveness` (from the tail's fold) and `tickLive` (from
`readLoopStatus().tick !== null`) plus the `events` stream object, the `lanesKey` restructure
cycle 1 recorded as required, and `clearInterval(eventsPoll)` in `close()`. Then **AC-11 and
AC-12** in `test/api.test.js`: `loopFixture` gains `eventsBody` (planted at
`<dataDir>/events/company.jsonl`, same "an omitted key deletes its file" rule as the other
five) and `eventLines()` (built through `makeEvent`, so a fixture can never plant a shape the
producer could not emit), plus `api-events-since-exclusive`, `api-events-key-whitelist` and
the `EVENTS_POLL_MS` production-value pin.

**Host run: 453 → 456, 0 failing (host `node --test`; the compose `--build` receipt is still
owed and no count here is a compose count). 3 mutants, 3 red, 0 survivors** — drivers and
the intended-site assertions in `scratchpad/developer-lena/` (`mutants-row2.sh` is the
written battery; the harness refused to execute a shell script in this tick, so each mutant
was driven line by line through `node -e`, which is also what produced the line numbers
below):

| # | Mutation | Site asserted | Red set |
|---|---|---|---|
| M-A | `since` becomes inclusive (`slice(at)`) | `server.js:460`, the one slice in `readEvents` | exactly `{api-events-since-exclusive}` |
| M-B | `/api/events` stops projecting (raw lines to the reader) | `server.js:477` | exactly `{api-events-key-whitelist}` |
| M-C | the fold's fallback match goes back to comparing `open.task` | `lib/events.js:314`, inside `matches()` | exactly `{api-events-since-exclusive}` |

**A real defect, found by the new guard (M-C is its regression lock).** `matches()` in
`lib/events.js` — my own cycle-1 code — fell back to `open.task === ev.data?.task` when a
close event carries no `startedId`/`spawnedId`. The fold never stores `task` on the stage or
sub record (the lane is keyed by it), so that comparison was `undefined === 'AS-7'` and the
**entire fallback branch was unreachable**: a `stage_ended` or `subagent_exited` emitted by
hand through the CLI never closed its lane, the stage stayed "open" until the sweep cut it as
`cut_by_timeout`, and the board would have read a finished stage as a timed-out one. Fixed in
1411753 by comparing `stage` and `actor` only. Worth recording for the reviewer: the whole of
cycle 1's `test/events.test.js` stays **green** under M-C, so that branch had no coverage at
all until an integration test planted a close event the way the CLI actually emits one. The
watcher's own `makeEventsOps` always passes the ids, which is why nothing caught it earlier.

**What this means for the gate: AC-11 and AC-12 are met (falsifiers observed). AC-13, AC-14
and AC-17 are NOT.** Their mechanisms are on the branch and nothing has broken them; under M4
that is documentation, not a guarantee, and a reviewer should read it that way.

**Remaining, in order:**
1. `test/stream.test.js` — AC-13 (change-only, in order, `eventsPollMs` injected small),
   AC-14 (truncate to 0, one further frame, `reason: 'truncated'`, cleared on the next
   append), AC-17 (a stage change earns a `lanes` frame, ten elapsed-only polls do not).
   Mutants: `stream-company-change-only`, `stream-company-truncation`,
   `stream-lanes-liveness-change-only`.
2. `public/lanes.js` / `public/app.js` words (AC-18, mutant `lanes-label-stale-open-not-running`)
   and the `apps/chat/README.md` "Company events (AS-100)" section.

**Decisions taken where T4 was silent, all boring, all reversible:**
- **`partial` is a Buffer, not a string.** A multi-byte character split across two reads
  would decode to replacement characters and corrupt a line that was never malformed.
- **An unknown `since` returns zero events, not all of them.** T4 says `since` is exclusive
  by id but not what an id absent from the file means; replaying the whole log is how a
  client renders the same hour twice. The plan's own M6 probe ("a nonsense id and a Lattice
  `ev_` id → empty result, 200") reads as confirmation of this choice.
- **The tail is primed at construction and pushes no frame for it** — the same priming the
  loop and lanes polls do, for the same reason: events already in the file when the process
  booted are history, and `/api/events` is the catch-up door.
- **`truncated` survives the poll that detects it** and clears on the next poll that reads a
  new line, which is what AC-14's "the next append clears the reason" requires when the
  truncate and the first re-append land inside one poll window.
- **`/api/events` reads the file, the SSE frames come from the tail.** Two readers of one
  file by design: the tail is a push cursor over arrivals, the HTTP door answers "what
  happened before I connected", and serving the latter from the former would make a
  restarted server claim the log was empty.
- **Change-only for `company` is by construction, not by key comparison.** An append-only
  file has no "current" to diff; whatever the tail read since the last poll is new by
  definition. AC-13's mutant (re-emit the last event each poll) is still the right falsifier.
- **`lanesKey`'s lane reduction is conservative:** `key`, `task` and `worktree` are carried
  through whole (they were already inside the wholesale `p.lanes` serialisation AS-99 keyed
  on, so nothing that earned a frame before stops earning one), and only the three liveness
  fields named in T4 are added. `subAgent.elapsedS` is the one field deliberately excluded.

**Merge seam:** `server.js`, `lib/events.js`, and `test/api.test.js` in exactly three places —
the import line at the top, `loopFixture` (~line 1250), and three new tests appended at the
end of the file. AS-72's AS-25 timer-regex region (~line 657) is untouched, and the remaining
work belongs in `test/stream.test.js` and `public/`, so it stays untouched.
