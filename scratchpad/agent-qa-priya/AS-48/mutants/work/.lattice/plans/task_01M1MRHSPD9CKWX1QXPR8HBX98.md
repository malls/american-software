# AS-80: Chat: the AS-27 close()-clears-timer guard is vacuous — deleting clearInterval leaves the suite green

Planner: agent:cto-owen (tech lead), 2026-09-11, against master e5de119 (code as of 5c98662). Complexity: low.
Source: Priya's AS-27 review, finding F1 (task description). One file in `apps/chat/test`; zero production change.

## 1. Scope

**Changes:**

1. `apps/chat/test/stream.test.js` — rework the one vacuous case, `stream: AS-27 — close() clears the loop poll timer as well as the heartbeat` (line 449), so that it can fail. Same test slot, new name, new assertions; the AS-25-style scaffolding it already has (own server, live stream, `close()` raced against a wedge timeout, `waitEnd`) stays.

**Does not change:** `apps/chat/server.js` (the behaviour is correct — the timer *is* cleared; this is a guard defect, and the chosen observable needs no seam); the AS-25 close/reap case at line 322; `package.json` (apps/chat is dependency-free by design); any other test file; fixtures.

## 2. The observable, and why not the one the finding suggested

Priya's suggested shape was `process.getActiveResourcesInfo()` sampled either side of `close()`. **It cannot see this timer.** `loopPoll` is `unref()`'d at `server.js:650` (as are `lanesPoll`:685 and `eventsPoll`:716), and on this node (v24.13.1, host; compose image `node:24-slim`) `getActiveResourcesInfo()` reports `[]` for an unref'd interval — verified with a two-line experiment during planning, not assumed:

```
unref: []            <- setInterval(...).unref() then getActiveResourcesInfo()
after clear: []
ref: [ 'Timeout' ]   <- the same interval without unref()
```

`process._getActiveHandles()` is the same story (0 handles, `hasRef() === false`) and is undocumented besides. Asserting "the stream tick count stops advancing after close()" is what the current case already does (lines 476–480), and it is vacuous for the reason Priya gave: `close()` empties `streams` first, so a leaked poll fans out to nobody.

**Chosen observable: record every interval the server arms, and assert `close()` clears each one by identity.** `t.mock.method(globalThis, 'setInterval')` installed *before* `createChatServer` records the four `Timeout` objects the constructor returns (server.js 613 heartbeat, 630 loopPoll, 664 lanesPoll, 695 eventsPoll); `t.mock.method(globalThis, 'clearInterval')` records what `close()` passes to it (1073–1076). The assertion is set inclusion: every recorded id appears among the cleared arguments. Deleting `clearInterval(loopPoll)` leaves one id un-cleared — an observed red with the leaked handle in the message.

Why this one:
- **Zero dependencies, zero production diff.** `t.mock` is `node:test`, already in use in this suite for exactly this purpose (`watcher-main.test.js:450`, AS-82 — `t.mock.method(globalThis, 'clearInterval')`, count-of-four assertion). Compose parity is therefore already demonstrated by AS-82's 478/478 receipt, not argued.
- **Real timers, not fake ones.** `mock.method` calls through to the original and records `result`, so the server gets the real `Timeout`, `.unref()` still applies (probe: `hasRef() === false` on the recorded id), and no cadence or event-loop behaviour changes under test.
- **It observes the mechanism directly.** A bare-identifier `setInterval` in an imported ESM module resolves through `globalThis` at call time; the probe (scratchpad `agent-cto-owen/AS-80-mock-probe/`, 1 pass) demonstrates the mock sees a module-internal call and that a deliberately leaked second interval is detected as exactly one.
- **Tighter than a seam.** A `timers` injection parameter on `createChatServer` was the alternative; it would add production surface whose only consumer is one test, and a fifth timer armed via the bare global would silently bypass it. The cardinality pin (§4) catches a fifth timer either way.

## 3. Key files and lines

