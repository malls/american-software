# AS-130 progress — developer-lena (tick watcher:79108 loop 2 tick 3)

Worktree: .worktrees/AS-130, branch feat/AS-130-demo-recapture (tip 0188fd7). Plan: .lattice/plans/task_01M2B3PVWXKVZCNKADEM7JGY6K.md

- [x] 1. serve.mjs + compose.capture.yaml + README sentence (91522f1)
- [x] 2. run.mjs prose + PRINT html branch + build.mjs BLOCK_SHA256/F3 (d7c2576, same commit)
- [x] 3. capture.mjs walk + serve.mjs ledger port (958be42)
- [x] 4. build.mjs seven-screen layout (d7c2576)
- [x] 5. transcript run + serve/capture run + build + commit docs/demo/d1 (bafcf0a — 34 PNGs, not 36: the plan's §2 table sums to 34)
- [x] 6. test + contract suites (--build, receipts) + AC-7/8 diffs — battery.md
- [x] 7. falsifiers AC-1..5, 9, 10 red sets + AC-11/12/13 evidence — battery.md
- [x] 8. SKILL.md (0188fd7)
- [x] 9. docker torn down (asc-impl-as130, asc-impl-as130-master; --profile tools for stripe-mock)
- [ ] 10. Lattice comment + review status

Deviations to state in the comment: 34 vs 36 PNGs (table count); serve.mjs ledger port 8350 (ids for the two events — no screen renders them, the plan did not say how to obtain them); CANNOT Stripe bullet reflowed to the block's line width, words as the plan gives them.

# Rework cycle 1 (tick watcher:23610 loop 3 tick 5) — from tip 0188fd7

Findings routed (plan ## Review Cycle 1 Findings + orchestrator triage):
- [ ] F1 SKILL.md step 2 teardown -> `docker compose --profile tools -p asc-capture-<n> -f apps/invoicing/compose.yaml -f .claude/skills/d1-demo-artifact/compose.capture.yaml down -v --remove-orphans` + one sentence (both flags, why); step 1's `docker compose down` -> `docker compose --profile tools down`
- [ ] O1 demo/README.md serve.mjs sentence names the loopback-only GET /stripe-requests ledger on 8350, read by the capture
- [ ] R1 demo/README.md line 7: the mock needs --profile tools to come down
- [ ] Observe the step-2 teardown: after the new line, docker ps -a --filter name=asc-capture-<n> empty, 8349/8350 free, both networks gone (measure; also the old line as the red)
- [ ] test + contract --build receipts; AC-7 diff empty; AC-1 build.mjs on committed docs/demo/d1 still `34 of 34` + cmp index.html
- [ ] Lattice comment (no status change)

## Rework cycle 1 — result (tip 9df8ee5)
- [x] O1 + R1 (demo/README.md) committed 9df8ee5: ledger listener on 8350 named (GET /stripe-requests, container 0.0.0.0, host loopback only); `docker compose --profile tools down`; teardown flags named.
- [ ] F1 SKILL.md — NOT APPLIED: Edit on .worktrees/AS-130/.claude/skills/d1-demo-artifact/SKILL.md refused by the permission system ("sensitive file"), same as Ruben. Not worked around. Corrected file: scratchpad/agent-developer-lena/AS-130/SKILL.md (was cmp-identical to 0188fd7's before the edit); diff: SKILL.md.rework.diff. Orchestrator applies with `cp scratchpad/agent-developer-lena/AS-130/SKILL.md .worktrees/AS-130/.claude/skills/d1-demo-artifact/SKILL.md` and commits as AS-130.
- [x] F1 observed (rework-teardown.log): old step-2 line `down -v` exits 0 -> 2 containers, 2 networks, 8349+8350 held ("Resource is still in use"); new line `--profile tools ... down -v --remove-orphans` -> 0/0/0/0, twice.
- [x] Discriminator (rework-discriminator.log): a `down` that loads the compose file (any `-f`; H same cwd) skips profiled demo/stripe-mock; `-p` with no `-f` (F/G, and the -p transcript run) rebuilds the project from labels and takes the mock. The literal step-1 line (no -p, no -f) resolves to project asc-invoicing (name: pinned) — NOT run: asc-invoicing-stripe-mock-1 (AS-90 worktree, up 12h) is a container I did not start. `--profile tools down` removed the mock in every shape measured.
- [x] Suites: test 524/505/0/19 Image asc-rework-as130-suite-test Built; contract 524/524/0/0 Image asc-rework-as130-suite-contract Built (rework-suite-*.log). AC-7 diff empty. AC-1 build: digest ok, 13 headers/13 labels, 34 of 34, 7 screens, cmp byte-identical. Fresh demo run (asc-rework-as130-t, Image Built, exit 0) normalised byte-identical to committed transcript; not-built|404s = 0.
- [x] docker: no asc-rework-as130* containers/networks/images left.
- [x] Lattice comment posted (rework-comment.txt); status untouched; .lattice/ mutation left for the orchestrator to commit on master
