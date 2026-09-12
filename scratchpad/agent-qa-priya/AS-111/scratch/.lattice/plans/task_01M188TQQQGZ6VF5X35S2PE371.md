# AS-6 Plan — hidden #board channel + DM typeahead

Planner: agent:cto-owen (2026-08-30). Complexity: medium.
Binding input: board decision on this task (comment, 2026-08-30, on behalf of human:forrest):
**#board is HIDDEN for non-members — not read-only. "We don't want context poisoning
for employees." Non-members must not see the channel's existence or contents in any
surface: channel list, history, inbox, exports.**

## 0. Definition first (we do not proceed on an undefined term)

**"Hidden" means:** for a non-member, every observable behavior of the chat system —
CLI, HTTP API, web UI, and the git-committed export — is indistinguishable from a
world in which #board does not exist. Two documented, deliberate exceptions:

1. **Raw DB access.** `chat dump` and direct `sqlite3` reads return everything. The
   threat model is surfaces, not filesystem access — anyone who can read
   `apps/chat/data/chat.db` owns the store. Documented in apps/chat/README.md.
2. **Channel-name collision.** Channel names are UNIQUE; creating a channel named
   `board` must fail. A non-member gets a deliberately uninformative message
   ("Channel name 'board' is unavailable.") that does not confirm a channel exists
   vs. the name being reserved. Residual one-bit leak, accepted: the alternative
   (shadow duplicates) breaks name resolution for everyone.

Everything else is a hard requirement: a probe against a hidden channel returns the
*same error, same code, same HTTP status* as a probe against a nonexistent one.
Never 403 for hidden channels — 403 is an existence proof.

## 1. Scope

**In:**
- Channel membership schema: generalize `dm_members` → `conversation_members`; add
  `conversations.visibility` ('public' | 'private'). In-place migration of the live DB.
- Seed `#board` (private) with members `human:forrest`, `agent:ceo-carla`,
  `agent:cto-owen`.
- Enforce hidden semantics at every read/write surface (enumerated in §3).
- Export (AS-5) excludes private channels; append-only/idempotency contract preserved
  byte-for-byte for existing files.
- DM typeahead in the web UI (replaces the `prompt()` flow).
- Tests for all of the above; apps/chat/README.md updated (app-level doc — allowed;
  top-level markdown is metawork, untouched).

**Out (deliberate, recorded so nobody "helpfully" adds them):**
- Membership add/remove commands/APIs. #board membership is seed-defined. No problem
  exists yet that mutation solves; every mutation path is a new boundary to defend.
  Future board request → future task.
- Visibility changes (public↔private) on existing channels. Forbidding this kills an
  entire class of export-contract problems (files vanishing/appearing with history).
- Private-channel creation from CLI/HTTP/UI. `store.createChannel` gains
  `visibility` + `members` parameters (needed for tests and for the inevitable next
  private channel), but no caller surface exposes them in AS-6.
- Gating `chat dump` / `dumpLines` (exception 1 above).
- Encrypted or otherwise-private durable export of #board history (see §7 concern).
- Changing DM non-member error semantics (today: 403 'forbidden'). Pre-existing
  behavior; DM existence between a known identity pair is computable from the
  deterministic dm_key anyway, so 403 there proves nothing secret. Documented, left
  alone.

## 2. Schema & migration