| File | What |
|---|---|
| `apps/chat/test/stream.test.js` lines 449–482 | the case to rework (body below) |
| `apps/chat/server.js` 613, 630, 664, 695 | the four `setInterval` sites — the number the cardinality pin asserts |
| `apps/chat/server.js` 1073–1076 | the four `clearInterval` sites in `close()`; 1074 is the mutation target |
| `apps/chat/server.js` 650 | `loopPoll.unref()` — why `getActiveResourcesInfo()` is blind |
| `apps/chat/test/watcher-main.test.js` 444–465 | house precedent for the technique |

## 4. The reworked case (executable name — predict it, then make it exist)

- T1 `stream: AS-27/AS-80 — close() clears every interval the server armed, the loop poll included` (replaces the line-449 case; net host count unchanged).

Body, in order:

1. `const armed = t.mock.method(globalThis, 'setInterval');` and `const released = t.mock.method(globalThis, 'clearInterval');` — **before** `createChatServer`. (`t.mock` restores both at test end automatically.)
2. `createChatServer({ dbPath, repoRoot: FIXTURE_ROOT, dataDir, loopPollMs: FAST_POLL_MS })` exactly as today; then, **synchronously, before any `await`**, `const ids = armed.mock.calls.map((c) => c.result);`. Nothing else can interleave, so `ids` is precisely what the constructor armed.
3. `t.after(() => { for (const id of ids) clearInterval(id); });` registered immediately — so a red never wedges the runner (a leaked *ref'd* heartbeat would otherwise keep the file's process alive; see §8).
4. Cardinality before quantification: `assert.equal(ids.length, 4, 'heartbeat, loopPoll, lanesPoll, eventsPoll — update this number AND close() together')`; `assert.equal(new Set(ids).size, 4)`; every id has `typeof id.unref === 'function'` (they are real `Timeout`s, not undefined from a wrapped-away return).
5. Listen on `0`, `openStream(base, 'human:forrest')`, assert `initialLoop.event === 'loop'`, `closedByTest` guard, `Promise.race([close(), timeout])`, `await stream.waitEnd()` — unchanged from today.
6. The assertion that can fail: `const cleared = released.mock.calls.map((c) => c.arguments[0]); const leaked = ids.filter((id) => !cleared.includes(id)); assert.deepEqual(leaked, [], \`close() left ${leaked.length} interval(s) armed\`);` — compare by identity (`includes`), not by count: a `close()` that cleared the same handle twice and skipped another would pass a count.
7. `stream.close()`.

Delete lines 473–480 (the `writeFileSync` of a fake lock + `afterPolls(4)` + `pending() === 0`): that is the vacuous tail. If `writeFileSync` / `afterPolls` then have no other use in the file, drop the import / helper; if they do, leave them.

Host count after: master 480 (measured 2026-09-11 on e5de119, `node --test`, 480 pass / 0 fail) + 0 = **480**.

## 5. Acceptance criteria (numbered; M4 — each property names its falsifier)

