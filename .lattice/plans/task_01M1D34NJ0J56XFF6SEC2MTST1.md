# AS-43: D1 v1: invoice lifecycle (server) — customer mirror, draft, finalize, send

Plan by `agent:cto-owen` (tech lead for this stage), 2026-09-02. Implementer:
`agent:developer-marcus`. Recommended reviewer: `agent:qa-ruben` or
`agent:qa-priya` (implementer ≠ reviewer). The task description in Lattice
(`lattice show AS-43`) is binding in every sentence; this plan says HOW.

Style and falsification conventions follow the AS-38/AS-39/AS-41 plans: every
set-quantified assertion sits behind an exact count against a committed literal;
every guard is demonstrated failing under a mutation before it is believed;
recipe backups live OUTSIDE `apps/invoicing/`.

Contracts this plan builds against, read on master at `83de34f`:

- **The custody guard** (`lib/stripe/custody.js`, AS-38). Every endpoint this
  task calls is ALREADY on the allowlist as `scope: 'connected'`:
  `POST /v1/customers`, `POST /v1/invoiceitems`, `POST /v1/invoices`,
  `POST /v1/invoices/{id}/finalize`, `POST /v1/invoices/{id}/send`.
  **This task adds no allowlist row and edits no line of `custody.js`** (§6 AC
  17). `GET /v1/invoices/{id}` is on the allowlist too and this task
  deliberately does not use it (§3.5). `connected` scope means `checkScope`
  *requires* a well-formed `Stripe-Account` header and *forbids*
  `platform: true` — so "every call carries `Stripe-Account`" is enforced by the
  guard, not by our discipline (§3.9). `application_fee_amount`,
  `transfer_data`, `on_behalf_of`, `issuer` and six more are `FORBIDDEN_PARAMS`
  at every nesting depth, so the description's DO-NOT-PASS rule is a thrown
  `StripeCustodyError`, not a review promise.
- **The persistence contract** (AS-39 plan §2.5–2.6, live in
  `lib/db/repositories/{invoices,clients,connected-accounts}.js`):
  `clients.setStripeCustomerId` is set-once and a **no-op for the same id**;
  `invoices.attachStripeInvoice` is set-once and **throws for any id, including
  the same one**; `applyStripeSnapshot` is the only writer of `status` after
  creation, ranked `draft 0 · open 1 · uncollectible 2 · paid 3 · void 3`, with
  four outcomes (`applied` / `fields` / `stale` / `conflict`); the local draft
  freezes the moment a Stripe invoice is attached.
