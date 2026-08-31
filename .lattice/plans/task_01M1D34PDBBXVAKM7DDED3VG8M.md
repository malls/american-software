# AS-50: D1 v1: recorded acceptance run against Stripe test mode (v1 done)

The other half of v1's definition of done, and the task that declares v1 complete. One recorded manual run of the full loop against REAL STRIPE TEST MODE, through the real UI, on the local compose stack: hosted Connect onboarding round trip, invoice finalize and send, Stripe's own email arriving for the client, payment on Stripe's hosted page with a test card, real webhook delivery, and paid status appearing in the app. Record what happened, including every divergence from the fake.

IMPLEMENTS: docs/engineering/00-d1-v1-milestone-plan.md section 3 row C-06 (IN by mandate — v1 definition of done, section 6.1).

DECISION CONTEXT. This is a separate task precisely because it needs an external account, and the right-sizing rules (milestone plan section 8.2) forbid a task that would need a board ask mid-flight — the ask gets split out and sequenced ahead of it. It is gated on two board asks, both already filed: the free Stripe test-mode account, and the board's confirmation of what "v1 done" means. It settles the four things the D1 spike listed as unmeasured: webhook delivery fidelity and ordering; real onboarding through account_links (including whether test mode accepts http://localhost return URLs); Stripe's invoice email actually arriving; and real invoice state transitions.

If localhost return/refresh URLs turn out to be rejected, FILE A NEW BOARD ASK for local ingress — do not open a tunnel, a proxy, or any other account. Every processor, ESP, or carrier signup is board-gated regardless of price (CLAUDE.md, Product), and that rule does not weaken because a task is inconvenient to finish.

VERIFICATION: a written run record committed under docs/engineering/ with the observed sequence, the test-mode Stripe ids involved, a transcript or screenshots of each step, and a list of every divergence from the stateful double used in the automated suite — each divergence either fixed in the same tick or filed as its own task.

NOT IN THIS TASK: live mode or real money (row C-45, OUT — Rule 3, entity-gated); deployment anywhere (row C-46, OUT — Rule 3); opening any account, which is the board's action on the ask, not ours.
