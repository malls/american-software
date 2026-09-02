// lib/invoices/lifecycle.js — chain link 4's service: the five Stripe calls,
// the readiness gate, the lazy customer, the resumable push pipeline and the
// total reconciliation (AS-43, plan §3.3–§3.8).
//
// THE ONLY FILE IN THIS TASK THAT CALLS STRIPE. routes/invoices.js translates
// HTTP to these two entry points and error classes to statuses; it never builds
// a request. Every call here is connected-scope — it declares the freelancer's
// acct_ and never declares platform — so lib/stripe/custody.js refuses it before
// the key is read if either half of that is ever untrue. That is enforcement,
// not discipline: `missing_account` and `unexpected_platform` are thrown by the
// guard, upstream of requireKey and upstream of the transport.
//
// FIVE POSTS, ZERO GETS (plan §3.5). Calls 4 and 5 each return the full invoice
// object, so a read after them would add a round trip and no information;
// GET /v1/invoices/{id} is on the allowlist and this task deliberately does not
// use it.
//
// THE PIPELINE IS RESUMABLE. Every step is skipped when the mirror already
// records it done, so re-submitting the form after a failure completes the run
// instead of duplicating Stripe objects:
//
//   gate    account.ready                                   else 403
//   state   invoice.status in {draft, open}                  else 409
//   step 1  ensureCustomer   skip if client.stripeCustomerId !== null
//   step 2  ensureInvoice    skip if invoice.stripeInvoiceId !== null
//   step 3  pushLineItems    skip if invoice.status !== 'draft'
//   step 4  finalize         skip if invoice.status !== 'draft'  -> reconcile -> snapshot
//   --------------------- finalize() stops here ---------------------
//   step 5  send             skip if invoice.sentAt !== null      -> snapshot + sentAt
//
// Steps 3 and 4 share a predicate on purpose: a process that died after the
// invoice was attached but before every item was pushed would otherwise finalize
// a short invoice on retry. Re-pushing every item is safe because each carries
// the stable key `ii-create-<lineItemId>` — inside Stripe's idempotency window a
// replay returns the existing item and creates nothing — and reconcile() below
// is the backstop if that window ever lapses.
//
// THIS TASK WRITES ONLY `draft` AND `open`. paid, void, uncollectible and
// lastPaymentFailedAt are AS-44's, from invoice.* events. Both sides write
// through invoices.applyStripeSnapshot, the sole writer of status, so a paid
// webhook that overtakes our finalize snapshot converges by rank with no
// coordination between us (plan §3.10).
import { InvalidStateError, ValidationError } from '../db/database.js';
import { invoiceSnapshotFromStripe } from './mapping.js';

/** The freelancer cannot issue yet: no connected account, or one that is not
 *  ready. A PERMISSION they do not have (403), distinct from the resource's own
 *  state (409) — distinct status, distinct class, distinct step. `step` is the
 *  reason, so the route's one-line body reads `AccountNotReadyError: not-ready`
 *  without the route knowing anything about readiness. */
export class AccountNotReadyError extends Error {
  constructor(reason) {
    super(`connected account is ${reason}`);
    this.name = 'AccountNotReadyError';
    this.reason = reason;
    this.step = reason;
  }
}

/** Stripe finalized the invoice, and what it says the client owes is not what
 *  our line items say. The send does NOT happen (plan §3.7). Resolution belongs
 *  to the freelancer in their own Stripe Dashboard: voiding from our side would
 *  need an allowlist row this task deliberately does not add. */
export class AmountMismatchError extends Error {
  constructor({ ours, theirs }) {
    super(`Stripe finalized ${theirs.total} ${theirs.currency}; our line items total ${ours.total} ${ours.currency}`);
    this.name = 'AmountMismatchError';
    this.ours = ours;
    this.theirs = theirs;
    this.step = 'reconcile';
  }
}

/** Name the failed step on the way out, so the route's one-line error body can
 *  say WHICH Stripe interaction failed. The client's error types carry no
 *  request material, and neither does this. (The lib/connect/onboarding.js
 *  precedent, deliberately identical.) */
