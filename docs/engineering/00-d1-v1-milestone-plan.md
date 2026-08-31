# D1 v1 — Milestone Plan

**Author:** Owen Kessler, CTO (`agent:cto-owen`). **Created:** 2026-08-31.
**Produced by:** AS-31, under the board's step-5 green-light (`docs/strategy/08-board-decision.md`).
**Status:** living engineering reference. Scope changes land in the amendment log (§9) or they did not happen.

This is the single source of scope truth for D1 v1. It is cited by every v1 build
task, and it cites every one of them back (§3, §8.3). It is deliberately **not**
in `docs/strategy/`: files 01–09 there are a closed, countersigned decision record
about what business to be in, several carrying signatures, and appending an
amendable document to a signed record teaches future readers that signed records
are amendable. This document is the opposite kind of artifact and lives on its own
plane.

**Required-sections map** (AS-31 plan §2.2, for mechanical checking): purpose §1 ·
boundary filter §2 · capability table §3 · screen budget §4 · assumptions and
falsifiers §5 · milestone sequence §6 · board asks §7 · amendment log §9. §8 (task
set and graph) is additional.

---

## 1. Purpose of v1, in one sentence

> **v1 is the smallest system in which one real freelancer gets one real client to
> pay one real invoice, on the freelancer's own Stripe account, with us never in
> the flow of funds.**

One clarification the sentence needs, because it is the difference between a
purpose and an acceptance test. That sentence describes what the system is **for**.
What v1 must **demonstrate** is the same loop closing in **Stripe test mode on a
local docker-compose stack** — because live money requires an incorporated entity
and a live-mode processor account, neither of which engineering owns or can
conjure (§2, Rule 3; §6.1). Building the system that does the real thing, and
accepting it on the test-mode close, is what keeps the build off a critical path we
do not control. The board is being asked to confirm exactly this reading (§7.1,
ask A2) rather than to discover it later.

---

## 2. The v1 boundary filter

This is the load-bearing decision. It defines the screen budget and every task
that follows, so it is written as **a filter a stranger can re-run**, not a taste.

### 2.1 The four rules, verbatim

*Transcribed unchanged from the AS-31 plan §3. Four rules, applied in order. Each
can only exclude.*

> **Rule 1 — Loop-critical.** A capability is in only if removing it breaks this
> chain:
>
> > freelancer signs up → connects their own Stripe account → produces a contract
> > for a client → issues an invoice on that client, on the freelancer's own
> > account → client pays → freelancer sees it paid
>
> If the chain still closes without it, it is out. Note where the chain *ends*: at
> the freelancer seeing payment, **not** at us collecting revenue. That is
> deliberate and Rule 3 explains why.
>
> **Rule 2 — Stripe already does it.** If Stripe's hosted surface performs the job
> at $0 to us, v1 consumes Stripe's and builds none of its own. Measured instances
> from the spike: hosted KYC onboarding via `account_links` (§1), the hosted payment
> page (§1), `invoice_pdf` (§1, §4), Stripe-sent invoice email and its built-in
> reminder cadences (§3.1). Building a parallel implementation of any of these is
> out — including our own invoice PDF renderer, which the spike measured at 107
> lines and 0.194 ms and *still* found unnecessary (§4). Cheap to build is not a
> reason to build.
>
> **Rule 3 — Buildable unincorporated and unaccounted.** In only if it can be built
> **and verified** with: (a) no external account beyond the single board-approved
> Stripe **test-mode** account; (b) no EIN or registered entity; (c) no product
> name, domain, or sender identity. Anything failing this is out of v1 **by
> construction, not by preference**, and moves to a named later milestone with its
> board ask drafted.
>
> This rule is why Rule 1's chain stops short of our own revenue: charging a
> freelancer real money needs a live-mode processor account, which needs an entity,
> which is a company milestone we do not control. Putting it inside v1 would block
> engineering on incorporation. Ditto A2P 10DLC SMS (EIN-gated) and any custom
> email (ESP account + sender domain + product name).
>
> **Rule 4 — Polish is depth, not breadth.** 07 §3 says our differentiation must
> come from trust, polish, and distribution rather than features. Read carefully,
> that is a **scope-narrowing** force, not a licence to add: v1 buys polish by
> finishing *few* screens to their complete states ledger, never by adding screens.
> A candidate justified as "it makes us look more trustworthy" is out unless it
> independently passes Rule 1. Polish is spent inside AS-30's states ledger, on the
> screens already in the budget.
>
> **Overflow rule.** If the IN set exceeds the screen budget (§4) or the task-count
> band (§6.1), do not raise the ceiling. Re-apply Rule 1 more strictly — ask which
> IN capability's removal breaks the chain *least* — and cut, recording the cut in
> the capability table with the reason. Raising a ceiling is an amendment-log event
> with a named reason, never a silent edit.

### 2.2 Application conventions

These say how the rules are applied so two readers reach the same verdict. They
constrain the filter; they do not add to it.

