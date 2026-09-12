# AS-50 implementation progress (developer-marcus)

Started 2026-09-12. Worktree .worktrees/AS-50, branch feat/AS-50-stripe-acceptance-run.

- [x] read plan, demo/run.mjs, compose, routes, e2e-loop E1, stripe-double
- [x] driver skeleton committed — 2f612aa
- [x] dependency-policy (SKIPPED_DIRS + guard) + .gitignore + READMEs — 2f612aa, 663915a
- [x] phase 1 run for real — STOPPED at connect start (502; Stripe refuses bare POST /v1/accounts: "enable Accounts v1 support", feat_accounts_v1_support). phase1 output in this file's sibling notes; contingency.json in state/
- [x] compose --build receipt — suite-green2.log: Image asc-invoicing-test Built, 524/505/0/19
- [x] reds — reds-ac10-ac11.txt (AC-10 CliRefusal, AC-11 RedactionError); suite-ac12-mutant4.log (guard red at routes/pages.js, 524/504/1). mutant1 = non-resolving path -> ERR_MODULE_NOT_FOUND x20 (not the guard); mutant2 = my .as50bak inside routes/ tripped the closed-world check (lesson: back up outside the app dir); mutant3 = bare import SURVIVED the original regex -> hardened in 663915a
- [x] gate-a.md (this tick's board text = the AS-134 ask; the real gate-A text for later)
- [x] AS-134 filed (board ask, high), AS-50 depends_on AS-134 — board state uncommitted on master (orchestrator commits)
- [x] lattice comment (362 words — over cap, flagged) + #engineering msg 1086

## Live processes (2026-09-12 ~18:10Z)
- relay pid 44358 on 127.0.0.1:8352 (state/relay.out)
- stripe listen pid 44584, wrapper 44583, started 2026-09-12T17:59:51Z, auth env (state/helpers.json)
- first-generation listener 44363/44364 was orphaned by the stopped first run — SIGTERMed by hand; driver now persists helpers.json at start to prevent this
- asc-invoicing-web-1 up on 127.0.0.1:8348 with both secrets (compose project asc-invoicing); asc-invoicing-stripe-mock-1 is NOT mine (pre-existing)

## Resume from here
1. When AS-134 is done (toggle on): `node acceptance/run.mjs up` from apps/invoicing/ in the worktree — idempotent; replaces the listener generation, rebuilds web, signs up a NEW throwaway, expects 303 -> connect.stripe.com, writes state/run.json, prints gate A.
2. Then gate A text from gate-a.md (second section) with the credentials from state/run.json.
3. Phases 2 (`issue --client-email <e>`) and 3 (`verify`) are implemented but unexercised — expect fixes on first real run.
4. If Owen chooses Accounts v2 instead: onboarding.js + custody allowlist + double + stripe-mock contract all change — a separate task, not this branch.
