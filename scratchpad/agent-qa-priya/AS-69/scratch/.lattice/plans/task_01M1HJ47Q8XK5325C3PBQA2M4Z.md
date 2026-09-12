# AS-65: D1 v1: client creation (server) — the POST /clients nobody owns

Planner: `agent:cto-owen`, 2026-09-02. Implementer: `agent:developer-lena`.
Complexity: low. Depends on AS-40 (done). Blocks AS-46, AS-47.

---

## 1. Scope

One HTTP route — `POST /clients` — that turns a submitted name and email into a
`clients` row owned by the session's freelancer, and returns the freelancer to
the screen they came from with the new id in hand. It is the only way a client
can come into existence in the shipped application; today `repos.clients.create`
has zero non-test callers (verified 2026-09-02: `grep -rn 'repos\.clients'
apps/invoicing --include='*.js' | grep -v /test/` returns four lines, all
`getById` or `setStripeCustomerId`, none `create`).

**In scope**

1. `routes/clients.js` — one route, below the auth boundary, `{ repos }` alone.
2. The mount in `app.js`, below the boundary banner.
3. `test/clients.test.js` — the HTTP surface, eleven cases.
4. The committed literals in three existing test files that a new route and a
   new test file move (§5).

**Not in scope, stated so it is not inherited by accident**

- **The screens.** Screens 4 and 6 are AS-46's and AS-47's, including every
  `S{4,6}-CLIENT-*` ledger row, the picker, the duplicate warning, and the
  round trip that brings a freelancer back to a half-filled parent form. This
  task ships no `GET`, no view, and no template.
- **Any Stripe customer creation.** Verified, not asserted:
  `lib/invoices/lifecycle.js` `ensureCustomer` (line 147) reads
  `client.stripeCustomerId`, returns early when it is set, and otherwise
  `POST`s `/v1/customers` and calls `repos.clients.setStripeCustomerId`. It runs
  inside invoice finalize, behind `AccountNotReadyError`. A client created by
  this route leaves no trace on the freelancer's Stripe account until it is
  invoiced, and that is the AS-43 design, not an omission here. Screen 6 is not
  Stripe-gated at all (`01-screens.md` §5), so this route must not gate either.
- **Email *format* validation.** See §3.4 and §9 Q4 — missing one layer down,
  and filed as its own task rather than smuggled in here.
- **Any repository change.** `lib/db/repositories/clients.js` is not edited.
- **Any migration.** See §4.

---

## 2. File-level scope (exact)

Created:

| Path | Purpose |
|---|---|
| `apps/invoicing/routes/clients.js` | the route |
| `apps/invoicing/test/clients.test.js` | the L group |

Edited:

| Path | What |
|---|---|
| `apps/invoicing/app.js` | one import, one mount (item 13) |
| `apps/invoicing/test/auth.test.js` | route-partition literals (§5) |
| `apps/invoicing/test/harness.test.js` | test-file inventory literals (§5) |
| `apps/invoicing/test/dependency-policy.test.js` | source inventory + `body parser` row (§5) |

Nothing else. Any other file appearing in the diff is a finding.

---

## 3. Design

### 3.1 The shape, and why it is one route

The recorded decision (task description; AS-42 plan §11) is binding: **one
shared `POST /clients`**, never two, never nested inside `POST /contracts` or
`POST /invoices`. Confirmed in planning. A nested create makes a client a side
effect of a different resource and makes partial failure ambiguous — a contract
that fails validation after its client was written leaves a client the
freelancer never asked for and cannot see, because there is no Clients screen
(C-16 cut) to see it on.

```
POST /clients          form: name, email, next
  → 303  Location: <next with clientId=<new id> set>
  → 400  ValidationError: create   (or ": parse-body")
  → 413  PayloadTooLargeError: parse-body
```

Mounted in `app.js` as item 13, immediately after `contractRoutes`, **below the
auth boundary banner**. `{ repos }` alone — no `stripe`, matching
`contractRoutes` and for the same reason (§1, not-in-scope). The exact path
`/clients` shadows nothing in the committed route list.

**No third publicness mechanism.** AS-64 records that two already exist: mount
position, and `requireSession`'s `SIGNIN_PATH` early return. This route adds
neither — it is protected by position alone, and `lib/auth/guard.js` is not
edited.

### 3.2 The duplicate ruling — a repeat submission creates a NEW row

**Ruling: `POST /clients` unconditionally inserts. It never converges on an
existing client, and it has no "upsert" mode.**

Checked rather than assumed, both places the description names:

- `lib/db/migrations/0001-initial.js`, the `clients` DDL: `email TEXT NOT NULL
  CHECK (length(trim(email)) > 0), -- NOT unique: duplicate is a non-blocking
  warning (S4/S6 client-dup states)`. The only `UNIQUE` on the table are
  `stripe_customer_id` and the composite `UNIQUE (freelancer_id, id)`.
  `clients_owner_email` is a plain `CREATE INDEX`, not unique.
- `docs/design/wireframes/02-states-ledger.md` §0 and `00-flows.md` Flow 3
  step 3b: the duplicate is a **non-blocking warning** that offers *both* "use
  this client instead" and **"create a new client anyway"** — "some freelancers
  legitimately have two contacts sharing a shared inbox."

Why the other answer was rejected:

1. **Convergence is a uniqueness rule enforced in application code over a column
   the schema deliberately declined to make unique.** That is the second source
   of truth AS-42's plan argues against, and this one is worse than most: it is
   a constraint the repository can bypass, so the "rule" would hold for
   requests and not for rows.
2. **It makes a required ledger state unreachable.** "Create a new client
   anyway" cannot be expressed by an endpoint that refuses to create a second
   row with that email. An endpoint that always creates expresses both
   outcomes: "use this one instead" is the screen selecting the existing id and
   never posting at all.
3. **It would silently return a row the freelancer did not name.** Same email,
   different name — which name wins? Overwrite is a lost edit; keep is a
   response whose `name` is not what was submitted. Both are surprises, and
   Flow 3's shared-inbox case is exactly the one that breaks.

**Therefore a double submit creates two rows.** Accepted, with the cost named:
no money moves, no external call is made (§1), and the second row is inert
until something references it — it appears in the picker beside its twin,
distinguished by name. The alternative (an idempotency key, or a server-side
uniqueness rule) buys cosmetic tidiness at the price of item 2 above. This is
the *same* posture the invoice lifecycle already takes on its own double-submit
window (`lifecycle.js` §"the lazy customer", case iii).

**What the screens do instead.** The duplicate *warning* is the screens', read
from `repos.clients.findByEmail(freelancerId, email)`, which AS-39 built for
exactly this and which "returns all of them, not the first." AS-46 and AS-47
own when to call it and what to render. This endpoint's contract to them is:
*whatever you decide, posting here will create the row.*

### 3.3 The response

**`303 See Other`, no body**, `Location` = the caller's validated return path
with the new client's id set as a `clientId` query parameter.

- `303` because every POST in this app redirects with `303`
  (`routes/invoices.js`, `routes/contracts.js`, `routes/auth.js`).
- **No JSON body**, deliberately. No other route in this app returns a body on
  success; the screens are server-rendered with no client-side JavaScript
  (`01-screens.md` §2), so a body would have no consumer; and a POST that
  returns the created object invites a form that re-renders from the *response*
  rather than from the DB, which is the opposite of the re-render discipline the
  ledger pins (`00-flows.md` Flow 6).
