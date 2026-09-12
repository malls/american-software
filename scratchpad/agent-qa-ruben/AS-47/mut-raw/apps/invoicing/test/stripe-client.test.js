// stripe-client.test.js — the custody guard, the client, and the transport,
// offline (AS-38, plan §2.10). Runs in the `network_mode: none` test service
// with no key and no mock: the guard is exercised directly, the client against a
// recording fake transport, and the real transport against a loopback listener.
//
// Test names are fixed by the plan — §6 predicts, by name, which of these go red
// under each planted mutation. Renaming one silently breaks that contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { inspect } from 'node:util';
import * as clientModule from '../lib/stripe/client.js';
import { createStripeClient, encodeForm, StripeApiError, StripeCustodyError, StripeTransportError } from '../lib/stripe/client.js';
import {
  ACCOUNT_ID, ALLOWED_ENDPOINTS, FORBIDDEN_ENDPOINT_PREFIXES, FORBIDDEN_PARAMS, guardRequest,
} from '../lib/stripe/custody.js';
import { ConfigError } from '../lib/config.js';

// Not key-shaped on purpose (plan §2.8): a placeholder shaped like a real key is
// how a fake key ends up in a real call. It also demonstrates plan §8 Q1 — the
// client does no key-format validation.
const KEY = 'unit-test-placeholder-key';
const VERSION = '2026-08-26.dahlia';
const NAMES = FORBIDDEN_PARAMS.map((row) => row.name);

// --- fixtures -----------------------------------------------------------------

/** A materialised, unsigned wire request, the shape buildUnsigned() produces. */
function wire({ method = 'POST', path, account, platform = false, body = null, query = '' }) {
  const url = new URL(path, 'https://api.stripe.com');
  if (query !== '') url.search = query;
  const headers = { accept: 'application/json', 'stripe-version': VERSION };
  if (method === 'POST') headers['content-type'] = 'application/x-www-form-urlencoded';
  if (account !== undefined) headers['stripe-account'] = account;
  return Object.freeze({
    method, url, headers: Object.freeze(headers), body: method === 'POST' ? body ?? '' : null, meta: Object.freeze({ platform }),
  });
}

/** Assert `fn` throws a StripeCustodyError with `code`; return the error. */
function refused(fn, code) {
  let caught;
  assert.throws(fn, (err) => {
    caught = err;
    assert.ok(err instanceof StripeCustodyError, `expected StripeCustodyError, got ${err?.name}: ${err?.message}`);
    assert.equal(err.code, code);
    assert.match(err.message, /^CUSTODY: /);
    return true;
  });
  return caught;
}

/** A transport that records every call and answers with a canned reply. */
function fakeTransport(reply = { status: 200, headers: { 'request-id': 'req_fake' }, body: '{"object":"invoice","id":"in_fake"}' }) {
  const calls = [];
  const transport = async (signed, options) => {
    calls.push({ signed, options });
    return typeof reply === 'function' ? reply(signed) : reply;
  };
  return { transport, calls };
}

/** A client over a recording fake transport, keyed unless told otherwise. */
function fakeClient(options = {}) {
  const fake = fakeTransport(options.reply);
  const client = createStripeClient({ apiKey: KEY, transport: fake.transport, ...options.client });
  return { client, calls: fake.calls };
}

/** Assert `promise` rejects with an error `instanceof cls` (and `code` if given); return it. */
async function rejectsWith(promise, cls, code) {
  let caught;
  await assert.rejects(promise, (err) => {
    caught = err;
    assert.ok(err instanceof cls, `expected ${cls.name}, got ${err?.name}: ${err?.message}`);
    if (code !== undefined) assert.equal(err.code, code);
    return true;
  });
  return caught;
}

// --- guard level --------------------------------------------------------------

test('custody: policy tables are the committed literals', () => {
  assert.equal(FORBIDDEN_PARAMS.length, 10);
  assert.deepEqual([...NAMES].sort(), [
    'application_fee', 'application_fee_amount', 'application_fee_percent', 'controller', 'destination',
    'issuer', 'on_behalf_of', 'source_transaction', 'transfer_data', 'transfer_group',
  ]);
  assert.equal(ALLOWED_ENDPOINTS.length, 9);
  assert.deepEqual(ALLOWED_ENDPOINTS.map((r) => `${r.method} ${r.path} ${r.scope}`), [
    'POST /v1/accounts platform',
    'POST /v1/account_links platform',
    'GET /v1/accounts/{id} platform',
    'POST /v1/customers connected',
    'POST /v1/invoiceitems connected',
    'POST /v1/invoices connected',
    'POST /v1/invoices/{id}/finalize connected',
    'POST /v1/invoices/{id}/send connected',
    'GET /v1/invoices/{id} connected',
  ]);
  assert.equal(ALLOWED_ENDPOINTS.filter((r) => r.scope === 'platform').length, 3, 'exactly three platform calls exist in v1');
  assert.deepEqual([...FORBIDDEN_ENDPOINT_PREFIXES], [
    '/v1/transfers', '/v1/payouts', '/v1/topups', '/v1/application_fees', '/v1/charges',
    '/v1/payment_intents', '/v1/treasury', '/v1/issuing', '/v1/balance',
  ]);
  for (const row of FORBIDDEN_PARAMS) {
    assert.ok(typeof row.cite === 'string' && row.cite.length > 0, `${row.name} has a cite`);
    assert.ok(typeof row.reason === 'string' && row.reason.length > 0, `${row.name} has a reason`);
  }
  for (const row of ALLOWED_ENDPOINTS) assert.ok(row.reason.length > 0, `${row.path} has a reason`);
  for (const table of [FORBIDDEN_PARAMS, ALLOWED_ENDPOINTS, FORBIDDEN_ENDPOINT_PREFIXES]) {
    assert.ok(Object.isFrozen(table));
    for (const row of table) assert.ok(Object.isFrozen(row));
  }
  for (const row of ALLOWED_ENDPOINTS) {
    assert.equal(FORBIDDEN_ENDPOINT_PREFIXES.find((p) => row.path.startsWith(p)), undefined, `${row.path} is not under a forbidden prefix`);
  }
  assert.equal(ACCOUNT_ID.source, '^acct_[A-Za-z0-9]+$');
});

