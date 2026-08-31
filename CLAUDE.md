# american-software-company
A high level overview of what this repo is is available in `PHILOSOPHY.md`. In addition to the software product itself, we need adequate internal tools to track decision history, and records of legal documents, external URLs, and non-code stuff of that nature. This file should be freely updated as decisions are made within the context of a chat. Prioritize updating this file over memoriess.

GitHub remote: https://github.com/malls/american-software. `README.md` is the public face of the repo — keep it current: when the repo structure, operating model, product, or company status changes materially, update the README as part of that change (its Status section goes stale fastest).

## Product

**Decided 2026-08-31 by board green-light (chat `#bizdev` msg 290, "I'm greenlighting this product"):** the company's product is **D1 — freelancer invoicing/contract automation**. This closes the five-step direction process (`docs/strategy/01`→`08`); the record of the decision itself is `docs/strategy/08-board-decision.md`, and the C2/D4 fallback ordering is retired as a selection mechanism.

Operative defaults until the board says otherwise:
- **Subscription-only revenue.** No app-fee / take-rate paths, pending a board ruling on the constraint-7 interpretation raised in decision memo §4.
- **Never in the flow of funds** is a standing design constraint, not a v1 shortcut.
- **Every processor / ESP / carrier signup is board-gated** — including free and test-mode accounts (the purchase-approval rule covers all external service commitments, not just spend).