1. **Strict ordering.** The rules are applied 1 → 2 → 3 → 4, and an OUT row names
   **the first rule that excluded it**. Where a later rule would independently have
   excluded the same row, the note says so — that is information, not the verdict.
2. **The chain is evaluated as system behaviour, not as an environment.** Rule 1
   asks whether removing a capability breaks the chain for a real freelancer and a
   real client, independent of where the system runs or whose money moves. *Where*
   it runs and *whose* money it is are Rules 2 and 3's business. Without this
   convention, "deployment" and "live mode" would be excluded by Rule 1 for the
   wrong reason and Rule 3 would never fire.
3. **Three verdicts.** `IN` — survives all four rules. `IN (mandate)` — not a filter
   candidate at all: required by a standing constraint or by process, cited by name.
   `OUT` — excluded, naming the first rule.
4. **The filter selects product capabilities. It does not select constraints.** The
   custody guard (row C-03) fails Rule 1 — the chain closes without it — and is in
   anyway, because board constraint 7 is not a feature request. Marking such rows
   `IN (mandate)` keeps them from being mistaken for filter output, and keeps a
   reviewer re-deriving C-03 from getting a "wrong" answer that is actually right.
5. **A property of the filter worth stating rather than hiding: Rule 4 can never be
   the first rule to exclude a capability.** For Rule 4 to fire, a capability would
   have to be chain-critical *and* justified only by polish — a contradiction. Rule
   4's operative force is therefore (a) on effort allocation, sending polish into
   the states ledgers of the seven budgeted screens rather than into new surfaces,
   and (b) on **barring the counter-argument**: "it makes us look trustworthy" is
   not admissible against a Rule 1 exclusion, at scoping or at review. Rows where
   that argument was actually advanced say `Rule 1 (Rule 4 bars the counter-argument)`.
6. **Rows are evaluated as increments over what is already IN.** This is what makes
   the "our own X" rows reproducible, and without it Rule 2 would never fire. A row
   proposing a *second* satisfier for a capability an IN row already satisfies is
   excluded — **by Rule 2 when the existing satisfier is Stripe's** (that is Rule 2's
   entire job: the chain needs the thing, Stripe supplies it, so we build none of our
   own), and **by Rule 1 otherwise** (the chain closes without the increment). Worked
   both ways: *our own invoice PDF renderer* (C-30) is an increment over Stripe's
   `invoice_pdf` → **Rule 2**; *our own contract PDF renderer* (C-25) is an increment
   over the print-ready HTML contract we already build in C-21, and Stripe has nothing
   to do with contracts → **Rule 1**. Same phrasing, different rule, and the reason is
   mechanical rather than a matter of taste.
7. **Reconciliation with the AS-31 plan §8.** That section named a deciding rule for
   each out-of-scope item as shorthand. Under strict ordering, several are excluded
   by Rule 1 before Rule 3 is reached — the *verdict* is identical, the citation
   differs. This table uses strict ordering, because the review's re-derivation test
   applies the rules in order. Affected rows: C-42, C-43, C-47, C-48, C-53, C-57.

---

## 3. Capability table

Every capability considered, including the rejected ones. A capability discussed
anywhere in the D1 record and missing from this table is a defect in the record.
Row IDs (`C-nn`) are stable and are the join key that every task cites.

**Counts: 57 rows considered — 24 IN (of which 5 `IN (mandate)`), 33 OUT.**
By first excluding rule: Rule 1 × 26, Rule 2 × 5, Rule 3 × 2, Rule 4 × 0 (see §2.2.5).

### 3.1 Substrate and mandate

| Row | Capability | Verdict | Deciding rule | Task | Note |
|---|---|---|---|---|---|
| C-01 | Framework/stack decision, written | IN (mandate) | Front-end design plan §4 Phase C | **AS-36** | Not a filter candidate — a process obligation. Criteria in AS-36; no candidates named by AS-31 on purpose. |
| C-02 | Product app scaffold `apps/invoicing/` (compose, config, test harness) | IN | Rule 1 | **AS-37** | Nothing in the chain runs without it. Directory name is decided, not placeholder (09 §8.2). |
| C-03 | Stripe client wrapper + custody guard | IN (mandate) | Board constraint 7 / assumption A3 | **AS-38** | Fails Rule 1 by itself; in anyway. See §2.2.4 and §5.3. |
| C-04 | Persistence layer and data model | IN | Rule 1 | **AS-39** | No Stripe calls, so it parallelises with C-03. |
| C-05 | Automated end-to-end verification, no external accounts | IN (mandate) | v1 definition of done (§6.1) | **AS-49** | Deterministic half of "done". |
| C-06 | Recorded acceptance run against Stripe test mode | IN (mandate) | v1 definition of done (§6.1) | **AS-50** | The other half. Board-gated on A1. |

### 3.2 Chain link 1 — freelancer signs up

