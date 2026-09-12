# AS-121 progress (developer-lena)

## Cycle 0 (done, reviewed by Priya -> implementation-level rework)
- plan committed to master fc73e64; board planned->in_progress 5f654ce
- branch feat/AS-121-compose-run-signals, worktree .worktrees/AS-121; tip 449571c (d8d051a code+tests, 449571c README)
- host suite branch 627/624/0/3; compose asc-impl-as121 Built 627/618/0/9; real T13 pass
- mutants M1 {T12a,T12b}, M2 {T12a}, M3 {T12a,T12b} exact

## Cycle 1 (F1: handler armed before the guard; signal in preflight window is swallowed, run then starts) — DONE, tip a4ee15c
Fix: `armedExec(onSignal)` wraps `exec` and arms SIGINT/SIGTERM only on the first argv containing `run`
(the compose run recipe); main keeps the post-run `setImmediate` yield + `off`. README paragraph names the
armed window (run -> down -> leak check) and states the default disposition before it and under --check.
Stderr line unchanged (now true). Stub docker gained an opt-in `AS121_SLOW_PREFLIGHT` sleep on `network ls`;
`spawnWithStub` gained `until(re)`.

- [x] T12c written, observed RED on pre-fix bin 449571c -> cycle1/t12c-prefix-red.log (log: network ls | compose ls | run | down | ...; exit 143; false "interrupted" line)
- [x] commit 6e3b4ca (test), a4ee15c (bin + README)
- [x] T12a/T12b/T12c green post-fix -> cycle1/t12-postfix.log
- [x] host suite branch 628/625/0/3 -> cycle1/host-branch.log
- [x] compose asc-impl-as121: `Image asc-impl-as121-test Built` 628/619/0/9, leak check clean -> cycle1/compose-impl-as121.receipt / .log
- [x] mutants (cycle1/battery.mjs mutants): M1 {T12a,T12b} EXACT; M2 {T12a} EXACT; M3 {T12a,T12b} EXACT; M4 (handler back before guard) {T12c} EXACT; restore git diff --exit-code 0; post-restore 20/18/0/2
- [x] real T11 + T13 under AS106_REAL=1: 2/2 pass, leftover scan clean -> cycle1/real-T11-T13.log
- [x] Priya's probe.mjs re-run: P1 now signal=SIGTERM, log = network ls only -> cycle1/priya-probe-postfix.txt
- [x] docker leftovers (nets/imgs/containers matching as121|probe): none
- [ ] lattice comment from main checkout (no status change — orchestrator moves to review)
- R1 (T13 teardown racing the orphaned compose client under M1 real) left on the record, untouched.
