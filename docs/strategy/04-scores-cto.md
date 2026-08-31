# CTO Scores: C2 (Cost to Build v1) & C3 (Cost to Operate Forever) — All Nine Candidates

*This file holds both scoring ticks in my signed domain: Part I (competitive lanes
C1–C4, filed first) and Part II (demand lanes D1–D5, appended the following tick).
Part I is reproduced untouched below its original header; nothing in it was revised
when Part II was appended.*

# Part I — Competitive Lanes C1–C4

**Status:** SIGNED — 8 scores (2 criteria × 4 candidates), CTO domain per rubric §1.3
**Owner:** Owen Kessler, CTO (sole signer; per rubric §1.3 the CEO neither edits nor pre-approves these scores; disagreement goes to the step-3 written debate)
**Rubric:** docs/strategy/01-selection-criteria.md §3 — C2 and C3 definitions as signed; scale 1–5; every score carries a written rationale citing evidence, or it is void
**Evidence basis:** docs/strategy/evidence/competitive-lanes.md (Elliot Kwan, C1–C4), docs/strategy/evidence/00-longlist.md (final long-list, evidence-completeness labels), docs/strategy/03-gate-verdicts.md (binding constraints, incl. my co-sign constraints 5–7)
**Scope:** The four competitive-lane candidates only (C1 micro-credentials, C2 code gates, C3 construction permit data, C4 compliance automation). D-lane scores (D1–D5) are my next tick. Carla's C1/C4/C5 scoring runs independently.
**What this document is not:** No ranking, no recommendation, no finalist selection. Two of five criteria are scored here; nothing can or should be ranked from them.

---

## Method notes (read before the numbers)

1. **Definitions as signed, no drift.** C2 = total effort, calendar ticks, and dollars
   from zero to a first *revenue-capable* release, built by our agent workforce under
   current constraints (rubric §3). "Revenue-capable" is load-bearing: I score the
   build a paying customer would accept, not the demo I could stand up in a tick.
   C3 = the permanent per-unit and fixed obligations once live — reliability,
   security, tenancy, support, per-unit delivery cost (rubric §3).
2. **Agent-workforce effects are a hypothesis, not a discount** (rubric §3, C3
   definition; my own amendment). Where I believe agents change the cost curve —
   scraper repair in candidate C3 is the clearest case — I say so explicitly, label
   it a hypothesis, and score on the evidence in hand. No score below assumes agents
   make anything free.
3. **Binding gate constraints apply.** Constraint 5 (03-gate-verdicts.md, CTO co-sign
   constraints): candidate C3's v1 path may not assume paid data — free,
   ToS-compatible portals only; paid access is a board-gated purchase outside v1
   scope. My carried items from the co-sign (03-gate-verdicts.md signature block):
   OSS scanner license compatibility for hosted commercial use (candidate C2) and
   data-access uncertainty (candidate C3). Both are priced into the scores below as
   degree, not gates.
4. **Evidence in hand only; gaps cost points honestly.** Where the evidence file
   labels a gap that bears on build or operating cost, the score reflects the
   uncertainty and the spike-must-test list says what a finalist spike (rubric §1.4,
   §4 box 2b: one tick, $0, throwaway) has to measure before the step-3 debate may
   cite these numbers as validated.
5. **A calibration note on my own bias.** My dossier says I distrust unmeasured
   claims, and every number below is an estimate, not a measurement. I have scored
   conservatively where the dominant cost driver is *unknown scope* (candidates C3,
   C4) and less conservatively where the cost drivers are conventional and
   enumerable (candidates C1, C2). If that asymmetry is wrong, the spikes will say
   so — that is what they are for.

---

## Candidate C1 — Micro-Credential Platforms for Mid-Market Upskilling (50–500 person firms)

### C2 (Cost to build v1): **3**

An LMS with micro-credential issuing is conventional software — multi-tenant CRUD,
course/assessment structures, progress tracking, credential issuance, billing. No
component is technically hard, no paid data or licensing is required, and hosting is
commodity (gate verdict C1 G4, 03-gate-verdicts.md). What keeps this from a 4 or 5
is the *width* of the revenue-capable floor, and the evidence file itself is the
witness: the buyer is an organization deploying to 50–500 employees, and
competitive-lanes.md §C1 (Docebo tier) documents $10,000–$40,000 *implementation*
costs for mid-market deployments — HRIS integration, SSO, branding, migration. That
is direct evidence of what this segment expects at rollout, and it means a
revenue-capable v1 plausibly needs org admin, roles, SSO, and reporting from day
one, not as fast-follows. A second scope axis the evidence never resolves: content.
A hosted LMS with no content is an empty shelf; competitive-lanes.md §C1 documents
incumbents' pricing but not whether mid-market buyers at the $5–15/user/mo target
(product shape, §C1 Niche Definition) arrive with their own training material or
expect a library. If we must supply or license content, build scope changes by an
axis, and content licensing would be board-gated spend. Broad-but-conventional
surface, one unresolved scope axis, zero exotic risk: 3.

### C3 (Cost to operate forever): **3**

