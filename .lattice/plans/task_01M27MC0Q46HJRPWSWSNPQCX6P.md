# AS-111: Chat: AS-100 review residuals — pin the /api/events since-before-task-filter fix (Ruben F1, b0763ad has no test), lanesKey earns a lanes frame on every appended event (F2), tail misses file replacement (F3), (stage, actor) close fallback can close a newer rework cycle (F4)

Plan: cto-owen, 2026-09-11 (loop tick 19 planning lane). Complexity: **medium**. Source: Ruben's AS-100
`--role review` comment (F1–F4) and the CONTEXT comment on this task. The design being hardened is
AS-100's plan, `.lattice/plans/task_01M26H1TA8K3E2SSS9DY672PH1.md` — T1 (stream), T2 (fold/open set),
T4 (projection, tail, `lanesKey`). Nothing here changes the stream's append-only contract, the six
types, or the lane card's key set (AS-100 AC-16 stays green unmodified).

## §0. Ground truth (verified against master `aeeca77`, 2026-09-11)

- Host suite, `node --test` from `apps/chat`: **605 tests, 603 pass, 0 fail, 2 skipped**. That is
  the base every "+N" below is measured against.
- `apps/chat/server.js`: `readEvents` at 473–505 (the b0763ad fix is the `findIndex` on the full
  stream at 481, task filter at 487); `eventsTail` state at 361–369, `resetTail` 370–377,
  `tailEvents` 385–452 (truncation = `size < offset` at 398); `eventsStreamInfo` 457–467;
  `lanesKey` 540–575 (the `events` block at 569–574 keys on `reason, lastId, malformed, open`).
- `apps/chat/lib/events.js`: `EVENT_SHAPES` 54–67 (`stage_ended` has no `cycle`);
  `EVENTS_REASON_CODES` 73–78 (four codes); `matches()` 302–315 — id path at 305, the
  `(stage, actor)` fallback at 314; the fold keeps **one** `stage` record per lane (338–356: a
  new `stage_started` replaces the lane record wholesale, so an earlier open stage on the same
  lane is forgotten, not closed).
- `apps/chat/bin/events.js`: `closing()` 122–130 matches the open item on `(task, stage, actor)`
  only; `buildData` `stage_ended` 143–153 has no `cycle`; `FLAGS` (48–52) already accepts
  `cycle`; USAGE line 33.
- `apps/chat/public/lanes.js`: `EVENTS_REASONS` 87–98, key-set asserted against
  `EVENTS_REASON_CODES` by `lanes-label-events-reason-table` (`test/lanes-label.test.js:279`).
  The UI reads **only** `events.reason` from the projection's `events` block; `lastId`,
  `lastTs`, `malformed`, `open` are served and not rendered. No browser code consumes `company`
  frames yet (grep `company` in `public/app.js`: one comment).
- Ruben's F1 repro driver is still on disk: `scratchpad/agent-qa-ruben/AS-100/probe-since-task.mjs`
  (boots the server on port 0 against a temp `CHAT_EVENTS_PATH`; plants AS-7 start / AS-8 start /
  AS-7 end). It imports from `.worktrees/AS-100/…`, which no longer exists — the test in §2 is the
  same shape rewritten on `loopFixture`/`bootServer`, not a copy of the driver.
- Fixture repo (`test/fixtures/repo`) resolves `AS-7` and `AS-8` only; every planted event below
  uses those two ids so the lanes projection has a lane for each.

## §1. Decisions, one per finding

### F1 — IN SCOPE. One pinning test; no production change.

**Problem.** b0763ad moved the `since` cursor resolution ahead of the task filter and added no
test. `api-events-since-exclusive` never combines `task` and `since`, so the pre-b0763ad ordering
passes it — the defect was live on the branch through four green host runs. Ruben named the
test id; this plan keeps it as a **separate** test (one id, one guard, exact red set) rather than
an assertion inside the existing one.

