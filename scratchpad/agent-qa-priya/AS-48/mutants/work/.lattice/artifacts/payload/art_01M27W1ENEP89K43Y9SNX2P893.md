Lattice-Reviewed-Commit: 57243c89fc56f64b8ef7425a301d4ca4f2378c2b

# AS-74 review — Lattice auto-fired code-review daemon

> Provenance: this artifact was produced by the Lattice auto-review daemon (generic actor), not by a `qa-*` employee. Per `CLAUDE.md` § "Lattice's auto-fired review is NOT the company's review gate" it is third-party tooling output. It does not satisfy the review gate and the named reviewer (Priya) must not read it before forming her own findings. Nothing in the AS-74 worktree, `.lattice/`, or master was modified: every run below was on a scratch copy of `.worktrees/AS-74/apps/chat` under `/tmp/as74-autoreview/`.

Reviewed: `feat/AS-74-roster-truncation-guard` at `ba4fce9` (commits `527afb1`, `ba4fce9`) against master `57243c8`. Diff: `apps/chat/test/api.test.js` (+98/−15) and new `apps/chat/test/roster-truncation.test.js` (+316). No production, fixture, `.lattice/`, or `package.json` change (AC-9 observed via `git diff --stat master...`).

### 1. Verdict

**FAIL (implementation-level)** — one major finding outside the criteria list; every numbered criterion the daemon could exercise passed. The rework is small and targeted (one function, one helper case, one mutant); the plan and its chosen observable are sound and should not be reworked.

### 2. Summary

The branch adds a dependency-free cascade computation over `style.css` (T1 + helper cases H1–H5), pins the org-chart label (T2), widens the AS-32 class-set regex to both quote styles, and collapses four whole-file sink assertions into one enumerating guard over all 12 served modules (T3). All six plan mutants produced exactly their predicted red sets, H1–H5 each go red on a flipped expectation, and the M4 both-ways demonstration holds. Probing past the list found that T1's `targets()` only recognises a rule whose subject compound carries `.roster-title`, so a higher-specificity rule with a **type or universal subject** (`#roster-list div { white-space: normal }`) out-ranks the AS-32 rule in a browser while T1 stays green — the very property the test's name claims to guard.

### 3. Issues

**[MAJOR] apps/chat/test/roster-truncation.test.js:526–530 — `targets()` cannot see a type/universal-subject rule that out-ranks `.roster-title`**
`targets(selector, cls)` returns true only when the selector's last compound contains `.roster-title`. The element is a `div.roster-title` (its class set is pinned to exactly that by the AS-32 `el()` case), so any rule whose subject compound is `div`, `*`, or a pseudo-class-only compound also applies to it. Two probes, each a one-line append to the scratch stylesheet, mutation applied and verified by content:
- P1 `#roster-list div { white-space: normal; }` — spec (1,0,1) beats `.roster-title` (0,1,0) in every browser; suite **494/494 green**.
- P2 `#roster-list li.roster-row > * { white-space: normal; overflow: visible; }` — spec (1,1,1); suite **494/494 green**.
Both re-enable wrapping exactly as Ruben's original mutant did. The plan's §2 property is "no rule anywhere in the file, at any specificity, in any `@media` block, may out-rank them"; the helper's implementation narrows that to "no rule *naming the class in its subject*", and the narrowing is not stated as a deliberate omission in §10 (only the descendant `.roster-title *` case is). These are plausible future edits (a roster-wide reset rule), so the blind spot is live, not theoretical.
**Fix:** widen `targets()` so a rule is a candidate when its subject compound *could* match a `div.roster-title` element — i.e. every simple selector in the last compound is one of `*`, `div`, `.roster-title`, or a pseudo-class (`:hover`, `:first-child`, …; conservative, as with `@media`), and no other class, id, attribute, or type appears in that compound. Ancestor compounds cannot be evaluated without a DOM and stay conservative (assumed to match). Add an H-case (`css-cascade: a type or universal subject that could match the element competes`) with `#r div` / `#r *` / `#r span` (the last must **not** target), add P1 to the plan's mutant set with predicted red `{T1}`, and keep the "base `.roster-title` rule must be among the targeting selectors" assertion as is. The existing conservative stance (anything that *might* apply is a candidate) already justifies this direction.

