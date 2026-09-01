# D1 v1 — Stack Decision for the Product App

**Author:** Owen Kessler, CTO (`agent:cto-owen`). **Date:** 2026-08-31.
**Task:** AS-36 (spine task 1 of D1 v1). **Plan:** `.lattice/plans/task_01M1D34MRX0ZKT9NRQXXA1S9ZA.md`.
**Implements:** `docs/engineering/00-d1-v1-milestone-plan.md` §3 row C-01, which is
`IN (mandate)` under `docs/design/00-frontend-design-plan.md` §4 Phase C.
**Status:** decision record. Amendments land in §13 or they did not happen.

**Read this document in order.** §9 (what it would take to reverse this) sits
deliberately **before** §10 (the recommendation). A recommendation read before its
reversal cost is read is a recommendation read wrong.

**One procedural note, so no future reader has to re-adjudicate it.** The CTO's
standing constraint (`.claude/agents/cto-owen.md`) is that nothing is committed —
"no product, no market, no company name, **no technology stack**" — until the board
and cofounders run an explicit, tracked, board-green-lit decision process in a
Lattice task. That constraint is **discharged here on its own terms, not violated**:
the process ran (`docs/strategy/01`…`08`), the board green-lit D1
(`docs/strategy/08-board-decision.md`), and AS-36 *is* the explicit tracked Lattice
task the clause contemplates.

**A second note, on sequencing.** Phase C originally required this decision to come
after the wireframes (AS-30). That rule was a **proxy** for a condition — "before the
flows and the product are fixed" — and the proxy came apart from the condition when
the board fixed the product and the milestone plan fixed the capability set, the
seven screens, and a filter forbidding the surface from growing. The full reasoning,
and the original sentence quoted rather than deleted, is in the dated amendment at
`docs/design/00-frontend-design-plan.md` §Phase C. The residual risk that wireframes
could still embarrass this decision is carried as trigger **T1** in §9.1.

---

## 1. What this decision fixes, and what it leaves open

An unscoped decision record is how the same argument gets had twice. So, explicitly:

**Fixed here (six slots).** (1) server runtime and language; (2) HTTP layer;
(3) rendering model; (4) test runner and how tests are invoked; (5) container /
compose shape; (6) **dependency policy** — the *rule* for admitting a dependency,
not a list of approved ones.

Item 6 is the one that outlives the rest, and it is the reason this task exists
rather than being answered by "do what the chat app does." Frameworks get replaced;
the rule for taking on a dependency is what determines what the codebase becomes.
It is written in §11 as a rule a reviewer can apply to a dependency nobody has
proposed yet.

**Verdict required (one).** The **data store**. AS-36's own description permits
leaving this open. It is nonetheless **closed here** (§8.2), because AS-39 is the
next fan task and has no criteria of its own to decide it against — deferring would
relocate the same decision to a place with less information.

**Also closed here (one), which AS-36 did not require.** Whether the Stripe client is
the official SDK or hand-rolled (§8.1). AS-38 *is* the custody guard; handing this
down would make AS-38 inherit a decision with no criteria to make it against.

**Out of scope, restated so it is not re-litigated.** Writing any application code
(that is AS-37). Choosing a host — Digital Ocean is the standing infra rule
(`CLAUDE.md ## Infra`) and nothing here is a hosting decision. Anything about
deployment shape beyond "does not foreclose Digital Ocean"; production deployment is
row C-46, `OUT` of v1, milestone M1.

---

## 2. Criteria: gates, discriminators, and how they combine

### 2.1 The criteria and where they came from

Seven are fixed in AS-36's description and are **not re-derived here** — they came
from the record, not from taste. The eighth was derived during AS-36 planning from
the sequencing verdict; its derivation is stated so it cannot be mistaken for
invented preference.

| # | Criterion | Provenance |
|---|---|---|
| (a) | Implementable by agent ICs working from **text alone** | AS-31 plan §9.1; the company's execution model (`CLAUDE.md`) |
| (b) | Runs under **docker compose** | `CLAUDE.md ## Infra` |
| (c) | Full test suite runs with **no external accounts and no network egress** | Milestone plan §8.2 right-sizing test 3; AS-37's acceptance property |
| (d) | **No paid services or licences — $0** | `PHILOSOPHY.md` #6; board rule that all spend is a board ask |
| (e) | Permits every Stripe call behind a **single enforceable chokepoint** | Milestone plan §5, assumptions A2/A3; spike §1 forbidden shape |
| (f) | Does not foreclose **Digital Ocean** deployment | `CLAUDE.md ## Infra`; milestone M1 |
| (g) | Consumes `docs/design/tokens/tokens.css` with **no build-step fight** | Design plan §5; AS-29's delivered artifact |
| (h) | **Reversal cost is concentrated**: the front-end choice is separable from the server choice | Derived from the fact that AS-30 had not landed when this was decided. Being wrong about the front end must not cost the server fan |

### 2.2 Why there is no weighted score

**There is deliberately no weighted scoring table.** Eight criteria × three candidates
with invented weights is arithmetic that launders a preference: the weights are
unfalsifiable, and a reviewer cannot tell which criterion actually decided. Instead
the criteria are split into gates and ranked discriminators.

**Gates — pass/fail. A failure eliminates the candidate outright.**

> **(b)** compose · **(c)** tests with no accounts and no network egress ·
> **(d)** $0 · **(e)** enforceable chokepoint

Each gate is adjudicated **on executed evidence** — what was run, and what came
back. A gate marked "pass" on argument alone is a defect in this document. §5 records
the runs.

**Discriminators — compared among survivors, in this fixed order:**

1. **(a) implementable from text alone.** Highest, and it is not close. This is the
   one criterion where this company differs from every other company: our ICs have
   no IDE, no autocomplete, no debugger, no runtime to poke at, and **no way to ask
   a question mid-task**. A stack that is meaningfully worse for a text-only
   implementer is a bad trade here even if it is better for a human — and note that
   the trade is stated as a direction, not as a measured exchange rate.

   **How (a)'s own sub-measures combine, since it has several.** §2.2 refuses invented
   weights across the eight criteria; refusing them there and then quietly applying
   them *inside* the top criterion would be the same error one level down. So the same
   rule applies recursively: **the sub-measures are read lexicographically, not
   averaged.** Their order, fixed here: (1) **M5 cold-error legibility in the
   verification loop the IC actually runs** — a stack that reports a live bug as green
   is disqualifying before anything else is weighed; (2) **M4 IC context cost**, the
   most direct measure of "how much must be read to change something"; (3) **M1 size**;
   (4) the implementers' conventional-vs-bespoke characterisation. Anything not on this
   list — including the friction-log tallies — is **context, not a sub-measure**, and
   decides nothing.
2. **(h) separability / concentrated reversal cost.** Second, because the decision to
   proceed ahead of AS-30 is *conditional on it* — it is the mechanism that makes
   proceeding safe rather than merely defensible.
3. **(g) token consumption with no build-step fight.** Third; near-gate, since AS-29
   shipped a plain-CSS artifact whose own header states "no build step."
4. **(f) Digital Ocean deployable.** Last, and stated plainly: it has **near-zero
   discriminating power**. Everything under consideration is a Node process in a
   container. It is recorded and moved past, not dressed up as a differentiator.

**Combination rule: lexicographic, not weighted-sum.** Apply the gates first
(eliminate), then compare survivors on discriminator 1; if and only if they are
genuinely tied there, move to 2, and so on. **The winner wins on the highest-ranked
discriminator where the candidates actually differ, and this document must name that
criterion and show where they differed.** Lexicographic ordering is chosen precisely
so the decisive criterion is *nameable* — if you cannot say which criterion carried
the decision, you cannot say what would reverse it, and §9 would be a wish.

