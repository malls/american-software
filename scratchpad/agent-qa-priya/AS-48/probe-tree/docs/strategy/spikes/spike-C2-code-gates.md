# Spike 1 Findings — Candidate C2: Lightweight Code-Quality Gates (Small Dev Teams)

**Author:** Marcus Webb (`agent:developer-marcus`), on assignment from the orchestrator.
**Date:** 2026-08-31 (one tick, timeboxed). **Budget:** $0 spent — no API keys, no
signups, no paid services. Local OSS tools installed via Homebrew; license texts
fetched from the projects' own canonical sources.
**Scope:** the four spike-must-test items signed in 04-scores-cto.md §C2, incorporated
by 05-finalists.md §6. This memo reports measurements; selection remains with the
step-3 debate. Throwaway benchmark code and raw outputs live in the session
scratchpad only and are not committed anywhere, per the spike rubric.
**Benchmark host:** Apple M1 Max, 10 cores, 32 GB RAM (this machine — a fast dev
laptop; cloud-vCPU derate applied below where extrapolating).

---

## 1. License vet — OSS engines, rulesets, vuln DBs for hosted commercial use

Method: read the actual LICENSE file (or canonical license page) of each component,
fetched 2026-08-31 from the project's own repo/site. Verbatim license names below.
This is the CTO's carried co-sign item (03-gate-verdicts.md), and the headline is:
**the engines and the vulnerability data are clean; the two best-known Semgrep
rulesets are not.** A fully licensable stack exists but is thinner than the
"default" stack everyone benchmarks with.

