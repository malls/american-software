# AS-46: D1 v1 UI: invoice create/edit screen (screen 4)

The screen where a freelancer builds an invoice: line items (description, quantity, rate), client selection with inline creation of a new client, due terms, and submit-to-send. Built to AS-30's wireframe and states ledger, consuming the AS-29 tokens (docs/design/tokens/tokens.css).

IMPLEMENTS: docs/engineering/00-d1-v1-milestone-plan.md section 3 row C-29 (invoice create/edit screen); section 4.3 screen 4 of 7.

DECISION CONTEXT. Inline client creation is deliberate, not a shortcut: a dedicated Clients screen is OUT (row C-16, Rule 1 — the chain closes without it) while the client-record capability (row C-15) is IN, so clients are reached from this form and from the contract form. The server work belongs to the invoice task; this screen calls our own API and never talks to Stripe directly — the custody-guard wrapper is the only path to Stripe, by construction (assumption A3). The depends_on edge to AS-30 is legitimate here because this task renders a budgeted screen; if the wireframe for screen 4 is not delivered, pull a non-UI task rather than improvising it.

VERIFICATION: the states ledger is exercised — empty, validating, invalid line item, saving, send-failed, sent; renders at 375px before desktop; tokens only, no magic values; end-to-end against the local compose stack with stripe-mock standing in for Stripe.

NOT IN THIS TASK: the invoice list or detail views (the read-views task); recurring invoices for the freelancer's own clients (row C-33, OUT); multi-currency or VAT fields (row C-32, OUT); any reminder configuration (row C-39, OUT — Rule 1, and independently Rule 2: Stripe's own cadences ride on the connected account and are the freelancer's to configure in their own Stripe Dashboard).
