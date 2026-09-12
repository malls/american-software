// test/e2e-loop.test.js — the whole Rule-1 chain, driven over the app's real
// HTTP API, against the stateful Stripe double (AS-49, plan §1, §6).
//
// THE HONEST CLAIM (plan §2, pinned as STRIPE_DOUBLE_CLAIM in the double):
//
//   This suite proves that OUR half of the loop is correct against OUR MODEL of Stripe. The
//   model — test/helpers/stripe-double.js — was written by us from Stripe's documentation and
//   from the stripe-mock fixtures; it holds state the way we believe Stripe does and signs events
//   the way Stripe documents. A green run means: every step of the chain, driven over the app's
//   real HTTP API, behaves as designed when Stripe behaves as we assume. It does not mean
//   Stripe behaves that way. Two instruments, two claims, neither of them Stripe: stripe-mock
//   (the contract service) validates the SHAPE of every request we send against Stripe's
//   OpenAPI spec and answers with stateless fixtures; the double holds STATE and emits events, and
//   validates nothing. The fidelity of the model is exactly what the recorded test-mode
//   acceptance run (AS-50) exists to check, and nothing in this suite substitutes for it.
//
// Every case title carries `(STRIPE DOUBLE)`; the one case that also talks to
// stripe-mock carries `(STRIPE DOUBLE vs STRIPE-MOCK)`. A red line in a compose
// log must never leave the reader wondering which instrument produced it.
//
// HOW IT RUNS OFFLINE. The app is booted in-process through withServer with a
// client built on the DEFAULT base URL (https://api.stripe.com) and the double
// as its transport, so nothing was pointed anywhere: the `test` service's
// network_mode: none is the sandbox, AC-14 asserts every call's origin, and
// the F-NET recipe (plan §7) proves a real call would be a red. Delivery is the
// test's, not the double's: the double returns bytes and a Stripe-Signature,
// deliver() below carries them to /webhooks/stripe over loopback (plan §3.5).
//
// The twelve-step order, the fixed values and the form encodings are COPIED
// from demo/run.mjs (plan §3.6) — never imported: the demo imports nothing from
// test/, and this file imports nothing from demo/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { COOKIE_NAME } from '../lib/auth/session.js';
import { readinessFromAccount } from '../lib/connect/readiness.js';
import { createStripeClient } from '../lib/stripe/client.js';
import { FORBIDDEN_PARAMS } from '../lib/stripe/custody.js';
import { fetchTransport } from '../lib/stripe/transport.js';
import { configFor, seedSession, withServer } from './helpers/server.js';
import { ALLOWLIST_KEYS, STRIPE_DOUBLE_CLAIM, createStripeDouble } from './helpers/stripe-double.js';

// Not key-shaped on purpose — the convention every offline suite uses.
const KEY = 'unit-test-placeholder-key';
const SECRET = 'whsec_e2e_double';
const STRIPE_ORIGIN = 'https://api.stripe.com';

// Fixed values, copied from demo/run.mjs (plan §3.6).
const FREELANCER = { displayName: 'Dana Reyes', email: 'dana@demo.example', password: 'correct-horse-battery' };
const CLIENT = { name: 'Northwind Studio', email: 'billing@northwind.example' };
const CONTRACT = {
  templateId: 'independent-contractor-agreement@1',
  projectDescription: 'Redesign of the Northwind Studio marketing website. Milestone 1 covers the home page and the contact form.',
  startDate: '2026-10-01',
};
// The double lifts stripe-mock's $10.00 constraint: two items, 12,500 minor.
const ITEMS = [
  { description: 'Design work', quantity: 2, unitAmountMinor: 5000 },
  { description: 'Copy review', quantity: 1, unitAmountMinor: 2500 },
];
const ITEMS_TOTAL = 12_500;
const DAYS_UNTIL_DUE = 30;

// The committed literals. The model clock starts at MODEL_EPOCH (1_789_000_000)
// and advances 60 s per transition; E1's transitions, in order: account create,
// completeOnboarding, customer, invoice, item, item, finalize, send, pay.
const READY_AT = '2026-09-10T00:28:40.000Z'; // completeOnboarding, transition 2
const FINALIZED_AT = '2026-09-10T00:33:40.000Z'; // finalize, transition 7
const PAID_AT = '2026-09-10T00:35:40.000Z'; // pay, transition 9

