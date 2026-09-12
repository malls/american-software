# AS-35 review — mutant table (qa-ruben, 2026-09-12)

Branch `feat/AS-35-token-block-selectors`; reviewed tip 5343f61, trivia commit df7e5c8 (battery re-run identical on df7e5c8).
Suite command: `node --test .worktrees/AS-35/docs/design/tokens/tokens.test.mjs` (Node v24.13.1, host run).
Master baseline (`01-master-baseline.log`): 35/35. Tip (`00-tip-suite.log`, `04-post-trivia-suite.log`): 39/39, `git diff --exit-code` clean after each run.
Compose: no `--build` receipt applies. `apps/invoicing/Dockerfile:47` COPYs `docs/design/tokens/tokens.css` from a repo-root context (so the plan's "no compose image's build context includes `docs/`" is imprecise), but `tokens.css` is untouched on this branch and no image copies `tokens.test.mjs` — no image input changed.

Method: mutations applied in scratch trees under `mutants/<name>/` copied from the worktree (the suite resolves inputs relative to its own file, so a three-deep scratch tree is faithful). The worktree was never written by the battery; `git diff --exit-code` + `status --porcelain -- docs` checked clean after every mutant. Each mutant asserted its target's occurrence count in pristine before applying and that the file changed; applied diffs in `mut-<name>.diff`, full logs in `mut-<name>.log`, machine table in `mutant-table.json`. Harness: `mutate.mjs`.

Names: T-A = cascade structure (4 rules, marker join, declarations), T-B = block 1/2/4 selectors, T-C = block 3 media + inner rule, T-D = parser guard fixture. LOAD = module-load failure (Node reports `tests 1 fail 1` naming the file; exit 1).

## Plan criteria (7 mutants examined, 7 red sets matched exactly)

| # | mutant | site | predicted | observed | fail count |
|---|---|---|---|---|---|
| 2 | c2-block4-drak | `[data-theme="dark"] {` → `drak` (1 occurrence) | {T-B} | {T-B} | 1/39; other 38 incl. all 35 legacy green. Master test file vs same mutant: 35/35 green (`03-master-test-vs-drak.log`) — the gap, seen from both sides |
| 3 | c3-block2-root-only | `:root,\n[data-theme="light"] {` → `:root {` | {T-B} | {T-B} | 1/39 |
| 4 | c4-media-light | `prefers-color-scheme: dark` → `light` | {T-C} | {T-C} | 1/39 |
| 5 | c5-block3-bare-root | `:root:not([data-theme="light"]) {` → `:root {` | {T-C} | {T-C} | 1/39 |
| 6 | c6-swap-rules-3-4 | rule texts of blocks 3 and 4 swapped, markers in place (82 diff lines) | {T-A,T-B,T-C} (amended) | {T-A,T-B,T-C} | 3/39; T-A's red is the parser throwing "no rules found" on block 3's body — the amendment's stated mechanism is what I observed |
| 7 | c7-fifth-rule-appended | `html { }` after block 4 | {T-A} | {T-A} | 1/39 |
| 8 | c8-parser-no-throw-zero-rules | zero-rules throw removed in a scratch copy of the test file | {T-D} | {T-D} | 1/39 ("Missing expected exception") |

## Probes past the list (21 examined)

| mutant | what | observed | reading |
|---|---|---|---|
| p1-fifth-rule-between-2-and-3 | `html { }` inserted before block 3 marker | {T-A,T-B,T-C} | red; count 5 and every index shifted |
| p2a-block2-one-line | `:root, [data-theme="light"]` on one line | {} green | normalisation intended: formatting is not structure |
| p2b-block2-odd-spacing | `:root ,\n\n\t[data-theme="light"]   {` | {} green | same |
| p2c-block4-unquoted | `[data-theme=dark]` (CSS-equivalent) | {T-B} | literal pin by design — brittle to a legal rewrite, which the test comment states is the intent |
| p2d-block4-space-around-eq | `[data-theme = "dark"]` (CSS-equivalent) | {T-B} | same |
| p3-comment-inside-selector | `:root, /* light scope */ [data-theme="light"]` | {} green | comments blanked before parsing |
| p3b-comment-with-brace | `:root, /* { } */ [data-theme="light"]` | {} green | braces in comments do not split rules |
| p4-media-two-rules | second rule `html { }` inside the @media | {T-C} | inner count pinned |
| p4b-media-two-rules-bare-root-with-decl | second inner rule `:root { --color-bg-canvas: ... }` | {T-C} | T-A stays green here because marker-slice and rule-body see the same declarations; T-C's inner count is what catches it |
| p5-layer-wraps-block4 | `@layer theme { [data-theme="dark"] {...} }` | {T-B} | prelude becomes `@layer theme` |
| p5b-supports-wraps-block1 | `@supports (color: red) { :root {...} }` | {T-B} | |
| p6a-brace-in-string-close | `--x-probe: "}";` in block 1 | LOAD: `unbalanced "}" at offset 6300` | loud, as the docblock promises |
| p6b-brace-in-string-open | `--x-probe: "{";` | LOAD: `unbalanced "{" (depth 1 at end of file)` | loud |
| p6c-brace-in-url-balanced | `--x-probe: url("data:x,{}");` | {completeness — non-color token allowlist} | balanced braces in a string are harmless to the split; the unknown token is caught by an existing test; new tests correctly green (structure unchanged) |
| p7-empty-block4 | `[data-theme="dark"] {\n}` | LOAD: pre-existing floor `block 4 parsed to zero declarations` | the "masking": T-A/T-B never execute because the module fails at load. Suite is red (exit 1), so no green hole — but the observed red is the floor, not the new tests |
| p7b-block4-rule-deleted-bare-decl-left | rule 4 removed, one bare declaration left in section 4 | {T-A,T-B, +4 legacy} | floor passes (1 declaration), new tests catch it: count 3, trailing non-empty |
| p8a-import-before-block1 | `@import url("x.css");` at top | {T-B} | stray statement lands in rule 1's prelude, as the T-A comment predicts |
| p8b-empty-prelude-block4 | selector deleted, `{` left | {T-B} | |
| p8c-media-extra-condition | `... and (min-width: 0px)` | {T-C, +1 legacy breakpoint-comment test} | wider than my prediction because an existing guard also fires; not a finding against the change |
| p8d-block4-marker-moved-after-rule | BLOCK 4 comment moved below its rule | LOAD: floor `block 4 parsed to zero declarations` | red via floor |
| p9-block4-selector-duplicated-rule | second `[data-theme="dark"]` rule with one conflicting decl | {T-A, +2 legacy} | |
| p10-block4-marker-inside-media-body | BLOCK 4 comment header moved inside block 3's @media body (comment-only; cascade unchanged) | {} green 39/39 | T-A's marker-join (`rule.start > marker_i && < marker_i+1`) holds because the marker is still before rule 4 in offset terms; nothing asserts markers sit at depth 0. Confirms Marcus's M7 note: the join has no independently observable red today. Guard-hardening residual, not a selector hole |

Reachable-hole search: every mutation that changes what selector delivers a block, the media condition, rule count, or rule order went red. The only green mutants are whitespace/comment-only rewrites of a prelude, which the normalisation exists to tolerate. No selector mutation left the suite green.
