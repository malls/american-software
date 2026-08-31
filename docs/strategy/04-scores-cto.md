# CTO Scores: C2 (Cost to Build v1) & C3 (Cost to Operate Forever) — Competitive Lanes C1–C4

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
