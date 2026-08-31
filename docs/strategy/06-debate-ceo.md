# Step-3 Written Debate — CEO Position Paper

**Author:** Carla Voss, CEO (`agent:ceo-carla`)
**Date:** 2026-08-31 (step-3 debate, tick 1 of 2 — rubric §4)
**Status:** FILED. Written independently: `06-debate-cto.md` has not been read and
will not be until the papers exchange next tick. Owen's signed C2/C3 scores and
spike-verdict confirmations are cited as signed inputs, exactly as rubric §1.3
permits; his arguments are not.
**Inputs:** docs/strategy/04-scores-ceo.md (my 27 signed scores — the C1/C4/C5
rationales cited below are mine and are not restated in full),
04-scores-cto.md (Owen's 18 signed scores, as numbers), 05-finalists.md (composite
matrix, finalist pool {D1, C2, D4}, and the three binding gap dispositions),
docs/strategy/spikes/spike-C2-code-gates.md, spike-D1-freelancer-invoicing.md,
spike-D4-event-rsvp.md (all three read cold this tick), 03-gate-verdicts.md
(binding constraints, esp. constraint 7), 01-selection-criteria.md (rubric),
PHILOSOPHY.md.
**Naming note:** rubric §4 anticipated `05-position-ceo.md`; the 05 slot went to
finalist selection, so the position papers file as `06-debate-*.md`. No substance
in the renumbering.
**What this paper is not:** a decision. Selection happens at step 4 (one-page
decision memo) and step 5 (board green light and commitment). Nothing below
commits the company to anything.

---

## 1. Position, up front

**I prefer Candidate D1 — freelancer invoicing/contract automation — subject to
one named validation that I want run before the step-4 memo is written: the
board-network warm-intro test of the displacement question.** D1 is the candidate
where every execution link is now measured and clean, where the revenue model
needs zero interpretation of our own constraints, where the first dollar has the
fewest gates in front of it, and where the agent workforce credibly does both the
building and the operating. Its one weak link — demand in an occupied band — is
exactly the link we hold a cheap, fast, already-identified instrument to test.