- **The readiness contract** (AS-39's row mapper; AS-41 maintains it). The ONE
  derivation `ready = chargesEnabled && requirementsCurrentlyDue.length === 0`
  lives in `lib/db/repositories/connected-accounts.js:48`. **This task is its
  reader.** It reads `row.ready` and restates nothing (§3.4).
- **The client pipeline** (`lib/stripe/client.js`): validate → build → **guard**
  → requireKey → sign → transport → interpret. The guard runs *before* the key
  is looked at and *before* the transport, which is why an injected transport
  exercises the custody guard on every call with zero network — the spine of
  §5's offline strategy, and the reason F2's failing set in §7 is wide.
- **The interim identity seam** (`routes/connect.js#resolveFreelancerId`, AS-41,
  carrying an AS-40 OBLIGATION marker). This task **imports that function**
  rather than writing a second one (§3.1).

### Evidence gathered while planning (measured, not recalled)

stripe-mock v0.203.0 (the image already on this host; the same tag compose
pins) was run on a throwaway loopback container and queried directly at
`Stripe-Version: 2026-08-26.dahlia`. Five findings change the design:

1. **`POST /v1/invoiceitems` REJECTS `unit_amount`** — 400 "additional
   properties are not allowed". The naive `quantity` + `unit_amount` shape does
   not exist in this API version. Accepted: `amount`, `quantity`, `currency`,
   `description`, `metadata`, `invoice`, `unit_amount_decimal`,
   `pricing[unit_amount_decimal]`, `price_data`, `period`.
2. **`POST /v1/invoiceitems` accepts `invoice=in_…`** — an item can be attached
   to a named invoice explicitly, instead of being swept in as a pending item.
3. **`POST /v1/invoices` accepts `pending_invoice_items_behavior=exclude`**,
   `auto_advance`, `currency`, `metadata`, `description`, `footer`.
4. **The mock's invoice fixture is a constant**: `status: "draft"`,
   `amount_due: 1000`, `amount_paid: 0`, `hosted_invoice_url: null`,
   `invoice_pdf: null`, `due_date: 1234567890`, `status_transitions` all null —
   identical from create, finalize and send. It never advances state. §5's
   M-cases are designed around this constant instead of tripping over it.
5. A Stripe invoice object **has no `sent_at`** and no "last payment failed"
   field. Both are our own observations, which is why §3.6's mapper must not
   emit them.

`unit_amount` would have failed at the first contract run, and the pending-items
sweep would have failed silently and expensively. Both are now design inputs.

---

## §1 Scope

### 1.1 In scope

1. Four HTTP routes (`routes/invoices.js`) implementing chain link 4 server-side:
   create draft, update draft, finalize, send (§3.2).
2. An invoice lifecycle service (`lib/invoices/lifecycle.js`) that owns the five
   Stripe calls, the lazy customer, the resumable push pipeline, the readiness
   gate and the total reconciliation (§3.3–3.5, §3.7–3.8).
3. A pure Stripe-invoice → snapshot mapper (`lib/invoices/mapping.js`): a Stripe
   invoice object → the exact key set `applyStripeSnapshot` takes. Written once
   here, **imported by AS-44** for `invoice.*` events, whose `data.object` IS an
   invoice object (§3.6) — the `readiness.js` precedent, one step down the chain.
4. `test/invoices.test.js` — offline route/service/mapper cases through the real
   client with a computing fixture transport, plus mock-gated contract cases
   (§5.3).
5. `app.js` mounts the router; the app README gains the routes section.
6. Amendments to the two existing tests whose committed literals this task moves
   (`harness`, `dependency-policy`) — §5.4.

### 1.2 Not in scope (the description's NOT list, mirrored, plus who owns it)

- **Any application-fee or take-rate parameter, ever** (row C-42). Not written,
  not commented, not named outside `custody.js` — held by the existing
  `application_fee` concept row (§5.4 item 3).
- **Webhook receipt, signature verification, `stripeEvents`, and every
  `paid`/`void`/`uncollectible` transition** — **AS-44**. §3.10 states the
  boundary precisely and hands AS-44 the mapper.
- **Every invoice screen and every `GET` route** — **AS-46** (screen 4),
  **AS-48** (screens 3 and 5). This task adds four POSTs and no rendering.
- **Reminders and manual re-send** (C-39, C-40). §3.8's send step is a *no-op*
  once `sent_at` is recorded, specifically so retry-safety does not smuggle in
  a re-send feature.
- **Multi-currency and VAT** (C-32). One currency per invoice, from AS-39's
  `money.js`; `automatic_tax` is never sent.
- **Voiding, refunding, or marking uncollectible from our side.**
  `/v1/invoices/{id}/void` is deliberately NOT on the allowlist and this task
  does not add it (§3.7 says what happens instead when a total disagrees).
- **Authentication** — **AS-40**. §3.1 reuses AS-41's seam; it does not extend it.
- **No new config row, no compose change, no Dockerfile change, no migration,
  no new dependency** (§4).
- **No Stripe account, no signup, no board ask.** Everything verifies against
  stripe-mock and fixtures; the named residual stays with AS-50 (§6 AC 16).

## §2 FILE-LEVEL SCOPE (explicit; lift this section mechanically)

**Allowed path prefixes — the complete set; the implementation diff stays inside
them:**

```
apps/invoicing/
```

Nothing outside `apps/invoicing/` is created or modified by the implementation
stage of this task. In particular: no `.lattice/` writes from the implementation
context (board state moves only through the orchestrator in the main checkout),
no `apps/chat/`, no `tools/`, no `docs/`, no top-level markdown.

Informative (non-normative for scope enforcement — the prefix above governs):
the expected file set inside that prefix is

- new: `apps/invoicing/lib/invoices/mapping.js`,
  `apps/invoicing/lib/invoices/lifecycle.js`,
  `apps/invoicing/routes/invoices.js`, `apps/invoicing/test/invoices.test.js`
- modified: `apps/invoicing/app.js`, `apps/invoicing/test/harness.test.js`,
  `apps/invoicing/test/dependency-policy.test.js`,
  `apps/invoicing/README.md`

**Not modified, and that is a claim to check** (§6 AC 17):
`lib/stripe/custody.js`, `lib/stripe/client.js`, `lib/stripe/transport.js`,
everything under `lib/db/`, `lib/config.js`, `routes/connect.js`,
`lib/connect/*`, `server.js`, `test/helpers/server.js`, `compose.yaml`,
`Dockerfile`, `package.json`, `package-lock.json`.

## §3 Design

### 3.1 Identity: who the routes act for, until AS-40

`routes/invoices.js` **imports** `resolveFreelancerId` from `./connect.js` — the
AS-41 seam, unchanged and unextended. Identity rides as `?freelancer=<id>` on
every route, including the POSTs; the **body carries data only**. One function,
one AS-40 OBLIGATION marker, one replacement point.

`routes/invoices.js` gets a one-line comment recording the shared seam **and
naming `connect.js`**; `routes/connect.js` is NOT edited.
**[CORRECTED IN PLACE 2026-09-02, review cycle 1.** This read "Both files get a
one-line comment", which contradicts §2's "Not modified, and that is a claim to
check" and AC 17's requirement of zero changes to `routes/connect.js`. AC 17
wins: a comment is not worth breaking a verified file-scope claim. Both comments
live in `routes/invoices.js`, which is where the implementer put them. See
"Review Cycle 1 Findings".]
A route module importing another route module is unusual and is stated as
deliberate: the
alternative (extracting to `lib/http/identity.js`) modifies a file merged hours
ago and adds a source file for no functional gain. §9 Q1 names the trigger that
flips this: a **third** consumer (AS-42's contract routes).

Until AS-40 these routes are exactly as open as every other route in the app —
there is no auth anywhere yet. Owner scoping is nonetheless real, because every
repository read takes `freelancerId` first and answers `NotFoundError` for
"missing" and "not yours" alike (R21).

### 3.2 Route surface

All redirects are `303 See Other` (AS-41's single literal). All error bodies are
one-line `text/plain` carrying the error class and the step that failed —
never the key, never request material (the `routes/connect.js` precedent).
Redirect targets carry `?freelancer=<id>` so the screens that will own them
inherit the same interim seam.

| Route | Does | On success |
|---|---|---|
| `POST /invoices?freelancer=F` | create a LOCAL draft — zero Stripe calls | 303 → `/invoices/{id}/edit?freelancer=F` |
| `POST /invoices/{id}?freelancer=F` | update a LOCAL draft — zero Stripe calls | 303 → `/invoices/{id}/edit?freelancer=F` |
| `POST /invoices/{id}/finalize?freelancer=F` | readiness gate, then the push pipeline **through finalize** (§3.8) | 303 → `/invoices/{id}?freelancer=F` |
| `POST /invoices/{id}/send?freelancer=F` | readiness gate, then the push pipeline **through send** | 303 → `/invoices/{id}?freelancer=F` |

`/invoices/{id}` and `/invoices/{id}/edit` are AS-48's and AS-46's screens and do
not exist yet; those redirects 404 until they land. That is the AS-41 §9 Q2
pattern: the `Location` header is the contract, asserted without dereferencing
it, and the gap closes in dependency order.

**Why finalize and send are two routes, and why send is not merely "the second
half".** They are two operations with two failure modes: finalize can leave a
finalized invoice on the freelancer's Stripe account, send can leave a finalized
invoice unsent. But the wireframe's screen 4 has ONE control ("Finalize & send",
`S4-DEFAULT-CREATE`), and a browser form issues one POST. So `send` runs the
same pipeline and simply does not stop early: **`send` = the pipeline through
step 5, `finalize` = the pipeline through step 4.** Every step is skipped when
the mirror already records it done (§3.8), so the two routes compose without a
third "issue" route and without a flag. AS-46's one button posts to
`…/send`; AS-49 can drive `…/finalize` and `…/send` separately to observe the
intermediate state.

**Error taxonomy** (`statusFor` in `routes/invoices.js`, mapped by class, never
by message text):

| Condition | Class | Status |
|---|---|---|
| missing/blank `freelancer` parameter | — | 400 |
| malformed body: bad line item, non-positive `daysUntilDue`, no items, unknown field, >`MAX_LINE_ITEMS` | `ValidationError` | **400** |
| body too large / too many parameters | body-parser error carrying `status` | that `status` (413) |
| unknown freelancer, invoice, or client — or not owned by this freelancer | `NotFoundError` | 404 |
| the freelancer's connected account is missing, or not `ready` | `AccountNotReadyError` | **403** |
| the invoice is in the wrong state for this operation (e.g. editing after attach) | `InvalidStateError` | **409** |
| the mirror's recorded amount disagrees with our line items (§3.7) | `AmountMismatchError` | **409** |
| Stripe key unconfigured (the client's `requireKey` step) | `ConfigError` | 503 |
| Stripe answered with an error, or did not answer usably | `StripeApiError` / `StripeTransportError` | 502 |
| the mapper met an invoice shape it does not understand | `TypeError` | 502 |
| custody refusal — unreachable in normal operation; must be loud | `StripeCustodyError` | 500 |

**This taxonomy deliberately differs from `routes/connect.js` in one place, and
the difference is load-bearing: `ValidationError` is 400 here and 502 there.** On
the connect routes a repository refusal means *Stripe* sent us something
malformed; on these routes it means the *freelancer's form* did. A shared
`statusFor` would have to pick one and be wrong on the other half of the app, so
the two stay separate with a comment in each naming the other.

`403` vs `409` is also deliberate: the readiness gate is a *permission the
freelancer does not yet have* (`S4-GATED-STRIPENOTREADY` in the states ledger),
while `InvalidStateError`/`AmountMismatchError` are *the resource's own state*.
Distinct status, distinct class name, and distinct `step` in the body — three
ways to tell them apart (§3.4). Do not "simplify" them together.

### 3.3 Request bodies, and the parser that is mounted on this router only

`express.urlencoded({ extended: true, limit: '64kb', parameterLimit: 500 })` is
mounted **inside `invoiceRoutes`**, not in `app.js`. Three reasons, in order of
importance:

1. **AS-44 must see the RAW request body** to verify Stripe's webhook signature.
   An app-wide body parser is the classic way to break that, discovered late.
   Mounting per-router leaves `/webhook` untouched by construction.
2. The parsed surface stays bounded to four routes.
3. `body-parser` and `qs` are ALREADY in the tree (transitive dependencies of
   express 5), so this adds **zero** packages and `LOCK_ENTRIES` stays 70.

Form shape (what AS-46 will post, and what AS-49 will post):

```
clientId=<uuid>&daysUntilDue=30&currency=usd
&lineItems[0][description]=Design+work&lineItems[0][quantity]=2&lineItems[0][unitAmountMinor]=5000
&lineItems[1][description]=…
```

**`lineItems` must be normalised, not trusted to arrive as an array.** `qs`
converts a sparse or high-index bracket set into an object keyed by numeric
strings, and the exact index at which it does so is a library default this plan
refuses to depend on. The route therefore accepts an array OR a plain object
with numeric keys, sorts by numeric key, and rejects a non-contiguous set.
`MAX_LINE_ITEMS = 50`, exceeded → 400.

**[CORRECTED IN PLACE 2026-09-02, review cycle 1 — the rationale for R5 was
stale, the requirement was not.]** This paragraph originally justified R5's
25-item case as sitting "on the far side of `qs`'s historical default". Measured
during implementation: body-parser 2.x sets `qs`'s `arrayLimit` to
`Math.max(100, <this request's parameter count>)` — **a threshold that moves with
the request**, not the fixed 20 assumed here. So 25 items arrive as a dense
array, a sparse set below the limit is silently *compacted* (indexes 0 and 30
arrive as a 2-element array), and the object branch is reachable only above index
~100 — which with `MAX_LINE_ITEMS = 50` always means a refusal. The object branch
is therefore **defensive-only under today's express**. Both branches stay: a
limit derived from request size is a *stronger* reason not to depend on it, not a
weaker one. R5 covers both branches (25 dense items, plus a past-the-limit index
that reaches the object branch and is refused). This is exactly the "library
default this plan refuses to depend on" the paragraph warned about, and it cost
one red run to find out.

Field coercion is explicit: `quantity` and `unitAmountMinor` and `daysUntilDue`
arrive as strings and are converted with a strict integer parse (`/^\d+$/`, then
`Number`) before reaching AS-39's `assertPositiveInteger` / `assertMinorUnits`.
`Number('')`, `Number(' ')` and `Number('1e3')` must all be rejected — a silent
coercion here is a wrong invoice total.

### 3.4 The finalize gate — read the flag, do not re-derive it

```js
const account = repos.connectedAccounts.getByFreelancer(freelancerId);
if (account === null) throw new AccountNotReadyError('not-connected');
if (!account.ready)   throw new AccountNotReadyError('not-ready');
```

That is the whole gate, and it is the whole of this task's contact with
readiness. `ready` comes from AS-39's row mapper — the one derivation, which
AS-41 maintains and this task consumes. **No file in this diff contains
`chargesEnabled`, `requirementsCurrentlyDue`, `payoutsEnabled` or
`detailsSubmitted`** (§6 AC 5, checked by grep the way AS-41's AC 7 was).

The refusal is **403**, class `AccountNotReadyError`, body
`AccountNotReadyError: not-connected` or `AccountNotReadyError: not-ready`. It is
distinguishable from every other failure by status (403 is used by nothing else),
by class name, and by step. It fires **before any Stripe call** — R7/R8 assert
zero transport calls, which is also what makes it cheap.

The gate guards `finalize` and `send`. It does **not** guard draft create/update:
a freelancer may build drafts before connecting Stripe, and `S4-GATED-…` is about
issuing, not drafting.

### 3.5 The five Stripe calls, exactly

Every one is `scope: 'connected'` and therefore carries
`Stripe-Account: <acct_…>` and MUST NOT declare `platform: true`. The account id
comes from `repos.connectedAccounts.getByFreelancer(freelancerId).stripeAccountId`
— the same row the gate just read, never a second lookup.

| # | Call | Params | Idempotency key |
|---|---|---|---|
| 1 | `POST /v1/customers` | `email`, `name`, `metadata[local_client_id]` | `cus-create-<clientId>` |
| 2 | `POST /v1/invoices` | `customer`, `collection_method=send_invoice`, `days_until_due`, `currency`, `auto_advance=false`, `pending_invoice_items_behavior=exclude`, `metadata[local_invoice_id]` | `inv-create-<invoiceId>` |
| 3 | `POST /v1/invoiceitems` × N | `customer`, `invoice`, `currency`, `amount`, `description`, `metadata[local_line_item_id]` | `ii-create-<lineItemId>` |
| 4 | `POST /v1/invoices/{id}/finalize` | `auto_advance=false` | `inv-finalize-<invoiceId>` |
| 5 | `POST /v1/invoices/{id}/send` | `{}` (empty form body, content-type set) | `inv-send-<invoiceId>` |

No `GET /v1/invoices/{id}`: calls 4 and 5 each return the full invoice object,
so a read would add a round trip and no information. **Five POSTs, zero GETs.**

Six decisions inside that table, each with its reason:

- **`amount`, not `quantity` × `unit_amount`.** `unit_amount` does not exist on
  this endpoint at this API version (measured). Of the shapes that do, we send
  the **extended amount we computed ourselves** — `quantity * unitAmountMinor`,
  a safe integer, asserted as such — **and nothing else**: `quantity` is used
  locally to compute that amount and is NOT sent. Nothing then depends on
  Stripe's multiplication semantics, and Stripe's `amount_due` after finalize
  must equal our derived `totalMinor` by construction (§3.7 checks it).
  The human line keeps its structure in the `description`.
  **[CORRECTED IN PLACE 2026-09-02, review cycle 1.** This bullet previously read
  "plus `quantity` for display", contradicting §3.5's own Params column, R6's
  assertion list and AC 3 ("exactly §3.5's table"), all of which omit it. The
  table wins — on a money-adjacent call the narrower reading is correct, and
  stripe-mock validates parameter *names*, not the real API's mutual-exclusivity
  rule, so it cannot adjudicate this. The implementer arbitrated it the right
  way; he should not have had to. See "Review Cycle 1 Findings".]
- **The invoice is created BEFORE its items, and each item names the invoice.**
  This inverts the order the spike's diagram shows (`/v1/invoiceitems` then
  `/v1/invoices`), and the inversion is the point. Pending invoice items are
  attached to the **customer**, not to an invoice: a run that creates items and
  then fails to create the invoice leaves them pending on that client, and
  Stripe sweeps them onto **the next invoice for the same client** — a
  cross-contaminated, over-charged invoice, arriving days later. Our clients are
  long-lived and reused across invoices, so this is the normal case, not an edge.
  Explicit `invoice=in_…` removes the sweep from the trust surface entirely.
  Custody is untouched: same endpoints, same connected scope, same allowlist rows.
  **This is a deliberate, recorded deviation from the description's DECISION
  CONTEXT sentence about call order** — the endpoints and their scoping, which is
  what that sentence is protecting, are unchanged.
- **`pending_invoice_items_behavior=exclude`** is belt to that braces: whatever
  stray pending items exist on the client (from an earlier failure, or created by
  the freelancer in their own Dashboard), none of them join our invoice. Sent
  explicitly rather than relying on a default we would otherwise have to look up.
- **`auto_advance: false` at create.** Without it, an invoice we created but did
  not finalize can be finalized and emailed by Stripe about an hour later, on our
  behalf, with no action from us. That is a money-adjacent action nobody
  authorised. False at create makes the draft inert until we act.
- **`auto_advance: false` at finalize.** The invoice is emailed exactly once, by
  our explicit call 5. Leaving Stripe's automatic collection on risks a second
  email and makes "who sent this" ambiguous in a v1 whose whole email story is
  "Stripe does it, once". The cost is that Stripe's automatic reminder cadence
  does not run — C-39 (reminders) is OUT of v1 anyway, and flipping this is one
  parameter on one call. §9 Q2 boxes it to AS-50.
- **Metadata keys are `local_*`.** Metadata keys are parameter segments and are
  matched by `FORBIDDEN_PARAMS` at every depth — `metadata[destination]` would be
  refused by the custody guard. `local_client_id`, `local_invoice_id`,
  `local_line_item_id` are safe, greppable, and worth their bytes for support.

**No transport-level retry. This closes AS-38 plan §8 Q2, which names AS-43 as
the decider.** `lib/stripe/transport.js` stays exactly as it is. The reasoning:
the user-visible retry is re-submitting the form, and §3.8's resumable pipeline
plus five stable idempotency keys already make that safe; an automatic retry adds
a failure mode (a timeout that actually succeeded) for no gain at v1 volume.
Revisit trigger: transient Stripe failures observed during AS-50's acceptance run.

### 3.6 The mapper — one definition, two writers (the AS-44 handoff)

`lib/invoices/mapping.js` exports one pure function:

```js
invoiceSnapshotFromStripe(invoice)  →  { status, hostedInvoiceUrl, invoicePdfUrl,
                                          amountDueMinor, amountPaidMinor, dueAt,
                                          finalizedAt, paidAt, voidedAt,
                                          markedUncollectibleAt }
```

Exactly **ten** keys, and the count is asserted (`Object.keys(...).sort()`
against a committed literal) — cardinality before quantification.

- `status` verbatim from Stripe. `hosted_invoice_url` → `hostedInvoiceUrl`,
  **`invoice_pdf` → `invoicePdfUrl`** (the rename AS-39's `assertKnownKeys`
  exists to catch), `amount_due`/`amount_paid` → `…Minor` (Stripe speaks minor
  units; nothing is converted), `due_date` and each `status_transitions.*` →
  ISO-8601 UTC with milliseconds via `new Date(seconds * 1000).toISOString()`,
  `null` staying `null`.
- **`sentAt` and `lastPaymentFailedAt` are NEVER emitted.** A Stripe invoice
  object has no such fields (measured). If the mapper emitted them as `null`,
  the next full snapshot — ours after send, or AS-44's on `invoice.paid` — would
  **erase a recorded fact**, because `applyStripeSnapshot` writes every key
  present. They are added by their own writer, at their own moment, and by
  nobody else: `sentAt` by §3.8 step 5 from our clock, `lastPaymentFailedAt` by
  AS-44 from `invoice.payment_failed`.
- **Strict where Stripe is always present, tolerant where it may be absent.**
  A non-string `status`, a non-object argument, a non-integer `amount_due` →
  `TypeError` ("a shape this app does not understand", 502 at the route), the
  `readiness.js` rule. `status_transitions` absent or null → all four timestamps
  `null`; `hosted_invoice_url`/`invoice_pdf` absent → `null`.
- The mapper **decides nothing**: it does not rank statuses, does not compare to
  the mirror, and does not know what `open` means. The state machine is AS-39's.
- **AS-44 imports this exact function** for `invoice.created/finalized/paid/
  voided/marked_uncollectible/payment_failed`, whose `data.object` IS an invoice
  object. R1 proves the reuse before AS-44 exists by mapping an `invoice.paid`
  event's `data.object` and asserting deep equality with the same object mapped
  directly — the AS-41 R1 pattern.

### 3.7 Reconciliation: the guard this task introduces

> **[REWORKED IN PLACE 2026-09-02, review cycle 1 — see "Review Cycle 1
> Findings" at the end of this file.** The original text put this guard inside
> the finalize step, where it is unreachable on a resumed request, and compared
> Stripe's response rather than the mirror. The guard's *purpose* is unchanged.
> Its location, its input, and its currency half are.]

The guard is a property of **the mirror row**, checked in `run()`, on both
routes, on every path that can reach a send:

```
invoice.amountDueMinor   must equal   invoice.totalMinor
```

Both values are already on the row AS-39 returns. `amountDueMinor` is *Stripe's*
number, written only by `applyStripeSnapshot`; `totalMinor` is *ours*, derived on
every read as `SUM(quantity * unit_amount_minor)` and never stored. Mismatch →
`AmountMismatchError` (`step: 'reconcile'`) → **409**; the send does not happen,
and neither route answers 303.

**Where it runs, exactly:** in `run()`, after the `if (invoice.status ===
'draft')` block and before the `through === 'send'` branch, against the row that
block returned. **Not inside `finalizeInvoice()`.** That placement is the whole
fix: a request that finds the invoice already `open` skips steps 3 and 4, so a
guard living inside step 4 fires exactly once per invoice and then stops existing
for it — while step 5's only precondition is `sentAt === null`. The row in hand
at that point always carries a `stripeInvoiceId` (step 2 guarantees it), so the
guard is unconditional.

Why it exists, unchanged: §3.8 re-pushes line items on a retry and leans on
Stripe's idempotency window to deduplicate them. That is the right mechanism, and
this is the assertion that says so out loud — if a duplicate item ever lands, if
a pending item is swept in despite `exclude`, if a quantity is multiplied twice,
the totals diverge and we find out before the client is emailed a wrong invoice.

**The snapshot-first order is unchanged and still decided.** `finalizeInvoice()`
still writes the snapshot from the finalize response and returns the updated row;
the refusal happens after it, one level up. Stripe really did finalize the
invoice; a mirror that said `draft` would be a lie, and AS-39's discipline is
that the mirror never guesses. The freelancer sees a row whose recorded amount
disagrees with its line items — exactly the truth — and resolution is theirs, in
their own Stripe Dashboard: we do not add `/v1/invoices/{id}/void` to the
allowlist to clean up after ourselves, and a task that needs voiding is a
separate task with its own allowlist row.

Checking the **mirror** rather than the response is what makes the guard total,
and it is stronger in two ways worth stating:

- it holds on every path to `open`, including paths this task does not own. An
  invoice moved to `open` by AS-44's `invoice.finalized` webhook is checked by
  the same predicate, because AS-44 writes `amountDueMinor` through the same
  `applyStripeSnapshot`. A response-based check could never cover that.
- it also catches a fault in **our own persistence**. A response-based check
  compares Stripe to our line items and would pass while `writeSnapshot` quietly
  recorded something else; the mirror check compares what we actually stored.

A `null` `amountDueMinor` on an invoice at `open` fails the strict equality and
is therefore a refusal, deliberately and at no extra cost in code. It is
unreachable through both writers (the mapper emits an integer or throws), and
"we cannot verify this invoice" is not a reason to email it.

#### The currency comparison is DROPPED. Ruling, `agent:cto-owen`, 2026-09-02.

The mirror carries `invoice.currency` — **ours**: set at creation, validated by
`assertSupportedCurrency`, absent from `DRAFT_KEYS` and therefore immutable, and
frozen again by `attachStripeInvoice`. It carries **no column for Stripe's**.
`invoiceSnapshotFromStripe` emits no `currency` key and `SNAPSHOT_COLUMNS` has
none, so after a resume there is nothing to compare a currency *against*.

The alternative — a `stripe_currency` column — is an AS-39 schema change:
**a new migration file** (migrations are new files, never edits), `SCHEMA_VERSION`
1→2, `MIGRATIONS` 1→2, three literals in `repositories/invoices.js`
(`SNAPSHOT_COLUMNS`/`KEYS`/`VALIDATORS`), an **eleventh key** in the mapper AS-44
inherits (moving R1's committed ten-key literal and F4's rationale), plus
`repositories.test.js` and `db.test.js`. It also breaks AC 17 and §2's file
scope, which QA verified as met. **Rejected**: a rework cycle must not quietly
become a cross-cutting schema change on the one table AS-44 is about to start
writing.

And rejected on the merits, not only the cost: **the comparison is not
load-bearing in a v1 with one currency.** For `theirs.currency !==
ours.currency` to be reachable, one of these must be true:

1. `SUPPORTED_CURRENCIES` has more than one member. It has exactly one
   (`lib/db/money.js`), enforced at the single draft-creation site.
2. Stripe substitutes a currency we sent **explicitly**. We send it on
   `POST /v1/invoices` *and* on every `POST /v1/invoiceitems`, so it is never
   inferred from the connected account's default — and Stripe rejects an invoice
   item whose currency differs from its invoice's, which would surface as
   `StripeApiError: push-line-item` (502) *before* finalize.

"Ours" and "theirs" are the same constant, sent by us, in a system with one
currency. What is being deleted is a comparison of a constant with itself.

**What carries the weight now, so the next reader can find it:**

1. **`lib/db/money.js` — `SUPPORTED_CURRENCIES` has exactly one member**, one
   validator, one creation site. **Pinned by test (R26):** the suite asserts the
   cardinality against a committed literal, with a message naming this ruling.
   The moment a second currency is added — C-32 multi-currency, out of v1 — that
   test goes red and the currency half must come back, which at *that* point
   does justify the column. **The failing test is the trigger**; there is no
   comment to overlook and no memory to rely on.
2. **The explicit `currency` parameter on calls 2 and 3**, pinned by R6's
   exact-body assertions (a mutation that drops it moves those literals).
3. **A named assumption, not a proof:** that Stripe echoes an explicitly-sent
   currency rather than substituting one. stripe-mock cannot show this — its
   invoice fixture is a constant. Verification home: **AS-50's acceptance run**,
   which should record the real finalize response's `currency` alongside its
   `amount_due`. Flagged for AS-50's planner, not solved here.

Two properties this guard must NOT have, and tests hold both: it must not fire
on the happy path — including the **resumed** happy path (R6, R11, R14, M1) —
and it must fire when the totals genuinely disagree, **on the first request and
on every request after it** (R12, M3, and F3b/F8 in §7).

### 3.8 The pipeline: five steps, each skipped when the mirror says it is done

```
POST /invoices/{id}/finalize   (steps 1-4)      POST /invoices/{id}/send   (steps 1-5)

  gate    account.ready                                        else 403 (§3.4)
  state   invoice.status ∈ {draft, open}                        else 409
  step 1  ensureCustomer     skip if client.stripeCustomerId !== null
  step 2  ensureInvoice      skip if invoice.stripeInvoiceId !== null
  step 3  pushLineItems      skip if invoice.status !== 'draft'
  step 4  finalize           skip if invoice.status !== 'draft'   → snapshot
  guard   reconcile (§3.7)   ALWAYS — never skipped                else 409
  ─────────────────────────── finalize stops here ───────────────────────────
  step 5  send               skip if invoice.sentAt !== null      → snapshot + sentAt
```

**[CORRECTED IN PLACE 2026-09-02, review cycle 1.** The original diagram put
`reconcile` inside step 4, sharing step 4's skip predicate. It therefore did not
run on any request that found the invoice already `open` — which is every
request after the first. The guard now sits between step 4 and step 5 with **no
predicate of its own**, so it gates the send on the resumed path as well as the
first. §3.7's sentence "and **before** any send" was always the intent; this
diagram was the half that disagreed with it, and the implementer followed the
diagram. See "Review Cycle 1 Findings".]

Every step is labelled on the way out (`labelled(step, work)`, the AS-41
precedent), so a failure body reads `StripeApiError: finalize` and names WHICH
interaction failed.

- **Steps 3 and 4 share a predicate on purpose.** If the process dies after the
  invoice is attached but before every item is pushed, a retry that skipped
  step 3 would finalize a short invoice. Re-pushing every item instead is safe
  because each carries `ii-create-<lineItemId>`: within Stripe's idempotency
  window a replay returns the existing item and creates nothing. The per-item
  key is load-bearing, not decorative — and §3.7 is the backstop that catches it
  if the window ever lapses.
- **Step 1, lazy customer, three layers — the AS-41 pattern, reused not
  reinvented.** (i) *Row check*: `client.stripeCustomerId !== null` → reuse, zero
  Stripe calls; a client that is never invoiced leaves no trace on the
  freelancer's Stripe account, which is row C-26's whole point. (ii) *Stable
  idempotency key* `cus-create-<clientId>`: two concurrent finalizes both POST,
  and Stripe returns **the same `cus_`** to both. (iii) *Convergence on the
  loser's write*: `setStripeCustomerId` is a **no-op for the same id** (AS-39),
  so in the common double-submit case the second writer simply succeeds and both
  agree. If the ids differ — the idempotency window lapsed mid-race — the write
  throws `InvalidStateError`; the service catches it, re-reads the client, and
  **continues against the STORED `cus_`**. The loser's customer is an inert
  test-mode object referenced by nothing: recorded honestly, not defended against
  with machinery. Order is **Stripe first, row after**, so a refused create
  leaves nothing behind (AS-41 R10's rule, R19 here).
- **Step 2 has the same shape with one asymmetry worth knowing.**
  `attachStripeInvoice` throws `InvalidStateError` for **any** second id
  including an identical one — unlike `setStripeCustomerId`. So the loser of an
  invoice-create race catches it, re-reads, and continues against the stored
  `in_`; when the idempotency key did its job the stored id IS the one it just
  received, and the retry is free. When it is not, the orphan is a Stripe DRAFT
  invoice — never finalized, never sent, no money — inert in the same sense.
  §11 item 2 records the asymmetry rather than changing AS-39's contract here.
- **Step 5 is a no-op once `sent_at` is recorded**, which keeps retry-safety from
  quietly becoming C-40's manual re-send. Its idempotency key
  `inv-send-<invoiceId>` closes the remaining hole: a send that succeeded at
  Stripe but died before the mirror write is a replay, not a second email.
  Its snapshot is written **in this order and no other**:
  `applyStripeSnapshot(in_, { ...invoiceSnapshotFromStripe(data), sentAt: now() })`
  — our observation last, so it cannot be overwritten by a mapper that grows a
  key it should not have (§3.6). F4 in §7 exists because that is a rule a future
  edit can break silently.
- **The mock makes step 3–5 predicates non-skipping**, because stripe-mock's
  responses never advance `status`. That is a mock artifact, named here so
  nobody reads it as a bug, and it is asserted rather than glossed in M1.

### 3.9 Custody, stated as a property of this diff

- Every call declares `account: <acct_…>` and none declares `platform: true`.
  The custody guard enforces both directions: a connected row with no
  `Stripe-Account` is `missing_account`, and one that declares `platform: true`
  is `unexpected_platform` — refused before the key is read and before the
  transport is touched.
- The existing dependency-policy concept row
  `scanConcept('platform Stripe call', /platform:\s*true/, ['lib/connect/onboarding.js'])`
  therefore does double duty for this task: it stays green **only if** this diff
  introduces no platform-scoped call. It moves no literal and gains a second
  meaning (§5.4 item 4).
- R22 asserts the property directly at the wire level, independent of the guard:
  over a complete recorded run, every request carried `stripe-account`, and no
  request body or query contained `application_fee_amount`, `transfer_data`,
  `on_behalf_of`, `issuer`, `destination`, `transfer_group` or `application_fee`.
  Two independent witnesses for one claim.

### 3.10 The AS-44 boundary, precisely

| | AS-43 (this task) | AS-44 |
|---|---|---|
| Writes `draft` | `invoices.createDraft` | — |
| Writes `stripe_invoice_id` | `attachStripeInvoice` (step 2) — **the only path that may** | — |
| Writes `open` + urls + amounts + `dueAt` + `finalizedAt` | snapshot from the **finalize response** | also, from `invoice.finalized` |
| Writes `sentAt` | step 5, from **our clock** | — |
| Writes `paid`, `void`, `uncollectible`, `lastPaymentFailedAt` | **never** | from `invoice.*` events |
| Writes readiness | never | `account.updated` (via AS-41's mapper) |
| Uses `stripeEvents.recordOnce` | never | every event |
| Owns `/webhook` | never | yes |

**Both of us implement one rule, not two.** Every status change on either side
goes through `invoices.applyStripeSnapshot`, which is the sole writer of `status`
and applies AS-39's rank machine — so a `paid` webhook that overtakes our
finalize snapshot converges (`applied`, skip-ahead is just "up in rank") and our
late finalize snapshot is discarded (`stale`), with no coordination between us.
This task's four outcomes are handled thus: `applied` and `fields` are the normal
results; `stale` is possible and benign (a webhook beat us) and is **logged, not
raised** — the mirror is already ahead of what we were about to write; `conflict`
(`paid` vs `void`) is unreachable from this task's writes, which only ever carry
`draft` or `open`, and is treated as `stale` if it somehow appears.

AS-44 receives from this task, already tested: the mapper (§3.6), the
`sentAt`/`lastPaymentFailedAt` exclusion rule, and the snapshot key set.

## §4 Compose / config / Dockerfile / schema

**All four unchanged.** No new setting (the app base URL AS-41 added covers the
only URL this task builds; nothing else is environment-dependent). No new port,
no new service, no image change. **No migration**: AS-39's Q5 default ("do not
store `ii_` ids per line item; AS-43 adds `stripe_invoice_item_id` by migration
if it needs to reconcile") is **honoured, not revisited** — §3.8's per-item
idempotency key removes the need for a stored id, and §3.7's total check is the
reconciliation. This closes Q5 with its default, and §11 item 1 records that
closure for AS-39's readers. `MIGRATIONS` stays one row; `SCHEMA_VERSION` stays 1.

**Zero new dependencies.** `express.urlencoded` is part of express 5's bundled
`body-parser`, and both `body-parser` and `qs` are already in the tree —
`LOCK_ENTRIES` stays 70, `DIRECT_DEPENDENCIES` stays `['ejs', 'express']`.

## §5 Key files (one line each) and every test literal that moves

### 5.1 New

| File | One line | ~lines |
|---|---|---|
| `lib/invoices/mapping.js` | pure mapper: Stripe invoice object → the ten-key snapshot; never emits `sentAt`/`lastPaymentFailedAt` (§3.6) | 100 |
| `lib/invoices/lifecycle.js` | the five Stripe calls, the gate, the lazy customer, the resumable pipeline, the reconciliation; `AccountNotReadyError` + `AmountMismatchError` (§3.3–3.8) | 250 |
| `routes/invoices.js` | four thin handlers, the router-scoped body parser, `lineItems` normalisation, `statusFor` (§3.1–3.3) | 170 |
| `test/invoices.test.js` | R1–R23 offline through the real client/guard with a computing fixture transport; M1–M3 `{ skip: SKIP }` against stripe-mock (§5.3) | 700 |

### 5.2 Modified

| File | One line | Δ |
|---|---|---|
| `app.js` | mount `invoiceRoutes(config, { repos, stripe })` after `connectRoutes`, before `express.static`; route-order comment | +6 |
| `test/harness.test.js` | literals in §5.4 | +2 |
| `test/dependency-policy.test.js` | literals in §5.4 | +8 |
| `README.md` | routes section, the five Stripe calls, the gate, the AS-44/AS-46/AS-48 handoffs | +45 |

### 5.3 Test plan (`test/invoices.test.js`)

Offline cases drive the real routes over real HTTP through `withServer`, with a
client built as `createStripeClient({ apiKey: '<placeholder, not key-shaped>',
transport: fixtureTransport })` — **the full pipeline including the custody guard
runs on every call**, and the transport records every wire request (method, path,
headers, body) so assertions read actual bytes. `withServer` already accepts a
`{ stripe }` override (AS-41); `test/helpers/server.js` needs no change.

**The fixture transport COMPUTES, it does not merely can.** It accumulates the
`amount` of every `/v1/invoiceitems` request it sees, keyed by invoice, and
returns that sum as `amount_due` on the finalize and send responses. This is
~10 lines and it is what makes §3.7's reconciliation testable in both
directions: a mutation that pushes an item twice changes the fixture's answer and
trips the guard (F3), which a canned constant could never show. Its other
responses (`cus_`/`in_`/`ii_` ids, `status`, `status_transitions`) are canned and
overridable per case.

| # | Case |
|---|---|
| R1 | **the mapper**: exact ten-key output asserted against a committed key list; epoch→ISO for `due_date` and all four `status_transitions`; `invoice_pdf` → `invoicePdfUrl`; absent/null `status_transitions` → four nulls; `sentAt`/`lastPaymentFailedAt` NEVER present; non-object / non-string status / non-integer amount → `TypeError`; the output is accepted by `applyStripeSnapshot` (no unknown key); and an `invoice.paid` EVENT's `data.object` maps identically to the same object mapped directly — **AS-44's reuse proven before AS-44 exists** |
| R2 | draft create: 303 → `/invoices/{id}/edit?freelancer=F`, row created, items in position order, `totalMinor` derived, **zero transport calls** |
| R3 | draft create refusals: unknown/unowned client → 404; empty `lineItems` → 400; blank description → 400; `quantity=0`, `quantity=1.5`, `quantity=1e3`, `unitAmountMinor=-1`, `daysUntilDue=0` → 400; unknown field → 400; all with zero transport calls |
| R4 | draft update: `daysUntilDue` and `clientId` change, line items replaced **as a set** (positions renumbered), zero transport calls |
| R5 | **25 line items** survive body parsing in order with correct amounts — the `qs` array-limit case §3.3 refuses to assume away; and 51 items → 400 |
| R6 | **finalize happy path**: exactly `1 + 1 + N + 1` calls in that order; each request's `stripe-account` header is the row's `acct_`; the customer body is `email`,`name`,`metadata[local_client_id]` with key `cus-create-<clientId>`; the invoice body is exactly `customer`,`collection_method=send_invoice`,`days_until_due`,`currency`,`auto_advance=false`,`pending_invoice_items_behavior=exclude`,`metadata[local_invoice_id]`; each item body carries `invoice=in_…`, `amount = quantity*unitAmountMinor`, `currency`, `description`, `metadata[local_line_item_id]`; the finalize body is `auto_advance=false`; **no send call**; mirror = `open` + urls + amounts + `dueAt` + `finalizedAt`, `sentAt` still null; client's `stripeCustomerId` set; 303 |
| R7 | finalize with a **not-ready** account (charges off, or requirements due) → **403** `AccountNotReadyError: not-ready`, **zero transport calls**, mirror untouched |
| R8 | finalize with **no connected-account row** → 403 `AccountNotReadyError: not-connected`, zero transport calls |
| R9 | **customer reuse**: the client already carries a `cus_` → **zero `/v1/customers` calls**, and the stored id is what the invoice body names |
| R10 | **double finalize**: the second call makes zero Stripe calls and still 303s (every step skipped) |
| R11 | **resumption**: an intercept fails the finalize call → 502 `StripeApiError: finalize`, mirror has `stripeInvoiceId` attached and status still `draft`; retry with the intercept removed → succeeds with **the same `in_`** (zero second `/v1/invoices` calls), items re-pushed carrying the same `ii-create-…` keys |
| R12 | **the reconciliation guard fires, and KEEPS firing** *(rewritten 2026-09-02, review cycle 1)*: an intercept inflates `amount_due` → **409** `AmountMismatchError`, **no send call**, and the mirror DOES record `open` with Stripe's amount (§3.7's "snapshot first, then refuse"). Then, **on the same invoice, without changing the fixture**: a SECOND `POST …/send` → 409 again, cumulative `/send` calls still **0**, `sentAt` still `null`; and a `POST …/finalize` → **409**, not 303. The old currency sub-case is **deleted** — §3.7's ruling drops that comparison; R26 replaces it |
| R13 | Stripe 4xx **at the finalize step** → 502 naming `finalize`; mirror keeps `stripeInvoiceId`, status `draft`, no send call |
| R14 | **send from an already-open invoice**: exactly one call (`/send`), `sentAt` written from OUR clock (not from any Stripe field), status unchanged |
| R15 | **send from a draft** runs steps 1–5 in one request: `1+1+N+1+1` calls in order; mirror `open` + `sentAt`; 303 |
| R16 | send when `sentAt` is already set → zero transport calls, 303 (C-40 stays OUT) |
| R17 | **edit after attach** → 409 `InvalidStateError`, zero transport calls — AS-39's freeze, surfaced |
| R18 | **no key configured** (`apiKey: null`) → finalize is 503 `ConfigError`, **zero transport calls** (requireKey fires after the guard, before the transport) |
| R19 | Stripe 4xx **at the customer step** → 502 naming `create-customer`; `client.stripeCustomerId` still null (Stripe first, row after); zero further calls |
| R20 | missing/blank `freelancer` → 400 on all four routes, zero transport calls |
| R21 | **ownership**: another freelancer's invoice id → 404 on all four routes, zero transport calls |
| R22 | **the custody property, at the wire**: over a complete recorded run, every request carried `stripe-account`; and no body or query contains `application_fee_amount`, `application_fee`, `transfer_data`, `on_behalf_of`, `issuer`, `destination` or `transfer_group` |
| R23 | **`sentAt` survives a later snapshot** — the reason §3.6 excludes it, tested as the AS-44 interaction it protects: take a sent invoice, apply `invoiceSnapshotFromStripe` of a **paid** invoice object (what AS-44 will do on `invoice.paid`), assert `status` became `paid` AND `sentAt` is unchanged. A mapper that emitted `sentAt: null` would erase it here |

**Added 2026-09-02, review cycle 1** (R24–R26; R24/R25 close the taxonomy holes
QA's Finding 5 named, R26 is the invariant §3.7's currency ruling rests on):

| # | Case |
|---|---|
| R24 | **`StripeCustodyError` → 500 at the route.** Drive one through a route with a stripe stub whose `request` throws it; body is the class + step, carries no request material. The status is reachable — F2 put 8 tests through it — but no case *asserts* it, and AC 1 names 500 |
| R25 | **`TypeError` → 502 at the route**: a fixture whose finalize response has a non-string `status` (or a non-integer `amount_due`) makes the mapper throw; the route answers 502, not 500. R1 proves the mapper throws; nothing drove one through a route |
| R26 | **the invariant the dropped currency comparison rests on**: import `SUPPORTED_CURRENCIES` from `lib/db/money.js` and assert its length against the committed literal `1`, with an assertion message naming §3.7's ruling and saying what must be restored when it goes red (the currency half of the guard, which then needs the `stripe_currency` column). `test/` is in the dependency-policy scan's `SKIPPED_DIRS`, so this import moves **no** literal — verified, not assumed |

Mock-gated cases (`{ skip: SKIP }`; the same self-skip pattern and
not-`stripe.com` refusal as `stripe-mock.test.js` and `connect.test.js`; only the
`contract` service sets `ASC_STRIPE_MOCK_URL`):

| # | Case |
|---|---|
| M1 | **finalize over HTTP against stripe-mock**, on a draft whose `totalMinor` is exactly `MOCK_FIXTURE_AMOUNT_DUE = 1000` (measured: the mock's invoice fixture is a constant). The mock validates all four request shapes — a parameter the spec does not know is a 502 here. 303; `stripeInvoiceId` attached; **and the mirror status is asserted to still be `draft`**, because the mock is stateless: the residual is asserted, not glossed |
| M2 | **send against the mock**: 303, `sentAt` written |
| M3 | **the reconciliation guard against the mock**: the same flow on a draft totalling `1001` → 409 `AmountMismatchError`, no send call. The guard fires against a real spec-shaped response, not only against our own fixture. **Extended 2026-09-02, review cycle 1:** a SECOND `POST …/send` on that same invoice → 409 again, `sentAt` still `null`, cumulative `/send` calls **0**. **Assert, and state in the case, WHY this is the weaker witness:** the mock is stateless, so its finalize response leaves the mirror at `draft` (M1 already pins this) — the second request therefore re-runs steps 3–4 and is refused by the *finalizing* path, NOT by the resumed-skip path the defect lived on. It proves the refusal is stable across requests against a spec-shaped response; it does **not** cover the skip path. **Only R12 covers that**, because only the computing fixture advances the mirror to `open`. Do not let M3 stand in for R12 |

**What genuinely cannot be tested here, named** (the description's residual,
ours to restate not to solve): stripe-mock is stateless, so `draft → open →
paid`, the client-facing email, Stripe's actual deduplication of our five
idempotency keys, and whether a real Stripe `amount_due` equals our computed
total on a live account are all unobservable. They belong to **AS-50**'s recorded
acceptance run, gated on the board's account (AS-51). This task opens no account
and files no ask.

### 5.4 Every committed literal that moves, exactly

1. `test/harness.test.js`: `EXPECTED_TEST_FILES` gains `'invoices.test.js'`
   (sorted position 9, after `health.test.js`); the cardinality assertion
   `11` → `12`, in both the number and the message.
2. `test/dependency-policy.test.js`, source list: count `29` → `32`; the sorted
   list gains `lib/invoices/lifecycle.js` and `lib/invoices/mapping.js` (both
   between `lib/health.js` and `lib/stripe/client.js`) and `routes/invoices.js`
   (between `routes/health.js` and `routes/pages.js`).
3. `test/dependency-policy.test.js`, **money-words row**: the RAW-text allowed
   list gains the new files that genuinely contain `amount|currency|money`.
   Expected: all three (`lib/invoices/lifecycle.js` builds `amount`,
   `lib/invoices/mapping.js` maps `amount_due`/`amount_paid`,
   `routes/invoices.js` parses `unitAmountMinor`). **The used-exemption rule
   cuts both ways** — if one of them turns out to contain no money word, it must
   be LEFT OUT, not listed hopefully; the suite says which. `app.js` must NOT
   gain one, comments included (it is a RAW scan): the mount line and its comment
   are money-word-free.
4. `test/dependency-policy.test.js`, the concept test's name gains AS-43; the
   `platform Stripe call` row's allowed list is **unchanged**, and that is a
   claim: this task adds no platform-scoped call (§3.9).
5. **Traps that would move a literal by accident, and must not:**
   - no identifier matching `/STRIPE_[A-Z_]+/` in the new files (that concept row
     is pinned to `compose.yaml`, `lib/config.js`, `lib/stripe/client.js`) — so
     no `const STRIPE_INVOICE_…`;
   - no raw SQL (the new files call repositories);
   - no `fetch`, no `transport.js` import, no `stripe` package import;
   - no `"/webhook"` string (that row must stay `[]` until AS-44);
   - no `application_fee` anywhere (that row must stay `['lib/stripe/custody.js']`);
   - `test/invoices.test.js` stays under **1,200 lines** (the file-size cap
     applies to test files too).
6. **Deliberately NOT moving** (asserted by leaving them untouched and green):
   `config.test.js` (no new setting — `SCHEMA.length` stays 10),
   `deploy-shape.test.js` (compose and Dockerfile untouched; the exactly-4
   environment-entries pin stands), `health.test.js` (four checks, no new one),
   `db.test.js` and `repositories.test.js` (no schema and no repository change),
   `connect.test.js`, `stripe-client.test.js`, `stripe-mock.test.js`,
   `assets.test.js`, `package.json` / `package-lock.json` (`LOCK_ENTRIES` 70),
   `SANCTIONED.length` 3, manifests 3.

## §6 Acceptance criteria

1. Four routes exist with §3.2's methods, paths, 303 redirects (carrying
   `?freelancer=`), and error statuses 400/403/404/409/500/502/503 — R2–R22.
2. Draft create and update make **zero** Stripe calls, validate every field
   through AS-39's assertions, and normalise `lineItems` from either an array or
   a numeric-keyed object, proven at 25 items (R2–R5).
3. The five Stripe calls are exactly §3.5's table — endpoints, parameters and
   the five stable idempotency keys — asserted on the wire (R6, R15) and
   re-validated against stripe-mock's spec (M1, M2).
4. **Every Stripe call in this diff is connected-scope**: `account: <acct_…>`
   present, `platform: true` absent, asserted at the wire (R6, R22) and held by
   the existing `platform Stripe call` concept row (§3.9).
5. **The finalize gate reads AS-39's `ready` and re-derives nothing.** Refusal is
   403 `AccountNotReadyError` with `not-connected` / `not-ready`, before any
   Stripe call (R7, R8). Grep proves it: `requirementsCurrentlyDue.length === 0`
   occurs exactly once in the app (`lib/db/repositories/connected-accounts.js`),
   and none of `chargesEnabled`, `payoutsEnabled`, `detailsSubmitted`,
   `requirementsCurrentlyDue` appears anywhere in this diff.
6. The Stripe customer is created **lazily and at most once per client**: reuse
   on the row check with zero `/v1/customers` calls (R9), the same-id write is a
   no-op, a differing-id write converges on the stored `cus_`, and a refused
   create leaves `stripe_customer_id` null (R19).
7. `attachStripeInvoice` is the only path that sets `stripe_invoice_id`, and a
   second attach converges on the stored `in_` rather than creating a second
   invoice (R11).
8. The local draft freezes on attach: an edit afterwards is 409
   `InvalidStateError` with zero Stripe calls (R17).
9. Line items are pushed with an explicit `invoice=in_…` and
   `pending_invoice_items_behavior=exclude`; each item's `amount` is
   `quantity * unitAmountMinor` computed locally; `unit_amount` is never sent
   (R6 — and the measurement in the preamble says why).
10. **The reconciliation guard** *(rewritten 2026-09-02, review cycle 1 — see
    §3.7's ruling and "Review Cycle 1 Findings")*: **on every request that could
    reach a send, not only the one that finalized**, the mirror's
    `amountDueMinor` must equal its `totalMinor` or BOTH routes refuse with 409
    `AmountMismatchError` and no `/send` call is made — with the snapshot already
    written. Proven on the first request AND on a retry after it — **R12 is the
    load-bearing case**, because it is the only one whose mirror actually reaches
    `open` and takes the resumed-skip path; M3 is the weaker mock-side witness
    and does not substitute for it — and proven by breaking it on the *resumed*
    request (F8). The **currency** half is deliberately not compared; the
    invariant that replaces it is pinned by R26.
11. The pipeline is resumable and idempotent: every step skipped when the mirror
    records it done (R10, R16), and a retry after a mid-pipeline failure
    completes without duplicating a Stripe object (R11).
12. The mapper emits exactly ten keys, never `sentAt` and never
    `lastPaymentFailedAt`, converts epoch seconds to ISO-with-milliseconds, and
    maps an `invoice.paid` event's `data.object` identically — AS-44's reuse
    proven before AS-44 exists (R1).
13. `sentAt` is written from our own clock at the moment `/send` returned, by
    nothing else, and **survives a later snapshot** — the AS-44 interaction the
    §3.6 exclusion exists for (R14, R15, R23; proven by breaking it, F4).
14. This task writes only `draft` and `open`; `paid`, `void`, `uncollectible`
    and `lastPaymentFailedAt` appear nowhere in the diff as values written
    (§3.10) — grep, plus R6/R14/R15's mirror assertions.
15. VERIFICATION (from the task description, verbatim): "request shapes
    validated against stripe-mock; sequencing, the readiness gate, and mirror
    persistence unit-tested against fixture responses."
16. The named residual is restated in the review comment, not resolved: real
    state transitions and the client-facing email are not observable against
    stripe-mock; no Stripe account exists, none was opened, no board ask filed.
17. **The diff touches no file outside §2's list.** `git diff master...` shows
    zero changes to `lib/stripe/custody.js` (no allowlist row added),
    `lib/stripe/client.js`, `lib/stripe/transport.js`, `lib/db/**`,
    `lib/config.js`, `routes/connect.js`, `server.js`, `test/helpers/server.js`,
    `compose.yaml`, `Dockerfile`, `package.json`, `package-lock.json`.
18. The offline suite passes in the `test` service (`network_mode: none`, M-cases
    reported as **skipped** — never as passed), and the full suite including
    M1–M3 passes in the `contract` service; V1's instrument check runs in both
    directions (green normally, red with `ASC_SELFTEST_MUTATE=1`).
19. Every §5.4 literal lands in the same commit as the change that moves it; the
    suite is green with zero unexplained skips beyond the mock gate.
20. Falsification recipes F1–F7 executed per §7, with each predicted set observed
    **or its divergence recorded as a finding**; evidence (commands, assert-applied
    greps, failing test names and counts) recorded in a Lattice comment on AS-43
    before review is requested.

## §7 Falsification recipes (run in the task worktree; backups OUTSIDE apps/invoicing/)

House rules: back up to `${TMPDIR:-/tmp}/as43-falsify/` (never inside
`apps/invoicing/`), `trap` the restore on EXIT, **assert the mutation applied**
(grep the mutant before running — an unapplied mutation looks exactly like a
passing guard), run the suite IN CONTAINER (`docker compose … run --rm test`),
observe the predicted failing set, restore, prove the tree with
`git -C <worktree> diff --exit-code`, then **rebuild the image and re-run green**.
Every `docker compose` invocation from the worktree, never the main checkout.

**On the predictions below.** AS-41's §7 was wrong in two of five predicted sets
and wrong in one rationale, and both misses turned on the same fact: *the custody
guard sits upstream of `requireKey` and of the transport*, so any mutation that
makes a call custody-illegal pre-empts every downstream expectation (a 502 from
Stripe, a 503 from a missing key) with a 500. Each prediction below is reasoned
through that pipeline explicitly. Where a set depends on how many cases the
implementer writes, it is stated as a **LOWER BOUND** and says so — a lower bound
observed exactly is a pass; a set NARROWER than a lower bound is a finding.
**A wrong prediction is never fixed by narrowing a test to match it.**

| # | Mutation (exact) | Assert applied | Predicted failing set |
|---|---|---|---|
| F1 | delete the two `AccountNotReadyError` throws in `lifecycle.js`'s gate (§3.4) | `grep -c "throw new AccountNotReadyError" lib/invoices/lifecycle.js` goes 2 → 0; `MUTANT-F1` marker = 1 | **EXACT {R7, R8}.** Both expect 403 AND zero transport calls; with the gate gone the pipeline runs against the fixture and answers 303, so both assertions fail in both tests. Nothing else touches the gate: every other finalize/send case seeds a ready account, and 403 is used by no other case. Reasoned through the pipeline: the gate is pure local state, upstream of the client, so none of the custody/`requireKey`/transport ordering effects apply. Dependency-policy stays green |
| F2 | in `lifecycle.js`, drop `account:` from the **finalize** call only, so a `connected` allowlist row is sent with no `Stripe-Account` | `grep -c "account:" lib/invoices/lifecycle.js` drops by exactly 1; the finalize call site shows no `account` | **[CORRECTED 2026-09-02, review cycle 1 — the original prediction was wrong in four memberships.]** **LOWER BOUND {R6, R9, R10, R11, R12, R13, R15, R22}** (observed at cycle-1 HEAD `42efa8a`, independently by implementer and reviewer; 8 fail, all reading `500 !== 303`). Mechanism, unchanged and confirmed: `checkScope` throws `missing_account` *before* `requireKey` and *before* the transport, so every case whose flow **actually executes the finalize call site** gets 500. The four corrections, all of which the original got wrong by reasoning as though the mutation applied to *every* call rather than to *the one call site it names* — the same class of error §7's preamble was written to avoid: **R14 stays green** (it sends from an already-`open` invoice and never reaches step 4); **R18 stays green at 503** (it dies at the FIRST call — create-customer, still custody-legal — on `requireKey`, and never reaches the mutated one); **R9 and R10 go red** (predicted green as "skip step 4", but only their SECOND action skips it — their first finalize runs the mutant). **Stays green:** R1–R5, R7, R8, R14, R16–R21. Dependency-policy stays green — `account:` is not a scanned concept |
| F3 | in `pushLineItems`, push each item TWICE **under the same idempotency key** (duplicate the loop body verbatim) | `MUTANT-F3` marker = 1 and the `/v1/invoiceitems` call site count goes 1 → 2 | **[CORRECTED 2026-09-02, review cycle 1 — the stated MECHANISM was falsified; this recipe does not reach the guard at all.]** **LOWER BOUND {R6, R9, R15, R22} offline; M1, M2, M3 UNAFFECTED.** The fixture transport models Stripe's idempotency window (it must, or R11's retry doubles the total and AC 11 becomes untestable), so a duplicate under the SAME key is absorbed: the totals do NOT diverge and §3.7's guard correctly does not fire. F3 is caught by the **exact call-count assertions only** — `1+1+N+1` becoming `1+1+2N+1` — which is still worth having, and is the reason to assert call counts exactly rather than loosely. **It is not a falsification of the reconciliation guard; F3b is.** The M-case asymmetry the original predicted IS confirmed: stripe-mock's `amount_due` is a constant that does not depend on what we pushed, so the mock is structurally incapable of catching a duplicated line item. If any M-case DOES go red under F3, the fixture constant has changed and M1's `MOCK_FIXTURE_AMOUNT_DUE` needs re-measuring |
| F3b | **the recipe that actually breaks the guard, promoted to standing 2026-09-02 (added independently by the implementer and the reviewer during cycle 1).** Duplicate the push under a **DIFFERENT** idempotency key (`ii-create-<id>-<dup>`) — the lapsed-window escape §3.7 names itself the backstop for | 2 markers; the distinct key suffix verified **in the built image**, not only on disk | **LOWER BOUND {R6, R9, R10, R11, R15, R22}** (observed at cycle-1 HEAD), failures reading `409 !== 303`. This is the recipe that shows the reconciliation guard FAILING rather than merely passing, which is what CLAUDE.md requires of a guard. Note it exercises the guard on the **first** request only — F8 is its resumed-path counterpart, and both are required |
| F4 | in `mapping.js`, add `sentAt: null` to the returned object (§3.6's forbidden key) | **[CORRECTED 2026-09-02, review cycle 1 — the assert-applied step as written can never hold.]** `grep -c "^ *sentAt:" lib/invoices/mapping.js` goes 0 → 1, plus a `MUTANT-F4` marker = 1. The original said `grep -c sentAt mapping.js` goes 0 → 1; the shipped file's baseline is **2** (two comment lines naming the forbidden key), so a reviewer following the step literally would abort a good recipe. Anchor the pattern to the object literal, and prefer a marker | **EXACT {R1, R23}.** R1 asserts the ten-key set literally and fails on cardinality. R23 is the case that proves *why* the key is excluded: a sent invoice receiving a later paid-snapshot has its `sentAt` erased, because `applyStripeSnapshot` writes every key present. R14/R15 stay **green**, and that is predicted rather than hoped: §3.8 mandates `{ ...invoiceSnapshotFromStripe(data), sentAt: now() }` — our observation spread LAST — so on the send path the mutant's `null` is overwritten in the same object literal and never reaches the database. If R14/R15 go red, the spread order was written backwards; that is a finding about the implementation, not about this prediction |
| F5 | in `lifecycle.js`, delete the `client.stripeCustomerId !== null` skip in step 1 | the skip condition = 0 hits; `MUTANT-F5` marker = 1 | **[CORRECTED 2026-09-02, review cycle 1 — mislabelled EXACT; it is a LOWER BOUND throughout.]** **LOWER BOUND {R9, R10, R11, R14, R16}** (observed at cycle-1 HEAD). R9 asserts zero `/v1/customers` calls for a client that already has one — it now sees one. R10 (double finalize), R16 (send when already sent), R11 (pins zero *second* `/v1/customers` on the retry) and R14 (pins an exact one-call list) all re-run step 1 and see a call where none was expected. R6/R15 stay green: their client starts without a `cus_`, so the skip never fired for them. Every "zero calls on a repeat" case is in the set by construction, which is why this can only ever be a lower bound |
| F6 | scratch copy of the worktree (never in place): `mv test/invoices.test.js test/invoices.test.js.bak` | `ls test/invoices.test.js` fails in the copy; the task worktree proven clean before and after | **EXACT: harness V2 only.** Message must read "expected exactly 12 test files, found 11: …" listing the eleven survivors. Proves the new file is load-bearing in the pinned list rather than decoration. Everything else stays green — the other files do not import it |
| F7 | in `test/dependency-policy.test.js`, revert the money-words allowed list to its pre-AS-43 four entries (§5.4 item 3) | the list has 4 entries, not 7 | **EXACT: the concept test only** — "money representation: found in [… 7 files …], allowed in exactly [… 4 …]". Proves the moved literal was *required*, not decorative, and names precisely which new files carry money words. Run the mirror direction too if any new file turns out money-word-free: adding it to the list must fail with the used-exemption message |
| F8 | **ADDED 2026-09-02, review cycle 1 — the recipe that proves the reworked guard is total. MANDATORY; the rework is not done without it.** In `lifecycle.js`, restore the cycle-1 defect: move the `reconcile()` call back inside `finalizeInvoice()` (equivalently, give the guard in `run()` step 4's skip predicate) so it fires only on the request that finalized | `MUTANT-F8` marker = 1; `grep -n reconcile lib/invoices/lifecycle.js` shows the call inside `finalizeInvoice`, none in `run()`; **confirmed in the built image**, not only on disk | **EXACT {R12} offline; M1, M2, M3 UNAFFECTED in contract.** R12 must go red *on its second request*: the retry answers 303 instead of 409 and its cumulative `/send` count goes 0 → 1. **Everything else stays green**, for two distinct reasons that must both be stated when this is run: (a) every other offline case makes exactly one issuing request, so it cannot distinguish the two placements; (b) **the M-cases are structurally incapable of catching this defect** — stripe-mock is stateless, so its finalize response leaves the mirror at `draft` (M1 pins this), and M3's retry therefore re-runs steps 3–4 and is refused by the *finalizing* path even with the mutation in. This is the same M-case asymmetry F3 has, arriving for the same reason, and it is the finding to record. **The narrowness is the whole point**: it is exactly why a green cycle-1 suite did not surface the defect. If R12 stays GREEN under F8, the retry assertion was not actually added and the rework has not been done. If an M-case goes RED, the mock's statelessness has changed and `MOCK_FIXTURE_AMOUNT_DUE` plus M1's `draft` assertion need re-measuring |

## §8 Size and complexity, against the milestone tripwires

**Projection:** 4 new + 4 modified = **8 files**, ≈ **1,220 insertions**
(≈ 520 source, ≈ 700 test/literals/README).

**This is more than double the description's "~550 lines including tests", and
the discrepancy is stated rather than absorbed.** That estimate was written at
AS-31 planning time, before AS-38/AS-39/AS-41 established this app's actual test
density; AS-41 projected 900 and landed 1,023 for a task with three Stripe calls,
no state machine and no money assertions. AS-43 has five calls, four routes, a
resumable pipeline, a reconciliation guard and a mapper AS-44 inherits. The
milestone plan's §8.2 line is therefore stale, not the task (§11 item 3).

Two §8.2 tripwires fire (>~600 lines; not the >~10-file one at 8), so the
required written justification: it is **one reviewable claim** — *a draft invoice
can be created, finalized and sent on the freelancer's own account, and nothing
else can happen to it* — whose scope is fixed verbatim by the description (rows
C-26, C-27, C-28); ≈ 60 of the lines are the mechanical literal-tax every task in
this app pays; and splitting draft from finalize/send would produce a first task
whose only verification is "rows exist", which is not a claim worth a review
cycle. Complexity: **medium**, as filed.

**Pre-agreed split line, decided now so nobody improvises mid-flight:** if the
implementation passes **~1,400 insertions**, or if the routes turn out to need
rendering or a session, the split is **M1–M3 (the mock-gated contract cases) plus
R11 (resumption) and R5 (the 25-item parser case) into a follow-up task** — the
offline suite alone still proves every AC except route-level spec validation,
which K2–K7 in `stripe-mock.test.js` already cover at the client level. The gate,
the five calls, the mapper, the freeze and the reconciliation (AC 1–14) are the
irreducible core and are never split.

## §9 Open questions — each with a default and a time-box

- **Q1 — should `resolveFreelancerId` move out of `routes/connect.js`?**
  Default: no. Two consumers is not duplication, and moving a file merged hours
  ago costs a diff in AS-41's proven surface for no behaviour change. Box: the
  **third** consumer — AS-42's contract routes. At that point extract to
  `lib/http/identity.js` in AS-42's diff, re-export from both routers, and let
  AS-40 delete all three call sites at once.
- **Q2 — should finalize pass `auto_advance: true` so Stripe's own reminder
  cadence runs?** Default: **no** — `false`, so the invoice is emailed exactly
  once, by our explicit `/send`. Reminders are OUT of v1 (C-39) and a second,
  Stripe-initiated email would make "who sent this" ambiguous at exactly the
  moment the board is watching. Box: **AS-50's acceptance run**, where email is
  observable for the first time; flipping it is one parameter on one call.
- **Q3 — is re-pushing line items on a retry safe enough without stored `ii_`
  ids?** Default: yes — stable per-item idempotency keys deduplicate inside
  Stripe's window, and §3.7's total check catches any escape. This **closes
  AS-39's Q5 with its stated default**. Box: reopens if AS-50 observes a
  duplicated line item, in which case the fix is AS-39's own suggestion — a
  `stripe_invoice_item_id` column by migration.
- **Q4 — what should happen to an invoice whose totals disagree (§3.7)?**
  Default: refuse the send, record the snapshot, and leave resolution to the
  freelancer in their own Stripe Dashboard. Voiding from our side needs a new
  allowlist row and is a separate, deliberate task. Box: AS-48's planning stage
  (the detail screen must render this state) or the first real occurrence,
  whichever comes first.
- **Q5 — does `POST /v1/invoices/{id}/send` on an already-sent invoice re-email
  the client?** Default: assume yes, and never find out in production — step 5
  is a no-op once `sentAt` is recorded, and carries an idempotency key besides.
  Box: AS-50; if send turns out to be naturally idempotent, C-40 (manual
  re-send) becomes cheaper for a later milestone, which is information worth
  having but changes nothing in v1.

## §10 Proposed wording for metawork-owned files

None. This task changes no operating convention: no `CLAUDE.md`, root
`README.md`, `PHILOSOPHY.md` or `agents.md` wording is needed or proposed.
(`apps/invoicing/README.md` is app documentation, employee-owned, edited in-scope
per §5.2.)

## §11 Stale or wrong items found while planning (flags, not edits)

1. **AS-39 plan §8 Q5** ("Store Stripe invoice-item ids (`ii_`) per line item?
   … Closes with AS-43's plan") is hereby **closed with its default**: not
   stored, no migration, because per-item idempotency keys plus the §3.7 total
   check do the work the ids were reserved for. Recorded here because AS-39's
   plan says its box closes here.
2. **An asymmetry in AS-39's repository contract**, found by reading rather than
   by failure: `clients.setStripeCustomerId` is a **no-op** when handed the id it
   already holds, while `invoices.attachStripeInvoice` **throws** for the same
   id. Both are set-once, and the difference is invisible until a retry.
   §3.8 handles it in the service and this task deliberately does not change
   AS-39's shipped contract mid-fan. Flagged for whoever revisits the
   repositories (a same-id no-op on `attachStripeInvoice` would be a one-line
   change plus a `repositories.test.js` case).
3. **`docs/engineering/00-d1-v1-milestone-plan.md` §8.2** states "AS-43 projects
   ~550 lines — under the threshold, kept whole as one claim." The line count is
   stale by roughly a factor of two (§8); the *conclusion* — kept whole as one
   claim — still holds, now on a written justification rather than on being under
   the threshold. Flagged for the milestone plan's next amendment pass; not
   edited here, because a plan commit should not carry a docs edit.
4. **The D1 spike's flow diagram** (`docs/strategy/spikes/spike-D1-freelancer-invoicing.md`
   §1) shows `/v1/invoiceitems` before `/v1/invoices` and does not mention
   `unit_amount` at all — the spike measured that the *primitives exist*, not the
   parameter set. Both facts were re-measured while planning (preamble) and
   §3.5 diverges from the diagram with reasons. The spike is a signed record of
   a decision and is **not** edited; this plan is where the divergence lives.
5. **`docs/design/wireframes/01-screens.md` §1** still marks screen 4's and
   screen 5's routes "provisional — final routes owned by AS-45..48". After this
   task, `/invoices/{id}` and `/invoices/{id}/edit` are load-bearing in a shipped
   `Location` header, exactly as AS-41 did to screen 2's return/refresh paths
   (AS-41 §11 item 1 made the same flag). AS-46's and AS-48's planners should
   treat those two paths as settled unless they want to change this task's
   redirects too.

---

### Correction applied to AS-41's plan §7 (recorded here for the audit trail)

`.lattice/plans/task_01M1D34NAX4QTQ3HMJ7P5EBGK9.md` §7 has been corrected in
place, per Priya's AS-41 review comment ("CORRECTED §7 TEXT for the tech lead to
apply"): F1's predicted set becomes {R3, R10, R11, R12} with the
guard-precedes-`requireKey` note, F2's becomes {R1, R3, R6} with the corrected
rationale (R6 trips on the due-list mapping, not on `ready`), and F6/F7 are added
as standing recipes for the concept row. The corrections are marked as
post-review corrections, not silently rewritten: a plan whose predictions are
quietly fixed teaches the next planner that predictions are cheap. This plan's §7
inherits the lesson explicitly.

## Reset 2026-09-02 by agent:cto-owen

---

## Review Cycle 1 Findings

Written by `agent:cto-owen` (tech lead), 2026-09-02, from `agent:qa-ruben`'s
review comment (`--role review`) on AS-43. Verdict: **implementation-level rework
needed**, 1 defect, 19 of 20 acceptance criteria met. Cycle 1 of 3. The
implementer for this cycle should read **this section first**, then §3.7 and §3.8
as reworked above.

**Scope of this section:** the blocking defect and the ruling it needed, the
plan text I corrected in place, and the boundary of the rework. It is not a
re-plan — the approach stands, and QA's routing (implementation-level, not
plan-level) is right.

### 1. The blocking defect — AC 10. The guard fires once, then stops existing

**The reconciliation guard is unreachable on the resumed path, so a second
request sends an invoice whose total we already know disagrees with our line
items.**

Reproduce, through the real routes over real HTTP, with the fixture returning
`amount_due = totalMinor + 1` on finalize (QA's probe, in a scratch copy):

```
POST /invoices/{id}/send?freelancer=F   -> 409  "AmountMismatchError: reconcile"
    /v1/invoices/{id}/send calls = 0                 correct — the guard fired
    mirror: status=open amountDueMinor=10001 totalMinor=10000 sentAt=null

POST /invoices/{id}/send?freelancer=F   -> 303      <-- THE DEFECT
    /v1/invoices/{id}/send calls = 1                 THE CLIENT IS EMAILED
    mirror: sentAt=2026-09-02T10:40:30.871Z amountDueMinor=10001 totalMinor=10000

POST /invoices/{id}/finalize?freelancer=F -> 303    <-- also not re-checked
```

**Mechanism.** §3.7's decided order writes the snapshot (`open`) *before*
refusing — which is correct and stays. But `reconcile()` was reachable only from
inside `finalizeInvoice()` (`lifecycle.js:244`), and on the next request
`run()` sees `invoice.status === 'open'` and skips steps 3 and 4. Step 5's only
precondition is `invoice.sentAt === null` (`lifecycle.js:311`). So the guard
fires exactly once per invoice and then stops existing for it.

**Why it blocks.** §3.2 specifies that AS-46's single "Finalize & send" control
posts to `…/send`, and §3.5 names re-submitting the form as *the* user-visible
retry. The shipped flow is therefore: click → 409 error page → click again →
Stripe emails the client an invoice whose amount we have already recorded as
wrong. One click, on the money path, defeating the one guard this task
introduces.

**Why a green suite did not catch it: R12 and M3 stop one request short.** They
assert the first refusal and never retry. The same gap existed in the code and in
the tests, which is the honest reason this shipped.

**My share of this.** The plan contributed and the record should say so. §3.7
said the comparison happens "after a successful finalize, and **before any
send**" — the intent — while §3.8's pipeline diagram placed `reconcile` inside
step 4, sharing step 4's skip predicate, which cannot honour that intent on a
request that skips step 4. The two disagreed and the implementer followed the
diagram, which is the reasonable thing to do with a diagram. That is a fourth
plan self-contradiction on top of QA's Finding 3, and it is mine. I still concur
with the implementation-level routing: the approach is sound and the fix is a
placement change in one function, not a re-plan.

### 2. The ruling QA escalated — the currency half of the comparison

QA established that the amount half is rebuildable from the mirror
(`amountDueMinor` and `totalMinor` are both on the row) but the currency half is
not: the mapper emits no `currency` key and `SNAPSHOT_COLUMNS` has no currency
column, so after a resume there is nothing to compare a currency against. He
correctly routed it here rather than improvising a schema change mid-rework.

**Decision: drop the currency comparison. Do not add a column. The full ruling,
with the reasoning and the three things that now carry the weight, is written
into §3.7 above — read it there; it is the design constraint the fix must
satisfy, not a footnote.** In brief:

- **Chosen:** one guard, mirror-based, amount-only, evaluated in `run()` on both
  routes and every path. Uniform: one predicate, one place, one statement of what
  is guaranteed.
- **Rejected — a `stripe_currency` column on the invoice mirror.** It is an AS-39
  schema change, and under AS-39's migration discipline (migrations are new
  files, never edits; the schema is not split) it needs a **new migration file**,
  `SCHEMA_VERSION` 1→2, three literals in `repositories/invoices.js`, an eleventh
  key in the mapper AS-44 inherits, and moved literals in `repositories.test.js`
  and `db.test.js`. It breaks AC 17 and §2's file scope, both of which QA
  verified as met. **A rework cycle must not quietly become a schema change**,
  and least of all on the one table AS-44 is about to start writing. If the
  currency half ever *is* needed, that column is the right answer — as its own
  task, planned, with its own migration, not smuggled in here.
- **Also rejected — `GET /v1/invoices/{id}` on the resumed path** to re-derive
  both halves fresh. It is already on AS-38's allowlist, so it would cost no
  custody change and no migration — but it breaks the "five POSTs, zero GETs"
  property AC 3 pins and R6/R15's exact call-count literals encode; it adds a
  network round trip and a new failure mode (the GET fails → 502 on a send that
  would otherwise be correct) to a question local state can answer; and it is
  *weaker* where it matters, because it verifies Stripe against our line items
  but not our own mirror against them. Paying a round trip for a comparison that
  is not load-bearing is worse than paying a column for it, and I am not paying
  either.
- **Why dropping is safe, in one line:** `SUPPORTED_CURRENCIES` has exactly one
  member, we send that currency explicitly on calls 2 and 3, and Stripe rejects
  an item whose currency differs from its invoice's — so "ours" and "theirs" are
  the same constant. **What now carries the weight:** `lib/db/money.js`'s
  one-member set, **pinned by R26** so the day it grows, a test goes red naming
  this ruling; R6's exact-body assertions on the explicit `currency` parameter;
  and one **named assumption** — that Stripe echoes an explicitly-sent currency —
  routed to AS-50's acceptance run, which should record the real response's
  `currency` alongside its `amount_due`.

### 3. What the fix must include beyond the code change

The code change alone is small. **These are not optional; a fix whose test stops
at the same request the old tests did is not a fix.**

1. **`reconcile()` moves out of `finalizeInvoice()` into `run()`**, after the
   `if (invoice.status === 'draft')` block, before the `through === 'send'`
   branch, with **no predicate of its own** (§3.7, §3.8). `finalizeInvoice()`
   keeps writing the snapshot first and returning the updated row — that order is
   unchanged and still decided.
2. **The predicate becomes `invoice.amountDueMinor === invoice.totalMinor`** on
   the mirror row. `AmountMismatchError`'s payload loses `theirs.currency` (there
   is no such value to report); **`step` stays `'reconcile'` and the route body
   stays byte-identical** — `AmountMismatchError: reconcile\n` — so R12's and
   M3's body assertions do not move.
3. **R12 extended** to retry: second `POST …/send` → 409, cumulative `/send`
   calls still 0, `sentAt` still null; and `POST …/finalize` on the same invoice
   → 409, not 303. Its **currency sub-case is deleted** per the ruling.
4. **M3 extended** the same way, **and honestly labelled**: because stripe-mock
   is stateless its mirror stays at `draft`, so M3's second request re-runs
   steps 3–4 and is refused by the *finalizing* path, not the resumed-skip path.
   It proves the refusal is stable across requests against a spec-shaped
   response; it does not cover the defect. **R12 is the load-bearing case and M3
   must not be allowed to stand in for it.** (I got this wrong in my first draft
   of F8 and caught it by reasoning it through the pipeline — which is the whole
   discipline §7's preamble asks for. Recorded so the next reader sees the trap
   rather than only the answer.)
5. **The false-positive direction, which is the one nobody remembers:** the new
   guard runs on *every* resumed send, so prove it does **not** block a good one.
   R11's resumption (finalize succeeded, send failed, retry) must still reach
   exactly one `/send` call and 303. If R11 does not already cover the
   resumed-send shape end to end, widen it until it does.
6. **F8 (§7), mandatory** — restore the defect as a mutation and observe **R12,
   and only R12**, go red on its second request (the M-cases cannot catch it; see
   item 4 and F8's own row). A guard seen only passing has proven nothing, and
   this guard has already been shipped once in a form that only ever passed. If
   R12 stays green under F8, item 3 was not really done.
7. **R24, R25, R26 added** (§5.3) — the two route-level taxonomy cases QA's
   Finding 5 named, and the currency-invariant pin the ruling rests on.
8. **Falsification re-runs: F1, F2, F3, F3b, F5, F8 only.** Those mutate
   `lifecycle.js`, which this cycle moves. F4 (`mapping.js`), F6 (test-file
   presence) and F7 (dependency-policy literal) are untouched by the rework and
   need not be re-run — that is a deliberate time-box, not an omission. The
   corrected sets in §7 are **observations at cycle-1 HEAD (`42efa8a`)**, not
   fresh predictions: re-derive them after the rework and **record any divergence
   as a finding**, exactly as QA did. Do not narrow a test to match a set.

### 4. Convention findings, and what I corrected in the plan in place

QA's Findings 2, 3 and 5 are convention records routed to me. **I have applied
the corrections to the plan text in place, marked as post-review corrections
rather than silently rewritten** — the same handling this plan gave AS-41's §7,
and for the same reason: a plan whose predictions are quietly fixed teaches the
next planner that predictions are cheap.

Corrected in place (each carries an inline `[CORRECTED IN PLACE 2026-09-02]`
marker at the site):

- **§7 F2** — predicted set was wrong in four memberships. Corrected to
  `{R6, R9, R10, R11, R12, R13, R15, R22}` with the corrected rationale: the
  mutation applies to *one call site*, so R14 (never reaches step 4) and R18
  (dies at the first call on `requireKey`) stay green, while R9 and R10 go red
  because only their *second* action skips step 4. F2 repeated the exact class of
  error §7's own preamble was written to avoid.
- **§7 F3** — the stated *mechanism* was falsified. The fixture models Stripe's
  idempotency window (it must, or R11 is untestable), so a duplicate under the
  same key is absorbed and the guard never fires. Corrected set
  `{R6, R9, R15, R22}`, caught by call-count assertions only. **F3b promoted to a
  standing recipe** — duplicating under a *different* key is what actually
  reaches the guard, and both the implementer and the reviewer independently
  added it, which is a strong signal it was missing.
- **§7 F4** — the assert-applied step was unrunnable: `grep -c sentAt
  mapping.js` has a baseline of 2 (comment lines), not 0, so a reviewer following
  it literally would abort a good recipe. Anchored to the object literal plus a
  marker.
- **§7 F5** — mislabelled `EXACT`; it is a lower bound throughout. Corrected to
  `{R9, R10, R11, R14, R16}`.
- **§3.5** — the "plus `quantity` for display" prose contradicted the Params
  column, R6 and AC 3. The table wins; `quantity` is local-only and not sent.
- **§3.1** — "Both files get a one-line comment" contradicted §2 and AC 17 for
  `routes/connect.js`. AC 17 wins; both comments live in `routes/invoices.js`.
- **§3.3** — R5's stated rationale was stale. body-parser 2.x sets `qs`'s
  `arrayLimit` to `Math.max(100, <request parameter count>)`, a threshold that
  moves with the request; 25 items arrive as a dense array and the object branch
  is reachable only above ~100, i.e. always a refusal at `MAX_LINE_ITEMS = 50`.
  Both branches stay — a limit derived from request size is a stronger reason not
  to depend on it. The requirement survived; only the reasoning was wrong.
- **§3.2, §3.7, §3.8, §5.3 (R12, M3, +R24–R26), §6 AC 10** — reworked for the
  ruling and the guard's placement, as described above.

QA's **Finding 4** (size: 1,844 changed lines against the ~1,400 pre-agreed split
line) needs no action — already ruled "not splitting", and QA independently
derived the number and concurred. QA's **§5** note on restore proofs (a content
hash plus `git status --porcelain` catches a stray extra file, which byte
comparison against a backup does not) is a defect in the *house recipe template*
and stays routed to the metawork layer, not fixed inside this task.

### 5. Explicitly NOT in scope for this cycle

The rework is a guard placement, its tests, and the three added cases. It must
not grow. Out of scope, each for a stated reason:

- **Any schema change, any migration, any edit under `lib/db/**`** — that is the
  ruling in §2 above, not an oversight. `SCHEMA_VERSION` stays 1, `MIGRATIONS`
  stays one row. **AC 17 and §2's file-level scope stand unchanged and get
  re-verified.**
- **`GET /v1/invoices/{id}`** — rejected above. Five POSTs, zero GETs stands; no
  allowlist row, no `custody.js` edit.
- **The mapper's ten-key set** — unchanged. AS-44's handoff contract does not
  move in a rework cycle.
- **Voiding, refunding, or cleaning up a mismatched invoice from our side** —
  §9 Q4's default stands: refuse the send, record the snapshot, leave resolution
  to the freelancer in their own Stripe Dashboard.
- **`auto_advance`** — §9 Q2 stays boxed to AS-50.
- **Re-litigating the split** (§8) — ruled; the plan's backstop stands as
  written: if review reaches cycle 2 *on scope grounds*, §8's split line applies.
- **The falsification-recipe template defect** — routed to the metawork layer.
- **The 238 dangling docker images the implementer observed** — a real
  housekeeping backlog and a candidate for its own small task; not this one, and
  not to be tidied inside it.
- **Anything in `apps/` outside `apps/invoicing/`, and every protected top-level
  markdown file** — unchanged, as in cycle 1.
