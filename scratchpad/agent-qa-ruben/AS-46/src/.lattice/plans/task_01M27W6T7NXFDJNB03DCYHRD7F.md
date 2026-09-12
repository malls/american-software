# AS-112: Chat: harden the AS-74 roster-title cascade guard — all: unset, native CSS nesting, orgNodeItem class set

Plan by `agent:cto-owen`, 2026-09-11 (planning stage), against master `aeeca77`. Implementer: `agent:developer-marcus`. Reviewer: `agent:qa-ruben` (§6). Complexity: **low** — two test files, three small edits; the work is the mutants. **Test-only: `public/style.css`, `public/app.js`, `server.js`, `lib/`, fixtures are not touched.**

Branch `feat/AS-112-cascade-guard-hardening`, worktree `.worktrees/AS-112/`. `$M` = `/Users/forrest/Code/american-software-company` (main checkout, master), `$W` = `$M/.worktrees/AS-112`. Use `git -C $W …`; **never `cd` into `$W` before a `lattice` call**. Scratchpads per actor (M3): implementer `scratchpad/agent-developer-marcus/AS-112/`, reviewer `scratchpad/agent-qa-ruben/AS-112/`. Neither reads the other's.

Parent: AS-74 (`.lattice/plans/task_01M1K73FMF1ZJM3ZKKVN9FPCA1.md`, merged 8c748bd). Priya's `--role review` comment on AS-74 (09:20Z) names all three survivors (P6/P7/P10 → F-1/F-2/F-3) and the fixes; this plan adopts her fixes, adds one sibling pin (§1.3b), and closes nothing else.

---

## §0. Ground truth (verified on a `/tmp` copy of master `aeeca77`, checkout untouched)

| Claim | Observed |
|---|---|
| **Baseline.** Host `node --test` from `apps/chat`: | **605 tests / 602 pass / 1 fail / 2 skipped** on the copy; the one fail is `deploy-shape: every tracked path under apps/chat…`, which runs `git ls-files` and cannot pass in a non-git `/tmp` tree — master's own record is 605/603/0/2. `roster-truncation.test.js` alone = 6; `api.test.js` alone = 63 (Priya's 62 was the AS-74 branch; master has moved). |
| **P6 reproduces.** `.roster-title { all: unset; }` appended (applied: `.roster-title {` 2→3, last index after `.roster-status {`). | `roster-truncation.test.js` **6/6 green**. CONTRACT has no `all` row; `cascade()` is asked about twelve longhands and never about the shorthand that resets all of them. `style.css` declares `all:` 0 times today. |
| **P7 reproduces.** `#roster-list { .roster-title { white-space: normal; } }` appended (applied: 0→1). | **6/6 green.** `parseBlocks` returns the outer block with body `.roster-title { white-space: normal; }`; `parseDecls` splits on `;`, finds a `:` and records the garbage declaration `.roster-title { white-space` → `normal; }` — nothing targets `.roster-title`, nothing throws. The `&` form (`.roster-title { & { white-space: normal; } }`) survives the same way, observed 6/6. |
| **P10 reproduces.** `row.appendChild(el("span", "org-extra"));` inserted before the meta line in `orgNodeItem` (applied: region `el("` 0→1). | `api.test.js` **63/63 green**. T2 pins the meta line literally and counts `node.class`/`node.team`; a stray element is invisible to it. The region's class set via the AS-74 item-3 regex today is exactly `['org-node-meta','org-node-name','org-node-row','org-tree']` (`el('li')` has no class argument and does not match — correct). One class is added outside `el()`: `row.classList.add('org-root')`. |
| **Fix prototypes.** All three fixes (§1) applied on the copy: | unmodified 7/7 and 63/63; full suite **606 / 603 / 1 (the same env fail) / 2**. Every mutant in §2 ran against the prototypes and the observed sets below are measured, not predicted. |

---

## §1. Decision: adopt Priya's three fixes; one new helper case; one sibling pin

**What problem this solves.** T1's sentence is "no later or stronger rule re-enables wrapping"; its algorithm cannot see the one declaration that resets every watched property at once, and cannot see a rule written in the nesting syntax every current browser accepts. T2's sentence is "the org node label is title · class · team"; nothing pins the region's element set. All three are the AS-45 shape (English wider than algorithm); all three are constructs the served files do not use today, which is why they were accepted as non-blocking records at the AS-74 merge.

