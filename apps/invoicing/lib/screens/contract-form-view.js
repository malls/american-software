// lib/screens/contract-form-view.js — screen 6's PURE view model (AS-127, the
// AS-47 plan §3.2 design; split out of AS-47 at that plan's §6 line).
//
// The invoice-form-view.js shape, one screen later: (a) the ledger, transcribed
// from docs/design/wireframes/02-states-ledger.md §6 (plus the §0 client
// sub-pattern rows it carries), (b) a pure parser from a submitted form body to
// typed values, field errors and the exact object handed to generate, and (c) a
// pure function from route inputs to template locals. No I/O, no clock, no req,
// no res. The route reads one row set (the client list), runs the one intent
// that persists, and hands the results here; everything a person sees is
// decided in this file and the template only reads properties.
//
// THE FIELDS COME FROM THE DECLARATION, NOT FROM THE TEMPLATE. `fields` is
// getTemplate(DEFAULT_TEMPLATE_ID).variables filtered to source === 'form', in
// declaration order; the template loops and branches on field.type. The
// template id is passed to generate EXPLICITLY as DEFAULT_TEMPLATE_ID, so the
// fields rendered and the declaration generated are the same object by
// construction — no hidden templateId input exists, and a request cannot pick
// a template the screen did not render.
//
// A RECORD-SOURCED NAME NEVER REACHES generate FROM THIS SCREEN: parseContractForm
// reads exactly the declared form names and nothing else from the body, so
// `freelancerName=Someone Else` in a hand-crafted POST is simply not read.
//
// ONE VALIDATOR (AS-127 decision 5). The parser calls generation.js's exported
// validateFormValue per declared field and records the class of the refusal,
// never its message; generate runs the identical function again and cannot
// reach a different answer. Field copy is per field and constant, mapped on
// the field name, never derived from the error's text (the house rule).
//
// EVERY STRING BELOW IS A RENDERER-AUTHORED CONSTANT selected by a closed enum,
// with these data exceptions, all reaching the template as element content or
// a double-quoted value= (escaped by EJS): client names and emails, each
// declared field's value as submitted, the selected clientId in <option value>,
// and the duplicate match's id in a hidden input. The declaration's field
// names reach name=/id=/for= as renderer-authored constants from code.
import { DEFAULT_TEMPLATE_ID, getTemplate } from '../contracts/templates.js';
import { validateFormValue } from '../contracts/generation.js';

/** Screen 6's ledger, all eleven rows, each with what this app does about it.
 *  The same R-4 caveat as SIGNIN_LEDGER: this list and the table in
 *  test/contract-screens.test.js are two independent hand transcriptions
 *  compared against each other; fidelity to the document is a dated review
 *  act. Dispositions (AS-47 plan §3.7, 6 + 1 + 2 + 1 + 1 = 11): `rendered` rows
 *  are the members of CONTRACT_FORM_STATES; `redirect-answered` is the guard's
 *  303; `path-into-render` is a way of ARRIVING at a render (and on this screen
 *  the two abandon rows coincide in effect — there is no draft, so leaving
 *  loses everything typed); `unrenderable — browser-supplied` needs client-side
 *  JavaScript this app does not have; `n/a` is the ledger's own explicit row —
 *  contract generation has no Stripe dependency, and the route reads no
 *  connected-account row at all. Not a ledger state: a body-parser refusal
 *  lands on the router's existing text/plain `parse-body` landing. */
export const CONTRACT_FORM_LEDGER = Object.freeze([
  Object.freeze({ id: 'S6-DEFAULT', disposition: 'rendered' }),
  Object.freeze({ id: 'S6-LOADING', disposition: 'unrenderable — browser-supplied' }),
  Object.freeze({ id: 'S6-CLIENT-EMPTY', disposition: 'rendered' }),
  Object.freeze({ id: 'S6-ERROR-VALIDATION', disposition: 'rendered' }),
  Object.freeze({ id: 'S6-ERROR-SYSTEM', disposition: 'rendered' }),
  Object.freeze({ id: 'S6-CLIENT-ERROR-VALIDATION', disposition: 'rendered' }),
  Object.freeze({ id: 'S6-CLIENT-ERROR-DUPLICATE', disposition: 'rendered' }),
  Object.freeze({ id: 'S6-GATED-STRIPENOTREADY', disposition: 'n/a' }),
  Object.freeze({ id: 'S6-DENIED-SIGNEDOUT', disposition: 'redirect-answered' }),
  Object.freeze({ id: 'S6-ABANDON', disposition: 'path-into-render' }),
  Object.freeze({ id: 'S6-CLIENT-ABANDON', disposition: 'path-into-render' }),
]);

