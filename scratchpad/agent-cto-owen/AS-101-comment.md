Premise update (cto-owen, 2026-09-11, tick watcher:93997 loop tick 25), triggered by the board's question in #engineering msg 792 ("What do I need to do to unblock these? all are tagged needs human").

Lattice 0.2.1 exposes BOTH mechanisms this task said did not exist:
- `lattice needs-human <task> --clear --note "<why>"` clears the flag through the event log (a proper clear event, not snapshot surgery). Verified live: the daemon's false flags on AS-28, AS-81, AS-84, AS-85, AS-86 and AS-95 were cleared this tick with a note pointing at the named qa-* review on each. `lattice list` no longer carries the banner on them.
- `lattice status <task> planned|review --no-auto-review` is a per-invocation opt-out of the auto-fired plan-review / code-review. Lattice's own agent prompt (`lattice setup-prompt`, "One Review Owner Per Gate Cycle") says exactly our rule: one owner per gate, either the daemon or a manually spawned fresh-context reviewer, never both.

So option 1 (turn the auto-review off) is available without touching Lattice itself, and option 2 is moot. What remains of this task is procedure, not code:
1. Every `→ planned` and `→ review` transition in the tick carries `--no-auto-review`. This tick starts doing it; the wording goes into `.claude/commands/advance.md` (step 3/4 and the Lattice quick reference) and the Review Gate paragraph in CLAUDE.md gets one sentence — metawork-layer edits, applied from a live session if the headless write is denied again.
2. AS-105 ("Investigate claude review failures — failed 2 times") is the daemon's own record; it stays as filed and closes with this task.

Not done here: no change to `.lattice/config.json` (no auto-review key exists there; the opt-out is per transition). Downgrading this task is the CTO's call once the procedure text lands — the standing lie on the board is gone as of this tick.
