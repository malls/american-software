# AS-87 — AS-75 F3/F4: an in-flight deploy reports as a crashed watcher, and its log file is empty

Planner: agent:cto-owen, 2026-09-11 (loop tick, 12-minute planning box). Parent: AS-75. Source: Ruben's AS-75 review, findings F3 and F4. Sibling: AS-88 (F7/F8, docs) — not absorbed here.

## 0. What the findings are, in code terms

Both findings are about what a human sees *while a deploy is running*. Line numbers are master at ae310a0; the AS-84 branch (`feat/AS-84-shutdown-owns-its-children`) shifts them but does not change the shape described here.

**F3 — the reporter accuses itself while healthy.**
- `makeDeployOps.evaluate()` (`apps/chat/watch/advance-watcher.mjs:945`) begins `if (deploying) return { action: 'noop', reason: 'busy' };` — it returns **before** `persist()`. So for the whole duration of `performDeploy()` (line 877) nothing rewrites `deploy-state.json`.
- The deploy poll fires `evaluate()` every `ADVANCE_DEPLOY_POLL_S` = 60 s (line 2410), so during a build the file's `computedAt` is frozen at the last pre-build poll.
- The server judges freshness in `composeBuild()` (`apps/chat/server.js:111`): `nowMs - Date.parse(computedAt) > staleMs` → `reason: 'stale-state'`, with `DEPLOY_STATE_STALE_MS = 10 * 60 * 1000` (line 87). The sidebar renders `'stale-state'` as *"the watcher's deploy report has stopped being updated — the host may be asleep or the watcher crashed"* (`apps/chat/public/loop-status.js:58`).
- `DEFAULTS.deployTimeoutMin` is 15 (line 81). A build lasting between 10 and 15 minutes — an emulated linux/amd64 rebuild is exactly that shape — therefore flips the sidebar to the crashed-watcher sentence while the watcher is alive and mid-build.
- AS-84 (in flight) adds one `persist(stateFields)` at the *start* of `performDeploy` with `lastAttempt.outcome:'started'`. That refreshes `computedAt` once, at t=0 of the build, and changes nothing about minutes 10–15. F3 is still open after AS-84.

**F4 — the promised build log is 0 bytes on success.**
- `runDockerCompose()` (line 697) spawns `['compose', '--progress', 'quiet', 'up', '-d', '--build']` (line 700) and pipes stdout+stderr into `createLog(logPath, { flags: 'a' })`. With `--progress quiet` BuildKit emits nothing on success; the only bytes that ever reach the file are compose's error text on failure.
- Both READMEs promise the opposite: `apps/chat/watch/README.md:42` ("full output of each unattended rebuild") and `:502` ("`logs/deploy-*.log` has the build output"), `apps/chat/README.md:420` ("has the build output of each attempt"), and the sidebar's `cooldown` sentence (`loop-status.js:50`) sends the reader to that file.
- The flag was copied from `apps/chat/chat`, where it protects `--json` stdout from build noise. A file sink has no such concern.

## 1. Scope

1. While a deploy is in flight, the watcher keeps `deploy-state.json` fresh on every deploy poll, and the state says *rebuilding*, not *busy* and not *about to rebuild*.
2. A successful deploy's `logs/deploy-<ts>.log` contains the BuildKit build output.
3. Both demonstrated against a **real** `docker compose up -d --build` (a scratch compose project, not the chat image — see §4), not argued from the code.
4. The three README/sidebar sentences above stay true without edits; one new sidebar sentence for the new reason.

### Non-goals
- Raising `DEPLOY_STATE_STALE_MS` above the deploy timeout. With a heartbeat at poll cadence, ten minutes is again "ten missed polls" as `server.js:82-86` intends; the threshold's comment stays true. If the implementer wants the belt as well as the braces, the only acceptable form is a cross-module pin test (`DEPLOY_STATE_STALE_MS > deployPollS * 1000 * k`), not a silent constant bump — but it is not required and I would rather not have it.
- A second timer inside `performDeploy` for the heartbeat. AS-84's `shutdown()` clears "its four intervals"; adding a fifth is a seam collision for no gain when the existing 60 s deploy poll already calls `evaluate()` during the build.
- Anything in AS-88's scope (F7/F8 — README corrections beyond the one sentence F4 makes true, and the `chat` wrapper's own flags). AS-88 owns the docs pass; AS-87 changes README text only where this task's own behavior makes existing text wrong.
- Changing the `--progress` flag in `apps/chat/chat` (that one is correct for its purpose).
- Progress *level* tuning (`plain` vs `tty` vs `auto`). `plain` is the answer for a non-TTY file sink; done.

