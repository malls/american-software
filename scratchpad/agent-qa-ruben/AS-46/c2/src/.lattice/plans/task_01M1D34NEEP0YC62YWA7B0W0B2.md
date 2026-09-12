# AS-42: D1 v1: contract templates and generation (server)

**Task:** `task_01M1D34NEEP0YC62YWA7B0W0B2` · **Planner:** Owen Kessler, CTO
(`agent:cto-owen`) · **Implementer:** `agent:developer-marcus` · **Planned:** 2026-09-02
· **Branch:** `feat/AS-42-contracts` · **Worktree:** `.worktrees/AS-42/`

Implements milestone-plan §3 rows **C-17** (template set), **C-18** (CC BY 4.0
attribution mechanism, `IN (mandate)`) and **C-19** (contract generation). Chain link 3,
server side. Depends on **AS-39** (the `contracts` table and its repository, already
merged). Three tasks sit directly behind this one: **AS-47** (screens 6 and 7),
**AS-48** (the dashboard's contract list), **AS-49** (automated end-to-end).

This is the last server task on the D1 line. AS-47 reads this plan cold, so §3.4
(the route surface), §3.5 (what the rendered document is and what it is safe to be
embedded in) and §3.9 (what this task hands AS-47) are written for that reader, not
only for the implementer.

---

## 1. Scope

### 1.1 In scope

1. **A template registry** — the one v1 template as a frozen declaration in code, with
   declared variable slots, a required attribution statement, and a structured body.
   Self-consistency is checked at module load, not at review (§3.1, §3.2).
2. **A pure renderer** — declaration + resolved values → one HTML document string.
   Every text node escaped by one function; no data ever reaches an attribute (§3.5).
3. **A generation service** — validate form values against the declaration, resolve
   record-sourced values from the freelancer and client rows, render, persist through
   `repos.contracts.create` (§3.6).
4. **One route**, `POST /contracts`, below the auth boundary, taking its freelancer from
   the session and nothing else (§3.4, §3.7).
5. **The CC BY 4.0 attribution mechanism** (C-18), built now and exercised by the
   placeholder, in a shape that cannot be forgotten when real text lands (§3.3).
6. **Clearly-marked placeholder body text** — structurally complete, legally inert,
   visibly labelled (§3.3).
7. **`test/contracts.test.js`** — 34 cases across five groups (§5.5), plus the literal
   moves in three existing test files (§5.6).

### 1.2 Not in scope

Everything in the description's NOT list, restated with who owns it:

| Not here | Row | Owner |
|---|---|---|
| The contract screens (create, detail, print/download) | C-20, C-21 | **AS-47** |
| A client-facing share link or portal | C-22, OUT | never in v1; M4 |
| A recorded client acceptance event | C-23, OUT | never in v1; M4 |
| E-signature of any legal weight | C-24, OUT | never in v1; M4 |
| Our own PDF renderer | C-25, OUT | never in v1 — the browser's print-to-PDF closes the chain |
| A second template | — | one closes the chain; a second does not (Rule 1) |
| Real adapted Common Paper prose | — | **gated**: CEO + CTO lawyer-agent review, non-Lattice, M4 |

Plus five more this plan adds, each for a stated reason:

8. **No Stripe. At all. This is the one D1 entity with no Stripe dimension** — stated
   loudly because every other server task in this app has had one and the implementer
   will expect one. There is no custody guard on this path, no connected-account header,
   no allowlisted call, no readiness gate. `lib/stripe/*` is not imported by any file
   this task adds, and `contractRoutes` takes `{ repos }` — **not** `{ repos, stripe }`,
   unlike its two neighbours in `app.js`. The states ledger agrees and says so with an
   explicit row: `S6-GATED-STRIPENOTREADY` is `n/a — because contract generation has no
   Stripe dependency` (`02-states-ledger.md` §6; `01-screens.md` §5 spends a whole
   section on it). Two cases pin the claim (Y1, Y2).
9. **No migration, no schema change.** §3.2 explains why versioning needs no column.
10. **No client-creation endpoint.** `POST /clients` does not exist anywhere in the app
    today and this task does not add it — see §9 Q1, which is the most consequential
    finding in this plan and is addressed to whoever plans AS-46/AS-47.
11. **No repository change.** `lib/db/repositories/contracts.js` is AS-39's and is not
    touched. Its known residual (a raw `TypeError` from `JSON.stringify` on a BigInt or
    cyclic `variables`) is **AS-59 item 3** and stays there. §3.6 explains why that
    failure mode is unreachable through this task's path without fixing it here.
12. **No config row, no compose change, no Dockerfile change** (§4).

---

## 2. File-level scope

Exhaustive. A file not on this list is not touched; if the implementation needs one that
is not here, that is a plan defect — say so in a Lattice comment before editing it.

**New (5):**

| Path | Purpose | Projected lines |
|---|---|---|
| `apps/invoicing/lib/contracts/templates.js` | the registry, the one template declaration, load-time self-checks | ~185 |
| `apps/invoicing/lib/contracts/render.js` | escape, the closed tag vocabulary, date formatting, emit | ~150 |
| `apps/invoicing/lib/contracts/generation.js` | validate → resolve → render → persist | ~115 |
| `apps/invoicing/routes/contracts.js` | one route, the error taxonomy, the form parser | ~120 |
| `apps/invoicing/test/contracts.test.js` | 34 cases (§5.5) | ~600 |

**Edited (4):**

| Path | Change |
|---|---|
| `apps/invoicing/app.js` | one mount line + its comment, below the boundary, after `invoiceRoutes` |
| `apps/invoicing/test/auth.test.js` | 6 literal/list moves (§5.6) |
| `apps/invoicing/test/harness.test.js` | 2 literal/list moves (§5.6) |
| `apps/invoicing/test/dependency-policy.test.js` | 4 literal/list moves + 1 new concept row (§5.6) |

Nine files. Under the §8 tripwire of ~10.

---

## 3. Design

### 3.1 What a template *is*, concretely

**A template is code: a frozen declaration in a JavaScript module that ships in the
image.** Not a file on disk, not a row in the database, and never user-supplied.

The three candidates, weighed:

- **A row in the database, user-supplied.** Rejected, and the reason is the security
  dimension the tasking message asks about. A user-supplied template means
  user-controlled *template source*, which is server-side template injection by
  construction — the user does not merely supply values into a document, they supply the
  document's own structure and any substitution syntax it carries. Nothing in the
  capability table asks for it: C-17 is "**one** template in v1", and the legal gate
  means even *our* body text is not yet cleared for a real user. There is no
  user-supplied template path in v1, and this plan does not leave a seam for one.
- **A file on disk** (`lib/contracts/templates/*.html` plus a manifest). Rejected on
  mechanics, not taste. `test/dependency-policy.test.js` is a **closed-world walker**:
  every file under `apps/invoicing/` must classify as `SOURCE_EXT`, `MANIFEST_NAME`, or
  `UNSCANNED`, and a file in no bucket fails the suite. A `.html` template forces a
  choice between widening `SOURCE_EXT` (whose stripper is JavaScript-shaped and would be
  applied to markup) and adding an `UNSCANNED` entry (an unread file that can carry
  arbitrary text — exactly the blind spot AS-53 closed). It would also need a `COPY`
  line, a `templatesDir` config row, and a health check proving the directory reached
  the image, on the `views` precedent. That is four mechanisms bought to hold one
  string.
- **Code.** Chosen. It reaches the image through `COPY apps/invoicing/lib ./lib`, which
  already exists. It needs no new file class, no config row, no health check. And it
  puts the declaration and its integrity checks in the same place, so "every declared
  variable is referenced by the body, and every body slot is declared" is a module-load
  assertion rather than a review obligation.

**The declaration, exactly** (`lib/contracts/templates.js`; `deepFreeze` is a local
three-line recursive freeze):

```js
export const INDEPENDENT_CONTRACTOR_AGREEMENT_V1 = deepFreeze({
  id: 'independent-contractor-agreement@1',
  title: 'Independent Contractor Agreement (placeholder)',
  sourceTemplate: null,            // { name, licence, url } once real text lands
  attribution:
    'Attribution: this body is placeholder text and is not adapted from any '
    + 'third-party source. When adapted template text (Common Paper, CC BY 4.0) '
    + 'replaces it, that attribution appears here.',
  notice: {
    title: 'Placeholder contract text — not legal advice',
    paragraphs: [
      "This document's body is placeholder text. It is not legal advice and should "
      + 'not be relied upon until this notice is removed.',
      'Pending a lawyer-agent review of the adapted source template. This warning is '
      + 'part of the document itself and survives print and download.',
    ],
  },
  variables: [
    { name: 'freelancerName',     source: 'record', type: 'text',      label: 'Your name' },
    { name: 'clientName',         source: 'record', type: 'text',      label: 'Client' },
    { name: 'projectDescription', source: 'form',   type: 'multiline', label: 'Project description', required: true, maxLength: 5000 },
    { name: 'startDate',          source: 'form',   type: 'date',      label: 'Start date',          required: true },
  ],
  body: [
    [{ text: 'This agreement is between ' }, { slot: 'freelancerName', strong: true },
     { text: ' ("Provider") and ' },          { slot: 'clientName',     strong: true },
     { text: ' ("Client"), effective ' },     { slot: 'startDate',      strong: true },
     { text: '.' }],
    [{ text: '[PLACEHOLDER — scope of work]: ', strong: true }, { slot: 'projectDescription' }],
    [{ text: '[PLACEHOLDER — payment terms]: ', strong: true },
     { text: 'Placeholder text pending legal review. Do not rely on this section.' }],
    [{ text: '[PLACEHOLDER — standard terms]: ', strong: true },
     { text: 'Placeholder text pending legal review. Do not rely on this section.' }],
  ],
});
```

**A body block is an array of segments; a segment is either template-authored text
(`{ text }`) or a slot reference (`{ slot }`), each optionally `strong`.** That is the
whole vocabulary. There is no substitution *syntax* — no `{{name}}`, no `%s`, no
interpolation of any kind — so there is no parser, and therefore no parser to confuse
(§3.5 finishes the injection argument).

**Identification and selection.** The registry is a frozen `Map` from id to declaration.
`getTemplate(id)` returns the declaration or throws `NotFoundError('template', id)`.
`DEFAULT_TEMPLATE_ID` is exported and equals the one id. Selection is by id, from the
request when supplied and from `DEFAULT_TEMPLATE_ID` when not (§3.4).

**Load-time invariants**, asserted when the module is first imported, so a malformed
declaration crashes at boot rather than at a freelancer's first contract:

1. `id` matches `/^[a-z][a-z0-9-]*@\d+$/`; no two templates share an id.
2. Every `{ slot }` in `body` names a declared variable; every declared variable is
   referenced by at least one slot. **Both directions** — a declared-but-unused variable
   is a form field that goes nowhere, and a slot with no declaration is a render-time
   crash.
3. Every variable has a known `source` (`record` | `form`) and a known `type`
   (`text` | `multiline` | `date`). Form-sourced variables carry `required`;
   record-sourced ones do not (they are always resolved).
4. `attribution` is a non-empty string. **And if `sourceTemplate !== null`, the
   attribution must contain `sourceTemplate.licence` as a substring** — see §3.3.

### 3.2 The versioning decision AS-39 deferred here

AS-39 §8 Q4 asked: *should `contracts` carry a `template_version` column, since a
template can change after issue?* Its default: *"Not now — `rendered_html` is the record
of what was issued. AS-42 adds a column by migration if its templates are versioned."*
The box closes with this plan.

**Ruling: the outcome is confirmed — no column, no migration in this task. The premise
is overturned — templates *are* versioned, and versioning does not require a column,
because the version is part of the template's identity and rides in the existing
`template_id`.**

That is not a dodge, and here is the reasoning in the order I actually ran it.

*First, do we need versioning at all?* Yes, and not hypothetically. The body text
shipped here is a placeholder held under a legal gate whose whole purpose is that it
**will** be replaced — M4, after the lawyer-agent review. That replacement is a
scheduled event, not a risk. If `template_id` names only the family
(`independent-contractor-agreement`), the M4 change silently redefines what every
already-issued row's `template_id` means, and a v1 contract becomes indistinguishable
from an M4 contract in the only column that identifies its source. That is precisely the
harm versioning exists to prevent.

*Second, does versioning require a column?* No. A template version is not an attribute
*of* a template family — it **is** a different template, for the only purpose the id
serves here: naming the exact declaration a stored document came from. Splitting it into
`(template_id, template_version)` buys one query — "all contracts on family X across
versions" — that no v1 screen asks for (AS-48 lists contracts by freelancer and shows a
title, not a family), and costs a migration for a column nothing reads.

