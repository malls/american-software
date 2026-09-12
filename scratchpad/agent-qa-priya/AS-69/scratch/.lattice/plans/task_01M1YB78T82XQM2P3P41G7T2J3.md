# AS-90 — D1 demo for the board: scripted walkthrough of the v1 core loop + a viewable captured artifact

Planner: `agent:cto-owen`, tick watcher:79108 loop tick 2, 2026-09-12. Complexity: **medium** (three-stage).
Board request: DM msg 555, "I'd like to see the app in action, can you make me a demo?"

**One correction to the task description, recorded here and on the task.** The description assumes the
running `web` container can talk to stripe-mock ("the demo … driving the app's own HTTP API on
127.0.0.1:8348 … stripe-mock returns a Stripe-shaped account_link URL"). It cannot, and the reason is a
recorded design decision, not a gap: `lib/stripe/client.js` line 14 — *"`baseUrl` is an option, never
configuration: an env-settable base URL would send the secret key wherever the environment says. Only
tests pass one."* `server.js` builds the client against `https://api.stripe.com` with no override, and
`web` is deliberately not on the `stripe-mock` network (`deploy-shape.test.js` line 380 pins that). A demo
driving `web` from the host would reach `/connect-stripe/start` and get a **503 ConfigError (no key)** — and
even with a key it would call the real Stripe host, which this task forbids. The description also has no
way to *read anything back* from `web` (no `GET /invoices/:id` until AS-48). So the demo's driver runs
**inside the shipped image, on the compose network next to stripe-mock, exactly the way the `contract`
service already does**, boots the same app code in-process on loopback and drives it over real HTTP. §1.1
records the decision; the "two commands" promise survives. Everything else in the description stands.

---

## §0 Ground truth, measured this tick

### §0.1 Baseline suite counts (apps/invoicing, master at 09386e2), `--build`, scratch project `asc-inv-as90plan`

| Service | tests | pass | fail | skipped | receipt |
|---|---|---|---|---|---|
| `test` (network_mode: none) | 405 | 387 | 0 | 18 | `Image asc-inv-as90plan-test Built`, exit 0 |
| `contract` (stripe-mock live) | 405 | 405 | 0 | 0 | `Image asc-inv-as90plan-contract Built`, exit 0 |

Logs: `scratchpad/agent-cto-owen/AS-90/baseline-{test,contract}.log`. The 18 skips are the M-cases
(`ASC_STRIPE_MOCK_URL not set`). Both must be unchanged in count and outcome at review (§3 AC-9).

### §0.2 stripe-mock fixtures (read directly from `stripe/stripe-mock:v0.203.0`, loopback, no account)

- `GET /v1/accounts/{id}` → `charges_enabled: false, details_submitted: false, payouts_enabled: false,
  requirements.currently_due: [6 items], disabled_reason: "requirements.past_due"`. **The mock's
  account is NOT ready.** `GET /connect-stripe/return` maps it faithfully (connect.test.js M2), so the
  real return path against the mock leaves the freelancer `not-ready` and finalize would 403. Readiness
  must therefore be seeded by an event we synthesize (§1.3) — and that is a *true* story: a freelancer
  who has not finished Stripe's hosted KYC looks exactly like this.
- `POST /v1/invoices` → `status: "draft", amount_due: 1000, amount_paid: 0, hosted_invoice_url: null,
  invoice_pdf: null, due_date: 1234567890` — identical from create, finalize and send (invoices.test.js
  line 1072). **The demo invoice total must be exactly 1000 minor units ($10.00)** or the reconciliation
  guard (`amountDueMinor === totalMinor`) answers 409 on finalize. The transcript says so in words.

### §0.3 The chain's exact request/response shapes (from routes/ and lib/, read this tick)

All POSTs are `application/x-www-form-urlencoded`, need `Origin: <base>` (same-origin check above the
auth boundary — 403 without it), and every protected route needs the `session` cookie. Success is
always **303** with the `Location` header as the contract; failure is one-line `text/plain`
`<ErrorName>: <step>\n`.

| # | Step | Request | Success | Label |
|---|---|---|---|---|
| 1 | Sign up | `POST /signup` body `displayName, email, password[, next]` | 303 → `/` (POST_SIGNIN_LANDING), `Set-Cookie: session=…; HttpOnly; SameSite=Lax` | real app |
| 2 | Session | `GET /` with cookie | 200 `text/plain` interim landing line; without cookie 303 → `/signin` | real app |
| 3 | Connect start | `POST /connect-stripe/start` | app calls mock `POST /v1/accounts` (platform) then `POST /v1/account_links`; 303 → the mock's `account_link.url` | real app + stripe-mock stand-in |
| 4 | Connect return | `GET /connect-stripe/return` | app calls mock `GET /v1/accounts/{acct}`; writes readiness (not ready, §0.2); 303 → `/connect-stripe` (404s until AS-70 — deliberate dangle, README) | real app + stripe-mock stand-in |
| 5 | Readiness | `POST /webhooks/stripe` — signed `account.updated`, `data.object` = a ready account (`charges_enabled: true, details_submitted: true, payouts_enabled: true, requirements: { currently_due: [], disabled_reason: null }`, id = the acct from step 3, read back from the DB) | 200 `ok: applied\n`; row now `ready: true` | synthesized event |
| 6 | Client | `POST /clients` body `name, email[, next]` | 303 → landing carrying the client id | real app |
| 7 | Contract | `POST /contracts` body `clientId, templateId=independent-contractor-agreement@1, projectDescription, startDate=YYYY-MM-DD` | 303 → `/contracts/<id>` (404s until AS-47); `renderedHtml` read back from the DB and printed | real app |
| 8 | Draft | `POST /invoices` body `clientId, currency=usd, lineItems[0][description], lineItems[0][quantity]=1, lineItems[0][unitAmountMinor]=1000` (`extended: true` parser) | 303 → `/invoices/<id>/edit` (404s until AS-46); **zero Stripe calls** | real app |
| 9 | Finalize | `POST /invoices/<id>/finalize` | gate reads readiness (ready), then mock calls 1–4 (`/v1/customers`, `/v1/invoices`, `/v1/invoiceitems`, `/v1/invoices/{id}/finalize`); 303 → `/invoices/<id>`; mirror `amountDueMinor 1000`, `status draft` (mock never advances — a mock artifact) | real app + stripe-mock stand-in |
| 10 | Send | `POST /invoices/<id>/send` | mock call 5 (`/v1/invoices/{id}/send`); 303; `sentAt` written from our clock | real app + stripe-mock stand-in |
| 11 | Paid | `POST /webhooks/stripe` — signed `invoice.paid`, `data.object` shaped as `test/webhooks.test.js` `invoiceObject({ status: 'paid' })` with `id` = the mirror's `stripeInvoiceId`, `amount_due 1000, amount_paid 1000, currency usd, status_transitions.paid_at` | 200 `ok: applied\n`; mirror `status: paid`, `paidAt` set | synthesized event |
| 12 | Read back | mirror row via `repos.invoices.getById` | printed: `status paid`, `paidAt`, `sentAt`, `amountDueMinor` | real app (database read — no screen exists yet, AS-48) |

Signature scheme (lib/webhooks/signature.js): header `Stripe-Signature: t=<unix>,v1=<hex sha256 HMAC(secret, "<t>.<raw body>")>`,
secret used verbatim, tolerance 300 s past-only. The route exists only when the app's config carries
`webhookSecret` — the demo supplies one in the env object it hands `loadConfig` (§1.2). Idempotency:
`stripeEvents.recordOnce(event.id)` first — a replayed event id answers `200 ok: duplicate` (§1.4).

Custody proof available for free: every mock call above is connected-scope (`Stripe-Account` header)
except the two platform calls in step 3; nothing in the chain reaches `/v1/charges`,
`/v1/payment_intents` or `/v1/transfers` — the custody tables in `lib/stripe/custody.js` refuse those
before a key is even looked at. The transcript prints the list of Stripe paths the app asked for
(the `withMockApp` decorator pattern, invoices.test.js line 1107) so the board sees the whole set.

### §0.4 Screens that render

Exactly one: `views/signin.ejs` (AS-45, merged 95b5ee5). `GET /signin` → `S1-DEFAULT-SIGNIN`;
`GET /signin?mode=signup` → `S1-DEFAULT-SIGNUP`; a POST with blank required fields re-renders
`S1-ERROR-VALIDATION` with a 4xx (**POST-only — not GET-reachable**). Root element stamps
`data-state="<id>"`. `/` is an interim text line; `/connect-stripe`, `/invoices/*`, `/contracts/*` 404.

### §0.5 Host capture reality (probe: `scratchpad/agent-cto-owen/AS-90/probe.mjs`)

- `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` **exists**. Headless Chrome needs no
  install: `--headless=new --screenshot=<png> --window-size=<w>,<h> <url>` for GET states.
- The validation-error state is POST-only, so the plain `--screenshot` flag cannot reach it. Node 24
  (`v24.13.1` on the host) has a built-in `WebSocket`, so a **zero-dependency CDP driver** is possible:
  launch Chrome with `--remote-debugging-port=<p> --user-data-dir=<tmp>`, `Page.navigate`, then
  `Runtime.evaluate` to fill email only and submit the real form, wait for `Page.loadEventFired`,
  `Page.captureScreenshot`. No playwright/puppeteer on PATH or globally; a `~/.cache/puppeteer` and
  `~/Library/Caches/ms-playwright` exist but the plan does not depend on either (a cache is not a
  dependency anyone can rely on).
- `docker` is at `/usr/local/bin/docker` (off PATH in ticks — call by absolute path via `spawnSync`).
- **No new install is needed. No board gate.**

### §0.6 Test pins the change moves (so nobody "discovers" them mid-implementation)

- `test/deploy-shape.test.js`: `Object.keys(SERVICES)` exactly `['web','test','stripe-mock','contract']` (l.161);
  `COPIES.length === 9` (l.164); `BUILT` exactly `['web','test','contract']` (l.192);
  `Object.keys(SERVICES).length === 4` (l.336); per-service environment assertions (l.293–302).
  Each moves by exactly one with the `demo` service and its `COPY` (§2).
- `test/dependency-policy.test.js`: closed-world walker — `demo/` must be classified. It joins
  `SKIPPED_DIRS` (l.311) with a written reason (it drives its own loopback listener with `fetch`, as
  `test/` does). `source.length === 50` (l.374) then does **not** move. Comment at l.813 says the key's
  NAME appears in exactly three places — the demo names `INVOICING_STRIPE_SECRET_KEY` nowhere (§1.2).
- The `sk_test_stripemock` literal is spelled in exactly three test files by design (README § contract
  half). The demo uses **its own, differently spelled** mock-only placeholder (`sk_test_demo_placeholder`)
  so the "one grep finds all three" property is untouched; the transcript says the value is a
  placeholder the mock does not validate beyond its prefix.

---

## §1 Decisions

### §1.1 Where the demo runs — a `demo` compose service, not the host against `web`

`apps/invoicing/demo/run.mjs` ships in the image (`COPY apps/invoicing/demo ./demo`) and is the
`command` of a new `demo` service: `profiles: ["tools"]`, `depends_on: [stripe-mock]`,
`networks: [stripe-mock]` (internal, **no route to the internet**), `ASC_STRIPE_MOCK_URL=http://stripe-mock:12111`,
no ports, no volumes — the `contract` service's shape with a different command. Rationale is the
correction at the top: the app deliberately cannot be pointed at a mock by configuration, and the
demo must not be the thing that changes that. Consequence the transcript states in its preamble, in
words: *"This walkthrough boots the same application code, from the same shipped image, inside a
container that sits next to a Stripe request validator and has no route to the internet. Every request
below is a real HTTP request to the real routes; the database is a fresh file created for this run."*

The board's commands (README § Demo, added by this task):

```bash
cd apps/invoicing
DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 docker compose run --rm --build demo && docker compose down
```

One line, two commands, transcript on stdout. The screenshots use `docker compose up` + the capture
script (§1.7) and are a separate, host-side act.

Rejected: (a) an `INVOICING_STRIPE_BASE_URL` config row — reverses the AS-38 decision for a demo, and is
a lib change the description excludes; if AS-49/AS-50 ever want it, that is their ruling to ask for.
(b) `docker compose run -v ./demo:/app/demo contract node demo/run.mjs` — avoids the pin moves but runs
bits the image does not ship, against the AS-26 "the container is the subject" lesson.

### §1.2 How the demo boots the app (self-contained, ~20 lines, no import from `test/`)

`loadConfig(envObject)` with an explicit object — never `process.env` — carrying `INVOICING_BIND=127.0.0.1`,
`INVOICING_PORT=0`-equivalent (listen on `0`, read the port back), `INVOICING_DB_PATH=/tmp/asc-demo-<pid>.sqlite`
(fresh every run: idempotency for free), `INVOICING_STRIPE_WEBHOOK_SECRET=whsec_demo_placeholder`
(needed so the receiver route exists), and **no** `INVOICING_STRIPE_SECRET_KEY` — the Stripe client is
built directly with `createStripeClient({ apiKey: 'sk_test_demo_placeholder', baseUrl: ASC_STRIPE_MOCK_URL })`,
wrapped in the recording decorator from invoices.test.js l.1107 so the transcript can print the Stripe
paths requested. Then `prepareDatabase → createRepositories → createApp → listen`. Refuse at load if
`ASC_STRIPE_MOCK_URL` is unset or its hostname ends in `stripe.com` (the three M-suites' refusal,
copied). The demo does **not** import `test/helpers/*`: the helpers are the suite's, and AS-49 lifting
the sequence should not have to untangle a demo↔test coupling.

### §1.3 The script shape and the labels

`demo/run.mjs` is one file with three regions, each under a banner comment so AS-49's planner can lift
the middle one verbatim: **BOOT** (§1.2), **SEQUENCE** (the twelve steps of §0.3 as an array of
`{ title, label, why, request() }`), **PRINT** (the transcript writer). The SEQUENCE region contains no
assertion and no verdict: the only checks are *preconditions of the next step* — expected status and,
where a later step uses it, the `Location` — and a failed precondition prints
`STOPPED at step N: expected 303, got 500 (<body>)` and exits **1**. That is control flow, not a test;
it exists because a walkthrough that prints a 500 and exits 0 would be a lie. Exit 0 means the chain
completed. Nothing else is checked, by design; the moment a check wants to be about *correctness* it
belongs in AS-49.

Every step prints, in this order: `[N/12] <title>`, the label on its own line, one-to-three plain
sentences of *why* (what a freelancer would be doing here), the request line (method, path, form
fields with the password shown as `••••••••`), the response line (status, `Location`, `Set-Cookie`
name only), and where relevant the Stripe paths the app asked the mock for. Labels are exactly the
description's three, printed as fixed strings:

- `REAL APP BEHAVIOUR` — the app's own code did this; it would do the same against real Stripe.
- `STRIPE-MOCK STAND-IN` — Stripe's request validator answered with a fixture; real Stripe would answer
  with real data (and the step says what would differ: the account_link URL is fake, the account is
  not ready, `amount_due` is a constant 1000, status never advances).
- `SYNTHESIZED EVENT` — we built and signed this event ourselves; it proves our receiver and state
  machine, not Stripe's delivery.

A database read-back (steps 7 and 12) is labelled `REAL APP BEHAVIOUR` with the sentence *"read from
the app's database because the screen that would show it is not built yet (AS-48 / AS-47)"*.

The transcript **preamble** prints the CAN/CANNOT list verbatim (§1.6) and the §1.1 paragraph; the
**epilogue** prints the full ordered list of Stripe paths requested during the run and the sentence
*"None of these creates a charge, a payment intent, or a transfer; the platform key never touches money."*

### §1.4 Idempotency and determinism

Fixed values throughout: freelancer `Dana Reyes <dana@demo.example>`, client `Northwind Studio
<billing@northwind.example>`, contract `projectDescription` two fixed sentences, `startDate 2026-10-01`,
one line item `Website redesign — milestone 1`, qty 1, `unitAmountMinor 1000` (**$10.00 — forced by
§0.2, said in the transcript**), currency `usd`, event ids `evt_demo_account_ready` and
`evt_demo_invoice_paid`, event `created` = now. A fresh DB per run (§1.2) makes "fresh volume"
automatic. Two runs differ only in ULID-shaped ids, `acct_`/`cus_`/`in_` ids from the mock, ISO
timestamps, epoch seconds, HMAC digests and the port. Normaliser the reviewer uses (AC-6):

```
sed -E 's/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z/<ts>/g; s/\b(t=)[0-9]+/\1<t>/g; s/v1=[0-9a-f]{64}/v1=<sig>/g; s/\b[0-9A-HJKMNP-TV-Z]{26}\b/<ulid>/g; s/\b(acct|cus|in|ii)_[A-Za-z0-9]+/\1_<id>/g; s/127\.0\.0\.1:[0-9]+/127.0.0.1:<port>/g'
```

Bonus idempotency step, cheap and honest: after step 11 the demo re-posts the *same* `invoice.paid`
event and prints `200 ok: duplicate` under `REAL APP BEHAVIOUR` — "Stripe retries; we apply once".
Counts as step 11b, not a thirteenth step.

### §1.5 What AS-49 lifts

The SEQUENCE array (titles, labels dropped, `request()` bodies) is the request sequence AS-49's
planner copies into a stateful-double test. The demo's `run.mjs` header says so and names AS-49; the
AS-49 plan should cite this file's commit. No shared module — copying twelve request builders is
cheaper than a coupling between a demo and a test.

### §1.6 The artifact page and the verbatim CAN/CANNOT block

`docs/demo/d1/` is the durable, committed capture: `transcript.txt` (one real run, exactly the stdout),
`screen-1-signin-375.png`, `screen-1-signin-1280.png`, `screen-1-signup-375.png`,
`screen-1-signup-1280.png`, `screen-1-error-validation-375.png`, and `capture.json` (the AS-45 merge
commit `95b5ee5`, the branch commit the run was taken at, the Chrome version string, the date). The
artifact is a *projection* of that directory, never the record.

`.claude/skills/d1-demo-artifact/` follows the two precedents exactly: `SKILL.md` (steps, the
same-URL rule, the "never hand-edit" rule), `build.mjs` (`node build.mjs <repo-root> <out.html>`;
zero-dependency; inlines `docs/design/tokens/tokens.css` plus a small page stylesheet using only
`var(--token)` references; embeds each PNG as a `data:image/png;base64` `<img>` — open question Q1;
throws if the transcript lacks the CAN/CANNOT block, if any of the five PNGs is missing, or if the
transcript does not end with the epilogue sentence), `capture.mjs` (§1.7), and `artifact-url.txt`
(created at first publish). Page order: title; **the CAN/CANNOT block verbatim, first thing under the
title**; "how this was made" (the one-line command, the capture date, the commits); the five
screenshots with captions naming `data-state`, width and mode; the transcript with each label
rendered as a chip (three token-coloured chips, one per label, legend above the transcript).

The block, verbatim in `demo/run.mjs` (single source — `build.mjs` copies it out of `transcript.txt`
and refuses to build if it is absent or altered; AC-3 greps it):

```
WHAT THIS DEMO CAN SHOW
- The whole server-side core loop working end to end on this codebase: sign up, session,
  Connect onboarding start, readiness, client, contract, invoice draft -> finalize -> send -> paid.
- One real screen (sign in / sign up) in a real browser.
- The contract document the app generates.
- The custody guard: the platform key never charges anyone. Every Stripe request the app made
  is listed at the end, and none of them moves money.
WHAT THIS DEMO CANNOT SHOW
- Screens 2-7. They are not built.
- A real Stripe onboarding round trip, a real hosted invoice page, a real payment, or a real
  webhook delivery. There is no Stripe test-mode account (AS-51 is on the board's desk); every
  Stripe call here goes to Stripe's own request validator (stripe-mock), which checks shapes and
  answers with fixtures.
- Email of any kind. There is no email provider, by design.
- The "paid" state at the end is produced by an event WE signed. It proves our receiver and our
  state machine, not Stripe's delivery.
```

Publishing: the `Artifact` tool with a fixed title (`D1 demo — core loop walkthrough`), first publish
creates the URL → `artifact-url.txt` in the same commit. Both precedents were first published from a
**live** session (skills committed as metawork by the board's orchestrator). Whether the tool is
reachable from a headless-tick sub-agent is open question Q2 with a default that does not stall.

### §1.7 Screenshot capture path

`.claude/skills/d1-demo-artifact/capture.mjs` (host-only; never enters the image or the lockfile; zero
dependencies). Inputs: base URL (default `http://127.0.0.1:8348`), output dir (default
`docs/demo/d1/`), Chrome path (default the §0.5 binary; `--chrome <path>` override). It:

1. Checks `GET <base>/healthz` is 200 (the `web` service is up), else exits 2 with the `compose up` line.
2. Launches Chrome `--headless=new --remote-debugging-port=0 --user-data-dir=<mkdtemp> --no-first-run
   --hide-scrollbars`, reads the DevTools ws URL from `/json/version`, opens one target, and over CDP
   (node's built-in `WebSocket`): `Emulation.setDeviceMetricsOverride` to 375×812 / 1280×800,
   `Page.navigate` to `/signin` and `/signin?mode=signup`, wait `Page.loadEventFired`,
   `Page.captureScreenshot` (full page). For the error state: navigate `/signin`, `Runtime.evaluate` to
   set `email` to `dana@demo.example`, leave `password` blank, submit the real form; wait for load;
   confirm via `Runtime.evaluate` that `document.documentElement.dataset.state === 'S1-ERROR-VALIDATION'`
   (a precondition of the capture being what its filename says, not a test); capture at 375.
3. Before writing each PNG, asserts the page's `data-state` equals the expected id and the response
   URL's origin is the base — a screenshot of a redirect or a 404 is refused, not saved.
4. Writes `capture.json` (§1.6). Kills Chrome, removes the temp profile.

Fallback if CDP proves awkward inside the implementation time-box (Q3): four GET states via plain
`--screenshot`; the error state via `fetch` of the POST response HTML, rewritten so its two stylesheet
`href`s are absolute `http://127.0.0.1:8348/...`, saved to a temp file and screenshotted from `file://`.
Either path is acceptable; the artifact's `capture.json` names which was used.

### §1.8 README

`apps/invoicing/README.md` gains a short `## Demo` section (the one-line command; what it prints; the
three labels; the pointer to `docs/demo/d1/` and the skill). `.claude/skills/d1-demo-artifact/SKILL.md`
is the capture/publish procedure. No other doc moves.

---

## §2 Files

**Add**
- `apps/invoicing/demo/run.mjs` — the walkthrough (§1.2–§1.5). Ships in the image.
- `apps/invoicing/demo/README.md` — five lines: what it is, what it is not (AS-49), how to run.
- `docs/demo/d1/transcript.txt`, five `.png`, `capture.json` — the committed capture (§1.6).
- `.claude/skills/d1-demo-artifact/SKILL.md`, `build.mjs`, `capture.mjs`, `artifact-url.txt` (§1.6–§1.7).

**Change**
- `apps/invoicing/compose.yaml` — the `demo` service (§1.1). Keep to the parser's subset (2-space, no
  anchors). Comment block states why it is not `web`.
- `apps/invoicing/Dockerfile` — one line, `COPY apps/invoicing/demo ./demo`, after the `test` COPY with a
  comment: "ships so the demo runs the exact bits the image ships (the AS-26 lesson), not for the runtime".
- `apps/invoicing/test/deploy-shape.test.js` — the literals in §0.6 each +1; a new `deploy-shape: the demo
  service` case asserting `profiles ['tools']`, `depends_on ['stripe-mock']`, `networks ['stripe-mock']`,
  `environment ['ASC_STRIPE_MOCK_URL=http://stripe-mock:12111']`, `command ['node','demo/run.mjs']`, no
  `ports`, no `volumes`, `build` deep-equal to `test`'s; and `web` still has no `networks`/`depends_on`.
- `apps/invoicing/test/dependency-policy.test.js` — `demo` into `SKIPPED_DIRS` with a reason; **plus one
  guard so a skipped directory cannot become an import path for app code**: assert no scanned source file
  contains `demo/` in an import specifier (cardinality: the scanned set is the existing `SCANNED`, 50+ files).
- `apps/invoicing/README.md` — `## Demo` (§1.8); the three-commands block mentions the demo.

**Untouched, and asserted so**: `lib/`, `routes/`, `views/`, `public/`, `app.js`, `server.js`,
`package.json`, `package-lock.json` (`LOCK_ENTRIES`, `DIRECT_DEPENDENCIES` do not move).

---

## §3 Acceptance criteria (each names its falsifier — M4)

1. **Fresh-clone run.** From a clean checkout of the branch, `docker compose run --rm --build demo`
   prints the full twelve-step transcript (plus 11b) and exits 0; the output shows the `Image … Built`
   line. *Falsifier:* set `unitAmountMinor` to 1500 in the SEQUENCE → the run prints `STOPPED at step 9:
   expected 303, got 409 (AmountMismatchError: reconcile)` and exits 1. (Also the demonstration that the
   "no verdict" rule still stops on a broken chain.)
2. **Every step labelled, from the closed set.** *Falsifier:* `grep -cE '^(REAL APP BEHAVIOUR|STRIPE-MOCK STAND-IN|SYNTHESIZED EVENT)$' transcript.txt` = 13 (12 steps + 11b) and `grep -c '^\[' transcript.txt` = 13; delete one label line → the counts disagree and `build.mjs` throws (`step without label`).
3. **CAN/CANNOT block verbatim at the top of the artifact** (description VERIFICATION (d)). *Falsifier:* the reviewer greps the built HTML for each of the block's 12 bullet lines (after HTML-entity decoding) and finds each exactly once, before the first screenshot; change one word in `run.mjs` and `build.mjs` refuses to build (block digest mismatch — `build.mjs` carries a committed SHA-256 of the block).
4. **The block is true.** *Falsifier (reviewer's own):* every CANNOT bullet is checked against the tree — `ls apps/invoicing/views` shows one template; `git grep -l sk_live_` is empty; `apps/invoicing/.env.local` is absent; the transcript's paid state follows a `SYNTHESIZED EVENT` line, not a mock response.
5. **Screenshots are of the merged screen 1, at the stated widths and states.** `capture.json` names `95b5ee5`, and each PNG was written only after `data-state` matched (§1.7 step 3). *Falsifier:* run `capture.mjs` against a base that 404s `/signin` (e.g. port 8349) → exits non-zero, writes no PNG. Second: point it at `/` → refused (`data-state` absent).
6. **Idempotent transcript.** Two consecutive `demo` runs, both normalised with the §1.4 sed, are byte-identical. *Falsifier:* the reviewer diffs the *un*-normalised pair and confirms the differences are only ids/timestamps/digests/port — a difference of any other kind is a finding.
7. **Read-back is real.** Step 12's `status paid` is the mirror row after step 11. *Falsifier:* comment out step 11's request in a scratch copy → step 12 prints `status draft` (the mock never advances state) and the run still exits 0 — which is exactly why AC-1's exit code is not a verdict and why this criterion is checked by the reviewer's eye, not the script.
8. **Custody.** The epilogue's Stripe path list contains no `/v1/charges`, `/v1/payment_intents`, `/v1/transfers`, `/v1/payouts` and every path is one of the `ALLOWED_ENDPOINTS` rows. *Falsifier:* in a scratch copy add `{ method: 'POST', path: '/v1/charges', platform: true }` to the SEQUENCE → `StripeCustodyError` before any transport call; the demo prints it and exits 1.
9. **Suites unchanged** (description VERIFICATION (b)). Counted `--build` runs: `test` 405/387/0/18 and `contract` 405/405/0/0 on master; on the branch **406/388/0/18** and **406/406/0/0** (+1 = the deploy-shape demo-service case) plus the `demo/`-import guard folded into the existing closed-world case (no count change). *Falsifier:* delete the `COPY apps/invoicing/demo` line → `deploy-shape` red (`COPIES.length`); add `import '../demo/run.mjs'` to `lib/health.js` in a scratch copy → the new import guard red.
10. **Zero new dependencies.** `package.json` and `package-lock.json` byte-identical to master (`git diff master --stat -- apps/invoicing/package*.json` empty). *Falsifier:* trivially observable; the dependency-policy `LOCK_ENTRIES` literal would also turn red.
11. **The artifact page opens at its URL and matches an independently generated transcript** (VERIFICATION (c)). *Falsifier:* the reviewer runs the demo herself, normalises both, diffs. If the publish could not happen in-tick (Q2), the criterion is met against the built HTML at the committed path and the review says the URL half is pending a live session — it is not a pass on the URL.
12. **Nothing opened.** No new account, key, host, or spend; the demo container has no internet route. *Falsifier:* inside the demo container, `fetch('https://api.stripe.com')` (scratch, not committed) fails with a network error — the internal network has no gateway.
13. **Screen-1 test suite untouched** — `test/screens.test.js` byte-identical to master; the capture's error state is reached by the real form, not a hand-built URL.

---

## §4 Proof recipe for the implementer

Order, each with the receipt recorded in the implementation comment:
1. Baseline on master (already measured, §0.1 — cite the log paths, do not re-run).
2. Branch: `docker compose -p asc-inv-as90 run --rm --build test` and `… contract` → the §5 numbers, with
   the `Built` line. **Use `-p asc-inv-as90` from the worktree**, never the default project name — the
   main checkout's `web` must not be touched; `down` the scratch project after (AS-106 lesson: a network
   per `-p` project is left behind otherwise).
3. The demo, twice (AC-1, AC-6); keep both raw transcripts in `scratchpad/agent-developer-lena/AS-90/`.
4. Reds, each as one indivisible mutate/assert-applied/observe/restore/rebuild step under an `EXIT` trap,
   in a **scratch copy** where possible: AC-1's 1500 mutant; AC-2's deleted label; AC-3's one-word change;
   AC-8's `/v1/charges`; AC-9's two reds. Record the exact failing set for each.
5. Capture: the host port map (`127.0.0.1:8348`) is fixed in `compose.yaml`, so only one `web` can run at a
   time regardless of `-p`. The implementer confirms nothing is listening on 8348 (`lsof -i :8348` empty —
   the main checkout's `web` is not normally running), runs `docker compose -p asc-inv-as90 up --build web`
   from the worktree, captures, then `down`s that project.
6. Build the page, publish (Q2), commit `docs/demo/d1/` and `artifact-url.txt`.

Commit early on the branch and keep a progress note in the scratchpad (headless-tick cutoff rule).

## §5 Predicted counts

- `test` on branch: **406 tests, 388 pass, 0 fail, 18 skipped**, `Built`, exit 0.
- `contract` on branch: **406 / 406 / 0 / 0**, `Built`, exit 0.
- Demo: 13 labelled steps, exit 0, ~2–4 s after boot; Stripe requests made: **8 calls on 8 distinct
  paths** — `POST /v1/accounts`, `POST /v1/account_links`, `GET /v1/accounts/{acct}`, `POST /v1/customers`,
  `POST /v1/invoices`, `POST /v1/invoiceitems` (one line item, so once), `POST /v1/invoices/{id}/finalize`,
  `POST /v1/invoices/{id}/send`. Count them in the epilogue; a ninth is a finding.
- Reds: AC-1 exit 1 at step 9; AC-2 `build.mjs` throw; AC-3 throw; AC-8 exit 1 at the added step with
  `StripeCustodyError`; AC-9 `deploy-shape` 1 failing case, dependency-policy 1 failing case.
- Screenshots: 5 PNG, each under 300 KB (Chrome full-page at 375 and 1280 of a one-form page).

## §6 Reviewer probes beyond the list (M6)

- Run the demo **with `ASC_STRIPE_MOCK_URL` unset** → must refuse at load with a one-line message, not
  reach `api.stripe.com` (the M-suite refusal, copied — confirm it was actually copied).
- Replay the `account.updated` event (step 5) a second time → `ok: duplicate`; deliver it with `t` 400 s
  in the past → 400 `stale`. Both prove the transcript's webhook is going through the real verifier.
- Tamper one byte of the signed body after signing → 400. If the demo signs a re-serialised body rather
  than the exact bytes it sends, this is where it shows.
- Read the transcript as the board: is there any line where the reader cannot tell which of the three
  labels applies? Any sentence that claims more than the label allows ("Stripe confirmed", "email sent")?
- `docs/demo/d1/transcript.txt` vs. your own run: does the committed one have a step the code no longer
  prints (stale capture)?
- Open the built HTML with images blocked / in a data-URI-hostile viewer (Q1): does the page still make
  sense (alt text names the state and width)?
- `git diff master --stat`: anything under `lib/`, `routes/`, `views/`, `public/`, `package*.json`?
- Does `demo/run.mjs` import from `test/`? (It must not — §1.2.) Does anything under `lib/` or `routes/`
  import from `demo/`? (The new guard; break it in a scratch copy and see red.)
- The `demo` container: `docker compose run --rm demo node -e "fetch('https://example.com').then(()=>process.exit(0),()=>process.exit(3))"`
  → exit 3 (no route). AC-12's receipt, taken by the reviewer, not the implementer.
- Chrome capture: is `capture.json`'s commit the branch HEAD at capture time, and is `95b5ee5` an
  ancestor of it (`git merge-base --is-ancestor`)?

## §7 Staffing

**Implementer: `agent:developer-lena`.** The hard half of this task is server-side: the exact
twelve-step request sequence, the signed events (`account.updated`, `invoice.paid`) that must pass the
AS-44 verifier byte-for-byte, the readiness seeding path, the reconciliation-guard constraint from
stripe-mock, the in-image compose service and its five test-pin moves. Lena wrote AS-43 (invoice
lifecycle) and AS-44 (webhook receiver) — the sequence and the signing scheme are hers. The screen-1
half is a browser pointed at `GET /signin`; it needs no knowledge of the template's internals, which is
the only thing Marcus's four AS-45 cycles would buy. Marcus stays free for the next ready task.

**Reviewer: `agent:qa-priya`.** Ruben has reviewed Lena's last block (AS-124, two cycles) and is warm on
her recent work; Priya reviewed Marcus's (AS-126, AS-125, AS-45) and is cold on Lena's. A bonus, not the
reason: Priya did the dated by-hand join of screen 1's states to the design ledger (README § view layer,
2026-09-03), so the five screenshots have the one reviewer who can say from memory whether
`S1-ERROR-VALIDATION` at 375 px looks like the ledger row. Per M3 each gets their own scratchpad
(`scratchpad/agent-developer-lena/AS-90/`, `scratchpad/agent-qa-priya/AS-90/`); the review tasking
message must not carry the transcript, the counts, or the Stripe path list (the AS-36 rule).

## §8 Branch and seams

Branch `feat/AS-90-d1-demo` from master 09386e2; worktree `.worktrees/AS-90`. In flight: AS-124
(`feat/AS-124-tail-prefix-confirm`, apps/chat) and AS-126 (`feat/AS-126-favicon-filter-door`,
apps/chat) — **no file overlap** with anything in §2; the only shared path is `README.md`-adjacent
docs, and neither touches `apps/invoicing`, `docs/demo`, or `.claude/skills`. Merge seam risk: none
foreseen; `git merge-tree` at review confirms.

## §9 Open questions, time-boxed

| # | Question | Box | Default if the box expires |
|---|---|---|---|
| Q1 | Does the Artifact CSP allow `data:` image URIs? | Implementer checks at first publish (5 min) | Ship data URIs; if blocked, the `<img src>` becomes the GitHub raw URL of the committed PNG and the page says so; the PNGs are committed either way |
| Q2 | Is the `Artifact` tool callable from a headless-tick sub-agent? Both precedents were published live. | Implementer tries once at publish time | Commit the built page at `docs/demo/d1/index.html`; the tick report and the chat reply to the board say "the page is built and committed; publishing to the shared artifact needs one live-session run of `.claude/skills/d1-demo-artifact/SKILL.md`" — no spend, no account, a two-minute act the board's orchestrator already did twice. AC-11 records the URL half as pending, not passed |
| Q3 | CDP over node's built-in WebSocket for the error-state capture — works within 1 hour of implementer time? | 1 h | The §1.7 fallback (plain `--screenshot` for GET states; the POST HTML saved with absolute stylesheet hrefs and screenshotted from `file://`); `capture.json` names the path taken |
| Q4 | Should the demo also print the contract's rendered HTML in full, or only its text? | Planner's call now | Full `renderedHtml`, printed once, fenced between `----- contract document -----` lines; it is the one artifact the board asked to *see* ("the contract document the app generates") |
| Q5 | Re-capture cadence when screens 2–7 merge | Not this task | Each screen task re-runs the skill at its merge and appends its screenshots; the demo's SEQUENCE does not change until AS-49 |

Tangent parked, not in scope: an `INVOICING_STRIPE_BASE_URL` row would let `web` itself be demoed
against the mock. It reverses an AS-38 decision for a convenience; if AS-49 or AS-50 want it, they ask
in their own plan with the security argument answered.
