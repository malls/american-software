# Core-loop flows — D1 v1

**Task:** Lattice AS-30. **Author:** Jonah Reyes (`agent:ux-jonah`). **Status:** implementation spec, written before wireframes per the states-ledger method (`personnel/ux-jonah-reyes.md`).

Words before pictures: this file is the numbered decision tree the wireframes in this
directory draw. Every step names the screen (1–7, per `01-screens.md` and milestone
plan §4.3) it happens on. Screens 1–7 map to the fixed inventory — nothing here adds
or removes a screen.

**Scope boundary, stated once so it isn't re-litigated per flow:** the loop **ends** at
"freelancer sees it paid." There is no reminders tail (row C-39) — the front-end design
plan §4's "→ reminders" is dead for v1. Where a step could plausibly continue toward a
reminder, a re-send, or a client-facing acceptance record, this document says so and
stops, rather than leaving a dangling implication.

---

## Flow 1 — Core loop, end to end (the demonstration path)

This is the literal Rule-1 chain from the milestone plan §1/§2.1, walked once, with its
unhappy branches named inline and pointed at their detailed flow. It is the path AS-50's
acceptance run exercises.

1. Freelancer arrives signed out, lands on **Screen 1** (Sign up / sign in), default mode
   = sign up (`S1-DEFAULT-SIGNUP`).
2. Freelancer submits the sign-up form (name, email, password).
   - **2a. Validation failure** (malformed email, weak/short password, missing required
     field) → Screen 1 re-renders with field-level errors; email and name are preserved
     in the fields, password is not (`S1-ERROR-VALIDATION`). Freelancer corrects and
     resubmits → back to step 2.
   - **2b. Email already registered** → Screen 1 shows a named conflict without exposing
     which credential of an existing account was tested (`S1-ERROR-SYSTEM`). Freelancer
     switches to sign-in mode or uses a different email.
3. Sign-up succeeds → session created → redirect to **Screen 2** (Connect Stripe),
   state `S2-DEFAULT-NOTSTARTED`.
4. Freelancer clicks "Connect with Stripe" → redirected to Stripe's own hosted
   onboarding (off our surface entirely — Rule 2).
   - **4a. Abandons mid-onboarding** → Flow 2, branch A.
   - **4b. Link refreshed/expired mid-onboarding** → Flow 2, branch B.
5. Stripe redirects back to our return URL.
   - **5a. Requirements still outstanding (not-ready)** → `S2-RETURN-NOTREADY`; invoicing
     stays blocked; the loop cannot proceed past this point. Flow 2, branch C.
   - **5b. Ready** → `S2-RETURN-READY`; freelancer continues to Screen 3.
6. Freelancer lands on **Screen 3** (Dashboard), first run: `S3-EMPTY-FIRSTRUN` — zero
   contracts, zero invoices, pointed at "Create your first contract."
7. Freelancer selects "New contract" → **Screen 6** (Contract create), `S6-DEFAULT`.
8. Freelancer has no clients yet → inline client creation (Flow 3, branch "create new").
   - **8a. Validation failure**, contract fields or the inline client fields →
     `S6-ERROR-VALIDATION` / `S6-CLIENT-ERROR-VALIDATION`; submitted values preserved.
     Corrects, resubmits → continue.
9. Contract generates → redirect to **Screen 7** (Contract detail), `S7-DEFAULT`. The
   placeholder-body warning and the CC BY 4.0 attribution line are both visible and both
   survive print (`02-states-ledger.md` §3, screen 7). Freelancer downloads or prints.
10. Freelancer sends the downloaded/printed document to the client **themselves**,
    through their own email client. This is not a system step — we have no client-facing
    contract link in v1 (C-22) and send no email at all (C-48). The flow stops here for
    the contract; nothing in our system tracks whether it was actually sent or received.
11. Freelancer returns to **Screen 3**, now `S3-DEFAULT-POPULATED` (one contract, zero
    invoices), selects "New invoice" → **Screen 4** (Invoice create), `S4-DEFAULT-CREATE`.
