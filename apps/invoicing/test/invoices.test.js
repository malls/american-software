// test/invoices.test.js — chain link 4's server half (AS-43, plan §5.3).
//
// R-cases run OFFLINE and still exercise the real thing: the fixture transport
// sits BEHIND the full client pipeline (validate → build → guard → requireKey →
// sign → transport → interpret), so the custody guard runs on every call, and
// the routes are driven over real HTTP through withServer. The transport records
// every wire request it sees, so assertions read the actual bytes.
//
// THE FIXTURE TRANSPORT COMPUTES; IT DOES NOT MERELY CAN. It accumulates the
// `amount` of every /v1/invoiceitems request it sees, keyed by invoice, and
// returns that sum as `amount_due` on the finalize and send responses. That is
// what makes the reconciliation guard (plan §3.7) testable in BOTH directions:
// a mutation that pushes an item twice changes the fixture's answer and trips
// the guard, which a canned constant could never show. stripe-mock cannot do
// this — its amount_due is a constant that does not depend on what we pushed —
// so the M-cases below are structurally incapable of catching a duplicated line
// item, and only this fixture can (recorded in the F3 recipe).
//
// M-cases ({ skip: SKIP }) drive the SAME routes against stripe-mock — Stripe's
// own request-shape validator. They report as skipped (never passed) in the
// `test` service (network_mode: none, no ASC_STRIPE_MOCK_URL) and run in the
// `contract` service. Same self-skip pattern and not-stripe.com refusal as
// stripe-mock.test.js and connect.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { StripeCustodyError, createStripeClient } from '../lib/stripe/client.js';
import { readinessFromAccount } from '../lib/connect/readiness.js';
import { invoiceSnapshotFromStripe } from '../lib/invoices/mapping.js';
import { createRepositories, prepareDatabase } from '../lib/db/database.js';
// R26 only, and it is the whole point of R26: the invariant the dropped
// currency comparison rests on. test/ is in the dependency-policy scan's
// SKIPPED_DIRS, so this import moves no committed literal — verified, not
// assumed, by the green dependency-policy suite either side of this change.
import { SUPPORTED_CURRENCIES } from '../lib/db/money.js';
import { configFor, freshDbPath, seedSession, signedInHeaders, withServer } from './helpers/server.js';

// Not key-shaped on purpose — the stripe-client.test.js convention.
const KEY = 'unit-test-placeholder-key';
const TS = '2026-09-02T10:00:00.000Z';
const ACCT = 'acct_fixture1';
/** Stripe's own fixture epoch, reused so a mapped timestamp is recognisable. */
const DUE_EPOCH = 1234567890;
const FINALIZED_EPOCH = 1788336000;

// --- fixtures -----------------------------------------------------------------

/** A Stripe ACCOUNT object, mapped through AS-41's readiness mapper to seed the
 *  row. Seeding through that mapper (rather than hand-writing the patch) keeps
 *  this file clear of every readiness field name: the ONE derivation of `ready`
 *  lives in lib/db's row mapper, and this task is only its reader. */
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

/** A Stripe INVOICE object. `open` flips exactly what Stripe flips on finalize:
 *  the status, the two hosted URLs and finalized_at. */
function invoiceObject({ id, currency = 'usd', total = 0, paid = 0, open = false }) {
  return {
    id,
    object: 'invoice',
    status: open ? 'open' : 'draft',
    currency,
    amount_due: total,
    amount_paid: paid,
    hosted_invoice_url: open ? `https://pay.example.test/${id}` : null,
    invoice_pdf: open ? `https://pay.example.test/${id}.pdf` : null,
    due_date: DUE_EPOCH,
    status_transitions: {
      finalized_at: open ? FINALIZED_EPOCH : null,
      marked_uncollectible_at: null,
      paid_at: null,
      voided_at: null,
    },
  };
}

function json(data, status = 200) {
  return { status, headers: { 'request-id': 'req_fixture' }, body: JSON.stringify(data) };
}

/** Canned-and-computing Stripe behind the REAL pipeline; records every request.
 *  `intercept(record)` may return a reply to override, or undefined to fall
 *  through to the computed answer.
 *
 *  IT ALSO MODELS STRIPE'S IDEMPOTENCY WINDOW, and that is not a nicety: a
 *  replay of a key it has already answered returns the SAME reply and creates
 *  nothing — no new id, and no second contribution to the running total. The
 *  whole resumable pipeline leans on that mechanism (plan §3.8: "within
 *  Stripe's idempotency window a replay returns the existing item and creates
 *  nothing"), so a fixture that accumulated every request it saw would model a
 *  Stripe that does not exist and would make R11's retry — the case AC 11 is
 *  about — impossible to pass. A reply produced by `intercept` is never
 *  cached: a failed call must be retryable. */
function fixtureTransport({ intercept, unknownTotal = 0 } = {}) {
  const calls = [];
  const invoices = new Map();
  const replays = new Map();
  let seq = 0;
  const nextId = (prefix) => `${prefix}_fixture${(seq += 1)}`;
  const transport = async (signed) => {
    const record = {
      method: signed.method,
      path: signed.url.pathname,
      query: signed.url.search,
      body: signed.body,
      headers: signed.headers,
    };
    calls.push(record);
    if (intercept !== undefined) {
      const reply = await intercept(record);
      if (reply !== undefined) return reply;
    }
    const key = record.headers['idempotency-key'];
    if (key !== undefined && replays.has(key)) return replays.get(key);
    const reply = await answer(record);
    if (key !== undefined) replays.set(key, reply);
    return reply;
  };

  async function answer(record) {
    const params = new URLSearchParams(record.body ?? '');
    if (record.method === 'POST' && record.path === '/v1/customers') {
      return json({ id: nextId('cus'), object: 'customer' });
    }
    if (record.method === 'POST' && record.path === '/v1/invoices') {
      const id = nextId('in');
      invoices.set(id, { currency: params.get('currency'), total: 0 });
      return json(invoiceObject({ id, currency: params.get('currency') }));
    }
    if (record.method === 'POST' && record.path === '/v1/invoiceitems') {
      // THE COMPUTING HALF: what we push is what comes back as amount_due.
      const target = invoices.get(params.get('invoice'));
      if (target !== undefined) target.total += Number(params.get('amount'));
      return json({ id: nextId('ii'), object: 'invoiceitem' });
    }
    const issued = record.path.match(/^\/v1\/invoices\/([^/]+)\/(finalize|send)$/);
    if (record.method === 'POST' && issued !== null) {
      const id = issued[1];
      const known = invoices.get(id) ?? { currency: 'usd', total: unknownTotal };
      return json(invoiceObject({ id, currency: known.currency, total: known.total, open: true }));
    }
    throw new Error(`fixture transport: unexpected ${record.method} ${record.path}`);
  }

  return { transport, calls };
}

const ITEMS = [
  { description: 'Design work', quantity: 2, unitAmountMinor: 5000 },
  { description: 'Copy review', quantity: 1, unitAmountMinor: 2500 },
];
const ITEMS_TOTAL = 12_500;

/** withServer + a fixture-transport client + a freelancer, a ready connected
 *  account and one client, which is the state every finalize case starts from. */
async function withInvoiceApp(
  { fixture = {}, apiKey = KEY, stripe: stripeOverride, connected = true, charges = true, due = [], customerId = null } = {},
  fn,
) {
  const { transport, calls } = fixtureTransport(fixture);
  // `stripe` substitutes a stub for the whole client, which R24 needs to raise a
  // custody refusal the real guard cannot be talked into raising here: every
  // call this task makes is allowlisted and connected-scope, so the 500 row of
  // the taxonomy is unreachable through the real pipeline by design.
  const stripe = stripeOverride ?? createStripeClient({ apiKey, transport });
  await withServer(configFor(), async (base, app, deps) => {
    const repos = deps.repos;
    const freelancer = repos.freelancers.create({ email: 'f@example.test', displayName: 'Freda Lancer' });
    if (connected) {
      repos.connectedAccounts.create({ freelancerId: freelancer.id, stripeAccountId: ACCT });
      repos.connectedAccounts.updateReadiness(ACCT, readinessFromAccount(stripeAccount({ charges, due }), TS));
    }
    const client = repos.clients.create(freelancer.id, { name: 'Client Co', email: 'client@example.test' });
    if (customerId !== null) repos.clients.setStripeCustomerId(freelancer.id, client.id, customerId);
    auth.headers = signedInHeaders(base, seedSession(repos, freelancer.id).cookie);
    await fn({ base, repos, freelancer, client, calls });
  }, { stripe });
}