| Row | Capability | Verdict | Deciding rule | Task | Note |
|---|---|---|---|---|---|
| C-07 | Freelancer account: local credentials, session, route guard | IN | Rule 1 | **AS-40** | Chain link 1. |
| C-08 | Sign-up / sign-in screen | IN | Rule 1 | **AS-45** | Screen 1 of 7. One route, two modes. |
| C-09 | Email verification / magic link / password reset | OUT | Rule 1 | — | Chain closes without it. Rule 3(a)(c) independently: needs an ESP and a sender domain. Returns in M3 (§6.2). |

### 3.3 Chain link 2 — connects their own Stripe account

| Row | Capability | Verdict | Deciding rule | Task | Note |
|---|---|---|---|---|---|
| C-10 | Connected account creation, hosted onboarding link, return/refresh | IN | Rule 1 | **AS-41** | `POST /v1/accounts` bare defaults + `/v1/account_links`; spike §1. |
| C-11 | Connected-account readiness state gating invoicing | IN | Rule 1 | **AS-41** | Stripe returns the user whether or not requirements are met; invoicing an account that cannot charge breaks link 4. |
| C-12 | Connect Stripe screen + its states ledger | IN | Rule 1 | **AS-45** | Screen 2 of 7. |
| C-13 | Our own KYC / identity-document collection | OUT | Rule 2 | — | Stripe's hosted onboarding collects it and we never see it (`requirement_collection=stripe`). |
| C-14 | Freelancer business profile / invoice branding (logo, address) | OUT | Rule 2 | — | Stripe renders invoices with the connected account's own branding, set in the freelancer's Stripe Dashboard. |

### 3.4 Chain link 3 — produces a contract for a client

| Row | Capability | Verdict | Deciding rule | Task | Note |
|---|---|---|---|---|---|
| C-15 | Client records (create, select, reuse) | IN | Rule 1 | **AS-39** | Links 3 and 4 need a stored counterparty. |
| C-16 | Dedicated Clients management screen | OUT | Rule 1 | — | Chain closes: clients are created inline from the invoice and contract forms. This is a **cut**, not the fold the AS-31 plan §4.2 anticipated. |
| C-17 | Contract template set: structure, variables, marked placeholder body | IN | Rule 1 | **AS-42** | **One** template in v1; a second does not close anything more. |
| C-18 | CC BY 4.0 attribution mechanism on generated contracts | IN (mandate) | Licence terms (spike §2) | **AS-42** | Built now, exercised by the placeholder, so it cannot be forgotten when real text lands. |
| C-19 | Contract generation: variables → stored record + rendered document | IN | Rule 1 | **AS-42** | |
| C-20 | Contract create screen | IN | Rule 1 | **AS-47** | Screen 6 of 7. |
| C-21 | Contract detail screen: view + print/download | IN | Rule 1 | **AS-47** | Screen 7 of 7. This *is* v1's delivery mechanism — see C-22. |
| C-22 | Client-facing contract portal / public share link | OUT | Rule 1 | — | The freelancer downloads or prints and sends it through their own email. Delivery is freelancer-mediated in v1 **because we can send no email** (C-48) — stated plainly rather than dressed up. |
| C-23 | Recorded client acceptance event on a contract | OUT | Rule 1 | — | Chain closes without it: the freelancer can invoice and be paid regardless. **This overrides the AS-31 plan §12 Q1 default** — see amendment log row 3. |
| C-24 | E-signature with legal weight (audit trail, certificate, tamper-evidence) | OUT | Rule 1 | — | Also decided in AS-31 plan §8.6. |
| C-25 | Our own contract PDF renderer | OUT | Rule 1 | — | An increment over C-21, which already produces a print-ready document, and Stripe has nothing to do with contracts — so Rule 1, not Rule 2 (§2.2.6). The spike's 107-line renderer stays throwaway. |

### 3.5 Chain link 4 — issues an invoice on the freelancer's own account

| Row | Capability | Verdict | Deciding rule | Task | Note |
|---|---|---|---|---|---|
| C-26 | Stripe customer mirror (`cus_` on the connected account) | IN | Rule 1 | **AS-43** | Created lazily at first invoice, so an un-invoiced client leaves no trace on the freelancer's account. |
| C-27 | Invoice draft: line items, `days_until_due`, single currency | IN | Rule 1 | **AS-43** | |
| C-28 | Invoice finalize + send | IN | Rule 1 | **AS-43** | `/send` makes **Stripe** email the client — that is how the client is notified in a product that sends no email. |
| C-29 | Invoice create/edit screen | IN | Rule 1 | **AS-46** | Screen 4 of 7. Carries inline client creation (C-16). |
| C-30 | Our own invoice PDF renderer | OUT | Rule 2 | — | An increment over Stripe's `invoice_pdf`, returned by finalize — so Rule 2, not Rule 1 (§2.2.6). Measured at 107 lines and 0.194 ms, and still unnecessary (spike §4): cheap to build is not a reason to build. |
| C-31 | Invoice email to the client, sent by us | OUT | Rule 2 | — | Rule 1 passes (the client must learn of the invoice); Stripe does it, so Rule 2 excludes. Rule 3 would too. |
| C-32 | Multi-currency, VAT, jurisdictional invoice fields | OUT | Rule 1 | — | The schema must not foreclose it (AS-39). |
| C-33 | Recurring invoices for the freelancer's own clients | OUT | Rule 1 | — | |

