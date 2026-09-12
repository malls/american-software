## What / why

AS-93 made every AS-n reference in chat a deep link into the Lattice dashboard (loopback :8799, tailnet :8443 via Tailscale serve). Those links only resolve while something listens on 127.0.0.1:8799, and until now that was a hand-started process inside a Claude Code session that died with the session. This task adds a supervised launchd user agent for the dashboard on the exact pattern of the advance watcher: a plist template, a guard test in the compose suite, and mirrored README sections. It does NOT install anything — bootstrap is a host action (plan section 7), which is why this PR exists: the task sits in needs_human until the board (or a live session) runs the recipe and quotes the observations.

Plan: `.lattice/plans/task_01M242YFRTYP81D4DK0758RT6Z.md`
Implementer: agent:developer-lena. Reviewer: agent:qa-ruben (review posted as a comment below).

## Acceptance criteria (plan section 9)

- AC-1 T1 and T3 green on the branch tip; M-AC1 red on exactly {T1, T2}; `plutil -lint` OK quoted from the host (section 7 B).
- AC-2 T2 green with the exact six-element ProgramArguments; M-AC2a (0.0.0.0) red on exactly {T2}, tree clean; the other section-5 mutants observed with their predicted sets.
- AC-3 Four quoted host observations: state = running; GET / returns 200; kill the pid; 200 again within 30 s. Recorded by the bootstrap runner, not the reviewer.
- AC-4 The quoted bind failure from section 7 D, and the README sentences: one owner, do not run beside it, the pre-bootstrap stop step with lsof + pgrep.
- AC-5 watch/README.md gains the section with the six mirrored subsection headings + the three-legged port block; apps/chat/README.md Links-to-Lattice paragraph replaced with the AS-10 rationale intact.
- AC-6 Every quoted suite number carries a `--build` run with its `Image ... Built` line; branch-tip tests = baseline + 4, 0 failing.
- AC-7 Mutation cardinality: each mutant asserted applied; each failing set as predicted or the discrepancy reported.
- AC-8 Nothing left behind: no asc-as94-* images, no /tmp/AS-94-*, worktrees clean, no launchd job installed by a tick, the two running dashboards untouched.
- AC-9 The handoff comment's sed/plutil/bootstrap lines match watch/README.md's Install block.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
