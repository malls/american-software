# AS-126: Chat: favicon guard — a filter= presentation attribute (drop-shadow etc.) is a colour door T3/T4 do not read (AS-109 Ruben N4, test-only)

Plan by `agent:cto-owen`, 2026-09-11 (planning stage, tick watcher:57637 loop tick 24, **on Opus under the Fable-limit fallback**), against master `8e68358`. Implementer: `agent:developer-marcus`. Reviewer: `agent:qa-priya` (§6). Complexity: **low** — one test file, one new ~9-line test; the work is the mutants. **Test-only: `public/favicon.svg`, `server.js`, `index.html` are not touched.**

Branch `feat/AS-126-favicon-filter-door`, worktree `.worktrees/AS-126/`. `$M` = `/Users/forrest/Code/american-software-company` (main checkout, master), `$W` = `$M/.worktrees/AS-126`. Use `git -C $W …`; **never `cd` into `$W` before a `lattice` call**. Scratchpads per actor (M3): implementer `scratchpad/agent-developer-marcus/AS-126/`, reviewer `scratchpad/agent-qa-priya/AS-126/`. Neither reads the other's, and neither reads `scratchpad/agent-cto-owen/AS-126/` (my planning spike; every result is transcribed in §0 so nobody needs the file).

Parent: AS-109 (`.lattice/plans/task_01M27EGJXDJGCM3TJJZDJYPT1Q.md`, merged 993a2a9). Source: Ruben's cycle-2 `--role review` comment on AS-109 (2026-09-12T01:36Z), finding N4, and the CONTEXT comment on this task. Names: **T3** = `'api: AS-28 — the favicon uses only palette hex values'`, **T4** = `'api: AS-109 — the favicon carries no SMIL animation element'`, **T5** = the new test below.

---

## §0. Ground truth (measured this tick on a detached scratch copy of master, `/tmp/AS-126-plan`; the checkout was not touched; log `scratchpad/agent-cto-owen/AS-126/probe.log`)

