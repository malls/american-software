// lib/screens/invoice-detail-view.js — screen 5's PURE view model (AS-48, plan
// §3.2, §3.4, §3.5, §4).
//
// The connect-view.js shape: (a) the ledger, transcribed from
// docs/design/wireframes/02-states-ledger.md §5, (b) the closed status-to-badge
// table every invoice row in the app renders through — the Dashboard imports
// it from here so the list and the detail cannot disagree — and (c) a pure
// function from route inputs to template locals. No I/O, no clock, no req, no
// res. The route reads the mirror row, the client and the connected-account
// row and hands them here; everything a person sees is decided in this file
// and the template only reads properties.
//
// THE SCREEN READS THE MIRROR AND NEVER CALLS STRIPE (plan decision 3). Status,
// the two hosted URLs, the due and paid dates all arrive from the row the
// webhook receiver maintains; "stale during the webhook interval" is the
// ledger's own note on S5-DEFAULT-OPEN, not a state this screen can detect.
//
// THIS FILE IS A HUMAN <-> MINOR-UNITS BOUNDARY, on the `'money
// representation'` row of test/dependency-policy.test.js for that reason
// (plan §4): it reads the row's total and currency and is the one caller of
// money.js's display formatter on this screen. The template carries the
// label as a local (`totalLabel`) and measures zero hits on the row's words.
//
// EVERY STRING BELOW IS A RENDERER-AUTHORED CONSTANT selected by a closed
// enum, with these data exceptions, all reaching the template as element
// content or a double-quoted value= (escaped by EJS): the client's name in the
// title, the formatted total, the two formatted dates, the two Stripe URLs as
// TEXT (never an href — plan §3.4 says why), and the invoice id in exactly one
// hidden input, the send form's. The `?error` flag's VALUE never arrives: the
// route passes a boolean.
import { formatDisplayMinorUnits } from '../db/money.js';
import { formatDate } from './dates.js';

/** Screen 5's ledger, all ten rows, each with what this app does about it. The
 *  same R-4 caveat as CONNECT_LEDGER: this list and the table in
 *  test/read-screens.test.js are two independent hand transcriptions compared
 *  against each other; fidelity to the document is a dated review act (all ten
 *  rows transcribed from §5 on 2026-09-12 by agent:developer-marcus).
 *  Dispositions (plan §3.7): `rendered` rows are the members of
 *  INVOICE_DETAIL_STATES; `rendered as S5-ERROR-NOTFOUND` is the ledger's own
 *  security decision — a not-owned id and a missing one are the SAME
 *  NotFoundError from the repository, so the two renders are byte-identical by
 *  construction, not by a second check; `redirect-answered` is the guard's
 *  303; `unrenderable — browser-supplied` needs client-side JavaScript this
 *  app does not have; `n/a` is the ledger's own "n/a — because" row. */
export const INVOICE_DETAIL_LEDGER = Object.freeze([
  Object.freeze({ id: 'S5-DEFAULT-DRAFT', disposition: 'rendered' }),
  Object.freeze({ id: 'S5-DEFAULT-OPEN', disposition: 'rendered' }),
  Object.freeze({ id: 'S5-DEFAULT-PAID', disposition: 'rendered' }),
  Object.freeze({ id: 'S5-LOADING', disposition: 'unrenderable — browser-supplied' }),
  Object.freeze({ id: 'S5-EMPTY', disposition: 'n/a' }),
  Object.freeze({ id: 'S5-ERROR-NOTFOUND', disposition: 'rendered' }),
  Object.freeze({ id: 'S5-ERROR-SYSTEM', disposition: 'rendered' }),
  Object.freeze({ id: 'S5-DENIED-SIGNEDOUT', disposition: 'redirect-answered' }),
  Object.freeze({ id: 'S5-DENIED-NOTOWNER', disposition: 'rendered as S5-ERROR-NOTFOUND' }),
  Object.freeze({ id: 'S5-ABANDON', disposition: 'n/a' }),
]);

/** The states this screen renders; `data-state` on the root element is always
 *  a member. Void, uncollectible and finalized-but-unsent rows are NOT states:
 *  they render inside S5-DEFAULT-OPEN with their own badge (plan §11 Q1). */
export const INVOICE_DETAIL_STATES = Object.freeze(
  INVOICE_DETAIL_LEDGER.filter((row) => row.disposition === 'rendered').map((row) => row.id),
);

