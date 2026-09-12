# AS-3 — Chat app: tighten markRead bounds + make CLI reads side-effect-free

**Planner:** agent:cto-owen (planning pass 2026-08-30). Task filed by qa-priya at chat-app v1 (post-AS-2).
This task predates AS-5..AS-13, so the first job of this plan was re-verifying the complaint
against current code. Verdict: **both original findings are still real**, essentially unchanged,
and one of them has quietly become an *export-churn* bug since AS-5. Scope below is exactly the
two original findings — nothing was fixed in the interim, nothing new is being smuggled in.

## 1. Still real vs. obsolete (verified 2026-08-30, master @ f2754aa)

### Finding 1 — `markRead` accepts an out-of-bounds watermark: STILL REAL
`apps/chat/lib/store.js` `markRead()` (lines ~557–573): `upTo` is validated only as a
non-negative integer. There is no upper bound against `maxMessageId(conv.id)`. Passing
`upTo = 999999` writes a poisoned watermark: every future message in that conversation
arrives already-read and never shows in `unreadFor`/`unreadCountFor`. The monotonic
`MAX(last_read_id, excluded.last_read_id)` upsert (good, keep) makes the poisoning
*irreversible* through the public API — which is why this deserves fixing.

Reachable surfaces for a caller-supplied `upTo`:
- HTTP `POST /api/read` (`server.js:137`) passes `body.upTo` straight through. **Exposed.**
- CLI `chat read` never passes `upTo` (always marks to max). Not exposed.
- Web UI (`public/`) never sends `upTo` (grep-verified). Not exposed.
- No test anywhere exercises an over-max `upTo`.

So: exactly one externally reachable surface, zero legitimate callers of over-max values.

### Finding 2 — CLI read paths get-or-create the DM conversation row: STILL REAL
`apps/chat/bin/chat.js` `resolveConv()` (lines ~80–96) calls `store.openDm(me, other)`
unconditionally for `@identity` refs. The `createDm` option is parsed but **dead** — the
`if (!createDm)` block is an empty comment apologizing for the behavior. Affected commands:
- `chat history @x` — pure read, creates a DM conversation row for a never-messaged pair.
- `chat read @x` — read-state write, but also creates the conversation row from nothing.
- `chat reply @x#N` — thread replies require an existing message, so creating the conv is
  never useful (the reply fails on `Unknown thread root` afterward anyway, leaving the row).

**New since filing (makes this worse, not obsolete):** AS-5 exports every DM conversation as a
`dm-*.jsonl` file. A stray `chat history @x` against a never-DM'd pair now creates a new export
file (header line, zero messages) on the next `chat export` — a pure read producing a git diff.
Fixing Finding 2 is now an export-hygiene fix too.

**New since filing (makes the fix easy):** AS-8 added `store.dmConversationFor(me, other)` —
a pure dm_key lookup that never creates, built for the roster. It is exactly the primitive
`resolveConv` needed and didn't have at AS-2 time.

### Parts of the folklore around this task that are NOT real (verified, no action)
- **No CLI command mutates `read_state` as a side effect.** `chat inbox` does not mark read —
  it prints unread and tells you to run `chat read`/`chat catchup`. `chat history` does not
  mark read. `read`/`catchup` mutate read_state *explicitly* — that is their purpose, not a
  side effect. The "side-effect-free reads" half of this task is entirely about the
  conversation-row creation in Finding 2, exactly as qa-priya originally filed it.
- **HTTP read surfaces are already clean**: roster uses `dmConversationFor`; only
  `POST /api/dms` (explicit) creates DMs.

## 2. Semantics decisions (recorded here as the decision of record)