const RAW_URL = process.env.ASC_STRIPE_MOCK_URL;
const MOCK_URL = typeof RAW_URL === 'string' && RAW_URL.trim() !== '' ? RAW_URL.trim() : undefined;
const SKIP = MOCK_URL === undefined ? 'ASC_STRIPE_MOCK_URL not set — run the contract service' : false;
const MOCK_KEY = 'sk_test_stripemock';
if (MOCK_URL !== undefined && new URL(MOCK_URL).hostname.endsWith('stripe.com')) {
  throw new Error(`ASC_STRIPE_MOCK_URL points at ${new URL(MOCK_URL).hostname}: this suite only ever talks to stripe-mock`);
}

// --- helpers ------------------------------------------------------------------

/** Boot the real app with the double behind the real client. */
const withLoopApp = (double, fn) =>
  withServer(
    configFor({ webhookSecret: SECRET }),
    fn,
    { stripe: createStripeClient({ apiKey: KEY, transport: double.transport }) },
  );

const form = (fields) => new URLSearchParams(fields).toString();

/** One request to the app. Never follows redirects: the Location header IS
 *  the contract, asserted without dereferencing it (plan §3.8). */
async function call(base, method, path, { body, headers = {}, cookie = null } = {}) {
  const h = { ...headers };
  if (cookie !== null) h.cookie = `${COOKIE_NAME}=${cookie}`;
  if (method === 'POST') {
    h.origin = base;
    h['content-type'] ??= 'application/x-www-form-urlencoded';
  }
  const res = await fetch(`${base}${path}`, { method, headers: h, body, redirect: 'manual' });
  return {
    status: res.status,
    location: res.headers.get('location'),
    setCookie: res.headers.get('set-cookie'),
    body: await res.text(),
  };
}

/** Carry signed bytes to the receiver. Authenticated by signature, not session. */
const deliver = (base, signed) =>
  call(base, 'POST', '/webhooks/stripe', {
    body: signed.payload,
    headers: { 'content-type': 'application/json', 'stripe-signature': signed.header },
  });

/** Prefix every assertion message with the step, so a red names it. */
const step = (n, title) => (msg) => `step ${n} (${title}): ${msg}`;

const itemFields = (items) => {
  const out = {};
  items.forEach((item, index) => {
    out[`lineItems[${index}][description]`] = item.description;
    out[`lineItems[${index}][quantity]`] = String(item.quantity);
    out[`lineItems[${index}][unitAmountMinor]`] = String(item.unitAmountMinor);
  });
  return out;
};

const count = (haystack, needle) => haystack.split(needle).length - 1;
const pathsOf = (calls) => calls.map((c) => `${c.method} ${c.path}`);

/** Seed what E2–E5 start from: a freelancer with a double-created account
 *  (ready or not), a client and a two-item draft — through repos, the house
 *  pattern, so their red sets stay narrow (plan §6). */
function seed(repos, double, { ready }) {
  const freelancer = repos.freelancers.create({ email: FREELANCER.email, displayName: FREELANCER.displayName });
  const account = double.createAccount();
  repos.connectedAccounts.create({ freelancerId: freelancer.id, stripeAccountId: account.id });
  if (ready) {
    const completed = double.completeOnboarding(account.id);
    repos.connectedAccounts.updateReadiness(account.id, readinessFromAccount(completed, READY_AT));
  }
  const client = repos.clients.create(freelancer.id, CLIENT);
  const draft = repos.invoices.createDraft(freelancer.id, { clientId: client.id, daysUntilDue: DAYS_UNTIL_DUE, lineItems: ITEMS });
  return { freelancer, account, client, draft, cookie: seedSession(repos, freelancer.id).token };
}

const finalizePath = (id) => `/invoices/${encodeURIComponent(id)}/finalize`;

// --- E0 -------------------------------------------------------------------------