- **A return path is structurally required, not a nicety.** One endpoint serves
  two screens and there is no Clients screen to land on. `Referer` is not
  usable (unvalidatable, and absent under some referrer policies). So the
  caller names it.

**`next` is a required form field**, validated by `safeNext` from
`lib/auth/guard.js` — the app's existing, tested primitive for "a client-supplied
path we are about to redirect to", already used this way in `routes/auth.js`
(`const landing = (body) => safeNext(field(body, 'next')) ?? POST_SIGNIN_LANDING`).

**Required, not defaulted — this is the one place this route diverges from the
`routes/auth.js` precedent, and the reason is stated:** sign-in has a meaningful
default landing (`POST_SIGNIN_LANDING`); client creation has none. Defaulting to
`/` would silently discard the invoice or contract the freelancer was in the
middle of, which `01-screens.md` §4 item 4 rules out for exactly this class of
redirect. Absent or refused `next` is therefore a `400` — a caller bug, never a
freelancer-reachable state, and **validated before the insert** so a malformed
request leaves no row behind.

**Composition — REWRITTEN IN REVIEW CYCLE 1. The ruling in the findings section
at the end of this file is binding; read it before writing the code.**

The route composes the redirect target from the validated return path and then
**re-validates the composed string with the same `safeNext`, immediately before
emitting it**. The text that stood here claimed the composition was safe by
construction — "the base is a parse target only: taking pathname+search+hash
back off means this cannot emit an absolute URL even if `safeNext` were weakened
later." **That claim is false, and it is the defect this task was reworked for.**
`new URL(next, base).pathname` performs RFC 3986 §5.2.4 dot-segment removal,
which turns `/.//evil.test` — a value `safeNext` *accepts*, and which stays on
the app origin when emitted raw — into `//evil.test`, a protocol-relative
reference that sends the freelancer and the id just minted for them to an
attacker's origin. The composition was not a second layer and not a mask: it was
a **negative** layer that manufactured the escape.

See **Review Cycle 1 Findings → F-1** for the reproduction and the mechanism,
and **THE RULING** for the shape that replaces this, what it guarantees, and the
three alternatives rejected. `routes/auth.js` is unaffected — it emits
`safeNext`'s output raw and never composes — so this was introduced here, not
inherited from AS-40.

The parameter is named `clientId` — the same name both consumers already accept
as a form field (`routes/contracts.js` `contractInput`, `routes/invoices.js`
`CREATE_FIELDS`) — so the screen re-renders its picker pre-selected on a value
it already knows how to spell. `next` **may carry its own query string**, and
that is the sanctioned way for AS-46/AS-47 to preserve in-progress form values
across the round trip; the composition preserves it.

**What AS-46 and AS-47 may rely on, verbatim:**

1. `POST /clients` with `name`, `email`, `next` and a valid session returns
   `303`.
2. The `Location` is `next` with `clientId=<id>` set, app-relative, carrying no
   identity.
3. That `<id>` is a `clients.id` for the session's freelancer, immediately
   accepted as `clientId` by `POST /contracts` and `POST /invoices` in the same
   session.
4. It appears in `repos.clients.listByFreelancer(freelancerId)` on the next GET,
   and in `repos.clients.findByEmail(freelancerId, email)`.
5. Every failure is one line of `text/plain` — `<ErrorName>: <step>\n` — and the
   screens render their states from the DB, never from that body.

### 3.4 Validation — what the route adds, which is almost nothing

The repository already validates, and it is the layer that cannot be bypassed:
`create` runs `assertText(freelancerId)`, `assertKnownKeys(input, ['name',
'email'], 'client')`, `assertText(input.name)`, `assertText(input.email)`, and
the DDL's `CHECK (length(trim(...)) > 0)` is the backstop behind all of it.

**The route adds exactly three things, none of them a duplicated check:**

