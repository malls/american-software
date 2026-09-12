# AS-129 planning notes (cto-owen, 2026-09-12, tick watcher:79108 loop 2 tick 2, on Opus)

Working notes behind `.lattice/plans/task_01M2B3P03HKQSD6QYKB4PTMSR7.md`. The plan is the
contract; this is the reasoning, the ground truth I read, and the questions I closed.

## Ground truth read (master e253575)

- `apps/chat/watch/advance-watcher.mjs`
  - `DEFAULTS` L71–101: tickTimeoutMin 30, lockStaleMin 45, deployTimeoutMin 15,
    deployCooldownMin 30. `envNum()` L178: finite && > 0 else fallback — no ceiling.
  - `loadConfig()` L183–201; `main()` L2972 calls it unguarded; a throw there ends the
    process with the message on stderr → `launchd.err.log`, KeepAlive relaunches
    (the AS-88 crash-loop precedent for makeDeployOps' refusal).
  - `LOOP_DEFAULTS` L1335: maxTicks 24, maxMs 8h, maxLockWaitMs **literal** 60 min with a
    comment that says "longer than 30 + 45". Both moved to 60/75 on 2026-09-11 via the
    plist env — 60 min is now SHORTER than the staleness rule alone.
  - `shouldContinue()` L1388–1445: stop rules first; `cap-hit` at L1429 with detail
    `{ticks, elapsedMs}` and no word about whether work remains.
  - `makeLoopOps()` L1608–1827: `stop()` is the only way to clear `loop` (invariant, keep);
    `mirror()` body `{active, startedAt, ticks, armedBy, lastTick, lastLoop}`; `resume()`
    L1780 re-enters `active:true` without a cap check (AS-104); `snapshot()` L1818.
  - `main()` wiring L2862–2874 builds makeLoopOps WITHOUT `limits` → LOOP_DEFAULTS in
    production, so today the live watcher's lock wait is the 60-min literal.
  - `poll()` L2650–2732: `nextPollAction({decideAction, loopPending, deployPending, lockHeld})`
    — the one seam. The re-arm hook slots in just before it.
  - Minute→ms products into timers: tick timeout L2611 (setTimeout), deploy timeout L2899 →
    runDockerCompose L833 (setTimeout). lockStale/cooldown/resumeGrace are comparisons only;
    the ceiling still applies to them uniformly — one rule for every `*_MIN` knob is easier
    to state and to test than a rule that distinguishes timers from comparisons.
- `apps/chat/lib/loop-status.js` deriveLoop L101–120 builds the API shape field by field, so
  a new `rearmAt` in the mirror is invisible to the sidebar (no test pins the raw file).
  Only deepEqual on a mirror is `watcher-loop.test.js:593` (`h.saved` is `[]`) — safe.
- `apps/chat/test/watcher-loop.test.js`: loopHarness L473 (injected clock, `limits`,
  `saved[]` = mirror bodies, `lines(prefix)`); `f1-limit-default` L596 pins the literal.
- `apps/chat/test/watcher-main.test.js`: watcherHarness L72 (injected clock `h.tick(ms)`,
  fake spawn, real loop ops unless `over.loopOps`; L160 shows injecting a REAL makeLoopOps
  with custom args); `seedBoard()` L642; `headOf(dir)` is null there → noProgress climbs
  → a 24-tick drive would stop `no-progress` at tick 2 unless the test moves HEAD. Two
  options: inject real makeLoopOps with `maxTicks: 2` (chosen — no HEAD choreography,
  and the cap value is not the property under test), or write `.git/HEAD` per tick.
- Live `apps/chat/data/advance-loop.json` (read only): active loop armed by 1040, tick 1;
  `lastLoop` = cap-hit at 11:21Z after 15 ticks / 8.3 h — the board's WHY, verbatim.
- Host baseline: `node --test` in apps/chat = 624 tests, 622 pass, 0 fail, 2 skipped
  (run at plan time, 26 s). Compose baseline from the AS-113 merge tick: 624/616/0/8.

## Decisions

1. **Re-arm is a state, not a loop.** Cap-with-work still goes through `stop('cap-hit')`
   (LOOP-STOP logged, `lastLoop` set, `loop = null` — the F1 invariant holds), then the
   state machine enters a COOLDOWN: `rearm = {at, armedBy}`. `rearmIfDue()` is called by
   poll() before nextPollAction; when due it builds a fresh loop (startedAt = now, ticks 0,
   same armedBy), sets `pending`, logs LOOP-REARM, mirrors. Everything downstream (lock
   wait, deploy yield, LOOP-FIRE, highwater no-move) is the existing loop path untouched.
2. **"Work remains" is decided by the predicate**, as a `rearm` field on the cap-hit
   detail: `midLifecycle.length > 0 || ready.length > 0`. A new message is NOT part of it
   — decide()/fire() re-arms on a message today, and a fire during the cooldown calls
   start(), which clears the cooldown (criterion 6). Two pure helpers shared with resume():
   `capReached(loop, now, limits)` and `workRemains(board)`.
3. **AS-104 is subsumed.** resume() on an `active:true` mirror past the cap no longer fires
   a tick first: work → cooldown (rearmAt = now + rearmMs), dry → stop cap-hit for good.
   Same function, same seams, ~10 lines, two tests; a separate task would touch the same
   lines a week later. The orchestrator cancels AS-104 at merge with a comment naming
   AS-129 and criteria 9a/9b. Why the cooldown rather than an immediate re-arm on resume:
   the cap is a runaway guard and the guard's breather should not depend on whether the
   watcher happened to restart; and a self-restart after THIS task merges is exactly the
   case, so the first live observation of the feature should be the plain path.
4. **Cooldown survives a restart**: a mirror with `active:false` and a parseable `rearmAt`
   resumes into the cooldown (past-due re-arms on the next poll). Without this, the
   watcher's own self-restart after a merge would drop the re-arm — the symptom again.
5. **maxLockWaitMs**: exported pure `loopLimits(config)` =
   `{...LOOP_DEFAULTS, maxLockWaitMs: (tickTimeoutMin + lockStaleMin) * 60_000,
   rearmMs: loopRearmMin * 60_000}`; main() passes `limits: loopLimits(config)`.
   LOOP_DEFAULTS keeps a maxLockWaitMs, but derived from DEFAULTS (75 min), never a
   literal; the live value with the plist's 60/75 is 135 min. DEFAULTS stay 30/45 —
   moving them is a different decision (the plist is the 60/75 source of truth).
6. **Refuse, don't clamp**: `envMinutes()` beside envNum: junk → fallback (unchanged);
   finite > 0 but `v * 60_000 > 2147483647` → `throw new Error(...)` naming the var, the
   value, the ceiling and the largest legal value (35791). Fallback-to-default with a WARN
   is a clamp in disguise (AS-113's own argument: the operator's mistake would be hidden
   until it mattered). Applies to all five `*_MIN` knobs including DEPLOY_COOLDOWN.
   Consequence under launchd: crash loop with the reason in launchd.err.log — README says so.
7. **Sidebar unchanged.** While cooling, `/api/loop-status` says "Last loop stopped … the
   safety cap was reached", which is true. Showing "re-arming in N min" is a UX residual
   for the next task touching lib/loop-status.js (recorded on this task, not filed).

## Questions closed (time-boxed to this planning stage)

- Should the cooldown also apply to `no-progress`? No — the board's directive names only
  the cap as a runaway guard; no-progress and dry are stop rules. Default answer kept.
- Should the re-armed loop reset `noProgress`/`failures`? Yes, it is a fresh loop — same
  as resume(). The cap bounds each loop; a loop that keeps hitting it with work remaining
  will re-arm every 8 h/24 ticks + 10 min, which is the intended shape.
- Overflow of the SUM (tick + stale) past 2^31-1 when each is under it? maxLockWaitMs is a
  comparison, not a timer; the individual refusals bound each term at 35791 min. Ignored.
- Off-by-one on the ceiling: integer minutes cannot produce exactly 2147483647 ms, so
  `>` vs `>=` is unobservable; 35791 (fits) / 35792 (refused) is the pinned pair.

## Predicted counts

Host 624 → 643 (+19; 641 pass, 2 skipped, 0 fail). Compose 624 → 643 (635 pass, 8
skipped). Every counted compose run carries `--build`; the `Image … Built` line is the
receipt. Mutant table with exact red sets is in the plan.
