# AS-130 review battery — cycle 2 — qa-ruben, 2026-09-12 (tick watcher:12263 loop 4 tick 1, on Opus after a Fable 429)

Branch feat/AS-130-demo-recapture, tip d4cd9a5 (cycle 1 reviewed 0188fd7; delta 0188fd7..d4cd9a5 = SKILL.md +14/-2, demo/README.md +2/-2 — no code, no record files). Base 1dd16a7; master 5d604ab. Read order: dossier, PHILOSOPHY, CLAUDE.md, plan incl. Review Cycle 1 (cold), delta, full diff; Lena's rework comment and the board's live-session note read only after findings (no divergence; no daemon review_state exists for this task).

## Verdict: PASS. 0 defects, 2 residuals (R2, R3), 1 note (N1). No inline fixes applied (both residuals live under `.claude/`, refused for this actor; no workaround attempted).

## Cycle-1 closure (measured, not read)

| finding | status | evidence |
|---|---|---|
| F1 step 2 | closed | `f1-step2.mjs` (tag c2, tag merged): SKILL's exact run line (`Image asc-capture-c2-demo Built`, healthz 200) → OLD `down -v` exit 0, **2 containers + 2 networks remain, "still in use"** (red 2×: c2, merged) → NEW `--profile tools -p … down -v --remove-orphans` exit 0, **0 containers / 0 networks / 0 volumes** (4×: c2 A, c2 B pristine, merged A, merged B pristine); 8349 refuses after; SKILL's check line empty |
| F1 step 1 | closed | `demo-twice.mjs` → `step1.txt`: after two `run --rm --build demo` the mock + its network remain; bare `down` exit 0 leaves them (red 1×); `--profile tools down` exit 0 leaves nothing (1×) |
| F2 | closed | plan §1/§2/AC-1/Q1 read 34 |
| O1 | closed | demo/README.md names the 8350 ledger (9df8ee5) |
| R1 (demo/README.md 7) | closed | 9df8ee5; apps/invoicing/README.md lines 18/25/123 still stale on master after AS-57's edit — stays on the record |

## At the tip d4cd9a5

