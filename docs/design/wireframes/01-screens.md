# Screen inventory + shared chrome — D1 v1

**Task:** Lattice AS-30. **Author:** Jonah Reyes (`agent:ux-jonah`).

## 1. The inventory is fixed at 7 — restated, not renegotiated

Authority: `docs/engineering/00-d1-v1-milestone-plan.md` §4, and the CTO's screen-budget
comment on this task (2026-08-31T23:50:52Z), which discharges the "hard screen budget
agreed with the CTO at kickoff" clause in this task's description. **Ceiling 9, target 7,
landed 7. Two screens of headroom are deliberately unspent.** Spending one is a CTO
amendment-log entry, not a design call (open question §8.2 of the plan file) — this
document does not spend it, and does not need to (see §5 below).

A **screen** is a distinct route with its own states ledger (milestone plan §4.1).
Modals, drawers, and every loading/empty/error/denied/abandonment variant are states of
a screen, not screens — depth lives in `02-states-ledger.md`, not here.

| # | Screen | Route (provisional) | Capability row | Consumer task | One-line purpose |
|---|---|---|---|---|---|
| 1 | Sign up / sign in | `GET /signin`, `GET /signin?mode=signup` | C-08 | AS-45 | Get a freelancer a session — local credentials only. |
| 2 | Connect Stripe | `GET /connect-stripe`, `GET /connect-stripe/return`, `GET /connect-stripe/refresh` | C-12 | AS-45 | Start and report on Stripe's hosted onboarding; the permanent home of connection status. |
| 3 | Dashboard / list | `GET /dashboard` | C-37 | AS-48 | One list of the freelancer's invoices and contracts; the landing screen post-onboarding. |
| 4 | Invoice create/edit | `GET /invoices/new`, `GET /invoices/:id/edit` | C-29 | AS-46 | Draft, edit, and finalize/send an invoice; carries inline client creation. |
| 5 | Invoice detail + status | `GET /invoices/:id` | C-38 | AS-48 | The freelancer's window on "did the client pay" — surfaces Stripe's hosted links. |
| 6 | Contract create | `GET /contracts/new` | C-20 | AS-47 | Generate a contract from the one v1 template; carries inline client creation. |
| 7 | Contract detail + print/download | `GET /contracts/:id` | C-21 | AS-47 | v1's entire delivery mechanism — a clean, printable document the freelancer sends themselves. |

Routes are **provisional — final routes owned by AS-45..48**, per this task's own open
question default (plan file §8, item 1). What is not provisional: the screen count, the
capability-row mapping, and which states belong to which screen (`02-states-ledger.md`).

`index.html` in this directory links every wireframe below. It is a design-doc artifact,
not a product screen, and does not count against the budget (plan file §1).

## 2. Route mechanics worth stating, because a route shape is a design decision here

- **Screen 1 is one route, two modes**, per the CTO's comment and the plan file §4 row 1.
  The mode is a **query parameter on the same path** (`?mode=signup`, default when
  absent is sign-in), not two paths — a full page load switches modes, so the "switch
  mode" control is a plain link, and the screen needs no client-side JavaScript to
  change modes. This keeps the "one route" instruction literal rather than aspirational.
- **Screen 2's return/refresh are handler endpoints, not pages.** Stripe requires two
  distinct URLs (`return_url`, `refresh_url` on the account link) that it redirects to
  directly — those paths must exist. Per the CTO's comment they are **states of this
  screen, not screens**: both handlers resolve immediately (refresh mints a new account
  link and redirects back into Stripe; return checks requirements and renders) into one
  of Screen 2's own ledger states. Neither has its own layout, chrome, or content
  distinct from Screen 2 — a visitor never perceives them as separate pages.
- **Screens 4 and 6 use presence-of-`:id` to select create vs. edit**, the same shape as
  Screen 1's mode switch — one template, a mode determined by the route, not a second
  screen. (Screen 6 has no edit mode — see §5.)

## 3. Shared chrome

Rendered in the wireframes of authenticated screens 3–7 only. Screens 1–2 are pre/mid-
onboarding and carry **reduced chrome** — no nav, since there is nowhere authenticated to
navigate to yet.