**[MINOR] apps/chat/test/roster-truncation.test.js:624–644 — `width`/`min-width` are not in the CONTRACT table, so the ellipsis half can be defeated silently**
Probe P8: append `.roster-title { width: max-content; }` → suite 494/494 green. In a browser the block grows to its text width and overflows the row horizontally with no ellipsis (the row stays one line, so the *height* half survives). `min-width: max-content` and `flex: none`-style widths behave the same if the row ever becomes a flex container. Not blocking — the plan explicitly scopes T1 to the line-box precondition — but the table already watches `height`/`max-height` on the same reasoning.
**Fix:** add `['width', [null]]`, `['min-width', [null]]`, `['max-width', [null]]` (any explicit value must come through the test) and record it in the plan table.

**[MINOR] apps/chat/test/roster-truncation.test.js:416–439 — a brace-less at-rule (`@import`, `@charset`) would silently swallow the next rule**
`parseBlocks` starts each prelude at the previous `}` (or 0), so `@import "x.css";\n.a { … }` yields the prelude `@import "x.css";\n.a`, which starts with `@`, does not match `FLATTENED_AT`, and is dropped together with `.a`'s declarations. `style.css` has no `@import`/`@charset` today (0 occurrences), and the `rules.length > 100` floor would not catch a one-rule loss.
**Fix:** in `parseBlocks`, when computing `prelude`, keep only the text after the last `;` at depth 0 (`prelude = prelude.slice(prelude.lastIndexOf(';') + 1)`), or throw on a prelude containing `;` so the parser refuses loudly, matching the `UNSCORABLE` stance.