1. **It splits its own transport field from the client's fields.** `next` is the
   router's, not the client's, so it is destructured out before `create` sees
   the body — otherwise `assertKnownKeys` would reject it. Rest-spread, the same
   shape as `routes/contracts.js`'s `const { clientId, templateId, ...formValues
   } = body`. **There is deliberately no field allowlist here:** the
   repository's `assertKnownKeys` is the allowlist, and a second one at the route
   could drift from it. A body carrying `phone` reaches the repository and comes
   back `ValidationError: client.phone` → 400.
2. **The `next` validation** (§3.3), which no lower layer knows about.
3. **The error-class → status mapping** and the redirect composition.

It adds **no** name check, **no** email check, **no** length ceiling, and **no**
type coercion. A repeated form parameter arrives as an array and `assertText`
already answers `ValidationError`; `routes/invoices.js`'s `textField` exists
because those values go to a *service*, not straight through `assertKnownKeys`.

> **Load-bearing detail for the implementer — CORRECTED IN REVIEW CYCLE 1.** The
> note that stood here claimed `express.urlencoded({ extended: false })` returns
> a **null-prototype** object and that passing `req.body` straight to
> `repos.clients.create` would therefore 400 on every valid request via
> `assertPlainObject`. **That is false on the shipped versions.** Measured in the
> built image on express 5.2.1 / body-parser 2.3.0:
> `Object.getPrototypeOf(req.body) === Object.prototype` is **true**, `=== null`
> is false, and the spread's result is `Object.prototype` as well.
> `assertPlainObject` does refuse a genuinely null-prototype object — the check
> works, it simply never fires here.
>
> **Spread anyway. The conclusion holds for its other, independent reason:**
> `next` is the router's field, not the client's, so it must be split out or
> `assertKnownKeys` rejects it — and `routes/contracts.js` does the same. Nothing
> in the code rested on the false half; the *record* did, which is why it is
> corrected rather than deleted: AS-46's and AS-47's planners read this section
> cold. The same parser behaviour has one real consequence, found in review:
> `qs.parse` drops `__proto__` before `assertKnownKeys` can see it, so that one
> field answers 303 where every other unknown field answers 400 (Review Cycle 1
> Findings → F-3).

**Email format is NOT checked, and that is a gap being filed, not covered up.**
`assertText` accepts `"not an email"`. The only place a malformed client email
does harm is `ensureCustomer` handing it to Stripe at finalize, and Stripe
refuses it there — late, on the wrong screen, as a `502`. `00-flows.md` Flow 3
step 3a names "malformed email" as a validation state, so the ledger expects
enforcement. It belongs in the **repository**, beside the row, where the
constraint cannot be bypassed — `lib/auth/accounts.js` has an `assertEmailShape`
for the *freelancer's own* address but it is private, `AuthError`-typed, and
about deliverability to the account holder, not to a client. Adding a shape check
at *this route* would be precisely the second source of truth §3.4 exists to
refuse. **Filed as its own task; see §9 Q4 and §11.** It does not block AS-46 or
AS-47: the blank/whitespace half of `S{4,6}-CLIENT-ERROR-VALIDATION` is enforced
today by `assertText` and the DDL CHECK.

### 3.5 Ownership — the FK and the single identity source, not an application re-check

`const freelancerId = actingFreelancerId(req);` at the top of the handler, passed
as the first positional argument to `repos.clients.create`, and **nothing in this
file reads the query string, the body, or a header for identity.** That is the
route's entire ownership responsibility, exactly as `routes/contracts.js` states
it. `req.currentUser` is never named here — the `current user` concept row in
`dependency-policy.test.js` pins it to `lib/auth/guard.js` alone, and
`actingFreelancerId` throws rather than act as nobody, so a router accidentally
mounted above the boundary is a loud 500.

The engine layer, verified in `0001-initial.js`:

- `clients.freelancer_id TEXT NOT NULL REFERENCES freelancers (id)` — the only
  FK on the row this route writes. `PRAGMA foreign_keys = ON` is applied in
  `lib/db/connection.js` (line 33) and asserted by `D1`.
- `clients UNIQUE (freelancer_id, id)` is the target of the composite FKs on
  `contracts` and `invoices` — which is what makes the id this route mints
  **inert for everyone else**: no other freelancer can attach it to anything.
  Already proven at the engine level by `X4` and `X5` in
  `repositories.test.js` (raw INSERT, `787`); this task adds the HTTP-level
  witness (`L8`) and the missing recipe (`F5`).

**What a cross-tenant or malformed attempt returns, and whether a row is written:**

| Attempt | Answer | Row written |
|---|---|---|
| No session | `303` → `/signin`, no `Set-Cookie` — the guard's, not this route's | none |
| Foreign/absent `Origin` on the POST | `403 AuthError: forbidden-origin` — `requireSameOrigin`'s | none |
| `freelancerId` / `freelancer` in the **query string** | `303`, and the row is the **session's** — the query string is never read | one, for the session's freelancer |
| `freelancerId` in the **body** | `400 ValidationError: create` (`client.freelancerId` is not in the repository's allowlist) | **none, for anyone** |
| Another freelancer's `clientId` used downstream | `404 NotFoundError: create` from `POST /contracts` / `POST /invoices` — byte-identical to a client that does not exist | none |

**There is no cross-tenant path *into* this route.** The resource has no parent
except the freelancer, and the freelancer has exactly one source. That is the
honest reading of the description's "a cross-tenant attempt returns the same
answer as a nonexistent parent": here the two collapse, because there is no
attacker-nameable parent at all. `NotFoundError` is therefore **not mapped** in
this route's `statusFor` — see §3.6.

### 3.6 The error taxonomy — matched in shape, shorter by reachability

Same shape as `routes/contracts.js`: mapped **by error class, never by message
text**; one-line `text/plain` body `${err.name}: ${err.step ?? step}\n`; a
router-level error handler at the end to land body-parser refusals, which never
reach a handler.

```js
function statusFor(err) {
  if (err instanceof ValidationError) return 400;   // blank/missing name or email,
                                                    // unknown field, bad or absent `next`
  if (Number.isInteger(err?.status)) return err.status;  // the parser's own; LAST of the mapped cases
  return 500;
}
```

**Three cases, and the omissions are the decision.** `NotFoundError` (404),
`InvalidStateError`/`UniqueViolationError` (409), `ForeignKeyViolationError`,
and every Stripe class are **not** mapped, because none is reachable on a path
that makes no external call, has no state machine, and inserts into a table
whose only FK target is guaranteed by the session. Copying them for symmetry
would be exactly what `routes/contracts.js`'s banner refuses: "an unreachable
mapping is a dead branch that reads like a considered decision and is not one."
If one ever fires it is a loud 500, which is the correct answer to something
that cannot happen.

The invariant, and `L11` asserts both directions: **every class this route can
throw is mapped, and every class it maps is reachable by a test in this file.**

### 3.7 The seam that failed, and the rule that closes it

`repos.clients.create` shipped in AS-39 and sat with zero non-test callers
through six subsequent tasks. The milestone plan cut the Clients screen (C-16)
because clients are created inline — sound for the UI — and the server half was
then owned by nobody: AS-39 stopped at the repository, AS-42 and AS-43 each took
a `clientId` and assumed the other end existed.

**THE SPLIT-RESOURCE RULE.** When a resource's creation surface is split between
a screen and a server, there are **three** obligations, and each has exactly one
owner:

1. **The row** — the repository write method, its validation and its
   constraints. Owned by the schema/repository task.
2. **The endpoint** — the HTTP route that turns a submitted form into that row.
   **Owned by a task of its own, filed at the moment the repository task lands.**
   Never inherited by "whichever screen gets there first": that default is what
   produced this gap, because two screens each assumed the other carried it.
3. **The states** — every ledger row the screen renders around that creation.
   Owned by the screen task.

**The mechanical test, which is what makes this a rule rather than a sentiment:**
*a repository write method with zero non-test callers at the end of its own task
is an unowned endpoint, not a finished repository.* Before any task that adds
repository write methods moves to `done`, grep for non-test callers of each; every
method with zero must either name an already-filed consumer task or get one filed
first.

**Standing obligation on AS-46 and AS-47**, written here because both will hit
this seam again: any *other* resource either screen creates inline gets its
endpoint filed as its own task **before** that screen's plan is written — not
built inside the screen task. Proposed for `CLAUDE.md` in §10.

---

## 4. Config and migration changes

**None, and that is asserted rather than assumed.**

- **No migration.** The `clients` table, its `CHECK`s, its `UNIQUE (freelancer_id,
  id)` and its `clients_owner_email` index all exist in
  `lib/db/migrations/0001-initial.js`. `SCHEMA_VERSION` stays `2`; `D2`'s "exactly
  two migrations" and `D3`'s "nine entity tables plus the ledger, five named
  indexes" are untouched. Adding a migration in this task is a finding.
- **No config key.** `test/config.test.js` pins `SCHEMA.length` at `11` and the
  `INVOICING_`-prefixed subset at `10`; both stay. Verified: nothing in the
  design reads a setting. `clientRoutes(config, { repos })` takes `config` for
  signature symmetry with its neighbours and never reads it — the same
  disclosure `contractRoutes` and `invoiceRoutes` carry.
- **No dependency.** `express` 5 bundles the body parser; `package.json` and
  `package-lock.json` are untouched, and `dependency-policy.test.js`'s "exactly
  two direct dependencies" stays green.
- **No infrastructure.** `compose.yaml` and `Dockerfile` untouched;
  `COPY apps/invoicing/routes ./routes` (Dockerfile line 30) already carries the
  new file into the image. The `test` service stays `network_mode: none`
  (compose.yaml line 80). No running container is touched.

---

## 5. Key files, and every literal that moves

All greps below were run against `master` at `df65b57` **before** being written
down, from `apps/invoicing/`. Occurrence-accurate (`grep -oF … | wc -l`), never
`grep -c`.

### 5.1 Moving

**`test/dependency-policy.test.js`** — test `the scan examines exactly the files
it is supposed to — source, manifests, and nothing unclassified`:

| Literal | From | To |
|---|---|---|
| `assert.equal(source.length, 48` (1 occurrence) | `48` | `49` |
| the `source` array | — | insert `'routes/clients.js'` between `'routes/auth.js'` and `'routes/connect.js'` |

test `the concepts live exactly where AS-38, AS-39, AS-40, AS-41, AS-42, AS-43
and AS-44 put them`:

| Literal | From | To |
|---|---|---|
| `body parser` row allowlist (4 entries) | `['routes/auth.js', 'routes/contracts.js', 'routes/invoices.js', 'routes/webhooks.js']` | `['routes/auth.js', 'routes/clients.js', 'routes/contracts.js', 'routes/invoices.js', 'routes/webhooks.js']` |

Widening this row is the only way to mount a parser at all; what it guards — no
app-wide parser in `app.js` — is unchanged, and `app.js` is still not a member.
Extend the row's comment with one sentence saying AS-65 did so, matching AS-42's.

**`test/harness.test.js`**:

| Literal | From | To |
|---|---|---|
| `found.length, 15` (1 occurrence) | `15` | `16` |
| `expected exactly 15 test files` | `15` | `16` |
| `EXPECTED_TEST_FILES` | — | insert `'clients.test.js'` between `'auth.test.js'` and `'config.test.js'` |
| prose `these fifteen files ran` | `fifteen` | `sixteen` |

**`test/auth.test.js`**:

| Literal | From | To |
|---|---|---|
| `ALL_ROUTES` | — | insert `'POST /clients'` between `'GET /tokens.css'` and `'POST /connect-stripe/start'` |
| G1 `found.length, 15` (1 occurrence) | `15` | `16` |
| G1 message `expected exactly 15 routes` | `15` | `16` |
| G1b `found.length, 14` (1 occurrence) | `14` | `15` |
| G2's inline `protectedRoutes` array | — | insert `'POST /clients'` between `'GET /connect-stripe/return'` and `'POST /connect-stripe/start'` |
| G3 `protectedRoutes.length, 10` (1 occurrence) | `10` | `11` |
| G3 prose, lines 826 and 831: `nine` (2 occurrences) | `nine` | `eleven` |
| G15 `discoverRoutes(app).length, 15` (1 occurrence, `test/auth.test.js:999`) | `15` | `16` |

The two `nine`s are an AS-42 residual (it moved the count to 10 and left the
prose at nine) — see §11. Sort position verified: `'POST /clients'` < `'POST
/connect-stripe/start'` because `l` < `o`.

**`app.js`** — one import and one mount, numbered `13.`, immediately after the
`contractRoutes` mount, with a banner comment in the house style stating: exact
path, shadows nothing, `{ repos }` alone and why, per-route body parser.

### 5.2 NOT moving — stated as a claim so a diff that touches them is a finding

- `lib/db/repositories/clients.js` — no new method, no signature change.
- `lib/db/migrations/*`, `lib/config.js`, `lib/db/errors.js`,
  `lib/auth/guard.js`, `routes/contracts.js`, `routes/invoices.js`.
- `test/config.test.js` (`SCHEMA.length` `11`, prefixed `10`), `test/db.test.js`,
  `test/repositories.test.js`, `test/deploy-shape.test.js` (verified: it
  enumerates no `routes/` path), `test/contracts.test.js`, `test/invoices.test.js`.
- `package.json`, `package-lock.json`, `Dockerfile`, `compose.yaml`.
- `dependency-policy.test.js` rows other than `body parser`. In particular
  **`routes/clients.js` must not appear in these, which constrains what you may
  write in it, comments included**:
  - **`money representation`** scans **RAW text** for `/amount|currency|money/i`.
    A comment saying "no payment amount is involved here" turns it red. Do not
    write those words in this file at all.
  - `console output` — no `console.*` in `routes/clients.js`.
  - `current user` — no `req.currentUser`; use `actingFreelancerId`.
  - `raw SQL`, `node:sqlite`, `random bytes`, `createHash`, `timingSafeEqual`,
    `escapeHtml`, `STRIPE_`, `platform: true`, `/webhook` — none of these may
    appear in the new file.
- Top-level protected markdown (`CLAUDE.md`, `README.md`, `PHILOSOPHY.md`,
  `agents.md`) — §10 records proposed wording; the metawork layer applies it.

---

## 6. Acceptance criteria

The task description's acceptance clause, verbatim:

> ACCEPTANCE: the description's shape holds; ownership is engine-enforced and a
> cross-tenant attempt returns the same answer as a nonexistent parent; at least
> one falsification recipe breaks a guard this task introduces, shown red once
> per the house technique (assert the mutation applied on disk and in the built
> image, predict executable case names that exist, restore, prove restoration by
> content hash plus git status --porcelain, rebuild before re-running); the test
> service stays network_mode: none; no new dependencies; no migration (the table
> exists); no protected top-level file edited; no running container touched.
> Complexity low.

1. `POST /clients` exists, is mounted below the auth boundary, is registered
   exactly once, and is the only route whose path starts with `/clients`.
2. A valid submission creates **exactly one** `clients` row for the session's
   freelancer and answers `303` with `Location` = the submitted `next` carrying
   `clientId=<new id>`, app-relative, carrying no identity.
3. The minted id is accepted by `POST /contracts` as `clientId` in the same
   session, and appears in `listByFreelancer` and `findByEmail`.
4. **The duplicate ruling holds:** a second submission with an email that already
   exists for that freelancer creates a **second, distinct** row; a byte-identical
   double submit creates **two** rows. Nothing converges, and no row is mutated.
5. A missing or blank `name` or `email`, and any unknown body field, answer `400`
   with a one-line `text/plain` body and create **nothing**. The route contributes
   no field allowlist of its own.
6. An absent `next`, or one `safeNext` refuses, answers `400` and creates
   **nothing** — validated before the insert.
7. Every accepted `next` composes to an app-relative `Location`, preserving a
   query string the caller supplied.
8. **Ownership:** a `freelancerId` in the query string is ignored and the row is
   the session's; a `freelancerId` in the body is a `400` that writes no row for
   anyone; and the minted id used by a *different* freelancer's session against
   `POST /contracts` answers `404`, byte-identical to a client that does not
   exist, writing nothing.
9. A body past the parser's limit answers with the parser's own status, via the
   router-level handler, and creates nothing.
10. `clientRoutes` is constructible from `{ repos }` alone; nothing on this path
    names Stripe in code or comments; a created client's `stripeCustomerId` is
    `null`.
11. The error taxonomy is exact in **both** directions: every class the route can
    throw is mapped, and every class it maps is reached by a case in this file.
12. Full suite green in `docker compose run --rm test`, 16 test files discovered,
    16 routes in the committed list, 49 app source files.
13. §7's five recipes each shown red once, with the assert-applied step, the
    exact failing set recorded, restoration proven, and a rebuild before the
    re-run. **F1 falsifies the ownership scoping; F1–F3 break guards this task
    introduces.**
14. §4's five "none" claims hold in the diff.

---

## 7. Falsification recipes

House technique, non-negotiable in each: back up → `trap` the restore on
`EXIT` → mutate → **assert the mutation applied on disk with an
occurrence-accurate grep on a marker the mutation introduces** → rebuild
(`docker compose build test`) → run → record the **exact** failing set → let the
trap restore → prove the tree with `git diff --exit-code` and `git status
--porcelain` → **rebuild again** → re-run green.

Run from `apps/invoicing/` inside `.worktrees/AS-65/`. Prefer a scratch copy
where the mutation permits it; where it does not, the in-place discipline above
is mandatory.

**Before running any recipe, verify every predicted case name exists** —
`grep -oF "<name>" test/clients.test.js | wc -l` must be `1` for each. A wider or
narrower failing set than predicted is itself a finding and goes in the review
comment.

Baselines below were measured on `master` at `df65b57`.

### F1 — the ownership falsifier (identity source) **[required by AC 13]**

Mutation: in `routes/clients.js`, let the body name the acting freelancer — the
mistake a plausible future author makes:

```js
const freelancerId = req.body?.freelancerId ?? actingFreelancerId(req);
```
(and destructure `freelancerId` out of `fields` so it does not hit
`assertKnownKeys`).

- Assert-applied: `grep -oF 'body?.freelancerId' routes/clients.js | wc -l` → `1`.
  Measured baseline: `grep -roF 'body.freelancerId' . --exclude-dir=node_modules
  --exclude-dir=vendor | wc -l` = **0** tree-wide, so the marker is unambiguous.
- Predicted red, exactly one: `L8: identity is the session's, and the minted id
  is inert for every other freelancer`.
- Predicted green: every other L case (none of them sends `freelancerId`), all of
  `auth.test.js`, all of `dependency-policy.test.js`. A narrow set is the point —
  it proves `L8` alone carries this property.

### F2 — the duplicate ruling

Mutation: in `routes/clients.js`, converge instead of creating — if
`repos.clients.findByEmail(freelancerId, fields.email)` returns a hit, redirect
to that id without inserting.

- Assert-applied: `grep -oF 'findByEmail' routes/clients.js | wc -l` → `1`.
  Measured baseline: `grep -roF 'findByEmail' routes/ | wc -l` = **0**.
- Predicted red, exactly one: `L3: a repeat submission creates a SECOND row —
  nothing converges, and both are findByEmail hits`.

### F3 — the return-path validation (open redirect)

Mutation: in `routes/clients.js`, drop the validation — use the raw field where
`safeNext(...)` was called, keeping the import so the file still parses cleanly.

- Assert-applied: `grep -oF 'safeNext' routes/clients.js | wc -l` → `1` (the
  import alone), down from `2`. Measured comparable baselines:
  `lib/auth/guard.js` = **1**, `routes/auth.js` = **2**.
- Predicted red, exactly two: `L6: a next that is absent or refused by safeNext
  is a 400 and creates nothing` and `L7: every accepted next composes to an
  app-relative Location that keeps the screen's own query`.
  - If `L7` stays **green**, that is a finding, not a relief: it means the
    `new URL(...).pathname` composition is silently absorbing what `safeNext` was
    supposed to refuse, and `L6` is the only guard. Record it either way.

### F4 — the route partition literals bite

Mutation: delete the `app.use(clientRoutes(config, { repos }));` line from
`app.js`, leaving the import.

- Assert-applied: `grep -oF 'clientRoutes' app.js | wc -l` → `1`, down from `2`.
  (Delete the line; never comment it out — `grep -oF` counts commented text.)
- Predicted red, exactly fifteen: `G1: the route walk finds the EXACT committed
  list — cardinality first`; `G1b: with NO webhook secret the surface is the same
  list minus the webhook route`; `G2: the public/protected partition is exact in
  BOTH directions`; `G3: every protected route's cookieless answer is
  ATTRIBUTABLE to the guard, not merely shaped like one`; `G15: the whole app is
  constructible and the boundary survives a rebuild`; and `L1`–`L9`, `L11`.
  (`G15` added in review cycle 1 — the roster named fourteen under a count of
  fifteen, and F4 observed fifteen. Same omission as §5.1's. See Findings F-5.
  **This count moves to sixteen once `L12` exists**, and F4 must be re-run.)
- Predicted green: `L10` (it constructs `clientRoutes` directly, not through the
  app), all of `harness.test.js`, all of `dependency-policy.test.js` (the file
  still exists and still mounts a parser).

### F5 — the composite FK is really what makes a minted id inert

Mutation: in `lib/db/migrations/0001-initial.js`, delete the composite FK clause
from the `contracts` table only.

- Assert-applied: `grep -oF 'REFERENCES clients (freelancer_id, id)'
  lib/db/migrations/0001-initial.js | wc -l` → `1`, down from a **measured
  baseline of 2** (contracts and invoices). Leave `UNIQUE (freelancer_id, id)`
  on `clients` alone — measured at **1**, and dropping it changes the mutation
  into a different one.
- Predicted red, exactly one: `X5: a contract whose client belongs to another
  freelancer is the composite FOREIGN KEY (787)` in `repositories.test.js`.
- Predicted green: `X4` (invoices, its FK untouched), `D2`, `D3` (table and index
  cardinality unchanged), and `L8` — whose cross-tenant half is refused earlier,
  by `lib/contracts/generation.js`'s owner check, which is AS-42's guard and not
  this one. If `L8` goes red, the design note in §3.5 is wrong and must be
  corrected before merge.
- Why it is here: this is the layer §3.5 leans on hardest, and until now it had
  engine-level *cases* (`X4`/`X5`) but no *recipe* proving they reach it —
  the gap AS-42's reviewer closed out of band. See §11.

---

## 8. Size and complexity

| Artefact | Estimate |
|---|---|
| `routes/clients.js` | ~90 lines, most of it the house's explanatory comments |
| `test/clients.test.js` | ~280 lines, 11 cases (`L1`–`L11`) |
| `app.js` | +~12 lines (import + mount + banner) |
| 3 existing test files | ~11 literal edits, listed exhaustively in §5.1 |

One new route, one new test file, no new dependency, no migration, no config key.
**Complexity: low** — confirmed, not inherited. The cost here is not the code; it
is getting the declared surface right, because two planners will read it cold.

---

## 9. Open questions, each with a default and a box

| # | Question | Default (in force unless changed) | Box / trigger |
|---|---|---|---|
| Q1 | `next` required, or defaulted like `routes/auth.js`? | **Required**; absent is `400` (§3.3) | Reversible by AS-46 or AS-47 if either screen finds a case where it cannot supply one. Changing it is one line and `L6`. |
| Q2 | Query-parameter name for the new id | **`clientId`**, matching the form field both consumers accept | AS-46 changes one constant if screen 4 needs another spelling. Decide before AS-46 moves to `planned`. |
| Q3 | Should this endpoint detect duplicates server-side and *not* create? | **No** (§3.2). The screens read `findByEmail` and decide. | Re-opens only if AS-46 or AS-47 demonstrates it cannot render `S{4,6}-CLIENT-ERROR-DUPLICATE` without a non-creating round trip. The fix then is a **read on the screen's own route**, never a mode on this one. |
| Q4 | Email format validation | **Not in this task.** Filed separately; belongs in the repository (§3.4) | Filed at planning. Non-blocking for AS-46/AS-47. If it lands before them, `L4` gains a row and nothing else moves. |
| Q5 | Max length on `name` / `email` | **None** beyond the parser's 32kb / 20-parameter limits — AS-39 chose no ceiling and a route-level one is a second source of truth | Trigger: the first screen that must render these in fixed chrome. It then goes in the repository, with Q4. |
| Q6 | Parser limits | **`{ extended: false, limit: '32kb', parameterLimit: 20 }`**, byte-identical to `routes/contracts.js` rather than a third set of magic numbers | Only if a real body exceeds it. `extended: false` is correct: three flat fields, no nesting. |

---

## 10. Proposed metawork wording

Employees do not edit protected top-level files. Proposed for `CLAUDE.md`, under
**Lattice → Creating Tasks**, for the metawork layer to apply:

> **A repository method with no caller is an unowned endpoint.** When a
> resource's creation surface is split between a screen and a server, there are
> three obligations with three owners: the **row** (the repository task), the
> **endpoint** (a task of its own, filed when the repository task lands), and the
> **states** (the screen task). The endpoint is never inherited by "whichever
> screen gets there first" — two screens each assume the other carries it, and it
> is carried by neither. Mechanically: before any task that adds repository write
> methods moves to `done`, grep for non-test callers of each new method; every
> method with zero callers must either name an already-filed consumer task or get
> one filed first. This convention exists because `repos.clients.create` shipped
> in AS-39 with zero non-test callers and sat uncalled through six tasks while two
> consumers were built against it (AS-65).

---

## 11. Stale items found while planning

1. **`test/auth.test.js` G3 prose, lines 826 and 831, says "nine" where the
   assertion says `10`.** An AS-42 residual: it added `POST /contracts`, moved
   `protectedRoutes.length` to `10`, and left the two prose references at nine.
   This task moves the number to `11`; fix both words to `eleven` in the same
   edit (§5.1). Recorded rather than silently corrected so the reviewer knows it
   is deliberate and pre-existing.
2. **The claim "the composite FK is the layer nothing in the suite reaches" is
   partly stale.** Verified: `X4` and `X5` in `test/repositories.test.js` already
   reach it with raw INSERTs asserting `787`. What was genuinely missing is a
   *falsification recipe* proving those cases reach the FK rather than passing
   for another reason — that is `F5`, and it is why `F5` exists in a task that
   does not otherwise touch the migration.
3. **`repos.clients.update` and `repos.clients.listByFreelancer` still have zero
   non-test callers** after this task; `findByEmail` will still have zero until
   AS-46/AS-47 land. Under the §3.7 rule, `listByFreelancer` and `findByEmail`
   have named consumer tasks (AS-46, AS-47) and are fine. **`update` has none** —
   there is no client-edit surface anywhere in the screen budget. It is not a gap
   to fill here; it is a repository method the product does not use, and the
   right answer is either a filed task or a deliberate "unused, kept" note. Raised
   for the CTO, not actioned in this task.
4. **Email format validation is missing one layer down** (§3.4, Q4) — filed as
   its own task at planning time, by the same rule this task is about.

## Reset 2026-09-02 by agent:cto-owen

---

## Review Cycle 1 Findings

**Cycle 1 of 3.** Review by `agent:qa-ruben` (the `--role review` comment on
AS-65, 2026-09-02) — every measurement below is his, driven over real HTTP
against the built image; I have not re-measured them and I am not asking the
rework to re-derive them. Ruling and the four in-place corrections above are
`agent:cto-owen`'s. Routed `review → in_progress`: **implementation-level**. The
approach is right, no requirement is missing, and this plan's own AC 2 and AC 7
are what caught it.

### F-1 (blocking) — composition manufactures a protocol-relative `Location` out of a value the validator ACCEPTED

Reproduce: signed-in session, valid `Origin`, against the built image.

```
POST /clients   name=C&email=c@example.test&next=%2F.%2F%2Fevil.test
→ 303  Location: //evil.test?clientId=<the id just minted>
```

A browser resolves that as a network-path reference: the freelancer lands on
`http://evil.test` and the new client id goes with them in the query. Ten of
twenty-seven driven vectors escaped the app origin, in input syntaxes that all
collapse to the same output shape:

| `next` — `safeNext` **accepts** every one of these | `url.pathname` after composition | browser resolves to |
|---|---|---|
| `/.//evil.test` | `//evil.test` | `http://evil.test` |
| `/..//evil.test` | `//evil.test` | `http://evil.test` |
| `/%2e//evil.test` | `//evil.test` | `http://evil.test` |
| `/%2E%2E//evil.test` | `//evil.test` | `http://evil.test` |
| `/a/..//evil.test` | `//evil.test` | `http://evil.test` |
| `/.//user:pass@evil.test/x` | `//user:pass@evil.test/x` | `http://evil.test` (credentials) |
| `/.//evil.test:8080/x` | `//evil.test:8080/x` | `http://evil.test:8080` |
| `/.//evil.test/path?a=b#frag` | `//evil.test/path?a=b&clientId=…#frag` | `http://evil.test` |
| `/.//` | `//?clientId=…` | a `Location` that will not parse |

**The mechanism, and it inverts what both the implementer and I believed.** RFC
3986 §4.2 decides "is this a network-path reference" on the **raw** reference,
*before* §5.2.4 dot-segment removal. Emitted as-is, every vector above is
path-absolute and stays on the app origin — measured both ways on the same
values. `new URL(next, base).pathname` performs the removal and hands back
`//evil.test`, which **re-emitted standalone is** a network-path reference.

`safeNext` is not weak here. It correctly refused every protocol-relative,
absolute, backslash, scheme, CRLF, TAB and NUL **input** — all 400. The escape
did not exist in the input; the composition created it. So `landing()`'s comment
is true only of the word *absolute*; AC 2 and AC 7 require **app-relative**, and
the composition is what breaks that. Held and stayed app-relative through
composition: `/....//evil.test`, `/%2f/evil.test`, `/;/evil.test`,
`/.%2f/evil.test`.

`routes/auth.js` is unaffected — it emits `safeNext`'s output raw and never
composes. **Introduced by AS-65, not inherited from AS-40**, which also means the
precedent we departed from was already right.

### F-2 (blocking, same root) — `L7` named the property, passed, and covered none of it

Two recipes bracket it. `F3` (drop the `safeNext` call) left **`L7` green** — one
red, not the two §7 predicted. Ruben's own `F6` (make `landing()` emit
`//qaf6.invalid${pathname}${search}${hash}` for every request) turned **`L7`
red**, with `L1`. Together: `L7`'s four app-relative assertions are **sound**
(`F6` proves they fire) and `L7`'s **input set** is the gap (`F3` proves nothing
in it can reach the property). All four `L7` inputs are app-relative *before*
composition and stay so under any composition, correct or broken. `L6` covers
only what `safeNext` **refuses**. Nothing anywhere covers the third class —
**accepted by the validator, changed by normalization** — which is exactly the
class F-1 lives in.

