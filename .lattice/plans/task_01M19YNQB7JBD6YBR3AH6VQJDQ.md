# AS-17 — Thread view: keep scroll position across polls; default identity = human:forrest

Planner: agent:cto-owen (2026-08-30). Branch: `feat/AS-17-thread-scroll-default-identity`.

## Problem

Board report (DM msg 116, verbatim): "thread chat is auto scrolling to the bottom on an
interval - we should maintain scroll position. also, set me as the default user."

### Diagnosis (confirmed by reading the code)

The 5s poll (`apps/chat/public/app.js`, `init()`, ~line 633) re-renders the open
conversation via `selectConversation(conv, { keepThread: true, url: 'none' })`. When a
thread is open, that calls `renderThread()`, whose last line is an **unconditional**
`pane.scrollTop = pane.scrollHeight` (~line 359). Every poll jams `#thread-messages` to
the bottom regardless of where the reader was. That is the reported bug.

**Main message list (`#messages`) — checked per the task:** it does NOT have the
poll-jam defect. `selectConversation` (~line 305) measures `atBottom` before
`replaceChildren` and only re-scrolls when the reader was already at the bottom.
It has a *related latent* defect, though: the `atBottom` measurement is taken against
whatever was previously in the pane, so **switching conversations while scrolled up
opens the new conversation at the old, stale scroll offset instead of at the bottom**
(navigation and poll re-render are conflated into one code path). Fixing both panes
through one shared primitive resolves this too, so it is in scope.

## Approach

### 1. Scroll: a shared render-level primitive with "sticky bottom" semantics

New pure module **`apps/chat/public/scroll.js`** (mirrors the `url-state.js` pattern:
same file imported by the browser and by node tests, zero dependencies):

- `isAtBottom({ scrollTop, scrollHeight, clientHeight }, slack = 40)` — pure predicate.
  Degenerate metrics (all zeros — hidden pane; or `clientHeight >= scrollHeight` — no
  scrollbar) count as "at bottom", which is the harmless answer in both cases.
- `renderPreservingScroll(pane, render, { forceBottom = false } = {})` — the only
  DOM-touching piece, ~8 lines: measure before, call `render()` (which does the
  `replaceChildren`), then
  - `forceBottom` → `pane.scrollTop = pane.scrollHeight`
  - else was at bottom → `pane.scrollTop = pane.scrollHeight` (follow new messages)
  - else → restore the **saved** `scrollTop` exactly (preserve reading position).

**Why this strategy and not either half alone:**
- *Save/restore-only* breaks the universal chat expectation that a reader pinned at
  the bottom follows new messages as they arrive.
- *At-bottom-detection-only* (skip the scroll write when scrolled up) silently relies
  on the browser retaining `scrollTop` across `replaceChildren`'s
  remove-all-then-insert; that retention is not something I want to depend on across
  engines. Explicitly restoring the measured value removes the dependency.
- Combined ("sticky bottom") is what every mainstream chat client does, and it is the
  semantics the main pane already half-implements — this unifies the two panes on one
  audited primitive instead of two hand-rolled variants.

**Call-site changes in `apps/chat/public/app.js`:**

- `renderThread({ forceBottom = false } = {})` — wrap its `replaceChildren` in
  `renderPreservingScroll`; delete the unconditional `scrollTop` line.
  - `openThread()` calls `renderThread({ forceBottom: true })` (a freshly opened
    thread starts at its newest reply).
  - The call from `selectConversation` (poll/refresh path) passes nothing → sticky.
- `selectConversation(conv, { keepThread, url, scroll = 'bottom' })` — new `scroll`
  option, `'bottom' | 'preserve'`. Replace the inline `atBottom` logic with
  `renderPreservingScroll(pane, ..., { forceBottom: scroll === 'bottom' })`.
  - Poll interval passes `scroll: 'preserve'`.
  - `sendMessage`'s re-render passes `scroll: 'preserve'` (see edge cases).
  - All navigation call sites (sidebar click, roster DM, typeahead, restoreFromUrl,
    channel create) keep the default `'bottom'` — which is what fixes the latent
    stale-offset-on-switch defect.
- **Ordering invariant:** the `m=` anchor block (`anchorMsg`/`anchorApplied`,
  ~line 313) stays AFTER the scroll primitive runs, exactly as today — the one-shot
  `scrollIntoView` must win over the sticky/preserve decision on deep-link load, and
  the poll never re-triggers it (`anchorApplied` guard, unchanged).

**Why this survives AS-19 (threads inline/modal redesign):** the primitive takes any
scrollable element and a render callback — it knows nothing about `#thread-panel`,
sidebars, or layout. When AS-19 replaces the thread sidebar, its new container calls
the same two functions; the decision logic and its tests carry over untouched. Nothing
in this task depends on the thread view's DOM structure beyond "it is a scrollable
element we re-render", and nothing in AS-19 needs to wait on or coordinate with this.

