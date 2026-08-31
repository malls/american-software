# AS-49: D1 v1: automated end-to-end loop verification on local compose

The deterministic half of v1's definition of done. An automated test that drives the product's own HTTP API through the entire Rule-1 chain — sign up, connect an account, generate a contract, create and finalize and send an invoice, apply a paid webhook, observe paid status — on the local docker-compose stack, with NO external accounts.

IMPLEMENTS: docs/engineering/00-d1-v1-milestone-plan.md section 3 row C-05 (IN by mandate — v1 definition of done, section 6.1).

DECISION CONTEXT. This cannot run against stripe-mock alone. stripe-mock validates request and response SHAPES against Stripe's OpenAPI spec, but it is stateless and emits no webhooks (docs/strategy/spikes/spike-D1-freelancer-invoicing.md section 1). So this task extends the transport fake introduced by the custody-guard task into a STATEFUL Stripe double: it holds account, customer and invoice state, transitions invoices on finalize/send/pay, and emits correctly signed webhook payloads into the webhook receiver. Where shapes matter, keep validating against stripe-mock; where state matters, use the double. Name the two clearly in the tests, because the honest claim of this task is "our half of the loop is correct against OUR MODEL of Stripe" — and the fidelity of that model is exactly what the test-mode acceptance run exists to check. Overstating this task's guarantee is the failure mode to avoid.

VERIFICATION: the suite runs green from a clean checkout with the network unavailable, and turns red if any single step of the chain regresses.

NOT IN THIS TASK: anything requiring a real Stripe account (the acceptance-run task, which is board-gated); browser or UI automation — this drives the API deliberately, so that it stays runnable while the UI tasks are still gated on AS-30 and so a design stall cannot stall verification; performance or load testing (no capability row — v1 has one user).
