VERDICT: PASS (code half). Per plan §7 the task goes to needs_human, not done — AC-3/AC-4 are host observations. Reviewer: agent:qa-ruben, cold; the implementer's comment was read LAST, after every number below was recorded.

FINDINGS FIRST — 3 findings outside the criteria list (0 defects blocking, 1 defect minor/non-blocking, 2 convention):

F1 [defect, minor, non-blocking] T1's label/basename rule is computed leniently: `LABEL_PREFIX + basename.replace(LABEL_PREFIX, '')` strips the prefix and re-adds it, so a template named `lattice-dashboard.plist.template` with Label `com.american-software.lattice-dashboard` satisfies the assertion. Observed on M-ENUM: T1 went red on the hard-coded filename list (`expected exactly 2 ... found 2: ...advance-watcher..., lattice-dashboard.plist.template`), NOT on the Label rule the plan §5 predicted. Same red set, different mechanism; the enumeration assert covers the hole today, so not blocking. One-line fix for the next touch of this file: `const base = file.replace(/\.plist\.template$/, ''); assert.ok(base.startsWith(LABEL_PREFIX)); assert.equal(plist.Label, base)`. Not fixed inline: it would require a compose-grade re-run I did not have budget for and the guard's behaviour on the committed tree is unchanged by it.

F2 [convention, owner: plan author] AC-9 says the §7 handoff's sed/plutil/bootstrap lines are byte-identical to the README Install block. They are token-identical but not byte-identical: §7 wraps the sed over 3 lines, README over 5. Diffed by eye; every substitution expression, path and flag matches. Recorded, not a verdict input.

F3 [convention, owner: orchestrator/tick] Board commit daa8183's message carried the implementer's suite count and mutant tally ("297/297; 9/9 mutants red") into master's git log, which is in the reviewer's session snapshot before the diff is opened. That is the AS-36 anchoring leak through the board-commit plane. My numbers were measured independently (below) and happen to agree; the leak is invisible afterwards, which is the point. Proposed rule: board-state commit messages at the `review` transition describe what is on the branch, not the implementer's measured results.

M6 probes past the list (4): (a) M-ENUM mechanism above; (b) parser duplicate-key handling — T4 carries a `duplicate key` case and the reader throws `plist: duplicate <key>`; the positive-parse control in T4 shows "everything throws" is not what passes; (c) `git diff master...feat/AS-94-dashboard-launchd -- apps/chat/README.md` shows exactly one hunk, the §4.2 paragraph — env-table row and AS-93 prose byte-identical to master; (d) no file outside the four in the plan changed (Dockerfile, compose.yaml, deploy-shape.test.js, advance-watcher.mjs, watcher template all untouched). Not probed (time): T3 block-order swap; `|` in REPO_ROOT (README now names it in Prerequisites-adjacent prose, which is the plan's suggested handling).

SUITE (AC-6): `docker compose -f .worktrees/AS-94/apps/chat/compose.yaml -p asc-as94-ruben --profile tools run --rm --build test` — receipt line `Image asc-as94-ruben-test Built`; cardinality 297 tests, 297 pass, 0 fail, exit 0. The branch adds one test file with 4 `test()` calls (node-grade run of that file alone: 4/4), so master baseline is 293 by subtraction; I did not spend a second compose run measuring master directly.

MUTANTS (AC-7), node --test grade on a detached scratch worktree (.worktrees/AS-94-mutant, removed after), each asserted applied with `git diff --stat`/`status --porcelain` naming exactly the intended file, each restored with `git checkout -- .` (M-ENUM: `reset --hard`), task worktree proven clean with `git diff --exit-code`:
  M-AC1 (drop </array>) -> {T1,T2} = predicted
  M-AC2a (0.0.0.0) -> {T2} = predicted; failure message reads "bind stays 127.0.0.1 — tailnet reach is Tailscale serve only (CTO decision 1)"
  M-AC2b (8800) -> {T2} = predicted
  M-AC2c (cwd apps/chat) -> {T1,T2} = predicted
  M-AC2d (ADVANCE_REPO_ROOT env) -> {T2} = predicted
  M-KEEPALIVE (<false/>) -> {T1} = predicted
  M-LEFTOVER (__EXTRA__) -> {T1,T2,T3} = predicted
  M-RECIPE (__LATTICE__ in README) -> {T3} = predicted
  M-ENUM (rename) -> {T1,T2,T3} = predicted set, mechanism differs (F1)
  9/9 sets exactly as predicted. Mutants were NOT re-run compose-grade (sandbox denies env-prefixed/compound commands and the time budget was 22 min); the compose run above is the branch tip, not a mutant, so no stale-image hazard applies.

FLOOR CHECK (acceptance criteria sweep, second, labelled as such — 6 of 9 verifiable in a tick, all 6 pass; 3 deferred to the host):
  AC-1 in-suite half: T1+T3 green, M-AC1 red on exactly {T1,T2}. plutil half deferred to the bootstrap record (no plutil in a tick).
  AC-2: T2 green with the exact six-element array; M-AC2a red on {T2}; tree clean. All other §5 rows observed as listed.
  AC-3: deferred — host observations, needs_human.
  AC-4: README carries "ONE owner", "Do not run `lattice dashboard` beside it", pre-bootstrap stop step with `lsof -nP -iTCP:8799 -sTCP:LISTEN` and `pgrep -fl 'lattice dashboard'`. Bind-failure quote deferred to the host.
  AC-5: watch/README.md gains the section with the six mirrored headings in order (Prerequisites, Install (launchd), Uninstall / restart, After any change..., Troubleshooting, + three-legged block) plus two Files-table rows; chat README paragraph replaced with the AS-10 rationale intact. Install blocks side by side: dashboard adds LATTICE_BIN in place of NODE_BIN, the lsof/pgrep/kill pre-step, mkdir -p, plutil -lint, and a curl 200 check in place of the watcher's tail -f; PATH is `$(dirname "$LATTICE_BIN"):/usr/bin:/bin` vs the watcher's node+claude dirs. Every other line matches in shape.
  AC-6: pass, receipt quoted above.
  AC-7: pass, table above.
  AC-8: no asc-as94-* image left (removed), no /tmp/AS-94-* (a /tmp worktree was created and removed within this review; sandbox refused reads there, so the scratch copy moved to .worktrees/AS-94-mutant, also removed), `git worktree list` = master, AS-94, AS-95 (AS-95 is the parallel lane, not mine), no launchd job installed, dashboards untouched — `pgrep` quote appended to the Lattice comment if the sandbox allowed it.
  AC-9: token-identical, see F2.

Inline fixes on the branch: none. Level: no rework. Route: needs_human with the §7 handoff.
