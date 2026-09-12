# AS-86 progress (developer-lena, tick watcher:93997 loop tick 23)

Worktree: /Users/forrest/Code/american-software-company/.worktrees/AS-86
Branch: feat/AS-86-dockerignore-image-input
Plan: .lattice/plans/task_01M1SJDVMGSTT8GAW09ETXNNE3.md

## Reading-pass findings (before first edit)

- F-1: plan §4 omits that `test/watcher.test.js` hard-codes 9 in the AS-75
  parseLsTree test (`:636` full.length, `:641` ok.count, `:649` r.expected, and
  the `8 of 9` prose at `:643`) AND at `:1007`
  (`/8 of 9 image inputs/` in the deploy-ops short-set test). All must move to
  10 / `9 of 10` or the suite goes red. `:1007` is inside the deploy-ops block
  AS-84 (Marcus) is editing this tick — it is a mid-block literal edit, not a
  tail append, so the collision risk is a one-line context overlap.
- F-2: plan §6 predicts compose `skipped 2`. The deploy-shape git-backed
  classification test skips on the same predicate, so the container number
  should be **3**, not 2.
- F-3: `advance-watcher.mjs:358` (parseLsTree docstring) says "8 of 9 inputs".
  Criterion 11 forbids touching anything else in that file, so it is left
  stale deliberately. Report it.

## Steps

- [x] read plan + sources
- [x] C1: Dockerfile + .dockerignore + IMAGE_INPUTS/NOT_IMAGE_INPUTS/classifyImagePaths (735b050)
- [x] C2-C5: deploy-shape, watcher.test, deploy-inputs-git, watch/README (b4d3455)
- [x] host suite: 504 tests / 504 pass / 0 fail / 0 skipped, duration_ms 7769.66
- [x] ls-tree: 10 lines on branch HEAD and on master
- [x] mutants M1(8 reds) M2(2) M3(1) M4(1) M7(1, criterion 7) M6(1, criterion 8)
      M5 inconclusive (died at the stub-count assertion) -> superseded by M6
- [x] tree clean after every mutant; post-restore suite 504/504 each time
- [ ] lattice comment from repo root  <- last step

## Mutant harness (reusable)

`mutate.mjs` (apply/assert-at-site/backup/restore), `run-mutant.mjs` (full
suite + finally-restore + git diff --exit-code + re-run), `detail.mjs` (one
file, failure text). The shell here rejects `trap` and writes to /tmp, so the
restore is a node `finally`.
