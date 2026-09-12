# AS-83 implementation progress — developer-marcus

Worktree `/Users/forrest/Code/american-software-company/.worktrees/AS-83`, branch `feat/AS-83-probe-budget`.
Plan: `.lattice/plans/task_01M1PGD4EQKAXH2P1BMKF0QJ1T.md`.
Tick watcher:93997 (loop tick 19), 2026-09-11.

**Deviation from plan §6 recorded up front:** the plan wants R0–R2 observed red on
*unfixed* code before editing anything but the legibility change; the orchestrator's
tasking message reorders to host-first because the tick can be cut at 30 min.
Commit 6d31a64 is exactly "legibility only, production code unfixed", so AC-7's
observed red stays reachable: `git -C <worktree> checkout 6d31a64` (detached), run R1,
`git checkout feat/AS-83-probe-budget` back.

## Commits (all on feat/AS-83-probe-budget)

- `6d31a64` §3 step 1 + T4 — describeExit / elapsedMs / signal; all 18 status-0
  assertions switched (plan predicted 15, actual 16 at the time + 2 added later;
  AC-1 compares the two grep counts, both 18).
- `f00f2c5` §3 steps 2–3 — probe returns {state, reason}; DEFAULT_PROBE_TIMEOUT_MS
  = 3000 exported; CHAT_PROBE_TIMEOUT_MS knob validated up front in probeBudget();
  reasons appended to both refusals; usage text, mode-rule header, README.
- `060c7dd` §3 steps 4–5 — apiEnv(), slowProxy(), T1/T2/T3, amended trap case.

## Done

- Host suite: **484 pass / 0 fail** (master 480 + 4), 7.8 s.
- AC-1 greps: `status, 0, ` = 18, `status, 0, describeExit` = 18.
- AC-3 grep `500|3000` in lib/client.js: one line only (`export const
  DEFAULT_PROBE_TIMEOUT_MS = 3000`).
- Mutations M1/M2/M3 (scratch runner `mutate.mjs`, anchored, hash before/after,
  restore proven, `git status --porcelain` empty after each):
  - **M1** killed → exactly {AS-24 case, T2, sweep}; failure sites mode.test.js:185,
    288, 500 — all server-view assertions, none a timeout. 10 pass / 3 fail.
  - **M2** killed → exactly {trap case, T1}. 11 pass / 2 fail.
  - **M3** killed → exactly {T1, T3}. 11 pass / 2 fail.
  - Restored tree re-run: 484 pass / 0 fail.

## Deviation from the plan's M3 anchor (recorded)

Plan §8 M3 anchors on "the single literal CHAT_PROBE_TIMEOUT_MS in resolveBackend".
As written the knob's parse and its error message both name the literal inside
resolveBackend, so the anchor would not have been unique. Implemented instead as a
`probeBudget()` helper with a single call site `const timeoutMs = probeBudget();`
inside resolveBackend; M3 replaces that one line with `DEFAULT_PROBE_TIMEOUT_MS`,
which ignores the knob AND skips validation in one edit — the mutation the plan
wanted, with an anchor that can only hit the intended site.

## Docker (gate was already open — Lena's AS-80 marker present before my first run)

All runs `-p as83test`, `/usr/local/bin/docker` by absolute path, `--build` on every
counted run, `down --remove-orphans` at the end.

- [x] AC-11 branch counted run: **484 pass / 0 fail**, `Image as83test-test Built`,
      39.4 s. Log `compose-branch.txt`.
- [x] AC-11 baseline at merge-base e5de119 (detached checkout inside this worktree,
      restored to the branch in a `finally`): **480 pass / 0 fail**, same receipt.
      Delta exactly +4; host 484 = compose 484, so host-minus-compose delta 0 both sides.
      Log `compose-master-baseline.txt`.
- [x] AC-7 R1 on **unfixed** code (detached 6d31a64), BURNERS=20 NPROC=10:
      **1 of 1 runs red**, 8 pass / 2 fail. Message:
      `post: exit 1 signal null after 2961 ms` + the AS-24 ambiguous refusal, empty
      stdout. H1 confirmed, H3 dead. Note elapsed 2961 ms, not the plan's predicted
      ~1350 ms, and the sweep went red too (20.1 s) — the plan predicted only the
      AS-24 case. Log `r1-unfixed.txt`.
- [x] AC-8 half: R1 on the **fixed** branch, same load: **2 of 2 green** (13/13 each,
      `Image as83test-test Built` on both), 86 s and 90 s. Log `r1-fixed.txt`.
- [x] `docker compose -p as83test down --remove-orphans` — network removed.

---

# Tick watcher:93997, loop tick 20 (2026-09-11, 08:45–09:11Z) — R2, R0, M4

Driver scripts (scratch, not committed): `r2-r0.mjs`, `m4.mjs`. Logs `r2-r0.log`,
`r2-run-{1,2,3}.txt`, `r0-{quiet,burn,build}.txt`, `m4.log`, `m4-*.txt`.

## R2 — counted suite under a concurrent `build --no-cache server` (AC-8 other half)

3 of 3 green. Every run: **484 tests / 484 pass / 0 fail, exit 0**, receipt
`Image as83test-test Built` on each. 41.85 s / 41.34 s / 39.49 s.

