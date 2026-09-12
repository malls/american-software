// test/connect.test.js — chain link 2's server half (AS-41, plan §5.3).
//
// R-cases run OFFLINE and still exercise the real thing: the fixture transport
// sits BEHIND the full client pipeline (validate → build → guard → requireKey →
// sign → transport → interpret), so the custody guard runs on every call, and
// the routes are driven over real HTTP through withServer. The transport
// records every wire request it sees, so assertions read the actual bytes.
//
// M-cases ({ skip: SKIP }) drive the SAME routes against stripe-mock — Stripe's
// own request-shape validator. They report as skipped (never passed) in the
// `test` service (network_mode: none, no ASC_STRIPE_MOCK_URL) and run in the
// `contract` service. Same self-skip pattern and not-stripe.com refusal as
// stripe-mock.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app.js';
import { createStripeClient } from '../lib/stripe/client.js';
import { readinessFromAccount } from '../lib/connect/readiness.js';
// R2 only: the service-level guard whose HTTP path AS-40 made unreachable.
import { createOnboarding } from '../lib/connect/onboarding.js';
import { NotFoundError } from '../lib/db/database.js';
import { createRepositories, prepareDatabase } from '../lib/db/database.js';
import { configFor, freshDbPath, seedSession, signedInHeaders, withServer } from './helpers/server.js';

// Not key-shaped on purpose — the stripe-client.test.js convention.
const KEY = 'unit-test-placeholder-key';
const TS = '2026-09-02T10:00:00.000Z';
const ACCT = 'acct_fixture1';
const LINK_URL = 'https://onboarding.example.test/session/fixture-1';

// --- fixtures -----------------------------------------------------------------

/** A Stripe account object mid-onboarding: details in, requirements still due. */
function account(overrides = {}) {
  return {
    id: ACCT,
    object: 'account',
    charges_enabled: false,
    details_submitted: true,
    payouts_enabled: false,
    requirements: { currently_due: ['external_account', 'tos_acceptance.date'], disabled_reason: 'requirements.past_due' },
    ...overrides,
  };
}

const readyAccount = () => account({
  charges_enabled: true,
  details_submitted: true,
  payouts_enabled: true,
  requirements: { currently_due: [], disabled_reason: null },
});

function json(data, status = 200) {
  return { status, headers: { 'request-id': 'req_fixture' }, body: JSON.stringify(data) };
}

/** Canned Stripe behind the REAL pipeline; records every request it sees.
 *  `intercept(record)` may return a reply to override a canned one, or a
 *  side-effect-only undefined (the R12 race hook). */
function fixtureTransport({ accountBody = account(), linkUrl = LINK_URL, intercept } = {}) {
  const calls = [];
  const transport = async (signed) => {
    const record = { method: signed.method, path: signed.url.pathname, body: signed.body, headers: signed.headers };
    calls.push(record);
    if (intercept !== undefined) {
      const reply = await intercept(record);
      if (reply !== undefined) return reply;
    }
    if (record.method === 'POST' && record.path === '/v1/accounts') return json(accountBody);
    if (record.method === 'POST' && record.path === '/v1/account_links') {
      return json({ object: 'account_link', created: 1756770000, expires_at: 1756770300, url: linkUrl });
    }
    if (record.method === 'GET' && record.path.startsWith('/v1/accounts/')) return json(accountBody);
    throw new Error(`fixture transport: unexpected ${record.method} ${record.path}`);
  };
  return { transport, calls };
}

/** withServer + a fixture-transport client + one seeded freelancer. */
async function withConnectApp({ fixture = {}, apiKey = KEY, appBaseUrl } = {}, fn) {
  const { transport, calls } = fixtureTransport(fixture);
  const stripe = createStripeClient({ apiKey, transport });
  const config = configFor(appBaseUrl === undefined ? {} : { appBaseUrl });
  await withServer(config, async (base, app, deps) => {
    const freelancer = deps.repos.freelancers.create({ email: 'f@example.test', displayName: 'Freda Lancer' });
    const { cookie } = seedSession(deps.repos, freelancer.id);
    auth.headers = signedInHeaders(base, cookie);
    await fn({ base, repos: deps.repos, freelancer, calls, cookie });
  }, { stripe });
}

/** THE SEEDED FREELANCER'S SESSION (AS-40). These routes sit below the auth
 *  boundary and none of the cases here are about signing in, so the helper
 *  seeds a session ROW and every request carries its cookie (plus the Origin
 *  the same-origin check wants on unsafe methods). Set by withConnectApp and
 *  withMockApp before each case; node --test runs a file's top-level tests
 *  sequentially, so one holder is enough and no case can see another's. */
