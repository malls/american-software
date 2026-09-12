# AS-95 review — findings formed from READING the diff (before any run, before reading the auto-review)
Written 2026-09-10 by qa-priya. Ordered as noticed, not by severity.

R1. LOOP DIES SILENTLY WHEN A LOOP TICK LOSES THE LOCK. poll(): `loopPending=false; log(LOOP-FIRE); fire(...)`.
    fire(): `if (!acquireLock(...)) { log(SKIP fire aborted); return; }` — no spawn, no settle(), no settleLoop().
    Result: loop !== null, loopPending false, nothing re-evaluates. Mirror file still says active:true. No LOOP-STOP.
    Trigger: any fresh foreign lock at the moment the loop fires (a /loop or manual session tick — the exact case the
    shared lock exists for), or STEAL-LOST. The message path self-heals (highwater not yet written -> decide refires);
    the loop path does not. Violates "Every stop reason is logged ... so the board can see WHY the company stopped".
    Plan to OBSERVE: e2e run 3 — fake tick overwrites the lock body with a live foreign pid before exiting.

R2. LOOP-RESUME AFTER AN UNCLEAN WATCHER DEATH FIRES OVER THE ORPHAN'S LOCK. loadLoopState sets loopPending=true;
    first poll() fires; lock carries the DEAD watcher pid -> isLockStale dead-pid -> STEAL -> second claude while the
    orphaned first tick (not killed on SIGKILL/crash; shutdown() only runs on SIGTERM/SIGINT) is still running.
    Pre-AS-95 the same steal needed a new human message + 15s debounce; now it is immediate and unconditional.
    Plan to OBSERVE: e2e run 4 — kill -9 the watcher mid-tick, relaunch, count concurrent fake ticks.

R3. EVERY LOOP TICK WAITS 0–60s FOR THE DEPLOY POLL. pendingDeploy() is true when lastDecision.reason is 'busy',
    and while a tick runs the 60s deploy poll always decides 'busy' (rule 1). After settle, nextPollAction ->
    'wait-deploy' until the next deploy poll runs with busy:false. Also stays true after a SUCCESSFUL deploy until the
    following poll (lastDecision is written after performDeploy with reason 'stale-build'). Bounded (<=60s, then
    cooldown/current clears it), never a hang. Not a stated-criterion violation; description says "immediately".
    Backlog-worthy: call evaluate({busy:false}) once at settle instead of waiting for the interval.

R4. AC-5's CROSS-POLL HALF IS STILL AN ARGUMENT, NOT A TEST. nextPollAction proves <=1 fire PER POLL. "Highwater moves
    once" across polls depends on the loop path passing the REAL sentinel to fire() (`fire(sentinel ?? {...highwater})`),
    which writes highwater=sentinel.messageId. The inline comment says the loop tick "re-uses the current highwater id"
    — it does not when a sentinel file exists (always, in production). If someone made the code match the comment,
    the message would be delivered by tick N+1's inbox pull AND fire a debounce+tick N+2 (highwater moves twice).
    main() is untested (AS-82). Plan to OBSERVE in e2e run 5: bump the sentinel mid-tick; expect ONE FIRE line for
    the new id, highwater==new id, no extra tick.

R5. SIDEBAR READS "Idle" BETWEEN LOOP TICKS. deriveLoopStatus: no fresh lock -> 'idle' even when loop.active is true
    (test explicitly encodes this). With R3 the gap is up to ~65s per tick. Description: "should read 'Loop active'
    while the watcher is looping". AC-6 as written (label during a tick, with count) is met. Minor.

R6. README log example is wrong: shows `LOOP-START` then `LOOP-FIRE tick 1`. Tick 1 of a loop is fired by the message
    path (`FIRE messageId ...`); LOOP-FIRE is logged only for loop-path ticks (2+). Doc trivia — confirm in e2e log,
    fix inline if confirmed.

R7. Cap semantics: a message arriving mid-loop does NOT reset the 24/8h counters (armedBy stays the first message);
    "a new message re-arms" only after a stop. Conservative reading; consistent with "per human message" as the
    arming message. Observation only.

R8. `'busy'` treated as pending: if a FOREIGN fresh lock is held (a live /loop session) the deploy poll says busy ->
    loop waits (correct: single-flight). Once it clears, evaluate decides -> loop proceeds. OK.

R9. LOOP-STOP reason=error path: `lastLoop.reason='error'` is not in the description's enum; label maps it. OK.

