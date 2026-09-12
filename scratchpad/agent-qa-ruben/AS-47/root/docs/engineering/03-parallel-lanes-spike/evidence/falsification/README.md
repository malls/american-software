# AS-60 phase-1 falsification evidence

Standing, re-runnable proof that every lanes checker was seen FAILING against
a planted violation before any trial-time green is trusted (plan §8; the
recipe index and per-checker semantics live in `tools/lanes/README.md`).

- `node-test-phase1.txt` — the canonical suite run:
  `node --test 'tools/lanes/test/*.test.mjs'` from the spike worktree root,
  24/24 pass, node v24.13.1, 2026-09-02, tree at commit 1744077
  (`AS-60: tools/lanes README`). Each planted violation produced exactly its
  predicted failing set (items, messages, exit code 1); each clean twin
  passed with its exact predicted cardinality line; each test file asserted
  the real tree byte-identical before/after.
- `tree-guard-falsification.txt` — the suite's own real-tree guard, seen
  failing: a deliberately dirtying test in a scratch COPY of the tree (never
  the task worktree) trips the §8.4 porcelain assertion, exit 1. Includes
  the throwaway test's source and the scratch tree's porcelain proving the
  plant applied.

To regenerate: re-run the commands above; the suite is deterministic apart
from timing lines. Phase-2 note: `check-event-integrity.mjs` run structural-
only over the REAL event log on 2026-09-02 reported
`examined 574 event(s) / 60 task(s) / 0 in-window — PASS`, so the trial
starts from a clean baseline and any trial-time FAIL is trial-caused.