Marginal cost per tenant is modest for the CRUD core, but two obligations keep this
mid-scale. First, per-unit delivery cost is not near-zero if training content
includes hosted video: storage and bandwidth scale with active learners, and at
$5–15/user/mo (competitive-lanes.md §C1 Product shape) the margin per seat is thin
enough that media delivery cost is a real line item, not a rounding error — this
needs measurement, not assertion. Second, standing obligations: the same Docebo
implementation-cost evidence (§C1, $10k–40k deployments) says this segment is used
to being onboarded and supported as a service; a vendor that quotes $5–15/user/mo
still inherits those expectations, just without the fee. Onboarding, admin support,
and rollout hand-holding for 50–500-seat orgs is recurring work that scales with
customer count. Agent-workforce hypothesis, labeled as such: onboarding and support
here are text-heavy, procedural, and largely asynchronous — plausibly good agent
work — but we have zero measurements of agent support quality against org
customers, so it earns no discount today. Reliability posture is ordinary business
SaaS (work-hours availability, standard data privacy; no regulated data in the base
shape). Ordinary obligations, thin-margin delivery cost, unmeasured support burden: 3.

### Spike must test (if finalist)

1. Build the tenancy + credential-issuance core in the spike tick and measure how
   much of the Docebo-evidenced enterprise floor (SSO, HRIS, reporting) can be
   *excluded* from v1 before the product stops being credible — the C2 score moves
   with that boundary.
2. Model storage/bandwidth cost per active learner for customer-supplied content
   (video vs. document-based) against the $5–15/user/mo target tier.
3. Resolve the content-supply question (customer-authored vs. bundled library) —
   jointly with Carla's C1 evidence, since it is half demand question, half build
   scope.

---

## Candidate C2 — Lightweight Code Quality Gates for Small Dev Teams (2–20 devs)

### C2 (Cost to build v1): **4**

This is the candidate whose build path our workforce can enumerate with the least
guesswork, and the evidence supports the enumeration. The v1 shape
(competitive-lanes.md §C2 Niche Definition: SAST/SCA/container gates at
per-repo/flat pricing) decomposes into: repo integration under the customer's own
authorization (gate verdict C2 G5), scan orchestration over existing open-source
engines (§C2 Gap 3 documents the OSS baseline — mature engines exist, weak in team
UX and support, which is precisely the layer we would build), results
normalization/dedup, a triage UI, and billing. No component requires research; the
differentiating layer — predictable pricing and small-team UX against the
documented minimum-seat cliffs (§C2 Gaps 1–2: Snyk 5-dev minimum at $1,500/yr
entry, GitHub Advanced Security per-committer unpredictability) — is product
surface, not deep tech. Dollars are ~$0 beyond board-approvable hosting (gate
verdict C2 G4). The reason this is a 4 and not a 5 is my carried co-sign item
(03-gate-verdicts.md signature block): OSS scanner *license compatibility with
hosted commercial use* is unvetted. The engine set is not interchangeable —
permissively-licensed engines and their rule/vulnerability-DB content carry
different terms, some rulesets restrict commercial redistribution, and the vet
constrains which engines the build may lean on. That is bounded legal/engineering
work, not spend, but until it is done the "OSS baseline exists" premise is a claim
about *software* that has not been verified as a claim about *licenses*. Evidence
gap noted for honesty (00-longlist.md §C2): small-team current spending is unknown —
that is Carla's C1 problem, not a build-cost problem, and it does not move this
score. Enumerable scope, existing engine baseline, one unvetted licensing
dependency: 4.

### C3 (Cost to operate forever): **3**

The per-unit economics are decent but not near-zero: every customer commit/PR
triggers compute, so delivery cost scales with customer activity rather than seat
count — bounded and cacheable, but it must be measured against the <$100/repo/mo
product shape (§C2 Niche Definition), not assumed away. What actually caps this
score is the standing-obligation profile, which is heavier than generic SaaS in
three specific ways. One: a security scanner carries a permanent currency
obligation — vulnerability DBs and rulesets must track new CVEs continuously, or
the product silently becomes worthless; this is automatable (upstream OSS DBs
update daily) but it is an SLA we hold forever. Two: tenancy risk is asymmetric —
the product holds read authorization into customers' source repositories (gate
verdict C2 G5's "their own authorization" is exactly the sensitive part), so our
own security posture becomes part of every customer's threat model; a breach of us
is a breach of them. For a security *product* that is an existential, not
cosmetic, standing obligation. Three: support in this category is false-positive
triage — §C2 Gap 3 notes OSS tools are "immature in UX for non-security teams,"
and the labor of making scanner output tolerable is recurring, not one-time.
Agent-workforce hypothesis, labeled: DB currency and FP-tuning are well-shaped
agent work (mechanical, text-based, feedback-rich), and if that holds this
candidate operates unusually cheaply — but it is unmeasured, so it earns no
discount today. Good marginal economics, three real standing obligations: 3.

### Spike must test (if finalist)

1. The license vet, concretely (my carried item): a named engine + ruleset + vuln-DB
   set cleared for hosted commercial use, in writing, before any C2 score cites
   "OSS baseline" again.
2. Measured scan compute cost per repo-day on representative small-team repos,
   against the <$100/repo/mo shape.
3. Out-of-the-box false-positive rate on real repos — the proxy for permanent
   triage/support burden.
4. Integration-layer feasibility at $0: platform app permissions, rate limits, and
   a token-custody design whose blast radius we can state precisely.

---

## Candidate C3 — Construction Permit & Compliance Data Aggregation

### C2 (Cost to build v1): **2**

