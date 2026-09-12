# AS-58 — Invoicing: AS-38 review follow-ups (T1 tautology, stale health test name, `;` body separator, /healthz config exposure)

Complexity low; one stage (plan + implement, developer-marcus), Ruben reviews.
Four one-function changes in `apps/invoicing`, none visible to a user. Line
numbers in the task description are as of 2026-09-02; the suite is now 23 test
files (was 8), so "stays 8 files" reads "adds no test file" today.

## Scope

In: the four items below, their tests, and the app README / test-comment
wording they invalidate. Out: anything else in `lib/stripe/`, `lib/health.js`
check list, config schema, compose, Dockerfile.

## Approach, per item

1. **T1 tautology** (`test/stripe-client.test.js`, 'transport: sends method,
   headers and body byte-for-byte…'). What the line MEANT: *the client sets no
   User-Agent*. That is unobservable at T1 — the runtime's `fetch` adds
   `user-agent: node` on the wire (verified on node 24: the wire carries it
   whatever the client does), so no assertion about `seen.headers['user-agent']`
   can pin the client. The property is already pinned where it is observable:
   'client: the transport receives exactly the guarded request plus
   authorization' `deepStrictEqual`s the signed header set. Choice: delete the
   line; leave a comment at T1 naming where the property lives. Falsifier is
   the mutant that adds a `user-agent` in `buildUnsigned` — red at the client
   level, never at T1.
2. **Stale health test wording** (`test/health.test.js`). The stale text is the
   assertion message inside 'the health body carries redacted config, never raw
   config'. Replace with a test named for what it checks: *an unconfigured
   secret redacts to null and the rest of the config is unchanged* — assert the
   schema has ≥ 1 secret row (so "no secrets exist" can never be true again),
   each secret key is `null` in both `config` and `redacted()`, and the two are
   deep-equal. Falsifier: `redacted()` emitting `'[redacted]'` for an unset
   secret.
3. **`;` separator** (`lib/stripe/custody.js` `checkParams`). Choice: treat `;`
   as a pair separator alongside `&`, in the body AND the query (the query has
   the same hole: `URL.searchParams` splits only on `&`; `;` survives URL
   parsing unencoded). Not "reject a raw `;`": that inspects the whole body
   string, values included, and needs a new refusal code; the split keeps the
   guard keys-only ("values are never inspected") and lands the description's
   own example on `banned_parameter` naming `transfer_data[destination]`. It
   fails closed whichever way Stripe parses: if Stripe splits on `;` we refused
   the key; if not, the value was inert and we were merely conservative.
   `encodeForm` percent-encodes `;`, so no legitimate request changes outcome.
   Falsifier: the split reverted to `&` only.
4. **/healthz config exposure** (`routes/health.js`). Choice: **drop the config
   object**, unconditionally. Not the env gate: a gate on `env` is only as good
   as `NODE_ENV=production` being set on the public box — exactly the class of
   deploy mistake `/healthz` exists to catch, and one it would then amplify
   rather than report. A drop cannot be misconfigured, adds no branch, and
   lands before anything is reachable regardless of env. The operator's signal
   (`stripeSecretKey`/`webhookSecret` `null` vs `[redacted]`) stays on the
   startup line via `startupLogLine`/`redacted()`, on the authenticated side;
   the `config` check still reports validity with detail. Body becomes exactly
   `{ ok, checks }`. Update `README.md § Receiving webhooks` (says "/healthz
   both print"), the `config.test.js` comments that say the same, and the
   route comment. Falsifier: the `config:` line restored.

## Key files

`apps/invoicing/lib/stripe/custody.js`, `routes/health.js`,
`test/stripe-client.test.js`, `test/health.test.js`, `test/config.test.js`
(comments only), `README.md` (app's, one paragraph). No new files, no new
dependencies, no protected top-level files.

## Acceptance criteria (each with its falsifier; proof = one observed red each)

1. T1 no longer contains the tautological `user-agent` assertion; the
   client-level header pin stands. **F1:** add `'user-agent': 'asc'` to the
   headers in `buildUnsigned` → red at 'client: the transport receives exactly
   the guarded request plus authorization' (and 'client: GET params go in the
   query…' if it pins the set too — record the exact set); T1 stays green,
   which is the point.
2. `test/health.test.js` has a test named 'an unconfigured secret redacts to
   null and the rest of the config is unchanged' asserting ≥ 1 secret row,
   nulls on both sides, deep-equality; the stale message is gone. **F2:** in
   `lib/config.js` `redacted()`, emit `'[redacted]'` when the secret is `null`
   → red there; `config.test.js` rows for the null case go red too (record).
3. `guardRequest` refuses `customer=cus_1;transfer_data[destination]=acct_x`
   as a POST /v1/invoices body with `banned_parameter`, key
   `transfer_data[destination]`, and refuses `?customer=cus_1;on_behalf_of=x`
   on a GET query the same way; `customer=cus_1&description=a%3Bb` still
   passes (an encoded `;` is a value). **F3:** revert the separator set to
   `&` only → red on the new custody test(s), nothing else.
4. `GET /healthz` body keys are exactly `['ok','checks']` in the 200 and 503
   cases; no `config` key, and no setting name (`bind`, `port`, `logLevel`,
   `stripeSecretKey`) appears in the body text. **F4:** restore
   `config: config.redacted?.() ?? null` in the route → red on the new health
   test(s).
5. Suite green under `compose run --rm --build test` with the `Image … Built`
   receipt; dependency-policy, deploy-shape, harness, route-surface guards
   green; `package.json`/lock unchanged; test file count unchanged (23).
