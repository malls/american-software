# american-software-company

`PHILOSOPHY.md` says what this repo is. This file is the **operating rulebook**: every rule an employee or the orchestrator must follow, and nothing else. The history behind each rule — dates, tasks, what went wrong, retired versions — is in `docs/engineering/05-operating-record.md` (the full pre-2026-09-12 text of this file, frozen, plus additions). **When you learn something: the one-sentence rule goes here, the story goes in the record.** Keep this file under ~250 lines; if a paragraph tells a story, it belongs in the record.

GitHub remote: https://github.com/malls/american-software. `README.md` is the public face — update it when structure, operating model, product, or status changes materially.

## Repo visibility

Public for now (board, 2026-09-07; audit: no secrets committed, `.env.local` gitignored). Flips **private before** either trigger lands: the product-naming record, or the first incorporation/legal record. The tick that reaches a trigger goes `needs_human` and asks for the flip first. Record § Repo Visibility.

## Product

**D1 — freelancer invoicing/contract automation** (board green-light 2026-08-31, `docs/strategy/08-board-decision.md`). Standing constraints:
- Subscription-only revenue; no app-fee/take-rate paths pending the constraint-7 ruling.
- **Never in the flow of funds** — a design constraint, not a v1 shortcut.
- **Every processor / ESP / carrier signup is board-gated**, including free and test-mode accounts.
- Company name: **The American Software Company**, operated product-brand-forward (`docs/strategy/09-company-name.md`). Product naming must complete before any public-facing artifact ships (including sender-domain DNS); domains and trademarks are board-gated spend.

Open board items: 3–5 warm freelancer intros, the constraint-7 ruling, incorporation, and AS-51 (Stripe test-mode account — gates AS-50, v1 acceptance).

## Style

[BRANDING.md](BRANDING.md) governs tokens, colours, spacing, typography. All CSS adheres to it.

## Employees

Agents are employees with job titles, personas, MBTI types, resumes, and self-interest, prefixed by type with a unique first name (`pm-bob`, `qa-priya`). Hire when work needs a title that doesn't exist: write the dossier under `personnel/` with the hire date, MBTI, resume, and the minimum viable model. Classes: `cofounder` (unlimited tokens; also c-level, manager, ic), `c-level`, `manager` (may spawn sub-agents), `ic` (does the work, reports to a manager).

- **Model fallback:** when Fable refuses a spawn for usage (HTTP 429), re-invoke the same employee on Opus immediately; **after the first refusal in a tick, send that tick's remaining spawns straight to Opus** without retrying Fable. Never stall, never go below Opus, never edit the dossier — the assignment is the default, the substitution is per-invocation, and the tick report names which stages ran on Opus.
- **Channel discipline:** answer in the channel the message arrived in; never aggregate replies across channels. Mail is delivered only to the identity that reads it.
- **Acknowledge before acting:** a message asking for work gets a one-line "I'll do X" reply *before* any Lattice write, planning, or sub-agent work; the substantive reply follows when done.
- **Writing to the board** (any DM to `human:forrest`, anything in `#board`/`#bizdev`, any message asking him for something): outcome first in one plain sentence; the ask second; evidence (counts, hashes, mutants, receipts, pids, tick numbers, branches, paths) stays in the Lattice comment; never cite an internal identifier (`M4`, `AC-13`, `F1`, "red set"); say terms of art in words or not at all (glossary: `docs/engineering/04-glossary.md`); at most one number, and only if it changes what the board does. Peer channels (`#engineering`, employee DMs) stay dense. Test: would someone who hasn't seen the task know from sentence one what happened or what you want?

Employees talk in the chat app (`apps/chat`), leave Lattice comments as they work, and never edit `CLAUDE.md`, `README.md`, `PHILOSOPHY.md`, or `agents.md` — they record proposed wording on the task and the metawork layer applies it.

## Board

Forrest is the sole board member — tech background, retired-then-investor; full technical depth, no dumbing down; expects to greenlight, so keep gates lightweight but visible.
- Cofounders may hire without per-hire approval (standing grant 2026-08-30).
- **Every purchase of any size needs board approval** (`needs_human`), as does anything touching existing GitHub or Digital Ocean resources.
- Internal-tools tasks (chat app, dashboards, org tooling) proceed without per-task green-light; `agent:developer-marcus` is the default implementer.
- Observability north star: a "foreman of the factory" view. Doctrine: one event stream, many projections; views never own state. Stage-level state is persisted (`event: company`, AS-100: `/api/events`, `apps/chat/data/events/company.jsonl`, emit CLI `apps/chat/bin/events.js`); tool-level activity is live-only over SSE (`event: activity`, AS-103), never written anywhere.

