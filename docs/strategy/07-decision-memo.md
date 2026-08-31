# Decision Memo to the Board — What Business We Should Build (Step 4 of 5)

**From:** Carla Voss, CEO. **Co-sign:** Owen Kessler, CTO (§7).
**To:** Forrest, board. **Date:** 2026-08-31. **Length:** one page, per rubric §4.
**This memo recommends; it does not commit.** Commitment happens at step 5, at
your green light, per the process you approved in #board msg 117.

## 1. How we got here (full record: docs/strategy/01–06)

1. **9 candidates** were derived niche-first, gate-checked, and scored — 45
   signed cells, split-domain (CEO: revenue/time-to-dollar/legal; CTO:
   build/operate), every score with a written rationale.
2. **3 finalists** {D1 freelancer invoicing, C2 code gates, D4 event RSVP} each
   got a one-tick, $0 feasibility spike; all 18 CTO estimates survived
   measurement unchanged — the spikes converted caveats into named findings.
3. **1 recommendation** from two independently written debate papers
   (06-debate-ceo.md, 06-debate-cto.md) that converged without coordination.

Composite: **D1 19/25 — the only candidate above 18 (C2 and D4 sit at 18), and
the only one with no criterion below 3** (matrix: 05-finalists.md §2).

## 2. Joint recommendation: Candidate D1 — freelancer invoicing/contract automation

1. **Its deepest risk is retired, by measurement.** The one design-level
   kill-risk — constraint 7, never in the flow of funds — is solved and
   spec-validated end-to-end (Stripe Connect direct charges on the freelancer's
   own account; eight primitives verified; the forbidden shape is lintable).
   Client money never touches us (spike-D1 §1).
2. **Fewest gates to the first dollar, and the heavy lifting is contractually
   Stripe's, not aspirationally ours.** KYC onboarding, hosted payment page,
   invoice PDF, and the reminder-email loop ship on Stripe's infrastructure at
   $0; the only launch gate is one free board-gated signup; subscription
   pricing is the segment's proven model — no constraint interpretation needed
   (spike-D1 §3; 04-scores-ceo.md §D1 C4/C1).
3. **Smallest blast radius and the best operate-forever fit for an agent
   workforce.** Our worst day is a missed webhook, not C2's leaked key to every
   customer's source or D4's TCPA exposure; the standing work is text-shaped —
   templates, support, comparison content — where agent marginal cost is near
   zero (06-debate-cto §3; 06-debate-ceo §2.6).

## 3. Risk — the shared steelman, at full strength

The $15–30/mo band is **occupied** (Plutio $19, Bonsai $25): this is
displacement, not gap-filling, and the co-signed disposition forbids pretending
otherwise. D1's measured ease is **symmetric** — everything hard belongs to
Stripe, so v1 is reproducible from public docs by anyone, including Stripe,
whose own Invoicing product is live and monetized; differentiation must come
from trust, polish, and distribution, none of which is measured. The composite
lead is one point wide and stands on execution criteria; **demand-side
validation is still outstanding**, and both papers made it a condition, not a
footnote. Named falsifier, agreed in advance: if validation says the band's
occupants already serve these buyers well, this recommendation is withdrawn.

## 4. Conditions and questions for the board

1. **Warm intros — this is your action.** Both positions are conditioned on
   validating demand through the board network's 3–5 warm freelancer intros
   (the co-signed validation channel, 05-finalists.md §5.2). We ask you to make
   those introductions so we can run structured interviews — current tool,
   price, what breaks at contract-to-invoice, what would trigger a switch —
   and record the result either way before commitment hardens.
2. **Revenue-rail interpretation.** Is a Stripe *application fee* — deducted by
   Stripe, never custodied by us — clean under constraint 7, or is
   subscription-only the required reading? **Default until you answer:
   subscription-only** (strictest-clean; the recommendation does not depend on
   the answer).
3. **Incorporation — a coming decision, not this memo's ask.** The spikes made
   it a forcing function (EIN gates A2P SMS; live-mode processor verification
   and our own subscription collection eventually need an entity). It should
   run as a company milestone with its own lawyer-agent process, decoupled
   from this selection. For the record: every processor/ESP/carrier signup
   stays board-gated per the 2026-08-31 amendment, price irrelevant — if D1 is
   green-lit, the first approval request will be the free Stripe test-mode
   account.

## 5. Fallback ordering (both papers, independently): C2, then D4

**Flip to C2** if condition 4.1 returns adverse — then C2 requires, before
commitment: primary demand evidence from the 2–5-dev segment (its binding gap)
and a measured curation-quality wedge over incumbents' free tiers. **D4 rises**
only if C2's demand gap also closes negative while D4's fork resolves to paying
organizers and email-only credibly captures the no-show delta (or incorporation
lands early enough to unblock SMS in the launch window).

## 6. Dissent

**None — convergent.** Written independently, exchanged after filing: both
papers chose D1 with the same condition, steelmanned the same case against it
(§3 above), and named the same fallback ordering. The convergence is recorded
as fact, not manufactured agreement — the papers argue from the same signed,
measured record, and each names in advance the evidence that would flip it.

## 7. Signatures

Signing means: "This is the cofounders' joint recommendation and honest risk
statement; the decision belongs to the board at step 5."

- **Carla Voss, CEO** — SIGNED, 2026-08-31.
- **Owen Kessler, CTO** — SIGNED, 2026-08-31. Verified cold against both
  position papers: the recommendation, risk statement, board asks, fallback
  ordering, and dissent line are faithful to the filed record.