const auth = { headers: {} };

const post = (url) => fetch(url, { method: 'POST', redirect: 'manual', headers: auth.headers });
const get = (url) => fetch(url, { redirect: 'manual', headers: auth.headers });

// --- composition (plan §3.7, AC 10) --------------------------------------------

test('createApp refuses a missing deps pair with a TypeError', () => {
  const config = configFor();
  const stripe = createStripeClient({ apiKey: null, transport: async () => json({}) });
  const { db } = prepareDatabase(config);
  try {
    const repos = createRepositories(db);
    assert.throws(() => createApp(config), TypeError);
    assert.throws(() => createApp(config, {}), TypeError);
    assert.throws(() => createApp(config, { repos }), TypeError, 'stripe missing');
    assert.throws(() => createApp(config, { stripe }), TypeError, 'repos missing');
    assert.ok(createApp(config, { repos, stripe }), 'both present constructs');
  } finally {
    db.close();
  }
});

// --- R1: the mapper -------------------------------------------------------------

test('R1: the readiness mapper — exact mapping, requirements tolerance, boolean strictness, the truth table through the AS-39 row, and the account.updated shape', () => {
  // Exact field mapping (§3.4).
  assert.deepEqual(readinessFromAccount(account(), TS), {
    chargesEnabled: false,
    detailsSubmitted: true,
    payoutsEnabled: false,
    requirementsCurrentlyDue: ['external_account', 'tos_acceptance.date'],
    requirementsDisabledReason: 'requirements.past_due',
    syncedAt: TS,
  });

  // Tolerant on requirements: an absent hash, a null hash, and null fields all
  // read as nothing outstanding and no reason (§9 Q3) — the booleans decide.
  const bare = { id: ACCT, object: 'account', charges_enabled: false, details_submitted: false, payouts_enabled: false };
  for (const view of [bare, { ...bare, requirements: null }, { ...bare, requirements: { currently_due: null, disabled_reason: null } }]) {
    const patch = readinessFromAccount(view, TS);
    assert.deepEqual(patch.requirementsCurrentlyDue, []);
    assert.equal(patch.requirementsDisabledReason, null);
  }

  // Strict on the three booleans: a non-boolean is a TypeError (the route
  // surfaces it as 502), never a guess.
  for (const broken of [
    account({ charges_enabled: 'false' }),
    account({ charges_enabled: 1 }),
    account({ charges_enabled: undefined }),
    account({ details_submitted: 'yes' }),
    account({ payouts_enabled: null }),
    null,
    'account',
    ['account'],
  ]) {
    assert.throws(() => readinessFromAccount(broken, TS), TypeError);
  }

  // The 4-combination truth table, read back through the AS-39 row so `ready`
  // comes from the ONE derivation in lib/db — this test defines no second one.
  const { db } = prepareDatabase({ dbPath: freshDbPath() });
  try {
    const repos = createRepositories(db);
    const f = repos.freelancers.create({ email: 'truth@example.test', displayName: 'Truth Table' });
    repos.connectedAccounts.create({ freelancerId: f.id, stripeAccountId: ACCT });
    const combos = [
      [true, [], true],
      [true, ['external_account'], false],
      [false, [], false],
      [false, ['external_account'], false],
    ];
    for (const [charges, due, expectReady] of combos) {
      const row = repos.connectedAccounts.updateReadiness(
        ACCT,
        readinessFromAccount(account({ charges_enabled: charges, requirements: { currently_due: due, disabled_reason: null } }), TS),
      );
      assert.equal(row.ready, expectReady, `charges=${charges} due=${JSON.stringify(due)}`);
      assert.deepEqual(row.requirementsCurrentlyDue, due);
      assert.equal(row.syncedAt, TS);
    }

    // The same mapper applied to an account.updated event's data.object —
    // AS-44's reuse proven before AS-44 exists (§3.4).
    const event = { id: 'evt_fixture1', object: 'event', type: 'account.updated', data: { object: readyAccount() } };
    assert.deepEqual(readinessFromAccount(event.data.object, TS), readinessFromAccount(readyAccount(), TS));
    const row = repos.connectedAccounts.updateReadiness(ACCT, readinessFromAccount(event.data.object, TS));
    assert.equal(row.ready, true);
  } finally {
    db.close();
  }
});

// --- R2–R13: the routes, offline -------------------------------------------------

