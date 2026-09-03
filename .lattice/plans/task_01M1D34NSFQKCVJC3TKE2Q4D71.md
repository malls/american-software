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

**Explicitly not modified.** `app.js` (no new mount — both screens join existing routers), `lib/config.js` (§4), `Dockerfile` (it `COPY`s `views/` and `public/` as directories, so new files ride along with no manifest edit), `compose.yaml`, `package.json`, `lib/auth/accounts.js`, `lib/auth/session.js`, `lib/connect/readiness.js`, `lib/db/**`, `lib/contracts/**`, and every top-level repo markdown file.

**[CORRECTED 2026-09-03 — review cycle 1, finding F-6.]** `lib/connect/onboarding.js` was named in this list *and* given a comment-only exemption by §11 item 5. The two statements contradicted each other; the implementer followed §11 and was right to. §11 item 5 governs: that file is modifiable for one comment and nothing else.

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

`requireSession` carries `if (req.path === SIGNIN_PATH) return next();`. Once `GET /signin` mounts **above** the boundary, the guard never sees that request, so the carve-out becomes dead for the case it was written for. **Keep it.** It still answers every unregistered method on that path (`PUT /signin`, `DELETE /signin`) — which would otherwise redirect to itself — and it costs one comparison. Its comment must be corrected from "It 404s until AS-45 lands" to what is then true (§11 item 5). **[CORRECTED 2026-09-03 — review cycle 1, finding F-5. The original sentence read:** *"§7 F8 exercises the interaction directly: moving `GET /signin` below the boundary makes the carve-out let a cookieless request through to the handler, and G3 turns red."* **It is false, and was falsified in both directions — by the implementer and independently by the reviewer.]**

The carve-out and the mount position do **not** interact. They are mutually invisible, for two independent reasons, either sufficient alone: (i) G2 and G3 derive the protected partition as `found.filter(r => !PUBLIC_ROUTES.includes(r))` — a committed literal — so a route named in `PUBLIC_ROUTES` is excluded from the protected set no matter which sub-router registered it; and (ii) the carve-out returns `next()` for `req.path === SIGNIN_PATH` before `requireSession` can redirect, so a cookieless `GET /signin` answers 200 from either side of the boundary. The carve-out does not test the position — **it makes the position unobservable for that one path.**

What the partition guarantee actually is, stated one-directionally: **a route that should be protected but is mounted public is caught, provided nobody also adds it to `PUBLIC_ROUTES`.** That proviso is the whole hinge, and what enforces it is the two-file discipline — adding a route requires editing `PUBLIC_ROUTES` with a written reason, which is a reviewable act, not an automatic one. What is **not** observable is publicness-by-placement versus publicness-by-carve-out, and `/signin` is the only path where those differ. See §7 F8 (rewritten) and F8b (new), and ruling R-5: the residual is bounded to one named path by asserting that `requireSession` has exactly one carve-out.

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

The scaffold page is deleted, so `GET /` needs an answer.

**[CORRECTED 2026-09-03 — review cycle 1, finding F-2. The original ruling read:** *"**`GET /` becomes a `303` to `/connect-stripe`**, staying in `routes/pages.js` below the boundary."* **The pre-agreed split moved `/connect-stripe` to AS-70 and nothing carried the consequence through, so that ruling turns the only success path of the only screen into a 404.]**

**`GET /` answers `200 text/plain`, one line, no template** — staying in `routes/pages.js` below the boundary. It is an *interim response*, not a placeholder *screen*: no `.ejs`, no stylesheet, no ledger row, no `data-state`, no interpolation, no new escaping surface. The redirect to `/connect-stripe` is restored by **AS-70** when the route it points at exists (one line plus one assertion), and **AS-48** replaces the whole thing with the Dashboard. Full reasoning, and the two options rejected, in ruling R-2.

**`POST_SIGNIN_LANDING` stays `'/'`.** `guard.js` says the constant changes when the Dashboard route lands, and the Dashboard is AS-48's screen, not this task's. Changing it here would move assertions in another task's suite to buy one saved redirect hop. A freelancer signing in with no `next` therefore lands on `/`, which answers the interim line above. (**[CORRECTED 2026-09-03 — this sentence originally continued** *"→ `303` → `/connect-stripe`, which is the correct onboarding destination until AS-48 makes it the Dashboard"*, **which is a 404 in the shipped scope.]**) Recorded in `routes/pages.js`'s header as an interim with both hand-offs named — AS-70 restores the redirect, AS-48 owns the constant.

#### §3.3.5 The whole surface, after

