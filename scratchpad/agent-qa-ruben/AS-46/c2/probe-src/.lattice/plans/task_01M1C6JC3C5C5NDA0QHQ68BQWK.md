# AS-33: Chat: org chart visualizer + personnel frontmatter validator

Planned 2026-09-03 by `agent:cto-owen` at `9c083cf`. Implementer:
`agent:developer-marcus`. Reviewer: a `qa-*` who did not implement.

**Read §10 before §1 if you are reviewing.** The task description was written
on 2026-08-31 and three of its factual claims have moved since; §10 lists each
one and what replaced it. The description remains the contract for *intent*;
where it and this plan disagree on *mechanism*, this plan is the decision and
§10 says why.

**This task has two halves with different characters, and they are reviewed
differently.**

- The **validator** is a correctness job and a standing obligation from
  `CLAUDE.md` "Org Chart" — the trigger it names fired at headcount 8 and we
  are now at 10. Its acceptance criteria are labelled **(V)**. A (V) criterion
  is met only when the rule has been *seen to fail* against something that
  violates it. A green validator proves nothing on its own; that is the entire
  risk of this task and §6 exists for it.
- The **visualizer** is a board request (DM msg 297) and a rendering job. Its
  criteria are labelled **(R)**. (R) is judged on what a human sees and on the
  app's structure-first safety rule, not on rule coverage.
- A third, small group of criteria is labelled **(S)** — shared plumbing that
  both halves sit on (the reader change, the served module, CLI parity).

---

## §1 Scope

### In scope

1. **A validator** — nine rules over the personnel frontmatter graph, as one
   pure function in one file, with a fixture proving each rule fires.
2. **A host-runnable check command** — `node apps/chat/bin/check-org.js`,
   exit 0 clean / 1 violations / 2 usage. This is the authoritative gate.
3. **A read-only API** — `GET /api/org` returning the active employees, their
   reporting edges, and the violations.
4. **A tree view in the chat app** — a modal, derived live on open, showing
   every active employee under the board root, plus violations, plus anyone
   the tree could not place.
5. **`reportsTo` on the existing roster rows** — server and CLI together, per
   the description; the lib has always surfaced it and both consumers drop it.

### Not in scope, each with a reason

- **A generated `personnel/ORG.md`.** Already ruled on when the task was
  filed and carried forward unchanged: a committed generated file drifts
  between regenerations, which is the exact hand-maintained-chart failure the
  `CLAUDE.md` section exists to prevent. If the board wants a snapshot
  artifact, that is a separate board-requested task.
- **Any write to `personnel/`.** The AS-8 contract is read-only and this task
  does not touch it. The validator reports; a human or an employee edits the
  dossier.
- **Growing `lib/personnel.js` into a YAML parser.** `parseFrontmatter` is not
  modified at all (see the not-moving set, §4.3). The one reader change is
  additive and is proven non-breaking by `test/personnel.test.js` passing with
  **zero edits**.
- **A URL parameter for the chart** (`?org=…`). View-local state, matching the
  AS-26 §5 decision that the file viewer gets no `f=`. §8 Q1.
- **A departed-employee toggle.** §8 Q2.
- **Enforcing "every c-level reports to the CEO".** `CLAUDE.md` states it, but
  deriving "the CEO" requires either a title heuristic or a second constant,
  and the rule is nearly subsumed by `multiple_board_reports` + the tree. §8 Q6.
- **Reporting missing `title` / `team` / `hired`.** Display-only fields; a blank
  one degrades a label, it does not corrupt the graph. `actor_id` and `name`
  are already load-bearing and are covered by `unparsed_dossier`.
- **Two-tier severity (error vs warning).** §8 Q5: one tier. A warning tier is
  a queue of things nobody fixes; at headcount 10 every one of these nine is a
  one-line dossier edit.
- **Wiring the check into the advance tick or CI.** §8 Q3.
- **Mounting `personnel/` into the test container.** Deliberate — see §3.2.
- **Lattice work status in the chart.** The sidebar already does that.

---

## §2 File-level scope

Everything is under `apps/chat/`. Paths below are repo-relative.

**New (4):**

| Path | What |
|---|---|
| `apps/chat/public/org-chart.js` | The pure module: rule set, `validateOrg`, `buildOrgTree`, the board-root constant. No DOM, no `fs`, no `fetch`. |
| `apps/chat/bin/check-org.js` | The CLI gate. Reads `personnel/`, prints violations, sets the exit code. Opens no database. |
| `apps/chat/test/org-chart.test.js` | Unit tests for all nine rules + the tree builder + the CLI's exit codes. |
| `apps/chat/test/fixtures/org-clean/personnel/` | Four dossiers forming one valid org (incl. one departed). New fixture root. |

**Modified (9):**

| Path | What |
|---|---|
| `apps/chat/lib/personnel.js` | New export `readPersonnel(root)`; `readRoster` becomes its one-line wrapper. `parseFrontmatter` untouched. |
| `apps/chat/server.js` | Import the module; serve `/org-chart.js`; add `reportsTo` to roster rows; add `GET /api/org`. |
| `apps/chat/bin/chat.js` | One line: `reportsTo` in `rosterRows` (AS-8 CLI-parity contract). |
| `apps/chat/public/app.js` | Open/close/render the org modal; Esc ordering. |
| `apps/chat/public/index.html` | The `#org-chart-open` button and the `#org-modal` skeleton. |
| `apps/chat/public/style.css` | Modal + tree styles; the z-order inventory comment. |
| `apps/chat/test/api.test.js` | One expected-object edit; new `/api/org` cases; extend the served-module and `innerHTML` guards to the new file. |
| `apps/chat/package.json` | `"check:org": "node bin/check-org.js"`. |
| `apps/chat/README.md` | One new section documenting both halves and the check command. |

**Explicitly untouched** — listed here so an unexplained diff in any of them is
a review finding: `test/personnel.test.js`, `test/fixtures/repo/personnel/*`,
`test/cli.test.js`, `Dockerfile`, `compose.yaml`, `.dockerignore`,
`lib/store.js`, `lib/lattice.js`, `lib/client.js`, `public/url-state.js`,
`public/markdown.js`, `public/msg-refs.js`, `public/dm-sort.js`,
`public/thread-modal.js`, `watch/**`, and every top-level markdown file in the
repo (`CLAUDE.md`, `README.md`, `PHILOSOPHY.md`, `agents.md` are metawork —
see §9).