**Header** (all screens): a plain-text app label, **"Invoicing"** — see the wordmark
decision in §4. No user menu beyond the sign-out control below; no notifications, no
search. Chrome is furniture, not a screen, and furniture that does nothing yet is scope
this spec does not add.

**Nav** (screens 3–7 only), three destinations plus one control, in this order:
1. **Dashboard** (`/dashboard`) — link.
2. **New invoice** (`/invoices/new`) — link. Disabled (with inline note, not a dead
   link — see Flow 5) when the freelancer's Stripe account is not ready.
3. **New contract** (`/contracts/new`) — link. Never disabled; contract creation has no
   Stripe dependency (§5).
4. **Sign out** — a `<button>` inside a small `<form>` (a mutating action is not a `GET`
   link, even in a wireframe that submits nowhere) at the end of the nav, visually
   separated from the three destinations above.

No breadcrumb, no secondary nav, no account-settings entry point — that screen is cut
(C-41); its two survivors are exactly where they show up: connection status lives
permanently on Screen 2 (linked from the disabled-state note above, not from the chrome
itself), and invoice branding lives in the freelancer's own Stripe account, which this
product never renders (C-14).

## 4. Assumptions

Per plan file §8's closing instruction: genuinely open questions default to the
narrower reading, noted here rather than resolved silently.

1. **The company wordmark does not appear in the product chrome, on purpose.**
   `BRANDING.md` §5.3 rule 7 states the wordmark "identif[ies] the entity, not a
   product" and must "never [be used] as a product's logo." No product brand exists yet
   — naming is explicitly gated (milestone plan rows C-46/C-47; `BRANDING.md` §1, §9).
   Putting "THE AMERICAN SOFTWARE COMPANY" in the app header would be exactly the
   misuse §5.3 forbids; inventing a product name/mark here would be scope this task does
   not own (visual design and naming are Sofia's and the board's, not mine). The
   resolution: the chrome carries the plain-text working label already established in
   the codebase — **"Invoicing"**, matching the `apps/invoicing/` directory name
   (`docs/engineering/01-stack-decision.md` §12) — rendered as ordinary body text, no
   wordmark styling, no logo treatment. This is a placeholder label, not a brand
   decision, and should be treated as disposable the moment product naming lands.
