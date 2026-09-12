QA review — qa-priya, 2026-09-10, live session (docker available). Verdict: IMPLEMENTATION-LEVEL REWORK NEEDED.
Reviewed cold: plan, description (board-authored), `git diff master...feat/AS-95-watcher-loop` (10 files, +1312/-26), README, tests. Not read before my findings were written: the implementer's comments (read afterwards for AC-10 only) and the auto-review (it FAILED — timed out at 600s, no artifact, no findings; nothing to compare).
Repro material: scratchpad/agent-qa-priya/ (e2e/lib.sh + run1..run7 dirs, mut/ mutants, compose-*.log). Isolated stack: temp git repo with a 3-task fixture .lattice, fake `claude` shell binary, own data dir, ADVANCE_POLL_S=1, ADVANCE_DEBOUNCE_S=1, ADVANCE_CHAT_URL=127.0.0.1:1 — never touched apps/chat/data or asc-chat.

== FINDINGS FIRST (8 outside the criteria list; 2 blocking) ==

F1 BLOCKING — a loop tick that loses the lock kills the loop silently. poll() clears loopPending and calls fire(); fire() aborts on acquireLock failure without settle()/settleLoop(), so nothing ever re-evaluates. OBSERVED (run3: tick 1 hands the lock to a live foreign pid, i.e. a /loop or manual session winning the race the shared lock exists for): `LOOP-FIRE tick 2` -> `SKIP fire aborted: lock acquisition failed` -> silence for 12 polls; T1 still in_progress; advance-loop.json frozen at active:true ticks:1 lastLoop:null; no LOOP-STOP. Violates the description's "Every stop reason is logged in launchd.out and surfaced in loop-status ... so the board can see WHY the company stopped" — the company stops with work remaining and the sidebar says a loop is active. The message path self-heals (highwater not yet written -> decide() refires); the loop path must too: keep loopPending on an aborted fire (retry next poll, one SKIP line per episode) or fold the abort into settleLoop as a stop with a reason. Needs its own M4 falsifier.

F2 BLOCKING — LOOP-RESUME after an unclean watcher death fires over the orphan's lock: two ticks at once. loadLoopState sets loopPending; the startup poll fires; the lock carries the DEAD watcher's pid -> isLockStale dead-pid -> STEAL -> second claude while the first (orphaned, not killed on SIGKILL/crash — shutdown() only runs on SIGTERM/SIGINT) still runs. OBSERVED (run4b: kill -9 during tick 2, relaunch): `LOOP-RESUME` -> `LOOP-FIRE tick 2` -> `STEAL stale lock (dead-pid, pid 36777)` -> two fake ticks alive concurrently for ~5s, 3s after relaunch, unconditionally. Pre-AS-95 the same steal needed a human message plus the debounce; AS-95 makes it automatic. The lock code is byte-identical as required, but "Single-flight is unchanged: one tick at a time" is not true in behaviour. Minimal in-scope fix without touching makeLockOps: on resume, do not fire while a lock file exists younger than tickTimeoutMin (age, not pid liveness), and log the wait; the pid-vs-source ownership question stays AS-84's.

F3 — a watcher death during tick 1 loses the loop entirely: writeLoopState runs only at settle, so no advance-loop.json exists yet. OBSERVED (run4: kill -9 during tick 1, relaunch): no LOOP-RESUME, orphan finishes, T1 in_progress, dead-pid lock left, watcher idle until the next message — the exact symptom this task exists to fix, in the crash case. Follows the plan as written ("mirrored after every evaluation"), so plan gap not implementer error; one call to writeLoopState() at LOOP-START closes it. Non-blocking; include in the rework.

F4 — every loop tick waits up to one deploy-poll interval (60s in production) even with nothing to deploy. pendingDeploy() is true on reason 'busy', and the deploy poll during any tick always says busy; after settle the loop reports LOOP-WAIT until the next deploy poll clears it. OBSERVED (run6b, deploy poll 4s, docker=/usr/bin/true): ticks 2, 3 and 4 each logged `LOOP-WAIT deploy pending` then fired 1-2s later; also stays pending after a completed deploy until the following poll. Bounded, never a hang; the yield itself works as specified (run6b tick 1 -> LOOP-WAIT -> DEPLOY building -> fail/cooldown -> LOOP-FIRE tick 2, deploy strictly between ticks). Description says "immediately". Non-blocking; a settle-time evaluate({busy:false}) would remove the tax. Backlog-worthy if not taken in the rework.

F5 — sidebar reads Idle between loop ticks: deriveLoopStatus returns 'idle' with loop.active:true whenever no fresh lock exists (encoded in the tests), so during the between-tick gap (F4 makes it up to ~65s) the label is "Idle" while a loop is armed. AC-6 as written is met; the description's "read 'Loop active' while the watcher is looping" is not, between ticks. Non-blocking; one branch in describeLoopStatus.

F6 — docs/log trivia, not fixed inline because the verdict is rework: README example shows `LOOP-START` then `LOOP-FIRE tick 1`; tick 1 is fired by the message path (`FIRE messageId N`) and LOOP-FIRE appears only for loop ticks 2+ (run1 log). Also a loop tick logs `FIRE messageId 2 from human:forrest` (run5) — reads as a message fire. Also the poll() comment says a loop tick "re-uses the current highwater id"; it passes the real sentinel (correct, and load-bearing for AC-5).

