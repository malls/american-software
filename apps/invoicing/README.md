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
`/tokens.css`. Port 8348 is deliberate: 8347 is `asc-chat-server-1` and must not
be disturbed. The compose project is named `asc-invoicing`, so `docker compose
down` here cannot take the chat app with it.

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
has a test-mode prefix; the placeholder the test file uses is the **one**
key-shaped literal in the repository, and it never leaves the compose network. The `contract` and
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

## Layout

```
server.js        entrypoint: loadConfig() -> createApp() -> listen(). Only this
                 file and lib/config.js touch process.env
app.js           composition root. Takes config as an ARGUMENT, never reads the
                 environment. Route registration order is load-bearing
lib/config.js    schema-as-data; frozen settings; redacted() for secrets
lib/stripe/      the ONLY outbound HTTP in the product (AS-38):
  custody.js       the three policy tables and guardRequest() — the never-in-the-
                   flow-of-funds boundary as data, checked before the key exists
  client.js        createStripeClient(): validate -> build -> guard -> requireKey
                   -> sign -> transport -> interpret; encodeForm(); the error classes
  transport.js     fetchTransport(): the one `fetch` token in product source
lib/health.js    the checks, as data
lib/vendor.js    assets consumed from outside this app (registry)
lib/views.js     the template registry + the health check's render probe
routes/          health.js, assets.js, pages.js
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
- **AS-39 owns data.** No database is opened, `node:sqlite` is imported nowhere,
  and no money type is guessed at (that is integer minor units with an explicit
  currency column, and it is AS-39's to define).
- **The dependency budget is 2.** A third turns the suite red and goes through
  all six rules in the stack decision §11 first. Install with
  `npm install --save-exact` — plain `npm install` writes a caret range, which
  the decision forbids.
