// read-screens.test.js — screens 3 and 5, every ledger row of each (AS-48,
// plan §3, §7).
//
// THIS FILE'S ONE CLAIM: every row in docs/design/wireframes/02-states-ledger.md
// §3 and §5 is accounted for — rendered and asserted on a sentinel, layered by
// a boolean, answered by a redirect, rendered as another row by construction,
// or recorded as unrenderable or n/a with the reason. The join to the document
// is a DATED REVIEW ACT (screens.test.js's file header says why): the two
// tables below and the view models' copies are independent hand
// transcriptions compared against each other.
//
// Everything here reads the MIRROR. No Stripe call is made on any GET; the
// two cases that run the send pipeline do so through a canned transport (the
// invoice-screen.test.js fixture in miniature), because the point of screen 5
// is that it renders what the webhook receiver already wrote.
//
// OCCURRENCE COUNTING, never a boolean `includes` (the screens.test.js rule).
// Everything runs offline: no accounts, no network, no Stripe call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VIEWS } from '../lib/views.js';
import { DASHBOARD_LEDGER, DASHBOARD_STATES, UUID_SHAPE, dashboardLocals } from '../lib/screens/dashboard-view.js';
import {
  INVOICE_DETAIL_LEDGER,
  INVOICE_DETAIL_STATES,
  STATE_STATUS,
  STATUS_BADGES,
  UNSENT_BADGE,
  badgeFor,
  invoiceDetailLocals,
} from '../lib/screens/invoice-detail-view.js';
import { formatDisplayMinorUnits } from '../lib/db/money.js';
import { formatDate } from '../lib/screens/dates.js';
import { openDatabase } from '../lib/db/connection.js';
import { createStripeClient } from '../lib/stripe/client.js';
import { discoverRoutes } from './helpers/routes.js';
import { configFor, followToTerminus, seedSession, signedInHeaders, withServer } from './helpers/server.js';

const KEY = 'unit-test-placeholder-key';
const ACCT = 'acct_readscreens1';
const SYNCED_AT = '2026-09-12T10:00:00.000Z';
const detailPath = (id) => `/invoices/${id}`;
const editPath = (id) => `/invoices/${id}/edit`;

const occurrences = (haystack, needle) => haystack.split(needle).length - 1;
function stateOf(html) {
  const match = html.match(/data-state="([^"]*)"/);
  return match === null ? null : match[1];
}
/** The document's <main> element, so a chrome control (the sign-out form) can
 *  be excluded from an assertion about the screen's own controls. */
const mainOf = (html) => html.slice(html.indexOf('<main'), html.indexOf('</main>'));

// =============================================================================
// The ledgers, transcribed. Cardinality and membership before anything else.
// =============================================================================

/** 02-states-ledger.md §3, all seven rows, in the document's own order,
 *  transcribed BY HAND and independently of the view model's copy. */
const SCREEN_3_LEDGER = [
  ['S3-DEFAULT-POPULATED', 'rendered'],
  ['S3-LOADING', 'unrenderable — browser-supplied'],
  ['S3-EMPTY-FIRSTRUN', 'rendered'],
  ['S3-ERROR-SYSTEM', 'rendered'],
  ['S3-GATED-STRIPENOTREADY', 'layered — rendered inside S3-DEFAULT-POPULATED and S3-EMPTY-FIRSTRUN by the stripeReady boolean'],
  ['S3-DENIED-SIGNEDOUT', 'redirect-answered'],
  ['S3-ABANDON', 'n/a'],
];

/** 02-states-ledger.md §5, all ten rows, in the document's own order. */
const SCREEN_5_LEDGER = [
  ['S5-DEFAULT-DRAFT', 'rendered'],
  ['S5-DEFAULT-OPEN', 'rendered'],
  ['S5-DEFAULT-PAID', 'rendered'],
  ['S5-LOADING', 'unrenderable — browser-supplied'],
  ['S5-EMPTY', 'n/a'],
  ['S5-ERROR-NOTFOUND', 'rendered'],
  ['S5-ERROR-SYSTEM', 'rendered'],
  ['S5-DENIED-SIGNEDOUT', 'redirect-answered'],
  ['S5-DENIED-NOTOWNER', 'rendered as S5-ERROR-NOTFOUND'],
  ['S5-ABANDON', 'n/a'],
];

test('screen 3 accounts for all seven of its ledger rows: 3 + 1 + 1 + 1 + 1 = 7', () => {
  assert.equal(SCREEN_3_LEDGER.length, 7, 'the ledger table transcribed here has seven rows');
  assert.equal(DASHBOARD_LEDGER.length, 7, `the view model accounts for ${DASHBOARD_LEDGER.length} rows, expected 7`);
  const declared = DASHBOARD_LEDGER.map((row) => [row.id, row.disposition]).sort();
  assert.deepEqual(declared, [...SCREEN_3_LEDGER].sort());

  const bucket = (prefix) => DASHBOARD_LEDGER.filter((row) => row.disposition.startsWith(prefix)).map((row) => row.id);
  assert.deepEqual(bucket('rendered'), ['S3-DEFAULT-POPULATED', 'S3-EMPTY-FIRSTRUN', 'S3-ERROR-SYSTEM']);
  assert.deepEqual(bucket('layered'), ['S3-GATED-STRIPENOTREADY']);
  assert.deepEqual(bucket('redirect-answered'), ['S3-DENIED-SIGNEDOUT']);
  assert.deepEqual(bucket('unrenderable — browser-supplied'), ['S3-LOADING']);
  assert.deepEqual(bucket('n/a'), ['S3-ABANDON']);
  assert.equal(3 + 1 + 1 + 1 + 1, DASHBOARD_LEDGER.length);

  assert.equal(DASHBOARD_STATES.length, 3, `${DASHBOARD_STATES.length} rendered states, expected 3`);
  assert.ok(Object.isFrozen(DASHBOARD_STATES) && Object.isFrozen(DASHBOARD_LEDGER), 'both lists are frozen');
});

test('screen 5 accounts for all ten of its ledger rows: 5 + 1 + 1 + 1 + 2 = 10', () => {
  assert.equal(SCREEN_5_LEDGER.length, 10, 'the ledger table transcribed here has ten rows');
  assert.equal(INVOICE_DETAIL_LEDGER.length, 10, `the view model accounts for ${INVOICE_DETAIL_LEDGER.length} rows, expected 10`);
  const declared = INVOICE_DETAIL_LEDGER.map((row) => [row.id, row.disposition]).sort();
  assert.deepEqual(declared, [...SCREEN_5_LEDGER].sort());

  const bucket = (disposition) => INVOICE_DETAIL_LEDGER.filter((row) => row.disposition === disposition).map((row) => row.id);
  assert.deepEqual(bucket('rendered'), ['S5-DEFAULT-DRAFT', 'S5-DEFAULT-OPEN', 'S5-DEFAULT-PAID', 'S5-ERROR-NOTFOUND', 'S5-ERROR-SYSTEM']);
  assert.deepEqual(bucket('rendered as S5-ERROR-NOTFOUND'), ['S5-DENIED-NOTOWNER']);
  assert.deepEqual(bucket('redirect-answered'), ['S5-DENIED-SIGNEDOUT']);
  assert.deepEqual(bucket('unrenderable — browser-supplied'), ['S5-LOADING']);
  assert.deepEqual(bucket('n/a'), ['S5-EMPTY', 'S5-ABANDON']);
  assert.equal(5 + 1 + 1 + 1 + 2, INVOICE_DETAIL_LEDGER.length);

  assert.equal(INVOICE_DETAIL_STATES.length, 5, `${INVOICE_DETAIL_STATES.length} rendered states, expected 5`);
  assert.deepEqual([...INVOICE_DETAIL_STATES].sort(), Object.keys(STATE_STATUS).sort(), 'every rendered state has a status, and nothing else does');
  assert.ok(Object.isFrozen(INVOICE_DETAIL_STATES) && Object.isFrozen(INVOICE_DETAIL_LEDGER), 'both lists are frozen');
});

