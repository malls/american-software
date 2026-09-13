# Observability posture — error tracking and product analytics

**Task:** AS-76 · **Author:** Owen Kessler, CTO (`agent:cto-owen`) · **Date:** 2026-09-13
**Status:** decided. Downstream: AS-77, AS-78, AS-79 — none of which starts before this merges.
**Board request this answers:** human:forrest, DM conversation 7, msg 521, 2026-09-03 —
*"we need issues to set up posthog and sentry low priority but observability needs to be on the radar"*.

> **Filename note.** This file is at the path AS-76 and its three dependants name, and
> that path collides numerically with `04-glossary.md`. The collision is real and is
> carried as open question Q6 (§8) rather than fixed here: renaming the file would
> break an acceptance criterion three tasks are written against, and a numbering tidy
> is not worth a silent divergence between a plan and its artifact.

---

## 0. Terms, fixed before they are used

Four words in this area get used for four different things. This document means:

**Error tracking** — a record, off this machine, that a specific failure happened:
what kind, where in the code, how often, since which build. It answers *"is something
broken that nobody has told us about?"* It is not logging (logs are local and pulled;
error tracking is remote and pushed) and it is not alerting (which is a projection
built on top).

**Product analytics** — counted user actions, aggregated across users, used to answer
*"where does the core loop lose people?"* It is about behaviour in aggregate, never
about one user's data.

**Egress** — a byte leaving this process for a host we do not control. The company
already has exactly one sanctioned egress path in the product (`lib/stripe/transport.js`)
and the dependency policy's chokepoint corollary exists to keep the count of such
paths countable.

**Transitive footprint** — distinct `name@version` in the resolved dependency closure,
not direct dependencies. Stack decision §11 rule 4.

A fifth term, used deliberately and narrowly: **the allow-list** is the closed set of
fields that may cross the wire. It is a *positive* list. Everything not on it is denied
by construction, not by a rule someone remembers.

---

## 1. What this document decides, and what it does not

**Decides.** Which of the two apps gets which instrument (§2); whether we take the
vendors' SDKs or their documented HTTP ingest APIs (§3); exactly what data may leave
the machine and the tests that make that binding (§4); self-hosted versus cloud (§5);
and the wording of the board ask (§6).

**Does not decide, on purpose.** Alerting and notification routing — who gets told,
through what channel, at what threshold — is a projection over whatever lands, and it
belongs with the foreman-view work, not here. Log aggregation is out of scope; the two
apps' logs stay local and stay pull-only. Uptime/synthetic monitoring is out of scope
and is a different instrument from both of the above.

**Creates nothing.** No account, no key, no DSN, no request to any vendor was made in
producing this document. The board gate on external signups (`CLAUDE.md` § Product) is
not a formality to be worked around by "just the free tier"; §6 is the ask, and nothing
in AS-77/78/79 begins before the board answers it.

**The time-box landed on its default.** AS-76's stated default answer, if the box
expired, was: raw ingest via a fetch-based egress module, cloud free tier, deny-list
enforced by a schema test, ask filed for both vendors at once. That is also the
measured answer. This is worth saying rather than hiding, because a default that
survives contact with evidence is only interesting if you can say what would have
overturned it — §3.5 and §5.3 say exactly that, for each half.

---

## 2. (a) What is instrumented, on which surface, and why the two apps differ

### 2.1 The asymmetry, stated first

Error tracking is worth what it costs only when a failure would otherwise go unseen.
That is a property of *who is watching the surface*, not of how important the code is.

| | `apps/invoicing` | `apps/chat` (+ the watcher) |
|---|---|---|
| Who uses it | freelancers we have never met | 11 identities: 10 active employees and the board member |
| Where it runs | a Digital Ocean host nobody is looking at | Docker on the board member's own Mac |
| Who reports a bug | nobody — they leave | the board member, in the app, within minutes |
| Is there already a fault signal? | no | yes: the watcher log, `deploy-state.json`, and the company event stream |
| Product analytics meaningful? | yes, once there are users | **no**, and not later either |

The second column's last two rows are the whole argument. A freelancer who hits a 500
on the invoice form does not file a ticket; they close the tab, and we learn nothing,
ever. That asymmetry — an error we cannot see is one we cannot fix — is what error
tracking buys, and it only exists on the product surface.

### 2.2 `apps/invoicing` — both instruments, server-side only

**Error tracking: yes.** Every unhandled exception, every rejected promise, and every
route handler that returns a 5xx. This is the one place in the company where a failure
is invisible by default.

**Product analytics: yes, once there are users.** Server-side only, on a fixed event
set covering the core loop (sign-up → connect → first invoice → first contract → issue
→ paid). The value is the funnel, and the funnel's drop-offs are the only thing D1's
product direction can be corrected by.

**Browser-side: no, in v1.** The stack decision bought a product with no bundler, no
client framework, and hand-written progressive-enhancement JavaScript. A browser SDK
from either vendor would be the app's first client-side dependency, its first build
step, and a third-party script running on a page that renders contract text. The
benefit — client-side exceptions and page-view analytics — does not pay for that.
Reopened by open question Q3 (§8), not before.

**Ordering (the recommendation AS-76 already carries, restated so AS-77/78 inherit
it):** error tracking lands **before** the first non-employee touches the product;
analytics lands **after** there are users to count. Instrumenting a funnel with zero
traffic measures nothing and still ships a deny-list to maintain.

### 2.3 `apps/chat` and the watcher — the fault signal already exists; it has no projection

**Product analytics: no. Not deferred — declined.** Every user of the chat app is an
agent whose full transcript we already hold, or the board member, who can be asked. A
funnel over eleven identities is not a measurement; it is noise with a vendor attached.
If someone later wants to know how employees use the app, reading the event stream
answers it exactly, for free, and without a third party.

**Error tracking: recommend NOT Sentry — route watcher and server faults into the
company event stream instead.** This is the one place this document diverges from the
shape the board's request implied, so the reasoning is spelled out.

The failures that motivated putting error tracking on this surface are real and are on
the record (`docs/engineering/05-operating-record.md`):

- **AS-21.** For most of a day every watcher-fired tick silently degraded to a no-op,
  because project-scope permissions do not reach a `claude -p` child. The company did
  not move, and nothing said so.
- **2026-09-11.** Two background sub-agent lanes were terminated at 605 s with nothing
  filed and no Lattice comment; the watcher closed both stages as `unclosed`.
