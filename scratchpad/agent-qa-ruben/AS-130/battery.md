# AS-130 review battery — qa-ruben, 2026-09-12 (tick watcher:79108 loop 2 tick 4)

Branch feat/AS-130-demo-recapture, tip 0188fd7, base 1dd16a7; master d39c384 (5 board-only commits since base, no non-.lattice diff — seam clean). Read order: dossier, PHILOSOPHY, plan (cold), diff (cold), then the battery; the implementer's Lattice comment and the daemon output were not read before findings.

## Findings

- **F1 (defect, blocking)** — SKILL.md step 2's teardown `docker compose -p asc-capture-<n> -f … -f … down -v` exits 0 and leaves the serve one-off and stripe-mock running with 8349/8350 held (Compose v5.3.0; `demo`/`stripe-mock` are `profiles: ["tools"]`). Measured 5× bare (2 containers + 2 networks remain, "Network … Resource is still in use"); `--profile tools` alone removes the mock but not the `--name`d one-off (1×); `--profile tools … down -v --remove-orphans` clears everything (6×). Against AC-13 "scratch compose project torn down (`down -v`)". Same mechanism afflicts step 1's `docker compose down` (pre-existing on master; three stale stripe-mock containers from AS-90/AS-69/AS-49 projects on this host are the evidence). Fix: one line (see plan Review Cycle 1). Inline fix attempted; the permission system refuses edits under `.claude/` for this actor, so it goes to rework.
- **F2 (plan record, non-blocking)** — plan AC-1 says `36 of 36` and §1 says 36 PNGs; the §2 table sums to 34 (5 + 2×13 + 1 + 1 + 1), the branch has 34 tracked PNGs, capture.json records 34, build prints `34 of 34`. The table is the specification; the number is the planner's arithmetic. Plan text to correct, not the implementation.
- **O1 (observation, non-blocking)** — serve.mjs adds a read-only ledger listener on 8350 (`GET /stripe-requests`) not named in plan §3; it is how the capture learns the mock-minted `acct_`/`in_` ids to sign the two events (the plan says the events are signed host-side but never says where the ids come from). app.js untouched; loopback-published only. Plan §3 should record it.
- **R1 (residual, out of diff)** — apps/invoicing/README.md lines 18/24–25/123 and demo/README.md line 7 document `… && docker compose down` and say "the trailing `down` stops the mock that `depends_on` started"; on this host it does not (F1 mechanism). Orchestrator routes.

## Floor check (M5) — 13 criteria, 12 pass as written, AC-13 fails on its teardown clause, AC-1 passes on substance with the count corrected to 34

| AC | observed |
|---|---|
| 1 | build: `digest ok`, `13 headers, 13 labels`, `34 of 34`, 7 screens; `cmp` fresh vs committed index.html IDENTICAL. Red: one word changed → `digest mismatch` (exit 1) |
| 2 | Red: bullet appended after block, branch build.mjs → `digest mismatch`; before: master build.mjs + master record accepts the same mutant (exit 0, `5 of 5`) — F3 survivor recorded |
| 3 | Red: PNG removed → `missing screenshot`; state renamed → `does not record … as S2-RETURN-READY at 375px` |
| 4 | Red: cookies cleared before #13 → `page landed on /signin?next=%2Fcontracts%2F… expected /contracts/… refusing`, exit 1, 18 earlier PNGs intact, 0 screen-7, no capture.json |
| 5 | Red: #8 expecting S4-DEFAULT-CREATE → `in state "S4-GATED-STRIPENOTREADY", expected S4-DEFAULT-CREATE`, 9 PNGs before; #6 dom inverted → `page does not show what S3-GATED-STRIPENOTREADY implies`, 5 PNGs before |
| 6 | two `run --rm --build demo` (both `Image asc-review-as130-demo Built`, exit 0, 171 lines) normalised byte-identical to each other and to the committed transcript; grep `not built\|404s` branch 0 / master 7; first/last lines as specified; step 2 body `text/html, 1649 bytes, page state S3-EMPTY-FIRSTRUN` |
| 7 | `Image asc-review-as130-test Built` 524/505/0/19; `Image asc-review-as130-contract Built` 524/524/0/0; surface diff --stat empty (test/lib/routes/views/public/compose.yaml/Dockerfile/package*/app.js/server.js) |
| 8 | run.mjs: 36 changed lines, 0 matching `FREELANCER\|CLIENT\|CONTRACT\|LINE_ITEM\|DAYS_UNTIL_DUE\|EVENT_\|call(\|expect\|label:\|n:` |
| 9 | in place, trap-restored: `ports:` on demo → `Image asc-review-as130-m9-test Built` 524/504/1/19, red set = {deploy-shape: the demo service is the contract service … — `the demo publishes nothing to the host`}; restore, `git diff --exit-code` clean, rebuild 524/505/0/19 |
| 10 | `https://api.stripe.com` → exit 2 "points at api.stripe.com"; unset → exit 2 "is not set"; probes: `checkout.stripe.com` exit 2, `not a url` exit 2, unreachable mock exit 1 after 10 s |
| 11 | capture.json: screenMergeCommits 7, branchCommit 958be42, target, chrome Chrome/152.0.7977.83, 34 captures each with file/state/width/height/url/bytes; layer on the two S3-EMPTY-FIRSTRUN, media on the print PNG; 0 bytes mismatches vs disk |
| 12 | 0 of 34 urls off `http://127.0.0.1:8349` |
| 13 | `docker inspect`: Env = ASC_STRIPE_MOCK_URL, PATH, NODE_VERSION, YARN_VERSION, NODE_ENV — 0 `INVOICING_*`; `.env.local`/`--env-file` absent from the record; `.env.local` exists only in the main checkout, not the worktree; 0 Chrome profiles leaked per run. **Teardown clause fails as written (F1).** |

## Probes past the list (M6)

- Full clean re-capture against a fresh serve: 34 PNGs, file/state/width/layer/media/URL set identical to committed, **34 of 34 byte-identical** to the committed PNGs; build.mjs on the re-captured record `34 of 34`.
- build.mjs extra mutants (all red as predicted): 35th capture entry → "two lists disagree"; layer dropped → does not record (layer); media dropped → does not record (media); merge commit for screen 6 removed → "names no merge commit"; blank line after block removed → digest mismatch; empty PNG → "empty screenshot". Controls: branch build on branch record green; master build on master record green.
- Visual: screen-3-default-populated-1280 (contract + Paid invoice, "New invoice" is a link) and screen-7-default-1280-print (nav stripped) match their captions.
- Mutants + controls total: build 13/13 predicted; capture 3/3; serve 5/5; compose 1/1 (+ restore green).

## Docker hygiene

All asc-review-as130* containers, networks, volumes, images removed. One `/tmp/asc-demo-chrome-i5vyAj` predates this review (born 04:08Z = AS-90's capture) — not mine, left alone.
