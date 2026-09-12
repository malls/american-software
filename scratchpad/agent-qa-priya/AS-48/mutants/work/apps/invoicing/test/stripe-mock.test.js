// stripe-mock.test.js — the contract half (AS-38, plan §2.10 K0–K11).
//
// Every allowlisted request shape, sent by the real client through the real
// transport to stripe-mock — Stripe's own request-shape validator, pinned in
// compose.yaml to the tag whose bundled OpenAPI spec matches the client's
// Stripe-Version constant. This is what proves the encoder emits parameter names
// Stripe recognises (K9 proves the mock would have said otherwise) and that the
// custody guard refuses a shape the API itself accepts (K11).
//
// SELF-SKIPPING. The `test` service runs with `network_mode: none` and no
// ASC_STRIPE_MOCK_URL, so every case here reports as SKIPPED there — never as
// passed. The `contract` service sets the variable and runs on an internal
// network with the mock; there, nothing skips. Only this file reads the variable.
//
// The key literal below is the ONE key-shaped string in the repository (plan
// §2.8, AC 34): stripe-mock requires a test-mode prefix and validates nothing
// else about it, and it never leaves the internal network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStripeClient, StripeApiError, StripeCustodyError } from '../lib/stripe/client.js';
import { fetchTransport } from '../lib/stripe/transport.js';

const RAW_URL = process.env.ASC_STRIPE_MOCK_URL;
const MOCK_URL = typeof RAW_URL === 'string' && RAW_URL.trim() !== '' ? RAW_URL.trim() : undefined;
const SKIP = MOCK_URL === undefined ? 'ASC_STRIPE_MOCK_URL not set — run the contract service' : false;

const KEY = 'sk_test_stripemock';
const ACCOUNT = 'acct_stripemock';
const VERSION = '2026-08-26.dahlia';

// Refuse, at load time, to run this file against anything that could be Stripe.
// The suite must be un-runnable against the real API by construction, not by
// convention — a mis-set variable must fail the file, not send requests.
if (MOCK_URL !== undefined) {
  const { hostname } = new URL(MOCK_URL);
  if (hostname.endsWith('stripe.com')) {
    throw new Error(`ASC_STRIPE_MOCK_URL points at ${hostname}: this suite only ever talks to stripe-mock`);
  }
}

/** Poll until the mock answers anything at all (its 401 to an unauthenticated
 *  GET is the reachability signal), every 100 ms for at most 10 s. Memoised, so
 *  the wait is paid once per run and every case can simply await it. */
let readiness;
function ready() {
  readiness ??= (async () => {
    const started = Date.now();
    let lastError;
    while (Date.now() - started < 10_000) {
      try {
        const response = await fetch(`${MOCK_URL}/v1/customers`, { signal: AbortSignal.timeout(1000) });
        return { status: response.status, waitedMs: Date.now() - started };
      } catch (err) {
        lastError = err;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    throw new Error(`stripe-mock at ${MOCK_URL} did not answer within 10 s: ${lastError?.cause?.message ?? lastError?.message}`, { cause: lastError });
  })();
  return readiness;
}

/** A transport that counts calls and keeps the last raw response, so a case can
 *  assert on the wire (echoed headers, zero calls) through the real client. */
function observedTransport() {
  const seen = { calls: 0, lastResponse: null };
  const transport = async (request, options) => {
    seen.calls += 1;
    const response = await fetchTransport(request, options);
    seen.lastResponse = response;
    return response;
  };
  return { transport, seen };
}

function mockClient() {
  const { transport, seen } = observedTransport();
  return { client: createStripeClient({ apiKey: KEY, baseUrl: MOCK_URL, transport }), seen };
}

/** A raw request to the mock, bypassing the client on purpose — for the cases
 *  that measure the MOCK (K1, K11), not the client. */
async function raw(method, path, { body, version = VERSION, headers = {} } = {}) {
  const response = await fetch(`${MOCK_URL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${KEY}`,
      'stripe-version': version,
      ...(body === undefined ? {} : { 'content-type': 'application/x-www-form-urlencoded' }),
      ...headers,
    },
    body,
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
  });
  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* left null; the status is what the case asserts */ }
  return { status: response.status, headers: Object.fromEntries(response.headers), data, text };
}

/** Assert a connected-row call succeeded and came back as the expected object. */
function assertOk(result, object) {
  assert.equal(result.status, 200, `expected 200, got ${result.status}: ${JSON.stringify(result.data)}`);
  assert.equal(result.data.object, object);
  assert.equal(result.requestId, 'req_123', 'stripe-mock stamps every response with Request-Id: req_123');
}

// --- K0, K1: the instrument ----------------------------------------------------

