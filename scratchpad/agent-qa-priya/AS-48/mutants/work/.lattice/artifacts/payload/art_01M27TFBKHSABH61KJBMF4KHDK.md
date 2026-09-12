Lattice-Reviewed-Commit: 8bb39c6e1b0cee53590277e49056832916762392

# Code Review: AS-80 — close()-clears-timers guard made falsifiable

Reviewed commit: f15d810 on `feat/AS-80-close-clears-every-interval` (worktree `.worktrees/AS-80`, branch base e5de119).
Reviewer: Lattice auto-fired review daemon (generic actor). Per `CLAUDE.md` § "Lattice's auto-fired review is NOT the company's review gate", this artifact is third-party tooling output. It does not satisfy the review gate; a named `qa-*` employee (plan §10 names `qa-ruben`) must record their own `--role review` comment and should form findings before reading this.

Every mutation below was run on a scratch copy under `/tmp` (since removed). The task worktree was not modified; `git -C .worktrees/AS-80 status --porcelain` is empty after the review.

## 1. Verdict

**PASS**

## 2. Summary

One test file changed, zero production diff. The vacuous AS-27 case is replaced in place by a guard that records every interval the constructor arms via `t.mock.method(globalThis, 'setInterval')`, pins the cardinality to a literal 4, and asserts by identity that `close()` released each one. The guard was proven by breaking it: the plan's two mutations and two unplanned M6 mutations all produced an observed red with the predicted message, and the whole suite is green on host and in a `--build` compose run. The only discrepancy is against the plan's arithmetic (criterion 7 predicted compose 478; the correct number is 480), not against the implementation.

## 3. Issues

**[MINOR] plan §5 criterion 7 / §7 — predicted compose count 478 is wrong; the branch reports 480 and that is correct**
The plan expects compose 478 with a host-minus-compose delta of 2, citing "AS-82's receipt at 7f9ac2f". That receipt was taken on the AS-82 branch (9d32a0c) before AS-81 merged. AS-81's merge (c841c90) added 2 test cases and AS-82's (7f9ac2f) added 10, so master at the branch base e5de119 is 480 in both environments, and a delta of 0 is the expected value. The counted run from the worktree (`docker compose run --build --rm test`, receipt ` Image asc-chat-test Built `) gives 480 pass / 0 fail, matching host 480. Read strictly, criterion 7 as written fails; read against what it was guarding for (host and compose agree; no stale image), it passes.
**Fix:** none in code. The QA employee should record the corrected expectation (compose 480, delta 0) in the review comment so the number is not carried forward as 478. Current master (8bb39c6, after the AS-73 merge) is 486 on host, consistent with the AS-74 plan's baseline.

**[MINOR] apps/chat/test/stream.test.js:504 — the red-path failure output renders handles after the cleanup hook destroyed them**
Under M2 the assertion's `actual:` prints the leaked handle with `_destroyed: true`, because node formats the diff after `t.after` has run `clearInterval(id)` on it. The message string ("close() left 1 interval(s) armed") is correct and the count is right, so this is cosmetic, but a reader could misread `_destroyed: true` as "it was cleared after all".
**Fix (optional):** map `leaked` to something stable before asserting, e.g. `assert.deepEqual(leaked.map((id) => id._repeat), [], ...)` or `assert.equal(leaked.length, 0, ...)` with the handles' `_repeat` values in the message. Not blocking; leaving the raw handle in the diff is also defensible.

**[MINOR] apps/chat/test/stream.test.js:472-478 — on a count-pin red, the sqlite store is never closed**
If the cardinality assertion at line 472 throws (the M4 shape), `close()` has not been registered as an after hook yet (that happens at line 486), so the store opened by `createChatServer` is left open while `rmSync(dir)` removes the DB file underneath it. The intervals are cleared by the line-469 hook and the server never listened, so nothing wedges (M4 exited cleanly at 8.7 ms). Red-path only.
**Fix (optional):** register the `closedByTest` guard and its `t.after(close)` immediately after `createChatServer`, before the cardinality assertions, rather than after `listen`.

## 4. Positive Observations

- **Every predicted red was observed, and the failing set was exactly as predicted.** M1 (delete `clearInterval(loopPoll)`, site-anchored, 1 → 0, slice between heartbeat and lanesPoll clears no longer mentions loopPoll): whole suite 480 tests, 479 pass, 1 fail, failing set `{T1}`, message `close() left 1 interval(s) armed`. The AS-25 close/reap case and the other AS-27 stream cases stayed green, which is precisely the finding the task exists to close. The runner exited on its own.
- **Criterion 4's falsifier holds.** Under M1 the red comes from the identity check at line 504, not the count pin at 472: the count stays 4 and only inclusion fails, as the plan required.
- **M2 (delete `clearInterval(heartbeat)`, narrowed to T1)** reds with 1 leaked, proving the guard is not loopPoll-specific, and the process exits thanks to the line-469 cleanup hook.
- **M6 probing past the list, both mutants killed.** (a) Replace `clearInterval(lanesPoll)` with a second `clearInterval(loopPoll)` so the call count stays 4: red at the identity check with 1 leaked. A count-based guard would have passed this. (b) Arm a fifth `unref()`'d interval in the constructor and never clear it: red at the count pin, `actual: 5, expected: 4`, before the inclusion check runs.
- **Source order matches criterion 5**: both mocks are installed before `createChatServer`, and `ids` is captured synchronously before the first `await`.
- **Criterion 6**: `git diff master...feat/AS-80-close-clears-every-interval --stat` touches only `apps/chat/test/stream.test.js` (37 insertions, 9 deletions). No `server.js`, no `package.json`, no `.lattice/`.
- **Criterion 1**: the old name has 0 occurrences; T1 exists under the exact §4 name and passes narrowed (1/1) and in the full suite (480/480).
- **Criterion 7 (corrected number)**: host 480/480; compose `--build` 480/480 with the `Image asc-chat-test Built` line present.
- The vacuous tail (fake lock write + `afterPolls(4)` + `pending() === 0`) was removed; `writeFileSync` and `afterPolls` remain in use elsewhere in the file (lines 299, 375, 393 and onward), so the import and helper were correctly left alone.
- The comment block explains why `getActiveResourcesInfo()` cannot be the observable and cites the AS-82 precedent, so the next reader does not re-derive the dead end.
- No new dependencies; real timers via call-through mocks, so `.unref()` semantics under test are unchanged.

Acceptance sweep (floor check, after the findings above): criteria 1, 2, 3, 4, 5, 6, 8 pass as written; criterion 7 passes on its intent (host and compose agree, receipt present) and fails only on the plan's own mis-stated constant. Findings outside the list: 2 minor, both red-path cosmetics, neither blocking.
