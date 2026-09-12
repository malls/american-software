# AS-125: Chat: roster-title cascade guard — routes past targets()/walk(): type and universal subjects, attribute/escaped class selectors, @scope/@import/@layer swallowed, unbalanced string brace

Plan by `agent:cto-owen`, 2026-09-11 (planning stage, tick watcher:57637 loop tick 22, **on Opus under the Fable-limit fallback**), against master `7181486`. Implementer: `agent:developer-marcus`. Reviewer: `agent:qa-priya` (§7). Complexity: **low-medium** — one test file, four function edits plus three new helper cases and one amended one; the work is the mutants. **Test-only: `public/style.css`, `public/app.js`, `server.js`, `lib/`, fixtures, `api.test.js` are not touched.**

Branch `feat/AS-125-cascade-guard-routes`, worktree `.worktrees/AS-125/`. `$M` = `/Users/forrest/Code/american-software-company` (main checkout, master), `$W` = `$M/.worktrees/AS-125`. Use `git -C $W …`; **never `cd` into `$W` before a `lattice` call**. Scratchpads per actor (M3): implementer `scratchpad/agent-developer-marcus/AS-125/`, reviewer `scratchpad/agent-qa-priya/AS-125/`. Neither reads the other's, and neither reads `scratchpad/agent-cto-owen/AS-125/` (my planning spike lives there; its results are transcribed below so nobody needs the file).

