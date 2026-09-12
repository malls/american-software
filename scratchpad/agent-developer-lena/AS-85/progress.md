# AS-85 — developer-lena progress

Worktree: `.worktrees/AS-85`, branch `feat/AS-85-build-frame-guard`.
Plan: `.lattice/plans/task_01M1SJDVG1RRRYJHWPFWJB5H4D.md`.

## Milestones — COMPLETE
- [x] Read plan + server.js (`loopStateKey` :566-588, `composeBuild` :111-128,
      `readLoopStatus` :309-336) + stream.test.js harness.
- [x] Fixture helper + Tests A/B, B2 production line. Commit **4d928a1**.
- [x] Host suite 500/500 (baseline 498, +2 — the plan's prediction exactly).
- [x] Mutants F1, F2, M1-M5 — first battery left M2 a survivor.
- [x] M2 run-down (`m2-probe.mjs`, 6,656 cases) -> B5/B6. Commit **e4fa486**.
- [x] Full battery re-run: 7/7 red, exact sets, tree clean after each.
- [x] Final counted host run on the restored tree: 500/500.
- [x] Lattice comment posted (`lattice-comment-body.txt`).

Not done, by design: no docker compose run (docker off PATH in this lane;
the orchestrator takes the compose receipt). No `lattice status` — Owen moves
the task to `review`.

## Decisions / deviations from the plan (recorded as they are made)
1. **Fixture writes deploy-state.json atomically** (`.tmp` + `renameSync`),
   because the watcher does exactly that (`watch/advance-watcher.mjs:1196-1197`).
   Ten mid-poll `writeFileSync` rewrites could otherwise be read torn -> JSON
   parse failure -> `reason: 'unreadable-state'` -> a key change -> a spurious
   frame. Mirroring the producer removes the flake and keeps the fixture honest.
2. **Test B step B3 keeps `reason: 'busy'`** (plan table said `'stale-build'`).
   B2 sets `reason: 'busy'`; re-writing `'stale-build'` at B3 would move BOTH
   `desiredId` and `reason`, which contradicts the plan's own stated design
   ("exactly one key field moves per step") and would leave M3 unkillable.
   `busy` + a new `desiredId` is a real watcher state (building while master
   moved again).
3. **Test A churns `runningId` as well**, so the test's own title (given
   verbatim by the plan) is accurate. `runningId` is inert for `composeBuild`,
   so this is strictly wider churn with the same key fields held fixed.

4. **B5/B6 added to Test B** (not in the plan). B4 as planned moves `current`
   AND `reason`, so M2 survived. `m2-probe.mjs` found the only input class where
   `current` is independent of (id, desiredId, reason): a deploy-state whose
   `reason` string collides with one of composeBuild's own override names.
   B5/B6 encode it and M2 is red at B6.

## Resolved concern
`current` is NOT redundant in the key — but only on the enum-collision input
(12 of 119 triples, all that shape). For every reason the watcher actually
writes, it is derivable from the other three key fields. Filed as F-1 in the
Lattice comment for Owen/Ruben; no code change made for it here.
