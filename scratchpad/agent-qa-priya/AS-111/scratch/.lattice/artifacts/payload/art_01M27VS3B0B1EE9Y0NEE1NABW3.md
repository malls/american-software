Lattice-Reviewed-Commit: 9f0fa121d18af07c5a81bc6b60b1d78f9f2c2b69

# Code Review: AS-83 — `feat/AS-83-probe-budget` (060c7dd, 3 commits over master)

> Provenance: this is the Lattice auto-fired review artifact (third-party tooling output). Per `CLAUDE.md` it is **not** the company's review gate — that is `qa-ruben`'s `--role review` comment. Nothing here should anchor his review; he should form his own findings before reading this.

### 1. Verdict

**PASS** — the implementation matches the plan, the AS-24 mode boundary is provably intact under the wider budget (M1/M2/M3 each killed with exactly the predicted sets on independent scratch copies), and the three findings below are minor hardening items that do not need a rework cycle.

### 2. Summary

Reviewed the four-file diff (`lib/client.js`, `bin/chat.js`, `test/mode.test.js`, `README.md`) against the plan's §3 approach and §7 criteria, ran the host suite in the worktree, and re-ran mutations M1–M3 myself on throwaway copies of the worktree (never in place). Quality is high: the probe now returns `{ state, reason }` with a timeout that can only ever be `'ambiguous'`, the budget is a validated knob with a single exported literal, the flake is pinned as a deterministic slow-but-live-server case, and every exit-status assertion in the file now names its exit path. Key finding: the knob's validator accepts any digit string, but Node's timers only accept up to `2147483647` ms, so absurd budgets are mis-reported rather than rejected — fail-closed, so not a boundary breach.

What I ran (cardinality before quantification):

| Check | Result |
|---|---|
| `node --test test/mode.test.js` (host, worktree) | 13 cases, 13 pass, 0 fail |
| `node --test` (host, worktree) | 484 tests, 484 pass, 0 fail (plan AC-11 predicted 484) |
| AC-1 greps | `status, 0, describeExit` = 18, `status, 0, ` = 18 |
| AC-3 grep `500\|3000` in `lib/client.js` | one line: `DEFAULT_PROBE_TIMEOUT_MS = 3000` |
| AC-2 grep `timed out after` in `lib/client.js` | one template |
| Other `probe(` callers expecting the old string return | none (the `probe` hits in `test/api.test.js`, `test/cli.test.js`, `test/store.test.js` are unrelated local helpers; the watcher has its own `probeRunning`) |
| M1 (rule-3 `'up'` → direct backend), scratch copy, anchored, assert-applied (2× `createDirectBackend(db \|\| DEFAULT_DB)`, 0× `createApiBackend(` in the rule-3 slice) | red exactly {AS-24 case, T2, full sweep}; AS-24 case and T2 fail at the `view.status === 200` server-view assertion (`mode.test.js:185`, `:288`), not at a timeout |
| M2 (timeout → `'down'`), scratch copy, assert-applied (0× `isConnDown(e)` in `probe` body, 1 definition) | red exactly {trap case, T1} |
| M3 (`probeBudget()` replaced by the default), scratch copy, assert-applied (0× `probeBudget()` in `resolveBackend`) | red exactly {T1, T3} |
| `git status --porcelain` in the worktree after all runs | empty |

Not repeated here: the counted compose run, R1/R2 under load, and M4 (the in-container budget-500 mutant). A `docker compose build` from this review is the flake condition for the other two lanes' counted runs this tick, so those belong to the QA gate's own scheduling. Note for whoever takes the compose count: master has moved since the plan (AS-73 merged; the AS-74 lane reports host 486 on master), so the post-merge expectation is 490, not 484 — the implementer's comment already says this.

### 3. Issues

**[MINOR] apps/chat/bin/chat.js:126–131 — `probeBudget` accepts budgets Node's timers cannot honour**
`/^\d+$/` plus `ms > 0` admits any positive integer, but `AbortSignal.timeout` (like `setTimeout`) is bounded at `2147483647` ms. Observed through the CLI against a port with nothing listening (`CHAT_API=http://127.0.0.1:1`, which should be `'down'` → direct mode → exit 0):
```
CHAT_PROBE_TIMEOUT_MS=2147483648  → TimeoutOverflowWarning, timer set to 1 ms → refusal "(fetch failed)", exit 1
CHAT_PROBE_TIMEOUT_MS=4294967296  → ERR_OUT_OF_RANGE thrown inside the try  → refusal "(ERR_OUT_OF_RANGE)", exit 1
```
Both fail closed (no DB touched), so the AS-24 boundary holds, but the validator's stated contract ("a positive integer of milliseconds") is wider than what works, and the refusal blames the server for an operator typo — exactly the mislabelled exit path AS-83 exists to remove.
**Fix:** bound the check (`ms > 0 && ms <= 2147483647`) and name the ceiling in the usage error; add `'2147483648'` to T3's bad-value loop so the ceiling is pinned.

