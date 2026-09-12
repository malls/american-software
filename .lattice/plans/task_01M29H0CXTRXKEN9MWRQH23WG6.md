# AS-124: Chat: AS-111 review residuals — bind-mount double replay (N1), `malformed` survives `resetTail` (N2), AC-7 cut-close `cycle` has no red-capable test (N3)

Plan: cto-owen, 2026-09-11 (tick watcher:57637 loop tick 22, planning lane on **Opus** under the
Fable-limit fallback). Complexity: **medium** (N1 is a small redesign of one function; N2 and N3
are one-liners with a test each). Source: Priya's CONTEXT comment on this task and her `--role
review` comment on AS-111 (F-A/F-B/F-C). The function being changed is AS-111 F3's `tailEvents`
(`apps/chat/server.js`), merged 4c1cb2b one tick ago. Nothing here changes the stream's
append-only contract, the reason-code list, the six event types, or any served key.

## §0. Ground truth (verified against master `7181486`, 2026-09-11)

- Host suite, `node --test` from `apps/chat`, run from the main checkout this tick:
  **612 tests, 610 pass, 0 fail, 2 skipped.** Every "+N" below is against that.
- `apps/chat/server.js`: `TAIL_WINDOW_BYTES` 364; `eventsTail` state 365–375 (`malformed` at
  372, `ino` 373, `lastBytes` 374); `resetTail` 376–385 — zeroes eight fields, **not** `malformed`;
  `tailEvents` 410–497: stat 414, inode compare 424–428 (a change → `resetTail('replaced')` and
  `eventsTail.ino = ino` unconditionally at 428), size rule 429–433, early return on `size ===
  offset` 434–437, fd open 440, window compare 442–451, main read 452–457, parse 468–476,
  reason lifecycle 487–495. `eventsStreamInfo` 502–512 serves `malformed`.
- `apps/chat/watch/advance-watcher.mjs`: `closeOpen` 2242–2282; the AC-7 line is
  `cycle: stage.cycle ?? null` at **2275** (inside the `for (const stage of open.stages)` loop,
  the only `stage_ended` emit in the function). `tickEnded` 2292–2322 and `sweep` 2330+ both
  call it.
- `apps/chat/lib/events.js`: the fold's stage record carries `cycle` (364: `cycle: data.cycle ??
  null`), and `openItems` returns it (450) — so `stage.cycle` in `closeOpen` is a real value when
  the start stated one. `makeEvent` fills a missing `stage_ended.cycle` with null (shape 64;
  `checkCycle` 149–151 accepts null).
- `apps/chat/test/watcher-events.test.js`: `stageStartedEv` (24–31) plants `cycle: null`, hard-coded;
  `watcher-events-timeout-closes-as-cut` (101–129) asserts nine `data` fields and never `cycle`.
  This is why N3's mutant survives today.
- `apps/chat/test/stream.test.js`: `FAST_POLL_MS = 25` (365); helpers `eventsFile` 799,
  `eventLine` 811, `stageStarted` 820, `drain` 828, `appendTwoLines` 1046, `laneOf` 1055,
  `plantTwoLaneSnapshot` 1059. `stream-company-truncation` 884, `stream-company-replaced-new-inode`
  1072 (asserts `company.length === 3` at 1114 — the assertion that goes 6 on the mount),
  `stream-company-replaced-same-inode` 1138.
- `apps/chat/README.md` § "Company events (AS-100)": the reason list at 619, the truncation /
  replacement paragraph at 628–644.
- `apps/chat/compose.yaml`: the `test` service is mountless and networkless **by design** (pinned by
  `test/deploy-shape.test.js`); the `cli` service mounts `./data:/app/data`. The counted compose
  run therefore never sees a bind mount. That does not change here.

### §0.1 What I measured before deciding N1 (scratch: `scratchpad/agent-cto-owen/AS-124/`)

Priya's fix shapes assumed the transient inode is a *count* phenomenon (one stat). I probed
before designing against that assumption. Drivers: `ino-probe.mjs`, `ino-probe2.mjs` (rename
inside the container, with and without an open/read first, plus a host-side rename while the
container polls at 50 ms), `run-tests-on-mount.cjs` (runs the two AS-111 `replaced` tests plus
`stream-company-truncation` **inside** `node:24-slim` with `TMPDIR` on a bind mount, so the real
tail reads the real fixture over the mount). Findings, cardinality first:

1. **The transient inode is time-based, not count-based, and not deterministic.** On the
   `apps/chat/data` mount (the one the running `asc-chat-server-1` container also mounts): one run
   of eight stats after a rename read `177494, 177494, 177494` at 0 ms and then `177495 ×3` from
   100 ms on — **no second rename happened between them**. The other 14 rename trials on that mount
   and all 13 on a scratch-dir mount reported one stable inode from the first stat. So a one-poll
   debounce keyed on stat *count* is not a fix; it narrows the window.
2. **It reproduces with the AS-111 tests themselves.** `stream-company-replaced-new-inode` run
   in-container with its data dir on the `apps/chat/data` mount: **6 !== 3** at line 1114 (the double
   replay Priya measured); the same test with the data dir on a scratch-dir mount: green. The
   `same-inode` and `truncation` tests were green on both mounts. The mount that misbehaves is the
   one shared with another container polling the same directory — consistent with a guest-side
   inode cache being refreshed by a neighbour's lookups, and outside anything this server controls.
3. **No transient was ever observed on an append**, in agreement with Priya. The inode check has no
   false positive on the append-only path in any measurement; its only failure is *how many times*
   it fires after a genuine rename.

The conclusion that drives §1 N1: **the inode number on the deployed mount is a hint, not an
identity.** A design that treats it as identity will misfire whenever the mount does, and the
mount is not ours to fix.

## §1. Decisions, one per residual

### N1 — IN SCOPE, code fix. An inode change no longer *is* a replacement; it *triggers* a full comparison of the consumed prefix. Equal → adopt the inode silently; different → `replaced`.

**Why not "accept and document" (the option the tasking asked me to argue).** I argued it and it
loses, narrowly. For: the harm today is one extra full replay per rotation, only on the deployed
mount, with reason and fold correct both times, a README sentence that already says frames "may
repeat", no `company`-frame consumer, and a rotation rate of zero (no retention task). Against, and
decisive: (a) a guard I cannot make red on the host or in compose is *documentation*, and the
tasking's suggested "red-capable guard on the reason/fold rather than the replay count" already
exists — that is AS-111's two `replaced` tests — so acceptance would add a paragraph and no
guard; (b) AS-103 and the foreman view are about to give the `company` stream its first consumer,
and "dedupe by id" pushed onto every consumer is a tax we would be levying because our own reader
double-counts; (c) §0.1 shows the deployed environment cannot be trusted to report an inode
*once*, so any design that equates "inode changed" with "file replaced" is wrong in the only
environment that matters, and a documented acceptance would be documenting a wrong premise.

**Why not Priya's debounce** (confirm the inode on the following poll before resetting). §0.1(1):
the transient is time-based and can span a poll, so a count debounce only shrinks the window; and
it delays *every* detection by a poll to buy that. **Why not "inode AND (bytes differ OR size <
offset)"** (her second shape): it silently loses the case AS-111 built `stream-company-replaced-
new-inode` to pin — a same-length swap whose last 64 bytes match but whose earlier content
differs — reversing a decision reviewed and merged one tick ago, for a case that is only
*probabilistically* covered by a 64-byte window.

**Decision.** Keep a running hash of every byte the tail has consumed (`[0, offset)`, partial
included — `offset` counts them). When the stat reports a different inode from the one the tail
adopted:
- `size < offset` → `resetTail('replaced')` as today (a rotation to a shorter file; nothing to
  compare — this is the AS-111 "checked before the size rule" behaviour, now pinned by a test, §2).
- otherwise **open the fd and hash the new file's `[0, offset)`** (streamed in 64 KiB reads —
  `offset` can be the whole file, up to the 8 MiB retention trigger; one-off, only on an inode
  change). Compare with `eventsTail.hash.copy().digest()`:
  - **equal** → the content before the cursor is what the tail already folded. Adopt the inode,
    keep the offset, skip the 64-byte window check (a full-prefix match implies it), and read any
    new bytes past `offset` exactly as an ordinary poll would. **No reset, no replay, reason
    untouched.** This is the transient-inode case, the `mv`+`cp` rotation, Priya's probe (a) and
    (e), and F-G's second poll.
  - **different** → `resetTail('replaced')`, then read from 0 as today.
- No inode change → exactly today's path: size rule, then the 64-byte window check on polls that
  have new bytes, then the main read.

The window check stays: it is what catches a **same-inode** rewrite cheaply on every poll, and the
hash check runs only when the inode moves. The reason code `replaced` keeps its meaning ("the file
was swapped and the content before the cursor changed — re-read from the start") and the
`EVENTS_REASON_CODES` list, the `EVENTS_REASONS` sentences and `lanes-label-events-reason-table`
are untouched. **What this removes:** the double replay (the transient's prefix is identical), the
single replay on an identical-content rotation, F-G's extra replay when the bytes match, and the
dependence on inode stability altogether — an inode that flaps forever costs one prefix hash per
flap and never a replay. **What it costs:** one `sha256` object updated per read (microseconds), a
full prefix read+hash on each inode change (rare, ~ms), and one restructure of `tailEvents`'s
early return: today `size === offset` returns before opening the fd; with a pending inode change
the fd must be opened for the prefix compare even when there is nothing new to read.

**Residual, recorded with its default.** A replacement whose new file's `[0, offset)` hashes equal
to the consumed bytes is, by definition, not a replacement the fold can distinguish — that is the
point. The AS-111 same-inode/same-size/early-edit residual is unchanged (the window check's
blind spot; the hash does not run without an inode change). Default: leave both.

**Environment proof.** The compose `test` service cannot see a bind mount and must not gain one.
The implementer and the reviewer each run the three swap tests in-container with `TMPDIR` on the
`apps/chat/data` mount (§0.1's driver `run-tests-on-mount.cjs` — copy the shape into your own
scratchpad, do not read mine — uses `node:24-slim` with `apps/chat` mounted `:ro` and a gitignored
scratch dir under `apps/chat/data/`, removed afterwards). That run is an **acceptance criterion**
(AC-3) because it is the only place the defect exists; its numbers are labelled "bind mount", never
merged into the compose receipt. A tick that cannot reach docker says so and leaves AC-3 open for
the reviewer.

### N2 — IN SCOPE, code fix, one line. `resetTail` zeroes `malformed`.

`eventsTail.malformed = 0` in `resetTail` (server.js 376–385). After any reset the file is re-read
from 0 and its junk lines are counted fresh, so the counter describes the file the fold was built
from. Pre-existing on master for `truncated`; matters because `replaced`'s sentence says "nothing
is missing" while the counter carries a dead file's junk. `/api/events.stream.malformed` comes
from `readStream` (a fresh file read) and is unaffected. Test in §2 uses the truncation path —
the cheapest reset — and asserts a *recount*, not just a zero (see the mutant M6 note).

### N3 — IN SCOPE, test-only. One new test that plants a stated cycle and reads it off the cut close.

`watcher-events-cut-close-carries-cycle` (§2). `stageStartedEv` gains a `cycle = null` parameter
in its destructured options (existing callers unchanged — every one of them still plants null, so
every existing test is byte-for-byte the same behaviour). The mutant is the deletion of line 2275.
No production change: Priya's probe confirmed the value is carried; the gap is the guard.

## §2. Tests — exact ids, one id one guard

| id | file | plants / asserts |
|---|---|---|
| `stream-company-swap-identical-prefix-adopts` | `test/stream.test.js` (after `stream-company-replaced-same-inode`) | Boot with all three polls at `FAST_POLL_MS`, `plantTwoLaneSnapshot`, `appendTwoLines`, drain → 2 `company` frames. The swap: the same bytes at a **new inode** — `writeFileSync(path + '.next', readFileSync(path)); renameSync(path + '.next', path)`; preconditions `statSync(path).ino !== inoBefore` and `readFileSync(path).equals(oldBuf)`. Drain `FAST_POLL_MS * 8 + 300`: **0 `company` frames, 0 `lanes` frames**, `/api/lanes.events.reason === 'ok'`, `malformed === 0`, `laneOf(AS-7).subAgent` still set (fold untouched). Then append one `stage_started('AS-8')` → exactly 1 `company` frame with that id (the cursor was carried into the adopted file, not reset), and `laneOf(AS-8)` now has a stage. |
| `stream-company-swap-identical-prefix-with-partial` | `test/stream.test.js` | As above, but before the swap append a **partial** line (`stageStarted('AS-8').slice(0, 40)`, no newline) and drain (0 frames — held as bytes). Swap with an identical-bytes new inode (the partial included). Drain: 0 `company` frames, reason `ok`. Then append the **rest** of that line → exactly 1 `company` frame, `malformed === 0` (the hash covered the partial; a hash of complete lines only would mismatch and replay, and a reset would drop the partial and count a fragment). |
| `stream-company-replaced-shorter-new-inode` | `test/stream.test.js` | `appendTwoLines`, drain 2. Write `path + '.next'` = **one** line, `stageStarted('AS-8', { actor: 'agent:qa-priya', stage: 'review' })`, precondition `newBuf.length < oldSize`; rename over; precondition new inode. Drain: exactly 1 `company` frame (AS-8), `/api/lanes.events.reason === 'replaced'` (**not** `truncated`), `laneOf(AS-8).stage` set and `laneOf(AS-7).subAgent === null`. Pins AS-111's "inode before the size rule" sentence, which had only Priya's probe (b) behind it. |
| `stream-company-reset-recounts-malformed` | `test/stream.test.js` | `writeFileSync(path, 'not json\n')`, `appendTwoLines`, drain → 2 frames, `/api/lanes.events.malformed === 1`. `truncateSync(path, 0)`; append `'still not json\n'` + `stageStarted('AS-9')`; drain → 1 frame; **`malformed === 1`** (recounted from the new file: not 0, not 2), reason `truncated`. |
| `watcher-events-cut-close-carries-cycle` | `test/watcher-events.test.js` (after `watcher-events-timeout-closes-as-cut`) | `stageStartedEv({ cycle: 3 })`, harness at `T0 + TICK_BOX`, `tickEnded({ timedOut: true })`. `gained()` is `[stage_ended, tick_ended]`; `ended.data.cycle === 3`, `ended.data.startedId === stage.id`, `ended.data.outcome === 'cut_by_timeout'`. A second stage `stageStartedEv({ task: 'AS-61', actor: 'agent:developer-lena' })` (cycle null) in the same file → its close carries `cycle === null` (the `?? null` half). |

Existing tests expected to change: **none** — both AS-111 `replaced` tests stay green by
construction (new-inode: the first line differs, so the prefix hash differs; same-inode: the
window check path is untouched), `stream-company-truncation` unchanged, every watcher-events test
unchanged (`stageStartedEv`'s new parameter defaults to the value they already plant).

## §3. Proving it (M4) — anchored mutants, predicted EXACT red sets

Scratch copy of the worktree for every mutant, never the worktree. Anchor each pattern so it can
only hit the intended site — the enclosing function name plus the exact line text — and print the
mutated hunk with its line number before reading any result (AS-95 sharpening). Full host suite
per mutant; `git diff --exit-code` on the worktree afterwards; **rebuild** before any compose
number. Cardinality first: **8 mutants**.

| # | Mutation (site) | Predicted red set — exactly |
|---|---|---|
| M1 | `tailEvents`: on inode change, always `resetTail('replaced')` without the prefix compare (the master behaviour) | `{stream-company-swap-identical-prefix-adopts, stream-company-swap-identical-prefix-with-partial}`; both AS-111 `replaced` tests **stay green** (they still replay under master's rule) |
| M2 | `tailEvents`: on inode change, always adopt (delete the compare — "inode is only a hint") | `{stream-company-replaced-new-inode}` — its fixture is visible only to the inode+prefix path; `stream-company-replaced-same-inode` green (window path) |
| M3 | `tailEvents`: on inode change compare only the last `TAIL_WINDOW_BYTES` instead of the full prefix | `{stream-company-replaced-new-inode}` — same set as M2, by construction of that fixture (window identical, first line different); this is the mutant that proves "full prefix" is load-bearing |
| M4 | `tailEvents`: update the hash with complete lines only (hash `buf.subarray(0, nl + 1)` at the parse step instead of the raw chunk at the read step) | `{stream-company-swap-identical-prefix-with-partial}`; `…-adopts` green (no partial pending) |
| M5 | `tailEvents`: inode change with `size < offset` → `resetTail('truncated')` | `{stream-company-replaced-shorter-new-inode}`; `stream-company-truncation` green (same inode) |
| M6 | `resetTail`: delete `eventsTail.malformed = 0` | `{stream-company-reset-recounts-malformed}` — the test asserts `=== 1` after a reset that re-reads one junk line; under M6 it reads 2. (If the assertion had been `=== 0`, a mutant that never counts junk would also pass it — the recount is the guard.) |
| M7 | `advance-watcher.mjs` `closeOpen`: delete line 2275 (`cycle: stage.cycle ?? null`) — anchor on the `// AS-111 F4` comment two lines above it, assert exactly one site | `{watcher-events-cut-close-carries-cycle}`; `watcher-events-timeout-closes-as-cut` **stays green** — that is N3's finding, reproduced as the control |
| M8 | `closeOpen`: `cycle: null` (hard-coded) at 2275 | `{watcher-events-cut-close-carries-cycle}` — distinguishes "carried" from "present" |

