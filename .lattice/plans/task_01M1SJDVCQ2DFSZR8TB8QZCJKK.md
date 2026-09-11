# AS-84 — shutdown() orphans the deploy child and releases its lock; lastAttempt is memory-only; evaluate() is unguarded

Planner: cto-owen, 2026-09-11 (tick watcher:93997, loop tick 22). Parent: AS-75. Filed by qa-ruben from the AS-75 review (F5/F6), plus two later notes on the task: the dead-pid lock-steal evidence (2026-09-09) and Ruben's AS-82 F3 (shutdown mid-tick never reaches settle()).
Complexity: **medium-high** (four small mechanisms, one real-process test). Estimate: 1 tick implement, 1 tick review.
Proposed branch: `feat/AS-84-shutdown-owns-its-children`. Worktree: `.worktrees/AS-84`.

## 0. Claims re-verified against current master (cef63a8)

The description predates AS-82 (main() → makeWatcher()), AS-95 (loop) and AS-100 (events). Each claim was checked against the file as it is now, not as Ruben saw it:

| Claim | Now | Where |
|---|---|---|
| shutdown() SIGTERMs the tick child only | **True.** `shutdown()` kills `child`; the compose process lives as a local `proc` inside `runDockerCompose()` and nothing outside that closure can reach it. `makeDeployOps` has a `deploying` boolean and no handle. | `advance-watcher.mjs` 650–681, 830–879, 2270–2287 |
| releaseLock() cannot tell whose lock it is | **True.** `releaseLock()` tests `held.pid === pid` only. The watcher's lock ops and the deploy's lock ops are two instances over one file with the same pid, differing only in `source`. shutdown()'s `releaseLock()` therefore unlinks a `source:"deploy"` lock while the build is still running. The mirror image also holds: the deploy's `finally { lock.releaseLock() }` would unlink a `source:"watcher"` lock. | 495–589, 731–732 |
| lastAttempt is memory-only | **True.** `let lastAttempt = null` in `makeDeployOps`; it is *written* into `deploy-state.json` by `persist()` but never read back. A relaunched watcher starts with no cooldown. | 742, 801–817 |
| `void deployOps.evaluate(...)` has no `.catch()` | **True**, and the comment beside it ("every branch inside it already handles its own failure") is an argument, not a guard. Today's callees (`runSync`, `fetchJsonOrNull`, `persist`, `acquireLock`) do swallow their own errors, so the rejection path is currently *latent* — but `prune()` runs outside the try, `createLog` in `runDockerCompose` can emit an unhandled `'error'` (EACCES/ENOENT on `logsDir`), and any future edit inside `evaluate()` (AS-86 is editing `computeDesired` this same tick) re-arms it. Node 24 terminates on unhandled rejection. | 2363, 836, 652 |
| AS-82 F3: shutdown mid-tick never reaches settle() | **True.** shutdown() kills the child and calls `exit(0)` synchronously; the child's `'exit'` handler never runs, so no `tick_ended` is written, `loopOps.settle()` never runs, and AS-100's sweep later closes the tick as `error`/`unclosed` by a process that did not fire it. **Folded into scope** — it is the same defect as F5 (shutdown does not wait for what it started) and the fix is the same bounded wait. | 2162–2183, 2270–2287 |
| The 2026-09-09 dead-pid steal under a live loop tick | **Out of scope, with reason.** That was the *tick procedure* writing a dead pid; it was fixed in `advance.md` step 0 (heartbeat holder process). Making `isLockStale` trust `source` over pid liveness would let a crashed loop session hold the lock for 45 min; I am not changing the staleness rule here. Noted for AS-87/AS-88 if the README wants a sentence. | — |

Launchd bound: the plist template sets `KeepAlive: true` and no `ExitTimeOut`, so launchd SIGKILLs the watcher **20 s** after SIGTERM. Every wait below is sized under that.

## 1. Scope

Four mechanisms, all in `apps/chat/watch/advance-watcher.mjs`, each unit-tested through the existing injectable factories, plus one real-process test that observes the whole chain:

