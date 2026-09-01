# Decision Record — Second Developer Hire: Not Yet (the constraint is WIP, not headcount)

**Author:** Owen Kessler, CTO (`agent:cto-owen`). **Date:** 2026-09-01.
**Prompted by:** board question, DM conversation 7 msg 376 — *"do we need another
dev? it'd be nice to have one each on chat and invoicing working concurrently"*.
**Scope note:** org/personnel decision — non-engineering, so no Lattice task, per
the CLAUDE.md scope rules. This record is the durable artifact.
**Filing note:** `docs/strategy/` files 01–09 are the closed business-selection
record (milestone plan §intro). Files 10 and 11 are org decisions, placed here by
Carla's precedent (10) so the two sibling hiring records sit adjacent and
findable. A `docs/org/` split is the eventually-correct shape; noted, not acted on
— moving one record to create a directory of one is churn, and the trigger is a
third org record.

## 1. Decision

**No second developer hire today.** Engineering headcount is mine, the standing
board grant (chat msg 53) means I could hire right now with no approval, and I am
declining to — because the measurement says a second developer would produce
**zero** additional throughput under the loop as it exists today.

The board's underlying want — two lines advancing concurrently — is correct,
achievable, and worth building toward. It is just not a hiring problem yet. §5
names the triggers that flip this answer, and §4 names the thing that actually
has to change first.

This is deliberately the same answer-shape Carla reached for the PM question
(`10-pm-hire-decision.md`) and for the same underlying reason, restated in my
domain with harder numbers: *adding a person to a WIP-bound system adds nothing.*

## 2. What the board is actually asking for

The question joins two claims that have different answers:

1. **"It'd be nice to have chat and invoicing advancing concurrently."**
   **Agreed, and the work genuinely supports it.** The two lines are
   file-disjoint: the chat queue (AS-27, AS-28, AS-32, AS-33, AS-34, AS-54) lives
   entirely in `apps/chat/`; the D1 queue (AS-38…AS-50, AS-53) lives entirely in
   `apps/invoicing/`. Zero shared files. And the D1 graph was deliberately built
   to fan 10-wide (milestone plan §8.1) with a proven ready-queue invariant
   (§8.4). There is nothing about the *work* that forces serialization.
2. **"Do we need another dev [to get that]?"**
   **No — a developer is not what is missing.** §3.

## 3. Evidence

Measured off the Lattice event log (`.lattice/events/task_*.jsonl`, 162 status
transitions, 2026-08-30T00:56Z → 2026-09-01T15:47Z), not recalled. Every number
below is re-derivable with the same query.

1. **The company has never once had two tasks in flight simultaneously.**
   Max concurrent tasks in an active stage (`in_planning` | `in_progress` |
   `review`), across the entire life of the company: **1**. Not "usually 1" —
   the maximum is 1. Pairwise overlap check: 33 implementation windows, **0
   overlapping pairs**; 33 review windows, **0 overlapping pairs**.
2. **The one lane we have is idle more than half the time.**
   Union of all active-stage time: **28.1 hours** against **62.9 hours** elapsed
   → **44.8% line utilization**. We are not capacity-saturated. We are
   cadence-starved.
3. **The work itself is cheap; the lifecycle around it is not.**
   Implementation stage: median **7 minutes** wall clock (p25 4, p75 19).
   Review stage: median **7 minutes** (p75 15). Gap between consecutive status
   transitions company-wide: median 5 min, p75 13, p90 **42**, max **653**.
   The cost of a task is the ticks, not the typing.
4. **WIP=1 is structural and deliberate, not accidental.** Two mechanisms pin it,
   both in `.claude/commands/advance.md`:
   - Step 0, the **single-flight lock** — a second tick that finds a fresh lock
     "ends the tick immediately as a no-op."
   - **Bounds**, verbatim: *"One tick advances one task by one lifecycle stage,
     or performs one org-level action. Do not marathon multiple tasks in a single
     tick."*
   No roster change touches either one. Hire ten developers and the maximum
   concurrent task count is still 1.
5. **Nothing is currently blocked on developer capacity.** AS-38 and AS-39 are
   both dependency-satisfied (AS-37 done), both `backlog`, both unassigned,
   *right now*. The queue in front of Marcus is deep, not stalled. The only two
   live blockers on the board are board asks (AS-51, AS-52 at `needs_human`).
6. **There is no demonstrated capability gap.** Marcus built AS-37 — the
   `apps/invoicing` scaffold the entire D1 line sits on — and it is live and
   green on 8348 (verified by probe, DM msg 366). "He is a chat-app developer"
   would be a story about him, not an observation of him.
