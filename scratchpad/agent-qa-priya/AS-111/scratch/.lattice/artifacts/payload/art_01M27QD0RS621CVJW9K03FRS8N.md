Lattice-Reviewed-Commit: c24efe32c819188c2ea708f5198ff3a03a5dcf00

# Code Review: AS-82 — extract `makeWatcher()` from `main()` and put the wiring under test

Reviewed: branch `feat/AS-82-watcher-main-under-test` at `f6ffa9f` (worktree `.worktrees/AS-82`), against master `af130b0` (merge-base `33ff55b`). Plan: `.lattice/plans/task_01M1MRHSXNPEVPWJ13N1YVYXZ2.md`.

> Provenance note: this is the Lattice daemon's auto-fired review, not the company's QA gate (CLAUDE.md § Review Gate). It is third-party tooling output. The `qa-*` employee forms findings cold and should not read this before doing so.

### 1. Verdict

**FAIL (implementation-level)** — narrowly. The production change (the extraction) is correct and behaviour-preserving, all 15 acceptance criteria hold as written, and every mutation I re-ran went red. The rework is confined to `apps/chat/test/watcher-process.test.js`: its headline assertion does not prove the property the plan added it for (a mutant that keeps the interval but never calls `poll()` survives both new files), and a dangling 20 s timer makes every host suite run ~13 s slower than it needs to be. Both fixes are a few lines each. A reviewer who applies them inline and passes would also be within the company's "pass with minor fix" rule; I am not the gate, so I report the defect at the severity it has.

### 2. Summary

Reviewed the ~430-line move of `main()`'s body into an exported `makeWatcher()` factory, plus two new test files (9 harness tests, 1 real-process smoke test). The extraction is disciplined — every added line inside the factory is a move, a substitution from the plan's §3.1 table, or the enumerated scaffolding (one `return;` excepted, below) — and the harness tests assert on real files in a temp dir rather than on mock call lists. Key finding: the smoke test's `heartbeatAt > startedAt` check is satisfied by the immediate startup `poll()` (I measured the first satisfying delta at 18 ms, 60 ms after spawn), so it does not observe the `setInterval` at all; mutant M12 below survives it.

### 3. Issues

**[MAJOR] apps/chat/test/watcher-process.test.js:72 — The heartbeat assertion does not prove the poll interval, which is the one property this test exists for**
The file header (line 4) says "this proves the timer" and the comment at line 66 says `heartbeatAt > startedAt` "is only reachable if the poll interval actually ran at least twice". Neither is true: `start()` stamps `startedAt`, builds the five ops, then calls `poll()` immediately, and that startup poll writes a `heartbeatAt` a few ms later. Probe against the real entry point with the test's own env: first `heartbeatAt > startedAt` observed at delta **18 ms**, 60 ms after spawn — before the 200 ms interval could have fired once. Distinct deltas seen over 1.5 s: `0, 18, 221, 422, 624, …`.
Demonstrated by mutation on a scratch copy (M12): replace `interval = setInterval(poll, config.pollS * 1000)` in `start()` (line 2408) with `setInterval(() => {}, …)` — the process stays alive, no poll ever runs after startup. Result: **10 / 10 new tests pass**. In production that mutant is a watcher that heartbeats once at startup, then never again and never fires a message — exactly the AS-27 F3 class this task was filed to close, on the residue the plan (§2) assigned to this test. (A cruder mutant that *deletes* the interval is caught — by test 8's clearInterval count and by test 10 only because the process has no ref'd handle left and exits — so the suite is not blind to the line, but the smoke test's own assertion is vacuous with respect to its stated property.)
**Fix:** require the delta to exceed what the startup poll can produce and to reflect at least one interval firing — e.g. loop until `Date.parse(body.heartbeatAt) - Date.parse(body.startedAt) >= 2 * 200` (two `ADVANCE_POLL_S` periods), or record successive `heartbeatAt` values and require two distinct increasing ones after the first. Correct the two comments to match. Re-run M12 and record it red; M1 must stay red for `{2, 10}`.

**[MINOR] apps/chat/test/watcher-process.test.js:85-88 — `delay(DEADLINE_MS)` in the `Promise.race` keeps the test process alive for the full 20 s after the test finishes**
The test itself takes ~114 ms (spec reporter), but the losing `delay(20_000)` is a ref'd timer, so the file's process lingers until it fires. Measured: the file reports `duration_ms 20152` on three consecutive runs; the host suite went from 7.5 s on master to 21.1 s on the branch because this file is now the slowest. Marcus's report quotes "~0.5 s" for this test, which is the test's own duration, not the run's. Under compose the cost is hidden by a slower neighbour today (branch 32.5 s vs master 34.4 s) but will surface when that neighbour is fixed (AS-81's hang work is in flight in a parallel lane).
**Fix:** make the timeout cancellable — `const ac = new AbortController(); delay(DEADLINE_MS, undefined, { signal: ac.signal })` and `ac.abort()` once `exited` wins (swallow the `AbortError`), or use a bare `setTimeout(...).unref()` wrapped in a promise. Same applies to the failure-message shape: keep `code: 'timeout'` so a hung child still fails loudly.

**[MINOR] apps/chat/watch/advance-watcher.mjs:2300 — `return;` after `exit(1)` is a non-moved added line absent from the AC-12 list**
AC-12 says the implementer lists every non-moved line and QA lists any other as a finding. The `--color-moved=zebra` diff shows 162 non-moved added lines; all are §3.1 substitutions, the JSDoc, the signature, the `let` blocks, the `?? makeXOps` wrappers, the return object, or `main()`'s new wiring — except this `return;`, which is not on Marcus's seven-item list. It is harmless (unreachable in production, and the test `exit` throws), and arguably necessary so a non-throwing injected `exit` cannot fall through into the pid write. Worth one sentence in the record, not a code change. Relatedly, the `now`, `pid`, `isPidAlive` argument lines threaded into the five `makeXOps` constructions are covered by the plan's §3.1 ("threading pid / isPidAlive / now through") but not named in the report's list either.
**Fix:** add both to the implementation comment's AC-12 list; no code change.

