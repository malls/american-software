// lib/invoices/mapping.js — a Stripe invoice object mapped to the exact
// ten-key snapshot invoices.applyStripeSnapshot takes (AS-43, plan §3.6).
//
// ONE definition, TWO writers — the lib/connect/readiness.js precedent, one
// step down the chain. AS-43's finalize and send responses come through here;
// AS-44 imports this same function for `invoice.created` / `invoice.finalized`
// / `invoice.paid` / `invoice.voided` / `invoice.marked_uncollectible` /
// `invoice.payment_failed`, whose `data.object` IS an invoice object. That
// reuse is proven by test before AS-44 exists (test/invoices.test.js R1).
//
// THE TWO KEYS THIS FUNCTION MUST NEVER EMIT are `sentAt` and
// `lastPaymentFailedAt`. A Stripe invoice object carries neither (measured
// against stripe-mock v0.203.0 at 2026-08-26.dahlia while planning, and
// re-measured before implementation). If they were emitted as null, the next
// full snapshot — ours after send, or AS-44's on invoice.paid — would ERASE a
// recorded fact, because applyStripeSnapshot writes every key present. Each is
// written by its own writer at its own moment: `sentAt` by the lifecycle's
// step 5 from our clock, `lastPaymentFailedAt` by AS-44 from the failure event.
//
// Strict where Stripe is always present (`status`, the two amounts), tolerant
// where it may be absent (the two URLs, `due_date`, the whole
// `status_transitions` hash). A shape this app does not understand is a
// TypeError, surfaced as 502 by the route — never a guess, and never a silent
// null that would overwrite a good value.
//
// This module DECIDES NOTHING: it does not rank statuses, does not compare to
// the mirror, and does not know what `open` means. The state machine is AS-39's,
// in lib/db/repositories/invoices.js, and it is the only one.

/** The keys this mapper emits, in this order. The count is asserted against a
 *  committed literal in the test — cardinality before quantification. */
const SNAPSHOT_KEYS = Object.freeze([
  'status',
  'hostedInvoiceUrl',
  'invoicePdfUrl',
  'amountDueMinor',
  'amountPaidMinor',
  'dueAt',
  'finalizedAt',
  'paidAt',
  'voidedAt',
  'markedUncollectibleAt',
]);

export { SNAPSHOT_KEYS };

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Absent or null → null; a string → itself; anything else is a shape we do not
 *  understand. Stripe omits both URLs on a draft and fills them on finalize. */
function optionalUrl(value, field) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new TypeError(`invoice mapping: ${field} is not a string or null`);
  return value;
}

/** Stripe speaks minor units and so do we, so nothing is converted — but the
 *  value must really be an integer, or a float would reach a column declared
 *  INTEGER and the mirror would disagree with the invoice. */
function minorUnits(value, field) {
  if (!Number.isSafeInteger(value)) throw new TypeError(`invoice mapping: ${field} is not an integer of minor units`);
  return value;
}

/** Epoch seconds → ISO-8601 UTC with milliseconds, which is the ONE timestamp
 *  shape the database stores (AS-39's assertTimestamp). Absent or null stays
 *  null: a draft has no finalized_at, and that is a fact, not a failure.
 *
 *  EXPORTED for AS-44, which converts an event envelope's `created` with it.
 *  It stays here at two consumers, exactly as AS-43 kept resolveFreelancerId in
 *  routes/connect.js at two: the trigger to extract it to a shared module is a
 *  THIRD consumer, or any consumer outside lib/invoices/ and lib/webhooks/.
 *  Exporting a function adds no key to SNAPSHOT_KEYS — the ten-key contract is
 *  exactly as it shipped. */
export function isoFromEpochSeconds(value, field) {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value)) throw new TypeError(`invoice mapping: ${field} is not an epoch-seconds integer`);
  const at = new Date(value * 1000);
  if (Number.isNaN(at.getTime())) throw new TypeError(`invoice mapping: ${field} is not a representable date`);
  return at.toISOString();
}

/**
 * @param {object} invoice a Stripe invoice object — a finalize response, a send
 *   response, or an `invoice.*` event's `data.object`
 * @returns {{ status: string, hostedInvoiceUrl: string|null, invoicePdfUrl: string|null,
 *   amountDueMinor: number, amountPaidMinor: number, dueAt: string|null,
 *   finalizedAt: string|null, paidAt: string|null, voidedAt: string|null,
 *   markedUncollectibleAt: string|null }} exactly SNAPSHOT_KEYS' shape
 */
export function invoiceSnapshotFromStripe(invoice) {
  if (!isPlainObject(invoice)) throw new TypeError('invoice mapping: expected a Stripe invoice object');
  if (typeof invoice.status !== 'string') {
    throw new TypeError('invoice mapping: invoice.status is not a string — not a shape this app understands');
  }
  const transitions = invoice.status_transitions;
  if (transitions !== undefined && transitions !== null && !isPlainObject(transitions)) {
    throw new TypeError('invoice mapping: invoice.status_transitions is not an object or null');
  }
  const at = (field) => isoFromEpochSeconds(transitions?.[field], `status_transitions.${field}`);
  return {
    // Verbatim: ranking it is applyStripeSnapshot's job, and only its job.
    status: invoice.status,
    hostedInvoiceUrl: optionalUrl(invoice.hosted_invoice_url, 'hosted_invoice_url'),
    // The rename AS-39's assertKnownKeys exists to catch: invoice_pdf, not
    // invoice_pdf_url, on Stripe's side.
    invoicePdfUrl: optionalUrl(invoice.invoice_pdf, 'invoice_pdf'),
    amountDueMinor: minorUnits(invoice.amount_due, 'amount_due'),
    amountPaidMinor: minorUnits(invoice.amount_paid, 'amount_paid'),
    dueAt: isoFromEpochSeconds(invoice.due_date, 'due_date'),
    finalizedAt: at('finalized_at'),
    paidAt: at('paid_at'),
    voidedAt: at('voided_at'),
    markedUncollectibleAt: at('marked_uncollectible_at'),
  };
}
