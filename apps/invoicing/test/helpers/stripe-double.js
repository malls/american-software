// test/helpers/stripe-double.js — a STATEFUL double of Stripe, as a transport
// (AS-49, plan §3, §5).
//
// It sits at the seam AS-38 built for exactly this — `createStripeClient({
// transport })` — so the real client pipeline (validate → build → guard →
// requireKey → sign → transport → interpret) runs on every call and the custody
// guard sees every wire request. Behind that seam it holds account, customer,
// invoice-item and invoice state, transitions invoices on finalize and pay,
// models Stripe's idempotency window, and SIGNS webhook events with the
// documented HMAC scheme so the app's real receiver verifies them.
//
// Descended from the computing fixture in test/invoices.test.js (plan §3.9):
// that fixture accumulates amount_due and caches replays; this one also holds
// the objects, refuses what Stripe would refuse (a second finalize, an item on
// an open invoice, a connected call naming an account it never created), and
// keeps SNAPSHOTS at each transition so an event carries the object as it was
// when the event was created — never the current state.
//
// WHAT IT DOES NOT DO, on purpose: validate parameter shapes against the spec
// (stripe-mock's job — see STRIPE_DOUBLE_CLAIM); retry; follow redirects; read
// any env var; open any socket; import anything from lib/ except the custody
// allowlist, which E0 reads as data to prove the two tables are one set.
//
// TWO CLOCKS, stated (plan §3.3): the signature `t` is real Date.now(), because
// it must sit inside the verifier's five-minute tolerance against the app's
// real clock. Event-data timestamps (`created`, status_transitions.*, due_date)
// come from the injectable MODEL clock, which starts at a fixed epoch and
// advances 60 s per state transition, so the tests assert against committed
// ISO literals.
import { createHmac } from 'node:crypto';
import { ALLOWED_ENDPOINTS } from '../../lib/stripe/custody.js';

/** The honest claim. Quoted verbatim in test/e2e-loop.test.js and in
 *  apps/invoicing/README.md § "The loop half" (plan §2, AC-19). */
export const STRIPE_DOUBLE_CLAIM =
  'This suite proves that OUR half of the loop is correct against OUR MODEL of Stripe. The ' +
  'model — test/helpers/stripe-double.js — was written by us from Stripe\'s documentation and ' +
  'from the stripe-mock fixtures; it holds state the way we believe Stripe does and signs events ' +
  'the way Stripe documents. A green run means: every step of the chain, driven over the app\'s ' +
  'real HTTP API, behaves as designed when Stripe behaves as we assume. It does not mean ' +
  'Stripe behaves that way. Two instruments, two claims, neither of them Stripe: stripe-mock ' +
  '(the contract service) validates the SHAPE of every request we send against Stripe\'s ' +
  'OpenAPI spec and answers with stateless fixtures; the double holds STATE and emits events, and ' +
  'validates nothing. The fidelity of the model is exactly what the recorded test-mode ' +
  'acceptance run (AS-50) exists to check, and nothing in this suite substitutes for it.';

/** The API version every allowlisted shape was validated against (AS-38). */
export const API_VERSION = '2026-08-26.dahlia';
/** The model clock's origin, and the step it takes per transition. */
export const MODEL_EPOCH = 1_789_000_000;
export const MODEL_TICK_SECONDS = 60;

const clone = (value) => JSON.parse(JSON.stringify(value));