// Pure fixtures for the view models. Ids are UUID-shaped because the Dashboard
// asserts every id it emits is (case 5).
const READY = { ready: true };
const NOT_READY = { ready: false };
const CLIENT = { id: randomUUID(), name: 'Ada Example', email: 'ada@example.test' };
const row = (over = {}) => ({
  id: randomUUID(),
  clientId: CLIENT.id,
  status: 'draft',
  currency: 'usd',
  daysUntilDue: 14,
  stripeInvoiceId: null,
  hostedInvoiceUrl: null,
  invoicePdfUrl: null,
  dueAt: null,
  sentAt: null,
  paidAt: null,
  totalMinor: 8000,
  createdAt: '2026-08-28T12:00:00.000Z',
  ...over,
});
const contractRow = () => ({ id: randomUUID(), clientId: CLIENT.id, templateId: 't', createdAt: '2026-08-28T12:00:00.000Z' });

test('the view models reach every rendered state, exhaustively, with no HTTP at all', () => {
  const screen3 = {
    'S3-ERROR-SYSTEM': dashboardLocals({ failure: 'system', invoices: [row()], clients: [CLIENT] }),
    'S3-EMPTY-FIRSTRUN': dashboardLocals({ account: READY }),
    'S3-DEFAULT-POPULATED': dashboardLocals({ account: READY, invoices: [row()], clients: [CLIENT] }),
  };
  for (const [state, locals] of Object.entries(screen3)) assert.equal(locals.state, state);
  assert.deepEqual(Object.keys(screen3).sort(), [...DASHBOARD_STATES].sort(), 'every rendered screen-3 state is reachable from route inputs alone');
  assert.equal(screen3['S3-ERROR-SYSTEM'].status, 500);
  assert.equal(screen3['S3-ERROR-SYSTEM'].invoices.length, 0, 'the error state renders no rows even when handed some');
  // One contract and zero invoices is populated too.
  assert.equal(dashboardLocals({ contracts: [contractRow()], clients: [CLIENT] }).state, 'S3-DEFAULT-POPULATED');

  const open = row({ status: 'open', stripeInvoiceId: 'in_x', sentAt: SYNCED_AT });
  const screen5 = {
    'S5-ERROR-NOTFOUND': invoiceDetailLocals({ failure: 'not-found' }),
    'S5-ERROR-SYSTEM': invoiceDetailLocals({ failure: 'system' }),
    'S5-DEFAULT-PAID': invoiceDetailLocals({ invoice: row({ status: 'paid', stripeInvoiceId: 'in_x', paidAt: SYNCED_AT }), client: CLIENT, account: READY }),
    'S5-DEFAULT-OPEN': invoiceDetailLocals({ invoice: open, client: CLIENT, account: READY }),
    'S5-DEFAULT-DRAFT': invoiceDetailLocals({ invoice: row(), client: CLIENT, account: READY }),
  };
  for (const [state, locals] of Object.entries(screen5)) {
    assert.equal(locals.state, state);
    assert.equal(locals.status, STATE_STATUS[state], `${state} answers ${STATE_STATUS[state]}`);
  }
  assert.deepEqual(Object.keys(screen5).sort(), [...INVOICE_DETAIL_STATES].sort(), 'every rendered screen-5 state is reachable from route inputs alone');
  // The default input (the VIEWS render probe) is NOTFOUND, the AS-47 precedent.
  assert.equal(invoiceDetailLocals().state, 'S5-ERROR-NOTFOUND');
  assert.equal(dashboardLocals().state, 'S3-EMPTY-FIRSTRUN');
  // PRECEDENCE (plan §3.2; recipe F13): a failure outranks the row it could
  // not load — a paid row with a failure set is the failure, never PAID.
  const paid = row({ status: 'paid', stripeInvoiceId: 'in_x', paidAt: SYNCED_AT });
  assert.equal(invoiceDetailLocals({ invoice: paid, client: CLIENT, failure: 'not-found' }).state, 'S5-ERROR-NOTFOUND');
  assert.equal(invoiceDetailLocals({ invoice: paid, client: CLIENT, failure: 'system' }).state, 'S5-ERROR-SYSTEM');
  // A row attached but not yet paid is OPEN whatever its status says.
  assert.equal(invoiceDetailLocals({ invoice: row({ status: 'void', stripeInvoiceId: 'in_x' }), client: CLIENT }).state, 'S5-DEFAULT-OPEN');

  // THE CLOSED BADGE TABLE: five keys plus the unsent variant; a sixth throws.
  assert.deepEqual(Object.keys(STATUS_BADGES).sort(), ['draft', 'open', 'paid', 'uncollectible', 'void']);
  assert.ok(Object.isFrozen(STATUS_BADGES) && Object.isFrozen(UNSENT_BADGE));
  assert.deepEqual(badgeFor(open), STATUS_BADGES.open);
  assert.deepEqual(badgeFor(row({ status: 'open', stripeInvoiceId: 'in_x', sentAt: null })), UNSENT_BADGE);
  assert.throws(() => badgeFor(row({ status: 'refunded' })), /unknown invoice status "refunded"/);
  assert.throws(() => dashboardLocals({ invoices: [row({ status: 'refunded' })], clients: [CLIENT] }), /unknown invoice status/);

  // A missing client name renders the constant, on both screens.
  assert.equal(dashboardLocals({ invoices: [row()], clients: [] }).invoices[0].clientName, 'Unknown client');
  assert.equal(invoiceDetailLocals({ invoice: row(), client: null }).title, 'Invoice to Unknown client');
  assert.equal(screen5['S5-DEFAULT-DRAFT'].title, 'Invoice to Ada Example');

  // ?error selects the send-failed overlay by PRESENCE, and only on a rendered
  // row: the input is a boolean, a truthy non-boolean selects nothing, and the
  // marker appears in no local.
  const leaked = invoiceDetailLocals({ invoice: row(), client: CLIENT, sendFailed: 'ASC48MARK' });
  assert.equal(leaked.sendFailed, false);
  assert.equal(occurrences(JSON.stringify(leaked), 'ASC48MARK'), 0);
  assert.equal(invoiceDetailLocals({ failure: 'system', sendFailed: true }).sendFailed, false, 'no overlay on an error state');
  assert.equal(invoiceDetailLocals({ invoice: row(), client: CLIENT, sendFailed: true }).state, 'S5-DEFAULT-DRAFT', 'the overlay changes no state');

  // The send control: draft and unsent-open when ready; never paid, void,
  // uncollectible or already sent; never when unready.
  const canSend = (invoice, account) => invoiceDetailLocals({ invoice, client: CLIENT, account }).canSend;
  assert.equal(canSend(row(), READY), true);
  assert.equal(canSend(row({ status: 'open', stripeInvoiceId: 'in_x', sentAt: null }), READY), true);
  assert.equal(canSend(open, READY), false, 'already sent');
  assert.equal(canSend(paid, READY), false);
  assert.equal(canSend(row({ status: 'void', stripeInvoiceId: 'in_x' }), READY), false);
  assert.equal(canSend(row({ status: 'uncollectible', stripeInvoiceId: 'in_x' }), READY), false);
  assert.equal(canSend(row(), NOT_READY), false);
  assert.equal(canSend(row(), null), false);
  assert.equal(invoiceDetailLocals({ invoice: row(), client: CLIENT, account: null }).showSetupNote, true);
  assert.equal(invoiceDetailLocals({ invoice: open, client: CLIENT, account: null }).showSetupNote, false, 'nothing to send, nothing to set up for');
  assert.equal(screen5['S5-DEFAULT-DRAFT'].sendLabel, 'Finalize & send');
  assert.equal(invoiceDetailLocals({ invoice: row({ status: 'open', stripeInvoiceId: 'in_x' }), client: CLIENT, account: READY }).sendLabel, 'Send');
  assert.equal(screen5['S5-DEFAULT-DRAFT'].canEdit, true);
  assert.equal(screen5['S5-DEFAULT-OPEN'].canEdit, false);
});

