// invoice-screen.test.js — screen 4, invoice create/edit, every state
// (AS-46, plan §3, §7).
//
// THIS FILE'S ONE CLAIM: every row in docs/design/wireframes/02-states-ledger.md
// §4 — the deepest ledger in the set, twelve rows — is accounted for: rendered
// and asserted on a sentinel, answered by a redirect, named as a path into
// another render, or recorded as unrenderable with the reason. The same R-4
// caveat as screens.test.js: the table below and INVOICE_FORM_LEDGER are two
// independent hand transcriptions compared against each other; fidelity to the
// document is a dated review act, not a test.
//
// A NEW FILE rather than screen 4's half of screens.test.js, because AS-70 is
// adding screen 2's half there in a parallel lane and the two halves together
// would push that file past the 1,200-line cap (plan §3.6). The three shared
// view-layer checks in screens.test.js iterate VIEWS and read app.css, so they
// bind this template and these rules with nothing added here.
//
// Everything runs offline. Stripe-derived behaviour is reachable because the
// screen renders the STORED row, and the two send cases inject a canned
// transport through withServer's third argument — the invoices.test.js shape,
// in miniature.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VIEWS } from '../lib/views.js';
import {
  INTENTS,
  INVOICE_FORM_LEDGER,
  INVOICE_FORM_STATES,
  MAX_LINE_ITEMS,
  STATE_STATUS,
  invoiceFormLocals,
  parseInvoiceForm,
} from '../lib/screens/invoice-form-view.js';
import { formatMinorUnits, parseMajorUnits } from '../lib/db/money.js';
import { readinessFromAccount } from '../lib/connect/readiness.js';
import { createStripeClient } from '../lib/stripe/client.js';
import { discoverRoutes } from './helpers/routes.js';
import { configFor, followToTerminus, seedSession, signedInHeaders, withServer } from './helpers/server.js';

const KEY = 'unit-test-placeholder-key';
const TS = '2026-09-12T10:00:00.000Z';
const ACCT = 'acct_fixture1';
const NEW = '/invoices/new';
const editPath = (id) => `/invoices/${id}/edit`;
const detailPath = (id) => `/invoices/${id}`;

/** OCCURRENCE counting, never a boolean `includes` (the screens.test.js rule). */
const occurrences = (haystack, needle) => haystack.split(needle).length - 1;

function stateOf(html) {
  const match = html.match(/data-state="([^"]*)"/);
  return match === null ? null : match[1];
}

// =============================================================================
// The ledger, transcribed. Cardinality and membership before anything else.
// =============================================================================

/** 02-states-ledger.md §4, all twelve rows, in the document's own order,
 *  transcribed BY HAND and independently of the view model's copy. */
const SCREEN_4_LEDGER = [
  ['S4-DEFAULT-CREATE', 'rendered'],
  ['S4-DEFAULT-EDIT', 'rendered'],
  ['S4-LOADING', 'unrenderable — browser-supplied'],
  ['S4-CLIENT-EMPTY', 'rendered'],
  ['S4-ERROR-VALIDATION', 'rendered'],
  ['S4-ERROR-SYSTEM', 'rendered'],
  ['S4-CLIENT-ERROR-VALIDATION', 'rendered'],
  ['S4-CLIENT-ERROR-DUPLICATE', 'rendered'],
  ['S4-GATED-STRIPENOTREADY', 'rendered'],
  ['S4-DENIED-SIGNEDOUT', 'redirect-answered'],
  ['S4-ABANDON', 'path-into-render'],
  ['S4-CLIENT-ABANDON', 'path-into-render'],
];

test('screen 4 accounts for all twelve of its ledger rows: 8 + 1 + 2 + 1 + 0 = 12', () => {
  assert.equal(SCREEN_4_LEDGER.length, 12, 'the ledger table transcribed here has twelve rows');
  assert.equal(INVOICE_FORM_LEDGER.length, 12, `the view model accounts for ${INVOICE_FORM_LEDGER.length} rows, expected 12`);
  const declared = INVOICE_FORM_LEDGER.map((row) => [row.id, row.disposition]).sort();
  assert.deepEqual(declared, [...SCREEN_4_LEDGER].sort());

  // The partition, as arithmetic — and the zero is ASSERTED: the ledger says
  // screen 4 has no n/a row (02-states-ledger §8), so the bucket must be empty,
  // not merely absent from the sum.
  const bucket = (disposition) => INVOICE_FORM_LEDGER.filter((row) => row.disposition === disposition).map((row) => row.id);
  assert.equal(bucket('rendered').length, 8);
  assert.deepEqual(bucket('redirect-answered'), ['S4-DENIED-SIGNEDOUT']);
  assert.deepEqual(bucket('path-into-render'), ['S4-ABANDON', 'S4-CLIENT-ABANDON']);
  assert.deepEqual(bucket('unrenderable — browser-supplied'), ['S4-LOADING']);
  assert.deepEqual(bucket('n/a'), [], 'screen 4 has no n/a row, by the ledger\'s own statement');
  assert.equal(8 + 1 + 2 + 1 + 0, INVOICE_FORM_LEDGER.length);

  assert.equal(INVOICE_FORM_STATES.length, 8, `${INVOICE_FORM_STATES.length} rendered states, expected 8`);
  assert.deepEqual([...INVOICE_FORM_STATES].sort(), Object.keys(STATE_STATUS).sort(), 'every rendered state has a status, and nothing else does');
  assert.ok(Object.isFrozen(INVOICE_FORM_STATES) && Object.isFrozen(INVOICE_FORM_LEDGER), 'both lists are frozen');
});

// Pure fixtures for the view model.
const READY = { ready: true };
const NOT_READY = { ready: false };
const CLIENTS = [{ id: 'c1', name: 'Ada Example', email: 'ada@example.test' }];
const FILLED = { intent: 'save', clientId: 'c1', daysUntilDue: '30', lineItems: [{ description: 'Work', quantity: '1', unitPrice: '10.00' }] };

test('the view model reaches every rendered state, exhaustively, with no HTTP at all', () => {
  const reached = {
    'S4-GATED-STRIPENOTREADY': invoiceFormLocals({ account: null, clients: CLIENTS }),
    'S4-CLIENT-ERROR-VALIDATION': invoiceFormLocals({ account: READY, clients: CLIENTS, submission: parseInvoiceForm({ intent: 'add-client', clientName: 'Dee', clientEmail: '' }) }),
    'S4-CLIENT-ERROR-DUPLICATE': invoiceFormLocals({ account: READY, clients: CLIENTS, submission: parseInvoiceForm({ intent: 'add-client', clientName: 'Ada E.', clientEmail: 'ADA@EXAMPLE.TEST' }), duplicate: CLIENTS[0] }),
    'S4-ERROR-VALIDATION': invoiceFormLocals({ account: READY, clients: CLIENTS, submission: parseInvoiceForm({ intent: 'save' }) }),
    'S4-ERROR-SYSTEM': invoiceFormLocals({ mode: 'edit', account: READY, clients: CLIENTS, sendFailed: true }),
    'S4-CLIENT-EMPTY': invoiceFormLocals({ account: READY, clients: [] }),
    'S4-DEFAULT-EDIT': invoiceFormLocals({ mode: 'edit', account: READY, clients: CLIENTS }),
    'S4-DEFAULT-CREATE': invoiceFormLocals({ account: READY, clients: CLIENTS }),
  };
  for (const [state, locals] of Object.entries(reached)) {
    assert.equal(locals.state, state);
    assert.equal(locals.status, STATE_STATUS[state], `${state} answers ${STATE_STATUS[state]}`);
  }
  assert.deepEqual(Object.keys(reached).sort(), [...INVOICE_FORM_STATES].sort(), 'every rendered state is reachable from route inputs alone');

  // Precedence: the gate outranks everything, both halves of `ready`.
  assert.equal(invoiceFormLocals({ account: NOT_READY, clients: CLIENTS, submission: parseInvoiceForm({ intent: 'add-client' }) }).state, 'S4-GATED-STRIPENOTREADY');
  // An unknown, absent or repeated intent lands on the validation state with
  // the dispatch banner and no field marked.
  for (const intent of ['drop', undefined, ['save', 'send']]) {
    const locals = invoiceFormLocals({ account: READY, clients: CLIENTS, submission: parseInvoiceForm({ intent, ...FILLED, intent }) });
    assert.equal(locals.state, 'S4-ERROR-VALIDATION', JSON.stringify(intent));
    assert.equal(locals.banner.message, 'Choose an action.');
    assert.equal(locals.clientError, null);
  }
  // ?error selects S4-ERROR-SYSTEM by PRESENCE, and its value never arrives:
  // the input is a boolean, a truthy non-boolean (the raw query value, had a
  // route leaked it) selects nothing, and the marker appears in no local.
  const leaked = invoiceFormLocals({ mode: 'edit', account: READY, clients: CLIENTS, sendFailed: 'ASC46MARK' });
  assert.equal(leaked.state, 'S4-DEFAULT-EDIT', 'only the boolean true selects the system state');
  assert.equal(occurrences(JSON.stringify(leaked), 'ASC46MARK'), 0);
  assert.equal(occurrences(JSON.stringify(invoiceFormLocals({ mode: 'edit', account: READY, clients: CLIENTS, sendFailed: true })), 'ASC46MARK'), 0);
  // No local is the invoice id, in any state: there is no key for it to live in.
  for (const locals of Object.values(reached)) {
    assert.equal(Object.keys(locals).some((key) => /invoiceId|\bid\b/.test(key)), false);
  }
  assert.equal(INTENTS.length, 6, 'the closed intent set');
});