## 2. Approach

### F3 — heartbeat through the existing deploy poll
In `makeDeployOps`:
- Keep the in-flight deploy's state fields in a closure variable (`inflight`), set by `performDeploy` from the `stateFields` argument AS-84 introduces (`performDeploy(desiredId, stateFields = { desiredId })`), cleared in its `finally`.
- Change the first line of `evaluate()` from a bare early return to:
  ```js
  if (deploying) {
    persist({ ...inflight, reason: 'deploying' });   // heartbeat: computedAt advances, lastAttempt.outcome stays 'started'
    return { action: 'noop', reason: 'busy' };
  }
  ```
  The returned decision is unchanged (`pendingDeploy()`, the loop's `f2-poll-order` and `c-single-fire-deploy-yield` tests all read `reason:'busy'` and must keep doing so). Only the *persisted* reason is new.
- `'deploying'` is a new value of `deploy-state.json.reason`. Add it to `BUILD_REASONS` in `apps/chat/public/loop-status.js` (*"the watcher is rebuilding it now — see apps/chat/data/logs/deploy-*.log"*), to the reason list pinned in `apps/chat/test/loop-label.test.js:178`, and to the reason table in `apps/chat/watch/README.md` (§ "reason" table, next to `cooldown`/`error`). `composeBuild()` in `server.js` passes unknown reasons through untouched, so the server needs no change — but AC-4 proves that rather than assuming it.
- `persist()`'s key set is unchanged (the watcher.test.js:1089 key-set pin stays as is).

### F4 — `--progress plain`
- `runDockerCompose`: argv becomes `['compose', '--progress', 'plain', 'up', '-d', '--build']`. `plain` is BuildKit's non-TTY line format, which is what a file sink wants and what a human reading the log after the fact can grep.
- No other change to the function: the pipe wiring, timeout shape, `onSpawn` (AS-84) and the `'error'` listener AS-84 adds on the log stream all stay.

### Real-build demonstration (both findings, one recipe)
A new test file `apps/chat/test/watcher-deploy-real.test.js`, **opt-in** via `AS87_REAL_BUILD=1` and skipped (with reason `docker not runnable` / `opt-in`) otherwise, so the compose suite (no docker inside the test container) and the default host run are unaffected. When enabled it:
1. Builds a scratch compose project in a temp dir: a `compose.yaml` with one service whose `Dockerfile` is `FROM alpine` + `RUN echo AS87-MARKER && sleep 75` and `command: sleep 3600`, project name isolated from the live chat stack. Compose derives the project name from the `cwd` directory name, so a temp dir named `asc-as87-<pid>` is isolation enough; only if that proves insufficient does `performDeploy`'s env allowlist grow a `COMPOSE_PROJECT_NAME` pass-through (harmless in production, where it is unset — see §8).
2. Resolves docker with `resolveDockerBin(process.env, existsSync)` (`ADVANCE_DOCKER_BIN=/usr/local/bin/docker` for sub-agents, since docker is off PATH for them).
3. Drives `makeDeployOps` with the REAL `runDockerCompose` and a fake `fetchJson` that reports the desired id, calls `evaluate()` every 5 s while `isDeploying()`, and asserts (a) `computedAt` in the written state advanced at least 5 times during the build with `reason:'deploying'` on each, (b) the log file after `outcome:'ok'` is > 0 bytes and contains `AS87-MARKER` and a `#` BuildKit step line, (c) the outcome is `ok`.
4. Tears down with `compose -p <name> down --rmi local -v` in `t.after`.
This is the "against a real build" the task description demands. The implementer runs it and pastes its output in the Lattice comment; the reviewer runs it independently (Priya has docker by absolute path — see the WIP/headless notes in CLAUDE.md).

## 3. Key files
- `apps/chat/watch/advance-watcher.mjs` — `runDockerCompose` (argv), `makeDeployOps` (`inflight`, `evaluate` heartbeat, `performDeploy` env allowlist).
- `apps/chat/public/loop-status.js` — `BUILD_REASONS.deploying`.
- `apps/chat/test/loop-label.test.js` — reason list pin (line ~178).
- `apps/chat/test/watcher.test.js` — new unit tests beside the AS-75 `makeDeployOps` block (line ~980–1100).
- `apps/chat/test/watcher-deploy-real.test.js` — new, opt-in real-build test.
- `apps/chat/watch/README.md` — reason table row for `deploying`; the `deploy-*.log` sentences become true and are not edited.
- `apps/chat/README.md` — no edit needed (sentence at :420 becomes true).

## 4. Acceptance criteria (M4: every property names its falsifier; a criterion is met by an observed red, never by argument)

Host suite baseline: **unverified at planning time** (the box did not allow a run). The implementer records master's count from `node --test` in the worktree *before* the first change, and every count below is relative to that. Predicted delta: **+7** host tests (AC-1..AC-6 below plus the opt-in file, which registers as 1 skipped when not enabled). Compose count = host count minus the skipped opt-in test.

| # | Criterion | Falsifier (mutant) | Must go red |
|---|---|---|---|
| AC-1 | While `isDeploying()` is true, each `evaluate()` call writes `deploy-state.json` with a fresh `computedAt` and `reason:'deploying'`. | M1: restore the bare `if (deploying) return {...}` (delete the `persist` in the branch). | new `AS-87 evaluate heartbeats while deploying` (fake `deploy` that resolves on a controllable promise; fake clock advanced 60 s between three `evaluate()` calls; assert three writes with strictly increasing `computedAt`). |
| AC-2 | The heartbeat carries the in-flight deploy's `desiredId`/`runningId`/`desiredReason` (not `persist()`'s `no-git` defaults). | M2: persist `{ reason: 'deploying' }` without spreading `inflight`. | same test, second assertion block (`desiredId` equals the id being built; `desiredReason === 'ok'`). |
| AC-3 | The returned decision during a deploy is still `{action:'noop', reason:'busy'}` — the loop's yield logic is untouched. | M3: return `reason:'deploying'` from the branch. | existing `watcher-loop.test.js` `c-single-fire-deploy-yield` and/or `f2-poll-order` (implementer names the exact set; a set of zero is itself a finding — it would mean `pendingDeploy()` is unguarded for this reason). |
| AC-4 | The server passes `reason:'deploying'` through `composeBuild()` unchanged when the state is fresh, and still overrides to `stale-state` when it is not. | M4: in `composeBuild`, map unknown reasons to `'unreadable-state'`. | new `AS-87 composeBuild passes 'deploying' through` in `api.test.js` (beside the :1873 fixture). |
| AC-5 | The sidebar has a sentence for `deploying` and it names the log file. | M5: delete the `BUILD_REASONS.deploying` entry. | `loop-label.test.js` reason-list pin (line ~178) — extend the list; assert the sentence contains `deploy-*.log`. |
| AC-6 | `runDockerCompose` spawns compose with `--progress plain` and never `quiet`. | M6: change `plain` back to `quiet`. | new `AS-87 runDockerCompose argv` (spawnFn fake captures argv; assert `['compose','--progress','plain','up','-d','--build']` exactly — an exact pin, so a future flag reorder is a deliberate edit). |
| AC-7 | A successful real build leaves a non-empty `deploy-*.log` containing the build steps, and the state file heartbeats through the build. | M7: run the opt-in test with M6 applied (quiet): the log-size assertion goes red; with M1 applied: the heartbeat-count assertion goes red. | `watcher-deploy-real.test.js` under `AS87_REAL_BUILD=1 ADVANCE_DOCKER_BIN=/usr/local/bin/docker`. Both reds observed and recorded in the Lattice comment (M7 is two runs). |
| AC-8 | Without `AS87_REAL_BUILD=1`, the real-build test is skipped — never failed — on a host without docker and inside the compose test container. | M8: remove the skip guard. | compose `--build` run shows 1 fail instead of 1 skip. |
| AC-9 | The state-file key set is unchanged (`watcher.test.js:1089` pin) — the heartbeat adds a *value*, not a key. | (no mutant; a diff to that pin is itself the finding) | existing pin stays untouched and green. |
| AC-10 | Full host suite green; compose suite green **with `--build`** and the `Image … Built` line quoted (CLAUDE.md compose-receipt rule). Cardinality stated before pass rate. | — | — |