// =============================================================================
// HTTP: the app under test
// =============================================================================

const json = (data, status = 200) => ({ status, headers: { 'request-id': 'req_fixture' }, body: JSON.stringify(data) });

/** The invoice-screen.test.js case-20 fixture in miniature: a canned Stripe
 *  behind the REAL pipeline — customers, invoices, items (summed), finalize,
 *  send. `intercept(record)` may return a reply to override one call. */
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
    due_date: 1789430400,
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

/** The readiness patch the connected-accounts repository accepts (the
 *  screens.test.js shape): `ready` is derived by its mapper, nowhere here. */
const readiness = (ready) => ({
  chargesEnabled: ready,
  detailsSubmitted: true,
  payoutsEnabled: ready,
  requirementsCurrentlyDue: ready ? [] : ['external_account'],
  requirementsDisabledReason: ready ? null : 'requirements.past_due',
  syncedAt: SYNCED_AT,
});

/** withServer + a freelancer, a session, `clients` clients and — unless
 *  `connected: false` — a connected account in the requested readiness. */
async function withReadApp({ connected = true, ready = true, clients = 1, fixture = {} } = {}, fn) {
  const { transport, calls } = fixtureTransport(fixture);
  const stripe = createStripeClient({ apiKey: KEY, transport });
  const config = configFor();
  await withServer(config, async (base, app, deps) => {
    const repos = deps.repos;
    const freelancer = repos.freelancers.create({ email: 'f@example.test', displayName: 'Freda Lancer' });
    if (connected) {
      repos.connectedAccounts.create({ freelancerId: freelancer.id, stripeAccountId: ACCT });
      repos.connectedAccounts.updateReadiness(ACCT, readiness(ready));
    }
    const seeded = [];
    for (let i = 0; i < clients; i += 1) {
      seeded.push(repos.clients.create(freelancer.id, { name: i === 0 ? 'Ada Example' : `Client ${i + 1}`, email: `client${i + 1}@example.test` }));
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
    const setReady = (value) => repos.connectedAccounts.updateReadiness(ACCT, readiness(value));
    /** A local draft with one line item of `minor` minor units. */
    const draft = (minor = 8000, days = 14) => repos.invoices.createDraft(freelancer.id, {
      clientId: seeded[0].id,
      daysUntilDue: days,
      lineItems: [{ description: 'Website redesign — phase 1', quantity: 1, unitAmountMinor: minor }],
    });
    /** A draft attached to a Stripe invoice and brought to `snapshot` through
     *  the ONE state machine — exactly what the webhook receiver does. */
    const mirrored = (snapshot, minor = 45000) => {
      const local = draft(minor);
      const stripeInvoiceId = `in_read${local.id.slice(0, 8)}`;
      repos.invoices.attachStripeInvoice(freelancer.id, local.id, stripeInvoiceId);
      repos.invoices.applyStripeSnapshot(stripeInvoiceId, snapshot);
      return repos.invoices.getById(freelancer.id, local.id);
    };
    /** Fault injection on the test's private database: a second connection
     *  drops a table the screen's read depends on (the AS-47 §3.8 instrument). */
    const dropTable = (table) => {
      const db = openDatabase(config.dbPath);
      try {
        db.exec(`DROP TABLE ${table}`);
      } finally {
        db.close();
      }
    };
    await fn({ base, app, repos, config, freelancer, client: seeded[0], clients: seeded, cookie, get, post, calls, setReady, draft, mirrored, dropTable });
  }, { stripe });
}

const OPEN_SNAPSHOT = {
  status: 'open',
  hostedInvoiceUrl: 'https://invoice.stripe.com/i/acct_readscreens1/test_hosted_ASC48',
  invoicePdfUrl: 'https://pay.stripe.com/invoice/acct_readscreens1/test_pdf_ASC48/pdf',
  dueAt: '2026-09-15T00:00:00.000Z',
  sentAt: '2026-09-01T09:30:00.000Z',
};
const PAID_SNAPSHOT = { ...OPEN_SNAPSHOT, status: 'paid', paidAt: '2026-08-30T15:00:00.000Z', amountPaidMinor: 120000 };

// --- screen 3 ------------------------------------------------------------------

test('S3-GATED-STRIPENOTREADY layers on both list states: New invoice is a span with the finish-setup link, not an anchor', async () => {
  for (const connected of [false, true]) {
    await withReadApp({ connected, ready: false }, async ({ get, draft }) => {
      const empty = await (await get('/')).text();
      assert.equal(stateOf(empty), 'S3-EMPTY-FIRSTRUN', `connected=${connected}`);
      assert.equal(occurrences(empty, 'href="/invoices/new"'), 0, `connected=${connected}: no anchor to screen 4 anywhere, CTA included`);
      assert.equal(occurrences(empty, 'href="/connect-stripe"'), 1, `connected=${connected}: the finish-setup link, once`);
      assert.equal(occurrences(empty, 'site-nav__item--disabled'), 1);
      assert.equal(occurrences(empty, 'Connect Stripe before invoicing'), 1);
      draft();
      const populated = await (await get('/')).text();
      assert.equal(stateOf(populated), 'S3-DEFAULT-POPULATED', 'the gate changes no state');
      assert.equal(occurrences(populated, 'href="/invoices/new"'), 0, `connected=${connected}: populated, gated`);
      assert.equal(occurrences(populated, 'href="/connect-stripe"'), 1);
      assert.equal(occurrences(populated, '<table'), 1, 'the list still renders underneath');
    });
  }
  await withReadApp({ ready: true }, async ({ get, draft }) => {
    const empty = await (await get('/')).text();
    assert.equal(occurrences(empty, 'href="/invoices/new"'), 2, 'ready: the nav anchor and the first-run CTA');
    assert.equal(occurrences(empty, 'href="/connect-stripe"'), 0, 'ready: no note');
    assert.equal(occurrences(empty, 'site-nav__item--disabled'), 0);
    draft();
    const populated = await (await get('/')).text();
    assert.equal(occurrences(populated, 'href="/invoices/new"'), 1, 'ready, populated: the nav anchor alone');
    assert.equal(occurrences(populated, 'href="/connect-stripe"'), 0);
  });
});

test('every id the dashboard emits is a hidden value= input matching UUID_SHAPE, and no id appears in any href or action', async () => {
  await withReadApp({}, async ({ get, repos, freelancer, client, draft, mirrored }) => {
    const ids = [draft().id, mirrored(OPEN_SNAPSHOT).id];
    const contract = repos.contracts.create(freelancer.id, { clientId: client.id, templateId: 't', variables: {}, renderedHtml: '<p>x</p>' });
    ids.push(contract.id);
    const html = await (await get('/')).text();
    assert.equal(stateOf(html), 'S3-DEFAULT-POPULATED');
    const hidden = [...html.matchAll(/<input type="hidden" name="id" value="([^"]*)" \/>/g)].map((m) => m[1]);
    assert.equal(hidden.length, 3, `three hidden id inputs, found ${hidden.length}`);
    assert.deepEqual([...hidden].sort(), [...ids].sort(), 'exactly the three seeded ids');
    for (const id of ids) {
      assert.match(id, UUID_SHAPE);
      assert.equal(occurrences(html, id), 1, `${id} appears exactly once — in its hidden input and nowhere else`);
      assert.equal((html.match(new RegExp(`(href|action)="[^"]*${id}`, 'g')) ?? []).length, 0, `${id} in a URL attribute`);
    }
    assert.equal(occurrences(html, 'action="/invoices/view"'), 2);
    assert.equal(occurrences(html, 'action="/contracts/view"'), 1);
  });
});

test('S3-DEFAULT-POPULATED: rows show client, formatted total, status badge and a View form; contracts show client and created date', async () => {
  await withReadApp({}, async ({ get, repos, config, freelancer, client, draft, mirrored }) => {
    mirrored(PAID_SNAPSHOT, 120000);
    draft(8000);
    const contract = repos.contracts.create(freelancer.id, { clientId: client.id, templateId: 't', variables: {}, renderedHtml: '<p>x</p>' });
    // A seeded created_at, written where the repository would have written the clock.
    const db = openDatabase(config.dbPath);
    try {
      db.prepare('UPDATE contracts SET created_at = ? WHERE id = ?').run('2026-08-28T17:45:00.000Z', contract.id);
    } finally {
      db.close();
    }
    const res = await get('/');
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.equal(stateOf(html), 'S3-DEFAULT-POPULATED');
    assert.equal(occurrences(html, '<table'), 2, 'contracts and invoices');
    assert.equal(occurrences(html, '$1,200.00'), 1);
    assert.equal(occurrences(html, '$80.00'), 1);
    assert.equal(occurrences(html, 'badge-success'), 1);
    assert.equal(occurrences(html, 'badge-neutral'), 1);
    assert.equal(occurrences(html, '>Paid<'), 1);
    assert.equal(occurrences(html, '>Draft<'), 1);
    assert.equal(occurrences(html, '<td>Ada Example</td>'), 3, 'the client name joined onto every row');
    assert.equal(occurrences(html, '<td>Aug 28, 2026</td>'), 1, 'the seeded created_at, formatted');
    assert.equal(occurrences(html, '>View</button>'), 3);
    assert.equal(occurrences(html, '>Your work<'), 1);
    // Newest first, as the repository returns them: the draft was created last.
    assert.ok(html.indexOf('$80.00') < html.indexOf('$1,200.00'), 'invoices newest-first');
  });
});

test('S3-EMPTY-FIRSTRUN: zero records render the first-run copy with the invoice CTA and no table', async () => {
  await withReadApp({ ready: true }, async ({ get, setReady }) => {
    const ready = await (await get('/')).text();
    assert.equal(stateOf(ready), 'S3-EMPTY-FIRSTRUN');
    assert.equal(occurrences(ready, '<table'), 0);
    // EJS escapes the apostrophe in element content, so the served bytes carry
    // the entity — asserted as served, never as authored.
    assert.equal(occurrences(ready, 'Let&#39;s get your first client paid'), 2, 'title and h1');
    assert.equal(occurrences(ready, 'You&#39;re connected to Stripe.'), 1);
    // AS-127 landed /contracts/new: the contract CTA is the primary (the
    // wireframe's; AS-48 plan §11 Q5) and the invoice CTA is the secondary,
    // relabelled — asserted as class + label so a swap back is red.
    assert.equal(occurrences(ready, '<a href="/contracts/new" class="btn btn-primary">Create your first contract</a>'), 1, 'the primary CTA');
    assert.equal(occurrences(ready, '<a href="/invoices/new" class="btn btn-secondary">Or create an invoice directly</a>'), 1, 'the invoice CTA, demoted');
    assert.equal(occurrences(ready, 'Create your first invoice'), 0, 'the old primary label is gone');
    assert.ok(ready.indexOf('Create your first contract') < ready.indexOf('Or create an invoice directly'), 'contract CTA first in the form-actions');
    setReady(false);
    const gated = await (await get('/')).text();
    assert.equal(stateOf(gated), 'S3-EMPTY-FIRSTRUN');
    assert.equal(occurrences(gated, 'Connect Stripe when you&#39;re ready to invoice.'), 1, 'the other branch of the lede');
    assert.equal(occurrences(gated, 'You&#39;re connected to Stripe.'), 0);
    assert.equal(occurrences(gated, 'Or create an invoice directly'), 0, 'no CTA pointing at a refusal');
    assert.equal(occurrences(gated, 'Create your first contract'), 1, 'the contract CTA is not gated: contract creation has no Stripe dependency');
  });
});

test("S3-ERROR-SYSTEM: a dropped contracts table renders the error banner at 500 with a retry form to the page's own URL", async () => {
  await withReadApp({}, async ({ get, draft, dropTable }) => {
    draft();
    assert.equal(stateOf(await (await get('/')).text()), 'S3-DEFAULT-POPULATED', 'the control: populated before the fault');
    dropTable('contracts');
    const res = await get('/');
    assert.equal(res.status, 500);
    assert.match(res.headers.get('content-type'), /^text\/html\b/);
    const html = await res.text();
    assert.equal(stateOf(html), 'S3-ERROR-SYSTEM');
    assert.equal(occurrences(html, 'Something went wrong loading your contracts and invoices.'), 1);
    assert.equal(occurrences(html, 'banner-error'), 1);
    assert.equal(occurrences(html, '<form method="get">'), 1, 'Retry: a GET form with no action attribute');
    assert.equal(occurrences(html, '<table'), 0);
    assert.equal(occurrences(html, '$80.00'), 0, 'no row leaks into the error render');
    // The chrome still renders, gate included, because the account row was
    // readable — the list is what failed.
    assert.equal(occurrences(html, 'href="/"'), 1);
  });
});

// --- screen 5 ------------------------------------------------------------------

test('S5-DEFAULT-OPEN renders from a mirror row the webhook has not updated: status Sent, both hosted links as escaped text, due date formatted', async () => {
  await withReadApp({}, async ({ get, mirrored, calls }) => {
    const invoice = mirrored(OPEN_SNAPSHOT);
    const res = await get(detailPath(invoice.id));
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.equal(stateOf(html), 'S5-DEFAULT-OPEN');
    assert.equal(occurrences(html, 'Sent — awaiting payment'), 1);
    assert.equal(occurrences(html, 'badge-accent'), 1);
    assert.equal(occurrences(html, '>Invoice to Ada Example<'), 1);
    assert.equal(occurrences(html, '$450.00'), 1);
    assert.equal(occurrences(html, 'Due Sep 15, 2026'), 1);
    for (const url of [OPEN_SNAPSHOT.hostedInvoiceUrl, OPEN_SNAPSHOT.invoicePdfUrl]) {
      assert.equal(occurrences(html, url), 1, `${url} once`);
      assert.equal(occurrences(html, `<code class="link-text">${url}</code>`), 1, 'in element content');
      assert.equal((html.match(new RegExp(`href="[^"]*${url.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`, 'g')) ?? []).length, 0, 'never inside an href');
    }
    assert.equal(occurrences(html, 'View hosted invoice page (Stripe)'), 1);
    assert.equal(occurrences(html, 'Download invoice PDF (Stripe)'), 1);
    assert.equal(occurrences(html, 'No Stripe links yet'), 0);
    assert.equal(occurrences(mainOf(html), '<form'), 0, 'sent: nothing to edit, nothing to send');
    assert.equal(calls.length, 0, 'the screen made no Stripe call');
  });
});

test('S5-DEFAULT-PAID: a paid snapshot renders the success banner, the paid date, and offers no action', async () => {
  await withReadApp({}, async ({ get, mirrored }) => {
    const invoice = mirrored(PAID_SNAPSHOT, 120000);
    const html = await (await get(detailPath(invoice.id))).text();
    assert.equal(stateOf(html), 'S5-DEFAULT-PAID');
    assert.equal(occurrences(html, 'banner-success'), 1);
    assert.equal(occurrences(html, 'badge-success'), 1);
    assert.equal(occurrences(html, 'paid in full on Aug 30, 2026'), 1);
    assert.equal(occurrences(html, '$1,200.00'), 1);
    assert.equal(occurrences(mainOf(html), '<form method="post"'), 0, 'no POST control in main');
    assert.equal(occurrences(html, '<form'), 1, 'the sign-out form is the only form on the page');
    assert.equal(occurrences(html, 'action="/signout"'), 1);
    assert.equal(occurrences(html, OPEN_SNAPSHOT.hostedInvoiceUrl), 1, 'the links still render on a paid row');
  });
});

test('S5-DEFAULT-DRAFT: a draft shows Due in N days once sent, no Stripe links, and the Edit form', async () => {
  await withReadApp({}, async ({ get, draft }) => {
    const invoice = draft(8000, 14);
    const html = await (await get(detailPath(invoice.id))).text();
    assert.equal(stateOf(html), 'S5-DEFAULT-DRAFT');
    assert.equal(occurrences(html, '>Draft<'), 1);
    assert.equal(occurrences(html, 'Due in 14 days once sent'), 1);
    assert.equal(occurrences(html, 'No Stripe links yet — none exist until this invoice is finalized.'), 1);
    assert.equal(occurrences(html, 'link-text'), 0);
    assert.equal(occurrences(html, '<input type="hidden" name="edit" value="1" />'), 1);
    assert.equal(occurrences(html, '>Edit</button>'), 1);
    assert.equal(occurrences(html, '$80.00'), 1);
  });
});

test('?edit=1 on a draft redirects to the edit page; on a non-draft the flag is ignored and the page renders', async () => {
  await withReadApp({}, async ({ base, cookie, get, draft, mirrored }) => {
    const local = draft();
    const res = await get(`${detailPath(local.id)}?edit=1`);
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), editPath(local.id));
    const end = await followToTerminus(base, res, { cookie });
    assert.equal(end.hops, 1);
    assert.equal(end.status, 200);
    assert.equal(stateOf(end.body), 'S4-DEFAULT-EDIT');
    const open = mirrored(OPEN_SNAPSHOT);
    const ignored = await get(`${detailPath(open.id)}?edit=1`);
    assert.equal(ignored.status, 200);
    assert.equal(stateOf(await ignored.text()), 'S5-DEFAULT-OPEN');
    // Any other spelling of the flag is ignored on a draft too.
    for (const query of ['?edit=', '?edit=2', '?edit[]=1']) {
      const other = await get(`${detailPath(local.id)}${query}`);
      assert.equal(other.status, 200, query);
    }
  });
});

