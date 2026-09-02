// lib/db/repositories/invoices.js — the local draft and the mirror of Stripe's
// invoice (AS-39, plan §2.5).
//
// Two halves with one row. Until AS-43 hands the draft to Stripe it is LOCAL:
// client, days until due and line items are edited here. attachStripeInvoice
// freezes it (finalization in progress), and from then on every status and
// every Stripe-side field arrives through applyStripeSnapshot — the only writer
// of `status` after creation, and the state machine in this file. Owner-scoped
// like clients; the Stripe-keyed lookups take no owner because their caller is
// a webhook with no session.
import { transaction } from '../connection.js';
import {
  mapSqliteError,
  InvalidStateError,
  NotFoundError,
  ValidationError,
  assertKnownKeys,
  assertOptionalText,
  assertOptionalTimestamp,
  assertStripeId,
  assertText,
} from '../errors.js';
import { DEFAULT_CURRENCY, assertMinorUnits, assertPositiveInteger, assertSupportedCurrency } from '../money.js';
import { assertOwnedClient } from './clients.js';

/** Stripe's documented invoice transitions as a rank: every allowed transition
 *  goes UP (draft→open, open→paid|void|uncollectible, uncollectible→paid|void),
 *  and the one same-rank pair — paid, void — is the one pair with no transition
 *  between them. Skip-ahead is just "up in rank", which is what lets a `paid`
 *  event that arrives before `finalized` converge (plan §2.5). */
const STATUS_RANK = Object.freeze({ draft: 0, open: 1, uncollectible: 2, paid: 3, void: 3 });

/** Snapshot key → column. Mapping a Stripe invoice object onto these keys
 *  (epoch seconds → ISO, invoice_pdf → invoicePdfUrl) is AS-43/AS-44's job. */
const SNAPSHOT_COLUMNS = Object.freeze({
  hostedInvoiceUrl: 'hosted_invoice_url',
  invoicePdfUrl: 'invoice_pdf_url',
  amountDueMinor: 'amount_due_minor',
  amountPaidMinor: 'amount_paid_minor',
  dueAt: 'due_at',
  finalizedAt: 'finalized_at',
  sentAt: 'sent_at',
  paidAt: 'paid_at',
  voidedAt: 'voided_at',
  markedUncollectibleAt: 'marked_uncollectible_at',
  lastPaymentFailedAt: 'last_payment_failed_at',
});
const SNAPSHOT_KEYS = Object.freeze(['status', ...Object.keys(SNAPSHOT_COLUMNS)]);
const SNAPSHOT_VALIDATORS = Object.freeze({
  hostedInvoiceUrl: assertOptionalText,
  invoicePdfUrl: assertOptionalText,
  amountDueMinor: assertOptionalMinorUnits,
  amountPaidMinor: assertOptionalMinorUnits,
  dueAt: assertOptionalTimestamp,
  finalizedAt: assertOptionalTimestamp,
  sentAt: assertOptionalTimestamp,
  paidAt: assertOptionalTimestamp,
  voidedAt: assertOptionalTimestamp,
  markedUncollectibleAt: assertOptionalTimestamp,
  lastPaymentFailedAt: assertOptionalTimestamp,
});

const DRAFT_KEYS = Object.freeze(['clientId', 'daysUntilDue', 'lineItems']);
const LINE_ITEM_KEYS = Object.freeze(['description', 'quantity', 'unitAmountMinor']);

// totalMinor is derived on every read, never stored: the line items are the
// truth and a stored total is a second copy that can disagree with them.
const SELECT =
  'SELECT i.*, (SELECT COALESCE(SUM(quantity * unit_amount_minor), 0) FROM invoice_line_items WHERE invoice_id = i.id) AS total_minor ' +
  'FROM invoices i';
const SELECT_LINE_ITEMS =
  'SELECT id, position, description, quantity, unit_amount_minor FROM invoice_line_items WHERE invoice_id = ? ORDER BY position';