1. **shutdown() owns both children.** SIGTERM the tick child *and* the deploy child, then wait — bounded — for both to exit, so the tick settles normally (`tick_ended`, lock release, loop settle) and the deploy records its abort and releases its own lock. Then remove the pid file and exit 0. If the bound expires: SIGKILL whatever is left, release only the lock we own, exit 0.
2. **Lock release by `source`.** `releaseLock()` unlinks only when `held.pid === pid && held.source === source`. Pid stays in the check (a foreign live-session lock must never be released either); `source` is what tells the two same-pid instances apart.
3. **lastAttempt survives a restart.** `makeDeployOps` hydrates `lastAttempt` from `deploy-state.json` at construction, and `performDeploy` persists a `started` record *before* spawning compose so a watcher that dies mid-build leaves evidence.
4. **evaluate() cannot take the process down.** Belt: `evaluate()` wraps its body in try/catch and resolves `{action:'noop', reason:'error', detail}` (persisted, logged once per distinct message). Suspenders: the interval call site becomes a named `deployPoll()` that `.catch`es and logs — exposed on the watcher object so the wiring is testable.

Non-goals: no change to `decideDeploy`'s rule table (AS-86 owns the predicate's inputs; the table stays byte-identical), no change to `isLockStale`, no heartbeat during the build (AS-87), no README rewrite beyond the lines these mechanisms change (AS-88).

## 2. Approach, per acceptance item

### 2.1 Deploy child terminated on shutdown, bounded wait (F5 part 1 + AS-82 F3)

`runDockerCompose` gains an `onSpawn(proc)` option (default no-op) so the caller can hold the child. `makeDeployOps` keeps `let deployChild = null`, set in `onSpawn`, cleared in `performDeploy`'s `finally`, and exposes:

```js
abort(signal = 'SIGTERM')  // -> Promise<void>: resolves when the in-flight deploy has settled
                           //    (lock released, lastAttempt recorded); resolves immediately if idle
```

`abort()` signals `deployChild`, and `performDeploy` sees `signal !== null` in the result and records `outcome: 'aborted'` (detail `aborted by shutdown (SIGTERM)`), *not* `'fail'` — an operator `kickstart -k` mid-build must not put the merge in a 30-min cooldown; `decideDeploy` rule 7 matches only `'fail'`, so the relaunched watcher retries in its first idle deploy poll, which is the behaviour we want (the orphan is gone, its lock is released by its owner, and rule 1 keeps the retry off any tick). `deploying` is the flag `pendingDeploy()`/`poll()` already read; no new state there.

`shutdown(signal)` becomes:

```
log STOP; clear the four intervals
if child:   log 'STOP terminating in-flight tick'; child.kill('SIGTERM')          // unchanged
if deploying: log 'STOP aborting in-flight deploy'; waits.push(deployOps.abort('SIGTERM'))
if child:   waits.push(promise that resolves when THIS child's settle() has run)
if waits is empty: finish() synchronously                                          // today's fast path, byte-for-byte
else: Promise.race([Promise.all(waits), grace timer]) .then(finish)
finish(): if a child is still alive -> SIGKILL it and log 'STOP grace expired';
          releaseLock()   // now source-checked: a no-op unless the file is OUR source:'watcher' lock
          unlink pid; exit(0)
```

Grace: `config.shutdownGraceS`, env `ADVANCE_SHUTDOWN_GRACE_S`, default **10** (under launchd's 20 s SIGKILL with margin for `settle()`'s file writes). `settle()` already does the right thing when the tick child exits — release, `tick_ended`, `loopOps.settle` — so F3 is fixed by *letting it run*, not by duplicating it in shutdown. Implementation detail: `fire()` needs to hand shutdown a "settled" promise; simplest is a module-level `let settled = null` resolver set in `fire()` and called at the end of `settle()`. The `exit` injected by tests throws `ExitSignal`; in the async path that throw must be caught and re-thrown from the returned promise so the harness sees it (see §4 T10).

`process.on('SIGTERM', ...)` in `main()` is unchanged; `shutdown()` now returns a promise and main ignores it, as it ignores `evaluate()`'s.

### 2.2 Lock release distinguishes by source (F5 part 2)