test('void, uncollectible and finalized-but-unsent rows render inside S5-DEFAULT-OPEN with their own badge', async () => {
  await withReadApp({}, async ({ get, mirrored }) => {
    const rows = [
      [mirrored({ ...OPEN_SNAPSHOT, status: 'void', voidedAt: SYNCED_AT }), 'Voided', 'badge-neutral'],
      [mirrored({ ...OPEN_SNAPSHOT, status: 'uncollectible', markedUncollectibleAt: SYNCED_AT }), 'Marked uncollectible', 'badge-warning'],
      [mirrored({ ...OPEN_SNAPSHOT, sentAt: null }), 'Finalized — not yet sent', 'badge-accent'],
    ];
    for (const [invoice, label, cls] of rows) {
      const html = await (await get(detailPath(invoice.id))).text();
      assert.equal(stateOf(html), 'S5-DEFAULT-OPEN', label);
      assert.equal(occurrences(html, label), 1, label);
      assert.equal(occurrences(html, cls), 1, label);
      assert.equal(occurrences(html, 'Sent — awaiting payment'), 0, label);
    }
    // Only the unsent row offers Send; a voided or uncollectible one offers nothing.
    const [voided, , unsent] = rows.map(([invoice]) => invoice);
    assert.equal(occurrences(mainOf(await (await get(detailPath(voided.id))).text()), '<form'), 0);
    const unsentHtml = await (await get(detailPath(unsent.id))).text();
    assert.equal(occurrences(unsentHtml, 'action="/invoices/send"'), 1);
    assert.equal(occurrences(unsentHtml, '>Send</button>'), 1);
  });
});

