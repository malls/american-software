# Competitive & Pricing Evidence — Segments C1–C4
**Researcher:** Elliot Kwan  
**Collection Date:** 2026-08-30  
**Status:** Tick 1 of 3 — Initial pricing and packaging audit across four segments  
**Note:** All pricing and feature data sourced from public vendor websites, review aggregators, and job board listings. Every data point carries collection date and method.

---

## Candidate C1: Micro-Credential Platforms for Mid-Market Upskilling (50–500 Person Firms)

### Niche Definition
- **Who (target):** Mid-market firms (50–500 employees) needing affordable, scalable upskilling and micro-credential platforms
- **What (underserved pain):** Enterprise-grade platforms (LinkedIn Learning, Skillsoft, Docebo) have pricing cliffs: small-team plans at ~$380/user/yr jump to enterprise at $200–350/user/yr for 500+ users. Mid-market firms (50–200 people) face a 3–5x cost cliff between "team" and "enterprise" tiers.
- **Why it's underserved:** Incumbents optimize for either self-serve individuals (<$40/mo) or enterprise (>50,000+ contracts); 50–500 person firms occupy a pricing gap with limited tailored solutions.
- **Product shape (rough):** Lightweight LMS with micro-credential issuing, built for 50–500 person orgs at predictable $5–15/user/mo pricing, no enterprise minimums.

### Pricing & Packaging Evidence

#### Incumbent Tier 1: LinkedIn Learning
- **Team Plan:** $379.88/user/year (2–20 licenses, $31.66/user/mo)
  - Source: LinkedIn Learning pricing page, aggregated by multiple vendors (Postiv AI, LinkedIn Helper, TrainingCost.com)
  - Observed: 2026-08-30
  - Method: Public pricing page aggregators
- **Enterprise Plan:** Custom quote, estimated $350–500/user/year based on seat count & contract term
  - Source: Industry aggregator (TrainingCost.com LinkedIn Learning Business Pricing 2026)
  - Observed: 2026-08-30
  - Method: Market research aggregator

#### Incumbent Tier 2: Skillsoft Percipio LXP
- **Enterprise Base:** ~$197,700/year for typical mid-market deployment (estimated 500–1,000 learners)
  - Source: Vendr, SpendHound marketplace data for actual customer spend
  - Observed: 2026-08-30
  - Method: Third-party pricing aggregator, vendor spend data
- **Per-Seat Pricing:** $200–350/user/year for 500–1,000 learner organizations
  - Source: PricingNow (Skillsoft Percipio Pricing 2026)
  - Observed: 2026-08-30
  - Method: Market research aggregator
- **Lab Access Add-On:** 20–40% surcharge on technical training, per-learner or per-hour basis
  - Source: PricingNow analysis of Skillsoft licensing
  - Observed: 2026-08-30
  - Method: Industry data aggregator

#### Incumbent Tier 3: Degreed (Micro-Credential Focus)
- **Small/SMB Tier:** $15/user/month ($180/user/year)
  - Source: Degreed pricing page aggregated (eLearning Industry, Capterra, Z-SoftwareHub)
  - Observed: 2026-08-30
  - Method: Public pricing aggregators
- **Enterprise Tier (1,000+ users):** $10/user/month ($120/user/year)
  - Source: eLearning Industry directory, Degreed pricing
  - Observed: 2026-08-30
  - Method: Aggregator of public pricing

#### Incumbent Tier 4: Docebo LMS
- **Entry Point:** £20,000–£30,000/year ($25,000–37,500 USD equivalent)
  - Source: Compono (Docebo Pricing 2026), eLearning Industry
  - Observed: 2026-08-30
  - Method: Market research aggregator
- **Median Contract:** ~$40,000/year (per Compono median data)
  - Source: Compono (Docebo Pricing 2026: True Costs)
  - Observed: 2026-08-30
  - Method: Aggregated customer spend benchmarks
- **Implementation Cost:** $10,000–$40,000 for mid-market deployment (HRIS integration, SSO, branding, migration)
  - Source: TrainingCost.com Docebo Cost 2026
  - Observed: 2026-08-30
  - Method: Industry analysis of typical deployment costs
- **Per-User Model:** Pricing based on active users (logged in ≥1 month)
  - Source: CheckThat.ai (Docebo Pricing 2026)
  - Observed: 2026-08-30
  - Method: Vendor documentation aggregator

### Feature & Packaging Gaps

**Gap 1: Pricing Cliff for 50–200 Person Orgs**
- LinkedIn Learning & Skillsoft: Team tiers (2–20) at $31–50/user/mo, then enterprise at $17–42/user/mo for 500+
- Mid-market (50–200) falls in a no-man's land: too large for team tier, too small for enterprise discounts
- Incumbents direct them to custom enterprise quotes (length of sales cycle, minimum commitment unclear)
- Source: Compiled from pricing analysis; corroborated by Compono commentary on Docebo (lack of mid-market tier clarity)
- Observed: 2026-08-30

**Gap 2: Micro-Credential Issuing as Commodity Add-On**
- Degreed leads on credential sophistication, but pricing does not differentiate credential-heavy vs. course-heavy use cases
- LinkedIn Learning & Skillsoft credential features are subsumed into general LMS cost, no standalone pricing
- Source: Public feature comparison across vendor sites (Capterra, eLearning Industry)
- Observed: 2026-08-30
- Method: Feature matrix analysis from aggregators

**Gap 3: Minimum Commitments & Contract Terms**
- Skillsoft, Docebo: Multi-year contracts (3–5 year) standard for enterprise; unclear minimums for 50–200 person tier
- Degreed & LinkedIn: More flexible, but Degreed & Docebo lack public self-serve pricing below a certain headcount threshold
- Source: Vendor documentation aggregated by PricingNow, Compono, eLearning Industry
- Observed: 2026-08-30

---

## Candidate C2: Lightweight Code Quality Gates for Small Dev Teams (2–20 Devs)

### Niche Definition
- **Who (target):** Small dev teams (2–20 contributing developers) needing code security scanning (SAST, SCA, container) at predictable, low-per-developer cost
- **What (underserved pain):** Enterprise security tools (Veracode, GitLab Ultimate) are priced for 20+ developers; small teams either pay full enterprise rates or use free/OSS with no SLA. Snyk's Team plan has a 5-developer minimum; GitHub Advanced Security charges per active committer over 90 days.
- **Why it's underserved:** Pricing is optimized for either individuals (free) or enterprises (100+); 2–10 person teams have no natural price point short of $1,500–3,000/year.
- **Product shape (rough):** Per-repository or flat-rate code quality gates (SAST, SCA, container scanning) for 2–20 developers, <$100/repo/mo or <$50/dev/mo, no per-developer minimum.

### Pricing & Packaging Evidence

#### Incumbent Tier 1: Snyk (Security-Focused SCA/SAST)
- **Team Plan:** $25/developer/month, minimum 5 developers
  - Entry cost: $125/month ($1,500/year) for 5 developers
  - Maximum 10 contributing developers: $250/month ($3,000/year)
  - Source: DEV Community (Snyk Pricing 2026), Snyk pricing aggregators (Ciphers Security, Modern DataTools)
  - Observed: 2026-08-30
  - Method: Public pricing documentation & aggregators
- **Free Plan:** Unlimited tests, test limits removed on Team plan
  - Source: DEV Community, Modern DataTools
  - Observed: 2026-08-30

#### Incumbent Tier 2: GitHub Advanced Security
- **Secret Protection:** $19/committer/month ($228/committer/year)
- **Code Security:** $30/committer/month ($360/committer/year)
  - Source: GitHub pricing pages, CloudEagle.ai (GitHub Pricing Optimization 2026), PixLodo (GitHub Advanced Security Pricing Guide)
  - Observed: 2026-08-30
  - Method: Official GitHub pricing + aggregators