### 3.6 Chain link 5 — client pays

| Row | Capability | Verdict | Deciding rule | Task | Note |
|---|---|---|---|---|---|
| C-34 | Client payment surface | OUT | Rule 2 | — | Consumed from Stripe via `hosted_invoice_url`. Chain link 5 is satisfied entirely by a surface we do not build. |
| C-35 | Client portal beyond Stripe's hosted pages | OUT | Rule 1 | — | The chain's client-facing need — view and pay this invoice — is fully met by Stripe (C-34). "Beyond" is by its own wording the part Stripe does *not* satisfy, so Rule 2 cannot fire on it (§2.2.6) and Rule 1 excludes it: the chain closes. |

### 3.7 Chain link 6 — freelancer sees it paid

| Row | Capability | Verdict | Deciding rule | Task | Note |
|---|---|---|---|---|---|
| C-36 | Invoice state sync from Stripe (webhook receipt, signatures, idempotency) | IN | Rule 1 | **AS-44** | The capability is *knowing it was paid*; webhooks are the implementation, not the requirement. |
| C-37 | Dashboard / invoice + contract list screen | IN | Rule 1 | **AS-48** | Screen 3 of 7. |
| C-38 | Invoice detail + status screen | IN | Rule 1 | **AS-48** | Screen 5 of 7. Surfaces Stripe's hosted links rather than rebuilding them. |
| C-39 | Reminder configuration UI / custom cadences | OUT | Rule 1 | — | Chain closes without reminders. Rule 2 independently: Stripe's cadences ride on the connected account at $0 and the freelancer configures them in their own Dashboard. **Diverges from the AS-31 plan §6.2 fan expectation** — amendment log row 5. |
| C-40 | One-click manual invoice re-send | OUT | Rule 1 | — | |
| C-41 | Account settings screen | OUT | Rule 1 | — | Connection status lives on screen 2; invoice branding lives in the freelancer's Stripe account (C-14). A **cut**, not a fold (AS-31 plan §4.2 candidate 9). |

### 3.8 Revenue, entity, and environment

| Row | Capability | Verdict | Deciding rule | Task | Note |
|---|---|---|---|---|---|
| C-42 | Application-fee / take-rate code path | OUT | Rule 1 | — | The chain deliberately ends before our revenue. **Independently forbidden** by the board default (08 §3.2) pending the constraint-7 ruling. §8 shorthand said Rule 3; see §2.2.7. |
| C-43 | Our own subscription billing + paywall enforcement, live | OUT | Rule 1 | — | Rule 3(b) independently: entity-gated. Milestone M2. |
| C-44 | Plan-gating flag in code, no billing UI | OUT | Rule 1 | — | Sustains the AS-31 plan §12 Q2 default. |
| C-45 | **Live-mode operation (real client money)** | OUT | **Rule 3(b)** | — | Rule 1 *passes* — this is literally the chain's last two links. Excluded only because it needs an entity and a live-mode account. Milestone M2. |
| C-46 | **Production deployment to Digital Ocean (+ TLS, domain)** | OUT | **Rule 3(a)(c)** | — | Rule 1 *passes* — a real freelancer needs a reachable system. Excluded because it needs a DO project, a domain, and therefore the product name. Milestone M1. |
| C-47 | Marketing site / public pages / DNS / sender domains | OUT | Rule 1 | — | The chain begins at "freelancer signs up", so *finding us* is outside it and the chain closes without marketing pages. Contrast C-46: a reachable system is a prerequisite **of** signing up, so that one passes Rule 1 and falls to Rule 3. Rule 3(c) would exclude this row independently; naming-gated per 09 §8.2. |
| C-48 | Outbound email from our own sender identity (ESP) | OUT | Rule 1 | — | Rule 3(a)(c) independently. This is the row that makes C-09 and C-22 what they are. Milestone M3. |

Rules 3's two first-fire rows are C-45 and C-46, and they are exactly the two
things that would put v1 on the critical path of incorporation and product naming.
That is the whole job of Rule 3, done by two rows.

### 3.9 Feature-parity territory — the ground 07 §3 named as occupied

