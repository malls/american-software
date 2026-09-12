# AS-9 Plan: query-string URL state — channel/DM/thread survives refresh, links shareable

Planner: Owen Kessler (agent:cto-owen), 2026-08-30. Complexity: **medium**.
Planned against master @ c323dd0 (post-AS-6: typeahead, private-channel lock UI, visibility parity rules).

## Problem

`apps/chat/public/app.js` keeps all selection state in memory (`state.currentConv`,
`state.currentThreadRoot`). Refresh drops the user to "Select a conversation"; there is
no shareable link to a channel, DM, or thread. The only URL writing today is a vestigial
`location.hash = msg-<id>` in `openThread()` (cleared in `closeThread()`), which restores
nothing.

Binding constraint (from the task description, non-negotiable): **identity never goes in
the URL.** `me` stays in `localStorage('chat.me')`; a shared link must never switch the
viewer's identity.

## Assumptions (explicit)

1. Conversation ids and message ids are SQLite integer rowids, stable for the life of a
   DB instance; channel names are `[a-z0-9-]+` and stable across a rebuild from the AS-5
   JSONL export. So: channels are addressed by **name**, DMs by **numeric conversation id**.
2. `/api/conversations?me=` is already the visibility boundary (AS-6): public channels,
   private channels where member, DMs where member — nothing else. I rely on this as the
   *sole* resolution input; if that ever changes, this design's oracle-safety changes with it.
3. The web UI has no browser test harness (node:test only, `--test` over `test/*.test.js`);
   history/scroll/refresh behavior is manually verified. Structured for that split below.

## URL grammar

```
page URL  = "/" [ "?" query ]
query     = params in any order; unknown/foreign params are PRESERVED, never clobbered
  c = <channel-name>      channel by name, must match ^[a-z0-9-]+$   e.g. ?c=general
    | "dm:" <conv-id>     DM by numeric conversation id              e.g. ?c=dm:7
  t = <message-id>        open thread rooted at this top-level message; requires c
  m = <message-id>        one-shot scroll-to + highlight in main pane; requires c;
                          ignored when t is present
```

Design rationale:

- **`dm:` prefix, not bare id:** channel names may be purely numeric (`[a-z0-9-]+` admits
  `"2024"`), so a bare integer is ambiguous. The prefix removes the ambiguity.
- **Channel by name:** readable, shareable, survives DB rebuild from export.
- **DM by conversation id, not viewer-relative `@other`:** the link denotes *the*
  conversation. A viewer-relative form would silently open a *different* conversation for
  the recipient — least-surprise violation. Non-members fail soft (below), same as Slack's
  "you don't have access".
- **Query string, not hash:** per the board's explicit ask (msg 59). The vestigial
  `location.hash` msg-anchor is **removed** (folded into `t`/`m`), not kept compatible —
  two state locations is one too many. Old `#msg-N` links degrade to an inert anchor: no
  crash, no restore.
- **Invariant:** the query string is always a projection of actual view state. Dead or
  unresolvable params are stripped (`replaceState`) — the URL never claims state the view
  doesn't have.

## Load-time resolution & oracle safety (the core call)

**Rule: URL params are resolved exclusively against the viewer's own already-fetched,
visibility-filtered `/api/conversations` list. No network request is ever issued using an
unresolved URL param.**

- `c=<name>` → find `type==='channel' && name===<name>` in `state.conversations`.
- `c=dm:<id>` → find `type==='dm' && id===<id>` in `state.conversations`.
- Miss → fail soft: default view, one neutral note (single string for every cause:
  *"That conversation isn't available."*), URL normalized to strip dead params.
- `t`/`m` → resolved only against the messages fetched for a *successfully resolved*
  conversation (`data.messages`, same check `renderThread` uses). Miss → open the
  conversation, drop the param. Never queried by id; no cross-conversation probe (the
  AS-11 residual stays server-side only — this feature adds nothing to it).

Consequence: nonexistent channel, hidden private channel, and non-member DM take the
**byte-identical client code path with zero distinguishing requests**. This is strictly
stronger than AS-6's parity-of-error-messages: parity by construction, because the only
resolution input is the list the server already filtered. Priya opening
`/?c=board&t=42` gets exactly what `/?c=no-such-channel` gets — default view, same note,
normalized URL, and *no* `/api/messages` request for the board conversation ever leaves
her browser. (The server would 404 identically anyway — AS-6's gate — but we never even
knock.)

## History semantics

