Lattice-Reviewed-Commit: 4f33c57c7c101948ed477daab0dd76a2b3d0d66f

# Code Review: AS-100 — Chat: structured company-events feed

> Note for the record: this is the Lattice auto-fired review (generic actor). Per `CLAUDE.md` § "Lattice's auto-fired review is NOT the company's review gate", it does not satisfy the gate. The named `qa-*` reviewer should form their own findings before reading this.

Reviewed: `feat/AS-100-events-feed` at `16da626` (14 commits, 17 files, +2999/−42) against master, in `.worktrees/AS-100`.

## 1. Verdict

**FAIL (implementation-level)** — one contract defect in `GET /api/events` (below). Everything else on the branch is sound and the plan holds; the fix is a few lines in one function and does not touch the stream, the reconciler, or the UI.

## 2. Summary

The branch delivers the full T6 table: a pure `lib/events.js` core (envelope, ULID, tolerant parser shared with Lattice ingestion, fold, liveness reducer, projection whitelist, outcome rules), the `bin/events.js` producer CLI, the watcher reconciler (`makeEventsOps` with settle + sweep), the server tail with `company` SSE frames and `/api/events`, the AS-99 composer extension that fills the two reserved slots without changing the card's key set, the AC-18 sentence tables, and both READMEs. I ran the host suite in the worktree: **464 tests, 0 failing** (matches the implementer's count; no compose `--build` receipt exists yet, which the implementer already recorded as owed). Every AC 1–19 has a named test and I found each one present. The key finding is that `/api/events` implements `since` as an exact-match lookup *after* the `task` filter, so a `task`-filtered catch-up with a cursor taken from the global stream returns nothing forever, and the HTTP door disagrees with the CLI's `tail --since` on the same file.

## 3. Issues

**[MAJOR] apps/chat/server.js:459-464 — `/api/events?since=` is exact-match applied after the `task` filter; the two doors disagree**
`readEvents()` filters by `task` first, then does `events.findIndex(ev => ev.id === since)`; a miss yields `[]`. Two consequences, both reproduced against the real server with a three-event file (AS-7 start, AS-8 start, AS-7 end):
- `GET /api/events?task=AS-7&since=<id of the AS-8 event>` → `[]`. The AS-7 `stage_ended` after the cursor is never returned, and never will be, because the cursor id is not in the filtered set. Any client that takes `stream.lastId` (which is global) and pages a task filter forward is stuck.
- `GET /api/events?since=cev_0` → 0 events, while `node bin/events.js tail --since cev_0` on the same file → 3 rows, and `tail --task AS-7 --since <AS-8 id>` → the AS-7 `stage_ended`. The CLI uses the plan's lexical compare (`ev.id > since`, T1: "a plain string compare"); the server uses identity. The plan says `tail` has "the same filters as `/api/events`" (T3); today they answer differently for the same query. The README documents the server's behaviour as the contract, so the CLI is now the odd one out on paper while being the one that matches the plan.
**Fix:** either (a) apply `since` on the unfiltered, sorted list before the `task` filter (keeps the exact-match choice and fixes the task+since hole), or (b) switch to `ev.id > since` as the CLI does, which also makes the task+since case correct and keeps the unknown-id property the implementer wanted for any `ev_`/nonsense id that sorts above `cev_` (the existing `api-events-since-exclusive` assertions for `nonsense` and `ev_…` still pass under (b); `cev_0` would not, which is the honest semantics for a sortable id). Whichever, make the CLI and server share one `filterEvents({since, task})` in `lib/events.js` so they cannot drift again, and add a test for `task` + `since` together.

**[MINOR] apps/chat/server.js:462 vs apps/chat/bin/events.js:231 — `limit` returns the *first* N on the server and the *last* N in the CLI**
`readEvents` does `events.slice(0, capped)` (oldest N); `cmdTail` does `rows.slice(-limit)` (newest N). With a default of 200 and a growing file, a bare `GET /api/events` returns the oldest 200 events, which is rarely what a catch-up reader wants and differs from what `tail` prints. Not wrong per the plan (which says only "limit defaults to 200, caps at 1000"), but it is a second silent divergence between the two doors.
**Fix:** decide one semantic (first-N is right for forward paging with `since`; last-N is right for a bare tail) and document it in the README; or give the CLI the same slice and let `--since` do the paging.

**[MINOR] apps/chat/server.js:543-548 — `lanesKey` includes `events.lastId`, so every company event pushes a `lanes` frame, not just stage changes**
`lastId` advances on `tick_started`/`tick_ended` and on events for lanes not shown, none of which change any rendered lane field (the UI does not render `lastId`, `malformed`, or `open`). AC-17 is met for elapsed time, but the key is wider than "a stage change earns a frame".
**Fix:** drop `lastId` (and probably `malformed`/`open`) from the key, keeping `events.reason`, which the caption does render.

