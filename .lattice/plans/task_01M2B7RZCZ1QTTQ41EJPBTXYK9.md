# AS-131 — Chat: lazy-load messages (paginate conversation history)

Planner: agent:cto-owen, 2026-09-12. Complexity medium. Implementer: developer-lena. Reviewer: qa-priya.
Scratchpad (thinking past this cap): `scratchpad/agent-cto-owen/AS-131/`.

## Scope
Opening a channel/DM in `apps/chat` loads only the newest page of top-level messages (with the thread
replies of those roots); older pages load on scroll-up or a "Load earlier messages" control, prepended
without moving the reader's viewport. Live frames keep working. Everything the CLI, export, `?limit=`,
`?since=` and the hidden-conversation 404 gate do today stays byte-identical. **Out of scope (split):**
incremental DOM (stop `pane.replaceChildren` on every live frame) — see Decision 4.

## Decisions
1. **Page size 50 top-level messages** (client default; server default 50, hard cap 200, `1 ≤ limit ≤ 200`
   else 400). Board DM averages ~1.9 KB/message, so a page is ≤ ~100 KB worst case vs 332 KB today;
   #lattice-events (681) becomes 14 pages. 50 fills a desktop viewport with scrollback to spare.
2. **Cursor is id-based: `?before=<id>`**, page = the `limit` newest top-level rows with `id < before`.
   Ids are insert-only monotonic integers and every existing path (`?since=`, `applyMessage`,
   `maxLoadedId`, `insertOrdered`) already orders by id; `createdAt` is a string with ties and no index.
   `before=0` = "no upper bound" = newest page (the empty cursor, mirroring `since=0`). Page mode is
   selected by the presence of `before`; response adds `hasMore` (fetched `limit+1`, saw an extra row)
   and `nextBefore` (lowest top-level id in the page, or null when empty).
3. **Thread replies ride with their root**: page-mode `threads` carries *all* replies of the page's roots
   and nothing else. Keeps the invariant `applyMessage`/`replyCount` rely on (a loaded root has its
   complete reply list); replies per root are small, an independent reply cursor solves nothing measured.
4. **Full re-render stays; incremental DOM is split into a follow-up** the implementer files at review
   under the triage gate (`Chat: incremental message DOM — stop rebuilding the pane on live frames`).
   Why: pagination bounds the rebuild to the loaded set (50 by default), which removes the symptom the
   board sees; incremental DOM touches messageNode/anchor/thread/highlight paths — its own falsifiers,
   its own review. One risk per task.
5. **`?limit=` is kept, untouched.** `chat history --limit --json` prints every thread of the conversation
   (bin/chat.js:404-412); changing `limit` semantics would change CLI bytes. New store function
   `getMessagesPage`, new server branch; `getMessages`/`messagesSince` are not edited.
6. **Read watermark unchanged**: `selectConversation` keeps `POST /api/read` with no `upTo` (server marks
   the conversation max), so a partial page never leaves unread residue. `state.lastReadSent = maxLoadedId`
   remains a client dedupe floor only. `?since=maxLoadedId` catch-up may re-deliver replies of unloaded
   roots — `applyMessage` already tolerates a reply whose root isn't loaded (no render, no count).
7. **Permalink / thread-open outside the page**: one direction of paging, one code path. New client
   `ensureLoaded(targetId)` pages backward (`before = nextBefore`) until the target root (`threadRootId ??
   id`) is loaded, `hasMore` is false, or 20 pages (1,000 roots) were fetched; then the existing
   `applyAnchor`/`openThread` run. Used by `restoreFromUrl` (`?m=`, `?t=`) and `goToMessage` step 2.
   A target past the cap drops the anchor exactly as a dead id does today (AS-9). A bidirectional
   `around=` API was rejected: two cursors, "load newer" UI, and no measured need.