Parent: AS-74 (`.lattice/plans/task_01M1K73FMF1ZJM3ZKKVN9FPCA1.md`, the guard's design — `parseBlocks`, `walk`, `targets`, `cascade`) and AS-112 (`.lattice/plans/task_01M27W6T7NXFDJNB03DCYHRD7F.md`, merged f583933 — the `all` row, the nesting throw, H6). Ruben's `--role review` comment on AS-112 (2026-09-12T00:43Z) is the source of the eight routes; the task description carries them verbatim as A1–A4, B1–B3, C1.

---

## §0. Ground truth (measured this tick; a throwaway copy of the parser with the §2 changes was run against `public/style.css` and every input below — nothing in the checkout was touched)

| Claim | Observed |
|---|---|
| **Baseline.** Host `node --test` with cwd `$M/apps/chat`: | **612 / 610 / 0 / 2**, exit 0 — matches the record on 1ea3888. `roster-truncation.test.js` alone = 7 (H1–H6 + T1). |
| **Eight routes reproduce against the current guard** (Ruben's runs, AS-112 review). | All 8 green at 606/604 on the AS-112 branch; the guard on master is byte-identical to that branch's, so they are green at 612 today. Not re-run by me — the spike's job was the fix, not the repro; the implementer's §3 battery re-observes each one red, which subsumes the repro. |
| **Under the §2 changes, all eight red or throw** (spike). | A1 red `won by #roster-list li.roster-row div (spec 1,1,2, order 210)`; A2 red `won by #roster-list * (spec 1,0,0)`; A3 red `won by [class~="roster-title"] (spec 0,1,0)`; A4 red `won by .roster-title (spec 0,1,0)` (normalised selector); B1 throw `cannot score unknown at-rule (neither flattened nor ignored): @scope (#roster-list)`; B2 throw `cannot score: statement at-rule or stray ';' glued into a prelude: @import url("x.css");\n.roster-title`; B3 throw `…unknown at-rule…: @layer x`; C1 throw `unbalanced braces: depth 1 at end of input (unclosed block opened by: .roster-status::after)`. |
| **The real stylesheet still passes** under the changes. | 210 rules parsed (unchanged), every CONTRACT row within its allowed set. Targeting set grows from **2** (`.roster-title`, `#roster-list li.roster-row.active .roster-title` — Ruben's "3" in his cardinality line was the mutant file's count) to **3**: the `* { box-sizing: border-box; }` reset at `style.css:2` joins, and it declares nothing watched. Every other type/universal-subject rule has a subject of `html`/`body`/`label`/`h2`/`li`/`header`/`span`, none of which can be the title `div`. |
| **A second cause for A3, not in Ruben's trace.** | `targets()` finds the subject with `split(/\s*[\s>+~]\s*/)`, which cuts `[class~="roster-title"]` at its own `~`; the "subject" it then examines is `="roster-title"]`. Recognising `[class…]` is not enough — the subject scan must be bracket-aware (§2.4). Any attribute value containing a space, `>`, `+` or `~` has the same problem. |
| **The title element** (`app.js` rosterRow, `el('div', 'roster-title', emp.title)` + `role.title = emp.title`). | A `div` with exactly one class **and a `title` attribute**. So `[title] { white-space: normal; }` matches it in a browser — attribute selectors on the subject cannot be dismissed as "cannot match" (§1.3). |
| **H4 conflicts with the conservative subject rule.** | H4's last line asserts `cascade(parseRules('.t * { … }'), 't', 'white-space') === null` ("a descendant of the element is not the element"). Under §2.4, `.t *` has subject `*` and is targeting: ancestors are not evaluated, by the same conservatism that makes `.roster-title.other` targeting today. H4's control moves to a subject the type rules out (`.t span`); the behaviour change is recorded in §1.3 and pinned in H9. |
| **Ruben's A1 specificity `(1,2,1)` is a miscount** — `#roster-list li.roster-row div` has one class. | The guard scores it `(1,1,2)`; either way it beats `(0,1,0)`. Description text, not a finding. |

---

## §1. Scope — what closes, how, and what stays open on purpose

**What problem this solves.** T1's sentence is "no later or stronger rule re-enables wrapping"; its algorithm can only see a rule whose subject literally spells `.roster-title`, only inside `@media`/`@supports`/`@container` or at top level, and only when every `{` in the file is a block delimiter. Each of Ruben's eight inputs is a rule a browser applies to the title `div` that the guard never scores. None is in `style.css` today, which is why they were filed non-blocking; the fix is the same doctrine as AS-112's H6 — **loud where the parser cannot read, conservative where it can**.

### 1.1 Closed — Group C, parse integrity (C1 + two siblings I add)
- **C1** unbalanced `{` inside a string: `parseBlocks` throws when `depth !== 0` at end of input, naming the prelude of the unclosed block.
- **C2** (mine) a stray `}` at depth 0: throws at the offset. Today it drives depth negative and every later block mis-nests silently.
- **C3** (mine) non-blank text after the last `}` (a statement at-rule at EOF, e.g. a trailing `@import …;`): throws `trailing content without a block`. Without it, a statement at-rule at the very end of the file is invisible — the glued-prelude case (B2) only fires when a block follows.

### 1.2 Closed — Group B, at-rules (B1, B2, B3)
- `walk()` throws on any `@`-prelude that is neither `FLATTENED_AT` (`@media|@supports|@container`, unchanged) nor a new explicit `IGNORED_AT` (`@keyframes`, `@-webkit-keyframes`, `@font-face` — the two shapes the stylesheet uses plus the vendor twin). `@scope` (B1), `@layer` block form (B3), and everything else (`@page`, `@property`, `@starting-style`, `@counter-style`…) throw until someone adds them to one list or the other deliberately. B3 was a recorded omission in both parent plans; it stops being silent.
- `walk()` throws on any prelude containing `;` — that is the signature of a statement at-rule (`@import`, `@charset`, `@namespace`, `@layer a, b;`) glued into the next block's prelude (B2). Checked **before** the `@` test, because the glued prelude may or may not start with `@`.

### 1.3 Closed — Group A, subject matching (A1–A4)
`targets()` says a subject compound targets the title when any of:
- **(a)** it carries the class literal `.roster-title` (unchanged);
- **(b)** it carries an attribute selector on `class` — `[class~="roster-title"]`, `[class~=roster-title]`, `[class="roster-title"]`, and, conservatively, **any** `[class…]` operator (`^=`, `*=`, `$=`, `|=`, bare `[class]`), because the guard does not evaluate attribute values and a `[class^="roster-"]` really does match. (A3)
- **(c)** it constrains the element by nothing that rules the `div` out: after removing attribute selectors and pseudo-classes/elements, what remains is empty, `*`, or `div` (case-insensitive), and there is no id or other class in the compound. Pseudo-classes (`div:hover`, `:first-child`) and non-class attribute selectors (`[title]` — the element has one) are treated as matchable. (A1, A2)
- The escape `\-` (and `\_`) is normalised to its character when the rule is recorded in `walk()`, so `.roster\-title` reaches (a). Any other backslash (`\2d ` hex, `\:`) throws `unsupported escape` — silently unescaping `.md\:flex` into `.md:flex` would mis-score it as a pseudo-class, and loud beats wrong. (A4)
- The subject is found by a **bracket-aware** scan (last combinator outside `[]`/`()`), which is what actually makes (b) reachable (§0).

**Recorded behaviour change:** `.roster-title *` (a descendant rule) now counts as targeting, because ancestors are not evaluated. The title `div` contains a text node only, so a watched-property rule with that shape has no legitimate use; the false-positive cost is a loud red with the selector in the message. H4's control changes accordingly (§2.6).

**Known false positives under (b)/(c), stated so the reviewer does not file them:** `[hidden] { display: none; }` (a common reset; 0 in the stylesheet — every `[hidden]` rule today has an id subject); `[class^="org-"] { display: flex; }` (any `[class…]` is targeting). Both red T1 with the offending selector named; the resolution then is a deliberate refinement, not a silent pass.

### 1.4 Out of scope, deliberately
- `row.className =` / `setAttribute('class', …)` in `orgNodeItem` — probed by Ruben, survive by design (AS-112 §1), judged not task-worthy in his review; not re-litigated here.
- **String and comment tokenisation.** The parser still does not tokenise strings: `content: "{}"` (balanced) throws via the AS-112 nesting check, `content: "}"` alone throws via C2, `content: "{"` via C1 — every unbalanced case is loud, the balanced case is loud, and a `/*` inside a string still swallows to the next `*/` (0 `content:` declarations exist; the 9 hits are `justify-content`). A real tokeniser is a different instrument; if a string-bearing declaration ever enters the stylesheet, that is the task that adds it.
- **`@layer` semantics** (origin/layer ordering in `cascade()`). B3 becomes loud, not scored; scoring layers means implementing the cascade's fourth leg, and the file has none.
- **Comma inside an attribute value** (`[title="a,b"] .roster-title`): the prelude split on `,` is as naive as the old subject split. The wrong halves both still carry `.roster-title` or a typeless subject, so the outcome is conservative (targeting, possibly mis-scored specificity). Recorded; not fixed — 0 such selectors, and the reviewer probe in §6 confirms the direction of the error.
- Any change to `api.test.js`, `CONTRACT` rows, or the flattening policy.

---

## §2. The guard changes — `apps/chat/test/roster-truncation.test.js` only

Line numbers are master `7181486`.

1. **`parseBlocks` (L56–79).** Inside the `}` branch, after `depth--`: `if (depth < 0) throw new Error(\`unbalanced braces: stray '}' at offset ${i}\`)`. After the loop: `if (depth !== 0) throw new Error(\`unbalanced braces: depth ${depth} at end of input (unclosed block opened by: ${prelude.trim()})\`)`, then `const trailing = src.slice(preludeStart).trim(); if (trailing) throw new Error(\`trailing content without a block: ${trailing}\`)`. Note `parseBlocks` is also called recursively on at-rule bodies from `walk()`, so the checks apply at every nesting level — an unclosed block inside `@media` is caught by the inner call.
2. **`IGNORED_AT` (new, beside `FLATTENED_AT` L106):** `const IGNORED_AT = /^@(-webkit-)?(keyframes|font-face)\b/;` with a comment: explicit list, grows deliberately; anything else throws.
3. **`walk()` (L115–142).** New first statement in the loop body: `if (prelude.includes(';')) throw new Error(\`cannot score: statement at-rule or stray ';' glued into a prelude: ${prelude}\`)`. Then the `@` branch becomes: flattened → recurse (unchanged); `IGNORED_AT` → `continue`; else `throw new Error(\`cannot score unknown at-rule (neither flattened nor ignored): ${prelude}\`)`. The `UNSCORABLE` and nesting throws follow unchanged. In the `rules.push` loop, record `selector: unescapeSelector(raw)` (keep the raw string on the rule as `raw` — one field, used only in messages if the implementer wants it; optional).
4. **`unescapeSelector(raw)` (new, above `walk`):** `const out = raw.replace(/\\([-_])/g, '$1'); if (out.includes('\\')) throw new Error(\`cannot score selector (unsupported escape): ${raw}\`); return out;`
5. **`lastCompound(selector)` (new) and `targets()` (L176–180).** `lastCompound`: single pass tracking `[`/`(` depth; `cut` = index of the last `[\s>+~]` at depth 0; return `selector.slice(cut + 1).trim()`. `targets(selector, cls)`: keep the `assert.match(cls, …)` line; `const compound = lastCompound(selector.trim())`; (a) class-literal regex unchanged → `true`; (b) `/\[\s*class\b/i.test(compound)` → `true`; (c) `let rest = compound.replace(/\[[^\]]*\]/g, '')`; `if (/[.#]/.test(rest)) return false`; `rest = rest.replace(/::?[-\w]+(\([^)]*\))?/g, '')`; `return rest === '' || rest === '*' || rest.toLowerCase() === 'div'`. Rewrite the comment above `targets` (L169–175) to state (a)/(b)/(c), the `title` attribute fact, the ancestors-not-evaluated conservatism, and the pseudo-element policy (unchanged: `.roster-title::after` targets).
6. **H4 (L246–261):** replace the last assertion's input `.t * { white-space: normal; }` with `.t span { white-space: normal; }` and its comment with "A subject the type rules out is not the element (`*` and `div` subjects are — see H9)."
7. **Three new helper cases, each a separate `test()` so the file count moves by three** (the stale-image detector, AS-112 §1.2 reasoning):
   - **H7** `css-cascade: unbalanced braces throw instead of collapsing the block list` — `assert.throws` on (a) `.s::after { content: "{"; }\n.t { white-space: normal; }` matching `/unbalanced braces: depth 1/` and `/opened by: \.s::after/`; (b) `.t { white-space: nowrap; } }` matching `/stray '}'/`; (c) `.t { white-space: nowrap; }\n@import url("x.css");` matching `/trailing content without a block/`; (d) inside a flattened at-rule: `@media (min-width: 1px) { .t { white-space: normal; }` (outer unclosed) matching `/unbalanced braces/`.
   - **H8** `css-cascade: an unknown or statement at-rule throws instead of being swallowed` — `assert.throws` on `@scope (#r) { .t { white-space: normal; } }` (`/unknown at-rule/`, message names `@scope`), `@layer x { .t { white-space: normal !important; } }` (`/unknown at-rule/`), `@import url("x.css");\n.t { white-space: normal; }` (`/statement at-rule or stray ';'/`), `@charset "utf-8";\n.t { white-space: nowrap; }` (same); and the ignore/flatten paths intact: `parseRules('@font-face { font-family: x; src: url(x); }\n@-webkit-keyframes p { from { x: 1; } }\n@keyframes q { to { x: 2; } }').length === 0` without throwing; `parseRules('@supports (display: grid) { @media (min-width: 1px) { .t { white-space: normal; } } }')` yields one rule with condition `@supports (display: grid) and @media (min-width: 1px)`.
   - **H9** `css-cascade: the subject need not spell the class to reach the element — type, universal, attribute and escaped subjects` — `assert.equal(targets(s, 't'), true)` for each of `#r li.row div`, `#r *`, `div`, `div:hover`, `*::before`, `[title]`, `[class~="t"]`, `[class~=t]`, `[class="t"]`, `[class^="t"]`, `.t [title="a b"]` (bracket-aware scan: the naive split would see `b"]`), `.t *` (the recorded change); `false` for each of `#r span`, `#r div.other`, `#r li.row` (the row, not the div), `.t > span`, `#r #x`, `.t-x`; and `parseRules('.t\\-x { white-space: normal; }')[0].selector === '.t-x'` (escape normalised at record time) while `parseRules('.t\\2d x { … }')` and `parseRules('.md\\:flex { … }')` each throw `/unsupported escape/`. Also `cascade(parseRules('#r li.row div { white-space: normal; }\n.t { white-space: nowrap; }'), 't', 'white-space')` returns the `div` rule with `spec [1,1,2]` — the leg that makes A1 beat the base rule.
8. **T1 (L319–351):** no assertion change. The `where` message will now list `*` first; that is correct and wanted (cardinality before quantification). Do **not** add a targeting-count pin (AS-74 §10 rejected it; still rejected).

---

## §3. Proving it (M4) — anchored mutants, predicted EXACT red sets

Scratch copy is a detached worktree, never `$W`: `git -C $M worktree add --detach /tmp/AS-125-mutant feat/AS-125-cascade-guard-routes`; remove it when done (`git -C $M worktree remove --force /tmp/AS-125-mutant`). Stylesheet mutants edit `/tmp/AS-125-mutant/apps/chat/public/style.css` (T1 reads it from disk); guard-on-guard mutants edit `/tmp/AS-125-mutant/apps/chat/test/roster-truncation.test.js`. **Applied-assertion per run, scoped to the intended site** (AS-95 sharpening): the occurrence count named below, over the whole stylesheet (every anchor below is 0 on master, so 0→1 is site-exact) or, for guard mutants, over the named function's text. Suite per run: host `node --test` with cwd `/tmp/AS-125-mutant/apps/chat` via `spawnSync` from `node -e` (never `cd`), **whole suite** — a red outside the named case is a finding. Restore with `git -C /tmp/AS-125-mutant checkout -- apps/chat`, prove with `git -C /tmp/AS-125-mutant status --porcelain` empty, re-run green at 615 before the next mutant. Log every run (mutant id, applied count before/after, red set, first line of each failure message) to your own scratchpad.

Order 210 below is the appended rule's order when it is the only rule added at EOF; B2's rule would be order 210 if it were ever scored.

| # | Mutation (appended to `style.css` unless stated) → applied check | Predicted red set | Closes |
|---|---|---|---|
| **A1** | `\n#roster-list li.roster-row div { white-space: normal; }\n` → `li.roster-row div {` 0→1 | exactly `{T1}`: `.roster-title white-space: effective value is normal — won by #roster-list li.roster-row div (spec 1,1,2, order 210)` | §1.3(c) type subject |
| **A2** | `\n#roster-list * { white-space: normal; }\n` → `#roster-list * {` 0→1 | exactly `{T1}`: `…won by #roster-list * (spec 1,0,0, order 210)` | §1.3(c) universal |
| **A3** | `\n[class~="roster-title"] { white-space: normal; }\n` → `[class~="roster-title"]` 0→1 | exactly `{T1}`: `…won by [class~="roster-title"] (spec 0,1,0, order 210)` | §1.3(b) + bracket-aware scan |
| **A3b** | `\n[class~=roster-title] { white-space: normal; }\n` (unquoted) → `[class~=roster-title]` 0→1 | exactly `{T1}`: `…won by [class~=roster-title] (spec 0,1,0, order 210)` | quote-agnosticism is real |
| **A4** | `\n.roster\-title { white-space: normal; }\n` → `.roster\-title {` 0→1 (and `.roster-title {` stays 2 — the literal is NOT what was added) | exactly `{T1}`: `…won by .roster-title (spec 0,1,0, order 210)` — same text as R1's; the applied check is what distinguishes the two runs | §1.3 escape |
| **B1** | `\n@scope (#roster-list) { .roster-title { white-space: normal; } }\n` → `@scope` 0→1 | exactly `{T1}`, thrown `cannot score unknown at-rule (neither flattened nor ignored): @scope (#roster-list)` | §1.2 |
| **B2** | `\n@import url("x.css");\n.roster-title { white-space: normal; }\n` → `@import` 0→1 | exactly `{T1}`, thrown `cannot score: statement at-rule or stray ';' glued into a prelude: @import url("x.css");` (message continues with the glued `.roster-title`) | §1.2 |
| **B3** | `\n@layer x { .roster-title { white-space: normal !important; } }\n` → `@layer` 0→1 | exactly `{T1}`, thrown `…unknown at-rule…: @layer x` | §1.2 (was a recorded omission) |
| **C1** | `\n.roster-status::after { content: "{"; }\n.roster-title { white-space: normal; }\n` → `content: "{"` 0→1 | exactly `{T1}`, thrown `unbalanced braces: depth 1 at end of input (unclosed block opened by: .roster-status::after)` | §1.1 |
| **C2** | `\n}\n` → file's `}` count +1 (assert `(css.match(/}/g)).length` rose by exactly 1) | exactly `{T1}`, thrown `unbalanced braces: stray '}' at offset N` | §1.1 |
| **C3** | `\n@import url("x.css");\n` (no rule after it) → `@import` 0→1 | exactly `{T1}`, thrown `trailing content without a block: @import url("x.css");` | §1.1 |
| **N1** (narrowness control) | `\n#roster-list span { white-space: normal; }\n` → `#roster-list span {` 0→1 | **green, 615/613/0/2** — a `span` subject cannot be the `div`; the guard must not be trigger-happy | precision of §1.3(c) |
| **N2** (narrowness control) | `\n#roster-list div.other { white-space: normal; }\n` → `div.other {` 0→1 | **green, 615/613/0/2** — another class on the subject rules the element out | precision of §1.3(c) |
| **R1** (regression, AS-74 M1) | `\n.roster-title { white-space: normal; }\n` → `.roster-title {` 2→3 | exactly `{T1}`, `…won by .roster-title (spec 0,1,0, order 210)` | AS-74 guard intact |
| **R2** (regression, AS-74 M2) | insert `#roster-list .roster-title { white-space: normal; }\n` above the `/* AS-32: the employee's title` comment → 0→1, index < `\n.roster-title {` | exactly `{T1}`, `…won by #roster-list .roster-title (spec 1,1,0, order 50)` | specificity leg intact |
| **R3** (regression, AS-112 M1) | `\n.roster-title { all: unset; }\n` → `all: unset` 0→1 | exactly `{T1}`, `.roster-title all: effective value is unset — … the contract allows undeclared` | `all` row intact |
| **R4** (regression, AS-112 M2) | `\n#roster-list { .roster-title { white-space: normal; } }\n` → `#roster-list { .roster-title {` 0→1 | exactly `{T1}`, thrown `cannot score nested style rule (native CSS nesting) under: #roster-list` — the nesting throw still wins for a block prelude with no `;` and no `@` | check order in `walk()` is right |
| **G1** (guard-on-guard) | in `targets()`, replace `lastCompound(selector.trim())` with the old `selector.trim().split(/\s*[\s>+~]\s*/).filter(Boolean).pop() \|\| ''` → `lastCompound(` count in `targets` 1→0 | exactly `{H9}` (the `[class~=…]` and `.t [title="a b"]` lines); **T1 green** — and note for the record that A3 would survive under G1: H9 is the only thing pinning the bracket-aware scan | H9 is load-bearing |
| **F7 / F8 / F9** (helper flips) | in H7 flip the C1 `assert.throws` to `assert.doesNotThrow`; in H8 flip the `@scope` `assert.throws`; in H9 flip the `#r li.row div` expectation to `false` — each: the flipped text 0→1 in that test's body | exactly `{H7}` / `{H8}` / `{H9}` respectively, 10/9/1 in the file alone | each new case is a real red/green |

**21 runs.** If a predicted-red run stays green, **re-read the diff of the mutated file before concluding the guard is weak** (AS-95 sharpening) — a mutation at the wrong site and a vacuous guard look identical from outside. A red set wider or narrower than predicted is itself a finding: record it on the task, do not smooth it.

---

## §4. Acceptance criteria (numbered; each names its falsifier — M4; the surviving inputs ARE the falsifiers)

1. H7, H8, H9 exist under exactly the §2.7 names; H4's control is `.t span`; the host suite with cwd `$W/apps/chat` reports **615 / 613 / 0 / 2** (master's measured 612 + 3; re-measure the base if master moves and say so); `roster-truncation.test.js` alone reports 10/10.
2. **A1, A2 each red exactly `{T1}`** naming the winning type/universal selector and its specificity `(1,1,2)` / `(1,0,0)`.
3. **A3, A3b each red exactly `{T1}`** naming the attribute selector; **A4 reds exactly `{T1}`** with the `.roster\-title {` applied count 0→1 and `.roster-title {` unchanged at 2.
4. **B1, B2, B3 each red exactly `{T1}`** via the thrown message named in §3 — the at-rule name (`@scope`, `@layer x`) or the glued statement (`@import …;`) appears in the message.
5. **C1, C2, C3 each red exactly `{T1}`** via the thrown message named in §3; C1's message names `.roster-status::after` as the unclosed block's prelude.
6. **N1 and N2 stay green at 615/613/0/2** — observed, not argued. A red here is a blocking finding (the guard over-reaches).
7. **R1–R4 observed with exactly the §3 sets and messages** — the AS-74 and AS-112 falsifiers still red under the new code, R4 by the nesting throw specifically.
8. **G1 reds exactly `{H9}` with T1 green; F7/F8/F9 red exactly their own case**, 10/9/1 in the file alone.
9. Test-only: `git diff master...feat/AS-125-cascade-guard-routes --stat` touches only `apps/chat/test/roster-truncation.test.js`. No `api.test.js`, `public/`, `lib/`, `server.js`, `package.json`, fixtures, `.lattice/`, top-level files.
10. Counted compose run via `node $M/apps/chat/bin/compose-run.mjs --project asc-<stage>-as125 --cwd $W/apps/chat` (docker resolved by the helper; `--build` is built in) — the `Image … Built` line quoted; expect **615 / 607 / 0 / 8**; a different skip delta is explained, not ignored.
11. Scratch worktree removed; `$W` porcelain empty; post-restore host run green at 615; `compose-run.mjs --check` shows no `asc-*-as125` leftover.

