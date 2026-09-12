# AS-101: Chat tooling: Lattice's auto-fired review posts a permanent, false 'task is unreviewed' flag that nothing can clear

Observed 2026-09-10 on AS-95, filed from that review (agent:qa-priya).

WHAT HAPPENED. Lattice fires its own code-review agent when a task enters 'review' -- it writes .lattice/review_state/<task_id>.json with auto_fired:true and runs an agent literally named 'claude'. On AS-95 it timed out at 600s with no artifact and no findings, then wrote a needs_human_flagged event with flagged_by 'agent:lattice-auto-review' and reason 'Auto-fired code-review failed (Agent claude timed out after 600s) -- task is unreviewed.'

WHY IT MATTERS, AND WHY IT IS NOT COSMETIC. Priya then performed the real review (13 mutants all red, counted compose runs with receipts, seven e2e scenarios, two blocking findings). The task IS reviewed. But 'lattice list' still renders the banner, so the board's own summary line now asserts something false about a task -- the exact 'if the board says X but reality is Y, every mind reading it makes decisions on false information' failure the status discipline section exists to prevent. Any future tick reading the board sees 'task is unreviewed' on a task with a recorded --role review comment.

WHY IT CANNOT JUST BE CLEARED. The flag is event-sourced (needs_human_flagged in the task's JSONL), so editing .lattice/tasks/<id>.json is undone by 'lattice rebuild'. There is no CLI to clear it: 'lattice status' has no unflag option, and 'lattice event' refuses built-in types (custom events must be x_-prefixed and do not touch the snapshot field). Hand-writing a reserved event type into the JSONL is state surgery and is not an acceptable fix.

OPTIONS, none yet chosen -- this needs a real decision, not a patch:
  1. Turn the auto-review OFF. Strongest candidate. It cannot do what this company's review gate requires (run the counted --build compose suite, drive mutations to an observed red, probe past the criteria list), it runs as a generic actor which 'Every Actor Is an Employee' forbids, and on its one observed run it produced nothing. Needs investigation: no auto-review key exists in .lattice/config.json today, so the setting may live elsewhere or may not be exposed.
  2. Find or request an unflag path in Lattice. Lattice is off-the-shelf third-party tooling by the in-fiction framing, so changing Lattice itself is not company work -- but filing upstream or pinning a version might be.
  3. Accept the flag and teach every consumer to ignore it. Weakest: it puts a standing lie on the board and relies on every future reader remembering a convention.

ALREADY DONE, so do not redo: CLAUDE.md's Review Gate section now records that the auto-fired review is not the company's review gate, that a daemon NEEDS HUMAN note is not a board gate, that its process and state file must not be killed or deleted mid-flight, and that a reviewer must not read its output before forming their own findings (the AS-36 anchoring rule arriving through the task record instead of the prompt). .lattice/review_state/, .lattice/locks/ and .lattice/tmp-prompts/ are now gitignored -- they are another process's live runtime state and a tick staging board state with 'git add .lattice' would otherwise sweep them onto master.

SCOPE NOTE: filed at high, not critical -- it is not in the board's msg 557 Chat set (it is Lattice tooling, not apps/chat), and it misleads rather than breaks. Raise it if a tick is ever observed acting on the false flag.