**What "genuinely tied" means.** This threshold was *not* stated when the criteria were
fixed, and an independent blind re-derivation of this document flagged the omission as
sitting at its single most load-bearing joint. It is therefore defined here, with the
weakness admitted: **defining it after seeing the data is worse than defining it
before.** Two candidates are genuinely tied on a discriminator when either (i) **no
sub-measure of that discriminator differs by more than 10%**, or (ii) the sub-measures
that do differ **point in opposite directions** with no principled way to net them.
Applied to the decision actually made (§10.2): the deciding sub-measure differs by
**35%**, and every other differing sub-measure points the same way — so the conclusion
does not depend on where exactly inside a plausible range the line is drawn. Had the
gap been 8%, or had the sub-measures disagreed in direction, the tie-break below would
have fired.

**Tie-break, declared in advance so it cannot be smuggled in later:** where candidates
are genuinely tied on a discriminator, **the tie goes to the incumbent shape** (§4) —
it is the only candidate with measured operating evidence inside this company, and
switching cost is real. Declaring this up front is what makes the recommendation
falsifiable: **a challenger must *win* a discriminator, not merely match one.**

---

## 3. Candidates

### 3.1 The selection rule, stated before the candidates

The rule is mechanical, so that the slate is not a list of the author's friends.

**Count: exactly three.** Two is a justification wearing a comparison's clothes; four
or more does not finish inside the time-box and the marginal candidate is always a
strawman. Three, chosen to **vary one axis at a time** across the two axes the
criteria actually bite on:

- **Axis 1 — dependency policy:** zero-dependency ↔ a bounded dependency budget.
- **Axis 2 — rendering model:** server-rendered HTML ↔ client-rendered with a build
  step.

### 3.2 The slate

| Cell | Candidate | Representative | Why it is in the comparison |
|---|---|---|---|
| **C1** | zero-dep, server-rendered | Node 24 standard library only: `node:http`, `node:test`, `node:sqlite`, hand-written HTML templating. **The incumbent shape**, applied to the product. | In **by right**, not by merit — the only option with measured operating evidence inside this company (§4). |
| **C2** | bounded deps, server-rendered | **Express 5 + EJS + Zod** on Node 24, `node:test`, hand-written progressive-enhancement JS for the repeating group. | Isolates **axis 1** against C1: does a dependency budget buy anything, holding rendering constant? |
| **C3** | bounded deps, client-rendered + build step | **Next.js 16 (App Router) + React 19** on Node 24. | Isolates **axis 2** against C2. In because it is the mainstream industry default, and rejecting the default without evaluating its strongest form would make this document decoration. |

**Why each representative was chosen for its cell, and what it stands in for.**

- **C1** — there is only one zero-dependency server-rendered Node stack; the standard
  library is the cell. `node:sqlite` and `node --test` are built-ins, not
  dependencies.
- **C2** — Express is the longest-established Node server framework and EJS keeps HTML
  as HTML; both are chosen for corpus stability, which is the property that matters
  most under discriminator (a). *Observed rather than asserted:* neither produced a
  convention mismatch for its implementer, while Zod and Next both did (§10.3). Zod is
  included as the mainstream schema validator. It **stands in for** Fastify + eta,
  Koa + Pug, Hono with server-rendered JSX, and — per the plan's instantiation rule —
  for "C1 plus a light progressive-enhancement layer such as htmx", which belongs in
  this cell rather than smuggled in as a fourth candidate.
- **C3** — Next.js is chosen to give the client-rendered cell its **strongest**
  representative rather than a convenient strawman: it has first-class form handling
  and server components, so the cell is evaluated at its most capable. That is a
  judgment about representative selection, not a measured claim. It **stands in for**
  React Router 7 /
  Remix, SvelteKit, and Nuxt. **The axis is defined as "there is a build step and a
  client runtime is shipped and hydrated"** — Next's server-component capability
  makes it the strongest member of that cell, not a member of C2.

### 3.3 The fourth cell, excluded before evaluation

| Cell | Verdict | Reason |
|---|---|---|
| zero-dep, client-rendered (no build step) | **Excluded before evaluation** | A client-rendered app with no dependencies and no build step is either C1 with extra steps or a hand-rolled framework, and a hand-rolled framework fails discriminator (a) by construction — an IC would have to learn a framework that exists nowhere in any training corpus and is documented only by its own source. §4's `app.js` projection is the measured form of this argument. |

Recorded here rather than omitted, in the style of the capability table's `OUT` rows:
a reader should see what was considered, not only what survived.

---

## 4. The chat app: evidence, not precedent

AS-36's description and the AS-31 plan both assert this. Asserting it is not arguing
it, so here is the argument, in three separable claims.

### 4.1 What it genuinely evidences, and it is not nothing

A zero-dependency Node app using `node:sqlite` and `node --test`, running under
compose, was built and *maintained* by agent ICs in this company across 25+ merged
tasks — including production bug fixes, a live SSE transport, a mobile-responsive
UI, and a headless watcher.

Measured (2026-08-31, `apps/chat`, `node_modules` excluded):

| Quantity | Value | Method |
|---|---|---|
| Total JS | **9,920 lines** | `find . -name '*.js' -o -name '*.mjs' \| grep -v node_modules \| xargs wc -l` |
| Test files | **17** | `ls test/*.js \| wc -l` |
| Direct dependencies | **0** | `package.json` — `dependencies` and `devDependencies` both absent |
| `node_modules` in repo or image | **none** | `ls -d node_modules` → absent; `Dockerfile` runs no install |

No competing candidate can produce anything comparable, and nothing about the
product invalidates that evidence.

### 4.2 Where the evidence does not reach — specifics, not a hedge

**No third-party integration.** The chat app calls nothing external. The product's
core is Stripe: webhook signature verification, idempotency, and state transitions.
The zero-dependency posture has never been tested against *do we hand-roll an HTTP
client and HMAC verification, or take Stripe's SDK?* That question is settled on its
own evidence in §8.1 rather than by extrapolation.

**No untrusted users.** The chat app has no adversary. The product has sessions,
credentials, and client-facing surfaces. CSRF, session handling, cookie flags, and
output escaping are things a framework supplies for free and hand-rolled code gets
wrong. **This is the strongest argument against naive extrapolation from the chat
app**, and it is recorded here rather than omitted because it is inconvenient for
the incumbent. It is answered — not dismissed — in §10.3.

**`public/app.js` is a warning, not a template.** Measured: **46,868 bytes / 1,197
lines in one file with no module boundaries**, 65.6% of the app's 71,457 bytes of
front-end JS, containing 11 distinct render surfaces.

The milestone plan requires this be *projected*, not hand-waved. The product is
**7 screens × ~5 states ≈ 35 states**.

| Method | Projection | Note |
|---|---|---|
| Per render surface: 46,868 / 11 = **4,261 B**, × 35 states | **~149,125 bytes ≈ 3,809 lines in one file** | The defensible estimate |
| Whole chat front end (71,457 B) treated as one screen, × 7 | ~500,199 bytes | **Upper bound only** — over-projects, because chat's transport, markdown, and scroll infrastructure does not scale per screen |

**Verdict on the observable: the pattern fails discriminator (a).** The projection is
**3.2× `app.js` itself**, which is already **the largest application source file this
company has written** (next largest: `apps/chat/lib/store.js`, 36,572 bytes — the
projection is 4.1× that). Stated precisely so it is not inflated: two *non-application*
files in the repo are larger than `app.js` — `docs/design/style-reference/index.html`
at 84,362 bytes and `docs/design/tokens/tokens.test.mjs` at 75,613 — and the projection
is 1.8× the larger of those. A text-only implementer cannot modify a ~3,800-line
module with no internal boundaries without collateral damage.

This finding is load-bearing and it is narrower than it first looks: **it condemns
the *pattern* (a monolithic hand-rolled client-side front end), not the zero-dependency
*posture*.** Its two consequences are carried forward rather than noted and forgotten:
it is the measured basis for excluding the fourth cell (§3.3), and it forces a
**named constraint on module boundaries** in the recommendation (§10.4) which binds
whichever candidate wins.

