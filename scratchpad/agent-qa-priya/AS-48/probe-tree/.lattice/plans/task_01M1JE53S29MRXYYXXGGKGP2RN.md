# AS-70: D1 v1 UI: onboarding screen 2 (Connect Stripe)

Screen 2 of 7, split out of AS-45 by that task's own PRE-AGREED SPLIT TRIGGER (plan §8), fired on measurement rather than on judgement: at the moment screen 1 was complete and green, `git diff --stat master...feat/AS-45-onboarding-ui` reported 1,505 insertions and 244 deletions — 1,749 changed lines against a 900-line stop line, and over 900 on insertions alone. The plan set that line in advance precisely so it would not be decided under pressure, and instructed the implementer to stop, land screen 1, and file this task. The seam is the plan's own: "the view layer + screen 1" against "screen 2" — not screen 1 vs screen 2, because they share the stylesheet and the entire mechanism.

WHAT AS-45 ALREADY LANDED, and this task inherits rather than re-derives: the view layer (`apps/invoicing/README.md` § The view layer is the artifact to read first). Three escaping properties as concept rows in test/dependency-policy.test.js, each on a measured-zero baseline — no raw-output tag (gated by a keyed, counted, line-pinned allowlist that is currently EMPTY), no interpolation in an href/src/action/formaction/style attribute, no event-handler attribute, no script or style element, and double-quoted attribute values. The strengthened token check in test/assets.test.js ('every visual value in public/ CSS traces to a token that exists'), which resolves every var(--name) against the vendored tokens.css and enforces the @media breakpoint carve-out against the token's actual value. public/app.css, complete for BOTH screens — its banner-success and banner-warning rules are already there and unused, so this task adds markup, not styling (re-measure APP_CSS_DECLARATIONS and APP_CSS_VAR_REFERENCES in test/assets.test.js if it does change). The view-model/template split, lib/screens/<screen>-view.js plus a presentation-only template stamping data-state on its root element. test/screens.test.js, whose screen-1 half is the shape to follow.