test('E0 (STRIPE DOUBLE): the double\'s endpoint table is exactly the custody allowlist', () => {
  const double = createStripeDouble({ webhookSecret: SECRET });
  // Cardinality FIRST: nine rows, then the same set.
  assert.equal(double.handled.length, 9, `the double handles ${double.handled.length} endpoints, expected 9`);
  assert.equal(ALLOWLIST_KEYS.length, 9, `ALLOWED_ENDPOINTS has ${ALLOWLIST_KEYS.length} rows, expected 9`);
  assert.deepEqual([...double.handled].sort(), [...ALLOWLIST_KEYS].sort());
  assert.equal(double.STRIPE_DOUBLE_CLAIM, STRIPE_DOUBLE_CLAIM);
});

// --- E1: the loop ---------------------------------------------------------------

test('E1 (STRIPE DOUBLE): the loop, end to end, over the API — the twelve steps', async () => {
  const double = createStripeDouble({ webhookSecret: SECRET });
  await withLoopApp(double, async (base, app, { repos }) => {
    // AC-2 — step 1: sign up; step 2: session.
    let at = step(1, 'sign up');
    const signup = await call(base, 'POST', '/signup', { body: form(FREELANCER) });
    assert.equal(signup.status, 303, at(`status ${signup.status}: ${signup.body}`));
    assert.equal(signup.location, '/', at('Location'));
    const match = new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`).exec(signup.setCookie ?? '');
    assert.ok(match, at(`Set-Cookie carries ${COOKIE_NAME}: ${signup.setCookie}`));
    const cookie = match[1];
    assert.match(signup.setCookie, /;\s*HttpOnly/i, at('HttpOnly'));
    assert.match(signup.setCookie, /;\s*SameSite=Lax/i, at('SameSite=Lax'));
    const freelancerId = repos.freelancers.findByEmail(FREELANCER.email).id;

    // Route-table fact at rebase (plan §9): on master `GET /` behind the
    // boundary is the interim 303 to /connect-stripe (routes/pages.js, until
    // AS-48's dashboard replaces it) — not the 200 plan AC-2 was written
    // against. The property is the same: with the cookie the boundary lets the
    // request through; without it the boundary sends it to sign in.
    at = step(2, 'session');
    const withCookie = await call(base, 'GET', '/', { cookie });
    assert.equal(withCookie.status, 303, at(`with the cookie: ${withCookie.status}`));
    assert.equal(withCookie.location, '/connect-stripe', at('with the cookie: past the boundary, to the interim landing'));
    const withoutCookie = await call(base, 'GET', '/');
    assert.equal(withoutCookie.status, 303, at('without a cookie'));
    assert.match(withoutCookie.location ?? '', /^\/signin(\?|$)/, at(`without a cookie: Location ${withoutCookie.location}`));

    // AC-3 — step 3: connect start.
    at = step(3, 'connect start');
    const start = await call(base, 'POST', '/connect-stripe/start', { cookie });
    assert.equal(start.status, 303, at(`status ${start.status}: ${start.body}`));
    assert.equal(double.state.accounts.size, 1, at('the double holds exactly one account'));
    const acct = [...double.state.accounts.keys()][0];
    assert.equal(start.location, `https://onboarding.stripe-double.test/${acct}`, at('Location is the double\'s link URL'));
    assert.equal(double.state.accounts.get(acct).account.charges_enabled, false, at('not ready at the double'));
    let row = repos.connectedAccounts.getByFreelancer(freelancerId);
    assert.equal(row?.stripeAccountId, acct, at('the connected_accounts row names the acct_'));
    assert.equal(row.ready, false, at('row ready'));
    assert.deepEqual(pathsOf(double.calls), ['POST /v1/accounts', 'POST /v1/account_links'], at('two calls'));
    for (const c of double.calls) assert.equal(c.headers['stripe-account'], undefined, at(`${c.path} is platform-scope`));

    // AC-4 — step 4: return, not trusted.
    at = step(4, 'connect return');
    const ret = await call(base, 'GET', '/connect-stripe/return', { cookie });
    assert.equal(ret.status, 303, at(`status ${ret.status}: ${ret.body}`));
    assert.equal(ret.location, '/connect-stripe', at('Location'));
    assert.deepEqual(pathsOf(double.calls).slice(2), [`GET /v1/accounts/${acct}`], at('one account read'));
    row = repos.connectedAccounts.getByFreelancer(freelancerId);
    assert.equal(row.ready, false, at('still not ready: the double has not completed onboarding'));

    // AC-5 — step 5: readiness by push, then by pull.
    at = step(5, 'readiness');
    double.completeOnboarding(acct);
    const readyEvent = double.events.accountUpdated(acct);
    const readiness = await deliver(base, readyEvent);
    assert.equal(readiness.status, 200, at(`status ${readiness.status}: ${readiness.body}`));
    assert.equal(readiness.body, 'ok: readiness\n', at('body'));
    row = repos.connectedAccounts.getByFreelancer(freelancerId);
    assert.equal(row.ready, true, at('row ready after the push'));
    assert.equal(row.syncedAt, READY_AT, at('syncedAt is the event\'s created'));
    const ret2 = await call(base, 'GET', '/connect-stripe/return', { cookie });
    assert.equal(ret2.status, 303, at('second return'));
    row = repos.connectedAccounts.getByFreelancer(freelancerId);
    assert.equal(row.ready, true, at('still ready by pull'));
    assert.equal(pathsOf(double.calls).filter((p) => p === `GET /v1/accounts/${acct}`).length, 2, at('two account reads in total'));

    // AC-6 — step 6: client.
    at = step(6, 'client');
    const clientRes = await call(base, 'POST', '/clients', { cookie, body: form({ ...CLIENT, next: '/' }) });
    assert.equal(clientRes.status, 303, at(`status ${clientRes.status}: ${clientRes.body}`));
    assert.match(clientRes.location ?? '', /^\/\?clientId=/, at('Location'));
    const clientId = new URL(clientRes.location, base).searchParams.get('clientId');
    assert.ok(repos.clients.getById(freelancerId, clientId), at('client row exists'));

    // AC-7 — step 7: contract.
    at = step(7, 'contract');
    const contractRes = await call(base, 'POST', '/contracts', { cookie, body: form({ clientId, ...CONTRACT }) });
    assert.equal(contractRes.status, 303, at(`status ${contractRes.status}: ${contractRes.body}`));
    assert.match(contractRes.location ?? '', /^\/contracts\/[^/]+$/, at('Location'));
    const contractId = decodeURIComponent(contractRes.location.slice('/contracts/'.length));
    const contract = repos.contracts.getById(freelancerId, contractId);
    assert.equal(count(contract.renderedHtml, CONTRACT.projectDescription), 1, at('project description appears once'));
    // The demo's fixed description names the client too ("…the Northwind Studio
    // marketing website…"), so the name occurs once as the template's slot PLUS
    // once inside the description: measured 2 at implementation, asserted as
    // "once outside the description" so the count says what it means.
    const nameInsideDescription = count(CONTRACT.projectDescription, CLIENT.name);
    assert.equal(nameInsideDescription, 1, at('the fixed description names the client once'));
    assert.equal(count(contract.renderedHtml, CLIENT.name) - nameInsideDescription, 1, at('client name appears once outside the description — the parties clause'));

    // AC-8 — step 8: draft, local only.
    at = step(8, 'draft');
    const before8 = double.calls.length;
    const draftRes = await call(base, 'POST', '/invoices', {
      cookie,
      body: form({ clientId, daysUntilDue: String(DAYS_UNTIL_DUE), currency: 'usd', ...itemFields(ITEMS) }),
    });
    assert.equal(draftRes.status, 303, at(`status ${draftRes.status}: ${draftRes.body}`));
    assert.match(draftRes.location ?? '', /^\/invoices\/[^/]+\/edit$/, at('Location'));
    const invoiceId = decodeURIComponent(draftRes.location.slice('/invoices/'.length, -'/edit'.length));
    assert.equal(double.calls.length - before8, 0, at('zero Stripe calls'));
    let mirror = repos.invoices.getById(freelancerId, invoiceId);
    assert.equal(mirror.status, 'draft', at('mirror status'));
    assert.equal(mirror.stripeInvoiceId, null, at('no stripeInvoiceId yet'));

    // AC-9 — step 9: finalize.
    at = step(9, 'finalize');
    const before9 = double.calls.length;
    const finalizeRes = await call(base, 'POST', finalizePath(invoiceId), { cookie });
    assert.equal(finalizeRes.status, 303, at(`status ${finalizeRes.status}: ${finalizeRes.body}`));
    assert.equal(finalizeRes.location, `/invoices/${encodeURIComponent(invoiceId)}`, at('Location'));
    const finalizeCalls = double.calls.slice(before9);
    assert.equal(double.state.invoices.size, 1, at('the double holds one invoice'));
    const stripeInvoiceId = [...double.state.invoices.keys()][0];
    assert.deepEqual(pathsOf(finalizeCalls), [
      'POST /v1/customers',
      'POST /v1/invoices',
      'POST /v1/invoiceitems',
      'POST /v1/invoiceitems',
      `POST /v1/invoices/${stripeInvoiceId}/finalize`,
    ], at('five connected calls, in order'));
    for (const c of finalizeCalls) assert.equal(c.headers['stripe-account'], acct, at(`${c.path} carries stripe-account`));
    assert.equal(double.state.customers.size, 1, at('one customer'));
    assert.equal(double.state.items.size, 2, at('two items'));
    const held = double.state.invoices.get(stripeInvoiceId).invoice;
    assert.equal(held.status, 'open', at('the double\'s invoice is open'));
    assert.equal(held.amount_due, ITEMS_TOTAL, at('the double accumulated amount_due'));
    mirror = repos.invoices.getById(freelancerId, invoiceId);
    assert.equal(mirror.status, 'open', at('mirror status'));
    assert.equal(mirror.stripeInvoiceId, stripeInvoiceId, at('mirror stripeInvoiceId'));
    assert.equal(mirror.amountDueMinor, ITEMS_TOTAL, at('amountDueMinor'));
    assert.equal(mirror.amountDueMinor, mirror.totalMinor, at('reconciled: amountDueMinor equals totalMinor'));
    assert.notEqual(mirror.hostedInvoiceUrl, null, at('hostedInvoiceUrl'));
    assert.equal(mirror.finalizedAt, FINALIZED_AT, at('finalizedAt'));
    assert.equal(mirror.sentAt, null, at('sentAt null'));
    assert.equal(mirror.paidAt, null, at('paidAt null'));

    // AC-10 — step 10: send — exactly one call, steps 3–4 skipped.
    at = step(10, 'send');
    const before10 = double.calls.length;
    const sentBefore = new Date().toISOString();
    const sendRes = await call(base, 'POST', `/invoices/${encodeURIComponent(invoiceId)}/send`, { cookie });
    assert.equal(sendRes.status, 303, at(`status ${sendRes.status}: ${sendRes.body}`));
    assert.deepEqual(pathsOf(double.calls.slice(before10)), [`POST /v1/invoices/${stripeInvoiceId}/send`], at('exactly one call'));
    mirror = repos.invoices.getById(freelancerId, invoiceId);
    assert.notEqual(mirror.sentAt, null, at('sentAt recorded'));
    assert.ok(mirror.sentAt >= sentBefore, at(`sentAt ${mirror.sentAt} is not before ${sentBefore}`));
    const sentAtOurs = mirror.sentAt;
    const sentEvent = double.events.invoiceSent(stripeInvoiceId);
    const sentDelivery = await deliver(base, sentEvent);
    assert.equal(sentDelivery.status, 200, at(`invoice.sent: ${sentDelivery.status} ${sentDelivery.body}`));
    assert.equal(sentDelivery.body, 'ok: fields\n', at('invoice.sent body'));
    mirror = repos.invoices.getById(freelancerId, invoiceId);
    assert.equal(mirror.sentAt, sentAtOurs, at('sentAt UNCHANGED by the event — the earlier record stands'));

    // AC-11 — step 11: paid.
    at = step(11, 'paid');
    double.pay(stripeInvoiceId);
    const paidEvent = double.events.invoicePaid(stripeInvoiceId);
    const paid = await deliver(base, paidEvent);
    assert.equal(paid.status, 200, at(`status ${paid.status}: ${paid.body}`));
    assert.equal(paid.body, 'ok: applied\n', at('body'));
    mirror = repos.invoices.getById(freelancerId, invoiceId);
    assert.equal(mirror.status, 'paid', at('mirror status'));
    assert.equal(mirror.amountPaidMinor, ITEMS_TOTAL, at('amountPaidMinor'));
    assert.equal(mirror.paidAt, PAID_AT, at('paidAt'));
    assert.equal(repos.stripeEvents.has(paidEvent.event.id), true, at('the event id is recorded'));
    const afterPaid = mirror;

    // AC-12 — step 11b: redelivery.
    at = step('11b', 'paid, redelivered');
    const redelivery = await deliver(base, double.events.resign(paidEvent.event));
    assert.equal(redelivery.status, 200, at(`status ${redelivery.status}: ${redelivery.body}`));
    assert.equal(redelivery.body, 'ok: duplicate\n', at('body'));
    mirror = repos.invoices.getById(freelancerId, invoiceId);
    assert.deepEqual(mirror, afterPaid, at('the row is byte-identical, updatedAt included'));
    assert.equal(repos.stripeEvents.has(paidEvent.event.id), true, at('still recorded once'));

    // AC-13 — step 12: out of order — finalized arrives after paid.
    at = step(12, 'out-of-order finalized');
    const lateFinalized = double.events.invoiceFinalized(stripeInvoiceId);
    assert.equal(lateFinalized.event.data.object.status, 'open', at('the snapshot still says open'));
    const stale = await deliver(base, lateFinalized);
    assert.equal(stale.status, 200, at(`status ${stale.status}: ${stale.body}`));
    assert.equal(stale.body, 'ok: stale\n', at('body'));
    mirror = repos.invoices.getById(freelancerId, invoiceId);
    assert.equal(mirror.status, 'paid', at('mirror still paid'));

    // AC-14 — the whole run, on the wire.
    at = step('all', 'the whole run');
    assert.equal(double.calls.length, 10, at(`ten calls, got ${double.calls.length}: ${pathsOf(double.calls).join(', ')}`));
    const banned = new Set(FORBIDDEN_PARAMS.map((r) => r.name));
    assert.equal(banned.size, 10, at('FORBIDDEN_PARAMS has ten rows'));
    const platformCalls = double.calls.filter((c) => c.headers['stripe-account'] === undefined);
    const connectedCalls = double.calls.filter((c) => c.headers['stripe-account'] !== undefined);
    assert.equal(platformCalls.length, 4, at('four platform calls'));
    assert.equal(connectedCalls.length, 6, at('six connected calls'));
    for (const c of connectedCalls) assert.equal(c.headers['stripe-account'], acct, at(`${c.path} names the one acct_`));
    for (const c of double.calls) {
      assert.equal(c.url.origin, STRIPE_ORIGIN, at(`${c.path} origin — the client was built on the default base URL`));
      for (const source of [new URLSearchParams(c.body ?? ''), c.url.searchParams]) {
        for (const key of source.keys()) {
          const hit = key.split(/[\[\].]+/).filter(Boolean).map((s) => s.toLowerCase()).find((s) => banned.has(s));
          assert.equal(hit, undefined, at(`${c.path} carries banned parameter ${key}`));
        }
      }
    }
  });
});