*Third, what does the single versioned id buy that the pair does not?* A property worth
more than the query: **reproducibility.** Because the id names the exact declaration and
`variables` stores the complete resolved input, `render(getTemplate(c.templateId),
c.variables)` must equal `c.renderedHtml` byte for byte. That is a real invariant,
testable today (N5), and it would be *unprovable* under an unversioned id — after M4 the
re-render would silently produce different text and there would be no marker saying why.

*And the discipline AS-39 asked me to respect:* migrations are new files and the schema
is never split. Confirmed and honoured — this task writes no migration, so the question
of whether one "belongs in this task" is moot. Had I overturned the outcome, the column
would have been `lib/db/migrations/0003-contract-template-version.js` plus a
`MIGRATIONS` line, never an edit to `0001-initial.js`; I am recording that so the next
reader knows the constraint was applied rather than avoided.

*What holds the version honest.* An id that carries a version is only useful if the
version moves when the content does. That is a **guard this task introduces**: `T3` pins
a digest of the shipped declaration, computed in the test file (`node:crypto`'s
`createHash`, which `test/` is outside the dependency scan's world — so no concept row
moves and the product hashes nothing at runtime). Change a word of the body without
bumping `@1` and `T3` and `B1` go red. Recipe **M3** breaks it in that direction.

**Consequence recorded for M4:** replacing the placeholder body is a new declaration with
id `…@2` added to the registry, `DEFAULT_TEMPLATE_ID` repointed, and `@1` **kept** so old
contracts stay reproducible. Retiring a version means removing it from selection, never
from the registry.

### 3.3 The attribution mechanism (C-18), and a correction to what it should say

C-18 is `IN (mandate)`: built now, exercised by the placeholder, so the obligation cannot
be forgotten when real text lands.

**The mechanism** is four things, not a string:

1. `attribution` is a **required, non-empty** field of every template declaration. A
   template without one fails at module load, so a future template physically cannot
   ship without an attribution statement (T5).
2. `sourceTemplate` is a required field too, either `null` or
   `{ name, licence, url }` — the declaration must state, explicitly, whether the body is
   derived from a third-party template.
3. **The cross-check:** if `sourceTemplate !== null`, `attribution` must contain
   `sourceTemplate.licence`. Declaring a CC BY 4.0 source and forgetting to say so in the
   rendered line is a boot failure, not a licence breach discovered later (T4).
4. The renderer **always** emits the attribution inside the document, in the printable
   region, so it survives print and download (`02-states-ledger.md` §7 requires exactly
   this) — never in page chrome AS-47 might restyle away (B6).

Point 3 is what makes this a mechanism rather than a field. It is exercised today
against a **fixture** template with a non-null `sourceTemplate` and a deficient
attribution, so the check is a used exemption from the moment it ships rather than dead
code waiting for M4. Recipe **M7** deletes the check and requires T4 to go red.

**Now the correction, and it is deliberate.** The wireframe (`screen-7-contract-detail.html`
lines 97–100) renders the attribution line as:

> "This document is adapted from a template by Common Paper, licensed under CC BY 4.0.
> Changes have been made from the original."

**That statement is false of the artefact this task ships, and it must not be rendered.**
The task description is explicit: *"Do not paste adapted Common Paper prose into this
task"* — so the body is our own placeholder text, derived from nothing. Attributing our
own text to Common Paper is not a harmless over-credit:

- It misattributes authorship of text Common Paper did not write, which is the error CC
  BY's attribution clause exists to prevent, pointed the other way.