test('clientEmailRefused (AS-128): the repository\'s shape refusal is S4-CLIENT-ERROR-VALIDATION on the email field alone, blank wins over it, and it means nothing outside add-client', () => {
  const typed = { intent: 'add-client', clientName: 'Dee', clientEmail: 'not-an-email' };
  const refused = invoiceFormLocals({ account: READY, clients: CLIENTS, submission: parseInvoiceForm(typed), clientEmailRefused: true });
  assert.equal(refused.state, 'S4-CLIENT-ERROR-VALIDATION');
  assert.equal(refused.status, 400);
  assert.equal(refused.clientEmailError, 'Enter a complete email address.');
  assert.equal(refused.clientNameError, null);
  assert.equal(refused.clientEmail, 'not-an-email', 'as typed');
  assert.equal(refused.banner.title, '1 field needs attention');
  // Without the flag the same well-formed-to-the-screen email is not an error:
  // the screen has no shape rule of its own (AS-67 D6).
  assert.equal(invoiceFormLocals({ account: READY, clients: CLIENTS, submission: parseInvoiceForm(typed) }).state, 'S4-DEFAULT-CREATE');
  // Blank wins: a blank email reports what it always has, flag or no flag.
  const blank = invoiceFormLocals({ account: READY, clients: CLIENTS, submission: parseInvoiceForm({ ...typed, clientEmail: ' ' }), clientEmailRefused: true });
  assert.equal(blank.state, 'S4-CLIENT-ERROR-VALIDATION');
  assert.equal(blank.clientEmailError, 'This field is required.');
  // Only the boolean true, and only under add-client.
  assert.equal(invoiceFormLocals({ account: READY, clients: CLIENTS, submission: parseInvoiceForm(typed), clientEmailRefused: 'yes' }).state, 'S4-DEFAULT-CREATE');
  const onSave = invoiceFormLocals({ account: READY, clients: CLIENTS, submission: parseInvoiceForm(FILLED), clientEmailRefused: true });
  assert.equal(onSave.state, 'S4-DEFAULT-CREATE');
  assert.equal(onSave.clientEmailError, null);
});

// =============================================================================
// HTTP: the app under test
// =============================================================================

/** A Stripe ACCOUNT object, mapped through AS-41's readiness mapper so this
 *  file names no readiness field (the invoices.test.js idiom). */
function stripeAccount({ charges = true, due = [] } = {}) {
  return {
    id: ACCT,
    object: 'account',
    charges_enabled: charges,
    details_submitted: true,
    payouts_enabled: charges,
    requirements: { currently_due: due, disabled_reason: due.length === 0 ? null : 'requirements.past_due' },
  };
}

const json = (data, status = 200) => ({ status, headers: { 'request-id': 'req_fixture' }, body: JSON.stringify(data) });

/** Canned-and-computing Stripe behind the REAL pipeline — invoices.test.js's
 *  fixture in miniature: customers, invoices, items (summed), finalize, send.
 *  `intercept(record)` may return a reply to override. */
function fixtureTransport({ intercept } = {}) {
  const calls = [];
  const totals = new Map();
  let seq = 0;
  const nextId = (prefix) => `${prefix}_fixture${(seq += 1)}`;
  const invoiceObject = (id, total, open) => ({
    id,
    object: 'invoice',
    status: open ? 'open' : 'draft',
    currency: 'usd',
    amount_due: total,
    amount_paid: 0,
    hosted_invoice_url: open ? `https://pay.example.test/${id}` : null,
    invoice_pdf: open ? `https://pay.example.test/${id}.pdf` : null,
    due_date: 1234567890,
    status_transitions: { finalized_at: open ? 1788336000 : null, marked_uncollectible_at: null, paid_at: null, voided_at: null },
  });
  const transport = async (signed) => {
    const record = { method: signed.method, path: signed.url.pathname, body: signed.body };
    calls.push(record);
    if (intercept !== undefined) {
      const reply = await intercept(record);
      if (reply !== undefined) return reply;
    }
    const params = new URLSearchParams(record.body ?? '');
    if (record.path === '/v1/customers') return json({ id: nextId('cus'), object: 'customer' });
    if (record.path === '/v1/invoices') {
      const id = nextId('in');
      totals.set(id, 0);
      return json(invoiceObject(id, 0, false));
    }
    if (record.path === '/v1/invoiceitems') {
      const target = params.get('invoice');
      totals.set(target, (totals.get(target) ?? 0) + Number(params.get('amount')));
      return json({ id: nextId('ii'), object: 'invoiceitem' });
    }
    const issued = record.path.match(/^\/v1\/invoices\/([^/]+)\/(finalize|send)$/);
    if (issued !== null) return json(invoiceObject(issued[1], totals.get(issued[1]) ?? 0, true));
    throw new Error(`fixture transport: unexpected ${record.method} ${record.path}`);
  };
  return { transport, calls };
}

/** withServer + a freelancer, a connected account in the requested readiness,
 *  `clients` seeded clients and a session. `connected: false` seeds no row. */
async function withScreenApp({ connected = true, charges = true, due = [], clients = 1, fixture = {} } = {}, fn) {
  const { transport, calls } = fixtureTransport(fixture);
  const stripe = createStripeClient({ apiKey: KEY, transport });
  await withServer(configFor(), async (base, app, deps) => {
    const repos = deps.repos;
    const freelancer = repos.freelancers.create({ email: 'f@example.test', displayName: 'Freda Lancer' });
    if (connected) {
      repos.connectedAccounts.create({ freelancerId: freelancer.id, stripeAccountId: ACCT });
      repos.connectedAccounts.updateReadiness(ACCT, readinessFromAccount(stripeAccount({ charges, due }), TS));
    }
    const seeded = [];
    for (let i = 0; i < clients; i += 1) {
      seeded.push(repos.clients.create(freelancer.id, { name: `Client ${i + 1}`, email: `client${i + 1}@example.test` }));
    }
    const { cookie } = seedSession(repos, freelancer.id);
    const headers = signedInHeaders(base, cookie);
    const get = (path) => fetch(`${base}${path}`, { redirect: 'manual', headers });
    const post = (path, fields) => fetch(`${base}${path}`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
      body: typeof fields === 'string' ? fields : new URLSearchParams(fields).toString(),
    });
    const setReady = (ready) => repos.connectedAccounts.updateReadiness(ACCT, readinessFromAccount(stripeAccount({ charges: ready }), TS));
    await fn({ base, app, repos, freelancer, client: seeded[0] ?? null, clients: seeded, cookie, get, post, calls, setReady });
  }, { stripe });
}