| Component | Role | License (verbatim, as read) | Hosted commercial use? |
|---|---|---|---|
| Semgrep engine (semgrep/semgrep, CE) | SAST engine | GNU Lesser General Public License v2.1 | **Yes** (server-side use is not distribution; LGPL obligations don't trigger) |
| Semgrep Registry rules (semgrep/semgrep-rules, `p/default` etc.) | SAST rules | Semgrep Rules License v1.0 | **No** — see quote below |
| Opengrep engine (opengrep/opengrep) | SAST engine (fork) | GNU Lesser General Public License v2.1 | **Yes** |
| opengrep-rules (opengrep/opengrep-rules) | SAST rules (fork of pre-relicense semgrep-rules) | LGPL 2.1 **+ "Commons Clause" License Condition v1.0** | **No** — Commons Clause bars providing "for a fee … a product or service whose value derives, entirely or substantially, from the functionality of the Software" |
| GitLab sast-rules (gitlab-org/security-products/sast-rules) | SAST rules (Semgrep-syntax) | MIT ("MIT Expat"; per repo LICENSE, content outside doc/ee/jh is MIT) | **Yes** ⚠ per-file provenance audit is a lawyer follow-up |
| Trail of Bits semgrep-rules | SAST rules | GNU Affero General Public License v3 | **Conditional** — commercially usable but strong copyleft; lawyer call before inclusion |
| ESLint | JS lint engine | MIT | **Yes** |
| eslint-plugin-security (eslint-community) | JS security rules | Apache License 2.0 | **Yes** |
| Bandit (PyCQA) | Python SAST, rules built in | Apache License 2.0 | **Yes** |
| Gitleaks, incl. default rules | Secrets scanning | MIT License | **Yes** |
| osv-scanner (google) | SCA engine | Apache License 2.0 | **Yes** |
| GitHub Advisory Database | Vuln data (npm/pip/etc.) | Creative Commons Attribution 4.0 International (CC-BY 4.0) | **Yes**, with attribution |
| Go vulndb (golang/vulndb) | Vuln data (Go) | entries: CC-BY 4.0 (code: BSD-style) | **Yes**, with attribution |
| NVD (NIST) | Vuln data | U.S. government work (public domain; NIST asks attribution, no endorsement implied) | **Yes** (not re-read this tick — cited from prior knowledge, flag for lawyer pass) |
| OSV.dev aggregate feed | Vuln data aggregation | per-source terms (aggregator; no single license found in FAQ this tick) | **Mostly yes** — per-source review is a lawyer follow-up |
| Trivy engine / trivy-db (aquasecurity) | Container/SCA | Apache License 2.0 / Apache License 2.0 (DB code; DB *contents* aggregate per-source terms) | **Yes** / ⚠ contents per-source |

The operative clause that kills the default Semgrep ruleset for us, quoted from
semgrep.dev/legal/rules-license (Semgrep Rules License v. 1.0, last updated
2024-12-13, fetched 2026-08-31):

> "You may use the rules only for your own internal business purposes. This
> license does not allow you to distribute the rules, or to make them available
> to others as a service."

A hosted paid scanning service is exactly "available to others as a service."
The Opengrep fork's rules carry a Commons Clause with the same practical effect.
Using either ruleset in the product is off the table absent a commercial license
from Semgrep, Inc.

**Licensable stack that exists today:** Semgrep or Opengrep engine (LGPL-2.1) +
GitLab sast-rules (MIT) + Bandit (Apache-2.0) + eslint-plugin-security
(Apache-2.0) + Gitleaks (MIT) + osv-scanner (Apache-2.0) over GitHub Advisory
DB / Go vulndb (CC-BY 4.0) and NVD. Every layer has a verbatim-named permissive
license. Cost of the restriction: rule breadth (measured in §3 — the MIT ruleset
found 8 findings on flask where the registry default found 16), and ruleset
gap-filling becomes our own maintenance surface.

**Lawyer follow-ups before any of this ships:** (1) GitLab sast-rules per-file
provenance (were any rules copied from semgrep-rules before its relicense?);
(2) OSV per-source license sweep; (3) CC-BY attribution implementation; (4) LGPL
compliance posture statement for the engine; (5) re-read NVD terms directly.

## 2. Measured scan compute vs. the <$100/repo/mo bar

Three real public repos, shallow-cloned, full out-of-box pipeline = Semgrep
(`p/default`, rule cache pre-warmed so download time is excluded) + Gitleaks
(filesystem mode) + osv-scanner (lockfile). Tool versions: semgrep 1.175.0,
gitleaks 8.30.1, osv-scanner 2.5.1. Registry rules were used for *measurement
only* — internal business purposes, which their license permits.

| Repo | Scale (code LOC) | Semgrep wall | Gitleaks wall | osv-scanner wall | Full-scan wall | Full-scan CPU-s (user+sys) |
|---|---|---|---|---|---|---|
| pallets/flask (Python) | ~18k | 4.2 s | 0.2 s | 0.6 s | **5.0 s** | ~8.6 |
| gin-gonic/gin (Go) | ~24k | 3.7 s | 0.3 s | 5.4 s | **9.4 s** | ~12.9 |
| outline/outline (TS app, ~340k LOC — upper end of small-team scale) | ~340k | 25.3 s | 1.2 s | 1.6 s | **28.2 s** | ~115 |

Extrapolation (assumptions stated, not hidden): worst case 50 scans/repo-day
(every push on a very active team). Rate basis: DO Basic Droplet 2 vCPU/4GB at
$24/mo ≈ $0.0164/vCPU-hr — published price as remembered, not re-verified this
tick. Applying a 3× derate for cloud vCPU vs. M1 Max performance cores:

- **outline-class repo (worst case measured): 115 CPU-s × 50/day ≈ 48 vCPU-hr/mo
  ≈ $0.79/mo raw, ≈ $2.40/mo derated.**
- flask/gin-class repo (typical 2–10-dev repo): ≈ $0.07–0.11/mo raw, ≈ $0.2–0.3/mo derated.

Headroom against the <$100/repo/mo shape is **>40× on the worst measured case**.
Compute is not the binding constraint on this candidate. Not measured (listed,
not guessed): peak RSS/memory sizing, clone bandwidth/egress, queue and
orchestration overhead, results storage. All are plausibly small relative to 40×
headroom but none is measured.

## 3. Out-of-box false-positive feel (measured sample, eyeball-classified)

Finding counts, out of the box, no tuning: semgrep `p/default` — flask 16,
gin 40, outline 93 (149 total). Gitleaks — flask 6, gin 4, outline 11 (21 total).
osv-scanner — flask 2, gin 2, outline 0 distinct vuln IDs.

Classified sample (40 findings: all 16 flask semgrep, all 21 gitleaks, the 3
outline ERROR-severity semgrep), one engineer's judgment, labeled as such:

- **Gitleaks: 21/21 non-actionable.** Every hit was a docs placeholder, test
  fixture, test certificate, or embedded constant (e.g., flask's `docs/config.rst`
  examples, gin's `testdata/certificate/key.pem`, outline's `.env.test` and
  passkey AAGUID tables). Zero real secrets — expected on mature public repos,
  but it means out-of-box secrets scanning is 100% triage until path/fixture
  suppression exists.
- **flask semgrep: ~0/16 actionable.** 8 were a Django CSRF rule firing on Flask
  (wrong framework — outright FP); 3 SRI warnings on example HTML; the rest are
  true detections of deliberate framework behavior (`eval` in the CLI, `exec` in
  config loading, SHA-1 in session key derivation) — every one demands human
  context to dismiss.
- **outline ERROR-severity: ~2/3 plausibly actionable** (`secrets-inherit` in two
  workflow files is a real hygiene issue; `detect-child-process` in a build
  script is expected behavior).

Sample actionable rate: **~2/40 (~5%)**. This is a measured *feel* on library-ish
and app repos, not a labeled-ground-truth benchmark — but it directly confirms
the C3 rationale's claim that support in this category is false-positive triage,
and it is the product surface (curation, dedup, path-aware suppression, "example
code" detection) where the differentiation would have to live. Note also the
ruleset-license interaction: the licensable MIT ruleset produced 8 findings on
flask vs. 16 from the registry default — roughly half the volume, similar
signal-per-finding on eyeball (it kept the eval/exec/SHA-1 detections, dropped
the wrong-framework Django noise).

## 4. $0 integration layer sketch and token-custody blast radius

Sketch (feasible at $0 to build and operate at spike scale; **not exercised this
tick** — registering even a free GitHub App is a signup, which the spike rules
barred): a GitHub App with `contents:read` + `checks:write` on customer-selected
repos; webhook on push/PR; worker mints a short-lived (~1 h) installation token,
shallow-clones to an ephemeral workspace, runs the licensable stack (§1), posts
results as a check run, deletes the workspace. Published GitHub App rate limits
(≥5,000 req/hr/installation) are far above the webhook+clone+check-run traffic
of a 50-scan/day repo. Numbers here are from GitHub's published docs, not
measured.

Token-custody blast radius, stated honestly: the service holds the **App private
key**, which can mint read tokens for *every customer's selected repos*.
Compromise of that key or of a scan worker is read access to all customer source
until the key is revoked — a breach of us is a breach of them, exactly as the C3
rationale put it. Mitigations are standard but mandatory (key in KMS/HSM, never
on workers; workers get only per-job short-lived tokens; `contents:read` floor;
ephemeral clones with no retention; per-customer repo selection), and they reduce
but do not eliminate the asymmetry. This is a permanent standing obligation, not
a launch task.

## 5. Verdict

The measurements support **C2 = 4 and C3 = 3 as scored, with the C2 caveat now
sharpened from "unvetted" to "vetted with a named restriction":** the OSS-baseline
premise holds for engines (LGPL-2.1/Apache-2.0/MIT, all clean for hosted use) and
for vulnerability data (CC-BY 4.0 / public domain), but fails for the two
best-known Semgrep rulesets (Semgrep Rules License v1.0 and Commons Clause both
bar service use), leaving a real but thinner licensable path (GitLab MIT rules +
Bandit + eslint-plugin-security + Gitleaks) whose breadth gap becomes our
maintenance surface — consistent with 4, not 5, and not lower. Compute clears the
<$100/repo/mo bar by more than 40× on the worst measured repo, so C3's cap is
confirmed to come from the standing obligations, not unit economics: the measured
~5%-actionable out-of-box sample confirms permanent FP-triage labor, and the
token-custody analysis confirms the asymmetric tenancy risk — which is precisely
a 3. Nothing measured this tick supports moving either score in either direction.

---

*Raw benchmark outputs, timing files, and fetched license texts: session
scratchpad (throwaway, per spike rules). Repos benchmarked at their 2026-08-31
HEADs via shallow clone. Nothing in this spike touched Lattice, per the rubric's
strategy-work carve-out.*
