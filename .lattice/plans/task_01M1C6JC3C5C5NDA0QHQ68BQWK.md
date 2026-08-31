# AS-33: Chat: org chart visualizer + personnel frontmatter validator (renderer/validator trigger at 8 headcount)

Board request (DM msg 297, 2026-08-31): an org chart visualizer in the chat app. This also lands exactly on the trigger CLAUDE.md 'Org Chart' section set in advance: at ~8-10 headcount, build the org-chart renderer/validator. Active headcount is now 8 — so this task carries BOTH the visualizer and the validation duties, by design.

CONSTRAINTS (from CLAUDE.md, non-negotiable):
- The org chart is DERIVED from personnel/*.md YAML frontmatter (actor_id, name, title, class, reports_to, team, status). Never a hand-maintained document.
- lib/personnel.js is a deliberate YAML-subset parser (flat scalars + inline comments only). Do NOT grow it into a YAML parser; no schema changes needed for this task — readRoster() already returns reportsTo.
- Chat app is read-only w.r.t. personnel/ (AS-8 contract). The visualizer reads; it never writes.

SCOPE:
1. API: add 'reportsTo' to GET /api/roster rows (server.js roster mapping, ~line 139) — the lib already surfaces it; the endpoint just drops it today. Additive, non-breaking.
2. New client surface: an org-chart view in the chat web UI (e.g. a modal or route-state panel alongside the AS-19 thread-modal pattern), rendering the reporting tree by walking reports_to edges up to human:forrest (board) at the root. Show name, title, class, team per node. Derived live from /api/roster on open — no cached artifact. Keep it dependency-free like the rest of public/ (no chart libraries; nested lists or simple CSS tree is fine and matches the app).
3. Validator (the CLAUDE.md-mandated half): a pure function in lib/ (shared by server and tests) that checks the roster for (a) orphan reports_to — edge pointing at no active actor (human:forrest is a valid root), (b) cycles, (c) any employee reporting to a class 'ic'. Surface violations in the org-chart view (badge/warning row) and expose them for CLI use (a small 'node' entry point or npm script is enough — CI-grade wiring can come later). Tests for all three violation classes plus the clean case.

JUDGMENT CALL, recorded so nobody re-derives it: CLAUDE.md's note suggests generating a static personnel/ORG.md. I am deliberately deferring that — a generated file checked into the repo drifts between regenerations, which is the exact hand-maintained-chart failure the section warns about, and the live derived view supersedes it. If the board wants a committed snapshot artifact anyway, that is a follow-up task; I will flag the CLAUDE.md wording to the metawork layer.

QUEUE POSITION: behind AS-26 (in review) and the product line (AS-29/30/31 outrank internal tooling); roughly peer to AS-27, ahead of AS-28. AS-32 (sidebar roles, split out as a small self-contained diff) can ship independently and first.

Internal tooling — proceeds without per-task board green-light per board directive DM msg 230; default implementer agent:developer-marcus.
