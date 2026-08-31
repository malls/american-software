# AS-45: D1 v1 UI: onboarding screens 1-2 (auth, Connect Stripe)

The two screens that take a freelancer from signed-out to charge-ready, built to Jonah's wireframes and states ledgers from AS-30 and consuming the AS-29 tokens (docs/design/tokens/tokens.css). Screen 1: a single auth route with sign-up and sign-in modes. Screen 2: Connect Stripe — start onboarding, and show connection status with its full states ledger (not started, incomplete requirements, pending verification, enabled, expired link, error).

IMPLEMENTS: docs/engineering/00-d1-v1-milestone-plan.md section 3 rows C-08 (sign-up/sign-in screen) and C-12 (Connect Stripe screen); section 4.3 screens 1 and 2 of 7.

DECISION CONTEXT. Two screens are merged into one task with a written justification, which milestone plan section 8.2 permits: one reviewable claim ("a new freelancer can get from nothing to an account that can charge"), around 450 projected lines, under the split threshold. This task carries a depends_on edge to AS-30; per milestone plan section 8.1, ONLY screen-rendering tasks may. If AS-30 has not yet delivered these two screens' wireframes and states ledgers, do not improvise them — pull a non-UI task instead; the graph is built so one is always available (section 8.4).

Sign-up is deliberately email-free: no verification mail, no magic link, no password reset (row C-09, OUT — Rule 1, and independently Rule 3, since email needs an ESP account and a sender domain the unnamed product cannot have).

VERIFICATION: screens render sensibly at 375px before desktop widths (front-end design plan section 5.4, the lesson of AS-23); every visual property traces to a named token, no magic values (section 5.1); every state in the ledger is reachable in a test or at a documented URL; the flow works against the local compose stack with no accounts — Connect start is exercised against stripe-mock, and the real hosted round trip belongs to the acceptance run.

NOT IN THIS TASK: the server halves (auth and Connect tasks); an account-settings screen (row C-41, OUT — Rule 1: connection status lives on screen 2, and the freelancer's invoice branding lives in their own Stripe account, row C-14, Rule 2); password-reset or verification UI (row C-09); an onboarding checklist or guided tour (row C-55, OUT — Rule 1, with Rule 4 barring the "it builds trust" counter-argument).