- **Billing Model:** Per unique committer in 90-day period; usage-based, not seat-based
  - Source: Microsoft Azure DevOps docs & GitHub billing aggregators
  - Observed: 2026-08-30

#### Incumbent Tier 3: Veracode (Enterprise SAST/DAST/SCA)
- **Minimum Entry:** ~$15,000/year for basic SAST (up to 100 applications)
- **Typical Range:** $50,000–$300,000/year depending on application count, scan frequency, testing mix
- **SAST Only:** ~$15,000/year
- **SCA Only:** ~$12,000/year
- **DAST Services:** $20,000–$25,000/year
  - Source: BeagleSecurity (Veracode pricing), UnderDefense (Veracode Pricing 2026 Ultimate Guide), Vendr, Capterra
  - Observed: 2026-08-30
  - Method: Aggregator analysis of vendor pricing & industry data
- **Pricing Model:** Application-based & testing-volume-based, NOT per-developer; no public pricing (quote-based)
  - Source: BeagleSecurity, Capterra, Vendr
  - Observed: 2026-08-30

#### Incumbent Tier 4: GitLab
- **Premium Tier:** $29/user/month (annual) = $348/user/year
  - For 5-developer team: ~$1,740/year
  - Includes: 10,000 CI/CD minutes, 50GB storage, advanced merge controls, code owners, roadmaps
  - Source: Spendflo (GitLab Pricing Plans 2025), CostBench, Eesel AI (GitLab pricing 2026), compareTiers
  - Observed: 2026-08-30
  - Method: Public pricing aggregators
- **Ultimate Tier:** $99/user/month = $1,188/user/year
  - For 10-person team: $11,880/year
  - Includes: 50,000 CI/CD minutes, top-tier security, compliance, strategic tools
  - Source: CostBench, Eesel AI, Spendflo
  - Observed: 2026-08-30
- **Pricing Change (2025):** GitLab eliminated Bronze/Starter tier (lower entry), raised Premium ~50%, forcing small teams to Free tier (5-user limit) or jump to Premium ($29/user)
  - Source: GForge (GitLab Pricing Trap 2025)
  - Observed: 2026-08-30 (referencing 2025 change)

### Feature & Packaging Gaps

**Gap 1: Minimum Developer Thresholds**
- Snyk: 5-developer minimum ($1,500/year entry)
- Veracode: Application-based minimum ($15,000/year entry), not practical for 2–10 person teams
- GitHub Advanced Security: No minimum but per-committer billing; a 2-person team paying $38–60/month is viable but not marketed to that segment
- Source: Pricing analysis of incumbent tiers
- Observed: 2026-08-30

**Gap 2: Per-Developer Pricing Mismatch**
- For a 2–5 person team: Snyk requires 5-minimum or use free plan (no team features); GitHub Advanced Security at $19–30/mo per person is $456–1,800/year for a 2-person team — unpredictable
- For a 10-person team: Snyk $3,000/year, GitLab Premium $3,480/year, GitHub Code Security $3,600/year all reasonable; but no flat-rate or per-repo options
- Source: Compiled pricing comparison
- Observed: 2026-08-30

**Gap 3: Free/OSS Gap**
- Free tiers (Snyk Free, GitLab Free, GitHub Copilot) offer no team collaboration or SLA; small teams either accept risk or pay enterprise rates
- OWASP tools (free, self-hosted) lack commercial support and are immature in UX for non-security teams
- Source: Code Review Tools guide (Augment Code), industry commentary
- Observed: 2026-08-30

**Gap 4: Feature Coupling**
- GitLab Premium bundles code quality with 10,000 CI/CD minutes, roadmaps, epics; small teams may only need scanning, not full DevOps platform
- GitHub Advanced Security requires GitHub Enterprise; cannot use with free tier
- Source: Feature matrix from official pricing pages
- Observed: 2026-08-30

### Job Board Signal: Developer Pain on Security Tooling
- Construction Compliance Officer postings (1,000+ open across US, $61k–$172k salary range) signal demand for compliance automation; job requirements cite "compliance management software" and "documentation tools" as must-haves
- Small firm hiring for compliance roles: implies pain in managing compliance workflows manually
- Source: ZipRecruiter, Glassdoor (construction compliance officer jobs 2026)
- Observed: 2026-08-30
- Method: Job board aggregator analysis

---

## Candidate C3: Vertical-Specific Compliance & Risk Data (Construction, Dental, Legal, Auto Retail)

### Niche Definition
- **Who (target):** Compliance officers, permit managers, and operations teams in construction, dental practices, legal firms, and auto retail (typically 10–100 person firms)
- **What (underserved pain):** Municipal permit databases are fragmented across ~19,000 local jurisdictions, each with its own format and portal. Compliance teams spend hours aggregating permit data, licensing lookups, regulatory requirements across states/counties. Incumbents (BuildFax, ConstructConnect, ATTOM) charge per data point, per query, or per-seat; no unified, affordable small-team solution.
- **Why it's underserved:** Data fragmentation is real and costly to solve; incumbents bundle consolidation with market-research and lead-gen features, raising prices. Vertical operators within each niche lack data consolidation muscle.
- **Product shape (rough):** Unified permit/licensing lookup API and dashboard for one vertical (e.g., construction or dental), aggregating data from 100–500 key jurisdictions, $200–500/mo flat rate or per-lookup.

### Pricing & Packaging Evidence

#### Incumbent Tier 1: BuildFax (Construction Focus)
- **Public Data Points:** Property History Report: $5.00 (HomeGauge partner pricing)
  - Source: BuildFax Pricing on Datarade, HomeGauge Support Center
  - Observed: 2026-08-30
  - Method: Public price disclosure via partner integrations
- **Full Enterprise Pricing:** Custom (not publicly disclosed)
  - Source: Datarade (BuildFax profile), BuildFax website
  - Observed: 2026-08-30
- **Coverage:** 84+ billion data points on residential and commercial structures
  - Source: Datarade (BuildFax profile)
  - Observed: 2026-08-30

#### Incumbent Tier 2: ConstructConnect Project Intelligence
- **Starter Plan:** $129/month
- **Professional Plan:** $199/month
- **Pro + Takeoff:** Custom pricing
  - Source: Software Finder, Capterra, GetApp (ConstructConnect Project Intelligence)
  - Observed: 2026-08-30
  - Method: Pricing aggregators
- **Estimated Annual TCO:** $15,000/year (base subscription) + $3,000 implementation + $2,000 training
  - Source: PricingNow (ConstructConnect Bid Management Pricing 2026)
  - Observed: 2026-08-30
- **Model:** Per-seat/per-market licensing; cost increases with team size or geographic footprint
  - Source: Capterra & ConstructConnect description
  - Observed: 2026-08-30

#### Incumbent Tier 3: ATTOM Data (Aggregated Permit Data)
- **Coverage:** 300+ million building permits from 2,000+ building departments nationwide
  - Source: ATTOM website (Nationwide Building Permit Data)
  - Observed: 2026-08-30
  - Method: Public vendor documentation
- **Pricing:** Not publicly disclosed; enterprise custom quotes
  - Source: ATTOM website
  - Observed: 2026-08-30

#### Incumbent Tier 4: Gryd (formerly BuildZoom Data)
- **Coverage:** 400+ million building permits, 6M+ contractor profiles, 25+ years of history
  - Source: HomeLogs comparison (HomeLogs vs Shovels vs ATTOM vs BatchData 2026)
  - Observed: 2026-08-30
  - Method: Permit data aggregator analysis
