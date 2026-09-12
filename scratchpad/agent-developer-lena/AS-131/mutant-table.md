# AS-131 mutant table (branch tip 04d0d5f, scratch worktree /tmp/AS-131-mutant detached, full host suite each; removed after)

Logs: `mutants-run1.log` (control + M1–M3, M5–M10; M4 aborted by my own site-check because the mutated text still contained the anchor), `mutants.log` (M4 re-run with the anchor truly gone), per-mutant suite output `mutant-<M>.log`. Every mutation: `diff --name-only` == the one intended file, mutated text present, anchor absent, 1 insertion / 1 deletion; scratch `diff --exit-code` clean after each and at the end.

| M | file / mutation | red set (exact) |
|---|---|---|
| control | none | 659/656/0/3, no reds |
| M1 | store.js `ORDER BY m.id DESC` → `ASC` | 5: api walk; api threads-scoped; api watermark; store walk; store threads |
| M2 | store.js `m.id < ?` → `m.id <= ?` | 4: api walk; api threads-scoped; store walk; store threads |
| M3 | store.js `LIMIT size + 1` → `size` | 2: api walk; store walk |
| M4 | store.js reply filter `IN (page ids)` → `IS NOT NULL OR IN (...)` | 3: api threads-scoped; api watermark; store threads |
| M5 | server.js page branch also on `limit` | 1: `api: AS-24 — GET /api/messages honors ?limit=` |
| M6 | store.js `before` validation moved above `requireVisible` | 2: api hidden-parity; store gate-before-validation |
| M7 | app.js open-time `/api/read` gains `upTo: maxLoadedId(data)` | 1: api watermark (source pin) |
| M8 | live.js `unshift` → `push` | 2: live mergeOlderPage; live ensureLoaded |
| M8b | live.js dedupe filter → `() => true` | 1: live mergeOlderPage |
| M9 | scroll.js restore `savedTop` without delta | 2: both prependPreservingScroll tests |
| M10 | live.js drop `!data.hasMore` stop | 1: live ensureLoaded (2-fetch case expects 2, gets 20) |

Wider-than-minimal sets (M1, M2, M4) are the same defect observed from the store and HTTP sides plus the watermark test's page-shape precondition — no test outside AS-131's went red except M5's intended AS-24 target.

## Review cycle 1 re-battery (branch tip b90f2fa, scratch /tmp/AS-131-mutant detached, full host suite each)

Log: `mutants-rework1.log` (control + M1–M11; same site-assertion discipline as above; scratch `diff --exit-code` clean after). M1–M10 reproduce their cycle-0 red sets exactly at the new tip (one more test in the denominator: 660/657/0/3 control).

| M | file / mutation | red set (exact) |
|---|---|---|
| control | none | 660/657/0/3, no reds |
| M11 | live.js `findLoaded`: `if (hit) return data.messages.some((m) => m.id === hit.threadRootId) ? hit : null;` → `if (hit) return hit;` (the pre-fix reply-only check) | 1: `AS-131 live: a reply whose root is outside the loaded pages is not loaded — findLoaded/isLoaded fall through so ensureLoaded pages the root in (criterion 12, F1)` |

M11 covers app.js too: `findLoadedMessage` now delegates to `findLoaded`, so there is one site to mutate.