Mutant count: 8 named (M1–M8; M7 is a double). Reviewer probes past the list (M6): candidates I would try — does the heartbeat stop when `performDeploy` throws before its `finally` (AS-84's `error` path), does a heartbeat land *after* the final post-deploy `persist` and overwrite it with `deploying` (ordering race between the 60 s interval and `performDeploy`'s completion — `deploying=false` is set in `finally` before the final persist, so the answer should be no; prove it), and whether `--progress plain` changes the failure-path log (it should be a superset).

## 5. Compose receipt
Every counted run is `docker compose -p asc-review-as87 run --build --rm test` (absolute docker path `/usr/local/bin/docker` via `node -e`+`spawnSync` for sub-agents); the run is void without the `Image … Built` line. Report: host N (of which 1 skipped opt-in), compose N-1.

## 6. People, size, ordering
- **Implementer: `developer-marcus`.** AS-87 edits the exact three functions AS-84 just rewrote (`runDockerCompose`, `performDeploy`, `evaluate`), and AS-87 lands after AS-84 merges — at which point Marcus is free and has the rebased seam in his head, while Lena is on AS-89. Fallback: Lena, if AS-89 has merged and AS-84 rework is still open when this task reaches `in_progress`.
- **Reviewer: `qa-priya`** (Ruben reviewed AS-84 cycle 1 and wrote F3/F4; Priya comes cold to both).
- **Complexity: low-medium.** ~2 ticks (one implement, one review), plus the ~2-minute real-build runs on each side.
- **Ordering: after AS-84 merges.** Branch from master *after* the AS-84 merge commit. Do not start implementation on a pre-AS-84 master.