/** The states this screen renders; `data-state` on the root element is always
 *  a member. */
export const CONTRACT_FORM_STATES = Object.freeze(
  CONTRACT_FORM_LEDGER.filter((row) => row.disposition === 'rendered').map((row) => row.id),
);

/** The HTTP status each rendered state answers with (AS-47 plan §3.2, §11 Q4).
 *  A form the freelancer has to fix is 400; a generation that failed after
 *  validation is 500 (nothing was created; the in-place render IS the retry);
 *  everything else — including the non-blocking duplicate warning — is 200.
 *  Frozen and exported so the route reads it rather than re-deriving it. */
export const STATE_STATUS = Object.freeze({
  'S6-DEFAULT': 200,
  'S6-CLIENT-EMPTY': 200,
  'S6-ERROR-VALIDATION': 400,
  'S6-ERROR-SYSTEM': 500,
  'S6-CLIENT-ERROR-VALIDATION': 400,
  'S6-CLIENT-ERROR-DUPLICATE': 200,
});

/** The closed intent set — AS-46 §3.2's table minus the draft-shaped ones.
 *  Anything else — absent, unknown, or an array from a repeated parameter — is
 *  refused by the dispatch. */
export const INTENTS = Object.freeze(['generate', 'new-client', 'existing-client', 'add-client']);

/** The declared form-sourced variables, in declaration order. Read once: the
 *  registry freezes the declaration at module load. */
const formVariables = () => getTemplate(DEFAULT_TEMPLATE_ID).variables.filter((variable) => variable.source === 'form');

/** Copy per field, CONSTANT, keyed by the declared name — never derived from
 *  the validator's message. `projectDescription` is the wireframe's own
 *  sentence; `startDate` has no wireframe copy (recorded deviation, AS-47 plan
 *  §3.2). A declared field with no sentence here gets screen 1's; each sentence
 *  says what a valid value looks like, which is true in every failure (blank,
 *  over-long, malformed). */
const FIELD_MESSAGE = Object.freeze({
  projectDescription: 'Describe the project in a sentence or two.',
  startDate: 'Enter a date as YYYY-MM-DD.',
  required: 'This field is required.',
  client: 'Select a client.',
  // The same error with the picker in add-new mode, where there is nothing to
  // select from (the AS-46 review cycle 1 D1 shape).
  clientAddFirst: 'Add the client first.',
});

const CHOOSE_ACTION = 'Choose an action.';
const VALIDATION_MESSAGE = 'Everything else you entered is unchanged below.';
// S6-ERROR-SYSTEM's sentence is a LITERAL of the template's `isSystem` branch
// (its distinctive marker, AS-47 plan §3.6 — the contract-detail.ejs shape), so
// that state's `banner` is null here and the template carries the copy.
const DUPLICATE_BEFORE = 'This matches an existing client: ';
const DUPLICATE_AFTER = '.';

/** The placeholder-body warning is PAGE CHROME (AS-47 plan §3.6): constant
 *  copy above the form in every rendered state, in addition to the notice
 *  inside every generated document. The wireframe's own two sentences. */
const PLACEHOLDER_TITLE = 'Placeholder contract text — not legal advice';
const PLACEHOLDER_MESSAGE =
  "This contract's body is placeholder text. It is not legal advice — do not send this to a client as a binding contract.";

const TITLE = 'New contract';
const TITLE_SUFFIX = Object.freeze({
  'S6-CLIENT-EMPTY': ' — no clients yet',
  'S6-ERROR-VALIDATION': ' — fix the highlighted fields',
  'S6-CLIENT-ERROR-VALIDATION': ' — new client needs a name and email',
  'S6-CLIENT-ERROR-DUPLICATE': ' — this looks like an existing client',
});
const TITLE_OVERRIDE = Object.freeze({
  'S6-ERROR-SYSTEM': 'Contract not created',
});

/** A submitted value, or ''. Never null and never undefined: the template
 *  writes it into a double-quoted value= or a textarea. An array (a repeated
 *  parameter) is nobody's valid input and becomes '' — and is an error, since
 *  the validator refuses it. */
