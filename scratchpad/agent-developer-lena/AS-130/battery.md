# AS-130 proof battery — developer-lena, 2026-09-12 (tick watcher:79108 loop 2 tick 3)

Branch feat/AS-130-demo-recapture, tip 0188fd7 (captures taken at 958be42). Compose project asc-impl-as130 (+ asc-impl-as130-master for the baseline), both torn down with `down -v --rmi local --remove-orphans` (`--profile tools` needed for the stripe-mock container — teardown.log).

## Receipts
- Transcript runs (demo service): transcript-run-{1,2,3}.log — each `Image asc-impl-as130-demo Built`, exit 0. transcript.txt = run 2's stdout cut at the banner (171 lines); run 2 vs run 3 normalised (UUID, mock ids, ISO, signature, port, epoch): 0 differing lines (cut-and-compare.mjs).
- Serve container: serve-run.log (`Image asc-impl-as130-demo Built`), `docker port`: 8348->127.0.0.1:8349, 8350->127.0.0.1:8350.
- Capture: capture-run-1.log — 34 PNGs, capture.json, Chrome/152.0.7977.83.
- Suites (branch): suite-test.log 524/505/0/19 `Image asc-impl-as130-test Built`; suite-contract.log 524/524/0/0 `Image asc-impl-as130-contract Built`. Master same day (29c38c7): master-test.log 524/505/0/19 `Image asc-impl-as130-master-test Built`.
- AC-13: ac13-inspect.log — Env = ASC_STRIPE_MOCK_URL + image defaults only; no INVOICING_STRIPE_*; networks asc-impl-as130_default + asc-impl-as130_stripe-mock.

## Falsifiers (all observed red)
| AC | mutant | red |
|---|---|---|
| 1 | scratch transcript, one word of the block changed | `digest mismatch` exit 1 (build-falsifiers.log) |
| 2 | scratch transcript, bullet appended after the block's last line | new build.mjs: `digest mismatch`; **master build.mjs on master transcript: survivor, exit 0, "16 lines, 8 bullets, digest ok"** (the F3 before) |
| 3a | scratch copy, one PNG removed | `missing screenshot …screen-5-default-paid-1280.png` |
| 3b | scratch capture.json, one state renamed | `does not record screen-5-default-paid-375.png as S5-DEFAULT-PAID at 375px` |
| extra | scratch capture.json, layer renamed | `does not record … with layer S3-GATED-STRIPENOTREADY` |
| control | untouched record | green; out.html byte-identical to committed index.html |
| 4 | scratch capture.mjs: `Network.clearBrowserCookies` before #13 | `landed on /signin?next=%2Fcontracts%2F<id>, expected /contracts/<id> … refusing`, exit 1, 18 files (none for #13), no capture.json (capture-falsifiers.log) |
| 5a | scratch capture.mjs: #8 expects S4-DEFAULT-CREATE | `in state "S4-GATED-STRIPENOTREADY", expected S4-DEFAULT-CREATE`, exit 1, 9 files |
| 5b | scratch capture.mjs: #6 dom predicate inverted | `does not show what S3-GATED-STRIPENOTREADY implies (DOM predicate false …)`, exit 1, 5 files |
| 6 | `grep -c -E 'not built|404s'` | branch transcript 0; master transcript 7 |
| 9 | in place: `ports: ["127.0.0.1:8349:8348"]` on demo, backed up (compose.yaml.backup), asserted at the demo site | red set = exactly 1: `deploy-shape: the demo service is the contract service with a different command, and web is still not on the mock network` — `AssertionError: the demo publishes nothing to the host` (524/504/1/19, `Image asc-impl-as130-test Built`); restored; `git diff --exit-code` 0; rebuilt green above |
| 10 | `ASC_STRIPE_MOCK_URL=https://api.stripe.com` / `=''` via compose run --no-deps | exit 2 both, before listening (ac10-*.log) |
| 8 | run.mjs changed lines vs the forbidden regex | 31 changed lines, 0 hits (run-mjs.diff) |
| 7 | `git diff master --stat` on test/lib/routes/views/public/compose.yaml/Dockerfile/package*.json | empty |
| 11/12 | capture.json | screenMergeCommits 7, branchCommit 958be42, target, chrome, 34 captures with all core fields, 2 with layer, 1 with media, 0 urls off base |