test('custody: an endpoint off the allowlist is refused before anything else', () => {
  // Off-allowlist AND carrying a banned parameter AND no account: the endpoint
  // verdict wins — the order endpoint → scope → params is part of the contract.
  refused(() => guardRequest(wire({ path: '/v1/transfers', body: 'transfer_data%5Bdestination%5D=acct_x' })), 'endpoint_not_allowed');
  refused(() => guardRequest(wire({ path: '/v1/charges', account: 'acct_123' })), 'endpoint_not_allowed');
  refused(() => guardRequest(wire({ path: '/v1/payment_intents', account: 'acct_123' })), 'endpoint_not_allowed');
  // An allowlisted path with the wrong method, an extra segment, a missing
  // segment, and `{id}` spanning two segments are all off the list.
  refused(() => guardRequest(wire({ method: 'GET', path: '/v1/customers', account: 'acct_123' })), 'endpoint_not_allowed');
  refused(() => guardRequest(wire({ path: '/v1/invoices/in_1/void', account: 'acct_123' })), 'endpoint_not_allowed');
  refused(() => guardRequest(wire({ path: '/v1/invoices/in_1/finalize/now', account: 'acct_123' })), 'endpoint_not_allowed');
  refused(() => guardRequest(wire({ method: 'GET', path: '/v1/invoices', account: 'acct_123' })), 'endpoint_not_allowed');
  refused(() => guardRequest(wire({ method: 'GET', path: '/v1/invoices/in_1/lines', account: 'acct_123' })), 'endpoint_not_allowed');
  refused(() => guardRequest(wire({ path: '/v1/accounts/acct_123', platform: true })), 'endpoint_not_allowed');
  refused(() => guardRequest(wire({ method: 'DELETE', path: '/v1/customers/cus_1', account: 'acct_123' })), 'endpoint_not_allowed');
  const err = refused(() => guardRequest(wire({ path: '/v1/transfers' })), 'endpoint_not_allowed');
  assert.deepEqual(err.detail, { method: 'POST', path: '/v1/transfers' });
});

test('custody: a connected endpoint without Stripe-Account is refused', () => {
  for (const row of ALLOWED_ENDPOINTS.filter((r) => r.scope === 'connected')) {
    const path = row.path.replace('{id}', 'in_123');
    refused(() => guardRequest(wire({ method: row.method, path })), 'missing_account');
  }
});

test('custody: a malformed Stripe-Account is refused', () => {
  for (const bad of ['cus_123', 'acct_', 'acct_x y', 'ACCT_123', '', ' acct_123', 'acct_123\n', 'acct-123']) {
    refused(() => guardRequest(wire({ path: '/v1/customers', account: bad })), 'invalid_account_id');
  }
  assert.ok(ACCOUNT_ID.test('acct_1AbC9'));
});

test('custody: a platform endpoint refuses a Stripe-Account header', () => {
  for (const row of ALLOWED_ENDPOINTS.filter((r) => r.scope === 'platform')) {
    const path = row.path.replace('{id}', 'acct_123');
    // Declared platform or not — the header alone is the violation.
    refused(() => guardRequest(wire({ method: row.method, path, account: 'acct_123', platform: true })), 'unexpected_account');
    refused(() => guardRequest(wire({ method: row.method, path, account: 'acct_123', platform: false })), 'unexpected_account');
  }
});

test('custody: a platform endpoint must be declared platform', () => {
  refused(() => guardRequest(wire({ path: '/v1/accounts', platform: false })), 'platform_not_declared');
  refused(() => guardRequest(wire({ path: '/v1/account_links', platform: false })), 'platform_not_declared');
  refused(() => guardRequest(wire({ method: 'GET', path: '/v1/accounts/acct_123', platform: false })), 'platform_not_declared');
  // ...and the mirror: a connected row declared platform is refused too, so the
  // declaration can never be sprinkled on as a way past the account check.
  refused(() => guardRequest(wire({ path: '/v1/customers', platform: true })), 'unexpected_platform');
  refused(() => guardRequest(wire({ path: '/v1/customers', platform: true, account: 'acct_123' })), 'unexpected_platform');
});

