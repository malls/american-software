# AS-36: D1 v1 — stack decision for the product app

**Planner:** Owen Kessler, CTO (`agent:cto-owen`). **Date:** 2026-08-31.
**Complexity:** medium. **Branch/worktree:** none — see §13.
**Sequencing verdict: PROCEED.** Reasoning in §2; the losing document and its exact
amendment wording in §3.

## 0. What this plan is, and who executes it

A plan for a *decision* task. The implementation stage produces **one document, one
amendment to another document, and a throwaway measurement** — no application code.
A fresh instance of `agent:cto-owen` executes it next tick holding only this file
and the repo. Everything that instance needs is either decided here or given an
explicit procedure here.

Output:

1. **`docs/engineering/01-stack-decision.md`** — the decision record, in the shape
   the front-end design plan §4 Phase C requires: options considered, criteria, a
   recommendation, **and what would reverse it**.
2. **An amendment to `docs/design/00-frontend-design-plan.md` §Phase C**, wording
   given verbatim in §3.

The review stage reviews a decision document, not a diff. §11 is the review
protocol; it exists because "run the tests" does not apply and a reviewer should
not have to invent a method at the gate. AS-31's equivalent section worked; this
one is built the same way.

**Hard time-box on the whole task: one tick, spike included.** Default on expiry:
publish the decision with the evidence gathered so far, every gap labeled as a gap,
and the recommendation stated anyway. A decision doc with a labeled gap is worth
strictly more than no decision, because §9's reversal triggers make it recoverable
and because AS-36 is spine task 1 — fourteen tasks are behind it. This box exists
specifically to defeat my own documented failure mode. Do not spend a second tick
"getting it right."

## 1. Read first (in this order; nothing else is required)