**The general rule, which outlives this task.** *A passing case is evidence for
its property only if its input set can distinguish the property holding from the
property failing.* If every input yields the same verdict under both the correct
implementation and the plausible broken one, the case asserts something it
cannot observe and its green is decoration. Adding more cases in `L6`'s class
would have bought nothing — **the count was never the problem, the input set
was.** Therefore an input set is specified by *the discriminating inputs it must
contain*, never by a case count. Note the asymmetry that makes this hard to
catch: a vacuous case and a covering case are indistinguishable while green.
Only a red tells them apart — which is why the falsification recipe is not
bookkeeping, it is the measurement.

### F-3 (low; IN SCOPE this cycle) — `__proto__` is the one unknown body field that answers 303

`POST /clients name=a&email=b&__proto__=polluted` → **303**, row created, where
every other unknown field (`phone`, `Name`, `notes`, `contacts[0][name]`,
`constructor`, `__proto__[polluted]`) → 400. The key never reaches
`assertKnownKeys` because body-parser 2.3.0's `qs.parse` drops it. **No pollution
occurs**, verified across `__proto__=x`, `__proto__=x&__proto__=y` and
`__proto__[polluted]=1`: `Object.prototype` untouched, the parsed body's
prototype stays `Object.prototype`, and the spread's result likewise. Fails AC
5's literal wording in exactly one input; no row differs and nothing is bypassed.