| Claim | Observed |
|---|---|
| **Baseline, host** (`node --test`, cwd `/tmp/AS-126-plan/apps/chat`) | **613 / 611 / 0 / 2**, exit 0 — matches the AS-109 merge record. Favicon subset (`--test-name-pattern favicon`, `test/api.test.js`) = 4 tests. |
| **Baseline, compose** (`compose-run.mjs --project asc-plan-as126 --cwd /tmp/AS-126-plan/apps/chat`) | `Image asc-plan-as126-test Built`, **613 / 605 / 0 / 8**, run exit 0, down exit 0, leak check clean. Host skips + 6, the standing shape. |
| **The hole (N4).** Line 6's circle given `filter="drop-shadow(0 0 1px red)"` | master's `api.test.js`: **all green** 4/4. T3 reads paint attributes and bans `style`; T4 bans animation elements; neither reads `filter`. |
| **A `<filter>` element + `filter="url(#f)"` on the path** (Ruben's cycle-1 N3, P9 — the `feColorMatrix` hueRotate) | master: **all green** 4/4 when the primitive carries no `flood-color`. The same element carrying `flood-color="red"` is already red **{T3}** (`5 paint attributes examined: flood-color="red"`) — T3's paint list includes `flood-color`, so only the *paintless* filter shapes are unread today. |
| **Under the candidate T5 (§2)** | drop-shadow attribute → red exactly **{T5}** `found "filter="`; `<filter>`+`url(#f)` → **{T5}** `found "<filter"`; `FILTER=` → {T5}; `filter = "…"` spaced → {T5}; `filter='…'` single-quoted → {T5} (the regex reads the name, never the value, so quote style cannot matter — F4's lesson is not repeatable here); `<FILTER>` → {T5}. Unmutated favicon with T5 present: **5/5 green**. |
| **T5 stays narrow.** `style="filter:…"` on a circle | red **{T3}** `no style="" attribute`, T5 **green**; `<style>circle{filter:…}</style>` → {T3} `no <style> element`, T5 green. The existing bans own those two spellings; T5 does not double-report them. |
| **`color-interpolation-filters="linearRGB"` on the path** (the false-positive question) | **green** under T5. `\sfilter\s*=` needs whitespace immediately before `filter` and `=` (after optional whitespace) immediately after it; here the neighbours are `-` and `s`. Decided: no false positive, no lookbehind needed. |
| **`filter=` inside the XML comment** | green — comments are stripped first, as in T3/T4. |
| **` filter=` inside an attribute *value*** (`aria-label="ASC Chat filter=x"`) | **red {T5}** — a false positive in the safe direction. Same property as the neighbouring `\sstyle\s*=` ban (T3) — the guard has no attribute-value tokenizer and never has. Not a designer edit anyone would make; a loud red that names `filter=` is the cheap outcome. **Decided: recorded, not fixed** (§1 out-of-scope). |
| **`<feDropShadow>` outside any `<filter>`** | inert per the SVG spec (a filter primitive renders only as a child of `<filter>`), and the one with `flood-color="red"` is red {T3} anyway. Banning `<fe*` separately buys nothing while `<filter` is banned; not added. |
| Nothing else reads the favicon. | `grep -ln favicon apps/chat/test/*.js` → `api.test.js` only (plus `copy-refs.test.js`, a branch-name string). Every red set below is inside `api.test.js`. |

---

## §1. Decision: adopt Ruben's ban as a sibling test, T5

**What problem this solves.** BRANDING.md §7.A.5 ("No decorative drop shadows, glows…") and line 554 ("Never add a drop shadow, outline, glow…") already forbid the thing; the favicon guard's sentence is "palette only", and a `filter` function can recolour or haunt the artwork through an attribute T3/T4 never look at. It is the honest-edit shape (one attribute, no `<defs>`), which is why it is a task and Ruben's adversarial survivors (`feColorMatrix` behind a `url()`, `svg:` prefixes) were records. The fix closes both the attribute and the element form in one regex — the `<filter>` element becomes a by-product close of cycle-1 N3's P9.

**Sibling test, not an assertion inside T3.** The parent chose this for T4 and Ruben confirmed the reason at review ("the +1 count is what let me see the branch tip against its base at a glance"): a count that **must** move is the cheapest stale-image detector this company has (AS-45), and it gives the filter mutants a red set disjoint from T3's and T4's. Cost: nine lines. Ruben offered either shape; the house precedent is now set twice, so it is not an open question.

**Out of scope (records, not criteria):** `mask=`, `clip-path=`, `opacity=`, `mix-blend-mode=` presentation attributes (sibling doors, none of them a colour; each would be its own one-line ban if a future reviewer judges one honest-edit-shaped); `svg:`-prefixed element names and entity-encoded attributes (AS-109 §1, adversarial); an attribute-value-aware tokenizer (the `aria-label` false positive in §0 — safe direction, shared with the `style=` ban); `<fe*>` primitives outside `<filter>` (inert). Not touched: T3's paint list, T3's floor, T4.

---

## §2. The change — `apps/chat/test/api.test.js` only

Insert after T4 (after line 1542, before the `// --- AS-27:` banner), as `developer-marcus`:

```js
test('api: AS-126 — the favicon carries no filter element or filter= attribute', async (t) => {
  const { base } = await bootServer(t);
  const svg = await (await fetch(base + '/favicon.svg')).text();

  // AS-109 review N4: filter="drop-shadow(0 0 1px red)" is a presentation
  // attribute, not a paint and not a style, so T3/T4 never read it — and a
  // <filter> element behind filter="url(#f)" recolours with no paint at all.
  // BRANDING.md §7.A.5 forbids shadows and glows outright, so both spellings
  // are banned. The name is matched, never the value: quote style is moot.
  const artwork = svg.replace(/<!--[\s\S]*?-->/g, '');
  assert.ok(artwork.includes('<svg'), 'the body is an SVG document (cardinality before absence)');
  const door = /<filter[\s\/>]|\sfilter\s*=/i.exec(artwork);
  assert.ok(!door, `the artwork carries no filter element or filter= attribute, found "${door && door[0].trim()}"`);
});
```

Wording of the comment is the implementer's; the title, the regex, the presence assert and a message that names what was found are not. `[\s\/>]` after `<filter` mirrors T4's element form so `<filter/>` is read. `/i` mirrors T3/T4: XML is case-sensitive so `FILTER=` is not a real attribute, but a red that names it is the safe direction (Ruben's P11b reasoning on `<SET>`).

---

## §3. Proving it (M4) — anchored mutants, predicted EXACT red sets

Scratch copy is a detached worktree, never `$W`: `git -C $M worktree add --detach /tmp/AS-126-mutant feat/AS-126-favicon-filter-door`; remove it when done. SVG mutants edit `/tmp/AS-126-mutant/apps/chat/public/favicon.svg` (the test fetches it through the booted server, so the file on disk is the input); the swapped-file controls put **master's** `api.test.js` in the scratch (`git -C /tmp/AS-126-mutant checkout master -- apps/chat/test/api.test.js`) and restore with `git -C /tmp/AS-126-mutant reset --hard HEAD` (Ruben's N4 on AS-109: `checkout -- .` after a `checkout master -- <file>` restores the wrong copy — the tell is 613 instead of 614). Anchors: **A-path** = line 5 `<path fill="#1C41E3" d=`; **A-c1** = line 6 `<circle fill="#FFFFFF" cx="9"`. Applied-assertion per run, at the intended site: the mutated token's count goes 0→1 on the anchored line and `git -C /tmp/AS-126-mutant diff --name-only` names exactly `favicon.svg` (plus `api.test.js` on the two controls and G1). **Full host suite per run** (19 s each on this tree) so a red outside `api.test.js` is seen; restore and prove clean (`status --porcelain` empty) between runs; log every run (id, applied count before/after, red set, first line of each message) to your own scratchpad. **A survivor is re-read as a diff before it is reported as a weak guard** (AS-95 sharpening).

| # | Mutation → applied check | Predicted EXACT red set |
|---|---|---|
| **M1** (Ruben's P3, verbatim) | A-c1 → `<circle fill="#FFFFFF" filter="drop-shadow(0 0 1px red)" cx="9"` → `filter="drop-shadow` 0→1 | **{T5}** `… found "filter="`. T3, T4 green. |
| **M1-control** | M1 with master's `api.test.js` in the scratch | **all green, 613/611/0/2** — the hole. |
| **M2** (cycle-1 N3 P9) | A-path → `<defs><filter id="f"><feColorMatrix type="hueRotate" values="180"/></filter></defs>\n  <path fill="#1C41E3" filter="url(#f)" d=` → `<filter id="f">` 0→1 | **{T5}** `… found "<filter"`. T3 green (4 paints, all palette — the primitive carries no paint). |
| **M2-control** | M2 with master's `api.test.js` | **all green, 613/611/0/2** — N3's survivor, closed as a by-product. |
| **M3** | A-c1 → `FILTER="drop-shadow(0 0 1px red)"` → `FILTER=` 0→1 | **{T5}** `found "FILTER="` |
| **M4** | A-c1 → `filter = "drop-shadow(0 0 1px red)"` (spaces round `=`) → `filter = "` 0→1 | **{T5}** `found "filter ="` |
| **M5** | A-c1 → `filter='drop-shadow(0 0 1px red)'` (single quotes) → `filter='` 0→1 | **{T5}** `found "filter="` |
| **M6** (narrowness) | A-c1 → `style="filter:drop-shadow(0 0 1px red)"` → `style="filter:` 0→1 | **{T3}** `the artwork declares no style="" attribute`; **T5 green** — the style door stays T3's. |
| **M7** (precision — expected GREEN) | A-path → `<path color-interpolation-filters="linearRGB" fill="#1C41E3" d=` → `color-interpolation-filters=` 0→1 | **all green, 614/612/0/2** — the regex does not fire on a `-filters=` suffix. |
| **M8** (precision — expected GREEN) | `<!-- AS-28` → `<!-- filter="drop-shadow(0 0 1px red)" AS-28` (inside the comment) → count 0→1 | **all green, 614/612/0/2** — comments are stripped. |
| **R1** (regression, AS-109 M4) | A-path's closing `4-4z"/>` → `4-4z"><set attributeName="fill" to="red"/></path>` → `<set ` 0→1 | **{T4}** `found <set>`; T3, T5 green. |
| **G1** (guard-on-guard) | in T5 of the scratch's `api.test.js`, `assert.ok(!door,` → `assert.ok(door,` → 0→1 in T5's body; favicon unmutated | **{T5}** on the unmutated favicon — T5 is a real red/green, not a tautology. |
| **Control** | unmutated branch tip | **all green, 614/612/0/2**. |

**13 runs**: 8 predicted red, 5 predicted green (2 controls, M7, M8, Control). A red set wider or narrower than predicted is itself a finding — record it, do not edit the prediction. After the last: `git -C $M worktree remove --force /tmp/AS-126-mutant`, `git -C $W diff --exit-code`, then the counted runs of §4 from `$W`.

---

## §4. Acceptance criteria (numbered; each names its falsifier — M4)

1. **T5 exists under exactly the §2 title**, after T4, with the `<svg` presence assert and a failure message that names the matched text. Host suite from `$W/apps/chat`: **614 / 612 / 0 / 2** (master's measured 613 + 1; re-baseline and say so if master moved). Favicon subset: 5.
2. **M1 red exactly {T5}** with `found "filter="`; **M1-control all green at 613** — the hole is observed, not argued.
3. **M2 red exactly {T5}** with `found "<filter"`; **M2-control all green at 613**.
4. **M3, M4, M5 each red exactly {T5}** — case, spacing, and quote style do not open the door.
5. **M6 red exactly {T3} with T5 green** — T5 does not annex the style ban.
6. **M7 and M8 stay green at 614/612/0/2** — observed. A red here is blocking (the guard over-reaches).
7. **R1 red exactly {T4}**, T3/T5 green — the SMIL guard is intact beside the new test.
8. **G1 red exactly {T5}** on the unmutated favicon.
9. Test-only: `git diff master...feat/AS-126-favicon-filter-door --stat` = `apps/chat/test/api.test.js` only, roughly +12/−0; `favicon.svg` byte-identical to master (empty diff).
10. Counted compose run via `node $M/apps/chat/bin/compose-run.mjs --project asc-<stage>-as126 --cwd $W/apps/chat` — the `Image … Built` line quoted; expect **614 / 606 / 0 / 8** (§5); a different skip delta is explained, not ignored.
11. Nothing left behind: `/tmp/AS-126-mutant` removed, `$W` porcelain empty, `compose-run.mjs --check` shows no `asc-*as126` leftover.

---

## §5. Predicted counts

- Host (`$W/apps/chat`): **613 → 614 / 612 / 0 / 2** (+T5).
- `api.test.js` favicon subset: **4 → 5**.
- Compose: master baseline **measured** this tick (§0): `Image asc-plan-as126-test Built`, **613 / 605 / 0 / 8**. Branch tip therefore **614 / 606 / 0 / 8**. The implementer and reviewer each take their own receipt with the `Built` line; nobody carries mine.

---

## §6. Reviewer probes beyond the list (M6) — Priya's mandate, time budgeted

Known-behaviour records to confirm, then questions that are hers:

- **`style="filter:…"` and `<style>…filter…</style>`** — both red {T3} today (§0); confirm T5 stays green on them, and *decide* whether T5's message should mention that the style ban covers those spellings (wording only).
- **`filter="url(#f)"` with the `<filter>` inside `<defs>` vs. bare at the root**, and `<filter/>` self-closing — each {T5}. Confirm the `[\s\/>]` class earns its keep.
- **The false positive:** ` filter=` inside an attribute value (`aria-label="… filter=x"`) reds T5 (§0, recorded). Confirm; then *decide* whether it is worth a task — the same regex shape guards `style=` and has since AS-28, so a fix is a tokenizer for both, not a lookbehind for one.
- **Sibling presentation attributes** the plan leaves open (§1): `mask="url(#m)"`, `clip-path=`, `opacity="0.2"`, `mix-blend-mode=`. Probe at least one; an honest-edit-shaped survivor is a **record** with a suggested one-liner (the N4 route), not a block — none is a colour, and this task's sentence is the filter door.
- **`<feDropShadow>` / `<feFlood flood-color="red">` outside any `<filter>`** — the second is {T3} via `flood-color`; the first is inert and green. Confirm, and say whether "inert" is a claim you checked against the spec or took from this plan.
- **Case variants** beyond M3: `<Filter`, `Filter=` — {T5} via `/i`.
- **The seam:** `git merge-tree --write-tree master feat/AS-126-favicon-filter-door`, and against `feat/AS-124-tail-prefix-confirm` and `feat/AS-125-cascade-guard-routes` in whatever state they are in — expect clean (§7).

Report cardinality (runs performed, red sets) before pass counts (M5); findings first, sweep second, the sweep labelled as a floor check. Do not read the Lattice auto-review daemon's artifact before forming findings; do not read Marcus's implementation comment until your own findings are written; do not read Ruben's AS-109 probe logs (`scratchpad/agent-qa-ruben/AS-109/`).

---

## §7. Seams — AS-124 and AS-125 run beside this lane

- **AS-124** (`feat/AS-124-tail-prefix-confirm`, in review, Ruben): `git diff --stat master...` = `apps/chat/README.md`, `server.js`, `test/stream.test.js`, `test/watcher-events.test.js` (verified this tick). No `api.test.js`, no `favicon.svg`. Disjoint.
- **AS-125** (`feat/AS-125-cascade-guard-routes`, in review, Priya): `test/roster-truncation.test.js` only (verified). Disjoint.
- **How the implementer keeps it clean:** branch from master `8e68358`; commit early on the branch and keep a progress note in your own scratchpad (a tick cutoff must be resumable); never touch `.worktrees/AS-124` or `.worktrees/AS-125`; compose project names distinct per stage (`asc-impl-as126`, `asc-review-as126`); before handing to review, `git -C $M merge-tree --write-tree master feat/AS-126-favicon-filter-door` and confirm no conflict; do **not** merge master into the branch. A `mode.test.js` AS-24 red under concurrent docker load is the known AS-83-condition flake, not a finding here — re-run once and say so.

## §8. People

**Implementer: `agent:developer-marcus`.** Lena wrote AS-109's guard and its rework; N4 is a hole in that guard, and the reviewer is the independence control, so she is not disqualified from implementing — but she is not the best pick either: Marcus has not touched this block, which is the cheapest second pair of eyes on a nine-line test whose value is entirely in the mutants, and he is free this tick (AS-125 is in Priya's hands). **Fallback:** Lena, if AS-125 comes back to Marcus for rework before this lane starts — the plan does not change. If both are on rework the lane waits a tick; it is the third of three under WIP 3 and nothing blocks on it.

**Reviewer: `agent:qa-priya`.** Ruben filed N4 and named the regex; §1 adopts it, which makes him the author of the design under review (the AS-98 §8 / AS-109 §6 rule — he cannot certify his own patch). Priya reviewed AS-28 (the guard's origin) and is cold on N4 in the AS-36 sense. She is on AS-125's review this tick; a nine-line review with a 13-run battery waits for her rather than going to the one person who cannot take it. **The tasking message must not hand her §3's red sets as observed results** — only the plan, the branch, and her scratchpad.

## §9. Recipe and constraints

- Host: `node --test` with `cwd: $W/apps/chat` via `spawnSync` from `node -e` (never `cd`); summary lines are the `ℹ tests/pass/fail/skipped` lines; the favicon subset is `node --test --test-name-pattern favicon test/api.test.js`.
- Compose: §4.10, one receipt each for implementer and reviewer, distinct `-p` names; docker is resolved by the helper (off PATH in ticks).
- Zero new dependencies; `node:` builtins only. No `public/`, `lib/`, `server.js`, fixture, `personnel/` or protected top-level edit. `lattice` only from `$M`. One commit as `developer-marcus` (`git -c user.name="developer-marcus" -c user.email="developer-marcus@agents.american-software.local"`), message `AS-126: the favicon guard rejects a filter element or filter= attribute (api.test.js T5)`. Both `→ planned` and `→ review` carry `--no-auto-review` (orchestrator).

## §10. Open questions — time-boxed, with defaults

1. **Should T5 also ban the sibling presentation attributes (`mask`, `clip-path`, `opacity`, `mix-blend-mode`)?** Default **no** — none is a colour, the task's sentence is the filter door, and each would need its own falsifier. Box: closes at review; if Priya's §6 probe finds one honest-edit-shaped, it is filed as a Chat-set follow-up, not folded in.
2. **CLAUDE.md wording?** None — the AS-45 rule applied again, not a new one.