7. **The first added lane would move the bottleneck, not remove it.** Priya is
   the sole reviewer and *every* task passes through her by design (the review
   gate forbids the implementer reviewing their own work). Two implementers
   feeding one reviewer builds a queue in front of QA. An honest 2x needs a
   reviewer too — which is 2x headcount growth to chase a throughput problem
   whose cause is in the loop. That is the wrong order of operations.

**Where this leaves my earlier analysis.** I told the board in DM 326 that the
binding constraint is tick throughput, not people, and restated it to Carla
(DM 374, cited in `10-pm-hire-decision.md` §3.3). I re-checked it against today's
board rather than assuming, and it holds — with one correction I owe in writing:
I framed it as *tick rate*. That is only half. There are two independent
throughput terms, and I had collapsed them:

> throughput ≈ **WIP** ÷ cycle-time

- **Tick rate** attacks cycle time. Levers: a live `/loop /advance` session, or a
  watcher heartbeat. This closes the idle 55% (evidence 2). Costs no engineering.
- **WIP** is pinned at 1 by evidence 4. *This* is the term the board is actually
  asking about, and I had not named it separately. A hire is the second half of
  raising it — never the first half.

## 4. The lever the board actually wants, and why it is not a config flag

To get "one on chat, one on invoicing, concurrently," the change is: **one tick,
one orchestrator, multiple implementer sub-agents running in parallel in separate
worktrees.** The single-flight lock stays. The orchestrator in the main checkout
remains the **sole writer of board state**, serializing every `.lattice/`
mutation and every commit to master; sub-agents touch only `.worktrees/AS-<n>/`.
This is a modest generalization of a pattern the company already ran once — I
spawned Jonah's AS-30 planning stage concurrently with writing a board reply
earlier today (msgs 369/373).

It is not a flag flip, and I want the sharp edges on the record before anyone
treats it as one:

- **Board-write race — the real one.** The worktree hazard learned in AS-26
  (CLAUDE.md, Git Methodology) is that a sub-agent's `cd` into a worktree
  silently redirects `lattice` writes onto the task branch, and reads back
  *looking correct*. Two concurrent sub-agents double that exposure, and the
  failure is silent. Mitigation is architectural: sub-agents are forbidden to
  touch `.lattice/` at all; the orchestrator owns every board write. That is a
  real change to the Employee Execution Model (today employees leave their own
  Lattice comments), and it has to be designed, not assumed.
- **The lock exists because we already lost work to concurrency.** 2026-08-31,
  duplicate CEO scoring pass (`docs/strategy/04-scores-ceo.md`, Drafting record).
  Weakening a safety property that was installed after a lived incident deserves
  a spike with a written result, not confidence.
- **Supervisory attention.** One orchestrator holding two lanes reviews both
  worse. Bounded ticks are also *resumable* ticks; a tick that dies mid-fan
  leaves two half-states instead of one.

**What I would file (not filed in this session — this session's mandate was the
org question, and I would rather be precise about my mandate than helpful past
it):**

> **Title:** advance loop: parallel implementer lanes — raise WIP above 1 with a
> single board writer
> **Scope:** spike first. One tick, two implementation sub-agents, two worktrees,
> orchestrator-only board writes. Measure: does board state stay consistent, do
> both worktrees stay clean, does wall clock beat two serial ticks by enough to
> justify the complexity. Ship the loop change only if the spike says yes.
> **Acceptance:** the overlap query in §3.1 returns a non-zero overlapping-pair
> count, with zero stray `.lattice/` writes on any task branch.
> **Needs:** proposed wording for the `/advance` **Bounds** section and the
> CLAUDE.md Operating Modes section, handed to the metawork layer (§7).

Default if the board says nothing: **I file it next tick, at medium priority,
behind AS-30 and the D1 spine (AS-38, AS-39), and it does not preempt product
work.** The board can veto it — it weakens a safety property, so a veto is a
legitimate call and I will not treat silence as enthusiasm.

**Cheaper lever, available today, unchanged from DM 326:** running
`/loop /advance` in a live session closes the idle 55% (evidence 2) with zero
engineering and zero hiring. It does not produce concurrency, but it produces
more finished tasks per day than concurrency would, sooner.

## 5. Triggers — any one fires the hire (or the forced revisit)

Named and observable, so this is not re-litigated from scratch. Consistent with
`10-pm-hire-decision.md` §5, which I am not contradicting: this record answers a
capacity question in engineering, that one answered a role-existence question.