const draftOf = (repos, freelancerId, clientId, lineItems = ITEMS, daysUntilDue = 30) =>
  repos.invoices.createDraft(freelancerId, { clientId, daysUntilDue, lineItems });

function itemFields(items) {
  const out = {};
  items.forEach((item, index) => {
    out[`lineItems[${index}][description]`] = item.description;
    out[`lineItems[${index}][quantity]`] = String(item.quantity);
    out[`lineItems[${index}][unitAmountMinor]`] = String(item.unitAmountMinor);
  });
  return out;
}

/** THE SEEDED FREELANCER'S SESSION (AS-40). These four routes sit below the
 *  auth boundary and no case here is about signing in, so the helper seeds a
 *  session ROW (no KDF) and every request carries its cookie and an Origin the
 *  same-origin check accepts. Set by withInvoiceApp/withMockApp before each
 *  case; node --test runs a file's top-level tests sequentially. */
const auth = { headers: {} };

const post = (url) => fetch(url, { method: 'POST', redirect: 'manual', headers: auth.headers });
const postForm = (url, fields) =>
  fetch(url, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...auth.headers },
    body: typeof fields === 'string' ? fields : new URLSearchParams(fields).toString(),
  });
const keysOf = (body) => [...new URLSearchParams(body ?? '').keys()].sort();
const paramsOf = (body) => new URLSearchParams(body ?? '');
const pathsOf = (calls) => calls.map((call) => call.path);

// --- R1: the mapper --------------------------------------------------------------

/** The committed key list. Ten keys, and the COUNT is asserted before anything
 *  is quantified over them — a mapper that grew or lost a key changes this
 *  literal, deliberately and visibly. */
const SNAPSHOT_KEYS = [
  'amountDueMinor',
  'amountPaidMinor',
  'dueAt',
  'finalizedAt',
  'hostedInvoiceUrl',
  'invoicePdfUrl',
  'markedUncollectibleAt',
  'paidAt',
  'status',
  'voidedAt',
];

test('R1: the mapper — the exact ten keys, epoch→ISO, the invoice_pdf rename, tolerance, strictness, and AS-44 reuse', () => {
  const open = invoiceObject({ id: 'in_r1', total: 12_500, open: true });
  const mapped = invoiceSnapshotFromStripe(open);

  // Cardinality FIRST, against the committed literal.
  assert.equal(Object.keys(mapped).length, 10, `expected exactly 10 snapshot keys, got ${Object.keys(mapped).join(', ')}`);
  assert.deepEqual(Object.keys(mapped).sort(), SNAPSHOT_KEYS);

  // sentAt and lastPaymentFailedAt are NEVER emitted (plan §3.6). If they were,
  // the next full snapshot would erase a recorded fact — see R23.
  assert.ok(!Object.hasOwn(mapped, 'sentAt'), 'sentAt is not a Stripe field and must never be emitted');
  assert.ok(!Object.hasOwn(mapped, 'lastPaymentFailedAt'), 'lastPaymentFailedAt is AS-44\'s, from its own event');

  assert.deepEqual(mapped, {
    status: 'open',
    hostedInvoiceUrl: 'https://pay.example.test/in_r1',
    // THE RENAME: Stripe says invoice_pdf, the mirror says invoicePdfUrl.
    invoicePdfUrl: 'https://pay.example.test/in_r1.pdf',
    amountDueMinor: 12_500,
    amountPaidMinor: 0,
    dueAt: '2009-02-13T23:31:30.000Z',
    finalizedAt: '2026-09-02T08:00:00.000Z',
    paidAt: null,
    voidedAt: null,
    markedUncollectibleAt: null,
  });

  // All four status_transitions convert, and null stays null.
  const everything = invoiceSnapshotFromStripe({
    ...open,
    status: 'paid',
    status_transitions: { finalized_at: FINALIZED_EPOCH, paid_at: 1788336001, voided_at: 1788336002, marked_uncollectible_at: 1788336003 },
  });
  assert.equal(everything.paidAt, '2026-09-02T08:00:01.000Z');
  assert.equal(everything.voidedAt, '2026-09-02T08:00:02.000Z');
  assert.equal(everything.markedUncollectibleAt, '2026-09-02T08:00:03.000Z');

  // Tolerant where Stripe may be absent: no transitions hash, a null one, and
  // null fields all read as four nulls; absent URLs read as null.
  const bare = { id: 'in_bare', object: 'invoice', status: 'draft', currency: 'usd', amount_due: 0, amount_paid: 0 };
  for (const view of [bare, { ...bare, status_transitions: null }, { ...bare, status_transitions: {} }]) {
    const patch = invoiceSnapshotFromStripe(view);
    assert.deepEqual(
      [patch.finalizedAt, patch.paidAt, patch.voidedAt, patch.markedUncollectibleAt, patch.hostedInvoiceUrl, patch.invoicePdfUrl, patch.dueAt],
      [null, null, null, null, null, null, null],
    );
  }

  // Strict where Stripe is always present: a shape we do not understand is a
  // TypeError (502 at the route), never a guess.
  for (const broken of [
    null,
    'invoice',
    ['invoice'],
    { ...bare, status: 42 },
    { ...bare, status: undefined },
    { ...bare, amount_due: '1000' },
    { ...bare, amount_due: 10.5 },
    { ...bare, amount_paid: null },
    { ...bare, due_date: '1234567890' },
    { ...bare, hosted_invoice_url: 42 },
    { ...bare, status_transitions: 'none' },
    { ...bare, status_transitions: { paid_at: 'yesterday' } },
  ]) {
    assert.throws(() => invoiceSnapshotFromStripe(broken), TypeError);
  }

  // The output is accepted by applyStripeSnapshot with no unknown key — the
  // assertKnownKeys contract, proven rather than assumed.
  const { db } = prepareDatabase({ dbPath: freshDbPath() });
  try {
    const repos = createRepositories(db);
    const f = repos.freelancers.create({ email: 'r1@example.test', displayName: 'R1' });
    const c = repos.clients.create(f.id, { name: 'C', email: 'c@example.test' });
    const draft = draftOf(repos, f.id, c.id);
    repos.invoices.attachStripeInvoice(f.id, draft.id, 'in_r1');
    const applied = repos.invoices.applyStripeSnapshot('in_r1', mapped);
    assert.equal(applied.outcome, 'applied');
    assert.equal(applied.invoice.status, 'open');
    assert.equal(applied.invoice.invoicePdfUrl, 'https://pay.example.test/in_r1.pdf');

    // AS-44's reuse, proven before AS-44 exists: an invoice.paid EVENT's
    // data.object is an invoice object, and maps identically.
    const paidInvoice = invoiceObject({ id: 'in_r1', total: 12_500, paid: 12_500, open: true });
    paidInvoice.status = 'paid';
    const event = { id: 'evt_fixture1', object: 'event', type: 'invoice.paid', data: { object: paidInvoice } };
    assert.deepEqual(invoiceSnapshotFromStripe(event.data.object), invoiceSnapshotFromStripe(paidInvoice));
  } finally {
    db.close();
  }
});

// --- R2–R5: the local draft, zero Stripe calls -----------------------------------

