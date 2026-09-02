# tools/lanes — parallel-lanes spike checkers (AS-60)

Executable ships-clean criteria for the WIP=2 lanes trial. Plan:
`.lattice/plans/task_01M1G81VZBHYQ235ZR18WS01RV.md` — §7 defines each
checker, §8 the falsification contract this directory's `test/` implements.
These are repo-level operating-loop tooling, not a product app.

Zero dependencies: `bash` (3.2-compatible; verified against the macOS
`/bin/bash` 3.2.57) + `node:*` builtins, host node >= 20. No package.json,
nothing to install.

## Output contract (every checker)

```
line 1:  examined <cardinality>          # what was examined, BEFORE any verdict
line 2:  PASS: <summary>  |  FAIL: <K> violation(s)
then:    "  - <item>: <reason>"          # one line per violation
```

Exit codes: `0` pass, `1` fail, `2` usage/environment error (message on
stderr). Cardinality before quantification is the house rule: a checker that
says PASS over an empty set says "examined 0" out loud, so a vacuous pass is
visible instead of silent. `compute-lane-metrics.mjs` additionally prints its
metric block after the PASS line.

All checkers take `--repo <path>` (default: the current directory) as the
FIRST argument pair; run them from the main checkout with explicit paths
(AS-26 discipline — never `cd` into a worktree to run board tooling). The
two `.mjs` checkers take `--events <dir>` (default: `.lattice/events` under
the cwd).

## Running the falsification suite

```
node --test 'tools/lanes/test/*.test.mjs'
```

Run from the repo root (main checkout or the spike worktree). Quote the glob
— node expands it itself, so the command is shell-agnostic.

Note: the plan (§8, §12, §15.1) writes this command as
`node --test tools/lanes/test/`. On host node >= 23 (this machine runs
24.13.1) a bare directory argument is no longer expanded to its test files —
node tries to load the directory as a module and the run fails. The quoted
glob is the equivalent, version-stable invocation; recorded as phase-1
deviation 1 in the AS-60 Lattice comments.

The suite generates every fixture as a scratch git repo under `mkdtemp`
(never the real repo, never a task worktree) and each test file asserts the
tree containing `tools/lanes/` is byte-identical (`git status --porcelain`)
before and after that file's tests — a suite that dirtied the real tree
fails itself. That guard has itself been shown failing (a deliberately
dirtying test in a scratch copy of this directory); the output is committed
with the falsification evidence.

## The checkers

| # | script | criterion (plan §7) |
|---|--------|---------------------|
| a | `check-branch-clean.sh [--repo R] <branch>` | no `.lattice/` path in `git diff --name-only master...<branch>` |
| b | `check-confinement.sh [--repo R] <branch> <config>` | diff paths all inside the task's `allowed_prefixes`; the task's worktree porcelain-clean; the main checkout porcelain-clean |
| b′ | `check-disjoint.sh [--repo R] <config>` | over every unordered pair of config tasks: prefix sets disjoint (string-prefix logic — `apps/` overlaps `apps/invoicing/`) AND changed-path sets disjoint |
| c | `check-event-integrity.mjs [--events D] [--window a..b]... [--ledger F] [--config F]` | per task: every `status_changed.from` equals the replayed state (seeded by `task_created`); every `assignment_changed.from` equals the replayed assignee (duplicate claim = from-mismatch); in-window comments on config tasks attributed per `expected_actors`; every in-window event has a ledger entry within 60s |
| d | `check-resume-preconditions.sh [--repo R] <task>` | status `in_progress` + `branch_linked` event + a worktree checked out on that branch + plan file real (non-scaffold) |
| e | `compute-lane-metrics.mjs --config F --ledger F [--events D]` | emits every §9.1 quantity with its source event ids; hard-errors on missing/ambiguous markers, ledger divergence > 60s, non-positive durations; asserts `savings == S0 − fanned` |
| f | `check-git-identity.sh [--repo R] <branch> <config>` | every commit in `master..<branch>`: `author.name` in the branch's `expected_authors` and email `<name>@agents.american-software.local` |

Semantics worth knowing before wiring a trial:

- **(b′) checks ALL pairs** of tasks in the config, not just the two lanes —
  the spike's own branch participates in the campaign, so its row belongs in
  the config and in the gate. Every configured branch must exist (exit 2
  otherwise; the gate runs after planning has created the branches).
- **(c) structural checks are whole-history** (replay in file APPEND order,
  not timestamp order — the append-only log is the authority); window checks
  apply only inside `--window` bounds (inclusive, repeatable — pass T1 and
  T2 to cover both). `--ledger` requires a window. Only files matching
  `task_*.jsonl` are read (`_lifecycle.jsonl` is not a task stream). The
  ledger match is time-only (any entry within ±60s): terse ledgers stay
  usable, and an injected stray event still has no neighbor. Baseline: the
  real log replays clean as of 2026-09-02 (574 events / 60 tasks), so a
  trial-time FAIL is trial-caused.