---

## §3 Design

### §3.1 One module, four consumers — and why it lives in `public/`

`apps/chat/public/org-chart.js` is imported by the browser (`public/app.js`),
the server (`server.js`), the CLI (`bin/check-org.js`), and node tests
(`test/org-chart.test.js`).

The description said "a pure function in `lib/`". I am overriding that, and the
reason is the browser: `lib/` is not served, so a `lib/` module forces either a
second copy of the rules in `public/` or a server round-trip for every derived
value. **Two copies of a rule set is the drift hazard this whole task exists to
prevent** — a validator that disagrees with the view is worse than no view.
`public/dm-sort.js` is the standing precedent for a pure module that the
browser imports and `node --test` imports directly (`test/dm-sort.test.js`).
The only unusual edge is the direction of the server's import (`server.js` →
`./public/org-chart.js`); that gets a one-line header comment in the module
saying why, because it will look wrong to the next reader.

The module is pure in the strict sense: no `fs`, no `fetch`, no DOM, no
globals, no `Date.now()`. It takes plain data and returns plain data. That is
what makes every rule testable with a four-line literal instead of a fixture
tree.

### §3.2 Where a violation surfaces — three places, three different jobs

This is the decision the plan most needs to get right, because "a failing
test", "a refusal at boot", "a field in the API" and "an error state in the
view" are four different products. The answer is three of them, each doing a
job the others cannot.

**(a) The CLI is the gate.** `node apps/chat/bin/check-org.js` reads the real
`personnel/`, prints one line per violation, and exits non-zero. This is the
thing a person or a tick runs after a hire, and it is the artifact that makes
the `CLAUDE.md` obligation enforceable rather than aspirational.

*Why a separate binary and not a `chat org` subcommand:* `bin/chat.js` resolves
a backend mode and opens the chat database on every invocation. `CLAUDE.md`
records that ticks must not run `node apps/chat/bin/chat.js` at all while the
server container is up (AS-24, the WAL divergence that orphaned message 161).
An org check needs no database, so routing it through `chat.js` would inherit a
hazard it has no reason to carry and would make it unrunnable by exactly the
caller who most needs it. `check-org.js` opens no store, probes no server, and
touches only `personnel/*.md` — which is also why running it as bare host
`node` does not offend the "no bare node on the host" rule in `compose.yaml`
(that rule is about the server and its database).

*Why it cannot be a test:* the test service mounts nothing, by design, and the
compose comment states the reason — "the suite passing mountless proves the
tests touch no real state (`personnel/` access included — fixtures only)". The
real roster is therefore unreachable from `node --test` in the supported
runner, and I am not going to `COPY personnel/ ` into the image to get around
it: that would trade a durable structural proof for a convenience. Measured:
`sed -n '/^  test:/,$p' apps/chat/compose.yaml | grep -oF 'volumes:' | wc -l`
→ **0**, and it stays 0.

**(b) The test suite is the proof that the gate can detect anything.** Fixtures
only. Every rule gets a case that fires it. The suite proves the *validator*;
the CLI proves the *roster*. Neither substitutes for the other, and conflating
them is precisely how a vacuous checker ships.

**(c) The API and the view are visibility.** `GET /api/org` carries a
`violations` array; the modal renders them above the tree with a count in the
header. Nobody has to remember to run anything — a broken edge is visible to
whoever opens the chart.

