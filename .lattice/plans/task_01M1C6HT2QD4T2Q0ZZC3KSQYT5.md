# AS-32: Chat sidebar — show each employee's title in the roster rows

Planner: `agent:cto-owen` (2026-09-03). Implementer: `agent:developer-marcus`.
Smallest task in the chat cluster; the plan is sized to it. The discipline that
matters here is §6 and the responsive instrument in §3.5 — not length.

## 0. Verification of the description's premise (done, not inherited)

The description was written before AS-33 landed and claims (a) the data already
flows end to end, (b) this is frontend-only. Both re-checked at `516ff19`:

- `lib/personnel.js` `readPersonnel()` emits `title` per dossier (`title: fm.title ?? ''`).
- `server.js` `GET /api/roster` maps `title` into every row — **and AS-33 widened
  that row**: it now also carries `class`, `team` and `reportsTo`
  (`server.js` ~L232-246). The row shape did move; it moved in our favour, and
  it changes a design question (§3.4), not the scope.
- `public/app.js` `rosterRow()` still spends `title` on one hover tooltip:
  `name.title = emp.title;` — the only occurrence of `emp.title` in the file
  (measured, §6 baseline).

Premise holds. No server, parser, endpoint or schema change is needed.

## 1. Scope

**In:** render each active employee's `title` as visible text in the
`#roster-list` sidebar rows; keep the row one fixed height whatever the title's
length; keep the full title reachable; guard the new rendering path with tests.

**Not in:** the org chart's node label (AS-33, unchanged); `#dm-list` rows for
non-roster DMs (no dossier, so no title exists to show — the description's
"consider if trivial" is answered: there is nothing to render); the typeahead;
the server, the endpoint, `lib/personnel.js`, the frontmatter schema; anything
in `dm-sort.js` or its ordering; adding `class`/`team` to the sidebar (§3.4).

## 2. File-level scope

Exactly three files change:

| File | Change |
|---|---|
| `apps/chat/public/app.js` | `rosterRow()` only — one appended block, one replaced line |
| `apps/chat/public/style.css` | one new `.roster-title` rule + one `.active` colour rule |
| `apps/chat/test/api.test.js` | two new tests (§5 AC7, AC8) |

Nothing else. A diff touching `server.js`, `lib/personnel.js`,
`public/org-chart.js`, `public/dm-sort.js`, `index.html`, or any other test file
is out of scope and should come back to planning.

## 3. Design

### 3.1 One formatter or two — **two, deliberately.**

`orgNodeItem()` (app.js ~L806) renders
`[node.title, node.class, node.team].filter(Boolean).join(' · ')`. The sidebar
renders `emp.title`, alone. These do **not** share a formatter, and that is a
decision, not an omission.

The shared thing between the two views is already shared at the right layer:
one field, `title`, read once in `lib/personnel.js` and shipped by both
endpoints. That is the coupling that must not be duplicated. The *presentation*
should not be: the chart is a 760px modal whose entire job is org structure, so
class and team are its subject; the sidebar is a 240px column whose job is "who
is this person I am about to DM". A shared formatter would mean every future
change to the chart's meta line silently changes the DM list, which is a worse
failure than two three-word expressions drifting apart. The divergence is
pinned by AC7's exact-class-set assertion, so drift is a test failure rather
than a surprise.

### 3.2 What "truncate gracefully" means, precisely

Mechanism: **CSS single-line ellipsis on a dedicated block element.** Note the
existing `#sidebar li` ellipsis does *not* reach roster rows —
`#roster-list li.roster-row` sets `white-space: normal` (style.css L88), so
without an explicit rule "Cofounder & Chief Technology Officer" **wraps** and
the row grows. The rule is therefore load-bearing, not decoration.

The contract, stated so it is checkable:

> Every `.roster-title` box is exactly one line tall at every viewport width,
> and no roster row causes horizontal overflow in `#sidebar`. Where the string
> does not fit, it is clipped with an ellipsis and the full string remains
> available on hover.

Asserted in two places, because neither alone is sufficient:
- **Lexically** (AC8): the `.roster-title` rule contains all three of
  `white-space: nowrap`, `overflow: hidden`, `text-overflow: ellipsis`. This
  proves the rule was written. It cannot prove it *worked*.
