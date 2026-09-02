# AS-41: D1 v1: Stripe Connect onboarding (server) — account, account_links, return/refresh, readiness

Plan by `agent:cto-owen` (tech lead for this stage), 2026-09-02. Implementer:
`agent:developer-marcus`. Recommended reviewer: `agent:qa-priya`. The task
description in Lattice (`lattice show AS-41`) is binding in every sentence; this
plan says HOW.

Style and falsification conventions follow the AS-38/AS-39 plans: every
set-quantified assertion sits behind an exact count against a committed literal;
every guard is demonstrated failing under a mutation before it is believed;
recipe backups live OUTSIDE `apps/invoicing/`.

Contracts this plan builds against, read on master at `303ed09`:

- **The custody guard** (`lib/stripe/custody.js`, AS-38): the allowlist already
  declares exactly the three platform-scoped calls this task needs —
  `POST /v1/accounts`, `POST /v1/account_links`, `GET /v1/accounts/{id}` — and
  bans `controller[...]` as a parameter, so "bare Standard-equivalent defaults"
  is enforced, not hoped for. Platform calls MUST declare `platform: true` at
  the call site (greppable by design; §3.6 turns that grep into a test).
- **The persistence contract** (AS-39 plan §2.5–2.6, live in
  `lib/db/repositories/connected-accounts.js`): `connected_accounts` is 1:1
  with freelancers (UNIQUE), `updateReadiness` writes all six readiness fields
  atomically or none, and the ONE derived rule
  `ready = chargesEnabled && requirementsCurrentlyDue.length === 0` lives in
  AS-39's row mapper. This task writes through that surface and never restates
  the derivation.
- **The client pipeline** (`lib/stripe/client.js`): validate → build → guard →
  requireKey → sign → transport → interpret. An injected `transport` exercises
  the full pipeline, guard included, with zero network — that fact is the
  spine of §5's offline strategy.

---

## §1 Scope

### 1.1 In scope

1. Three HTTP routes (`routes/connect.js`) implementing chain link 2 server-side:
   start onboarding, handle Stripe's return redirect, handle Stripe's refresh
   redirect (§3.2).
2. A connect service module (`lib/connect/onboarding.js`) that owns the three
   Stripe calls and the create-or-reuse/readiness-sync logic, so routes stay thin
   and every `platform: true` call site lives in one file (§3.3–3.5).
3. A pure readiness mapper (`lib/connect/readiness.js`): Stripe account object →
   the exact six-key patch `updateReadiness` takes. Written once here, reused by
   AS-44 for `account.updated` (its `data.object` IS an account object) (§3.4).
4. `createApp` grows a dependency argument (`{ repos, stripe }`), built in
   `server.js` — the shape AS-39 §2.8 recommended, delivered one task early with
   `stripe` alongside `repos` (§3.7).
5. One config row: `appBaseUrl` / `INVOICING_APP_BASE_URL`, new `url` type,
   default `http://127.0.0.1:8348` (§4).
6. `test/connect.test.js` — offline route/mapper tests through the real client
   with a fixture transport, plus mock-gated contract cases that drive the real
   routes against stripe-mock (§5).
7. Amendments to the three existing tests whose committed literals this task
   moves (harness, dependency-policy, config), `test/helpers/server.js`, and the
   app README (§5.4).

### 1.2 Not in scope (the description's NOT list, mirrored, plus who owns it)

- **The Connect screen and its states ledger** — **AS-45** (screen 2,
  `GET /connect-stripe`). This task's return route redirects there; until AS-45
  lands that redirect target 404s, and that is acceptable: the Location header
  is the contract, asserted in tests without dereferencing it (§9 Q2).
- **Webhook receipt infrastructure** — **AS-44**. This task defines how an
  `account.updated` payload changes readiness (the mapper, §3.4, tested against
  an `account.updated` `data.object` fixture); AS-44 delivers the payload and
  calls the same mapper inside its own transaction.
- **Anything touching invoices** — **AS-43**. It reads `row.ready` (AS-39's
  derivation) before finalizing; nothing here exports a second definition.
- **Authentication** — **AS-40**. §3.1 defines the interim identity seam and its
  single replacement point.
- **No new health check, no new screen, no compose or Dockerfile change** (§4).
- **No Stripe account, no signup, no board ask.** Everything verifies against
  stripe-mock and fixtures; the named residual stays with AS-50 (§6 AC 14).

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