**Not a refusal at boot, and not a 500.** The chat app has a recorded
degradation contract in three places (`lib/personnel.js` header, the roster
endpoint's `catch`, and `test/api.test.js` "roster degrades to empty when
personnel/ is absent"): a malformed dossier or a missing mount must never take
the server down. A validator that refuses to boot would invert that contract
for the worse — one bad frontmatter line would take out chat for everyone,
including the conversation needed to fix it. The chart tolerates a broken
graph and says so loudly; it does not withhold itself.

### §3.3 The rule set — nine rules, each with a scope decision

`CLAUDE.md` names three: no orphan `reports_to`, no cycles, no reports under an
`ic`. Those are the floor, not the ceiling. The other six are each justified
below on the same test: *does this rule catch something that silently corrupts
a derived view, and does it cost more than a few lines?*

| # | Code | Fires when | Belongs now, because |
|---|---|---|---|
| 1 | `orphan_reports_to` | An active employee's non-empty `reports_to` is neither `human:forrest` nor the `actor_id` of an **active** employee. `detail` distinguishes `departed` from `no dossier`. | Mandated. The `departed` reason is not a fourth rule — it is the same broken edge with a different fix, and naming it saves the reader a grep. |
| 2 | `missing_reports_to` | An active employee has an empty or absent `reports_to`. | A degenerate orphan, split out only so the message can say "has no reporting line" instead of "points at ''". Mandated in substance. |
| 3 | `reporting_cycle` | A set of active employees forms a cycle in `reports_to`. One violation per cycle; `actorId` = the lexicographically smallest member; `detail` = all members, sorted. | Mandated. |
| 4 | `reports_to_ic` | An active employee's manager is an active employee whose `class` is `ic`. | Mandated. |
| 5 | `unparsed_dossier` | A `personnel/*.md` file that **has a leading `---` fence** but yields no roster entry (no closing fence, `actor_id` failing the identity regex, or no `name`). Files with no leading fence — `README.md` — are silently skipped and are **not** violations. | **New, and the highest-value of the six.** `readRoster` skips a broken dossier silently, so a real employee can vanish from the roster, the sidebar and the chart with no signal anywhere. A validator that only checks the graph cannot see the person who is missing from it. This is the one rule that closes an invisibility gap rather than a correctness gap. |
| 6 | `duplicate_actor_id` | Two or more dossier files declare the same `actor_id`. | New. A copy-pasted hire yields two nodes with one identity; the tree renders both and every join (Lattice work, DM state) becomes ambiguous. Costs three lines given §3.4's `sources`. |
| 7 | `invalid_class` | An active employee's `class` is not one of `cofounder`, `c-level`, `manager`, `ic`. | New, and load-bearing for rule 4: `reports_to_ic` can only be trusted if `class` is meaningful. A typo'd class silently disables the mandated check — the classic way a rule passes vacuously in production. |
| 8 | `invalid_status` | **Any** employee's `status` is not `active` or `departed`. Scans the unfiltered roster, since a typo'd status is by definition not `active`. | New. `status: activ` deletes a person from the sidebar, the chart, the CLI roster and every DM affordance, silently. Same failure class as rule 5, one line to catch. |
| 9 | `multiple_board_reports` | More than one active employee has `reports_to: human:forrest`. One violation, `actorId: null`, `detail` lists them sorted. | New in code, old in policy — `CLAUDE.md` states "only the CEO reports to `human:forrest`". Cheap to check, and a second board report is how an org chart quietly grows two roots. |

**Deliberately excluded:** a "not reachable from the root" rule. With rules 1,
2, 3 and 9 satisfied, reachability is implied — every node has exactly one
out-edge terminating at the board root, and the graph is finite and acyclic, so
following edges must arrive at the root. Adding a reachability rule would emit
a second violation for every orphan and every cycle member. The tree builder
still defends itself structurally (§3.6 `unplaced`) — that is a rendering
safeguard, not a rule.

**One tier, no severities.** Any violation exits the CLI non-zero.

**Determinism.** Violations are sorted by `(rule, actorId ?? '', file ?? '')`,
so every assertion in the suite can be a `deepEqual` on the whole array rather
than a `.some()` — an ordering-independent assertion is one of the ways a
"passing" test stops noticing extra output.

### §3.4 The reader change (`lib/personnel.js`)

Rules 5 and 6 need facts `readRoster` throws away: which files failed, and
which file each entry came from. One new export, no parser change:

```
export function readPersonnel(root)   // -> { roster, skipped, sources }
export function readRoster(root)      // -> readPersonnel(root).roster
```

- `roster` — **byte-identical in shape to today**: the same eight-field
  objects, same skip rules, same name sort, same `[]` on a missing directory.
- `skipped` — `[{ file, reason }]` for fenced files that yielded no entry;
  `reason` ∈ `malformed_frontmatter` | `invalid_actor_id` | `missing_name` |
  `unreadable`. Directory order.
- `sources` — `[{ file, actorId }]` for every parsed entry, directory order.

Distinguishing "no leading fence" (README, skip silently) from "no closing
fence" (broken dossier, report it) does **not** require touching
`parseFrontmatter`, which returns `null` for both and whose test pins that.
`readPersonnel` tests the leading fence itself with `/^---\r?\n/` on the raw
text before calling the parser. The parser's contract is unchanged; the caller
asks one extra question about the same string.

`readRoster` keeps its exact signature and behaviour, and the proof is that
`test/personnel.test.js` passes with **zero edits** (§6 F6 mutates the wrapper
to show that suite still guards it).

The three call sites of `readRoster` (`server.js`, `bin/chat.js`,
`test/personnel.test.js`) are unaffected. `server.js` switches to
`readPersonnel` only inside the new `/api/org` handler; the roster handler
keeps calling `readRoster`.

### §3.5 The root: a constant, not a derivation

`human:forrest` is the tree root and is **hard-coded** in `public/org-chart.js`:

```
export const BOARD_ROOT = 'human:forrest';
export const BOARD_NODE = { actorId: BOARD_ROOT, name: 'Forrest (Board)',
                            title: 'Board', class: 'board', team: '' };
```

He has no dossier and never will — `PHILOSOPHY.md` and `CLAUDE.md` both put the
board member outside the employee set — so nothing in `personnel/` can derive
him. The tempting alternative, "the root is whatever `reports_to` target has no
dossier", is actively harmful: under it **every orphan becomes a new root** and
rule 1 can never fire. The root decision and the orphan rule are the same
decision seen twice, which is exactly why the constant has to be explicit and
shared by all four consumers rather than re-spelled per call site.

`class: 'board'` is deliberately outside `VALID_CLASSES` — the board node is
never validated, and giving it a class the validator rejects makes it
impossible to accidentally feed it through the employee path. The display name
duplicates the seed identity string in `lib/store.js:64` (`'Forrest (Board)'`)
**as a constant, not a join**: the chart must render with no store lookup and
no `me`. A one-line comment records the duplication so the next reader does not
"fix" it into a lookup.

### §3.6 Departed employees

Decision: **the tree shows active employees only, and the validator validates
the active set** (rule 8 excepted — it must scan everyone, since a typo'd
status is why someone is not in the active set).

This matches the existing filter in both roster consumers (`status === 'active'`)
and the `lib/personnel.js` note that "callers filter on status". A departed
employee keeps their dossier — `CLAUDE.md` requires it, records are never
deleted — but an org chart is a picture of who reports to whom *now*.

**Anyone reporting to a departed employee is an `orphan_reports_to` violation
with `detail` naming the departed target.** That is not an accident of the
rule, it is the point: a departed manager with live reports is a real
organisational defect, and the fix (re-point `reports_to`) is a dossier edit
the message names outright. This is the interaction between the two decisions
and it is why they are decided together.

No toggle to show departed staff in v1 (§8 Q2).

### §3.7 The tree builder

`buildOrgTree(activeEmployees)` → `{ root, unplaced }`.

- Group employees by `reportsTo` into a children map.
- Walk **down** from `BOARD_ROOT` with a `visited` set, building
  `{ actorId, name, title, class, team, reports: [] }` nodes. Children sorted
  by `name` at every level.
- Never walk **up** a parent chain: a cycle would hang, and a cycle is an input
  we expect. The visited set makes re-entry structurally impossible.
- Any active employee not visited by the walk lands in `unplaced`, sorted by
  name — orphans, cycle members, anyone under a broken edge.

`unplaced` is the rendering safeguard that matches §3.3's rule exclusion: the
view must never silently lose a person, whatever the graph does. **Every active
employee appears exactly once in the tree or in `unplaced`** — that is an
invariant, asserted as a count, and §6 F5 breaks it on purpose.

### §3.8 `GET /api/org`

```
{ employees: [ { actorId, name, title, class, team, reportsTo }, … ],  // active, name-sorted
  violations: [ { rule, actorId, file, detail }, … ] }                 // sorted (§3.3)
```

Server-side: `readPersonnel(root)` → `validateOrg(...)` over the **unfiltered**
roster plus `skipped`/`sources` (rules 5, 6 and 8 need what the active filter
throws away) → return the active subset for the tree. No `me`, no store, no
Lattice join: nothing here is viewer-relative and nothing is private. Same
degradation contract as the roster endpoint — a missing or malformed
`personnel/` yields `{ employees: [], violations: [] }` and a 200, never a 500.

*Why a new endpoint rather than bolting `violations` onto `/api/roster`:* the
roster endpoint is fetched by every client every 60 seconds and is joined
against Lattice and the DM state; the org view is opened occasionally and needs
neither join. Keeping them apart also leaves the roster's response envelope at
exactly `{ roster }`, so `test/api.test.js`'s degradation `deepEqual` does not
move. The one roster change is the `reportsTo` field on each row, which the
description scoped and which CLI parity (`bin/chat.js` `rosterRows`, "AS-8 CLI
parity with GET /api/roster") requires in the same commit.

### §3.9 The rendering surface, and why it is safe

Markup: a `#org-modal` / `#org-dialog` skeleton in `index.html`, patterned on
the AS-26 `#file-modal` (which was itself patterned on the AS-19 thread modal).
Close on the × button and on Escape; no backdrop-gesture handling, matching the
file viewer's scope. Body order: violations block (only when non-empty), then
the tree, then the "Not placed" block (only when non-empty).

The tree is nested `<ul>`/`<li>` with CSS indentation. Dependency-free, like
everything else in `public/` — no chart library, no SVG layout engine, no
`<canvas>`. At headcount 10 and depth 3 the honest data structure *is* a nested
list, and it is the one that stays accessible and printable.

**The safety argument.** The app's rule is structural, not sanitising:
tokenizers and builders emit text and structure, DOM assembly is `el()` /
`createTextNode` only, and there is no `innerHTML` anywhere. This view keeps
that shape exactly — `buildOrgTree` returns plain objects with plain strings
and knows nothing about the DOM; `renderOrgChart` in `app.js` turns them into
elements with the same `el()` helper every other view uses. Measured:
`grep -oF '.innerHTML' apps/chat/public/app.js | wc -l` → **0**, and the suite
already asserts it twice for `app.js`. Those two guards are anchored on
`app.js` alone, so this task **extends them to `public/org-chart.js`** — a new
`public/` module that no guard covers is how the house rule quietly becomes a
convention.

Personnel files are repo-authored, which weakens the threat model but does not
change the rule, for two reasons. First, the rule's value is that it is
absolute: a single justified exception makes the `doesNotMatch(/\.innerHTML/)`
guard meaningless, and that guard is the only enforcement that exists. Second,
"repo-authored" here means *authored by agent employees* — the same class of
author whose chat message bodies this app already treats as untrusted, and
`AS-54`'s breadcrumb says so in as many words. A dossier is reviewed the way a
commit is, which is a good reason to be relaxed about *likelihood* and no
reason at all to be relaxed about *mechanism*.

### §3.10 Where the button goes, and Escape ordering

`<button id="org-chart-open" type="button">Org chart</button>` sits immediately
above `<ul id="roster-list">` in the sidebar — next to the thing it explains.
Text label, not a glyph.

The modal opens on `#org-modal` at `z-index: 36`, one above the file viewer.
The z-order inventory comment in `style.css` (currently "dm-options 20 < scrim
25 < sidebar-as-drawer 26 < thread-modal backdrop 30 < file-modal 35 <
task-panel 40") is updated in the same edit — that comment says "do not
re-derive", which only holds if it is maintained.

Escape closes the top-most open overlay, so the handler's checks run in
**descending z-index order**: org (36) → file (35) → thread (30). Today's
handler is file → thread; the new check goes first. In practice the org modal
cannot be open under the file viewer (its opener lives in the sidebar, which a
full-screen backdrop covers), but the handler's order should read as the
inventory does, so the next person adding an overlay has a rule to follow
instead of a precedent to guess at.

### §3.11 `bin/check-org.js`

```
node apps/chat/bin/check-org.js [--root <path>] [--json]
```

- Default root: `CHAT_REPO_ROOT` or the repo root, via the existing
  `latticeRoot()` — one resolution rule, shared with everything else.
- `--root` is what makes the CLI testable in the mountless container: the
  suite spawns it against `test/fixtures/…` exactly as `readRoster(root)` is
  called with a fixture root today.
- Human output: a headcount line, then one line per violation
  (`rule  actor-or-file  detail`), then a summary. `--json` prints
  `{ employees, violations }` — the same shape as `/api/org`.
- Exit: **0** no violations, **1** one or more violations, **2** usage error
  (unknown flag, `--root` without a value). A missing `personnel/` directory
  is exit 0 with an explicit "no personnel records found" line, matching
  `chat roster`'s existing degradation behaviour — absence is not a violation,
  and inventing one would make the command useless in a bare checkout.

---

## §4 Key files, every literal that moves, and the not-moving set

Line numbers are from `9c083cf` and are hints, not addresses.

### §4.1 Literals that move

| File | Literal | From → To |
|---|---|---|
| `lib/personnel.js` | export list | `readRoster` → `readRoster`, `readPersonnel` (`parseFrontmatter` unchanged) |
| `lib/personnel.js` | new | `/^---\r?\n/` leading-fence test |
| `lib/personnel.js` | new | reason strings `'malformed_frontmatter'`, `'invalid_actor_id'`, `'missing_name'`, `'unreadable'` |
| `server.js` (~11) | import | add `readPersonnel`; add `import { validateOrg } from './public/org-chart.js'` |
| `server.js` `STATIC_FILES` (~16-27) | entry count | **11 → 12**: add `'/org-chart.js': ['org-chart.js', 'text/javascript; charset=utf-8']` |
| `server.js` roster handler (~193-213) | row | add `reportsTo: e.reportsTo,` — **exactly one occurrence** of `reportsTo` in that handler region (baseline 0) |
| `server.js` | new handler | `GET /api/org` |
| `bin/chat.js` `rosterRows` (~176-200) | row | add `reportsTo: e.reportsTo,` — exactly one occurrence in that region (baseline 0) |
| `public/app.js` | import | `import { BOARD_ROOT, buildOrgTree } from './org-chart.js'` |
| `public/app.js` | new | `openOrgChart`, `renderOrgChart`, `closeOrgModal`, `#org-chart-open` / `#org-close` wiring, org branch first in the keydown handler |
| `public/index.html` | new ids | `org-chart-open`, `org-modal`, `org-dialog`, `org-title`, `org-body`, `org-close` |
| `public/style.css` | z-order comment | `… thread-modal backdrop 30 < file-modal 35 < task-panel 40` → `… file-modal 35 < org-modal 36 < task-panel 40` |
| `public/style.css` | new | `#org-modal` (z-index 36), `#org-dialog`, `.org-tree`, `.org-node`, `.org-node-meta`, `.org-violation`, `.org-unplaced`, plus the 600px full-sheet rule |
| `test/api.test.js` (~394) | expected object | the `ada` `deepEqual` gains `reportsTo: 'agent:cto-owen',` — **this is the only edit to an existing assertion in the task** |
| `package.json` `scripts` | new | `"check:org": "node bin/check-org.js"` |

### §4.2 New constants (all in `public/org-chart.js`)

`BOARD_ROOT`, `BOARD_NODE`, `VALID_CLASSES = ['cofounder','c-level','manager','ic']`,
`VALID_STATUSES = ['active','departed']`, and `ORG_RULES` — a frozen array of
the nine codes in the §3.3 order.

**A convention §6 depends on:** each rule's emit site in `validateOrg` carries
an anchor comment `// rule: <code>` on its own line, and **each rule code
appears exactly twice in the file** — once in `ORG_RULES`, once at its emit
site. That makes a per-rule mutation scopeable to a region instead of applied
file-wide, which is the defect this project shipped twice this week.

### §4.3 The not-moving set — an unexplained diff here is a finding

- `lib/personnel.js` → `parseFrontmatter`, `cleanValue`, `ACTOR_ID_RE`, and
  every field name in the roster entry. The frontmatter schema does not change.
- `test/personnel.test.js` — **zero edits**. It is the proof of §3.4.
- `test/fixtures/repo/personnel/*` — **zero edits**. Pinned by two suites; its
  two skipped files are reused as the on-disk `unparsed_dossier` case, and its
  two orphan edges (`ada` and `bob` both point at `agent:cto-owen`, who has no
  dossier in that fixture root) are reused as the on-disk dirty case. Both
  properties are now load-bearing rather than incidental, so the assertions
  that depend on them carry a comment saying so, next to the assertion.
- `/api/roster`'s response envelope: still exactly `{ roster }`. The
  degradation `deepEqual(res.data, { roster: [] })` (~448) must not move.
- `Dockerfile`, `compose.yaml`, `.dockerignore` — no new `COPY`, no mount on
  the `test` service. §3.2.
- `test/cli.test.js`, `lib/store.js`, `lib/lattice.js`, `lib/client.js`,
  `public/url-state.js`, `watch/**`.
- Every top-level markdown file (§9).

---

## §5 Acceptance criteria

Numbered and labelled: **(V)** validator, **(R)** renderer, **(S)** shared.
A (V) criterion is met only with the corresponding §6 recipe observed failing.

### Validator (V)

- **V1.** `validateOrg` is pure — no `fs`, `fetch`, DOM, globals or clock. Test:
  the module imports nothing but its own constants.
- **V2.** All nine `ORG_RULES` codes are implemented, and each has at least one
  test that fires it against a fixture that violates it and asserts the exact
  violation object. Report **cardinality before quantification**: the review
  states how many rules exist and how many were fired.
- **V3.** `orphan_reports_to` fires for an edge pointing at no dossier, and
  separately for one pointing at a **departed** employee, with `detail`
  distinguishing them.
- **V4.** `reporting_cycle` fires on a 2-cycle and on a 3-cycle, emits **one**
  violation per cycle with the smallest member as `actorId`, and the call
  returns (no hang) — the test has an explicit timeout.
- **V5.** `reports_to_ic` fires when the named manager is an active `ic`, and
  does **not** fire when the manager is `cofounder`, `c-level` or `manager`.
- **V6.** `unparsed_dossier` fires for a fenced-but-broken file and for a fenced
  file with a bad `actor_id`, and does **not** fire for `README.md` (no leading
  fence). Asserted against `test/fixtures/repo/personnel` by exact file list.
- **V7.** `invalid_status` scans the unfiltered roster (a `status: activ`
  dossier is reported even though it is not in the active set).
- **V8.** A clean roster yields `violations: []` — and this assertion is only
  meaningful because V2–V7 exist; it is recorded as the *last* criterion of the
  set, never the first.
- **V9.** Violations are sorted by `(rule, actorId, file)`; every rule test
  asserts the whole array with `deepEqual`, not `.some()`.
- **V10.** `check-org` exits **0** on `test/fixtures/org-clean`, **1** on
  `test/fixtures/repo` (2 orphans), **2** on an unknown flag, and **0** with a
  "no personnel records found" line on a root with no `personnel/`.
- **V11.** `check-org --json` emits `{ employees, violations }` matching
  `/api/org` for the same root.
- **V12.** `node apps/chat/bin/check-org.js` against the **real repo root**
  exits 0 at merge time. Verified by hand at review, recorded in the review
  comment with the headcount it saw (expected: 10 active). This is the one
  check the mountless suite structurally cannot perform.
- **V13.** `test/personnel.test.js` passes with zero edits (`git diff
  --exit-code -- apps/chat/test/personnel.test.js` is clean).

### Renderer (R)

- **R1.** The sidebar has an "Org chart" control; clicking it opens the modal.
- **R2.** The modal renders a nested list rooted at `Forrest (Board)`, with
  every active employee appearing exactly once, showing name, title, class and
  team. At merge time that is 10 employees under 2 managers.
- **R3.** Every active employee appears exactly once in the tree **or** in
  "Not placed" — asserted as a count against `buildOrgTree`'s output, for a
  clean roster and for a roster with an orphan and a cycle.
- **R4.** Violations render above the tree with a count in the header; a clean
  roster shows a "no violations" line, not an empty region.
- **R5.** The view is derived live from `/api/org` on each open — no cached
  artifact, no stale render after a dossier edit + reopen.
- **R6.** × and Escape close it; Escape closes the top-most overlay only (org
  before file before thread).
- **R7.** Zero `innerHTML` in `public/app.js` **and** `public/org-chart.js`;
  the existing guards are extended to the new file, and `org-chart.js` contains
  no DOM API call at all.
- **R8.** No new dependency: `package.json` still has no `dependencies` key,
  and `public/` loads no external asset.
- **R9.** Rendering degrades: an org response with `employees: []` shows the
  board node and an explanatory line, not a crashed modal or an empty dialog.
- **R10.** Layout holds at ≤600px (full-screen sheet, matching the file
  viewer) and the tree scrolls rather than overflowing the dialog.

### Shared (S)

- **S1.** `GET /api/org` returns the documented shape; 200 and empty arrays on
  a root with no `personnel/`.
- **S2.** `/org-chart.js` is served with `text/javascript; charset=utf-8`, and
  the served `app.js` actually imports it (the `STATIC_FILES` entry is
  load-bearing — the AS-18/AS-26 module-graph pattern).
- **S3.** `reportsTo` appears on `/api/roster` rows **and** on `chat roster
  --json` rows (AS-8 parity), with exactly one assignment in each region.
- **S4.** `/api/roster`'s envelope is unchanged (`{ roster }`).
- **S5.** The full suite passes in the supported runner —
  `DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 docker compose run --rm --build test`
  — with **203 + N** tests, 0 failures, and the review states N.
- **S6.** `apps/chat/README.md` documents both halves and the check command,
  including the mountless-suite reasoning from §3.2 in one sentence.

---

## §6 Falsification recipes

**Baselines, measured at `9c083cf` on 2026-09-03. Every command below was run
before the number was written down.** Run from the repo root unless noted.

| Command | Baseline |
|---|---|
| `grep -oF '.innerHTML' apps/chat/public/app.js \| wc -l` | `0` |
| `grep -oF 'innerHTML' apps/chat/public/app.js \| wc -l` | `2` (both in comments) |
| `grep -roF 'org-chart' apps/chat --include='*.js' --include='*.html' --include='*.css' \| wc -l` | `0` |
| `sed -n "/^const STATIC_FILES = {/,/^};/p" apps/chat/server.js \| grep -oE "^  '/" \| wc -l` | `11` |
| `sed -n "/pathname === '\/api\/roster'/,/pathname === '\/api\/channels'/p" apps/chat/server.js \| grep -oF 'reportsTo' \| wc -l` | `0` (region is 44 lines) |
| `sed -n '/rosterRows(me) {/,/registerIdentity:/p' apps/chat/bin/chat.js \| grep -oF 'reportsTo' \| wc -l` | `0` |
| `grep -oF 'reportsTo' apps/chat/public/app.js \| wc -l` | `0` |
| `grep -oF 'readRoster' apps/chat/lib/personnel.js \| wc -l` | `1` |
| `grep -oE '^test\(' apps/chat/test/personnel.test.js \| wc -l` | `4` |
| `grep -oE '^test\(' apps/chat/test/api.test.js \| wc -l` | `26` |
| `grep -oE '^test\(' apps/chat/test/cli.test.js \| wc -l` | `14` |
| `ls apps/chat/test/fixtures/repo/personnel \| wc -l` | `6` |
| `sed -n '/^  test:/,$p' apps/chat/compose.yaml \| grep -oF 'volumes:' \| wc -l` | `0` |
| `ls personnel/*.md \| wc -l` | `11` (10 dossiers + `README.md`) |
| `cd apps/chat && node --test` | `tests 203, pass 203, fail 0` |

Counting rules, non-negotiable: **`grep -c` counts lines and is banned here** —
occurrences only, via `grep -oF … | wc -l`. Bare `innerHTML` is 2 and
`.innerHTML` is 0 in `app.js`; grep the dotted form. `wc -l` prints `0` where
`grep` exits 1, so a `set -e` script needs `|| true`.

**Mutation procedure.** Prefer a scratch copy: `cp -R apps/chat "$SCRATCH/mut"`,
mutate there, never touch the task worktree. Where a mutation must happen in
place: back up, `trap` the restore on `EXIT`, mutate, **assert the mutation
applied** (an unapplied mutation is indistinguishable from a passing checker —
a BSD-vs-GNU `sed` address has passed a check this way here before), observe,
let the trap restore, prove the tree with `git diff --exit-code`, then
**rebuild the image and re-run** — a restored tree against a stale mutant image
has produced phantom failures here before. Record the exact failing set; a
wider or narrower set than predicted is itself a finding.

---

**F1 — every rule fires. Nine mutations, one per rule. This is the recipe the
task exists for.**

For each `<code>` in `ORG_RULES`, in a scratch copy:

1. Locate the rule's region: from its `// rule: <code>` anchor to the next
   `// rule:` anchor (or the end of `validateOrg`). Extract it with
   `awk '/\/\/ rule: <code>/,/\/\/ rule: |^}/'` into `$SCRATCH/region.txt`.
2. Confirm the code appears **exactly twice in the file** (`ORG_RULES` + the
   emit) and **exactly once in the region**:
   `grep -oF "'<code>'" public/org-chart.js | wc -l` → `2`;
   `grep -oF "'<code>'" $SCRATCH/region.txt | wc -l` → `1`.
3. Apply the mutation **only inside that region** — rewrite the emitted code to
   a marker: `'<code>'` → `'MUTANT_<code>'` at the emit site only.
4. *Assert applied, scoped:* re-extract the region and assert
   `grep -oF "'MUTANT_<code>'" $SCRATCH/region.txt | wc -l` → **1**, and
   file-wide `grep -oF "'MUTANT_<code>'" public/org-chart.js | wc -l` → **1**
   (proving the sed did not also hit the `ORG_RULES` entry — a file-wide
   mutation would make the whole recipe a whole-file assertion wearing a
   rule's name, which is the defect this project shipped twice this week).
5. Run `node --test`. **Predicted failing set:** exactly the cases named for
   that rule below, and nothing else. Note in particular that
   `org: a clean roster yields zero violations` must **pass** under all nine
   mutations — it never sees a violation, which is precisely why it proves
   nothing on its own.

| `<code>` | Predicted failing case names (all must exist as executable `test(...)` titles) |
|---|---|
| `orphan_reports_to` | `org: orphan_reports_to fires on an edge pointing at no dossier`; `org: orphan_reports_to names a departed manager as the reason`; `api: AS-33 — /api/org reports violations from the fixture root` |
| `missing_reports_to` | `org: missing_reports_to fires on an empty reporting line` |
| `reporting_cycle` | `org: reporting_cycle fires once per cycle and returns`; `org: cycle members land in unplaced, never in the tree` |
| `reports_to_ic` | `org: reports_to_ic fires when a manager is class ic`; `org: reports_to_ic does not fire for cofounder, c-level or manager` |
| `unparsed_dossier` | `org: unparsed_dossier fires on fenced-but-broken dossiers and spares README.md` |
| `duplicate_actor_id` | `org: duplicate_actor_id fires when two files declare one identity` |
| `invalid_class` | `org: invalid_class fires on a class outside the four` |
| `invalid_status` | `org: invalid_status fires on the unfiltered roster` |
| `multiple_board_reports` | `org: multiple_board_reports fires on a second board report` |

**F2 — the CLI's exit code tracks violations, not luck.**
In a scratch copy, edit `test/fixtures/org-clean/personnel/dev-fixture.md`:
`reports_to: agent:fix-cto` → `reports_to: agent:nobody`.
*Assert applied:* `grep -oF 'agent:nobody' <file> | wc -l` → **1** and
`grep -oF 'agent:fix-cto' <file> | wc -l` → **0** (baseline 1).
*Predicted:* `node bin/check-org.js --root test/fixtures/org-clean` flips exit
**0 → 1** and stdout gains exactly one `orphan_reports_to` line; the failing
test set is `check-org: exits 0 on a clean fixture root`. Restore, confirm exit
0 again. Without this, "exit 0 on the clean fixture" is a checker that has only
ever been seen passing.

**F3 — the `innerHTML` guard actually covers the new module.**
In a scratch copy, append `export const X = () => { const n = {}; n.innerHTML = 'y'; };`
to `public/org-chart.js`.
*Assert applied:* `grep -oF '.innerHTML' public/org-chart.js | wc -l` → **1**
(baseline 0).
*Predicted failing set:* the extended guard case
`api: AS-33 — org-chart.js is served, imported, and holds the no-innerHTML line`.
If the suite stays green, the guard was never extended and R7 is unmet — this
recipe is the *only* thing that distinguishes an extended guard from a copied
comment.

**F4 — `reportsTo` reaches the API row from the dossier, not from a default.**
In a scratch copy, inside the `/api/roster` handler region only
(`sed -n "/pathname === '\/api\/roster'/,/pathname === '\/api\/channels'/p"`),
rewrite `reportsTo: e.reportsTo,` → `reportsTo: 'MUTANT_EDGE',`.
*Assert applied, scoped:* re-extract that region and assert
`grep -oF 'MUTANT_EDGE' <region> | wc -l` → **1**, and file-wide
`grep -oF 'MUTANT_EDGE' server.js | wc -l` → **1**.
*Predicted failing set:* `api: AS-8 — roster joins personnel, lattice work
status, and DM state` (the `ada` `deepEqual`) — and nothing in the org suite,
which reads `/api/org`, not `/api/roster`. A wider set means the two endpoints
are more coupled than §3.8 claims.

**F5 — nobody is lost by the tree builder.**
In a scratch copy, mutate `buildOrgTree`'s return so `unplaced` is always empty:
`return { root, unplaced };` → `return { root, unplaced: [] /* MUTANT_UNPLACED */ };`.
*Assert applied:* `grep -oF 'MUTANT_UNPLACED' public/org-chart.js | wc -l` → **1**.
*Predicted failing set:* `org: cycle members land in unplaced, never in the
tree`; `org: every active employee appears exactly once — tree plus unplaced`;
`org: an orphaned employee is still shown, under Not placed`. The clean-roster
tree case passes (its `unplaced` is `[]` anyway) — that is the point: on a
healthy roster this mutation is invisible, which is why the broken-roster cases
carry the invariant.

**F6 — the reader refactor is still guarded by the untouched suite.**
In a scratch copy, mutate the wrapper: `return readPersonnel(root).roster;` →
`return readPersonnel(root).skipped; /* MUTANT_WRAPPER */`.
*Assert applied:* `grep -oF 'MUTANT_WRAPPER' lib/personnel.js | wc -l` → **1**.
*Predicted failing set:* **all 4** cases in `test/personnel.test.js` plus the
roster cases in `api.test.js` and `cli.test.js`. Cardinality first: 4 of 4
personnel cases. A smaller set means the refactor slipped a behaviour change
past a suite that was supposed to pin it.

**F7 — the test service is still mountless.**
`sed -n '/^  test:/,$p' apps/chat/compose.yaml | grep -oF 'volumes:' | wc -l`
→ **0**, and `grep -oF 'personnel' apps/chat/Dockerfile | wc -l` → **0**. Both
are baselines that must not move; if either does, §3.2's argument has been
quietly reversed and V12 has become a test that only appears to run.

**F8 — the real roster is actually checked (V12).**
`node apps/chat/bin/check-org.js` from the repo root → exit **0**, headcount
**10**. Then, in a **scratch copy of the repo** (never the worktree — this
project has a recorded incident from mutating tracked state to falsify a
checker), change one dossier's `reports_to` to `agent:nobody` and re-run:
exit **1**, one `orphan_reports_to` line naming that employee. Delete the
scratch copy. Report both observations in the review comment.

---

## §7 Size and complexity

**Complexity stays `medium`**, at the top of the band. Estimated diff ~900
added lines: `public/org-chart.js` ~180, `test/org-chart.test.js` ~320,
`bin/check-org.js` ~80, fixtures ~50, `app.js` ~70, `style.css` ~40,
`api.test.js` ~60, `README.md` ~45, and under 60 across
`server.js` / `personnel.js` / `chat.js` / `index.html` / `package.json`.

Roughly two-thirds of that is test and fixture code, which is the correct
ratio for a task whose whole risk is a checker that cannot detect anything.

**Pre-agreed split line, so it is not improvised mid-task.** If the implementer
is materially over budget at the point where the validator, the CLI and the
tests are green, **stop and ship that**: the validator half is the mandated
one, and the renderer becomes a follow-up carrying items 3–4 of §1 plus (R)
and (S1, S2). Do not split the other way — a chart with no validator would
leave the `CLAUDE.md` obligation open for a third week and would render a graph
nothing has checked. Record the split in a Lattice comment before doing it;
do not decide it silently.

**Suggested commit boundaries** (one worktree, `feat/AS-33-org-chart`):
1. `lib/personnel.js` + its behaviour-preservation evidence.
2. `public/org-chart.js` + `test/org-chart.test.js` + fixtures — the validator,
   complete and green, before anything renders it.
3. `bin/check-org.js` + `package.json` + its tests.
4. `server.js` (`/api/org`, `reportsTo`, static entry) + `bin/chat.js` parity +
   `api.test.js`.
5. `index.html` + `style.css` + `app.js` — the view.
6. `README.md`.

---

## §8 Open questions, each with a default and a deadline

- **Q1 — Should the chart be linkable (`?org=1`)?** *Default: no.* Matches
  AS-26's ruling that the file viewer gets no `f=`; view-local state stays out
  of the URL contract. *Deadline:* the first time someone tries to send a link
  to the chart in chat.
- **Q2 — Should departed employees be viewable behind a toggle?** *Default: no
  in v1.* Nobody has departed yet; a toggle for an empty set is speculative.
  *Deadline:* the first `status: departed` transition.
- **Q3 — Should `check-org` run automatically in the advance tick?** *Default:
  not wired in this task.* The command exists and is host-runnable; wiring it
  into the tick changes tick behaviour, which is a separate decision with a
  separate blast radius. *Deadline:* the first hire after this merges — if a
  bad dossier lands and nobody notices before someone opens the chart, wire it.
- **Q4 — A committed `personnel/ORG.md` snapshot?** *Default: no*, unchanged
  from the task's original ruling. *Deadline:* board request, or never.
- **Q5 — Two severity tiers?** *Default: one tier.* *Deadline:* the first time
  a violation is legitimately un-fixable; then split.
- **Q6 — Enforce "every c-level reports to the CEO"?** *Default: no.*
  `multiple_board_reports` plus the visible tree covers the practical failure,
  and identifying "the CEO" needs a heuristic or a second constant. *Deadline:*
  the first c-level hire after this merges.
- **Q7 — Should the view show each person's current Lattice work, as the
  sidebar does?** *Default: no* — the sidebar owns that, and the chart is about
  structure. *Deadline:* if anyone asks for the chart to answer "who is on
  what", which is a different question.

---

## §9 Proposed metawork wording

Employees never edit `CLAUDE.md`; this is the exact wording for the metawork
layer to apply once AS-33 merges. Two edits, both in the **Org Chart** section.

**(1)** Replace, in the renderer/validator bullet:

> Until it ships, grepping the frontmatter *is* the org chart.

with:

> **Shipped 2026-09-0X (AS-33).** The renderer is the live derived view in the
> chat app (sidebar → "Org chart"); it is never a committed generated file. The
> validator is `node apps/chat/bin/check-org.js` — host-runnable, opens no
> database, reads only `personnel/`, exits non-zero on any violation. It
> enforces nine rules: orphan `reports_to` (including an edge to a departed
> employee), missing `reports_to`, reporting cycles, reports under an `ic`,
> unparsed dossiers, duplicate `actor_id`, invalid `class`, invalid `status`,
> and more than one report to `human:forrest`. **A hire, departure, or
> reporting-line change is not complete until that command exits 0.**

**(2)** Correct the stale headcount in the same bullet: "Renderer/validator
trigger reached 2026-08-31 at headcount 8" → "…at headcount 8; built at
headcount 10 (AS-33)."

Nothing else in `CLAUDE.md`, `README.md`, `PHILOSOPHY.md` or `agents.md`
changes as part of this task.

---

## §10 Stale items and corrections to the record

Found while planning; each is a place where the description or the repo says
something no longer true. The description stands as the statement of intent —
these are mechanism corrections, and QA should review against this plan.

1. **Headcount is 10, not 8.** The description says 8 (written 2026-08-31);
   Carla hired `developer-lena` and `qa-ruben` on 2026-09-02. `ls personnel/*.md`
   → 11 files = 10 dossiers + `README.md`. The trigger fired two hires ago.
   Consequence for the implementer: the tree is 2 managers wide under the CEO
   and the "clean roster" expectation at merge time is 10 active employees.
2. **"A pure function in `lib/`" → `public/org-chart.js`.** Overridden in
   §3.1, for the browser-import reason. The description's *intent* — one shared
   pure function, not two copies — is what the override preserves.
3. **"Derived live from `/api/roster` on open" → `/api/org`.** §3.8.
   `/api/roster` still gains `reportsTo` as described; the view reads the new
   endpoint because violations need the pre-filter roster.
4. **"server.js roster mapping, ~line 139" is now ~line 193.** Line drift from
   AS-24/25/26. Use the `pathname === '/api/roster'` anchor, not the number.
5. **The existing AS-8 fixture root is not a valid org**, and that was never
   noticed: `engineer-ada-fixture.md` and `qa-bob-fixture.md` both declare
   `reports_to: agent:cto-owen`, and no `cto-owen` dossier exists under
   `test/fixtures/repo/personnel/`. Under rule 1 that root has exactly two
   `orphan_reports_to` violations. This is now **load-bearing** — it is the
   on-disk dirty case for V10 — so the assertion that pins it must say so in a
   comment, and the fixture must not be "fixed".
6. **Two field spellings for the model assignment in the dossiers**:
   `Model assignment:` in 8, `Assigned model:` in 2 (`developer-lena-fischer.md`,
   `qa-ruben-ochoa.md`). **Confirmed harmless to this task** — both appear in
   prose *below* the closing `---`, and `parseFrontmatter` returns at the
   closing fence, so neither is ever parsed (verified: zero occurrences of
   `model` inside any dossier's frontmatter block). Worth normalising as HR
   record-keeping, which is not Lattice work; noted here so the next person
   does not re-derive it.
7. **The task title still reads "…(renderer/validator trigger at 8
   headcount)".** Accurate as history — the trigger *was* reached at 8 — so it
   is left alone rather than rewritten; item 1 is the correction of record.