---

## §5. Predicted counts

- Host (`$W/apps/chat`): **612 → 615 / 613 / 0 / 2** (+H7, +H8, +H9; H4 amended in place; T1 unchanged in count).
- `roster-truncation.test.js` alone: **7 → 10**.
- Compose (`compose-run.mjs`, `--build` built in): last receipt shape is host skips + 6 (AS-112: host 606/604/0/2 vs compose 606/598/0/8), so **615 / 607 / 0 / 8**.
- Rules parsed from `style.css`: **210** (unchanged); targeting `.roster-title`: **2 → 3** (the `*` reset at L2). T1's `where` message shows all three.

---

## §6. Reviewer probes beyond the list (M6) — Priya's mandate, time budgeted

Spike outcomes are given only where the probe is a **known-behaviour record** the reviewer should confirm rather than a question she should answer cold; the ones marked *decide* are hers.

- **Comments containing braces:** `/* { */ .roster-title { white-space: normal; }` — comments are stripped before `parseBlocks`, so the rule itself should red T1 (record: it does in the spike). *Decide:* a `/*` inside a string value — known residual (§1.4); confirm it is loud in the unbalanced case and say what happens in the balanced one.
- **`@supports` nesting `@media` and the reverse:** flatten recursion should tag the inner rule with both conditions and red T1 on a wrapping rule. `@media` nested *inside* a style rule — the nesting throw (AS-112) fires first; which message wins is a record.
- **`:where(.roster-title)` / `:is(.roster-title)` wrapping the class:** the existing `UNSCORABLE` throw should fire from `walk()` before `targets()` is ever asked. Confirm; then *decide* whether `:where()` (which zeroes specificity) is a route worth its own task or is adequately loud as-is.
- **Custom-property indirection:** `.roster-title { --ws: normal; white-space: var(--ws); }` — T1 should red with value `var(--ws)` (any value outside the allowed set reds; the guard does not resolve variables). Confirm; then *decide* whether `white-space: var(--x)` where `--x` is defined on an ancestor is adequately covered — it is the same red, since the declaration is on the subject.
- **Selector-list and attribute-value commas:** `a, [class~="roster-title"] { … }` (list) and `[title="a,b"] .roster-title { … }` (comma in a value — §1.4 records the naive split). Confirm the direction of the error is conservative.
- **Case and vendor variants:** `DIV`, `Div:Hover`, `*::before`, `[CLASS~="roster-title"]`, `[class~="roster-title" i]`, `@-webkit-keyframes` (must be ignored, not thrown), `@FONT-FACE` (*decide*: the regex is case-sensitive; is that a finding?).
- **Known false positives to confirm and not file** (§1.3): `[hidden] { display: none; }` and `[class^="org-"] { display: flex; }` both red T1. **Known false throws to confirm and not file:** `[title=";"]` (semicolon in a value trips the statement-at-rule check), `.md\:flex` (unsupported escape).
- **Depth check inside a flattened at-rule:** an unclosed inner block under `@media` — which of the two `parseBlocks` calls throws, and does the message name the inner prelude?
- **Ancestors are not evaluated:** `#nonexistent .roster-title` and `.roster-title *` both count as targeting. Confirm the second reds T1 (the recorded change) and that H4 no longer claims otherwise.
- **The seam:** `git merge-tree` of this branch against AS-109's and AS-124's branches (whatever state they are in at review time) — expect no conflicts; both touch other files (§8).