**[MINOR] apps/chat/test/watcher-main.test.js:305 — test 2 cannot see a highwater regression during an in-flight tick (plan M6 predicted `{2, 3}`, observed `{3, 7}`)**
Confirmed Marcus's observation independently: with the highwater write deleted, test 2 stays green because its "still one spawn" assertion runs while the child is still in flight, so the `if (child) return` gate hides the re-fire. The property is still held by test 3 (settle, then two polls, no second spawn) and test 7, so AC-6 is met with an observed red. Recording it because the plan's prediction was wrong on the side it guessed, and because it is the first concrete evidence for the §9 note that the `child` gate and the lock are redundant (parked for AS-84).
**Fix:** optional — in test 2, after `driveFire`, also assert `h.highwater().messageId === 5` so the in-flight branch pins the write too. Not required for acceptance.

### Acceptance-criteria sweep (floor check — findings above come first)

Cardinality first: 3 files in the diff (as required by AC-13), 10 new `test(` blocks, 478 host tests on the branch vs 468 on master, 6 planned mutations re-run cold on the full glob plus 2 of my own.

| AC | Result | Evidence |
|---|---|---|
| AC-1 | PASS | M1 (delete heartbeat call in `poll()`, line 2195) → red `{2, 10}`, as predicted |
| AC-2 | PASS | M2 (move heartbeat below `if (child) return`, line 2195) → red `{2}`, as predicted |
| AC-3 | not re-run | Marcus reports `{3,4,7,8}` (wider); consistent with the code (test 4 reads the nonce from the lock file) |
| AC-4 | PASS | M4 (delete `releaseLock()` in `settle`, line 2166) → red `{5, 6, 9}` — wider than predicted `{5, 9}`, matches Marcus; the extra red is test 6 settling through the same path |
| AC-5 | not re-run | Marcus reports `{4}`; test 4 deep-equals argv/env against `tickArgv`/`tickChildEnv`, so the site is pinned |
| AC-6 | PASS with note | M6 (delete highwater write, line 2082) → red `{3, 7}`, not the predicted `{2, 3}`; see the minor issue above |
| AC-7 | not re-run | Marcus reports `{6}` after re-anchoring past the `makeDeployOps` duplicate |
| AC-8 | PASS | M8 (delete `unlinkSync(paths.pid)` in `shutdown`, line 2282) → red `{8, 10}`, as predicted |
| AC-9 | PASS | M9 (swap `tickEnded`/`loopOps.settle`, line 2171) → red `{5}`, as predicted; M10 not re-run |
| AC-10 | PASS | Host: master `af130b0` 468/468, branch 478/478 (N = 10). Compose with `--build`: branch `Image asc-chat-test Built`, 478/478/0, 32.5 s; master `Image asc-chat-test Built`, 468/468/0, 34.4 s. Both receipts show the build line. |
| AC-11 | PASS | the plan's `awk`/`grep -c` over `main()` prints `0` |
| AC-12 | PASS with one unlisted line | see the minor issue; every other non-moved line is enumerated scaffolding or a table substitution |
| AC-13 | PASS | `--stat` names exactly the three files; no existing test touched |
| AC-14 | PASS | all eight env fences set on the child; no `8347`, `launchctl`, or literal `apps/chat/data` outside a temp-dir join in either new file |
| AC-15 | PASS | `package.json` unchanged; imports are `node:*`, the watcher, and `../lib/events.js` |

Battery hygiene: scratch copy with `.git` removed, each mutation anchored to its enclosing function and asserted to match exactly once, edit line recorded, pristine re-copied and re-hashed between mutations. Worktree file hash before and after: `77b71a10…3866`, unchanged; `git status --porcelain` in the worktree is empty. My first M2 attempt did not apply (a line-count in my own anchor was off by one) and the run that followed was the pristine file — reported here as a non-run, not a survivor, and re-run correctly.

Adversarial probes past the list: M11 (delete the poll interval) → red `{8, 10}`; M12 (interval that never polls) → **survived**, the major finding. The `clearInterval` count in test 8 resolves the global at call time, so the mock is sound. The factories all accept the threaded `now`/`pid`/`isPidAlive` parameters (checked signatures), so nothing is silently dropped. `envNum` accepts `'0.2'` (`Number`, not `parseInt`), so the process test's 200 ms poll is real.

### 4. Positive Observations

- **The extraction is a genuine move, not a rewrite.** The `--color-moved` diff confirms it; the ops are built inside `start()` in the original order so `makeDeployOps`'s construction-time docker probe still happens after the single-instance check, exactly as the plan required and for the stated reason.
- **Tests assert on bytes on disk.** Lock body, highwater, `advance-loop.json`, and the events stream are real files under mkdtemp; only the collaborators that would reach the host are faked. Test 5 observes settle ordering from inside the two collaborators rather than arguing it from the source.
- **The harness is careful about async teardown** — it waits for `createWriteStream`'s open before removing the dir, which is exactly the class of hang AS-81 is chasing in the neighbouring lane.
- **The implementation report is honest about its own misfires.** The M2/M7 rows that did not run on the first pass are reported as non-runs, and the M6 prediction mismatch is reported as measured rather than retuned — the survivor-discipline CLAUDE.md asks for.
- **The fences on the process test are complete** and it ran three times on the host beside the live launchd watcher without touching it.