function mapSummary(row) {
  return {
    id: row.id,
    freelancerId: row.freelancer_id,
    clientId: row.client_id,
    status: row.status,
    currency: row.currency,
    daysUntilDue: row.days_until_due,
    stripeInvoiceId: row.stripe_invoice_id,
    hostedInvoiceUrl: row.hosted_invoice_url,
    invoicePdfUrl: row.invoice_pdf_url,
    amountDueMinor: row.amount_due_minor,
    amountPaidMinor: row.amount_paid_minor,
    dueAt: row.due_at,
    finalizedAt: row.finalized_at,
    sentAt: row.sent_at,
    paidAt: row.paid_at,
    voidedAt: row.voided_at,
    markedUncollectibleAt: row.marked_uncollectible_at,
    lastPaymentFailedAt: row.last_payment_failed_at,
    totalMinor: row.total_minor,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapLineItem(row) {
  return {
    id: row.id,
    position: row.position,
    description: row.description,
    quantity: row.quantity,
    unitAmountMinor: row.unit_amount_minor,
  };
}

function withLineItems(db, row) {
  return { ...mapSummary(row), lineItems: db.prepare(SELECT_LINE_ITEMS).all(row.id).map(mapLineItem) };
}

function assertOptionalMinorUnits(value, field) {
  return value === null ? null : assertMinorUnits(value, field);
}

/** Returns the validated items in order; positions are their indexes. */
function validateLineItems(lineItems) {
  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    throw new ValidationError('lineItems', 'must be a non-empty array');
  }
  return lineItems.map((item, index) => {
    const field = `lineItems[${index}]`;
    assertKnownKeys(item, LINE_ITEM_KEYS, field);
    return {
      description: assertText(item.description, `${field}.description`),
      quantity: assertPositiveInteger(item.quantity, `${field}.quantity`),
      unitAmountMinor: assertMinorUnits(item.unitAmountMinor, `${field}.unitAmountMinor`),
    };
  });
}

function insertLineItems(db, { newId }, invoiceId, items) {
  const insert = db.prepare(
    'INSERT INTO invoice_line_items (id, invoice_id, position, description, quantity, unit_amount_minor) VALUES (?, ?, ?, ?, ?, ?)',
  );
  items.forEach((item, position) => {
    insert.run(newId(), invoiceId, position, item.description, item.quantity, item.unitAmountMinor);
  });
}

function readOwned(db, freelancerId, id) {
  assertText(freelancerId, 'freelancerId');
  assertText(id, 'id');
  const row = db.prepare(`${SELECT} WHERE i.freelancer_id = ? AND i.id = ?`).get(freelancerId, id);
  if (row === undefined) throw new NotFoundError('invoice', id);
  return withLineItems(db, row);
}

function createDraft(db, ctx, freelancerId, input) {
  assertText(freelancerId, 'freelancerId');
  assertKnownKeys(input, [...DRAFT_KEYS, 'currency'], 'invoice');
  const clientId = assertText(input.clientId, 'clientId');
  const daysUntilDue = assertPositiveInteger(input.daysUntilDue, 'daysUntilDue');
  const currency = assertSupportedCurrency(input.currency === undefined ? DEFAULT_CURRENCY : input.currency);
  const lineItems = validateLineItems(input.lineItems);
  return transaction(db, () => {
    assertOwnedClient(db, freelancerId, clientId);
    const id = ctx.newId();
    const at = ctx.now();
    try {
      db.prepare(
        'INSERT INTO invoices (id, freelancer_id, client_id, currency, days_until_due, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(id, freelancerId, clientId, currency, daysUntilDue, at, at);
      insertLineItems(db, ctx, id, lineItems);
    } catch (err) {
      throw mapSqliteError(err);
    }
    return readOwned(db, freelancerId, id);
  });
}

/** Newest first. Summaries carry totalMinor but not the line items. */
function listByFreelancer(db, freelancerId) {
  assertText(freelancerId, 'freelancerId');
  return db
    .prepare(`${SELECT} WHERE i.freelancer_id = ? ORDER BY i.created_at DESC, i.rowid DESC`)
    .all(freelancerId)
    .map(mapSummary);
}

function updateDraft(db, ctx, freelancerId, id, patch) {
  assertKnownKeys(patch, DRAFT_KEYS, 'invoice');
  const validated = {
    clientId: patch.clientId === undefined ? undefined : assertText(patch.clientId, 'clientId'),
    daysUntilDue: patch.daysUntilDue === undefined ? undefined : assertPositiveInteger(patch.daysUntilDue, 'daysUntilDue'),
    lineItems: patch.lineItems === undefined ? undefined : validateLineItems(patch.lineItems),
  };
  if (Object.values(validated).every((value) => value === undefined)) {
    throw new ValidationError('invoice', 'nothing to update');
  }
  return transaction(db, () => applyDraftPatch(db, ctx, freelancerId, id, validated));
}

function applyDraftPatch(db, ctx, freelancerId, id, { clientId, daysUntilDue, lineItems }) {
  const row = readOwned(db, freelancerId, id);
  assertEditableDraft(row);
  const assignments = [];
  const values = [];
  if (clientId !== undefined) {
    assertOwnedClient(db, freelancerId, clientId);
    assignments.push('client_id = ?');
    values.push(clientId);
  }
  if (daysUntilDue !== undefined) {
    assignments.push('days_until_due = ?');
    values.push(daysUntilDue);
  }
  assignments.push('updated_at = ?');
  values.push(ctx.now());
  try {
    if (lineItems !== undefined) {
      // Replaced as a set, inside the caller's transaction: the old positions
      // are gone before the new ones land, so (invoice_id, position) never collides.
      db.prepare('DELETE FROM invoice_line_items WHERE invoice_id = ?').run(id);
      insertLineItems(db, ctx, id, lineItems);
    }
    db.prepare(`UPDATE invoices SET ${assignments.join(', ')} WHERE id = ?`).run(...values, id);
  } catch (err) {
    throw mapSqliteError(err);
  }
  return readOwned(db, freelancerId, id);
}

/** Draft-side fields are writable only while the draft is LOCAL: status draft
 *  and no Stripe invoice attached. Once attached, finalization is in progress
 *  and the local copy is frozen (plan §2.5). */
function assertEditableDraft(row) {
  if (row.status !== 'draft' || row.stripeInvoiceId !== null) {
    const attached = row.stripeInvoiceId === null ? '' : ` with Stripe invoice ${row.stripeInvoiceId} attached`;
    throw new InvalidStateError(`invoice ${row.id} is ${row.status}${attached}; only a local draft can be edited`);
  }
}

/** Set once, after AS-43's POST /v1/invoices. Its own state check rather than
 *  the draft one above: the failure it names is "already attached". */
function attachStripeInvoice(db, ctx, freelancerId, id, stripeInvoiceId) {
  assertStripeId(stripeInvoiceId, 'stripeInvoiceId', 'in_');
  return transaction(db, () => {
    const current = readOwned(db, freelancerId, id);
    if (current.status !== 'draft' || current.stripeInvoiceId !== null) {
      throw new InvalidStateError(`invoice ${id} already has Stripe invoice ${current.stripeInvoiceId} attached`);
    }
    try {
      db.prepare('UPDATE invoices SET stripe_invoice_id = ?, updated_at = ? WHERE id = ?').run(stripeInvoiceId, ctx.now(), id);
    } catch (err) {
      throw mapSqliteError(err);
    }
    return readOwned(db, freelancerId, id);
  });
}

function getByStripeInvoiceId(db, stripeInvoiceId) {
  assertText(stripeInvoiceId, 'stripeInvoiceId');
  const row = db.prepare(`${SELECT} WHERE i.stripe_invoice_id = ?`).get(stripeInvoiceId);
  return row === undefined ? null : withLineItems(db, row);
}

/**
 * Bring the mirror up to date with what Stripe says about the invoice, in rank
 * order (plan §2.5):
 *
 *   incoming > current            applied   status + the snapshot's fields + updated_at
 *   equal, same status            fields    the snapshot's fields + updated_at
 *   equal, different (paid/void)  conflict  nothing — returned, not thrown (§8 Q6)
 *   incoming < current            stale     nothing — an older snapshot never overwrites a newer one
 *
 * Every field validates before the transaction opens; an unknown key or an
 * unknown status is a ValidationError, so a misspelled key cannot be dropped.
 */
function applyStripeSnapshot(db, ctx, stripeInvoiceId, snapshot) {
  assertText(stripeInvoiceId, 'stripeInvoiceId');
  assertKnownKeys(snapshot, SNAPSHOT_KEYS, 'snapshot');
  const to = snapshot.status;
  if (typeof to !== 'string' || !Object.hasOwn(STATUS_RANK, to)) {
    throw new ValidationError('snapshot.status', `unknown status; known: ${Object.keys(STATUS_RANK).join(', ')}`);
  }
  const fields = Object.keys(snapshot)
    .filter((key) => key !== 'status')
    .map((key) => [SNAPSHOT_COLUMNS[key], SNAPSHOT_VALIDATORS[key](snapshot[key], `snapshot.${key}`)]);
  return transaction(db, () => applySnapshot(db, ctx, stripeInvoiceId, to, fields));
}

function applySnapshot(db, ctx, stripeInvoiceId, to, fields) {
  const current = db.prepare(`${SELECT} WHERE i.stripe_invoice_id = ?`).get(stripeInvoiceId);
  if (current === undefined) throw new NotFoundError('invoice', stripeInvoiceId);
  const from = current.status;
  const currentRank = STATUS_RANK[from];
  const incomingRank = STATUS_RANK[to];
  const outcome = (kind) => ({ outcome: kind, from, to, invoice: getByStripeInvoiceId(db, stripeInvoiceId) });
  if (incomingRank < currentRank) return outcome('stale');
  if (incomingRank === currentRank && from !== to) return outcome('conflict');
  const assignments = fields.map(([column]) => `${column} = ?`);
  const values = fields.map(([, value]) => value);
  if (from !== to) {
    assignments.push('status = ?');
    values.push(to);
  }
  assignments.push('updated_at = ?');
  values.push(ctx.now());
  try {
    db.prepare(`UPDATE invoices SET ${assignments.join(', ')} WHERE stripe_invoice_id = ?`).run(...values, stripeInvoiceId);
  } catch (err) {
    throw mapSqliteError(err);
  }
  return outcome(from === to ? 'fields' : 'applied');
}

export function createInvoicesRepository(db, ctx) {
  return Object.freeze({
    createDraft: (freelancerId, input) => createDraft(db, ctx, freelancerId, input),
    getById: (freelancerId, id) => readOwned(db, freelancerId, id),
    listByFreelancer: (freelancerId) => listByFreelancer(db, freelancerId),
    updateDraft: (freelancerId, id, patch) => updateDraft(db, ctx, freelancerId, id, patch),
    attachStripeInvoice: (freelancerId, id, stripeInvoiceId) => attachStripeInvoice(db, ctx, freelancerId, id, stripeInvoiceId),
    getByStripeInvoiceId: (stripeInvoiceId) => getByStripeInvoiceId(db, stripeInvoiceId),
    applyStripeSnapshot: (stripeInvoiceId, snapshot) => applyStripeSnapshot(db, ctx, stripeInvoiceId, snapshot),
  });
}
