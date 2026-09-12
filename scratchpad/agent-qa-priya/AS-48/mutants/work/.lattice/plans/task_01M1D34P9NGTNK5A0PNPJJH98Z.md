# AS-49: D1 v1: automated end-to-end loop verification on local compose

Plan by agent:cto-owen (tech lead), 2026-09-12, tick watcher:79108 loop tick 8, on Opus under
the Fable fallback. Complexity: medium (three-stage path). Implements milestone plan
`docs/engineering/00-d1-v1-milestone-plan.md` §3 row C-05 / §6.1 — the deterministic half of
v1's definition of done; AS-50 (board-gated) is the other half.

## 1. What this task is, in one paragraph

One new test file drives the product's real HTTP API through the whole Rule-1 chain — sign up,
connect an account, become ready, add a client, generate a contract, draft an invoice, finalize,
send, get paid, survive a redelivery and an out-of-order event — inside the `test` compose
service, which has `network_mode: none`, no volumes and no environment. The Stripe side of every
one of those steps is a **stateful double** we write: a transport function that sits at the
seam AS-38 built for exactly this (`createStripeClient({ transport })`), so the real client
pipeline — custody guard included — runs on every call, while the double holds account, customer,
invoice-item and invoice state, transitions invoices on finalize and pay, models Stripe's
idempotency window, and **signs** webhook events with the documented HMAC scheme so the app's real
receiver verifies them. The test delivers those signed bytes to the app's own `/webhooks/stripe`
over loopback. The honest claim (§2) is stated in three places and pinned in one.

## 2. The honest claim — wording the README, the double and the test must carry

Verbatim, as the exported constant `STRIPE_DOUBLE_CLAIM` in `test/helpers/stripe-double.js`,
quoted in the header comment of `test/e2e-loop.test.js`, and in `apps/invoicing/README.md`
§ "The suite" (new subsection, §5):

> This suite proves that OUR half of the loop is correct against OUR MODEL of Stripe. The
> model — `test/helpers/stripe-double.js` — was written by us from Stripe's documentation and
> from the stripe-mock fixtures; it holds state the way we believe Stripe does and signs events
> the way Stripe documents. A green run means: every step of the chain, driven over the app's
> real HTTP API, behaves as designed **when Stripe behaves as we assume**. It does not mean
> Stripe behaves that way. Two instruments, two claims, neither of them Stripe: stripe-mock
> (the `contract` service) validates the SHAPE of every request we send against Stripe's
> OpenAPI spec and answers with stateless fixtures; the double holds STATE and emits events, and
> validates nothing. The fidelity of the model is exactly what the recorded test-mode
> acceptance run (AS-50) exists to check, and nothing in this suite substitutes for it.

Every case title in the new file carries the label `(STRIPE DOUBLE)`; the one case that runs
only in the `contract` service carries `(STRIPE DOUBLE vs STRIPE-MOCK)`. A reader of a red line
in a compose log must never wonder which instrument produced it.

## 3. Design decisions, with the reasoning (what would have to be true)

**3.1 The double is a transport, injected in-process — it cannot be anything else.**
`lib/stripe/client.js` makes `baseUrl` an option, never configuration, on purpose (AS-38: an
env-settable base URL would send the secret key wherever the environment says). So the shipped
`web` container cannot be pointed at a double, and a separate "e2e" service driving `web` over
the compose network would need exactly the config knob AS-38 refused. The only seam is the
transport argument, which means the test boots the app in-process through
`test/helpers/server.js`'s `withServer(config, fn, { stripe })` — the same shipped bits, same
`createApp`, same migrations, loopback listener on port 0 — precisely as every existing
route suite and the AS-90 demo do. "On the local docker-compose stack" is satisfied by the
`test` service running the exact image: the e2e file ships in the image (Dockerfile `COPY
apps/invoicing/test ./test`) and runs mountless and network-blocked. No compose change, no
Dockerfile change, no app-source change (§4) — which is also what keeps this lane's seams with
AS-46/AS-47 to two files (§9).

