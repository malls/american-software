# AS-40: D1 v1: freelancer accounts — credentials, sessions, route guard (server)

Server-side account capability, chain link 1 ("freelancer signs up"). Sign-up and sign-in with locally stored credentials (password hashing from the platform's own crypto primitives — no new dependency), session issuance and validation, a currentUser context for downstream handlers, and a route guard that every authenticated endpoint uses.

IMPLEMENTS: docs/engineering/00-d1-v1-milestone-plan.md section 3 row C-07 (IN — Rule 1, chain link 1). The screen that drives it is row C-08 and belongs to the onboarding-UI task.

DECISION CONTEXT. This is deliberately split from its screen so the server half is not blocked behind wireframes — see the milestone plan section 8.1 on how the UI and non-UI halves interleave, and section 8.4's ready-queue simulation, which depends on splits like this one. NO EMAIL IS INVOLVED: email verification, magic links, and password reset are OUT of v1 (row C-09, Rule 1, and independently Rule 3 — they need an ESP account and a sender domain, and the product has no name yet, per docs/strategy/09-company-name.md section 8.2, which extends "public-facing artifact" to sender-domain configuration). A v1 freelancer who forgets their password is a support case, not a feature; that capability returns with the email milestone (milestone plan section 6.2).

VERIFICATION: unit and HTTP-level tests — sign-up creates a user; sign-in issues a session; a guarded route rejects an absent, invalid, or expired session; credentials are never stored or logged in plaintext. No accounts, no network.

NOT IN THIS TASK: the sign-up/sign-in screen; password reset or any outbound email (out of v1); OAuth or social login (not a capability row — a v1 that needs no ESP needs no external identity provider either, and adding one would be a Rule-3 account); roles, teams, or multi-seat (row C-50, OUT).

---

**Planner:** Owen Kessler (`agent:cto-owen`), as tech lead. **Implementer:** Lena Fischer
(`agent:developer-lena`). Planned 2026-09-02 against master at `886c2b0`.

### Evidence gathered while planning (measured on master at `886c2b0`, not recalled)

Everything below was run, not remembered. The container measurements ran in the
real image (`docker compose run --rm --build --entrypoint node test`), which is
`node:24.20.0-slim`, `linux/amd64`, under QEMU emulation on an arm64 host — so
the timings are an **upper bound** on native amd64, which is the honest direction
for a budget check.

| # | Measurement | Result |
|---|---|---|
| E1 | `scrypt` N=16384, r=8, p=1, keylen=32, 5 runs, in the image | times `[39,39,39,40,46]` ms, **median 39 ms** |
| E2 | `scrypt` N=32768, same, in the image | times `[76,76,77,81,85]` ms, **median 77 ms** |
| E3 | `scrypt` N=32768 with Node's **default** `maxmem` | **throws `ERR_CRYPTO_INVALID_SCRYPT_PARAMS`** (128·N·r = 32 MiB exceeds the 32 MiB default) |
| E4 | express version in the image; router introspection | `5.2.1`; `app.router` **exists**, `app._router` does **not**; a recursive walk of `.stack` yields `{methods, path}` for routes in the app and in mounted sub-routers, and names bare middleware via `layer.name` (`serveStatic` for `express.static`) |
| E5 | `res.cookie(n,v,{httpOnly,sameSite:'lax',secure:false,path:'/',maxAge:1209600000})` | emits exactly `invoicing_session=TOKEN123; Max-Age=1209600; Path=/; Expires=<http-date>; HttpOnly; SameSite=Lax` — **both** `Max-Age` and `Expires`, in that attribute order |
| E6 | `res.clearCookie(n,{httpOnly,sameSite:'lax',path:'/'})` | emits `invoicing_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax` — **no** `Max-Age` |
| E7 | `req.cookies` without cookie-parser | **absent** (`'cookies' in req === false`); `req.headers.cookie` carries the raw string |
| E8 | `grep -rl` over `apps/invoicing` (excl. `node_modules`) for `scrypt`, `pbkdf2`, `randomBytes`, `createHash`, `req.currentUser`, `res.cookie`, `clearCookie`, `headers.cookie`, `requireSession`, `loadSession`, `SameSite`, and the literal `/signin` | **zero files each — every one of these is a baseline of 0** |
| E9 | `grep -c timingSafeEqual lib/webhooks/signature.js` | **4** (lines 40, 72, 158, 163 — two are comments). *Cycle-1 re-measure: **4 [occ]** too — line and occurrence counts coincide here, verified rather than assumed (F9)* |
| E10 | `grep -c createHmac lib/webhooks/signature.js` | **2** (lines 40, 155). *Cycle-1 re-measure: **2 [occ]** — coincides, verified (F9)* |
| E11 | `grep -c resolveFreelancerId` in `routes/connect.js` / `routes/invoices.js` | **2** / **2** |
| E12 | `grep -c 'AS-40 OBLIGATION'` in `routes/connect.js` / `routes/invoices.js` / `README.md` | **1** / **1** / **1** |
| E13 | `grep -c 'freelancer='` in `test/invoices.test.js` / `test/connect.test.js` | **39** / **20** |
| E14 | `grep -c 'express.static' app.js`; `grep -c 'app.use' app.js` | **2** (line 79 comment, line 86 code); **7**. **⚠ CYCLE-1 CORRECTION (finding R4): these are MASTER LINE counts and are not invariants of the changed app.** `app.use(` is **11 [occ]** in the worktree at `ff5aae1` and **12** once finding R1's second mount lands. F6/F10 quoted the 7 as a post-change invariant, which made their assert-applied step unrunnable. **No §7 recipe may cite this row**; re-measure with `grep -oF … \| wc -l` in the tree the recipe runs against |
| E15 | `console.` sites in app source (excl. `test/`) | exactly 5 lines in 3 files: `server.js` (28, 38), `lib/invoices/lifecycle.js` (334), `lib/webhooks/receiver.js` (70, 80) |
| E16 | `wc -l test/invoices.test.js` | **1,180** — the 1,200-line cap leaves **20 lines** of headroom. This is the tightest literal in the task |
| E17 | Autoindex derivation from `0001-initial.js` | 13 today = freelancers 1 + connected_accounts 3 + clients 3 + contracts 1 + invoices 2 + invoice_line_items 2 + stripe_events 1 + schema_migrations 0 (INTEGER PK is a rowid alias) |
| E18 | `grep -rc 'freelancer='` and `grep -rc resolveFreelancerId` over every `*.js` in the app | `freelancer=` : **63 lines in 5 files** — `test/invoices.test.js` 39, `test/connect.test.js` 20, `routes/invoices.js` 2, `routes/connect.js` 1, **`test/webhooks.test.js` 1** (line 784, driving AS-43's send route). `resolveFreelancerId` : **12 lines in 4 files** — `test/connect.test.js` 7, `routes/connect.js` 2, `routes/invoices.js` 2, `lib/invoices/mapping.js` 1 (a comment). `lib/connect/onboarding.js` scores **0** on the first grep because it builds the parameter with `searchParams.set('freelancer', …)`, not a literal — a token-shaped search would have missed it |

---

## §0 The four things this task decides that nothing else can

Collected up front because each is a decision with a stated basis, and each has a
falsification recipe in §7.

1. **scrypt, not pbkdf2**, at N=16384 / r=8 / p=1 / keylen=32, salt 16 bytes,
   `maxmem` passed explicitly (§3.2).
2. **A server-side session row**, not a signed stateless token — which makes this
   task carry migration **0002** (§3.3, §4.2).
3. **`SameSite=Lax` plus a same-origin check on unsafe methods**, and no CSRF
   token in v1 (§3.6).
4. **The guard is positional, and its reachability is proven by enumerating the
   built app's routes**, not by reading `app.js` (§3.5).

And one thing this task deliberately does **not** add: **a config row.** The
design needs no secret. `test/config.test.js:37` and `lib/config.js:34–35` both
predict `SESSION_SECRET`; both predictions are wrong and are corrected here
(§11). One fewer secret is one fewer thing to leak, one fewer board-gated
handover step, and zero movement in `test/deploy-shape.test.js`.

---

## §1 Scope

### 1.1 In scope

1. **Credential storage.** A `credentials` table (1:1 with `freelancers`), a
   repository for it, and `lib/auth/password.js` — hash, verify, and a
   self-describing encoded form that carries its own parameters.
2. **Sessions.** A `sessions` table keyed by the SHA-256 of the cookie token, a
   repository for it, and `lib/auth/session.js` — mint, digest, read the cookie
   off a request, set and clear it with the flags decided in §3.4.
3. **The accounts service** (`lib/auth/accounts.js`): `signUp`, `signIn`,
   `signOut`, `resolveSession`. Every rule about who may sign in, and what a
   failure says, lives here — not in a route.
4. **Three middlewares and one accessor** (`lib/auth/guard.js`): `loadSession`
   (populates `req.currentUser`, never rejects), `requireSameOrigin` (the CSRF
   defence on unsafe methods), `requireSession` (the boundary), and
   `actingFreelancerId(req)` (the only sanctioned way for a handler to learn who
   it is acting for).
5. **`routes/auth.js`**: `POST /signup`, `POST /signin`, `POST /signout`.
6. **The seam replacement.** `resolveFreelancerId` is **deleted** from
   `routes/connect.js`; `routes/invoices.js` stops importing `routes/connect.js`;
   the `?freelancer=` parameter is deleted from both routers, from their redirect
   targets, and from the `return_url`/`refresh_url` minted in
   `lib/connect/onboarding.js`. Both `AS-40 OBLIGATION` markers are removed.
7. **Migration `0002-accounts.js`** and its registration in `MIGRATIONS`.
8. **The mount order in `app.js`**, including moving `express.static` above the
   auth boundary (§3.5.3).
9. **Tests** (`test/auth.test.js`), plus the literal moves and cookie plumbing in
   `test/db.test.js`, `test/repositories.test.js`, `test/harness.test.js`,
   `test/dependency-policy.test.js`, `test/connect.test.js`,
   `test/invoices.test.js`, `test/config.test.js`.
10. **`apps/invoicing/README.md`**: the accounts section, the operator procedure
    for a forgotten password, the rate-limiting trigger, and the AS-45 handoff.

### 1.2 Not in scope (the description's NOT list, mirrored, plus who owns it)

| Not in this task | Owner / why |
|---|---|
| The sign-up / sign-in **screen** — `GET /signin` and its template | **AS-45** (row C-08). `/signin` **404s until AS-45 lands**, exactly as `/connect-stripe` has 404'd since AS-41 and `/invoices/{id}` since AS-43. The `Location` header is the contract, asserted without dereferencing it (§3.5.5) |
| Password reset, email verification, magic links, any outbound email | OUT of v1 by row C-09 (Rule 1) **and independently** by Rule 3. Returns at M3 (milestone plan §6.2) |
| OAuth / social login | Not a capability row; a v1 that needs no ESP needs no external IdP, and adding one is a Rule-3 account |
| Roles, teams, multi-seat | Row C-50, OUT |
| Password **change** while signed in | No capability row asks for one. Its absence is what makes §3.9's operator procedure the whole recovery story, and it is stated there rather than implied |
| Rate limiting / lockout | Decided **not in v1**, with a reason and two named triggers — §3.8. This is a decision, not an omission |
| An absolute session cap independent of expiry, and "sign out everywhere" | §3.3.4. Trigger: the first capability that changes a credential |
| A CSRF **token** in forms | §3.6. Trigger: the first form we do not render ourselves |
| A new `/healthz` check | §4.3, with the reason |

---

## §2 FILE-LEVEL SCOPE (explicit; lift this section mechanically)

**New (9 source + 1 test + 1 helper):**

```
lib/auth/password.js
lib/auth/session.js
lib/auth/accounts.js
lib/auth/guard.js
lib/db/migrations/0002-accounts.js
lib/db/repositories/credentials.js
lib/db/repositories/sessions.js
routes/auth.js
test/auth.test.js
test/helpers/auth.js          (test helper; not a *.test.js, not scanned)
```

Count check: **8 new files under the dependency scan's closed world** (everything
above except `test/auth.test.js` and `test/helpers/auth.js`, both under `test/`,
which is in `SKIPPED_DIRS`). That 8 is what moves the source-list literal from 35
to 43 (§5.4 item 2).

**Modified (19):**

```
app.js                                  mount order + the auth boundary
lib/config.js                           comment only (§11 item 1)
lib/connect/onboarding.js               routeUrl loses the freelancer parameter
lib/db/database.js                      register two repositories
lib/db/migrate.js                       one import + one array entry
lib/invoices/mapping.js                 comment only (§11 item 3) — one dangling reference
routes/connect.js                       delete resolveFreelancerId + the marker
routes/invoices.js                      delete the import + the ?freelancer= redirect helpers
routes/health.js                        comment only (§11 item 2)
test/harness.test.js                    13 -> 14
test/dependency-policy.test.js          source list, 1 split row, 6 new rows
test/db.test.js                         migration 2 literals
test/repositories.test.js               Z3 key list 7 -> 9
test/config.test.js                     comment only (§11 item 1)
test/connect.test.js                    cookie plumbing, R13 rewritten
test/invoices.test.js                   cookie plumbing (LINE CAP — E16)
test/webhooks.test.js                   4 places (E18) — see §5.4 item 12
test/health.test.js                     2 scaffold-PAGE cases sign in first
test/helpers/server.js                  re-export the session seed helper
apps/invoicing/README.md                accounts section + handoffs
```

**`test/health.test.js` is in this list as of review cycle 1 (finding R5).** The
plan originally listed it under "explicitly NOT touched", and that claim is
falsified: `GET /` and the unknown-path 404 live in that file and both now sit
behind the boundary, so those two cases sign in first. The four health checks and
`body.checks.length === 4` are untouched, which is the claim that actually
mattered. §4.3 is corrected to match.

**`test/webhooks.test.js` is in this list and it is easy to miss.** Line 784
drives `POST /invoices/{id}/send?freelancer=…` through AS-43's route to set up a
webhook case (measured: E18). It needs the same cookie treatment as the other two
suites. Everything else in that file is untouched.

**Explicitly NOT touched** (each is a claim, asserted by leaving it green):
`server.js`, `Dockerfile`, `compose.yaml`, `package.json`, `package-lock.json`,
`.dockerignore`, `lib/health.js`, `lib/stripe/*`, `lib/webhooks/*`,
`lib/invoices/lifecycle.js`, `lib/db/migrations/0001-initial.js`,
`lib/db/errors.js`, `lib/db/connection.js`, `views/`, `public/`,
`test/deploy-shape.test.js`, `test/assets.test.js`,
`test/stripe-client.test.js`, `test/stripe-mock.test.js`.
(`test/health.test.js` was on this list in cycle 1 and has been moved to
Modified above — the claim was false. A "NOT touched" entry is an assertion, so
a falsified one is a plan defect, not a bookkeeping slip.)

`server.js` staying untouched is worth its own sentence: `createApp(config, {
repos, stripe })` keeps both its arguments and its arity. The accounts service is
built **inside** `createApp` from `repos`, exactly as `connectRoutes` builds
`createOnboarding` inside itself. No new dependency reaches the entrypoint.

---

## §3 Design

### 3.1 What this is, in one sentence

A freelancer presents an email and a password once; from then on a random
128-bit-plus opaque token in an `HttpOnly` cookie names a row in `sessions`, and
one middleware turns that row into `req.currentUser` for every handler below the
boundary in `app.js`.

### 3.2 Password hashing

#### 3.2.1 Threat model, stated before the parameters

The realistic compromise is **offline**: someone obtains the SQLite file — a
leaked or mis-permissioned volume, a snapshot, a backup — and grinds the stored
values against a wordlist on their own hardware. The harm is account takeover
here **and** credential stuffing elsewhere, because freelancers reuse passwords.

The figure of merit is therefore **the attacker's cost per guess, per unit of our
cost per sign-in** — not "iterations", and not a citation of anyone's default.

Online guessing is a *different* threat and gets a different answer (§3.8).
Read the two together; neither is a substitute for the other.

#### 3.2.2 scrypt, not pbkdf2

Both ship in `node:crypto`, so neither adds a dependency and the description's
constraint is satisfied either way. The difference that decides it:

- **pbkdf2 is compute-hard only.** It maps almost perfectly onto GPUs and ASICs,
  where an attacker's parallelism is bounded by arithmetic units. Their advantage
  over our one server is enormous and grows with every hardware generation.
- **scrypt is memory-hard.** At N=16384, r=8 a single guess needs
  `128 · N · r ≈ 16 MiB` of working memory. An attacker's parallelism is then
  bounded by memory *capacity and bandwidth*, not by ALU count: a 24 GB card
  holds on the order of a thousand concurrent scrypt instances, against millions
  of PBKDF2 lanes. That ratio is the entire reason for the choice.

There is no third candidate. Argon2 is not in `node:crypto`, and reaching for it
is a dependency decision under the stack decision §11 — which this design avoids
entirely, and which is worth avoiding given AS-36 chose a two-dependency budget.

#### 3.2.3 The parameters, and why these

**Shipped default: `N = 16384 (2^14)`, `r = 8`, `p = 1`, `keylen = 32`, salt
`16` bytes, `maxmem` passed explicitly as `128 MiB`.**

- **Budget.** A sign-in is interactive; the accepted CPU budget for the KDF is
  **≤ 250 ms** on the deploy target. Measured (E1) at **39 ms** in the pinned
  amd64 image *under emulation*, i.e. an upper bound. There is >6× headroom.
- **Why not the next step up.** N=32768 measures 77 ms (E2) — also within
  budget — and doubles memory hardness. It is **not** chosen for one specific
  reason: at 32 MiB per guess it **exceeds Node's default `maxmem` and throws**
  (E3, measured: `ERR_CRYPTO_INVALID_SCRYPT_PARAMS`). That makes 2^15 a parameter
  set that only works while every call site remembers to pass `maxmem`. 2^14 is
  the strongest set whose failure mode under omission is *benign*. We pass
  `maxmem` explicitly anyway, so raising N later is a one-character change — but
  we do not ship a set that a forgotten argument turns into an outage.
  Time-boxed and revisitable: §9 Q1.
- **`p = 1`.** Raising `p` buys more of our CPU without raising the memory
  ceiling — it is the parameter that costs us most per unit of attacker cost.
  Raise N first, always.
- **`keylen = 32`.** 256 bits, matching the rest of this design's security level.
  64 is a habit inherited from other schemes and stores twice the bytes for
  nothing.
- **Salt 16 bytes** from `randomBytes`. 128 bits: precomputation across users is
  worthless and per-user collisions do not occur.
- **Async `scrypt`, never `scryptSync`.** `scryptSync` blocks the event loop for
  the full 39 ms, so N concurrent sign-ins serialise *and* stall every other
  request. The callback form runs on libuv's threadpool. This is a correctness
  property of a single-process server, not a style preference — it is pinned by a
  dependency-policy row that allows `scrypt` and forbids nothing else in that
  family (§5.4 item 4), and by review.

#### 3.2.4 How the parameters are recorded — and the upgrade path

The stored value is **self-describing**, so raising the parameters never
invalidates an existing account:

```
scrypt$N=16384,r=8,p=1,l=32$<salt base64url>$<derived key base64url>
```

Four `$`-separated fields; roughly 96 characters. `decodeHash` is **strict**: the
algorithm must be exactly `scrypt`, the parameter field must match
`^N=(\d+),r=(\d+),p=(\d+),l=(\d+)$`, and each value is bounded —
`N` a power of two in `2^10 … 2^20`, `r` in `1…32`, `p` in `1…16`, `l` in
`16…64`, **and `128·N·r ≤ 64 MiB`**. The bound is not decoration: without it a
row carrying `N=2^20,r=32` would ask the process for gigabytes on the next
sign-in. The row is not attacker-writable today; the bound removes the class
anyway, in four lines.

**Upgrade-on-login exists.** `verifyPassword(password, encoded)` returns
`{ ok, needsRehash }`, where `needsRehash` is true when verification succeeded
and the decoded parameters differ from the current default. `signIn` then
re-hashes the presented plaintext at the current default and writes it back —
one extra KDF, only on the first sign-in after a parameter change, and only for
accounts that need it.

This is included rather than deferred because without it, raising N helps only
new accounts and every existing one stays at the old cost forever — which means
the parameter choice would be effectively permanent, which is exactly what the
self-describing format exists to prevent. It is ~10 lines and one test (A11).

#### 3.2.5 Comparison, normalisation, and what is never trimmed

- Verification compares the derived key with **`timingSafeEqual`** after a length
  check. The timing channel here is weaker than in an HMAC verification — the
  attacker cannot choose the value being compared without inverting scrypt — but
  arguing that in a security boundary is exactly the reasoning that ages badly,
  and the constant-time primitive is free. Consequence: the shipped
  `webhook signature HMAC` dependency-policy row must be **split**, not loosened
  (§5.4 item 4; its non-weakening is proven by recipe **F9**).
- Passwords are **normalised to NFC** at both hash and verify. A password typed
  with combining characters on one platform and precomposed on another is the
  same password to the person typing it; without normalisation it is not the same
  password to us. Applied identically at both ends, forever — changing it later
  would invalidate every stored hash, so it is decided now and pinned by test A9.
- Passwords are **never trimmed**. A leading or trailing space is a character of
  the secret; trimming silently changes it. (Emails *are* trimmed, matching
  AS-39's `assertText` behaviour and the `lower(email)` unique index.)
- **Length: 8 ≤ len ≤ 256** characters, counted on the raw (un-normalised) string.
  The floor is the ledger's `S1-ERROR-VALIDATION` "short/empty password"; the
  ceiling bounds the one unauthenticated write endpoint's input alongside the
  body parser's own 8 KB limit (§3.7).

### 3.3 Sessions: a server-side row, not a signed token

#### 3.3.1 The decision, and what would have to be true for the other answer

A signed stateless token (HMAC over `{freelancerId, exp}`) would be the right
call if **either** of these were true:

1. the authentication path cannot reach shared storage, or
2. a per-request database read is too expensive.

Neither is true here. Every guarded route in this app already performs at least
one SQLite read on a local file with WAL enabled and a prepared statement; adding
a primary-key point lookup to that is not a measurable cost. So the stateless
form buys nothing it is designed to buy, and it costs the two things that matter:

- **Revocation.** With a row, sign-out is a `DELETE` and the session is *gone*.
  With a token, sign-out can only ask the browser to forget it; the token stays
  valid until it expires. Restoring real revocation means a denylist (a session
  table with extra steps) or a per-user token epoch read on every request (a
  database read on every request — the very thing the stateless form was for).
- **Testability of expiry.** A row with `expires_at` is expired by writing a past
  timestamp: one statement, no clock injection into a signature scheme. AS-49
  drives this end to end.

Two consequences follow, and both are recorded rather than discovered:
**this task therefore carries a migration** (§4.2), and **it needs no
`SESSION_SECRET`** — there is nothing to sign, so there is no secret to
configure, redact, hand over, or leak.

#### 3.3.2 The token and what is stored

- The cookie carries **32 random bytes** from `randomBytes`, base64url-encoded
  (43 characters, no percent-encoding needed — measured shape, not assumed).
- The database stores **`sha256(token)` as 64 lowercase hex characters**, and
  that digest **is** the primary key. A leaked database file therefore yields
  nothing usable: recovering a token from its digest is a preimage problem
  against a uniformly random 256-bit input.
- **A fast hash is correct here, and a slow one would be wrong.** The input is
  full-entropy, so there is no dictionary to iterate; the KDF's cost model
  applies to human-chosen secrets and to nothing else. Stating this so that a
  future reader does not "fix" the inconsistency between §3.2 and this paragraph.
- The lookup is an equality match on a primary key. There is no useful timing
  channel: what would leak is the *digest*, and knowing the digest does not
  produce the token.
- **The DDL enforces that the digest, not the token, is what got stored:**
  `CHECK (length(id) = 64 AND id = lower(id) AND id NOT GLOB '*[^0-9a-f]*')`.
  A 43-character base64url token fails on length. This is the single worst
  mistake available in this design, and the engine refuses it (recipe **F4**).

#### 3.3.3 Lifetime, renewal, and what an expired session does

- **Fixed absolute expiry of 14 days from issue. No renewal, no sliding window.**
- **Why 14 days.** It must comfortably exceed the longest gap the v1 loop itself
  imposes — the Stripe hosted-KYC detour in chain link 2, which can run from
  minutes to days while a freelancer gathers documents. A session that dies
  mid-KYC means Stripe's return redirect lands on sign-in, the return handler
  never runs, and the connected account is never readiness-synced (AS-41 §3.5).
  A fortnight of *inactivity* before re-entering two fields is not a burden for
  an invoicing tool.
- **Why no renewal.** Renewal makes every guarded `GET` a database *write* — WAL
  growth and a write lock on the read path — to buy convenience v1 does not need.
  Without it the guard is a pure read, and expiry is one timestamp comparison.
- **An expired session behaves exactly like an absent one**: the row is deleted
  by the request that finds it expired (so the table self-cleans on use), the
  cookie is cleared, and the request is treated as unauthenticated. Client-side
  the two are indistinguishable, which is also what the states ledger wants —
  `S{2..7}-DENIED-SIGNEDOUT` is a single state.
- **Bounded growth.** One row per sign-in, ≤ 14 days of them, plus an
  opportunistic `DELETE FROM sessions WHERE expires_at <= ?` on every successful
  sign-in. The `sessions_expires` index makes that sweep proportional to what it
  deletes. No scheduler, no background job, nothing to forget to start.

#### 3.3.4 Revocation, and what v1 does not have

`POST /signout` deletes the row: genuine revocation, immediately, for that
session. What v1 does **not** have, said plainly: no "sign out everywhere", and
no absolute cap beyond the 14 days. Both exist to bound a *stolen cookie*, and
both are cheap to add — but the capability that makes them necessary is
credential change, and v1 has none (§3.9). **Trigger:** the first task that lets
a credential change (M3's reset, or a password-change screen) must land
`sessions.deleteForFreelancer` and call it on the change, in the same task.
Recorded in the README so it is inherited, not rediscovered.

### 3.4 The cookie

| Attribute | Value | Why |
|---|---|---|
| name | `invoicing_session` | Namespaced like `INVOICING_*` and `apps/chat`'s `CHAT_*`; a bare `session` would collide with anything else served from `127.0.0.1` during development |
| value | the 43-character base64url token | never the digest, never an id |
| `HttpOnly` | **always** | nothing client-side reads it; the stack decision chose server-rendered EJS, so there is no script that could need it |
| `SameSite` | **`Lax`** | see below — this is the one attribute with a product-specific reason |
| `Secure` | **`config.appBaseUrl.startsWith('https:')`** | derived from a setting the app already validates as a bare origin. A loopback HTTP deployment gets no `Secure` (so the cookie works in every browser, including ones that do not treat `http://127.0.0.1` as trustworthy); the first HTTPS deployment gets it with **no new setting and no code change** |
| `Path` | `/` | the guard is app-wide |
| `Max-Age` | `1209600` (14 days), matching the row | a client-side hint only; `sessions.expires_at` is the authority, and a client that ignores it presents a token whose row has expired |

**`SameSite=Lax`, not `Strict`, and the reason is load-bearing.** Stripe's hosted
onboarding returns the freelancer by redirecting the browser to
`GET /connect-stripe/return` — a **cross-site top-level GET navigation**. Under
`Strict` the cookie is not sent on that navigation, the return handler sees no
session, readiness is never synced, and chain link 2 silently breaks. AS-41's
seam comment asserted that "a Stripe redirect is a top-level GET navigation and
carries session cookies" — that is true under `Lax` and false under `Strict`, and
this task is where the assertion is made real. Recipe **F5** breaks it in that
direction.

**Not using the `__Host-` prefix**, deliberately. It would force `Secure`
unconditionally, which conflicts with the loopback row above, and its guarantees
(`Path=/`, no `Domain`) are ones we set explicitly anyway. Its actual value is
that a *browser* enforces them against a sibling-subdomain attacker — and we have
no domain at all, because the product has no name (record 09 §8.2).
**Trigger:** the first HTTPS deployment on a real domain adopts `__Host-` in the
same task that configures the domain.

**Measured emission** (E5/E6), so the acceptance criteria assert a real string:
`res.cookie` emits `Max-Age` **and** `Expires`, attribute order
`Max-Age; Path; Expires; HttpOnly; SameSite`; `res.clearCookie` emits no
`Max-Age`. `clearCookie` is passed the *same* `httpOnly`/`sameSite`/`secure`/
`path` attributes as `cookie`, or a browser will not match the cookie it is meant
to remove.

**Reading it.** `req.cookies` does not exist — cookie-parser is not a dependency
and will not become one (E7). `readSessionToken(req)` parses `req.headers.cookie`
directly: split on `;`, trim, split each pair on its first `=`, take the **first**
match for our name (RFC 6265 leaves duplicate-name ordering to the client;
taking the first and saying so beats an unstated choice), `decodeURIComponent`
the value inside a try/catch — a malformed percent-escape is an absent token, not
a 500.

### 3.5 The route guard: reachability, not placement

AS-43's failed review turned on exactly this, so the property is asserted three
independent ways. Any one of them alone would be a promise.

#### 3.5.1 Layer 1 — the boundary is one line, in one place

`app.js` mounts `requireSession` **once**, with a comment banner naming it, and
everything mounted below it requires a session. The public layer is everything
above, and each member is public for a stated reason.

```
1. healthRoutes           public — must answer when everything else is broken;
                          compose's healthcheck sends no cookie
2. webhookRoutes          authenticated BY SIGNATURE, not by session (§3.5.4)
3. loadSession            never rejects; sets req.currentUser when a valid
                          session cookie is present
4. requireSameOrigin      CSRF defence on unsafe methods (§3.6)
5. assetRoutes            vendored bytes; identical for every caller
6. express.static         app-owned bytes; identical for every caller  ← MOVED
7. publicAuthRoutes       POST /signup, POST /signin — and NOTHING ELSE
── the auth boundary ─────────────────────────────────────────────────────────
8. requireSession
9. sessionAuthRoutes      POST /signout                        ← CORRECTED R1
10. pageRoutes, connectRoutes, invoiceRoutes, and everything added later
```

**CORRECTED, review cycle 1 (finding R1).** This table previously mounted one
`authRoutes` router at position 7 carrying all three routes, with a parenthetical
claiming `POST /signout` was "below the boundary". One Express router cannot be
on both sides of a middleware, so the table contradicted itself and contradicted
§3.7; the implementer followed the mount and §3.7 was right. `routes/auth.js`
therefore exports **two** factories, and the boundary keeps exactly one
mechanism: **position**. Every protected route is protected because it is mounted
below line 8 — no route is protected by per-route middleware, because a second
mechanism means "below the boundary" stops being a complete statement about what
is guarded, and a reader of `app.js` would have to open a router file to learn
which of its routes are exceptions. The split is cheap precisely because signout
shares nothing with the public pair: no body parser, no `statusFor` mapping, no
`renderSignIn` seam, no router-level error handler. Four lines and one export.

*What would have to be true for the other answer:* if signout shared the body
parser or the error handler with sign-up/sign-in, splitting the router would
duplicate them, and per-route `requireSession` on a single mount would be the
cheaper correct answer. It does not, so it is not.

#### 3.5.2 Layer 2 — the enumeration test is the actual proof

`app.js` is a document; the built app is the fact. `test/auth.test.js` walks the
constructed app's router tree (**E4**: `app.router`, recursive over `.stack`,
verified against express 5.2.1 in the real image) and:

1. asserts the discovered `(method, path)` list **equals a committed literal** —
   cardinality first, against an exact array, never `> 0`. This is the AS-31
   lesson: a walk that silently returned nothing would otherwise pass every rule
   below it on an empty set;
2. partitions that list against a committed `PUBLIC_ROUTES` array;
3. **drives a real cookieless HTTP request at every route in the protected
   partition** and asserts that **the guard answered it** — not merely that the
   response looks like a rejection.

**ATTRIBUTION, NOT APPEARANCE (added review cycle 1, finding R2).** Step 3 as
originally written asserted `303` + `Location: /signin`. That is a description of
what the rejection *looks like*, and any handler is free to produce the same
bytes — `POST /signout`'s success path does exactly that. A member whose expected
response is byte-identical to its own handler's success path is **vacuous**: it
stays green with `requireSession` deleted. The property that must hold is
therefore not "the response looks like a redirect to sign-in" but:

> For every route in the protected partition, the cookieless response is
> **attributable to `requireSession`**. Operationally: *if the guard's rejection
> changes, this route's response changes.*

Two mechanisms enforce it, and neither is optional:

- **In-suite (G3), a reference comparison.** The guard's canonical unsafe-method
  rejection is obtained from a path with **no registered route** below the
  boundary (e.g. `POST /__unrouted__` with a matching `Origin` and no cookie).
  Nothing serves it, so that response is *definitionally* the guard's. Every
  protected member's cookieless response is then compared against that reference
  on status, on `Set-Cookie` **count (zero)**, and on `Location` — exact for
  unsafe methods, and `/signin?next=<this route's own originalUrl>` for safe
  ones (G4's split, unchanged). The zero-`Set-Cookie` clause is the byte that
  discriminates the defect that shipped: the guard emits none, and signout's
  handler emits `invoicing_session=; …Expires=Thu, 01 Jan 1970…`.
- **In §7, a standing attribution recipe (F12).** The reference comparison
  narrows the hiding place but does not close it: a future handler that redirects
  to `/signin` **and** sets no cookie would still be indistinguishable. Only a
  mutation closes it, so QA's cycle-1 technique is promoted from a review
  technique to a recipe with a pinned predicted set — change the guard's
  rejection and **all nine** protected routes must move. Fewer than nine is a
  finding by definition; more than nine means a public route is being guarded.
  Re-run it whenever the protected partition changes.

A route added anywhere — in a new router, in an existing one, at any mount
position — changes the discovered list and turns (1) red. To make it green, its
author must classify it, and if they classify it public they must say so in a
committed array that a reviewer reads. There is no path from "someone added a
route" to "it is unprotected and nobody noticed".

Express internals are being read, which is normally a smell. It is acceptable
here for two measured reasons: express is pinned to an **exact** literal (5.2.1,
enforced by `dependency-policy.test.js`), and the cardinality assertion means a
future express whose internals moved produces a **red** test, never a vacuous
green one.

#### 3.5.3 Why `express.static` moves above the boundary

Today `express.static` is mounted last, so that a stray `public/` file cannot
shadow a vendored asset route. Below the boundary, every stylesheet request from
a signed-out browser would redirect to sign-in — and the sign-in page is served
to signed-out browsers by definition. Moving it now, rather than leaving AS-45 to
discover it, avoids exactly the "second edit that gets forgotten" shape this repo
already logged as AS-17.

The anti-shadowing property is preserved (`assetRoutes` still precedes it) and
the *new* risk the move introduces — a file in `public/` shadowing a registered
route path — is closed by an assertion in `test/auth.test.js`: no file in
`config.publicDir` has a basename matching any registered route path. The
existing `assets.test.js` decoy test (a planted `public/tokens.css` must lose to
the vendored route) is unaffected and stays green — a claim.

A consequence to state rather than leave implicit: **`public/` is world-readable
without a session.** Nothing per-user may ever be written there. Recorded in
`app.js`'s comment and in the README.

#### 3.5.4 The webhook route, which must not be behind the guard

`POST /webhooks/stripe` is authenticated **by its HMAC signature over the raw
body** (AS-44), by a caller that is Stripe's server, not a browser. It has no
cookie and no origin, and it must not have one. It stays mounted **second**, above
`loadSession`, so:

- the guard never sees it (the router handles the request and it never falls
  through), and no session lookup happens on a webhook delivery;
- `requireSameOrigin` never sees it either — which matters, because Stripe sends
  no `Origin` header and the check would reject every delivery (§3.6);
- nothing upstream of it parses a body, which is the property AS-44's signature
  verification depends on and which `dependency-policy.test.js`'s `body parser`
  row pins. `loadSession` reads only `req.headers.cookie` and never touches the
  body — but it is mounted *below* the webhook anyway, so the property is
  structural rather than argued.

Recipe **F6** moves the webhook mount below `loadSession`/`requireSameOrigin` and
predicts the exact set of webhook cases that go red.

#### 3.5.5 What the guard actually answers

| Request | Answer |
|---|---|
| `GET`/`HEAD`, no valid session | `303` to `/signin?next=<originalUrl>`. `/signin` **404s until AS-45**; the `Location` header is the contract |
| any other method, no valid session | `303` to `/signin`, **with no `next`** — a POST body cannot be replayed after a redirect, so offering to resume it would be a lie |
| valid session | `next()`, with `req.currentUser` already set by `loadSession` |

The `next` parameter carries the ledger's Flow 4 requirement ("signed in →
redirected to the **originally requested route**"). The reason copy
("Sign in to continue") belongs to the screen: AS-45 renders it whenever `next`
is present. One parameter, not two.

**Open redirect.** `next` is generated from `req.originalUrl` (server-side, safe)
but *consumed* from whatever the client sends back, so it is validated at
consumption by `safeNext(raw)`: accept only a string beginning with a single `/`,
rejecting `//` and `/\` (protocol-relative), any control character, and anything
containing `://`. On rejection, fall back to `/`. Recipe **F3** breaks this in
the direction it exists to catch.

#### 3.5.6 Layer 3 — a handler cannot quietly do without the guard

`actingFreelancerId(req)` **throws** when `req.currentUser` is absent, because
reaching a guarded handler without a session means a router was mounted above the
boundary — a wiring bug, which must be a loud 500, never a silent action taken as
nobody.

And a dependency-policy concept row (`current user`, §5.4 item 4) pins
`req.currentUser` to `lib/auth/guard.js` alone, so no route module may read it
directly and bypass the assertion. Baseline measured at **zero files** (E8), so
the row lands on an empty world and immediately becomes a used exemption.

### 3.6 CSRF

`SameSite=Lax` closes the classic cross-site form POST for every state-changing
route in the app. What it does **not** close, stated rather than glossed:

1. **Top-level cross-site `GET` navigations still carry the cookie** — that is
   the whole point of `Lax`, and it is required for the Stripe return (§3.4).
   `GET /connect-stripe/return` and `/refresh` are GETs that change state.
2. **`Lax` is a browser behaviour, not a server guarantee.** A client that
   ignores `SameSite` sends the cookie on a cross-site POST. At least one major
   browser has shipped a grace window in which a *freshly set* cookie is sent on
   cross-site POSTs.
3. **Login CSRF** — signing a victim's browser into an attacker's account —
   is not addressed by `SameSite` at all, because it targets the public routes.

Because the routes below the boundary finalize and send invoices on the
freelancer's own Stripe account, "mostly closed" is not the right posture.

**Decision: `SameSite=Lax` plus a same-origin check on every unsafe method
(`requireSameOrigin`), and no CSRF token in v1.**

- The check: for any method other than `GET`/`HEAD`/`OPTIONS`, require an
  `Origin` header whose **host** equals the request's `Host` header; if `Origin`
  is absent, fall back to `Referer`'s host; if **both** are absent, reject. Fail
  closed, with the house one-line `text/plain` and `403`.
- **Host, not `config.appBaseUrl`.** Tests (and any deployment on a non-default
  port) run on an ephemeral port, so comparing to `appBaseUrl` would reject every
  POST in the suite. Comparing the two headers is also the sounder check: a
  browser sets `Origin` honestly and cannot be made to lie about it by another
  origin's page, while a non-browser attacker who can forge both does not have
  the victim's cookie and is therefore not doing CSRF at all.
- **Host only, not scheme+host**, with the residual named: a same-host
  cross-*scheme* attacker is not caught. That attacker is an active network
  MITM, who has already won by other routes. Comparing schemes would additionally
  require `app.set('trust proxy', …)` the moment a TLS-terminating proxy appears,
  and would fail *closed on every POST in the app* until someone realised — a
  landmine in exchange for coverage of a threat we lose to anyway.
  **Trigger:** adopt scheme comparison together with `trust proxy` in the task
  that first puts TLS in front of this app.
- **Why not a synchronizer token.** A per-session token in a hidden field is the
  belt-and-braces answer, and it requires **every form template** — AS-45, AS-46,
  AS-47, AS-48, none of them planned yet — to render it. That is four
  cross-task obligations whose failure mode is a broken form discovered late.
  The origin check needs no cooperation from any template and no plumbing into
  any render context. **Trigger to add a token:** the first form submitted to us
  from a page we do not render (an SPA, a separate front-end origin, or an
  embedded widget).
- The check covers the **public** POSTs too (sign-in, sign-up), because it is
  mounted above them — which is what closes item 3, login CSRF.

Recipe **F2** disables the check and predicts the exact failing set; the positive
half (a POST with a correct `Origin` still works) is proven by every existing
route test, all of which will be re-issued through the new middleware.

### 3.7 Routes

Thin by test, like `routes/connect.js`, `routes/invoices.js` and
`routes/webhooks.js`: every rule lives in `lib/auth/accounts.js`, and this file
translates HTTP to service calls and error classes to statuses.

| Route | Public? | Body | On success |
|---|---|---|---|
| `POST /signup` | public | `displayName`, `email`, `password`, optional `next` | create freelancer + credential in **one transaction**, issue a session, set the cookie, `303` to `safeNext(next) ?? '/'` |
| `POST /signin` | public | `email`, `password`, optional `next` | verify, upgrade-on-login if needed, issue a session, set the cookie, `303` to `safeNext(next) ?? '/'` |
| `POST /signout` | **guarded** | — | delete the row, clear the cookie, `303` to `/signin` |

- **Body parsing is per route**, never app-wide — the AS-44 raw-body rule, and it
  adds `routes/auth.js` to the `body parser` concept row.
  `express.urlencoded({ extended: false, limit: '8kb', parameterLimit: 20 })`:
  `extended: false` because a credentials form has no nested structure, which
  keeps the parsed surface on the app's only unauthenticated write endpoint as
  small as it can be.
- **`POST /signout` needs no allowlist entry** — it is carried by a *second*
  router mounted below the boundary (§3.5.1), so it is guarded positionally, like
  every other protected route. "By construction" was the wording that let cycle 1
  ship it above the boundary: the phrase asserted the conclusion and named no
  mechanism, so nothing contradicted it when the mechanism was absent. It is a
  POST, not a GET, precisely because `Lax` sends cookies on top-level GET
  navigations and a `GET /signout` is trivially triggerable from a link.
- **What an unauthenticated `POST /signout` gets, and why it is not hostile.**
  Behind the guard it is `requireSession`'s ordinary unsafe-method answer:
  **`303` to `/signin`, no `next`, and no `Set-Cookie`.** Checked against what
  AS-45 will need: a user whose session expired clicking a stale sign-out button
  lands on the sign-in screen, which is where they were going anyway — the same
  destination the handler would have sent them to. The one behavioural difference
  is that their stale cookie is **not** cleared. That is deliberate and harmless:
  `loadSession` already resolves it to nothing (deleting the row if it is merely
  expired, per H10), and `setSessionCookie` overwrites it on the next successful
  sign-in. A guard that also mutates response state is a guard with a second job,
  and the absence of that second job is what makes its answer distinguishable
  from the handler's — see §3.5.2. The two properties are the same property.
- **Duplicate email is detected by the unique index, not by a pre-read.**
  `findByEmail`-then-`create` is a TOCTOU race with itself; `create` inside a
  transaction and catching `UniqueViolationError` is race-free and one branch
  shorter.
- **Failure bodies** use the exact house shape — `${err.name}: ${err.step}\n`,
  one line, `text/plain` — where an `AuthError`'s `step` **is** its stable code.
  No new convention, and the code is legible in the body.

| Code (`step`) | Status | Meaning |
|---|---|---|
| `invalid-credentials` | 401 | sign-in: unknown email **or** wrong password — one code for both, on purpose (§3.10) |
| `email-taken` | 409 | sign-up only |
| `invalid-email` / `weak-password` / `missing-field` | 400 | `S1-ERROR-VALIDATION` |
| `forbidden-origin` | 403 | `requireSameOrigin` |
| (body parser refusal) | its own | the `routes/invoices.js` precedent: a router-level error handler, same one-line shape |

- **The AS-45 seam.** Every failure is emitted through **one** function,
  `renderSignIn(res, view)`, whose v1 body is the one-line `text/plain` above and
  which carries an `AS-45 OBLIGATION` header comment: replace this body with a
  render of the sign-in template, preserving `email` and `next` and **never** the
  password (Flow 6). One function, one replacement point — the same idiom as
  AS-41's `resolveFreelancerId`, which worked, and which this task is now
  retiring on schedule.
- **Email validation is deliberately weak**: one `@`, non-empty local and domain
  parts, no whitespace, total length ≤ 254. We cannot verify an address exists
  (no ESP, by two independent rules), so the check exists only to catch typing
  mistakes; anything stricter rejects valid addresses and buys nothing.

### 3.8 Rate limiting and lockout: not in v1, with a reason and a trigger

**Decision: neither, in v1.**

The reason is the deployment shape, and it is a *test-asserted* fact rather than
a hope: `test/deploy-shape.test.js` pins `INVOICING_BIND=0.0.0.0` inside the
container against a host-side port map of `127.0.0.1:8348:8348`, and
`config.test.js` pins the app's own default bind to loopback. The v1 milestone
ends at AS-50, a **local** test-mode acceptance run; there is no deployment task
in the milestone at all. The unauthenticated surface is therefore reachable only
from the host running the container.

That matters here specifically because sign-in performs a deliberate ~39 ms /
16 MiB scrypt on **every** attempt including failures (§3.10 requires it), which
is a CPU amplification lever — for anyone who can reach the port.

An in-process limiter would also be the wrong tool if that changed: it is
ineffective against a distributed attacker, adds the app's first piece of
module-level mutable state (which `app.js`'s header comment currently forbids
outright), and needs eviction logic and its own tests.

**Two triggers, either of which makes it mandatory in the same task:**

1. the first task that serves this app on a non-loopback interface — i.e. the
   first real deployment — must land rate limiting on `POST /signin` and
   `POST /signup` before it ships;
2. any committed manifest setting `INVOICING_BIND`, or a published port, to
   something other than a loopback address.

Recorded in the README so the deploy task inherits it.

### 3.9 What a forgotten password means, operationally

Stated plainly because the task description asks for it, and because the honest
answer is unglamorous:

**There is no self-service recovery, and there is no password-change screen
either.** A freelancer who forgets their password contacts the operator. The
operator — someone with shell access to the container, which in v1 is the company
— computes a new encoded hash with the app's own function and updates the one
row:

```
docker compose exec web node --input-type=module -e \
  "import('./lib/auth/password.js').then(async m => console.log(await m.hashPassword(process.argv[1])))" -- '<temporary password>'
docker compose exec web node ... UPDATE credentials SET password_hash = ?, updated_at = ? WHERE freelancer_id = ?
```

The exact two commands go in the README, verbatim, because a procedure that is
only described is a procedure nobody can follow at 2 a.m.

Three consequences, said out loud rather than discovered:

1. the temporary password **is** the account's password from then on, because
   there is no change screen — the freelancer cannot rotate it;
2. it appears in shell history and the process list on the operator's machine;
3. it is a support case with no queue, no ticket and no audit trail beyond the
   `updated_at` column.

All three are acceptable at v1's scale (a handful of accounts, one operator) and
all three are resolved by the same M3 milestone that brings email — which is why
`hashPassword` is a pure, importable function with no server dependency, so the
procedure works today and the reset flow reuses it tomorrow.

### 3.10 Enumeration: what sign-in reveals, and what sign-up must

**Sign-in reveals nothing, and the answer is consistent across every failure
path.** The states ledger (`02-states-ledger.md` §1, `S1-ERROR-SYSTEM`) already
made this a design decision — "one deliberately generic message … to avoid
confirming which emails have accounts". This task makes it true on three axes:

| Axis | Unknown email | Known email, wrong password |
|---|---|---|
| status | 401 | 401 |
| body | `AuthError: invalid-credentials\n` | byte-identical |
| headers | no `Set-Cookie` | no `Set-Cookie` |
| **work done** | **one scrypt at the default parameters** | one scrypt at the stored parameters |

The last row is the one that is usually got wrong. On an unknown email the
service **still runs one `hashPassword(password)` at the default parameters and
discards the result**, so the two paths cost the same time and the same memory.
(Hashing the presented password against a fresh salt is simpler than maintaining
a dummy verification target, and costs exactly the same single KDF.)

Timing equality is not asserted by measuring wall-clock in the suite — that test
would be flaky and would eventually be deleted for being flaky. It is asserted
**structurally**: the accounts service takes its hasher through its factory, and
test A12 injects a counting hasher and asserts **exactly one** KDF invocation on
*both* paths. Recipe **F1** removes the discard-hash and predicts A12 alone going
red.

**Sign-up reveals, unavoidably.** `email-taken` is a 409 that names the conflict,
because a system with unique emails cannot accept a duplicate silently without
telling the person something. The ledger says so ("Sign-up names the conflict
plainly"). The standard mitigation — accept the sign-up and *email* the existing
account — **requires email, which v1 does not have, by the same two independent
rules that put password reset out of scope.** So the absence of email is what
forces this oracle; it is not an oversight and it is not fixable here. Accepted
residual, with the trigger recorded: M3 (§6.2) closes it.

---

## §4 Config / compose / migration / health

### 4.1 Config: **no row is added**

Nothing in this design needs a secret. The token is random rather than signed
(§3.3.1); the cookie name, the 14-day lifetime and the scrypt parameters are
constants, not knobs; `Secure` is derived from the already-validated
`appBaseUrl`.

Therefore, and asserted by leaving them untouched and green:
`SCHEMA.length` stays **11**; the secret list stays the two Stripe names;
`compose.yaml` is unchanged; `test/deploy-shape.test.js` is unchanged in every
literal (`env.length` 5, `secretShaped` 2, `COPIES.length` 9,
`IGNORE_PATTERNS.length` 6). Two comments that predicted otherwise are corrected
(§11 item 1).

Session lifetime is a constant rather than a setting for the usual reason: an
unconfigured constant is one fewer thing an operator can get wrong, and there is
no operator asking to tune it. **Trigger** to promote it to a SCHEMA row: the
first request from outside engineering to change it.

### 4.2 Migration `0002-accounts.js`

A migration is a decision, so here it is in full. **A new file, never an edit to
`0001-initial.js`** — AS-39's rule, restated at the top of that file.

```sql
CREATE TABLE credentials (
  freelancer_id TEXT PRIMARY KEY REFERENCES freelancers (id),
  password_hash TEXT NOT NULL CHECK (substr(password_hash, 1, 7) = 'scrypt$'),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
) STRICT;

CREATE TABLE sessions (
  id            TEXT PRIMARY KEY
                CHECK (length(id) = 64 AND id = lower(id) AND id NOT GLOB '*[^0-9a-f]*'),
  freelancer_id TEXT NOT NULL REFERENCES freelancers (id),
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL
) STRICT;
CREATE INDEX sessions_expires ON sessions (expires_at);
```

**Why a separate `credentials` table and not a column on `freelancers`** — two
reasons, the second of which is the important one:

1. `ALTER TABLE freelancers ADD COLUMN password_hash TEXT NOT NULL` needs a
   `DEFAULT`, and there is no honest default for a password hash. A 1:1 table
   makes "this freelancer has no credential" a *representable* state instead of
   an empty-string lie. (v1 never creates one — sign-up writes both rows in one
   transaction — but the schema should not require that to be true.)
2. **Blast radius.** `freelancers.getById`/`findByEmail` return a plain object
   that flows into route handlers and, from AS-45 onward, into render contexts.
   A hash on that table means the hash is in `COLUMNS`, in `mapRow`, and in every
   one of those objects. A separate repository whose read method has exactly one
   caller keeps the hash out of the freelancer row entirely — and that is a
   *structural, testable* property (AC 12), not a discipline.

`credentials.password_hash`'s `CHECK` prefix is the engine-level enforcement of
the description's "credentials are never stored … in plaintext": storing a
plaintext password is refused by SQLite, not by review (recipe **F7**). It
mirrors the schema's existing `substr(...)` prefix idiom for Stripe ids.

`sessions.id`'s `CHECK` is the same move for the other half — see §3.3.2.

No `ON DELETE CASCADE`: there is no delete path for a freelancer in v1, and the
schema uses `CASCADE` in exactly one place today (`invoice_line_items`), which is
where it belongs.

**Repositories** (`lib/db/repositories/credentials.js`, `.../sessions.js`) follow
the house shape exactly: module-level `(db, ctx, …)` functions, a snake→camel row
mapper, validation before any SQL, a frozen factory.

- `credentials`: `create(freelancerId, passwordHash)`,
  `updateHash(freelancerId, passwordHash)` (the upgrade-on-login writer),
  `getByFreelancer(freelancerId)` → row or **`null`** (absent is a normal state,
  like `findByEmail` — not a `NotFoundError`).
- `sessions`: `create({ id, freelancerId, expiresAt })`, `getById(id)` → row or
  `null`, `delete(id)`, `deleteExpired(nowIso)` → count.
  No `deleteForFreelancer` — §3.3.4's trigger adds it with the caller that needs
  it; an unused method is an unused exemption.
- Both are appended to `createRepositories` **after `stripeEvents`**, moving that
  object from seven keys to nine.

### 4.3 No new health check, and why

`lib/health.js`'s stated rule is that a check may only assert things that *can be
false while the process is still able to answer*. The two new tables are covered
by the existing `database` probe, which compares the schema version and now
expects **2**. An "auth is working" check would either restate that or assert
something tautological. **Four checks stay four, and `body.checks.length === 4`
is the claim** — that is what this section is entitled to assert. It previously
claimed the whole *file* was unchanged, which was false and is corrected in §2
(finding R5): the file also holds two scaffold-PAGE cases (`GET /` and the
unknown-path 404) that now sit behind the boundary and sign in first. No health
assertion moved.

### 4.4 No dependency decision is triggered

The stack decision (`01-stack-decision.md` §12) lists session and CSRF handling
as a known gap and notes "Express middleware is available for both, and each is a
§11 dependency decision on its own evidence." **This design adds no package**, so
no §11 evaluation is triggered at all — the strongest available answer to that
paragraph. `express-session`, `cookie-parser`, `csurf` and every equivalent are
not merely unused; they are unnecessary, and the reasons are in §3.3.1 and §3.6.
`package.json`, `package-lock.json` and `LOCK_ENTRIES` do not move.

---

## §5 Key files, and every committed literal that moves

### 5.1 New source files (one line each)

| File | Responsibility |
|---|---|
| `lib/auth/password.js` | `DEFAULT_PARAMS`, `hashPassword`, `verifyPassword` → `{ok, needsRehash}`, `encodeHash`, `decodeHash` (strict + bounded). The only file allowed `scrypt` and `timingSafeEqual` outside the webhook verifier |
| `lib/auth/session.js` | `COOKIE_NAME`, `SESSION_TTL_MS`, `mintToken()` → `{token, id}`, `tokenId`, `readSessionToken(req)`, `setSessionCookie`, `clearSessionCookie`. The **only** file that may set or read a cookie |
| `lib/auth/accounts.js` | `AuthError`, `createAccounts({ repos, now, hash })` → `signUp`, `signIn`, `signOut`, `resolveSession`. Every credential rule; the discard-hash on unknown email; the expiry comparison; the sweep |
| `lib/auth/guard.js` | `loadSession`, `requireSameOrigin`, `requireSession`, `actingFreelancerId`, `safeNext`, `SIGNIN_PATH`. The only file that names `req.currentUser` |
| `lib/db/migrations/0002-accounts.js` | `{ version: 2, name: 'accounts', up }` — §4.2's DDL |
| `lib/db/repositories/credentials.js` | 1:1 credential rows |
| `lib/db/repositories/sessions.js` | session rows and the expiry sweep |
| `routes/auth.js` | **two exported factories** (finding R1): `publicAuthRoutes` — `POST /signup`, `POST /signin`, the per-route body parser, `statusFor`, `renderSignIn` (AS-45 obligation) and the router-level parser-error handler; and `sessionAuthRoutes` — `POST /signout` alone, mounted below the boundary. One file, because they share the accounts service and the cookie helpers; two routers, because they sit on opposite sides of the boundary |
| `test/helpers/auth.js` | `seedSignedIn(repos)` → `{ freelancer, cookie }` — mints a session row directly, so `connect`/`invoices` tests pay no KDF cost |

### 5.2 Modified source files

| File | Change |
|---|---|
| `app.js` | the mount order in §3.5.1 — **twelve** `app.use(` calls, not eleven, because signout gets its own mount below the boundary (finding R1); `createAccounts` built here; `express.static` moved; the boundary banner comment; the `public/` is-public note. **The comment at the `publicAuthRoutes` mount must stop saying signout is "guarded by construction"** — that sentence was true of the design and false of the file, and `apps/invoicing/README.md:382` says the same thing and moves with it |
| `lib/connect/onboarding.js` | `routeUrl(path)` drops its `freelancerId` argument and the `searchParams.set('freelancer', …)` line; `mintLink(stripeAccountId)` drops its second argument. **The Stripe parameter *names* are untouched** — `account`, `type`, `refresh_url`, `return_url` — so K8, the custody allowlist and every Stripe concept row are unaffected |
| `lib/db/database.js` | two imports, two factory keys |
| `lib/db/migrate.js` | `import m0002` + one array entry |
| `lib/invoices/mapping.js` | comment only — line 70's dangling reference to `resolveFreelancerId` (§11 item 3) |
| `routes/connect.js` | delete `resolveFreelancerId` and its `AS-40 OBLIGATION` block; `handle()` reads `actingFreelancerId(req)`; the "missing freelancer parameter" 400 branch is **deleted** |
| `routes/invoices.js` | delete the `./connect.js` import and its comment block; `handle()` reads `actingFreelancerId(req)`; `query()` is deleted and `editPath`/`detailPath` lose the query string |
| `routes/health.js` | comment only (§11 item 3) |

### 5.3 Test plan (`test/auth.test.js`)

Grouped; each group states what would be vacuous without it. Case ids are `A*`
(unit/service), `H*` (HTTP), `G*` (guard/reachability).

**Password (A1–A12).** A1 encode/decode round trip at the shipped default;
A2 the encoded string is exactly four `$`-fields and starts `scrypt$`;
A3 two hashes of the same password differ (the salt is random);
A4 verify accepts the right password; A5 verify rejects a wrong one;
A6 `decodeHash` rejects each malformed shape — wrong algorithm, missing field,
non-numeric parameter, `N` not a power of two, `N·r` over the memory bound
(**exact list, one assertion each**); A7 a hash produced with *non-default*
parameters still verifies (the forward-compatibility claim); A8 `needsRehash` is
false at the default and true for A7's; A9 NFC — a decomposed and a precomposed
spelling of the same password both verify against one stored hash; A10 length
floor and ceiling; A11 sign-in with an A7-style legacy hash **rewrites the row**
and the new row verifies (upgrade-on-login, end to end); A12 the counting hasher
sees **exactly one** invocation for unknown-email and for wrong-password
(§3.10).

**Repositories (A13–A18).** Round trips; `getByFreelancer` returns `null` rather
than throwing; `sessions.deleteExpired` deletes exactly the expired rows and
returns the count; the FK refuses a session for an unknown freelancer;
**the DDL refuses a plaintext `password_hash`** and **refuses a 43-character
session id** — the two engine-level guards, asserted directly (recipes F4/F7
break the same two).

**HTTP (H1–H18).** Sign-up creates exactly one freelancer and one credential row
and sets one cookie; the `Set-Cookie` string matches the measured shape (E5) with
every attribute asserted individually — `HttpOnly`, `SameSite=Lax`, `Path=/`,
`Max-Age=1209600`, **and no `Secure`** on the loopback config; a second app built
with `appBaseUrl: 'https://d1.example.test'` **does** emit `Secure` (both
directions, or the conditional is untested); duplicate email → 409 `email-taken`
and **nothing is created** (the transaction rolled back); malformed email, short
password, missing field → 400 with the right code; sign-in issues a *new* row;
wrong password and unknown email are **byte-identical** responses; sign-out
deletes the row, clears the cookie (measured shape E6), and the old cookie no
longer authenticates; an expired row is refused **and deleted**; a garbage cookie
value is refused; a cookie naming a session for a deleted freelancer is refused;
`next` is honoured when safe and **replaced by `/`** for each of `//evil.test`,
`https://evil.test`, `/\evil.test`, and a value with a control character.

**Guard and reachability (G1–G8).** G1 the route walk finds the **exact
committed `(method, path)` list** (cardinality first); G2 the partition against
`PUBLIC_ROUTES` is exact in both directions; G3 **every** protected route,
driven with no cookie, answers `303` to `/signin`; G4 safe methods carry
`?next=`, unsafe methods do not; G5 `GET /healthz` answers 200 with no cookie;
G6 `GET /tokens.css` and the app-owned static file answer 200 with no cookie;
G7 no file in `publicDir` collides with a registered route path; G8
`POST /webhooks/stripe` with a valid signature and **no cookie and no `Origin`**
still answers 200 (the webhook is not behind either middleware — this is the
regression test for §3.5.4).

**CSRF (G9–G12).** A POST with a matching `Origin` succeeds; with a foreign
`Origin` → 403 `forbidden-origin`; with no `Origin` but a matching `Referer` →
succeeds; with neither → 403. Applied to a **public** route (sign-in) and a
**guarded** one, because the middleware covers both.

**Impersonation (G13).** A signed-in freelancer requests
`POST /invoices?freelancer=<another freelancer's id>` and the invoice is created
for **the session's** freelancer. This is the one test that proves the seam
replacement did what it was for; without it, a leftover query-parameter read
would be invisible.

**Never logged (A19).** `process.stdout.write` and `process.stderr.write` are
captured around a full sign-up + sign-in + guarded request with a distinctive
password and a distinctive token; neither string appears in the captured output.
Paired with the static `console output` concept row (§5.4), which makes the
absence of a logger in `lib/auth/*` and `routes/auth.js` a red test rather than a
review catch.

### 5.4 Every committed literal that moves, exactly

Every count below was **measured on master at `886c2b0`** (§0 evidence table),
not projected.

1. **`test/harness.test.js`** — `EXPECTED_TEST_FILES` gains `'auth.test.js'` at
   **index 1**, between `'assets.test.js'` and `'config.test.js'`; line 81's
   `13` → **14** in both the number **and** the message string; line 89's comment
   "these thirteen files ran" → "fourteen". *(Measured: the literal `13` occurs
   on exactly one line of this file, line 81.)*

2. **`test/dependency-policy.test.js`, source list** — line 374: `35` → **43** in
   both the number and the message. *(Measured current value: 35, line 374.)*
   The sorted array gains eight entries at these exact positions:
   - `lib/auth/accounts.js`, `lib/auth/guard.js`, `lib/auth/password.js`,
     `lib/auth/session.js` — **after `'app.js'`, before `'lib/config.js'`**
     (`lib/auth/` < `lib/config.js`);
   - `lib/db/migrations/0002-accounts.js` — after `0001-initial.js`;
   - `lib/db/repositories/credentials.js` — after `contracts.js`, before
     `freelancers.js`;
   - `lib/db/repositories/sessions.js` — after `invoices.js`, before
     `stripe-events.js`;
   - `routes/auth.js` — after `routes/assets.js`, before `routes/connect.js`.

3. **`test/dependency-policy.test.js`, `body parser` row** —
   `['routes/invoices.js', 'routes/webhooks.js']` →
   `['routes/auth.js', 'routes/invoices.js', 'routes/webhooks.js']`.

4. **`test/dependency-policy.test.js`, one row SPLIT and six rows ADDED.** The
   split first, because it touches a shipped security guard:

   ```js
   // WAS (one row):
   scanConcept('webhook signature HMAC', /\b(createHmac|timingSafeEqual)\b/, ['lib/webhooks/signature.js']);
   // BECOMES (two rows):
   scanConcept('webhook signature HMAC', /\bcreateHmac\b/, ['lib/webhooks/signature.js']);
   scanConcept('constant-time compare', /\btimingSafeEqual\b/, ['lib/auth/password.js', 'lib/webhooks/signature.js']);
   ```

   **This is not a weakening, and the claim is checkable.** `createHmac` stays
   pinned to exactly one file — the row's stated purpose ("ONE verifier, not
   two") is carried entirely by that half, and AS-44's own falsification recipe
   F7 (append a `createHmac` use to `routes/webhooks.js` → the row fires) still
   works byte for byte. The second half is a *narrower* row than the original
   disjunction, listing the two files that may compare a secret in constant time,
   and it keeps the used-exemption property in both directions. Recipe **F9**
   proves both halves still fire.

   Six new rows, each with its measured baseline of **zero files** (E8):

   ```js
   scanConcept('password KDF',        /\b(scrypt|scryptSync|pbkdf2|pbkdf2Sync)\b/, ['lib/auth/password.js']);
   scanConcept('random bytes',        /\brandomBytes\b/,        ['lib/auth/password.js', 'lib/auth/session.js']);
   scanConcept('session token digest',/\bcreateHash\b/,         ['lib/auth/session.js']);
   scanConcept('session cookie',      /\bres\.cookie\b|\bclearCookie\b|\breq\.headers\.cookie\b/, ['lib/auth/session.js']);
   scanConcept('current user',        /\breq\.currentUser\b/,   ['lib/auth/guard.js']);
   scanConcept('console output',      /\bconsole\.\w+/,         ['lib/invoices/lifecycle.js', 'lib/webhooks/receiver.js', 'server.js']);
   ```

   `console output`'s allowlist is the **measured** current set (E15: five lines
   across those three files, all code, none in comments) — so it lands green and
   immediately makes "nothing in `lib/auth/*` or `routes/auth.js` logs" mechanical.
   The concept test's name gains AS-40.

5. **`test/dependency-policy.test.js`, `raw SQL` row** — nine files → **twelve**:
   gains `lib/db/migrations/0002-accounts.js`,
   `lib/db/repositories/credentials.js`, `lib/db/repositories/sessions.js`, each
   in sorted position.

6. **`test/dependency-policy.test.js`, unchanged and asserted still true** (each
   a claim): `LOCK_ENTRIES` **70**; `DIRECT_DEPENDENCIES`; manifests **3**;
   `SANCTIONED.length` **3**; `stripe module import` `[]`; `STRIPE_ config key`;
   `application_fee`; `/webhook route`; `invoice status rank`;
   `platform Stripe call` `['lib/connect/onboarding.js']` — **a claim: this task
   adds no Stripe call, and `onboarding.js` keeps its two**; `node:sqlite`
   `['lib/db/connection.js']` — a claim: the two new repositories receive a
   handle and import no driver; **`money representation` (7 files, RAW scan) — a
   claim, and the trap most likely to fire (item 9a)**; the 1,200-line cap.

7. **`test/db.test.js`** — the migration-2 set, in file order:
   - line 35 comment "seven entity tables … eight" → "nine entity tables … ten";
   - `TABLES` gains `'credentials'` (index 3, after `'contracts'`) and
     `'sessions'` (after `'schema_migrations'`, before `'stripe_events'`);
   - line 47–49 comment "the DDL it pins has four" → "five";
     `NAMED_INDEXES` gains `'sessions_expires'` (**last**);
   - D2's name "exactly one migration" → "exactly two migrations"; line 104
     `MIGRATIONS.length, 1` → **2** (number **and** message); line 112
     `['initial']` → `['initial', 'accounts']`; line 113 `SCHEMA_VERSION, 1` → **2**;
   - D3's name "the seven entity tables … the four named indexes" → "nine … five";
     line 126 `{ applied: [1], head: 1 }` → `{ applied: [1, 2], head: 2 }`;
     line 128 ledger `deepEqual` gains `{ version: 2, name: 'accounts', applied_at: NOW }`;
     line 132 `8` → **10** (number **and** the message's "(7 + the ledger)" → "(9 + the ledger)");
     line 136 `4` → **5** (number and message); line 142 `13` → **15** (number and
     message — derivation E17: two new TEXT primary keys, no new UNIQUE columns);
     line 148 `8` → **10**;
   - D4 line 158 `8 + 4 + 13` → `10 + 5 + 15`; line 160 `{ applied: [], head: 1 }`
     → `{ applied: [], head: 2 }`;
   - **D5 line 184** — `[{ version: 2, name: 'from-the-future' }]` → `version: 3`.
     This one is written as a bare literal but is really `SCHEMA_VERSION + 1`;
     it is the least obvious literal in the task and the easiest to miss;
   - **D15** — the test **name** contains `{ applied: [1] }` → `{ applied: [1, 2] }`,
     and `assert.deepEqual(first.applied, [1])` → `[1, 2]`;
   - **unchanged, a claim**: D6 (renames version 1, message still names
     `'initial'`); every `SCHEMA_VERSION + 1` expression; `body.checks.length, 4`.

8. **`test/repositories.test.js`** — Z3 (line 927) name "exactly the seven keys"
   → "nine"; line 932's `deepEqual` gains `'credentials'` and `'sessions'` after
   `'stripeEvents'`.

9. **`test/config.test.js`** — **no assertion moves.** One comment does: line 37,
   "AS-40 adds SESSION_SECRET here the same way" → the recorded reason no row is
   added (§11 item 1). `SCHEMA.length` **11**, `prefixed.length` **10**, the
   two-secret list, and the empty-environment `deepEqual` are all claims.

10. **`test/connect.test.js`** — the import of `resolveFreelancerId` (line 19) is
    deleted; **R13 is rewritten** from "a missing or blank freelancer parameter is
    400 on all three routes" into "all three routes redirect to `/signin` without
    a session"; lines 215–216 lose `?freelancer=${freelancer.id}` from the
    asserted `refresh_url` and `return_url`; the **20** measured `freelancer=`
    occurrences (E13) go, replaced by a `Cookie` header from
    `test/helpers/auth.js`.

11. **`test/invoices.test.js`** — the **39** measured `freelancer=` occurrences
    (E13) go; `post`/`postForm` (lines 199–205) gain a cookie header;
    `withInvoiceApp` seeds a session. **LINE CAP: this file is at 1,180 and the
    cap is 1,200 (E16).** Projected +8 lines → 1,188. **Pre-agreed remedy if it
    would exceed 1,200:** extract `post`, `postForm`, `keysOf`, `paramsOf`,
    `pathsOf` into `test/helpers/http.js` and import them in both
    `invoices.test.js` and `connect.test.js` — `test/` is in `SKIPPED_DIRS` and a
    helper is not a `*.test.js`, so this moves **no** committed literal. Do not
    solve it by deleting a case.

12. **`test/webhooks.test.js`** — **four places** (corrected review cycle 1,
    finding R6; the plan said "exactly one line" and measured only the one it had
    gone looking for): the `helpers/server.js` import, `withWebhookApp`'s seeding
    of a session, W1, and 784's `POST /invoices/{id}/send?freelancer=…`, which
    loses its query string and gains a cookie (E18). **No W-case's expected
    status, ledger row or mirror field moves — only request headers**, which is
    the claim item 14 is entitled to make and which survives. W1's added session
    and `Origin` are load-bearing rather than cosmetic: its claim is about
    *routing* (an unconfigured deployment registers no route at all), and without
    them the unrouted request is answered by the app-wide middlewares first, so
    the case would be asserting the guard instead. It is listed separately
    because that file is otherwise untouched and is easy to leave behind; AC 20's
    grep is what catches it if it is.

13. **Traps that would move a literal by accident, and must not:**
    a. **a money word** — `amount`, `currency`, or `money`, case-insensitive,
       **comments included** (that row is a RAW scan) — in any of the eight new
       source files. "The remaining amount of session lifetime" is a natural
       sentence and it is forbidden. This is AS-44's §5.4 trap 8a recurring, and
       it has already caught one task;
    b. `createHmac` anywhere outside `lib/webhooks/signature.js`, comments
       included, because **F9's** grep has a measured baseline of 2 lines in that
       file (E10) and 0 elsewhere;
    c. `console.` anywhere in `lib/auth/*` or `routes/auth.js`, comments
       included — same reason: A19's static half and the F8 recipe both rest on a
       measured baseline of zero;
    d. `fetch`, `curl`, `wget`, `WebSocket`, an import of
       `node:http*`/`net`/`tls`/`child_process`/`transport.js`, `platform: true`,
       `application_fee`, `STRIPE_[A-Z_]+`, or `'/webhook…'` in any new file;
    e. `req.currentUser` in any file but `lib/auth/guard.js`;
    f. `test/auth.test.js` must stay under **1,200 lines** — see §8's split line.

14. **Deliberately NOT moving** (asserted by leaving them untouched and green):
    `test/deploy-shape.test.js` (every literal), `test/assets.test.js`,
    `test/stripe-client.test.js`, `test/stripe-mock.test.js`, `package.json`,
    `package-lock.json`, `compose.yaml`, `Dockerfile`, `server.js`; and in
    `test/health.test.js`, **every health assertion** including
    `body.checks.length === 4` (the file itself moves — item R5). **And every
    W-case's expected status, ledger row and mirror field in
    `test/webhooks.test.js`** — the four edits there are request headers and one
    URL, never an expectation, which is the claim F6 exists to test. Stated as
    *what may not move* rather than *which files may not be opened*: a
    file-level "untouched" claim is falsifiable by a legitimate edit and was
    twice falsified in cycle 1, whereas an assertion-level claim is the property
    anyone actually cares about.

### 5.5 What genuinely cannot be tested here, named

1. **Real browser `SameSite` behaviour.** Every cookie assertion here is on the
   emitted header string. Whether a real browser withholds the cookie on a
   cross-site POST, and whether it sends it on Stripe's top-level GET return, is
   not observable from this suite. **AS-50 owns it, and the cheapest confirmation
   is one line in the run record: whether the Stripe return landed on the connect
   handler as a signed-in freelancer, or bounced to `/signin`.**
2. **`Secure` on loopback.** The conditional is tested in both directions, but
   whether a given browser accepts a `Secure` cookie over `http://127.0.0.1` is
   not exercised, because v1 never sets it there. It becomes real at the first
   HTTPS deployment.
3. **Real scrypt cost on the deploy target.** E1/E2 are emulated-amd64 upper
   bounds. AS-50 should record one real sign-in's wall-clock.
4. **Concurrent memory pressure.** Ten simultaneous sign-ins at 16 MiB each is
   arithmetic here, not a measurement.
5. **Whether 14 days is the right lifetime.** Only a real user re-authenticating
   (or not complaining) can say. The board's warm-intro interviews or AS-50.

---

## §6 Acceptance criteria

Cardinality before quantification throughout: every "all"/"none" is an exact
count against a committed literal, and every guard introduced here is shown
**red** under its §7 recipe before it is trusted.

**The description's VERIFICATION clause, verbatim, is AC 1–5:**

> VERIFICATION: unit and HTTP-level tests — sign-up creates a user; sign-in issues a session; a guarded route rejects an absent, invalid, or expired session; credentials are never stored or logged in plaintext. No accounts, no network.

1. **Sign-up creates a user.** `POST /signup` with a valid body creates exactly
   one `freelancers` row and exactly one `credentials` row (counted before and
   after), and answers `303`.
2. **Sign-in issues a session.** `POST /signin` with correct credentials creates
   exactly one new `sessions` row and answers `303` with one `Set-Cookie`.
3. **A guarded route rejects an absent, invalid, or expired session** — all three
   words, each its own case, against **every** route in the protected partition
   (G3): no cookie; a cookie whose value is not a known digest; and a cookie
   whose row has `expires_at` in the past (which is additionally **deleted** by
   the request that finds it).
4. **Credentials are never stored in plaintext** — the `credentials` table
   contains no row whose `password_hash` is the submitted password; the DDL
   `CHECK` refuses one directly (A-repo case); and no `sessions.id` equals a
   token that was issued.
5. **Credentials are never logged in plaintext** — A19's stdout/stderr capture
   over a full sign-up + sign-in + guarded request finds neither the password nor
   the token; and the `console output` concept row proves no logger exists in
   `lib/auth/*` or `routes/auth.js`.
6. **No accounts, no network.** The whole suite passes in the `test` service
   (`network_mode: none`, mountless), and this task opens no account, files no
   board ask, and adds no `SANCTIONED` entry.

**Design decisions, each asserted:**

7. The encoded hash is `scrypt$N=…,r=…,p=…,l=…$salt$key`; `decodeHash` rejects
   each malformed shape in A6's exact list, including the `128·N·r` memory bound.
8. A hash written with non-default parameters still verifies (A7), reports
   `needsRehash` (A8), and is **rewritten** on the next successful sign-in (A11).
9. NFC-equivalent spellings of one password both verify (A9); a password with a
   trailing space is **not** trimmed (A10).
10. The `Set-Cookie` on sign-in matches the measured shape (E5) with
    `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=1209600` and **no** `Secure`
    under a loopback `appBaseUrl`; and **with** `Secure` under an `https:` one.
    Both directions, or the conditional is untested.
11. `POST /signout` deletes the row, emits the measured clear-cookie shape (E6),
    and the presented cookie no longer authenticates.
12. **No hash reaches the freelancer row** (§4.2 reason 2). **Two assertions,
    both required** — specified in review cycle 1 (finding R3), where the
    criterion had *none* and was true only by construction, which §4.2 reason 2
    itself calls unacceptable ("a STRUCTURAL, TESTABLE property, not a
    discipline"). In `test/auth.test.js`, after a real sign-up:
    - **(a) the projection.** `Object.keys(repos.freelancers.getById(id)).sort()`
      — cardinality first (`length === 5`, with the actual list in the failure
      message), then `deepEqual` against the committed literal
      `['createdAt','displayName','email','id','updatedAt']`.
    - **(b) the row.** `PRAGMA table_info(freelancers)` column names, sorted,
      `deepEqual` against `['created_at','display_name','email','id','updated_at']`
      (measured against `0001-initial.js`, not recalled).
    (a) alone is **not sufficient and must not be shipped alone**: it pins what
    `mapRow` projects, so a `password_hash` column added to the table survives it
    untouched — and D3 would not catch that either, because D3 pins table names,
    index names, an autoindex count and STRICT-ness, never a column list. The
    criterion's subject is the row, so the row is what (b) pins. Falsified by
    **F13**.
13. Unknown-email and wrong-password sign-ins produce **byte-identical** status,
    body and headers, and the injected hasher counts **exactly one** invocation
    on each path (A12).
14. `next` is honoured when it is a safe same-site path and replaced by `/` for
    each of the four hostile spellings in §3.5.5.
15. `requireSameOrigin` allows a matching `Origin`, allows a matching `Referer`
    when `Origin` is absent, and answers `403 forbidden-origin` for a foreign
    origin and for neither header — on a public route and a guarded one.
16. `POST /webhooks/stripe` with a valid signature, **no cookie and no `Origin`**,
    still answers 200 (G8).
17. A signed-in freelancer's request carrying `?freelancer=<another id>` acts as
    **the session's** freelancer (G13).

**Structure and mechanism:**

18. The route walk finds the exact committed `(method, path)` list, and the
    public/protected partition is exact in both directions (G1, G2).
19. `grep -rn 'resolveFreelancerId' apps/invoicing --include='*.js'` returns
    **zero** lines. Measured baseline **12 lines across 4 files** (E18):
    `test/connect.test.js` 7, `routes/connect.js` 2, `routes/invoices.js` 2,
    `lib/invoices/mapping.js` 1. And `grep -rn 'AS-40 OBLIGATION'` returns
    **zero**; measured baseline **3** — one line each in `routes/connect.js`,
    `routes/invoices.js` and `README.md` (E12).
20. `grep -rn 'freelancer=' apps/invoicing --include='*.js'` returns **zero**.
    Measured baseline **63 lines across 5 files** (E18): `test/invoices.test.js`
    39, `test/connect.test.js` 20, `routes/invoices.js` 2, `routes/connect.js` 1,
    `test/webhooks.test.js` 1. Separately,
    `grep -rn "searchParams.set('freelancer'" lib/connect/onboarding.js` returns
    **zero** — measured baseline **1**, and it does not appear in the grep above,
    which is why it gets its own criterion.
21. `SCHEMA.length` is still **11** and `compose.yaml` is byte-identical.
22. Migration `0002` is a new file; `0001-initial.js` is byte-identical;
    `SCHEMA_VERSION` is **2**; a fresh database yields **10** tables, **5** named
    indexes, **15** autoindexes.
23. `createRepositories` returns exactly nine keys.
24. `test/harness.test.js` pins **14** files; the dependency scan pins **43**
    source files; no file exceeds 1,200 lines, `test/invoices.test.js` included.
25. The full suite is green in the `test` service; the `contract` service is
    green too (a claim — no M-case behaviour changes, only its cookie plumbing).

27. **Every protected route's rejection is attributable to the guard** (added
    review cycle 1, finding R2 — §3.5.2). G3 compares each of the nine members'
    cookieless responses against the guard's canonical rejection, taken from a
    path with no registered route, on status, on `Set-Cookie` count (**zero**),
    and on `Location`; **and** recipe **F12** shows all nine moving when the
    guard's rejection changes. Both halves, or the criterion is unmet: the
    comparison alone still admits a handler that redirects to `/signin` and sets
    no cookie, and the recipe alone is not a standing suite member.

**Evidence recorded in the implementation commit message or a Lattice comment:**

26. The measured median in-container `scrypt` time at the shipped parameters, and
    the final line count of `test/invoices.test.js`.

*(Criterion count is now **27**, not 26. Cycle 1 was reviewed against 26; the
rework is reviewed against all 27, and AC 12 has changed shape, so a cycle-1
"PASS" on 12 does not carry forward.)*

---

## §7 Falsification recipes (run in the task worktree; backups OUTSIDE `apps/invoicing/`)

House rules, unchanged: back up to `${TMPDIR:-/tmp}/as40-falsify/` (never inside
`apps/invoicing/` — the closed-world scan classifies every file under it, so an
in-tree `.bak` is itself a red `unknown`), `trap` the restore on `EXIT`,
**assert the mutation applied against its stated baseline**, run the suite IN
CONTAINER (`docker compose … run --rm --build test`), observe the predicted set,
restore, prove the tree with `git -C <worktree> diff --exit-code`, then **rebuild
and re-run green**. Every `docker compose` invocation from the worktree; never
`cd` into it for a `lattice` call.

**On the assert-applied baselines below — REWRITTEN, review cycle 1 (finding
R4).** This defect class has now recurred **six times across five tasks**. Two of
those six are in this very section, and both were caught downstream rather than
here: F2 stated `grep -c 'requireSameOrigin' app.js` as **1** where the file has
**3** (import, comment, mount), and F6/F10 cited `app.use` at **7**, which is
*master's pre-AS-40 value quoted as a post-change invariant* — the true worktree
count is **11**, and **12** once finding R1's second mount lands. Writing "measure
every baseline" at the top of the section, as cycle 1 did, did not prevent either.

So the rule stops being an exhortation and becomes mechanical. **Every
assert-applied step below now takes one of two forms, and no third form is
permitted:**

1. **A unique marker the mutation itself introduces** — `MUTANT-F<n>`, whose
   baseline is 0 everywhere in the repository by construction and therefore
   cannot go stale, drift with an unrelated edit, or be confused with a
   pre-existing token. **This is the preferred form**, and every mutation that
   can carry a comment now carries one.
2. **An occurrence-accurate count**, written `grep -oF -- '<tok>' <file> | wc -l`
   — never `grep -c`, which counts *lines*. Where a count is unavoidable (an
   invariant on an untouched file, a token being removed), it is stated as an
   occurrence count and marked `[occ]`.

Both forms may be combined, and for a removal both are required: the marker
proves the edit landed, the count proves it landed *on the right thing*.

**Every count in the table was re-measured in the task worktree at `ff5aae1`**
with `grep -oF … | wc -l`, not carried over from master and not recalled. Where
finding R1's rework will change a count, the table says so and gives the rule
rather than a number that is about to be wrong.

- **If a baseline does not match before you mutate, stop and record it** — the
  recipe is unrunnable as written and *that is the finding*, not something to
  adjust away.
- **An unapplied mutation is indistinguishable from a guard that did not fire.**
  Assert applied on disk **and inside the built image**, in one indivisible step
  (CLAUDE.md's mutation rule; QA's cycle-1 F10 attempt restored the file before
  the build ran and came back 0 fail — only the in-image assert caught it).

**On the predicted sets.** AS-41's §7 was wrong in two of five sets and AS-43's in
four memberships; both misses came from reasoning about a mutation's *intent*
instead of tracing it through the pipeline. Each prediction below is traced
through **mount order → loadSession → requireSameOrigin → public routers →
requireSession → handler → service → repository → engine**, and names the stage
it changes. A set narrower than predicted is a finding; a set wider than
predicted is a finding; neither is fixed by narrowing a test.

| # | Mutation (exact) | Assert applied (baseline → after) | Predicted failing set |
|---|---|---|---|
| **F1** | In `lib/auth/accounts.js`, delete the discard-hash on the unknown-email path so `signIn` returns early instead, plus a `// MUTANT-F1` marker | **[marker]** `MUTANT-F1` **0 → 1** in `lib/auth/accounts.js` **[occ]**, plus **[occ]** `hasher.hashPassword(` **4 → 3** in that file. Baseline for `MUTANT` is **0 across every `*.js` in `apps/invoicing`** — measured repo-wide, so no file's marker can collide | **EXACT {A12}.** Traced: stage "service". Every *observable* response is unchanged — status, body and headers are still byte-identical — which is exactly why A12 counts KDF invocations instead of asserting a response. **If any H-case also goes red, the enumeration answer was being carried by a response difference, and that is the finding** |
| **F2** | In `app.js`, delete the `app.use(requireSameOrigin(config))` line, plus `// MUTANT-F2` | **[marker]** `MUTANT-F2` **0 → 1** in `app.js`, plus **[occ]** `app.use(requireSameOrigin(config));` **1 → 0**. **The bare token `requireSameOrigin` is 3 [occ] in `app.js`, not 1** — import, comment, mount — which is the cycle-1 defect (finding R4): count the *mount line*, never the identifier | **EXACT {G10, G12}** — the two cases that expect a 403 (foreign `Origin`; neither header). G9/G11 (matching `Origin`; `Referer` fallback) were already succeeding and stay green, which is why the negative cases are the instrument here. G1's route walk is unaffected: a bare middleware is not a route |
| **F3** | In `lib/auth/guard.js`, make `safeNext` return its argument unchanged, plus `// MUTANT-F3` | **[marker]** `MUTANT-F3` **0 → 1** in `lib/auth/guard.js`, plus **[occ]** `return null;` **5 → 0** in that file (measured at `ff5aae1`: lines 45–48 and 55, all five inside `safeNext`; `loadSession` resolves differently, so the token is `safeNext`-exclusive — re-measure before mutating and stop if it is not 5). **I first wrote 4 here from structure rather than measurement and the file said 5** — recorded because it is the same reflex that produced this defect class six times, caught this once only because the rule above now forces the `grep` | **EXACT {H16, H17, H18, H19}** — the four hostile `next` spellings. The safe-path case stays green. **Breaks the open-redirect guard in the direction it exists to catch** |
| **F4** | In `lib/db/migrations/0002-accounts.js`, delete the `length(id) = 64 …` CHECK from `sessions`, then in a test insert the **raw token** as the id, plus a `// MUTANT-F4` marker on the changed line | **[marker]** `MUTANT-F4` **0 → 1** in `lib/db/migrations/0002-accounts.js`, plus **[occ]** `NOT GLOB` **1 → 0** in that file (measured at `ff5aae1`) | **EXACT {A18 half (b), the A-repo "refuses a 43-character session id" case}, and NOTHING ELSE. CORRECTED review cycle 1 (finding R7) — the previous prediction named D3 and D4 and was wrong, provably from the test source without running anything.** D3 pins table *names*, index *names*, an autoindex *count* and STRICT-ness; a deleted `CHECK` moves none of those. D4 *does* read DDL text (`catalogue()` selects `type, name, tbl_name, sql`), but it compares a catalogue **before vs. after a second `migrate()` on the same database** — a changed migration changes both snapshots identically, so D4 is invariant under *any* DDL edit **by self-reference**, not by what it selects. **The narrow set is the correct set**, and the sentence that read a narrow set as evidence that "the catalogue assertions are not reading the migration they claim to" was a false inference and is deleted |
| **F5** | In `lib/auth/session.js`, change the cookie's `sameSite` from `'lax'` to `'strict'`, plus `// MUTANT-F5` | **[marker]** `MUTANT-F5` **0 → 1** in `lib/auth/session.js`, plus **[occ]** `sameSite: 'lax'` **2 → 1** in that file (measured at `ff5aae1`: one in `setSessionCookie`, one in `clearSessionCookie` — only the first is mutated) and **[occ]** `sameSite: 'strict'` **0 → 1** | **EXACT {H4}** — the single case asserting `SameSite=Lax` in the emitted header. **Nothing else moves, and that is the point:** the property that actually matters (Stripe's cross-site return carries the cookie) is **not observable from this suite at all** — §5.5 item 1, and the reason AS-50 owns it. A recipe whose blast radius is one string assertion is the honest measure of how much of this is really tested |
| **F6** | In `app.js`, move the `app.use(webhookRoutes(...))` line from position 2 to **below** `app.use(requireSession(...))`, plus a `// MUTANT-F6` marker on the changed line | **[marker]** `MUTANT-F6` **0 → 1** on the moved line in `app.js` — **the marker is what proves the edit landed, replacing the count invariant that made this recipe unrunnable in cycle 1**. Then *observe* (do not assert a frozen literal) the moved line's index among `app.use(` calls, before and after, and record both line numbers. **`app.use(` is 11 [occ] at `ff5aae1` and becomes 12 once finding R1's second mount lands** — it was stated as **7**, which is master's pre-AS-40 value quoted as a post-change invariant (finding R4). Re-measure it, assert only that the move leaves it *unchanged from whatever you measured*, and stop if the pre-mutation number surprises you | **LOWER BOUND, and both witnesses matter.** (a) **G8** goes red — the webhook with no cookie now redirects; (b) every `webhooks.test.js` case that expects a status other than 303 goes red: **{W2, W5–W14, W16, W17, W19, W20}**. **Green, for a stated reason:** W1 (no secret ⇒ no route at all, so the guard's 303 is what a 404 would have been — **record that it now passes for the wrong reason**). This is the recipe that proves §3.5.4 is load-bearing rather than decorative |
| **F7** | In `lib/db/repositories/credentials.js`, delete the `scrypt$` prefix assertion, then in a test insert a plaintext password as `password_hash`, plus a `// MUTANT-F7` marker on the changed line | **[marker]** `MUTANT-F7` **0 → 1** in `lib/db/repositories/credentials.js`, plus **[occ]** `startsWith(ENCODED_PREFIX)` **1 → 0** in that file (measured at `ff5aae1`) | **EXACT {the A-repo "DDL refuses a plaintext password_hash" case}** — and it must fail with a SQLite `CHECK constraint failed` mapped to `ValidationError`, **not** with the repository's own refusal. If it fails at the repository, the engine-level guard is untested and the DDL `CHECK` is decoration |
| **F8** | Append `console.log(password);` to `lib/auth/accounts.js`'s `signIn` | **[occ]** `console.` **0 → 1** in `lib/auth/accounts.js` (measured at `ff5aae1`; baseline 0 is *guaranteed* by §5.4 trap 13c, which forbids the token there **including in comments**, precisely so this recipe is runnable). The mutation introduces the token, so it is already the preferred form — no separate marker needed | **EXACT, two witnesses: {A19, the `console output` concept row}.** The concept row's message must read "found in [lib/auth/accounts.js, lib/invoices/lifecycle.js, lib/webhooks/receiver.js, server.js], allowed in exactly [lib/invoices/lifecycle.js, lib/webhooks/receiver.js, server.js]". **This is the recipe for AC 5** — without it, "credentials are never logged" is a guard that has only ever been seen passing |
| **F9** | Append a real (non-comment) `createHmac('sha256','x')` use to `lib/auth/password.js`; separately, delete the `timingSafeEqual` call from `lib/auth/password.js` | (a) **[occ]** `createHmac` **0 → 1** in `lib/auth/password.js` (measured 0 at `ff5aae1`; the mutation introduces the token). (b) **[marker]** `MUTANT-F9b` **0 → 1** in `lib/auth/password.js`, plus **[occ]** `timingSafeEqual` **3 → 0** in that file (measured at `ff5aae1` — **3, and the whole call is removed, not one of them**). **`lib/webhooks/signature.js` is untouched in both halves — re-measured at `ff5aae1` as `createHmac` **2 [occ]** and `timingSafeEqual` **4 [occ]**, and both must be unchanged after** | **EXACT, one row each.** (a) the `webhook signature HMAC` row: "found in [lib/auth/password.js, lib/webhooks/signature.js], allowed in exactly [lib/webhooks/signature.js]"; (b) the `constant-time compare` row in its **used-exemption** direction: "found in [lib/webhooks/signature.js], allowed in exactly [lib/auth/password.js, lib/webhooks/signature.js]". **This is the evidence that splitting a shipped guard did not weaken it** — both halves are shown firing, in both directions |
| **F10** | In `app.js`, move `app.use(invoiceRoutes(config, { repos, stripe }))` **above** the `app.use(requireSession(config))` line, plus a `// MUTANT-F10` marker on the changed line | **[marker]** `MUTANT-F10` **0 → 1** on the moved line in `app.js`, plus the two lines' order inverted (record both line numbers before and after). **The `app.use(` invariant is re-measured, not quoted: 11 [occ] at `ff5aae1`, 12 after finding R1** — the stated **7** was master's value and is the sixth instance of finding R4's class | **EXACT: G3's four invoice entries** — `POST /invoices`, `POST /invoices/:id`, `POST /invoices/:id/finalize`, `POST /invoices/:id/send` — each now reaching its handler with no session. **Trace the second-order effect and record it:** each then hits `actingFreelancerId(req)`, which throws (§3.5.6), so the observed status is **500**, not 200. G1's route walk stays green (the same routes are registered, in a different order) — **which is precisely why G3 exists and why the walk alone would not be enough**. This is the AS-43-review recipe: it breaks reachability while leaving placement looking fine |
| **F11** | **In a SCRATCH COPY of the worktree, never in place:** `mv test/auth.test.js test/auth.test.js.bak` | `ls test/auth.test.js` fails in the copy; the task worktree proven clean before and after with `git -C <worktree> status --porcelain` | **EXACT: harness V2 only.** The message must read "expected exactly 14 test files, found 13: …" listing the thirteen survivors |
| **V1** | `$COMPOSE run --rm **--build** -e ASC_SELFTEST_MUTATE=1 test; echo EXIT=$?` | the printed `EXIT=1` | harness V1 only. **`--build` is mandatory** — AS-39 §11.1 recorded a phantom second failure from a stale mutant image |
| **F12** **GUARD ATTRIBUTION — the standing recipe, added review cycle 1 (finding R2)** | In `lib/auth/guard.js`, change `requireSession`'s rejection `res.redirect(303, target)` to `res.redirect(307, target)`, plus `// MUTANT-F12` | **[marker]** `MUTANT-F12` **0 → 1** in `lib/auth/guard.js`, plus **[occ]** `res.redirect(303, target)` **1 → 0** and `res.redirect(307, target)` **0 → 1** (measured at `ff5aae1`; assert in the **built image** too) | **EXACT: ALL NINE protected routes answer 307 — `GET /`, `GET /connect-stripe/refresh`, `GET /connect-stripe/return`, `POST /connect-stripe/start`, `POST /invoices`, `POST /invoices/:id`, `POST /invoices/:id/finalize`, `POST /invoices/:id/send`, `POST /signout` — and no public route moves.** Enumerate the partition and print each route's status; do not read the suite's pass/fail alone. **A count below nine identifies, by name, a route that is not behind the guard** — that is how this defect was found (eight moved, `POST /signout` answered 303 with a `Set-Cookie`, because its handler ran). A count above nine means a public route is guarded. **This recipe is re-run whenever the protected partition changes**, and it is the only mechanism in the plan that tests *attribution* rather than *appearance* |
| **F13** **AC 12's falsification, added review cycle 1 (finding R3)** | In a scratch copy, add a `password_hash TEXT` column to the `freelancers` DDL in `lib/db/migrations/0001-initial.js` | **[occ]** `password_hash` **0 → 1** in `lib/db/migrations/0001-initial.js` (measured 0 at `ff5aae1` — the token is a 0002 concept, so it is a clean unique marker in this file) | **EXACT {AC 12 half (b)} — and the narrowness IS the evidence.** D3 does not move (it pins table and index *names*, an autoindex count and STRICT-ness, never a column list); D4 does not move (self-reference — see F4); AC 12 half (a) does not move, because `mapRow` still projects five keys from `COLUMNS`. **If half (b) is absent, this mutation is invisible to the entire suite** — which is precisely why the criterion may not ship with half (a) alone. Note the mutation targets `0001-initial.js`, which AC 22 requires to be byte-identical: **scratch copy only**, and re-derive the worktree manifest afterwards |

**Rejected as recipes, with reasons** (so their absence is a decision, not an
oversight): mutating `timingSafeEqual` into `===` — no test can observe it, and
its value rests on the primitive's contract rather than on behaviour (F9 half (b)
covers the thing that *is* observable, namely that the file is allowed to use
it); mutating the scrypt parameters to a weaker set — A7/A8/A11 already exercise
non-default parameters as a normal case, so a mutation would only re-run them;
mutating `stripComments` or the closed-world walker — AS-53's own recipes cover
those and re-running another task's recipes is a time-box, not a gap.

---

## §8 Size and complexity, against the milestone tripwires

**Projection:** 9 new source + 2 new test-side files + 19 modified = **30 files**;
≈ **2,050 insertions** (≈ 780 source, ≈ 900 new test, ≈ 250 literal moves and
cookie plumbing in existing tests, ≈ 120 README).

Both §8.2 tripwires fire (>~10 files, >~600 lines), so the written justification
rather than a silent overrun:

- **It is one reviewable claim** — *a freelancer's identity comes from a session
  and from nothing else, and every route that acts on a freelancer's behalf is
  behind that*. Every file in the diff is either the mechanism for that sentence
  or the removal of the interim thing it replaces.
- **The task is not splittable at the seam, and that is a security constraint,
  not a preference.** Landing sessions while leaving `?freelancer=` live in
  `routes/connect.js` and `routes/invoices.js` would mean a signed-in freelancer
  could act as any other freelancer by editing a URL. The seam replacement and
  the session must land in the same merge. G13 is the test for exactly this.
- **Most of the file count is literal moves, not logic.** Eleven of the nineteen
  modified files change only committed numbers, comments, or a cookie header;
  four of those change a comment and nothing else.
- **Right-sizing precedent:** AS-44 projected 14 files / ~1,450 lines and merged
  as one task with a 25-criterion review. This is larger, and it is the last
  cross-cutting server task in the fan; every UI task depends on it.

**Pre-agreed split lines** (so the decision is made now, not mid-flight):

1. **If `test/auth.test.js` would exceed ~1,000 lines**, split it into
   `test/auth.test.js` (password, repositories, HTTP routes) and
   `test/auth-guard.test.js` (guard, reachability, CSRF, impersonation). Cost:
   the harness literal becomes **15** and `EXPECTED_TEST_FILES` gains a second
   entry. Nothing else moves.
2. **If `test/invoices.test.js` would exceed 1,200 lines** (it is at 1,180 —
   E16), extract the shared request helpers to `test/helpers/http.js` per §5.4
   item 11. Do **not** delete a case.
3. **Do not split the task.** If the diff feels unreviewable, the remedy is
   review order, not a second task: review in the sequence
   *migration → repositories → `lib/auth/*` → `routes/auth.js` → `app.js` →
   seam removal → literal moves*, which is the dependency order and the order
   §3 is written in.

**Complexity: `medium`, unchanged.** No new dependency, no new config row, no new
Stripe call, no new external surface, and no new outbound egress. The novelty is
concentrated in two ~120-line modules.

---

## §9 Open questions — each with a default and a time-box

**Q1. Is `N = 2^14` the right cost, or should it be `2^15`?**
*Default:* `2^14`, for the reason in §3.2.3 — it is the strongest set whose
failure mode under a forgotten `maxmem` is benign (E3). *Time-box:* AS-50, when a
real deploy target's CPU is known. *Cost of being wrong:* one constant. No
migration, no data change: upgrade-on-login rewrites each account's hash on its
next sign-in (§3.2.4). This is the cheapest-to-revise decision in the task, which
is why it does not get more analysis than this.

**Q2. Is 14 days the right session lifetime?**
*Default:* 14 days (§3.3.3). *Time-box:* the first real user feedback — AS-50's
run record or the board's warm-intro interviews. *Cost of being wrong:* one
constant, and existing rows keep their issued expiry.

**Q3. Should `next` survive a failed sign-in attempt?**
*Default:* **yes** — `renderSignIn` echoes `next` back, so a user who mistypes
their password once still lands where they were going. *Time-box:* closed here.
*Note for AS-45:* the value must be re-emitted as a hidden field, and it is the
one field besides `email` that survives a failure (never the password — Flow 6).

**Q4. Where does the post-sign-in landing point when there is no `next`?**
*Default:* `/`, held in one constant (`POST_SIGNIN_LANDING`). *Time-box:*
whichever of AS-45/AS-48 lands the Dashboard route first changes that one
constant and its assertions. Recorded in the README so it is not rediscovered.

**Q5. Should sign-up be disable-able (an invite-only switch)?**
*Default:* **no**, not in v1 — it is a config row, an unasked-for capability, and
v1 is loopback-only anyway (§3.8). *Time-box:* the first non-loopback
deployment, which is the same trigger as rate limiting; decide both together in
that task, or neither.

---

## §10 Proposed wording for metawork-owned files

Employees do not edit `CLAUDE.md`, `README.md` (repo root), `PHILOSOPHY.md` or
`agents.md`. **Three** proposals, for the metawork layer to apply or discard
(10.3 added review cycle 1).

**10.1 — for `CLAUDE.md`, under the review conventions**, if the board wants the
lesson generalised beyond this task:

> **A security guard is proven by the direction it protects, not by its
> placement (learned 2026-09-02, AS-40).** A middleware mounted "before the
> protected routers" is an argument about a file, not a fact about the running
> app. Where a boundary exists, the test must **enumerate the built app's routes
> against a committed list**, partition them, and drive a real request at every
> route on the protected side. Reordering two mount lines must turn the suite
> red; if it does not, the boundary is a comment.

**10.2 — for the root `README.md` Status section**, when AS-40 merges:

> The invoicing app now has accounts: local credentials (scrypt, no new
> dependency), server-side sessions in an `HttpOnly` cookie, and a route guard
> every non-public endpoint sits behind. There is no password reset and no
> outbound email in v1 by design; a forgotten password is an operator procedure,
> documented in `apps/invoicing/README.md`.

**10.3 — for `CLAUDE.md`, appended to the existing "A guard is proven by breaking
it" paragraph (added review cycle 1, finding R4).** The mechanical form of the
assert-applied rule has now been proposed **twice** — from AS-44, and again in
this task's own cycle-1 orchestrator comment — and applied **nowhere**, while the
defect reached **six instances across five tasks**, two of them inside this plan's
§7. Per-plan fixes are not converging, and the reason is structural: each plan
re-derives the rule from scratch and re-makes the mistake while doing so. It
belongs in one place. Proposed wording, for the metawork layer to apply or
discard:

> **An assert-applied step asserts on a marker, or on an occurrence count —
> never on `grep -c`.** `grep -c` counts *lines*; recipe authors reason in
> *occurrences*, and a file with two hits on one line makes a stated baseline
> silently wrong. A stale baseline is the same defect wearing a different hat:
> quoting a count measured on `master` as an invariant of a changed worktree has
> now done it twice in one task. So an assert-applied step takes one of exactly
> two forms: **(1)** a unique marker the mutation itself introduces
> (`MUTANT-<recipe>`), whose baseline is 0 by construction and cannot go stale —
> the preferred form, and the only one available when the mutation is a *move*
> rather than an edit; or **(2)** an occurrence-accurate count,
> `grep -oF -- '<tok>' <file> | wc -l`, **re-measured in the tree the recipe will
> run against**, never carried over from another commit. For a removal, use both:
> the marker proves the edit landed, the count proves it landed on the right
> thing. If a baseline does not match before you mutate, **stop and record it** —
> the recipe is unrunnable as written and that is the finding.

No change is proposed to `PHILOSOPHY.md` or `agents.md`.

---

## §11 Stale or wrong items found while planning (flags, and which are fixed here)

1. **`test/config.test.js:37` and `lib/config.js:34–35` both predict a
   `SESSION_SECRET` config row for AS-40.** Both are wrong: this design signs
   nothing, so there is no secret (§3.3.1, §4.1). **Fixed in this task** — both
   are app-owned files, and the replacement wording states the reason rather than
   simply deleting the sentence, so the next reader does not re-derive it.
2. **`routes/health.js:16`** — "a secret added by AS-38/AS-40 must not reach this
   body". AS-40 adds no secret. **Fixed here**: AS-38/AS-44.
3. **`lib/invoices/mapping.js:70`** — "It stays here at two consumers, exactly as
   AS-43 kept `resolveFreelancerId` in …". That function is deleted by this task,
   so the comparison becomes a dangling reference. **Fixed here**, minimally: the
   sentence is rewritten to make the same point about two consumers without
   citing a function that no longer exists. Flagged rather than silently left,
   because it is in a file this task otherwise does not touch.
4. **`apps/invoicing/README.md` lines 33, 193, 495–497, 521–525** — four passages
   describe `?freelancer=<id>` as the live identity mechanism and the AS-40
   obligation as open. **All rewritten here.**
5. **`docs/engineering/01-stack-decision.md:962`** — lists session and CSRF
   handling as an open gap with "each is a §11 dependency decision on its own
   evidence". Now answered with **zero** dependencies (§4.4). Not edited — that
   document is a decision record and this task is not an amendment to it; the
   answer belongs in the amendment log if the board wants it there. **Flagged for
   the metawork layer, not fixed.**
6. **`docs/design/wireframes/01-screens.md:28`** — "Routes are **provisional —
   final routes owned by AS-45..48**". This task makes `/signin`, `/signup` and
   `/signout` load-bearing in shipped `Location` headers and in a guard, which is
   the same position AS-43 put `/invoices/{id}` in. **Flag, not a fix:** AS-45
   may still rename the *screen* route, but doing so is now a change to
   `SIGNIN_PATH` in `lib/auth/guard.js` plus its assertions — one constant, and
   the README says so.
7. **Not stale, recorded as a live constraint discovered while planning:**
   `test/invoices.test.js` is **20 lines** below the 1,200-line cap (E16). Any
   task that touches it from now on should measure first. If this recurs in a
   third task, it stops being a note and becomes a task to split that file.

## Reset 2026-09-02 by agent:cto-owen

---

## Review Cycle 1 Findings

Recorded by `agent:cto-owen` (tech lead) on 2026-09-02, from
`agent:qa-priya`'s review comment (`--role review`) and
`agent:developer-lena`'s implementation comment. **Cycle 1 of 3.** Verdict:
implementation-level rework. 23 of 26 criteria passed; the plan's approach is
sound and most of it landed well — the seam replacement is complete, no
impersonation path survived 45 attack probes, both engine-level `CHECK`
constraints are real, and the previously vacuous cases are genuinely fixed. What
failed is one member of the security boundary this task exists to establish,
inside the one test that is supposed to prove it.

**Corrections applied to the plan in this pass** (so the rework reads a document
that agrees with itself): §3.5.1 mount table and its new note; §3.5.2's
attribution requirement; §3.7's signout bullet and the unauthenticated-caller
answer; §2's Modified/NOT-touched lists; §4.3; §5.1's `routes/auth.js` row;
§5.2's `app.js` row; §5.4 items 12 and 14; §6 AC 12 and new AC 27; §7's header
rules, ten recipe baselines, F4's predicted set, and two new recipes; §10.3.

---

### R1 — BLOCKING. `POST /signout` is above the auth boundary, and the plan told the implementer to put it there

**Reproduce.** Drive `POST /signout` with no cookie and a matching `Origin`.
Observed: `303`, `Location: /signin`, **and**
`Set-Cookie: invoicing_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax`.
Only `clearSessionCookie` emits that header, so **the handler ran** —
`requireSession` never saw the request. `app.js:122` mounts `authRoutes` above
the boundary at line 129; `routes/auth.js:109` defines `router.post('/signout')`
inside that same router.

**The plan caused it.** §3.5.1 put `authRoutes` at mount position 7 (above the
boundary) with a parenthetical claiming signout was below it; §3.7 said signout
"is mounted below the boundary and is therefore guarded by construction". One
Express router cannot be on both sides of a middleware. The implementer followed
the table.

**Ruling: signout goes below the boundary, in a second router.** §3.7's intent is
correct and §3.5.1 is now corrected to match. Two mechanisms were available and I
am ruling between them rather than leaving it open:

- *Rejected:* `requireSession(config)` as per-route middleware on the existing
  mount. It is correct, and it is cheaper by one export. But it makes signout the
  one protected route whose protection is not positional, so "everything below
  the boundary line requires a session, and nothing above it does" stops being a
  complete description of what is guarded, and a reader of `app.js` must open a
  router file to learn which of its routes are exceptions. The plan's own
  governing sentence is "the boundary is one line, in one place" (§3.5.1); a
  second mechanism costs more than the export it saves.
- *Chosen:* `routes/auth.js` exports two factories — `publicAuthRoutes`
  (`POST /signup`, `POST /signin`) at position 7, and `sessionAuthRoutes`
  (`POST /signout`) below the boundary. Cheap because signout shares nothing with
  the public pair: no body parser, no `statusFor` mapping, no `renderSignIn`
  seam, no router-level error handler. *What would flip this:* if signout shared
  the parser or the error handler, the split would duplicate them and per-route
  middleware would win. It does not.

**Also in scope for R1:** `app.js:119–121` and `apps/invoicing/README.md:382`
both assert the route is "guarded by construction". Both are false today and both
must move with the mount — AS-45 will read them. Note that "by construction" is
the phrase that let this ship: it asserted the conclusion and named no mechanism,
so nothing contradicted it when the mechanism was absent. Replace it with the
mechanism.

**What an unauthenticated `POST /signout` must answer, once guarded.**
`requireSession`'s ordinary unsafe-method rejection: **`303` to `/signin`, no
`next`, no `Set-Cookie`.** Checked against AS-45, as required: a user whose
session expired clicking a stale sign-out button lands on the sign-in screen —
the same destination the handler would have chosen, so nothing hostile. The one
behavioural difference is that the stale cookie is not cleared, which is
harmless: `loadSession` already resolves it to nothing (deleting the row if it is
merely expired, H10), and the next successful sign-in overwrites it. The guard
must **not** grow a cookie-clearing branch to close that gap — its silence about
cookies is what makes its answer distinguishable from the handler's under R2, so
the two rulings are the same ruling.

**Security impact today: low, and verified rather than assumed.** An anonymous
`POST /signout` clears only the caller's own cookie and can delete only the row
named by the caller's own token; a seeded victim's session was confirmed live
afterwards, and `requireSameOrigin` sits above, so cross-site forced logout is
refused. **This does not reduce the finding**, because the defect is in the proof,
not in the exploitability — see R2.

---

### R2 — BLOCKING. G3 cannot detect R1, and fixing the mount without fixing G3 leaves the proof broken

**State this plainly, because it is the whole finding.** If the rework moves the
mount and leaves G3 as written, **G3 goes green and the green carries no
information**. G3's assertion is `303` + `Location: /signin`; `POST /signout`'s
own success path returns exactly `303` + `Location: /signin`. The member is
satisfied by the thing it exists to test the absence of, so it would stay green
with `requireSession` deleted entirely — and it would stay green if someone moved
signout back above the boundary tomorrow. The mount fix removes today's instance;
only the test fix removes the class. **A rework that ships R1 without R2 is not
accepted**, and I would rather have R2 alone than R1 alone.

**How it was exposed** (QA's mutation, and the reason it is now a standing
recipe): change the guard's rejection from `303` to `307` and enumerate the
protected partition. Eight routes moved to 307; `POST /signout` answered 303 with
one `Set-Cookie`. Nine members, eight attributable to the guard.

**The property the rework must satisfy** — stated as a property, because "signout
must be distinguishable" is too narrow and a route that does not exist yet must
be covered too:

> For every route in the protected partition, the cookieless response is
> **attributable to `requireSession`**. Operationally: *if the guard's rejection
> changes, this route's response changes.*

**Both mechanisms are required; neither is sufficient alone.**

1. **In-suite (G3): a reference comparison.** Obtain the guard's canonical
   unsafe-method rejection from a path with **no registered route** below the
   boundary (`POST /__unrouted__`, matching `Origin`, no cookie) — nothing serves
   it, so that response is *definitionally* the guard's. Traced through the mount
   order and independently corroborated by Lena's `test/health.test.js`
   deviation, where the unknown-path 404 case now has to sign in first. Then
   compare every protected member's cookieless response against that reference
   on: **status**, **`Set-Cookie` count (zero)**, and **`Location`** — exact for
   unsafe methods, `/signin?next=<this route's own originalUrl>` for safe ones
   (G4's existing split, unchanged). **The zero-`Set-Cookie` clause is the byte
   that discriminates the defect that shipped**, and it is one line.
2. **In §7 (F12): the standing attribution recipe.** The comparison narrows the
   hiding place without closing it — a future handler that redirects to `/signin`
   *and* sets no cookie would still be indistinguishable. Only a mutation closes
   it. QA's technique is therefore promoted from a one-off review technique to a
   §7 recipe with a pinned predicted set of **nine of nine**, re-run whenever the
   protected partition changes. Fewer than nine names the unguarded route; more
   than nine means a public route is guarded.

**Note for whoever reviews the rework:** the mount fix moves **no committed route
literal** — `ALL_ROUTES` stays at 14, `PUBLIC_ROUTES` at 5, the protected
partition at 9. G1, G1b and G2 will read identically before and after. That is
precisely why G3 going green afterwards proves nothing on its own, and why AC 27
requires the recipe as well as the assertion.

**Related, and not a separate finding:** `PUBLIC_ROUTES` (`test/auth.test.js:727`)
already omits `POST /signout`, so G2 correctly declared it protected while it was
in fact public. Two committed artifacts said "protected" and only the mount said
otherwise — a reminder that agreement between a plan section and a test literal
is not verification when both were written by people reading the same wrong
table.

---

### R3 — BLOCKING (minor). AC 12 has no assertion at all

**Reproduce.** `grep -n "Object.keys" test/repositories.test.js` returns four
hits — the contracts method list (448), an invoice column list (802), and Z3's
repo keys (932/934). None is the freelancer row. `test/auth.test.js` pins the
credentials row (251) and the sessions row (271), not the freelancer row.

The **property** is true: `lib/db/repositories/freelancers.js` has
`COLUMNS = 'id, email, display_name, created_at, updated_at'` and `mapRow`
returns exactly five camelCase keys. But it is held by *discipline*, which is
exactly what §4.2 reason 2 says it must not be ("a STRUCTURAL, TESTABLE property,
not a discipline"). A criterion true by construction is a criterion that has
never been tested.

**Ruling: two assertions, specified in AC 12, and half (a) may not ship alone.**

- **(a) the projection** — `Object.keys(repos.freelancers.getById(id)).sort()`,
  cardinality first (`length === 5`, actual list in the message), then `deepEqual`
  against `['createdAt','displayName','email','id','updatedAt']`.
- **(b) the row** — `PRAGMA table_info(freelancers)` column names, sorted,
  `deepEqual` against `['created_at','display_name','email','id','updated_at']`
  (measured against `0001-initial.js`).

(a) alone pins what `mapRow` *projects*, so a `password_hash` column added to the
`freelancers` table survives it untouched — and D3 would not catch that either
(it pins table names, index names, an autoindex count and STRICT-ness, never a
column list). The criterion's subject is **the row**, so the row is what (b)
pins. **Falsified by new recipe F13**, whose narrow predicted set — exactly (b),
nothing else — is itself the evidence that nothing in the suite covers this
today.

---

### R4 — The assert-applied baseline class, sixth instance, and the mechanical fix is applied here

QA independently measured `app.use(` in `app.js` at **11 occurrences**, not the
plan's stated **7**. That is the sixth instance across five tasks, and **two of
the six are in this plan's own §7**, written under an explicit instruction to
measure every baseline:

- **F2** stated `grep -c 'requireSameOrigin' app.js` as **1 → 0**. The file has
  **3** occurrences (import, comment, mount). Lena hit this and ran it as 3 → 2
  plus an exact check on the mount line — correct handling, and she filed it.
- **F6/F10** cited `app.use` at **7**, which is *master's pre-AS-40 value quoted
  as a post-change invariant*. True worktree count is **11**, and **12** once R1
  lands.

Note the two are different flavours of one class: a **line count** read as an
occurrence count, and a **stale count** read as a current one. Both produce a
step that cannot fail, which is a vacuous guard on the guard.

**The mechanical fix has been proposed twice — AS-44, and this task's own cycle-1
comment — and applied nowhere. It is applied here.** Every assert-applied step in
§7 now takes one of exactly two forms and no third: **(1)** a unique marker the
mutation introduces (`MUTANT-F<n>`; baseline measured at **0 across every `*.js`
in `apps/invoicing`**, so no marker can collide), or **(2)** an occurrence-accurate
count written `grep -oF -- '<tok>' <file> | wc -l`, marked `[occ]`. For a removal,
both: the marker proves the edit landed, the count proves it landed on the right
thing.

**Ten recipes corrected: F1–F10.** F11 (`ls` on a moved file) and V1 (an exit
code) carried no grep count and needed none. Two new recipes, F12 and F13, are
written in the new form. Every count in the table was re-measured in the worktree
at `ff5aae1` — not carried from master, not recalled.

**Recorded against myself, because it is the best available evidence that the
rule is the right one:** writing F3's replacement I stated `return null;` at
**4** occurrences in `lib/auth/guard.js` from the shape of the code. The file has
**5** (lines 45–48 and 55). I caught it only because the new rule forced me to
run the `grep` I would otherwise have skipped. The reflex that produced this
defect six times is not carelessness — it is that reasoning about a file feels
like knowing its contents.

**The rule belongs in `CLAUDE.md`, not in each plan** — per-plan fixes have not
converged, because every plan re-derives the rule and re-makes the mistake in the
act of writing it down. Exact proposed wording is in **§10.3**, for the metawork
layer to apply or discard. I have not edited `CLAUDE.md`.

---

### R5 — Plan claim falsified: §2's "explicitly NOT touched" list

`test/health.test.js` **is** modified. Lena discloses it (deviation 2) and the
change is correct and minimal: `GET /` and the unknown-path 404 live in that file
and both now sit behind the boundary, so those two cases sign in first. All four
health checks and `body.checks.length === 4` are untouched.

**This is a plan defect, not a bookkeeping slip** — a "NOT touched" entry is an
assertion, and §4.3 made the same claim independently. Both corrected in place.
Structural fix applied at the same time: §5.4 item 14 now states **what may not
move** (assertions, expected statuses, ledger rows) rather than **which files may
not be opened**. A file-level untouched-claim is falsifiable by a legitimate
edit — it was falsified twice in this cycle — while an assertion-level claim is
the property anyone actually cares about.

---

### R6 — Plan claim falsified: §5.4 item 12's "exactly ONE line"

`test/webhooks.test.js` changes in **four** places, not one: the
`helpers/server.js` import, `withWebhookApp`'s session seeding, W1, and line 784.
Verified against the diff, not taken on report. No W-case's expected status,
ledger row or mirror field moved — only request headers — so item 14's
substantive claim survives, and W1's added session and `Origin` are load-bearing
rather than cosmetic (its claim is about routing; without them the unrouted
request is answered by the app-wide middlewares and the case would be asserting
the guard instead). Corrected in place. Root cause worth naming: the plan
measured the one line it had gone looking for and reported that measurement as
the file's total.

---

### R7 — RULING on the implementer/reviewer disagreement: the reviewer is right

**The dispute.** Under recipe F4 (delete the sessions-id `CHECK` from
`0002-accounts.js`), the observed failing set was `{A18}` alone, narrower than
the plan's predicted `{A18, D3, D4}`.

- **Lena (implementer)** classified this as a **coverage gap**: "nothing in the
  suite pins any migration's DDL TEXT… deleting a CHECK constraint is invisible
  to db.test.js", and endorsed the plan's inference — "a run where only the
  A-repo case goes red means the catalogue assertions are not reading the
  migration they claim to" — as "exactly right".
- **Priya (reviewer)** classified it as a **plan prediction error**: D3 pins
  table names, index names, an autoindex count and STRICT-ness; D4 compares a
  catalogue before-vs-after within one database; neither ever claimed to read DDL
  text, so neither can be "not reading the migration it claims to". She noted the
  residual has no coverage consequence, having shown both `CHECK` constraints
  going red behaviourally (F7 → A17, F4 → A18).

**Ruling: Priya. It is a plan prediction error. No test is missing on this
account, and the plan's F4 prediction is what changes.** I verified it from the
test source rather than adjudicating between two reports:

- **D3** asserts table names, named-index names, an autoindex **count**, and
  STRICT-ness via a regex on `sql` for the trailing `STRICT`. Removing a `CHECK`
  moves none of those. D3 could not have gone red.
- **D4** — and here both of them are slightly off —
  `catalogue()` is
  `SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name`, so
  **D4 does read DDL text**, contrary to Priya's stated reason. It is invariant
  for a different and stronger reason: it compares `catalogue(db)` *before* a
  second `migrate()` against `catalogue(db)` *after* it, **on the same database**.
  A changed migration changes both snapshots identically. D4 is invariant under
  *any* DDL edit **by self-reference**, not by what it selects.

So the narrow set is the **correct** set, derivable by reading the tests without
running anything, and the plan's inference was false when written. Lena did not
mis-run the recipe; she inherited a false prediction and reasoned forward from
it, which is the failure mode §7's "traced through the pipeline" preamble exists
to prevent and did not.

**The loser's reasoning, recorded — because Lena found something real and got the
classification wrong, and those are separable.** Her underlying observation is
true and she found it first: **no assertion in the suite pins any migration's DDL
text against a committed expectation.** What is wrong is (i) calling it a gap
*revealed by F4*, when F4 could never have shown it, and (ii) endorsing the
plan's inference, which is false. It also has no coverage consequence here:
both `CHECK` constraints are pinned **behaviourally** — A17 (F7) and A18 (F4),
each shown red — and a behavioural pin is *stronger* than a DDL-text pin, since
it proves the engine enforces the constraint rather than that the text is
present.

**The winner's reasoning is also corrected**, because a ruling that launders an
imprecise reason into precedent is how bad reasoning propagates: Priya's
conclusion is right, her stated reason for D4 ("never claimed to read DDL text")
is wrong on the facts, and the correct reason is self-reference.

**Disposition:** F4's predicted set becomes `EXACT {A18 half (b)}` with the reason
stated inline, and the false-inference sentence is deleted. The DDL-text residual
stays **backlog** (QA backlog item d) — worth a task only if the DDL grows a
constraint that has no behavioural test. **Not in this cycle's scope.**

---

### Convention findings (all PASS — recorded so the rework does not regress them)

Every commit subject `AS-40: …`; all six authored as
`developer-lena <developer-lena@agents.american-software.local>`, the actor-id
form settled on AS-53; zero `.lattice/` paths on the branch (the two-plane rule
held); scope confined to `apps/invoicing/`; no protected top-level file edited —
§10's proposed wordings correctly left to the metawork layer; no new dependency
(`package.json`, `package-lock.json`, `Dockerfile`, `compose.yaml` byte-identical
to master); each of the six commits independently green; no secret-bearing string,
no egress token, money-word trap avoided across all eight new source files
including comments; Docker isolation clean on both sides, with the chat and web
containers untouched and healthy after teardown, and the `test` service offline
throughout. **The rework inherits all of these as obligations, not as credit
already banked.**

Two process notes worth carrying forward. First, QA's universal vacuity detector
— replacing every `node:assert` primitive with a throwing function via
`node --import` and re-running — turned **314 of 316** executed cases red, the two
survivors being helper modules with no tests in them. That is a cardinality-first
answer to "is any vacuous test left", and it is a better instrument than a spot
check; it should be reached for again. Second, QA's F10 attempt initially put the
`trap … EXIT` restore in the same shell as the mutation, so the file was restored
*before* the build ran and the suite came back 0 fail — indistinguishable from
"the recipe did not fire". Only the **in-image** assert-applied step caught it.
That is CLAUDE.md's mutation-is-one-indivisible-step rule earning its place, and
§7's header now says so.

---

### Explicitly NOT in scope for this cycle

The rework is R1, R2, R3 and the plan corrections already applied. Everything
below is out, and a rework touching it is over-scoped:

1. **The DDL-text assertion gap** (R7). Backlog. Both `CHECK` constraints are
   behaviourally pinned and both were shown red.
2. **`decodeHash`'s missing salt-length bound.** A tampered row with a
   multi-megabyte salt decodes. Not attacker-writable, not in the plan's stated
   bound list (N, r, p, l, 128·N·r — all five hold). Backlog.
3. **`readSessionToken` not stripping RFC 6265 DQUOTEs.** A client that quotes
   the cookie value is silently signed out. No browser does this with a base64url
   value we set. Backlog.
4. **Splitting `test/invoices.test.js`** (1,195 of 1,200 lines). This is the
   second task to hit it; §11 item 7 makes the *third* the trigger, and it
   becomes its own task then, not a rider on this one. **The rework must not
   grow that file.**
5. **AC 17's wording** (it forbids `freelancer=` anywhere while AC 20 requires a
   test containing it). Ruled a tech-lead item before review, not a rework
   trigger: production source is at zero for every marker, which is what AC 17
   exists to guarantee. Reword it when the task closes; do not re-litigate it in
   the rework.
6. **Reproducing F1, F2, F3, F5, F6, F9, F11.** QA time-boxed after seven
   recipes; their cycle-1 outcomes stand. **F12 and F13 are new and must be run.
   F4 must be re-run** against its corrected prediction, and F2/F6/F10 against
   their corrected baselines — a recipe whose assert-applied step was unrunnable
   has not actually been run.
7. **Any change to `docs/engineering/01-stack-decision.md` or the wireframes doc**
   (§11 items 5 and 6). Flags, not fixes, and still flags.
8. **`CLAUDE.md`.** §10.3 is a proposal. The metawork layer applies it.

**Cycle budget:** this is rework cycle 1 of 3. The CLI blocks the fourth
review→rework transition. Two cycles remain; spend them on R1/R2/R3 and nothing
else.