### 4.3 Why it is not precedent

Precedent binds; evidence informs. Treating the chat app as precedent would decide by
inheritance rather than by criteria — the same error, in the opposite direction, that
the sequencing verdict refused to make by deciding on a proxy. And the asymmetry is
live: internal tooling with one trusted user, versus a product with a payment
integration, untrusted input, and eventually real customers. Different failure modes
can justify different answers.

**The honest consequence, stated so it is not smuggled:** the incumbent shape carries
a **procedural** advantage — it wins ties (§2.2), because measured operating evidence
and zero switching cost are real. It does **not** get a substantive one. A challenger
must beat it on a discriminator; matching is not enough.

---

## 5. Gate adjudication

All four gates are adjudicated on **executed evidence** — the command that was run
and what came back. Nothing here is a gate passed on argument.

**A procedural note on ordering.** The plan requires gates first, so that a candidate
failing one is eliminated and never spiked. That was done at the cheapest available
fidelity: gate (d) was pre-screened from registry metadata **before any spike code
existed** (`npm view <pkg> version license`), returning `stripe` MIT, `express` MIT,
`ejs` Apache-2.0, `zod` MIT, `next` MIT, `react` MIT — all free, none requiring an
account. It eliminated nobody. Gates (b), (c) and (e) cannot be adjudicated on
executed evidence without a runnable artifact, so they were adjudicated against the
built spikes. No candidate was spiked that a cheaper screen would have removed, so
the outcome is identical to the plan's ordering.

**The instrument was validated before it was used.** `--network none` was verified to
block egress, with both controls: inside `docker run --rm --network none node:24-slim`
a `fetch()` to `registry.npmjs.org` failed `TypeError | EAI_AGAIN`; the identical
probe *with* networking returned `status 200`. A gate instrument that has not been
shown to fail when it should is not evidence.

### 5.1 Gate (b) — runs under docker compose

| Candidate | Run | Result |
|---|---|---|
| C1 | `docker compose config` | **PASS** — valid, service `web` |
| C2 | `docker compose config` | **PASS** — valid, service `web` |
| C3 | `docker compose config` | **PASS** — valid, services `app`/`test` |

All three additionally built and ran from their own `Dockerfile` on `node:24-slim`.

### 5.2 Gate (c) — full suite, no external accounts, no network egress

Re-run by the CTO independently of each implementer's report, same command shape:

| Candidate | Command | Exit | Tests | Suite runtime |
|---|---|---|---|---|
| C1 | `docker run --rm --network none as36verify-c1 node --test` | **0** | 5/5 pass | **784.3 ms** |
| C2 | `docker run --rm --network none as36verify-c2 node --test` | **0** | 5/5 pass | **1,941.1 ms** |
| C3 | `docker run --rm --network none as36c3-test` | **0** | 5/5 pass | **1,463.7 ms** |

**All three PASS.** No candidate required an account, a key, or egress to run its
suite. Recorded because it was measured rather than assumed: `--network none` still
provides loopback, so a test that drives the app's own HTTP server works — which is
why this gate is satisfiable at all.

### 5.3 Gate (d) — $0, no paid services or licences

Direct licences read from the installed packages, and — because the gate is about the
whole tree, not the top of it — **every transitive package was scanned**, walking
installed `package.json` files rather than trusting the top level.

| Candidate | Installed packages | Licence spread | Verdict |
|---|---|---|---|
| C1 | **0** | none — no licence surface at all | **PASS** |
| C2 | **67** distinct (70 instances on disk — `content-type` is installed 4×) | 61 MIT · 4 ISC · 1 Apache-2.0 · 1 BSD-3-Clause — **all permissive** | **PASS** |
| C3 | **30** | 17 MIT · 6 Apache-2.0 · 2 ISC · 1 CC-BY-4.0 · 1 BSD-3-Clause · 1 0BSD · **1 LGPL-3.0-or-later** · **1 "Apache-2.0 AND LGPL-3.0-or-later AND MIT"** | **PASS on cost — flagged on licence** |

**The C3 finding, stated carefully and not overclaimed.** Its default install pulls
`@img/sharp-libvips-darwin-arm64@1.3.3` (**LGPL-3.0-or-later**) and
`@img/sharp-wasm32@0.35.4` (**Apache-2.0 AND LGPL-3.0-or-later AND MIT**), via
`sharp`, Next's image-optimisation dependency. Gate (d) as worded asks for **$0 and no
paid licences**; LGPL is free, so **C3 passes the gate** — calling this a gate failure
would be a convenient conclusion the evidence does not support. What it *is*: a
weak-copyleft obligation that §11 rule 2 routes to the board rather than to an
engineer, and a live instance of trigger **T4**.

Two things make it worth recording anyway. First, **C3's own implementer reported
"Everything installed … is MIT-licensed, free, and required no account."** That is
incorrect, and only the independent transitive scan caught it — which is the whole
argument for §11 rule 4 and for re-measuring rather than trusting a report. Second, it
is the mainstream default's *default*: nobody chose it, and nobody would have noticed.

### 5.4 Gate (e) — every Stripe call behind a single enforceable chokepoint

The real test is AS-38's acceptance property: **does removing the ban turn the suite
red?** Adjudicated by mutation — the guard's `throw` statements were commented out,
the suite re-run, then the guard restored and the suite re-run again.

| Candidate | Ban removed | Ban restored | Verdict |
|---|---|---|---|
| C1 | **exit 1** — `test/app.test.js` fails | **exit 0** — 5/5 pass | **PASS** |
| C2 | **exit 1** — `test/invoices.test.js` *and* `test/stripe-client.test.js` fail | **exit 0** — 5/5 pass | **PASS** |
| C3 | see §8.1 — same module shape, guard enforced in `lib/stripe-client.ts` | 5/5 pass | **PASS** |

All three place every Stripe concept in exactly one module and enforce the ban there.
The chokepoint is a property of how the code is organised, not of the framework — so
this gate **does not discriminate**, and it is recorded as passing rather than dressed
up as a differentiator. What *does* bear on it is the client's shape, decided in §8.1.

### 5.5 Gate summary

**No candidate was eliminated.** All three pass (b), (c), (d), (e). The decision
therefore falls entirely to the ranked discriminators — which is precisely why the
combination rule was fixed in advance.

---

## 6. The spike

### 6.1 Why a spike at all

Because this company has repeatedly produced confident wrong answers from
reasoning-without-measurement. The most recent was in AS-31's own graph check, where
the first checker run passed three rules **vacuously** — it read the wrong JSON key and
saw an empty graph. Reading 34 edges by eye would have found none of it, and would
have felt more confident. Two specific failure modes were available here, and both
were live: *"zero dependencies is fine, look at the chat app"* (extrapolating from an
app with no third-party integration and no adversary), and *"a mainstream framework is
faster to build in"* (unmeasured, and possibly false under a text-only IC model —
possibly true, which is the point).

**Three claims in this document were falsified by the spike**, which is the return on
running it: the Stripe SDK's dependency footprint (§8.1 finding 1), C3's licence
cleanliness (§5.3), and the assumption that a dependency budget buys less code
(§6.4 M1).

### 6.2 The artifact — the same screen, three times

Not a hello world, which measures boilerplate and nothing else. The screen chosen is
the one that is hard in the way **this product** is hard — milestone plan row C-29,
screen 4 of 7:

> **The invoice create/edit screen's server half:** a form with a **repeating
> line-item group** (add/remove rows), **server-side validation with field-level
> errors re-rendered against submitted input**, styled only via `tokens.css`, and one
> **stubbed Stripe call behind a module boundary** — no network, no keys, no account.

