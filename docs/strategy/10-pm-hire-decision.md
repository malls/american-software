# Decision Record — Product/Project Manager Hire: Not Yet

**Author:** Carla Voss, CEO (`agent:ceo-carla`). **Date:** 2026-09-01.
**Prompted by:** board question, #board msg 368 ("do we need a product or project
manager. yet?"). **CTO input:** Owen Kessler, by DM (msgs 372/374/375), cited
throughout — the plan stage of the engineering lifecycle is his process, and this
record takes no position inside his domain beyond what he stated himself.
**Scope note:** org/personnel decision — non-engineering, so no Lattice task, per
CLAUDE.md scope rules. This record is the durable artifact.

## 1. Decision

**No product manager or project manager hire now.** The question is answered with
named, observable triggers (§5) so it does not get re-litigated from scratch. The
standing board hiring grant (chat msg 53) means no approval is needed when a
trigger fires — the trigger definitions below are the whole gate.

## 2. The question, split — because the two roles have different answers

Forrest's phrasing ("product or project manager") joins two different jobs:

1. **Project management** — sequencing, dependencies, status tracking.
   **Answer: probably never a hire.** This work is done, mechanically, by the
   D1 dependency graph (34 machine-verified edges, milestone plan §8.3–8.4),
   Lattice status discipline, and the tick orchestrator. A human-shaped role here
   would duplicate infrastructure the company already trusts.
2. **Product management** — deciding what to build and why.
   **Answer: not yet, by design.** For v1 this work is *complete and deliberately
   frozen*: the boundary filter, capability table (57 rows), screen budget, and
   amendment log (milestone plan §2–§4, §9) are the product decisions, already
   made and countersigned. A PM hired today would own nothing but per-task
   plan-stage mechanics — a translation layer over a document whose entire purpose
   is to make translation unnecessary (CTO, DM 374).

## 3. Evidence consulted

1. **Org (personnel frontmatter, headcount 8):** two cofounders; engineering ICs
   Marcus (dev) and Priya (QA) under the CTO; Sofia (brand) under the CEO; Jonah
   (UX) under the CTO; researchers Elliot and Nadia under the CEO (step-2
   engagement concluded). No `pm-*` exists; the Employee Execution Model's plan
   stage ("pm-* **or a tech lead**") is currently and legitimately filled by the
   CTO as tech lead.
2. **The queue (lattice list):** 13 unassigned D1 build tasks (AS-38..AS-50)
   behind a milestone plan that already carries ~80% of each per-task plan —
   capability rows, projected size, dependency edges, named verification method.
   The two live blockers are board asks (AS-51, AS-52 at `needs_human`), not
   planning capacity.
3. **The throughput constraint (CTO diagnosis, board DM 326, reconfirmed DM 374):**
   the binding constraint is **tick throughput, not people**. Ticks are
   serialized — one task advances one lifecycle stage per tick — and fire on
   board message cadence. Adding a person to a tick-bound system adds zero
   throughput; every stage costs one tick regardless of whose name is on the
   actor field. The levers for a faster line are operational (a live
   `/loop /advance` session, or a watcher heartbeat — the board's call), not a
   hire. I looked for a competing commercial-side diagnosis and found none: the
   CEO-side ledger produces no PM-shaped work earlier than the demand-validation
   interviews (naming is a brand exercise with Sofia; pricing arrives with M2
   behind incorporation; distribution is M5 behind the falsifiers).

## 4. Who does the work implicitly today

- **Per-task planning (v1 line):** CTO, as tech lead — his stated preference
  (DM 374), inside his domain, and cheap because the milestone plan carries the
  weight. Not a hidden PM role; a scoped tech-lead function.
- **Sequencing/status:** the dependency graph + Lattice + tick orchestrator.
- **Commercial arbitration:** CEO.

## 5. Triggers — any one fires the hire (or the forced revisit)

1. **Planning-capacity falsifier (CTO's, DM 374):** two consecutive D1 build
   tasks bounce to plan-rework or `needs_human` on **scope** questions (not
   implementation bugs) that the milestone plan cannot answer. That is direct
   evidence the plan stage is the bottleneck; the CTO's own words: "if it fires,
   I want a pm-* the same week."
2. **Scheduled trigger:** the board's 3–5 warm freelancer intros land and
   structured interviews begin. Synthesizing them against falsifier F1a's
   threshold (milestone plan §5) is the first genuinely PM-shaped artifact this
   company will produce, and it decides the M1–M5 ordering.
3. **Forced revisit, latest backstop:** the AS-49 join (automated end-to-end
   verification) — M5 distribution arbitration becomes real then regardless of
   whether the interviews have landed. This decision must be explicitly re-taken
   at that point; silence is not a re-decision.

## 6. Shape of the role when a trigger fires (pre-agreed, so the hire is fast)

- **Title:** `pm-<name>`, Product Manager. **Class:** ic initially.
- **Reports to:** `agent:ceo-carla`. Rationale: falsifier adjudication and
  post-v1 milestone arbitration are commercial judgment; and the CTO's own
  displacement argument — the author of the scope should not grade the scope —
  cuts the same way for reporting lines. Agreed with the CTO (DM 375/374).
- **Owns:** interview synthesis and F1a/F1b falsifier adjudication; post-v1
  milestone (M1–M5) arbitration and recommendation to the cofounders; M5
  distribution scoping. Per-task plan-stage work on engineering tasks only if
  trigger 1 was the cause.
- **Displaces:** the CTO from demand-side judgment on A1 (his request); the CEO
  from first-pass milestone arbitration.
- **"Wrong call" signal, named in advance:** if two consecutive PM deliverables
  are restatements of decisions the boundary filter or the cofounders had
  already made — the role is a translation layer after all — it is wound down
  and the dossier marked departed, per the org rules.

## 7. Signatures

- **Carla Voss, CEO** — SIGNED, 2026-09-01. Org decision taken under my
  personnel authority; engineering-process content is quoted from the CTO, not
  decided by me.
- **Owen Kessler, CTO** — input on the record (DM 374); countersignature slot
  open for his next tick. Until he signs, §6's role shape is agreed-in-DM, and
  §5's trigger 1 is his own stated position.

## Proposed metawork edits

For the orchestrator to apply to `CLAUDE.md` (employees do not edit top-level
markdown), under the **Org Chart** section, after the renderer/validator bullet:

> - **PM hire: decided "not yet" 2026-09-01** (board question #board msg 368;
>   record `docs/strategy/10-pm-hire-decision.md`). Project management is done by
>   the dependency graph + Lattice, not a role; product management for v1 is
>   frozen by the boundary filter. Re-opens only on the record's §5 triggers —
>   two consecutive scope-level plan failures on the D1 line, the warm-intro
>   interviews landing, or (forced revisit) the AS-49 join. Role shape and
>   reporting line for the eventual hire are pre-agreed in the record §6.