test('R2: start for a freelancer who does not exist is a NotFoundError from the service, zero transport calls', async () => {
  // AS-40 CHANGED WHAT THIS CAN ASSERT, and the change is the point. Identity
  // comes from the session now, and sessions.freelancer_id is a foreign key, so
  // acting as a freelancer who does not exist is UNREACHABLE over HTTP —
  // resolveSession additionally deletes a session whose freelancer is gone. The
  // service's guard still exists and is still what makes statusFor's
  // NotFoundError branch correct, so it is asserted where it now lives; R8
  // keeps the reachable HTTP 404 (a signed-in freelancer with no row).
  const { transport, calls } = fixtureTransport();
  const { db } = prepareDatabase({ dbPath: freshDbPath() });
  try {
    const onboarding = createOnboarding({
      appBaseUrl: 'http://127.0.0.1:8348',
      repos: createRepositories(db),
      stripe: createStripeClient({ apiKey: KEY, transport }),
    });
    await assert.rejects(() => onboarding.start('00000000-0000-4000-8000-000000000000'), NotFoundError);
    assert.equal(calls.length, 0);
  } finally {
    db.close();
  }
});

test('R3: start with no row — bare create with the stable idempotency key, readiness seeded from the create response, the four-parameter mint, 303 to the link', async () => {
  // A NON-DEFAULT base proves the URLs derive from config.appBaseUrl: a
  // hardcoded default would pass under configFor() and fail here.
  const APP_BASE = 'https://d1.example.test';
  await withConnectApp({ appBaseUrl: APP_BASE }, async ({ base, repos, freelancer, calls }) => {
    const res = await post(`${base}/connect-stripe/start`);
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), LINK_URL);

    assert.equal(calls.length, 2, 'exactly two Stripe calls: create, then mint');
    const [create, mint] = calls;
    assert.equal(create.method, 'POST');
    assert.equal(create.path, '/v1/accounts');
    assert.equal(create.body, '', 'EMPTY parameter set — no type, no controller[...]: the Standard-equivalent defaults');
    assert.equal(create.headers['idempotency-key'], `acct-create-${freelancer.id}`);
    assert.equal(create.headers['stripe-account'], undefined, 'platform call: no Stripe-Account header');

    assert.equal(mint.method, 'POST');
    assert.equal(mint.path, '/v1/account_links');
    const params = new URLSearchParams(mint.body);
    assert.deepEqual([...params.keys()].sort(), ['account', 'refresh_url', 'return_url', 'type'], 'exactly the four parameters K8 validates');
    assert.equal(params.get('account'), ACCT);
    assert.equal(params.get('type'), 'account_onboarding');
    assert.equal(params.get('refresh_url'), `${APP_BASE}/connect-stripe/refresh`);
    assert.equal(params.get('return_url'), `${APP_BASE}/connect-stripe/return`);

    const row = repos.connectedAccounts.getByFreelancer(freelancer.id);
    assert.equal(row.stripeAccountId, ACCT);
    assert.notEqual(row.syncedAt, null, 'seeded from the CREATE RESPONSE: syncedAt non-null from birth (§3.5)');
    assert.equal(row.chargesEnabled, false);
    assert.equal(row.detailsSubmitted, true);
    assert.deepEqual(row.requirementsCurrentlyDue, ['external_account', 'tos_acceptance.date']);
    assert.equal(row.requirementsDisabledReason, 'requirements.past_due');
    assert.equal(row.ready, false);
  });
});

test('R4: start with an existing not-ready row mints only — zero /v1/accounts calls', async () => {
  await withConnectApp({}, async ({ base, repos, freelancer, calls }) => {
    repos.connectedAccounts.create({ freelancerId: freelancer.id, stripeAccountId: ACCT });
    const res = await post(`${base}/connect-stripe/start`);
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), LINK_URL);
    assert.equal(calls.filter((c) => c.path === '/v1/accounts').length, 0, 'no second account, ever');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, '/v1/account_links');
    assert.equal(new URLSearchParams(calls[0].body).get('account'), ACCT);
  });
});

test('R5: start with a ready row short-circuits to the screen — zero transport calls', async () => {
  await withConnectApp({}, async ({ base, repos, freelancer, calls }) => {
    repos.connectedAccounts.create({ freelancerId: freelancer.id, stripeAccountId: ACCT });
    repos.connectedAccounts.updateReadiness(ACCT, readinessFromAccount(readyAccount(), TS));
    const res = await post(`${base}/connect-stripe/start`);
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/connect-stripe');
    assert.equal(calls.length, 0);
  });
});

