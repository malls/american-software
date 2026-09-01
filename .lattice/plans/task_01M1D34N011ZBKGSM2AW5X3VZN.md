# AS-38: D1 v1: Stripe client wrapper with custody guard (never in the flow of funds)

Plan by `agent:cto-owen` (tech lead for this stage), 2026-09-01. Implementer:
`agent:developer-marcus`. Reviewer: `agent:qa-priya`. The task description in
Lattice (`lattice show AS-38`) is binding in every sentence; this plan says HOW.

Style and falsification conventions follow the AS-53 plan
(`.lattice/plans/task_01M1ER9MTH85YJKGADBNCVT0X7.md`) and the scaffold's README
(`apps/invoicing/README.md`): every set-quantified assertion sits behind an exact
count against a committed literal (V2); every guard is demonstrated failing
under a mutation before it is believed (§6).

Evidence gathered for this plan (all offline, no account touched):
stripe-mock `v0.203.0` source (`server/server.go`, its `Dockerfile`) and the
OpenAPI spec it bundles (`spec3.json`, version `2026-08-26.dahlia`, 8,028,700
bytes) — fetched from `github.com/stripe/stripe-mock` via `gh api`. Parameter
occurrence counts and quoted descriptions below come from that spec.

---

## 1. Scope

### 1.1 In scope

1. `apps/invoicing/lib/stripe/` — three modules (§2.1): the custody policy as
   data plus a pure guard, the client that builds and sends requests, and the
   one transport that owns the product's only outbound HTTP call.
2. One config row for the secret key (§2.8): `INVOICING_STRIPE_SECRET_KEY`,
   optional, `secret: true`, read from a gitignored `apps/invoicing/.env.local`
   or the environment. Absent → the app boots, `/healthz` is unchanged, the suite
   passes. **Runnable now with no accounts.**
3. Two test files (§2.10): `test/stripe-client.test.js` (offline: fake transport
   + a loopback echo listener) and `test/stripe-mock.test.js` (contract half:
   request shapes validated against stripe-mock; self-skips when the mock is not
   configured).
4. Compose (§3): a `stripe-mock` service from the public image, pinned, on an
   internal no-egress network, and a `contract` service that runs the same bare
   `node --test` attached to it. The existing `test` service is untouched and
   stays `network_mode: none`.
5. The dependency-policy guard extended so the wrapper's `fetch` is sanctioned
   exactly once and a second egress point — a second `fetch`, a raw
   `node:http`/`http2`/`net`/`tls`/`child_process` import, a `WebSocket`, or a
   second import of the transport — is still a red test (§2.9).
6. Amendments to the four existing tests whose committed literals this task
   moves (config, dependency-policy, deploy-shape, harness), the app README, the
   root `.dockerignore` (one pattern) and the stale comment in the root
   `.gitignore`.

### 1.2 Not in scope (the description's NOT list, mirrored, plus who owns it)

- **No product endpoint or feature uses the wrapper.** `app.js`, `server.js`,
  `routes/*`, `lib/health.js` do not import it. Nothing constructs a client at
  boot. First consumers: **AS-41** (Connect onboarding — `POST /v1/accounts`,
  `POST /v1/account_links`, `GET /v1/accounts/{id}`), **AS-43** (invoice
  lifecycle — customers, invoice items, invoices, finalize, send, read).
- **No webhook signature verification** — **AS-44**. Different input (an
  inbound body and a `Stripe-Signature` header), different failure mode (forged
  events, replay). Nothing here handles inbound traffic. The stack decision
  §8.1's sentence "AS-38 carries a test for each" webhook failure mode is stale
  against the task description and is recorded as such in §10.
- **No real Stripe account, key, or network call.** None exists (AS-51 is
  `needs_human`); none is assumed. Every test runs against a fake transport, a
  loopback listener, or stripe-mock. The default `baseUrl` is
  `https://api.stripe.com` but no test and no compose service ever sends to it.
- **No application-fee path** (A2, pending board ruling). `application_fee_amount`
  / `application_fee_percent` / `application_fee` are refused (§2.4). A future
  board reversal is one row deleted from one table — not a refactor. Declining to
  foreclose is not the same as building.
- **No idempotency *policy*, no retries, no logging.** The client carries an
  idempotency key when given one (§2.6); which operations get keys, how they are
  derived, and retry/backoff policy are AS-43's, decided with the data model in
  hand.
- **No account-configuration policy beyond the ban** on `controller[...]` (§2.4
  row 10). Which fields AS-41 sends on `POST /v1/accounts` is AS-41's plan, under
  the obligation in §8 Q3.
- **No `.env.local` is created** by this task or committed by any task. The file
  is documented, gitignored and dockerignored; whether it exists on a given
  machine is the operator's business.

---

## 2. Design

### 2.1 Module layout

```
apps/invoicing/lib/stripe/
  custody.js     the policy as data (three frozen tables + one regex) and
                 guardRequest(). Pure: no imports, no I/O, no state.
  client.js      createStripeClient(): validates the call, builds the wire
                 request, runs the guard, then the key check, then the transport,
                 then maps the response. Imports ./custody.js, ./transport.js,
                 ../config.js (ConfigError only).
  transport.js   fetchTransport(): the ONE `fetch` token in product source.
                 ~40 lines. Nothing else in the product may import it.
```

