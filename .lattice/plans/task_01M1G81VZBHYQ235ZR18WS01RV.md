# AS-60: advance loop spike: parallel implementer lanes — WIP>1 under a single board writer

Spike: prove (or refute) that the advance loop can hold WIP=2 — two tasks occupying active stages concurrently, two implementer sub-agents in two worktrees under ONE tick and ONE orchestrator — without corrupting board state. Filed per docs/strategy/11-second-developer-decision.md §4 and §9.7 (priority raised medium→high there: at ~88% line utilization with a 4-wide D1 ready queue, WIP is the only throughput term left in throughput ≈ WIP ÷ cycle-time; at ~30 remaining D1 stage-lifecycles, lanes break even inside their first day). §9.8 makes THIS TASK'S WRITTEN RESULT the next re-decision point — pair retention (developer-lena / qa-ruben, hired 2026-09-02) is re-taken against it if the spike fails — so the result must be decision-grade in either direction.

WHAT THE SPIKE MUST ANSWER
1. Can two tasks hold active stages concurrently with zero board-state corruption? (Corruption is defined checkably under SHIPS CLEAN below — not vibes.)
2. What exactly must change, delivered as concrete diffs/wording, in:
   (a) .claude/commands/advance.md — step 0's lock protocol and the Bounds section ("one tick advances one task by one lifecycle stage" is one of the two mechanisms pinning WIP=1; the single-flight lock is the other, and the lock STAYS);
   (b) CLAUDE.md Operating Modes + Git Methodology worktree/concurrency rules — metawork: the spike DELIVERS exact proposed wording, the metawork layer applies it, employees never edit those files;
   (c) the Employee Execution Model's board-write ownership. Under lanes, implementer sub-agents are forbidden to touch .lattice/ entirely; the orchestrator becomes the SOLE board writer, serializing every .lattice/ mutation and every master commit. Today employees post their own Lattice comments, so the spike must design the relay — likely: sub-agents hand back breadcrumb text, the orchestrator executes the write attributed to the authoring employee (consistent with CLAUDE.md: attribution follows authorship of the decision, not the keystroke). Validate it, do not assume it.
3. Tick-duration budget. Watcher-fired ticks are SIGTERMed at 30 min (tickTimeoutMin, apps/chat/watch/advance-watcher.mjs), the lock heartbeat obligation is a rewrite every 30 min, staleness is 45. D1-scale implementation stages have run 70–381 min. Does a fanned tick fit any watcher budget at all, or are lanes live-loop/manual-session-only at first? Answer explicitly; if timeout numbers change, that is watcher config + launchd plist — a board-visible ops change, not a silent constant edit.
4. Does the fan pay? Measure the fanned trial's wall clock against the same two stages run serially. The complexity is justified only if the number says so.

INVARIANTS THE SPIKE MUST NOT BREAK (design constraints, not suggestions)
- Task claims and status transitions happen in the MAIN checkout only; the main checkout never leaves master (two-plane rule).
- Task branches carry code only — zero .lattice/ writes on any task branch, ever.
- One worktree per in-flight task; one agent per task at a time. Lanes mean more tasks in flight, never more agents on one task.
- The single-flight lock stays. Lanes live UNDER one lock-holding tick. The watcher's lock/nonce contract (source+pid+nonce adoption in step 0, settle() release, nonce-blind staleness) is unchanged unless the spike names the change precisely and argues why it is safe.
- Per the watcher README: the lock is etiquette, not a correctness invariant. Correctness must live in Lattice claims plus main-checkout serialization, and the spike proves that it does.