/** Form fields for `rows`, in the shape the template posts. */
function itemFields(rows) {
  const out = {};
  rows.forEach((row, index) => {
    out[`lineItems[${index}][description]`] = row.description;
    out[`lineItems[${index}][quantity]`] = row.quantity;
    out[`lineItems[${index}][unitPrice]`] = row.unitPrice;
  });
  return out;
}
const blank = { description: '', quantity: '', unitPrice: '' };
const goodForm = (clientId, over = {}) => ({
  intent: 'save',
  clientId,
  daysUntilDue: '30',
  ...itemFields([{ description: 'Website redesign — phase 1', quantity: '1', unitPrice: '1200.00' }, blank, blank]),
  ...over,
});
const rowCount = (html) => occurrences(html, 'class="line-item-row"');
const optionSelected = (html, id) => occurrences(html, `<option value="${id}" selected>`);

// --- the defaults ---------------------------------------------------------------

test('S4-DEFAULT-CREATE: a ready freelancer with a client gets the form with the picker in select mode and three blank rows', async () => {
  await withScreenApp({}, async ({ get, client }) => {
    const res = await get(NEW);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.equal(stateOf(html), 'S4-DEFAULT-CREATE');
    assert.equal(occurrences(html, '<select id="clientId" name="clientId"'), 1, 'exactly one client select');
    assert.equal(rowCount(html), 3, 'three blank rows');
    assert.equal(occurrences(html, 'name="lineItems['), 9, 'three fields per row');
    assert.equal(occurrences(html, 'value="new-client"'), 1, 'the add-a-new-client toggle is present');
    assert.equal(occurrences(html, '<option value="' + client.id + '"'), 1);
    assert.equal(occurrences(html, 'value="send"'), 1, 'one send control');
    assert.ok(html.includes('<strong>Stripe</strong> sends it directly to the client'), 'the C-28 sentence: Stripe emails the client');
    assert.equal(occurrences(html, 'action='), 1, 'the only action attribute is the sign-out form\'s');
    assert.equal(occurrences(html, '<form method="post">'), 1, 'the invoice form has no action — the page URL is the target');
    assert.equal(occurrences(html, 'value="30"'), 1, 'the default due terms');
  });
});

test('S4-DEFAULT-EDIT: the stored draft is pre-populated, prices formatted from minor units, one blank row appended', async () => {
  await withScreenApp({ clients: 2 }, async ({ get, repos, freelancer, clients }) => {
    const draft = repos.invoices.createDraft(freelancer.id, {
      clientId: clients[1].id,
      daysUntilDue: 14,
      lineItems: [
        { description: 'Logo concepts', quantity: 1, unitAmountMinor: 120000 },
        { description: 'Revisions', quantity: 3, unitAmountMinor: 1999 },
      ],
    });
    const res = await get(editPath(draft.id));
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.equal(stateOf(html), 'S4-DEFAULT-EDIT');
    assert.equal(occurrences(html, 'value="1200.00"'), 1);
    assert.equal(occurrences(html, 'value="19.99"'), 1);
    assert.equal(occurrences(html, 'value="Logo concepts"'), 1);
    assert.equal(occurrences(html, 'value="3"'), 1);
    assert.equal(rowCount(html), 3, 'two stored rows plus one blank');
    assert.equal(optionSelected(html, clients[1].id), 1, 'the draft\'s client is selected');
    assert.equal(optionSelected(html, clients[0].id), 0);
    assert.equal(occurrences(html, 'value="14"'), 1, 'days matches');
    assert.equal(occurrences(html, draft.id), 0, 'the invoice id appears nowhere in the page');
    assert.equal(occurrences(html, 'unitAmountMinor'), 0, 'the API\'s field name never reaches the browser');
  });
});

test('S4-CLIENT-EMPTY: with zero clients the picker opens in add-new mode and no select renders', async () => {
  await withScreenApp({ clients: 0 }, async ({ get }) => {
    const res = await get(NEW);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.equal(stateOf(html), 'S4-CLIENT-EMPTY');
    assert.equal(occurrences(html, '<select'), 0, 'no select in the markup at all');
    assert.ok(html.includes('No clients yet — add one below.'));
    assert.equal(occurrences(html, 'value="new-client"'), 0, 'no toggle to a mode that has nothing behind it');
    assert.equal(occurrences(html, 'value="existing-client"'), 0);
    assert.equal(occurrences(html, 'name="clientName"'), 1);
    assert.equal(occurrences(html, 'name="clientEmail"'), 1);
    assert.equal(rowCount(html), 3, 'the rest of the form renders as in S4-DEFAULT-CREATE');
  });
});

// --- validation, the stack decision's test ---------------------------------------

test('S4-ERROR-VALIDATION re-renders every submitted value as typed and marks each failing field', async () => {
  // docs/engineering/01-stack-decision.md §10.4 item 3: the re-render test.
  await withScreenApp({}, async ({ post, repos, freelancer }) => {
    const submitted = {
      intent: 'save',
      clientId: '',
      daysUntilDue: '0',
      ...itemFields([{ description: '', quantity: '1.5', unitPrice: 'abc' }, blank, blank]),
    };
    const res = await post(NEW, submitted);
    assert.equal(res.status, 400);
    const html = await res.text();
    assert.equal(stateOf(html), 'S4-ERROR-VALIDATION');
    assert.equal(occurrences(html, 'class="field field--invalid"'), 5, 'five fields are marked');
    assert.ok(html.includes('5 fields need attention'), 'the banner agrees with the count');
    // Every submitted string comes back byte-for-byte, the price `abc`
    // included — as typed, never normalised.
    assert.equal(occurrences(html, 'name="lineItems[0][quantity]" value="1.5"'), 1);
    assert.equal(occurrences(html, 'name="lineItems[0][unitPrice]" value="abc"'), 1);
    assert.equal(occurrences(html, 'name="daysUntilDue" value="0"'), 1);
    assert.equal(occurrences(html, 'name="lineItems[0][description]" value=""'), 1);
    assert.equal(rowCount(html), 3, 'the blank rows come back too');
    assert.ok(html.includes('Enter a price like 1200.00.'));
    assert.ok(html.includes('Enter a whole number of at least 1.'));
    assert.ok(html.includes('Enter at least 1 day.'));
    assert.ok(html.includes('Select a client.'));
    assert.ok(html.includes('This field is required.'));
    assert.equal(repos.invoices.listByFreelancer(freelancer.id).length, 0, 'nothing was persisted');
    assert.equal(occurrences(html, 'ValidationError'), 0, 'no error class is copy');
  });
});

test('in add-new picker mode a save or send without a client marks exactly the field the banner counts', async () => {
  // Review cycle 1, D1: the picker in add-new mode has no <select>, so the
  // client-required error needs its own slot — the banner's number and the
  // page's markers must agree, in both ways into that mode (zero clients, and
  // one client with the picker toggled) and for both persisting intents.
  const bannerCount = (html) => {
    const match = html.match(/(\d+) fields? needs? attention/);
    return match === null ? null : Number(match[1]);
  };
  const markers = (html) => occurrences(html, 'class="field field--invalid"');
  const valid = { daysUntilDue: '30', ...itemFields([{ description: 'Work', quantity: '1', unitPrice: '10.00' }]) };
  for (const clients of [0, 1]) {
    await withScreenApp({ clients }, async ({ post, repos, freelancer }) => {
      for (const intent of ['save', 'send']) {
        const res = await post(NEW, { intent, pickerMode: 'new', ...valid });
        const label = `${clients} client(s), intent=${intent}`;
        assert.equal(res.status, 400, label);
        const html = await res.text();
        assert.equal(stateOf(html), 'S4-ERROR-VALIDATION', label);
        assert.equal(occurrences(html, '<select'), 0, `${label}: still add-new mode`);
        assert.equal(bannerCount(html), 1, `${label}: the banner counts one field`);
        assert.equal(markers(html), bannerCount(html), `${label}: the page marks what the banner counts`);
        assert.equal(occurrences(html, 'Add the client first.'), 1, `${label}: the add-new copy, once`);
        assert.equal(occurrences(html, 'Select a client.'), 0, `${label}: nothing to select from`);
        assert.equal(occurrences(html, 'name="clientName"'), 1, `${label}: the sub-form still renders`);
        assert.equal(repos.invoices.listByFreelancer(freelancer.id).length, 0, `${label}: nothing persisted`);
      }
      // The select-mode copy is unchanged: the same valid form with the picker
      // in select mode and no client chosen marks the select.
      if (clients === 1) {
        const res = await post(NEW, { intent: 'save', pickerMode: 'select', clientId: '', ...valid });
        const html = await res.text();
        assert.equal(res.status, 400);
        assert.equal(markers(html), 1);
        assert.equal(occurrences(html, 'Select a client.'), 1);
        assert.equal(occurrences(html, 'Add the client first.'), 0);
      }
    });
  }
});