// --- E2: transient failure mid-finalize ------------------------------------------

test('E2 (STRIPE DOUBLE): a transient Stripe failure mid-finalize resumes without duplicates', async () => {
  const double = createStripeDouble({ webhookSecret: SECRET });
  await withLoopApp(double, async (base, app, { repos }) => {
    const { freelancer, draft, cookie } = seed(repos, double, { ready: true });
    double.failNth('POST', '/v1/invoiceitems', 2);

    const first = await call(base, 'POST', finalizePath(draft.id), { cookie });
    assert.equal(first.status, 502, `first finalize: ${first.status} ${first.body}`);
    assert.equal(first.body, 'StripeApiError: push-line-item\n');
    let mirror = repos.invoices.getById(freelancer.id, draft.id);
    assert.equal(mirror.status, 'draft');
    assert.notEqual(mirror.stripeInvoiceId, null, 'the invoice is attached: steps 1–2 landed');
    assert.equal(double.state.customers.size, 1);
    assert.equal(double.state.invoices.size, 1);
    assert.equal(double.state.items.size, 1, 'the second push failed');

    const before = double.calls.length;
    const second = await call(base, 'POST', finalizePath(draft.id), { cookie });
    assert.equal(second.status, 303, `second finalize: ${second.status} ${second.body}`);
    const paths = pathsOf(double.calls.slice(before));
    assert.equal(paths.length, 3, `three calls on the retry, got ${paths.join(', ')}`);
    assert.deepEqual(paths, ['POST /v1/invoiceitems', 'POST /v1/invoiceitems', `POST /v1/invoices/${mirror.stripeInvoiceId}/finalize`]);
    assert.equal(double.stats.replayHits, 1, 'the first item replayed through the idempotency window');
    assert.equal(double.state.customers.size, 1);
    assert.equal(double.state.invoices.size, 1);
    assert.equal(double.state.items.size, 2, 'no duplicate item');
    const held = double.state.invoices.get(mirror.stripeInvoiceId).invoice;
    assert.equal(held.status, 'open');
    assert.equal(held.amount_due, ITEMS_TOTAL);
    mirror = repos.invoices.getById(freelancer.id, draft.id);
    assert.equal(mirror.status, 'open');
    assert.equal(mirror.amountDueMinor, ITEMS_TOTAL);
  });
});