- **(d) preconditions are evaluated independently**: with no branch-link,
  the worktree check also fails ("no branch-link to match") — a cold
  resumer genuinely lacks both facts. The scaffold test mirrors the lattice
  CLI's `is_scaffold_plan` exactly (heading + verbatim description =
  scaffold; structural markdown or divergent text = real), because the CLI
  is what gates the real resume.
- **(e) applies no verdict thresholds.** The §9.2 rulers are applied in the
  result document; the tool only measures (plan §9.3). `S_real` is computed
  literally as plan §9.1 states it: S0 + the median of consecutive
  `status_changed` gaps company-wide in the 24h ending at `windows.T2.end`,
  gaps >= 60 min excluded; the exact filter is printed with the number.
  With zero qualifying gaps it prints `S_real = n/a` and still passes
  (context metric, never the verdict input).

## trial-config.json (the coupling contract)

Written by the trial orchestrator at setup (plan §6.0.4); consumed by
checkers b, b′, c, e, f. Shape:

```json
{
  "windows": {
    "T1": { "start": "2026-09-03T18:00:00Z", "end": "2026-09-03T19:10:00Z" },
    "T2": { "start": "2026-09-03T21:00:00Z", "end": "2026-09-03T21:40:00Z" }
  },
  "tasks": {
    "AS-41": {
      "task_id": "task_01M1D34NAX4QTQ3HMJ7P5EBGK9",
      "branch": "feat/AS-41-stripe-onboarding",
      "worktree": ".worktrees/AS-41",
      "allowed_prefixes": ["apps/invoicing/"],
      "expected_authors": ["developer-marcus"],
      "expected_actors": ["agent:developer-marcus", "agent:cto-owen"],
      "lane": "A"
    },
    "AS-34": { "…": "lane B, apps/chat/ prefixes, developer-lena" },
    "AS-60": { "…": "no lane; tools/lanes/ + docs/engineering/ prefixes" }
  }
}
```

Field use per checker: (b)/(f) look a task up by `branch`; (b′) uses
`branch` + `allowed_prefixes` of every task; (c) attribution uses `task_id`
+ `expected_actors` (tasks missing either simply aren't attribution-checked
— the cardinality line reports how many were); (e) uses `windows` plus the
two tasks with `"lane": "A"` / `"lane": "B"` (each needs `task_id`).
`worktree` paths are resolved relative to `--repo` unless absolute. Prefixes
are plain string prefixes — end them with `/`.

Window placeholders may be null/absent until recorded; (e) exits 2 until
both windows carry real timestamps (never measures a half-recorded trial).

## Ledger and marker grammar

Ledger: JSONL, one `{ts, actor, cmd, note}` per board mutation (plan §5.2);
`ts` ISO-8601. Only `ts` is used by the cross-checks (see (c) note above).

Markers (e): comments on the lane tasks whose body STARTS WITH, exactly:

```
lanes-trial: lane spawned     -> tA_spawn / tB_spawn / tA2_spawn
lanes-trial: lane killed      -> tA_kill
lanes-trial: lane returned    -> tB_return / tA2_return
```

scoped by lane task and window (T1: spawn/kill/spawn/return of the fan;
T2: the resume pair). Anything after the prefix is free text. Exactly one
match per marker — zero or several is a hard FAIL, never a guess. Ledger
each marker within 60s of posting it or (e) will refuse the measurement.

## Falsification recipe index (plan §8)

Every checker was shown FAILING against a planted violation before any green
is trusted; each test asserts the plant applied, predicts the exact failing
set (items, messages, exit code) before running, and requires the observed
set to match — wider or narrower is a test failure. Clean twins pin the PASS
cardinality lines. Evidence: `docs/engineering/03-parallel-lanes-spike/evidence/falsification/`.

| checker | suite | planted violations |
|---------|-------|--------------------|
| a | `test/check-branch-clean.test.mjs` | committed `.lattice/events/` file on a task branch |
| b | `test/check-confinement.test.mjs` | out-of-prefix commit; dirty worktree; dirty main checkout |
| b′ | `test/check-disjoint.test.mjs` | overlapping prefix sets; one file touched by both branches |
| c | `test/check-event-integrity.test.mjs` | corrupted from-state; duplicate claim (from=null while held); in-window event with nearest ledger entry 90s away; in-window comment by an unexpected actor |
| d | `test/check-resume-preconditions.test.mjs` | branch_linked event removed (predicted failing set: branch-link AND worktree); scaffold-shaped plan |
| e | `test/compute-lane-metrics.test.mjs` | missing spawn marker (must error, never fabricate); ledger divergence 90s; plus two hand-computed trials the script must reproduce exactly (R = 0.6 and R = 0.4 — one on each side of the §9.2 threshold) |
| f | `test/check-git-identity.test.mjs` | commit authored `developer-marcus-webb` (the AS-53 drift); canonical name with non-canonical email |

`test/fixture.mjs` is the generator: mkdtemp git repos with synthetic
`.lattice/events/*.jsonl` in the real event envelope, isolated from user git
config (`GIT_CONFIG_GLOBAL/SYSTEM=/dev/null`), torn down per test.
