# AS-44: D1 v1: webhook receiver — signature verification, idempotency, invoice + account state

Plan by `agent:cto-owen` (tech lead for this stage), 2026-09-02. Implementer:
`agent:developer-marcus`. Recommended reviewer: `agent:qa-priya` or
`agent:qa-ruben` (implementer ≠ reviewer). The task description in Lattice
(`lattice show AS-44`) is binding in every sentence; this plan says HOW.

Style and falsification conventions follow the AS-38/AS-39/AS-41/AS-43 plans:
every set-quantified assertion sits behind an exact count against a committed
literal; every guard is demonstrated failing under a mutation before it is
believed; recipe backups live OUTSIDE `apps/invoicing/`; a wrong prediction is
never fixed by narrowing a test.

**This task is unusual: three merged tasks deferred decisions to it by name.**
They are collected in §0 rather than re-derived, and every one of them is either
confirmed or overturned with reasons, in §3.

Contracts this plan builds against, read on master at `090375b`:

- **The idempotency store** (`lib/db/repositories/stripe-events.js`, AS-39 §2.4/§2.5).
  `recordOnce(eventId, type) -> boolean` is `INSERT … ON CONFLICT (id) DO NOTHING`
  returning `changes === 1`; `has(eventId)` reads. The `evt_` prefix is a DDL CHECK
  **and** an `assertStripeId`. No payload column, no `updated_at` (AS-39 §8 Q8).
- **The rank machine** (`lib/db/repositories/invoices.js:31`, AS-39 §2.5).
  `STATUS_RANK = { draft: 0, open: 1, uncollectible: 2, paid: 3, void: 3 }`, and
  `applyStripeSnapshot` returns one of four outcomes — `applied` / `fields` /
  `stale` / `conflict` — writing nothing for the last two. It is the **sole
  writer of `status`** after creation.
- **The readiness mapper** (`lib/connect/readiness.js`, AS-41 §3.4): a pure
  function written once and *already proven against an `account.updated`-shaped
  fixture* (`connect.test.js` R1), specifically so this task reuses it.
  `connectedAccounts.updateReadiness` writes all six fields atomically or none;
  the one `ready` derivation lives in AS-39's row mapper and nowhere else.
- **The invoice mapper** (`lib/invoices/mapping.js`, AS-43 §3.6): a pure Stripe
  invoice object → the exact ten-key snapshot, **deliberately omitting `sentAt`
  and `lastPaymentFailedAt`** because a `null` for either would erase a recorded
  fact. Already proven against an `invoice.paid` event's `data.object`
  (`invoices.test.js` R1) and against the erasure it prevents (R23).
- **The reconciliation guard** (`lib/invoices/lifecycle.js:297`, AS-43 §3.7 as
  reworked in its cycle 1): `invoice.amountDueMinor === invoice.totalMinor`,
  checked on **the mirror row** in `run()` with no predicate of its own. Its
  cycle-1 defect was a guard reachable on one path but not another; the fix moved
  it onto the mirror — **which means it now also holds for invoices this task
  moves to `open`** (§3.9).
- **No body parser is mounted app-wide** (`app.js`; AS-43 §3.3 reason 1 is
  literally "AS-44 must see the RAW request body"). `express.urlencoded` is
  mounted per route inside `invoiceRoutes`, so `/webhooks/stripe` is untouched by
  construction. Verified by reading, and made mechanical by §5.4's new concept row.
- **The client pipeline** (`lib/stripe/client.js`) and **the custody guard**
  (`lib/stripe/custody.js`). **This task calls neither.** It is the first
  Stripe-touching task in this app that makes **zero Stripe calls** (§3.10), and
  that is a structural property, not a coincidence.

### Evidence gathered while planning (measured on master at `090375b`, not recalled)

Every baseline below is a real count taken from the shipped tree; §7's
assert-applied steps depend on them being right, and three recipes across two
tasks earlier today were unrunnable because a baseline was guessed.

| Grep (product source: `app.js server.js lib routes`) | Count today |
|---|---|
| `express\.json(` in `app.js` | **0** |
| `express\.(json\|urlencoded\|raw\|text)\s*(` anywhere | **1** — `routes/invoices.js:197` only |
| `createHmac` or `timingSafeEqual` anywhere | **0** |
| `node:crypto` importers | **1** — `lib/db/database.js:10` (`randomUUID`) |
| `STATUS_RANK` files | **1** — `lib/db/repositories/invoices.js` |
| `applyStripeSnapshot` **called** (not in a comment) | **1** product caller — `lib/invoices/lifecycle.js:332` |
| `"/webhook` or `'/webhook` string literal | **0** |
| committed test-file count (`harness.test.js`) | **12** |
| committed source-file count (`dependency-policy.test.js`) | **32** |
| `SCHEMA.length` / INVOICING-prefixed (`config.test.js`) | **10** / **9** |
| compose environment entries / secret-shaped (`deploy-shape.test.js`) | **4** / **1** |

---

## §0 The three deferrals, collected

These are the decisions three merged plans handed to this one by name. Each is
answered in §3 with reasons; this section only says what was handed over, so a
reader can check that nothing was quietly dropped.

| From | What was deferred | Answered in |
|---|---|---|
| **AS-39 §8 Q6** | What does AS-44 do with `outcome: 'conflict'`? Default: *"Log at error, acknowledge the webhook (200 — retries cannot fix it), and optionally `GET /v1/invoices/{id}` then `applyStripeSnapshot` with Stripe's current truth. The mirror never guesses."* | **§3.8** — default **CONFIRMED**; the optional re-fetch **REJECTED**, with three reasons |
| **AS-39 §8 Q8** | Does the event row store a payload? Ruled *"No — the row is an idempotency marker, not a log. AS-44 may add a `payload` by migration if debugging needs it."* | **§3.5** — ruling **UPHELD**, no migration; the debugging record is Stripe's own 30-day event log |
| **AS-39 §2.5** | `stripe_events` is *"specifically your idempotency store"*, `recordOnce` joining the caller's transaction | **§3.5** |
| **AS-41 §3.4** | `lib/connect/readiness.js` written pure *"so you could reuse it for `account.updated`"*, already proven against an event-shaped fixture | **§3.7** — imported unchanged; not re-derived, not copied |
| **AS-41 §3.5 / §9 Q4** | Last-writer-wins readiness, boxed for AS-44 to *"re-derive the conflict analysis with event timestamps in hand"* | **§3.7** — **CONFIRMED** with the timestamp analysis it asked for; a monotonic `syncedAt` comparison is considered and **rejected**, with the two facts that kill it |
| **AS-43 §3.10** | `paid` / `void` / `uncollectible` / `lastPaymentFailedAt` are AS-44's to write | **§3.6** |
| **AS-43 §3.6** | The mapper omits keys whose `null` would erase a recorded fact | **§3.6** — and this task **adds a second writer of `sentAt`**, a deliberate amendment to AS-43's boundary table, in §3.6 and §11 item 3 |
| **AS-43 Review Cycle 1** | The defect was a guard reachable on one path but not another; the fix moved the check onto the **mirror row** — *"which now also holds for invoices your webhook moves to `open`"* | **§3.9** — stated as a cross-task consequence and **tested** (W17), in both directions |

---

## §1 Scope

### 1.1 In scope

1. A pure signature verifier, `lib/webhooks/signature.js` (§3.2): raw bytes +
   `Stripe-Signature` header + secret + clock → verified, or a `SignatureError`
   with a fixed reason code. No I/O, no config, no database — the `custody.js`
   purity precedent, and the reason this task is genuinely unit-testable.
2. A receiver service, `lib/webhooks/receiver.js` (§3.4–§3.8): dispatch by event
   type, locate the target, and apply inside one transaction with
   `stripeEvents.recordOnce`. **Synchronous throughout** (§3.5).
3. One route, `routes/webhooks.js` (§3.3): `POST /webhooks/stripe`, raw body,
   verify, receive, map outcome → status. **Registered only when the signing
   secret is configured** (§3.3.1).
4. One config row: `webhookSecret` / `INVOICING_STRIPE_WEBHOOK_SECRET`, optional,
   `secret: true` (§4), plus its compose pass-through — the AS-38 key pattern,
   reused exactly.
5. `app.js` mounts the router second, immediately after `/healthz` (§3.3.2).
6. One word added to `lib/invoices/mapping.js`: `isoFromEpochSeconds` becomes an
   export (§3.6). No key set moves, no behaviour changes.
7. `test/webhooks.test.js` — S-cases (the verifier, pure) and W-cases (the route,
   over real HTTP through `withServer`). **No mock-gated cases exist in this task
   and that is not an omission** (§5.3).
8. Amendments to the four existing tests whose committed literals this task moves
   (harness, dependency-policy, config, deploy-shape), `test/helpers/server.js`,
   and the app README (§5.4).

### 1.2 Not in scope (the description's NOT list, mirrored, plus who owns it)

- **Any UI, any rendering, any `GET`** — **AS-48** (screens 3 and 5) renders
  status. This task adds one POST and no view.
- **Reminder emails or cadences** (row C-39, OUT). Nothing here sends anything.
- **Retry, alerting or queueing infrastructure beyond idempotent handling.** No
  queue, no dead-letter store, no backoff, no worker. The receiver is synchronous
  and answers after the work is durable (§3.3.3); v1's worst day is a missed
  webhook recovered by re-reading the invoice through the wrapper.
- **Any Stripe API call** — including `GET /v1/events/{id}` re-fetch (§3.8 Q2) and
  `GET /v1/invoices/{id}` (AS-43 kept "five POSTs, zero GETs"; this task keeps
  *zero calls*). **No allowlist row is added and `lib/stripe/custody.js` is not
  edited** (§6 AC 20).
- **Any schema change, any migration.** `SCHEMA_VERSION` stays 1, `MIGRATIONS`
  stays one row, nothing under `lib/db/**` is edited (§4).
- **Authentication** — **AS-40**. A webhook has no session and needs none; this
  task does not touch `resolveFreelancerId` and adds no second identity seam.
- **Real delivery, real ordering, real latency, and agreement with Stripe's own
  HMAC** — **AS-50**, gated on AS-51. Named precisely in §5.5, restated in the
  review comment, not resolved.
- **No Stripe account, no signup, no board ask.** Everything verifies against
  computed fixtures, offline, in the mountless `test` service.

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

- **new (4):** `apps/invoicing/lib/webhooks/signature.js`,
  `apps/invoicing/lib/webhooks/receiver.js`,
  `apps/invoicing/routes/webhooks.js`,
  `apps/invoicing/test/webhooks.test.js`
- **modified (10):** `apps/invoicing/app.js`, `apps/invoicing/lib/config.js`,
  `apps/invoicing/lib/invoices/mapping.js` (one word: an `export`),
  `apps/invoicing/compose.yaml`, `apps/invoicing/test/helpers/server.js`,
  `apps/invoicing/test/config.test.js`, `apps/invoicing/test/harness.test.js`,
  `apps/invoicing/test/dependency-policy.test.js`,
  `apps/invoicing/test/deploy-shape.test.js`, `apps/invoicing/README.md`

**Not modified, and that is a claim to check** (§6 AC 20): everything under
`apps/invoicing/lib/db/**` (no migration, no repository change),
`lib/stripe/custody.js`, `lib/stripe/client.js`, `lib/stripe/transport.js`,
`lib/connect/onboarding.js`, `lib/connect/readiness.js`,
`lib/invoices/lifecycle.js`, `lib/health.js`, `routes/assets.js`,
`routes/connect.js`, `routes/health.js`, `routes/invoices.js`,
`routes/pages.js`, `server.js`, `Dockerfile`, `package.json`,
`package-lock.json`, and every test file not listed above.

## §3 Design