1. T1 exists under exactly the name in §4 and passes on the unmodified branch; the line-449 case name no longer exists (`grep -c "close() clears the loop poll timer as well as the heartbeat" test/stream.test.js` → 0).
2. **Mutation M1 (§6) turns exactly `{T1}` red**, whole suite: predicted 479 pass / 1 fail, and T1's failure message names 1 leaked interval. Every other case — in particular `stream: AS-25 — close() reaps live streams and the heartbeat; shutdown never wedges` and the other two AS-27 stream cases — stays green (that is the finding: they cannot see this). The runner exits on its own (§4 step 3). Record the observed failing set; a wider or narrower set is a finding.
3. **Mutation M2 (§6) turns T1 red under `--test-name-pattern`** with 1 leaked interval named — proof the guard is not loopPoll-specific. Narrowed run only; see M2 for why the whole suite must not be run under M2.
4. `ids.length === 4` is asserted *before* the inclusion check, with the four names in the message. Falsifier: M1 must not be catchable by the count alone — under M1 the count stays 4 and only the inclusion check reds (read T1's failure output: it must come from step 6, not step 4).
5. The `t.mock` calls precede `createChatServer` in source order and `ids` is captured before the first `await` (review by reading; the falsifier is M1 — a mock installed after construction records nothing and the inclusion check passes vacuously on an empty `ids`, which criterion 4 then catches as `0 !== 4`).
6. No production change: `git diff master...feat/AS-80-close-clears-every-interval --stat` touches only `apps/chat/test/stream.test.js`. No `.lattice/`, no `server.js`, no `package.json`.
7. Host suite: 480 pass, 0 fail. Counted compose run with `--build`: same count as master's compose receipt at 7f9ac2f (AS-82's receipt: 478/478); receipt = the `Image … Built` line quoted in the comment. Host-minus-compose delta must equal master's (480 − 478 = 2); any other delta is a finding.
8. The tree is byte-identical after the mutation recipe restores it (`shasum` before === after, `git status --porcelain` empty in the worktree) and the post-restore run is green at 480 — a restored source with a stale observation is not a demonstration.

## 6. Mutations (worktree as scratch; anchored; occurrence-accurate)

General recipe, from `.worktrees/AS-80` (the implementer runs and records it; QA repeats it cold). The worktree is the scratch copy relative to master — never the main checkout — and the trap + hash prove the restore:

```
W=/Users/forrest/Code/american-software-company/.worktrees/AS-80/apps/chat
F=server.js; cp "$W/$F" "$W/$F.orig"
trap 'cp "$W/$F.orig" "$W/$F"; rm -f "$W/$F.orig"' EXIT
shasum -a 256 "$W/$F.orig"                       # hash BEFORE
node -e '<anchored edit, below>'                 # the mutation
node -e '<assert applied AT the site, below>'    # occurrence count via split(needle).length-1, never grep -c
node --test "$W"/test/*.test.js 2>&1 | tail -12  # observe (absolute paths: the Bash cwd never moves)
trap - EXIT; cp "$W/$F.orig" "$W/$F"; rm -f "$W/$F.orig"
shasum -a 256 "$W/$F"                            # hash AFTER === hash BEFORE
git -C "$W" status --porcelain                   # must be empty
node --test "$W"/test/*.test.js 2>&1 | tail -8   # green again: 480
```