Current live DB: 7 conversations (4 public channels incl. #qa-verification, 3 DMs),
61 messages, 7 identities. Schema version is untracked (`PRAGMA user_version` = 0).

**Target schema (v1):**

```sql
-- conversations gains:
visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private'))
-- dm_members is renamed/generalized:
CREATE TABLE conversation_members (
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  identity_id     TEXT NOT NULL REFERENCES identities(id),
  PRIMARY KEY (conversation_id, identity_id)
);
```

Semantics: DMs are `visibility='private'` with 2 members (invariant unchanged);
channels are `'public'` (no membership rows needed) or `'private'` (membership rows
gate everything). One visibility predicate serves every query:

```sql
(c.visibility = 'public' OR EXISTS (
   SELECT 1 FROM conversation_members cm
   WHERE cm.conversation_id = c.id AND cm.identity_id = ?))
```

**Migration (in `openStore`, inside one `BEGIN IMMEDIATE` tx, gated on
`PRAGMA user_version` = 0):**
1. Exec latest SCHEMA (CREATE IF NOT EXISTS — fresh DBs get v1 directly).
2. If legacy `dm_members` exists: `INSERT INTO conversation_members SELECT * FROM
   dm_members; DROP TABLE dm_members;`
3. If `conversations` lacks `visibility` (check `PRAGMA table_info`): `ALTER TABLE
   conversations ADD COLUMN visibility ... DEFAULT 'public'` then
   `UPDATE conversations SET visibility='private' WHERE type='dm';`
4. `PRAGMA user_version = 1`.

Idempotent by construction (version gate + existence checks); safe under WAL with a
concurrent CLI/server open because of BEGIN IMMEDIATE. Re-running on a v1 DB is a
no-op.

**Seeding (idempotent, every open, like existing seeds):** add
`{ name: 'board', purpose: 'Board & founders. Restricted: visible to members only.',
visibility: 'private', members: [human:forrest, agent:ceo-carla, agent:cto-owen] }`
to the seed block. Members inserted with INSERT OR IGNORE after resolving the
channel id. Note: seed re-adds these three on every open; harmless while no removal
API exists, and it means the founders can never be locked out by DB fiddling.

`openDm` sets `visibility='private'` explicitly on insert.

## 3. Enforcement points — every read/write path, enumerated

This is the section Priya should walk. Each row is a boundary; each gets a test.

| # | Surface | Current behavior | AS-6 behavior for non-member on #board |
|---|---------|------------------|----------------------------------------|
| 1 | `store.listConversationsFor(me)` | all channels unconditionally | visibility predicate; #board absent |
| 2 | `store.unreadFor(me)` / inbox | `c.type='channel' OR dm member` | predicate; #board messages never appear |
| 3 | `store.unreadCountFor` | only called for listed convs | inherits #1 (no new hole) |
| 4 | `store.getMessages` | no identity at all | takes `me`; hidden ⇒ throw `unknown_conversation` (message identical to nonexistent id) |
| 5 | `store.postMessage` | DM-membership check only | `requireVisible`: hidden channel ⇒ `unknown_conversation`; DM non-member stays 403 |
| 6 | `store.markRead` (+`/api/read`) | `requireVisible` (DMs only) | extended predicate; hidden ⇒ `unknown_conversation` |
| 7 | `store.catchupAll` | iterates #1 | inherits #1 |
| 8 | `store.createChannel` name collision | "already exists" (conflict) | if colliding channel is hidden from actor: "Channel name 'X' is unavailable." (still 409); visible: unchanged |
| 9 | `store.exportFiles` / `chat export` | exports every conversation | skips `type='channel' AND visibility='private'` — no file, no count |
| 10 | `store.dumpLines` / `chat dump` | everything | unchanged, documented exception (raw-DB tier) |
| 11 | `ingestEvent` | posts only to #lattice-events | unchanged; add regression assert that ingestion cannot target #board |
| 12 | CLI `chat post/history/read/reply <name>` | `getChannelByName` | new `getChannelVisibleTo(name, me)` returns null when hidden ⇒ exact same "Unknown channel 'X'. 'chat channels' lists them." as nonexistent |
| 13 | CLI `chat channels` | #1 | inherits #1 |
| 14 | `GET /api/conversations` | #1 | inherits #1 |
| 15 | `GET /api/messages` | **no `me` param required** | `me` required (400 if missing); hidden ⇒ 404, byte-identical body to nonexistent id |
| 16 | `POST /api/messages` | #5 | 404 for hidden channel id |
| 17 | Web UI sidebar/history | server-gated | inherits #14/#15; members additionally see a lock marker on private channels |
| 18 | `GET /api/task/:id`, lattice refs | task metadata | out of chat's trust boundary — .lattice/ is world-readable in the repo by design; no change |

Server error mapping already sends `unknown_conversation` → 404; the invariant to
test is that hidden and nonexistent produce **identical status + identical body**.

API note: #15 is a (localhost, internal) breaking change — `me` becomes required on
`GET /api/messages`. Both existing callers (web UI, CLI) already have an identity in
hand; the UI already sends `&me=`.

## 4. Export contract (AS-5 interaction) — the part that bites

Rules:
1. `exportFiles()` filters out private channels. No `channel-board.jsonl`, ever.
   Summary counts (conversations/messages) count only exported files, so the CLI
   line for the current dataset stays "3 conversations" + qa fixtures as before —
   seeded-but-hidden channels don't move any number.
2. **The conversation-header JSON line format does not change.** Adding a
   `visibility` key would rewrite line 1 of every previously exported file and
   violate the byte-identical-prefix contract against files already committed under
   AS-5. Internal API objects may carry `visibility`; export lines may not.
3. DMs keep exporting exactly as today (existing AS-5 behavior; the board decision
   was about #board, and Forrest's own DMs are already in git — no new decision made
   here).
4. Append-only/idempotency contract survives because visibility is immutable in
   AS-6 (§1 Out): the exported file *set* for a given DB can only grow (new public
   channels/DMs), never lose a member; each file only appends. A pre-AS-6 export
   directory re-exported post-migration is byte-identical until new messages arrive
   (acceptance criterion below).

Durability tradeoff — flagged in writing (see §7 and the lattice comment): #board
history will exist **only** in the gitignored SQLite DB and manual `chat dump`
backups. AS-5's whole point was that git is the durable copy; the board's channel is
now the one conversation without that safety net. This is the direct, accepted cost
of "hidden includes exports." Proposed follow-up (board's call, not AS-6): a
separate board-only durable location outside the employee-visible repo.

## 5. DM typeahead (web UI)

Replace the `#new-dm` `prompt()` flow with an inline combobox in the sidebar's
"Direct messages" section:

- Clicking `+` reveals a text input + dropdown list (`index.html` additions;
  `style.css` for the dropdown).
- Candidates: `state.identityMap` values (already loaded — **no new endpoint**),
  excluding `state.me` and `kind === 'system'`.
- Filter: case-insensitive substring match on `displayName` OR `id`; show up to 8,
  ordered by displayName.
- Keyboard: ArrowUp/ArrowDown move the active row, Enter selects, Escape closes;
  mouse click selects; losing focus closes.
- A11y: `role="combobox"`/`aria-expanded` on the input, `role="listbox"`/`option` +
  `aria-activedescendant` for the list.
- On select: `POST /api/dms { me, other }` → refresh sidebar → open conversation
  (same as today's flow).
- Rendering rule preserved: **textContent only, never innerHTML** (option rows show
  displayName + dimmed id).

Not a generic component; ~60 lines of app.js. The `+ identity` prompt flow is out of
scope.

## 6. Files to touch

| File | Change |
|------|--------|
| `apps/chat/lib/store.js` | schema v1 + migration, visibility predicate, `conversation_members`, `requireVisible` generalization, `getMessages(me)`, `getChannelVisibleTo`, `createChannel({visibility, members})`, collision wording, seed #board, export filter |
| `apps/chat/server.js` | `me` required on GET /api/messages; pass `me` through; nothing else |
| `apps/chat/bin/chat.js` | channel resolution via `getChannelVisibleTo` in post/history/read/reply; README pointer in USAGE unchanged |
| `apps/chat/public/index.html` | typeahead markup |
| `apps/chat/public/app.js` | typeahead logic; lock marker for private channels in sidebar/header |
| `apps/chat/public/style.css` | typeahead dropdown + lock styling |
| `apps/chat/test/store.test.js` | update seed assertions (member sees 4 channels; `dump` table list now `conversation_members`); new membership/visibility/migration tests |
| `apps/chat/test/api.test.js` | update line-152-style probes (`/api/messages` now needs `me`); hidden-vs-nonexistent equivalence tests |
| `apps/chat/test/export.test.js` | board-exclusion tests; existing counts ("Exported 3 conversations", file list) stay as regression evidence |
| `apps/chat/README.md` | #board semantics, hidden definition + 2 exceptions, export exclusion + durability caveat, typeahead, migration note |

No Docker/compose changes. No new dependencies (Node stdlib only, per AS-2/AS-4).

## 7. Concerns on the record

1. **Board durability gap** (§4). Accepted per binding decision; follow-up proposed
   to the board, not implemented here.
2. **Lattice is not hidden.** Task titles/events mentioning "board channel" are in
   `.lattice/` and in `#lattice-events`, visible to all employees. The board
   decision governs chat *content*; work *about* the channel is ordinary tracked
   engineering. If Forrest wants board-initiated tasks masked too, that is a much
   bigger (and probably unwise) change — flag, don't build.
3. **Sequential conversation ids** mildly leak that *some* conversation exists per
   id gap. Mitigated by rule "hidden ⇒ identical to nonexistent" on every probe; an
   id gap is indistinguishable from any DM the prober isn't in.
4. **Seed re-adds founder members on every open** — a deliberate lockout-prevention
   property today; becomes surprising the day a removal API exists. Recorded here so
   that future task remembers.

## 8. Acceptance criteria (walkable — Priya, start here)

Let M = a member (`human:forrest`), N = a registered non-member
(e.g. `agent:developer-marcus`), B = #board's conversation id.

**Hidden means hidden (every check for N):**
1. `chat channels --me N` output contains no `board`; JSON variant contains no
   conversation with name `board` and no id B.
2. `chat history board --me N`, `chat post board "x" --me N`,
   `chat read board --me N` each fail with **exactly** the same message as
   `chat history no-such-channel --me N` (string-equal stderr, same exit code).
3. `chat inbox --me N` never lists #board messages, even when M has posted since
   N's last read; `chat catchup --me N` completes without touching B.
4. `GET /api/conversations?me=N` — no B. `GET /api/messages?conversation=B&me=N`
   returns the same status (404) and same body as `conversation=99999&me=N`.
   `POST /api/messages` and `POST /api/read` against B as N: 404, not 403.
5. Web UI as N: sidebar shows no #board (verifiable via the gated API responses
   the UI consumes, per #4).
6. `chat create-channel board --me N` fails 'conflict' with the "unavailable"
   wording — the response does not contain "exists".
7. `chat export` on a DB where #board has ≥1 message: no `channel-board.jsonl` in
   the output dir; summary counts exclude it; re-run byte-identical (sha256).
8. Export upgrade compatibility: files exported pre-change for public
   conversations are byte-identical prefixes of post-change exports of the same
   data (header line format unchanged — no new keys).

**Members still work:**
9. M sees `#board` in `chat channels` and the web sidebar (with lock marker);
   M/carla/owen can post, thread-reply, and read; unread counts and inbox include
   #board for members only.

**Migration:**
10. Opening a v0-schema DB (built raw in the test, with DMs + dm_members +
    messages + read_state) upgrades in place: `user_version`=1, all prior
    conversations/messages/members intact, DM rows `visibility='private'`, #board
    seeded with exactly the 3 founders, second open is a no-op.

**Typeahead:**
11. Typing filters over displayName and id (case-insensitive substring); self and
    `system:*` never appear; Enter on the active row and mouse click both open the
    DM; no `innerHTML` anywhere in the new code (grep-verifiable).

## 9. Test plan

Runner: `node --test` **in-container**, per repo rule:
`cd apps/chat && DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 docker compose run --rm --build test`
(test service mounts nothing — passing with zero mounts proves no real state touched).

- **store.test.js**: seed assertions updated (M's channel list = 4 incl. board; N's
  list = 3 — register N in the test); membership predicate tests for
  listConversationsFor/unreadFor/postMessage/markRead/getMessages; hidden-error
  equality (message string of hidden probe === nonexistent probe); collision
  wording; `createChannel({visibility:'private', members})` happy path + "private
  requires members incl. actor" validation; dump table list updated.
- **migration test** (store.test.js or own file): construct v0 DB via raw
  `DatabaseSync` SQL (old schema verbatim), populate, close, `openStore`, assert
  criterion #10.
- **api.test.js**: `me` now required on GET /api/messages (400); hidden-vs-
  nonexistent equivalence at HTTP level (status + body deep-equal); member happy
  path over #board; existing probes updated to pass `me`.
- **export.test.js**: criterion #7 as a store-level and a CLI-level test; existing
  "Exported 3 conversations" + file-list assertions kept untouched as the
  regression proof that a seeded hidden channel moves no exported byte; append-only
  test extended with board traffic interleaved (board messages must not perturb
  public files' prefix property).
- **CLI string-equality test** for criterion #2 (spawnSync both probes, compare).

## 10. Proposed metawork edits (orchestrator applies; I do not touch these files)

**CLAUDE.md**, section "Git Methodology → Operational record commits", append one
sentence to the first paragraph:

> Private channels (currently `#board`, per the AS-6 board decision) are excluded
> from the chat export by design — hidden means hidden, including git. Their only
> durable copies are the live DB and manual `chat dump` backups; the board accepted
> this tradeoff on 2026-08-30 (AS-6).

**README.md** (top-level): no edit required — its chat description ("channels, DMs,
Lattice event feed") remains accurate.

## 11. Implementation order (for the implementer)

1. Schema + migration + seed (store.js), with migration test first.
2. Visibility predicate through every store read/write path (§3 rows 1–11).
3. server.js + bin/chat.js surfaces (rows 12–16).
4. Export filter + export tests (§4).
5. Typeahead (§5).
6. README (apps/chat) + full in-container test run.

Commit granularity per Git Methodology: implementation commits on
`feat/AS-6-board-channel` as the implementing employee.
