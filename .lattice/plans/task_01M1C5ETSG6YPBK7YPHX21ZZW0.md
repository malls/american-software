# AS-30: Product core-loop UX: flows, states ledger, static wireframes (step-5 gated)

Phase B1 of the front-end design plan (docs/design/00-frontend-design-plan.md, board msg 283). HARD GATE: starts only after the board's explicit step-5 green-light on the decision memo (docs/strategy/07-decision-memo.md §4) — the memo recommends D1 (freelancer invoicing/contract automation) but the recommendation is not a decision, and its named falsifier (demand validation via warm intros) is still open. Held at needs_human until the board answers step 5. After the gate, for the green-lit product: numbered user flows for the core loop (if D1: onboard → connect payments → contract → invoice → get paid → reminders), screen inventory under a hard screen budget agreed with the CTO at kickoff, complete states ledger per screen (loading/empty/error/permission-denied/abandonment), and low-fidelity static HTML wireframes under docs/design/wireframes/ consuming the AS-29 tokens (depends_on AS-29). Acceptance: handoff contract in plan doc section 5 — a developer-agent can implement without asking a design question. No framework/stack commitment is implied by this task; stack choice is a separate later decision.

## Reset 2026-08-31 by agent:ceo-carla

---

# Plan — filed 2026-09-01 by Owen Kessler (agent:cto-owen), tech lead for this stage

**Implementer:** `agent:ux-jonah` (Jonah Reyes, UX Designer — model `sonnet` per dossier).
**Reviewer:** `agent:qa-priya`, cold, against §7 below.
**Complexity:** medium-high (four coupled deliverables, but the surface is fixed and small).
**Worktree:** `.worktrees/AS-30` on branch `feat/AS-30-core-loop-ux`. All implementation
commits touch **only** `docs/design/wireframes/**` — nothing else, no exceptions (§6.4).

Jonah: you were not in the conversations that produced this. Everything you need is in
this file and the documents it cites. Read, in order, before touching anything:

1. `lattice show AS-30` and `lattice comments AS-30` — especially the CTO screen-budget
   comment of 2026-08-31T23:50:52Z, which is **binding scope** for this task.
2. `docs/engineering/00-d1-v1-milestone-plan.md` §4 (screen budget, the definition of
   "screen", the 7-screen inventory) and the §3 capability rows cited below.
3. `docs/design/00-frontend-design-plan.md` §4 Phase B1 and §5 (the engineering handoff
   contract — your acceptance floor).
4. `docs/design/tokens/tokens.css` (read the header comments — they explain the
   primitive/semantic block structure) and `docs/design/style-reference/index.html`
   (open it in a browser; it is what the components look like wearing the tokens).
5. `BRANDING.md` §7 (refusals) — things the brand never does; your wireframes inherit them.

## 1. What this task produces (scope)

Four deliverables, all under `docs/design/wireframes/`:

1. **Numbered core-loop flows** (`00-flows.md`). The confirmed product is D1. The core
   loop for v1 is: **sign up → connect own Stripe account → create contract for a client
   → issue invoice on that client → client pays (on Stripe's surface, not ours) → freelancer
   sees it paid.** The loop **ends there**. The "→ reminders" tail in the design plan §4 is
   dead for v1 (row C-39) — see §2.
2. **Screen inventory + shared chrome spec** (`01-screens.md`). The inventory is *fixed*
   at the 7 screens in milestone plan §4.3 — you restate it with your provisional route
   labels and per-screen purpose, you do not renegotiate it.
3. **Per-screen states ledger** (`02-states-ledger.md`). Every screen, every state:
   default/populated, loading, empty, error, permission-denied/gated, abandonment.
   This is where the depth of this task lives.
4. **Static HTML wireframes** — one file per screen, plus an index and one shared
   stylesheet (§5). Low-fidelity, zero JavaScript, zero build step, rendering every
   ledger state as a labeled section.

A screen is **a distinct route with its own states ledger** (milestone plan §4.1).
Modals, drawers, and every loading/empty/error/denied/abandonment variant are *states of
a screen*, never screens. The wireframe `index.html` is a design-doc artifact, not a
product screen — it does not count against the budget.

## 2. Non-scope — binding exclusions, and why they shape the design

These come from the screen-budget comment on this task and milestone plan §3/§4. Each is
a decided cut with a capability-row citation. Do not design any of them, and do not
leave a hole where one "would go" — design the v1 surface as complete in itself.

- **No Reminders screen, no reminder UI of any kind** (C-39). Stripe's own reminder
  cadences ride on the connected account; the freelancer configures them in their own
  Stripe Dashboard. The core loop ends at "freelancer sees it paid".
- **No Clients screen** (C-16). Consequence that *shapes* your work rather than merely
  subtracting from it: **inline client creation on screens 4 and 6 carries the cut
  screen's full weight.** Create-new-client and select-existing-client must both be
  designed properly inside the invoice and contract forms — including the states of that
  inline path (validation error, duplicate-looking client, abandoning the form with a
  half-entered client). Specify it once as a shared sub-pattern and reference it from
  both screens' ledgers.
- **No Account-settings screen** (C-41). Stripe connection status lives on screen 2;
  invoice branding lives in the freelancer's own Stripe account (C-14). Sign-out is a
  control in the chrome, not a screen.
- **No email from us, anywhere** (C-48) — v1 sends zero email. Three consequences:
  - **No password reset, no email verification, no magic links** (C-09). The auth flow on
    screen 1 has no "forgot password" affordance. Do not add a disabled or "coming soon"
    one — a dead control is a design lie; the flow simply does not offer it.
  - **Contract delivery is freelancer-mediated** (C-22). There is no client-facing
    contract link in v1. Screen 7 *is* the delivery mechanism: it must produce a clean
    printable/downloadable document the freelancer sends through their own email client.
    Treat the document region and its print rendering as first-class (§4, screen 7).
  - **The invoice reaches the client only because Stripe emails it** on finalize/send
    (C-28, C-31). The flows and screen copy must say this plainly — the freelancer needs
    to understand what "send" does, since we never send anything ourselves.
- **No client-facing surfaces at all** beyond what Stripe hosts (C-34, C-35). Screen 5
  surfaces Stripe's `hosted_invoice_url` and `invoice_pdf` as outbound links; we do not
  wireframe what lives behind them.
- **No 8th screen, ever, in this task.** Two screens of headroom exist under the ceiling
  of 9 and are deliberately unspent. Spending one is a CTO amendment-log event, not a
  design call — see §8 for how you raise it if the ledger honestly cannot fit.
- **No visual-design work.** Colors, type, spacing, component look are settled by AS-29
  (`tokens.css` + style reference). You consume; you do not restyle, and you never edit
  `BRANDING.md`, `docs/design/tokens/*`, or `docs/design/style-reference/*` (§5.2).
- **No app code, no framework artifacts, no stack implications.** Static HTML only.

## 3. Legal gate — placeholder contract body and CC BY 4.0 attribution

Two things are **visible in the wireframes and may not be styled away**. This is a legal
gate, not a blemish, and QA will fail the task if either is subtle:

1. **The contract body is clearly-marked placeholder text** until a lawyer-agent review
   of the adapted Common Paper templates clears (C-17). Screens 6 and 7 must carry a
   loud, warning-toned marking (use the `--color-warning-*` semantic tokens) that the
   body is placeholder and not legal advice. On screen 7 the marking must also survive
   into the printed document — it ships on the paper until the review clears.
2. **The generated document carries a CC BY 4.0 attribution line** (C-18). It renders
   inside the document region of screen 7 — part of the document itself, so it prints
   and downloads with it — in readable body-adjacent size, not decoratively minimized.

## 4. The seven screens — what each wireframe must cover

From milestone plan §4.3; each with its capability row and consuming build task. Per
stack decision §10.4 item 2, each of these becomes exactly one template file — your
one-file-per-screen layout (§5) maps 1:1 onto that.

| # | Screen | Row | Consumer | Notes binding the wireframe |
|---|---|---|---|---|
| 1 | Sign up / sign in | C-08 | AS-45 | ONE route, two modes (mode switch is a state, not a second screen). Local credentials only; no reset/verify affordances (§2). |
| 2 | Connect Stripe | C-12 | AS-45 | Stripe's hosted onboarding does the work; this screen initiates and reports. The **return** and **refresh** redirects are states of this screen. Must show a **not-ready** state (C-11): Stripe returns the user whether or not requirements are met, and an account that cannot charge blocks invoicing. Connection status lives here permanently (C-41 cut). |
| 3 | Dashboard / list | C-37 | AS-48 | Invoices and contracts, one screen. First-run empty state is the post-onboarding landing — design it to point at the loop's next action. Must reflect Stripe-not-ready gating (C-11). |
| 4 | Invoice create/edit | C-29 | AS-46 | Carries **inline client creation** (§2). Line items, `days_until_due`, single currency (C-27). Finalize/send action must plainly say Stripe emails the client (C-28). |
| 5 | Invoice detail + status | C-38 | AS-48 | Surfaces Stripe's `hosted_invoice_url` and `invoice_pdf` as clearly-labeled outbound links (placeholder `href="#"` in the wireframe). Status states here are the freelancer's window on "client paid" (C-36). |
| 6 | Contract create | C-20 | AS-47 | Carries **inline client creation** (§2). One template in v1 (C-17). Placeholder-body marking (§3). |
| 7 | Contract detail + print/download | C-21 | AS-47 | **This is v1's delivery mechanism.** Clean document region; print/download affordances; CC BY 4.0 attribution line inside the document; placeholder marking survives print. A minimal `@media print` rule hiding app chrome for this screen is in scope (§5.3). |

**Shared chrome** (spec'd in `01-screens.md`, rendered in wireframes of authenticated
screens 3–7): minimal navigation among Dashboard / new invoice / new contract, and a
sign-out control. Screens 1–2 are pre/mid-onboarding and carry reduced chrome. Keep it
minimal — chrome is furniture, not a screen.

**States ledger discipline** (Jonah, this is your own Copperfield method — the ledger
comes before the drawing): every screen gets a row for each category —
default/populated, loading, empty, error (validation and system separately where a form
exists), permission-denied/gated (signed-out access; Stripe-not-ready where relevant),
abandonment (what leaving mid-task costs and what the user finds on return; on screen 2
this is where return/refresh live). A category that genuinely does not apply gets an
explicit "n/a — because …" row, never silence. Two states with identical layout and
different copy may share a rendered section only if the ledger says so explicitly.

**Form error states re-render submitted values** (stack decision §10.4 item 3: every
form screen carries a test asserting exactly this). Your error-state sections for
screens 1, 4, and 6 must show the user's submitted values still in the fields, not
blanked — draw the state the test will assert.

## 5. File layout, naming, and token plumbing (exact)

### 5.1 Layout

```
docs/design/wireframes/
  00-flows.md               numbered core-loop flows (§1.1)
  01-screens.md             screen inventory, provisional routes, shared chrome spec
  02-states-ledger.md       per-screen states ledger; row IDs like S4-ERROR-VALIDATION
  index.html                links every wireframe; notes it is a doc artifact, not a screen
  wireframe.css             the ONE shared stylesheet for wireframe chrome (§5.3)
  screen-1-signin.html
  screen-2-connect-stripe.html
  screen-3-dashboard.html
  screen-4-invoice-create.html
  screen-5-invoice-detail.html
  screen-6-contract-create.html
  screen-7-contract-detail.html
```

Numbers match the §4 inventory. Each `screen-N-*.html` renders **every ledger state of
that screen as a labeled section**, each section carrying an `id` equal to its ledger
row ID — that 1:1 mapping is a hard acceptance criterion (§7.4). No JavaScript anywhere:
states are shown as separate rendered sections, not toggled interactively.

### 5.2 Token plumbing — get this exactly right

- Every wireframe page links the tokens **relatively, with no build step**:
  `<link rel="stylesheet" href="../tokens/tokens.css">` — the identical pattern
  `docs/design/style-reference/index.html` already uses at the same directory depth.
  It works over `file://` and `http://` alike; open the file in a browser and it renders.
- **Never copy `tokens.css`, never edit it.** Exactly one copy of those bytes exists in
  version control by design: `apps/invoicing` vendors it at image build and serves it
  byte-identical at `/tokens.css`, and its test suite asserts the committed byte count
  (12,199). A second copy drifts silently; an edit turns AS-37's suite red. If you
  believe a token is *missing*, that is a `lattice comment` addressed to `agent:cto-owen`,
  not an edit (§8).
- Do **not** link `reference.css` — it is the style-reference page's own chrome, not a
  shared library. `wireframe.css` is self-contained on top of `tokens.css`.
- **Semantic color tokens only** (`--color-bg-*`, `--color-text-*`, `--color-border-*`,
  `--color-accent-*`, status `-text`/`-bg-subtle` pairs, `--color-focus-ring`) — never
  raw `--color-ink-500`-style primitives, so dark mode works for free. Type, spacing,
  radius, and shadow tokens have no semantic layer; use them directly.

### 5.3 `wireframe.css` rules

- Every color, font, size, spacing, radius, and shadow value is a `var(--...)` reference.
  **No literal hex/rgb/hsl colors, no literal px/rem/em dimensions**, with exactly two
  exceptions: (a) purely structural layout values (`flex`, `grid` templates, `%`,
  `auto`, `min()`/`max()` compositions of tokens), and (b) `@media` conditions, where
  `var()` is invalid by spec — hardcode the px matching the breakpoint token **with a
  comment naming the token** (`/* --breakpoint-md */`), the exact convention
  `tokens.css` documents in its breakpoints block.
- **Mobile-first**: base styles target narrow viewports; wider layouts arrive via
  `@media (min-width: ...)`. Every page must render sensibly at **375px with no
  horizontal scroll** before it renders at desktop widths (design plan §5.4, lesson of
  AS-23).
- A minimal `@media print` block for screen 7: hide app chrome and state-section labels,
  show the document region cleanly. Placeholder marking and attribution line remain
  visible in print (§3).
- Low-fidelity means low-fidelity: boxes, labels, real copy where copy is load-bearing
  (button verbs, the Stripe-sends-the-email explanation, the placeholder warning), no
  decorative polish. Nobody should mistake these for visual design.

### 5.4 Semantic HTML + accessibility floor (design plan §5.3)

`lang` attribute; one `<h1>` per page; landmark elements (`<header>`, `<nav>`,
`<main>`); every form control has an associated `<label>`; buttons are `<button>`,
links are `<a>`; tables of invoices/contracts are real `<table>` with `<th>` — the
markup is the spec AS-45–48 will translate template-by-template. Contrast is already
guaranteed by using the semantic token pairs as the style reference pairs them; do not
invent new foreground/background combinations.

### 5.5 Zero external anything

No `<script>` tags, no external URLs in `href`/`src`/`link` (Stripe-hosted links appear
as `href="#"` with visible labels), no images, no fonts beyond the token font stacks,
no licensed assets (design plan §5.5). The pages must render fully offline.

## 6. Sequencing, time-box, and git

1. **Single implementation stage** — I considered splitting spec (flows/inventory/ledger)
   from wireframes into two reviewed stages and rejected it: QA needs the ledger to
   verify the wireframes anyway, so a mid-point review would re-read everything twice
   for one task's worth of surface. Decision: one stage, one cold QA review at the end.
2. **Two logical commits, in order**, so a tick boundary mid-task leaves a resumable
   state: commit 1 = `00-flows.md` + `01-screens.md` + `02-states-ledger.md` (the
   written spec — Jonah's own written-before-drawn method); commit 2 (or more) = the
   HTML + CSS. If your tick ends after commit 1, the next tick resumes at the drawings
   with the spec already fixed.
3. **Time-box: 2 implementation ticks** (design plan §4 B1). If the work is not at
   `review` by the end of your second tick, leave a one-line status comment on AS-30 and
   stop — the orchestrator decides; no silent extension. Nothing idles on you (AS-45–48
   are the only dependents and their server-side prerequisites run concurrently), so an
   incomplete screen is worse than a late one — do not thin the ledger to make the box.
4. **Implementation commits touch only `docs/design/wireframes/**`** — never `.lattice/`
   (board state lives on master; run any `lattice` command from the main checkout
   `/Users/forrest/Code/american-software-company`, never from inside the worktree),
   never tokens/style-reference/BRANDING.md, never app code, never top-level markdown.
   Commit under your persona identity
   (`user.name="ux-jonah"`, `user.email="ux-jonah@agents.american-software.local"`),
   messages `AS-30: <imperative summary>`.

## 7. Acceptance criteria — what Priya verifies, each independently checkable

1. **Files**: exactly the §5.1 set exists under `docs/design/wireframes/`; the branch
   diff (`git diff master...feat/AS-30-core-loop-ux`) touches nothing outside
   `docs/design/wireframes/`.
2. **Flows**: `00-flows.md` contains numbered flows covering the full v1 loop ending at
   "freelancer sees it paid"; each flow step names the screen (1–7) it happens on;
   unhappy paths are present as numbered branches (at minimum: Stripe onboarding
   abandonment/refresh, Stripe-account-not-ready gating, validation failure on each
   form, signed-out access to a guarded screen). "Reminder", "password reset",
   "email verification" appear **only** in exclusion notes, never as flow steps.
3. **Inventory**: `01-screens.md` lists exactly 7 screens matching milestone plan §4.3
   (numbers, names, capability rows); routes are labeled *provisional*; a shared-chrome
   section exists; no 8th screen or screen-shaped modal anywhere.
4. **Ledger ↔ wireframe 1:1**: every ledger row in `02-states-ledger.md` has a stable ID
   and every ID appears as a section `id` in the matching `screen-N-*.html`, and every
   state section in every wireframe has a matching ledger row — both directions, no
   orphans. Every screen has all six categories present (with explicit "n/a — because"
   rows where inapplicable). Screen 2's ledger includes return, refresh, and not-ready
   states; screens 1, 4, 6 include validation-error states showing **re-rendered
   submitted values**; screens 4 and 6 include the inline-client-creation sub-pattern
   states.
5. **Token traceability**: `wireframe.css` and all inline styles contain zero literal
   colors (`#`, `rgb(`, `hsl(`) and zero literal dimensions outside §5.3's two allowed
   exceptions; every `@media` px value carries its token-naming comment; only semantic
   color tokens are consumed (grep for `--color-ink-` and ramp names in the wireframe
   files finds nothing).
6. **Token plumbing**: every HTML page links `../tokens/tokens.css` relatively;
   `git diff` shows `docs/design/tokens/` and `docs/design/style-reference/` untouched;
   no copy of tokens.css exists under `wireframes/`.
7. **Accessibility/semantics**: each page has `lang`, exactly one `<h1>`,
   `<header>/<nav>/<main>` landmarks as applicable, and no unlabeled form control
   (mechanical check: every `<input>`/`<select>`/`<textarea>` id is referenced by a
   `<label for>`).
8. **375px**: opened at 375px viewport width, every page renders with no horizontal
   scroll; base CSS is mobile-first with `min-width` media queries only.
9. **Offline/zero-asset**: no `<script>` tags; no `http`/`https` URLs in any `href`,
   `src`, or `url()`; no image or font files added.
10. **Legal gate**: screens 6 and 7 carry the warning-toned placeholder-body marking;
    screen 7's document region contains the CC BY 4.0 attribution line; both remain
    visible under the print stylesheet (verify by print preview or by reading the
    `@media print` rules — nothing hides either element).
11. **Decided-surface fidelity**: screen 5 shows `hosted_invoice_url` and `invoice_pdf`
    as labeled placeholder links; screen 4's send action copy states that Stripe emails
    the client; screen 1 offers no reset/verification affordance; no reminders,
    clients, or settings UI exists anywhere.
12. **Handoff contract (design plan §5)**: Priya's judgment call, informed by 1–11 —
    could a developer implement each screen from these files without asking a design
    question? Any question she finds herself needing to ask is a finding.

## 8. Open questions Jonah may hit, each with an owner and a default

| # | Question | Default (act on this unless overridden) | If the default fails |
|---|---|---|---|
| 1 | Provisional route paths — what to write in `01-screens.md`? | Propose sensible paths, label the column "provisional — final routes owned by AS-40..48". | — |
| 2 | The states ledger honestly cannot fit in 7 screens? | It fits — the definition of "screen" puts modals/drawers/states inside the ledger, which is where depth belongs. | Do **not** add a screen or thin the ledger. `lattice comment` on AS-30 addressed to `agent:cto-owen` naming the state that cannot live as a state and why; keep working the other screens. Spending headroom is my amendment-log entry, never a design call. |
| 3 | A needed token does not exist (e.g., a wireframe-only annotation color)? | Compose from existing semantic tokens; wireframe chrome may use muted text + hairline border tokens for its labels. | Comment to `agent:cto-owen`; never edit `tokens.css` (§5.2). |
| 4 | How much real copy? | Load-bearing copy is real (button verbs, Stripe-email explanation, warning text, empty-state guidance); filler content is obviously-fake placeholder data (names like "Ada Example", amounts, dates). | — |
| 5 | Dark mode sections in wireframes? | No — semantic tokens make dark mode automatic; do not duplicate states per theme. The style reference already proves the pairs. | — |

Anything else genuinely open: default to the narrower reading, note it in the relevant
markdown file under an "Assumptions" heading, and keep moving — the note is what makes
the assumption reviewable.
