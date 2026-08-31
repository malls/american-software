# AS-43: D1 v1: invoice lifecycle (server) — customer mirror, draft, finalize, send

Chain link 4, "issues an invoice on that client, on the freelancer's own account" — server side. Create-or-reuse the Stripe customer (cus_) on the connected account, create invoice items and the invoice (collection_method=send_invoice, days_until_due), finalize it, send it, and persist the mirror record (status, hosted_invoice_url, invoice_pdf).

IMPLEMENTS: docs/engineering/00-d1-v1-milestone-plan.md section 3 rows C-26 (Stripe customer mirror), C-27 (invoice draft) and C-28 (finalize and send). All IN under Rule 1.

DECISION CONTEXT. Every call carries Stripe-Account: acct_... and goes through the custody-guard wrapper. This is the exact sequence the D1 spike validated against stripe-mock (docs/strategy/spikes/spike-D1-freelancer-invoicing.md section 1): /v1/customers then /v1/invoiceitems then /v1/invoices then /finalize then /send, all scoped to the connected account — so the charge lands on the freelancer's account and never on ours.

DO NOT PASS application_fee_amount. The board has not ruled on the app-fee reading of constraint 7 and subscription-only is the operative default (docs/strategy/08-board-decision.md section 3.2). The spike measured that reversing this is one parameter on this one call; that option is preserved by the wrapper's existence, not by writing the path.

Sending is Stripe's job: POST /v1/invoices/:id/send makes STRIPE email the client, under the connected account's branding, on Stripe's sender infrastructure. That is why our own invoice email (row C-31) and our own invoice PDF (row C-30) are OUT under Rule 2 — and it is how the client learns about the invoice in a v1 that can send no email of its own. Finalize is gated on the connected account's readiness flag maintained by the Connect task: read the flag, do not re-derive it.

VERIFICATION: request shapes validated against stripe-mock; sequencing, the readiness gate, and mirror persistence unit-tested against fixture responses. Size note (milestone plan section 8.2 tripwire): projected around 550 lines including tests, just under the 600-line split threshold — kept as one task because it is one reviewable claim ("a draft invoice can be created, finalized and sent on the freelancer's own account"). NAMED RESIDUAL: real state transitions and the client-facing email are not observable against stripe-mock, which is stateless; the test-mode acceptance run confirms them.

NOT IN THIS TASK: any application-fee or take-rate parameter, ever (row C-42); webhook handling or status sync; the invoice screens; reminders or manual re-sends (rows C-39 and C-40, OUT — Rule 1, and Stripe's own reminder cadences ride on the connected account at zero cost to us, configured by the freelancer in their own Stripe Dashboard); multi-currency or VAT fields (row C-32).