Things to verify by running: master baseline count; branch count; each plan-§3 mutant red set; real-board
readBoard vs `lattice list`; AC-7 runs 1 (dry) and 2 (no-progress) plus my runs 3/4/5.

# OBSERVED (e2e isolated stack, scratchpad/agent-qa-priya/e2e/run*/; fake claude; poll 1s debounce 1s; docker unresolvable)
- run1 (AC-7 half 1): msg 1 -> 4 ticks (3 LOOP-FIRE) -> LOOP-STOP reason=dry after 4 ticks. mirror: active:false, lastLoop dry/4. lock gone. PASS.
- run2 (AC-7 half 2): T1 in_progress, tick never commits -> LOOP-STOP reason=no-progress after 2 ticks, detail {headKnown:true, midLifecycle:[T-1]}. PASS.
- run3 (R1): tick 1 hands the lock to a live foreign pid -> LOOP-FIRE tick 2 -> "SKIP fire aborted: lock acquisition failed" -> NOTHING for 12 polls.
  mirror frozen at active:true ticks:1 lastLoop:null; T1 in_progress; no LOOP-STOP. CONFIRMED silent loop death.
- run5 (R4/AC-5): sentinel 2 written during tick 2 -> EVAL new-message -> DEBOUNCE armed (msg path) -> LOOP-FIRE tick 3 -> FIRE messageId 2
  (loop path passes the real sentinel; highwater 1->2 once) -> 4 ticks total, same as run1 -> no extra tick. R4 CLEARED by observation
  (still untested at unit level; main() is the AS-82 hole). Cosmetic: a loop tick logs "FIRE messageId 2 from human:forrest".
- run4 (kill -9 during tick 1): no mirror file exists yet (writeLoopState runs only at settle) -> relaunch finds no loop -> orphan tick
  finishes, T1 in_progress, stale dead-pid lock left, watcher idle until the next message. NEW R2b: LOOP-START does not persist the loop;
  a crash in tick 1 loses the loop entirely — the exact "company sits idle until he speaks again" symptom, in the crash case.
- run4b (R2, kill -9 during tick 2): relaunch -> LOOP-RESUME -> LOOP-FIRE tick 2 -> "STEAL stale lock (dead-pid, pid 36777)" ->
  TWO fake ticks alive concurrently (36867 from the dead watcher, 36897 from the new one) for ~5s. CONFIRMED double tick, unconditional,
  3s after relaunch. Pre-AS-95 the same steal needed a human message + debounce; AS-95 makes it automatic.
- R6 confirmed: run1 log shows LOOP-START then "FIRE messageId 1"; no "LOOP-FIRE tick 1" ever. README example wrong.

# COUNTED RUNS
- master  solo: "Image asc-qa95-master-test Built" — 21 files, 293 tests, 293 pass, 0 fail, exit 0
- branch  solo: "Image asc-qa95-branch-test Built" — 22 files (+watcher-loop.test.js), 340 tests, 340 pass, 0 fail, exit 0
- first pair run CONCURRENTLY: both 1 fail = mode.test.js AS-24 (the AS-83 flake, "under concurrent docker build") — third observation, master too.
- host node --test on the branch scratch copy (mutation baseline): 340/340.

# LATER RUNS
- run6 VOID (harness bug: my start() put ADVANCE_DOCKER_BIN=/nonexistent after the override). run6b valid: docker=/usr/bin/true, deploy poll 4s:
  tick1 EXIT 21:10:46.9 -> LOOP-WAIT -> DEPLOY building 21:10:49.5 -> DEPLOY fail (id-mismatch, fake docker) 21:11:09.6 -> cooldown -> LOOP-FIRE tick 2 21:11:13.6.
  Deploy ran strictly between ticks (yield holds). Ticks 2,3,4 each logged LOOP-WAIT then fired 1-2s later with nothing to deploy -> R3 CONFIRMED.
- run7: exit 3 twice -> LOOP-STOP reason=tick-failed-twice after 2 ticks. PASS.
- AC-10: unguarded main() additions 142 lines (pure 219, ops 15); settleLoop/loadLoopState/writeLoopState inner functions. Report enumerates by plan item.
- auto-review: FAILED (timeout 600s), no artifact, no findings. Found nothing I did not (it found nothing).
- Verdict recorded: implementation-level rework needed (F1, F2 blocking).
