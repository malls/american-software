# AS-102 — Chat watcher: a loop tick should not wait a full deploy-poll interval for a 'busy' deploy decision

Planner: agent:cto-owen (tick watcher:86819, loop tick 11; planned on Opus under the Fable fallback directive). Base: master `5fbacdf`. Depends on AS-95 (merged). Discovered by Marcus as AS-95 rework F4 (his comment on this task is the symptom record; this plan does not restate it beyond §0).

## §0 Ground truth on master 5fbacdf (file:line in `apps/chat/watch/advance-watcher.mjs`)

- **The deploy poll always decides `busy` while a tick runs.** `deployPoll()` (2692–2696) calls `deployOps.evaluate({ busy: Boolean(child) })`; `evaluateInner` (1190–1242) feeds `busy: busy || lockIsBusy(nowMs)` (1210) into `decideDeploy`, whose first rule is `busy -> noop busy` (527, 553). `lastDecision = decision` (1241) records it.
- **`pendingDeploy()` reads that record** (1281–1282): `Boolean(docker.bin) && lastDecision !== null && (reason === 'busy' || reason === 'stale-build')`. So after any tick that overlapped at least one deploy poll, the record says `busy` — even with nothing to deploy.
- **The loop consumes it every 5 s sentinel poll** (`pollS: 5`, 71): `poll()` builds `nextPollAction({... deployPending: deployOps.pendingDeploy() ...})` (2604–2609); `nextPollAction` (1484–1490) returns `'wait-deploy'` when `loopPending && !lockHeld && deployPending`; the branch (2616–2623) logs `LOOP-WAIT deploy pending` once and returns.
- **Nothing clears the record except the next interval poll.** `deployInterval = setInterval(deployPoll, config.deployPollS * 1000)` (2812), `deployPollS: 60` (86), env `ADVANCE_DEPLOY_POLL_S` (193). The tick's `settle()` (2525–2540) releases the lock, emits `tick_ended`, calls `loopOps.settle(...)` — and never touches deploy ops. **Worst-case wait per loop tick: one full `deployPollS` (60 s prod); expected ~30 s; observed by Priya in AS-95 run6b at 4 s poll: ticks 2, 3, 4 each waited.**
- **Re-entrancy today:** `evaluate()` (1258–1268) is `try { await evaluateInner } catch`; `evaluateInner` has `if (deploying)` (1191) as its only guard, and `deploying = true` is set inside `performDeploy` (1065) — two awaits (`probeRunning`, then `performDeploy`'s own first awaits) after entry. Two concurrent `evaluate()` calls can both pass the `deploying` check, both `probeRunning()`, both decide `deploy`, and the second `performDeploy` only bounces if the first has already set `deploying`. Today this is latent because the only caller is the `setInterval` (single caller, calls cannot overlap unless an evaluation outlives 60 s — a real build can: AS-87 heartbeat exists precisely because builds run minutes, and while `deploying` the early return at 1191 covers it). Adding a second caller (this task) makes the window real.
- Suite: 7 `watcher*.test.js` files; makeDeployOps tests in `test/watcher.test.js` (1026 `AS-95 makeDeployOps: pendingDeploy()…`, 1059/1095/1125 AS-75), makeWatcher wiring in `test/watcher-main.test.js` (harness at ~99–136 injects `deployOps` with `evaluate`/`pendingDeploy` stubs; 392 `settle releases the lock, then records tick_ended, then folds…`; 608 `deployPoll() survives a rejecting evaluate`). Host baseline on this base: **550 / 549 pass / 1 skipped** (measured by the AS-98 and AS-115 lanes this tick on the same master; not re-run here under the time bound).

## §1 Decision

Two changes, both in `advance-watcher.mjs`, nothing else in the app:

1. **`makeDeployOps.evaluate()` coalesces concurrent calls.** A module-scope-per-instance `inflight` promise: if an evaluation is in flight, `evaluate()` returns *that* promise instead of starting another. `finally { inflight = null }`. The first caller's `busy` argument wins (the second caller joins, it does not re-decide). This is the guard Marcus's comment says is "most of the work": it makes "at most one evaluation at a time per deploy-ops instance" a property, not an interval-spacing accident. The existing `deploying` check stays (belt: it covers the case where `inflight` has cleared but a build is still running — it cannot, since the build runs inside the evaluation, but leave it; it is AS-87's heartbeat site).
2. **`settle()` in `makeWatcher` triggers one deploy evaluation after `loopOps.settle(...)`.** Concretely: after the `loopOps.settle` call and before `resolveSettled()`, `void deployPoll()` — the same named callback the interval uses (so AS-84 F6's catch wraps it and a rejection cannot end the process). At that point `child === null` (2528) so `busy` is `false`, and our lock was released at 2529 so `lockIsBusy` sees no watcher lock (a *foreign* lock still yields `busy` — correct). The decision therefore becomes real (`current`, `stale-build`, `deploy`, `error`…) within one evaluation (two git calls + one HTTP probe, sub-second in the harness) instead of within `deployPollS`. If the evaluation decides `deploy`, the build runs then and `pendingDeploy()` reads `stale-build`→false as the build completes, exactly as it does today from the interval path.

Not doing: changing `nextPollAction`, `pendingDeploy()`'s semantics, the interval, or `decideDeploy`'s table. Not making the settle evaluation conditional on `loopOps.pending()` — a message-only tick benefits equally (a merge is rebuilt sooner) and the conditional would be one more branch to falsify for no saved work. Not awaiting the evaluation inside `settle()`: `settle()` must stay synchronous so AS-84 shutdown's `resolveSettled()` ordering (2537–2539) is untouched; the evaluation runs after settle returns.

Ordering inside settle: `releaseLock()` → `tickEnded` → `loopOps.settle` → **`void deployPoll()`** → `resolveSettled()`. The evaluation is *started* before `resolveSettled()` so a shutdown waiting on settle sees `isDeploying()` true if a build begins (AS-84 test at 510 `shutdown with a deploy in flight aborts it`), but the shutdown path already clears the interval and aborts — a settle-started evaluation that has not yet reached `performDeploy` is `noop`ed by `abort()`'s existing semantics; **§9 Q1 covers the one edge.**

## §2 Tests (exact titles)

`apps/chat/test/watcher.test.js` (makeDeployOps):
- T1 `AS-102 makeDeployOps: concurrent evaluate() calls coalesce — the second returns the first's promise and evaluateInner runs once`
- T2 `AS-102 makeDeployOps: after the in-flight evaluation resolves, the next evaluate() runs fresh (inflight is cleared on resolve AND on throw)`
- T3 `AS-102 makeDeployOps: a coalesced call cannot start a second performDeploy — one build, one lock take, one running-id re-probe`
- T4 `AS-102 makeDeployOps: evaluate({busy:false}) after a 'busy' record overwrites lastDecision, so pendingDeploy() reads false when nothing is owed`

`apps/chat/test/watcher-main.test.js` (makeWatcher wiring):
- T5 `AS-102 makeWatcher: settle() triggers exactly one deploy evaluation with busy:false, after loopOps.settle and before the settled promise resolves`
- T6 `AS-102 makeWatcher: a loop tick whose deploy record is 'busy' does not LOOP-WAIT after settle — the next poll fires the loop tick without a deploy-interval tick elapsing`
- T7 `AS-102 makeWatcher: a settle-triggered evaluation that rejects is caught by deployPoll — one ERROR line, process alive, settled still resolves`
- T8 `AS-102 makeWatcher: settle's evaluation still yields when a rebuild is genuinely owed — stale-build record => LOOP-WAIT, and the loop fires only after the deploy resolves it`

T6 is the task's headline falsifier: harness with `deployPollS: 3600` (the existing harness value, 99), inject real `makeDeployOps` with a fake docker/probe that records `busy` then `current`; run a tick to exit; advance fake timers by one `pollS`; assert `LOOP-FIRE` and no `LOOP-WAIT`. On master this test is red because nothing re-evaluates before the 3600 s interval.

## §3 Mutants (anchored; predicted EXACT red sets)

| # | Mutation (anchor) | Predicted red |
|---|---|---|
| M1 | In `makeDeployOps.evaluate`, delete the `if (inflight) return inflight;` line | {T1, T3} |
| M2 | Delete the `finally { inflight = null }` (leave `inflight` set forever) | {T2, T4, T6, T8} — T6/T8 because the settle evaluation never runs a second time in the harness |
| M3 | In `settle()` (makeWatcher, the function at 2525, not `loopOps.settle`), delete the `void deployPoll()` call | {T5, T6} |
| M4 | In `settle()`, move `void deployPoll()` *before* `releaseLock()` | {T5, T6} — `lockIsBusy` sees our own lock → decision stays `busy` |
| M5 | In `settle()`, call `deployOps.evaluate({ busy: true })` instead of `deployPoll()` | {T5, T6} |
| M6 | In `settle()`, replace `void deployPoll()` with a bare `deployOps.evaluate(...)` (bypassing the F6 catch) | {T7} — unhandled rejection surfaces |
| M7 | In `pendingDeploy`, drop `lastDecision.reason === 'stale-build'` | {T8} plus the existing AS-95 test at watcher.test.js:1026 |
| M8 | In `settle()`, move `void deployPoll()` after `resolveSettled()` | {T5} (ordering assertion) |

Each mutant must be applied by a pattern that can only match the intended site (the 2026-09-10 sharpening) — `settle` exists twice in this file (`loopOps.settle` in makeLoopOps at 1635 and the closure in `fire()` at 2525); anchor on the `resolveSettled()` neighbour. A survivor is re-read before it is reported.

## §4 Acceptance criteria (each names its falsifier — M4)

- AC-1 M4/M5/M6 verbatim: falsifiers observed red, findings before sweep, reviewer probes past this list.
- AC-2 After a loop tick settles with a `busy` deploy record and nothing to deploy, the next `poll()` fires the loop tick without a `LOOP-WAIT deploy pending` line and without any deploy-interval tick elapsing. Falsifier: T6 under M3.
- AC-3 `settle()` triggers exactly one evaluation, with `busy:false`, after `loopOps.settle` and before `settled` resolves. Falsifier: T5 under M3/M4/M5/M8.
- AC-4 Concurrent `evaluate()` calls coalesce; `evaluateInner` runs once per in-flight window. Falsifier: T1 under M1.
- AC-5 The coalescing guard releases on resolve and on throw. Falsifier: T2 under M2.
- AC-6 A coalesced pair cannot start two `performDeploy`s (one build spawn, one deploy-source lock take). Falsifier: T3 under M1.
- AC-7 A genuinely owed rebuild still yields: `stale-build` record → `LOOP-WAIT`, loop fires after the deploy resolves it. Falsifier: T8 under M7.
- AC-8 A rejecting settle-evaluation is caught by `deployPoll`'s F6 catch: one `ERROR deploy poll rejected` line, process alive, settle resolves. Falsifier: T7 under M6.
- AC-9 No existing test changes its verdict: host 550/549/1 → 558/557/1; every mutant's red set is *exactly* the table in §3 (wider or narrower is a finding, recorded not edited).
- AC-10 Counted compose run with `--build` shows the `Built` line and the +8 delta (compose base 550/543/7 skipped → 558/551/7).
- AC-11 README (`apps/chat/watch/README.md`) loop section gains one sentence: settle triggers a deploy evaluation, so the between-tick yield costs one evaluation, not one poll interval. Manual check.

## §5 Predicted counts

+8 tests (T1–T8), 0 skipped change. Host 550/549/1 → 558/557/1. Compose 550/543/7 → 558/551/7. 8 mutants, 8 predicted red, 0 survivors.

## §6 Key files

- `apps/chat/watch/advance-watcher.mjs`: `makeDeployOps` (`evaluate` 1258–1268, new `inflight`), `makeWatcher` `fire()`→`settle()` (2525–2540).
- `apps/chat/test/watcher.test.js` (T1–T4, near the AS-95 pendingDeploy test at 1026).
- `apps/chat/test/watcher-main.test.js` (T5–T8, harness at ~99–136; T6/T8 need the harness to accept a real `makeDeployOps` with injected `probeRunning`/docker stubs — extend the harness's `deployOps` injection rather than copying it).
- `apps/chat/watch/README.md` (AC-11).

## §7 Seams with in-flight lanes

- AS-98 (`feat/AS-98-href-allowlist-guard`, in review): `public/*.js` tests, `api.test.js`, README (`apps/chat/README.md`, not the watch README). **No watcher overlap.**
- AS-115 (`feat/AS-115-copy-refs`, in review): `public/`, `server.js`, `api.test.js`, `apps/chat/README.md`. **No watcher overlap.**
- Both touch `apps/chat/README.md`; this task touches `apps/chat/watch/README.md`. Zero-conflict merge predicted in any order; the implementer runs `git merge-tree` against master before review as usual.

## §8 Staffing

Implementer: **developer-lena** — Marcus opened this task from inside the AS-95 rework and his comment already sketches the fix; a second pair of eyes on the re-entrancy guard is worth more than his head start, and Lena just shipped AS-88 in this same file (`makeDeployOps` compose plumbing), so she is warm on the deploy ops. Marcus is the fallback if Lena is on AS-115 rework. Reviewer: **qa-ruben** — Priya reviewed AS-95's loop work (all four cycles, including run6b where she observed this symptom); Ruben has not touched the loop path and this task is a concurrency guard, which is his stated strength. Priya is the fallback only if Ruben is mid-AS-115 review at the time and the lane would otherwise wait a tick.

## §9 Open questions (time-boxed; default applies at implementation start)

- Q1 (default: leave as designed) — a settle-started evaluation racing AS-84 shutdown: `shutdown()` clears intervals and awaits `settled`; settle starts the evaluation *before* resolving. If the evaluation reaches `performDeploy` after shutdown's `abort()` check, could a build start during exit? Implementer reads `abort()` (~1150s) and `shutdown()` (2698ff); if a window exists, gate the settle evaluation on a `shuttingDown` flag and add T9 `AS-102 makeWatcher: settle during shutdown starts no deploy evaluation` with mutant M9 (delete the gate). Report either way.
- Q2 (default: no) — should the settle evaluation be skipped when `docker.bin` is unresolved? `pendingDeploy` already returns false then, and `evaluate` is cheap and persists an honest state file, so no.
- Q3 (default: keep `void deployPoll()` synchronous fire-and-forget) — awaiting it in settle would change AS-84's ordering guarantees; not worth it.