- It works directly against the legal gate. The gate exists so a user does not treat this
  text as usable. A line saying the document derives from a published, reviewed legal
  template makes it look **more** authoritative, not less — it partly undoes the warning
  banner sitting three inches above it.

So `@1`'s attribution states the mechanism truthfully and names what will occupy the slot
(the exact string is in §3.1). At M4, the new declaration sets `sourceTemplate` and the
cross-check forces the licence into the line. Every property the row asks for holds today
— the line exists, is required, is rendered inside the document, and is covered by a test
— without asserting something untrue to a user.

This is a CTO call inside a gate the CEO and I own jointly. It is recorded here, in §9 Q2
with a time-box, and in the Lattice comment, so Carla can overturn it cheaply if she reads
the licence obligation differently.

**Placeholder marking** is three independent markers, all inside the document region, so
losing one does not silently unmark it (B6): the title ends `(placeholder)`; the notice
section renders with its own title; and the body carries three `[PLACEHOLDER — …]`
labels.

### 3.4 The route surface

**Exactly one route.** It reuses AS-43's shape rather than inventing a parallel one:
thin handler, service call, error class → status, 303 redirect, one-line `text/plain`
error bodies.

| Method | Path | Body | Success | Notes |
|---|---|---|---|---|
| `POST` | `/contracts` | `clientId`, `templateId?`, plus one field per **form-sourced** variable (`projectDescription`, `startDate`) | `303` → `/contracts/<id>` | Below the auth boundary. Freelancer from the session. |

**No GET routes.** `GET /contracts/new` and `GET /contracts/:id` are screens 6 and 7 —
AS-47's, per the screen budget. The redirect target 404s until AS-47 lands, which is the
established idiom on this codebase, not a gap: `/invoices/{id}/edit` has 404'd since
AS-43 and `/connect-stripe` since AS-41. **The `Location` header is the contract,
asserted without dereferencing it** (P1).

**`templateId` is accepted, optional.** With one template it is a field that can take one
value, which argues for omitting it. It is in anyway, for three lines and one case: it is
the field that decides *which legal text a user receives*, and making that implicit is
precisely the shape one regrets at M4, when there are two templates and exactly one of
them has cleared review. Absent → `DEFAULT_TEMPLATE_ID`. Unknown → 404 (P5).

