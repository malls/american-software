# Finalist Selection (Step 2 → 2b): Composite Matrix & Proposed Finalists

**Status:** PROPOSAL — CTO-signed, **awaiting CEO co-sign. Finalists are not final
until both signatures exist.** Per rubric §4 this is a joint cofounder act; one
signature is half an act.
**Mechanics:** as proposed by the CEO in #bizdev msg 256 and accepted by the CTO in
msg 257 — cross-verification of the other's signed file, unweighted sums per the
signed equal-weights rule (rubric §3: no reweighting after scores exist), ≤3 finalist
cap (rubric §4), lawyer-trigger overlay (rubric §3, Criterion C5), labeled-gap
overlay (rubric §4: "gaps are recorded as gaps, not guessed" — gaps never round up),
near-tie deadlock to the board as a framed either/or.
**Inputs:** docs/strategy/04-scores-cto.md (18 CTO scores, signed) and
docs/strategy/04-scores-ceo.md (27 CEO scores, signed). Nothing else. Evidence and
gate context live in those files and their citations.
**Naming note (standing):** "Candidate C1–C4" are competitive-lane businesses;
"Criterion C1–C5" are rubric criteria. Table columns below are criteria.

---

## 1. Cross-verification record (mechanics step 1)

Per the agreed mechanics, each cofounder transcribes the **other's** signed file
into the composite and recomputes independently.

- **CTO verification of the CEO's 27 scores (this document):** I read
  04-scores-ceo.md in full — Part I summary table, Part II summary table, and every
  per-candidate rationale header — and transcribed the 27 CEO cells below directly
  from the signed file. I then recomputed all nine unweighted sums from scratch.
  **Verdict: all nine sums posted in #bizdev msg 256 are CONFIRMED. No corrections.**
  One consistency note for the record: msg 255's gist (Candidate D1, Criterion
  C1 = 4) conflicts with the signed file (= 3); the signed file and msg 256's
  correction govern, and the table below carries the 3. This is exactly the
  "mismatches resolve against the signed files" rule working as intended.
- **CEO verification of the CTO's 18 scores:** pending — Carla transcribes
  04-scores-cto.md and recomputes before co-signing. Her co-signature below
  attests that verification the way this section attests mine.

## 2. Composite table (45 cells, attributed; unweighted sums)

Attribution: Criterion C1 (revenue path), C4 (time to first dollar), C5 (legal
surface) — CEO-signed, transcribed from 04-scores-ceo.md by the CTO. Criterion C2
(cost to build v1), C3 (cost to operate forever) — CTO-signed, from
04-scores-cto.md. Equal weights per rubric §3; the sum is the composite.

| Candidate | C1 (CEO) | C2 (CTO) | C3 (CTO) | C4 (CEO) | C5 (CEO) | Sum | C5 lawyer trigger |
|---|---|---|---|---|---|---|---|
| **D1 Freelancer invoicing/contracts** | 3 | 4 | 4 | 4 | 4 | **19** | No |
| **C2 Code quality gates (small dev teams)** | 4 | 4 | 3 | 4 | 3 | **18** | No |
| **D4 Event RSVP/no-show** | 3 | 4 | 4 | 4 | 3 | **18** | No |
| C1 Micro-credentials | 3 | 3 | 3 | 2 | 4 | 15 | No |
| D3 Musician royalty aggregation | 2 | 3 | 3 | 3 | 3 | 14 | No |
| D2 Solo-therapist HIPAA practice mgmt | 4 | 2 | 2 | 2 | 2 | 12 | **YES** |
| C3 Construction permit data | 2 | 2 | 2 | 2 | 3 | 11 | No |
| C4 Compliance automation | 2 | 2 | 2 | 2 | 2 | 10 | **YES** |
| D5 Research secure data collab | 2 | 2 | 2 | 1 | 1 | 8 | **YES** |

Ordering above is by composite sum, which is now — and only now, with all 45 cells
signed — a permitted computation (rubric §1.4 sequencing; both scoring files
correctly refused to rank on partial criteria).

## 3. Presumptive pool at the cap (mechanics step 3)

**Proposed finalists (≤3 per rubric §4): Candidate D1 (19), Candidate C2 (18),
Candidate D4 (18).**

Tie and cut analysis:
- The 18–18 tie (Candidates C2 and D4) is **within** the pool — both fit under the
  cap, so no tiebreak is needed and no deadlock mechanics engage.
- The cut falls between D4 (18) and Candidate C1 (15): a 3-point gap on a scale
  where every scored divergence in this cycle has been ≤1 point. **No near-tie at
  the cut; the board either/or provision is not invoked.**

## 4. Overlay A — lawyer triggers (rubric §3, Criterion C5)

The three triggered candidates — C4 (C5=2), D2 (C5=2), D5 (C5=1) — **all sit
outside the proposed pool** (12th, 6th, and 9th positions: sums 10, 12, 8). None of
the three proposed finalists carries a trigger: D1 C5=4, C2 C5=3, D4 C5=3, each
above the review line.

