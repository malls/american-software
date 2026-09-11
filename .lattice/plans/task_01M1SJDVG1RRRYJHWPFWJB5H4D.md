# AS-85: AS-75 F1: the AS-27 frame-count guard is vacuous for the new build fields — R10 stays green

Planned by `agent:cto-owen`, 2026-09-11 (tick watcher:93997, loop tick 22), against master
at `cef63a8`. Parent: AS-75 (`.lattice/plans/task_01M1M0RH7TANNAJDD26CXY6W24.md`, recipe R10).
Proposed branch: `feat/AS-85-build-frame-guard`. Complexity: **low-medium** (test-mostly; one
one-line production change, §3.3).

## 1. The finding, verified against current master

Ruben's F1 holds as filed, and nothing that landed since (AS-95, AS-99, AS-100, AS-80, AS-81)
changed the facts:

- `loopStateKey` is `apps/chat/server.js:566-588`. The build projection is the single line
  `build: { id: s.build.id, desiredId: s.build.desiredId, current: s.build.current }` (:577),
  with a comment explaining why `checkedAt` is excluded.
- `readLoopStatus` (:309-336) composes `build` via `composeBuild` (:111-128) from
  `<dataDir>/deploy-state.json`; `checkedAt` is the file's `computedAt`, which the host watcher
  rewrites on every deploy-poll (60 s in production — `data/deploy-state.json` on this host
  shows exactly that shape: `desiredId`, `dirty`, `reason`, `desiredReason`, `dockerBin`,
  `dockerReason`, `computedAt`, `lastAttempt{id,at,outcome,detail}`, `runningId`).
- The frame-count test (`apps/chat/test/stream.test.js:377-420`) boots against
  `loopDataDir(t)` — an empty temp dir — and writes only `advance.lock`. No
  `deploy-state.json` ever exists there, so `build` is the constant
  `{ id: null, desiredId: null, current: null, checkedAt: null, reason: 'no-state' }` for the
  whole test. Re-adding `checkedAt` to the key cannot change the key, so R10 is green by
  construction. The other loop-frame test (:422-447) strips only the *top-level* `checkedAt`
  and also has no deploy-state; the AS-75 tests in `api.test.js:1769-1880` plant a
  deploy-state (`loopFixture().deployState()`, :1531) but only assert over GET, never frames.

So the suite has a `deployState` fixture in the right shape and a frame-counting harness, and
no test that puts the two together. That is the whole gap.

**One thing Ruben's description slightly overstates, recorded so the implementer does not
test the wrong churn:** `build.checkedAt` does not move "constantly" — it moves once per
watcher deploy-poll, because it is copied from the file, not from `Date.now()`. So the churn
the test must generate is *rewriting `deploy-state.json` with a new `computedAt` between
polls*, which is what the watcher does. A test that leaves the file untouched and waits ten
polls proves nothing about `checkedAt` even with the file present.

## 2. Scope

In: `apps/chat/test/stream.test.js` (two new tests, one shared fixture helper) and one line
in `apps/chat/server.js` (`loopStateKey`, §3.3). Out: `lib/loop-status.js`, `composeBuild`,
the client, the watcher, every other test file. No new production surface, no new endpoint.

## 3. Approach

### 3.1 Fixture: a dataDir that carries a real build

Add a small helper next to `loopDataDir` in `stream.test.js` (do not import `loopFixture`
from `api.test.js` — test files do not import each other in this suite):

```js
const BUILD_ID = 'aaaaaaaaaaaaaaaa';
/** The watcher's deploy-state.json, as it writes it (mirrors api.test.js loopFixture). */
const deployState = (over = {}) => ({
  desiredId: BUILD_ID, dirty: false, reason: 'current', desiredReason: 'ok',
  dockerBin: '/usr/local/bin/docker', dockerReason: 'candidate',
  computedAt: new Date().toISOString(), lastAttempt: null, runningId: BUILD_ID, ...over,
});
const livePid = () => ({ pid: 96123, startedAt: new Date(Date.now() - 3_600_000).toISOString(),
  heartbeatAt: new Date().toISOString() });
```