test('R2: create a draft — 303 to the edit screen, items in position order, total derived, zero transport calls', async () => {
  await withInvoiceApp({}, async ({ base, repos, freelancer, client, calls }) => {
    const res = await postForm(`${base}/invoices`, {
      clientId: client.id,
      daysUntilDue: '30',
      currency: 'usd',
      ...itemFields(ITEMS),
    });
    assert.equal(res.status, 303);
    const location = res.headers.get('location');
    // AS-40: the target is app-relative and carries NO identity — the screen
    // that will own it reads the session, exactly as this handler does.
    assert.match(location, /^\/invoices\/[^/]+\/edit$/);
    assert.equal(calls.length, 0, 'a draft is LOCAL: no Stripe call, ever');

    const [row] = repos.invoices.listByFreelancer(freelancer.id);
    assert.equal(location, `/invoices/${row.id}/edit`);
    assert.equal(row.status, 'draft');
    assert.equal(row.stripeInvoiceId, null);
    assert.equal(row.daysUntilDue, 30);
    assert.equal(row.currency, 'usd');
    assert.equal(row.totalMinor, ITEMS_TOTAL);
    const full = repos.invoices.getById(freelancer.id, row.id);
    assert.deepEqual(full.lineItems.map((item) => [item.position, item.description, item.quantity, item.unitAmountMinor]), [
      [0, 'Design work', 2, 5000],
      [1, 'Copy review', 1, 2500],
    ]);
  });
});

test('R3: every malformed draft is a 400 with zero transport calls — and an oversized body is the parser\'s own status', async () => {
  await withInvoiceApp({}, async ({ base, repos, freelancer, client, calls }) => {
    const good = { clientId: client.id, daysUntilDue: '30', ...itemFields(ITEMS) };
    const bad = [
      ['no line items at all', { clientId: client.id, daysUntilDue: '30' }],
      ['blank description', { ...good, 'lineItems[0][description]': '   ' }],
      ['quantity=0', { ...good, 'lineItems[0][quantity]': '0' }],
      ['quantity=1.5', { ...good, 'lineItems[0][quantity]': '1.5' }],
      ['quantity=1e3', { ...good, 'lineItems[0][quantity]': '1e3' }],
      ['quantity blank', { ...good, 'lineItems[0][quantity]': '' }],
      ['quantity spaces', { ...good, 'lineItems[0][quantity]': '  ' }],
      ['unitAmountMinor=-1', { ...good, 'lineItems[0][unitAmountMinor]': '-1' }],
      ['daysUntilDue=0', { ...good, daysUntilDue: '0' }],
      ['daysUntilDue missing', { clientId: client.id, ...itemFields(ITEMS) }],
      ['clientId blank', { ...good, clientId: '  ' }],
      ['unknown top-level field', { ...good, notes: 'hello' }],
      ['unknown line-item field', { ...good, 'lineItems[0][taxRate]': '20' }],
      // Index 200 is past the array limit — see the MEASURED note in R5.
      ['non-contiguous indexes', { clientId: client.id, daysUntilDue: '30', ...itemFields(ITEMS), 'lineItems[200][description]': 'x', 'lineItems[200][quantity]': '1', 'lineItems[200][unitAmountMinor]': '1' }],
      ['unsupported currency', { ...good, currency: 'eur' }],
    ];
    for (const [label, fields] of bad) {
      const res = await postForm(`${base}/invoices`, fields);
      assert.equal(res.status, 400, `${label} must be 400, got ${res.status}`);
      assert.match(res.headers.get('content-type'), /text\/plain/);
      assert.match(await res.text(), /ValidationError/, label);
    }
    // The router-scoped parser's own limits answer before we count items: a
    // body past 64kb never reaches a handler and carries the parser's status.
    const huge = await postForm(`${base}/invoices`, `clientId=${'x'.repeat(70_000)}`);
    assert.equal(huge.status, 413);

    assert.equal(calls.length, 0, 'nothing malformed reaches Stripe');
    assert.deepEqual(repos.invoices.listByFreelancer(freelancer.id), [], 'and nothing malformed reaches the database');
  });
});

test('R4: update a draft — clientId and daysUntilDue change, line items are replaced AS A SET, zero transport calls', async () => {
  await withInvoiceApp({}, async ({ base, repos, freelancer, client, calls }) => {
    const other = repos.clients.create(freelancer.id, { name: 'Second Co', email: 'second@example.test' });
    const draft = draftOf(repos, freelancer.id, client.id);
    const replacement = [{ description: 'Rewrite', quantity: 3, unitAmountMinor: 1000 }];
    const res = await postForm(`${base}/invoices/${draft.id}`, {
      clientId: other.id,
      daysUntilDue: '14',
      ...itemFields(replacement),
    });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), `/invoices/${draft.id}/edit`);
    const row = repos.invoices.getById(freelancer.id, draft.id);
    assert.equal(row.clientId, other.id);
    assert.equal(row.daysUntilDue, 14);
    assert.equal(row.totalMinor, 3000);
    assert.deepEqual(row.lineItems.map((item) => [item.position, item.description]), [[0, 'Rewrite']], 'positions renumbered from 0');
    assert.equal(calls.length, 0);
  });
});

test('R5: 25 line items survive body parsing in order with the right amounts; 51 is a 400; a past-the-limit index is a 400', async () => {
  // MEASURED against the shipped body-parser (express 5.2.1), because this is
  // exactly the library default the route refuses to assume:
  //
  //   arrayLimit = Math.max(100, <parameter count of THIS request>)
  //
  // — a threshold that MOVES WITH THE REQUEST, not the fixed 20 of bare qs. Two
  // consequences, both verified in the image: (a) a 25-item bracket set (75
  // parameters) arrives as a dense ARRAY, so this case exercises the array
  // branch, not the object branch; (b) a set sparse BELOW that limit is silently
  // COMPACTED into a dense array — indexes 0 and 30 arrive as a 2-element array,
  // gap closed. The object branch is therefore reachable only above index ~100,
  // which with MAX_LINE_ITEMS = 50 always means a refusal — asserted at the end
  // of this case. The normaliser keeps both branches anyway: a limit derived
  // from request size is a stronger reason not to depend on it, not a weaker one.
  const many = Array.from({ length: 25 }, (unused, i) => ({
    description: `Item ${i}`,
    quantity: i + 1,
    unitAmountMinor: 100 + i,
  }));
  const expectedTotal = many.reduce((sum, item) => sum + item.quantity * item.unitAmountMinor, 0);
  await withInvoiceApp({}, async ({ base, repos, freelancer, client, calls }) => {
    const res = await postForm(`${base}/invoices`, {
      clientId: client.id,
      daysUntilDue: '30',
      ...itemFields(many),
    });
    assert.equal(res.status, 303);
    const [row] = repos.invoices.listByFreelancer(freelancer.id);
    const full = repos.invoices.getById(freelancer.id, row.id);
    assert.equal(full.lineItems.length, 25, 'cardinality before quantification');
    assert.deepEqual(
      full.lineItems.map((item) => [item.position, item.description, item.quantity, item.unitAmountMinor]),
      many.map((item, i) => [i, item.description, item.quantity, item.unitAmountMinor]),
    );
    assert.equal(full.totalMinor, expectedTotal);

    const tooMany = Array.from({ length: 51 }, (unused, i) => ({ description: `Item ${i}`, quantity: 1, unitAmountMinor: 1 }));
    const refused = await postForm(`${base}/invoices`, {
      clientId: client.id,
      daysUntilDue: '30',
      ...itemFields(tooMany),
    });
    assert.equal(refused.status, 400);
    assert.match(await refused.text(), /ValidationError/);

    // The OBJECT branch, through the real parser: one item at index 0 and one
    // past the array limit. qs yields a numeric-keyed object, the normaliser
    // sorts it, and the gap is refused rather than quietly closed.
    const sparse = await postForm(`${base}/invoices`, {
      clientId: client.id,
      daysUntilDue: '30',
      ...itemFields([ITEMS[0]]),
      'lineItems[200][description]': 'Past the limit',
      'lineItems[200][quantity]': '1',
      'lineItems[200][unitAmountMinor]': '1',
    });
    assert.equal(sparse.status, 400);
    assert.match(await sparse.text(), /ValidationError/);

    assert.equal(calls.length, 0);
  });
});

// --- R6–R19: the pipeline --------------------------------------------------------