- new: `apps/invoicing/lib/connect/readiness.js`,
  `apps/invoicing/lib/connect/onboarding.js`,
  `apps/invoicing/routes/connect.js`, `apps/invoicing/test/connect.test.js`
- modified: `apps/invoicing/app.js`, `apps/invoicing/server.js`,
  `apps/invoicing/lib/config.js`, `apps/invoicing/test/helpers/server.js`,
  `apps/invoicing/test/config.test.js`, `apps/invoicing/test/harness.test.js`,
  `apps/invoicing/test/dependency-policy.test.js`, `apps/invoicing/README.md`

## §3 Design

### 3.1 Identity: who the routes act for, until AS-40

There are no sessions yet. Every route takes the acting freelancer as
`?freelancer=<freelancer id>` (the AS-39 UUID), resolved by ONE exported
function in `routes/connect.js`:

```js
export function resolveFreelancerId(req) { /* req.query.freelancer, trimmed; null if absent */ }
```

- Marked with an **AS-40 OBLIGATION** header comment, mirroring the AS-45
  obligation pattern in `routes/pages.js`: when sessions land, AS-40 replaces
  this function's body with session-derived identity and deletes the query
  parameter from start; return/refresh keep working because a Stripe redirect
  is a top-level GET navigation and carries session cookies.
- On return/refresh the parameter arrives because WE minted it into
  `return_url`/`refresh_url` when creating the account link (§3.3). Until
  AS-40, these endpoints are as open as every other route in the app — there is
  no auth anywhere yet; the seam is designed so the ownership check lands
  naturally in one place when sessions exist.
- Query parameter, deliberately not a body field: no body-parsing middleware
  exists in `app.js` and this task does not add any.

### 3.2 Route surface

Paths align with the wireframes' provisional route table
(`docs/design/wireframes/01-screens.md` §1 row 2), so AS-45 and AS-41 converge
without a rename. All redirects are `303 See Other` (semantically required for
the POST, used uniformly for the GETs — one literal). All error bodies are
one-line `text/plain` (the `routes/assets.js` precedent); screens render states
from the DB row, not from these bodies.

| Route | Does, on success | Redirects to |
|---|---|---|
| `POST /connect-stripe/start` | create-or-reuse the connected account, mint an onboarding link (§3.3) | the account link's `url` (Stripe-hosted onboarding); or `/connect-stripe` when the account is already `ready` (nothing to onboard) |
| `GET /connect-stripe/return` | re-read readiness from Stripe and persist it (§3.5) — NEVER trusts the return itself | `/connect-stripe` (screen 2 renders the row) |
| `GET /connect-stripe/refresh` | mint a fresh onboarding link for the existing account (§3.3) — the expired-link continuation, not an error page | the new link's `url` |

