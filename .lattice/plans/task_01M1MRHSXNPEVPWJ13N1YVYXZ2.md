# AS-82: Chat watcher: the AS-27 heartbeat call site is unexercised — main() is never run by the suite

Planner: agent:cto-owen (tech lead), 2026-09-11. Complexity: **medium** — a ~350-line move
of production infrastructure with a behaviour-preservation obligation, plus a new test
harness; no new logic, no new dependencies.

Branch `feat/AS-82-watcher-main-under-test`, worktree `.worktrees/AS-82`.
Implementer: `developer-marcus` (he lifted `makeLoopOps` out of `main()` for exactly this
reason on AS-95 cycle 1, finding F7, and the "assert the mutation landed at the intended
site" rule is his lesson); `developer-lena` if Marcus is on AS-73/AS-81.
Reviewer: `qa-ruben` — Priya filed this from her AS-27 review, so the independent eye is Ruben.

## 1. Problem, in one paragraph

`apps/chat/watch/advance-watcher.mjs` is five injectable factories plus a `main()` of
~400 lines that nothing executes under test (the entry guard at the bottom of the file
only calls it when the file is run directly). Everything wired inside `main()` is therefore
unguarded: the AS-27 heartbeat call in `poll()` (Priya's M3b deleted it, 255 tests stayed
green), the lock take in `fire()` and release in `settle()`, the `spawn` call site that
passes `tickArgv()`/`tickChildEnv()` (the AS-21 argv handoff — the *functions* are pinned,
the *call site* that passes `config.permissionMode` and `rules ?? undefined` is not), the
highwater write, the AS-100 `tickStarted`/`tickEnded` calls, the timeout timers, and
`shutdown()`. The consequence Priya named is exact: the green suite is not evidence that the
loop-status indicator will ever leave "Off".

## 2. Direction: (a) extract, with one (b)-shaped smoke test for the residue

The task leaves two directions open. **(a)** extract the poll body into an exported,
injectable unit; **(b)** stand up a short-lived real watcher process against a temp data
dir. The trade-off: (a) is the file's own established pattern (five factories already:
`makeLockOps`, `makeDeployOps`, `makeLoopOps`, `makeLanesOps`, `makeEventsOps`, each with a
harness in the suite), it is deterministic (no timing, no ports, no child processes), and
it is the only direction that puts the lock take/release, the spawn argv/env call site, the
highwater write, the settle ordering, and the timeout path under test with fakes — which is
the task's stated preference. Its residue is the ~40 lines `main()` keeps (config, paths,
log, the entry guard, signal handlers) and the fact that the real `setInterval` never runs
under test — precisely the heartbeat-liveness property F3 is about. (b) covers that residue
and nothing else well: it cannot fake `claude`, cannot observe lock/argv/ordering without a
fake binary and timing, and every assertion is a deadline. **Decision: (a) is the
mechanism; one bounded (b)-shaped smoke test covers the residue** — the real entry point,
against a temp dir, no sentinel so it never fires, asserting only that `heartbeatAt`
advances on its own interval and that SIGTERM removes the pid file with exit 0. Two
independent detectors then cover the headline mutation; the smoke test needs no fake
`claude` and touches nothing live.

Runtime behaviour does not change. This task changes *where the code lives and what is
injectable*, not what it does; §6 says how that is proven.

## 3. The change

### 3.1 `export function makeWatcher({...})` — new factory, beside the other five

Place it after `makeEventsOps` and before `main()`. Signature (every default is the value
`main()` uses today; nothing is read from `process` inside the factory except via these
defaults):

```js
export function makeWatcher({
  config,        // loadConfig() result
  paths,         // { sentinel, highwater, lock, pid, settings, deployState, loopState, worktrees, events }
  logsDir,
  watchDir,      // main(): dirname(fileURLToPath(import.meta.url))
  log,
  pid = process.pid,
  isPidAlive = pidAlive,
  now = () => Date.now(),
  spawnFn = spawn,
  createLog = createWriteStream,
  exit = (code) => process.exit(code),
  // Optional overrides. When absent, start() builds each one exactly as main() does today,
  // in today's order, from the args above (threading pid / isPidAlive / now through).
  lockOps, loopOps, deployOps, lanesOps, eventsOps,
})
```