1. **`all` row (F-1).** In `test/roster-truncation.test.js` CONTRACT, after `['max-height', [null]]`, add `['all', [null]]` with a one-line comment (the reset shorthand re-opens every row above in one declaration). Any value — `unset`, `initial`, `revert`, `revert-layer` — is a change to the contract and must come through the test; that is what `[null]` means in this table. **One-word message fix alongside:** T1's `by` string renders a declared value of `unset` as `effective value is unset — won by .roster-title …`, which reads the same as the no-rule case `unset (no rule declares it)`. Render the null case and the allowed-list null as **`undeclared`** instead (`'undeclared (no rule declares it)'`; `allowed.map(a => a === null ? 'undeclared' : a)`). Nothing asserts on that text today; AS-74's M1 message (`the contract allows nowrap`) is unaffected.
2. **Nesting throws (F-2).** In `walk()`, directly after the `UNSCORABLE` throw and before `parseDecls(body)`: `if (body.includes('{')) throw new Error(\`cannot score nested style rule (native CSS nesting) under: ${prelude}\`)`. Placed in `walk`, not `parseDecls`, because the prelude is in hand there for the message; `parseDecls` is only ever called from this site, so the effect is what Priya asked for. Reaches nested rules inside flattened `@media`/`@supports`/`@container` too (walk recurses through `parseBlocks(body)` first), and `&`-nesting, and an `@media` nested inside a style rule. `@keyframes`/`@font-face` bodies are skipped before this line and stay ignored wholesale. A `{` inside a string value (`content: "{"`) would also throw — `parseBlocks` already miscounts depth on such a value, so this makes an existing silent failure loud; `style.css` has 0 `content:` declarations today.
   **New helper case H6** `css-cascade: a nested style rule throws instead of being swallowed as a declaration` — `assert.throws` on (a) `#r { .t { white-space: normal; } }`, (b) `.t { white-space: nowrap; &:hover { white-space: normal; } }`, (c) `@media (max-width: 700px) { #r { .t { white-space: normal; } } }`, each matching `/cannot score nested style rule/`; and `assert.equal(parseRules('@keyframes p { from { x: 1; } to { x: 2; } }').length, 0)` so the ignore path is shown intact. A separate case rather than three lines appended to H5: the count **must** move by one, and a count that must change is the cheapest stale-image detector this company has (AS-45; AS-109 §1 makes the same choice).
3. **orgNodeItem class-set pin (F-3).** In T2 (`api: AS-74 — served app.js keeps the org chart node label…`), before the `el('span', 'org-node-meta', meta)` presence line, add the AS-32 deepEqual shape with the item-3 quote-agnostic regex over the `orgNodeItem` region:
   `[...region.matchAll(/el\((['"])[a-z]+\1,\s*(['"])([^'"]+)\2/g)].map((m) => m[3]).sort()` → `['org-node-meta', 'org-node-name', 'org-node-row', 'org-tree']`, message `orgNodeItem builds exactly these classes via el() — a missing one and a stray extra one both fail`.
   **3b (sibling pin, my addition, one assertion):** the region adds exactly one class outside `el()` — `[...region.matchAll(/classList\.add\((['"])([^'"]+)\1\)/g)].map((m) => m[2]).sort()` → `['org-root']`. Without it, `row.classList.add('org-extra')` is the same hole one line down from the one being closed (verified: it survives the el()-only pin). Costs four lines; gets its own mutant.

**Out of scope, deliberately:** `className =` / `setAttribute('class', …)` in `orgNodeItem` (0 uses today; Ruben probes it — §6 — and files if he judges it worth a task); `@layer`/origin handling; string-aware brace parsing; any change to T1's flattening policy. **Predicted host count: 605 + 1 = 606** (H6 is the only new case; §1.1 and §1.3 add assertions to existing cases). Compose: the last receipt shape is host skips + 6 (AS-120: host 555/554/0/1 vs compose 555/548/0/7), so **predicted 606 / 598 / 0 / 8**.

---

## §2. Proving it (M4) — anchored mutants, observed EXACT red sets

