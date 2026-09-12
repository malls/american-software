# AS-125 findings draft (agent:qa-priya, Opus under the Fable fallback) — written before reading Marcus's comment

## Cardinality (real stylesheet, branch helper)
210 rules parsed; 146 distinct subject compounds; 3 target .roster-title:
`* [0,0,0, order 0] | .roster-title [0,1,0, order 50] | #roster-list li.roster-row.active .roster-title [1,3,1, order 51]`.
Type/universal/attr-only subjects present in style.css: `*`, html, body, label, select, h2, button, button:hover, ul, li, li:hover, code, textarea, header, input — only `*` can be the div. Plan §0/§5 "2 → 3" confirmed.
0 `|`, 0 `[class`, 0 `:root`, 0 `content:` string declarations (the only quoted values are font-family names).

## Findings OUTSIDE the criteria list (none block; all outside the eight routes and inside §1.4's recorded exclusions — but §1.4's characterisation of one of them is wrong)

N1 — comma inside an attribute value is a SILENT route, not a conservative one (plan §1.4 says "the outcome is conservative (targeting, possibly mis-scored specificity)"; the reviewer probe in §6 asks me to "confirm the direction of the error is conservative" — I cannot).
  Falsifier 1 (subject, any order, even !important): `.roster-title { white-space: nowrap; }` + `[title="a,b"] { white-space: normal !important; }` → cascade winner `nowrap by .roster-title` (green). walk() splits the prelude on `,` into `[title="a` and `b"]`; neither half targets (attr-strip regex needs a closing `]`; `b"]` is not empty/`*`/`div`). The title div HAS a title attribute (emp.title), so `div[title*=","] { white-space: normal }` is the same silent shape (probe N1c).
  Falsifier 2 (ancestor, order-dependent): `[data-x="a,b"] .roster-title { white-space: normal; }` BEFORE the base rule → guard scores the half `b"] .roster-title` as (0,1,0), equal to the base, later order wins → `nowrap` (green); a browser scores (0,2,0) → wraps. Control without the comma (`[title="ab"] .roster-title`) reds correctly at (0,2,0).
  Shape of fix: bracket-aware `,` split in walk() (the lastCompound technique). 0 such selectors today; not blocking.

N2 — namespace-prefixed subject is a silent route of the A1/A2 kind: `*|div { white-space: normal !important; }` and `#roster-list *|*` → targets() false (the `|` survives (c)'s stripping), guard green; a browser applies `*|div` to every div. `|div` (no namespace) correctly does not match HTML elements, so the fix is: strip a leading `[-\w*]*\|` ns prefix before the type check, or throw on `|`. 0 `|` in style.css; exotic; not blocking.

Confirmed residuals / decisions (no task):
- P2a comment-opener inside a string: `.x::after { content: "/*"; }` … `.roster-title { white-space: normal; }` … `.y::after { content: "*/"; }` → GREEN, silent — the stripped span carries balanced braces so C1/C2 never fire. Never-closed `/*` (P2c) and balanced-in-one-declaration (P2b) both red on the wrapping rule. This is exactly §1.4's "a `/*` inside a string still swallows to the next `*/`"; 0 string-bearing `content:` declarations; the plan's own scoping stands.
- @FONT-FACE / @MEDIA / @-moz-keyframes throw (case-sensitive lists). Not a route — a false throw that names the at-rule. Decision: not a finding; add `/i` (or the vendor) the day the stylesheet writes one.
- :where()/:is() wrapping: UNSCORABLE throws in walk() before targets() (P4a/b/c). `:where()` zeroing specificity cannot be scored silently → adequately loud; no task.
- var() indirection: `var(--ws)` reds as a value outside the allowed set whether --ws is on the subject or an ancestor (P5a/b); `inherit` reds too (P5c). Adequately covered.
- Depth check under @media: the OUTER parseBlocks throws, naming `@media (min-width: 1px)` as the unclosed block (P9a/b) — the inner prelude is not named, which is acceptable (the enclosing at-rule is). The inner call's own checks are reachable: a statement at-rule inside a @media body throws C3 from the inner call (Q14).
- Known FPs confirmed: `[hidden] { display: none }` and `[class^="org-"] { display: flex }` both red on `display` naming the selector. Known false throws confirmed: `[title=";"]` (statement-at-rule check), `.md\:flex` (unsupported escape).
- `:root` counts as targeting (pseudo-class-only subject) — same conservatism as `[hidden]`; 0 in style.css; note only.
- Ancestors not evaluated: `#nonexistent .roster-title` and `.roster-title *` both red; H4's control `.t span` → null (X1).
- Selector-list comma with an attribute member (`a, [class~="roster-title"]`) → targeting via the second member; conservative.
- Case/vendor: `DIV`, `Div:Hover`, `*::before`, `[CLASS~=…]`, `[class~=… i]` all targeting; `@-webkit-keyframes` ignored (0 rules, no throw).
- `#r>div`, `#r+div`, `#r~div`, newline combinator, `:nth-child(2n+1)` all resolve the subject correctly; `.ROSTER-TITLE` correctly NOT targeting (class selectors are case-sensitive).
- Seams: `git merge-tree --write-tree` vs master and vs feat/AS-124-tail-prefix-confirm both return a tree (no conflicts); AS-124 touches README/server.js/stream.test.js/watcher-events.test.js only. AS-109 already merged (993a2a9), api.test.js only.
