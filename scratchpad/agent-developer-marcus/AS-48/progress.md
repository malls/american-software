# AS-48 progress — developer-marcus (Opus, Fable fallback), tick watcher:79108 loop tick 10

Branch `feat/AS-48-read-views`, worktree `.worktrees/AS-48`, base master 61d8b3f (AS-46 in; AS-47/AS-49 NOT in — no rebase this stage).

## Findings against the plan (recorded before writing code)
- §0.2 says route-surface G1 = 21 today; the branch base has 22 (`POST /clients`, AS-65). Recount rule applies: +4 -> 26 / 25 / protected 20.
- §0.2 says dependency-policy source cardinality 52; branch base has 54. +5 -> 59.
- §0.2 says `test/invoice-screen.test.js` is NOT modified — but it carries two literals over VIEWS: `TEMPLATE_LINKS` (13) and `templates.length === 3` (the state-id case). Both move with two new templates. Minimal literal edits only.
- §3.1 says "the six screens.test.js cases" — they live in screens.test.js (2 cases: `a signed-in GET /signin lands...`, `GET / redirects a signed-in caller...`) AND auth.test.js (H11 admitted control at :699; the two terminus cases at :816/:831). auth.test.js gets those edits plus G15.
- §2 says app.css gains `.banner-success` — it already exists (AS-70). No-op.

## §6 order of work
- [x] (1) money.js formatDisplayMinorUnits + CURRENCY_SYMBOLS; dates.js formatDate; case 25
- [x] (2) dashboard-view.js, invoice-detail-view.js; cases 1-3
- [x] (3) pages.js rewrite, dashboard.ejs, six-case rewrites, route literals
- [x] (4) redirectors + GET /invoices/:id + invoice-detail.ejs
- [x] (5) measure: 2,265 changed lines at commit 4a75271 — OVER the 1,500 line. DEVIATION: Unit B was built inline before I measured (tunnel vision); Unit A alone ~2,050, so the trigger fires either way; kept as one unit, recorded for the CTO's ruling (split the review / file AS-48b, or accept).
- [x] (6) Unit B: POST /invoices/send, canSend, sendFailed — in commit 1
- [x] (7) nav anchors (invoice-form.ejs, connect-stripe.ejs READY control) — in commit 1. README: TODO
- [ ] (8) recipes §8 on a git-archive extract
- [ ] (9) rebase — NOT this stage (AS-47/49 not merged)
- [ ] §5 375px inspection (visual.mjs from AS-47, port 8360)

## Commits
1. 4a75271 — everything above. 475/457/0/18 `Image asc-impl-as48-2-test Built` (run2-test.log). Run 1 (run1-test.log) had 5 reds: Y2 (contracts.test.js literal the plan missed), health.test.js `GET / answers a signed-in caller` (literal the plan missed), and three of my assertions (EJS `&#39;` for apostrophes x2; guard `next` carries the query string).

## Receipts
- run2: asc-impl-as48-2 test 475/457/0/18 exit 0, `Image asc-impl-as48-2-test Built`, down 0, leak clean.

## Run 1 — PREDICTION before running (asc-impl-as48-1, test service)
451 (master) + 24 new cases in read-screens.test.js = 475 / 457 / 0 / 18. NOT 27: §7 cases 23 (screens.test.js, rewritten in place), 26 (recounts) and 27 (e2e, after AS-49) are not in the new file. Literal predictions: routes 26/25/protected 20/G15 26; VIEWS 5; source 59; expectFiles 6; P4 5; VIEW_START_TAGS 87+47+208+131+101=574; harness 20; APP_CSS 189/152; P8 2; TEMPLATE_LINKS 32; new-template links 17.

