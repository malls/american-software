# AS-69: D1 v1: a failed Connect start should land on the Connect screen's error state, not text/plain

Planned and implemented in one stage by `agent:developer-lena` (complexity `low`, two-stage path — CLAUDE.md § Employee Execution Model). Reviewer: **`agent:qa-priya`** (Ruben is on AS-46).

## 1. Decision: render the screen at the POST, status preserved

When `POST /connect-stripe/start` fails, the handler renders `connect-stripe` with `connectLocals({ account, startFailed: true })` — S2-ERROR-SYSTEM, "Try again" control and all — **at the same status `statusFor(err)` already picks** (502 for a Stripe refusal or transport failure, 503 for no key, 500 for the custody guard). No redirect.

Why this and not the 303 to `GET /connect-stripe?error=start`:

- **It is the house's existing failure idiom, one screen over.** AS-45 did exactly this for screen 1: `renderSignIn` renders S1-ERROR-SYSTEM at the POST "rather than emitting a one-line text/plain body — the status taxonomy did not move, so nothing that asserted on a status did either" (README § handoffs). Post-redirect-get is this app's idiom for *successful* POSTs (R3, R5, return, refresh); its idiom for a *failed* POST is render-in-place with the status kept. Matching screen 1 is the boring choice.
- **The failure stays a failure on the wire.** A 303→200 would make a Stripe outage look like a success to anything reading statuses — AS-49's end-to-end run, a future health probe, a reverse proxy's logs. A 502/503 with the screen as its body is both an honest response and the recovery affordance the description asks for.
- **It revises less of AS-41.** Only the body shape changes; the status taxonomy and every status assertion in `test/connect.test.js` stand. The description's alternative moves the statuses too.
- **One view model, one template, still.** `connectLocals` and `views/connect-stripe.ejs` remain the only renderer of the state; the POST's catch is a second *call site*, the same way `routes/auth.js` has two call sites for `signinLocals`.

Trade recorded: with a redirect, a browser reload of the error page re-GETs; with a render at the POST it offers to resubmit the form. For an error state whose only control *is* that resubmit, that is acceptable and matches screen 1.

## 2. What AS-41 decided, and what this revises — in the open

AS-41's stated decision (`routes/connect.js` header, plan §3.2): *"Error bodies are one-line text/plain (the routes/assets.js precedent) carrying the error class and the step that failed, never the key and never request material; screens render states from the DB row, not from these bodies."*

Revised for **the start handler only**: its error body is screen 2 in S2-ERROR-SYSTEM. Unchanged: the 303 rule, the status taxonomy (`statusFor` is not edited), the text/plain bodies of `return` and `refresh` (AS-70's `test/screens.test.js` pins refresh's "no markup, whatever its status" negative case, and return has no screen state of its own — its failures are the 404 of a legitimate flow that cannot happen, or a Stripe read failure with nothing to offer but "try the link again"), and "never the key, never request material" (the screen renders renderer-authored constants only).

**Known loss, named:** the error class and step (`StripeApiError: create-account`) no longer appear anywhere on the wire for a failed start. The app has no error log (only two startup `console.log` lines in `server.js`), so this task does not invent one; AS-49's run reads the row and the status. If a diagnostic surface is wanted, that is a separate task.

`?error=start` **survives** (AS-70 plan §Q1 default): it remains the documented direct URL for S2-ERROR-SYSTEM, tested by `test/screens.test.js`, and untouched here. The AS-70 comment in the GET handler said "AS-69 adds members HERE if it wires the POST's failure into the screen" — no member is added, because the POST does not travel through the query parameter; the comment is updated to say so.

## 3. Files

Owned (edited):
- `apps/invoicing/routes/connect.js` — the `handle()` catch gains a failure renderer for the start step; header comment and the GET's AS-69 note revised.
- `apps/invoicing/test/connect.test.js` — R10 and R11 body assertions move; new R14.
- `apps/invoicing/README.md` — the route-summary sentence for `POST /connect-stripe/start` gains the failure landing; the AS-41 handoff bullet records the revision.

Borrowed (read, not edited): `lib/screens/connect-view.js`, `views/connect-stripe.ejs`, `lib/auth/guard.js`. No new route, no new view, no new dependency, no migration, no shared literal moved (route-surface, VIEWS, app-source and template counts are unchanged — no file is added and no route is registered). AS-46 and AS-47 worktrees untouched.

## 4. Pinned assertions that move (same commit as the change)

The description's "four places" in `test/connect.test.js`, located: R10 `assert.equal(res.status, 502)`, R10 `assert.match(body, /StripeApiError/)`, R10 `assert.match(body, /create-account/)`, R11 `assert.equal(res.status, 503)`, R11 `assert.match(await res.text(), /ConfigError/)`. Under this decision the **two status assertions stay**; the **three body assertions are replaced** by the screen assertions (sentinel once, `Content-Type: text/html`, and — the inverse of what they asserted — zero occurrences of the error class and step in the body).

