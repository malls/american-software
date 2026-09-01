# States ledger — D1 v1

**Task:** Lattice AS-30. **Author:** Jonah Reyes (`agent:ux-jonah`). **Method:** the
states ledger before the drawing (`personnel/ux-jonah-reyes.md`) — this file is the
source of truth; `screen-N-*.html` renders every row below as a labeled section whose
`id` equals the row ID, both directions, no orphans (acceptance criterion 4).

**Six required categories per screen:** default/populated, loading, empty, error
(validation and system separately where a form exists), permission-denied/gated,
abandonment. Every screen below has at least one row in each category; a category that
genuinely does not apply carries an explicit "n/a — because" row rather than silence.
Two states with identical layout and different copy share a rendered section **only**
where this document says so explicitly (it does not happen anywhere in this set — every
row below gets its own section, because every row differs in more than copy).

Row IDs are stable and screen-prefixed. Categories in the tables below use the shorthand
**DEFAULT / LOADING / EMPTY / ERROR / GATED / ABANDON** (GATED covers both
permission-denied and Stripe-readiness gating — both are "you may not proceed" states,
distinguished by cause in the Trigger column).

---

## 0. Shared sub-pattern — inline client creation

Full specification: `00-flows.md` Flow 3. Referenced, not re-derived, from Screens 4
and 6 below. Carries the cut Clients screen's full weight (C-16).

| Row ID pattern | Category | Trigger | What renders |
|---|---|---|---|
| `S{4,6}-CLIENT-EMPTY` | EMPTY | Freelancer has zero stored clients | Picker opens directly in "add new client" mode; no "select existing" control renders at all (not disabled — absent; a disabled control with nothing behind it is a lie, per `01-screens.md` §4.1) |
| `S{4,6}-CLIENT-ERROR-VALIDATION` | ERROR | Inline name/email fails validation on submit | Name/email fields re-render with the freelancer's submitted values and inline error text, same re-render discipline as the parent form (Flow 6) |
| `S{4,6}-CLIENT-ERROR-DUPLICATE` | ERROR | Submitted email exactly (case-insensitive) matches an existing client | Non-blocking warning naming the existing client (name + email), "use this client instead" (switches to select-existing, pre-selected) and "create anyway" both offered |
| `S{4,6}-CLIENT-ABANDON` | ABANDON | Freelancer leaves the parent form before submitting | No client record created, nothing persisted; return to the parent screen starts the picker over at its applicable EMPTY/default variant |

---

## 1. Screen 1 — Sign up / sign in

One route, two modes (`01-screens.md` §2). Local credentials only; no reset/verify
affordance exists anywhere on this screen (C-09 `OUT`) — not shown disabled, not shown
at all.

| Row ID | Category | Trigger | What renders |
|---|---|---|---|
| `S1-DEFAULT-SIGNIN` | DEFAULT | `GET /signin`, no session | Email + password fields, "Sign in" submit, link to sign-up mode |
| `S1-DEFAULT-SIGNUP` | DEFAULT | `GET /signin?mode=signup`, no session | Name + email + password fields, "Create account" submit, link to sign-in mode |
| `S1-LOADING` | LOADING | Between submit and the server's redirect/response | Fields disabled, submit button reads "Signing in…" / "Creating account…" |
| `S1-EMPTY` | EMPTY | n/a — because a credentials form has no collection to be empty; nothing to list | *(n/a row — no section rendered; documented so its absence is a decision, not an oversight)* |
| `S1-ERROR-VALIDATION` | ERROR | Malformed email, short/empty password, empty required field | Field-level errors; email/name preserved in their fields; **password field is never re-populated on any error, by design** — see `00-flows.md` Flow 6 |
| `S1-ERROR-SYSTEM` | ERROR | Sign-up: email already registered. Sign-in: no matching account or wrong password | Sign-up names the conflict plainly. Sign-in uses one deliberately generic message ("Email or password is incorrect") for both "no such account" and "wrong password," to avoid confirming which emails have accounts — a stated security decision, not an unspecified one |
| `S1-DENIED-AUTHENTICATED` | GATED | An already-signed-in freelancer requests this screen | No form renders; immediate redirect to Dashboard (Screen 3). Documented so "what happens if a signed-in user hits /signin" is not left to a guess |
| `S1-ABANDON` | ABANDON | Freelancer starts filling either mode, navigates away | No cost — nothing is created server-side until a submit succeeds. Returning renders a blank `S1-DEFAULT-*` again |

## 2. Screen 2 — Connect Stripe

Full branch detail: `00-flows.md` Flow 2. Connection status lives here **permanently**
(C-41 cut) — no other screen ever shows or repeats it.