## §8 recipes — PREDICTIONS written BEFORE running (runner: recipe.cjs <name> <mutator>; extract = git archive HEAD 4a75271 + README commit)
Titles: c5 = 'every id the dashboard emits…', c6 = 'S3-DEFAULT-POPULATED: rows show…', c24r = read-screens 'every href and form action…', c24i = invoice-screen 'every href and form action…', concept = dependency-policy 'the concepts live exactly where…'.
- F1 form->anchor with id: PREDICT 5 = c5 + c6 (View buttons 3->2) + c24r + c24i (href="<%) + concept (P2a). Plan said 3; c6 and c24i are extra readers.
- F2 hosted as href: PREDICT 4 = c9 + concept (P2a) + c24r + c24i.
- F3 hostedInvoiceUrl null: PREDICT 3 = c9 + c10 (link on paid row) + c14 (pay.example.test 2->1). Plan said 1.
- F3a literal Amount: PREDICT 1 = concept (money row, 1 hit in views/).
- F4a pages.js swallows: PREDICT 1 = c8.
- F4b detail route system->not-found: PREDICT 1 = c21.
- F5 stripeReady=true: PREDICT 6 = c4 + c7 + screens.test.js x2 (gated note once) + auth.test.js x2 (same). Plan said 3.
- F6 canSend unguarded: PREDICT 2 = c15 (unready half) + c3 (pure canSend(NOT_READY)). Plan said 1.
- F7 /contracts/new anchor: PREDICT 3 = c24r (count 17->18) + c24i (32->33) + concept (VIEW_START_TAGS +2).
- F8 redirectors drop UUID test: PREDICT 1 = c18.
- F9 view after :id: PREDICT 2 = c19 + c18 (invoices half: HTML 404). 
- F10 toLocaleString('de-DE'): PREDICT 4 = c25 + c6 + c10 + c14 ($1,200.00 sites).
- F10b MINOR_DIGITS 3: PREDICT >= 6: c25 + c6/c9/c10/c11/c14 + invoice-screen money vectors + S4-DEFAULT-EDIT + save/typed-prices. Recorded as observed.
- F11a: PREDICT 1 = c1. F11b: PREDICT 1 = c2.
- F12 echo id in NOTFOUND title: PREDICT 1 = c20.
- F13 paid before failure: PREDICT 1 = c3 (pure precedence). Plan said c20/c21 — the route never passes invoice+failure together, so HTTP cannot reach the precedence; the pure case is where it lands.

## §8 recipes — OBSERVED (all on git-archive extracts of d5c6833; every run `Image asc-impl-as48-<name>-test Built`; every down exit 0; leak clean)
| recipe | assert-applied | predicted | observed | class |
| F1 | View form 1->0, href="/invoices/<% 0->1 | 5 | fail=5 (4 titles: concept, walker x2 [read-screens + invoice-screen], c5, c6) | exact |
| F2 | code element 1->0, href="<%= hostedInvoiceUrl 0->1 | 4 | fail=4 (c9, concept, walker x2) | exact |
| F3 | hostedInvoiceUrl local 1->0 | 3 | 3 (c9, c10, c14) | exact; plan said 1 |
| F3a | totalLabel interpolation 1->0 | 1 | 1 (concept money row) | exact |
| F4a | failure:'system' in pages.js 1->0 | 1 | 1 (c8) | exact |
| F4b | failure:'system' in detail route 2->0 | 1 | 1 (c21) | exact |
| F5 | stripeReady const 1->0 | 6 | 6 (c4, c7, screens x2, auth x2) | exact; plan said 3 |
| F6 | canSend guard 1->0 | 2 | 2 (c3, c15) | exact; plan said 1 |
| F7 | /contracts/new anchor 0->1 | 3 | fail=3 (concept + walker x2) | exact |
| F8 | UUID_SHAPE test 1->0 in BOTH redirectors (send route still checks) | 1 | 1 (c18) | exact |
| F9 | view registered after :id (order asserted) | 2 | 2 (c18, c19) | exact |
| F10 | THOUSANDS regex -> toLocaleString('de-DE') 1->0 | 4 | 4 (c25, c6, c10, c14) | exact |
| F10b | MINOR_DIGITS 2->3 | >=6 | 11 (c25, c6, c9, c10, c11 + invoice-screen: money vectors, S4-DEFAULT-EDIT, 25 rows, S4-ERROR-SYSTEM, save, send) | as expected: every price site |
| F11a | S3-ABANDON row 1->0 | 1 | 1 (c1) | exact |
| F11b | S5-ABANDON row 1->0 | 1 | 1 (c2) | exact |
| F12 | NOTFOUND branch echoes req.params.id in title | 1 | 1 (c20) | exact |
| F13 | paid moved ahead of failure (order asserted) | 1 | batch: 2 (c3 + stripe-client 'transport: times out'); ALONE (f13b): 1 (c3) | the extra red was load: 200ms transport timeout fired before the listener saw the request under 6 parallel suites; not AS-48's file, gone alone. Plan said c20/c21 — narrower: the route never passes invoice+failure together |

## §5 inspection — DONE (visual.mjs, project asc-as48-visual, port 8360, `Image asc-as48-visual-web Built`, Chrome/152 headless CDP, Emulation.setDeviceMetricsOverride 375x812 @2x)
24 renders = 12 states x light/dark: S3 EMPTY gated/ready, POPULATED ready/gated, ERROR-SYSTEM; S5 DRAFT, DRAFT?error=send, DRAFT gated, OPEN, PAID, ERROR-NOTFOUND, ERROR-SYSTEM. Page scrollWidth=375 in all 24. Not looked at: S3/S5-LOADING (unrenderable), DENIED-SIGNEDOUT (a 303), the void/uncollectible/unsent badges (rendered in tests, not captured), a desktop width.
FINDING (the plan's "look hardest" place): .table-wrap 16..359 overflow-x auto, clientWidth 341, scrollWidth 578 (contracts, 3 cols) / 751 (invoices, 4 cols) with the 57-char client name — the page does not widen, the table scrolls INSIDE the wrapper, but Amount/Status/View sit entirely off the first 375px with no visible affordance (screenshot S3-DEFAULT-POPULATED-*-375.png). Mechanism as designed; usability question for Jonah/reviewer (Q6).
Link text: code.link-text w=320, ~5 lines, overflow-wrap anywhere, len 175/158 — wraps inside the viewport. Badges/nav/controls all within 16..359.
Teardown: down -v --rmi local exit 0 but the detached `run -d web` container survived (compose does not claim run containers — Owen's AS-49 finding); removed by name with docker rm -f, then image, network, volume; leak check clean after.

# Stage 2 — rebase onto post-AS-47 master 70bcb5b (tick watcher:79108 loop tick 11, Opus under the Fable fallback)
- [ ] rebase feat/AS-48-read-views (d5c6833) onto master 70bcb5b; conflicts expected: README.md, lib/views.js, routes/contracts.js, plus test literals
- [ ] recount literals from failing tests; contract-detail.ejs Dashboard anchor
- [ ] receipts asc-impl-as48-3 (test + contract), --build
- [ ] commit seam fixes; Lattice comment

## Stage 2 — rebase done: ea29e1b (code), 436a4d5 (README), 3da7698 (seam fix: AS-47's NOTFOUND case counts Dashboard 2, follows / to 200). merge-tree clean vs 70bcb5b.
Resolved by hand: lib/views.js (both rows, contract-detail before dashboard/invoice-detail), routes/contracts.js (view BEFORE :id, both header paragraphs), README (lib/screens listing; AS-47's AS-48 hand-off marked discharged), 7 test files.
Literals recounted from master's numbers (never the plan table): routes 23->27, G1b 26, protected 21, G15 27; VIEWS 6; harness 20->21 (auto-merge unioned the list but kept 20 — the plan's certain conflict, hidden); source 56->61; expectFiles 7; P4 6; VIEW_START_TAGS 87+47+208+64+131+101=638 (contract-detail 58->64: nav anchor +2, NOTFOUND <p><a> +4); APP_CSS 227/180 (measure.mjs; = 184+43 / 143+37); P8 3; Y2 ['POST /contracts','GET /contracts/view','GET /contracts/:id']; TEMPLATE_LINKS 38 (predicted 37 first, measured 38 — contract-detail has 6 links not 5 because two anchors landed).
Deviation: contract-detail.ejs gets TWO anchors (nav + NOTFOUND Back to Dashboard), not §2's "one" — §1 and AS-47's README hand-off both name the Back-to-Dashboard line as AS-48's.

## Stage 2 PREDICTION before run 3 (asc-impl-as48-3): master 70bcb5b 461/443/0/18 + 24 = 485/467/0/18 test; contract 485/485/0/0.
prediction run 4: 485/467/0/18 test; contract 485/485/0/0
Run 3 (asc-impl-as48-3, Built): 485/466/1/18 — one red, AS-47's 'every href and form action in the two contract templates' cardinality literal 4 -> 6 (the two GET / anchors; message named them). Fixed as cf7e7ac.
Run 4 (asc-impl-as48-4 test, Built): 485/467/0/18 exit 0, down 0, leak clean. (asc-impl-as48-4c contract, Built): 485/485/0/0 exit 0, down 0, leak clean. Both = prediction.
Tip cf7e7ac; merge-tree clean vs 70bcb5b; tree clean; branch never pushed. AS-49 rebase still pending (harness +1 +1 helper, e2e AC-2 pin).

## Stage 3 — rebase onto post-AS-49 master 24ca575. harness V2 21->22 (list auto-unioned to 22, literal stuck at 21 — same silent merge). e2e-loop step 2: 303 /connect-stripe -> 200 + S3-EMPTY-FIRSTRUN once + href=/connect-stripe once. PREDICTION run 5: master 468/449/0/19 + 24 = 492/473/0/19 test; contract 492/492/0/0.
Run 5 (asc-impl-as48-5 test, Built): 492/473/0/19 exit 0, down 0, leak clean; (asc-impl-as48-5c contract, Built): 492/492/0/0. Both = prediction. Tip 113b749; merge-tree clean vs 24ca575. Ready for review.