test('stripe-mock: the mock is reachable and is not Stripe', { skip: SKIP }, async (t) => {
  const { hostname, protocol } = new URL(MOCK_URL);
  assert.ok(!hostname.endsWith('stripe.com'));
  assert.equal(protocol, 'http:', 'the mock speaks plain HTTP on the internal network; TLS would mean a different host');
  const { status, waitedMs } = await ready();
  t.diagnostic(`stripe-mock answered after ${waitedMs} ms (first status ${status})`);
  // Unauthenticated → 401, exactly as the real API would answer. Any other
  // status means something other than stripe-mock is on the other end.
  assert.equal(status, 401);
});

test('stripe-mock: strict version check is on', { skip: SKIP }, async () => {
  await ready();
  // A stale Stripe-Version is a 400 under -strict-version-check. This is what
  // makes the client's `stripe-version` constant load-bearing: every 200 in the
  // cases below was validated against THE spec the constant names, not against
  // whatever the mock happened to bundle.
  const stale = await raw('GET', '/v1/customers', { version: '2020-08-27' });
  assert.equal(stale.status, 400, `expected 400 for a stale Stripe-Version, got ${stale.status}: ${stale.text}`);
  const current = await raw('GET', '/v1/customers');
  assert.equal(current.status, 200, `the pinned version is accepted: ${current.text}`);
});

// --- K2–K7: the connected rows ------------------------------------------------

test('stripe-mock: connected POST /v1/customers', { skip: SKIP }, async () => {
  await ready();
  const { client, seen } = mockClient();
  const result = await client.request({
    method: 'POST', path: '/v1/customers', account: ACCOUNT,
    params: { email: 'client@example.test', name: 'A Client', metadata: { source: 'contract-test', freelancer: 'fl_1' } },
  });
  assertOk(result, 'customer');
  assert.equal(seen.calls, 1);
});

test('stripe-mock: connected POST /v1/invoiceitems', { skip: SKIP }, async () => {
  await ready();
  const { client } = mockClient();
  const result = await client.request({
    method: 'POST', path: '/v1/invoiceitems', account: ACCOUNT,
    params: { customer: 'cus_stripemock', description: 'Contract test line', quantity: 1, metadata: { line: '1' } },
  });
  assertOk(result, 'invoiceitem');
});

test('stripe-mock: connected POST /v1/invoices', { skip: SKIP }, async () => {
  await ready();
  const { client } = mockClient();
  const result = await client.request({
    method: 'POST', path: '/v1/invoices', account: ACCOUNT,
    params: { customer: 'cus_stripemock', collection_method: 'send_invoice', days_until_due: 30, auto_advance: false },
  });
  assertOk(result, 'invoice');
});

test('stripe-mock: connected POST /v1/invoices/{id}/finalize', { skip: SKIP }, async () => {
  await ready();
  const { client, seen } = mockClient();
  // No params at all: an empty form body with content-type set (C11) is what the
  // mock — and Stripe — accept for a parameterless POST.
  const result = await client.request({ method: 'POST', path: '/v1/invoices/in_stripemock/finalize', account: ACCOUNT });
  assertOk(result, 'invoice');
  assert.equal(seen.calls, 1);
});

test('stripe-mock: connected POST /v1/invoices/{id}/send', { skip: SKIP }, async () => {
  await ready();
  const { client } = mockClient();
  const result = await client.request({ method: 'POST', path: '/v1/invoices/in_stripemock/send', account: ACCOUNT, params: {} });
  assertOk(result, 'invoice');
});

test('stripe-mock: connected GET /v1/invoices/{id}', { skip: SKIP }, async () => {
  await ready();
  const { client } = mockClient();
  const result = await client.request({ method: 'GET', path: '/v1/invoices/in_stripemock', account: ACCOUNT, params: { expand: ['customer'] } });
  assertOk(result, 'invoice');
  const bare = await client.request({ method: 'GET', path: '/v1/invoices/in_stripemock', account: ACCOUNT });
  assertOk(bare, 'invoice');
});

// --- K8: the platform rows -----------------------------------------------------

test('stripe-mock: platform POST /v1/accounts, POST /v1/account_links, GET /v1/accounts/{id}', { skip: SKIP }, async () => {
  await ready();
  const { client, seen } = mockClient();
  // A BARE account creation: no `type`, no `controller[...]` — the Standard-
  // equivalent defaults (spike §1), which is what AS-41 will send.
  const account = await client.request({ method: 'POST', path: '/v1/accounts', platform: true, params: {} });
  assertOk(account, 'account');
  const link = await client.request({
    method: 'POST', path: '/v1/account_links', platform: true,
    params: { account: ACCOUNT, type: 'account_onboarding', refresh_url: 'https://example.test/refresh', return_url: 'https://example.test/return' },
  });
  assertOk(link, 'account_link');
  const read = await client.request({ method: 'GET', path: `/v1/accounts/${ACCOUNT}`, platform: true });
  assertOk(read, 'account');
  assert.equal(seen.calls, 3);
});