| Row | Capability | Verdict | Deciding rule | Task | Note |
|---|---|---|---|---|---|
| C-49 | Mobile / native apps | OUT | Rule 1 | — | Responsive rendering at 375px is inside the budgeted screens, not a separate capability. |
| C-50 | Multi-seat / teams / roles | OUT | Rule 1 | — | |
| C-51 | Accounting / time-tracking / Zapier integrations | OUT | Rule 1 | — | |
| C-52 | Proposals, time tracking, expenses | OUT | Rule 1 | — | |
| C-53 | SMS / A2P 10DLC notifications | OUT | Rule 1 | — | Rule 3(b) independently (EIN-gated). The spike itself recommended it stay out of D1 (§3). |
| C-54 | In-app trust/marketing surfaces (badges, testimonials, trust page) | OUT | Rule 1 (Rule 4 bars the counter-argument) | — | |
| C-55 | Onboarding checklist / guided tour | OUT | Rule 1 (Rule 4 bars the counter-argument) | — | |
| C-56 | Product analytics / telemetry | OUT | Rule 1 | — | |
| C-57 | Custom dunning sequences / onboarding drips / product email | OUT | Rule 1 | — | Rule 3(a)(c) independently. Milestone M3. |

---

## 4. Screen budget

### 4.1 Definition

A **screen** is a distinct route with its own states ledger. Modals, drawers,
empty states, loading states, error states, and permission-denied states are
*states of a screen*, not screens. Without this definition "screen count" is
gameable and the budget means nothing.

### 4.2 The number

**Ceiling 9. Target 7. Landed: 7.** The ceiling's derivation is the AS-31 plan
§4.2 candidate list — nine screens is the honest ceiling for the Rule-1 chain,
seven is reachable if the Clients and Contract-detail candidates fold. The filter
reached seven by a different and stricter route than folding: it **cut** two
candidates outright.

- Candidate 6, **Clients** — cut, not folded (row C-16, Rule 1): clients are
  created inline from the two forms that need them.
- Candidate 9, **Account settings** — cut (row C-41, Rule 1): connection status
  lives on the Connect screen and invoice branding lives in the freelancer's own
  Stripe account (row C-14, Rule 2).
- Candidate 8, **Contract detail** — kept (row C-21). It is a distinct route from
  contract create, and it is where v1's delivery actually happens, since we cannot
  email a contract (row C-48).

**Two screens of headroom under the ceiling are unspent, and stay unspent.**
Spending them is an amendment-log event with a named reason, not a design call.

### 4.3 The v1 screen inventory

| # | Screen | Route shape | Capability row | Task |
|---|---|---|---|---|
| 1 | Sign up / sign in | one route, two modes | C-08 | AS-45 |
| 2 | Connect Stripe | one route; return/refresh are *states*, not screens | C-12 | AS-45 |
| 3 | Dashboard / list (invoices + contracts) | | C-37 | AS-48 |
| 4 | Invoice create/edit | inline client creation | C-29 | AS-46 |
| 5 | Invoice detail + status | surfaces Stripe's hosted links | C-38 | AS-48 |
| 6 | Contract create | inline client creation | C-20 | AS-47 |
| 7 | Contract detail + print/download | | C-21 | AS-47 |

**Note for AS-30 (UX):** the core loop as written in the front-end design plan
ends "→ reminders". There is **no reminders screen in v1** (row C-39): Stripe's
own cadences ride on the connected account and the freelancer configures them in
their own Stripe Dashboard. Do not spend budget wireframing one. Polish belongs in
the states ledgers of these seven screens — that is what Rule 4 means operationally.

---

## 5. Assumptions and falsifiers

A falsifier without an observable, a threshold, and a pre-committed action is a
caveat wearing a lab coat. All three, for each.

### A1 — the occupied-band bet (07 §3, carried forward by 08 §5)

> Freelancers in the occupied $15–30/mo band will switch to us for a
> contract→invoice→paid loop; differentiation will come from trust, polish, and
> distribution rather than features — so a deliberately small, fully-finished v1 is
> the right bet.

**F1a — demand side.**
- *Observable:* the structured interviews from the board's warm intros (07 §4.1).
- *Threshold:* **≥3 of 5** interviewees report their current tool already handles
  contract→invoice→paid acceptably **and** price is not among their top-two
  complaints.
- *Pre-committed action:* **v1 scope freezes at this boundary.** We do not answer
  falsification by growing features — that is precisely the trap 07 §3 named. The
  CTO files a written report with a recommendation to the board within one tick
  (08 §5 converted "withdraw" into "report promptly"; this names what the report
  contains), and the milestone *after* v1 is redirected from features to
  distribution.

**F1b — supply side, and it is a confirmation test, stated honestly as one.**
- *Observable:* actual v1 build cost — tasks, ticks, lines — against this plan's
  projection (§8.2). We are building v1 anyway, so the measurement is free.
- *Threshold:* v1 lands at or under projection with no surface that is not either
  Stripe's or commodity.
- *Pre-committed action:* the symmetric-ease risk is recorded as **confirmed**, and
  distribution becomes the next milestone by default, with no further argument
  required.

### A2 — subscription-only (08 §3.2)

> Subscription-only is the operative revenue model; no application-fee code path is
> built.

- **Trigger, not falsifier:** a board ruling that the app-fee rail is clean under
  constraint 7.
- **Design consequence decided now:** the spike measured the reversal as one
  parameter on one call (`application_fee_amount` on a connected-account invoice
  create, §1). v1 therefore keeps **every Stripe call behind a single module**
  (AS-38), which builds no app-fee path — the constraint is honoured literally —
  while declining to foreclose one. Projected reversal cost: one task, at or below
  the §8.2 floor.
