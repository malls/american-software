# AS-19: Chat: threads render inline or in a large modal — retire the narrow thread sidebar

Board request (chat DM @human:forrest, msg 119, 2026-08-30 17:50), verbatim: "also threads should just appear inline or in a large modal, and not in a sidebar. the sidebar is too narrow to read effectively". Design constraints: (1) AS-9 URL contract — ?t=<message-id> opens the thread rooted at that message and is the ONLY deep-link scheme into chat; the new inline/modal presentation must keep honoring t= links exactly (README "Deep links (AS-9)" section governs). (2) The roster/DM sidebar (AS-8) is a separate surface — replacing the THREAD panel must not disturb it. (3) The thread-scroll bug (AS-17) is being fixed at poll/render level independently; do not wait on it or duplicate it. Inline vs large modal is the planner-level choice — pick one, justify it in the plan.

Planner: Owen Kessler (agent:cto-owen), 2026-08-30.

## Decision: large modal (full-screen sheet at narrow widths). Not inline.

First, the terms, so we agree on what they mean:

- **Inline** = thread replies expand in place under their root message, inside
  the `#messages` pane, pushing subsequent channel messages down (Zulip/forum
  style).
- **Large modal** = a centered overlay dialog with a dimmed backdrop, sized for
  reading (~min(860px, 92vw) wide on desktop), containing root + replies +
  composer; on narrow viewports it becomes a full-screen sheet.

