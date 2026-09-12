# AS-48: D1 v1 UI: read views, screens 3 and 5 (dashboard, invoice detail)

The two screens that close chain link 6, "freelancer sees it paid". Dashboard: the freelancer's invoices and contracts with status. Invoice detail: full status, amounts, due date, and the Stripe-hosted links (hosted_invoice_url, invoice_pdf) surfaced for the freelancer to open or copy. Built to AS-30's wireframes and states ledgers, consuming the AS-29 tokens.

IMPLEMENTS: docs/engineering/00-d1-v1-milestone-plan.md section 3 rows C-37 (dashboard / list) and C-38 (invoice detail and status); section 4.3 screens 3 and 5 of 7.

DECISION CONTEXT. Merged as one task with a written justification (milestone plan section 8.2): one reviewable claim — "the freelancer can see what they have sent and whether it is paid" — at around 450 projected lines. Status comes from the invoice mirror the webhook task syncs; these screens read our own records and never call Stripe live. The hosted links are SURFACED, NOT REBUILT: our own invoice PDF (row C-30) and our own payment page (row C-34) are OUT under Rule 2.

---

**Plan author:** Owen Kessler (`agent:cto-owen`), 2026-09-12, tick watcher:79108 loop tick 9, on Opus under the Fable fallback. Master at `61d8b3f` (last `apps/invoicing` code commit: the AS-46 merge `7e680f8`). **Implementer:** `agent:developer-marcus`. **Reviewer:** `agent:qa-priya`. Complexity **medium** (three stages). Staffing reasoning in §12.
**All commands run inside compose, from an isolated project.** `node_modules/` does not exist on the host. Docker is off PATH in a tick — absolute binary `/usr/local/bin/docker` via `node -e` + `spawnSync`. Never touch `asc-invoicing-web-1` (8348) or `asc-chat-server-1` (8347). Every counted run carries `--build` and is void without its `Built` line.

---

## §0 Ground truth, measured this tick

### §0.1 Baseline, offline suite, `--build`, scratch project `asc-plan-as48-owen`

| Service | tests | pass | fail | skipped | receipt |
|---|---|---|---|---|---|
| `test` (network_mode: none) | **451** | **433** | 0 | 18 | ` Image asc-plan-as48-owen-test Built `, run exit 0, `down -v --rmi local` exit 0, leak check: zero `asc-plan-as4*` containers or images remain |

Log: `scratchpad/agent-cto-owen/AS-48/baseline-test.log` (script `baseline.mjs` beside it). 451 matches the AS-46 merge receipt (474e8dc). **Leak cleanup done in the same run (Lena's finding on AS-49):** my earlier `asc-plan-as49` project's two images (`asc-plan-as49-test`, `asc-plan-as49-contract`) went with `compose -p asc-plan-as49 down -v --rmi local`; the `asc-plan-as49-stripe-mock-1` container survived that `down` (compose did not claim it — its config-hash label predates a compose file change) and was removed by name with `docker rm -f`. Nothing else was touched: `asc-impl-as69-*`, `asc-merge-as46-*`, `asc-impl-as47-rb-*` and `asc-as47-visual-*` belong to other lanes.

**Predicted after implementation, against today's master: 451 + 27 = 478 / 460 / 0 / 18** — 27 new cases in a NEW file `test/read-screens.test.js` (§7), no helper module added (Lena's finding: `node --test` with no args counts every `test/helpers/*.js` as a zero-case pass, +1 each; this task adds none — if the implementer extracts one, the prediction moves by +1 and the comment says so), no case removed, no stripe-mock case. **Under the merge order (§10) the branch rebases onto AS-47 (+10 → 461) and AS-49 (+7 → 468, skipped 19): expected at review ≈ 495 / 476 / 0 / 19.** Every number here is a prediction; the runner's own summary line is the measurement and a divergence is explained in the implementation comment.

### §0.2 Every cardinality literal this task moves, measured on today's master, with what the two lanes ahead add

**Every one is a recount against master at rebase time, never a number copied from this table** (§10). The failing test's own message prints the truth.

| File | Literal | Today (master) | After AS-47 (tip 662eeab) and AS-49 (tip a3619a8) | AS-48 delta |
|---|---|---|---|---|
| `test/route-surface.test.js` | `ALL_ROUTES` / G1 | 21 | 23 (AS-47 per its record; AS-49 +0) | **+4**: `'GET /'` stays (replaced, not added); add `'GET /contracts/view'`, `'GET /invoices/:id'`, `'GET /invoices/view'`, `'POST /invoices/send'`, sorted (`:id` sorts before `new` and `view`) |
| same | G1b (no webhook secret) | 20 | 22 | +4 |
| same | G2 protected list / G3 | 15 | 17 | +4 (all four protected by position) |
| `test/auth.test.js` | G15 `discoverRoutes(app).length` | 21 | 23 | +4 |
| same | `PUBLIC_ROUTES` | 6 | 6 | 0 |
| `test/health.test.js` | `VIEWS.length` / `VIEWS.map(v => v.file)` | 3 | 5 | **+2** → append `'dashboard.ejs', 'invoice-detail.ejs'` in declaration order |
| `test/harness.test.js` | `EXPECTED_TEST_FILES` | 19 | 21 (AS-47 `contract-screens.test.js`, AS-49 `e2e-loop.test.js`) | **+1** `read-screens.test.js` |
| `test/dependency-policy.test.js` | app-source cardinality + list | 52 | 56 | **+5**: `lib/screens/dashboard-view.js`, `lib/screens/invoice-detail-view.js`, `lib/screens/dates.js`, `views/dashboard.ejs`, `views/invoice-detail.ejs` |
| same | `VIEW_START_TAGS` | 87 + 43 + 206 | + 58 (AS-47) | two more terms *(post-write)* — plus the nav anchor added to the three existing chrome-bearing templates (§3.6): +2 tags each |
| same | `expectFiles` on P2a/P2b/P2c/P3 / P4's file count | 4 / 3 | 6 / 5 | **8 / 7** |
| same | `'money representation'` allowlist | 8 members | 8 | **+2** (`dashboard-view.js`, `invoice-detail-view.js`, §4) |
| `test/assets.test.js` | `APP_CSS_DECLARATIONS` / `APP_CSS_VAR_REFERENCES` | 184 / 143 (AS-46) | recount (AS-47 edits `app.css`) | re-measured *(post-write)* |
| `test/contracts.test.js` | P8 `contractRoutesFound` | 1 | 2 (`GET /contracts/:id` joins) | **+1** `GET /contracts/view` |
| `test/screens.test.js` | the six `GET / → 303 /connect-stripe` cases (AS-70 §3.5) | terminus `/connect-stripe` 200 | same | rewritten in place: terminus `/` 200, `data-state="S3-EMPTY-FIRSTRUN"` (§3.1); **count unchanged** |
| `test/e2e-loop.test.js` (AS-49) | AC-2's interim landing, lines 178–185 at a3619a8 | n/a | `withCookie.location === '/connect-stripe'` | `'/'`, then a `GET /` at 200 carrying the gated note's `href="/connect-stripe"`; the loop then GETs `/connect-stripe` directly as it does today. **Count unchanged** |
| `test/invoice-screen.test.js` (AS-46) | case 20's "Location asserted, not dereferenced" comment | — | — | **not modified**; §7 case 14 is where the terminus is followed |
| `test/config.test.js` | `SCHEMA.length` | 11 | 11 | 0 |

