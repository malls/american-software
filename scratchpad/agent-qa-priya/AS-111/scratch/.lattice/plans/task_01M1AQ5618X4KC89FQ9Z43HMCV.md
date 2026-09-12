# AS-27: Chat: surface advance-loop status in the UI — active loop / single tick in flight / idle

Source: board DM msg 226 (2026-08-30 21:31, human:forrest -> cto-owen): 'also we should surface loop status on the chat UI here. whether it's active, one tick, or off.'
Pulled into planning 2026-09-03 on board DM msg 519 ("lets get the chat stuff shipped"). Planner: cto-owen (tech lead). Complexity: medium.

## 1. Problem

The board's question, every time he opens the app, is "is the company running right now, or waiting on me?" Today the only way to answer it is to read `apps/chat/data/advance.lock` and the watcher log on the host. The UI should answer it at a glance, truthfully, from the same evidence the watcher itself uses — never from a second predicate.

## 2. Terms (agree before arguing)

- **Tick** — one `/advance` invocation. While it runs, the single-flight lock `apps/chat/data/advance.lock` exists and is *fresh*.
- **Fresh lock** — the watcher's rule, `isLockStale()` in `watch/advance-watcher.mjs`: stale iff owner pid dead OR `startedAt` older than `lockStaleMin` (45 min, `DEFAULTS`). The lock holder heartbeats (rewrites `startedAt`) at least every 30 min per `advance.md` step 0; that rule is what makes age meaningful.
- **Lock source** — the lock body's `source` field: `"watcher"` (message-fired headless tick), `"loop"` (a `/loop /advance` session's tick), `"manual"` (a one-off `/advance`). Written by the lock taker; never inferred.
- **Watcher listening** — the host watcher process is alive and polling. Evidence: `apps/chat/data/advance-watcher.pid` exists and its (new) `heartbeatAt` is recent. It is unlinked on clean shutdown (`shutdown()`), so a stale heartbeat means a crash or a hung host.
- **The four states** (board asked for three; "off" splits in two because the difference decides whether his next message does anything):
  1. `loop` — fresh lock, `source === "loop"`. "Loop active."
  2. `tick` — fresh lock, any other source. "Tick in flight (watcher|manual)."
  3. `idle` — no fresh lock, watcher listening. "Idle — a board message will fire a tick."
  4. `off` — no fresh lock, watcher not listening. "Off — nothing will fire."

## 3. Constraints that shape the design (each is a fact, checked 2026-09-03)

- **C1. The container cannot see host pids.** The server runs in `asc-chat-server-1`; the lock and watcher pids are host pids in another pid namespace, so `process.kill(pid, 0)` is meaningless there. In-container staleness is therefore **age-only**. We do not invent a second predicate: the server calls the watcher's own `isLockStale(lock, now, staleMs)` with `pidAlive: true` and a comment saying why. One rule, one constant (`DEFAULTS.lockStaleMin`), imported from `watch/advance-watcher.mjs` — which the Dockerfile already `COPY`s into the image and which is import-safe (its `main()` is argv-guarded; `test/watcher.test.js` imports it today).
- **C2. The data dir is already in the container.** `compose.yaml` mounts `./data:/app/data` rw. Both files are there. **No compose change**; `deploy-shape.test.js` is not touched unless it lacks a pin for that mount (verify; add the assertion only if missing).
- **C3. fs.watch is not trusted across the bind mount** (the watcher polls for the same reason — FSEvents on container-written files is unreliable, and the reverse direction is no better). The server **polls** the two files on a timer. 2 s is plenty: the indicator answers a human question.
- **C4. Nothing private, nothing secret.** The status is identical for every viewer — no `me`, no store, no visibility filter. The lock's `nonce` is the AS-16 anti-spoof token and **never leaves the server**; the API exposes `source`, `pid`, `startedAt`, `ageS` only.
- **C5. A loop holds no lock between its ticks** (`advance.md` step 6 releases it). So `loop` is visible only while a loop tick is executing; between loop ticks the UI truthfully shows `idle`. Mitigation, not a fix: the server remembers the last lock it observed and when it disappeared (`lastTick: {source, startedAt, endedAt}`, in-memory, best-effort, reset on restart) and the UI shows "last tick: loop, ended 40 s ago". Documented as a limit.
- **C6. Zero dependencies, zero `innerHTML`, no DOM harness** — house rules for `apps/chat`. Label logic goes in a pure module so it is unit-testable; `app.js` only does DOM.
- **C7. Malformed files never take the server down** (same contract as `/api/roster` and `/api/org`). Unparsable lock/pid JSON → treated as absent, with a `reason` string in the payload.

