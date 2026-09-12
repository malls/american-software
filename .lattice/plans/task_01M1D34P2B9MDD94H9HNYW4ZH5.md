# AS-47: D1 v1 UI: contract screens 6-7 (create, detail with print/download)

Two screens: contract create (pick the template, pick or inline-create the client, fill the declared variables) and contract detail (view the generated contract, print or download it). Built to AS-30's wireframes and states ledgers, consuming the AS-29 tokens (docs/design/tokens/tokens.css).

IMPLEMENTS: docs/engineering/00-d1-v1-milestone-plan.md section 3 rows C-20 (contract create screen) and C-21 (contract detail screen and the v1 delivery artifact); section 4.3 screens 6 and 7 of 7.

DECISION CONTEXT. Merged as one task with a written justification (milestone plan section 8.2): one reviewable claim — "a freelancer can generate a contract and hand it to a client" — at around 450 projected lines. v1's contract DELIVERY IS FREELANCER-MEDIATED: the detail screen must produce a clean printable and downloadable document that the freelancer sends through their own email client, because a client-facing share link (row C-22) and any email sent by us (row C-48) are both out of v1. That is the honest consequence of having no ESP and no sender domain, and it is why this screen's print view is a functional requirement rather than a nicety.

The rendered contract carries the CC BY 4.0 attribution line and the visible placeholder marking produced by the contract-generation task. Do not style either away: the placeholder marking is a legal gate (adapted template text must not reach a real user before the lawyer-agent review clears), not a design blemish.

VERIFICATION: states ledger exercised — empty, variable validation errors, generating, generated, print view; the print stylesheet produces a readable single document; renders at 375px before desktop; tokens only, no magic values.

NOT IN THIS TASK: the template registry or generation logic (the contracts task); any public or client-facing contract route (row C-22, OUT — Rule 1); acceptance capture or e-signature (rows C-23 and C-24, OUT); a contract PDF renderer of our own (row C-25, OUT — the browser's print-to-PDF is v1's answer, and the spike already measured that building one is cheap and still unnecessary).

Carried comment (2026-09-01, from the AS-30 cycle-3 review): the product's print stylesheet must exclude the page heading and the Print/Download actions — the wireframe's print block previews the document region only and is not a production stylesheet.

---

**Plan author:** Owen Kessler (`agent:cto-owen`), 2026-09-12, tick watcher:79108 loop tick 5, on Opus under the Fable fallback. Master at `1a851b5`; last `apps/invoicing` code commit `4990d9d` (the AS-90 merge). **Implementer:** `agent:developer-marcus`. **Reviewer:** `agent:qa-priya`. Complexity **medium** (three stages). Staffing reasoning in §12.
**All commands run inside compose, from an isolated project.** `node_modules/` does not exist on the host. Docker is off PATH in a tick — absolute binary `/usr/local/bin/docker` via `node -e` + `spawnSync`, or `node apps/chat/bin/compose-run.mjs --project asc-<stage>-as47 --cwd <worktree>/apps/invoicing`, which takes the receipt, tears down, and asserts nothing of the project survives. Never touch `asc-invoicing-web-1` (8348) or `asc-chat-server-1` (8347). Every counted run carries `--build` and is void without its `Built` line.

---

## §0 Ground truth, measured this tick (2026-09-12)

### §0.1 Baseline, offline suite, `--build`, scratch project `asc-plan-as47`

| Service | tests | pass | fail | skipped | receipt |
|---|---|---|---|---|---|
| `test` (network_mode: none) | **406** | **388** | 0 | 18 | `Image asc-plan-as47-test Built`, run exit 0, down exit 0, leak check clean |

Log: `scratchpad/agent-cto-owen/AS-47/baseline-test.log`; receipt `scratchpad/agent-cto-owen/AS-47/baseline-receipt.txt`. 406 is the AS-70/AS-46 plans' 405 plus AS-90's one case (merged 449abb3). The `contract` half was not re-run at planning time: this task adds no stripe-mock case; the implementer runs it once at the end (AC 36). Two stale images from my own earlier planning runs (`asc-plan-as70-test`, `asc-plan-as46-test`) were removed this tick; the `asc-inv-as90*` images are AS-90's demo pipeline and were left alone.

**Predicted after implementation, against today's master: 406 + 29 = 435 tests / 417 pass / 0 fail / 18 skipped** — 29 new cases in a NEW file `test/contract-screens.test.js` (§7, every title named), no case removed, no stripe-mock case. **Under the merge order (§10) the branch rebases onto AS-70 (+13 → 419) and AS-46 (+26 → 445): expected at review ≈ 474 / 456 / 0 / 18.** A different number is recounted from the runner's own summary line and the divergence explained in the implementation comment; every number here is a prediction, not a measurement.

### §0.2 Every cardinality literal this task moves, measured on today's master, with what the two lanes ahead add

**Every one is a recount against master at rebase time, never a number copied from this table** (§10). The test's own failure message prints the truth.

| File | Literal | Today | AS-47 alone | After AS-70 (+1 route, +1 view, +2 source) and AS-46 (+4 routes, +1 view, +2 source, +2 test files) |
|---|---|---|---|---|
| `test/auth.test.js` → `test/route-surface.test.js` after AS-46 (§3.9) | `ALL_ROUTES` entries / G1 | 17 | **20** (+ `'GET /contracts/:id'`, `'GET /contracts/new'`, `'POST /contracts/new'`, sorted — `:id` sorts before `new`) | 25 |
| same | G1b (no webhook secret) | 16 | 19 | 24 |
| same | G2's protected list / G3 | 11 | **14** | 19 |
| `test/auth.test.js` | G15 `discoverRoutes(app).length` | 17 | 20 | 25 |
| same | `PUBLIC_ROUTES` | 6 | 6 — unchanged; all three new routes are protected by position | 6 |
| `test/health.test.js` | `VIEWS.length` / `VIEWS.map(v => v.file)` | 1 / `['signin.ejs']` | **3** / append `'contract-form.ejs', 'contract-detail.ejs'` in declaration order | 5 |
| `test/harness.test.js` | `EXPECTED_TEST_FILES` | 17 | **18** (+ `contract-screens.test.js`, sorted) | 20 |
| `test/dependency-policy.test.js` | app-source cardinality + list | 50 | **54** (+ `lib/screens/contract-detail-view.js`, `lib/screens/contract-form-view.js`, `views/contract-detail.ejs`, `views/contract-form.ejs`) | 58 |
| same | `RAW_OUTPUT_SANCTIONED.length` assertion | 0 | **1** (§3.3 — the whole point) | 1 |
| same | `VIEW_START_TAGS` | 87 | 87 + N *(post-write, three instruments)* — **plus 2** for the nav anchor this task adds to `views/invoice-form.ejs` (§3.7) | recount |
| same | `expectFiles` on the four `only:` rows / P4 file count (both exist only after AS-70's B5 lands) | floor `> 0` | n/a on today's master | **6 / 5** (recount) |
| `test/assets.test.js` | `APP_CSS_DECLARATIONS` / `APP_CSS_VAR_REFERENCES` | 98 / 76 | re-measured *(post-write)* — `app.css` IS edited (§3.6) | recount (AS-46 edits it too) |
| `test/contracts.test.js` | P8 `contractRoutesFound.length` and its list | 1, `['POST /contracts']` | **4** — the three new routes join, in the walker's order | 4 |
| `test/screens.test.js` | the mobile-first case (`'app.css is mobile-first…'`) | every prelude yields one `min-width` | amended: exactly **1** `@media print` prelude committed, the width rule over the rest (§3.6) | 1 |
| `test/config.test.js` | `SCHEMA.length` | 11 | unchanged | 11 |

### §0.3 Pre-write baselines for the recipes

- `<%-` in `views/*.ejs`: **0** (1 file examined). After this task: **1**, on exactly one line of `views/contract-detail.ejs`.
- `grep -oiE 'amount|currency|money'` over `views/*.ejs`, `public/*.css`, `lib/screens/*.js`, `lib/views.js`, `routes/contracts.js`: **0**. Must stay 0 — nothing on these screens is money; the `'money representation'` row does not move.
- `\bescapeHtml\b` outside `lib/contracts/render.js` (stripped text): **0**. Must stay 0 — the view models neither call nor spell it.
- `grep -oF 'validateFormValue' lib/contracts/generation.js | wc -l`: **3** today (definition + one call + one comment mention — the implementer re-measures); the export adds no call site in that file.
- `@media` preludes in `public/app.css`: **2** on master (both `min-width`), both carrying a `--breakpoint-<name>` comment. After this task: those plus exactly one `@media print {`.
- `test/auth.test.js` measures **1199 lines** by the ceiling test's instrument (`split('\n').length`). See §3.9.
- `test/contracts.test.js`: 828 by the same instrument; takes the P8 edit with room.

### §0.4 What AS-42 actually produces, read rather than assumed

`generation.generate(freelancerId, { clientId, templateId?, formValues })` validates → resolves record-sourced names from the session's own rows → `renderContract` → `repos.contracts.create`; every refusal precedes the write. The stored `renderedHtml` is **one `<article class="contract-doc">`**: a `<section class="contract-doc__notice">` (the placeholder warning, first in document order), `<h1 class="contract-doc__title">`, `<section class="contract-doc__body">` of `<p>` blocks, and `<p class="contract-doc__attribution">` last. Every text node went through the one `escapeHtml`; no data reaches an attribute; the seven class names are a frozen contract (README § Contracts). `render.js`'s header says it in so many words: *"AS-47 emits it with EJS raw output exactly once, inside the document region; every other value on those screens uses escaping output."* The form-sourced variables of the one v1 declaration are `projectDescription` (multiline, required, max 5000) and `startDate` (date, required); the record-sourced ones are `freelancerName` and `clientName`, and supplying either from a form is a `ValidationError`. The v1 attribution line deliberately does **not** name Common Paper (the body is adapted from nothing); the description's "CC BY 4.0 attribution line" is the *mechanism*, and what renders is whatever `template.attribution` says — this task renders it verbatim and styles nothing away.

## §1 Scope, and what this task is really deciding

**In scope:** screens 6 and 7 as HTML a browser renders — `GET /contracts/new`, `POST /contracts/new`, `GET /contracts/:id` (with its download variant) — every row of `02-states-ledger.md` §6 (eleven) and §7 (eight) accounted for, the `@media print` block that makes what prints the document alone, the three obligations other tasks handed here (the `/contracts/<id>` dangle in the README, the New-contract nav entry in `views/invoice-form.ejs`, the inline-client ruling from AS-46 §3.3), and the README regions naming AS-47.

**Six decisions, and only six:**

1. **The one sanctioned raw-output line** (§3.3): `RAW_OUTPUT_SANCTIONED` gains its first entry, pinned to the exact line `<%- renderedHtml %>` in `views/contract-detail.ejs`, count 1. Its dynamic falsifier is a stored description containing markup, driven through the real generate path and counted in the served bytes.
2. **Download is a response variant, not a state, and it is the same template** (§3.4): a `<form method="get">` with no `action` and a hidden `download=1` submits to the page's own URL; the route treats `?download=1` as a presence flag (value never enters the view model) and answers the same render with `Content-Disposition: attachment; filename="contract-<id>.html"`, chrome-free. Nothing user-supplied is carried in a URL; the id in the filename is the row's, not the request's.
3. **There is no Print control** (§3.5): `window.print()` needs a script and this app has none (P2c). The page carries one sentence telling the freelancer to use the browser's Print command (a recorded deviation from the wireframe's button), and `@media print` in `app.css` does the rest — hiding the heading, the nav and the actions, as the carried comment requires. The mobile-first case in `screens.test.js` learns that a media-**type** prelude is not a width condition, with the print-prelude count committed at 1.
4. **Screen 6 owns its POST and dispatches on `intent`**, exactly as AS-46 §3.1–§3.3 ruled and its README obligation hands here (§3.1, §3.2): `POST /contracts` (the API) is untouched; the screen's `intent=generate` calls the same `generation.generate`; the inline client picker creates through `repos.clients.create` after `findByEmail`, never through `POST /clients`.
5. **One validator, two callers** (§3.2): `validateFormValue` is exported from `lib/contracts/generation.js` so the screen can mark *every* failing field in one round trip, and `generate()` re-runs the identical function, so the two cannot disagree. Field copy is per field, constant, and never derived from an error's message text.
6. **`S6-ERROR-SYSTEM` re-renders in place; `S7-ERROR-SYSTEM` and `S7-ERROR-NOTFOUND` are HTML at 500/404** (§3.2, §3.4): contracts have no draft, so a failed generation created nothing and the resubmit is the retry — post-redirect-get would throw the typed values away for no gain. Both system states are reached offline by fault injection on the test's own private database file (§3.8).

