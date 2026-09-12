# AS-81: Chat test harness: openStream() hangs the runner instead of failing — a stream regression wedges CI

Planner: agent:cto-owen (tech lead), 2026-09-11. Complexity: **low**. Harness-only change; `server.js` is not touched.
Branch `feat/AS-81-openstream-no-hang`, worktree `.worktrees/AS-81`.
Implementer: `developer-lena` (self-contained, test-only; Marcus stays on the spine). QA: `qa-ruben` (Priya filed the finding, so she does not review it).

## 1. What is actually wrong (measured this tick, not assumed)

`openStream()` is a file-local helper in `apps/chat/test/stream.test.js` (lines 61–151); there is no shared harness module and no other test file consumes `/api/stream` (grep over `apps/chat/test/*.js`). It `fetch`es the stream with its own `AbortController`, then awaits two on-connect frames — `loop` (server.js:1006, AS-27) then `lanes` (server.js:1010, AS-99) — via `nextFrame()` (default bound 5000 ms), throwing on a wrong event or on timeout, **before returning the `api` whose `close()` aborts the controller.** 12 of the file's 13 tests call it (the endpoint-gating test at line 238 does not).

Three scratch reproductions against the real, unmodified `server.js` (files under `scratchpad/agent-cto-owen/AS-81/`, untracked):

