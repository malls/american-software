# AS-57 review battery — qa-ruben, 2026-09-12

Branch `feat/AS-57-closed-world-residuals` at 526f0d1 (4 commits over master fba4766, all `developer-lena`).
Plan and diff read cold. Implementer comment, implementer scratchpad, planner mutation list, daemon output: not read.
Unavoidable exposure: `lattice show AS-57` prints the orchestrator's transition commit message, which names the
implementer's final count. My counts below are my own runs.

Runner: `node apps/chat/bin/compose-run.mjs --project asc-qa-as57-<n> --cwd .worktrees/AS-57/apps/invoicing`
(every run `--build`; receipt = `Image asc-qa-as57-<n>-test Built`). Scripts `m*.sh`, `p*.sh`, `checks.sh` here are
the exact recipes (backup outside the tree in /tmp, `trap` restore, assert-applied, run, restore, porcelain + diff clean).

## Counted runs (cardinality: 13 runs, 13 receipts)

| run | what | receipt | tests/pass/fail/skip | red set observed | predicted (plan, +1/+1 for the helper file) |
|---|---|---|---|---|---|
| 1 | baseline, branch tip | `Image asc-qa-as57-1-test Built` | 531/512/0/19 | — | 530/511/0/19 (see F3) |
| 2 | M1 `compose.override.yaml` outbound healthcheck | `Image asc-qa-as57-2-test Built` | 531/510/2/19 | {DP#3 "expected 3 manifests, found 4", DP#5 `compose.override.yaml:4: fetch`} | same — MATCH |
| 3 | M1 before-picture: same plant on **master** (detached worktree /tmp/asc-qa-as57-master @ fba4766) | `Image asc-qa-as57-3-test Built` | 530/511/0/19 | — (green: the blind spot) | same — MATCH |
| 4 | M1b explicit 8-line COPY list restored | `Image asc-qa-as57-4-test Built` | 531/509/3/19 | {DS-1, DS-demo, DS-ride} | same — MATCH |
| 5 | M2 `lib/vendor/probe.js` with fetch | `Image asc-qa-as57-5-test Built` | 531/510/2/19 | {DP#3 "lib/vendor is a SKIPPED_DIRS name below the top level…", DP#5 `lib/vendor/probe.js:1: fetch`} | same — MATCH |
| 6 | **P1 (past the list)** host `apps/invoicing/vendor/probe.js` (fetch) + `import` from `lib/vendor.js` | `Image asc-qa-as57-6-test Built` | **531/512/0/19** | **none — GREEN** | (my prediction: green) — F1 |
| 7 | P1 before-picture on **master** | `Image asc-qa-as57-7-test Built` | 151/119/20/12 | `ERR_MODULE_NOT_FOUND: Cannot find module '/app/vendor/probe.js' imported from /app/lib/vendor.js` — loud | loud — F1 is a regression |
| 8 | M3 `container_name: "asc-inv \" # fetch('https://example.invalid/')"` | `Image asc-qa-as57-8-test Built` | 531/511/1/19 | {DP#5 `compose.yaml:32: fetch`}; deploy-shape green | same — MATCH |
| 9 | M5 helper escape line deleted | `Image asc-qa-as57-9-test Built` | 531/510/2/19 | {DP#2, DS-parse} | same — MATCH |
| 10 | M4(i) `lib/.DS_Store` planted; `git check-ignore -q` exit 0 | `Image asc-qa-as57-10-test Built` | 531/512/0/19 | — (green) | same — MATCH |
| 11 | M4(ii) same + `**/.DS_Store` removed from `.dockerignore` | `Image asc-qa-as57-11-test Built` | 531/509/3/19 | {DS-1 "expected 7 patterns, found 6", DS-ign "must exclude every .DS_Store", DP#3 "lib/.DS_Store is neither…"} | same — MATCH |
| 12 | P2 (past the list) dotfile `.probe.yaml` + symlink `lib/alias -> ../demo` | `Image asc-qa-as57-12-test Built` | 531/509/3/19 | {DP#3 "found 4: .probe.yaml…", DP#5 `.probe.yaml:4` + `lib/alias/run.mjs:102,163`, concepts test} — loud | loud — OK |
| 13 | final restored run, branch tip, porcelain clean | `Image asc-qa-as57-13-test Built` | 531/512/0/19 | — | — |

After every mutation: `git status --porcelain` empty and `git diff --exit-code` clean (printed as `TREE CLEAN after restore`
in each script's output). Restored trees were byte-identical to the tip, so run 13 is the restored-green evidence for all.
Leak check after run 13: 0 networks / 0 images for every `asc-qa-as57-*` project. `/tmp/asc-qa-as57-master` removed.

## Mechanical checks (`checks.sh`)
- AC6: `grep -c "quote = null"` = 0 in both test files. AC11: 1,195 lines (5 under the cap). AC1: 5 `COPY`s; `COPY apps/invoicing ./` after `RUN npm ci`.
- Host-side `apps/invoicing/vendor/x.js` is NOT gitignored (committable) — relevant to F1.
- 4 commits, all `developer-lena <developer-lena@agents.american-software.local>`; `git diff --stat master...HEAD -- .lattice` empty;
  product-code/package.json diff stat empty.

## Findings
**F1 — DEFECT (behaviour: reachable hole; regression vs master).** The whole-directory COPY now ships a host-side top-level
`apps/invoicing/vendor/` into `/app/vendor`, where `SKIPPED_DIRS` skips it at depth 0. Run 6: an outbound `fetch` there,
imported by runtime code (`lib/vendor.js`), boots with the app and the suite is green. Run 7: on master the same plant
cannot even load (`vendor/` never reached the image). Nothing pins `/app/vendor`'s contents (assets.test.js pins
`VENDOR_ASSETS`, a route list, not the directory); test #3 assertion 5 forbids imports from `demo/` only. The
`SKIPPED_DIRS` comment (lines 303–305) states the belief that hid this — "vendor/ … exists only inside the image … what lands
there is bounded by VENDOR_ASSETS" — false on both counts (`states-ledger.md` lands there and is not in VENDOR_ASSETS).
Contradicts plan §2 "a developer's stray file in apps/invoicing/ is now loud in the suite".
Fix (implementation-level): (a) pin the image's `vendor/` as its own closed world — exact list `['states-ledger.md','tokens.css']`
(cardinality 2 first). `dependency-policy.test.js` sits at 1,195/1,200, so the natural home is `assets.test.js` (already
the vendored-asset pin) or a comment trim; (b) widen assertion 5's specifier regex from `\bdemo\/` to every
`SKIPPED_DIRS` name so no skipped directory is an import path for app code; (c) fix the comment; (d) new mutant = run 6's
plant → red, recorded with its exact set.
**F2 — hardening residual (pre-existing, analytical, not run).** `lib/` → `'../test/helpers/…'` is the same unguarded
import path (assertion 5's regex matches only `demo/`); `test/helpers/stripe-double.js` carries `fetch`. Closed by F1(b).
**F3 — plan prediction miss, not a defect.** 531/512 vs predicted 530/511: node's default `**/test/**/*.js` glob executes
every `test/helpers/*.js` as a file-level test (run 1 log line 307: `✔ test/helpers/hash-comment.js`). Explained.
**F4 — convention/comment nit.** UNSCANNED comment line 292 still says "the suite must pass in both places" (host and image)
while the plan and README say no host run exists; same block was edited in this diff.

## Criteria sweep (floor check) — 13 examined, 13 pass, with F3's +1/+1 shift on every count
1 pass (5 COPYs, order; suite green on built image) · 2 pass (run 2; before-picture run 3) · 3 pass (run 4) · 4 pass (read) ·
5 pass (run 5) · 6 pass (grep 0/0) · 7 pass (cases present in diff; green in run 1) · 8 pass (run 8) · 9 pass (run 9) ·
10 pass (runs 10, 11; check-ignore 0) · 11 pass (1,195 lines; test #7 green; no new `*.test.js`) · 12 pass (run 13; clean after
each; no `.lattice/`; product diff empty) · 13 pass (Dockerfile comments, README row, UNSCANNED README.md wording).
Findings outside the list: 4 (1 defect, 1 residual, 1 prediction miss, 1 nit).