## 4. Approach

### 4.1 `lib/loop-status.js` (new, pure — no fs, no clocks)

```js
export const WATCHER_STALE_MS = 60_000; // 12 polls at the watcher's 5 s cadence; one place only
export function deriveLoopStatus({ lock, watcher, nowMs, lockStaleMs, watcherStaleMs = WATCHER_STALE_MS })
// lock:    parsed advance.lock | null | { error: 'unparsable' }
// watcher: parsed advance-watcher.pid | null | { error }
// -> { state: 'loop'|'tick'|'idle'|'off',
//      tick: null | { source, pid, startedAt, ageS },
//      staleLock: null | { source, startedAt, ageS, reason: 'age' },
//      watcher: { listening: boolean, heartbeatAt: string|null, ageS: number|null, reason?: string },
//      checkedAt: ISO }
```

Rules, in order: (a) a present, parsable lock with `Date.parse(startedAt)` finite and `!isLockStale({...lock, pidAlive: true}, nowMs, lockStaleMs).stale` is *the tick*; state is `loop` iff `source === 'loop'`, else `tick`. (b) Otherwise, a present lock is reported under `staleLock` (never as a tick). (c) `watcher.listening` iff pid file parsable and `nowMs - Date.parse(heartbeatAt) <= watcherStaleMs`. A pid file **without** `heartbeatAt` (pre-AS-27 watcher still running) is `listening: false, reason: 'no-heartbeat'` — honest, and self-corrects when the watcher restarts on the new code. (d) No tick → `idle` if listening else `off`. `nonce` is never copied to the output (assert this).

`isLockStale` is imported from `../watch/advance-watcher.mjs`, not reimplemented (C1).

### 4.2 Server (`server.js`)

