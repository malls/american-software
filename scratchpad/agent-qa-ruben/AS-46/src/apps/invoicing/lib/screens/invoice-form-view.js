// lib/screens/invoice-form-view.js — screen 4's PURE view model (AS-46, plan
// §3.2, §3.4, §4).
//
// The signin-view.js shape, one screen later: (a) the ledger, transcribed from
// docs/design/wireframes/02-states-ledger.md §4 (plus the §0 sub-pattern rows
// it carries), (b) a pure parser from a submitted form body to typed values,
// field errors and a repository input, and (c) a pure function from route
// inputs to template locals. No I/O, no clock, no req, no res. The route reads
// three rows (the connected account, the client list, the draft), runs the one
// intent that persists, and hands the results here; everything a person sees is
// decided in this file and the template only reads properties.
//
// THIS FILE IS THE HUMAN <-> MINOR-UNITS BOUNDARY, and is on the
// `'money representation'` row of test/dependency-policy.test.js for that
// reason (plan §4.3): it is the one caller of money.js's formatMinorUnits and
// parseMajorUnits, and the only place that knows a form field called
// `unitPrice` becomes a repository field called `unitAmountMinor`. The template
// and the stylesheet never see the API's field name, a currency literal, or any
// of the row's three words — `priceLabel` is built here from DEFAULT_CURRENCY
// so no template carries one.
//
// EVERY STRING BELOW IS A RENDERER-AUTHORED CONSTANT selected by a closed enum,
// with these data exceptions, all reaching the template as element content or
// a double-quoted value= (escaped by EJS): client names and emails, each line
// item's description / quantity / unit price as submitted or as formatted from
// the row, daysUntilDue, the selected clientId in <option value>, and the
// duplicate match's id in a hidden input. The INVOICE ID APPEARS IN NO LOCAL:
// the route knows it from the URL, and the form posts to the page's own URL.
import { DEFAULT_CURRENCY, formatMinorUnits, parseMajorUnits } from '../db/money.js';

/** Screen 4's ledger, all twelve rows — the deepest in the set — each with what
 *  this app does about it. The same R-4 caveat as SIGNIN_LEDGER: this list and
 *  the table in test/invoice-screen.test.js are two independent hand
 *  transcriptions compared against each other; fidelity to the document is a
 *  dated review act. Dispositions (plan §3.7): `rendered` rows are the members
 *  of INVOICE_FORM_STATES; `redirect-answered` is the guard's 303;
 *  `path-into-render` is a way of ARRIVING at a render; `unrenderable —
 *  browser-supplied` needs client-side JavaScript this app does not have. The
 *  ledger says screen 4 has NO n/a row, and the test asserts that bucket empty.
 *  Not ledger states, recorded here (plan §13 items 5 and 6): a missing or
 *  foreign invoice on GET …/edit is a one-line text/plain 404 through the
 *  router's existing `fail`, and a body-parser refusal lands on the router's
 *  existing text/plain `parse-body` landing. */
export const INVOICE_FORM_LEDGER = Object.freeze([
  Object.freeze({ id: 'S4-DEFAULT-CREATE', disposition: 'rendered' }),
  Object.freeze({ id: 'S4-DEFAULT-EDIT', disposition: 'rendered' }),
  Object.freeze({ id: 'S4-LOADING', disposition: 'unrenderable — browser-supplied' }),
  Object.freeze({ id: 'S4-CLIENT-EMPTY', disposition: 'rendered' }),
  Object.freeze({ id: 'S4-ERROR-VALIDATION', disposition: 'rendered' }),
  Object.freeze({ id: 'S4-ERROR-SYSTEM', disposition: 'rendered' }),
  Object.freeze({ id: 'S4-CLIENT-ERROR-VALIDATION', disposition: 'rendered' }),
  Object.freeze({ id: 'S4-CLIENT-ERROR-DUPLICATE', disposition: 'rendered' }),
  Object.freeze({ id: 'S4-GATED-STRIPENOTREADY', disposition: 'rendered' }),
  Object.freeze({ id: 'S4-DENIED-SIGNEDOUT', disposition: 'redirect-answered' }),
  Object.freeze({ id: 'S4-ABANDON', disposition: 'path-into-render' }),
  Object.freeze({ id: 'S4-CLIENT-ABANDON', disposition: 'path-into-render' }),
]);

/** The states this screen renders; `data-state` on the root element is always
 *  a member. */
export const INVOICE_FORM_STATES = Object.freeze(
  INVOICE_FORM_LEDGER.filter((row) => row.disposition === 'rendered').map((row) => row.id),
);