| Shape | Result |
|---|---|
| `bootServer`-owned server (its `t.after → close()` registered *before* `openStream`), helper throws, controller never aborted — both the wrong-event and the 5 s-timeout paths | red, **process exits on its own** in ≤ 5.1 s. Server `close()` reaps the orphan socket (server.js:1077–1084). |
| Test **owns its server and calls `close()` inline with no `t.after`** (the shape of the tests at lines 286 and 404), helper throws first | red at 31 ms, **process never exits** (no `ℹ tests` summary; killed by the tool timeout). The listening socket and the heartbeat `setInterval` (server.js:613 — the only server interval that is *not* `unref()`'d; `loopPoll`/`lanesPoll`/`eventsPoll` are) keep the loop alive. |
| Same test with the fix shape below (guarded `t.after(close)` + abort-on-throw) | red, process exits in 94 ms. |

So the wedge Priya hit is: a regression makes `openStream` throw → in the two server-owning tests the inline `close()` line is never reached → a live listening server plus a ref'd interval outlive the test → every test in the file still completes (red) but the child process cannot exit, and the parent `node --test` waits forever. That is exactly "7 red tests waiting behind it, needed `--test-force-exit`". The task's stated fix (abort in a `finally`) is correct hygiene and is kept, but **on its own it does not terminate the run** — the plan adds the second change, and AC-3 proves each half is load-bearing.

## 2. Scope

In scope: `apps/chat/test/stream.test.js` only. Out of scope (parked, not folded): making server `close()` idempotent (it calls `store.close()` and `server.close()` unconditionally — a second call would throw; the guard below exists because of that); auditing other test files for server-owning tests without `t.after`; AS-80 (see §7).

## 3. Approach

**A. `openStream()` aborts itself on any failure of the on-connect contract, and the bound is named.**
- Add a file-level constant `CONNECT_MS = 5000` (same number as `nextFrame`'s default; see AC-6 for why it is not shortened). Signature becomes `openStream(base, me, { connectMs = CONNECT_MS } = {})`.
- Wrap the on-connect consumption (the block at lines 133–149) in `try { … } catch (e) { ctrl.abort(); throw e; }` (equivalently try/finally with a success flag). On success the controller stays live and `close()` is returned as today.
- Both on-connect awaits use `nextFrame(connectMs)`, and the error messages name the contract so the red reads as a defect report, e.g. `AS-27 on-connect contract: no loop frame within ${connectMs}ms` and `AS-27/AS-99 on-connect contract: expected loop then lanes, got ${event}`. Wrap the timeout rejection so the first-frame timeout carries the contract wording (catch the `no frame within` error and rethrow with the contract prefix, preserving `cause`).
- Nothing else in the helper changes; `nextFrame`/`waitEnd`/`pending`/`initialLoop`/`initialLanes` semantics are unchanged, so no existing ordering assertion moves.

**B. The two server-owning tests register a guarded after-hook *before* opening a stream.** In `stream: AS-25 — close() reaps live streams…` (line 286) and `stream: AS-27 — close() clears the loop poll timer…` (line 404), immediately after `createChatServer(...)`/`listen`:
```js
let closedByTest = false;
t.after(async () => { if (!closedByTest) await close(); });
```
and set `closedByTest = true` on the line before their existing `await Promise.race([close(), timeout])`. The tests still own and assert the inline `close()` (their property is unchanged); the hook only fires when the test dies before reaching it. Do not call `close()` twice — it is not idempotent.

**C. Two new guard tests (fake upstream, no `server.js` change) that fail when A is deleted.** One `test()` with two cases (or two `test()`s — implementer's call; state which in the review comment), each spinning up a bare `node:http` server on an ephemeral port that answers `/api/stream` with the SSE headers and `:connected\n\n` and then:
- case (i) writes nothing further — `openStream(base, me, { connectMs: 200 })` must reject with the "no loop frame" contract message, and
- case (ii) writes `event: lanes\ndata: {}\n\n` first — must reject with the "expected loop then lanes" message.
In both cases the fake server's request registers `req.on('close', …)`, and the test asserts that close fires within 1000 ms *after* the rejection (a `Promise` + timer, same idiom as `waitEnd`). The fake server never ends the response and is closed in `t.after` (with `server.closeAllConnections()` before `close()` so the test itself can never wedge). Only a client-side abort can satisfy the socket-close assertion — that is what makes the guard non-vacuous (AC-4).

## 4. Key files and functions

- `apps/chat/test/stream.test.js` — `openStream()` (61–151), `bootServer()` (18–46), the two server-owning tests (286–312, 404–433), new guard tests appended after the AS-99 section.
- Read-only context: `apps/chat/server.js` `/api/stream` handler (986–1020: `:connected`, `streams.add`, the `loop` then `lanes` on-connect writes), `close()` (1066–1090), heartbeat (613–621).

## 5. Acceptance criteria (each property names its falsifier; satisfied by an observed result, never an argument)

Master's current host count, measured this tick: **468 tests, 468 pass, 0 fail (node v24.13.1, 7.5 s)**. Expected on the branch: 468 + the new guard test(s) (470 if two `test()`s, 469 if one with subtests — record the actual).

1. **Headline (task acceptance, verbatim).** On a scratch copy with the AS-27 on-connect block removed from `server.js` (both `res.write` lines inside the `try` at 1005–1013 — lines 1006 and 1010 — so no on-connect frame is ever sent), a plain `node --test` from the copy's root (no `--test-force-exit`, no `--test-timeout`) **terminates on its own within 120 s wall clock** and reports red. Predicted failing set, exactly these 12 and nothing else: `stream: AS-25 — two connected clients…`, `stream: AS-25 — hidden-channel parity…`, `stream: AS-25 — lattice ingestion pushes too…`, `stream: AS-25 — close() reaps live streams…`, `stream: AS-27 — a new lock pushes exactly one loop frame…`, `stream: AS-27 — loop frames reach every viewer identically…`, `stream: AS-27 — close() clears the loop poll timer…`, `stream-lanes-change-only…`, `stream-company-change-only…`, `stream-company-truncation…`, `stream-lanes-liveness-change-only…`, `stream: AS-99 — lanes frames reach every viewer identically…`. The new §3C guards stay green (they use a fake upstream). Summary line predicted `fail 12`. A wider or narrower set is a finding. **Control (the falsifier):** the same mutation against *master's* `stream.test.js` produces no `ℹ tests` summary within 120 s (each of the 12 goes red at ~5 s, then the child never exits) — observe it, then kill it.
2. **Fast-throw path.** Same scratch copy with only the `loop` write (line 1006) removed: terminates within 30 s, the same 12 red, each error naming "expected loop then lanes, got lanes".
3. **Both halves of the fix are load-bearing.** (a) Fixed harness with §3B reverted (the two guarded after-hooks removed) + the AC-1 mutation → wedges again (no summary within 120 s). (b) Fixed harness with §3A's `ctrl.abort()` removed + the AC-1 mutation → still terminates (server `close()` reaps) **but** the §3C guard tests go red. Both observations are recorded; (b) is why C exists.
4. **§3C guard is non-vacuous.** Deleting `ctrl.abort()` from `openStream`'s catch/finally (assert applied: `grep -c 'ctrl.abort()' stream.test.js` drops by exactly one, and the surviving occurrence is the `close:` property) turns the §3C test(s) red on the socket-close assertion — name the failing case(s). Nothing else in the file changes colour.
5. **Ordering assertions unmoved.** On the unmutated branch, every pre-existing test in `stream.test.js` passes with the same frame-count assertions (diff shows no assertion edits outside the two server-owning tests' hook lines).
6. **Not flaky under load.** `CONNECT_MS = 5000` is the bound. Why that number and not shorter: it is the same bound every other frame assertion in the file already runs under, so it adds no new flake surface; it is only ever *reached* on a red path (on-connect frames are written synchronously in the same handler turn that flushes headers — measured ~30 ms end-to-end on loopback — so a green run never waits on it); and `node --test` runs ~32 files in parallel processes, under which a tighter bound buys seconds on a path that is already red while risking a spurious red on a slow CI host. Worst-case termination of a fully red file is 12 × 5 s ≈ 60 s, inside AC-1's 120 s. **Observation:** three consecutive full host `node --test` runs on the branch, all green with the expected count; any red or count drift is a finding.
7. **Counts and receipts.** Host: `node --test` count = 468 + new. Compose: `docker compose run --build --rm test` from `apps/chat` in the worktree, quoted with the `Image … Built` line — no build line, no valid number. Same count in both.
8. **Constraints.** Zero new dependencies (`package.json` unchanged); `server.js` and every protected top-level file unchanged; no running container touched (compose `test` service only, `--rm`); ephemeral ports only (`listen(0)`); real `apps/chat/data/` never read or written (scratch copies exclude it).

## 6. Recipes

**Mutation (scratch copy preferred).** `mkdir -p scratchpad/agent-developer-lena/AS-81/mut && cp -R .worktrees/AS-81/apps/chat/. …/mut/ && rm -rf …/mut/data` (the tests import `../server.js` relatively, so copying the app root keeps every file runnable; excluding `data/` keeps real state out). Mutate `mut/server.js` at the intended site only — match the full literal `res.write(\`event: loop\ndata: ${JSON.stringify(readLoopStatus())}\n\n\`);` (and the `lanes` sibling), never a bare `res.write` — and **assert it applied there**: `grep -c 'readLoopStatus())}' mut/server.js` goes 1→0 and the `readLanes() })}` count likewise; `diff` the mutant against the worktree copy and confirm the hunk sits inside the `/api/stream` handler's `try` (line ~1005), not in `close()` or a poll. Run `cd …/mut && node --test` with the shell tool's own timeout as the alarm (note: `perl -e 'alarm…'`, `timeout`, and piped `| tail` invocations were denied in this headless tick; the plain `cd <dir> && node --test 2>&1` form works). Restore = delete the scratch copy; **prove** the worktree is untouched: `shasum -a 256` of `server.js` and `stream.test.js` in the worktree before and after the exercise are identical, and `git -C .worktrees/AS-81 status --porcelain` lists only the intended `stream.test.js` change. Fallback if scratch copying is denied: mutate in place in the worktree with a backup and `trap 'cp backup server.js' EXIT`, assert applied, observe, let the trap restore, prove with the same hash + porcelain check, then re-run the unmutated suite.

**Test run.** Host: `cd .worktrees/AS-81/apps/chat && node --test 2>&1` (record the `ℹ tests/pass/fail` lines). Compose: `cd .worktrees/AS-81/apps/chat && DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 docker compose run --build --rm test` — receipt is the `Image asc-chat-test Built` line (or equivalent name). Compose may be unavailable in a headless tick; if so, say so and the orchestrator takes the counted run.

## 7. What AS-80 can rely on after this lands

AS-80 (the vacuous `close()`-clears-timer guard) mutates `clearInterval(loopPoll)` and needs its red to be *readable*: after AS-81, a harness failure of any kind in `stream.test.js` terminates the run, so AS-80's demo never needs `--test-force-exit`, and its `process.getActiveResourcesInfo()` sampling around the line-404 test's `close()` is not confounded by a server leaked from an earlier failed test in the same file (the guarded after-hook closes it). AS-80 still owns its own assertion; nothing here pre-writes it. Note for AS-80's author: `loopPoll` is `unref()`'d, so count timers by kind, not by whether the loop stays alive.

## 8. Open questions (time-boxed: default answers apply if unresolved at implementation)

- Whether to also unify `nextFrame`'s literal `5000` default with `CONNECT_MS`. Default: yes, one constant (`FRAME_MS`) used by both — zero behaviour change.
- Server `close()` idempotency and the wider audit of server-owning tests without after-hooks: parked; file as a follow-up only if the implementer finds a third instance in this file.
