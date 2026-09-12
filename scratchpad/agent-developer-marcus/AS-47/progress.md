# AS-47 progress — developer-marcus

Branch `feat/AS-47-contract-screens`, worktree `.worktrees/AS-47`. Rebased onto master 8e3041b (contains AS-70). AS-46 NOT in history — §3.9 contingency applied (extraction is commit 1).

## SPLIT FIRED (§6): AS-47 is now screen 7 only. Screen 6 = AS-127 ("AS-47b"), depends_on AS-47, backlog.
Measurement at Unit A complete: `git diff --stat master...HEAD` = 1,245 ins + 210 del = 1,455 changed lines (Unit A alone 1,013+48 = 1,061; extraction 236+166 = 402). Stop line 800.

## Commits
1. bab2075 — route-surface extraction (auth.test.js 1197 -> 1039; helpers/routes.js; route-surface.test.js; harness 18). Suite 420/402/0/18 Built asc-impl-as47-test. (master itself: 419/401/0/18 Built asc-impl-as47-master-test — the +1 is `test/helpers/routes.js` counted as a file by bare `node --test`, same as helpers/server.js and helpers/auth.js already are.)
2. b06dc52 — screen 7 whole: view model, template, route, RAW_OUTPUT_SANCTIONED entry, css (nav, btn-secondary, doc, contract-doc x7, print), mobile-first amendment, cases 20–29. Suite 430/411/1/18 Built (run4-unitA.log). The 1 red = case 28 on GET /invoices/new (seam, F8 second direction).
3. 6182dca — README §9 adjusted for the split.

## §6 order of work (post-split)
- [x] (0) §3.9 extraction
- [x] (1) Unit A
- [x] (2) measure, decide -> SPLIT, AS-127 filed
- [x] (6) README (P8 recount done in commit 2: 1 -> 2)
- [~] (7) recipes §8 for screen 7: DONE F-raw(a) [5 predicted, 5 observed + seam], F-raw-b [3 predicted, 5 observed + seam — cases 22, 23 also count the region once; classified]. TODO: F-raw b/c, F-dl a/b, F-sys, F-print-a/b, F11b, F8, F-order-P8, F12. Runner: recipe.cjs <name> <mutator> (extract includes .dockerignore).
- [ ] (8) rebase onto master containing AS-46, recount, `invoice-form.ejs` anchor (New contract link), --build receipts test + contract, then review
- [ ] §5 375px + print + download inspection (needs web service on 8359; not done)

## Recounts on this tip
routes 19 / G1b 18 / protected 13 / G15 19; source 54; VIEWS 3; expectFiles 4; P4 3; VIEW_START_TAGS 87+43+60; harness 19; APP_CSS 152/114; P8 2 + Y2 list (Y2 is a literal plan §0.2 missed); auth.test.js 1039 lines.