test('line items are accepted in both shapes qs produces, and 25 rows survive a re-render in order', async () => {
  // Pure first: the parser takes the array qs yields below its limit and the
  // index-keyed object it yields above it.
  const asArray = parseInvoiceForm({ intent: 'save', clientId: 'c1', daysUntilDue: '1', lineItems: [{ description: 'a', quantity: '1', unitPrice: '1' }] });
  const asObject = parseInvoiceForm({ intent: 'save', clientId: 'c1', daysUntilDue: '1', lineItems: { 1: { description: 'b', quantity: '1', unitPrice: '1' }, 0: { description: 'a', quantity: '1', unitPrice: '1' } } });
  assert.deepEqual(asArray.draft.lineItems.map((i) => i.description), ['a']);
  assert.deepEqual(asObject.draft.lineItems.map((i) => i.description), ['a', 'b'], 'object keys are ordered numerically');

  await withScreenApp({}, async ({ post, repos, freelancer, client }) => {
    // 24 filled rows + add-row -> 25 rows re-rendered, nothing persisted.
    const rows = Array.from({ length: 24 }, (_, i) => ({ description: `Item ${i}`, quantity: String(i + 1), unitPrice: `${i}.50` }));
    const grown = await post(NEW, { intent: 'add-row', clientId: client.id, daysUntilDue: '30', ...itemFields(rows) });
    assert.equal(grown.status, 200);
    const html = await grown.text();
    assert.equal(rowCount(html), 25);
    assert.equal(occurrences(html, 'value="Item 23"'), 1);
    assert.equal(repos.invoices.listByFreelancer(freelancer.id).length, 0);
    // Then 25 filled rows saved: positions 0..24 in order. Twenty-five is past
    // qs's array limit, so this body arrives as the OBJECT shape.
    rows.push({ description: 'Item 24', quantity: '25', unitPrice: '24.50' });
    const saved = await post(NEW, { intent: 'save', clientId: client.id, daysUntilDue: '30', ...itemFields(rows) });
    assert.equal(saved.status, 303, await saved.text());
    const [draft] = repos.invoices.listByFreelancer(freelancer.id);
    const full = repos.invoices.getById(freelancer.id, draft.id);
    assert.equal(full.lineItems.length, 25);
    assert.deepEqual(full.lineItems.map((i) => i.position), Array.from({ length: 25 }, (_, i) => i));
    assert.deepEqual(full.lineItems.map((i) => i.description), rows.map((r) => r.description));
    assert.equal(full.lineItems[24].unitAmountMinor, 2450);
  });
});

test('a fully blank row is dropped, a partly blank row is refused, and a form with no usable row is refused', async () => {
  await withScreenApp({}, async ({ post, repos, freelancer, client }) => {
    // 1. A blank row among filled ones is dropped: the draft has two items.
    const dropped = await post(NEW, goodForm(client.id, {
      ...itemFields([{ description: 'A', quantity: '1', unitPrice: '1.00' }, blank, { description: 'B', quantity: '2', unitPrice: '2.00' }]),
    }));
    assert.equal(dropped.status, 303);
    const [draft] = repos.invoices.listByFreelancer(freelancer.id);
    assert.deepEqual(repos.invoices.getById(freelancer.id, draft.id).lineItems.map((i) => i.description), ['A', 'B']);
    // 2. A partly blank row is an error on its blank fields.
    const partly = await post(NEW, goodForm(client.id, { ...itemFields([{ description: 'A', quantity: '', unitPrice: '1.00' }]) }));
    assert.equal(partly.status, 400);
    const partlyHtml = await partly.text();
    assert.equal(stateOf(partlyHtml), 'S4-ERROR-VALIDATION');
    assert.equal(occurrences(partlyHtml, 'class="field field--invalid"'), 1);
    assert.ok(partlyHtml.includes('1 field needs attention'));
    // 3. No usable row at all.
    const none = await post(NEW, goodForm(client.id, { ...itemFields([blank, blank, blank]) }));
    assert.equal(none.status, 400);
    const noneHtml = await none.text();
    assert.ok(noneHtml.includes('Add at least one line item.'));
    assert.equal(repos.invoices.listByFreelancer(freelancer.id).length, 1, 'only the first submit persisted');
  });
});

// --- the system error ----------------------------------------------------------

test('S4-ERROR-SYSTEM: a send that fails at Stripe lands on the edit page with the system banner, the draft still a draft', async () => {
  const fixture = { intercept: (record) => (record.path === '/v1/customers' ? json({ error: { type: 'api_error' } }, 500) : undefined) };
  await withScreenApp({ fixture }, async ({ post, get, repos, freelancer, client, calls }) => {
    const res = await post(NEW, goodForm(client.id, { intent: 'send' }));
    assert.equal(res.status, 303);
    const [draft] = repos.invoices.listByFreelancer(freelancer.id);
    assert.equal(res.headers.get('location'), `${editPath(draft.id)}?error=send`, 'post-redirect-get with a presence flag');
    assert.equal(calls.filter((c) => c.path === '/v1/customers').length, 1, 'the failing call was made once');
    const landing = await get(res.headers.get('location'));
    assert.equal(landing.status, 200);
    const html = await landing.text();
    assert.equal(stateOf(html), 'S4-ERROR-SYSTEM');
    assert.ok(html.includes('Your draft is unchanged — try again.'));
    const row = repos.invoices.getById(freelancer.id, draft.id);
    assert.equal(row.status, 'draft');
    assert.equal(row.stripeInvoiceId, null);
    assert.equal(occurrences(html, 'value="1200.00"'), 1, 'the saved draft renders, ready to retry');
    // The flag is PRESENCE: any value selects the state and is echoed nowhere.
    const marked = await get(`${editPath(draft.id)}?error=ASC46MARK`);
    const markedHtml = await marked.text();
    assert.equal(stateOf(markedHtml), 'S4-ERROR-SYSTEM');
    assert.equal(occurrences(markedHtml, 'ASC46MARK'), 0);
    const arrayed = await get(`${editPath(draft.id)}?error[]=ASC46MARK`);
    assert.equal(stateOf(await arrayed.text()), 'S4-ERROR-SYSTEM');
  });
});

// --- the client sub-pattern -----------------------------------------------------

test('S4-CLIENT-ERROR-VALIDATION: blank client fields re-render with every value preserved and no client row created', async () => {
  await withScreenApp({ clients: 0 }, async ({ post, repos, freelancer }) => {
    const res = await post(NEW, {
      intent: 'add-client',
      clientName: '',
      clientEmail: '   ',
      daysUntilDue: '21',
      ...itemFields([{ description: 'Kept', quantity: '2', unitPrice: '5.25' }]),
    });
    assert.equal(res.status, 400);
    const html = await res.text();
    assert.equal(stateOf(html), 'S4-CLIENT-ERROR-VALIDATION');
    assert.equal(occurrences(html, 'class="field field--invalid"'), 2, 'both client fields marked');
    assert.ok(html.includes('2 fields need attention'));
    assert.equal(occurrences(html, 'value="Kept"'), 1);
    assert.equal(occurrences(html, 'value="5.25"'), 1);
    assert.equal(occurrences(html, 'name="daysUntilDue" value="21"'), 1);
    assert.equal(occurrences(html, 'name="clientEmail" value="   "'), 1, 'as typed, whitespace included');
    assert.equal(repos.clients.listByFreelancer(freelancer.id).length, 0);
    assert.equal(repos.invoices.listByFreelancer(freelancer.id).length, 0);
  });
});

