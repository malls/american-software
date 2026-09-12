# AS-131 progress — developer-lena

Worktree `.worktrees/AS-131`, branch `feat/AS-131-lazy-load-messages` (fast-forwarded onto master 0e895be; no apps/ drift).
Host runner: `node scratchpad/agent-developer-lena/AS-131/run-host.mjs <label>` (bare `node --test`, cwd apps/chat).

## Baseline (before changes)
host: 647 tests / 644 pass / 0 fail / 3 skipped — `host-baseline.log`

## Steps
- [x] 1. store.getMessagesPage + server ?before= branch + store/api tests — commit 9f5e950 (store 36/36, api 70/70)
- [x] 2. live.mergeOlderPage + ensureLoaded + scroll.prependPreservingScroll + tests — commit e705ae2 (live+scroll 16/16)
- [x] 3. app.js + style.css + README — commit 04d0d5f; host after step 3: 659/656/0/3 (`host-after-step3.log`)
- [x] 4. mutants M1–M10 (+M8b) all red, control green — `mutant-table.md`, `mutants-run1.log`, `mutants.log` (M4 re-run), `mutant-<M>.log`
- [x] 5. host after 659/656/0/3; compose `Image asc-impl-as131-test Built` 659/650/0/9 (`compose-impl.log`)
- [x] 6. follow-up AS-135 filed + linked related_to AS-131; comment posted; AS-131 -> review (--no-auto-review). `.lattice/` left dirty for the orchestrator.

## Remaining / notes
- DONE. Branch tip 04d0d5f, not pushed. Plan step 4 (browser scroll-up on compose app) left for review — 8347 runs master.
- Scratch worktree /tmp/AS-131-mutant removed after the battery.

## Review cycle 1 (F1 — orphan reply counted as loaded)
- [x] Fix: live.js `findLoaded(data, id)` (reply loaded only when its threadRootId is a loaded top-level row); `isLoaded` and app.js `findLoadedMessage` delegate. Criterion-12 test in live.test.js. Commit b90f2fa.
- [x] host 660/657/0/3 (`host-rework1.log`); compose `Image asc-impl-as131-rework1-test Built` 660/651/0/9, leak clean (`compose-rework1.log`).
- [x] M11 red = exactly the criterion-12 test; full M1–M11 re-battery at b90f2fa (`mutants-rework1.log`, table appended).
- Note: first draft of the test had a wrong fixture (fake server omitted the live reply from the root's list); corrected to the real shape — server list at fetch time includes every committed reply. Residuals R1–R4 untouched.
- [ ] comment + `review` (--no-auto-review); #engineering line.