**3.2 Distinct from stripe-mock, by construction and by name.** The double answers state
and never validates a request beyond reading the parameters it needs to compute (customer,
invoice, amount, currency). Shape validation stays where it is: `stripe-mock.test.js` K-cases
and the M-cases in `connect.test.js`/`invoices.test.js`, in the `contract` service. The
e2e file never reads `ASC_STRIPE_MOCK_URL` except in its one `contract`-only case (E5), and it
runs **unskipped and identically** in both services. E5 is the bridge: it asserts the double's
object shapes never carry a key stripe-mock's spec-derived fixtures lack, so the model can drift
from the spec only by omission, never by invention.

**3.3 The double signs with its own HMAC, not with anything under `lib/`.** The verifier
(`lib/webhooks/signature.js`) is the thing under test; a signer that shared its code would agree
with it by construction (the trap AS-44 plan §5.5 named and answered with a known-answer
vector). The double's signer is ~5 lines of `node:crypto` written from Stripe's documented
scheme, the way `demo/run.mjs` did it. Two clocks, stated: the **signature** `t` is real
`Date.now()` (it must sit inside the verifier's five-minute tolerance against the app's real
clock); **event data** timestamps (`created`, `status_transitions.*`, `due_date`) come from the
double's injectable model clock, so the test can assert `paidAt` against a committed ISO literal.

**3.4 The double models the idempotency window, and only that much of Stripe's retry
semantics.** A replayed `Idempotency-Key` returns the cached reply and creates nothing; a reply
produced by an injected failure is never cached. Lifted from `invoices.test.js`'s computing
fixture, because the resumable pipeline (AS-43 §3.8) leans on exactly that and a fixture without
it would model a Stripe that does not exist. The double also accumulates `amount_due` from the
items pushed to each invoice, so the reconciliation guard is testable in both directions.

**3.5 Delivery is the test's, not the double's.** The double returns `{ event, payload, header }`
— bytes and a `Stripe-Signature` — and never opens a socket. The e2e file's `deliver(base,
signed)` POSTs them to `/webhooks/stripe`. That split mirrors the real topology (Stripe signs;
the wire carries; we verify) and keeps the double free of `fetch`.

**3.6 What is reused from `demo/run.mjs`, and what is not.** Reused by COPY, never import: the
twelve-step order, the fixed values (freelancer, client, contract fields, `daysUntilDue` 30),
the form encodings of each request body, and the envelope shape. Not reused: the `expect`/
`Stopped` control flow (the demo holds no assertion by design), the `call`/`deliver` helpers,
the stripe-mock dependence (the demo's steps 3, 4, 9, 10 are `STRIPE-MOCK STAND-IN` and the
$10.00 amount is forced by the mock's constant fixture; the double lifts that constraint — E1
uses two line items totalling 12,500), and the PRINT region. `demo/README.md` says its planner
"lifts the SEQUENCE array"; this is that lift. No shared module: `dependency-policy.test.js`
item 5 forbids app source importing `demo/`, the demo imports nothing from `test/`, and a
demo↔test coupling would make the board's narrated artifact hostage to a test refactor.
`demo/run.mjs` is not modified by this task.

**3.7 "Network unavailable" is enforced three ways, and proven by a red.** (i) The `test`
service's `network_mode: none`, pinned by `deploy-shape.test.js`; the e2e cases run there
unskipped, so the `test` receipt IS the offline proof. (ii) Every recorded call's `url.origin`
is asserted equal to `https://api.stripe.com` — the client was built with the DEFAULT base URL,
and the double sits at the transport seam; nothing was pointed anywhere. (iii) The recipe F-NET
(§7) delegates one endpoint of the double to the real `fetchTransport` and observes the red
(`StripeTransportError: create-customer`, 502) in BOTH services — which proves at once that the
sandbox has no route out and that the suite would notice a real call.

**3.8 API only, Location headers pinned, never dereferenced.** Per the task description and the
AS-43/AS-65 idiom ("the Location header is the contract, asserted without dereferencing it").
AS-46/AS-47/AS-48 own what those paths render; this task asserts the path shape and stops. When
AS-46 merges (§9) the pins are re-checked against the merged route table at rebase.

**3.9 The existing per-suite fixture transports stay.** `connect.test.js` and
`invoices.test.js` each carry a fixture with `intercept` hooks tuned to their R-cases. Replacing
them would widen this diff into two suites that AS-46 and AS-47 already touch. The double is a
new module descended from the invoices fixture; convergence is a separate, small task if a
third suite ever wants one (§10 Q1).

## 4. Key files