Report cardinality (rules parsed, targeting set, runs performed) before pass counts (M5); findings first, sweep second, the sweep labelled as a floor check. Do not read the Lattice auto-review daemon's artifact before forming findings; do not read Marcus's implementation comment until your own findings are written.

---

## §7. People

**Implementer: `agent:developer-marcus`.** He is free this tick (Lena holds the AS-109 rework lane), and he wrote AS-112's edits to this same file two ticks ago, so the helper's shape is in his recent context without him being the guard's original author (Lena, AS-74) — the "second pair of eyes on a guard" reasoning from AS-74 §11 and AS-112 §6 holds in the same direction. Lena acceptable if Marcus is not free; the plan does not change.

**Reviewer: `agent:qa-priya`.** Ruben filed all eight routes with the observed survivals and a suggested shape, so he cannot certify their fix (house rule — Ruben filed AS-125, Priya reviews; the mirror of AS-112). Priya filed AS-112 but not these routes; she is cold on them in the AS-36 sense. Her M6 mandate is §6.

---

## §8. Seams — AS-109 and AS-124 run beside this lane

- **AS-109** (Lena, rework cycle 1, `.worktrees/AS-109`, branch `feat/AS-109-favicon-guard-quotes-smil`): `git diff master...` touches **only `apps/chat/test/api.test.js`** (verified this tick: 1 file, +39/−2). AS-125 touches only `apps/chat/test/roster-truncation.test.js`. Disjoint files; no seam.
- **AS-124** (planned in parallel this tick; AS-111 residuals — events/stream/watcher tests): expected files are `test/events*.test.js`, `test/stream.test.js`, `test/watcher-*.test.js`, `lib/`. Disjoint from this task's one file. If its plan names `roster-truncation.test.js` (it should not), the implementer says so on this task before committing.
- **How the implementer keeps it clean:** branch from master `7181486`; commit early and often on the branch (a tick cutoff must be resumable — keep a progress note in your own scratchpad); never touch `.worktrees/AS-109` or `.worktrees/AS-124`; compose project names distinct per stage (`asc-impl-as125`, `asc-review-as125`) so a concurrent lane's `--check` never reports yours as a leftover and vice versa; before handing to review, run `git -C $M merge-tree --write-tree master feat/AS-125-cascade-guard-routes` and confirm no conflict, and if master has moved under you, do **not** merge master into the branch — the orchestrator's `--no-ff` merge at `done` handles it, and a one-file branch cannot conflict with lanes that do not touch that file. A `mode.test.js` AS-24 red under concurrent docker load is the known AS-83-condition flake, not a finding here.

## §9. Recipe and constraints

- Host: `node --test` with `cwd: $W/apps/chat` (spawnSync from `node -e`, or `node --test $W/apps/chat/test/*.test.js` from the main checkout; both count the same on this tree). Summary lines are the `ℹ tests/pass/fail/skipped` lines.
- Compose: §4.10, one receipt each for implementer and reviewer, distinct `-p` names.
- Zero new dependencies; `node:` builtins only. No `public/`, `lib/`, `server.js`, fixture, `personnel/` or protected top-level edit. No running container touched (T1 reads from disk). `lattice` only from the main checkout. Commits as `developer-marcus` per the git identity rule, prefix `AS-125:`. Both `→ planned` and `→ review` carry `--no-auto-review` (orchestrator).