test('R6: finalize happy path — 1+1+N+1 calls in order, every wire shape, the mirror, and no send', async () => {
  await withInvoiceApp({}, async ({ base, repos, freelancer, client, calls }) => {
    const draft = draftOf(repos, freelancer.id, client.id);
    const res = await post(`${base}/invoices/${draft.id}/finalize`);
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), `/invoices/${draft.id}`);

    const row = repos.invoices.getById(freelancer.id, draft.id);
    // Cardinality first, then the shapes.
    assert.equal(calls.length, 1 + 1 + ITEMS.length + 1, `expected 1+1+${ITEMS.length}+1 calls, got ${pathsOf(calls).join(' ')}`);
    assert.deepEqual(pathsOf(calls), [
      '/v1/customers',
      '/v1/invoices',
      '/v1/invoiceitems',
      '/v1/invoiceitems',
      `/v1/invoices/${row.stripeInvoiceId}/finalize`,
    ]);
    assert.equal(calls.filter((call) => call.path.endsWith('/send')).length, 0, 'finalize stops at step 4');

    const updatedClient = repos.clients.getById(freelancer.id, client.id);
    for (const call of calls) {
      assert.equal(call.method, 'POST', 'five POSTs, zero GETs');
      assert.equal(call.headers['stripe-account'], ACCT, `${call.path} carries the row's acct_`);
    }

    const [customer, invoice, first, second, finalize] = calls;
    assert.deepEqual(keysOf(customer.body), ['email', 'metadata[local_client_id]', 'name']);
    assert.equal(paramsOf(customer.body).get('email'), 'client@example.test');
    assert.equal(paramsOf(customer.body).get('name'), 'Client Co');
    assert.equal(paramsOf(customer.body).get('metadata[local_client_id]'), client.id);
    assert.equal(customer.headers['idempotency-key'], `cus-create-${client.id}`);

    assert.deepEqual(keysOf(invoice.body), [
      'auto_advance',
      'collection_method',
      'currency',
      'customer',
      'days_until_due',
      'metadata[local_invoice_id]',
      'pending_invoice_items_behavior',
    ]);
    const invoiceParams = paramsOf(invoice.body);
    assert.equal(invoiceParams.get('customer'), updatedClient.stripeCustomerId);
    assert.equal(invoiceParams.get('collection_method'), 'send_invoice');
    assert.equal(invoiceParams.get('days_until_due'), '30');
    assert.equal(invoiceParams.get('currency'), 'usd');
    assert.equal(invoiceParams.get('auto_advance'), 'false', 'an unfinalized invoice must stay inert until WE act');
    assert.equal(invoiceParams.get('pending_invoice_items_behavior'), 'exclude');
    assert.equal(invoiceParams.get('metadata[local_invoice_id]'), draft.id);
    assert.equal(invoice.headers['idempotency-key'], `inv-create-${draft.id}`);

    // Items: the invoice is named explicitly, and the amount is OUR extended
    // total — never a unit price, which this endpoint rejects outright.
    const seeded = repos.invoices.getById(freelancer.id, draft.id).lineItems;
    [first, second].forEach((item, index) => {
      assert.deepEqual(keysOf(item.body), ['amount', 'currency', 'customer', 'description', 'invoice', 'metadata[local_line_item_id]']);
      const params = paramsOf(item.body);
      assert.equal(params.get('invoice'), row.stripeInvoiceId);
      assert.equal(params.get('customer'), updatedClient.stripeCustomerId);
      assert.equal(params.get('currency'), 'usd');
      assert.equal(params.get('description'), ITEMS[index].description);
      assert.equal(params.get('amount'), String(ITEMS[index].quantity * ITEMS[index].unitAmountMinor));
      assert.equal(params.get('metadata[local_line_item_id]'), seeded[index].id);
      assert.equal(item.headers['idempotency-key'], `ii-create-${seeded[index].id}`);
    });

    assert.deepEqual(keysOf(finalize.body), ['auto_advance']);
    assert.equal(paramsOf(finalize.body).get('auto_advance'), 'false', 'emailed exactly once, by our explicit send');
    assert.equal(finalize.headers['idempotency-key'], `inv-finalize-${draft.id}`);

    // The mirror.
    assert.equal(row.status, 'open');
    assert.equal(row.hostedInvoiceUrl, `https://pay.example.test/${row.stripeInvoiceId}`);
    assert.equal(row.invoicePdfUrl, `https://pay.example.test/${row.stripeInvoiceId}.pdf`);
    assert.equal(row.amountDueMinor, ITEMS_TOTAL);
    assert.equal(row.amountPaidMinor, 0);
    assert.equal(row.dueAt, '2009-02-13T23:31:30.000Z');
    assert.equal(row.finalizedAt, '2026-09-02T08:00:00.000Z');
    assert.equal(row.sentAt, null, 'finalize does not send');
    assert.equal(row.paidAt, null);
    assert.equal(row.voidedAt, null);
    assert.equal(row.markedUncollectibleAt, null);
    assert.equal(row.lastPaymentFailedAt, null);
    assert.ok(updatedClient.stripeCustomerId.startsWith('cus_'), 'the customer id was stored on the client');
  });
});

test('R7: a NOT-READY account is 403 before any Stripe call, in both of its shapes', async () => {
  for (const [label, options] of [
    ['charges off', { charges: false }],
    ['requirements outstanding', { charges: true, due: ['external_account'] }],
  ]) {
    await withInvoiceApp(options, async ({ base, repos, freelancer, client, calls }) => {
      const draft = draftOf(repos, freelancer.id, client.id);
      const res = await post(`${base}/invoices/${draft.id}/finalize`);
      assert.equal(res.status, 403, label);
      assert.equal(await res.text(), 'AccountNotReadyError: not-ready\n');
      assert.equal(calls.length, 0, `${label}: the gate is upstream of the client`);
      const row = repos.invoices.getById(freelancer.id, draft.id);
      assert.equal(row.status, 'draft');
      assert.equal(row.stripeInvoiceId, null);
    });
  }
});

test('R8: no connected-account row at all is 403 not-connected, zero transport calls, on both issuing routes', async () => {
  for (const route of ['finalize', 'send']) {
    await withInvoiceApp({ connected: false }, async ({ base, repos, freelancer, client, calls }) => {
      const draft = draftOf(repos, freelancer.id, client.id);
      const res = await post(`${base}/invoices/${draft.id}/${route}`);
      assert.equal(res.status, 403, route);
      assert.equal(await res.text(), 'AccountNotReadyError: not-connected\n');
      assert.equal(calls.length, 0);
    });
  }
});

test('R9: a client that already carries a cus_ makes ZERO /v1/customers calls, and the stored id is what the invoice names', async () => {
  await withInvoiceApp({ customerId: 'cus_alreadythere' }, async ({ base, repos, freelancer, client, calls }) => {
    const draft = draftOf(repos, freelancer.id, client.id);
    const res = await post(`${base}/invoices/${draft.id}/finalize`);
    assert.equal(res.status, 303);
    assert.equal(calls.filter((call) => call.path === '/v1/customers').length, 0, 'a client is one Stripe customer, forever');
    assert.equal(calls.length, 1 + ITEMS.length + 1);
    assert.equal(paramsOf(calls[0].body).get('customer'), 'cus_alreadythere');
    for (const item of calls.slice(1, 1 + ITEMS.length)) {
      assert.equal(paramsOf(item.body).get('customer'), 'cus_alreadythere');
    }
    assert.equal(repos.clients.getById(freelancer.id, client.id).stripeCustomerId, 'cus_alreadythere');
  });
});

test('R10: a second finalize makes zero Stripe calls and still 303s — every step skipped', async () => {
  await withInvoiceApp({}, async ({ base, repos, freelancer, client, calls }) => {
    const draft = draftOf(repos, freelancer.id, client.id);
    const url = `${base}/invoices/${draft.id}/finalize`;
    assert.equal((await post(url)).status, 303);
    const after = calls.length;
    const second = await post(url);
    assert.equal(second.status, 303);
    assert.equal(second.headers.get('location'), `/invoices/${draft.id}`);
    assert.equal(calls.length, after, 'the mirror already records every step done');
    assert.equal(repos.invoices.getById(freelancer.id, draft.id).status, 'open');
  });
});

