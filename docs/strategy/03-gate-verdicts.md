# Gate Verdicts: Hard-Constraint Gates G1–G5 (Step 2 → 3)

**Status:** SIGNED by CEO and CTO — gate verdicts bind both cofounders; scoring open per rubric §1.3
**Rubric:** docs/strategy/01-selection-criteria.md §2 — gates are pass/fail constraint checks applied BEFORE any scoring; a FAIL is terminal for the candidate this cycle; no revenue number launders a gate failure.
**Evidence basis:** docs/strategy/evidence/00-longlist.md (final long-list, 9 candidates), docs/strategy/evidence/demand-lanes.md (D1–D5), docs/strategy/evidence/competitive-lanes.md (C1–C4 + D-lane competitive positioning).
**Evaluated:** 2026-08-30, by Carla Voss (CEO), per the process green-lit in #board msg 117.

## How to read this document

1. Gates test constraints, not quality: no physical inventory (G1), no physical space (G2), lawful and licensable by an agent workforce (G3), survivable under the all-purchases-board-approved spend regime (G4), no interference with existing GitHub repositories or Digital Ocean services (G5).
2. A PASS here says nothing about attractiveness. Every concern that is a matter of degree — legal *burden*, build cost, data-acquisition cost, evidence gaps — goes to scoring (C1–C5), where it belongs. Gates only ask: is the business possible for us at all, as constrained?
3. Where a candidate's evidenced product shape includes an element that WOULD fail a gate (custody of client funds), the verdict records the binding constraint that excludes it. That constraint carries forward into scoring and any eventual build as a hard boundary, not a preference.

---

## C1 — Micro-Credential Platforms for Mid-Market Upskilling (50–500 person firms)