**Deliverable.** `api-events-since-resolves-before-task-filter` (§2). Mutant: the pre-b0763ad
ordering. Observed red is the criterion.

### F2 — IN SCOPE. Drop `lastId` and `malformed` from `lanesKey.events`; keep `reason` and `open`.

**Problem.** A `lanes` frame is meant to be pushed when the pane's content changes. Every lane's
own liveness is already keyed field by field (`stageStartedAt`, `alive`, `startedAt`,
`lastEventId`, …), so any event that touches a lane earns a frame through the lane. `lastId` in
the `events` block additionally earns a frame for every event that touches **no** lane —
`tick_started`/`tick_ended` on every tick, a stage event for a task the pane does not list — and
`malformed` earns one for a hand-appended junk line. Neither field is rendered.

**Decision.** Key `events` on `reason` and `open` only. `reason` is the one field the pane reads;
`open` is kept because it is a liveness fact (the count of open stages/sub-agents company-wide)
that can move on an event for a lane the pane does not show, and it moves only on real state
change — it cannot produce a frame per event. `lastTs` was never in the key and stays out.

**Why not "open counts + reason" alone as Ruben wrote it — same thing:** that is this decision.
**Why not the `snapshot.generatedAt` argument** ("one small frame per write is the honest
feed-is-alive signal")? Because the `company` frames on the same SSE connection *are* the
per-event liveness signal; a `lanes` frame per event duplicates it with a payload that has not
changed. **Cost accepted, recorded:** a consumer that reads `events.lastId` off a `lanes` frame
sees it move only when something visible moves. No consumer does — the cursor source is the
`company` frame's own `id`, and `/api/events.stream.lastId` reports the file directly. The
boot-order comment at `server.js:672` stays true (the key still includes `events.reason`).

### F3 — IN SCOPE. Detect replacement: inode change, or the bytes before the cursor changed. New reason code `replaced`.

**Problem.** `tailEvents` starts over only when `size < offset`. A file **replaced** by one at
least as long — `mv` of a longer file over the path (new inode), `cp`/`writeFileSync` of a
restored backup over it (same inode, passes through size 0 between two polls), an editor save
(usually a new inode) — carries the old offset into the new content: the first read starts
mid-line (one `malformed`), everything before the offset in the new file is never folded, and the
projection is stale until the server restarts, with `reason: 'ok'`. No retention task exists and
none is scheduled (AS-100 T1's trigger is 8 MiB or 50 ms p50, neither near); a restore-from-backup
or a hand rotation is possible today. The detection is local to one function, so it is taken
here rather than deferred to a task that does not exist.

**Decision — two checks, both cheap, checked in this order after the `stat`:**
1. **inode.** `eventsTail.ino` (null until the first successful stat of an existing file; cleared by
   `resetTail`). `stat.ino !== eventsTail.ino` when `ino` is set → **`replaced`**. Checked on every
   poll (the stat is already taken), so a same-size swap is caught too. Checked *before* the
   size rule: a rotation to a shorter new file is a replacement, not a truncation. In-place
   `truncateSync` keeps the inode, so AC-14 (`stream-company-truncation`) is unaffected.
2. **size < offset** → `truncated`, unchanged.
3. **bytes before the cursor.** `eventsTail.lastBytes` = the final ≤ 64 bytes of what the tail has
   consumed (`Buffer.concat([lastBytes, chunk]).subarray(-64)` after every read; empty after
   `resetTail`). When `size > offset` and `lastBytes.length > 0`: `pread` exactly
   `lastBytes.length` bytes at `offset − lastBytes.length` (same `fd` as the main read — one
   open) and `equals()` them; mismatch → **`replaced`**. One extra small read, only on polls that
   have new bytes to read anyway; a poll where `size === offset` costs nothing new.

   On either `replaced`: `resetTail('replaced')`, then fall through and read from 0 exactly as the
   truncation path does — the whole new file is re-read, re-folded, and pushed as `company` frames
   (the tail reports arrivals; to this process they all are). Same lifecycle as `truncated`: the
   reason survives the poll that set it and clears on the next poll that reads a line. The UI has
   no `company` consumer, so the replay changes nothing on screen; the lanes projection re-derives
   from the corrected fold.

**Why a new reason code rather than reusing `truncated`.** The `truncated` sentence says the
stream "shrank … anything before the cut is missing from this view", which is false after a
replacement — nothing is missing, the fold is complete again. A reason code is a word the board
reads; the wrong word is the AS-100 AC-18 failure in reverse. `EVENTS_REASON_CODES` gains
`'replaced'`; the key-set guard `lanes-label-events-reason-table` goes red until `EVENTS_REASONS`
gains its sentence — that is the guard working, not a regression. **Wording constraint** (AS-100
cycle-5 note): the sentence may not contain the bare enum word. Suggested: *"the company event
stream file was swapped out underneath the server — rotated or restored — and has been re-read
from the start; nothing is missing, but the live frames from before the swap may repeat"*.
`README.md` §"Company events" (the reason list at ~607 and the truncation paragraph at ~616) gains
the code and the two checks.

**Residual, recorded with its default:** same inode, same size, contents edited before the last 64
bytes (an in-place edit of an early line) is not detected until a later mismatch; the fold is stale
for that line. Default: leave it — nothing edits the file (watch/README.md: "nothing edits or
deletes a line, ever"), and a check that catches it costs a full re-read per poll. Revisit only if
retention introduces in-place rewriting.

### F4 — IN SCOPE. `stage_ended` carries `cycle`; a close and an open with two *stated* cycles that differ never match. Sub-agents deferred.

**Problem, stated more widely than the finding.** A `stage_ended` identifies its stage by
`(task, stage, actor)`, which is not unique across rework cycles. Ruben's case is the fold
fallback at `matches():314`; the same ambiguity sits one step earlier in the CLI's `closing()`
lookup, which fills `startedId` from the **current** open item on the triple — so a late close
for cycle N's implement stage, emitted after cycle N+1's `stage_started` on the same employee,
gets `startedId = <cycle N+1's id>` and closes it *by the id path*, not the fallback. Both paths
need the same fix. Reachable only through a procedure violation (a stage left open across a
rework transition, then closed by hand after the next cycle opened), which is exactly the kind of
late correction an orchestrator makes.

**Decision.** `EVENT_SHAPES.stage_ended` gains `'cycle'` (appended last, so every existing key
keeps its position; `makeEvent` fills it `null` for every existing producer, so nothing that
emits today breaks). `validate()` applies `stage_started`'s positive-integer rule to it. The rule,
in both places: **a mismatch exists only when both sides state a cycle and they differ.** A null on
either side matches on the triple as today (a hand close without `--cycle`, a start emitted without
one — "not stated" must not strand a close).
- `lib/events.js` `matches()`: after the triple compares, `if (ev.data?.cycle != null && open.cycle
  != null && ev.data.cycle !== open.cycle) return false`. Sub-agent records have no `cycle`
  (`undefined`), so sub-agent closes are untouched by construction.
- `bin/events.js` `closing()`: the same predicate on `item.cycle` (`openItems` already returns it);
  `buildData('stage_ended')` gains `cycle: intFlag(flags, 'cycle')`; USAGE line gains
  `[--cycle <k>]`.
- `watch/advance-watcher.mjs` `closeOpen` (~2262–2275): `cycle: stage.cycle ?? null` on the
  `stage_ended` it builds — the record should say which cycle the reconciler cut; matching there
  is by `startedId` regardless.
- `README.md` shape table (~570) and CLI usage (~581) gain the key/flag and one sentence with the rule.

**Why not "prefer the oldest open".** The fold keeps one stage record per lane (§0); the older one
is gone by the time the close arrives. Keeping a list of opens per lane changes `reduceLiveness`'s
notion of "the current stage" for an edge that a one-key schema addition closes. **Sub-agents
deferred, with reason:** `subagent_spawned` carries no cycle either, so the fix there is two more
shape keys and two more flags for the same procedure-violation edge; a sub-agent's cycle is its
enclosing stage's. Recorded here; re-open if a reviewer reproduces harm from it.

**Metawork wording (employees do not edit `advance.md`; the layer applies it):** in the AS-100 T5
paragraph's third bullet, after `--outcome completed|error`, add: "(on a rework cycle, the same
`--cycle <k>` the stage's `stage_started` carried)". One clause; the rest of the paragraph stands.

## §2. Tests — exact ids, one id one test

| id | file | what it plants and asserts |
|---|---|---|
| `api-events-since-resolves-before-task-filter` | `test/api.test.js` (append after `api-events-key-whitelist`) | Three lines via `fx.eventLines`: AS-7 `stage_started` (lena, implement), AS-8 `stage_started` (priya, review), AS-7 `stage_ended` (lena, `startedId: null`). Cardinality first: `/api/events` → 3. Then `task=AS-7&since=<AS-8 id>` → exactly `[<AS-7 stage_ended id>]`; `since=<AS-8 id>` alone → the same one id (the two doors agree); `task=AS-7&since=<AS-7 start id>` → `[stage_ended]`; `task=AS-8&since=<AS-8 id>` → `[]` (exclusive, nothing after it in AS-8). |
| `stream-lanes-no-frame-for-laneless-event` | `test/stream.test.js` (after `stream-lanes-liveness-change-only`) | Boot with all three polls at `FAST_POLL_MS`, open the stream. Append a `tick_started` line → `drain()`: exactly **1** `company` frame and **0** `lanes` frames. Append a junk line (`'not json\n'`) → 0 `company`, 0 `lanes`. Then append AS-7 `stage_started` → exactly 1 `lanes` frame (the control: the key still moves for a real change). |
| `stream-company-replaced-new-inode` | `test/stream.test.js` | Plant two lines (AS-7 `stage_started` lena; AS-7 `subagent_spawned`), boot, drain 2 `company` frames; `/api/lanes` → AS-7 lane has `subAgent`, AS-8 lane has none. Build the replacement: line 1 rewritten as the **same event with `task: 'AS-8'`, `worktree: '.worktrees/AS-8'`, `branch: 'feat/AS-8-thing'`** (same byte length — assert `Buffer.byteLength` equal, a precondition that fails loudly if the fixture drifts), line 2 unchanged, plus a third line (`tick_started`, so AS-8 stays open). Write it to `path + '.next'` and `renameSync` over `path`. Precondition assertion: `newBuf.length >= oldSize` and the bytes at `[oldSize−64, oldSize)` are identical to the old file's (this fixture must be one the bytes check **cannot** see, so the inode check is the only guard). Drain: `company` frames === 3 (the whole file re-read), at least one `lanes` frame whose `events.reason === 'replaced'` (the pane learns by push, not by poll), `/api/lanes.events.reason === 'replaced'`, `events.malformed === 0`, AS-8 lane now has `subAgent`, AS-7 lane none. Append one more line → reason `'ok'`. |
| `stream-company-replaced-same-inode` | `test/stream.test.js` | Plant two lines as above, drain 2. `writeFileSync(path, newContent)` where `newContent` is three lines whose first line **differs in length** from the old first line (e.g. a different `branch` string), so the old offset lands mid-line — precondition assertion: `newBuf[oldSize − 1] !== 0x0a`. Record `statSync(path).ino` before and after and assert **equal** (so the inode check cannot be the guard). Drain: `company` frames === 3, at least one `lanes` frame with `events.reason === 'replaced'`, `/api/lanes` reason `'replaced'`, `malformed === 0` (under no detection: a mid-line fragment counts 1 and the frame count is wrong). |
| `events-close-matches-cycle` | `test/events.test.js` | Pure fold. S1 = `stage_started` (AS-7, implement, lena, cycle 1); S2 = same, cycle 2 (replaces S1 in the fold). Close C1 = `stage_ended` (implement, lena, `startedId: null`, `cycle: 1`) → `openItems().stages` still lists S2 (id === S2.id), `lane.lastEvent.id === C1.id`. Then C2 with `cycle: 2` → closed. Then the null rule: S3 (cycle 3) + close with `cycle: null` → closed (a close that states nothing matches on the triple, as today). And the shape: `EVENT_SHAPES.stage_ended` ends with `'cycle'`; `makeEvent({type:'stage_ended', data:{…, cycle: 0}})` throws. |
| `events-cli-close-lookup-honours-cycle` | `test/events-cli.test.js` | Spawn the bin: emit `stage_started --cycle 1`, `stage_started --cycle 2` (same task/stage/employee), then `stage_ended --cycle 1 --outcome completed`. Read the file: the close has `startedId: null` and `cycle: 1`; `events open --json` still lists one open stage whose `id` is the cycle-2 start's. Then `stage_ended --cycle 2` → `open` is empty and its `startedId` is the cycle-2 id. `--cycle 0` on `stage_ended` → exit 1, no line written. |

Existing tests expected to change: **none**. `lanes-label-events-reason-table` needs no edit — it
reads both lists; it goes red only until `EVENTS_REASONS` gains the `replaced` sentence.
`api-events-key-whitelist` derives from `EVENT_SHAPES` and passes with the new key unmodified.
`api-lanes-key-whitelist` (AS-99) untouched — the lane card's keys do not change (AS-100 AC-16).

## §3. Proving it (M4) — anchored mutants, predicted EXACT red sets

Scratch copy of the worktree for every mutant; assert the mutation landed at the named site
(print the line) before reading a result (AS-95 sharpening); `git diff --exit-code` on the
worktree afterwards. Host `node --test` for the red sets; the compose receipt in §5.

| # | Mutation (site) | Predicted red set — exactly |
|---|---|---|
| M1 | `server.js` `readEvents`: move the `since` block below the task filter (the pre-b0763ad ordering) | `{api-events-since-resolves-before-task-filter}` — and **`api-events-since-exclusive` stays green**, which is the point of the new test |
| M2 | `server.js` `lanesKey`: put `lastId: p.events.lastId` back in the `events` block | `{stream-lanes-no-frame-for-laneless-event}` |
| M3 | `lanesKey`: put `malformed` back | `{stream-lanes-no-frame-for-laneless-event}` |
| M4 | `lanesKey`: drop `reason` from the `events` block (the one field F2 keeps because the pane reads it) | `{stream-company-replaced-new-inode, stream-company-replaced-same-inode}` — their "a `lanes` frame carries `replaced`" assertion is the only push-side guard on `reason`; `stream-company-truncation` stays green (it reads `/api/lanes`, not a frame — AS-100 AC-14's known shape) |
| M5 | `tailEvents`: delete the inode compare | `{stream-company-replaced-new-inode}` — the same-inode test must stay green (its inode is asserted unchanged) |
| M6 | `tailEvents`: delete the bytes-before-cursor compare | `{stream-company-replaced-same-inode}` — the new-inode test must stay green (its window bytes are asserted identical) |
| M7 | `tailEvents`: report both detections as `'truncated'` | `{stream-company-replaced-new-inode, stream-company-replaced-same-inode}`; `stream-company-truncation` green |
| M8 | `public/lanes.js`: remove the `replaced` sentence | `{lanes-label-events-reason-table}` (the existing guard, proven against this change) |
| M9 | `lib/events.js` `matches()`: delete the cycle predicate | `{events-close-matches-cycle}` |
| M10 | `bin/events.js` `closing()`: delete the cycle predicate | `{events-cli-close-lookup-honours-cycle}` — `events-close-matches-cycle` stays green (pure fold) |
| M11 | `lib/events.js` `matches()`: treat a null on either side as a mismatch | `{events-close-matches-cycle}` (the null-rule case) — and, expected, the AS-100 tests that plant `startedId: null` closes without a cycle **stay green** because the start events in those fixtures carry `cycle: 1` and the close carries null → under M11 they would NOT close: predicted additional reds `{api-events-since-exclusive, stream-lanes-liveness-change-only, stream-company-truncation}`. A narrower set means the fixtures changed; say so |

A survivor has two explanations (weak guard, or a mutation that hit the wrong site) — re-read the
mutated file's diff before reporting either. Report cardinality (11 mutants run) before results.

## §4. Acceptance criteria — the floor (M5: findings first; M6: probe past it)

1. **AC-1 (F1)** `api-events-since-resolves-before-task-filter` exists, passes on the branch, and M1
   is an observed red on it alone.
2. **AC-2 (F2)** `lanesKey.events` keys on exactly `{reason, open}`; `stream-lanes-no-frame-for-
   laneless-event` passes; M2, M3 and M4 each observed red. `stream-lanes-liveness-change-only`
   (AS-100 AC-17) passes unmodified.
3. **AC-3 (F3)** `EVENTS_REASON_CODES` is exactly `['ok','no-stream','unreadable-stream','truncated',
   'replaced']`; `EVENTS_REASONS` has a sentence for it that does not contain the word "replaced"
   (the AC-18 lexical guard is the check); M5, M6, M7, M8 observed red as predicted.
4. **AC-4 (F3)** `stream-company-truncation` passes unmodified: in-place truncation still says
   `truncated`, not `replaced`.
5. **AC-5 (F4)** `EVENT_SHAPES.stage_ended` ends with `'cycle'`; `makeEvent` fills it null when
   absent (every existing test that builds a `stage_ended` passes unmodified); `cycle: 0` throws.
6. **AC-6 (F4)** `events-close-matches-cycle` and `events-cli-close-lookup-honours-cycle` pass;
   M9, M10, M11 observed red as predicted, including M11's wider set.
7. **AC-7 (F4)** the watcher's `closeOpen` `stage_ended` carries `cycle` from the open item;
   `watcher-events-timeout-closes-as-cut` passes unmodified (it asserts fields, not the whole
   `data`).
8. **AC-8 (docs)** `README.md`: the `stage_ended` row lists `cycle`; the CLI usage shows
   `[--cycle <k>]` on `stage_ended`; the reason list names `replaced` and the paragraph at ~616
   names both detections (inode; bytes before the cursor) and the residual (same inode, same
   size, early edit). `bin/events.js` USAGE matches the README.
9. **AC-9 (counts)** host and compose counts as §5, compose with the `Built` receipt line quoted.

**Where the reviewer probes past the list (M6, budget for it):** (a) hand-rotate a live stream the
way an operator would — `mv company.jsonl company.1.jsonl && cp company.1.jsonl company.jsonl`
while the test server tails it (the `cp` lands a new inode with identical bytes: is `replaced`
the right word, and does the replay of frames matter to anything?); (b) a replacement whose new
file is **shorter** than the offset but a new inode — the plan says `replaced` wins; confirm the
word and that the fold is right; (c) a `stage_ended` with `--cycle` for a stage whose
`stage_started` had none — matches on the triple; is that the right lenience, or does it
reintroduce F4 through the null? (d) `/api/events?task=AS-7&since=<id of a malformed-adjacent
line>`; (e) the `company` replay after `replaced`: does anything dedupe by id, and should the
README say a consumer must? (f) run every stream test inside compose, not only on the host — the
inode/`rename` semantics on the bind mount are the thing this task trusts.

## §5. Predicted counts

Six new tests, zero removed, zero retitled. Host: 605 → **611** (609 pass, 0 fail, 2 skipped).
Compose: the last two receipts on master-adjacent branches skipped six more than the host
(AS-120: host 555/554/0/1 vs compose 555/548/0/7; AS-106: 571/569/0/2 vs 571/563/0/8), so
predicted **611 / 603 / 0 / 8**. The implementer records the compose base on the branch tip
*before* the first change (`node apps/chat/bin/compose-run.mjs --project asc-impl-as111 --cwd
<worktree>/apps/chat`, AS-106's recipe; `Built` line quoted) and again after; a base that
disagrees with 605 means master moved (AS-109/AS-112 add tests) — re-baseline and say so, do not
carry my number. A headless tick that cannot reach docker says so; host numbers are labelled host
numbers.

## §6. Key files, branch, commits, seams

- `apps/chat/server.js` — `lanesKey` (§1 F2), `eventsTail`/`resetTail`/`tailEvents` (§1 F3).
- `apps/chat/lib/events.js` — `EVENT_SHAPES.stage_ended`, `validate`, `EVENTS_REASON_CODES`, `matches`.
- `apps/chat/bin/events.js` — USAGE, `closing`, `buildData`.
- `apps/chat/watch/advance-watcher.mjs` — one key in `closeOpen`'s `stage_ended`.
- `apps/chat/public/lanes.js` — one `EVENTS_REASONS` entry.
- `apps/chat/README.md` — three edits in §"Company events (AS-100)".
- Tests: `test/api.test.js`, `test/stream.test.js`, `test/events.test.js`, `test/events-cli.test.js`.

**Branch** `feat/AS-111-events-residuals`, worktree `.worktrees/AS-111`. Commits as
`developer-lena` (`git -c user.name="developer-lena" -c user.email="developer-lena@agents.american-software.local"`),
one per finding in the order F1 → F2 → F4 → F3 (F3 is the largest and the only one that touches
the UI; land the three small ones first so a tick cutoff leaves something reviewable). Commit
early; progress note in `scratchpad/agent-developer-lena/AS-111/`.

**Seams.** AS-109 (favicon guard, test-only) and AS-112 (roster CSS guard) are planning in
parallel; neither touches the files above. No in-flight branch touches `server.js` or
`lib/events.js` at planning time (WIP was empty at `aeeca77`). `git merge-tree --write-tree master
HEAD` before review, as usual.

## §7. Staffing

- **Implementer: `agent:developer-lena`.** She wrote the tail (the bytes-not-string `partial`
  decision that F3's detection extends), the fold, and the CLI's `closing()` — every site here is
  hers, and the changes are surgical inside them. If her lane is taken by a sibling task, Marcus
  can take it from this plan without a handover; the line anchors in §0 are for that case.
- **Reviewer: `agent:qa-priya`.** Ruben authored F1–F4 and proposed the shape of two of the fixes
  ("open counts + reason", "inode/ctime"). A reviewer verifying that his own findings were
  addressed by his own suggested mechanisms is grading the acceptance of his own homework — the
  risk is not that he misses a regression, it is that he does not ask whether `replaced` is the
  right detection or whether the cycle rule is the right rule. Priya comes to the code cold. The
  tasking message gives her §2's ids, §4's criteria and the mutant *descriptions* — never the
  predicted red sets as results (AS-36) — names Ruben's AS-100 review comment as the task's source
  (it is the input, not the answer), and tells her not to read any auto-review daemon note first.
  Ruben is the fallback if Priya's lane is saturated, with the caveat above stated in his tasking.

## §8. Open questions — time-boxed, with defaults

1. **Should `replaced` clear immediately** (nothing is missing after the re-read) rather than on
   the next appended line like `truncated`? Default **no** — one lifecycle for both words, one
   code path; the caption tells the board a swap happened, which is worth one poll. Closes at
   review; re-open only if Priya's probe (a) finds the caption misleading in practice.
2. **Sub-agent cycle** (§1 F4 deferral). Default **deferred**; box closes when a reviewer
   reproduces harm, not before.
3. **Metawork clause for `advance.md`** (§1 F4). Proposed here; the tick that merges this carries
   it in its report for the metawork layer. No employee edits the file.
