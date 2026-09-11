# Glossary

Terms this company's employees use in writing. Link this file instead of
re-explaining a term. Add a term when you catch yourself explaining it twice.

**Audience note.** Most of what follows is engineering shorthand, and it belongs
in Lattice comments, plan files, and `#engineering` — not in a message written to
the board. See CLAUDE.md § "Writing to the board".

## Work and scheduling

**Tick** — one run of `/advance`, the company's unit of work. A tick advances up
to three tasks by one lifecycle stage each, or performs one org-level action.

**Loop** — a run of ticks that continues until nothing is actionable. A board
message starts one (AS-95).

**Watcher** — the host process that fires a tick when the board member posts in
the chat app, and that deploys the chat app when master changes (AS-7, AS-75). A
tick fired by it is identified as `watcher:<pid>`.

**Lane** — one task in flight with one employee in its own worktree. Three lanes
is the WIP limit. Lanes are capacity, not territory: any developer can take any
lane.

**Worktree** — a second checkout of the repo at `.worktrees/AS-<n>/`, where a
task's code is written. The main checkout stays on master permanently.

**The Chat set** — the open tasks on the chat app and its tooling, scheduled
ahead of all product work by board directive of 2026-09-07.

**Single-flight lock** — `apps/chat/data/advance.lock`. One tick runs at a time;
a tick that finds a live lock ends as a no-op.

## Lifecycle

**Stage** — one step of the task lifecycle: planning, implementation, or review.
Each gets its own employee with fresh context.

**Ack** — the one-line reply an employee sends before starting work, so the
sender knows the message was heard.

**`needs_human`** — a task parked for a board decision, approval, or access.
Distinct from `blocked`, which is an ordinary external dependency.

**Rework cycle** — a task sent back from review to implementation or planning.
Three is the limit; the fourth is blocked and the task goes to the board.

**Safety valve** — that three-cycle limit.

**Fulfillment check** — the rule that finishing a task is not the same as
granting the request behind it. The merging tick performs the enabled act.

## Verification

**Acceptance criterion (AC)** — a numbered, checkable statement in a plan file of
what the finished work must do.

**Floor check** — walking the acceptance-criteria list and confirming each one.
Called a floor because passing every criterion is the minimum, not the review:
the criteria were written by the plan's author and inherit the plan's blind
spots.

**Finding** — something a reviewer found that the criteria did not ask about.
Reported before the floor check, never in place of it.

**Mutant** — a deliberate one-line break introduced into the code to prove a test
actually catches it. A **battery** is a set of them.

**Red set** — which tests failed under one mutant. An unexpected red set is
itself a finding, wider or narrower than predicted.

**Survivor** — a mutant no test caught. Either the test is weak, or the mutation
landed somewhere other than intended. Both must be ruled out before reporting.

**Site-anchored mutant** — one whose pattern can only match the intended line, so
a survivor cannot be explained by a misplaced edit.

**Vacuous pass** — a check that passed without examining anything: an empty set,
the wrong file, a metric moving with its own baseline. The reason mutants exist.

**Compose receipt** — a full test run on a freshly built container image
(`docker compose run --rm --build test`), quoted with the image-built line and
the test count. A run without `--build` can silently reuse a stale image, so a
number without a receipt is not a number.

**HOST suite** — the same tests run directly on the host rather than in the
container. Faster, and not a substitute for a receipt.

**Cardinality before quantification** — say how many things were examined before
saying how many passed. "10 of 10" means nothing until the reader knows whether
10 was the right denominator.

**Anchoring** — telling a reviewer the answer before they derive it. Invisible
afterward, so the only defense is not doing it.

## Git and deployment

**Two-plane rule** — board state (`.lattice/`) commits to master from the main
checkout; code commits to task branches in worktrees. The planes never mix.

**Board state** — the task tracker's own files: statuses, comments, plans.

**Merge seam** — the place two in-flight branches touch the same file.
`git merge-tree` checks whether they still merge cleanly.

**Records step** — the append-only chat-history export committed after a merge,
gated on the running container matching master.

**`runningId` / `desiredId`** — in `apps/chat/data/deploy-state.json`, the image
the chat container is running versus the one master wants. Unequal means the
deploy has not caught up yet.

## People and models

**Dossier** — an employee's record in `personnel/`, whose YAML frontmatter is the
single source of truth for the org chart.

**Class** — `cofounder`, `c-level`, `manager`, or `ic`. It governs who may spawn
sub-agents and who reports to whom.

**Assigned model** — the model an employee runs on by default, recorded in their
dossier. Falls back to Opus when that model hits a usage limit.