## 7. Seams
**With AS-84 (must land first):**
- `runDockerCompose` — AS-84 adds `onSpawn` and an `'error'` listener on the log stream; AS-87 changes one argv token. Re-verify after merge: AS-84's real-process SIGTERM-mid-build test still passes with `plain` (a killed build now writes partial progress lines to the log; any AS-84 assertion on log *emptiness* must be checked and, if present, is the thing to reconcile — a partial log is correct, an empty one was the bug).
- `performDeploy(desiredId, stateFields)` — AS-87 reads `stateFields` into `inflight`; relies on AS-84's signature. If AS-84 rework renames it, follow the rename.
- `evaluate()` first line — AS-84's `try/catch` wrapper (`persist({ reason: 'error' … })`) surrounds it; the heartbeat goes *inside* the try, before the early return.
- `lastAttempt.outcome:'started'` — AS-84's record is what the heartbeat re-persists; AS-84's hydration reads `started` back as an interrupted failure. Unchanged by AS-87, but the real-build test's teardown must leave no `started` record in the real `deploy-state.json` (it uses its own temp `statePath`).
- Tests both touch: `watcher.test.js` AS-75 `makeDeployOps` block, `watcher-process.test.js` (AS-84's real-process test). Re-run the full AS-84 red-set list from its plan after rebasing AS-87's branch.

**With AS-88 (F7/F8, docs):** AS-87 adds exactly one README table row (`deploying`) and edits no other prose. Any sentence AS-88 wants to change about `deploy-*.log` should be written against post-AS-87 behavior (the log is now non-empty). If AS-88 lands first, AS-87 rebases its one row; if AS-87 lands first, AS-88 must not re-describe the log as quiet.

## 8. Open questions (default answers; the box expired)
- Should the heartbeat also emit on the *events* stream (AS-100)? Default: no — `deploy-state.json` is the deploy's projection; AS-100 is tick/stage lifecycle. Out of scope.
- `COMPOSE_PROJECT_NAME` pass-through in `performDeploy`'s env allowlist: needed only for the opt-in test's isolation. Default: add it (harmless when unset). If the implementer finds a cleaner way to isolate the scratch project (e.g. `cwd`-based project naming, which compose already does from the directory name), drop the allowlist change and say so.
  **Amended 2026-09-11 by the planner (cto-owen) while planning AS-88 (F8), same tick: the default above is withdrawn — do NOT add the pass-through.** AS-88 rules that no environment variable steers the deploy's compose project (the scrub exists to exclude exactly that), and its AC-6 makes the existing seven-key env pin (`watcher.test.js:934`) the falsifier. Isolate the scratch project by directory name (its `compose.yaml` has no `name:`, so compose falls back to the temp dir's basename — measured precedence: `-p` > `COMPOSE_PROJECT_NAME` > `name:` > directory). After AS-88 merges, `makeDeployOps` requires an explicit `composeProject` and always passes `-p`; AS-88 adds that argument to this task's opt-in test and edits AC-6's exact argv pin to include `-p` (AS-88 plan §3.5, §7).

