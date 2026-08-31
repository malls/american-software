# Front-End Design Phase — Plan

**Author:** Owen Kessler, CTO. **Date:** 2026-08-31.
**Trigger:** board, #board msg 283 ("Let's start designing the front end. Owen,
can we spec out a plan? Maybe hire a designer and UX person? Let's make some
artifacts for what it should look like after a designer sets up a BRANDING.md").
**Status of this doc:** the plan the board asked for. It commits process and
sequencing only — no product, no framework, no spend.

## 1. Interpretation, stated plainly

"The front end" can only reasonably mean the front end of the product the
company is on the verge of choosing: the step-4 decision memo
(`docs/strategy/07-decision-memo.md`) recommends D1 (freelancer
invoicing/contract automation), and msg 283 arrived after it. I am treating
msg 283 as direction to **start the design phase now**, not as the board's
step-5 answer — the memo's §4 asks (warm intros for demand validation, launch
approvals) remain open, and the recommendation's named falsifier still stands.

So the plan is phased to make the ambiguity harmless: **Phase A is
product-agnostic and proceeds immediately; Phase B is product-specific and
opens only on the explicit step-5 green-light.** If step 5 withdraws D1,
Phase A's output is fully reusable and Phase B has consumed zero effort.

## 2. Assumptions (each falsifiable; challenge in #board)

- A brand for **the company** can and should exist before the product decision
  is final. Identity, voice, palette, and typography attach to The American
  Software Company, not to any candidate product.
- Design artifacts in this company are **repo artifacts**: markdown, design
  tokens, and static HTML. No Figma, no image-only mockups — our implementers
  are agents that read text. This also keeps spend at zero.
- Visual identity (what it looks like) and UX architecture (how it flows) are
  different jobs done by different specialists; conflating them is how v1
  design phases stall.

## 3. Roles

| Who | Role | Owns |
|---|---|---|
| `agent:designer-sofia` (Sofia Andrade, Brand & Visual Designer, new hire) | Phase A | `BRANDING.md`, design tokens, style reference (AS-29) |
| `agent:ux-jonah` (Jonah Reyes, UX Designer, new hire) | Phase B | Core-loop flows, states ledger, static wireframes (AS-30) |
| `agent:cto-owen` | Plan owner | Sequencing, gates, engineering handoff contract |
| `agent:ceo-carla` | Brand direction | Commercial voice/positioning input to BRANDING.md; Sofia reports to her |
| `agent:qa-priya` | Review gate | Independent review of AS-29/AS-30 per normal lifecycle |

Reporting rationale: brand identity is commercial direction → Sofia under the
CEO (provisional, pending Carla's ack). UX flows are the spec engineering
builds from → Jonah under the CTO.

## 4. Phases and deliverables

### Phase A — brand foundation (ungated; starts next tick)

**A1. `BRANDING.md`** — repo root, authored by Sofia. Company-level brand
foundation: identity and voice, palette with token names and contrast ratios,
typography (open-license only, license lines included), logo direction,
spacing/layout principles, and an explicit refusals section ("the brand never
does this"). Non-Lattice (brand doc, per CLAUDE.md scope); committed to master
under her persona identity; CEO and CTO both read it before it is considered
adopted. *Time-box: 2 ticks from Sofia's first working tick. Default on
expiry: ship with gaps labeled.*

**A2. Design tokens + static style reference** — Lattice **AS-29**, gated on
A1. Framework-neutral `tokens.css` (CSS custom properties) + `tokens.json`,
plus a static HTML page under `docs/design/style-reference/` rendering every
token: colors on their intended backgrounds, the type scale, spacing,
components-as-primitives (button, input, table, card) in default/hover/
disabled/error states. This file pair is the **single source of visual truth**
for everything the company ships thereafter — including retrofitting internal
tools if we choose. *Time-box: 1 tick.*

### Phase B — product UX (GATED on the board's explicit step-5 green-light)

**B1. Core-loop UX package** — Lattice **AS-30**, authored by Jonah, held at
`needs_human` until the gate opens. For the green-lit product: numbered user
flows for the core loop, a screen inventory under a hard screen budget agreed
with the CTO at kickoff, a complete states ledger per screen (loading, empty,
error, permission-denied, abandonment), and low-fidelity static HTML
wireframes under `docs/design/wireframes/` consuming Sofia's tokens. If D1 is
confirmed, the core loop is: onboard → connect payments → contract → invoice →
get paid → reminders. *Time-box: 2 ticks after the gate opens (A2 must be
done first).*

**These are the "artifacts for what it should look like":** the style
reference (A2) shows the look; the wireframes (B1) show the product wearing
it. Both render in a browser from the repo with no build step.

### Phase C — implementation (out of scope here)

Front-end implementation, and the **framework/stack decision that precedes
it**, are deliberately not in this plan. Stack choice binds the company
technically and will be its own written decision (options, criteria, a
recommendation) after Phase B exists — deciding a stack before the flows and
the product are fixed is deciding in the wrong order.

## 5. Engineering handoff contract (what "design done" means to me)

Phase A+B output is accepted when a developer-agent can build the front end
without asking a design question:

1. Every visual property traces to a named token; no magic values in
   wireframes.
2. Every screen in the inventory has its full states ledger.
3. Accessibility floor: WCAG 2.1 AA contrast ratios recorded in BRANDING.md
   for every foreground/background pair; wireframes are semantic HTML.
4. Mobile-first: wireframes render sensibly at 375px before they render at
   desktop widths (lesson of AS-23).
5. Zero licensed assets, or a board-approved license on file first.

## 6. Spend

None planned. Phase A/B use open-license typefaces and hand-rolled artifacts.
If Sofia concludes the brand needs a licensed typeface or asset, that goes to
the board as a written ask (cost, alternatives, rationale) before any
purchase — ALL spend is board-gated, no threshold.

## 7. Open questions (time-boxed, with defaults)

| # | Question | Owner | Box | Default if expired |
|---|---|---|---|---|
| 1 | Does Carla ack Sofia reporting to her (brand = commercial)? | Carla | 2 ticks | Stands as filed |
| 2 | Does the board want naming (company trade name / product name) inside BRANDING.md scope, or is naming a separate board-level exercise? | Forrest | step-5 reply | Sofia designs around "The American Software Company"; product naming deferred |
| 3 | Product-name lockup and logo depend partly on Q2 | Sofia | with A1 box | Wordmark direction only in v1 |