test('S4-CLIENT-ERROR-VALIDATION (AS-128): a malformed client email re-renders the form with every value preserved, the email marked, and no client row created', async () => {
  await withScreenApp({ clients: 0 }, async ({ post, repos, freelancer }) => {
    // Two bodies: one the repository refuses outright, one whose INNER
    // whitespace survives the screen's trim and is refused just the same.
    const emails = ['not-an-email', ' not an email '];
    assert.equal(emails.length, 2, 'cardinality first');
    for (const clientEmail of emails) {
      const res = await post(NEW, {
        intent: 'add-client',
        clientName: 'Dee Newclient',
        clientEmail,
        daysUntilDue: '21',
        ...itemFields([{ description: 'Kept', quantity: '2', unitPrice: '5.25' }]),
      });
      assert.equal(res.status, 400, clientEmail);
      assert.match(res.headers.get('content-type'), /^text\/html/, `${clientEmail}: the screen, not the API's text/plain line`);
      const html = await res.text();
      assert.equal(stateOf(html), 'S4-CLIENT-ERROR-VALIDATION', clientEmail);
      assert.equal(occurrences(html, 'class="field field--invalid"'), 1, `${clientEmail}: the email field alone is marked`);
      assert.equal(occurrences(html, 'id="clientEmail-error"'), 1, clientEmail);
      assert.equal(occurrences(html, 'id="clientName-error"'), 0, clientEmail);
      assert.ok(html.includes('Enter a complete email address.'), clientEmail);
      assert.ok(html.includes('1 field needs attention'), clientEmail);
      assert.equal(occurrences(html, 'value="Dee Newclient"'), 1, clientEmail);
      assert.equal(occurrences(html, `name="clientEmail" value="${clientEmail}"`), 1, `${clientEmail}: as typed, whitespace included`);
      assert.equal(occurrences(html, 'value="Kept"'), 1, clientEmail);
      assert.equal(occurrences(html, 'value="5.25"'), 1, clientEmail);
      assert.equal(occurrences(html, 'name="daysUntilDue" value="21"'), 1, clientEmail);
      assert.equal(occurrences(html, 'name="pickerMode" value="new"'), 1, `${clientEmail}: still in add-new mode`);
      assert.equal(repos.clients.listByFreelancer(freelancer.id).length, 0, clientEmail);
      assert.equal(repos.invoices.listByFreelancer(freelancer.id).length, 0, clientEmail);
    }
  });
});

test('add-client (AS-128) trims the email before the repository sees it: a padded address is created trimmed, and a padded match warns as the duplicate', async () => {
  await withScreenApp({ clients: 0 }, async ({ post, repos, freelancer }) => {
    const common = { intent: 'add-client', clientName: 'Dee Newclient', daysUntilDue: '30', ...itemFields([blank]) };
    const res = await post(NEW, { ...common, clientEmail: ' dee@example.test ' });
    assert.equal(res.status, 200);
    const clients = repos.clients.listByFreelancer(freelancer.id);
    assert.equal(clients.length, 1, 'exactly one client row');
    assert.equal(clients[0].email, 'dee@example.test', 'stored trimmed');
    const html = await res.text();
    assert.equal(stateOf(html), 'S4-DEFAULT-CREATE');
    assert.equal(optionSelected(html, clients[0].id), 1);
    // The trim reaches findByEmail too: the padded, re-cased match is the duplicate.
    const again = await post(NEW, { ...common, clientEmail: ' DEE@EXAMPLE.TEST ' });
    assert.equal(again.status, 200);
    const againHtml = await again.text();
    assert.equal(stateOf(againHtml), 'S4-CLIENT-ERROR-DUPLICATE');
    assert.equal(occurrences(againHtml, `name="duplicateId" value="${clients[0].id}"`), 1, 'the match, named');
    assert.equal(repos.clients.listByFreelancer(freelancer.id).length, 1, 'still one row');
  });
});

test('S4-CLIENT-ERROR-DUPLICATE: an email matching an existing client case-insensitively warns, names the match, creates nothing, and offers both ways forward', async () => {
  await withScreenApp({ clients: 0 }, async ({ post, repos, freelancer }) => {
    const ada = repos.clients.create(freelancer.id, { name: 'Ada Example', email: 'ada@example.test' });
    const res = await post(NEW, { intent: 'add-client', clientName: 'Ada E.', clientEmail: 'ADA@EXAMPLE.TEST', daysUntilDue: '30', ...itemFields([blank]) });
    assert.equal(res.status, 200, 'non-blocking: nothing was refused');
    const html = await res.text();
    assert.equal(stateOf(html), 'S4-CLIENT-ERROR-DUPLICATE');
    assert.ok(html.includes('This matches an existing client: <strong>Ada Example (ada@example.test)</strong>.'));
    assert.equal(occurrences(html, `<input type="hidden" name="duplicateId" value="${ada.id}" />`), 1);
    assert.equal(occurrences(html, 'name="clientConfirm" value="1"'), 1);
    assert.equal(occurrences(html, 'value="existing-client"'), 1, 'Use this client instead');
    assert.equal(occurrences(html, 'value="add-client"'), 1, 'Create a new client anyway — the only add-client control in this state');
    assert.equal(occurrences(html, 'name="clientEmail" value="ADA@EXAMPLE.TEST"'), 1, 'as typed');
    assert.equal(repos.clients.listByFreelancer(freelancer.id).length, 1, 'nothing created');
  });
});

test('the two duplicate offers work: "create anyway" adds a second row, "use this client instead" selects the existing one and adds none', async () => {
  await withScreenApp({ clients: 0 }, async ({ post, repos, freelancer }) => {
    const ada = repos.clients.create(freelancer.id, { name: 'Ada Example', email: 'ada@example.test' });
    const common = { clientName: 'Ada E.', clientEmail: 'ada@example.test', daysUntilDue: '30', ...itemFields([blank]) };
    // The offers exist on the rendered page before they are exercised (recipe
    // F11: the state's markup must be asserted by more than one path).
    const warned = await (await post(NEW, { intent: 'add-client', ...common })).text();
    assert.equal(stateOf(warned), 'S4-CLIENT-ERROR-DUPLICATE');
    assert.equal(occurrences(warned, 'value="existing-client"') + occurrences(warned, 'name="clientConfirm" value="1"'), 2, 'both offers are on the page');
    // "Create a new client anyway": the confirmation carries the create through.
    const anyway = await post(NEW, { intent: 'add-client', clientConfirm: '1', duplicateId: ada.id, ...common });
    assert.equal(anyway.status, 200);
    const all = repos.clients.listByFreelancer(freelancer.id);
    assert.equal(all.length, 2, 'a second row');
    const created = all.find((c) => c.id !== ada.id);
    const anywayHtml = await anyway.text();
    assert.equal(optionSelected(anywayHtml, created.id), 1, 'the new client is selected');
    assert.equal(optionSelected(anywayHtml, ada.id), 0);
    // "Use this client instead": selects the match, creates nothing.
    const instead = await post(NEW, { intent: 'existing-client', duplicateId: ada.id, ...common });
    assert.equal(instead.status, 200);
    const insteadHtml = await instead.text();
    assert.equal(stateOf(insteadHtml), 'S4-DEFAULT-CREATE');
    assert.equal(optionSelected(insteadHtml, ada.id), 1);
    assert.equal(repos.clients.listByFreelancer(freelancer.id).length, 2, 'no third row');
  });
});

test('add-client creates exactly one client and re-renders with it selected and every invoice value preserved', async () => {
  await withScreenApp({ clients: 0 }, async ({ post, repos, freelancer }) => {
    const res = await post(NEW, {
      intent: 'add-client',
      clientName: 'Dee Newclient',
      clientEmail: 'dee@example.test',
      daysUntilDue: '45',
      ...itemFields([{ description: 'Preserved', quantity: '4', unitPrice: '99.99' }]),
    });
    assert.equal(res.status, 200);
    const clients = repos.clients.listByFreelancer(freelancer.id);
    assert.equal(clients.length, 1, 'exactly one client row');
    assert.equal(clients[0].email, 'dee@example.test');
    const html = await res.text();
    assert.equal(stateOf(html), 'S4-DEFAULT-CREATE');
    assert.equal(optionSelected(html, clients[0].id), 1);
    assert.equal(occurrences(html, '<select'), 1, 'pickerMode back to select');
    assert.equal(occurrences(html, 'name="pickerMode" value="select"'), 1);
    assert.equal(occurrences(html, 'value="Preserved"'), 1);
    assert.equal(occurrences(html, 'value="99.99"'), 1);
    assert.equal(occurrences(html, 'name="daysUntilDue" value="45"'), 1);
    assert.equal(repos.invoices.listByFreelancer(freelancer.id).length, 0, 'no invoice row is a side effect of adding a client');
  });
});

