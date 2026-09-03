# AS-45: D1 v1 UI: onboarding screens 1-2 (auth, Connect Stripe)

The two screens that take a freelancer from signed-out to charge-ready, built to Jonah's wireframes and states ledgers from AS-30 and consuming the AS-29 tokens (docs/design/tokens/tokens.css). Screen 1: a single auth route with sign-up and sign-in modes. Screen 2: Connect Stripe — start onboarding, and show connection status with its full states ledger (not started, incomplete requirements, pending verification, enabled, expired link, error).

IMPLEMENTS: docs/engineering/00-d1-v1-milestone-plan.md section 3 rows C-08 (sign-up/sign-in screen) and C-12 (Connect Stripe screen); section 4.3 screens 1 and 2 of 7.

DECISION CONTEXT. Two screens are merged into one task with a written justification, which milestone plan section 8.2 permits: one reviewable claim ("a new freelancer can get from nothing to an account that can charge"), around 450 projected lines, under the split threshold. This task carries a depends_on edge to AS-30; per milestone plan section 8.1, ONLY screen-rendering tasks may. If AS-30 has not yet delivered these two screens' wireframes and states ledgers, do not improvise them — pull a non-UI task instead; the graph is built so one is always available (section 8.4).

Sign-up is deliberately email-free: no verification mail, no magic link, no password reset (row C-09, OUT — Rule 1, and independently Rule 3, since email needs an ESP account and a sender domain the unnamed product cannot have).

VERIFICATION: screens render sensibly at 375px before desktop widths (front-end design plan section 5.4, the lesson of AS-23); every visual property traces to a named token, no magic values (section 5.1); every state in the ledger is reachable in a test or at a documented URL; the flow works against the local compose stack with no accounts — Connect start is exercised against stripe-mock, and the real hosted round trip belongs to the acceptance run.