const text = (value) => (typeof value === 'string' ? value : '');
const isBlank = (value) => text(value).trim() === '';
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * A submitted form body -> what was typed, what is wrong with it, and the exact
 * object handed to generate when nothing is. Pure; a body that is not an
 * object parses as an empty form.
 *
 * Errors are BOOLEANS by field name, never the validator's sentences: copy is
 * chosen at render time from FIELD_MESSAGE, mapped on the name (the class-not-
 * message rule). Only DECLARED form names are read — `fields` has exactly the
 * declaration's cardinality, and `formValues` has exactly those keys.
 *
 * @returns {{
 *   intent: string | null,
 *   values: { clientId: string, clientName: string, clientEmail: string,
 *     duplicateId: string, clientConfirm: boolean, pickerMode: 'select' | 'new' },
 *   fields: Array<{ name: string, value: string }>,
 *   errors: { clientId: boolean, [fieldName: string]: boolean },
 *   fieldErrorCount: number,
 *   formValues: object | null,
 * }} `intent` is null for an absent, unknown or repeated intent. `formValues`
 *   is null whenever any error is set.
 */
export function parseContractForm(body) {
  const form = isObject(body) ? body : {};
  const intent = typeof form.intent === 'string' && INTENTS.includes(form.intent) ? form.intent : null;
  const values = {
    clientId: text(form.clientId),
    clientName: text(form.clientName),
    clientEmail: text(form.clientEmail),
    duplicateId: text(form.duplicateId),
    clientConfirm: form.clientConfirm === '1',
    pickerMode: form.pickerMode === 'new' ? 'new' : 'select',
  };

  const errors = { clientId: isBlank(values.clientId) };
  let fieldErrorCount = errors.clientId ? 1 : 0;
  const fields = [];
  const formValues = {};
  for (const variable of formVariables()) {
    const raw = form[variable.name];
    fields.push({ name: variable.name, value: text(raw) });
    let stored;
    try {
      // THE SAME FUNCTION generate RUNS (decision 5). What it refuses here it
      // refuses there; the class is recorded, the message is not read.
      stored = validateFormValue(variable, raw);
      errors[variable.name] = false;
    } catch {
      errors[variable.name] = true;
      fieldErrorCount += 1;
    }
    if (stored !== undefined) formValues[variable.name] = stored;
  }

  return { intent, values, fields, errors, fieldErrorCount, formValues: fieldErrorCount === 0 ? formValues : null };
}

/** The client sub-form's own validation — exactly POST /clients's rule, name
 *  and email non-blank (AS-46 §3.3, Q3: blankness only, still one consumer of
 *  no shape rule, so nothing is exported). */
const clientFieldErrors = (values) => ({
  clientName: isBlank(values.clientName) ? FIELD_MESSAGE.required : null,
  clientEmail: isBlank(values.clientEmail) ? FIELD_MESSAGE.required : null,
});

/** "2 fields need attention" — the wireframe's banner, agreeing with itself
 *  about number. n is what the page marks, never a guess. Re-implemented
 *  locally: signin-view.js does not export it and this task does not edit
 *  that file. */
const attentionTitle = (n) => (n === 1 ? '1 field needs attention' : `${n} fields need attention`);

const optionLabel = (client) => `${client.name} (${client.email})`;

/**
 * Route inputs -> template locals. Pure. State selection is a total function in
 * precedence order (AS-47 plan §3.2's table), first match wins.
 *
 * @param {{
 *   clients?: Array<{ id: string, name: string, email: string }>,   listByFreelancer
 *   submission?: ReturnType<typeof parseContractForm> | null,   a POST's parsed body; null on a GET
 *   duplicate?: { id: string, name: string, email: string } | null,   add-client: the first case-insensitive match, when unconfirmed
 *   createdClientId?: string | null,   add-client: the row the route created
 *   clientRefused?: boolean,     generate: NotFoundError with entity 'client' — the id the parser accepted is not this freelancer's
 *   generationFailed?: boolean,  generate: anything else thrown
 * }} [input]
 * @returns {object} the template's locals, plus `status`. Not frozen — express
 *   adds `_locals` to the object it is handed. The picker locals are NAMED
 *   IDENTICALLY to invoice-form-view.js's, so the eventual extraction
 *   (lib/screens/client-picker.js, at the third consumer) is a move.
 */