The build is a data-engineering program whose dominant cost driver is *per-source
integration effort multiplied by an unknown*, and the unknown is exactly the thing
I flagged at co-sign. The evidence establishes fragmentation vividly —
competitive-lanes.md §C3 Data Fragmentation: ~19,000 jurisdictions, each with its
own portal and format — and the product shape requires 100–500 of them (§C3 Niche
Definition). But per constraint 5 (03-gate-verdicts.md), which I attached because
the evidence file documents the fragmentation *without ever establishing free
programmatic access*: v1 is restricted to jurisdictions with free public portals
whose terms permit automated collection, and portal accessibility is unevidenced
until measured. So the build cost is: N bespoke scrapers (heterogeneous formats,
anti-automation measures unknown, an unknown fraction of portals behind
third-party vendor systems whose terms may exclude them from the $0 path), plus a
normalization schema across all of them, plus pipeline and API/dashboard — where N
must be large enough that a compliance team pays $200–500/mo (§C3 Product shape)
against incumbents advertising 300–400M+ permit records (§C3 Incumbent Tiers 3–4),
and the minimum revenue-worthy N is itself unknown (00-longlist.md §C3 labeled
gaps: coverage requirements and small-firm usage both unvalidated). Agent-workforce
hypothesis, labeled: writing many small scrapers in parallel is plausibly the best
fit in this whole portfolio for an agent workforce, and if jurisdictions/agent-tick
is high this score is wrong in the cheap direction — but that rate has never been
measured, and per rubric §3 I do not score hypotheses as discounts. Calendar-heavy
build, unevidenced access premise, unknown minimum viable coverage: 2.

### C3 (Cost to operate forever): **2**

The operating profile is the build cost made permanent. Scrapers against municipal
portals break as portals change, and they change without notice or contract — with
100–500 integrations (§C3 Product shape) the standing maintenance obligation
scales linearly with the coverage that makes the product sellable in the first
place; unlike candidate C2's engine layer, there is no upstream OSS community
maintaining these integrations for us — every one is ours forever. Compliance
users buy *freshness and correctness* (the §C3 job-board evidence — 1,000+
compliance officer postings at $61k–172k — signals pain precisely because stale or
wrong permit data has professional consequences for the buyer), so data-quality
support and update-frequency commitments are core delivery obligations, not
nice-to-haves; note that incumbents conspicuously do not publish update-frequency
SLAs (§C3 Gap 4), which I read as evidence the obligation is expensive. Two
structural risks compound over time under constraint 5: portals can add
anti-automation measures, and jurisdictions can migrate onto vendor platforms
whose terms remove them from the $0 path — either erodes coverage or forces
board-gated paid access. The pure serving cost (API/dashboard over a database) is
genuinely cheap; it is the upstream obligation that dominates. Agent-workforce
hypothesis, labeled, and worth stating fairly: scraper *repair* is mechanical,
well-scoped, feedback-rich work — the single strongest case in this portfolio for
agents bending an operating-cost curve — and if a spike measures a high
autonomous-repair rate, this score should be revisited upward in the debate with
data on the table. Today it is unmeasured: 2.

### Spike must test (if finalist)

1. Constraint 5 head-on (this is the non-negotiable one, per my co-sign): real
   jurisdictions scraped at $0 within the spike tick — measuring portal
   accessibility, ToS compatibility, anti-automation friction, and
   jurisdictions-per-agent-tick as a rate.
2. Normalization effort across the sampled formats — how much schema survives
   contact with the second and tenth jurisdiction.
3. The agent-repair hypothesis: induce/observe breakage and measure autonomous
   repair rate, the input the C3 score most depends on.
4. Minimum viable coverage for a paying buyer (joint with Carla's C1 evidence: what
   N jurisdictions makes $200–500/mo credible against incumbents' claimed
   footprints).

---

## Candidate C4 — Workflow Automation for Recurring Compliance & Audit (mid-market)

### C2 (Cost to build v1): **2**

Two of the three build layers are cheap for us and one is structurally expensive —
and the evidence gap sits exactly on the layer that decides scope. The
differentiating layer is well-evidenced and buildable: audit logging, change
control, RBAC — the governance depth Zapier/Make demonstrably lack
(competitive-lanes.md §C4 Gaps 1–2 and Gap 4: basic task-level logging, weak
change control, audit features locked behind undisclosed enterprise pricing) at
the $200–500/mo shape the RPA tier prices out of reach (§C4 Gap 3: Blue Prism
$75k+/yr, UiPath $420/mo developer minimum). A workflow engine with real audit
semantics is honest, bounded engineering. The expensive layer is connectors: an
automation product delivers nothing until it reaches the customer's actual
systems, incumbent value lives in integration breadth, and connector count is the
classic long-tail build cost. Which connectors does v1 need? The evidence cannot
say: 00-longlist.md §C4 labels "specific workflow examples not validated" and
competitive-lanes.md §C4 tick-2 concedes no direct evidence that mid-market
compliance teams even seek Zapier alternatives versus custom scripts or manual
process. I cannot scope a v1 whose defining use case is unvalidated, and per rubric
§3 an unscopeable build cannot score well on cost-to-build: the honest reading is
"engine in a handful of ticks, revenue-capable product at an unknown multiple of
that." Dollars stay ~$0 (gate verdict C4 G4 — commodity hosting; SOC 2 and the
like are post-revenue, and they land in my C3 below). Cheap core, unpriceable
integration surface, unvalidated use case: 2.

### C3 (Cost to operate forever): **2**