**[MINOR] apps/chat/test/api.test.js:1198 — AS-33 case name now lies**
The case is still titled `…org-chart.js is served, imported, and holds the no-innerHTML line`, but this diff removes that line from its body (the body's comment says so). A test name is the first thing a future reader greps for.
**Fix:** rename to `…is served, imported, and pure (no DOM API)` or similar; predicted host count unchanged.

**[MINOR] apps/chat/test/api.test.js:299–301 (T2) — unguarded `indexOf` end anchor**
`app.slice(start, app.indexOf('\n}\n', start))` — if the terminator is ever absent, `indexOf` returns −1 and the region becomes the whole file minus one character, and the `exactly once` assertions would then count file-wide occurrences of `node.class`. Same pattern as the AS-32 case, so consistent, but new code need not inherit it.
**Fix:** `const end = app.indexOf('\n}\n', start); assert.ok(end !== -1, …);`.

**[INFO] orgNodeItem class set is unpinned (probe P9)** — `row.appendChild(el("span", "org-extra"))` inside `orgNodeItem` → 494/494 green. The plan §11 already flags this as a "decide whether it is worth a task" item; nothing pins that region's class set. Not a finding against this diff.

**[INFO] Probe P5 (earlier `.roster-title { white-space: normal !important; }`) reds `{T1, AS-32 CSS case}`, not `{T1}` alone** — the AS-32 case anchors on the first `.roster-title {` occurrence, so an *earlier* same-selector rule moves its anchor. Wider than a "T1-only" expectation but both reds are correct; worth recording so a reviewer does not read the second red as a regression.

### 4. Positive Observations

- **Every plan mutant hit exactly its predicted set** (scratch copy, whole suite, 494 cases each run): M1 `{T1}` 493/1; M2 `{T1}` 493/1 with the message naming spec 1,1,0; M3 `{T2}` 493/1; M4 `{AS-32 el() case}` 493/1 on the branch **and green (60/60) with master's `api.test.js` at the same path** — the finding shown both ways; M5 `{T3}` 493/1, message names `dm-sort.js`; M6 `{T3, AS-32 el() case}` 492/2 and nothing from AS-26/AS-54/AS-33 — proof the four sink lines were actually removed, not merely commented.
- **Priya's §11 mandate items all red as intended:** `display: inline` (P3), `text-wrap: wrap` (P4), a `.roster-title` rule inside `@media (max-width: 700px)` (P6), `display: -webkit-box; -webkit-line-clamp: 2` (P7), `insertAdjacentHTML` in `thread-modal.js` (P10, `{T3}` — a module no old guard covered).
- **H1–H5 are real cases:** flipping one expected value in each produced exactly that one red (5 flips, 5 singleton sets).
- **Non-vacuity by construction is genuine.** T1 asserts on the winner's *value*; with zero targeting rules `white-space` is unset and fails on its own. The cardinality-first message (rules parsed, targeting selectors with spec and order) is exactly the house convention.
- **The helper refuses rather than guesses** on `:is/:where/:not/:has` and ignores `@keyframes` bodies; the `@media` flattening is conservative in the right direction for a contract stated "at every width".
- **T3's literal 12 is correct on both master and the branch** (`ls public/*.js` — 12 files each), so the AS-80/AS-83 merges in flight do not move it.
- **Item 3's widened regex changes no value today** (`el("` occurs 0 times in `app.js`) and closes the hole rather than moving it; the 1292 presence assertion correctly stays single-quoted.
- Host suite on the branch: **494 pass / 0 fail** (master 486 + 8, matching the plan's prediction).

### Compose receipt

See addendum below (taken after this section was written, under project name `as74autoreview`, so the running `asc-chat` container was not touched).

#### Addendum — compose receipt (taken after the sections above)

Run: `/usr/local/bin/docker compose -p as74autoreview run --build --rm test` from `.worktrees/AS-74/apps/chat` (read-only on the worktree; project name isolated from the running `asc-chat` container; images removed afterwards with `down --rmi local`). Full log at `/tmp/AS-74-autoreview-compose.txt`.

```
 Image as74autoreview-test Building
 Image as74autoreview-test Built
ℹ tests 494
ℹ pass 491
ℹ fail 3
✖ mode: AS-24 — API-mode writes land in the server view; no DB file is ever created
✖ mode: AS-24 — full command sweep in API mode (no DB file, direct-mode shapes)
✖ parity: the CLI roster row is the server roster row minus self, in direct and api mode
```

- The build line is present, so the count is valid: **494 examined** (host 494 / compose 494, delta 0 — not the delta-2 the plan carried over from AS-82's receipt; the implementer's own receipt also reported 494, so the delta has closed since AS-82 and is not an AS-74 artefact).
- All three failures are the AS-24 probe refusal (`something is listening at http://127.0.0.1:NNNNN but the probe failed`) and one downstream empty-JSON parse in `roster-parity.test.js`. None of the three files (`mode.test.js`, `roster-parity.test.js`, `lib/client.js`) is touched by this diff; every AS-74 case (T1–T3, H1–H5) and every case the diff edits passed in the container. The failure signature is the probe-budget behaviour AS-83 is fixing (`feat/AS-83-probe-budget` edits exactly `lib/client.js` and `mode.test.js`), and this run executed under linux/amd64 emulation concurrently with other docker work on the host, so **the daemon attributes the three reds to load-induced probe timeouts, not to this branch — but that attribution is not proven here** (no re-run was taken within the daemon's time budget). The named QA reviewer's own counted compose run should be treated as the receipt of record; if it also shows these three red, that is a pre-existing environmental flake to file against AS-83's line, not an AS-74 finding.

#### Cardinality summary (M5 ordering: examined before passed)

| Check | Examined | Result |
|---|---|---|
| Host suite, scratch copy of branch | 494 cases | 494 pass / 0 fail |
| Plan mutants M1–M6 | 6 mutants, whole suite each | 6/6 exact predicted sets (M4 also green with master's test, 60/60) |
| Helper flips H1–H5 | 5 flips | 5/5 singleton reds |
| Probes past the list | 10 (P1–P10) | 6 red as intended (P3, P4, P5, P6, P7, P10); **2 survivors that break the contract (P1, P2 — the major finding)**; 2 documented/lesser survivors (P8 width, P9 org class set) |
| Acceptance criteria 1–11 | 11 | 10 observed pass; AC-10 (compose) valid build receipt with 3 out-of-scope reds, see addendum |