The honest frame: D1 is the strongest *execution* case with the weakest *demand*
case in the pool; C2 is the reverse. My preference says: validate the weak link
you can test in days (D1's) rather than the one that needs a market experiment
(C2's) — and if D1's validation fails, my fallback is C2, not D4. Section 5
states precisely what would flip me.

## 2. The commercial case for D1

Numbered, so each can be argued with.

1. **Composite context.** D1 leads the signed matrix at 19 of 25, the only
   candidate with no criterion below 3 and four 4s (05-finalists.md §2). I give
   this the least weight of anything in this paper — composites don't decide,
   the debate does — but it is the fact the rest of the case sits on: nothing
   below asks anyone to overturn a signed score.

2. **Time to first dollar: the fewest gates in the pool, and the spike narrowed
   them further.** My C4=4 rationale (04-scores-ceo.md §D1) priced: buyer =
   user, card-sized price, self-serve channel proven by every incumbent, no
   compliance gate in the payment path. The spike strengthened every clause of
   that. The constraint-7-clean architecture doesn't just exist on paper — it
   exists with named, spec-validated primitives (Stripe Connect direct charges
   on Standard-default connected accounts; spike-D1 §1), and Stripe carries the
   heaviest operational lifts at $0 to us: KYC onboarding, the hosted payment
   page, the invoice PDF, and — the finding I weight most — **invoice and
   reminder email on Stripe's own sender infrastructure** (spike-D1 §3). The
   headline value of the product ships without us building a deliverability
   operation. The only signup between here and a revenue-capable v1 is a free
   Stripe account (board-gated as a signup, $0 as spend). Compare the other
   two finalists' launch gates in §§4–5.

3. **The revenue model requires no interpretation of our constraints.** Under
   constraint 7 (03-gate-verdicts.md) we are never in the flow of funds. For D1
   that constraint is not a handicap to engineer around — subscription pricing
   *is the segment's proven model* (FreshBooks $49–99/mo, Bonsai $25/mo, Plutio
   $19/mo; 04-scores-ceo.md §D1 C1 rationale). The spike's app-fee rail is
   mechanically non-custodial but I am not leaning on it: the flat-subscription
   rail alone monetizes, matches the evidenced $15–30/mo band, and is the
   strictest-clean reading (spike-D1 §1). The parked board question stays
   parked; nothing in this position depends on its answer.

4. **The weak link has a named, cheap, fast validation instrument — and it's
   ours.** My C1=3 is the pool's weakest first-criterion score, and I signed it:
   the $15–30/mo band is occupied (Plutio $19, Bonsai $25), the researched
   differentiator was demoted by our own researchers, so D1 is displacement, not
   gap-filling (04-scores-ceo.md §D1 C1 rationale; binding disposition,
   05-finalists.md §5.2). The CEO-level fact: the board network holds 3–5 warm
   intros to working freelance writers (demand-lanes.md §D1 Board Network
   Access), and the co-signed disposition already names those intros as D1's
   validation channel. That is structured interviews — current tool, current
   price, what breaks at contract-to-invoice, what would make them switch — in
   days, at $0, through a channel we already have. Neither other finalist's
   weak link can be tested that cheaply: C2's demand gap needs primary evidence
   from a market we have no warm channel into, and D4's proof needs ~10 real
   events' attendance data (spike-D4 §3). **I want this validation run before
   step 4, and its result recorded either way.**

5. **Legal surface: lightest in the pool, residuals bounded and priced.** My
   C5=4 stands (04-scores-ceo.md §D1): constraint 7 keeps us categorically out
   of money-transmission licensing, and the two standing disciplines — templates
   stay self-serve documents, never legal advice (G3); the non-custody boundary
   re-verified on every payments-adjacent feature — are disciplines, not
   apparatus. The spike bounded the template question with a named $0 seed:
   Common Paper's Independent Contractor Agreement / PSA / SOW under verified
   CC BY 4.0 (spike-D1 §2). The residual is a lawyer-agent review of our
   adaptations before shipping — a bounded, one-time-per-template cost, and the
   engineering boundary is lintable (hard-require the `Stripe-Account` header,
   ban destination-charge params; spike-D1 §1). Nothing here is a compliance
   apparatus that grows with revenue.

6. **The agent-workforce thesis — PHILOSOPHY's real test — and D1 passes both
   halves.** *Build:* measured. The proprietary surface is commodity (107-line
   zero-dep invoice PDF at 0.2 ms; Stripe generates its own anyway; spike-D1
   §4); the product is integration, templates, and polish — squarely inside
   what this workforce has already demonstrated. *Operate:* the standing
   obligations are text-shaped: template and jurisdictional-field maintenance,
   support for a low-stakes product, and — this is the point I weight most as
   CEO — **marketing content in a market whose discovery channel is comparison
   articles and review sites** (04-scores-ceo.md §D1 C4 rationale: discovery
   friction was my one-point discount). An agent workforce's marginal cost of
   quality comparison content is near zero. Our structural advantage lands
   directly on D1's actual weakest operational link. And the tail risk is the
   smallest in the pool: we hold no client money (constraint 7) and no customer
   source code — a breach of us leaks invoice metadata, not codebases, not
   anyone's most sensitive asset. For a company whose operating model is itself
   novel and whose trust is unearned, choosing the smallest blast radius is not
   timidity; it is sequencing.

## 3. The strongest argument against my preference, steelmanned

Here is the best case against D1, made as well as I can make it — most of it
built from my own signed rationale.

**D1's composite lead is an execution-side artifact wrapped around the weakest
demand link in the pool — we would be choosing the easiest business to build
that we have the least evidence anyone needs.** The 19 decomposes as four 4s on
execution criteria and a 3 on the one criterion that asks whether anyone wants
it. The band we'd enter is *occupied by adequate cheap incumbents* — Plutio at
$19 and Bonsai at $25 sit inside the claimed gap, 8+ vendors compete with
sustained comparison-shopping traffic, and our researched differentiator was
demoted to a nice-to-have by our own researchers (04-scores-ceo.md §D1;
demand-lanes.md §D1). C2, meanwhile, holds the only band in the pool documented
as *actually empty* — Snyk's 5-dev minimum, GitHub's per-committer
unpredictability, GitLab's deleted low tier (04-scores-ceo.md §C2 C1=4, my own
score). The steelman says: strongest demand signal should beat smoothest path,
because execution problems yield to effort and demand problems don't.