**The error taxonomy** (`statusFor`, mapped by error class, never by message text —
`routes/invoices.js`'s rule):

| Class | Status | When |
|---|---|---|
| `NotFoundError` | 404 | unknown template; unknown client; **a client owned by someone else** (§3.7) |
| `ValidationError` | 400 | missing required value, over-long value, malformed date, unknown field, a record-sourced name supplied as a form value |
| body-parser refusal (`Number.isInteger(err.status)`) | its own | over the size or parameter limit; checked **last** of the mapped cases, per the `routes/invoices.js` comment |
| anything else | 500 | a bug |

**What is deliberately *not* mapped, and why that is the point.** `routes/invoices.js`
maps seven classes this route does not: `AccountNotReadyError`, `AmountMismatchError`,
`StripeApiError`, `StripeTransportError`, `StripeCustodyError`, `ConfigError` — all
Stripe-shaped, none reachable from a path that makes no Stripe call — and
`InvalidStateError`, which is unreachable because contracts have no state machine to be
in the wrong state of. **They are not copied across "for symmetry."** An unreachable
mapping is a dead branch that reads like a considered decision and is not one; AS-63 is
open against exactly that shape elsewhere in this app ("dead money-path guard, false plan
rationale"). If an `InvalidStateError` ever surfaces here it will be a loud 500, which is
the correct answer to something that cannot happen.

**The form parser** is mounted **per route, never app-wide** — AS-44's webhook must see
the raw request body, and an app-wide parser is the classic way to break that, discovered
late. `express.urlencoded({ extended: false, limit: '32kb', parameterLimit: 20 })`.
`extended: false` because this form has no nested structure (unlike `lineItems`), which
keeps the parsed surface as small as it can be. The router carries its own error
middleware for parser refusals, so they land in the same one-line shape (P6).

### 3.5 What the rendered document is, and why injection is impossible

The output is **an HTML fragment**: one `<article class="contract-doc">` containing the
notice, the title, the body, and the attribution, stored verbatim in
`contracts.rendered_html`.

**The closed tag vocabulary.** The renderer emits exactly five element types and exactly
one attribute name:

| Element | Where | Attribute |
|---|---|---|
| `<article>` | the root | `class="contract-doc"` |
| `<section>` | notice, body | `class="contract-doc__notice"` / `"contract-doc__body"` |
| `<h1>` | the title | `class="contract-doc__title"` |
| `<p>` | notice title, notice paragraphs, body blocks, attribution | `class` from a fixed set, or none |
| `<strong>` | a segment declaring `strong: true` | none |

Plus `<span class="contract-doc__multiline">` around a `multiline` slot's value, so
AS-47 can set `white-space: pre-wrap` and a three-paragraph scope of work does not
collapse into a run-on line. That is the whole vocabulary.

**How injection is prevented — three properties, in order of strength:**

1. **There is no template parser.** The body is structured data, not a string with
   markers. No user text is ever *scanned* for substitution syntax, so there is nothing
   to escape *out of* and no second-order injection (a value containing `{{...}}` is
   simply text).
2. **Every text node — template-authored and user-supplied alike — goes through one
   escape function.** Not "user values are escaped": *everything* is. There is no
   raw-output path in the renderer, so there is no site an author could reach for. One
   escaper, pinned to one file by a new dependency-policy concept row (§5.6). The five
   characters `& < > " '` are all escaped; escaping `"` and `'` is deliberate
   over-coverage for an element-content context, so the output does not become unsafe if
   a future reader places it somewhere narrower.
3. **No data reaches an attribute position at all.** Every attribute in the output is a
   renderer-authored constant. That is the strongest of the three, because
   attribute-context escaping is the one people get wrong, and here there is no
   attribute-context escaping to get wrong. Case **B5** proves it structurally: it
   extracts every `attr="value"` from the output, asserts the count, asserts the name is
   always `class`, and asserts every value is in a committed set.

**What the output is safe to be embedded in — say this to AS-47 in these words:**
*HTML element content (flow content) in a UTF-8 document, and nothing else.* It is not
safe in an attribute value, a `<script>` or `<style>` body, a URL, a `srcdoc`, an
`innerHTML` assignment on a node with different parsing rules, or a JSON string emitted
into a script tag. AS-47 renders it with EJS's raw output `<%- contract.renderedHtml %>`
**exactly once**, inside the `.doc-region` container, and nowhere else; every other value
on those screens uses `<%= %>`.

**Exact output shape** — one element per line, joined with `\n`, no trailing newline, no
indentation (indentation inside a `<p>` would be a whitespace difference in the document
text):

```
<article class="contract-doc">
<section class="contract-doc__notice">
<p class="contract-doc__notice-title">Placeholder contract text — not legal advice</p>
<p>This document&#39;s body is placeholder text. …</p>
<p>Pending a lawyer-agent review …</p>
</section>
<h1 class="contract-doc__title">Independent Contractor Agreement (placeholder)</h1>
<section class="contract-doc__body">
<p>This agreement is between <strong>Freda Lancer</strong> ("Provider") and …</p>
<p><strong>[PLACEHOLDER — scope of work]: </strong><span class="contract-doc__multiline">…</span></p>
<p><strong>[PLACEHOLDER — payment terms]: </strong>Placeholder text pending legal review. Do not rely on this section.</p>
<p><strong>[PLACEHOLDER — standard terms]: </strong>Placeholder text pending legal review. Do not rely on this section.</p>
</section>
<p class="contract-doc__attribution">Attribution: this body is placeholder text …</p>
</article>
```

Note `document&#39;s` — the escaper applies to template-authored text too, which is the
point, and B1's golden string shows it.

**The class names are a frozen contract, and this is the price of storing rendered
output.** A contract issued today carries these class names forever. They may be **added
to**; they may **never be renamed**, or every already-issued document loses its styling.
Stated here because it is the durable obligation this design creates and the one AS-47
could unknowingly break.

**Dates.** A `date` variable is stored as `YYYY-MM-DD` and rendered long-form
(`2026-09-08` → `September 8, 2026`), matching the wireframe. The month names are a
12-entry constant in the renderer, **not** `Intl` / `toLocaleDateString`: formatting must
be byte-deterministic across environments, and ICU data version and ambient timezone are
not things this app should depend on for a document it stores forever (B8).

### 3.6 Generation: validate → resolve → render → persist

`createContractGeneration({ repos })` returns `{ generate(freelancerId, input) }` where
`input` is `{ clientId, templateId?, formValues }`. Order is load-bearing:

1. **Resolve the template.** `getTemplate(templateId ?? DEFAULT_TEMPLATE_ID)` →
   `NotFoundError('template')` if unknown.
2. **Check the form key set** against the template's **form-sourced** variable names.
   Any other key is `ValidationError`. This is the **one** place that check lives — the
   route keeps no allowlist of its own, so the two cannot drift. Its two jobs: reject
   nonsense fields (P2), and reject a body trying to supply a **record-sourced** name
   (N8, P3). The latter is the spoof that matters: without it, a request could post
   `freelancerName=Someone Else` and issue a document in another person's name.
3. **Validate each form value** by its declared type — `text` and `multiline` are
   non-empty strings within `maxLength` (200 / 5000 characters); `date` is `YYYY-MM-DD`
   **and a real calendar date**, checked by UTC round-trip so `2026-02-31` and `0026-01-01`
   are both rejected (N4). A missing required value is a `ValidationError` naming the
   field — **never a silent blank** (N2).
4. **Resolve record-sourced values.** `freelancerName` from
   `repos.freelancers.getById(freelancerId).displayName`; `clientName` from
   `repos.clients.getById(freelancerId, clientId).name` — owner-scoped, so a client that
   is not this freelancer's raises `NotFoundError('client')` here, before anything is
   written (§3.7).
5. **Render** the merged values.
6. **Persist** through `repos.contracts.create(freelancerId, { clientId, templateId,
   variables, renderedHtml })`, where `variables` is the **complete merged map**.

**Why the merged map is stored, not just the form input.** Clients can be renamed
(`clients.update`) and freelancers can change their display name. If record-sourced
values were re-read at render time, an issued document would silently change meaning when
a record changed. Storing the resolved values makes `variables` a snapshot of exactly
what the document says, which is what makes the reproduction invariant true:
`render(getTemplate(c.templateId), c.variables) === c.renderedHtml`, byte for byte (N5).

**Why AS-59 item 3 is unreachable here without being fixed here.** Every value this
service places in `variables` is a validated string, so `JSON.stringify` in the
repository cannot meet a BigInt or a cyclic object through `POST /contracts`. The
repository remains directly callable and the residual remains real — it stays AS-59's,
and this task neither fixes nor depends on it. Recorded so a reviewer does not read the
absence as an oversight.

### 3.7 Ownership, and why the route re-checks nothing

**Identity has exactly one source: `actingFreelancerId(req)`.** The route reads no
query string, no body field, and no header for identity. `actingFreelancerId` throws
rather than act as nobody, which makes a router accidentally mounted above the boundary
a loud 500 instead of a silent action.

Every read and write is scoped by that id, passed as the first argument:
`freelancers.getById(freelancerId)`, `clients.getById(freelancerId, clientId)`,
`contracts.create(freelancerId, …)`.

**The route relies on the engine rather than re-checking in application code.** The
`contracts` table carries `FOREIGN KEY (freelancer_id, client_id) REFERENCES clients
(freelancer_id, id)` against `clients`' `UNIQUE (freelancer_id, id)`. A row whose client
belongs to a different freelancer is **not rejected by a check — it cannot be written**.
`repos.contracts.create` additionally calls `assertOwnedClient` inside its transaction,
for the friendlier `NotFoundError('client')`, and this service's step 4 reaches the same
answer earlier still. So there are three layers, and the route adds none of them: an
application-level fourth check would be a second source of truth that can drift from the
constraint, and the layer that actually cannot be bypassed is the one at the bottom. The
route's entire ownership responsibility is *passing the session's id as the first
argument*.

**What a cross-tenant attempt actually returns: `404`, with a body of
`NotFoundError: create` and no row written** (N6, P4). Identical to a `clientId` that
does not exist at all. That is deliberate and it is the design record's rule, not an
accident: `S5-DENIED-NOTOWNER` and `S7-DENIED-NOTOWNER` both say *"renders identically to
the not-found state — confirming 'this ID exists but isn't yours' leaks more than
confirming nothing."*

### 3.8 Immutability: what changes, what a mistake costs

The schema enforces it — no `updated_at`, no update method, no draft state — and the
states ledger agrees: `S6-ABANDON` says *"contracts have no draft concept … generation is
one atomic step."*

**What the API does on an attempt to change an issued contract: nothing serves such a
request, so it 404s.** There is no `POST /contracts/:id`, no `PATCH`, no `DELETE`, and no
handler that exists to say "no". A route added to say no is still a route: it must be
classified in the committed partition, driven by G3's cookieless probe, and maintained —
paid for, to state a prohibition that absence already states.

**Absence is not left as an assertion.** It is pinned three ways, and the strongest one
already exists: `test/auth.test.js`'s `ALL_ROUTES` is the committed list of *every* route
in the built app, so adding `POST /contracts/:id` turns `G1`, `G1b`, `G2`, `G3` and `G15`
red until its author classifies it in an array a reviewer reads. Layer two is the
repository, which exposes no update method (AS-39). Layer three is `P8`, local to this
task, which asserts the built app carries no contract route beyond the one this task
adds. Recipe **M14** adds a mutation route and requires all six to fire.

**The correction path for a freelancer who made a mistake: generate a new contract with
the corrected values and send that one.** Both rows stay in the list, with no marker
saying one supersedes the other. That cost is real and I am stating it rather than
implying it is free — and it is smaller than it looks, because **v1 never delivers a
contract**. Row C-22 is OUT: the freelancer downloads or prints and sends it themselves
through their own email (`00-flows.md` step 10, *"nothing in our system tracks whether it
was actually sent or received"*). A contract the freelancer never sent is a row nobody
outside their account has seen. Supersede, void, and delete return in **M4** with the
portal and the acceptance event, which is where they become meaningful.

### 3.9 What this task hands AS-47 (screens 6 and 7)

Written as a checklist because AS-47 reads this plan cold and its author should not have
to infer the seam:

1. **`POST /contracts`** with the body in §3.4. Field names are **camelCase**
   (`clientId`, `templateId`, `projectDescription`, `startDate`), matching this app's
   existing routes; the wireframe's snake_case `name` attributes are illustrative low-fi
   markup — see §11 item 3.
2. **The form's fields come from the declaration, not from a second list.** Render one
   field per form-sourced variable, using its `name`, `label`, and `type`
   (`multiline` → `<textarea>`, `date` → `<input type="date">`). Import
   `getTemplate` / `DEFAULT_TEMPLATE_ID`. Do not hard-code the field list; a template
   change would then need two edits and the second would be forgotten.
3. **Screen 7's document region** is `<%- contract.renderedHtml %>`, once, inside
   `.doc-region`. Read §3.5's embedding contract before writing that line.
4. **Screen 7's warning banner and attribution line are already inside the stored HTML**
   — do not render a second copy in the page template. Screen 6's banner is a *page*
   banner and is AS-47's, because at that point no document exists yet.
5. **Style the frozen class names** (`contract-doc`, `contract-doc__notice`,
   `contract-doc__notice-title`, `contract-doc__title`, `contract-doc__body`,
   `contract-doc__attribution`, `contract-doc__multiline`) and set
   `white-space: pre-wrap` on the last. Never rename one (§3.5).
6. **`S6-ERROR-VALIDATION` preserves submitted values.** This route currently answers a
   one-line `text/plain` on failure, exactly as `routes/auth.js` and `routes/invoices.js`
   do before their screens land. AS-47 replaces that emission with a re-render of screen
   6 — one function, one point, the `renderSignIn` idiom.
7. **Inline client creation is not solved.** See §9 Q1 before planning screen 6.

---

## 4. Config, compose, migration

**None. This section exists to say so, and the claim is checked in §5.7.**

- **No config row.** `SCHEMA` stays at 11. Templates ship in code; there is no path, key,
  or secret to configure. (Compare AS-39, which added `dbPath` and moved `config.test.js`'s
  two literals.)
- **No compose change.** No new service, port, volume, network, or environment entry. The
  `test` service stays `network_mode: none` and `profiles: ['tools']`; nothing here needs
  a network, which is worth stating because this is the first server task in the app for
  which that is true by nature rather than by mocking.
- **No Dockerfile change.** `COPY apps/invoicing/lib ./lib` and
  `COPY apps/invoicing/routes ./routes` already copy directories wholesale, so
  `lib/contracts/` and `routes/contracts.js` reach the image with no new line. Verified
  against the Dockerfile, not assumed.
- **No migration.** §3.2. `lib/db/migrations/` is untouched and `MIGRATIONS` is unchanged.
- **No new dependency.** `express` and `ejs` remain the only two; `LOCK_ENTRIES` stays 70.
  Everything here is plain JavaScript plus, in the **test file only**, `node:crypto`.

---

## 5. Key files, and every literal that moves

### 5.1 `lib/contracts/templates.js` (new)

Exports `TEMPLATES` (frozen `Map`), `DEFAULT_TEMPLATE_ID`, `getTemplate(id)`,
`INDEPENDENT_CONTRACTOR_AGREEMENT_V1`, and `assertTemplate(declaration)` (the load-time
validator, exported so the fixture cases T4/T5 can drive it directly). Imports
`NotFoundError` from `../db/database.js` and nothing else.

Header comment must state: templates are code and never user-supplied (§3.1); the
version rides in the id and why (§3.2); the attribution cross-check and why it is not
just a field (§3.3).

### 5.2 `lib/contracts/render.js` (new)

Exports `renderContract(template, values)` and `escapeHtml(value)`. Imports
`ValidationError` from `../db/database.js` and nothing else. Contains the escape map, the
month table, `formatDate`, and the emitter. **No `console`, no I/O, no clock, no
randomness** — a pure function of its two arguments, which is what makes determinism
provable rather than probable.

### 5.3 `lib/contracts/generation.js` (new)

Exports `createContractGeneration({ repos })`. Imports from `./templates.js`,
`./render.js`, and `../db/database.js`. The six steps in §3.6, in that order.

### 5.4 `routes/contracts.js` (new)

Exports `contractRoutes(config, { repos })`. The `config` parameter is unread today — the
redirect target is app-relative — and is present so every mount line in `app.js` reads
alike, exactly as `invoiceRoutes` and `connectRoutes` document.

### 5.5 `test/contracts.test.js` (new) — 34 cases

Group letters **T, B, N, P, Y** are unused elsewhere in the suite (verified against all
14 files: A C D E F G H I K M R S V W X Z are taken). **These exact names are what §7
predicts against — if the implementer renames a case, §7's prediction is updated in the
same commit.**

**T — the registry (7).** `T1` exactly one template and its id carries the version ·
`T2` every declared variable is referenced by the body, and every body slot is declared ·
`T3` the shipped declaration matches its committed digest · `T4` a template declaring a
source whose attribution omits the licence is refused · `T5` a template with a blank
attribution is refused · `T6` `getTemplate` refuses an unknown id with `NotFoundError` ·
`T7` every declared variable carries a known source and type.

**B — the rendered document (9).** `B1` byte-identical to the committed golden output ·
`B2` every declared variable appears in the output, substituted · `B3` a value containing
markup is escaped, never emitted as markup · `B4` template-authored text is escaped by
the same path as a value · `B5` every attribute is renderer-authored — no data reaches an
attribute · `B6` the output carries the placeholder marking and the attribution line ·
`B7` deterministic — identical inputs produce byte-identical output · `B8` a date renders
long-form from its `YYYY-MM-DD` spelling · `B9` a slot with no value throws rather than
rendering a blank.

**N — generation (8).** `N1` resolves record-sourced variables from the freelancer and
client rows · `N2` a missing required form value is a `ValidationError`, never a silent
blank · `N3` an over-long value is a `ValidationError` naming the field · `N4` a
malformed or non-calendar date is a `ValidationError` · `N5` the stored variables
re-render to the stored HTML byte for byte · `N6` a client owned by another freelancer is
`NotFoundError` and writes no row · `N7` the stored template id is the versioned id ·
`N8` a record-sourced variable supplied as a form value is a `ValidationError`.

**P — the HTTP surface (8).** `P1` creates one contract and redirects 303 to its detail
path · `P2` an unknown body field is a 400 and creates nothing · `P3` a record-sourced
variable in the body is a 400 and creates nothing · `P4` a `clientId` owned by another
freelancer answers 404 and creates nothing · `P5` an unknown `templateId` answers 404 and
creates nothing · `P6` a body past the parser limit answers with the parser's own status
and creates nothing · `P7` the identity acted on is the session's, never a `freelancerId`
in the query string · `P8` no route mutates or deletes a contract.

**Y — the boundary claims (2).** `Y1` nothing in the contracts path names Stripe, in code
or in comments · `Y2` `contractRoutes` is constructed from `repos` alone and takes no
`stripe` dependency.

**Cardinality before quantification, everywhere.** Every case that iterates the registry,
the variable list, the body, or the output's attributes asserts a committed count first.
Recipe **M12** is the probe for this: with the registry emptied, `T2`, `T3` and `T7` must
be **among** the red — a green there would mean they were quantifying over nothing.

Two conventions carried from the suite: `withServer` / `configFor` from
`test/helpers/server.js`, and `seedSignedIn` / `signedInHeaders` for a session without
paying a KDF derivation. Row counts read on a second connection, the `db.test.js` idiom —
`test/` is outside the dependency scan's world, so SQL there moves no committed literal.

**The golden fixture uses `Website redesign — phase 1: homepage & <nav>.`** as its
project description, deliberately: the `&` and the `<` make `B1` a live witness for
escaping, so `M1` turns two cases red instead of one.

### 5.6 Literals that move (exhaustive — 12 edits across 3 files)

Every count below was verified by running the grep, not by reading the file.

**`test/auth.test.js`** — `POST /contracts` is **protected**, so it appears **twice**
(the `'POST /invoices',` analogue reads exactly 2 occurrences today):

| # | Location | From | To |
|---|---|---|---|
| 1 | `ALL_ROUTES`, between `'POST /connect-stripe/start',` and `'POST /invoices',` | — | insert `'POST /contracts',` |
| 2 | line 769 | `found.length, 14` / `expected exactly 14 routes` | `15` / `15` |
| 3 | line 779 (`G1b`) | `found.length, 13` | `14` |
| 4 | `G2`'s protected literal, same sort position | — | insert `'POST /contracts',` |
| 5 | line 836 (`G3`) | `protectedRoutes.length, 9` | `10` |
| 6 | line 998 (`G15`) | `discoverRoutes(app).length, 14` | `15` |

`PUBLIC_ROUTES` does **not** change: this route is protected.

**`test/harness.test.js`:**

| # | Location | From | To |
|---|---|---|---|
| 7 | `EXPECTED_TEST_FILES`, after `'connect.test.js',` | — | insert `'contracts.test.js',` |
| 8 | line 82 | `found.length, 14` / `expected exactly 14 test files` | `15` / `15` |

(Sort order: `config` < `connect` < `contracts` — `f`<`n`, then `n`<`t`.)

**`test/dependency-policy.test.js`:**

| # | Location | From | To |
|---|---|---|---|
| 9 | line 374 | `source.length, 43` / `expected 43 app source files` | `47` / `47` |
| 10 | the source list | — | insert `'lib/contracts/generation.js',` `'lib/contracts/render.js',` `'lib/contracts/templates.js',` after `'lib/connect/readiness.js',`; insert `'routes/contracts.js',` after `'routes/connect.js',` |
| 11 | the concepts test | — | add `scanConcept('contract HTML escape', /\bescapeHtml\b/, ['lib/contracts/render.js']);` — **measured baseline today: 0 occurrences of `escapeHtml` anywhere**, so it is a used exemption from the moment it ships |
| 12 | the concepts test's **name** | `…AS-38, AS-39, AS-40, AS-41, AS-43 and AS-44 put them` | `…AS-38, AS-39, AS-40, AS-41, AS-42, AS-43 and AS-44 put them` |

### 5.7 The not-moving set, stated as a claim to be checked

**Claim: apart from the twelve edits in §5.6 and the mount line in `app.js`, this task
changes no committed literal and no file outside §2.** Specifically, all of the following
are unchanged, and a reviewer should verify by running the suite and by
`git diff --stat master...feat/AS-42-contracts`:

- `lib/config.js` `SCHEMA` — 11 rows; `config.test.js`'s `SCHEMA.length, 11` and
  `prefixed.length, 10` unchanged. **No config row is added.**
- `lib/views.js` `VIEWS` — 1 entry; `health.test.js`'s `VIEWS.length, 1`,
  `deepEqual(…, ['scaffold.ejs'])` and `HEALTH_CHECKS.length, 4` unchanged. **This task
  adds no EJS template**: the contract document is a stored string produced by a pure
  function, not a rendered response, so it is not a screen and takes no `views/` row.
- `compose.yaml`, `Dockerfile`, `.dockerignore` — untouched; every `deploy-shape.test.js`
  literal unchanged (`COPIES.length, 9`; `IGNORE_PATTERNS.length, 6`; the four service
  keys; the single `invoicing-data` volume; `env.length, 5`; `BUILT.length, 3`).
- `dependency-policy.test.js`'s manifest list (3), `LOCK_ENTRIES` (70),
  `DIRECT_DEPENDENCIES` (`ejs`, `express`), `SANCTIONED` (3 entries), and every existing
  `scanConcept` row's allowlist. **No allowlist is widened.**
- `lib/db/**` — no repository, migration, or error-vocabulary change.
- `test/{assets,config,connect,db,deploy-shape,health,invoices,repositories,stripe-client,stripe-mock,webhooks}.test.js`
  — no edits at all.
- `PUBLIC_ROUTES` in `auth.test.js` — 5 entries, unchanged.

**Two live traps in `dependency-policy.test.js` the implementer must not spring** (both
verified against the current tree):

1. **The money-word row scans RAW text, comments included.**
   `scanConcept('money representation', /amount|currency|money/i, […7 files…], { raw: true })`.
   The words **`amount`**, **`currency`** and **`money`** must not appear anywhere in the
   four new source files — not in code, not in a comment, not inside a longer word
   (`paramount` contains `amount`). The seven allowed files today are exactly the seven
   raw hits, so the row is tight and a single stray word turns it red. `payment terms` in
   the template body is fine; `payment amount` is not. Recipe **M10** proves this is live.
2. **`console output` allows three files, none of them new.** Nothing this task adds may
   log.

---

## 6. Acceptance criteria

**The description's VERIFICATION clause, verbatim, is criterion 1:**

> **VERIFICATION: unit tests — every declared variable is substituted; an unfilled
> required variable is an error, not a silent blank; the rendered document contains both
> the attribution line and the placeholder marking; generation is deterministic for
> identical inputs. No accounts, no network, no Stripe.**

1. That clause holds, each half witnessed by a named case: *every declared variable is
   substituted* → **B2**; *an unfilled required variable is an error, not a silent blank*
   → **N2** (and **B9** for the renderer's own backstop); *the rendered document contains
   both the attribution line and the placeholder marking* → **B6**; *generation is
   deterministic for identical inputs* → **B7** and **N5**; *no accounts, no network, no
   Stripe* → the suite passes with the `test` service at `network_mode: none`, and
   **Y1**/**Y2**.
2. `lib/contracts/templates.js` exports a registry of exactly one template whose id is
   `independent-contractor-agreement@1`, with four declared variables
   (`freelancerName`, `clientName`, `projectDescription`, `startDate`) — **T1**.
3. The declaration's self-consistency is enforced at module load in **both** directions:
   no undeclared slot, no unreferenced variable — **T2**.
4. Every declared variable carries a known `source` and `type`; form-sourced variables
   carry `required`, record-sourced ones do not — **T7**.
5. A template with a blank attribution is refused, and a template declaring a
   `sourceTemplate` whose licence is absent from its attribution is refused — **T5**,
   **T4**. The second is exercised against a fixture, so the check is used from the day
   it ships.
6. The shipped declaration matches a digest committed in the test file; changing the body
   text without bumping the version turns the suite red — **T3**.
7. `getTemplate` refuses an unknown id with `NotFoundError` — **T6**.
8. The rendered document is byte-identical to a golden string committed in the test file
   — **B1**.
9. A value containing markup (`<script>alert(1)</script>`, `" onload=`, `&`) appears in
   the output escaped and creates no element and no attribute — **B3**.
10. Template-authored text is escaped by the same path as a user value — **B4**.
11. Every attribute in the output is renderer-authored: the attribute count is asserted
    against a committed number, every attribute name is `class`, and every value is in a
    committed set — **B5**.
12. A `date` value renders long-form from its `YYYY-MM-DD` spelling — **B8**.
13. A slot with no value throws rather than rendering a blank — **B9**.
14. `generate` resolves `freelancerName` from the freelancer row and `clientName` from
    the client row, and stores the **merged** map in `variables` — **N1**.
15. `render(getTemplate(c.templateId), c.variables)` equals `c.renderedHtml` byte for
    byte — **N5**.
16. An over-long value and a malformed or non-calendar date (`2026-02-31`, `0026-01-01`,
    `08/09/2026`) are each a `ValidationError` naming the field — **N3**, **N4**.
17. A record-sourced variable supplied as a form value is a `ValidationError`, at the
    service — **N8** — and a 400 over HTTP — **P3**.
18. The stored `template_id` is the versioned id, not the family name — **N7**.
19. A client owned by another freelancer raises `NotFoundError` and writes **no** row;
    over HTTP it answers 404, identical to a client that does not exist — **N6**, **P4**.
20. `POST /contracts` creates exactly one row and answers `303` with
    `Location: /contracts/<id>`, asserted **without dereferencing it** (AS-47 has not
    landed) — **P1**.
21. An unknown body field is a 400 and creates nothing; an unknown `templateId` is a 404
    and creates nothing; a body past the parser limit answers with the parser's own
    status and creates nothing — **P2**, **P5**, **P6**.
22. A `freelancerId` in the query string is ignored: the contract is created for the
    **session's** freelancer, and the named one has none — **P7**.
23. The built app carries no contract route other than `POST /contracts`; `ALL_ROUTES` is
    15 and the protected partition is 10 — **P8**, plus `auth.test.js`'s `G1`, `G1b`,
    `G2`, `G3`, `G15`.
24. Nothing under `lib/contracts/` or in `routes/contracts.js` names Stripe, in code or
    in a comment, and `contractRoutes` is constructible from `{ repos }` alone — **Y1**,
    **Y2**.
25. The suite is **15 files**, all green, with the `test` service at
    `network_mode: none`; `dependency-policy`, `deploy-shape`, `config`, `health` and
    `harness` guards all pass with **no allowlist widened** and exactly one concept row
    added (§5.6 item 11).
26. No new dependency; `package.json`, `package-lock.json`, `compose.yaml`, `Dockerfile`
    and `lib/config.js` are unchanged (§4, §5.7).
27. No protected top-level markdown is edited (`CLAUDE.md`, `README.md`,
    `PHILOSOPHY.md`, `agents.md`) — §10 carries proposed wording for the metawork layer
    to apply instead.
28. Every §7 recipe has been run, each shown **red** for its own mutation, with the exact
    failing set recorded and any divergence from the prediction reported as a finding
    (wider **or** narrower).

---

## 7. Falsification recipes

**House technique, mandatory for every row.** Work on the branch worktree; back up the
file, `trap` the restore on `EXIT`, mutate, **assert the mutation applied**, run, record
the exact failing set, let the trap restore, prove the tree clean with
`git diff --exit-code`, then **rebuild before the next row** — a restored source tree
with a stale mutant image has produced phantom failures in this codebase before
(AS-39 §11.1).

Three standing rules, from what has gone wrong in the last six tasks:

1. **Every assert-applied step asserts on a unique marker the mutation introduces, or an
   occurrence-accurate count** — `grep -oF … | wc -l`, **never** `grep -c`, which counts
   *lines* and reads 1 for a line carrying two hits. Where a marker is used, the mutation
   inserts a token that appears nowhere else, so the baseline is 0 and the applied count
   is 1 by construction.
2. **Predicted sets name executable case names as they appear in test output**, not
   sub-labels inside a case. Every name below exists in §5.5 or in the current suite.
3. **A prediction that misses is a finding**, in either direction. Record it; do not
   quietly widen the prediction.

**Verified while planning:** each of the five existing case names cited below
(`G1`, `G1b`, `G2`, `G3`, `G15`, and the concepts case) was grepped and found exactly
once. One nuance — `G3`'s name is written in source with an escaped apostrophe
(`route\'s`), so an exact grep of the *output* spelling will not match the file. The rule
is "as they appear in **test output**", which is the plain apostrophe used below.

**One property of this suite to know before predicting:** `dependency-policy.test.js`'s
~20 concept rows all live inside **one** executable case
(`the concepts live exactly where …`). A predicted set naming that case therefore cannot
say *which* row fired — so rows M10 and M11 must additionally record the **assertion
message**, which names the concept and the offending file.

Run from the worktree: `COMPOSE="docker compose -f apps/invoicing/compose.yaml"`;
`$COMPOSE run --rm --build test`.

| # | Mutation (with its marker) | Assert applied | Predicted failing set |
|---|---|---|---|
| **M1** | `render.js`: at the slot-emission site replace `escapeHtml(value)` with `value`, appending `/* MUT-M1 */` | `grep -oF 'MUT-M1' lib/contracts/render.js \| wc -l` → **1** | `B1: …golden output` · `B3: a value containing markup is escaped…` |
| **M2** | `render.js`: at the literal-emission site replace `escapeHtml(segment.text)` with `segment.text`, appending `/* MUT-M2 */` | `grep -oF 'MUT-M2' … \| wc -l` → **1** | `B1` · `B4: template-authored text is escaped…` (B1 fires because the golden contains `document&#39;s`) |
| **M3** | **Breaks a guard this task introduces, in its own direction.** `templates.js`: change `standard terms` to `standard MUTM3 terms` in the body — content changed, version **not** bumped | `grep -oF 'MUTM3' lib/contracts/templates.js \| wc -l` → **1** | `T3: …matches its committed digest` · `B1` |
| **M4** | `generation.js`: delete the required-value check, leaving `/* MUT-M4 */` | `grep -oF 'MUT-M4' … \| wc -l` → **1** | `N2: a missing required form value is a ValidationError…` **only** — the renderer's own throw (B9) is a different case driven directly, and every other case supplies complete values |
| **M5** | `generation.js`: widen the form-key check from form-sourced names to **all** variable names, marking it `/* MUT-M5 */` | `grep -oF 'MUT-M5' … \| wc -l` → **1** | `N8: a record-sourced variable supplied as a form value…` · `P3: a record-sourced variable in the body is a 400…` (P2 stays green: nonsense keys are still rejected) |
| **M6** | `routes/contracts.js`: replace `actingFreelancerId(req)` with `(req.query?.freelancerId ?? actingFreelancerId(req))`, marking it `/* MUT-M6 */` | `grep -oF 'MUT-M6' … \| wc -l` → **1** | `P7: the identity acted on is the session's…` **only** — the query string is covered by no allowlist, which is why the mutation is put there rather than in the body |
| **M7** | **Breaks the attribution mechanism.** `templates.js`: replace the licence cross-check's condition with `/* MUT-M7 */ true` | `grep -oF 'MUT-M7' … \| wc -l` → **1** | `T4: a template declaring a source whose attribution omits the licence is refused` |
| **M8** | **Breaks the no-Stripe guard.** `render.js`: add the comment line `// stripe MUT-M8` | `grep -oF 'MUT-M8' … \| wc -l` → **1** | `Y1: nothing in the contracts path names Stripe…` **only** — and **`dependency-policy` must stay green**, which is the point: Y1 covers ground no global row covers |
| **M9** | `test/auth.test.js`: delete `'POST /contracts',` from `ALL_ROUTES` **only** | `grep -oF "'POST /contracts'," test/auth.test.js \| wc -l` → **1** (from 2) | `G1: the route walk finds the EXACT committed list — cardinality first` · `G1b: with NO webhook secret the surface is the same list minus the webhook route`. `G2` stays **green** — it filters the live walk, not `ALL_ROUTES` |
| **M10** | **Proves the money-word trap is live.** `render.js`: add the comment line `// MUT-M10 currency` | `grep -oF 'MUT-M10' … \| wc -l` → **1** | `the concepts live exactly where AS-38, AS-39, AS-40, AS-41, AS-42, AS-43 and AS-44 put them` — **record the assertion message**, which must name `money representation` and `lib/contracts/render.js` |
| **M11** | **Breaks the one-escaper row this task adds.** `routes/contracts.js`: add `function escapeHtml(x) { return x; } /* MUT-M11 */` | `grep -oF 'MUT-M11' routes/contracts.js \| wc -l` → **1** | same case as M10 — **record the assertion message**, which must name `contract HTML escape` |
| **M12** | **Vacuity probe.** `templates.js`: make the registry empty (`new Map()`), marking it `/* MUT-M12 */` | `grep -oF 'MUT-M12' … \| wc -l` → **1** | `T2`, `T3` and `T7` must be **among** the red — a green there means they quantified over nothing. Record the full set; it will be large |
| **M13** | `render.js`: append `String(Date.now())` to the attribution paragraph, marking it `/* MUT-M13 */` | `grep -oF 'MUT-M13' … \| wc -l` → **1** | `B1` · `B7: deterministic — identical inputs produce byte-identical output` · `N5: the stored variables re-render to the stored HTML byte for byte` |
| **M14** | **Proves immutability-by-absence is pinned.** `routes/contracts.js`: add `router.post('/contracts/:id', form, handle('update', …))`, marking it `/* MUT-M14 */` | `grep -oF 'MUT-M14' … \| wc -l` → **1** | `P8: no route mutates or deletes a contract` · `G1` · `G1b` · `G2: the public/protected partition is exact in BOTH directions` · `G3: every protected route's cookieless answer is ATTRIBUTABLE to the guard, not merely shaped like one` · `G15: the whole app is constructible and the boundary survives a rebuild` |

**Cardinality of this section: 14 rows. Report how many were run before reporting how
many passed.**

---

## 8. Size, complexity, and the split line

**Projected: ~570 source lines (5 new files, of which one is the test file at ~600), 9
files touched, ~1,170 total.** Complexity stays **medium**, as the description sets it.

Against the milestone plan §8.2 tripwires:

| Tripwire | This task |
|---|---|
| >~600 projected **source** lines | ~570 — under, but not by much |
| >~10 files | 9 — under |
| a title joining two subsystems with "and" | "templates **and** generation" — same subsystem, one reviewable claim: *a contract is generated from a declared template and stored* |
| would need a board ask mid-flight | no — no account, no spend, no external service |
| cannot be verified without an account we do not have | **no, and uniquely so**: this is the only server task in the app that needs nothing external. No Stripe, no mock, no network |

Calibration from AS-39 §11.4: *count one test per acceptance row, and budget validation at
~40% of each module.* Applied — 34 cases against 28 criteria, and `generation.js` is
~40% validation.

**Pre-agreed split line, measured at implementation start, not argued:**

- **In-task file split (expected, cheap).** If `templates.js` passes **~250 lines**, move
  the declaration to `lib/contracts/templates/independent-contractor-agreement.js` and
  leave `templates.js` as the registry. Cost: one extra entry in the
  `dependency-policy` source list and the count goes 47 → 48. **No plan amendment
  needed** — this line is the agreement.
- **Task split (only if the first is not enough).** If projected source passes **600
  lines** or files pass **10**, split the **route surface** out: this task lands
  `lib/contracts/*` + the T/B/N/Y cases, and a follow-up lands `routes/contracts.js` +
  the P cases and the §5.6 literals. State the cost plainly when proposing it: **AS-47
  and AS-49 would then depend on the follow-up too, adding two graph edges to the last
  server task on the line.** That is a real cost against a 30-line saving, so the bar is
  the measured trigger, not a feeling that the task is big.

---

## 9. Open questions, time-boxed

Each has a default that applies when the box expires. Owner named where it is not me.

| # | Question | Default | Box |
|---|---|---|---|
| **Q1** | **Nothing in the app creates a client.** `repos.clients.create` has **zero non-test callers** — AS-39 built the repository, AS-43's `POST /invoices` takes a `clientId`, and this task does the same. But `S{4,6}-CLIENT-*` (`00-flows.md` Flow 3) puts inline client creation on **both** screens 4 and 6, and C-16 cut the Clients screen precisely *because* "clients are created inline from the invoice and contract forms". The server half fell between AS-39 and the two UI tasks and is owned by neither. | **One shared `POST /clients`, built by whichever of AS-46/AS-47 lands first, never two.** Two UI tasks each inventing one is the parallel-implementation failure Rule 2 exists to prevent — and here neither would even know about the other. It does **not** belong on `POST /contracts` as an inline alternative to `clientId`: that would make a single-purpose route two-purpose, and screen 4 could not reuse it. Consequence to decide there, not here: a form that creates a client and a contract in one submit does two posts, so a failure between them leaves a client with no contract. That is acceptable in v1 — an un-invoiced, un-contracted client leaves no trace on Stripe (C-26 is lazy) and is re-selectable next time. | **Closes with AS-46's or AS-47's plan, whichever is written first.** Owner: that planner. Surfaced to the orchestrator in this task's report for filing. |
| **Q2** | Should `@1`'s attribution line carry the Common Paper CC BY 4.0 statement the wireframe renders, even though this body is not adapted from Common Paper? | **No** — §3.3. The line states the mechanism truthfully and names what will occupy the slot; the cross-check forces the licence in at M4. Overturning this is a one-string change to the declaration plus a bumped version and a new digest. | **Closes when the lawyer-agent review lands (M4).** Owner: CEO + CTO jointly — the gate is theirs. Flagged in the Lattice comment so Carla can overturn it cheaply. |
| **Q3** | Should a `multiline` value's blank lines become separate `<p>` elements rather than one `white-space: pre-wrap` block? | **No.** Splitting means parsing user text, which is the one thing §3.5 buys its safety by not doing. `pre-wrap` gets the same visual result with no parser. | **Decided here.** Reopens only if AS-47 finds `pre-wrap` unprintable, which would be a CSS finding, not a renderer one. |
| **Q4** | Should the renderer bound total output size (a very long value producing a very large `rendered_html`)? | **Per-variable `maxLength` only** (200 / 5000), plus the 32 kB parser limit. A total-output bound would be a second, redundant rule whose only reachable trigger is a template with far more slots than this one has. | **Reopens at the second template**, or if a future template's slot count passes ~10. |
| **Q5** | Should `contracts` gain a `supersedes` / `voided_at` column so a corrected contract can point at the one it replaces? | **No, and not by omission** — §3.8. v1 never delivers a contract (C-22 OUT), so a superseded row is one nobody outside the freelancer's account has seen. It returns in **M4** with the portal (C-22) and the acceptance event (C-23), where it becomes meaningful, and it is a migration then. | **Closes with M4's scoping.** |
| **Q6** | Does `POST /contracts` need a CSRF token beyond `requireSameOrigin` + `SameSite=Lax`? | **No.** `guard.js` states the trigger for adding one: *the first form submitted to us from a page we do not render.* This form is rendered by AS-47, on our origin. Adding one now would mean every form template must render it — four cross-task obligations whose failure mode is a broken form discovered late. | **Decided here**, on the standing rule. Reopens with that trigger, app-wide, never for one route. |

---

## 10. Proposed wording for metawork-owned files

The metawork layer applies these; **the implementer does not edit these files** (`CLAUDE.md`,
`README.md`, `PHILOSOPHY.md`, `agents.md`).

**Root `README.md`, Status section** — when AS-42 merges, extend the D1 v1 progress line
with:

> contract generation (one versioned template in code, declared variable slots, a
> single-escaper HTML renderer, and clearly-marked placeholder body text pending legal
> review)

**`CLAUDE.md`, section "The Review Gate"**, append after the mutation-testing paragraph:

> **A predicted failing set must name executable cases, and a case that carries many
> guards cannot distinguish between them (learned 2026-09-02, AS-42).** Predictions name
> test names as they appear in test output — never a sub-label inside a case — and every
> predicted name is verified to exist before it is written down. Where several guards
> live inside one executable case (`apps/invoicing/test/dependency-policy.test.js` holds
> ~20 `scanConcept` rows in a single test), naming that case proves only that *something*
> fired: the recipe must also record the **assertion message**, which names the concept
> and the offending file. Otherwise two different mutations produce identical evidence
> and neither is falsified.

No change proposed to `PHILOSOPHY.md` or `agents.md`.

**Not metawork, so the implementer applies it directly:** a paragraph in
`apps/invoicing/README.md` recording that class names inside stored `rendered_html` are a
frozen contract — they may be added to, never renamed (§3.5).

---

## 11. Stale or wrong items found while planning

None blocking. Recorded so the next reader does not re-derive them.

1. **`POST /clients` does not exist and is unowned** — §9 Q1. The most consequential
   item here; it will block AS-47's screen 6 (`S6-CLIENT-EMPTY` is reachable on a fresh
   account, and Flow 1 step 8 hits it on the very first contract).
2. **`docs/design/wireframes/screen-7-contract-detail.html` lines 97–100** render a
   Common Paper CC BY 4.0 attribution for text that is not adapted from Common Paper.
   This plan deliberately diverges (§3.3, §9 Q2). Not a wireframe defect — the wireframe
   was drawn against the *intended* end state — but AS-47 must not "fix" the renderer to
   match it.
3. **The same wireframe titles the document "Services Agreement (placeholder)"**; the
   Lattice description says "an independent-contractor-agreement shape". The description
   governs (it is the binding artifact), so the title is *Independent Contractor
   Agreement (placeholder)*. Likewise the wireframe's `name` attributes are snake_case
   (`client_id`, `project_description`, `start_date`); this app's routes are camelCase
   and the route takes camelCase (§3.9 item 1).
4. **AS-39 §8 Q4's premise** — *"AS-42 adds a column by migration if its templates are
   versioned"* — is overturned (§3.2): templates are versioned and no column is needed.
   The box is closed here, as it said it would be.
5. **AS-59's ACCEPTANCE says "the suite stays at 10 test files."** It is 14 today and 15
   after this task. Stale text in another task's description; whoever plans AS-59 should
   read it as "no new test file", which is still the right requirement.
6. **AS-64 item 1** records a second, undocumented publicness mechanism in
   `lib/auth/guard.js` (the `SIGNIN_PATH` carve-out inside `requireSession`). **This task
   adds no third mechanism**: `POST /contracts` is public or protected by mount position
   alone, and it is protected. Noted because the tasking message asks for it.
7. **`lib/views.js` and `routes/pages.js` carry an AS-45 obligation** to delete the
   scaffold page. Untouched here; this task adds no `views/` row (§5.7).
8. **`docs/design/wireframes/01-screens.md`** marks its route table *"provisional — final
   routes owned by AS-45..48"*. `POST /contracts` and the redirect target `/contracts/:id`
   are settled by this task; the `GET` screens remain AS-47's to name, but renaming
   `/contracts/:id` now costs a redirect target with a committed assertion.
9. **AS-63** is open against a "dead money-path guard, false plan rationale" elsewhere in
   this app. §3.4's decision not to copy seven unreachable error mappings across from
   `routes/invoices.js` is the same discipline applied prospectively; recorded so a
   reviewer does not read the shorter taxonomy as an omission.