Both tests plant `advance-watcher.pid` (live) **and** `deploy-state.json` **before**
`bootServer`, and boot with `buildId: BUILD_ID`, so the primed key already reflects
`listening: true`, `build.current: true`. The on-connect frame then asserts
`hello.data.build.current === true` and `hello.data.build.desiredId === BUILD_ID` — the
cardinality check: the fixture is observed before any count is taken. (`WATCHER_STALE_MS` is
60 s; one pid write at the start covers a test that runs under two seconds.)

### 3.2 Test A — the R10 falsifier (churn earns nothing)

`'stream: AS-85 — deploy-state churn (computedAt, lastAttempt, runningId) pushes no loop frame over ten polls; a real build change pushes exactly one'`

1. Boot as in §3.1; open a stream; assert the on-connect build fields as above.
2. Ten times: rewrite `deploy-state.json` with a **fresh `computedAt`**, a rotated
   `lastAttempt` (`{ id: BUILD_ID, at: <now>, outcome: 'ok', detail: 'serving …' }` vs
   `null`), and `dockerReason` alternating `'candidate'`/`'override'`, keeping `desiredId`,
   `reason` and `runningId` fixed; then `await afterPolls(1)`. Every key-excluded field the
   watcher actually churns is exercised; nothing in the key moves.