test('R6: return NEVER trusts the return — a fresh read decides, and a not-ready account stays not-ready', async () => {
  await withConnectApp({}, async ({ base, repos, freelancer, calls }) => {
    repos.connectedAccounts.create({ freelancerId: freelancer.id, stripeAccountId: ACCT });
    const res = await get(`${base}/connect-stripe/return`);
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/connect-stripe');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'GET');
    assert.equal(calls[0].path, `/v1/accounts/${ACCT}`);
    const row = repos.connectedAccounts.getByFreelancer(freelancer.id);
    assert.equal(row.ready, false, 'came back through return_url and is STILL not ready — the read, not the return, decides');
    assert.equal(row.chargesEnabled, false);
    assert.equal(row.detailsSubmitted, true);
    assert.equal(row.payoutsEnabled, false);
    assert.deepEqual(row.requirementsCurrentlyDue, ['external_account', 'tos_acceptance.date']);
    assert.equal(row.requirementsDisabledReason, 'requirements.past_due');
    assert.notEqual(row.syncedAt, null, 'and the snapshot WAS written — not-ready is a recorded fact, not a skipped write');
  });
});

test('R7: return with a ready account flips the row to ready', async () => {
  await withConnectApp({ fixture: { accountBody: readyAccount() } }, async ({ base, repos, freelancer }) => {
    repos.connectedAccounts.create({ freelancerId: freelancer.id, stripeAccountId: ACCT });
    const res = await get(`${base}/connect-stripe/return`);
    assert.equal(res.status, 303);
    const row = repos.connectedAccounts.getByFreelancer(freelancer.id);
    assert.equal(row.ready, true);
    assert.deepEqual(row.requirementsCurrentlyDue, []);
    assert.equal(row.requirementsDisabledReason, null);
  });
});

test('R8: return with no connected-account row is 404 with zero transport calls', async () => {
  // The unknown-freelancer half moved to R2 when AS-40 made it unreachable over
  // HTTP; the no-row half is the reachable 404 and stays here.
  await withConnectApp({}, async ({ base, calls }) => {
    const noRow = await get(`${base}/connect-stripe/return`);
    assert.equal(noRow.status, 404);
    assert.equal(calls.length, 0);
  });
});

test('R9: refresh mints a fresh link for the stored account and writes no readiness; no row is 404', async () => {
  await withConnectApp({}, async ({ base, repos, freelancer, calls }) => {
    repos.connectedAccounts.create({ freelancerId: freelancer.id, stripeAccountId: ACCT });
    repos.connectedAccounts.updateReadiness(ACCT, readinessFromAccount(account(), TS)); // synced, not ready
    const res = await get(`${base}/connect-stripe/refresh`);
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), LINK_URL, 'S2-REFRESH: straight back into the hosted flow, not an error page');
    assert.equal(calls.length, 1, 'one Stripe call — the mint; refresh reads nothing');
    assert.equal(calls[0].path, '/v1/account_links');
    assert.equal(new URLSearchParams(calls[0].body).get('account'), ACCT);
    const row = repos.connectedAccounts.getByFreelancer(freelancer.id);
    assert.equal(row.syncedAt, TS, 'no readiness write: syncedAt untouched');
  });
  await withConnectApp({}, async ({ base, freelancer, calls }) => {
    const res = await get(`${base}/connect-stripe/refresh`);
    assert.equal(res.status, 404);
    assert.equal(calls.length, 0);
  });
});

test('R9b: refresh for an already-ready row short-circuits to the screen — no code path mints a link for a ready account (§9 Q1)', async () => {
  await withConnectApp({}, async ({ base, repos, freelancer, calls }) => {
    repos.connectedAccounts.create({ freelancerId: freelancer.id, stripeAccountId: ACCT });
    repos.connectedAccounts.updateReadiness(ACCT, readinessFromAccount(readyAccount(), TS));
    const res = await get(`${base}/connect-stripe/refresh`);
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/connect-stripe');
    assert.equal(calls.length, 0);
  });
});

test('R10: a Stripe 4xx on account create is 502 naming the step, and NO row is created — Stripe first, row after', async () => {
  const intercept = (record) => {
    if (record.method === 'POST' && record.path === '/v1/accounts') {
      return json({ error: { type: 'invalid_request_error', message: 'synthetic refusal' } }, 400);
    }
    return undefined;
  };
  await withConnectApp({ fixture: { intercept } }, async ({ base, repos, freelancer, calls }) => {
    const res = await post(`${base}/connect-stripe/start`);
    assert.equal(res.status, 502);
    const body = await res.text();
    assert.match(body, /StripeApiError/);
    assert.match(body, /create-account/);
    assert.equal(calls.length, 1, 'the create was attempted and nothing after it');
    assert.equal(repos.connectedAccounts.getByFreelancer(freelancer.id), null, 'no row left behind');
  });
});