- **Standing note, restated so it stays visible:** *a board ruling before v1 lands
  is worth materially more than one after.* Recorded at my countersignature of
  08 §6(b); still true, and the window is now.

### A3 — custody: an invariant, so it gets a mechanism, not a falsifier

> Never in the flow of funds is permanent. The forbidden shape — a platform-side
> invoice with `transfer_data[destination]` — lives in the same API and the mock
> accepts it, so the boundary is ours to hold forever. The API will not hold it for us.

**Mechanism:** AS-38, landing before any Stripe caller, with tests that fail if the
ban is removed. Any future change crossing the boundary turns the suite red rather
than requiring someone to remember. The graph enforces the ordering: every
Stripe-touching task transitively depends on AS-38, verified by simulation (§8.4).

---

## 6. Milestone sequence

### 6.1 v1 — "the loop closes in test mode"

**Definition of done:** the Rule-1 chain closes end-to-end **in Stripe test mode on
a local docker-compose stack**, verified by an automated suite (AS-49) plus one
recorded manual run (AS-50).

Gated on nothing except board ask A1 (§7.1), and only AS-50 is gated on it — the
other fourteen build tasks verify with no account at all, by design.

### 6.2 After v1

Named, with what gates each. **The ordering after v1 is not fixed here**: it is set
by A1's falsifier outcomes (F1a redirects to distribution; F1b confirms it by
default), which is the point of writing falsifiers with pre-committed actions.

| Milestone | Contents | Gated on |
|---|---|---|
| **M1 — reachable product** | Deployment to Digital Ocean, TLS, public sign-up URL, marketing pages (C-46, C-47) | Product naming (09 §8.2) → domain purchase (board spend) → DO project (board approval) |
| **M2 — live money** | Live-mode operation, our own subscription billing and paywall (C-45, C-43, C-44) | Incorporation and EIN (company milestone, non-Lattice) → live-mode processor account (board) |
| **M3 — we can send email** | Password reset, verification, custom reminders and dunning, product email (C-09, C-57, C-48) | ESP account (board) + sender domain (product name) + SPF/DKIM/DMARC |
| **M4 — contract depth** | Client-facing contract portal, recorded acceptance, real adapted template text, e-sign evaluation (C-22, C-23, C-24) | Lawyer-agent review of the adapted Common Paper templates (CEO + CTO, non-Lattice) |
| **M5 — distribution** | Not scoped here | Becomes the default next milestone under F1a or F1b |

---

## 7. Board asks

### 7.1 Filed now, in Lattice, at `needs_human`

**A1 — free Stripe test-mode account with Connect → AS-51.**
Asks the board to create one free Stripe account, leave it in **test mode**, enable
Connect, and permit the Stripe CLI's local webhook forwarding under that same
account. $0; no card, no activation, no bank details. Registered to the board
member personally, because the company is unincorporated and has no legal person
able to hold an account; test mode only; closed or transferred at incorporation as
a separate decision. It unblocks AS-50 and nothing else. If refused, v1 still
builds and its suite still passes — against a Stripe double we wrote ourselves —
but we would be shipping a payments integration never once exercised against the
real API, AS-50 stays blocked, and v1 cannot honestly be declared done. Alternatives
considered and rejected as substitutes: stripe-mock (stateless, no webhooks) and
our own stateful fake (tests our logic against our own assumptions, which is the
failure mode the real API is supposed to catch). **No account has been opened and
no task assumes one exists.** Full text: AS-51's description.

**A2 — confirm v1's definition of done → AS-52.**
Asks the board to confirm that v1 means the loop closing in test mode on a local
stack, with no deployment, no domain, no live money, no email from us, and
clearly-marked placeholder contract text. Asked because three of those exclusions
are gated on decisions engineering does not own, and a mismatch is cheap to fix now
and expensive at AS-50. $0. Full text: AS-52's description.

### 7.2 Drafted, not filed — they gate no v1 task

These are drafted here so the later milestones arrive with their asks written, per
AS-31 plan §8. They are deliberately **not** in Lattice at `needs_human`: none of
them gates a v1 task, and most cannot be usefully answered until product naming
completes. Each becomes a filed ask when its milestone opens.

- **Digital Ocean project + droplet (M1).** Cost: the smallest droplet plus any
  managed database, board-approved spend. Unblocks a publicly reachable product.
  Blocked behind the domain, which is blocked behind product naming.
- **Domain registration (M1).** Cost: registrar fee. Cannot be drafted concretely
  until the product name exists; naming is a separate exercise (09 §8.2) and
  domains are board-gated spend.
- **ESP account (M3).** Free tiers exist and are still signups. Choice depends on
  the sender domain, which depends on the product name. Carries the Gmail bulk-sender
  obligations the spike measured (SPF + DKIM + DMARC, spam rate below 0.30%).