`makeLockOps.releaseLock()`: `if (held && held.pid === pid && held.source === source)`. `acquireLock`'s verify-after-create additionally checks `verify.nonce === nonce` (same class of ambiguity — two same-pid instances — and one line). No change to `isLockStale`, `readLock`, or the stale-steal path. README line 38's body description gains nothing (it already lists `source`).

### 2.3 lastAttempt survives a restart

`makeDeployOps` gains `readState = readJson` (injectable, default the existing module-level `readJson`). At construction: `lastAttempt = hydrateAttempt(readState(statePath)?.lastAttempt)` where `hydrateAttempt` is a small exported pure function:

- `{id, at: ISO, outcome:'ok'|'fail'|'aborted', detail}` → same record with `at` parsed to ms; anything unparsable → `null`.
- `outcome:'started'` → `{..., outcome:'fail', detail:'interrupted: watcher exited mid-build'}` — a record that was never completed means the process died under the build, and that is exactly the crash-loop case the cooldown exists to bound.

`performDeploy` sets `lastAttempt = {id, at, outcome:'started', detail:'building'}` and `persist()`s it **before** `deploy()` is called; the existing post-deploy assignment overwrites it. `persist()` already serializes `lastAttempt`, so `deploy-state.json` needs no new field — `outcome` just gains two values. `public/loop-status.js`'s reason map gains one entry, `error`, for §2.4; `lastAttempt.outcome` is not rendered by the sidebar today, so no other UI change.

### 2.4 evaluate() cannot take the process down (F6)

`evaluate()` body moves into `evaluateInner()`; `evaluate()` is:

```js
try { return await evaluateInner(opts); }
catch (err) { warnOnce(`error:${err.message}`, `deploy poll failed: ${err.message}`);
              persist({ reason: 'error', desiredReason: 'error' });
              return { action: 'noop', reason: 'error', detail: err.message }; }
```

`persist()` itself already catches. `lastDecision` is set to the error decision so `pendingDeploy()` is `false` (reason is neither `busy` nor `stale-build`) — a broken poll must not make the loop wait forever. In `makeWatcher.start()`: `deployInterval = setInterval(deployPoll, ...)` where `function deployPoll() { return deployOps.evaluate({ busy: Boolean(child) }).catch((err) => log(\`ERROR deploy poll rejected: ${err.message}\`)); }`, and `deployPoll` is returned on the watcher object beside `poll`. The comment at 2337–2342 is rewritten to say what is now true.

## 3. Key files

- `apps/chat/watch/advance-watcher.mjs` — `loadConfig`/`DEFAULTS` (+`shutdownGraceS`), `makeLockOps` (release + verify), `runDockerCompose` (+`onSpawn`), `makeDeployOps` (hydrate, `started` record, `abort()`, `evaluate` guard, new export `hydrateAttempt`), `makeWatcher` (`fire()` settled-promise, `deployPoll()`, `shutdown()` rewrite), `main()` unchanged.
- `apps/chat/test/watcher.test.js` — lock-ops and deploy-ops tests (§4 T1–T8).
- `apps/chat/test/watcher-main.test.js` — shutdown tests (T9–T13); the harness's `deployOps` stub gains `abort: async () => {}`.
- `apps/chat/test/watcher-process.test.js` — the real-process SIGTERM-mid-build test (T14), with a fake docker script and a temp git repo.
- `apps/chat/public/loop-status.js` — one map entry (`error`).
- `apps/chat/watch/README.md` — env-knob line (`ADVANCE_SHUTDOWN_GRACE_S`), refusal table (+`error`), one paragraph under "AS-75: the watcher also deploys" on shutdown semantics, and the file table's `lastAttempt.outcome` values. Keep it to those lines; AS-88 owns the rest.

## 4. Acceptance criteria (numbered; M4 — each names its falsifier and the exact red set)

Baseline host suite on master cef63a8: **498/498** (`node --test apps/chat/test/*.test.js`, this tick). Predicted after AS-84: **511** (+13 new, 1 existing modified in place, 0 removed). A count outside 510–512 is itself a finding.