test('R11: start with no key configured is 503, zero transport calls — a deploy problem, not an upstream one', async () => {
  await withConnectApp({ apiKey: null }, async ({ base, freelancer, calls }) => {
    const res = await post(`${base}/connect-stripe/start`);
    assert.equal(res.status, 503);
    assert.match(await res.text(), /ConfigError/);
    assert.equal(calls.length, 0, 'requireKey fires after the guard, before the transport');
  });
});

test('R12: the check-then-insert race converges on the stored account — one row, link minted for the winner (§3.3a)', async () => {
  const box = {};
  const intercept = (record) => {
    if (record.method === 'POST' && record.path === '/v1/accounts') {
      // The competing start "finishes first": its row lands between our check
      // and our insert. A different account id on purpose — the loser must
      // carry on against the STORED one, not the one it just created.
      box.repos.connectedAccounts.create({ freelancerId: box.freelancerId, stripeAccountId: 'acct_competitor' });
    }
    return undefined;
  };
  await withConnectApp({ fixture: { intercept } }, async ({ base, repos, freelancer, calls }) => {
    box.repos = repos;
    box.freelancerId = freelancer.id;
    const res = await post(`${base}/connect-stripe/start`);
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), LINK_URL);
    assert.equal(calls.length, 2);
    assert.equal(new URLSearchParams(calls[1].body).get('account'), 'acct_competitor', 'minted for the stored account');
    const row = repos.connectedAccounts.getByFreelancer(freelancer.id);
    assert.equal(row.stripeAccountId, 'acct_competitor');
    assert.equal(row.syncedAt, null, 'the loser does not seed readiness over the winner');
    assert.equal(repos.connectedAccounts.getByStripeAccountId(ACCT), null, 'exactly one row: the losing create left nothing');
  });
});

test('R13: all three routes redirect to sign-in without a session, and touch nothing', async () => {
  // WAS the missing-freelancer-parameter case. AS-40 deleted that parameter and
  // the branch behind it: identity is the session's, so "no identity" is now
  // "no session", and the answer is a redirect rather than a 400. The GETs
  // carry ?next= so signing in lands back here; the POST does not, because a
  // body cannot be replayed after a redirect.
  await withConnectApp({}, async ({ base, calls }) => {
    for (const [method, path, next] of [
      ['POST', '/connect-stripe/start', null],
      ['GET', '/connect-stripe/return', '/connect-stripe/return'],
      ['GET', '/connect-stripe/refresh', '/connect-stripe/refresh'],
    ]) {
      // The POST carries an Origin because a signed-out BROWSER on our own page
      // would: requireSameOrigin sits above the boundary and fails closed, so
      // an origin-less POST is a 403 before the guard ever sees it. That
      // ordering is asserted on its own in auth.test.js (G9–G12).
      const res = await fetch(`${base}${path}`, { method, redirect: 'manual', headers: { origin: base } });
      assert.equal(res.status, 303, `${method} ${path}`);
      assert.equal(
        res.headers.get('location'),
        next === null ? '/signin' : `/signin?next=${encodeURIComponent(next)}`,
        `${method} ${path}`,
      );
    }
    assert.equal(calls.length, 0);
  });
});

// --- M1–M3: the same routes against stripe-mock ---------------------------------
//
// What genuinely cannot be tested here, named (plan §5.3): stripe-mock is
// stateless — it cannot exercise the real hosted-onboarding round trip (a human
// completing the flow and being redirected back), and it validates request
// shapes, not whether test-mode Stripe accepts loopback return/refresh URLs.
// Both belong to AS-50's acceptance run, gated on the board's account (AS-51).
// This task opens nothing and files nothing.

const RAW_URL = process.env.ASC_STRIPE_MOCK_URL;
const MOCK_URL = typeof RAW_URL === 'string' && RAW_URL.trim() !== '' ? RAW_URL.trim() : undefined;
const SKIP = MOCK_URL === undefined ? 'ASC_STRIPE_MOCK_URL not set — run the contract service' : false;