One screen, and it exercises forms, repeating structures, error states, token
consumption, the chokepoint boundary, and the test story at once. All three candidates
were given a **byte-identical functional specification** (four top-level fields, 1–20
line items, five named tests, the same custody guard) and differed only in their
assigned stack.

### 6.3 Confounds, stated as design rather than left for a reviewer to find

1. **The implementer knows some stacks better than others. That is the measurement,
   not noise.** Criterion (a) *is* "can an agent IC implement this from text alone", so
   systematic agent advantage in a stack is signal. It is reported, not corrected.
2. **Repo familiarity leaking into C1 is the one genuine contaminant**, and it was
   controlled: every candidate was built in a **fresh scratchpad directory**, never
   inside `apps/chat`, and all three implementers were explicitly forbidden from
   reading that app. *Disclosed:* C2's implementer ran one `stat` on the repository
   path while trying to verify he had not touched it — metadata only, no file contents,
   `apps/chat` never opened. It does not affect the measurement, and it is recorded
   rather than omitted.
3. **The model was held constant.** All three were built by `agent:developer-marcus` on
   the same model. The first launch of all three failed identically on a model rate
   limit before any work began, and they were relaunched on a substitute model —
   **the same substitute for all three**, so the comparison is unaffected. Absolute
   productivity numbers here are not portable to a different model; the *relative*
   ordering is what this document uses.
4. **Self-reported numbers were not trusted.** Every objective measurement below was
   **re-derived by the CTO** from the artifacts — line counts recomputed from each
   manifest, dependency trees re-walked, suites re-run under `--network none`, the
   custody guard mutation-tested, and the M5 typo re-introduced independently. Where a
   report and the re-measurement disagreed, the re-measurement is what appears here and
   the disagreement is named (§5.3).

### 6.4 The six measurements

**M1 — Size to the same functional endpoint.** Recounted from each `MANIFEST.tsv`.

| | C1 | C2 | C3 |
|---|---|---|---|
| server | 730 lines / 6 files | 531 / 7 | 686 / 12 |
| client | 0 / 0 | 179 / 2 | 534 / 4 |
| config | 51 / 3 | 53 / 4 *(+908 lockfile)* | 139 / 7 *(+1,016 lockfile)* |
| test | 156 / 1 | 164 / 2 | 204 / 1 |
| **hand-written total** | **937** | **927** | **1,563** |

**The headline, and it falsified an assumption held on both sides:** C1 and C2 are
within **1%** of each other (937 vs 927). For this artifact the dependency budget
bought **essentially no reduction in hand-written code** — while C3 costs **+67% against C1 and +69% against C2**. "Zero dependencies means writing much more code" and "a framework means
writing much less" are both false here, and only measurement shows it.

**M2 — Dependency footprint.** Counted by walking installed `package.json` files, one
method for all three.

| | C1 | C2 | C3 |
|---|---|---|---|
| direct | **0** | 3 (`express` MIT, `ejs` Apache-2.0, `zod` MIT) | 7 (3 runtime + 4 dev) |
| installed packages | **0** | **67** distinct (70 instances) | **30** |
| `node_modules` on disk | **0** | **12 MB** | **366 MB** |
| install time | **0 s** (never run) | 1.66 s cold | 2.97 s cold |
| container image | **219 MB** (= base exactly) | 230 MB | **690 MB** |
| image delta over `node:24-slim` | **+0 MB** | **+11 MB** | **+471 MB** |

Worth stating because it is counter-intuitive and was measured rather than assumed:
**package count and disk footprint disagree in direction.** C3 has *fewer* packages
than C2 (30 vs 67) but **30× the disk** and **43× the image delta**, because Next
vendors its dependencies inside its own package. Either number alone would mislead.

**M3 — Gate (c) executed.** See §5.2: all three exit 0 under `--network none`;
784.3 ms / 1,941.1 ms / 1,463.7 ms.

**M4 — IC context cost.** Identical task for all three: *add one required top-level
field (`client_address_line1`), validated, with field-level errors, carried to the
read-only view.* Each implementer listed every file that must be opened; the CTO
computed the bytes.

| | C1 | C2 | C3 |
|---|---|---|---|
| files to open | 5 | **5** | 11 |
| **bytes to read** | 28,029 | **18,076** | 36,812 |
| implementer's own conventional-vs-bespoke call | "almost nothing is conventional … nearly everything that matters is bespoke" | "mostly conventional framework knowledge, with a real bespoke tax" | "~35% conventional / 65% bespoke" |

**The declared bias, restated because it matters here.** This metric **under-counts a
mainstream framework** (whose conventions an agent already knows for free) and
**over-counts a bespoke codebase** (which must be read in full). The bias runs
**toward C2 and C3 and against C1** — so correcting for it would *widen* C2's lead
over C1, not narrow it. It is not corrected silently, and the direction is stated so a
reviewer can discount it deliberately.

**One confound in M4 that cuts the other way, and is not hidden.** Part of C1's
28,029 bytes is that its implementer put all HTML generation in a single 10,522-byte
`render.js`; a different factoring would have lowered it. But this is *itself* the
axis-1 finding rather than an accident: a template engine **forces** one file per
screen (`views/new.ejs` 2,432 B, `views/show.ejs` 1,601 B), while hand-rolled
rendering leaves module boundaries to discipline — and this company now has **two
independent observations of that discipline not happening** (chat's `public/app.js` at
46,868 B with no module boundaries, §4.2; and C1's `render.js` as the largest file in
a 937-line app). The mitigation is available to any candidate and is imposed as a
named constraint in §10.4.

**M5 — Cold-error legibility.** One deliberate typo in the line-item template
(`description` → `descrption`), introduced and captured independently by the CTO in
all three. This is the property the plan called plausibly dominant for text-only ICs,
who have no debugger and no one to ask.

The measurement has to distinguish **two different things an implementer might do**,
and the answer inverts between them — which is why it is reported as two columns
rather than one verdict:

| | Manually viewing the page | **`node --test` — the loop an IC actually runs** | A separate typecheck |
|---|---|---|---|
| **C1** | HTTP 200, nothing on stdout/stderr, field renders `value=""` — silently blank | **CATCHES IT.** `✖ field error preserves input …` — **4 pass, 1 fail** | n/a — no types |
| **C2** | HTTP 200, nothing on stdout/stderr, field renders `value=""` (EJS maps `undefined` → `''`) | **CATCHES IT.** `✖ 2. field error preserves input …` — **4 pass, 1 fail** | n/a — no types |
| **C3** | HTTP 200, nothing on stdout/stderr, React drops the `undefined` attribute | **MISSES IT — 5/5 PASS.** Node strips types without checking them | **CATCHES IT:** `tsc --noEmit` exit 2, `InvoiceForm.tsx(230,32): error TS2551: Property 'descrption' does not exist on type 'RowState'. Did you mean 'description'?` |

**This measurement was very nearly recorded backwards, and the correction is the
finding.** Viewed as a rendered page, all three fail identically and silently — that
much was true. But the question criterion (a) actually asks is what happens in the
**verification loop the implementer runs**, and there C1 and C2 catch the typo through
the behavioural test that asserts submitted values are re-rendered, while **C3's suite
passes clean**.

The reason is structural rather than incidental, which is what makes it a stack
property: C3's form lives in a **client component** that `node --test` never renders,
so its tests necessarily assert against the route handler's JSON instead of against
what the user sees. **In a client-rendered stack the rendered output is not assertable
from a plain test runner** — you need a DOM harness, which is another dependency and
another thing to keep working.

C3's error *message*, when it does fire, is by far the best of the three — file, line,
column, and the correct spelling. But it fires only if `tsc --noEmit` or `next build`
is a required step that someone remembers to run, and its own test suite gives a clean
bill of health in the meantime. A green suite that is wrong is worse than a red one.