| Row ID | Category | Trigger | What renders |
|---|---|---|---|
| `S2-DEFAULT-NOTSTARTED` | DEFAULT | Signed in, connected-account never created | One-sentence explanation of what "connect" means and does not (we never hold funds), "Connect with Stripe" CTA |
| `S2-RETURN-READY` | DEFAULT | Stripe return redirect; requirements met | Success confirmation, "Continue to Dashboard" |
| `S2-LOADING` | LOADING | Between clicking "Connect" and Stripe's redirect; between the refresh handler and its re-redirect | Brief "Redirecting to Stripe…" — no form, since this state has nothing to fill |
| `S2-EMPTY` | EMPTY | n/a — single-status screen, no collection | *(n/a row)* |
| `S2-ERROR-SYSTEM` | ERROR | Our account-link creation call to Stripe fails (before any redirect) | Error banner, "Try again," freelancer never left our surface |
| `S2-RETURN-NOTREADY` | GATED | Stripe return redirect; requirements still outstanding (C-11) | Names that the account cannot yet accept payments; invoicing is blocked; "Finish setup on Stripe" re-enters the hosted flow |
| `S2-DENIED-SIGNEDOUT` | GATED | No session | Redirect to Screen 1 per `00-flows.md` Flow 4 |
| `S2-REFRESH` | ABANDON | Stripe invalidates the onboarding link before completion (its own timeout, not our action) | Transient — mints a fresh account link, immediately redirects back into Stripe's flow; `S2-ERROR-SYSTEM` if minting fails |
| `S2-ABANDON` | ABANDON | Freelancer closes the tab mid-Stripe-KYC, later returns directly (not via a Stripe redirect) | Renders `S2-DEFAULT-NOTSTARTED` again — we were never told anything changed. Stripe holds whatever partial progress the freelancer made; re-clicking "Connect" resumes them there (Stripe's behavior, not ours to surface) |

## 3. Screen 3 — Dashboard / list

Invoices and contracts as two separate `<table>`s (they are different record types;
merging them into one table with a type column would obscure more than it saves at this
scale). First-run empty state is the post-onboarding landing.

| Row ID | Category | Trigger | What renders |
|---|---|---|---|
| `S3-DEFAULT-POPULATED` | DEFAULT | At least one contract or invoice exists | Two tables (Contracts, Invoices), each row linking to its detail screen; status column on the invoice table |
| `S3-LOADING` | LOADING | Initial fetch | Labeled loading placeholder in place of each table |
| `S3-EMPTY-FIRSTRUN` | EMPTY | Zero contracts and zero invoices (always true immediately post-Screen-2) | Both tables replaced by one message pointing at the loop's actual next action: "Create your first contract" (primary) with "or create an invoice directly" (secondary) — see `00-flows.md` Flow 1a |
| `S3-ERROR-SYSTEM` | ERROR | List fetch fails | Error banner in place of both tables, "Retry" |
| `S3-GATED-STRIPENOTREADY` | GATED | Stripe account not ready | Layers on top of whichever DEFAULT/EMPTY state is otherwise active: "New invoice" nav action is disabled with an inline note + link to Screen 2; "New contract" is unaffected (`01-screens.md` §5) |
| `S3-DENIED-SIGNEDOUT` | GATED | No session | Redirect to Screen 1 |
| `S3-ABANDON` | ABANDON | n/a — because the Dashboard is a landing/list view with no in-progress task of its own to abandon | *(n/a row)* |

## 4. Screen 4 — Invoice create/edit

Carries inline client creation (§0). Line items, `days_until_due`, single currency
(USD only — no selector). Edit mode only applies while an invoice is still a draft; once
finalized/sent there is no "edit" capability (none in the capability table) — Screen 5
is the read-only view from that point on.

| Row ID | Category | Trigger | What renders |
|---|---|---|---|
| `S4-DEFAULT-CREATE` | DEFAULT | `GET /invoices/new` | Client picker (§0), 2–3 example line-item rows with an "Add line item" control, `days_until_due` number field, "Save draft" and "Finalize & send" actions. Finalize control's own copy states plainly that **Stripe** emails the client (C-28) |
| `S4-DEFAULT-EDIT` | DEFAULT | `GET /invoices/:id/edit`, invoice still a draft | Same layout, pre-populated from the stored draft |
| `S4-LOADING` | LOADING | Between submit and response (save or finalize) | Fields disabled, submitting button reads "Saving…" / "Sending…" |
| `S4-CLIENT-EMPTY` | EMPTY | Zero stored clients (§0) | Client picker opens in add-new mode |
| `S4-ERROR-VALIDATION` | ERROR | Missing/invalid line item, non-positive `days_until_due`, no client selected | Field-level errors; **all submitted line items, amounts, and the due-in-days value are preserved** — the re-render property the stack decision's test asserts (`00-flows.md` Flow 6) |
| `S4-ERROR-SYSTEM` | ERROR | Save/finalize succeeds on our side but the Stripe call fails (e.g. creating the invoice on the connected account) | Distinct from validation: names that the invoice was not sent, nothing was charged, and invites retry — never conflated with a field-level error |
| `S4-CLIENT-ERROR-VALIDATION` | ERROR | Inline client fields invalid (§0) | Per §0 |
| `S4-CLIENT-ERROR-DUPLICATE` | ERROR | Inline client email matches an existing client (§0) | Per §0 |
| `S4-GATED-STRIPENOTREADY` | GATED | Stripe account not ready, screen reached directly | Form does not render into a dead end — explains the block, links to Screen 2. A true server-side refusal, not a disabled button dressed as one (`00-flows.md` Flow 5) |
| `S4-DENIED-SIGNEDOUT` | GATED | No session | Redirect to Screen 1 |
| `S4-ABANDON` | ABANDON | Freelancer leaves a **new, never-saved** invoice mid-form | Nothing persisted; returning to `/invoices/new` starts blank |
| `S4-CLIENT-ABANDON` | ABANDON | Freelancer leaves the nested client form specifically, parent invoice form still open (§0) | Per §0 — distinct from `S4-ABANDON`: only the nested client attempt is lost, not necessarily the invoice draft itself |

**Note on editing an existing draft and abandonment**, since it's a real distinction the
single `S4-ABANDON` row above doesn't fully cover: leaving `/invoices/:id/edit` mid-edit
loses only the **unsaved** changes: the draft record itself (as it was last explicitly
saved) still exists and reappears at `S4-DEFAULT-EDIT` on return. There is no
autosave in v1 — no capability row asks for one, and inventing one here would be scope
this spec does not own.

## 5. Screen 5 — Invoice detail + status

Surfaces Stripe's `hosted_invoice_url` and `invoice_pdf` as labeled outbound links
(placeholder `href="#"` in the wireframe — C-38). This is the freelancer's entire window
on "did the client pay" (C-36).

| Row ID | Category | Trigger | What renders |
|---|---|---|---|
| `S5-DEFAULT-DRAFT` | DEFAULT | Invoice exists, not yet finalized | Status "Draft," edit and finalize actions, no Stripe links yet (none exist until finalize) |
| `S5-DEFAULT-OPEN` | DEFAULT | Finalized and sent, not yet paid | Status "Sent — awaiting payment," `hosted_invoice_url` and `invoice_pdf` as labeled outbound links. **This state is honest but can be stale** — see `S5-LOADING` note below |
| `S5-DEFAULT-PAID` | DEFAULT | Webhook-confirmed payment | Status "Paid," success-styled. **This is the loop's terminal state** (`00-flows.md` Flow 7) — no further action is offered |
| `S5-LOADING` | LOADING | Initial fetch of the invoice record | Labeled loading placeholder. **Deliberately not used for the payment-pending interval**: between the client paying and our webhook landing, the freelancer sees `S5-DEFAULT-OPEN`, not a spinner — there is no request in flight on the freelancer's side to spin on; this is a background sync, and showing a spinner here would imply we're actively checking when we are not (`00-flows.md` Flow 7, step 3) |
| `S5-EMPTY` | EMPTY | n/a — because this is a detail screen for one specific, already-existing invoice; there is no collection to be empty | *(n/a row — see `S5-ERROR-NOTFOUND` for "the record doesn't exist")* |
| `S5-ERROR-NOTFOUND` | ERROR | Invoice ID does not exist | Plain "not found," link back to Dashboard |
| `S5-ERROR-SYSTEM` | ERROR | Fetch fails for a reason other than nonexistence | Error banner, retry |
| `S5-DENIED-SIGNEDOUT` | GATED | No session | Redirect to Screen 1 |
| `S5-DENIED-NOTOWNER` | GATED | Signed in as a different freelancer, requests an invoice ID they don't own | **Renders identically to `S5-ERROR-NOTFOUND`** — a deliberate security decision: confirming "this ID exists but isn't yours" leaks more than confirming nothing. Listed as its own row because the *reason* differs even though the *rendering* doesn't, and a reviewer should be able to see that was a choice |
| `S5-ABANDON` | ABANDON | n/a — because viewing a detail screen creates no in-progress state to abandon | *(n/a row)* |

## 6. Screen 6 — Contract create

Carries inline client creation (§0). One template in v1 (C-17). Placeholder-body
marking is mandatory and is a legal gate, not a blemish (§3 below).

| Row ID | Category | Trigger | What renders |
|---|---|---|---|
| `S6-DEFAULT` | DEFAULT | `GET /contracts/new` | Client picker (§0), the one v1 template's variable fields, **placeholder-body warning banner** (warning tokens, §3), "Generate contract" action |
| `S6-LOADING` | LOADING | Between submit and response | Fields disabled, "Generating…" |
| `S6-CLIENT-EMPTY` | EMPTY | Zero stored clients (§0) | Per §0 |
| `S6-ERROR-VALIDATION` | ERROR | A required template variable is missing/invalid | Field-level errors; all submitted values preserved |
| `S6-ERROR-SYSTEM` | ERROR | Generation/save fails after validation passes | Distinct from validation; names that nothing was created, invites retry |
| `S6-CLIENT-ERROR-VALIDATION` | ERROR | Per §0 | Per §0 |
| `S6-CLIENT-ERROR-DUPLICATE` | ERROR | Per §0 | Per §0 |
| `S6-GATED-STRIPENOTREADY` | GATED | n/a — because contract generation has no Stripe dependency; C-11's gate is scoped to invoicing only, and folding it in here would misrepresent what actually blocks this screen (`01-screens.md` §5) | *(n/a row, stated explicitly rather than left as a silent absence)* |
| `S6-DENIED-SIGNEDOUT` | GATED | No session | Redirect to Screen 1 |
| `S6-ABANDON` | ABANDON | Freelancer leaves mid-form | Nothing persisted — **contracts have no draft concept** (unlike invoices, C-19 describes generation as one atomic step: variables → stored record + document, no separate save-as-draft). Returning to `/contracts/new` starts blank |
| `S6-CLIENT-ABANDON` | ABANDON | Per §0 | Per §0 |

## 7. Screen 7 — Contract detail + print/download

v1's entire delivery mechanism (C-21/C-22). Placeholder-body marking and the CC BY 4.0
attribution line are both part of the document region itself, so both print and download
with it (§3).

| Row ID | Category | Trigger | What renders |
|---|---|---|---|
| `S7-DEFAULT` | DEFAULT | Contract exists | Rendered document region (placeholder body + warning banner + CC BY 4.0 line), "Print" and "Download" actions |
| `S7-LOADING` | LOADING | Initial fetch | Labeled loading placeholder |
| `S7-EMPTY` | EMPTY | n/a — detail screen for one existing record, no collection | *(n/a row)* |
| `S7-ERROR-NOTFOUND` | ERROR | Contract ID does not exist | Plain "not found," link back to Dashboard |
| `S7-ERROR-SYSTEM` | ERROR | Fetch/render fails for a reason other than nonexistence | Error banner, retry |
| `S7-DENIED-SIGNEDOUT` | GATED | No session | Redirect to Screen 1 |
| `S7-DENIED-NOTOWNER` | GATED | Signed in as a different freelancer | Renders identically to `S7-ERROR-NOTFOUND`, same reasoning as `S5-DENIED-NOTOWNER` |
| `S7-ABANDON` | ABANDON | n/a — a read/print screen creates no in-progress state | *(n/a row)* |

**On print as a rendering context, not a ledger row:** `@media print` is a CSS rendering
variant of whichever state is active (in practice, always `S7-DEFAULT` — nobody prints a
"not found" page), not a distinct state with its own trigger or data. It is governed by
`wireframe.css`'s print block (§5.3 of the plan file), not by a `S7-PRINT-*` row. The
placeholder-body warning and the CC BY 4.0 line are written into the print rules so both
survive — verified in the rendering pass (`03-verification-notes.md` — recorded in this
task's Lattice comment, not a separate file per the plan's fixed layout).

---

## 8. Row count against the wireframes, for the reviewer's mechanical check

8 (Screen 1) + 9 (Screen 2) + 7 (Screen 3) + 12 (Screen 4) + 10 (Screen 5) + 11
(Screen 6) + 8 (Screen 7) = **65 states across 7 screens.** Every ID above appears as a
section `id` in its matching `screen-N-*.html`; no wireframe contains a section whose id
is not a row above. n/a rows render no section (documented here as the reason for their
absence, per plan file §4's ledger discipline) — **eight** such rows, one or more per
screen except Screen 4 (which has none — every category genuinely applies there):
`S1-EMPTY`, `S2-EMPTY`, `S3-ABANDON`, `S5-EMPTY`, `S5-ABANDON`, `S6-GATED-STRIPENOTREADY`,
`S7-EMPTY`, `S7-ABANDON`. **65 − 8 = 57 rendered sections** across the seven wireframes.