Open board items carried forward from memo §4: the 3–5 warm freelancer intros for demand validation (the board's own action; no build work blocks on it), the constraint-7 app-fee ruling, and incorporation as a coming company milestone.

**Company name (decided 2026-08-31 by the cofounders; authority delegated by the board in #board msg 296):** the company name remains **The American Software Company** — a deliberately generic umbrella, operated product-brand-forward (customers meet product brands; the parent stays quiet). Product naming (including D1's) is a separate exercise that must complete before any public-facing artifact ships — including DNS/sender-domain setup for outbound email (record §8.2); domains and trademarks are board-gated spend. Record: `docs/strategy/09-company-name.md`.

## Persona Agents / Employees
Agents reporesent employees of this company. They have job titles, backgrounds, personas, and biases informed by their experience, and their own self interest. They are "hired" when a piece of work requires work that would be done by a person at a company with a job title that does not exist yet. They are prefixed by type, and given unique first names. For example, `pm-bob` or `qa-automation-manager-alice` or `copywriter-al`. When hired, record the date, give them a Myers Briggs type, a resume with their experience, and are assigned the minumum viable model for their tasks.

Special attributes: `cofounders` are allowed to spend as many tokens as they like. `managers` can trigger subagents. `ics` do the actual work, and report to `managers`. `managers` report to `c level`. `cofounders` are `managers` and `c level` and `ics` by default.

Employees should leave lattice comments as they contribute to the work. Employees talk to each other over a user-visible "Slack" type app that the user can also particulate in, found under `/apps/chat`.

**Channel discipline (board feedback, 2026-08-30):** employees answer a message in the channel where it arrived — a DM gets a DM reply, a `#board` message gets a `#board` main-channel reply (per msg 120). Never aggregate answers to messages from several channels into one channel. Addressee discipline matches: a message is only "delivered" to the identity that reads it — sweeping the inbox as one employee does not deliver another employee's mail.

**Acknowledge before acting (board feedback, 2026-08-30):** when a message asks for work, the receiving employee's FIRST action is a prompt one-line reply saying what they are about to do ("I'll get started on X — filing the task now"), sent BEFORE any Lattice updates, planning, or sub-agent work. The heavy lifting comes after the ack, and the substantive reply (task ids, decisions, outcomes) follows when it's done. Silence while working is a failure mode: the board should never have to wonder whether a message was heard.

## Board
Forrest (the user) is the sole board member. Background: tech, "retired" in his 30s, pivoted to investing. Communicate with him at full technical depth — no dumbing down. He expects to greenlight most decisions rather than veto them; keep approval gates lightweight but still surface them. Recorded 2026-08-29 from his own words.

**Standing grant (2026-08-30, chat msg 53):** cofounders may hire without per-hire board approval ("feel free to hire if needed"). Hires still follow the personnel conventions above; the purchase-approval rule is unaffected.

**Purchase approval (revised 2026-08-31):** ALL purchases require board approval for now — the earlier $50 threshold is removed (PHILOSOPHY.md #6 updated). This may be relaxed later as the company matures; until then, any spend of any size routes through `needs_human`.

**Internal-tools kickoff is implicit (board directive, DM msg 230, 2026-08-30):** tasks on internal tooling (chat app, dashboards, org tooling) proceed through the normal plan/implement/review lifecycle without per-task board green-light, with `agent:developer-marcus` as default implementer. Purchases and external-infra changes still require board approval.

## Operating Modes: Chat vs. Loop

**Claude Code chat is metawork only (decided 2026-08-29, tightened 2026-08-30, amended 2026-08-30).** Anything Forrest sends directly through Claude Code chat is board metawork — operating rules, this file, plumbing, advice, unblocking. **Never create Lattice tasks implicitly from Claude Code chat.** Forrest describing a problem, wish, or idea here is not a work order — handle the meta-layer in-session and remind him the chat app is the work channel. **Exception (amended 2026-08-30): an explicit request for a Lattice task in this channel ("make a lattice issue for X") is honored** — the orchestrator creates it with `--actor human:forrest` (the board member directed it verbatim) and it enters the normal loop from `backlog`. Explicit means he asked for the task by name; anything short of that goes through the chat app.

**Top-level markdown files are metawork artifacts (decided 2026-08-30).** `CLAUDE.md`, `README.md`, `PHILOSOPHY.md`, and `agents.md` are owned by the metawork layer (Forrest and the Claude Code orchestrator). **Employees never edit them.** When a task requires a change to one of these files (e.g., a new methodology carve-out), the employee records the exact proposed wording in the plan file or a lattice comment, and the metawork layer applies it. Corollary: an unattributed change appearing in these files is presumed to be metawork by the board or orchestrator — not tampering, and not something employees revert.

**The loop is the company (target state).** The intended operating model is an autonomous agent loop where employees create, claim, and complete Lattice tasks on their own — not chat-triggered work. One tick of the company is the `/advance` command (`.claude/commands/advance.md`); run it continuously with `/loop /advance` in a live session, or unattended via scheduled agents. All Lattice discipline below applies to loop work; chat is exempt per the above.

**Target interface: the chat app (decided 2026-08-30).** Forrest's primary interface with the company is the internal chat app, not Claude Code chat. A message he sends there triggers one `/advance` tick — but only when no loop or tick is already running (single-flight lock; an active loop reads the message via the normal inbox pull instead). Talking to the company sets it in motion. Claude Code chat is the meta/governance channel only: operating rules, this file, board-side plumbing. **Work enters the company through exactly two doors:** (1) requests made inside the chat app — company-internal communication that employees turn into Lattice tasks (the employee creates the task as `agent:<employee-id>`, with `--on-behalf-of human:forrest` when it came from the board member), and (2) employees' own initiative during loop ticks. There is no third door.

**RESOLVED 2026-08-30 — headless ticks are no longer permission-crippled (AS-21).** For most of 2026-08-30, watcher-fired headless ticks (`claude -p '/advance watcher:<pid>'`) had every write-capable Bash command auto-denied — `lattice` (any subcommand), `node apps/chat/bin/chat.js`, `git add`/`commit`, `sqlite3`, `rtk proxy` — so every watcher tick degraded to a no-op report and the company only moved in live `/loop /advance` sessions. Root cause (isolated in tick `watcher:23050`): **the repo's own `.claude/settings.json` allowlist is inert for headless ticks** — project-scope settings do not reach a `claude -p` child, and the read-only commands that *did* work were passing via Claude Code's built-in read-only heuristic, not the allowlist. This disproved rung 1 of the escalation ladder in `apps/chat/watch/README.md` §"Permission modes"; that README has been corrected.

The fix (AS-21, commit ee57b3d): the watcher reads settings at fire time and passes the grants explicitly as `--allowedTools`/`--disallowedTools` in `tickArgv()` (`apps/chat/watch/advance-watcher.mjs`). This preserves the `git push --force` deny rules, unlike the `bypassPermissions` fallback. **Verified live in tick `watcher:33733` (19:32Z)** — that tick ran `lattice list`/`comment`, read and posted to the chat app, and staged with `git add`, all previously denied. Keep this paragraph as the record of why the watcher hands grants over argv; do not "simplify" it back to relying on project settings.

Known residual (not a blocker): the `./apps/chat/chat` wrapper shells out to `docker`, which is not on PATH in the headless tick environment. Ticks must not use `node apps/chat/bin/chat.js` for reads **or writes** while the container server is up — host-side CLI writes can land in a WAL view the server never sees (AS-24, orphan msg 161), and host-side reads can be WAL-stale enough to miss the very message that fired the tick. Use the server HTTP API for both: `GET /api/conversations` / `/api/messages`, `POST /api/messages` / `/api/read` at `http://127.0.0.1:8347`. `curl` is not in the tick allowlist; use `node -e` with `fetch`.

## Org Chart

**The org chart is derived, never hand-maintained (decided 2026-08-29).** Every dossier in `personnel/` carries YAML frontmatter with the structured org facts:

```yaml
actor_id: agent:qa-priya          # the Lattice actor ID
name: Priya Raman
title: QA Engineer
class: ic                         # cofounder | c-level | manager | ic
reports_to: agent:cto-owen        # an actor ID; human:forrest for board-level
team: engineering
hired: 2026-08-29
status: active                    # active | departed
```

Rules:
- **C-levels all report to the CEO** (`reports_to: agent:ceo-carla`); only the CEO reports to `human:forrest` (the board). Structurally a hierarchy, but C-levels are **peers in decision making** — the CEO does not overrule other C-levels in their own domains by default (decided 2026-08-29).
- **`reports_to` is the single source of truth for reporting structure.** Any chart, roster, or headcount view is generated by walking those edges. Never create a separate hand-edited org document — it will drift from the dossiers.
- **`class` is operational**, not decorative: it encodes the persona rules above (managers and above spawn sub-agents; cofounders have unlimited token spend; cofounders are c-level, managers, and ICs by default).
- Hiring, promotion, role change, and departure are frontmatter edits (plus prose in the dossier). Departed employees keep their dossier with `status: departed` — records are never deleted.
- **Renderer/validator trigger reached 2026-08-31 at headcount 8** — filed as **AS-33** (org chart visualizer + personnel frontmatter validator), from board DM msg 297. The renderer is the **live derived view in the chat app**, not a generated `personnel/ORG.md`: a committed generated file drifts between regenerations, which is exactly the hand-maintained-chart failure this section exists to prevent (CTO judgment call, recorded in AS-33; a snapshot artifact would be a separate board-requested follow-up). The validator half is mandatory and unchanged: no orphan `reports_to`, no cycles, no reports under an `ic`. That tool is the seed of the internal-operations system below. Until it ships, grepping the frontmatter *is* the org chart.
- **Machine consumers exist.** The chat app reads this frontmatter read-only (`apps/chat/lib/personnel.js`, roster sidebar — AS-8). The parser is a deliberate YAML-subset: flat `key: value` scalars with optional `# comments` only. Adding nesting, lists, or multi-line values to the schema is a breaking change — update the parser (and its tests) in the same task.

**Non-engineering work tracking:** HR tasks (hiring, employee records, org changes), legal, marketing, business strategy, and purchasing do NOT go in Lattice — Lattice is scoped to software development only (see below). This belongs to the future internal-operations system growing out of the personnel frontmatter. Designing that system is itself an engineering project (which *does* get Lattice tasks). Until it exists, non-dev decisions and records live in this file or in dedicated docs in the repo.

## Infra
All services will be hosted on Digital Ocean. This is a GitHub repository. All local apps should be run with Docker / Docker Compose.

## Lattice

> **MANDATORY: This project has Lattice initialized (`.lattice/` exists). You MUST use Lattice to track all software development work. Creating tasks, updating statuses, and following the workflow below is not optional — it is a hard requirement. Failure to track dev work in Lattice is a coordination failure: other agents and humans cannot see, build on, or trust untracked work. If you are about to write code and no Lattice task exists for it, stop and create one first.**

Lattice is file-based, event-sourced task tracking built for minds that think in tokens and act in tool calls. The `.lattice/` directory is the coordination state — it lives alongside the code, not behind an API.

**In-fiction framing (decided 2026-08-29):** Lattice is the company's chosen off-the-shelf engineering issue tracker — the equivalent of a real startup adopting Linear or Jira rather than building its own. It is also the board's required audit trail: the human mandates it for governance and legibility, the way a board demands clean books. Employees own everything built *on top* of it — dashboards, the "Slack" app, and org-chart tooling may freely read and write `.lattice/` files. Cofounders may propose replacing Lattice, but that is a real migration project requiring board sign-off, not a whim.

### Scope: Software Development Only

Lattice tracks **engineering work** — anything that changes code or technical infrastructure: features, bugs, refactors, cleanup, internal tools, CI, deployment config.

Lattice does **not** track non-engineering company work: hiring and HR (employee records, resumes, org changes), legal, marketing, business strategy, purchasing, incorporation. That work belongs to the (TBD) org-chart / internal-operations system — see "Org Chart" above. Until that system exists, record non-dev decisions and artifacts in this file or in dedicated docs in the repo. Note the boundary: *building* the org-chart/HR system is engineering and gets Lattice tasks; the HR records it manages do not.

### Every Actor Is an Employee

There are no anonymous agents at this company. Every `--actor` on every Lattice operation is a specific persona employee (e.g., `agent:pm-bob`, `agent:developer-dana`, `agent:qa-alice`) or the human (`human:forrest`). Generic lifecycle IDs like `agent:claude-planner` are forbidden — if no employee with the right job title exists yet, hire one first (see "Persona Agents / Employees"). The event log doubles as the company's record of who did what. Use the most reasonable model for the job, considering token cost.

### Creating Tasks (Non-Negotiable)

Before you plan, implement, or touch a single file — the task must exist in Lattice. This is the first thing you do when engineering work arrives.

```
lattice create "<title>" --actor agent:<employee-id>
```

**Create a task for:** Any software development work that will produce commits — features, bugs, refactors, cleanup, technical pivots.

**Skip task creation only when:** The work is non-engineering (HR, legal, marketing — see Scope above), a sub-step of a task you're already tracking (lint fixes within your feature, test adjustments from your change), pure research with no deliverable, or work explicitly scoped under an existing task.

When in doubt, create the task. A small task costs nothing. Lost visibility costs everything.

**Recurring observations become tasks.** If you observe the same issue in 2+ consecutive sessions or advances (e.g., a failing test, a lint warning, a flaky behavior), create a task for it. Agents are disciplined about tracking assigned work but not discovered work — this convention closes that gap. Create discovered issues at `needs_human` if they need scoping, or `backlog` if they're well-understood.

### Descriptions Carry Context

Descriptions tell *what* and *why*. Plan files tell *how*.

- **Fully specified** (bug located, fix named, files identified): still go through `in_planning`, but the plan can be a single line (e.g., "Fix the typo on line 77"). Mark `complexity: low`.
- **Clear goal, open implementation**: go through `in_planning`. The agent figures out the approach and writes a substantive plan.
- **Decision context from conversations**: bake decisions and rationale into the description — without it, the next agent re-derives what was already decided.

### Status Transitions

Every transition is an immutable, attributed event. **The cardinal rule: update status BEFORE you start the work, not after.** If the board says `backlog` but you're actively working, the board is lying and every mind reading it makes decisions on false information.

```
lattice status <task> <status> --actor agent:<employee-id>
```

```
backlog → in_planning → planned → in_progress → review → done
                                       ↕            ↕
                                    blocked      needs_human
```

**Transition discipline:**
- `in_planning` — before you open the first file to read. Then write the plan.
- `planned` — only after the plan file has real content.
- `in_progress` — before you write the first line of code.
- `review` — when implementation is complete, before review starts. Then actually review.
- `done` — only after a review has been performed and recorded.
- Spawning a sub-agent? Update status in the parent context first.

### Employee Execution Model

Each lifecycle stage gets its own sub-agent with fresh context, and each sub-agent *is* a specific employee doing the job their title implies. This mirrors a real dev team: a PM scopes and plans, a developer builds, QA verifies. Every task, every time.

**Why this matters:** When a PM writes a plan and a separate developer reads it, the plan *must* be clear and complete — there's no shared context to fall back on. This forces better plans. When QA reads the diff cold, it catches things the implementer's context-polluted mind would miss. The plan file and git diff are the handoff artifacts.

**The three roles:**

| Stage | Employee | Does | Reads | Produces |
|-------|----------|------|-------|----------|
| **Plan** | `pm-*` or a tech lead | Explore codebase, write plan, move to `planned` | Task description | Plan file |
| **Implement** | `developer-*` (or the relevant IC) | Read plan, build it, test, commit, move to `review` | Plan file | Committed code |
| **Review** | `qa-*` — never the implementer | Read diff cold, review against acceptance criteria, record findings | Git diff + plan | Review comment (`--role review`), move to `done` |

**The orchestrator** (the main session, acting as the responsible `manager` or `cofounder`) manages the lifecycle:
1. Move the task to `in_planning` before spawning the planning employee.
2. After the plan is written, move to `in_progress` and spawn the implementing employee.
3. After implementation, the QA employee reviews independently.

Each sub-agent uses its employee's actor ID (e.g., `agent:pm-bob`, `agent:developer-dana`, `agent:qa-alice`) so the event log shows who did what. Per the org rules above, only `manager`-class employees (and cofounders) spawn sub-agents.

### The Planning Gate

The plan file lives at `.lattice/plans/<task_id>.md` — scaffolded on creation, empty until you fill it.

This is the **planning employee's** job (a `pm-*` or tech lead). Spawn that employee as a sub-agent whose sole purpose is to explore the codebase, understand the problem, and write the plan. It should:
1. Read the task description and any linked context.
2. Explore the relevant source files — understand existing patterns and constraints.
3. Write the plan to `.lattice/plans/<task_id>.md` — scope, approach, key files, acceptance criteria. For trivial tasks, a single sentence is fine. For substantial work, be thorough.
4. Move to `planned` only when the plan file reflects what it intends to build.

**The test:** If you moved to `planned` and the plan file is still empty scaffold, you didn't plan. Every task gets a plan — even trivial tasks get a one-line plan. The CLI enforces this: transitioning to `in_progress` is blocked when the plan is still scaffold.

### The Review Gate

Moving to `review` is a commitment to actually review the work.

This is the **QA employee's** job (a `qa-*`). Spawn that employee as a sub-agent with fresh context — it did NOT write the code and comes in cold. It should:
1. Read the plan file to understand what was supposed to be built.
2. Read the git diff to see what was actually built.
3. Run tests and linting to verify nothing is broken.
4. Compare the implementation against the plan's acceptance criteria.
5. Record findings with `lattice comment --role review` — what was reviewed, what was found, and whether it meets acceptance criteria.

**When moving to `done`:** If the completion policy blocks you for a missing review artifact, do the review. Do not `--force` past it. `--force --reason` is for genuinely exceptional cases, not a convenience shortcut.

**The test:** If the same employee that wrote the code also reviewed it without a fresh context boundary, the review gate is not doing its job. The whole point is independent verification — no company lets the developer approve their own release.

### Review Rework Loop

When the QA employee evaluates work, it produces one of three outcomes:

1. **Pass (with optional minor fix):** The review agent uses vibes-based judgment. If the only issues are trivial (obvious typos, missing semicolons, etc.), fix them inline, record what was changed in the review comment, and move to `done`. No strict line-count threshold — the review agent decides.

2. **Fail — implementation-level:** The plan was sound but the implementation has issues. The review agent explicitly states "implementation-level rework needed" in its comment. The orchestrator transitions the task `review -> in_progress`. Critical findings from the review are appended to the plan file under a new `## Review Cycle N Findings` section. A fresh sub-agent is encouraged (but not mandated) for the rework.

3. **Fail — plan-level:** The original plan was flawed — wrong approach, missing requirements, etc. The review agent explicitly states "plan-level rework needed" in its comment. The orchestrator transitions the task `review -> in_planning`. The plan gets reworked (not just amended), then back through the full lifecycle.

**Who decides what:**

| Decision | Who | How |
|----------|-----|-----|
| Fix inline vs send back | QA employee | Vibes-based judgment, recorded in review comment |
| Implementation-level vs plan-level | QA employee | Explicitly stated in review comment |
| Route to in_progress vs in_planning | Orchestrator (manager) | Follows QA's recommendation |
| Whether to spawn fresh sub-agent | Orchestrator (manager) | Encouraged by convention, not enforced |

**3-cycle safety valve:** After 3 review-to-rework transitions (any combination of `review -> in_progress` and `review -> in_planning`), the CLI blocks the 4th attempt. The error message instructs the agent to move the task to `needs_human` with a comment explaining the situation. The limit is configurable via `review_cycle_limit` in the workflow config (default: 3). Override with `--force --reason` for genuinely exceptional cases.

**Allowed lifecycle paths:**

```
Normal:       in_progress -> review -> done
Minor fix:    in_progress -> review -> (fix inline) -> done
1 impl rework: in_progress -> review -> in_progress -> review -> done
1 plan rework: in_progress -> review -> in_planning -> planned -> in_progress -> review -> done
Max cycles:   3 review->rework transitions, then CLI blocks -> needs_human
```

### When You're Stuck

Use `needs_human` when you need human decision, approval, or input. This is distinct from `blocked` (generic external dependency) — it creates a scannable queue.

```
lattice status <task> needs_human --actor agent:<employee-id>
lattice comment <task> "Need: <what you need, in one line>" --actor agent:<employee-id>
```

Use for: design decisions requiring human judgment, missing access/credentials, ambiguous requirements, approval gates. The comment is mandatory — explain what you need in seconds, not minutes. The human's queue should be scannable.

### Actor Attribution

Every operation requires `--actor`, and every agent actor is a named employee (see "Every Actor Is an Employee" above). Attribution follows authorship of the *decision*, not the keystroke.

- Employee decided autonomously → `agent:<employee-id>` (e.g., `agent:developer-dana`)
- Human typed it directly → `human:forrest`
- Human meaningfully shaped the outcome → `human:forrest` (the employee was the instrument)

When in doubt, credit the human.

### Branch Linking

Link feature branches to tasks: `lattice branch-link <task> <branch-name> --actor agent:<employee-id>`. Auto-detection works when the branch contains the short code (e.g., `feat/LAT-42-login`), but explicit linking is preferred.

### Leave Breadcrumbs

You are not the last mind that will touch this work. Use `lattice comment` for what you tried, chose, and left undone. Use `plans/<task_id>.md` for structured plans and `notes/<task_id>.md` for working notes and context dumps. The record you leave is the only bridge to the next agent's context.

### Shared Worktree Discipline

Multiple agents may work in the same repository concurrently on different tasks. The `git status` snapshot from your session start goes stale the moment another agent commits.

**When you encounter unfamiliar changes** (unexpected files, diffs you didn't make, new commits on HEAD):
1. **Investigate first.** Check `git log` and `lattice list` to see if another task/agent is responsible.
2. **Ask "who made this?" before "this shouldn't be here."** The change is almost certainly another agent's legitimate work.
3. **Never revert, reset, or delete changes you can't attribute.** If you're unsure, leave them alone and ask the human.

This applies to uncommitted changes in the working tree, unexpected commits on the branch, and new files that weren't there when your session started. The instinct to "clean up" unfamiliar state is exactly wrong in a multi-agent worktree — it destroys a sibling agent's work.

### Where Learnings Go

When you discover something important about how this project works — a pattern, a gotcha, a convention — **do not save it to auto-memory**. Memory is per-session and per-user; future Lattice agents in other installations will never see it. Instead, add it to this project's `CLAUDE.md` (for project-specific conventions) or propose updating the Lattice template (for universal patterns that should ship with every `lattice init`). The goal: every future agent, in every future installation, benefits from what you learned.

### Quick Reference

```
lattice create "<title>" --actor agent:<employee-id>
lattice status <task> <status> --actor agent:<employee-id>
lattice assign <task> <actor> --actor agent:<employee-id>
lattice comment <task> "<text>" --actor agent:<employee-id>
lattice link <task> <type> <target> --actor agent:<employee-id>
lattice branch-link <task> <branch> --actor agent:<employee-id>
lattice next [--actor agent:<employee-id>] [--claim]
lattice show <task>
lattice list
```

**Useful flags:**
- `--quiet` — prints only the task ID (scripting: `TASK=$(lattice create "..." --quiet)`)
- `--json` — structured output: `{"ok": true, "data": ...}` or `{"ok": false, "error": ...}`
- `lattice list --status in_progress` / `--assigned agent:<id>` / `--tag <tag>` — filters
- `lattice link <task> subtask_of|depends_on|blocks <target>` — task relationships

For the full CLI reference, see the `/lattice` skill.

## Git Methodology

Decided 2026-08-29; **revised 2026-08-31 (board decision): board-on-master + worktree-per-task.** Git history and the Lattice board are two views of the same work; the short code (`AS-<n>`) is the join key. The 2026-08-31 revision fixes the lived failure mode of v1: board state riding task branches meant master's `.lattice` lagged reality until merge, and the main checkout was forever parked on whichever branch was in flight.

### The two-plane rule (core of the revision)

- **The main checkout is pinned to `master`, permanently.** It is the canonical board and the metawork home. It is never checked out to a task branch.
- **Board state lives on master, in real time.** Every `.lattice/` mutation — task creation, claims, status transitions, comments, plan files — commits directly to master from the main checkout, at the moment it happens (batched per tick action is fine). Message format: `AS-<n>: board — <what>`. The board on master is always current *while work is in flight*.
- **Code lives on task branches, worked in worktrees.** A task branch carries only app/tool code and tests — never `.lattice/` state. Each in-flight task gets a linked worktree: `git worktree add .worktrees/AS-<n> feat/AS-<n>-<slug>`. The implementer and QA operate inside `.worktrees/AS-<n>/`; the main checkout stays untouched and available. `.worktrees/` is gitignored.
- **Metawork commits to master anytime** — the main checkout is always on master, so there is no stash dance and no metawork riding task branches. The rides-along rule survives only as: metawork found dangling in the MAIN checkout is committed to master promptly (by the orchestrator or the tick), never left dirty.

### Commits

- **Every commit belongs to a task.** Message format: `AS-<n>: <imperative summary>` (board-state commits: `AS-<n>: board — <what>`). Exceptions that commit directly to master without a task code: board/chat-channel metawork, and operational record commits (below).
- **Commit as the employee.** Each stage commits under its persona's identity so `git blame` shows who at the company wrote what:
  ```
  git -c user.name="developer-marcus-webb" \
      -c user.email="developer-marcus-webb@agents.american-software.local" \
      commit -m "AS-7: ..."
  ```

### Task lifecycle in git

- **Planning stage:** plan file commits to master (it is board state in `.lattice/plans/`). Then create `feat/AS-<n>-<slug>`, `lattice branch-link` it, and `git worktree add .worktrees/AS-<n> feat/AS-<n>-<slug>`.
- **Implementation stage:** code + tests commit on the branch, inside the worktree. Logical commits at stage boundaries.
- **Review:** QA reads `git diff master...feat/AS-<n>-<slug>` (now pure code — no board-state noise) and works inside the worktree. Rework commits accumulate on the branch.
- **Merge at `done`:** from the main checkout, merge with `--no-ff` (message: `AS-<n>: <task title>`), run the records step, push master, then `git worktree remove .worktrees/AS-<n>` and delete the branch. Each task stays a visible unit in history.
- **Master is always green for code.** App code arrives on master only via `done` merges; board-state and metawork commits touch no code. A tick that dies mid-task leaves a resumable worktree; the next tick finds it via `lattice branch-link` and `git worktree list`.

### Concurrency

One worktree per in-flight task; one agent per task per product at a time (board policy). Task claims and status transitions happen ONLY in the main checkout, so two agents can never claim the same task. The `.gitattributes` `merge=union` rule for `.lattice/events/*.jsonl` is retained as belt-and-suspenders, but with board state banned from branches it should never be exercised.

**Working-directory hazard — run `lattice` with an explicit cwd (learned 2026-08-31, AS-26 tick `watcher:96123`).** The Bash tool's working directory persists between calls. A `cd` into `.worktrees/AS-<n>/` (e.g. to run the test suite) silently redirects every later `lattice` command: the CLI walks up from cwd, finds the *worktree's* checked-out `.lattice/`, and writes board state onto the task branch — exactly what the two-plane rule forbids. It is silent because `lattice show` then reads the same wrong copy and looks correct. Symptoms: main checkout clean when it should have new events, `M .lattice/...` dirty in the worktree, and a transition recorded with the wrong `from` state (the branch's stale copy never saw the newer master events). Fix, in order: `git -C <worktree> checkout -- .lattice` to discard the stray writes, `cd` back to the main checkout, then re-issue the `lattice status`/`comment` so the event chain is correct — do not hand-copy JSONL between the two copies. Prevention: `cd /Users/forrest/Code/american-software-company` before any `lattice` call, and prefer `git -C <path>` over `cd` for worktree work.

### Operational record commits

Recurring operational exports (currently: chat history, per AS-5) belong to
no single task. They commit directly to master with message format
`records: chat export <YYYY-MM-DD>`. Scope discipline: a records commit touches
only `apps/chat/data/export/` (and future record paths); never mix it with
code. Identity: committed by the employee running the tick, under their
persona git identity. Private channels (currently `#board` and `#bizdev`, per
the AS-6 board decision) are excluded from the chat export by design — hidden
means hidden, including git. Their only durable copies are the live DB and
manual `chat dump` backups; the board accepted this tradeoff on 2026-08-30 (AS-6).

### Pushing

- Push master after every merge and at the end of any tick that committed board state or metawork. Pushing in-flight task branches is optional (nice for GitHub visibility; enables a PR-based merge flow later if the board wants it).
- Force-push is always `needs_human`. Never rewrite pushed history autonomously.

### Repo structure (decided 2026-08-31)

Monorepo (`apps/*`) for the foreseeable future — cross-cutting changes (app + tick procedure + docs) stay atomic, and there is one board and one audit trail. Submodules/repo-extraction happen per-product at the moment a product needs its own public repo, external contributors, or independent deploy cadence — a real migration project with board sign-off, not before.