async function labelled(step, work) {
  try {
    return await work();
  } catch (err) {
    if (err !== null && typeof err === 'object' && err.step === undefined) err.step = step;
    throw err;
  }
}

/**
 * @param {{ repos: object, stripe: { request: Function }, now?: () => string }} deps
 *   `repos` is createRepositories()'s object; `stripe` is a createStripeClient()
 *   client; `now` is the clock that stamps `sentAt` — ours, never Stripe's.
 * @returns {{ finalize: Function, send: Function }} each takes
 *   (freelancerId, invoiceId) and resolves to the updated mirror row.
 */
export function createInvoiceLifecycle({ repos, stripe, now = () => new Date().toISOString() } = {}) {
  if (repos === null || typeof repos !== 'object') throw new TypeError('invoices: repos is required');
  if (stripe === null || typeof stripe !== 'object' || typeof stripe.request !== 'function') {
    throw new TypeError('invoices: stripe must be a client exposing request()');
  }
  if (typeof now !== 'function') throw new TypeError('invoices: now must be a function');

  /**
   * The gate, in full (plan §3.4). `ready` is AS-39's ONE derivation, in the
   * connected-accounts row mapper, maintained by AS-41. This task READS it and
   * re-derives nothing: no file in this diff names any of the four underlying
   * readiness fields — not the two enablement booleans, not the
   * details-submitted flag, not the outstanding-requirements list. Grep proves
   * it, which is why they are not spelled out here either.
   * It fires before any Stripe call, which is what makes a refusal free.
   */
  function requireReadyAccount(freelancerId) {
    const row = repos.connectedAccounts.getByFreelancer(freelancerId);
    if (row === null) throw new AccountNotReadyError('not-connected');
    if (!row.ready) throw new AccountNotReadyError('not-ready');
    return row;
  }

  /** Step 1 — the lazy customer, three layers (the AS-41 create-or-reuse
   *  pattern, reused rather than reinvented).
   *  (i) row check: a client that is never invoiced leaves no trace on the
   *      freelancer's Stripe account;
   *  (ii) stable idempotency key: two concurrent finalizes both POST and Stripe
   *      returns the SAME cus_ to both;
   *  (iii) convergence on the loser's write: setStripeCustomerId is a no-op for
   *      the id it already holds, so the common double-submit simply succeeds.
   *      If the ids differ — the window lapsed mid-race — it throws, and we
   *      continue against the STORED cus_. The loser's customer is an inert
   *      object referenced by nothing.
   *  Stripe first, row after, so a refused create leaves nothing behind. */
  async function ensureCustomer(freelancerId, invoice, acct) {
    const client = repos.clients.getById(freelancerId, invoice.clientId);
    if (client.stripeCustomerId !== null) return client;
    const created = await labelled('create-customer', () => stripe.request({
      method: 'POST',
      path: '/v1/customers',
      account: acct,
      params: { email: client.email, name: client.name, metadata: { local_client_id: client.id } },
      idempotencyKey: `cus-create-${client.id}`,
    }));
    try {
      return repos.clients.setStripeCustomerId(freelancerId, client.id, created.data.id);
    } catch (err) {
      if (!(err instanceof InvalidStateError)) throw err;
      return repos.clients.getById(freelancerId, client.id);
    }
  }

  /** Step 2 — the same shape with one asymmetry: attachStripeInvoice throws for
   *  ANY second id including an identical one, unlike setStripeCustomerId. So
   *  the loser of a create race re-reads and continues against the stored in_;
   *  when the idempotency key did its job the stored id IS the one just
   *  received and the retry is free. When it is not, the orphan is a Stripe
   *  DRAFT invoice — never finalized, never sent, no money.
   *
   *  auto_advance:false at create is load-bearing, not decoration: without it
   *  an invoice we created but did not finalize can be finalized and emailed by
   *  Stripe about an hour later, on our behalf, with no action from us.
   *  pending_invoice_items_behavior:exclude keeps any stray pending item on the
   *  client — from an earlier failure, or made by the freelancer in their own
   *  Dashboard — off this invoice. */
  async function ensureInvoice(freelancerId, invoice, acct, client) {
    if (invoice.stripeInvoiceId !== null) return invoice;
    const created = await labelled('create-invoice', () => stripe.request({
      method: 'POST',
      path: '/v1/invoices',
      account: acct,
      params: {
        customer: client.stripeCustomerId,
        collection_method: 'send_invoice',
        days_until_due: invoice.daysUntilDue,
        currency: invoice.currency,
        auto_advance: false,
        pending_invoice_items_behavior: 'exclude',
        metadata: { local_invoice_id: invoice.id },
      },
      idempotencyKey: `inv-create-${invoice.id}`,
    }));
    try {
      return repos.invoices.attachStripeInvoice(freelancerId, invoice.id, created.data.id);
    } catch (err) {
      if (!(err instanceof InvalidStateError)) throw err;
      return repos.invoices.getById(freelancerId, invoice.id);
    }
  }

  /** Step 3 — one POST per line item, each naming the invoice explicitly.
   *
   *  THE INVOICE IS CREATED BEFORE ITS ITEMS, and that inversion is the point.
   *  Pending invoice items attach to the CUSTOMER, not to an invoice: a run
   *  that created items and then failed to create the invoice would leave them
   *  pending on that client, and Stripe would sweep them onto the next invoice
   *  for the same client — a cross-contaminated, over-charged invoice arriving
   *  days later. Clients are long-lived and reused here, so that is the normal
   *  case, not an edge. Naming the invoice removes the sweep from the trust
   *  surface entirely; the endpoints and their connected scoping are unchanged.
   *
   *  We send the EXTENDED amount we computed ourselves, never a unit price:
   *  unit_amount does not exist on this endpoint at this API version (400,
   *  "additional properties are not allowed" — measured against stripe-mock
   *  v0.203.0). Nothing then depends on Stripe's multiplication semantics, and
   *  Stripe's answer after finalize must equal our own total by construction —
   *  which reconcile() checks rather than assumes. */
  async function pushLineItems(invoice, acct, client) {
    for (const item of invoice.lineItems) {
      const extended = item.quantity * item.unitAmountMinor;
      if (!Number.isSafeInteger(extended)) {
        throw new ValidationError(`lineItems[${item.position}]`, 'quantity times unit price is not a representable integer');
      }
      await labelled('push-line-item', () => stripe.request({
        method: 'POST',
        path: '/v1/invoiceitems',
        account: acct,
        params: {
          customer: client.stripeCustomerId,
          invoice: invoice.stripeInvoiceId,
          currency: invoice.currency,
          amount: extended,
          description: item.description,
          metadata: { local_line_item_id: item.id },
        },
        idempotencyKey: `ii-create-${item.id}`,
      }));
    }
  }

  /** Step 4 — finalize, then reconcile, then hand back the updated mirror.
   *
   *  auto_advance:false again: the invoice is emailed exactly once, by our
   *  explicit call 5. Leaving Stripe's automatic collection on risks a second
   *  email and makes "who sent this" ambiguous in a v1 whose whole email story
   *  is "Stripe does it, once". The cost is that Stripe's reminder cadence does
   *  not run — reminders are out of v1, and flipping this is one parameter. */
  async function finalizeInvoice(invoice, acct) {
    const response = await labelled('finalize', () => stripe.request({
      method: 'POST',
      path: `/v1/invoices/${invoice.stripeInvoiceId}/finalize`,
      account: acct,
      params: { auto_advance: false },
      idempotencyKey: `inv-finalize-${invoice.id}`,
    }));
    // ORDER IS DECIDED (plan §3.7): write the snapshot FIRST, then refuse.
    // Stripe really did finalize this invoice; a mirror that still said draft
    // would be a lie, and AS-39's whole discipline is that it never guesses.
    const updated = writeSnapshot(invoice.stripeInvoiceId, invoiceSnapshotFromStripe(response.data));
    reconcile(invoice, response.data);
    return updated;
  }

  /** The guard this task introduces. Step 3 re-pushes items on a retry and
   *  leans on Stripe's idempotency window to deduplicate them; this is the
   *  assertion that says so out loud. If a duplicate item ever lands, if a
   *  pending item is swept in despite `exclude`, or if a quantity is multiplied
   *  twice, the totals diverge and we find out BEFORE the client is emailed a
   *  wrong invoice. One comparison; a silent money bug becomes a loud refusal. */
  function reconcile(invoice, stripeInvoice) {
    if (stripeInvoice.currency === invoice.currency && stripeInvoice.amount_due === invoice.totalMinor) return;
    throw new AmountMismatchError({
      ours: { total: invoice.totalMinor, currency: invoice.currency },
      theirs: { total: stripeInvoice.amount_due, currency: stripeInvoice.currency },
    });
  }

  /** Step 5 — Stripe emails the client, under the freelancer's own branding, on
   *  Stripe's sender infrastructure. A no-op once sentAt is recorded, which is
   *  what keeps retry-safety from quietly becoming a manual re-send feature;
   *  the stable key closes the rest of the hole, so a send that succeeded at
   *  Stripe but died before the mirror write is a replay, not a second email. */
  async function sendInvoice(invoice, acct) {
    const response = await labelled('send', () => stripe.request({
      method: 'POST',
      path: `/v1/invoices/${invoice.stripeInvoiceId}/send`,
      account: acct,
      params: {},
      idempotencyKey: `inv-send-${invoice.id}`,
    }));
    // OUR observation LAST. sentAt is not a Stripe field (a Stripe invoice
    // object has none — measured), so the mapper must never emit it; spreading
    // ours after the mapper's output means that even if the mapper one day
    // grows the key it should not have, it cannot erase this write.
    return writeSnapshot(invoice.stripeInvoiceId, { ...invoiceSnapshotFromStripe(response.data), sentAt: now() });
  }

  /** applyStripeSnapshot's four outcomes, handled per plan §3.10: `applied` and
   *  `fields` are the normal results; `stale` means a webhook already moved the
   *  mirror past what we were about to write, which is benign and logged rather
   *  than raised; `conflict` (paid vs void) is unreachable from writes that only
   *  ever carry draft or open, and is treated the same way if it ever appears. */
  function writeSnapshot(stripeInvoiceId, snapshot) {
    const result = repos.invoices.applyStripeSnapshot(stripeInvoiceId, snapshot);
    if (result.outcome === 'stale' || result.outcome === 'conflict') {
      console.warn(`invoice ${stripeInvoiceId}: snapshot ${result.outcome} (mirror ${result.from}, ours ${result.to}) — the mirror is already ahead`);
    }
    return result.invoice;
  }

  /** finalize() runs steps 1-4; send() runs 1-5. One pipeline, one flag: the
   *  wireframe's screen 4 has ONE control and a browser form issues one POST,
   *  so send simply does not stop early. Every step is skipped when the mirror
   *  records it done, which is what lets the two compose without a third route. */
  async function run(freelancerId, invoiceId, { through }) {
    const acct = requireReadyAccount(freelancerId).stripeAccountId;
    let invoice = repos.invoices.getById(freelancerId, invoiceId);
    if (invoice.status !== 'draft' && invoice.status !== 'open') {
      throw new InvalidStateError(`invoice ${invoice.id} is ${invoice.status}; only a draft or open invoice can be issued`);
    }
    const client = await ensureCustomer(freelancerId, invoice, acct);
    invoice = await ensureInvoice(freelancerId, invoice, acct, client);
    if (invoice.status === 'draft') {
      await pushLineItems(invoice, acct, client);
      invoice = await finalizeInvoice(invoice, acct);
    }
    if (through === 'send' && invoice.sentAt === null) {
      invoice = await sendInvoice(invoice, acct);
    }
    return invoice;
  }

  return Object.freeze({
    finalize: (freelancerId, invoiceId) => run(freelancerId, invoiceId, { through: 'finalize' }),
    send: (freelancerId, invoiceId) => run(freelancerId, invoiceId, { through: 'send' }),
  });
}