test('R11: a failed finalize is resumable — the retry reuses the SAME in_ and re-pushes items under the same keys; and a resumed SEND whose totals agree is not blocked', async () => {
  let failFinalize = true;
  let failSend = true;
  const intercept = (record) => {
    if (failFinalize && record.path.endsWith('/finalize')) {
      return json({ error: { type: 'api_error', message: 'synthetic refusal' } }, 500);
    }
    if (failSend && record.path.endsWith('/send')) {
      return json({ error: { type: 'api_error', message: 'synthetic refusal' } }, 500);
    }
    return undefined;
  };
  await withInvoiceApp({ fixture: { intercept } }, async ({ base, repos, freelancer, client, calls }) => {
    const draft = draftOf(repos, freelancer.id, client.id);
    const url = `${base}/invoices/${draft.id}/finalize`;

    const failed = await post(url);
    assert.equal(failed.status, 502);
    assert.equal(await failed.text(), 'StripeApiError: finalize\n', 'the body names WHICH interaction failed');
    const mid = repos.invoices.getById(freelancer.id, draft.id);
    assert.notEqual(mid.stripeInvoiceId, null, 'the invoice was attached before the finalize was attempted');
    assert.equal(mid.status, 'draft', 'and the mirror does not pretend it finalized');
    const firstRun = calls.length;
    const itemKeys = calls.filter((call) => call.path === '/v1/invoiceitems').map((call) => call.headers['idempotency-key']);

    failFinalize = false;
    const retried = await post(url);
    assert.equal(retried.status, 303);
    const row = repos.invoices.getById(freelancer.id, draft.id);
    assert.equal(row.stripeInvoiceId, mid.stripeInvoiceId, 'the SAME Stripe invoice — no second one');
    assert.equal(row.status, 'open');
    const second = calls.slice(firstRun);
    assert.equal(second.filter((call) => call.path === '/v1/invoices').length, 0, 'zero second create-invoice calls');
    assert.equal(second.filter((call) => call.path === '/v1/customers').length, 0, 'and zero second create-customer calls');
    assert.deepEqual(
      second.filter((call) => call.path === '/v1/invoiceitems').map((call) => call.headers['idempotency-key']),
      itemKeys,
      'items re-pushed under the SAME per-item keys — Stripe deduplicates them, we do not skip them',
    );

    // THE FALSE-POSITIVE DIRECTION, which is the one nobody remembers. Since
    // review cycle 1 the reconciliation guard runs on EVERY resumed request with
    // no predicate of its own, so it now sits between an ordinary retry and its
    // send. Prove it does not block a good one: the mirror is `open` and its
    // amounts agree, so this request must skip steps 1-4, reconcile clean, and
    // reach step 5. Failing send first, so the retry is a genuine resume rather
    // than a fresh run.
    const sendUrl = `${base}/invoices/${draft.id}/send`;
    const failedSend = await post(sendUrl);
    assert.equal(failedSend.status, 502);
    assert.equal(await failedSend.text(), 'StripeApiError: send\n', 'the guard let it through — it died at the send');
    assert.equal(repos.invoices.getById(freelancer.id, draft.id).sentAt, null);

    failSend = false;
    const beforeResume = calls.length;
    const resumed = await post(sendUrl);
    assert.equal(resumed.status, 303, 'a resumed send whose totals AGREE is not refused');
    assert.deepEqual(
      pathsOf(calls.slice(beforeResume)),
      [`/v1/invoices/${row.stripeInvoiceId}/send`],
      'exactly one call on the resumed request: steps 1-4 all skipped, and the guard costs nothing',
    );
    assert.notEqual(repos.invoices.getById(freelancer.id, draft.id).sentAt, null);
  });
});

// THE LOAD-BEARING CASE for AC 10, and the one review cycle 1 stopped one
// request short of. It is the ONLY case whose mirror actually reaches `open`,
// so it is the only one that takes the resumed-skip path — the path on which
// the guard did not exist. M3 tests the same refusal against stripe-mock but
// cannot reach this path (the mock is stateless, so its mirror stays `draft`
// and its second request is refused by the finalizing path instead). M3 must
// not be read as standing in for this case; F8 in the plan's §7 is the recipe
// that proves the difference by restoring the defect.
//
// The old currency sub-case is deleted, not moved: the currency half of the
// comparison was dropped by the tech lead's 2026-09-02 ruling (plan §3.7), and
// R26 pins the invariant it rests on.
test('R12: the reconciliation guard fires, and KEEPS firing — 409 on the first request AND on every request after it', async () => {
  const inflate = (record) => {
    const match = record.path.match(/^\/v1\/invoices\/([^/]+)\/finalize$/);
    return match === null ? undefined : json(invoiceObject({ id: match[1], total: ITEMS_TOTAL + 1, open: true }));
  };
  await withInvoiceApp({ fixture: { intercept: inflate } }, async ({ base, repos, freelancer, client, calls }) => {
    const draft = draftOf(repos, freelancer.id, client.id);
    const sendUrl = `${base}/invoices/${draft.id}/send`;
    const sends = () => calls.filter((call) => call.path.endsWith('/send')).length;

    const first = await post(sendUrl);
    assert.equal(first.status, 409);
    assert.equal(await first.text(), 'AmountMismatchError: reconcile\n');
    assert.equal(sends(), 0, 'the client is NOT emailed a wrong invoice');
    // Snapshot first, then refuse: Stripe really did finalize it, and a mirror
    // that still said draft would be a lie (plan §3.7).
    const row = repos.invoices.getById(freelancer.id, draft.id);
    assert.equal(row.status, 'open');
    assert.equal(row.amountDueMinor, ITEMS_TOTAL + 1, "the mirror records STRIPE's amount, which is the truth");
    assert.equal(row.totalMinor, ITEMS_TOTAL, 'and it visibly disagrees with our line items');
    assert.equal(row.sentAt, null);

    // THE RETRY. Nothing about the fixture changes; the mirror is now `open`, so
    // this request skips steps 3 and 4 and goes straight at the send.
    // Re-submitting the form is THE user-visible retry (plan §3.5) and AS-46's
    // single "Finalize & send" control posts here — so a 303 in this position is
    // the client being emailed an invoice we have already recorded as wrong.
    const afterFirst = calls.length;
    const second = await post(sendUrl);
    assert.equal(second.status, 409, 'the guard is not a one-shot');
    assert.equal(await second.text(), 'AmountMismatchError: reconcile\n');
    assert.equal(sends(), 0, 'still zero, cumulative across BOTH requests');
    assert.equal(calls.length, afterFirst, 'and the resumed request made no Stripe call at all');
    assert.equal(repos.invoices.getById(freelancer.id, draft.id).sentAt, null);

    // The finalize route is guarded on the same path, for the same reason:
    // neither route answers 303 once the totals disagree.
    const refinalize = await post(`${base}/invoices/${draft.id}/finalize`);
    assert.equal(refinalize.status, 409, 'finalize is re-checked too, not only send');
    assert.equal(await refinalize.text(), 'AmountMismatchError: reconcile\n');
    assert.equal(calls.length, afterFirst);
    assert.equal(repos.invoices.getById(freelancer.id, draft.id).sentAt, null);
  });
});

test('R13: a Stripe 4xx at the finalize step is 502 naming finalize; the mirror keeps the in_ and stays draft', async () => {
  const intercept = (record) =>
    record.path.endsWith('/finalize')
      ? json({ error: { type: 'invalid_request_error', message: 'synthetic refusal' } }, 400)
      : undefined;
  await withInvoiceApp({ fixture: { intercept } }, async ({ base, repos, freelancer, client, calls }) => {
    const draft = draftOf(repos, freelancer.id, client.id);
    const res = await post(`${base}/invoices/${draft.id}/send`);
    assert.equal(res.status, 502);
    assert.equal(await res.text(), 'StripeApiError: finalize\n');
    assert.equal(calls.filter((call) => call.path.endsWith('/send')).length, 0);
    const row = repos.invoices.getById(freelancer.id, draft.id);
    assert.notEqual(row.stripeInvoiceId, null);
    assert.equal(row.status, 'draft');
    assert.equal(row.sentAt, null);
  });
});