/** Screen 4's form fields for one line item, in the shape its template posts. */
const editForm = (clientId) => ({
  intent: 'send',
  clientId,
  daysUntilDue: '30',
  'lineItems[0][description]': 'Website redesign — phase 1',
  'lineItems[0][quantity]': '1',
  'lineItems[0][unitPrice]': '1200.00',
});

test("AS-46's send lands on a page that exists: intent=send from the edit screen is followed to 200 S5-DEFAULT-OPEN", async () => {
  // THE RESIDUAL AS-46 §8 NAMED, CLOSED: invoice-screen.test.js asserts the
  // Location and stops; this follows it.
  await withReadApp({}, async ({ base, cookie, post, client, draft, calls }) => {
    const local = draft();
    const res = await post(editPath(local.id), editForm(client.id));
    assert.equal(res.status, 303, await res.text());
    assert.equal(res.headers.get('location'), detailPath(local.id));
    const end = await followToTerminus(base, res, { cookie });
    assert.equal(end.hops, 1, `committed hop count: the chain was ${end.chain.join(' , ')}`);
    assert.equal(end.status, 200);
    assert.equal(end.path, detailPath(local.id));
    assert.equal(stateOf(end.body), 'S5-DEFAULT-OPEN');
    assert.equal(occurrences(end.body, 'Sent — awaiting payment'), 1);
    assert.equal(occurrences(end.body, '$1,200.00'), 1, 'the edit screen updated the draft before sending');
    assert.equal(occurrences(end.body, 'https://pay.example.test/'), 2, 'both links the fixture returned, rendered as text');
    assert.equal(calls.length, 5, 'the five-call pipeline ran once');
  });
});

