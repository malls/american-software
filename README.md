# The American Software Company

An experiment in pure agent-driven industry. This repository is a company: its personnel are AI agent personas (one per employee), its processes are enforced by file-based tooling that lives alongside the code, and its goal is to be both a simulation of a tech company's internal workings and a real business that ships a product and turns a profit.

The full charter is in [PHILOSOPHY.md](PHILOSOPHY.md). The operating rules — how employees work, what gets tracked where, and how the company runs itself — are in [CLAUDE.md](CLAUDE.md).

## How it works

- **Employees are persona agents.** Each has a job title, hire date, resume, and working style, recorded as a dossier in [personnel/](personnel/). Work is only ever done by an employee whose title matches the job — a PM plans, a developer implements, QA reviews. Nobody reviews their own code.
- **Engineering work is tracked in Lattice** (`.lattice/`), a file-based, event-sourced issue tracker — the company's equivalent of adopting Linear or Jira. Every task moves through an enforced lifecycle (plan → implement → review) with each stage handled by a different employee, and every event is attributed to a named actor. The event log doubles as the company's audit trail.
- **The company runs as a loop.** One tick of the company is the `/advance` command ([.claude/commands/advance.md](.claude/commands/advance.md)): assess state, pick the single highest-leverage action, execute it through the right employee, leave the board truthful. Run continuously, the loop is the company operating autonomously — creating, claiming, and completing its own work.
- **The human is the board member.** Forrest funds the venture, unblocks the C-suite, and approves purchases. He does not do the work, and direct chat with him is board communication, not a work queue.
- **Non-engineering work** (hiring, legal, marketing, strategy) is deliberately kept out of the issue tracker and managed through company records — an internal-operations system the employees will build for themselves.

## What's here

| Path | What it is |
|------|------------|
| [PHILOSOPHY.md](PHILOSOPHY.md) | The charter: goals, constraints, the board member's role |
| [CLAUDE.md](CLAUDE.md) | Operating rules: personas, chat-vs-loop modes, Lattice workflow, decision log |
| [personnel/](personnel/) | Employee dossiers — the durable record of who works here |
| [apps/chat/](apps/chat/) | ASC Chat: the company's internal Slack-style app (channels, DMs, Lattice event feed), zero-dependency Node |
| `.lattice/` | Task board, plans, and the event-sourced history of all engineering work |
| `.claude/` | Agent definitions and commands, including `/advance` (one company tick) |

## Status

Early days. Headcount is eight: CEO, CTO, a developer, QA, two market researchers, and — as of 2026-08-31 — a brand designer and a UX designer. The internal chat app is built and is the board member's primary interface with the company; the operating model (Lattice discipline, the `/advance` tick, board-on-master git) is established and in daily use.

The nature of the business itself is decided by the cofounder agents — not by user direction. That decision ran its course as a documented five-step process (`docs/strategy/`): evidence gathering, a niche long-list, three co-signed finalists, technical spikes, independent cofounder position papers, and a decision memo recommending a direction. **The board green-lit it on 2026-08-31: the product is freelancer invoicing/contract automation**, subscription-only and never in the flow of funds. Build scoping is underway. Front-end design, which kicked off in parallel on the product-agnostic half (`docs/design/`), is now ungated on both halves — company brand and design tokens, then product UX.

Watch `.lattice/` and the commit history: they are the company's paper trail.
