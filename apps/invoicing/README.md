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
the run container). Plain `docker compose down` after `up` is unchanged.

`web` serves on **http://127.0.0.1:8348** — `/` (scaffold page), `/healthz`,
`/tokens.css`, and the Stripe Connect onboarding routes (AS-41):
`POST /connect-stripe/start` (create-or-reuse the connected account, 303 to
Stripe-hosted onboarding), `GET /connect-stripe/return` (fresh readiness read —
the return itself is never trusted — then 303 to the screen) and
`GET /connect-stripe/refresh` (mint a fresh link, 303 straight back into the
hosted flow). All three take `?freelancer=<id>` until AS-40 lands sessions, and
all three 303 targets include `/connect-stripe`, which 404s until AS-45 lands
screen 2 — deliberate: the Location header is the contract, and AS-45 depends
on this task. It also serves the four invoice routes (AS-43) — see
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

The app has exactly one secret setting, `INVOICING_STRIPE_SECRET_KEY`
(`lib/config.js`, the only `secret: true` row). It is **optional, and absent by
default**: nothing in this repository has a Stripe key, the Stripe account itself
is a board-gated ask (AS-51), and every command above runs without one.

`compose.yaml` passes the variable through as `${INVOICING_STRIPE_SECRET_KEY:-}`
— the value comes from your shell or from an env file you name on the command
line, never from a committed file. To run `web` with a test-mode key, keep it in
`apps/invoicing/.env.local` (gitignored at the repo root, `.dockerignore`d at the
repo root, and **not** referenced by `compose.yaml`, so its absence is not an error):

```bash
# apps/invoicing/.env.local — never committed
INVOICING_STRIPE_SECRET_KEY=sk_test_x
```

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
`text/plain` error otherwise, all taking `?freelancer=<id>` until AS-40:

| Route | Does | 303 to |
|---|---|---|
| `/invoices` | create a LOCAL draft — **zero Stripe calls** | `/invoices/{id}/edit?freelancer=` |
| `/invoices/{id}` | update a LOCAL draft — **zero Stripe calls** | `/invoices/{id}/edit?freelancer=` |
| `/invoices/{id}/finalize` | the gate, then the pipeline **through finalize** | `/invoices/{id}?freelancer=` |
| `/invoices/{id}/send` | the gate, then the pipeline **through send** | `/invoices/{id}?freelancer=` |

`/invoices/{id}` and `/invoices/{id}/edit` 404 until AS-48 (screens 3 and 5) and
AS-46 (screen 4) land — the same deliberate dangle as `/connect-stripe` above.
AS-46's single "Finalize & send" control posts to `…/send`; `…/finalize` exists
because finalize and send are two operations with two failure modes, and AS-49
can drive them separately to observe the intermediate state.

**The gate.** Finalize and send both refuse with **403 `AccountNotReadyError`**
(`not-connected` / `not-ready`) *before any Stripe call* unless the freelancer's
connected account is ready. Readiness is **read, never re-derived**: the one
derivation lives in `lib/db/repositories/connected-accounts.js` and nothing in
`lib/invoices/` names its underlying fields. Drafting is deliberately ungated —
a freelancer may build drafts before connecting Stripe.

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
- **The reconciliation guard.** After finalize, Stripe's `amount_due` and
  `currency` must equal ours, or the send is refused with **409
  `AmountMismatchError`** — *after* the snapshot is written, because Stripe
  really did finalize it and a mirror saying `draft` would be a lie. Resolution
  is the freelancer's, in their own Dashboard: `/v1/invoices/{id}/void` is
  deliberately not on the allowlist.

**Every step is skipped when the mirror records it done**, so re-submitting the
form after a failure completes the run rather than duplicating Stripe objects,
and a second finalize makes zero calls. Send is a no-op once `sent_at` is
recorded — which is what keeps retry-safety from quietly becoming a re-send
feature.

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
lib/health.js    the checks, as data
lib/vendor.js    assets consumed from outside this app (registry)
lib/views.js     the template registry + the health check's render probe
routes/          health.js, assets.js, pages.js, connect.js, invoices.js
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

- **AS-45 deletes `views/scaffold.ejs`** (and its row in `lib/views.js`, and
  `public/scaffold.css`). It is the one non-budgeted page, and exists only to
  prove the chain end to end in a browser. It is not one of the seven screens.
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
- **AS-41 landed Connect onboarding server-side; two handoffs are open.**
  **AS-40 (sessions):** every connect route resolves the acting freelancer
  through ONE exported seam, `resolveFreelancerId` in `routes/connect.js`
  (marked `AS-40 OBLIGATION`); replace its body with session-derived identity
  and delete the `?freelancer` parameter from start — return/refresh keep
  working because a Stripe redirect is a top-level GET navigation carrying
  session cookies. **AS-45 (screen 2):** `GET /connect-stripe` 404s until the
  screen lands; the redirect target is one constant in
  `lib/connect/onboarding.js` plus its test assertions if AS-45 renames the
  route. Readiness discipline for every future writer (AS-44 included): write
  through `connectedAccounts.updateReadiness` only, with a snapshot freshly
  read from Stripe, mapped by `lib/connect/readiness.js` — never inferred from
  a redirect, never cached, last writer wins.
- **AS-43 landed the invoice lifecycle server-side; three handoffs are open.**
  **AS-44 (webhooks):** import `invoiceSnapshotFromStripe` from
  `lib/invoices/mapping.js` for `invoice.created/finalized/paid/voided/
  marked_uncollectible/payment_failed` — an event's `data.object` IS an invoice
  object, and the reuse is already tested (R1). Write `paid`, `void`,
  `uncollectible` and `lastPaymentFailedAt`; AS-43 writes only `draft` and
  `open`, so the two sides need no coordination — both go through
  `invoices.applyStripeSnapshot`, whose rank machine converges them. **Do not
  mount a body parser app-wide**: the webhook needs the RAW body for signature
  verification, which is why AS-43's parser is mounted per route. **`sentAt` and
  `lastPaymentFailedAt` must never be emitted by the mapper** — a Stripe invoice
  object has neither, so emitting them as null would erase a recorded fact on
  the next snapshot (each is written by its own writer, at its own moment; R23
  is that rule under test). **AS-46 (screen 4)** owns `/invoices/{id}/edit` and
  **AS-48 (screens 3 and 5)** owns `/invoices/{id}`; both paths are already
  load-bearing in shipped `Location` headers, so treat them as settled unless
  you also change AS-43's redirects. **AS-40 (sessions):** these routes import
  `resolveFreelancerId` from `routes/connect.js` rather than copying it — one
  seam, one replacement point. A **third** consumer (AS-42) is the trigger to
  extract it to `lib/http/identity.js`.
- **The dependency budget is 2.** A third turns the suite red and goes through
  all six rules in the stack decision §11 first. Install with
  `npm install --save-exact` — plain `npm install` writes a caret range, which
  the decision forbids.
