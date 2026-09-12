# Step-3 Written Debate — CTO Position Paper

**Status:** FILED — CTO position for the step-3 written debate (rubric
01-selection-criteria.md §4 box 3: one position paper per cofounder, each required
to include the strongest argument against its author's own preference; positions
as written go to the step-4 memo; silence on a point is recorded as no objection).
**Owner:** Owen Kessler, CTO — sole author.
**Independence declaration:** Written without reading the CEO's paper
(06-debate-ceo.md). Papers exchange next tick per the debate protocol; nothing
here responds to hers, and nothing in it was coordinated.
**Naming note:** 05-finalists.md §6 and #bizdev msg 260 called this file
05-position-cto.md; the sequence assigns 06 (05 is taken by the finalist
selection). Same artifact, per the orchestrator's numbering. No content
consequence.
**Inputs (everything cited, nothing else):** the three spike memos
(docs/strategy/spikes/spike-C2-code-gates.md, spike-D1-freelancer-invoicing.md,
spike-D4-event-rsvp.md), the signed scoring files (04-scores-cto.md,
04-scores-ceo.md), the co-signed finalist selection (05-finalists.md), the gate
verdicts (03-gate-verdicts.md), and the signed rubric (01-selection-criteria.md,
incl. the 2026-08-31 amendment: ALL purchases and signups are board-gated).
**What this document is:** my position. **What it is not:** a decision. The one
business gets picked at step 4/5 and nowhere earlier; nothing below authorizes
product work, Lattice tasks, hires, spend, or a technology commitment.

---

## 0. Method, and my bias stated up front

Three weeks ago these were estimates; now they are measurements. Every claim
below cites either a spike measurement or a signed score rationale, and where I
argue from something unmeasured I label it. Two standing disciplines apply:
the gap dispositions in 05-finalists.md §5 bind this paper — no labeled evidence
gap gets rounded up, including in favor of my own preference — and constraint
readings come from 03-gate-verdicts.md as written, not from convenient
paraphrase.

My bias, on the record before the argument: my signed columns are C2 (cost to
build) and C3 (cost to operate forever). A composite led by my columns is a
composite that favors what is cheap *for us*, and cheap-for-us is not the same
fact as wanted-by-anyone. §4 takes that seriously rather than footnoting it.

## 1. What the spikes established (the evidence I argue from)

All three spikes came in at $0, on time, and **none moved any score in either
direction** — 18 signed estimates survived contact with measurement. That is
worth a sentence of honest satisfaction and no more; the interesting part is
that the *caveats* inside the scores got names and numbers:

- **Candidate C2 (code gates)** — spike-C2-code-gates.md. The engines and
  vulnerability data are cleanly licensable (LGPL-2.1 / Apache-2.0 / MIT /
  CC-BY 4.0), but **both best-known Semgrep rulesets are contractually barred
  from hosted service use** (Semgrep Rules License v1.0: "internal business
  purposes only… not… available to others as a service"; opengrep-rules carries
  a Commons Clause with the same effect). A licensable path exists (GitLab
  sast-rules, MIT) and is measurably thinner: 8 findings on flask vs. the
  registry's 16. Compute clears the <$100/repo/mo bar by **>40×** on the worst
  measured repo (~$2.40/mo derated, 340k-LOC repo, 50 scans/day). Out-of-box
  actionable rate on a 40-finding classified sample: **~5%** — permanent
  false-positive triage confirmed as the product surface. Token custody stated
  plainly: the platform App key is read access to every customer's source if
  breached. Verdict: C2=4 / C3=3 hold.
- **Candidate D1 (freelancer invoicing)** — spike-D1-freelancer-invoicing.md. A
  **constraint-7-clean architecture exists and is spec-validated end-to-end**
  (Stripe Connect direct charges on Standard-default connected accounts; all
  eight primitives validated against stripe-mock; the forbidden
  destination-charge shape identified and lintable). Stripe carries KYC
  onboarding, the hosted payment page, the invoice PDF, and invoice/reminder
  email on its own sender infrastructure — **$0 to us, on the freelancer's
  branding**. Template provenance bounded: Common Paper's Independent Contractor
  Agreement / PSA / SOW verified CC BY 4.0. Invoice rendering measured as
  commodity: 107 lines, 0.194 ms — and unnecessary, since Stripe emits its own
  `invoice_pdf`. Verdict: C2=4 / C3=4 hold.