FAILURE MODES ALREADY LIVED — the spike's job is to prove lanes cannot resurrect them
- AS-26 working-directory hazard (CLAUDE.md, Git Methodology): a cd into a worktree silently redirected lattice writes onto the task branch, and every read afterward looked correct. Two concurrent sub-agents double the exposure and the failure is silent — this is WHY the sole-board-writer design exists.
- 2026-08-31 duplicate CEO scoring pass (docs/strategy/04-scores-ceo.md, Drafting record): the single-flight lock was installed after concurrency cost us duplicated work once. We are generalizing a safety property born from a lived incident; the failure gets looked for, not assumed away.
- AS-24 WAL divergence + orphan message 161: two writers holding different views of one store, each locally self-consistent. The lanes topology (main-checkout .lattice/ vs N worktree copies of it) is the same shape in git; the two-plane rule is the mitigation, and the spike stress-tests it rather than trusting it.
- AS-26 rework cycle 2 (rate-limited implementer terminated mid-cycle, half-applied change left on disk): under lanes, a dying tick leaves TWO half-states. Resumability is an acceptance criterion below, demonstrated by killing a lane — not argued.

SHIPS CLEAN — the written result (docs/engineering/) must show pass/fail per criterion, with evidence:
(a) zero .lattice/ paths in git diff master...branch for BOTH trial branches;
(b) each worktree's diff confined to its own task's files; both worktrees and the main checkout clean at trial end;
(c) event-log integrity: every transition's from-state correct, no duplicate claims, comments attributed to their authoring employees;
(d) kill-one-lane resumability: a next tick resumes from .lattice/ state + lattice branch-link alone, and the surviving lane is unharmed;
(e) measured wall clock, fanned vs serial baseline;
(f) correct per-employee git identity on both branches.
Checker discipline per CLAUDE.md (AS-37/AS-53): every checker behind (a)–(c) must first be shown FAILING against a deliberately planted violation (scratch copy, never the task worktrees). A spike whose verdict gates a §9.8 decision does not rest on a green that was never seen red.

FIRST MEASURED PAIR (pre-agreed, record §9.5.3): Marcus on AS-41 (D1, Stripe Connect onboarding) + Lena on AS-34 (chat, /api/file symlink audit) — one D1 task + one chat task, maximally DISJOINT: different apps, zero shared files. Disjointness, not throughput, is the point of trial one: it isolates loop mechanics from merge mechanics while the lanes machinery is unproven, so any anomaly indicts the loop, not a merge seam. (It also happens to deliver the board's literal "one on chat, one on invoicing" on day one.) D1+D1 pairs — known edge contention: server route registration — come only after the disjoint trial ships clean, gated by a file-disjointness check on the concurrent pair. If the queue moves before the trial runs (e.g. AS-41 completes in the interleaved WIP=1 loop), substitute equivalents: the invariant is one-D1 + one-chat, maximally disjoint; the specific ids are the current instance.

§9.8 MEASUREMENT OBLIGATION (carried here so it cannot get lost): after lanes ship, the record-11 §3 overlap query must show a non-zero overlapping-pair count within one day OF RUNNING LOOP — and a count that stays 0 is itself a finding, returned to docs/strategy/11-second-developer-decision.md as a dated addendum. Clock discipline (the unstated-window defect is the §9.4(a) class; we are not writing another one): the one-day clock runs in loop-time, and a zero must be attributed — machinery-unused-at-dead-cadence is a cadence finding (rider §9.6.1), machinery-unused-despite-ticks is a lanes finding.

WHAT THIS TASK IS NOT
- It is NOT the lanes feature shipping. The deliverable is the written result + a proven prototype diff + exact proposed metawork wording. The production loop change is a SEPARATE follow-up task, filed by this spike only if the result says yes AND the board has had its veto window: the written result goes to #board before any Bounds/Operating-Modes wording changes, and silence is not treated as enthusiasm (record §4). Why the split: §9.8 makes the written result a re-decision input, and a decision point wants a completed artifact, not a task paused mid-lifecycle; the board's veto gate sits BETWEEN tasks, not inside one; and the experiment report and the production machinery change deserve separate reviews.
- It does not preempt the hires (already executed, record §9.1), does not touch running containers or the live watcher install, and runs under the CURRENT WIP=1 rules like any other task.