test('custody: every forbidden parameter is refused at every nesting depth', () => {
  // 10 names × 6 encodings. Body encodings ride on POST /v1/invoices with a valid
  // account, so the ONLY thing wrong with each request is the parameter.
  const encodings = [
    ['top-level', (n) => wire({ path: '/v1/invoices', account: 'acct_123', body: `${n}=x` })],
    ['[child]', (n) => wire({ path: '/v1/invoices', account: 'acct_123', body: `${n}[child]=x` })],
    ['[0]', (n) => wire({ path: '/v1/invoices', account: 'acct_123', body: `phases[0][${n}]=x` })],
    ['upper-case', (n) => wire({ path: '/v1/invoices', account: 'acct_123', body: `${n.toUpperCase()}=x` })],
    ['percent-encoded brackets', (n) => wire({ path: '/v1/invoices', account: 'acct_123', body: `subscription_data%5B${n}%5D%5Bvalue%5D=x` })],
    ['GET query', (n) => wire({ method: 'GET', path: '/v1/invoices/in_123', account: 'acct_123', query: `${n}=x` })],
  ];
  let refusals = 0;
  for (const name of NAMES) {
    for (const [label, build] of encodings) {
      const err = refused(() => guardRequest(build(name)), 'banned_parameter');
      assert.equal(err.detail.segment, name, `${label} encoding of ${name} names the row`);
      assert.equal(typeof err.detail.key, 'string');
      refusals += 1;
    }
  }
  assert.equal(refusals, 60);
  // Values are never inspected: expanding a field NAMED like a banned parameter
  // is a read, and legitimate.
  const expand = wire({ method: 'GET', path: '/v1/invoices/in_123', account: 'acct_123', query: 'expand%5B0%5D=transfer_data' });
  assert.equal(guardRequest(expand), expand);
  // A banned name buried in a value on POST is also fine — only keys count.
  const value = wire({ path: '/v1/customers', account: 'acct_123', body: 'description=on_behalf_of+transfer_data' });
  assert.equal(guardRequest(value), value);
});

test('custody: an allowlisted request passes through unchanged', () => {
  const connected = wire({ path: '/v1/invoices', account: 'acct_123', body: 'customer=cus_1&collection_method=send_invoice' });
  const platform = wire({ method: 'GET', path: '/v1/accounts/acct_123', platform: true });
  assert.equal(guardRequest(connected), connected, 'the identical object comes back');
  assert.equal(guardRequest(platform), platform);
  assert.ok(Object.isFrozen(connected) && Object.isFrozen(platform));
  for (const row of ALLOWED_ENDPOINTS) {
    const path = row.path.replace('{id}', 'x_1');
    const req = row.scope === 'platform'
      ? wire({ method: row.method, path, platform: true })
      : wire({ method: row.method, path, account: 'acct_123' });
    assert.equal(guardRequest(req), req, `${row.method} ${row.path} passes`);
  }
});

test('custody: refusal errors carry a code and never the headers', () => {
  const account = 'acct_G9distinctive';
  const cases = [
    [() => guardRequest(wire({ path: '/v1/invoices', account, body: 'on_behalf_of=acct_x' })), 'banned_parameter'],
    [() => guardRequest(wire({ path: '/v1/accounts', account, platform: true })), 'unexpected_account'],
    [() => guardRequest(wire({ path: '/v1/customers', account: 'ACCT_G9distinctive' })), 'invalid_account_id'],
    [() => guardRequest(wire({ path: '/v1/transfers', account })), 'endpoint_not_allowed'],
  ];
  const headerNamesAndValues = ['accept', 'application/json', 'stripe-version', VERSION, 'content-type', 'x-www-form-urlencoded',
    'stripe-account', account, 'G9distinctive', 'idempotency-key', 'authorization', 'Bearer'];
  for (const [fn, code] of cases) {
    const err = refused(fn, code);
    assert.equal(typeof err.code, 'string');
    assert.ok(Object.isFrozen(err.detail));
    const surfaces = [err.message, JSON.stringify(err), inspect(err, { depth: 10 })];
    for (const text of surfaces) {
      for (const needle of headerNamesAndValues) {
        assert.ok(!text.includes(needle), `${code} error exposes ${JSON.stringify(needle)} in: ${text}`);
      }
    }
  }
});

// --- client level -------------------------------------------------------------

test('client: the module exports exactly the declared surface', () => {
  assert.deepEqual(Object.keys(clientModule).sort(), [
    'StripeApiError', 'StripeCustodyError', 'StripeTransportError', 'createStripeClient', 'encodeForm',
  ]);
  assert.equal(typeof clientModule.createStripeClient, 'function');
  assert.equal(typeof clientModule.encodeForm, 'function');
  assert.equal(clientModule.fetchTransport, undefined, 'the transport is not reachable through the client');
  const client = createStripeClient({ apiKey: KEY, transport: async () => ({}) });
  assert.deepEqual(Object.keys(client), ['request']);
  assert.ok(Object.isFrozen(client));
});