### 3.1 What the receiver is, in one sentence

**A verified Stripe event is applied to the mirror by writing a snapshot derived
entirely from the event's own bytes, exactly once, through machinery that already
exists.** Everything below is the consequence of taking that sentence literally:
the verifier is pure because the event's bytes are all it needs; the receiver
reads no clock because every timestamp it writes is in the event; the ledger is a
belt rather than a mechanism because a snapshot derived from the event's bytes is
the same snapshot every time; and the ordering defence is AS-39's rank machine
because there is exactly one of those and it already converges.

### 3.2 Signature verification

`lib/webhooks/signature.js`, pure, importing only `node:crypto`:

```js
export const DEFAULT_TOLERANCE_SECONDS = 300;
export class SignatureError extends Error { /* name, reason, step: 'verify-signature' */ }
export function verifyStripeSignature({ payload, header, secret, nowMs,
                                        toleranceSeconds = DEFAULT_TOLERANCE_SECONDS }) -> { timestamp }
```

**The scheme.** Stripe signs `${t}.${payload}` with HMAC-SHA256 keyed on the
endpoint's signing secret, and sends `Stripe-Signature: t=<epoch seconds>,v1=<hex>`
(possibly several `v1=` during a secret rotation, and possibly other schemes we
must ignore rather than reject).

**The raw-body answer, which is the whole of this section's risk.** `payload` is
a **`Buffer`**, and the module refuses anything else (`reason: 'not_raw'`). The
signed material is built as `Buffer.concat([Buffer.from(\`${t}.\`, 'utf8'), payload])`
— **the request bytes are never turned into a string before they are hashed.**
That matters twice over:

1. The classic failure is an upstream JSON body parser mutating the bytes. This
   app has *no* app-wide parser (AS-43 §3.3 mounted its `urlencoded` per route
   precisely for this reason), and §3.3.2 keeps it that way structurally, but the
   verifier does not rely on that: it will not accept a `string` at all, so a
   future `req.body` that has been through `JSON.parse`/`JSON.stringify` cannot
   silently verify against a re-serialised payload. Key order, whitespace and
   `\uXXXX` escaping all survive a JSON round trip *unpredictably*; the only safe
   input is the bytes.
2. A UTF-8 payload (a client name with a `¢` or an emoji) hashes correctly by
   construction, because we never choose an encoding. S2 tests exactly that.

**The steps, in order, each with its own reason code:**

| # | Check | Reason on failure |
|---|---|---|
| 1 | `Buffer.isBuffer(payload)`, `typeof secret === 'string'` and non-empty | `not_raw` |
| 2 | header present and a string | `missing_header` |
| 3 | header parses: comma-separated `k=v` on the FIRST `=`; exactly one `t`, matching `/^\d+$/` | `malformed_header` |
| 4 | at least one `v1=` element | `no_v1` |
| 5 | `Math.floor(nowMs / 1000) - t <= toleranceSeconds` | `stale_timestamp` |
| 6 | some `v1` matches the digest | `no_match` |

Unknown schemes (`v0=`, a future `v2=`) are **ignored, not rejected** — Stripe
adds schemes, and a receiver that fails on an unrecognised one breaks on Stripe's
schedule rather than ours. A `v0` with no `v1` is `no_v1`, not `malformed_header`.

**Tolerance is 300 seconds, past-only, and both halves are deliberate.**
300 s is what Stripe's own libraries and CLI assume, so a value we pick
differently is a value we would have to defend against every future reader.
It is a module constant, **not** a config row: nothing about a deployment should
change it, and a setting nobody should tune is a setting that will be tuned. The
bound is on the **past only** — a `t` in the future is accepted. Reasoned rather
than copied: `t` is inside the signed material, so an attacker cannot mint a
future-dated event without the secret; there is therefore no security gain from a
future bound, while there is a real cost (a container clock running behind makes
every legitimate delivery look future-dated and the endpoint dies). The symmetric
failure — a clock running *ahead* by more than 5 minutes — rejects **every**
delivery with `stale_timestamp`, which is the loudest possible symptom and the
correct one.

**Comparison is constant-time, and the shape check is what makes that safe.**
Each `v1` candidate must match `/^[0-9a-f]{64}$/i` before it is converted; only
then is `crypto.timingSafeEqual` called, so it can never throw on a length
mismatch (which would turn a malformed signature into a 500). A candidate that
fails the shape check is skipped, not thrown on; if every candidate fails —
shape or compare — the result is `no_match`. **Reachability:** the shape check
runs for every candidate on every call, inside the same loop as the comparison;
there is no path to `timingSafeEqual` that skips it.

**The secret is used verbatim, `whsec_` prefix included** — that is Stripe's
scheme. This is called out because "strip the prefix" is a plausible-looking edit
that would be **invisible to a symmetric test fixture**: a suite whose signer and
verifier are the same code agrees with itself no matter what it computes. §5.3 S1
answers that with a **committed known-answer vector**, and §5.5 states honestly
what that does and does not prove.

**The error carries a reason code and nothing else.** Never the secret, never the
payload, never the expected digest, never the candidate. S13 asserts it over the
serialised error.

#### What an attacker can and cannot do at this boundary

**Cannot**, without the signing secret: forge an event; alter one byte of a
captured event (the digest covers the payload); move a captured event's timestamp
(the digest covers `t`); learn anything from the comparison's timing
(`timingSafeEqual`); learn whether the endpoint exists on a deployment that has
no secret configured (§3.3.1 — there is no route).

**Can**: replay a *captured genuine* delivery, byte for byte, within the 300 s
window. This is the reason idempotency is required rather than nice, and §3.5
bounds it to a no-op. Also: on a configured deployment, send unlimited garbage
and force an HMAC over up to the body limit each time — bounded by
`express.raw`'s `limit` (1 MB) and by the fact that **no database work happens
before verification**, so the cost of a forged request is one bounded hash.
Also: distinguish a configured deployment (400) from an unconfigured one (404).
Accepted: a configured deployment's endpoint is registered with Stripe and is
public by definition.

**Not defended, stated rather than implied**: an attacker who holds the signing
secret. The secret's confidentiality *is* this boundary. We also do not verify
that the event exists in Stripe's records (§3.8 Q2 rejects the re-fetch), and we
do not check source IPs (Stripe publishes no stable list we could pin without a
network call).

### 3.3 The route

`routes/webhooks.js` exports `webhookRoutes(config, { repos })`. **It takes no
`stripe` dependency**, and that absence is the structural proof of §3.10's
zero-calls claim — an unused dependency is an unused exemption (AS-39 §2.8's own
argument).

```js
router.post('/webhooks/stripe', express.raw({ type: '*/*', limit: '1mb' }), handler);
```

**Why `/webhooks/stripe` and not `/webhook`.** The path is configured in a
**third party's** system — Stripe's endpoint configuration and AS-50's
`stripe listen --forward-to localhost:8348/webhooks/stripe` — so it is expensive
to change after it is first used, in a way an internal route is not. A path that
names its sender is self-documenting in that external context. That is the
reason; a hypothetical second provider is not.

**Why `type: '*/*'`.** Stripe sends `application/json; charset=utf-8`, which
`{type:'application/json'}` would also match — but a request with a different or
absent content-type would then leave `req.body` unparsed, and the failure would
present as "empty payload" rather than as what it is. Matching everything means
the bytes are always captured and the only failure left is a signature failure.
The `1mb` limit is the bounded-work half of §3.2's DoS statement; over it,
body-parser's own 413 is returned (W19).

**The Buffer guard, and its reachability.** The handler's first act is
`if (!Buffer.isBuffer(req.body)) → 400 not_raw`. It runs on every request that
reaches the handler; there is exactly one handler and no branch before it.
Its *purpose* is to catch an upstream parser, and an upstream parser can be
introduced in exactly two places — `app.js` (an `app.use` before the mount) and
`routes/webhooks.js` itself. **Both are covered by §5.4's new `body parser`
concept row**, so the guard has a runtime witness (400) and a static witness (a
red test), and F3 shows both.

#### 3.3.1 The unset secret: the endpoint does not exist

The signing secret is minted locally by `stripe listen --print-secret` at run
time and is **not part of the board's handover**
(`docs/engineering/02-stripe-test-account-setup-directions.md` §3.4). So "no
secret configured" is the normal state of this repository, of every test run, and
of every developer's stack — not an error.

```js
export function webhookRoutes(config, { repos }) {
  const router = Router();
  if (config.webhookSecret === null) return router;   // ← no route is registered at all
  router.post('/webhooks/stripe', raw, handler);
  return router;
}
```

**Decision: an unset secret means the endpoint is ABSENT (404), not "reject
everything" (400/403).** Four reasons, in order of weight:

1. **It removes the surface instead of defending it.** "Reject everything" leaves
   a live, unauthenticated POST endpoint that still does work for anyone — buffers
   up to a megabyte, computes a hash over attacker-controlled bytes, allocates an
   error. Absent means no handler closure is ever created, so there is no work to
   provoke.
2. **It makes the security property structural rather than procedural.** There is
   no code path from an unconfigured deployment to `applyStripeSnapshot` or
   `updateReadiness` — not a path that returns early, a path that does not exist.
   A reviewer checks it by reading four lines.
3. **It leaks nothing to an unauthenticated caller.** A prober gets exactly what
   any unknown path gives: the same answer a machine not running this app gives.
4. **The operator still gets an unambiguous signal — on the authenticated side.**
   `startupLogLine` and `/healthz`'s `config` block both already print
   `"webhookSecret":null` via `config.redacted()`, with no code change. That is the
   right split: full information for whoever holds the logs, none for the caller.

**Rejected: 400/403 with a "not configured" body.** It is the option that makes a
misconfiguration *self-describing to the wrong audience*, and during AS-50's first
live run it would be indistinguishable in Stripe's dashboard from "your signature
is wrong" — the one distinction that run most needs.

**Rejected: a health check that fails when the secret is unset.** Unconfigured is
a legitimate state, so a check that fails on it would be red on every developer
stack and in the whole suite; a check that always passes proves nothing.
`/healthz` keeps its four checks (§4).

**What this does NOT mean, flagged for AS-50:** it does not make webhooks
optional. A deployment with no secret silently receives nothing, so AS-50's run
record must show the `whsec_` in place *before* the run, and the first thing to
check when no event lands is the boot line's `"webhookSecret"`.

#### 3.3.2 Mount position

`app.js`'s `ORDER IS LOAD-BEARING` block gains one entry, **second**, immediately
after `healthRoutes` and before `assetRoutes` (existing comments renumber 2→3 …
6→7):

```js
// 2. The Stripe webhook receiver (AS-44), before every other router: nothing
//    ahead of it may parse a body, and putting it here makes that property
//    visible in eight lines instead of eighty. Exact path, shadows nothing;
//    absent entirely when no signing secret is configured.
app.use(webhookRoutes(config, { repos }));
```

The mount line carries **no path string** (so the `/webhook route` concept row
stays pinned to `routes/webhooks.js` alone) and **no money word** (so the
`money representation` row does not move). Both are §5.4 traps.

#### 3.3.3 Status taxonomy, and why we answer after the work

| Condition | Class / step | Status |
|---|---|---|
| no signing secret configured | — (no route) | **404**, from express |
| `req.body` is not a Buffer (an upstream parser, or an unmatched content-type) | `SignatureError: not_raw` | **400** |
| missing / malformed `Stripe-Signature`; no `v1`; no match; stale `t` | `SignatureError: <reason>` | **400** |
| body is not JSON, or not an event envelope (`id`/`type`/`created`/`data.object`) | `WebhookEventError: parse-event` | **400** |
| verified; type not handled | — | **200** `ignored` |
| verified; this `evt_` already processed | — | **200** `duplicate` |
| verified; no local row for the object | — | **200** `unknown-target` |
| verified; applied | — | **200** `applied` / `fields` / `stale` / `conflict` / `readiness` |
| `data.object` is a shape the mapper or a repository rejects (`TypeError`, `ValidationError`) | its own class | **500** |
| anything else thrown | — | **500** |