Created:
- `apps/invoicing/test/helpers/stripe-double.js` (≤ 450 lines). Exports
  `createStripeDouble({ webhookSecret, now })` → `{ transport, calls, state, completeOnboarding,
  pay, failNext, events, STRIPE_DOUBLE_CLAIM }` (see §6), plus the `STRIPE_DOUBLE_CLAIM` named
  export. Under `test/`, so it is unscanned by the dependency policy and ships in the image.
- `apps/invoicing/test/e2e-loop.test.js` (≤ 800 lines). Cases E0–E5 (§6).

Modified:
- `apps/invoicing/test/harness.test.js` — `EXPECTED_TEST_FILES` gains `'e2e-loop.test.js'`
  (sorted position: between `deploy-shape.test.js` and `harness.test.js`) and the V2 literal
  17 → 18. The two-line change the file's own comment prescribes.
- `apps/invoicing/README.md` — new subsection under "## The suite", after "### The contract
  half (stripe-mock)": "### The loop half (the stateful double)" — the §2 claim verbatim, the
  two-instrument table, and the F-NET one-liner as the way to prove the sandbox is still
  offline. Also, in "### The contract half": the sentence "spelled in exactly three mock-gated
  test files" becomes **four**, naming `e2e-loop.test.js` (E5 uses the identical
  `sk_test_stripemock` literal so the one-grep property holds; no test pins the count — checked
  2026-09-12 — the README sentence is the only record).

NOT modified (deliberately, and asserted by the unchanged guards): anything under `lib/`,
`routes/`, `views/`, `public/`; `app.js`, `server.js`; `compose.yaml`, `Dockerfile`;
`test/dependency-policy.test.js` (52 source files, 3 manifests, `VIEW_START_TAGS`, all
unchanged); `demo/*`; `test/auth.test.js` (1,197 lines — three lines from the 1,200 cap; AS-46
and AS-47 both shrink it, this task does not touch it); the per-suite fixtures (§3.9).

## 5. The double, in detail (`test/helpers/stripe-double.js`)

State: `accounts: Map<acct_, account>`, `customers: Map<cus_, customer>`, `items: Map<ii_,
item>`, `invoices: Map<in_, invoice>`, `replays: Map<idempotencyKey, reply>`, `calls: []`
(every wire request: method, path, query, body, headers, url), `eventSeq` (evt ids).

Endpoint table — exactly the nine rows of `lib/stripe/custody.js` `ALLOWED_ENDPOINTS`, keyed
`METHOD path-pattern`, and E0 asserts the two tables are the same set:
- `POST /v1/accounts` → new `acct_dbl<N>`, NOT ready (`charges_enabled:false,
  details_submitted:false, payouts_enabled:false, requirements.currently_due:
  ['external_account','tos_acceptance.date']`). Refuses (`400`, Stripe error shape) if the body
  is non-empty — the bare POST is the custody-relevant shape (AS-41).
- `POST /v1/account_links` → `{ object:'account_link', url:'https://onboarding.stripe-double.test/<acct>' , created, expires_at }`; requires `account` to exist, else 400.
- `GET /v1/accounts/{id}` → the current account object (state, not a fixture).
- `POST /v1/customers` (connected) → new `cus_dbl<N>` bound to the `Stripe-Account` header.
- `POST /v1/invoices` (connected) → new `in_dbl<N>`, `status:'draft'`, `amount_due:0`,
  `amount_paid:0`, URLs null, `due_date: now + days_until_due*86400`, requires `customer` to exist.
- `POST /v1/invoiceitems` (connected) → new `ii_dbl<N>`; adds `amount` to the named invoice's
  running total; 400 if the invoice is not `draft`.