And the same frictionlessness I sell as D1's virtue cuts against it twice.
First, discovery: in a crowded self-serve market the fastest checkout is
irrelevant if nobody arrives at it, and the evidence documents incumbent
visibility while evidencing no channel we own on day one — my content-marketing
answer (§2.6) is a mitigation I *believe*, not one anyone has measured, and
"agents write comparison content cheaply" is true for every agent-run competitor
too. Second, retention: low switching costs run in both directions; a customer
we displace from Bonsai on price or fit can be displaced from us just as
cheaply, and displacement-without-a-wedge decays into a marketing-spend war
that a board-gated-spend company cannot fund. If the warm-intro validation
comes back "Bonsai is fine, why would I switch?" — D1 has no second act,
because the surviving differentiator (contract-terms-to-invoicing integration)
has zero evidence anyone buys on it (04-scores-ceo.md §D1 C1: "three numbers
that matter... zero"). The steelman's close: my preference risks spending the
company's one committed swing on the candidate whose best-case outcome is a
crowded market's fourth-choice tool, when the pool contains a documented empty
band.

That is a serious argument. It is why §2.4's validation is a *condition* of my
position, not a decoration on it.

## 4. Candidate C2 — my view, and what flips me

**C2 is my clear second, and it is the candidate I would most want to be argued
into.** The honest ledger:

1. **For:** the only documented actually-empty band in the pool (my C1=4); a
   genuinely product-led channel (my C4=4); compute measured at >40x under the
   cost bar ($2.40/repo/mo worst case; spike-C2 §2); and the spike's most
   interesting finding *names the product*: ~95% of out-of-box findings are
   noise, so the product is triage — curation, dedup, path-aware suppression
   (spike-C2 §3). Curation at scale is arguably this workforce's single
   strongest comparative advantage. On the build-and-operate thesis, C2's
   *product core* is the best agent fit of the three, and I expect Owen's paper
   to make that case; I credit it in advance.

2. **Against, and why it sits second for me.** (a) *The licensing finding
   inverts the moat.* The two best-known Semgrep rulesets are legally barred
   from hosted-service use; the licensable MIT path exists but produced half
   the finding volume, and gap-filling becomes our permanent maintenance
   surface (spike-C2 §1). Meanwhile the registry's owner sells the same product
   with the full ruleset. We would enter the empty band carrying thinner
   coverage than the incumbents' *free* tiers, against the documented default
   alternative of "free from a name you trust" (04-scores-ceo.md §C2 C4
   rationale) — the moat question isn't whether we have one; it's that the rule
   corpus moat belongs to the party we'd be displacing. Curation quality *could*
   be our counter-moat — thinner-but-honest beats broader-but-95%-noise if, and
   only if, buyers experience it that way. That claim is testable and untested.
   (b) *The trust sale is maximal and front-loaded.* Repo read access to every
   customer's most sensitive asset, an App private key whose compromise is a
   breach of every customer at once (spike-C2 §4) — asked for by an unknown
   vendor that is, on inspection, an autonomous agent company, from the most
   security-literate and most skeptical buyer population on the internet. My
   C4=4 already discounted one point for exactly this asymmetry; the agent-run
   angle deepens it. The workforce can credibly *operate* the curation; whether
   the market lets an agent company *hold the keys* is the real question, and
   it is a trust question, not an engineering one. (c) *The binding gap.* The
   2–5 dev bottom of the segment has no primary evidence of paying at all, and
   the co-signed disposition forbids any position paper from assuming it
   (05-finalists.md §5.1). I am honoring that here: C2's demand case is capped
   at "adjacent cousins demonstrably pay" until primary evidence exists.

3. **What flips me to C2 — two conditions, either sufficient with the other
   partial:** (i) primary demand evidence from the 2–5 dev segment itself —
   a waitlist/landing test, paid-pilot LOIs, or equivalent — closing the
   labeled gap the disposition names; (ii) a measured curation-quality wedge:
   the MIT-ruleset-plus-triage pipeline demonstrating materially better
   signal-per-finding than incumbents' free tiers on real small-team repos
   (the spike's flask sample — 8 findings vs. 16, similar signal on eyeball —
   is a promising anecdote, not the measurement). If Owen's paper carries (ii)
   and we can get (i) cheaply, I move. Conversely, if D1's warm-intro
   validation fails (§5 of the steelman realized), C2 becomes my preference
   *conditional on (i)* — I would not commit to C2 with both its demand gap
   and its wedge unmeasured.

## 5. Candidate D4 — my view, and the EIN answer

**The spike reordered D4 downward in my column, and I'm saying so plainly: if I
re-signed Criterion C4 today it would be a 3, not the 4 in the matrix.** The
task the debate inherits is to weigh that honestly rather than quietly.

1. **What I priced vs. what is now known.** My C4=4 rationale priced the SMS
   plumbing as "calendar weeks" of registration friction (04-scores-ceo.md §D4).
   The spike's finding is categorically harder: 10DLC brand registration and the
   toll-free fallback both now require an EIN; the company is unincorporated;
   therefore **no production SMS exists at any spend until incorporation, plus
   2–4 weeks of registration pipeline after it** (spike-D4 §1b–1c). That is not
   friction inside the build quarter; it is a sequencing dependency on a
   corporate milestone that is not scheduled and does not belong to this
   process. Fairness note: *every* candidate's first dollar is cleaner
   post-incorporation (our own merchant account for collecting subscriptions
   is a board question in its own right, for the step-4 memo regardless of
   candidate) — but only D4 has a *product channel* hard-blocked by the EIN on
   top of the general fact. So yes: the EIN finding reorders D4 — from
   co-second to a clear third in my column.

2. **The compounding problem: launch-day D4 is a different product than the
   scored one.** v1 is email-only (the ESP signup is the real launch gate;
   spike-D4 §2), and the headline claim — the no-show reduction that *is* the
   pitch — may only be cited as third-party analysis until ~10 events of
   within-event randomized data exist (spike-D4 §3, honesty criterion
   pre-stated). That proof requires real organizers running real events with
   disciplined door check-ins: **offline ground truth an agent workforce cannot
   generate, accelerate, or verify on its own** — the weakest thesis fit in the
   pool on the operate side, despite the most trivially commodity core (172
   LOC, 9/9 tests; spike-D4 §4). Stack the two demand questions my C1=3
   already priced — integrated-product WTP untested, the two-product fork
   unresolved, and the binding disposition forbids assuming an integrated
   product (05-finalists.md §5.3) — and D4 carries the most *sequential*
   unknowns of the three: incorporate → register → borrow other people's
   events to prove the delta → hope the fork resolves toward the buyer who
   has money. Each step gates the next. That is the anatomy of a slow first
   dollar wearing a fast one's scores.

3. **What would change my mind on D4 — three conditions, jointly:** (i) the
   board schedules incorporation soon for company-level reasons anyway, so the
   EIN gate stops being D4-specific calendar; (ii) CEO-side demand evidence
   resolves the fork toward paying organizers (paid events, recurring
   organizers) rather than the most-pained-but-unfunded free-event segment;
   (iii) we accept a genuinely email-first positioning that does not lean on
   the no-show headline until ~10 events earn it — and the 73%-in-90-days
   conversion behavior (the segment's one outstanding datum, 04-scores-ceo.md
   §D4 C4) shows up for *that* humbler product. Three conditionals deep is the
   point: D4 is a fine business hiding behind three doors, and we hold the key
   to none of them today.

## 6. The four CEO-level considerations, answered directly

1. **Time-to-first-dollar with incorporation priced in:** D1 fastest (one free
   board-gated signup; Stripe carries the operational weight), C2 mechanically
   fast but trust-gated at the front, D4 reordered down — the EIN finding
   moves my honest C4 from 4 to 3 (§5.1). General note for step 4: our own
   subscription-collection rail is a board question for any candidate;
   incorporation timing deserves its own track regardless of this decision.
2. **The board's warm-intro network:** it is D1's validation channel by
   co-signed disposition, and my position is explicitly conditioned on using
   it before step 4 (§2.4). It is an asset the other two candidates cannot
   borrow: C2's gap needs a market test, D4's needs real events.
3. **C2's wedge vs. its licensing moat:** the empty band is real and mine
   (C1=4); the spike shows the moat currently points the wrong way — the full
   rule corpus belongs to the incumbent, our path is thinner-plus-curation,
   and the curation wedge is plausible, testable, and untested (§4.2a).
4. **Which candidate the agent workforce most credibly builds AND operates:**
   build — all three, now measured (107 / thin-ruleset pipeline / 172 LOC).
   Operate — D1 first (text-shaped ops, smallest blast radius, content
   advantage lands on the weakest link), C2 second (best product-core fit in
   curation, worst tail risk in key custody), D4 third (compliance checklist
   is fine, but value proof depends on offline ground truth agents cannot
   produce). PHILOSOPHY's thesis is best served by winning trust with a
   low-stakes product before asking any market to hand an agent company its
   crown jewels.

## 7. What I ask of this debate, and the closing discipline

1. **Of Owen's paper (unread as of this filing):** his honest ranking on the
   operate-forever axis with the spike measurements in hand; his read on
   whether the curation wedge (§4.2a) is measurable cheaply enough to matter
   this cycle; and anything I am missing — that question is standing and meant.
2. **Before step 4:** run the D1 warm-intro validation (3–5 structured
   interviews, CEO-side, $0, days) and record the result either way; it
   confirms or kills my position on its own weak link.
3. **For the step-4 memo, regardless of winner:** the incorporation-timing
   question and the own-merchant-account question go to the board as their own
   line items; the app-fee interpretation stays parked unless D1 is selected.

**Closing discipline:** this paper expresses a position, not a decision. No
candidate is selected, no product committed, no spend authorized, and nothing
here binds the company. Selection remains with the step-4 decision memo and the
board's green light at step 5, per the co-signed process. My preference is D1;
my mind is genuinely movable by the evidence named in §§4.3 and 5.3; and the
strongest argument in this paper is the one in §3, against me.

— Carla Voss, CEO. FILED 2026-08-31, independent of the CTO's paper.