/** The HTTP status each rendered state answers with (plan §3.2). */
export const STATE_STATUS = Object.freeze({
  'S5-DEFAULT-DRAFT': 200,
  'S5-DEFAULT-OPEN': 200,
  'S5-DEFAULT-PAID': 200,
  'S5-ERROR-NOTFOUND': 404,
  'S5-ERROR-SYSTEM': 500,
});

/** THE ONE STATUS-TO-BADGE TABLE (plan §3.4). Keyed by the mirror's five
 *  statuses — exactly the keys of STATUS_RANK in the invoices repository — and
 *  closed: badgeFor throws on a sixth, because the mirror's state machine
 *  admits five and a sixth is a bug, not a state. `tone` selects a CONSTANT
 *  class per branch in the templates, never an interpolated class name. */
export const STATUS_BADGES = Object.freeze({
  draft: Object.freeze({ label: 'Draft', tone: 'neutral' }),
  open: Object.freeze({ label: 'Sent — awaiting payment', tone: 'accent' }),
  paid: Object.freeze({ label: 'Paid', tone: 'success' }),
  void: Object.freeze({ label: 'Voided', tone: 'neutral' }),
  uncollectible: Object.freeze({ label: 'Marked uncollectible', tone: 'warning' }),
});

/** An `open` row the pipeline has finalized but not yet sent (AS-46 §3.4's
 *  hand-off): the mirror says open, `sentAt` is null. The one variant outside
 *  the five-key table. */
export const UNSENT_BADGE = Object.freeze({ label: 'Finalized — not yet sent', tone: 'accent' });

/** A client row that could not be joined — a defensive constant the Dashboard
 *  shares; on this screen the route treats a missing client as a system
 *  failure, so it renders here only if a caller hands a null client. */
export const UNKNOWN_CLIENT = 'Unknown client';

/**
 * The badge for a mirror row. Total over the five statuses; anything else
 * throws. Imported by dashboard-view.js so a list row and its detail page
 * cannot disagree about what a status is called.
 *
 * @param {{ status: string, sentAt: string | null }} invoice
 * @returns {{ label: string, tone: 'neutral' | 'accent' | 'success' | 'warning' }}
 */
export function badgeFor(invoice) {
  if (!Object.hasOwn(STATUS_BADGES, invoice.status)) {
    throw new TypeError(`badgeFor: unknown invoice status ${JSON.stringify(invoice.status)}; known: ${Object.keys(STATUS_BADGES).join(', ')}`);
  }
  if (invoice.status === 'open' && invoice.sentAt === null) return UNSENT_BADGE;
  return STATUS_BADGES[invoice.status];
}

/** Copy, verbatim from docs/design/wireframes/screen-5-invoice-detail.html
 *  where it supplies it. The send-failure sentence is this task's (the
 *  wireframe has no row for a failed send from this screen; plan decision 4). */
const COPY = Object.freeze({
  titlePrefix: 'Invoice to ',
  totalLabel: 'Amount',
  dueOnceSentBefore: 'Due in ',
  dueOnceSentAfter: ' days once sent',
  duePrefix: 'Due ',
  paidInFull: 'paid in full',
  paidOnPrefix: 'paid in full on ',
  notFoundTitle: 'Invoice not found',
  notFoundMessage: "We couldn't find that invoice.",
  systemTitle: "Couldn't load this invoice",
  systemMessage: 'Something went wrong loading this invoice.',
  sendFailedMessage: 'Something went wrong sending this invoice. Nothing was sent to the client — try again.',
  finalizeAndSend: 'Finalize & send',
  send: 'Send',
});

/** THE ONE PLACE THE STATE IS DECIDED. Total over (invoice, failure), in the
 *  precedence the plan states (§3.2): a failure outranks the row it could not
 *  load, paid outranks attached, attached outranks draft. Recipe F13 reorders
 *  rows 1-3 and expects a paid row with a failure set to render PAID. */
function selectState(invoice, failure) {
  if (failure === 'not-found') return 'S5-ERROR-NOTFOUND';
  if (failure === 'system') return 'S5-ERROR-SYSTEM';
  if (invoice === null) return 'S5-ERROR-NOTFOUND';
  if (invoice.status === 'paid') return 'S5-DEFAULT-PAID';
  if (invoice.stripeInvoiceId !== null) return 'S5-DEFAULT-OPEN';
  return 'S5-DEFAULT-DRAFT';
}