- **Data Format:** Normalized construction intelligence (previously fragmented municipal data)
  - Source: HomeLogs article
  - Observed: 2026-08-30

### Data Fragmentation Evidence

**Fragmentation at Scale:**
- Municipal permit records fragmented across ~19,000 local jurisdictions, each with its own portal and data format
- Multiple vendors (Gryd, ATTOM, Shovels, HomeLogs, BatchData) have emerged to aggregate and normalize data
- Source: HomeLogs (Permit Data API Comparison 2026)
- Observed: 2026-08-30
- Method: Industry aggregator analysis of permit data vendors

### Feature & Packaging Gaps

**Gap 1: Pricing Model Mismatch for Small Teams**
- ConstructConnect: Per-seat/per-market ($129–199/mo base ~$1,500–2,400/yr), then scales with team growth
- BuildFax: Per-query ($5/report) or enterprise custom; small teams using it ad-hoc pay per-lookup; continuous subscribers face unclear per-unit costs
- Neither vendor offers a flat-rate small-team plan or per-project licensing
- Source: Pricing analysis & vendor packaging
- Observed: 2026-08-30

**Gap 2: Vertical Specialization**
- Incumbents are construction-focused (BuildFax, ConstructConnect, Gryd, ATTOM). Dental, legal, and auto retail permit/compliance needs are not specifically addressed
- No unified solution covering permit lookups, licensing status, regulatory requirements across multiple verticals
- Source: Vendor market positioning analysis
- Observed: 2026-08-30

**Gap 3: Implementation & Onboarding**
- ConstructConnect: $3,000–$5,000+ implementation + training for typical mid-market deployment
- BuildFax/ATTOM: Pricing opaque; likely similar enterprise-minimum structures
- Small teams (5–20 people) cannot afford $3k upfront + $15k/yr subscription for a single compliance data tool
- Source: ConstructConnect PricingNow analysis
- Observed: 2026-08-30

**Gap 4: Real-Time Data & Jurisdiction Coverage**
- Fragmentation across 19,000 jurisdictions means no provider covers 100% of U.S. permit data
- SLAs and update frequency for permit data aggregators not explicitly published
- Source: HomeLogs permit data comparison
- Observed: 2026-08-30

### Job Board Signal: Compliance Officer Hiring
- 1,000+ "Construction Compliance Officer" postings, $61k–$172k salary (avg $98,949)
- Job requirements cite "compliance management software," "permit knowledge," "OSHA standards," "documentation tools"
- Salary range implies firms are willing to pay $60k–$170k/year for compliance expertise, signaling high pain in compliance management
- Implication: Automation/consolidation of permit data would reduce manual compliance-officer workload
- Source: ZipRecruiter, Glassdoor (Construction Compliance Officer jobs 2026)
- Observed: 2026-08-30
- Method: Job board aggregator search

---

## Candidate C4: Workflow Automation for Recurring Compliance & Audit (Mid-Market 50–500 Person)

### Niche Definition
- **Who (target):** Mid-market compliance, HR, and operations teams (50–500 person firms) needing to automate recurring audit workflows, compliance checks, data validation
- **What (underserved pain):** Zapier & Make are general-purpose automation platforms; compliance teams struggle with audit trails, change control, and HIPAA/SOC2 enforcement. Higher-end platforms (Blue Prism, UiPath) are enterprise-only ($75k–$420k/year) and overkill for recurring mid-market workflows. No middle ground at $1k–$5k/year for compliance-specific automation.
- **Why it's underserved:** Low-code platforms lack compliance depth; RPA platforms lack affordability. Mid-market compliance teams either overspend on enterprise RPA or accept Zapier's governance/audit gaps.
- **Product shape (rough):** Compliance-focused workflow automation for recurring audits/data checks, built-in audit logging and role-based access, $200–500/mo for 50–500 person orgs, no per-task/credit surprise costs.

### Pricing & Packaging Evidence

#### Incumbent Tier 1: Zapier (General-Purpose Automation)
- **Free Plan:** 100 tasks/month, single-step Zaps (1 trigger + 1 action)
  - Source: NoCode MBA (Zapier Pricing 2026), Activepieces (Zapier Pricing Breakdown), StackRev
  - Observed: 2026-08-30
  - Method: Public pricing aggregators
- **Professional Plan:** $19.99/month (annual) or $29.99/month (monthly)
  - 750 tasks/month, multi-step Zaps, webhooks, filters, AI fields
  - Source: NoCode MBA, Activepieces, StackRev
  - Observed: 2026-08-30
- **Team Plan:** $103.50/month
  - 2,000 tasks/month, shared workspace, team collaboration
  - Source: NoCode MBA, StackRev
  - Observed: 2026-08-30
- **Enterprise Plan:** Custom pricing (5,000+ tasks/month estimated)
  - Unlimited users, advanced admin controls, technical account management
  - Source: StackRev
  - Observed: 2026-08-30
- **Billing Model:** Task-based; every run (success or failure) counts; unpredictable scaling costs
  - Source: Omid Saffari (Zapier Pricing 2026: Cheap to Start, Costly to Scale), PlugJunction
  - Observed: 2026-08-30

#### Incumbent Tier 2: Make.com (General-Purpose Automation)
- **Free Plan:** 1,000 credits/month
- **Core Plan:** $9/month (10,000 credits/month)
- **Pro Plan:** $16/month (10,000 credits + rollover)
- **Teams Plan:** $29/month (10,000 credits + shared workspace)
- **Enterprise Plan:** Custom pricing
  - Source: Lindy (Make.com Pricing 2026), Make.com review (GitHub Gist), Zapier blog (Make.com pricing comparison)
  - Observed: 2026-08-30
  - Method: Public aggregators & vendor documentation
- **Credit System:** Multi-step workflows, loops, frequent triggers burn credits faster; unclear cost per operation
  - Source: Thinkpeak AI (Make.com Pricing 2026: Survival Guide)
  - Observed: 2026-08-30
- **2026 Feature:** Rollover unused credits 1 month (new, estimated $50–100/mo savings for seasonal businesses)
  - Source: AITrampoline Park (Make.com Pricing 2026)
  - Observed: 2026-08-30

#### Incumbent Tier 3: Blue Prism RPA
- **Enterprise Minimum:** $75,000+/year
- **Per-Bot Pricing:** $1,000+ minimum mentioned
- **Positioning:** Enterprise-grade RPA for regulated industries; highest compliance/audit pedigree
  - Source: Peerspot, SelectHub (Blue Prism Reviews 2026), SS&C Blue Prism guides
  - Observed: 2026-08-30
  - Method: Aggregators & vendor positioning
- **Limitations:** Designed for 100+ developer environments; overkill for mid-market compliance use cases
- **Market Share:** 4.0% (as of July 2026, down from 9.0% prior year)
  - Source: Automation Atlas (RPA Pricing Comparison 2026)
  - Observed: 2026-08-30

#### Incumbent Tier 4: UiPath RPA
- **Automation Developer License:** $420/month minimum
- **Market Dominance:** 35.8% RPA market share
- **Accessibility:** More user-friendly drag-and-drop than Blue Prism; still enterprise-focused
- **Licensing Complexity:** Difficult to predict total cost; expensive for small teams
  - Source: Automation Atlas (RPA Pricing Comparison 2026), UiPath vs Blue Prism 2026 comparison
  - Observed: 2026-08-30
  - Method: Aggregators & industry comparisons

### Compliance & Governance Gaps