test('client: refuses transfer_data before the transport is called', async () => {
  const { client, calls } = fakeClient();
  const err = await rejectsWith(
    client.request({ method: 'POST', path: '/v1/invoices', account: 'acct_123', params: { customer: 'cus_1', transfer_data: { destination: 'acct_other' } } }),
    StripeCustodyError, 'banned_parameter',
  );
  assert.equal(err.detail.segment, 'transfer_data');
  assert.equal(err.detail.key, 'transfer_data[destination]');
  assert.equal(calls.length, 0);
});

test('client: refuses on_behalf_of before the transport is called', async () => {
  const { client, calls } = fakeClient();
  const flat = await rejectsWith(
    client.request({ method: 'POST', path: '/v1/invoices', account: 'acct_123', params: { customer: 'cus_1', on_behalf_of: 'acct_other' } }),
    StripeCustodyError, 'banned_parameter',
  );
  assert.equal(flat.detail.segment, 'on_behalf_of');
  await rejectsWith(
    client.request({ method: 'POST', path: '/v1/invoices', account: 'acct_123', params: { payment_intent_data: { on_behalf_of: 'acct_other' } } }),
    StripeCustodyError, 'banned_parameter',
  );
  assert.equal(calls.length, 0);
});

test('client: refuses every forbidden parameter with zero transport calls', async () => {
  const { client, calls } = fakeClient();
  let refusals = 0;
  for (const name of NAMES) {
    for (const params of [{ [name]: 'x' }, { wrapper: { [name]: 'x' } }, { [name]: { child: 'x' } }, { list: [{ [name]: 'x' }] }]) {
      const err = await rejectsWith(
        client.request({ method: 'POST', path: '/v1/invoices', account: 'acct_123', params }),
        StripeCustodyError, 'banned_parameter',
      );
      assert.equal(err.detail.segment, name);
      refusals += 1;
    }
    // ...and in a GET query.
    await rejectsWith(
      client.request({ method: 'GET', path: '/v1/invoices/in_123', account: 'acct_123', params: { [name]: 'x' } }),
      StripeCustodyError, 'banned_parameter',
    );
    refusals += 1;
  }
  assert.equal(refusals, 50);
  assert.equal(calls.length, 0);
});

test('client: refuses a connected call without an account with zero transport calls', async () => {
  const { client, calls } = fakeClient();
  await rejectsWith(client.request({ method: 'POST', path: '/v1/customers', params: { email: 'c@example.test' } }), StripeCustodyError, 'missing_account');
  await rejectsWith(client.request({ method: 'POST', path: '/v1/invoices', params: { customer: 'cus_1' } }), StripeCustodyError, 'missing_account');
  await rejectsWith(client.request({ method: 'POST', path: '/v1/invoices/in_1/finalize' }), StripeCustodyError, 'missing_account');
  await rejectsWith(client.request({ method: 'GET', path: '/v1/invoices/in_1' }), StripeCustodyError, 'missing_account');
  // A malformed account reaches the guard, which is where it is refused.
  await rejectsWith(client.request({ method: 'POST', path: '/v1/customers', account: 'cus_123' }), StripeCustodyError, 'invalid_account_id');
  await rejectsWith(client.request({ method: 'POST', path: '/v1/customers', account: '' }), StripeCustodyError, 'invalid_account_id');
  assert.equal(calls.length, 0);
});

test('client: refuses an off-allowlist endpoint with zero transport calls', async () => {
  const { client, calls } = fakeClient();
  for (const path of ['/v1/transfers', '/v1/charges', '/v1/payment_intents', '/v1/payouts', '/v1/topups', '/v1/invoices/in_1/void']) {
    await rejectsWith(client.request({ method: 'POST', path, account: 'acct_123', params: {} }), StripeCustodyError, 'endpoint_not_allowed');
  }
  await rejectsWith(client.request({ method: 'GET', path: '/v1/customers', account: 'acct_123' }), StripeCustodyError, 'endpoint_not_allowed');
  await rejectsWith(client.request({ method: 'GET', path: '/v1/balance', platform: true }), StripeCustodyError, 'endpoint_not_allowed');
  assert.equal(calls.length, 0);
});

test('client: a custody refusal fires even when no key is configured', async () => {
  const fake = fakeTransport();
  const client = createStripeClient({ transport: fake.transport });
  const err = await rejectsWith(
    client.request({ method: 'POST', path: '/v1/invoices', account: 'acct_123', params: { transfer_data: { destination: 'acct_other' } } }),
    StripeCustodyError, 'banned_parameter',
  );
  assert.ok(!(err instanceof ConfigError));
  await rejectsWith(client.request({ method: 'POST', path: '/v1/invoices', params: { customer: 'cus_1' } }), StripeCustodyError, 'missing_account');
  await rejectsWith(client.request({ method: 'POST', path: '/v1/transfers', params: {} }), StripeCustodyError, 'endpoint_not_allowed');
  assert.equal(fake.calls.length, 0);
});

test('client: a clean call with no key is a ConfigError naming INVOICING_STRIPE_SECRET_KEY, with zero transport calls', async () => {
  for (const apiKey of [null, undefined, '', '   ']) {
    const fake = fakeTransport();
    const client = createStripeClient(apiKey === undefined ? { transport: fake.transport } : { apiKey, transport: fake.transport });
    const err = await rejectsWith(client.request({ method: 'POST', path: '/v1/customers', account: 'acct_123', params: { email: 'c@example.test' } }), ConfigError);
    assert.equal(err.envVar, 'INVOICING_STRIPE_SECRET_KEY');
    assert.match(err.message, /INVOICING_STRIPE_SECRET_KEY/);
    assert.match(err.message, /Giving the app a key/);
    assert.equal(fake.calls.length, 0);
  }
});

