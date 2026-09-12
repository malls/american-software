# AS-90 progress (developer-lena)

Worktree: .worktrees/AS-90, branch feat/AS-90-d1-demo. Plan: .lattice/plans/task_01M1YB78T82XQM2P3P41G7T2J3.md

## Plan corrections found in the reading pass (boring choices, recorded)
- POST /clients: `next` is REQUIRED (routes/clients.js: ValidationError when absent). Demo passes `next=/`; Location is `/?clientId=<id>`.
- POST /invoices: `daysUntilDue` is REQUIRED (CREATE_FIELDS, integerField). Demo passes 30.
- account.updated answers `ok: readiness` (receiver OUTCOMES), not `ok: applied`. Demo prints what it gets; precondition is status 200 only.
- Refusal at load (no ASC_STRIPE_MOCK_URL / stripe.com host) exits 2; a chain STOP exits 1.

## More corrections
- stripe-mock 401s `sk_test_demo_placeholder` (second underscore). Using `sk_test_demoplaceholder`.
- Cookie name is `invoicing_session` (COOKIE_NAME imported from lib/auth/session.js).
- Step 10 (send) makes 3 mock calls (invoiceitems, finalize, send) because the resumable pipeline sees status still `draft` (mock never advances). Epilogue: 10 requests, 8 distinct paths (plan predicted 8 calls). Transcript says so in words.
- App ids are UUIDs not ULIDs: normaliser needs a UUID rule (compare.mjs has it).
- compose v5 prints build progress on STDOUT before the container output; transcript.txt = stdout from the title line on (compose.mjs cuts at the marker).

## Done
- [x] demo/run.mjs (commits 0aee66f, 4990d9d)
- [x] demo/README.md
- [x] compose.yaml demo service + Dockerfile COPY
- [x] deploy-shape pins + demo-service case
- [x] dependency-policy SKIPPED_DIRS + demo/ import guard
- [x] README ## Demo
- [x] suites on branch: test 406/388/0/18 Built; contract 406/406/0/0 Built (branch-test.log, branch-contract.log)
- [x] demo x2 exit 0 Built (demo-run1/2.transcript.txt): normalised identical, 29/170 raw lines differ (ids/ts/sig/port only); labels 13, headers 13
- [x] reds AC-1/2/3/8/9 (mutant-*.log, falsify-build.mjs, falsify-capture.mjs) — all red; AC-9a red set is 2 cases (parsers case + new demo-service case), AC-5(b) `/` survived first (redirect lands on a real state) → capture.mjs now refuses a redirect; re-run red
- [x] capture.mjs + screenshots (docs/demo/d1, Chrome/152.0.7977.83, CDP path, no fallback) — against one-off branch web on 8349 because master's web holds 8348
- [x] build.mjs + SKILL.md; index.html committed (Artifact tool not reachable — Q2 default). Skill files STAGED at docs/demo/d1-demo-artifact-skill/ because .claude/ is permission-sensitive for me; orchestrator does `git mv`
- [x] final receipts: test 406/388/0/18 Built, contract 406/406/0/0 Built (final-*.log); project asc-inv-as90 torn down incl. one-off web/volume/network
- [ ] Lattice comment + #engineering post
- leftover to remove by hand (outside my allowed paths): /tmp/asc-demo-chrome-ephAwb (Chrome profile from the first capture run I had to stop)

## Next
(update as you go)
