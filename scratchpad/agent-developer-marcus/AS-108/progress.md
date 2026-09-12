# AS-108 progress — developer-marcus (Opus under the Fable fallback)

Branch `feat/AS-108-lanes-realpath-root`, worktree `.worktrees/AS-108`, base 6dbfef1.
Head: a4c8614 (2 commits: 1bc3d6c code+tests+README, a4c8614 pin strengthening). Tree clean.

## Baseline (before any edit)
host `node --test` in apps/chat: **562 examined / 561 pass / 0 fail / 1 skipped**.
Plan §0 said 554 (measured on d2d6608). Delta +8 = AS-102 merged at daa74b7 (T1–T8, 8 tests) — not AS-120/AS-106.
Prediction: +6 → **568 / 567 / 0 / 1**. Measured after: 568/567/0/1. Exact.

## Compose (--build, own project, torn down)
- branch  `-p asc-impl-as108`:      `Image asc-impl-as108-test Built`      568/561/0/7  (compose.log)
- master  `-p asc-impl-as108-base`: `Image asc-impl-as108-base-test Built` 562/555/0/7  (compose-base.log)
- +6 in both planes. Container skips 7 vs host 1 (docker-gated tests), same on base and branch.

## Battery (battery.log; driver mutate.mjs)
10 applied / 8 red as predicted / 2 deviations (both WIDER by one, explained) / 0 survivors.
- M1 also reds T2: canonRoot never called → no WARN → T2's warn-once count is 0. Benign.
- M9 also reds T4: full-path return has no `#` → 8-hex suffix check fails. Benign.
- Driver anchor caught a wrong-site match on first run (makeDeployOps has its own evaluate at :1295); fixed anchor to search from makeLanesOps. Nothing was mutated on that run.

## Findings outside the plan
- F1: `watcher-lanes-unwritable` constructs makeLanesOps directly (not via harness()) → hit the real default realpath on '/repo' → ENOENT fallback WARN made its count 2. Injected identity realpath there. Plan §2 said "nothing else in the existing tests changes" — this one caller was missed.
- F2: plan §2's literal pin (no trailing slash) could not go red on M7; added a trailing-slash pin (a4c8614).

## Done
- [x] code, tests, README, commits, battery, compose receipts
- [ ] lattice comment, #engineering post