// --- the gate ------------------------------------------------------------------

test('S4-GATED-STRIPENOTREADY refuses to render the form for no account and for each half of not-ready, and links to /connect-stripe', async () => {
  const halves = [
    ['no account row', { connected: false }],
    ['charges disabled', { charges: false }],
    ['requirements outstanding', { charges: true, due: ['external_account'] }],
  ];
  assert.equal(halves.length, 3, 'cardinality first: the null row and both halves of ready');
  for (const [why, seed] of halves) {
    await withScreenApp(seed, async ({ get }) => {
      const res = await get(NEW);
      assert.equal(res.status, 403, why);
      const html = await res.text();
      assert.equal(stateOf(html), 'S4-GATED-STRIPENOTREADY', why);
      assert.equal(occurrences(html, '<form'), 1, `${why}: the only form is the sign-out form`);
      assert.equal(occurrences(html, '<form class="site-nav__signout" method="post" action="/signout">'), 1, why);
      assert.equal(occurrences(html, 'href="/connect-stripe"'), 1, why);
      assert.ok(html.includes('You need to finish connecting Stripe before you can create an invoice.'), why);
      assert.equal(occurrences(html, 'name="lineItems['), 0, `${why}: no invoice field renders`);
    });
  }
});

test('the gate binds POST: a save from an unready account writes nothing', async () => {
  await withScreenApp({}, async ({ get, post, repos, freelancer, client, setReady }) => {
    assert.equal((await get(NEW)).status, 200, 'ready: the form renders');
    setReady(false);
    const res = await post(NEW, goodForm(client.id));
    assert.equal(res.status, 403);
    assert.equal(stateOf(await res.text()), 'S4-GATED-STRIPENOTREADY');
    assert.deepEqual(repos.invoices.listByFreelancer(freelancer.id), [], 'nothing written');
  });
});

test('S4-DENIED-SIGNEDOUT: each of the four screen routes is answered by the guard, and the GETs carry next', async () => {
  await withServer(configFor(), async (base) => {
    const headers = { origin: base };
    const newRes = await fetch(`${base}${NEW}`, { redirect: 'manual', headers });
    assert.equal(newRes.status, 303);
    assert.equal(newRes.headers.get('location'), '/signin?next=%2Finvoices%2Fnew');
    const editRes = await fetch(`${base}/invoices/some-id/edit`, { redirect: 'manual', headers });
    assert.equal(editRes.status, 303);
    assert.equal(editRes.headers.get('location'), '/signin?next=%2Finvoices%2Fsome-id%2Fedit');
    // Following the first renders screen 1 with next in the hidden input.
    const signin = await followToTerminus(base, newRes);
    assert.equal(signin.hops, 1);
    assert.equal(signin.status, 200);
    assert.equal(stateOf(signin.body), 'S1-DEFAULT-SIGNIN');
    assert.ok(signin.body.includes('<input type="hidden" name="next" value="/invoices/new" />'));
    for (const path of [NEW, '/invoices/some-id/edit']) {
      const res = await fetch(`${base}${path}`, { method: 'POST', redirect: 'manual', headers });
      assert.equal(res.status, 303, path);
      assert.equal(res.headers.get('location'), '/signin', `${path}: a POST carries no next`);
      assert.equal(res.headers.getSetCookie().length, 0, `${path}: the guard sets no cookie`);
    }
  });
});

// --- the two abandonment paths ---------------------------------------------------

test('S4-ABANDON: a second GET /invoices/new is byte-identical and nothing was created; the edit page shows the last saved draft after an unsaved re-render', async () => {
  await withScreenApp({}, async ({ get, post, repos, freelancer, client }) => {
    const first = await (await get(NEW)).text();
    const second = await (await get(NEW)).text();
    assert.equal(first, second, 'no resumed draft, no per-request token');
    assert.equal(repos.invoices.listByFreelancer(freelancer.id).length, 0);
    // Save, then re-render with different values WITHOUT saving, then GET.
    const saved = await post(NEW, goodForm(client.id));
    assert.equal(saved.status, 303);
    const [draft] = repos.invoices.listByFreelancer(freelancer.id);
    const unsaved = await post(editPath(draft.id), goodForm(client.id, { intent: 'add-row', ...itemFields([{ description: 'Unsaved change', quantity: '9', unitPrice: '9.99' }]) }));
    assert.equal(unsaved.status, 200);
    assert.equal(occurrences(await unsaved.text(), 'value="Unsaved change"'), 1, 'the re-render carries the unsaved value');
    const html = await (await get(editPath(draft.id))).text();
    assert.equal(stateOf(html), 'S4-DEFAULT-EDIT');
    assert.equal(occurrences(html, 'value="Unsaved change"'), 0, 'only the explicitly saved draft reappears');
    assert.equal(occurrences(html, 'value="Website redesign — phase 1"'), 1);
  });
});

test('S4-CLIENT-ABANDON: a new-client re-render creates no client, and the next GET starts the picker at its default variant', async () => {
  await withScreenApp({}, async ({ get, post, repos, freelancer }) => {
    const res = await post(NEW, { intent: 'new-client', clientName: 'Half typed', clientEmail: 'half@', daysUntilDue: '30', ...itemFields([blank]) });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.equal(occurrences(html, 'name="clientName" value="Half typed"'), 1, 'the attempt is on the page');
    assert.equal(occurrences(html, '<select'), 0, 'add-new mode');
    assert.equal(repos.clients.listByFreelancer(freelancer.id).length, 1, 'no client row from the attempt');
    const next = await (await get(NEW)).text();
    assert.equal(occurrences(next, '<select'), 1, 'back to the default variant');
    assert.equal(occurrences(next, 'Half typed'), 0, 'only the new-client attempt is lost');
  });
});

// --- escaping, money, success paths ---------------------------------------------

test('a value containing markup in a line-item description is rendered as text, not as markup', async () => {
  await withScreenApp({}, async ({ post, client }) => {
    const marker = 'ASC46MARK"><b>x</b>';
    const res = await post(NEW, goodForm(client.id, { daysUntilDue: '0', ...itemFields([{ description: marker, quantity: '1', unitPrice: '1.00' }]) }));
    assert.equal(res.status, 400);
    const html = await res.text();
    assert.equal(occurrences(html, 'ASC46MARK&#34;&gt;&lt;b&gt;'), 1, 'the value is present, escaped');
    assert.equal(occurrences(html, 'ASC46MARK"><b>'), 0, 'and the raw form appears nowhere');
    assert.equal(occurrences(html, '<b>x</b>'), 0, 'no element was created from the submitted value');
  });
});

test('save creates a draft with the typed prices converted exactly, and lands on an edit page that exists', async () => {
  await withScreenApp({}, async ({ post, repos, freelancer, client, cookie, base: baseUrl }) => {
    const rows = [
      { description: 'A', quantity: '1', unitPrice: '1200.00' },
      { description: 'B', quantity: '1', unitPrice: '5' },
      { description: 'C', quantity: '1', unitPrice: '0.5' },
      { description: 'D', quantity: '1', unitPrice: '19.99' },
    ];
    const res = await post(NEW, goodForm(client.id, itemFields(rows)));
    assert.equal(res.status, 303);
    const [summary] = repos.invoices.listByFreelancer(freelancer.id);
    const draft = repos.invoices.getById(freelancer.id, summary.id);
    assert.deepEqual(draft.lineItems.map((i) => i.unitAmountMinor), [120000, 500, 50, 1999]);
    assert.equal(draft.daysUntilDue, 30);
    assert.equal(draft.clientId, client.id);
    const end = await followToTerminus(baseUrl, res, { cookie });
    assert.equal(end.hops, 1, `committed hop count: ${end.chain.join(', ')}`);
    assert.equal(end.status, 200, `terminal status ${end.status} at ${end.path}`);
    assert.equal(end.path, editPath(draft.id));
    assert.equal(stateOf(end.body), 'S4-DEFAULT-EDIT');
  });
});