test('R14: send from an ALREADY-OPEN invoice is exactly one call, and sentAt comes from OUR clock', async () => {
  await withInvoiceApp({ customerId: 'cus_alreadythere', fixture: { unknownTotal: ITEMS_TOTAL } }, async ({ base, repos, freelancer, client, calls }) => {
    const draft = draftOf(repos, freelancer.id, client.id);
    repos.invoices.attachStripeInvoice(freelancer.id, draft.id, 'in_alreadyopen');
    repos.invoices.applyStripeSnapshot('in_alreadyopen', invoiceSnapshotFromStripe(invoiceObject({ id: 'in_alreadyopen', total: ITEMS_TOTAL, open: true })));

    const before = new Date().toISOString();
    const res = await post(`${base}/invoices/${draft.id}/send`);
    const after = new Date().toISOString();
    assert.equal(res.status, 303);
    assert.deepEqual(pathsOf(calls), ['/v1/invoices/in_alreadyopen/send'], 'steps 1-4 all skipped');
    assert.equal(calls[0].body, '', 'an empty form body, with the content type set');
    assert.equal(calls[0].headers['content-type'], 'application/x-www-form-urlencoded');
    assert.equal(calls[0].headers['idempotency-key'], `inv-send-${draft.id}`);

    const row = repos.invoices.getById(freelancer.id, draft.id);
    assert.equal(row.status, 'open', 'send changes no status');
    assert.notEqual(row.sentAt, null);
    // OUR clock: between the two readings above, and nowhere near any epoch the
    // fixture invoice carries (due_date, finalized_at).
    assert.ok(row.sentAt >= before && row.sentAt <= after, `sentAt ${row.sentAt} is not from our clock`);
    assert.notEqual(row.sentAt, row.finalizedAt);
    assert.notEqual(row.sentAt, row.dueAt);
  });
});

test('R15: send from a DRAFT runs all five steps in one request — 1+1+N+1+1, mirror open with sentAt', async () => {
  await withInvoiceApp({}, async ({ base, repos, freelancer, client, calls }) => {
    const draft = draftOf(repos, freelancer.id, client.id);
    const before = new Date().toISOString();
    const res = await post(`${base}/invoices/${draft.id}/send`);
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), `/invoices/${draft.id}`);
    const row = repos.invoices.getById(freelancer.id, draft.id);
    assert.equal(calls.length, 1 + 1 + ITEMS.length + 1 + 1, `got ${pathsOf(calls).join(' ')}`);
    assert.deepEqual(pathsOf(calls), [
      '/v1/customers',
      '/v1/invoices',
      '/v1/invoiceitems',
      '/v1/invoiceitems',
      `/v1/invoices/${row.stripeInvoiceId}/finalize`,
      `/v1/invoices/${row.stripeInvoiceId}/send`,
    ]);
    assert.equal(row.status, 'open');
    assert.equal(row.amountDueMinor, ITEMS_TOTAL);
    assert.ok(row.sentAt >= before, 'sentAt is ours, written at the moment /send returned');
    assert.equal(row.paidAt, null, 'this task never writes paid, void or uncollectible');
    assert.equal(row.voidedAt, null);
    assert.equal(row.markedUncollectibleAt, null);
    assert.equal(row.lastPaymentFailedAt, null);
  });
});

test('R16: send when sentAt is already set makes zero transport calls and still 303s', async () => {
  await withInvoiceApp({ customerId: 'cus_alreadythere', fixture: { unknownTotal: ITEMS_TOTAL } }, async ({ base, repos, freelancer, client, calls }) => {
    const draft = draftOf(repos, freelancer.id, client.id);
    repos.invoices.attachStripeInvoice(freelancer.id, draft.id, 'in_alreadysent');
    repos.invoices.applyStripeSnapshot('in_alreadysent', {
      ...invoiceSnapshotFromStripe(invoiceObject({ id: 'in_alreadysent', total: ITEMS_TOTAL, open: true })),
      sentAt: TS,
    });
    const res = await post(`${base}/invoices/${draft.id}/send`);
    assert.equal(res.status, 303);
    assert.equal(calls.length, 0, 'retry-safety must not quietly become a manual re-send feature');
    assert.equal(repos.invoices.getById(freelancer.id, draft.id).sentAt, TS, 'and the recorded moment is untouched');
  });
});

test('R17: editing a draft after it is attached is 409 with zero transport calls — AS-39\'s freeze, surfaced', async () => {
  await withInvoiceApp({}, async ({ base, repos, freelancer, client, calls }) => {
    const draft = draftOf(repos, freelancer.id, client.id);
    repos.invoices.attachStripeInvoice(freelancer.id, draft.id, 'in_frozen');
    const res = await postForm(`${base}/invoices/${draft.id}`, { daysUntilDue: '7' });
    assert.equal(res.status, 409);
    assert.equal(await res.text(), 'InvalidStateError: update-draft\n');
    assert.equal(calls.length, 0);
    assert.equal(repos.invoices.getById(freelancer.id, draft.id).daysUntilDue, 30, 'unchanged');
  });
});

test('R18: no key configured is 503 with zero transport calls — requireKey fires after the guard, before the transport', async () => {
  await withInvoiceApp({ apiKey: null }, async ({ base, repos, freelancer, client, calls }) => {
    const draft = draftOf(repos, freelancer.id, client.id);
    const res = await post(`${base}/invoices/${draft.id}/finalize`);
    assert.equal(res.status, 503);
    assert.match(await res.text(), /ConfigError/);
    assert.equal(calls.length, 0);
    assert.equal(repos.invoices.getById(freelancer.id, draft.id).stripeInvoiceId, null);
  });
});

test('R19: a Stripe 4xx at the customer step is 502 naming create-customer, and leaves stripeCustomerId null', async () => {
  const intercept = (record) =>
    record.path === '/v1/customers'
      ? json({ error: { type: 'invalid_request_error', message: 'synthetic refusal' } }, 400)
      : undefined;
  await withInvoiceApp({ fixture: { intercept } }, async ({ base, repos, freelancer, client, calls }) => {
    const draft = draftOf(repos, freelancer.id, client.id);
    const res = await post(`${base}/invoices/${draft.id}/finalize`);
    assert.equal(res.status, 502);
    assert.equal(await res.text(), 'StripeApiError: create-customer\n');
    assert.equal(calls.length, 1, 'the create was attempted and nothing after it');
    assert.equal(repos.clients.getById(freelancer.id, client.id).stripeCustomerId, null, 'Stripe first, row after');
    assert.equal(repos.invoices.getById(freelancer.id, draft.id).stripeInvoiceId, null);
  });
});

// --- R20–R23: identity, ownership, custody, and the sentAt interaction ----------

test('R20: all four routes redirect to sign-in without a session, with zero transport calls', async () => {
  // WAS the missing-freelancer-parameter case. AS-40 deleted that parameter and
  // the branch behind it: identity is the session's, so "no identity" is now
  // "no session". These are POSTs, so the redirect carries no ?next= — a body
  // cannot be replayed after one.
  await withInvoiceApp({}, async ({ base, repos, freelancer, client, calls }) => {
    const draft = draftOf(repos, freelancer.id, client.id);
    const routes = ['/invoices', `/invoices/${draft.id}`, `/invoices/${draft.id}/finalize`, `/invoices/${draft.id}/send`];
    for (const path of routes) {
      // With an Origin, as a signed-out browser on our own page would send:
      // requireSameOrigin is above the boundary and fails closed, so an
      // origin-less POST is a 403 before the guard sees it (auth.test.js G12).
      const res = await fetch(`${base}${path}`, { method: 'POST', redirect: 'manual', headers: { origin: base } });
      assert.equal(res.status, 303, path);
      assert.equal(res.headers.get('location'), '/signin', path);
    }
    assert.equal(calls.length, 0);
  });
});