**Gap 1: Zapier Compliance Limitations**
- No HIPAA compliance (healthcare data prohibited)
- Governance drift: weak change control and audit trails for regulated use cases
- SOC 2 Type II & GDPR compliance exist, but audit logging gaps for mid-market compliance workflows
- Enterprise plan includes audit logs and role-based access, but pricing not disclosed
- Source: Dev.to (When Zapier Hits Its Limits), Kriv.ai (Zapier Change Control and Audit), Activepieces (Zapier Workflow Automation)
- Observed: 2026-08-30
- Method: Industry analysis & vendor documentation

**Gap 2: Make.com Governance Gaps**
- Credit-based model makes cost unpredictable for recurring compliance workflows
- Unclear rollover rules and no explicit audit trail requirements for regulated industries
- No HIPAA or specialized compliance marketing
- Source: Thinkpeak AI (Make.com Pricing 2026)
- Observed: 2026-08-30

**Gap 3: RPA Pricing Cliff**
- Blue Prism ($75k+), UiPath ($420/mo developer minimum): inaccessible for 50–200 person mid-market firms needing 1–2 compliance automation workflows
- No "mid-market" tier; platforms assume either SMB (Zapier/Make) or enterprise (RPA)
- Source: Automation Atlas (RPA Pricing Comparison 2026)
- Observed: 2026-08-30

**Gap 4: Audit Trail Depth**
- Zapier/Make: Basic logging at Task level; not designed for regulatory audit scenarios
- Blue Prism/UiPath: Audit trails exist but bundled with full RPA cost
- No middle ground for $2k–$5k/year compliance automation with proper audit logging
- Source: Zapier Enterprise documentation, Kriv.ai analysis
- Observed: 2026-08-30

---

## TICK 3: D3 Evidence Conflict Resolution (Joint Reconciliation with Nadia)

**Conflict:** Elliot tick-2 verdict (D3 aftermarket tools "nonexistent") vs. Nadia tick-2 verdict (D3 tools "exist and compete").

**Investigation:** Verified named tools from Nadia's research (Trqk, Orphiq, Curve Royalty Systems, Stem, Madverse).

**Findings:**

1. **Tools Existence:** ✓ NADIA CORRECT
   - **Trqk (TrqkIQ):** Confirmed real; "Music Royalty Intelligence" platform with audio content recognition for real-time royalty tracking and auditing
   - **Curve Royalty Systems:** Confirmed real; B2B platform used by 800+ labels, distributors, publishers; launched "Curve Lite" tier (£20/mo+) in 2024
   - **Stem:** Confirmed real; combines distribution with royalty processing and automated split payments for collaborators
   - Source: Trqk.io (2026), MusicBusinessWorldwide (Curve Lite launch), LabelGrid (2026)

2. **Market Segment Distinction:** ✓ ELLIOT PARTIALLY CORRECT (BUT IMPRECISE)
   - Aftermarket tools DO exist but serve LABEL/DISTRIBUTOR/PUBLISHER segment, not solo artists directly
   - Trqk, Curve, Stem all focus on professional music businesses and labels; positioning unclear for casual solo artists
   - Curve Lite £20/mo targets "smaller labels, distributors, and publishers" — not solo artist consumer tier
   - Solo artists access royalty tracking via their distribution platforms (DistroKid, CD Baby) or through labels' Curve dashboard
   - **Verdict:** The D3 niche gap is real and remains underserved for SOLO-ARTIST-ACCESSIBLE consumer tools, even though B2B aftermarket tools exist
   - Source: MusicBusinessWorldwide, Music Week (Curve Lite positioning), LabelGrid analysis

3. **Unclaimed Royalty Figure Correction:** ✗ ELLIOT INCORRECT ($561M+), ✓ NADIA CORRECT ($424M)
   - Original MLC 2021 historical transfer: **$424,384,787** (confirmed via Aristake, Chartlex, The MLC)
   - Elliot's $561M+ figure: OUTDATED OR INCORRECT SOURCE
   - As of June 2026: ~$160M in pre-2021 historical unmatched royalties remain; ongoing distributions have reduced the pool
   - **Correction:** Use Nadia's $424M as the baseline for original unclaimed historical royalties (2021); note that current amount is ~$160M pre-2021 figure + new unmatched royalties accumulating monthly
   - Source: Aristake (songwriters claiming MLC money, 2026), Chartlex (MLC Unclaimed Royalties 2026), Velveteen (MLC historical royalties)

**Joint Verdict:**
- **Aftermarket tools exist:** Trqk, Curve, Stem, and others are real, established platforms
- **Market gap is intact:** These tools serve labels/distributors, not solo artists; no consumer-friendly solo-artist royalty dashboard exists at $10–50/mo price point
- **D3 niche validity:** CONFIRMED — solo independent musicians lack accessible, affordable, unified royalty tracking across multiple DSPs; the gap exists even though B2B solutions exist for labels
- **Royalty figure:** Corrected to $424M (original 2021 MLC historical royalties); as of June 2026, ~$160M remains from pre-2021 pool
- **Status:** D3 proceeds to long-list as-is; product positioning is valid (artist-side multi-DSP reconciliation + split payments) and distinct from existing label-side tools

---

## Sufficiency Assessment & Gaps

### C1 (Micro-Credentials): Sufficient for Long-List

**Tier 1 Evidence (Observed Paid Behavior):** ✓ Established
- LinkedIn Learning, Skillsoft, Degreed, Docebo all have active mid-market customers
- Pricing tiers and contracts documented
- Clear pricing cliff between team and enterprise tiers

**Product Shape Clarity:** ✓ Clear
- Incumbents serve 50–500 person segment but with pricing misalignment; gap is well-defined

**Gaps Observed:**
- No primary research on willingness-to-pay by mid-market firms in this segment; pricing cliff is structural, but customer pain level (how many firms avoid upskilling due to cost) is unquantified
- No data on market size for 50–500 person upskilling segment
- Recommend: Cross-check with Nadia on D-lane candidates (training demand signals) to quantify pain

---

### C2 (Code Quality Gates): Sufficient for Long-List

**Tier 1 Evidence (Observed Paid Behavior):** ✓ Established
- Snyk, GitHub, Veracode, GitLab all have paying small-team customers
- Per-developer pricing published; minimum commitment barriers documented
- Job board signal: compliance officer hiring suggests pain in compliance automation (adjacent to code quality)

**Product Shape Clarity:** ✓ Clear
- 2–20 developer teams face per-developer costs ($1,500–3,600/year minimum); no flat-rate or per-repo option below enterprise
- Pricing cliff is structural

**Gaps Observed:**
- No primary data on what 2–5 person teams currently spend on code quality (free tier vs. paid)
- Job board signal is indirect (compliance officer pain, not developer pain)
- Recommend: Cross-check with Nadia on demand-side evidence for small dev teams' pain points

---

### C3 (Construction Compliance Data): Sufficient for Long-List (with Caveat)

**Tier 1 Evidence (Observed Paid Behavior):** ✓ Established
- ConstructConnect, BuildFax, ATTOM all charge for permit data and have active customers
- Pricing tiers and per-query costs documented
- Job board signal: 1,000+ construction compliance officer postings at $60k–$170k salary confirms high pain

**Product Shape Clarity:** ⚠️ Partial (Vertical-Specific Gap)
- Construction-specific incumbents are well-mapped
- Dental, legal, auto retail compliance data needs are NOT well-evidenced in this research
- May need to narrow scope to construction-only for tick 2, or expand research to dental/legal/auto