SCOPE. `GET /connect-stripe` in `connectRoutes` (routes/connect.js), below the auth boundary — protected by position alone, adding no third publicness mechanism. Create apps/invoicing/views/connect-stripe.ejs and apps/invoicing/lib/screens/connect-view.js; add screen 2's half to test/screens.test.js; add its row to lib/views.js's VIEWS (with health.test.js's two literals, currently 1 and ['signin.ejs']); add 'GET /connect-stripe' to test/auth.test.js's ALL_ROUTES, G2's protected list, and the four cardinality literals (currently 17 / 16 / 11 / 17); recount test/dependency-policy.test.js's app-source list and its cardinality (currently 50). NO CHANGE to the three existing connect handlers, their statuses, or their bodies. test/connect.test.js is NOT MODIFIED AT ALL — if a change to it becomes necessary the scope boundary has been crossed and the task stops.

--- AS-45 plan §3.5.2, verbatim ---

Screen 2 — a pure function of the stored row.

`GET /connect-stripe` reads `repos.connectedAccounts.getByFreelancer(actingFreelancerId(req))` and renders. It makes no Stripe call. AS-41's rule is that readiness is written only from a snapshot freshly obtained by the request that writes it — creation and return are the sync moments; a page view is not one. (A Stripe call from a route would also fail the 'platform Stripe call' concept row, which pins `platform: true` to lib/connect/onboarding.js.)

The mapping is total over the row: `null` (no connected account) renders S2-DEFAULT-NOTSTARTED; `row.ready === true` renders S2-RETURN-READY; `row.ready === false` renders S2-RETURN-NOTREADY. `ready` is `chargesEnabled && requirementsCurrentlyDue.length === 0`, derived in exactly one place (lib/db/repositories/connected-accounts.js's mapper). The screen reads the boolean and does not re-derive it — that is the same "one place" rule AS-41 wrote it for.

The S2-ABANDON divergence, stated plainly. The ledger says S2-ABANDON "renders S2-DEFAULT-NOTSTARTED again — we were never told anything changed." That was written assuming no row exists until Stripe redirects back. AS-41 creates the row at start, before the first account link is minted. So after a genuine abandonment a row exists and is not ready, and the honest render is S2-RETURN-NOTREADY — "Stripe still needs more information; finish setup" — whose button posts to the same POST /connect-stripe/start, which Stripe resumes at the freelancer's own last point, exactly as the ledger's prose describes. Telling a freelancer with a half-built Stripe account "Connect your Stripe account" as if nothing had happened would be the less accurate of the two.

The alternative — distinguishing "arrived via Stripe's return" from "wandered back" — requires a marker on the redirect, and any marker in a URL is client-supplied, so a freelancer could produce either state at will. Rejected: the screen renders the row, and how the visitor arrived is not a state it may read. S2-ABANDON is therefore a reachability path into one of the three row-derived renders, not a fourth render. Proposed ledger amendment wording in AS-45 plan §9 Q3 — route it to Jonah (agent:ux-jonah) as a documentation follow-up; do not edit docs/design/** from this task.

Screen 2's ledger, all nine rows, partitioned: S2-DEFAULT-NOTSTARTED (signed in, no connected_accounts row) rendered; S2-RETURN-READY (row seeded chargesEnabled: true, requirementsCurrentlyDue: []) rendered; S2-RETURN-NOTREADY (row seeded chargesEnabled: false AND separately chargesEnabled: true with a non-empty requirementsCurrentlyDue — both halves of `ready`) rendered; S2-ERROR-SYSTEM (GET /connect-stripe?error=start, the documented URL) rendered — 4. S2-DENIED-SIGNEDOUT (cookieless GET /connect-stripe -> guard 303 /signin?next=%2Fconnect-stripe) and S2-REFRESH (GET /connect-stripe/refresh -> 303 into a fresh Stripe link; its own content is never seen) redirect-answered — 2. S2-ABANDON, a path into a render — 1. S2-LOADING, unrenderable — 1. S2-EMPTY, n/a — 1. 4 + 2 + 1 + 1 + 1 = 9. The test asserts that arithmetic against a committed table, so a row appearing or vanishing in 02-states-ledger.md §2 turns it red.

--- AS-45 plan §3.5.3, verbatim ---

S2-ERROR-SYSTEM and the gap this task does not close.

The wireframe wants an error banner and a "Try again" control on screen 2 when the account-link call fails. Today POST /connect-stripe/start answers that with 502 text/plain "StripeApiError: mint-onboarding-link".

Making the POST redirect into the screen means changing routes/connect.js's failure landing, which test/connect.test.js pins by status at four places. That is another task's committed assertions and another task's stated decision ("error bodies are one-line text/plain; screens render states from the DB row, not from these bodies").

Decision: render the state, do not rewire the POST. `GET /connect-stripe?error=start` renders S2-ERROR-SYSTEM — a documented URL, which the VERIFICATION clause explicitly admits as a reachability mechanism. The parameter is treated as a presence flag selecting a state; its value is never echoed to the page, and the copy is a constant. The remaining gap — a freelancer who hits a real Stripe failure sees a text/plain 502 instead of that URL — is ALREADY FILED as AS-69, which carries a depends_on edge to AS-45 and should be re-pointed at this task.

--- AS-45 plan §3.6, verbatim ---

Reachability, in three categories.

1 — Reachable in the offline suite (`docker compose run --rm test`, network_mode: none, no accounts, no egress). Every rendered state of both screens, every redirect-answered state, both n/a assertions: 7 of screen 1's 8 rows and 8 of screen 2's 9. Screen 2's Stripe-derived states are reachable offline because the screen renders the stored row — the suite seeds connected_accounts through deps.repos (which withServer hands the test) and calls updateReadiness with a fabricated snapshot, which is precisely the shape AS-41's own tests already use.

2 — Needs stripe-mock (`docker compose run --rm contract`). Nothing new. The behaviour behind S2-LOADING and S2-REFRESH — that POST /connect-stripe/start and GET /connect-stripe/refresh really redirect to a Stripe-issued URL with a request shape Stripe's own validator accepts — is already covered by AS-38's and AS-41's cases. This task adds no stripe-mock case and must not duplicate one. The one thing to verify here is negative and cheap: the contract service still passes with these screens in the image.

3 — Not exercisable offline, and named rather than silently untested. S1-LOADING and S2-LOADING are not implemented, and cannot be, under the standing no-client-side-JavaScript assumption. "Fields disabled, button reads Signing in…" is a state a page enters after its bytes were served; producing it requires JavaScript on submit. With no JavaScript, the interval between submit and the server's 303 is the browser's own loading indicator, and this app emits no bytes during it. Verified that the assumption still holds (P2c: zero script elements in the tree) and these screens do not change it. The rows are marked in the test's committed table as `unrenderable — browser-supplied`, so their absence is an assertion rather than a gap. The real hosted round trip — a genuine Stripe account moving not-ready -> ready through return_url — belongs to the acceptance run (AS-50), as the VERIFICATION clause says. Offline, the transition is exercised by seeding both sides of it; the hosted flow is not. Visual judgment at 375px is the third: the implementer runs docker compose up, opens screen 2 at a 375px viewport in every state that renders, and records in a Lattice comment the viewport used, each state observed, each state NOT observed, and any state where text overflowed, wrapped badly, or a control fell off.

--- AS-45 plan ACs 12-14, verbatim ---

12. Screen 2: all 9 ledger rows accounted for — the 4 + 2 + 1 + 1 + 1 = 9 partition of §3.5.2 asserted as arithmetic against a committed table.
13. S2-RETURN-NOTREADY is exercised through both halves of `ready`: `chargesEnabled: false`, and `chargesEnabled: true` with a non-empty `requirementsCurrentlyDue`.
14. S2-ERROR-SYSTEM renders at `GET /connect-stripe?error=start`, and the parameter's value appears nowhere in the response body.

--- THE MONEY-WORD LANDMINE (AS-45 plan §5), read this before writing a line of the template ---

02-states-ledger.md §2's copy for S2-DEFAULT-NOTSTARTED reads: "We never hold or move your clients' MONEY — Stripe pays you directly." The 'money representation' concept row scans RAW text, comments included, with /amount|currency|money/i, and its allowlist is seven files, none of them a view. Putting that sentence in views/connect-stripe.ejs turns the suite red. DO NOT add the view to the allowlist — the row exists to confine money representation to the files that handle integer minor units. DO NOT narrow the pattern. Reword to "funds": 00-flows.md Flow 2 step 1 already uses exactly that word for exactly this sentence, so the flow's own wording is the fix, not an invention. The sentence becomes: "We never hold or move your clients' funds — Stripe pays you directly." Watch the same three words in app.css comments and in the view model. Measured 2026-09-03: `grep -oiE 'amount|currency|money' apps/invoicing/views/*.ejs apps/invoicing/public/*.css | wc -l` is 0 today and must stay 0.

--- FALSIFICATION RECIPES STILL OWED (AS-45 plan §7 F7 and F11) ---

Every other recipe in the AS-45 plan (F1-F6, F8-F10, F12) was run under AS-45 and is recorded in its Lattice comment. These two are screen-2-specific and are this task's to run, under the house mutation discipline: mutate a `git archive HEAD` extract OUTSIDE the worktree, assert the mutation applied on disk AND inside the built image with an occurrence-accurate count (`grep -oF ... | wc -l`, never `grep -c`), record predicted vs observed failing sets and classify every divergence, prove restoration, rebuild and re-run. Use an isolated compose project (`-p <name>`); never touch asc-invoicing-web-1 (8348) or asc-chat-server-1 (8347).

F7 — an existing guard fires, in the direction it exists to catch (the live hazard on this task). Pre-measured baseline: `grep -oiE 'amount|currency|money' docs/design/wireframes/screen-2-connect-stripe.html | wc -l` = 1 (line 58, the copy). Mutation: change "funds" back to "money" in views/connect-stripe.ejs. Assert applied: `grep -oiF money views/connect-stripe.ejs | wc -l` = 1. Predicted failing set: one case, the concept-row case, with the 'money representation' row reporting views/connect-stripe.ejs as an unexpected member.

F11 — the state table is not decorative. Mutation: delete the S2-RETURN-NOTREADY branch from views/connect-stripe.ejs. Assert applied: `grep -oF 'S2-RETURN-NOTREADY' views/connect-stripe.ejs | wc -l` = 0 after a non-zero baseline (measure the baseline first). Predicted failing set, at least three cases: the two S2-RETURN-NOTREADY HTTP cases (both halves of `ready`, AC 13) and the partition-arithmetic case "screen 2's nine ledger rows partition 4 + 2 + 1 + 1 + 1". Fewer than three means a state is being asserted by only one path.

--- HOUSEKEEPING THIS TASK INHERITS ---

lib/connect/onboarding.js's SCREEN_PATH comment and apps/invoicing/README.md now name THIS task as the one that lands `GET /connect-stripe` (AS-45 re-pointed them when it split). Both must be corrected again when this lands, and the README's § Obligations line about screen 2 removed. That comment is the ONE edit permitted to lib/connect/onboarding.js: a comment, no code.

---

**Plan author:** Owen Kessler (`agent:cto-owen`), 2026-09-12, on Opus under the Fable fallback. Master at `9484f62`; last `apps/invoicing` code commit `034bc3d`. **Implementer:** `agent:developer-marcus`. **Reviewer:** `agent:qa-ruben`. Complexity **medium** (three stages).
**All commands run inside compose, from an isolated project.** `node_modules/` does not exist on the host. Docker is off PATH — absolute binary `/usr/local/bin/docker`, invoked via `node -e` + `spawnSync` when the shell denies it. Never touch `asc-invoicing-web-1` (8348) or `asc-chat-server-1` (8347).

---

## §0 Ground truth, measured this tick (2026-09-12)

### §0.1 Baseline, offline suite, `--build`, scratch project `asc-plan-as70`

| Service | tests | pass | fail | skipped | receipt |
|---|---|---|---|---|---|
| `test` (network_mode: none) | **405** | **387** | 0 | 18 | `Image asc-plan-as70-test Built`, exit 0 |

Log: `scratchpad/agent-cto-owen/AS-70/baseline-test.log`. Matches the AS-90 plan's §0.1 baseline (405/387/0/18) — nothing under `apps/invoicing` has merged since. Project torn down with `down --rmi local`; the two shared containers were untouched (verified by `docker ps` after). The `contract` half was not re-run at planning time: this task adds no stripe-mock case; the implementer runs it once at the end (AC 24).

**Predicted after implementation: 418 tests / 400 pass / 0 fail / 18 skipped** — 13 new cases in `test/screens.test.js` (§6, all titles named), no case removed, no new test file. A different number is recounted from the runner's own summary line and the divergence is explained in the implementation comment; the number in this plan is a prediction, not a measurement.

### §0.2 Every cardinality literal the description cites, re-verified against master today

The description's numbers were measured 2026-09-03; AS-65 and others merged since. **None of them moved**, but two are described imprecisely in the description and are corrected here:

| File | Literal | Today | After this task |
|---|---|---|---|
| `test/auth.test.js` | `ALL_ROUTES` entries | 17 | **18** — adds `'GET /connect-stripe'`, sorted (it sorts immediately before `'GET /connect-stripe/refresh'`) |
| `test/auth.test.js` | G1 `assert.equal(found.length, 17, …)` | 17 | 18 |
| `test/auth.test.js` | G1b `assert.equal(found.length, 16, …)` (no webhook secret) | 16 | 17 |
| `test/auth.test.js` | G2's expected protected list | 11 entries | **12** — adds `'GET /connect-stripe'` |
| `test/auth.test.js` | G3 `assert.equal(protectedRoutes.length, 11, …)` | 11 | 12 |
| `test/auth.test.js` | G15 `assert.equal(discoverRoutes(app).length, 17)` | 17 | 18 — **this is the fourth "17" the description meant; it is G15, not a second G1 literal** |
| `test/auth.test.js` | `PUBLIC_ROUTES` | 6 entries | 6 — **unchanged**; the new route is protected by position |
| `test/health.test.js` | `assert.equal(VIEWS.length, 1)` | 1 | 2 |
| `test/health.test.js` | `VIEWS.map(v => v.file)` | `['signin.ejs']` | `['signin.ejs', 'connect-stripe.ejs']` — in `VIEWS`'s **declaration** order; append the new row after `signin` |
| `test/dependency-policy.test.js` | app-source cardinality | 50 | **52** (+ `lib/screens/connect-view.js`, + `views/connect-stripe.ejs`, sorted into the list) |
| `test/dependency-policy.test.js` | `VIEW_START_TAGS` | 87 | **87 + N**, N measured *(post-write)* over `views/connect-stripe.ejs` by the three-instrument method in the constant's own comment. **The description does not mention this literal; it moves.** |
| `test/dependency-policy.test.js` | P2a/P2b/P2c/P3 `only:` file set (`views/` + `public/`) | 2 files (`views/signin.ejs`, `public/app.css`), floor `> 0` | **3, committed** (§3.6, the B5 debt) |
| `test/dependency-policy.test.js` | P4 file set (`views/`) | 1 file, floor `> 0` | **2, committed** (§3.6) |
| `test/assets.test.js` | `APP_CSS_DECLARATIONS` / `APP_CSS_VAR_REFERENCES` / `PUBLIC_FILES` | 98 / 76 / `['app.css']` | **unchanged** — `public/app.css` is not edited (§3.5) |
| `test/harness.test.js` | `EXPECTED_TEST_FILES` / V2 count | 17 | unchanged |
| `test/config.test.js` | `SCHEMA.length` | 11 | unchanged |

**Every one of these is written as a recount at rebase time, never a number copied from this table** (§8 seam rule). The test's own failure message prints the truth.

### §0.3 Pre-write baselines for the recipes

- `grep -oiE 'amount|currency|money'` over `views/*.ejs`, `public/*.css`, `lib/screens/*.js`, `lib/views.js`, `routes/connect.js`, `routes/pages.js`: **0** (measured with a node regex count, occurrence-accurate). Over `docs/design/wireframes/screen-2-connect-stripe.html`: **1** (line 58, the copy). Must stay 0 over the app after this task.
- `<<%` in `views/*.ejs`: **0** (1 file examined).
- `grep -oE '</?[A-Za-z]' views/signin.ejs | wc -l`: **86**, which is `VIEW_START_TAGS` 87 less the `<!doctype` — the third-instrument agreement the constant's comment describes still holds on master.
- `test/auth.test.js` measures **1199 lines** by the 1,200-line ceiling test's own instrument (`split('\n').length`; `wc -l` says 1198). See §3.7 — this is a live trap.

### §0.4 The dependency graph, corrected

AS-70 carried `depends_on → AS-71` (vendor the ledger into the image), and AS-71 is in `backlog`. I wrote that edge on 2026-09-03 and it was advisory ordering, not a prerequisite: AS-71's own description says "AS-70 is the natural forcing point: it is the next screen, it adds the second transcription" — AS-71 needs AS-70's transcription to exist, not the other way round. A task in planning that "depends on" a backlog task is a board lying about itself. **Inverted this tick:** `AS-70 depends_on AS-71` removed; `AS-71 depends_on AS-70` added. This task's transcription is written in exactly screen 1's shape (§3.2) so AS-71 joins both screens mechanically when it lands. The S2-ABANDON ledger-amendment wording (AS-45 plan §9 Q3) is **folded into AS-71's plan** rather than filed: AS-71 is the task that parses the ledger, so it is the moment the document and the product must agree, and the triage gate says a documentation residual is a comment, not a task.

## §1 Scope, and what this task is really deciding

**In scope:** screen 2 as HTML a browser renders — `GET /connect-stripe`, all nine ledger rows of `02-states-ledger.md` §2 accounted for — plus the R-2 hand-off AS-45 left in `routes/pages.js` (restore `GET /` → `303 /connect-stripe`) and the two inherited housekeeping debts (B5, the onboarding comment). Everything else the view layer needs already exists; this task adds **markup and tests, not mechanism**.

**Three things are being decided here, and only three:**

1. **The view model's input is the row and a boolean, and nothing else** (§3.2). The route reads the row; the view model reads `account === null` and `account.ready`; the query parameter never enters the view model as a string.
2. **`S2-RETURN-READY` ships without its "Continue to Dashboard" control** (§3.4). The Dashboard is AS-48's; a control that points at a route nothing serves is the R-2 defect again, one screen later.
3. **`GET /` becomes the redirect AS-45 promised**, and the six named cases move with it (§3.5).

**Not in scope, exhaustively:** the three existing connect handlers, their statuses or bodies; `test/connect.test.js` (**not modified at all** — a needed change means the boundary was crossed and the task stops); wiring `POST /connect-stripe/start`'s failure into the screen (AS-69, which depends on this task); the Dashboard, `POST_SIGNIN_LANDING`'s value, screen 3+ (AS-48); vendoring the ledger (AS-71); editing `docs/design/**` (Jonah's; the amendment wording travels to AS-71); any change to `public/app.css`; any stripe-mock case; `discoverRoutes`; B4 (§3.6 says why it stays deferred); any top-level protected markdown file.

## §2 File-level scope

Nothing outside this list is touched. A diff that changes a file not named here is a finding.

**Created**

| Path | What |
|---|---|
| `apps/invoicing/views/connect-stripe.ejs` | Screen 2, all four rendered states, presentation only |
| `apps/invoicing/lib/screens/connect-view.js` | Screen 2's pure view model: `CONNECT_LEDGER`, `CONNECT_STATES`, `connectLocals` |

**Modified**

| Path | Change |
|---|---|
| `apps/invoicing/routes/connect.js` | `router.get('/connect-stripe', …)` added — a render handler, **not** through `handle()`. No change to the three existing handlers. |
| `apps/invoicing/routes/pages.js` | `GET /` becomes `res.redirect(303, '/connect-stripe')`; `INTERIM_LANDING` deleted; header rewritten (§3.5) |
| `apps/invoicing/lib/views.js` | second `VIEWS` row, `sampleLocals: connectLocals()` |
| `apps/invoicing/lib/connect/onboarding.js` | **the `SCREEN_PATH` comment only** — it now names the route that serves the path. A code change here is a finding. |
| `apps/invoicing/test/screens.test.js` | screen-2 half (13 cases, §6); `INTERIM_LANDING_BODY` removed; two `/`-terminus cases rewritten; B4 comment's stale "AS-70's" pointer corrected |
| `apps/invoicing/test/auth.test.js` | route-surface literals (§0.2); `INTERIM_LANDING_BODY` and its comment removed; two terminal cases and H11's control rewritten (§3.5). **Net line count must not exceed 1,200** (§3.7) |
| `apps/invoicing/test/health.test.js` | `VIEWS` literals; `'GET / answers a signed-in caller rather than 404ing'` asserts the 303 |
| `apps/invoicing/test/dependency-policy.test.js` | source list + count; `VIEW_START_TAGS`; `scanConcept` gains a committed file count for `only:` rows and P4's floor becomes a count (§3.6) |
| `apps/invoicing/README.md` | § The three commands paragraph (the dangle is closed), § Obligations (the AS-70 bullets), § The view layer's "read this before planning … AS-70" line |

**Explicitly not modified:** `app.js`, `lib/config.js`, `lib/auth/**`, `lib/connect/readiness.js`, `lib/db/**`, `lib/stripe/**`, `public/app.css`, `Dockerfile`, `compose.yaml`, `package.json`, `package-lock.json`, `test/connect.test.js`, `test/assets.test.js`, `test/harness.test.js`, `test/config.test.js`, `test/deploy-shape.test.js`, every other test file, `docs/**`, and every top-level repo markdown file.

## §3 Design

### §3.1 The route

In `connectRoutes`, after the three existing handlers, below the auth boundary by position:

```js
// Screen 2 (AS-70). A PURE FUNCTION OF THE STORED ROW: no Stripe call, no write.
// Readiness is written only from a snapshot the writing request fetched itself
// (AS-41) — creation and return are the sync moments; a page view is not one.
router.get('/connect-stripe', (req, res) => {
  const account = repos.connectedAccounts.getByFreelancer(actingFreelancerId(req));
  res.render('connect-stripe', connectLocals({ account, startFailed: req.query.error === 'start' }));
});
```

Not through `handle()`: that wrapper exists for redirect actions and maps error classes to text/plain statuses; a render has no Stripe error to map. `actingFreelancerId` throws if the route is ever mounted above the boundary, as for the other three. The `'platform Stripe call'` and `'current user'` concept rows are untouched — the handler names neither `platform` nor `req.currentUser`.

### §3.2 The view model — `lib/screens/connect-view.js`

Mirrors `signin-view.js` exactly in shape: a frozen `CONNECT_LEDGER` (nine rows, id + disposition, transcribed **by hand and independently** from `02-states-ledger.md` §2, with the same R-4 docstring stating what the transcription is and is not joined to), a frozen `CONNECT_STATES` derived from the `rendered` rows, and a pure `connectLocals(input = {})`.

```
input.account:     null | { ready: boolean, … }   — the repository row, or null
input.startFailed: boolean                        — true ONLY when the route saw exactly ?error=start
```

**Decision 1 — the value never enters the view model.** The route computes `req.query.error === 'start'` and passes a boolean; the view model treats anything that is not literally `true` as `false` (`input.startFailed === true`). There is therefore no path by which the parameter's *value* can reach locals, and AC 14's "appears nowhere in the body" is structural rather than tested-for. A closed enum with one member today (`start`); AS-69 may add members when it wires the POST, and adds them in the route, not here.

**State selection, total over (account, startFailed), precedence stated:**

| `startFailed` | `account` | state |
|---|---|---|
| `true` | any | `S2-ERROR-SYSTEM` |
| `false` | `null` | `S2-DEFAULT-NOTSTARTED` |
| `false` | `ready === true` | `S2-RETURN-READY` |
| `false` | `ready === false` | `S2-RETURN-NOTREADY` |

The error flag wins over the row, deliberately: a start that failed is the most recent fact the visitor has, and its "Try again" control (a POST to `/connect-stripe/start`) is correct in every row state — no row: creates; not ready: resumes; ready: R5's zero-call short-circuit straight back to this screen. `ready` is **read, never re-derived** — the view model does not look at `chargesEnabled` or `requirementsCurrentlyDue` (AC 6's falsifier plants exactly that).

**Locals returned** (not frozen — express adds `_locals`; the nested objects are): `state`, `title`, `banner` (`null` or `{ tone: 'success'|'warning'|'error', message }`), `lede` (the one-sentence explanation, `S2-DEFAULT-NOTSTARTED` only, else `null`), `action` (`null` or `{ label }` — the one POST control, label per state), plus nothing else. **No account identifier, no `stripeAccountId`, no timestamps** reach locals: the page renders the state, not the row (AC 7).

**Copy, verbatim from the wireframe, with exactly one substitution** (the money-word landmine): "We never hold or move your clients' **funds** — Stripe pays you directly." Every other sentence is the wireframe's own: "Connect your Stripe account" / "You'll be taken to Stripe to verify your identity and add payout details." / "Connect with Stripe"; "You're connected" / "Your Stripe account is ready to accept payments."; "Almost there — Stripe needs more information" / "Stripe still needs more information before you can accept payments. You can't send invoices until this is finished." / "Finish setup on Stripe"; "Couldn't reach Stripe" / "Something went wrong starting Stripe setup. You haven't left this page — try again." / "Try again". Apostrophes are in element content only — measured safe by C4c; do not avoid them. **Zero occurrences of `amount|currency|money` (case-insensitive) in the view model, the template, and their comments** — the row scans raw text.

### §3.3 The template — `views/connect-stripe.ejs`

Same head block as `signin.ejs` (viewport meta, both stylesheets, `<html lang="en" data-state="<%= state %>">`, the P1–P4 header comment — and the same warning not to spell the raw-output tag inside the comment). Reduced chrome, no nav (01-screens.md §3). Body:

```
<main class="container">
  <h1 class="page-title"><%= title %></h1>
  <% if (lede !== null) { %><p><%= lede %></p><% } %>
  <% if (banner !== null) { %>
    <% if (banner.tone === 'success') { %><div class="banner banner-success"><p><%= banner.message %></p></div><% } %>
    <% if (banner.tone === 'warning') { %><div class="banner banner-warning"><p><%= banner.message %></p></div><% } %>
    <% if (banner.tone === 'error')   { %><div class="banner banner-error"><p><%= banner.message %></p></div><% } %>
  <% } %>
  <% if (action !== null) { %>
    <form method="post" action="/connect-stripe/start">
      <div class="form-actions"><button type="submit" class="btn btn-primary"><%= action.label %></button></div>
    </form>
  <% } %>
</main>
```

Two rules that make the recipes work, and they are **binding on the template's shape**:

- **The class name is a constant per branch, never `class="banner banner-<%= tone %>"`.** An interpolated class is inside a double-quoted value and would pass P1–P4, but it makes copy-shaped data select a stylesheet rule; the three-branch form keeps every class a literal and keeps the escaping surface to `title`, `lede`, `banner.message`, `action.label` — four sites, all element content, all renderer-authored constants. `signin.ejs` already uses `.banner-error`; `.banner-success` and `.banner-warning` become used for the first time.
- **The template does not branch on state ids** — the locals already carry the copy, so there are no `state === '…'` branches. **F11's mutation is therefore re-targeted (§7 F11):** the branch F11 deletes is the `banner.tone === 'warning'` branch, the only markup `S2-RETURN-NOTREADY` uniquely owns. The partition case (§6 case 2) asserts, over the template source, that each rendered state's **distinctive marker** occurs exactly once: `banner-success` (READY), `banner-warning` (NOTREADY), `banner-error` (ERROR), and the lede paragraph (NOTSTARTED — asserted as the `lede !== null` branch, count 1) — a committed table of four `(state, marker, count = 1)` rows, cardinality 4 asserted first. That is what turns the partition case red when a branch is deleted, and it is a claim about the template rather than about copy, so a wording change does not break it.

`action="/connect-stripe/start"` is a constant, never interpolated (P2a). `S2-RETURN-READY` renders **no form and no anchor** (decision 2, §3.4). NOTSTARTED has lede + no banner; the other three have banner + no lede.

### §3.4 `S2-RETURN-READY` ships without "Continue to Dashboard" — decision 2

The wireframe's READY state has `<a class="btn btn-primary">Continue to Dashboard</a>`. The Dashboard is screen 3, AS-48, not started. After this task `GET /` redirects to `/connect-stripe` (§3.5), so a `href="/"` would be a control that lands the freelancer on the page they are already on, and any other target 404s. That is R-2's defect — a success path ending nowhere — reproduced one screen later, and R-2's own rule applies: **a rework that depends on an unmerged task is not a fix.**

**Ruling:** READY renders the title and the success banner and **no control**. The deviation is recorded in the template comment and in README § Obligations as AS-48's hand-off: AS-48 adds the anchor (a constant `href`, so P2a is untouched) and a terminal-state case that follows it to a `200`. Asserted here as AC 9 so it cannot grow a dangling control quietly.

Rejected: linking to `/` (the cycle above); a `<button disabled>` (a control that does nothing is a control that lies); holding the merge for AS-48 (inverts the graph, and AS-69 and AS-49 wait on this task).

### §3.5 `GET /` becomes the promised redirect — decision 3, and the six cases

`routes/pages.js`: `res.redirect(303, '/connect-stripe')`; `INTERIM_LANDING` deleted; the header rewritten to say `/` is the onboarding landing until AS-48 replaces it with the Dashboard (and that AS-48 owns `POST_SIGNIN_LANDING`). `POST_SIGNIN_LANDING` **stays `'/'`** — unchanged, AS-45 §3.3.4's reasoning holds.

The six cases `routes/pages.js`'s header names (measured by AS-45's recipe F15), each rewritten in place, **no title changes** except the one marked:

| File | Case | Now asserts |
|---|---|---|
| `test/screens.test.js` | `'GET / is an interim text/plain line, not a screen'` → **retitled** `'GET / redirects a signed-in caller to the Connect screen, and renders nothing itself'` | `303`, `Location: /connect-stripe`, body has zero `data-state` and zero `<` |
| `test/screens.test.js` | `'a signed-in GET /signin lands on a page that exists'` | `hops === 2` (`/signin` → `/` → `/connect-stripe`), terminal `200`, path `/connect-stripe`, `occurrences(body, 'data-state="S2-DEFAULT-NOTSTARTED"') === 1` (seedSignedIn has no connected-account row) |
| `test/auth.test.js` | `'a successful sign-up with no next lands on a page that exists'` | same shape: hops 2, `200`, `/connect-stripe`, the NOTSTARTED sentinel counted once |
| `test/auth.test.js` | `'a successful sign-in with no next lands on a page that exists'` | same |
| `test/auth.test.js` | `'H11: a garbage cookie is refused exactly like an absent one'` — the admitted control | `303` with `Location: /connect-stripe` — **distinguishable from the guard's `/signin?next=%2F`** by Location rather than by status; the comment says so, because the status is no longer the discriminator |
| `test/health.test.js` | `'GET / answers a signed-in caller rather than 404ing'` | `303`, `Location: /connect-stripe` (this file's claim is routing) |

`followToTerminus`'s default `hopLimit` is 5; committed hop count 2. `INTERIM_LANDING_BODY` and its explanatory comment leave both test files. The `'a cookieless request for a guarded route lands on screen 1 carrying next in a hidden input'` case and G15 use `/` cookieless and are answered by the guard before the handler — **unchanged**.

### §3.6 Inherited debts: B5 lands, B4 stays deferred with its trigger corrected

**B5 (lands).** `scanConcept`'s `only:` rows carry `assert.ok(files.length > 0)` — a floor that cannot tell "examined 1 of 3 files" from "examined 3". With a second template the committed count is cheaper than the argument, as the AS-45 record said it would be. `scanConcept` gains an `expectFiles` option; each of the four `only:` rows passes **3** (`public/app.css`, `views/connect-stripe.ejs`, `views/signin.ejs`), and P4's `attrName.files > 0` becomes `=== 2`. Recipe F21 is the falsifier — in the direction the old floor could not see.

**B4 (stays deferred, trigger corrected).** `'no fixed-width box…'`'s comment says "widening it is AS-70's, when there are more stylesheets to widen it over." This task adds no stylesheet — every screen shares `app.css` by design — so the trigger as written never fires from a screen task. Correct the sentence to: the token check carries the claim outright; widen this case only if a second stylesheet ever lands in `public/`. One comment line, in a file this task edits anyway.

### §3.7 The 1,200-line ceiling on `test/auth.test.js` — a live trap

`'no file in apps/invoicing exceeds 1,200 lines'` measures `test/auth.test.js` at **1199 today**. The two route entries this task adds (§0.2) alone would make it **1201 → red**. The R-2 removals pay for it: deleting `INTERIM_LANDING_BODY` (1 line) and its three comment lines (`auth.test.js:757–759`) frees 4, so the net is **−2 → 1197**. The implementer measures the file with the test's own instrument (`node -e "console.log(require('fs').readFileSync('test/auth.test.js','utf8').split('\n').length)"`) before committing and records the number. **AS-46 will hit this wall** — it adds more route entries and has no removals to pay with — see §8.

### §3.8 Reachability, restated for what this task actually asserts

- **Offline (`test`):** all four renders (both halves of NOTREADY), `S2-DENIED-SIGNEDOUT`, `S2-ABANDON` as a path, `S2-EMPTY` as an absence, `S2-LOADING` as a committed `unrenderable` row, and `S2-REFRESH`'s **negative** half: `GET /connect-stripe/refresh` serves no markup and stamps no `data-state`, whatever its status (offline with no key it is a text/plain 503/404).
- **stripe-mock (`contract`):** nothing new. `S2-REFRESH`'s redirect is `connect.test.js` R9/R9b (fixture transport) and M3 (live mock) — **cited by exact title in the partition table, not duplicated.** The one verification is negative: `contract` still passes with the screen in the image (AC 24).
- **Not exercisable here:** `S2-LOADING` (browser-supplied, no client JS — P2c keeps it so); the real hosted round trip (AS-49/AS-50); pixels at 375px (§9).

## §4 Config changes

**None.** `SCHEMA` stays at 11. `Dockerfile` `COPY`s `views/` whole. No dependency: `express 5.2.1` and `ejs 6.0.1` remain the only two; `LOCK_ENTRIES` and `SANCTIONED.length` do not move.

## §5 Not-moving set — a diff that moves one is a finding

`test/connect.test.js` (any byte); `public/app.css` and therefore `APP_CSS_DECLARATIONS = 98`, `APP_CSS_VAR_REFERENCES = 76`; `PUBLIC_ROUTES` (6); `SIGNIN_PATH = '/signin'`, `POST_SIGNIN_LANDING = '/'`; `EXPECTED_TEST_FILES` (17); `RAW_OUTPUT_SANCTIONED` (0); every existing concept-row allowlist — in particular **no view, view model or route joins the `'money representation'` row**; `TOKENS_BYTES`, `TOKENS_DECLARATIONS`; every existing case title in every file except the one retitle in §3.5.

## §6 Acceptance criteria — each names its falsifier (M4)

Each criterion is satisfied by an **observed red** on the named recipe, never by an argument. Recipes are in §7. New case titles are **required verbatim**; a differently titled case is a finding.

**States**

1. `CONNECT_LEDGER` has exactly nine rows and `SCREEN_2_LEDGER` in `test/screens.test.js` — an independent hand transcription of `02-states-ledger.md` §2, in the document's own row order — equals it by exact set equality on `(id, disposition)`; `CONNECT_STATES` has exactly four members; both frozen. Case: `'screen 2 accounts for all nine of its ledger rows, and exactly four of them render'`. *Falsifier:* F11-b.
2. **The partition is arithmetic against a committed table:** `4 + 2 + 1 + 1 + 1 = 9` over the dispositions, and each rendered state's distinctive template marker (§3.3) occurs exactly once in the template source. Case: `"screen 2's nine ledger rows partition 4 + 2 + 1 + 1 + 1"` — the F11 title, verbatim. *Falsifier:* F11.
3. The view model is total over (account, startFailed): a 12-cell table — rows `null`, `{ ready: true }`, `{ ready: false }` × flags `undefined`, `true`, `'start'`, `['start']` — with the cell count asserted first, every cell's `state` asserted, the string/array flags yielding the row-derived state (not the error), and no local anywhere equal to the string `'start'`. Case: `'the Connect view model is a total function of the row and the error flag, and the flag is a boolean'`. *Falsifier:* F20.
4. `S2-DEFAULT-NOTSTARTED` renders over HTTP for a signed-in freelancer with no row: sentinel counted once, `action="/connect-stripe/start"` counted once, the lede sentence present with the word **funds**. Case: `'S2-DEFAULT-NOTSTARTED renders for a signed-in freelancer with no connected account'`. *Falsifier:* F7 — the concept row, not this case, is what goes red; this case must stay green under F7.
5. `S2-RETURN-NOTREADY` renders through **both halves of `ready`**, each its own case with a row seeded via `create` + `updateReadiness` (all six readiness keys — `chargesEnabled`, `detailsSubmitted`, `payoutsEnabled`, `requirementsCurrentlyDue`, `requirementsDisabledReason`, `syncedAt`): (a) `chargesEnabled: false, requirementsCurrentlyDue: []`; (b) `chargesEnabled: true, requirementsCurrentlyDue: ['external_account']`. Each asserts the sentinel once, `banner-warning` once, and the "Finish setup on Stripe" label once. Cases: `'S2-RETURN-NOTREADY renders when charges are disabled'`, `'S2-RETURN-NOTREADY renders when charges are enabled but requirements are still due'`. *Falsifier:* F11 (both red).
6. `S2-RETURN-READY` renders for `chargesEnabled: true, requirementsCurrentlyDue: []`: sentinel once, `banner-success` once. **And the view model reads `ready`, not its inputs:** an account object `{ ready: true, chargesEnabled: false, requirementsCurrentlyDue: ['x'] }` handed to `connectLocals` yields `S2-RETURN-READY`. Case: `'S2-RETURN-READY renders for a ready row, and the screen reads ready rather than re-deriving it'`. *Falsifier:* F22.
7. **The page renders the state, not the row:** on every rendered state's response the seeded `acct_` id occurs **zero** times, and the screen makes **zero** Stripe transport calls and **zero** writes (`updatedAt` of the seeded row byte-equal before and after two GETs), asserted with a `createStripeClient` whose transport counts and throws. Case: `'the Connect screen makes no Stripe call, writes nothing, and never renders the account id'`. *Falsifier:* F19.
8. `S2-ERROR-SYSTEM` renders at `GET /connect-stripe?error=start` (sentinel once, `banner-error` once, "Try again" once), for a freelancer with **and** without a row; and `?error=ASC70MARK"><b>` renders the row-derived state with **zero** occurrences of `ASC70MARK` in escaped or raw form. Case: `'S2-ERROR-SYSTEM renders at ?error=start, and the parameter value never reaches the page'`. *Falsifier:* F20.
9. `S2-RETURN-READY`'s body contains **zero** `<form` and **zero** `<a ` — no control until AS-48's Dashboard exists (§3.4). Asserted inside case 6. *Falsifier:* F23.
10. `S2-DENIED-SIGNEDOUT`: cookieless `GET /connect-stripe` → `303` `/signin?next=%2Fconnect-stripe` with no `Set-Cookie`; following it renders screen 1 in sign-in mode with `<input type="hidden" name="next" value="/connect-stripe" />`. Case: `'S2-DENIED-SIGNEDOUT: a cookieless GET /connect-stripe is answered by the guard and lands on screen 1 carrying next'`. *Falsifier:* not separately mutated — G3's cardinality going 11 → 12 is the observed evidence that the twelfth member is examined; the guard itself is unchanged and its recipes stand from AS-45.
11. `S2-REFRESH` and `S2-LOADING` never render this screen: a signed-in `GET /connect-stripe/refresh` (row seeded, no transport) returns a body with zero `data-state` and a non-HTML content type; the ledger rows are committed `redirect-answered` (citing `connect.test.js` R9/R9b/M3 by title in the comment) and `unrenderable — browser-supplied`. Case: `'S2-REFRESH and S2-LOADING never render this screen'`. *Falsifier:* F11-b.
12. `S2-ABANDON`: with a not-ready row, two successive `GET /connect-stripe` return byte-identical `S2-RETURN-NOTREADY` bodies — nothing is created or changed by viewing. Case: `'S2-ABANDON: returning directly after an abandoned onboarding renders the stored row, unchanged'`. *Falsifier:* F11-b's disposition edit (a disposition change on this row) — and the write half is case 7's.
13. `S2-EMPTY` renders no `<table`, `<ul`, `<ol`, `<li` (delimited match, the screen-1 idiom). Case: `'S2-EMPTY renders no section: the screen has no collection, and shows none'`. *Falsifier:* not separately mutated — the same instrument as screen 1's, proven under AS-45.

**Route surface and the landing**

14. The route walk finds exactly 18 routes; partition 6/12; `GET /connect-stripe` is in G2's protected list and G3 examines 12 members; G1b is 17; G15 is 18. *Falsifier:* the recount is the test; F8 (replacement) is **not** re-run — the guard did not change.
15. **Terminal states, all three entry points, followed to the end:** sign-up with no `next`, sign-in with no `next`, and a signed-in `GET /signin`, each `hops === 2`, terminal `200` at `/connect-stripe`, `S2-DEFAULT-NOTSTARTED` sentinel counted once (§3.5). *Falsifier:* F18 — exactly the six cases named in §3.5, observed.
16. `GET /` for a signed-in caller answers `303 /connect-stripe` with no body markup; H11's admitted control asserts that Location. *Falsifier:* F18.
17. `test/auth.test.js` is at most 1,200 lines by the ceiling test's instrument, and the implementation comment records the measured number. *Falsifier:* the ceiling test itself; measured baseline 1199 (§0.3).

**View layer**

18. `VIEWS` has two rows, both `sampleLocals` render; `/healthz` `views` check passes; `health.test.js`'s broken-template fixture still names `signin` (the check aggregates problems with `; `, so the second template's absence in the fixture dir does not change the assertion — confirm, do not assume). *Falsifier:* the fixture case is the existing guard.
19. P1–P4 all green over three files, and the four `only:` rows and P4 assert **committed** file counts (3 and 2). Case: the existing concept-row case (title unchanged — no new row). *Falsifier:* F21.
20. `VIEW_START_TAGS` equals the measured post-write count, three instruments agreeing, recorded in the constant's comment and in the implementation comment. *Falsifier:* F11 moves it (that is the fourth predicted case).
21. Zero occurrences of `amount|currency|money` (case-insensitive, raw text) across `views/`, `public/`, `lib/screens/`, `lib/views.js`, `routes/connect.js`, `routes/pages.js`. *Falsifier:* F7.
22. `app.css` is byte-identical to master (`git diff master...HEAD -- apps/invoicing/public` empty); `APP_CSS_DECLARATIONS`/`APP_CSS_VAR_REFERENCES` unmoved.

**Non-regression and record**

23. Full offline suite green inside `docker compose run --build --rm test` from an isolated project, with the `Image … Built` line quoted; cardinality reported before pass count; count compared to the §0.1 prediction and any divergence explained.
24. `docker compose run --build --rm contract` green from the same isolated project, no stripe-mock case added or modified, with its Built line.
25. `test/connect.test.js` unchanged: `git diff master...HEAD -- apps/invoicing/test/connect.test.js` is empty.
26. `lib/connect/onboarding.js` differs from master in comment lines only (the implementer quotes the hunk).
27. README: the "404s until AS-70" dangle paragraph, the § Obligations AS-70 bullets, and the "before planning … AS-70" line are corrected; `grep -n 'until AS-70\|AS-70 restores\|404s until' apps/invoicing/README.md` returns zero hits; the AS-48 hand-off (READY's control, `/`, `POST_SIGNIN_LANDING`) is stated once in § Obligations.
28. A Lattice comment records the 375px inspection per §9: viewport measured (not assumed), every rendered state looked at, every state not looked at.
29. Every §7 recipe run, with its assert-applied count on disk **and in the image**, predicted vs observed set, and every divergence classified, in a Lattice comment. F12 at both ends.
30. Commits as `developer-marcus` in the actor-id form; every commit `AS-70: …`; zero `.lattice/` paths in the branch diff; commit early and keep a scratchpad progress note (headless-tick cutoff rule).

## §7 Falsification recipes

**Rules** (AS-45 §7's, unchanged): assert on a marker the mutation introduces or an occurrence-accurate count (`grep -oF … | wc -l`, never `grep -c`); mutate a `git archive HEAD` extract **outside** the worktree; assert applied on disk **and in the built image** (`docker compose run --rm test sh -c 'grep -oF … /app/… | wc -l'` from the mutant project); anchor every pattern to the intended site and **re-read the mutated file's diff before concluding a guard is weak** (the AS-95 lesson); predict executable case titles **before** running; do not widen a prediction after observing; rebuild and re-run after restoring. Isolated project names per recipe (`-p asc-as70-f7` etc.), torn down with `down --rmi local`.

**F7 — the money row fires on the template (inherited, mandatory).** Baseline *(post-write)*: `grep -oiE 'amount|currency|money' views/connect-stripe.ejs | wc -l` = 0. Mutation: "funds" → "money" in the lede. Assert applied: `grep -oiF money views/connect-stripe.ejs | wc -l` = 1, on disk and in the image. *Predicted, exactly one:* the concept-row case, `money representation: found in […, views/connect-stripe.ejs], allowed in exactly […]`. A second red case means a case asserts on the copy — record it as a finding against that case.

**F11 — the state table is not decorative (inherited, re-targeted to §3.3's template shape).** Baseline *(post-write)*: `grep -oF 'banner-warning' views/connect-stripe.ejs | wc -l` = 1. Mutation: delete the `banner.tone === 'warning'` branch (the whole `<% if … %>…<% } %>` block). Assert applied: count 1 → 0, on disk and in the image. *Predicted, exactly four:* `'S2-RETURN-NOTREADY renders when charges are disabled'`, `'S2-RETURN-NOTREADY renders when charges are enabled but requirements are still due'`, `"screen 2's nine ledger rows partition 4 + 2 + 1 + 1 + 1"`, **and** the concept-row case on its `VIEW_START_TAGS` cardinality — the deleted block carries `<div>` and `<p>` start/end tags, so the committed count moves. The fourth is named here, before the run, per F17's rule. Three means the partition case does not read the template; five means something else asserts on the warning markup — name it.

**F11-b — the two transcriptions are compared.** Mutation: in `lib/screens/connect-view.js` change `S2-REFRESH`'s disposition to `'rendered'`. Assert applied: `grep -oF "'S2-REFRESH', disposition: 'rendered'" … | wc -l` = 1. *Predicted, exactly three:* `'screen 2 accounts for all nine …'` (set inequality and `CONNECT_STATES` 4 → 5), the partition case (arithmetic), and `'S2-REFRESH and S2-LOADING never render this screen'`. The `views` health check stays green (no template branch reads the disposition).

**F18 — the landing is followed to its terminus.** Mutation: `routes/pages.js` → `res.redirect(303, '/nope')`. Assert applied: `grep -oF "'/nope'" routes/pages.js | wc -l` = 1. *Predicted, exactly the six of §3.5.* Fewer means an entry point is unasserted; more means something else is coupled to `/`.

**F19 — the screen calls Stripe.** Mutation: in the `GET /connect-stripe` handler, before the render, `try { await onboarding.handleRefresh(freelancerId); } catch {}` (and make the handler `async`). Assert applied: the marker `handleRefresh(` count in `routes/connect.js` goes 1 → 2. *Predicted, exactly one:* case 7 (`calls === 0` fails — the throwing transport is called, the catch swallows it, the render proceeds). If the render cases also go red the catch did not apply — re-read the diff.

**F20 — the flag is a boolean.** Mutation: view model `input.startFailed === true` → `Boolean(input.startFailed)`. Assert applied: `grep -oF 'Boolean(input.startFailed)' | wc -l` = 1. *Predicted, exactly two:* case 3 (the `'start'`/`['start']` cells select the error state) and case 8 (`?error=ASC70MARK…` renders `S2-ERROR-SYSTEM`) — **only if the route also passes the raw value**; with the route's `=== 'start'` intact, case 8 stays green and the prediction is **one** (case 3). Run it as written (route intact), predict one, and say so: this recipe proves the view model's own edge, not the route's.

**F21 — the committed file count catches under-examination (the B5 direction the old floor could not see).** Mutation, scratch copy of the test file: P2b's `only` → `/^views\//` with `expectFiles` left at 3. Assert applied: the `/^(views|public)\//` literal count in the file goes 4 → 3. *Predicted, exactly one:* the concept-row case, on the new `examined 2 files, expected 3` assertion. **Direction two:** the same mutation on master's `> 0` floor stays green — run it, so the recipe measures the fix rather than the guard's existence.

**F22 — the view model re-derives `ready`.** Mutation: `account.ready === true` → `account.chargesEnabled === true && account.requirementsCurrentlyDue.length === 0`. Assert applied by the introduced marker `requirementsCurrentlyDue.length`, 0 → 1 in `lib/screens/`. *Predicted, exactly one:* case 6 (the unit half with `{ ready: true, chargesEnabled: false, … }`). The HTTP halves stay green — the repository's `ready` and the re-derivation agree on real rows, which is exactly why the unit half exists.

**F23 — a dangling control on READY.** Mutation: plant `<a href="/">Continue to Dashboard</a>` in the success branch. Assert applied: `grep -oF 'Continue to Dashboard' views/connect-stripe.ejs | wc -l` 0 → 1. *Predicted, exactly two:* case 6 (AC 9's zero-anchor assertion) and the concept-row case (`VIEW_START_TAGS` +2: the anchor's start and end tag). P2a stays green — a constant `href` is not an interpolation — and that is worth one sentence: AC 9 is what polices the control, not the escaping rows.

**F12 — the vacuity floor.** `-e ASC_SELFTEST_MUTATE=1 test` exits 1; plain `test` exits 0; at the start and the end, on rebuilt images.

**Not re-run** (unchanged guards, proven under AS-45 by two parties): F1–F6, F8/F8b, F9, F10, F13–F17, C4a–C4c. If the rework touches what one exercises, it is re-run and said so.

**Reviewer (Ruben) runs independently, minimum:** F7, F11, F18, F20, F21 — plus probing past the list (M6): a `?error[]=start` array, `?error=START`, a row whose `requirements_currently_due` is `[]` with `charges_enabled` 1 but `payouts_enabled` 0 (must be READY — `ready` ignores payouts by AS-41's rule; if the reviewer thinks it should not, that is a finding against AS-41's rule, routed to the CTO, not a rework of this task), a 5,000-character `?error=` value, and the redirect chain from `POST /signout` (unchanged, `303 /signin`, but follow it).

## §8 Seams — AS-90 and AS-46, and the merge order

**Merge order proposed: AS-90 (already in review) → AS-70 → AS-46.** AS-70 before AS-46 because AS-69 and AS-49 depend on AS-70 and nothing depends on AS-46 yet; AS-90 first because it is a stage ahead and touches none of AS-70's code files. The second screen lane to merge **rebases onto master and recounts every literal in §0.2 before its review starts**; the reviewer of the second lane verifies the recount against master, not against the plan.

**AS-90 (`feat/AS-90-d1-demo`, in review):** touches `Dockerfile`, `compose.yaml`, `demo/**`, `test/deploy-shape.test.js`, `test/dependency-policy.test.js` (adds `demo` to `SKIPPED_DIRS` and a fifth assertion in the closed-world case — a different hunk from the source list this task edits; textual merge expected clean), `README.md` (a demo section — a different region from the three paragraphs this task edits; watch it at rebase), `.claude/skills/**`, `docs/demo/**`. **Scope overlap with this task: none.** The demo drives Connect readiness by posting a **synthesized, signed `account.updated` webhook** to the receiver (AS-90 plan §0.3 step 5), not by rendering or visiting the screen; its step 4 follows `GET /connect-stripe/return` with `redirect: manual` and records the 303 target. After AS-70 merges, one sentence in the demo's step-4 `why` prose — "The redirect target 404s until screen 2 is built (AS-70)" — goes stale; the demo's behaviour does not. That sentence is AS-90's to correct if it merges second, or a one-line follow-up folded into AS-49 if it merges first; not this task's file.

**AS-46 (screen 4, being planned in parallel):** will add a view, a view model, a screens-test half, a `VIEWS` row, `ALL_ROUTES`/G2 entries, and bump the same literals: `auth.test.js` (G1/G1b/G2/G3/G15), `health.test.js` (`VIEWS` — 2 → 3, `['signin.ejs', 'connect-stripe.ejs', '<its view>']`), `dependency-policy.test.js` (source 52 → 54, `VIEW_START_TAGS`, the `expectFiles` counts 3 → 4 and 2 → 3), possibly `assets.test.js` if it edits `app.css`. Every one of those is a **recount against master at rebase time**. Two things AS-46's implementer must know from this plan: **(i) the 1,200-line ceiling on `auth.test.js` (§3.7)** — after AS-70 the file is 1197; AS-46's entries cross it, and the honest fix is to extract the route-surface block (`discoverRoutes`, `ALL_ROUTES`, `PUBLIC_ROUTES`, `UNROUTED_PATH`, G1/G1b/G2/G3, and G7/G15 which call `discoverRoutes`) into `test/route-surface.test.js`, moving `EXPECTED_TEST_FILES` 17 → 18 — a mechanical move the reviewer verifies as byte-identical text, not a rewrite; trimming comments to squeeze under is the wrong fix and is what the ceiling exists to refuse; **(ii) the `expectFiles` option on `scanConcept` exists after AS-70** and its counts are recounted, not copied.

## §9 The 375px inspection — obligation and instrument

Half is mechanical and already in the suite (viewport meta on every `VIEWS` row, mobile-first `app.css`, no fixed-width box); the second template joins those loops automatically. The other half needs eyes, and the record is a Lattice comment listing: the viewport **measured**, every rendered state looked at (four renders: NOTSTARTED, READY, NOTREADY, ERROR), every state not looked at, and any overflow, bad wrap, or control falling off.

**Instrument warning, from AS-45's own record: headless Chrome clamps `--window-size` to a 500px minimum and crops the PNG.** A 375-wide screenshot of a 500-wide layout shows inputs running off the edge and nearly produced a false defect twice. Either render each state inside a **375px-wide iframe** in a wider window and probe `documentElement.scrollWidth === clientWidth === 375` through the DOM, or drive Chrome over CDP with `Emulation.setDeviceMetricsOverride` (the AS-90 capture path). **A screenshot is evidence of the width you got only if something measured it.**

**Serving the states without touching the shared container:** `docker compose -p asc-as70-visual -f apps/invoicing/compose.yaml run --build --rm --no-deps -d -p 127.0.0.1:8358:8348 web` (a different host port; the project's own volume). Sign up through the browser for NOTSTARTED; `?error=start` for ERROR; seed the other two rows with a one-off in the same project (`run --rm --no-deps web node -e '…'` using `lib/db/database.js`'s `prepareDatabase` + `createRepositories` against `/app/data/invoicing.sqlite`: find the freelancer, `connectedAccounts.create`, `updateReadiness` not-ready, then ready). Tear down with `down -v --rmi local`. Dark scheme is Chrome's headless default; say which scheme was looked at.

## §10 Staffing, and the record the stages leave

- **Implement:** `agent:developer-marcus` — free this tick; Lena has just finished AS-90's implementation. Works in `.worktrees/AS-70` on `feat/AS-70-connect-screen`; commits early; scratchpad `scratchpad/agent-developer-marcus/AS-70/` only.
- **Review:** `agent:qa-ruben` — Priya is on AS-90's review; Ruben is the seam-and-parallel-lanes reviewer and this task has two seams. Scratchpad `scratchpad/agent-qa-ruben/AS-70/` only. Findings first, sweep second (M5); the M6 probes in §7 are budgeted, not optional. Both transitions carry `--no-auto-review`; the reviewer is told not to read any daemon note before forming findings.
- **Tasking messages carry the plan path, the criteria, and what to check — never the recount numbers this plan predicts** (the AS-36 rule): the reviewer measures `VIEW_START_TAGS`, the source count and the suite count independently.

## §11 Open questions, each with a default and a deadline

**Q1 — Does `?error=start` survive AS-69?** *Default: yes*, as the redirect target AS-69 lands on; AS-69's planner decides whether the POST redirects with it or the screen reads something else. **Deadline: AS-69 planning.**

**Q2 — READY's control.** *Default: none until AS-48* (§3.4). If the board or Carla wants a ready freelancer to have somewhere to go before the Dashboard exists, that is a product call and goes to `#bizdev`, not into this branch. **Deadline: AS-48 planning.**

**Q3 — The `S2-ABANDON` ledger wording.** *Default: fold into AS-71* (§0.4). **Deadline: AS-71 planning; AS-49 at the latest**, when the recorded run walks the path.

## §12 Stale items found while planning

1. The description's "four cardinality literals (currently 17 / 16 / 11 / 17)": the second 17 is **G15**, a separate case near the end of `auth.test.js`; the description reads as if G1 held two. Corrected in §0.2.
2. The description omits `VIEW_START_TAGS`, which moves with any new template. §0.2.
3. `screens.test.js`'s B4 comment names AS-70 as the widening trigger; the trigger cannot fire from a screen task. Corrected in §3.6.
4. `AS-70 depends_on AS-71` was inverted; corrected on the board this tick (§0.4).
5. `test/auth.test.js` sits one line under the ceiling. §3.7, and a warning to AS-46 in §8.
