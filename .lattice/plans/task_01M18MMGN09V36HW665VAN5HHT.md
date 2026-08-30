# AS-13: Watcher hardening nits from AS-7 review (lock steal race, sentinel tmp suffix, SIGKILL timer)

**Complexity: low.** Five enumerated findings from qa-priya's AS-7 review (her comment on AS-13,
2026-08-30, has the full fix sketches). This plan is a triage: four cheap, real fixes; one
won't-fix, documented. Governing constraint carries over from AS-7 plan §5 and the watcher
header comment: **the advance lock is etiquette, not a correctness invariant** — correctness
lives in Lattice claims and SQLite. Nothing below promotes the lock to load-bearing; fixes 1
and 3 only shrink the probability of a wasted/duplicate tick (real token cost), they do not
and must not claim mutual exclusion.

## Dispositions

| # | Finding | Disposition | Why |
|---|---------|-------------|-----|
| 1 | acquireLock stale-steal race: two actors interleave unlink+wx-create on the same stale lock; both believe they hold it | **FIX** | ~5 lines; a double tick is double `claude -p` token burn. Verify-after-create shrinks the window; does not eliminate it, and that residual stays sanctioned. |
| 2 | Sentinel tmp uses fixed name `last-human-message.json.tmp`; server + CLI containers share the bind mount and can interleave write/rename | **FIX** | One line. Removes a real cross-process ENOENT/mis-rename class in `writeHumanSentinel`. |
| 3 | SIGKILL grace timer closes over the mutable `child` var; a timed-out tick's kill timer can SIGKILL a just-spawned successor tick (reachable only when `ADVANCE_DEBOUNCE_S` < 15s kill grace) | **FIX** | ~3 lines. Unreachable at defaults, but mutable-shared-state-in-timer is a bug class, not a nit; cost of the fix is near zero. |
| 4 | SKIP log line every 5s poll while a foreign fresh lock is held with a pending sentinel (~360 lines / 30-min tick) | **FIX** | ~5 lines, matches the existing `lastBadSentinel` dedupe pattern. Restores log signal; rotation already bounds size, this is about readability. |
| 5 | pid-guard read-then-write TOCTOU: two manual watchers started in the same instant can both pass the guard | **WON'T FIX — document** | The pid file is a courtesy guard for the "ran it manually too" case; launchd supervision plus the fire-time `wx` lock make the race moot (Priya's own assessment). A wx-create pid file would duplicate the lock machinery for a convenience check — gold-plating. Add a one-line comment at the guard stating the race is known and sanctioned. |

## Fix approach

All in `apps/chat/watch/advance-watcher.mjs` except (2) in `apps/chat/lib/store.js`.

**(1) Verify-after-create in `acquireLock()`.** After a successful `writeFileSync(paths.lock,
body, {flag:'wx'})`, re-read the lock and confirm `parsed.pid === process.pid`; if not, another
actor stole/rewrote between our create and now — log (`STEAL-LOST` or similar) and return
false (do not unlink: the file is theirs). Verify unconditionally on both attempts (negligible
cost, simpler than gating on the steal path). Preferred shape for testability: lift
`acquireLock`/`releaseLock` out of `main()` into an exported factory, e.g.
`makeLockOps({ lockPath, staleMs, log, pid })`, keeping `main()` a thin caller. Implementer
may keep them in the shell if the lift fights the file's structure, at the cost of
review-only coverage. Document in the function comment that verify reduces, not eliminates,
the double-steal (A create→verify, then B unlink→create→verify can still double-fire) —
sanctioned per the etiquette stance.