Why refresh re-enters the flow instead of erroring: `account_links` are
single-use and expire in minutes; Stripe calls `refresh_url` when the link is
no longer valid (expired, already used, reloaded). The freelancer did nothing
wrong, so the correct behaviour is to mint a new link and put them straight
back into the hosted flow — which is exactly the wireframes' `S2-REFRESH`
state ("mints a fresh account link, immediately redirects back into Stripe's
flow"). Refresh does NOT sync readiness: the freelancer is mid-onboarding and a
read adds latency and no information; return and creation are the sync moments
(§3.5).

**Error taxonomy** (mapped in `routes/connect.js`, one small `statusFor`):

| Condition | Status |
|---|---|
| missing/empty `freelancer` parameter | 400 |
| unknown freelancer; or return/refresh for a freelancer with no connected-account row (impossible in a legitimate flow — the row exists before any link does, §3.3) | 404 |
| Stripe key unconfigured (`ConfigError` from the client's requireKey step) | 503 — deploy/config problem, same class as a missing vendored asset |
| `StripeApiError` / `StripeTransportError` (Stripe answered with an error, or didn't answer) | 502 — upstream; body carries the error class and step name, never the key (the client's error types already carry no request material) |
| `StripeCustodyError` | 500 — unreachable in normal operation (these routes compose only allowlisted calls); if it fires, something is genuinely wrong and it must be loud |
| `ValidationError` from the repositories on Stripe-supplied values (e.g. a non-`acct_` id) | 502 — on these routes, repo inputs come from Stripe, not the user |

### 3.3 Start: create-or-reuse, and what stops duplicate accounts

```
POST /connect-stripe/start?freelancer=F
  freelancers.getById(F)                        → 404 if unknown
  row = connectedAccounts.getByFreelancer(F)
  ├─ row exists, row.ready        → 303 /connect-stripe        (zero Stripe calls)
  ├─ row exists, not ready        → mint link for row.stripeAccountId → 303 link.url
  └─ no row:
       acct = stripe.request({ method:'POST', path:'/v1/accounts', platform:true,
                               params:{}, idempotencyKey:`acct-create-${F}` })
       try connectedAccounts.create({ freelancerId:F, stripeAccountId:acct.data.id })
            → seed readiness from the CREATE RESPONSE (§3.5): updateReadiness(acct.data.id, mapper(acct.data, now()))
       catch UniqueViolationError               (lost a race: §3.3a)
            → row = getByFreelancer(F); proceed with row.stripeAccountId, no seed
       mint link → 303 link.url
```

- **`params: {}` is load-bearing**: the bare `POST /v1/accounts` is what yields
  the Standard-equivalent controller defaults the spike verified
  (`losses.payments=stripe`, `fees.payer=account`,
  `requirement_collection=stripe`, `stripe_dashboard.type=full`). No `type`, no
  `controller[...]` — and the guard's FORBIDDEN_PARAMS bans `controller` anyway,
  so a drift here is a thrown `StripeCustodyError`, not a silent liability
  shift. The existing contract case K8 in `stripe-mock.test.js` already pins
  this exact shape against the spec; §5's M-cases pin that the ROUTE sends it.
- **Minting the link** (`POST /v1/account_links`, `platform: true`), exactly the
  four parameters K8 validates:
  `account`, `type: 'account_onboarding'`,
  `refresh_url: {appBaseUrl}/connect-stripe/refresh?freelancer=F`,
  `return_url: {appBaseUrl}/connect-stripe/return?freelancer=F`.
  URLs are built with `new URL(path, config.appBaseUrl)` plus
  `searchParams.set('freelancer', F)` — constructed, never concatenated.
- **What stops a double-click creating two Stripe accounts, in three layers:**
  1. *The row check*: a second `start` finds the row and mints a link only —
     the schema's `UNIQUE (freelancer_id)` (AS-39) makes 1:1 a database fact.
  2. *The race between check and insert* (two concurrent `start`s both see no
     row): both POST to Stripe, one `create` wins, the loser's
     `UniqueViolationError` is caught, the winner's row is re-read and the
     flow continues against it. One row, always.
  3. *The stable idempotency key* `acct-create-<freelancerId>` bounds even the
     Stripe side of that race: within Stripe's idempotency window a replayed
     create returns the SAME `acct_`, so both racers hold the same id and the
     "orphan account" case requires the ~24h window to lapse mid-race —
     practically unreachable. If it ever happens anyway, the orphan is an
     inert test-mode shell: never onboarded, no KYC, cannot charge, referenced
     by nothing. Recorded honestly rather than defended against with machinery.

### 3.4 The readiness mapper — one definition, two writers

`lib/connect/readiness.js` exports one pure function:

```js
readinessFromAccount(account, syncedAt)  →  { chargesEnabled, detailsSubmitted, payoutsEnabled,
                                              requirementsCurrentlyDue, requirementsDisabledReason, syncedAt }
```

- Field mapping, exact: `charges_enabled` → `chargesEnabled`,
  `details_submitted` → `detailsSubmitted`, `payouts_enabled` →
  `payoutsEnabled`, `requirements.currently_due` → `requirementsCurrentlyDue`,
  `requirements.disabled_reason` → `requirementsDisabledReason` (absent →
  `null`), caller-supplied clock → `syncedAt`.
- **Strict on the three booleans** (a non-boolean means we are reading a shape
  we do not understand — `TypeError`, surfaced as 502 by the route);
  **tolerant on `requirements`** (`null`/absent → `[]` due, `null` reason),
  because Stripe can omit the hash in some account views while the booleans are
  always present (§9 Q3 boxes this).
- The `ready` derivation is NOT here — it lives in AS-39's row mapper, the one
  place. This module maps shapes; it decides nothing.
- AS-44 imports this same function for `account.updated` (`data.object` is an
  account object). That is what "this task defines how an account.updated
  payload changes readiness" means mechanically, and §5's R1 tests it against
  an `account.updated`-shaped fixture so the reuse is proven before AS-44 exists.

### 3.5 The readiness state machine, and who writes when

A connected-account record has exactly three readiness states, all projections
of the stored fields:

```
created            (syncedAt null, flags false, ready false — AS-39 defaults)
  │  first snapshot write
  ▼
synced, not ready  (ready false)  ⇄  synced, ready  (ready true)
```

Transitions happen ONLY via `connectedAccounts.updateReadiness` with a full
six-field snapshot, and this plan adds the contract that makes concurrent
writers safe to reason about: **every snapshot written is one freshly obtained
from Stripe** (a create response or a `GET /v1/accounts/{id}` made by the same
request that writes it), with `syncedAt` = the injected clock at obtain time.
Never from a cache, never synthesized, and never — this is the description's
core rule — inferred from the fact that the user came back through
`return_url`. Stripe returns the user whether or not requirements are complete;
the return route's ONLY readiness action is a fresh `GET /v1/accounts/{id}`
followed by a write of what Stripe said. Mutation F4 (§7) proves the tests
would catch a "trusting" implementation.

Sync moments in this task: (1) at account creation, seeded from the create
response — so `syncedAt` is non-null from birth and the mapper is exercised on
a real response shape; (2) on every return. AS-44 adds (3): `account.updated`.

**Write conflicts with AS-44, decided now:** last-writer-wins, and that is
sufficient. `updateReadiness` writes all six fields in one statement (no torn
rows, AS-39's contract), and under the fresh-read rule every write is a recent
Stripe truth, so interleaved writers converge on the next event or return.
The residual race — two overlapping read→write pairs landing in inverted
order — is bounded: the stale-says-not-ready direction merely delays finalize
until the next sync; the stale-says-ready direction lets AS-43 attempt a
finalize that Stripe itself then refuses (its API is the authority at charge
time), surfacing as an ordinary `StripeApiError`, never a custody or
funds-flow issue. Account objects carry no monotonic version to rank by (unlike
the invoice mirror's status rank), so a compare-and-swap would be comparing our
own clocks; not worth the machinery in v1. Recorded for AS-44's planner (§9 Q4).

### 3.6 Where the calls live, held by a test

Every Stripe call this task adds sits in `lib/connect/onboarding.js`, declared
`platform: true` at the call site per the custody contract. That stops being a
convention and becomes a gate: dependency-policy gains a concept row

```js
scanConcept('platform Stripe call', /platform:\s*true/, ['lib/connect/onboarding.js']);
```

Today that construct appears in zero product-source files (custody.js mentions
it only in comments, which the scan strips) — the row starts exact, and the
V2 used-exemption rule means an onboarding.js that stopped calling Stripe would
fail it too. `routes/connect.js` therefore contains no Stripe call by test, not
just by intent.

### 3.7 Composition: `createApp(config, deps)`

- `createApp(config, { repos, stripe })` — throws `TypeError` at construction
  when either is missing. No hidden "routes mount but 503" switch: an app that
  cannot serve its routes must fail to construct, in the spirit of config's
  fail-at-boot rule. This is AS-39 §2.8's recommended shape (`createApp(config,
  { repos })`), delivered by its actual first consumer with `stripe` added.
- `server.js`: after `prepareDatabase`, build `repos =
  createRepositories(db)` and `stripe = createStripeClient({ apiKey:
  config.stripeSecretKey })`, pass both. No key configured → boots fine, start
  answers 503 per §3.2 (requireKey fires per call, after the guard — AS-38's
  ordering).
- `routes/connect.js` exports `connectRoutes(config, { repos, stripe })`;
  mounted in `app.js` after `pageRoutes`, before `express.static` (route order
  note updated in the header comment).
- `test/helpers/server.js#withServer` builds the same deps from its own
  `prepareDatabase` handle; gains an optional third argument
  `{ stripe }` so connect tests can inject a fixture-transport client.
  Existing two-argument callers compile unchanged.

## §4 Compose / config / Dockerfile

- **compose.yaml: UNCHANGED. Dockerfile: UNCHANGED.** The new setting's default
  (`http://127.0.0.1:8348`) IS the local-compose reality — the host side of the
  `127.0.0.1:8348:8348` port map, which is the address a browser on this host
  uses. deploy-shape's exactly-4-environment-entries pin therefore stands. M1
  (deployment) overrides the variable at the real domain; nothing here
  forecloses that.
- **`lib/config.js`**: one SCHEMA row —
  `{ key: 'appBaseUrl', envVar: 'INVOICING_APP_BASE_URL', type: 'url', default: 'http://127.0.0.1:8348' }`,
  inserted after `dbPath` (the secret row stays last). New `url` type in
  `coerce` and `validateResolved`, mirroring `client.js#validateBaseUrl`'s
  rules: parses as URL, `http:`/`https:` only, no path (`pathname === '/'` but
  stored without the trailing slash as given — a value ending in `/` beyond the
  origin is rejected, never silently trimmed), no query, no fragment, no
  credentials. Fail at boot, name the env var.
- The named residual applies to this default: whether Stripe test mode accepts
  loopback return/refresh URLs is settled by AS-50's acceptance run, not here.

## §5 Key files (one line each) and every test literal that moves

### 5.1 New

| File | One line | ~lines |
|---|---|---|
| `lib/connect/readiness.js` | pure mapper: Stripe account object → the six-key updateReadiness patch (§3.4) | 55 |
| `lib/connect/onboarding.js` | the three Stripe calls + create-or-reuse + sync moments; the only `platform: true` file (§3.3, §3.5) | 150 |
| `routes/connect.js` | three thin handlers, `resolveFreelancerId` seam (AS-40 OBLIGATION), `statusFor` error mapping (§3.1–3.2) | 120 |
| `test/connect.test.js` | R-cases offline through the real client/guard with a fixture transport; M-cases `{ skip: SKIP }` against stripe-mock (§5.3) | 500 |

### 5.2 Modified

| File | One line | Δ |
|---|---|---|
| `app.js` | `createApp(config, deps)` with TypeError guard; mount `connectRoutes` (§3.7) | +12 |
| `server.js` | build `repos` + `stripe`, pass to createApp (§3.7) | +10 |
| `lib/config.js` | `appBaseUrl` row + `url` type in coerce/validateResolved (§4) | +30 |
| `test/helpers/server.js` | withServer builds deps; optional `{ stripe }` third arg (§3.7) | +15 |
| `test/config.test.js` | literals in 5.4; new url-type cases | +45 |
| `test/harness.test.js` | literals in 5.4 | +2 |
| `test/dependency-policy.test.js` | literals in 5.4; new concept row (§3.6) | +15 |
| `README.md` | routes section, `INVOICING_APP_BASE_URL`, AS-40/AS-45 handoffs | +35 |

### 5.3 Test plan (`test/connect.test.js`)

Offline cases run through `withServer` (or the service module directly) with a
client built as `createStripeClient({ apiKey: '<placeholder, not
key-shaped>', transport: fixtureTransport })` — the full pipeline including the
custody guard runs on every call; the fixture transport returns canned account
/ account_link JSON and records every request it sees (method, path, headers,
body), so assertions read the actual wire shape.

- R1 mapper truth table: 4 charges×due combinations (`ready` from the AS-39 row
  after `updateReadiness`), due-list and disabled-reason mapping, absent/null
  `requirements` → `[]`/`null`, non-boolean `charges_enabled` throws, and the
  same mapper applied to an `account.updated` event fixture's `data.object`.
- R2 start, unknown freelancer → 404, zero transport calls.
- R3 start, fresh: transport saw exactly `POST /v1/accounts` with EMPTY body +
  `idempotency-key: acct-create-<F>`, then `POST /v1/account_links` with
  exactly the four params and the two URLs built off `appBaseUrl` carrying
  `?freelancer=<F>`; row created; readiness seeded from the create response
  (`syncedAt` non-null); 303 → fixture link url.
- R4 start, row exists not ready: zero `/v1/accounts` calls, one
  `/v1/account_links` call, 303 → link url.
- R5 start, row ready: zero transport calls, 303 → `/connect-stripe`.
- R6 return, not-ready fixture (due non-empty): transport saw `GET
  /v1/accounts/{acct}`; row updated to exactly the fixture's flags; `ready`
  false; 303 → `/connect-stripe`. **This is the doesn't-trust-the-return case.**
- R7 return, ready fixture: row flips to ready.
- R8 return with no row / unknown freelancer → 404, zero transport calls.
- R9 refresh: one `/v1/account_links` call for the stored acct, 303 → new link
  url; no readiness write (`syncedAt` unchanged); no row → 404.
- R10 Stripe 4xx on account create (fixture transport returns a Stripe error
  body): 502, and NO row was created (order: Stripe first, row after).
- R11 key unconfigured (`apiKey: null`): start → 503, zero transport calls.
- R12 the §3.3a race, simulated: the fixture transport's `/v1/accounts` handler
  inserts the competing row (same freelancer, different acct) before returning
  — `create` hits UniqueViolation, service re-reads, link is minted for the
  STORED acct, exactly one row exists.
- R13 `resolveFreelancerId`: absent/blank parameter → 400 on all three routes.

Mock-gated cases (`{ skip: SKIP }`, same self-skip pattern and
not-stripe.com refusal as `stripe-mock.test.js`; only the `contract` service
sets `ASC_STRIPE_MOCK_URL`):

- M1 start driven over HTTP against a real app whose client points at
  stripe-mock: 303, Location = the mock's account_link fixture url, row created
  from the mock's account fixture. This is the route-level request-shape
  validation — the mock rejects any parameter the spec does not know.
- M2 return against the mock: readiness row matches the mock's account fixture,
  303.
- M3 refresh against the mock: 303 to the fixture link url.

What genuinely cannot be tested here, named (the description's residual, ours
to restate not to solve): stripe-mock is stateless — it cannot exercise the
real hosted-onboarding round trip (a human completing KYC and being redirected
back), and it validates request shapes, not whether test-mode Stripe accepts
loopback return/refresh URLs. Both are AS-50's acceptance run, gated on the
board's account (AS-51). This task opens nothing and files nothing.

### 5.4 Every committed literal that moves, exactly

1. `test/harness.test.js`: `EXPECTED_TEST_FILES` gains `'connect.test.js'`
   (sorted position 3); the cardinality assertion `10` → `11`.
2. `test/dependency-policy.test.js`: source-list count `26` → `29`; the sorted
   list gains `lib/connect/onboarding.js`, `lib/connect/readiness.js`,
   `routes/connect.js`; NEW concept row `platform Stripe call` (§3.6); the
   concept test's name gains AS-41 ("…where AS-38, AS-39 and AS-41 put
   them…"). Unchanged and asserted still true: `LOCK_ENTRIES` 70,
   `DIRECT_DEPENDENCIES`, manifests 3, `SANCTIONED.length` 3, `/webhook route`
   `[]`, `STRIPE_ config key` file list, `application_fee` list, money-words
   list (none of the new files may contain amount/currency/money even in
   comments — RAW scan), 1,200-line cap.
3. `test/config.test.js`: `SCHEMA.length` `9` → `10`; the key list gains
   `appBaseUrl` after `dbPath`; INVOICING_-prefixed count `8` → `9`; the
   empty-environment `deepEqual` object and the overrides `deepEqual` object
   both gain `appBaseUrl`; new cases: bad URL / has-path / has-query /
   has-credentials / trailing-slash values throw naming
   `INVOICING_APP_BASE_URL`; `validateResolved` flags a malformed `appBaseUrl`.
4. **Deliberately NOT moving** (asserted by leaving them untouched and green):
   `deploy-shape.test.js` (compose untouched; exactly-4-env-entries pin
   stands), `health.test.js` (four checks, no new one), `db.test.js`,
   `assets.test.js`, `stripe-client.test.js`, `stripe-mock.test.js`,
   `lib/views.js` (no new template), `package.json`/`package-lock.json` (zero
   new dependencies).

## §6 Acceptance criteria

1. The three routes exist with the §3.2 methods, paths, success redirects
   (303) and error statuses (400/404/502/503), verified by R2–R13.
2. Account creation sends `POST /v1/accounts` with an EMPTY parameter set —
   no `type`, no `controller[...]` — plus a stable idempotency key
   `acct-create-<freelancerId>` (R3, M1).
3. Account links are minted with exactly `account`, `type=account_onboarding`,
   `refresh_url`, `return_url`, the URLs built from `config.appBaseUrl` and
   carrying the freelancer id (R3, R4, M1, M3).
4. The return route never trusts the return: readiness is written only from a
   fresh `GET /v1/accounts/{id}` (or, at creation, the create response), and
   the not-ready fixture stays not-ready after a return (R6; mutation F4).
5. The refresh route mints a fresh link and 303s back into the hosted flow —
   the `S2-REFRESH` semantics — and writes no readiness (R9; the wireframe's
   "error page" alternative is explicitly rejected in §3.2).
6. Duplicate-account prevention holds at all three layers of §3.3: existing
   row → no `/v1/accounts` call (R4, R5); insert race converges to one row
   against the stored acct (R12); ready rows short-circuit with zero Stripe
   calls (R5).
7. Readiness mapping is a single module (`lib/connect/readiness.js`) producing
   the exact six-key patch; the `ready` derivation is read from AS-39's row
   mapper and defined nowhere in this diff (R1; grep: no
   `requirementsCurrentlyDue.length === 0` outside `lib/db/`).
8. The mapper handles an `account.updated` payload's `data.object` identically
   to a GET response (R1) — AS-44's reuse is proven before AS-44 exists.
9. Every Stripe call site in the diff lives in `lib/connect/onboarding.js`,
   declared `platform: true`, held by the new dependency-policy concept row
   (§3.6); the custody guard runs on every offline test call by construction
   (fixture transport sits BEHIND the full client pipeline).
10. `createApp(config, { repos, stripe })` throws TypeError when either dep is
    missing; `server.js` and `withServer` both construct the deps; the app
    boots from an empty environment exactly as before (config default covers
    `appBaseUrl`).
11. VERIFICATION (from the task description, verbatim): "request and response
    shapes validated against stripe-mock (free, no account); the return/refresh
    route logic and the readiness state machine unit-tested against fixture
    account and account.updated payloads."
12. The offline suite passes in the `test` service (`network_mode: none`,
    mock cases reported as skipped — never passed — there), and the full suite
    including M1–M3 passes in the `contract` service; V1's instrument check
    runs in both directions (green normally, red with `ASC_SELFTEST_MUTATE=1`).
13. Every §5.4 literal lands in the same commit as the change that moves it;
    the suite is green with zero unexplained skips beyond the mock gate.
14. The named residual is restated in the review comment, not resolved: no
    Stripe account exists, none was opened, no board ask was filed; hosted
    round-trip and loopback-URL acceptance remain AS-50's.
15. Falsification recipes F1–F5 executed per §7 with their predicted failing
    sets observed exactly; evidence (commands + failing test names) recorded in
    a Lattice comment on AS-41 before review is requested.
16. The implementation diff stays inside §2's prefix; `.lattice/` untouched on
    the branch; no new dependencies; `LOCK_ENTRIES` still 70.

## §7 Falsification recipes (run in the task worktree; backups OUTSIDE apps/invoicing/)

House rules: back up to `${TMPDIR:-/tmp}/as41-falsify/` (never inside
`apps/invoicing/`), `trap` the restore on EXIT, **assert the mutation applied**
(grep the mutant before running — an unapplied mutation looks exactly like a
passing guard), run the suite IN CONTAINER (`docker compose ... run --rm test`),
observe the predicted failing set exactly (wider or narrower is itself a
finding), restore, prove the tree with `git -C <worktree> diff --exit-code`,
then **rebuild the image and re-run green** — a restored tree with a stale
mutant image produces phantom results in both directions. Every `docker
compose` invocation from the worktree, never the main checkout.

| # | Mutation (exact) | Assert applied | Predicted failing set |
|---|---|---|---|
| F1 | `perl -0pi -e "s/path: '\/v1\/accounts', platform: true/path: '\/v1\/accounts'/" lib/connect/onboarding.js` — strip the platform declaration from the account-CREATE call only | `grep -c "platform: true" lib/connect/onboarding.js` drops by exactly 1 | R3 and R12 fail (guard throws `platform_not_declared` → 500 where 303 expected); R4/R5/R9 still green (their calls untouched) — the narrowness IS the point; dependency-policy stays green (the construct still appears) |
| F2 | in `readiness.js`, hardcode `requirementsCurrentlyDue: []` regardless of input | `grep -n "requirementsCurrentlyDue: \[\]" lib/connect/readiness.js` = 1 hit | R1 (due-mapping and truth-table rows with due≠[]), R6 (not-ready fixture becomes ready — the trust assertion trips) |
| F3 | comment out the `row exists` early branch in `onboarding.js#start` (always take the create path) | grep for the branch marker comment shows it disabled | R4 (accounts-call count 1≠0), R5 (Stripe calls where zero expected / UniqueViolation → 502 where 303 expected) |
| F4 | replace `handleReturn`'s GET-account+map with a hardcoded all-true ready patch | `grep -c "GET" lib/connect/onboarding.js` (or the call-site line) shows the read gone | R6 fails (row ready despite not-ready fixture); R7 stays green — recorded to show why R6, not R7, is the trust guard; M2 fails in the contract service |
| F5 | in a SCRATCH COPY of the worktree (never in place): `mv test/connect.test.js test/connect.test.js.bak` | `ls test/connect.test.js` fails in the copy | harness V2 only: found 10 files ≠ committed 11 — proves the new file is load-bearing in the pinned list, not decoration |

## §8 Size and complexity, against the milestone tripwires

**Projection:** 4 new + 8 modified = **12 files**, ≈ **900 insertions**
(≈ 330 source, ≈ 500 test, ≈ 70 literal-moves/README). That crosses both §8.2
tripwires (>~10 files, >~600 lines), so here is the required written
justification rather than a silent overrun: the task is ONE reviewable claim —
chain link 2's server half works and readiness gates it — whose scope is fixed
verbatim by the description (four primitives, C-10 + C-11); 5 of the 12 files
and ≈ 110 of the lines are the mechanical literal-tax every task in this app
pays (harness list, dependency-policy lists, config counts, helpers, README),
not additional surface; and the test:source ratio (~1.5:1) is the house norm
for Stripe-touching code, where AS-38 set the precedent. Complexity: **medium**,
as filed.

**Pre-agreed split line, decided now so mid-flight nobody improvises:** if the
implementation heads past ~1,100 insertions or the route layer turns out to
need body-parsing middleware or any rendering, the split is **M1–M3 (the
mock-gated route contract cases) plus R12 (the race simulation) into a
follow-up task** — the offline suite alone still proves every AC except the
route-level spec validation, which K8 partially covers meanwhile. The mapper,
the three routes, and the trust rule (AC 1–8) are the task's irreducible core
and never split.

## §9 Open questions — each with a default and a time-box

- **Q1 — does `POST /v1/account_links` (type=account_onboarding) error on a
  fully-onboarded account?** Default: moot in our flow — start short-circuits
  ready rows (§3.3) and refresh implies an unfinished flow; no code path mints
  for a ready account. Box: observed for the record at AS-50's acceptance run;
  no v1 behaviour depends on the answer.
- **Q2 — the return/refresh redirect target `/connect-stripe` dangles (404)
  until AS-45 lands.** Default: keep — the Location header is the contract and
  AS-45 depends on this task, so the gap closes in order. Box: AS-45's planning
  stage; if AS-45 renames the screen route, the redirect target is one literal
  in `routes/connect.js` plus its test assertions, named here so that rename is
  a one-commit affair.
- **Q3 — is tolerating an absent/null `requirements` hash (→ `[]` due) too
  lenient?** Default: tolerate with the default; the booleans stay strict, and
  a missing hash with `charges_enabled=false` still reads not-ready —
  fail-closed for the gate that matters. Box: AS-50's run against real
  test-mode accounts; if real responses always carry the hash, tighten to
  strict in a follow-up literal.
- **Q4 — is last-writer-wins readiness sufficient once AS-44's webhook writer
  exists?** Default: yes, under §3.5's fresh-read contract, with the bounded
  failure analysis recorded there. Box: AS-44's planning stage re-derives the
  conflict analysis with event timestamps in hand; the schema forecloses
  nothing (adding a comparison column would be a migration through AS-39's
  runner).

## §10 Proposed wording for metawork-owned files

None. This task changes no operating convention: no `CLAUDE.md`, root
`README.md`, `PHILOSOPHY.md`, or `agents.md` wording is needed or proposed.
(`apps/invoicing/README.md` is app documentation, employee-owned, edited
in-scope per §5.2.)

## §11 Stale items found while planning (flags, not edits)

1. **`docs/design/wireframes/01-screens.md` §1 marks ALL routes "provisional —
   final routes owned by AS-45..48."** For screen 2 that is now only
   two-thirds true: this task fixes `/connect-stripe/return` and
   `/connect-stripe/refresh` server-side (they are baked into minted account
   links), leaving only the screen route itself to AS-45. AS-45's planner
   should treat those two as settled; flagged for whoever plans AS-45 (and for
   Jonah if he sweeps the doc).
2. **AS-39 plan §2.8** recorded "Recommended shape for AS-40 (first consumer):
   `createApp(config, { repos })`." AS-41 turned out to be the first consumer
   and delivers that exact shape plus `stripe`. Not an error — the
   recommendation is fulfilled early — recorded so AS-40's planner doesn't
   re-derive the seam.
3. **`lib/config.js` header narrative** ends its schema story at AS-39/AS-40;
   the AS-41 row adds its own sentence in-scope (§5.2), so the header stays a
   complete history — noting here only so the implementer treats the header as
   part of the row's diff, per the file's own convention.