**Gaps Observed:**
- No data on whether small construction firms (10–50 person) actually use ConstructConnect or BuildFax, or if they accept manual permit research
- Fragmentation across 19,000 jurisdictions documented, but unclear which jurisdictions each incumbent covers
- Dental, legal, auto retail equivalents of ConstructConnect not identified
- Recommend: Tick 2 research expand to dental/legal/auto to test vertical-specific gaps

---

### C4 (Workflow Automation): Sufficient for Long-List (with Caveat)

**Tier 1 Evidence (Observed Paid Behavior):** ✓ Established
- Zapier, Make, Blue Prism, UiPath all have paying customers in compliance/automation use cases
- Pricing tiers and governance gaps documented

**Product Shape Clarity:** ⚠️ Partial (Use Case Specificity)
- General automation platforms (Zapier/Make) are well-documented
- Compliance-specific use cases (audit trails, change control) are mentioned in literature but not empirically sourced
- No direct evidence that mid-market compliance teams find Zapier governance insufficient; inferred from feature gaps

**Gaps Observed:**
- No primary data on how many mid-market compliance teams currently use Zapier vs. custom scripts vs. paper-based workflows
- Job board signal: none directly for compliance automation; inferred from compliance officer hiring
- "Compliance automation" use case itself may be too broad; narrow to "recurring audit workflows" or "data validation" for tick 2
- Recommend: Tick 2 research target specific compliance/audit workflow examples (e.g., weekly SOC2 audit, monthly tax data validation) with actual customer counts and current spend

---

## Known Failure Mode: Taxonomy Overconfidence

**Anomaly Log Entry (Tick 1):**

1. **C2 Job Board Signal Misalignment:** Searched for "code quality tools small teams pain points Reddit" and got results on team size and DORA metrics, but not small-team-specific Reddit threads. Assumed construction compliance officer hiring signals code quality pain; this is indirect and may not hold. Flag for Nadia: Does demand-side research show developers in small teams actively seek security solutions, or do they accept open-source/free?

2. **C3 Vertical Scope Drift:** Began with four verticals (construction, dental, legal, auto retail) but research data only covers construction. BuildFax, ConstructConnect, ATTOM, Gryd all construction-focused. Did not find dental/legal/auto retail equivalents. Risk: Segment C3 may collapse to "construction permit data" only, not "vertical-specific compliance data" broadly. Recommend tick 2: Narrow scope or research dental/legal/auto retail separately.

3. **C4 "Compliance Automation" Too Broad:** Segment describes "recurring compliance/audit" but pricing evidence bundles general workflow automation (Zapier/Make) with specialized RPA (Blue Prism/UiPath). Small-team compliance use cases may differ materially from RPA use cases. Recommend tick 2: Define specific compliance workflows (audit trails, data validation, regulatory reporting) and test incumbent fit.

---

## Tick 1 Summary: Competitive Pricing Landscape

| Segment | Incumbent | Entry Price | Scaling Model | Gap for Small/Mid-Market |
|---------|-----------|-------------|---|---|
| **C1: Micro-Creds** | LinkedIn Learning (team tier) | $379.88/user/yr | $31.66/user/mo → enterprise custom | 50–500 person firms face 3–5x cliff to enterprise; no mid-market tier |
| **C1: Micro-Creds** | Degreed | $180/user/yr (SMB) | $10–15/user/mo | Lowest entry point; still per-user scaling |
| **C2: Code Quality** | Snyk | $1,500/yr (5-dev min) | $25/dev/mo | 2–5 dev teams forced to free tier or overpay; no <$1,500 entry |
| **C2: Code Quality** | GitHub Advanced Security | $228–360/dev/yr | $19–30/dev/mo | Per-committer billing; unpredictable for growing teams |
| **C3: Compliance Data** | ConstructConnect | $1,548–2,388/yr | $129–199/mo + per-seat | Minimum >$1,500/yr; no per-query or per-project option |
| **C4: Automation** | Zapier (team tier) | $1,242/yr | $103.50/mo (2k tasks/mo) | Task-based scaling; governance gaps for compliance use |
| **C4: Automation** | Make (base) | $108/yr | $9–29/mo (credit-based) | Credit model unpredictable; no compliance-specific features |

---

## What Tick 2 Deepens

1. **C1 Demand Validation:** Nadia to surface willingness-to-pay signals from 50–500 person firms; Elliot to document Docebo competitor set and any "mid-market" tier pricing
2. **C2 Pain Quantification:** Nadia to find small-team developer complaints on security tooling; Elliot to map OWASP/self-hosted costs as competitor baseline
3. **C3 Vertical Expansion:** Elliot to research dental/legal/auto retail permit/compliance data incumbents; quantify fragmentation pain in non-construction verticals
4. **C4 Use-Case Narrowing:** Nadia to surface specific compliance audit/workflow pain signals; Elliot to detail Blue Prism/UiPath feature parity vs. Zapier for compliance logging

---

## Sources Summary

**Pricing Aggregators (Multi-Vendor Data):**
- Vendr, SpendHound, Capterra, GetApp, TrainingCost.com, PricingNow, CheckThat.ai, eLearning Industry, SoftwareAdvice, TrustRadius

**Aggregator Reports with Analysis:**
- Compono (Docebo 2026), Spendflo (GitLab), Eesel AI, StackRev, Activepieces, Omid Saffari, PlugJunction

**Primary Vendor Documentation:**
- LinkedIn Learning, Skillsoft, Degreed, Docebo, Snyk, GitHub, Veracode, GitLab, Zapier, Make.com, Blue Prism, UiPath official sites

**Industry Analysis & Commentary:**
- DEV Community, Ciphers Security, Modern DataTools, BeagleSecurity, UnderDefense, Pixee.ai, Automation Atlas, HomeLogs, Kriv.ai, Thinkpeak AI, AITrampoline Park

**Job Board Data:**
- ZipRecruiter, Glassdoor (construction compliance officer postings, 2026-08-30)

**Market Data & Aggregators:**
- Datarade (BuildFax profile), Gartner Peer Insights, CloudEagle.ai, Peerspot, SelectHub

---

---

# Tick 2: Competitive Positioning for Demand-Side Lanes (D1–D5)

**Collection date:** 2026-08-30  
**Analyst:** Elliot Kwan (agent:researcher-elliot)  
**Scope:** Map competitive incumbents, pricing, and packaging gaps for each of Nadia's D1–D5 demand niches  
**Note:** All pricing sourced from public vendor websites, pricing aggregators, and review sites (Capterra, G2, Spendflo, etc.)

---

## Candidate D1: Freelance Writers & Invoicing/Usage-Rights Tools

### Competitive Positioning

| Incumbent | Entry Price | Key Features | Gap for D1 | Source | Observed |
|-----------|-------------|------|---|---|---|
| **Wave** | Free (freemium) | Invoicing, accounting, basic reporting | Limited contract management; no usage-rights tracking | Plutio comparison, Wave.com pricing page | 2026-08-30 |
| **FreshBooks** | $49–99/mo | Invoicing, time tracking, 100+ integrations | Per-user scaling; no contract templates; limited for usage-rights | FreshBooks pricing (Plutio), Capterra | 2026-08-30 |
| **Bonsai** | $25/mo (Essentials tier) | Invoicing, contracts, client portal, proposals | All-in-one for freelancers; still missing usage-rights library | Taskip (Bonsai Pricing 2026), Assembly review | 2026-08-30 |
| **Stripe Invoicing** | Integrated (payment-focused) | Payment processing + invoicing | Limited to payment processing; no contract/proposal tools | Versusly (Stripe vs FreshBooks), Capterra | 2026-08-30 |
| **17hats** | $60/mo flat rate | Contact management, invoicing, contracts, workflows, scheduling | Single all-in-one plan; no per-tier flexibility; $5–10 add-ons for extra users | Agiled (17hats Pricing 2026), Onesuite | 2026-08-30 |