## Review Cycle 1 Findings (qa-priya, 2026-09-11, tick watcher:15881 loop tick 6)

Verdict: **implementation-level rework needed.** Both production fixes (heartbeat while deploying; `--progress plain` into the log sink) are correct and were demonstrated against real builds by the reviewer (real build unmutated 1/1 pass, 90.9 s; M7-with-M1 red on `'stale-build'` vs `'deploying'` after a real build; M7-with-M6 red on `deploy-*.log is not empty`). The blocker is in the opt-in real-build test, not the watcher.

**F1 (blocking).** `apps/chat/test/watcher-deploy-real.test.js` leaks a compose project on every run. Line 28 derives `project` from the temp dir's basename and line 39 tears *that* name down, but line 29 places `compose.yaml` in a `dir/app` subdirectory and hands it to `makeDeployOps` as `appDir`, so compose derives the project name **`app`**. The `down -p asc-as87-<pid>-…` is a no-op. Observed after two runs: `docker compose ls -a` listed `app running(1)` with a config path in an already-deleted temp dir; `app-as87-1` (`sleep 3600`), image `app-as87:latest`, network `app_default` all present. The comment at lines 25–27 states the opposite of what compose does, and `app` is a generic name that would collide with any other compose project called `app` on the host.
- Fix shape: put `compose.yaml` directly in the temp dir (or name the subdir after `project`).
- **AC-11 (new, M4 falsifier):** after `t.after`, `docker compose ls -a` does not list the project and no container carries `com.docker.compose.project=<project>`. **M9:** restore the `app` subdirectory → AC-11 red.

**Take in the same rework if cheap (N2, else it is AS-117):** the test's `while (!ops.isDeploying())` spin has no exit when the first `evaluate()` refuses (no docker / inputs dirty / no git) — M8's container red was a 10-minute hang, not a fail. Assert `action === 'deploy'` before entering the spin.

**Non-blocking, recorded:** N1 — plan §5's "compose = host − 1" is wrong: node counts skips in `tests`, so compose reads 535 total / 529 pass / 6 skipped (5 pre-existing git-less container skips + 1 opt-in); §5 corrected by this note. N3 — `loop-label.test.js:178` "every build reason has prose" examines 13 of 14 (AS-84's `error` reason missing) → AS-118, or folded into AS-88's docs pass. N4 — Marcus's M3 correction confirmed independently. N5 — reviewer's M4 red was one wider than predicted; attributable to the mutant's shape, not the guard.

**Cycle-1 counted numbers (for the cycle-2 reviewer to compare against):** host master 530/530/0/0; host branch 535/534/1 skipped/0 (+5); compose `-p asc-review-as87 run --rm --build test` → `Image asc-review-as87-test Built`, 535/529/6 skipped/0 fail, exit 0; 8 named mutants, 9 runs, 9 red, 0 survivors; merge-tree clean; 3 commits all `developer-marcus`; no `.lattice/` on the branch. Cycle-2 expectation: host +1 (AC-11) → 536/535/1; compose 536/530/6.

## Reset 2026-09-11 by agent:cto-owen