**(2) Unique tmp suffix in `writeHumanSentinel()` (store.js ~line 430).**
`const tmp = sentinelPath + '.' + process.pid + '.' + randomUUID() + '.tmp'` (or
`Math.random().toString(36).slice(2)` to avoid the crypto import — implementer's choice).
On the swallowed-catch path, best-effort `unlinkSync(tmp)` inside its own try/catch so a
failed rename doesn't strand a uniquely-named orphan. Note in the comment: this fixes tmp-file
collision only; two processes can still rename in either order, so the sentinel briefly
holding the lower messageId remains possible and remains fine (inbox sweep + sentinel >
highwater re-trigger deliver the message — Priya verified consequence-bounded in AS-7).

**(3) Capture the child per-fire.** In `fire()`: `const proc = spawn(...)`; use `proc` in both
timers and both handlers; keep the module-level `child = proc` for `poll()`/`shutdown()`
gating, and clear it with `if (child === proc) child = null` in the exit/error handlers. Hold
the SIGKILL grace timer in a variable and `clearTimeout` it in the exit handler alongside
`termTimer` (belt: capture fixes the cross-tick kill; suspenders: no stray timer survives a
normal exit).

**(4) SKIP dedupe.** Shell-level `lastSkipKey` (mirror of `lastBadSentinel`): key on
`` `${result.reason}:${sentinel.messageId}` ``. Log the first SKIP with a `(suppressing
repeats)` suffix; suppress identical repeats; reset the key on any non-skip action so the
next distinct skip episode logs again. Pure `decide()` is untouched.

**(5) Comment only.** One line above the pid-guard block in `main()`: read-then-write race
between two simultaneously started manual watchers is known and accepted — launchd owns the
supervised instance and the fire-time wx lock bounds the damage to log noise.

Out of scope: any lock retry loops, fencing tokens, flock/O_EXCL pid file, watcher behavior
changes visible at default config. No `advance.md`, README, or plist changes.

## Acceptance criteria

1. `acquireLock` returns false (and does not unlink) when the post-create read shows a
   foreign pid; returns true when it shows our own. Existing steal behavior (dead-pid, age,
   unparsable) unchanged.
2. Sentinel tmp filenames are unique per process/write; after any post (including a failed
   rename), no `*.tmp*` files remain in the data dir on the success path. Sentinel content
   contract (exact 4-field JSON) unchanged — existing store tests stay green.
3. In `fire()`, no timer or handler references the mutable `child` binding; SIGKILL grace
   timer is cleared on child exit. Behavior at default config byte-identical in logs except
   as per (4).
4. A held foreign fresh lock with a pending sentinel produces one SKIP line per episode,
   not one per poll; a new messageId or a lock release/reacquire starts a new episode.
5. Pid-guard comment present; no functional change to the guard.
6. Full container suite green; `watcher.test.js` still imports the watcher module without
   executing `main()` (mountless invariant from AS-7 plan §9 holds).

## Test plan (in-container, extend existing files)

- `apps/chat/test/store.test.js`: update the existing `tmp file renamed away` assertion to a
  readdir sweep (`no entries containing '.tmp'`); add a two-Store-instances-same-dir test
  (open two stores on one temp dir, alternate human posts, assert sentinel is valid JSON with
  the last writer's messageId and no tmp orphans — deterministic interleave, no real
  concurrency needed; the 2×200 hammer stays QA-side).
- `apps/chat/test/watcher.test.js`: if `makeLockOps` is lifted (preferred), add fs-backed
  tests in a temp dir (fs is fine in-container; the mountless invariant only bars bind
  mounts): clean acquire → true + file holds our pid; fresh foreign lock → false, file
  untouched; stale (dead-pid / old `startedAt`) → steal succeeds, verify passes; foreign
  overwrite between create and verify (simulate by pre-seeding the post-create read via a
  wrapper or injected reader) → false, no unlink. Existing pure `decide`/`isLockStale` tests
  unchanged.
- Findings 3 and 4 live in the effectful shell: covered by review reading the diff (and
  reviewer may rerun a sandboxed harness à la AS-7 if inclined — not required). No spawning
  of real `claude` anywhere, per standing AS-7 rules.
- Run: `docker compose run --rm --build test` — all green, no watcher process started, no
  live-system touches.