test('client: the transport receives exactly the guarded request plus authorization', async () => {
  const { client, calls } = fakeClient({ client: { timeoutMs: 1234 } });
  const result = await client.request({
    method: 'POST', path: '/v1/invoices', account: 'acct_123', idempotencyKey: 'idem-1',
    params: { customer: 'cus_1', collection_method: 'send_invoice', days_until_due: 30 },
  });
  assert.equal(calls.length, 1);
  const { signed, options } = calls[0];
  assert.equal(signed.method, 'POST');
  assert.equal(String(signed.url), 'https://api.stripe.com/v1/invoices');
  assert.deepStrictEqual(signed.headers, {
    accept: 'application/json',
    'stripe-version': VERSION,
    'content-type': 'application/x-www-form-urlencoded',
    'stripe-account': 'acct_123',
    'idempotency-key': 'idem-1',
    authorization: `Bearer ${KEY}`,
  });
  assert.equal(signed.body, 'customer=cus_1&collection_method=send_invoice&days_until_due=30');
  assert.ok(Object.isFrozen(signed) && Object.isFrozen(signed.headers));
  assert.deepStrictEqual(options, { timeoutMs: 1234 });
  assert.deepStrictEqual(result, { status: 200, requestId: 'req_fake', data: { object: 'invoice', id: 'in_fake' } });

  // A platform GET: no content-type, no stripe-account, no idempotency-key.
  await client.request({ method: 'GET', path: '/v1/accounts/acct_123', platform: true });
  assert.equal(calls.length, 2);
  assert.deepStrictEqual(calls[1].signed.headers, {
    accept: 'application/json',
    'stripe-version': VERSION,
    authorization: `Bearer ${KEY}`,
  });
  assert.equal(calls[1].signed.body, null);
  assert.equal(String(calls[1].signed.url), 'https://api.stripe.com/v1/accounts/acct_123');
});

test('client: form encoding follows Stripe bracket notation', () => {
  assert.equal(
    encodeForm({ customer: 'cus_1', metadata: { order: 'A-1', nested: { deep: 'yes' } }, expand: ['customer', 'lines'], auto_advance: false, days_until_due: 30, footer: null, skipped: undefined }),
    'customer=cus_1&metadata%5Border%5D=A-1&metadata%5Bnested%5D%5Bdeep%5D=yes&expand%5B0%5D=customer&expand%5B1%5D=lines&auto_advance=false&days_until_due=30&footer=',
  );
  assert.equal(new URLSearchParams(encodeForm({ metadata: { nested: { deep: 'yes' } } })).get('metadata[nested][deep]'), 'yes');
  assert.equal(encodeForm({ items: [{ price: 'p_1', quantity: 2 }] }), 'items%5B0%5D%5Bprice%5D=p_1&items%5B0%5D%5Bquantity%5D=2');
  assert.equal(encodeForm({ text: 'a b&c=d/é' }), 'text=a+b%26c%3Dd%2F%C3%A9');
  assert.equal(encodeForm({}), '');
  assert.equal(encodeForm({ n: -1.5, z: 0 }), 'n=-1.5&z=0');
  for (const bad of [new Date(0), 10n, () => 1, Symbol('s'), NaN, Infinity, -Infinity]) {
    assert.throws(() => encodeForm({ field: bad }), TypeError, `refuses ${typeof bad === 'symbol' ? 'symbol' : String(bad)}`);
    assert.throws(() => encodeForm({ outer: { field: bad } }), TypeError);
  }
  for (const nonPlain of ['customer=cus_1', ['a'], new URLSearchParams('a=1'), Buffer.from('a=1'), null, undefined, 1, new Map(), Object.create(null)]) {
    assert.throws(() => encodeForm(nonPlain), TypeError);
  }
  // Nested non-plain values are refused too — a pre-encoded body cannot be
  // smuggled in one level down.
  assert.throws(() => encodeForm({ params: new URLSearchParams('transfer_data=x') }), TypeError);
  assert.throws(() => encodeForm({ params: new Map() }), TypeError);
});