// --- E3: signature ----------------------------------------------------------------

test('E3 (STRIPE DOUBLE): a tampered signature is refused and applies nothing; the untampered one applies', async () => {
  const double = createStripeDouble({ webhookSecret: SECRET });
  await withLoopApp(double, async (base, app, { repos }) => {
    const { freelancer, draft, cookie } = seed(repos, double, { ready: true });
    const finalize = await call(base, 'POST', finalizePath(draft.id), { cookie });
    assert.equal(finalize.status, 303, `finalize: ${finalize.status} ${finalize.body}`);
    const { stripeInvoiceId } = repos.invoices.getById(freelancer.id, draft.id);
    double.pay(stripeInvoiceId);
    const signed = double.events.invoicePaid(stripeInvoiceId);

    // One hex character of v1 flipped.
    const [, v1] = /v1=([0-9a-f]{64})$/.exec(signed.header);
    const flipped = (v1[0] === '0' ? '1' : '0') + v1.slice(1);
    const tampered = await deliver(base, { payload: signed.payload, header: signed.header.replace(v1, flipped) });
    assert.equal(tampered.status, 400, `tampered: ${tampered.status} ${tampered.body}`);
    assert.equal(tampered.body, 'SignatureError: verify-signature\n');
    assert.equal(repos.invoices.getById(freelancer.id, draft.id).status, 'open', 'nothing applied');
    assert.equal(repos.stripeEvents.has(signed.event.id), false, 'nothing recorded');

    // The same bytes signed by a double holding a different secret (F10b).
    const other = createStripeDouble({ webhookSecret: 'whsec_other' });
    const wrongSecret = await deliver(base, other.events.resign(signed.event));
    assert.equal(wrongSecret.status, 400, `wrong secret: ${wrongSecret.status} ${wrongSecret.body}`);
    assert.equal(repos.invoices.getById(freelancer.id, draft.id).status, 'open');

    const genuine = await deliver(base, signed);
    assert.equal(genuine.status, 200, `genuine: ${genuine.status} ${genuine.body}`);
    assert.equal(genuine.body, 'ok: applied\n');
    assert.equal(repos.invoices.getById(freelancer.id, draft.id).status, 'paid');
  });
});

