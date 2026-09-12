# AS-49 progress — agent:developer-lena, tick watcher:79108 loop tick 9

## Rebase
- feat/AS-49-e2e-loop rebased onto master b091df5 — trivial (branch had no code commits; tip == master).
- harness.test.js on master lists 19 files (plan said 17 -> 18; AS-46 added invoice-screen.test.js + route-surface.test.js). Mine: 19 -> 20.

## Prediction (written BEFORE any counted run)
- master baseline (from the AS-46 merge commit): test 451/433/0/18, contract 451/451/0/0.
- after AS-49 (+6 cases E0-E5, E5 skips offline): test 457/438/0/19, contract 457/457/0/0.

## Observed (all --build, absolute docker path, project torn down after)
- master re-measured (main checkout, asc-impl-as49-master): test 451/433/0/18 'Image asc-impl-as49-master-test Built'.
- branch a3619a8 (asc-impl-as49-lena): test 458/439/0/19 'Image asc-impl-as49-lena-test Built'; contract 458/458/0/0 'Image asc-impl-as49-lena-contract Built'.
- +7 not +6: `node --test` with no args uses Node's default `**/test/**/*.js` pattern, so test/helpers/stripe-double.js is loaded as a zero-case passing "test" (master already carries auth.js/routes.js/server.js the same way). Case-list diff between the two logs: exactly E0..E5 + `test/helpers/stripe-double.js`.
- E5 diagnostic: stripe-mock invoice fixture 75 keys, account 20, customer 22 (committed in the assertion message).

## Deviations from the plan
- AC-2: `GET /` with the cookie is 303 -> /connect-stripe on master (routes/pages.js interim, AS-48 replaces), not 200. Pinned the route-table fact; without-cookie is 303 -> /signin(?next=...).
- AC-7: client name occurs 2x in renderedHtml because the demo's fixed projectDescription contains "Northwind Studio"; asserted as "once outside the description" (+ the description itself once).
- Double exposes `createAccount()` (a model action) so E2-E5 can seed a connected-account row naming an acct_ the double knows; `failNth` + `failNext` alias; `stats.replayHits`; `handled` (endpoint keys) and `ALLOWLIST_KEYS` for E0.
- AC-20 grep `(STRIPE DOUBLE` = 8 in the e2e file (6 titles + 2 header-comment mentions); `^test('E[0-5] (STRIPE DOUBLE` = 6.

## Mutants (scratch copy /tmp/as49-mut via git archive; e2e file only, --build; worktree diff --exit-code clean after)
- F-NET (double: POST /v1/customers -> fetchTransport; applied 1 site): RED test: E1 step 9, E2, E3, E4 all `502 StripeTransportError: create-customer`; contract: same four + E5 (`getaddrinfo EAI_AGAIN api.stripe.com`). Wider than predicted by E3 (its seeded-open invoice comes from a real finalize). Offline-ness proven in both services.
- F-REPLAY (double: replays.set removed; 0 remaining): RED E2 only — second finalize `409 AmountMismatchError: reconcile`. Exactly as predicted.
- NOT RUN (box): F1-F12, F10b, F-ALLOW, F-SHAPE, F-V2 (harness was changed before the first run so its natural red was not observed).

## Status
- [x] stripe-double.js (d8a3ed5)
- [x] e2e-loop.test.js + harness 20 (e74c3ca)
- [x] README §5 (1c02022)
- [x] E5 measured count (a3619a8)
- [x] receipts (above)
- [~] mutants: 2 of 16 observed

# Loop tick 10 — remaining battery (Opus, Fable fallback)
Driver: mutate.mjs — fresh `git archive a3619a8` per mutant to /tmp/as49-mut/<id>, site-anchored
before/after counts, FULL `test` service (--build), per-mutant log in mutants/. Worktree untouched.
F10b anchor: plan said 5 SECRET sites, actual 6 (E0..E5) — driver asserts 6 -> 5.

