# AS-74: Chat: the roster truncation contract has no standing guard, and three smaller coverage gaps

Planner: agent:cto-owen (tech lead), 2026-09-11, against master 2cafce4 (code as of d815848, the AS-73 merge). Complexity: low.
Source: Ruben's AS-32 cycle-1 review, five items in the task description. Everything is in `apps/chat/test`; zero production change. Item 5 is applied at planning (it is board state — §9).

## 1. Scope

**Changes (four files, all under `apps/chat/test/`; nothing under `public/`, `lib/`, `server.js`, `package.json`):**

1. New `apps/chat/test/roster-truncation.test.js` — the standing guard for item 1, plus the small cascade helper it depends on and that helper's own unit cases. Self-contained on purpose: compose runs bare `node --test`, whose default discovery sweeps `**/test/**/*.js`, so a helper module at `test/css-cascade.js` would run as a zero-test file in the container and not on the host (`test/*.test.js`), and the two receipts would stop being comparable. One file, both runners see the same thing.
2. `apps/chat/test/api.test.js` — item 2 (one new case), item 3 (one regex in the AS-32 case at line 1274), item 4 (one new case; four whole-file sink lines removed at 843, 1106, 1214–1215, 1297–1300).
3. `.lattice/plans/task_01M1C6HT2QD4T2Q0ZZC3KSQYT5.md` (AS-32's plan) — item 5, an errata section appended, applied by the planner in this tick (§9). The implementer does not touch it.

**Does not change:** `public/style.css` (the AS-32 rule is correct — this is a guard defect), `public/app.js`, `test/fixtures/**`, the real `personnel/`, any other test file.

## 2. Item 1 — the observable, and what is honestly not observable

The contract (AS-32 plan §3.2): every `.roster-title` box is one line tall at every width; overflow clips with an ellipsis. Ruben's mutant: leave the AS-32 rule intact and add one LATER rule re-enabling wrapping — suite green at 235, rows grow 60→76px (his recorded readings on AS-32).

**A real layout measurement is not available to this suite and is not being faked.** apps/chat is dependency-free by design (AS-2); the compose image is `node:24-slim` with no browser; a character-count or font-metric estimate would be an instrument that has never been calibrated and would pass or fail on its own arithmetic. The AS-32 §3.5 browser instrument stays what it is — a one-off, run at review time.

**Chosen observable: the effective cascade for `.roster-title`, computed over the stylesheet, must resolve to the truncating values — and no rule anywhere in the file, at any specificity, in any `@media` block, may out-rank them.** This is the property Ruben's mutant actually violates: not "the AS-32 rule exists" (the current test, which stays green) but "the AS-32 rule *wins*". Verified with a probe during planning (scratchpad `agent-cto-owen/AS-74-cascade-probe/probe.mjs`, a record not a deliverable):

```
unmodified style.css       : 205 rules, 2 target .roster-title; white-space nowrap / overflow hidden / text-overflow ellipsis all won by `.roster-title` (spec 0,1,0, order 50)
+ `.roster-title { white-space: normal; }` appended (Ruben's mutant)     : white-space -> normal, won by order 205   RED
+ `@media (max-width:700px){ #roster-list .roster-title { white-space: normal; overflow: visible } }` : white-space -> normal, overflow -> visible, won by spec 1,1,0   RED
```

The helper (`parseRules`, `specificity`, `targets`, `cascade`; ~70 lines, no dependencies) does exactly this and nothing more:
- strips comments; walks blocks by brace depth; **flattens `@media`/`@supports`/`@container`** so every inner rule competes, tagged with its condition — conservative on purpose, because the contract is stated for every width, so a rule that re-enables wrapping under any condition is a violation; other at-rules (`@keyframes`, `@font-face`) are ignored;
- splits comma selector lists; parses `prop: value` declarations and `!important`;
- `targets(selector, 'roster-title')`: the selector's **subject** (last compound) carries `.roster-title` — descendant rules like `.roster-title *` are not the element and do not count; inheritance is irrelevant because every watched property is declared directly on the element, and a direct declaration beats inheritance at any ancestor specificity;
- `specificity` counts (ids, classes/attrs/pseudo-classes, elements) and **throws on `:is(`/`:where(`/`:not(`/`:has(`** rather than guessing — the stylesheet has none today (0 occurrences, verified), and a future one makes T1 fail loudly at the selector, which is the right failure;
- `cascade(rules, cls, prop)`: winner = `!important` first, then higher specificity, then later source order. The three rules of the cascade that a hand-written stylesheet exercises; no origin/layer handling because the file has no `@layer` (0 occurrences).

The assertion table T1 checks (property → allowed winner):

| property | allowed winner | why it is in the table |
|---|---|---|
| `white-space` | `nowrap` | the wrap switch |
| `overflow` | `hidden` | `text-overflow` is inert unless overflow is non-visible |
| `overflow-x` | unset or `hidden` | the longhand that can quietly re-open the inline axis |
| `text-overflow` | `ellipsis` | the visible half of the contract |
| `display` | unset or `block` | `inline` disables overflow/ellipsis; `-webkit-box` is the line-clamp door |
| `text-wrap`, `text-wrap-mode` | unset or `nowrap` | modern longhands of `white-space` — a later `text-wrap: wrap` re-enables wrapping with `white-space` untouched |
| `white-space-collapse`, `line-clamp`, `-webkit-line-clamp`, `height`, `max-height` | unset | any explicit value here is a change to the contract and must come through this test |

Non-vacuity by construction: the assertion is on the *winner's value*, not on a set. If zero rules target `.roster-title`, every winner is unset and `white-space === 'nowrap'` fails on its own — there is no empty-set way to pass. So no literal rule-count pin is needed for vacuity (contrast AS-80, where the quantified check was over a recorded list and an empty list passed). T1 still reports the targeting selectors in its message (cardinality first) and asserts at least the base `.roster-title` rule is among them.

**The "row height stays single-valued" half — reduced, explicitly.** Row height is layout; nothing in this suite can observe it. What T1 evidences is the *precondition* the browser needs to lay the title out as one line box: nowrap + hidden + ellipsis winning on a block-level element whose only content is a text node (that last part is AS-32's own case — `el('div', 'roster-title', emp.title)` present, exact class set, so a second `.roster-title` per row or a nested child cannot appear without that case going red). The calibration that these preconditions do produce one line — and that removing one produces two — is AS-32's recorded browser evidence, not re-derived here: Marcus's PASS B (75-char title in a scratch root: `HEIGHTS [16]`, `ROWHEIGHTS [60]`/`[84]`, `CLIPPED` non-empty at both widths) and Ruben's control (delete `white-space: nowrap` only → `HEIGHTS [16,48]`, row +32px). T1 is the standing guard over the inputs to that calibration. It cannot see: a name that wraps in `.roster-top` (outside the AS-32 contract), a font change (does not change line count), or a browser that stops honouring the properties. State it as that; do not write "row height" in the test name.

**"Non-vacuous against a real roster"** (task description): the guard's only input is the stylesheet, so there is no roster on which it could be vacuous — the AS-32 instrument was vacuous *because* its reading depended on roster data (CLIPPED empty). A stylesheet guard is the stronger position, and the falsifier is the mutant (§6 M1), not a long title. No scratch personnel root is needed for item 1; the real `personnel/` is not read and never mutated.

## 3. Items 2–5 — decisions

- **Item 2 (org chart node label, the other half of the AS-32 divergence).** New case in `api.test.js`, scoped to the `orgNodeItem` body of the *served* `app.js` (AS-54 bounding precedent), asserting the meta line is exactly the literal `[node.title, node.class, node.team].filter(Boolean).join(' · ')` — as it appears in source, i.e. the six characters `·`, not the middle dot — and that `node.class` and `node.team` each occur exactly once in the region, and `'org-node-meta'` is built by `el()`. Collapsing the label to title-only leaves the sidebar case green today; after this, it reds T2.
- **Item 3 (quote-sensitive class-set regex).** At `api.test.js:1274`, `/el\('[a-z]+',\s*'([^']+)'/g` → `/el\((['"])[a-z]+\1,\s*(['"])([^'"]+)\2/g` and `m[1]` → `m[3]`. On the unmodified file the set is still the eight names at 1275–1276 (verify: `el("` occurs 0 times in `app.js` today, so the set cannot change). The presence assertion at 1292 stays single-quoted: it pins the *exact* line, which is the point.
- **Item 4 (three identical whole-file guards) — collapse, into one wider guard.** Reason: three assertions of the same regex on the same string pass and fail together, so they are not defence in depth — they are one guard counted three times, and the count is what has been surprising predictions (AS-32 R3 predicted three cases red and got four). Meanwhile eleven other served modules have no sink guard at all. T3 enumerates `public/*.js` on disk, fetches each from the booted server (200 — every module on disk is served; a 404 is a finding), and asserts zero occurrences of each of `.innerHTML`, `insertAdjacentHTML`, `outerHTML`, `document.write` in each, with a **literal** examined count of 12 in the message (`app, dashboard-link, dm-sort, lanes, live, loop-status, markdown, msg-refs, org-chart, scroll, thread-modal, url-state` — a new module updates the number in the same task, which is the point of a literal). Removed: the `doesNotMatch(app, /\.innerHTML/)` lines at 843 (AS-26), 1106 (AS-54), 1214 and the `org` twin at 1215 (AS-33), and the four-sink loop at 1297–1300 (AS-32) — each replaced by one comment line pointing at T3. Kept untouched: 1678 (`loop-status.js` purity bundle) and 1865 (`dashboard-link.js` purity bundle) — those assert DOM-API absence, a different property, and are the module's own purity contract. After this, an `.innerHTML` in `dm-sort.js` reds T3; on master today it reds nothing (§6 M5 shows both).
- **Item 5 (AS-32 plan's §3.5 snippet).** Ruben is right: `app.js` ~L1535 (`AS-23` empty-state) calls `openDrawer()` on load at ≤700px when no conversation is selected, so "the drawer must be opened first via `#sidebar-toggle`" either toggles it closed or is intercepted. Decision: the plan is a historical record of a merged task — its wording is not rewritten; an **Errata** section is appended (with the two arithmetic corrections from item 4 alongside: `emp.title` 1→4 not 1→3 — the `if (emp.title)` guard is an occurrence; R3's predicted red set was four cases, not three — AS-33's guard was missed). Applied in this planning tick as board state, committed with this plan.

## 4. Key files and lines (master 2cafce4)

| File | Lines | What |
|---|---|---|
| `apps/chat/public/style.css` | 134–137 (`.roster-title`), 138 (`.active` colour), 105–107 (`white-space: normal` on the row — the premise) | T1's subject; **not edited** |
| `apps/chat/public/app.js` | 445–500 `rosterRow`, 479–483 the title block; 860–874 `orgNodeItem`, 865 the meta line | scoped regions; **not edited** |
| `apps/chat/test/api.test.js` | 16 `FIXTURE_ROOT`, 18 `bootServer`; 843, 1106, 1214–1215, 1297–1300 the sink lines; 1256–1330 the AS-32 case (1274 the regex); 1332–1351 the AS-32 CSS case (stays, unchanged) | items 2, 3, 4 |
| `apps/chat/server.js` | `STATIC_FILES` map | why T3 fetches (the allowlist is load-bearing, AS-26) |
| `scratchpad/agent-cto-owen/AS-74-cascade-probe/probe.mjs` | — | the planning probe; lift the helper from it, do not copy the CLI tail |

## 5. Executable test names (predict, then make exist)

New file `test/roster-truncation.test.js`:
- H1 `css-cascade: a later rule of equal specificity wins`
- H2 `css-cascade: higher specificity beats source order`
- H3 `css-cascade: !important beats specificity and order`
- H4 `css-cascade: rules inside @media compete, tagged with their condition`
- H5 `css-cascade: a selector it cannot score throws instead of guessing`
- T1 `truncation: AS-74 — the cascade leaves .roster-title nowrap, overflow hidden, ellipsis — no later or stronger rule re-enables wrapping`

H1–H5 run on a five-line inline stylesheet string each; they exist so that the helper is not itself an unproven checker (a wrong specificity count is a vacuous guard wearing T1's name). T1 reads `public/style.css` from disk (`resolve(__dirname, '../public/style.css')`); served-ness of that file is already pinned by the AS-32 CSS case at 1332, and T1 needs no server.

In `api.test.js`:
- T2 `api: AS-74 — served app.js keeps the org chart node label as title · class · team (the other half of the AS-32 divergence)`
- T3 `api: AS-74 — every served public/ module is free of markup sinks (12 examined)`

Host count after: master **486** (measured this tick on 2cafce4, `node --test apps/chat/test/*.test.js`, 486 pass / 0 fail) + 8 = **494**. AS-80 (net 0) and AS-83 are in flight beside this task; if master has moved when the branch is implemented, re-measure master and expect base + 8.

## 6. Acceptance criteria (numbered; M4 — each property names its falsifier)

1. The eight cases in §5 exist under exactly those names and pass on the unmodified branch; the host suite reports 494 pass / 0 fail (or base + 8, §5).
2. **M1 (Ruben's mutant) turns exactly `{T1}` red**, whole suite: predicted 493/1; T1's message names `white-space` and the winning selector/order. The AS-32 case `api: AS-32 — style.css truncates the roster title to one line` **stays green** — that is the finding being fixed, and it must be observed, not assumed.
3. **M2 (higher-specificity rule placed BEFORE the AS-32 rule) turns exactly `{T1}` red** — proof the specificity leg is live, not decorative. Predicted 493/1.
4. **M3 (org label collapsed to title-only) turns exactly `{T2}` red.** Predicted 493/1.
5. **M4 (a double-quoted stray class in `rosterRow`) turns exactly `{the AS-32 el() case at 1256}` red on the branch, and stays green against master's copy of that test** — shown both ways (§6 M4 explains how, without leaving the worktree). Predicted 493/1 on the branch.
6. **M5 (`.innerHTML` in `dm-sort.js`) turns exactly `{T3}` red**, and **M6 (`.innerHTML` in `app.js`) turns exactly `{T3}` red** — narrower than master's set for M6 (where AS-26/AS-54/AS-33/AS-32 all red), which is the collapse working as designed. Record the exact sets; a wider set means a sink line was not removed.
7. T3's message reports the examined count and it is the literal 12; falsifier: temporarily rename the readdir path in a scratch copy of the test → `0 !== 12` (or simply read the assertion — it is `assert.equal(examined, 12, …)` before any per-module check).
8. H1–H5: each helper case is a real red/green — reviewer flips one expected value in each and sees it fail (five one-line mutations, no restore ceremony needed: edit the expectation, run, revert by `git checkout -- test/roster-truncation.test.js`).
9. No production change: `git diff master...feat/AS-74-roster-truncation-guard --stat` touches only `apps/chat/test/api.test.js` and `apps/chat/test/roster-truncation.test.js`. No `.lattice/`, no `public/`, no `package.json`, no fixtures.
10. Counted compose run with `--build` from the worktree's `apps/chat`: the `Image … Built` line quoted; count = host count minus master's host−compose delta (AS-82's receipt: 480 host / 478 compose, delta 2 → expect 492 if unchanged; a different delta is explained, not ignored).
11. Tree byte-identical after every restore (`shasum -a 256` before === after; `git -C .worktrees/AS-74 status --porcelain` empty), and the post-restore run is green at 494.

## 7. Mutations (worktree as scratch; anchored; occurrence-accurate; never `grep -c`)

General recipe, from the main checkout, `W=/Users/forrest/Code/american-software-company/.worktrees/AS-74/apps/chat` — absolute paths, never `cd` (the Bash cwd persists and a stray `cd` redirects every later `lattice` call):

```
F=public/style.css; cp "$W/$F" "$W/$F.orig"; trap 'cp "$W/$F.orig" "$W/$F"; rm -f "$W/$F.orig"' EXIT
shasum -a 256 "$W/$F.orig"                              # hash BEFORE
node -e '<anchored edit>'                               # mutate
node -e '<assert applied AT the site>'                  # split(needle).length-1, scoped to the region
node --test "$W"/test/*.test.js 2>&1 | tail -12          # observe; record the failing set
trap - EXIT; cp "$W/$F.orig" "$W/$F"; rm -f "$W/$F.orig"
shasum -a 256 "$W/$F"; git -C "$W" status --porcelain    # hash AFTER === BEFORE; empty
node --test "$W"/test/*.test.js 2>&1 | tail -8           # green again: 494
```

- **M1** — `style.css`: append `\n.roster-title { white-space: normal; }\n` at end of file. Assert applied at the site: occurrences of `.roster-title {` go 1 → 2 **and** `css.lastIndexOf('.roster-title {') > css.indexOf('.roster-status {')` (the new one is after the AS-32 block, not inside it). Predicted red `{T1}`; AS-32 CSS case green.
- **M2** — `style.css`: insert `#roster-list .roster-title { white-space: normal; }\n` immediately above the `/* AS-32: the employee's title` comment (anchor: that comment occurs once). Assert applied: `#roster-list .roster-title {` 0 → 1 and its index < index of `.roster-title {`. Predicted red `{T1}` with the message naming spec `1,1,0`.
- **M3** — `app.js`, inside `orgNodeItem` only: replace `const meta = [node.title, node.class, node.team].filter(Boolean).join(' · ');` with `const meta = node.title || '';`. Assert applied scoped: `node.class` in the `orgNodeItem` region 1 → 0 (whole file: 1 → 0 too, but state the region). Predicted red `{T2}`.
- **M4** — `app.js`, inside `rosterRow`: insert `  item.append(el("div", "roster-extra"));` directly after `  item.append(top);` (anchor: that line occurs once in the file). Assert applied scoped: `el("` in the `rosterRow` region 0 → 1. Run the branch suite → predicted red `{AS-32 el() case}`. Then, **with the mutation still applied**, show the same mutant is invisible to master's test: overwrite the worktree's `api.test.js` with master's copy (`git -C "$W" show master:apps/chat/test/api.test.js > "$W/test/api.test.js"` — it must sit at the same path because of its relative imports; a copy under `/tmp` cannot run), run `node --test "$W"/test/api.test.js` → predicted **green** (the finding), then restore the branch's file with `git -C "$W" checkout -- test/api.test.js` and prove it by hash. Two files are mutated in this recipe (`app.js`, `api.test.js`); hash both before and after.
- **M5** — `dm-sort.js`: append `\nexport const _sink = (n) => { n.innerHTML = ''; };\n`. Assert applied: `.innerHTML` in `dm-sort.js` 0 → 1. Predicted red `{T3}`; message names `dm-sort.js`. (On master the same edit reds nothing — say so from the T3 design, no need to run master for this one; M4 already demonstrates the both-ways technique.)
- **M6** — `app.js`, inside `rosterRow`: replace `const role = el('div', 'roster-title', emp.title);` with `const role = el('div', 'roster-title'); role.innerHTML = emp.title;`. Assert applied scoped: `.innerHTML` in the region 0 → 1. Predicted red: `{T3, AS-32 el() case}` — the AS-32 case reds on its 1292 presence assertion (the line is gone), **not** on a sink line (those are removed). Read the failure text to confirm which assertion fired; if AS-26/AS-54/AS-33 also red, a sink line survived — a finding.

If a predicted-red case stays green, re-read the mutated file's diff before concluding anything (AS-95 sharpening): a wrong-site mutation and a weak guard look identical from outside.

## 8. Test-run recipe

- Host: `node --test /Users/forrest/Code/american-software-company/.worktrees/AS-74/apps/chat/test/*.test.js 2>&1 | tail -8` → `tests 494`, `fail 0`.
- Compose (counted, from the worktree's `apps/chat`, run via `spawnSync` with the absolute docker path from `apps/chat/data/deploy-state.json` `dockerBin` — docker is off PATH for sub-agents): `docker compose run --build --rm test 2>&1 | tee /tmp/AS-74-compose.txt | tail -12`. Valid only with the `Image … Built` line. Not this tick for the planner (Marcus's AS-83 lane owns docker load); the implementer and reviewer each take one.

## 9. Constraints

Zero new dependencies. No `public/`, `lib/`, `server.js`, fixture, or `personnel/` edit; the real `personnel/` is never read by T1 and never mutated by anyone. No protected top-level file. No running container touched (T2/T3 boot their own servers on `listen(0)` via `bootServer`). `lattice` only from the main checkout. Branch `feat/AS-74-roster-truncation-guard`, worktree `.worktrees/AS-74`, commits as `developer-<name>` per the git identity rule, prefix `AS-74:`. Commit early on the branch and keep a progress note in your own scratchpad (`scratchpad/agent-developer-<name>/`) so a tick cutoff is resumable. Do not touch `.worktrees/AS-80` or `.worktrees/AS-83`. Item 5 is already applied on master (this tick) — do not re-apply it on the branch.

## 10. Decisions and deliberate omissions

- **Cascade computation over layout measurement.** The honest instrument for row height needs a browser the suite does not and should not have; the cascade is the property Ruben's mutant violates, it is dependency-free, and it is non-vacuous on the value rather than on a set (§2). The one-off browser calibration stays on AS-32's record.
- **No literal count of rules targeting `.roster-title`.** Considered (AS-80 doctrine) and rejected here because the quantified assertion cannot pass on an empty set; a count pin would only make a harmless colour rule a test edit. If a reviewer finds an empty-set path through T1, that is a finding and the pin goes in.
- **Conservative `@media` flattening.** A wrap-enabling rule under any condition is a violation. The stylesheet's mobile blocks (`@media (max-width: 700px)` at 353 and 473) touch `#sidebar` and `#roster-list li.roster-row` padding, not `.roster-title`, so nothing is falsely flagged today; a future mobile rule on `.roster-title` that keeps nowrap/hidden/ellipsis passes; one that does not is exactly what should fail.
- **Helper inside the test file, not a module** (§1 — compose discovery). If a second stylesheet contract ever needs it, promote it then.
- **Collapse, not defence in depth** (§3 item 4). Recorded so the next screen task does not add a fifth copy: new modules update T3's literal count; they do not add a whole-file sink line.
- **Errata, not rewrite** for AS-32's plan (§3 item 5).
- **Not fixed here:** the `.roster-top` name can still wrap (inherits `white-space: normal` from the row) — outside the AS-32 contract, and a real hire with a 30-character name is the day it matters; QA may file it. `orgNodeItem` has no complete-class-set assertion of its own (only T2's literal-line pin) — same offer.

## 11. People

Implementer: `developer-lena` preferred — the surface is Marcus's AS-32 work and the point of this task is a second pair of eyes on its guards (same reasoning as AS-80). Both Lena and Marcus hold lanes in the tick that planned this; whichever is free first takes it, Marcus acceptable. Reviewer: `qa-priya` — Ruben filed these findings and must not certify their fix (house rule, as Priya on AS-80). Priya's mandate under M6, past the list: mutate what the plan did not name — `display: inline` or `display: -webkit-box; -webkit-line-clamp: 2` on `.roster-title` (T1's `display`/clamp rows must red); a later `text-wrap: wrap`; an earlier `white-space: normal !important`; a `.roster-title` rule inside `@media (max-width: 700px)`; a double-quoted `el("span", "org-extra")` inside `orgNodeItem` (nothing pins that region's class set — decide whether that is a finding worth a task); `.innerHTML` in a module the old guards never covered (`thread-modal.js`) — T3 only. Report cardinality (rules parsed, modules examined) before pass counts (M5). Do not read the Lattice auto-review daemon's artifact before forming findings.
