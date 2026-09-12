# AS-95: a board message starts a loop of ticks that runs until the company is dry

Planner: agent:cto-owen, 2026-09-10, headless tick (30-min box). Complexity: **high**. Estimate: 3 ticks (implement 1–2, review 1) plus one board-assisted watcher restart.
Branch: `feat/AS-95-watcher-loop`, worktree `.worktrees/AS-95`. Lands before AS-84 (board comment at filing: AS-84 is not a hard dep); lock handling stays byte-identical.

## §0. Ground truth (verified 2026-09-10 against master `860dfca`, read-only)

- `apps/chat/watch/advance-watcher.mjs` (1212 lines). `main()` (line 918→) owns: `fire(sentinel)` — nonce, `acquireLock(nonce)`, highwater write (tmp+rename), spawn `claude -p` via `tickArgv`, 30-min `termTimer` (`config.tickTimeoutMin`), `settle()` on `exit`/`error` which clears timers, nulls `child`, `releaseLock()`. `poll()` every `pollS`: heartbeat → `if (child) return` → `if (deployOps.isDeploying()) return` → `decide({sentinel, highwater, lock, now, config, debounceUntil})` → `fire`. Deploy poll is a separate `setInterval` calling `deployOps.evaluate({busy: Boolean(child)})`. Pure exports today: `decide`, `decideDeploy`, `isLockStale`, `tickArgv`, `tickChildEnv`, `fireNonce`, `makeLockOps`, `makeDeployOps`, `writeWatcherPid`.
- Lock body carries `source:'watcher'` (from `makeLockOps` default) or `'deploy'`; `apps/chat/lib/loop-status.js#deriveLoopStatus` maps `tick.source==='loop'` → state `loop`, any other fresh lock → `tick`. `apps/chat/public/loop-status.js#describeLoopStatus` renders `'Loop active'` / `` `Tick in flight · ${source}` ``. Server: `apps/chat/server.js:20` imports `deriveLoopStatus`; `/api/loop-status` reads `advance.lock` + `advance-watcher.pid`.
- `.lattice/tasks/*.json` (97 files): fields `status` (values observed: `backlog|in_planning|in_progress|needs_human|done|cancelled` — underscore form, plus the vocabulary `planned|review|blocked` from the workflow), `priority` (`low|medium|high|critical`), `title`, `short_id`, `relationships_out: [{type, target_task_id, ...}]` with `type` in `blocks|depends_on|subtask_of` (AS-95's own event log shows `depends_on -> task_…` was written as a relationship, then removed). `relationships_in` exists only in `show --json` (enriched), NOT in the task file — so the inverse of `blocks` must be computed by the reader.
- Tests: `apps/chat/test/watcher.test.js` (1029 lines, `node:test`), `loop-status.test.js` (156), `loop-label.test.js` (212). Suite runs in compose (`docker compose run --rm --build test`), master baseline count to be recorded by the implementer before touching anything (AC-8).
- README `apps/chat/watch/README.md` sections: "How it decides", "Files", "AS-75 …", "Permission modes", "Troubleshooting".

## §1. Scope and non-goals

In scope: the loop in the watcher; a pure `shouldContinue()`; a pure `.lattice` reader `readBoard()`; loop marker in the lock + a small `advance-loop.json` state file; `deriveLoopStatus`/`describeLoopStatus` loop branch with tick count and stop reason; README section; tests. Zero new dependencies (node:* only).
Non-goals: `/advance` and `.claude/commands/advance.md` untouched (one invocation = one tick). Lock semantics untouched (AS-84's question stays AS-84's). No change to the deploy ops internals. Not modelled in readiness: `lattice next`'s age tiebreak, the `urgency` field, AS-90's written exemption — the predicate answers "is there *anything* ready", not "which one"; the tick's own `lattice next` picks. This is stated in the README.

## §2. Design

### 2.1 Loop state — in memory, mirrored to a file
`main()` holds `let loop = null | { startedAt, ticks, noProgress, failures, headBefore, armedBy: messageId }`. Mirrored (tmp+rename, same pattern as highwater) to `apps/chat/data/advance-loop.json` after every evaluation: `{ active, startedAt, ticks, armedBy, lastTick: {endedAt, code, signal, timedOut, headMoved}, lastLoop: {stoppedAt, reason, ticks, detail} }`. `lastLoop` survives across loops so the sidebar/board can read why the last one stopped.
Watcher restart (AS-75 self-restart, or launchd relaunch): in-memory loop is lost **by design**. On startup `main()` reads `advance-loop.json`; if `active:true` it logs `LOOP-RESUME reason=watcher-restart` and re-enters the loop at the next poll with `ticks`/`startedAt` carried forward (so the cap still counts from the original message), `noProgress`/`failures` reset to 0, `headBefore` re-read. If the file is absent/unparsable: no loop, normal single-fire path. A restart mid-tick already kills the child (`shutdown`), and the lock's staleness rule handles the rest — unchanged.

### 2.2 The predicate — pure, exported
```js
// advance-watcher.mjs
export const LOOP_DEFAULTS = Object.freeze({ maxTicks: 24, maxMs: 8*60*60*1000, maxNoProgress: 2, maxFailures: 2 });
export function shouldContinue({ board, sentinel, highwater, loop, tick, now, limits = LOOP_DEFAULTS })
//  board:     { tasks: [{ id, status, priority, title, dependsOn: [ids] }] }   — from readBoard()
//  sentinel:  { messageId } | null ; highwater: { messageId } | null
//  loop:      { startedAt (ms), ticks, noProgress, failures }   — counts BEFORE folding `tick` in
//  tick:      { code, signal, timedOut, headBefore, headAfter } — the tick that just settled
//  returns { continue: bool, reason: string, detail: object, loop: <updated loop counters> }
```
Evaluation order (stop rules first, so a cap is logged even if work remains):
1. `failures' = (code!==0 || signal || timedOut) ? failures+1 : 0`; if `failures' >= maxFailures` → stop `tick-failed-twice` (g).
2. `noProgress' = (headBefore===headAfter) ? noProgress+1 : 0`; if `>= maxNoProgress` → stop `no-progress` (e), detail names the condition it saw (which of a/b/c held).
3. `ticks' = ticks+1`; if `ticks' >= maxTicks` or `now - startedAt >= maxMs` → stop `cap-hit` (f), detail `{ticks, elapsedMs}`.
4. (c) `sentinel.messageId > highwaterId` → continue `new-message` — the loop does NOT fire this itself; it returns continue and the normal `poll()`→`decide()`→`fire()` path consumes it (one highwater move, AC-5).
5. (a) any task with status in `{in_planning, planned, in_progress, review}` → continue `mid-lifecycle`, detail lists short_ids.
6. (b) `readyBacklog(board)` non-empty → continue `backlog-ready`, detail `{chatSet: n, other: n}`.
7. else stop `dry` (d).
`readyBacklog`: status `backlog` AND every `dependsOn` target has status in `{done, cancelled}` (missing target = unmet, honest default). `dependsOn` for task T = T's `relationships_out` of type `depends_on` ∪ every other task's `relationships_out` of type `blocks` whose `target_task_id` is T. Chat-set membership = title starts with `Chat:` OR priority `critical` (the CLAUDE.md rule sets the set to critical); it affects only the detail/log, not the boolean — the description's "Chat set first while non-empty" is an ordering rule and the predicate has nothing to order.

### 2.3 The reader — pure over injected fs
`export function readBoard(tasksDir, { readdir, readFile } = fs)` → `{ tasks }`. Skips unparsable files with a count in `detail.unreadable`; never throws (an unreadable board yields `tasks: []` → `dry`, logged as `BOARD-UNREADABLE`). Read-only, like AS-8/AS-27.
`headOf(repoRoot)`: reads `.git/HEAD` → if `ref:` reads `.git/<ref>` (falls back to `packed-refs`). No git shell-out. Read before `fire()` and after `settle()`.

### 2.4 main() wiring (the AS-82 hole, enumerated — AC-10)
Unguarded additions, kept to these and only these: (1) `fire()` stores `headBefore = headOf(repoRoot)` and, when `loop` is non-null, passes `loopTick: loop.ticks+1` to `acquireLock` so the lock body gains `loop: {ticks}` — **`source` stays `'watcher'`**, the lock acquire/release/stale code is not edited; the extra field is one spread in the body-builder call site. (2) `settle()` gains a tail: `const r = shouldContinue({...}); log(...); writeLoopState(...)`; on continue sets `loopPending = true`. (3) `poll()`: after the `child`/`isDeploying` returns, `if (loopPending && !deployOps.pendingDeploy()) { loopPending=false; fireLoopTick(); }` — where `fireLoopTick()` is `fire(readSentinel() ?? {messageId: highwater.messageId, authorId: 'loop'})` — reuses `fire()` unchanged. (4) startup: `loadLoopState`. Also: a human message arriving *while the loop is idle between ticks* goes through the existing `decide` branch first (it runs before the loop branch), so the message is consumed by the normal path and the loop counters continue.
Deploy interplay: `makeDeployOps` gains one accessor `pendingDeploy()` (true when the last `evaluate` decided `stale-build` and docker is resolvable). Between ticks the loop yields to the deploy poll: `poll()` skips `fireLoopTick` while `pendingDeploy() || isDeploying()`; the deploy interval already runs with `busy:false` once `child` is null, so the merge from tick N is live before tick N+1. If docker is unresolvable, `pendingDeploy()` is false and the loop does not wait (logged once, `LOOP-NOTE deploy unavailable`).
`activeLoop` never re-fires the same sentinel: `fire()` still writes the highwater to the sentinel's messageId; a loop tick fired with `authorId:'loop'` uses the current highwater id, so the highwater is rewritten to the same value (no move).

### 2.5 Log lines (launchd.out)
`LOOP-START armedBy messageId N` · `LOOP-EVAL tick K reason=<r> detail=<json> -> continue|stop` (every evaluation) · `LOOP-FIRE tick K` · `LOOP-WAIT deploy pending` · `LOOP-STOP reason=<dry|no-progress|cap-hit|tick-failed-twice> after K ticks (detail)` · `LOOP-RESUME` .

### 2.6 Loop status and sidebar
`server.js` reads `advance-loop.json` and passes `loopState` into `deriveLoopStatus({ lock, watcher, loopState, ... })`. New derived shape: `state` gains `'watcher-loop'` when a fresh lock has `source:'watcher'` AND `loopState.active` (or the lock carries `loop.ticks`); response adds `loop: { active, ticks, startedAt, lastLoop: {reason, stoppedAt, ticks} }` (nonce never copied — field-by-field, as today). `describeLoopStatus`: `case 'watcher-loop': label = \`Loop active · watcher, tick ${status.loop.ticks}\``; idle/off detail appends `Last loop stopped: <reason> after <n> ticks (<age> ago)` when `lastLoop` exists. Existing `'loop'` (session `/loop /advance`) branch untouched.

## §3. Tests (node:test, in `apps/chat/test/`) — one mutant per rule, predicted red set

New file `watcher-loop.test.js` (predicate + reader), additions to `loop-status.test.js` and `loop-label.test.js`. Fixture boards are inline objects; `readBoard` tests use an in-memory `readdir/readFile`.

| # | Test | Mutant (scratch copy) | Predicted red |
|---|------|----------------------|---------------|
| a | mid-lifecycle task → continue `mid-lifecycle` | drop `review` from the status set / delete rule 5 | `a-*` (2 cases: one per status in the set; deleting the rule reds all 4) |
| b | ready backlog → continue `backlog-ready`; needs_human/blocked-only board → `dry` | delete rule 6 | `b-ready`, `b-chatset-detail` |
| c | sentinel > highwater → continue `new-message`, and `fire` invoked exactly once across two polls (spy on fire; AC-5) | invert `>` to `>=` / let loop branch fire when decide already fired | `c-new-message`, `c-single-fire` |
| d | empty board → stop `dry` | return continue when tasks empty | `d-dry` |
| e | headBefore===headAfter twice → stop `no-progress`; once → continue with `noProgress:1` | delete rule 2 (AC-2) | `e-two`, `e-one-continues` red only if counter dropped |
| f | ticks 23 → continue; 24 → stop `cap-hit`; elapsed 8h → stop (AC-3) | `>=` → `>` | `f-24`, `f-8h` (`f-23` stays green — recorded as expected) |
| g | one failure continues with `failures:1`; two → stop `tick-failed-twice`; timedOut counts | delete rule 1 | `g-two`, `g-timeout` |
| AC-4 | backlog task with unmet `depends_on` → not ready; unmet via other task's `blocks` → not ready; met (done/cancelled) → ready | delete dependsOn check | `dep-unmet-out`, `dep-unmet-in` |
| AC-6 | `deriveLoopStatus` → `watcher-loop` with `loop.ticks`; `describeLoopStatus` label `Loop active · watcher, tick 3`; observed over `/api/loop-status` in the compose suite | remove the `watcher-loop` case | `label-watcher-loop`, `derive-watcher-loop`, `api-loop-status-loop` |
| reader | unparsable file skipped + counted; missing dir → `tasks: []` | throw instead of skip | `reader-unparsable` |

Mutation protocol per CLAUDE.md: scratch copy, assert the mutation applied, record the exact red set, `--build` on every counted compose run and quote the `Image … Built` line; cardinality (test count vs master baseline) before quantification.

## §4. AC-7 — isolated end-to-end recipe (never touches `asc-chat`)

1. `export ASC_E2E=$(mktemp -d)`; copy a fixture `.lattice/` into `$ASC_E2E/repo/.lattice` with three tasks: T1 `backlog` no deps, T2 `backlog` depends_on T1, T3 `needs_human`; `git -C $ASC_E2E/repo init && git commit --allow-empty`.
2. Fake tick binary `$ASC_E2E/claude` (shell script, on PATH via `ADVANCE_CLAUDE_BIN` if the config supports it — verify; else PATH-prepend): each invocation advances the fixture one step (T1 → in_progress → done, then T2 …) by rewriting the JSON and making one empty commit; when nothing left it exits 0 without committing.
3. Run the watcher with `ADVANCE_DATA_DIR=$ASC_E2E/data ADVANCE_REPO_ROOT=$ASC_E2E/repo ADVANCE_POLL_S=1 ADVANCE_DEBOUNCE_S=1 ADVANCE_DOCKER_BIN=/nonexistent` (deploy poll disabled by unresolvable docker — logged). Write one sentinel `{messageId: 1, authorId: 'human:forrest'}`. Expect ≥3 `LOOP-FIRE` lines then `LOOP-STOP reason=dry`.
4. Run 2: fake tick that never commits → expect `LOOP-STOP reason=no-progress after 2 ticks`.
5. Sidebar half: `docker compose -p asc-e2e-as95 -f apps/chat/docker-compose.yml run --rm --build test` with the loop-state fixture, or curl-equivalent via `node -e fetch` against a `-p asc-e2e-as95` server on an ephemeral port. Record both logs in the implementation report; delete `$ASC_E2E`.

## §5. README (AC-9)
New section "AS-95: a message starts a loop" in `apps/chat/watch/README.md`: the continue/stop rules verbatim (a)–(g), the cap, `advance-loop.json` fields, how to read `LOOP-STOP reason=` in `launchd.out` and `lastLoop` in `/api/loop-status`, the deploy-wait, the restart-resume behaviour, and the "not modelled" list from §1. Add `advance-loop.json` to the "Files" table. Note: the running watcher must be restarted once for the loop to go live (self-restart handles it if the watcher is on ≥AS-75 code — confirm in the report).

## §6. Commits (branch only, none touching `.lattice/`)
1. `AS-95: shouldContinue, readBoard, headOf — pure exports + tests` 2. `AS-95: wire the loop into main(), lock loop marker, advance-loop.json, deploy wait` 3. `AS-95: loop-status watcher-loop state and sidebar label` 4. `AS-95: README loop section`.

## §7. Implementer / reviewer instructions
Implementer (developer-marcus or -lena): commit 1 first and prove its mutants before wiring; do not edit `makeLockOps` internals; enumerate every unguarded `main()` line you add in the report (AC-10) — the cap is the four items in §2.4. If `config` has no `claudeBin`/data-dir env override needed for §4, add the minimum env knob and say so.
Reviewer (qa-ruben preferred — concurrency): findings first, sweep second (M5). Probe past the list (M6): a message landing in the same poll as a loop continue; watcher restart between `settle()` and the loop fire; a lock left stale by a SIGKILLed tick while the loop believes it is active; `packed-refs` HEAD; a `.lattice` task file mid-write (tmp visible).

## §8. What this plan does NOT do / could not verify
- Did not read `makeLockOps` body (lines 462–557) or `makeDeployOps` evaluate internals — the implementer verifies the lock-body call site allows an extra field without touching acquire/release logic, and that `evaluate` can expose `pendingDeploy()` from its last decision; if not, `decideDeploy` is called once more read-only between ticks.
- Did not verify env override names for data dir / claude bin (`loadConfig`, line 90) — §4 assumes they exist; adjust names to what `loadConfig` reads.
- Did not read the two AS-95 comments beyond their first lines (board: AS-84 not a hard dep; CTO: ordering call).
- `lattice next` ordering, `urgency`, and written exemptions are not modelled (§1).

## §9. Acceptance criteria — the floor (M4; each satisfied by an observed red)
AC-1..AC-10 as in the task description, mapped to §3 rows a–g, AC-4, AC-6, the §4 recipe (AC-7), the `--build` receipt rule (AC-8), §5 (AC-9), §2.4 enumeration (AC-10). AC-2 = row e, AC-3 = row f, AC-5 = row c `c-single-fire`.

## Review Cycle 1 Findings (qa-priya, 2026-09-10) — implementation-level rework

Full comment: `lattice comment`s on AS-95, `--role review`; repro scripts and receipts under
`scratchpad/agent-qa-priya/` (`e2e/lib.sh` + `run1`–`run7`, `mut/`, `compose-*-solo.log`).

**The pure layer is solid and is not what failed.** 13 mutants, 13 red, 0 survivors; the
continue-predicate, the dependency check, and the label derivation all carry falsifiers that
fire. Both blocking findings live in the **unguarded `main()` wiring** — the 142 lines that F7
notes have no unit falsifier at all. Fix the two defects, and prefer fixing the *reason* they
were invisible.

### F1 (blocking) — a loop tick that loses the lock kills the loop silently

`poll()` clears `loopPending` and calls `fire()`; `fire()` aborts on lock failure **without**
calling `settle()`/`settleLoop()`, so nothing ever re-evaluates the continue-predicate.

Observed (run3, against a live foreign lock — i.e. a `/loop` or manual session winning exactly
the race the shared lock exists for): `LOOP-FIRE tick 2` → `SKIP fire aborted` → silence for 12
polls, T1 still `in_progress`, the mirror frozen at `active:true`, and **no `LOOP-STOP` line
ever emitted.** That contradicts the task description's own requirement that every stop reason
be logged "so the board can see WHY the company stopped" — here the company stops for no
logged reason at all. The message path already self-heals from this; the loop path must too.

### F2 (blocking) — `LOOP-RESUME` after an unclean death fires over the orphan's lock: two ticks at once

Observed (run4b: `kill -9` during tick 2, then relaunch): `LOOP-RESUME` → `LOOP-FIRE tick 2` →
`STEAL stale lock (dead-pid)` → **two fake ticks alive concurrently, 3 s after relaunch,
unconditionally.**

The lock code is byte-identical to master as the plan required, so the claim "single-flight is
unchanged" is true of the *code* and false of the *behaviour*: pre-AS-95 that steal required a
human message plus the debounce, and now resume alone triggers it. This is the duplicate-work
collision the lock exists to prevent and that the company has already lived once (2026-08-31).

Minimal in-scope fix: on resume, do not fire while a lock younger than `tickTimeoutMin` exists —
gate on **age, not pid liveness**, which leaves AS-84's separate pid-vs-source question alone.

### F3 — a watcher death during tick 1 loses the loop entirely (non-blocking; fix in this rework)

The mirror is written only at settle, so run4 produced no `LOOP-RESUME` and the company sat idle
until the next message — the exact symptom this task exists to remove. One `writeLoopState()` at
`LOOP-START` closes it. Plan gap, not an implementation slip.

### F7 — why F1 and F2 were invisible, and the structural ask

AC-10 is **partial**: 142 unguarded `main()` lines (vs 219 pure, 15 ops) carrying three inner
policy functions, and the report enumerates by plan item rather than by line, so the gap did not
show up as a gap. Both blocking findings live there. Recommended: extract a `makeLoopOps`
factory so those policies become injectable and each acquires an **M4 falsifier** — otherwise the
next defect in this region is equally invisible and cycle 2 buys nothing.

### Non-blocking, carry forward

- **F4** — every loop tick waits up to one deploy-poll interval (60 s in prod) because
  `pendingDeploy()` is true on `'busy'`, which the deploy poll always reports during a tick
  (run6b: ticks 2–4 each `LOOP-WAIT` with nothing to deploy). Bounded, never a hang, and the
  yield itself works correctly. Backlog unless trivial here.
- **F5** — the sidebar reads "Idle" between loop ticks (`idle` + `loop.active:true`), and the
  tests encode that. AC-6 is met; the description's "Loop active while looping" is not.
- **F6** — README shows `LOOP-FIRE tick 1`, but tick 1 emits a `FIRE messageId` line. Separately,
  `poll()`'s comment says the loop tick reuses the highwater id while the code passes the real
  sentinel — the **code is correct and load-bearing**, the comment is wrong. Not fixed inline
  because the verdict is rework.
- **F8** — not this task: `mode.test.js` AS-24 failed on master *and* branch under concurrent
  build, passed solo. **Third** observation, so it clears the 2-consecutive bar for AS-83.

### Cleared by observation, do not redo

AC-5's cross-poll half (run5: sentinel 2 arriving during tick 2 → exactly one
`FIRE messageId 2`, highwater 1→2 once, still 4 ticks). `readBoard` against the real board: 99
files read, 0 unreadable, 44 backlog matching `lattice list` line for line, 37 ready, 7 unmet.
Counted runs, cardinality first: master solo `Image asc-qa95-master-test Built` 21 files / 293
tests / 293 pass; branch solo `Image asc-qa95-branch-test Built` 22 files / 340 / 340, exit 0.
AC-7 both halves observed (run1 `LOOP-STOP reason=dry after 4 ticks`, run2
`reason=no-progress after 2 ticks`, plus run7 `tick-failed-twice`).

### Process note, recorded deliberately

A Lattice-native auto-review (`auto_fired: true`, generic `claude` agent) ran on this task
concurrently and **timed out at 600 s with no artifact and no findings**, leaving a spurious
`NEEDS HUMAN` note at 21:02Z that no employee posted and that was not acted on. It found nothing
Priya did not; it found nothing at all. It is not the company's review gate — see the
orchestrator's note in `CLAUDE.md`.

## Reset 2026-09-10 by agent:qa-priya
