# AS-135 — Chat: incremental message DOM (stop rebuilding the pane on live frames)

Planner: agent:cto-owen, 2026-09-12. Complexity medium. Implementer: developer-lena. Reviewer: qa-ruben.
Scratchpad (thinking past this cap, rejected options): `scratchpad/agent-cto-owen/AS-135/notes.md`.

## Scope
**In:** every non-navigation re-render of `apps/chat` — SSE frame (`handleFrame`), send echo (`sendMessage`),
`since=` catch-up (`catchUp`) — becomes an incremental DOM update: one `messageNode` inserted in id order into the
main pane (top-level) or the open thread pane (reply), and the reply's root patched in place. Plus R5 from the
AS-131 review: `mergeOlderPage` unions an orphan reply list into a fresh root's server list instead of overwriting it.
**Out:** `loadOlderPage` keeps its rebuild under `prependPreservingScroll` (user-initiated, once per page; not the hot
path); navigation (`selectConversation`, `openThread`) keeps the full `renderConversation`/`renderThread`; server,
store, CLI, export untouched. No CSS change.

## Decisions
1. **The logic lives in a new module `public/message-pane.js`, not in app.js.** scroll.js pattern: it takes the
   panes and node factories as arguments and touches only `id`, `classList`, `children`, `insertBefore`,
   `appendChild`, `removeChild`, `textContent`, and the three scroll metrics — so a plain-object fake element is a
   faithful double and the falsifiers below are host tests, no jsdom (zero-dependency rule). app.js supplies DOM
   factories and wiring only.
2. **Mirror invariant** (the property everything rests on): the main pane's `.message` children equal
   `data.messages` in id order; the thread pane equals `[root, ...threads[root]]`. Rebuilt from data on navigation
   and prepend, patched on frames. Criterion 7 asserts it directly (incremental == fresh render).
3. **Sticky-bottom is composed, not reimplemented:** each insert runs inside `renderPreservingScroll(pane, …)`
   (AS-17). A catch-up delta is N inserts, each measured; at-bottom stays at-bottom, scrolled-up restores exactly.
4. **Idempotent at the DOM level too:** an insert whose `msg-<id>` already exists is a no-op — belt over
   `applyMessage`'s braces. Out-of-order ids (a frame delayed past the page fetch) insert in id order by walking from
   the last child backwards (append is the hot path, one comparison).
5. **Reply count has one label source:** `replyLabel(count)` in the module, used by `messageNode` and the patch. The
   patch edits the existing `.thread-link` text in place, or appends one via the factory when the root had none.
   No count-0 branch: replyCount never decreases.
6. **Routing is pure and exported** — `frameTargets(data, msg, currentThreadRoot)` → `{ insertMain, patchRoot:
   {id,count}|null, insertThread }`: top-level → main only; reply on a loaded root → patch that root, thread insert
   only if that thread is open; orphan reply (root unloaded) → nothing.
7. **`applyAnchor()` still runs after each frame** (one-shot; a no-op unless pending). The anchored node is no longer
   recreated, so the highlight and `state.anchorMsg` survive a frame — node identity is the observable.
8. **R5:** for a fresh root, `mergeOlderPage` sets `threads[root] = union(page list, existing list)` id-ordered and
   deduped, and `root.replyCount = that.length` (page threads carry every reply, AS-131 Decision 3). Loaded roots
   keep the AS-131 "keep" rule; the existing criterion-8 test is unchanged, the new case is additive.

## Approach / key files
- `apps/chat/public/message-pane.js` (new): `messageIdOf(node)`, `replyLabel(count)`, `insertMessageNode(pane,
  node)` → bool (removes an `.empty-note`, keeps the `.load-earlier` button first), `setReplyCount(pane, rootId,
  count, makeLink)` → bool, `frameTargets(...)`, `applyFrameToPanes({ data, msg, currentThreadRoot, mainPane,
  threadPane, nodeFor, linkFor })` — the one entry app.js calls; imports `renderPreservingScroll` from scroll.js.
- `apps/chat/public/app.js`: extract `threadLinkNode(rootId, count)` from `messageNode` (uses `replyLabel`); new
  `renderFrame(msg)` = `applyFrameToPanes(...)` + `applyAnchor()`; `handleFrame`, `sendMessage`, `catchUp` call it
  instead of `renderConversation`. `renderConversation` keeps exactly one caller (`selectConversation`).
- `apps/chat/public/live.js`: Decision 8 in `mergeOlderPage`.
- Tests: `apps/chat/test/message-pane.test.js` (new; fake element ≈ 40 lines, scroll metrics grow per child),
  one new case in `test/live.test.js`, source pins on app.js in the new file (copy-refs T17 style).
- Docs: one line in `apps/chat/README.md` (rendering rule: frames patch, navigation rebuilds).