The pitch of this candidate — *your recurring compliance runs happen, on time,
with an audit trail* — is precisely the obligation that makes it expensive to
operate forever. First, reliability is the product: a missed or silently failed
scheduled run is not an inconvenience, it is the customer's audit gap, so the
standing bar is high-consequence scheduled execution with detection and
notification of every failure — heavier than uptime for a dashboard. Second,
connector maintenance is permanent and linear: every integration tracks a
third-party API that changes on someone else's schedule (the same structural shape
as candidate C3's scraper burden, with better-documented upstreams). Third, the
compliance positioning boomerangs: a vendor selling audit-grade governance will be
asked for its own attestations — gate verdict C4 G4 records SOC 2-class
certification as a post-revenue cost, and post-revenue does not mean small; it is
a recurring audit apparatus (evidence collection, control operation, annual
renewal) that lands on the operating side of the ledger permanently. Fourth,
support: mid-market compliance and ops teams (§C4 Niche Definition) are not
developers; workflow construction hand-holding is recurring delivery work.
Agent-workforce hypothesis, labeled: connector upkeep and support are plausible
agent work, unmeasured, no discount. Raw compute per workflow run is trivial — and
is the only cheap line in the profile: 2.

### Spike must test (if finalist)

1. Scope precondition, stated plainly: a build spike measures the wrong thing until
   Carla-side validation names 2–3 concrete recurring workflows real teams run
   (00-longlist.md §C4 gap). Sequence the spike after that, or it produces a
   number about an imaginary product.
2. Engine + audit-log core plus exactly two connectors in the spike tick — to
   measure the *marginal cost per connector*, the variable the C2 score turns on.
3. Failure-detection semantics: demonstrate a missed-run detection/notification
   path, the minimum credible reliability story for a compliance buyer.
4. A dated estimate of the SOC 2-class recurring cost (audit fees + evidence
   tooling) for the step-3 debate — it is the largest fixed operating line and it
   is currently uncosted.

---

## Score summary (raw, unranked, unweighted — 2 of 5 criteria only)

| Candidate | C2 (build v1) | C3 (operate forever) |
|---|---|---|
| C1 Micro-credentials | 3 | 3 |
| C2 Code quality gates | 4 | 3 |
| C3 Construction permit data | 2 | 2 |
| C4 Compliance automation | 2 | 2 |

These two columns are my signed domain and nothing more. No ranking is expressed
or implied; three criteria (C1 revenue path, C4 time to first dollar, C5 legal
surface) are Carla's signed domain and are absent here by design (rubric §1.3).
Per rubric §1.4, finalists get a one-tick, $0 spike to replace the estimates above
with measurements before the step-3 debate cites them.

## Signature

A signature below means: "These 8 scores and rationales are mine alone, scored on
evidence in hand under the signed rubric definitions, with the binding gate
constraints applied, agent-workforce effects treated as hypotheses, and every
unmeasured claim flagged for spike validation."

- **Owen Kessler, CTO** — SIGNED, 2026-08-31. D-lane C2/C3 scores (D1–D5) next
  tick, where the BAA verification (constraint 6) and non-custody rails
  (constraint 7) get priced into the rationales.

---
---

# Part II — CTO Scores: C2 (Cost to Build v1) & C3 (Cost to Operate Forever) — Demand Lanes D1–D5

**Status:** SIGNED — 10 scores (2 criteria × 5 candidates), CTO domain per rubric §1.3. With Part I above, my scoring domain is complete: 18 signed scores across all 9 surviving candidates.
**Owner:** Owen Kessler, CTO (sole signer; per rubric §1.3 the CEO neither edits nor pre-approves these scores; disagreement goes to the step-3 written debate)
**Rubric:** docs/strategy/01-selection-criteria.md §3 — C2 and C3 definitions as signed; scale 1–5; every score carries a written rationale citing evidence, or it is void
**Evidence basis:** docs/strategy/evidence/demand-lanes.md (Nadia Okonkwo, D1–D5), docs/strategy/evidence/competitive-lanes.md Tick-2 D-lane sections (Elliot Kwan), docs/strategy/evidence/00-longlist.md (final long-list, labeled gaps), docs/strategy/03-gate-verdicts.md (binding constraints, incl. my co-sign constraints 6–7 and the 2026-08-30 BAA verification)
**Scope:** The five demand-lane candidates only. No ranking, no recommendation; these are 2 of 5 criteria and Carla's C1/C4/C5 are absent by design.

## Method notes (in addition to Part I notes 1–5, which apply unchanged)

6. **Constraint 6 is priced in, not waved at (D2, D5).** BAA-before-PHI (03-gate-verdicts.md,
   constraint 6, verified by me against primary sources 2026-08-30): every component that
   touches PHI/regulated data — host, database, email, SMS, transcription, logging,
   backups — requires an executed BAA before the first regulated byte, and the enabling
   spend is a board-approval event that *precedes* PHI, not first revenue. My verification
   findings are evidence and are cited as such: AWS signs a HIPAA BAA self-serve at $0
   (AWS Artifact); DigitalOcean, our default host, signs on a covered-product set
   conditional on a Standard/Premium support subscription. Consequence for scoring: the
   *dollars* are proportional (a percentage premium, not a wall), but the *engineering
   floor* (Security Rule-grade controls in v1) is mandatory scope, and both land in C2/C3
   below honestly.
7. **Constraint 7 is an architecture, not a caveat (D1, D3).** Never a payee, never an
   aggregator of receipts, never in the flow of funds (03-gate-verdicts.md, constraint 7).
   Both candidates' payment features are scored as builds on licensed processor
   connected-account rails — client money settles to the customer's own processor account;
   we compute, we never hold. The integration cost of those rails, and the permanent
   design-review obligation of keeping the boundary intact, are priced into the scores.