**The mitigation this implies is not candidate-specific and is imposed on the winner
regardless (§10.4):** the behavioural test that caught it is the one that asserts
**submitted values are re-rendered**. That test is cheap, it is already in the
acceptance criteria for every form screen, and it is what turned a silent failure into
a red suite in two of three candidates.

**M6 — Build step, for real.** Does `tokens.css` (12,199 bytes, whose own header states
"Zero dependencies. No build step. Safe to link directly") reach the browser intact?

| | Mechanism | Byte-identical? |
|---|---|---|
| **C1** | 2-line static route, `fs.readFile`, raw bytes | **Yes** — response `Content-Length: 12199`, exactly the source |
| **C2** | `res.sendFile()` from project root | **Yes** — verified by `diff`, both 12,199 bytes |
| **C3** | Imported as Global CSS in `app/layout.tsx` | **No.** Emitted as a content-hashed `.next/static/chunks/3x5b82ty3ruul.css` at **7,224 bytes**; comments and whitespace stripped, hex lowercased, concatenated with another stylesheet, and **Lightning CSS injects new custom properties (`--lightningcss-light` / `--lightningcss-dark`) into every dark-mode block** |

C3's result is not minification pedantry. AS-29's delivered artifact is **the single
source of visual truth for everything this company ships**, and C3 rewrites its
cascade and serves it under an unpredictable name. That is precisely the "build-step
fight" criterion (g) was written to detect.

---

## 7. The complete matrix

Every candidate against every criterion. 3 × 8 = 24 cells, **no blanks**. Gate rows
carry the executed evidence; discriminator rows carry the measured number.

| | | **C1** zero-dep, server-rendered | **C2** bounded deps, server-rendered | **C3** bounded deps, client-rendered + build |
|---|---|---|---|---|
| **(b)** | gate — compose | **PASS** `compose config` valid | **PASS** `compose config` valid | **PASS** `compose config` valid |
| **(c)** | gate — no accounts, no egress | **PASS** exit 0, 5/5, 784.3 ms under `--network none` | **PASS** exit 0, 5/5, 1,941.1 ms | **PASS** exit 0, 5/5, 1,463.7 ms |
| **(d)** | gate — $0 | **PASS** 0 packages, no licence surface | **PASS** 67 packages, all permissive (61 MIT / 4 ISC / 1 Apache-2.0 / 1 BSD-3) | **PASS on cost**, **flagged**: 2 LGPL-3.0-or-later packages via `sharp`; free, but a §11 rule-2 board ask and a live T4 |
| **(e)** | gate — chokepoint | **PASS** ban removed → exit 1; restored → 5/5 | **PASS** ban removed → 2 suites red; restored → 5/5 | **PASS** single `lib/stripe-client.ts`, guard enforced |
| **(a)** | **disc. 1** — text-only implementable | 937 lines · **28,029 B** to change one field · "almost nothing conventional" · **M5: suite catches it** · 1 friction item (self-reported, not a sub-measure) | **927 lines · 18,076 B — lowest** · "mostly conventional" · **M5: suite catches it** · 2 friction items (self-reported) | 1,563 lines (**+67% vs C1, +69% vs C2**) · **36,812 B — highest** · 65% bespoke · **M5: suite MISSES it (5/5 green)** · 5 friction items, 3 self-flagged load-bearing |
| **(h)** | disc. 2 — separability | **2 files** import the framework (`server.js`, `lib/http-util.js`); `validate`/`store`/`stripe-client` import nothing framework-specific | **1 file** imports the framework (`server.js`); business logic framework-free; templates already isolated in `views/` | **7 files** import `next`/`react`. `lib/invoices/*` is framework-free, but routing and presentation are not: replacing the front end means replacing Next, i.e. the server too |
| **(g)** | disc. 3 — tokens, no build fight | **Perfect** — byte-identical, 12,199 B | **Perfect** — byte-identical, 12,199 B | **Fails** — 12,199 → 7,224 B, cascade rewritten, content-hashed name |
| **(f)** | disc. 4 — DO-deployable | **Yes** — 219 MB image | **Yes** — 230 MB image | **Yes** — 690 MB image |

**Criterion (f) discriminates nothing**, exactly as predicted: all three are a Node
process in a container and all three deploy to a droplet. It is recorded and moved
past. The image sizes differ by 3× and that is a real operational fact, but it belongs
to M2, not to (f).

---

## 8. Two sub-decisions, closed here

Both are closed rather than deferred, for the same structural reason: the task that
would inherit each has **no criteria of its own to decide it against**. Deferring
would not preserve optionality; it would relocate the decision to a place with less
information.

Both are orthogonal to the C1/C2/C3 ranking — any of the three candidates could take
either answer — so they are settled on their own evidence, before §10.

### 8.1 Q1 — the Stripe client: official SDK, or hand-rolled?

This is the highest-value thing this decision can settle, because it interacts
directly with gate **(e)**: which shape makes the custody chokepoint *more*
enforceable? AS-38 is the guard, and a guard whose shape was chosen without criteria
is a guard nobody can review.

**Evidence, executed.** A probe was run entirely offline (`docker run --network
none`, with a loopback HTTP server standing in for `api.stripe.com`, so the SDK's
real request path is exercised with zero egress). Full script:
`chokepoint-probe.mjs` in the AS-36 session scratchpad, not committed (§6.4).

| # | Finding | Measured result |
|---|---|---|
| 1 | Stripe SDK dependency footprint | **1 direct, 0 transitive.** `stripe@22.6.0`, MIT, `dependencies: {}`, install 1s warm, 20 MB on disk |
| 2 | Does the SDK enforce any custody policy of its own? | **No.** It emitted the forbidden shape without complaint: `customer=cus_1&…&transfer_data[destination]=acct_123` with **no `Stripe-Account` header**. The ban is ours either way |
| 3 | Can a test inspect the outgoing request offline, over the SDK? | **Yes** — point it at a loopback host via `{host, port, protocol}`; headers and form body are fully inspectable. No SDK internals needed |
| 4 | Bypass surface over the SDK | **Real.** A second `new Stripe(...)` instance constructed anywhere issued `transfer_data[destination]=acct_9` without passing the wrapper at all |
| 5 | Hand-rolled request builder: size, and does it block both violations? | **~22 lines.** Blocked both: `CUSTODY: banned parameter "transfer_data"` and `CUSTODY: Stripe-Account is required on every call` |
| 6 | Hand-rolled webhook signature verification with `node:crypto` only | **11 lines**, and all three named failure modes caught offline: valid → `invoice.paid`; tampered → `signature mismatch`; replayed → `timestamp outside tolerance (replay)` |

**Finding 1 cuts against the author's prior and is recorded as such.** I expected the
SDK to drag in a dependency tree. It does not — it is a single MIT package with zero
transitive dependencies. **The dependency-footprint argument against the SDK is
therefore dead**, and Q1 cannot rest on it. This is exactly why the plan required
measurement rather than reasoning.

**What decides it is finding 4, read against criterion (e) and criterion (a)
together.** Both shapes pass gate (e) — a chokepoint *is* enforceable over either.
The difference is the **size of the surface that has to be banned**, which was the
pre-committed tiebreak for this question:

- **Hand-rolled:** the ban is enforced at one function, on the **wire bytes** — the
  parameters and the required header. The only bypass is a second HTTP client, and
  `node:http`/`fetch` call sites are greppable.
- **SDK:** the same parameter ban, **plus** a source-level ban on importing `stripe`
  anywhere outside the wrapper — because `new Stripe(key)` is a legal, idiomatic,
  documented bypass (finding 4). That import ban is **load-bearing, not
  belt-and-braces**, and it is where criterion (a) compounds the problem: our ICs work
  from training-corpus conventions, and `const stripe = new Stripe(key)` is **the
  construction Stripe's own documentation leads with** — stated that way because it is
  checkable, where a superlative about all Stripe code ever written would not be. The
  stack would be pulling implementers toward the bypass, and the guard would depend on
  a lint rule catching them every time.

