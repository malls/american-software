Implementation (developer-marcus, tick watcher:79108 loop tick 1, **on Opus under the Fable-limit fallback** — Fable refused the spawn at HTTP 429). Branch `feat/AS-126-favicon-filter-door` from 8e68358, worktree `.worktrees/AS-126`. Built §2 verbatim (title, regex, presence assert, message naming the match); only the comment wording is mine. Test-only. Log: `scratchpad/agent-developer-marcus/AS-126/` (mutants.log, compose.log, mutants.mjs driver).

**Findings outside the plan — none blocking; four records:**
1. Diff is +17/−0, not the plan's "roughly +12": my comment block is seven lines to the plan's five. Nothing else differs from §2.
2. G1 (the guard-on-guard) reports `found "null"` when the assertion is inverted — the message interpolates `door && door[0]` and `door` is null on the unmutated favicon. Expected for a tautology check, not a T5 defect: on the real red path `door` is always a match. Left as §2 wrote it.
3. Master moved during the stage: a0644f5 merged AS-125 (+2 tests in `roster-truncation.test.js`, master host 616/614/0/2 per its done comment), then b18c281. Per instruction I did NOT merge master into the branch, so the branch's counts are its base (613) + 1 = 614; the post-merge master expectation is 617/615/0/2 host. `merge-tree --write-tree master feat/AS-126-favicon-filter-door` against b18c281 wrote tree b96bcbb with no conflict.
4. My battery driver had two defects of its own on the first pass — the reviewer should know the first two logs were discarded. (a) It parsed TAP `not ok` lines but node's non-TTY default here is the `spec` reporter (`✖ failing tests:`), so every red run showed the right fail count (1) with an empty name set; (b) `git checkout master -- api.test.js` stages, and `git diff --name-only` without `HEAD` hid the swap on the controls, which threw before the restore and left the scratch dirty (`M favicon.svg`, `M  api.test.js`) — reset --hard'd before the next pass. Both fixed (parser reads the spec section; diffs are against HEAD). The mutants.log on disk is the third, complete pass; every run in it started from an asserted-empty porcelain and ended in one.

**Receipts (cardinality first).**
- Host, `$W/apps/chat`, 41 test files: **614 / 612 / 0 / 2**, exit 0 (base 613 + T5). Favicon subset (`--test-name-pattern favicon test/api.test.js`): **5 / 5**.
- Battery: **13 runs, 13 predictions matched, 0 mismatches, 0 survivors.** Scratch = detached worktree `/tmp/AS-126-mutant` at 1b9ac57; each run asserted the token 0→1 on the anchored line (anchors chosen to survive the mutation: `cx="9" cy="13"` for line 6, `d="M6 3h20a4` for line 5, `AS-28 tab marker` for the comment) and `diff HEAD --name-only` = exactly the expected files; full host suite per run; `reset --hard` + empty porcelain after each. Hunks are in mutants.log; the applied lines were:
  - M1 `<circle fill="#FFFFFF" filter="drop-shadow(0 0 1px red)" cx="9"…` → 614/611/1/2, red **{T5}** `found "filter="` — predicted {T5}, match.
  - M1-control (M1 + master's api.test.js, staged swap visible in the hunk as −T5) → **613/611/0/2 all green** — the hole observed, match.
  - M2 `<defs><filter id="f"><feColorMatrix type="hueRotate" values="180"/></filter></defs>` + `filter="url(#f)"` on the path → red **{T5}** `found "<filter"` — match; T3 green (paintless primitive).
  - M2-control → **613/611/0/2 all green** — N3's P9 survivor observed, match.
  - M3 `FILTER="…"` → {T5} `found "FILTER="` — match.
  - M4 `filter = "…"` → {T5} `found "filter ="` — match.
  - M5 `filter='…'` → {T5} `found "filter="` — match.
  - M6 `style="filter:drop-shadow(…)"` → red **{T3}** `the artwork declares no style="" attribute`, **T5 green** — match; T5 does not annex the style ban.
  - M7 `color-interpolation-filters="linearRGB"` on the path → **614/612/0/2 all green** — match (no over-reach on the `-filters=` suffix).
  - M8 `filter="drop-shadow(…)"` inside the XML comment → **614/612/0/2 all green** — match.
  - R1 `<set attributeName="fill" to="red"/>` inside the path → red **{T4}** `found <set>`, T3/T5 green — match.
  - G1 `assert.ok(!door,` → `assert.ok(door,` in T5, favicon unmutated → red **{T5}** — match (record 2 above on its message).
  - Control (unmutated tip) → **614/612/0/2** — match.
- Compose, `compose-run.mjs --project asc-impl-as126 --cwd $W/apps/chat`: `Image asc-impl-as126-test Built`, **614 / 606 / 0 / 8**, run exit 0, down exit 0, leak check clean (0 networks, 0 images). Skip delta +6 vs host, the standing shape. `--check` afterwards: 3 asc-* networks, all production, no leftovers.
- Seam: merge-tree vs master b18c281 clean (record 3). `git diff --stat master...branch` = `apps/chat/test/api.test.js | 17 +` only; `favicon.svg` byte-identical to master (empty diff). `/tmp/AS-126-mutant` removed; `$W` porcelain empty. Zero new dependencies.

**Acceptance sweep (floor check, after the findings above): 11 / 11** — AC1 title/position/presence/message + 614/612/0/2 + subset 5; AC2 M1 {T5} `filter=` + control 613 green; AC3 M2 {T5} `<filter` + control 613 green; AC4 M3/M4/M5 {T5}; AC5 M6 {T3}, T5 green; AC6 M7/M8 green at 614/612/0/2; AC7 R1 {T4}; AC8 G1 {T5}; AC9 test-only, favicon identical; AC10 Built line + 614/606/0/8; AC11 nothing left behind. The AS-83 mode.test.js flake did not occur (no re-run needed).

Commit **1b9ac57** `AS-126: the favicon guard rejects a filter element or filter= attribute (api.test.js T5)` as developer-marcus. Status unchanged — the orchestrator moves it to review (`--no-auto-review`). Priya: do not read this comment or my scratchpad before your own findings are written.
