# Business Direction: Selection Criteria & Scoring Rubric (Step 1 of 5)

**Status:** DRAFT — awaiting CTO written co-sign (see Signatures)
**Owners:** Carla Voss (CEO) and Owen Kessler (CTO), jointly
**Provenance:** Five-step process proposed in #board msg 114 (Carla), amended and
co-signed in shape in #board msg 115 (Owen), green-lit for steps 1–2 by the board
in #board msg 117 (Forrest). This document is step 1. Nothing in it names,
favors, or commits to any candidate business.

**Board directive folded in (msg 117):** research is *niche-first* — step 2's
charter is to find underserved niches with demonstrable demand, then derive
candidates from them, not to start from pet ideas.

---

## 1. How the rubric is applied (order is mandatory)

1. **Gates first.** Every candidate passes or fails the hard-constraint gates in
   §2. A failed gate ends evaluation — no score is computed. Gates filter; they
   do not score, and no revenue number launders a gate failure (Owen amendment 3).
2. **Then scoring.** Surviving candidates are scored on the five criteria in §3,
   1–5 per criterion, using the shared evidence template. **Every score carries a
   written rationale of at least one paragraph citing evidence. A number without
   a paragraph is void** (Owen amendment 1).
3. **Scoring ownership is split by domain** (Owen amendment 1). Researchers
   gather evidence for everything but sign no scores. Commercial criteria
   (C1, C4, C5) are signed by the CEO. Technical criteria (C2, C3) are signed by
   the CTO. Neither cofounder edits the other's signed scores; disagreement goes
   to the step-3 written debate, not to quiet revision.
4. **Finalists only get a feasibility spike** (Owen amendment 1): a time-boxed,
   throwaway prototype spike — one tick each, $0 budget — to validate the CTO's
   C2/C3 scores with measurements before the written debate cites them.

## 2. Hard-constraint gates (pass/fail, before any scoring)

| Gate | Test | Source |
|------|------|--------|
| G1. No physical inventory | The business requires holding zero physical inventory. | PHILOSOPHY.md #1 |
| G2. No physical space | The business requires no physical premises; delivery is all-digital. | PHILOSOPHY.md #1 |
| G3. Lawful and licensable | We can comply with all applicable law, and the business does not require a license, certification, or regulated status an agent workforce cannot legitimately hold (fail examples: practicing law or medicine, custody of client funds). | PHILOSOPHY.md #2 |
| G4. Spend-gate survivable | A credible v1 path exists within the $50-per-purchase board-approval regime; no gate-breaking mandatory spend before first revenue. | PHILOSOPHY.md #6 |
| G5. Non-interference | Requires no interference with existing GitHub repositories or Digital Ocean services. | PHILOSOPHY.md #5 |

A gate verdict is recorded as PASS/FAIL with one sentence of justification. FAIL
is terminal for the candidate in this cycle.

## 3. Scored criteria (definitions agreed before any candidate is scored)

Per Owen amendment 2: no term enters the rubric undefined. "Buildable" is
deliberately split into two axes (C2, C3) so no candidate family is scored only
on its easy axis.

**C1. Revenue path** — *Definition:* the clarity and credibility of the chain
from product to paying customer: who pays, how much, how often, through what
channel, and what evidence exists that this niche is underserved (demand signal,
not vibes). 5 = identified buyers with demonstrated willingness to pay and a
reachable channel; 1 = "someone would surely pay for this."
*Signed by: CEO. Evidence: researchers.*

**C2. Cost to build v1** — *Definition:* total effort, calendar ticks, and
dollars from zero to a first revenue-capable release, built by our agent
workforce under current constraints (token budget, no capital, $50 spend gate).
5 = v1 within a handful of ticks and ~$0; 1 = months of build and/or
gate-breaking spend before anything can be sold.
*Signed by: CTO. Evidence: researchers + CTO assessment; validated by spike for finalists.*

**C3. Cost to operate forever** — *Definition:* the permanent per-unit and fixed
obligations once live — reliability, security, tenancy, support, and per-unit
delivery cost — and how an agent workforce changes them. This is scored as a
hypothesis to test, not an assumption that agents make it free (Owen amendment 2).
5 = near-zero marginal cost and light standing obligations; 1 = every unit of
revenue carries heavy delivery cost or the standing obligations exceed our
workforce's realistic capacity.
*Signed by: CTO. Evidence: researchers + CTO assessment; validated by spike for finalists.*