// --- K9, K10: the mock validates, and the wire carries what we sent -----------

test('stripe-mock: unknown parameters are rejected by the mock — the encoder is not inventing names', { skip: SKIP }, async () => {
  await ready();
  // This is what makes every 200 above non-vacuous: the mock checks parameter
  // NAMES against the spec, so a misspelt or invented name in the encoder's
  // output would have been a 400 in K2–K8, not a pass.
  const { client, seen } = mockClient();
  let caught;
  await assert.rejects(
    client.request({ method: 'POST', path: '/v1/customers', account: ACCOUNT, params: { email: 'client@example.test', made_up_param: '1' } }),
    (err) => {
      caught = err;
      assert.ok(err instanceof StripeApiError, `expected StripeApiError, got ${err?.name}: ${err?.message}`);
      return true;
    },
  );
  assert.equal(caught.status, 400);
  assert.equal(caught.type, 'invalid_request_error');
  assert.equal(caught.requestId, 'req_123');
  // The mock's wording ("additional properties are not allowed") does not name
  // the offending key; the client's prefix and Stripe's error type are what we pin.
  assert.match(caught.message, /^Stripe 400 invalid_request_error: /);
  assert.ok(!caught.message.includes(KEY));
  assert.equal(seen.calls, 1, 'the request reached the mock — this was the mock refusing, not the guard');
});

test('stripe-mock: Idempotency-Key is echoed and Request-Id surfaces as requestId', { skip: SKIP }, async () => {
  await ready();
  const { client, seen } = mockClient();
  const result = await client.request({
    method: 'POST', path: '/v1/invoices', account: ACCOUNT, idempotencyKey: 'contract-test-idem-1',
    params: { customer: 'cus_stripemock', collection_method: 'send_invoice', days_until_due: 30 },
  });
  assertOk(result, 'invoice');
  assert.equal(result.requestId, 'req_123');
  assert.equal(seen.lastResponse.headers['request-id'], 'req_123');
  assert.equal(seen.lastResponse.headers['idempotency-key'], 'contract-test-idem-1', 'the mock echoes the key we sent, as Stripe does');
});

// --- K11: the boundary Stripe will not hold for us -----------------------------

test('stripe-mock: the mock ACCEPTS the forbidden shape raw; the client refuses it with zero transport calls', { skip: SKIP }, async () => {
  await ready();
  // Re-measures spike §1 ("the API will not hold this boundary for us"): a
  // platform-side invoice that routes the client's money through OUR balance is
  // a perfectly valid request as far as Stripe's schema is concerned.
  const forbidden = new URLSearchParams({
    customer: 'cus_stripemock', 'transfer_data[destination]': 'acct_x', on_behalf_of: 'acct_x', collection_method: 'send_invoice', days_until_due: '30',
  }).toString();
  const mock = await raw('POST', '/v1/invoices', { body: forbidden });
  assert.equal(mock.status, 200, `the mock accepted the forbidden shape (it validates syntax, not custody): ${mock.text}`);
  assert.equal(mock.data.object, 'invoice');

  // The same call through the client never reaches the wire.
  const { client, seen } = mockClient();
  await assert.rejects(
    client.request({
      method: 'POST', path: '/v1/invoices', // no account: the platform-side shape
      params: { customer: 'cus_stripemock', transfer_data: { destination: 'acct_x' }, on_behalf_of: 'acct_x', collection_method: 'send_invoice', days_until_due: 30 },
    }),
    (err) => {
      assert.ok(err instanceof StripeCustodyError, `expected StripeCustodyError, got ${err?.name}: ${err?.message}`);
      // Order of checks (plan §2.7): a connected row with no Stripe-Account is
      // refused as `missing_account` before its parameters are even read.
      assert.equal(err.code, 'missing_account');
      return true;
    },
  );
  // ...and with a valid account the parameters are what stop it.
  await assert.rejects(
    client.request({
      method: 'POST', path: '/v1/invoices', account: ACCOUNT,
      params: { customer: 'cus_stripemock', transfer_data: { destination: 'acct_x' }, on_behalf_of: 'acct_x' },
    }),
    (err) => {
      assert.ok(err instanceof StripeCustodyError);
      assert.equal(err.code, 'banned_parameter');
      assert.equal(err.detail.segment, 'transfer_data');
      return true;
    },
  );
  assert.equal(seen.calls, 0, 'zero transport calls: the guard, not the mock, held the line');
});