test('R21: another freelancer\'s invoice (or client) is 404 on all four routes, with zero transport calls', async () => {
  await withInvoiceApp({}, async ({ base, repos, freelancer, calls }) => {
    // A second freelancer, fully set up, whose records must be invisible here.
    const other = repos.freelancers.create({ email: 'other@example.test', displayName: 'Otto Ther' });
    const otherClient = repos.clients.create(other.id, { name: 'Their Co', email: 'their@example.test' });
    const otherDraft = draftOf(repos, other.id, otherClient.id);

    const notOurs = [
      ['/invoices', { clientId: otherClient.id, daysUntilDue: '30', ...itemFields(ITEMS) }],
      [`/invoices/${otherDraft.id}`, { daysUntilDue: '7' }],
      [`/invoices/${otherDraft.id}/finalize`, {}],
      [`/invoices/${otherDraft.id}/send`, {}],
    ];
    for (const [path, fields] of notOurs) {
      const res = await postForm(`${base}${path}`, fields);
      assert.equal(res.status, 404, path);
      assert.match(await res.text(), /NotFoundError/, path);
    }
    assert.equal(calls.length, 0, 'ownership is checked before Stripe is touched');
    assert.equal(repos.invoices.getById(other.id, otherDraft.id).status, 'draft', "and the other freelancer's draft is untouched");
  });
});

test('R22: the custody property at the wire — every request carries stripe-account, none carries a fee or routing parameter', async () => {
  // Two independent witnesses for one claim: the custody guard enforces this
  // upstream of the key and the transport, and this reads the recorded bytes.
  const FORBIDDEN = [
    'application_fee_amount',
    'application_fee',
    'transfer_data',
    'on_behalf_of',
    'issuer',
    'destination',
    'transfer_group',
  ];
  await withInvoiceApp({}, async ({ base, repos, freelancer, client, calls }) => {
    const draft = draftOf(repos, freelancer.id, client.id);
    assert.equal((await post(`${base}/invoices/${draft.id}/send`)).status, 303);
    assert.equal(calls.length, 6, `a complete run is six calls, got ${pathsOf(calls).join(' ')}`);
    for (const call of calls) {
      assert.equal(call.headers['stripe-account'], ACCT, `${call.path} executes as the freelancer, never as us`);
      const material = `${call.body ?? ''}&${call.query ?? ''}`.toLowerCase();
      for (const name of FORBIDDEN) {
        assert.ok(!material.includes(name), `${call.path} carries ${name}`);
      }
    }
  });
});

test('R23: sentAt SURVIVES a later snapshot — the AS-44 interaction the mapper exclusion exists for', () => {
  const { db } = prepareDatabase({ dbPath: freshDbPath() });
  try {
    const repos = createRepositories(db);
    const f = repos.freelancers.create({ email: 'r23@example.test', displayName: 'R23' });
    const c = repos.clients.create(f.id, { name: 'C', email: 'c@example.test' });
    const draft = draftOf(repos, f.id, c.id);
    repos.invoices.attachStripeInvoice(f.id, draft.id, 'in_r23');
    repos.invoices.applyStripeSnapshot('in_r23', {
      ...invoiceSnapshotFromStripe(invoiceObject({ id: 'in_r23', total: ITEMS_TOTAL, open: true })),
      sentAt: TS,
    });
    assert.equal(repos.invoices.getById(f.id, draft.id).sentAt, TS);

    // Now AS-44's invoice.paid arrives and is mapped by the SAME function.
    const paid = invoiceObject({ id: 'in_r23', total: ITEMS_TOTAL, paid: ITEMS_TOTAL, open: true });
    paid.status = 'paid';
    paid.status_transitions.paid_at = 1788336100;
    const outcome = repos.invoices.applyStripeSnapshot('in_r23', invoiceSnapshotFromStripe(paid));
    assert.equal(outcome.outcome, 'applied');
    const row = repos.invoices.getById(f.id, draft.id);
    assert.equal(row.status, 'paid');
    assert.equal(row.paidAt, '2026-09-02T08:01:40.000Z');
    // A mapper that emitted `sentAt: null` would have erased this, because
    // applyStripeSnapshot writes EVERY key present.
    assert.equal(row.sentAt, TS, 'the recorded send survives every later snapshot');
  } finally {
    db.close();
  }
});

// --- R24–R26: the two taxonomy rows nothing drove through a route, and the
// invariant the dropped currency comparison rests on (added review cycle 1) ----

test('R24: a custody refusal is 500 at the route — loud, and carrying no request material', async () => {
  // Driven through a client stub, because the REAL pipeline cannot produce this
  // here: every call this task makes is on the allowlist as connected-scope and
  // declares an acct_, so the guard has nothing to refuse. That is the property
  // R6/R22 assert; this case asserts what happens if it is ever untrue —
  // unreachable in normal operation, and therefore exactly the failure that must
  // not be quietly mapped to a 502 and read as "Stripe's fault".
  const stripe = Object.freeze({
    request: async () => {
      throw new StripeCustodyError('missing_account', { method: 'POST', path: '/v1/customers', key: 'account' });
    },
  });
  await withInvoiceApp({ stripe }, async ({ base, repos, freelancer, client }) => {
    const draft = draftOf(repos, freelancer.id, client.id);
    for (const route of ['finalize', 'send']) {
      const res = await post(`${base}/invoices/${draft.id}/${route}`);
      assert.equal(res.status, 500, `${route}: a custody refusal is ours, not Stripe's`);
      // The whole body, byte for byte: the class and the step, and nothing of
      // what we sent — no path, no parameter name, no key.
      assert.equal(await res.text(), 'StripeCustodyError: create-customer\n');
    }
    assert.equal(repos.invoices.getById(freelancer.id, draft.id).stripeInvoiceId, null, 'nothing was attached');
  });
});

test('R25: an invoice shape the mapper does not understand is 502 at the route, not 500', async () => {
  const malformed = (record) => {
    const match = record.path.match(/^\/v1\/invoices\/([^/]+)\/finalize$/);
    if (match === null) return undefined;
    const invoice = invoiceObject({ id: match[1], total: ITEMS_TOTAL, open: true });
    invoice.status = 42; // R1 proves the mapper throws on this; nothing drove one through a route
    return json(invoice);
  };
  await withInvoiceApp({ fixture: { intercept: malformed } }, async ({ base, repos, freelancer, client, calls }) => {
    const draft = draftOf(repos, freelancer.id, client.id);
    const res = await post(`${base}/invoices/${draft.id}/finalize`);
    assert.equal(res.status, 502, 'a shape this app does not understand came from Stripe, so it is a 502');
    assert.equal(await res.text(), 'TypeError: finalize\n', 'and the body names WHICH interaction produced it');
    assert.equal(calls.filter((call) => call.path.endsWith('/send')).length, 0);
    const row = repos.invoices.getById(freelancer.id, draft.id);
    assert.notEqual(row.stripeInvoiceId, null, 'the invoice was attached before the finalize was attempted');
    assert.equal(row.status, 'draft', 'and nothing was written from a shape we could not read');
  });
});

test('R26: SUPPORTED_CURRENCIES has exactly one member — the invariant the dropped currency comparison rests on', () => {
  assert.equal(
    SUPPORTED_CURRENCIES.length,
    1,
    'AS-43 plan §3.7, ruling by agent:cto-owen 2026-09-02: the reconciliation guard compares amounts only. '
      + 'That is safe because "ours" and "theirs" are the same constant — one supported currency, sent '
      + 'EXPLICITLY on POST /v1/invoices and on every POST /v1/invoiceitems, and Stripe rejects an item whose '
      + 'currency differs from its invoice\'s. THIS TEST IS THE TRIGGER, and it is deliberately the only one: '
      + 'the moment a second currency is supported that reasoning is false and the currency half of the guard '
      + 'must come back — which needs a stripe_currency column on the invoice mirror (a new migration, '
      + 'SCHEMA_VERSION 1->2, and an eleventh key in the mapper AS-44 inherits). Do not just raise this number.',
  );
});

// --- M1–M3: the same routes against stripe-mock ---------------------------------
//
// What genuinely cannot be tested here, named (plan §5.3): stripe-mock is
// stateless, so draft → open → paid, the client-facing email, Stripe's actual
// deduplication of our five idempotency keys, and whether a real Stripe
// amount_due equals our computed total on a live account are all unobservable.
// They belong to AS-50's recorded acceptance run, gated on the board's account
// (AS-51). This task opens no account and files no ask.

