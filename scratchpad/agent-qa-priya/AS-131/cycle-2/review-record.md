# AS-131 review cycle 2 — qa-priya, 2026-09-12, tip b90f2fa

Verdict: **pass**. Findings outside the criteria list: 0 behaviour defects, 1 new residual (R5) + R1–R4 standing.

## Receipts
- Host (`.worktrees/AS-131/apps/chat`, `node --test`): 660 tests / 657 pass / 0 fail / 3 skipped — `cycle-2/host-suite.log`
- Compose counted run (`bin/compose-run.mjs --project asc-review2-as131`): `Image asc-review2-as131-test Built`, 660/651/0/9, leak check clean — `cycle-2/compose-run.out`, `cycle-2/compose-build.log`
- Mutant battery in the scratch worktree `/private/tmp/AS-131-mutant` (detached b90f2fa): `cycle-2/mutant-battery.log`, per-mutant `cycle-2/mutant-M*.log`
  - M11 (criterion 12; restore `if (hit) return hit;` in `findLoaded`, live.js:120): red set = exactly {criterion 12 test} (1). EXACT.
  - M1..M10 re-run at the new tip: every recorded cycle-1 red set reproduced, no widening or narrowing
    (M1 5, M2 4, M3 2, M4 3, M5 1, M6 2, M7 1, M8 2, M8b 1, M9 2, M10 1). M10's site moved 126→146 (findLoaded insertion) — confirmed at site.
  - `git diff --exit-code` after restore: CLEAN (scratch and review worktrees).

## Findings first
- **F1 (cycle 1) resolved at the site named**: `findLoadedMessage` (app.js:832) now delegates to `live.js findLoaded`, which returns a reply only when its `threadRootId` is a loaded top-level row. Browser probe A2/A3 (`cycle-2/probe-browser2.log`): live reply on a root outside the page → msg-ref click → thread modal shows [root, earlier reply, live reply], root paged in (3 page fetches), URL `?c&t&m`. Cycle-0 shortcut intact: C2 loaded-root live reply opens with zero fetches; B2 same ref after paging → zero fetches.
- **R5 (new residual, not blocking)**: `mergeOlderPage` installs the server's thread list for a FRESH root, overwriting an orphan list that a live frame put there between the server building the page and the client merging it (`probe-merge-race.log`). The reply is invisible until the next `since=` catch-up (maxLoadedId is recomputed from the payload, so catch-up does re-deliver it). Window = one page-fetch round trip. Criterion 8 pins "replaces only the page roots' threads", so this is a design residual: union with the orphan list for fresh roots would close it.
- R1–R4 (cycle 1) stand unchanged; R4 is now +13 host tests vs predicted +14.

## Criteria floor check (12/12 pass; a floor, not the review)
| # | Evidence |
|---|---|
| 1 | store/api walk tests green; M1 red set (5) exact |
| 2 | walk + terminal shape tests; `probe-api2.log` §1: 7-root walk at limit 3 = [12,13,14],[7,8,10],[5], terminal `nextBefore=5`, `before=<oldest>` → [] / false / null; M2 red (4) exact |
| 3 | M3 red (2) exact; `probe-api-rerun.log` limit=1/2/200/201 |
| 4 | `probe-api2.log` §1 threadsExact=true and replyCountExact=true on every page; M4 red (3) exact |
| 5 | `probe-api2.log` §4: `history --limit 3 --json` (2399 B, 9 rows), `history --json`, `history --limit 3`, `channels --json` BYTE-IDENTICAL master-server vs branch-server on one DB copy; export 5/5 files byte-identical; M5 red (1) exact |
| 6 | `probe-parity-rerun.log` 5/5 IDENTICAL 404 bodies; `probe-api-rerun.log` `before=abc`/`limit=0|201|x` → 400; M6 red (2) exact |
| 7 | `probe-api2.log` §3: page (max 14) + `POST /api/read` no upTo → unread none; counter-probe `upTo=14` leaves [15,16]; post-read reply on outside root → unread [17]; M7 red (1) exact |
| 8 | live tests; M8 red (2), M8b red (1) exact |
| 9 | scroll tests; M9 red (2) exact |
| 10 | live tests; M10 red (1) exact |
| 11 | host 660/657/0/3; compose `Image asc-review2-as131-test Built` 660/651/0/9 |
| 12 | criterion 12 test green; M11 red set = {that test}; browser A2/A3/B2/C2/E2/F1/G1 |

## Probes past the list
- `probe-browser2.log` 19/19 (F1 repro, zero-fetch shortcut, deep top-level ref, cross-conversation deep reply, orphan+scroll-up merge, `?t=` deep root, `?m=<reply>` strip, watermark).
- `probe-browser-rerun.log` 23/23 (cycle-1 battery at the new tip: scroll-up ×2, viewport preserved, Load-earlier click + triple-click, live frames while scrolled up, conversation switch race, dead-id permalink, no external URLs).
- `probe-api-rerun.log`: lenient `Number()` coercion (`before=`, `1e2`, `0x10` accepted) matches the `since=`/`limit=` precedent; `before`+`since` → since wins (delta path). Not criteria.
- tokens: all 11 CSS custom properties used by `.load-earlier` are defined in `tokens.css`.
- Inline fixes: none. Worktree clean; nothing committed by QA this cycle.
