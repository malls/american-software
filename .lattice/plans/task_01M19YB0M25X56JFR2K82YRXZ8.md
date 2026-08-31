# Plan: AS-16 — Per-fire nonce hardens advance.lock adoption against pid reuse

**Task:** task_01M19YB0M25X56JFR2K82YRXZ8
**Planner:** cto-owen (2026-08-31)
**Complexity:** low — one mechanism, three files, no new dependencies.

## Problem (from Priya's AS-15 review, extended in AS-20)

Current adoption rule in `.claude/commands/advance.md` step 0: a spawned tick
adopts an existing `advance.lock` when `lock.source === "watcher"` AND
`lock.pid` matches the pid in the `watcher:<pid>` argument marker. Residual
spoof window: a shell carrying a *stale* marker whose pid has been reused by a
*new* live watcher (holding a fresh lock) lets a manual tick wrongly adopt
that lock and defeat single-flight. Odds are astronomical and the lock is
etiquette-not-load-bearing (watcher header comment), which is why this is a
hardening task, not a blocker.

## Design

**One mechanism: a per-fire random nonce shared by the lock file and the
marker.** Pid reuse cannot reproduce a fresh 64-bit random value, so
pid+nonce match makes stale-marker adoption impossible in practice.

1. **Nonce generation.** New tiny export in `advance-watcher.mjs`:

   ```js
   export function fireNonce() { return randomBytes(8).toString('hex'); }
   ```

   `randomBytes` from `node:crypto` — still zero external deps. Format:
   exactly 16 lowercase hex chars (64 bits). Generated once per fire, in
   `fire()`, before lock acquisition; every artifact of that fire (lock body,
   argv marker, env marker) carries the same value.

2. **Lock file.** `acquireLock` gains a required `nonce` parameter;
   the body becomes `{ pid, startedAt, source: "watcher", nonce }`.
   Deliberately narrow:
   - `isLockStale` / `decide`: **untouched** — nonce plays no role in
     staleness or fire/skip. Staleness stays pid-liveness + age.
   - `releaseLock` / verify-after-create: **unchanged** (pid-based). They
     guard *concurrent* races between different live processes, where pids
     differ by construction; the nonce targets pid reuse *across time*.
     Widening them is scope creep — noted here so QA knows it was considered.

3. **Marker.** Format becomes `watcher:<pid>:<nonce>` on both transports:
   - `tickArgv` → `-p '/advance watcher:<pid>:<nonce>'` (the contract, AS-20).
   - `tickChildEnv` → `ADVANCE_TICK_PARENT=watcher:<pid>:<nonce>` (belt).

   Signatures: nonce slots directly after the pid it composes with —
   `tickChildEnv(env, watcherPid, nonce)` and
   `tickArgv(watcherPid, nonce, permissionMode, rules)`. No default for
   nonce: a defaulted random would make the pin tests nondeterministic, and
   the sole production caller (`fire()`) always supplies one. Update the
   `fire()` call sites and the spawn-site comment block accordingly.

4. **Adoption rule (`.claude/commands/advance.md` step 0 + argument-hint).**
   Adopt the existing lock as YOUR lock only when **all three** hold:
   `lock.source === "watcher"` AND `lock.pid` equals the marker pid AND
   `lock.nonce` equals the marker nonce. Anything else — wrong source, pid
   mismatch, nonce mismatch, nonce *missing on either side*, or no argument
   marker at all — is a foreign lock: end the tick as a no-op (or steal if
   stale, per the unchanged staleness rule). Update the argument-hint to
   `watcher:<pid>:<nonce>`.

### Back-compat call (decided here, per task instructions)

**Strict full-match; no legacy grace.** A marker carrying a nonce never
adopts a nonce-less (old-format) lock, and a nonce-less marker never adopts a
nonce-bearing lock. Rationale: the fleet is one machine; the watcher, the
tests, and advance.md upgrade atomically in this one merge — there is no
rolling-upgrade window. Post-merge, the only way a nonce-less watcher lock
can exist is as a leftover from a pre-upgrade watcher process, which is
precisely a lock we should NOT adopt; it will be handled by the unchanged
staleness path (dead pid or 45-min age). Operational note for the merge tick:
restart the launchd watcher after merging so the running process speaks the
new format — until restart, its fired ticks would carry old-format markers
and correctly no-op against their own lock (fail-safe: skipped tick, never a
double-fire; the next message retries).

## Test changes — contract evolution, not creep

Existing pins are **updated in place**, never duplicated. QA should read
these diffs as deliberate contract changes:

- **`tickChildEnv` pin** (`watcher.test.js` ~L288): key set assertion is
  UNCHANGED (still exactly `{PATH, HOME, USER, LOGNAME, ADVANCE_TICK_PARENT}`
  — 5 vars). The *value* assertions change: calls gain an explicit nonce arg;
  `ADVANCE_TICK_PARENT` expectations become `watcher:4242:<nonce>`; format
  regex becomes `/^watcher:\d+:[0-9a-f]{16}$/`.
- **`tickArgv` pins** (~L332, 364, 391, 402, 414, and the composition test
  ~L464): `argv[1]` expectations become `/advance watcher:<pid>:<nonce>`;
  call sites adopt the new `(watcherPid, nonce, permissionMode, rules)`
  order. Trailing-grants structure assertions unchanged.
- **`makeLockOps` clean-acquire test** (~L225): `acquireLock` calls gain a
  nonce arg; add `assert.equal(written.nonce, <injected>)` beside the
  existing pid/source assertions. The foreign-lock, stale-steal, and
  steal-lost tests update call sites only — their assertions stand, because
  staleness and verify semantics are unchanged.
- **New tests (small):** `fireNonce()` matches `/^[0-9a-f]{16}$/` and two
  calls differ; the same nonce threads identically through `tickArgv` and
  `tickChildEnv` (lock/marker agreement is asserted at the `acquireLock` +
  argv level — the step 0 matcher itself is prose in advance.md, not
  testable JS, so the JS tests pin both sides of the contract it reads).

## Files

- `apps/chat/watch/advance-watcher.mjs` — `fireNonce` export; `acquireLock`
  body + signature; `tickChildEnv`/`tickArgv` signatures + marker format;
  `fire()` wiring; comment blocks (tickChildEnv, tickArgv, spawn site).
- `apps/chat/test/watcher.test.js` — pins updated per above + new nonce tests.
- `.claude/commands/advance.md` — step 0 adoption rule + argument-hint
  (employee-editable; NOT a top-level markdown).

No changes to: `decide`/`isLockStale`, `releaseLock`, verify-after-create,
`watch/README.md` (no marker-format mentions — verified by grep), the live
watcher process, or `advance.lock` itself during this task.

## Acceptance criteria

1. Lock written by `fire()` is `{pid, startedAt, source:"watcher", nonce}`
   with nonce matching `/^[0-9a-f]{16}$/`, fresh per fire.
2. Both markers (argv argument and `ADVANCE_TICK_PARENT`) are
   `watcher:<pid>:<nonce>` carrying the SAME nonce as that fire's lock.
3. advance.md step 0 requires source AND pid AND nonce to all match for
   adoption; missing nonce on either side means no adoption; staleness
   wording unchanged.
4. `node --test apps/chat/test/` fully green; pin tests updated in place
   (no duplicated pins), plus the new `fireNonce` tests.
5. `decide`/`isLockStale`/`releaseLock`/verify behavior byte-identical in
   semantics (staleness and release remain nonce-blind).