**[MINOR] apps/chat/test/mode.test.js:243 — T1's `elapsedMs < 2000` reintroduces a wall-clock assertion under load**
The point of T1 is that the child *chose* to exit on its 50 ms budget, which `assert.match(r.stderr, /timed out after 50 ms/)` already proves. The elapsed bound adds a second, load-sensitive condition: on emulated linux/amd64 under a concurrent build the observed per-spawn cost was ≈ 700 ms for node start-up alone, and the plan's own timing model puts the failing child at ≈ 1.2–1.3 s. A 2 s ceiling leaves margin, but it is the same category of assertion this task was filed to remove, in the same file, on the same runner.
**Fix:** either drop the bound (the `timed out after 50 ms` match is the falsifier that matters) or loosen it to something that can only fail on a genuine hang, e.g. `r.elapsedMs < DEFAULT_PROBE_TIMEOUT_MS` (proves it did not spend the *default* budget) or a flat 10 s.

**[MINOR] apps/chat/test/mode.test.js:292–316 — T3 claims "on every path" but only exercises rule 4**
`probeBudget()` is called before the `CHAT_MODE=direct` short-circuit, which is what the docstring promises, but T3 spawns only with `CHAT_DB` alone. A mutant that moves the `probeBudget()` call below `if (db) return createDirectBackend(db)` would keep T1/T2 green and T3 green too, so the "validated even where it never probes" property is only half pinned.
**Fix:** add one spawn in T3 with `CHAT_MODE: 'direct'`, `CHAT_DB: phantom`, `CHAT_PROBE_TIMEOUT_MS: 'abc'` and assert the same usage error and `assertNoDbTouched`.

**[MINOR] apps/chat/test/mode.test.js (14 sites, e.g. :175, :199, :207) — mixed quote style in `describeExit` labels**
The bulk-replaced call sites use double-quoted labels (`describeExit(dm, "dm")`) while the hand-written ones and the rest of the file use single quotes. Trivia; a QA reviewer may fix inline.

### 4. Positive Observations

- **The boundary argument is made structurally, then proven by mutation.** The comment on `DEFAULT_PROBE_TIMEOUT_MS` states *why* a wider budget cannot mask a mode regression (no value turns `'ambiguous'` into `'down'`), and M1/M2 turn that sentence into observed reds at the exact sites predicted. M1's failures land at the server-view assertion, not a timeout — the task's acceptance sentence, satisfied literally.
- **The flake is pinned as a deterministic pair, not a race.** `slowProxy` makes a genuinely live server slow by a fixed 150 ms, and T1/T2 differ only in the budget. That is the flake written down, and it avoids the "1 ms budget against a fast loopback" trap the plan called out. Teardown tracks sockets *and* pending timers, so a refused probe whose upstream connect fires after the child exits cannot wedge `close()`.
- **Legibility landed first and everywhere.** `run()` now returns `signal` and `elapsedMs`; all 18 status-0 assertions route through `describeExit`, and T4 covers the signal-kill shape (`exit null signal SIGKILL`) that no previous sighting could have seen.
- **The knob is hermetic in the suite.** `run()` scrubs `CHAT_PROBE_TIMEOUT_MS` from the inherited environment, the up-path cases pin `'20000'` through a single `apiEnv` occurrence (a clean M4 anchor), and the trap case deliberately sets nothing so the production default is observed by one test, via the imported constant rather than a duplicated literal.
- **`errCode` reuses `isConnDown`'s cause-chain walk** rather than inventing a second traversal, and the reasons are appended to the existing refusal text so the four pre-existing regex assertions keep matching without edits.
- **Scope discipline held:** the diff touches exactly the four files the plan names; no `.lattice/`, compose, Dockerfile, package or top-level markdown changes, and the worktree is clean after every run.