- `POST /v1/invoices/{id}/finalize` → `draft → open`, sets `hosted_invoice_url`,
  `invoice_pdf`, `status_transitions.finalized_at = now`; 400 if not draft (Stripe's rule).
- `POST /v1/invoices/{id}/send` → 400 unless `open`; marks `sent:true` internally; status
  unchanged (Stripe does not change status on send).
- `GET /v1/invoices/{id}` → the current object. (On the allowlist, unused by the app today.)
Every `Stripe-Account`-scoped object is stored under its account; a connected call naming an
account the double has not created is a 400 (`resource_missing` shape) — the double will not
invent state it was never told about.

Model transitions the app cannot cause (the "Stripe did something" half):
- `completeOnboarding(acct)` → flips the three booleans, clears requirements; returns the object.
- `pay(in_)` → 400-shaped throw unless `open`; `open → paid`, `amount_paid = amount_due`,
  `status_transitions.paid_at = now`.
- `failNth(method, path, n, reply)` → the n-th (1-based) matching call from now returns `reply`
  (default: a Stripe error body, status 502 `api_error`) and is NOT cached in `replays`. E2 uses
  `n = 2` so the first item lands and the retry has a cache hit to demonstrate.

Events are signed from the SNAPSHOT the double recorded at the moment of the transition —
never from an argument object, and never from the current state after later transitions —
because that is what a Stripe event carries (the object as it was when the event was created).
`events.accountUpdated(acct)` (snapshot at `completeOnboarding`), `events.invoiceFinalized(in_)`
(snapshot at finalize, so it still says `open` after `pay` — which is what makes AC-13's
out-of-order delivery honest), `events.invoiceSent(in_)`, `events.invoicePaid(in_)` →
`{ event, payload, header }`, where `event` is the envelope `{ id:'evt_dbl<N>', object:'event',
api_version:'2026-08-26.dahlia', created: modelNowAtTransition, type, data:{ object } }`,
`payload = JSON.stringify(event)`, `header = t=<realNow>,v1=<hex>`. `events.resign(event)`
re-signs an existing envelope with a fresh `t` (redelivery). A wrong secret
(`createStripeDouble({ webhookSecret: 'whsec_other' })`) is the F10b instrument mutant.

Clocks: `now` (model clock) defaults to a fixed epoch `1_789_000_000` advanced by 60 s per
transition, so `finalized_at`, `paid_at`, `created` are committed literals in the test; the
signature `t` is always real `Date.now()`.

The double does NOT: validate parameter shapes against the spec (stripe-mock's job); retry;
follow redirects; read any env var; open any socket; import anything from `lib/` except
`ALLOWED_ENDPOINTS` for E0's cardinality check (a read of the policy table, not of behaviour).

## 6. Cases and numbered acceptance criteria (M4: each property names its falsifier)

The file boots one app per case with `withServer(configFor({ webhookSecret: SECRET }), fn,
{ stripe: createStripeClient({ apiKey: KEY, transport: double.transport }) })` — `KEY` is the
non-key-shaped placeholder every offline suite uses. E1 is the loop; E2–E5 seed their starting
state through `repos` (the house pattern) so their red sets stay narrow (§7). A `step(n,
title)` helper prefixes every assertion message so a red names the step.

**E0 (STRIPE DOUBLE): the double's endpoint table is exactly the custody allowlist.**
AC-1. Cardinality first: the double's handled `METHOD path` set has 9 members and equals
`ALLOWED_ENDPOINTS`'s `{method, path}` set. Falsifier F-ALLOW.

**E1 (STRIPE DOUBLE): the loop, end to end, over the API — the twelve steps.**
AC-2. Sign up: `POST /signup` → 303, `Location: /`, `Set-Cookie` carries the session cookie
(HttpOnly; SameSite=Lax); `GET /` with the cookie → 200; without → 303 `/signin`. Falsifier F1.
AC-3. Connect start: `POST /connect-stripe/start` → 303 to the double's link URL; the double
holds exactly 1 account, not ready; the app's `connected_accounts` row exists with that `acct_`
and `ready:false`; the two calls were platform-scope (no `stripe-account` header). Falsifier F2.
AC-4. Return, not trusted: `GET /connect-stripe/return` → 303 `/connect-stripe`; the double
recorded one `GET /v1/accounts/{id}`; the row is still `ready:false` (the double has not
completed onboarding). Falsifier: F3 does not cover this; covered by connect.test.js R6/F4 —
stated as a floor check, not a property of this task.
AC-5. Readiness by push: `double.completeOnboarding(acct)`; deliver `events.accountUpdated` →
200 `ok: readiness`; row `ready:true`, `syncedAt` equals the event's `created` as ISO (the
committed literal). Then readiness by pull agrees: a second `GET /connect-stripe/return` → 303,
row still ready, and the double's `GET /v1/accounts/{id}` count is 2. One model, two paths.
Falsifier F3 (push half).
AC-6. Client: `POST /clients` with `next=/` → 303 `Location: /?clientId=<id>`; row exists.
AC-7. Contract: `POST /contracts` → 303 `Location: /contracts/<id>`; the stored
`renderedHtml` contains the client's name once and the project description once (occurrence
counts, the screens.test.js convention). Falsifier F4.
AC-8. Draft: `POST /invoices` with two line items (2×5000 + 1×2500 = 12,500 usd, 30 days) →
303 `Location: /invoices/<id>/edit`; the double recorded ZERO calls for this step; mirror
`status:'draft'`, `stripeInvoiceId:null`. Falsifier F5.
AC-9. Finalize: `POST /invoices/<id>/finalize` → 303 `Location: /invoices/<id>`; the double
recorded exactly, in order: `POST /v1/customers`, `POST /v1/invoices`, `POST /v1/invoiceitems`
×2, `POST /v1/invoices/{id}/finalize`, every one carrying `stripe-account: <acct>`; the double
holds 1 customer, 1 invoice (`open`, `amount_due` 12500), 2 items; the mirror row is `open`,
`amountDueMinor` 12500 = `totalMinor`, `hostedInvoiceUrl` non-null, `finalizedAt` equals the
committed literal, `sentAt:null`, `paidAt:null`. Falsifiers F6, F11.
AC-10. Send: `POST /invoices/<id>/send` → 303; the double recorded EXACTLY ONE call for this
step, `POST /v1/invoices/{id}/send` (the mirror was `open`, so steps 3–4 were skipped — the
assertion stripe-mock structurally cannot make, invoices.test.js M2's residual); mirror `sentAt`
non-null and ≥ a timestamp taken before the request (ours, not the model's). Then
`events.invoiceSent` delivered → 200 `ok: fields`; `sentAt` UNCHANGED (the mirror's earlier
record stands — receiver.js's second-writer rule). Falsifier F7.
AC-11. Paid: `double.pay(in_)`; deliver `events.invoicePaid` → 200 `ok: applied`; mirror
`status:'paid'`, `amountPaidMinor` 12500, `paidAt` equals the committed literal; one row in
`stripe_events` for that id. Falsifier F8.
AC-12. Redelivery: `events.resign(paidEvent)` delivered → 200 `ok: duplicate`; the mirror row
is `deepEqual` to the row read after AC-11 (every column, `updatedAt` included); `stripe_events`
still has one row for that id. Falsifier F9.
AC-13. Out of order: `events.invoiceFinalized(in_)` delivered AFTER paid (the double builds it
from a snapshot it kept of the `open` state) → 200 `ok: stale`; mirror still `paid`. Falsifier
F12.
AC-14. The whole run: the double recorded exactly 10 calls (1+1+2+1+1+2+1+1 in the order above);
every call's `url.origin` is `https://api.stripe.com`; no call's body or query carries a key
whose bracket-segment is in `FORBIDDEN_PARAMS` (read from custody.js as data — the wire bytes
say what the guard let through); the 4 platform calls (accounts, account_links, the two account
reads) carry no `stripe-account`, the 6 connected calls carry the one `acct_`. Falsifiers
F-NET (origin/offline), F11 (custody).

**E2 (STRIPE DOUBLE): a transient Stripe failure mid-finalize resumes without duplicates.**
AC-15. Seeded ready freelancer + client + draft (2 items). `double.failNth('POST',
'/v1/invoiceitems', 2)`. First `POST …/finalize` → 502, body `StripeApiError: push-line-item`;
mirror `draft` with `stripeInvoiceId` attached; the double holds 1 customer, 1 invoice, 1 item
(the second push failed). Second `POST …/finalize` → 303; the double recorded exactly 3 calls
for it (items ×2, finalize — no customer or invoice create: the mirror already records both)
and holds 1 customer, 1 invoice, 2 items — the first item's replay hit the idempotency cache
(`replays` hit count 1, asserted), the failed one was retried for real — `open`, `amount_due`
12500; mirror `open`, 12500. The lifecycle's resumable pipeline, proven against state rather
than a constant. Falsifiers F6, F11, and the double-side F-REPLAY.

**E3 (STRIPE DOUBLE): a tampered signature is refused and applies nothing; the untampered one
applies.** AC-16. Seeded `open` invoice attached to the double (via a real finalize).
`events.invoicePaid` with one hex character of `v1` flipped → 400 `SignatureError:
verify-signature`; mirror still `open`; zero `stripe_events` rows. A double built with
`whsec_other` → its `invoicePaid` → 400. Then the correctly signed event → 200 `ok: applied`,
`paid`. Falsifiers F10, F10b, F8.

**E4 (STRIPE DOUBLE): the readiness gate holds inside the loop.** AC-17. Seeded freelancer with a
double-created account (NOT ready) + client + draft. `POST …/finalize` → 403
`AccountNotReadyError: not-ready`; the double recorded ZERO connected-scope calls. Deliver
`events.accountUpdated` after `completeOnboarding` → `ok: readiness`. `POST …/finalize` → 303,
`open`. Falsifiers F3, F6.

**E5 (STRIPE DOUBLE vs STRIPE-MOCK) — `{ skip: SKIP }` unless `ASC_STRIPE_MOCK_URL` is set.**
AC-18. Through the real client and real transport (keyed with the identical `sk_test_stripemock`
literal the three existing mock-gated files use, and the same not-`stripe.com` hostname
refusal), POST one `account`, one `customer`, one `invoice` to stripe-mock (the K-case shapes)
and take the response key sets. For each, the
double's corresponding object's top-level key set is a SUBSET; the double's
`status_transitions` key set is a subset of the mock's; `status` values the double ever emits ⊆
`{draft, open, paid}`. Cardinality first: the mock's invoice fixture has ≥ 30 keys (a number
the implementer commits after measuring, in the assertion message). Falsifier F-SHAPE.

**Documentation criteria (not mechanisms, so no red is required — reviewer greps):**
AC-19. `STRIPE_DOUBLE_CLAIM` in the double, the e2e file header, and README § "The loop half"
carry the §2 text verbatim (`grep -c "OUR MODEL of Stripe"` = 1 in each of the three files).
AC-20. Every e2e case title contains `(STRIPE DOUBLE` (grep count = 6).
AC-21. `harness.test.js` lists 18 files; `dependency-policy.test.js` is byte-identical to
master's (`git diff master -- test/dependency-policy.test.js` empty) — the zero-app-source
property, visible.

## 7. Mutation recipes (one indivisible step each: back up, `trap` restore on EXIT, mutate,
ASSERT APPLIED at the intended site with `grep -c`, run with `--build`, record the exact red
set, restore, `git diff --exit-code`, rebuild, re-run green)

Run each from the AS-49 worktree under `-p asc-as49-mut`. "Red set" is the e2e cases predicted
red; the owning suite's reds are listed where I can name them and the implementer records the
exact set — a wider or narrower set than predicted is a finding, not a footnote.

| # | Site (anchor must be unique in the file — `grep -c` = 1 before and after) | Edit | Predicted red |
|---|---|---|---|
| F1 | `routes/auth.js` `router.post('/signup', form, enter('sign-up', (body) => accounts.signUp({` | `signUp` → `signIn` | E1 (step 1). auth.test.js sign-up cases (record). |
| F2 | `lib/connect/onboarding.js` `repos.connectedAccounts.create({ freelancerId, stripeAccountId });` | delete the line | E1 (step 3: no row). connect.test.js R1/R10-family (record). E4 seeds rows directly — must stay green (narrowness check). |
| F3 | `lib/webhooks/receiver.js` `repos.connectedAccounts.updateReadiness(object.id, readinessFromAccount(object, iso(event.created)));` | delete the line | E1 (step 5), E4. webhooks.test.js `account.updated` W-case (record). |
| F4 | `lib/contracts/generation.js` `const renderedHtml = renderContract(template, variables);` | `variables` → `{ ...variables, clientName: 'nobody' }` | E1 (step 7, client-name count 0). contracts.test.js cases asserting the client name (record). |
| F5 | `routes/invoices.js` `return editPath(invoice.id);` (create-draft handler — 1 hit; the update handler's line is identical text, so anchor with the preceding `createDraft` line: `perl -0pi -e 's/(createDraft\([^\n]*\n\s*)return editPath/$1return detailPath/'`, then `grep -c "return detailPath" ` must read 3) | `editPath` → `detailPath` on the create handler only | E1 (step 8). invoices.test.js R2. |
| F6 | `lib/invoices/lifecycle.js` `if (invoice.status === 'draft') {` | `'draft'` → `'never'` | E1 (step 9, 409 reconcile on null amount), E2, E4. invoices.test.js finalize R-cases (record). |
| F7 | `lib/invoices/lifecycle.js` `if (through === 'send' && invoice.sentAt === null) {` | prepend `false && ` | E1 (step 10, sentAt null). invoices.test.js send R-cases (record). |
| F8 | `lib/webhooks/receiver.js` `'invoice.paid': invoiceRow,` | delete the line | E1 (step 11, `ok: ignored`), E3 (positive control). webhooks.test.js paid W-case and G2 (committed handled-types list). |
| F9 | `lib/webhooks/receiver.js` `if (!repos.stripeEvents.recordOnce(event.id, event.type)) return { outcome: 'duplicate' };` | → `repos.stripeEvents.recordOnce(event.id, event.type);` | E1 (step 11b, body `ok: fields` not `duplicate`; `updatedAt` moved). webhooks.test.js duplicate W-cases (record). |
| F10 | `lib/webhooks/signature.js` `if (supplied.length === expected.length && timingSafeEqual(supplied, expected)) return { timestamp };` | → `return { timestamp };` | E3 (tampered accepted → 200). webhooks.test.js S-cases `no_match` (record). |
| F10b | instrument mutant, no source edit: in a scratch copy of the e2e file, build E1's double with `webhookSecret: 'whsec_other'` | — | E1 (step 5, 400). Proves the double's signature is load-bearing, not decorative. |
| F11 | `lib/invoices/lifecycle.js` `metadata: { local_invoice_id: invoice.id },` (inside ensureInvoice — 1 hit) | append `transfer_data: { destination: acct },` on the next line | E1 (step 9: 500 `StripeCustodyError: create-invoice`), E2, E4, and AC-14 never reached. invoices.test.js R-cases (record). Zero double calls for the invoice create — the guard runs before the transport. |
| F12 | `lib/db/repositories/invoices.js` `if (incomingRank < currentRank) return outcome('stale');` | delete the line | E1 (step 12: `ok: applied`, status `open`). repositories.test.js / webhooks.test.js stale cases (record). |
| F-NET | `test/helpers/stripe-double.js`: route `POST /v1/customers` to `fetchTransport` (import from `../../lib/stripe/transport.js`) | — | E1 (step 9), E2, E4: 502 `StripeTransportError: create-customer` — in BOTH `test` and `contract` services. Proves offline-ness by observation. |
| F-ALLOW | scratch copy of `lib/stripe/custody.js`: add `{ method: 'GET', path: '/v1/customers/{id}', scope: 'connected', reason: 'mutant' }` | — | E0 (10 ≠ 9). stripe-client.test.js allowlist-count case (record). |
| F-REPLAY | `test/helpers/stripe-double.js`: skip the `replays.set(key, reply)` write | — | E2 (3 items, `amount_due` 17500, 409 on the second finalize). |
| F-SHAPE | scratch copy of the double: add `invented_key: 1` to the invoice object | — | E5 in the `contract` service only. |
| F-V2 | leave `harness.test.js` unmodified with the new file present | — | harness V2 (18 ≠ 17). The natural first red of the implementation. |

Sixteen recipes; every property in §6 has at least one. F2's "E4 must stay green" and F5's
`grep -c` = 3 are the assert-applied-at-the-intended-site checks the AS-95 sharpening requires.

## 8. Receipts

**Baseline on master `8161844` (today, `-p asc-plan-as49`, `--build`, absolute docker path,
`down -v --rmi local` after; log in `scratchpad/agent-cto-owen/as49/baseline-master.log`):**
- `test`: 420 tests / 402 pass / 0 fail / 18 skipped — `Image asc-plan-as49-test Built`, exit 0.
- `contract`: 420 / 420 / 0 / 0 — `Image asc-plan-as49-contract Built`, exit 0.

**Predicted after this task** (committed before the run; a different number is a finding):
- `test`: **426 / 407 / 0 / 19** (+E0–E5 = 6 cases; E5 skips offline).
- `contract`: **426 / 426 / 0 / 0**.
If the implementer splits E1 into per-step cases, the totals rise by the split count and the
implementation comment states the new prediction BEFORE the receipt run.

Commands (from the worktree, `-p` distinct from the main checkout's `asc-invoicing`):
`DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 /usr/local/bin/docker compose -p asc-as49 -f
<worktree>/apps/invoicing/compose.yaml run --rm --build test` (then `contract`, then `down -v
--rmi local`). No build line, no valid number.

## 9. Seams with AS-46 and AS-47, and merge order

Both in-flight branches touch `test/harness.test.js` (each adds two files and moves the V2
literal — AS-46: `invoice-screen.test.js`, `route-surface.test.js`; AS-47:
`contract-screens.test.js` and the same `route-surface.test.js`, which AS-47 rebases onto AS-46's).
This task adds one entry. **A textual conflict at the list and the literal is certain and
trivial: union the lists, set the literal to the list's length.** Neither branch touches
`test/helpers/`, and this task touches no app source, no manifest and not
`dependency-policy.test.js`, so there is no other code seam. README: this task adds a
subsection under "## The suite"; AS-46/47 edit other sections — adjacent-hunk conflict possible,
content-free.

Behavioural seam: AS-46 rewrites `routes/invoices.js` (+154) and `routes/clients.js` (+18). The
pins at AC-6 (`/?clientId=`), AC-8 (`/invoices/<id>/edit`) and AC-9/10 (`/invoices/<id>`) are
route-table facts; if AS-46's merged table moves one, the rebase updates the pin and the case
comment cites the route table. Nothing in AC-2–AC-14 depends on a screen rendering.

Merge order: **AS-46 (in review now) → AS-47 (rebases onto AS-46) → AS-49.** AS-49
implementation may START before AS-46 merges (independent files); the branch is cut from
master today (`8161844`, pre-AS-46). Mandatory step before `review`: rebase onto master, resolve
the harness list, re-run both receipts, re-state the prediction. If AS-47 is still in flight at
AS-49's merge, AS-47 rebases over the one-line harness change — Marcus already carries that
exact resolution from AS-46.

## 10. Open questions (time-boxed; default applies when the box expires)

- **Q1** — Converge `connect.test.js`/`invoices.test.js` fixtures onto the double? Default **no**
  in this task (§3.9). Trigger to file: a third suite wanting a stateful fixture. Box: review.
- **Q2** — Should `demo/run.mjs` gain a "with state" variant using the double? Default **no**:
  the demo's value is the real validator and honest labels; a stateful demo would blur them.
  Parked for the AS-90 artifact's next refresh. Box: AS-50's planning.
- **Q3** — A dedicated `e2e` compose service? Default **no** (§3.1): zero compose change is a
  property, not a shortcut. Trigger: a case that needs a second container.
- **Q4** — Where the honest claim is pinned mechanically: default the exported constant +
  reviewer grep (AC-19). A test reading README cannot run in the image (README is host-only).
- **Q5** — For AS-50's planner: the double's event builders and E1's committed call order are the
  natural "expected" column for the acceptance run's comparison table (what the double says vs
  what test mode said). Note only; nothing here depends on it.

## 11. Staffing

- **Implementer: `developer-lena`** — free once AS-46 clears review (she is not doing anything
  during Ruben's cycle 2; if cycle 2 returns rework she goes back to AS-46 first and AS-49 waits
  — the loop is not more urgent than the screen it will pin). Marcus stays on AS-47, which is
  gated on AS-46's merge for its rebase; he is the alternate only after AS-47 lands.
- **Reviewer: `qa-priya`** — Ruben is on AS-46 cycle 2 (and the natural AS-47 reviewer, both
  being seam-heavy); Priya reviewed AS-44 (the receiver) and AS-69, and reads this cold. Her
  tasking message must carry the criteria and the recipes' NAMES, not the predicted red sets
  or the receipt numbers (the AS-36 rule) — she re-derives both. Budget for M6: she should
  probe at least one thing no case names (suggested seeds, for the orchestrator to withhold or
  not: a `void` event after `paid` — the one same-rank conflict; a second freelancer's session
  hitting the first's invoice inside the loop).
- Implementer instructions the tasking message must carry: commit early on the branch; keep a
  progress note in `scratchpad/agent-developer-lena/as49/`; run every `lattice` command from
  the main checkout; never `cd` into the worktree for a `lattice` call (`git -C`).

## 12. Out of scope, restated

A real Stripe account or test mode (AS-50, board-gated on AS-51); browser/UI automation;
performance; changes to the demo; changes to app source; converging the older fixtures; any
compose or Dockerfile change; email of any kind.
