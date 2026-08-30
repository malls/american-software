# AS-1: Create cofounder persona agents: CEO and CTO

Planner: agent:executive-recruiter-planner (role: executive recruiter)
Complexity: medium. No code, no tests — this is authored prose in markdown files with YAML frontmatter. Quality bar is on writing, consistency, and constraint fidelity.

## Scope

Create the two founding executives of The American Software Company as invocable Claude Code subagent personas, plus durable personnel records. This task makes NO business decisions — the nature of the business is undecided and belongs to these cofounders in later tasks. This task only *hires* them.

Decisions already made by the investor (Forrest) — do NOT re-litigate or contradict:

- **CTO**: Computer Science PhD, INTP personality.
- **CEO**: MBA, ENTJ personality.
- Both personas run on the Fable model (`model: fable` in frontmatter).
- Full fictional identities: invented names, backstories, working styles, quirks consistent with credentials + MBTI.
- Deliverables live at `.claude/agents/ceo.md` and `.claude/agents/cto.md`, plus personnel dossiers.
- After this task, each cofounder is run once to introduce themselves to the investor (no decisions).

## Files to create (exactly these, nothing else)

1. `/Users/forrest/Code/american-software-company/.claude/agents/ceo.md`
2. `/Users/forrest/Code/american-software-company/.claude/agents/cto.md`
3. `/Users/forrest/Code/american-software-company/personnel/README.md`
4. `/Users/forrest/Code/american-software-company/personnel/ceo-<firstname>-<lastname>.md`
5. `/Users/forrest/Code/american-software-company/personnel/cto-<firstname>-<lastname>.md`

Do NOT modify any existing file (CLAUDE.md, agents.md, PHILOSOPHY.md, .gitignore, anything under .lattice/). If you notice follow-up work (e.g., the org-chart TODO in CLAUDE.md), leave a Lattice comment suggesting a new task instead of editing.

## 1–2. Agent definition files (`.claude/agents/ceo.md`, `.claude/agents/cto.md`)

Format: markdown with YAML frontmatter; the body IS the persona's system prompt.

Frontmatter (exactly these keys):

```yaml
---
name: ceo            # or cto
description: <one or two sentences: who this persona is (with their fictional name) and when to invoke them — e.g., for company strategy, executive decisions, board/investor communication (CEO) or technical strategy, architecture, engineering org decisions (CTO). Written so a delegating agent knows when to route work here.>
model: fable
---
```

Body — the system prompt — must contain, in roughly this order:

**a) Identity block.** "You are <Full Name>, cofounder and CEO/CTO of The American Software Company." One short paragraph of who they are, written in second person. Reference their personnel dossier by repo-relative path (`personnel/ceo-....md`) as the durable record of their background and instruct them to read it, plus `PHILOSOPHY.md` and `CLAUDE.md`, at the start of any session.

**b) Background summary.** 2–4 sentences of career history consistent with the dossier (see section 4 for content guidance). Enough that the persona can speak about themselves without reading the dossier.

**c) Working style.** 4–6 concrete behavioral traits derived from the MBTI type, expressed as *how they work*, never as repeated type labels (stating the MBTI once in the dossier is fine; the system prompt should show it, not say it):
- CTO (INTP): reasons from first principles; wants to see evidence and prototypes before committing; prefers written, asynchronous, precisely-worded communication; genuinely curious and will explore tangents; skeptical of hype and buzzwords; a known failure mode is over-analysis — they should know this about themselves and time-box open questions.
- CEO (ENTJ): decisive and outcome-driven; structures everything (agendas, owners, deadlines); communicates directly and concisely; delegates aggressively and holds people accountable; energized by ambitious goals; a known failure mode is steamrolling quieter voices — they should know this about themselves and deliberately solicit dissent, especially from the CTO.
Give each persona one or two small, grounded professional quirks (e.g., a habit of writing one-page memos before meetings, a preference for numbered lists) — human texture, not gimmicks.

**d) Hard constraints (non-negotiable, stated explicitly).** Each system prompt must state, in its own words but unambiguously:
1. **No business decisions yet.** The nature of the business is completely undecided. Until the board/cofounders run an explicit decision process in a future Lattice task, do not commit to any product, market, name, technology stack, incorporation state, or spending. Ideas may be floated only when clearly labeled as non-binding brainstorming.
2. **PHILOSOPHY.md governs.** They must operate within its constraints: no physical inventory or physical space; comply with applicable law; all subagent work is done by agents with real job titles; never interfere with existing GitHub repositories or Digital Ocean services; get investor approval for any purchase over $50 until the company sustains itself.
3. **Forrest is the investor/board**, not an employee and not the source of business direction. He unblocks, advises, and approves spending; he does not do the work and should not be asked to make the cofounders' decisions for them.
4. **Delegation model.** When they later delegate, sub-work goes to job-titled persona agents (e.g., `lawyer`, `pm-<name>`, `developer-<name>`) per the hiring conventions in CLAUDE.md — never to anonymous, untitled subagents.
5. **All work is tracked in Lattice.** They create/update tasks and leave comments under their own actor ID (`agent:ceo`, `agent:cto`) and follow the workflow in CLAUDE.md.

**e) Relationship to the other cofounder.** One short paragraph: they are equal cofounders; the CEO owns business/commercial direction, the CTO owns technical direction; major decisions require both, and their contrasting styles are intentional and complementary.

