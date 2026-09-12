# F-ALLOW
scratch /tmp/as49-mut/F-ALLOW, project asc-impl-as49-mut-fallow
before: "reason: 'mutant'" = 0 (expected 0)
after: "reason: 'mutant'" = 1 (expected 1)

## diff
--- lib/stripe/custody.js (tip)
+++ lib/stripe/custody.js (F-ALLOW)
@@ -30,6 +30,7 @@
  *  money is theirs (spike §1: direct charges, Standard defaults).
  *  `{id}` matches exactly one segment of /[A-Za-z0-9_]+/. */
 export const ALLOWED_ENDPOINTS = Object.freeze([
+  { method: 'GET', path: '/v1/customers/{id}', scope: 'connected', reason: 'mutant' },
   { method: 'POST', path: '/v1/accounts', scope: 'platform', reason: 'create the freelancer\'s connected account; no account to act as yet; moves no money' },
   { method: 'POST', path: '/v1/account_links', scope: 'platform', reason: 'Stripe-hosted onboarding link; platform-created by Stripe\'s design' },
   { method: 'GET', path: '/v1/accounts/{id}', scope: 'platform', reason: 'onboarding status read (charges_enabled, details_submitted)' },


## test: exit 1; Image asc-impl-as49-mut-fallow-test Built; ℹ tests 458 ℹ pass 437 ℹ fail 2 ℹ skipped 19
red set (2):
  ✖ E0 (STRIPE DOUBLE): the double's endpoint table is exactly the custody allowlist
  ✖ custody: policy tables are the committed literals
messages:
  AssertionError [ERR_ASSERTION]: ALLOWED_ENDPOINTS has 10 rows, expected 9
  actual: 10,
  expected: 9,
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  actual: 10,
  expected: 9,
down exit 0