test('client: GET params go in the query string and POST params in the body, with content-type on every POST', async () => {
  const { client, calls } = fakeClient();
  await client.request({ method: 'GET', path: '/v1/invoices/in_1', account: 'acct_123', params: { expand: ['customer'] } });
  await client.request({ method: 'POST', path: '/v1/invoices', account: 'acct_123', params: { customer: 'cus_1' } });
  await client.request({ method: 'POST', path: '/v1/invoices/in_1/finalize', account: 'acct_123' });
  await client.request({ method: 'POST', path: '/v1/invoices/in_1/send', account: 'acct_123', params: {} });
  await client.request({ method: 'GET', path: '/v1/invoices/in_1', account: 'acct_123' });
  assert.equal(calls.length, 5);
  const [get, post, emptyPost, emptyParamsPost, bareGet] = calls.map((c) => c.signed);

  assert.equal(String(get.url), 'https://api.stripe.com/v1/invoices/in_1?expand%5B0%5D=customer');
  assert.equal(get.body, null);
  assert.equal(get.headers['content-type'], undefined, 'no content-type on GET');

  assert.equal(String(post.url), 'https://api.stripe.com/v1/invoices');
  assert.equal(post.body, 'customer=cus_1');
  assert.equal(post.headers['content-type'], 'application/x-www-form-urlencoded');

  for (const req of [emptyPost, emptyParamsPost]) {
    assert.equal(req.body, '', 'a parameterless POST sends an empty body');
    assert.equal(req.headers['content-type'], 'application/x-www-form-urlencoded', '...with content-type still set');
    assert.equal(req.url.search, '');
  }
  assert.equal(String(bareGet.url), 'https://api.stripe.com/v1/invoices/in_1');
  assert.equal(bareGet.body, null);
});

test('client: idempotency key is sent verbatim on POST and refused on GET or out of range', async () => {
  const { client, calls } = fakeClient();
  const key255 = 'k'.repeat(255);
  await client.request({ method: 'POST', path: '/v1/invoices', account: 'acct_123', idempotencyKey: 'AS-43:invoice:42:finalize', params: {} });
  await client.request({ method: 'POST', path: '/v1/invoices', account: 'acct_123', idempotencyKey: key255, params: {} });
  assert.equal(calls[0].signed.headers['idempotency-key'], 'AS-43:invoice:42:finalize');
  assert.equal(calls[1].signed.headers['idempotency-key'], key255);
  assert.equal(calls.length, 2);

  const before = calls.length;
  for (const bad of [
    { method: 'GET', path: '/v1/invoices/in_1', account: 'acct_123', idempotencyKey: 'k' },
    { method: 'POST', path: '/v1/invoices', account: 'acct_123', idempotencyKey: '' },
    { method: 'POST', path: '/v1/invoices', account: 'acct_123', idempotencyKey: 'k'.repeat(256) },
    { method: 'POST', path: '/v1/invoices', account: 'acct_123', idempotencyKey: 42 },
    { method: 'POST', path: '/v1/invoices', account: 'acct_123', idempotencyKey: null },
  ]) {
    await rejectsWith(client.request(bad), TypeError);
  }
  assert.equal(calls.length, before, 'refused before the transport');
  // The client never invents a key: none given, none sent.
  await client.request({ method: 'POST', path: '/v1/invoices', account: 'acct_123', params: {} });
  assert.equal(calls.at(-1).signed.headers['idempotency-key'], undefined);
});

test('client: a Stripe error body becomes a StripeApiError carrying status, type, code, param, requestId — and never the key', async () => {
  const stripeError = {
    error: { type: 'invalid_request_error', code: 'resource_missing', param: 'customer', message: 'No such customer: cus_nope', doc_url: 'https://stripe.com/docs/error-codes/resource-missing' },
  };
  const { client } = fakeClient({ reply: { status: 400, headers: { 'request-id': 'req_err' }, body: JSON.stringify(stripeError) } });
  const err = await rejectsWith(client.request({ method: 'POST', path: '/v1/invoices', account: 'acct_123', params: { customer: 'cus_nope' } }), StripeApiError);
  assert.equal(err.status, 400);
  assert.equal(err.type, 'invalid_request_error');
  assert.equal(err.code, 'resource_missing');
  assert.equal(err.param, 'customer');
  assert.equal(err.requestId, 'req_err');
  assert.equal(err.stripeMessage, 'No such customer: cus_nope');
  assert.match(err.message, /No such customer: cus_nope/);
  assert.match(err.message, /400/);
  for (const text of [err.message, JSON.stringify(err), inspect(err, { depth: 10 })]) {
    assert.ok(!text.includes(KEY), `the key leaked into: ${text}`);
    assert.ok(!text.includes('Bearer'), `the authorization header leaked into: ${text}`);
    assert.ok(!text.includes('stripe-account'), `request headers leaked into: ${text}`);
  }
  assert.equal(err.headers, undefined);
  assert.equal(err.request, undefined);

  // A 200 whose body is an error object is still an error; a 5xx with an empty
  // object is an error with nothing to say about itself.
  const odd = fakeClient({ reply: { status: 200, headers: {}, body: JSON.stringify({ error: { type: 'api_error', message: 'odd' } }) } });
  const oddErr = await rejectsWith(odd.client.request({ method: 'GET', path: '/v1/invoices/in_1', account: 'acct_123' }), StripeApiError);
  assert.equal(oddErr.type, 'api_error');
  assert.equal(oddErr.requestId, null);
  const bare = fakeClient({ reply: { status: 502, headers: {}, body: '{}' } });
  const bareErr = await rejectsWith(bare.client.request({ method: 'GET', path: '/v1/invoices/in_1', account: 'acct_123' }), StripeApiError);
  assert.equal(bareErr.status, 502);
  assert.equal(bareErr.type, null);
  assert.equal(bareErr.code, null);
});