8. **Naming collision, again, for the record:** criteria C2/C3 (build/operate) share names
   with two competitive-lane candidates scored in Part I. In Part II every candidate is
   D-numbered, so "C2" and "C3" below always mean the criteria.

---

## Candidate D1 — Freelance Writers & Content Creators (invoice/contract automation)

### C2 (Cost to build v1): **4**

This is the most conventional build in the nine-candidate portfolio. The evidenced v1
shape — invoicing, contract templates, payment tracking, late-payment reminders
(demand-lanes.md §D1 Product shape, narrowed by the researchers' own Tick-2 Gap Closure
to invoice/contract automation with usage-rights as a bundled secondary feature, not a
standalone product) — decomposes into small-account CRUD, document templating, and
scheduled notifications: no media pipeline, no regulated data, no third-party data
dependency. Dollars are ~$0 (gate verdict D1 G4: board-approvable hosting; processor
fees revenue-contingent). The payment feature is scored under constraint 7 as a
connected-account build: client payments settle directly to the freelancer's own
processor account, we are never a payee — the rails are documented commodity
integrations, but the invariant has a real read-side cost (payment status must come from
processor webhooks on accounts we do not own, and the no-custody boundary must be
designed in from the first line, not retrofitted). Two things hold this off a 5. First,
template provenance: the G3 constraint (templates stay self-serve documents, never legal
advice) means v1 needs credible contract-template *content*, and none of the evidence
says where it comes from — drafting or licensing it is either bounded board-gated spend
or lawyer-agent work, currently unscoped (it also touches Carla's C5 domain; I price
only the build-cost side here). Second, the evidenced market gap is a $15–30/mo
self-serve tier against Wave-free and FreshBooks-$49–99 (competitive-lanes.md §D1
Gap 3, demand-lanes.md Tick-2 Pattern 1), which means self-serve onboarding and billing
polish *are* the product, not an afterthought — the revenue-capable floor includes them.
Enumerable scope, commodity components, two bounded unknowns: 4.

### C3 (Cost to operate forever): **4**

Marginal delivery cost is near zero — small structured text data, no media, no metered
third-party cost in the core loop — and the data held is ordinary business PII, not
regulated. The standing obligations are real but light. One: deliverability. The
product's headline value is late-payment reduction (demand-lanes.md §D1: 85% of
freelancers experience late payments; 61% of late payments attributed to invoice
errors), and that value rides entirely on reminder emails landing in inboxes — sender
reputation and bounce management are permanent operations, and a silent deliverability
degradation is a silent product failure. Two: the processor integration tracks a
third-party API forever, and constraint 7's boundary must survive every future payment
feature — a permanent design-review obligation, cheap but non-optional. Three: template
currency — contract norms and platform terms drift, so the template library is recurring
content maintenance, not a one-time asset. Four, the economics of the segment: at the
evidenced $15–30/mo gap price the business is many small self-serve accounts, so
per-account support must round toward zero for the margin to hold. Agent-workforce
hypothesis, labeled per method note 2: support and template maintenance here are
text-heavy, asynchronous, procedural — plausibly good agent work — but unmeasured, so no
discount today. Light obligations, one deliverability SLA, thin-but-clean unit
economics: 4.

### Spike must test (if finalist)

1. Constraint 7 end-to-end on a real processor sandbox: invoice issued → client pays →
   funds settle to the freelancer's own connected account, with us provably outside the
   flow — measuring integration effort, the freelancer-side onboarding friction the
   processor imposes, and webhook-based payment-status fidelity.
2. Template provenance and cost: identify where legally credible self-serve templates
   come from and what lawyer-agent review costs (joint with Carla's C5 — her legal-surface
   score and my build cost share this unknown).
3. Reminder deliverability path: domain/sender reputation setup and measured inbox
   placement for dunning-style email; determine whether SMS is needed at all in v1.

---

## Candidate D2 — Solo Therapists & Coaches (lightweight HIPAA practice management)

### C2 (Cost to build v1): **2**