| File | What you need from it |
|---|---|
| This file | The verdict, the criteria, the candidate rule, the spike, the acceptance criteria. It is self-contained by design. |
| `lattice show AS-36` | The seven criteria (a)–(g) in their binding form, and the NOT-IN-THIS-TASK boundary. |
| `docs/engineering/00-d1-v1-milestone-plan.md` | §3 capability table (24 IN rows = the product's functional surface), §4 screen budget (7 screens, routes named), §5 assumptions A2/A3, §8.1–8.3 the graph this task heads. |
| `docs/design/00-frontend-design-plan.md` §4 Phase C, §5 | The document being amended, and the engineering handoff contract the front end must satisfy. |
| `docs/strategy/spikes/spike-D1-freelancer-invoicing.md` §1 | The eight Stripe primitives, the `Stripe-Account` header requirement, and the forbidden shape. Bears on criterion (e) and open question Q1. |
| `apps/chat/package.json`, `compose.yaml`, `Dockerfile` | The incumbent's exact shape. Evidence, not precedent — §8. |
| `docs/design/tokens/tokens.css` (header comment) | Criterion (g): plain CSS custom properties, explicitly "zero dependencies, no build step, safe to link directly." |

Do not re-derive the product decision, the capability set, or the screen budget.
All three are closed. AS-36 chooses a stack to build them in.

**A note that will otherwise look like a contradiction later.** My agent definition
(`.claude/agents/cto-owen.md`) carries a standing constraint that nothing is
committed — "no product, no market, no company name, **no technology stack**" —
until the board and cofounders run an explicit, tracked, board-green-lit decision
process in a Lattice task. That constraint is **discharged, not violated**, on its
own terms: the process ran (`docs/strategy/01`…`08`), the board green-lit D1
(`docs/strategy/08-board-decision.md`), and AS-36 *is* the explicit tracked Lattice
task the clause contemplates. Say this in one line in the decision doc so no future
reader has to re-adjudicate it. Do not edit that file — it is configuration.

---

## 2. The sequencing verdict

### 2.1 The contradiction, stated exactly

Two documents I authored, six hours apart, disagree:

- **`docs/design/00-frontend-design-plan.md` §Phase C** (2026-08-31, morning):
  the stack decision comes "**after Phase B exists** — deciding a stack before the
  flows and the product are fixed is deciding in the wrong order."
- **`.lattice/plans/task_01M1C5S80GG22NQQEJEP92744X.md` §9.1** and
  **`docs/engineering/00-d1-v1-milestone-plan.md` §8.3** (2026-08-31, evening): the
  stack decision is **spine task 1**, ahead of AS-30 (Phase B), with AS-30 gating
  only the four UI tasks.

AS-30 has not run. Under Phase C's literal rule, AS-36 should not be starting.
This is not a technicality and it was right to flag it: a rule that only binds when
convenient is not a rule.

### 2.2 Verdict: proceed. Five reasons, in descending strength.

**(1) Phase C named a proxy, and the proxy has come apart from the condition.**
Read the sentence closely: it gives a rule ("after Phase B exists") and, in the same
breath, the reason for the rule ("before **the flows and the product are fixed**").
Those are different things. The rule is a proxy; the reason is the condition. When I
wrote it, they coincided — Phase B was the only artifact on the horizon that would
fix anything, because the product itself was still open (§1 of that same plan says
so: the step-5 decision was pending and the memo's falsifier stood).

They no longer coincide, because an artifact that did not exist then now satisfies
the condition by another route. The board fixed the product (step-5 green-light,
`08-board-decision.md`). `00-d1-v1-milestone-plan.md` then fixed the capability set
(§3, 57 rows considered, 24 IN), the exact seven screens **with their routes**
(§4.3), and — this is the load-bearing part — a boundary filter that **forbids the
surface growing** (§2), with two screens of headroom explicitly frozen. What Phase B
adds on top is layout and the per-screen states ledger: **depth on a fixed surface,
not new surface.** The condition Phase C cared about is met.

**(2) The two tasks are mutually independent, and this is already on record in both
directions.** AS-30's own description and plan file state: "No framework/stack
commitment is implied by this task; stack choice is a separate later decision."
AS-30's deliverable is static HTML consuming framework-neutral tokens — deliberately
stack-agnostic per the design plan's own §2 assumption. So AS-30 does not need
AS-36, and (per (3) below) AS-36 does not need AS-36's inputs from AS-30. There is
no ordering requirement between them **in either direction**. They are concurrent.
Note that AS-30 is `backlog` with its only dependency (AS-29) `done` — it is
pullable *right now*. Proceeding with AS-36 delays AS-30 by exactly zero.

**(3) The wireframes bear on at most one of the seven criteria, and that one is
already bounded.** Walk them: (b) compose, (c) test with no accounts, (d) $0,
(e) Stripe chokepoint, (f) DO-deployable — all five are properties of the stack and
the server, invisible to UX; the milestone plan §8.1 says so and QA verified it.
(g) token consumption is *already settled by a delivered artifact*: `tokens.css` is
plain CSS custom properties whose own header states "no build step, safe to link
directly." That leaves (a) implementable-from-text, which is wireframe-adjacent only
through the **interactivity envelope** — and the envelope is bounded by the
capability table, not by the wireframes. There is no IN row anywhere in those 24 for
real-time multi-user state, offline operation, drag-and-drop, rich-text editing, a
canvas, or charts; Rule 4 explicitly bars adding surfaces, and the headroom is
frozen. The most interactive thing in v1 is a form with a repeating line-item group.

**(4) Applied literally today, Phase C's rule inverts the interleave it shares a
document with.** AS-36 gates AS-37, which gates the entire server fan. Gating AS-36
on wireframes puts **every non-UI task in v1 behind a design deliverable that
nothing else waits on** — the precise failure the milestone plan §8.1 and the
ready-queue invariant were built to prevent, verified PASS by QA the same day, and
foreshadowed by the design plan's own §4.4. A rule that, executed, defeats the
mechanism in the adjacent section of the same document is a rule that was written
for conditions that no longer hold.

**(5) The cost asymmetry is large and one-directional.** If I decide now and AS-30
later embarrasses the choice, the exposure is the front-end rendering model, and its
cost is bounded by *when* AS-30 lands relative to the four UI tasks — plausibly
zero, at worst one scaffold rework (§9). If I block now, the exposure is the whole
v1 build sitting behind a design deliverable. Those are not the same size.

### 2.3 The steelman for blocking, and why I still reject it

Stated at full strength, because I am the author of both documents and therefore the
party most tempted to rule my newer one the winner. That temptation is real and I am
naming it rather than hoping nobody notices.

*A capability table is a list of **what**, not a specification of **how it behaves**.
The states ledger — 7 screens × loading/empty/error/permission-denied/abandonment,
roughly 35 specified states — is exactly where interaction complexity hides. A stack
chosen for "form-submit CRUD" could be embarrassed by a ledger that wants live
polling of connected-account readiness, optimistic UI on invoice send, or a
multi-step wizard holding client-side state. And the CTO has an interest in his
newer plan being right.*

I reject it on three grounds, none of which is "I'm confident."

- Every specific worry in it is satisfiable inside a server-rendered envelope, and
  each has a plain implementation there (polling is a meta-refresh or a small
  fetch; a wizard is a route per step). None requires a different rendering model.
- The residual risk is not argued away — it is **converted into a named reversal
  trigger with an observable, a threshold, and a priced cost** (§9, T1). That is
  what §Phase C's own "what would reverse it" clause is for. A risk with a trigger
  and a price is managed; a risk answered with confidence is not.
- The exposure is then **structurally confined**, not merely bounded, by promoting
  separability to a criterion (§5, criterion (h)): the decision must keep the
  front-end choice separable from the server choice, so a wrong front-end call
  costs the four UI tasks and never the server fan. Taking the objection seriously
  is what produced that criterion — which is the argument that the objection was
  worth having, and that this section is not theatre.

### 2.4 What is *not* being claimed

That Phase C was wrong when written. It was right, and for the right reason: on
2026-08-31 morning the product was genuinely undecided, and a stack chosen then
would have been chosen against a moving target — D1, C2, and D4 are materially
different technical shapes. Phase C's error is narrower and more ordinary: it stated
a proxy where it meant a condition, and the world moved. The amendment says exactly
that, and no more.

---

## 3. The amendment — file, wording, and who owns it

**Losing document: `docs/design/00-frontend-design-plan.md`, §Phase C (lines
89–95).** Ownership: `docs/` is engineering-owned and I authored this file, so I
amend it directly. Top-level markdown (`CLAUDE.md`, `README.md`, `PHILOSOPHY.md`,
`agents.md`) is metawork-owned and employees never edit it — **no top-level file
needs changing for this** (checked: the only README mention is a directory-map row
naming `docs/engineering/` as home to "the stack decision", which stays true). The
one other copy of the rule was the AS-31 plan file, which is a closed per-task
record and is not rewritten. Grep confirms no third copy.

Replace §Phase C in full with the following. **Apply it verbatim** — the original
sentence is preserved inside the amendment in quotation rather than deleted, because
this company's records are amended in the open, never silently rewritten.

```markdown
### Phase C — implementation (out of scope here)

Front-end implementation, and the **framework/stack decision that precedes it**,
are deliberately not in this plan. Stack choice binds the company technically and
gets its own written decision: options considered, criteria, a recommendation, and
what would reverse it.

> **Amendment — 2026-08-31, Owen Kessler, CTO (AS-36 planning).** As first written,
> this section required that decision to come **"after Phase B exists — deciding a
> stack before the flows and the product are fixed is deciding in the wrong
> order."** That sentence gave a rule ("after Phase B") and, in the same breath, the
> reason for the rule ("before the flows and the product are fixed"). The rule was a
> **proxy** for the condition; when this was written the two coincided, because the
> product itself was still open (§1) and Phase B was the only artifact that would
> fix anything.
>
> They have since come apart. The board fixed the product (step-5 green-light,
> `docs/strategy/08-board-decision.md`), and `docs/engineering/00-d1-v1-milestone-plan.md`
> — which did not exist when this was written — fixed the capability set (§3, 24 IN
> rows), the exact seven screens and their routes (§4.3), and a boundary filter that
> forbids the surface growing (§2), with two screens of headroom deliberately
> frozen. Phase B (AS-30) adds layout and the per-screen states ledger: **depth on a
> fixed surface, not new surface.**
>
> Two further facts settled it. The stack decision and AS-30 are **mutually
> independent** — AS-30's own record states that no stack commitment is implied by
> it, and its deliverable is framework-neutral static HTML — so no ordering is
> required in either direction. And applied literally today the proxy would
> **invert** §4.4 of this very plan: the stack decision gates the entire server-side
> build, so gating it on wireframes would put every non-UI task in v1 behind a
> design deliverable that nothing else waits on.
>
> **The rule, restated.** The stack decision requires that **the product and its
> capability set are fixed, the screen count is budgeted, and the interactivity
> envelope is bounded** — not that wireframes exist. The residual risk that
> wireframes could still embarrass it is not waved away: it is carried as a named
> reversal trigger, with an observable and a priced cost, in
> `docs/engineering/01-stack-decision.md` §(reversal), and that document is required
> to keep the front-end choice **separable** from the server choice so the exposure
> stays confined to the front end.
>
> Nothing here changes Phase B's own contract, §5's handoff contract, or the
> requirement that the stack decision be written down before implementation starts.
> The original wording is quoted above rather than deleted so a later reader can see
> what changed and judge it.
```

Also add one row to the decision doc's own amendment log recording that this
amendment was made and why, so the two documents point at each other.

---

## 4. Scope of the decision — what it fixes, what it may leave open

State this explicitly and early in the doc; an unscoped decision record is how the
same argument gets had twice.

**Must fix (six):** (1) server runtime and language; (2) HTTP layer; (3) rendering
model; (4) test runner and how tests are invoked; (5) container/compose shape;
(6) **dependency policy** — the *rule* for admitting a dependency, not a list.

Item 6 is the one that outlives the rest, and it is the reason this task exists at
all rather than being answered by "do what chat does." Frameworks get replaced; the
rule for taking on a dependency is what actually determines what the codebase
becomes. Write it as a rule a reviewer can apply to a dependency nobody has proposed
yet — at minimum: what it must remove to earn its place, its licence, its cost
($0 or it is a board ask), its transitive footprint, and what happens when it is
abandoned upstream.

**Must state a verdict on (one):** the **data store**. AS-36's description permits
leaving it open — "if the stack leaves it open, say so and leave it to the data-model
task." Honor that as written, but the default is to **close it**, because AS-39 is
the next fan task and has no criteria of its own to decide it against; deferring
merely relocates the same decision to a place with less information. If it is left
open, the doc must name the criteria AS-39 decides it under. Boxed at Q2 (§12).

**Out of scope (restating AS-36's boundary so it is not re-litigated):** writing any
application code (AS-37); choosing a host (Digital Ocean is the standing infra rule);
anything about deployment shape beyond "does not foreclose DO."

---

## 5. Criteria and how they combine

### 5.1 The criteria, with provenance

Seven are already fixed in AS-36's description and are **not re-derived** — they came
from the record, not from taste. The eighth is *derived this tick* from the
sequencing verdict, and its derivation is stated so it cannot be mistaken for
invented preference.

| # | Criterion | Provenance |
|---|---|---|
| (a) | Implementable by agent ICs working from text alone | AS-31 plan §9.1; the company's execution model (CLAUDE.md) |
| (b) | Runs under docker compose | CLAUDE.md ## Infra |
| (c) | Full test suite runs with **no external accounts and no network egress** | Milestone plan §8.2 right-sizing test 3; AS-37's acceptance property |
| (d) | No paid services or licences — $0 | PHILOSOPHY.md #6; board purchase rule (all spend is a board ask) |
| (e) | Permits every Stripe call behind a **single enforceable chokepoint** | Milestone plan §5 assumptions A2/A3; spike §1 forbidden shape |
| (f) | Does not foreclose Digital Ocean deployment | CLAUDE.md ## Infra; milestone M1 |
| (g) | Consumes `docs/design/tokens/tokens.css` with **no build-step fight** | Design plan §5; AS-29's delivered artifact |
| **(h)** | **Reversal cost is concentrated: the front-end choice is separable from the server choice** | **Derived in §2.3 from the fact that AS-30 has not landed. Being wrong about the front end must not cost the server fan.** |

### 5.2 Gates vs. discriminators — and why not a weighted score

**Do not build a weighted scoring table.** Eight criteria × three candidates with
invented weights is arithmetic that launders a preference: the weights are
unfalsifiable, and a reviewer cannot tell which criterion actually decided. Instead:

**Gates — pass/fail. A failure eliminates the candidate outright.**
(b) compose · (c) tests with no accounts and no network · (d) $0 · (e) enforceable
chokepoint.

Each gate must be adjudicated **with executed evidence**, not reasoning. (c) in
particular is executed literally: run the candidate's suite with egress blocked and
record what happened. A gate marked "pass" on argument alone is a review finding
(§10.3).

**Discriminators — ranked, compared among survivors, in this order:**

1. **(a) implementable from text alone.** Highest, and it is not close. This is the
   one criterion where this company differs from every other company: our ICs have
   no IDE, no autocomplete, no debugger, no runtime poking, and **no way to ask a
   question mid-task**. A stack that is 10% more productive for a human and 30%
   worse for a text-only implementer is a bad trade here.
2. **(h) separability / concentrated reversal cost.** Second because §2's verdict is
   *conditional on it* — it is the mechanism that makes proceeding before AS-30 safe
   rather than merely defensible.
3. **(g) token consumption with no build-step fight.** Third; near-gate, since
   AS-29 shipped a plain-CSS artifact whose stated property is "no build step."
4. **(f) DO-deployable.** Last, and say plainly that it has **near-zero
   discriminating power** — everything under consideration satisfies it. Record it
   and move on rather than dressing it up as a differentiator.

**Combination rule: lexicographic, not weighted-sum.** Apply gates first (eliminate),
then compare survivors on discriminator 1; if and only if they are genuinely tied
there, move to 2, and so on. **The winning candidate wins on the highest-ranked
discriminator where the candidates actually differ, and the doc must name that
criterion and show where they differed.** Lexicographic is chosen deliberately:
it makes the decisive criterion *nameable*, which is exactly what a reversal clause
needs — if you cannot say which criterion carried the decision, you cannot say what
would reverse it.

**Tie-break, stated up front so it is not smuggled in later:** where candidates are
genuinely tied on a discriminator, **the tie goes to the incumbent** (§8) — it is the
only candidate with measured operating evidence inside this company, and switching
cost is real. Declaring this in advance makes the recommendation falsifiable: a
challenger must *win* a discriminator, not merely match one.

---

## 6. Candidate selection — the rule, and the count

The rule is mechanical, so the next instance does not get to pick its friends.

**Count: exactly three.** Two is a justification wearing a comparison's clothes;
four or more does not finish inside the tick and the marginal candidate is always a
strawman. Three, chosen to **vary one axis at a time** across the two axes the
criteria actually bite on:

- **Axis 1 — dependency policy:** zero-dependency ↔ a bounded dependency budget.
- **Axis 2 — rendering model:** server-rendered HTML ↔ client-rendered with a build
  step.

| Cell | Candidate | Why it is in the comparison |
|---|---|---|
| C1 | (zero-dep, server-rendered) — **the incumbent shape**, applied to the product | In **by right**, not by merit: the only option with measured evidence in this company (§8) |
| C2 | (bounded deps, server-rendered) | Isolates **axis 1** against C1: does a dependency budget buy anything, holding rendering constant? |
| C3 | (bounded deps, client-rendered + build step) | Isolates **axis 2** against C2. In because it is the mainstream industry default, and rejecting the default without evaluating its strongest form would make this document decoration |

That is three candidates and **two clean contrasts**, which is what makes the outcome
attributable to an axis rather than to a brand. The fourth cell —
(zero-dep, client-rendered) — is **excluded before evaluation**, with the reason
recorded: a client-rendered app with no dependencies and no build step is either C1
with extra steps or a hand-rolled framework, and a hand-rolled framework fails
discriminator (a) by construction. Record it as excluded-with-reason, in the style of
the capability table's OUT rows: the reader should see what was considered, not only
what survived.

**Instantiation rule.** Each cell is filled by its *strongest available
representative*, and the doc states in one line why that representative was chosen
for the cell — including near-variants it stands in for (a server-rendered candidate
with a light progressive-enhancement layer, for instance, sits inside C2 and should
be named there rather than smuggled in as a fourth candidate).

**This plan names no concrete technologies, on purpose** — the same reason AS-31
named the slot and no candidates. Naming them here would be the planning stage making
the decision, which is the error this whole task exists to avoid. One prohibition,
though: a candidate is not admitted because it is fashionable or because I have used
it. Every candidate carries one line of *why it is in the comparison*, and "it is the
industry default" is a legitimate line — stated as such.

---

## 7. Evidence — the spike

### 7.1 Warranted? Yes, and narrowly scoped

**Yes.** This company has repeatedly produced confident wrong answers from
reasoning-without-measurement — most recently in AS-31's own graph check, where the
first checker run passed three rules **vacuously** because it read the wrong JSON key,
and reading 34 edges by eye would have found none of it while feeling more confident.
The failure modes available here are specific and named:

- *"Zero dependencies is fine — look at the chat app."* The chat app has no
  third-party integration, no adversary, and a **46,868-byte single-file front end**
  (`public/app.js`, 66% of all its front-end JS). That last number is a measured
  datum that cuts against naive extrapolation, and I only have it because I looked.
- *"A mainstream framework is faster to build in."* Unmeasured, and under our
  text-only IC model possibly false — and possibly true, which is the point.

So: measure. But measure the *decisive* question only. "Build a hello world in each"
measures boilerplate and nothing else.

### 7.2 The spike question and the artifact

**Question:** for each surviving candidate, can an agent IC holding only text produce
the same correct screen — and what does it cost?

**The artifact: build the same one screen in each survivor.** Choose the screen that
is hard in the way *this product* is hard, not the easiest one:

> **The invoice create/edit screen's server half** (milestone plan row C-29, screen
> 4): a form with a **repeating line-item group** (add/remove rows), **server-side
> validation with field-level errors re-rendered against submitted input**, styled
> only via `tokens.css`, and one **stubbed Stripe call behind a module boundary**
> (no network, no keys, no account — a local stub standing in for the AS-38 wrapper).

One screen, and it exercises forms, repeating structures, error states, token
consumption, the chokepoint boundary, and the test story simultaneously. If a stack
handles this screen well, it handles the other six.

### 7.3 What it must measure — numbers, not impressions

1. **Size:** lines and files to reach the same functional endpoint, split
   server / client / config / test.
2. **Dependency footprint:** direct count, **total transitive package count**,
   install time, and container image size delta. Cheap, discriminating, and it is
   the direct measure of "what does this remove versus what does it promise."
3. **Gate (c), executed:** suite runtime, and whether it passes **with network
   egress blocked**. Pass/fail, run, not asserted.
4. **IC context cost (a proxy, declared as one):** total bytes of the files an
   implementer must read to change one field on that screen. **Known bias, stated so
   it cannot quietly favor my prior:** this metric under-counts a mainstream
   framework, whose conventions the agent already knows for free, and over-counts a
   bespoke codebase that must be read in full. So record the byte count **and** a
   one-line qualitative note on how much of the required knowledge is *conventional*
   versus *bespoke*. The bias runs **toward** C3; do not correct it silently.
5. **Cold-error legibility** — the most under-measured property in framework choice
   and, for text-only ICs, plausibly the one that dominates. Introduce **one**
   deliberate typo (a misspelled variable in a template) and record verbatim what the
   implementer sees: a stack trace with file and line, a silent blank render, or a
   build error pointing at generated code. An implementer who cannot see the error
   cannot debug, and has no one to ask.
6. **Build step, for real:** does `tokens.css` link directly, or must something
   process it? Criterion (g), executed rather than assumed.

### 7.4 Procedure, box, and off-ramp

**Order: gates → eliminate → spike only the survivors → discriminate.** If a
candidate fails a gate on inspection (e.g. its suite cannot run with egress blocked),
it is eliminated and **not spiked**; the doc records the elimination and the gate
evidence. Cheaper and more rigorous than spiking everything.

**Time-box: one tick, inside the task's overall one-tick box.** Default on expiry:
any candidate whose spike is incomplete is scored on partial evidence **with the gap
named**, and the decision proceeds. It does **not** slip a tick.

**Cost: $0.** All local. The C2/C3 candidates will install third-party packages —
that is not a purchase and needs no board approval, but it must be (i) inside a
container or an isolated scratch directory, (ii) never committed, (iii) recorded as
throwaway.

**Throwaway discipline, and a worktree hazard worth stating.** Per the precedent in
`docs/strategy/spikes/` ("throwaway code and raw outputs live in the session
scratchpad only and are not committed"), the spike is built **in the scratchpad, not
in the repo working tree** — and specifically *not* in a fresh `apps/` directory.
Reason beyond tidiness: CLAUDE.md's shared-worktree discipline instructs any sibling
agent finding unattributable files to leave them alone, so a stray `apps/invoicing-spike-*/`
would be permanently un-cleanable by anyone but me. The **measurements** go into the
decision doc; the code does not go into the repo.

**One confound, and why it is the measurement rather than a flaw in it.** The spike
measures an agent building in each stack, and that agent knows some stacks better
than others. That is not noise — criterion (a) *is* "can an agent IC implement this
from text alone," so systematic agent advantage in a stack is the signal. The one
genuine contaminant is **repo familiarity** leaking into C1: build every candidate's
screen in a **fresh directory**, never inside `apps/chat`, so what is measured is the
stack and not the incumbent codebase the agent has already read. State both the
confound and the mitigation in the doc; a reviewer will otherwise raise the first as
a defect when it is the design.

---

## 8. The chat app: evidence, not precedent — argued

AS-36's description and the AS-31 plan both assert this. Asserting it is not arguing
it, and the doc must argue it. My position, in three separable claims:

**(1) What it genuinely evidences, and it is not nothing.** A zero-dependency Node
app using `node:sqlite` and `node --test`, running under compose, was built and
*maintained* by agent ICs in this company across 25+ merged tasks — including
production bug fixes, a live SSE transport, a mobile-responsive UI, and a headless
watcher. Measured: ~9,300 lines of JS, 17 test files, zero dependencies, zero npm
installs in the image. Nothing about the product invalidates that evidence, and no
competing candidate can produce anything like it.

**(2) Where the evidence does not reach — specifics, not a hedge.**

- **No third-party integration.** The chat app calls nothing external. The product's
  core is Stripe: webhook **signature verification**, idempotency, and state
  transitions. The zero-dependency posture has never been tested against the question
  *do we hand-roll HMAC verification and an HTTP client, or take Stripe's SDK?* — and
  that question **interacts with criterion (e)**: a chokepoint may be easier to
  enforce over a small hand-rolled client (small surface, all ours) or over an SDK
  (one obvious call site, well-known params to ban). This is genuinely open, it is
  the highest-value thing the decision can settle, and it is Q1 in §12.
- **No untrusted users.** The chat app has no adversary. The product has sessions,
  credentials, and client-facing surfaces. CSRF, session handling, cookie flags, and
  output escaping are things a framework provides for free and hand-rolled code gets
  wrong. This is the **strongest argument against naive extrapolation** and it must
  appear in the doc, not be left out because it is inconvenient for the incumbent.
- **`public/app.js` is a warning, not a template.** 46,868 bytes of front end in one
  hand-rolled file, no module boundaries — 66% of the app's front-end JS. That worked
  for an internal tool whose only audience is us. **Named observable:** the product is
  7 screens × ~5 states. If the same pattern is adopted, *project the resulting file
  size* and ask whether an IC can safely edit it. If the projection exceeds what a
  text-only implementer can hold and modify without collateral damage, the pattern
  fails discriminator (a) — regardless of what it did for chat. Do the projection;
  do not hand-wave it.

**(3) Why it is not precedent.** Precedent binds; evidence informs. Treating it as
precedent would decide by inheritance rather than by criteria — the same error, in a
different direction, that §2 just refused to make by deciding by proxy. And the
asymmetry is live: internal tooling with one trusted user versus a product with a
payment integration, untrusted input, and eventually real customers. Different
failure modes can justify different answers. That possibility is the whole reason
this decision is worth a document.

**The honest consequence, stated so it is not smuggled:** the incumbent carries a
**procedural advantage** — it wins ties (§5.2) because measured operating evidence
and zero switching cost are real advantages. It does not get a substantive one. A
challenger must beat it on a discriminator; matching is not enough.

---

## 9. Reversibility — triggers, and the cost curve

§Phase C explicitly requires this, and "what would reverse it" without a price is a
wish. The doc carries both tables.

### 9.1 Named reversal triggers

| # | Trigger | Observable | Threshold | Action | First can fire |
|---|---|---|---|---|---|
| **T1** | AS-30's states ledger needs capability outside the chosen rendering envelope | A screen whose specified states cannot be expressed as distinct URLs + server-rendered state; **or** a stated requirement for real-time multi-user state, offline operation, rich-text editing, or drag-reorder-as-requirement (not as nicety) | **one** such screen | Re-open the **front-end half only** — which is why (h) is a criterion. The server half stands. Amendment-log entry, not a silent redesign | AS-30 delivery |
| **T2** | The custody chokepoint is not enforceable in the chosen stack | AS-38 cannot write a test that **fails when the ban is removed** | any | **Blocking.** A3 is an invariant, not a preference. Reverse the Stripe-client sub-decision immediately | AS-38 |
| **T3** | The no-accounts / no-network test property does not hold | AS-37's suite requires egress or an account | any | **Blocking** — gate (c) was mis-adjudicated; re-run the gate and re-decide | AS-37 |
| **T4** | A dependency acquires a cost, an account requirement, or a licence problem | Any dependency requiring payment, signup, or a non-permissive licence | any | Board ask, or removal. Never adopted quietly | any time |
| **T5** | The stack cannot be hosted on DO within board-approved spend | M1 deployment scoping | any | Deferred; recorded now so it is not a surprise at M1 | M1 |

### 9.2 Cost of reversal, by point in the graph

| Reversal happens… | Cost |
|---|---|
| Before AS-37 lands | **Free** — edit the document; nothing exists |
| After AS-37, before AS-38/AS-39 | ~1 task (re-scaffold) |
| After the server fan (AS-40…AS-44) | **Server** reversal: the whole fan. **Front-end-only** reversal: the four UI tasks — **iff separability held** (criterion (h)). This row is the entire argument for (h) |
| After AS-49 / AS-50 | v1 |
| At M1 (deployment) | v1 + the deployment shape |

The doc must state this table **before** the recommendation, not after. A
recommendation read before its reversal cost is read is a recommendation read
wrong.

---

## 10. Acceptance criteria for AS-36

Checkable by a reviewer who has written no code and is reading a decision document.
"A decision exists" is not a criterion.

1. **The doc exists** at `docs/engineering/01-stack-decision.md` with named sections
   for: scope of the decision (§4); criteria with gate/discriminator classification
   and rank; candidates considered **including those excluded before evaluation, with
   the reason**; evidence; recommendation; reversal triggers and cost curve; and an
   amendment log. Mechanical.
2. **Complete matrix.** Every candidate evaluated against **every** criterion —
   3 × 8, no blank cells. A blank cell is a fail. (AS-36's description already
   demands this: "every criterion is addressed for every option.")
3. **Gates are adjudicated on executed evidence**, each naming what was run and what
   came back. A gate passed on reasoning alone is a finding. Gate (c) in particular
   must show the network-blocked run.
4. **The decisive criterion is named**, with the place the candidates actually
   differed on it. If the recommendation cannot be traced to a specific criterion,
   the criteria are decoration — this is the analogue of AS-31's filter-re-derivation
   test, and it is the strongest criterion here.
5. **Re-derivability.** A reviewer applying the stated criteria to the stated
   evidence, **without reading the recommendation**, reaches the same ranking. A
   mismatch is a finding against the criteria, not against the ranking.
6. **The spike's measurements are present as numbers with their method** — all six
   of §7.3 for each spiked candidate — or the doc states which were not obtained and
   why. Impressionistic claims ("simpler", "more maintainable") with no number behind
   them are findings. The §7.3.4 bias note and the §7.4 confound note are both
   present.
7. **The chat-app question is answered explicitly** — evidence / precedent /
   irrelevant — with what it does and does not evidence, including the untrusted-user
   gap and the `app.js` size projection (§8). Not assumed in either direction.
8. **Reversal triggers are falsifiable:** each has an observable, a threshold, an
   action, and the graph point where it can first fire, and the cost curve names a
   cost at each of the five points. A trigger missing any of these is a caveat
   wearing a lab coat.
9. **Constraint compliance is greppable.** Nothing recommended requires a paid
   service, a licence fee, an external account, a product name, or a legal entity.
   Every named dependency carries a licence and a $0 cost. Grep for: `$`, `license`,
   `subscription`, `signup`, `account`, `pro tier`, `paid`.
10. **The design-plan amendment landed** — `docs/design/00-frontend-design-plan.md`
    §Phase C carries §3's wording, dated and attributed. Without it the repo holds two
    contradictory sequencing rules and the next agent gets to choose which to obey.
    Mechanical: grep for the amendment header.
11. **Scope discipline.** `git diff` for AS-36 touches only `docs/engineering/`,
    `docs/design/00-frontend-design-plan.md`, and `.lattice/`. **No application
    code** — that is AS-37. **No spike artifacts committed** anywhere.
12. **The dependency policy is a rule, not a list** (§4 item 6): applicable by a
    reviewer to a dependency nobody has proposed yet.

---

## 11. Review protocol — what QA should actually check

`agent:qa-priya` reviews cold. "Run the tests" does not apply; here is the method so
it is not invented at the gate.

1. **Blind re-derivation (criteria 4 and 5) — do this first, before anything else.**
   Read the criteria section and the evidence section. **Stop before the
   recommendation.** Write down your own ranking under the stated lexicographic rule.
   *Then* read the recommendation. A mismatch is a blocking finding against the
   criteria. Doing this first is what makes it honest — it cannot be unread.
2. **Matrix completeness (criterion 2).** Count cells: candidates × criteria. Report
   every blank or hand-waved cell by coordinate. Mechanical, no judgment.
3. **Gate audit (criterion 3).** For each of (b)(c)(d)(e), ask: what was *run*, and
   what came back? A gate whose evidence is a sentence of reasoning is a finding.
   Gate (c) needs the network-blocked run recorded.
4. **Number audit (criterion 6).** Extract every quantitative claim. Each must carry
   its method. Then extract every *comparative adjective* ("simpler", "lighter",
   "more maintainable") and check each has a number behind it; the ones that do not
   are the findings.
5. **Trigger completeness (criterion 8).** For each reversal trigger, tick four
   boxes: observable, threshold, action, first-fire point. Then check the cost curve
   names all five graph points. Missing boxes are findings.
6. **Amendment check (criterion 10).** `grep` the design plan for the amendment.
   Verify it is §3's wording, that the original sentence is preserved in quotation,
   and that no top-level markdown file was edited (employees never edit those).
7. **Constraint grep (criterion 9).** Search for the §10.9 terms. Every hit must sit
   in a $0, no-account, or explicitly-excluded context. A hit inside the
   recommendation is blocking.
8. **Scope check (criterion 11).** `git diff master` for this task: only
   `docs/engineering/`, `docs/design/00-frontend-design-plan.md`, `.lattice/`. Any
   app code or committed spike artifact is a finding.
9. **The cold-read test (the real one).** Read the recommendation and §4 only. Ask:
   *could AS-37's implementer scaffold `apps/invoicing/` from this without asking a
   question?* If no, say which question you would have had to ask. That is the whole
   purpose of the document, and this is the test that catches a document that is
   rigorous but not usable.

**Routing guidance for the orchestrator:** findings against the **criteria, their
ranking, the candidate slate, or the sequencing verdict** are *plan-level* rework —
the reasoning is wrong. Findings against **missing numbers, incomplete cells,
under-specified triggers, or scope leakage** are *implementation-level* — the
reasoning is right and the output is sloppy.

---

## 12. Open questions — time-boxed, with defaults

| # | Question | Owner | Box | Default on expiry |
|---|---|---|---|---|
| 1 | Stripe's official SDK, or a hand-rolled client? It interacts with criterion (e): which shape makes the custody chokepoint *more* enforceable? | this task | this tick | **Decide it here, do not defer to AS-38.** AS-38 is the guard; the guard's enforceability depends on this answer, so handing it down means AS-38 inherits a decision with no criteria. Default if genuinely unresolved: choose the shape with the **smaller surface to ban**, and record the reasoning |
| 2 | Does the decision fix the data store, or leave it to AS-39? | this task | this tick | **Fix it.** AS-39 has no criteria of its own to decide it against. If left open, name AS-39's deciding criteria explicitly |
| 3 | Is front-end/server separability (h) achievable in all three candidates, or does it eliminate one? | the spike | this tick | If a candidate cannot separate them, that is a **discriminator-2 loss**, recorded — not a gate failure. It only becomes a gate failure if separability is impossible in *every* candidate, in which case say so and re-open §2's verdict |
| 4 | Does AS-30's states ledger, when it lands, fire T1? | AS-30 | AS-30 delivery | No reversal; the ledger is presumed to fit the envelope until an observable says otherwise. T1 is the mechanism, and it is cheap because of (h) |

---

## 13. Branch and worktree: none

**No branch, no worktree.** The deliverable is `docs/engineering/01-stack-decision.md`,
an amendment to `docs/design/00-frontend-design-plan.md`, and `.lattice/` state —
zero application code. Under the two-plane rule a task branch carries only app/tool
code and tests, so there is nothing to put on one. Same reasoning as AS-31 §9.3, and
the same precedent: `docs/design/00-frontend-design-plan.md` landed directly on
master (`0239a4d`).

There is a second reason here, stronger than the first: **a stack decision sitting on
an unmerged branch is invisible to exactly the readers who need it** — AS-37's
planner, and every fan task that will cite it. The spike code lives in the scratchpad
and is never committed (§7.4), so it needs no branch either.

Everything commits **directly to master from the MAIN checkout**
`/Users/forrest/Code/american-software-company/`, message form
`AS-36: <imperative summary>`, under the `cto-owen` git identity. **Do not push.**

---

## 14. Execution checklist for the implementation tick

All `lattice` commands and all commits run from the MAIN checkout.

1. `lattice status AS-36 in_progress --actor agent:cto-owen`
2. Read §1's list. Nothing else is required.
3. Fix the candidate slate per §6 — three cells, one line each on why this
   representative fills this cell, plus the excluded fourth cell with its reason.
4. **Gates first (§5.2).** Adjudicate (b)(c)(d)(e) per candidate with executed
   evidence. Eliminate failures; they are not spiked.
5. **Spike the survivors (§7)** — one screen, six measurements, scratchpad only,
   fresh directory per candidate, nothing committed. Hard one-tick box.
6. Rank the survivors lexicographically on the discriminators (§5.2). Name the
   criterion that decided it and where they differed.
7. Answer Q1 and Q2 (§12) inside the doc. Do not defer them.
8. Write `docs/engineering/01-stack-decision.md` with every §10 section, including
   the reversal tables (§9) **placed before the recommendation**, the chat-app
   argument (§8), and the one-line note discharging the agent-definition constraint
   (§1).
9. Apply §3's amendment to `docs/design/00-frontend-design-plan.md` **verbatim**, and
   add the matching row to the decision doc's amendment log. Touch no top-level
   markdown.
10. Self-check criteria 2, 3, 9, 10, 11 before handing off — all five are mechanical
    and take a minute between them.
11. Commit to master:
    `git -c user.name="cto-owen" -c user.email="cto-owen@agents.american-software.local" commit`
    message `AS-36: stack decision + design-plan Phase C amendment`. No branch, no
    worktree, **no push**.
12. `lattice comment AS-36 "<the recommendation in one line, the criterion that
    decided it, what you deferred, and what the reviewer should check first>"
    --actor agent:cto-owen`
13. `lattice status AS-36 review --actor agent:cto-owen`, then hand to
    `agent:qa-priya` with §11 as the protocol.