| Event | URL action |
|---|---|
| Sidebar conversation click, DM typeahead pick, channel create | `pushState` |
| Thread open (reply-in-thread / replies link) | `pushState` (adds `t`) |
| Thread close via × button | `pushState` (drops `t`) |
| Initial-load restore success | `replaceState` (normalize form) |
| Initial-load / any resolution failure | `replaceState` (strip dead params) |
| Identity switch | `replaceState` to `/` (clears everything) |
| 5s poll re-render | **no URL write, ever** |
| `popstate` (back/forward) | no write — parse, resolve, apply view |

Mechanics:

- One funnel: `syncUrl(mode)` serializes current `state` and compares against
  `location.search`; **no-op when equal** (guards re-clicking the active conversation and
  any accidental double-write). `pushState`/`replaceState` only, never navigation.
- `selectConversation(conv, { keepThread, url })` gains `url: 'push' | 'replace' | 'none'`
  (default `'push'`). The poll passes `'none'`; restore/popstate pass `'none'` (popstate)
  or `'replace'` (initial load). Acceptance criterion 11 exists because the poll calls
  `selectConversation` every 5s — history must not grow.
- `openThread`/`closeThread` take the same option; internal callers (identity switch,
  `selectConversation`'s `closeThread()`) pass `'none'`. The `location.hash` write in
  `openThread` and the hash-clearing `replaceState` in `closeThread` are deleted.
- `popstate` handler: `parseChatUrl(location.search)` → resolve against
  `state.conversations` (fresh enough: refreshed every 5s and on every selection) → apply
  with `url:'none'`. Miss → fail soft as above (with `replaceState` normalize).
- Initial restore runs in `init()` **after** `loadIdentities()` + first `refreshSidebar()`
  (resolution needs `state.me` and the list), before the poll starts.

## Interaction with unread / mark-read

Restoring from a URL reuses `selectConversation`, which posts `/api/read` — opening a
link marks that conversation read for the viewer, exactly as if they had clicked it.
Deliberate: viewing is viewing; no new read semantics, no change to the AS-3 backlog
item. A failed resolution posts nothing (never reaches `selectConversation`).

`m=` anchor: after first render, one-shot `scrollIntoView` + a `.anchored` highlight
class (CSS-only fade in `style.css`). One-shot flag so the 5s poll re-render neither
re-scrolls nor re-highlights. `m` stays in the URL until the next navigation write drops
it (a copied URL keeps pointing at the message).

## Pure module: `public/url-state.js` (new, ESM, no DOM/no fetch/no globals)

```js
parseChatUrl(search)      // -> { conv: {kind:'channel',name}|{kind:'dm',id}|null,
                          //      thread: int|null, msg: int|null }
                          // junk-tolerant: bad charset, non-integer, <=0, malformed
                          // 'dm:' all yield null for that field, never throw
serializeChatUrl(sel, currentSearch)
                          // -> search string ('' or '?...'); writes/removes ONLY c,t,m;
                          // preserves foreign params verbatim (AS-10-proofing)
resolveConversation(parsedConv, conversations)
                          // -> conversation object | null (pure list lookup)
```

`app.js` becomes a module (`<script type="module" src="/app.js">` in index.html) and
imports it; node:test imports the same file directly (package is `"type":"module"`).
Everything history/DOM-related stays in `app.js`; everything decidable stays pure.

**Deviation from task description:** "no server changes expected" — serving the new file
needs one `STATIC_FILES` entry (`'/url-state.js'`) in `server.js`. Static plumbing only;
zero API-surface change. Recorded here so the reviewer doesn't flag it as scope creep.

## Files to touch

- `apps/chat/public/url-state.js` — **new**: the pure module above.
- `apps/chat/public/app.js` — module conversion; `syncUrl`; `url` option on
  `selectConversation`/`openThread`/`closeThread`; hash removal; init restore; `popstate`;
  identity-switch clear; fail-soft note; `m` anchor.
- `apps/chat/public/index.html` — `type="module"` on the script tag.
- `apps/chat/public/style.css` — `.anchored` highlight.
- `apps/chat/server.js` — one `STATIC_FILES` entry.
- `apps/chat/test/url-state.test.js` — **new**: pure-module unit tests.
- `apps/chat/test/api.test.js` — static-serving sanity (`/url-state.js` served;
  `GET /?c=general` still serves index.html — query never affects static routing).
- `apps/chat/README.md` — document the URL scheme as the deep-link contract (this section
  is what AS-10's planner reads; see coordination note).

## Every navigation path that reads/writes the URL (inventory)

Writes: sidebar `li` click → `selectConversation` (push); `pickDmOption` (push);
`#new-channel` create (push); `openThread` (push); `#thread-close` (push);
identity `change` handler (replace to `/`); init restore + all fail-soft paths (replace).
Reads: `init()` once; `popstate` handler. Nothing else touches `history` or
`location` — grep for `location.` and `history.` in review must find only these.

## AS-10 coordination (queued right behind this)

1. **Namespace:** AS-9 owns `c`, `t`, `m`. `serializeChatUrl` preserves all other params,
   so AS-10 (or anyone later) can add query params without being clobbered — but AS-10's
   dashboard links are *outbound* hrefs to `LATTICE_DASHBOARD_URL/#/task/<id>` and should
   not need any.
2. **Inbound contract:** if the lattice dashboard (or anything) ever deep-links into chat,
   `/?c=<name|dm:id>&t=<id>&m=<id>` is the scheme — documented in `apps/chat/README.md`
   by this task. AS-10's planner reads that section; it does not invent a second scheme.
3. **Sequencing:** AS-10 touches `bodyNode`/`showTaskPanel` in the same `app.js` this task
   restructures (module conversion). Land AS-9 first; AS-10 rebases. AS-10's external
   links must be real `href`s (new tab), never `href="#"` — the `#` idiom's excuse
   (hash-based anchoring) is removed by this task.

## Acceptance criteria (QA-walkable, against docker compose per AS-4)

1. Pick identity, click `#general` → URL becomes `/?c=general` with no page navigation.
2. Refresh → `#general` reopens with messages; never "Select a conversation".
3. Open a thread → URL gains `&t=<rootId>`; refresh → same conversation *and* thread
   panel open on the same root.
4. Close thread via × → `t` dropped; browser Back → thread reopens; Forward → closes.
5. Open a DM via typeahead → `/?c=dm:<id>`; refresh restores it.
6. Copy a `/?c=general&t=N` URL into a browser profile whose `chat.me` is a different
   identity → same channel/thread opens **as that viewer's identity** (URL never switches
   identity).
7. Priya case: as a non-member, open `/?c=board` → default view + note "That conversation
   isn't available."; URL normalized to `/`; behavior byte-identical to `/?c=no-such-channel`
   and `/?c=dm:999999`; devtools network shows **no** `/api/messages` request for it.
8. Junk (`/?c=;`, `/?t=abc`, `/?t=5` alone, `/?c=dm:x`) → fail soft, zero console errors,
   URL normalized.
9. Legacy `#msg-N` hash link → no crash, no restore, hash inert.
10. Switching identity clears the URL to `/` and does not restore the previous conversation.
11. Sit in a conversation >15s (3 polls), press Back once → you leave the conversation
    (history did not grow from polling).
12. Opening a shared link to a conversation with unread messages clears its badge
    (mark-read-on-view unchanged).
13. `/?c=general&m=<id>` scrolls to and briefly highlights that message, once; the 5s
    poll does not re-scroll.

## Test plan

**Automated (node:test — `npm test` in `apps/chat`):**

- `test/url-state.test.js` (pure, no server):
  - parse: every grammar production; junk tolerance (empty/missing params, malformed
    `dm:`, non-integer / zero / negative `t`/`m`, channel-name charset violations,
    percent-encoding); `t` and `m` both present → both parsed (precedence is app policy).
  - serialize: roundtrip property `parseChatUrl(serializeChatUrl(sel,'')) ≅ sel` for valid
    selections; foreign-param preservation (`?x=1` in, `?x=1` out alongside/without c/t/m);
    full clear returns `''` when no foreign params.
  - resolve: channel hit, dm hit, and the misses — including the oracle-safety contract in
    executable form: a private channel *absent from the input list* resolves exactly like
    one that never existed (same `null`).
- `test/api.test.js`: `/url-state.js` served with JS content-type; `GET /?c=anything`
  serves index.html (static routing ignores query). No API behavior changes → no other
  server test changes.

**Manual (no browser harness — on the record):** history semantics (`pushState`/
`popstate`), actual refresh restore, scroll/highlight, and the devtools no-probe check
are not reachable from node:test. They are exactly acceptance criteria 1–13 above, run
by hand against the compose-served app. The review stage records which criteria were
walked and their outcomes.

## Open questions (time-boxed, with defaults)

- Fail-soft note vs. silent default view: **default = show the single neutral note**
  (a shared link that silently does nothing is worse UX; one string for all causes keeps
  it oracle-free). Reviewer may strike it — 3-line revert. Decide by review.
- If implementation runs long, `m=` may be deferred to a follow-up task; the grammar
  reserves it either way. Default = implement now (it is cheap and completes
  "links shareable").