// Refuse, at load time, to run against anything that could be Stripe — the
// same construction-level refusal as stripe-mock.test.js.
if (MOCK_URL !== undefined) {
  const { hostname } = new URL(MOCK_URL);
  if (hostname.endsWith('stripe.com')) {
    throw new Error(`ASC_STRIPE_MOCK_URL points at ${hostname}: this suite only ever talks to stripe-mock`);
  }
}

// The same mock-only placeholder stripe-mock.test.js uses (the mock requires a
// test-mode prefix and validates nothing else about it). Deliberately the
// identical literal — one grep finds both — and it never leaves the internal
// compose network. Second occurrence of the ONE key-shaped placeholder value in
// the repository; recorded as such in the AS-41 review comment.
const MOCK_KEY = 'sk_test_stripemock';

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

const mockStripeClient = () => createStripeClient({ apiKey: MOCK_KEY, baseUrl: MOCK_URL });

/** The real app, its client pointed at the mock through the real transport. */
async function withMockApp(fn) {
  await withServer(configFor(), async (base, app, deps) => {
    const freelancer = deps.repos.freelancers.create({ email: 'mock@example.test', displayName: 'Mock Freelancer' });
    auth.headers = signedInHeaders(base, seedSession(deps.repos, freelancer.id).cookie);
    await fn({ base, repos: deps.repos, freelancer });
  }, { stripe: mockStripeClient() });
}

/** The mock is stateless, so a direct mint returns the same account_link
 *  fixture the route's mint got — which is what lets M1/M3 pin the Location. */
async function fixtureLinkUrl() {
  const direct = await mockStripeClient().request({
    method: 'POST', path: '/v1/account_links', platform: true,
    params: { account: 'acct_stripemock', type: 'account_onboarding', refresh_url: 'https://example.test/r', return_url: 'https://example.test/x' },
  });
  return direct.data.url;
}

test('M1: start over HTTP against stripe-mock — the mock validates both route-level request shapes', { skip: SKIP }, async () => {
  await mockReady();
  await withMockApp(async ({ base, repos, freelancer }) => {
    const res = await post(`${base}/connect-stripe/start`);
    assert.equal(res.status, 303, 'the mock accepted both wire shapes — a parameter the spec does not know would be a 502 here');
    assert.equal(res.headers.get('location'), await fixtureLinkUrl());
    const row = repos.connectedAccounts.getByFreelancer(freelancer.id);
    assert.ok(row.stripeAccountId.startsWith('acct_'), 'row created from the mock account fixture');
    assert.notEqual(row.syncedAt, null, 'readiness seeded from the create response');
    for (const flag of [row.chargesEnabled, row.detailsSubmitted, row.payoutsEnabled]) {
      assert.equal(typeof flag, 'boolean', 'the mapper consumed a real spec-shaped account response');
    }
  });
});

test('M2: return against stripe-mock — the row is exactly the mapping of what the mock says about the account', { skip: SKIP }, async () => {
  await mockReady();
  await withMockApp(async ({ base, repos, freelancer }) => {
    repos.connectedAccounts.create({ freelancerId: freelancer.id, stripeAccountId: 'acct_stripemock' });
    const res = await get(`${base}/connect-stripe/return`);
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/connect-stripe');
    const row = repos.connectedAccounts.getByFreelancer(freelancer.id);
    assert.notEqual(row.syncedAt, null);
    // An independent read of the same fixture: the row must be its mapping.
    const read = await mockStripeClient().request({ method: 'GET', path: '/v1/accounts/acct_stripemock', platform: true });
    const expected = readinessFromAccount(read.data, row.syncedAt);
    assert.equal(row.chargesEnabled, expected.chargesEnabled);
    assert.equal(row.detailsSubmitted, expected.detailsSubmitted);
    assert.equal(row.payoutsEnabled, expected.payoutsEnabled);
    assert.deepEqual(row.requirementsCurrentlyDue, expected.requirementsCurrentlyDue);
    assert.equal(row.requirementsDisabledReason, expected.requirementsDisabledReason);
  });
});

test('M3: refresh against stripe-mock — 303 back into the hosted flow, no readiness write', { skip: SKIP }, async () => {
  await mockReady();
  await withMockApp(async ({ base, repos, freelancer }) => {
    repos.connectedAccounts.create({ freelancerId: freelancer.id, stripeAccountId: 'acct_stripemock' });
    const res = await get(`${base}/connect-stripe/refresh`);
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), await fixtureLinkUrl());
    assert.equal(repos.connectedAccounts.getByFreelancer(freelancer.id).syncedAt, null, 'no readiness write on refresh');
  });
});