- `createChatServer({ dbPath, repoRoot, dataDir })` — new optional `dataDir`, default `join(APP_DIR, 'data')`; tests pass a scratch dir. Paths: `advance.lock`, `advance-watcher.pid`.
- `readLoopStatus()` — reads both files (readFileSync + JSON.parse, each guarded per C7), calls `deriveLoopStatus` with `lockStaleMs = DEFAULTS.lockStaleMin * 60 * 1000`. Maintains `lastTick` (C5): when a fresh tick was present on the previous read and is absent now, record `endedAt = now`.
- `GET /api/loop-status` → `{ status }` (the derived object plus `lastTick`). No `me`.
- `LOOP_POLL_MS = 2_000` timer (`unref`'d, cleared in `close()` beside the SSE heartbeat timer): recompute; if `JSON.stringify` of the *state-bearing* fields (`state`, `tick`, `staleLock`, `watcher.listening`) changed since the last emission, fan out `event: loop\ndata: <json>\n\n` to every stream connection — no `visibleTo` (C4). `ageS` changing alone must **not** emit (cardinality: over 10 polls with an unchanged fresh lock, exactly 0 frames).
- On a new SSE connection, send one `loop` frame immediately after the connection is registered so a reconnecting client is current without a fetch.

### 4.3 Client

- `public/loop-status.js` (new, pure, importable from node:test like `live.js`): `describeLoopStatus(status, nowMs) -> { tone: 'loop'|'tick'|'idle'|'off', label, detail }`. Labels: "Loop active", "Tick in flight · watcher" / "· manual", "Idle · watcher listening", "Off · no watcher". `detail` (goes in `title`): started/age, `lastTick` sentence, stale-lock note ("stale lock from <source>, <age> — will be stolen"), watcher heartbeat age or reason.
- `index.html`: under `#brand`, `<div id="loop-status" role="status" aria-live="polite"><span class="loop-dot"></span><span id="loop-label"></span></div>`.
- `app.js`: `state.loopStatus`; fetch `/api/loop-status` inside `refreshSidebar()` (so the 60 s reconcile poll and foreground catch-up both refresh it — degradation: on fetch failure render `tone: 'off'`, label "Status unavailable", never throw); `eventSource.addEventListener('loop', ...)` applies frames; `renderLoopStatus()` sets the dot class (`loop-dot loop-dot--<tone>`) and text via `textContent`. Age text refreshes on a 15 s local timer so "3 min ago" stays honest without server traffic.
- `style.css`: four dot colours on the sidebar palette (loop = green, tick = amber, idle = blue-grey, off = grey), 8 px dot, label 12 px. Keep to existing colour vocabulary; no new tokens.
- `server.js` `STATIC_FILES`: add `/loop-status.js`. The served-file guard in `api.test.js` — **extend the existing complete-set assertion; do not add a fourth whole-file guard** (AS-74 item 4 is pending; do not make its count worse).

### 4.4 Watcher heartbeat (`watch/advance-watcher.mjs`, host-side)

- Lift `writeWatcherPid({ path, pid, startedAt, now })` as an exported helper: writes `{ pid, startedAt, heartbeatAt: now }` atomically (`.tmp` + `renameSync`, the highwater pattern). `main()` calls it at start and at the top of every `poll()` (including the `if (child) return` early path — the watcher is alive while its tick runs). `shutdown()` still unlinks.
- The single-instance check still reads `pid` from the same file — unchanged.
- No new config: the client-side freshness window is `WATCHER_STALE_MS` in `lib/loop-status.js`; the watcher's `DEFAULTS.pollS` is documented as the thing it is derived from (12×).

### 4.5 Docs

- `apps/chat/README.md`: new section "Loop status indicator (AS-27)": the four states, the two files, the age-only rule and why (C1), the between-ticks limit (C5), `/api/loop-status` shape, "nonce never served".
- `apps/chat/watch/README.md`: `advance-watcher.pid` now carries `heartbeatAt`; the running watcher must be restarted (`launchctl bootout` / `bootstrap`, per its README) for the indicator to leave "Off · no watcher" — this is a **host action for the board or a live session**, not something a tick can do; say so in the review handoff.

### 4.6 Out of scope (deliberately)

- CLI `chat loop-status`: a host-side direct-mode CLI *could* check pid liveness, which would be a second predicate (the AS-73 lesson). If wanted later it calls `/api/loop-status` in api mode only. Not now.
- Making the loop announce itself between ticks (would need `advance.md`/`/loop` changes — metawork layer).
- Deploying this to the running container: headless ticks cannot run `docker` (PATH; see the deploy-gap task filed this tick). Merge → rebuild is a separate act until that task lands.

## 5. Key files

| File | Change |
|---|---|
| `apps/chat/lib/loop-status.js` | new — `deriveLoopStatus`, `WATCHER_STALE_MS` |
| `apps/chat/public/loop-status.js` | new — `describeLoopStatus` (pure, browser + node) |
| `apps/chat/server.js` | `dataDir` option, `readLoopStatus`, `/api/loop-status`, poll timer + `loop` SSE frames, initial frame on connect, `STATIC_FILES` entry, `close()` clears the timer |
| `apps/chat/public/index.html` | `#loop-status` skeleton under `#brand` |
| `apps/chat/public/app.js` | fetch in `refreshSidebar`, SSE listener, `renderLoopStatus`, 15 s age refresh |
| `apps/chat/public/style.css` | dot + label styles |
| `apps/chat/watch/advance-watcher.mjs` | `writeWatcherPid` helper, heartbeat per poll |
| `apps/chat/test/loop-status.test.js` | new — AC-1..3, AC-8 |
| `apps/chat/test/stream.test.js` / `api.test.js` | AC-4..7 |
| `apps/chat/test/watcher.test.js` | AC-9 |
| `apps/chat/README.md`, `apps/chat/watch/README.md` | §4.5 |

## 6. Acceptance criteria (each one is falsifiable; the review must see the named ones red once)

- **AC-1** `deriveLoopStatus` returns `loop`/`tick`/`idle`/`off` for four fixture sets; a lock whose age is exactly `lockStaleMs` is fresh and one ms older is stale — asserted by construction against `isLockStale`, not by a second comparison. *Mutation: swap the `source === 'loop'` branch → the `loop` and `tick` cases fail, nothing else.*
- **AC-2** Unparsable lock JSON, missing `startedAt`, non-ISO `startedAt`, unparsable pid file: no throw; `staleLock`/`watcher.reason` carry a reason string.
- **AC-3** With a lock containing `nonce`, `JSON.stringify(deriveLoopStatus(...))` does not contain the nonce value.
- **AC-4** Server with a scratch `dataDir`: plant each of the four file configurations → `GET /api/loop-status` reports the matching state; `checkedAt` present; no `me` required.
- **AC-5** SSE: with one stream open, creating a fresh lock file yields exactly one `event: loop` frame within `2 × LOOP_POLL_MS`; over the following 10 polls with the file unchanged, **zero** further frames (count them); deleting the file yields exactly one more, whose payload carries `lastTick.endedAt`. *Mutation: remove the changed-check → the zero-frame count fails.*
- **AC-6** A new `/api/stream` connection receives a `loop` frame before any message frame, without any file change.
- **AC-7** `close()` clears the loop poll timer: the existing close/reap test still passes and the process exits (no hanging handle). `/loop-status.js` is served with the JS content type and the served `app.js` imports it — asserted by extending the existing bounded complete-set guard.
- **AC-8** `describeLoopStatus` produces the four labels; a stale lock produces a `detail` containing the source and "stale"; a watcher with `reason: 'no-heartbeat'` yields the `off` tone with a detail naming the restart.
- **AC-9** `writeWatcherPid` writes `{pid, startedAt, heartbeatAt}` via tmp+rename (no partial file observable: assert no `.tmp` remains and the content parses); two calls with advancing `now` advance `heartbeatAt` and preserve `startedAt`. *Mutation: drop `heartbeatAt` from the body → the case fails.*
- **AC-10** `index.html` served by the server contains `id="loop-status"`, `id="loop-label"`, `role="status"`; zero `innerHTML` in `app.js` (existing guard stays green).
- **AC-11** Full suite green in-container: `DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 docker compose run --rm --build test` (from `apps/chat/`); count reported before pass count (cardinality first). Mutations for AC-1, AC-5, AC-9 shown red per the house technique: scratch copy or backup + `trap` restore, assert the mutation applied scoped to the edited region, record the exact failing set, prove restoration by content hash and `git status --porcelain`, rebuild and re-run.
- **AC-12** Manual: with the server rebuilt and the watcher restarted, the sidebar shows "Idle · watcher listening"; posting a board message flips it to "Tick in flight · watcher" within ~2 s of the watcher's fire, and back to idle when the tick exits. Recorded as observed timestamps in the review comment, not as a claim.

## 7. Risks and open questions (each has a default and a deadline)

- **R1 — pid-file readers.** Anything else that parses `advance-watcher.pid` must tolerate the new key. Known readers: the watcher's single-instance check (reads `.pid` only). Default: proceed. Deadline: implementation start.
- **R2 — the 60 s watcher window.** A host asleep for > 60 s reads as `off` until the next poll; correct, since a sleeping host will not fire. Default: keep 60 s.
- **R3 — the running watcher predates the heartbeat.** Until it is restarted the UI says "Off · no watcher" while the watcher is in fact listening. This is the honest reading of the evidence available; the detail text names the fix. Default: accept; note in the review handoff and the DM to the board.
- **R4 — a `/loop` session between ticks shows `idle`** (C5). Default: accept with `lastTick` text; a metawork change to `advance.md` (loop ticks leave a `loop-active` marker) is a possible follow-up, not this task.

## 8. Handoff

Implementer works in `.worktrees/AS-27/` on `feat/AS-27-loop-status`; board state (this file, statuses, comments) stays on master. QA reads `git diff master...feat/AS-27-loop-status` cold; the QA prompt must not contain the AC verdicts or measured counts.
