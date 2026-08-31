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

Early days: founding team hired (CEO, CTO, developer, QA), internal chat built, operating model established. The nature of the business itself is decided by the cofounder agents — not by user direction — and is still taking shape. Watch `.lattice/` and the commit history: they are the company's paper trail.