export function contractFormLocals(input = {}) {
  const clients = Array.isArray(input.clients) ? input.clients : [];
  const submission = input.submission ?? null;
  const intent = submission === null ? null : submission.intent;
  const values = submission === null ? null : submission.values;
  const duplicate = intent === 'add-client' ? input.duplicate ?? null : null;
  const createdClientId = intent === 'add-client' ? input.createdClientId ?? null : null;
  const clientErrors = intent === 'add-client' ? clientFieldErrors(values) : { clientName: null, clientEmail: null };
  const clientInvalid = clientErrors.clientName !== null || clientErrors.clientEmail !== null;
  // generate refusing a clientId the parser accepted (a foreign or unknown id)
  // is marked exactly like an unselected one — the answer for someone else's
  // client is indistinguishable from no client.
  const persisting = intent === 'generate';
  const refused = persisting && input.clientRefused === true && submission.errors.clientId === false;
  const errorCount = submission === null ? 0 : submission.fieldErrorCount + (refused ? 1 : 0);
  const formInvalid = submission !== null && (intent === null || (persisting && errorCount > 0));

  let state;
  if (intent === 'add-client' && clientInvalid) state = 'S6-CLIENT-ERROR-VALIDATION';
  else if (intent === 'add-client' && duplicate !== null) state = 'S6-CLIENT-ERROR-DUPLICATE';
  else if (formInvalid) state = 'S6-ERROR-VALIDATION';
  else if (persisting && input.generationFailed === true) state = 'S6-ERROR-SYSTEM';
  else if (clients.length === 0) state = 'S6-CLIENT-EMPTY';
  else state = 'S6-DEFAULT';

  // --- the picker (invoice-form-view.js's block, carried a second time) ------
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

  // Field errors show only on a generate that failed; an unknown intent gets
  // the dispatch banner and its values back, unmarked.
  const showErrors = state === 'S6-ERROR-VALIDATION' && persisting;
  let clientError = null;
  if (showErrors && (submission.errors.clientId || refused)) {
    clientError = pickerMode === 'new' ? FIELD_MESSAGE.clientAddFirst : FIELD_MESSAGE.client;
  }

  // --- the declared fields ----------------------------------------------------
  const submitted = submission === null ? new Map() : new Map(submission.fields.map((field) => [field.name, field.value]));
  const fields = formVariables().map((variable) => ({
    name: variable.name,
    label: variable.label ?? variable.name,
    type: variable.type,
    required: variable.required === true,
    value: submitted.get(variable.name) ?? '',
    error: showErrors && submission.errors[variable.name] === true
      ? FIELD_MESSAGE[variable.name] ?? FIELD_MESSAGE.required
      : null,
  }));

  // --- banner ---------------------------------------------------------------
  let banner = null;
  if (state === 'S6-ERROR-VALIDATION') {
    banner = intent === null
      ? { tone: 'error', title: null, message: CHOOSE_ACTION }
      : { tone: 'error', title: attentionTitle(errorCount), message: VALIDATION_MESSAGE };
  } else if (state === 'S6-CLIENT-ERROR-VALIDATION') {
    const n = (clientErrors.clientName === null ? 0 : 1) + (clientErrors.clientEmail === null ? 0 : 1);
    banner = { tone: 'error', title: attentionTitle(n), message: VALIDATION_MESSAGE };
  }
  // The duplicate warning is NOT the page banner: it is non-blocking and its
  // two offers are submit buttons, so it renders inside the form, in the
  // picker, where the wireframe draws it.
  const duplicateMatch = state === 'S6-CLIENT-ERROR-DUPLICATE'
    ? { before: DUPLICATE_BEFORE, label: optionLabel(duplicate), after: DUPLICATE_AFTER }
    : null;

  const title = TITLE_OVERRIDE[state] ?? `${TITLE}${TITLE_SUFFIX[state] ?? ''}`;

  return {
    state,
    status: STATE_STATUS[state],
    title,
    isSystem: state === 'S6-ERROR-SYSTEM',
    banner,
    placeholder: { title: PLACEHOLDER_TITLE, message: PLACEHOLDER_MESSAGE },
    fields,
    fieldErrorCount: showErrors ? errorCount : 0,
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
    clientNameError: state === 'S6-CLIENT-ERROR-VALIDATION' ? clientErrors.clientName : null,
    clientEmailError: state === 'S6-CLIENT-ERROR-VALIDATION' ? clientErrors.clientEmail : null,
    duplicate: duplicateMatch,
    duplicateId: duplicateMatch === null ? '' : duplicate.id,
  };
}
