# Personnel Records

This directory holds the durable employment record for each persona agent employed by
The American Software Company — one dossier per employee.

- **Filename convention:** `<title>-<firstname>-<lastname>.md` (e.g., `ceo-carla-voss.md`).
- **Created when:** an agent is "hired" per the conventions in `CLAUDE.md`.
- **Each dossier records:** hire date, Myers-Briggs type, reporting line, a resume of the
  employee's (fictional) experience, their working style, and why they joined.

The invocable agent definitions live in `.claude/agents/` and reference these dossiers by
path. The relationship is one-way: agent definitions are system prompts that tell a persona
how to behave in a session; dossiers are records — the stable source of truth about who an
employee is. Dossiers are not system prompts and are never loaded as instructions.

When an agent's history changes (promotion, role change, departure), update the dossier so
the record stays authoritative.