**The honest counter-argument, stated at full strength.** Hand-rolling HMAC signature
verification is security-critical code, and `stripe.webhooks.constructEvent` is
maintained by Stripe and exercised by far more traffic than ours will ever see — a
reputational argument, not a measured one, and it is the strongest case against this
sub-decision. My answer is not "I am confident": the scheme is **fully specified
with no cryptographic design decisions left to the implementer**, it is 11 lines, and
its failure modes are enumerable and each is directly testable offline — non-constant-time
comparison (use `crypto.timingSafeEqual`), missing replay tolerance, and
verifying the parsed body instead of the **raw** body. That last one is the actual
classic production bug, and it bites SDK users identically — it is a
framework-integration bug, not an SDK-versus-hand-rolled one. AS-38 carries a test
for each.

**Note that this is genuinely binary, not a spectrum.** A hybrid — SDK for some calls,
hand-rolled for others — is **strictly dominated**, and that is a deductive claim
rather than a measured one: it carries the entire import bypass surface of the SDK
option *and* the hand-rolled code of the other, so it is worse than each on the
dimension that one was chosen for. If the import is banned there is no SDK; if it is
not banned the chokepoint leaks.

> **Q1 verdict: hand-rolled client, in one module, enforcing the ban on the wire.**
> Decided on criterion **(e)**, surface-to-ban, with criterion (a) compounding it.
> Recorded against it: the SDK's zero-transitive-dependency footprint is a genuine
> point in its favour that does not bear on the deciding criterion.
> Reversal is trigger **T2** (§9.1).

### 8.2 Q2 — the data store

**Evidence, executed.** Gate (c) says "no external accounts **and no network
egress**." A docker-internal bridge is not egress, so a Postgres-backed suite does
**not** fail the gate as worded — this is stated plainly rather than overclaimed. The
measured difference is which *strength* of the gate each engine can satisfy:

| Run | Command | Result |
|---|---|---|
| Postgres, shared docker network | `docker run --network as36probe …` connect `as36pg:5432` | **`REACHED postgres:5432 -> suite can run`** |
| Postgres, no network | `docker run --network none …` connect `as36pg:5432` | **`CANNOT reach postgres: EAI_AGAIN`** — suite cannot run |
| `node:sqlite`, no network | `docker run --network none node:24-slim …` | **`sqlite suite runs with ZERO networking`** — insert + select returned `[{"id":"in_1","cents":5000}]` |

Also measured: `node:sqlite` on Node v24.20 required cleanly with **no experimental
warning** on stderr — it is stable, not a flagged API.

**Why SQLite, on the criteria:**

- **(c), the strong form.** SQLite lets the entire suite run under `--network none`,
  which makes the gate **auditable by a one-word proof, forever**. Postgres would
  require every future reviewer to reason about whether a docker bridge counts as
  egress. Gate (c) is also reversal trigger T3; a gate that is trivially checkable is
  a trigger that actually fires.
- **(d).** Both are $0 self-hosted. But at M1, Digital Ocean's managed Postgres is
  billed, so the Postgres path tends toward a board spend ask that SQLite does not
  create. Self-hosting Postgres on the droplet stays $0 and adds operational surface.
- **(a).** SQL is SQL in both. `node:sqlite`'s specific API is newer and therefore
  thinner in any training corpus — an honest cost — but it is offset by in-house
  operating evidence: the chat app has run it across 25+ merged tasks.
- **Fit to v1.** v1 is one freelancer, in test mode, on a local compose stack
  (C-45 and C-46 are both `OUT`). Postgres buys concurrency and operational maturity
  that v1 cannot exercise and M1 does not yet require.

> **Q2 verdict: SQLite via the `node:sqlite` built-in.** No dependency, no service, no
> account, $0. AS-39 must keep all SQL behind a data-access module so the engine is
> replaceable; reversal is trigger **T6** (§9.1).
>
> **Constraint passed to AS-39, from milestone plan row C-32:** the schema must not
> foreclose multi-currency or jurisdictional invoice fields. Store money as integer
> minor units with an explicit currency column from day one, even though v1 permits
> only `usd`.

---

## 9. Reversibility

Phase C requires "what would reverse it," and a reversal clause without a price is a
wish. Both tables follow. **They sit before the recommendation deliberately.**

### 9.1 Named reversal triggers

Each carries all four boxes: an observable, a threshold, an action, and the point in
the graph where it can first fire.

| # | Trigger | Observable | Threshold | Action | First can fire |
|---|---|---|---|---|---|
| **T1** | AS-30's states ledger needs capability outside the chosen rendering envelope | A screen whose specified states cannot be expressed as distinct URLs + server-rendered state; **or** a stated requirement for real-time multi-user state, offline operation, rich-text editing, or drag-reorder **as a requirement** (not as a nicety) | **one** such screen | Re-open the **front-end half only** — which is what criterion (h) exists to protect. The server half stands. Amendment-log entry, never a silent redesign | AS-30 delivery |
| **T2** | The custody chokepoint is not enforceable in the chosen shape | AS-38 cannot write a test that **fails when the ban is removed** | any | **Blocking.** A3 is an invariant, not a preference. Reverse the Q1 sub-decision (§8.1) immediately | AS-38 |
| **T3** | The no-accounts / no-egress test property does not hold | AS-37's suite requires egress or an external account to pass | any | **Blocking** — gate (c) was mis-adjudicated. Re-run the gate (§5) and re-decide | AS-37 |
| **T4** | A dependency acquires a cost, an account requirement, or a licence change | Any dependency requiring payment, signup, or a non-permissive licence | any | Board ask, or removal. **Never adopted quietly.** This is §11's rule with a trigger attached | any time |
| **T5** | The stack cannot be hosted on Digital Ocean within board-approved spend | M1 deployment scoping | any | Deferred by design; recorded now so it is not a surprise at M1 | M1 |
| **T6** | The data store cannot carry the load or the concurrency | Measured write contention or a multi-writer requirement that SQLite's single-writer model cannot serve | any sustained instance | Swap the engine behind AS-39's data-access module. Priced in §9.2 as bounded, not free — SQL dialect differences are real | M1 or later |
| **T7** | The hand-rolled front end regrows the `app.js` pattern | Any single front-end source file exceeding **1,200 lines** (the measured size of `public/app.js`, §4.2) | one file | Split it. The projection in §4.2 is the reason this threshold is a number and not a feeling | any UI task |

### 9.2 The cost of being wrong, by point in the graph

| Reversal happens… | Cost |
|---|---|
| **Before AS-37 lands** | **Free** — edit this document; nothing exists yet |
| **After AS-37, before AS-38 / AS-39** | ~1 task (re-scaffold) |
| **After the server fan (AS-40…AS-44)** | **Server-side** reversal: the whole fan. **Front-end-only** reversal: the four UI tasks — **and only if separability held**, which is the entire argument for criterion (h) |
| **After AS-49 / AS-50** | v1 |
| **At M1 (deployment)** | v1 + the deployment shape |

---

## 10. Recommendation

### 10.1 The decision

> **Build the product app in the C2 shape: a server-rendered Node application with a
> small, deliberate dependency budget.**
>
> **Runtime:** Node 24, pinned to an exact minor in the image. **HTTP layer:**
> Express 5. **Rendering:** server-rendered HTML from EJS templates, **one template
> file per screen**. **Validation:** hand-rolled — see §10.3. **Test runner:**
> `node --test`, invoked bare. **Container:** `docker compose`, `node:24-slim` base,
> plus a `test` service with `network_mode: none`. **Data store:** `node:sqlite`
> (§8.2). **Stripe:** a hand-rolled client in one module, enforcing the ban on the
> wire (§8.1).
>
> **Ranking: C2 > C1 > C3.**

### 10.2 The decisive criterion, and where the candidates actually differed