## Deviations / decisions recorded
- S7 default input (no row, no failure) -> S7-ERROR-NOTFOUND (VIEWS probe).
- §3.8 injection: schema CHECK json_valid(variables) refuses the corrupt-JSON injection (measured, asserted in case 25); S7-ERROR-SYSTEM reached by DROP TABLE contracts after the row exists.
- Nav/btn-secondary declared in app.css here because AS-46 not in history — reconcile at rebase (rule name occurs once).
- Template markers for NOTFOUND/SYSTEM are the boolean branches `if (isNotFound)` / `if (isSystem)` (AS-70's `if (lede !== null)` precedent); copy stays in the view model; case 24 asserts the NOTFOUND sentence so the marker is not decorative.
- Case 28 uses a fetch-driven instrument (every link driven at the built app with a session; 404 is a finding); 5 links in contract-detail.ejs.
- invoice-form.ejs anchor: PENDING (needs AS-46 in history).

## Next tick
1. If AS-46 merged: `git -C .worktrees/AS-47 rebase master` (expect conflicts in app.css nav/btn-secondary, route-surface.test.js literals, harness list, dependency-policy source list/expectFiles/VIEW_START_TAGS, README) — recount everything; add the one anchor to views/invoice-form.ejs; case 28 goes green.
2. Run recipes §8 (screen 7 set), record red sets in scratchpad + comment.
3. --build receipts for test and contract; §5 inspection on 8359; then `lattice status AS-47 review --no-auto-review`.

## Tick 7 — predictions written BEFORE running (concept row = dependency-policy 'the concepts live exactly where ... AS-47 put them'; assets = 'every visual value in public/ CSS traces to a token that exists'; mobile-first = screens.test.js 'app.css is mobile-first...'; seam red case 28 present in every run, subtracted)
- F-raw (b) `<%- title %>` in the h1 (assert `<%-` 1->2): PREDICT 2 = concept row (not sanctioned, contract-detail.ejs h1 line) + case 20 (rawLines 2). Plan said 1; +1 is case 20's source count (same classification as F-raw (a)).
- F-raw (c) `<div><%- renderedHtml %></div>` (assert whole-line 1->0, marker 0->1): PREDICT 2 = concept row (findings deepEqual fires first: "not sanctioned") + case 20 (assert.match whole-line). Plan said 1.
- F-dl (a) Boolean(req.query.download): PREDICT 1 = case 23 (ASC47MARK attaches).
- F-dl (b) filename from req.params.id: PREDICT 0 (structural: header after lookup; ids equal for a found row).
- F-sys remove DROP TABLE in case 25: PREDICT 1 = case 25 (200/S7-DEFAULT, expected 500).
- F-print-a `.contract-doc__notice { display: none; }` inside print: PREDICT 2 = case 29 (rules 3 != 2) + assets (declarations 153 != 152). Plan said 1; assets counts every declaration.
- F-print-b duplicate `@media print { .doc-region { padding: 0; } }`: PREDICT 3 = case 29 (starts 2) + mobile-first (printPreludes 2) + assets (153).
- F-print-c `@media (max-width: 600px) {}`: PREDICT 2 = mobile-first (max-width) + assets carve-out (c) (600px with no --breakpoint comment). Plan said mobile-first only.
- F11b NOTOWNER -> 'rendered': PREDICT 1 = case 20.
- F8 href /contracts/nwe: PREDICT 2 = case 28 (nwe -> :id -> 404) + case 21 (href="/contracts/new" count 0). Plan said 1.
- F-order-P8: not a mutation; P8 alone; list expected ['GET /contracts/:id', 'POST /contracts'] (2, post-split; plan's "4" was for both screens).
- F12 start/end: ASC_SELFTEST_MUTATE=1 -> exit 1 with V1 + seam; plain -> exit 1 on this tip with EXACTLY the seam (case 28) — the "plain exits 0" end is only reachable after the AS-46 rebase.

## Tick 7 — FINDING from the F8 chase: case 28 had TWO seam reds, /invoices/new (AS-46) AND /contracts/new (AS-127, post-split); the first-failure assert hid the second. Even after the AS-46 rebase the branch could not go green. Fix: "New contract" nav anchor removed from contract-detail.ejs; AS-127 adds it (screen 7 AND the invoice-form.ejs entry) with the route. Case 21 asserts the href is ABSENT; case 28 cardinality 5 -> 4; VIEW_START_TAGS 60 -> 59 for contract-detail.ejs (predicted; the plain run confirms); README two sentences. The §3.6 invoice-form.ejs anchor obligation therefore moves to AS-127 too (no rebase-time anchor edit in this task).
- F8 re-targeted: action="/signout" -> "/signuot". PREDICT 2 = case 28 (names /signuot AND the seam /invoices/new) + case 21 (signout form string count 1 -> 0).

## Tick 7 — RESULTS (seam red = case 28 on /invoices/new in every run, subtracted)
| recipe | assert-applied | predicted | observed | class |
| F-raw (b) | <%- 1->2 (h1 site) | 2: concept row + c20 | 3: + c25 | WIDER: c25 counts `Couldn&#39;t` twice (title+h1); raw h1 unescapes the apostrophe. 4th reader, not a weakness |
| F-raw (c) | whole-line 1->0, marker 0->1 | 2: concept row (not sanctioned) + c20 (assert.match) | 2 exact | held |
| F-dl (a) | ==='1' 1->0 | 1: c23 | 1 exact | held |
| F-dl (b) | contract.id -> req.params.id in the header line | 0 | 0 | structural, as the plan says: header after lookup; equal for a found row |
| F-sys | DROP TABLE removed from c25 | 1: c25 | 1 exact | held (200/S7-DEFAULT rendered) |
| F-print-a | notice hidden in print 0->1 | 2: c29 + assets (153) | 2 exact | held (plan said 1; assets counts every declaration) |
| F-print-b | @media print 1->2 | 3: c29 + mobile-first + assets | 3 exact | held (plan said 2) |
| F-print-c | max-width prelude 0->1 | 2: mobile-first + assets carve-out (600px no comment) | 2 exact | held (plan said 1) |
| F11b | NOTOWNER disposition | 1: c20 | 1 exact | held |
| F8 (first) | href nwe 0->1 | 2: c28 + c21 | c21 + c28 — but c28 failed on /invoices/new FIRST, mutant masked | LEAD -> fix a202be0 (collect all) |
| F8 (retarget) | action /signuot 0->1 | 2: c28 (names /invoices/new AND POST /signuot) + c21 | 2 exact | held |
| F-order-P8 | none | green, list ['GET /contracts/:id','POST /contracts'] | 1/1 green (p8e) | held |
| F12 mutate | env | exit 1: V1 + seam | exact (f12, f12b, f12c) | held |
| F12 plain | none | exit 1 with EXACTLY the seam | exact (plain4 430/411/1/18) | the exit-0 end waits for the rebase |
Commits: a202be0 (c28 collects), c2f263b (New contract anchor -> AS-127), 539f7ae (VIEW_START_TAGS 58). Tip 539f7ae.
Receipts on the tip: test 430/411/1/18 'Image asc-as47-plain4-test Built'; contract 430/429/1/0 'Image asc-as47-contract-contract Built' (same one red); mutate 430/410/2/18 'Image asc-as47-f12c-test Built'.
Seam note for the rebase (Ruben's AS-46 N9): take AS-46's test/route-surface.test.js and test/helpers/routes.js, re-add AS-47's GET /contracts/:id entries (G1/G1b/G2/G3/G15), recount. The invoice-form.ejs anchor is NOT added at rebase any more (AS-127's).
Remaining before review beyond the rebase/recount: §5 375px/print/download inspection (needs the web service on 8359); the post-rebase receipts (test, contract, F12 plain exit 0).

## Tick 8 — REBASE onto AS-46 (master 474e8dc, code tip 7e680f8). Opus under the Fable fallback.
- Per-commit rebase hit 3 conflicted files on commit 1 and 7 on commit 2 with 4 commits still to go; under an 18-min box I aborted and did ONE pass: `merge --squash 539f7ae` on detached master, resolved, committed. Six commits -> one squash (29a5b28) + one recount (662eeab). Per-commit history is on the task record (comments 1-3).
- N9 seam: took AS-46's test/route-surface.test.js + test/helpers/routes.js, re-added 'GET /contracts/:id' to ALL_ROUTES and G2's protected list; G1 22->23, G1b 21->22, G3 protected 16->17, auth.test.js 22->23. Dropped my extraction (bab2075). auth.test.js auto-merge kept BOTH discoverRoutes imports (SyntaxError, run 1) — removed the duplicate.
- harness.test.js: list auto-merged to the union (20), literal 19->20.
- app.css: nav + btn-secondary are AS-46's single declarations (my duplicates dropped, incl. `margin: 0` on .site-nav__signout); document/print block appended after the line-items block.
- Recounts (measured by the suite on run 1, written after): source 54->56, VIEWS 3->4, expectFiles 4->5 (x4 rows), P4 files 3->4, VIEW_START_TAGS 87+43+206+58 = 394, APP_CSS_DECLARATIONS 146->184, APP_CSS_VAR_REFERENCES 115->143 (run 2), TEMPLATE_LINKS 13->17, templates 3->4.
- Predicted 461 (451 + 10 cases). Run 1: 414 (auth.test.js dead at load) + 6 red literals. Run 2: 461/442/1/18. Final: test 461/443/0/18 'Image asc-impl-as47-rb-test Built', contract 461/461/0/0 'Image asc-impl-as47-rb-contract Built'; torn down (exit 0). Case 28 green. Logs: rebase-run1/run2/final-test/final-contract.log.
- NOT DONE: §5 eyes half (375px x3 states, print preview S7-DEFAULT, download from disk) — next tick's first job before review. F12 "plain exits 0" end now observed.

## Tick 9 — §5 EYES HALF DONE (Opus under the Fable fallback). Tip unchanged 662eeab; no code change, so the tick-8 receipts stand.
- Runner: visual.mjs (this dir) — compose project asc-as47-visual, web on 127.0.0.1:8359 (`Image asc-as47-visual-web Built`), signup over HTTP, client via in-container seeder, contract via the real POST /contracts (303 -> /contracts/<id>), Chrome 152 headless over CDP with Emulation.setDeviceMetricsOverride 375x812 (measured: innerWidth=clientWidth=scrollWidth=375 on every render), light AND dark, PNGs + inspection.log in visual/. Torn down `down -v --rmi local` exit 0.
- Examined: 3 states x 2 schemes at 375 (6 renders) + print emulation at 816 and 375 + Page.printToPDF (1 page, 136,867 bytes) + download from disk at 375 light/dark and 1024 light (3 renders). Total 11 renders + 1 PDF + 1 saved .html.
- Seen: zero elements crossing the 375 edge in all 6 screen renders; the 60-char unbroken identifier breaks (overflow-wrap: break-word) inside .contract-doc__multiline; `<b>markup</b>` in the description shows as text; 6 bold runs (3 party/date + 3 [PLACEHOLDER — …]) wrap within 41..318; Download button 16..125 x 338..380; Retry 16..91 x 306..348; Sign out right-aligned 299..359.
- Print (emulated + PDF): .site-header/.site-nav/.page-title/.doc-actions/.page-meta all display:none; .doc-region/.contract-doc block; notice first, attribution last; ONE page.
- Download: 200, text/html, `attachment; filename="contract-<uuid>.html"`, 2,154 bytes, 0 <nav, 0 <form, 2 <link (root-relative), 0 '://'; opened from file:// — Times, transparent bg, both stylesheets unreadable/absent, zero resources fetched, no overflow at 375; the <strong> runs survive unstyled (semantic bold), the notice TITLE does not (it is a <p>, render.js's frozen contract).
- INFERRED, not observed: unstyled, .contract-doc__multiline computes white-space=normal, so a description with literal newlines would collapse its paragraph breaks in the downloaded file (my probe description had none). Recorded as an observation for the review; not a change in this task (render.js byte-identical per AC-34; §3.4 says unstyled by construction).
- Probe caveat: the `over` filter is hard-wired to 375, so the 816/1024 runs list every element wider than 375 as "overflowing" — that is the probe, not the page (scrollWidth == clientWidth there too).
- NEXT: AC-38 comment posted; READY FOR REVIEW.