1. **WIP rises above 1 — the primary trigger, and it is causal, not
   consequential.** The moment the parallel-lanes change reaches `planned`, I
   hire *before* its implementation stage runs, so the second lane has an
   occupant on day one. I do not wait for overlap to appear in the log; a lane
   with nobody in it is the thing the hire exists to prevent.
   **Pre-committed:** hire the **pair** — a second `developer-*` *and* a second
   `qa-*` — or record in writing that I am knowingly accepting a review queue in
   front of Priya (evidence 7). Not silently.
2. **Capability gap, not capacity.** Two consecutive `apps/invoicing` tasks
   bounce to rework on *domain* grounds — Stripe/payments semantics, webhook
   idempotency, custody-guard reasoning — rather than plan or general-engineering
   grounds. That is evidence for a **different hire** than "a second Marcus": a
   payments/integrations specialist. Deliberately mirrors Carla's §5.1 structure.
3. **Bus factor stops being theoretical.** Marcus's stage terminates mid-cycle
   twice more (rate limit, or a half-applied change left on disk — AS-26 rework
   cycle 2) *despite* the Opus-fallback directive. One incident is an incident;
   three is a single point of failure, and redundancy becomes the argument on its
   own, independent of throughput.
4. **Forced revisit, mechanical backstop: the ready queue first reaches 4+
   unblocked, unassigned, non-board-gated D1 build tasks simultaneously.** That
   is the point where the graph is widest and WIP=1 costs the most — it happens
   as soon as AS-38 and AS-39 both land, which is a handful of ticks away, not a
   quarter. **This decision must be explicitly re-taken there; silence is not a
   re-decision.**

## 6. Shape of the hire when a trigger fires (pre-agreed, so it is fast)

- **Title:** `developer-<name>`, Software Engineer. **Class:** `ic`.
  **Reports to:** `agent:cto-owen`. **Team:** engineering. Full frontmatter per
  the Org Chart schema; MBTI, résumé, assigned model per the personnel
  conventions.
- **Lane split under trigger 1:** the new developer takes **`apps/chat`
  (internal tools)**; **Marcus stays on the D1 line**. Deliberate and the reverse
  of the board's framing: Marcus already carries the scaffold context the whole
  D1 line sits on, and the chat codebase is the one where cold-start context is
  cheapest. Put the new person where the ramp is shortest, not where the work is
  newest.
- **Under trigger 2 instead:** payments/integrations background, lane is the D1
  server fan, and Marcus keeps internal tools. Different person, different
  résumé, different trigger — do not let trigger 2 be satisfied by a trigger-1
  hire.
- **Assigned model:** whatever Marcus carries, unless trigger 2 fired, in which
  case the domain reasoning justifies a step up. Board's model-fallback directive
  applies unchanged.

## 7. "Wrong call" signal, named in advance

My whole diagnosis rests on the claim that calendar time to v1 is dominated by
inter-stage gaps rather than in-stage work. It is falsifiable with the query in
§3: **if line utilization climbs above ~80% while the ready queue stays deep,
capacity was the constraint and I was wrong.** Pre-committed action: hire the
pair immediately and say plainly in `#board` that the WIP diagnosis was the
wrong read, before anyone has to ask.

Reciprocally, if utilization stays under ~50% for another week of D1 work, the
hire question should not be reopened at all — the answer is the loop, and
repeatedly asking it would be a tell that we prefer the familiar lever to the
correct one.

## 8. Signatures

- **Owen Kessler, CTO** — SIGNED, 2026-09-01. Engineering headcount decision
  taken under my domain; taken *against* a standing grant that would have let me
  hire, which is the part I want legible.
- **Carla Voss, CEO** — not required (engineering headcount is the CTO's), but
  the record is hers to read and contest; the reciprocal precedent is
  `10-pm-hire-decision.md`, whose §7 countersignature slot I closed this tick.

## Proposed metawork edits

For the orchestrator to apply to `CLAUDE.md` (employees do not edit top-level
markdown), under the **Org Chart** section, immediately after the PM-hire bullet:

> - **Second developer hire: decided "not yet" 2026-09-01** (board DM msg 376;
>   record `docs/strategy/11-second-developer-decision.md`). Measured off the
>   event log: max concurrent tasks in an active stage has been **1** for the
>   life of the company, at **44.8%** line utilization — WIP is pinned by the
>   `/advance` single-flight lock and the one-task-per-tick bound, not by
>   headcount, so a second developer adds zero throughput today. Re-opens on the
>   record's §5 triggers — parallel implementer lanes reaching `planned` (hire
>   the dev **and** a second QA, or record the accepted review queue), two
>   consecutive domain-level rework bounces on `apps/invoicing`, a third
>   mid-cycle implementer termination, or (forced revisit) the ready queue first
>   reaching 4+ unblocked D1 build tasks. Lane split and role shape are
>   pre-agreed in the record §6.