- **M1** (the task's acceptance) — `server.js`, inside `close()`: delete the whole line containing `clearInterval(loopPoll)`. Anchor: `clearInterval(loopPoll)` occurs **exactly once** in `server.js` (verified on master: line 1074; the arming site at 630 is `const loopPoll = setInterval(`, a different needle). Assert applied: occurrences of `clearInterval(loopPoll)` go 1 → 0 **and** the slice of the file between `clearInterval(heartbeat);` and `clearInterval(lanesPoll);` no longer contains `loopPoll` (site-anchored, per the AS-95 sharpening). Predicted red: `{T1}` only; 479/1; T1's message says 1 leaked. Whole suite.
- **M2** (not loopPoll-specific) — `server.js`, inside `close()`: delete the line `clearInterval(heartbeat);` (occurs once; the arming site at 613 is `const heartbeat = setInterval(`). Assert applied: 1 → 0, and the slice between `stream responses would otherwise wedge` and `clearInterval(loopPoll)` no longer contains `heartbeat`. Run **only** `node --test --test-name-pattern 'AS-80' "$W"/test/stream.test.js`. Predicted: T1 red, 1 leaked, process exits (step 3 cleanup). **Do not run the whole suite under M2:** the heartbeat is *ref'd* (no `unref()` at 613–621), so the AS-25 case at line 322 — which stays green under M2 for the same fan-out-to-nobody reason — leaks a ref'd interval and the file's process never exits; the runner hangs instead of reporting. That is a pre-existing harness property, noted in §9, not fixed here.

If a predicted-red case stays green, re-read the mutated file's diff before concluding anything (CLAUDE.md, AS-95 sharpening) — a wrong-site mutation and a weak guard look the same from outside.

## 7. Test-run recipe

- Host: `node --test /Users/forrest/Code/american-software-company/.worktrees/AS-80/apps/chat/test/*.test.js 2>&1 | tail -8` → expect `tests 480`, `fail 0`. Master baseline: 480 (this plan, e5de119). Use absolute paths rather than `cd` — the Bash tool's cwd persists and a stray `cd` into the worktree redirects every later `lattice` call (CLAUDE.md working-directory hazard).
- Compose (counted, from the worktree's `apps/chat`): `docker compose run --build --rm test 2>&1 | tee /tmp/AS-80-compose.txt | tail -12`. Valid only if the output contains the `Image … Built` line; quote it. Expect 478 (criterion 7). The `test` service mounts nothing.

## 8. Constraints

Zero new dependencies (`package.json` untouched). No protected top-level file edited. No running container touched — T1 boots its own server on `listen(0)`; the compose `test` service is the only docker invocation. `lattice` commands only from the main checkout path. Branch `feat/AS-80-close-clears-every-interval`, worktree `.worktrees/AS-80`, commits as `developer-<name>` per the git identity rule, message prefix `AS-80:`. Do not touch `.worktrees/AS-73` (Ruben's review lane this tick).

## 9. Decisions and deliberate omissions

- **Rework in place rather than add a case.** A vacuous case left standing is misleading documentation; the slot, the scaffolding and the AS-27 lineage are kept, and the name now says what is proved. Net host count 480, not 481 — the number to expect is stated so a 481 is read as "the old case survived", which is a finding.
- **No `timers` injection seam on `createChatServer`.** Considered and rejected (§2): production surface with one consumer, and bypassable by a bare global call. The global mock plus the count pin sees both paths.
- **The count pin is a literal 4, not `>= 4`.** A fifth interval is a deliberate change that must update this number *and* prove `close()` clears it; `>=` is how vacuous guards creep back in.
- **The heartbeat-leak-wedges-the-runner property (M2 caveat) is not fixed here.** Making the AS-25 case at line 322 leak-proof is the same technique applied one test up; it is out of AS-80's scope (Priya's finding names the loop poll) and QA may file it if they judge it worth a task. T1's own step-3 cleanup means T1 never wedges anything.
- **Not touching `server.js` comments** (`// AS-27: same reason as the heartbeat above` at 1074 stays as-is) — a comment edit would put production in the diff for nothing.
- The planning probe under `scratchpad/agent-cto-owen/AS-80-mock-probe/` is a record, not a deliverable; it is not to be copied into the suite.

## 10. People

Implementer: `developer-lena` (self-contained low, one test file — lane doctrine; Marcus is the default chat implementer but the AS-27 stream tests were his, and the point of this task is a second pair of eyes on a guard). Either is acceptable. Reviewer: `qa-ruben` — Priya filed the finding and must not certify its fix (task description; house rule). Ruben's mandate under M6, past the list: try a mutation the plan did not name — e.g. clear `loopPoll` twice and `lanesPoll` never (a count-based guard would pass; T1's identity check must not), or arm a fifth interval in the constructor without clearing it (criterion 4 must red on `5 !== 4` before the inclusion check runs). Do not read the Lattice auto-review daemon's artifact before forming findings.

## 11. Errata (cto-owen, at merge, 2026-09-11 — from Ruben's review F-1 and Lena's implementation note)

§5.7 / §8's compose arithmetic was stale: it compared master's host count at e5de119 (480) against AS-82's older compose receipt (478) and derived a delta of 2. Observed on the branch: compose 480 == host 480, delta 0. The criterion as it should have read: "Compose count equals the host count on the same commit (delta 0); a nonzero delta is a finding." Nothing in the branch was wrong; the number in the plan was. Criterion 7 passed on the property (host and compose agree).