/** The HTTP status each rendered state answers with (plan §3.4). A true
 *  refusal is 403; a form the freelancer has to fix is 400; everything else —
 *  including the non-blocking duplicate warning, where nothing was refused — is
 *  200. Frozen and exported so the route reads it rather than re-deriving it. */
export const STATE_STATUS = Object.freeze({
  'S4-DEFAULT-CREATE': 200,
  'S4-DEFAULT-EDIT': 200,
  'S4-CLIENT-EMPTY': 200,
  'S4-ERROR-VALIDATION': 400,
  'S4-ERROR-SYSTEM': 200,
  'S4-CLIENT-ERROR-VALIDATION': 400,
  'S4-CLIENT-ERROR-DUPLICATE': 200,
  'S4-GATED-STRIPENOTREADY': 403,
});

/** The closed intent set (plan §3.2). Anything else — absent, unknown, or an
 *  array from a repeated parameter — is refused by the dispatch. */
export const INTENTS = Object.freeze(['save', 'send', 'add-row', 'new-client', 'existing-client', 'add-client']);

/** The same ceiling the API applies (routes/invoices.js MAX_LINE_ITEMS). Two
 *  spellings of one number, deliberately in two layers: the form stops offering
 *  the control at this count; the API refuses past it. */
export const MAX_LINE_ITEMS = 50;

/** Blank rows rendered by a fresh create form — the wireframe's "2–3 example
 *  rows". Edit mode renders the stored rows plus one blank. */
const CREATE_BLANK_ROWS = 3;
const DEFAULT_DAYS_UNTIL_DUE = '30';

/** Copy, verbatim from docs/design/wireframes/screen-4-invoice-create.html
 *  where it supplies it. Deviations are recorded in the plan (§10): the price
 *  message (Q5 — zero is a legal price, so the wireframe's "greater than $0" is
 *  not built), the client email rule (Q3 — blankness only, matching
 *  POST /clients), and `required`, which is screen 1's sentence. */
const FIELD_MESSAGE = Object.freeze({
  required: 'This field is required.',
  quantity: 'Enter a whole number of at least 1.',
  unitPrice: 'Enter a price like 1200.00.',
  daysUntilDue: 'Enter at least 1 day.',
  client: 'Select a client.',
  noRows: 'Add at least one line item.',
  tooManyRows: `At most ${MAX_LINE_ITEMS} line items.`,
});

const CHOOSE_ACTION = 'Choose an action.';
const VALIDATION_MESSAGE = 'Everything else you entered is unchanged below.';
const GATED_MESSAGE = 'You need to finish connecting Stripe before you can create an invoice.';
const SYSTEM_MESSAGE =
  'Something went wrong sending this invoice. Nothing was charged and the client was not notified. Your draft is unchanged — try again.';
const DUPLICATE_BEFORE = 'This matches an existing client: ';
const DUPLICATE_AFTER = '.';

const TITLE = Object.freeze({
  create: 'New invoice',
  edit: 'Edit invoice — draft',
});
const TITLE_SUFFIX = Object.freeze({
  'S4-CLIENT-EMPTY': ' — no clients yet',
  'S4-ERROR-VALIDATION': ' — fix the highlighted fields',
  'S4-CLIENT-ERROR-VALIDATION': ' — new client needs a name and email',
  'S4-CLIENT-ERROR-DUPLICATE': ' — this looks like an existing client',
});
const TITLE_OVERRIDE = Object.freeze({
  'S4-ERROR-SYSTEM': 'Invoice not sent',
  'S4-GATED-STRIPENOTREADY': 'Connect Stripe before invoicing',
});

const DIGITS = /^\d+$/;

/** A submitted value, or ''. Never null and never undefined: the template
 *  writes it into a double-quoted value=. An array (a repeated parameter) is
 *  nobody's valid input and becomes '' — and, where the field is required, an
 *  error. */