## Operating modes

- **Claude Code chat is metawork only** — rules, this file, plumbing, unblocking. Never create Lattice tasks implicitly from it; an *explicit* "make a Lattice task for X" here is honoured with `--actor human:forrest`. Anything short of that goes through the chat app.
- **The chat app is the board's interface.** A board message starts a **loop** of `/advance` ticks (AS-95) that runs until nothing is actionable, two no-progress ticks, or the safety cap (a cap-hit with work mid-lifecycle should re-arm after a cooldown — AS-129, filed 2026-09-12; until it lands a new message re-arms). One tick at a time under one lock. **Work enters through two doors only:** requests in the chat app (an employee files the task, `--on-behalf-of human:forrest` when it came from the board) and employees' own initiative in ticks.
- **The loop is the company.** One tick = `.claude/commands/advance.md`. That file is the tick's own procedure: the orchestrator (a cofounder) may amend it with wording a task record has already proposed (`AS-<n>: board — procedure: <what>`). Top-level markdown files stay metawork-only.
- **Headless ticks** (`claude -p '/advance watcher:<pid>:<nonce>'`): project `.claude/settings.json` is inert for a `claude -p` child, so the watcher passes its allow/deny lists as `--allowedTools`/`--disallowedTools` at fire time (AS-21) — do not "simplify" this back. The tick box is **60 min**, lock staleness **75** (plist env `ADVANCE_TICK_TIMEOUT_MIN`/`ADVANCE_LOCK_STALE_MIN`). Lanes run as **foreground parallel `Agent` calls in one message** — background sub-agents die 600 s after the orchestrator's turn ends. The orchestrator **commits each lane's board state the moment that lane returns**, not at tick end. Implementers commit early on the branch and keep a scratchpad progress note so a cutoff resumes. `docker` is off PATH for sub-agents: use the absolute path in `deploy-state.json`'s `dockerBin` via `node -e` + `spawnSync`.
- **Chat CLI in ticks:** `node apps/chat/bin/chat.js` self-routes through the server API (AS-24) and may be used for reads and writes. Never read the host sqlite while the server is up; never override an AS-24 refusal with `CHAT_MODE=direct`. The `./apps/chat/chat` *wrapper* shells to `docker` and does not work headless. Raw API fallback: `http://127.0.0.1:8347/api/...` via `node -e` + `fetch` (no `curl` in the grant set).
- **Deploys are the watcher's** (AS-75): merged `apps/chat` code goes live within ~60 s unattended; when it can't (no docker, dirty tree, watcher down) `apps/chat/data/deploy-state.json` says why. A merge tick reports the reason only when `dockerBin` is null or the heartbeat is stale. Restart after a plist change: `launchctl bootout` + `bootstrap` (a `kickstart` keeps the old env).

## Org chart

Derived from `personnel/` frontmatter, never hand-maintained. Schema (flat `key: value` scalars only — the chat app parses it, `apps/chat/lib/personnel.js`; nesting or lists break the parser):

```yaml
actor_id: agent:qa-priya
name: Priya Raman
title: QA Engineer
class: ic                         # cofounder | c-level | manager | ic
reports_to: agent:cto-owen        # human:forrest for the CEO only
team: engineering
hired: 2026-08-29
status: active                    # active | departed
```

Rules: C-levels report to the CEO and are peers in their own domains; `reports_to` is the single source of truth; `class` is operational; hires/promotions/departures are frontmatter edits (departed keeps the dossier). The live org view is the chat app (AS-33); its validator rejects orphan `reports_to`, cycles, and reports under an `ic`. Standing decisions, records in `docs/strategy/`: PM hire "not yet" (§10), second developer pair hired (§11 — lanes are capacity, not territories), CMO "not yet" (§13 — marketing enters as an IC under the CEO at M1 planning). **WIP limit 3**: up to three tasks in active stages at once, one worktree and one employee each, all board writes serialized through the orchestrator.

Non-engineering work (HR, legal, marketing, strategy, purchasing) is **not** tracked in Lattice; until the internal-operations system exists it lives in this file or `docs/`. Building that system *is* engineering.

## Infra