// --- E4: the readiness gate inside the loop -------------------------------------------

test('E4 (STRIPE DOUBLE): the readiness gate holds inside the loop', async () => {
  const double = createStripeDouble({ webhookSecret: SECRET });
  await withLoopApp(double, async (base, app, { repos }) => {
    const { freelancer, account, draft, cookie } = seed(repos, double, { ready: false });
    const refused = await call(base, 'POST', finalizePath(draft.id), { cookie });
    assert.equal(refused.status, 403, `not ready: ${refused.status} ${refused.body}`);
    assert.equal(refused.body, 'AccountNotReadyError: not-ready\n');
    assert.equal(double.calls.filter((c) => c.headers['stripe-account'] !== undefined).length, 0, 'zero connected-scope calls');
    assert.equal(double.calls.length, 0, 'zero calls at all');

    double.completeOnboarding(account.id);
    const ready = await deliver(base, double.events.accountUpdated(account.id));
    assert.equal(ready.status, 200, `readiness: ${ready.status} ${ready.body}`);
    assert.equal(ready.body, 'ok: readiness\n');

    const allowed = await call(base, 'POST', finalizePath(draft.id), { cookie });
    assert.equal(allowed.status, 303, `after readiness: ${allowed.status} ${allowed.body}`);
    assert.equal(repos.invoices.getById(freelancer.id, draft.id).status, 'open');
  });
});

