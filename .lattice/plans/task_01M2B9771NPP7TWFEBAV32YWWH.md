# AS-132: Chat watcher: a loop re-armed after resume() lands past the cap fires with resumeHold=false — a 12-min-old lock under a dead watcher pid is stolen beside the orphan (AS-129 Ruben F1)

Complexity low, two-stage path: Lena plans and implements; Priya reviews.
Source: AS-129 review, probe P5 (`scratchpad/agent-qa-ruben/AS-129/probes.mjs` L117–132).

## Scope

`makeLoopOps` in `apps/chat/watch/advance-watcher.mjs`. The watcher dies mid-tick with
the mirror `active:true` and the loop past the cap; on relaunch `resume()` stops
`cap-hit` and enters the cooldown (AS-129) instead of the resume path, so
`resumeHold` is never set. Ten minutes later `rearmIfDue()` arms a fresh loop and
`blockedByLock()` returns false at its first line; the dead watcher's lock (12 min
old, pid dead, child possibly still running for up to the 60-min tick box) is read
as free by `acquireLock`'s dead-pid steal, and the tick fires beside the orphan.
The F2 gate exists for exactly this lock; the re-arm path just never raised it.

Out of scope: `blockedByLock()`, `acquireLock`, `resume()`, the cooldown length,
the mirror shape, `lib/loop-status.js`. **Ruben F2 (a stale past-due `rearmAt`
re-arms without re-checking `workRemains`) is not folded in:** the fix here is one
assignment inside `rearmIfDue()`'s arming block; F2 needs a new guard with its own
behaviour decision (what a re-arm on a now-dry board logs and leaves in `lastLoop`),
which is a design call for the CTO, not a line I am already rewriting. It stays on
AS-129's record.

## Approach

1. `rearmIfDue()` sets `resumeHold = true` when it arms the loop (Ruben's suggested
   fix, unconditional). A re-armed loop has no tick of its own in flight, so any lock
   on disk is foreign or orphaned — the resume situation exactly. In the ordinary
   in-process cooldown the previous tick released our lock, so `blockedByLock()`
   self-clears on the first poll (one `loadLock()` read, no wait, no log line).
   Tracking "this cooldown came from resume()" would need a flag persisted through
   the mirror; the boring choice is to hold on every re-arm and let the existing
   gate decide.
2. Tests in `apps/chat/test/watcher-loop.test.js` after `as129-t9b`, on `capHarness`:
   - **T1** `as132-t1-rearm-after-resume-holds-the-lock-gate`: `cappedMirror` +
     `lockBody(2 min, {pid: 999_999})` → `resume()` (cooldown, per t9a) → +10 min →
     `rearmIfDue() === true`, `blockedByLock() === true`, `nextPollAction(... lockHeld)`
     = `wait-lock`, exactly one `LOOP-WAIT lock held by pid 999999` line, `pending()`
     still true; second `blockedByLock()` still true with no second line; +18 min
     (lock 30 min old = `resumeGraceMs`) → `blockedByLock() === false`, `pending()`
     true, `snapshot().resumeHold === false`, `takeFire()` logs `LOOP-FIRE tick 1`.
   - **T2** `as132-t2-ordinary-rearm-is-not-held-with-no-lock`: `driveToCap` → +10 min
     → `rearmIfDue() === true`, `blockedByLock() === false`, zero `LOOP-WAIT` lines,
     `snapshot().resumeHold === false` (the common path pays nothing).
   - **T3** `as132-t3-contrast-ordinary-resume-holds`: P5's contrast — the same lock
     with the not-past-cap `resumeState` → `resume()` → `blockedByLock() === true`.
3. `apps/chat/watch/README.md` § After the cap: one sentence on the re-armed loop's
   first tick honouring the lock-age wait, naming AS-132.

Key files: `apps/chat/watch/advance-watcher.mjs` (`rearmIfDue`, ~L1735),
`apps/chat/test/watcher-loop.test.js`, `apps/chat/watch/README.md`. Never
`apps/chat/data/*`.

## Acceptance criteria

1. T1 green: a re-arm after a resume-entered cooldown waits out a lock younger
   than the tick timeout, logs one LOOP-WAIT line, keeps the owed tick, and fires
   once the lock ages out. Falsifier **M1**: delete the new `resumeHold = true` in
   `rearmIfDue()` (today's code). Red set exactly {T1}.
2. The hold is the existing age gate, not a new one: falsifier **M2**:
   `blockedByLock()` never ages a lock out (`>= resumeGraceMs` → `>= Infinity`).
   Red set exactly {T1, `f2-resume-fires-when-the-lock-aged-out`}.
3. T2 green: the in-process re-arm is not held when no lock is on disk. Falsifier
   **M3**: `blockedByLock()` treats a missing lock as a fresh one
   (`loadLock() ?? { startedAt: iso(now()) }`). Expected red {T2,
   `f2-resume-fires-with-no-lock`, watcher-main `as129-t11`}; the observed set is
   recorded exactly and any difference explained.
4. T3 green: the ordinary resume still holds. Falsifier **M4**: delete
   `resumeHold = true` in `resume()`. Expected red {T3, `f2-resume-waits-out-a-live-lock`,
   `f2-gate-is-age-not-pid`, `f2-gate-is-resume-only`}; observed set recorded; T1 stays
   green under M4 (the fix does not lean on `resume()`).
5. No existing test changes; `as129-t5`, `as129-t9a` (`resumeHold === false` after
   `resume()` past the cap — still true, the hold is raised at re-arm) and
   watcher-main `as129-t11` stay green.
6. Host suite and the counted compose run (`compose-run.mjs --project asc-impl-as132`)
   both rise by exactly 3 tests over master's baseline; the `Image … Built` line quoted.
7. Every mutant applied in place with backup + `trap` restore, asserted applied at
   the intended site before its run counts; `git -C .worktrees/AS-132 diff --exit-code`
   clean after each. Logs: `scratchpad/agent-developer-lena/AS-132/`.
