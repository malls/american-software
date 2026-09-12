# AS-57 progress (Lena) — resumable

Worktree: .worktrees/AS-57, branch feat/AS-57-closed-world-residuals
Runner: node apps/chat/bin/compose-run.mjs --project asc-impl-as57-<x> --cwd <WT>/apps/invoicing --log <this dir>/<name>.log

## Steps (plan §6)
- [x] 1. baseline 530/511/0/19 (00-baseline); M1 plant on baseline GREEN 530/511/0/19 (01-m1-on-baseline) = before picture
- [x] 2. item 3 -> 531/512/0/19 (02-item3) -> commit 08ddbda
- [x] 3. item 2 -> first run 1205 lines, test #7 red as designed; trimmed to 1195 -> 531/512/0/19 (03-item2) -> commit 36ca22f
- [x] 4. item 4 -> 531/512/0/19 (04-item4) -> commit 074b69d
- [x] 5. item 1 -> 531/512/0/19 (05-item1) -> commit 526f0d1
- [x] 6. mutations, all via `node mutate.mjs <name> <recipe>` (each: assert-applied, run, restore, porcelain empty):
  - M1  (10-m1)   531/510/2/19 red = {DP#3 "expected 3 manifests, found 4: Dockerfile, compose.override.yaml, compose.yaml, package.json", DP#5 "compose.override.yaml:4: fetch — not sanctioned"}
  - M1b (11-m1b)  531/509/3/19 red = {DS-1 "expected 5 COPY instructions, found 12", DS-demo, DS-ride "exactly one COPY sources apps/invoicing whole, found 0"}; dependency-policy green
  - M2  (12-m2)   531/510/2/19 red = {DP#3 "lib/vendor is a SKIPPED_DIRS name below the top level…", DP#5 "lib/vendor/probe.js:1: fetch — not sanctioned"}
  - M3  (13-m3)   531/511/1/19 red = {DP#5 "compose.yaml:32: fetch — not sanctioned"}; deploy-shape green.
        First attempt (13-m3-harness-artefact.*) went 2 red: my compose.yaml.as57bak backup sat inside apps/invoicing and the new closed world flagged it — harness artefact, backups moved to scratchpad, re-run clean.
  - M4i (14-m4i)  531/512/0/19 GREEN, git check-ignore exit 0
  - M4ii(15-m4ii) 531/509/3/19 red = {DS-1 "expected 7 .dockerignore patterns, found 6", DS-ign ".dockerignore must exclude every .DS_Store", DP#3 "lib/.DS_Store is neither app source…"}
        First attempt: MUTATION DID NOT APPLY (exit 99) — assert was a whole-file grep for DS_Store and my .dockerignore comment names it; assert tightened to the pattern line, re-run.
  - M5  (16-m5)   531/510/2/19 red = {DP#2, DS-parse}
- [x] 7. final run (20-final) 531/512/0/19, Image asc-impl-as57-20-final-test Built; porcelain clean; AC 1/6/11/12 checked (see lattice comment)

## Deviation to report
Predicted counts were 530/511/0/19 throughout; actual is 531/512/0/19 from item 3 on. Cause: `node --test`
bare runs every .js under test/** as a file-level test — the five existing helpers already each count
as one pass (baseline log lines 324-328); the sixth helper file adds +1/+1. Mechanical, explained,
not absorbed. Every mutation's expected set shifts by +1 tests/+1 pass accordingly.

## Cycle 2 (Ruben's findings, plan § Review Cycle 1 Findings) — runs are `c2-*`
- [x] 0. F1 reproduced: c2-00-p1-prefix on 526f0d1 GREEN 531/512/0/19 (the hole); c2-00-p1-master (p1-master.mjs, detached
      worktree at 8f88b53, removed after) LOUD 151/119/20/12 ERR_MODULE_NOT_FOUND
- [x] 1. F1 fix committed cf066c8: assets.test.js new test pins readdir(/app/vendor) == exactly the two registered files;
      DP#3 assertion 5 regex widened to every SKIPPED_DIRS name (closes F2); SKIPPED_DIRS comment corrected; F4 fixed;
      README V2b row names the falsifier. dependency-policy.test.js 1198 lines.
- [x] 2. c2-01-fix 532/513/0/19 (+1 test: the new assets test())
- [x] 3a. p1 (c2-10-p1) 532/511/2/19 red = {assets "vendor/ holds 3 entries, expected 2: probe.js, states-ledger.md, tokens.css", DP#3 assertion 5 actual ['lib/vendor.js']}
      p1a vendor file only (c2-11-p1a) 532/512/1/19 red = {assets vendor pin}
      f2 lib imports test/helpers/stripe-double.js (c2-12-f2) 532/512/1/19 red = {DP#3 assertion 5 actual ['lib/vendor.js']}
- [x] 3b. m1, m1b, m2 (c2-20-*), m3, m4i, m4ii, m5 (c2-21-*) — all at the cycle-1 sets, +1/+1
- [x] 4. final c2-30-final 532/513/0/19 Built; porcelain clean; plan counts + AC 14 (M6) edited in MAIN checkout
      (uncommitted — Owen commits board state); lattice comment recorded. Status untouched (Owen moves to review).

## Log
