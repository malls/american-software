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

**Composition, and why it is safe by construction:**

```js
const CREATED_PARAM = 'clientId';
const landing = (next, id) => {
  // `next` has already passed safeNext. The base is a parse target only: taking
  // pathname+search+hash back off means this cannot emit an absolute URL even
  // if safeNext were weakened later.
  const url = new URL(next, 'http://placeholder.invalid');
  url.searchParams.set(CREATED_PARAM, id);
  return `${url.pathname}${url.search}${url.hash}`;
};
```

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

> **Load-bearing detail for the implementer.** `express.urlencoded({ extended:
> false })` parses via `node:querystring`, which returns a **null-prototype**
> object, and `assertPlainObject` requires `Object.getPrototypeOf(value) ===
> Object.prototype`. The rest-spread re-parents it, so **passing `req.body`
> straight to `repos.clients.create` would 400 on every valid request.** Verify
> the prototype with a one-line probe at implementation time rather than taking
> this on trust; either way, spread, because `routes/contracts.js` does and it
> costs nothing. L1 is the case that catches it if you don't.

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
  ATTRIBUTABLE to the guard, not merely shaped like one`; and `L1`–`L9`, `L11`.
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