1. **G1 (No inventory): PASS** — A hosted LMS with micro-credential issuing (competitive-lanes.md §C1 Niche Definition) is pure software with zero physical goods.
2. **G2 (No space): PASS** — Delivery is all-digital SaaS to distributed mid-market firms; no premises required (competitive-lanes.md §C1 Product shape).
3. **G3 (Lawful/licensable): PASS** — Issuing non-accredited micro-credentials and hosting training content is unregulated commercial software, requiring no license or certified status (competitive-lanes.md §C1: incumbents are ordinary SaaS vendors).
4. **G4 (Spend-gate survivable): PASS** — A v1 LMS is buildable by the agent workforce on commodity hosting with no mandatory pre-revenue purchase beyond board-approvable infrastructure (competitive-lanes.md §C1: incumbents' costs are sales/content-driven, not capital-driven).
5. **G5 (Non-interference): PASS** — A greenfield product touching only customers' own accounts; no contact with our existing GitHub repositories or Digital Ocean services.

**C1 gate result: PASS (5/5).** Concerns forwarded to scoring: willingness-to-pay at the $5–15/user/mo target tier is a labeled gap (00-longlist.md §C1 Evidence Completeness) — a C1-criterion input, not a gate matter.

## C2 — Lightweight Code Quality Gates for Small Dev Teams (2–20 devs)

1. **G1 (No inventory): PASS** — Code scanning (SAST/SCA/container) is delivered entirely as software (competitive-lanes.md §C2 Niche Definition).
2. **G2 (No space): PASS** — Cloud-delivered developer tooling; no physical premises in the delivery chain (competitive-lanes.md §C2 Product shape).
3. **G3 (Lawful/licensable): PASS** — Selling security scanning software requires no license, certification, or regulated status; incumbents (Snyk, GitLab) operate as unregulated SaaS (competitive-lanes.md §C2 Pricing & Packaging Evidence).
4. **G4 (Spend-gate survivable): PASS** — v1 can be built on open scanning engines plus our own analysis layer with only board-approvable hosting spend; no gate-breaking mandatory purchase before revenue (competitive-lanes.md §C2 Gap 3: OSS baseline exists).
5. **G5 (Non-interference): PASS** — The product integrates with *customers'* repositories via their own authorization; it neither touches nor modifies our existing GitHub repositories or Digital Ocean services.

**C2 gate result: PASS (5/5).** Concerns forwarded to scoring: small-team current-spend evidence is indirect (00-longlist.md §C2 Evidence Completeness).

## C3 — Construction Permit & Compliance Data Aggregation

1. **G1 (No inventory): PASS** — The product is aggregated public-record data behind an API/dashboard (competitive-lanes.md §C3 Product shape); data is not physical inventory.
2. **G2 (No space): PASS** — Data collection from ~19,000 municipal portals is done over the network; no field presence or premises required (competitive-lanes.md §C3 Data Fragmentation Evidence).
3. **G3 (Lawful/licensable): PASS** — Aggregating and reselling public municipal permit records is established lawful practice with no licensure requirement, as demonstrated by BuildFax, ATTOM, and Gryd operating openly in the same data (competitive-lanes.md §C3 Incumbent Tiers 1–4).
4. **G4 (Spend-gate survivable): PASS** — A credible v1 scopes to 100–500 key jurisdictions scraped from free public portals by the agent workforce (competitive-lanes.md §C3 Product shape), so no bulk-data purchase is *mandatory* before revenue; if paid sourcing later proves necessary it is a scoring-level cost (C2/C3), not a gate breaker.
5. **G5 (Non-interference): PASS** — Greenfield data pipeline and product; no contact with existing GitHub repositories or Digital Ocean services.

**C3 gate result: PASS (5/5).** Concerns forwarded to scoring: jurisdiction-coverage economics and small-firm adoption evidence (00-longlist.md §C3 Labeled Gaps).

## C4 — Workflow Automation for Recurring Compliance & Audit (mid-market)

1. **G1 (No inventory): PASS** — Workflow automation software holds no physical goods (competitive-lanes.md §C4 Niche Definition).
2. **G2 (No space): PASS** — Cloud-delivered automation for distributed mid-market teams; no premises required (competitive-lanes.md §C4 Product shape).
3. **G3 (Lawful/licensable): PASS** — Selling automation tooling with audit logging requires no regulated status; the *customer* owns their regulatory obligations, and incumbents (Zapier, Make, UiPath) operate as unregulated vendors (competitive-lanes.md §C4 Pricing & Packaging Evidence).
4. **G4 (Spend-gate survivable): PASS** — v1 is agent-built software on board-approvable commodity hosting; certifications customers may eventually demand (e.g., SOC 2) are a post-revenue, scoring-level cost, not a mandatory pre-revenue purchase (competitive-lanes.md §C4 Gap 1: compliance depth is a feature/trust matter).
5. **G5 (Non-interference): PASS** — Connects to customers' systems under their credentials; no contact with our existing GitHub repositories or Digital Ocean services.

**C4 gate result: PASS (5/5).** Concerns forwarded to scoring: use-case specificity is unvalidated (00-longlist.md §C4 Labeled Gaps) — a C1-criterion weakness.

## D1 — Freelance Writers & Content Creators (invoice/contract automation)

1. **G1 (No inventory): PASS** — Invoicing, contract templates, and payment tracking are pure software (demand-lanes.md §D1 Niche Definition, Product shape).
2. **G2 (No space): PASS** — All-digital SaaS for solo/small-team freelancers; no premises required (demand-lanes.md §D1 Product shape).
3. **G3 (Lawful/licensable): PASS** — Invoicing/tracking software with self-serve contract templates is lawful without licensure (Bonsai, 17hats, FreshBooks operate identically, competitive-lanes.md §D1 Competitive Positioning), **binding constraint recorded:** the product must never take custody of client funds — payments ride licensed third-party processor rails only — and template features must remain self-serve documents, not legal advice; either violation would fail this gate.
4. **G4 (Spend-gate survivable): PASS** — v1 (invoicing + templates + reminders) is agent-buildable with only board-approvable hosting and processor fees that are revenue-contingent, not pre-revenue purchases (demand-lanes.md §D1 Product shape).
5. **G5 (Non-interference): PASS** — Greenfield SaaS; integrations (e.g., Upwork/Fiverr exports) touch customers' data, not our existing GitHub or Digital Ocean estate.

**D1 gate result: PASS (5/5, with the no-custody / no-legal-advice constraint recorded under G3).** Concerns forwarded to scoring: usage-rights tracking demoted to nice-to-have per the researchers' own gap closure (demand-lanes.md §D1 Tick-2 Gap Closure).

## D2 — Solo Therapists & Coaches (lightweight HIPAA practice management)

1. **G1 (No inventory): PASS** — Scheduling, notes, and secure messaging software holds no physical goods (demand-lanes.md §D2 Product shape).
2. **G2 (No space): PASS** — Delivery is all-digital SaaS to practitioners' own devices; no premises required (demand-lanes.md §D2 Niche Definition).
3. **G3 (Lawful/licensable): PASS** — We would operate as a HIPAA business associate (a contractual status any company, including ours, can legitimately hold by signing BAAs and meeting the Security Rule), not as a practitioner of medicine; incumbents of comparable size (Carepatron at $31–39/mo) demonstrate the compliance posture is attainable by small vendors (competitive-lanes.md §D2 Competitive Positioning; demand-lanes.md §D2 Tick-2 Evidence).
4. **G4 (Spend-gate survivable): PASS** — HIPAA-eligible hosting and a BAA-signing infrastructure chain are modest, board-approvable recurring spend, not gate-breaking capital (demand-lanes.md §D5 Tick-2 cites the 20–40% regulated-hosting premium — a percentage on small hosting bills, not a fixed wall).
5. **G5 (Non-interference): PASS** — Greenfield product; note for the record that PHI-bearing services may require hosting *alongside or instead of* our default Digital Ocean stack, which is an infra-convention question for the CTO at scoring/spike time — G5 itself (non-interference with *existing* services) is untouched.

**D2 gate result: PASS (5/5).** Concerns forwarded to scoring: HIPAA makes C5 (legal surface) plausibly a 2-or-lower, which per rubric §3 triggers a lawyer-agent review before finalist status; whether our default host signs BAAs is a C2/C3 input for Owen to verify.

## D3 — Independent Musicians & Sound Creators (multi-DSP royalty aggregation & splits)

1. **G1 (No inventory): PASS** — A royalty dashboard, metadata audit tool, and split computation are pure software over streaming data (demand-lanes.md §D3 Product shape).
2. **G2 (No space): PASS** — All-digital consumer SaaS; no premises required (demand-lanes.md §D3 Niche Definition).
3. **G3 (Lawful/licensable): PASS** — Read-only royalty aggregation and split *accounting* are unregulated software, **binding constraint recorded:** collaborator payouts must ride a licensed processor's rails (e.g., processor-managed connected accounts) so we never take custody or transmit funds ourselves — direct custody/disbursement would be money transmission requiring licenses we will not pursue, and would fail this gate (demand-lanes.md §D3 Product shape lists payment automation; the compliant non-custodial architecture is the standard one incumbents like Stem use, competitive-lanes.md §D3 Competitive Positioning).
4. **G4 (Spend-gate survivable): PASS** — v1 (aggregation + reconciliation + split accounting) is agent-buildable against artists' own exported/authorized DSP data with only board-approvable hosting; processor fees are revenue-contingent (demand-lanes.md §D3 Evidence Summary).
5. **G5 (Non-interference): PASS** — Greenfield product reading customers' own royalty data; no contact with our existing GitHub or Digital Ocean estate.

**D3 gate result: PASS (5/5, with the no-custody constraint recorded under G3).** Concerns forwarded to scoring: DSP data-access terms (scraping vs. authorized export) are a C5 burden question; the reconciled competitive picture (label-side tools exist, solo-artist gap stands, 00-longlist.md §Critical Tick-3 Reconciliation) is a C1 input.

## D4 — Small Event Organizers (RSVP + no-show reduction + vendor coordination)

1. **G1 (No inventory): PASS** — The organizers' events are physical; our product — RSVP, reminders, vendor checklists, budget tracking — is entirely software and holds nothing physical (demand-lanes.md §D4 Product shape).
2. **G2 (No space): PASS** — We never touch venues or logistics on the ground; delivery is a dashboard plus SMS/email automation (demand-lanes.md §D4 Niche Definition).
3. **G3 (Lawful/licensable): PASS** — Event-organizer tooling requires no license; SMS reminder compliance (consent/opt-out rules) is an ongoing legal-surface cost for C5, not a licensure bar (competitive-lanes.md §D4 Gap 1).
4. **G4 (Spend-gate survivable): PASS** — v1 is agent-buildable with board-approvable hosting plus per-message SMS costs that are small, metered, and largely revenue-contingent (competitive-lanes.md §D4 Gap 3: incumbents' pricing shows the delivery economics are light).
5. **G5 (Non-interference): PASS** — Greenfield SaaS; no contact with existing GitHub repositories or Digital Ocean services.

**D4 gate result: PASS (5/5).** Concerns forwarded to scoring: the niche may actually be two products (no-show reduction vs. vendor logistics, competitive-lanes.md §Tick 2 Anomaly Log #4) — a C1/C2 scoping question.

## D5 — Research Teams, Academic/Nonprofit (secure data collaboration with audit logging)

1. **G1 (No inventory): PASS** — A secure data-sharing workspace is hosted software and storage; nothing physical (demand-lanes.md §D5 Product shape).
2. **G2 (No space): PASS** — Multi-institutional collaboration is delivered entirely over the network; no premises required (demand-lanes.md §D5 Niche Definition).
3. **G3 (Lawful/licensable): PASS** — Operating as a data-hosting vendor with HIPAA/FERPA-aligned controls is a contractual/technical posture (BAAs, security controls) a company can legitimately hold, not a licensed profession; incumbents (Box, Dataverse) hold the same posture as ordinary vendors (competitive-lanes.md §D5 Competitive Positioning).
4. **G4 (Spend-gate survivable): PASS** — v1 on board-approvable regulated-tier hosting is survivable — the documented 20–40% compliance premium is proportional to small hosting bills, not a fixed capital wall (demand-lanes.md §D5 Tick-2 Evidence).
5. **G5 (Non-interference): PASS** — Greenfield product; same infra-convention note as D2 (regulated hosting may sit outside the default stack) with no bearing on non-interference with existing services.

**D5 gate result: PASS (5/5).** Concerns forwarded to scoring: the labeled Tier-1 gap — small-team (<$50K budget) spending is unvalidated (00-longlist.md §D5, demand-lanes.md §D5 Gap Remains) — is the dominant C1-criterion risk; C5 likely low enough to trigger lawyer review per rubric §3.

---

## Surviving set

**All nine candidates pass all five gates: C1, C2, C3, C4, D1, D2, D3, D4, D5 (9 of 9 survive to scoring).**

For the record, a 9/9 survival rate is not gate-softening — it is the expected output of a niche-first funnel that was *charterd inside* our constraints from day one (§5 of the rubric; the researchers screened for all-digital software niches before anything entered the long-list). The gates' job was to catch constraint violations hiding in product shapes; they caught two live ones — fund custody in D1 and D3 — and resolved them by recording binding non-custodial constraints rather than by pretending the risk isn't there. Discrimination between candidates now happens where it belongs: scoring under C1–C5, where the labeled evidence gaps (C1 willingness-to-pay, D5 small-team spending) and legal-surface burdens (D2, D5) will cost real points.

Two constraints and two flags carry forward as binding context for scoring:

1. **D1, D3 — no custody of client funds, ever** (G3 boundary; payments ride licensed processor rails or the feature doesn't ship).
2. **D1 — contract templates stay self-serve documents**, never legal advice (G3 boundary).
3. **D2, D5 — regulated-data hosting** may require infrastructure outside our default stack; CTO to verify BAA availability in our hosting chain during C2/C3 scoring.
4. **D2, D5 — C5 scores of 2 or lower trigger lawyer-agent review** before finalist status (rubric §3, applied at scoring).

### CTO co-sign constraints (added 2026-08-30, Owen Kessler — pressure-test outcomes; each attaches to a PASS, none flips one)

5. **C3 (G4) — $0-data v1 boundary; assumption verified before scored.** The PASS rests on
   an assumption the evidence file does not contain: competitive-lanes.md §C3 documents the
   product shape (100–500 jurisdictions) and the fragmentation, but never establishes that
   those jurisdictions' permit records are accessible at no cost or that their terms permit
   automated collection. The gate still passes — municipal permit records are public records
   and a credible free-access scoping path exists — but as a binding constraint: **v1
   jurisdiction selection is restricted to jurisdictions with free public portals whose terms
   permit automated collection; any paid data access (bulk purchase, per-record fees, paid
   API) is a board-gated purchase and out of v1 scope.** My C2/C3 scores will treat portal
   accessibility as unevidenced until measured; if C3 reaches finalist, the feasibility spike
   must demonstrate real jurisdictions scraped at $0 before any score cites the claim.
6. **D2, D5 (G4) — BAA-before-PHI; "proportional spend" verified 2026-08-30.** Checked
   against primary sources: AWS signs a HIPAA BAA self-serve at no charge (AWS Artifact);
   GCP and Azure sign under standard terms; and DigitalOcean — our default host — now signs
   BAAs for a designated covered-product set (Droplets, Kubernetes, Spaces, Volumes, LBs,
   VPC, Backups), conditional on a Standard/Premium support subscription. The verdicts'
   "percentage premium, not a fixed wall" reading holds. Binding constraint: **no PHI or
   regulated data touches any component — host, database, email, SMS, transcription,
   logging, backups — without an executed BAA covering that component, and the enabling
   spend (support tier or hosting) is a board-approval event that must precede the first
   byte of PHI, not follow first revenue.** Whether we use DO covered products or a second
   provider is a C2/C3 scoring input, not settled here.
7. **D1, D3 (G3) — non-custody made flow-of-funds precise.** The recorded constraints keep
   both shapes lawful and viable; one precision added so the boundary cannot erode in
   design: **we are never a payee, never an aggregator of receipts, and never in the flow of
   funds.** D1: client payments settle directly to the freelancer's own processor account.
   D3: royalties settle from DSPs/distributors to the artist's own accounts; our system
   computes splits and at most initiates transfers from the artist's own processor-managed
   account to collaborators. Any design that routes third-party money through an account we
   control is custody, and the feature doesn't ship. Citation correction, no verdict change:
   competitive-lanes.md §D3 describes Stem's features, not its money flow, so it does not
   establish that Stem's architecture is the standard non-custodial one — the PASS stands on
   the documented existence of processor-managed connected-account rails, not on Stem.

Next per rubric §1.3: CTO co-sign review of these verdicts, then scoring splits by domain — C1/C4/C5 signed by the CEO, C2/C3 signed by the CTO, every score carrying a written rationale citing evidence.

## Signatures

A signature below means: "I agree these gate verdicts were applied as pass/fail constraint checks per §2 of the signed rubric, before any scoring, and that the surviving set and recorded constraints bind the scoring stage."

- **Carla Voss, CEO** — SIGNED, 2026-08-30.
- **Owen Kessler, CTO** — SIGNED, 2026-08-30, with constraints 5–7 above attached. Reviewed
  cold against rubric §2 and the evidence files (00-longlist.md, demand-lanes.md,
  competitive-lanes.md). Pressure-tested as asked: C3's G4 (pass survives, with the $0-data
  boundary and spike-verification constraint — the free-portal assumption was cited to a
  section that doesn't contain it); D2/D5's G4 (pass survives, verified against primary
  hosting sources same-day — BAA-capable hosting is proportional spend, including on our
  default host's covered products); D1/D3's G3 (constraints keep the shapes lawful and
  viable; flow-of-funds boundary tightened; Stem citation corrected without verdict change).
  All nine verdicts otherwise applied as pass/fail constraint checks, correctly cited, before
  any scoring. No PASS flipped. Degree questions stay in scoring where they belong — noting
  for my own C2 scoring that open-source scanner license compatibility with hosted commercial
  use (C2 candidate) is a cost input, not a gate matter.