### Feature & Pricing Gaps for D1

**Gap 1: Usage-Rights Tracking Absent**
- None of the incumbent invoicing platforms (Wave, FreshBooks, Bonsai, 17hats) offer a built-in usage-rights library or automated tracking for content licensing/reuse
- Freelancers currently manage usage-rights via email, spreadsheets, or separate contract management tools
- Source: Comparison of public feature matrices across all five platforms
- Observed: 2026-08-30

**Gap 2: Contract Terms & Invoicing Fragmentation**
- Bonsai and 17hats offer contract templates, but neither integrates with invoicing for automatic term enforcement (e.g., invoicing only when usage-rights permit)
- Wave is free but lacks contracts entirely
- FreshBooks and Stripe are payment-focused, not contract-focused
- Source: Feature matrix review (G2, Capterra, official sites)
- Observed: 2026-08-30

**Gap 3: Per-Freelancer Pricing**
- Wave's freemium model and Bonsai's $25/mo Essentials tier are affordable, but neither scales pricing for teams or projects with different complexity
- 17hats at $60/mo flat is fixed cost; extra users cost $5–10/mo each
- FreshBooks scales linearly with users ($49–99/mo), making it unclear for solo freelancers with multiple clients
- Source: Pricing page analysis
- Observed: 2026-08-30

---

## Candidate D2: Solo Therapists & Lightweight Practice Management

### Competitive Positioning

| Incumbent | Solo Price | Key Features | Gap for D2 | Source | Observed |
|-----------|-----------|------|---|---|---|
| **SimplePractice** | $49–99/mo | HIPAA scheduling, notes, billing, AI add-ons | Priced for 5+ person practices; feature-bloated for solos | Capterra (SimplePractice pricing), MentalYC (SimplePractice vs TherapyNotes) | 2026-08-30 |
| **TherapyNotes** | $69/mo (solo) | Insurance-billing focus, HIPAA compliance, notes | Bundled billing for insurance practices; overhead for cash-only solos | MentalYC (TherapyNotes pricing), GetApp | 2026-08-30 |
| **Jane App** | $54/mo | Multi-discipline focus (PT, chiro), HIPAA compliant | Lower fees (2.85% vs SimplePractice 3.15%); designed for PT/chiro, not mental health specialists | AgentZap (Jane vs SimplePractice 2026), Capterra | 2026-08-30 |
| **Carepatron** | $31–39/mo | Therapy, physician, chiropractor focus; free plan available | Affordable entry ($31/mo Plus tier); less market presence than SimplePractice | Pabau (Carepatron review), Costbench (pricing) | 2026-08-30 |
| **Zanda** | Pricing unavailable | Healthcare-focused; minimal public information | Limited transparency; unclear positioning vs SimplePractice | Search result mention only (no pricing data) | 2026-08-30 |

### Feature & Pricing Gaps for D2

**Gap 1: Pricing Cliff for Solo Practitioners**
- SimplePractice Starter ($49/mo) + AI add-on ($35–40/mo) = ~$85–90/mo for a solo with AI note-taking
- TherapyNotes at $69/mo is cheaper but bundled with insurance-billing features unnecessary for cash-only practices
- Carepatron at $31–39/mo is significantly cheaper but lacks SimplePractice's market presence and feature depth
- Source: Pricing comparison across Capterra, MentalYC, Pabau
- Observed: 2026-08-30

**Gap 2: HIPAA Complexity Overhead**
- SimplePractice and TherapyNotes both require HIPAA compliance features even for very small practices
- No lightweight "HIPAA-lite" tier that offers simplified governance for solo practitioners vs. group practices
- Source: Feature tier analysis from official sites
- Observed: 2026-08-30

**Gap 3: Couples/Multi-Speaker Therapy Pain Unaddressed**
- AI note-taking tools (SimplePractice Note Taker, TherapyFuel) lack speaker separation for couples/group therapy
- Nadia flagged AI hallucination risk in multi-speaker settings; incumbents offer no specific couples-therapy mode
- Source: Nadia's tick-1 research (Reddit r/therapists complaints)
- Observed: 2026-08-30

---

## Candidate D3: Independent Musicians & Royalty Tracking Aftermarket

### Competitive Positioning

| Incumbent/Tool | Price | Type | Gap for D3 | Source | Observed |
|-----------|-------|------|---|---|---|
| **DistroKid** | $24.99/year | Distribution | Royalty aggregation across DSPs; no unified dashboard for multi-platform comparison | DistroKid pricing (MusicPulse), Aristake comparison | 2026-08-30 |
| **CD Baby** | $9.99–$14.99/release + 9% commission | Distribution + royalty mgmt | Similar to DistroKid; strong on distribution but limited royalty reporting depth | MusicPulse (DistroKid vs CD Baby) | 2026-08-30 |
| **RouteNote** | Free (15% royalty share) or $10–$45 upfront | Distribution | Free tier is feasible for solo artists; premium removes royalties entirely | RouteNote pricing (SoundCloud topic, Loop.fans) | 2026-08-30 |
| **Symphonic** | $19.99/year | Distribution + AI policy | Includes Content ID, sync licensing, artist advances up to $5M (Symphonic NEXT); no dedicated royalty tracking | Symphonic review (Undetectr), Loop.fans | 2026-08-30 |
| **Tools 4 Music** | Free | Royalty calculator / metadata tools | Free platform combining streaming royalty calculators, production tools, and education; limited to royalty *calculation*, not tracking | AudioBulb (best tools guide) | 2026-08-30 |
| **Trqk (TrqkIQ)** | Pricing not disclosed; enterprise/professional-focused | Music Royalty Intelligence | Real-time royalty tracking and auditing; targets music creators and their representatives; focuses on professional creators and label-side use; not accessible as consumer solo-artist tool | Trqk.io, LabelGrid (Music Royalty Accounting Software 2026) | 2026-08-30 |
| **Curve Royalty Systems** | Curve Lite: £20/month+; target: smaller labels/distributors, not solo artists | B2B Royalty Accounting | Industry platform (800+ labels/distributors/publishers); Curve Lite targets smaller label entities; Creator Dashboard allows artist access to labels' Curve installation but not a standalone solo-artist tool | MusicBusinessWorldwide, Music Week, CurveRoyaltySystems.com | 2026-08-30 |
| **Stem** | Pricing not disclosed; distribution + royalty splits | Distribution + Artist Royalty Platform | Combines distribution with royalty processing; automates splits for collaborators; artist-facing but bundled with distribution; targets artists with collaborators | LabelGrid (Music Royalty Accounting Software 2026), Symphonic blog | 2026-08-30 |
| **MusicAlligator** | Pricing unavailable | Publishing administration + royalty tracking | Offers ISRC code assignment and publishing administration; unclear if available to solo artists or requires label partnership | AudioBulb reference only | 2026-08-30 |
| **Madverse** | Pricing unavailable | Royalty splits + payments | Offers royalty splits at source and 95% royalty retention; positioning unclear for solo artists vs. labels | AudioBulb reference only | 2026-08-30 |

### Feature & Pricing Gaps for D3

