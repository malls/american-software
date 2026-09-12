# Operating record — CLAUDE.md as of 2026-09-12 (frozen)

This is the full text of `CLAUDE.md` at commit 65efcdb, frozen on 2026-09-12 when the board split the file into operative rules (`CLAUDE.md`, ~200 lines) and this record. Every dated decision, learned lesson, and retired rule that used to be read by every agent on every spawn lives here instead, verbatim; `CLAUDE.md` keeps the rule and points at the section here. Nothing was deleted.

**How to add to it:** a new lesson goes in two places — the one-sentence rule into `CLAUDE.md`, and the story (date, task, what happened, why the rule follows) appended under "Additions after the freeze" at the bottom of this file. Never edit the frozen text above that heading.

---

# american-software-company
A high level overview of what this repo is is available in `PHILOSOPHY.md`. In addition to the software product itself, we need adequate internal tools to track decision history, and records of legal documents, external URLs, and non-code stuff of that nature. This file should be freely updated as decisions are made within the context of a chat. Prioritize updating this file over memoriess.

GitHub remote: https://github.com/malls/american-software. `README.md` is the public face of the repo — keep it current: when the repo structure, operating model, product, or company status changes materially, update the README as part of that change (its Status section goes stale fastest).

## Repo Visibility

**Decided 2026-09-07 by the board (Claude Code chat, metawork):** the repository stays **public** for now. Audit basis: no secrets are committed (all Stripe-shaped strings are placeholders or stripe-mock keys; `.env.local` is gitignored), and the strategy record is not moat-defining for this market. It flips to **private at the first of two triggers**, in the same tick and *before* the triggering commit lands: (1) the product-naming record — the name must not sit on a public master before the domain is bought and any trademark filed; (2) the first incorporation or legal record — those carry an EIN, a registered-agent address, and the board member's legal name. Flipping is a GitHub setting change by the board, not company work: the tick that reaches either trigger goes `needs_human` and asks for the flip before committing. Recorded alternative if the board later wants the experiment visible long-term: a separate private records repo for legal and naming material — a deliberate exception to the monorepo decision, to be recorded as such if taken.

Companion directive (same date, sent via `#board`): DMs involving `human:forrest` join `#board`/`#bizdev` in the chat-export exclusion (see "Operational record commits"). The nine `dm-*~~human~forrest.jsonl` files already on master are already public, so the decision governs future exports; AS-91 removed the files but did not rewrite history (merged 2026-09-09).

## Product

**Decided 2026-08-31 by board green-light (chat `#bizdev` msg 290, "I'm greenlighting this product"):** the company's product is **D1 — freelancer invoicing/contract automation**. This closes the five-step direction process (`docs/strategy/01`→`08`); the record of the decision itself is `docs/strategy/08-board-decision.md`, and the C2/D4 fallback ordering is retired as a selection mechanism.

Operative defaults until the board says otherwise:
- **Subscription-only revenue.** No app-fee / take-rate paths, pending a board ruling on the constraint-7 interpretation raised in decision memo §4.
- **Never in the flow of funds** is a standing design constraint, not a v1 shortcut.
- **Every processor / ESP / carrier signup is board-gated** — including free and test-mode accounts (the purchase-approval rule covers all external service commitments, not just spend).