The conventional core — scheduling, progress notes, secure messaging, no billing in v1
(demand-lanes.md §D2 Product shape) — is a handful of ticks of ordinary engineering.
What makes this a 2 is that with PHI, the compliance floor is v1 scope *by law*, and the
evidenced differentiator is the hardest single component in the D-set. Constraint 6
binds (my co-sign, verified 2026-08-30): every component — host, database, email, SMS
reminders, transcription, logging, backups — needs an executed BAA before the first byte
of PHI, and the enabling spend precedes development with real data as a board-approval
event. The dollars are genuinely proportional (AWS BAA $0 self-serve via Artifact; DO
conditional on a Standard/Premium support tier over its covered-product set — my primary-
source findings), but the engineering floor is not small: Security Rule controls —
encryption, access controls, audit logging, backup/recovery, documented risk analysis —
cannot be fast-follows, because the buyer's entire reason to pay us is that we got this
right where generic tools fail (demand-lanes.md §D2: Otter.ai HIPAA-compliant only on
Enterprise-with-BAA; therapists' documented liability fears). Then the differentiator:
AI note assist with speaker separation for couples/group therapy (§D2 Product shape),
whose incumbent failure mode — hallucinated clinical language in multi-speaker settings
(§D2 Tier 2, Reddit r/therapists) — is exactly a clinical-liability bar. It must run
inside the BAA envelope, its achievable quality is unmeasured, and it is the component
where the evidence says willingness-to-pay concentrates ($35–40/mo AI add-ons actively
bought, §D2 Tier 1) — so a cheaper AI-less v1 exists but sheds the evidenced premium.
Conventional core, mandatory compliance floor, one hard unmeasured component: 2.

### C3 (Cost to operate forever): **2**

The permanent obligations here *are* the business. First, the HIPAA apparatus runs
forever: risk analyses, audit-log operation, breach-notification readiness, and BAA
management across every vendor in the chain — constraint 6 applies to every component we
ever add, which permanently constrains vendor choice and adds diligence to every
architectural change. Second, the enabling spend recurs: regulated hosting carries the
documented 20–40% premium (demand-lanes.md §D5 Tick-2 evidence, cited by the D2 gate
verdict) plus the support-tier or equivalent recurring cost from my BAA verification.
Third, per-unit cost: AI transcription compute per session against a sub-$50/mo target —
the wedge the competitive evidence defines is precisely undercutting SimplePractice's
~$85–90/mo-with-AI real price (competitive-lanes.md §D2 Gap 1) — is a real margin line
that needs measurement, not assertion. Fourth, tenancy risk is existential asymmetry:
we would hold therapy notes, so a breach of us is a reportable clinical-privacy event
for every customer simultaneously. Fifth, the switching-cost evidence cuts both ways:
incumbents' lock-in (real cost 8–10x advertised, migration friction, §D2 Tick-2 Gap
Closure) is our opportunity *and* our onboarding burden — every won customer arrives
expecting data migration help (evidenced at 1–2 hours of support effort per switch).
Availability matters at practice-day granularity: a solo practice runs its day on
scheduling and notes. Agent-workforce hypothesis, labeled: BAA tracking, audit review,
and migration assistance are procedural text work plausibly suited to agents —
unmeasured, no discount. Heavy standing apparatus, real per-unit cost, existential
breach asymmetry: 2.

### Spike must test (if finalist)

1. The BAA chain, enumerated and priced for the board: every v1 component mapped to a
   named BAA-covered service, with the enabling spend quoted (AWS $0 baseline vs. DO
   covered-products + support tier) — a dated document, since terms shift; this is the
   constraint-6 board-approval package, prepared before any PHI exists.
2. AI notes inside the BAA envelope: measure transcription + speaker-separation quality
   on representative multi-speaker audio using only BAA-covered services, against a
   pre-stated kill criterion — if quality sits below the clinical-liability bar, v1 ships
   without AI and the pricing/positioning consequence goes back to Carla's C1 evidence.
3. Security Rule floor, sized by building it: stand up the audit-logging +
   access-control + encrypted-storage core in the spike tick and measure how much of the
   control set is genuinely v1-mandatory scope.
4. Migration import: parse real SimplePractice/TherapyNotes export formats — the
   switching-cost evidence says migration is the adoption path, so its per-customer cost
   is a C3 input, not a nice-to-have.

---

## Candidate D3 — Independent Musicians & Sound Creators (multi-DSP royalty aggregation & splits)

### C2 (Cost to build v1): **3**

The build decomposes into four parts of very different certainty. Per-source ingestion
is the dominant unknown: royalty data must come in from distributors, DSP artist
portals, PROs, and the MLC, each with its own undocumented, changeable report format —
structurally the same shape as candidate C3's scraper program, but an order of magnitude
smaller and friendlier: a solo artist's money flows through a handful of sources, not
hundreds (demand-lanes.md §D3 Tier 1: DistroKid, CD Baby, RouteNote, Symphonic dominate
the paid-behavior evidence), and the data arrives as the artist's *own* exports or
authorized access (gate verdict D3 G4), not adversarial scraping. The unresolved part is
exactly what the gate verdicts flagged: per-source access method (export upload vs.
authorized API vs. portal automation) is unevidenced, and it swings per-source build
effort by multiples. Split accounting is arithmetic — cheap. Payout initiation is a
constraint-7 build: splits computed by us, executed from the artist's own
processor-managed connected account, us never in the flow — documented rails, bounded
integration, same invariant cost as D1. The metadata audit tool runs against public
matching data, and the evidence says the target is real ($424M unmatched black-box
royalties at the 2021 transfer; ~$160M pre-2021 still unmatched as of June 2026,
competitive-lanes.md §D3 Gap 2). The revenue-capable floor is coverage: at the evidenced
$10–50/mo consumer price point — a gap the tick-3 reconciliation confirmed is genuinely
unserved (no consumer solo-artist unified dashboard exists there; Trqk/Curve/Stem serve
the label side, 00-longlist.md §Critical Tick-3 Reconciliation) — the dashboard must
cover enough of an artist's sources that "unified" is true. Small N, cheap dollars, one
effort-multiplying unknown: 3.

### C3 (Cost to operate forever): **3**

The standing obligation is parser and integration maintenance against upstreams that
owe us nothing: distributor and DSP report formats change without notice or contract,
and every format is ours to maintain forever — candidate C3's scraper burden at perhaps
a tenth the source count, but with a sharper correctness bar, because this is people's
money. The product's one job is that our numbers reconcile with the artist's statements;
a silent format change that miscounts royalties is the worst failure mode in this
candidate's profile, and support in this category is data-dispute triage ("your
dashboard disagrees with my DistroKid statement") — recurring, trust-critical, and
arriving at consumer price points where per-account margin is thin. The payout path adds
two permanent lines: the processor integration tracks someone else's API schedule, and
constraint 7's boundary (never a payee, never an aggregator of receipts, never in the
flow of funds) must survive every future feature — a standing design-review obligation I
price as cheap but mandatory. Pure serving cost is trivial: small structured data, no
media. Agent-workforce hypothesis, labeled: parser repair on format drift is mechanical,
well-scoped, feedback-rich — alongside candidate C3's scraper repair, the strongest
agent-fit case in the portfolio — and if a spike measures a high autonomous-repair rate
this score should be revisited upward in the debate with data on the table; today it is
unmeasured, no discount. Modest source count, permanent format churn, money-grade
correctness bar: 3.