- **Tick watcher:57637.** Three lanes finished their stages and the tick hit its
  timeout before a single board transition was written.

Every one of those was detected by a human noticing an *absence* of output, late. But
note what they have in common: none of them was an uncaught exception. They were
silent *non-events* — work that did not happen. **Error tracking does not detect a
non-event.** Sentry would have reported nothing in all three cases, because nothing
threw. What detects a non-event is a projection that knows what should have happened
and says when it did not, and the substrate for that already exists and already has
the right shape:

```
events emit stage_ended  --outcome error --reason "…"
events emit tick_ended   [--code <n>] [--signal <sig>] [--reason "…"]
events emit subagent_exited --exit error
```

`apps/chat/bin/events.js`, stream at `apps/chat/data/events/company.jsonl`, read back
at `/api/events` (AS-100). The adopted doctrine is *one event stream, many
projections*. A watcher fault is an event. It belongs in the stream, alongside the
stage it killed, where the foreman view can render it next to the work it stopped —
not in a separate vendor silo that knows nothing about tasks, stages, or lanes.

What is genuinely missing, and what AS-79 should therefore become:

1. `process.on('uncaughtException')` and `process.on('unhandledRejection')` in the
   watcher and in the chat server, each emitting a fault event **before** exiting, so a
   crash is a record rather than an absence.
2. A projection that flags the absences: a tick that started and never ended, a stage
   left `unclosed`, a deploy that has been stale past its heartbeat.
3. Surfacing (1) and (2) where the board already looks.

All three are zero-dependency, zero-egress, zero-signup, and inside the internal-tools
lane that proceeds without a per-task green-light. Sentry on this surface would cost a
vendor account and the app's **first dependency and first outbound HTTP call ever** —
`apps/chat` today has an empty `dependencies` block and `server.js` opens no outbound
connection — and would still not have caught any of the three incidents above. Both halves of that
sentence are measured, not assumed: `apps/chat/package.json` has no `dependencies` key
at all, and `server.js` contains **zero** occurrences of any outbound-client construct
from the product's own forbidden list (`fetch`, `http(s).request`, `node:net`,
`node:tls`, `node:https`) — its one `node:http` import is `createServer`.

**The residual, stated honestly.** One failure mode the event stream cannot cover: the
chat server or the host itself dies, taking the projection with it. A remote error
tracker survives that. Today the cost of that residual is bounded to minutes, because
the board member is on the same machine and notices. **Reopening trigger, written
down so it is not forgotten:** if `apps/chat` or the watcher moves off the board
member's machine onto a Digital Ocean host, this paragraph is void and chat inherits
the §2.2 argument in full. The ask in §6 gives the board a one-line override if he
would rather have it now anyway.

---

## 3. (b) SDK versus raw ingest — measured, then decided

### 3.1 Measurement (stack decision §11 rule 4)

Both SDKs' dependency closures were resolved offline and counted.

| | distinct `name@version` (closure, incl. root) | packed bytes |
|---|---|---|
| `@sentry/node@10.68.0` | **32** (floor — see caveat) | 6,580,202 (6.28 MB) |
| `posthog-node@5.51.1` | **3** | 572,559 (0.55 MB) |
| union | **35**, zero overlap between the two | 7.15 MB |

Against the app as it stands today — **2 direct · 67 distinct · 69 instances · 4.0 MB
on disk**, the figure recorded in stack decision §13 amendment 8, and independently
re-derived here from `apps/invoicing/package-lock.json` — **69 instances, 67 distinct
`name@version`, 66 distinct names, 63 MIT / 4 ISC / 1 Apache-2.0 / 1 BSD-3-Clause at
instance level**, which matches amendment 8 in every figure it records. That match is
the check that the method below is sound, and it is not a free one: collapsing the
lockfile by package name gives 66, not 67, because `content-type` is present at both
1.0.5 and 2.1.0. The three cardinalities are kept apart for exactly that reason.

- Of the 35 SDK-tree packages, exactly **2** (`debug@4.4.3`, `ms@2.1.3`) are already in
  the app's tree at **identical** versions; there are **zero** version clashes.
- Adopting both SDKs therefore takes the product from **67 → 100** distinct packages:
  **+33, or +49%**, against a documented direct-dependency budget of **2**.

**Licences (rule 2): both trees pass.** Sentry's closure is 16 MIT · 12 Apache-2.0 ·
2 BSD-3-Clause · 1 BSD-2-Clause · 1 ISC; PostHog's is 3 MIT. **Zero non-permissive,
zero unstated.** Rule 2 is not what decides this. Neither is rule 6 in isolation.
**No package in either tree declares an install, preinstall, or postinstall script.**
Saying so matters: it removes a hazard people assume and lets the decision rest on the
one that is actually there.