test('send from the edit page updates the draft, runs the pipeline, and redirects to the detail path', async () => {
  await withScreenApp({}, async ({ post, repos, freelancer, client, calls }) => {
    const draft = repos.invoices.createDraft(freelancer.id, { clientId: client.id, daysUntilDue: 7, lineItems: [{ description: 'Old', quantity: 1, unitAmountMinor: 100 }] });
    const res = await post(editPath(draft.id), goodForm(client.id, { intent: 'send', daysUntilDue: '10', ...itemFields([{ description: 'New', quantity: '2', unitPrice: '25.00' }]) }));
    assert.equal(res.status, 303, await res.text());
    // The Location is ASSERTED, NOT DEREFERENCED: /invoices/:id is AS-48's
    // screen and 404s until it lands (plan §8 residual). AS-48 adds the
    // followed-terminus assertion when the detail screen exists.
    assert.equal(res.headers.get('location'), detailPath(draft.id));
    const row = repos.invoices.getById(freelancer.id, draft.id);
    assert.notEqual(row.sentAt, null, 'the pipeline ran through send');
    assert.equal(row.daysUntilDue, 10, 'the draft was updated first');
    assert.deepEqual(row.lineItems.map((i) => [i.description, i.quantity, i.unitAmountMinor]), [['New', 2, 2500]]);
    assert.deepEqual(calls.map((c) => c.path.replace(/in_fixture\d+/, 'in_x')), ['/v1/customers', '/v1/invoices', '/v1/invoiceitems', '/v1/invoices/in_x/finalize', '/v1/invoices/in_x/send']);
  });
});

// --- the non-persisting intents and the closed dispatch -------------------------

test('add-row re-renders with one more blank row and persists nothing; at 50 rows the control is absent', async () => {
  await withScreenApp({}, async ({ post, repos, freelancer, client }) => {
    const res = await post(NEW, goodForm(client.id, { intent: 'add-row' }));
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.equal(rowCount(html), 4, 'three submitted plus one blank');
    assert.equal(occurrences(html, 'value="Website redesign — phase 1"'), 1, 'submitted values preserved');
    assert.equal(occurrences(html, 'value="add-row"'), 1, 'the control is present below the ceiling');
    assert.equal(repos.invoices.listByFreelancer(freelancer.id).length, 0);
    const fifty = Array.from({ length: MAX_LINE_ITEMS }, () => blank);
    const capped = await post(NEW, { intent: 'add-row', clientId: client.id, daysUntilDue: '30', ...itemFields(fifty) });
    assert.equal(capped.status, 200);
    const cappedHtml = await capped.text();
    assert.equal(rowCount(cappedHtml), MAX_LINE_ITEMS, 'no 51st row');
    assert.equal(occurrences(cappedHtml, 'value="add-row"'), 0, 'at the ceiling the control is absent, not disabled');
    assert.equal(MAX_LINE_ITEMS, 50);
  });
});

test('new-client and existing-client switch the picker without persisting anything', async () => {
  await withScreenApp({ clients: 2 }, async ({ post, repos, freelancer, clients }) => {
    const toNew = await post(NEW, goodForm(clients[0].id, { intent: 'new-client' }));
    assert.equal(toNew.status, 200);
    const newHtml = await toNew.text();
    assert.equal(occurrences(newHtml, '<select'), 0);
    assert.equal(occurrences(newHtml, 'name="pickerMode" value="new"'), 1);
    assert.equal(occurrences(newHtml, 'value="existing-client"'), 1, 'the way back');
    assert.equal(occurrences(newHtml, 'value="Website redesign — phase 1"'), 1, 'invoice values preserved');
    const back = await post(NEW, goodForm(clients[1].id, { intent: 'existing-client', pickerMode: 'new' }));
    assert.equal(back.status, 200);
    const backHtml = await back.text();
    assert.equal(occurrences(backHtml, '<select'), 1);
    assert.equal(optionSelected(backHtml, clients[1].id), 1, 'pre-selected on the submitted clientId');
    assert.equal(repos.invoices.listByFreelancer(freelancer.id).length, 0);
    assert.equal(repos.clients.listByFreelancer(freelancer.id).length, 2);
  });
});

test('the intent dispatch is closed: an unknown, absent or repeated intent is refused and persists nothing', async () => {
  await withScreenApp({}, async ({ post, repos, freelancer, client }) => {
    const bodies = [
      ['unknown', new URLSearchParams(goodForm(client.id, { intent: 'drop' })).toString()],
      ['absent', new URLSearchParams(Object.fromEntries(Object.entries(goodForm(client.id)).filter(([k]) => k !== 'intent'))).toString()],
      ['repeated', `${new URLSearchParams(Object.fromEntries(Object.entries(goodForm(client.id)).filter(([k]) => k !== 'intent'))).toString()}&intent[]=save&intent[]=send`],
    ];
    assert.equal(bodies.length, 3);
    for (const [why, body] of bodies) {
      const res = await post(NEW, body);
      assert.equal(res.status, 400, why);
      const html = await res.text();
      assert.equal(stateOf(html), 'S4-ERROR-VALIDATION', why);
      assert.ok(html.includes('Choose an action.'), why);
      assert.equal(occurrences(html, 'class="field field--invalid"'), 0, `${why}: no field is blamed`);
    }
    assert.equal(repos.invoices.listByFreelancer(freelancer.id).length, 0);
  });
});

test('edit routes: an unknown or foreign invoice id is 404, and a non-draft invoice redirects to its detail path', async () => {
  await withScreenApp({}, async ({ get, post, repos, freelancer, client }) => {
    const unknown = await get(editPath('no-such-id'));
    assert.equal(unknown.status, 404);
    assert.match(unknown.headers.get('content-type'), /^text\/plain\b/);
    assert.equal(await unknown.text(), 'NotFoundError: screen-edit\n');
    // Another freelancer's draft is indistinguishable from a missing one.
    const other = repos.freelancers.create({ email: 'o@example.test', displayName: 'Other' });
    const otherClient = repos.clients.create(other.id, { name: 'Theirs', email: 'theirs@example.test' });
    const theirs = repos.invoices.createDraft(other.id, { clientId: otherClient.id, daysUntilDue: 1, lineItems: [{ description: 'x', quantity: 1, unitAmountMinor: 1 }] });
    const foreign = await get(editPath(theirs.id));
    assert.equal(foreign.status, 404);
    assert.equal(await foreign.text(), 'NotFoundError: screen-edit\n');
    assert.equal((await post(editPath(theirs.id), goodForm(client.id))).status, 404, 'the POST too');
    // Attached: the detail screen is where it lives; the flag is dropped.
    const mine = repos.invoices.createDraft(freelancer.id, { clientId: client.id, daysUntilDue: 1, lineItems: [{ description: 'x', quantity: 1, unitAmountMinor: 1 }] });
    repos.invoices.attachStripeInvoice(freelancer.id, mine.id, 'in_attached1');
    for (const path of [editPath(mine.id), `${editPath(mine.id)}?error=send`]) {
      const res = await get(path);
      assert.equal(res.status, 303, path);
      assert.equal(res.headers.get('location'), detailPath(mine.id), path);
    }
    const posted = await post(editPath(mine.id), goodForm(client.id));
    assert.equal(posted.status, 303);
    assert.equal(posted.headers.get('location'), detailPath(mine.id), 'a POST to an attached draft writes nothing and redirects');
    assert.equal(repos.invoices.getById(freelancer.id, mine.id).daysUntilDue, 1);
  });
});

// --- money ------------------------------------------------------------------------

