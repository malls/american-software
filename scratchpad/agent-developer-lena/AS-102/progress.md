# AS-102 progress (developer-lena)
- [x] source: 40cbc52 (evaluating guard w/ `if (deploying)` first; void deployPoll() in settle)
- [x] T1-T4: d086f54; T5-T8: ec406a3; README: 5518207
- [x] host 558/557/1 skipped/0 fail (was 550/549/1) — +8 as predicted
- [x] mutants (scratch copy, mutants.json): 9 applied, 9 red, 0 survivors
      M1 {T1,T3} exact; M2 wider (+AS-95/AS-75x3/AS-84x2/AS-87 — any test that evaluates twice);
      M3 wider {T5,T6,T7,T8}; M4 NARROWER {T5} — T6 green because lockIsBusy is read after
      the first await, by which time releaseLock ran (phantom for the lock half; T5's
      lockPresent-at-call pins it); M5 wider {T5,T6,T7,T8}; M6 {T7} exact; M7 NARROWER {T8} —
      AS-95 test at watcher.test.js:1026 never asserts pendingDeploy on a stale-build record;
      M8 {T5} exact (microtask-hop pin); M9 extra (delete deploying pre-check) -> AS-87 red (hang)
- [x] merge-tree clean
- [ ] compose --build -p asc-impl-as102 (running, compose.mjs)
- [ ] lattice comment + status review --no-auto-review; #engineering post
Q1: no window in prod — probeRunning awaits real fetch I/O; resolveSettled->finish->exit(0) is pure microtasks. No gate added.
Deviation: plan said `deploying` check is a belt; it is load-bearing (AS-87 heartbeat) and precedes the guard.
Deviation: guard variable is `evaluating` (`inflight` is AS-87's state-fields record).
Note: after a settle-started deploy completes, lastDecision stays 'stale-build' until the next evaluation (pre-existing; T8 drives deployPoll() for it).
