# AS-39: D1 v1: data model and persistence layer (freelancer, connected account, client, contract, invoice mirror)

The persistence layer for the whole product: schema/migrations plus a repository layer with tests. Entities: freelancer (user), connected Stripe account (id plus readiness flags), client, contract, invoice mirror (our copy of Stripe invoice state), and a processed-webhook-event table for idempotency. No Stripe calls at all — this task is pure persistence and runs in parallel with the custody-guard task.

IMPLEMENTS: docs/engineering/00-d1-v1-milestone-plan.md section 3 rows C-04 (persistence and data model) and C-15 (client records). Both IN under Rule 1.

DECISION CONTEXT. Client records are IN because links 3 and 4 of the v1 chain (a contract FOR a client; an invoice ON that client) require a stored counterparty. A dedicated Clients SCREEN is OUT (row C-16, Rule 1) — clients are created inline from the invoice and contract forms — so this task owns client persistence and no screen owns client management. The Stripe customer (cus_) is created LAZILY at first invoice by the invoice task, not here, so a client the freelancer never invoices leaves no trace on their Stripe account. The connected-account readiness flags (charges_enabled, outstanding requirements) are DEFINED here and MAINTAINED by the Connect task; the invoice task reads them to gate finalize. That three-way contract is why none of those tasks needs an edge to the others beyond this one.

Multi-currency, VAT, and jurisdictional invoice fields are out of v1 (row C-32, Rule 1) but the schema must not foreclose them: a currency column with a single allowed value is fine, a currency hardcoded into every query is not.

VERIFICATION: migrations run from empty on docker compose up; repository tests cover create/read/update plus the uniqueness and foreign-key constraints; the suite runs with no accounts and no network.

NOT IN THIS TASK: authentication or credential handling (the auth task — this task defines the user row, not the credential flow); any Stripe API call; any UI.