**Ruling: in scope, as a pinned carve-out — not a fix.** It is five lines in a
file the rework is already opening, and deferring it leaves a known-false
acceptance criterion in a plan two UI planners read cold. The value of the pin is
as a canary on the dependency: the same body-parser version change is what made
§3.4's note stale, and a future bump that lets the key back into the parsed body
must turn the suite red rather than silently change behaviour.

### F-4 (record) — §3.4's prototype rationale is false on the shipped versions. **CORRECTED IN PLACE.**

Measured in the real image on express 5.2.1:
`Object.getPrototypeOf(req.body) === Object.prototype` is **true**, not
null-prototype. `assertPlainObject` does refuse a genuinely null-prototype
object, so the check works — it never fires here. **The conclusion (spread)
stands for its other, independent reason:** `next` must be split out or
`assertKnownKeys` rejects it. Nothing in the code rested on the false half; the
record did. §3.4's blockquote is rewritten above, and its "verify with a one-line
probe" instruction is replaced by the measurement.

### F-5 (record) — §5.1 omits `G15` and §7's `F4` roster is one name short. **BOTH CORRECTED IN PLACE.**

`test/auth.test.js:999` `G15` asserts `discoverRoutes(app).length` and is a
required moving literal (15 → 16); §5.1's table did not list it, though the diff
moves it correctly. §7 `F4` predicted "exactly fifteen" and then enumerated
fourteen names — the missing name is `G15`, the same omission twice. `F4`
observed fifteen. **The count was measured and right; the roster was reasoned and
short**, which is the whole argument for measuring rosters too. §5.1 now carries
the `G15` row; `F4`'s roster now names fifteen and carries its own move to
sixteen.