3. `await afterPolls(2)`; assert `stream.pending() === 0`.
4. **Prove the churn was real** (the test's own "assert the mutation applied"): `GET
   /api/loop-status` and assert `status.build.checkedAt` equals the last `computedAt` written
   and differs from the first. Without this, a test whose writes silently failed would pass
   for the same reason R10 passes today.
5. Sanity positive: change `desiredId` to `'bbbbbbbbbbbbbbbb'` (with `reason: 'stale-build'`);
   `await stream.nextFrame()`; assert `event === 'loop'`, `build.current === false`,
   `build.desiredId === 'bbbb…'`. A zero-frame assertion with no positive after it is
   indistinguishable from a dead socket.
6. `afterPolls(10)`, `pending() === 0`.

### 3.3 Test B — each key field is load-bearing (one frame per real change)

`'stream: AS-85 — each build field earns exactly one loop frame when it alone changes: desiredId, current, reason'`

Sequence, each step = write file, `nextFrame()`, assert the changed field, `afterPolls(10)`,
`pending() === 0`. Steps are chosen so **exactly one key field moves per step**; this is what
lets each of M2–M4 below be killed by a distinct step:

| step | write | field that moves alone | asserts |
|---|---|---|---|
| B1 | `desiredId: 'bbbb…'`, `reason: 'stale-build'` | `desiredId` + `current` (true→false) — the one two-field step, it is the entry point | `current === false` |
| B2 | `reason: 'busy'` (build started), all else equal | **`reason`** only | `build.reason === 'busy'`, `current === false` |
| B3 | `desiredId: 'cccc…'`, `reason: 'stale-build'` | `desiredId` only (`current` stays false) | `desiredId === 'cccc…'` |
| B4 | same body with `computedAt` 11 minutes old | **`current`** only (false→null; `desiredId` still reported) | `current === null`, `reason === 'stale-state'` |

**B2 is the one-line production change.** `loopStateKey`'s build projection becomes
`build: { id, desiredId, current, reason }`. Justification, verified: `public/loop-status.js:71-74`
renders `build.reason` inside the "Live build is behind master … — <why>." sentence, and
`reason` is not in the key, so on master a `stale-build → busy` transition (the watcher began
rebuilding) never reaches a connected client until `current` flips at the end of the build.
None of `reason`'s values move per poll in a steady state (`current`, `busy`, `stale-build`,
`cooldown`, `no-git`, `inputs-dirty`, `no-docker`, plus `composeBuild`'s `stale-state`,
`no-watcher`, `unknown-build`, `no-state`, `unreadable-state`), so adding it cannot re-open
the storm the guard exists to stop; Test A's churn step (which flips `dockerReason`, not
`reason`) stays at zero frames. This settles a question the new test would otherwise have to
answer implicitly: a `reason` flip is a change, not churn. If the reviewer disagrees on
the merits they should say so as a finding; do not silently drop B2 — the test must encode
one answer or the other. Extend the existing `// AS-75:` comment at :573-576 with one sentence
naming why `reason` is in and `checkedAt` is out.

No other production change. Everything else in this task is test code.

## 4. Key files

- `apps/chat/test/stream.test.js` — §3.1 helper after `afterPolls` (:375); Tests A and B
  after the existing AS-27 frame-count test (:420). Reuse `bootServer`, `openStream`,
  `loopDataDir`, `afterPolls`, `FAST_POLL_MS`; pass `lanesPollMs: 60_000, eventsPollMs: 60_000`
  so no `lanes`/`company` frame can land in `pending()` during the zero-frame windows (the
  AS-100 events poll and AS-99 lanes poll are separate intervals — see server.js:664, :695).
- `apps/chat/server.js:577` — the projection line (B2), and the comment above it.
- Read-only context: `apps/chat/server.js:111-128` (`composeBuild`), `:309-336`
  (`readLoopStatus`), `:623-650` (the loop poll); `apps/chat/test/api.test.js:1531`
  (fixture shape to mirror); `apps/chat/public/loop-status.js:66-80` (why `reason` matters).

## 5. Acceptance criteria (M4: every property names its falsifier; reds are observed, not argued)

Mutants are applied in a scratch copy or under a `trap`-restored backup, never left in the
worktree; **each must be asserted at its intended site by `grep -c` on a pattern that can only
match that line** before the run counts. The unique anchor for the build projection is the
literal `build: { id: s.build.id, desiredId: s.build.desiredId, current: s.build.current` —
it appears once in `server.js` (the `lanesKey` block has no `s.build`).

1. **Fixture observed before counting.** Both new tests assert, on the on-connect frame,
   `build.current === true` and `build.desiredId === BUILD_ID`. Falsifier F1: boot Test A
   without `buildId` → the on-connect assertion fails (`current === null`, reason
   `unknown-build`). Expected red: `{Test A}` (Test B identical if applied there).
2. **Churn is real, and earns nothing.** Test A step 4 asserts `checkedAt` advanced across the
   churn. Falsifier F2: make the churn loop write the *same* `computedAt` each time → step 4
   red. Expected red: `{Test A}`.
3. **R10 itself.** M1: add `, checkedAt: s.build.checkedAt` inside the anchored projection
   line. Expected red: **exactly `{Test A}`** (step 3, `pending() > 0` — the churned
   `computedAt` moves the key). Test B stays green (its file is untouched between polls), and
   the existing AS-27 frame-count test stays green (no deploy-state) — record that this is the
   very vacuity being closed, not a defect in that test.
4. **`current` is load-bearing.** M2: delete `, current: s.build.current` from the anchored
   line. Expected red: **exactly `{Test B}`** at B4 (`nextFrame` rejects after `FRAME_MS`).
5. **`desiredId` is load-bearing.** M3: delete `desiredId: s.build.desiredId, ` from the
   anchored line. Expected red: **exactly `{Test B}`** at B3 (B1 still fires via `current`).
6. **`reason` is load-bearing (the B2 change).** M4: delete `, reason: s.build.reason` from
   the anchored line (i.e. revert B2). Expected red: **exactly `{Test B}`** at B2.
7. **The whole projection.** M5: replace the anchored line with `build: null,`. Expected red:
   **`{Test A, Test B}`** (A at step 5, B at B1). Anything narrower is a finding.
8. **No storm from B2.** Test A step 3 (zero frames over ten churn polls) is green on the
   branch with `reason` in the key. This is the property; its falsifier is M1 (criterion 3).
9. **Existing tests unchanged.** The two AS-27 loop-frame tests, the AS-75 `api.test.js`
   tests, and `AS-27/AS-80 close()` pass unmodified. Host suite count = baseline + 2, zero
   failing (§6). Any other delta is a finding.
10. **Receipts.** Implementer's Lattice comment records: `grep -c` output for each mutant's
    anchor before the run, the exact failing test names per mutant, the counted host run
    (`node --test` from `apps/chat`, or the absolute glob), and — for the compose run —
    the `Image … Built` line (the CLAUDE.md rule: no build line, no valid number). Findings
    first, sweep second (M5).

## 6. Predicted host test count

Baseline, run this tick from master `cef63a8` (`node --test apps/chat/test/*.test.js`, host,
no docker; full output in `scratchpad/agent-cto-owen/AS-85/baseline.txt`): **498 tests,
498 pass, 0 fail, 7.5 s** — identical to the 498/498 recorded at the AS-83/AS-74 merges.
Predicted after this task: **500 / 500 / 0** (+2: Tests A and B). The B2 production change is
expected to move no existing test; any other delta is a finding.

## 7. Seam note (AS-84 and AS-86 are being planned in parallel this tick)

| task | production files | test files |
|---|---|---|
| **AS-85 (this)** | `apps/chat/server.js` — one line inside `loopStateKey` (:577) + its comment | `apps/chat/test/stream.test.js` (additive, after :420) |
| AS-84 | `apps/chat/watch/advance-watcher.mjs` (shutdown/lock release/`lastAttempt`/`evaluate`) | `watcher.test.js`, `watcher-main.test.js` |
| AS-86 | `advance-watcher.mjs` (`IMAGE_INPUTS`), `apps/chat/Dockerfile`/`.dockerignore` | `deploy-shape.test.js` |

**No file overlap** with either sibling. Two soft seams to name: (a) AS-84's `lastAttempt`
work may change what the watcher writes into `deploy-state.json`'s `lastAttempt`; my fixture
mirrors today's shape and `lastAttempt` is not in the key, so a shape change there cannot
break these tests, but the implementer should re-check the fixture against master at merge
time and keep it honest. (b) AS-86 changing `IMAGE_INPUTS` changes the `desiredId` digest the
watcher computes, not the field's shape — irrelevant here. **Recommended merge order: AS-85
first** (smallest diff, disjoint files, test-only plus one line — it cannot conflict and it
tightens the guard the other two will run under), then AS-86, then AS-84 (the largest
watcher change; its reviewer benefits from AS-86's `IMAGE_INPUTS` being settled). If AS-84 or
AS-86 finishes first, merging it first costs nothing — the files are disjoint.

Confirmed test-mostly: the only production edit is the §3.3 projection line.

## 8. Staffing

- **Implementer: `developer-lena`.** Self-contained medium, test-mostly, in a parallel lane
  next to two watcher branches — her lane. Marcus implemented AS-75 and recorded R10 as red in
  his implementation report; the person whose report disagreed with the reviewer's
  observation is the wrong person to write the test that adjudicates it. Lena comes to
  `loopStateKey` cold.
- **Reviewer: `qa-ruben`.** He filed F1, ran R10 twice, and knows the difference between
  "the guard went red" and "the guard could not have gone red" better than anyone here. The
  AS-36 anchoring rule is about not leaking the *answer*; the answer here is a set of
  observed reds that he will reproduce himself, and the criteria list above is the plan's,
  not his. Having the filer verify the fix is the normal close-out of a finding, not a
  conflict. Tasking message for him: do not read the implementer's scratchpad; run M1–M5 from
  the anchors in §5 and compare red sets before reading the implementer's receipts. If the
  orchestrator wants a reader with no memory of F1, Priya is fine — but she should be told
  only the plan path, not F1's history.

## 9. Open questions (time-boxed; default answers apply if no one objects by review)

- Q1: should `build.reason` be in the key (B2)? **Default: yes** (§3.3). Objection routes as
  a review finding, and the test flips B2 from "one frame" to "zero frames" in the same task.
- Q2 (parked, not this task): `lanesKey` and `loopStateKey` are two hand-maintained field
  lists guarding the same storm; a shared "key-excluded fields" convention or a test that
  diffs each key's field set against the payload's would catch the next AS-85 before a
  reviewer does. Worth a small follow-up task; not in scope.
