# AS-35 mutant table (Marcus, branch tip 5343f61)

Host suite: `node --test 'docs/design/tokens/*.test.mjs'` in `.worktrees/AS-35`, Node v24.13.1.
Green before: 35/35 (master). Green after: 39/39 (branch). No compose receipt applies — no
image's build context includes `docs/`.

Script: `falsify.mjs` (in place, byte backup, finally-restore, site asserted by occurrence
count and by `git diff` being dirty, exact failing-test set parsed from the reporter, then
`git -C .worktrees/AS-35 diff --exit-code` after restore). Logs: `falsify.log`,
`falsify-verbose.log` (full suite output per mutant), `mutant-table.json`.

Key: T-A cascade structure · T-B block selectors · T-C block 3 media/guard · T-D parser guard.

| Mutant | AC | Mutation | Run (tests/pass/fail) | Predicted red | Observed red | Restored |
|---|---|---|---|---|---|---|
| M1 | 2 | block-4 `[data-theme="dark"]` → `[data-theme="drak"]` (Priya's R1 demo) | 39/38/1 | {T-B} | {T-B} | clean |
| M2 | 3 | block-2 `:root,\n[data-theme="light"]` → `:root` | 39/38/1 | {T-B} | {T-B} | clean |
| M3 | 4 | block-3 `prefers-color-scheme: dark` → `light` | 39/38/1 | {T-C} | {T-C} | clean |
| M4 | 5 | block-3 guard `:root:not([data-theme="light"])` → `:root` | 39/38/1 | {T-C} | {T-C} | clean |
| M5 | 6 | swap rule text of blocks 3 and 4, markers in place | 39/36/3 | {T-B,T-C} first run → amended {T-A,T-B,T-C} | {T-A,T-B,T-C} | clean |
| M6 | 7 | append fifth top-level rule `html { }` | 39/38/1 | {T-A} | {T-A} | clean |
| M7 | extra | move the `[data-theme="dark"]` rule above the BLOCK 4 comment header | 1/0/1 (module load) | — | whole file: existing floor "block 4 parsed to zero declarations" throws first | clean |
| M8 | 8 | test file: `parseTopLevelRules` returns `[]` instead of throwing on zero rules | 39/38/1 | {T-D} | {T-D} | clean |

M1 is the gap being closed: the 35 pre-existing tests all stay green under it; only T-B goes red.

M5 wider than first predicted: T-A parses rule 3's body for its nested rule; a bare
`[data-theme="dark"]` body has none, so the fail-loud parser throws inside T-A. Plan
criterion 6 amended on master (396ddf1); the test was kept strict.

M7 shows the marker-join assertion in T-A is not independently observable today — the
pre-existing module-level floor fires first. Not a defect; recorded so the reviewer
does not mistake it for a weak guard.

Final restored run: 39/39/0, `git diff --exit-code` clean.
