# apps/invoicing

The product app. Server-rendered Node, two dependencies, no build step.

Built by AS-37 as the scaffold every other D1 task sits on. The binding stack
decision is `docs/engineering/01-stack-decision.md`; the plan this was built
from is `.lattice/plans/task_01M1D34MWF287MVX3FC9NTASW7.md`.

## The three commands

The app **only ever runs under compose** (`CLAUDE.md ## Infra`). There is no
supported way to run it, or its suite, on the host.

```bash
# from apps/invoicing/
DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 docker compose up --build
DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 docker compose run --rm --build test
DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 docker compose run --rm --build contract && docker compose down
```

`up` runs `web` alone. `test` runs the whole suite offline (the stripe-mock
cases report as *skipped*, never as passed). `contract` runs the same suite
with the stripe-mock cases live — see [The contract half](#the-contract-half-stripe-mock);
the trailing `down` stops the mock that `depends_on` started (`--rm` removes only
the run container). Plain `docker compose down` after `up` is unchanged. A
fourth, `demo`, prints a narrated walkthrough of the core loop for a human
reader — see [Demo](#demo).

`web` serves on **http://127.0.0.1:8348** — `/signin` (screen 1, AS-45),
`/connect-stripe` (screen 2, AS-70), `/` (a 303 to `/connect-stripe` until
AS-48 replaces it with the Dashboard; see § The view layer), `/healthz`,
`/tokens.css`, and the Stripe Connect onboarding routes (AS-41):
`POST /connect-stripe/start` (create-or-reuse the connected account, 303 to
Stripe-hosted onboarding), `GET /connect-stripe/return` (fresh readiness read —
the return itself is never trusted — then 303 to the screen) and
`GET /connect-stripe/refresh` (mint a fresh link, 303 straight back into the
hosted flow). All four are behind the auth boundary (AS-40) and read the acting
freelancer from the session; Stripe's return and refresh arrive with the cookie
because they are top-level GET navigations and the cookie is `SameSite=Lax`. The
three 303 targets land on `/connect-stripe`, which renders the **stored row** —
READY, NOTREADY, or the no-row default — and makes no Stripe call of its own
(§ The view layer). AS-45 landed the view layer and screen 1 and then split on
its own pre-agreed line (its plan §8, fired at 1,749 changed lines against a
900-line stop); AS-70 landed screen 2 from §3.5.2, §3.5.3, §3.6 and ACs 12-14 of
the AS-45 plan. It also serves the four invoice routes (AS-43) — see
[Issuing an invoice](#issuing-an-invoice). Port 8348 is deliberate: 8347 is `asc-chat-server-1` and must not
be disturbed. The compose project is named `asc-invoicing`, so `docker compose
down` here cannot take the chat app with it.

### The app's own base URL

`INVOICING_APP_BASE_URL` (`appBaseUrl`, AS-41) is the base minted account
links redirect back to: `return_url`/`refresh_url` are built from it. It must
be a bare http(s) origin — no path, query, fragment, credentials, or trailing
slash; anything else fails at boot naming the variable. The default,
`http://127.0.0.1:8348`, IS the local-compose reality (the host side of the
port map), so `compose.yaml` is unchanged; deployment (M1) overrides it at the
real domain. Whether Stripe test mode accepts loopback return/refresh URLs is
AS-50's acceptance question, not this app's.

### Giving the app a key

The app has exactly two secret settings, `INVOICING_STRIPE_SECRET_KEY` and
`INVOICING_STRIPE_WEBHOOK_SECRET` (`lib/config.js`, the only two `secret: true`
rows). Both are **optional, and absent by default**: nothing in this repository
has a Stripe key or a signing secret, the Stripe account itself is a board-gated
ask (AS-51), and every command above runs without either.

`compose.yaml` passes both variables through as `${NAME:-}` — the values come
from your shell or from an env file you name on the command line, never from a
committed file. To run `web` with a test-mode key, keep it in
`apps/invoicing/.env.local` (gitignored at the repo root, `.dockerignore`d at the
repo root, and **not** referenced by `compose.yaml`, so its absence is not an error):

```bash
# apps/invoicing/.env.local — never committed
INVOICING_STRIPE_SECRET_KEY=sk_test_x
INVOICING_STRIPE_WEBHOOK_SECRET=whsec_x
```

The two are independent. The API key is what lets the app **call** Stripe; the
signing secret is what lets it **believe** Stripe. A deployment with a signing
secret and no API key still receives and applies webhooks, which is worth
knowing during an acceptance run: "Connect onboarding works" and "state sync
works" fail separately.

```bash
DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 docker compose --env-file .env.local up --build
```

What absent means: an unset variable arrives in the container as `''`, which
`config.js` reads as *unconfigured* — `stripeSecretKey: null` in the startup
line. A configured key is logged as `"[redacted]"` and appears nowhere else; a
Stripe call made without one fails at the `requireKey` step with a `ConfigError`
naming the variable — **after** the custody guard has already run, so a missing
key never hides a custody refusal.

**Why the `DOCKER_BUILDKIT=1` prefix.** This host's shell exports
`DOCKER_BUILDKIT=0`/`COMPOSE_DOCKER_CLI_BUILD=0`, which `apps/chat` documents as
a hazard. Prefixing every documented invocation follows chat's convention.
It is **not required for correctness**: with `build.platforms` set, the legacy builder
(`DOCKER_BUILDKIT=0`) also produces a `linux/amd64` image and the suite passes (measured
2026-09-01, re-measured under AS-53). The
platform pin itself is belt-and-braces: `build.platforms` is set as well as the
service-level `platform:`, because on Docker 29.6.1 / compose v5.3.0 the
service-level key alone silently produced a `linux/arm64` image against a
`linux/amd64` pin (measured 2026-09-01).

There are **no source bind-mounts**, so the running container is always the
shipped image. `--build` is what makes an edit take effect; `npm ci` is
layer-cached, so a rebuild is seconds.

## Demo

A fourth command, for a human reader rather than a verdict (AS-90, the board's
"can you make me a demo?"):

```bash
# from apps/invoicing/
DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 docker compose run --rm --build demo && docker compose down
```

It prints a narrated transcript of the v1 core loop to stdout: sign up →
session → Connect onboarding start and return → readiness → client → contract
(the rendered document is printed in full) → invoice draft → finalize → send →
paid → read back, twelve steps plus one redelivery. The `demo` service is the
`contract` service with a different command (`demo/run.mjs`): the same shipped
image, next to stripe-mock on the internal network, no ports, no volumes, no
route to the internet, a fresh database file per run. It is **not** `web`
driven from the host, because the app cannot be pointed at a mock by
configuration (`lib/stripe/client.js`: `baseUrl` is an option, never
configuration) and a demo must not be the thing that changes that.

Every step is labelled with one of three fixed strings, so the reader never
has to guess which is which:

- `REAL APP BEHAVIOUR` — the app's own code did this; it would do the same
  against real Stripe.
- `STRIPE-MOCK STAND-IN` — Stripe's request validator answered with a fixture;
  real Stripe would answer with real data, and the step says what would differ
  (the account is never ready, `amount_due` is a constant 1000, status never
  advances, the onboarding link is a fixture URL).
- `SYNTHESIZED EVENT` — the demo built and signed this webhook itself, with the
  same scheme Stripe uses; it proves our receiver and state machine, not
  Stripe's delivery.

The transcript opens with a verbatim "what this demo can / cannot show" block
and ends with every Stripe request the app made, in order — none of which
touches a charge, a payment intent or a transfer. The script holds no
assertion and no verdict: a broken chain prints `STOPPED at step N` and exits 1
(control flow, not a check); the automated end-to-end loop is AS-49, whose
planner lifts the `SEQUENCE` array from `demo/run.mjs`. The invoice is $10.00
because stripe-mock's invoice fixture always answers `amount_due 1000` and the
app refuses to finalize an invoice whose total disagrees with Stripe.

The committed capture of one run — `transcript.txt`, five screenshots of screen
1 at 375 px and 1280 px, and `capture.json` naming the commits it was taken at —
is `docs/demo/d1/`. The page the board views is built from that directory by
`.claude/skills/d1-demo-artifact/` (`SKILL.md` is the capture-and-publish
procedure; `capture.mjs` takes the screenshots with the host's Chrome against a
running `web`, and enters neither the image nor the lockfile).

## The suite

`node --test`, invoked **bare**, inside the shipped image, via the `test`
service — which carries `network_mode: none` and declares **no volumes**.

That is not a detail. The suite passing mountless and network-blocked is the
evidence for the stack decision's gate (c): **no accounts, no external services,
no network egress.** It is reversal trigger **T3** — if this suite ever needs
egress or an account, the stack decision reopens. Fifteen downstream tasks are
built on that property, and it is what keeps AS-51 (the Stripe account board
ask) off their critical path.

The suite also passes with a **completely empty environment**: no `.env`, no
exported variable, no credential. There is no **committed** `.env*` file in this
directory — the only one that may exist is the optional, gitignored `.env.local`
described above — and `compose.yaml` names the one secret variable only as a
`${NAME:-}` pass-through, never with a value. `test/deploy-shape.test.js`
asserts that shape, and `test/stripe-client.test.js` (C15) asserts the key
variable is undefined while the suite runs.

### The contract half (stripe-mock)

`test/stripe-mock.test.js` sends every allowlisted request shape through the
real client and the real transport to **stripe-mock**, Stripe's own open-source
request validator, pinned in `compose.yaml` to `stripe/stripe-mock:v0.203.0` —
the tag whose bundled OpenAPI spec (`2026-08-26.dahlia`) the client's
`Stripe-Version` constant names. The mock runs with `-strict-version-check`, so
a drifted version constant is a 400, not a silent pass (K1); it rejects unknown
parameter names, so the 200s are not vacuous (K9); and it **accepts** the
forbidden custody shape that the client refuses with zero transport calls (K11)
— Stripe's schema will not hold the never-in-the-flow-of-funds boundary for us,
which is the whole reason `lib/stripe/custody.js` exists.

Why this is not a signup, and not an account: pulling a public image creates no
credential and no relationship with Stripe. The mock checks only that the key
has a test-mode prefix; the placeholder is the one key-shaped VALUE in the
repository (spelled in exactly three mock-gated test files —
`stripe-mock.test.js`, `connect.test.js` since AS-41, and `invoices.test.js`
since AS-43 — deliberately the identical literal so one grep finds all
three), and it never leaves the compose network. The `contract` and
`stripe-mock` services sit on an `internal: true` network with no gateway; `web`
is not on it; `test` still has no network at all. The first `contract` run pulls
the image once (registry access at pull time, like `npm ci` at build time); every
later run works offline. The `test` service is unchanged and the contract cases
self-skip there — the T3 property (no accounts, no external services, no egress)
is untouched.

Readiness is the test's own poll — an unauthenticated `GET /v1/customers` every
100 ms for at most 10 s; the 401 is the reachability signal. A compose
healthcheck on the mock would need a key literal in `compose.yaml`, which is banned.

### The three structural guards

This company has shipped or nearly shipped nine vacuous passes — assertions that
passed while the property they named was false. Three guards exist to make the
tenth harder, and **each is only real while it can be demonstrated failing**:

| Guard | What it holds | How to prove it still works |
|---|---|---|
| **V1** — the runner can fail | A green suite means something | `docker compose run --rm -e ASC_SELFTEST_MUTATE=1 test` must exit **1**; the plain run must exit **0** |
| **V2** — cardinality before quantification | A scan of zero things cannot report success | Every set-quantified assertion is preceded by an exact count against a committed literal |
| **V2b** — the scan is closed-world | `test/dependency-policy.test.js` classifies **every** file in this directory as app source, manifest, or explicitly unscanned; an unclassified file fails. Sanctioned hits (`SANCTIONED`) must be used exactly as declared | Plant `fetch(` in `Dockerfile` — red on the construct guard. Point the compose healthcheck off loopback — red on both the construct guard and the sanction guard. Delete the healthcheck — red on the sanction guard, and on the stripper test, whose witness that instructions survive stripping is that same `healthcheck:` key (measured under AS-53) |
| **V3** — the container is the subject | Deploy shape is asserted against the real image | Comment out the `tokens.css` `COPY`, rebuild, run: the suite must go **red**. Restore |

V2 earned its place during this task: with the source scan mutated to examine
zero files, three forbidden-construct assertions passed **green** on the empty
set, and only the cardinality assertion caught it.

**Mutation discipline (house technique, learned the hard way in AS-37):**
mutate / assert-applied / observe / restore / **rebuild**, as **one indivisible shell
step** under an `EXIT` trap, then verify the **image**, not just the tree:

1. `cp` the file to a backup and `trap 'mv -f backup file' EXIT` — an interrupted run
   cannot leave the mutation live.
2. Mutate, then **assert the mutation applied** (`grep`) — a silently failed edit must
   not be misread as "the guard did not fire".
3. Observe with `docker compose run --rm --build test` and record the exit code and
   exactly which tests failed.
4. Let the trap restore; prove it with `git diff --exit-code`.
5. **Rebuild and re-run.** Restoring source is not restoring state: a stale mutant image
   produced two phantom failures in AS-37's review. Green on the rebuilt image is the
   verification.

Run it in a subshell with absolute paths and, when working in a task worktree, under a
distinct `-p` project name so the main checkout's running `web` is never touched.

## Issuing an invoice

Four routes (AS-43), all `POST`, all answering **303** on success and a one-line
`text/plain` error otherwise, all behind the auth boundary (AS-40) and all acting
for the session's freelancer:

| Route | Does | 303 to |
|---|---|---|
| `/invoices` | create a LOCAL draft — **zero Stripe calls** | `/invoices/{id}/edit` |
| `/invoices/{id}` | update a LOCAL draft — **zero Stripe calls** | `/invoices/{id}/edit` |
| `/invoices/{id}/finalize` | the gate, then the pipeline **through finalize** | `/invoices/{id}` |
| `/invoices/{id}/send` | the gate, then the pipeline **through send** | `/invoices/{id}` |

`/invoices/{id}` 404s until AS-48 (screens 3 and 5) lands — the same deliberate
dangle as `/connect-stripe` above. **`/invoices/new` and `/invoices/{id}/edit`
are screen 4 (AS-46)**, served from the same router. The screen posts to **its
own routes** (`POST /invoices/new`, `POST /invoices/{id}/edit`), not to the four
API routes: a human form ("1200.00", blank rows, an `intent`) is not the API's
shape, and a validation failure re-renders the screen with every value
preserved, which a `text/plain` 400 cannot. The screen's `send` calls the same
`lifecycle.send` the API does; the API routes remain the programmatic path (the
demo, the acceptance driver). `…/finalize` exists because finalize and send are
two operations with two failure modes, and AS-49 can drive them separately to
observe the intermediate state.

**The gate.** Finalize and send both refuse with **403 `AccountNotReadyError`**
(`not-connected` / `not-ready`) *before any Stripe call* unless the freelancer's
connected account is ready. Readiness is **read, never re-derived**: the one
derivation lives in `lib/db/repositories/connected-accounts.js` and nothing in
`lib/invoices/` names its underlying fields. Drafting is deliberately ungated **at
the API** — a freelancer may build drafts before connecting Stripe. **Screen 4
gates drafting** (a 403 refusal, `S4-GATED-STRIPENOTREADY`, on its GETs and its
POSTs alike) because the design record says the *screen* refuses (00-flows.md
Flow 5, ledger §4); both remain true, and the tension is recorded in the AS-46
plan (§10 Q2) with a trigger to revisit.

**The five Stripe calls**, in this order, every one connected-scope (carrying
`Stripe-Account: acct_…`, never `platform: true`) and every one carrying a
stable idempotency key:

| # | Call | Key |
|---|---|---|
| 1 | `POST /v1/customers` | `cus-create-<clientId>` |
| 2 | `POST /v1/invoices` | `inv-create-<invoiceId>` |
| 3 | `POST /v1/invoiceitems` × N | `ii-create-<lineItemId>` |
| 4 | `POST /v1/invoices/{id}/finalize` | `inv-finalize-<invoiceId>` |
| 5 | `POST /v1/invoices/{id}/send` | `inv-send-<invoiceId>` |

Five POSTs, **zero GETs**: calls 4 and 5 each return the full invoice object.
No allowlist row was added — every one of these was already in `custody.js`.

Four things here are load-bearing and should not be "simplified":

- **The invoice is created BEFORE its items, and each item names it.** Pending
  invoice items attach to the *customer*, so a run that created items and then
  failed would leave them to be swept onto that client's **next** invoice.
  `pending_invoice_items_behavior=exclude` is the belt to that braces.
- **`unit_amount` is never sent** — the endpoint rejects it outright at this API
  version (measured against stripe-mock, 400 "additional properties are not
  allowed"). Each item carries the **extended amount we computed ourselves**, so
  nothing depends on Stripe's multiplication semantics.
- **`auto_advance: false` on both calls 2 and 4.** Otherwise Stripe can finalize
  and email an invoice on our behalf about an hour later, and "who sent this"
  becomes ambiguous in a v1 whose whole email story is "Stripe does it, once".
- **The reconciliation guard.** A property of the **mirror row**, checked on
  every request that could reach a send — not only the one that finalized:
  `amountDueMinor` (Stripe's number, written only by the snapshot writer) must
  equal `totalMinor` (ours, derived from the line items), or **both** routes
  refuse with **409 `AmountMismatchError`** and no `/send` call is made. The
  refusal happens *after* the snapshot is written, because Stripe really did
  finalize it and a mirror saying `draft` would be a lie. It has **no skip
  predicate of its own**, and that is deliberate: a guard that shared step 4's
  predicate stopped existing for an invoice the moment it fired once, so the
  retry — which is how a freelancer reacts to the error — sent the invoice
  anyway. Resolution is the freelancer's, in their own Dashboard:
  `/v1/invoices/{id}/void` is deliberately not on the allowlist.
  Currency is **not** compared: the mirror has no column for Stripe's, and with
  one supported currency sent explicitly on calls 2 and 3 there is only one
  value. `SUPPORTED_CURRENCIES` growing a second member turns a test red
  (`invoices.test.js` R26) and brings that half of the guard back.

**Every step is skipped when the mirror records it done**, so re-submitting the
form after a failure completes the run rather than duplicating Stripe objects,
and a second finalize makes zero calls. Send is a no-op once `sent_at` is
recorded — which is what keeps retry-safety from quietly becoming a re-send
feature.

## Receiving webhooks

One route (AS-44), `POST /webhooks/stripe`, mounted **second** in `app.js` —
immediately after `/healthz` and before every other router, because nothing
ahead of it may parse a body.

**With no signing secret configured the route does not exist.** Not "reject
everything": `webhookRoutes` registers no handler at all and express answers
**404**, so there is no code path from an unconfigured deployment to the
database — not one that returns early, one that does not exist. Unconfigured is
the normal state of this repository, of every test run and of every developer's
stack, so it is not an error. The operator's signal lives on the authenticated
side instead: the startup line and `/healthz` both print
`"webhookSecret":null` (or `"[redacted]"`) via `config.redacted()`.

**Verification**, in `lib/webhooks/signature.js` — pure, the only `createHmac`
in the product, and the only thing between an unauthenticated POST and the
mirror:

- the payload is a **`Buffer`**, and a string is refused outright (`not_raw`).
  The request bytes are never turned into a string before they are hashed, so a
  body that has been through `JSON.parse`/`JSON.stringify` cannot verify against
  a re-serialised payload. **Do not mount a body parser app-wide** — the
  `body parser` row in `test/dependency-policy.test.js` turns that into a red
  test rather than a review catch;
- the secret is used **verbatim, `whsec_` prefix included** — that is Stripe's
  scheme;
- tolerance is **300 s and past-only**. A module constant, not a config row.
  A future-dated `t` is accepted deliberately: `t` is inside the signed
  material, so it cannot be forged without the secret, while a container clock
  running behind would otherwise kill the endpoint;
- unknown schemes (`v0=`, a future `v2=`) are **ignored, not rejected**; several
  `v1=` values are tried in turn, which is what a secret rotation looks like;
- every candidate passes a `/^[0-9a-f]{64}$/i` shape check before it is
  converted, so `timingSafeEqual` can never throw on a length mismatch.

**Eight event types are handled**, each through the mapper that already existed
— nothing is mapped, ranked or timestamped in this feature:

| Event | Effect on the mirror |
|---|---|
| `invoice.created` / `finalized` / `paid` / `voided` / `marked_uncollectible` | the full snapshot, via `invoiceSnapshotFromStripe` |
| `invoice.sent` | the snapshot, plus `sentAt` from the event — **only when the mirror's is null** |
| `invoice.payment_failed` | the snapshot, plus `lastPaymentFailedAt` from the event |
| `account.updated` | the six readiness fields, via `readinessFromAccount`, `syncedAt` from the event |

Anything else is **200 `ignored`** with **no ledger row** — a row for an event
with no effects would be a false statement about our own history, and a trap for
the day a handler is added for that type.

**Statuses**: 400 for any signature refusal or a body that verifies but is not
an event envelope; 500 for a well-formed envelope carrying an object shape the
mapper does not understand (Stripe retries it, and because the failed apply
never committed its ledger row, a deploy that fixes the mapper gets the event
redelivered and applied); 200 for everything else, with a one-line
`ok: <outcome>` body. **A missing local row is 200 `unknown-target`, not an
error** — the freelancer has their own full Stripe Dashboard and will create
invoices we never made, and answering non-2xx to a normal condition would
eventually make Stripe disable the endpoint.

**Idempotency** is `stripeEvents.recordOnce(event.id, type)`, called **first**
inside **one** `repos.transaction` with the work second. There is no window in
which the marker exists without its effects: die before the commit and Stripe's
retry is processed normally; die after it and the retry answers 200 `duplicate`
having written nothing. Honestly scoped: every handler here is a pure function
of its event — **the receiver reads no clock** (`webhooks.test.js` G1 greps for
it) — so removing the ledger entirely would change only `updated_at` and the
response body. It is the audit record, a cheap early exit under a retry storm,
and the belt that keeps a future **non-idempotent** handler honest. The moment a
handler does anything outside the mirror — an email, a counter, a Stripe call —
the ledger stops being a belt and becomes the mechanism, and that task must say
so in its plan.

**Ordering** converges through AS-39's rank machine and no second copy of it
(`STATUS_RANK` occurs in exactly one file, pinned by dependency-policy). A
`paid` event arriving before `finalized` applies, then discards the `finalized`
snapshot as `stale` — losing nothing, because a paid Stripe invoice still
carries both URLs and its `finalized_at`. The one non-convergence is deliberate:
`paid` and `void` share a rank because they are the one pair with **no
transition between them**, so a `paid` event on a `void` mirror is **200
`conflict`**, logged at error, recorded, and writes nothing. We do not guess,
and we do not re-read the invoice from Stripe to break the tie — that would be a
bypass of the rank machine, not a resolution.

**Zero Stripe calls.** `webhookRoutes(config, { repos })` takes no `stripe`
dependency, so a call cannot be added without changing the signature and the
mount line. No allowlist row was added and `lib/stripe/custody.js` is untouched.

**Pointing Stripe at it.** The path is configured in a third party's system, so
treat it as settled: `stripe listen --forward-to localhost:8348/webhooks/stripe`
prints a `whsec_…` that goes in `.env.local` as
`INVOICING_STRIPE_WEBHOOK_SECRET`. **Check the boot line first when no event
lands** — a deployment with no secret silently receives nothing.

**What this cannot prove, and who settles it (AS-50, gated on AS-51).** Every
fixture in `test/webhooks.test.js` is signed by the same understanding of
Stripe's scheme that verifies it, so the suite agrees with itself no matter what
it computes and a *symmetric* mistake is invisible to all of it. The committed
known-answer vector (S1) pins our algorithm against future drift; it is **not**
evidence that Stripe computes the same bytes. Real delivery, real ordering, real
latency, the live header shape, whether 300 s is comfortable against real clock
skew, and poison-pill behaviour all belong to the acceptance run —
stripe-mock emits no webhooks.

## Accounts

Chain link 1 (AS-40). Three routes, and one boundary that everything else sits
behind.

| Route | Public? | On success |
|---|---|---|
| `POST /signup` | public | create the freelancer and the credential in ONE transaction, issue a session, 303 to `next` (validated) or `/` |
| `POST /signin` | public | verify, re-hash if the stored parameters are behind the default, issue a session, 303 |
| `POST /signout` | guarded — mounted below the boundary | delete the row, clear the cookie, 303 to `/signin` |

`routes/auth.js` exports **two** routers for that reason: `publicAuthRoutes`
(sign-up, sign-in) above the boundary and `sessionAuthRoutes` (sign-out) below
it. One Express router cannot sit on both sides of a middleware, so signout is
protected by **position**, exactly like every other guarded route — never by
per-route middleware, which would make "everything below the boundary requires a
session" an incomplete description of what is guarded. An anonymous
`POST /signout` therefore gets the guard's answer — `303` to `/signin` with **no
`Set-Cookie`** — and the handler never runs; the stale cookie is left alone,
because `loadSession` already resolves it to nothing and the next sign-in
overwrites it.

`GET /signin` **serves screen 1** (AS-45), mounted in `publicAuthRoutes` —
**above** the auth boundary, because it is where `requireSession` sends every
signed-out visitor and a guarded sign-in page is an infinite redirect. The
guard's carve-out for that path is kept even though the route now sits above it:
it still answers every unregistered method on the path (`PUT /signin`).

**The route partition is a one-directional guarantee, and it is worth knowing
which direction.** *(Corrected 2026-09-03, AS-45 review cycle 1, finding F-5.
This paragraph previously read: "`auth.test.js`'s G3 is what proves the two
interact — move the route below the boundary and the carve-out lets a cookieless
request reach the handler." That is false; moving the route below the boundary
leaves the suite green, confirmed independently twice.)* G2 and G3 derive the
protected set by filtering the discovered routes against the `PUBLIC_ROUTES`
literal, and the carve-out returns `next()` before `requireSession` can redirect
— so for `/signin` the mount position is **unobservable**, not tested. What G2
and G3 **do** prove, and prove strongly: **a route that should be protected but
is mounted public is caught, provided nobody also adds it to `PUBLIC_ROUTES`** —
each cookieless answer on the protected side is attributable to the guard (same
status as an unrouted probe, no `Set-Cookie`, guard-derived `Location`). The
proviso is the hinge, and the two-file discipline enforces it: adding a route
means editing `PUBLIC_ROUTES` with a written reason, which is a reviewable act.
What is **not** observable is publicness-by-placement versus
publicness-by-carve-out, and `/signin` is the only path where those differ. The
residual is bounded rather than closed, by `auth.test.js`'s `'requireSession has
exactly one path carve-out'`, **and the bound is over three spellings of the
request path**: the case commits a separate count for `req.path`, `req.url` and
`req.originalUrl` in the guard's own source, so a second carve-out written any
of those three ways moves a committed number. What is **not** counted, stated
plainly rather than implied: a carve-out written another way — destructuring,
bracket access, `req.baseUrl`, or a match on something that is not the path —
joins the unobservable set silently. (Review cycle 2, finding F-C: the bound
previously counted `req.path` alone, and a carve-out spelled `req.url` was shown
to pass with the suite green while these sentences claimed otherwise.)

**Passwords** are hashed with `scrypt` from `node:crypto` — no new dependency —
at `N=16384, r=8, p=1, keylen=32`, 16-byte salt, `maxmem` passed explicitly.
scrypt over pbkdf2 because it is **memory-hard**: a guess needs ~16 MiB, so an
attacker's parallelism is bounded by memory bandwidth rather than ALU count.
Measured in the pinned image (emulated amd64, an upper bound): **median 40 ms**,
against an accepted interactive budget of 250 ms. `N=32768` also fits the budget
but **throws** under Node's default `maxmem`, so 2^14 is the strongest set whose
failure mode under a forgotten argument is benign.

The stored value is self-describing — `scrypt$N=…,r=…,p=…,l=…$salt$key` — so
raising the parameters never invalidates an account: the next successful sign-in
re-hashes at the new default. Passwords are normalised to **NFC** at both ends
and **never trimmed** (a trailing space is a character of the secret).

**Sessions** are server-side rows, not signed tokens — chosen for revocation
(sign-out is a `DELETE`, so the session is genuinely gone) and for testable
expiry. The cookie carries 32 random bytes; the table stores their SHA-256, and
that digest is the primary key, so a leaked database file yields nothing usable.
Two `CHECK` constraints make the two worst mistakes impossible at the engine:
a `password_hash` that is not `scrypt$…`, and a session id that is not 64 hex
characters (a raw 43-character token fails on length).

Lifetime is a fixed **14 days**, no renewal — it must comfortably exceed the
Stripe hosted-KYC detour, which can run for days. Expired rows are deleted by
the request that finds them, plus an opportunistic sweep on every sign-in; there
is no scheduler to forget to start.

`SameSite=Lax`, not `Strict`, and the reason is load-bearing: Stripe returns the
freelancer by a **cross-site top-level GET navigation**, which `Strict` would
strip the cookie from — silently breaking chain link 2. `Secure` is derived from
`INVOICING_APP_BASE_URL`, so the first HTTPS deployment gets it with no new
setting and no code change. **AS-40 adds no config row and needs no secret:** the
token is random rather than signed, so there is nothing to configure or leak.

CSRF is `SameSite=Lax` **plus** a same-origin check on every unsafe method
(`Origin`'s host against `Host`, falling back to `Referer`, failing closed when
both are absent). No CSRF token in v1 — that would need every form template to
cooperate, four cross-task obligations whose failure mode is a broken form found
late. **Trigger to add one:** the first form submitted to us from a page we do
not render. Note the ordering consequence: the origin check sits **above** the
auth boundary, so an unsafe request with no `Origin` and no `Referer` is a
`403` before the guard ever runs — a browser always sends one.

### A forgotten password

**There is no self-service recovery and no password-change screen.** Email is
out of v1 by two independent rules, so a freelancer who forgets their password
is a support case. The operator — someone with shell access, which in v1 is the
company — computes a new hash with the app's own function and updates the one
row:

```sh
# 1. compute the encoded hash (prints scrypt$N=...,r=...,p=...,l=...$salt$key)
docker compose exec web node --input-type=module -e \
  "import('./lib/auth/password.js').then(async m => console.log(await m.hashPassword(process.argv[1])))" \
  -- '<temporary password>'

# 2. write it to the one row, with the freelancer's id
docker compose exec web node --input-type=module -e \
  "import('./lib/db/database.js').then(({ prepareDatabase, createRepositories }) => { \
     const { db } = prepareDatabase({ dbPath: '/app/data/invoicing.sqlite' }); \
     createRepositories(db).credentials.updateHash(process.argv[1], process.argv[2]); \
     db.close(); })" \
  -- '<freelancer id>' '<the encoded hash from step 1>'
```

Three consequences, said out loud: the temporary password **is** the account's
password from then on (there is no change screen); it appears in the operator's
shell history and process list; and it is a support case with no ticket and no
audit trail beyond `credentials.updated_at`. All three are acceptable at v1's
scale and all three are resolved by the milestone that brings email.

### What AS-40 decided NOT to do, with triggers

- **No rate limiting or lockout.** The unauthenticated surface is reachable only
  from the host running the container — `test/deploy-shape.test.js` pins the
  port map to `127.0.0.1` and `config.test.js` pins the app's own default bind
  to loopback. That matters here specifically because sign-in performs a
  deliberate ~40 ms / 16 MiB derivation on **every** attempt including failures.
  **Two triggers, either of which makes it mandatory in the same task:** the
  first task that serves this app on a non-loopback interface, and any committed
  manifest setting `INVOICING_BIND` or a published port to something that is not
  a loopback address.
- **No "sign out everywhere" and no absolute cap beyond the 14 days.** Both
  bound a stolen cookie, and the capability that makes them necessary is
  credential change, which v1 has none of. **Trigger:** the first task that lets
  a credential change (a reset flow, or a password-change screen) must land
  `sessions.deleteForFreelancer` and call it on the change, in the same task.
- **No `__Host-` cookie prefix.** It would force `Secure` unconditionally, which
  conflicts with loopback. **Trigger:** the first HTTPS deployment on a real
  domain adopts it in the task that configures the domain.
- **No scheme comparison in the origin check.** It would require
  `app.set('trust proxy', …)` the moment a TLS-terminating proxy appeared, and
  would fail closed on every POST until someone realised. **Trigger:** adopt it
  together with `trust proxy` in the task that first puts TLS in front of this
  app.
- **No invite-only switch on sign-up.** Same trigger as rate limiting; decide
  both together in that task, or neither.

**`public/` is world-readable without a session** — `express.static` is mounted
above the boundary so a signed-out browser can load the sign-in page's
stylesheet. Nothing per-user may ever be written there.

## The view layer

Landed by AS-45 with screen 1; screen 2 (AS-70) followed it exactly, and is the
shape to copy — `lib/screens/connect-view.js` is the smaller example. **Read
this before planning AS-46, AS-47 or AS-48** — four things were decided once
here and every later screen inherits them.

Screens are server-rendered EJS. There is **no client-side JavaScript** in this
app and no build step; the two direct dependencies are still `express` and
`ejs`.

**Four properties hold over the files in `views/` (three of them over
`public/` too), and each is a concept row in `test/dependency-policy.test.js`
rather than a convention.** EJS has exactly two output tags — one escapes, one
does not — so "we use the escaping one" is a promise about every author,
forever. These are the mechanism instead.

**They are four ENUMERATED POSITIONS, not a universal claim.** This section used
to say property 2 was "no interpolation reaches a position where escaping is
insufficient". That sentence is false and was proven false in review cycle 1:
EJS escapes `& < > " '` and does **not** escape `=` or a space, so an
interpolation between attributes — in the position an attribute *name* goes —
renders a submitted value as markup *structure*, and every property below stayed
green on it. No lexical rule over template files can support a universal claim,
so this section states what is actually enforced and nothing more:

1. **No raw output.** The non-escaping tag occurs nowhere, so every
   interpolation is escaped and there is no site an author can reach for. It is
   **not** banned outright: raw output is gated by a keyed, counted,
   line-pinned allowlist (`RAW_OUTPUT_SANCTIONED`) that currently holds **zero**
   entries. `lib/contracts/render.js` already commits AS-47 to emitting a
   rendered contract with raw output exactly once inside the document region —
   that becomes the first entry, reviewed on its own merits, pinned to one exact
   line, and unable to absorb a second occurrence. A blanket ban would have
   been quietly widened by whoever hit it first.
2. **No interpolation in these five attribute values, no event-handler
   attribute, and no `script` or `style` element.** The five are `href`, `src`,
   `action`, `formaction` and `style` — the URL and style contexts, where
   `javascript:` and `expression(` need no angle bracket. A path that must
   survive a round trip (`next`) travels in a hidden `value=` input, **never in
   a URL** — which is why screen 1's mode switch is a `<button>` inside a
   `method="get"` form rather than an anchor. It produces the identical URL with
   a plain full-page navigation and keeps the rule absolute with no judgment
   call at the call site. **The attribute-name matching is case-folded, because
   HTML's is**: `ONMOUSEOVER=`, `OnClick=` and `HREF=` are the same attributes
   to a browser as their lowercase spellings, and until review cycle 3 the first
   two rows matched only lowercase — an uppercase event handler landed with
   every row green and a payload of `alert(1)`, which contains none of the five
   characters the escaping output tag escapes. The five URL/style names are a
   **closed enumeration**, presented as one: `srcset`, `poster`, `ping`,
   `xlink:href` and `<object data=>` are URL-bearing and deliberately not in it,
   because no template uses them. A template that needs one adds it to the row
   in the same commit.
3. **Attribute values carrying data are double-quoted**, because escaping `"`
   only helps if `"` is the delimiter.
4. **No interpolation in the tag-name or attribute-name region.** Within any
   start tag in `views/`, every output tag sits **inside a double-quoted
   attribute value**; an output tag in the tag's name-or-attribute-name region
   is forbidden. Both halves are enforced, and the second sentence of the
   property is the rule that enforces the first half, stated here rather than
   left to the scanner: **a `<` immediately followed by an EJS open tag opens a
   start tag whose name is interpolated, and is a finding rather than text.**
   The **closing**-tag name region is covered too, by the same in-tag walk. The
   two positions are `<span class="x" INTERPOLATION>` and
   `<INTERPOLATION class="x">`, and a submitted value of `x onmouseover=alert(1)`
   in either becomes a live event handler needing neither an angle bracket nor a
   quote — the second of them was unguarded until review cycle 2 found it and
   ruling R-6 extended the scan (the property was never narrowed to match the
   mechanism). It is sound **because property 3 holds**: the scan skips quoted
   spans, which is what makes a `>` inside an attribute value harmless. It is a
   *lexical* rule, so it cannot assert a render-time property; that half is a
   falsification recipe that plants each construct, rebuilds, and drives the
   exploit at a running container. Its non-vacuity floor is a committed
   start-tag count, which catches the one instrument that can silently narrow
   the scan — **its own walker**, whose quote skipping happens *only inside a
   tag region*. The placement that opens a runaway span is therefore an
   apostrophe **inside a tag region and outside a quoted value** —
   `<span ' class="app-label">` — which collapses the examined tag count from 87
   to 14 (measured at that exact placement in review cycle 4; the earlier
   published figure named the wrong placement twice). An apostrophe in
   **element content** — the one in `don't` — collapses nothing: element content
   is never scanned for quotes, the count holds at 87, and prose copy carrying
   an apostrophe is **not** a hazard in this app. Nor is one inside a
   double-quoted attribute value.
   An interpolated tag name is *counted* as a start tag, because at render time
   it is one, so the count does not move when the construct is planted and the
   finding stands on its own merits.

Each landed on a **measured baseline of zero**, so none is a hole waiting for a
tenant. The one exception measured **one**: the scaffold page's
`style="background: var(--…)"`, which is why retiring it was a precondition of
this task rather than housekeeping bundled alongside it.

**What these four do not cover, stated rather than implied.** They are lexical
properties of the template files. They do not stop a route handler from
`res.send`-ing a hand-built string, and they do not stop a view model from
computing markup and handing it to an escaping output tag (it would arrive
escaped — visibly broken, not dangerous). The dynamic half is
`test/screens.test.js`, which drives a real request whose user-controlled value
is markup and counts occurrences in the served bytes.

**There are no partials, deliberately.** An `include` is a raw-output tag, and
permitting it is the one carve-out that would make property 1 conditional. The
cost is roughly fourteen duplicated lines of head and header chrome per screen.
That cost is paid, and what a partial would have protected against — one
screen's head drifting — is closed better by `screens.test.js`'s assertion that
**every registered template** links both stylesheets, carries the viewport meta
and stamps `data-state`, which also catches a partial that stopped being
included. Revisit at AS-48, when all seven screens exist: if the duplicated
block exceeds twenty lines per screen, or a change to it has had to be made in
more than three files at once, propose `include` as a counted allowlist entry
with a line-pinned regex.

**A screen is a pure view model plus a presentation-only template.**
`lib/screens/<screen>-view.js` exports a frozen ledger — transcribed from
`docs/design/wireframes/02-states-ledger.md`, with a disposition per row — plus
a frozen list of the states that actually render and a pure function from route
inputs to locals. No I/O, no clock, no `req`, no `res`. The template branches on
precomputed booleans and reads properties; it contains no logic. That buys three
things, in this order: "every state is reachable" becomes mechanical; the
properties above stay auditable by eye as well as by grep; and the state machine
is unit-testable without HTTP, exhaustively, in microseconds.

**What the state guarantee claims, and what it does not.** The frozen list and a
table in `test/screens.test.js` are **two independent hand transcriptions of the
ledger, compared against each other** by exact set equality and cardinality, and
every `data-state` a template can stamp is a member of that closed set. So a
change to either copy alone is red, a render can never leave the set, and a state
cannot be quietly dropped from the module. What is **not** true, and used to be
written here: that a row appearing or vanishing *in
`docs/design/wireframes/02-states-ledger.md`* turns the suite red. It does not —
both copies would have to be hand-edited, and it is the *second* edit the test
detects. Nothing in the suite reads that document and nothing in it can: the
`test` service is mountless by design and the Dockerfile vendors exactly one file
from outside the app, `docs/design/tokens/tokens.css`. **The join to the design
document is a dated review act:** all eight screen-1 rows checked by hand against
§1 on 2026-09-03 by `agent:qa-priya`; all nine screen-2 rows transcribed from §2
on 2026-09-12 by `agent:developer-marcus`, with the reviewer's own check recorded
on AS-70. Closing it mechanically means vendoring the ledger into the image the
way `tokens.css` already is — AS-71, which depends on AS-70's second
transcription now existing.

A row whose disposition is not `rendered` is **accounted for, never silently
skipped**: `redirect-answered` (the response is a 303, so no markup exists),
`path-into-render` (a way of arriving at another state), `n/a` (the ledger's own
"n/a — because" row), and `unrenderable — browser-supplied` — which is how
`S1-LOADING` and `S2-LOADING` are recorded. "Fields disabled, button reads
*Signing in…*" is a state a page enters *after* its bytes were served; with no
client-side JavaScript the interval between submit and the server's 303 is the
browser's own loading indicator. **Their absence is an assertion, not a gap.**

**Each rendered state stamps `data-state="<ledger row id>"` on the page's root
element**, so an HTTP test asserts on an exact sentinel instead of on a copy
fragment. Assert on the sentinel. A wording change is a design decision, and a
test that breaks on one teaches people to assert on nothing.

**A screen's GET route joins its capability's existing area router** —
`routes/invoices.js` for invoice screens, `routes/contracts.js` for contract
screens — never a new mount in `app.js`. The mount order in `app.js` is a
security boundary and should not be disturbed once per screen. Screens above the
auth boundary live in `publicAuthRoutes` (screen 1 is the only one: it is where
the guard *sends* people); everything else is protected by position, adding no
second publicness mechanism. `routes/pages.js` stays the home for routes
belonging to no capability, which is now exactly one.

**A screen that must re-render a submitted form owns its own POST routes**
beside the capability's API routes, registered before any `:id` route that
would otherwise capture a literal segment, and its form carries no `action`
attribute — the page's own URL is the target, which keeps an id out of a URL
attribute (property 2) and makes "re-render the same screen, same route"
literal. Everything the page can do is a submit button named `intent`,
dispatched server-side; there is no client-side JavaScript and every round trip
re-renders from the body, so nothing is ever carried in a URL. Landed by AS-46
with screen 4; the inline-client ruling in its plan §3.3 (the screen creates the
client through the same repository call `POST /clients` uses, from its own
handler, because a form posting straight to the endpoint can reach only two of
the four §0 states) applies to screen 6 unchanged.

**Money crosses the human boundary in exactly one file.** `lib/db/money.js`
owns the two conversions (`formatMinorUnits`, `parseMajorUnits`); the screen's
view model is the one place that calls them and is a member of the
`'money representation'` row for that reason. Templates and stylesheets stay
clear of the words — measured, and asserted by the same row.

**Every visual value in `public/*.css` is a `var(--token)` reference to a custom
property that EXISTS in the vendored `tokens.css`.** No colour literals, no
dimensional literals; unitless numbers, percentages and layout keywords are
deliberately not policed, because a check that fires on `display: flex` gets
loosened, and a loosened check is how a real one gets waved through. The
resolution half is the one that matters and the one no "no literals" check can
do: CSS ignores an unknown custom property **silently**, so
`var(--color-text-primaryy)` renders unstyled and passes any literal check ever
written. `test/assets.test.js` resolves every name against the token file, after
four cardinality assertions — the directory listing, the token file's 183
declarations and 127 distinct names, the stylesheet's declaration count and its
`var()` reference count — so nothing is quantified over an empty set.

Media preludes are the one exception, because `var()` is invalid inside a media
condition: a `px` literal there must carry a trailing comment naming
`--breakpoint-<name>` **and must equal that token's value**, which the test reads
rather than takes on faith. Stylesheets are **mobile-first**: every media
condition is `min-width`, none is below `--breakpoint-sm`, and no declaration
sets a `width`, `min-width` or `flex-basis` to a length literal — so the base
ruleset **is** the ruleset at 375px, by construction, with no fixed box that can
force horizontal overflow. That is a real property and it is the one AS-23 got
wrong. It does **not** establish that the result is legible or that tap targets
are reachable; there is no browser in the suite, so that half is a recorded
inspection in the task's Lattice comment, naming both the states looked at and
the states not looked at.

**Scope note, and the guards hold each other up:** the token check covers
`public/*.css` only. That is sound *because* property 2 bans `style` elements
and `style=` interpolation in `views/` — there is nowhere else a visual value
can hide.

## Contracts

Chain link 3 (AS-42). One route, `POST /contracts`, below the auth boundary. It
takes an existing `clientId`, an optional `templateId`, and one field per
form-sourced template variable; on success it answers `303` to
`/contracts/<id>`, which 404s until AS-47 lands the screens. **It is the one
feature in this app with no Stripe dimension at all** — `contractRoutes` takes
`{ repos }`, not `{ repos, stripe }`, and nothing under `lib/contracts/` names
Stripe in code or in a comment (asserted, not asserted-by-comment).

**A template is code.** `lib/contracts/templates/` holds frozen declarations
that ship in the image; there is no user-supplied template path, and no
substitution *syntax* anywhere — a body is structured segments that are either
template-authored text or a named slot, so there is no parser to confuse. Every
text node, template-authored and user-supplied alike, goes through the one
`escapeHtml` in `lib/contracts/render.js` (pinned there by a dependency-policy
concept row), and no data ever reaches an attribute position: every attribute in
the output is a renderer-authored constant.

**The version rides in the template id** (`independent-contractor-agreement@1`).
Replacing the placeholder body is a NEW declaration at `@2`, never an edit to
`@1`, so already-issued contracts keep reproducing:
`renderContract(getTemplate(c.templateId), c.variables)` equals
`c.renderedHtml` byte for byte. A digest committed in `test/contracts.test.js`
turns the suite red if the content moves without the id moving with it.

**THE CLASS NAMES INSIDE A STORED `rendered_html` ARE A FROZEN CONTRACT, and
this is the price of storing rendered output.** A contract issued today carries
`contract-doc`, `contract-doc__notice`, `contract-doc__notice-title`,
`contract-doc__title`, `contract-doc__body`, `contract-doc__attribution` and
`contract-doc__multiline` forever. They may be **added to**; they may **never be
renamed**, or every already-issued document loses its styling. Whoever styles
these screens sets `white-space: pre-wrap` on the last one and renames nothing.

**A contract is immutable, and that is implemented as absence.** There is no
`POST /contracts/:id`, no `PATCH`, no `DELETE`, and no handler whose job is to
say "no" — nothing serves such a request, so it 404s. A freelancer who made a
mistake generates a new contract with the corrected values; v1 never delivers a
contract, so the superseded row is one nobody outside their account has seen.

**The body text is a clearly-marked placeholder pending a lawyer-agent review**,
marked three independent ways inside the document itself (the title, the notice
section, and three `[PLACEHOLDER — …]` labels) so losing one marker does not
silently unmark it. Its attribution line deliberately does **not** credit Common
Paper: this text is adapted from nothing, and saying otherwise would misattribute
authorship and make the document look more authoritative than it is. The
mechanism that will carry a real credit is already built and already exercised —
a declaration that names a `sourceTemplate` whose licence is absent from its
attribution fails at module load.

## Layout

```
server.js        entrypoint: loadConfig() -> prepareDatabase() -> createApp() ->
                 listen(). Only this file and lib/config.js touch process.env
app.js           composition root. Takes config as an ARGUMENT, never reads the
                 environment. Route registration order is load-bearing
lib/config.js    schema-as-data; frozen settings; redacted() for secrets
lib/db/          the persistence layer (AS-39). database.js is its front door:
                 prepareDatabase (open + migrate, at boot), probeDatabase (the
                 /healthz check) and createRepositories (the seven frozen keys
                 a route module is handed)
  connection.js    openDatabase() and transaction() — the ONE import of node:sqlite
  migrate.js       the MIGRATIONS registry, the schema_migrations ledger, migrate()
  migrations/      one file per schema version, never edited once shipped
  money.js         SUPPORTED_CURRENCIES and the minor-unit validators — the one
                   file that spells a currency code
  errors.js        the RepositoryError classes and the input asserts
  repositories/    freelancers, connected-accounts, clients, contracts, invoices,
                   stripe-events — the only files that contain SQL besides the
                   three above; owner-scoped, camelCase in and out
lib/stripe/      the ONLY outbound HTTP in the product (AS-38):
  custody.js       the three policy tables and guardRequest() — the never-in-the-
                   flow-of-funds boundary as data, checked before the key exists
  client.js        createStripeClient(): validate -> build -> guard -> requireKey
                   -> sign -> transport -> interpret; encodeForm(); the error classes
  transport.js     fetchTransport(): the one `fetch` token in product source
lib/connect/     Stripe Connect onboarding (AS-41):
  readiness.js     the ONE account-object -> readiness-patch mapper; AS-44's
                   account.updated handler reuses it (`ready` itself is derived
                   in lib/db's row mapper, nowhere else)
  onboarding.js    the three platform Stripe calls + create-or-reuse + the sync
                   moments — the only file with `platform: true` call sites,
                   pinned by dependency-policy
lib/invoices/    the invoice lifecycle (AS-43):
  mapping.js       the ONE Stripe-invoice -> snapshot mapper; AS-44's invoice.*
                   handlers reuse it. Never emits sentAt/lastPaymentFailedAt
  lifecycle.js     the readiness gate, the five connected-scope Stripe calls,
                   the resumable pipeline and the reconciliation guard — the
                   only file in this feature that calls Stripe
lib/webhooks/    the inbound half (AS-44) — the only feature that calls Stripe
                 ZERO times:
  signature.js     the pure verifier; the ONE createHmac in the product. Takes
                   a Buffer and refuses a string
  receiver.js      the eight-row handler table, one transaction with
                   recordOnce first. No async, no await, no clock
lib/health.js    the checks, as data
lib/vendor.js    assets consumed from outside this app (registry)
lib/views.js     the template registry + the health check's render probe
lib/contracts/   contract templates and generation (AS-42) — the one feature
                 with no Stripe dimension:
  templates.js     the registry, getTemplate(), and the load-time invariants
                   (both slot directions; the attribution/licence cross-check)
  templates/       one file per frozen declaration; never edited once issued
  render.js        the pure renderer: the ONE escapeHtml, the closed tag
                   vocabulary, the 12-entry month table (never Intl)
  generation.js    validate -> resolve -> render -> persist; the ONE form-key
                   check, so the route keeps no allowlist that could drift
routes/          health.js, webhooks.js, assets.js, pages.js, connect.js,
                 invoices.js, contracts.js — mounted in that order, which is
                 load-bearing
views/           one template file per screen
public/          app-owned static assets, served by express.static
vendor/          created by the Dockerfile — see below. Not in version control
test/            node --test; helpers/server.js starts and stops apps safely
```

## `tokens.css`, and why the build context is the repo root

`docs/design/tokens/tokens.css` is the single source of visual truth for
everything the company ships (AS-29), derived from `BRANDING.md`. The stack
decision requires it be served **byte-identical — no copy, no transform, no
hash**, verified as `Content-Length: 12199`.

So this app **consumes** it and never owns it: `compose.yaml` builds with
`context: ../..` (the repo root) and the `Dockerfile` COPYs the one file to
`/app/vendor/tokens.css`, which `routes/assets.js` serves through an explicit
named route registered **before** `express.static` — so a stray
`public/tokens.css` can never shadow it. Exactly one copy of those bytes exists
in version control. A second checked-in copy is what "no copy" forbids, because
it would drift silently.

The repo-root context is why **`/.dockerignore` at the repo root exists** and is
not optional: without it the build context of this product image includes
`apps/chat/data`, the company's live internal chat database. `test/deploy-shape.test.js`
asserts those exclusions are present.

Changing `tokens.css` turns this suite red on purpose: the byte count and the
declaration count are committed literals. Update them in the same commit.

## Obligations this scaffold hands forward

- **AS-46 (screen 4) hands forward.** **AS-48:** the `send` success terminus
  (`/invoices/{id}`) is asserted as a `Location` only in
  `test/invoice-screen.test.js` — add the followed-terminus assertion when the
  detail screen exists; the Dashboard nav entry (one anchor in
  `views/invoice-form.ejs`; `01-screens.md` names `/dashboard` while the app's
  landing constant is `/` — AS-48 owns that constant); and "finalized, not
  sent" after a failed send lives on the detail screen (the edit GET 303s there
  once a Stripe invoice is attached, dropping the `?error` flag). **AS-47:** the
  New contract nav entry (one anchor in the same template); the inline-client
  ruling in AS-46's plan §3.3 applies to screen 6 unchanged. **AS-70:** nothing
  — screen 4's gated state links to `/connect-stripe`, which AS-70 landed
  first (merge order AS-70 → AS-46); the link check in
  `test/invoice-screen.test.js` went green at the rebase.

- **AS-45 DISCHARGED the scaffold obligation; AS-70 discharged AS-45's.**
  `views/scaffold.ejs`, `public/scaffold.css`, its `VIEWS` row and its
  `routes/pages.js` handler are gone, and so is the `renderSignIn` seam AS-40
  left. AS-70 landed screen 2 at `GET /connect-stripe` and restored `/` to the
  303 that lands on it. **One hand-off to AS-48, stated once here:** screen 2's
  READY state renders **no control** — the wireframe's "Continue to Dashboard"
  points at screen 3, and a link to `/` would land the freelancer back on the
  page they are on. AS-48 adds that anchor (a constant `href`, so P2a is
  untouched) with a terminal-state case that follows it to a 200, replaces the
  `/` route with the Dashboard, and owns `POST_SIGNIN_LANDING` in
  `lib/auth/guard.js` (it stays `/` until then — AS-45 plan §3.3.4). See § The
  view layer below — that section, not this bullet, is what AS-46/47/48 read
  first.
- **AS-38 landed Stripe: `lib/stripe/` is the only outbound HTTP in the
  product, and the custody guard is the only way through it.** The one `fetch`
  token in product source is a pinned line of `lib/stripe/transport.js`; the one
  import of that file is a pinned line of `lib/stripe/client.js`; both are
  `SANCTIONED` entries in `test/dependency-policy.test.js`, which fails on any
  other HTTP client (`fetch`, `http`/`https`/`http2`/`net`/`tls`,
  `child_process`, `WebSocket`, the `stripe` SDK) anywhere outside `test/`. Do
  not add a generic HTTP helper: the guard runs **before** the key is checked and
  never sees the key, so every request Stripe receives from this app went
  through it. **Adding an endpoint:** the dependent task that needs it adds one
  row to `ALLOWED_ENDPOINTS` in `lib/stripe/custody.js` — `method`, exact path
  with `{id}` for the one variable segment, `scope` (`platform` or `connected`),
  and a `reason` — plus its case in `test/stripe-mock.test.js` and the row-count
  literal in `test/stripe-client.test.js`. Never a wildcard, never a row under a
  `FORBIDDEN_ENDPOINT_PREFIXES` entry (the module refuses to load), and never a
  parameter named in `FORBIDDEN_PARAMS` — those tables change only with a board
  ruling recorded in the task that changes them.
- **AS-39 landed data: SQLite through `node:sqlite`, migrated at boot, on a
  named volume.** The database is `/app/data/invoicing.sqlite` inside the `web`
  container, on the compose volume **`asc-invoicing_invoicing-data`** — the one
  volume in `compose.yaml`, and `web`'s alone (`test` still mounts nothing).
  `docker compose down` keeps it; **`docker compose down -v` destroys it**, and the
  next `up` starts from an empty file (`applied 1 migration(s)` in the log instead
  of `applied 0`). Boot is `loadConfig -> prepareDatabase -> createApp -> listen`:
  a process that cannot open or migrate its database exits non-zero naming the
  path and never listens, so a mis-mounted volume is loud, not a silent fresh
  database in the container layer. **Adding a table or column** is a new
  `lib/db/migrations/NNNN-<name>.js` exporting `{ version, name, up }` plus one
  line in `MIGRATIONS` (`lib/db/migrate.js`) — never an edit to a shipped
  migration; the runner refuses a database that is ahead of the build or whose
  ledger disagrees with the registry. `/healthz` runs **four** checks —
  `config`, `vendor_assets`, `views`, `database` — and the fourth is a
  file-level probe (file exists, directory and file writable, opens as a
  database, schema version matches) that never creates the file it is checking.
  Money is integer minor units with an explicit `currency` column; the allowed
  currency set is `lib/db/money.js` and nowhere else. `INVOICING_DB_PATH`
  overrides the path (absolute, not `:memory:`); the default is the single
  source of truth and `test/deploy-shape.test.js` checks compose and the
  Dockerfile against it.
- **AS-41 landed Connect onboarding server-side; its AS-40 handoff is
  DISCHARGED and one remains.** The interim `resolveFreelancerId` seam and the
  `?freelancer=` parameter are gone: every connect route now reads the session
  (§ Accounts below). Return and refresh keep working, as AS-41 predicted,
  because a Stripe redirect is a top-level GET navigation and the cookie is
  `SameSite=Lax`. **AS-70 landed screen 2** at `GET /connect-stripe`, so every
  redirect this module issues ends on a rendered state, and `GET /` redirects
  there again. The Stripe redirect target is one constant in
  `lib/connect/onboarding.js` plus its test assertions if the route is ever
  renamed. Readiness discipline for every future writer (AS-44 included): write
  through `connectedAccounts.updateReadiness` only, with a snapshot freshly
  read from Stripe, mapped by `lib/connect/readiness.js` — never inferred from
  a redirect, never cached, last writer wins.
- **AS-43 landed the invoice lifecycle server-side; two handoffs are open.**
  **AS-44 (webhooks) LANDED** — it imported `invoiceSnapshotFromStripe` for
  seven `invoice.*` types (the six listed here plus `invoice.sent`, which the
  Lattice description included and this bullet omitted) and writes `paid`,
  `void`, `uncollectible` and `lastPaymentFailedAt`. Two rules survive as live
  constraints on everyone: **do not mount a body parser app-wide** — the webhook
  needs the RAW body, which is why AS-43's parser is mounted per route and why
  `test/dependency-policy.test.js` now pins the two files that may hold one; and
  **`sentAt` and `lastPaymentFailedAt` must never be emitted by the mapper** — a
  Stripe invoice object has neither, so emitting them as null would erase a
  recorded fact on the next snapshot (each is written by its own writer, at its
  own moment; R23 is that rule under test). **AS-46 (screen 4)** owns `/invoices/{id}/edit` and
  **AS-48 (screens 3 and 5)** owns `/invoices/{id}`; both paths are already
  load-bearing in shipped `Location` headers, so treat them as settled unless
  you also change AS-43's redirects — note that AS-40 removed the `?freelancer=`
  query string from both of them, so the shipped targets are now bare paths.
  **AS-40 (sessions): DISCHARGED.** These routes no longer import anything from
  `routes/connect.js`; both read the session through `actingFreelancerId`.
- **AS-44 landed the webhook receiver; two handoffs are open.** See
  § Receiving webhooks above for what it does. **AS-48 (screens 3 and 5):** the
  mirror row is the only thing a screen should render — `status`, `paidAt`,
  `sentAt`, `lastPaymentFailedAt` and both URLs are all maintained by this
  receiver, so a screen needs no Stripe call and no polling. It also adds no
  `GET`, so a "refresh from Stripe" button would be a new allowlist row and a
  new task. **AS-50 (acceptance run):** everything in §5.5 of this task's plan
  is yours — real delivery, real ordering, real latency, the live
  `Stripe-Signature` header shape at this API version, whether 300 s of
  tolerance is comfortable against real clock skew, whether a repeated 500
  really disables the endpoint and how fast, and whether
  `stripe listen --forward-to localhost:8348/webhooks/stripe` reaches the
  compose stack at all. **The cheapest confirmation that our HMAC agrees with
  Stripe's** is to record the first real `Stripe-Signature` header verbatim
  (minus the digest) and the first successful verification in the run record;
  the live header shape falls out of the same line. Also worth recording for its
  own sake: the full event sequence Stripe emits for one invoice, which settles
  whether `invoice.sent` fires for an invoice sent by our own `/send` call.
- **AS-40 landed accounts; ONE handoff is open.** **AS-45 (screen 1):
  DISCHARGED.** `GET /signin` serves the screen, and `renderSignIn` renders it
  rather than emitting a one-line `text/plain` body — the status taxonomy did
  not move, so nothing that asserted on a status did either. It preserves
  `email`, `displayName` and `next`, and **never** the password: the view model
  has no key for one. **AS-48 (the landing point):**
  a successful sign-in with no `next` lands on `POST_SIGNIN_LANDING`, one
  constant in the same file. **AS-45 deliberately declined to move it**, because
  changing the constant here would have moved assertions in another task's suite
  to buy one saved redirect hop; `/` is a 303 to `/connect-stripe` (AS-70) in
  the meantime, and the three entry points that land there are each followed to
  a 200 on screen 2 by a test rather than asserted at the first hop.
  AS-48 changes the constant and its assertions. **AS-50 (acceptance run):** everything this
  suite cannot see — whether a real browser sends the cookie on Stripe's return
  navigation (the cheapest confirmation is one line in the run record: did the
  return land on the connect handler as a signed-in freelancer, or bounce to
  `/signin`?), one real sign-in's wall-clock on the deploy target, and whether
  14 days is the right lifetime.
- **Adding a route is a two-file change, deliberately.** `test/auth.test.js`
  walks the built app's router tree and compares it to a committed
  `(method, path)` list; a new route turns that red until its author adds it and
  classifies it in `PUBLIC_ROUTES` or leaves it protected. There is no path from
  "someone added a route" to "it is unprotected and nobody noticed".
- **The dependency budget is 2.** A third turns the suite red and goes through
  all six rules in the stack decision §11 first. Install with
  `npm install --save-exact` — plain `npm install` writes a caret range, which
  the decision forbids.