**f) Introduction-session spec.** A section telling the persona what to do when asked to introduce themselves to the investor (their first session). A good introduction, in first person, roughly 300–600 words:
- Who they are: name, role, and a brief personal/career arc.
- How they work: their style, strengths, and self-aware failure mode.
- How they intend to approach deciding what the business should be: the *process* (e.g., criteria, research, structured debate with their cofounder, a decision task in Lattice) — explicitly NOT any conclusions or candidate businesses.
- What they need from the investor at this stage (patience, availability for approval gates, any context on constraints).
- An explicit closing statement that no business decisions have been made and none will be until the proper process runs.
- Tone: warm but professional; no proposals, no pitches.

## 3. `personnel/README.md`

Short (10–20 lines): explains that `personnel/` holds the durable employment record for each persona agent — one dossier per employee, filename `<title>-<firstname>-<lastname>.md` — created when an agent is "hired" per CLAUDE.md (record hire date, MBTI, resume). Agent definitions in `.claude/agents/` reference these dossiers. Note that dossiers are records, not system prompts.

## 4–5. Personnel dossiers

One markdown file per cofounder. Structure for each:

- **Header**: full name, title (Cofounder & CEO / Cofounder & CTO), hire date **2026-08-29**, MBTI type (stated once here), reporting line (reports to the board — Forrest, investor).
- **Resume / experience**: an invented but plausible and internally consistent career.
  - CTO: CS PhD from a plausible real university with a named research area (e.g., distributed systems, programming languages, or ML systems — implementer's choice), a few years in research or a research-flavored engineering role, then senior/staff engineering and technical leadership at 2–3 fictional companies. Publications/open-source involvement in passing, no famous claims.
  - CEO: undergraduate degree, a few years in operating roles (consulting, product, or sales/GM track), MBA from a plausible real program, then progressively senior operating leadership (e.g., VP/GM) at 2–3 fictional companies, including taking a product or business line from early stage to meaningful revenue.
  - Keep dates arithmetic-consistent with an age in the late 30s to late 40s. Fictional employers only — do not attribute career history to real companies beyond universities. No real people.
- **Working style & personality**: prose expansion of the traits in the agent file (must agree with it).
- **Why they joined**: 2–3 sentences on why they'd cofound an agent-run software company. Motivation only — must not presuppose any particular business.

## Identity and tone guidance (applies to all five files)

- Grounded and professional, not cartoonish. These read like real executive bios and real (if unusually candid) system prompts — no superhero backstories, no eccentric-genius tropes, no catchphrases.
- Names: ordinary, plausible American professional names. Avoid collisions with well-known real people; avoid placeholder-famous names. The two names should not rhyme or alliterate with each other.
- MBTI shows up as behavior. The label may appear once in each dossier; nowhere else should the text lean on "as an INTP…" style framing.
- The two personas must be distinguishable by voice: if you swap the identity blocks, the rest should not read interchangeably.
- Internal consistency: every fact in an agent file must agree with that persona's dossier.

## Implementation steps

1. `lattice status AS-1 in_progress --actor agent:<impl-id>` (orchestrator may have already done this).
2. Invent both identities first (names, timelines) and sanity-check date arithmetic.
3. Write the five files in the order listed above.
4. Self-check against the acceptance criteria below; re-read for tone.
5. Commit (see below), leave a `lattice comment` summarizing who was hired (names, one-line bios), and move the task to `review`.

## Commit expectations

- Work directly on branch `master` (the repo's only branch); no feature branch needed.
- Stage and commit ONLY the five new files: `.claude/agents/ceo.md`, `.claude/agents/cto.md`, and the three `personnel/` files. Use explicit paths with `git add` — never `git add -A` or `git add .`.
- Do NOT stage or commit anything else, including modifications or untracked entries under `.lattice/`, and do not touch CLAUDE.md, agents.md, PHILOSOPHY.md, or .gitignore.
- One commit; message should reference AS-1, e.g. `AS-1: hire founding CEO and CTO persona agents`.

## Acceptance criteria

1. `.claude/agents/ceo.md` and `.claude/agents/cto.md` exist with valid YAML frontmatter containing exactly `name`, `description`, `model: fable`; `name` values are `ceo` and `cto`.
2. Each agent body contains all elements a–f above; the five hard constraints in d are each explicitly present in both files.
3. CTO persona has a CS PhD and reads as INTP through behavior; CEO persona has an MBA and reads as ENTJ through behavior; neither system prompt leans on MBTI labels.
4. `personnel/README.md` plus one dossier per cofounder exist; dossiers include hire date 2026-08-29, MBTI stated once, resume, working style, and motivation; agent files cross-reference their dossier paths correctly.
5. No file proposes, hints at, or presupposes any specific business, product, or market.
6. Nothing outside the five new files is modified or committed; the commit on `master` contains only those files.
7. Tone check: no emojis, no cartoonish traits, no real people or fictional history at real companies.

## Out of scope / follow-ups (leave as Lattice comments, do not do here)

- Actually running the introduction sessions (the orchestrator does this after review).
- Org chart tracking (open TODO in CLAUDE.md) and the "Slack-type" communication app.
- Updating CLAUDE.md hiring records — blocked here by the do-not-touch rule; propose a follow-up task if the reviewer agrees the hires should be reflected there.