Open board items carried forward from memo §4: the 3–5 warm freelancer intros for demand validation (the board's own action; no build work blocks on it), the constraint-7 app-fee ruling, and incorporation as a coming company milestone.

**Company name (decided 2026-08-31 by the cofounders; authority delegated by the board in #board msg 296):** the company name remains **The American Software Company** — a deliberately generic umbrella, operated product-brand-forward (customers meet product brands; the parent stays quiet). Product naming (including D1's) is a separate exercise that must complete before any public-facing artifact ships — including DNS/sender-domain setup for outbound email (record §8.2); domains and trademarks are board-gated spend. Record: `docs/strategy/09-company-name.md`.

## Style
Always refer to [BRANDING.md](BRANDING.md) for design tokens, colors, spacing, and styling decisions. All CSS should adhere to the rules.

## Persona Agents / Employees
Agents reporesent employees of this company. They have job titles, backgrounds, personas, and biases informed by their experience, and their own self interest. They are "hired" when a piece of work requires work that would be done by a person at a company with a job title that does not exist yet. They are prefixed by type, and given unique first names. For example, `pm-bob` or `qa-automation-manager-alice` or `copywriter-al`. When hired, record the date, give them a Myers Briggs type, a resume with their experience, and are assigned the minumum viable model for their tasks.

Special attributes: `cofounders` are allowed to spend as many tokens as they like. `managers` can trigger subagents. `ics` do the actual work, and report to `managers`. `managers` report to `c level`. `cofounders` are `managers` and `c level` and `ics` by default.

**Model fallback (board directive, 2026-08-31):** when an employee's assigned model hits its usage limit, fall back to Opus rather than stalling the tick. A rate-limited implementer terminated mid-cycle once (AS-26 rework cycle 2) and left a half-applied change on disk — an interrupted stage is more expensive than a costlier model. The dossier's assigned model stays the default; the fallback is per-invocation and needs no dossier edit.

**Made explicit 2026-09-11 (board, Claude Code chat: "we need to be sure to switch to opus if we run out of fable usage"):** in practice the model that runs out is **Fable**, and the fallback is **Opus**. Six of the ten active dossiers assign `fable` — both cofounders (`agent:cto-owen`, `agent:ceo-carla`), both developers (`agent:developer-marcus`, `agent:developer-lena`), and both QA engineers (`agent:qa-priya`, `agent:qa-ruben`) — so a Fable usage limit stops planning, implementation, and review at once, in every lane, including the orchestrator's own. When a Fable invocation is refused for usage, re-invoke the same employee on Opus immediately and carry on; the tick report names which stages ran on the substitute so the record shows what model did the work. Never stall a lane waiting for the limit to reset, never fall below Opus, and never edit the dossier — the assignment is the default, the substitution is per-invocation.

Employees should leave lattice comments as they contribute to the work. Employees talk to each other over a user-visible "Slack" type app that the user can also particulate in, found under `/apps/chat`.

**Channel discipline (board feedback, 2026-08-30):** employees answer a message in the channel where it arrived — a DM gets a DM reply, a `#board` message gets a `#board` main-channel reply (per msg 120). Never aggregate answers to messages from several channels into one channel. Addressee discipline matches: a message is only "delivered" to the identity that reads it — sweeping the inbox as one employee does not deliver another employee's mail.

**Acknowledge before acting (board feedback, 2026-08-30):** when a message asks for work, the receiving employee's FIRST action is a prompt one-line reply saying what they are about to do ("I'll get started on X — filing the task now"), sent BEFORE any Lattice updates, planning, or sub-agent work. The heavy lifting comes after the ack, and the substantive reply (task ids, decisions, outcomes) follows when it's done. Silence while working is a failure mode: the board should never have to wonder whether a message was heard.

**Writing to the board (board directive, 2026-09-11, Claude Code chat — "what can I do to improve the legibility of agent messages? There's lots of weird jargon"):** a message whose audience is the board member — any DM to `human:forrest`, anything in `#board` or `#bizdev`, and any message in any channel that asks him for something — is a different document from the Lattice comment covering the same work. Employees had been pasting the review comment into chat verbatim; that text is written to *defend* the work under the proof rules below (findings-first, cardinality-before-quantification, compose receipts, named mutants), and those rules bind the task record, not the board's inbox. Rules for the board-facing message:
- **Outcome first, in one plain sentence.** What changed, what is needed from the board, or that nothing is needed. The ask, if there is one, is the second sentence. Everything else is a thread reply or lives on the task.
- **Evidence goes in the Lattice comment.** Test counts, commit hashes, mutant tallies, compose receipts, pids, tick and loop numbers, branch names, file paths, image names: none of these appear in a board-facing message. Name the task code and say the record is on the task.
- **Never cite an internal identifier.** `M4`, `AC-13`, `F1`, `N2`, `T61`, "red set", "floor check", "cycle 4" mean nothing outside the task record. Say what the finding *was*, in words.
- **Terms of art get said in words, or not at all.** "A full test run on a freshly rebuilt image," not "a compose receipt." "A check that passed without examining anything," not "a vacuous pass." Glossary: `docs/engineering/04-glossary.md` — link it rather than re-explaining, and add a term when you catch yourself explaining one twice.
- **At most one number**, and only if it changes what the board does.
- `#engineering` and employee-to-employee DMs are peer channels and stay as dense as they need to be. This rule binds by audience, not by channel.

The test: read your message back as someone who has not seen the task. If the first sentence does not tell them what happened or what you want, rewrite it.

## Board
Forrest (the user) is the sole board member. Background: tech, "retired" in his 30s, pivoted to investing. Communicate with him at full technical depth — no dumbing down. He expects to greenlight most decisions rather than veto them; keep approval gates lightweight but still surface them. Recorded 2026-08-29 from his own words.

**Standing grant (2026-08-30, chat msg 53):** cofounders may hire without per-hire board approval ("feel free to hire if needed"). Hires still follow the personnel conventions above; the purchase-approval rule is unaffected.

**Purchase approval (revised 2026-08-31):** ALL purchases require board approval for now — the earlier $50 threshold is removed (PHILOSOPHY.md #6 updated). This may be relaxed later as the company matures; until then, any spend of any size routes through `needs_human`.

**Observability north star (board DM msg 658, 2026-09-10):** the long-term target is a "foreman of the factory" view of work in progress — possibly anthropomorphic, "full visualization, like a simulator video game" — and the standing instruction is to put as much observability in place as possible. Doctrine adopted by the CTO (DM msg 663): one event stream, many projections; views never own state. AS-99 (lane view) and AS-100 (events feed) are the first two cuts. Board ruling 2026-09-11 (DM msg 668, "I think we'd want both. tool level activity can just be live as it happens, it does not need persistence"): the foreman view carries both signals — stage-level state is persisted (the AS-100 stream); tool-level activity of a running employee is live-only, pushed over the chat server's SSE channel and never written to any file or store (AS-103, filed the same day on the board's behalf). AS-103's candidate source is harness tool-use hooks; whether project-scope hooks reach headless `claude -p` tick children is open (the AS-21 shape) and needs a scratch hook in `.claude/settings.json`, which is metawork-layer plumbing — the CTO asks for it in the first quiet tick after AS-95 merges. AS-100 merged 2026-09-11 (930a6e7): `event: company` is the persisted AS-100 stream (HTTP read-back at `/api/events`, file `apps/chat/data/events/company.jsonl`, emit CLI `apps/chat/bin/events.js`); `event: activity` is reserved for AS-103's ephemeral frames (no read-back). **Pending metawork (headless write denied, 2026-09-11 tick watcher:25355):** the tick procedure's stage-boundary emits — plan T5 in `.lattice/plans/task_01M26H1TA8K3E2SSS9DY672PH1.md`, wording verbatim, inserted at the end of step 3 of `.claude/commands/advance.md` plus its one-sentence Bounds bullet — and the WIP-3 Bounds wording above are both still to be applied from a live session; until then the plan's T5 text and the WIP paragraph are the operative procedure. Ticks that cannot emit say so in their report and carry on; nothing is emitted by hand.

**Internal-tools kickoff is implicit (board directive, DM msg 230, 2026-08-30):** tasks on internal tooling (chat app, dashboards, org tooling) proceed through the normal plan/implement/review lifecycle without per-task board green-light, with `agent:developer-marcus` as default implementer. Purchases and external-infra changes still require board approval.

## Operating Modes: Chat vs. Loop

**Claude Code chat is metawork only (decided 2026-08-29, tightened 2026-08-30, amended 2026-08-30).** Anything Forrest sends directly through Claude Code chat is board metawork — operating rules, this file, plumbing, advice, unblocking. **Never create Lattice tasks implicitly from Claude Code chat.** Forrest describing a problem, wish, or idea here is not a work order — handle the meta-layer in-session and remind him the chat app is the work channel. **Exception (amended 2026-08-30): an explicit request for a Lattice task in this channel ("make a lattice issue for X") is honored** — the orchestrator creates it with `--actor human:forrest` (the board member directed it verbatim) and it enters the normal loop from `backlog`. Explicit means he asked for the task by name; anything short of that goes through the chat app.

**Top-level markdown files are metawork artifacts (decided 2026-08-30).** `CLAUDE.md`, `README.md`, `PHILOSOPHY.md`, and `agents.md` are owned by the metawork layer (Forrest and the Claude Code orchestrator). **Employees never edit them.** When a task requires a change to one of these files (e.g., a new methodology carve-out), the employee records the exact proposed wording in the plan file or a lattice comment, and the metawork layer applies it. Corollary: an unattributed change appearing in these files is presumed to be metawork by the board or orchestrator — not tampering, and not something employees revert.

**The loop is the company (target state).** The intended operating model is an autonomous agent loop where employees create, claim, and complete Lattice tasks on their own — not chat-triggered work. One tick of the company is the `/advance` command (`.claude/commands/advance.md`); run it continuously with `/loop /advance` in a live session, or unattended via scheduled agents. All Lattice discipline below applies to loop work; chat is exempt per the above.

**Target interface: the chat app (decided 2026-08-30).** Forrest's primary interface with the company is the internal chat app, not Claude Code chat. A message he sends there starts a **loop** of `/advance` ticks that runs until the company is dry (board directive, Claude Code chat, 2026-09-10: "when I send a message, it should trigger a loop, not a tick"; stop rule chosen the same day: keep ticking while anything is mid-lifecycle or a backlog task is ready under the scheduling rule, stop when nothing is actionable, on two consecutive no-progress ticks, or at a safety cap; a new message re-arms). Implemented by AS-95 (filed by the board the same day); until it lands the watcher still fires one tick per message. Single-flight is unchanged either way: one tick at a time under one lock, and an active tick or loop reads a new message via the normal inbox pull instead of being pre-empted. Talking to the company sets it in motion. Claude Code chat is the meta/governance channel only: operating rules, this file, board-side plumbing. **Work enters the company through exactly two doors:** (1) requests made inside the chat app — company-internal communication that employees turn into Lattice tasks (the employee creates the task as `agent:<employee-id>`, with `--on-behalf-of human:forrest` when it came from the board member), and (2) employees' own initiative during loop ticks. There is no third door.

**RESOLVED 2026-08-30 — headless ticks are no longer permission-crippled (AS-21).** For most of 2026-08-30, watcher-fired headless ticks (`claude -p '/advance watcher:<pid>'`) had every write-capable Bash command auto-denied — `lattice` (any subcommand), `node apps/chat/bin/chat.js`, `git add`/`commit`, `sqlite3`, `rtk proxy` — so every watcher tick degraded to a no-op report and the company only moved in live `/loop /advance` sessions. Root cause (isolated in tick `watcher:23050`): **the repo's own `.claude/settings.json` allowlist is inert for headless ticks** — project-scope settings do not reach a `claude -p` child, and the read-only commands that *did* work were passing via Claude Code's built-in read-only heuristic, not the allowlist. This disproved rung 1 of the escalation ladder in `apps/chat/watch/README.md` §"Permission modes"; that README has been corrected.

The fix (AS-21, commit ee57b3d): the watcher reads settings at fire time and passes the grants explicitly as `--allowedTools`/`--disallowedTools` in `tickArgv()` (`apps/chat/watch/advance-watcher.mjs`). This preserves the `git push --force` deny rules, unlike the `bypassPermissions` fallback. **Verified live in tick `watcher:33733` (19:32Z)** — that tick ran `lattice list`/`comment`, read and posted to the chat app, and staged with `git add`, all previously denied. Keep this paragraph as the record of why the watcher hands grants over argv; do not "simplify" it back to relying on project settings.

**Known residual (narrowed by AS-75, merged 2026-09-07):** the `./apps/chat/chat` wrapper shells out to `docker`, which is not on PATH in the headless tick environment, so a tick still cannot run chat CLI commands or rebuild the container itself. It no longer needs to: **the host watcher deploys `apps/chat` on its own** — it resolves the docker binary by absolute path (`ADVANCE_DOCKER_BIN`, else a candidate list) rather than via PATH, rebuilds when master's image-input digest differs from the id the running container reports at `/api/build`, and restarts *itself* by exiting for launchd to relaunch when its own source changes. Merged chat code goes live unattended within ~60 s. When it cannot act (no docker binary, dirty tree, watcher down) it says so in `apps/chat/data/deploy-state.json` and the chat sidebar's build line. One-time bootstrap: the watcher running at merge time (pid 90824, pre-AS-75 code) has no deploy logic, so the board or a live session restarts it once (`launchctl kickstart -k gui/$(id -u)/com.american-software.advance-watcher`, after any in-flight tick ends); from then on it self-updates. The rest of this paragraph still holds.

**Corrected 2026-09-10 (orchestrator), because what stood here contradicted the tick procedure and cost two employees reasoning time in a single tick.** The old wording said "ticks must not use `node apps/chat/bin/chat.js` for reads **or writes** while the container server is up." The hazard behind it was real — host-side CLI writes could land in a WAL view the server never sees (AS-24, orphan msg 161), and host-side reads could be WAL-stale enough to miss the very message that fired the tick — but **AS-24 fixed it inside the CLI, which makes the blanket ban stale.** `bin/chat.js` now probes for a server and proxies every read and write through the HTTP API whenever one is reachable; it refuses loudly (exit 1, zero side effects) when the probe is ambiguous, and opens the DB directly only when nothing is provably listening. So: **ticks may use `node apps/chat/bin/chat.js` directly, for reads and writes** — which is what `.claude/commands/advance.md` step 1 already instructs. The two rules that still bind are narrower: never read the host sqlite file directly while the server is up, and **never override an AS-24 refusal with `CHAT_MODE=direct` during a tick.** Unchanged and still true: the `./apps/chat/chat` *wrapper* shells out to `docker` and does not work in a headless tick — that is the wrapper, not the `bin/chat.js` entry point, and conflating the two is what made the old sentence look correct. The raw API stays a valid fallback when the CLI itself is unavailable: `GET /api/conversations` / `/api/messages`, `POST /api/messages` / `/api/read` at `http://127.0.0.1:8347`; `curl` is not in the tick allowlist, so use `node -e` with `fetch`.

**Headless ticks: run lanes as FOREGROUND parallel `Agent` calls, never in the background (learned 2026-09-11, tick watcher:67350).** In a `claude -p` tick, background sub-agents are killed by the harness 600 s after the orchestrator's turn ends (`Background tasks still running after 600s; terminating` — the `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS` ceiling), regardless of the 30-minute tick timeout. The 07:21Z tick that day spawned Lena (AS-81) and Marcus (AS-82) with `run_in_background: true`, ended its turn to wait for them, and both were terminated at 605 s with nothing filed — Lena's commit landed, Marcus's extraction sat uncommitted, and neither wrote a Lattice comment; the watcher closed their stages as `unclosed`. Issuing the `Agent` calls in one message with `run_in_background: false` runs them concurrently *and* keeps the orchestrator's turn open, so only the tick timeout bounds them; the next tick resumed both lanes that way and each finished in 4–9 minutes. Two corollaries: tell every implementer to commit early on the branch and keep a progress note in their scratchpad so a cutoff is resumable, and have the orchestrator take counted compose receipts by absolute docker path (`/usr/local/bin/docker`, the value in `deploy-state.json`'s `dockerBin`) via `node -e` + `spawnSync`, since docker is off PATH for the sub-agents.

**Board state commits per lane, not per tick; the loop cap re-arms; the tick box is 60 minutes (board, 2026-09-11, Claude Code chat).** Tick watcher:57637 loop tick 24 ran three lanes, all three finished their stages, and the tick hit the 30-minute timeout before the orchestrator wrote a single transition — two reviews and a plan sat as dirty `.lattice/` on master until a live session recovered them (78c8933), and the loop had stopped on its 23-tick cap with the company mid-lifecycle. Three rules follow:
1. **The orchestrator commits each lane's board state — transition, comment, plan — to master the moment that lane's sub-agent returns**, before waiting on the other lanes (it is already the only writer; this only moves the write earlier). A tick that times out then loses at most the lane still running, never a finished one.
2. **The tick timeout is 60 minutes and lock staleness 75** (`ADVANCE_TICK_TIMEOUT_MIN=60`, `ADVANCE_LOCK_STALE_MIN=75` in the launchd plist and its template; `.claude/commands/advance.md` step 0 matches). 30 was sized for one lane; with WIP 3 and median stages of 11–19 minutes (plan/implement/review medians from the AS-100 stream, 34 ticks) it was the binding constraint. The heartbeat rule (rewrite the lock every 30 minutes) is unchanged and still fits.
3. **The loop cap is a runaway guard, not a stop rule.** When the cap fires with work mid-lifecycle, the watcher should wait a cooldown (proposed 10 minutes) and re-arm itself; only a `nothing actionable` or `no-progress` evaluation ends a loop for good. This is watcher code and needs a Lattice task through the normal doors; until it lands, the board's next message re-arms as before, and the tick report says when a cap stopped a loop that still had work.

**The tick may amend its own procedure (same decision).** `.claude/commands/advance.md` is the company's operating procedure, not a top-level markdown artifact: the orchestrator (a cofounder) applies procedural amendments that a tick's record has already worded — the "pending metawork: headless write denied" items above are exactly this shape — and commits them to master as `AS-<n>: board — procedure: <what>`. `.claude/settings.json` grants `Edit` on that one file to headless ticks (handed over at fire time per AS-21). `CLAUDE.md`, `README.md`, `PHILOSOPHY.md`, and `agents.md` stay metawork-only; a tick that needs one of them changed still records the wording and says so.

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
- **PM hire: decided "not yet" 2026-09-01** (board question #board msg 368; record `docs/strategy/10-pm-hire-decision.md`). Project management is done by the dependency graph + Lattice, not a role; product management for v1 is frozen by the boundary filter. Re-opens only on the record's §5 triggers — two consecutive scope-level plan failures on the D1 line, the warm-intro interviews landing, or (forced revisit) the AS-49 join. Role shape and reporting line for the eventual hire are pre-agreed in the record §6.
- **Second developer hire: re-decided "hire the pair" 2026-09-02** (forced revisit, record `docs/strategy/11-second-developer-decision.md` §9 — trigger 4 fired at D1 ready-width 4 when AS-38/39 landed). The §7 falsifier tripped: 87.7% line utilization over the 12.6h since the record signed, ready queue 2→4, so "headcount adds zero throughput" is stale — cadence was fixed by running the loop, WIP is the term left. Hired the §5.1 pair (no accepted review queue in front of Priya): `developer-lena` and `qa-ruben`, both `ic` under `agent:cto-owen`, model parity with counterparts. Lane doctrine supersedes §6's static split: lanes are capacity, not territories — both lanes on D1 while its ready-width ≥ 2 (Marcus: spine highs; Lena: self-contained mediums), spike's measured pair one-D1 + one-chat. WIP stayed 1 until the CTO's parallel-lanes spike (AS-60, done 2026-09-02) shipped; the spike's written result was the re-decision point (record §9.8).
- **WIP limit: 3 (board directive, #board msg 642, 2026-09-10: "lets bump the WIP limit to 3").** Up to three tasks may occupy active lifecycle stages (`in_planning` through `review`) at once, each in its own worktree with its own employee, under one orchestrator. Mechanics unchanged from the AS-60 spike: one agent per task, one worktree per task, every `.lattice/` write and every master commit serialized through the orchestrator in the main checkout (sub-agents never commit on master), per-actor scratchpads. A tick may therefore run up to three stages on three distinct tasks in parallel lanes; the "one task per tick" bound in `.claude/commands/advance.md` is to be amended to match — the headless tick that recorded this directive (watcher:17217, 20:23Z) was denied the write to `.claude/commands/`, so a live session applies it; until then this paragraph overrides that line. Proposed wording for the Bounds bullet: "One tick advances each task it touches by at most one lifecycle stage, and touches at most **three** tasks (the WIP limit — board directive #board msg 642, 2026-09-10; see `CLAUDE.md` § Org Chart "WIP limit"), each in its own worktree with its own employee, run as parallel lanes from one orchestrator. Or it performs one org-level action. Do not marathon one task through several stages in a single tick, and do not exceed the WIP limit by starting a fourth lane." **Applied to `.claude/commands/advance.md` from a live session 2026-09-11** (the Bounds bullet now carries the wording above verbatim), so that line no longer needs overriding. Practical ceiling inside a watcher-fired tick is the 30-minute tick timeout, not the WIP number — a lane cut off by the timeout resumes from its branch next tick. First lived the same day, one tick before the directive: AS-95 planning and AS-94 implementation in parallel (DM msg 638).
- **CMO hire: decided "not yet" 2026-09-08** (board question #bizdev msg 588; record `docs/strategy/13-cmo-decision.md`). No marketing function exists to lead — zero customers, zero public surface, zero channels, a $0 channel budget (all spend board-gated), and an unnamed product — and the pre-M1 marketing surface (naming: CEO + Sofia; positioning and pricing: CEO; evidence: the researchers) is covered without a hire. Marketing enters as an IC first: `marketer-<name>` (Product Marketing), `ic` under `agent:ceo-carla`, hired when M1 (reachable product) reaches planning — before its marketing pages are built — or when the record's §7 falsifier (naming not complete by the AS-49 join, for bandwidth reasons) trips. A CMO re-opens only on the record's §6.2 triggers — two+ marketing ICs or a board-approved recurring channel budget, top-of-funnel measured as the binding constraint 30 days after M2, an exec-level channel counterparty, or (forced revisit) M5 scoping — and a C-level hire routes to the board as a framed recommendation regardless of the standing grant (the board delegated the routing question to the CEO — #bizdev msg 591, 2026-09-09, "your call" — and the CEO set it conservatively; record §9.4). Role shapes and reporting lines are pre-agreed in the record §8.
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

### Scheduling priority

**In force from 2026-09-11 (board, Claude Code chat, after the inefficiency review of that evening — "yeah, lets do it").** The Chat-before-D1 rule of 2026-09-07 (kept below as the record) is **lifted**. Its purpose is met — AS-93/94/95/99/100 merged — and what remained in the set was self-generated: 36 of 125 tasks were review-spawned residuals, the chain had reached AS-28 → AS-109 → AS-126 (a guard on a guard on a favicon), and D1 had not moved since AS-65 while AS-51 sat in `needs_human` for ten days. The rules that replace it:

- **Priority means product impact, not provenance.** `critical` is reserved for what a customer, the board, or a running deploy would notice. A review residual defaults to `low` (`medium` when it is a behaviour defect in shipped code). The `Chat:` prefix carries no scheduling weight. Existing `critical` residuals in the backlog are re-marked by the orchestrator when it next touches them; no separate re-prioritisation pass.
- **Findings are comments first, tasks second — the triage gate.** A QA review records its findings in the review comment and files nothing itself. The orchestrator, at the merge or rework step, files at most the findings that name a *behaviour* defect (wrong output, wrong state, a hole an input can reach). Test-coverage and guard-hardening residuals stay in the review comment and are folded into the plan of the next task that touches that file. **Chain depth cap:** once AS-124/125/126 finish, a task whose ancestry is task → task → task with no product or board request in it is not filed unless it is a behaviour defect — the finding stays on the parent's record. M4/M5/M6 are unchanged: the review still probes past the list and still reports findings first; what changes is that a finding no longer automatically becomes a critical task.
- **Ordering is `lattice next` with the age tiebreak over honest priorities.** The one standing exception is AS-103 (board-requested, foreman view). D1 tasks AS-46..50, 69, 70, 71 and AS-90 are back in the ready set at their existing priorities. AS-51 (the Stripe test account) is the board's own gate on AS-50 and is named in every tick report while it stands.

**Record — the 2026-09-07 rule (retired 2026-09-11, kept for history):** After in-flight work completes its current lifecycle, every open task on the chat app and its tooling — titles beginning `Chat:`, plus the watcher/harness follow-ups under `apps/chat` (the AS-75 F-series AS-84..AS-88, AS-81, AS-82, AS-61) — is scheduled before any further D1 core-product task (AS-46/47/48/49/50/69/70/71 and AS-90's build stage), unless the board exempts a specific task in writing. "In-flight" at the time of the directive means AS-45 (cycle 4) and AS-75 (in review): a task already `in_progress` or `review` finishes, it is not pre-empted. The Chat set carries priority `critical` in Lattice so `lattice next` reflects the rule (at `high`, the age tiebreak still picked an older D1 task — commit 68162bc); a tick that would otherwise start a D1 task while any Chat-set task is ready picks the Chat-set task instead and says so in its report. Within the set, ordering follows `lattice next`'s age tiebreak unless a written rule here says otherwise. Standing rule (CTO call, delegated by the board in DM msg 614, 2026-09-09, "your call"; revised 2026-09-10 from DM msg 632): AS-94 (supervise the Lattice dashboard under launchd) goes first, then AS-95 (a board message starts a loop of ticks until the company is dry), then the rest of the set by age. AS-94 is the second half of the outcome the board asked for "right away" (DM msg 607; the first half, AS-93, merged 2026-09-10 as f15c4ad). AS-95 jumps the age queue because the board has asked for the loop twice (the 2026-09-10 Claude Code directive that filed it, and DM msg 632 "loop on those until done") and because by age it sat behind sixteen Chat-set tasks — at three to four ticks per task, that is fifty-plus board messages before the mechanism that lets one message drive the whole queue; landed second, every task after it costs the board one message instead of four. A tick that would start any other Chat-set task while AS-94 or AS-95 is ready picks them instead and says so in its report. AS-99 (Chat: git worktree observability) goes third, after AS-94 and AS-95 and ahead of the age queue — board DM msg 651, 2026-09-10; CTO ordering call recorded on AS-99 (filed the same day on behalf of the board; Jonah owns the UX half of its planning stage). AS-100 (Chat: structured company-events feed — tick/stage/sub-agent lifecycle events) goes fourth, directly behind AS-99 and ahead of the age queue — filed 2026-09-10 on behalf of the board from DM msg 658 (the "foreman of the factory" north star); CTO ordering call recorded on AS-100. It does not start before AS-95 lands. AS-103 (Chat: live tool-level activity, ephemeral over `/api/stream`) goes fifth, directly behind AS-100 — filed 2026-09-11 on behalf of the board from DM msg 668; CTO ordering call recorded on AS-103 (its pre-planning hook spike starts no stage and is exempt from lifecycle ordering). AS-89 (Chat: a hired employee has no chat identity until someone registers it) jumps to the head of the age queue — board, `#engineering` msg 790, 2026-09-11 ("is AS-89 resolved? ... lets get it going if we can"); it entered `in_planning` the same tick (loop tick 24), behind only the already in-flight AS-84 rework, and ahead of AS-87/AS-88. Retired rules, kept for the record: AS-93 went first (merged 2026-09-10, f15c4ad); before it, AS-91 (the export leak) went first because every merge before it re-exported the board member's DMs (merged 2026-09-09, 5de428f). AS-55 and AS-79 are chat-adjacent but board-gated, so they are not in the set. AS-96 was cancelled 2026-09-10 (the dashboard port question moved upstream to the Lattice project, DM msg 632). The rule lapses when the Chat set is empty or when the board lifts it in writing. Resolved 2026-09-07 by the board in DM msg 567 ("do chat first"): AS-90 (the demo requested in msg 555) is not exempt; it enters its lifecycle after the Chat set is empty and AS-45 has merged.

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

Each lifecycle stage gets its own sub-agent with fresh context, and each sub-agent *is* a specific employee doing the job their title implies. This mirrors a real dev team: a PM scopes and plans, a developer builds, QA verifies.

**Scaled by complexity (board, 2026-09-11, Claude Code chat).** The three-stage model is the default for `complexity: medium` and `high`. A task marked `complexity: low` — test-only, one file, or a fully specified bug — runs **two stages**: one `developer-*` does plan + implement in a single stage (writes the plan file — still a real plan, however short — commits it to master from the main checkout, then creates the branch and worktree and does the code and tests), and a `qa-*` reviews as usual. The review gate is never collapsed: the fresh-context boundary between implementer and reviewer is the whole point. **Proof burden scales the same way:** `low` needs the suite green with a `--build` receipt and one observed red per falsifier the plan names; the mutation battery, the cardinality sweep, and the budgeted adversarial pass are for `medium`/`high`. Complexity is set by the task creator, or by the orchestrator when pulling from backlog; a developer who finds a `low` task is not low says so on the task, re-marks it, and hands it back to the three-stage path before writing code. Before this rule a one-line test guard (AS-126) cost three fresh agents, three ticks, and an hour of wall-clock — the same fixed overhead as a 900-line watcher change.

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

**Lattice's auto-fired review is NOT the company's review gate (observed 2026-09-10 on AS-95).** Lattice will, on its own, fire a `code-review` agent when a task enters `review` — it writes `.lattice/review_state/<task_id>.json` with `auto_fired: true` and runs an agent literally named `claude`. Treat it as third-party tooling output, never as the review gate, for three reasons: it runs as a **generic actor**, which "Every Actor Is an Employee" forbids outright; it reads a diff and cannot do the things this company's gate exists to do — run the counted `--build` compose suite, drive mutations to an observed red, or probe past the criteria list (M6); and it is not answerable to anyone. On AS-95 it **timed out at 600 s with no artifact and no findings**, and left a `NEEDS HUMAN` note at 21:02Z that no employee wrote. Rules that follow:
- A task is reviewed when a named `qa-*` employee has recorded a `--role review` comment. An auto-review comment never satisfies the gate and never justifies a move to `done`.
- **A `NEEDS HUMAN` note from the daemon is not a board gate.** Do not route to `needs_human` on it, and do not ask the board about it. Only an employee's own `needs_human` transition means anything.
- **Opt out of the daemon on every transition, and clear what it left (learned 2026-09-11, AS-101; board question #engineering msg 792 "what do I need to do to unblock these? all are tagged needs human").** Lattice 0.2.1 exposes both halves AS-101 assumed were missing: `lattice status <task> planned|review --no-auto-review` skips the auto-fired plan-review/code-review for that transition (Lattice's own prompt calls this "one review owner per gate cycle" — exactly our rule), and `lattice needs-human <task> --clear --note "<which qa-* review covers it>"` clears a daemon flag through the event log. So: **every `→ planned` and `→ review` transition in a tick carries `--no-auto-review`**, and a daemon flag that appears anyway is cleared with a note naming the employee review — never left standing on the board, never asked of the board. Six stale flags (AS-28/81/84/85/86/95) were cleared this way in tick watcher:93997 loop tick 25. **Pending metawork:** the matching sentence for step 3 of `.claude/commands/advance.md` (headless write denied in that tick; wording is in the AS-101 comment of 2026-09-11) — until a live session applies it, this bullet is the operative procedure.
- Do not kill the daemon's process or delete its state file mid-flight — it is another process's state, and "never delete what you cannot attribute" applies to it too. `.lattice/review_state/`, `.lattice/locks/` and `.lattice/tmp-prompts/` are gitignored runtime state; never commit them.
- **Anchoring hazard:** if the daemon posts before the QA employee has formed their own findings, the tasking message must tell the reviewer not to read it first. A reviewer who reads it and agrees is indistinguishable afterward from one who reasoned independently — the AS-36 rule, arriving through the task record instead of the prompt.

**Do not brief the answer into the reviewer (learned 2026-09-01, AS-36).** A fresh context boundary is worthless if the orchestrator's tasking message hands over the conclusion. Reviewing AS-36, Priya was asked to independently re-derive a stack ranking — and the prompt had already given her the recommendation, the ranking, and the three decisive byte counts before she opened a file. She flagged it herself: *"My re-derivation was anchored, not blind, and I couldn't un-read it"*, and correctly filed it as a finding against the tick rather than the document. **When a review step asks the reviewer to derive something independently, the tasking message must not contain that thing.** Give the reviewer the deliverable's location, the criteria, and what to check — never the verdict, the ranking, or the numbers that decide it. Context the reviewer genuinely needs (constraints, prior findings, do-not-redo lists) is fine; the answer is not. The anchoring is invisible afterward — a matching independent result is indistinguishable from an anchored one, so the damage is silent and the only defense is not leaking it in the first place.

**A guard is proven by breaking it, and mutation testing is one indivisible step (learned 2026-09-01, AS-37/AS-53; applied to the metawork layer's own tooling the same day).** A checker that has only ever been seen passing has proven nothing — this company has logged more than ten "vacuous pass" instances where a green guard was examining an empty set, a neighbouring file, or a metric that moved with its own baseline. So: before trusting any checker, show it FAIL against a deliberately broken input. Prefer a scratch copy (never mutate the task worktree to falsify a checker). When the mutation must happen in place: back up, `trap` the restore on `EXIT`, mutate, **assert the mutation applied** (an unapplied mutation looks exactly like a passing checker — a BSD-vs-GNU `sed` address once "passed" a check this way), observe, let the trap restore, prove the tree with `git diff --exit-code`, then **rebuild and re-run** — a restored source tree with a stale mutant image produced phantom failures once already. Record the exact failing-test set; a wider or narrower set than expected is itself a finding. Report cardinality (how many files/rows/cases were examined) before quantification (how many passed).

**Sharpening, learned 2026-09-10 (AS-95 rework cycle 1): assert the mutation applied *at the intended site*, not that some edit applied.** Marcus had one mutant survive its battery — and the survival was the mutation's fault, not the guard's. His F3 mutant's pattern matched the `mirror()` call inside `settle()` instead of the one in `start()`, so the replacement landed somewhere real, the "assert it applied" check passed exactly as designed, and the guard stayed green because the thing he meant to break was never broken. A survivor therefore has **two** explanations that look identical from the outside — a genuinely vacuous guard, or a mutation that hit the wrong target — and you must distinguish them before reporting either. So: match on a pattern that can only hit the intended site (anchor it to the enclosing function, or assert the line number / surrounding context), and when a mutant survives, **re-read the diff of the mutated file before concluding the guard is weak.** Worth noting how this ended: chasing the false survivor exposed a real hole — nothing asserted that a settled tick reaches the mirror at all — so the corrected mutant found a genuine gap the original would have papered over. A survivor is a lead to run down, never a line to report as-is.

**Corollary — every counted compose run carries `--build`, and the image line is the receipt (learned 2026-09-09, AS-45 condition run).** The stale-image hazard is not confined to mutation testing. `docker compose run --rm test` without `--build` silently reuses whatever image is cached: closing out AS-45, the CTO's own written recipe omitted the flag and returned **287 tests, 0 failing, exit 0** — green, and wrong, because compose reused an image built six days earlier that predated the branch's new test file. The correct run was 405. A smaller-than-expected case count reads as "fine" to every reflex a reviewer has, so the cardinality rule above is the only thing that catches it — and only if the number is compared to a known expectation. Therefore: any suite run whose numbers are quoted in a report, comment, review, or acceptance decision uses `--build`, and the run is void unless the output shows compose actually rebuilding (the `Image <name> Built` line). No build line, no valid number. This bit the author of the recipe, not a newcomer — do not assume familiarity with the stack is protection.

**The criteria list is a floor, not the review (learned 2026-09-03, AS-45; adopted 2026-09-07 after the board delegated the AS-45 valve decision in DM msg 555).** Four consecutive review cycles on one branch passed every acceptance criterion while a defect stood — a lexical guard whose English was wider than its algorithm, found three times in three positions (attribute-name, tag-name, then case-sensitive regexes that let `ONMOUSEOVER=` through). That is not four sloppy reviews: every criterion in a plan is a restatement, by the plan's own author, of what the plan already believed, so a sweep inherits the plan's blind spot exactly and a longer checklist moves the blind spot rather than removing it. Three rules follow, proposed verbatim in the AS-45 plan §10 and adopted here:
- **M4 — a stated property names its own falsifier, as a numbered criterion.** When a plan states a guarantee as a property ("no X reaches position Y", "a second Z cannot land without moving a committed number"), it names, as a numbered acceptance criterion, the concrete input that must make the mechanism report a violation. The criterion is satisfied by an **observed red**, never by an argument that the mechanism would catch it. A property whose falsifier is not named is documentation, and must be written as documentation.
- **M5 — findings first, sweep second, never the pass rate alone.** A review comment reports its findings first and its acceptance-criteria sweep second, with the sweep explicitly labelled as a floor check. "N of N pass" is never stated without the adjacent count of findings *outside* the list — on AS-40 and AS-45 cycles 1–2 the pass rate was true and misleading at the same time.
- **M6 — independent adversarial probing is the load-bearing control.** The reviewer's mandate explicitly includes probing past the list — driving an input nothing tested, following a redirect chain to its terminus, breaking a guard at its edges before reading any report — and time is budgeted for it. A review that walks the list to 100% and stops is incomplete at 100%, and should say so in its own comment. A review that passes every criterion *and* returns a blocking finding is a successful review, not a contradictory one.

**Scratchpads are per actor (M3, from the AS-45 cycle-1 review).** A tick that hands the implementer and the reviewer the same scratchpad path lets the reviewer read the implementer's mutation logs and notes before forming their own results — the AS-36 anchoring failure one layer down, leaking through the filesystem instead of the prompt. Each stage's tasking message names only that actor's own subdirectory (`scratchpad/<actor-id>/`), and the tick creates no artifacts at the scratchpad root. "Never delete what you cannot attribute" applies to the scratchpad plane too.

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
- **Commit as the employee.** Each stage commits under its persona's identity so `git blame` shows who at the company wrote what. `user.name` is the employee id exactly as it appears in the Lattice actor id (`agent:developer-marcus` → `developer-marcus`), so blame joins to the event log on one key; the email is that id at `agents.american-software.local`:
  ```
  git -c user.name="developer-marcus" \
      -c user.email="developer-marcus@agents.american-software.local" \
      commit -m "AS-7: ..."
  ```
  (Settled 2026-09-01 from a QA convention finding on AS-53: history carried both `developer-marcus` and `developer-marcus-webb`. The actor-id form wins; older commits are not rewritten.)

### Task lifecycle in git

- **Planning stage:** plan file commits to master (it is board state in `.lattice/plans/`). Then create `feat/AS-<n>-<slug>`, `lattice branch-link` it, and `git worktree add .worktrees/AS-<n> feat/AS-<n>-<slug>`.
- **Implementation stage:** code + tests commit on the branch, inside the worktree. Logical commits at stage boundaries.
- **Review:** QA reads `git diff master...feat/AS-<n>-<slug>` (now pure code — no board-state noise) and works inside the worktree. Rework commits accumulate on the branch — and are pushed to the same PR branch (below).
- **Pull requests for board review (board directive, DM msg 576, 2026-09-07: "from now on PRs you want me to look at, open on github"; scope narrowed by the board in Claude Code chat the same day: "only things I need to review need PRs").** A PR is opened **the moment a tick asks the board to look at code** — a merge held for the board, a `needs_human` on a diff, a safety-valve override — not at every `review` transition (Owen's first reading, commit 0e7e78a, generalized the directive to every task; the board corrected it). The owning employee pushes the branch (`git push -u origin feat/AS-<n>-<slug>`) and opens the PR against master with `gh pr create` — title `AS-<n>: <task title>`, body carrying the task's what/why, the plan path (`.lattice/plans/<task_id>.md`), and the plan's acceptance criteria — then posts QA's review comment to it with `gh pr comment` (findings first, sweep second — M5), so the board reads diff and verdict in one place. The PR URL goes in the Lattice comment and in the chat message that makes the ask; rework commits push to the same branch. The board's answer arrives in chat or as a PR comment/approval, and **the merge itself stays local** `--no-ff` from the main checkout (the two-plane rule keeps one owner). Pushing master afterwards makes GitHub mark the PR merged; the tick then deletes the remote branch (`git push origin --delete feat/AS-<n>-<slug>`) along with the worktree. **Never merge via `gh pr merge` or the GitHub button** — `gh pr merge` is on the deny list. PRs are opened under the board member's own `gh` login (`malls`); employee attribution lives in the PR body and the branch commits. Plumbing applied 2026-09-07 from a live session: `"Bash(gh pr *)"` and `"Bash(gh auth status)"` allowed and `"Bash(gh pr merge*)"` denied in `.claude/settings.json` (handed to headless ticks at fire time per AS-21), and the matching `review`/`needs_human` wording in `.claude/commands/advance.md`. A tick where `gh` is denied or unauthenticated does not skip the PR silently: it says so in its report and in the chat reply, and opens the PR in the next tick that can.
- **Merge at `done`:** from the main checkout, merge with `--no-ff` (message: `AS-<n>: <task title>`), run the records step, push master (GitHub marks the PR merged), then `git worktree remove .worktrees/AS-<n>` and delete the branch locally and on origin. Each task stays a visible unit in history.
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
the AS-6 board decision — and, by board directive of 2026-09-07 (#board msg 559), DMs involving
`human:forrest`, implemented by AS-91 (merged 2026-09-09, 5de428f), which also removed the nine previously committed
`dm-*~~human~forrest.jsonl` files without rewriting history) are excluded from the chat export by design — hidden
means hidden, including git. Their only durable copies are the live DB and
manual `chat dump` backups; the board accepted this tradeoff on 2026-08-30 (AS-6).

**Records step resumed (orchestrator, 2026-09-09, at the AS-91 merge).** The step was
suspended from the AS-75 merge (2026-09-07) until AS-91 landed, because the exporter could
not exclude human DMs before then; the export is append-only and deterministic, so the
first export after AS-91 catches up every non-excluded conversation. One gate survives:
a merge tick runs `chat export` only when `apps/chat/data/deploy-state.json` shows
`runningId` equal to `desiredId` — the CLI runs against the container, and an export taken
while the container still runs pre-merge code would re-emit exactly the files the merged
guard forbids. Otherwise the tick defers the export to the next tick and says so. The first
post-AS-91 export is also AC-5's second half (plan §8): it must create no `~~human~` file
and only append to public files; the tick that runs it reports that on AS-91. The matching
merge-step sentence in `.claude/commands/advance.md` carries the same gate (applied from a
live session 2026-09-09; the headless tick that merged AS-91 was denied the write, as at the
AS-75 merge).

### Pushing

- Push master after every merge and at the end of any tick that committed board state or metawork. A task branch is pushed when a PR is opened for it (board-review PRs, above) and on every rework commit after that; pushing earlier is optional.
- Force-push is always `needs_human`. Never rewrite pushed history autonomously.

### Repo structure (decided 2026-08-31)

Monorepo (`apps/*`) for the foreseeable future — cross-cutting changes (app + tick procedure + docs) stay atomic, and there is one board and one audit trail. Submodules/repo-extraction happen per-product at the moment a product needs its own public repo, external contributors, or independent deploy cadence — a real migration project with board sign-off, not before.


---

## Additions after the freeze

(none yet)