/** Compile an allowlist path the way custody.js does: `{id}` is one segment. */
function compilePath(path) {
  const source = path
    .split('/')
    .map((segment) => (segment === '{id}' ? '([A-Za-z0-9_]+)' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return new RegExp(`^${source}$`);
}

/** A Stripe-shaped error reply. Only the fields the client's interpret() reads. */
function errorReply(status, code, message, param = null) {
  return {
    status,
    headers: { 'request-id': 'req_double' },
    body: JSON.stringify({ error: { type: status >= 500 ? 'api_error' : 'invalid_request_error', code, message, param } }),
  };
}

const jsonReply = (data) => ({ status: 200, headers: { 'request-id': 'req_double' }, body: JSON.stringify(data) });

/**
 * @param {{ webhookSecret?: string, now?: number }} options `now` is the model
 *   clock's starting epoch (seconds); `webhookSecret` signs every event.
 */
export function createStripeDouble({ webhookSecret = 'whsec_stripe_double', now = MODEL_EPOCH } = {}) {
  if (typeof webhookSecret !== 'string' || webhookSecret === '') throw new TypeError('stripe double: webhookSecret must be a non-empty string');
  if (!Number.isSafeInteger(now)) throw new TypeError('stripe double: now must be an epoch-seconds integer');

  const state = {
    accounts: new Map(),
    customers: new Map(),
    items: new Map(),
    invoices: new Map(),
    replays: new Map(),
  };
  /** Every wire request the transport saw, in order. */
  const calls = [];
  const stats = { replayHits: 0 };
  /** Snapshots taken at each transition, keyed `${event type}:${object id}`. */
  const snapshots = new Map();
  /** Invoices `send` has been called on — internal, never on the object. */
  const sent = new Set();
  /** Injected failures: { method, pattern, remaining, reply }. */
  const failures = [];
  let clock = now;
  let seq = 0;
  let eventSeq = 0;

  const nextId = (prefix) => `${prefix}_dbl${(seq += 1)}`;
  /** Advance the model clock by one tick and return the new reading. */
  const transition = () => (clock += MODEL_TICK_SECONDS);
  const snapshot = (type, object) => snapshots.set(`${type}:${object.id}`, { object: clone(object), created: clock });

  // --- objects ---------------------------------------------------------------

  function newAccount() {
    const account = {
      id: nextId('acct'),
      object: 'account',
      charges_enabled: false,
      details_submitted: false,
      payouts_enabled: false,
      requirements: { currently_due: ['external_account', 'tos_acceptance.date'], disabled_reason: 'requirements.past_due' },
    };
    transition();
    state.accounts.set(account.id, { account });
    return account;
  }

  function newInvoice(acct, params) {
    const days = Number(params.get('days_until_due'));
    const invoice = {
      id: nextId('in'),
      object: 'invoice',
      status: 'draft',
      customer: params.get('customer'),
      currency: params.get('currency'),
      collection_method: params.get('collection_method'),
      amount_due: 0,
      amount_paid: 0,
      hosted_invoice_url: null,
      invoice_pdf: null,
      due_date: transition() + (Number.isFinite(days) ? days : 0) * 86_400,
      metadata: metadataOf(params),
      status_transitions: { finalized_at: null, marked_uncollectible_at: null, paid_at: null, voided_at: null },
    };
    state.invoices.set(invoice.id, { acct, invoice });
    return invoice;
  }

  function metadataOf(params) {
    const out = {};
    for (const [key, value] of params) {
      const m = /^metadata\[([^\]]+)\]$/.exec(key);
      if (m !== null) out[m[1]] = value;
    }
    return out;
  }

  // --- the endpoint table: exactly the custody allowlist's nine rows ---------

  const connected = (record) => {
    const acct = record.headers['stripe-account'];
    if (!state.accounts.has(acct)) return errorReply(400, 'resource_missing', `No such account: '${acct}'`, 'stripe-account');
    return null;
  };

  const ENDPOINTS = [
    {
      method: 'POST', path: '/v1/accounts',
      handle: (record) => {
        if (record.body !== '') return errorReply(400, 'parameter_unknown', 'the double only models a bare account creation');
        return jsonReply(newAccount());
      },
    },
    {
      method: 'POST', path: '/v1/account_links',
      handle: (record, params) => {
        const acct = params.get('account');
        if (!state.accounts.has(acct)) return errorReply(400, 'resource_missing', `No such account: '${acct}'`, 'account');
        const created = clock;
        return jsonReply({ object: 'account_link', url: `https://onboarding.stripe-double.test/${acct}`, created, expires_at: created + 300 });
      },
    },
    {
      method: 'GET', path: '/v1/accounts/{id}',
      handle: (record, params, id) => {
        const held = state.accounts.get(id);
        if (held === undefined) return errorReply(400, 'resource_missing', `No such account: '${id}'`);
        return jsonReply(held.account);
      },
    },
    {
      method: 'POST', path: '/v1/customers',
      handle: (record, params) => {
        const refused = connected(record);
        if (refused !== null) return refused;
        const customer = { id: nextId('cus'), object: 'customer', email: params.get('email'), name: params.get('name'), metadata: metadataOf(params) };
        transition();
        state.customers.set(customer.id, { acct: record.headers['stripe-account'], customer });
        return jsonReply(customer);
      },
    },
    {
      method: 'POST', path: '/v1/invoiceitems',
      handle: (record, params) => {
        const refused = connected(record);
        if (refused !== null) return refused;
        const held = state.invoices.get(params.get('invoice'));
        if (held === undefined) return errorReply(400, 'resource_missing', `No such invoice: '${params.get('invoice')}'`, 'invoice');
        if (held.invoice.status !== 'draft') return errorReply(400, 'invoice_not_editable', `Invoice ${held.invoice.id} is ${held.invoice.status}; items can only be added to a draft`);
        const item = {
          id: nextId('ii'),
          object: 'invoiceitem',
          customer: params.get('customer'),
          invoice: held.invoice.id,
          currency: params.get('currency'),
          amount: Number(params.get('amount')),
          description: params.get('description'),
          metadata: metadataOf(params),
        };
        transition();
        // THE COMPUTING HALF: what we push is what comes back as amount_due.
        held.invoice.amount_due += item.amount;
        state.items.set(item.id, { acct: record.headers['stripe-account'], item });
        return jsonReply(item);
      },
    },
    {
      method: 'POST', path: '/v1/invoices',
      handle: (record, params) => {
        const refused = connected(record);
        if (refused !== null) return refused;
        const customer = params.get('customer');
        if (!state.customers.has(customer)) return errorReply(400, 'resource_missing', `No such customer: '${customer}'`, 'customer');
        return jsonReply(newInvoice(record.headers['stripe-account'], params));
      },
    },
    {
      method: 'POST', path: '/v1/invoices/{id}/finalize',
      handle: (record, params, id) => {
        const refused = connected(record);
        if (refused !== null) return refused;
        const held = state.invoices.get(id);
        if (held === undefined) return errorReply(400, 'resource_missing', `No such invoice: '${id}'`);
        if (held.invoice.status !== 'draft') return errorReply(400, 'invoice_not_finalizable', `Invoice ${id} is ${held.invoice.status}; only a draft can be finalized`);
        const at = transition();
        held.invoice.status = 'open';
        held.invoice.hosted_invoice_url = `https://pay.stripe-double.test/${id}`;
        held.invoice.invoice_pdf = `https://pay.stripe-double.test/${id}.pdf`;
        held.invoice.status_transitions.finalized_at = at;
        snapshot('invoice.finalized', held.invoice);
        return jsonReply(held.invoice);
      },
    },
    {
      method: 'POST', path: '/v1/invoices/{id}/send',
      handle: (record, params, id) => {
        const refused = connected(record);
        if (refused !== null) return refused;
        const held = state.invoices.get(id);
        if (held === undefined) return errorReply(400, 'resource_missing', `No such invoice: '${id}'`);
        if (held.invoice.status !== 'open') return errorReply(400, 'invoice_not_sendable', `Invoice ${id} is ${held.invoice.status}; only an open invoice can be sent`);
        transition();
        sent.add(id); // Stripe does not change status on send
        snapshot('invoice.sent', held.invoice);
        return jsonReply(held.invoice);
      },
    },
    {
      method: 'GET', path: '/v1/invoices/{id}',
      handle: (record, params, id) => {
        const refused = connected(record);
        if (refused !== null) return refused;
        const held = state.invoices.get(id);
        if (held === undefined) return errorReply(400, 'resource_missing', `No such invoice: '${id}'`);
        return jsonReply(held.invoice);
      },
    },
  ].map((row) => ({ ...row, pattern: compilePath(row.path) }));

  /** `METHOD path` for every row — E0 compares this to ALLOWED_ENDPOINTS. */
  const handled = Object.freeze(ENDPOINTS.map((row) => `${row.method} ${row.path}`));

  // --- the transport -----------------------------------------------------------

  const answer = (record) => {
    const row = ENDPOINTS.find((r) => r.method === record.method && r.pattern.test(record.path));
    if (row === undefined) return errorReply(404, 'unknown_endpoint', `the double does not model ${record.method} ${record.path}`);
    const id = row.pattern.exec(record.path)[1];
    const params = new URLSearchParams(record.method === 'GET' ? record.query : record.body ?? '');
    return row.handle(record, params, id);
  };

  const takeFailure = (record) => {
    const index = failures.findIndex((f) => f.method === record.method && f.pattern.test(record.path));
    if (index === -1) return null;
    const failure = failures[index];
    failure.remaining -= 1;
    if (failure.remaining > 0) return null;
    failures.splice(index, 1);
    return failure.reply;
  };

  /** The transport. Records the wire request, applies an injected failure
   *  (never cached), then the idempotency window, then the model. */
  const transport = async (signed) => {
    const record = {
      method: signed.method,
      path: signed.url.pathname,
      query: signed.url.search,
      body: signed.body,
      headers: signed.headers,
      url: signed.url,
    };
    calls.push(record);
    const injected = takeFailure(record);
    if (injected !== null) return injected;
    const key = record.headers['idempotency-key'];
    if (key !== undefined && state.replays.has(key)) {
      stats.replayHits += 1;
      return state.replays.get(key);
    }
    const reply = answer(record);
    if (key !== undefined) state.replays.set(key, reply);
    return reply;
  };

  // --- model transitions the app cannot cause ("Stripe did something") --------

  /** An account that exists at Stripe without the app having created it —
   *  what E2–E5 seed through, so their red sets stay narrow. Not ready. */
  function createAccount() {
    return clone(newAccount());
  }

  function completeOnboarding(acct) {
    const held = state.accounts.get(acct);
    if (held === undefined) throw new Error(`stripe double: no such account ${acct}`);
    transition();
    held.account.charges_enabled = true;
    held.account.details_submitted = true;
    held.account.payouts_enabled = true;
    held.account.requirements = { currently_due: [], disabled_reason: null };
    snapshot('account.updated', held.account);
    return clone(held.account);
  }

  function pay(id) {
    const held = state.invoices.get(id);
    if (held === undefined) throw new Error(`stripe double: no such invoice ${id}`);
    if (held.invoice.status !== 'open') throw new Error(`stripe double: invoice ${id} is ${held.invoice.status}; only an open invoice can be paid`);
    const at = transition();
    held.invoice.status = 'paid';
    held.invoice.amount_paid = held.invoice.amount_due;
    held.invoice.status_transitions.paid_at = at;
    snapshot('invoice.paid', held.invoice);
    return clone(held.invoice);
  }

  /** The n-th (1-based) matching call from now returns `reply` and is NOT
   *  cached in the idempotency window. Default reply: a 502 api_error. */
  function failNth(method, path, n, reply = errorReply(502, null, 'injected failure')) {
    if (!Number.isInteger(n) || n < 1) throw new TypeError('stripe double: failNth needs n >= 1');
    failures.push({ method, pattern: compilePath(path), remaining: n, reply });
  }
  const failNext = (method, path, reply) => failNth(method, path, 1, reply);

  // --- events: signed from the snapshot at the transition -----------------------

  /** `t=<real now>,v1=<hex HMAC-SHA256(secret, "<t>.<payload>")>` — Stripe's
   *  documented scheme, written from the documentation and NOT from
   *  lib/webhooks/signature.js (plan §3.3): a signer that shared the verifier's
   *  code would agree with it by construction. */
  function sign(payload) {
    const t = Math.floor(Date.now() / 1000);
    const v1 = createHmac('sha256', webhookSecret).update(`${t}.${payload}`, 'utf8').digest('hex');
    return `t=${t},v1=${v1}`;
  }

  function envelope(type, id) {
    const held = snapshots.get(`${type}:${id}`);
    if (held === undefined) throw new Error(`stripe double: no ${type} transition recorded for ${id}`);
    const event = {
      id: `evt_dbl${(eventSeq += 1)}`,
      object: 'event',
      api_version: API_VERSION,
      created: held.created,
      type,
      data: { object: clone(held.object) },
    };
    return signEvent(event);
  }

  function signEvent(event) {
    const payload = JSON.stringify(event);
    return { event, payload, header: sign(payload) };
  }

  const events = Object.freeze({
    accountUpdated: (acct) => envelope('account.updated', acct),
    invoiceFinalized: (id) => envelope('invoice.finalized', id),
    invoiceSent: (id) => envelope('invoice.sent', id),
    invoicePaid: (id) => envelope('invoice.paid', id),
    /** The same envelope, the same bytes, a fresh `t` — a redelivery. */
    resign: (event) => signEvent(event),
  });

  return Object.freeze({
    transport,
    calls,
    state,
    stats,
    handled,
    createAccount,
    completeOnboarding,
    pay,
    failNth,
    failNext,
    events,
    /** The model clock's current reading, for a test that wants to derive rather than commit. */
    now: () => clock,
    STRIPE_DOUBLE_CLAIM,
  });
}

/** The custody allowlist as the same `METHOD path` strings, for E0. */
export const ALLOWLIST_KEYS = Object.freeze(ALLOWED_ENDPOINTS.map((row) => `${row.method} ${row.path}`));
