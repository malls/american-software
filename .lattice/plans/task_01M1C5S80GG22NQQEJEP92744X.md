# AS-31: D1 v1 build scoping: convert spike record into milestone plan and right-sized build tasks

**Planner:** Owen Kessler, CTO (`agent:cto-owen`). **Date:** 2026-08-31.
**Complexity:** medium. **Branch/worktree:** none — see §9.3.

## 0. What this plan is, and who executes it

This is a plan for a *scoping* task. The implementation stage produces **documents
and Lattice tasks, not code**. A fresh instance of `agent:cto-owen` executes it
next tick with only this file and the repo — no conversation, no shared context.
Everything that instance needs to decide is either decided here or given an
explicit procedure here.

The output has two parts:

1. **`docs/engineering/00-d1-v1-milestone-plan.md`** — the single source of scope
   truth for D1 v1 (§2).
2. **A set of Lattice build tasks** derived from it, with dependency edges (§6).

The review stage reviews a plan and a task graph, not a diff. §11 is the review
protocol; it exists because "run the tests" does not apply here and a reviewer
should not have to invent a method at the gate.

## 1. Read first (in this order, and no others are required)

| File | What you need from it |
|---|---|
| `docs/strategy/08-board-decision.md` | The green-light and its scope. §3 = the three operative defaults. §5 = the carried-forward risk. §6(b) = my countersignature committing that risk into this plan. |
| `docs/strategy/07-decision-memo.md` §3, §4 | The steelman at full strength, and the open board asks. §3 is the source of assumption A1 (§7). |
| `docs/strategy/spikes/spike-D1-freelancer-invoicing.md` | The measured record this task converts. §1 (eight verified primitives + the forbidden shape), §2 (template licensing), §3 (deliverability), §4 (invoice render is commodity), §5 (what was *not* measured). |
| `CLAUDE.md` → Product | The operative defaults in their binding form. |
| `docs/design/00-frontend-design-plan.md` | §4 Phase B (AS-30's contract), §5 (the engineering handoff contract), §7 Q2 (naming). Phase C is where the stack decision was deferred to — this plan slots it (§9.1). |
| `docs/strategy/09-company-name.md` §8.2 | Sender domains and any public-facing artifact are gated on product naming. Bears directly on §8 items 3 and 8. |
| `lattice show AS-30` | The screen-budget obligation this task must discharge (§4.3). |

Do not re-derive the product decision. It is closed by board action; AS-31 converts
it, it does not revisit it.

## 2. Deliverable 1 — the milestone plan

### 2.1 Where it lives, and why

**`docs/engineering/00-d1-v1-milestone-plan.md`** — a new `docs/engineering/`
directory.

Reasoning, since the alternative was live:

- **Not `docs/strategy/`.** Files 01–09 there are a closed, signed decision
  narrative about *what business to be in*. Several carry countersignatures. The
  milestone plan is the opposite kind of document: a **living** engineering
  reference that will be amended as v1 proceeds. Appending an amendable document
  to a signed record teaches future readers that signed records are amendable.
  Keep the two planes apart.
- **Not `.lattice/plans/`.** Those are per-task and die with the task. The
  milestone plan is cited *by* many tasks and outlives all of them.
- **Not a Lattice epic with subtasks.** Lattice holds units of work; narrative,
  rationale, and the scope filter do not compress into a task description. The
  join is by reference in both directions: the doc names `AS-<n>` for each
  in-scope row, and each task description cites the doc section it implements.
- **`docs/engineering/` mirrors `docs/design/`**, which established the
  `docs/<discipline>/NN-<name>.md` pattern with `00-frontend-design-plan.md`. It
  also gives the stack decision (§9.1) and future engineering decision records an
  obvious home.

### 2.2 Required sections

The doc is not accepted unless every one of these is present and non-empty:

1. **Purpose of v1, in one sentence.** Proposed and I believe correct — adopt it
   unless you can improve it: *the smallest system in which one real freelancer
   gets one real client to pay one real invoice, on the freelancer's own Stripe
   account, with us never in the flow of funds.*
2. **The boundary filter**, stated verbatim as §3 of this plan states it.
3. **The capability table** — the load-bearing artifact. One row per capability
   *considered*, including the ones you reject. Columns:
   `capability | IN/OUT | deciding rule | note`. Rules for the table:
   - A row is IN only if it survives all four filter rules.
   - An OUT row names **the first rule that excluded it** — not a prose excuse.
   - Nothing discussed may be missing from the table. If it was considered and
     has no row, the record is incomplete and the review will catch it (§11.1).
   - Every IN row names the `AS-<n>` that implements it, filled in after §6.
4. **Screen budget** — a number, a definition of "screen," and the derivation
   (§4).
5. **Assumptions and falsifiers** — §7, transcribed with the observable, the
   threshold, and the pre-committed action for each.
6. **Milestone sequence** — v1, then the named later milestones and what gates
   each (§8 tells you which those are).
7. **Board asks, drafted** — the exact text of each ask, answerable yes/no
   without a follow-up question (§6.4).
8. **Amendment log** — dated rows, `what changed | why | who`. First row is
   creation. Scope changes after this land here or they did not happen.

## 3. Deliverable 2 — the v1 boundary test

This is the load-bearing decision of the task. It defines AS-30's screen budget
and every task that follows, so it must be a **filter a stranger can re-run**, not
a taste. Four rules, applied in order. Each can only exclude.

**Rule 1 — Loop-critical.** A capability is in only if removing it breaks this
chain:

> freelancer signs up → connects their own Stripe account → produces a contract
> for a client → issues an invoice on that client, on the freelancer's own
> account → client pays → freelancer sees it paid

If the chain still closes without it, it is out. Note where the chain *ends*: at
the freelancer seeing payment, **not** at us collecting revenue. That is
deliberate and Rule 3 explains why.

**Rule 2 — Stripe already does it.** If Stripe's hosted surface performs the job
at $0 to us, v1 consumes Stripe's and builds none of its own. Measured instances
from the spike: hosted KYC onboarding via `account_links` (§1), the hosted payment
page (§1), `invoice_pdf` (§1, §4), Stripe-sent invoice email and its built-in
reminder cadences (§3.1). Building a parallel implementation of any of these is
out — including our own invoice PDF renderer, which the spike measured at 107
lines and 0.194 ms and *still* found unnecessary (§4). Cheap to build is not a
reason to build.

**Rule 3 — Buildable unincorporated and unaccounted.** In only if it can be built
**and verified** with: (a) no external account beyond the single board-approved
Stripe **test-mode** account; (b) no EIN or registered entity; (c) no product
name, domain, or sender identity. Anything failing this is out of v1 **by
construction, not by preference**, and moves to a named later milestone with its
board ask drafted.

This rule is why Rule 1's chain stops short of our own revenue: charging a
freelancer real money needs a live-mode processor account, which needs an entity,
which is a company milestone we do not control. Putting it inside v1 would block
engineering on incorporation. Ditto A2P 10DLC SMS (EIN-gated) and any custom
email (ESP account + sender domain + product name).

**Rule 4 — Polish is depth, not breadth.** 07 §3 says our differentiation must
come from trust, polish, and distribution rather than features. Read carefully,
that is a **scope-narrowing** force, not a licence to add: v1 buys polish by
finishing *few* screens to their complete states ledger, never by adding screens.
A candidate justified as "it makes us look more trustworthy" is out unless it
independently passes Rule 1. Polish is spent inside AS-30's states ledger, on the
screens already in the budget.

**Overflow rule.** If the IN set exceeds the screen budget (§4) or the task-count
band (§6.1), do not raise the ceiling. Re-apply Rule 1 more strictly — ask which
IN capability's removal breaks the chain *least* — and cut, recording the cut in
the capability table with the reason. Raising a ceiling is an amendment-log event
with a named reason, never a silent edit.

## 4. Deliverable 3 — screen budget and the AS-30 interleave

### 4.1 Definition

A **screen** is a distinct route with its own states ledger. Modals, drawers,
empty states, loading states, error states, and permission-denied states are
*states of a screen*, not screens. This definition matters: without it "screen
count" is gameable and the budget means nothing.

### 4.2 The number

**Ceiling 9. Target 7.** Derivation, for the next instance to check rather than
accept:

| # | Candidate screen | Foldable? |
|---|---|---|
| 1 | Sign up / sign in | no |
| 2 | Connect Stripe (with return/refresh states) | no |
| 3 | Dashboard / invoice list | no |
| 4 | Invoice create-edit | no |
| 5 | Invoice detail + status | no |
| 6 | Clients | possibly into 4 |
| 7 | Contract create | no |
| 8 | Contract detail + status | possibly into 5 |
| 9 | Account settings | no |

Nine is the honest ceiling for the Rule-1 chain; seven is reachable if 6 folds
into 4 and 8 folds into 5. A public marketing page is not on the list — it is
product-name-gated (§8.8). Land the exact inventory inside the ceiling; if the
filter admits a tenth, apply the overflow rule.

### 4.3 Discharging AS-30's obligation

AS-30's description requires "a hard screen budget agreed with the CTO at
kickoff." **This task's §4.2 output is that budget.** The implementation stage
must post a comment on AS-30, as `agent:cto-owen`, citing
`docs/engineering/00-d1-v1-milestone-plan.md` §(screen budget) by name and stating
the ceiling. Without that comment, the obligation is undischarged and AS-31 fails
acceptance criterion 7 (§10).

### 4.4 How AS-30 interleaves instead of serializing

The mechanism is structural, not a promise:

- **The spine needs no wireframes.** Stack decision, app scaffold, the Stripe
  wrapper and custody guard, the webhook receiver, the data model, and the
  server-side half of Connect onboarding are all invisible to UX. They run
  concurrently with AS-30.
- **Dependency rule:** no build task may declare `depends_on AS-30` **except**
  tasks that render one of the budgeted screens. Enforced at review (§11.3).
- **Ready-queue invariant:** the graph must keep at least one non-UI task
  unblocked at every point, so a stall in design never stalls the company. This
  is checkable by simulating the graph (§11.3) and is an acceptance criterion.
- **Citation contract:** a UI task's plan cites the specific wireframe file for
  its screen. If AS-30 has not delivered that screen, the UI task waits and the
  implementer pulls from the non-UI fan instead.

## 5. Deliverable 4 — what "right-sized" means, measured

Asserting a size is worthless; we have 24 merged tasks of evidence. Measurements
taken this tick (`git diff --shortstat` between merge parents, `.lattice/`
excluded; n=24 merged code tasks, AS-3 … AS-29):

- **Median 6 files changed, ~222 insertions, 5 commits on the branch.**
- Middle of the distribution: 3–8 files, ~90–430 insertions.
- Tail above 1,000 insertions: AS-6 (1,011), AS-24 (1,163), AS-26 (1,495),
  AS-29 (4,467).
- **Rework rate is where the tail bites.** Across 35 tasks with status history,
  exactly 3 took a review→rework cycle: AS-17, AS-26, AS-29. Two of the four
  largest diffs in company history reworked (2/4 = 50%); of the 20 tasks under
  1,000 insertions, one reworked (5%). Small sample, stated honestly — but a
  tenfold difference in the same direction as the prior is enough to set a
  tripwire on.
- Nearly every task completed plan→implement→review inside one tick; AS-25 took
  two; the three rework tasks took a second cycle.

### 5.1 The primary test (semantic — this is the one I believe)

A build task is right-sized when all three hold:

1. **One reviewable claim.** The task reduces to one sentence of the form
   *"X now works, and here is how you can see it."* Two claims joined by "and"
   across different subsystems means two tasks.
2. **Question-free implementability.** An implementer holding only the plan file
   and the repo can finish without asking anyone anything. (This is not
   aspirational — it is how this company's lifecycle actually works, and the
   handoff has no back-channel.)
3. **Named verification method, runnable now.** The task states at creation time
   how it will be verified, and that method works with the accounts we actually
   have. If the only verification is "look at it in a browser against a live
   Stripe account," the task is mis-scoped or mis-sequenced — it belongs behind
   a board-ask task, not in the ready queue.

Test 3 has teeth in this product specifically: stripe-mock is stateless and emits
no webhooks (spike §1), so anything whose correctness *is* a state transition or a
webhook cannot be honestly verified until the test-mode account exists. Say so at
creation rather than discovering it at the review gate.

### 5.2 Secondary tripwires (mechanical, from our own record)

Split before creating the task if any of these trip, or carry a one-line written
justification in the description:

- projected new code + tests **> ~600 lines**
- **> ~10 files** touched
- the title joins two subsystems with "and"
- the task would need a board ask **mid-flight** → split the ask into its own task
- it cannot be verified without an account we do not have → it is a *gated* task,
  sequenced behind its ask, not a ready one

**Floor:** do not split below roughly one file / ~50 lines for build work. Three
agents each load context for plan, implement, and review; below that floor the
lifecycle costs more than the work. (Our sub-50-line tasks — AS-14, AS-15 — were
production bugs, where the floor rightly does not apply.)

## 6. Deliverable 5 — the task set

### 6.1 Expected count

**10–16 tasks total**, comprising roughly 10–13 build tasks, 1 stack-decision
task, and 2–3 board-ask tasks. This band is a **self-check, not a target**: fewer
than 8 means the tasks are too coarse to survive §5.1; more than 20 means either
they are too fine or v1 is too big and the overflow rule (§3) was not applied.
Landing outside the band is allowed but must be explained in the milestone plan.

### 6.2 Dependency shape: spine → fan → join

Name the shape, not just the edges.

**Spine (strictly serial, 3 tasks).** Nothing else starts until these land in
order:

1. **Stack decision** — CTO-owned, produces `docs/engineering/01-stack-decision.md`
   (§9.1). Blocks everything.
2. **App scaffold** — `apps/invoicing/` (§9.2), docker compose, test harness,
   the "runs with no external services" baseline.
3. **Stripe client wrapper + custody guard** — the single chokepoint (§7, A2/A3).
   Hard-requires the `Stripe-Account` header; bans `transfer_data`,
   `on_behalf_of`, and platform-side charge params; ships with tests that fail if
   the ban is removed. **This lands before any code that calls Stripe** — the
   guardrail precedes the thing it guards, which is the only ordering under which
   "permanent design-review obligation" (spike §1) means anything mechanical.

**Fan (parallel, mostly independent).** Feature tasks depending on the spine but
not on each other — one worktree each per the two-plane rule. Expect these to
cover: auth/accounts; Connect onboarding (`/v1/accounts` + `/v1/account_links` +
return/refresh + `account.updated`); clients; contract generation from the
adapted Common Paper templates; invoice create → finalize → send; the webhook
receiver and `invoice.*` state sync; the read/dashboard views; reminder
configuration riding Stripe's cadences. Split each along the seam between its
server half (no wireframe needed) and its UI half (cites AS-30) wherever that
seam is clean — that is what keeps the ready queue non-empty on both sides of
§4.4.

**Join (1 task).** End-to-end loop verification against the Rule-1 chain, in test
mode, on a local compose stack. This task *is* the definition of v1-done
(§8.9). It is necessarily gated on the Stripe test-mode account.

**Rules the graph must satisfy** (all checked at review, §11.3):

- acyclic;
- spine is strictly serial;
- every Stripe-touching task transitively depends on the custody-guard task;
- `depends_on AS-30` appears only on screen-rendering tasks;
- at every point in a topological walk, at least one non-UI task is unblocked.

### 6.3 What every task description must contain

Three things, no exceptions — this is what makes the review's traceability test
possible:

1. the **milestone-plan section** it implements (by anchor);
2. its **verification method** (§5.1 test 3);
3. what is **explicitly not in it** — the near-miss capability a reasonable
   implementer might otherwise absorb.

### 6.4 Board-ask tasks — how they are handled

My AS-31 comment commits that every processor/ESP/carrier signup, free and
test-mode included, is a board ask filed explicitly when engineering reaches it,
and that scoping does not open accounts or assume one exists. Discharge that
precisely:

- **Create the ask tasks now**, in `backlog`, with the **full text of the ask
  already drafted in the description** — cost, what it unblocks, what happens if
  refused, alternatives considered. Answerable yes/no with no follow-up question.
- **Move an ask to `needs_human` in the tick the first task it blocks is next to
  be pulled** — not before, which would be scoping opening the request, and not
  after, which would stall the queue.
- The expected first ask, per 08 §3.3, is the **free Stripe test-mode account**.
  Creating this task does not request it and does not open it.
- Anything an ask unblocks carries a `depends_on` edge to the ask task, so the
  gate is visible in the graph rather than discovered in an implementer's context.

## 7. Assumptions with falsifiers (mandatory content, not caveats)

My comment on AS-31 commits 07 §3's risk into the plan as a **named assumption
with a falsifier**. A falsifier without an observable, a threshold, and a
pre-committed action is a caveat wearing a lab coat. All three, for each:

### A1 — the occupied-band bet (07 §3, carried by 08 §5)

*Freelancers in the occupied $15–30/mo band will switch to us for a
contract→invoice→paid loop; differentiation will come from trust, polish, and
distribution rather than features — so a deliberately small, fully-finished v1 is
the right bet.*

- **F1a (demand side).** Observable: the structured interviews from the board's
  warm intros (07 §4.1). Threshold: **≥3 of 5** interviewees report their current
  tool already handles contract→invoice→paid acceptably **and** price is not among
  their top-two complaints. Pre-committed action: **v1 scope freezes at the
  boundary** — we do not answer falsification by growing features, which is
  precisely the trap 07 §3 names — the CTO files a written report with a
  recommendation to the board within one tick (08 §5 converted "withdraw" into
  "report promptly"; this names what the report contains), and the milestone
  *after* v1 is redirected from features to distribution.
- **F1b (supply side — a confirmation test, stated honestly as one).** 07 §3
  claims our ease is symmetric: v1 is reproducible from public docs by anyone.
  That is measurable on us, for free, because we are building v1 anyway.
  Observable: actual v1 build cost — tasks, ticks, lines — against this plan's
  projection. Threshold: v1 lands at or under projection with no surface that is
  not either Stripe's or commodity. Pre-committed action: the symmetric-ease risk
  is recorded as **confirmed**, and distribution becomes the next milestone by
  default, with no further argument required. A cheap measurement that costs one
  paragraph and settles an argument we would otherwise have later and worse.

### A2 — subscription-only (08 §3.2)

*Subscription-only is the operative revenue model; no application-fee code path is
built.*

- **Trigger, not falsifier:** a board ruling that the app-fee rail is clean under
  constraint 7.
- **Design consequence decided now:** the spike measured the reversal as one
  parameter on one call (`application_fee_amount` on a connected-account invoice
  create, §1). So v1 keeps **every Stripe call behind a single module** — which
  builds no app-fee path (the constraint is honored literally) but declines to
  foreclose one. Projected reversal cost: one task, at or below the §5.2 floor.
- **Restate my standing note in the milestone plan** so it stays visible: a board
  ruling *before* v1 lands is worth materially more than one after.

### A3 — custody (spike §1) — an invariant, so it gets a mechanism, not a falsifier

*Never in the flow of funds is permanent. The forbidden shape (platform-side
invoice with `transfer_data[destination]`) lives in the same API and the mock
accepts it, so the boundary is ours to hold forever — the API will not hold it for
us.*

Mechanism: the custody-guard task (§6.2, spine 3), landing before any Stripe
caller, with tests that fail if the ban is removed. Any future change crossing the
boundary fails the suite rather than requiring someone to remember.

## 8. Explicitly out of v1 — do not relitigate

Each of these is decided. The capability table records them as OUT rows with the
deciding rule. If the next instance disagrees, that is an amendment-log entry with
a written reason, not a quiet reversal.

1. **Application-fee / take-rate anything** — 08 §3.2. Rule 3 (board default).
   Not built, not designed for beyond A2's single chokepoint.
2. **Our own subscription billing and paywall enforcement in live mode** — needs
   an entity and a live-mode account. Rule 3. Separate milestone, incorporation-gated.
   Plan-gating *code* is out by default too; admit it only if it can be verified
   with no account, and if admitted keep it to a flag, with no billing UI.
3. **Custom email of any kind** — dunning sequences, onboarding drips, product
   email. Rule 3 (ESP account + sender domain + product name). v1 rides Stripe's
   own invoice email and reminder cadences (spike §3.1).
4. **SMS / A2P 10DLC** — requires an EIN matched to a registered business; the
   company is unincorporated. Rule 3. Out by construction, and the spike itself
   recommended it stay out of D1 (§3).
5. **Our own invoice PDF renderer** — Rule 2. Stripe's `invoice_pdf` covers it;
   the 107-line spike renderer stays throwaway (spike §4).
6. **E-signature with legal weight** — audit trail, certificate, tamper-evidence.
   Out. v1's contract capability is at most *generate from an adapted template →
   deliver → record an acceptance event*, and even that carries the C5
   lawyer-review residual (spike §2): adapted template text is not shown to a real
   user before that review clears. Legal review is non-Lattice company work
   (CLAUDE.md scope) — reference it from the task description as a gate, do not
   create a Lattice task for the review itself.
7. **Multi-currency, VAT, jurisdictional invoice fields** — recurring content
   maintenance the C3 rationale already priced. Out of v1; the data model should
   not foreclose it.
8. **Marketing site, public pages, DNS, sender domains** — Rule 3(c). Blocked on
   product naming (09 §8.2, which explicitly extends "public-facing artifact" to
   sender-domain configuration).
9. **Production deployment to Digital Ocean** — board-gated spend, plus naming
   gates the domain. **v1's definition of done is: the Rule-1 chain closes
   end-to-end in Stripe test mode on a local docker-compose stack, verified by
   automated tests plus one recorded manual run.** Deployment is the next
   milestone, with its asks drafted. Stating this plainly keeps engineering off
   the critical path of decisions it does not own.
10. **Feature-parity territory** — mobile/native apps, accounting or time-tracking
    or Zapier integrations, multi-seat/teams, a client portal beyond Stripe's
    hosted pages, recurring invoices for the freelancer's own clients, proposals,
    time tracking, expenses. Rule 1 for all of them. This is exactly the ground
    07 §3 warns is occupied; competing there on features is the losing move the
    memo named in advance.
11. **The framework/stack choice is not made by AS-31** (CEO's instruction on this
    task, and correct). It slots as spine task 1 — see §9.1.

## 9. Decisions this plan already makes (so the next instance does not spend a cycle)

### 9.1 Where the stack decision slots

Spine task 1, CTO-owned, producing `docs/engineering/01-stack-decision.md` in the
form the front-end plan §4 Phase C requires: options, criteria, a recommendation.
AS-31 **names the slot and the criteria; it does not choose the stack.** The
criteria the decision must weigh (no candidates named here):

- implementable by agent ICs working from text alone;
- runs under docker compose, per the infra rule;
- has a test story that runs with **no external accounts** (§5.1 test 3 depends on
  this);
- requires no paid services or licences;
- permits the Stripe wrapper to be a single enforceable chokepoint (A2/A3);
- deploys to Digital Ocean when the deployment milestone opens;
- consumes the AS-29 tokens without a build step fight (front-end plan §5).

Our internal tooling convention (zero dependencies, `node --test`, compose per app
— see `apps/chat/package.json`) is **evidence for the decision, not the decision**.
A product with a payment integration and real users may justify different answers;
that is what the decision task is for.

### 9.2 Product directory name

**`apps/invoicing/`.** Not a placeholder — it is the correct name under 09 §8.2:
the monorepo/internal-infra layer carries generic descriptive names, and the
product brand attaches at the extraction seam and on customer-facing surfaces
(deploy domains, sender domains, app chrome). So this directory never needs to
change when the product is named, and naming does not block the scaffold. The next
instance may overrule with a written reason in the amendment log.

### 9.3 No branch, no worktree

AS-31 produces `docs/engineering/*` and `.lattice/*` and touches no app code. Under
the two-plane rule a task branch carries only app/tool code and tests, so there is
nothing to put on one. Everything commits **directly to master from the main
checkout** `/Users/forrest/Code/american-software-company/`, message form
`AS-31: <imperative summary>`, under the `cto-owen` git identity. Do not push.

Precedent and reasoning: `docs/design/00-frontend-design-plan.md` landed on master
directly (`0239a4d`). More importantly, a milestone plan sitting on an unmerged
branch is invisible to exactly the readers who need it now — AS-30's kickoff and
every task description that cites it.

## 10. Acceptance criteria for AS-31

"A milestone plan exists" is not a criterion. Each of these is checkable by
inspection, and §11 says how.

1. **Doc exists with all eight required sections** (§2.2), each non-empty. The
   capability table's OUT list is non-empty and includes, at minimum, every item
   in §8.
2. **The filter is reproducible.** A reviewer picking any three IN rows and three
   OUT rows and applying §3's rules independently reaches the same verdicts. A row
   whose verdict cannot be re-derived from the stated rules is a fail — it means
   the rules are decoration and the real reasoning is unwritten.
3. **Bidirectional traceability.** Every IN row names a task; every created task
   cites an IN row. No orphans in either direction. This is the single strongest
   criterion and it is a set difference, not a judgment call.
4. **Every task description carries all three of §6.3's elements.**
5. **The dependency graph satisfies all five rules in §6.2.**
6. **Right-sizing holds.** No task trips a §5.2 tripwire without a written
   one-line justification; no title joins two subsystems with "and"; nothing sits
   below the floor without being a genuine standalone bug.
7. **AS-30's obligation is discharged** — a comment by `agent:cto-owen` on AS-30
   citing the screen-budget section and stating the ceiling (§4.3).
8. **Board asks exist and are drafted** to the §6.4 standard, in `backlog`, with
   `depends_on` edges from what they gate. No account was opened and no task
   assumes one exists.
9. **Constraint compliance is greppable.** No task scopes an application-fee code
   path; nothing in v1's critical path requires outbound SMS, an incorporated
   entity, a product name, or an ESP.
10. **Assumptions carry falsifiers** with observable, threshold, and pre-committed
    action — all three, for A1 (both falsifiers), A2, and A3's mechanism.

## 11. Review protocol — what QA should actually check

The usual "run the tests" does not apply: this task ships a document and a task
graph. `agent:qa-priya` reviews cold, per convention. Here is the method, so it is
not invented at the gate.

1. **Traceability diff (criterion 3).** Extract IN rows from the capability table;
   extract the new tasks via `lattice list`. Compare the two sets. Report every
   orphan on either side by name. Mechanical; no judgment.
2. **Filter re-derivation (criterion 2).** Pick 3 IN and 3 OUT rows *without*
   reading their notes. Apply §3's four rules. Compare verdicts. Any mismatch is a
   finding against the filter, not against the row.
3. **Graph check (criterion 5).** Build the graph from `lattice show` on each new
   task. Assert: acyclic; spine serial; every Stripe-touching task transitively
   behind the custody guard; `depends_on AS-30` only on screen-rendering tasks;
   and simulate a topological walk confirming a non-UI task is unblocked at every
   step. A throwaway script is encouraged — it is faster and more trustworthy than
   reading edges by eye.
4. **Constraint grep (criterion 9).** Search all new task descriptions and the
   milestone plan for `application_fee`, `transfer_data`, `on_behalf_of`, `SMS`,
   `10DLC`, ESP names, domain purchase, `live mode`. Every hit must sit in an
   explicitly-OUT or explicitly-forbidden context. A hit in an IN row is a
   blocking finding.
5. **Cold-read test (criterion 4, and the real one).** Pick the task you
   understand *least*. Read only its description and the milestone-plan section it
   cites — nothing else. Ask: could I implement this without asking a question? If
   no, that task fails right-sizing and clarity, and say which question you would
   have had to ask.
6. **Budget arithmetic (criterion 6/§4).** Count the distinct screens implied by
   the IN UI tasks, using §4.1's definition. Over the stated ceiling with no
   amendment-log entry is a fail.
7. **No-code check (§9.3).** `git diff master` for this task should touch only
   `docs/engineering/`, `.lattice/`, and nothing else. App code appearing here
   means the scoping task overstepped into implementation.

**Routing guidance for the orchestrator:** findings against the *filter* or the
*boundary* are plan-level rework (the reasoning is wrong); findings against
individual task descriptions, edges, or sizing are implementation-level rework
(the reasoning is right, the output is sloppy).

## 12. Open questions — time-boxed, with defaults

| # | Question | Owner | Box | Default on expiry |
|---|---|---|---|---|
| 1 | Does the contract capability include a recorded acceptance event, or is generate+deliver the whole of it? | next CTO instance | decided in the capability table, this tick | generate + deliver + record acceptance; no legal e-sign claims (§8.6) |
| 2 | Is any plan-gating/subscription-enforcement code in v1? | next CTO instance | this tick | out — deferred with live billing (§8.2) |
| 3 | Does the board rule on constraint 7 before v1 lands? | board | v1 completion | subscription-only stands; the single-chokepoint wrapper preserves the option at one-task reversal cost (A2) |
| 4 | Do the warm intros arrive before v1 lands? | board | v1 completion | build proceeds — 08 §3.1 makes interviews a build-shaping input, not a gate; F1a still fires whenever they run |
| 5 | Lawyer-agent review of the adapted Common Paper templates — when? | CEO + CTO | before any adapted template text is shown to a real user | non-Lattice company milestone; contract tasks ship clearly-marked placeholder text until it clears (§8.6) |

## 13. Execution checklist for the implementation tick

All `lattice` commands and all commits run from the MAIN checkout
`/Users/forrest/Code/american-software-company/`.

1. `lattice status AS-31 in_progress --actor agent:cto-owen`
2. Read §1's list. Nothing else is required.
3. Write `docs/engineering/00-d1-v1-milestone-plan.md` with all eight §2.2
   sections. Build the capability table by running §3's filter over every
   capability you consider — including the §8 items, which get OUT rows.
4. Land the screen inventory inside the §4.2 ceiling.
5. Create the tasks (§6), `--actor agent:cto-owen`, each with §6.3's three
   elements. Add `depends_on` edges. Create the board-ask tasks in `backlog` with
   drafted text (§6.4).
6. Fill each IN row's `AS-<n>` column. Verify criterion 3 yourself before handing
   off — it is a set difference and takes a minute.
7. Comment on AS-30 with the screen budget (§4.3).
8. Commit to master:
   `git -c user.name="cto-owen" -c user.email="cto-owen@agents.american-software.local" commit`
   message `AS-31: v1 milestone plan + build task set`. No branch, no worktree, no
   push.
9. `lattice comment AS-31 "<what you decided, what you deferred, what the reviewer should look at first>" --actor agent:cto-owen`
10. `lattice status AS-31 review --actor agent:cto-owen`, then hand to
    `agent:qa-priya` with §11 as the protocol.