test('POST /invoices/send from the detail page runs the pipeline and lands on the detail page; the control renders only when the account is ready', async () => {
  await withReadApp({}, async ({ get, post, repos, freelancer, draft, calls, setReady }) => {
    const local = draft();
    const page = await (await get(detailPath(local.id))).text();
    assert.equal(occurrences(page, 'action="/invoices/send"'), 1, 'ready: the control');
    assert.equal(occurrences(page, '>Finalize &amp; send</button>'), 1);
    assert.equal(occurrences(page, 'Connect Stripe before sending'), 0);
    const res = await post('/invoices/send', { id: local.id });
    assert.equal(res.status, 303, await res.text());
    assert.equal(res.headers.get('location'), detailPath(local.id));
    const row = repos.invoices.getById(freelancer.id, local.id);
    assert.notEqual(row.sentAt, null, 'the pipeline ran through send');
    assert.equal(row.status, 'open');
    assert.deepEqual(calls.map((c) => c.path.replace(/in_fixture\d+/, 'in_x')), ['/v1/customers', '/v1/invoices', '/v1/invoiceitems', '/v1/invoices/in_x/finalize', '/v1/invoices/in_x/send']);
    const after = await (await get(detailPath(local.id))).text();
    assert.equal(stateOf(after), 'S5-DEFAULT-OPEN');
    assert.equal(occurrences(after, 'action="/invoices/send"'), 0, 'sent: no control');

    // Unready: the sentence with the one setup link, and no control.
    const second = draft();
    setReady(false);
    const gated = await (await get(detailPath(second.id))).text();
    assert.equal(stateOf(gated), 'S5-DEFAULT-DRAFT');
    assert.equal(occurrences(gated, 'action="/invoices/send"'), 0);
    assert.equal(occurrences(gated, 'Connect Stripe before sending — <a href="/connect-stripe">finish setup</a>.'), 1);
    assert.equal(occurrences(gated, '>Edit</button>'), 1, 'Edit is not gated');
    // And the POST itself, from a stale tab, lands on the page with the banner
    // and writes nothing to Stripe.
    const before = calls.length;
    const stale = await post('/invoices/send', { id: second.id });
    assert.equal(stale.status, 303);
    assert.equal(stale.headers.get('location'), `${detailPath(second.id)}?error=send`);
    assert.equal(calls.length, before, 'the readiness gate refused before any Stripe call');
  });
});

test('a send that fails at Stripe lands on ?error=send with the banner layered on the unchanged state, and a second send resumes', async () => {
  let failures = 0;
  const intercept = (record) => {
    if (record.path === '/v1/customers' && failures === 0) {
      failures += 1;
      return json({ error: { type: 'api_error', message: 'boom' } }, 500);
    }
    return undefined;
  };
  await withReadApp({ fixture: { intercept } }, async ({ base, cookie, get, post, repos, freelancer, draft, calls }) => {
    const local = draft();
    const res = await post('/invoices/send', { id: local.id });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), `${detailPath(local.id)}?error=send`);
    const end = await followToTerminus(base, res, { cookie });
    assert.equal(end.status, 200);
    assert.equal(stateOf(end.body), 'S5-DEFAULT-DRAFT', 'the state is the row, unchanged: nothing was attached');
    assert.equal(occurrences(end.body, 'banner-error'), 1);
    assert.equal(occurrences(end.body, 'Something went wrong sending this invoice.'), 1);
    assert.equal(occurrences(end.body, 'action="/invoices/send"'), 1, 'the control is still offered: the pipeline resumes');
    assert.equal(repos.invoices.getById(freelancer.id, local.id).stripeInvoiceId, null);
    // Presence, not value: a marker in the flag's value never reaches the page.
    const marked = await (await get(`${detailPath(local.id)}?error=ASC48MARK`)).text();
    assert.equal(occurrences(marked, 'banner-error'), 1);
    assert.equal(occurrences(marked, 'ASC48MARK'), 0);
    assert.equal(occurrences(await (await get(detailPath(local.id))).text(), 'banner-error'), 0, 'no flag, no banner');
    // The second click resumes: one customer call failed, the rest run once.
    const again = await post('/invoices/send', { id: local.id });
    assert.equal(again.status, 303);
    assert.equal(again.headers.get('location'), detailPath(local.id));
    assert.notEqual(repos.invoices.getById(freelancer.id, local.id).sentAt, null);
    assert.deepEqual(calls.map((c) => c.path.replace(/in_fixture\d+/, 'in_x')), ['/v1/customers', '/v1/customers', '/v1/invoices', '/v1/invoiceitems', '/v1/invoices/in_x/finalize', '/v1/invoices/in_x/send']);
  });
});

test('POST /invoices/send with a malformed or foreign id is 404 text/plain and calls Stripe zero times', async () => {
  await withReadApp({}, async ({ post, repos, calls }) => {
    const other = repos.freelancers.create({ email: 'o@example.test', displayName: 'Other' });
    const otherClient = repos.clients.create(other.id, { name: 'Theirs', email: 'theirs@example.test' });
    const theirs = repos.invoices.createDraft(other.id, { clientId: otherClient.id, daysUntilDue: 1, lineItems: [{ description: 'x', quantity: 1, unitAmountMinor: 1 }] });
    const bodies = [{ id: theirs.id }, { id: randomUUID() }, { id: 'new' }, { id: '../x' }, {}, 'id[]=a', { id: 'a'.repeat(2000) }];
    for (const body of bodies) {
      const res = await post('/invoices/send', body);
      assert.equal(res.status, 404, JSON.stringify(body));
      assert.match(res.headers.get('content-type'), /^text\/plain\b/);
      assert.equal(await res.text(), 'NotFoundError: screen-send\n', JSON.stringify(body));
      assert.equal(res.headers.get('location'), null);
    }
    assert.equal(calls.length, 0, 'no Stripe call for any refused id');
    assert.equal(repos.invoices.getById(other.id, theirs.id).stripeInvoiceId, null, 'the foreign draft is untouched');
  });
});

// --- the redirectors --------------------------------------------------------------