---

## THE RULING — binding, for this route and every route that composes a redirect

> **The bytes written to the `Location` header must be the exact bytes a
> validator last accepted. Validation is the last step before emission, not the
> first step after parsing.**

One stated exception, so the invariant is true as written: `res.redirect` →
`res.location` runs `encodeurl` on the value. It percent-encodes; it never
inserts `/`, `:` or a control character, so it can only *remove* structural
meaning from a reference, never add it, and it cannot turn a path-absolute
reference into a network-path one. **No other transformation may run after the
validator.**

**Chosen: validate before AND after, with the after-check on the exact emitted
string.** Two `safeNext` calls, two distinct jobs, both reachable by a test:

1. **Before the insert, on the raw field** — unchanged from today. This is the
   **input contract**: an absent or refused `next` is a caller bug, answered
   `400`, and **no row is written**. AC 6 and `L6` keep their present meaning.
2. **After the insert, on the composed string, immediately before
   `res.redirect`** — new. This is the **security guarantee**: `safeNext`-clean ⇒
   begins with a single `/`, no `://`, no control characters ⇒ path-absolute per
   RFC 3986 §4.2 ⇒ resolved against the app's own origin, always.

Sketch, not prescription:

```js
const client = repos.clients.create(freelancerId, fields);
const composed = landing(returnPath, client.id);
if (safeNext(composed) === null) {
  throw new ValidationError('next', 'normalizes to a path this app will not redirect to');
}
res.redirect(303, composed);
```