Digital Ocean for hosting. All local apps run under Docker Compose. Monorepo (`apps/*`) until a product needs its own repo — a board-signed migration, not before.

## Lattice

> **MANDATORY.** All software development work is tracked in Lattice (`.lattice/`). No task, no code. It is the company's issue tracker and the board's audit trail; employees may build on top of it, and replacing it is a board-signed migration.

**Scope:** engineering only — anything that changes code or technical infrastructure. Not hiring, legal, marketing, strategy, purchasing.

**Every actor is an employee.** `--actor agent:<employee-id>` or `human:forrest`; generic ids are forbidden. Attribution follows authorship of the *decision*: employee decided → employee; the human typed or shaped it → `human:forrest`. When in doubt, credit the human.

**Create tasks first**, `lattice create "<title>" --actor agent:<id>`, for anything that produces commits. Skip only for non-engineering work, sub-steps of a tracked task, pure research, or work already scoped under a task. An issue seen in two consecutive ticks becomes a task. Descriptions carry *what* and *why* plus the decision context; plans carry *how*. Mark `complexity: low | medium | high`.

### Scheduling priority

In force from 2026-09-11 (the Chat-before-D1 rule is retired; record § Scheduling priority):
- **Priority means product impact, not provenance.** `critical` is what a customer, the board, or a running deploy would notice. A review residual defaults to `low` (`medium` if it's a behaviour defect in shipped code). Title prefixes carry no weight.
- **Triage gate:** a QA review records findings in its comment and files nothing. The orchestrator, at merge or rework, files only *behaviour* defects (wrong output, wrong state, a reachable hole). Test-coverage and guard-hardening residuals stay on the parent's record and fold into the next task touching that file. A task → task → task chain with no product or board request in it is not extended unless the finding is a behaviour defect.
- **Ordering:** `lattice next` with the age tiebreak over honest priorities. Standing exception: AS-103 (board-requested). AS-51 is the board's own gate and is named in every tick report while it stands.

### Lifecycle

```
backlog → in_planning → planned → in_progress → review → done
                                       ↕            ↕
                                    blocked      needs_human
```

**Update status before the work, never after.** `in_planning` before opening a file; `planned` only with a real plan; `in_progress` before the first line of code; `review` when implementation is complete; `done` only after a named `qa-*` has recorded a `--role review` comment. **Every `→ planned` and `→ review` carries `--no-auto-review`**; Lattice's own auto-fired review is third-party output, never the gate — a daemon `NEEDS HUMAN` flag is cleared with `lattice needs-human <task> --clear --note "<which qa-* review covers it>"`, never routed to the board. Never kill the daemon or delete its state; `.lattice/review_state/`, `locks/`, `tmp-prompts/` are runtime state, never committed.

**Stages are fresh-context sub-agents, each a named employee.** Plan (`pm-*` or a tech lead) → implement (`developer-*`) → review (`qa-*`, never the implementer). The orchestrator (a manager/cofounder in the main session) moves statuses and spawns stages. **Scaled by complexity:** `low` (test-only, one file, fully specified bug) runs two stages — one developer plans *and* implements, then QA reviews; proof burden is the suite green with a `--build` receipt plus one observed red per named falsifier. `medium`/`high` run three stages with the full proof burden. A developer who finds a `low` task isn't low says so, re-marks it, and hands it back.

**Planning gate:** the plan at `.lattice/plans/<task_id>.md` — scope, approach, key files, numbered acceptance criteria. One line is fine for trivial work. **Length cap: ≤ 120 lines for `medium`, ≤ 200 for `high`**; thinking beyond that goes in the planner's scratchpad, not the plan. Every property the plan asserts names its falsifier as a numbered criterion (M4) — satisfied only by an observed red.

**Review gate** (the reviewer reads plan and diff cold, runs the suite, and records `lattice comment --role review`):
- **Findings first, criteria sweep second, labelled as a floor check (M5).** Never "N of N pass" without the count of findings outside the list.
- **Probe past the list (M6):** drive untested inputs, follow redirects to the end, break guards at their edges. A review that only walks the list is incomplete at 100% and says so.
- **A guard is proven by breaking it.** Show every checker fail against a deliberately broken input before trusting it; mutate in a scratch copy where possible; when in place, back up, `trap` the restore, **assert the mutation applied at the intended site** (re-read the mutated diff before calling a survivor a weak guard), observe, restore, `git diff --exit-code`, rebuild, re-run. Record the exact red set; a wider or narrower set is a finding. Cardinality before quantification.
- **Every counted compose run carries `--build`; the `Image <name> Built` line is the receipt.** No build line, no valid number.
- **Never brief the answer into the reviewer:** the tasking message gives location, criteria, and what to check — never the verdict, ranking, or deciding numbers. Tell the reviewer not to read the daemon's output or the implementer's comment before forming findings.
- **Scratchpads are per actor** (`scratchpad/<actor-id>/`); nothing at the scratchpad root. Never delete what you cannot attribute.

**Rework loop:** QA states one of *pass* (trivial fixes inline, recorded), *implementation-level rework* (→ `in_progress`, findings appended to the plan under `## Review Cycle N Findings`), or *plan-level rework* (→ `in_planning`, plan reworked). The orchestrator routes as QA says. After three rework transitions the CLI blocks; route to `needs_human`, never `--force`.

**Stuck:** `lattice status <task> needs_human` plus a one-line `lattice comment` saying what is needed — decisions, approvals, credentials, ambiguity. `blocked` is for external dependencies.

**Breadcrumbs, with length caps.** `lattice comment` for what you tried, chose, and left undone — **≤ 300 words**; battery logs, receipts, and probe output go in your scratchpad and the comment names the path. `notes/<task_id>.md` for context dumps. **Pull requests** only when a tick asks the board to look at code (a held merge, a `needs_human` on a diff, a safety-valve override): push the branch, `gh pr create` against master (title `AS-<n>: <task title>`, body = what/why, plan path, criteria), post QA's verdict with `gh pr comment`, URL in the Lattice comment and the chat message. The merge stays local; never `gh pr merge`.

**Shared worktree discipline:** unfamiliar changes are another agent's work — check `git log` and `lattice list`, never revert or delete what you can't attribute.

**Where learnings go:** never auto-memory. The rule goes here; the story goes in `docs/engineering/05-operating-record.md` § Additions after the freeze.

```
lattice create "<title>" --actor agent:<id>       lattice status <task> <status> --actor agent:<id> [--no-auto-review]
lattice comment <task> "<text>" --actor agent:<id> [--role review]
lattice next [--claim]   lattice show <task>   lattice list [--status s]   lattice link <task> depends_on|subtask_of|blocks <target>
lattice branch-link <task> <branch> --actor agent:<id>   lattice update <task> priority=high --actor agent:<id>
```

## Git methodology

**Two planes.** The main checkout is pinned to `master` forever: it is the board. Every `.lattice/` mutation commits to master from there, at the moment it happens (`AS-<n>: board — <what>`). Code lives on task branches in linked worktrees: `git worktree add .worktrees/AS-<n> feat/AS-<n>-<slug>` — a branch never carries `.lattice/` state. Metawork found dangling in the main checkout is committed promptly, never left dirty.

- **Every commit belongs to a task** (`AS-<n>: <imperative summary>`); exceptions: board/metawork commits and `records:` commits.
- **Commit as the employee:** `git -c user.name="developer-marcus" -c user.email="developer-marcus@agents.american-software.local" commit …` — `user.name` is the actor id minus `agent:`.
- **Planning:** plan commits to master; then create the branch, `lattice branch-link` it, add the worktree. **Implementing:** code and tests on the branch inside the worktree. **Review:** QA reads `git diff master...feat/AS-<n>-<slug>` inside the worktree; rework commits accumulate on the branch.
- **Merge at `done`,** from the main checkout: `--no-ff` (message `AS-<n>: <task title>`), then the records step, push master, `git worktree remove .worktrees/AS-<n>`, delete the branch locally and on origin if pushed. Master is always green for code.
- **Records step:** `./apps/chat/chat export` only when `deploy-state.json` shows `runningId == desiredId`; otherwise defer and say so. Changed exports commit alone as `records: chat export <YYYY-MM-DD>`. `#board`, `#bizdev`, and DMs involving `human:forrest` are excluded from export by design — hidden means hidden, including git.
- **Run `lattice` only from the main checkout** (`cd /Users/forrest/Code/american-software-company` first; `git -C <worktree>` for worktree work). A `cd` into a worktree silently writes board state onto the task branch; fix with `git -C <worktree> checkout -- .lattice` and re-issue from master.
- **Push** master after every merge and at the end of any tick that committed board state. Force-push is always `needs_human`.
- One worktree per task, one agent per task; claims and transitions happen only in the main checkout.
