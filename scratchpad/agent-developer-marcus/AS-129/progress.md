# AS-129 progress (developer-marcus, tick watcher:79108 loop 2 tick 3)

Worktree: .worktrees/AS-129, branch feat/AS-129-loop-cap-rearm, tip a445e9c
Plan: .lattice/plans/task_01M2B3P03HKQSD6QYKB4PTMSR7.md
advance-loop.json sha256 before/after: 54e4cedf...012c == 54e4cedf...012c (UNCHANGED; advance-loop-hash-{before,after}.txt)

## Steps — ALL DONE
- [x] 1. watcher: envMinutes + MAX_TIMER_MS + loopRearmMin config; loopLimits(); LOOP_DEFAULTS derived (f90019b)
- [x] 2. watcher: capReached/workRemains; shouldContinue cap-hit detail.rearm (f90019b)
- [x] 3. watcher: makeLoopOps rearm state; poll() wiring; main limits (f90019b)
- [x] 4. tests T1-T10 (3dfc332, a445e9c), T11-T13 (d58dc2d), T14-T15 (e2d5989)
- [x] 5. README + plist template (9ec3061)
- [x] 6. host suite 643/641/0/2; mutants M1-M17 all killed (mutants.log); compose asc-impl-as129 643/635/0/8 "Image asc-impl-as129-test Built" (compose-run.log)
- [x] 7. Lattice comment recorded; status in_progress -> review --no-auto-review (board state left for the orchestrator to commit)

## Mutant red sets (full suite per mutant, in place, restored + git diff --exit-code clean each time)
Exact as tabled: M2 M4 M5 M6 M7 M8 M9 M10 M11 M12 M13 M14 M15 M16 M17 (15/17).
Wider than tabled (both implied by the plan's own test specs, not code defects):
- M1 (workRemains always true): {T3, T6, T9b, T12} — plan {T3, T6, T12}. T9b ("same mirror, empty board -> rearmAt null") calls workRemains via resume(), so it must redden.
- M3 (rearmIfDue ignores the clock): {T5, T8, T11} — plan {T5, T11}. T8 spec asserts "rearmIfDue() false at T0", which a clock-blind rearm violates.

## Deviations from the plan text
- T11/T12 injected limits add maxNoProgress: 10 — headOf(dir) is null in the temp repo, so no-progress (checked before the cap) would stop the loop at tick 2. Planner's notes anticipated this; plan text listed only maxTicks/rearmMs.
- T6 uses maxTicks: 1 — a dry board stops `dry` at tick 1 under a two-tick cap, so the cap can never be the reason.
- rearmIfDue() has a defensive `loop !== null` branch (clears a stale rearm, returns false). Boring safety; start() already clears it.
- resume()'s cap branch adds `resumed: true` to the stop detail and mirrors immediately.
- watcher-main harness: `over.loopOps` may be a function of {paths, log, now, dir, config} (same pattern as AS-102's deployOps hook).

## Unguarded wiring (criterion 11)
1. poll(): `loopOps.rearmIfDue();` immediately before nextPollAction()
2. start(): `limits: loopLimits(config),` in the makeLoopOps call
3. loadConfig(): `loopRearmMin: envMinutes(env, 'ADVANCE_LOOP_REARM_MIN', DEFAULTS.loopRearmMin),`