test('GET /invoices/view and GET /contracts/view redirect a UUID-shaped id and refuse everything else with a bounded response', async () => {
  await withReadApp({}, async ({ get }) => {
    const id = randomUUID();
    for (const [route, target] of [['/invoices/view', detailPath(id)], ['/contracts/view', `/contracts/${id}`]]) {
      const ok = await get(`${route}?id=${id}`);
      assert.equal(ok.status, 303, route);
      assert.equal(ok.headers.get('location'), target, 'Location exactly the detail path');
      const refused = [`${route}?id=../x`, `${route}?id[]=a`, route, `${route}?id=`, `${route}?id=${'a'.repeat(2000)}`, `${route}?id=${id.toUpperCase()}`, `${route}?id=${id}x`];
      for (const path of refused) {
        const res = await get(path);
        assert.equal(res.status, 404, path.slice(0, 60));
        assert.match(res.headers.get('content-type'), /^text\/plain\b/, path.slice(0, 60));
        assert.equal(res.headers.get('location'), null, `${path.slice(0, 60)}: no Location at all`);
        const body = await res.text();
        assert.equal(body, 'NotFoundError: screen-view\n', 'one line, nothing of the input echoed');
        assert.equal(body.length < 40, true, 'bounded');
      }
    }
  });
});

test('GET /invoices/view is served by the redirector, never by the :id route', async () => {
  // Registration order is load-bearing: `:id` matches the literal `view`, so a
  // redirector registered below `GET /invoices/:id` would never run and the
  // detail route would answer an HTML S5-ERROR-NOTFOUND at 404.
  await withReadApp({}, async ({ get, repos, freelancer, draft }) => {
    const local = draft();
    const res = await get(`/invoices/view?id=${local.id}`);
    assert.equal(res.status, 303, 'answered by the redirector');
    assert.equal(res.headers.get('location'), detailPath(local.id));
    assert.equal(occurrences(await res.text(), 'data-state'), 0, 'no template rendered');
    // And the contract twin, against a route surface that has no :id yet.
    const twin = await get(`/contracts/view?id=${local.id}`);
    assert.equal(twin.status, 303);
    assert.equal(repos.invoices.listByFreelancer(freelancer.id).length, 1, 'nothing was created');
  });
});

test('S5-DENIED-NOTOWNER is byte-identical to S5-ERROR-NOTFOUND', async () => {
  await withReadApp({}, async ({ get, repos }) => {
    const other = repos.freelancers.create({ email: 'o@example.test', displayName: 'Other' });
    const otherClient = repos.clients.create(other.id, { name: 'Theirs', email: 'theirs@example.test' });
    const theirs = repos.invoices.createDraft(other.id, { clientId: otherClient.id, daysUntilDue: 1, lineItems: [{ description: 'x', quantity: 1, unitAmountMinor: 1 }] });
    const notOwner = await get(detailPath(theirs.id));
    const notFound = await get(detailPath(randomUUID()));
    assert.equal(notOwner.status, 404);
    assert.equal(notFound.status, 404);
    const [a, b] = [await notOwner.text(), await notFound.text()];
    assert.equal(a, b, 'byte for byte');
    assert.equal(stateOf(a), 'S5-ERROR-NOTFOUND');
    assert.equal(occurrences(a, 'We couldn&#39;t find that invoice.'), 1, 'as served: EJS escapes the apostrophe');
    assert.equal(occurrences(a, '<a href="/">Back to Dashboard</a>'), 1);
    assert.equal(occurrences(a, theirs.id), 0, 'the id is not echoed');
    assert.equal(occurrences(a, 'Theirs'), 0, 'nothing of the other freelancer leaks');
  });
});

test('S5-ERROR-SYSTEM: a dropped invoice_line_items table renders the error banner at 500 with a retry form', async () => {
  await withReadApp({}, async ({ get, draft, dropTable }) => {
    const local = draft();
    assert.equal(stateOf(await (await get(detailPath(local.id))).text()), 'S5-DEFAULT-DRAFT', 'the control: rendered before the fault');
    dropTable('invoice_line_items');
    const res = await get(detailPath(local.id));
    assert.equal(res.status, 500);
    assert.match(res.headers.get('content-type'), /^text\/html\b/);
    const html = await res.text();
    assert.equal(stateOf(html), 'S5-ERROR-SYSTEM');
    assert.equal(occurrences(html, 'Something went wrong loading this invoice.'), 1);
    assert.equal(occurrences(html, 'banner-error'), 1);
    assert.equal(occurrences(html, '<form method="get">'), 1, 'Retry: a GET form with no action attribute');
    assert.equal(occurrences(html, '$80.00'), 0);
    assert.equal(occurrences(html, local.id), 0);
  });
});

test('S3-DENIED-SIGNEDOUT and S5-DENIED-SIGNEDOUT: cookieless GETs 303 to /signin with next; the redirectors and POST /invoices/send too', async () => {
  await withReadApp({}, async ({ base, draft }) => {
    const local = draft();
    const gets = ['/', detailPath(local.id), `/invoices/view?id=${local.id}`, `/contracts/view?id=${local.id}`];
    for (const path of gets) {
      const res = await fetch(`${base}${path}`, { redirect: 'manual' });
      assert.equal(res.status, 303, path);
      // `next` is the whole original URL, query string included, so the
      // freelancer lands where they were going — the redirector's ?id survives.
      assert.equal(res.headers.get('location'), `/signin?next=${encodeURIComponent(path)}`, path);
      assert.equal(res.headers.getSetCookie().length, 0, `${path}: the guard sets no cookie`);
      assert.equal(occurrences(await res.text(), 'data-state'), 0);
    }
    const post = await fetch(`${base}/invoices/send`, {
      method: 'POST',
      redirect: 'manual',
      headers: { origin: base, 'content-type': 'application/x-www-form-urlencoded' },
      body: `id=${local.id}`,
    });
    assert.equal(post.status, 303);
    assert.equal(post.headers.get('location'), '/signin', 'an unsafe method carries no next');
    assert.equal(post.headers.getSetCookie().length, 0);
  });
});

// --- the link check over the two new templates and the amended nav -------------------

/** Constant href/action values across the two AS-48 templates, predicted
 *  before the run and read off it: dashboard.ejs 9, invoice-detail.ejs 8.
 *  RE-MEASURED by AS-127 (the "New contract" nav anchor on both, and the
 *  first-run contract CTA on dashboard.ejs): dashboard.ejs 11,
 *  invoice-detail.ejs 9 — predicted before the run, then read off it. */
const NEW_TEMPLATE_LINKS = 20;