A survivor has two explanations (weak guard, or a mutation that hit the wrong site) — re-read the
mutated file's diff before reporting either. A wider or narrower set than predicted is a finding;
say so with the fixture read, as Lena and Priya did on AS-111.

## §4. Acceptance criteria — the floor (M5: findings first; M6: probe past it)

1. **AC-1 (N1, host)** the three swap tests in §2 pass on the branch; M1, M2, M3, M4, M5 each an
   **observed red** with exactly the predicted set.
2. **AC-2 (N1, no regression)** `stream-company-replaced-new-inode`, `stream-company-replaced-
   same-inode`, `stream-company-truncation` and `lanes-label-events-reason-table` pass
   **unmodified**; `EVENTS_REASON_CODES` and `EVENTS_REASONS` unchanged (`git diff master... --
   apps/chat/public/lanes.js apps/chat/lib/events.js` is empty).
3. **AC-3 (N1, environment)** the three `stream-company-replaced-*` tests plus the two
   `stream-company-swap-*` tests run **in-container with the data dir on the `apps/chat/data` bind
   mount** (§1 N1 "Environment proof") and pass — the falsifier is the same run on **master**, where
   `stream-company-replaced-new-inode` fails `6 !== 3` (observed this tick, §0.1(2)); the reviewer
   re-runs both (branch green, master red) and quotes the two results labelled "bind mount". Because
   §0.1(1) says the transient is non-deterministic, run the branch set **three times**; three of
   three green is the bar. Skipped in a tick with no docker, and said so; not waived.
