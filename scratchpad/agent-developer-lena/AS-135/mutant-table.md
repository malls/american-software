# AS-135 mutant table (branch tip bb0f43a; scratch worktree /tmp/AS-135-mutant detached at the tip, full host suite each; removed after)

Battery: `mutants.mjs` (log `mutants.log`, per-mutant suite output `mutant-<M>.log`). Every mutation: anchor text occurs
exactly once in the target file, mutated text present and anchor absent after the write (aborts otherwise), `git diff
--numstat` == the one intended file; scratch `git checkout -- .` after each and `git diff --exit-code` clean at the end.
Node's spec reporter prints each failure twice (inline + summary), so `reds=` in the log is 2x the `fail` count; the sets
below are deduped. T-numbers are `test/message-pane.test.js` cases.

| M | file / mutation | red set (exact) | plan predicted |
|---|---|---|---|
| control | none | 674/671/0/3, no reds | — |
| M1 | message-pane.js applyFrameToPanes: main insert → `mainPane.replaceChildren(...data.messages.map(nodeFor))` | 3: T1, T7, T9 | T1, T7 (+T9 alongside) — match |
| M2 | message-pane.js insertMessageNode: `insertBefore/appendChild` → unconditional `appendChild` | 2: T2, T7 | match |
| M3 | message-pane.js insertMessageNode: drop `findMessage(pane, id)` duplicate lookup | 2: T3, T7 | match |
| M4 | message-pane.js insertMessageNode: `if (note) removeChild` → `if (note && false)` | 1: T4 | match |
| M5 | message-pane.js setReplyCount: `findMessage(pane, rootId)` → first `.message` child | 3: T5, T7, T9 | T5, T7 — **wider by T9**: T9 asserts the anchored root (index 1) shows "1 reply" after a reply on it; M5 patches index 0 instead. Same defect, second observer. |
| M5b | message-pane.js replyLabel: swap `'reply' : 'replies'` | 3: T5, T7, T9 | T5 — **wider by T7, T9**: both assert literal labels ("2 replies", "1 reply"). Same defect, more observers. |
| M6 | message-pane.js frameTargets: `insertThread: currentThreadRoot === msg.threadRootId` → `true` | 2: T6, T7 | T6 — **wider by T7**: the sequence has a reply on root 30 while thread 10 is open; it lands in the wrong thread pane. |
| M6b | message-pane.js frameTargets: orphan branch returns `patchRoot: {id, count: 0}` instead of null | 1: T6 | match |
| M7 | message-pane.js applyFrameToPanes: main insert outside `renderPreservingScroll` | 1: T8 | match |
| M7b | message-pane.js applyFrameToPanes: thread insert outside `renderPreservingScroll` | 1: T8 | (extra site) T8 |
| M8 | app.js handleFrame: `renderFrame(msg)` → `renderConversation({ scroll: 'preserve' })` | 1: T10 | match |
| M9-prepend | scroll.js prependPreservingScroll: `savedTop + delta` → `savedTop` (AS-131 M9 re-run, criterion 11) | 2: `scroll: prependPreservingScroll — scrollTop moves by exactly the height delta`, `scroll: prependPreservingScroll — never consults the sticky-bottom rule` | exactly {prependPreservingScroll × 2} — match; T8 unaffected |
| M9 | live.js mergeOlderPage: union block → `data.threads[root.id] = pageList` (plain assignment) | 1: `AS-135 live (R5): a fresh root whose threads[root] already holds a live orphan reply …` | new live test only — match |

No red outside AS-135's own tests except M9-prepend's two AS-131 scroll tests (its intended target). Wider-than-predicted sets
(M5, M5b, M6) are the same defect seen by more than one AS-135 test; none narrower.