test('every href and form action in every template names a route the app registers or a file public/ serves', async () => {
  // The AS-46 case-25 walker, duplicated (its twenty lines) rather than
  // imported: a test file is not a module, and importing it would run it. The
  // invoice-screen.test.js copy still walks every template with the whole
  // count; this one is scoped to the two new files so its cardinality names
  // them. It was RED while `/contracts/new` was linked before AS-127 landed;
  // now it pins the three links AS-127 owed these templates.
  const config = configFor();
  const publicFiles = new Set(['/app.css']);
  await withServer(config, async (base, app) => {
    const routes = new Set(discoverRoutes(app));
    const examined = [];
    const problems = [];
    const files = VIEWS.map((v) => v.file).filter((f) => f === 'dashboard.ejs' || f === 'invoice-detail.ejs');
    assert.equal(files.length, 2, 'both AS-48 templates are registered');
    for (const file of files) {
      const source = readFileSync(join(config.viewsDir, file), 'utf8');
      assert.equal(occurrences(source, 'href="<%'), 0, `${file}: an interpolated href`);
      assert.equal(occurrences(source, 'action="<%'), 0, `${file}: an interpolated action`);
      for (const [, href] of source.matchAll(/\bhref="([^"]*)"/g)) {
        examined.push(`${file} href ${href}`);
        if (!routes.has(`GET ${href}`) && !publicFiles.has(href)) problems.push(`${file}: href="${href}" names nothing the app serves`);
      }
      for (const [, attrs] of source.matchAll(/<form\b([^>]*)>/g)) {
        const action = attrs.match(/\baction="([^"]*)"/);
        if (action === null) continue; // the page's own URL
        const method = /\bmethod="get"/i.test(attrs) ? 'GET' : 'POST';
        examined.push(`${file} action ${method} ${action[1]}`);
        if (!routes.has(`${method} ${action[1]}`)) problems.push(`${file}: action="${action[1]}" (${method}) names no registered route`);
      }
    }
    assert.equal(examined.length, NEW_TEMPLATE_LINKS, `examined ${examined.length} links, expected ${NEW_TEMPLATE_LINKS}:\n${examined.join('\n')}`);
    assert.deepEqual(problems, [], problems.join('\n'));
    // AS-127's three: the nav anchor on each template and the Dashboard's
    // first-run CTA — each named by file, each driven above.
    assert.deepEqual(
      examined.filter((e) => e.endsWith('/contracts/new')),
      ['dashboard.ejs href /contracts/new', 'dashboard.ejs href /contracts/new', 'invoice-detail.ejs href /contracts/new'],
      'the New contract nav entry on both templates and the Dashboard CTA (AS-127)',
    );
    // The amended nav in the two existing chrome-bearing templates.
    for (const file of ['invoice-form.ejs', 'connect-stripe.ejs']) {
      const source = readFileSync(join(config.viewsDir, file), 'utf8');
      assert.equal(occurrences(source, 'href="/"'), 1, `${file}: the one Dashboard anchor`);
    }
    // And the shape rule for both new templates: every id sits in a hidden
    // value=, and `state` reaches EJS code only as the data-state attribute.
    for (const file of files) {
      const source = readFileSync(join(config.viewsDir, file), 'utf8');
      const code = [...source.replace(/<%#[\s\S]*?%>/g, '').matchAll(/<%[=-]?([\s\S]*?)%>/g)].map((m) => m[1]).join('\n');
      assert.equal((code.match(/\bstate\b/g) ?? []).length, 1, `${file}: state reaches EJS code exactly once`);
      assert.equal(occurrences(source, '<%-'), 0, `${file}: no raw output`);
      for (const [, expr] of source.matchAll(/<%=\s*([^%]*?)\s*%>/g)) {
        if (/\.id\b|invoiceId/.test(expr)) {
          const at = source.indexOf(`<%= ${expr} %>`);
          assert.match(source.slice(at - 40, at), /name="id" value="$/, `${file}: ${expr} interpolated outside a hidden id input`);
        }
      }
    }
  });
});

// --- money and dates ---------------------------------------------------------------

/** [minor, currency, expected]; a string expected is the thrown error's name. */
const DISPLAY_VECTORS = [
  [0, 'usd', '$0.00'],
  [5, 'usd', '$0.05'],
  [99, 'usd', '$0.99'],
  [100, 'usd', '$1.00'],
  [8000, 'usd', '$80.00'],
  [45000, 'usd', '$450.00'],
  [99999, 'usd', '$999.99'],
  [100000, 'usd', '$1,000.00'],
  [120000, 'usd', '$1,200.00'],
  [123456789, 'usd', '$1,234,567.89'],
  [9007199254740991, 'usd', '$90,071,992,547,409.91'],
  [-1, 'usd', 'ValidationError'],
  [1.5, 'usd', 'ValidationError'],
  ['100', 'usd', 'ValidationError'],
  [NaN, 'usd', 'ValidationError'],
  [2 ** 53, 'usd', 'ValidationError'],
  [100, 'eur', 'ValidationError'],
  [100, 'USD', 'ValidationError'],
  [100, undefined, '$1.00'],
];

/** [input, expected]; a string expected starting with '!' is a throw. */
const DATE_VECTORS = [
  ['2026-08-28T00:00:00Z', 'Aug 28, 2026'],
  ['2026-08-28T00:00:00.000Z', 'Aug 28, 2026'],
  ['2026-08-28T23:59:59.999Z', 'Aug 28, 2026'],
  ['2026-12-31T23:59:59Z', 'Dec 31, 2026'],
  ['2026-09-15T00:00:00.000Z', 'Sep 15, 2026'],
  ['2026-01-01T00:00:00.000Z', 'Jan 1, 2026'],
  ['2026-08-30T15:00:00.000Z', 'Aug 30, 2026'],
  ['nope', '!TypeError'],
  ['2026-08-28', '!TypeError'],
  ['2026-08-28T00:00:00', '!TypeError'],
  ['2026-08-28T00:00:00+02:00', '!TypeError'],
  ['2026-13-45T00:00:00.000Z', '!TypeError'],
  [1756339200000, '!TypeError'],
  [null, '!TypeError'],
  [undefined, '!TypeError'],
];

test('formatDisplayMinorUnits groups thousands, keeps two minor digits, and refuses what assertMinorUnits refuses; formatDate is UTC and refuses non-ISO input', () => {
  // Cardinality FIRST, before any vector runs.
  assert.equal(DISPLAY_VECTORS.length, 19, 'the committed display vector table');
  assert.equal(DATE_VECTORS.length, 15, 'the committed date vector table');
  for (const [minor, currency, expected] of DISPLAY_VECTORS) {
    if (expected === 'ValidationError') {
      assert.throws(() => formatDisplayMinorUnits(minor, currency), { name: 'ValidationError' }, `${String(minor)} ${currency}`);
    } else {
      assert.equal(formatDisplayMinorUnits(minor, currency), expected, `${String(minor)} ${currency}`);
    }
  }
  // Two minor digits always, and a comma every three whole digits: the
  // regex-on-a-digit-string route, never toLocaleString (F10).
  assert.equal(formatDisplayMinorUnits(1000000), '$10,000.00');
  assert.equal(formatDisplayMinorUnits(100000000), '$1,000,000.00');
  for (const [input, expected] of DATE_VECTORS) {
    if (expected.startsWith('!')) {
      assert.throws(() => formatDate(input), { name: expected.slice(1) }, JSON.stringify(input));
    } else {
      assert.equal(formatDate(input), expected, JSON.stringify(input));
    }
  }
  // UTC, not the process zone: one instant, the same date whatever TZ says.
  assert.equal(formatDate('2026-08-28T00:30:00.000Z'), 'Aug 28, 2026');
  assert.equal(formatDate('2026-08-27T23:30:00.000Z'), 'Aug 27, 2026');
});