/** [typed, minor units or null]. Every refusal plan §4.3 names is a row. */
const MAJOR_UNIT_VECTORS = [
  ['1200.00', 120000],
  ['1200', 120000],
  ['12.5', 1250],
  ['0', 0],
  ['0.00', 0],
  ['0.5', 50],
  ['0.05', 5],
  ['19.99', 1999],
  ['007', 700],
  [' 7 ', 700],
  ['4.35', 435],
  ['90071992547409.91', 9007199254740991],
  // THE FLOAT TRAP, at the magnitude where it is observable. Math.round(Number(text) * 100)
  // gives 9007199254735902 here; the digit build gives the exact 9007199254735901. Below
  // about 2^45 minor units Math.round masks the float error, so the vectors that LOOK like
  // float traps (0.29, 4.35, 1.005) do not distinguish the two — this one does (recipe F6).
  ['90071992547359.01', 9007199254735901],
  ['', null],
  ['   ', null],
  ['.50', null],
  ['12.', null],
  ['1,200', null],
  ['$12', null],
  ['-1', null],
  ['+1', null],
  ['1e3', null],
  ['12.345', null],
  ['1.005', null],
  ['abc', null],
  ['12 00', null],
  ['90071992547409.92', null],
  ['99999999999999999999', null],
];

test('formatMinorUnits and parseMajorUnits round-trip, reject every malformed spelling, and never touch a float', () => {
  // Cardinality FIRST, before any vector runs.
  assert.equal(MAJOR_UNIT_VECTORS.length, 28, 'the committed vector table');
  assert.equal(MAJOR_UNIT_VECTORS.filter(([, expected]) => expected === null).length, 15, 'fifteen refusals');
  for (const [typed, expected] of MAJOR_UNIT_VECTORS) {
    assert.equal(parseMajorUnits(typed), expected, JSON.stringify(typed));
  }
  // Not a string: nothing is coerced.
  for (const notText of [undefined, null, 12, ['12'], { toString: () => '12' }]) {
    assert.equal(parseMajorUnits(notText), null);
  }
  // The float trap, stated as the integer it must be.
  assert.equal(parseMajorUnits('0.1') + parseMajorUnits('0.2'), 30);
  // Round trips, both ways, over every accepted vector and every safe shape.
  for (const [typed, expected] of MAJOR_UNIT_VECTORS) {
    if (expected === null) continue;
    assert.equal(parseMajorUnits(formatMinorUnits(expected)), expected, typed);
  }
  assert.equal(formatMinorUnits(120000), '1200.00');
  assert.equal(formatMinorUnits(5), '0.05');
  assert.equal(formatMinorUnits(0), '0.00');
  assert.equal(formatMinorUnits(1999), '19.99');
  assert.equal(formatMinorUnits(9007199254740991), '90071992547409.91');
  // Refuses exactly what assertMinorUnits refuses.
  for (const bad of [-1, 1.5, '100', NaN, Infinity, 2 ** 53]) {
    assert.throws(() => formatMinorUnits(bad), { name: 'ValidationError' }, String(bad));
  }
});

// --- the link check: the seam ruling made mechanical -------------------------------

/** Constant href/action values across the registered templates, measured when
 *  the templates were finished and moved deliberately with them. RE-MEASURED at
 *  the rebase onto AS-70's merge: 13 — signin.ejs 5, connect-stripe.ejs 3,
 *  invoice-form.ejs 5 — read off the run, never before it. A fourth template
 *  moves this with its VIEWS row. RE-MEASURED at the rebase onto AS-47's
 *  merge: 17 (contract-detail.ejs 4). RE-MEASURED by AS-48: 38 —
 *  invoice-form.ejs 6 (the Dashboard anchor), connect-stripe.ejs 4 (Continue
 *  to Dashboard), contract-detail.ejs 6 (the Dashboard anchor and NOTFOUND's
 *  Back to Dashboard), dashboard.ejs 9, invoice-detail.ejs 8 — predicted
 *  before the run, then read off it. RE-MEASURED by AS-127: 49 —
 *  contract-form.ejs 6 (its own chrome), the New contract nav anchor on the
 *  four chrome-bearing templates (+4), and the Dashboard's first-run
 *  contract CTA (+1) — predicted before the run, then read off it. */
const TEMPLATE_LINKS = 49;

test('every href and form action in every template names a route the app registers or a file public/ serves', async () => {
  const config = configFor();
  const publicFiles = new Set(['/app.css']);
  await withServer(config, async (base, app) => {
    const routes = new Set(discoverRoutes(app));
    const examined = [];
    const problems = [];
    for (const view of VIEWS) {
      const source = readFileSync(join(config.viewsDir, view.file), 'utf8');
      // P2a guarantees there are no interpolated ones; assert it here too.
      assert.equal(occurrences(source, 'href="<%'), 0, `${view.file}: an interpolated href`);
      assert.equal(occurrences(source, 'action="<%'), 0, `${view.file}: an interpolated action`);
      for (const [, href] of source.matchAll(/\bhref="([^"]*)"/g)) {
        examined.push(`${view.file} href ${href}`);
        if (!routes.has(`GET ${href}`) && !publicFiles.has(href)) problems.push(`${view.file}: href="${href}" names nothing the app serves`);
      }
      for (const [, attrs] of source.matchAll(/<form\b([^>]*)>/g)) {
        const action = attrs.match(/\baction="([^"]*)"/);
        if (action === null) continue; // the page's own URL
        const method = /\bmethod="get"/i.test(attrs) ? 'GET' : 'POST';
        examined.push(`${view.file} action ${method} ${action[1]}`);
        if (!routes.has(`${method} ${action[1]}`)) problems.push(`${view.file}: action="${action[1]}" (${method}) names no registered route`);
      }
    }
    assert.equal(examined.length, TEMPLATE_LINKS, `examined ${examined.length} links, expected ${TEMPLATE_LINKS}:\n${examined.join('\n')}`);
    // Was RED BY DESIGN until AS-70 landed /connect-stripe (merge order AS-70 ->
    // AS-46, plan §11); green since the rebase onto that merge. The red on that
    // one href was the seam ruling working.
    assert.deepEqual(problems, [], problems.join('\n'));
  });
});

test('no template branches on a state id: `state` reaches EJS code exactly once per template, as the data-state attribute', () => {
  // THE VIEW-LAYER RULE MADE MECHANICAL (AS-70 review, residual 4: the rule was
  // prose and its mutant R5 survived). A template branches on the SHAPE the
  // view model hands it (gated, showSelect, duplicate, banner.tone) and never on
  // the state id, so the id cannot drift from the copy. The instrument reads
  // EJS code tags only: connect-stripe.ejs spells `state === '…'` inside an HTML
  // comment that states this very rule, and signin.ejs says "in any state" in
  // an EJS comment, so a raw-source grep would be red on the prose. Falsifier
  // (review-cycle notes): `<% if (gated) { %>` -> `<% if (state === 'S4-GATED-
  // STRIPENOTREADY') { %>` in invoice-form.ejs renders identical markup and
  // must turn this red (2 !== 1).
  const templates = VIEWS.map((v) => v.file);
  assert.equal(templates.length, 7, 'cardinality first: every registered template is examined');
  for (const file of templates) {
    const source = readFileSync(join(configFor().viewsDir, file), 'utf8');
    const code = [...source.replace(/<%#[\s\S]*?%>/g, '').matchAll(/<%[=-]?([\s\S]*?)%>/g)].map((m) => m[1]).join('\n');
    assert.ok(code.length > 0, `${file}: no EJS code found — the instrument is reading the wrong thing`);
    const uses = code.match(/\bstate\b/g) ?? [];
    assert.equal(uses.length, 1, `${file}: \`state\` reaches EJS code ${uses.length} time(s), expected exactly 1 (the data-state attribute) — a branch on a state id was added`);
    assert.equal(occurrences(source, 'data-state="<%= state %>"'), 1, `${file}: the one use is the data-state attribute`);
  }
});

test('POST /invoices/new is served by the screen, never by the API\'s :id route', async () => {
  // Registration order is load-bearing: `:id` matches the literal `new`, so a
  // screen route registered below `POST /invoices/:id` would never run and the
  // API would answer `ValidationError: invoice.intent` in text/plain.
  await withScreenApp({}, async ({ post }) => {
    const res = await post(NEW, { intent: 'save', clientId: '', daysUntilDue: 'x' });
    assert.equal(res.status, 400);
    assert.match(res.headers.get('content-type'), /^text\/html\b/);
    const html = await res.text();
    assert.equal(stateOf(html), 'S4-ERROR-VALIDATION');
    assert.equal(occurrences(html, 'ValidationError'), 0);
    assert.notEqual(html, 'ValidationError: invoice.intent\n');
  });
});