### §0.3 Pre-write baselines for the recipes

- `grep -oiE 'amount|currency|money'` over `views/*.ejs`, `public/*.css`: **0**. Stays 0 — both templates receive their labels as locals (§4).
- `<%-` in `views/*.ejs`: 0 today, 1 after AS-47 (its sanctioned line). This task adds **none**: nothing on either screen is stored HTML.
- `@media` preludes in `app.css`: 2 `min-width` (+ AS-47's one `print`). Unchanged here.
- `routes/pages.js`: one route, `GET /` → `303 /connect-stripe`, 47 lines. Replaced whole (§3.1).
- `POST_SIGNIN_LANDING` (`lib/auth/guard.js:36`) is `'/'` and stays `'/'` — for the first time it names a screen.

## §1 Scope, and what this task is really deciding

**In scope:** `GET /` as screen 3 and `GET /invoices/:id` as screen 5, every row of `02-states-ledger.md` §3 (seven) and §5 (ten) accounted for, the three obligations handed here (the Dashboard nav entry on every chrome-bearing screen — AS-46 §3.5, AS-70's "no Dashboard control until AS-48", AS-47's "Back to Dashboard" residual; the `/invoices/:id` terminus AS-46's send lands on; `POST_SIGNIN_LANDING` finally naming a screen), and the README regions naming AS-48.

**Five decisions, and only five:**

1. **A row reaches its detail screen through a GET form with a hidden id, never an `href` (§3.3).** P2a forbids interpolation in `href=`/`action=` with no exception (dependency-policy.test.js:1063), and AS-47 decision 2 already refused an id in an `href` for a single control. A list of N rows needs N different targets; the only P2a-clean way is `<form method="get" action="/invoices/view"><input type="hidden" name="id" value="…"><button class="btn-link">View</button></form>` and a redirector `GET /invoices/view` that answers `303 /invoices/<id>` after asserting the id is UUID-shaped (a bounded `Location`, the AS-68 residual), else `404 text/plain`. Same shape for contracts (`GET /contracts/view`). Cost: one hop per click and two ~12-line routes. Not taken: a line-pinned "sanctioned href interpolation" allowlist in P2a's shape — a second mechanism for the same property, and once it exists every future id is one entry away from an `href`.
2. **`/` is the Dashboard for every signed-in freelancer, ready or not (§3.1).** The ledger's `S3-GATED-STRIPENOTREADY` "layers on top of whichever list state is active", which is only possible if an unready freelancer *reaches* the Dashboard. So AS-70's interim `GET / → 303 /connect-stripe` is deleted, not conditioned: the six screens.test.js cases that follow sign-in to `/connect-stripe` now follow it to `/` at 200, and Connect is reached from the gated note's link. The gate is a boolean the route derives from `row.ready` (read, never re-derived — AS-70 decision 1), orthogonal to the list state; `data-state` stays the list state.
3. **Status is read from the mirror and mapped through one closed table (§3.4).** Five mirror statuses (`draft|open|paid|void|uncollectible`, `STATUS_RANK` in the invoices repository) map to badge copy and tone; two of them (`void`, `uncollectible`) have no ledger row — they render inside `S5-DEFAULT-OPEN`'s layout with their own badge and are recorded for Jonah (§11 Q1). "Finalized, not yet sent" (`stripeInvoiceId` set, `sentAt` null — AS-46 §3.4's hand-off) is a variant of `S5-DEFAULT-OPEN` too, with a **Send** control, because the edit screen refuses non-drafts and without it the invoice is stuck.
4. **The detail page's send control is `POST /invoices/send` with a hidden id (§3.5)** — the same `lifecycle.send` AS-46's `intent=send` and the API's `POST /invoices/:id/send` call; the page's own URL cannot be the target because `POST /invoices/:id` is the API's. A failure lands on `303 /invoices/<id>?error=send`, a presence flag rendered as a `banner-error` layered on the DEFAULT state (data-state unchanged, like the S3 gate); the value is never read. Edit on a draft is a GET form to the page's own URL with hidden `edit=1` → `303 /invoices/<row.id>/edit` (AS-47's download shape).
5. **Money display stays on the money row (§4):** `formatDisplayMinorUnits(minor, currency)` → `'$1,200.00'` joins `lib/db/money.js` (integer arithmetic on top of `formatMinorUnits`, a symbol table beside `DEFAULT_CURRENCY`); both view models join the `'money representation'` allowlist; the templates carry the column/label copy as locals and measure zero hits.

**Not in scope, exhaustively:** our own invoice PDF (C-30, Rule 2) and our own payment page (C-34, Rule 2) — the two Stripe links are surfaced as escaped text the freelancer opens or copies (§3.4 decides how, under P2a); reminder configuration or manual re-send cadence (C-39, C-40, OUT — the Send control above is the pipeline's resume, not a reminder); analytics (C-56); account settings (C-41); screen 6 (AS-127); the contract detail screen's code (AS-47); any change to `lib/invoices/lifecycle.js`, the four API routes, `routes/webhooks.js`, `lib/db/repositories/**`; a `Retry` that is anything but a GET of the page's own URL; editing `docs/design/**`; any top-level protected markdown file.

## §2 File-level scope

Nothing outside this list is touched. A diff that changes a file not named here is a finding.

**Created**

| Path | What |
|---|---|
| `apps/invoicing/views/dashboard.ejs` | Screen 3: three rendered states, the gated overlay, full chrome |
| `apps/invoicing/views/invoice-detail.ejs` | Screen 5: five rendered states, the `sendFailed` overlay, full chrome |
| `apps/invoicing/lib/screens/dashboard-view.js` | `DASHBOARD_LEDGER`, `DASHBOARD_STATES`, `dashboardLocals(input)` — pure |
| `apps/invoicing/lib/screens/invoice-detail-view.js` | `INVOICE_DETAIL_LEDGER`, `INVOICE_DETAIL_STATES`, `STATUS_BADGES`, `invoiceDetailLocals(input)` — pure |
| `apps/invoicing/lib/screens/dates.js` | `formatDate(iso)` → `'Aug 28, 2026'` (UTC, `Intl.DateTimeFormat('en-US')`, throws on a non-ISO string) — shared by both view models, ~15 lines |
| `apps/invoicing/test/read-screens.test.js` | Both screens' cases (§7) — NEW file, never an addition to `screens.test.js`, `invoice-screen.test.js` or `auth.test.js` |

**Modified**

| Path | Change |
|---|---|
| `apps/invoicing/routes/pages.js` | Rewritten: `pageRoutes(config, { repos })`; `GET /` renders the Dashboard. Header rewritten to say the interim redirect is discharged. |
| `apps/invoicing/app.js` | Mount line 9 becomes `pageRoutes(config, { repos })` and its comment. **No mount added, no order changed.** |
| `apps/invoicing/routes/invoices.js` | `GET /invoices/view`, `POST /invoices/send`, `GET /invoices/:id` — **registered after `/invoices/new` and before the `:id` API routes**, comment saying why. No handler code in the API half changes. |
| `apps/invoicing/routes/contracts.js` | `GET /contracts/view` redirector, registered before `GET /contracts/:id` (AS-47's). |
| `apps/invoicing/lib/db/money.js` | `formatDisplayMinorUnits(minor, currency)` and `CURRENCY_SYMBOLS` (§4). |
| `apps/invoicing/lib/views.js` | Two rows appended: `dashboard` (`dashboardLocals()`), `invoice-detail` (`invoiceDetailLocals()`). |
| `apps/invoicing/views/invoice-form.ejs`, `views/contract-form.ejs`*, `views/contract-detail.ejs`* | **One anchor each:** `<a class="site-nav__link" href="/">Dashboard</a>` first in the nav. (*after AS-47 merges; `contract-form.ejs` only if AS-47 kept it — it went to AS-127, so probably `contract-detail.ejs` alone; recount at rebase.) |
| `apps/invoicing/public/app.css` | `table`, `.table-wrap`, `th`, `td`, `.badge`, `.badge-success/-accent/-neutral/-warning`, `.banner-success`, `.site-nav__item--disabled`, `.site-nav__note`, `.link-list` — all `var(--token)`, from `wireframe.css`'s rules for the same names; nothing re-declared. |
| `apps/invoicing/test/screens.test.js` | The six AS-70 §3.5 cases: terminus `/` (§0.2). Nothing else. |
| `apps/invoicing/test/e2e-loop.test.js` | AC-2's landing (§0.2) — after AS-49 merges. |
| `apps/invoicing/test/route-surface.test.js`, `auth.test.js`, `health.test.js`, `harness.test.js`, `dependency-policy.test.js`, `assets.test.js`, `contracts.test.js` | The literals in §0.2 only. |
| `apps/invoicing/README.md` | § Issuing an invoice (the detail screen, the two links, Send-from-detail), § The view layer (the redirector convention: "an id never sits in a URL attribute; a row targets a constant action with a hidden id"), § Obligations (AS-48's bullets removed; AS-127 handed the Dashboard nav entry for screen 6), § Layout. |

**Explicitly not modified:** `lib/invoices/**`, `lib/stripe/**`, `lib/auth/**` (`POST_SIGNIN_LANDING` stays `'/'` untouched), `lib/db/repositories/**`, `lib/db/migrations/**`, `routes/webhooks.js`, `routes/auth.js`, `routes/connect.js`, `routes/clients.js`, `lib/screens/invoice-form-view.js`, `lib/screens/connect-view.js`, `lib/screens/signin-view.js`, `lib/screens/contract-*-view.js`, `views/signin.ejs`, `views/connect-stripe.ejs`, `test/invoices.test.js`, `test/invoice-screen.test.js`, `test/connect.test.js`, `test/clients.test.js`, `test/webhooks.test.js`, `test/contract-screens.test.js` (except nothing), `Dockerfile`, `compose.yaml`, `package*.json`, `demo/**`, `docs/**`, every top-level repo markdown file.

## §3 Design

### §3.1 `GET /` — the Dashboard replaces the interim redirect (decision 2)

`routes/pages.js` keeps its one route and its stated purpose ("routes belonging to no capability" — the Dashboard reads two capabilities and belongs to neither, which is why it is not in `invoiceRoutes` or `contractRoutes`). The handler reads three things and hands them to the view model: `repos.connectedAccounts.getByFreelancer(id)` (reads `row.ready` only), `repos.invoices.listByFreelancer(id)`, `repos.contracts.listByFreelancer(id)`, plus `repos.clients.listByFreelancer(id)` for the name join. **No Stripe call.** Any thrown error that is not a refusal the view model maps → `S3-ERROR-SYSTEM` at **500** (the retry is a `<form method="get">` with no `action`).

`dashboardLocals({ account, invoices, contracts, clients, failure })`, pure, total:

| # | Condition | State | Status |
|---|---|---|---|
| 1 | `failure === 'system'` | `S3-ERROR-SYSTEM` | 500 |
| 2 | zero invoices and zero contracts | `S3-EMPTY-FIRSTRUN` | 200 |
| 3 | otherwise | `S3-DEFAULT-POPULATED` | 200 |

`stripeReady = account !== null && account.ready === true` is an orthogonal boolean: when false, the nav's "New invoice" renders as `<span class="site-nav__item--disabled">New invoice <span class="site-nav__note">Connect Stripe before invoicing — <a href="/connect-stripe">finish setup</a></span></span>` instead of an anchor, and the first-run copy's first sentence branches (`stripeReady` → "You're connected to Stripe."; else "Connect Stripe when you're ready to invoice." — a recorded deviation, §11 Q2). `S3-GATED-STRIPENOTREADY`'s disposition is `'layered — rendered inside S3-DEFAULT-POPULATED and S3-EMPTY-FIRSTRUN by the stripeReady boolean'`; case 4 renders it inside both.

**Rows:** invoices newest-first as the repository returns them: client name (joined from the clients list by `clientId`; no match → the constant "Unknown client", a branch case 3 exercises), total (`formatDisplayMinorUnits(totalMinor, currency)`), status badge (§3.4's table — the same `STATUS_BADGES` object, imported from `invoice-detail-view.js`, so the list and the detail cannot disagree), and the View form (§3.3). Contracts: client name, `formatDate(createdAt)`, View form. The wireframe's draft row says "Edit" and targets screen 4; built as "View" targeting screen 5 for every row — screen 5's draft state carries Edit, and one control per row keeps the P2a shape to one redirector. Deviation recorded (§11 Q3).

**The six screens.test.js cases** (AS-70 §3.5: three entry points × two assertions) change their terminus from `/connect-stripe` to `/` and assert `data-state="S3-EMPTY-FIRSTRUN"` plus the gated note (a fresh sign-up has no account row). Hop count stays 1. The `hostile` open-redirect case at :362 is unchanged.

### §3.2 `GET /invoices/:id` — screen 5

`invoiceDetailLocals({ invoice, client, account, failure, sendFailed })`, pure, total, precedence stated:

| # | Condition | State | Status |
|---|---|---|---|
| 1 | `failure === 'not-found'` | `S5-ERROR-NOTFOUND` | 404 |
| 2 | `failure === 'system'` | `S5-ERROR-SYSTEM` | 500 |
| 3 | `invoice.status === 'paid'` | `S5-DEFAULT-PAID` | 200 |
| 4 | `invoice.stripeInvoiceId !== null` (finalizing, open, void, uncollectible) | `S5-DEFAULT-OPEN` | 200 |
| 5 | otherwise (`status === 'draft'`, nothing attached) | `S5-DEFAULT-DRAFT` | 200 |

The route: `repos.invoices.getById(freelancerId, id)` — `NotFoundError` → `'not-found'` (missing and not-owned are the same error by the repository's design, so `S5-DENIED-NOTOWNER` is byte-identical to NOTFOUND by construction, case 20); any other error → `'system'`. Client via `repos.clients.getById`; a `NotFoundError` there is a system failure (a draft cannot reference a foreign client — the composite FK). Account row read for `ready` only. `sendFailed = req.query.error === 'send'`… **no**: `sendFailed = 'error' in req.query` — a presence flag exactly like S2's `?error=start` and S4's `?error=send`; the value never enters the view model (case 17 drives a marker and asserts zero occurrences). `?edit=1` (presence, `req.query.edit === '1'`) on a draft → `303 /invoices/<invoice.id>/edit` — the row's id; on a non-draft the flag is ignored and the page renders.

**Locals:** `state`, `title` ("Invoice to <client name>"), `badge` (`{ label, tone }` from `STATUS_BADGES`), `totalText` (`'$80.00'`), `totalLabel` (`'Amount'` — built in the view model so the template carries no money word), `dueText` (draft: "Due in N days once sent" from `daysUntilDue`; open: "Due <formatDate(dueAt)>" when `dueAt` is set, else absent; paid: absent), `paidText` ("paid in full on <formatDate(paidAt)>" for PAID; `paidAt` null → "paid in full"), `hostedInvoiceUrl` / `invoicePdfUrl` (strings or null — §3.4 for how they render), `canEdit` (DRAFT only), `canSend` (DRAFT, or OPEN with `sentAt === null` — and only when `stripeReady`), `sendLabel` ("Finalize & send" / "Send"), `stripeReady`, `sendFailed`, `voidNote`/`uncollectibleNote` are not locals — the badge carries those.

### §3.3 Rows reach detail screens through a redirector (decision 1)

`GET /invoices/view` and `GET /contracts/view`, each: read `req.query.id`; if it is a string matching `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/` answer `303 /invoices/<id>` (resp. `/contracts/<id>`), else `404 text/plain` one line in the router's `fail` shape. No repository read: ownership is the detail route's job, and the redirector must not become a second place that knows who owns what. The regex is one constant, `UUID_SHAPE`, defined once in `lib/screens/dashboard-view.js` (the module that emits the hidden ids) and imported by both routers, so the emitting side and the accepting side share one definition (the view model asserts every id it renders matches it — case 5). Not in `lib/db/database.js` beside `randomUUID()`: that file is out of scope, and the property being guarded is the *shape a redirect accepts*, which belongs to the screen layer.

Registration order: `/invoices/view` sits after `/invoices/new` and before `GET /invoices/:id` (the literal-before-parameter rule, AS-46 §3.1.2); `/contracts/view` before `GET /contracts/:id`. Falsified by F9 (register it after: `view` is captured by `:id`, the detail route 404s HTML instead of 303ing).

### §3.4 Status, the two hosted links, and what "surfaced, not rebuilt" means in markup

`STATUS_BADGES` (frozen, in `invoice-detail-view.js`): `draft → { label: 'Draft', tone: 'neutral' }`, `open → { 'Sent — awaiting payment', 'accent' }`, `paid → { 'Paid', 'success' }`, `void → { 'Voided', 'neutral' }`, `uncollectible → { 'Marked uncollectible', 'warning' }`; an `open` row with `sentAt === null` gets `{ 'Finalized — not yet sent', 'accent' }`. Any other status string throws (the mirror's state machine admits five; a sixth is a bug, not a state). The template branches on `badge.tone` with **constant class names per branch** (`badge badge-success` etc.), never `badge-<%= tone %>`.

**The two Stripe links.** `hosted_invoice_url` and `invoice_pdf` are URLs Stripe returned and the webhook stored; the ledger asks for "labeled outbound links". `<a href="<%= url %>">` is exactly what P2a forbids — and here the stored value is external data, so this is the case P2a exists for, not a technicality. Two designs were considered. *A GET form to a redirector* (`/invoices/open?id=…&link=hosted` → 303 to the stored URL) keeps P2a clean but makes the app redirect to an externally supplied URL — an open-redirect surface, and a third redirector route. **Rejected.** **Decision:** the URL is rendered **in element content**, escaped, inside a `<code class="link-text">` with the label beside it, and the freelancer copies or clicks it as their browser allows (most browsers linkify nothing; the description says "open **or copy**"). Then `hostedInvoiceUrl`/`invoicePdfUrl` are ordinary escaped text and P2a is untouched. The cost is a real one — a URL the freelancer must copy rather than click — and it is recorded as the price of the no-`href`-interpolation rule (§11 Q4, with the trigger: the AS-50 acceptance run or the board finding copy-to-open inadequate in writing → the follow-up is a **validated-origin** anchor: the view model admits an `href` only when `new URL(value).origin` is in a frozen allowlist of Stripe origins, plus a line-pinned P2a sanction; that is a second mechanism and gets its own record). **The links render only when the value is non-null**, so DRAFT shows the wireframe's "No Stripe links yet — none exist until this invoice is finalized." and OPEN/PAID show whichever of the two the mirror holds (a `sentAt` row with null links is possible mid-sync and renders the same sentence).

### §3.5 Send from the detail page (decision 4)

`POST /invoices/send` (body: `id`) — the router's existing `form` parser; reads `id`, asserts `UUID_SHAPE` (else 404 text/plain), calls `lifecycle.send(freelancerId, id)` exactly as the API's `POST /invoices/:id/send` does at routes/invoices.js:377, then: success → `303 /invoices/<id>`; `NotFoundError` → 404 text/plain (the API's shape; an unowned id must not learn anything from the screen either); `AccountNotReadyError`, `StripeApiError`, `StripeTransportError`, `ConfigError`, `InvalidStateError`, `TypeError`, `StripeCustodyError`, `AmountMismatchError`, anything else → `303 /invoices/<id>?error=send`. The mapping is smaller than AS-46's because there is no draft to preserve: the row *is* the state, and the detail GET renders it. `lifecycle.send` is the resumable pipeline (AS-43), so a second click after a partial failure resumes rather than duplicates — case 16 sends twice through a transport that fails once. The control renders only when `canSend` (§3.2); an unready account shows the sentence "Connect Stripe before sending — finish setup." with the one `/connect-stripe` anchor instead (a constant `href`).

### §3.6 Chrome, stylesheet, templates

**Nav** (01-screens §3): constant markup, **Dashboard** (`href="/"`), **New invoice** (`/invoices/new`) or its gated span, **New contract** (`/contracts/new` — **only if that route exists at merge**; it is AS-127's, so at this task's merge the entry is **absent** and README § Obligations hands it to AS-127 — a nav link to a 404 is R-2's defect), **Sign out** form. The one Dashboard anchor is added to `invoice-form.ejs` and `contract-detail.ejs` (§2) — the obligation AS-46/AS-47 recorded — and their `VIEW_START_TAGS` terms move by +2 each (recount). The gated span renders on screen 3 only; screens 4/5/7 keep the plain anchor (screen 4's own gate refuses at the route; a disabled entry there would be a second implementation of one rule).

**Copy** is the wireframe's verbatim where it supplies it: "Your work", "Contracts", "Invoices", "Client", "Created", "Status", "View", "Let's get your first client paid", "Create your first contract" (**absent until AS-127** — the primary CTA cannot point at a 404, so first-run renders the invoice CTA alone at merge and README hands the contract CTA to AS-127; §11 Q5), "Or create an invoice directly" (rendered as the primary while alone, labelled "Create your first invoice"), "Couldn't load your work", "Something went wrong loading your contracts and invoices.", "Retry", "Connect Stripe before invoicing — finish setup"; screen 5: "Invoice to …", "Due in N days once sent", "No Stripe links yet — none exist until this invoice is finalized.", "View hosted invoice page (Stripe)", "Download invoice PDF (Stripe)", "paid in full on …", "Invoice not found", "We couldn't find that invoice.", "Back to Dashboard" (`href="/"`, constant — now it exists), "Couldn't load this invoice", "Something went wrong loading this invoice.", "Retry", "Edit", "Finalize & send". Apostrophes in element content only.

**Template shape rules (binding):** every state owns a distinctive marker that occurs once in the template source (S3-DEFAULT-POPULATED: the `<table>` for invoices; S3-EMPTY-FIRSTRUN: "Let's get your first client paid"; S3-ERROR-SYSTEM: its banner sentence; S5-DEFAULT-DRAFT: the "No Stripe links yet" sentence; S5-DEFAULT-OPEN: the `badge-accent` branch; S5-DEFAULT-PAID: `banner-success`; S5-ERROR-NOTFOUND: its banner sentence; S5-ERROR-SYSTEM: the retry form); interpolations only in element content or double-quoted `value=`; no `<%-`; no `href`/`action` interpolation (P2a keeps its zero); ids appear only as hidden `value=` inputs.

**`app.css`:** the rules in §2, all `var(--token)`, mobile-first; `.table-wrap { overflow-x: auto }` is what keeps a four-column table inside 375px (the place to look hardest in §5); no `max-width` condition, no fixed box.

### §3.7 The ledger partitions — arithmetic against committed tables

**Screen 3, seven rows:** `S3-DEFAULT-POPULATED`, `S3-EMPTY-FIRSTRUN`, `S3-ERROR-SYSTEM` rendered (3); `S3-GATED-STRIPENOTREADY` layered (1); `S3-DENIED-SIGNEDOUT` redirect-answered (1); `S3-LOADING` unrenderable — browser-supplied (1); `S3-ABANDON` n/a (1). **3 + 1 + 1 + 1 + 1 = 7.**

**Screen 5, ten rows:** `S5-DEFAULT-DRAFT`, `S5-DEFAULT-OPEN`, `S5-DEFAULT-PAID`, `S5-ERROR-NOTFOUND`, `S5-ERROR-SYSTEM` rendered (5); `S5-DENIED-NOTOWNER` rendered-as-NOTFOUND (1); `S5-DENIED-SIGNEDOUT` redirect-answered (1); `S5-LOADING` unrenderable (1); `S5-EMPTY`, `S5-ABANDON` n/a (2). **5 + 1 + 1 + 1 + 2 = 10.** The `sendFailed` overlay and the void/uncollectible/unsent badges are not rows: every render stamps one of the five.

Both transcriptions compared to the test file's own by set equality on `(id, disposition)`, cardinality first (R-4); the join to the document is the reviewer's dated act.

### §3.8 Reachability

**1 — Offline suite:** every rendered state, both redirects, the overlays, the redirectors, the send path (canned transport through `withServer`'s third argument, the `invoice-screen.test.js` case 20 shape), and the two system states by fault injection on the test's private database (AS-47 §3.8's instrument): `S3-ERROR-SYSTEM` by dropping `contracts` after sign-in; `S5-ERROR-SYSTEM` by dropping `invoice_line_items` after the invoice exists (the `SELECT`'s total subquery then fails with something that is not a `NotFoundError`). **2 — stripe-mock:** nothing; the `contract` service must still pass (AC 26). **3 — named, not exercisable here:** `S3-LOADING`, `S5-LOADING`; pixels at 375px (§5); the hosted flow (AS-49/50).

## §4 Money on the read screens

The `'money representation'` row (dependency-policy.test.js:951) confines `/amount|currency|money/i` to files that handle minor units. Both view models read `totalMinor`, `amountPaidMinor`, `currency` and call `formatDisplayMinorUnits` — they *are* the human boundary for display, exactly as `invoice-form-view.js` is for input (AS-46 §4.3), so both join the allowlist (8 → 10) with a one-sentence reason each. `formatDisplayMinorUnits(minor, currency = DEFAULT_CURRENCY)` in `money.js`: `assertSupportedCurrency`, `formatMinorUnits(minor)` → `'1200.00'`, group the integer part by thousands with a regex on the digit string, prefix `CURRENCY_SYMBOLS[currency]` (`{ usd: '$' }`, frozen, beside `DEFAULT_CURRENCY`). No float, no `toLocaleString` (its output is locale-dependent and untestable as a constant). Templates and stylesheet stay at zero hits: the column header and the detail label arrive as `totalLabel` locals (the AS-46 `priceLabel` device). `routes/pages.js` and the new route code spell none of the three words (the routes pass rows through; their comments are written to avoid the words — the scan reads comments).

## §5 Responsive at 375px — the eyes half

Mechanical half inherited (`screens.test.js`'s shared cases bind every `VIEWS` row). Inspection: the implementer serves the screens in an isolated project (`docker compose -p asc-as48-visual -f apps/invoicing/compose.yaml run --build --rm --no-deps -d -p 127.0.0.1:8360:8348 web` — 8359 is AS-47's), signs up, and looks at **every rendered state of both screens at a measured 375px** (eight renders: three on screen 3 plus the gated overlay on both list states, five on screen 5 — the send-failed overlay and a PAID row via a synthesized webhook or a direct `applyStripeSnapshot` through the repository in a seed script). **Recipe:** `scratchpad/agent-developer-marcus/AS-47/visual.mjs` is a working headless-Chrome/CDP capture with `Emulation.setDeviceMetricsOverride` at 375 — reuse it, changing only the URLs and the seed. Record in a Lattice comment: viewport measured, each state looked at and not looked at, any overflow or bad wrap (the four-column invoice table and the long `hosted_invoice_url` text in `<code>` are the two places to look hardest — a URL with no break opportunity must not widen the page: `overflow-wrap: anywhere` on `.link-text`), scheme looked at. Tear down with `down -v --rmi local` and report the leak check.

## §6 Size, complexity, and the pre-agreed split line

Projected against §2, honestly (the description's "around 450" is stale by roughly 4×, as AS-45/46/47's were):

| Area | Lines |
|---|---|
| `views/dashboard.ejs` | ~120 |
| `views/invoice-detail.ejs` | ~110 |
| `lib/screens/dashboard-view.js` | ~160 |
| `lib/screens/invoice-detail-view.js` | ~200 |
| `lib/screens/dates.js` | ~20 |
| `routes/pages.js` (rewrite) + `routes/invoices.js` (+3 routes) + `routes/contracts.js` (+1) | ~150 |
| `lib/db/money.js` | ~25 |
| `public/app.css` | ~80 |
| `test/read-screens.test.js` | ~800 |
| literal edits across seven test files + the six screens.test.js rewrites + e2e AC-2 | ~60 |
| `README.md` | ~60 |
| **Total** | **≈ 1,800** |

Complexity **medium**: no new dependency, no new external call, no concurrency; but two screens, five routes and a 27-case file.

**The seam, decided now — Unit A is "see it", Unit B is "act on it":**
- **Unit A:** both screens, every ledger row, the redirectors, the gated overlay, the two hosted-link renders, `?edit=1`, the nav obligations. The DRAFT state renders Edit only.
- **Unit B:** `POST /invoices/send`, `canSend`/`sendLabel`, the `sendFailed` overlay, the unsent-open variant's Send control, §7 cases 15–17, recipe F6.

> **Split trigger:** when Unit A is complete and green under `--build`, measure `git diff --stat master...HEAD`. **If it exceeds 1,500 changed lines, stop:** commit, move AS-48 to `review` for Unit A's scope, file `AS-48b: D1 v1 UI: invoice detail — send/finalize from the detail screen` carrying §3.5, §3.2's `canSend`/`sendLabel`/`sendFailed` rows and §7 cases 15–17 verbatim, `depends_on` AS-48. Unit A's DRAFT state then carries the sentence "Finalize and send from the edit screen." beside Edit (true: the edit screen's `intent=send` exists). Unit A's unsent-open variant cannot say that — the edit screen refuses non-drafts — so it says "Not yet sent — sending from this page arrives with AS-48b": an honest hole, named in the README obligations, not a control pointing at nothing. At or under 1,500: land both. Do not split anywhere else.

**Order of work:** (1) `money.js` + `dates.js` + unit tests; (2) both view models + ledger/partition cases; (3) `pages.js`, the six screens.test.js rewrites, the Dashboard template, route literals; (4) `invoices.js`/`contracts.js` redirectors + detail route + template; (5) **measure, decide**; (6) Unit B; (7) nav obligations, README; (8) recipes §8; (9) rebase on master (AS-47, AS-49 in), recount every §0.2 literal, amend e2e AC-2, re-run under `--build`, then `review`.

## §7 Acceptance criteria and the executable cases they name

VERIFICATION clause, verbatim: *"states ledger exercised — no invoices yet, loading, populated, stale/unsynced, error; status transitions render correctly from fixture mirror records; renders at 375px before desktop; tokens only, no magic values."* "Stale/unsynced" is `S5-DEFAULT-OPEN` rendered from a mirror row the webhook has not yet updated — the ledger's own note; case 9 is that row.

Cases below carry exactly these titles in `test/read-screens.test.js` unless another file is named.

1. *'screen 3 accounts for all seven of its ledger rows: 3 + 1 + 1 + 1 + 1 = 7'* — set equality on `(id, disposition)`, cardinality first, `DASHBOARD_STATES` exactly 3, both frozen. **F11a.**
2. *'screen 5 accounts for all ten of its ledger rows: 5 + 1 + 1 + 1 + 2 = 10'* — as above, `INVOICE_DETAIL_STATES` exactly 5. **F11b.**
3. *'the view models reach every rendered state, exhaustively, with no HTTP at all'* — three + five states from pure inputs; `STATUS_BADGES` has exactly five keys plus the unsent variant; a sixth status throws; a missing client name renders "Unknown client".
4. *'S3-GATED-STRIPENOTREADY layers on both list states: New invoice is a span with the finish-setup link, not an anchor'* — no account row, and `ready === false`, each on empty and populated; `occurrences(html, 'href="/invoices/new"') === 0` and the `/connect-stripe` anchor exactly once; a ready account: the anchor once and the note zero times. **F5.**
5. *'every id the dashboard emits is a hidden value= input matching UUID_SHAPE, and no id appears in any href or action'* — populated render with two invoices and one contract: exactly three `name="id"` hidden inputs, each matching the regex; `occurrences(html, invoiceId)` equals 1 per id; the regex `/(href|action)="[^"]*<uuid>/` matches zero times. **F1.**
6. *'S3-DEFAULT-POPULATED: rows show client, formatted total, status badge and a View form; contracts show client and created date'* — `$1,200.00` and `$80.00` exactly once each; `badge-success` and `badge-neutral` once each; `formatDate` output `Aug 28, 2026` for a seeded `created_at`.
7. *'S3-EMPTY-FIRSTRUN: zero records render the first-run copy with the invoice CTA and no table'* — `occurrences(html, '<table') === 0`; the copy branch on `stripeReady` both ways.
8. *'S3-ERROR-SYSTEM: a dropped contracts table renders the error banner at 500 with a retry form to the page's own URL'* — fault injection; `<form method="get">` with no `action` attribute exactly once. **F4a.**
9. *'S5-DEFAULT-OPEN renders from a mirror row the webhook has not updated: status Sent, both hosted links as escaped text, due date formatted'* — seed via `attachStripeInvoice` + `applyStripeSnapshot({ status: 'open', hostedInvoiceUrl, invoicePdfUrl, dueAt, sentAt })`; the two URLs appear once each **in element content**, zero times inside any `href=`; "Due Sep 15, 2026". **F2, F3.**
10. *'S5-DEFAULT-PAID: a paid snapshot renders the success banner, the paid date, and offers no action'* — `banner-success` once; "paid in full on Aug 30, 2026"; zero `<form method="post">` in `<main>`; the sign-out form is the only POST form on the page.
11. *'S5-DEFAULT-DRAFT: a draft shows Due in N days once sent, no Stripe links, and the Edit form'* — the "No Stripe links yet" sentence once; `name="edit"` hidden input once.
12. *'?edit=1 on a draft redirects to the edit page; on a non-draft the flag is ignored and the page renders'* — 303 `/invoices/<id>/edit` then followed to 200 `S4-DEFAULT-EDIT`; on an open row: 200 `S5-DEFAULT-OPEN`.
13. *'void, uncollectible and finalized-but-unsent rows render inside S5-DEFAULT-OPEN with their own badge'* — three snapshots; `data-state="S5-DEFAULT-OPEN"` each; labels "Voided", "Marked uncollectible", "Finalized — not yet sent" once each.
14. *'AS-46's send lands on a page that exists: intent=send from the edit screen is followed to 200 S5-DEFAULT-OPEN'* — the canned five-call transport from invoice-screen.test.js case 20; `followToTerminus` → hops 1, status 200, sentinel. **This is the residual AS-46 §8 named, closed.**
15. *'POST /invoices/send from the detail page runs the pipeline and lands on the detail page; the control renders only when the account is ready'* — `sentAt !== null` after; unready account → zero `action="/invoices/send"`, the finish-setup sentence once. **F6.**
16. *'a send that fails at Stripe lands on ?error=send with the banner layered on the unchanged state, and a second send resumes'* — transport failing once on `/v1/customers`; 303 `/invoices/<id>?error=send`; follow → 200, `data-state` unchanged, `banner-error` once; then `GET /invoices/<id>?error=ASC48MARK` → banner once, `occurrences(html, 'ASC48MARK') === 0`; second POST succeeds.
17. *'POST /invoices/send with a malformed or foreign id is 404 text/plain and calls Stripe zero times'* — transport call counter asserted 0.
18. *'GET /invoices/view and GET /contracts/view redirect a UUID-shaped id and refuse everything else with a bounded response'* — `?id=<uuid>` → 303 with `Location` exactly `/invoices/<uuid>`; `?id=../x`, `?id[]=a`, no id, a 2,000-char id → 404 text/plain, `Location` header absent. **F8.**
19. *'GET /invoices/view is served by the redirector, never by the :id route'* — `?id=<uuid>` answers 303, not HTML 404. **F9.**
20. *'S5-DENIED-NOTOWNER is byte-identical to S5-ERROR-NOTFOUND'* — two freelancers; the second's GET of the first's invoice equals a GET of a random UUID, byte for byte, both 404.
21. *'S5-ERROR-SYSTEM: a dropped invoice_line_items table renders the error banner at 500 with a retry form'* — fault injection. **F4b.**
22. *'S3-DENIED-SIGNEDOUT and S5-DENIED-SIGNEDOUT: cookieless GETs 303 to /signin with next; the redirectors and POST /invoices/send too'* — five routes; GETs carry `next`, the POST does not, no `Set-Cookie`.
23. *'the three entry points land on the Dashboard: sign-up, sign-in and a signed-in GET /signin each reach / at 200'* — **in `test/screens.test.js`**, the six AS-70 cases rewritten; `data-state="S3-EMPTY-FIRSTRUN"`, the gated note present (no account row).
24. *'every href and form action in every template names a route the app registers or a file public/ serves'* — the AS-46 case 25 walker, run over the two new templates and the amended nav (it lives in `invoice-screen.test.js`; this case imports and re-runs it or duplicates its 20 lines — implementer's call, named in the comment); **red if `/contracts/new` is linked before AS-127 lands.** **F7.**
25. *'formatDisplayMinorUnits groups thousands, keeps two minor digits, and refuses what assertMinorUnits refuses; formatDate is UTC and refuses non-ISO input'* — vector table, cardinality first (≥ 12 vectors: `0 → $0.00`, `5 → $0.05`, `120000 → $1,200.00`, `123456789 → $1,234,567.89`, `-1` throws, `1.5` throws, `'eur'` throws; dates: `2026-08-28T00:00:00Z`, `2026-12-31T23:59:59Z`, `'nope'` throws). **F10.**
26. Route-surface G1/G1b/G2/G3 + G15, `harness` 22, `health` 7, `dependency-policy` source 61, money row 10 members all used, `expectFiles` 8/7, `VIEW_START_TAGS` re-measured, zero money words in `views/` + `public/` (**F3a**), `contracts.test.js` P8 2 → 3, `APP_CSS_*` re-measured — all recounted at rebase. Full offline suite green under `--build`; `contract` service green with no case added; `ASC_SELFTEST_MUTATE=1` exits 1.
27. *(`test/e2e-loop.test.js`, after AS-49 merges)* AC-2's landing is `/`, followed to 200 with the `/connect-stripe` anchor present; count unchanged.
28. A Lattice comment records the §5 inspection and every §8 recipe's assert-applied count and observed red set; `README.md` per §2; no `AS-48` obligation marker remains except the AS-127 hand-offs.

**M4, applied:** every stated property names its falsifier in §8, satisfied only by an observed red.

## §8 Falsification recipes

Rules (AS-45 §7, AS-95 sharpening): mutate a `git archive HEAD` extract outside the worktree; assert the mutation applied on disk and in the built image with an occurrence-accurate count anchored to the intended site; record predicted vs observed red sets; prove restoration with `git diff --exit-code`; rebuild and re-run. Isolated `-p` project every time. Predicted red sets name §7 titles.

| Recipe | Mutation (anchored) | Predicted red |
|---|---|---|
| **F1** | in `dashboard.ejs`, change the invoice row's `<form method="get" action="/invoices/view">` to `<a href="/invoices/<%= row.id %>">` (assert `grep -c 'href="/invoices/<%' views/dashboard.ejs` = 1) | case 5; dependency-policy P2a (`interpolation in a URL or style attribute`, 1 hit); case 24 |
| **F2** | in `invoice-detail.ejs`, render `hostedInvoiceUrl` as `<a href="<%= hostedInvoiceUrl %>">` | case 9; P2a |
| **F3** | in `invoice-detail-view.js`, drop the `hostedInvoiceUrl` local (return `null` always) | case 9 (once in content → zero) |
| **F3a** | put the literal `Amount` in `invoice-detail.ejs` instead of `<%= totalLabel %>` | dependency-policy money row (1 hit in views/) |
| **F4a/b** | in `pages.js` / the detail route, swallow the repository error and render the list state | cases 8 / 21 |
| **F5** | in `dashboard-view.js`, `stripeReady = true` unconditionally | case 4 (both halves); case 7's branch; case 23's gated-note assertion |
| **F6** | in `POST /invoices/send`, skip the `stripeReady`/`canSend` guard in the view model (`canSend = true`) | case 15's unready half |
| **F7** | add `<a href="/contracts/new">New contract</a>` to `dashboard.ejs` before AS-127 | case 24 |
| **F8** | in the redirector, drop the `UUID_SHAPE` test (redirect any string) | case 18 (four refusals become 303s); the 2,000-char case's `Location` bound |
| **F9** | register `GET /invoices/view` after `GET /invoices/:id` | case 19; case 18's 303s become HTML 404s |
| **F10** | in `formatDisplayMinorUnits`, group with `toLocaleString` — assert applied; then `MINOR_DIGITS` 2 → 3 | case 25 (the vector table) |
| **F11a/b** | remove one row from each `*_LEDGER` (assert length 6 / 9 in the image) | cases 1 / 2 (cardinality before the sum) |
| **F12** | make `S5-DENIED-NOTOWNER` render a different sentence for a not-owned id (branch on a repository probe) | case 20 (byte equality) |
| **F13** | in `invoice-detail-view.js`, map `paid` before checking `failure` (reorder rows 1–3) | cases 20/21 (a paid row with `failure` set renders PAID) — the precedence falsifier |

Fourteen recipes; every one predicts a named red set. A survivor is a lead (AS-95 sharpening): re-read the mutated file's diff before concluding the guard is weak.

## §9 What this task hands forward

- **AS-127 (screen 6):** the "New contract" nav entry on screens 3/4/5/7 and the first-run "Create your first contract" primary CTA on screen 3 — both absent until `/contracts/new` exists; README § Obligations names them with the exact markup.
- **AS-50 / AS-49:** the copy-to-open cost of the hosted links (§3.4, Q4) is the thing to watch in the recorded run.
- **Jonah:** §11's five deviations.

## §10 Merge order and seams

**AS-47 → AS-49 → AS-48.** AS-47 (in review, Ruben) is ahead; AS-49 (Lena, mutation battery next tick) is ahead. This branch starts from today's master and **rebases twice**; at each rebase the implementer recounts every §0.2 literal from the failing tests' messages, never from this table.

- **AS-47 seam:** `routes/contracts.js` (the `GET /contracts/view` registration sits *before* AS-47's `GET /contracts/:id` — a textual conflict, resolved by keeping both with `view` first), `views/contract-detail.ejs` nav (the Dashboard anchor), route-surface literals, `VIEWS`, `harness`, `dependency-policy` source list and `VIEW_START_TAGS`, `APP_CSS_*`, `contracts.test.js` P8. If AS-47 is sent back and AS-48 reaches review first, the order flips and AS-47 recounts — say so on both tasks.
- **AS-49 seam:** `test/e2e-loop.test.js` AC-2 (§0.2) — AS-48 amends it at rebase; `harness` +1 and the `+1 helper` count. AS-49's double is a transport; it never sees `GET /`, so nothing else moves.
- **AS-46 (merged):** case 14 closes its named residual; `invoice-screen.test.js` is not edited.
- **AS-70 (merged):** the six screens.test.js cases are rewritten in place, and AS-70's own hand-off ("S2-RETURN-READY ships with no Dashboard control until AS-48") is discharged here: `views/connect-stripe.ejs`'s READY state gains `<a class="btn btn-primary" href="/">Continue to Dashboard</a>` (constant `href`), its `VIEW_START_TAGS` term moves +1, and `screens.test.js`'s S2-RETURN-READY case gains one assertion (the control present, once). **`views/connect-stripe.ejs` is therefore in §2 Modified** (one anchor, nothing else), and §2's "explicitly not modified" list is read with that exception. Recipe F7 covers it: a control pointing at an unserved route is R-2's defect, and `/` is now served.

## §11 Questions for Jonah (deviations recorded, not applied)

1. `void` and `uncollectible` have no ledger row; rendered inside `S5-DEFAULT-OPEN` with their own badge. Proposed: two rows `S5-DEFAULT-VOID`, `S5-DEFAULT-UNCOLLECTIBLE`, or a written ruling that OPEN covers "finalized, not paid".
2. First-run copy branches on readiness ("You're connected to Stripe." is false for an unready freelancer who now reaches the Dashboard).
3. Draft rows on the Dashboard say "View" (→ screen 5), not "Edit" (→ screen 4).
4. The hosted links render as copyable text, not anchors (P2a); trigger and the validated-origin follow-up in §3.4.
5. "Create your first contract" is absent until AS-127; the invoice CTA is primary meanwhile.

## §12 Staffing

**Implementer: Marcus** — free once AS-47's review is Ruben's; he wrote the 375px CDP recipe this plan points at and the AS-47 nav/literal seams this task rebases across. **Reviewer: Priya** — pencilled for AS-49, whose review comes first; AS-48 reaches review after AS-49 merges under §10, so the sequence holds. If AS-49's review and AS-48's collide in one tick, Ruben takes AS-48 (he is done with AS-47 by then) and the tick says so. Lena stays on AS-49's battery.