const text = (value) => (typeof value === 'string' ? value : '');
const isBlank = (value) => text(value).trim() === '';
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** A positive whole number as typed: digits only, at least 1. */
const positiveInteger = (raw) => {
  const value = text(raw).trim();
  if (!DIGITS.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
};

const blankRow = () => ({ description: '', quantity: '', unitPrice: '' });

/** `lineItems` arrives as an array below qs's array limit and as an
 *  index-keyed object above it (routes/invoices.js normaliseLineItems says why);
 *  both shapes are accepted, ordered by numeric key. A non-numeric key is not a
 *  row and is ignored. */
function submittedRows(raw) {
  let entries;
  if (Array.isArray(raw)) entries = raw.map((item, index) => [index, item]);
  else if (isObject(raw)) {
    entries = Object.entries(raw)
      .filter(([key]) => DIGITS.test(key))
      .map(([key, item]) => [Number(key), item])
      .sort((a, b) => a[0] - b[0]);
  } else return [];
  return entries.map(([, item]) => {
    const row = isObject(item) ? item : {};
    return { description: text(row.description), quantity: text(row.quantity), unitPrice: text(row.unitPrice) };
  });
}

/**
 * A submitted form body -> what was typed, what is wrong with it, and the
 * repository input when nothing is. Pure; a body that is not an object parses
 * as an empty form.
 *
 * Rows whose three fields are all blank are DROPPED, not refused — the removal
 * mechanism, since the wireframe has no remove control (plan §3.2). A row with
 * some fields blank is an error on the blank fields. Errors carry the
 * renderer's sentences, never the repository's.
 *
 * @returns {{
 *   intent: string | null,
 *   values: { clientId: string, clientName: string, clientEmail: string,
 *     daysUntilDue: string, duplicateId: string, clientConfirm: boolean,
 *     pickerMode: 'select' | 'new', lineItems: Array<{ description: string, quantity: string, unitPrice: string }> },
 *   errors: { clientId: string | null, daysUntilDue: string | null, rows: string | null,
 *     lineItems: Array<{ description: string | null, quantity: string | null, unitPrice: string | null }> },
 *   fieldErrorCount: number,
 *   draft: { clientId: string, daysUntilDue: number,
 *     lineItems: Array<{ description: string, quantity: number, unitAmountMinor: number }> } | null,
 * }} `intent` is null for an absent, unknown or repeated intent. `draft` is null
 *   whenever any error is set.
 */
export function parseInvoiceForm(body) {
  const form = isObject(body) ? body : {};
  const intent = typeof form.intent === 'string' && INTENTS.includes(form.intent) ? form.intent : null;
  const lineItems = submittedRows(form.lineItems);
  const values = {
    clientId: text(form.clientId),
    clientName: text(form.clientName),
    clientEmail: text(form.clientEmail),
    daysUntilDue: text(form.daysUntilDue),
    duplicateId: text(form.duplicateId),
    clientConfirm: form.clientConfirm === '1',
    pickerMode: form.pickerMode === 'new' ? 'new' : 'select',
    lineItems,
  };

  const errors = { clientId: null, daysUntilDue: null, rows: null, lineItems: [] };
  let fieldErrorCount = 0;
  const mark = (message) => { fieldErrorCount += 1; return message; };

  if (isBlank(values.clientId)) errors.clientId = mark(FIELD_MESSAGE.client);
  const days = positiveInteger(values.daysUntilDue);
  if (days === null) errors.daysUntilDue = mark(FIELD_MESSAGE.daysUntilDue);

  const usable = [];
  let filledRows = 0;
  errors.lineItems = lineItems.map((row) => {
    const rowErrors = { description: null, quantity: null, unitPrice: null };
    // All three blank: the row is dropped, silently — the removal mechanism.
    if (isBlank(row.description) && isBlank(row.quantity) && isBlank(row.unitPrice)) return rowErrors;
    filledRows += 1;
    if (isBlank(row.description)) rowErrors.description = mark(FIELD_MESSAGE.required);
    const quantity = positiveInteger(row.quantity);
    if (quantity === null) rowErrors.quantity = mark(FIELD_MESSAGE.quantity);
    const unitAmountMinor = parseMajorUnits(row.unitPrice);
    if (unitAmountMinor === null) rowErrors.unitPrice = mark(FIELD_MESSAGE.unitPrice);
    if (rowErrors.description === null && rowErrors.quantity === null && rowErrors.unitPrice === null) {
      usable.push({ description: row.description, quantity, unitAmountMinor });
    }
    return rowErrors;
  });
  if (lineItems.length > MAX_LINE_ITEMS) errors.rows = mark(FIELD_MESSAGE.tooManyRows);
  else if (filledRows === 0) errors.rows = mark(FIELD_MESSAGE.noRows);

  const draft = fieldErrorCount === 0 ? { clientId: values.clientId, daysUntilDue: days, lineItems: usable } : null;
  return { intent, values, errors, fieldErrorCount, draft };
}

/** The client sub-form's own validation — exactly POST /clients's rule, name
 *  and email non-blank (plan §3.3, Q3). No email-shape check here, by decision. */
const clientFieldErrors = (values) => ({
  clientName: isBlank(values.clientName) ? FIELD_MESSAGE.required : null,
  clientEmail: isBlank(values.clientEmail) ? FIELD_MESSAGE.required : null,
});

/** "2 fields need attention" — the wireframe's banner, agreeing with itself
 *  about number. n is what the page marks, never a guess. */
const attentionTitle = (n) => (n === 1 ? '1 field needs attention' : `${n} fields need attention`);

const optionLabel = (client) => `${client.name} (${client.email})`;

/**
 * Route inputs -> template locals. Pure. State selection is a total function in
 * precedence order (plan §3.4), first match wins.
 *
 * @param {{
 *   mode?: 'create' | 'edit',
 *   account?: { ready: boolean } | null,   the connected-account row; `ready` is READ, never re-derived
 *   clients?: Array<{ id: string, name: string, email: string }>,
 *   draft?: { clientId: string, daysUntilDue: number,
 *     lineItems: Array<{ description: string, quantity: number, unitAmountMinor: number }> } | null,
 *   submission?: ReturnType<typeof parseInvoiceForm> | null,   a POST's parsed body; null on a GET
 *   sendFailed?: boolean,        GET …/edit with ?error present — a presence flag, the value never arrives here
 *   duplicate?: { id: string, name: string, email: string } | null,   add-client: the first case-insensitive match, when unconfirmed
 *   createdClientId?: string | null,   add-client: the row the route created
 *   clientRefused?: boolean,     save/send: the repository refused the clientId the parser accepted
 * }} [input]
 * @returns {object} the template's locals, plus `status`. Not frozen — express
 *   adds `_locals` to the object it is handed (the signin-view.js note).
 */
export function invoiceFormLocals(input = {}) {
  const mode = input.mode === 'edit' ? 'edit' : 'create';
  const account = input.account ?? null;
  const clients = Array.isArray(input.clients) ? input.clients : [];
  const draft = input.draft ?? null;
  const submission = input.submission ?? null;
  const intent = submission === null ? null : submission.intent;
  const values = submission === null ? null : submission.values;
  const duplicate = intent === 'add-client' ? input.duplicate ?? null : null;
  const createdClientId = intent === 'add-client' ? input.createdClientId ?? null : null;
  const clientErrors = intent === 'add-client' ? clientFieldErrors(values) : { clientName: null, clientEmail: null };
  const clientInvalid = clientErrors.clientName !== null || clientErrors.clientEmail !== null;
  // The repository refusing a clientId the parser accepted (a foreign or
  // unknown id) is marked exactly like an unselected one — the answer for
  // someone else's client is indistinguishable from no client (plan §3.4).
  const persisting = intent === 'save' || intent === 'send';
  const refused = persisting && input.clientRefused === true && submission.errors.clientId === null;
  const clientIdError = submission === null ? null : refused ? FIELD_MESSAGE.client : submission.errors.clientId;
  const invoiceErrorCount = submission === null ? 0 : submission.fieldErrorCount + (refused ? 1 : 0);
  const invoiceInvalid = submission !== null && (intent === null || (persisting && invoiceErrorCount > 0));

  let state;
  if (account === null || account.ready === false) state = 'S4-GATED-STRIPENOTREADY';
  else if (intent === 'add-client' && clientInvalid) state = 'S4-CLIENT-ERROR-VALIDATION';
  else if (intent === 'add-client' && duplicate !== null) state = 'S4-CLIENT-ERROR-DUPLICATE';
  else if (invoiceInvalid) state = 'S4-ERROR-VALIDATION';
  else if (mode === 'edit' && input.sendFailed === true) state = 'S4-ERROR-SYSTEM';
  else if (clients.length === 0) state = 'S4-CLIENT-EMPTY';
  else if (mode === 'edit') state = 'S4-DEFAULT-EDIT';
  else state = 'S4-DEFAULT-CREATE';

  // --- the picker -----------------------------------------------------------
  // Orthogonal to state. Zero clients FORCES add-new mode and renders no select
  // and no toggle (01-screens §4.1). Otherwise the mode follows the intent that
  // produced this render, else the hidden field the form carried, else select.
  let pickerMode;
  if (clients.length === 0) pickerMode = 'new';
  else if (intent === 'new-client') pickerMode = 'new';
  else if (intent === 'existing-client') pickerMode = 'select';
  else if (intent === 'add-client') pickerMode = createdClientId === null ? 'new' : 'select';
  else pickerMode = values === null ? 'select' : values.pickerMode;

  let selectedClientId = '';
  if (createdClientId !== null) selectedClientId = createdClientId;
  else if (intent === 'existing-client') selectedClientId = values.duplicateId === '' ? values.clientId : values.duplicateId;
  else if (values !== null) selectedClientId = values.clientId;
  else if (draft !== null) selectedClientId = draft.clientId;

  // Field errors show only on a save/send that failed; an unknown intent gets
  // the dispatch banner and its values back, unmarked.
  const showErrors = state === 'S4-ERROR-VALIDATION' && persisting;
  const clientError = showErrors ? clientIdError : null;

  // --- rows -----------------------------------------------------------------
  let rows;
  if (values !== null) {
    rows = values.lineItems.map((row, index) => ({ ...row, errors: submission.errors.lineItems[index] }));
    if (intent === 'add-row' && rows.length < MAX_LINE_ITEMS) rows.push({ ...blankRow(), errors: null });
  } else if (draft !== null) {
    rows = draft.lineItems.map((item) => ({
      description: item.description,
      quantity: String(item.quantity),
      unitPrice: formatMinorUnits(item.unitAmountMinor),
      errors: null,
    }));
    rows.push({ ...blankRow(), errors: null });
  } else {
    rows = Array.from({ length: CREATE_BLANK_ROWS }, () => ({ ...blankRow(), errors: null }));
  }
  const lineItems = rows.map((row, index) => ({
    index,
    description: row.description,
    quantity: row.quantity,
    unitPrice: row.unitPrice,
    descriptionError: showErrors && row.errors !== null ? row.errors.description : null,
    quantityError: showErrors && row.errors !== null ? row.errors.quantity : null,
    unitPriceError: showErrors && row.errors !== null ? row.errors.unitPrice : null,
  }));

  let daysUntilDue = DEFAULT_DAYS_UNTIL_DUE;
  if (values !== null) daysUntilDue = values.daysUntilDue;
  else if (draft !== null) daysUntilDue = String(draft.daysUntilDue);

  // --- banner ---------------------------------------------------------------
  let banner = null;
  if (state === 'S4-GATED-STRIPENOTREADY') banner = { tone: 'warning', title: null, message: GATED_MESSAGE };
  else if (state === 'S4-ERROR-SYSTEM') banner = { tone: 'error', title: null, message: SYSTEM_MESSAGE };
  else if (state === 'S4-ERROR-VALIDATION') {
    banner = intent === null
      ? { tone: 'error', title: null, message: CHOOSE_ACTION }
      : { tone: 'error', title: attentionTitle(invoiceErrorCount), message: VALIDATION_MESSAGE };
  } else if (state === 'S4-CLIENT-ERROR-VALIDATION') {
    const n = (clientErrors.clientName === null ? 0 : 1) + (clientErrors.clientEmail === null ? 0 : 1);
    banner = { tone: 'error', title: attentionTitle(n), message: VALIDATION_MESSAGE };
  }
  // The duplicate warning is NOT the page banner: it is non-blocking and its
  // two offers are submit buttons, so it renders inside the form, in the
  // picker, where the wireframe draws it.
  const duplicateMatch = state === 'S4-CLIENT-ERROR-DUPLICATE'
    ? { before: DUPLICATE_BEFORE, label: optionLabel(duplicate), after: DUPLICATE_AFTER }
    : null;

  const title = TITLE_OVERRIDE[state] ?? `${TITLE[mode]}${TITLE_SUFFIX[state] ?? ''}`;

  return {
    state,
    status: STATE_STATUS[state],
    title,
    isEdit: mode === 'edit',
    gated: state === 'S4-GATED-STRIPENOTREADY',
    banner,
    pickerMode,
    hasClients: clients.length > 0,
    showSelect: pickerMode === 'select' && clients.length > 0,
    showNewClientToggle: pickerMode === 'select' && clients.length > 0,
    // The duplicate warning carries its own "use this client instead" offer, so
    // the toggle to the same intent is not rendered twice in that state.
    showExistingClientToggle: pickerMode === 'new' && clients.length > 0 && duplicateMatch === null,
    clients: clients.map((client) => ({ id: client.id, label: optionLabel(client), selected: client.id === selectedClientId })),
    clientError,
    clientName: values === null ? '' : values.clientName,
    clientEmail: values === null ? '' : values.clientEmail,
    clientNameError: state === 'S4-CLIENT-ERROR-VALIDATION' ? clientErrors.clientName : null,
    clientEmailError: state === 'S4-CLIENT-ERROR-VALIDATION' ? clientErrors.clientEmail : null,
    duplicate: duplicateMatch,
    duplicateId: duplicateMatch === null ? '' : duplicate.id,
    lineItems,
    rowsError: showErrors ? submission.errors.rows : null,
    canAddRow: lineItems.length < MAX_LINE_ITEMS,
    daysUntilDue,
    daysUntilDueError: showErrors ? submission.errors.daysUntilDue : null,
    priceLabel: `Unit price (${DEFAULT_CURRENCY.toUpperCase()})`,
  };
}