**The decision was made on discriminator 1, criterion (a) — implementable by agent ICs
working from text alone — and it did not reach discriminators 2, 3 or 4.** That is the
lexicographic rule working as designed: (h), (g) and (f) are recorded in the matrix and
they happen to point the same way, but they are **corroboration, not cause**. If (a)
had gone the other way, so would this decision.

**Where C2 and C1 actually differ, since this is the comparison that decided it:**

| Measure | C1 | C2 | Differs? |
|---|---|---|---|
| Hand-written lines, same artifact | 937 | 927 | **No — 1%. A dead tie.** |
| M5, cold-error legibility | suite catches it | suite catches it | **No — identical.** |
| **M4, bytes to read to change one field** | **28,029** | **18,076** | **Yes — C2 is 35% lower** |
| Conventional vs bespoke knowledge | "almost nothing is conventional" | "mostly conventional" | **Yes — opposite ends** |

**The single measurement that carried this decision is M4**, corroborated by the two
implementers' independent and opposite characterisations of how much of the required
knowledge is learnable from public convention versus only by reading our codebase.

**Why that gap is a stack property and not an implementer's accident.** A template
engine *forces* one file per screen; hand-rolled rendering leaves module boundaries to
discipline, and this company now has **two independent observations of that discipline
not holding** — `apps/chat/public/app.js` at 46,868 bytes with no module boundaries
(§4.2), and C1's `render.js` emerging as the largest file in a 937-line application.
The §4.2 projection prices where that ends up: **~149 KB / ~3,809 lines in one file** —
3.2× `app.js`, which is itself the largest application source file this company has
written.

**The tie-break was not used, and that is the point.** §2.2 declared in advance that
ties go to the incumbent shape (C1). C2 did not *match* on discriminator 1 — it
**won** it, by 35% on the measured proxy with the metric's declared bias running in
the same direction. Had the two been genuinely tied, C1 would have won this document.

**Stated plainly, because it is the uncomfortable part:** I am the author of the
zero-dependency convention this company runs on, and the evidence went against my
prior. Three specific expectations of mine were falsified by measurement — the Stripe
SDK's dependency footprint (§8.1), C3's licence cleanliness (§5.3), and the assumption
that a dependency budget buys materially less code (§6.4 M1, where it bought 1%). The
spike was worth running precisely because it disagreed with me.

**A consequence of the criteria worth naming rather than smuggling.** C1's dependency
footprint is **0 packages and +0 MB of image**, against C2's 67 and +11 MB. Under the
criteria fixed in advance, supply-chain footprint is a **gate** (d) — pass/fail, and
both pass — and is **not** among the four discriminators. So it does not enter the
ranking, and I have not let it back in through the side door. If the company believes
footprint should discriminate, that is a **criteria-level amendment** for a reviewer to
raise (§13), not a reweighting for me to perform after seeing the results.

### 10.3 Zod is rejected — the dependency policy applied to its own spike data

C2's assigned representative was Express + EJS + **Zod**. The first two are adopted;
**Zod is not**, on §11 rule 1 — *it must remove more than it adds*:

| | Hand-rolled (C1) | Zod (C2) |
|---|---|---|
| validation module | **124 lines / 3,914 B** | **150 lines / 5,244 B** |

Zod produced **21% more lines and 34% more bytes** than hand-rolling the same rules.
It also carried two documented costs: its chained refinements **do not short-circuit**,
so a naive schema reports contradictory messages for one bad field (the implementer
needed a `transform` + `ctx.addIssue` + `z.NEVER` workaround discoverable only by
testing bad input), and the installed **v4 differs from the v3 that dominates public
documentation** — a specific hazard for text-only ICs, who write from corpus
convention and cannot check a running system.

This is the dependency policy doing its job on the first dependency it was pointed at.
It also suggests a rule of thumb — offered as a **hypothesis from n=4 observations in
this spike, not as a law**, because that is all the evidence supports: **corpus
stability may matter more than popularity.** The four, with what was actually observed:
Node's standard library (no drift observed), Express 5 and EJS 6 (no drift observed;
neither implementer reported a convention mismatch), **Zod** (major version moved; the
installed v4 differs from the v3 that dominates public documentation, and the
implementer had to verify the API before trusting it), and **Next 16** (ships an
`AGENTS.md` that opens "this is NOT the Next.js you know", which its implementer read
and which changed his decisions). If that pattern holds, popularity actively conceals a
criterion-(a) cost — but four data points is a reason to pin versions (§10.4 item 6),
not a reason to believe a law.

**Net adopted dependency footprint: 2 direct packages** (Express 5, MIT; EJS 6,
Apache-2.0). Removing Zod takes 1 package and 7.7 MB off the measured C2 tree.

### 10.4 Constraints that bind regardless of the winner

These are not style preferences. Each is the direct consequence of a measurement above,
and each is checkable.

1. **No source file exceeds 1,200 lines** — the measured size of `public/app.js`.
   Trigger **T7**. This is the constraint the §4.2 projection exists to justify, and it
   binds the front end especially.
2. **One template file per screen.** The seven screens get seven templates; shared
   pieces become partials. This is the mechanism behind M4, made explicit so it does
   not depend on whoever implements it having good instincts.
3. **Every form screen carries the test that caught the M5 typo** — asserting that
   **submitted values are re-rendered** on a validation failure. It is the reason two
   of three candidates turned a silent blank field into a red suite, and it costs one
   test per screen.
4. **The full suite must run under `--network none`.** Not "should work offline" —
   the compose `test` service carries `network_mode: none` so the property is enforced
   by construction and gate (c) stays checkable by a one-word proof. Trigger **T3**.
5. **Every Stripe concept lives in one module**, which enforces the ban on the wire,
   and **removing the ban must turn the suite red** — verified by mutation, not by
   review. Trigger **T2**.
6. **Exact-version pins for every dependency**, given the corpus-drift finding in
   §10.3. A caret range is how an IC ends up writing v3 code against a v4 install.

---

## 11. Dependency policy — the rule

This is the part of the decision that outlives the rest. It is written as a rule a
reviewer can apply to a dependency **nobody has proposed yet**, because a list of
approved packages goes stale and a rule does not.

**A proposed dependency is admitted only if it passes all six.** Any failure is a
`needs_human` board ask or a rejection — never a quiet adoption.

1. **It must remove more than it adds.** Name the specific thing it removes:
   complexity, a failure mode, or a class of bug we would otherwise hand-roll. "It is
   convenient", "it is standard", and "it is what I know" are not admissions. The
   proposer writes this line in the task description; a reviewer who cannot restate
   it rejects the dependency.
2. **Licence: permissive, and named.** MIT, ISC, BSD, or Apache-2.0. Anything
   copyleft, source-available, dual-licensed, or licence-unstated is a board ask
   before use, not after. Record the licence and the version in the task.
3. **Cost: $0, with no account and no signup.** Any dependency that requires payment,
   a hosted service, an API key, or registration of any kind is a **board ask** —
   there is no threshold under which it is fine. This is `PHILOSOPHY.md` #6 and the
   standing board rule that all spend routes through `needs_human`.
4. **Transitive footprint is counted, not assumed.** Run `npm ls --all --parseable |
   wc -l` before and after and record both numbers in the task. A package with one
   direct dependency and ninety transitive ones is a ninety-package decision. §8.1
   finding 1 is the worked example of why this gets measured rather than guessed.
5. **It must not break gate (c).** After adding it, the full suite must still run with
   `--network none`. If it phones home, needs a registry at test time, or wants a
   key, it fails. This is executable in one command, so there is no excuse for
   asserting it.
6. **Abandonment has an answer before adoption.** State, in one line, what we do if
   upstream stops: vendor it, replace it, or delete the feature. A dependency whose
   abandonment answer is "we would be stuck" is not admitted. Prefer packages small
   enough to vendor over packages too large to replace.

