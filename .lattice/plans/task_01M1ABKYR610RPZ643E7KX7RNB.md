# AS-25 — Push message delivery: replace the 5s full-refetch poll

**Planner:** agent:cto-owen (CTO) · 2026-08-30
**Complexity:** medium-high
**Branch:** `feat/AS-25-push-delivery`

## Problem

The web UI polls three endpoints every 5s (`/api/conversations`, `/api/roster`,
and — when a conversation is open — a full `/api/messages` refetch plus a
`POST /api/read`). Fine on loopback; laggy over the board member's phone on a
relayed Tailscale DERP path, and the full-history refetch grows linearly with
history. Goal: the server pushes new messages to connected clients; clients
stop refetching what didn't change.

## Transport decision: SSE (Server-Sent Events). Websockets overruled.

The board's request said "websockets"; the intent is *push delivery*, and the
description explicitly invites the SSE-vs-WS call. As CTO I'm deciding **SSE**,
for what it removes:

1. **Protocol code we'd have to hand-write and own.** Zero-dep RFC6455 on
   `node:http` means the Sec-WebSocket-Accept handshake, frame
   parsing/masking, fragmentation, ping/pong, and close semantics — hundreds
   of lines of protocol state machine with real failure modes — to gain a
   client→server channel we don't need (sends already `POST /api/messages`
   and will keep doing so). SSE server-side is a `Content-Type:
   text/event-stream` response we hold open and write lines to; client-side
   is the built-in `EventSource`. Zero dependencies both sides, near-zero
   protocol surface.
2. **Reconnect logic.** `EventSource` auto-reconnects natively. This is the
   dominant concern for the actual usage pattern: iOS Safari kills background
   connections *regardless of transport* (WS included), so the quality of the
   reconnect-and-catch-up path matters more than the steady-state transport.
   With WS we'd hand-write reconnect/backoff; with SSE we get it free and
   layer explicit catch-up on the `open` event.
3. **Proxy friendliness.** SSE is a plain long-lived HTTP/1.1 response — no
   Upgrade negotiation to survive `tailscale serve` or any future reverse
   proxy. Same-origin `EventSource` also passes the existing CSP
   (`default-src 'self'`) untouched.

Recorded trade-offs (accepted): SSE is server→client only (irrelevant — sends
POST); browsers cap ~6 concurrent HTTP/1.1 connections per origin, so ~6 open
tabs max hold live streams (acceptable for this app; the reconcile poll still
covers a starved 7th tab). If we ever need client→server streaming or binary
frames, that's a new decision with new evidence — not this task.

## Architecture

### Why an in-process hook is sufficient (no DB change-polling)

Since AS-24, while the server is up it is the **single writer**: the CLI
proxies every write through the HTTP API (direct DB mode engages only when a
server is provably down — at which point no stream clients exist). Lattice
ingestion (`ingestEvent`) also runs in the server process. Therefore a
post-commit callback inside the store observes every live message write.

### Store (`apps/chat/lib/store.js`)

- **`onMessage(cb)`** — subscription hook returned from `openStore`. Invoked
  *after* the write transaction commits, from both `postMessage` and
  `ingestEvent` (the only two message-creating paths). Callback receives the
  full message row. A callback throw must never fail the write (same
  swallow-discipline as the AS-7 sentinel).
- **`visibleTo(conversationId, identityId)`** — exported predicate: public
  channel, or member of private channel/DM. Same logic `requireVisible` /
  `listConversationsFor` already use; evaluated per frame at delivery time
  (no caching, no membership snapshot to go stale).
- **`messagesSince(conversation, me, sinceId)`** — delta read: all messages
  (top-level *and* replies) in the conversation with `id > sinceId`, ordered
  by id. Gates through `requireIdentity` + `requireConversation` +
  `requireVisible` exactly like `getMessages` — a hidden channel 404s
  byte-identically to a nonexistent one, `since=` included.
- **AS-7 sentinel: untouched.** It fires inside `postMessage` on human
  authors independent of transport; this task adds a sibling hook, changes
  nothing about the sentinel.

### Server (`apps/chat/server.js`)

- **`GET /api/stream?me=<id>`** — handled *outside* `handleApi` (needs the
  raw `res` held open, not the JSON envelope). Validates `me` via
  `requireIdentity` first; unknown identity gets the normal 404 JSON envelope,
  never a stream. On success: `200`, `Content-Type: text/event-stream`,
  `Cache-Control: no-store`, connection registered in a `Set` of
  `{ res, me }`; removed on `close`.
- **Fan-out:** one `store.onMessage` subscriber annotates the message
  (`resolveRefs`, same as REST) once, then per connection: write the frame
  **iff `visibleTo(msg.conversationId, conn.me)`**. Non-members of a hidden
  channel receive zero bytes — nonexistent-parity applies to the stream.
- **Frame format:** `event: message`, `data: <JSON>` — the annotated message
  object (id, conversationId, threadRootId, authorId, body, createdAt, refs).
  **No SSE `id:` field**, deliberately: `id:`/`Last-Event-ID` implies
  server-side replay semantics we are not building. Catch-up is explicit
  client logic (below); the contract stays honest.
- **Heartbeat:** one shared ~25s timer writes an SSE comment line (`:hb`) to
  every connection — keeps `tailscale serve` / NAT idle timeouts from
  reaping the connection and lets the server detect dead sockets on write
  error. Uniform to all connections (no information content).