### 2. Default identity

In `loadIdentities()` (~line 156):

```
const DEFAULT_IDENTITY = 'human:forrest';   // top-of-file constant
...
if (saved && state.identityMap[saved]) picker.value = saved;
else if (state.identityMap[DEFAULT_IDENTITY]) picker.value = DEFAULT_IDENTITY;
state.me = picker.value || null;
```

- `human:forrest` is a seeded identity (`apps/chat/lib/store.js` line 64), so the
  lookup succeeds on any normally-initialized DB; if it is ever absent, behavior
  degrades to today's first-option fallback rather than crashing.
- **Deliberately do NOT write `localStorage['chat.me']` when applying the default.**
  A default is not a choice; persisting it would freeze today's default into every
  profile and mask future changes. The explicit-change handler (`init()`) still
  persists real picks, unchanged.
- This also covers the stale-identity case: a saved id that no longer resolves
  (departed employee) now lands on `human:forrest` instead of the alphabetically
  first identity.

## Key files

| File | Change |
|---|---|
| `apps/chat/public/scroll.js` | NEW — `isAtBottom`, `renderPreservingScroll` |
| `apps/chat/public/app.js` | `renderThread`, `selectConversation`, `openThread`, poll interval, `sendMessage` call site, `loadIdentities` + `DEFAULT_IDENTITY` |
| `apps/chat/test/scroll.test.js` | NEW — unit tests for the pure predicate/decision logic |

No server, store, CLI, or CSS changes. No changes to `url-state.js` or the anchor logic.

## Edge cases (expected behavior)

1. **Pinned at bottom, new message arrives** → pane follows to the new bottom (both panes).
2. **Scrolled up, new messages arrive** → `scrollTop` preserved exactly; content grows below; no yank (both panes — the fix).
3. **Scrolled up, poll returns unchanged data** → no movement at all.
4. **Open a thread** → thread pane starts at bottom (forceBottom).
5. **Thread open + main pane scrolled up, poll fires** → neither pane moves.
6. **Switch conversations while scrolled up** → new conversation opens at bottom (fixes the latent main-pane defect).
7. **`m=` deep link** → anchor `scrollIntoView` still runs exactly once, after the primitive; polls never re-anchor.
8. **Initial load / empty pane / no scrollbar / hidden pane (zero metrics)** → treated as at-bottom; scroll-to-bottom is a no-op or correct.
9. **Send while scrolled up** → position preserved; your message lands below without yanking the pane. (Chosen default: `preserve`. Slack-style jump-to-own-message is a one-line change at the `sendMessage` call site if the board prefers it — not worth blocking on.)
10. **`chat.me` unset or stale** → identity defaults to `human:forrest`; nothing written to localStorage until the user actively picks.

## Test plan

- **Unit (`node --test` in `apps/chat/`, per `package.json`):** new
  `test/scroll.test.js` importing `public/scroll.js` directly (no DOM, no server —
  same pattern as `url-state.test.js`). Cover: slack boundary (delta 39/40/41 at
  default slack), zero metrics, `clientHeight >= scrollHeight`, and — by passing a
  fake pane object (plain `{ scrollTop, scrollHeight, clientHeight, ... }`) —
  `renderPreservingScroll`'s three outcomes: forceBottom, sticky-at-bottom after
  growth, exact restore when scrolled up.
- **Regression:** full existing suite `node --test` passes untouched.
- **Manual (Docker, per compose.yaml / app README):** bring the app up with
  `docker compose up`; seed traffic **via the server HTTP API only**
  (`POST http://127.0.0.1:8347/api/messages` — never the host CLI while the
  container is up, per AS-24). Verify: (a) long thread, scroll up, wait >5s poll →
  position holds; post a reply via API → still holds; scroll to bottom → follows new
  replies; (b) same checks on the main list; (c) clear localStorage, reload → picker
  shows "Forrest (Board)" and the sidebar loads as `human:forrest` with no manual pick.

## Acceptance criteria

1. With a thread open and the reader scrolled up, the 5s poll (and message inserts)
   never move `#thread-messages`' scroll position.
2. A reader at the bottom of either pane follows new messages; a freshly opened
   thread and a freshly selected conversation start at the bottom.
3. Main list poll behavior is at least as good as today, and switching conversations
   while scrolled up opens the new conversation at the bottom.
4. `m=` anchor deep links still scroll/highlight exactly once (existing behavior).
5. With `localStorage['chat.me']` unset (or stale), the UI comes up as
   `human:forrest` without a manual identity pick; an explicit pick still persists.
6. Scroll decision logic lives in `public/scroll.js` with unit tests; `app.js` panes
   both use it; no thread-sidebar-specific coupling (AS-19 can consume it as-is).
7. `node --test` green in `apps/chat/`.
