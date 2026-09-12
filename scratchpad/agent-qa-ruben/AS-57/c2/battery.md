# AS-57 review cycle 2 — battery (qa-ruben, 2026-09-12)

Branch tip cf066c8 (5 commits over master, all developer-lena). Master moved only in `.claude/settings.json` (AS-55) since the branch base c00cccf — no seam. Plan and diff read cold; Lena's comments and scratchpad read only after findings were formed (no disagreement found). No daemon review output exists.

Harness: `harness.mjs` (backup to /tmp outside the scanned tree, exit-trap restore, assert-applied at the site, counted run via `apps/chat/bin/compose-run.mjs` with `--build`, restore, `git diff --exit-code`). Every run below has a `Image asc-qa-as57-c2-<n>-test Built` receipt in its log. **17 counted runs, 17 receipts.**

| run | mutant | predicted | observed | match |
|---|---|---|---|---|
| 1 | baseline, clean tip | 532/513/0/19 | 532/513/0/19 | yes |
| 2 | **M6** host `vendor/probe.js` + import from `lib/vendor.js` (cycle-1 F1 plant) | {assets pin, DP#3 a5} 532/511/2 | {assets "3 entries: probe.js, states-ledger.md, tokens.css", DP#3 a5 `['lib/vendor.js']`} 532/511/2 | yes |
| 3 | V1 same file, no import | {assets pin} 532/512/1 | {assets pin} 532/512/1 | yes |
| 4 | V2 dynamic `import('../vendor/probe.js')`, no file | {DP#3 a5} 532/512/1 | {DP#3} 532/512/1 | yes |
| 5 | V3 `lib/` imports `../test/helpers/hash-comment.js` (F2 path) | {DP#3 a5} 532/512/1 | {DP#3} 532/512/1 | yes |
| 6 | V4 `lib/screens/vendor/probe.js` (depth 2) | {DP#3 a0 naming lib/screens/vendor, DP#5} 532/511/2 | same, a0 message confirmed | yes |
| 7 | V5 `vendor/notes/README.txt` (subdir, non-JS) | {assets pin} 532/512/1 | {assets pin} 532/512/1 | yes |
| 8 | V6 symlink `lib/walk -> ../demo` | {DP#3 source list, DP#5} 532/511/2 | {DP#3 "expected 63 found 64: … lib/walk/run.mjs", DP#5 lib/walk/run.mjs:102,163, **concepts-locality STRIPE_ in lib/walk/run.mjs**} 532/510/3 | wider by one — a third independent guard; louder, not a hole |
| 9 | V7 top-level `scripts/seed.js` with fetch | {DP#3, DP#5} 532/511/2 | {DP#3, DP#5} 532/511/2 | yes |
| 10 | M1 `compose.override.yaml` | {DP#3 found 4, DP#5} 532/511/2 | same | yes |
| 11 | M1b explicit 8-line COPY list | {DS-1, DS-demo, DS-ride} 532/510/3 | same | yes |
| 12 | M2 `lib/vendor/probe.js` (depth 1) | {DP#3 a0, DP#5} 532/511/2 | same | yes |
| 13 | M3 `container_name` escaped quote | {DP#5 compose.yaml:32} 532/512/1 | same; deploy-shape green | yes |
| 14 | M5 delete helper escape line | {DP#2, DS-parse} 532/511/2 | same | yes |
| 15 | M4(i) `lib/.DS_Store`, ignored | green, gitignored | green 532/513/0, `!!` in status --ignored | yes |
| 16 | M4(ii) + `**/.DS_Store` line removed | {DS-1, DS-ign, DP#3} 532/510/3 | same | yes |
| 17 | final restored, clean tip | 532/513/0/19 | 532/513/0/19 | yes |

Before pictures for M6 are cycle-1 runs (`../run6-P1-toplevel-vendor.log` green 531/512 on the cycle-1 tip; `../run7-P1-before-master.log` ERR_MODULE_NOT_FOUND on master) — not re-run.

M4(ii) first attempt aborted at assert-applied (my check matched the string `**/.DS_Store` which the comment block also contains); trap restored, tree clean, check corrected to the pattern line, re-run as run 16.

Floor checks (`checks.mjs`): `quote = null` 0/0, both files import the helper; dependency-policy 1,198 lines; 5 COPYs, whole-dir COPY after `RUN npm ci` and before both vendor COPYs (48, 56 — a host `vendor/tokens.css` is overwritten, never shadows); product code / package.json / .lattice diff empty; no new `*.test.js`; no stale phrases; porcelain clean.

Findings outside the list: 0 defects. Residuals recorded (not filed): R1 line cap headroom 2; R2 assertion 5 matches literal specifiers only (computed/`new URL` import evades; vendor/ is covered by the cardinality pin regardless, demo/ and test/ are not) — pre-existing AS-90; R3 top-level FILE named as a SKIPPED_DIRS entry is skipped by the `continue` before the directory check — pre-existing AS-53, theoretical (not ESM-importable without an extension), not built.
Convention: plan 126 lines vs 120 cap (medium) — already noted by the orchestrator.