test('client: a non-JSON body or a transport failure is a StripeTransportError', async () => {
  for (const body of ['<html>502 Bad Gateway</html>', '', 'null', '[]', '"string"', '{"unterminated": ']) {
    const { client } = fakeClient({ reply: { status: 200, headers: {}, body } });
    const err = await rejectsWith(client.request({ method: 'GET', path: '/v1/invoices/in_1', account: 'acct_123' }), StripeTransportError, 'invalid_json');
    assert.equal(err.status, 200);
  }
  const failing = (thrown) => createStripeClient({ apiKey: KEY, transport: async () => { throw thrown; } });
  const call = { method: 'GET', path: '/v1/invoices/in_1', account: 'acct_123' };
  for (const code of ['network', 'timeout', 'redirect']) {
    const cause = Object.assign(new Error(`synthetic ${code}`), { code });
    const err = await rejectsWith(failing(cause).request(call), StripeTransportError, code);
    assert.equal(err.cause, cause);
  }
  // An unclassified failure is `network`; the original error rides along as cause.
  const plain = new Error('boom');
  const err = await rejectsWith(failing(plain).request(call), StripeTransportError, 'network');
  assert.equal(err.cause, plain);
  await rejectsWith(failing(Object.assign(new Error('x'), { code: 'ECONNRESET' })).request(call), StripeTransportError, 'network');
  await rejectsWith(failing('a string, not an Error').request(call), StripeTransportError, 'network');
});

test('client: the suite runs with no INVOICING_STRIPE_SECRET_KEY in the environment', () => {
  assert.equal(process.env.INVOICING_STRIPE_SECRET_KEY, undefined);
  assert.equal(Object.keys(process.env).filter((k) => /STRIPE/i.test(k) && k !== 'ASC_STRIPE_MOCK_URL').length, 0);
});

test('client: path must be a bare /v1 path — no query, fragment, percent-escapes or traversal', async () => {
  const { client, calls } = fakeClient();
  const bad = [
    '/v1/invoices?expand[]=customer', '/v1/invoices#frag', '/v1/invoices/%2e%2e/transfers', '/v1/../v1/transfers',
    '/v1//invoices', '/v1/invoices/', 'v1/invoices', '/v2/invoices', '/v1', '/', '', '/v1/in-voices', '/v1/invoices/in.1',
    '/v1/invoices in_1', 'https://api.stripe.com/v1/invoices', '//evil.example/v1/invoices', '/V1/invoices', '/v1/invoices\n',
    42, null, undefined, ['/v1/invoices'],
  ];
  for (const path of bad) {
    await rejectsWith(client.request({ method: 'POST', path, account: 'acct_123', params: {} }), TypeError);
  }
  // The rest of validateCall, for completeness: method, params, account,
  // platform, and unknown fields are all TypeErrors before any policy runs.
  for (const call of [
    { method: 'PUT', path: '/v1/invoices', account: 'acct_123' },
    { method: 'post', path: '/v1/invoices', account: 'acct_123' },
    { method: 'POST', path: '/v1/invoices', account: 'acct_123', params: 'customer=cus_1' },
    { method: 'POST', path: '/v1/invoices', account: 'acct_123', params: new URLSearchParams('customer=cus_1') },
    { method: 'POST', path: '/v1/invoices', account: 'acct_123', params: [] },
    { method: 'POST', path: '/v1/invoices', account: 123 },
    { method: 'POST', path: '/v1/accounts', platform: 'yes' },
    { method: 'POST', path: '/v1/accounts', platform: false },
    { method: 'POST', path: '/v1/invoices', account: 'acct_123', headers: { 'stripe-account': 'acct_other' } },
    { method: 'POST', path: '/v1/invoices', account: 'acct_123', body: 'transfer_data=x' },
    null, undefined, 'POST /v1/invoices',
  ]) {
    await rejectsWith(client.request(call), TypeError);
  }
  assert.equal(calls.length, 0);
});

test('client: baseUrl is validated on construction — scheme, bare origin, no credentials', () => {
  const transport = async () => ({});
  for (const good of ['https://api.stripe.com', 'https://api.stripe.com/', 'http://stripe-mock:12111', 'http://127.0.0.1:4242/']) {
    assert.doesNotThrow(() => createStripeClient({ apiKey: KEY, transport, baseUrl: good }), good);
  }
  for (const bad of [
    'ftp://api.stripe.com', 'api.stripe.com', 'https://api.stripe.com/v1', 'https://api.stripe.com/?x=1', 'https://api.stripe.com/#x',
    'https://user:pw@api.stripe.com', 'https://user@api.stripe.com', '', 42, null,
  ]) {
    assert.throws(() => createStripeClient({ apiKey: KEY, transport, baseUrl: bad }), TypeError, `refuses ${JSON.stringify(bad)}`);
  }
  assert.throws(() => createStripeClient({ apiKey: 42, transport }), TypeError);
  assert.throws(() => createStripeClient({ apiKey: KEY, transport: 'fetch' }), TypeError);
  assert.throws(() => createStripeClient({ apiKey: KEY, transport, timeoutMs: 0 }), TypeError);
  assert.throws(() => createStripeClient({ apiKey: KEY, transport, timeoutMs: 1.5 }), TypeError);
  assert.throws(() => createStripeClient({ apiKey: KEY, transport, apiVersion: '' }), TypeError);
});

