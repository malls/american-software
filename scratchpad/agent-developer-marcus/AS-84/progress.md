# AS-84 progress — developer-marcus, tick watcher:93997 loop tick 23

Branch `feat/AS-84-shutdown-owns-its-children`, worktree `.worktrees/AS-84`.
Plan: `.lattice/plans/task_01M1SJDVCQ2DFSZR8TB8QZCJKK.md` (§1–§4, §7).

## State: COMPLETE (implementation stage). Owen moves the task to review.

- Commits: c2074fc (source + AC-9..AC-13), fc6a9a9 (AC-1..AC-8), 8b9f0be (AC-14 + README).
- Counted host run, from the worktree:
  `node --test /Users/forrest/Code/american-software-company/.worktrees/AS-84/apps/chat/test/*.test.js`
  → tests 511, pass 511, fail 0, cancelled 0, duration 7471 ms. Baseline 498 (+13).
- Mutation battery: 13 mutants (M1..M13), all killed, tree proven clean after each.
  Driver: `battery.mjs` + `mutants.mjs`; per-mutant suite output in `run-<id>.txt`,
  machine summary in `battery-report.json`.

## Milestones
- [x] read plan + source
- [x] M1 source: shutdownGraceS, releaseLock by source, acquire nonce verify, onSpawn
- [x] M2 source: hydrateAttempt + 'started' record + abort()
- [x] M3 source: evaluate guard + deployPoll
- [x] M4 source: shutdown() rewrite + fire() settled promise
- [x] M6 tests AC-9..AC-13 (watcher-main.test.js) — c2074fc, 502/502
- [x] M5 tests AC-1..AC-8 (watcher.test.js) — fc6a9a9, 510/510
- [x] M7 test AC-14 (watcher-process.test.js) — 8b9f0be, 511/511
- [x] M8 loop-status.js + watch/README.md
- [x] M9 mutation battery
- [x] M10 final host run + lattice comment

## Deviations from the plan (all reported on the task)
1. `'aborted'` is decided by `abortSignal !== null && !result.timedOut`, NOT the
   plan's `result.signal !== null`: a child that traps SIGTERM and exits 143
   reports signal null — which is exactly what AC-14's own fake docker does.
2. `performDeploy(desiredId, stateFields)` — the pre-build persist repeats the
   decision's fields; a bare `persist()` would reset `reason` to its default.
3. `main()`'s signal handlers use `void watcher.shutdown(...)`.
4. Harness changes: `watcherHarness` teardown emits 'exit' on a live fake child
   before awaiting shutdown (else every such test pays the 10 s grace);
   `deployHarness` gained `preState`.

## Red-set deviations observed (reported as findings)
- M9 (AC-9's falsifier): predicted {AC-9, AC-10, AC-11}; observed
  {AC-9, AC-10, AC-12, AC-14}. AC-11 cannot participate (no child, no deploy →
  synchronous path either way); its own falsifier is M1, under which it IS red.
- M6a / M6b (AC-6's two falsifiers): predicted {AC-6}; observed {AC-6, AC-14}.
- M12's kill is a node:test TIMEOUT: `pass 510, fail 0, cancelled 1`.

## Rework cycle 1 (tick loop 25) — started
Budget 15 min. Order: rebase onto master -> F1 (finish() SIGKILLs deploy child) -> F2 (out.on('error')) -> re-verify 519+2 -> comment.
- [ ] rebase
- [ ] F1 + AC-16 test + mutant
- [ ] F2 + AC-17 test + mutant
- [ ] host run + M10 rerun + comment
- [x] rebase (clean, no conflicts; 519/519 before changes)
- [x] F1+F2 source, unit tests AC-16 (watcher-main) AC-17 (watcher.test) committed
- [ ] process test AC-18 (trap TERM ignored), mutants, host run, comment
- [x] AC-18 process test, M10/M14/M15/M16 killed, host 522/522, comment posted. Head 4f11298. DONE (rework cycle 1).