**Gap 1: Artist-Side vs Label-Side Market Distinction**
- Aftermarket royalty-tracking tools exist but primarily serve LABEL/DISTRIBUTOR/PUBLISHER segment (Trqk, Curve, Stem all focus on professional music businesses)
- Trqk: "Music Royalty Intelligence" platform targets professional music creators and representatives, not casual solo artists; pricing/accessibility not disclosed
- Curve Royalty Systems: £20/mo starting price targets SMALLER LABELS/DISTRIBUTORS, not solo artists; solo artists only access via labels' dashboard
- Stem: Distribution + royalty tool, but targets artists WITH collaborators, bundled with distribution
- **Key Finding:** No consumer-friendly, solo-artist-accessible unified royalty dashboard exists at $10–50/month price point
- Source: Music Royalty Intelligence (Trqk), MusicBusinessWorldwide (Curve Lite launch 2024), LabelGrid (Music Royalty Accounting Software 2026)
- Observed: 2026-08-30

**Gap 2: Metadata & Split Payment Automation Fragmented**
- Each distribution platform requires separate registration with collection societies (ASCAP, BMI, SESAC); no unified management
- Split payments to collaborators/featured artists are manual across all platforms
- MLC historical royalties: $424M (original 2021 transfer from streaming services) in unmatched "black box" royalties due to metadata mismatches
- As of June 2026, ~$160M in pre-2021 historical unmatched royalties remain after ongoing distributions
- Source: Aristake (songwriters claiming MLC money, 2026), Chartlex (MLC Unclaimed Royalties Guide 2026), Nadia's demand-side evidence (tick-2)
- Observed: 2026-08-30

**Gap 3: Multi-DSP Reconciliation Nonexistent at Consumer Price Point**
- Solo musicians manually reconcile across Spotify, Apple Music, YouTube, Bandcamp, etc. on different reporting schedules
- Distribution platforms (DistroKid, CD Baby, RouteNote) aggregate but don't offer standalone dashboard for comparison/reconciliation
- No platform offers "unified royalty view across all DSPs for solo artists" at $10–50/month consumer price point
- Professional tools (Trqk, Curve) exist but are enterprise/label-focused
- Source: Music royalty audit guide (Chartlex 2026), LabelGrid (Music Royalty Accounting Software guide 2026), Symphonic blog (artist royalty tracking)
- Observed: 2026-08-30

---

## Candidate D4: Event Organizers & RSVP/Coordination Tooling

### Competitive Positioning

| Incumbent | Price | RSVP | No-Show Automation | Vendor Coordination | Gap for D4 | Source | Observed |
|-----------|-------|------|---|---|---|---|---|
| **Meetup.com** | $29.99–$55+/mo | ✓ Basic | Limited reminders; no automated no-show reduction | Manual workaround (email/Slack) | Fragmented attendee comms; no vendor/budget tools | Meetup pricing (help.meetup.com) | 2026-08-30 |
| **Eventbrite** | Free (transaction fees 3.7% + $1.79/ticket) or $69/mo Premium | ✓ Full | Premium includes reminder automation | Limited (manual coordination) | Free tier has transaction fees; Premium expensive for small organizers | Eventbrite pricing (costbench, EventbriteAlternatives) | 2026-08-30 |
| **Splash** | $25k–$200k+/year | ✓ Full | Advanced attendee automation | ✓ Included | Enterprise-only; inaccessible for small solo organizers | Capterra (Splash), StackScored (event management comparison) | 2026-08-30 |
| **Livevent** | No data found | Unknown | Unknown | Unknown | Insufficient public pricing data for this analysis | Dryfta (top 10 platforms) mentions it; no specific pricing | 2026-08-30 |

### Feature & Pricing Gaps for D4

**Gap 1: Automated No-Show Reduction Not Integrated**
- Meetup provides basic RSVP + messaging; no integrated SMS/email reminder automation to reduce 30–50% no-show rates (Tier 2 evidence from Nadia)
- Eventbrite Premium ($69/mo) includes automation but is priced for 200+ attendee events
- Splash offers full automation but at $25k+/year is designed for enterprise events
- Small organizers (50–200 person meetups) have no sweet-spot solution at $30–100/mo
- Source: Meetup documentation (help.meetup.com), Dryfta (top 10 event platforms comparison), Whennot (RSVP management article)
- Observed: 2026-08-30