- **`GET /api/messages?...&since=<id>`** — when `since` is present, respond
  `{ conversation, messages: [flat delta via messagesSince, annotated] }`
  (no `threads` key; the client merges). Same bare `Number()` coercion as
  `?limit=`. Without `since`, behavior is unchanged.
- **`close()`** must clear the heartbeat timer and `res.end()` every live
  stream so the test server shuts down cleanly.
- No new trust surface: `me` stays client-asserted, same model as every
  existing endpoint (loopback / tailnet trust domain).

### Client (`apps/chat/public/app.js`)

- **Connect** `new EventSource('/api/stream?me=…')` after identity load;
  tear down and reconnect on identity switch.
- **`applyMessage(msg)`** — single idempotent merge (dedupe by message id)
  into `state.lastData`: top-level messages append to `messages`; replies
  append to `threads[root]` and bump the root's `replyCount`. Re-render via
  the existing render path (extracted from `selectConversation` so rendering
  no longer requires a fetch), preserving AS-17 sticky-scroll and AS-9/AS-23
  invariants (no URL writes, no drawer slam, one-shot anchor untouched).
- **Frame handling:** current conversation → `applyMessage` + `POST
  /api/read` (only when the message isn't already read-covered; keep it
  cheap). Other conversation → bump local unread badge iff `authorId !== me`
  (same rule as `unreadCountFor`) and re-render sidebar — no fetch. Unknown
  `conversationId` (a brand-new channel/DM) → one `refreshSidebar()`; this
  closes the new-conversation gap without a `conversation` event type.
- **Reconnect catch-up** (on `EventSource` `open` after a drop, and on
  `visibilitychange → visible` — the iOS foregrounding path): one
  `refreshSidebar()` (authoritative unread) + `GET /api/messages?since=<max
  id in state.lastData>` for the open conversation, replaying the delta
  through `applyMessage`. Same merge function for frames and catch-up — one
  code path.
- **`sendMessage`:** stop the full-conversation refetch; apply the POST
  response through `applyMessage` (its own SSE frame dedupes by id).
- **Poll retirement:** the 5s poll dies. A **60s reconcile poll**
  (`refreshSidebar` only) replaces it — it covers roster/work-status changes
  (Lattice files change outside the chat DB; push has no event source for
  them), cross-device `markRead` drift, and keeps the server's lattice-ingest
  throttle ticking. Initial conversation load keeps the existing structured
  `GET /api/messages` (with `?limit=` available) — `since=` is the delta
  path, not the cold-load path.

## Files

| File | Change |
|---|---|
| `apps/chat/lib/store.js` | `onMessage` hook; `visibleTo`; `messagesSince` |
| `apps/chat/server.js` | `/api/stream`; fan-out + gating; heartbeat; `?since=`; clean close |
| `apps/chat/public/app.js` | EventSource wiring; `applyMessage`; catch-up; poll retirement |
| `apps/chat/test/store.test.js` | hook + `messagesSince` + `visibleTo` units |
| `apps/chat/test/stream.test.js` | new — SSE integration (below) |
| `apps/chat/test/api.test.js` | `?since=` shape + hidden-channel parity for `since=` |

## Acceptance criteria (walkable)

1. **Two-client push test** (`stream.test.js`): two SSE connections
   (different identities) via raw `fetch` + stream reader on an ephemeral
   port; `POST /api/messages`; both connections receive the `message` frame
   with the posted body — asserted from frame content alone, no GET issued.
2. **Hidden-channel stream parity:** connections for a `#board` member and a
   non-member; post to `#board`, then post to a public channel. Member's next
   frame is the board message. Non-member's next frame is the *public*
   message — deterministic proof (ordering, not sleeps) that no board frame
   was ever written to the non-member.
3. **Delta:** `GET /api/messages?...&since=N` returns exactly the messages
   with `id > N` (replies included, annotated); `since=` on a hidden channel
   as a non-member 404s byte-identically to a nonexistent conversation id.
4. **Stream endpoint gating:** `/api/stream?me=<unregistered>` → 404 JSON
   envelope, no stream; missing `me` → 400.
5. **Poll retirement:** no 5s interval remains in `app.js`; reconcile
   interval ≥ 30s; `sendMessage` performs no full-history refetch.
6. **Suite green in-container** (`docker compose run` per repo convention),
   including all pre-existing tests — AS-7 sentinel tests must pass untouched.

### Hand-walk list (manual, post-implement)

- `docker compose up`; two browser windows as two identities; post in one →
  appears in the other with no 5s latency and no `/api/messages` poll in the
  network tab.
- Kill the server mid-session; restart → EventSource reconnects, missed
  messages appear via catch-up (post one from CLI while it's down… server
  down means CLI direct mode; post immediately after restart instead).
- Background the tab / lock the phone; post from the other window;
  foreground → catch-up renders the missed message and corrects badges.
- As a non-member identity, watch devtools while a member posts to `#board`:
  zero frames arrive.
- `docker exec` CLI post → appears pushed in the browser (CLI→HTTP→hook path).

## Coordination

AS-19 (thread modal) and AS-23 (mobile layout) are both `done` and merged —
no live branch touches these files; AS-25 has them to itself. AS-7 watcher
and sentinel are store-level and out of scope.

## Open questions (time-boxed into defaults)

- Push `read`/`conversation` event types? **Default: no** — the 60s reconcile
  poll plus the unknown-conversation refresh covers both; add event types
  only if hand-walking shows a real gap.
- Backpressure on slow stream consumers? **Default: ignore** — frames are
  small, clients are ≤ a handful; `res.write`'s return value is not consulted
  in v1. Revisit only with evidence.
