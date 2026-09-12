# AS-127: D1 v1 UI: contract create screen (screen 6) — AS-47b

Screen 6 (contract create), split out of AS-47 at that plan's pre-agreed line (§6). The task description carries AS-47 plan §3.2 (the view model, the intents, the validator, the state table, the error-class map) and §7 cases 1–19 **verbatim** — this plan does not re-paste them. Read the description first; this file says what binds from AS-47's plan by section number, what this task re-decides, what changed on master and in the two in-flight lanes since AS-47's plan was written, the falsifier per property, and the seams.

**Plan author:** Owen Kessler (`agent:cto-owen`), 2026-09-12, tick watcher:79108 loop tick 11, on Opus under the Fable fallback (first spawn refused at HTTP 429). Master at `f99eecd` (AS-47 merged as `45ab932`). **Implementer:** `agent:developer-lena`. **Reviewer:** `agent:qa-ruben`. Complexity **medium** (three stages). Staffing reasoning in §12.
**All commands run inside compose, from an isolated project** (`node apps/chat/bin/compose-run.mjs --project asc-<stage>-as127 --cwd <worktree>/apps/invoicing`, or `/usr/local/bin/docker compose` via `node -e` + `spawnSync`). Never touch `asc-invoicing-web-1` (8348), `asc-chat-server-1` (8347), or another lane's `asc-impl-as48-*` / `asc-review-as49-*` projects. Every counted run carries `--build` and is void without its `Built` line.

---

## §0 Ground truth, measured this tick

### §0.1 Baseline, offline suite, `--build`, project `asc-plan-as127`

| Service | tests | pass | fail | skipped | receipt |
|---|---|---|---|---|---|
| `test` (network_mode: none) | **461** | **443** | 0 | 18 | `Image asc-plan-as127-test Built`, run exit 0, down exit 0, leak check clean (0 networks, 0 images) |

Log `scratchpad/agent-cto-owen/AS-127/baseline-test.log`, receipt `…/baseline-receipt.txt`. 461 equals the AS-47 merge receipt (70bcb5b) — nothing has landed on `apps/invoicing` since.

**Predicted after implementation, against today's master: 461 + 19 = 480 / 462 / 0 / 18**; `contract` service 480 / 480 / 0 / 0. Nineteen new cases in the **existing** `test/contract-screens.test.js` (cases 1–19, titles verbatim from the description), no new test file, no case removed, no stripe-mock case. **Under the merge order (§10) the branch rebases onto AS-49 (+7 predicted by its plan) and AS-48 (+24 measured on its branch: 475 on a 451 base): expected at review ≈ 511 / 493 / 0 / 18** — a recount, not a commitment; the runner's summary line is the truth and any divergence is explained in the implementation comment.

### §0.2 Every cardinality literal this task moves, measured on today's master, and what the two in-flight lanes add

**Every one is a recount against master at rebase time, never a number copied from this table.** The test's own failure message prints the truth.

