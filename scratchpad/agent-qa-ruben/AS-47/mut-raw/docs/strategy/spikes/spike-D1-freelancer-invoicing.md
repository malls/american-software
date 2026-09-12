# Spike 2 Findings — Candidate D1: Freelancer Invoicing/Contract Automation

**Author:** Marcus Webb (`agent:developer-marcus`), on assignment from the orchestrator.
**Date:** 2026-08-31 (one tick, timeboxed). **Budget:** $0 spent — no signups, no API
keys, no paid services, no external accounts created. Tools: stripe-mock 0.203.0
(Stripe's OSS local API simulator, MIT, installed via Homebrew) and Stripe's public
documentation, fetched 2026-08-31. Template-source licenses fetched from the
publishers' own pages.
**Scope:** the three spike-must-test items signed in 04-scores-cto.md §D1,
incorporated by 05-finalists.md §6, plus one throwaway build measurement. This memo
reports measurements; selection remains with the step-3 debate. Throwaway code and
raw outputs live in the session scratchpad only and are not committed, per the spike
rubric.
**Binding constraint under test:** 03-gate-verdicts.md constraint 7 — "we are never a
payee, never an aggregator of receipts, and never in the flow of funds … client
payments settle directly to the freelancer's own processor account."

---

## 1. Constraint-7 architecture validation

**Verdict: YES — a constraint-7-clean architecture exists, with named API
primitives, documented flow-of-funds evidence, and every step spec-validated
against stripe-mock.** The shape is Stripe Connect direct charges on a
Standard-equivalent connected account. The one caveat that matters: the same API
also contains the *forbidden* shape (platform-side invoices with
`transfer_data[destination]`), so the boundary is a design rule we enforce forever,
not one the API enforces for us — exactly the "permanent design-review obligation"
the C3 rationale priced.

### The flow, end to end (text diagram)

```
[us: platform account]                    [freelancer: their own Stripe account]   [client]
        |                                                   |                          |
        |-- POST /v1/accounts (Standard defaults) --------> acct_… created             |
        |-- POST /v1/account_links                          |                          |
        |     type=account_onboarding ---------------------> hosted onboarding:        |
        |     (Stripe collects KYC + bank; we never see it)  freelancer owns the        |
        |                                                    account & full Dashboard   |
        |                                                   |                          |
        |== thereafter, every call carries                  |                          |
        |   "Stripe-Account: acct_…" (direct charge scope) ==                          |
        |                                                   |                          |
        |-- POST /v1/customers  (the client) -------------> cus_… on THEIR account     |
        |-- POST /v1/invoiceitems ------------------------> ii_…  on THEIR account     |
        |-- POST /v1/invoices                               |                          |
        |     collection_method=send_invoice                |                          |
        |     days_until_due=30                             |                          |
        |     [application_fee_amount=N  — optional] -----> in_… draft                 |
        |-- POST /v1/invoices/:id/finalize ---------------> hosted_invoice_url,        |
        |                                                    invoice_pdf (Stripe's)    |
        |-- POST /v1/invoices/:id/send -------------------> Stripe emails the client --+--> pays on
        |                                                   |   Stripe-hosted page,    |   THEIR account
        |                                                   |   charge on THEIR acct   |
        |<= webhooks: invoice.created / finalized /         |                          |
        |   sent / paid  (+ account.updated)                |                          |
        |-- GET /v1/invoices/:id  (Stripe-Account: acct_…)  |  read-only status        |
        v                                                   v                          v
   we COMPUTE and READ                          client money settles HERE         never touches us
```

### Documentary evidence (fetched 2026-08-31, docs.stripe.com)

- Direct charges: "The payment appears as a charge on the connected account, not
  your platform's account. The connected account's balance increases with every
  charge. Your account balance increases with application fees from every charge."
- Flow of funds with fees: "the charge amount—less the Stripe fees and application
  fee—is deposited into the connected account."
- Liability: "When you use direct charges, the connected account is responsible for
  the cost of the Stripe fees, refunds, and chargebacks." (connect/invoices)
- Invoices on connected accounts: "To create an invoice that directly charges on a
  connected account, create an invoice while authenticated as the connected
  account" (the `Stripe-Account` header), customer defined on the connected
  account; `application_fee_amount` is explicitly supported on such invoices.
- Standard-equivalent controller properties (migrate-to-controller-properties):
  `losses.payments=stripe`, `fees.payer=account`, `requirement_collection=stripe`,
  `stripe_dashboard.type=full` — these are the **defaults** of a bare
  `POST /v1/accounts`. Stripe bears payment-loss liability, the freelancer pays
  Stripe's fees, Stripe collects KYC. Note for the record: Stripe's docs now steer
  new platforms to Accounts v2 / controller properties; legacy `type=standard` maps
  to identical semantics, so the architecture is unchanged either way.

### stripe-mock measurements (API-shape level)

All eight steps above executed against stripe-mock, which validates method, path,
and every parameter against Stripe's OpenAPI spec and rejects unknowns (verified: a
bogus parameter on invoice-create was refused with "additional properties are not
allowed"). Findings: every primitive named above exists with exactly these
parameters; `application_fee_amount` was accepted on a connected-account
(`Stripe-Account`-scoped) invoice create. Limitation, stated honestly: stripe-mock
is **stateless** — it returns spec fixtures, does not transition invoice state, and
emits no webhooks. Webhook fidelity, onboarding conversion friction, and state
timing are **not measured**; exercising them requires a Stripe account in test
mode, which is a signup — **requires board-approved account creation** (free, but
gated by spike rules and PHILOSOPHY.md approval discipline).

### The application-fee question, answered precisely

The task was to check whether app-fee-on-invoice is compatible with
never-touching-funds. Mechanically: the client pays the connected account; Stripe
deducts the application fee on the connected account and transfers it to the
platform. We are never the client's payee; we never hold or forward client money;
our fee arrives from Stripe the same way Stripe's own processing fee is taken. On
the strict text of constraint 7 ("never a payee, never an aggregator, never in the
flow of funds"), a *conservative* reading could still call a per-transaction cut
"in the flow." Two clean rails therefore exist:

1. **Strictest-clean (recommended default): flat SaaS subscription** billed to the
   freelancer on our own ordinary Stripe account — our revenue never intersects the
   client transaction at all. Matches the evidenced $15–30/mo gap pricing directly.
2. **App-fee rail (clean by mechanics, board should bless the reading):**
   `application_fee_amount` on connected-account invoices. Revenue scales with
   invoice volume; still zero custody.

The constraint-7 verdict does **not** depend on the app fee: rail 1 alone
monetizes. Whether rail 2 is within the board's intent for constraint 7 is a
one-line board question for the step-4 memo, not an engineering blocker.

### The forbidden shape, for the permanent design review

`POST /v1/invoices` **without** the `Stripe-Account` header, with
`transfer_data[destination]` (a destination charge: platform is merchant of
record, funds land on our balance, then transfer out) exists in the same API and
was accepted by the mock. Any PR that drops the `Stripe-Account` header or adds
`transfer_data`/`on_behalf_of`-style platform-side charging is the custody
boundary being crossed. This is a lintable invariant (our Stripe client wrapper
can hard-require the header and ban the destination-charge params) — cheap, but
permanent, as scored.

## 2. Template provenance (license table)

Method: publisher's own license statement fetched 2026-08-31; verbatim names;
nothing rounded up.

| Source | What it offers for D1 | License (as read) | Usable commercially at $0? |
|---|---|---|---|
| Common Paper standard agreements (commonpaper.com/standards) | **Independent Contractor Agreement** ("terms for freelance and consulting work"), **Professional Services Agreement**, **Statement of Work**, mutual/one-way NDA, amendment, order form | "Creative Commons Attribution 4.0 International License" (stated on their standards page) | **Yes** — CC BY 4.0 permits commercial use and adaptation, with attribution. This is the exact document family D1 needs. |
| Bonterms (bonterms.com) | Professional Services Agreement, NDAs, Software License Terms | **Not verified this tick** — FAQ implies free use/redlining but the license page 404'd on the URL tried | Unknown — lawyer/next-tick follow-up before use |
| "Contract Killer" (Andy Clarke, stuffandnonsense.co.uk) | Plain-English freelance web-design contract, widely adapted since 2008 | **No license stated on the project page** as fetched | Unknown — do not use without finding its actual terms |
| Invoice templates | Invoice *layout/fields* | Not a licensing question — invoices are structured business documents; we draft our own (see §4). Jurisdictional required-fields (e.g., EU VAT) are recurring content maintenance, as the C3 rationale already priced | Yes (original work) |

**Finding:** the provenance unknown that held C2 off a 5 is now **bounded with a
named $0 source**: Common Paper's CC BY 4.0 library covers freelancer contract,
PSA, SOW, and NDA shapes and may be adapted commercially with attribution. What
remains is exactly what Carla's C5 flagged: **lawyer-agent review of our adapted
templates before shipping** (the G3 posture — self-serve documents, never legal
advice, plus attribution implementation and jurisdiction fit). That residual is a
review cost, not a licensing cost, and it sits in the C5 domain — not priced here.

## 3. Reminder deliverability at $0

Three-part finding, better than the worst case but with a hard edge:

1. **The headline reminder value has a $0, production-grade path — Stripe's own
   rails.** Verified in Stripe's docs (invoicing/send-email, fetched 2026-08-31):
   Stripe itself emails finalized invoices ("Send finalized invoices and credit
   notes to customers"), sends reminders ("Send reminders if a recurring invoice
   hasn't been paid" — predefined before/when/after-due schedules; unpaid
   *one-time* invoice reminders via "Advanced invoicing features"; one-off
   re-sends via `POST /v1/invoices/:id/send`), and attaches its own invoice PDF.
   On direct-charge invoices these go out under the **connected account's**
   branding on Stripe's sender infrastructure — deliverability is Stripe's
   operations problem, not a fresh domain of ours. Cost note (remembered, not
   re-verified this tick): Stripe Invoicing is priced as a small percentage of
   paid invoices — and under `fees.payer=account` that lands on the freelancer
   like other Stripe fees, not on us; exact rate needs confirming in test mode.
2. **Self-hosted SMTP on our default host is not degraded — it is blocked.**
   DigitalOcean docs, fetched 2026-08-31: "SMTP ports 25, 465, and 587 are blocked
   on Droplets to prevent spam and other abuses on our platform," with the
   explicit recommendation to use "a third-party email as a service provider."
   There is no self-send path on DO at all, at any reputation level.
3. **Anything beyond Stripe's cadences — custom dunning sequences, product/
   onboarding email — requires an ESP, and every ESP is a signup.** So: **no
   $0-no-account path to production-grade custom email; smallest options are
   board-gated account creations** (prices remembered, not verified this tick:
   Amazon SES ~$0.10 per 1,000 sends plus an AWS account and a sandbox-exit
   request; Postmark ~$15/mo; SendGrid has a ~100/day free tier — free, but still
   an account). Whichever is chosen, Gmail's sender floor applies (fetched
   2026-08-31): SPF **and** DKIM plus DMARC for bulk senders, one-click
   unsubscribe on marketing mail, spam rate "below 0.30%" (recommended below
   0.10%) — i.e., the permanent deliverability obligation in the C3 rationale is
   real, but v1 can defer most of it to Stripe.

SMS (must-test item 3's tail question): nothing measured this tick suggests SMS is
needed in v1 — the invoice/reminder loop is email-native and Stripe-carried. SMS
would be a second board-gated vendor with its own registration regime (measured in
the D4 spike's domain), and should stay out of D1 v1.

## 4. Throwaway build measurement — invoice PDF at zero dependencies

Question: is invoice rendering commodity work, as C2=4 assumed? Built a
zero-dependency invoice PDF generator in pure Node stdlib (PDF 1.4, core fonts,
no libraries): **107 lines**, producing a correct one-page invoice (line items,
qty/rate/amount columns, subtotal/tax/total, Net-30 terms, late-fee clause,
usage-rights transfer line) — **2,432 bytes, 0.194 ms per invoice** (1,000-render
loop, M1 Max; `file` confirms "PDF document, version 1.4", thumbnail render
verified visually). And the finding on top of the finding: for Stripe-billed
invoices we don't even need it — finalize yields Stripe's own
`hosted_invoice_url` and `invoice_pdf`. Our renderer is only for offline/record
copies. Invoice generation is commodity; the C2 build-cost assumption holds with
margin.

## 5. Verdict

The measurements support **C2 = 4 and C3 = 4 as scored — both caveats that held
C2 off a 5 are now bounded, and nothing moved in either direction.**

- **C2 = 4 holds.** The constraint-7 architecture exists with named, spec-validated
  primitives (`/v1/accounts` Standard defaults → `/v1/account_links` →
  `Stripe-Account`-scoped `/v1/customers`, `/v1/invoiceitems`, `/v1/invoices`
  [`send_invoice`, `days_until_due`, optional `application_fee_amount`] →
  `/finalize` → `/send` → `invoice.*` webhooks), with Stripe carrying onboarding
  KYC, the hosted payment page, the invoice PDF, and invoice email. Template
  provenance now has a named $0 seed (Common Paper, CC BY 4.0, verbatim-verified)
  with a C5-domain lawyer-review residual. The invoice-render measurement (107
  lines, 0.2 ms) confirms commodity components. Still a 4, not a 5: self-serve
  polish remains the product, and the lawyer-review residual is unpriced.
- **C3 = 4 holds.** The deliverability SLA the score priced is real but v1-shaped
  smaller than feared: invoice/reminder email rides Stripe's sender
  infrastructure on the connected accounts at $0 to us; the obligation returns
  the moment we send custom email (board-gated ESP, Gmail's 0.3% spam floor).
  The constraint-7 boundary is confirmed to be **our** invariant to hold — the
  forbidden destination-charge shape sits in the same API — validating the
  permanent design-review line item (cheap and lintable, but forever).

**Not measured, listed not guessed:** webhook delivery fidelity/latency and
invoice state transitions (stripe-mock is stateless); real freelancer onboarding
friction/conversion through account_links; exact Stripe Invoicing pricing;
Bonterms and Contract Killer license terms; actual inbox placement rates.
**Requires board-approved account creation to measure:** a free Stripe test-mode
sandbox (webhooks + onboarding flow end-to-end); any ESP account for custom
email. **One board-interpretation question for step 4:** whether the
application-fee rail fits the intent of constraint 7, or whether revenue stays
subscription-only (the architecture verdict is the same either way).

---

*Throwaway artifacts (flow script, raw stripe-mock responses, PDF generator and
sample output): session scratchpad only, per spike rules. stripe-mock 0.203.0
(MIT) via Homebrew; docs quotes fetched from docs.stripe.com,
docs.digitalocean.com, support.google.com, commonpaper.com on 2026-08-31.
Nothing in this spike touched Lattice, per the rubric's strategy-work carve-out.*