- **Candidate D4 (event RSVP)** — spike-D4-event-rsvp.md. Per-event SMS cost
  fits the $30–100/mo band (~$0.008–0.0125/segment; ~$1–1.50 per 100-RSVP
  event; $9–17/mo all-in for a heavy organizer), **but US A2P registration —
  10DLC and now toll-free too — requires an EIN. The company is not
  incorporated; no production SMS path exists until it is, plus 2–4 weeks of
  carrier registration calendar.** v1 is therefore email-first behind one
  board-gated ESP signup (DO blocks SMTP outright; there is no self-send path).
  The no-show-delta proof is *designed* (within-event randomization,
  intent-to-treat, ~46/arm for the headline claim) and is paper until ~10 real
  events run. Throwaway core: 172 LOC, 9/9 tests. Verdict: C2=4 / C3=4 hold.

## 2. Company-level facts that outrank any candidate preference

Four findings generalize past their spikes. The step-4 memo should carry them
regardless of which candidate wins, and I put them here so the debate reasons
*from* them instead of rediscovering them later.

1. **Incorporation is a forcing function, not a candidate feature.** The EIN
   finding hard-blocks D4's SMS channel specifically, but it is the general
   case: carrier registration, live-mode processor verification (D1), and any
   marketplace listing (C2's distribution surface) all eventually demand a
   legal entity with a tax ID. Whatever we pick, the company's paperwork is on
   the critical path of some near-term capability. Recommendation for the memo:
   incorporation sequencing goes to the board as a **company milestone with its
   own lawyer-agent process** (per PHILOSOPHY.md #2 the state of incorporation
   is a lawyer-agent decision), decoupled from the candidate debate so it never
   becomes a tiebreaker argument for or against D4.
2. **Email is never free for us, and only D1 gets to defer that.** DO blocks
   SMTP ports 25/465/587 outright — no reputation level unlocks them. Every
   custom-email future for any candidate runs through a board-gated ESP/AWS
   signup (post-amendment: *all* signups gated, price irrelevant). D1 uniquely
   rides Stripe's sender infrastructure for its headline reminder loop in v1;
   D4's ESP signup *is* its launch gate; C2's email needs are modest
   (notifications) but not zero.
3. **Unit economics are settled — stop debating them.** All three candidates
   cleared their cost bars with margin (>40× on C2 compute; near-zero marginal
   on D1; cents per event on D4 email and single-digit-to-30% COGS on D4 SMS
   with per-tier caps). The measured differences live in **standing
   obligations, blast radius, and third-party gates** — exactly where my C3
   rationales located them. Any debate argument about per-unit cost is now
   arguing with a measurement.
4. **Every core is small; every cost is in the edges.** 107 lines (D1 invoice),
   172 lines (D4 RSVP engine), glue-over-engines (C2). The agent workforce
   builds any of these cores in a tick's fraction. Differentiation therefore
   cannot come from the core anywhere in this pool — it comes from curation
   labor (C2), proof discipline (D4), or polish-and-trust (D1), and those are
   what we should be comparing.

## 3. My preference: Candidate D1 — freelancer invoicing/contract automation

**Preference, stated precisely: D1, conditional on the demand-side disposition
(05-finalists.md §5.2) not returning adverse.** The condition is not hedging —
it is the co-signed rule that my columns cannot answer a demand question, and
D1's open question is a demand question. Within my signed domain, the technical
case is the strongest in the pool and it is now a measured case:

1. **It is the only finalist whose deepest risk was *architectural*, and that
   risk is now retired.** Constraint 7 ("never a payee, never an aggregator,
   never in the flow of funds") was the one gate that could have killed D1 at
   the design level. The spike validated the clean shape against Stripe's own
   OpenAPI spec, eight primitives end-to-end, with the flow-of-funds evidence
   quoted from Stripe's docs — client money settles on the freelancer's own
   account; we compute and read. The remaining boundary work is a **lintable
   invariant** (wrapper hard-requires the `Stripe-Account` header, bans
   `transfer_data`) — a permanent design-review obligation I priced at "cheap
   but forever" in the C3=4 rationale, now confirmed at exactly that size.
2. **Lowest blast radius in the pool, by construction.** What we hold: ordinary
   business PII and read-only webhook state on accounts we do not own. Compare
   the finalists' worst days: C2's worst day is a leaked App key that reads
   every customer's source (spike memo §4 — "a breach of us is a breach of
   them"); D4's worst day is a consent/TCPA failure on someone else's phone
   bill; D1's worst day is a missed webhook and a stale payment status. For a
   company with zero operational track record, the candidate whose failure
   modes are *recoverable* is worth real points.
3. **The heaviest standing obligations are Stripe's, contractually, not ours
   aspirationally.** My C3 rationales price what we operate *forever*. D1's v1
   defers to the processor: KYC (hosted onboarding — we never see the bank
   details), payment-page PCI surface, invoice PDF, and — the one that
   surprised me — the reminder/dunning email loop itself, on Stripe's sender
   reputation, under the freelancer's branding. The deliverability SLA my score
   priced as D1's main obligation is v1-deferred at $0. Neither other finalist
   has an equivalent: C2's vuln-DB currency SLA and D4's two-channel
   deliverability are ours from day one.
4. **The build-side unknowns that held C2 off a 5 are both bounded now.**
   Template provenance: Common Paper, CC BY 4.0, verbatim-verified — the exact
   document family (ICA, PSA, SOW, NDA), $0, with a lawyer-review residual that
   sits in Criterion-C5 territory and is the same *shape* of residual D4
   carries for TCPA. Rendering and workflow: measured commodity. What remains
   is what the evidence always said the product is — self-serve polish against
   the $15–30/mo gap — and that is enumerable product surface, not research.
5. **Launch gates: one free signup.** D1's only measurement-blocking gate is a
   Stripe test-mode account (free; board-gated as a signup per the amendment).
   No EIN prerequisite for test-mode validation, no multi-week third-party
   registration pipeline, no ESP required for the v1 loop. Time-to-evidence is
   the shortest in the pool, and per my own operating rule, the option that
   converts assumptions into measurements fastest deserves a thumb on the
   scale.
6. **For completeness, the signed matrix agrees** — D1 sits at 19, the only
   candidate above 18, with the pool's best legal surface (Criterion C5=4, CEO
   column) and no lawyer trigger. I cite this as the co-signed record, not as
   my argument; my argument is items 1–5.

## 4. The strongest argument against my own preference (steelmanned)

Here is the best case against D1, made the way I would make it if Carla held my
position and I held the red pen. One line first, then in full:

> **D1's measured ease is symmetric. Everything hard belongs to Stripe, so the
> product is equally easy for everyone — including Stripe — and it launches
> into a price band the evidence says is already occupied. A 4/4 on my columns
> measures our cost, not anyone's demand.**

In full, four prongs:

1. **The moat inversion.** The spike proved the architecture is eight
   documented API calls, a CC-licensed template library, and a 107-line PDF
   renderer we don't even need. My own findings memo is functionally a build
   guide; any competent competitor reproduces v1 from public docs in days. Low
   cost-to-build is not an asset when it is low for the whole world — it is the
   *absence of a barrier*, and my scoring convention counts it as a virtue
   because my columns only see our side of the ledger.
2. **The band is occupied, and the disposition forbids pretending otherwise.**
   Plutio at $19 and Bonsai at $25 sit exactly inside the $15–30/mo "gap."
   Carla's Criterion C1=3 priced displacement, not gap-filling, and
   05-finalists.md §5.2 binds this paper: the crowded band may not be treated
   as empty, and D1's composite lead does not exempt it. A technically clean
   build into an occupied band is the classic way well-engineered products die
   politely.
3. **Platform concentration, with the platform as a potential competitor.** The
   argument's sharpest edge comes from my own §3 item 3: the reason D1 operates
   cheaply is that Stripe already does most of it — *including sending invoices
   and payment reminders, which is the headline value*. Stripe Invoicing is a
   live, monetized Stripe product. We would be a thin layer over a single
   vendor that owns our API surface, our account approval, our fee structure,
   and a first-party product one feature-release away from our wedge. There is
   no second rail; constraint 7 makes any custody-bearing alternative
   architecture off-limits by design.
4. **The composite lead is one point wide and standing on my own columns.** D1
   at 19 leads 18/18 because it is the pool's only 4/4 in C2/C3 — my two
   columns. Shift any weight toward the demand-side criteria and the lead
   vanishes; note the CEO's C1 column actually ranks candidate C2 *above* D1
   (4 vs 3). A preference that survives only under the preferrer's own scoring
   domain should be held loosely.

**What I concede and what I hold.** Prongs 1–3 are true and I do not argue them
down; they are why my preference carries an explicit demand condition rather
than being unconditional. What blunts them, without dissolving them: (1) the
moat in this segment was never going to be architecture — at a $15–30
self-serve price point the moat is trust, polish, and distribution for
*everyone* in the band, incumbents included, so prong 1 argues against the
segment more than against us specifically — a real argument, but one that
belongs in Carla's columns, where it was already priced (C1=3); (2) platform
risk is the price of constraint 7 — every payments-adjacent candidate that
satisfies "never in the flow of funds" is structurally a layer over a licensed
processor, so prong 3 discriminates D1 from D4/C2 less than it first appears
(D4 has carrier/TCR concentration; C2 has GitHub-platform concentration with a
first-party competitor *already shipped*: GitHub Advanced Security); (3) prong
4 is why the condition in §3 is load-bearing: **if the warm-intro validation
returns "the band's occupants already serve these buyers well," my preference
is withdrawn — that is the falsifier, named in advance.**

## 5. Candidate C2 (code gates): my view, and what would change my mind

**View:** the strongest *moat* and the best *agent-fit* in the pool, carrying
the heaviest standing obligations. The licensing finding shapes the moat
honestly in both directions: the restriction is symmetric — every hosted
competitor faces the same barred rulesets, which is precisely why the curation
layer is defensible and why Semgrep reserves it for its own paid product — but
it also means our licensable baseline is measurably thinner (8 vs. 16 findings
on flask) and rule gap-filling becomes our maintenance surface forever. The
measured ~5% actionable rate confirms my C3 rationale: the product *is* the
triage layer. And that is the honest bull case: false-positive triage and rule
curation are mechanical, text-heavy, feedback-rich — the best match in this
pool for the agent-workforce hypothesis, which my method notes have always
labeled a hypothesis precisely because nobody has measured it. Against that:
C3=3 is the pool's floor among finalists for structural reasons — a permanent
vuln-currency SLA, and token custody that makes our security posture
existential before we have revenue. A security product's first breach is its
last.

**What would change my mind (moves C2 to my first preference):** (a) the
labeled demand gap closing *positive* — primary evidence that 2–20-dev teams
pay today (Carla-side; the disposition already routes this); (b) a measured
agent curation/triage rate on real finding streams — the single number that
would loosen C3's cap, since the standing obligations are exactly the labor
agents are hypothesized to be cheap at; (c) a small, bounded commercial quote
for the Semgrep registry rules — converting the thin-ruleset penalty into a
priced line item. Two of those three are cheap to obtain; if the debate turns
on C2, I will ask for them before the memo rather than argue past them.

## 6. Candidate D4 (event RSVP): my view, and what would change my mind

**View:** a clean 4/4 whose differentiating channel cannot exist at launch. The
spike's EIN finding turns "SMS is compliance-shaped plumbing" into "SMS is
gated on the company's own incorporation plus 2–4 weeks of someone else's
manual review" — so v1 is email-only reminders, and the honest note in the
memo cuts deep: the 30–50% → 10–15% analyst figure is about reminder
automation *generally*, and whether email-only captures most of that delta is
exactly the unproven part. What I genuinely admire in this candidate is that
the spike gave it the pool's best proof engine — within-event randomization,
intent-to-treat, ~46/arm to demonstrate the headline claim — a product that
can *measure its own value claim* is the kind of product I want this company
to build, and if D4 wins, that design is v1-mandatory scope and I will hold it
in design review. But today the value claim is third-party, the two-product
fork (which half the buyer pays for) is still a demand question, and the
integrated-WTP gap is labeled and binding. A 4/4 with an unproven delta and a
blocked differentiator ranks below a 4/4 with a retired architectural risk.

**What would change my mind (moves D4 up):** (a) the fork resolving to
RSVP+reminders as the paid half at $30–100/mo (CEO-side); (b) any credible
evidence — third-party or early pilot — that email-only reminders capture the
majority of the no-show delta, which converts the EIN gate from "blocks the
value" to "blocks a fast-follow"; (c) incorporation landing early enough that
the 2–4-week registration pipeline fits inside the launch window anyway, which
item 1 of §2 makes plausible. Adverse falsifier, named: if organizers refuse
within-event holdouts in practice, the proof engine degrades to
before/after-with-clustering (~30+ events for the same confidence) and the
value claim stays an assertion for a year — that would drop D4 to a firm third.

**Fallback ordering, stated so silence doesn't get recorded as indifference:**
if D1's demand condition fails, my fallback is **C2, then D4** — which reverses
my own raw column sums (D4 8 vs. C2 7) by one point of estimate noise, and I
flag that deliberately: at a one-point delta my columns are not decisive, and
moat durability plus agent-fit (C2) outweigh a blocked differentiator plus an
unproven delta (D4) in my judgment. If C2's demand gap *also* closes negative
while D4's fork resolves favorably, the ordering flips on the evidence, not on
re-argument.

## 7. Positions for the record (silence = no objection, so: no silence)

1. **Preference: D1**, conditional on the §5.2 demand disposition; falsifier
   named in §4. Fallback ordering per §6: C2, then D4, evidence-contingent.
2. **Constraint-7 app-fee rail:** the step-4 memo should put the one-line
   interpretation question to the board exactly as the spike framed it.
   **Default until answered: subscription-only revenue (strictest-clean
   rail).** The architecture verdict does not depend on the answer.
3. **If D1 is selected:** first board-approval request is the free Stripe
   test-mode account, to close the two honestly-unmeasured items (webhook
   fidelity, onboarding friction) before any product milestone depends on
   them.
4. **If C2 is selected:** the licensable-stack-only rule (no registry rules in
   any hosted path) is binding from the first commit; the memo's five lawyer
   follow-ups become blocking pre-launch items; key-custody architecture
   (KMS-held App key, per-job short-lived tokens, ephemeral clones) is
   v1-mandatory scope.
5. **If D4 is selected:** email-first launch; the §3 proof design (arm
   assignment, consent ledger, check-in ground truth) is v1-mandatory scope,
   not a fast-follow; SMS is a fast-follow gated behind incorporation, and
   product copy cites the analyst no-show figures as third-party until ~10
   events of our own data exist.
6. **Regardless of candidate:** incorporation sequencing goes to the board as
   a company milestone (lawyer-agent process, per PHILOSOPHY.md #2), decoupled
   from candidate selection; and every ESP/processor/carrier account remains a
   board-gated signup under the 2026-08-31 amendment, price irrelevant.
7. **Process:** nothing is decided by this paper. Papers exchange next tick;
   disagreements resolve in the debate record; the one-page step-4 memo
   carries the joint position and the open board questions; commitment happens
   at step 5, at the board's tempo.

## 8. Signature

A signature below means: "This position is mine alone, argued from the three
spike memos and the signed scoring record under the gap dispositions as
binding, with my strongest counter-argument stated in §4 at full strength and
my falsifiers named in advance; it was written without sight of the CEO's
paper; and it decides nothing."

- **Owen Kessler, CTO** — SIGNED, 2026-08-31.
