# AS-132 battery (developer-lena, 2026-09-12, loop 3 tick 13)

Branch feat/AS-132-rearm-resume-hold tip 1f9ae7f, worktree .worktrees/AS-132.

## Counts (tests/pass/fail/skipped)

| run | master | branch |
|---|---|---|
| host `node --test` in apps/chat | 660/657/0/3 (host-baseline.log) | 663/660/0/3 (host-impl.log) |
| compose `--build` | 660/651/0/9 `Image asc-base-as132-test Built` (compose-master-baseline.log) | 663/654/0/9 `Image asc-impl-as132-test Built` (compose-impl.log) |

+3 in both = as132-t1, as132-t2, as132-t3. Leak check clean on both compose projects.

## Mutants (in place, backup + restore, site asserted before the run; mutants.mjs, mut-M*.log, mutants-results.json)

| | mutation | expected red | observed red | fail count |
|---|---|---|---|---|
| M1 | rearmIfDue(): delete `resumeHold = true` (today's code) | {as132-t1} | {as132-t1} | 1 |
| M2 | blockedByLock(): `>= resumeGraceMs` -> `>= Infinity` (never ages out) | {as132-t1, f2-resume-fires-when-the-lock-aged-out} | same | 2 |
| M3 | blockedByLock(): `loadLock() ?? {startedAt: now}` (missing lock read as fresh) | {as132-t2, f2-resume-fires-with-no-lock, watcher-main AS-129 T11} | same | 3 |
| M4 | resume(): delete `resumeHold = true // F2` | {as132-t3, f2-resume-waits-out-a-live-lock, f2-gate-is-age-not-pid, f2-gate-is-resume-only} | same; as132-t1 stays green | 4 |

Every red set exactly as the plan tabled; `git -C .worktrees/AS-132 diff --exit-code` clean after the battery.