- Re-capture (`recapture-c2/`): 34 PNGs, **34/34 byte-identical** to committed; capture.json (file,state,width,height,layer,media,url/UUID) identical; bytes equal per entry; branchCommit committed=958be42 (the capture commit; nothing PNG-affecting changed since).
- AC-13 env: `docker inspect` Env = ASC_STRIPE_MOCK_URL, PATH, NODE_VERSION, YARN_VERSION, NODE_ENV — 0 `INVOICING_STRIPE_*`; networks `_default` + `_stripe-mock`; `.env.local`/`--env-file` absent from SKILL.md + demo/README.md; Chrome profiles unchanged (only the pre-existing `asc-demo-chrome-i5vyAj`, AS-90's, not mine).
- AC-6: demo 2× (`Image asc-c2-step1-demo Built`, exit 0, 171 lines) normalised byte-identical to each other and to committed transcript.txt; `not built|404s` 0 (master 7); step-2 body line `text/html, 1649 bytes, page state S3-EMPTY-FIRSTRUN`.
- AC-7: `Image asc-c2-branch-test Built` 524/505/0/19; `Image asc-c2-branch-contract Built` 524/524/0/0; surface diff `master...branch` empty.
- AC-9 (`ac9-mutation.mjs`, in place, backup in /tmp, restore on exit): mutation asserted (`+ ports: - "127.0.0.1:8349:8348"`); `Image asc-c2-m9-test Built` **524/504/1/19**, red set = {deploy-shape: the demo service is the contract service with a different command… — `the demo publishes nothing to the host`}; restored, `git diff --exit-code` clean; rebuilt `Built` 524/505/0/19.
- AC-1/2/3 + probes (`build-falsifiers.txt`): 13 mutants+controls, 13 as predicted (digest mismatch ×3 incl. F3 mutant with master's build.mjs as the survivor "before"; missing/empty screenshot; does not record ×3; two lists disagree; names no merge commit). `ac1-cmp.mjs`: build `digest ok`, `13 headers, 13 labels`, `34 of 34`, 7 screens; fresh build == committed index.html (branch and merged).
- AC-8: 36 changed run.mjs lines, 0 forbidden-pattern hits. AC-11: 7 merge commits, 34 complete entries, layer on the two S3-EMPTY-FIRSTRUN, media on the print PNG. AC-12: 0 of 34 URLs off base.
- AC-10 (`ac10.txt`, in the image, `--no-deps`): api.stripe.com exit 2; unset exit 2; empty string exit 2.
- AC-4/AC-5: capture.mjs byte-identical to cycle 1 (delta touches no code); cycle-1 reds stand (`../live-ac4.txt`, `../live-ac5a.txt`, `../live-ac5b.txt`).

## Seam probe (M6) — master moved since the base

`seam.txt`: 39 non-.lattice files changed on master since 1dd16a7, incl. AS-128 (`lib/screens/{contract,invoice}-form-view.js`, `routes/{contracts,invoices}.js` — screens 4 and 6, which this branch photographs; the plan said AS-128 was not in flight) and AS-57 (Dockerfile now `COPY apps/invoicing ./`; dependency-policy scans every shipped file, `demo/serve.mjs` is new to it). File overlap with the branch: 0; `merge-tree --write-tree`: clean. Materialised the merged tree (234e4f2) in /tmp and ran it as it would ship:
- `Image asc-c2-merged-test Built` **532/513/0/19**; `Image asc-c2-merged-contract Built` **532/532/0/0** — equal to master today (`asc-c2-master-*` Built, 532/513/0/19, 532/532/0/0). serve.mjs classified by the whole-directory scan.
- serve + capture on the merged tree: **34/34 byte-identical** to the committed PNGs (AS-128 only touches the `add-client` intent path, which the walk never takes).
- demo on the merged tree (`Image asc-c2-mergeddemo-demo Built`): normalised == committed transcript; `not built|404s` 0. build.mjs on the merged root: `34 of 34`, cmp identical.
- F1 lines re-measured on the merged tree: identical outcome (old red, new clean 2×).
The committed record is not stale against today's master.

## Findings outside the list

- **R2 (residual, convention-class, non-blocking; pre-existing on master).** SKILL step 1's line, demo/README.md line 7 and apps/invoicing/README.md § Demo carry no `-p`; compose.yaml pins `name: asc-invoicing`, so run verbatim from *any* checkout they act on the `asc-invoicing` project — which on this host holds `asc-invoicing-web-1` (config file `.worktrees/AS-50/…`, AS-50's lane) and `asc-invoicing-stripe-mock-1` (`.worktrees/AS-90/…`, the F1 fossil). Master's bare `down` already removed `web`; the rework adds no new reach. Lena's rework comment saw the same and did not run the literal line. Proposed wording (step 1): `DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 docker compose -p asc-demo-<n> run --rm --build demo > /tmp/demo.out; docker compose --profile tools -p asc-demo-<n> down` and check `docker ps -a --filter name=asc-demo-<n>`. Merge-tick note: run step 1 under `-p` while AS-50's web is up.
- **R3 (residual, non-blocking, in diff).** build.mjs:260 → committed index.html "How this was made": `Transcript: cd apps/invoicing && … docker compose run --rm --build demo && docker compose down` — the rework's line is `docker compose --profile tools down`. One prose edit + rebuild + re-commit of index.html; the file is under `.claude/`, refused for this actor.
- **N1 (note, not a finding).** AC-7's "counts equal to master's same-day counts": branch 524 vs master 532 today, because master gained 8 tests (AS-128, AS-57) after the base. The branch's own surface diff is empty and the merged tree runs at 532.

## Cardinality

Counted compose runs with `--build`: 16, receipts 16 (c2 demo ×2, step1 demo ×2, branch test/contract, master test/contract, merged test/contract, merged demo ×2, mergeddemo ×1, m9 mutated/restored, ac10). Teardown measurements: old lines red 3/3, new lines clean 6/6. Build mutants 13/13. Criteria 13/13. Findings outside the list: 2 residuals + 1 note, 0 defects.

## Docker hygiene

`sweep.mjs`: 0 containers/networks/volumes/images of mine left; host containers 19 → 19, all pre-existing lanes (asc-invoicing-web-1, asc-invoicing-stripe-mock-1, asc-as47-visual, asc-impl-as69, asc-chat) untouched; `/tmp/as130-c2-merged` removed; `/tmp/asc-demo-chrome-i5vyAj` predates this review (AS-90), left alone. The `merge-tree --write-tree` left one unreferenced tree object in the object store (no ref, no commit). Worktree and main checkout: `git status` clean apart from scratchpads.