12. Freelancer selects the **existing** client from step 8 (Flow 3, branch "select
    existing" — not inline creation this time) and adds line items.
    - **12a. Validation failure** → `S4-ERROR-VALIDATION`; submitted line items, amounts,
      and due-in-days value preserved. Corrects, resubmits → continue.
13. Freelancer finalizes and sends the invoice. The finalize control's own copy states
    plainly that Stripe emails the client directly (`02-states-ledger.md`, `S4-DEFAULT-CREATE`)
    — see C-28. This is the only notification the client ever receives; we send nothing.
    - **13a. Stripe account not ready** — only reachable if a freelancer hits the invoice
      route directly by URL without having completed step 5 → `S4-GATED-STRIPENOTREADY`.
      Flow 5.
14. Finalize succeeds → redirect to **Screen 5** (Invoice detail), `S5-DEFAULT-OPEN` —
    "Sent — awaiting payment." Stripe's `hosted_invoice_url` and `invoice_pdf` appear as
    labeled outbound links (placeholder `href="#"` in the wireframe).
15. Client receives Stripe's email (off our surface), opens the hosted invoice page, pays
    (off our surface — C-34/C-35). **Not wireframed**: nothing past this point is ours to
    draw.
16. Stripe sends a webhook; our system updates the stored invoice status. See Flow 7 for
    the interval before this lands and what the freelancer sees if they check early.
17. Freelancer returns to **Screen 5** (or sees the row update on **Screen 3**) and sees
    `S5-DEFAULT-PAID`. **The loop ends here.** No reminder, no re-send, no next step is
    offered — there isn't one in v1.

**Note on sequencing, stated because a reader could otherwise infer a gate that does not
exist:** nothing in the capability table makes step 7 (contract) a prerequisite for step
11 (invoice). No capability row ties invoice creation to a prior contract. Flow 1
sequences contract-then-invoice because that is the literal order the milestone plan's
Rule-1 chain names (§1) and the order AS-50's acceptance run exercises — not because the
product enforces it procedurally. Flow 1a is the equally-valid alternative.

---

## Flow 1a — Invoice with no contract on file

Confirms Screens 6/7 are optional per invoice, never a gate in front of Screen 4.

1. Freelancer signed in, Stripe connected (post Flow 1 step 5b), on **Screen 3**,
   `S3-DEFAULT-POPULATED` or `S3-EMPTY-FIRSTRUN`.
2. Selects "New invoice" directly → **Screen 4**. Creates a client inline (Flow 3, branch
   "create new") — no contract exists for this client and none is required.
3. Adds line items, sets days-until-due, finalizes.
4. Continues exactly as Flow 1 steps 13–17.

No contract is created or referenced at any point in this path.

---

## Flow 2 — Connect Stripe, full branch detail (Screen 2)

The screen's own states ledger (`02-states-ledger.md` §2) is the source of truth; this
flow is the sequencing across those states.

1. Freelancer on **Screen 2**, never connected: `S2-DEFAULT-NOTSTARTED`. Screen explains,
   in one sentence, what "connect" means and what it does not (we never hold funds —
   this is board constraint 7 and belongs in the copy, not just the architecture).
2. Freelancer clicks "Connect with Stripe."
   - **System error creating the account link** (our call to Stripe fails before the
     redirect happens) → `S2-ERROR-SYSTEM`, retry control, freelancer never leaves our
     surface. This is distinct from every branch below, all of which require Stripe to
     have successfully handed control back to us.
3. Freelancer redirected to Stripe's hosted onboarding. Everything from here to step 4
   happens on Stripe's surface, not ours.

**Branch A — abandonment.** Freelancer closes the tab or navigates away mid-KYC, never
completing Stripe's flow and never triggering a redirect back to us.
- A1. Freelancer later returns to our app directly (not via a Stripe redirect — e.g.
  re-visits `/connect-stripe` or clicks "Dashboard" from a bookmark).
- A2. Screen renders `S2-DEFAULT-NOTSTARTED` again — from our side nothing changed,
  because Stripe never told us anything changed. **Cost of abandonment:** none on our
  side; Stripe holds whatever partial progress the freelancer made on their own KYC flow
  (that is Stripe's behavior, not something we control or can surface). The freelancer
  re-clicks "Connect with Stripe" and Stripe resumes them at their own last point.

**Branch B — refresh.** The account-link Stripe issued expires or is invalidated before
the freelancer finishes (a documented Stripe behavior for hosted onboarding links).
- B1. Stripe redirects the freelancer's browser to our **refresh URL**
  (`/connect-stripe/refresh`), not the return URL.
- B2. We mint a fresh account link and immediately redirect the freelancer back into
  Stripe's flow. Screen state in between is `S2-LOADING` (brief, since this is a
  redirect-to-redirect with no form to fill).
  - **B2a. Minting the fresh link fails** → same `S2-ERROR-SYSTEM` as step 2's inline
    failure; freelancer is back on our surface with a retry control.

**Branch C — not-ready return.** Stripe redirects to our **return URL**
(`/connect-stripe/return`) — this always happens once the freelancer exits Stripe's flow,
whether or not they actually finished.
- C1. We query the connected account's requirements.
- C2. **Requirements outstanding** → `S2-RETURN-NOTREADY`. Copy names that the account
  cannot yet accept payments and that invoicing is blocked until it can, with a control
  to re-enter Stripe's flow (mints a new account link, same as branch B). This is the
  screen's permanently-gating state referenced by Flow 5 and by Screen 3/4's own gating.
- C3. **Requirements met** → `S2-RETURN-READY`. Freelancer proceeds to Screen 3.

**Cross-cutting: signed-out access.** Reaching `/connect-stripe` or either redirect
target without a session → Flow 4 applies; this screen carries `S2-DENIED-SIGNEDOUT`
like every other authenticated screen.

---

## Flow 3 — Inline client creation (shared sub-pattern, Screens 4 and 6)

Specified once here and referenced by ID from both screens' ledgers
(`02-states-ledger.md` §4 and §6) — this is the sub-pattern carrying the cut Clients
screen's full weight (row C-16). Row IDs are screen-prefixed
(`S4-CLIENT-*` / `S6-CLIENT-*`) because an HTML `id` must be unique per page, but the
rules below are identical on both screens; each screen's ledger entry says so rather
than re-deriving them.

**Fields collected for a new client — deliberately minimal.** Name (required), email
(required). No capability row asks for an address, phone number, or company field, and
adding one would be exactly the scope-growth-through-empathy this spec exists to resist
— every field is load-bearing for the Stripe customer mirror (C-26) and for identifying
the counterparty on a contract/invoice, nothing more.

1. Freelancer reaches the client section of Screen 4 or Screen 6.
   - **1a. No clients exist yet** → `S{4,6}-CLIENT-EMPTY` — the picker starts in
     "add new client" mode with an explanatory line ("No clients yet — add one below."),
     no dead "select existing" control shown as disabled (a disabled control with
     nothing behind it is a design lie the plan explicitly rules out — see
     `01-screens.md` Assumptions).
   - **1b. Clients exist** → picker defaults to "select existing," with "add a new
     client instead" as a visible toggle.
2. **Branch "select existing":** freelancer picks a client from a `<select>`. No further
   validation beyond "a client must be selected" before the parent form (invoice or
   contract) can submit.
3. **Branch "create new":** freelancer fills name + email.
   - **3a. Validation failure** (empty name, malformed email) →
     `S{4,6}-CLIENT-ERROR-VALIDATION` — submitted values preserved, same re-render
     discipline as every other form in this spec.
   - **3b. Duplicate-looking client** — the new email **exactly** (case-insensitive)
     matches an existing client's stored email →
     `S{4,6}-CLIENT-ERROR-DUPLICATE`. Non-blocking: a warning names the existing client
     by name and email and offers "use this client instead" (switches to branch
     "select existing," pre-selected) alongside "create a new client anyway" (some
     freelancers legitimately have two contacts sharing a shared inbox). **Match rule is
     exact email match only — no fuzzy name matching.** Fuzzy matching would need a
     matching library or a hand-rolled heuristic with its own failure modes, and no
     capability row asks for it; exact-email is deterministic, cheap, and honest about
     its limits.
4. **Abandonment mid-client-creation** — freelancer leaves the parent form (invoice or
   contract) before submitting → `S{4,6}-CLIENT-ABANDON`. No client record is created;
   no draft is held. Returning to Screen 4/6 starts over at step 1's applicable variant.
   This is the same "nothing persists until submit succeeds" rule as the parent form's
   own abandonment state — stated once here rather than implying a different rule for
   the nested form than the outer one.

---

## Flow 4 — Signed-out access to a guarded screen (cross-cutting)

Applies to Screens 2–7 identically; Screen 1 is the only unguarded screen (and Screen 1
has its own inverse case — an already-signed-in freelancer hitting it, see
`02-states-ledger.md` §1).

1. A request arrives for a Screen 2–7 route with no valid session.
2. Server redirects to **Screen 1**, sign-in mode, with a one-line reason ("Sign in to
   continue") rather than a bare redirect with no explanation.
3. Freelancer signs in successfully → redirected to the **originally requested route**,
   not unconditionally to the Dashboard. (Landing on Screen 3 after every sign-in when
   the freelancer was trying to open a specific invoice would silently discard their
   intent — a small thing, and exactly the kind of thing this spec exists to pin down
   rather than leave to a developer's guess.)
4. Sign-in failure at this point follows Screen 1's own validation/system error states
   (Flow 6) — nothing about arriving here from a guard changes that screen's behavior.

Ledger row: `S{2..7}-DENIED-SIGNEDOUT` on every guarded screen.

---

## Flow 5 — Stripe-account-not-ready gating on invoicing (cross-cutting)

Gating is scoped **narrowly to invoicing** (row C-11: "an account that cannot charge
blocks invoicing"). It does **not** gate contract creation — contracts have no Stripe
dependency at all, and `02-states-ledger.md` §6 carries an explicit n/a row saying so
rather than leaving the absence to be inferred.

1. Freelancer's Stripe account has outstanding requirements (Flow 2, branch C, state
   `S2-RETURN-NOTREADY`).
2. Freelancer navigates to **Screen 3** (Dashboard) → lists render normally
   (`S3-DEFAULT-POPULATED` or `S3-EMPTY-FIRSTRUN`), but the "New invoice" action is
   disabled with an inline note ("Connect Stripe before invoicing — finish setup") and
   a link to Screen 2. "New contract" is **not** affected. State: `S3-GATED-STRIPENOTREADY`,
   layered on top of whatever the list's own state is (populated or empty) — it is a
   property of the action, not a replacement for the list.
3. Freelancer somehow reaches **Screen 4** directly anyway (typed URL, stale bookmark,
   browser back after a state change) → `S4-GATED-STRIPENOTREADY`. The form does not
   render into a dead end; it explains the block and links to Screen 2. This is a true
   permission-denied state, not a disabled button, because the route itself must refuse
   to serve a working invoice form to an unready account — a disabled button is a
   client-side nicety, not the enforcement.
4. Freelancer completes Stripe setup (Flow 2, branch C → `S2-RETURN-READY`) → gate lifts
   on the next request; no separate "unlock" step exists.

---

## Flow 6 — Form validation, general pattern (Screens 1, 4, 6)

Named once because the rule is identical on every form screen and the stack decision
(`docs/engineering/01-stack-decision.md` §10.4 item 3) makes it a literal test
requirement: **every form screen carries a test asserting that a validation failure
re-renders the user's submitted values.**

1. Freelancer submits a form with at least one invalid field.
2. Server re-renders the **same screen**, same route (no redirect to a generic error
   page), with:
   - Field-level error text next to each invalid field (not only a page-level summary —
     a summary alone forces the freelancer to hunt for which of several fields failed).
   - Every **non-sensitive** submitted value preserved in its field exactly as typed.
   - **Password fields are the one deliberate exception** — never re-populated, on
     screen 1, even on a validation failure unrelated to the password. This is a
     security convention (a re-rendered password value is a value that now sits in page
     source and browser autofill/history), stated explicitly here so the re-render test
     required by the stack decision is written against the right fields on Screen 1 and
     nobody "fixes" the missing password value as a bug.
3. Freelancer corrects the invalid field(s) and resubmits → step 1 again, or success.

Ledger rows: `S1-ERROR-VALIDATION`, `S4-ERROR-VALIDATION`, `S6-ERROR-VALIDATION`, plus
the nested client sub-pattern's own validation rows (Flow 3).

---

## Flow 7 — Payment received → freelancer sees it paid (Screen 5)

The chain's final link (C-36), and the literal end of the loop.

1. Client pays on Stripe's hosted page (Flow 1 step 15 — off our surface).
2. Stripe sends a webhook to our system. This is asynchronous relative to the client's
   payment — there is a real, non-zero interval where the client has paid and our stored
   state does not yet reflect it.
3. **Freelancer checks Screen 5 (or Screen 3) during that interval** → sees
   `S5-DEFAULT-OPEN` still ("Sent — awaiting payment"), which is **honest but stale**,
   not wrong: we have not been told yet. No spinner or "processing" state is shown here,
   because there is no request in flight on the freelancer's side to spin on — this is a
   background sync, not a foreground action. `02-states-ledger.md` §5 states this
   distinction explicitly so it is not mistaken for a missing loading state.
4. Webhook lands, signature verified, invoice state updated (C-36; the verification and
   idempotency mechanics are AS-44's, not drawn here).
5. Freelancer's next view of Screen 5 (or the row on Screen 3) shows `S5-DEFAULT-PAID`.
   **The loop ends. No further action, reminder, or next step is offered by this
   product in v1.**

**What this flow deliberately excludes:** re-send, reminders, or any dunning affordance
past this point (row C-39, C-40 — both `OUT`, both absent from every wireframe in this
set, not merely absent from this flow).