- **Geometrically** (§3.5, AC9): CSS truncation is invisible to a DOM test —
  `textContent` is the full string whether or not a single pixel is clipped.
  The claim is about rendered geometry, so it is measured in a real browser:
  all `.roster-title` heights equal (no wrap), at least one row with
  `scrollWidth > clientWidth` (the ellipsis is actually engaged — otherwise the
  check is vacuous), and `#sidebar.scrollWidth <= clientWidth + 1`.

### 3.3 The tooltip — **kept, and extended to the new element.**

`name.title = emp.title` stays exactly as it is (existing behaviour; removing it
is a regression nobody asked for). The new `.roster-title` element gets the same
`title` attribute, because it is the element that gets clipped and hovering the
clipped text is where a person looks for the full string. Two hover targets,
one string; the redundancy costs one line and is the entire fallback for the
truncation in §3.2.

### 3.4 Class and team — **title only.**

The row now carries `class` and `team` (AS-33). The sidebar shows neither.
Decided on what a person scanning a DM list needs, not on what the data holds:
`title` answers "who do I ask about this"; `class` is an internal tier
(`cofounder`/`c-level`/`manager`/`ic`) that answers a permissions question
nobody has while picking a DM; `team` is a grouping concept, and if it ever
earns a place in the sidebar it will be as grouping or sort order, not as a
third noise token in a 240px column. The org chart is where structure is the
question, and it is one click above the roster.

### 3.5 The responsive instrument — measure the viewport you actually got

Precedent and the reason for this clause: an earlier screen task's only
near-miss was a headless browser silently ignoring a width flag and producing
screenshots of a 500px layout labelled 375px. **A screenshot is not evidence of
a width.** The verification step below is mandatory and its step 0 is a hard
abort, not a note.

