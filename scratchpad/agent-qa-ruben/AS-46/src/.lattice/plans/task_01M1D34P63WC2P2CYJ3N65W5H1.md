# AS-48: D1 v1 UI: read views, screens 3 and 5 (dashboard, invoice detail)

The two screens that close chain link 6, "freelancer sees it paid". Dashboard: the freelancer's invoices and contracts with status. Invoice detail: full status, amounts, due date, and the Stripe-hosted links (hosted_invoice_url, invoice_pdf) surfaced for the freelancer to open or copy. Built to AS-30's wireframes and states ledgers, consuming the AS-29 tokens.

IMPLEMENTS: docs/engineering/00-d1-v1-milestone-plan.md section 3 rows C-37 (dashboard / list) and C-38 (invoice detail and status); section 4.3 screens 3 and 5 of 7.

DECISION CONTEXT. Merged as one task with a written justification (milestone plan section 8.2): one reviewable claim — "the freelancer can see what they have sent and whether it is paid" — at around 450 projected lines. Status comes from the invoice mirror the webhook task syncs; these screens read our own records and never call Stripe live. The hosted links are SURFACED, NOT REBUILT: our own invoice PDF (row C-30) and our own payment page (row C-34) are OUT under Rule 2, because Stripe's are the product here and building parallel implementations is exactly what Rule 2 forbids — the spike measured our own invoice PDF renderer at 107 lines and 0.194 ms and still found it unnecessary.

VERIFICATION: states ledger exercised — no invoices yet, loading, populated, stale/unsynced, error; status transitions render correctly from fixture mirror records; renders at 375px before desktop; tokens only, no magic values.

NOT IN THIS TASK: invoice creation (the invoice-UI task); contract screens (the contract-UI task); reminder configuration or a manual re-send control (rows C-39 and C-40, OUT — Rule 1; Stripe's own reminder cadences ride on the connected account at zero cost to us and are configured by the freelancer in their own Stripe Dashboard); analytics or reporting (row C-56, OUT); an account-settings screen (row C-41, OUT).
