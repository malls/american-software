// lib/screens/dashboard-view.js — screen 3's PURE view model (AS-48, plan
// §3.1, §3.3, §4).
//
// The connect-view.js shape: (a) the ledger, transcribed from
// docs/design/wireframes/02-states-ledger.md §3, (b) the ONE definition of the
// id shape a row may emit and a redirector may accept, and (c) a pure function
// from route inputs to template locals. No I/O, no clock, no req, no res. The
// route reads four lists/rows (the connected account, the invoices, the
// contracts, the clients) and hands them here; everything a person sees is
// decided in this file and the template only reads properties.
//
// A ROW REACHES ITS DETAIL SCREEN THROUGH A GET FORM WITH A HIDDEN ID, NEVER AN
// href (plan decision 1). P2a forbids interpolation in href= and action= with
// no exception, and a list of N rows needs N targets; the only P2a-clean shape
// is a constant `action="/invoices/view"` plus `<input type="hidden" name="id"
// value="…">`, and a redirector that answers 303 /invoices/<id> after checking
// the id is UUID-shaped. UUID_SHAPE lives HERE — in the module that emits the
// ids — and is imported by both routers, so the emitting side and the
// accepting side share one definition; this module asserts every id it
// renders matches it (case 5), so a row that could not survive the redirector
// is a thrown error, not a dead control.
//
// `ready` IS READ, NEVER RE-DERIVED (AS-70 decision 1): the gate is one boolean
// from the stored row, orthogonal to the list state — `data-state` stays the
// list state and S3-GATED-STRIPENOTREADY is layered by `stripeReady`.
//
// THIS FILE IS A HUMAN <-> MINOR-UNITS BOUNDARY, on the `'money
// representation'` row of test/dependency-policy.test.js for that reason
// (plan §4): it reads each invoice row's total and currency and is the one
// caller of money.js's display formatter on this screen. The template carries
// the column header as a local (`totalLabel`) and measures zero hits.
//
// EVERY STRING BELOW IS A RENDERER-AUTHORED CONSTANT selected by a closed
// enum, with these data exceptions, all reaching the template as element
// content or a double-quoted value= (escaped by EJS): client names, formatted
// totals, formatted dates, badge labels from the closed table, and each row's
// id in exactly one hidden input.
import { formatDisplayMinorUnits } from '../db/money.js';
import { formatDate } from './dates.js';
import { UNKNOWN_CLIENT, badgeFor } from './invoice-detail-view.js';

/** Screen 3's ledger, all seven rows, each with what this app does about it.
 *  The same R-4 caveat as CONNECT_LEDGER: this list and the table in
 *  test/read-screens.test.js are two independent hand transcriptions compared
 *  against each other; fidelity to the document is a dated review act (all
 *  seven rows transcribed from §3 on 2026-09-12 by agent:developer-marcus).
 *  Dispositions (plan §3.7): `rendered` rows are the members of
 *  DASHBOARD_STATES; `layered` is the ledger's own description of the gate —
 *  it renders INSIDE whichever list state is active, selected by a boolean,
 *  and stamps no state of its own; `redirect-answered` is the guard's 303;
 *  `unrenderable — browser-supplied` needs client-side JavaScript this app
 *  does not have; `n/a` is the ledger's own "n/a — because" row. */
export const DASHBOARD_LEDGER = Object.freeze([
  Object.freeze({ id: 'S3-DEFAULT-POPULATED', disposition: 'rendered' }),
  Object.freeze({ id: 'S3-LOADING', disposition: 'unrenderable — browser-supplied' }),
  Object.freeze({ id: 'S3-EMPTY-FIRSTRUN', disposition: 'rendered' }),
  Object.freeze({ id: 'S3-ERROR-SYSTEM', disposition: 'rendered' }),
  Object.freeze({
    id: 'S3-GATED-STRIPENOTREADY',
    disposition: 'layered — rendered inside S3-DEFAULT-POPULATED and S3-EMPTY-FIRSTRUN by the stripeReady boolean',
  }),
  Object.freeze({ id: 'S3-DENIED-SIGNEDOUT', disposition: 'redirect-answered' }),
  Object.freeze({ id: 'S3-ABANDON', disposition: 'n/a' }),
]);

/** The states this screen renders; `data-state` on the root element is always
 *  a member. */
export const DASHBOARD_STATES = Object.freeze(
  DASHBOARD_LEDGER.filter((row) => row.disposition === 'rendered').map((row) => row.id),
);

/** The HTTP status each rendered state answers with (plan §3.1). */
export const STATE_STATUS = Object.freeze({
  'S3-DEFAULT-POPULATED': 200,
  'S3-EMPTY-FIRSTRUN': 200,
  'S3-ERROR-SYSTEM': 500,
});

/** THE ONE ID SHAPE (plan §3.3): what a row may emit and what a redirector may
 *  accept. randomUUID()'s lowercase form, exactly. Anchored at both ends so a
 *  2,000-character string with a UUID somewhere inside it is refused, and so
 *  the redirector's Location is bounded to 36 characters plus its prefix. */
