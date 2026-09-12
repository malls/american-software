# AS-99 progress (developer-marcus)

Baseline host run at f6717b8 (master): **367 tests, 367 pass, 0 fail**.
Branch host run at 971d6a1: **416 tests, 416 pass, 0 fail** (+49).
Branch host run at 688496f (rework cycle 1): **420 tests, 420 pass, 0 fail** (+4).

## Log
- [x] (a) lib/lanes.js + test/lanes.test.js          — c9c35cc
- [x] (b) watcher makeLanesOps + test/watcher-lanes.test.js — c9c35cc / f221372
- [x] (c) lib/lattice.js listTasks + idsByShortId    — c9c35cc
- [x] (d) server /api/lanes + api.test.js            — 7f6d66b
- [x] (e) stream lanes frames + openStream.initialLanes — 7f6d66b / 1f7972a
- [x] (f) public/lanes.js + lanes-label.test.js      — 420b9c8
- [x] (g) index.html/app.js/style.css                — 0b9c307
- [x] (h) READMEs                                    — d6c7cc8
- [x] (i) AC-3 gap found by mutation                 — 971d6a1

## Mutation battery (tick 5)
Driver: `mut99/run.mjs`, results in `mut99/results.json`. Fresh copy of
apps/chat per mutant; the task worktree is never mutated. 17 mutants, all RED,
no survivors. Scratch baseline 416/416 matches the worktree run.

Two survivors on the first pass, both run down:
- M3b (rethrow in evaluate's outer catch) — GENUINE HOLE. Mutation landed at
  the intended site; nothing drove that catch. Fixed by 971d6a1; now RED.
- M11b (mtime instead of generatedAt) — MY MUTATION'S FAULT. v1 replaced the
  CLOCK (nowMs := file mtime) rather than the AGE SOURCE, so age was still
  (now - generatedAt) and a file's mtime is ~now. v2 substitutes generatedAt
  itself; now RED on api-lanes-stale-boundary.

## Rework cycle 1 (tick 7, Ruben's F1/F2)
- [x] F1 badge/empty-state for `git-error`            — bac4409
      public/lanes.js UNMEASURED_REASONS + EMPTY_STATES table;
      app.js reads view.emptyText instead of comparing view.badge.
      `stale-snapshot` is deliberately OUTSIDE the unmeasured set (it is an
      old measurement, not a missing one) — MF1d guards that choice.
- [x] F2 relPathOf outside the repo root              — b0da152
      '<outside repo>/<basename>'. Basename kept on purpose: lane.key falls
      back to relPath for unjoined rows, and a bare marker would collide.
      The old lanes-relpath assertion encoded the defect and was replaced by
      the sibling-prefix case.
- [x] README contract lines                           — 688496f
- F3/F4/F5 were observations; no code change made. Api-test additions stayed
  inside the AS-99 section so the AS-28 seam stays auto-mergeable.

Cycle-1 mutants: `mut99-c1/run.mjs`, results in `mut99-c1/results.json`.
5 mutants, 5 RED, 0 survivors, scratch baseline 420/420.
MF1a lanes.js:62 -> 2 red | MF1b lanes.js:73 -> 3 red (wider by 1, explained)
MF1c app.js:1023 -> 1 red (STATIC source assertion — renderLanes has no DOM
test; honest limit, recorded in the lattice comment) | MF1d lanes.js:62 -> 1
red | MF2 advance-watcher.mjs:1530 -> 2 red.

## Still owed
The counted `docker compose run --rm --build test` receipt (the `Image … Built`
line). Docker is denied in a headless tick (AS-92) — attempted again this tick
and refused at the permission layer, so no compose number is quoted anywhere.
Also owed: the live probes (phone-width field count, kill-the-watcher stale
caption at ~60 s, throwaway detached worktree card — which should now read
'<outside repo>/<name>', real-DOM Escape ordering).