## 5. Acceptance criteria (M4: each names its falsifier)

1. **AC-1 — a failed start lands on the Connect screen's error state with its retry affordance.** For each failure class the description names — a Stripe 4xx (R10), no key configured (R11), Stripe unreachable (new R14, a transport that throws) — `POST /connect-stripe/start` answers with `statusFor(err)` unchanged (502/503/502), `Content-Type: text/html`, exactly one `data-state="S2-ERROR-SYSTEM"`, exactly one `banner-error`, exactly one `Try again`, exactly one `action="/connect-stripe/start"`, and zero occurrences of the error class name, the step name and `text/plain`. R10's "no row left behind" and R14's "no row" hold. *Falsifier:* `routes/connect.js` reverted to master's copy inside the worktree (the pre-change behaviour), tests unchanged. Assert applied: `grep -c 'startFailed: true' routes/connect.js` = 0 on disk and in the built image (post-change: 1); predicted red **exactly R10, R11, R14** — their status assertions pass and their first screen assertion fails. Restore with `git checkout -- routes/connect.js`, prove by `git status --porcelain` clean of that path plus a content hash equal to the committed blob, rebuild, re-run green.
2. **AC-2 — the status taxonomy did not move.** R10 stays 502, R11 stays 503, R13's guard 303s stand; `statusFor` has no diff. *Falsifier:* covered by the same reverted-file run — the status assertions are predicted **green** under the revert, which is what proves the change is body-only.
3. **AC-3 — return and refresh are untouched.** `test/screens.test.js`'s refresh negative case (no HTML, no `data-state`) and R8/R9 stay green with no edit to `screens.test.js`. *Falsifier:* not a new guard; a mutant that routes every step's failure through the screen renderer (`step === 'start'` → `true`) must turn the screens.test.js refresh case red — run once, record.
4. **AC-4 — hygiene.** Offline suite green with a `--build` receipt (`Image … Built` line quoted), `network_mode: none` untouched, `contract` service green (M1–M3 unchanged), no new dependency, no migration, no protected top-level file, no running container touched, `docker compose -p asc-impl-as69` only.

## 6. Implementation record (developer-lena, same stage)

Branch `feat/AS-69-connect-start-error-landing`, one commit `78415e3` (3 files: `routes/connect.js` +44/−19-ish, `test/connect.test.js`, `README.md`; 116/19 overall). Worktree clean after every run (`git status --porcelain` empty; `routes/connect.js` blob `0c30f95` before and after each mutant).

Receipts, all under `-p asc-impl-as69` (torn down `down -v --rmi local` at the end), logs in `scratchpad/agent-developer-lena/AS-69/`:

| Run | Image line | tests / pass / fail / skipped |
|---|---|---|
| offline `test`, post-change | `Image asc-impl-as69-test Built` | 420 / 402 / 0 / 18 (master baseline 419/401/0/18, +1 = R14) |
| **AC-1 falsifier** — `routes/connect.js` reverted to master's copy in place; applied: `startFailed: true` count 0 on disk and 0 in the image (`grep -c` inside the built container), `screenFailure` 0/0 | `Image asc-impl-as69-test Built` | 420 / 399 / **3** / 18 — **exactly R10, R11, R14**, each at the first screen assertion (`actual: 'text/plain; charset=utf-8'`, `expected: /text\/html/`); the status assertions ahead of it passed, which is **AC-2**'s proof |
| **AC-3 mutant** — `handle()` default `fail = plainFailure(step)` → `fail = screenFailure`, anchored to the one signature (count 1 on disk, 1 in image) | `Image asc-impl-as69-test Built` | 420 / 400 / **2** / 18 — `S2-REFRESH and S2-LOADING never render this screen` (AS-70's, screens.test.js) **and** R14's return/refresh half. One wider than the plan predicted, and expected: R14 gained that half after §5 was written |
| offline `test`, restored + rebuilt | `Image asc-impl-as69-test Built` | 420 / 402 / 0 / 18 |
| `contract` (stripe-mock) | `Image asc-impl-as69-contract Built` | 420 / 420 / 0 / 0 (M1–M3 connect and invoices green) |

Shared literals: none moved (no file added, no route registered, no view added). Reviewer: Priya.

## 7. Out of scope

Redirecting instead of rendering; changing `return`/`refresh` bodies; a `?error=` enum member; an error log; any `test/screens.test.js` edit; `docs/design/**`; the demo (`apps/invoicing/demo/run.mjs` pins only the 303 success path at step 3).