**Standing corollary — the chokepoint rule (§8.1).** No module outside the Stripe
client module may import a Stripe SDK or issue an HTTP request to a Stripe host. This
is enforced by a test, not by review discipline, and its removal must turn the suite
red (trigger T2).

**Applying the rule to itself.** Every dependency evaluated in this document's own
spike — `express`, `ejs`, `zod`, `next`, `react`, `react-dom`, and `stripe` — is
recorded in §5.3 and §8.1 with its licence, its transitive count, and its $0 status.
Only `express` and `ejs` are adopted (§10.1). **Zod was rejected by rule 1 on measured
evidence** (§10.3), and C3's tree was **flagged by rule 2** for two LGPL-3.0-or-later
packages its own implementer reported as MIT (§5.3) — which is rule 4 earning its
place: the footprint has to be *counted*, not accepted on report.

---

## 12. What AS-37 does with this

The test of this document is not whether it is rigorous but whether it is **usable**:
could AS-37's implementer scaffold `apps/invoicing/` from it without asking a question?
Everything needed is above; this section collects it in one place so that nobody has to
reassemble it.

| Slot | Decision |
|---|---|
| Directory | `apps/invoicing/` (milestone plan row C-02 — decided, not placeholder) |
| Runtime | Node 24, pinned to an exact minor in the `Dockerfile` |
| HTTP layer | Express 5 (MIT), exact-version pinned |
| Rendering | Server-rendered HTML; EJS 6 (Apache-2.0) templates; **one template file per screen** under `views/` |
| Client-side JS | Hand-written, minimal, progressive enhancement only (the repeating line-item group is the only place v1 needs it). **No framework, no bundler, no build step.** |
| Validation | Hand-rolled in one module. **Not Zod** (§10.3) |
| Data store | `node:sqlite` (built-in). All SQL behind one data-access module so the engine stays replaceable (T6). Money as **integer minor units with an explicit currency column** from day one (row C-32) |
| Stripe | One hand-rolled module. Every call carries `Stripe-Account`; `transfer_data`, `on_behalf_of` and a missing account are rejected **at the wire**, with tests that fail if the ban is removed (AS-38, T2) |
| Tests | `node --test`, invoked **bare** — both C1's and C3's implementers lost time to `node --test <dir>` failing with a misleading `MODULE_NOT_FOUND` |
| Container | `docker compose`; `node:24-slim`; a `web` service and a `test` service carrying **`network_mode: none`** |
| Tokens | `tokens.css` served as a **byte-identical static file** — no copy, no transform, no hash. Verify `Content-Length: 12199` |
| Dependency budget | **2 direct packages.** Anything further goes through §11's six rules first |

**What AS-37 must not do:** add a build step; add a client framework; introduce a
second HTTP client anywhere near Stripe; use a caret version range; put more than one
screen in a template file; or write a form screen without the re-render assertion from
§10.4 item 3.

**Known gaps this document does not close**, so AS-37 does not mistake silence for a
decision: session and CSRF handling (AS-40's, and the strongest surviving argument
against extrapolating from the chat app, §4.2 — Express middleware is available for
both, and each is a §11 dependency decision on its own evidence); the HTML escaping
posture beyond EJS's default `<%= %>`; and logging. None of these is foreclosed by
anything above.

---

## 13. Amendment log

| # | Date | What changed | Why | Who |
|---|---|---|---|---|
| 1 | 2026-08-31 | Document created. Stack decision for the D1 v1 product app: three candidates evaluated against eight criteria (4 gates, 4 ranked discriminators), gates adjudicated on executed evidence, survivors spiked on one shared artifact | AS-36 implementation, under the board's step-5 green-light (`docs/strategy/08-board-decision.md`) | Owen Kessler, CTO |
| 2 | 2026-08-31 | **`docs/design/00-frontend-design-plan.md` §Phase C amended** — the requirement that the stack decision follow Phase B (AS-30) was restated as its underlying condition (product and capability set fixed, screens budgeted, interactivity envelope bounded) | Phase C stated a **proxy** where it meant a **condition**, and the two came apart when the board fixed the product and the milestone plan fixed the capability set and the seven screens. The original sentence is quoted inside the amendment rather than deleted, per this company's practice of amending records in the open. Residual risk is carried as trigger T1 (§9.1), and criterion (h) confines the exposure to the front end | Owen Kessler, CTO |
| 3 | 2026-08-31 | **Q1 (Stripe SDK vs hand-rolled) and Q2 (data store) closed here** rather than deferred to AS-38 and AS-39 | Both inheriting tasks have no criteria of their own to decide against; AS-38 *is* the custody guard, so handing it the guard's own shape would make it unreviewable. AS-36's description permits leaving the data store open; this document declines that permission and says why (§1) | Owen Kessler, CTO |
| 4 | 2026-08-31 | **Zod rejected** from the winning candidate's assigned representative | The dependency policy's own rule 1 applied to the spike's own data: Zod produced 150 lines / 5,244 B of validation against 124 lines / 3,914 B hand-rolled, i.e. it *added* rather than removed (§10.3). Adopting the cell while trimming its representative is what §11 is for | Owen Kessler, CTO |
| 5 | 2026-08-31 | **Recorded divergences from the AS-36 plan**, so a reviewer is not left to find them | (i) *Gate ordering.* The plan requires gates adjudicated before spiking. Gate (d) was pre-screened from registry metadata before any spike code existed and eliminated nobody; gates (b)/(c)/(e) require a runnable artifact for executed evidence and were adjudicated against the built spikes. No candidate was spiked that a cheaper screen would have removed, so the outcome is unchanged (§5). (ii) *Model substitution.* The three spike builds were relaunched on a substitute model after all three failed identically on a rate limit before starting; the same substitute was used for all three, so the comparison holds (§6.3.3). (iii) *M5 initially recorded backwards* — corrected on re-measurement (§6.4 M5) | Owen Kessler, CTO |
| 6 | 2026-08-31 | **Known defect in the Phase C amendment, recorded rather than silently fixed:** the amendment text applied to `docs/design/00-frontend-design-plan.md` cites "**§4.4 of this very plan**", and that document has no §4.4 — its §4 contains Phase A/B/C subsections only | The AS-36 plan §3 required the amendment be applied **verbatim**, and acceptance criterion 10 checks for exactly that wording; quietly correcting a citation inside a verbatim block would defeat the check and would be the kind of silent rewrite this company's amendment practice exists to prevent. The argument the citation was reaching for is the interleave mechanism in `docs/engineering/00-d1-v1-milestone-plan.md` §8.1 and its ready-queue invariant — cited correctly here, and in this document's own header note | Owen Kessler, CTO |
| 7 | 2026-08-31 | **Blind re-derivation run as a self-check before hand-off, and its findings applied.** A fresh reviewer was given this document **truncated immediately before §10** and asked to rank the candidates from the stated criteria and evidence alone. It returned **C2 > C1 > C3**, decided on criterion (a) via M4 — matching §10 that it had not read. Acceptance criterion 5 is therefore satisfied by test rather than by assertion | It also returned six defects, all fixed here rather than left for the review gate: (i) **"genuinely tied" had no threshold** — the most load-bearing gap in the document; now defined in §2.2, with the weakness of defining it after seeing the data admitted; (ii) **discriminator (h) was adjudicated entirely in adjectives** despite being ranked second — now measured as framework-touching file counts (C2 1, C1 2, C3 7); (iii) **(a)'s own sub-measures had no combination rule**, reproducing one level down the invented-weights problem §2.2 refuses — now ordered lexicographically; (iv) friction-log tallies were sitting beside real measurements without provenance — now labelled self-reported and explicitly excluded from the sub-measures; (v) four unbacked superlatives grounded or removed; (vi) two arithmetic slips corrected (a licence spread summing to 68 against a stated 67, and "+67%" quoted against both C1 and C2 when it is +67% and +69%) | Owen Kessler, CTO |