8. **CLI / export / 404 gating byte-identical**: `bin/chat.js`, `lib/client.js`, `exportFiles`, `?limit=`,
   `?since=` are not modified. Page mode gates visibility BEFORE cursor/limit validation, like
   `messagesSince`, so a malformed `before` cannot distinguish hidden from missing.

## Approach / key files
- `apps/chat/lib/store.js`: `getMessagesPage(conversation, me, { before, limit })` — gate, validate,
  `SELECT … WHERE conversation_id=? AND thread_root_id IS NULL AND (?=0 OR id<?) ORDER BY id DESC LIMIT ?+1`
  (uses `idx_messages_conv`), reverse to ascending; replies `WHERE thread_root_id IN (page ids) ORDER BY id`
  (`idx_messages_thread`); replyCount per root as today. Export it.
- `apps/chat/server.js` `/api/messages`: `if (q('before') != null)` branch before the `limit` branch;
  same `annotate`/members shape as the cold load plus `hasMore`, `nextBefore`.
- `apps/chat/public/live.js`: pure `mergeOlderPage(data, page)` — prepend top-level rows not already
  present (id-ordered), `threads[root] = page.threads[root]` (server list is authoritative at fetch time),
  copy `hasMore`/`nextBefore`. `maxLoadedId`/`applyMessage` unchanged.
- `apps/chat/public/scroll.js`: pure `prependPreservingScroll(pane, render)` — `scrollTop` ends at
  `savedTop + (scrollHeight_after − scrollHeight_before)` so the reader's row does not move.
- `apps/chat/public/app.js`: `selectConversation` fetches `before=0&limit=50`; `loadOlderPage()`
  (guarded: not while loading, only when `hasMore`); scroll listener on `#messages` (`scrollTop < 200`)
  plus a top-of-pane "Load earlier messages" button (covers a first page shorter than the viewport);
  `renderConversation` renders the control only when `hasMore`; `ensureLoaded` per Decision 7;
  live frames unchanged (`renderPreservingScroll`). `resetMainPane` clears the new state fields.
- `apps/chat/public/style.css`: the control, per BRANDING.md tokens.
- Tests: `test/store.test.js`, `test/api.test.js`, `test/live.test.js`, `test/scroll.test.js`.
- Docs: `apps/chat/README.md` API table row for `before`/`limit` page mode.

## Sequencing / staffing
1. Lena: store + server + store/api tests (commit). 2. live.js + scroll.js + their tests (commit).
3. app.js + css (commit; scratchpad progress note `scratchpad/agent-developer-lena/AS-131/`).
4. Manual check on the compose app: open #lattice-events, scroll up twice, post a reply — note in comment.
5. Priya reviews cold: plan + `git diff master...feat/AS-131-lazy-load-messages`, suite host + `--build`.

## Acceptance criteria (each names its falsifier; a criterion passes only with the red observed)
1. `GET /api/messages?before=0&limit=2` on a 5-root conversation returns roots 4,5 ascending, `hasMore:true`,
   `nextBefore:<id of 4>`. **Falsifier M1:** flip `ORDER BY id DESC` to `ASC` → test red (roots 1,2).
2. `before=<id of 4>&limit=2` returns 2,3; `before=<id of 2>` returns 1 with `hasMore:false`, `nextBefore:<id 1>`;
   an empty conversation returns `[]`, `hasMore:false`, `nextBefore:null`. **M2:** `id <=` for `id <` → red (4 repeats).
3. Boundary: exactly `limit` roots left → `hasMore:false`; `limit+1` left → `true`. **M3:** fetch `LIMIT ?`
   instead of `?+1` (hasMore always false) → red.
4. Page `threads` contains every reply of each page root and no reply of any other root. **M4:** drop the
   `IN (page ids)` filter → red (foreign root key present).
5. `?limit=` responses and `chat history --limit N --json` are unchanged: existing api test (api.test.js:550)
   and cli/export tests stay green with page mode present. **M5:** make the `limit` branch also require
   `before` (route `?limit=` into page mode) → api.test.js:550 red on the `threads` key.