**What this guarantees, stated as a property rather than a story:** the emitted
value passed the same predicate this app uses everywhere else for "a path we will
redirect to", and passed it *as emitted*. There is no inference standing between
the check and the header. That is precisely why it was chosen over the
alternatives below — this defect is an inference ("taking pathname back off
cannot emit an absolute URL") that stood in the place of a check, and every
alternative preserves some inference.

### Consequences I am ruling on explicitly, so the rework does not contort around them

- **A refusal at check 2 leaves the client row. Accepted.** The marginal cost is
  zero: this endpoint creates unconditionally by design (§3.2), so the same
  caller gets the same row with a benign `next`; the row is exactly what was
  submitted, fully formed, owned by the session's freelancer, and no external
  call was made. **The test must assert the row EXISTS (count 1), not that it
  does not** — an implementer who assumes "400 ⇒ no row" will move check 2
  somewhere it can no longer guarantee anything, which is how this defect
  happened the first time. §3.1's objection to nested creates does not apply:
  there the row is one the freelancer never asked for; here only the return trip
  failed.
- **Query-parameter order is not a contract.** The screens read `clientId` out of
  the query. If a fix changes where the parameter lands, `L7`'s expected strings
  may be updated; the assertion that must not weaken is
  `getAll('clientId').length === 1`.
- **Both checks answer `ValidationError: create\n`.** Identical bodies,
  deliberately — the taxonomy maps by class, never by text (§3.6). **Which guard
  fired is distinguished by the row count**, which the tests already assert.
- **`lib/auth/guard.js` does not move** (§5.2). `safeNext` refused every hostile
  *input*; it is not the defective layer, it is shared with sign-in, and widening
  it to anticipate a normalizer that only this route runs would put AS-65's
  problem in AS-40's file.

### Candidates rejected, and what each one actually guarantees

| Candidate | What it actually guarantees | Why rejected |
|---|---|---|
| **Append to the raw string**, delimiter chosen by inspecting it (`next + (next.includes('?') ? '&' : '?') + 'clientId=' + encodeURIComponent(id)`) | Genuinely sound: the emitted value differs from a validated string by an insertion that preserves all four `safeNext` predicates. `encodeURIComponent`'s output plus `?`/`&` contains no `/`, `:` or control character, so no new `://` can be formed (a straddling triple would need a character the insert cannot supply) and the first two characters are unchanged. | It is a **proof, not a check** — one inferential step, and inference is exactly what failed here. It also has to hand-roll what the parser was doing: the parameter must go **before** the fragment (naive append puts `clientId` inside `#…`, where the server never sees it), and a stale `clientId` from a previous round trip must be **replaced**, not duplicated (`L7` case 4) — which means splitting the query by hand. Rejected: it removes the parser from the trusted path at the price of re-implementing it. |
| **Validate only after composition** (drop check 1) | The same output property as the chosen shape. Not weaker on security. | It **silently rewrites refused input**: `https://evil.test/x` and `//evil.test/x` normalize to `/x` and would answer `303`. A caller bug becomes an invisible rewrite, `L6`'s refusals become acceptances, the endpoint stops telling AS-46/AS-47 that they built `next` wrong, and every one of those writes a row. Rejected on the input contract, not on safety. |
| **Validate both, requiring the two to AGREE as strings** (normalization must be a no-op: `url.pathname === next.split('#')[0].split('?')[0]`) | Strictly more than the chosen shape: that the parser changed nothing about the path — path fidelity on top of origin safety. | Adds **no security property**: any escape must show up as a `safeNext` refusal of the output, because `safeNext`-clean ⇒ path-absolute ⇒ same-origin. What it adds is a **second definition** of "a path this app will redirect to", differently shaped from `safeNext`, whose failure mode is refusing legitimate input (`/a/../b`; and query re-serialization, where `?a` → `?a=`). A second source of truth that 400s real screens is how a check gets weakened under integration pressure — §3.4's argument, applied to itself. Rejected. Note the chosen shape *is* "validate both" in the useful sense: **the same validator, on both ends of the step.** |
| **Move the id out of the URL** (session flash, or a response body) | The strongest structural property: composition ceases to exist and the `Location` is `safeNext`'s output verbatim, exactly like `routes/auth.js`. | A response body has no consumer — `303` means the browser follows the redirect and never renders it, and the screens are server-rendered with no client-side JS (§3.3). A session flash introduces server-side state with its own lifecycle: when is it consumed, what happens with two tabs, what happens on the double submit §3.2 explicitly permits. It also moves `lib/auth/session.js`, which §5.2 says does not move. Rejected: it trades a three-line check for a stateful mechanism with concurrency semantics, in a task whose complexity is *low*. **Recorded, not dismissed** — if a future route must hand back more than an id, this is the shape to revisit, as a task of its own. |

---

## What the rework must include, beyond the code change

**1. A new case `L12`, whose input set spans the discriminator.** Not an
extension of `L7` — `L7` keeps its four cases as the regression on query
preservation, fragment placement and set-not-append. `L12` carries all three
normalization classes in one case, cardinality asserted first, every input driven
over real HTTP against the built app (**not** by calling `landing()` directly:
the defect lives in the value that reaches the header):

| Class | Inputs (minimum) | Required answer |
|---|---|---|
| **(a) accepted by `safeNext`, normalization makes it hostile** | `/.//evil.test`, `/..//evil.test`, `/%2e//evil.test`, `/%2E%2E//evil.test`, `/a/..//evil.test`, `/.//user:pass@evil.test/x`, `/.//evil.test:8080/x`, `/.//evil.test/path?a=b#frag`, `/.//` | `400`, one-line `text/plain` body, **no `Location` header**, and **exactly one row per input** — the accepted cost, pinned |
| **(b) accepted, normalization changes it, result benign** | `/a/../invoices/new`, `/invoices/./new` | `303` to the **normalized** path carrying `clientId`, one row |
| **(c) accepted, normalization changes nothing** | at least one plain path — the control | `303`, one row |

**Class (b) is not optional, and it is why this is a list of classes rather than
"add hostile inputs".** Without it, "refuse anything normalization touched"
passes `L12` — and that is a different, more brittle ruling than the one above
(third rejected candidate). Class (b) is the input that tells the chosen
implementation apart from that one. Class (c) is what tells a working route apart
from one that refuses everything.

**2. `__proto__` pinned in `L5` as a documented carve-out — and the pin must
assert the safety property, not just the status.** A row pinning only "303" would
stay green if a future body-parser reintroduced the key into the parsed body,
which is the exact failure it exists to catch — it would be vacuous in precisely
the way F-2 is about. Assert all three: the request answers `303`, **and**
`Object.prototype` is unpolluted afterwards, **and** `constructor` and
`__proto__[polluted]` still `400`. `test/webhooks.test.js:589` (AS-44's
inherited-key list, cardinality first) is the in-house shape to follow. **No
route-level field allowlist** — §3.4 refuses it and that refusal stands.

**3. The recipes.** §7's discipline applies unchanged (assert applied on disk
*and* in the built image, occurrence-accurate `grep -oF … | wc -l` and never
`grep -c`, predicted case names verified to exist first, restore, prove
restoration, rebuild before re-running). Two additions and one correction:

- **Each recipe must assert on a marker string the mutation INTRODUCES, with a
  measured tree-wide baseline of 0 — not on a decrease in the `safeNext` count.**
  Measured on `feat/AS-65-clients` at `4762eb2`, from `apps/invoicing/`:
  `grep -roF 'safeNext(' . --exclude-dir=node_modules --exclude-dir=vendor | wc -l`
  = **5** (`lib/auth/guard.js` 1, `routes/auth.js` 1, `routes/clients.js` 1,
  `test/auth.test.js` 2). After the fix `routes/clients.js` holds **two** call
  sites, so "2 → 1" no longer identifies *which* one was removed, and a recipe
  that cannot name its own mutation is not a measurement. Baselines measured for
  the marker convention: `grep -roF 'AS65MUT' …` = **0**;
  `grep -roF 'const returnPath = next;' …` = **0**.
- **`F3a` — drop check 1** (the input validation): use the raw field where
  `safeNext(next)` was called. **Predicted red: `L6` alone.** `L12` stays green,
  and that is the point — check 2 still catches class (a) whether or not check 1
  ran. Observing `L12` red here would mean the two checks are not independent and
  is a finding.
- **`F3b` — drop check 2** (the output validation). **Predicted red: `L12`
  alone**; `L1`, `L6`, `L7` stay green. This is the recipe that proves the fix is
  load-bearing: if `L12` does not redden, the fix is not what catches the defect.
- **Ruben's recommendation that a re-run of `F3` should redden BOTH `L6` and
  `L7` is superseded.** With two independent guards, a recipe that removes one
  must predict only that guard's cases. A wide predicted set would hide which
  check carries which property — the same conflation that produced this defect.
- **`F4` must be re-run**, because its predicted roster changes: add `L12`, and
  `G15` per F-5. Its count moves **15 → 16**. A roster carried forward on paper
  is a reasoned baseline and §7 takes measured ones.
- **`F1` and `F2` re-confirmed** — they mutate `routes/clients.js`, which the
  rework edits; their markers and predicted sets (`L8`, `L3`) are unchanged.
  **`F5` need not be re-run**: it mutates `lib/db/migrations/0001-initial.js`,
  which the rework does not touch, and its predicted set (`X5`) is unaffected.

**4. Correct `landing()`'s comment in `routes/clients.js`.** The claim that
taking `pathname+search+hash` back off makes the emission safe is the false
belief this cycle exists to remove; it must not survive in the file that carries
the fix. State instead what check 2 guarantees and why check 1 does not suffice.

**5. Acceptance criteria amended.** §6 is not rewritten; these amendments govern
where they differ:

- **AC 2 and AC 7:** every `Location` this route emits passed `safeNext` **as
  emitted**; a `next` that `safeNext` accepts but normalization turns hostile
  answers `400` and leaves **exactly one** row; a `next` whose normalization is
  benign redirects to the **normalized** path.
- **AC 5:** every unknown body field **that reaches the parsed body** answers
  `400` and creates nothing; `__proto__` is dropped by the parser before the
  route sees it, answers `303`, and is pinned in `L5` together with a
  no-pollution assertion.
- **AC 6:** unchanged, and must stay literally true — an absent or
  `safeNext`-refused `next` is `400` with **no row**.
- **AC 13:** now requires `F3a` and `F3b` each shown red, with the narrow
  predicted sets above, plus the re-runs named in item 3.

---

## Out of scope for cycle 2 — stated so the rework does not grow

1. `lib/auth/guard.js`, `safeNext` itself, and `routes/auth.js`. The precedent is
   correct and this defect is local to AS-65.
2. Any route-level field allowlist, any change to `assertKnownKeys`, any
   body-parser option change.
3. Email format validation (§9 Q4) — still its own filed task.
4. The duplicate ruling (§3.2), the repository, migrations, config keys,
   dependencies, `compose.yaml`, the `Dockerfile`.
5. Any screen, view, template or `GET` route — AS-46's and AS-47's.
6. `repos.clients.update`'s zero non-test callers (§11 item 3). Mine to answer,
   not this cycle's.
7. The honest limit Ruben recorded against `L11` direction 2 — the reachable
   status set is pinned from three chosen requests rather than proven exhaustive.
   Recorded, not charged, not this cycle.
8. Moving the id out of the URL (fourth rejected candidate). If it is ever right,
   it is a task.
9. Protected top-level markdown. §10's proposed `CLAUDE.md` wording is still the
   metawork layer's to apply.

Ruled by `agent:cto-owen`, 2026-09-02.