## Predicted red sets (written BEFORE any run; plan §7)
- F1  E1 step 1; auth.test.js sign-up cases (record).
- F2  E1 step 3; connect.test.js R1/R10 family; E4 GREEN (narrowness).
- F3  E1 step 5 + E4; webhooks.test.js account.updated.
- F4  E1 step 7; contracts.test.js client-name cases.
- F5  E1 step 8; invoices.test.js R2.
- F6  E1 step 9 + E2 + E4; invoices.test.js finalize R-cases.
- F7  E1 step 10; invoices.test.js send R-cases.
- F8  E1 step 11 + E3; webhooks.test.js paid W-case + G2.
- F9  E1 step 11b; webhooks.test.js duplicate cases.
- F10 E3; webhooks.test.js S-cases.
- F10b E1 step 5 (400) only.
- F11 E1 step 9 (500 custody) + E2 + E4; invoices.test.js R-cases.
- F12 E1 step 12; repositories/webhooks stale cases.
- F-ALLOW E0; stripe-client.test.js allowlist-count case.
- F-SHAPE E5 in contract only; test service green.
- F-V2 harness V2 (19 != 20) only.

## Observed (full `test` service, --build, Built line present on every run, project torn down)
- F1  458/422/17: E1 step 1 (401 vs 303) + auth.test.js 16 (A19, H1,H1b,H2..H7,H9,H12-15, 2 landing cases, S1-ERROR x2, markup-as-text). Wider than "sign-up cases" only in that every auth case signs up to seed — the same cause.
- F2  458/436/3: E1 step 3 (connect start: 404 — updateReadiness on a row that was never created) + connect R3, R12. E4 GREEN as predicted (narrowness holds).
- F3  458/436/3: E1 step 5 (row ready after the push) + E4 (after readiness: 403) + webhooks W9. Exactly as predicted.
- F4  458/434/5: E1 step 7 (client name once outside description) + contracts N1, N5, P1, P8. As predicted.
- F5  458/437/2: E1 step 8 (Location not /edit) + invoices R2. Exactly as predicted.
- F6  458/425/14: E1 step 9 (409 reconcile) + E2 + E4 + E3 (WIDER by E3: its seeded-open invoice comes from a real finalize — same dependence F-NET showed; same cause, not a guard defect) + invoices R6,R9,R10,R11,R12,R13,R15,R22,R25 + invoice-screen send-from-edit.
- F7  458/432/7: E1 step 10 (exactly one call) + invoices R11,R14,R15,R22 + webhooks W17 + invoice-screen send-from-edit. As predicted.
- F8  458/433/6: E1 step 11 (body) + E3 + webhooks W6,W8,W13,G2 (G2: 8 handled types expected, 7 listed). As predicted.
- F9  458/435/4: E1 step 11b (body not duplicate) + webhooks W5,W6,W13. As predicted.
- F10 458/433/6: E3 (tampered: 200 ok: applied) + webhooks S3,S4,S10b,W3,W4b. As predicted.
- F10b 458/438/1: E1 step 5 only (400 SignatureError: verify-signature). Exactly as predicted — the double's signature is load-bearing.
- F11 458/425/14: E1 step 9 (500 StripeCustodyError: create-invoice) + E2 + E4 + E3 (WIDER by E3, same real-finalize dependence as F6) + invoices R6,R9,R10,R11,R12,R13,R15,R22,R25 + invoice-screen send-from-edit. Same set as F6 — both kill finalize.
- F12 458/434/5: E1 step 12 (body not stale) + repositories I13,I14 + webhooks W6,G3. As predicted.
- F-ALLOW 458/437/2: E0 (ALLOWED_ENDPOINTS has 10 rows, expected 9 — the cardinality line) + stripe-client "custody: policy tables are the committed literals". As predicted.
- F-SHAPE test 458/439/0/19 GREEN (as predicted: offline half cannot see it); contract 458/457/1/0: E5 only ("invoice (draft): the double emits keys the mock's fixture lacks — invented_key"). Exactly as predicted.
- F-V2 458/438/1: harness V2 only ("expected exactly 19 test files, found 20"). The natural first red, observed.

## Battery result: 16 of 16 observed red (F-NET, F-REPLAY last tick; 14 this tick). Zero survivors.
- Wider than predicted: F6 and F11 each add E3 (E3 seeds its open invoice through a real finalize; any finalize-killing mutant takes it — same dependence F-NET showed). Not a guard defect; no test change.
- Plan-text miscount: F10b anchor — 6 createStripeDouble(SECRET) sites (E0..E5), not 5.
- No test commits this tick; no app-source change (task rule). Tip stays a3619a8.
- Closing receipt on the untouched worktree: test 458/439/0/19 'Image asc-impl-as49-lena10-test Built', torn down; git diff --exit-code clean.
- /tmp/as49-mut removed; no asc-impl-as49-* images or projects remain.
- [x] mutants: 16 of 16. READY FOR REVIEW.