// --- E5: the double's shapes never invent a key the spec lacks ---------------------

test('E5 (STRIPE DOUBLE vs STRIPE-MOCK): every object the double emits is a key-subset of the mock\'s spec-derived fixture', { skip: SKIP }, async (t) => {
  const mock = createStripeClient({ apiKey: MOCK_KEY, baseUrl: MOCK_URL, transport: fetchTransport });
  const double = createStripeDouble({ webhookSecret: SECRET });
  const model = createStripeClient({ apiKey: KEY, transport: double.transport });
  const ACCOUNT = 'acct_stripemock';

  // The K-case shapes, verbatim (test/stripe-mock.test.js).
  const mockAccount = (await mock.request({ method: 'POST', path: '/v1/accounts', platform: true, params: {} })).data;
  const mockCustomer = (await mock.request({
    method: 'POST', path: '/v1/customers', account: ACCOUNT,
    params: { email: 'client@example.test', name: 'A Client', metadata: { source: 'contract-test', freelancer: 'fl_1' } },
  })).data;
  const mockInvoice = (await mock.request({
    method: 'POST', path: '/v1/invoices', account: ACCOUNT,
    params: { customer: 'cus_stripemock', collection_method: 'send_invoice', days_until_due: 30, auto_advance: false },
  })).data;

  const acct = (await model.request({ method: 'POST', path: '/v1/accounts', platform: true, params: {} })).data;
  double.completeOnboarding(acct.id);
  const customer = (await model.request({
    method: 'POST', path: '/v1/customers', account: acct.id,
    params: { email: 'client@example.test', name: 'A Client', metadata: { source: 'contract-test', freelancer: 'fl_1' } },
  })).data;
  const invoice = (await model.request({
    method: 'POST', path: '/v1/invoices', account: acct.id,
    params: { customer: customer.id, collection_method: 'send_invoice', days_until_due: 30, currency: 'usd', auto_advance: false },
  })).data;
  await model.request({ method: 'POST', path: '/v1/invoiceitems', account: acct.id, params: { customer: customer.id, invoice: invoice.id, currency: 'usd', amount: 100 } });
  const finalized = (await model.request({ method: 'POST', path: `/v1/invoices/${invoice.id}/finalize`, account: acct.id, params: { auto_advance: false } })).data;
  const paid = double.pay(invoice.id);

  // Cardinality FIRST: the mock's invoice fixture is a real spec-derived object.
  const mockInvoiceKeys = Object.keys(mockInvoice);
  t.diagnostic(`stripe-mock invoice fixture carries ${mockInvoiceKeys.length} keys; account ${Object.keys(mockAccount).length}; customer ${Object.keys(mockCustomer).length}`);
  assert.ok(mockInvoiceKeys.length >= 30, `the mock's invoice fixture has ${mockInvoiceKeys.length} keys — expected at least 30 (measured 75 on 2026-09-12; account 20, customer 22)`);

  const subset = (ours, theirs, what) => {
    const missing = Object.keys(ours).filter((k) => !Object.hasOwn(theirs, k));
    assert.deepEqual(missing, [], `${what}: the double emits keys the mock's fixture lacks — ${missing.join(', ')}`);
  };
  subset(acct, mockAccount, 'account');
  subset(double.completeOnboarding(acct.id), mockAccount, 'account (ready)');
  subset(customer, mockCustomer, 'customer');
  for (const [label, object] of [['invoice (draft)', invoice], ['invoice (open)', finalized], ['invoice (paid)', paid]]) {
    subset(object, mockInvoice, label);
    subset(object.status_transitions, mockInvoice.status_transitions, `${label}.status_transitions`);
  }
  const statuses = new Set([invoice.status, finalized.status, paid.status]);
  for (const status of statuses) assert.ok(['draft', 'open', 'paid'].includes(status), `the double emitted status ${status}`);
});