**[MINOR] apps/chat/public/app.js:995 — `lane-live lane-live--{live,alert,done}` classes have no rules in `style.css`**
The diff touches no stylesheet; `grep lane-live public/style.css` is empty. The comment promises the `alert` tone lets the board "find them without reading every card", but the classes are inert. Live values also lose `lane-placeholder`'s muted italic and render in the default text style, which is acceptable, but the tone distinction the code was written to provide does not exist yet.
**Fix:** add three small rules per `BRANDING.md` tokens (or drop the tone plumbing until a styling task picks it up and say so in the plan).

**[MINOR] apps/chat/lib/events.js:340-356 — a `stage_started` resets `sub: null`, silently dropping a still-open sub-agent from the open set**
If an orchestrator emits `stage_started` for the next stage without having emitted `subagent_exited` for the previous one, the open sub vanishes from `openItems()` and is never closed as `unclosed`, so the `unclosed` count under-reports exactly the procedure lapse it exists to measure. One sub per lane is a fine v1 simplification, but the fold could close the orphan as `unclosed` in-memory (or `openItems` could report it) rather than forget it.
**Fix:** on `stage_started`, if `lane.sub?.open`, keep it listed as open (or record it as `unclosed` in the fold) instead of discarding it; add a test.

**[MINOR] apps/chat/watch/advance-watcher.mjs:1868-1880 — the sweep labels a sub-agent `cut_by_timeout` even when its stage already ended `completed`**
Sequence in a live-session tick: `subagent_spawned`, then `stage_ended completed` by hand (orchestrator skipped `subagent_exited`), lock released. Thirty minutes later the sweep closes the orphan sub as `cut_by_timeout`, and because `lastEvent` is the latest event, the lane card flips from "completed" to "cut off when the tick hit its timeout" — a false record for a stage the stream itself says completed. `settle()` gets this right (`unclosed` on a clean exit); the sweep does not have a clean-exit signal, but it does know the stage is closed.
**Fix:** in `sweep()`, close an open sub whose lane's stage is already closed as `unclosed` rather than `cut_by_timeout`; and consider having `foldEvent` not let a later close event for an already-closed item overwrite `lastEvent`'s outcome.

**[MINOR] apps/chat/public/lanes.js:393-395 — `truncated` / `unreadable-stream` with no lane events reads "no event stream"**
Step 1 of `describeLive` uses `NO_STREAM_SLOT` for any non-`ok` reason. For `truncated` the stream exists and the caption says so; the slot saying "no event stream" contradicts the caption one line above. AC-18 only specifies the `no-stream` case, so this is wording, not a criterion miss.
**Fix:** a second constant for the degraded-but-present cases ("stream unreadable", "stream shrank"), or reuse the caption's reason word.

## 4. Positive Observations

- **The M4 falsifier is real and observed.** `watcher-events-timeout-closes-as-cut` asserts `outcome !== 'completed'` explicitly, `watcher-events-close-before-tick-ended` pins the (b)-before-(c) ordering, and the implementer's mutation log records the intended-site assertions the AS-95 sharpening asks for. The reconciler is a pure factory with injected fs/clock/lock, so these are unit tests, not integration hopes.
- **The `matches()` fallback defect (cycle 3) is exactly the kind of thing this company's doctrine exists to catch,** and it was caught by an integration test planting a close event the way the CLI emits one, then locked with a regression test. The write-up in the plan is honest about the fact that cycle 1's suite stayed green under the mutant.
- **Wiring order is safe.** `makeEventsOps` is constructed (line 2312) before the startup `poll()` (line 2330), so `fire()`/`settle()` never hit a temporal-dead-zone reference; the sweep is interval-only and gated on both `child` and the deploy's `lockIsBusy(nowMs)`, so there is one staleness rule. `tickStarted` is emitted synchronously between the highwater write and `spawn`, so no sweep can observe an open tick with no child and no lock during a fire.
- **The tail keeps its partial line as bytes,** not text, so a multi-byte character split across two reads cannot corrupt a line; truncation is detected and reported as a fact with the fold reset, and `/api/events` deliberately re-reads the file rather than serving the tail's memory.
- **Key-whitelist discipline is applied at both doors** (`projectEvent` on `/api/events` and on every `company` frame), tested with a grown line per type, and the fixture builds lines through `makeEvent` so a test cannot plant a shape the producer could not emit.
- **AC-16 is met precisely:** the lane card's key set is byte-identical to AS-99's, `api-lanes-key-whitelist` is unmodified, and the only AS-99 assertion edited is the top-level key list (adds `events`) plus two expectation lines in `lanes-label-task-only-not-cut-yet`, both recorded in the notes.
- **Security posture is clean.** No user input reaches a path or a shell; `since`/`task`/`limit` are string compares and a clamped integer; the host path and the fire nonce never enter the payload; the UI renders every sentence through `textContent`.
- **The pure core stays pure** (no fs, clock, or process at module scope), `lib/lattice.js` now shares `parseJsonl` with the new stream, and the README section was written from the code on the branch rather than the plan, which caught two over-claims before they shipped.
