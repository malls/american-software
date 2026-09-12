# AS-135 review — mutant table (qa-ruben, 2026-09-12)

Branch `feat/AS-135-incremental-dom` @ bb0f43a (base 86f1529 = master ba5ec7b minus board commits; `git diff 86f1529 master -- apps/` empty; AS-130 / AS-50 branches touch nothing under apps/chat).
Scratch copy: `scratchpad/agent-qa-ruben/AS-135/scratch/` (rsync of the worktree, own git index so the git-backed deploy-shape guard runs; baseline 674/671/0/3 = worktree). Runner: `run-mutants.mjs`; per-mutant TAP in `mutant-<id>.tap.log`; mutated diffs in `mutant-battery.log`. Every mutant: exactly 1 match asserted at site, diff printed, full suite (674) run, `git checkout` restore, `git diff --exit-code` clean. Post-battery tree clean; scratch copy removed after.

Cardinality: 16 mutants run (plan's 11 + AS-131 M9 re-run + 4 of mine). 16 red, 0 survivors.

| id | mutation (site) | plan predicted | observed red set | deviation |
|---|---|---|---|---|
| M1 | applyFrameToPanes main insert → faithful full rebuild from `data.messages` (head kept, nodes recreated) | T1, T7, T9 | **T1, T9** | narrower by T7: a faithful rebuild is equivalent by construction (criterion 7 is an equivalence test); T7 only reds when the rebuild drops the `.load-earlier` head (Lena's variant) or appends out of order (M2). Identity guards T1/T9 catch it. |
| M2 | insertMessageNode: drop the backward walk (append always) | T2, T7 | T2, T7 | match |
| M3 | insertMessageNode: drop the `findMessage` dedupe | T3, T7 | T3, T7 | match |
| M4 | skip `.empty-note` removal | T4 | T4 | match |
| M5 | setReplyCount: patch the first `.message` instead of `#msg-<root>` | T5, T7 | **T5, T7, T9** | wider by T9 (anchored root 20 expects "1 reply") |
| M5b | replyLabel plural inverted | T5 | **T5, T7, T9** | wider by T7, T9 (both hard-code label literals) |
| M6 | frameTargets: `insertThread: true` always | T6 | **T6, T7** | wider by T7 (44-on-30 lands in thread 10's pane) |
| M6b | frameTargets: patch an unloaded root | T6 | T6 | match (setReplyCount returns false on a missing root, so T7 unaffected) |
| M7 | both inserts outside renderPreservingScroll | T8 | T8 | match |
| M8 | handleFrame back to `renderConversation({scroll:'preserve'})` | T10 | T10 | match |
| M9 | mergeOlderPage R5: plain assignment (no union) | live R5 test | `AS-135 live (R5)` only | match |
| AS131-M9 | prependPreservingScroll: drop the height delta (criterion 11) | {scroll: prependPreservingScroll × 2} | exactly `scroll: prependPreservingScroll — scrollTop moves by exactly…`, `scroll: prependPreservingScroll — never consults…` | match, nothing else |
| X1 | server.js: drop `/message-pane.js` from STATIC_FILES | AS-74 served-module test | `api: AS-74 — every served public/ module…` | pinned (fetch loop 404s) |
| X2 | catchUp loop merges without renderFrame | T10 | T10 | pinned |
| X3 | backward walk lands BEFORE the `.load-earlier` head | T2 | T2 | pinned |
| X4 | renderFrame drops applyAnchor() | T10 | T10 | pinned |

Wider sets = same defect seen by more observers (no finding beyond the plan's prediction accuracy). The M1 narrowing is a prediction that depends on which rebuild you write, not a guard gap.

## Counts
- Host, worktree: 674 / 671 / 0 / 3 (`host-baseline.log`). Prediction 674/671/0/3: match.
- Compose (`--build`, project `asc-review-as135`): **`Image asc-review-as135-test Built`**, 674 / 665 / 0 / 9, down exit 0, leak check clean (0 networks, 0 images) (`compose-run.log`). Prediction 674/665/0/9: match.

## Probes past the list (`probes.mjs` → `probes.log`): 20 run, 20 pass
Sticky slack edges (39/40 px), 5-frame catch-up scrolled up, root+reply in one delta, out-of-order reply in the thread pane, foreign-conversation frame, module boundary (applyFrameToPanes trusts applyMessage's boolean — documented), orphan → R5 union → prepend rebuild → live continues, R5 edges (no page entry / full overlap), thread close/reopen/switch mid-frames, prepend racing a frame, send-echo vs SSE both orders, DOM/data drift belt, empty pane + orphan, anchored reply in thread pane, count-0 label (unreachable), top-level frame with thread open, [btn]-only pane, messageIdOf edge ids (`msg-0` → 0 is handled by the `== null` check).

## Browser walk (plan step 4) — `walk/walk.mjs` → `walk/walk.log`: 19 steps, 19 pass
Headless Chrome (CDP over node WebSocket) against the BRANCH served by `node server.js` on :8399 with a throwaway DB (`CHAT_DB`/`CHAT_EVENTS_PATH` under `walk/`, deleted after; server and Chrome stopped after). Real served modules, real SSE frames from POSTs. Observed: cold load 50 + button; frame while scrolled up (scrollTop 900 → 900, 50 marked nodes keep identity, one node appended); frame at bottom follows; permalink → `.anchored` survives a frame (same node, URL keeps m=); thread open → reply frames insert in the thread pane, root label 1 → 2 → 3 replies on the same link node; own reply via composer = one node after the echo; reply on another root patches only; thread closed → patch only; Load-earlier click prepends 10, reader row held (111.14 → 111.38 px), older root shows its server count; frame after the prepend still incremental; navigation rebuilds (marks gone); zero page exceptions. First attempt's failures were fixture (scrollTop 120 crossed the AS-131 200 px auto-load threshold) — fixed and re-run on a fresh DB. Caveat: the thread pane never overflowed in the walk (W13 degenerate), so the thread-side sticky rule rests on T8 + the identical main-pane code path (W4).
