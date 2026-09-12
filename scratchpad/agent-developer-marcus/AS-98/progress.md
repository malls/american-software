# AS-98 progress — agent:developer-marcus (tick watcher:86819, loop tick 11)

Started 21:18Z; cutoff ~21:46Z.

- [x] test/link-sites.test.js written (T8/T9/T10/T11) — f4ad8c2
- [x] T7a/T7b edits in api.test.js — f4ad8c2
- [x] host suite green: 554 / 553 pass / 0 fail / 1 skipped (post-AS-88 baseline 550 → +4 as predicted)
- [x] README paragraph — 156faa5
- [x] mutants M1..M11 + M11-revert + AC-5 extra, host runs in /tmp/AS-98-mutant (mutants.log); worktree removed
- [ ] compose --build receipt (-p asc-impl-as98) — running (compose.log)
- [ ] lattice comment + review, #engineering post

Mutant results (host, `node --test test/link-sites.test.js test/api.test.js` in the scratch worktree):
M1 {T7,T8,T10} ✓; M2 {T9,T10} ✓; M3 {T9,T10} ✓; M4 {T7,T8} ✓; M5 {T7,T8} ✓; M6 {T8} ✓; M7 {T8} ✓;
M8 {T7,T8,T10} ✓ (T7 message names rosterRow); M9 {T8} ✓; M10 {T9} ✓;
M11 predicted GREEN, observed {T8,T11} — WIDER (count pin 10≠9 + T11's `shadow.href = url;` now accepted); M11-revert {T8} ✓; AC-5 extra {T11} ✓.
Every mutant: marker 0->1, one-file diff-stat (M11: two), anchor count 1->1 (M8: 1->0), restored, diff --exit-code clean.

Notes:
- anchors on branch: A-panel app.js:718, A-roster app.js:457, A-body `function bodyNode(message) {` app.js:254
- T11 reading: "count 4" for the four allowed shapes; "5 accepted" = 4 allowed + the comparison input.
- compose file is apps/chat/compose.yaml (not docker-compose.yml).