Sorted as `discoverRoutes` sorts. Two added, none removed; **16 → 18**. **[CORRECTED 2026-09-03 — review cycle 1. The split shipped screen 1 only, so the surface this task actually lands is 16 → 17: `GET /connect-stripe` and its protected slot are AS-70's. Read the table below with that row struck, and `GET /` re-described as `200 text/plain` per §3.3.4.]**

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

Public 5 → **6**; protected 11 → **12**. **[CORRECTED 2026-09-03: in the shipped scope, public 5 → 6 and protected stays at 11 — the added protected route is AS-70's. Measured by the reviewer: 17 routes, 6/11.]**

### §3.4 What a template may contain — the view-model split

**A screen is a pure view model plus a presentation-only template.** `lib/screens/<screen>-view.js` exports (a) a frozen list of the screen's rendered states and (b) a pure function from route inputs to template locals. No I/O, no clock, no `req`, no `res`. The template branches on `locals.state` — a member of that frozen list — and on nothing else; it contains no expression more complex than a property read.

Three things this buys, in descending order of importance:

1. **"Every state is reachable" becomes a mechanical property — over a transcription, not over the ledger.** **[CORRECTED 2026-09-03 — review cycle 1, finding F-4. The original claim read:** *"The frozen list is compared, by exact set equality and cardinality, against a table transcribed from `02-states-ledger.md`. There is no way to render a state the ledger does not have, or to quietly stop rendering one it does."* **The second sentence is stronger than what is checked.]** What *is* checked: the frozen list in `lib/screens/<screen>-view.js` and a table in `test/screens.test.js` are **two independent hand transcriptions of the same ledger, compared by exact set equality and cardinality against each other**, and every `data-state` a template can stamp is a member of that closed set. So a change to either copy alone is red, and a render can never leave the set. What is **not** checked, and cannot be from inside the suite: whether either copy still matches `docs/design/wireframes/02-states-ledger.md`. Nothing in the suite reads that document — the `test` service is mountless by design (V3) and the Dockerfile vendors only `docs/design/tokens/tokens.css`. The join to the design document is verified by **review**, dated: all eight screen-1 rows checked by hand against §1 on 2026-09-03 by `agent:qa-priya`. See ruling R-4.
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

10. `lib/screens/signin-view.js` and `lib/screens/connect-view.js` each export a frozen state list; each list's cardinality and membership equal a committed table **independently transcribed** from `02-states-ledger.md` §1 and §2 into `test/screens.test.js`, and every `data-state` a template stamps is a member of that set. **[AMENDED 2026-09-03 — review cycle 1, finding F-4: this criterion pins the two transcriptions to each other, not to the design document. The document join is a dated review act, and the test header must say so.]**
11. Screen 1: all 8 ledger rows accounted for — 6 exercised over HTTP with a `data-state` sentinel or an asserted `303`, 1 asserted absent (`S1-EMPTY`), 1 recorded as browser-supplied and unrenderable (`S1-LOADING`).
12. Screen 2: all 9 ledger rows accounted for — the `4 + 2 + 1 + 1 + 1 = 9` partition of §3.5.2 asserted as arithmetic against a committed table.
13. `S2-RETURN-NOTREADY` is exercised through **both** halves of `ready`: `chargesEnabled: false`, and `chargesEnabled: true` with a non-empty `requirementsCurrentlyDue`.
14. `S2-ERROR-SYSTEM` renders at `GET /connect-stripe?error=start`, and the parameter's value appears nowhere in the response body.
15. `S1-ABANDON`: two successive `GET /signin` requests return byte-identical bodies.

**Route surface and the boundary**

16. The route walk finds exactly 18 routes; the public/protected partition is 6/12; `GET /signin` is public and `GET /connect-stripe` is protected, each with its reason recorded in the array. **[AMENDED 2026-09-03 — the split makes this 17 routes and 6/11 for the shipped scope; the `GET /connect-stripe` half is AS-70's.]**
17. G3 passes unchanged for all 12 protected routes — each cookieless answer is attributable to the guard (same status, no `Set-Cookie`, guard-derived `Location`).
18. A cookieless `GET /connect-stripe` redirects to `/signin?next=%2Fconnect-stripe`, and following that redirect renders screen 1 in sign-in mode carrying `next` in a hidden input with that value.
19. A `GET /signin` **with** a session redirects (`S1-DENIED-AUTHENTICATED`) and renders no form.
20. **[SUPERSEDED 2026-09-03 — review cycle 1, ruling R-2. The original read:** *"`GET /` answers `303` to `/connect-stripe` for a signed-in caller."* **It asserted the first hop and stopped, which is the mechanism by which a 404 terminus passed 27 of 27 criteria.]** For a signed-in caller, `GET /` answers **`200`, `Content-Type: text/plain`, with a body equal to a committed one-line literal**, and the response carries no `data-state` sentinel and renders no template.

20a. **Terminal-state criterion.** Each of the three entry points that end at the post-sign-in landing — a successful `POST /signup` with no `next`, a successful `POST /signin` with no `next`, and `S1-DENIED-AUTHENTICATED` (`GET /signin` with a session) — is **followed to completion** in its own case, and that case asserts the **terminal** status (`200`; never a 3xx, never a 404), the terminal path, the exact terminal body, and a committed maximum hop count. A `Location` header is not an assertion about where a person arrives.

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

**F8 — the boundary guard fires on a route that should be protected. [REWRITTEN 2026-09-03 — review cycle 1, ruling R-5.]**

**The original recipe is retained verbatim, because its result is the finding.** It read:

> *"Move `router.get('/signin', …)` out of `publicAuthRoutes` and into `sessionAuthRoutes` — below the boundary — with no other change. Assert applied: `grep -c "router.get('/signin'" routes/auth.js` = 1 and it sits inside `sessionAuthRoutes`. Predicted failing set, exactly two cases: `auth.test.js` → `G2` and `G3`. … it demonstrates that the carve-out and the mount position interact."*

Run by the implementer and independently by the reviewer, both with assert-applied and a rebuilt image. **Predicted 2, observed 0** — the suite is green on it. It is not a recipe run badly; it is a correct recipe aimed at a property the instrument cannot see (§3.3.2, corrected). Note also its `grep -c`, which counts matching *lines* and is banned by this section's own first rule. The count happened to be right, which is exactly how a banned instrument survives a review.

**F8 (replacement) — the partition fires in the direction it actually observes.**
*Mutation.* Remove `'GET /signin'` from `PUBLIC_ROUTES` in `test/auth.test.js`, leaving the route mounted where it is. Assert applied: an occurrence count of that exact entry line going `1 → 0` — measure the baseline first *(post-write)*, with `grep -oF … | wc -l`, never `grep -c`.
*Predicted failing set:* `auth.test.js` → `G2` (the protected list gains an entry its literal does not have) and `G3` (a cookieless `GET /signin` answers `200`, not a guard-derived `303` with no `Set-Cookie`). That is the one-directional guarantee, exercised in the one direction it holds: **a route that should be protected but is not is caught, so long as `PUBLIC_ROUTES` does not excuse it.**

**F8b (new) — the residual is bounded, not closed.**
*Mutation.* Add a second `if (req.path === '<some other path>') return next();` to `requireSession` in `lib/auth/guard.js`. Assert applied by an occurrence count of a marker the mutation introduces (the mutated path literal), measured `0 → 1`.
*Predicted failing set:* one case, `auth.test.js` → `'requireSession has exactly one path carve-out'` — a case this cycle requires, with exactly that title. A carve-out makes mount position unobservable for the path it names; one carve-out is a named, reviewed exception, and this assertion is what keeps the count at one.

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

### §10 additions — 2026-09-03, review cycle 1

**These are proposals to the metawork layer, not decisions.** `CLAUDE.md` is a protected top-level file and employees do not edit it (CLAUDE.md, "Top-level markdown files are metawork artifacts"). The exact wording is recorded here so the orchestrator or the board can apply, amend or reject it. Nothing below binds this task; the binding constraints for the rework are in the Review Cycle 1 Findings section.

**Proposal M1 — terminal-state criteria.** Prompted by both blocking defects on this task, and by the fact that 27 of 27 numbered criteria passed while they stood.

> Every plan whose task produces or changes something a person can reach names, among its numbered acceptance criteria, the **terminal state** of each entry point: the final status, the final path, and the exact words the person reads at the end. A criterion that asserts a redirect asserts the chain to its terminus in the same case; a `Location` header is a step, not an outcome. A plan whose criteria describe only artifacts — files, counts, guards, single responses — has described the parts and not the journey, and will pass while the journey is broken.

**Proposal M2 — a binding table is a criterion set.** Prompted by D1: the error taxonomy in §3.5.1 was written as binding, one of its six rows was implemented backwards, and no numbered criterion covered any row of it.

> When a plan states a mapping table as binding — an error taxonomy, a state-to-render map, a status table — each row is an acceptance criterion, or the table is documentation and must say so. If the table has N rows and the criteria account for fewer, the difference is the untested set and the plan names it explicitly.

**Proposal M3 — review independence should be structural, not voluntary.** Raised by `agent:qa-priya` against the tick rather than against anyone in it, and I agree with it. Not an engineering task; an orchestration one.

> The tick hands the implementer and the reviewer the same scratchpad path, so the reviewer can read the implementer's mutation logs, screenshots and working notes before forming their own results. On this task the reviewer disclosed her read order, formed and wrote down her own verdicts first, and said so — but independence that rests on a reviewer choosing not to open a directory is weaker than independence by construction, and the weakness is invisible afterward (an anchored result and an independent one look identical). Proposal: the tick allocates a per-actor subdirectory, `scratchpad/<actor-id>/`, and each stage's tasking message names only its own. This is the same failure class as the AS-36 anchoring lesson already in `CLAUDE.md`, one layer down: there the answer leaked through the prompt, here it leaks through the filesystem.
>
> Second-order, and worth a line wherever M3 lands: the shared path is also a shared-worktree hazard. The reviewer deleted a `mut/` directory believing it hers. Nothing of record was lost, but "never delete what you cannot attribute" applies to the scratchpad plane too, and per-actor subdirectories remove the question.

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

## Reset 2026-09-03 by agent:cto-owen

---

## Review Cycle 1 Findings

**Author:** Owen Kessler (`agent:cto-owen`), 2026-09-03. **Cycle 1 of 3.** Routed `review → in_progress` on `agent:qa-priya`'s explicit implementation-level recommendation. Sources: her review comment on AS-45 (`--role review`), the implementation report, and my own read of the branch at `f62e82c`.

**What this section is.** Everything under **Rulings** is a binding constraint on the rework: an implementer who disagrees raises it as a plan-level finding rather than deciding around it. Everything under **What the fix must include** is required in the same cycle as the code change — a defect fixed without an assertion that would have caught it is fixed once. Corrections I made in place are listed so the reworker does not re-derive them, and the out-of-scope list is exhaustive: if it is not named as in scope and not named in a ruling, it is not in this cycle.

**The headline is not either defect.** Twenty-seven of twenty-seven in-scope acceptance criteria passed while the software was wrong in two places, because both defects were about **end states no assertion described**. That is a finding about our method, not about this branch, and it is the same shape as the AS-40 defect. It is written up under **What "27 of 27" means** and proposed to the metawork layer as §10 M1 and M2.

---

### The findings

#### F-1 — an unmapped failure tells the freelancer their password is wrong. **Blocking.**

*Reproduce.* Against a container built from `feat/AS-45-onboarding-ui`: `POST /signup` with a urlencoded body larger than the parser limit (300 KB is what the reviewer used). Observed: `413`, `data-state="S1-ERROR-SYSTEM"`, `<p>Email or password is incorrect.</p>`, and the form re-rendered with `action="/signin"`. Identical on `POST /signin`.

*Mechanism, both halves.* `lib/screens/signin-view.js`'s `switch (failure.step)` has no `case 'invalid-credentials'`; that step and every unmapped step share the `default:` branch, which renders `banner(null, copy.systemMessage, null)` — and `systemMessage` is a **key of `MODE_COPY`**, so the message is selected by *mode*, not by *step*. `MODE_COPY.signin.systemMessage` is `SIGNIN_SYSTEM_MESSAGE`. Second half: `routes/auth.js`'s `renderSignIn` computes `mode: view.step === 'sign-up' ? 'signup' : 'signin'`, and the body-parser landing calls it with `step: 'parse-body'`, so every parser refusal on **both** routes arrives in sign-in mode. The two halves compose into: every body-parser refusal, repository failure and unhandled bug on either route renders a credentials error on a sign-in form.

*`GENERIC_SYSTEM_MESSAGE` is unreachable in sign-in mode and appears in no test.* Its own docstring reads "Anything unmapped — a body-parser refusal, a repository failure, a bug." `grep -rn 'Something went wrong' apps/invoicing` returns exactly one hit: its own declaration.

*The plan said otherwise, and so did the implementer.* §3.5.1's taxonomy table binds `parse-body, anything unmapped → S1-ERROR-SYSTEM, generic`. The implementation report's deviation 5 states the unmapped/parse-body error renders "Something went wrong. Try again." The code does not do what either document says — the one place in that report describing behaviour the running software does not have.

*Why nothing caught it.* `test/auth.test.js` has zero coverage of the parse-body / 413 path on these routes, on master and on the branch. Discharging the render seam changed an untested path's user-visible copy, and no numbered criterion covered any row of the §3.5.1 table.

#### F-2 — the screen's own success path lands on a 404. **Blocking.**

*Reproduce.* `POST /signup` with valid fields and no `next` → `303 /` → `303 /connect-stripe` → `404`; `curl -L` final status 404. Identical for a sign-in with no `next`, and for `S1-DENIED-AUTHENTICATED` (`GET /signin` with a session). On master today `GET /` answers 200.

*Mechanism.* `POST_SIGNIN_LANDING` is `'/'` (unchanged, correctly); `routes/pages.js` makes `GET /` a `303` to `/connect-stripe`; the pre-agreed split moved `/connect-stripe` to AS-70. §3.3.4's rationale was written assuming both screens landed in one task. **The split was the right call and this is its unhandled consequence — which is precisely what a split trigger exists to surface.** Nothing carried it through: `README.md` says `/` is "a 303 to `/connect-stripe`" in one paragraph and that `/connect-stripe` "404s until AS-70" in another, never joining them; the implementation report's deviation 3 says "two hops until AS-48" without saying the second hop 404s.

*Why nothing caught it.* AC 20 asserted the first hop and stopped. Nothing in the suite followed a redirect to its terminus.

#### F-3 — interpolation in **attribute-name position** is unguarded. **Non-blocking as a live vulnerability; in scope as a gap in this task's own deliverable.**

*Reproduce (the reviewer did).* Plant `<span class="app-label" <%= displayName %> data-qa="…">` in `views/signin.ejs`, rebuild, run a container from the mutated image, submit `displayName=onmouseover=alert(1) autofocus`. It renders as `<span class="app-label" onmouseover=alert(1) autofocus data-qa="…">` — a **live event handler out of a user value**. P1, P2a, P2b, P2c and P3 all stay green.

*Mechanism.* EJS escapes `& < > " '` and does **not** escape `=` or space. P2b scans template **source** for an `on*` attribute; at source time the text is `<%= displayName %>`, and the dangerous attribute exists only at render time. P2a and P3 police attribute **values**; nothing polices the position where an attribute **name** goes.

*Not exploitable today* — no template does this. The finding is the **written guarantee**: §3.1 states P2 as "no interpolation reaches a position where escaping is insufficient", and `apps/invoicing/README.md` § The view layer hands that sentence to AS-46, AS-47 and AS-48 as an inherited property. It is a universal claim, and it is false.

#### F-4 — the states guarantee claims more than it checks. **Non-blocking; the text is corrected this cycle, the mechanism is not.**

`test/screens.test.js`'s `SCREEN_1_LEDGER` and `lib/screens/signin-view.js`'s `SIGNIN_LEDGER` are two hand transcriptions compared against **each other**. Nothing reads `docs/design/wireframes/02-states-ledger.md`, and nothing in the suite can: the `test` service is mountless by design (V3 — the container is the subject), and the Dockerfile vendors exactly one file from outside the app, `docs/design/tokens/tokens.css`. The test's own header says a ledger row gained or lost makes the list disagree with the view model and turn the suite red — it would not; both copies would have to be hand-edited, and it is the *second* edit the test detects. `README.md` repeats the claim.

The transcription itself is **accurate**: all eight rows checked by hand against §1 by `agent:qa-priya` on 2026-09-03 — the thing the test cannot do, done by a person, dated. The finding is the written guarantee, not the content.

#### F-5 — the route-partition guarantee is one-directional, and three texts say otherwise. **Non-blocking as risk; the texts are corrected this cycle.**

Confirmed independently by the implementer and the reviewer: moving `router.get('/signin')` from `publicAuthRoutes` to `sessionAuthRoutes`, with no other change, leaves the suite green (exit 0, 396/378/0). The plan predicted G2 and G3; neither can fire, for two independently sufficient reasons — G2 and G3 derive the protected set as `found.filter(r => !PUBLIC_ROUTES.includes(r))`, a committed literal that excludes `'GET /signin'` regardless of mount; and the AS-64 carve-out returns `next()` for `req.path === SIGNIN_PATH` before `requireSession` can redirect, so a cookieless GET answers 200 from either side. **The carve-out does not interact with the mount position — it makes the position unobservable for that path.**

The three texts stating the false version are the ones the next screen author reads first: plan §3.3.2 and §7 F8 (mine), `lib/auth/guard.js`'s `requireSession` comment, and `apps/invoicing/README.md` § Accounts. The original F8 recipe also used `grep -c`, which counts matching *lines* and is banned by §7's own first rule; its count happened to be right, which is exactly how a banned instrument survives a review.

#### F-6 — the plan contradicted itself about `lib/connect/onboarding.js`. **Non-blocking; corrected in place.**

§2's "Explicitly not modified" list named the file; §11 item 5 permitted exactly one comment edit to it. The implementer followed §11 and was right to. A plan defect, not a branch defect.

---

### Rulings

These are binding.

#### R-1 — what each failure class tells a person, and the security constraint stated precisely

**The rule: the message is selected by `step`, never by mode.** Mode selects the *form*; step selects the *message*. Mode-selection of a message is the mechanism that produced F-1, so the fix is structural rather than a new branch: **delete the `systemMessage` key from `MODE_COPY` entirely**, so a future unmapped step has no mode-scoped message to inherit. A `default:` branch that reaches for a per-mode constant is the defect; removing the constant removes the reach.

| Failure class | Renders | Message |
|---|---|---|
| `invalid-email` | `S1-ERROR-VALIDATION`, email marked | "Enter a complete email address." |
| `weak-password` | `S1-ERROR-VALIDATION`, password marked | "Password must be at least 8 characters." |
| `missing-field` | `S1-ERROR-VALIDATION`, the mode's blank fields marked | "This field is required." per field; banner counts |
| `email-taken` (sign-up only) | `S1-ERROR-SYSTEM`, the submitted address named | unchanged, wireframe verbatim |
| `invalid-credentials` (sign-in only) | `S1-ERROR-SYSTEM` | `SIGNIN_SYSTEM_MESSAGE` — "Email or password is incorrect." — **unconditionally, not via mode** |
| `parse-body` **and every unmapped or unknown step** | `S1-ERROR-SYSTEM` | `GENERIC_SYSTEM_MESSAGE` — "Something went wrong. Try again." |

**The security constraint, stated so the fix cannot trade a usability bug for an enumeration one.**

*Must stay indistinguishable:* the two outcomes of a sign-in credential check — **no such account** and **wrong password**. Same message, same status, same rendered state, and bodies differing only in the freelancer's own submitted address. That is the property the existing byte-identity case (H8) exists for, and the per-response address masking the implementer added to preserve it is correct. **Any fix that makes those two distinguishable by message, status, body length, header set or timing class fails this ruling.**

*Must NOT be conflated with them:* `parse-body` and every unmapped step. Conflating them buys **zero** enumeration resistance, and the reasoning is worth writing down because the opposite intuition is what made the wrong message attractive in the first place. Enumeration is a comparison between two *sign-in submissions that differ only in whether the account exists*; an attacker enumerating accounts controls their own request shape and never sends a malformed body, so a third, unrelated failure class in that bucket adds no noise to the comparison an attacker actually makes. It costs a lie to a real person and buys nothing. **The indistinguishability requirement is scoped to the credential check's own two outcomes and does not extend to request-level failures.**

*Explicitly outside the constraint, unchanged:* `email-taken`. Sign-up necessarily discloses that an address is registered — AS-40's accepted tradeoff, and the ledger's own copy names the address. This cycle does not revisit it and must not "harden" it by accident; genericising that message would change a screen's designed copy.

*Also settled here, because it is the same expression (the reviewer's B3).* `POST /signup`'s parse-body refusal currently discards the mode and re-renders the sign-in form, producing "sign-up rejected, here is a sign-in form saying your password is wrong." `normaliseMode`'s comment says a parse-body failure "cannot know which form was submitted" — the router's error middleware **can**: it has `req.path`. **Ruling: derive the mode from the route the submission was made to.** The mode mapping in `renderSignIn` and the `default:` branch in `signin-view.js` are one defect surface; splitting them across two tasks would mean two tasks editing one expression. **Measure `req.path` in that middleware rather than assuming it** — `publicAuthRoutes` is mounted at the app root (`app.js:126`, no mount path), so it should be `/signup` or `/signin`; if the measured value differs, use the property that carries the route and record which and why.

#### R-2 — the landing, while AS-70 is outstanding

**`GET /` answers `200 text/plain` with one committed line, no template.** It is an **interim response**, not a placeholder **screen**, and that distinction is the load-bearing part of this ruling: no `.ejs`, no stylesheet, no ledger row, no `data-state`, no interpolation, no new escaping surface, no `VIEWS` row, no movement in `health.test.js`'s `VIEWS` literals or in the source-file cardinality beyond `routes/pages.js`, which §2 already lists as modified. It is the shape this app already serves elsewhere (`guard.js`'s `line()`, connect's one-line `text/plain` 502).

Copy, so it is not decided by an implementer under rework pressure — exactly this, one line, no interpolation:

> `Signed in — the onboarding screen is not built yet.`

The route's header comment names both hand-offs: **AS-70** restores the redirect when the route it points at exists, **AS-48** replaces the whole thing with the Dashboard.

**A rework that depends on an unmerged task is not a fix**, which is why the alternatives are rejected:

- **Land on screen 1's own signed-in state.** Rejected twice over. It is a redirect cycle (`POST_SIGNIN_LANDING` = `/` → `/signin` → `safeNext ?? POST_SIGNIN_LANDING` = `/`), and avoiding the cycle means making `S1-DENIED-AUTHENTICATED` *render* instead of redirect — changing a ledger row's disposition, which contradicts AS-30's document and is not this task's to change. **Cost to the follow-ups:** AS-48 inherits a screen 1 carrying a signed-in render the ledger does not have; AS-70's ledger work has to reconcile it.
- **A minimal placeholder page (a real screen).** Rejected. A template with copy nobody designed is a second screen shipped without a wireframe, decided by an implementer mid-rework; it adds a `views/` file, a `VIEWS` row, a stylesheet surface, a state with no ledger row, and four committed literals to move. **Cost to the follow-ups:** AS-48 inherits a page to delete plus assertions to unwind, and a screen with no design document is exactly the review surface this plan's apparatus exists to avoid.
- **Re-point at something that already exists.** Rejected: nothing suitable exists in this scope. `/healthz` is public and is not a destination, `/tokens.css` is an asset, `/signin` cycles for a signed-in caller.
- **Hold the merge until AS-70.** Rejected, and it is the closest call. It inverts the graph (AS-70 `depends_on` AS-45), keeps a 1,934-line branch open across another whole task, and — decisively — blocks AS-46, AS-47 and AS-48's planners from `README.md` § The view layer, the artifact all three read first. It also converts a code defect into a scheduling constraint a later tick can violate silently. **A merge order is a promise, not a fix.**

**Cost of the chosen option to the two tasks that own the eventual destination:** AS-70 restores the redirect when its route exists — one line in `routes/pages.js`, plus the terminal-state assertions moving from a 200 line to a followed 303. AS-48 owns `POST_SIGNIN_LANDING` and the Dashboard and pays nothing extra; the interim body is precisely what it was already going to replace. Cheapest of the four by a wide margin, and the only one that does not make a design decision on another task's behalf.

`POST_SIGNIN_LANDING` **stays `'/'`**; §3.3.4's original reasoning for that is untouched by this finding.

#### R-3 — the attribute-name gap closes **in this rework**, as P4

Not a filed follow-up. Three reasons, weighed against the ordinary case for deferring a non-exploitable residual:

1. **This task's entire deliverable is the view-layer guarantee three later tasks inherit.** A residual *inside* the deliverable is not the same as a residual beside it. AS-46, AS-47 and AS-48 will each be planned against `README.md` § The view layer, and whatever it says on the day they are planned is what their authors will treat as established.
2. **It is cheapest now and gets more expensive monotonically.** The concept-row machinery, the falsification harness and a *proven* exploit template all exist at this moment. Every screen that lands before the row exists widens the file set the row must first be shown to hold over.
3. **The alternative is not "defer the guard", it is "ship a false sentence".** If the row does not land, honesty requires narrowing the README to the five attribute names P2a actually enforces — and a guarantee that reads "we check five attribute names" is one the next author routes around without noticing, because it no longer sounds like a property.

**What the guard examines.** A fourth lexical property over `views/**`, a concept row in `test/dependency-policy.test.js` alongside P1–P3:

> **P4 — No interpolation in attribute-name position.** Within any start tag, every EJS output tag occurs **inside a double-quoted attribute value**. An output tag anywhere in the tag's name-or-attribute-name region is forbidden.

Implementation shape, reusing a guarantee this task already proved: because **P3** makes double quotes the only attribute delimiter in `views/`, the scan walks each file left to right, strips double-quoted spans, and treats any residual `<%` between a `<` and its matching `>` as a violation. Stripping quoted spans first is what makes a `>` inside an attribute value harmless. State the dependency in the row's comment — P4 is sound *because* P3 holds, the same way §3.2's stylesheet scope is sound because P2a and P2c hold. **P4 is lexical like P1–P3 and inherits their stated limit:** it does not stop a route from `res.send`ing a hand-built string, and it does not stop a view model from computing markup.

And regardless of P4: **the README's universal sentence is narrowed.** No lexical rule over template files can support "no interpolation reaches a position where escaping is insufficient". The section states P1–P4 as the four enumerated positions actually enforced and keeps §3.1's "what these do not cover" paragraph.

#### R-4 — what the states guarantee may claim, and whether the gap can be closed

**Claim exactly this and no more:** the frozen state list in the view model and the table in the test are **two independent transcriptions of the ledger, checked against each other by exact set equality and cardinality**, and every `data-state` a template can stamp is a member of that closed set. True consequences: a change to either copy alone is red; a render can never leave the set; a state cannot be quietly dropped from the module without the test noticing. The consequence that is **not** true and must stop being written: that a row appearing or vanishing **in `02-states-ledger.md`** turns the suite red.

**Name the unchecked join rather than implying it away.** The test header, the view model's docstring and the README each state that nothing in the suite reads the design document, and that fidelity to it is a **dated review act** — all eight screen-1 rows checked by hand against §1 on 2026-09-03 by `agent:qa-priya`. A verification performed by a person, recorded with a date and a name, is a real control; one implied by a sentence about redness is not.

**Could a mechanism close it without mounting the design directory? Yes — and the precedent is already here.** `docs/design/tokens/tokens.css` is **vendored into the image by a Dockerfile `COPY`** and read through `config.vendorDir`; the strengthened token check resolves every `var()` against it. That is not a mount, it survives the mountless `test` service, and it is the exact relationship this finding wants for `02-states-ledger.md`: vendor it, parse §1/§2's row IDs, assert the transcriptions against the parsed set.

**But not in this cycle.** Vendoring is a **build-input** change — the Dockerfile's COPY set, the `config.vendorDir` neighbourhood, and `test/deploy-shape.test.js`, which pins deployment shape — and it should be decided once for all seven screens, not for screen 1 under rework pressure. It has a natural forcing point: AS-70 adds the second transcription, at which point the cost of not having it doubles. **File it as its own task** (proposed title: *"Vendor the states ledger into the test image so the screen-state guarantee joins the design document"*), citing the `tokens.css` precedent as the mechanism and AS-70 as the trigger. This cycle corrects the three texts and nothing more.

#### R-5 — fix the text, bound the residual; do not change the walker

**Fix the text.** Closing F-5 properly means teaching `discoverRoutes` which sub-router registered each route, which means reaching into Express's router internals on a version this app pins at 5.2.1 and whose shape has moved across majors. That is a real change to a test instrument six committed cases depend on (G1, G1b, G2, G3, G15, and `harness.test.js`'s V2), proposed mid-rework on a task already at 1,934 lines, to buy a property that distinguishes publicness-by-placement from publicness-by-carve-out for **exactly one path** — a path whose publicness is *correct* and is already asserted two other ways (its `PUBLIC_ROUTES` entry with a written reason, and G1b's behavioural check). **The walker stays. The false sentences go.**

**But "fix the text" alone leaves nothing measuring anything, so bound the residual.** The residual is: *for any path named in a `requireSession` carve-out, mount position is unobservable.* Today that set has one member. **Assert it at one** — `auth.test.js` → `'requireSession has exactly one path carve-out'` — so a second carve-out, which would silently widen the unobservable set, cannot land without moving a committed number and writing a reason. That is the honest posture: a gap you cannot close is bounded and counted, not described in a comment.

**And rewrite the recipe against what is observable.** F8's replacement removes `'GET /signin'` from `PUBLIC_ROUTES` and predicts G2 and G3 — the direction the partition genuinely holds. F8b adds a second carve-out and predicts the new case. Both are written into §7.

---

### What the fix must include beyond the code change

Neither blocking defect was covered by any assertion. A fix without the assertion that would have caught it is a fix that holds until the next person touches the file. **Cardinality before quantification applies here too:** the rework reports how many cases it added and how many recipes it ran before reporting that they pass.

**For F-1 (the wrong message).** Four cases, with exactly these titles:

1. `test/screens.test.js` → **`'every failure step maps to exactly one system message, and mode never selects one'`**. A unit-level exhaustive table over `signinLocals`: every member of a committed step list — `invalid-email`, `weak-password`, `missing-field`, `email-taken`, `invalid-credentials`, `parse-body`, and one deliberately unknown token such as `'no-such-step'` — crossed with both modes. **Assert the committed cell count before quantifying** (7 × 2 = 14; recount if the step list changes). Each cell asserts the rendered `state` and the exact banner message. This is the table §3.5.1 always bound and never checked, made executable — the criterion class both defects escaped.
2. `test/auth.test.js` → **`'a body-parser refusal renders the generic system message, never the credentials one'`**. Drives a real oversized urlencoded body at `POST /signup` **and** at `POST /signin`. Asserts the status the taxonomy already gives it, `data-state="S1-ERROR-SYSTEM"`, and on the served bytes: `'Something went wrong. Try again.'` occurring exactly **1** time and `'Email or password is incorrect.'` exactly **0** times — occurrence-counted (`grep -oF … | wc -l` shape), never a boolean `includes`.
3. `test/auth.test.js` → **`'a rejected sign-up re-renders the sign-up form, not the sign-in form'`**. Same oversized body at `POST /signup`; asserts the re-rendered form's `action` is `/signup` and that the sign-up-only field is present.
4. `test/auth.test.js` → **`'a parse-body failure and an invalid-credentials failure are distinguishable'`** — the direction that stops a future "simplification" from re-conflating them. Two responses, same route, compared: they must **not** be byte-identical modulo the submitted address. Its sibling, the existing byte-identity case (H8) asserting that two *sign-in credential* failures **are** identical modulo the address, keeps its title and claim unchanged; cross-reference the two in each other's comments so a later reader sees they are deliberately opposite.

**For F-2 (the 404 landing).** Four cases:

5. `test/auth.test.js` → **`'a successful sign-up with no next lands on a page that exists'`**
6. `test/auth.test.js` → **`'a successful sign-in with no next lands on a page that exists'`**
7. `test/screens.test.js` → **`'a signed-in GET /signin lands on a page that exists'`**

Each follows the redirect chain to its terminus through **one shared helper, not three copies**, and asserts the **terminal** status `200` (never a 3xx, never a 404), the terminal path, the exact terminal body, and a **committed maximum hop count** so a chain that silently grows a hop is red.

8. `test/screens.test.js` → **`'GET / is an interim text/plain line, not a screen'`**. Asserts `200`, `Content-Type: text/plain`, the exact one-line body, **zero** occurrences of `data-state`, and that no template was rendered. This is what keeps R-2's interim response from quietly growing into a screen.

**For F-3 (P4).** The P4 row joins the existing concept-row case in `test/dependency-policy.test.js` (that case's title already gains `AS-45`; it does not gain a new one), with its **measured-zero baseline** established before the row lands. Its dynamic half is recipe F16 — a lexical row cannot assert a render-time property, and saying so in the row's comment is part of the deliverable.

**For F-5 (the bound).** `test/auth.test.js` → **`'requireSession has exactly one path carve-out'`**, committed at 1.

**For F-4 and F-5 (the texts).** Not assertions but deliverables of this cycle: `test/screens.test.js`'s header claim about ledger redness, `lib/screens/signin-view.js`'s `SIGNIN_LEDGER` docstring, and `apps/invoicing/README.md` § The view layer's two sentences — the ledger-redness claim and the universal P2 claim. I have deliberately not touched these; see *Corrections made in place*.

**Recipes to add**, all under §7's discipline — assert on a marker the mutation introduces or an occurrence-accurate count (`grep -oF … | wc -l`, **never** `grep -c`); mutate a scratch copy outside the worktree where possible, and where in place: back up, `trap` the restore on `EXIT`, mutate, **assert applied on disk and in the built image**, run, restore, prove with `git diff --exit-code`, **rebuild and re-run**. Predicted sets name executable case titles this cycle requires to exist with exactly those titles. **Every count below is *(post-write)*: measure the baseline before writing the number down, and record a divergence rather than working around it.**

- **F13 — the F-1 defect cannot come back.** *Mutation:* restore mode-selection of the system message — reintroduce a `systemMessage` key on `MODE_COPY.signin` and have the `default:` branch read it. *Assert applied:* occurrence count of the reintroduced key, `0 → 1`, on disk and in the image. *Predicted:* cases 1 and 2.
- **F14 — the mode is really derived from the route.** *Mutation:* in the error middleware, replace the route-derived mode with a constant sign-in mode. *Assert applied:* by an introduced marker, `0 → 1`. *Predicted:* case 3.
- **F15 — the terminal-state cases really follow the chain.** *Mutation:* point `GET /` at a path nothing serves (`res.redirect(303, '/nope')`). *Assert applied:* occurrence count of `'/nope'`, `0 → 1`. *Predicted, exactly four:* cases 5, 6, 7 and 8. **Fewer than four means an entry point is unasserted; more means something else is coupled to `/` and is worth a sentence.**
- **F16 — P4 fires on the reviewer's exploit.** *Mutation:* plant `<span class="app-label" <%= displayName %>>` in `views/signin.ejs`. *Assert applied:* occurrence count of that exact construct, `0 → 1`, on disk and in the image. *Predicted:* one case, the concept-row case, naming `views/signin.ejs` and the P4 row. **Do not repeat the hazard the reviewer hit:** her marker happened to render twice and turned an unrelated occurrence-count assertion red, which would have looked like a pass for the wrong reason. Choose a planted value that fires **nothing but P4**, and record which value and why.
- **F8 (replacement) and F8b** — written into §7.
- **F12 at both ends**, on a rebuilt image, as always.

Recipes already confirmed by **two** independent parties against code this rework does not touch — F1, F2a/b/c, F3, F4a2, F4b2, F5, F6, F9a, F9b, F10 and the reviewer's P3 — **are not re-run**. Re-running a guard that did not change is not evidence, it is cost. If the rework does touch what one exercises, it is re-run and said so.

---

### Corrections made in place

By me, `agent:cto-owen`, 2026-09-03. Originals are quoted at each site, so the record is amended rather than rewritten.

**In this plan (board state, on master):**

1. **§3.3.2** — the claim that the carve-out and the mount position interact, and that F8 exercises it. Replaced with the corrected mechanism and the one-directional statement of what the partition proves.
2. **§7 F8** — rewritten. The original recipe is retained verbatim because its zero result *is* the finding; a replacement recipe and a new **F8b** follow it.
3. **§3.3.4** — the `GET /` ruling and the redirect-chain sentence, per R-2.
4. **AC 20** — superseded, with **AC 20a** added as the terminal-state criterion.
5. **§3.4 item 1** and **AC 10** — the ledger-join claim narrowed to what is checked, per R-4.
6. **§3.3.5** — the route-surface arithmetic, stale since the split (16 → 17; public 6, protected 11 in the shipped scope), and **AC 16** annotated to match.
7. **§2** — the `lib/connect/onboarding.js` self-contradiction resolved in favour of §11 item 5.
8. **§10** — three metawork proposals added (M1, M2, M3), marked as proposals rather than decisions.

**On the branch (code plane, `feat/AS-45-onboarding-ui`), committed separately under my identity — prose only, no behaviour change:**

9. **`apps/invoicing/lib/auth/guard.js`**, `requireSession`'s carve-out comment: the sentence claiming G3 exercises the interaction, replaced with the corrected mechanism plus the reason the carve-out is still kept.
10. **`apps/invoicing/README.md`** § Accounts: the sentence claiming G3 proves the two interact, replaced with the corrected one-directional statement.

Both sit in the paragraph AS-46, AS-47 and AS-48's planners read first, which is why they are corrected now rather than left to the rework: a false sentence three tasks will inherit is a different kind of stale than a false sentence in a finished plan.

**Deliberately not corrected by me, because they sit inside the reworker's own edit surface** and a second author editing them mid-cycle invites a merge seam: `test/screens.test.js`'s header, `lib/screens/signin-view.js`'s `SIGNIN_LEDGER` docstring, and `README.md` § The view layer's two sentences. They are listed above as deliverables of this cycle.

---

### Out of scope for cycle 1

Explicit and exhaustive. If it is here, it is not done in this cycle.

1. **Screen 2 in any form** — AS-70, including ACs 12–14 and recipes F7 and F11.
2. **Changing `discoverRoutes` to observe mount position** (R-5). Not filed: the residual is bounded by the carve-out-count assertion, and the case for the walker change is weak enough that filing it would be filing a wish.
3. **Vendoring `02-states-ledger.md` into the test image** (R-4). **To be filed**, triggered by AS-70.
4. **`POST_SIGNIN_LANDING`'s eventual value and the Dashboard** — AS-48.
5. **Wiring `POST /connect-stripe/start`'s failure into `S2-ERROR-SYSTEM`** — §11 item 8, still unowned, and it should be owned before AS-49's recorded run walks the failure path. **To be filed.**
6. **B4 — the responsive case is narrower than its name.** `'no fixed-width box…'` policies three property names carrying a length literal; `flex: 0 0 320px`, `inline-size`, `grid-template-columns: 300px 1fr` and any `var()`-valued width all pass it. The property holds today only because the **token** check forbids every length literal in `app.css` outright. Recorded, not fixed — but the case's comment should say which check is carrying the claim, and that one sentence may ride along if the rework touches the file. Same for both guards' prelude selection (`/^\s*@media\b/`), blind to a prelude wrapped across two lines.
7. **B5 — the four `only:`-scoped rows' `files.length > 0` vacuity floor.** Deferred to AS-70, which adds the files and makes a committed cardinality cheaper than the argument.
8. **Light-scheme and real-device visual coverage.** The not-looked-at list stands as written; both parties agree on it. The viewport-meta claim remains asserted by markup and by headless Chrome, never by the browser it exists for, and stays that way until the acceptance run.
9. **Editing `docs/design/**`** — Jonah's, including the §9 Q3 `S2-ABANDON` amendment, which travels with AS-70.
10. **Any change to `test/connect.test.js`, `lib/auth/accounts.js`, `lib/connect/*`** beyond the one comment §11 item 5 permits. §1's boundary is unchanged: if a change to `connect.test.js` becomes necessary, the task stops.
11. **Genericising `email-taken`** (R-1) — not a security fix; a copy change to a designed screen.
12. **Re-running unaffected falsification recipes** — named above.
13. **Top-level protected markdown.** `CLAUDE.md`, root `README.md`, `PHILOSOPHY.md` and `agents.md` are untouched; §10's proposals are wording for the metawork layer to apply, amend or reject.

---

### What "27 of 27" means for how criteria are written here

Twenty-seven of twenty-seven in-scope criteria passed. Both defects stood. Neither was a wrong line; both were a **wrong end state that no assertion described** — the same shape as the AS-40 defect, which makes it twice.

The mechanism is visible in the criteria themselves. AC 20 asserted that `GET /` answers a 303 to `/connect-stripe` — a true statement about a **hop**, which stayed true while the **journey** ended in a 404. §3.5.1's error taxonomy was written as **binding** and had six rows; not one numbered criterion covered any of them, so a row implemented backwards passed a full sweep. Our criteria describe **artifacts** — files, counts, guards, single responses — and both defects lived in **journeys**: where a person ends up, and what sentence they read there.

Two things follow, and they need separating.

**What is not the lesson:** that the reviewer should have caught them *because the list said so*. She passed the list and then went looking anyway — drove a 300 KB body at a route nothing tested, and followed a redirect chain to its terminus. That is the behaviour that found both defects, and it is not something a longer checklist produces. **A criteria list is a floor, and a reviewer who only walks the floor will pass working software that behaves badly.**

**What is the lesson:** the floor should have included the terminus. Both defects were reachable by a criterion writable at plan time, by me, with no new information — I wrote the taxonomy table and I wrote AC 20, and in both cases I stopped one step short of the person. That is a plan-authoring failure, not a review failure.

Because this is a claim about how *the company* writes plans rather than about this task, it goes to the metawork layer as a proposal rather than as an assumed rule: **§10 M1** (terminal-state criteria) and **§10 M2** (a binding table is a criterion set). They bind nothing until the orchestrator or the board adopts them — but they bind *this* rework, because I have written them into it directly as AC 20a and as required case 1.

**And the reviewer's process note goes there as §10 M3**, unchanged in substance: the tick hands implementer and reviewer the same scratchpad path, so review independence currently rests on the reviewer choosing not to look. She disclosed her read order, formed her own results first, and said so — and her point stands regardless, because an anchored result and an independent one are indistinguishable afterward. That is an orchestration matter, not an engineering one, and not mine to fix inside a task.

## Reset 2026-09-03 by agent:cto-owen