/**
 * Route inputs -> template locals. Pure.
 *
 * @param {{
 *   invoice?: object | null,      the invoices repository row (summary or full); null with a failure
 *   client?: { name: string } | null,
 *   account?: { ready: boolean } | null,   `ready` is READ, never re-derived
 *   failure?: 'not-found' | 'system' | null,
 *   sendFailed?: boolean,        a presence flag the route derived; the value never arrives
 * }} [input]
 * @returns {object} the template's locals, plus `status`. Not frozen — express
 *   adds `_locals` to the object it is handed (the connect-view.js note).
 */
export function invoiceDetailLocals(input = {}) {
  const invoice = input.invoice ?? null;
  const client = input.client ?? null;
  const account = input.account ?? null;
  const failure = input.failure ?? null;
  const sendFailed = input.sendFailed === true;
  const state = selectState(invoice, failure);
  const stripeReady = account !== null && account.ready === true;

  const isNotFound = state === 'S5-ERROR-NOTFOUND';
  const isSystem = state === 'S5-ERROR-SYSTEM';
  const isPaid = state === 'S5-DEFAULT-PAID';
  const isDraft = state === 'S5-DEFAULT-DRAFT';
  const isOpen = state === 'S5-DEFAULT-OPEN';
  const rendersRow = isPaid || isDraft || isOpen;

  let title;
  if (isNotFound) title = COPY.notFoundTitle;
  else if (isSystem) title = COPY.systemTitle;
  else title = `${COPY.titlePrefix}${client === null ? UNKNOWN_CLIENT : client.name}`;

  // Sendable: a local draft (the pipeline from the top) or an attached row the
  // pipeline has not yet sent (a resume) — never a paid, voided or
  // uncollectible one, and only when the account is ready (plan §3.5). The
  // control's absence when unready is what case 15 and recipe F6 pin.
  const sendable = rendersRow && !isPaid && invoice.sentAt === null && (invoice.status === 'draft' || invoice.status === 'open');
  const canSend = sendable && stripeReady;

  let dueText = null;
  if (isDraft) dueText = `${COPY.dueOnceSentBefore}${invoice.daysUntilDue}${COPY.dueOnceSentAfter}`;
  else if (isOpen && invoice.dueAt !== null) dueText = `${COPY.duePrefix}${formatDate(invoice.dueAt)}`;

  let paidText = null;
  if (isPaid) paidText = invoice.paidAt === null ? COPY.paidInFull : `${COPY.paidOnPrefix}${formatDate(invoice.paidAt)}`;

  const hostedInvoiceUrl = rendersRow ? invoice.hostedInvoiceUrl ?? null : null;
  const invoicePdfUrl = rendersRow ? invoice.invoicePdfUrl ?? null : null;

  return {
    state,
    status: STATE_STATUS[state],
    title,
    isNotFound,
    isSystem,
    isPaid,
    notFoundMessage: isNotFound ? COPY.notFoundMessage : null,
    systemMessage: isSystem ? COPY.systemMessage : null,
    // Layered on the DEFAULT states only: an error state has no send to fail.
    sendFailed: rendersRow && sendFailed,
    sendFailedMessage: rendersRow && sendFailed ? COPY.sendFailedMessage : null,
    badge: rendersRow ? badgeFor(invoice) : null,
    totalLabel: COPY.totalLabel,
    totalText: rendersRow ? formatDisplayMinorUnits(invoice.totalMinor, invoice.currency) : null,
    dueText,
    paidText,
    hostedInvoiceUrl,
    invoicePdfUrl,
    showNoLinks: rendersRow && hostedInvoiceUrl === null && invoicePdfUrl === null,
    canEdit: isDraft,
    canSend,
    sendLabel: rendersRow && invoice.status === 'draft' ? COPY.finalizeAndSend : COPY.send,
    // Sendable but the account is not ready: the sentence with the one
    // constant /connect-stripe anchor renders instead of the control.
    showSetupNote: sendable && !stripeReady,
    stripeReady,
    // The ONE local carrying the id, and it feeds exactly one hidden value=.
    invoiceId: rendersRow ? invoice.id : '',
  };
}