2. **Client fields are name + email only**, nothing else. See `00-flows.md` Flow 3 —
   no capability row asks for more, and this is exactly the failure mode ("every user
   problem wants a screen/field") this role exists to resist.
3. **No product-level footer, no marketing surface, no trust badges anywhere in the
   chrome.** Rows C-47 and C-54 are both `OUT`; adding either here would be scope this
   spec was told not to carry.
4. **Sign-in redirects to the originally-requested route after success** (`00-flows.md`
   Flow 4, step 3), not unconditionally to the Dashboard. Not stated anywhere in the
   source documents; the narrower reading (preserve intent) is the one that avoids
   silently discarding what the freelancer was doing.

## 5. Why Screen 6 (Contract create) carries no Stripe-readiness gating

Stated explicitly rather than left as a silent omission, because its sibling forms
(Screens 3 and 4) *are* gated and a reader could reasonably assume this one is too.
Contract generation (C-19) has no Stripe dependency at all — it produces a stored record
and a rendered document, nothing else. Gating (C-11) is scoped to invoicing specifically
("an account that cannot charge blocks invoicing"). `02-states-ledger.md` §6 carries the
explicit "n/a — because" row this decision requires.

## 6. Marking convention: product copy vs. wireframe annotation

**Added in review cycle 2**, closing QA finding H1 (AC12): `.page-meta` and `.field-hint`
were each carrying both product copy and notes about the wireframe itself (route/ledger
citations, capability-row references, "in the real app…" asides), in both directions,
with the distinction stated nowhere — exactly the "design question an implementer has to
ask" this handoff contract exists to prevent.

The distinction is now marked mechanically, not left to be inferred from which class
wraps a span: **any element carrying the `data-wf-note` attribute is wireframe
annotation and must not be built into the product; any element without it is copy the
product renders, verbatim.** The attribute is deliberately orthogonal to visual
styling — `.page-meta` and `.field-hint` remain purely typographic (small, muted text at
two different layout positions: a page/state-level note block, or an inline note under a
field) and are used for both kinds of content depending on context. It is the attribute,
not the class, that an implementer — or a script — checks.

A single element never carries both. Where a control or a sentence is genuinely mixed
with a note about it (screen 1's mode-switch line originally read "New here? Create an
account — in the real app this link carries `?mode=signup`…"; screen 4's Finalize
sentence originally ended "...We do not see or store that email (C-28, C-48)."; screens
6 and 7's legal-gate banner originally ended "...pending a lawyer-agent review of the
adapted source template (C-17)…", and screen 7's copy additionally carried a sentence
about the wireframe's own print behaviour), the two are split into sibling elements —
one plain, one `data-wf-note` — never merged into one string.

**Product copy may not embed internal citations** (added in review cycle 3, closing QA
finding H1-R — the unclosed remainder of H1, found on screens 6 and 7). Capability-row
ids (`C-17`), task ids, ledger-row ids, and process/status language — including who or
what performs an internal review and whether it has cleared — are, by definition, notes
about the wireframe or about the company's own process, never a string the product
renders to a user. Any such token belongs only inside a `data-wf-note` sibling. This
binds even where the plain element already reads correctly on its own and a citation
would only be *appended* to it: the citation still gets its own sibling, never a
tacked-on clause at the end of the product sentence.

**Exempt by construction:** states whose entire content is behavioral narration because
nothing actually renders to a user in that state — the recurring DENIED-SIGNEDOUT /
REFRESH / ABANDON banners that describe a redirect, a no-op, or the consequence of
leaving a form — are not marked sentence-by-sentence. **The test is categorical, not
textual**: a state whose id contains `DENIED`, `REFRESH`, or `ABANDON` is, by
construction, describing something that happens *instead of* or *around* rendering,
never a page a user reads on screen — so there is no rendered product string in that
state to disambiguate from annotation in the first place. (Reworded in review cycle 3,
closing N1: the earlier wording claimed every such state's `<h2>` literally says
"No … renders", which holds for 12 of the 16 but not for `S2-REFRESH`, `S4-ABANDON`,
`S4-CLIENT-ABANDON`, or `S6-CLIENT-ABANDON` — their headings narrate a specific redirect
or a specific loss instead, e.g. "What's lost depends on create vs. edit". That variety
is fine; retrofitting four working headings into one template sentence would trade a
real reader's clarity for an incidental grep pattern the exemption never actually ran
on. The id-substring test above is what exempts a state and is what the mechanical
check below keys on — the heading text was only ever a description of the effect, not
the mechanism.) Likewise the pre-existing, already-unambiguous wireframe furniture
(`.wireframe-notice`, `.state-label`, `.state-toc`) needs no attribute — it was never in
question.

**Mechanically checkable**, so this convention doesn't rot the way the unstated one did:
`grep -c 'data-wf-note' docs/design/wireframes/screen-*.html` counts every annotation
span per file. A script can additionally confirm the stronger invariant — that no
`data-wf-note` element contains a `<button>`, `<input>`, `<select>`, `<textarea>`,
`<label>`, or an `<a>` — so a required control can never be accidentally marked
removable; this was run across all seven screens after the cycle-2 edits and found zero
violations (recorded in this task's Lattice comment).

**Widened in review cycle 3 (closing N4):** the invariant above originally exempted
`.btn`-classed anchors only, which does not cover a required control that happens to be
a plain, unclassed `<a>` — screen 1's mode-switch link is exactly this, and QA proved by
mutation that marking its paragraph as annotation produced zero hits under the old
invariant. The convention also deliberately allows `data-wf-note` elements to contain
genuine in-document cross-reference links (e.g. screen 4's
`<a href="#S4-DEFAULT-CREATE">`, pointing a reader at another state) — those are
annotation about the spec, not a product control, and forbidding them outright would be
wrong. The fix separates the two kinds of anchor instead of conflating them: any `<a>`
inside a `data-wf-note` element must now carry the `wf-xref` class to be permitted; an
`<a>` inside a `data-wf-note` element without it is flagged exactly like an unmarked
button or input. `wf-xref` carries no styling of its own — typographically identical to
plain annotation text — it exists solely as the checker's marker, so an implementer or
a script reads intent from one signal, not two.