**D1 — Over-max `upTo` is REJECTED, not clamped.** `markRead` throws
`StoreError` (\`Invalid upTo\`-family message naming the current max) when
`Number(upTo) > maxMessageId(conv.id)`. Rationale: messages are insert-only with monotonic
ids in a single SQLite DB, so no caller can have legitimately observed an id above the
committed max — an over-max `upTo` is *always* a caller bug, and clamping would silently
mask it while rejection surfaces it (HTTP 400 via the existing StoreError mapping). There is
no legitimate-race counterargument: if a caller saw id N, id N was committed. The check goes
**inside the tx** so the compare-and-upsert is atomic under BEGIN IMMEDIATE. Unchanged and
still valid: `upTo` ≤ current max (including 0 and values below the current watermark —
no-op via MAX), and `upTo == null` → mark to max.

**D2 — Delivery semantics are unchanged; recorded explicitly.** The delivery model
("message delivered when recipient reads") rests on the *explicit* acknowledgment commands:
- `chat read`, `chat catchup` (and `POST /api/read`, `POST /api/catchup`) **do mark read** —
  they are the delivery acknowledgments. Keep.
- `chat inbox` **does not mark read** today and stays that way — an agent may crash between
  seeing and acting; auto-marking on display would fabricate delivery. Keep non-mutating.
- `chat history`, `chat roster`, `chat task`, `chat channels`, `chat dump`, `chat export`
  are pure reads and stay pure. Keep.
This is a no-op decision (status quo preserved), but it is the semantics ruling AS-3 asked
for and reviewers should treat it as binding: nobody "fixes" inbox to auto-read later
without reopening this decision.

**D3 — DM conversation rows are created only by explicit send/open paths.**
Creators: `chat dm` (CLI), `POST /api/dms` (HTTP), `store.openDm` (API). Everything else
resolves via `dmConversationFor` and treats "no DM yet" per-command:
- `history @x` → exit 0, prints a friendly empty result (e.g. `No DM with @x yet — 'chat dm x "…"' starts one.`);
  `--json` emits `{"conversation": null, "messages": [], "threads": {}}`. No row created.
- `read @x` → exit 0, no-op (`Nothing to mark read — no DM with @x yet.`); idempotent for
  scripts. No row created.
- `reply @x#N` → exit 1 (the referenced message cannot exist in a nonexistent DM). No row created.
- Error-quality preserved: the pure path must `requireIdentity(other)` first (typos still fail
  with `unknown_identity`, not a misleading "no DM yet") and must reject `@me == other`
  (self-DM) with the same error `openDm` gives.

**D4 — Export invisibility confirmed.** `exportFiles()` reads only identities/conversations/
messages; `read_state` is excluded by design and `test/export.test.js:80` already locks
"read_state churn must not change the export". The markRead change touches only validation +
read_state, hence provably export-invisible. Finding 2's fix *removes* an export-churn source
(phantom `dm-*.jsonl` files). `chat dump` still includes read_state — it is the explicit
backup surface, not the deterministic git export; unchanged.

## 3. Implementation scope

Files touched (small, ~30 lines of prod code):
1. `apps/chat/lib/store.js` — `markRead`: move the `target` validation + a
   `target > maxMessageId(conv.id)` rejection inside the tx; keep the MAX() upsert.
2. `apps/chat/bin/chat.js` — `resolveConv`: make `createDm` honest or (preferred) split it:
   `@` refs resolve via `requireIdentity(other)` + self-check + `dmConversationFor`; return
   the conversation or a "no DM yet" signal the three call sites (`history`, `read`, `reply`)
   handle per D3. Delete the dead apologia comment block. `chat dm` keeps calling
   `store.openDm` directly.
3. Tests (see §4). No server.js change (it inherits the store fix), no UI change, no schema
   change, no export-format change.

Out of scope, noted for the log: the 2 pre-existing local test failures on node v24.13.1 are
the `node:sqlite` ExperimentalWarning polluting stderr in the two strict stderr-comparison CLI
tests (85/85 pass with `NODE_OPTIONS=--no-warnings`). Environmental, unrelated to AS-3; if it
shows up again next session it becomes its own task per the recurring-observation rule.

## 4. Test plan

Baseline: suite is 85 tests, 85 pass (with `NODE_OPTIONS=--no-warnings` under node 24; the two
warning-polluted stderr comparisons are a pre-existing env artifact, see §3). Additions:

store.test.js
- `markRead` rejects `upTo` > max (fresh conversation with 0 messages: `upTo:1` throws; after
  posts: `max+1` throws, message names the bound; StoreError, watermark unchanged after throw).
- `markRead` still accepts `upTo == max`, `upTo == 0`, `upTo` below current watermark (no-op),
  and `upTo == null` (mark-to-max). (Extends the existing monotonicity test at line ~187.)

api.test.js
- `POST /api/read` with over-max `upTo` → 400, and a follow-up unread count proves the
  watermark did not move.

cli.test.js
- `history @never-dmd` → exit 0, friendly empty output, and **no conversation row created**
  (assert via reopened store / `dmConversationFor` null / conversation count).
- `read @never-dmd` → exit 0 no-op, no row.
- `reply @never-dmd#1` → exit 1, no row.
- `history @typo-identity` → still fails with unknown-identity wording (error quality kept).
- `chat dm` still creates + posts (regression guard on the one legitimate create path).

export.test.js
- `chat history @x` (or store-level equivalent: resolve-without-create) produces **zero new
  export files**; existing read_state-churn determinism test stays green.

Expected end state: 85 → ~93 tests, all green (exact count settled in implementation).

## 5. Acceptance criteria

1. `store.markRead(me, conv, upTo)` throws `StoreError` for any integer `upTo` greater than
   the conversation's current max message id; the read_state row is untouched on rejection.
2. All previously valid `markRead` calls behave byte-identically (monotonic MAX upsert,
   null→max default, visibility gating untouched).
3. `chat history @x`, `chat read @x`, `chat reply @x#N` never insert a `conversations` (or
   `conversation_members`) row; behavior on missing DM matches D3, including exit codes.
4. `chat dm`, `POST /api/dms`, `store.openDm` remain the only DM-creating paths.
5. `chat export` output is byte-identical before/after any sequence of history/read/inbox/
   catchup commands (no phantom `dm-*.jsonl`, no read_state leakage) — existing determinism
   test plus the new no-phantom-file test both green.
6. Full suite green (baseline 85 + new tests), `NODE_OPTIONS=--no-warnings` caveat noted.
7. No changes to server endpoints' shapes, export file format, schema, or web UI.

## 6. Review guidance

Reviewer comes in cold: verify D1–D3 against this file, not against vibes. The two things
most worth hostile attention: (a) the over-max check must sit inside the write tx (race-clean
under concurrent posts — rejection must never fire against a max that moved *up* past the
target between check and write... it can't, ids only grow, but confirm the check direction);
(b) resolveConv's pure path must not regress the AS-6 hidden-channel error-string contract
for channel refs (it doesn't touch that branch — confirm).