NOT IN THIS TASK: the server halves (auth and Connect tasks); an account-settings screen (row C-41, OUT — Rule 1: connection status lives on screen 2, and the freelancer's invoice branding lives in their own Stripe account, row C-14, Rule 2); password-reset or verification UI (row C-09); an onboarding checklist or guided tour (row C-55, OUT — Rule 1, with Rule 4 barring the "it builds trust" counter-argument).

---

**Plan author:** Owen Kessler (`agent:cto-owen`), 2026-09-02. **Implementer:** `agent:developer-marcus`.
**All commands run inside compose.** `node_modules/` does not exist on the host — `docker compose run --rm test` is the suite, `docker compose run --rm contract` is the stripe-mock half. Anything below that says "run" means run it there.

---

## §1 Scope, and what this task is really deciding

**In scope, the visible half:** the two onboarding screens as HTML a browser renders — `GET /signin` (both modes) and `GET /connect-stripe` — built to `docs/design/wireframes/screen-1-signin.html` and `screen-2-connect-stripe.html`, styled from `docs/design/tokens/tokens.css`, with every ledger row in `02-states-ledger.md` §1 and §2 accounted for.

**In scope, and more important:** *this is the first task in this app that renders HTML for a human, and the last three screen tasks (AS-46, AS-47, AS-48) inherit whatever it decides.* Four things are being decided once, here:

1. **The view layer's escaping guarantee** — stated as a property, enforced mechanically, not remembered (§3.1).
2. **What "every visual property traces to a named token" means precisely enough to test** (§3.2).
3. **Where a screen's route lives, and on which side of the auth boundary** (§3.3).
4. **What a screen template is allowed to contain** — the view-model/template split that keeps 1 and 2 auditable (§3.4).

**In scope, the housekeeping this task is obliged to do.** AS-37 left an `AS-45 OBLIGATION` marker in four places (`routes/pages.js`, `lib/views.js`, `public/scaffold.css`, `apps/invoicing/README.md` § Obligations) and AS-40 left a fifth in `routes/auth.js` (`renderSignIn`). All five are discharged here. The scaffold page is retired. This is not optional bundling: `views/scaffold.ejs:38` carries `style="background: var(--<%= token %>)"`, the one interpolation-inside-an-attribute-value in the tree, and the §3.1 guard cannot be landed with an empty allowlist while it exists (measured — §7 F3 baseline).

**Not in scope.**

- **The server halves.** `routes/auth.js`'s POST handlers, `routes/connect.js`'s three handlers, `lib/connect/onboarding.js`, `lib/auth/accounts.js` — their behaviour, statuses and error taxonomies are AS-40's and AS-41's and are not re-derived or altered. The two exceptions are surgical and named in §2.
- **Screens 3–7**, the shared nav chrome (`01-screens.md` §3 scopes nav to screens 3–7; screens 1–2 carry reduced chrome), the Dashboard route, and `POST_SIGNIN_LANDING`'s eventual value (§3.3.4).
- **Wiring `POST /connect-stripe/start`'s failure into `S2-ERROR-SYSTEM`.** Today that failure answers a one-line `text/plain` 502. That is a real gap on the acceptance path and it is *not* closed here, for the reason in §3.5.3; it is filed separately (§11 item 8).
- **Client-side JavaScript.** Verified still absent, and kept absent — mechanically (§3.1 P2c).
- **Amending AS-30's `02-states-ledger.md`.** §3.5.2 records a divergence between the `S2-ABANDON` row and what AS-41 actually built. The exact amendment wording is written down in §9 Q3; applying it to Jonah's document is not this task's call.

## §2 File-level scope

Nothing outside this list is touched. A diff that changes a file not named here is a finding.

**Created**

| Path | What |
|---|---|
| `apps/invoicing/views/signin.ejs` | Screen 1, both modes, all rendered states |
| `apps/invoicing/views/connect-stripe.ejs` | Screen 2, all rendered states |
| `apps/invoicing/public/app.css` | The app's one stylesheet (replaces `scaffold.css`) |
| `apps/invoicing/lib/screens/signin-view.js` | Screen 1's pure view model |
| `apps/invoicing/lib/screens/connect-view.js` | Screen 2's pure view model |
| `apps/invoicing/test/screens.test.js` | Route surface, state reachability, escaping behaviour, responsive floor |

**Deleted**

| Path | Why |
|---|---|
| `apps/invoicing/views/scaffold.ejs` | AS-37 obligation, discharged |
| `apps/invoicing/public/scaffold.css` | Same |

**Modified**

| Path | Change |
|---|---|
| `apps/invoicing/routes/auth.js` | `renderSignIn` body replaced (the AS-40 seam); `GET /signin` added to `publicAuthRoutes`; the view object gains `displayName` and `invalidFields` (§3.5.1) |
| `apps/invoicing/routes/connect.js` | `GET /connect-stripe` added to `connectRoutes`. **No change to the three existing handlers, their statuses, or their bodies.** |
| `apps/invoicing/routes/pages.js` | Scaffold page replaced by a 303 from `GET /` (§3.3.4) |
| `apps/invoicing/lib/views.js` | `VIEWS`: scaffold row out, two screen rows in, each with `sampleLocals` |
| `apps/invoicing/lib/auth/guard.js` | One added export, `hasSession(req)` (§3.3.2). Nothing else — `SIGNIN_PATH` and `POST_SIGNIN_LANDING` keep their values; two stale comments corrected (§11) |
| `apps/invoicing/test/auth.test.js` | Route-surface literals (§5) |
| `apps/invoicing/test/health.test.js` | `VIEWS` literals; the scaffold-page case replaced (§5) |
| `apps/invoicing/test/assets.test.js` | `PUBLIC_FILES`; the token check strengthened in place (§3.2) |
| `apps/invoicing/test/dependency-policy.test.js` | Source-file list and count; three new concept rows (§3.1) |
| `apps/invoicing/test/harness.test.js` | `EXPECTED_TEST_FILES` + count (§5) |
| `apps/invoicing/README.md` | New "The view layer" section; the Obligations section updated (§10) |

**Explicitly not modified.** `app.js` (no new mount — both screens join existing routers), `lib/config.js` (§4), `Dockerfile` (it `COPY`s `views/` and `public/` as directories, so new files ride along with no manifest edit), `compose.yaml`, `package.json`, `lib/auth/accounts.js`, `lib/auth/session.js`, `lib/connect/onboarding.js`, `lib/connect/readiness.js`, `lib/db/**`, `lib/contracts/**`, and every top-level repo markdown file.

## §3 Design

### §3.1 The escaping guarantee — the decision three tasks inherit

AS-42 (`lib/contracts/render.js`) established three properties for a legal document: no template parser, one escape function every text node passes through, and no data in an attribute position at all. A *page* cannot have all three — a form must re-render the freelancer's email into a `value=` attribute. So the equivalent guarantee is stated differently, and it is stronger where it can be.

**EJS's escaping is a default, not a mechanism.** EJS has exactly two output tags: `<%= expr %>` escapes (`& < > " '`, the same five as `escapeHtml`), and `<%- expr %>` does not. Relying on "we use `<%=`" is relying on every author, forever, remembering to. So the guarantee is stated as three properties over the *file set*, each with a measured baseline and each enforced by a concept row in `test/dependency-policy.test.js` — the same instrument as `escapeHtml`'s row, and it already reads `.ejs` files with EJS-comment stripping.

> **P1 — There is no raw-output path.** The token `<%-` does not occur in any scanned file. Every interpolation in every template is therefore escaped by EJS, and there is no site an author can reach for.
>
> **P2 — No interpolation reaches a position where escaping is insufficient.** Specifically: (a) no interpolation inside an `href`, `src`, `action`, `formaction` or `style` attribute value; (b) no `on*` event-handler attribute anywhere; (c) no `<script>` or `<style>` element anywhere in `views/`.
>
> **P3 — Attribute values that do carry data are double-quoted.** Escaping `"` is only load-bearing if the attribute is delimited by `"`. Unquoted and single-quoted attribute values are forbidden in `views/`.

**Measured baselines, run 2026-09-02 before this plan was written** (the §7 rule — every grep run before the number is written down):

| Property | Pattern | Baseline today | Baseline after this task |
|---|---|---|---|
| P1 | `<%-` in *stripped* source | **0 files.** The one occurrence in the tree, `lib/health.js:80`, is inside a `//` comment and `stripComments` removes it | 0 files |
| P2a | `/(href\|src\|action\|formaction\|style)\s*=\s*"[^"]*<%/` | **1 occurrence: `views/scaffold.ejs:38`** | 0 |
| P2b | `/\son[a-z]+\s*=/` in `views/`, `public/` | 0 | 0 |
| P2c | `<script` / `<style` (case-insensitive) in `views/`, `public/` | 0 each | 0 each |

P2a is why the scaffold retirement is a precondition rather than housekeeping: the row cannot be added with an empty allowlist while `scaffold.ejs` stands.

**Is raw output permitted anywhere? No — but the mechanism for permitting it is landed now, empty.** `lib/contracts/render.js`'s header already commits AS-47 to emitting a rendered contract "with EJS raw output exactly once, inside the document region." A blanket ban would either block AS-47 or be quietly widened by whoever hits it. So P1 is implemented with the `SANCTIONED`-shaped instrument already in this file: an allowlist keyed on **file + construct + the whole line the hit must sit on + how many hits it may absorb**, whose entries must each be used exactly `count` times. AS-45 lands it with **zero entries**. AS-47's single raw-output site becomes its first entry, reviewed on its own merits, pinned to one exact line, and unable to sanction a second occurrence.

**No `include`, and therefore no partials, in this task.** `<%- include(...) %>` is raw output; permitting it is the one carve-out that would make P1 not absolute. The cost is ~14 duplicated lines of `<head>` and header chrome per screen. That cost is paid, for three reasons: (i) an absolute ban with a measured-zero allowlist is a materially stronger guarantee than a ban with a "but includes are fine" clause the next author reads as permission; (ii) the failure mode a partial protects against — one screen's `<head>` drifting — is closed better by an assertion that *every* template links both stylesheets and carries the viewport meta, which also catches a partial that stopped being included; (iii) `include` resolves through Express's `views` setting, and `/healthz`'s render probe calls `ejs.render` directly with `filename` — two resolution paths that can disagree about a partial and cannot disagree about a self-contained file. Revisit trigger and default in §9 Q1.

**What P1–P3 do not cover, stated rather than implied.** They are lexical properties of the template files. They do not stop a *route handler* from `res.send`ing a hand-built string, and they do not stop a view model from computing markup and handing it to `<%= %>` (it would arrive escaped, i.e. visibly broken, not dangerous). The dynamic half is F1 in §7: a real request whose user-controlled value contains markup, asserted on the served bytes.

**No user-controlled text is ever product copy.** Every string on both screens is a renderer-authored constant selected by a closed enum, with exactly two exceptions, both escaped and both in element content or a double-quoted `value=`: the freelancer's submitted `email` and `displayName`, re-rendered per Flow 6. The `next` path is never rendered as text and never in an `href` — it travels in a hidden input only (§3.3.3).

### §3.2 "Every visual property traces to a named token", made checkable

The VERIFICATION clause makes this a property, not a style preference. `wireframe.css`'s own header already states the working convention; this turns it into a test.

**The current check is the naive one, and it passes vacuously.** `test/assets.test.js`'s case `'public/ styles reference tokens rather than re-typing values'` asserts (a) zero `#hex` literals and (b) `body.includes('var(--')`. A stylesheet of `color: rgb(0,0,0); padding: 12px;` plus one `var()` anywhere passes both. It is replaced in place — same file, because that file already owns `public/` enumeration and reads the vendored `tokens.css` through `config.vendorDir` inside the mountless `test` service (V3: the container is the subject).

**The definition.** Split every declaration in a scanned stylesheet into a property and a value. A value is **conformant** iff, after removing `/* */` comments, it contains no *dimensional literal* (a number immediately followed by `px em rem ch ex vh vw vmin vmax pt pc cm mm in`) and no *colour literal* (`#rgb`/`#rrggbb`/`#rrggbbaa`, `rgb(`, `rgba(`, `hsl(`, `hsla(`, `oklch(`, `color(`, or a member of the CSS named-colour list). Unitless numbers, percentages, keywords (`flex`, `auto`, `inherit`, `none`, `0`), and `calc()`/`min()`/`max()`/`clamp()` compositions over `var()` references are conformant — they carry layout structure, not design values. This is exactly `wireframe.css`'s stated split and it is deliberately narrow: it does not police `display: flex` or `width: 100%`, because those are not "visual properties traced to a token" in any useful sense, and a check that fires on them gets loosened, and a loosened check is how a real one gets waved through.

**The `@media` carve-out, with teeth.** `var()` is invalid inside an `@media` condition (both `tokens.css` §breakpoints and `wireframe.css` say so). So a `px` literal is permitted in an `@media` prelude **only** when the line carries a trailing `/* --breakpoint-<name> */` comment, **and** the literal equals the value of that token as read from `tokens.css`. The check resolves the token; it does not accept the comment on faith. Writing `@media (min-width: 900px) { /* --breakpoint-md */` fails.

**Non-vacuity — cardinality before quantification, in four steps, in this order.**

1. `readdir(config.publicDir)` equals the committed list `['app.css']`. A check reading a directory nobody wrote to fails here.
2. The scanned declaration count equals a committed integer (measured by the implementer at the moment `app.css` is finished and written into the test as a literal, the `TOKENS_DECLARATIONS = 183` precedent). An empty or truncated stylesheet fails here.
3. The `var(--…)` reference count equals a committed integer. A stylesheet that dropped all its tokens fails here.
4. **The set of token names read from `join(config.vendorDir, 'tokens.css')` has exactly 183 declarations** (the number `assets.test.js` already commits) **and every `var(--name)` in `app.css` names a member of it.**

Step 4 is the half the naive check structurally cannot do and the half that matters most: CSS silently ignores an unknown custom property, so `var(--color-text-primaryy)` renders unstyled and passes any "no literals" check ever written. Falsified in §7 F5.

**Scope of the check:** `public/*.css` only. That is sound *because* P2c bans `<style>` elements and P2a bans `style=` interpolation — there is nowhere else a visual value can hide. The two guards hold each other up; say so in the test's header comment.

### §3.3 Route surface

#### §3.3.1 The two routes, and which side of the boundary

| Route | Router | Side | Why |
|---|---|---|---|
| `GET /signin` | `publicAuthRoutes` (`routes/auth.js`) | **Above** the auth boundary | It is where `requireSession` sends every signed-out visitor. A guarded sign-in page is an infinite redirect. It joins the router that already holds `POST /signin` and `POST /signup` — "the two ways in" becomes "the two ways in and the page that offers them", which keeps `app.js`'s comment 7 true. |
| `GET /connect-stripe` | `connectRoutes` (`routes/connect.js`) | **Below** the boundary | `S2-DENIED-SIGNEDOUT`: no session means a redirect to screen 1. Protected by position alone, like every other guarded route; it adds no third publicness mechanism. |

**The precedent for AS-46/47/48: a screen's GET route joins its capability's existing area router.** Invoice screens go in `routes/invoices.js`, contract screens in `routes/contracts.js`. The router already holds the repositories and the error taxonomy the screen needs, and no new mount line appears in `app.js` — so the auth boundary's mount order, which is a security boundary, is not disturbed once per screen. `routes/pages.js` stays the home for routes belonging to no capability.

#### §3.3.2 The guard's sign-in carve-out (AS-64), and `req.currentUser`

`requireSession` carries `if (req.path === SIGNIN_PATH) return next();`. Once `GET /signin` mounts **above** the boundary, the guard never sees that request, so the carve-out becomes dead for the case it was written for. **Keep it.** It still answers every unregistered method on that path (`PUT /signin`, `DELETE /signin`) — which would otherwise redirect to itself — and it costs one comparison. Its comment must be corrected from "It 404s until AS-45 lands" to what is then true (§11 item 5). §7 F8 exercises the interaction directly: moving `GET /signin` below the boundary makes the carve-out let a cookieless request through to the handler, and G3 turns red.

`GET /signin` must know whether the caller is already signed in (`S1-DENIED-AUTHENTICATED`). It **must not** read `req.currentUser` — the `'current user'` concept row pins that identifier to `lib/auth/guard.js` alone, and `routes/auth.js` reading it directly is a red test. Add one export to `guard.js`:

```js
/** Is a session present? The non-throwing counterpart to actingFreelancerId,
 *  for a PUBLIC page that renders differently for a signed-in caller. */
export function hasSession(req) { return req.currentUser !== undefined; }
```

`loadSession` is mounted at `app.js` step 3, above the public routers, so this is populated for `GET /signin`. Signed in → `303` to `safeNext(req.query.next) ?? POST_SIGNIN_LANDING`.

#### §3.3.3 `next` never touches a URL position

Flow 4 step 3 requires sign-in to land on the originally requested route. The guard supplies `?next=<encoded originalUrl>`; the handler validates it with the existing `safeNext` and passes the result (or `null`) to the template. In the template it appears **only** as `<input type="hidden" name="next" value="<%= next %>">` — a double-quoted `value=`, which P3 makes safe with EJS's five-character escape.

This forces one deviation from the wireframe, and it is deliberate: the **mode-switch control is a `<button>` inside a `method="get"` form**, not an `<a href>`. An `<a>` that preserved `next` would need it in a query string — a URL position, which P2a forbids without exception. A GET form with two hidden inputs (`mode`, `next`) is a plain full-page navigation with no JavaScript, produces the identical URL, and keeps P2a absolute with no judgment call at the call site. `wireframe.css` already carries the `.link-button` treatment (the sign-out control's precedent, `01-screens.md` §3 item 4), so it reads as the link the wireframe drew.

#### §3.3.4 `GET /`, and `POST_SIGNIN_LANDING`

The scaffold page is deleted, so `GET /` needs an answer. **`GET /` becomes a `303` to `/connect-stripe`**, staying in `routes/pages.js` below the boundary.

**`POST_SIGNIN_LANDING` stays `'/'`.** `guard.js` says the constant changes when the Dashboard route lands, and the Dashboard is AS-48's screen, not this task's. Changing it here would move assertions in another task's suite to buy one saved redirect hop. A freelancer signing in with no `next` therefore goes `/` → `303` → `/connect-stripe`, which is the correct onboarding destination until AS-48 makes it the Dashboard. Recorded in `routes/pages.js`'s header as an interim with the hand-off named.

#### §3.3.5 The whole surface, after

Sorted as `discoverRoutes` sorts. Two added, none removed; **16 → 18**.

```
GET /                          protected   (303 -> /connect-stripe)
GET /connect-stripe            protected   ADDED — screen 2
GET /connect-stripe/refresh    protected
GET /connect-stripe/return     protected
GET /healthz                   public
GET /signin                    public      ADDED — screen 1
GET /tokens.css                public
POST /clients                  protected
POST /connect-stripe/start     protected
POST /contracts                protected
POST /invoices                 protected
POST /invoices/:id             protected
POST /invoices/:id/finalize    protected
POST /invoices/:id/send        protected
POST /signin                   public
POST /signout                  protected
POST /signup                   public
POST /webhooks/stripe          public
```

Public 5 → **6**; protected 11 → **12**.

### §3.4 What a template may contain — the view-model split

**A screen is a pure view model plus a presentation-only template.** `lib/screens/<screen>-view.js` exports (a) a frozen list of the screen's rendered states and (b) a pure function from route inputs to template locals. No I/O, no clock, no `req`, no `res`. The template branches on `locals.state` — a member of that frozen list — and on nothing else; it contains no expression more complex than a property read.

Three things this buys, in descending order of importance:

1. **"Every state is reachable" becomes a mechanical property.** The frozen list is compared, by exact set equality and cardinality, against a table transcribed from `02-states-ledger.md`. There is no way to render a state the ledger does not have, or to quietly stop rendering one it does.
2. **P1–P3 stay auditable.** A template with no logic has a small, readable set of interpolation sites; a reviewer can enumerate them by eye and the concept rows can enumerate them by grep.
3. **The state machine is unit-testable without HTTP** — exhaustively, in milliseconds, before any request is made.

Each rendered state stamps `data-state="<ledger row id>"` on the page's root element. It is a double-quoted `value` attribute holding a closed enum, so P2/P3 are untouched, and it gives every HTTP-level case an exact, unique sentinel to assert on rather than a copy fragment that a wording change breaks.

### §3.5 The states, screen by screen

#### §3.5.1 Screen 1 — discharging the `renderSignIn` seam

`routes/auth.js`'s `enter()` already computes, on every failure, exactly what the screen needs: the mapped `status`, the `error` (carrying `AuthError.step`), the failing `step`, the submitted `email`, and the submitted `next`. **Do not re-derive any of it.** Replace the function body only. Two additions to the view object, both required by Flow 6 and both made at the two existing call sites:

- **`displayName`** — sign-up has a Name field and Flow 6 requires every non-sensitive submitted value to be preserved. The AS-40 obligation comment names `email` and `next`; `displayName` is the third non-sensitive field and its omission is an oversight in the comment, not a decision.
- **`invalidFields`** — an array of field names, computed in the handler from the submitted body, never by parsing a message.

**`password` is never passed and never re-rendered, in any mode, on any error** (Flow 6 step 2; the wireframe repeats it as a `field-hint`). This is the single most important line in the template and it gets its own acceptance criterion and its own test.

**The error taxonomy maps on `AuthError.step`, never on message text** — `routes/auth.js`'s own rule, and `AuthError` carries no `field`:

| `step` | Renders | Copy source |
|---|---|---|
| `invalid-email` | `S1-ERROR-VALIDATION`, email field marked | wireframe: "Enter a complete email address." |
| `weak-password` | `S1-ERROR-VALIDATION`, password field marked | wireframe: "Password must be at least 8 characters." |
| `missing-field` | `S1-ERROR-VALIDATION`, marking exactly those of the mode's fields whose submitted value is blank | banner: "N fields need attention" |
| `email-taken` | `S1-ERROR-SYSTEM`, sign-up variant, naming the email | wireframe, verbatim |
| `invalid-credentials` | `S1-ERROR-SYSTEM`, sign-in variant, **one generic message** | "Email or password is incorrect." — deliberately identical for "no such account" and "wrong password" |
| `parse-body`, anything unmapped | `S1-ERROR-SYSTEM`, generic | never `error.message` |

`missing-field` carries no field name (`AuthError` has `step` only, and `routes/auth.js` forbids reading the message). The handler derives `invalidFields` from the body — the blank ones among the mode's fields — which is honest, needs no change to `lib/auth/accounts.js`, and produces the wireframe's "N fields need attention" count. Recorded as a deviation from the wireframe's two-simultaneous-errors illustration in §9 Q2.

Screen 1's ledger, all eight rows:

| Row | How it is reached | Category (§3.6) |
|---|---|---|
| `S1-DEFAULT-SIGNIN` | `GET /signin` | offline |
| `S1-DEFAULT-SIGNUP` | `GET /signin?mode=signup` | offline |
| `S1-ERROR-VALIDATION` | `POST /signup` with a malformed email | offline |
| `S1-ERROR-SYSTEM` | `POST /signin` with wrong credentials; `POST /signup` with a taken email (both variants asserted) | offline |
| `S1-DENIED-AUTHENTICATED` | `GET /signin` with a session cookie → `303`, no render | offline |
| `S1-ABANDON` | a second `GET /signin` returns a body byte-identical to the first — no resumed draft | offline |
| `S1-LOADING` | **not implemented, and not implementable** — see §3.6 category 3 | — |
| `S1-EMPTY` | n/a row; asserted to render no section | offline (asserted absent) |

#### §3.5.2 Screen 2 — a pure function of the stored row

`GET /connect-stripe` reads `repos.connectedAccounts.getByFreelancer(actingFreelancerId(req))` and renders. **It makes no Stripe call.** AS-41's rule is that readiness is written only from a snapshot freshly obtained by the request that writes it — creation and return are the sync moments; a page view is not one. (A Stripe call from a route would also fail the `'platform Stripe call'` concept row, which pins `platform: true` to `lib/connect/onboarding.js`.)

The mapping is total over the row:

| Row state | Rendered ledger row |
|---|---|
| `null` (no connected account) | `S2-DEFAULT-NOTSTARTED` |
| `row.ready === true` | `S2-RETURN-READY` |
| `row.ready === false` | `S2-RETURN-NOTREADY` |

`ready` is `chargesEnabled && requirementsCurrentlyDue.length === 0`, derived in exactly one place (`lib/db/repositories/connected-accounts.js`'s mapper). The screen reads the boolean and does not re-derive it — that is the same "one place" rule AS-41 wrote it for.

**The `S2-ABANDON` divergence, stated plainly.** The ledger says `S2-ABANDON` "renders `S2-DEFAULT-NOTSTARTED` again — we were never told anything changed." That was written assuming no row exists until Stripe redirects back. AS-41 creates the row *at start*, before the first account link is minted. So after a genuine abandonment a row exists and is not ready, and the honest render is `S2-RETURN-NOTREADY` — "Stripe still needs more information; finish setup" — whose button posts to the same `POST /connect-stripe/start`, which Stripe resumes at the freelancer's own last point, exactly as the ledger's prose describes. Telling a freelancer with a half-built Stripe account "Connect your Stripe account" as if nothing had happened would be the less accurate of the two.

The alternative — distinguishing "arrived via Stripe's return" from "wandered back" — requires a marker on the redirect, and any marker in a URL is client-supplied, so a freelancer could produce either state at will. **Rejected: the screen renders the row, and how the visitor arrived is not a state it may read.** `S2-ABANDON` is therefore a *reachability path* into one of the three row-derived renders, not a fourth render. Proposed ledger amendment wording in §9 Q3.

Screen 2's ledger, all nine rows, partitioned:

| Row | How it is reached | Partition |
|---|---|---|
| `S2-DEFAULT-NOTSTARTED` | signed in, no `connected_accounts` row | rendered (4) |
| `S2-RETURN-READY` | row seeded `chargesEnabled: true`, `requirementsCurrentlyDue: []` | rendered (4) |
| `S2-RETURN-NOTREADY` | row seeded `chargesEnabled: false` **and** separately `chargesEnabled: true` with a non-empty `requirementsCurrentlyDue` (both halves of `ready`) | rendered (4) |
| `S2-ERROR-SYSTEM` | `GET /connect-stripe?error=start` — the documented URL (§3.5.3) | rendered (4) |
| `S2-DENIED-SIGNEDOUT` | cookieless `GET /connect-stripe` → guard `303` `/signin?next=%2Fconnect-stripe` | redirect-answered (2) |
| `S2-REFRESH` | `GET /connect-stripe/refresh` → `303` into a fresh Stripe link; its own content is never seen | redirect-answered (2) |
| `S2-ABANDON` | direct `GET /connect-stripe` after an abandoned KYC → renders `S2-RETURN-NOTREADY` (above) | path into a render (1) |
| `S2-LOADING` | not rendered by this app at all (§3.6 category 3) | unrenderable (1) |
| `S2-EMPTY` | n/a row; asserted to render no section | n/a (1) |

`4 + 2 + 1 + 1 + 1 = 9`. The test asserts that arithmetic against a committed table, so a row appearing or vanishing in `02-states-ledger.md` §2 turns it red.

#### §3.5.3 `S2-ERROR-SYSTEM` and the gap this task does not close

The wireframe wants an error banner and a "Try again" control on screen 2 when the account-link call fails. Today `POST /connect-stripe/start` answers that with `502 text/plain "StripeApiError: mint-onboarding-link"`.

Making the POST redirect into the screen means changing `routes/connect.js`'s failure landing, which `test/connect.test.js` pins by status at four places. That is another task's committed assertions and another task's stated decision ("error bodies are one-line `text/plain`; screens render states from the DB row, not from these bodies"), and this task's description says the server halves are not in it.

**Decision: render the state, do not rewire the POST.** `GET /connect-stripe?error=start` renders `S2-ERROR-SYSTEM` — a documented URL, which the VERIFICATION clause explicitly admits as a reachability mechanism. The parameter is treated as a *presence* flag selecting a state; **its value is never echoed to the page**, and the copy is a constant. The remaining gap — a freelancer who hits a real Stripe failure sees a `text/plain` 502 instead of that URL — is filed as its own task (§11 item 8) rather than left in a plan file, because a gap recorded only in a plan file is a gap nobody will find.

### §3.6 Reachability, in three categories

**1 — Reachable in the offline suite** (`docker compose run --rm test`, `network_mode: none`, no accounts, no egress). Every rendered state of both screens, every redirect-answered state, both n/a assertions: 7 of screen 1's 8 rows and 8 of screen 2's 9. Screen 2's Stripe-derived states are reachable offline *because the screen renders the stored row* — the suite seeds `connected_accounts` through `deps.repos` (which `withServer` hands the test) and calls `updateReadiness` with a fabricated snapshot, which is precisely the shape AS-41's own tests already use.

**2 — Needs stripe-mock** (`docker compose run --rm contract`). Nothing new. The behaviour behind `S2-LOADING` and `S2-REFRESH` — that `POST /connect-stripe/start` and `GET /connect-stripe/refresh` really redirect to a Stripe-issued URL with a request shape Stripe's own validator accepts — is already covered by AS-38's and AS-41's cases. **This task adds no stripe-mock case and must not duplicate one.** The one thing to verify here is negative and cheap: the `contract` service still passes with these screens in the image.

**3 — Not exercisable offline, and named rather than silently untested.**

- **`S1-LOADING` and `S2-LOADING` are not implemented, and cannot be, under the standing no-client-side-JavaScript assumption.** "Fields disabled, button reads *Signing in…*" is a state a page enters *after* its bytes were served; producing it requires JavaScript on submit. With no JavaScript, the interval between submit and the server's `303` is the browser's own loading indicator, and this app emits no bytes during it. Verified that the assumption still holds (P2c: zero `<script>` in the tree) and **these screens do not change it.** The rows are marked in the test's committed table as `unrenderable — browser-supplied`, so their absence is an assertion rather than a gap.
- **The real hosted round trip** — a genuine Stripe account moving `not-ready → ready` through `return_url` — belongs to the acceptance run (AS-49), as the VERIFICATION clause says. Offline, the *transition* is exercised by seeding both sides of it; the *hosted flow* is not.
- **Visual judgment at 375px** (§3.7).

### §3.7 Responsive at 375px, before desktop

**Half of it is mechanical, and that half is stated as what it does and does not establish.** In `test/screens.test.js`:

1. Every template carries `<meta name="viewport" content="width=device-width, initial-scale=1">`. (Without it, mobile Safari renders at 980px and every other check is theatre.)
2. `app.css` contains **zero `max-width` media conditions**. Every `@media` is `min-width`. Therefore the base ruleset *is* the ruleset at 375px, by construction.
3. The smallest `min-width` used is **≥ 480px**. Therefore no rule anywhere applies differently between 320px and 480px, and 375px is inside the base ruleset with margin on both sides.
4. No fixed-width box: zero declarations matching `(width|min-width|flex-basis)\s*:\s*\d+(px|rem|em)` outside `@media` preludes, excluding `max-width` (which bounds rather than forces).

Together these establish: **at 375px the page is rendered by the base ruleset alone, and that ruleset contains no box that can force horizontal overflow.** That is a real property and it is the one AS-23 got wrong.

**They do not establish** that the result is legible, that the tap targets are reachable, that a long unbroken string (an email address in a banner) wraps, or that the visual hierarchy survives. Those need eyes on pixels, and there is no browser in the suite.

**So the remaining half is verified by inspection, and the inspection is recorded** — the `AS-30` precedent, where the rendering pass was written into a Lattice comment. The implementer runs `docker compose up`, opens both screens at a 375px viewport in **every state of both ledgers that renders**, and records in a Lattice comment on AS-45: the viewport used, each state observed, and any state where text overflowed, wrapped badly, or a control fell off. A state that was not looked at is named as not looked at. This is not a substitute for the mechanical half and does not pretend to be; it is the half a test cannot do, and its output is a written record rather than a green tick.

## §4 Config changes

**None.** `SCHEMA` stays at 11 rows and `test/config.test.js:21`'s `assert.equal(SCHEMA.length, 11)` does not move. Both screens read `config.viewsDir` and `config.publicDir`, which already exist; neither needs a new setting, a new secret, or a new path. `Dockerfile` `COPY`s `views/` and `public/` as whole directories, so no manifest literal moves either.

*(Note for the reviewer: this task's brief said `lib/config.js` carries a `VIEWS` count that `config.test.js` pins. It does not — see §11 item 1. `VIEWS` lives in `lib/views.js` and is pinned by `test/health.test.js:46-47`.)*

## §5 Key files, and every literal that moves

### Literals that move

| File | Literal | From | To |
|---|---|---|---|
| `test/auth.test.js` | `ALL_ROUTES` array | 16 entries | 18 — adds `'GET /connect-stripe'`, `'GET /signin'`, sorted |
| `test/auth.test.js` | G1 cardinality `assert.equal(found.length, 16, …)` | 16 | 18 |
| `test/auth.test.js` | G1b cardinality `assert.equal(found.length, 15, …)` | 15 | 17 |
| `test/auth.test.js` | `PUBLIC_ROUTES` array | 5 entries | 6 — adds `'GET /signin'` with its reason comment |
| `test/auth.test.js` | G2's expected protected list | 11 entries | 12 — adds `'GET /connect-stripe'` |
| `test/auth.test.js` | G3 `assert.equal(protectedRoutes.length, 11, …)` | 11 | 12 |
| `test/auth.test.js` | G6's `/scaffold.css` fetch | `scaffold.css` | `app.css` |
| `test/harness.test.js` | `EXPECTED_TEST_FILES` | 16 entries | 17 — adds `'screens.test.js'` |
| `test/harness.test.js` | V2 cardinality `assert.equal(found.length, 16, …)` | 16 | 17 |
| `test/health.test.js` | `assert.equal(VIEWS.length, 1)` | 1 | 2 |
| `test/health.test.js` | `assert.deepEqual(VIEWS.map(v => v.file), ['scaffold.ejs'])` | `['scaffold.ejs']` | `['connect-stripe.ejs', 'signin.ejs']` (order must match `VIEWS`) |
| `test/health.test.js` | the broken-template fixture filename `'scaffold.ejs'` and its `/scaffold/` detail match | `scaffold` | `signin` |
| `test/assets.test.js` | `PUBLIC_FILES` | `['scaffold.css']` | `['app.css']` |
| `test/assets.test.js` | the `readFile(join(config.publicDir, 'scaffold.css'))` in the token check | `scaffold.css` | `app.css` |
| `test/dependency-policy.test.js` | app-source cardinality `assert.equal(source.length, 49, …)` | 49 | **52** (49 − 2 deleted + 5 created) |
| `test/dependency-policy.test.js` | the 49-entry source list | — | −2 (`public/scaffold.css`, `views/scaffold.ejs`), +5 (`lib/screens/connect-view.js`, `lib/screens/signin-view.js`, `public/app.css`, `views/connect-stripe.ejs`, `views/signin.ejs`) → net +3, sorted. **Recount on the day; the number above is arithmetic, the test's failure message prints the truth** |
| `test/dependency-policy.test.js` | the concept-row test title `'the concepts live exactly where AS-38 … and AS-44 put them'` | — | append `AS-45` |
| `test/assets.test.js` | token-check case title | `'public/ styles reference tokens rather than re-typing values'` | `'every visual value in public/ CSS traces to a token that exists'` |

Two of these need care. **52 is a prediction, not a measurement** — it is 49 − 2 + 5, and it is only right if §2's file list is built exactly as written. Recompute it from the walker's own failure message, which prints the exact list it found; a number copied from a plan without measuring is precisely the failure this repo keeps logging, and a mismatch between 52 and the truth is worth a sentence in the implementation comment. Likewise `VIEWS.map(v => v.file)` must be asserted in `VIEWS`'s own declaration order, not alphabetical order, unless `VIEWS` happens to be written alphabetically.

### The not-moving set — stated as a claim, so a diff that moves one is a finding

- `test/config.test.js`'s `assert.equal(SCHEMA.length, 11)` — no config row is added.
- `test/dependency-policy.test.js`'s `LOCK_ENTRIES = 70`, `DIRECT_DEPENDENCIES = ['ejs', 'express']`, the exact pins `express 5.2.1` / `ejs 6.0.1`, `SANCTIONED.length = 3`, and the manifest list `['Dockerfile', 'compose.yaml', 'package.json']`. **No dependency is added.** Everything here is EJS, CSS and Node built-ins.
- `test/assets.test.js`'s `TOKENS_BYTES = 12199` and `TOKENS_DECLARATIONS = 183`. `tokens.css` is vendored read-only and is not edited by this task.
- `test/dependency-policy.test.js`'s existing concept-row allowlists: **`'money representation'`, `'raw SQL'`, `'body parser'`, `'platform Stripe call'`, `'current user'`, `'contract HTML escape'`, `'console output'` all keep exactly their current members.** In particular no view file, no view model and no route joins the money row (§7 F7) or the body-parser row (a GET needs no parser).
- `lib/auth/guard.js`'s `SIGNIN_PATH = '/signin'` and `POST_SIGNIN_LANDING = '/'` — both values unchanged (§3.3.4).
- `test/connect.test.js` — **not modified at all.** If a change to it becomes necessary, the scope boundary in §1 has been crossed and the task stops.
- `Dockerfile`, `compose.yaml`, `package.json`, `package-lock.json`, `app.js`, `test/deploy-shape.test.js`, `test/clients.test.js`, `test/contracts.test.js`, `test/invoices.test.js`, `test/webhooks.test.js`, `test/db.test.js`, `test/repositories.test.js`, `test/stripe-client.test.js`, `test/stripe-mock.test.js`.

### The money-word landmine — read this before writing a line of the template

`02-states-ledger.md` §2's copy for `S2-DEFAULT-NOTSTARTED` reads: *"We never hold or move your clients' **money** — Stripe pays you directly."* The `'money representation'` concept row scans **raw text, comments included**, with `/amount|currency|money/i`, and its allowlist is seven files, none of them a view. Putting that sentence in `views/connect-stripe.ejs` turns the suite red.

**Do not add the view to the allowlist** — the row exists to confine money *representation* to the files that handle integer minor units, and a template that merely says the word would sit in that allowlist forever under the used-exemption rule. **Do not narrow the pattern** — narrowing `/money/i` so it stops matching the word "money" defeats it.

**Reword to "funds."** `00-flows.md` Flow 2 step 1 already uses exactly that word for exactly this sentence — *"what 'connect' means and what it does not (we never hold funds — this is board constraint 7 and belongs in the copy)"* — so the flow's own wording is the fix, not an invention. The sentence becomes: *"We never hold or move your clients' funds — Stripe pays you directly."* Record the substitution in a Lattice comment, and watch the same three words in `app.css` comments and in every view model.

## §6 Acceptance criteria

The VERIFICATION clause from the task description, **verbatim**:

> VERIFICATION: screens render sensibly at 375px before desktop widths (front-end design plan section 5.4, the lesson of AS-23); every visual property traces to a named token, no magic values (section 5.1); every state in the ledger is reachable in a test or at a documented URL; the flow works against the local compose stack with no accounts — Connect start is exercised against stripe-mock, and the real hosted round trip belongs to the acceptance run.

Numbered, each independently checkable:

**Escaping and the view layer**

1. `<%-` occurs in zero scanned files. A concept row in `test/dependency-policy.test.js` enforces it with a keyed, counted, line-pinned allowlist holding **zero** entries, and the allowlist's cardinality is asserted before it is used.
2. No interpolation appears inside an `href`, `src`, `action`, `formaction` or `style` attribute value; no `on*` attribute exists in `views/` or `public/`; no `<script>` or `<style>` element exists in `views/` or `public/`. Three rows, three measured-zero baselines.
3. Every attribute value in `views/` that carries an interpolation is double-quoted.
4. A request whose user-controlled value contains markup renders it as text: the served bytes contain the escaped form and **zero** occurrences of the raw form (asserted with `grep -oF … | wc -l`-style occurrence counting, not a boolean `includes`).
5. `password` is absent from every response body on both modes of screen 1, on success and on every failure path, and no template contains an interpolation into a password input's `value`.

**Tokens**

6. `readdir(publicDir)` equals `['app.css']`; the scanned declaration count and `var()` reference count each equal a committed integer; `tokens.css` in the image yields exactly 183 declarations — **all four asserted before any conformance is quantified.**
7. No declaration value in `app.css` contains a dimensional or colour literal, per §3.2's definition.
8. Every `var(--name)` in `app.css` names a custom property that exists in the vendored `tokens.css`.
9. Every `px` literal in an `@media` prelude carries a `/* --breakpoint-<name> */` comment **and** equals that token's value as read from `tokens.css`.

**States**

10. `lib/screens/signin-view.js` and `lib/screens/connect-view.js` each export a frozen state list; each list's cardinality and membership equal a committed table transcribed from `02-states-ledger.md` §1 and §2.
11. Screen 1: all 8 ledger rows accounted for — 6 exercised over HTTP with a `data-state` sentinel or an asserted `303`, 1 asserted absent (`S1-EMPTY`), 1 recorded as browser-supplied and unrenderable (`S1-LOADING`).
12. Screen 2: all 9 ledger rows accounted for — the `4 + 2 + 1 + 1 + 1 = 9` partition of §3.5.2 asserted as arithmetic against a committed table.
13. `S2-RETURN-NOTREADY` is exercised through **both** halves of `ready`: `chargesEnabled: false`, and `chargesEnabled: true` with a non-empty `requirementsCurrentlyDue`.
14. `S2-ERROR-SYSTEM` renders at `GET /connect-stripe?error=start`, and the parameter's value appears nowhere in the response body.
15. `S1-ABANDON`: two successive `GET /signin` requests return byte-identical bodies.

**Route surface and the boundary**

16. The route walk finds exactly 18 routes; the public/protected partition is 6/12; `GET /signin` is public and `GET /connect-stripe` is protected, each with its reason recorded in the array.
17. G3 passes unchanged for all 12 protected routes — each cookieless answer is attributable to the guard (same status, no `Set-Cookie`, guard-derived `Location`).
18. A cookieless `GET /connect-stripe` redirects to `/signin?next=%2Fconnect-stripe`, and following that redirect renders screen 1 in sign-in mode carrying `next` in a hidden input with that value.
19. A `GET /signin` **with** a session redirects (`S1-DENIED-AUTHENTICATED`) and renders no form.
20. `GET /` answers `303` to `/connect-stripe` for a signed-in caller.

**Responsive**

21. Both templates carry the `width=device-width, initial-scale=1` viewport meta.
22. `app.css` has zero `max-width` media conditions; the smallest `min-width` is ≥ 480px; no fixed-width box outside a media prelude.
23. A Lattice comment records the 375px inspection: the viewport used, every rendered state looked at, and every rendered state not looked at.

**Housekeeping and non-regression**

24. `views/scaffold.ejs` and `public/scaffold.css` are deleted; all five `AS-45 OBLIGATION` markers are gone from the tree (`grep -rn 'AS-45 OBLIGATION\|AS-45 obligation'` returns zero hits outside `.lattice/`).
25. `VIEWS` has two rows, each with `sampleLocals` that render; `/healthz` returns 200 and its `views` check passes with both new templates.
26. The full offline suite passes inside `docker compose run --rm test`: **17** test files, and no literal in §5's not-moving set has changed.
27. `docker compose run --rm contract` still passes, with no stripe-mock case added or modified.
28. No new dependency; `express 5.2.1` and `ejs 6.0.1` remain the only two.
29. `apps/invoicing/README.md` documents the view layer (§10) and its Obligations section no longer names AS-45.
30. Every §7 recipe has been run in both directions, with its assert-applied grep count and its observed failing set recorded in a Lattice comment.

## §7 Falsification recipes

**Rules, from eight recurrences across the last nine tasks.**

- Assert on a **marker the mutation introduces**, or an occurrence-accurate count — `grep -oF … | wc -l`, **never** `grep -c` (which counts matching *lines*, not matches).
- Every grep below was run against the tree at `df3778b` before its number was written down. Numbers that describe files this task creates are marked *(post-write)* and must be measured by the implementer at the moment the file is finished — never copied from here.
- Mutate a **scratch copy** where possible. Where the mutation must be in place: back up, `trap` the restore on `EXIT`, mutate, **assert the mutation applied**, run, let the trap restore, prove the tree with `git diff --exit-code`, then **rebuild the image and re-run** — a restored source tree with a stale mutant image has produced phantom failures here before.
- Predicted failing sets name **executable case names**. The cases below that do not exist yet are cases **this plan requires the implementer to create with exactly these titles**; a differently-titled case is a finding, not a nitpick.
- Record cardinality (how many files/cases were examined) before quantification (how many passed).

---

**F1 — markup out of a user-controlled value reaches the page (mandatory for a rendering task).**
The direction: a value the freelancer typed becomes markup in the response.

*Baseline (no mutation).* Submit `POST /signup` with `displayName` = `ASC45MARK"><b>x</b>`, an email of `not-an-email` (so the page re-renders in sign-up mode), and a valid password.
Assert on the served bytes: `grep -oF 'ASC45MARK&#34;&gt;&lt;b&gt;' | wc -l` **= 1** and `grep -oF 'ASC45MARK"><b>' | wc -l` **= 0**. Then assert `grep -oF 'password' | wc -l` finds no `value=` beside it (AC 5).
*Mutation.* In `views/signin.ejs` change the one `<%= displayName %>` to `<%- displayName %>`. Assert applied: `grep -oF '<%- displayName %>' views/signin.ejs | wc -l` **= 1**.
*Predicted failing set, exactly two cases:* `screens.test.js` → `'a value containing markup is rendered as text, not as markup'`; `dependency-policy.test.js` → `'the concepts live exactly where AS-38 … AS-44 and AS-45 put them'` (the P1 row, reporting `views/signin.ejs`). A wider or narrower set is itself a finding.

**F2 — the P1 raw-output row fires (breaks a guard this task introduces).**
*Mutation.* Append `<%- state %>` inside `views/connect-stripe.ejs`'s root element. Assert applied: `grep -oF '<%- state %>' views/connect-stripe.ejs | wc -l` **= 1**.
*Predicted failing set:* one case, `dependency-policy.test.js` → the concept-row case, whose message must name `views/connect-stripe.ejs` and the row `'EJS raw output'`.
*Second direction, the used-exemption half.* Add a `SANCTIONED`-shaped entry for that exact line and re-run: the suite goes green. Remove the `<%- state %>` but leave the entry: the suite must go red again with "the entry is stale". If it does not, the allowlist is not counted and the mechanism is decorative.

**F3 — the P2a attribute-position row fires (breaks a guard this task introduces).**
*Pre-measured baseline on the tree at `df3778b`:* `perl -ne 'print if /(href|src|action|formaction|style)\s*=\s*"[^"]*<%/' views/*.ejs` returns **1** line — `views/scaffold.ejs:38`. After the scaffold is deleted it returns **0**. (Note: a `grep -rnE` over two directories returned 0 for this same pattern during planning, which was wrong; `perl -ne` was the instrument that told the truth. Use `perl -ne` or verify the grep on a known-positive file first — this is a live example of why every grep is run before its number is written down.)
*Mutation.* In `views/signin.ejs` change the mode-switch form's `action="/signin"` to `action="<%= next %>"`. Assert applied: `grep -oF 'action="<%= next %>"' views/signin.ejs | wc -l` **= 1**.
*Predicted failing set:* one case, the concept-row case, naming `views/signin.ejs` and the row `'interpolation in a URL or style attribute'`.

**F4 — the token check fires on a magic value (breaks a guard this task introduces, in the direction the old check could not).**
Run as **two separate mutations**, because they exercise two halves.
*(a) colour.* Add `color: #ff0000;` to the `.banner-error` rule in `public/app.css`. Assert applied: `grep -oF 'color: #ff0000;' public/app.css | wc -l` **= 1**.
*(b) dimension.* Add `padding: 12px;` to the same rule. Assert applied: `grep -oF 'padding: 12px;' public/app.css | wc -l` **= 1**.
*Predicted failing set, each time:* one case, `assets.test.js` → `'every visual value in public/ CSS traces to a token that exists'`.
**(b) is the one that matters.** The check being replaced (`hexLiterals` + `includes('var(--')`) catches (a) and sails past (b). Record both observations; if (b) does not turn the suite red, the replacement did not happen.

**F5 — the token check fires on a token name that does not exist (the half no "no literals" check can do).**
*Mutation.* Change one `var(--color-text-primary)` in `app.css` to `var(--color-text-primaryy)`. Assert applied: `grep -oF 'var(--color-text-primaryy)' public/app.css | wc -l` **= 1**.
*Predicted failing set:* one case, the same `assets.test.js` case, with a message naming the unresolved token. CSS ignores unknown custom properties silently, so without this the page renders unstyled and every other check stays green.

**F6 — the breakpoint carve-out is not a rubber stamp.**
*Mutation.* Change one `@media (min-width: 480px) { /* --breakpoint-sm */` to `@media (min-width: 500px) { /* --breakpoint-sm */`. Assert applied: `grep -oF 'min-width: 500px' public/app.css | wc -l` **= 1**.
*Predicted failing set:* one case, the same `assets.test.js` case, reporting that `500px` does not equal `--breakpoint-sm`'s `480px`. If it passes, the check is reading the comment and not the token.

**F7 — an existing guard fires, in the direction it exists to catch (the live hazard on this task).**
*Pre-measured baseline:* `grep -oiE 'amount|currency|money' docs/design/wireframes/screen-2-connect-stripe.html | wc -l` = **1** (line 58, the copy). `grep -oiE 'amount|currency|money' apps/invoicing/views/*.ejs apps/invoicing/public/*.css | wc -l` must be **0** *(post-write)*.
*Mutation.* Change "funds" back to "money" in `views/connect-stripe.ejs`. Assert applied: `grep -oiF money views/connect-stripe.ejs | wc -l` **= 1**.
*Predicted failing set:* one case, the concept-row case, with the `'money representation'` row reporting `views/connect-stripe.ejs` as an unexpected member.

**F8 — the boundary guard fires on a misplaced screen route (the AS-64 carve-out interaction).**
*Mutation.* Move `router.get('/signin', …)` out of `publicAuthRoutes` and into `sessionAuthRoutes` — below the boundary — with no other change.
Assert applied: `grep -c "router.get('/signin'" routes/auth.js` = 1 and it sits inside `sessionAuthRoutes` (verify by line number against the `export function sessionAuthRoutes` line).
*Predicted failing set, exactly two cases:* `auth.test.js` → `G2` (the protected list no longer matches its literal) and **`G3`** (a cookieless `GET /signin` is let through by `requireSession`'s carve-out, reaches the handler, and answers `200` instead of the guard's `303`). G3 is the meaningful one: it is the assertion that would catch a future screen route placed on the wrong side, and it demonstrates that the carve-out and the mount position interact.

**F9 — the responsive floor fires.**
Two mutations, run separately.
*(a)* Add `@media (max-width: 400px) { .container { padding-inline: var(--space-1); } }` to `app.css`. Assert applied: `grep -oF 'max-width: 400px' public/app.css | wc -l` **= 1**. Predicted: `screens.test.js` → `'app.css is mobile-first: every media condition is min-width, and none is below 480px'`.
*(b)* Change one rule to `min-width: 420px` in an `@media` prelude. Assert applied by the same grep shape. Predicted: the same case, on the ≥ 480px half.

**F10 — the no-JavaScript guard fires.**
*Mutation.* Insert `<script>1</script>` before `</body>` in `views/signin.ejs`. Assert applied: `grep -oF '<script>1</script>' views/signin.ejs | wc -l` **= 1**.
*Predicted failing set:* one case, the concept-row case, P2c row. This is the standing assumption made mechanical: the app has zero client-side JavaScript today (measured: 0 occurrences of `<script` in `views/` and `public/`) and these screens do not change it.

**F11 — the state table is not decorative.**
*Mutation.* Delete the `S2-RETURN-NOTREADY` branch from `views/connect-stripe.ejs`. Assert applied: `grep -oF 'S2-RETURN-NOTREADY' views/connect-stripe.ejs | wc -l` **= 0** (a count of zero after a non-zero baseline; measure the baseline first *(post-write)*).
*Predicted failing set, at least three cases:* the two `S2-RETURN-NOTREADY` HTTP cases (both halves of `ready`, AC 13) and the partition-arithmetic case `'screen 2's nine ledger rows partition 4 + 2 + 1 + 1 + 1'`. Fewer than three means a state is being asserted by only one path.

**F12 — the vacuity floor still holds.** `docker compose run --rm -e ASC_SELFTEST_MUTATE=1 test` exits 1; `docker compose run --rm test` exits 0. Run at the start and the end. The suite is 17 files by then, and `harness.test.js`'s V2 case is what proves the new one is in it.

## §8 Size, complexity, and the pre-agreed split line

**The description's 450-line projection is wrong, and knowingly so.** It was written before the view layer existed. Re-projected against the files in §2:

| Area | Lines |
|---|---|
| `views/signin.ejs` | ~95 |
| `views/connect-stripe.ejs` | ~70 |
| `public/app.css` | ~280 |
| `lib/screens/*.js` (2 files) | ~125 |
| `routes/auth.js`, `routes/connect.js`, `routes/pages.js`, `lib/views.js`, `lib/auth/guard.js` (net) | ~110 |
| `test/screens.test.js` | ~450 |
| edits to `auth`, `health`, `assets`, `dependency-policy`, `harness` tests | ~110 |
| `apps/invoicing/README.md` | ~60 |
| **Total** | **≈ 1,300** |

That is roughly 3× the projection, and it is the honest number: the ~450 was two screens' markup, and this task is two screens' markup *plus* the view layer four tasks inherit. Complexity stays **medium** — nothing here is algorithmically hard, there is no concurrency, no external call, and no new dependency — but the diff is large and the review surface is wide.

**The pre-agreed split line, decided now so it is not decided under pressure.** The natural seam is not "screen 1 vs screen 2" (they share the stylesheet and the entire mechanism); it is **the view layer + screen 1** against **screen 2**.

> **Split trigger:** at the moment screen 1 is complete and green — templates, `app.css`, the view model, the three concept rows, the strengthened token check, `test/screens.test.js`'s screen-1 half, the scaffold retirement, and the route-surface literals for `GET /signin` — the implementer measures `git diff --stat master...feat/AS-45-onboarding-ui`. **If it exceeds 900 changed lines, stop.** Commit, move AS-45 to `review` for that scope, and file `AS-45b: D1 v1 UI: onboarding screen 2 (Connect Stripe)` carrying §3.5.2, §3.5.3, §3.6 and ACs 12–14 verbatim, with a `depends_on` edge to AS-45.
>
> If it is at or under 900, carry on and land both. Do **not** split anywhere else — splitting mid-mechanism (e.g. "escaping rows now, token check later") would ship a guard that has never been falsified, which is the one thing this plan exists to prevent.

**Do the mechanism first, in this order**, so a split at the trigger leaves a coherent unit: (1) retire the scaffold and land the three concept rows with their measured-zero baselines; (2) `app.css` and the strengthened token check; (3) screen 1's view model, template, route and tests; (4) **measure, decide the split**; (5) screen 2.

## §9 Open questions, each with a default and a deadline

**Q1 — Do templates get partials?** *Default: no* (§3.1). Two self-contained templates now; four more later. **Revisit at AS-48**, when all seven screens exist: if the duplicated `<head>`+chrome block exceeds 20 lines per screen, or if a change to it has already had to be made in more than three files at once, propose `<%- include %>` as a counted `SANCTIONED` entry with a line-pinned regex admitting only `<%- include('<literal>'[, {…}]) %>`. Until then the duplication is real and accepted, and the "every template links both stylesheets and carries the viewport meta" assertion is what protects it.

**Q2 — Two simultaneous field errors.** The wireframe's `S1-ERROR-VALIDATION` shows "2 fields need attention" with two fields marked. `lib/auth/accounts.js` throws on the first failure, so at most one *server-validated* error is available per submit; the `missing-field` case can mark several (all blank fields), so the plural banner is reachable but a "bad email **and** short password" pair is not. *Default: implement what the server can tell us, render the count honestly (1 or N), and do not invent a second error.* Changing `accounts.js` to collect errors is AS-40's module and a separate decision. **Deadline: settled at implementation; if the reviewer disagrees it is a plan-level finding, not an implementation one.**

**Q3 — The `S2-ABANDON` ledger divergence.** *Default: implement §3.5.2's reading (the screen renders the row) and do not edit Jonah's document.* Proposed amendment, recorded here so it exists in writing:

> `S2-ABANDON` | ABANDON | Freelancer closes the tab mid-Stripe-KYC, later returns directly (not via a Stripe redirect) | Renders whichever state the stored row implies. **Since AS-41 creates the connected-account row at *start*, before the first link is minted, that is `S2-RETURN-NOTREADY` in practice** — Stripe holds whatever partial progress was made, and "Finish setup on Stripe" resumes them there. `S2-DEFAULT-NOTSTARTED` renders only when no row exists at all, i.e. the click never reached account creation. This row is a reachability path into an existing render, not a render of its own.

**Deadline: AS-49 (the acceptance run) at the latest** — the recorded run walks this exact path, and the ledger and the product must agree by then. Route to Jonah (`agent:ux-jonah`) as a documentation follow-up.

**Q4 — Does `?error=` belong on screen 2 at all, long-term?** *Default: yes for now, as a documented reachability URL (§3.5.3), until the follow-up task (§11 item 8) wires `POST /connect-stripe/start`'s failure into the screen properly.* At that point the query parameter may be retired or kept as the redirect target; that task decides. **Deadline: whenever that task is planned.**

**Q5 — `POST_SIGNIN_LANDING`.** *Default: unchanged at `'/'`, with `GET /` redirecting to `/connect-stripe` (§3.3.4).* **Deadline: AS-48**, which owns the Dashboard and the constant.

## §10 Proposed metawork wording

**For `CLAUDE.md`: none, and that is a decision.** The escaping guarantee, the token rule and the screen-route convention are engineering conventions for one app, not company operating rules, and `CLAUDE.md` is already long enough that adding app-level detail to it makes the parts that *are* company-wide harder to find. They belong in `apps/invoicing/README.md`, which is not a protected top-level file and which the implementer edits directly. If the implementer nonetheless believes a `CLAUDE.md` change is warranted, the metawork rule applies: record the exact wording in a Lattice comment, do not edit the file.

**For `apps/invoicing/README.md`, a new section — this is the artifact AS-46, AS-47 and AS-48's planners will read first:**

> ## The view layer
>
> Screens are server-rendered EJS. There is no client-side JavaScript in this app and no build step; the two direct dependencies are still `express` and `ejs`.
>
> **Three properties hold over every file in `views/`, and each is a concept row in `test/dependency-policy.test.js` rather than a convention:**
>
> 1. **No raw output.** `<%-` occurs nowhere. Every interpolation is escaped by EJS. Raw output is not banned outright — it is gated by a keyed, counted, line-pinned allowlist that currently holds zero entries. Adding an entry is a deliberate, reviewable change that sanctions one exact line and cannot absorb a second.
> 2. **No interpolation where escaping is not enough.** Never inside an `href`, `src`, `action`, `formaction` or `style` attribute value; no `on*` attributes; no `<script>` or `<style>` elements. A path that must survive a round trip (`next`) travels in a hidden `value=` input, never in a URL.
> 3. **Attribute values carrying data are double-quoted**, because escaping `"` only helps if `"` is the delimiter.
>
> **A screen is a pure view model plus a presentation-only template.** `lib/screens/<screen>-view.js` exports a frozen list of the screen's states — whose members are the row IDs from `docs/design/wireframes/02-states-ledger.md` — and a pure function from route inputs to locals. The template branches on `locals.state` and nothing else, and stamps `data-state` on its root element so tests assert on a sentinel rather than on copy.
>
> **A screen's GET route joins its capability's existing area router** (`routes/invoices.js` for invoice screens, and so on), never a new mount in `app.js` — the mount order in `app.js` is a security boundary and should not be disturbed once per screen. Screens above the auth boundary live in `publicAuthRoutes`; everything else is protected by position.
>
> **Every visual value in `public/*.css` is a `var(--token)` reference to a custom property that exists in the vendored `tokens.css`.** No colour literals, no dimensional literals. `@media` preludes are the one exception (`var()` is invalid in a media condition): a `px` literal there must carry a `/* --breakpoint-<name> */` comment and must equal that token's value, which `test/assets.test.js` resolves rather than takes on trust. Stylesheets are mobile-first — every media condition is `min-width` and none is below `--breakpoint-sm`, so the base ruleset is the ruleset at 375px.

**And in the Obligations section:** the five `AS-45 OBLIGATION` markers are removed and replaced by a one-line record that AS-45 discharged them (the scaffold page, its stylesheet, its `VIEWS` row, its `routes/pages.js` handler, and the `renderSignIn` seam), so a reader does not go looking for a page that no longer exists.

## §11 Stale items found while planning

1. **This task's brief said `lib/config.js` carries a `VIEWS` count that `test/config.test.js` pins. It does not.** `VIEWS` lives in `lib/views.js`; the pins are `test/health.test.js:46-47`. `test/config.test.js` pins `SCHEMA.length = 11`, which this task does not move. Corrected in §4 and §5 so the implementer does not go looking in the wrong file.
2. **`test/assets.test.js`'s existing token check is the naive one this plan warned about.** `hexLiterals == []` plus `body.includes('var(--')` passes on a stylesheet full of `px` values and one `var()`. Replaced in place (§3.2), falsified in F4(b).
3. **`docs/design/wireframes/02-states-ledger.md` §2's `S2-ABANDON` row is stale** against what AS-41 actually built (§3.5.2). Amendment wording in §9 Q3; not applied here.
4. **`lib/auth/guard.js:21`'s comment on `SIGNIN_PATH`** — "It 404s until AS-45 lands — deliberately" — goes stale the moment this task merges. Correct it to state that `GET /signin` is now served above the boundary and that the carve-out is retained for unregistered methods on that path (§3.3.2).
5. **`lib/connect/onboarding.js:~30`'s comment on `SCREEN_PATH`** — "It dangles (404) until AS-45 lands" — same. Correct it to name the route that now serves it. **This is the one edit permitted to `lib/connect/onboarding.js`: a comment, no code.**
6. **`lib/auth/guard.js:26`'s comment on `POST_SIGNIN_LANDING`** names "whichever of AS-45/AS-48 lands the Dashboard route first". AS-45 declines (§3.3.4); the comment should name AS-48 alone.
7. **`apps/invoicing/README.md:27`** describes `/` as "(scaffold page)". It is a redirect now.
8. **An unowned gap, recommended for its own task:** `POST /connect-stripe/start` answers a Stripe failure with a one-line `text/plain` 502 rather than landing the freelancer on screen 2's `S2-ERROR-SYSTEM` with a retry control. AS-41 decided the error *body* shape before a screen existed; AS-45 renders the state at a documented URL but does not rewire the POST, because `test/connect.test.js` pins those statuses and that is another task's committed surface. Someone should own the wiring before AS-49's recorded run walks the failure path.
9. **A method note, not a defect.** During planning, a `grep -rnE` over two directories reported **0** occurrences of the attribute-interpolation pattern while `perl -ne` on the same tree reported **1** (`views/scaffold.ejs:38`). The number in this plan is the `perl` one. This is the eighth-ish recurrence of "run the grep before you write the number down" and it is recorded in F3 so the implementer inherits the instrument, not just the number.
