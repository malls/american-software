# AS-15: Watcher-fired ticks self-cancel on the watcher's own lock

**Planner:** cto-owen · 2026-08-30 · complexity: low, bug, priority high

## Problem

`fire()` in the watcher acquires `apps/chat/data/advance.lock`
(`source:"watcher"`, watcher pid) *before* spawning `claude -p '/advance'`,
and releases it in `settle()` on tick exit. The spawned tick runs advance.md
step 0, which exempts watcher-fired ticks — but the tick has no way to detect
that it is one: the headless invocation is byte-identical to a manual
`/advance`. So it treats the lock as foreign and no-ops. Every watcher-fired
tick self-cancels. Evidence:
`apps/chat/data/logs/tick-2026-08-30T18-08-30.241Z.log` (exit 0, "no-op —
lock is held", lock pid 17730 == live watcher pid).

## Decision

Pass a parent marker in the tick child env: `ADVANCE_TICK_PARENT=watcher:<watcher pid>`.
Step 0 then has a deterministic self-identification rule.

Rejected alternatives:
- **Watcher releases pre-spawn, tick takes its own lock** — opens a race
  window between release and the child's step 0 (a manual tick or loop can
  steal the slot), and breaks `settle()`/timeout lock-ownership semantics.
- **Step 0 adopts any fresh `source:watcher` lock, no marker** — misfires when
  a manual tick races a watcher fire: the manual tick adopts the watcher's
  lock and proceeds, defeating single-flight.

The marker names the exact parent pid, so only the watcher's own child ever
matches. No race, no ambiguity, one documented env var.

## Changes (exact files)

1. **`apps/chat/watch/advance-watcher.mjs`**
   - `tickChildEnv(env, watcherPid)` (or equivalent): widen the AS-14 env pin
     `{PATH, HOME, USER, LOGNAME}` by exactly one variable,
     `ADVANCE_TICK_PARENT: "watcher:<pid>"`, with a stated per-variable reason
     in the spawn-site comment block (per the AS-14 minimal-env principle:
     every variable has a documented reason).
   - `fire()`: pass the watcher's own pid through to the spawn env.
2. **`apps/chat/test/watcher.test.js`** — update the env-pin test (line ~288,
   "pins exactly {PATH, HOME, USER, LOGNAME}") to pin the new 5-variable set
   and assert the marker's exact `watcher:<pid>` format. The pin test changing
   in the same commit as `tickChildEnv` is the deliberate-act convention.
3. **`.claude/commands/advance.md` step 0** — replace the undetectable
   "watcher-fired ticks skip this step" sentence with: a lock whose `source`
   is `"watcher"` AND whose `pid` matches this session's `ADVANCE_TICK_PARENT`
   is YOUR lock — proceed, and do NOT release it at tick end (the watcher
   releases its own lock in `settle()` on tick exit); locks from any other
   source/pid are foreign — no-op. advance.md is employee-editable (not a
   top-level markdown file); this wording change is in scope for the
   implementer.

## Acceptance criteria

- `tickChildEnv` returns exactly `{PATH, HOME, USER, LOGNAME, ADVANCE_TICK_PARENT}`
  with `ADVANCE_TICK_PARENT === "watcher:<watcher pid>"`; pin test updated and
  green (`node --test apps/chat/test/watcher.test.js`), full suite green.
- advance.md step 0 states the match rule (source `watcher` + pid ==
  `ADVANCE_TICK_PARENT`), that the tick must NOT release the watcher's lock,
  and that any other source/pid is foreign → no-op. Manual/loop tick behavior
  unchanged.
- No other env variables added; no lock-acquisition logic changes in the
  watcher (the lock stays etiquette, not load-bearing — see file header).