const RAW_URL = process.env.ASC_STRIPE_MOCK_URL;
const MOCK_URL = typeof RAW_URL === 'string' && RAW_URL.trim() !== '' ? RAW_URL.trim() : undefined;
const SKIP = MOCK_URL === undefined ? 'ASC_STRIPE_MOCK_URL not set — run the contract service' : false;

// Refuse, at load time, to run against anything that could be Stripe — the same
// construction-level refusal as stripe-mock.test.js and connect.test.js.
if (MOCK_URL !== undefined) {
  const { hostname } = new URL(MOCK_URL);
  if (hostname.endsWith('stripe.com')) {
    throw new Error(`ASC_STRIPE_MOCK_URL points at ${hostname}: this suite only ever talks to stripe-mock`);
  }
}

// The same mock-only placeholder stripe-mock.test.js and connect.test.js use
// (the mock requires a test-mode prefix and validates nothing else about it).
// Deliberately the identical literal — one grep finds all three — and it never
// leaves the internal compose network. Third occurrence of the ONE key-shaped
// placeholder value in the repository.
const MOCK_KEY = 'sk_test_stripemock';

/** MEASURED, not assumed: stripe-mock's invoice fixture is a CONSTANT —
 *  status "draft", amount_due 1000, amount_paid 0, both URLs null, due_date
 *  1234567890, every status_transition null — and it is identical from create,
 *  finalize and send. The mock never advances state. These cases are designed
 *  around that constant instead of tripping over it. Re-measured against
 *  stripe/stripe-mock:v0.203.0 at 2026-08-26.dahlia before implementation. */
const MOCK_FIXTURE_AMOUNT_DUE = 1000;

let readiness;
function mockReady() {
  readiness ??= (async () => {
    const started = Date.now();
    let lastError;
    while (Date.now() - started < 10_000) {
      try {
        const response = await fetch(`${MOCK_URL}/v1/customers`, { signal: AbortSignal.timeout(1000) });
        return response.status;
      } catch (err) {
        lastError = err;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    throw new Error(`stripe-mock at ${MOCK_URL} did not answer within 10 s`, { cause: lastError });
  })();
  return readiness;
}

/** The real app, its client pointed at the mock through the real transport.
 *
 *  `paths` records what the SERVICE asked the client for, through a decorator
 *  around the real client — the real pipeline, the real transport and the real
 *  mock all still run. That granularity is the right one for the claim M3
 *  makes ("we never even asked Stripe to send this"), and it is the only one
 *  available here: unlike the offline cases there is no fixture transport to
 *  record wire bytes. */
async function withMockApp(totalMinor, fn) {
  const real = createStripeClient({ apiKey: MOCK_KEY, baseUrl: MOCK_URL });
  const paths = [];
  const stripe = Object.freeze({
    request: (call) => {
      paths.push(call.path);
      return real.request(call);
    },
  });
  await withServer(configFor(), async (base, app, deps) => {
    const repos = deps.repos;
    const freelancer = repos.freelancers.create({ email: 'mock@example.test', displayName: 'Mock Freelancer' });
    repos.connectedAccounts.create({ freelancerId: freelancer.id, stripeAccountId: ACCT });
    repos.connectedAccounts.updateReadiness(ACCT, readinessFromAccount(stripeAccount(), TS));
    const client = repos.clients.create(freelancer.id, { name: 'Client Co', email: 'client@example.test' });
    const draft = draftOf(repos, freelancer.id, client.id, [{ description: 'Contract work', quantity: 1, unitAmountMinor: totalMinor }]);
    auth.headers = signedInHeaders(base, seedSession(repos, freelancer.id).cookie);
    await fn({ base, repos, freelancer, client, draft, paths });
  }, { stripe });
}

test('M1: finalize over HTTP against stripe-mock — the mock validates all four request shapes', { skip: SKIP }, async () => {
  await mockReady();
  await withMockApp(MOCK_FIXTURE_AMOUNT_DUE, async ({ base, repos, freelancer, client, draft }) => {
    const res = await post(`${base}/invoices/${draft.id}/finalize`);
    assert.equal(res.status, 303, 'the mock accepted every wire shape — a parameter the spec does not know would be a 502 here');
    assert.equal(res.headers.get('location'), `/invoices/${draft.id}`);
    const row = repos.invoices.getById(freelancer.id, draft.id);
    assert.ok(row.stripeInvoiceId.startsWith('in_'), 'attached from the mock invoice fixture');
    assert.ok(repos.clients.getById(freelancer.id, client.id).stripeCustomerId.startsWith('cus_'));
    assert.equal(row.amountDueMinor, MOCK_FIXTURE_AMOUNT_DUE, 'the mapper consumed a real spec-shaped invoice response');
    assert.equal(row.dueAt, '2009-02-13T23:31:30.000Z');
    // THE RESIDUAL, ASSERTED RATHER THAN GLOSSED: the mock is stateless, so its
    // finalize response still says "draft" and the mirror faithfully records
    // that. Real state transitions belong to AS-50's acceptance run.
    assert.equal(row.status, 'draft', 'stripe-mock never advances state — this is a mock artifact, not a bug');
    assert.equal(row.finalizedAt, null);
    assert.equal(row.sentAt, null);
  });
});

test('M2: send against stripe-mock — 303, and sentAt written from our clock', { skip: SKIP }, async () => {
  await mockReady();
  await withMockApp(MOCK_FIXTURE_AMOUNT_DUE, async ({ base, repos, freelancer, draft }) => {
    const before = new Date().toISOString();
    const res = await post(`${base}/invoices/${draft.id}/send`);
    assert.equal(res.status, 303);
    const row = repos.invoices.getById(freelancer.id, draft.id);
    assert.notEqual(row.sentAt, null);
    assert.ok(row.sentAt >= before, 'ours, not the mock\'s');
    assert.equal(row.status, 'draft', 'the stateless-mock residual again');
  });
});

// THE WEAKER WITNESS, and labelled as one. It proves the refusal is stable
// across requests against a REAL spec-shaped response — which R12's fixture
// cannot claim — but it does NOT cover the defect review cycle 1 found. See the
// comment at the second request for why, and R12 for the case that does.
test('M3: the reconciliation guard against stripe-mock — a real spec-shaped response, refused, and refused again', { skip: SKIP }, async () => {
  await mockReady();
  await withMockApp(MOCK_FIXTURE_AMOUNT_DUE + 1, async ({ base, repos, freelancer, draft, paths }) => {
    const url = `${base}/invoices/${draft.id}/send`;
    const sends = () => paths.filter((path) => path.endsWith('/send')).length;

    const res = await post(url);
    assert.equal(res.status, 409);
    assert.equal(await res.text(), 'AmountMismatchError: reconcile\n');
    const row = repos.invoices.getById(freelancer.id, draft.id);
    assert.equal(row.sentAt, null, 'the send did not happen');
    assert.equal(row.amountDueMinor, MOCK_FIXTURE_AMOUNT_DUE, "the snapshot WAS written first, with Stripe's amount");
    assert.equal(row.totalMinor, MOCK_FIXTURE_AMOUNT_DUE + 1, 'and it disagrees with our line items, visibly');
    assert.equal(sends(), 0);

    // WHY THIS SECOND REQUEST IS THE WEAKER WITNESS, asserted rather than
    // assumed. stripe-mock is stateless: its finalize response still says
    // "draft" (M1 pins that), so the mirror below is STILL `draft` and this
    // request RE-RUNS steps 3 and 4 and is refused by the FINALIZING path — not
    // by the resumed-skip path the review-cycle-1 defect lived on. Only R12
    // reaches that path, because only the computing fixture advances the mirror
    // to `open`. This case would stay green with the defect restored (plan §7
    // F8), which is precisely why it cannot stand in for R12.
    assert.equal(row.status, 'draft', 'the stateless-mock residual — and the reason this witness is the weaker one');
    const second = await post(url);
    assert.equal(second.status, 409);
    assert.equal(await second.text(), 'AmountMismatchError: reconcile\n');
    assert.equal(sends(), 0, 'cumulative across both requests: Stripe was never asked to send this');
    assert.equal(repos.invoices.getById(freelancer.id, draft.id).sentAt, null);
  });
});