Three decisions inside that table:

- **Envelope malformation is 400; `data.object` malformation is 500.** A payload
  that verifies but is not an event envelope means the signing secret is being
  used to sign something that is not a Stripe event — a bad request, and retrying
  cannot fix it. A well-formed envelope carrying an object shape we do not
  understand is a Stripe-side surprise: 500 makes Stripe retry, and because the
  failed event was **never recorded** (the transaction never commits), a deploy
  that fixes the mapper gets the event redelivered and applied. That recovery
  property is worth the noise, and W16 tests it end to end.
- **Accepted cost of that choice, stated rather than discovered later:** an event
  we can never process becomes a poison pill — Stripe retries for up to three days
  and can disable the endpoint. In a v1 with one operator watching, noisy beats
  silent; the alternative (200 and log) drops a real event where nobody looks.
  Boxed in §9 Q3 to AS-50's run.
- **We answer AFTER the work is durable.** Stripe's advice to answer 200 first and
  process asynchronously exists for handlers that do slow I/O; ours does a few
  synchronous SQLite writes and no network. Answering after buys the property that
  matters: **a 2xx means the event is durably resolved**, so Stripe's retry is
  exactly the recovery mechanism we want and we owe it no queue. The trigger to
  revisit is any handler that does I/O — which the description's NOT list forbids.

Error bodies are the house one-liner: `text/plain`, `${err.name}: ${err.step}\n`,
never the key, never request material. Success bodies are one line, `ok: <outcome>\n`
— genuinely useful in `stripe listen`'s console during AS-50, and visible only to
someone holding the secret.