F7 — AC-10 is only partly met. Unguarded main() additions: 142 lines (my count from the diff; pure section 219, lock/deploy ops 15), including three new inner functions carrying policy — settleLoop (fold verdict, stop-on-error, lastLoop), loadLoopState (resume policy: counters reset, pending), writeLoopState — plus the fire()/poll() loop-pending handling. The report enumerates by reference to the plan's four items, not by line, and the plan's cap was those four items. Both blocking defects (F1, F2) live in this unguarded region and neither has a unit falsifier. Recommendation for the rework: lift the loop state machine into an exported makeLoopOps({...}) beside makeLockOps/makeDeployOps so F1/F2/F3 become M4 criteria with observed reds.

F8 — not this task's: mode.test.js AS-24 failed on BOTH master and branch when I ran the two compose builds concurrently (one fail each, same assertion), and passed on both when run alone. Third independent observation for AS-83.

Cleared by observation (recorded so nobody re-derives it): AC-5's cross-poll half — run5 wrote sentinel 2 during tick 2: `LOOP-EVAL tick 2 reason=new-message` -> `DEBOUNCE armed` -> `LOOP-FIRE tick 3` -> `FIRE messageId 2`; highwater moved 1->2 exactly once; total still 4 ticks, no extra fire. Correct, but held by main() code with no unit test (see F7). Real-board check: readBoard over the live .lattice/tasks read 99 files, 0 unreadable, 44 backlog (matches `lattice list --status backlog` line for line), 37 ready, 7 held by unmet deps (AS-49/50/69/70 D1 chain, AS-77/78/79 on AS-76).

== ACCEPTANCE SWEEP — FLOOR CHECK (9 of 10 pass, 1 partial; see the 8 findings above, 2 blocking) ==

Counted runs (AC-8), cardinality first:
- master, solo: `Image asc-qa95-master-test Built` — 21 test files, 293 tests: 293 pass, 0 fail, exit 0.
- branch, solo: `Image asc-qa95-branch-test Built` — 22 test files (+watcher-loop.test.js), 340 tests: 340 pass, 0 fail, exit 0. Delta +47 tests, matches the implementer's node --test claim, which I did not rely on.
- (first attempt, both builds concurrent: 292/293 and 339/340, the same AS-83 flake on each — voided, re-run solo.)
- Host node --test on the branch scratch copy used as the mutation baseline: 340/340.

Mutants — scratch copies of the worktree's apps/chat (never mutated in place), each asserted applied, each run with host node --test against the 340 baseline. 13 run, 13 red, 0 survivors:
  a-drop-review (drop 'review' from MID_LIFECYCLE)       -> 2 red: a-statuses, a-review
  a-delete-rule5 (delete the mid-lifecycle rule)          -> 7 red: a-statuses, a-review, e-one-continues, e-reset, f-23, g-one, g-reset
  b-delete-rule6 (delete the backlog-ready rule)          -> 2 red: b-ready, b-chatset-detail
  c-gte ('>' -> '>=' on new-message)                      -> 10 red: a-statuses, a-review, a-terminal-only, b-ready, b-chatset-detail, b-not-ready-statuses, c-equal-not-new, d-dry, e-one-continues, e-two (c-new-message stays green; the guard is proven by the equal case, as the implementer also recorded)
  c-loop-beats-message (nextPollAction lets the loop win)  -> 1 red: c-single-fire
  d-dry-continues (dry returns continue)                  -> 2 red: b-not-ready-statuses, d-dry
  e-delete-rule2 (delete the no-progress stop)            -> 2 red: e-two, e-unknown-head
  f-gt ('>=' -> '>' on both cap compares)                 -> 3 red: f-24, f-8h, f-limits-injectable (f-23 green as predicted)
  g-delete-rule1 (delete the failure stop)                -> 3 red: g-two, g-timeout, g-precedence
  ac4-no-depcheck (readyBacklog ignores dependsOn)        -> 3 red: dep-unmet-out, dep-missing-target, dep-unmet-in
  reader-throws (unparsable file throws)                  -> 1 red: reader-unparsable
  ac6-label-no-branch (remove the watcher-loop label case)-> 1 red: AS-95 label: a watcher loop is "Loop active · watcher, tick N"...
  ac6-derive-no-state (inWatcherLoop = false)             -> 2 red: api: AS-95 — a watcher loop is observable over /api/loop-status...; AS-95 loop-status: ...from either witness alone

AC-1 PASS — rules a-g each red under one mutation (above), exact sets recorded.
AC-2 PASS — e-delete-rule2 red {e-two, e-unknown-head}; observed end to end in run2 (`LOOP-STOP reason=no-progress after 2 ticks`, detail names midLifecycle:[T-1]).
AC-3 PASS — f-24 stops, f-23 continues, f-8h stops; f-gt red on all three.
AC-4 PASS — ac4-no-depcheck red on three; real-board readiness above.
AC-5 PASS (with F7 caveat) — c-loop-beats-message red {c-single-fire}; cross-poll half observed in run5, not unit-held.
AC-6 PASS — both mutants red; served endpoint asserted in api.test.js inside the counted compose run.
AC-7 PASS — run1: one message -> 4 ticks (3 LOOP-FIRE) -> `LOOP-STOP reason=dry after 4 ticks`, lock gone, mirror lastLoop dry/4. run2: `LOOP-STOP reason=no-progress after 2 ticks`. Extra: run7 `LOOP-STOP reason=tick-failed-twice after 2 ticks` (exit 3 twice); run6b deploy yield between ticks.
AC-8 PASS — receipts quoted above.
AC-9 PASS — README section present with rules, cap, mirror fields, stop-reason reading, restart note; F6 inaccuracy to fix.
AC-10 PARTIAL — see F7.

Inline fixes: none (rework verdict; commit discipline). Status left at review for the orchestrator. Note: the failed auto-review also posted a needs_human_flagged event on this task — not mine, not acted on.