Returns `{ start, poll, fire, shutdown, readSentinel, hasChild: () => child !== null,
ops: () => ({ lock, loop, deploy, lanes, events }) }`.

**`start()`** performs, in today's order, everything `main()` does after the `log` closure:
the single-instance check (`readJson(paths.pid)` + `isPidAlive`, `FATAL` log, `exit(1)`),
the startup `writeWatcherPid` (unguarded, as today), construction of the five ops
(`lock`, `loop`, `deploy`, `lanes`, `events` — `events` after `deploy` because it borrows
`deploy.lockIsBusy`), the `DEPLOY-POLL` / `LANES-POLL` / `EVENTS-SWEEP` log lines, the
three unref'd intervals, the lanes first snapshot, the `START` line, `loopOps.resume()`,
the poll interval (not unref'd, as today), and the immediate `poll()`. Building the ops
inside `start()` rather than at factory-call time is deliberate: it keeps the sequence of
side effects byte-for-byte what `main()` produces today (the deploy factory reads the watch
dir and probes docker candidates at construction; that must still happen *after* the
single-instance check, not before).

**`poll()`, `fire()`, `settle()` (inside `fire`), `shutdown(signal)`, `readSentinel()`,
`pruneTickLogs()`** move verbatim into the factory closure with **only** these mechanical
substitutions, each applied everywhere it occurs inside the moved code and nowhere else:

| today | in the factory |
|---|---|
| `process.pid` | `pid` |
| `pidAlive(` | `isPidAlive(` |
| `spawn(` (the tick spawn) | `spawnFn(` |
| `createWriteStream(` | `createLog(` |
| `process.exit(` | `exit(` |
| `Date.now()` | `now()` |
| `new Date()` | `new Date(now())` |
| `dirname(fileURLToPath(import.meta.url))` | `watchDir` |

State (`debounceUntil`, `child`, `lastBadSentinel`, `lastSkipKey`, `loopWaitLogged`,
`watcherStartedAt`, the interval handles) becomes factory-closure state. The
`eventsOps`/`deployOps` forward references that `fire()`/`poll()` make today keep the same
shape (declared with `let` in the factory scope, assigned in `start()`).

**`main()` afterwards** is exactly: `loadConfig()`, the `dataDir`/`logsDir`/`paths`
derivation, `mkdirSync(logsDir, …)`, the log-rotation block, the `log` closure,
`const watcher = makeWatcher({ config, paths, logsDir, watchDir: dirname(fileURLToPath(import.meta.url)), log })`,
`watcher.start()`, and the two `process.on('SIGTERM'|'SIGINT', …)` lines calling
`watcher.shutdown(signal)`. Nothing else. The entry guard at the bottom is untouched.

**Header comment** (lines 24–28 today, "fs/spawn effects live in the thin shell at the
bottom … without ever running main()") is rewritten to say the effects live in
`makeWatcher` (exported, driven by `test/watcher-main.test.js`), that `main()` is config,
paths, log and signal wiring only, and that `test/watcher-process.test.js` runs the real
entry point once against a temp dir. Cite AS-82.

### 3.2 `apps/chat/test/watcher-main.test.js` — new

A `watcherHarness(t)` in the shape of `deployHarness(t)` in `watcher.test.js`:

- `mkdtempSync` data dir; `paths` all under it; `logsDir` under it (created); a settings
  fixture file at `paths.settings` with a known `permissions.allow`/`deny` (reuse the
  shape of the AS-21 fixtures in `watcher.test.js`).
- `config`: `{ ...loadConfig({}), repoRoot: <the temp dir>, pollS: 3600, debounceS: 0,
  tickTimeoutMin: 30, lockStaleMin: 45, permissionMode: 'acceptEdits', claudeBin: '/fake/claude',
  deployPollS: 3600, lanesPollS: 3600, eventsSweepS: 3600 }`. `debounceS: 0` makes the
  fire sequence deterministic: poll → `debounce` (window = now), next poll → `fire`.
  Huge intervals mean no interval fires inside a test; `shutdown()` clears them anyway.
- `now`: a controllable clock **seeded from the real `Date.now()`** and advanced by small
  steps (`h.tick(ms)`). `makeLockOps` stamps `startedAt` from the real clock and
  `decide()` compares it against the injected one, so the injected clock must stay within
  seconds of real time.
- `pid: 4242`, `isPidAlive`: a stub keyed by pid (4242 alive; anything the test says).
- `spawnFn`: records `{ bin, argv, opts }` and returns a fake child — an `EventEmitter` with
  `pid`, `stdout`/`stderr` as `PassThrough` streams, and a `kill(sig)` spy. The test ends
  the tick by `fake.emit('exit', code, signal)` or `fake.emit('error', err)`.
- `createLog`: the real `createWriteStream` into the temp `logsDir` (cheap and real).
- `exit`: records the code and **throws** `class ExitSignal extends Error` so control
  flow after `exit()` matches a real process ending; tests `assert.throws(…, ExitSignal)`.
- `deployOps` stub: `{ evaluate: async () => ({action:'noop',reason:'test'}), isDeploying: () => false,
  pendingDeploy: () => false, lockIsBusy: () => false, dockerBin: null, dockerReason: 'test',
  gitBin: 'git', baselineDigest: null, lastAttempt: () => null }`.
- `lanesOps` stub: `{ evaluate: async () => {}, gitBin: 'git', statePath }`.
- `lockOps`, `loopOps`, `eventsOps`: **real**, default-built by `start()` over the temp
  paths (so the lock body, the loop mirror `advance-loop.json`, and the events stream
  `events/company.jsonl` are all observable as files). Test 5 alone passes wrapped real
  ones in, to observe call order (below).
- `t.after`: `shutdown` if not already called (swallowing `ExitSignal`), then `rmSync`.

Tests, with these exact names (the mutation battery in §5 predicts failures by name):

1. `AS-82 makeWatcher: start() refuses to run beside a live watcher, and otherwise writes the pid file with startedAt === heartbeatAt`
   — pre-write `{pid: 999}` with 999 alive → `start()` throws `ExitSignal(1)`, `FATAL` logged, file untouched; fresh harness → after `start()` the file is `{pid: 4242, startedAt, heartbeatAt}` with the two timestamps equal and equal to the injected clock.
2. `AS-82 makeWatcher: every poll rewrites heartbeatAt — including while our own tick is running — and never touches pid/startedAt`
   — `start()`; `tick(1000)`; `poll()` → `heartbeatAt` advanced, `startedAt`/`pid` unchanged. Then drive a fire (write sentinel `{messageId: 5, authorId: 'human:forrest'}`, `poll()` ×2), confirm `hasChild()`; `tick(1000)`; `poll()` → `heartbeatAt` advanced again and `spawnFn` still called exactly once.
3. `AS-82 makeWatcher: a message fires exactly one tick — lock taken with our pid/source/nonce/loop marker, highwater advanced, tick_started emitted`
   — after the fire: lock body `{pid: 4242, source: 'watcher', nonce: /^[0-9a-f]{16}$/, loop: {ticks: 1}, startedAt}`; highwater `{messageId: 5, firedAt}`; the events stream has exactly one `tick_started` with `messageId: 5`; a further `poll()` spawns nothing (below-highwater).
4. `AS-82 makeWatcher: the spawn call site passes tickArgv() and tickChildEnv() verbatim, with the settings-file grants, from the repo root`
   — `spawnFn` call: `bin === config.claudeBin`; `argv` deepEqual `tickArgv(4242, lock.nonce, config.permissionMode, loadPermissionRules(paths.settings))` (so the `--allowedTools`/`--disallowedTools` groups are present, denies last); `opts.env` deepEqual `tickChildEnv(process.env, 4242, lock.nonce)`; `opts.cwd === config.repoRoot`; `opts.stdio` deepEqual `['ignore','pipe','pipe']`. Second half: delete the settings file, new harness, fire → a `WARN permission rules unavailable` line and `argv` deepEqual `tickArgv(4242, nonce, mode)` with no grant flags.
5. `AS-82 makeWatcher: settle releases the lock, then records tick_ended, then folds the tick into the loop — in that order`
   — the harness builds real `eventsOps`/`loopOps` itself and passes wrappers: `tickEnded` records `existsSync(paths.lock)` at call time; `loopOps.settle` records whether the stream already contains a `tick_ended`. Fire, `fake.emit('exit', 0, null)` → lock absent at `tickEnded` time; `tick_ended` present at `settle` time; afterwards `hasChild() === false`, lock file gone, `advance-loop.json` has `lastTick.code === 0`, stream has one `tick_ended` with `tickId` = the `tick_started` id.
6. `AS-82 makeWatcher: a tick that outlives the box is SIGTERMed and settles as timedOut`
   — harness with `config.tickTimeoutMin: 0.0005` (30 ms; the fire's `setTimeout` is real). Fire; `await` ~100 ms → `fake.kill` called with `'SIGTERM'` and a `TIMEOUT` line logged; `fake.emit('exit', null, 'SIGTERM')` → `advance-loop.json.lastTick.timedOut === true`, stream `tick_ended.timedOut === true`, lock gone. (The 15 s SIGKILL timer is unref'd and cleared by settle; not asserted.)
7. `AS-82 makeWatcher: a fire that loses the lock spawns nothing and leaves the highwater alone`
   — pre-write a fresh foreign lock `{pid: 999, startedAt: now, source: 'manual'}` (999 alive); sentinel above highwater; `poll()` ×2 → `decide` yields `skip-locked` (asserted via the `SKIP lock-fresh-manual` line) and `spawnFn` never called; then mark 999 dead, `poll()` → fires over the stale lock (`NOTE firing over stale lock`), one spawn. Also cover the `acquireLock` race branch directly: `ops().lock` replaced by a wrapper whose `acquireLock` returns `false` once → `SKIP fire aborted` line, no spawn, highwater file absent.
8. `AS-82 makeWatcher: shutdown clears the intervals, terminates the child, releases the lock, removes the pid file, exits 0`
   — fire (child running); `shutdown('SIGTERM')` throws `ExitSignal(0)`; `fake.kill` called with `'SIGTERM'`; lock gone; pid file gone; `STOP SIGTERM` and `STOP terminating in-flight tick` logged; the four interval handles cleared (observable: `hasActiveTimers` is not exposed by node — instead assert via `t.mock.method(globalThis, 'clearInterval')` that it was called four times, or simply that the test process exits promptly under `node --test`'s per-file isolation; prefer the mock).
9. `AS-82 makeWatcher: a spawn error settles the tick and frees the lock`
   — fire, `fake.emit('error', new Error('ENOENT'))` → `ERROR tick spawn failed` logged, lock gone, `hasChild() === false`, stream `tick_ended` present with `code: null`.

### 3.3 `apps/chat/test/watcher-process.test.js` — new, one test

10. `AS-82 entry point: the real process heartbeats on its own interval against a temp data dir, and SIGTERM removes the pid file with exit 0`

Spawn `process.execPath` with `[fileURLToPath(new URL('../watch/advance-watcher.mjs', import.meta.url))]`,
`stdio: ['ignore', 'pipe', 'pipe']` (collect both for the failure message), and env
`{ ...process.env, ADVANCE_REPO_ROOT: <mkdtemp>, ADVANCE_POLL_S: '0.2', ADVANCE_CHAT_URL: 'http://127.0.0.1:1',
ADVANCE_CLAUDE_BIN: '/nonexistent/claude', ADVANCE_DOCKER_BIN: '/nonexistent/docker',
ADVANCE_DEPLOY_POLL_S: '3600', ADVANCE_LANES_POLL_S: '3600', ADVANCE_EVENTS_SWEEP_S: '3600' }`.
Every one of those is a fence: the data dir, pid file, lock, highwater and logs land under
the temp `apps/chat/data`; no sentinel exists so nothing fires; if anything did fire the
binary does not exist; the deploy poll cannot run (`override-missing` → no docker) and
would probe a port nothing listens on if it did; the only real side effect is the lanes
first snapshot writing `worktrees.json` under the temp dir after a read-only `git worktree
list` that fails in a non-repo. This test runs safely on a host with the live watcher up:
different pid file, different lock, different log.

Steps: poll `<tmp>/apps/chat/data/advance-watcher.pid` every 50 ms until it parses and
`Date.parse(heartbeatAt) > Date.parse(startedAt)` (deadline 20 s — the happy path is
~0.5 s; the box is for the emulated amd64 compose run). Then `child.kill('SIGTERM')`; await
`exit` (deadline 20 s) → `code === 0`, `signal === null`, pid file absent, and the
watcher log under the temp dir contains a `START watcher pid <child.pid>` line and a
`STOP SIGTERM` line. `t.after`: if still running, `SIGKILL`; `rmSync` the temp dir.

### 3.4 Not changed

`tickArgv`, `tickChildEnv`, `writeWatcherPid`, `decide`, `nextPollAction`, all five existing
factories and their signatures; `lib/`, `server.js`, `bin/`, `public/`; every existing
test file; `compose.yaml`, `Dockerfile`; `.claude/`, `advance.md`, the protected top-level
files. `apps/chat/watch/README.md` is optional — if touched, one short paragraph under
"Files" or a new "Testing" heading saying how `main()`'s wiring is now exercised; prose only.

## 4. Acceptance criteria

Properties first (each names its falsifier — an **observed red** on a scratch copy per §5,
never an argument); inspection floors after.

- **AC-1 (the headline, verbatim from the task).** Deleting the `writeWatcherPid(...)` call
  from `poll()` turns the suite RED. Falsifier M1 in §5; predicted failing set `{2, 10}`.
- **AC-2.** The heartbeat is *first* in `poll()`, before the `if (child) return` gate.
  Falsifier M2 (move the call below the gate); predicted `{2}`.
- **AC-3.** A fire takes `advance.lock` before anything else and yields when it cannot.
  Falsifier M3 (replace the `acquireLock(...)` condition in `fire()` with `false`); predicted `{3, 7}`.
- **AC-4.** `settle()` releases the lock. Falsifier M4 (delete `releaseLock()` in `settle`); predicted `{5, 9}`.
- **AC-5.** The spawn call site passes exactly `tickArgv(pid, nonce, config.permissionMode, rules ?? undefined)`
  and `tickChildEnv(process.env, pid, nonce)`. Falsifier M5 (at the spawn site, replace
  `config.permissionMode` with the literal `'plan'`); predicted `{4}`.
- **AC-6.** A fire advances the highwater at fire time. Falsifier M6 (delete the two-line
  highwater write + rename in `fire()`); predicted `{3}` (test 2's "still one spawn" also
  turns red because the next poll re-fires — so predicted `{2, 3}`; record which).
- **AC-7.** The tick box SIGTERMs an overrunning tick. Falsifier M7 (delete `proc.kill('SIGTERM')`
  inside the term timer); predicted `{6}`.
- **AC-8.** Shutdown removes the pid file. Falsifier M8 (delete `unlinkSync(paths.pid)` in
  `shutdown`); predicted `{8, 10}`.
- **AC-9.** Settle records `tick_ended` after releasing the lock and before the loop folds
  the tick. Falsifier M9 (swap the `eventsOps.tickEnded(...)` and `loopOps.settle(...)` lines
  in `settle`); predicted `{5}`. Falsifier M10 (delete the `eventsOps.tickEnded(...)` line);
  predicted `{5, 6, 9}`.
- **AC-10 (cardinality).** Host `node --test` on the branch reports exactly
  `468 + N` tests, 0 fail, where 468 is master `b1bba80`'s count (measured 2026-09-11 by
  the planner, 7.6 s) and `N` is the number of `test(` blocks in the two new files (10 as
  planned; state the actual). The counted compose run reports its own master baseline `+ N`
  with the `Image … Built` receipt line quoted (§6). A smaller number than expected is a
  finding, not a pass.

Inspection floors (structural; each has a grep or diff that goes red if violated):

- **AC-11 (diff shape, main()).** The span from `function main()` to its closing brace
  contains no occurrence of `writeWatcherPid`, `acquireLock`, `releaseLock`, `spawnFn`,
  `spawn(`, `decide(`, `nextPollAction(`, `setInterval(`, `readJson(paths.pid`, or
  `fireNonce`. Check: `awk '/^function main\(\)/,/^}/' apps/chat/watch/advance-watcher.mjs | grep -cE 'writeWatcherPid|acquireLock|releaseLock|spawn|decide\(|nextPollAction|setInterval|fireNonce'` prints `0`.
- **AC-12 (diff shape, moved code).** In `git diff master...feat/AS-82-watcher-main-under-test --color-moved=zebra --color-moved-ws=allow-indentation-change -- apps/chat/watch/advance-watcher.mjs`,
  every added line inside `makeWatcher` is either a moved line or one of the §3.1
  substitutions, the factory signature/return, the `let` declarations for the ops, or the
  `?? make…Ops({…})` default construction. QA lists every other added line as a finding.
  The implementer lists, in the implementation comment, every non-moved line they added.
- **AC-13 (existing pins untouched).** `git diff master...feat/AS-82-watcher-main-under-test --stat`
  names only `apps/chat/watch/advance-watcher.mjs`, the two new test files, and (optionally)
  `apps/chat/watch/README.md`. In particular `test/watcher.test.js`, `test/watcher-loop.test.js`,
  `test/watcher-events.test.js`, `test/watcher-lanes.test.js`, `test/deploy-shape.test.js`
  and `test/launchd-plist.test.js` are byte-identical to master, and all pass.
- **AC-14 (fences).** `watcher-process.test.js` sets every env var listed in §3.3 on the
  child, and neither new test file contains the strings `8347`, `apps/chat/data` outside
  a temp-dir join, or `launchctl`.
- **AC-15 (no deps).** `apps/chat/package.json` unchanged; both new test files import only
  `node:*` builtins and `../watch/advance-watcher.mjs` / `../lib/events.js`.

## 5. Mutation recipe (implementer runs it and records results; QA re-runs a subset cold)

Never mutate the worktree. Work on a scratch copy that has no git in it:

```
cp -R /Users/forrest/Code/american-software-company/.worktrees/AS-82 /tmp/as82-mut
rm /tmp/as82-mut/.git            # a linked worktree's .git is a FILE pointing at the real repo; remove it so nothing in the copy can reach git
shasum -a 256 /Users/forrest/Code/american-software-company/.worktrees/AS-82/apps/chat/watch/advance-watcher.mjs   # record: HASH_BEFORE
```

For each mutation M1–M10, apply it with a small node script (not `sed` — BSD/GNU address
differences have produced an unapplied mutation before) that:
1. reads `/tmp/as82-mut/apps/chat/watch/advance-watcher.mjs`,
2. locates the target with a pattern anchored to the **enclosing function** (e.g. for M1:
   the `writeWatcherPid({` that follows the `function poll()` line and precedes
   `if (child) return`; for M4: the `releaseLock();` between `function settle(` and
   `headOf(`) and asserts it matches **exactly once**,
3. applies the replacement, asserts the content changed, and prints the 1-based line number
   of the edit (record it — it must fall inside the intended function's span),
4. writes the file back.

Then run `node --test "/tmp/as82-mut/apps/chat/test/*.test.js" 2>&1 | grep -E '^✖|^ℹ (tests|pass|fail)'`
and record the failing test names against the predicted set in §4. Restore between mutations
by re-copying the pristine file from the worktree (`cp <worktree file> /tmp/as82-mut/...`),
then verify with `shasum` that the copy matches `HASH_BEFORE` before the next mutation.

A survivor (predicted red, observed green) has two explanations — a vacuous test or a
mutation that landed at the wrong site — and you distinguish them **before** reporting:
`diff <worktree file> /tmp/as82-mut/...` and read the hunk. A wider or narrower failing set
than predicted is itself a finding; record it, do not tune the prediction after the fact.

After the battery: `rm -rf /tmp/as82-mut`; `shasum -a 256` of the worktree file equals
`HASH_BEFORE`; `git -C /Users/forrest/Code/american-software-company/.worktrees/AS-82 status --porcelain` is empty.

## 6. Test-run recipe and the behaviour-preservation proof

Host, from any cwd (no `cd` — the working-directory hazard in CLAUDE.md):
`node --test "/Users/forrest/Code/american-software-company/.worktrees/AS-82/apps/chat/test/*.test.js"`
→ expect `tests 468 + N`, `fail 0`.

Counted compose run (the receipt; taken by whoever can reach docker — in a headless tick
that is the orchestrator, and the stage report says whether it was taken):
`DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 docker compose -f /Users/forrest/Code/american-software-company/.worktrees/AS-82/apps/chat/compose.yaml run --rm --build test`
— valid only if the output shows the `Image … Built` line; quote it with the counts. Take
the same run on master first (once) to get the container baseline, since the container
count differs from the host count by its own rules. `run` builds only the `test` service
and starts no container that binds a port or mounts `data/`; it does not touch the live
server.

Behaviour is proven unchanged by: AC-13 (every existing pin test green and unmodified),
AC-11/12 (main() reduced to enumerated wiring; every factory line moved, not rewritten),
test 4 (the spawn call site reproduces the pinned argv/env), and — after merge, observed by
the orchestrator, **not** by QA — the AS-75 self-restart: the merged `.mjs` changes the
running watcher's source digest, the next deploy poll after the container is current exits
70, launchd relaunches it, and within two minutes `apps/chat/data/advance-watcher.log`
shows `RESTART … -> START watcher pid <new>` and the sidebar's loop indicator stays live.
The merge tick reports that observation on this task.

## 7. Constraints

- Zero new dependencies; `node:*` only. No protected top-level file edited. No edits to
  `.claude/` or `advance.md`.
- Never signal, restart, or read the pid of the live launchd watcher; never write under
  `/Users/forrest/Code/american-software-company/apps/chat/data/`; no fixed ports — the
  process test's `ADVANCE_CHAT_URL` points at a port nothing serves; temp dirs only.
- Never `cd` into the worktree for `lattice` calls; use `git -C` and absolute paths.
- Commit as `developer-<name>` per CLAUDE.md § Git Methodology; message `AS-82: …`.
- If the process test (10) proves flaky in the compose run (fails under a green host run
  with no code change), that is a finding for the stage report — do not add a skip toggle;
  raise the deadline once (to 40 s) and re-run three times, and report all three results.

## 8. Implementation order (for a fresh developer)

1. Measure and record both baselines on master (host 468; compose per §6).
2. Write the factory: move the code (§3.1), apply the substitution table, rewrite `main()`
   to the enumerated wiring, update the header comment. Run the existing suite: 468 green,
   unmodified.
3. Write `watcher-main.test.js` tests 1–9 in order; each should go red against a
   deliberately stubbed harness at least once while you write it (a test that has never
   failed has proven nothing).
4. Write `watcher-process.test.js` (test 10). Run it five times on the host for timing.
5. Run the §5 battery; record predicted vs observed per mutation in the implementation
   comment, with the edit line numbers.
6. Commit on the branch; `lattice comment` the implementation report (baselines, `N`,
   the non-moved-lines list for AC-12, the battery table, and whether the compose receipt
   was taken); move to `review`.

## 9. Open questions (time-boxed)

- None blocking. One parked tangent, not for this task: `if (child) return` in `poll()` is
  redundant with the lock (a message arriving mid-tick lands in `skip-locked` either way)
  — a mutation deleting it would survive, and that is a fact about the design, not a hole
  in the tests. Left as a note for AS-84 (lock semantics), where it belongs.