| File | Literal | Today | This task alone | After AS-48 (+`GET /`, +`GET /invoices/:id`, +`GET /contracts/view`, +2 views, +3 source, +1 test file) and AS-49 (+1 test file, +1 helper) |
|---|---|---|---|---|
| `test/route-surface.test.js` | `ALL_ROUTES` / found count (line 101) | 23 | **25** (+`'GET /contracts/new'`, `'POST /contracts/new'`, sorted after `GET /contracts/:id`) | recount |
| same | G1b no-webhook count (line 111) | 22 | 24 | recount |
| same | protected list / count (line 176) | 17 | **19** (both new routes protected by position) | recount |
| `test/auth.test.js` | G15 `discoverRoutes(app).length` (line 1020) | 23 | 25 | recount |
| `test/health.test.js` | `VIEWS.length` / file list | 4 | **5** — append `'contract-form.ejs'` | 7 (AS-48 appends `dashboard.ejs`, `invoice-detail.ejs` **before** ours by merge order — ours goes last) |
| `lib/views.js` | rows | 4 | 5 (`contract-form`, `contractFormLocals()` → `S6-CLIENT-EMPTY`) | 7 |
| `test/harness.test.js` | `EXPECTED_TEST_FILES` / count (line 88) | 20 | **20 — unchanged** (cases join an existing file) | 22 (AS-48 `read-screens`, AS-49 `e2e-loop`) |
| `test/dependency-policy.test.js` | app-source count (line 378) + list | 56 | **58** (+`lib/screens/contract-form-view.js`, `views/contract-form.ejs`) | recount |
| same | `expectFiles` on the `views|public` rows (lines 1087, 1113) / P4 | 5 | **6** | recount |
| same | `VIEW_START_TAGS` (line 792: `87 + 43 + 206 + 58`) | 394 | + N *(post-write, three instruments)* **+ 2** on `contract-detail.ejs` (58 → 60) **+ 2** on `invoice-form.ejs` (206 → 208) for the nav anchor | recount (AS-48 re-measures both too) |
| same | `RAW_OUTPUT_SANCTIONED.length` | 1 | 1 — **unchanged**; screen 6 has no raw line | 1 |
| `test/assets.test.js` | `APP_CSS_DECLARATIONS` / `APP_CSS_VAR_REFERENCES` (184 / 143) | 184 / 143 | re-measured *(post-write)* — `textarea` joins existing selector lists, so declarations may not move; measure, do not assume | recount (AS-48 edits `app.css`) |
| `test/contracts.test.js` | P8 `contractRoutesFound` count + list (lines 750–751) | 2 | **4** — `['GET /contracts/:id', 'GET /contracts/new', 'POST /contracts', 'POST /contracts/new']` in the walker's order (read the failure message) | 5 (+`GET /contracts/view`) |
| same | Y2 registration-order list (line 818) | `['POST /contracts', 'GET /contracts/:id']` | `['POST /contracts', 'GET /contracts/new', 'POST /contracts/new', 'GET /contracts/:id']` | AS-48's `GET /contracts/view` sits between our two literals and `:id` (§3.1) |
| `test/contract-screens.test.js` | case 21 `href="/contracts/new"` count (line 198) | 0 | **1** | 1 |
| same | case 28 links examined in `contract-detail.ejs` (line 393) | 4 | **5** | 7 (AS-48 makes it 6; ours +1) |
| same | case 24 `'Dashboard'` count | 0 | 0 | 2 (AS-48's hunk; not ours) |
| `test/read-screens.test.js` (AS-48's, after rebase only) | `Create your first contract` = 0 (its line ~452); `/contracts/new` links = 0 (its line ~845); `NEW_TEMPLATE_LINKS` | — | — | **flipped by this task at rebase** (§10): CTA once, links to `/contracts/new` = 3 (nav on dashboard + invoice-detail, plus the CTA), `NEW_TEMPLATE_LINKS` +3 |
| `test/config.test.js` | `SCHEMA.length` | 11 | unchanged | 11 |

### §0.3 Pre-write baselines for the recipes

- `<%-` in `views/*.ejs`: **1** (the sanctioned line in `contract-detail.ejs`; 4 files examined). After this task: **1** — `contract-form.ejs` adds none. F2's assert-applied count is on `contract-form.ejs` alone: 0 → 1.
- `grep -oiE 'amount|currency|money'` over `views/contract-*.ejs`, `lib/screens/contract-*.js`, `routes/contracts.js`: **0**. Stays 0.
- `grep -oF 'validateFormValue' lib/contracts/generation.js | wc -l`: **2** today (definition line 32 + the call at line 90). After: 2 plus the comment's mentions; **no new call site in that file**.
- `grep -oF 'export function validateFormValue' lib/contracts/generation.js`: 0 → 1 (the whole of decision 5's diff in that file, plus its comment).
- `templateLinks('contract-detail.ejs')` (case 28's instrument): 4 today.
- `test/auth.test.js` by the ceiling's instrument: within the 1,200 ceiling after AS-46's extraction; this task adds one literal edit there (G15), no lines.

### §0.4 What AS-47 actually landed, read rather than assumed

`routes/contracts.js` (162 lines): `POST /contracts` via `handle()`; `GET /contracts/:id` at line 136 as a plain handler (not through `handle()`), reading `actingFreelancerId(req)`, mapping `NotFoundError` → `'not-found'` else `'system'`, and rendering with the status from the failure. The router's `form` parser (`extended: false`, 32 kb, 20 params) is at line 88 and is reused. `fail`/`handle`/the `parse-body` landing are unchanged by this task. **The header comment (lines 4–17) still says "The screens (AS-47) add GET /contracts/:id" as if it were the only screen route — rewritten in §3.1.**

`lib/contracts/generation.js`: `validateFormValue(variable, raw)` at line 32 is module-private; `generate` calls it at line 90 per declared form variable *after* the key-set check (step 2) and *before* the client lookup (step 4). `NotFoundError` carries `.entity` (`lib/db/errors.js:24`) and extends `RepositoryError` — the §3.2 class map's `err instanceof NotFoundError && err.entity === 'client'` test is well-formed.

`test/contract-screens.test.js` (453 lines, 10 cases): `withScreenApp` seeds one freelancer and one client and exposes `generate` (through the real service), `get`, `repos`, `config`, `headers`, `cookie`, `base`. Screen 6's cases reuse it and add a `post(path, fields)` helper (form-encoded, `redirect: 'manual'`, session headers) — there is none yet. `stateOf`, `occurrences`, `leaves`, `templateLinks` exist and are reused. The file's header says "screen 6's (1–19) follow in the same file (plan §6)" — they go **above** the screen-7 block, under a `// Screen 6 — the ledger and the form` banner, so the file reads in ledger order.

`views/invoice-form.ejs` lines 87–188 are the client picker this task mirrors (select mode with `new-client` toggle, add-new mode with `existing-client` toggle, the "No clients yet — add one below." paragraph, the duplicate `banner-warning` with both offers and the `duplicateId` + `clientConfirm` hidden inputs, `pickerMode` hidden input). `invoice-form-view.js` lines 307–330 are the picker-mode / selected-id / client-error logic. Screen 6 carries both **a second time** (§11 Q3).

AS-48's branch (`feat/AS-48-read-views`, tip `cf7e7ac`, rebased onto current master) touches this task's surface in: `routes/contracts.js` (adds `GET /contracts/view` before `:id`), `views/contract-detail.ejs` (Dashboard nav anchor + NOTFOUND's "Back to Dashboard"), `views/invoice-form.ejs` (Dashboard anchor), `test/contract-screens.test.js` (case 24 Dashboard count 0 → 2, case 28 links 4 → 6), `test/contracts.test.js` (P8 2 → 3, Y2 list), plus every literal in §0.2. Its README hands **two things** to this task with the markup: the "New contract" nav entry on `dashboard.ejs`, `invoice-detail.ejs`, `invoice-form.ejs`, `contract-detail.ejs`; and the Dashboard first-run CTA `<a href="/contracts/new" class="btn btn-primary">Create your first contract</a>` with the invoice CTA demoted to `btn btn-secondary` / "Or create an invoice directly". Its `read-screens.test.js` is red the moment either appears before the route exists.

AS-49's branch (`feat/AS-49-e2e-loop`, in review): `test/e2e-loop.test.js`, `test/helpers/stripe-double.js`, `harness.test.js` +1, README (a different region). No file this task edits except README and harness's count — trivial rebase.

## §1 Scope, and what this task decides

**In scope:** screen 6 whole — `GET /contracts/new`, `POST /contracts/new`, `lib/screens/contract-form-view.js`, `views/contract-form.ejs`, the `validateFormValue` export, cases 1–19, every §0.2 recount — plus the nav obligation Marcus handed here (the "New contract" anchor on `contract-detail.ejs` and `invoice-form.ejs`, in the same change as the route), and, **at the rebase onto AS-48**, the two things AS-48's README hands forward (the anchor on its two templates and the Dashboard CTA, with its `read-screens` assertions flipped). README regions naming AS-127.

**Binding unchanged from AS-47's plan, by section:** §3.1 (routes join `contractRoutes`, literal paths before `:id`, form without `action`, handlers not through `handle()`, the router's parser reused, parser refusals land on `parse-body`); §3.2 whole (in the description); §3.6 (chrome, copy, template shape rules — class names literal per branch, one distinctive marker per rendered state, the six-row marker table; `textarea` joins the `.field` rules; the placeholder banner is page chrome); §3.7 (6 + 1 + 2 + 1 + 1 = 11); §3.8 (`S6-ERROR-SYSTEM` by dropping `contracts` through `openDatabase(config.dbPath)` — the exact instrument AS-47's case 25 ended up using, so the precedent is now in the file); §8's rules and recipes F1, F2, F4, F6, F9, F10, F11a, F12 (re-anchored in §8 below); §11 Q1 (c)(d) (the `startDate` copy and the in-place system render, for Jonah), Q4 (500 for `S6-ERROR-SYSTEM`).

**Five decisions this task makes or re-makes:**

1. **Ruben's R1 (the unstyled download flattens `pre-wrap` paragraphs) is documented, not fixed** (§3.5). Carrying paragraph breaks into the stored document means `render.js` emitting block or `<br>` markup for `multiline` — a change to the frozen seven-class contract *and* to the reproduction invariant for every row already stored (`renderContract(getTemplate(c.templateId), c.variables) === c.renderedHtml` stops being true for rows rendered by the old function). That is AS-42's file and a legal-document change; not a side effect of a form screen. The README § Contracts carries the limitation in one sentence; the trigger AS-47 §3.4 named (a written report from AS-49's run or the board's walkthrough) is unchanged.
2. **The picker is carried a second time, verbatim in shape** (§3.3; AS-47 §11 Q3's default holds). The third consumer extracts. Screen 6 is the second.
3. **Case 6's distinguishing assertion is the pure parser, not a spy** (§3.4): `parseContractForm` marks the field *itself*, and F6 is red at that unit assertion — no instrumentation of `generate`.
4. **The `<textarea>` emits one newline after its opening tag** (§3.3) — the M6 probe AS-47's reviewer could not reach under the time box, decided now: HTML drops one leading newline inside a textarea, so a description that begins with a blank line would lose it on every re-render. Case 5 asserts the round trip.
5. **Merge order AS-49 → AS-48 → AS-127, and this task discharges AS-48's two hand-offs at its rebase** (§10) — not the other way round, because AS-48 is at its receipts already and this task has not started.

**Not in scope, exhaustively:** `render.js`, `templates.js`, `templates/**` (any byte); `generate()`'s logic (one `export` keyword and a comment); `POST /contracts`, `POST /clients` (code, statuses, bodies, `Location`s); `GET /contracts/:id`'s handler; every screen-7 case except the three literal flips named in §0.2; `lib/screens/invoice-form-view.js`, `invoice-screen.test.js` (AS-46's, and AS-48 touches the latter); the client-picker extraction; a template picker (one template — `templateId` is the explicit default); a Dashboard anchor on screen 6 **before** the rebase onto AS-48 (`/` is a 303 to `/connect-stripe` on today's master); any `<style>` element; `docs/design/**`; every top-level protected markdown file; `.lattice/` on the branch.

## §2 File-level scope

Nothing outside this list is touched. A diff that changes a file not named here is a finding.

**Created**

| Path | What |
|---|---|
| `apps/invoicing/views/contract-form.ejs` | Screen 6, all six rendered states, presentation only; the P1–P4 header comment (no raw line — say so in the comment) |
| `apps/invoicing/lib/screens/contract-form-view.js` | `CONTRACT_FORM_LEDGER`, `CONTRACT_FORM_STATES`, `STATE_STATUS`, `INTENTS`, `parseContractForm`, `contractFormLocals` |

**Modified**

| Path | Change |
|---|---|
| `apps/invoicing/routes/contracts.js` | `GET /contracts/new`, `POST /contracts/new` registered after `POST /contracts` and **before** `GET /contracts/:id`; header paragraph rewritten (§3.1). Nothing else in the file moves. |
| `apps/invoicing/lib/contracts/generation.js` | `validateFormValue` gains `export` and a two-sentence comment. **No other byte** (the implementer quotes the hunk). |
| `apps/invoicing/lib/views.js` | One row appended, last: `contract-form` / `contract-form.ejs` / `contractFormLocals()` |
| `apps/invoicing/public/app.css` | `textarea` joins `.field input, .field select` and its `--invalid` / `:focus` variants — **selector-list edits, no new rule** unless a `textarea`-only property (`resize`, `min-height` in tokens) is needed; `var(--token)` only |
| `apps/invoicing/views/contract-detail.ejs` | One anchor, between "New invoice" and the sign-out form: `<a class="site-nav__link" href="/contracts/new">New contract</a>`; the header comment's "is AS-127's" paragraph reworded to present tense |
| `apps/invoicing/views/invoice-form.ejs` | The same one anchor, same position |
| `apps/invoicing/test/contract-screens.test.js` | Cases 1–19 (new, above the screen-7 block), a `post` helper, `SCREEN_6_LEDGER`; case 21's `/contracts/new` count 0 → 1; case 28 widened to **both** contract templates with its cardinality recounted (4 → 5 on `contract-detail.ejs`, plus `contract-form.ejs`'s own count) |
| `apps/invoicing/test/contracts.test.js` | P8 count + list; Y2's registration-order list. Nothing else. |
| `apps/invoicing/test/route-surface.test.js`, `test/auth.test.js` (G15), `test/health.test.js`, `test/dependency-policy.test.js`, `test/assets.test.js` | The §0.2 literals only |
| `apps/invoicing/README.md` | § Contracts (present tense; the R1 limitation sentence), § Obligations (this task's bullets removed; AS-48's hand-off paragraph discharged at rebase), § Layout (`lib/screens/` count) |
| **At the rebase onto AS-48 only:** `apps/invoicing/views/dashboard.ejs`, `views/invoice-detail.ejs`, `test/read-screens.test.js` | The nav anchor on each; the first-run CTA swap on `dashboard.ejs` exactly as AS-48's README words it; `read-screens`' three assertions flipped (§0.2 last row) |

**Explicitly not modified:** `lib/contracts/render.js`, `lib/contracts/templates.js`, `lib/contracts/templates/**`, `lib/db/**`, `lib/auth/**`, `lib/stripe/**`, `lib/connect/**`, `lib/invoices/**`, `lib/screens/invoice-form-view.js`, `lib/screens/contract-detail-view.js`, `lib/screens/signin-view.js`, `lib/screens/connect-view.js`, `routes/invoices.js`, `routes/clients.js`, `routes/pages.js`, `app.js`, `views/signin.ejs`, `views/connect-stripe.ejs`, `Dockerfile`, `compose.yaml`, `package*.json`, `demo/**`, `test/harness.test.js`, `test/clients.test.js`, `test/invoices.test.js`, `test/connect.test.js`, `test/invoice-screen.test.js`, `test/screens.test.js`, `test/config.test.js`, `test/deploy-shape.test.js`, `test/helpers/**`, `docs/**`, every top-level repo markdown file.

## §3 Design — only what AS-47's plan did not already fix

### §3.1 Routes

Registration order in `contractRoutes`, with the comment naming the rule: `POST /contracts` (API) → `GET /contracts/new` → `POST /contracts/new` → *(AS-48's `GET /contracts/view`, after the rebase)* → `GET /contracts/:id`. Both screen handlers are plain handlers in the `GET /contracts/:id` shape (lines 136–151): `actingFreelancerId(req)`, read what the view model needs, hand it a pure input, `res.status(locals.status).render('contract-form', locals)`. `POST /contracts/new` takes the router's `form` parser as its middleware, exactly like `POST /contracts`.

**Header rewrite:** "THE ROUTE SET" paragraph states the five routes (four before AS-48), that the two `/contracts/new` literals are registered before `:id` because Express matches in order and ids are `randomUUID()` so no row is named `new`, and that immutability is still absence — there is no `POST /contracts/:id`; `POST /contracts/new` is a different literal.

**What the GET reads:** `repos.clients.listByFreelancer(freelancerId)` and nothing else — no connected-account row (case 3's assertion), no contracts read. **What the POST does, by intent:** `parseContractForm(req.body)`; `add-client` → `findByEmail` then `create` (blankness-only validation, in the view model's `clientFieldErrors`, the `invoice-form-view.js` shape); `generate` → when `submission.errors` is empty, `generation.generate(freelancerId, { clientId, templateId: DEFAULT_TEMPLATE_ID, formValues: submission.formValues })` inside a try, mapped per the description's class table (`clientRefused` for `NotFoundError` with `entity === 'client'`; `generationFailed` for anything else); success → `res.redirect(303, detailPath(contract.id))` — the same `detailPath`, not a second spelling. Every other intent re-renders.

### §3.2 The view-model input (the description gives the states and the outputs; this is the input contract)

```
contractFormLocals({
  clients?:          Array<{ id, name, email }>            // listByFreelancer
  submission?:       ReturnType<typeof parseContractForm> | null   // null on GET
  duplicate?:        { id, name, email } | null            // add-client: first case-insensitive match, unconfirmed
  createdClientId?:  string | null                         // add-client: the row the route created
  clientRefused?:    boolean                               // generate: NotFoundError entity 'client'
  generationFailed?: boolean                               // generate: anything else thrown
})
```

`parseContractForm(body)` returns `{ intent, values: { clientId, clientName, clientEmail, duplicateId, clientConfirm, pickerMode }, fields: [{ name, value }] (declaration order, only declared form names read), errors: { clientId: bool, [fieldName]: bool }, fieldErrorCount, formValues: object | null }` — `formValues` is the exact object handed to `generate` and is `null` whenever any error is set. `INTENTS = ['generate', 'new-client', 'existing-client', 'add-client']`. `STATE_STATUS` maps the six states to `{200, 200, 400, 500, 400, 200}` per the description's table and is exported so the route reads it. Locals reach the template as: `state`, `status`, `title`, `banner` (`{ tone, title, message } | null`), `fields` (`[{ name, label, type, required, value, error }]`), `fieldErrorCount`, and the picker locals **named identically to `invoice-form-view.js`'s** (`pickerMode`, `hasClients`, `showSelect`, `showNewClientToggle`, `showExistingClientToggle`, `clients[{id,label,selected}]`, `clientError`, `clientName`, `clientEmail`, `clientNameError`, `clientEmailError`, `duplicate`, `duplicateId`) — identical names so the eventual extraction is a move.

**Title copy:** `New contract` with the AS-46 suffix pattern (`— fix the highlighted fields`, `— no clients yet`, `— new client needs a name and email`, `— this looks like an existing client`) and the override `Contract not created` for `S6-ERROR-SYSTEM`. **Field labels** from the declaration's `label` when it has one, else the wireframe's ("Project description", "Start date") — the implementer reads `templates/` and says which.

### §3.3 The template — the two rules beyond §3.6

(a) **The picker block is copied from `invoice-form.ejs` lines 87–188 with `Bill to` → `Client` and nothing else changed** — same class names, same hidden inputs (`pickerMode`, `duplicateId`, `clientConfirm`), same intent buttons, same `id=`/`for=` names. A diff of the two blocks at review should show the label and indentation only. That is what makes decision 2 cheap and the extraction later mechanical.

(b) **The multiline field:** `<textarea id="…" name="…" …>` followed by **one literal newline**, then `<%= field.value %>`, then `</textarea>` — so a value beginning with `\n` survives the browser's one-newline drop. Served bytes for a value `"\nX"` therefore contain `>\n\nX</textarea>`. The `date` and `text` branches use `value="<%= field.value %>"`. Each branch pair (`field--invalid` / plain) is written out per type, as the picker does — no `class="field <%= … %>"`.

The six marker table (case 1), committed in the test: `S6-DEFAULT` → `<select id="clientId" name="clientId">` (the un-invalid select branch), `S6-CLIENT-EMPTY` → `No clients yet — add one below.`, `S6-ERROR-VALIDATION` → the `field--invalid` textarea branch (`<textarea` inside a `field--invalid` div — the implementer picks a substring that occurs once), `S6-ERROR-SYSTEM` → the generation-failed banner sentence, `S6-CLIENT-ERROR-VALIDATION` → `id="clientName-error"`, `S6-CLIENT-ERROR-DUPLICATE` → `name="duplicateId"`.

### §3.4 Case 6 — how "the screen refused, not generate" is distinguished (decision 3)

Per declared form field and per refused value (blank; 5,001 chars for `multiline`; `2026-02-31` for `date`), three assertions: (i) `parseContractForm({ intent: 'generate', clientId: 'x', …valid, [field]: bad }).errors[field] === true` and `formValues === null` — pure, no HTTP; (ii) the screen POST answers 400, `S6-ERROR-VALIDATION`, exactly that field's `field--invalid`, zero contract rows; (iii) `POST /contracts` with the same body answers 400 `text/plain` whose body names the field (`ValidationError: <field>` — the API's `fail` prints `err.step`; the implementer reads `ValidationError`'s constructor to confirm which property carries the name and cites contracts.test.js P2). F6's mutant makes (i) red and leaves (ii)/(iii) green — which is exactly the reading "the screen accepted what generate refused, and generate caught it", and the recorded outcome names all three.

### §3.5 R1 — the README sentence (decision 1)

Under § Contracts, after the download paragraph: *"The downloaded file is unstyled by construction, so a description typed with paragraph breaks — shown on screen 7 with `white-space: pre-wrap` — reads as one run of text when opened from disk. Recorded as a v1 limitation of the freelancer-mediated delivery artifact (AS-47 review R1, decided on AS-127): carrying the breaks into the stored document is a change to `render.js`'s frozen output and to the reproduction invariant of every stored row, and is a follow-up with its own record if AS-49's run or the board's walkthrough reports the file inadequate in writing."*

## §4 Config changes

**None.** `SCHEMA` stays 11; no dependency; `Dockerfile` copies `views/` and `public/` whole.

## §5 Responsive at 375px — the eyes half

Six renders of screen 6 at a measured 375px (`S6-DEFAULT`, `S6-CLIENT-EMPTY`, `S6-ERROR-VALIDATION` with all three marks, `S6-ERROR-SYSTEM`, `S6-CLIENT-ERROR-VALIDATION`, `S6-CLIENT-ERROR-DUPLICATE`), from an isolated `web` on a host port nobody else uses (`-p asc-as127-visual … -p 127.0.0.1:8360:8348`), signed up through the browser. Look hardest at the `<textarea>` width (it must not overflow the container — a textarea with no `width: 100%` will) and at the duplicate banner's two buttons wrapping. Record per AS-47 §5: viewport measured not assumed, every state looked at and not looked at, scheme. Tear down `down -v --rmi local`.

## §6 Size, complexity, and the split line

| Area | Lines |
|---|---|
| `contract-form-view.js` | ~230 |
| `contract-form.ejs` | ~190 |
| `routes/contracts.js` | ~90 |
| cases 1–19 + helper | ~560 |
| literals across seven test files, `views.js`, `generation.js`, `app.css`, two anchors | ~50 |
| README | ~40 |
| **Total, pre-rebase** | **≈ 1,160** |
| AS-48 hand-off at rebase (two anchors, CTA swap, three `read-screens` assertions, recounts) | ~25 |

Complexity **medium**: no concurrency, no external call, but three seams, a nineteen-case file and the AS-46 picker's second copy — the two-stage `low` path is wrong for it. **Screen 6 does not split by state:** with zero clients the picker is forced to add-new mode, so a screen without inline client creation cannot serve a first-run freelancer, and a screen without `generate` is a form that does nothing. **The pre-agreed line, at 1,200 changed lines measured on the pre-rebase tip once cases 1–19 are green under `--build`:** if exceeded, the **AS-48 hand-off work** (the anchors on `dashboard.ejs` / `invoice-detail.ejs`, the CTA swap, the `read-screens` flips) is filed as `AS-127b` and this task merges with the two anchors it already owns; if not, it is done at the rebase as planned. Nothing else is split, and the split never lands a link to an unserved route.

## §7 Acceptance criteria

The nineteen case titles and their assertions are in the description (AS-47 §7 cases 1–19, verbatim — a differently titled case is a finding). Each is satisfied by an **observed red** on its named recipe (M4). The criteria below **add to** those nineteen; numbering continues from AS-47's for cross-reference.

**Sharpenings of cases 1–19 (binding, in the same cases):**

- **Case 2** additionally: `parseContractForm` reads only declared names — `parseContractForm({ intent:'generate', clientId:'x', projectDescription:'ok', startDate:'2026-09-08', freelancerName:'Someone Else', templateId:'other' }).formValues` has exactly the keys `['projectDescription','startDate']` (cardinality 2, from the declaration). **Falsifier: F19.**
- **Case 3** additionally: `occurrences(html, 'href="/contracts/new"') === 1` (the nav's self-entry), `href="/invoices/new"` once, and **on today's master** `'Dashboard'` zero times (after the AS-48 rebase: the nav's four entries, `Dashboard` once — the flip is named in the implementation comment).
- **Case 5** additionally: a description of `"\nlead"` re-renders with `>\n\nlead</textarea>` occurring once (decision 4). **Falsifier: F-ta.**
- **Case 6** is structured as §3.4 (three assertions per row). **Falsifier: F6 red at (i) only.**
- **Case 11**: the injection is the `DROP TABLE contracts` after the GET; assert `sqlite_master` has no `contracts` row and `listByFreelancer` on clients is unchanged. **Falsifier: F4.**
- **Case 15** additionally: `intent=new-client` and `intent=existing-client` create **no client and no contract** (counts before/after). **Falsifier: F15.**
- **Case 8**: the case-insensitive match is `findByEmail`'s, not the screen's — assert `duplicateId` equals the seeded id. **Falsifier: F8-dup.**

**Screen 7 flips (in the existing cases, recounted at rebase):**

41. Case 21: `href="/contracts/new"` 0 → **1**, the assertion message rewritten (the AS-127 sentence removed). Case 28: `templateLinks` run over **both** `contract-form.ejs` and `contract-detail.ejs` with each file's cardinality committed (`contract-detail.ejs` 5 on today's master; `contract-form.ejs` post-write — count the stylesheet links, the nav anchors, the sign-out form action). **Falsifier: F-nav.**

**Route surface, registry, guards, record**

42. Route walk 25 (6 / 19); both new routes in the protected list; G1b 24; G15 25; P8 `4` and its list; Y2's order list — **all recounted at rebase** (§0.2, §10). **Falsifier: F9** (Y2 and case 18 both red when the order is broken).
43. `VIEWS` 5 rows, `contract-form.ejs`'s `sampleLocals.state === 'S6-CLIENT-EMPTY'` asserted in case 1 (the AS-47 case-20 pattern); `/healthz` `views` check passes; `harness.test.js` **unchanged at 20**.
44. `dependency-policy.test.js`: source 58; `expectFiles` 6 on both `views|public` rows; `VIEW_START_TAGS` re-measured (three instruments, recorded); `RAW_OUTPUT_SANCTIONED.length` **still 1** and `<%-` in `views/contract-form.ejs` = 0; the money row unmoved (§0.3); `escapeHtml` still pinned to `render.js`. **Falsifiers: F2, F11a.**
45. `app.css`: `textarea` present in each `.field input, .field select…` selector list (grep the three variants); `APP_CSS_*` re-measured; every `var()` resolves. `generation.js` differs from master by the `export` keyword and comment lines only (hunk quoted). `render.js`, `contract-detail-view.js`, `invoice-form-view.js` byte-identical to master.
46. Full offline suite green in `compose run --build --rm test` from an isolated project, `Image … Built` quoted, cardinality before pass count, count compared to §0.1's prediction with divergence explained; `contract` service green with its Built line; `ASC_SELFTEST_MUTATE=1 test` exits 1 (F12).
47. README per §9: `grep -n 'is AS-127.s\|when AS-127 lands\|until AS-127' apps/invoicing/README.md` returns zero hits after the rebase; the R1 sentence present once; § Obligations carries no AS-127 bullet.
48. A Lattice comment records the 375px inspection per §5.
49. Every §8 recipe run with its assert-applied count on disk **and in the image**, predicted vs observed set, every divergence classified; F12 at both ends.
50. Commits as `developer-lena` in the actor-id form; every commit `AS-127: …`; zero `.lattice/` paths in the branch diff; commit early and keep `scratchpad/agent-developer-lena/AS-127/progress.md` current (headless-tick cutoff rule).
51. **At the rebase onto AS-48** (if the order holds): the anchor on `dashboard.ejs` and `invoice-detail.ejs`, the CTA swap worded as AS-48's README, `read-screens`' three assertions flipped with their new counts, and AS-48's § Obligations hand-off paragraph rewritten as discharged. **Falsifier: F-nav-48** — the `read-screens` link check goes red if any of the three links is spelled wrong, and case 28's instrument is run over the two AS-48 templates too (say which file each link came from).

## §8 Falsification recipes

**Rules** (AS-47 §8's, unchanged): mutate a `git archive HEAD` extract outside the worktree; assert applied on disk **and in the built image** with an occurrence-accurate count, anchored so it can only hit the intended site — re-read the mutated file's diff before concluding a guard is weak (the AS-95 sharpening); predict executable case titles before running; never widen a prediction after observing; prove restoration with `git diff --exit-code`; rebuild and re-run; isolated project per recipe (`-p asc-as127-f1` …), torn down `down -v --rmi local`.

**Inherited, re-anchored to the files as they will exist:**

- **F1** — remove `value="<%= field.value %>"` from the `date` branch (anchor: the only `type="date"` in `contract-form.ejs`; assert `type="date"` lines carrying `value=` 2 → 0 — both the invalid and plain branches, or mutate one and say which). *Predicted:* case 5 (the date byte-for-byte), case 10 (values preserved after add-client); case 7 if its "date intact" assertion is on the same attribute — say so.
- **F2** — the textarea's `<%=` → `<%-` (anchor: the only interpolation between `<textarea` and `</textarea>`; assert `<%-` in `contract-form.ejs` 0 → 1). *Predicted, exactly two:* case 17, and the concept-row case (`raw output` unsanctioned in a second file).
- **F4** — in the `generate` catch, route every error to `clientRefused` (anchor: the `err.entity === 'client'` test in `routes/contracts.js`; assert by the line). *Predicted, exactly one:* case 11.
- **F6** — in `parseContractForm`, replace the `validateFormValue` call for `type === 'date'` with `/^\d{4}-\d{2}-\d{2}$/.test(raw)` (assert the regex 0 → 1 in `lib/screens/`). *Predicted, exactly one:* case 6, at assertion (i) for the `startDate` row. If (ii) also goes red, `generate`'s refusal is not being mapped to the field — a finding against the route.
- **F9** — move both `/contracts/new` registrations below `router.get('/contracts/:id'` (assert by `grep -n`). *Predicted:* case 18 (named cause), Y2, and every case that GETs or POSTs `/contracts/new` — record the full set.
- **F10** — add a `default:` treating an unknown intent as `generate` (anchor: the dispatch in the POST handler). *Predicted, exactly one:* case 16.
- **F11a** — delete the `duplicateId` hidden-input block from `contract-form.ejs` (assert `duplicateId` n → 0). *Predicted, at least three:* cases 1 (marker table), 8, 9; plus the concept-row `VIEW_START_TAGS` case. Fewer than three is a finding.
- **F12** — `ASC_SELFTEST_MUTATE=1 test` exits 1, plain `test` exits 0, start and end.

**New to this task:**

- **F19 — the record-sourced name is read.** In `parseContractForm`, build `formValues` from every body key that is not a picker/intent key instead of from the declaration (anchor: the `for (const variable of formVariables)` loop). Assert applied: `freelancerName` reaches `generate` — the mutant's own log line, or the diff. *Predicted, exactly two:* case 2's key-cardinality assertion, and case 19 (`generate` throws `ValidationError('freelancerName', …)`, which is not a declared field, so the screen answers `S6-ERROR-SYSTEM` 500 instead of 303).
- **F-ta — the textarea newline.** Remove the literal newline after `<textarea …>`. Assert applied: `grep -c '<textarea' ` unchanged and the following line joined (quote both). *Predicted, exactly one:* case 5's `"\nlead"` assertion.
- **F15 — a non-persisting intent persists.** Make `intent=new-client` call `repos.clients.create` with the submitted fields. *Predicted, exactly one:* case 15 (client count moved).
- **F8-dup — the match is not looked up.** Replace `repos.clients.findByEmail(...)` with `null` in the `add-client` branch. *Predicted, exactly two:* case 8 (200 with `duplicateId` seeded id — now a second row is created and the state is not DUPLICATE) and case 9's "use this client instead adds none".
- **F-count — the banner does not count.** `attentionTitle(n)` → `attentionTitle(1)` at the `S6-ERROR-VALIDATION` banner site. *Predicted, exactly one:* case 5 ("3 fields need attention").
- **F-nav — the link check reads both templates.** `href="/contracts/new"` → `/contracts/nwe` in `contract-form.ejs` only (assert 1 → 0 there; `contract-detail.ejs` untouched). *Predicted, exactly one:* case 28 naming `contract-form.ejs`. Then the same in `contract-detail.ejs`: case 28 naming that file **and** case 21 (its count 1 → 0). Two runs, two predictions.
- **F-nav-48** (after the rebase only) — one of the three new `/contracts/new` links on AS-48's templates misspelled. *Predicted:* `read-screens`' link check red naming the file; case 28 untouched (it does not read those templates — say so).
- **F-order-P8** — not a mutation: P8's four-method probe against a real id stays green with the widened set; quote its list.

**Not re-run** (unchanged guards): F-raw (a)(b)(c), F-raw-b, F-dl, F-sys, F-print-a/b (screen 7's, proven under AS-47 — except that F-raw's *predicted set* now includes nothing of screen 6, which is what "screen 6 has no raw line" means; if the reviewer re-runs F-raw(a) and case count moves by other than AS-47's recorded 5, name the case).

**Reviewer (Ruben) runs independently, minimum:** F6, F9, F19, F-ta, F11a, F-nav — plus probing past the list (M6), budgeted, the screen-6 probes AS-47 §8 named and its reviewer did not reach: a 5,001-character description through the screen; a description of `\r\n`-separated paragraphs and what the re-render and the *generated document* do with it; `clientId` of another freelancer's client with `intent=generate` (must be "Select a client.", never a 404 page, never a document, zero rows); the redirect chain from `intent=generate` followed to `S7-DEFAULT` then `?download=1` on that URL in one session; `startDate=0026-01-01`; `GET /contracts/new?download=1` (ignored); `add-client` with 21 parameters (the parser's limit — must land on `parse-body`, `text/plain`, nothing created); `intent=generate&intent=generate` (an array — 400, "Choose an action."); `clientConfirm=1` **without** a `duplicateId` on `add-client` (creates one row; the confirm is honoured only against a live match); and `pickerMode=new` with `intent=generate` and a `clientId` present (which wins — the plan says the submitted `clientId` is read regardless of mode; a row is created if it validates; say what the screen did).

## §9 README wording

**§ Contracts:** replace the "is AS-127's … it will own" paragraph with present tense: `/contracts/new` is **screen 6** (AS-127): it owns `POST /contracts/new` and dispatches on `intent`; `POST /contracts` remains the programmatic path; both call the one `generate`. The screen and the API validate with the same exported `validateFormValue`, so the screen marks every failing field in one round trip and cannot accept what the API refuses. There is still no `POST /contracts/:id`. Then the R1 sentence (§3.5).

**§ Obligations:** remove this task's bullets (the nav entry — discharged on `contract-detail.ejs` and `invoice-form.ejs`; the inline-client ruling — applied). After the rebase, rewrite AS-48's hand-off paragraph as **discharged** in one sentence. Keep the client-picker line and update it: "carried twice (`invoice-form-view.js`, `contract-form-view.js`) by lane discipline; the third consumer extracts `lib/screens/client-picker.js`."

**§ Layout:** `lib/screens/` lists five view models (seven after AS-48).

## §10 Seams and the merge order

**Merge order, binding: AS-49 → AS-48 → AS-127.** AS-49 is in review now and touches nothing of ours but README and the harness count. AS-48 is at its receipts, rebased onto current master, and its branch already edits three hunks of `contract-screens.test.js` (cases 24, 28), `contracts.js` (route registration), `contracts.test.js` (P8, Y2) and `contract-detail.ejs` / `invoice-form.ejs` (the nav) that this task also edits — so whichever lands second resolves those, and the one that has not started is the cheaper one to rebase. **This task starts on today's master** (it can — nothing it needs is on either branch) and rebases before review.

**At the rebase onto AS-48**, in this order: (1) `routes/contracts.js` — keep AS-48's `GET /contracts/view` between our two literals and `:id`; Y2's list follows. (2) `contract-screens.test.js` — take both hunks: case 24's `Dashboard` 2, case 28's `contract-detail.ejs` cardinality is AS-48's 6 **plus** our anchor = 7; case 3's nav becomes four entries. (3) P8 5 with AS-48's redirector in the list. (4) The two anchors on AS-48's templates, the CTA swap, `read-screens`' flips (§0.2 last row). (5) Every literal in §0.2 recounted from the failure messages. (6) README § Obligations (AS-48's paragraph → discharged). (7) `--build` receipts, both services, after all of it.

**If the order breaks** — AS-48 is sent back and this task reaches `done` first — this task merges **without** step (4): AS-48's own README paragraph promised the two hand-offs to us, so at AS-48's rebase its implementer flips its own three `read-screens` assertions and adds the two anchors and the CTA (its paragraph is rewritten by them to say so), and case 28's cardinality is theirs to recount. The implementation comment on AS-127 says which branch of this rule applied.

**AS-49:** trivial — README (different region), `harness.test.js` (we do not move it). If AS-49's `e2e-loop.test.js` drives `/contracts/new` (it should not: it walks the API), its case count is theirs.

**Instructions to the implementer, binding:** every cardinality literal is a recount at rebase time, never a number copied from this plan; rebase and recount before `review`, receipts after the rebase; the two nav anchors and the route land in **one commit** (a link to an unserved route must never exist on the branch, at any commit — case 28 is red at every intermediate tip otherwise); the `export` keyword and the parser's first call of it land in one commit with the §0.3 count quoted.

## §11 Open questions, each with a default and a deadline

**Q1 — R1's remedy.** *Default: document* (decision 1). Trigger: a written report from AS-49's run or the board's walkthrough. **Deadline: that report.**

**Q2 — Picker extraction.** *Default: carry twice* (decision 2). **Deadline: the third consumer.** If Ruben's review measures the two blocks as diverging beyond the label (a finding against §3.3(a)), the extraction is filed then, not done here.

**Q3 — Field labels.** Declaration `label` if present else the wireframe's. *Default as stated;* the implementer records which. **Deadline: implementation.**

**Q4 — `pickerMode=new` + `intent=generate` + a valid `clientId`.** *Default: the submitted `clientId` is read regardless of picker mode* (the parser does not gate on mode; the invoice screen behaves the same). Ruben's probe records what happens. **Deadline: review.**

**Q5 (for Jonah, documentation, with AS-47 Q1's list):** screen 6 carries a nav self-link ("New contract" on the new-contract screen) because the nav is constant markup across screens 3–7 — as screen 4 already links `/invoices/new` from itself. *Default: stands.*

## §12 Staffing

**Implementer: `agent:developer-lena`.** Marcus is on AS-48's receipts and the rebase that follows; Lena is free, implemented AS-46 (the picker this task copies is hers — she knows which of its branches exist for which review finding), and the "merge hygiene in a shared lane" note in her definition is the job here: three files this task edits are also in AS-48's diff. Works in `.worktrees/AS-127` on `feat/AS-127-contract-create`; commits early; scratchpad `scratchpad/agent-developer-lena/AS-127/` only.

**Reviewer: `agent:qa-ruben`.** He reviewed AS-47 this morning — the file, the `withScreenApp` harness, the F-series recipes and their observed reds are in his record — and his lane strength is merge seams, which is where this task's risk sits (the §10 rebase reconciles hunks from two lanes in one test file). Priya is on AS-49's review now; queueing this behind it costs a tick. Anchoring check: Ruben did not write screen 6 and his AS-47 findings were about screen 7; knowing cases 20–29 is what lets him tell a legitimate flip (case 21, 28) from a case quietly widened to pass. If Ruben is busy when this reaches `review`, the orchestrator assigns Priya rather than queue. Scratchpad `scratchpad/agent-qa-ruben/AS-127/` only. Findings first, sweep second (M5); the M6 probes in §8 are budgeted, not optional. Both transitions carry `--no-auto-review`; the reviewer is told not to read any daemon note before forming findings.

**Tasking messages carry the plan path, the criteria, and what to check — never the recount numbers this plan predicts** (the AS-36 rule).

## §13 Stale items found while planning

1. `routes/contracts.js` header (lines 4–7) describes AS-47's route set as if `GET /contracts/:id` were the only screen route — rewritten in §3.1.
2. `test/contract-screens.test.js` header says screen 6's cases "follow" screen 7's in the file — this plan puts them first, in ledger order; the header sentence is corrected in the same commit.
3. `test/contracts.test.js` P8's comment ("AS-47 widens the set with the screens' GET routes") is already stale — AS-47 added one; this task and AS-48 add the rest; reword once at the rebase.
4. AS-47 plan §3.6 promised "the same three entries" on `invoice-form.ejs`; AS-47 landed only "New invoice" + sign-out there and handed the third here (Marcus's comment). Discharged by §2.
5. `README.md` line 1130–1141 (§ Obligations) names AS-127 three times in future tense; AS-48's branch adds a fourth paragraph. All become present tense / discharged per §9.
6. The description's "expectFiles +1" is the `views|public` scope count, not `harness.test.js` — the harness count does **not** move (§0.2); a plan that moved it would be wrong.

## §14 Predicted counts (against today's master; recount at rebase — §10)

Cases added: **19** in `test/contract-screens.test.js`; 0 net elsewhere. **461 → 480 / 462 / 0 / 18**; `contract` 480 / 480 / 0 / 0. At review, after AS-49 (+7) and AS-48 (+24): **≈ 511 / 493 / 0 / 18** — a recount, not a commitment. Test files 20 → 20 (→ 22). Routes 23 → 25 (6 / 19). App source 56 → 58. `VIEWS` 4 → 5 (→ 7). `RAW_OUTPUT_SANCTIONED` 1 → 1. P8 2 → 4 (→ 5).