Run `docker compose up` in `apps/chat/`, open the app, pick an identity so the
roster renders, and run this snippet in the browser console **twice**: once at a
desktop width (window ≥ 1000px, `TARGET = 240` — the sidebar's fixed width) and
once at 375px (`TARGET = 280`, the drawer's `min(280px, 85vw)`; the drawer must
be opened first via `#sidebar-toggle`).

```js
const TARGET = 240; // 240 desktop | 280 at a 375px window
const sb = document.querySelector('#sidebar');
const client = document.documentElement.clientWidth;
const sbw = Math.round(sb.getBoundingClientRect().width);
console.log('VIEWPORT', { innerWidth: window.innerWidth, client, sidebar: sbw });
if (sbw !== TARGET) throw new Error(`sidebar is ${sbw}px, not ${TARGET} — the viewport lied; stop`);
const rows = [...document.querySelectorAll('#roster-list li.roster-row')];
const titles = [...document.querySelectorAll('#roster-list .roster-title')];
console.log('CARDINALITY', { rows: rows.length, titles: titles.length });
console.log('CHILDREN', JSON.stringify([...rows[0].children].map((c) => c.className)));
console.log('HEIGHTS', JSON.stringify([...new Set(titles.map((t) => Math.round(t.getBoundingClientRect().height)))]));
console.log('CLIPPED', titles.filter((t) => t.scrollWidth > t.clientWidth).map((t) => t.textContent));
console.log('OVERFLOW', { sbScroll: sb.scrollWidth, sbClient: sb.clientWidth, doc: document.documentElement.scrollWidth });
console.log('TOOLTIP', titles[0].title, document.querySelector('#roster-list .roster-name').title);
console.log('IMGS', document.querySelectorAll('#roster-list img').length);
```

Required readings, recorded verbatim in a Lattice comment (both widths):
- `VIEWPORT` printed and the abort not taken — the width is measured, not asserted by a flag.
- `CARDINALITY`: `rows` == active headcount, `titles` == number of active employees with a non-empty `title`. Cardinality before quantification.
- `CHILDREN`: `["roster-top","roster-title","roster-status"]` — DOM order, which the lexical test cannot prove.
- `HEIGHTS`: **exactly one distinct value.** Two values means something wrapped.
- `CLIPPED`: **non-empty at the 240px desktop width** (Owen's title clips there). An empty `CLIPPED` at both widths means the ellipsis was never exercised and the check is vacuous — say so and re-run against a temporarily lengthened title rather than recording a pass.
- `OVERFLOW`: `sbScroll <= sbClient + 1`.
- `IMGS`: `0` (see §6 R3).

Screenshots at both widths are welcome as illustration. They are not the evidence; the console readings are.

### 3.6 Must not move

The AS-18 pin/sort behaviour (`rosterOrder`, pins, `.pin-toggle` geometry and
hit target), the AS-23 mobile layout, `#roster-list`'s existing assertions, the
`/api/roster` envelope, `lib/personnel.js`, the frontmatter schema, and the
`orgNodeItem` meta line. `public/dm-sort.js` and `test/dm-sort.test.js` must be
byte-identical after this task.

## 4. Key files and the literals that move

### `apps/chat/public/app.js` — `rosterRow()` only

Replace the single line `item.append(top, status);` with:

```js
  item.append(top);
  // AS-32: the title on its own line — a 240px column has no room for an
  // inline suffix beside the name, badge and pin. Empty title renders no
  // element at all (no blank line, no `title=""`).
  if (emp.title) {
    const role = el('div', 'roster-title', emp.title);
    role.title = emp.title; // the clipped text is where you hover for the full string
    item.append(role);
  }
  item.append(status);
```

`name.title = emp.title;` is unchanged. No other line in the file changes.

New literals in app.js: `'roster-title'` (×1), `emp.title` (1 → 3).

### `apps/chat/public/style.css` — immediately above the `.roster-status` rule

```css
/* AS-32: the employee's title, one line under the name. nowrap + ellipsis is
   load-bearing, not decoration: #roster-list li.roster-row sets
   white-space: normal, so without this a long title ("Cofounder & Chief
   Technology Officer") wraps and the row grows. One fixed line at every width
   is the contract; the full string stays on hover (title attribute). */
.roster-title {
  font-size: 11px; color: #bfa8c0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
#roster-list li.roster-row.active .roster-title { color: #d7e6f2; }
```

New literals in style.css: `.roster-title` (×2), a second `text-overflow`
occurrence (1 → 2).

### `apps/chat/test/api.test.js` — two new tests, exact titles (AC7, AC8, AC9)

```
'api: AS-32 — served app.js renders the roster title through el() and shows title alone'
'api: AS-32 — style.css truncates the roster title to one line'
```

These names are pinned because §6's predicted failing sets name them.

### Not moving (assert by diff)

`server.js`, `lib/personnel.js`, `public/org-chart.js`, `public/dm-sort.js`,
`public/index.html`, `test/dm-sort.test.js`, `test/org-chart.test.js`,
`test/personnel.test.js`, every fixture under `test/fixtures/`.

## 5. Acceptance criteria

1. Every roster row for an employee with a non-empty `title` shows that title as
   visible text, in DOM order `roster-top` → `roster-title` → `roster-status`.
2. An employee with an empty `title` renders **no** `.roster-title` element —
   not an empty one.
3. The title element never wraps: all `.roster-title` boxes are one line tall
   and equal in height, at both measured widths (§3.5 `HEIGHTS`).
4. No horizontal overflow: `#sidebar.scrollWidth <= clientWidth + 1` at both
   widths (§3.5 `OVERFLOW`).
5. The full title remains reachable on hover from both the name and the title
   element (§3.5 `TOOLTIP` prints the full string twice).
6. AS-18 pin/sort and AS-23 mobile behaviour unchanged: `dm-sort.js` and
   `test/dm-sort.test.js` byte-identical; `.pin-toggle` hit target unchanged;
   all 233 existing tests still pass (baseline §6.0).
7. Test `'api: AS-32 — served app.js renders the roster title through el() and shows title alone'`
   exists and asserts, over the served `app.js`, scoped to the `rosterRow`
   function body (bounded with `indexOf('function rosterRow(emp) {')` …
   `indexOf('\n}\n', start)`, the AS-54 precedent at api.test.js:866):
   - the **complete** sorted set of class-name literals passed to `el()` in that
     region `deepEqual`s
     `['badge','pin-toggle','ref-link','roster-name','roster-row','roster-status','roster-title','roster-top']`
     — exact contents, so a missing class *and* a stray extra one both fail;
   - the region contains `emp.class` zero times and `emp.team` zero times
     (§3.1/§3.4 divergence is pinned, not accidental);
   - the region creates the title via `el('div', 'roster-title', emp.title)` and
     the whole served `app.js` contains zero occurrences of each of
     `.innerHTML`, `insertAdjacentHTML`, `outerHTML`, `document.write` — the
     no-innerHTML house rule extended to the sinks a *third* rendering path
     could reach for. No new public/ module arrives here, so the existing
     structure-first guard needs no new module coverage; what it needs is that
     the new path is inside the file it already covers and goes through `el()`.
8. Test `'api: AS-32 — style.css truncates the roster title to one line'` exists
   and asserts, over the served `style.css` **scoped to the `.roster-title`
   rule body**, that it contains `white-space: nowrap`, `overflow: hidden` and
   `text-overflow: ellipsis`.
9. The §3.5 instrument was run at both widths and its readings are recorded
   verbatim in a Lattice comment, including the `VIEWPORT` line proving the
   measured sidebar width, and `CLIPPED` non-empty at 240px.
10. Diff touches exactly the three files in §2.

## 6. Falsification recipes

**§6.0 Baselines — every grep below was run at `516ff19` before this plan was
written, with `grep -oF … | wc -l` (never `grep -c`, which counts lines):**

| Measurement | Baseline | After |
|---|---|---|
| `grep -oF 'roster-title' apps/chat/public/app.js` | 0 | 1 |
| `grep -oF 'emp.title' apps/chat/public/app.js` | 1 | 3 |
| `grep -oF '.innerHTML' apps/chat/public/app.js` | 0 | 0 |
| `grep -oF 'insertAdjacentHTML' apps/chat/public/app.js` | 0 | 0 |
| `grep -oF 'outerHTML' apps/chat/public/app.js` | 0 | 0 |
| `grep -oF 'document.write' apps/chat/public/app.js` | 0 | 0 |
| `grep -oF 'emp.class' apps/chat/public/app.js` | 0 | 0 |
| `grep -oF 'emp.team' apps/chat/public/app.js` | 0 | 0 |
| `grep -oF '.roster-title' apps/chat/public/style.css` | 0 | 2 |
| `grep -oF 'text-overflow' apps/chat/public/style.css` | 1 | 2 |
| `grep -oF 'AS-32' apps/chat/test/api.test.js` | 0 | ≥2 |
| `node --test` in `apps/chat` | **233 pass, 0 fail** | 235 pass, 0 fail |

**Mutation hygiene, applies to every recipe:** mutate a **scratch copy**
(`cp -R apps/chat "$SCRATCH/chat-mut"`), never the task worktree. If a mutation
must ever happen in place: back up, `trap` the restore on `EXIT`, mutate,
**assert the mutation applied** (an unapplied mutation is indistinguishable from
a passing checker), observe, restore, prove with `git diff --exit-code`. Record
the exact failing set; a wider or narrower set than predicted is itself a
finding.

**R1 — the title line is actually rendered.** Step 0: confirm the two AC7/AC8
test names exist (`grep -oF 'api: AS-32' test/api.test.js | wc -l` == 2). In the
scratch copy, delete the four-line `if (emp.title) { … }` block from
`rosterRow`. Assert applied, scoped to the region the mutation edits:
`awk '/^function rosterRow\(emp\) \{/,/^\}/' public/app.js | grep -oF 'roster-title' | wc -l` goes 1 → 0.
Run `node --test test/api.test.js`.
**Predicted failing set — exactly one case:**
`'api: AS-32 — served app.js renders the roster title through el() and shows title alone'`.

**R2 — the truncation rule is real.** In the scratch copy, delete
`text-overflow: ellipsis;` **from inside the `.roster-title` block only** — the
file has a second, older `text-overflow` occurrence, which is why the assertion
is region-scoped. Assert applied both ways:
`grep -oF 'text-overflow' public/style.css | wc -l` 2 → 1, **and**
`sed -n '/^\.roster-title {/,/^}/p' public/style.css | grep -oF 'text-overflow' | wc -l` 1 → 0.
**Predicted failing set — exactly one case:**
`'api: AS-32 — style.css truncates the roster title to one line'`.
Note what this recipe does *not* prove: with the rule deleted the title wraps,
and no DOM test can see that. AC3/AC9's geometry reading is the only instrument
that can, which is the point of §3.5.

**R3 — markup out of a personnel field into the sidebar.** The `title` field is
free text read straight off a dossier; nothing between the file and the DOM
sanitises it, so the `el()`/`textContent` path is the *only* defence and must be
proven, not assumed.
(a) In the AC7 test, boot a second server on a temp root (`mkdtempSync` +
`personnel/hostile.md`, the `test/org-chart.test.js` pattern — never mutate
`test/fixtures/repo`, whose roster membership existing tests assert on) whose
frontmatter reads `title: <img src=x onerror="alert(1)">`. Assert
`GET /api/roster` ships that string **verbatim**: the server does not escape,
and a test that expected it to would be asserting a defence that does not exist.
(b) Then falsify the client-side defence: in the scratch copy replace
`const role = el('div', 'roster-title', emp.title);` + `role.title = …` with
`const role = el('div', 'roster-title'); role.innerHTML = emp.title;`. Assert
applied: `grep -oF '.innerHTML' public/app.js | wc -l` 0 → 1.
**Predicted failing set — exactly three cases:**
`'api: AS-32 — served app.js renders the roster title through el() and shows title alone'`,
`'api: AS-26 — msg-refs.js and markdown.js are served; index.html ships the file modal'`,
`'api: AS-54 — served app.js autolinks through markdown.js and never inside a markdown link'`
(the last two carry the pre-existing whole-file `doesNotMatch(app, /\.innerHTML/)`).
If AS-33's `'api: AS-33 — org-chart.js is served…'` also fails, that is a wider
set than predicted and a finding — it guards `org-chart.js`, which this task
does not touch.
(c) Browser leg, on the unmutated build: with a hostile title temporarily in a
local dossier, `IMGS` in the §3.5 snippet reads `0` and the row shows the
literal characters `<img src=x onerror="alert(1)">`. Restore the dossier and
prove the tree with `git diff --exit-code`.

**R4 — the pin/sort and ordering plane did not move.** After implementation:
`git diff --stat master...feat/AS-32-roster-titles -- apps/chat/public/dm-sort.js apps/chat/test/dm-sort.test.js apps/chat/server.js apps/chat/lib/personnel.js apps/chat/public/org-chart.js apps/chat/public/index.html`
prints **nothing**, and `git diff --name-only master...feat/AS-32-roster-titles`
lists exactly the three files in §2. Not a mutation — a scope assertion, and the
cheapest possible check that §3.6 held.

## 7. Size

Small. ~10 lines of app.js, ~7 lines of CSS, ~60 lines of test. One commit is
fine; two (code, then tests) is also fine. Estimated well under a 300-line diff;
if it passes 300, stop and say why before continuing.

## 8. Open questions, each with a default that ships

- **Q1. Own line vs inline suffix beside the name.** The board's words were
  "roles next to names". Default (ships): **own line under the name.** At 240px
  the top row already holds name + badge + pin, and an inline suffix would eat
  the name. Reversible in one CSS rule if the board disagrees on sight — that is
  why AC9 records screenshots. *Box closes at implementation; do not reopen
  mid-task.*
- **Q2. Colour/size of the title line.** Default: identical to `.roster-status`
  (11px, `#bfa8c0`). Two muted secondary lines is a deliberate flat hierarchy;
  differentiating them is a design question, not this task's.
- **Q3. Should the AC7 sink list (`insertAdjacentHTML`/`outerHTML`/`document.write`)
  be hoisted into the existing AS-33 guard instead of AS-32's test?** Default:
  no — leave existing tests untouched, keep the strengthening local to this
  task's own case. Revisit when a *fourth* rendering path or a new `public/`
  module arrives, which is the natural moment to consolidate one guard over all
  of `public/`.

## 9. Stale items in the task record (do not inherit)

- The description's "`server.js` ~line 135" is now ~line 214; "`app.js` line ~259"
  is now ~L399. The functions are the durable references, not the line numbers.
- The description says the roster row ships `title`; **it now also ships
  `class`, `team` and `reportsTo`** (AS-33). §3.4 rules on them.
- "Consider also showing the title in the non-roster DM rows" — answered no in
  §1: non-roster DM rows are, by definition, members without an active dossier,
  so there is no title to show.
- Ordering comments on the task ("rank 6", "cluster 5/6", "cluster 4/6") are
  scheduling history and carry no design content.