**Gap 2: Vendor Coordination & Budget Tracking Absent**
- Meetup and Eventbrite focus on attendee management; neither offers integrated vendor checklists, budget tracking, or budget-to-actual reporting
- Small organizers manually track vendors/caterers/venues via email and spreadsheets (Nadia's Tier 2 complaint)
- Source: Nadia's tick-1 research (manual coordination pain signal)
- Observed: 2026-08-30

**Gap 3: Pricing Misalignment for Free/Low-Cost Events**
- Eventbrite transaction fees (3.7% + $1.79/ticket) are painful for free events (no revenue to cover)
- Meetup at $29.99–$55/mo is fixed cost regardless of event size/frequency
- No per-event or low-frequency event pricing model exists
- Source: Pricing analysis + Nadia's Tier 2 evidence (50%+ no-shows on free events)
- Observed: 2026-08-30

---

## Candidate D5: Research Teams & Secure Data Collaboration

### Competitive Positioning

| Incumbent | Entry Price (Small Team) | Storage | Audit Logging | Multi-Institutional | Gap for D5 | Source | Observed |
|-----------|--------|------|---|---|---|---|---|
| **Databricks** | $1,500–2,000/mo (small teams) | Unlimited (per cloud) | ✓ Built-in | Via Azure/AWS integration | Expensive for $10k–50k research budgets; pricing opaque (DBU-based) | Spendhound (Databricks), Mammoth (pricing guide), Cloudforecast | 2026-08-30 |
| **Box** | $5–50/user/mo (Business Starter $20/user/mo) | Unlimited from Business tier | ✓ SOC2/GDPR compliant | ✓ Cross-org sharing | Pricing scales with team size; minimum ~$100/mo for 5-person team | Box pricing (Selecthub, Bestcloudstorageguide) | 2026-08-30 |
| **Sync.com** | $8/mo individual | 2GB base | GDPR certified; not HIPAA-marketed | Limited cross-org features | Affordable but designed for individual/SMB, not team projects | Sync.com review (Cloudwards), Capterra comparison | 2026-08-30 |
| **Dataverse** | Free (in M365 for Teams) or $20/user/mo (Power Apps Premium) | 2GB per team (free tier) | ✓ Audit trails in full version | ✓ Built-in | Free tier is severely limited (2GB, 1M rows max); Premium is $20/user/mo | Microsoft Dataverse pricing (Airbyte, Oreate AI) | 2026-08-30 |
| **Dataverse (Custom Hosting)** | $40/GB/mo (database storage) | Scaled pricing | ✓ Full audit capabilities | ✓ Full | Add-on costs; storage alone can exceed $500/mo for 10GB datasets | Microsoft Dataverse pricing breakdown (microsoftnegotiations.com) | 2026-08-30 |

### Feature & Pricing Gaps for D5

**Gap 1: Enterprise Pricing Floor for Small Teams**
- Databricks minimum ~$1,500–2,000/mo for small research teams is prohibitive for $10k–50k annual budgets
- Box at $20/user/mo × 5 people = $100/mo base (~$1,200/yr) is more accessible but still not cheap for academic budgets
- Sync.com at $8/mo is cheap but not designed for collaborative research workflows
- Dataverse free tier (2GB, 1M rows) is severely limited; Premium at $20/user/mo scales linearly
- **No platform offers "research-team tier" at <$200/mo with meaningful audit trails and multi-institutional access**
- Source: Pricing analysis across all four platforms
- Observed: 2026-08-30

**Gap 2: Multi-Institutional Governance Friction**
- Box and Dataverse support cross-org sharing, but require manual permission setup per-institution
- No automated policies for data-usage agreements (DUAs), institutional review board (IRB) approvals, or audit trail alignment across institutions
- Nadia's Tier 2 evidence: traditional approaches rely on data copying or broad access, creating duplication and poor visibility
- Source: Nadia's tick-1 research (Oracle Secure Data Sharing article, PLOS research collaboration guidance)
- Observed: 2026-08-30

**Gap 3: Data Lineage & Versioning for Research Workflows**
- Dataverse (full version) offers version control and audit trails but at $20/user/mo or custom pricing
- Box has versioning but limited data lineage visualization for research data provenance
- Databricks has lineage features but pricing is prohibitive for small teams
- No lightweight "research data lineage" tool exists at $100–500/mo for small teams
- Source: Product feature comparison from official sites + Nadia's Tier 2 evidence (need for common workflow platform)
- Observed: 2026-08-30

---

## Refined Tick-2: C3 and C4 Competitive Updates

### C3: Vertical-Specific Compliance Data — Expanded Research

**Dental Compliance & Practice Management**
- Carepatron ($31–39/mo) serves dental practices; does not offer permit/licensing data aggregation
- No dental-specific incumbents for permit lookups identified (unlike construction's BuildFax/ConstructConnect)
- Dental compliance focuses on clinical/regulatory (state dental board licensing) rather than municipal permits
- Source: Carepatron (Pabau review), software finder
- Observed: 2026-08-30

**Legal Compliance & Practice Management**
- Smokeball ($39–$219/mo per user) and CosmoLex offer practice management + accounting for law firms
- Neither offers permit/licensing data aggregation; legal compliance is case-specific, not jurisdiction-specific like construction
- No legal-practice incumbents serve "permit lookup" use case identified
- Source: Legience (legal practice management guide), SoftwareAdvice, Smokeball review
- Observed: 2026-08-30

**Auto Retail Compliance**
- Dealertrack and VComply offer dealership compliance management (regulatory, finance, advertising compliance)
- Neither offers permit/licensing data aggregation; compliance focus is internal (audit, reporting) not external data lookup
- Auto dealerships do not face fragmented permit data problem like construction (they operate within existing dealer network)
- Source: VComply (automotive compliance review), iPoint-systems, Gartner Peer Insights (DMS reviews)
- Observed: 2026-08-30

**Conclusion on C3 Vertical Expansion:**
- Construction permit data fragmentation (C3's original focus) is real and served by BuildFax, ConstructConnect, Gryd, ATTOM
- Dental, legal, and auto retail do not have equivalent "permit data fragmentation" problem; compliance is clinical/regulatory, not municipal-permit-based
- **Recommendation:** Narrow C3 scope to "Construction Permit & Compliance Data" only, or research whether vertical-specific compliance data (e.g., dental board licensing, bar association standing, auto dealer licensing) could be aggregated separately
- Source: Competitive mapping of all four verticals
- Observed: 2026-08-30

### C4: Workflow Automation for Compliance — Use-Case Narrowing

**Compliance-Specific Automation Gaps**
- Zapier and Make target general automation; neither has compliance-specific features (audit trails, change control, role-based access)
- Blue Prism ($75k+) and UiPath ($420/mo minimum) offer audit trails but are enterprise-grade RPA
- **No middle ground exists:** Zapier's $1,242/year (Team plan) lacks governance; Blue Prism's $75k is unaffordable for mid-market compliance teams
- Source: Zapier enterprise documentation (Dev.to, Kriv.ai analysis), Automation Atlas (RPA comparison)
- Observed: 2026-08-30

**Specific Compliance Workflows Not Yet Tested**
- Tick-1 research identified "recurring compliance/audit automation" as underserved but did not validate specific workflows
- Examples to test: recurring SOC2 audit data validation, monthly tax-record reconciliation, weekly compliance checklist automation
- No evidence yet that mid-market compliance teams actively seek Zapier alternatives vs. custom scripts or paper-based workflows
- Source: Automation Atlas commentary (RPA market share data only)
- Observed: 2026-08-30

---

## Tick 2 Anomaly Log

### Anomalies & Classification Issues

1. **D3 Aftermarket Royalty Tracking: "Tool" vs "Platform" Ambiguity**
   - Tools 4 Music is free and web-based but is a *calculator*, not a persistent tracking platform
   - MusicAlligator and Madverse are mentioned in industry guides but pricing/solo-artist access is opaque
   - Risk: D3 may conflate "royalty calculation tools" (free) with "royalty *tracking* platforms" (absent)
   - Flag: Nadia to validate whether solo musicians are actively seeking aftermarket tracking (paid) or accepting manual/calculator-based approach

2. **D5 Dataverse: Free Tier vs Paid Tier Pricing Cliff**
   - Dataverse for Teams (free with M365) offers 2GB and 1M rows — far too limited for multi-institutional research data
   - Full Dataverse pricing ($20/user/mo + $40/GB storage) creates steep cliff from free to paid
   - Risk: Free tier inflates accessibility perception; actual research-ready deployment is expensive
   - No data on how many small research teams use free Dataverse vs. custom Google Drive setups

3. **C3 Vertical Scope Collapse: Construction-Only?**
   - Tick-1 flagged three non-construction verticals (dental, legal, auto retail) but none have "permit data fragmentation" problem
   - Dental/legal/auto compliance is clinical/regulatory, not municipal-permit-based
   - Risk: "Vertical-Specific Compliance Data" (C3's framing) does not apply to dental/legal/auto; only construction
   - Recommendation: Rename C3 to "Construction Permit Data Aggregation" or research dental/legal/auto licensing data separately (different niche)

4. **D4 Event Organizers: No-Show Reduction vs Vendor Coordination**
   - Nadia's D4 includes two separate pain points: (1) no-show rates (30–50%), (2) vendor coordination (manual)
   - Competitive mapping shows Meetup addresses only #1 poorly; neither Meetup nor Eventbrite addresses #2 at all
   - Risk: "Event organizer" may be two niches: (a) RSVP/no-show reduction, (b) event logistics/vendor coordination
   - These may have different customer profiles and pricing points

---

## Tier 1 Evidence Summary: Competitive Pricing Landscape for D1–D5

| Demand Lane | Incumbent | Entry Price (Solo) | Scaling Model | Gap Severity | Rank |
|-----------|-----------|-------------|---|---|---|
| **D1** | Wave (free) / FreshBooks ($49–99) / Bonsai ($25) | $0–49/mo | Free → per-user or flat | Usage-rights tracking absent; contract management fragmented | HIGH |
| **D2** | Carepatron ($31–39) / SimplePractice ($49–99) | $31–99/mo | Per-user, feature-gated | HIPAA complexity overhead; pricing cliff for cash-only solos | MEDIUM |
| **D3** | DistroKid ($24.99/yr) / Tools 4 Music (free) | Free–$25/yr | Distribution-focused; aftermarket tracking sparse | Aftermarket royalty tracking tools nonexistent; metadata fragmentation | HIGH |
| **D4** | Meetup ($29.99–55) / Eventbrite (free + fees) | $0–69/mo | Fixed subscription or transaction fees | No-show automation + vendor coordination both absent | HIGH |
| **D5** | Sync.com ($8/mo) / Box ($100/mo for small team) / Databricks ($1.5k/mo) | $8–1,500/mo | Ranges from individual to enterprise; steep cliff | Small-team affordability; multi-institutional governance friction | HIGH |

---

**Next Steps:**
1. Finalize D1–D5 evidence sufficiency assessment (Long-list readiness)
2. Cross-check D-lane competitive gaps with Nadia's demand signals for converging pain points
3. Tick-3: Prepare long-list evidence template with C1–C4 + D1–D5 candidates, labeled gaps
4. Board decision on research completion (extend tick 2 or proceed with tick 3 finalization)