**Lock ops (`watcher.test.js`)**
- **AC-1** `makeLockOps: release is by pid AND source — a deploy-source instance leaves a watcher-source lock alone, and vice versa`. Two instances over one path, same pid: A(source watcher) acquires; B(source deploy).releaseLock() → file still present with source watcher; then B acquires after A releases; A.releaseLock() → file still present with source deploy. *Falsifier:* remove `&& held.source === source` from `releaseLock` → **red: {AC-1}**, and AC-11 below also goes red (two tests, both named).
- **AC-2** `makeLockOps: verify-after-create requires our nonce, not just our pid`. Fake `readFile` returns a body with our pid and a foreign nonce after the wx write → acquire returns false, `STEAL-LOST` logged. *Falsifier:* drop the nonce term → **red: {AC-2}**.

**Deploy ops (`watcher.test.js`, existing `deployHarness`)**
- **AC-3** `makeDeployOps: lastAttempt is hydrated from deploy-state.json — a failed attempt at the desired id, inside the cooldown, refuses without building`. State file pre-written with `{lastAttempt:{id:X, at: ISO(now-5min), outcome:'fail'}}`, desired X, running Y → `{noop, cooldown}`, `calls.deploy.length === 0`; and `ops.lastAttempt().at` is a number equal to `Date.parse(...)`. *Falsifier:* delete the hydration line → **red: {AC-3, AC-4}**.
- **AC-4** `makeDeployOps: an interrupted attempt ('started' on disk) counts as a failure for the cooldown`. Same as AC-3 with `outcome:'started'` → `{noop, cooldown}`, hydrated detail matches `/interrupted/`. *Falsifier:* map `'started'` to itself in `hydrateAttempt` → **red: {AC-4}** only.
- **AC-5** `makeDeployOps: the 'started' record is on disk before compose is spawned`. The injected `deploy` fn reads `statePath` synchronously when called and asserts `lastAttempt.outcome === 'started'` and `.id === desiredId`; after completion the file says `ok`. *Falsifier:* move the pre-build `persist()` after `deploy()` → **red: {AC-5}**.
- **AC-6** `makeDeployOps: abort() signals the running build, the attempt records 'aborted', the deploy lock is released by its owner, and the outcome is NOT a cooldown`. Injected `deploy` invokes `onSpawn` with a fake proc and returns a promise the test resolves with `{code:null, signal:'SIGTERM', timedOut:false}` after seeing `fake.signals === ['SIGTERM']`; `await ops.abort()` resolves; lock file gone; `lastAttempt().outcome === 'aborted'`; a subsequent `evaluate()` with the same desired id → `{deploy, stale-build}`. *Falsifier:* have `abort()` resolve without signalling (`deployChild = null` before kill) → **red: {AC-6}**; separately, record the abort as `'fail'` → **red: {AC-6}** (the cooldown assertion).
- **AC-7** `makeDeployOps: abort() while idle resolves immediately and touches nothing` — no lock file created, no log line, no state write. *Falsifier:* make `abort()` always call `persist()` → **red: {AC-7}**.
- **AC-8** `makeDeployOps: evaluate() never rejects — a throwing collaborator becomes {noop, error}, persisted, logged once`. Injected `run` throws; `await ops.evaluate()` → `{action:'noop', reason:'error'}`; state file `reason === 'error'`; exactly one `WARN deploy poll failed` line over two calls; `pendingDeploy() === false`. *Falsifier:* delete the try/catch in `evaluate()` → **red: {AC-8}** (the test's `await` rejects). Assert the mutation at the `evaluate` site, not `evaluateInner` (the AS-95 sharpening).

**Watcher (`watcher-main.test.js`)**
- **AC-9** (modifies the existing `AS-82 makeWatcher: shutdown clears the intervals, terminates the child, releases the lock, removes the pid file, exits 0`) — becomes: shutdown with an in-flight tick SIGTERMs it, **does not exit yet**; after the fake child emits `exit` the stream has exactly one `tick_ended`, the lock is gone, the pid file is gone, `exit` was called with 0 once, and the four intervals were cleared. Order asserted: `tick_ended` written before `exit`. *Falsifier:* restore the synchronous `exit(0)` → **red: {AC-9}** (`tick_ended` count 0 at exit) **and {AC-10, AC-11}**.
- **AC-10** `makeWatcher: shutdown with a deploy in flight aborts it and waits for it before exiting`. `deployOps` stub: `isDeploying: () => true`, `abort` returns a promise the test controls; assert `exit` not called until it resolves; `STOP aborting in-flight deploy` logged once. *Falsifier:* remove the `deployOps.abort` call from `shutdown()` → **red: {AC-10, AC-14}**.
- **AC-11** `makeWatcher: shutdown never releases a lock it does not own — a source:'deploy' lock survives shutdown`. Write `{pid: WATCHER_PID, source:'deploy', startedAt: now, nonce}` to `paths.lock`, no child, `isDeploying` false (the lock is the only evidence) → after `h.stop()` the file still exists. *Falsifier:* AC-1's mutant → **red: {AC-1, AC-11}**.
- **AC-12** `makeWatcher: the shutdown grace is a bound — a child that ignores SIGTERM is SIGKILLed and the process still exits 0`. `config.shutdownGraceS: 0.01`; fake child never emits exit → `child.signals` deep-equals `['SIGTERM','SIGKILL']`, `STOP grace expired` logged, `exit` called with 0. *Falsifier:* remove the grace timer (wait unconditionally) → **red: {AC-12}** (test times out; use node:test's per-test `timeout`).
- **AC-13** `makeWatcher: deployPoll() survives a rejecting evaluate — no unhandled rejection, one ERROR line`. `deployOps.evaluate: async () => { throw new Error('boom') }`; `process.once('unhandledRejection', …)` sentinel; `await watcher.deployPoll()`; assert sentinel not hit and `ERROR deploy poll rejected: boom` logged once. *Falsifier:* delete the `.catch` in `deployPoll` → **red: {AC-13}** (node:test reports the unhandled rejection as a failure of the running test).

**Real process (`watcher-process.test.js`)**
- **AC-14** `AS-84 entry point: SIGTERM mid-build terminates the compose child, leaves no lock, records the abort, exits 0`. Setup: temp root with `git init`, the nine `IMAGE_INPUTS` copied from the real `apps/chat` and committed (git is on the host); a one-route `http.createServer` on an ephemeral port answering `/api/build` with `{build:{id:'stale'}}`; `ADVANCE_DOCKER_BIN` → a test-written `#!/bin/sh` that writes its pid to a marker, traps TERM (`trap 'exit 143' TERM`), and `sleep 30 & wait`; `ADVANCE_DEPLOY_POLL_S=0.2`. Wait until the marker exists and `advance.lock` reads `source:'deploy'`; `child.kill('SIGTERM')`; assert: exit `code === 0` within 15 s; fake-docker pid **not alive** (`process.kill(pid, 0)` throws ESRCH — poll up to 2 s); `advance.lock` absent; `deploy-state.json.lastAttempt.outcome === 'aborted'`; log contains `STOP aborting in-flight deploy` and `DEPLOY aborted`. *Falsifier:* AC-10's mutant (no `abort()` call in shutdown) → **red: {AC-10, AC-14}** — AC-14 fails on the pid-alive assertion, which is the orphan Ruben described, observed. Fences as in the existing process test: temp root, nonexistent claude, no sentinel; the fake docker never touches the real daemon.

**Mutation testing is one indivisible step** (CLAUDE.md): each falsifier above is run on a scratch copy or with a `trap`-restored in-place edit, the mutation asserted at the intended site, the exact red set recorded, and the tree proven clean with `git diff --exit-code` before the final host run.

**AC-15 (cardinality)** — host suite after implementation: 511 (±1 explained), 0 failing; the implementer's report lists the 13 new test names and the 1 modified one.

## 5. Recommended implementer and reviewer

- **Implementer: `developer-marcus`.** Lena wrote AS-75's deploy ops and AS-82's `makeWatcher`; this task rewrites her `shutdown()` and threads a handle through her `runDockerCompose`. A second pair of eyes on the shutdown sequencing is worth more than familiarity here, and Marcus did the AS-95 rework on `settle()`/the loop, which is the other half of the ordering AC-9 asserts. (The 2026-09-06 ruling on AS-75 said "Lena implements/Priya reviews" for AS-84; that predates AS-82/AS-95 and is superseded by this plan — recorded, not silently changed.)
- **Reviewer: `qa-ruben`.** He filed F5/F6 and F3, so he is the reader most likely to notice a fix that addresses the letter of the finding and not its mechanism — and the anchoring hazard runs the other way: he already holds the failure model, the plan gives him nothing he did not write. He is not disqualified; he has not seen the implementation. Priya is the alternate if Ruben is in flight on a sibling review at that moment.

## 6. Seam note — AS-85 and AS-86 planned in parallel this tick; AS-87/AS-88 follow

| | AS-84 (this) | AS-85 | AS-86 | AS-87 | AS-88 |
|---|---|---|---|---|---|
| `advance-watcher.mjs`: `makeLockOps` | **yes** (release, verify) | no | no | no | no |
| `runDockerCompose` | **yes** (`onSpawn`) | no | no | **yes** (`--progress` flag, F4) | no |
| `makeDeployOps`: `computeDesired`/`IMAGE_INPUTS`/`parseLsTree` | no | no | **yes** | no | no |
| `makeDeployOps`: `performDeploy`, `evaluate`, ctor | **yes** | no | ctor maybe (paths) | **yes** (heartbeat write during build, F3) | no |
| `makeWatcher`: `shutdown`, `fire` (settled promise), `start` (deployPoll) | **yes** | no | no | no | no |
| `server.js` `loopStateKey` / `stream.test.js` | no | **yes** | no | no | no |
| `deploy-shape.test.js`, `.dockerignore`, `Dockerfile` | no | no | **yes** | no | no |
| `watcher.test.js` | **yes** (lock-ops block ~234–290; deploy-ops block after ~1044) | no | **yes** (deploy-ops block, `computeDesired` cases) | maybe | no |
| `watcher-main.test.js`, `watcher-process.test.js` | **yes** | no | no | maybe (process test for heartbeat) | no |
| `public/loop-status.js` | one map entry | no | no | maybe | no |
| `watch/README.md` | a few lines | no | a few lines | a few lines | **owner** |

Collisions: **AS-85 is disjoint** from AS-84 (server-side only). **AS-86 and AS-84 both touch `makeDeployOps` and the deploy-ops test block**, in different functions (AS-86: `computeDesired`/`IMAGE_INPUTS`; AS-84: ctor hydration, `performDeploy`, `evaluate`) — adjacent regions, textual conflicts likely in the ctor parameter list and at the tail of `watcher.test.js`, semantic conflicts none. One shared value: AS-84 adds `reason:'error'` to `deploy-state.json`; AS-85's `loopStateKey` reads the build projection — a new *value* of an existing string field, no key change, so the frame-count guard is unaffected.

**Recommended merge order: AS-85 → AS-86 → AS-84 → AS-87 → AS-88.** AS-85 is disjoint and small; AS-86 is small and touches the predicate's inputs; AS-84 is the largest and rebases over both (its implementer rebases `feat/AS-84-…` onto master before moving to `review`, and re-runs the full host suite after the rebase — the predicted 511 is relative to *AS-84's own* +13, so the reviewer adds AS-85's and AS-86's deltas from their merge records). AS-87 must follow AS-84 because it edits `runDockerCompose`/`performDeploy` on top of the `onSpawn`/`abort` shape — planning AS-87 before AS-84 merges would plan against a moving target. AS-88 last, documenting the finished behaviour.

## 7. Notes for the implementer

- Commit early on the branch and keep a progress note in `scratchpad/agent-developer-marcus/AS-84/` so a 30-min cutoff is resumable.
- `git -C .worktrees/AS-84 …` for everything; `lattice` only from the repo root.
- Do not run compose. The host suite (`node --test apps/chat/test/*.test.js`, 7–8 s) is the counted run for this task; AC-14 uses a fake docker by construction. If the reviewer wants a compose receipt for the final number, that is a `--build` run from the main checkout per the CLAUDE.md corollary, and it is optional here because no image input changes.
- The existing `watcher-process.test.js` deadline pattern (race the exit against a cleared timer) is the one to copy for AC-14; do not leave a 20 s timer open.
- `t.mock.timers` is available on Node 24 if you prefer it to a 10 ms grace for AC-12; either is acceptable, the assertion is what matters.