**Not in scope, exhaustively:** the template registry, declarations, `render.js` (any byte) and `generate()`'s logic — `generation.js` changes by one `export` keyword and its comment; `POST /contracts` and `POST /clients` (code, statuses, bodies, `Location`s); `test/clients.test.js`, `test/invoices.test.js`, `test/connect.test.js`, `test/invoice-screen.test.js` (AS-46's), and every case of `test/contracts.test.js` except P8's route list; a Dashboard link anywhere (AS-48's — `/` redirects to `/connect-stripe` after AS-70, which is the wrong destination for "Back to Dashboard"; the nav is the way out, recorded for AS-48); a template picker (one template in v1 — a `<select>` with one option is "a disabled control with nothing behind it"; `templateId` is the default, passed explicitly, §3.2); a PDF renderer (C-25 OUT); any `<style>` element, inline or otherwise (§3.4 says what that costs and names the trigger); a client-facing route; editing `docs/design/**` (deviations go to Jonah, §11); extracting the client-picker logic AS-46 and this task now both carry (§11 Q3, a follow-up folded into AS-48's plan); any top-level protected markdown file.

## §2 File-level scope

Nothing outside this list is touched. A diff that changes a file not named here is a finding.

**Created**

| Path | What |
|---|---|
| `apps/invoicing/views/contract-form.ejs` | Screen 6, all six rendered states, presentation only |
| `apps/invoicing/views/contract-detail.ejs` | Screen 7, three rendered states plus the `isDownload` variant; the ONE raw-output line |
| `apps/invoicing/lib/screens/contract-form-view.js` | `CONTRACT_FORM_LEDGER`, `CONTRACT_FORM_STATES`, `parseContractForm`, `contractFormLocals` — fields derived from the declaration |
| `apps/invoicing/lib/screens/contract-detail-view.js` | `CONTRACT_DETAIL_LEDGER`, `CONTRACT_DETAIL_STATES`, `contractDetailLocals` |
| `apps/invoicing/test/contract-screens.test.js` | Both screens' cases (§7) — a NEW file, never an addition to `screens.test.js` or `auth.test.js` |

**Modified**

| Path | Change |
|---|---|
| `apps/invoicing/routes/contracts.js` | `GET /contracts/new`, `POST /contracts/new` (registered **before** `GET /contracts/:id`), `GET /contracts/:id`. The API handler, its `statusFor`, `fail`, `handle` and the parse-body landing do not change. Header's "NO GET ROUTES" paragraph rewritten. |
| `apps/invoicing/lib/contracts/generation.js` | `validateFormValue` gains `export` and a two-sentence comment (one validator, two callers). **No other byte.** |
| `apps/invoicing/lib/views.js` | Two rows appended: `contract-form` (`contractFormLocals()`), `contract-detail` (`contractDetailLocals()`) |
| `apps/invoicing/public/app.css` | `textarea` joins the `.field input, .field select` rules; `.doc-region`, `.doc-actions`, the seven `.contract-doc*` rules (`white-space: pre-wrap` on `__multiline`; warning tokens on `__notice`); the `@media print` block (§3.6). All `var(--token)`. |
| `apps/invoicing/views/invoice-form.ejs` | **One anchor:** `<a class="site-nav__link" href="/contracts/new">New contract</a>` in the nav — AS-46's obligation to this task. Nothing else. |
| `apps/invoicing/routes/clients.js`, `apps/invoicing/app.js` | **Comment only**, if AS-46's rebase has not already corrected the "both post HERE" sentences (§13 item 1); otherwise untouched |
| `apps/invoicing/test/contracts.test.js` | P8 only: cardinality 1 → 4 and the list (§0.2). The mutating-method probe stays (a UUID id still 404s on POST/PUT/PATCH/DELETE). |
| `apps/invoicing/test/route-surface.test.js` (after AS-46) — else `test/auth.test.js` (§3.9) | `ALL_ROUTES` +3, G1/G1b/G2/G3 literals |
| `apps/invoicing/test/auth.test.js` | G15's literal only (if the extraction has landed); see §3.9 if it has not |
| `apps/invoicing/test/health.test.js` | `VIEWS` literals |
| `apps/invoicing/test/harness.test.js` | `EXPECTED_TEST_FILES` +1 |
| `apps/invoicing/test/dependency-policy.test.js` | source list + count; `VIEW_START_TAGS`; the `RAW_OUTPUT_SANCTIONED` entry and its `length` assertion 0 → 1 with the message reworded; `expectFiles`/P4 counts (post-AS-70); the concept-row case title appends `AS-47` |
| `apps/invoicing/test/assets.test.js` | `APP_CSS_DECLARATIONS`, `APP_CSS_VAR_REFERENCES` re-measured |
| `apps/invoicing/test/screens.test.js` | the mobile-first case only (§3.6) — after AS-70 has merged; this file is AS-70's until then |
| `apps/invoicing/README.md` | § Contracts (the dangle sentence; a paragraph on the two screens, the download and the print block), § The view layer (property 1's "currently holds zero entries" becomes "holds one — the contract document region", and the raw-output paragraph), § Obligations (this task's bullets removed; AS-48 hand-offs added), § Layout (`lib/screens/` line) |

**Explicitly not modified:** `lib/contracts/render.js`, `lib/contracts/templates.js`, `lib/contracts/templates/**`, `lib/db/**`, `lib/auth/**`, `lib/stripe/**`, `lib/connect/**`, `lib/invoices/**`, `routes/invoices.js`, `routes/clients.js` (code), `lib/screens/invoice-form-view.js`, `lib/screens/connect-view.js`, `views/signin.ejs`, `views/connect-stripe.ejs`, `Dockerfile`, `compose.yaml`, `package.json`, `package-lock.json`, `demo/**`, `test/clients.test.js`, `test/invoices.test.js`, `test/connect.test.js`, `test/invoice-screen.test.js`, `test/config.test.js`, `test/deploy-shape.test.js`, `docs/**`, every top-level repo markdown file.

## §3 Design

### §3.1 Routes — three join `contractRoutes`, and the API stays the API

The AS-45 rule: a screen's routes join its capability's existing area router; no new mount in `app.js`. In `contractRoutes`, **registered in this order**, with a comment saying why the literal paths come first:

| Route | Does |
|---|---|
| `GET /contracts/new` | Renders screen 6 (§3.2 state selection) |
| `POST /contracts/new` | Parses the form, dispatches on `intent` (§3.2) |
| `GET /contracts/:id` | Renders screen 7, or its download variant when `req.query.download === '1'` (§3.4) |

Express matches in registration order; `:id` matches the literal `new`. Ids are `randomUUID()` (`lib/db/database.js`), so no contract can be named `new`. Falsified by F9. The header's "EXACTLY ONE ROUTE … NO GET ROUTES" paragraphs are rewritten to state the new set and that immutability is still implemented as absence: **there is still no `POST /contracts/:id`** — `POST /contracts/new` is a different literal path, and P8's four-method probe against a real id keeps 404ing.

**The form has no `action` attribute** (AS-46 §3.1's rule): the page's own URL is the target, which keeps every id out of a URL attribute (P2a) and makes "re-render the same screen, same route" literal. The screen's handlers are not through `handle()` — that wrapper is for redirect-or-`text/plain` actions; a render has no error to map to a one-line body. They use the same `actingFreelancerId(req)` as the one identity source; `req.currentUser` is never named (the `'current user'` row).

**Body parser:** the router's existing `form` (`extended: false`, 32 kb, 20 parameters) is reused for `POST /contracts/new` — the `'body parser'` row does not move. Screen 6's form has at most nine parameters (`intent`, `clientId`, `projectDescription`, `startDate`, `clientName`, `clientEmail`, `duplicateId`, `clientConfirm`, plus slack); 20 is enough and is asserted by case 3 counting the form's inputs. A parser refusal on the screen POST lands on the router's existing `parse-body` landing (`text/plain`, the parser's status) — carried unchanged, recorded in §13 exactly as AS-46 §13 item 5 recorded it.

### §3.2 Screen 6 — the view model, the intents, the validator

`lib/screens/contract-form-view.js` mirrors `invoice-form-view.js` in shape: a frozen `CONTRACT_FORM_LEDGER` (eleven rows, id + disposition, transcribed by hand from `02-states-ledger.md` §6 with the R-4 docstring), a frozen `CONTRACT_FORM_STATES` (the six `rendered` rows), `parseContractForm(body)` (pure), and `contractFormLocals(input)` (pure). The template branches on precomputed booleans and reads properties.

**The fields come from the declaration, not from the template.** The view model reads `getTemplate(DEFAULT_TEMPLATE_ID).variables.filter(v => v.source === 'form')` and builds `fields: [{ name, label, type, required, value, error }]` in declaration order (two today: `projectDescription`, `startDate`); the template loops and branches on `field.type` (`multiline` → `<textarea>`, `date` → `<input type="date">`, `text` → `<input type="text">`). `name="<%= field.name %>"`, `id=`, `for=` and `value=` are interpolations inside double-quoted attribute values (P3 satisfied; none of P2a's five names) and every one of them is a renderer-authored constant from code, not from a request. `templateId` is passed to `generate` **explicitly** as `DEFAULT_TEMPLATE_ID`, so the fields rendered and the declaration generated are the same object by construction; no hidden `templateId` input exists — a request cannot pick a template the screen did not render. **A record-sourced name never reaches `generate` from this screen:** `parseContractForm` reads exactly the declared form names and nothing else from the body, so `freelancerName=Someone Else` in a hand-crafted POST is simply not read (case 19 asserts the document says the session's name).

**Decision 5 — one validator.** `validateFormValue(variable, raw)` in `lib/contracts/generation.js` gains `export`. `parseContractForm` calls it per declared field, catches `ValidationError`, and records `errors[name] = true`; when the set is empty, `contractFormLocals`'s caller invokes `generation.generate`, which runs the identical function again and cannot reach a different answer. Two predicates that can disagree — the thing AS-46 §3.3 refused for client email — do not exist here. **Field copy is per field and constant**, never derived from `err.problem` (the house rule: map on class, never on message text): `projectDescription` → the wireframe's own "Describe the project in a sentence or two."; `startDate` → "Enter a date as YYYY-MM-DD." (no wireframe copy exists; recorded deviation). A field with any error shows its one sentence, over-long included — the sentence says what a valid value looks like, which is true in every failure. The banner counts what the page marks: "1 field needs attention" / "N fields need attention" (screen 1's `attentionTitle`, re-implemented locally — `signin-view.js` does not export it and this task does not edit that file).

**Intents** — the closed dispatch, AS-46 §3.2's table minus the draft-shaped ones:

| `intent` | Persists | Then |
|---|---|---|
| `generate` | **one contract row**, only when every field validates and `clientId` names an owned client | `303 /contracts/<id>` (the API's own `detailPath`) |
| `new-client` | nothing | re-render, picker in add-new mode, 200 |
| `existing-client` | nothing | re-render, picker in select mode, pre-selected on `duplicateId` if present else the submitted `clientId`, 200 |
| `add-client` | **one client row**, only when name and email are non-blank and (no case-insensitive match, or `clientConfirm=1`) | re-render, picker in select mode, the new client selected, every contract value preserved, 200 |
| anything else, absent, or an array | nothing | `400`, `S6-ERROR-VALIDATION`, banner "Choose an action." |

Inline client creation is AS-46 §3.3's ruling applied unchanged (its README obligation to this task): validate blankness only (matching `POST /clients` exactly — no email-shape rule; AS-46 Q3's default holds, and this is the planning it named as the deadline: **still one consumer of no shape rule, so nothing is exported**), `repos.clients.findByEmail` before `repos.clients.create`, first match named, both offers rendered. `add-client` creates a client and nothing else. `POST /clients` is not posted to and not changed.

**State selection, first match wins:**

| # | Condition | State | Status |
|---|---|---|---|
| 1 | `intent=add-client` with a blank name or email | `S6-CLIENT-ERROR-VALIDATION` | 400 |
| 2 | `intent=add-client`, a match exists, no `clientConfirm` | `S6-CLIENT-ERROR-DUPLICATE` | 200 |
| 3 | `intent=generate` with any field error, no/unowned `clientId`, or an unknown intent | `S6-ERROR-VALIDATION` | 400 |
| 4 | `intent=generate` validated, and `generate()` threw anything but a client-shaped refusal | `S6-ERROR-SYSTEM` | 500 |
| 5 | zero clients (picker forced to add-new; no `<select>` in the markup) | `S6-CLIENT-EMPTY` | 200 |
| 6 | otherwise | `S6-DEFAULT` | 200 |

There is **no Stripe gate** on this screen — `S6-GATED-STRIPENOTREADY` is the ledger's own n/a row ("contract generation has no Stripe dependency"), and the route reads no connected-account row at all (case 3 renders the form for a freelancer with **no** Connect row, which is the assertion). `contractRoutes` still takes `{ repos }` alone; contracts.test.js Y2 keeps binding that.

**The error-class → state map for `intent=generate`** (each row is a criterion):

| Thrown by | Class | Lands |
|---|---|---|
| `generate` step 4 | `NotFoundError` with `entity === 'client'` (missing or another freelancer's — the same error, by AS-42's design) | `S6-ERROR-VALIDATION`, the client field marked "Select a client." — indistinguishable from an unselected one |
| `generate` step 3 (cannot happen after the screen's own parse; kept for the class) | `ValidationError` naming a declared field | `S6-ERROR-VALIDATION`, that field marked |
| `generate` steps 1, 4, 5–6 | any other `NotFoundError` (template, freelancer, template variable), any other `RepositoryError`, anything else | `S6-ERROR-SYSTEM`, 500, **re-rendered in place with every value preserved** — nothing was created (generation refuses before it writes, and a failed `INSERT` is inside a transaction), so the resubmit is the retry. The banner is the wireframe's: "Something went wrong generating this contract. Nothing was created — try again." The submit button is the "Try again". |
| body-parser refusal | — | the router's `parse-body` landing, `text/plain`, unchanged (§13) |

Why not post-redirect-get here when AS-46 chose it for `S4-ERROR-SYSTEM`: AS-46's send failure leaves a persisted draft, so redirecting to it makes the retry an update rather than a duplicate. A failed generation leaves **no row**; a redirect would land on a blank form with the typed values gone. Rendering in place is the answer that preserves the values and cannot double-create. The one thing PRG buys — a browser "resubmit?" prompt on refresh — is a prompt to do exactly what "Try again" means.

**`S6-LOADING`** is `unrenderable — browser-supplied`, as S1/S2/S4. **`S6-ABANDON`** and **`S6-CLIENT-ABANDON`** are paths into renders — and on this screen they coincide in effect, as the wireframe's own S6-CLIENT-ABANDON copy says: no draft exists, so leaving loses everything typed and a return starts blank.

### §3.3 Screen 7 — the view model, and the one sanctioned raw-output line (decision 1)

`lib/screens/contract-detail-view.js`: a frozen `CONTRACT_DETAIL_LEDGER` (eight rows), a frozen `CONTRACT_DETAIL_STATES` (three: `S7-DEFAULT`, `S7-ERROR-NOTFOUND`, `S7-ERROR-SYSTEM`), and a pure `contractDetailLocals(input = {})`:

```
input.contract:   null | the repository row   (the route reads repos.contracts.getById)
input.failure:    null | 'not-found' | 'system'
input.isDownload: boolean — true ONLY when the route saw exactly ?download=1
```

Total over (contract, failure, isDownload), precedence stated: `failure === 'not-found'` → `S7-ERROR-NOTFOUND` (404); `failure === 'system'` → `S7-ERROR-SYSTEM` (500); else `S7-DEFAULT` (200). `isDownload` selects a **rendering variant of `S7-DEFAULT`** — exactly the ledger's own framing of print ("a CSS rendering variant of whichever state is active, not a distinct state") — and is `false` whenever the state is not `S7-DEFAULT`, so a `?download=1` on a missing id renders the not-found page inline, never an attachment named for a contract that does not exist.

**Locals for `S7-DEFAULT`:** `state`, `title` (`Contract with <clientName>`, from `contract.variables.clientName` — a stored, escaped-by-EJS string), `renderedHtml` (**the one local the template emits raw**), `isDownload`, `printHelp` (the constant sentence, §3.5). **No id, no timestamps, no template id** reach locals: the page renders the document, not the row. `S7-DENIED-NOTOWNER` is the ledger's own alias of NOTFOUND — the repository scopes `getById` by freelancer and throws the same `NotFoundError` for missing and not-owned, so the route *cannot* tell them apart and the two bodies are byte-identical by construction; the ledger row carries disposition `'rendered as S7-ERROR-NOTFOUND'` and is asserted as byte equality (case 24).

**The template** (`views/contract-detail.ejs`) — same head as `signin.ejs` (viewport, both stylesheets, `data-state` on `<html>`, the P1–P4 header comment **with the added warning that this file carries the one sanctioned raw-output line and that the line's exact text is pinned by the allowlist**). Body, `S7-DEFAULT`:

```
<%# chrome — omitted entirely when isDownload %>
<header class="site-header">…</header><nav class="site-nav">…New invoice · New contract · Sign out…</nav>
<main class="container">
  <h1 class="page-title"><%= title %></h1>
  <div class="doc-actions">
    <p class="page-meta"><%= printHelp %></p>
    <form method="get"><input type="hidden" name="download" value="1" /><button type="submit" class="btn btn-secondary">Download</button></form>
  </div>
  <div class="doc-region">
<%- renderedHtml %>
  </div>
</main>
```

When `isDownload` is true the body is `<main class="container"><div class="doc-region">` + the raw line + closers — no header, no nav, no heading, no actions. The head is identical in both variants (viewport meta and both stylesheet links), so the shared "every registered template links both stylesheets" check stays literally true and the template has one head; in a file opened from disk or from a mail attachment the two root-relative links resolve against `file://` and reach nothing — the download **phones nobody**, which is a claim case 23 makes by asserting zero absolute URLs in the attachment body.

**The sanctioned entry**, in `test/dependency-policy.test.js`, the first and only:

```js
{
  file: 'views/contract-detail.ejs',
  count: 1,
  line: /^\s*<%- renderedHtml %>$/,
  reason: 'AS-47: the stored contract document (lib/contracts/render.js) is emitted once, inside the document region. Every text node in it went through render.js\'s one escapeHtml and no data reaches an attribute position there; it is safe in element content and nowhere else, which is the only position this line puts it in. The line regex is the WHOLE line, so nothing else can share it.',
}
```

and the `RAW_OUTPUT_SANCTIONED.length` assertion becomes `1`, its message reworded to say a second entry is a second reviewable decision. The template's raw line is the entire line, so the regex anchors both ends and a second expression on the same line would un-sanction it. **Why raw output is right here and an escaping tag is not:** `renderedHtml` *is* HTML — escaping it would render the document's own tags as text (visibly broken, not dangerous, as README § The view layer says of a view model computing markup). The safety argument is `render.js`'s three properties, not this template's, and case 22 is what makes it a measured claim rather than a cited one: a description containing `<b>x</b>` is driven through the real `generate`, and the served page contains the escaped form exactly once and the raw form zero times.

**NOTFOUND and SYSTEM renders:** the chrome (header, nav), `<h1 class="page-title">` ("Contract not found" / "Couldn't load this contract"), a `banner-error` with the wireframe's sentence, and for SYSTEM a **retry form** — `<form method="get"><button type="submit" class="btn btn-primary">Retry</button></form>` (no `action`: a GET of the page's own URL; the wireframe's `type="button"` is a script affordance and is not built). NOTFOUND renders **no** "Back to Dashboard" link (§1). Neither renders `contract-doc` (asserted zero).

### §3.4 Download — decision 2 in full

The wireframe's Download is a `<button type="button">` — a script affordance. Without a script, "download this document as a file" is a request to the server that answers with `Content-Disposition: attachment`. Three designs were considered:

- **`GET /contracts/:id/download`** as an anchor — the id would sit in an `href=`, which P2a forbids without exception. *Rejected.*
- **`POST /contracts/:id/download`** — a POST under `/contracts/:id` is exactly the route shape AS-42 pins as absent (P8), and a download is a read. *Rejected.*
- **The page's own URL with a presence flag**, submitted by a `method="get"` form with no `action` and one hidden input — the S2 `?error=start` precedent, and the same "nothing user-supplied travels in a URL" property: the form carries a constant. *Chosen.*

The route computes `req.query.download === '1'` (anything else — absent, `'true'`, an array, a marker — is `false`) and passes the boolean; the value never enters the view model (AS-70 decision 1's shape). On `true` and `S7-DEFAULT` it sets `Content-Type: text/html; charset=utf-8` and `Content-Disposition: attachment; filename="contract-<contract.id>.html"` — **the row's id**, a UUID this app minted, never `req.params.id` — and renders the chrome-free variant with status 200. `express`'s `res.attachment()` is not used: it derives a type from the extension and this response's type is the template's; the header is set explicitly, one constant string plus the UUID.

**What the file is, honestly:** a self-contained HTML document — the article, its notice first and its attribution last, semantic and readable in any browser and in any mail client's attachment viewer, and **unstyled**. Styling it would need a `<style>` element (P2c forbids any) or absolute stylesheet URLs into this app (a recipient's browser would then fetch from us — a client-facing surface, C-22 OUT). The one visible cost is `white-space: pre-wrap` on `contract-doc__multiline`: in the unstyled file a description typed with blank lines collapses to spaces. **Recorded as a known limitation, not fixed here.** Trigger to revisit: AS-49's recorded run or the board's walkthrough finds the downloaded file inadequate in writing — then the choice is a `<style>` element admitted through a keyed, line-pinned allowlist in P2c's shape (one constant line, the `pre-wrap` rule alone) or the C-25 PDF path; either is a follow-up with its own record. The styled delivery path in v1 is print-to-PDF (§3.5), which the description names as v1's answer.

### §3.5 Print — decision 3 in full

No script means no `window.print()`. The page therefore carries one sentence in `.doc-actions`, a renderer-authored constant: **"To print, or to save as a PDF, use your browser's Print command."** It is not wireframe copy; the wireframe's Print button is not built; both are recorded for Jonah (§11 Q1). Everything else is CSS.

The `@media print` block in `public/app.css`, written to the carried comment rather than copied from `wireframe.css` (which says of itself that it is not a production stylesheet):

```css
@media print {
  .site-header, .site-nav, .page-title, .doc-actions, .page-meta { display: none; }
  .doc-region { border: none; padding: 0; max-width: none; }
}
```

— and **nothing** that targets `.contract-doc__notice`, `.contract-doc__notice-title`, `.contract-doc__attribution` or `.contract-doc__multiline`: the placeholder warning and the attribution line are inside the document and survive print because no rule touches them. That is a lexical claim about the stylesheet and case 29 asserts it: the block's hidden-selector set is committed exactly, and no selector inside the block names a `contract-doc` class. `none` and `0` are keywords/unitless (assets.test.js (a) conformant); the prelude carries no px literal (carve-out (c) unaffected).

**The mobile-first case must learn about it.** `screens.test.js`'s `'app.css is mobile-first…'` asserts every prelude yields exactly one `min-width`; `@media print` yields none and turns it red. The amendment, in that file, after AS-70 has merged: partition preludes into `printPreludes` (`/^\s*@media\s+print\s*\{/`) and the rest; assert `printPreludes.length === 1` with a comment naming this task; run the existing width assertions over the rest unchanged. The case's stated claim ("the base ruleset IS the ruleset at 375px") is untouched by a print block, which applies to no screen viewport. F-print-b is the falsifier in the direction the old case could not express.

**The print inspection** (the eyes half, §5): Chrome's print preview — or `Emulation.setEmulatedMedia({ media: 'print' })` over CDP, the AS-90 capture path — on `S7-DEFAULT`, recording that the sheet carries the notice, the title, the body, the attribution, and **not** the heading, the nav, the help sentence or the Download control.

### §3.6 Chrome, stylesheet, template rules

**Nav** (01-screens §3: screens 3–7 carry it): constant markup — **New invoice** (`/invoices/new`, exists once AS-46 merges — merge order §10), **New contract** (`/contracts/new`), **Sign out** (`<form method="post" action="/signout">`, `btn-link`). Dashboard is AS-48's. The same three entries are added to `views/invoice-form.ejs` as the one-anchor obligation AS-46 handed here (only "New contract" is missing there). Case 28 is the seam ruling made mechanical from this side: every `href`/`action` in both new templates names a registered route.

**Copy** is the wireframe's verbatim where it supplies it (screen 6: "New contract", "Client", "Select a client…", "No clients yet — add one below.", "Generate contract", the placeholder-body banner's two sentences — **without** the `data-wf-note` sibling, per 01-screens §6 — "1 field needs attention", "Describe the project in a sentence or two.", "Contract not created", "Something went wrong generating this contract. Nothing was created — try again.", "This matches an existing client:", "Use this client instead", "Create a new client anyway"; screen 7: "Contract with …", "Download", "Contract not found", "We couldn't find that contract.", "Couldn't load this contract", "Something went wrong loading this contract.", "Retry"). Deviations are the three named in §11. Apostrophes in element content only. **Zero occurrences of `amount|currency|money`** anywhere in the new files (measured 0, stays 0).

**Screen 6's placeholder banner is page chrome, not document** — it is the wireframe's `banner-warning` above the form, built from constant copy, and it is *in addition to* the notice inside every generated document; the two say the same thing to the same person at two moments and neither substitutes for the other.

**Template shape rules that make the recipes work (binding):** class names are literals per branch, never `class="banner banner-<%= tone %>"`; each rendered state owns a distinctive marker that occurs exactly once in the template source (the partition cases' committed tables — screen 6: `S6-DEFAULT` the `<select name="clientId">` branch, `S6-CLIENT-EMPTY` the "No clients yet" paragraph, `S6-ERROR-VALIDATION` the `field--invalid` textarea branch, `S6-ERROR-SYSTEM` the `banner-error` generation sentence, `S6-CLIENT-ERROR-VALIDATION` the `field--invalid` client-name branch, `S6-CLIENT-ERROR-DUPLICATE` the `duplicateId` hidden input; screen 7: `S7-DEFAULT` the raw line, `S7-ERROR-NOTFOUND` its banner sentence, `S7-ERROR-SYSTEM` the retry form); the only interpolations are element content or double-quoted `value=`/`name=`/`id=`/`for=`/`selected` attribute values (`selected` is emitted as a whole constant attribute inside a branch, never as an interpolated name — P4).

**`app.css` additions**, all `var(--token)`, from `wireframe.css`'s rules for the same class names: `textarea` joins `.field input, .field select` (and the `--invalid` and `:focus` variants); `.doc-actions` (a flex row, gap token); `.doc-region` (hairline border, `radius-lg`, `space-6`, surface bg, `max-width: var(--content-measure)`); `.contract-doc__notice` (the warning banner's tokens — border, background, text); `.contract-doc__notice-title` (weight); `.contract-doc__title` (the page-title scale); `.contract-doc__body` (`line-height: var(--line-height-relaxed)`); `.contract-doc__attribution` (the wireframe's `.doc-attribution` rules); `.contract-doc__multiline { white-space: pre-wrap; }`; the print block. **The seven class names are read from `render.js`'s `CLASS` table and renamed nowhere** (README § Contracts). If AS-46's rebase has already landed `fieldset`/`select`/`.client-picker`/`.banner-info`/`.btn-secondary`/`.site-nav*`, they are reused, not re-declared (case 3's assertion that a rule name occurs once in `app.css` is the guard).

### §3.7 The ledger partitions — arithmetic against committed tables

**Screen 6, eleven rows:** `S6-DEFAULT`, `S6-CLIENT-EMPTY`, `S6-ERROR-VALIDATION`, `S6-ERROR-SYSTEM`, `S6-CLIENT-ERROR-VALIDATION`, `S6-CLIENT-ERROR-DUPLICATE` rendered (6); `S6-DENIED-SIGNEDOUT` redirect-answered (1); `S6-ABANDON`, `S6-CLIENT-ABANDON` path-into-render (2); `S6-LOADING` unrenderable (1); `S6-GATED-STRIPENOTREADY` n/a (1). **6 + 1 + 2 + 1 + 1 = 11.**

**Screen 7, eight rows:** `S7-DEFAULT`, `S7-ERROR-NOTFOUND`, `S7-ERROR-SYSTEM` rendered (3); `S7-DENIED-NOTOWNER` rendered-as-NOTFOUND (1); `S7-DENIED-SIGNEDOUT` redirect-answered (1); `S7-LOADING` unrenderable (1); `S7-EMPTY`, `S7-ABANDON` n/a (2). **3 + 1 + 1 + 1 + 2 = 8.** The download variant is not a row and stamps `data-state="S7-DEFAULT"`, so every render stays inside the closed set.

Both view-model transcriptions are compared against the test file's own by exact set equality on `(id, disposition)` with cardinality first (R-4); the join to the document is the reviewer's dated act, recorded in the review comment. The ledger's §8 total (65) and AS-71's vendoring are unaffected.

### §3.8 Reachability

**1 — Offline suite** (`test`, no network, no accounts): every rendered state of both screens, both redirects, the paths, the n/a and unrenderable rows as committed dispositions, the download variant, the raw-output dynamic falsifier, and the print block's lexical claim. **The two system states are reached by fault injection on the test's own private database file**, through `openDatabase` from `lib/db/connection.js` (which `db.test.js` already imports): `S7-ERROR-SYSTEM` by setting a created contract's `variables` column to text that is not JSON — `mapRow`'s `JSON.parse` then throws something that is not a `NotFoundError`, which is precisely "fetch fails for a reason other than nonexistence"; `S6-ERROR-SYSTEM` by dropping the `contracts` table after the form was served — the validated `INSERT` fails inside `create`'s transaction, `mapSqliteError` yields a `RepositoryError` that is neither class the screen maps to a field, and nothing was created. A comment on each case says the injection is the instrument and that the `'raw SQL'` row does not see `test/` (the walker skips it) — so it is not a hole, and it is not to be "cleaned up" into an app-level seam.

**2 — stripe-mock:** nothing. Contracts have no Stripe dimension (Y1/Y2). The `contract` service must still pass with the screens in the image (AC 36).

**3 — Not exercisable here, named:** `S6-LOADING`, `S7-LOADING` (browser-supplied; P2c keeps it so); pixels at 375px and the print sheet (§5, eyes); the hosted flow (AS-49/AS-50).

### §3.9 The 1,200-line ceiling, and the route-surface block

`test/auth.test.js` is **1199** lines by the ceiling's instrument. AS-70 goes net −2 (1197). This task's three routes are **six** lines in the route-surface block (`ALL_ROUTES` + G2's list) — over the ceiling by one. **Under the merge order (§10) AS-46 has already moved that block to `test/route-surface.test.js` and `test/helpers/routes.js` before this task's implementation starts, and this task edits the literals there** (and G15's one literal in `auth.test.js`, which stays). **If AS-46 has not merged when implementation starts** — the order was broken or AS-46 was sent back — this task does the identical extraction itself as its first commit (AS-46 §3.6's recipe: verbatim move, `EXPECTED_TEST_FILES` +2, case count unchanged, `git diff -M` reviewable), says so in the implementation comment, and AS-46 resolves its own copy at rebase. Trimming comments to squeeze under is the wrong fix and is what the ceiling exists to refuse. **This task's own cases live in `test/contract-screens.test.js` regardless** — never in `auth.test.js`, never in `screens.test.js`.

## §4 Config changes

**None.** `SCHEMA` stays at 11. `Dockerfile` `COPY`s `views/` and `public/` whole. No dependency: `express 5.2.1` and `ejs 6.0.1` remain the only two.

## §5 Responsive at 375px, and the print sheet — the eyes half

The mechanical half is inherited: `screens.test.js`'s shared cases bind every `VIEWS` row and `app.css`, so they bind these two templates and these rules with nothing added beyond the print amendment (§3.5). The inspection: the implementer serves the states without touching the shared container — `docker compose -p asc-as47-visual -f apps/invoicing/compose.yaml run --build --rm --no-deps -d -p 127.0.0.1:8359:8348 web` (a different host port than AS-70's 8358 in case both run) — signs up in the browser, creates a client and a contract through the screens, and looks at **every rendered state of both screens at a measured 375px** (nine renders: six on screen 6, three on screen 7) plus the **download** opened from disk and the **print preview** of `S7-DEFAULT`. The record is a Lattice comment: viewport measured (not assumed — headless Chrome clamps `--window-size` to 500 and crops; render inside a 375px iframe and probe `scrollWidth === clientWidth === 375`, or use CDP `Emulation.setDeviceMetricsOverride`, the AS-90 path), every state looked at, every state not looked at, any overflow / bad wrap / control falling off, what the print sheet carried and did not, and what the downloaded file looked like unstyled. The `<textarea>` at 375px and the `[PLACEHOLDER — …]` bold runs in the document body are the two places to look hardest. Tear down with `down -v --rmi local`. Dark scheme is Chrome's headless default; say which scheme was looked at.

## §6 Size, complexity, and the pre-agreed split line

Projected against §2, honestly (the description's "around 450 projected lines" is stale by roughly 4×, the same way AS-45's and AS-46's were):

| Area | Lines |
|---|---|
| `views/contract-detail.ejs` + `lib/screens/contract-detail-view.js` + `GET /contracts/:id` + css (doc, print) | ~380 |
| `views/contract-form.ejs` + `lib/screens/contract-form-view.js` + the two `/contracts/new` routes | ~650 |
| `test/contract-screens.test.js` | ~800 |
| literal edits across seven test files, `views.js`, `generation.js`, the nav anchor | ~60 |
| `README.md` | ~70 |
| **Total** | **≈ 1,950** |

Complexity stays **medium** — no concurrency, no dependency, no external call — but the diff will be AS-46's size, and it is two screens. **The seam, decided now: screen 7 first.** Not screen 6 first: its only success path 303s to screen 7, so landing it alone ships a success path ending on a 404 (the AS-45 cycle-1 defect) by construction. Screen 7 alone is coherent — it closes the exact dangle the README names (`POST /contracts` → `/contracts/<id>` → 404, which AS-90's demo already walks into) and gives the demo a page to capture.

- **Unit A** — screen 7 whole: the three routes' third (`GET /contracts/:id`), the view model, the template with its download variant, the raw-output entry, the `contract-doc` and print rules, the mobile-first amendment, the nav (including the `invoice-form.ejs` anchor), cases 20–29, the README dangle sentence. Eight ledger rows.
- **Unit B** — screen 6 whole: the two `/contracts/new` routes, the view model with the picker, the template, the `validateFormValue` export, cases 1–19, P8's recount (which happens in Unit A for the one route and again in B — recounted each time). Eleven rows.

> **Split trigger:** at the moment Unit A is complete and green under `--build`, the implementer measures `git diff --stat master...HEAD`. **If it exceeds 800 changed lines, stop.** Commit, move AS-47 to `review` for Unit A's scope, and file `AS-47b: D1 v1 UI: contract create screen (screen 6)` carrying §3.2 verbatim, cases 1–19 verbatim, and a `depends_on` AS-47; the README's § Contracts says `/contracts/new` is AS-47b's. If it is at or under 800, carry on and land both. Do **not** split anywhere else, and do not stop at Unit B for size — the whole is the task once A is under the line.

Why 800: Unit A's projection is ~380 product + ~250 tests; a line at 800 fires only if the projection is off by the factor AS-45's was (3×), which is exactly when a fresh review surface is worth a second task. **The measurement decides, not the projection.**

**Order of work:** (1) `GET /contracts/:id` + view model + template + the sanctioned entry + css + print amendment + nav, with cases 20–29; (2) **measure, decide**; (3) `validateFormValue` export; (4) screen 6 view model + parser with its unit cases; (5) template + routes + HTTP cases 1–19; (6) P8 recount, README; (7) recipes §8; (8) rebase on master, recount every §0.2 literal, `--build` receipts for `test` and `contract`, then `review`.

## §7 Acceptance criteria and the executable cases they name

The VERIFICATION clause, verbatim: *"states ledger exercised — empty, variable validation errors, generating, generated, print view; the print stylesheet produces a readable single document; renders at 375px before desktop; tokens only, no magic values."* Cases below are created with exactly these titles in `test/contract-screens.test.js` unless another file is named; a differently titled case is a finding. Each criterion is satisfied by an **observed red** on its named §8 recipe (M4), never by an argument.

**Screen 6 — the ledger and the form**

1. *'screen 6 accounts for all eleven of its ledger rows: 6 + 1 + 2 + 1 + 1 = 11'* — two transcriptions compared by set equality and cardinality; `CONTRACT_FORM_STATES` has 6 members; each rendered state's marker (§3.6) occurs exactly once in the template source, over a committed six-row table; the n/a bucket has exactly one member and it is `S6-GATED-STRIPENOTREADY`. **Falsifier: F11a.**
2. *'the contract form view model reaches every rendered state with no HTTP, and its fields come from the declaration'* — six states from pure inputs; `fields` equals the declaration's form-sourced variables in declaration order, cardinality asserted (2 today) and read from `getTemplate(DEFAULT_TEMPLATE_ID)` in the test, not hard-coded; an unknown intent lands on `S6-ERROR-VALIDATION`; no local anywhere equals a record-sourced variable name's value.
3. *'S6-DEFAULT renders the picker, the declared fields, the placeholder warning and no Stripe gate'* — a signed-in freelancer with **no** connected-account row and one client: 200, sentinel, exactly one `<select name="clientId">`, one `<textarea` with `name="projectDescription"`, one `type="date"` with `name="startDate"`, `banner-warning` once, "Generate contract" once, exactly one `<form method="post">` with no `action` (and the sign-out form's `action="/signout"` once), the nav's three entries, form input count under the parser's 20.
4. *'S6-CLIENT-EMPTY: with zero clients the picker opens in add-new mode and no select renders'* — sentinel, `occurrences(html, '<select') === 0`, "No clients yet — add one below." once, no `new-client` toggle.
5. *'S6-ERROR-VALIDATION marks every failing field, counts them in the banner, and re-renders every submitted value as typed'* — `intent=generate`, blank description, `startDate=2026-02-31`, no client: three `field--invalid`, "3 fields need attention", the date re-rendered byte-for-byte in its `value=`, 400, nothing created; then one failing field alone → "1 field needs attention" (the wireframe's sentence). **Falsifier: F1.**
6. *'the screen and the API validate with the same function: what generate refuses, the screen marks, for every declared field'* — for each declared form field, one refused value per type (blank; a 5,001-character description; `2026-02-31`) driven through the screen marks exactly that field, and the same body posted to `POST /contracts` is 400 `text/plain` naming the same field. **Falsifier: F6.**
7. *'S6-CLIENT-ERROR-VALIDATION: blank client fields re-render with every value preserved and no client row created'* — 400, both fields marked when both blank, the description/date intact, `listByFreelancer` unchanged.
8. *'S6-CLIENT-ERROR-DUPLICATE: an email matching an existing client case-insensitively warns, names the match, creates nothing, and offers both ways forward'* — seed `ada@example.test`, submit `ADA@EXAMPLE.TEST`; 200; banner names name and email; `duplicateId` equals the seeded id; both intent buttons; count unchanged.
9. *'the two duplicate offers work: "create anyway" adds a second row, "use this client instead" selects the existing one and adds none'*.
10. *'add-client creates exactly one client and re-renders with it selected and every contract value preserved'*.
11. *'S6-ERROR-SYSTEM: a generation that fails after validation re-renders in place, names that nothing was created, and preserves every value'* — drop the `contracts` table through `openDatabase(config.dbPath)`; `intent=generate` with a valid body → 500, sentinel, the wireframe's banner sentence once, the form present with the typed values, `<form method="post">` once (the retry), zero rows (`countContracts` after restoring is not needed — assert `sqlite_master` has no `contracts` table and the response wrote nothing). **Falsifier: F4.**
12. *'generate creates one contract through the same path as the API, and lands on a detail page that exists'* — 303 `/contracts/<id>`; `followToTerminus` → `hops === 1`, `200`, sentinel `S7-DEFAULT`; the row's `renderedHtml` equals `renderContract(getTemplate(row.templateId), row.variables)`; the same inputs posted to `POST /contracts` produce a byte-identical `renderedHtml`. **Falsifier: F12.**
13. *'S6-DENIED-SIGNEDOUT: cookieless GET and POST /contracts/new are answered by the guard, and the GET lands on screen 1 carrying next'* — 303 `/signin?next=%2Fcontracts%2Fnew`, no `Set-Cookie`; following it renders screen 1 with the hidden `next`; the POST 303s with no `next`.
14. *'S6-ABANDON: two GETs are byte-identical, a non-persisting re-render is forgotten, and nothing was created'*.
15. *'S6-CLIENT-ABANDON: a new-client re-render creates no client, and the next GET starts the picker at its default variant'*.
16. *'the intent dispatch is closed: an unknown, absent or repeated intent is refused and persists nothing'* — `intent=drop`, none, `intent[]=generate&intent[]=add-client` → 400 each, sentinel, "Choose an action.", zero contracts, zero clients. **Falsifier: F10.**
17. *'a value containing markup in the description is rendered as text on the re-render, not as markup'* — escaped once, raw zero. **Falsifier: F2.**
18. *'GET and POST /contracts/new are served by the screen, never captured by /contracts/:id, and POST /contracts is unchanged'* — `GET /contracts/new` renders `S6-DEFAULT`, not NOTFOUND; a bad form post answers HTML 400 with a sentinel; `POST /contracts` with the same bad body answers `text/plain` 400 (the API's shape, cited from contracts.test.js P2). **Falsifier: F9.**
19. *'a record-sourced name posted to the screen is not read: the document says the session freelancer's name'* — `freelancerName=Someone Else` plus a valid body, `intent=generate` → 303; the row's `variables.freelancerName` is the session's `displayName`, and the served page contains "Someone Else" zero times.

**Screen 7 — the document**

20. *'screen 7 accounts for all eight of its ledger rows: 3 + 1 + 1 + 1 + 2 = 8'* — set equality, cardinality; `CONTRACT_DETAIL_STATES` has 3 members; the n/a bucket has exactly `S7-EMPTY` and `S7-ABANDON`; `S7-DENIED-NOTOWNER`'s disposition names `S7-ERROR-NOTFOUND`; each rendered state's marker once in the template; the raw-output line occurs **exactly once** in the template source and it is the whole line. **Falsifier: F11b, F-raw-b.**
21. *'S7-DEFAULT embeds the stored document byte-for-byte inside the document region, with the notice first and the attribution last'* — `occurrences(html, contract.renderedHtml) === 1`; the notice title once; `[PLACEHOLDER` three times; `template.attribution` once; the title is "Contract with " + the client's name; the download form (`method="get"`, no `action`, hidden `download` `value="1"`) once; the print sentence once; no `stripeAccountId`, no `contract.id` anywhere in the body except nowhere (asserted zero); nav present. **Falsifier: F-raw.**
22. *'markup in a stored description reaches the page escaped exactly once and raw zero times'* — generate through the screen with `<b>ASC47</b>` in the description (the F2 shape, but on the **stored** document driven through the sanctioned raw line): `&lt;b&gt;ASC47&lt;/b&gt;` once, `<b>ASC47</b>` zero. **Falsifier: F-raw** (a mutation of `render.js`'s escaper is not this task's — the recipe mutates the *template*, §8).
23. *'?download=1 answers the same document as an attachment named for the row, chrome-free and phoning nobody; any other value is the page'* — 200, `content-type` `text/html; charset=utf-8`, `content-disposition` exactly `attachment; filename="contract-<row.id>.html"`; body: `occurrences(body, contract.renderedHtml) === 1`, zero `<nav`, zero `<form`, zero `page-title`, zero `doc-actions`, zero `://`, `data-state="S7-DEFAULT"` once; then `?download=ASC47MARK` and `?download[]=1` → 200 with **no** `content-disposition` header, the full page, zero occurrences of the marker; and `?download=1` on an unknown id → 404 HTML with no `content-disposition`. **Falsifier: F-dl.**
24. *'S7-ERROR-NOTFOUND and S7-DENIED-NOTOWNER: an unknown id and another freelancer's id are answered identically, as HTML, at 404'* — two responses, both 404, `text/html`, sentinel `S7-ERROR-NOTFOUND`, zero `contract-doc`, and **byte-identical bodies**; no "Dashboard" anchor. **Falsifier: F11b.**
25. *'S7-ERROR-SYSTEM: a stored row that cannot be read renders the system state at 500 with a retry that is a GET of the same page'* — corrupt `variables` via `openDatabase`; 500, sentinel, the wireframe's sentence once, `<form method="get">` with a "Retry" button once and no `action`, zero `contract-doc`, zero occurrences of the corrupt text. **Falsifier: F-sys.**
26. *'S7-DENIED-SIGNEDOUT: a cookieless GET /contracts/<id> is answered by the guard and lands on screen 1 carrying next'* — 303 `/signin?next=%2Fcontracts%2F<id>`, no `Set-Cookie`; following it renders screen 1 with the hidden `next`.
27. *'S7-EMPTY and S7-ABANDON are n/a and S7-LOADING is browser-supplied: a read creates no state and renders no collection'* — two successive GETs byte-identical; zero `<table`, `<ul`, `<ol`, `<li` (delimited); the three dispositions committed.
28. *'every href and form action in the two contract templates names a route the app registers'* — the AS-46 case-25 instrument applied to `contract-form.ejs` and `contract-detail.ejs` (cardinality of links examined committed first); red if `/invoices/new` does not exist, i.e. if this task is merged before AS-46. **Falsifier: F8.**
29. *'the print block hides the chrome and the actions, touches no contract-doc class, and pre-wrap holds outside it'* — over `public/app.css`: exactly one `@media print` block; its hidden-selector set equals the committed set `{.site-header, .site-nav, .page-title, .doc-actions, .page-meta}`; no selector inside the block contains `contract-doc`; `.contract-doc__multiline` declares `white-space: pre-wrap` in the base ruleset; and every one of the seven `render.js` `CLASS` values (imported from nowhere — the test reads `render.js`'s output by rendering the v1 declaration and extracting class names, so the frozen contract is the source) has at least one rule in `app.css`. **Falsifiers: F-print-a, F-print-b.**

**Route surface, registry, guards, record**

30. Route walk: 20 routes, 6/14; the three new routes in G2's protected list; G1b 19; G15 20; contracts.test.js P8 `4` and its list — **all recounted at rebase** (§0.2, §10).
31. `VIEWS` has three rows, all `sampleLocals` render; `/healthz` `views` check passes; `harness.test.js` 18 files.
32. `dependency-policy.test.js`: source 54; `RAW_OUTPUT_SANCTIONED.length === 1`, the entry `seen` exactly 1; P1–P4 green over the widened set with committed file counts; `VIEW_START_TAGS` re-measured (three instruments, recorded); the money row unmoved; `escapeHtml` still pinned to `render.js`. **Falsifiers: F-raw-b, F11a/b.**
33. `test/screens.test.js`'s mobile-first case: exactly one print prelude committed; width assertions over the rest. **Falsifier: F-print-b.**
34. `app.css`: no magic values, every `var()` resolves; `APP_CSS_*` re-measured; no fixed-width box (existing cases). `generation.js` differs from master by the `export` keyword and comment lines only (the implementer quotes the hunk). `render.js` byte-identical to master (`git diff master...HEAD -- apps/invoicing/lib/contracts/render.js` empty).
35. `test/auth.test.js` ≤ 1,200 by the ceiling's instrument; the measured number recorded (§3.9).
36. Full offline suite green in `docker compose run --build --rm test` from an isolated project, `Image … Built` quoted, cardinality before pass count, count compared to the §0.1 prediction with any divergence explained; `docker compose run --build --rm contract` green with its Built line; `ASC_SELFTEST_MUTATE=1 test` exits 1 (F12).
37. README per §9: `grep -n '404s until AS-47\|AS-47 lands' apps/invoicing/README.md` returns zero hits; property 1's "zero entries" sentence corrected; the AS-48 hand-offs stated once in § Obligations.
38. A Lattice comment records the 375px + print + download inspection per §5.
39. Every §8 recipe run with its assert-applied count on disk **and in the image**, predicted vs observed set, every divergence classified. F12 at both ends.
40. Commits as `developer-marcus` in the actor-id form; every commit `AS-47: …`; zero `.lattice/` paths in the branch diff; commit early and keep `scratchpad/agent-developer-marcus/AS-47/progress.md` current (headless-tick cutoff rule).

## §8 Falsification recipes

**Rules** (AS-45 §7's, unchanged): mutate a `git archive HEAD` extract **outside** the worktree; assert applied on disk **and in the built image** with an occurrence-accurate count (`grep -oF … | wc -l`, never `grep -c`), anchored so it can only hit the intended site (the AS-95 sharpening — re-read the mutated file's diff before concluding a guard is weak); predict executable case titles **before** running; never widen a prediction after observing; prove restoration with `git diff --exit-code`; rebuild and re-run. Isolated project per recipe (`-p asc-as47-f1` …), torn down with `down -v --rmi local`. Numbers for files this task creates are *(post-write)* and measured by the implementer.

**F-raw — the sanctioned line is the only raw site, and the dynamic half is real.** Three directions. *(a)* Change the template's `<%- renderedHtml %>` to the escaping tag. Assert applied: `<%-` count in `views/contract-detail.ejs` 1 → 0. *Predicted, exactly four:* the concept-row case (`RAW_OUTPUT_SANCTIONED views/contract-detail.ejs matched 0 line(s), expected 1 — the entry is stale`), case 21 (`occurrences(html, renderedHtml)` 1 → 0), case 23 (the attachment no longer contains the document), and case 22 — escaping the already-escaped document turns `&lt;b&gt;` into `&amp;lt;b&amp;gt;`, and `&amp;lt;` does not contain `&lt;` as a substring, so "escaped once" reads zero. Three means case 22 is asserting on something other than the served bytes; five means another case reads the document region — name it. *(b)* Add a second raw line, `<%- title %>`, elsewhere in the template. Assert applied 1 → 2. *Predicted, exactly one:* the concept-row case (`not sanctioned`). *(c)* Put the raw tag on a line with something else: `<div><%- renderedHtml %></div>`. Assert applied by the marker. *Predicted, exactly one:* the concept-row case — the whole-line regex no longer matches (the entry reports stale AND the hit reports unsanctioned; one case, two messages). This is what "pinned to one exact line" means and it is measured, not asserted.

**F-raw-b — the entry cannot absorb a second occurrence.** Duplicate the sanctioned line verbatim on the next line. Assert applied 1 → 2. *Predicted, exactly two:* the concept-row case (`matched 2 line(s), expected 1 — over-used`) and case 20 (the template-source count of the raw line, 1 → 2). And case 21 (`occurrences(html, renderedHtml)` 1 → 2) — **three.** Name all three before running.

**F1 — the re-render property.** Remove the `value="<%= field.value %>"` from the date input branch (anchor: the only `type="date"` input). *Predicted, exactly two:* case 5 (the date not re-rendered) and case 10 (contract values preserved after add-client). If case 7 also moves, its "description/date intact" assertion is on the same attribute — say so.

**F2 — markup out of the description reaches the page.** Change the textarea's content interpolation to the raw tag. Assert applied: `<%-` in `views/contract-form.ejs` 0 → 1. *Predicted, exactly two:* case 17 and the concept-row case (unsanctioned raw output in a second file).

**F4 — the system state is not decorative.** In the `generate` intent's catch, route every error to `S6-ERROR-VALIDATION` instead of `S6-ERROR-SYSTEM` (anchor: the branch that tests `err instanceof NotFoundError && err.entity === 'client'`). *Predicted, exactly one:* case 11 (sentinel and status). Case 1's marker count is untouched — the branch is in the route, not the template — and that is worth one sentence.

**F6 — the two callers can disagree.** In `parseContractForm`, replace the `validateFormValue` call for the `date` type with a local `/^\d{4}-\d{2}-\d{2}$/` test. Assert applied by the introduced regex, 0 → 1 in `lib/screens/`. *Predicted, exactly one:* case 6's `2026-02-31` row — the screen now accepts what `generate` refuses, and `generate` throws a `ValidationError` naming `startDate`, which the screen maps to the field; the case fails because it asserts the screen refused **before** calling generate (assert on a `generate` spy count or on the S6 render path — the implementer picks and says which). If nothing goes red, case 6 is not distinguishing "the screen refused" from "generate refused" — a finding against the case.

**F8 — the link check reads the app.** Change the nav's `href="/contracts/new"` to `/contracts/nwe` in `contract-detail.ejs`. Assert applied 0 → 1. *Predicted, exactly one:* case 28 naming the template and the href. **Second direction, run before AS-46 is in the branch's history (if it ever is not):** the unmutated tree shows case 28 red on `/invoices/new` — recorded as the seam ruling working.

**F9 — registration order.** Move the two `/contracts/new` registrations below `router.get('/contracts/:id', …)`. Assert applied by line numbers (`grep -n` both, before and after). *Predicted:* case 18 (NOTFOUND answers `GET /contracts/new`), case 3, and every case that GETs or POSTs `/contracts/new` — record the full set; case 18 is the one whose message names the cause.

**F10 — the closed dispatch.** Add a `default:` that treats an unknown intent as `generate`. *Predicted, exactly one:* case 16 (three sub-assertions). 

**F11a / F11b — the partitions are not decorative.** *(a)* Delete the `S6-CLIENT-ERROR-DUPLICATE` branch (the `duplicateId` hidden input's block) from `contract-form.ejs`. Assert applied: `duplicateId` count n → 0. *Predicted, at least three:* cases 8, 9, and 1's marker table — plus the concept-row case on `VIEW_START_TAGS`. Fewer than three means a state is asserted by one path. *(b)* In `contract-detail-view.js`, change `S7-DENIED-NOTOWNER`'s disposition to `'rendered'`. *Predicted, exactly two:* case 20 (set inequality, `CONTRACT_DETAIL_STATES` 3 → 4) and the `views` health check if the template ever branches on the disposition (it does not; predict **one** and say so).

**F12 — the vacuity floor.** `-e ASC_SELFTEST_MUTATE=1 test` exits 1; plain `test` exits 0; start and end, rebuilt images.

**F-dl — the download flag is a boolean, and the filename is the row's.** *(a)* View model / route: `req.query.download === '1'` → `Boolean(req.query.download)`. *Predicted, exactly one:* case 23 (`?download=ASC47MARK` now attaches). *(b)* Filename from `req.params.id` instead of `contract.id`. *Predicted:* **zero** on the happy path — the two are equal for a found row — so this recipe's teeth are case 23's unknown-id half only if the route sets the header before the lookup; with the header set after a successful lookup it is unreachable. **Run it, predict zero, and record that the property is structural (the header line follows the lookup) rather than tested** — an honest zero is the finding, not a failure of the recipe.

**F-sys — the system state is reached by the injection, not by accident.** Restore the corrupt row's JSON before the GET in case 25 (a scratch edit of the test). *Predicted:* case 25 red on the sentinel (`S7-DEFAULT` renders). This proves the injection is what produces the state.

**F-print-a — the print block touches the document.** Add `.contract-doc__notice { display: none; }` inside the `@media print` block. Assert applied 0 → 1. *Predicted, exactly one:* case 29. **F-print-b — a second print prelude, or a width prelude without a min-width.** Duplicate the `@media print {` block. *Predicted, exactly two:* case 29 (exactly one block) and the amended mobile-first case (`printPreludes.length` 2). Then, separately, add `@media (max-width: 600px) {}`: the mobile-first case is red on `max-width` (the old direction still works) — record both.

**F-order-P8 — contracts.test.js P8 still refuses mutation.** Not a mutation of the app: with the branch as written, P8's four-method probe against a real id must stay green and its list must be exactly the four routes. Run P8 alone and quote its list.

**Not re-run** (unchanged guards, proven under AS-45/AS-70/AS-46): F3a/b (money — nothing here is money; measured 0), F5 (no gate exists here), F7, F13–F17, F18–F23 (AS-70's), C4a–C4c. If the rework touches what one exercises, it is re-run and said so.

**Reviewer (Priya) runs independently, minimum:** F-raw (all three directions), F-raw-b, F6, F9, F-dl(a), F-print-a — plus probing past the list (M6), budgeted: a 5,001-character description through the screen; a description of `\r\n`-separated paragraphs and what the served page and the download do with it; `?download=1&download=1`; a `clientId` of another freelancer's client with `intent=generate` (must be the "Select a client." mark, never a 404 page and never a document); the redirect chain from `intent=generate` followed to `S7-DEFAULT` and then `?download=1` on **that** URL in one session; a `startDate` of `0026-01-01`; the print preview with the emulated media on an `S7-ERROR-NOTFOUND` page (nothing to print — what does the sheet carry?); `GET /contracts/new?download=1` (the flag on the wrong screen must be ignored); and whether `<textarea>` content beginning with a newline survives the re-render (HTML drops one leading newline in a textarea — a description that starts with a blank line loses it on the round trip; if so, that is a finding against the template, and the fix is the known one: emit a newline after the opening tag).

## §9 README wording (`apps/invoicing/README.md` — the implementer edits it directly)

**§ Contracts:** replace "which 404s until AS-47 lands the screens" with: `/contracts/<id>` is **screen 7** (AS-47): the stored document emitted once, raw, inside a document region, with a `?download=1` variant that answers the same render as an `attachment` — unstyled by construction (no `<style>` element exists in this app, and absolute stylesheet URLs would make a recipient's browser fetch from us) — and a print block that hides everything but the document. `/contracts/new` is **screen 6**: it owns `POST /contracts/new` and dispatches on `intent`; `POST /contracts` remains the programmatic path; both call the one `generate`. The screen and the API validate with the same exported `validateFormValue`, so the screen can mark every failing field in one round trip and cannot accept what the API refuses. There is still no `POST /contracts/:id`.

**§ The view layer, property 1:** "currently holds **zero** entries" → "holds **one** entry: the line in `views/contract-detail.ejs` that emits a stored contract document (AS-47), pinned as the whole line, count 1. A second entry is a second reviewable decision." Drop the "that becomes the first entry" sentence.

**§ Obligations:** remove this task's bullets (the dangle, the nav entry, the inline-client ruling — all discharged). Add for **AS-48:** the Dashboard nav entry on screens 4, 6 and 7 and the "Back to Dashboard" link on `S7-ERROR-NOTFOUND` (a constant `href`; add a followed-terminus case); and a note that `S7-ERROR-NOTFOUND` currently has no link out but the nav. Add for **the next screen task touching the client picker:** the picker logic is carried twice (`invoice-form-view.js`, `contract-form-view.js`) by lane discipline; the third consumer extracts `lib/screens/client-picker.js`.

**§ Layout:** the `lib/screens/` line lists four view models.

## §10 Seams — AS-70 and AS-46, and the merge order

**Merge order, binding: AS-70 → AS-46 → AS-47.** AS-70's plan rules AS-70 before AS-46; AS-46's plan rules the same. This task goes last for three independent reasons: its nav links `/invoices/new` (case 28 is red without AS-46); its route-surface literals belong in the file AS-46's extraction creates (§3.9); and `screens.test.js` is AS-70's file until AS-70 merges (§3.5's amendment waits). **The implementer starts on a branch tip that contains both merges**, or says in the first comment that it does not and applies §3.9's contingency.

**AS-70 (`feat/AS-70-connect-screen`, in review this tick, Ruben):** adds `views/connect-stripe.ejs`, `lib/screens/connect-view.js`, `GET /connect-stripe`, a `VIEWS` row, screen 2's half of `screens.test.js`, `expectFiles` on `scanConcept`, and moves the literals this task moves (+1 route / +1 view / +2 source). Textual overlap with this task: `views.js` (append after its row), `dependency-policy.test.js` (source list, `VIEW_START_TAGS`, `expectFiles` counts), `health.test.js`, the route-surface literals, README (§ The view layer, § Obligations — different sentences, same region: read at rebase). After AS-70, `/` 303s to `/connect-stripe` — which is why no "Dashboard" link is built here.

**AS-46 (`feat/AS-46-invoice-screen`, implemented, blocked on AS-70's merge for its rebase, Lena):** adds `views/invoice-form.ejs` (this task adds one anchor to it — a **new hunk in a file AS-46 created**, so it can only be done after AS-46 is in the branch's history), `lib/screens/invoice-form-view.js` (not touched), `test/invoice-screen.test.js` (not touched; its case 25 walks every `VIEWS` row and will cover this task's templates automatically after merge), `test/route-surface.test.js` + `test/helpers/routes.js` (this task edits the literals there), `app.css` (this task appends rules; AS-46's `fieldset`/`select`/`.client-picker`/`.site-nav*`/`.btn-secondary`/`.banner-info` are reused, not re-declared), `money.js` (not touched), `harness.test.js` (+1 on top of its +2), README (§ Issuing an invoice — different region; § The view layer's two new conventions — this task's screen 6 follows both and cites them rather than restating). AS-46's plan predicts 445 at its review; this task's 29 sit on top of that.

**Instructions to the implementer, binding:**
- **Every cardinality literal is a recount against master at rebase time, never a number copied from this plan.** The test's own failure message prints the truth — read it, write it, and say in the implementation comment which numbers moved and why.
- **Rebase on master and recount before moving to `review`**; take the `--build` receipts *after* the rebase.
- **The `invoice-form.ejs` anchor and the `screens.test.js` amendment are the last two edits**, made only on a tip that contains AS-46 and AS-70 respectively.
- The raw-output entry's regex and the template line must be written together in one commit, with the assert-applied count (`<%-` in `views/`: 1) quoted in the commit message.

## §11 Open questions, each with a default and a deadline

**Q1 — Wireframe deviations for Jonah (`agent:ux-jonah`), documentation follow-up, not this task:** (a) screen 7's Print and Download buttons are script affordances; the product has a Download form and a print sentence, no Print control; (b) screen 7's `S7-ERROR-NOTFOUND` "Back to Dashboard" link waits for AS-48; (c) screen 6's `startDate` error copy ("Enter a date as YYYY-MM-DD.") has no wireframe source; (d) screen 6's `S6-ERROR-SYSTEM` section shows only a banner and a button — the product re-renders the whole form with values, which the ledger's "invites retry" is best served by; (e) §0's "malformed email" (AS-46 Q3/Q6c — unchanged: blankness only). *Default: all five stand as built.* **Deadline: AS-49's record**, folded into AS-46's Q6 list for Jonah.

**Q2 — The unstyled download.** *Default: ship it unstyled* (§3.4). Trigger and the two remedies are named there. **Deadline: AS-49's recorded run or the AS-90 walkthrough's next capture**, whichever first reports it in writing.

**Q3 — The duplicated client-picker logic.** *Default: carry it twice* (lane discipline — AS-46's file is in another lane's review). The third consumer (AS-48 does not have one; the next form screen does) extracts. **Deadline: the next task that touches either view model.**

**Q4 — `S6-ERROR-SYSTEM` at 500 vs 200.** *Default: 500* — it is a server failure and the status should say so; the page is still the form. A reviewer who thinks a re-rendered form at 500 confuses browsers (it does not — a 500 body renders) raises a plan-level finding. **Deadline: review.**

## §12 Staffing

**Implementer: `agent:developer-marcus`.** He implemented AS-42 (`render.js`'s output contract is his, and this task's centre is emitting it correctly) and AS-70 (the row-plus-boolean view-model shape and the `?flag` presence pattern this task reuses twice). Lena is on AS-46's rebase and recount the moment AS-70 merges, and this task cannot start implementation until both have — so Marcus is free by then and Lena is not. Works in `.worktrees/AS-47` on `feat/AS-47-contract-screens`; commits early; scratchpad `scratchpad/agent-developer-marcus/AS-47/` only.

**Reviewer: `agent:qa-priya`.** Ruben is on AS-70's review this tick and is named for AS-46's; queuing both screen reviews on him is the one cost this plan can avoid. Priya found P4 (the attribute-name position) during AS-45 and reviewed AS-90 — she comes cold to this code and warm to the view layer's escaping rules, which is the right pairing for the one sanctioned raw-output line. If Priya is busy when this task reaches `review`, the orchestrator assigns Ruben rather than queue. Scratchpad `scratchpad/agent-qa-priya/AS-47/` only. Findings first, sweep second (M5); the M6 probes in §8 are budgeted, not optional. Both transitions carry `--no-auto-review`; the reviewer is told not to read any daemon note before forming findings.

**Tasking messages carry the plan path, the criteria, and what to check — never the recount numbers this plan predicts** (the AS-36 rule): the reviewer measures `VIEW_START_TAGS`, the source count, the route count and the suite count independently.

## §13 Stale items found while planning

1. **`routes/clients.js:4-6` and `app.js` mount-line 13** say both screens post to `POST /clients`; AS-46 §13 item 1 already corrects both as comment-only edits. If AS-46's rebase has landed them, this task touches neither file; if not, the same one-sentence corrections (naming both plans). Recorded so two lanes do not race on the same comment.
2. **`routes/contracts.js` header** ("EXACTLY ONE ROUTE", "NO GET ROUTES … AS-47's") — rewritten in §3.1.
3. **`test/contracts.test.js` P8** pins the contract route set at one; this task is the first to widen it and does so in that case only (§0.2).
4. **The description's "CC BY 4.0 attribution line"** describes the mechanism, not v1's rendered text — the declaration deliberately credits no one (§0.4); the screen renders what the declaration says.
5. **`lib/contracts/render.js:29`** already commits this task to "EJS raw output exactly once" — honoured literally (§3.3).
6. **`docs/design/wireframes/01-screens.md` names `/dashboard`;** the app's landing is `/` (AS-46 §13 item 7, AS-48's).
7. **A parser refusal on the screen POST answers `text/plain`** through the router's existing landing — recorded as AS-46 §13 item 5 recorded it; not a ledger state; a screen-shaped landing is a follow-up if AS-49 observes one.
8. **The description's ~450-line projection** is ~4× under (§6) — the same ratio AS-45 and AS-46 measured. Complexity stays medium; the split line is set for the measurement.

## §14 Predicted counts (against today's master; recount at rebase — §10)

Cases added: **29** in `test/contract-screens.test.js` (1–29 above); 0 net elsewhere (P8's edit changes literals, not the case count; the mobile-first amendment is in place). **406 → 435** against today's master, 18 skipped unchanged; `contract` 435/435/0/0. Under §10's order the branch rebases onto AS-70 (419) and AS-46 (445): **expected at review ≈ 474 / 456 / 0 / 18** — a recount, not a commitment. Test files 17 → 18 (→ 20). Routes 17 → 20 (6 / 14) (→ 25, 6 / 19). App source files 50 → 54 (→ 58). `VIEWS` 1 → 3 (→ 5). `RAW_OUTPUT_SANCTIONED` 0 → **1**.
