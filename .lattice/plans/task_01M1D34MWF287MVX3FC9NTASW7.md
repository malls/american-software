# AS-37: D1 v1: apps/invoicing scaffold — compose stack, config, test harness, health check

Spine task 2 of D1 v1. Create apps/invoicing/ — the product application — in the stack chosen by the stack-decision task: docker compose service(s), configuration loading, a test harness, and a health endpoint. The acceptance property that matters: docker compose up starts the app and the full test suite passes with NO external services, NO accounts, and NO network egress. Everything after this depends on that property continuing to hold.

IMPLEMENTS: docs/engineering/00-d1-v1-milestone-plan.md section 3 row C-02 (IN — Rule 1: nothing in the chain runs without it). Section 8.3 spine task 2.

DECISION CONTEXT. The directory name apps/invoicing/ is decided, not a placeholder. Under the company-name record docs/strategy/09-company-name.md section 8.2, the monorepo/internal-infra layer carries generic descriptive names and the product brand attaches at the extraction seam and on customer-facing surfaces (deploy domains, sender domains, app chrome). The product has no name yet and this directory never needs to change when it gets one — which is also why naming does not block the scaffold. Follow apps/chat/ for compose and test-runner conventions unless the stack decision chose otherwise; note that the chat app is internal tooling and its zero-dependency convention is evidence, not a mandate, for the product.

VERIFICATION: docker compose up serves the health endpoint; the test suite runs green from a clean checkout with the network unavailable. Both are runnable today with no accounts.

NOT IN THIS TASK: the data model or any table (the data-model task); any Stripe code whatsoever — the custody guard lands before any Stripe caller and this task must not front-run it with a "temporary" client; authentication; any UI screen (screens are wireframe-gated on AS-30).