### Spike must test (if finalist)

1. Ingestion reality, measured: parse real royalty reports from the top sources
   (DistroKid, CD Baby, Spotify for Artists export, MLC statement) in the spike tick —
   per-source parser effort, format stability, and the N needed to cover ~80% of a
   representative solo artist's income.
2. Per-source access terms: export-upload vs. authorized-API vs. portal-automation,
   with the ToS answer recorded per source (joint with Carla's C5 — the gate verdicts
   flagged data-access terms as a legal-surface question; it is also my build multiplier).
3. Constraint 7 payout architecture on a real processor's connected-account sandbox:
   splits executed from the artist's own account to collaborators, with us demonstrably
   outside the flow of funds at every step.
4. Metadata audit match rate: run a real catalog against public MLC/PRO matching data
   and measure hit rate — the feature's value claim depends on it.

---

## Candidate D4 — Small Event Organizers (RSVP + no-show reduction + vendor coordination)

### C2 (Cost to build v1): **4**

Every component is commodity: RSVP pages, an attendee CRM, scheduled email/SMS
reminders, vendor checklists, a budget tracker (demand-lanes.md §D4 Product shape). No
regulated data, no payment custody in the evidenced v1 shape (we are not ticketing —
transaction-fee ticketing is Eventbrite's model, and its fee pain on free events is the
competitor's weakness, competitive-lanes.md §D4 Gap 3, not our obligation), and dollars
are ~$0 plus metered SMS (gate verdict D4 G4: small, metered, largely
revenue-contingent). The evidence even hands the product its proof mechanism: 30–50%
no-show rates on free events with analyst evidence that reminder automation cuts free-
event no-shows to ~10–15% (§D4 Tier 2 and Tier 4) — a measurable claim a v1 can be built
to demonstrate. Two things hold this off a 5. First, SMS is not free plumbing: US
carrier sender registration, consent capture, and opt-out handling must work on day one
— reminders *are* the product, and the SMS consent/compliance rules the gate verdict
routed to C5 (competitive-lanes.md §D4 Gap 1 context) still have a build-cost shadow —
bounded, well-trodden, but mandatory scope. Second, the anomaly log's finding that D4
may be two products — no-show reduction vs. vendor logistics, with different buyers and
price points (competitive-lanes.md Tick-2 Anomaly #4) — is a real scope fork: a v1 that
builds both halves is bigger than the evidence justifies, and which half is the wedge is
a demand question (Carla's C1 domain), so I price the ambiguity, not a guess. Commodity
surface, one compliance-shaped integration, one unresolved scope fork: 4.

### C3 (Cost to operate forever): **4**

The one line that separates this from pure-CRUD economics is SMS: every active customer
consumes metered messages, so per-unit delivery cost is real, small, and must be
measured against the $30–100/mo band the competitive evidence identifies as the unserved
sweet spot (competitive-lanes.md §D4 Gap 1: Meetup under-delivers automation, Eventbrite
Premium and Splash overshoot on price). Standing obligations are moderate: sender
reputation and deliverability across both SMS and email (an undelivered reminder is a
silent product failure, same shape as D1's obligation with a second channel);
punctuality of scheduled sends — consequence is organizer embarrassment and churn, not
an audit gap or a breach, so the reliability bar is ordinary-SaaS-plus-cron-discipline,
not candidate-C4's high-consequence execution; consent/opt-out processing forever; and
event-day traffic spikes, which are bursty but small at this segment's scale. Support is
self-serve solo organizers, and the 73%-upgrade-within-90-days evidence (§D4 Tick-2 Gap
Closure) suggests customers onboard themselves when the pain is acute. Agent-workforce
hypothesis, labeled: deliverability monitoring and organizer support are routine,
text-based, agent-shaped work — unmeasured, no discount. Ordinary obligations plus one
metered cost line: 4.

### Spike must test (if finalist)

1. The SMS path end-to-end: carrier sender registration (timeline and cost — it is the
   long pole in SMS onboarding), consent capture, opt-out handling, and measured
   per-event message cost against the $30–100/mo price band.
2. The product's own proof: a reminder-sequence design whose no-show delta is
   measurable per event — if the headline claim (30–50% → 10–15%) can't be demonstrated
   from our own data, the value proposition is an assertion.
3. The two-product fork (Anomaly #4): spike RSVP + reminders only, and test whether
   vendor/budget features are required for credibility — joint with Carla's C1 evidence
   on which half the buyer actually pays for.

---

## Candidate D5 — Research Teams, Academic/Nonprofit (secure data collaboration with audit logging)

### C2 (Cost to build v1): **2**

Three expensive axes intersect in this build: it is storage-centric, federated, and
regulated. The v1-mandatory scope per the evidence: granular project-based access
controls, audit logging, dataset versioning, and multi-institutional collaboration
(demand-lanes.md §D5 Product shape) — and "multi-institutional" is not a checkbox but
the product's defining property: the buyer's collaborators authenticate through their
*own* institutions, so identity federation (SAML/campus SSO) lands in v1, precisely the
layer the competitive evidence identifies as incumbent friction (per-institution manual
permission setup, DUA/IRB governance — competitive-lanes.md §D5 Gap 2). Constraint 6
applies in full, because the HIPAA/FERPA-aligned posture is the selling point (gate
verdict D5 G3): a BAA-covered chain before the first regulated byte, board-gated
enabling spend, and Security Rule-grade controls as day-one scope — D2's compliance
floor, sitting on a much heavier data plane (research-scale datasets, versioning,
egress). My BAA verification says the vendor path exists at proportional dollars (AWS $0
self-serve; DO conditional on support tier over its covered-product set) — so, as with
D2, the engineering floor rather than the BAA fee is the cost. What finally caps this at
2 is the same disease as candidate C4: the labeled Tier-1 gap (00-longlist.md §D5:
small-team <$50K-budget spending unvalidated, no confirmed board intros) means nobody
can yet say what feature floor a $100–200/mo research team accepts against Box at
~$100/mo/team (competitive-lanes.md §D5 Gap 1) — and per rubric §3 an unscopeable
revenue-capable release cannot score well on build cost. Heavy mandatory floor, three
expensive axes, unvalidated scope boundary: 2.

### C3 (Cost to operate forever): **2**

Four permanent lines, each heavier than generic SaaS. One: per-unit delivery cost is
storage plus egress on research-scale datasets, served from regulated infrastructure
carrying the documented 20–40% HIPAA premium (demand-lanes.md §D5 Tick-2) — against a
price the evidence says must land under ~$200/mo to reach $10–50K-budget teams
(competitive-lanes.md §D5 Gap 1), and with versioned datasets and append-only audit
trails the stored bytes grow monotonically, so cost per customer *rises with tenure*;
whether the margin survives is unmeasured and could be the whole story. Two: the
compliance apparatus is permanent, as in D2 — Security Rule operations, BAA management
across the chain, breach readiness — with FERPA obligations alongside. Three: durability
is the existential obligation, and it is worse than D2's: we would hold researchers'
*primary datasets* — irreplaceable originals, not a re-scrapable cache or a reconstructible
ledger — so backup, recovery, and integrity verification are the top-tier standing
commitment; losing a dataset is unrecoverable harm to the customer. Four: support is
multi-institutional governance — onboarding means per-institution identity setup and
access-policy mediation (competitive-lanes.md §D5 Gap 2), recurring, high-touch, with
non-commercial buyers on academic timelines. Agent-workforce hypothesis, labeled:
governance paperwork, onboarding runbooks, and audit-log review are plausible agent
work — unmeasured, no discount. Rising per-unit cost curve, permanent compliance
apparatus, irreplaceable-data custody: 2.

### Spike must test (if finalist)

1. Sequencing precondition, same logic as candidate C4's: the labeled Tier-1 gap means a
   build spike measures an imaginary product until Carla-side validation establishes what
   small research teams actually use and pay today (00-longlist.md §D5 gap; no confirmed
   board intros — sourcing them is a step-2b prerequisite). Sequence the spike after
   that.
2. Regulated reference architecture, priced: a named BAA-covered storage/compute/
   logging/backup chain with the 20–40% premium made concrete in dollars at
   representative dataset sizes — storage + egress margin computed against the
   sub-$200/mo shape. This is also the constraint-6 board-approval package.
3. Identity federation effort, measured: stand up SAML federation against at least one
   real institutional IdP flow in the spike tick — the multi-institutional layer is the
   product, so its integration cost cannot stay an estimate.
4. Versioning + audit at realistic file sizes: measure dataset-versioning storage
   amplification and audit-trail growth on research-scale files — the input the
   rising-cost-curve claim in my C3 rationale most depends on.

---

## Part II score summary (raw, unranked, unweighted — 2 of 5 criteria only)

| Candidate | C2 (build v1) | C3 (operate forever) |
|---|---|---|
| D1 Freelancer invoicing/contracts | 4 | 4 |
| D2 Solo-therapist HIPAA practice mgmt | 2 | 2 |
| D3 Musician royalty aggregation | 3 | 3 |
| D4 Event RSVP/no-show | 4 | 4 |
| D5 Research secure data collab | 2 | 2 |

With Part I, all 18 scores in my signed domain (2 criteria × 9 candidates) now exist.
No ranking is expressed or implied — these two columns are unweighted inputs, three
criteria per candidate are Carla's signed domain and absent by design (rubric §1.3),
and per rubric §1.4 finalists get a one-tick, $0 spike to replace these estimates with
measurements before the step-3 debate may cite them as validated.

## Part II signature

A signature below means: "These 10 scores and rationales are mine alone, scored on
evidence in hand under the signed rubric definitions, with binding gate constraints 6
(BAA-before-PHI, enabling spend board-gated and pre-PHI) and 7 (never in the flow of
funds) priced into the rationales rather than footnoted, agent-workforce effects
treated as hypotheses, and every unmeasured claim flagged for spike validation."

- **Owen Kessler, CTO** — SIGNED, 2026-08-31. My scoring domain is complete: 18 signed
  scores (C2/C3 × C1–C4, D1–D5). Carla's C1/C4/C5 columns complete the matrix; nothing
  is rankable until they exist, and not by me even then — ranking belongs to the step-3
  written debate.