Scratch copy is a detached worktree, never `$W`: `git -C $M worktree add --detach /tmp/AS-112-mutant feat/AS-112-cascade-guard-hardening`; remove it when done (`git -C $M worktree remove --force /tmp/AS-112-mutant`). Every mutant edits `/tmp/AS-112-mutant/apps/chat/public/{style.css,app.js}`; T1 reads `style.css` from disk and T2 fetches `app.js` through its own booted server, so the file on disk is the input either way. Applied-assertion per run, **scoped to the intended site** (AS-95 sharpening): the occurrence count named below, plus for `app.js` mutants the count taken over the `orgNodeItem` region (`app.indexOf('function orgNodeItem(node) {')` to the next `\n}\n`), never the whole file. Suite per run: host `node --test` from the scratch's `apps/chat` via `spawnSync` (never `cd`), whole suite — a red outside the named file is a finding. Restore by `git -C /tmp/AS-112-mutant checkout -- apps/chat/public`, prove with `git -C /tmp/AS-112-mutant status --porcelain` empty, re-run green at 606 before the next mutant.

| # | Mutation (anchor → applied check) | Observed red set on the prototype | Kills |
|---|---|---|---|
| **M1** | append `\n.roster-title { all: unset; }\n` to `style.css` → `.roster-title {` 2→3 and `lastIndexOf('.roster-title {') > indexOf('.roster-status {')` | exactly `{T1}`, message `.roster-title all: effective value is unset — won by .roster-title (spec 0,1,0, order 210); the contract allows undeclared` (with §1.1's wording; the prototype read `…allows unset`) | F-1 (P6) |
| **M2** | append `\n#roster-list { .roster-title { white-space: normal; } }\n` → `#roster-list { .roster-title {` 0→1 | exactly `{T1}`, thrown `cannot score nested style rule (native CSS nesting) under: #roster-list`; H6 green | F-2 (P7) |
| **M2b** | append `\n.roster-title { & { white-space: normal; } }\n` → `& { white-space: normal; }` 0→1 | exactly `{T1}`, `…under: .roster-title` | F-2, `&` form |
| **M3** | `app.js`, insert `  row.appendChild(el("span", "org-extra"));` immediately before the `const meta = […]` line in `orgNodeItem` (that line occurs once in the file) → region `el("` 0→1 | exactly `{T2}`, message `orgNodeItem builds exactly these classes via el()…`; the AS-32 rosterRow case green | F-3 (P10) |
| **M3b** | same insertion single-quoted, `el('span', 'org-extra')` → region `org-extra` 0→1 | exactly `{T2}` | quote-agnosticism is real, not assumed |
| **M4** | insert `  row.classList.add('org-extra');` at the same anchor → region `classList.add` 1→2 | exactly `{T2}`, message `orgNodeItem adds exactly one class by classList…` | §1.3b |
| **R1** (regression) | AS-74 M1: append `\n.roster-title { white-space: normal; }\n` → `.roster-title {` 2→3 | exactly `{T1}`, `white-space: effective value is normal — won by .roster-title (spec 0,1,0, order 210)` | the AS-74 guard is intact |
| **R2** (regression) | AS-74 M2: insert `#roster-list .roster-title { white-space: normal; }\n` above the `/* AS-32: the employee's title` comment → 0→1, index < `\n.roster-title {` | exactly `{T1}`, `won by #roster-list .roster-title (spec 1,1,0, order 50)` | specificity leg intact |
| **R3** (regression) | AS-74 M3: replace the meta line with `const meta = node.title \|\| '';` → region `node.class` 1→0 | exactly `{T2}` | T2's original pins intact |
| **R4** (regression) | AS-74 M4: `item.append(el("div", "roster-extra"));` after `item.append(top);` in `rosterRow` → file `roster-extra` 0→1 | exactly `{the AS-32 el() case}`; **T2 green** — the new pin is scoped to `orgNodeItem` and does not fire on `rosterRow` | region scoping is real |

Helper flip: H6 is a real red/green — flip one `assert.throws` to `assert.doesNotThrow` (or change `/cannot score nested/` to `/xyz/`) and it reds alone, 7/1 in the T1 file; revert by `git checkout`. If a predicted-red case stays green, re-read the mutated file's diff before concluding anything (AS-95 sharpening): a wrong-site mutation and a weak guard look identical from outside.

---

## §3. Acceptance criteria (numbered; each names its falsifier — M4)

1. H6 exists under exactly the §1.2 name; the host suite from `$W/apps/chat` reports **606 / 604 / 0 / 2** (or master's measured base + 1, re-measured if master moves; note the base includes 2 skips).
2. **M1 reds exactly `{T1}`** and the message names `all` and the winning selector; the AS-32 CSS case (`api: AS-32 — style.css truncates…`) stays green (observed, not assumed).
3. **M2 and M2b each red exactly `{T1}`** via the thrown `cannot score nested style rule` error naming the enclosing prelude; H6 green in both runs.
4. **M3 and M3b each red exactly `{T2}`** on the class-set message; **M4 reds exactly `{T2}`** on the classList message.
5. **R1–R4 observed with the exact sets in §2** — the AS-74 falsifiers still red, and R4 shows T2 green while the AS-32 el() case reds (scoping).
6. H6 flip: exactly `{H6}` red, 7/1 in `roster-truncation.test.js` alone.
7. Test-only: `git diff master...feat/AS-112-cascade-guard-hardening --stat` touches only `apps/chat/test/roster-truncation.test.js` and `apps/chat/test/api.test.js`. No `public/`, `lib/`, `server.js`, `package.json`, fixtures, `.lattice/`, top-level files.
8. Counted compose run via `node $M/apps/chat/bin/compose-run.mjs --project asc-<stage>-as112 --cwd $W/apps/chat` (docker resolved by the helper; `--build` is built in) — the `Image … Built` line quoted; expect **606 / 598 / 0 / 8**; a different skip delta is explained, not ignored.
9. Scratch worktree removed; `$W` porcelain empty; post-restore host run green at 606; `compose-run.mjs --check` shows no `asc-*-as112` leftover.

---

## §4. Test-run recipe

- Host: `node --test` with `cwd: $W/apps/chat` (spawnSync from `node -e`, or `node --test $W/apps/chat/test/*.test.js` from the main checkout; both count 606 — bare `node --test` discovery and the glob agree on this tree as of AS-74 §1).
- Compose: §3.8, one receipt each for implementer and reviewer, distinct `-p` names (`asc-impl-as112`, `asc-review-as112`). AS-109 and AS-111 are in flight beside this task — a `mode.test.js` AS-24 red under concurrent docker load is recorded as the known AS-83-condition flake, not a finding here.

## §5. Constraints

Zero new dependencies; `node:` builtins only. No `public/`, `lib/`, `server.js`, fixture, `personnel/` or protected top-level edit. No running container touched (T2 boots its own server on `listen(0)`; T1 reads from disk). `lattice` only from the main checkout. Commits as `developer-marcus` per the git identity rule, prefix `AS-112:`; commit early on the branch and keep a progress note in your own scratchpad so a tick cutoff is resumable. Do not touch `.worktrees/AS-109` or `.worktrees/AS-111`.

## §6. People

**Implementer: `agent:developer-marcus`.** Lena wrote the helper this task edits (AS-74); the parser change (§1.2) is the one edit here with a chance of being subtly wrong, and the AS-80/AS-74 reasoning — a second pair of eyes on a guard, not its author hardening it — applies in the same direction. Lena is also already named on AS-109 in this batch. Lena acceptable if Marcus is not free; the plan does not change.

**Reviewer: `agent:qa-ruben`.** Priya filed these findings with the fixes attached, so she cannot certify their fix (house rule — Ruben on AS-32 → Priya on AS-74; Priya on AS-74 → Ruben here). Her authorship does not anchor *this* plan in the AS-36 sense — her comment named holes and remedies, not a verdict on an implementation that did not exist yet — but it would anchor a review by her. Ruben's mandate under M6, past the list: `all: revert-layer` and `all: initial` (any value must red); an `@media` block nested *inside* `.roster-title { … }`; `:is(` inside a nested rule (which throw fires first is a record, not a finding); a `{` inside a string value; `row.className = 'x'` and `row.setAttribute('class', …)` in `orgNodeItem` (unpinned by design, §1 — decide whether it is a task); a stray `el()` in `renderOrgChart` (out of region, should not red — confirm). Report cardinality (rules parsed, region class-set size) before pass counts (M5); findings first, sweep second. Do not read the Lattice auto-review daemon's artifact before forming findings; both `→ planned` and `→ review` carry `--no-auto-review`.