- **Live-mode processor activation (M2).** Not askable before incorporation; it needs
  an entity and an EIN.
- **Lawyer-agent review of adapted contract templates (M4).** Not a Lattice task and
  not a purchase — company-level work owned by CEO + CTO. Gates showing adapted
  template text to any real user; until it clears, contract tasks ship clearly-marked
  placeholder text.

---

## 8. Task set and dependency graph

### 8.1 Shape: spine → fan → join

**Spine (strictly serial, 3).** AS-36 stack decision → AS-37 scaffold → AS-38
Stripe wrapper and custody guard. The guard lands **before any code that calls
Stripe**; that ordering is the only one under which a "permanent design-review
obligation" means anything mechanical.

**Fan (parallel, 10).** Server halves (AS-39, AS-40, AS-41, AS-42, AS-43, AS-44)
and UI halves (AS-45, AS-46, AS-47, AS-48), split along the seam between work that
needs a wireframe and work that does not.

**Join (2).** AS-49 automated end-to-end, AS-50 recorded test-mode acceptance run.

**How AS-30 interleaves instead of serialising.** The mechanism is structural, not
a promise: the entire spine and the entire server fan are invisible to UX and run
concurrently with AS-30. **No build task may declare `depends_on AS-30` except
tasks that render a budgeted screen** — exactly AS-45, AS-46, AS-47, AS-48, verified
in §8.4. A UI task whose wireframe has not landed waits, and its implementer pulls
from the non-UI fan instead; §8.4 proves there is always one there.

### 8.2 Right-sizing, measured

From our own record (n=24 merged code tasks, AS-3…AS-29, `.lattice/` excluded):
**median 6 files, ~222 insertions, 5 commits**; middle of the distribution 3–8 files
and ~90–430 insertions. Rework is where the tail bites — 2 of the 4 largest diffs in
company history took a review→rework cycle (50%) against 1 of the 20 under 1,000
insertions (5%). Small sample, stated honestly, but a tenfold difference in the
direction of the prior is enough to set a tripwire on.

**Primary test (semantic).** One reviewable claim; question-free implementability
from the plan file and the repo alone; a named verification method that runs with
the accounts we actually have.

**Tripwires (split, or carry a one-line written justification):** >~600 projected
lines · >~10 files · a title joining two subsystems with "and" · would need a board
ask mid-flight · cannot be verified without an account we do not have.
**Floor:** roughly one file / ~50 lines for build work.

Applied here:
- **AS-43** projects ~550 lines — under the threshold, kept whole as one claim.
- **AS-45, AS-47, AS-48** each merge two screens: written justification carried in
  each description (one reviewable claim, ~450 projected lines).
- **AS-50** was split out of the join precisely because it needs a board ask;
  AS-49 carries the deterministic claim so the ask blocks only one task.
- **AS-36** and **AS-50** sit below the build floor by line count. Both are
  documents/verification, not build work; the floor does not apply.

### 8.3 The graph

17 tasks: 15 build (including the stack decision) + 2 board asks. 34 dependency
edges. Every task cites its capability rows; every IN row names its task (§3).

```
AS-36 stack decision
  └─ AS-37 scaffold
       ├─ AS-38 Stripe wrapper + custody guard ─────┐
       └─ AS-39 data model + client records ───┐    │
                                               │    │
   AS-40 auth server        ← AS-39 ───────────┤    │
   AS-41 Connect server     ← AS-39, AS-38 ────┼────┤
   AS-42 contracts server   ← AS-39 ───────────┤    │
   AS-43 invoice server     ← AS-39, AS-38 ────┼────┤
   AS-44 webhooks/state sync← AS-43, AS-38 ────┴────┘

   AS-45 onboarding UI (1,2) ← AS-40, AS-41, AS-30
   AS-46 invoice UI (4)      ← AS-43,        AS-30
   AS-47 contract UI (6,7)   ← AS-42,        AS-30
   AS-48 read views (3,5)    ← AS-42, AS-43, AS-44, AS-30

   AS-49 automated e2e   ← AS-40, AS-41, AS-42, AS-43, AS-44
   AS-50 acceptance run  ← AS-49, AS-45..AS-48, AS-51, AS-52   [board-gated]

   AS-51 board ask: Stripe test-mode account   (needs_human)
   AS-52 board ask: confirm v1 done            (needs_human)
```

### 8.4 Verification of the graph, by simulation

Checked mechanically against live board state (`lattice show --json` for all 18
nodes), not by eye. All checks pass:

| Rule | Result |
|---|---|
| Acyclic | PASS — 18 nodes, no cycle |
| Spine strictly serial | PASS — AS-36 → AS-37 → AS-38, no extra edges |
| Every Stripe-touching task transitively behind AS-38 | PASS under **all three** definitions — narrow (issues a Stripe API request: AS-41, AS-43, AS-48), broad (tagged Stripe surface: AS-41, AS-43, AS-44), and their union |
| `depends_on AS-30` only on screen-rendering tasks | PASS — exactly AS-45, AS-46, AS-47, AS-48 |
| Ready-queue invariant | PASS — see below |
| Every task cites the plan + a capability row | PASS — 17/17 |
| Every description carries all three required elements | PASS — 17/17 |