## Sequencing / staffing
1. Lena: `message-pane.js` + its tests (commit). 2. app.js wiring + pins, README (commit). 3. live.js R5 + test
(commit). Progress note in `scratchpad/agent-developer-lena/AS-135/`; exact host + `--build` baseline in the first comment.
4. Manual check on the worktree server (not 8347): open a channel, receive a frame while scrolled up, open a thread and
reply, click a permalink then receive a frame — note in the comment.
5. Ruben reviews cold: plan + `git diff master...feat/AS-135-incremental-dom` in `.worktrees/AS-135`, host suite +
counted compose run. Why Ruben: Priya reviewed AS-131 twice and R5 is her own residual; the risk here is a merge
seam (frame vs prepend vs union), his lane.

## Acceptance criteria (each names its falsifier; a criterion passes only with the red observed)
1. Top-level frame adds **exactly one** child to the main pane, at the end, and every pre-existing child keeps its
   node identity. **M1:** replace the insert with a full `replaceChildren` rebuild → T1 red (identity), T7 red.
2. Out-of-order id lands in id order: [btn, m10, m30] + m20 → [btn, m10, m20, m30]; an id below every loaded row
   lands after the `.load-earlier` button. **M2:** append unconditionally → T2 red, T7 red.
3. DOM-level idempotence: inserting an id already present returns false, child count unchanged. **M3:** drop the
   `messageIdOf` lookup → T3 red, T7 red (the sequence includes a duplicate).
4. First message into an empty pane removes the `.empty-note`. **M4:** skip the removal → T4 red.
5. Reply frame patches **only** its root: root 5 gains/updates `.thread-link` with `replyLabel(count)` (1 → "1 reply",
   2 → "2 replies", same link node identity on the second patch); roots 3 and 7 untouched. **M5:** patch the first
   `.message` child instead of `#msg-<root>` → T5 red, T7 red. **M5b:** invert the plural rule → T5 red.
6. `frameTargets`: top-level → `{insertMain:true, patchRoot:null, insertThread:false}`; reply, root loaded, thread
   closed → patch only; reply with that thread open → patch + insertThread; reply with a *different* thread open →
   patch only; orphan reply → all null/false. **M6:** drop the `currentThreadRoot === threadRootId` check → T6 red.
   **M6b:** patch even when the root is unloaded → T6 red (orphan case).
7. Equivalence: a scripted sequence (append, out-of-order, duplicate, three replies on two roots, a thread open
   mid-sequence) applied incrementally to fake panes yields the same id list and labels as a fresh render of the
   final `data`. Falsified by M1/M2/M3/M5 above (their red sets include T7).
8. Sticky-bottom survives an incremental insert: fake main pane scrolled up (top 300 of 1000/500) + frame →
   scrollTop 300; at bottom + frame → new bottom; same for the thread pane. **M7:** call `insertMessageNode`
   outside `renderPreservingScroll` → T8 red (fake scrollHeight grows, scrollTop does not follow).
9. Anchor survives: node with class `anchored` + a frame → same node object, class still present. Falsified by M1
   (T9 red alongside T1).
10. Navigation still rebuilds, frames never do (source pins): app.js has exactly **one** `renderConversation(` call
    site outside its definition (`selectConversation`), `handleFrame`/`sendMessage`/`catchUp` reference `renderFrame(`,
    and `renderFrame` calls `applyAnchor()`. **M8:** restore `renderConversation({ scroll: 'preserve' })` in
    `handleFrame` → T10 red.
11. Older-page prepend unchanged: AS-131 M9 (drop the height delta in `prependPreservingScroll`) re-run at the new
    tip → red set exactly {scroll: prependPreservingScroll × 2}, nothing else.
12. R5: fresh root whose `threads[root]` already holds a live orphan reply not in the page list → merged list is the
    union, id-ordered, deduped, `replyCount === merged.length`; a loaded root still keeps its list (existing test
    green). **M9:** restore plain assignment → new live test red only.
13. Suite: host green; one counted compose run with `--build` via `node apps/chat/bin/compose-run.mjs --project
    asc-impl-as135 --cwd .worktrees/AS-135/apps/chat` (`Image asc-impl-as135-test Built` is the receipt); mutant
    table with exact red sets in the implementer's scratchpad, every mutant asserted at site in a scratch copy.

## Predicted counts
Baseline master (AS-132 merge): host 663/660/0/3, compose 663/654/0/9. Expected **+11 host tests** (message-pane
T1–T10, live 1), skips unchanged → host 674/671/0/3, compose 674/665/0/9. Implementer records the actual baseline.

## Open questions (time-boxed; default applies at the box)
- Q1 Does `#thread-messages` need the `.empty-note` handling? Default no — a thread pane always has its root
  (box: step 1).
- Q2 Should the prepend also go incremental? Default no (out of scope above); file only if the manual check shows a
  visible stall on scroll-up.