**Consequence: no lawyer-agent hire is required for this finalist cycle.** The
trigger obligation is conditional on a triggered candidate being *proposed as a
finalist*, and none is. If the CEO's verification of my 18 scores changes the pool
such that a triggered candidate enters it, the lawyer review becomes a blocking
precondition for that candidate's slot before spikes may treat it as a finalist.

## 5. Overlay B — labeled-gap dispositions (gaps never round up)

The two gaps the mechanics named:

- **Candidate C1's WTP gap** ($5–15/user/mo tier untested): C1 sits 4th at 15, below
  the cut. Disposition required only if the pool changes; recorded here so it is
  never lost — any future C1 finalist slot requires primary WTP validation at the
  target tier before a debate argument may lean on Criterion C1.
- **Candidate D5's small-team-spend gap:** D5 is 9th at 8. Same conditional
  disposition; additionally D5 carries a lawyer trigger, so a pool entry would
  engage both overlays.

Gap dispositions for the **proposed pool members** — each pool candidate carries at
least one labeled evidence gap that its own scores already priced downward; the
disposition states what must happen so no debate argument quietly rounds it up:

1. **Candidate C2 — small-team current spend unknown** (00-longlist.md §C2; priced
   into CEO Criterion C1=4, explicitly held off 5). Disposition: the gap survives
   into the step-3 debate *as a gap*. The spike validates build/operate cost (C2/C3
   criteria), not demand; no position paper may claim the 2–5 dev bottom of the
   segment pays until primary evidence exists. If demand-side validation is wanted
   before the debate, it runs as CEO-side work in parallel with the spike — the
   spike tick is not consumed by it.
2. **Candidate D1 — displacement, not gap-filling** (the $15–30/mo band is occupied:
   Plutio $19, Bonsai $25; CEO Criterion C1=3 priced this). Plus partially indirect
   Tier-1 spend evidence (platform commissions vs. software spend). Disposition:
   the board network's 3–5 warm freelancer intros (demand-lanes.md §D1) are the
   validation channel — CEO-side, parallel to the spike; the debate may not treat
   the crowded band as empty, and D1's composite lead does not exempt it.
3. **Candidate D4 — integrated-product WTP untested + the two-product fork**
   (00-longlist.md §D4; competitive-lanes.md Tick-2 Anomaly #4; CEO Criterion C1=3
   priced both). Disposition: the spike builds the RSVP+reminders half only and
   tests whether vendor/budget features are required for credibility (spike item 3
   in 04-scores-cto.md §D4); which half the buyer pays for is a demand question
   resolved jointly with CEO-side evidence before the debate may assume an
   integrated product.

## 6. Spike plan (rubric §1.4, §4 box 2b — engages only on co-sign)

One tick per finalist, $0 budget, throwaway code, no Lattice product tasks; the
spike box ends regardless of state and a findings memo is written from whatever was
learned. Purpose: replace my C2/C3 *estimates* with *measurements* before the
step-3 debate may cite them as validated.

Each finalist's spike-must-test list is already signed in 04-scores-cto.md and is
incorporated here by reference:

| Finalist | Spike-must-test list | Headline measurements |
|---|---|---|
| D1 | 04-scores-cto.md §D1 (3 items) | Constraint-7 connected-account rails end-to-end on a processor sandbox; template provenance & cost; reminder deliverability |
| C2 | 04-scores-cto.md §C2 (4 items) | OSS license vet in writing (my carried co-sign item); scan compute cost per repo-day vs. <$100/repo/mo; out-of-box false-positive rate; $0 integration-layer feasibility |
| D4 | 04-scores-cto.md §D4 (3 items) | SMS sender-registration timeline/cost + per-event message cost vs. $30–100/mo; measurable no-show-delta design; two-product fork test (RSVP+reminders only) |

Proposed (non-binding) sequencing: C2 first — its license vet is my carried
co-sign item and the cheapest kill-test in the set — then D1, then D4. Order is
execution detail; Carla may reorder without amendment.

No spike starts before the CEO co-sign below exists. Spikes produce measurements
and findings memos, not decisions; selection of the *one* business remains with the
step-3 written debate (05-position-ceo.md / 05-position-cto.md) and the step-4
one-page decision memo to the board.

## 7. Signatures

A signature below means: "I independently transcribed and recomputed the other
cofounder's signed scores into the composite table above and found it correct as
printed; I agree the proposed finalist pool {D1, C2, D4} follows mechanically from
the signed matrix under the agreed mechanics; I agree no lawyer trigger attaches to
this pool and that the labeled-gap dispositions above bind the step-3 debate; and I
understand finalist status is conferred by the second signature, not the first."

- **Owen Kessler, CTO** — SIGNED, 2026-08-31. Verified the CEO's 27 scores against
  04-scores-ceo.md; all nine composite sums confirmed as posted in #bizdev msg 256.
- **Carla Voss, CEO** — *pending: verification of the CTO's 18 scores against
  04-scores-cto.md, then co-sign.*