Why three files and not one: the guard must be testable without a client (so a
client-level bypass — mutation M1 — is visible as "guard-level green,
client-level red"), and the transport must be the only file the dependency
policy sanctions, so its import graph is one edge (`client.js → transport.js`)
and that edge is itself a guarded construct (§2.9).

### 2.2 Public surface

```js
// lib/stripe/client.js — exports EXACTLY these five names (pinned by test C1)
export function createStripeClient({
  apiKey,                                  // string | null. null → ConfigError on the first clean call (§2.3 step 4)
  baseUrl = 'https://api.stripe.com',      // an OPTION, never a config row (see below)
  transport = fetchTransport,              // (signedRequest, { timeoutMs }) => Promise<{ status, headers, body }>
  timeoutMs = 30_000,
  apiVersion = API_VERSION,                // '2026-08-26.dahlia' — the spec version the shapes were validated against
} = {}) → { request }

client.request({
  method,            // 'GET' | 'POST' — nothing else exists in the allowlist
  path,              // '/v1/invoices/in_123/finalize' — bare path, /^\/v1(\/[A-Za-z0-9_]+)+$/
  account,           // 'acct_…' — REQUIRED on connected rows, FORBIDDEN on platform rows
  platform,          // true — REQUIRED on platform rows, forbidden with `account`
  params,            // plain object | undefined. Encoded to Stripe bracket form (§2.5)
  idempotencyKey,    // string 1–255 chars, POST only
}) → Promise<{ status: number, requestId: string | null, data: object }>

export function encodeForm(params) → string           // exported for tests
export { StripeApiError, StripeTransportError }        // defined in client.js
export { StripeCustodyError }                          // re-exported from ./custody.js
// NOT exported: fetchTransport, API_VERSION, the internal build/sign helpers.

// lib/stripe/custody.js
export const FORBIDDEN_PARAMS            // frozen [{ name, cite, reason }] — 10 rows (§2.4)
export const ALLOWED_ENDPOINTS           // frozen [{ method, path, scope, reason }] — 9 rows (§2.4)
export const FORBIDDEN_ENDPOINT_PREFIXES // frozen [string] — 9 prefixes no row may ever match (§2.4)
export const ACCOUNT_ID = /^acct_[A-Za-z0-9]+$/
export class StripeCustodyError extends Error   // .code (§2.7), .detail (plain data, never headers)
export function guardRequest(request) → request  // returns the SAME frozen object or throws

// lib/stripe/transport.js
export async function fetchTransport(request, { timeoutMs }) → { status, headers, body }
```

**`baseUrl` is deliberately not configurable from the environment.** An
env-settable base URL sends the secret key wherever the environment says. Only
tests pass a different `baseUrl` (a loopback listener, `http://stripe-mock:12111`).
`baseUrl` is validated on construction: `http:` or `https:`, `pathname === '/'`,
no search, no hash, no credentials.

### 2.3 The request pipeline (ordered; the mutations in §6 target these steps by name)

1. **`validateCall(call)`** — shape, not policy. Throws `TypeError`:
   `method` ∈ {`GET`,`POST`}; `path` matches the regex above (so no `?`, `#`,
   `%`, `.`, `-`, `//` — the guard's path match is on a canonical string);
   `params` absent or a plain object (`Object.getPrototypeOf(p) === Object.prototype`
   — strings, `Buffer`, `URLSearchParams`, arrays are refused so a pre-encoded
   body can never be handed in); `account` absent or a string; `platform` absent
   or `true`; `idempotencyKey` absent or a string of 1–255 chars, and only with
   `POST`.
2. **`buildUnsigned(call)`** → frozen
   `{ method, url: URL, headers: {…lower-case names…}, body: string | null, meta: { platform: boolean } }`.
   `url = new URL(path, baseUrl)`; GET params → `url.search`; POST → `body =
   encodeForm(params ?? {})` — an empty string for a parameterless POST, with
   `content-type` still set: stripe-mock (and Stripe) reject a POST without
   `application/x-www-form-urlencoded`, including `…/finalize` with no fields.
   Headers, exactly: `accept: application/json`; `stripe-version: <apiVersion>`;
   `content-type: application/x-www-form-urlencoded` (POST only);
   `stripe-account: <account>` (when given); `idempotency-key: <key>` (when
   given). No `user-agent` override, nothing else.
3. **`guardRequest(unsigned)`** — custody (§2.4, §2.5). Runs on the fully
   materialised wire request: method, absolute URL including query, headers,
   encoded body. **Before the key check**, so a custody violation is reported
   even on a machine with no key configured (test C7 pins the order).
4. **`requireKey(apiKey)`** — `null`/empty → `ConfigError('INVOICING_STRIPE_SECRET_KEY',
   'is not configured; see apps/invoicing/README.md § Giving the app a key')`.
   Zero transport calls.
5. **`sign(unsigned, apiKey)`** → a new frozen object: the guarded request plus
   exactly one header, `authorization: Bearer <apiKey>`. The guard never sees the
   key; no error raised after this point may carry `headers`.
6. **`transport(signed, { timeoutMs })`** → `{ status, headers (lower-case
   plain object), body (string) }`. `fetchTransport` uses `redirect: 'error'`
   (a redirect would carry the key to another host) and
   `AbortSignal.timeout(timeoutMs)`; no retries.
7. **`interpret(response)`** — `JSON.parse(body)`; `data.error` present or
   status ≥ 400 → `StripeApiError`; unparsable → `StripeTransportError('invalid_json')`;
   else `{ status, requestId: headers['request-id'] ?? null, data }`.

### 2.4 The policy, as data

**Connected vs platform.** A *connected* call carries `Stripe-Account: acct_…`
and executes on the freelancer's own account — the money is theirs, the
merchant of record is them (spike §1: direct charges, Standard defaults). A
*platform* call carries no `Stripe-Account` and executes as us. **Exactly three
platform calls are allowed in v1**, all onboarding: you cannot authenticate as
an account that does not exist yet, and none of the three moves money. Every
other call is connected. The guard is strict both ways: a connected row without
a valid header is refused; a platform row with a header is refused; a platform
row not declared `platform: true` at the call site is refused — so `grep
"platform: true"` lists every platform-scoped Stripe call in the codebase, which
is the standing design-review aid the spike priced.

```js
export const ALLOWED_ENDPOINTS = Object.freeze([
  // scope 'platform' — onboarding only (spike §1 steps 1–2; milestone plan C-03)
  { method: 'POST', path: '/v1/accounts',            scope: 'platform',  reason: 'create the freelancer\'s connected account; no account to act as yet; moves no money' },
  { method: 'POST', path: '/v1/account_links',       scope: 'platform',  reason: 'Stripe-hosted onboarding link; platform-created by Stripe\'s design' },
  { method: 'GET',  path: '/v1/accounts/{id}',       scope: 'platform',  reason: 'onboarding status read (charges_enabled, details_submitted)' },
  // scope 'connected' — the invoice chain on the freelancer's account (spike §1 steps 3–8)
  { method: 'POST', path: '/v1/customers',           scope: 'connected', reason: 'the freelancer\'s client, on the freelancer\'s account' },
  { method: 'POST', path: '/v1/invoiceitems',        scope: 'connected', reason: 'line items' },
  { method: 'POST', path: '/v1/invoices',            scope: 'connected', reason: 'collection_method=send_invoice; Stripe hosts the payment page' },
  { method: 'POST', path: '/v1/invoices/{id}/finalize', scope: 'connected', reason: 'finalize before send' },
  { method: 'POST', path: '/v1/invoices/{id}/send',  scope: 'connected', reason: 'Stripe emails the client; we are never the sender of record' },
  { method: 'GET',  path: '/v1/invoices/{id}',       scope: 'connected', reason: 'status read; expand[] allowed' },
]);
// `{id}` matches /[A-Za-z0-9_]+/ exactly one segment. Rows are added one at a
// time, by the dependent task that needs them, with a reason — never a wildcard.
```

```js
// Paths that may NEVER appear in ALLOWED_ENDPOINTS. custody.js throws at module
// load if any row matches one (fail closed at boot, not at first call — M7).
export const FORBIDDEN_ENDPOINT_PREFIXES = Object.freeze([
  '/v1/transfers',        // separate charges & transfers: moves balance between accounts
  '/v1/payouts',          // moving balance out of an account
  '/v1/topups',           // moving money into a balance
  '/v1/application_fees', // the fee rail the board has not ruled on (A2)
  '/v1/charges',          // we never create charges: Stripe's hosted invoice page does, on the connected account
  '/v1/payment_intents',  // same
  '/v1/treasury',         // stored balances
  '/v1/issuing',          // cards
  '/v1/balance',          // our own balance is not a product concern — nothing should land on it
]);
```

```js
// Parameter NAMES refused at every nesting depth (§2.5). Citations: the
// OpenAPI spec bundled with stripe-mock v0.203.0 (version 2026-08-26.dahlia);
// counts are request-parameter occurrences across that spec.
export const FORBIDDEN_PARAMS = Object.freeze([
  { name: 'transfer_data',          cite: 'spec: 23 occurrences incl. POST /v1/invoices ("the funds from the invoice will be transferred to the destination"), payment_intent_data.transfer_data, subscription_data.transfer_data; spike §1 "the forbidden shape"', reason: 'destination charge: client money lands on OUR balance first' },
  { name: 'destination',            cite: 'spec: 22 occurrences — transfer_data.destination, legacy top-level on POST /v1/charges, /v1/transfers, /v1/payouts', reason: 'the account money is routed to; banned as a segment so transfer_data[destination] is caught by two rows' },
  { name: 'on_behalf_of',           cite: 'spec: 22 occurrences incl. POST /v1/invoices ("the account (if any) for which the funds of the invoice payment are intended"), payment_intent_data., setup_intent_data., subscription_data.', reason: 'settlement merchant override — the platform-side invoice shape' },
  { name: 'application_fee_amount', cite: 'spec: 13 occurrences incl. POST /v1/invoices ("transferred to the application owner\'s Stripe account. The request must be made with an OAuth key or the Stripe-Account header"); decision memo §4.2; board decision §3.2', reason: 'A2: no application-fee path until the board rules' },
  { name: 'application_fee_percent',cite: 'spec: 14 occurrences — subscriptions, subscription_schedules, payment_links, quotes, subscription_data.', reason: 'A2, the percentage form' },
  { name: 'application_fee',        cite: 'spec: 2 occurrences — legacy POST /v1/charges and capture', reason: 'A2, the legacy form' },
  { name: 'transfer_group',         cite: 'spec: 10 occurrences — charges, payment_intents, topups, transfers', reason: 'separate charges & transfers: groups money for later platform-side transfers' },
  { name: 'source_transaction',     cite: 'spec: 1 occurrence — POST /v1/transfers ("transfer funds from a charge before they are added to your available balance")', reason: 'transfers funded from a charge on OUR balance' },
  { name: 'issuer',                 cite: 'spec: 20 occurrences incl. POST /v1/invoices ("The connected account that issues the invoice"), invoice_settings.issuer, invoice_creation.invoice_data.issuer', reason: 'a platform-owned invoice presented as the connected account\'s — funds on our balance; not named in the task description, found in the spec' },
  { name: 'controller',             cite: 'spec: POST /v1/accounts controller[fees][payer], controller[losses][payments], controller[requirement_collection]; spike §1 documentary evidence: Standard-equivalent defaults are exactly what a bare POST /v1/accounts gives', reason: 'any controller override moves fee or loss liability onto us; AS-41 creates accounts with the defaults and sends no controller[...]' },
]);
```

**Denylist AND allowlist — both, and why.** A parameter denylist alone lets an
unknown endpoint through (`POST /v1/transfers` carries no banned *name* if you
omit `source_transaction`). An endpoint allowlist alone lets the banned shape
through on an allowed endpoint (`POST /v1/invoices` with `transfer_data`). The
endpoint allowlist is the coarse gate (only these nine method+path pairs exist),
the parameter denylist is the fine gate on those nine (and on every row a
dependent adds later, automatically), and `FORBIDDEN_ENDPOINT_PREFIXES` is the
gate on the allowlist itself. `charges`/`payment_intents` are hard-forbidden on
purpose: this is an invoice-sending product, never a charging platform; a future
task that wants either reopens this plan, in writing.

### 2.5 How the guard sees nested and encoded bodies

The guard does not look at the caller's `params` object. It looks at what will
go on the wire: `new URLSearchParams(request.body ?? '')` and
`request.url.searchParams` (both, regardless of method). For every key:

```js
const segments = key.split(/[\[\].]+/).filter((s) => s.length > 0).map((s) => s.trim().toLowerCase());
if (segments.some((s) => BANNED.has(s))) throw new StripeCustodyError('banned_parameter', { key, segment });
```

So `transfer_data[destination]`, `{ transfer_data: { destination } }` (encoded by
us), `'transfer_data[destination]'` as a literal key, `transfer_data%5Bdestination%5D`
(percent-encoded brackets — `URLSearchParams` decodes them), `TRANSFER_DATA`,
`subscription_data[transfer_data][amount]`, `phases[0][transfer_data]`, and a GET
`?on_behalf_of=` all reach the same decoded key and the same refusal. **Values are
never inspected**: `expand[0]=transfer_data` is a read expansion and legitimate.
Because `validateCall` refuses non-plain `params`, there is no path by which a raw
body reaches the wire without passing through `encodeForm` and then the guard.

`encodeForm(params)` → `URLSearchParams` in Stripe bracket notation: nested
objects → `a[b][c]`, arrays → `a[0]`, `a[1]`; strings verbatim; finite numbers
and booleans stringified; `null` → `''` (Stripe's "unset"); `undefined` omitted;
`Date`, `BigInt`, functions, symbols, non-finite numbers → `TypeError`.

### 2.6 Idempotency

Mechanism here, policy in the callers. `idempotencyKey` is sent verbatim as
`idempotency-key` on POST; refused on GET (Stripe ignores it there, and a caller
passing one on a GET has misunderstood something worth a loud error); refused
outside 1–255 chars (Stripe's limit). The client never generates a key: a random
per-call key is a no-op for retries and a silent lie. AS-43 derives keys from its
own rows.

### 2.7 Error types

| Class | Where | Carries | Never carries |
|---|---|---|---|
| `StripeCustodyError` (custody.js) | guard | `code` ∈ {`endpoint_not_allowed`, `missing_account`, `invalid_account_id`, `unexpected_account`, `platform_not_declared`, `banned_parameter`}; `detail` (plain data: method, path, key/segment); `message` starts with `CUSTODY:` | headers, body, key |
| `TypeError` (native) | `validateCall`, `encodeForm` | what was malformed | — |
| `ConfigError` (lib/config.js, existing) | `requireKey` | `envVar = 'INVOICING_STRIPE_SECRET_KEY'` | the key |
| `StripeApiError` (client.js) | `interpret` | `status`, `requestId`, `type`, `code`, `param`, Stripe's `message` | request headers, key |
| `StripeTransportError` (client.js) | transport / `interpret` | `code` ∈ {`network`, `timeout`, `redirect`, `invalid_json`}, `cause` | request headers, key |

Guard errors are ordered: endpoint → scope → params (a request that is both
off-allowlist and carries `transfer_data` reports `endpoint_not_allowed`).

### 2.8 Configuration and the secret

- **Row** in `lib/config.js` `SCHEMA` (the comment there already reserves the
  slot): `{ key: 'stripeSecretKey', envVar: 'INVOICING_STRIPE_SECRET_KEY', type: 'string', default: null, required: false, secret: true }`.
  Absent (or empty/whitespace — `present()` already treats those as absent, which
  is what makes compose's empty-default pass-through below safe) → `null`.
- **`redacted()`**: one-line change — a secret that resolved to `null` shows
  `null`, a configured one shows `'[redacted]'`. The startup log line therefore
  says `"stripeSecretKey":null` on a keyless machine, which is the operationally
  useful fact and reveals nothing. Pinned by a new config test.
- **The file**: `apps/invoicing/.env.local`, one line, `INVOICING_STRIPE_SECRET_KEY=sk_test_…`.
  **`.gitignore` entries already exist** (root `.gitignore`, from the AS-51 board
  ask): `apps/invoicing/.env.local` and `*.env.local`. AS-38 only corrects the
  comment above them ("compose gains an env_file reference" → "compose passes it
  through by interpolation; load it with `--env-file .env.local`").
- **`.dockerignore`** (repo root) gains `**/.env.local` so the file never enters
  the build context. It is not COPY'd either, so it never enters the image — the
  in-container dependency-policy scan never meets it.
- **Compose** (§3): `web` gains `- INVOICING_STRIPE_SECRET_KEY=${INVOICING_STRIPE_SECRET_KEY:-}`.
  With nothing set, that interpolates to an empty value → absent → `null`; no
  warning (the `:-` default). With a key: `docker compose --env-file .env.local up --build`,
  or export the variable. **The default invocation never loads a key**; loading
  one is a deliberate flag. `env_file:` was rejected: the short form fails hard
  when the file is missing (violates "boots with no key"), and the long form
  with `required: false` is a nested sequence item the strict compose parser in
  `deploy-shape.test.js` cannot read.
- **What the app does with no key**: boots; `/healthz` unchanged (`lib/health.js`
  deliberately does not check Stripe, and still does not); nothing constructs a
  client; the suite passes in both `test` and `contract` services with
  `INVOICING_STRIPE_SECRET_KEY` unset (test C15 asserts it is unset during the run).
  A consumer that later constructs `createStripeClient({ apiKey: config.stripeSecretKey })`
  gets custody refusals immediately and `ConfigError` on the first clean call.
- **Secrets never enter the repo, the chat app, or Lattice.** No test, fixture,
  comment, or plan carries a key-shaped value except the contract test's
  `sk_test_stripemock` (§2.10) — which is not a key: stripe-mock's only rule is
  "three `_`-separated parts, first `sk`|`rk`, second `test`", and real Stripe
  would 401 it.

### 2.9 Keeping the dependency-policy guard honest

The scan (`test/dependency-policy.test.js`) is closed-world and lexical. AS-38
adds the product's first legitimate egress and must leave the guard able to
catch the second one.

1. **Tighten `fetch`.** `OUTBOUND_CLIENTS` row `fetch(` → `{ name: 'fetch', pattern: /\bfetch\b/ }`.
   The old `/\bfetch\s*\(/` misses aliasing (`const f = fetch; f(url)`,
   `globalThis.fetch`, `const { fetch } = globalThis`). Checked for collisions
   before planning: the only `fetch` tokens in scanned product source are the
   compose healthcheck (already sanctioned) and a stripped Dockerfile comment.
   The compose `SANCTIONED` entry's `construct` becomes `'fetch'`.
2. **Widen the import rows** to catch dynamic and un-prefixed forms:
   `/(from|require\s*\(|import\s*\()\s*['"](node:)?https?['"]/`, and new rows for
   `(node:)?http2`, `(node:)?(net|tls)`, `(node:)?child_process`, plus
   `{ name: 'WebSocket', pattern: /\bWebSocket\b/ }` and
   `{ name: 'http.request(', pattern: /\bhttps?\s*\.\s*(request|get)\s*\(/ }`.
   Collision check done: none of these tokens appear in scanned source today.
3. **Make the transport import a guarded construct**:
   `{ name: 'stripe transport import', pattern: /['"][^'"]*\btransport\.js['"]/ }`.
4. **Sanction exactly three constructs** (`SANCTIONED.length` literal 1 → 3):

```js
{ file: 'lib/stripe/transport.js', construct: 'fetch', count: 1,
  line: /^  const response = await fetch\(request\.url, init\);$/,
  reason: 'AS-38: the one outbound HTTP call in the product (stack decision §11 chokepoint corollary, §12). A second hit anywhere is a second HTTP client.' },
{ file: 'lib/stripe/client.js', construct: 'stripe transport import', count: 1,
  line: /^import \{ fetchTransport \} from '\.\/transport\.js';$/,
  reason: 'AS-38: only the client may reach the transport; routes and services call the client.' },
```

   The implementer writes those two lines byte-for-byte (the mutation recipes in
   §6 depend on them). `transport.js` contains exactly one `fetch` token in code
   (no `typeof fetch` guard, no alias); `client.js` does not re-export
   `fetchTransport` (test C1 pins the export list).
5. **What a second egress looks like to the guard now**: a `fetch` in a route
   (M5a), a transport import from a route (M5b), the sanctioned line reshaped
   (M6), a raw `node:https` import anywhere, a `WebSocket` — all red on the
   construct test, with `file:line: construct` in the message. The scan remains
   lexical: it cannot see `process.binding`, `createRequire` tricks, or a
   dependency that phones home — the dependency budget (2) and `node_modules`
   being unscanned-by-design are the answer to the latter; the former are
   review-visible. Record, do not pretend otherwise.
6. **Source count literal** 11 → 14 (`lib/stripe/client.js`, `lib/stripe/custody.js`,
   `lib/stripe/transport.js` in sorted position after `lib/health.js`).
7. **Retarget the leak test** ('nothing AS-38 or AS-39 owns has leaked into the
   scaffold') — rename to reflect that AS-38 has landed:
   - `stripe` module import: banned everywhere, **permanently** (stack decision
     §8.1: `new Stripe(key)` is the documented bypass); pattern widened with
     `import\s*\(`.
   - `/STRIPE_[A-Z_]+/`: allowed in exactly `['compose.yaml', 'lib/config.js', 'lib/stripe/client.js']`
     (each must contain it — V2 exactly-used); a hit anywhere else is a finding.
   - `/application_fee/`: allowed in exactly `['lib/stripe/custody.js']`, which
     must contain it.
   - `/['"]\/webhook/` (until AS-44) and `node:sqlite` (until AS-39): unchanged.
   - Money regex `/amount|currency|money/i` over RAW text: exempt exactly
     `['lib/stripe/custody.js']` with a reason, and assert the regex DOES match
     there (an unused exemption is a finding). Consequence for the implementer:
     `client.js` and `transport.js` must not contain those tokens even in
     comments; say "value" and "figure", not "amount".

### 2.10 Tests

**`test/stripe-client.test.js`** — offline, runs in the `network_mode: none`
service. Names are fixed here because §6 predicts fail sets by name.

Guard-level (imports `custody.js` directly):
- G1 `custody: policy tables are the committed literals` — `FORBIDDEN_PARAMS.length === 10`
  and the exact sorted name list; `ALLOWED_ENDPOINTS.length === 9` and the exact
  `method path scope` triples; `FORBIDDEN_ENDPOINT_PREFIXES` exact list (9); every
  row has non-empty `cite`/`reason`; tables and rows frozen; no allowlisted path
  matches a forbidden prefix.
- G2 `custody: an endpoint off the allowlist is refused before anything else` —
  `POST /v1/transfers` with no header and with `transfer_data` → `endpoint_not_allowed`.
- G3 `custody: a connected endpoint without Stripe-Account is refused` — `missing_account`.
- G4 `custody: a malformed Stripe-Account is refused` — `cus_123`, `acct_`, `acct_x y`, `ACCT_123` → `invalid_account_id`.
- G5 `custody: a platform endpoint refuses a Stripe-Account header` — `unexpected_account`.
- G6 `custody: a platform endpoint must be declared platform` — `meta.platform === false` on `POST /v1/accounts` → `platform_not_declared`.
- G7 `custody: every forbidden parameter is refused at every nesting depth` —
  table-driven over all 10 names × 6 encodings (top-level, `[child]`, `[0]`,
  upper-case, percent-encoded brackets, GET query) = 60 refusals, each with
  `code === 'banned_parameter'` and `detail.segment` naming the row; count asserted.
- G8 `custody: an allowlisted request passes through unchanged` — returns the
  identical frozen object (`===`) for one connected and one platform request.
- G9 `custody: refusal errors carry a code and never the headers` — `JSON.stringify(err)`
  and `err.message` contain no header names or values.

Client-level (fake transport that records calls):
- C1 `client: the module exports exactly the declared surface` — `Object.keys(mod).sort()`
  deepEqual `['StripeApiError','StripeCustodyError','StripeTransportError','createStripeClient','encodeForm']`.
- C2 `client: refuses transfer_data before the transport is called` — zero calls recorded. *(description negative case, verbatim)*
- C3 `client: refuses on_behalf_of before the transport is called`. *(verbatim)*
- C4 `client: refuses every forbidden parameter with zero transport calls` — the 10 names, nested and flat.
- C5 `client: refuses a connected call without an account with zero transport calls`. *(verbatim)*
- C6 `client: refuses an off-allowlist endpoint with zero transport calls`.
- C7 `client: a custody refusal fires even when no key is configured` — `apiKey: null` + `transfer_data` → `StripeCustodyError`, not `ConfigError`.
- C8 `client: a clean call with no key is a ConfigError naming INVOICING_STRIPE_SECRET_KEY, with zero transport calls`.
- C9 `client: the transport receives exactly the guarded request plus authorization` —
  `deepStrictEqual` on the header object (`accept`, `stripe-version`,
  `content-type`, `stripe-account`, `idempotency-key`, `authorization`), method,
  URL string, body string; request objects frozen.
- C10 `client: form encoding follows Stripe bracket notation` — nested, arrays,
  booleans, numbers, `null` → `''`, `undefined` omitted; `Date`/`BigInt`/function
  → `TypeError`; non-plain `params` → `TypeError`.
- C11 `client: GET params go in the query string and POST params in the body, with content-type on every POST` — including an empty-body POST.
- C12 `client: idempotency key is sent verbatim on POST and refused on GET or out of range`.
- C13 `client: a Stripe error body becomes a StripeApiError carrying status, type, code, param, requestId — and never the key`.
- C14 `client: a non-JSON body or a transport failure is a StripeTransportError`.
- C15 `client: the suite runs with no INVOICING_STRIPE_SECRET_KEY in the environment` — `process.env.INVOICING_STRIPE_SECRET_KEY === undefined`.
- C16 `client: path must be a bare /v1 path — no query, fragment, percent-escapes or traversal`.

Transport-level (a `node:http` echo listener on `127.0.0.1:0`, started/stopped
with the `test/helpers/server.js` try/finally discipline; `test/` is unscanned,
so `node:http` there is fine — the transport is the subject, not mocked):
- T1 `transport: sends method, headers and body byte-for-byte to a loopback listener` — through the real client with `baseUrl` = the listener.
- T2 `transport: refuses to follow a redirect` — listener answers 302 → `StripeTransportError('redirect')`; the listener records exactly one request.
- T3 `transport: times out` — listener holds the socket; `timeoutMs: 200` → `StripeTransportError('timeout')`.
- T4 `transport: a refused connection is a StripeTransportError('network')` — `http://127.0.0.1:1/` (loopback exists under `network_mode: none`; the connect is refused immediately).

**`test/stripe-mock.test.js`** — the contract half. Reads `ASC_STRIPE_MOCK_URL`;
when unset, every case is `{ skip: 'ASC_STRIPE_MOCK_URL not set — run the contract service' }`
so the `test` service's output shows them as **skipped, not passed** (the
expected `skipped` count is pinned in §5). When set: refuse a URL whose host ends
in `stripe.com`; poll `GET /v1/customers` (expect any HTTP response — the 401 is
the reachability signal) every 100 ms for ≤ 10 s, then proceed. Key literal
`sk_test_stripemock` — the only key-shaped literal in the repo (§2.8).
- K0 `stripe-mock: the mock is reachable and is not Stripe`.
- K1 `stripe-mock: strict version check is on` — raw `fetch` with `Stripe-Version: 2020-08-27` → 400 (`-strict-version-check`, §3); this is what makes the client's `stripe-version` constant load-bearing.
- K2–K7 `stripe-mock: connected <row>` — one per connected row, through the client with `account: 'acct_stripemock'`: customers (`email`, `name`, `metadata[…]`), invoiceitems, invoices (`collection_method=send_invoice`, `days_until_due`), finalize (empty body), send, GET with `expand[0]=customer`. Each asserts `status 200`, `data.object`, `requestId === 'req_123'`.
- K8 `stripe-mock: platform POST /v1/accounts, POST /v1/account_links, GET /v1/accounts/{id}` — `platform: true`, no account.
- K9 `stripe-mock: unknown parameters are rejected by the mock — the encoder is not inventing names` — `made_up_param=1` on customers → `StripeApiError` 400. This is what makes K2–K8 non-vacuous: the mock validates shapes.
- K10 `stripe-mock: Idempotency-Key is echoed and Request-Id surfaces as requestId`.
- K11 `stripe-mock: the mock ACCEPTS the forbidden shape raw; the client refuses it with zero transport calls` —
  raw `fetch` `POST /v1/invoices` with `transfer_data[destination]=acct_x&on_behalf_of=acct_x`,
  no `Stripe-Account` → 200 from the mock (re-measures spike §1: "the API will not
  hold this boundary for us"); the same call through the client → `StripeCustodyError`,
  transport call count 0 (a counting wrapper around `fetchTransport`).

**Amended tests**: `config.test.js` (§4), `dependency-policy.test.js` (§2.9),
`deploy-shape.test.js` (§3.3), `harness.test.js` (`EXPECTED_TEST_FILES` + the two
new names; literal 6 → 8).

---

## 3. Compose changes

### 3.1 Shape

```yaml
  # stripe-mock (AS-38): Stripe's public request-shape validator, pinned to the
  # tag whose bundled OpenAPI spec (2026-08-26.dahlia) the client's Stripe-Version
  # constant names. Pulling a public image is not a signup: it creates no
  # account, no credential and no relationship with Stripe — the board-gated act
  # is opening an account (AS-51), and this needs none. No ports: only the
  # contract service reaches it, over an internal network with no egress.
  # -strict-version-check turns a wrong Stripe-Version header into a 400.
  stripe-mock:
    image: stripe/stripe-mock:v0.203.0
    platform: linux/amd64
    profiles: ["tools"]
    command: ["-strict-version-check"]
    networks:
      - stripe-mock

  # contract (AS-38): the same image and the same bare `node --test` as `test`,
  # attached to stripe-mock. ASC_STRIPE_MOCK_URL is what un-skips the stripe-mock
  # cases; `test` never sets it, so the offline half stays offline.
  contract:
    build:
      context: ../..
      dockerfile: apps/invoicing/Dockerfile
      platforms:
        - linux/amd64
    platform: linux/amd64
    profiles: ["tools"]
    depends_on:
      - stripe-mock
    networks:
      - stripe-mock
    environment:
      - ASC_STRIPE_MOCK_URL=http://stripe-mock:12111
    command: ["node", "--test"]

networks:
  # internal: no default gateway — nothing attached can reach the internet.
  stripe-mock:
    internal: true
```

plus, on `web`:

```yaml
    environment:
      - INVOICING_BIND=0.0.0.0
      - INVOICING_PORT=8348
      - INVOICING_STRIPE_SECRET_KEY=${INVOICING_STRIPE_SECRET_KEY:-}
```

All within the strict parser's subset (2-space indent, block maps, sequences of
scalars, JSON flow sequences, comments on their own lines). `command:` appends
to the image's `ENTRYPOINT ["/bin/stripe-mock","-http-port","12111","-https-port","12112"]`,
so the mock still listens on 12111.

### 3.2 Behaviour

- `docker compose up --build` — `web` only; `tools` profile inactive; the mock is
  neither pulled nor started. Key absent → `null`. With a key:
  `docker compose --env-file .env.local up --build`.
- `docker compose run --rm --build test` — **unchanged**: `network_mode: none`,
  no mock, no pull, the contract cases report as skipped. The unit half is fully
  runnable without stripe-mock; that is the T3 property and it is untouched.
- `docker compose run --rm --build contract && docker compose down` — starts
  stripe-mock via `depends_on`, runs the whole suite with the contract cases
  live, then `down` stops the mock (`--rm` removes only the run container).
  Readiness is the contract test's own ≤ 10 s poll (§2.10 K0): a compose
  healthcheck on the mock is impractical because every mock endpoint answers 401
  without a key and a key literal in compose.yaml is banned, and `condition:` is
  a nested map the strict parser does not read.
- **Offline**: the first `contract` run pulls the image once (registry access at
  pull time, like `npm ci` at build time — build-time network was always
  expected); every later run works with no internet. Test-time egress is
  impossible on both services: `test` has no network; `contract` and the mock sit
  on an `internal: true` network with no gateway.
- Worktree runs use a distinct project name so the main checkout's
  `asc-invoicing-web-1` (8348) and `asc-chat-server-1` (8347) are untouched:
  `docker compose -p asc-invoicing-as38 --project-directory <worktree>/apps/invoicing run --rm --build contract`,
  and `-p asc-invoicing-as38 down` afterwards.

### 3.3 `deploy-shape.test.js` amendments (each is a literal move, not a loosening)

1. Services literal `['web', 'test']` → `['web', 'test', 'stripe-mock', 'contract']`.
2. 'both services build from the REPO ROOT…' → iterate services **with `build`**
   (exact set `['web','test','contract']` asserted first); assert `stripe-mock`
   has `image` and no `build`.
3. 'amd64 platform pin…' → `platform === 'linux/amd64'` on **all four**;
   `build.platforms` deepEqual `['linux/amd64']` on the three with `build`.
4. New: 'stripe-mock is the pinned public image with no ports' —
   `image === 'stripe/stripe-mock:v0.203.0'` (exact string, not `latest`, not a
   bare `stripe/stripe-mock`), `ports` undefined, `profiles` deepEqual `['tools']`,
   `command` deepEqual `['-strict-version-check']`, `networks` deepEqual `['stripe-mock']`.
5. New: 'the contract service is the test service attached to stripe-mock' —
   same build as `test`, `profiles ['tools']`, `depends_on ['stripe-mock']`,
   `networks ['stripe-mock']`, `command ['node','--test']`, no `ports`, no
   `volumes`, no `network_mode`.
6. New: 'the stripe-mock network has no egress and web is not on it' —
   `COMPOSE.networks['stripe-mock'].internal === 'true'`; `web.networks` undefined;
   `test.network_mode === 'none'` (already asserted; keep).
7. 'no credential is named anywhere in compose.yaml' → rename 'no credential
   VALUE appears in compose.yaml, and every secret-shaped variable is a
   pass-through': per-service exact environment lists — `web`
   `['INVOICING_BIND=0.0.0.0','INVOICING_PORT=8348','INVOICING_STRIPE_SECRET_KEY=${INVOICING_STRIPE_SECRET_KEY:-}']`,
   `contract` `['ASC_STRIPE_MOCK_URL=http://stripe-mock:12111']`, `test` and
   `stripe-mock` none (total literal 2 → 4); any entry whose NAME matches
   `/SECRET|TOKEN|KEY|PASSWORD/i` must have VALUE exactly `${<same name>:-}`;
   replace the whole-text word regex `/stripe|secret|token|api[_-]?key|password/i`
   (which the word "stripe-mock" and the variable name now legitimately trip)
   with a credential-VALUE regex `/\b(sk|rk)_(test|live)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+/`
   that must NOT match `COMPOSE_TEXT`.
8. `IGNORE_PATTERNS.length` 5 → 6; assert `'**/.env.local'` included.

---

## 4. Key files

| File | Change |
|---|---|
| `apps/invoicing/lib/stripe/custody.js` | NEW — three frozen tables, `ACCOUNT_ID`, `StripeCustodyError`, `guardRequest`; load-time check that no allowlisted row matches a forbidden prefix |
| `apps/invoicing/lib/stripe/client.js` | NEW — `createStripeClient`, `encodeForm`, `StripeApiError`, `StripeTransportError`, the seven-step pipeline; exactly five exports |
| `apps/invoicing/lib/stripe/transport.js` | NEW — `fetchTransport`; the one `fetch` token in product source, on the exact line §2.9 pins |
| `apps/invoicing/lib/config.js` | +1 `SCHEMA` row (`stripeSecretKey`, secret); `redacted()` shows `null` for an unconfigured secret |
| `apps/invoicing/compose.yaml` | + `stripe-mock`, `contract`, top-level `networks`; `web` gains the pass-through env entry (§3.1) |
| `apps/invoicing/test/stripe-client.test.js` | NEW — G1–G9, C1–C16, T1–T4 (§2.10) |
| `apps/invoicing/test/stripe-mock.test.js` | NEW — K0–K11, self-skipping (§2.10) |
| `apps/invoicing/test/config.test.js` | literals: `SCHEMA.length` 7 → 8; prefixed count 6 → 7; `secret` list `[]` → `['INVOICING_STRIPE_SECRET_KEY']`; defaults/overrides gain `stripeSecretKey: null`; rename 'no setting is required and none is a secret at AS-37' to reflect the first secret; + 'an unconfigured secret redacts to null, a configured one to [redacted]' |
| `apps/invoicing/test/dependency-policy.test.js` | §2.9 items 1–7: tightened/added `OUTBOUND_CLIENTS` rows, three `SANCTIONED` entries, source count 11 → 14, leak test retargeted with exact file allowlists |
| `apps/invoicing/test/deploy-shape.test.js` | §3.3 items 1–8 |
| `apps/invoicing/test/harness.test.js` | `EXPECTED_TEST_FILES` + `stripe-client`, `stripe-mock`; literal 6 → 8 |
| `apps/invoicing/README.md` | commands (add the contract run + `down`), "Giving the app a key" (`.env.local`, `--env-file`, what absent means), reconcile "no `.env*` file" → "no COMMITTED `.env*`; an optional gitignored `.env.local`", stripe-mock section (not a signup, offline after first pull), `lib/stripe/` in Layout, AS-38 obligation bullet rewritten as landed + the rule for adding endpoint rows |
| `/.dockerignore` | + `**/.env.local` |
| `/.gitignore` | comment fix only (`env_file` → interpolation / `--env-file`); the two entries are already present and unchanged |

Not touched: `app.js`, `server.js`, `routes/*`, `lib/health.js`, `lib/views.js`,
`lib/vendor.js`, `Dockerfile` (`COPY apps/invoicing/lib ./lib` already carries
`lib/stripe/`), `package.json` (zero new dependencies), and the four protected
top-level markdown files (proposed wording in §9).

---

## 5. Acceptance criteria

Each is independently checkable by QA from the worktree with the commands in
§3.2 (`-p asc-invoicing-as38`). "Suite" means `docker compose run --rm --build test`
unless stated.

1. Suite exit 0 in the `test` service (`network_mode: none`, no key, no mock);
   output shows exactly **8 test files**, `fail 0`, and `skipped` equal to the
   number of K cases (12: K0–K11) — the contract half is visibly skipped, not
   silently passed.
2. `docker compose run --rm --build contract` exit 0 with `skipped 0` and the
   same 8 files; `docker compose down` afterwards leaves no `asc-invoicing-as38`
   containers.
3. `docker compose up --build` (no `.env.local`, nothing exported) boots; the
   startup line contains `"stripeSecretKey":null`; `GET /healthz` is 200 with the
   same three checks as before (`config`, `vendor_assets`, `views`); stripe-mock
   is neither pulled nor started (`docker compose ps -a` shows only `web`).
4. `docker compose --env-file .env.local up --build` with a file containing
   `INVOICING_STRIPE_SECRET_KEY=sk_test_x` prints `"stripeSecretKey":"[redacted]"`
   and the literal `sk_test_x` appears nowhere in the container's stdout
   (`docker compose logs web | grep -c sk_test_x` → 0). Remove the file afterwards.
5. `git status` in the worktree shows no `.env.local`; `git check-ignore -v apps/invoicing/.env.local`
   names the root `.gitignore` entry; `/.dockerignore` contains `**/.env.local`.
6. **Description negative case:** a connected call without `account` is refused
   (`StripeCustodyError`, `code: 'missing_account'`) with zero transport calls (C5, G3).
7. **Description negative case:** a call carrying `transfer_data` is refused,
   flat and nested (`transfer_data[destination]`, `subscription_data[transfer_data][…]`,
   percent-encoded brackets), with zero transport calls (C2, C4, G7).
8. **Description negative case:** a call carrying `on_behalf_of` is refused, flat
   and nested, with zero transport calls (C3, C4, G7).
9. All 10 `FORBIDDEN_PARAMS` names refused at every nesting depth in body and
   query (G7: 60 refusals counted), each with a `cite` and `reason` (G1).
10. An endpoint off the nine-row allowlist is refused (`endpoint_not_allowed`)
    before scope or parameter checks (G2, C6); `POST /v1/transfers`,
    `POST /v1/charges`, `POST /v1/payment_intents` all refused.
11. Platform calls are exactly three and strict both ways: a platform row with a
    `Stripe-Account` header → `unexpected_account`; without `platform: true` →
    `platform_not_declared`; a connected row with `platform: true` → refused (G5, G6).
12. Malformed account ids (`cus_123`, `acct_`, `ACCT_x`, `acct_x y`) → `invalid_account_id` (G4).
13. A custody refusal fires with `apiKey: null` (C7); a clean call with no key is
    `ConfigError` naming `INVOICING_STRIPE_SECRET_KEY` with zero transport calls (C8).
14. The transport receives headers exactly `{accept, stripe-version, content-type (POST), stripe-account (connected), idempotency-key (when given), authorization}`
    — lower-case names, nothing else, objects frozen (C9, T1).
15. Every POST carries `content-type: application/x-www-form-urlencoded`,
    including an empty body; GET params travel in the query (C11); K5 finalizes
    with an empty body against the mock.
16. `encodeForm` produces Stripe bracket notation for nested objects and arrays,
    stringifies numbers/booleans, maps `null` → `''`, omits `undefined`, refuses
    `Date`/`BigInt`/function and non-plain `params` (C10).
17. Idempotency key sent verbatim on POST, refused on GET and outside 1–255 chars
    (C12); echoed by the mock (K10).
18. `StripeApiError` carries `status`, `type`, `code`, `param`, `requestId` and
    never the key or request headers; non-JSON and network/timeout/redirect
    failures are `StripeTransportError` with the right `code` (C13, C14, T2–T4).
19. A redirect is refused and the key is never sent to a second host (T2: the
    listener saw exactly one request).
20. `client.js` exports exactly the five names in §2.2 (C1); `fetchTransport` is
    not reachable through it.
21. `custody.js` throws at import if any allowlisted row matches a forbidden
    prefix (M7 demonstrates it).
22. `dependency-policy.test.js` green with the wrapper present: source count 14,
    `SANCTIONED` length 3, each sanctioned line present exactly once where declared.
23. `dependency-policy.test.js` red with a planted second egress: M5a (a `fetch`
    in `routes/health.js`) and M5b (a transport import in `routes/pages.js`) each
    fail the construct test with `file:line: construct` in the message.
24. The leak test allows `STRIPE_` tokens in exactly `compose.yaml`, `lib/config.js`,
    `lib/stripe/client.js`; `application_fee` in exactly `lib/stripe/custody.js`;
    the money-regex exemption is exactly `lib/stripe/custody.js` and is used;
    the `stripe` SDK import is banned everywhere.
25. `deploy-shape.test.js` pins §3.3 items 1–8; in particular
    `image === 'stripe/stripe-mock:v0.203.0'`, no `ports` on the mock,
    `networks['stripe-mock'].internal === 'true'`, `web` not on that network,
    `test` still `network_mode: none`, and every secret-shaped variable is a
    `${NAME:-}` pass-through.
26. K11 shows the mock returning 200 to the raw forbidden shape and the client
    refusing the same call with zero transport calls — the spike §1 measurement
    reproduced inside the suite.
27. K1 shows the mock rejecting a wrong `Stripe-Version` (400) — the client's
    version constant is load-bearing; K9 shows the mock rejecting an unknown
    parameter — K2–K8 are not vacuous.
28. `process.env.INVOICING_STRIPE_SECRET_KEY` is undefined during both the `test`
    and `contract` runs (C15).
29. **The ban is load-bearing:** every mutation in §6 (M1–M7, P1–P2) turns the
    suite red on the predicted tests and the restored, rebuilt suite is green
    (exit 0, `TREE_CLEAN`).
30. No file in `apps/invoicing` exceeds 1,200 lines (existing test; the new test
    file is the closest — record its line count in the review comment).
31. `package.json`/`package-lock.json` unchanged: zero new dependencies.
32. `app.js`, `server.js`, `routes/*`, `lib/health.js` unchanged
    (`git diff master...feat/AS-38-stripe-custody-guard --stat` shows none of them).
33. `README.md` (app) documents the three commands, the key file, its absence,
    and the stripe-mock reasoning; the sentence "There is no `.env*` file in this
    directory" is gone.
34. No key-shaped value (`/\b(sk|rk)_(test|live)_/`) appears anywhere in the diff
    except `sk_test_stripemock` in `test/stripe-mock.test.js` and the `sk_test_x`
    example in the README's `.env.local` snippet (`git diff master... | grep -nE '\b(sk|rk)_(test|live)_'`).

---

## 6. Falsification recipes

House technique (AS-53 §4.1; README "Mutation discipline"): one indivisible
subshell, backup + `EXIT` trap, **assert the mutation applied**, observe, let the
trap restore, prove the tree clean, **rebuild** and re-run. Absolute paths;
`-p asc-invoicing-as38`; never `cd` into the worktree for `lattice` (run
`lattice` from the main checkout only).

```bash
WT=/Users/forrest/Code/american-software-company/.worktrees/AS-38
APP=$WT/apps/invoicing
F=$APP/<file under mutation>
(
  cp "$F" "$F.as38bak" && trap 'mv -f "$F.as38bak" "$F"' EXIT
  <MUTATE>
  <ASSERT-APPLIED> || { echo "MUTATION DID NOT APPLY"; exit 99; }
  DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 docker compose -p asc-invoicing-as38 --project-directory "$APP" run --rm --build test
  echo "MUTANT_EXIT=$?"
)
git -C "$WT" diff --exit-code -- apps/invoicing && echo TREE_CLEAN
DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 docker compose -p asc-invoicing-as38 --project-directory "$APP" run --rm --build test
echo "RESTORED_EXIT=$?"
```

Expected: `MUTANT_EXIT=1`, the named tests failing and **nothing else**;
`TREE_CLEAN`; `RESTORED_EXIT=0`. The implementer records the actual
`tests/pass/fail/skipped` quadruple per mutation in a Lattice comment (AS-53 §12
style — predictions here are by name; the numbers come from the run). QA re-runs
every recipe cold.

| # | File | MUTATE (perl, one line) | ASSERT-APPLIED | Predicted failing tests |
|---|---|---|---|---|
| **M1** guard bypassed at the client | `lib/stripe/client.js` | `perl -pi -e 's/^  const guarded = guardRequest\(unsigned\);$/  const guarded = unsigned;/' "$F"` | `grep -q '^  const guarded = unsigned;$' "$F"` | C2, C3, C4, C5, C6, C7 (6). **G1–G9 stay green** — that is the point: guard-level tests alone would not have caught this |
| **M2** ban emptied | `lib/stripe/custody.js` | `perl -0pi -e 's/^export const FORBIDDEN_PARAMS = Object\.freeze\(\[\n[\s\S]*?\n\]\);/export const FORBIDDEN_PARAMS = Object.freeze([]);/m' "$F"` | `grep -q '^export const FORBIDDEN_PARAMS = Object.freeze(\[\]);$' "$F"` | G1, G7, C2, C3, C4, C7 (6). The dependency-policy leak test is NOT expected to notice: `'/v1/application_fees'` in `FORBIDDEN_ENDPOINT_PREFIXES` keeps `application_fee` present in custody.js, and whether the raw-text money exemption stays "used" depends on comments — if it goes red too, record it, but the guard- and client-level tests are the witnesses here |
| **M3** scope check removed | `lib/stripe/custody.js` | `perl -pi -e 's/^  checkScope\(row, request\);$/  void row;/' "$F"` | `grep -q '^  void row;$' "$F"` | G3, G4, G5, G6, C5 (5) |
| **M4** header dropped after the guard | `lib/stripe/client.js` | `perl -pi -e 's/^  const headers = \{ \.\.\.unsigned\.headers, authorization: \x27Bearer \x27 \+ apiKey \};$/  const headers = { ...unsigned.headers, authorization: \x27Bearer \x27 + apiKey, \x27stripe-account\x27: undefined };/' "$F"` (`\x27` is a single quote — keeps the shell string single-quoted) | `grep -q "'stripe-account': undefined" "$F"` | C9 (1). The guard is green because it saw the header; **stripe-mock would not notice either** (it never reads `Stripe-Account`) — C9 is the only witness that the header reaches the wire, which is why it exists |
| **M5a** second egress: a `fetch` in a route | `routes/health.js` | `printf '\nexport const leak = () => fetch("http://127.0.0.1:1/");\n' >> "$F"` | `grep -q 'export const leak' "$F"` | dependency-policy 'no app source or manifest outside test/ contains an outbound HTTP client' with `routes/health.js:<n>: fetch` (1) |
| **M5b** second egress: transport imported by a route | `routes/pages.js` | `perl -0pi -e 's/\A/import { fetchTransport } from "..\/lib\/stripe\/transport.js";\n/' "$F"` | `head -1 "$F" \| grep -q 'transport.js'` | same test, `routes/pages.js:1: stripe transport import` (1) |
| **M6** sanctioned line reshaped | `lib/stripe/transport.js` | `perl -pi -e 's/^  const response = await fetch\(request\.url, init\);$/  const response = await globalThis.fetch(request.url, init);/' "$F"` | `grep -q 'globalThis.fetch' "$F"` | dependency-policy 'every sanctioned construct is present exactly where it is declared' AND the construct test (the hit is no longer on the sanctioned line) (2) |
| **M7** a forbidden endpoint allowlisted | `lib/stripe/custody.js` | `perl -0pi -e 's/^export const ALLOWED_ENDPOINTS = Object\.freeze\(\[\n/export const ALLOWED_ENDPOINTS = Object.freeze([\n  { method: "POST", path: "\/v1\/transfers", scope: "platform", reason: "MUTANT" },\n/m' "$F"` | `grep -q 'MUTANT' "$F"` | `custody.js` throws at import → `test/stripe-client.test.js` and `test/stripe-mock.test.js` both fail at load (2 file-level failures) |
| **P1** mock tag unpinned | `compose.yaml` | `perl -pi -e 's/^    image: stripe\/stripe-mock:v0\.203\.0$/    image: stripe\/stripe-mock:latest/' "$F"` | `grep -q 'stripe-mock:latest' "$F"` | deploy-shape 'stripe-mock is the pinned public image with no ports' (1) |
| **P2** mock network given egress | `compose.yaml` | `perl -pi -e 's/^    internal: true$/    internal: false/' "$F"` | `grep -q '^    internal: false$' "$F"` | deploy-shape 'the stripe-mock network has no egress and web is not on it' (1) |

The implementer writes the four pinned source lines exactly as the recipes
expect, each indented two spaces inside its function:
`const guarded = guardRequest(unsigned);` (client.js, `request()`),
`checkScope(row, request);` (custody.js, `guardRequest()`),
`const headers = { ...unsigned.headers, authorization: 'Bearer ' + apiKey };`
(client.js, `sign()` — string concatenation, not a template literal, so the
recipe stays single-quoted in the shell), and
`const response = await fetch(request.url, init);` (transport.js). `FORBIDDEN_PARAMS`
and `ALLOWED_ENDPOINTS` are `export const X = Object.freeze([` on one line,
one row per line, closed by `]);` at column 0 (M2 and M7 depend on that shape).
If a line must differ, the recipe in this plan is amended in the same commit,
with a comment saying so.

Also re-run, unchanged from AS-37/AS-53: V1 (`-e ASC_SELFTEST_MUTATE=1 test` exits 1).

---

## 7. Size and complexity

Derived estimate (lines, generous):

| | new | amended |
|---|---|---|
| `lib/stripe/custody.js` | ~170 (tables with citations are the bulk) | |
| `lib/stripe/client.js` | ~200 | |
| `lib/stripe/transport.js` | ~40 | |
| `test/stripe-client.test.js` | ~450 | |
| `test/stripe-mock.test.js` | ~220 | |
| `lib/config.js` | | +12 |
| `compose.yaml` | | +40 |
| `test/config.test.js` | | ±20 |
| `test/dependency-policy.test.js` | | +80 |
| `test/deploy-shape.test.js` | | +90 |
| `test/harness.test.js` | | ±4 |
| `README.md` (app) | | +50 |
| `/.dockerignore`, `/.gitignore` | | +1, ±2 |

≈ **14 files, ≈ 1,380 lines, of which product code ≈ 420**. That is over both
tripwires (~10 files / ~600 lines). Decision: **keep it whole**, for three reasons
written down so QA can hold me to them:

1. The description's VERIFICATION clause names the stripe-mock half as part of
   this task. Splitting it out would ship AS-38 not meeting its own description.
2. The value of the chokepoint *is* its tests. ~65% of the lines are tests and
   test-literal moves in four existing files that must change in the same commit
   as the code (or master goes red).
3. Three dependents (AS-41, AS-43, AS-44) wait on the module; a second round-trip
   for the contract half costs more ticks than the lines cost review time.

**Pre-agreed split line** if the implementer's cycle runs long: the unit half
(custody.js, client.js, transport.js, config row, `stripe-client.test.js`, the
four literal moves, `.dockerignore`) is committed and goes to `review` first
with ACs 1, 3–24, 28–34 in force; the contract half (compose `stripe-mock` +
`contract` + networks, `stripe-mock.test.js`, deploy-shape items 1–7, ACs 2,
25–27) is filed by the orchestrator as a follow-up carrying the description's
stripe-mock clause verbatim, and QA reviews AS-38 against the reduced set. Not
the default — the default is one task.

**Lattice complexity: `medium`** (already set on the task; kept). The design is
decided here and the code paths are short; what makes this a real task is the
falsification burden — nine mutations, two suites, a contract run under
emulation — and that is verification time, not design risk. `high` would be
right only if the transport had to do retries/streams or the guard had to
reason about values; it does neither.

---

## 8. Open questions (time-boxed; default applies when the box expires)

| # | Question | Default | Box |
|---|---|---|---|
| Q1 | Should the client refuse an `sk_live_`/`rk_live_` key when `config.env !== 'production'`? It would keep a live key out of a dev machine, at the cost of encoding Stripe's key grammar a second time. | **No** in AS-38 (no key format validation at all; Stripe's 401 is the validator). | Revisit when AS-51 resolves and a real test key exists; decide in AS-51's follow-up, not here. |
| Q2 | Retries / backoff for `StripeTransportError`. | **None** in the client. AS-43 decides with idempotency keys in hand (a retry without a key is a duplicate invoice). | AS-43 planning. |
| Q3 | `POST /v1/accounts`: the guard bans `controller[...]` (row 10) but not `type` — `type` is required on `/v1/account_links` (`account_onboarding`), so a global key ban is impossible and a per-endpoint value ban is out of scope. | AS-41 sends **no `type` and no `controller`** on `POST /v1/accounts` (Standard defaults, spike §1); its plan states this and QA checks the wire shape. `accounts.type` is deprecated in favour of `controller` in this spec version — note for AS-41. | AS-41 planning. |
| Q4 | Should `web` construct a client at boot (e.g. a `stripe: configured/unconfigured` health check)? | **No.** `lib/health.js` excludes Stripe deliberately and nothing consumes the client until AS-41. | Reopens in AS-41 if onboarding needs a boot-time key check. |
| Q5 | Contract run duration under amd64 emulation (mock cold start + 12 cases). | ≤ 10 s readiness poll; measure and record the wall time in the review comment. If > 30 s total, raise `platform` for `stripe-mock` only as a follow-up (the mock's platform is not the deploy target's concern). | Record at review. |

Decided, not open (recorded so nobody re-derives them): hand-rolled client, not
the SDK (stack decision §8.1 finding 4 — `new Stripe(key)` bypasses any guard);
`Stripe-Version: 2026-08-26.dahlia` sent on every call, validated by the mock's
strict mode; `baseUrl` is an option, never a config row; `.env.local` +
`--env-file`, not `env_file:`; both allowlist and denylist; exactly three
platform calls; values never inspected by the guard.

---

## 9. Proposed wording for metawork-owned files (not applied by this task)

For `CLAUDE.md` § Product, after "Every processor / ESP / carrier signup is
board-gated — including free and test-mode accounts": *"Pulling a public
container image (e.g. `stripe/stripe-mock`) is not a signup: it creates no
account, credential, or relationship with the vendor, and needs no approval
(decided in AS-38's plan, 2026-09-01)."* The metawork layer applies it if it
agrees; nothing in this task depends on it.

---

## 10. Stale or wrong items found while planning (for the record and the report)

1. `docs/engineering/01-stack-decision.md` §8.1 says "AS-38 carries a test for
   each" webhook failure mode. The task description assigns webhook verification
   elsewhere (AS-44). The description wins; the stack decision sentence is stale.
2. `apps/invoicing/test/deploy-shape.test.js` 'no credential is named' uses a
   word regex (`/stripe|…/i`) that any mention of stripe-mock trips. It was a
   proxy; §3.3 item 7 replaces it with a value regex and a pass-through rule.
3. `apps/invoicing/test/dependency-policy.test.js` leak test bans the very tokens
   (`STRIPE_`, `application_fee`) the guard must contain. Expected — it was
   written to hold until AS-38 — but the retargeting in §2.9 is a required part
   of this task, not a nice-to-have.
4. `apps/invoicing/README.md`: "There is no `.env*` file in this directory" —
   true of committed files, false once an operator has a `.env.local`; reworded.
5. Root `.gitignore` comment: "compose gains an env_file reference to it in
   AS-38" — it gains an interpolation pass-through instead (§2.8); comment fixed.
6. The spike wrote "stripe-mock 0.203.0" (Homebrew); the Docker tag is
   `v0.203.0` (with the `v`). Same release.
7. `accounts.type` is deprecated in this spec version in favour of `controller`
   — relevant to AS-41, not to the spike's evidence (defaults are unchanged).
8. `issuer` is a platform-side invoice parameter the task description does not
   name; found in the spec and added to the ban with a citation (§2.4 row 9).
9. The description says "Stripe-Account: acct_... header on every
   connected-account call" — correct, and stripe-mock never reads that header,
   so the mock cannot witness the requirement; only the fake-transport test (C9)
   can. Worth knowing before anyone proposes "just test it against the mock".