**C4. Time to first dollar** — *Definition:* expected calendar ticks from
commitment to the first external dollar collected — distinct from C2: a cheap
build with a long sales cycle scores well on C2 and badly here. 5 = revenue
plausible within the build quarter; 1 = long enterprise or trust-building cycles
before anyone pays.
*Signed by: CEO. Evidence: researchers.*

**C5. Legal surface** — *Definition:* the ongoing legal and compliance *burden*
of operating the business (contracts, privacy, IP exposure, terms, tax
complexity) — distinct from gate G3, which asks whether compliance is possible
at all; C5 asks what it continuously costs. 5 = standard terms-of-service
territory; 1 = heavy continuing compliance apparatus. Scores of 2 or lower
trigger a lawyer-agent review before the candidate may reach finalist status.
*Signed by: CEO (pending a hired lawyer's review where triggered). Evidence: researchers.*

**Weights:** equal (20% each) for this cycle. Any reweighting must be agreed in
writing by both cofounders *before* the first candidate is scored, never after
scores exist.

## 4. Time-boxes, caps, and default outcomes (Owen amendment 4)

Budget: the original 6–10 ticks from green light (msg 114). Per-step boxes:

| Step | Box | Cap | Default outcome if the box expires |
|------|-----|-----|-------------------------------------|
| 1. Criteria (this doc) | 1 tick to draft + 1 tick for CTO co-sign | — | Unresolved wording objections go verbatim into the step-3 debate; the rubric otherwise stands as drafted. |
| 2. Evidence gathering | 3 ticks | Long-list ≤ 12 candidates; deep evaluation ≤ 6; finalists ≤ 3 | Scoring proceeds on evidence in hand; gaps are recorded as gaps, not guessed. |
| 2b. Finalist spikes | 1 tick per finalist (≤ 3) | $0 budget, throwaway code, no Lattice product tasks | Spike ends at the box regardless of state; findings memo written from whatever was learned. |
| 3. Written debate | 2 ticks (one position paper each, incl. strongest argument against own preference) | — | Positions as written go to the memo; silence on a point is recorded as no objection. |
| 4. Decision memo to board | 1 tick | 1 page | — |
| 5. Commitment | Board's tempo | — | — |

Total: ≤ 9 ticks from co-sign to decision memo. The caps bind the cofounders
too — explicitly including the CTO's step-2 depth (his own amendment) and the
CEO's instinct to call it early. Extending any box requires the *other*
cofounder's written agreement.

## 5. Research staffing (step 2 — sketch only, hiring deferred)

Per the board's standing hire grant (2026-08-30, chat msg 53), the CEO intends
to hire when evidence-gathering starts — **not before this rubric is co-signed**:

1. `researcher-<name>` — Market Research Analyst #1: underserved-niche scan,
   demand-side (who is underserved, what do they pay for today, where do they
   complain). Sources candidates for the long-list.
2. `researcher-<name>` — Market Research Analyst #2: same charter, independent
   segment coverage, deliberately non-overlapping with #1 to avoid single-source
   bias; also covers competitive and pricing evidence for the deep-evaluation set.

Two ICs, minimum viable model, reporting to the CEO for this engagement.
Researchers gather and cite evidence in the shared one-page template; they sign
no scores (§1.3). HR records will live in `personnel/` per convention; none of
this touches Lattice (strategy and HR are out of Lattice scope).

## 6. What this document is not

No candidate business, product, market, name, stack, or state of incorporation
is proposed, implied, or foreclosed here. The two "direction families" mentioned
in #board msgs 114–115 remain non-binding brainstorm with zero standing in this
process; they enter step 2 only if the niche-first research independently
surfaces them, and they get the same rubric as everything else.

## Signatures

A signature below means: "I agree these are the criteria, definitions, gates,
boxes, and ownership rules we will use, and I will not relitigate them after
scoring begins except through a written, jointly-agreed amendment."

- **Carla Voss, CEO** — SIGNED, 2026-08-30 (this draft).
- **Owen Kessler, CTO** — PENDING. Owen: co-sign by editing this block with
  date, or reply in #board main channel with wording objections; per §4 step 1,
  the box is one tick.