**A third `statusFor` in this app, and the difference is again load-bearing.**
`ValidationError` is **400** in `routes/invoices.js` (a freelancer's form), **502**
in `routes/connect.js` (Stripe answered a call of ours), and **500** here (Stripe
pushed us a shape we do not understand, on a request that was already
authenticated). Each file carries a comment naming the other two. Do not merge them.

### 3.4 Which events, and which local record each belongs to

**Eight handled types.** `HANDLERS` is a frozen table keyed by event type; a type
not in it is `ignored` (§3.4.2). Each row is `{ locate, apply }`.

| Event type | `locate` (read-only, before the transaction) | `apply` (inside the transaction) |
|---|---|---|
| `invoice.created` | `invoices.getByStripeInvoiceId(obj.id)` | `applyStripeSnapshot(obj.id, map(obj))` |
| `invoice.finalized` | " | " |
| `invoice.sent` | " | `applyStripeSnapshot(obj.id, { ...map(obj), ...(current.sentAt === null ? { sentAt: iso(event.created) } : {}) })` |
| `invoice.paid` | " | `applyStripeSnapshot(obj.id, map(obj))` |
| `invoice.payment_failed` | " | `applyStripeSnapshot(obj.id, { ...map(obj), lastPaymentFailedAt: iso(event.created) })` |
| `invoice.voided` | " | `applyStripeSnapshot(obj.id, map(obj))` |
| `invoice.marked_uncollectible` | " | " |
| `account.updated` | `connectedAccounts.getByStripeAccountId(obj.id)` | `updateReadiness(obj.id, readinessFromAccount(obj, iso(event.created)))` |

`map` is `invoiceSnapshotFromStripe` (AS-43's, imported); `readinessFromAccount`
is AS-41's, imported; `iso` is `isoFromEpochSeconds` (§3.6). **No mapping logic is
written in this task.**

**`invoice.voided` and `invoice.marked_uncollectible` are handled although the
Lattice description's prose list omits them.** This is an expansion and is
recorded as one. Two merged artifacts assign them here by name — AS-43 plan §3.10
("Writes `paid`, `void`, `uncollectible` … from `invoice.*` events") and the
shipped `apps/invoicing/README.md` handoff bullet ("import
`invoiceSnapshotFromStripe` … for `invoice.created/finalized/paid/voided/
marked_uncollectible/payment_failed`") — and the cost is **two table rows and no
new mechanism**: their apply is byte-identical to `invoice.finalized`'s. Without
them the mirror would show "Sent — awaiting payment" for an invoice the freelancer
voided in their own Stripe Dashboard, which is not a gap but a lie; and AS-39's
`conflict` outcome would be unreachable, making §3.8's ruling vacuous. If a
reviewer disagrees, the removal is two lines and two tests (§9 Q5).

#### 3.4.1 Which local freelancer an event belongs to — and what if there is none

**We never resolve a freelancer, and that is the answer, not a dodge.** AS-39
designed both lookups owner-free *because their caller is a webhook with no
session*: `invoices.getByStripeInvoiceId` and
`connectedAccounts.getByStripeAccountId` key on UNIQUE columns and each returns a
row that already carries its own `freelancer_id`. So the join key is the Stripe
object id, never the event envelope.

**The envelope's `account` field is recorded in neither routing nor a check.**
Connect events carry a top-level `account: acct_…`. Using it to route would be a
second key for the same join; cross-checking it against the row's account would
catch only faults that cannot occur (`stripe_invoice_id` is UNIQUE, and Stripe ids
are globally unique). A check that can never fire is a check whose failure nobody
will understand when it does. Not added. (Named here so a reviewer sees it was
considered, not missed.)

**No local row → 200 `unknown-target`, no ledger row, log at info.** Three
reasons, and the third is the one that decides it:

1. It is **normal, not exceptional**. A Standard-controller account gives the
   freelancer their own full Stripe Dashboard (the spike's measured default), so
   they can and will create invoices we never made. Their events arrive here.
2. It is **also normal for accounts we do not own**: an `acct_` whose local row
   lost the create race (AS-41 §3.3 layer 2's inert orphan) emits `account.updated`.
3. **A non-2xx would be actively harmful.** Stripe retries every non-2xx for up to
   three days and can disable the endpoint. Answering 4xx/5xx to a *normal
   condition* means the freelancer's own dashboard activity eventually turns off
   our real webhooks. This is the single highest-cost mistake available in this
   task, and it is why `locate` returns `null` rather than letting
   `applyStripeSnapshot` throw `NotFoundError` (F9 breaks exactly that).

**Deciding by lookup, not by exception**, also keeps "not ours" distinguishable
from a genuine bug: a `NotFoundError` escaping to the route is a 500, and after
this task it can only mean the row vanished between `locate` and `apply` — which
nothing in this app can do, because nothing deletes.

#### 3.4.2 An event type we do not handle

**200 `ignored`, and NO ledger row.** The type check happens **before the
transaction opens**, so `recordOnce` is never called. Two reasons:

1. AS-39's invariant for that table is "a row exists **iff** the event was
   processed, atomically with its effects". An ignored event has no effects, so a
   row would be a false statement about our own history.
2. A recorded ignore is a trap for our future selves: the day we add a handler for
   that type, a redelivery of an already-recorded event would be skipped.

Verification still happens first: **an unverified request is rejected whatever its
type.** Order is verify → parse envelope → dispatch, and nothing about the type is
read before the signature is checked.

### 3.5 Idempotency: exactly where, and what a crash costs

```js
function receive(event) {
  const handler = HANDLERS[event.type];
  if (handler === undefined) return { outcome: 'ignored' };            // no transaction
  const target = handler.locate(repos, event);                          // one indexed read
  if (target === null) return { outcome: 'unknown-target' };            // no transaction
  return repos.transaction(() => {                                      // BEGIN IMMEDIATE
    if (!repos.stripeEvents.recordOnce(event.id, event.type)) return { outcome: 'duplicate' };
    return handler.apply(repos, event, target);
  });                                                                   // COMMIT
}
```

**`recordOnce` is called first inside the transaction, and the work is second.**
Both are inside **one** `repos.transaction`, which is AS-39's `BEGIN IMMEDIATE` /
`COMMIT` / `ROLLBACK` helper; `applyStripeSnapshot` and `updateReadiness` open
their own transactions and **join** the open one (AS-39 §2.2's join rule), so
there is exactly one commit.

**"What if the process dies between the two?" — there is no between.** The marker
and the effects are one commit. Die before it: nothing is written, no ledger row,
and Stripe's retry is processed normally (AS-39's E4 case already proves the
rollback leaves no marker). Die after it: the ledger row and the effects are both
durable; Stripe's retry finds `recordOnce` false and answers 200 `duplicate`
having written nothing. There is no window in which one exists without the other,
and that is the entire reason AS-39 put `recordOnce` behind the same transaction
helper as everything else.

**Ordering `recordOnce` first also serialises concurrent deliveries of the same
event**: the second transaction blocks on the write lock, then sees the row and
returns `duplicate`. Exactly-once, from the primary key.

**HARD RULE: the transaction callback is SYNCHRONOUS.** `transaction(db, fn)`
runs `fn()` and then `COMMIT`; an `async fn` would return a pending promise and
`COMMIT` would run before the work. The receiver makes no Stripe call and no I/O,
so **`lib/webhooks/receiver.js` contains no `async` and no `await` at all** — a
greppable, cheap invariant (AC 12, G1) rather than a convention.

#### Is idempotency doing real work, or is it a belt?

**Honest answer: for every handler in §3.4 it is a belt — and that is by design,
not by luck.** Every value any handler writes is derived from the event's own
bytes:

| Written value | Source | Reprocessing writes |
|---|---|---|
| `status`, both URLs, both amounts, `dueAt`, `finalizedAt`, `paidAt`, `voidedAt`, `markedUncollectibleAt` | `data.object`, via AS-43's mapper | identical bytes |
| `lastPaymentFailedAt` | `event.created`, converted | identical bytes |
| `sentAt` | `event.created`, converted, **only when currently null** | nothing, on any redelivery |
| readiness (six fields incl. `syncedAt`) | `data.object` + `event.created` | identical bytes |

**The receiver reads no clock.** That is the mechanical statement of the property
above, and it is what makes redelivery a no-op rather than a nearly-no-op. With
the ledger removed entirely, a redelivered event changes **only `updated_at`** and
the response body. **F4 proves exactly that**: if any case other than the two
duplicate cases goes red under F4, a handler is not a pure function of its event
and this section is false.

So the ledger earns its place for three other reasons, stated so nobody later
"simplifies" it away: (1) it is the audit record the description asks for — which
events did we process; (2) it is a cheap early exit under a retry storm, before
any snapshot work; (3) it is the belt that keeps a **future non-idempotent
handler** honest. **Trigger:** the moment any handler does something outside the
mirror — sends an email, increments a counter, calls Stripe — the ledger stops
being a belt and becomes the mechanism, and that task must say so in its plan.

**Safe to reprocess, per type:** `invoice.created` / `finalized` / `paid` /
`voided` / `marked_uncollectible` — the same snapshot re-applied yields `fields`
(same status) or `stale` (the mirror moved on), both writing the same or no
values. `invoice.payment_failed` — the same, plus a `lastPaymentFailedAt` that is
the event's own timestamp. `invoice.sent` — the conditional makes the second
delivery a strict no-op on that field. `account.updated` — a full six-field
snapshot written from the event, `syncedAt` included.

### 3.6 The two mappers, reused; and the one field this task adds a writer for

`invoiceSnapshotFromStripe` and `readinessFromAccount` are **imported unchanged**.
Neither is copied, wrapped, or re-derived; AS-43 R1 and AS-41 R1 already proved
each against an event-shaped `data.object` before this task existed, which is what
"one definition, two writers" was for.

**One word changes in `lib/invoices/mapping.js`:** `isoFromEpochSeconds` becomes
an `export`. It is the app's only epoch-seconds → ISO-with-milliseconds converter,
it is already tested through the mapper, and this task needs it for `event.created`.
A second copy in `lib/webhooks/` would be the one thing every convention in this
app forbids. **No key set moves** — `SNAPSHOT_KEYS` is untouched, so AS-43's
ten-key handoff contract is exactly as it shipped. §11 item 6 names the trigger
that would move the function to a shared module (a third consumer outside
`lib/invoices/`), following AS-43 §9 Q1's pattern for `resolveFreelancerId`.

**`sentAt`: this task adds the second writer, amending AS-43 §3.10's boundary
table.** That table says AS-43 writes `sentAt` from our clock and AS-44 writes it
never. That was written before anyone traced this path:

> `/v1/invoices/{id}/send` succeeds at Stripe → the process dies before
> `writeSnapshot` → the mirror has `sentAt: null` → more than 24 hours pass →
> the freelancer re-submits → `inv-send-<invoiceId>` is outside Stripe's
> idempotency window → **the client is emailed a second time.**

AS-43 §3.8 explicitly leans on that key to close the hole ("a send that succeeded
at Stripe but died before the mirror write is a replay, not a second email"),
which is true only inside the window. `invoice.sent` closes it permanently, from
the one source of truth about whether Stripe sent the email. The write is
therefore: **`sentAt` from `event.created`, and only when the mirror's `sentAt` is
null.**

Reachability of that condition — the guard's whole point is not to overwrite a
recorded fact, so the paths that can reach a `sentAt` write must be enumerated,
not just its placement. After this task there are exactly **two** writers of the
column: `lib/invoices/lifecycle.js#sendInvoice` (spread last, from our clock) and
this handler (conditional, from the event). Both go through
`invoices.applyStripeSnapshot`, which AS-39 makes the **only** writer of any
snapshot column. There is no third path: the mapper is forbidden to emit the key
(AS-43 §3.6, and `invoices.test.js` R1 asserts its absence), and `updateDraft`
cannot touch it (`DRAFT_KEYS` has three entries, none of them `sentAt`).
The condition is evaluated **inside the transaction**, against a row re-read under
the write lock, so it cannot race AS-43's writer. F5 breaks it in the direction it
exists to catch, and W12 pins both halves.

A pleasant consequence, recorded because it is the *right* behaviour rather than a
side effect: if the freelancer sends the invoice from their own Stripe Dashboard,
`invoice.sent` records it and AS-43's step 5 becomes a no-op. The client is not
emailed twice.

**`lastPaymentFailedAt` comes from `event.created`, not our clock.** Truer (it is
when the payment failed, not when we heard) and idempotent (a redelivery writes
the same value). This is the first place the "read no clock" rule earns something
concrete.

### 3.7 `account.updated`: the readiness half, and AS-41's Q4 closed

`readinessFromAccount(event.data.object, iso(event.created))` →
`connectedAccounts.updateReadiness(obj.id, patch)`. The `ready` derivation is not
here, not restated, and not re-derived: it lives in AS-39's row mapper, and **no
file in this diff names `chargesEnabled`, `payoutsEnabled`, `detailsSubmitted` or
`requirementsCurrentlyDue`** (AC 15, by grep, the AS-43 AC 5 pattern).

**`syncedAt` is the event's `created`, not our receipt time — and that is a
strengthening of AS-41 §3.5, not a violation of it.** AS-41's rule is that every
written snapshot is one freshly obtained from Stripe, stamped at *obtain* time,
never cached and never synthesized. For a webhook, the moment the snapshot was
obtained **is** the moment Stripe created the event. Using our receipt time would
claim a three-day-old redelivered event is fresh, which is a lie in a column named
`readiness_synced_at`.

**AS-41 §9 Q4 — "is last-writer-wins sufficient once AS-44's webhook writer
exists?" — is CONFIRMED with its default, now with the timestamps it asked for.**
The comparison I could now write is
`if (row.syncedAt !== null && incoming.syncedAt < row.syncedAt) skip` — the
`readiness_synced_at` column already exists and ISO-with-ms sorts
lexicographically, so it would cost three lines and no migration. **Rejected**, on
two measured facts rather than taste:

1. **`event.created` has one-second resolution.** Two `account.updated` events in
   the same second — exactly the burst that out-of-order delivery comes from —
   are indistinguishable, so the comparison degrades to last-writer-wins in the
   case it was built for.
2. **It would compare two different clocks.** AS-41's return-route writer stamps
   `syncedAt` from *our* container clock; this writer stamps it from *Stripe's*.
   A container clock running ahead would make legitimate webhooks look stale and
   be silently skipped — converting a self-healing staleness into a silent
   suppression. That is strictly worse than the problem.

The residual is unchanged from AS-41 §3.5 and remains bounded: a stale
"not ready" merely delays finalize until the next sync; a stale "ready" lets
AS-43 attempt a finalize that Stripe itself refuses at charge time, surfacing as
an ordinary `StripeApiError` — never a custody or funds-flow issue. **§9 Q4 boxes
the reversal to AS-50** observing a real out-of-order `account.updated` that
leaves a wrong readiness row.

### 3.8 Ordering, convergence, and the `conflict` ruling

**One machine, not two, and it is checked mechanically.** `STATUS_RANK` and
`applyStripeSnapshot` live in `lib/db/repositories/invoices.js` and nowhere else
— measured today: one file. This task adds a **second caller** of that function
and **no second copy of the rule**; §5.4 adds a dependency-policy concept row
pinning `STATUS_RANK` to that one file, so a future implementer who reimplements
ranking inside the receiver gets a red test rather than a review catch.

**How out-of-order and duplicate deliveries converge:**

| Sequence | Outcome | Mirror ends at |
|---|---|---|
| `finalized` → `paid` | `applied`, `applied` | `paid` |
| **`paid` → `finalized`** (the description's case) | `applied` (0/1→3, skip-ahead is just "up in rank"), then `stale` — **nothing written** | `paid`, with `finalizedAt` and both URLs present **from the `paid` event's own object** (a paid Stripe invoice still carries `hosted_invoice_url`, `invoice_pdf` and `status_transitions.finalized_at`) — so the `stale` discard loses nothing. W6 asserts this, and it is the specific reason the discard is safe |
| the same event twice | `applied`, then `duplicate` — nothing written, `updatedAt` unchanged | unchanged |
| `sent` and `payment_failed` in either order (both `open`) | `fields`, `fields` — disjoint columns | same either way |
| `voided` → `paid` (or the reverse) | `applied`, then **`conflict`** — nothing written | whichever terminal state arrived first |

The last row is the one non-convergence, and it is deliberate: `paid` and `void`
are the same rank because they are the one pair with **no transition between
them**. We cannot rank them, so we refuse to guess.

#### The `conflict` ruling — AS-39 §8 Q6 answered

**Confirmed: log at error, record the ledger row, answer 200. Overturned: the
"optionally re-fetch `GET /v1/invoices/{id}`" half is rejected.**

Confirmed, because:
- **200 is right.** A conflict is a decision we made, not a failure we suffered. A
  retry delivers the same bytes and reaches the same decision; a non-2xx would
  loop for three days and can disable the endpoint (§3.4.1 reason 3).
- **Error level is right.** It is the only outcome that means our mirror and
  Stripe disagree about a *terminal* state. It must be visible.
- **The ledger row is recorded**, and that is consistent rather than contradictory:
  the event *was* processed, and the correct effect was "write nothing". A
  redelivery is then a `duplicate`, which is the right answer.
- Contrast with `stale`, which is logged at **info**: `stale` is the designed
  behaviour on every out-of-order sequence and would cry wolf at error. AS-43's
  `writeSnapshot` logs `stale` at **warn** — for AS-43 a stale write means a
  webhook beat it, which is genuinely unexpected there. Different call site,
  different expectation, different level; recorded so the difference is not read
  as inconsistency.

Rejected, on three grounds:
1. **It would destroy the zero-Stripe-calls property** (§3.10), which is not
   cosmetic: it is what lets this receiver work on a deployment with no API key
   configured, and what keeps `routes/webhooks.js` free of a `stripe` dependency.
   Paying that for an unreachable branch is a bad trade.
2. **It is unreachable in practice.** `conflict` needs the mirror at `paid` and
   the event saying `void` (or the reverse), which needs a freelancer to void a
   paid invoice in their own Dashboard — which Stripe does not permit.
3. **A re-fetch cannot resolve it anyway.** Stripe's answer is one of the two
   same-rank states, and applying it is precisely the transition the rank machine
   exists to forbid. A "resolution" that overrides the rank machine is not a
   resolution; it is a bypass, and it would be the only place in the app where the
   mirror guesses.

### 3.9 The cross-task consequence AS-43's cycle 1 created

AS-43's reconciliation guard was moved onto **the mirror row** and given no
predicate of its own. Its author's stated reason was that it then "holds on every
path to `open`, including paths this task does not own. An invoice moved to `open`
by AS-44's `invoice.finalized` webhook is checked by the same predicate, because
AS-44 writes `amountDueMinor` through the same `applyStripeSnapshot`."

**This task is the first code that makes that sentence true, so this task tests
it.** The scenario is real, not contrived: our finalize call times out (502) but
Stripe finalized; the mirror stays `draft` with an `in_` attached;
`invoice.finalized` lands and moves it to `open` with Stripe's `amount_due`; the
freelancer re-submits the form. AS-43's `run()` now skips steps 3 and 4 and
reconciles a row **this task wrote**. W17 drives exactly that, in both directions:

- amounts agree → `POST /invoices/{id}/send` → 303, exactly one `/send` call;
- amounts disagree (the event carries `totalMinor + 1`) → **409
  `AmountMismatchError`**, zero `/send` calls.

Two consequences worth stating for the reviewer:
- **This task can now put a wrong `amountDueMinor` on the mirror.** It cannot
  invent one — it writes what a *signed* Stripe event says — and AS-43's guard is
  what stands between that value and an email to the client. That is the guard
  working as reworked, and it is why W17's second half is not optional.
- **`invoice.created` on a still-`draft` mirror writes Stripe's draft amounts**
  (typically `amount_due: 0`, before items are pushed). Benign, traced rather than
  assumed: reconcile only ever runs on a row `run()` just read or wrote, and any
  later path to `open` overwrites those fields from a finalize response or a
  finalized event. A `draft` row is never reconciled and never sent.

### 3.10 Custody, stated as a property of this diff

- **Zero Stripe calls.** No `stripe.request`, no import of `lib/stripe/client.js`,
  no allowlist row, no edit to `lib/stripe/custody.js` (AC 20). The custody guard
  is trivially satisfied because there is nothing for it to guard.
- Structural, not asserted: `webhookRoutes(config, { repos })` takes no `stripe`
  dependency, so a call cannot be added without changing the signature and the
  mount line.
- The existing `platform Stripe call` concept row stays
  `['lib/connect/onboarding.js']` — **unchanged, and that is a claim** (§5.4 item 4).
- Consequence that matters operationally: **a deployment with no API key can still
  receive and apply webhooks.** During AS-50 that decouples "Connect onboarding
  works" from "state sync works", which is worth having when something fails.

---

## §4 Compose / config / Dockerfile / schema / health

- **Schema: UNCHANGED.** No migration, no new column. `SCHEMA_VERSION` stays 1,
  `MIGRATIONS` stays one row, `db.test.js` and `repositories.test.js` are untouched
  and green. AS-39 §8 Q8 (a `payload` column on `stripe_events`) is **upheld with
  its default**: the only thing worth storing is the raw signed body, Stripe's own
  dashboard keeps every event and its payload for 30 days, and adding a column on
  the one table this task is about to start writing is exactly the move AS-43's
  cycle-1 ruling refused. §11 item 5 records the closure.
- **Health: UNCHANGED.** Four checks. An unconfigured secret is a legitimate state
  (§3.3.1), so a check on it would be red on every developer stack; a check that
  always passes proves nothing.
- **Dockerfile: UNCHANGED.** `COPY apps/invoicing/lib ./lib` and `./routes`
  already carry the new directories; `COPIES` stays 9.
- **Zero new dependencies.** `express.raw` is part of express 5's bundled
  body-parser; `node:crypto` is built in. `LOCK_ENTRIES` stays 70,
  `DIRECT_DEPENDENCIES` stays `['ejs','express']`, `package.json` and
  `package-lock.json` are byte-identical to master.
- **`lib/config.js`** — one SCHEMA row, inserted **after** `stripeSecretKey`
  (both secrets last), plus one sentence in the file's header narrative:

  ```js
  { key: 'webhookSecret', envVar: 'INVOICING_STRIPE_WEBHOOK_SECRET', type: 'string', default: null, required: false, secret: true },
  ```

  `type: 'string'`, not a new type, and **no format validation on the value** —
  deliberate: a `whsec_` prefix check would hard-code a Stripe convention Stripe
  can change, would produce a boot failure whose message is about a secret, and
  would buy nothing, because a wrong secret already fails every delivery
  immediately and unambiguously at the only place that matters. `config.test.js`
  exercises the row with a deliberately **not** secret-shaped placeholder, which
  doubles as the evidence that no format check exists.

- **`compose.yaml`** — one entry under `services.web.environment`, after the
  existing key pass-through, mirroring AS-38's pattern exactly:

  ```yaml
      - INVOICING_STRIPE_WEBHOOK_SECRET=${INVOICING_STRIPE_WEBHOOK_SECRET:-}
  ```

  **This compose change is required, unlike AS-41's zero-change.** Per
  `CLAUDE.md ## Infra` the app runs only under compose, so without the
  pass-through the secret cannot reach the container at all and AS-50 cannot run.
  The value never appears here: an unset host variable arrives as `''`, which
  `config.js` reads as unconfigured. `deploy-shape.test.js`'s existing refusal of a
  literal `whsec_[A-Za-z0-9]+` in `compose.yaml` (line 319) stays green **and now
  guards something real** — it was written before any `whsec_` could exist.
  `test`, `contract` and `stripe-mock` gain nothing.

## §5 Key files (one line each) and every test literal that moves

### 5.1 New

| File | One line | ~lines |
|---|---|---|
| `lib/webhooks/signature.js` | the pure verifier: raw bytes + header + secret + clock → verified or a reason code; the ONLY `createHmac` in the product (§3.2) | 120 |
| `lib/webhooks/receiver.js` | the eight-row `HANDLERS` table, locate-then-apply, the one transaction, the outcome vocabulary. **No `async`, no `await`, no clock** (§3.4–§3.8) | 210 |
| `routes/webhooks.js` | one route, raw body, the Buffer guard, envelope parse, `statusFor`; **no route at all when the secret is unset** (§3.3) | 140 |
| `test/webhooks.test.js` | S-cases (pure verifier) + W-cases (route over real HTTP) + G1; **one reason per test** (§5.3) | 800 |

### 5.2 Modified

| File | One line | Δ |
|---|---|---|
| `app.js` | mount `webhookRoutes(config, { repos })` second; renumber the order comments (§3.3.2) | +8 |
| `lib/config.js` | the `webhookSecret` row + one sentence of header narrative (§4) | +8 |
| `lib/invoices/mapping.js` | `isoFromEpochSeconds` becomes an export; one sentence saying why (§3.6) | +2 |
| `compose.yaml` | one pass-through entry (§4) | +1 |
| `test/helpers/server.js` | `configFor` gains a `webhookSecret` override + its JSDoc line | +2 |
| `test/config.test.js` | literals in §5.4 + the new row's cases | +30 |
| `test/harness.test.js` | literals in §5.4 | +3 |
| `test/dependency-policy.test.js` | literals in §5.4 + three new concept rows | +35 |
| `test/deploy-shape.test.js` | literals in §5.4 | +6 |
| `README.md` | the route, the second secret, the `stripe listen` line, the AS-48/AS-50 handoffs | +55 |

### 5.3 Test plan (`test/webhooks.test.js`)

**One reason per `test()`.** §7's predicted failing sets are exact only because
each negative case asserts exactly one refusal; a case that bundles three reasons
makes every prediction a lower bound. This is a deliberate structural choice, not
a style preference.

**There are no mock-gated cases in this task, and that is not an omission.**
stripe-mock validates *request shapes we send*; it emits no webhooks and receives
none, so it has nothing to say about a receiver. Every case here is offline in the
mountless `test` service, which is the strongest form of the description's "no
accounts, no network" claim — and the reason §5.5's residual is larger than
AS-41's or AS-43's.

**S — the verifier, called directly (pure, no server, no database):**

| # | Case |
|---|---|
| S1 | **the committed known-answer vector**: fixed `SECRET`, fixed `PAYLOAD` bytes, fixed `T`, and a **committed hex digest literal**. Accepts; and the module's own recomputation equals the committed literal. Carries a comment stating exactly what it proves (our algorithm cannot drift) and what it does not (agreement with Stripe — §5.5) |
| S2 | a valid signature over a payload containing multi-byte UTF-8 (a `¢` and an emoji in a client name) — the Buffer path, not a string path |
| S3 | **tampered payload** (one byte flipped) → `no_match` |
| S4 | **wrong secret** → `no_match` |
| S5 | **stale timestamp** — `t = now - tolerance - 1`, **correctly signed for that `t`** (so it cannot be passing for the wrong reason) → `stale_timestamp` |
| S6a | boundary: `t = now - tolerance` exactly → **accepted** |
| S6b | boundary: `t = now - tolerance - 1` → `stale_timestamp` (S6a+S6b pin the comparison operator) |
| S7 | **future** timestamp (`t = now + 3600`), correctly signed → **accepted**, with the comment naming the deliberate past-only bound |
| S8a | header absent → `missing_header` |
| S8b | header present but empty / no `t=` / `t` not `/^\d+$/` / two `t=` values → `malformed_header` |
| S9 | only `v0=` present → `no_v1` (an unknown scheme is ignored, not an error) |
| S10a | rotation: two `v1` values, the **second** matches → accepted |
| S10b | rotation: two `v1` values, **neither** matches → `no_match` |
| S11 | a `v1` of the wrong length and one non-hex → `no_match`, **and no throw** (the shape check keeps `timingSafeEqual` from throwing) |
| S12 | `payload` passed as a **string** → `not_raw` |
| S13 | the error carries nothing secret — built from the **`stale_timestamp`** path deliberately (a reason F1 cannot reach, so S13 stays a stable instrument under F1): `err.message` and `JSON.stringify(err)` contain neither the secret nor any digest |

**W — the route, driven over real HTTP through `withServer`** (a helper signs a
payload and posts it; every case injects a `stripe` client whose transport
**throws on any call**, except W17):

| # | Case |
|---|---|
| W1 | **secret unset** → `POST /webhooks/stripe` → **404**; `GET` → 404; ledger empty; no mirror change. *The route does not exist* |
| W2 | valid `invoice.finalized` for a known `in_` → 200 `applied`; mirror `open` + both URLs + both amounts + `dueAt` + `finalizedAt`; exactly one ledger row |
| W3 | **tampered body** → **400**, ledger empty, mirror byte-identical. *The security guard shown rejecting* |
| W4a | missing `Stripe-Signature` → 400, ledger empty, mirror unchanged |
| W4b | signature computed with a **different secret** → 400, ledger empty, mirror unchanged |
| W4c | **stale timestamp**, correctly signed → 400, ledger empty, mirror unchanged |
| W5 | **duplicate delivery**: the same event twice → 200 `applied`, then 200 `duplicate`; **exactly one** ledger row; **`updatedAt` identical after the second** |
| W6 | **out-of-order**: `invoice.paid` then `invoice.finalized` → `applied`, then 200 `stale`; mirror `paid`, `paidAt` and `finalizedAt` and both URLs populated **from the paid event's own object**, `amountPaidMinor` from it; then a third delivery of `paid` → `duplicate` |
| W7 | unhandled type (`charge.succeeded`) → 200 `ignored`, **`stripeEvents.has(id) === false`**, mirror unchanged |
| W8 | `invoice.paid` for an `in_` with no local row → 200 `unknown-target`, **no ledger row**, no row created |
| W9 | `account.updated` for a known `acct_` → 200 `readiness`; the six fields match the event; `ready` per AS-39's derivation; **`syncedAt` equals `event.created` converted, not the wall clock** |
| W10 | `account.updated` for an unknown `acct_` → 200 `unknown-target`, no ledger row |
| W11 | `invoice.payment_failed` → status still `open`; `lastPaymentFailedAt` = `event.created` converted (asserted against the literal, not against "not null") |
| W12a | **`invoice.sent` does NOT overwrite a recorded `sentAt`**: seed `sentAt` set → after delivery it is unchanged |
| W12b | `invoice.sent` on a mirror whose `sentAt` is null → `sentAt` = `event.created` converted |
| W13 | `invoice.voided` on an `open` invoice → `void`; then `invoice.paid` → **200** `conflict`, **nothing written** (status still `void`, `updatedAt` unchanged) — the 200 is asserted explicitly |
| W14 | **the body really is raw**: a payload whose JSON round trip would differ (non-canonical whitespace, unsorted keys, a `é` escape) verifies and applies |
| W15 | verified but not an event envelope (no `id`; `id` not `evt_`; no `created`; no `data.object`) → 400 `parse-event`, no ledger row |
| W16 | verified envelope whose `data.object` has a non-string `status` → **500**, **no ledger row**; then the **same `evt_` id** redelivered with a good object → 200 `applied`. *The recovery property of §3.3.3* |
| W17 | **the AS-43 interaction (§3.9)**: mirror `draft` with an `in_` attached; deliver `invoice.finalized` → `open` with `amountDueMinor === totalMinor`; then `POST /invoices/{id}/send` → **303** with exactly one `/send` call. Then the mismatch direction on a second invoice (`amount_due = totalMinor + 1`) → **409 `AmountMismatchError`**, **zero** `/send` calls |
| W18 | **zero Stripe calls**: over W2–W16, the injected transport (which throws on any call) never fires — asserted as a count of 0, not as an absence of errors |
| W19 | a 2 MB body → body-parser's own **413**, not a 200; no ledger row |
| W20 | a request with no `content-type` (so nothing matches and `req.body` is not a Buffer) → 400 `not_raw` |

**G — in-file invariants:**

| # | Case |
|---|---|
| G1 | `lib/webhooks/receiver.js` source contains no `async`, no `await`, no `Date.now(` and no `new Date()` — the synchronous-transaction rule and the reads-no-clock rule (§3.5), asserted by reading the file, with a message naming both |

### 5.4 Every committed literal that moves, exactly

1. **`test/harness.test.js`**: `EXPECTED_TEST_FILES` gains `'webhooks.test.js'`
   (sorted position **13**, last); the cardinality assertion `12` → **13** in both
   the number and the message string; the V2 comment "these twelve files ran" →
   "thirteen".
2. **`test/dependency-policy.test.js`, source list**: count `32` → **35** in both
   the number and the message; the sorted list gains
   `lib/webhooks/receiver.js` and `lib/webhooks/signature.js` (**after**
   `lib/views.js`, **before** `public/scaffold.css`) and `routes/webhooks.js`
   (**after** `routes/pages.js`, **before** `server.js`).
3. **`test/dependency-policy.test.js`, `/webhook route` row**: `[]` →
   `['routes/webhooks.js']`; the comment "AS-44's webhook route is not here yet"
   rewritten as landed.
4. **`test/dependency-policy.test.js`, three NEW concept rows**:
   ```js
   // The RAW-body guard, made mechanical: AS-43 mounts its parser per route and
   // AS-44's signature verification depends on nothing upstream touching the
   // bytes. An app-wide express.json() in app.js is a red test, not a review catch.
   scanConcept('body parser', /express\.(json|urlencoded|raw|text)\s*\(/, ['routes/invoices.js', 'routes/webhooks.js']);
   // One verifier, not two. Measured: zero hits before AS-44.
   scanConcept('webhook signature HMAC', /\b(createHmac|timingSafeEqual)\b/, ['lib/webhooks/signature.js']);
   // ONE state machine. AS-43 and AS-44 both call applyStripeSnapshot; neither
   // may reimplement the ranking.
   scanConcept('invoice status rank', /STATUS_RANK/, ['lib/db/repositories/invoices.js']);
   ```
   The concept test's name gains AS-44: "…where AS-38, AS-39, AS-41, AS-43 and
   AS-44 put them" (the trailing "and nothing AS-44 owns has leaked in" is
   dropped — it has landed).
5. **`test/dependency-policy.test.js`, unchanged and asserted still true**:
   `LOCK_ENTRIES` 70; `DIRECT_DEPENDENCIES`; manifests 3; `SANCTIONED.length` 3;
   `STRIPE_ config key` `['compose.yaml','lib/config.js','lib/stripe/client.js']`
   (the new variable appears only in the first two — **a claim**);
   `application_fee` `['lib/stripe/custody.js']`; **`platform Stripe call`
   `['lib/connect/onboarding.js']` — a claim: this task adds no Stripe call**;
   `node:sqlite`; `raw SQL` (9 files); **`money representation` (7 files) — a
   claim: none of the three new files may contain `amount`, `currency` or `money`,
   comments included (RAW scan)**; the 1,200-line cap.
6. **`test/config.test.js`**: `SCHEMA.length` `10` → **11**; test name "the ten
   settings AS-37, AS-38, AS-39 and AS-41 define" → "the eleven settings AS-37,
   AS-38, AS-39, AS-41 and AS-44 define"; the key list gains `'webhookSecret'`
   **after** `'stripeSecretKey'`; `prefixed.length` `9` → **10**; the secret list
   `['INVOICING_STRIPE_SECRET_KEY']` →
   `['INVOICING_STRIPE_SECRET_KEY', 'INVOICING_STRIPE_WEBHOOK_SECRET']` and that
   test's name "the only secret is the Stripe key name (AS-38)" → "the only
   secrets are the two Stripe secret names (AS-38, AS-44)", plus the exact-row
   `deepEqual` for the new row; the empty-environment `deepEqual` gains
   `webhookSecret: null`; the overrides env gains
   `INVOICING_STRIPE_WEBHOOK_SECRET: 'unit-test-placeholder-webhook-secret'` (**not**
   `whsec_`-shaped, on purpose — §4) and its `deepEqual` gains the same value;
   NEW: `redacted()` shows `'[redacted]'` when it is set and `null` when it is not.
7. **`test/deploy-shape.test.js`**: `SERVICES.web.environment` `deepEqual` gains
   `'INVOICING_STRIPE_WEBHOOK_SECRET=${INVOICING_STRIPE_WEBHOOK_SECRET:-}'` as the
   **4th** entry; `env.length` `4` → **5** in both the number and the message;
   `secretShaped` `1` → **2** and its message "exactly one secret-shaped variable
   is passed through (the Stripe key)" → "exactly two … (the Stripe key and the
   webhook signing secret)"; a sibling `COMPOSE_TEXT.includes(...)` assertion for
   the new pass-through. **Unchanged**: the `whsec_` credential-value refusal
   (line 319 — green, and now guarding something real), `Object.keys(SERVICES).length`
   4, `BUILT.length` 3, `COPIES.length` 9, `IGNORE_PATTERNS.length` 6, every
   volume assertion.
8. **Traps that would move a literal by accident, and must not:**
   - **a money word** (`amount`/`currency`/`money`, case-insensitive, **comments
     included** — it is a RAW scan) in any of the three new source files or in
     `app.js`'s mount comment. "The mirror's recorded amount" is a natural
     sentence and it is forbidden;
   - `STRIPE_[A-Z_]+` in any new file — the route must **not** name the env var in
     an error message (it never needs to: §3.3.1 makes the unset case a 404);
   - `createHmac` or `timingSafeEqual` in `routes/webhooks.js` or
     `lib/webhooks/receiver.js`, **comments included** — the concept row is a
     stripped scan and would not see a comment, but F7's assert-applied grep is a
     RAW grep with a **baseline of 0**, and a comment would make the recipe
     unrunnable (this is precisely AS-43 F4's lesson);
   - `platform: true`, `fetch`, an import of `node:http*`/`net`/`tls`/
     `child_process`/`transport.js`, `application_fee`, or any raw SQL;
   - `'/webhook…'` as a string in any file other than `routes/webhooks.js`
     (stripped scan) — so the `app.js` mount line carries no path;
   - `test/webhooks.test.js` must stay under **1,200 lines**; at ~800 projected it
     has headroom, but the cap applies to test files.
9. **Deliberately NOT moving** (asserted by leaving them untouched and green):
   `db.test.js` and `repositories.test.js` (no schema, no repository change —
   `SCHEMA_VERSION` 1, `MIGRATIONS` 1); `health.test.js` (four checks);
   `invoices.test.js` (the ten-key mapper contract does not move — adding an
   `export` adds no key; R1's committed key list is untouched);
   `connect.test.js`; `stripe-client.test.js` and `stripe-mock.test.js` (no
   allowlist row — `ALLOWED_ENDPOINTS` is unchanged); `assets.test.js`;
   `package.json` / `package-lock.json`.

### 5.5 What genuinely cannot be tested here, named

The description's residual, restated rather than solved — and it is **larger here
than in any prior task in this milestone**, which is the honest thing to say:

1. **Agreement with Stripe's own HMAC is unverifiable in this task.** S1's
   committed vector pins *our* algorithm against future drift — a later edit that
   strips the `whsec_` prefix, changes the separator, or switches the digest turns
   it red. It does **not** prove Stripe computes the same bytes, because every
   fixture in this suite is signed by the same understanding of the scheme that
   verifies it. **A suite whose signer and verifier share an assumption cannot
   detect that the assumption is wrong.** Only a real delivery can.
2. **Real delivery, real ordering, real latency** — stripe-mock emits no webhooks.
3. **The exact live `Stripe-Signature` header shape** at this API version.
4. **Whether 300 s of tolerance is comfortable** against real clock skew.
5. **Whether the connected-event envelope carries `account`** — we do not depend
   on it (§3.4.1), which is itself the mitigation.
6. **Poison-pill behaviour** (§3.3.3): whether a repeated 500 actually disables the
   endpoint, and how fast.
7. **Whether `stripe listen --forward-to localhost:8348/webhooks/stripe` reaches
   the compose stack** at all.

All seven belong to **AS-50**, gated on AS-51. **For AS-50's planner:** the
cheapest possible confirmation of item 1 is to record the first real
`Stripe-Signature` header verbatim (minus the digest) and the first successful
verification in the run record; item 3 falls out of the same line. Flagged in §11,
not filed as an ask. This task opens no account and files nothing.

## §6 Acceptance criteria

Cardinality before quantification throughout: every "all"/"none" is an exact count
against a committed literal, and every guard is shown red under its §7 recipe.

1. **The route exists at `POST /webhooks/stripe`**, mounted second in `app.js`,
   with the §3.3.3 statuses — 400 / 200 / 500 — verified by W2–W20.
2. **VERIFICATION, verbatim from the task description:** "unit tests over
   synthetic signed payloads — valid signature accepted; tampered payload
   rejected; stale timestamp rejected; a duplicate event id applied exactly once;
   an out-of-order paid-before-finalized sequence converging to the correct state.
   NAMED RESIDUAL (milestone plan section 8.2, right-sizing test 3): stripe-mock
   emits no webhooks, so real delivery, real ordering, and real latency cannot be
   verified until the board-approved test-mode account exists; the test-mode
   acceptance run covers them and is gated on that ask. This task is honest at the
   unit level and says so rather than claiming an end-to-end guarantee it cannot
   demonstrate." Clause by clause: valid accepted → S1, S2, S6a, S7, W2; tampered
   rejected → S3, W3; stale rejected → S5, S6b, W4c; duplicate applied exactly
   once → W5 (one ledger row, `updatedAt` unchanged); paid-before-finalized
   converging → W6; the residual → §5.5 and AC 22.
3. **The raw body reaches the verifier unmodified**: `payload` is a `Buffer`,
   never a string (S12 refuses a string outright); a payload whose JSON round trip
   would differ still verifies (W14); a UTF-8 payload verifies (S2); no body
   parser is mounted app-wide, held by the new `body parser` concept row, shown
   red under F3 with **two** witnesses (the row, and every positive W-case).
4. **Signature verification is shown REJECTING**, not only accepting: tampered
   payload (S3, W3), wrong secret (S4, W4b), missing header (S8a, W4a), malformed
   header (S8b), no `v1` (S9), malformed `v1` with no throw (S11), non-Buffer
   payload (S12, W20). **F1 makes the digest comparison always succeed and turns
   exactly {S3, S4, S10b, S11, W3, W4b} red.**
5. **The tolerance window is 300 s, past-only**, pinned at both boundary values
   (S6a accepts at exactly `now - 300`, S6b rejects at `now - 301`), with a future
   timestamp deliberately accepted (S7). F2 removes the check and turns exactly
   {S5, S6b, W4c} red.
6. **The comparison cannot throw**: every `v1` candidate passes a
   `/^[0-9a-f]{64}$/i` shape check before conversion (S11 proves no throw on a
   malformed candidate).
7. **Errors leak nothing**: no secret, no payload, no expected digest, in the
   message or the serialised error (S13); route bodies are the house one-liner.
8. **An unset secret means the endpoint is absent**: `webhookRoutes` registers no
   route and both a POST and a GET answer **404** (W1), with the four reasons in
   §3.3.1 recorded in the file. The operator's signal is the existing
   `config.redacted()` output — asserted in `config.test.js`, with no new health
   check and no new log line.
9. **`recordOnce` sits inside the same transaction as the work**, called first,
   with the apply second — so there is no window in which one exists without the
   other (§3.5). W5: one ledger row and an unchanged `updatedAt` on redelivery.
10. **Idempotency's honest scope is stated and proven**: every handler is a pure
    function of its event, so F4 (ledger bypassed) turns **only** {W5, W6} red —
    and a wider set is a finding that falsifies §3.5, not a footnote.
11. **Eight event types are handled** (§3.4), each through the imported mappers;
    an unhandled type is 200 `ignored` with **no ledger row** (W7, F6).
12. **The receiver is synchronous and reads no clock**: no `async`, no `await`, no
    `Date.now(`, no `new Date()` in `lib/webhooks/receiver.js` (G1).
13. **Connected-account events route by Stripe object id, never by the envelope's
    `account`**; a missing local row is 200 `unknown-target` with no ledger row and
    no row created (W8, W10), decided by lookup rather than by exception (F9).
14. **Ordering converges through ONE machine**: `STATUS_RANK` occurs in exactly one
    file, held by the new concept row; `applyStripeSnapshot` gains a second caller
    and no second copy of the rule. Paid-before-finalized converges to `paid` with
    the paid event's own URLs and `finalizedAt` retained (W6).
15. **`account.updated` reuses AS-41's mapper unchanged**, `syncedAt` from
    `event.created` (W9); last-writer-wins confirmed (§3.7). Grep: none of
    `chargesEnabled`, `payoutsEnabled`, `detailsSubmitted`,
    `requirementsCurrentlyDue` appears anywhere in this diff, and
    `requirementsCurrentlyDue.length === 0` still occurs exactly once in the app.
16. **`sentAt` is never overwritten** (W12a) and is written from `event.created`
    when null (W12b); F5 breaks the condition and turns exactly {W12a} red. The
    two-writer amendment to AS-43 §3.10 is recorded in §3.6 and §11 item 3.
17. **The `conflict` outcome is 200, logs at error, records the ledger row, and
    writes nothing** (W13); the re-fetch is not implemented (AC 20 proves it —
    zero Stripe calls). F11 turns exactly {W13} red.
18. **The AS-43 cross-task interaction is tested in both directions** (W17): an
    invoice this task moves to `open` sends when the amounts agree and is refused
    with 409 and zero `/send` calls when they do not.
19. **Zero Stripe calls**: the injected transport never fires across W2–W16 (W18,
    a count of 0); `routes/webhooks.js` takes no `stripe` dependency; the
    `platform Stripe call` concept row is unchanged.
20. **The diff touches no file outside §2's list**, and specifically zero changes
    to `lib/stripe/**` (no allowlist row), `lib/db/**` (no migration —
    `SCHEMA_VERSION` 1, `MIGRATIONS` 1), `lib/connect/**`,
    `lib/invoices/lifecycle.js`, `lib/health.js`, `server.js`, `Dockerfile`,
    `package.json`, `package-lock.json`. `lib/invoices/mapping.js` changes by
    exactly one added `export` keyword plus a comment — its key set does not move.
21. **The suite is green, offline, with exactly thirteen files.**
    `docker compose run --rm --build test` exits 0; `fail 0`; 13 test files
    (harness V2); the mock-gated AS-38/AS-41/AS-43 cases still report as
    **skipped**, never passed. `docker compose run --rm --build contract` exits 0
    with the same 13 files. **V1 control:** `-e ASC_SELFTEST_MUTATE=1` **with
    `--build`** exits 1.
22. **The named residual is restated in the review comment, not resolved** (§5.5,
    all seven items): no Stripe account exists, none was opened, no board ask was
    filed; agreement with Stripe's own HMAC is unproven and is AS-50's.
23. **Falsification recipes F1–F11 and V1 executed per §7**, with each predicted
    set observed **or its divergence recorded as a finding**; evidence (commands,
    assert-applied greps with their observed baselines, failing test names and
    counts) recorded in a Lattice comment on AS-44 before review is requested.
24. **Every §5.4 literal lands in the same commit as the change that moves it**;
    zero unexplained skips; `git diff --stat master...feat/AS-44-webhook-receiver
    -- .lattice` is empty (the two-plane rule).
25. **Commits** on `feat/AS-44-webhook-receiver` as `developer-marcus`
    (`user.name="developer-marcus"`,
    `user.email="developer-marcus@agents.american-software.local"`), every message
    prefixed `AS-44:`.

## §7 Falsification recipes (run in the task worktree; backups OUTSIDE `apps/invoicing/`)

House rules: back up to `${TMPDIR:-/tmp}/as44-falsify/` (never inside
`apps/invoicing/` — the closed-world scan classifies every file under it, so an
in-tree `.bak` is itself a red `unknown`), `trap` the restore on `EXIT`, **assert
the mutation applied** against its stated baseline, run the suite IN CONTAINER
(`docker compose … run --rm --build test`), observe the predicted set, restore,
prove the tree with `git -C <worktree> diff --exit-code`, then **rebuild and
re-run green**. Every `docker compose` invocation from the worktree; never `cd`
into it for a `lattice` call (the working-directory hazard in `CLAUDE.md`).

**On the predictions below.** AS-41's §7 was wrong in two of five sets; AS-43's was
wrong in four memberships of one set and in the whole mechanism of another. Both
misses came from reasoning about a mutation's *intent* instead of tracing it
through the actual call pipeline. Each prediction below is traced through
**router mount → raw parser → Buffer guard → verify → envelope parse → dispatch →
locate → transaction → apply**, and says which stage it changes. Where a set
depends on how many cases the implementer writes beyond §5.3, it is labelled a
**LOWER BOUND** and says so. **A set narrower than predicted is a finding. A set
wider than predicted is a finding. Neither is fixed by narrowing a test.**

**Baselines are measured, not assumed** (§0 evidence table). Every `MUTANT-Fn`
marker has a baseline of **0** because that token exists nowhere in the repository;
every other grep states the count taken from the shipped file. **If a baseline does
not match before you mutate, stop and record it — the recipe is unrunnable as
written and that is the finding.**

| # | Mutation (exact) | Assert applied (baseline → after) | Predicted failing set |
|---|---|---|---|
| **F1** | in `lib/webhooks/signature.js`, make the digest comparison always succeed: replace the `timingSafeEqual(...)` result with `true`, plus a `// MUTANT-F1` marker | `grep -c 'MUTANT-F1' lib/webhooks/signature.js` **0 → 1**; and record `grep -c 'timingSafeEqual' lib/webhooks/signature.js` from the shipped file first — it must be **unchanged** (the shape check and the import stay) | **EXACT {S3, S4, S10b, S11, W3, W4b}.** Traced: the comparison is stage 6, reached only after the header parses (stage 3–4) and the timestamp passes (stage 5), so S5/S6b/S8a/S8b/S9/S12/W4a/W4c fail *earlier* and stay green; every positive case (S1, S2, S6a, S7, S10a, W2, W14) already accepts and stays green; S13 is deliberately built on the `stale_timestamp` path (§5.3) so it too stays green — that is why it was written that way. **This is the recipe that shows the security check rejecting: without it the check has only ever been seen passing** |
| **F2** | in `lib/webhooks/signature.js`, delete the tolerance comparison (keep the `t` parse), plus `// MUTANT-F2` | `grep -c 'MUTANT-F2'` **0 → 1**; `grep -c 'toleranceSeconds' lib/webhooks/signature.js` drops by exactly 1 from the shipped count (record it first) | **EXACT {S5, S6b, W4c}.** Traced: stage 5 only. S8b's non-integer `t` fails at stage 3 and stays green; S7 (future) was already accepted and stays green; S6a was already accepted |
| **F3** | in `app.js`, insert `app.use(express.json());` immediately before the webhook mount | `grep -c 'express\.json(' app.js` **0 → 1** (baseline measured: 0) | **LOWER BOUND, two witnesses.** (a) dependency-policy `body parser` row — **exactly 1 test**: "found in [app.js, routes/invoices.js, routes/webhooks.js], allowed in exactly [routes/invoices.js, routes/webhooks.js]". (b) traced: `express.json` sets `req._body`, so `express.raw` skips and `req.body` is a parsed object → the Buffer guard fires → **400**. Every W-case expecting a status other than 400 goes red: **{W2, W5, W6, W7, W8, W9, W10, W11, W12a, W12b, W13, W14, W16, W17}**. **Green, and each for a stated reason:** W1 (no route at all), W3/W4a/W4b/W4c/W15/W20 (already expect 400 — they now pass *for the wrong reason*, which is exactly why the positive cases are the instrument here), W19 (json's own limit still refuses a 2 MB body). **Record the W3-passes-for-the-wrong-reason observation explicitly** |
| **F4** | in `lib/webhooks/receiver.js`, delete the `recordOnce` early return so every delivery is processed (keep the insert), plus `// MUTANT-F4` | `grep -c 'MUTANT-F4'` **0 → 1**; `grep -c 'recordOnce' lib/webhooks/receiver.js` drops by exactly 1 from the shipped count (record it first) | **EXACT {W5, W6}.** W5's second delivery answers `applied` not `duplicate` and moves `updatedAt`; W6's third delivery answers `fields` not `duplicate`. **Everything else stays green, and that is the point of the recipe**: it is the evidence for §3.5's claim that every handler is a pure function of its event. **If any other case goes red, §3.5 is false and that is the finding** — in particular W7 (ignored events never reach `recordOnce`) and W16 (never recorded) must stay green |
| **F5** | in `lib/webhooks/receiver.js`, remove the `current.sentAt === null` condition from the `invoice.sent` handler so `sentAt` is always written, plus `// MUTANT-F5` | `grep -c 'MUTANT-F5'` **0 → 1**; the `sentAt === null` condition greps to 0 in that file | **EXACT {W12a}.** Traced: only the `invoice.sent` row changes, and only on a mirror whose `sentAt` is already set. W12b (writes when null) stays green; W2/W5/W6 never deliver `invoice.sent`. Breaks the guard in the direction it exists to catch — a webhook overwriting AS-43's recorded fact |
| **F6** | in `lib/webhooks/receiver.js`, move the `HANDLERS[type] === undefined` check **inside** the transaction, after `recordOnce`, plus `// MUTANT-F6` | `grep -c 'MUTANT-F6'` **0 → 1**; the `HANDLERS` lookup now appears after the `repos.transaction(` line (line numbers recorded) | **EXACT {W7}.** Traced: the response is still 200 `ignored`; only `stripeEvents.has(id)` flips to true. If W7 stays green, its `has(id) === false` assertion was not written and AS-39's "a row exists iff processed" invariant is untested |
| **F7** | append a real (non-comment) `createHmac` use to `routes/webhooks.js` | `grep -c 'createHmac' routes/webhooks.js` **0 → 1** — baseline 0 is guaranteed by §5.4 trap 3, which forbids the token there **including in comments**, precisely so this recipe is runnable | **EXACT: the `webhook signature HMAC` concept row only** — "found in [lib/webhooks/signature.js, routes/webhooks.js], allowed in exactly [lib/webhooks/signature.js]". F1/F2 only ever see that row pass; this breaks it in the direction it exists to catch — a second, home-rolled verifier |
| **F8** | in `routes/webhooks.js`, rename the path literal `'/webhooks/stripe'` → `'/hooks/stripe'` | `grep -c "'/webhooks/stripe'" routes/webhooks.js` **1 → 0** (the plan specifies exactly one occurrence) | **LOWER BOUND, two witnesses.** (a) the `/webhook route` concept row in its **used-exemption** direction — "found in [], allowed in exactly [routes/webhooks.js]" — which is the direction F1–F7 never exercise; (b) every W-case except W1 now 404s: **{W2–W20 minus W1}**. The blast radius is the second witness, not a defect in the recipe |
| **F9** | in `lib/webhooks/receiver.js`, delete the `locate` null check so `applyStripeSnapshot` / `updateReadiness` throw `NotFoundError` instead, plus `// MUTANT-F9` | `grep -c 'MUTANT-F9'` **0 → 1**; the `unknown-target` literal greps to 0 in that file | **EXACT {W8, W10}.** Traced: `NotFoundError` reaches the route's `statusFor` and becomes **500** where 200 `unknown-target` was expected. Nothing else routes through a missing target. This is the single highest-cost mistake in the task (§3.4.1 reason 3: a 5xx to a normal condition eventually disables our endpoint), so it gets its own recipe |
| **F10** | **in a SCRATCH COPY of the worktree, never in place:** `mv test/webhooks.test.js test/webhooks.test.js.bak` | `ls test/webhooks.test.js` fails in the copy; the task worktree proven clean before and after with `git -C <worktree> status --porcelain` | **EXACT: harness V2 only.** Message must read "expected exactly 13 test files, found 12: …" listing the twelve survivors. Proves the new file is load-bearing in the pinned list rather than decoration |
| **F11** | in `lib/webhooks/receiver.js` (or the route's `statusFor`), make the `conflict` outcome an error path so it answers 5xx, plus `// MUTANT-F11` | `grep -c 'MUTANT-F11'` **0 → 1** | **EXACT {W13}.** Proves W13 actually asserts the **200** rather than merely observing that nothing was written — the §3.8 ruling's operative half. The rank machine itself is already falsified by AS-39's M5/M6 and is not re-run here (a deliberate time-box, not an omission) |
| **V1** | `$COMPOSE run --rm **--build** -e ASC_SELFTEST_MUTATE=1 test; echo EXIT=$?` | the printed `EXIT=1` | harness V1 only. **`--build` is mandatory** — AS-39 §11.1 recorded a phantom second failure from a stale mutant image |

**Rejected as recipes, with reasons** (so their absence is a decision, not an
oversight): mutating `timingSafeEqual` to a non-constant-time comparison — no test
can observe it, and its correctness rests on the measured API rather than on
behaviour; mutating AS-39's `STATUS_RANK` — already covered by that task's M5/M6,
and re-running someone else's recipes is a time-box, not a gap; mutating the
compose pass-through — deploy-shape's per-service exact list already fails on any
edit, as AS-39's M11 observed.

## §8 Size and complexity, against the milestone tripwires

**Projection:** 4 new + 10 modified = **14 files**, ≈ **1,450 insertions**
(≈ 470 source, ≈ 800 test, ≈ 180 literal-moves / README / compose / config).

Both §8.2 tripwires fire (>~10 files, >~600 lines), so the required written
justification rather than a silent overrun:

- It is **one reviewable claim** — *a signed Stripe event, and only a signed
  Stripe event, updates the mirror exactly once, and out-of-order or repeated
  deliveries converge* — whose scope is fixed verbatim by the description (row
  C-36, chain link 6).
- ≈ 180 of the lines are the **mechanical literal-tax** every task in this app
  pays (harness list, three dependency-policy lists plus three new rows, config
  counts, deploy-shape counts, the helper, the README), not additional surface.
- The **source is small** (≈ 470 lines across three files) precisely because
  three prior tasks left this one their mappers, their state machine and their
  idempotency store. What is large is the test file, and it is large for the right
  reason: §5.3 splits every refusal into its own case so §7's predictions can be
  exact rather than lower bounds. That is a deliberate trade of lines for
  falsifiability.
- The test:source ratio (~1.7:1) is the house norm for Stripe-touching code
  (AS-38's precedent), and this is the only security boundary in the product.

**Complexity: medium**, as filed. It is protocol work against a documented scheme,
but there is no network, no new dependency, no schema change, no state machine to
design (AS-39 built and tested it), and no mapping to write (AS-41 and AS-43 wrote
and proved both). The genuinely subtle pieces are two: the raw-body path (~10
lines, guarded statically and at runtime) and the transaction/ledger placement
(~8 lines, with the crash analysis in §3.5).

**Pre-agreed split line, decided now so nobody improvises mid-flight:** if the
implementation passes **~1,700 insertions**, or if the route turns out to need
anything beyond raw-body + verify + dispatch, the split is **the `account.updated`
consumer** — its one `HANDLERS` row, its `readinessFromAccount` import, and cases
W9/W10 — into a follow-up task. That is the clean seam: the description itself
says "one receiver, two consumers", and the readiness consumer shares no code path
with the invoice consumer beyond the verifier and the ledger. **Never split:**
signature verification, the config row and the unset-secret behaviour,
idempotency, the invoice dispatch, and the ordering behaviour (AC 1–14, 16–19) —
that set is the chain-critical claim and a half of it is not a claim at all.

## §9 Open questions — each with a default and a time-box

- **Q1 — is 300 s the right tolerance?** Default: **yes**, past-only, as a module
  constant and not a config row (§3.2). Box: **AS-50's acceptance run**, where real
  clock skew between the container and Stripe is observable for the first time. If
  it ever needs tuning per deployment, that is the moment it becomes a config row —
  not before.
- **Q2 — should a verified event be re-fetched from Stripe (`GET /v1/events/{id}`)
  before it is trusted?** Default: **no** (§3.8's three grounds; it would also need
  a new allowlist row, which AS-38's convention says belongs to the task that needs
  it). Box: reopens **only** if the signing secret is ever exposed, or if any
  webhook ever drives an action outside the mirror. Neither is true in v1.
- **Q3 — is a 500 on an unprocessable event the right answer, given Stripe can
  disable the endpoint after ~3 days of failures?** Default: **yes** — noisy beats
  silent for a v1 with one operator, and the recovery property (fix, redeliver,
  apply — W16) is worth it. Box: **AS-50**, if it observes a poison pill; the
  alternative is 200 plus a loud log, which is a two-line change.
- **Q4 — is last-writer-wins readiness still sufficient?** Default: **yes** —
  AS-41 §9 Q4 confirmed with the timestamp analysis it asked for, and a monotonic
  `syncedAt` comparison explicitly rejected on two measured facts (§3.7). Box:
  **AS-50** observing a real out-of-order `account.updated` that leaves a wrong
  readiness row. The schema forecloses nothing.
- **Q5 — should `invoice.voided` and `invoice.marked_uncollectible` be handled at
  all, given the description's prose list omits them?** Default: **yes** (§3.4 —
  two merged artifacts assign them here, the cost is two table rows and no new
  mechanism, and without them the mirror displays a lie). Box: **this task's
  review**; if QA disagrees, the removal is two rows and two cases.
- **Q6 — does Stripe actually emit `invoice.sent` for an invoice sent by our own
  `/v1/invoices/{id}/send` call?** Default: assume **yes**, and note that the
  handler is harmless if not (it simply never fires; AS-43's step 5 remains the
  only writer of `sentAt`). Box: **AS-50**, which should record the full event
  sequence for one invoice — that list is worth having for its own sake.
- **Q7 — should processing move off the request (a queue, a worker)?** Default:
  **no** (§3.3.3: answering after the work is what makes a 2xx mean "durably
  resolved"). Box: the first handler that does I/O — which the description's NOT
  list forbids in v1.
- **Q8 — the path `/webhooks/stripe`.** **Decided here** (§3.3), and it is now
  load-bearing outside this repo: AS-50's `stripe listen --forward-to` and Stripe's
  endpoint configuration both carry it. Changing it later is one literal in
  `routes/webhooks.js` plus its test assertions plus a third-party reconfiguration
  — named so that cost is visible before someone renames it.

## §10 Proposed wording for metawork-owned files

(The metawork layer applies these; the implementer does not edit these files.)

**`CLAUDE.md`, section "The Review Gate"**, append after the "A guard is proven by
breaking it" paragraph:

> **A fixture that shares the implementation's assumption cannot falsify it
> (learned 2026-09-02, AS-44).** When a suite both *produces* and *checks* the
> artifact under test — signing a payload with the same understanding of the
> scheme that verifies it, encoding a request with the same encoder that decodes
> it — it agrees with itself no matter what it computes, and a symmetric mistake
> is invisible to every case in it. This is a distinct vacuity class from the
> empty-set pass: the set is non-empty and the assertions are real, but the
> instrument is calibrated against itself. Two defences, both cheap: pin the
> behaviour to a **committed known-answer value** (a literal digest, a literal
> encoded body) so a later change to the shared assumption turns a test red; and
> state plainly, in the plan and in the review comment, what the vector proves
> (no drift from today's behaviour) and what it does not (agreement with the
> external system). Where the second half can only be settled by a real
> interaction, name the task that settles it rather than implying the suite did.

**Root `README.md`, Status section**: when AS-44 merges, add "webhook receiver
(Stripe signature verification, event-id idempotency, invoice and readiness state
sync)" to the D1 v1 progress line.

No change proposed to `PHILOSOPHY.md` or `agents.md`. (`apps/invoicing/README.md`
is app documentation, employee-owned, edited in scope per §5.2.)

## §11 Stale or wrong items found while planning (flags, not edits)

1. **`docs/engineering/02-stripe-test-account-setup-directions.md` §3.4** says
   "The exact forward path will be pinned when **AS-42** (webhook task) lands."
   AS-42 is the *contracts* task; the webhook task is **AS-44**. The path is now
   pinned: `stripe listen --forward-to localhost:8348/webhooks/stripe`. Flagged for
   the doc's owner (`docs/` is outside §2's scope and a plan commit should not
   carry a docs edit).
2. **The same document, §4**, tells the board to hand over exactly one secret and
   correctly says the `whsec_` is *not* part of the handover — but it does not say
   where the `whsec_` goes once minted. After this task it goes in the same
   gitignored file, as a second line:
   `INVOICING_STRIPE_WEBHOOK_SECRET=whsec_…`. Proposed addition, flagged for the
   doc's next pass; the app README (in scope) says it too.
3. **AS-43 plan §3.10's boundary table** — row "Writes `sentAt` | step 5, from our
   clock | —" — **is amended by this task**: AS-44 writes `sentAt` from
   `event.created`, and **only when the mirror's value is null**. The reason is in
   §3.6: AS-43 §3.8 closes the "send succeeded, mirror write died" hole with an
   idempotency key, which holds only inside Stripe's ~24 h window; `invoice.sent`
   closes it permanently. Recorded as an amendment rather than applied to AS-43's
   plan text, because AS-43 is merged and its plan is the record of what it built.
4. **AS-41 plan §9 Q4** ("is last-writer-wins readiness sufficient once AS-44's
   webhook writer exists? … Box: AS-44's planning stage re-derives the conflict
   analysis with event timestamps in hand") is **closed with its default** here,
   with the analysis it asked for (§3.7). Recorded because AS-41's plan says its
   box closes here.
5. **AS-39 plan §8 Q6** (the `conflict` outcome) and **§8 Q8** (a `payload` column
   on `stripe_events`) are both **closed** here — Q6's default confirmed with its
   optional re-fetch rejected (§3.8), Q8 upheld with no migration (§4). Recorded
   because AS-39's plan says both boxes close here.
6. **`isoFromEpochSeconds` now has two consumers** (`lib/invoices/mapping.js` and
   `lib/webhooks/receiver.js`) and stays where it is, exactly as AS-43 §9 Q1 kept
   `resolveFreelancerId` in `routes/connect.js` at two consumers. Trigger to
   extract to a shared module: a **third** consumer, or any consumer outside
   `lib/invoices/` and `lib/webhooks/`.
7. **`/healthz` will publish `webhookSecret`** through `config.redacted()` — masked
   when set, `null` when not. This is the same AS-58 item 4 exposure question
   AS-39 flagged for `dbPath`, widened by one row and by one *secret* (masked, so
   the exposure is the fact of configuration, not the value). Recorded, not changed
   here; §3.3.1 reason 4 depends on it being visible to the operator.
8. **`test/dependency-policy.test.js`'s test name and its `/webhook route`
   comment** both say AS-44's route "is not here yet". Both move in this task
   (§5.4 items 3–4) — recorded so QA does not read the move as loosening. Same
   status as AS-39's §10 item 2.
9. **`apps/invoicing/README.md`'s AS-43 handoff bullet** lists the events AS-44
   should handle as `invoice.created/finalized/paid/voided/marked_uncollectible/
   payment_failed` — six, omitting `invoice.sent`, which the Lattice description
   includes. The union (seven invoice events) is what §3.4 handles; the README
   bullet is rewritten as landed in scope.
10. **`docs/design/wireframes/00-flows.md` Flow 7 step 4** ("Webhook lands,
    signature verified, invoice state updated (C-36)") and
    **`02-states-ledger.md` `S5-LOADING`**'s note that the payment-pending interval
    shows `S5-DEFAULT-OPEN` rather than a spinner are both **accurate** against this
    design. Checked, not changed — recorded so the next reader knows they were.