**Load attribution (AC-8 needs it):** the load was **my own** background
`docker compose -p as83test build --no-cache server`, started 08:51:58Z from the
worktree and still running at the end of all three runs (`buildAliveAtEnd: true`
on runs 1–3 in `r2-r0-results.json`). **Not** the sibling lanes: `docker ps`
snapshotted before each run showed no `as80test*` / `as74test*` container at any
point — only long-standing unrelated idle services (`asc-chat-server-1`,
`whatever-sticks-*`, `asc-invoicing-web-1`, `web`, `api`, `search`, `meilisearch`,
`postgres`). So AS-80/AS-74 contributed nothing I can claim, and nothing I need.

## R0 — probe latency inside the test container (AC-10), n=50 per condition, nproc 10

| condition | p50 | p99 | max |
|---|---|---|---|
| quiet | 2.7 ms | 84.7 ms | 84.7 ms |
| concurrent `build --no-cache server` | 3.3 ms | 85.7 ms | 85.7 ms |
| 20 cpu-burn siblings (2 × nproc) | 5.3 ms | 334.9 ms | 334.9 ms |

- **p99 == max by construction** at n=50 (the 99th percentile index is the last
  sample). Read it as "worst of 50", not as a tail estimate. Stated, not hidden.
- **Decision on the default: keep 3000 ms.** The plan's §3 step-3 rule fires only
  if p99 under induced load exceeds 1000 ms; the worst observed is 334.9 ms, so
  `ceil(3 × p99 / 500) × 500` is not applied and `DEFAULT_PROBE_TIMEOUT_MS`
  stays 3000.
- **H1 over H2**: latency scales with load (2.7 → 85 → 335 worst-of-50), it does
  not spike independent of it. That is the H1 signature.
- **Finding — R0 as specified measures a floor, not the suite condition.** My
  harness is a *lone* node process in the container; at suite time the probing
  child competes with ~31 `node --test` processes *and* pays spawn + module load.
  334.9 ms against the old 500 ms budget is only ~1.5× headroom in the weakest
  available condition, and the AC-7 red proves the real in-suite cost exceeds 500
  ms. So R0 corroborates the mechanism and sets the default; it does not on its
  own prove the budget was the binding constraint — the AC-7 observed red and T1 do.

## M4 — the old 500 ms budget under R1 load reds again (AC-9)

One indivisible step (`m4.mjs`): sha before → anchored replace of the single
`CHAT_PROBE_TIMEOUT_MS: '20000'` in `apiEnv` with `'500'` → four applied-at-site
assertions (`'20000'` 0×, `'500'` 1×, apiEnv body located, the `'500'` is *inside*
the apiEnv slice) → rebuild + loaded run → restore in `finally` → sha equal +
`git status --porcelain` empty → rebuild + loaded run.

- **Mutated, 1 of 1 red**: 13 tests / 12 pass / **1 fail**, exit 1, receipt
  `Image as83test-test Built`, 53 s. Failing case:
  `mode: AS-24 — full command sweep in API mode (no DB file, direct-mode shapes)`
  (14.83 s), message quoting
  `… refusing to touch the shared DB directly — host-side access can silently fork it (AS-24). … (timed out after 500 ms)`.
- **Restored, 1 of 1 green**: 13 / 13 / 0, exit 0, receipt `Image as83test-test Built`, 97 s.
- Restore proven: sha AFTER == sha BEFORE
  (`2abd16dc…ac519`), `git status --porcelain` empty.
- **Site check (the AS-95 sharpening, applied to a non-survivor):** the red landed
  at the **sweep**, while the plan predicted the **dm/AS-24 case**. Not a wrong-site
  mutation — the applied-at-site assertions pin the edit inside `apiEnv`, and the
  failing assertion's own message names `(timed out after 500 ms)`, i.e. the budget
  I changed. Mechanically the sweep is the likelier loser: it spawns ~15 children
  through `apiEnv`, so it has ~15× the exposure to one 500 ms budget that the dm
  case has. Same asymmetry as last tick's R1-unfixed run, where the sweep also went red.

## Remaining / not reached

- ~~M4 reduced to 1+1~~ **WITHDRAWN 09:04Z** — a second indivisible execution
  (`M4_RUNS=2`, log tail in `m4-round2.stdout`) added 2 mutated + 2 restored runs:
  mutated 13/10/3 exit 1 (41 s) and 13/11/2 exit 1 (40 s); restored 13/13/0 (86 s)
  and 13/13/0 (90 s); `Image as83test-test Built` on all four; restore proven again
  (sha equal, porcelain empty, branch still `060c7dd`). **M4 total: 3 of 3 red,
  3 of 3 green — the plan's 3+3, AC-9 a full pass.** Red set union = exactly the
  three `apiEnv` consumers {dm/AS-24 case, sweep, T2}; per run {sweep} /
  {dm, sweep, T2} / {dm, sweep}. So the site-check note above resolves: the dm case
  the plan predicted does go red; run 1's sweep-only red was the weakest draw of a
  nondeterministic mutant, not a wrong-site edit. T2 red at 500 ms and green at
  20000 ms on the same proxy is the flake itself with only the budget changed.
- Nothing else outstanding. Branch green and self-consistent.
- **No commit this tick** — the drivers are scratch, the branch is unchanged at
  `060c7dd` (3 commits, clean tree). Nothing to commit is the correct outcome: this
  tick was load measurement and mutation, not code.
- **Merge-count drift (for the reviewer / merger):** AC-11's absolute 484 is measured
  against the merge base `e5de119`. Current master is 12 commits ahead and its
  `apps/chat` moved (AS-73 roster-parity + org-chart/personnel tests): master host
  count is now **486**, so the post-merge expectation is **490**, not 484. The
  invariant that survives is the **delta +4**; the file sets are disjoint
  (`mode.test.js` vs `roster-parity/org-chart/personnel`), so no interaction is expected.