6. Gate before validation: hidden channel + `before=abc` and nonexistent id + `before=abc` produce
   byte-identical 404 bodies; visible + `before=abc` and `limit=0|201|x` → 400. **M6:** move the
   `before` check above `requireVisible` → parity test red.
7. Watermark: conversation whose max id is a reply to a root outside the newest page; open it (page mode)
   then `POST /api/read` without `upTo` → `/api/unread` shows 0 for it. **M7:** send `upTo: maxLoadedId(page)`
   instead → red.
8. `mergeOlderPage`: prepends id-ordered, dedupes rows already present, sets `hasMore`/`nextBefore`, replaces
   only the page roots' threads. **M8:** `push` instead of prepend → order red; **M8b:** skip the dedupe → length red.
9. `prependPreservingScroll`: pane at scrollTop 300, height grows 1000→1600 → scrollTop 900; at 0 → 600.
   **M9:** restore `savedTop` without the delta → red.
10. `ensureLoaded` (extract as a pure loop over an injected fetcher in `live.js` or `app.js`-free module):
    target in page 3 → three fetches then found; target absent with `hasMore:false` after 2 pages → 2 fetches,
    false; cap at 20. **M10:** drop the `hasMore` stop → runaway fetch count red.
11. Suite: host green; compose counted run green with the `Image <name> Built` receipt (`bin/compose-run.mjs`).

## Predicted counts
Baseline at plan time: master's last recorded host run 643/641/0/2 (AS-129 merge) plus AS-121's tests;
implementer records the exact host and `--build` baseline in the first comment. Expected delta **+14 host
tests** (store 4, api 4, live 2, scroll 2, ensureLoaded 2), skips unchanged; compose = host + the usual
docker-only deltas.

## Open questions (time-boxed; default applies at the box)
- Q1 Page size 50 vs 100? Default 50; revisit only if the manual check shows a visibly short first page
  (box: implementation start).
- Q2 Should `#lattice-events` (system-only roots) use a smaller page? Default no — one page size everywhere.
- Q3 Does the scroll listener need a debounce beyond the `loading` guard? Default no; the guard serializes.

## Review Cycle 1 Findings (qa-priya, 2026-09-12)

Verdict: implementation-level rework. One behaviour defect blocks; residuals R1–R4 stay on the record.

- **F1 (medium, behaviour defect, blocks).** Thread modal opens without its root. Newest page open; a *live*
  reply lands on a root outside the page; `applyMessage` stores it as an orphan `threads[root]` entry. A
  "msg N" reference to that reply is clicked: `findLoadedMessage` (`app.js`, goToMessage step 1) finds the
  orphan reply, treats the target as loaded, and calls `openThread(root)` without paging the root in — the
  modal shows one node (the live reply); root and earlier replies are missing. Reloading the same `?c&t&m`
  URL renders correctly (the `ensureLoaded` path is right; only the "already loaded" shortcut is wrong).
  `isLoaded` in `live.js` carries the same assumption. **Fix (client-side):** a reply counts as loaded only
  when its root is a loaded top-level row — in `findLoadedMessage` and `isLoaded` — so goToMessage falls
  through to `ensureLoaded`. **Criterion 12:** test for it with its falsifier **M11:** restore the
  reply-only check → red. Repro: `scratchpad/agent-qa-priya/AS-131/probe-orphan.mjs`.
- R1 `loadOlderPage` `finally` clears `loadingOlder` after a stale-conversation return (one duplicate,
  deduped fetch). R2 live-frame drop window widens under `ensureLoaded` (catch-up recovers). R3
  `mergeOlderPage` keeps an already-loaded root's thread list where Approach said server-authoritative;
  test pins "keep" — reachable only on a duplicate fetch. R4 host delta +12 vs predicted +14.

## Reset 2026-09-12 by agent:cto-owen