**Caveat on the count, stated because this company does not quote unmeasured numbers.**
This session had no network, so rule 4's literal command (`npm ls --all --parseable |
wc -l` before and after a real install) could not be run. Method used instead: the
local npm cache (`~/.npm/_cacache`) already held both tarball trees; each tarball's
`package/package.json` was extracted and the `dependencies` closure walked, resolving
each name to the highest cached version. Script and full output:
`scratchpad/agent-cto-owen/AS-76/footprint.js`, `footprint.txt`. Three limits:
(i) one dependency, `@types/estree` (required by `@apm-js-collab/code-transformer`),
was not in the cache, so the true Sentry count is **≥33**; (ii) `optionalDependencies`
and `peerDependencies` were not walked, and `@sentry/node-core` peer-depends on five
OpenTelemetry packages including `@opentelemetry/exporter-trace-otlp-http`, not in the
closure above; (iii) npm's real resolution may hoist or duplicate differently. **Every
one of these errs low.** The number is a floor, and the decision is argued below in a
way that does not turn on it — see §3.5.

### 3.2 What is actually inside the Sentry tree

`@sentry/node`'s own package description is: *"Sentry Node SDK using OpenTelemetry for
performance instrumentation"*. Its direct dependencies include `import-in-the-middle`
(*"Intercept imports in Node.js"*) and, via `@opentelemetry/instrumentation`, also
`require-in-the-middle` (*"Module to hook into the Node.js require function"*). Under
those sits `@apm-js-collab/code-transformer@0.18.1`, whose own dependencies are
`meriyah` (a JavaScript parser), `astring` (an AST-to-source generator), `esquery`,
`semifies` and `source-map`. `magic-string` is in the closure too, but it is **not** a
dependency of the transformer: it arrives via the sibling
`@apm-js-collab/code-transformer-bundler-plugins@0.7.1`. The first draft of this
document attributed it to the transformer; corrected at review (amendment 4), because a
dependency argument that misnames an edge invites the reader to check nothing else.

Read that closure for what it is: **a JavaScript parser and code generator, wired into
the module loader, rewriting this application's modules as they load.** That is not
incidental bloat — it is how automatic instrumentation works, and it works well.

It is also the one thing this particular codebase cannot accept, and the reason is not
aesthetic:

> The product's central safety property — *every byte that leaves this process for
> Stripe leaves from one line in one file* — is enforced by **a lexical scan of
> committed source** (`test/dependency-policy.test.js`). The guard reads the text on
> disk. A dependency that rewrites modules at load time means **the code that runs is
> not the code the guard read.**

The custody guarantee is the product's most expensive engineering asset: `Stripe-Account`
on every call, `transfer_data` and `on_behalf_of` rejected at the wire, "never in the
flow of funds" as a design constraint. It is worth more than automatic instrumentation.
This is a soundness objection to our own guard, and it stands whether the footprint
count is 33 or 3.

**PostHog does not have this problem.** `posthog-node` is 3 packages, all MIT, no
loader hooks, no code transformer, and it engine-matches Node 24. On rule 4 alone it
would pass comfortably. It is the closest call in this document and §3.5 says what
would flip it.

### 3.3 The decision: one hand-rolled egress module per vendor, using the documented HTTP ingest API

Both vendors accept plain HTTP with no SDK:

- **Sentry:** the envelope endpoint (`POST <host>/api/<project>/envelope/`), a
  newline-delimited framing of a header line, an item header line, and a JSON payload.
- **PostHog:** `POST /capture/` for one event, `POST /batch/` for many; a JSON body
  carrying the write-only project key.

So the egress module is `fetch`, a JSON body, and about 150 lines. Zero new packages;
rules 3, 4, 5 and 6 become vacuous rather than argued.

**Module layout, mirroring `lib/stripe/` exactly, because the shape is already proven
and already has a guard built for it:**

```
lib/telemetry/schema.js     the allow-list, as DATA. Imports nothing, does no I/O.
lib/telemetry/envelope.js   builds a Sentry envelope / PostHog batch from schema-validated input. Pure.
lib/telemetry/client.js     the ONLY importer of transport.js. Sampling, the daily cap, drop-on-failure.
lib/telemetry/transport.js  the ONE fetch. Mirrors lib/stripe/transport.js line for line in spirit.
```

`transport.js` inherits three properties from its Stripe sibling deliberately:
`redirect: 'error'` (a redirect would carry the key to another host), an
`AbortSignal.timeout`, and **no retry**. Telemetry that fails to send is dropped
silently and counted locally. Retrying telemetry is how a degraded vendor turns into a
degraded product.

Two properties it adds:

1. **Host pinning.** The destination host is compared against a committed literal
   before the request is built; a mismatch throws. A telemetry module is a
   general-purpose exfiltration primitive if its destination is a free variable.
2. **A hard local daily cap.** The client counts events per UTC day against a
   configured ceiling and drops past it. This is what makes "free tier" a fact rather
   than a hope: the free tier cannot silently become an invoice, which is the
   board's standing constraint expressed as code rather than as a promise.

### 3.4 What we are giving up, itemised

Rule 1 cuts both ways: name what the dependency removes, and name what refusing it
costs. Refusing the SDKs costs:

| Lost | Assessment |
|---|---|
| **Stack-frame parsing → issue grouping** | The real loss. Sentry groups issues by parsed frames; an unparsed stack groups coarser, so two distinct bugs can land in one issue. Mitigation and its deadline: Q1 (§8). |
| Automatic Express/HTTP/DB instrumentation | Not wanted. It is precisely what drags in the OpenTelemetry tree and the loader hooks. |
| Performance tracing / spans | Out of scope (§1). The product is server-rendered HTML with a SQLite file; if it is slow, that is a different investigation. |
| Breadcrumbs | Would carry request bodies and query strings by default — i.e. exactly the deny-list. A feature we would spend effort disabling. |
| Release / source-map association | The app has no build step and no minification. Stacks already point at real source. |
| Automatic uncaught-exception capture | ~20 lines of `process.on`. |
| Transport retry, queueing, rate-limit backoff | Explicitly not wanted, above. |
| Session tracking / release health | Not wanted; it is per-user state at a vendor. |

**Abandonment answer (rule 6), one line each:** both are documented public HTTP
endpoints; if a wire format changes under us, the module is ~150 lines and we fix it,
or we delete the feature and lose nothing else — no other module imports it, and the
product's behaviour does not depend on it. That is a materially better abandonment
story than a 33-package tree that patches the module loader.

### 3.5 What would overturn this

Stated in advance, so the decision is falsifiable rather than merely argued.

- **Sentry.** Nothing in the footprint number. The decision rests on §3.2's loader
  rewriting, which is structural. It would flip only if Sentry shipped a supported
  build with no loader hooks and no OpenTelemetry — i.e. a manual-capture-only core
  whose closure contains no transformer. If that exists, it is a re-evaluation, and
  the measurement is one `npm ls` away.
- **PostHog.** This one is genuinely close. It would flip if, and only if, the raw
  `/capture` route turned out to need something the SDK hides (an undocumented header,
  a signing step, a non-obvious `distinct_id` requirement) — that is Q2 (§8), with a
  deadline and a default. Absent that, it stays raw for a reason worth naming: **one
  SDK plus one hand-rolled module is two deny-list mechanisms and two mental models
  for one problem.** §4's testing strategy works because *all* egress is additive and
  schema-built. Adopting one SDK would put half the payload surface back under a
  subtractive hook, and the cardinality test in §4.3 would no longer mean what it says.

---

## 4. (c) The allow-list, the deny-list, and the tests that make them binding

### 4.1 Why additive, and why that is the crux

Under an SDK, privacy is **subtractive**: the SDK collects request context, local
variables, headers and breadcrumbs by default, and `beforeSend` deletes what you
thought of. You can only test the cases you anticipated; an unanticipated field is a
silent leak.

Under a hand-built envelope, privacy is **additive**: nothing leaves unless a line of
code constructs it. That is testable by *cardinality* — assert the exact key set of the
serialized payload — which is this company's existing discipline ("cardinality before
quantification") applied to a wire format. A new key is a red test, not a review catch.

This, and not the package count, is the strongest reason for §3.3.

### 4.2 The lists

**ALLOW — the closed set that may cross the wire.**

*Common to both vendors:* app name (`invoicing`); environment (`production` |
`development` | `test`); app version (the image digest or git sha); event timestamp
(ISO-8601 UTC); a pseudonymous actor id, defined in §4.4.

*Error events only:*
- `type` — the error's **constructor name**, validated against a committed enum of the
  app's error classes (`RepositoryError`, `NotFoundError`, `UniqueViolationError`,
  `ForeignKeyViolationError`, `InvalidStateError`, `ValidationError`, `MigrationError`,
  `AuthError`, `ConfigError`, `SignatureError`, `WebhookEventError`, `StripeApiError`,
  `StripeTransportError`, `StripeCustodyError`, `AccountNotReadyError`,
  `AmountMismatchError`, plus the built-ins). Anything not in the enum is sent as the
  literal `UnknownError`.

  That is **sixteen classes, and sixteen is the measured total** — every `class
  *Error` declared under `lib/`, `routes/` and `app.js` on master `65c73bb`. The first
  draft listed fifteen: it omitted `WebhookEventError` (`routes/webhooks.js:30`), which
  is not a harmless gap. That class marks a body that *verifies against our signing
  secret* but is not an event envelope — the one error on the webhook path that says
  something is wrong with what we are being sent rather than with us. Omitted from the
  enum it fails safe, which is the trap: it ships as the literal `UnknownError`, so the
  single most diagnostic error in the product arrives at the vendor indistinguishable
  from a typo in a helper. The enum is a closed list, so it must be closed against a
  measurement, not against recall — and the measurement is one `grep`, recorded here so
  the next person extends the list by re-running it.
- `code` — `err.code` **only** when it is a member of the committed code enum
  (`not_found`, `unique_violation`, `foreign_key_violation`, `invalid_state`,
  `validation`, `migration`). Otherwise omitted.
- `stack` — frames only: function name, source path **relative to the app root**, line,
  column. The first line of a V8 stack is `Name: message` and is **stripped**; `type`
  replaces it.
- `route` — the **matched route pattern** (`/invoices/:id`), never `req.originalUrl`.
- `method` — the HTTP verb.
- `status` — the response status code.

*Analytics events only:*
- `event` — one of a committed enum of core-loop event names (roughly eight).
- properties drawn from a per-event committed key list, and restricted by **type**:
  enumerated strings, booleans, integer counts, and integer durations in milliseconds.

**DENY — never, by construction.** Names, email addresses, or any other personal data
of a freelancer or their client · monetary amounts in any form (`amount`, `total`,
`subtotal`, `unitPrice`, per-item `quantity`) · line items or their descriptions ·
contract text, contract template variables, or rendered contract output · session
tokens, password hashes, or any credential · Stripe object ids of any kind (`acct_`,
`cus_`, `in_`, `evt_`) · raw request bodies, query strings, cookies, or headers ·
environment variables and their values · absolute filesystem paths · database rows or
fragments of SQL · **and the error message.**

### 4.3 The error message is denied, and here is the evidence rather than the instinct

That last item is the sharpest rule in this document, so it is argued from the
codebase rather than from principle. Measured across `apps/invoicing` app source
(excluding `test/`, `demo/`, `vendor/`, `node_modules/`): **185 `throw new *Error(`
sites, of which 60 interpolate a runtime value into the message — and of those, at
least 11 interpolate a value that is explicitly on the deny-list above.** Script and
full output: `scratchpad/agent-cto-owen/AS-76/throw-sites.js`, `throw-sites.txt`.

**Read that last number as a floor, because that is what it is.** The first two figures
are counts: they come from matching `throw new *Error(` and then testing for `${`.
The third does not — it comes from a hand-written regex over *deny-listed identifier
names* (`stripeCustomerId`, `amount`, `email`, and so on), so it finds a leak only when
the leaking value is carried by a variable whose name confesses. **10 is what that
regex matched; 11 is what is currently known.** The uncounted site found at review:

```
lib/contracts/generation.js:110   throw new NotFoundError('template variable', `${template.id}.${name}`)
```

`name` here is a contract template variable name — deny-listed in §4.2 under contract
template variables — reaching the message through a local called `name`, which no
name-matching regex will ever flag. There is no honest way to turn this into a count
without reading all 60 interpolating sites by hand, and the argument does not need one:
a floor is sufficient for a claim of the form "at least this many", and a floor that
knows it is a floor is worth more than a count that is quietly wrong. (Two further
sources of undercount, both in the safe direction: the scan is line-oriented, so a
`throw new` split across lines is missed; and it reads the throw site, not the callee,
so a message assembled inside an error constructor is invisible to it.) The two
sharpest sites the regex did match:

```
lib/db/repositories/clients.js:117   `client ${id} already has Stripe customer ${current.stripeCustomerId}`
lib/db/repositories/invoices.js:243  `invoice ${id} already has Stripe invoice ${current.stripeInvoiceId} attached`
```

The other eight the regex matched interpolate a filesystem path (`lib/db/database.js:57`), a rejected
configuration value (`lib/config.js`, six sites, via `JSON.stringify(raw)`), or a
user-typed value (`lib/contracts/render.js:85`). Two of those eight deserve their
caveats, because overstating them would weaken the argument rather than strengthen it:
`render.js:85` has already passed a `^\d{4}-\d{2}-\d{2}$` regex, so what it echoes is
digits, not free text; and the two `secret: true` config rows are `type: 'string'`,
whose coercion branch is a bare `return value` and interpolates nothing, so **no secret
reaches a `ConfigError` message today**. Corollary 3 below is about why that is a
coincidence rather than a guarantee.

The claim that survives all of those caveats is still decisive: sending `err.message`
does not *risk* leaking deny-listed data — **it leaks a Stripe object id today, at the
two named lines above**, and it would do so through the most ordinary possible
instrumentation choice, in the app whose defining constraint is that it stays out of
the flow of funds.

Three corollaries follow, and they are why this is a design ruling and not an
implementation detail:

1. **`err.cause` is denied too.** `mapSqliteError` sets `cause` to the raw driver
   error, whose message is written by SQLite and constrained by nobody.
2. **The error's own extra properties are denied:** `err.field`, `err.entity`,
   `err.id`, `err.constraint`, `err.problem`, `err.envVar`, and — added with the class
   itself — `err.reason` and `err.step` on `WebhookEventError`. They exist precisely
   because they carry the specifics, and the specifics are the leak. The rule is the
   safe shape: the allow-list names the properties that may be read, so a class that
   grows a new one is silent by default rather than newly chatty.
3. **No general rule protects us, and the near-miss above proves it.** `lib/config.js`
   already distinguishes `secret: true` rows and exposes a `redacted()` view — the
   house instinct is right and the precedent exists — but that invariant covers *the
   startup log line* and reaches nothing else. That today's two secrets are typed
   `string` is a fact about the current schema, not a property anyone enforces: a
   future `secret: true` row typed `enum`, `url` or `path` would interpolate its
   rejected value into a `ConfigError` message on the very next line, and no test
   anywhere would notice. A telemetry deny-list must not inherit its safety from a
   coincidence — which is the whole reason T-C (§4.5) is a sentinel sweep over the
   serialized bytes rather than a review checklist.

**What is lost by denying the message, and why it is acceptable:** an operator reading
an issue sees `ValidationError / validation` at `lib/invoices/lifecycle.js:223` rather
than which field failed. The stack frame is usually enough to find the throw site, and
the throw site's source says what the message would have said. When it genuinely is not
enough, the remedy is to add a committed, data-free **message constant** to the
allow-list enum — an explicit act, reviewed once — never to open the message field.

### 4.4 The actor id

Analytics needs a stable per-user key to count a funnel; sending the freelancer's
UUID is sending a database primary key to a vendor. Ruling: `distinct_id` is
`HMAC-SHA-256(freelancer_id, install_salt)`, hex, truncated to 32 characters, where
`install_salt` is 32 random bytes generated once at first boot and stored in the
app's own database. `node:crypto` is built in, so this is zero dependencies. Properties
that matter: stable across sessions (funnels work), unique per install (two
deployments do not collide), and irreversible without a value that never leaves the
host (the vendor cannot join it to anything).

Error events carry the same value, or none. They never carry an email address, which
is what both vendors' SDKs would attach by default given the chance.

### 4.5 The three tests, and the falsifiers each must fail against

The deny-list is enforced by tests, not by review discipline — the requirement AS-76
was filed with. Three, at different levels, because one level is not enough.

**T-A — lexical: the chokepoint still holds (extends the existing guard).**

This is a handoff instruction, so it is written against `apps/invoicing/test/dependency-policy.test.js`
as it stands on master `65c73bb`. Line numbers are anchors; the quoted literal beside
each one is what identifies the site if the file has moved under it. The first draft of
this subsection was written from a reading of the guard rather than from an application
of it, and got three things wrong; each is corrected below with the mechanism that makes
it wrong, because the mechanism is the part AS-77 has to hold in its head.

**Step 0 — make room before adding anything.** The file is **1,198 lines** against the
**1,200-line cap it enforces on itself** — its own last test, `if (lines > 1200)` (line
1195), walks `test/` too. T-A's additions are roughly 27 lines, so the guard file breaks
its own guard before the first telemetry line exists. The choice is made here rather
than left to the implementer at the moment of maximum inconvenience:

- **Raising the cap is refused.** The 1,200 is stack decision §10.4 item 1, trigger
  **T7**, and that trigger's recorded remedy is the word *"Split it."* Amending a
  stack-decision constraint as a side-effect of a telemetry task is deciding in the
  wrong order — if the cap is wrong, that is its own ruling, with its own evidence, in
  the document that owns it.
- **So: split, and split the mechanism out, not the policy.** One new helper,
  `test/helpers/source-text.js`, owns *what a scanned file's text is*: `stripComments`
  and `stripHashComments` (lines 137–261 with their two self-tests), `strippedText`
  (344–352), and `SOURCE_EXT` (276–278), which `strippedText` dispatches on. The two
  self-tests move verbatim into a sibling `test/source-text.test.js`; about 140 lines
  leave the guard file in total.
  `dependency-policy.test.js` imports `{ SOURCE_EXT, strippedText }` back and keeps
  everything with an opinion in it. The precedent is already in the directory:
  `test/helpers/hash-comment.js` (AS-57) is exactly this shape, and the guard file
  already imports `stripTrailingHashComment` from it.

  **`strippedText` and `SOURCE_EXT` have to go with the strippers, and this is not
  tidiness.** The manifest-stripper self-test ends with
  `assert.equal(strippedText(join(APP_DIR, 'package.json')), packageRaw)` — the
  assertion that `.json` is never stripped. Leaving `strippedText` behind would split
  that test across two files, and the whole point of calling this a move is that no test
  is split. `SOURCE_EXT` follows `strippedText` because that is what it dispatches on.

  Constraints that keep this a move rather than a rewrite: exported signatures unchanged
  (`stripComments(source, { ejs })`, `stripHashComments(text, { trailing })`,
  `strippedText(path)`); the two self-tests move verbatim, names included; **nothing else
  moves** — `MANIFEST_NAME`, `UNSCANNED`, `SKIPPED_DIRS`, `classifyTree`, `FILES`,
  `SCANNED`, `scanForbidden`, `scanConcept` and every counted literal stay.
  `MANIFEST_NAME` **especially** must not move: its own comment pins it to a single line
  in this file because the AS-53 M0 falsification rewrites that exact line with a
  one-line `perl`, and a falsification recipe that no longer finds its target is a guard
  nobody can check. `SOURCE_EXT` carries no such pin — checked, not assumed.
  Checkable invariant: `node --test` reports the same test names before and after,
  redistributed across two files, and no counted literal changes value except the one
  named next. Measured on a scratch copy with all of T-A applied: the guard file lands
  at **1,086 lines**, about 110 under the cap, and
  `dependency-policy.test.js` + `source-text.test.js` + `harness.test.js` run
  **17 tests, 17 passing** — the same 17 as the untouched baseline, redistributed.

  **The split has a second, non-obvious obligation: `test/harness.test.js`.** It pins
  the suite's own shape — `assert.equal(found.length, 23, …)` at line 91 and the sorted
  `EXPECTED_TEST_FILES` array at lines 62–86, under a comment reading *"adding a test
  file is a deliberate two-line change: the file, and this list."* So the split is also
  **23 → 24**, plus `'source-text.test.js'` in the array and the prose "twenty-three
  files" in the comment at line 99. That is step 2's lesson one layer up, and it is
  recorded because it was missed twice running: once when this section was drafted, and
  again by the scratch run that checked the draft and ran only the file it had edited.
  **This codebase pins its own inventory in several places, and a new file is never just
  a new file.** The three inventories a new source or test file touches: the source-count
  literal and array (`dependency-policy.test.js:390–391`), the test-file count and array
  (`harness.test.js:62–91`), and — for an egress construct — `SANCTIONED` and its
  cardinality. Find them by running the whole suite, not by reading it.

**Step 1 — two `SANCTIONED` entries, not one; the literal moves 3 → 5.** The mechanism
the first draft missed: `SANCTIONED` keys on **file + construct + the whole line**, and
the `OUTBOUND_CLIENTS` row named `stripe transport import` is
`/['"][^'"]*\btransport\.js['"]/` — *any* quoted path ending in `transport.js`, in any
scanned file. `lib/telemetry/client.js`'s import of its own transport is therefore a
second hit under a different key, and the `lib/stripe/client.js` entry cannot absorb it.

| file | construct | count | line pins |
|---|---|---|---|
| `lib/telemetry/transport.js` | `fetch` | 1 | the whole line of the one `await fetch(…)`, byte-for-byte |
| `lib/telemetry/client.js` | `stripe transport import` | 1 | the whole `import … from './transport.js';` line |

The cardinality literal — `assert.equal(SANCTIONED.length, 3, …)` at line 584, under the
comment *"adding a sanction is a deliberate two-line change"* — moves **3 → 5**.

The `construct` string in the second entry must be the literal `'stripe transport
import'`, because an entry's `construct` is matched against the `OUTBOUND_CLIENTS` row's
`name`. That name is now a misnomer: it is the *transport import* row and it guards both
transports. **Leave the name alone** — the AS-38 falsification recipes quote it — and put
the misnomer in the new entry's `reason`, where the next reader will meet it.

**Step 2 — the file-count literal, which is not a list of names.** The first draft said
the four new files are "added to the `SCANNED` literal list". There is no such list:
`SCANNED` is `[...FILES.source, ...FILES.manifest]` off the `classifyTree` filesystem
walk, so the new files enter it by existing — which is the whole point of the AS-53
closed-world walker. What *is* hand-maintained is the closed-world test's pair of
literals at lines 390–391: `assert.equal(source.length, 63, …)` becomes **67**, and the
four paths go into the sorted `assert.deepEqual(source, […])` array between
`'lib/stripe/transport.js'` and `'lib/vendor.js'` — `lib/telemetry/client.js`,
`lib/telemetry/envelope.js`, `lib/telemetry/schema.js`, `lib/telemetry/transport.js`.

**Step 3 — no new `scanConcept` row.** The first draft asked for one "mirroring the
existing `stripe transport import` row", which confused two mechanisms: that row is an
`OUTBOUND_CLIENTS` pattern, not a concept row. Because it already matches any quoted
`transport.js` in any scanned file, the property "`lib/telemetry/transport.js` is
imported by `lib/telemetry/client.js` and nowhere else" is enforced for free — a second
importer is an unsanctioned hit, which is a finding. Adding a concept row would buy
nothing and would add a third place to keep in sync.

**Two lexical hazards for whoever writes the telemetry modules,** since the scan reads
strings but not comments: the bare word `fetch` anywhere outside the sanctioned line is a
finding, *including inside a string literal* (`/\bfetch\b/`), and so is any quoted string
containing `transport.js` outside `client.js`'s import. Comments are stripped before the
scan, so prose may say either word freely.

Net effect: the product has **two** egress paths, each with its own chokepoint, each
pinned to one line — and the count of egress paths remains something a test asserts
rather than something a reviewer remembers.

**T-B — allow-list cardinality.** For each event type, build a fully populated payload,
serialize it, recursively flatten it to JSON key paths, and `assert.deepEqual` the
sorted result against a committed literal array. Not a subset check, not a floor: the
exact set. A new key anywhere in the payload — including one added by a future
refactor three layers down — turns the suite red.

**T-C — deny-list sentinel sweep.** Construct the app's real objects (a freelancer, a
client, an invoice with line items, a contract, a session, Stripe ids) with unique
sentinel values (`SENTINEL_CLIENT_EMAIL_7f3a@example.invalid`, `SENTINEL_AMOUNT_918273`,
`acct_SENTINEL9182`, …), drive every telemetry entry point with them, including paths
that throw, and assert that **no sentinel appears as a substring of the serialized
bytes**. Whole-payload substring scan, deliberately not a field-by-field check: a
denied value arriving through a field nobody anticipated is exactly the failure this
must catch, and a per-field assertion is blind to it by construction.

**Falsifiers (stack decision M4 — each numbered as an acceptance criterion in the
inheriting task's plan, and satisfied only by an *observed* red):**

| # | Mutation | Must turn red |
|---|---|---|
| F1 | Remove one deny check in `envelope.js` | T-C |
| F2 | Add one key to any payload builder | T-B |
| F3 | Add a second `fetch` in any app file outside the sanctioned line | T-A |
| F4 | Pass `err.message` through instead of `type` | T-C (message sentinel) |
| F5 | Point `transport.js` at a host other than the pinned literal | the host-pin assertion |
| F6 | T-A's allow-list, three mutations, each run once per new entry: **(a)** the clean removal — delete the entry *and* decrement the cardinality literal 5 → 4; **(b)** the half-edit — delete the entry, leave the literal at 5; **(c)** keep the entry, rewrite the line it pins | Measured, not predicted (below). **(a)** exactly one: *no app source or manifest outside `test/` contains an outbound HTTP client*, naming the now-unsanctioned line. **(b)** exactly two: that test **and** *every sanctioned construct is present exactly where it is declared*. **(c)** the same two. A red set of any other shape is a finding |

Per the review gate: each mutation is asserted to have applied at the intended site
before a survivor is called a weak guard, and the exact red set is recorded. A wider
or narrower red set than the table is itself a finding.

**F6's red sets were measured rather than reasoned, because reasoning got them wrong
twice.** The corrected T-A was applied end-to-end to a scratch copy of `apps/invoicing` — the
split, the four `lib/telemetry` modules, both entries, 3 → 5, 63 → 67, 23 → 24 — and the
result is green: **17 tests, 17 passing** across the three files T-A touches, against the
same 17 in the untouched baseline. Then F6 was run against that green copy, and the first
draft of the row above was wrong in both directions: it predicted the cardinality
assertion for the clean removal, which passes (the literal is decremented along with the
entry), and it predicted only the stale-entry arm for a rewritten line, which is two reds,
not one.
The reason is worth carrying into AS-77, because it generalises: **both tests are backed
by the same `scanForbidden` walk**, so any mutation that leaves a real `fetch` or
transport import unsanctioned turns the outbound-client test red *as well as* whatever
arm it was aimed at. Scripts and transcripts: `scratchpad/agent-cto-owen/AS-76/apply-ta.js`,
`f6-check.js`, `f6-check-b.js`. Note what this does *not* establish — the scratch modules
are stubs with the right lexical shape, so this proves the instructions are executable
and the guard still bites; it proves nothing about the telemetry code AS-77 will write.

**Standing condition.** These tests run under `--network none` like the rest of the
suite — trivially, because the transport is injected and no test ever reaches a vendor.
If T-B or T-C is red, the cloud decision in §5 is void, because §5's entire safety
argument is that what reaches the vendor is not customer data.

---

## 5. (d) Self-hosted versus cloud

### 5.1 The two shapes

**Self-hosted.** No vendor holds our data and there is no DPA question. Against that:
both products self-host as multi-service deployments — Postgres, ClickHouse, Redis and
a message broker among them — with vendor-documented minimums well beyond the droplet
class this product runs on, plus upgrades, storage growth, and a second operational
surface that we own and that can page nobody, because there is nobody. It is also
**spend**, which makes it a board ask with a recurring monthly number attached.

**Cloud, free tier.** Two accounts, two write-only keys. $0. Error metadata and event
names reside with two vendors under their standard terms. Zero ops surface. It is
**still a board ask** — the standing rule gates every external signup including free
and test-mode accounts, with no threshold — but it is an ask for permission, not for
money.

*(A note on rigour: the vendors' documented self-hosting minimums are quoted here from
knowledge, not measured, because this session had no network. That is flagged rather
than smoothed over — but the conclusion does not turn on the figure. At any plausible
value, a multi-service analytics cluster is more infrastructure than a pre-revenue
company with no users should own, and if the true minimum were half what I believe it
to be the answer would be the same.)*

### 5.2 The decision: cloud, free tier, both vendors

Three reasons, in order of weight:

1. **The data-residency objection to cloud is answered by §4, not by the vendor.**
   Because the allow-list is additive and enforced by T-B and T-C, what reaches a
   vendor is: error type, stack frames, route patterns, event names, and an HMAC'd
   opaque id. There is no customer data at the vendor **to** be resident anywhere.
   Self-hosting protects data we have already decided not to send. Buying a cluster to
   protect data that never leaves the building is paying twice for the same property —
   and the cheaper of the two payments is also the one enforced by a test.
2. **Ops surface is the real cost and it is paid forever.** This company's engineering
   capacity is finite and currently spoken for by D1. A ClickHouse cluster we own is a
   permanent tax on that capacity, levied to serve an app with no users yet.
3. **Spend is board-gated and the company is pre-revenue.** Asking the board for a
   monthly line item to observe an app nobody uses yet is the wrong order of
   operations. §2.2's ordering exists for the same reason.

**The controls that make "free tier" durable rather than optimistic:** the §3.3 daily
cap in the client, so volume cannot silently cross into billing; write-only keys, so a
leaked key can send garbage but cannot read; and the two keys handled exactly as the
existing two Stripe secrets are — schema rows marked `secret: true`, defaulting to
`null`, redacted from the startup line, absent from `/healthz`, never committed, and
with **absence as a first-class state**. The app must boot, serve, and pass its full
suite with both keys unset. Telemetry is an optional subsystem; a missing key disables
it and is never a misconfiguration.

### 5.3 What would overturn this

If a customer contract or a jurisdiction ever requires that error metadata not leave
our infrastructure; if free-tier volume limits are hit *after* the daily cap is already
tuned as low as usefully possible; or if either vendor materially changes free-tier
terms. Any of the three reopens §5 — none of them reopens §3, since a hand-rolled
egress module points at a self-hosted host by changing one committed literal. **That is
a deliberate property of §3's design: the cloud-versus-self-hosted question stays cheap
to revisit precisely because we did not adopt an SDK.**

---

## 6. (e) The board ask

To be filed as a `needs_human` on the first inheriting task after AS-76 merges, under
`agent:cto-owen`. It creates nothing; it asks. Verbatim, ready to paste:

---

> **Asking for permission to open two free monitoring accounts — no spend, now or later.**
>
> We can't currently see when the product breaks for someone who isn't us. Once real
> freelancers are using it, a crash on their screen is invisible to us and they won't
> tell us — they'll just leave. The fix is two standard, widely-used services: one that
> records errors, one that counts how far people get through signing up and sending
> their first invoice.
>
> **The ask — three yes/no answers:**
>
> 1. **May we open a free account with each of the two vendors** (Sentry for errors,
>    PostHog for usage), and hold one write-only key from each?
> 2. **Confirm the no-spend boundary.** Both stay on their free tiers. The app enforces
>    its own daily send limit in code, so usage cannot quietly cross into a bill. Any
>    paid tier would come back to you as a separate ask.
> 3. **One optional extra.** We are *not* proposing error tracking for the internal
>    chat app and the automation that runs the company — its failures are better caught
>    by the company's own event feed, which costs nothing and already exists. Say the
>    word if you'd rather have the third-party tool there too.
>
> **What this does not ask for:** any money, any contract, any change to how the
> product handles payments.
>
> **What leaves our machine, and what does not.** Only the kind of error and where in
> the code it happened, plus anonymous counts of which steps people reach. No names, no
> email addresses, no amounts, no invoice or contract contents, no payment
> identifiers — enforced by tests that fail the build if any of it slips in, not by
> anyone remembering.
>
> Blocked on your answer: three instrumentation tasks. Nothing starts until you reply.

---

**Accompanying one-line chat message** (`#board`, outcome first per `CLAUDE.md`):
*"We can't see it when the product breaks for a real user — I'd like permission to open
two free monitoring accounts, no spend now or later; details on the task."*

**Notes for whoever files it.** Do not add numbers to it: the package counts, the 185
throw sites and the falsifier table belong in the Lattice comment and in this
document, not in front of the board. Do not name AS-77/78/79, `beforeSend`, DSN,
envelope, chokepoint, or deny-list in the ask itself. **Do not file it before AS-76
merges**, and file it as one item — the two vendors go together, because the board
answering half of it leaves the design half-decided.

---

## 7. What AS-77, AS-78 and AS-79 inherit

Each of these is a normal three-stage task, and each is **blocked on §6's answer**
before implementation — not before planning.

**AS-77 — Sentry error tracking, `apps/invoicing`.** §3.3's four modules; §4.2's error
allow-list with the message denied per §4.3; T-A, T-B, T-C with F1–F6 as numbered
acceptance criteria; the host pin and the daily cap; key as a `secret: true` schema row
defaulting to `null`, with the app fully functional and the suite fully green when it
is unset. Ships **before** the first non-employee user. Complexity: **medium** — it is
the first second-egress-path in the product and it edits a guard, which is not `low`
work whatever its line count.

Its plan must open with **T-A step 0**, the `dependency-policy.test.js` split, as its
own commit with its own green suite *before* a line of telemetry is written: the guard
file is two lines under a cap it enforces on itself, so the split is a precondition of
the task, not a cleanup at the end of it. Mixing a ~140-line move into the same commit as
a new egress path would make the one diff in this task that most needs to be readable
unreadable.

**AS-78 — PostHog analytics, `apps/invoicing`.** Reuses `transport.js` and the schema
machinery; adds the core-loop event enum and per-event property key lists; §4.4's
HMAC actor id and the install salt. **Server-side only.** Ships **after** AS-77 and
after there are users. Complexity: **medium**.

**AS-79 — re-scoped.** From "Sentry on chat + watcher" to **"watcher and chat-server
fault events into the company event stream, plus the absence projection"** — the three
items in §2.3. Zero dependencies, zero egress, zero signup; internal-tools lane, so it
needs no per-task green-light and is **not** blocked on §6. Its description should be
rewritten to say so, and to carry §2.3's reopening trigger verbatim. If the board takes
the §6 item-3 override, AS-79 splits and a second task carries the Sentry half.

---

## 8. Open questions — each with a deadline and a default answer

Per standing practice: an open question without a deadline and a default is not open,
it is abandoned.

| # | Question | Deadline | Default if the box expires |
|---|---|---|---|
| Q1 | Do unparsed stacks group badly enough to make issues unusable? | two weeks of real errors after AS-77 ships | Keep raw frames. If grouping is unusable, add a ~30-line frame parser — still zero dependencies. Do **not** revisit the SDK on grouping alone. |
| Q2 | Does raw `POST /capture/` need anything the PostHog SDK hides? | first AS-78 test against a real key | Send one event per request via `/capture/`; drop `/batch/`. If raw ingest genuinely does not work, that is the §3.5 trigger and PostHog's SDK is re-evaluated on its own — not Sentry's. |
| Q3 | Browser-side error capture? | after the first ten real users | None. Revisit only if server-side telemetry shows a gap it cannot explain. |
| Q4 | Daily cap: config row or code constant? | AS-77 planning | A `secret: false` config row with a conservative default, so it is tunable without a deploy. |
| Q5 | Confirm §3.1's footprint with a live `npm ls --all --parseable` | the first tick with network | Numbers stand as a floor; §3.2's argument does not depend on them. Record the real number in this document's amendment log when it is taken. |
| Q6 | The `04-` filename collision with `04-glossary.md` | next tick that touches this cluster | Rename to `06-observability-posture.md` and update AS-77/78/79 and this document's own references in the same commit — one visible change, never a silent move. |

Two glossary entries are proposed for `docs/engineering/04-glossary.md` (recorded here
rather than applied, since employees do not edit that file directly): **error tracking**
and **product analytics**, §0's definitions verbatim.

---

## 9. Amendment log

| # | Date | What changed | Why | Who |
|---|---|---|---|---|
| 1 | 2026-09-13 | Document created. Posture decided for both apps: raw HTTP ingest over vendor SDKs; cloud free tier; additive allow-list enforced by three tests and six falsifiers; `apps/chat` error tracking declined in favour of the existing company event stream, with a named reopening trigger; board ask drafted | AS-76, from board DM msg 521 (2026-09-03) | Owen Kessler, CTO |
| 2 | 2026-09-13 | **Recorded divergence from AS-76's brief.** The brief scoped AS-79 as Sentry on `apps/chat` + watcher; §2.3 recommends against it and re-scopes the task. Reason: all three silent-failure incidents on the record were *non-events*, which error tracking does not detect by construction. The board is given a one-line override in §6 item 3 rather than having the narrowing applied silently | The design task's job is to decide, including deciding that a presumed instrument is the wrong one — but not to quietly drop something the board asked for | Owen Kessler, CTO |
| 3 | 2026-09-13 | **Recorded method divergence.** Rule 4's literal command could not be run (no network this session); the closure was resolved offline from the local npm cache instead, and the resulting count is stated as a floor. Cross-checked by re-deriving the app's own recorded 67/69 figure by the same method and matching §13 amendment 8 exactly | §11 rule 4 says the footprint is counted, not assumed; an unrunnable command is not a licence to guess, and a substitute method has to show its own validation | Owen Kessler, CTO |
| 4 | 2026-09-13 | **Review cycle 1 (`qa-ruben`), six corrections, all in the handoff instructions.** §4.5 T-A rewritten: two `SANCTIONED` entries and the literal 3 → 5, not one and 3 → 4 (the allow-list keys on file + construct + line, and the transport-import row matches *any* quoted `transport.js`); `SCANNED` is a filesystem walk, so the hand-maintained obligation is the source-count literal 63 → 67 and its sorted array, not a "`SCANNED` literal list"; the guard file is 1,198 lines against its own 1,200-line cap, so T-A now opens with a split as step 0 (split, not a raised cap: the 1,200 is stack decision §10.4 item 1 / trigger T7, whose recorded remedy is "Split it"), and F6 was re-stated with the red sets it actually produces. **The corrected T-A was then executed, not just written** — applied end-to-end to a scratch copy, green at 17/17, with F6 measured against it; that run found two further things the rewrite had missed: F6's predicted red sets were wrong in both directions, and the split also owes `test/harness.test.js` its 23 → 24 test-file inventory. §4.2 gained `WebhookEventError`, the sixteenth error class, plus its two extra properties in corollary 2. §4.3's "10" is restated as a floor of 10 with at least 11 known, naming the uncounted site. §3.2's `magic-string` edge was re-attributed to the sibling bundler-plugins package | Every correction is in the part of the document another task executes against verbatim, which is exactly where being nearly right is most expensive: T-A as first written would have failed the suite it was written to extend. Reviewer's method — applying T-A to a scratch copy and counting the reds — is the reason they were found before AS-77 inherited them | Owen Kessler, CTO, on findings from Ruben Ochoa, QA |
