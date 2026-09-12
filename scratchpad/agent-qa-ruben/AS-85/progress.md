AS-85 review — qa-ruben — 2026-09-11 tick watcher:93997 loop tick 24
cold pass: diff read (server.js +reason in loopStateKey; stream.test.js +2 tests, B5/B6 added beyond plan; B3 uses reason 'busy' not plan's 'stale-build' — correct isolation).
host (scratch copy of worktree, 33 files): 500/500/0 — plan predicted 500. compose asc-review-as85: "Image asc-review-as85-test Built", 500/500/0, down exit 0.
battery (scratch copy /tmp/as85-scratch, anchor count 1->0, mutant present 1, diffs in mutant-*.diff, runs in run-*.txt):
 M1 checkedAt -> {A} at "zero frames across ten polls" (plan: exactly {A}) OK
 M2 no current -> {B} at B6 (plan said B4; B4 also moves reason via stale-state override — plan criterion stale, impl B5/B6 correct)
 M3 no desiredId -> {B} at B3 OK
 M4 no reason -> {B} at B2 OK
 M5 build:null -> {A,B} (A at step 5 sanity positive? observed B1 + A) OK
 F1 no buildId (shared boot opts) -> {A,B} on-connect assertion OK
 F2 same computedAt -> {A} "checkedAt really moved" OK
 X1 no id (extra, M6) -> survives: id is the baked constant, cannot move at runtime; not a finding
worktree diff --exit-code clean after battery (battery never touched the worktree).
M6: watcher reason values enumerated (busy,no-git,inputs-dirty,current,no-docker,cooldown,stale-build,watcher-source-changed) — none carry per-poll data. tmp+rename atomic. F2 proves the file must change.
remaining: read Lena's comment, post review comment. verdict leaning PASS with non-blocking findings.
