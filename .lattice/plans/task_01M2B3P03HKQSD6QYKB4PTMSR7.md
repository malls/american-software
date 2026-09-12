# AS-129: loop cap re-arms after a cooldown when work remains; maxLockWaitMs derived from config; minute knobs refuse the timer ceiling

Planner: cto-owen (2026-09-12). Implementer: **developer-marcus** (built makeLoopOps in AS-95; Lena just closed AS-121). Reviewer: **qa-ruben** (filed AS-104 and the AS-113 fold-in — this task is checked against his own two findings). Complexity medium, three stages. Notes: `scratchpad/agent-cto-owen/AS-129/planning-notes.md`.

## Scope

1. `LOOP_DEFAULTS.maxTicks`/`maxMs` become runaway guards: on `cap-hit` with work remaining the loop enters a **cooldown** (default 10 min, `ADVANCE_LOOP_REARM_MIN`) and then a fresh loop (new `startedAt`, `ticks` 0, same `armedBy`) fires. Only `dry`, `no-progress`, `tick-failed-twice`, `lock-unavailable` and `error` end a loop for good. A board message still re-arms as today.
2. `maxLockWaitMs` derived from `tickTimeoutMin + lockStaleMin` (135 min on the host's 60/75), never a literal.
3. Every `*_MIN` env knob refuses (throws) a value whose ms product exceeds 2147483647.
4. **Subsumes AS-104**: `resume()` evaluates the cap before firing. Orchestrator cancels AS-104 at merge, comment naming criteria 9a/9b.

Out of scope: DEFAULTS stay 30/45 (the plist carries 60/75); no sidebar change (`deriveLoop` builds field by field, so `rearmAt` is invisible to it — a "re-arming in N min" label is a UX residual, recorded here, for the next task touching `lib/loop-status.js`); `/advance` untouched.

## Approach (all in `apps/chat/watch/advance-watcher.mjs`, module-scope exports; main() wiring stays enumerable)

- **Predicate.** Two pure helpers, exported: `capReached({ticks, startedAt}, now, limits)` and `workRemains(board)` (= mid-lifecycle task or ready backlog task; NOT a new message). `shouldContinue()` uses both; the `cap-hit` detail gains `rearm: workRemains(board)`.
- **State machine (makeLoopOps).** New private `rearm = null | {at, armedBy}`. `settle()`: on `cap-hit` still calls `stop()` (LOOP-STOP, `lastLoop`, `loop = null` — the only way to clear `loop` stays the only way), then if `verdict.detail.rearm` sets `rearm = {at: now() + limits.rearmMs, armedBy}` and logs `LOOP-COOLDOWN until <iso> armedBy messageId N (cap-hit with work remaining)`. New `rearmIfDue()`: `false` unless `rearm && now() >= rearm.at`; when due: `loop = {startedAt: now(), ticks: 0, noProgress: 0, failures: 0, armedBy}`, `pending = true`, `rearm = null`, log `LOOP-REARM armedBy messageId N after cap-hit cooldown`, `mirror()`, return `true`. `start()` clears `rearm` (a message during the cooldown wins). `mirror()` adds `rearmAt` (ISO or null) and keeps `armedBy` populated while cooling. `resume()`: (i) `active:true` past the cap (`capReached`) → no fire: `workRemains(loadBoard())` → cooldown from now, else `stop('cap-hit')`; (ii) `active:false` with a parseable `rearmAt` → re-enter the cooldown (`LOOP-RESUME reason=cooldown`). `snapshot()` exposes `rearmAt` and `limits`.
- **poll() wiring.** One line before `nextPollAction`: `loopOps.rearmIfDue();` — the debt it creates flows through the existing lock/deploy gates and `takeFire()` (LOOP-FIRE tick 1).
- **Limits.** Exported pure `loopLimits(config, base = LOOP_DEFAULTS)` → `{...base, maxLockWaitMs: (config.tickTimeoutMin + config.lockStaleMin) * 60_000, rearmMs: config.loopRearmMin * 60_000}`. `LOOP_DEFAULTS.maxLockWaitMs` becomes `(DEFAULTS.tickTimeoutMin + DEFAULTS.lockStaleMin) * 60 * 1000` and gains `rearmMs: DEFAULTS.loopRearmMin * 60 * 1000`; comment rewritten. main() passes `limits: loopLimits(config)` to makeLoopOps.
- **Config.** `DEFAULTS.loopRearmMin: 10`; `loadConfig` reads `ADVANCE_LOOP_REARM_MIN`. New `envMinutes(env, name, fallback)` beside `envNum`: junk/non-positive → fallback (unchanged); `v * 60_000 > MAX_TIMER_MS` (exported `= 2147483647`) → `throw new Error(\`${name}=${raw}: ${v} minutes exceeds the Node timer ceiling (${MAX_TIMER_MS} ms; at most 35791)\`)`. Used for TICK_TIMEOUT, LOCK_STALE, DEPLOY_TIMEOUT, DEPLOY_COOLDOWN, LOOP_REARM. Under launchd the throw is a crash loop with the reason in `launchd.err.log` (AS-88 precedent) — README states it.
- **Docs.** README: file-table row for `advance-loop.json` (+`rearmAt`); rule (f) row → stop `cap-hit`, re-arms after the cooldown when work remains; new "After the cap" subsection (what re-arms, what does not, the new log lines, `ADVANCE_LOOP_REARM_MIN`); lock-wait paragraph → "tick timeout + staleness (135 min on the host)"; the AS-104 resume sentence; the minute-knob ceiling and its launchd consequence. Plist template comment: add `ADVANCE_LOOP_REARM_MIN=10`, note the 35791-min ceiling.

## Key files

`apps/chat/watch/advance-watcher.mjs` (DEFAULTS/loadConfig ~L71–201; LOOP_DEFAULTS/shouldContinue ~L1335–1445; makeLoopOps ~L1608–1827; poll ~L2701; main wiring ~L2862), `apps/chat/test/watcher-loop.test.js` (loopHarness L473; rewrite `f1-limit-default` L596), `apps/chat/test/watcher-main.test.js` (watcherHarness L72, inject a real makeLoopOps as L160 does), `apps/chat/test/watcher.test.js` (config test L672), `apps/chat/watch/README.md` (§ AS-95), `apps/chat/watch/com.american-software.advance-watcher.plist.template`. Never edit `apps/chat/data/advance-loop.json`.

## Tests (19 new; T10 rewrites an existing one)

watcher-loop.test.js — T1 cap-hit + mid-lifecycle → `detail.rearm === true`; T2 cap-hit + ready backlog only → true; T3 cap-hit on an empty / needs_human-only board → false. T4 (loopHarness, `maxTicks: 2`, `rearmMs: 10 min`, task in review): settle on tick 2 → LOOP-STOP cap-hit, LOOP-COOLDOWN, mirror `{active:false, rearmAt: iso(now+10min), armedBy: id, lastLoop.reason:'cap-hit'}`. T5: `rearmIfDue()` false at +9 min 59 s; true at +10 min; snapshot `ticks 0`, mirror `startedAt === iso(now)`, `armedBy` same, `pending()` true, `rearmAt` null, LOOP-REARM logged; `takeFire()` logs `LOOP-FIRE tick 1`. T6 (empty board): cap-hit → mirror `rearmAt === null`; `rearmIfDue()` false at +10 min and +8 h. T7: during the cooldown `start({messageId: 9})` arms a loop and clears `rearmAt`; `rearmIfDue()` false afterwards. T8: mirror `{active:false, rearmAt: iso(T0+5min), armedBy: 3, lastLoop: cap-hit}` → `resume()` → LOOP-RESUME reason=cooldown, `rearmIfDue()` false at T0, true at T0+5 min. T9a: mirror `{active:true, ticks: 24}` + work → `resume()` → `pending()` false, LOOP-STOP cap-hit, `rearmAt` set; T9b: same mirror, empty board → LOOP-STOP cap-hit, `rearmAt` null, `pending()` false. T10 (replaces `f1-limit-default`): `loopLimits({tickTimeoutMin: 60, lockStaleMin: 75, loopRearmMin: 10}).maxLockWaitMs === 8_100_000` and `.rearmMs === 600_000`; `loopLimits(DEFAULTS).maxLockWaitMs === 4_500_000`; `LOOP_DEFAULTS.maxLockWaitMs === (DEFAULTS.tickTimeoutMin + DEFAULTS.lockStaleMin) * 60_000`.

watcher-main.test.js — T11 (end to end, real makeLoopOps injected with `maxTicks: 2`, `rearmMs: 10 min`; `seedBoard` variant with status `review`): driveFire → exit 0 → poll → `LOOP-FIRE tick 2` → exit 0 → `loopState().rearmAt` set, `active:false`; `h.tick(5 min)`; poll → spawn count still 2; `h.tick(5 min)`; poll → LOOP-REARM, `LOOP-FIRE tick 1`, spawn count 3, `loopState()` `{active:true, ticks:0, armedBy:5, rearmAt:null}`, highwater unchanged. T12: same drive but the task file is rewritten to `done` before the second exit → `rearmAt === null`; `h.tick(10 min)`; poll → spawn count 2, no LOOP-REARM. T13: `config {tickTimeoutMin: 60, lockStaleMin: 75, loopRearmMin: 7}` → `h.watcher.ops().loop.snapshot().limits` has `maxLockWaitMs 8_100_000`, `rearmMs 420_000`.

watcher.test.js — T14 (one `test()` per var, five): `ADVANCE_TICK_TIMEOUT_MIN`, `ADVANCE_LOCK_STALE_MIN`, `ADVANCE_DEPLOY_TIMEOUT_MIN`, `ADVANCE_DEPLOY_COOLDOWN_MIN`, `ADVANCE_LOOP_REARM_MIN`: `35791` accepted (value returned, not the default); `35792` → `assert.throws` with the var name in the message; `'junk'` still falls back. T15: `DEFAULTS.loopRearmMin === 10`; `ADVANCE_LOOP_REARM_MIN=3` → `cfg.loopRearmMin === 3`.

## Mutants — exact expected red sets (a wider or narrower set is a finding)

| | mutation (scratch copy or trap-restored) | red |
|---|---|---|
| M1 | `workRemains` always true (delete the mid-lifecycle/ready check) — **the (b) falsifier** | T3, T6, T9b, T12 *(T9b added at review — resumes past the cap through `workRemains`; Ruben F3)* |
| M2 | settle() never schedules the cooldown (drop the `detail.rearm` branch) | T4, T5, T7, T11 |
| M3 | `rearmIfDue()` ignores the clock (re-arms at once) | T5, T8, T11 *(T8 added at review — asserts not-due at T0; Ruben F3)* |
| M4 | `rearmIfDue()` always false | T5, T8, T11 |
| M5 | re-armed loop keeps the old counters (`ticks` not reset to 0) | T5, T11 |
| M6 | `start()` does not clear `rearm` | T7 |
| M7 | `resume()` ignores `rearmAt` | T8 |
| M8 | `resume()` skips the cap check (today's code — the AS-104 falsifier) | T9a, T9b |
| M9 | main() passes no `limits` to makeLoopOps | T13 |
| M10 | `loopLimits` returns the literal `60 * 60 * 1000` — **the (c) falsifier** | T10, T13 |
| M11 | poll() drops the `rearmIfDue()` call | T11 |
| M12–M16 | loadConfig uses plain `envNum` for ONE of the five vars (one mutant each) — **the (d) falsifiers** | that var's T14 only |
| M17 | `envMinutes` clamps to 35791 instead of throwing | all five T14 |

## Acceptance criteria (M4: each satisfied only by an observed red)

1. (a) T4+T5+T11 green; M2, M3, M4, M5, M11 each red exactly as tabled.
2. (b) T6+T12 green; M1 red exactly {T3, T6, T9b, T12} *(corrected at review, Ruben F3)*.
3. (c) T10+T13 green; M9 red {T13}; M10 red {T10, T13}; no `60 * 60 * 1000` literal remains in LOOP_DEFAULTS or loopLimits (`grep`).
4. (d) five T14 green; M12–M16 each red on its own var only; M17 red on all five.
5. A message during the cooldown wins: T7 green; M6 red {T7}.
6. Cooldown survives a watcher restart: T8 green; M7 red {T8}.
7. AS-104 closed: T9a+T9b green; M8 red {T9a, T9b}.
8. `git diff --exit-code` clean after every in-place mutant; each mutation asserted applied at the intended site before its run is counted.
9. Host suite 643/641/0/2 (from 624/622/0/2) and compose `--build` 643/635/0/8 (from 624/616/0/8), the `Image … Built` line quoted; cardinality before quantification.
10. README and plist comment updated per Approach → Docs; `watch/README.md` reading section shows LOOP-COOLDOWN / LOOP-REARM lines.
11. Unguarded wiring enumerated in the implementation comment: the `rearmIfDue()` line in poll(), `limits: loopLimits(config)` in start(), the `loopRearmMin` line in loadConfig.
12. `apps/chat/data/advance-loop.json` untouched (`git status` shows nothing under `data/`; it is gitignored — check by hash before/after).