export const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Copy, verbatim from docs/design/wireframes/screen-3-dashboard.html where it
 *  supplies it. Deviations are recorded in the plan (§11): the first-run
 *  lede's first sentence branches on readiness (Q2), draft rows say "View"
 *  (Q3), and "Create your first contract" was absent until AS-127 landed
 *  /contracts/new (Q5) — the invoice CTA was the primary meanwhile, and is
 *  now the wireframe's secondary. */
const COPY = Object.freeze({
  populatedTitle: 'Your work',
  emptyTitle: "Let's get your first client paid",
  systemTitle: "Couldn't load your work",
  systemMessage: 'Something went wrong loading your contracts and invoices.',
  ledeReady: "You're connected to Stripe. The next step is a contract or an invoice for your first client.",
  ledeNotReady: "Connect Stripe when you're ready to invoice. The next step is a contract or an invoice for your first client.",
  invoiceCta: 'Or create an invoice directly',
  totalLabel: 'Amount',
});

/** THE ONE PLACE THE STATE IS DECIDED. Total over (failure, the two lists). */
function selectState(failure, invoices, contracts) {
  if (failure === 'system') return 'S3-ERROR-SYSTEM';
  if (invoices.length === 0 && contracts.length === 0) return 'S3-EMPTY-FIRSTRUN';
  return 'S3-DEFAULT-POPULATED';
}

function assertEmittableId(id, what) {
  if (typeof id !== 'string' || !UUID_SHAPE.test(id)) {
    throw new TypeError(`dashboardLocals: ${what} id ${JSON.stringify(id)} does not match UUID_SHAPE, so its View control could never pass the redirector`);
  }
  return id;
}

/**
 * Route inputs -> template locals. Pure.
 *
 * @param {{
 *   account?: { ready: boolean } | null,   the connected-account row, or null when there is none
 *   invoices?: Array<object>,     invoices repository summaries, newest first as the repository returns them
 *   contracts?: Array<object>,    contracts repository summaries, newest first
 *   clients?: Array<{ id: string, name: string }>,   for the name join
 *   failure?: 'system' | null,
 * }} [input]
 * @returns {object} the template's locals, plus `status`. Not frozen — express
 *   adds `_locals` to the object it is handed (the connect-view.js note).
 */
export function dashboardLocals(input = {}) {
  const account = input.account ?? null;
  const invoices = Array.isArray(input.invoices) ? input.invoices : [];
  const contracts = Array.isArray(input.contracts) ? input.contracts : [];
  const clients = Array.isArray(input.clients) ? input.clients : [];
  const failure = input.failure ?? null;
  const state = selectState(failure, invoices, contracts);
  const stripeReady = account !== null && account.ready === true;

  const isPopulated = state === 'S3-DEFAULT-POPULATED';
  const isEmpty = state === 'S3-EMPTY-FIRSTRUN';
  const isSystem = state === 'S3-ERROR-SYSTEM';

  // The name join. A client id with no match renders the constant rather than
  // throwing: a list must not 500 because one row's client is missing, and the
  // detail screen is where that row's real failure surfaces.
  const names = new Map(clients.map((client) => [client.id, client.name]));
  const nameOf = (clientId) => names.get(clientId) ?? UNKNOWN_CLIENT;

  let title;
  if (isSystem) title = COPY.systemTitle;
  else if (isEmpty) title = COPY.emptyTitle;
  else title = COPY.populatedTitle;

  return {
    state,
    status: STATE_STATUS[state],
    title,
    isPopulated,
    isEmpty,
    isSystem,
    // Each table renders only when it has a row; POPULATED guarantees at least
    // one of the two does.
    hasInvoices: isPopulated && invoices.length > 0,
    hasContracts: isPopulated && contracts.length > 0,
    systemMessage: isSystem ? COPY.systemMessage : null,
    stripeReady,
    // First run: the lede's first sentence follows readiness (Q2), and the
    // invoice CTA renders only when screen 4 would accept it — a primary
    // control pointing at a refusal is the R-2 defect one screen later.
    firstRunLede: isEmpty ? (stripeReady ? COPY.ledeReady : COPY.ledeNotReady) : null,
    showInvoiceCta: isEmpty && stripeReady,
    invoiceCta: COPY.invoiceCta,
    totalLabel: COPY.totalLabel,
    invoices: isPopulated
      ? invoices.map((row) => ({
          id: assertEmittableId(row.id, 'invoice'),
          clientName: nameOf(row.clientId),
          totalText: formatDisplayMinorUnits(row.totalMinor, row.currency),
          badge: badgeFor(row),
        }))
      : [],
    contracts: isPopulated
      ? contracts.map((row) => ({
          id: assertEmittableId(row.id, 'contract'),
          clientName: nameOf(row.clientId),
          createdText: formatDate(row.createdAt),
        }))
      : [],
  };
}