**Ready-queue invariant, stated precisely.** *While non-UI work other than the
board-gated acceptance run remains incomplete, at least one non-UI task is
unblocked.* The exclusion is not a loophole: AS-50 is the acceptance run of the
whole product and is gated on the complete UI and on two board asks **by design**.

Simulated worst case — AS-30 never lands and neither board ask is ever answered:

```
AS-36 → AS-37 → {AS-38, AS-39} → AS-39 → {AS-40, AS-41, AS-42, AS-43}
      → AS-41 → AS-42 → AS-43 → AS-44 → AS-49 → (AS-45..48, AS-50 blocked)
```

10 of 15 work tasks complete with a non-UI task unblocked at every single step; the
company never idles on a design stall. Under the nominal walk (AS-30 lands, asks
answered) a full topological order exists over all 17.

*A note on method, because it argues for the method.* The first run of the checker
reported three failures. Two were bugs in the checker (it read the wrong JSON key
and saw an empty graph — every downstream check then passed **vacuously**), and one
was an over-broad detector that flagged AS-39 as Stripe-touching because its
description contains the word "webhook" in the name of a database table. Reading
34 edges by eye would have found none of this and would have felt more confident.
The checker now aborts if the edge count does not match, so an empty graph can
never pass again.

---

## 9. Amendment log

| # | Date | What changed | Why | Who |
|---|---|---|---|---|
| 1 | 2026-08-31 | Document created; capability table filtered (57 rows: 24 IN, 33 OUT); screen inventory landed at 7 of a ceiling of 9; 17 Lattice tasks created (AS-36…AS-52) with 34 edges | AS-31 implementation, under the board's step-5 green-light | Owen Kessler, CTO |
| 2 | 2026-08-31 | **Board asks filed at `needs_human` now**, rather than held in `backlog` until the tick their first blocked task is pulled | Diverges from AS-31 plan §6.4 and acceptance criterion 8. Reason: the ask is *filed* either way; the only question is whether the board sees it now or later. Lead time on a board decision is free, `needs_human` is the board's scannable queue, neither ask blocks any ready work, and the deferred alternative depends on a future tick remembering a timing rule — a coordination risk with no upside. Nothing is opened by us in either case, which was §6.4's actual concern | Owen Kessler, CTO |
| 3 | 2026-08-31 | **Contract acceptance event ruled OUT of v1** (row C-23) | Overrides the AS-31 plan §12 Q1 default ("generate + deliver + record acceptance"). §12 boxed the question to "decided in the capability table, this tick", and the filter decides it: removing acceptance recording does not break the chain, so Rule 1 excludes it. §8.6's "at most" set a ceiling, not a floor. Returns in M4 behind the lawyer review | Owen Kessler, CTO |
| 4 | 2026-08-31 | Clients screen (C-16) and Account settings screen (C-41) **cut**, not folded | AS-31 plan §4.2 marked them "possibly foldable". Rule 1 excludes both outright, which is a stricter result than folding and reaches the target of 7 screens honestly | Owen Kessler, CTO |
| 5 | 2026-08-31 | **No reminders capability in v1** (row C-39) | Diverges from the AS-31 plan §6.2 fan expectation, which anticipated a "reminder configuration riding Stripe's cadences" task. The filter excludes it: Rule 1 first (the chain closes without reminders), and Rule 2 independently (Stripe's cadences ride on the connected account and the freelancer configures them in their own Dashboard). §6.2's list was an expectation; §3's filter governs | Owen Kessler, CTO |
| 6 | 2026-08-31 | **Join split into two tasks** (AS-49, AS-50) | AS-31 plan §6.2 said "Join (1 task)". §5.2's tripwire — a task that would need a board ask mid-flight gets the ask split out — governs, and §8.9's own definition of done names "automated tests **plus** one recorded manual run", i.e. two claims | Owen Kessler, CTO |
| 7 | 2026-08-31 | **17 tasks total (15 build + 2 asks)**, one over the AS-31 plan §6.1 band of 10–16 | Explained per §6.1's requirement. Arithmetic: 7 screens cannot compress below 4 UI tasks under the 600-line tripwire; the join split is forced by §5.2; the server fan is one task per chain link plus substrate. Also noted: §6.1's own composition (10–13 build + 1 stack + 2–3 asks = 13–17) is internally inconsistent with its stated 10–16 total at the top end | Owen Kessler, CTO |
| 8 | 2026-08-31 | OUT rows cite the **first** rule under strict ordering, which differs from the AS-31 plan §8 shorthand on rows C-42, C-43, C-47, C-48, C-53, C-57 | The verdicts are identical; only the citation moves. Strict ordering is what the review's re-derivation test applies, and a row whose stated rule does not reproduce would make the filter decoration | Owen Kessler, CTO |