**Evidence from our own chat history** (chat.db, 2026-08-30): this company
writes long-form. `#board` messages average **1,111 chars** (max 2,975); the
one substantive threaded discussion (root msg 113, "direction of the
business") has 4 replies averaging **1,458 chars**. In the current 320px
sidebar (~288px usable, ~40 chars/line at 14px), a 2,975-char reply is a
~75-line column of text — that is precisely the board's complaint. In an
~800px reading pane (~100 chars/line) the same reply is ~28 lines. The design
target is *reading multi-kilobyte prose*, not scanning one-liners.

**Why modal beats inline, given how this codebase actually works:**

1. **Scroll containment.** The modal has its own scroll pane, exactly like the
   old `#thread-messages` — AS-17's `renderPreservingScroll` applies to it
   *unchanged* (scroll.js was deliberately written pane-agnostic for this
   task; its header comment says so). Inline expansion would inject/remove
   content mid-`#messages`, entangling thread reading position with channel
   scroll position across the 5s poll's `replaceChildren` re-render — the
   exact class of bug AS-17 just fixed. Inline means re-solving scroll
   anchoring for content *above* the viewport; modal means zero new scroll
   logic.
2. **Channel position survives.** Opening/closing a modal never perturbs
   `#messages` scroll state. Inline expansion of a 7KB thread and later
   collapse would.
3. **Mobile (AS-23 is queued right behind).** The board reads on a phone. A
   modal degrades to a full-screen sheet at ≤600px with ~10 lines of CSS —
   which is what every mobile chat client does with threads (a full-screen
   push view). Inline expansion of multi-kilobyte replies on a 390px screen
   makes the channel itself unnavigable. Choosing modal here means AS-23
   inherits a thread UX that already works on a phone instead of redoing it.
4. **Poll/push render paths (AS-25).** `renderThread()` stays the single
   thread-render entry point, a pure consumer of `state.lastData`. When AS-25
   replaces the poll with push, it swaps how `lastData` is refreshed; the
   modal never fetches on its own. No corner painted.
5. **Minimal delta.** `openThread`/`closeThread`/`renderThread` and the AS-9
   URL semantics carry over intact; this is a re-housing of the thread pane,
   not a rewrite of thread state.

The main cost of a modal — it hides channel context — is mitigated because the
thread root renders at the top of the modal, and one click (or Escape, or Back)
returns to an *unmoved* channel pane.

## Interaction design

- **Open:** clicking "reply in thread" or the "N replies" link (unchanged
  affordances), or arriving with `?c=<conv>&t=<id>` (AS-9). Modal opens with
  the root message pinned first, replies below, thread composer at the bottom;
  scrolled to newest reply (`forceBottom: true`, as today). Focus moves to the
  thread composer input.
- **Close:** the × button, a click on the backdrop, or Escape. All route
  through the existing `closeThread()` (history `push`, matching today's ×
  semantics — Back reopens the thread). Escape handler is document-level,
  active only while the modal is visible, and ignores events already
  `defaultPrevented` (so the DM-typeahead's own Escape wiring is untouched).
  Browser Back with the modal open closes it via the existing
  `popstate → restoreFromUrl` path — no new code; `selectConversation`'s
  default `keepThread: false` already handles it.
- **While open:** the 5s poll re-renders replies with AS-17 sticky-bottom
  semantics (follow only if at bottom). Sending a reply keeps the modal open
  (existing `sendMessage` → `keepThread: true` path).
- **Desktop sizing:** dialog `width: min(860px, 92vw)`, `height: min(85vh,
  100%)`, flex column (header / scrollable messages / composer). Message
  bodies get `max-width: 72ch` for a readable measure inside the wide dialog.
- **Narrow viewports (≤600px):** the dialog becomes a full-screen sheet —
  `inset: 0`, full width/height (`100dvh`), no border-radius. This ships in
  AS-19 because it is intrinsic to the modal's own CSS, not an AS-23 favor.
- **Accessibility floor:** `role="dialog"`, `aria-modal="true"`,
  `aria-labelledby="thread-title"`; focus into the dialog on open. A full
  focus trap is out of scope for this localhost tool — recorded here as an
  accepted limitation, not an oversight.

## DOM / render approach (textContent-only rule)

`index.html`: replace the `<aside id="thread-panel">` block with a static
modal skeleton (no user content in markup, so the house rule is untouched):

```html
<div id="thread-modal" hidden>
  <div id="thread-dialog" role="dialog" aria-modal="true"
       aria-labelledby="thread-title" tabindex="-1">
    <header><span id="thread-title"></span>
            <button id="thread-close" title="Close thread">×</button></header>
    <div id="thread-messages"></div>
    <form id="thread-composer">…same composer as today…</form>
  </div>
</div>
```

The outer `#thread-modal` (fixed, `inset:0`, dimmed background) *is* the
backdrop — a click whose `target` is `#thread-modal` itself (not the dialog)
closes. Inner ids (`#thread-title`, `#thread-messages`, `#thread-composer`,
`#thread-input`, `#thread-close`) are kept verbatim so `renderThread()`,
`wireComposer`, and the close wiring in `app.js` need only the container-id
swap (`#thread-panel` → `#thread-modal`) plus the new backdrop/Escape/focus
listeners. All dynamic content continues through the `el()` helper /
`textContent` — no innerHTML anywhere, per the file-header rule.

`style.css`: delete the `#thread-panel` column rules; add `#thread-modal`
overlay + `#thread-dialog` rules + the ≤600px full-screen media query. The
`#app` flex row drops from three potential columns to two (roster sidebar +
main) — AS-8 sidebar rules untouched.

`apps/chat/README.md`: no wording changes required by this design (the AS-9
section describes *what* `t=` does, not where the thread renders); scan for
any "sidebar/panel" phrasing about threads during implementation and adjust
only if found.

## URL semantics (AS-9 — unchanged, verbatim)

- `?c=<conv>&t=<id>` opens the thread modal rooted at `<id>`; `t` requires
  `c`; `m` is ignored when `t` is present; dead `t` (root not in the fetched
  messages) is stripped via `replaceState`, conversation stays open.
- `openThread`/`closeThread` keep their `syncUrl('push')` behavior; the poll
  never writes the URL. `restoreFromUrl` needs **zero changes** — it already
  calls `openThread(parsed.thread, { url: 'none' })`, which now shows the
  modal instead of the sidebar. The presentation changed; the contract did not.

## Files

- `apps/chat/public/index.html` — thread panel → modal skeleton.
- `apps/chat/public/style.css` — modal/backdrop/sheet styles; remove sidebar
  column styles.
- `apps/chat/public/app.js` — `openThread`/`closeThread` toggle
  `#thread-modal`; backdrop-click + Escape + focus wiring in `init()`.
- `apps/chat/test/` — existing suites only (see test plan); add tests only if
  a pure helper is extracted.

Out of scope: `scroll.js`, `url-state.js`, server, CLI, roster sidebar (AS-8),
task panel, any top-level markdown.

## Test plan (honest about the harness boundary)

There is no browser harness in this repo; the modal is DOM/CSS. The testable
contracts this rework must not break already have suites, and they are the
regression net:

- `node --test` in-container: **url-state.test.js** (the `t=` grammar,
  serialization, resolution) and **scroll.test.js** (sticky-bottom semantics
  the modal pane consumes) must pass *unchanged* — if either needs editing,
  the design has drifted and QA should flag it. Full suite green as usual.
- If implementation extracts any pure helper (e.g. close-eligibility logic),
  it lands in its own module with node:test coverage, same pattern as
  scroll.js. Do not force an extraction just to have a new test file.

## Acceptance criteria

Hand-walk (browser, `docker compose up`, desktop + narrow window — no
automated browser harness exists; QA walks these manually and records each):

1. "N replies" / "reply in thread" opens a centered modal ~860px wide on
   desktop; the narrow right thread sidebar is gone from DOM and CSS.
2. Reading check against real data: open `#board` → thread on msg 113; the
   ~3KB replies render at a comfortable measure (~72ch), not a 40-char column.
3. `/?c=board&t=113` (pasted fresh, and via reload with the modal open)
   restores channel + modal. `m=` still ignored when `t=` present; a dead `t`
   is stripped and the channel stays open. (AS-9 contract.)
4. Close via ×, backdrop click, and Escape all work; each is a history push;
   Back reopens the modal, Forward re-closes it (popstate path). Escape while
   the DM typeahead is open closes the typeahead only.
5. With the modal open and scrolled up, the 5s poll does not yank scroll;
   at bottom, new replies follow. Sending a reply keeps the modal open.
   (AS-17 semantics on the new pane.)
6. Opening and closing a thread leaves the channel pane's scroll position
   exactly where it was.
7. At ≤600px width, the modal is a full-screen sheet, no horizontal scroll;
   composer visible and usable.
8. Roster/DM sidebar (AS-8) behavior unchanged.

Automated (in-container): 9. `node --test` fully green; `url-state.test.js`
and `scroll.test.js` pass without modification.

## Sequencing notes for the orchestrator

- **AS-23 stays a separate task** (recommendation, with rationale in the
  planning comment): AS-19 ships the thread surface's own narrow-viewport
  behavior because it is inseparable from the modal CSS, but AS-23's scope —
  sidebar drawer, touch targets, keyboard/composer handling, global no-
  horizontal-scroll — is a distinct layout pass over different regions.
  AS-19 merely removes mobile's biggest blocker (the third column) first,
  which is exactly why the queue is AS-19 → AS-23.
- **AS-25**: thread rendering stays a consumer of `state.lastData` via
  `renderThread()`; push delivery later swaps the refresh mechanism, not the
  render path.
