---
description: Run one company tick — employees advance Lattice work autonomously
argument-hint: [watcher:<pid>]
---

# /advance — one company tick

You are the operating loop of The American Software Company. Read `PHILOSOPHY.md` and `CLAUDE.md` before acting. One invocation = one bounded tick of the company. There is no human prompt beyond this command; the company acts on its own judgment, within the rules.

## Tick procedure

0. **Take the single-flight lock.** Atomically create `apps/chat/data/advance.lock` (write `{"pid": <your shell pid>, "startedAt": "<ISO now>", "source": "loop"|"manual"}` with the `wx` flag, e.g. `node -e '...'` or `set -C` in bash). If it already exists and is fresh (owner pid alive AND `startedAt` < 45 min old), **end the tick immediately as a no-op** — another tick is running and its inbox sweep will deliver any pending messages. If it is stale (dead pid or > 45 min), delete it, log the steal in your tick output, and take it. **Watcher-fired ticks (AS-7/AS-15/AS-20):** a watcher-fired tick receives `watcher:<pid>` as this command's argument (the watcher spawns `claude -p '/advance watcher:<pid>'`). If the existing lock has `source: "watcher"` AND its `pid` matches the pid in that **argument** marker, that lock is YOUR lock — your parent watcher took it before spawning you. Proceed with the tick, and do NOT release it at tick end: the watcher releases its own lock in `settle()` when the tick exits. No env read is needed for this check — the argument is the contract (`ADVANCE_TICK_PARENT`, same `watcher:<pid>` format, is set as a belt for contexts where env is readable; headless ticks cannot read env vars). A lock with any other source or pid, or a watcher lock when no argument marker was given — end the tick as a no-op.
1. **Assess state.** Run `lattice list` across statuses, scan the `needs_human` queue, check `git status`/`git log` for sibling-agent work in flight (shared worktree discipline applies — never touch changes you can't attribute), and **sweep the chat inbox for unread messages** (read-only query of `apps/chat/data/chat.db` or the `chat` CLI) — messages are only delivered when someone reads them, so the sweep is how the company notices its mail.
2. **Pick ONE highest-leverage action**, in rough priority order:
   - An unread board-member (`human:*`) message addressed to an employee → spawn that employee to read their inbox and respond. **Ack first (CLAUDE.md norm):** the employee's first tool action after reading is a one-line reply saying what they'll do — before any Lattice writes, planning, or sub-agent work; the substantive follow-up reply comes after the work. Resulting work becomes Lattice tasks created by that employee (`--on-behalf-of human:forrest`); if a task already covers the request, they say so in their reply and reprioritize it if warranted.
   - A task in `review` → run the QA review stage (fresh-context QA employee) against the task branch diff (`git diff master...feat/AS-<n>-<slug>`). On pass: merge `--no-ff` into master, **then run the operational-records step: `./apps/chat/chat export`, and if it changed `apps/chat/data/export/`, commit those files to master as `records: chat export <YYYY-MM-DD>` (see Git Methodology, "Operational record commits") before pushing** — then push master, delete the branch, move to `done`.
   - A task `planned` or `in_progress` → run or continue the implementation stage, committing on the task branch.
   - A task in `in_planning` → run the planning stage: create `feat/AS-<n>-<slug>`, `lattice branch-link` it, commit the plan file on it.
   - Backlog has tasks but nothing in flight → pull the most important one into the lifecycle (`lattice next --claim`).
   - Backlog is empty → act as the cofounders: decide what the company needs next. Create engineering backlog tasks with decision context baked into descriptions, or advance non-engineering work (hiring, strategy, legal, marketing — recorded in `CLAUDE.md`/docs per the scope rules, never in Lattice).
   - The action requires a job title that doesn't exist → hire: write the personnel file under `personnel/`, record the hire date, MBTI, and resume per `CLAUDE.md`.
3. **Execute via employees.** Every action is performed by a named persona employee whose job title matches the work. Lifecycle stages get fresh-context sub-agents per the Employee Execution Model in `CLAUDE.md`. Every Lattice operation uses `--actor agent:<employee-id>`. Employees leave comments as they contribute.
4. **Follow the Git Methodology** (see `CLAUDE.md`): every commit is `AS-<n>: <summary>`, committed as the employee's git identity (`git -c user.name="<employee-id>" -c user.email="<employee-id>@agents.american-software.local"`), at stage boundaries, on the task branch. Master is always green — task work never commits to master directly; it arrives only via the `done` merge.
5. **End the tick clean.** Statuses truthful, breadcrumbs left, plan/notes files updated, stage work committed on the task branch, master green and pushed if a task merged. The next tick (possibly a different session) must be able to pick up from `.lattice/` state and `lattice branch-link` alone. Remove `apps/chat/data/advance.lock` if this tick created it — releasing the lock is part of ending the tick clean.

## Bounds

- One tick advances one task by one lifecycle stage, or performs one org-level action. Do not marathon multiple tasks in a single tick.
- Approval gates go to the board: purchases over $50, anything touching existing GitHub repos or Digital Ocean services, and genuine judgment calls → `lattice status <task> needs_human` plus a one-line `lattice comment` stating the need, then end the tick.
- Non-engineering work never gets Lattice tasks (see the Scope section of `CLAUDE.md`).
- If a task hits the 3-review-cycle limit, route it to `needs_human` — never `--force` past it.
- Force-push is always `needs_human`. Never rewrite pushed history autonomously.
- No worktrees while ticks are sequential. Only when two or more tasks are `in_progress` concurrently do implementers get isolated worktrees on their task branches — and even then, task claims and status transitions happen in the main checkout only.

## Running continuously

- `/loop /advance` — self-paced autonomous loop in a live session.
- `/schedule` — unattended ticks on a cron cadence via scheduled cloud agents.
- A single `/advance` — one manual tick, useful for supervised ramp-up.
- Message-triggered: the host watcher (`apps/chat/watch/`, AS-7) fires one tick when the board member posts in the chat app and no tick holds `apps/chat/data/advance.lock`.