// --- transport level: the real fetchTransport against a loopback listener -----

/**
 * Start a node:http listener on 127.0.0.1:0, run `fn(baseUrl, requests)`, always
 * stop it — teardown registered before the assertions run, the helpers/server.js
 * rule. `handler(record, res)` is called once the request body has arrived.
 */
async function withListener(handler, fn) {
  const requests = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const record = { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') };
      requests.push(record);
      handler(record, res);
    });
  });
  server.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const { port } = server.address();
    return await fn(`http://127.0.0.1:${port}`, requests);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

const ok = (res, body = { object: 'invoice', id: 'in_loopback' }) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Request-Id', 'req_loopback');
  res.end(JSON.stringify(body));
};

test('transport: sends method, headers and body byte-for-byte to a loopback listener', async () => {
  await withListener((record, res) => ok(res), async (baseUrl, requests) => {
    const client = createStripeClient({ apiKey: KEY, baseUrl });
    const params = { customer: 'cus_1', collection_method: 'send_invoice', metadata: { order: 'A 1&2' } };
    const result = await client.request({ method: 'POST', path: '/v1/invoices', account: 'acct_t1', idempotencyKey: 'idem-t1', params });
    assert.equal(requests.length, 1);
    const [seen] = requests;
    assert.equal(seen.method, 'POST');
    assert.equal(seen.url, '/v1/invoices');
    assert.equal(seen.body, encodeForm(params));
    assert.equal(seen.body, 'customer=cus_1&collection_method=send_invoice&metadata%5Border%5D=A+1%262');
    assert.equal(seen.headers.accept, 'application/json');
    assert.equal(seen.headers['stripe-version'], VERSION);
    assert.equal(seen.headers['content-type'], 'application/x-www-form-urlencoded');
    assert.equal(seen.headers['stripe-account'], 'acct_t1');
    assert.equal(seen.headers['idempotency-key'], 'idem-t1');
    assert.equal(seen.headers.authorization, `Bearer ${KEY}`);
    assert.equal(seen.headers['content-length'], String(Buffer.byteLength(seen.body)));
    assert.ok(!('user-agent' in seen.headers) || seen.headers['user-agent'] !== undefined, 'the runtime may add its own user-agent; the client sets none');
    assert.deepStrictEqual(result, { status: 200, requestId: 'req_loopback', data: { object: 'invoice', id: 'in_loopback' } });

    // A GET: no body, no content-type, no content-length, query on the wire.
    await client.request({ method: 'GET', path: '/v1/invoices/in_1', account: 'acct_t1', params: { expand: ['customer'] } });
    assert.equal(requests.length, 2);
    assert.equal(requests[1].method, 'GET');
    assert.equal(requests[1].url, '/v1/invoices/in_1?expand%5B0%5D=customer');
    assert.equal(requests[1].body, '');
    assert.equal(requests[1].headers['content-type'], undefined);
    assert.equal(requests[1].headers['content-length'], undefined);
    assert.equal(requests[1].headers['idempotency-key'], undefined);
  });
});

test('transport: refuses to follow a redirect', async () => {
  await withListener((record, res) => {
    res.statusCode = 302;
    res.setHeader('Location', 'http://127.0.0.1:9/elsewhere');
    res.end();
  }, async (baseUrl, requests) => {
    const client = createStripeClient({ apiKey: KEY, baseUrl });
    const err = await rejectsWith(client.request({ method: 'GET', path: '/v1/invoices/in_1', account: 'acct_123' }), StripeTransportError, 'redirect');
    assert.equal(requests.length, 1, 'the listener saw exactly one request — the key went nowhere else');
    assert.ok(!inspect(err, { depth: 10 }).includes(KEY));
  });
});

test('transport: times out', async () => {
  await withListener(() => { /* hold the socket open; never respond */ }, async (baseUrl, requests) => {
    const client = createStripeClient({ apiKey: KEY, baseUrl, timeoutMs: 200 });
    const started = Date.now();
    await rejectsWith(client.request({ method: 'POST', path: '/v1/invoices/in_1/finalize', account: 'acct_123' }), StripeTransportError, 'timeout');
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= 150 && elapsed < 5000, `timed out after ${elapsed}ms`);
    assert.equal(requests.length, 1);
  });
});

test("transport: a refused connection is a StripeTransportError('network')", async () => {
  // Port 1, as the plan specifies (the runtime refuses it before connecting) —
  // and a port that was listening a moment ago and is now closed, so a real
  // ECONNREFUSED is exercised too, not only the pre-connect refusal.
  const client = createStripeClient({ apiKey: KEY, baseUrl: 'http://127.0.0.1:1/' });
  const err = await rejectsWith(client.request({ method: 'GET', path: '/v1/invoices/in_1', account: 'acct_123' }), StripeTransportError, 'network');
  assert.ok(err.cause instanceof Error);

  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  const closed = createStripeClient({ apiKey: KEY, baseUrl: `http://127.0.0.1:${port}/` });
  const refusedErr = await rejectsWith(closed.request({ method: 'GET', path: '/v1/invoices/in_1', account: 'acct_123' }), StripeTransportError, 'network');
  assert.ok(!inspect(refusedErr, { depth: 10 }).includes(KEY));
});