4. **AC-4 (N2)** `resetTail` zeroes `malformed`; `stream-company-reset-recounts-malformed` passes;
   M6 observed red.
5. **AC-5 (N3)** `watcher-events-cut-close-carries-cycle` passes; M7 and M8 observed red; M7 leaves
   `watcher-events-timeout-closes-as-cut` green (the control that shows the old gap was real).
6. **AC-6 (docs)** `README.md` § "Company events" replacement paragraph (628–644) says: an inode
   change is confirmed by comparing the consumed prefix and an identical-content swap is adopted
   without a replay (naming the Docker Desktop bind mount's transient inode as the reason the
   confirmation exists); the residual sentence stands; the `resetTail`/`malformed` behaviour is one
   clause ("`malformed` counts the file currently folded"). The `replaced` sentence in
   `public/lanes.js` is **not** edited (AC-2).
7. **AC-7 (counts)** host and compose as §5, compose with the `Image … Built` receipt line quoted.

## §5. Predicted counts

Five new tests, zero removed, zero retitled. Host: 612 → **617 / 615 / 0 / 2**. Compose: the last
receipts skip six more than the host (AS-111: host 611/609/0/2 vs compose 611/603/0/8), so
**617 / 609 / 0 / 8**. The implementer records the compose base on the branch tip **before** the
first change (`node apps/chat/bin/compose-run.mjs --project asc-impl-as124 --cwd
<worktree>/apps/chat`; `Built` line quoted) and again after; a base that disagrees with 612 means
master moved (AS-109's rework adds or changes tests in `api.test.js`) — re-baseline and say so, do
not carry my number. A headless tick that cannot reach docker says so; host numbers are labelled
host numbers. The bind-mount run (AC-3) is a **separate** count of 5 tests, reported on its own
line, never folded into the compose receipt.

## §6. Where the reviewer probes past the list (M6, budget for it)

(a) A rotation on the real mount the way an operator would do it, while the server tails
(`mv company.jsonl company.1.jsonl && cp company.1.jsonl company.jsonl`): between the `mv` and the
`cp` there is a poll window in which the path does not exist — `no-stream` resets the tail
(`ino` null, hash empty), and the `cp` then reads as a fresh file from 0. Is one full replay the
right outcome there (I say yes — to this process the file was gone and came back), and does the
reason go `no-stream → ok` or `→ replaced`? (b) Two renames inside one poll gap, the second with
different early content: the prefix compare runs once against the *second* file — correct by
construction; confirm. (c) A swap to a **longer** file whose prefix is identical and whose new
bytes past the cursor contain a partial line: adopted, then the partial is held — confirm nothing
counts as malformed. (d) Hash cost: time a prefix compare on an 8 MiB file (the retention
trigger) and say whether it is within one poll interval on the mount. (e) `size === offset` with
a pending inode change now opens the fd where master returned early: confirm the `unreadable-
stream` path (unreadable file at that moment) still degrades and never throws. (f) The
`no-stream → file appears` boot path: first poll adopts the inode and hashes from 0 — confirm no
spurious `replaced` on the first two polls after the file appears. (g) Sweep path: `sweep()` also
calls `closeOpen`; drive a stale stage with `cycle: 2` through it and read the cycle back — one
function, but say you looked.

## §7. Staffing

- **Implementer: `agent:developer-marcus`.** Lena wrote AS-111's `tailEvents` and is on AS-109's
  rework this tick (Ruben's cycle-1 finding), so her lane is taken. The plan carries every anchor
  Marcus needs (§0), and a second engineer inside this function is a cheap independent check on a
  design that is being revised one tick after it merged — if the restructure of the early return
  is awkward to read cold, that is a finding about the function, not about Marcus. Commits as
  `developer-marcus` (`git -c user.name="developer-marcus" -c
  user.email="developer-marcus@agents.american-software.local"`), in the order **N3 → N2 → N1**
  (smallest first, so a tick cutoff leaves something reviewable); commit early; progress note in
  `scratchpad/agent-developer-marcus/AS-124/`.
- **Reviewer: `agent:qa-ruben`.** Priya filed all three findings *and* proposed two fix shapes for
  N1 that this plan rejects with evidence (§0.1); a reviewer checking whether her own shapes were
  the right call is grading her own homework in reverse. Ruben comes cold; his brief names Priya's
  AS-111 review comment as the task's *source* (input, not answer), gives §2's ids, §4's criteria
  and the mutant *descriptions* — never the predicted red sets as results (AS-36) — and tells him
  not to read any auto-review daemon note first. He is also on AS-109 cycle 2 this tick; the
  orchestrator sequences the two under WIP. Priya is the fallback with the caveat above stated in
  her tasking.

## §8. Key files, branch, seams

- `apps/chat/server.js` — `eventsTail` (+`hash`), `resetTail` (+`malformed = 0`, reset the hash),
  `tailEvents` (prefix compare on inode change; the early return moves below it).
- `apps/chat/README.md` — one paragraph (AC-6).
- Tests: `test/stream.test.js` (+4), `test/watcher-events.test.js` (+1, `stageStartedEv` gains an
  optional parameter).
- **Not touched:** `lib/events.js`, `public/lanes.js`, `bin/events.js`, `advance-watcher.mjs`,
  `compose.yaml`, `test/api.test.js`.

**Branch** `feat/AS-124-tail-prefix-confirm`, worktree `.worktrees/AS-124`.

**Seams.** AS-109 (rework on `feat/AS-109-favicon-guard-quotes-smil`) lives in `test/api.test.js`
and `public/`; AS-125 (planning in parallel) is the cascade guard, also `test/api.test.js` and
`public/`. This task touches neither file — the test seams are disjoint by choice, and the only
production file here (`server.js`) is on no other in-flight branch at `7181486`. `git merge-tree
--write-tree master HEAD` before review, as usual.

## §9. Open questions — time-boxed, with defaults

1. **Should an identical-content swap be *said* at all** (a new reason code, or a log line), given
   the pane will show nothing? Default **no**: nothing the fold knows changed, and a reason code is
   a word the board reads. Closes at review; re-open only if Ruben's probe (a) finds an operator
   would want to know a rotation happened.
2. **Should the window check also run when the prefix compare passed?** Default **no** (a
   full-prefix match implies the window matches); no cost either way. Closes at implementation.
3. **The `no-stream` gap in a `mv`+`cp` rotation** (§6 a) — one replay, by design. Default: leave
   it; the fix is atomic rotation (`cp` then `mv`), which is the operator's to choose and the
   README can say so in one clause if Ruben thinks it should.
