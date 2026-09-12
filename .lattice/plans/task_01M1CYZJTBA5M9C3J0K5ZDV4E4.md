# AS-35: design tokens: verify CSS selectors, not just declarations — a wrong block-4 selector breaks theming with the suite green

Complexity low, two-stage: Marcus plans + implements; Ruben reviews.

## Scope

One file changes: `docs/design/tokens/tokens.test.mjs`. `tokens.css` is untouched
(so `apps/chat/test/tokens-parity.test.js`, which pins it by sha256, is unaffected).
No new dependency. The R2–R7 residuals from Priya's filing are out of scope.

**Headless-browser computed-value check: left out.** Node's standard library has no
browser; the only dependency-free route is a Chrome binary on the host, which makes
the check either environment-dependent or skippable — and a skipped check is the
vacuous pass this suite exists to forbid. The structural assertion is the deliverable.

## Approach

Today the suite slices `tokens.css` by the `BLOCK N —` comment markers and verifies
the declarations inside each slice; nothing reads the rule preludes (selectors,
`@media`), so a wrong selector or a reordered rule is invisible. Add a small
fail-loud top-level rule parser and three tests that pin the structure the cascade
depends on, joined to the existing marker-based blocks:

- `parseTopLevelRules(cssText, sourceLabel)`: blank `/* */` comments with
  equal-length whitespace (offsets preserved), walk braces at depth 0, return
  `[{ prelude, body, start }]`. Throws a named `FORMAT CONTRACT BROKEN` error on an
  unbalanced brace or zero rules. Preludes normalised: whitespace runs → one space,
  `\s*,\s*` → `, `, trimmed.
- **T-A structure:** exactly 4 top-level rules; nothing but whitespace outside them
  (catches a stray `@import`/declaration); rule *i* starts after marker *i* and before
  marker *i+1*; the custom properties parsed from rule *i*'s body deep-equal the
  existing `cssBlock<i>` dict (rule 3 via its nested body). This is the join between
  "block N" as the suite reads it and "rule N" as the browser cascades it.
- **T-B selectors:** rule 1 prelude is exactly `:root`; rule 2 is exactly
  `:root, [data-theme="light"]`; rule 4 is exactly `[data-theme="dark"]`.
- **T-C block 3:** rule 3 prelude is exactly `@media (prefers-color-scheme: dark)`;
  its body parses to exactly one nested rule whose prelude is exactly
  `:root:not([data-theme="light"])`, with nothing but whitespace outside that rule.
- **T-D guard:** `parseTopLevelRules` throws on unbalanced braces and on zero rules
  (in-memory fixture, matching the existing format-contract guard tests).

T-B + T-C together pin the order of all four rules by index. Header comment gains a
line naming the structural check. Counts: 35 → 39 tests.

## Key files

- `docs/design/tokens/tokens.test.mjs` (only file edited)
- `docs/design/tokens/tokens.css` (read only; mutated only in the falsifier runs, restored)
- `scratchpad/agent-developer-marcus/AS-35/` — progress note, falsifier script, mutant logs

## Acceptance criteria

Host suite: `node --test 'docs/design/tokens/*.test.mjs'` from the worktree root.
No compose receipt applies: no compose image's build context includes `docs/` (AS-56
precedent: the token suite is a host run; compose runs there were for consumer apps
whose inputs changed, and nothing a consumer reads changes here).

1. Suite green at 39/39 on the branch tip; `git diff --exit-code` clean after the
   run (the tokens.json contrast write stays idempotent).
2. Block-4 selector (Priya's demonstration): `[data-theme="dark"]` →
   `[data-theme="drak"]`. Expected red set exactly {T-B}. Existing 35 stay green
   (that is the gap being closed).
3. Block-2 selector: `:root,\n[data-theme="light"]` → `:root`. Expected red exactly {T-B}.
4. Block-3 media query: `prefers-color-scheme: dark` → `prefers-color-scheme: light`.
   Expected red exactly {T-C}.
5. Block-3 guard: `:root:not([data-theme="light"])` → `:root`. Expected red exactly {T-C}.
6. Order: swap the rule text of blocks 3 and 4 (markers stay in place, so every
   existing declaration test stays green). Expected red exactly {T-B, T-C}.
7. Rule count: append a fifth top-level rule `html { }` after block 4. Expected red
   exactly {T-A}.
8. Guard: in a scratch copy of the test file, make `parseTopLevelRules` return `[]`
   instead of throwing on zero rules. Expected red exactly {T-D}.

Every mutation is asserted applied at the intended site (occurrence count) before
the run; each run records the exact failing-test set; restore is proven by
`git -C .worktrees/AS-35 diff --exit-code`. Logs in the scratchpad; the Lattice
comment names the path.
