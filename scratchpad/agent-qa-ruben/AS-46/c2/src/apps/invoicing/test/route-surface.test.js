// route-surface.test.js — the committed route list and the public/protected
// partition: G1, G1b, G2, G3 (AS-40, plan §3.5; AS-46, plan §3.6).
//
// MOVED VERBATIM from test/auth.test.js by AS-46. That file stood at 1,199
// lines against the 1,200-line cap (test/dependency-policy.test.js's last
// case) and screen 4 adds four routes — eight lines across ALL_ROUTES and G2's
// list — so the route-surface block moved here as its own file, assertions
// unchanged, case count unchanged. The reviewer's first check is
// `git diff -M`: the block below is byte-identical to what auth.test.js lost,
// modulo this header, the import lines, and `withApp` — which the block calls
// and which stays in auth.test.js for the H-cases, so a copy of it (doc
// comment included, so the `null` secret convention is stated where it is
// used) lives here too.
//
// THE GUARD IS ASSERTED BY REACHABILITY, NOT PLACEMENT (G1–G3): every route the
// built app registers is walked out of the router tree, classified in a list a
// reviewer reads, and — for the protected partition — driven with a cookieless
// request whose answer is compared to the guard's OWN rejection of a path
// nothing serves. See test/auth.test.js's header for the mount-order half.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStripeClient } from '../lib/stripe/client.js';
import { discoverRoutes } from './helpers/routes.js';
import { configFor, withServer } from './helpers/server.js';

// Not key-shaped on purpose — the stripe-client.test.js convention.
const KEY = 'unit-test-placeholder-key';
// The webhook router registers nothing without a secret (AS-44), so the full
// surface needs one configured; any whsec_-shaped placeholder does.
const WEBHOOK_SECRET = 'whsec_unit_test_placeholder';

/** withServer + a keyless Stripe client, with the webhook secret configured so
 *  the app's full route surface exists. */
async function withApp({ appBaseUrl, secret = WEBHOOK_SECRET }, fn) {
  // `null` means "configure no secret" — distinct from omitting the key, which
  // takes the default. Passing undefined would silently take the default and
  // make G1b assert the same thing twice.
  const overrides = {};
  if (secret !== null) overrides.webhookSecret = secret;
  if (appBaseUrl !== undefined) overrides.appBaseUrl = appBaseUrl;
  const config = configFor(overrides);
  await withServer(config, async (base, app, deps) => {
    await fn({ base, app, config, repos: deps.repos });
  }, { stripe: createStripeClient({ apiKey: KEY }) });
}

/** THE COMMITTED ROUTE LIST. A route added anywhere — in a new router, in an
 *  existing one, at any mount position — changes this and turns G1 red. To make
 *  it green its author must classify it below, in an array a reviewer reads.
 *  There is no path from "someone added a route" to "it is unprotected and
 *  nobody noticed". */
const ALL_ROUTES = [
  'GET /',
  'GET /connect-stripe',
  'GET /connect-stripe/refresh',
  'GET /connect-stripe/return',
  'GET /healthz',
  'GET /invoices/:id/edit',
  'GET /invoices/new',
  'GET /signin',
  'GET /tokens.css',
  'POST /clients',
  'POST /connect-stripe/start',
  'POST /contracts',
  'POST /invoices',
  'POST /invoices/:id',
  'POST /invoices/:id/edit',
  'POST /invoices/:id/finalize',
  'POST /invoices/:id/send',
  'POST /invoices/new',
  'POST /signin',
  'POST /signout',
  'POST /signup',
  'POST /webhooks/stripe',
];

/** Public, each for a stated reason. Everything else requires a session. */
const PUBLIC_ROUTES = [
  // must answer when everything else is broken; compose's healthcheck sends no cookie
  'GET /healthz',
  // SCREEN 1 (AS-45). It is where requireSession SENDS every signed-out
  // visitor, so a guarded sign-in page is an infinite redirect. Its own denied
  // state (an already-signed-in caller) is a 303 the handler issues, not the
  // guard's — asserted in screens.test.js.
  'GET /signin',
  // vendored bytes, identical for every caller
  'GET /tokens.css',
  // authenticated BY SIGNATURE, not by session — Stripe sends no cookie and no Origin
  'POST /webhooks/stripe',
  // the two ways in
  'POST /signin',
  'POST /signup',
];

test('G1: the route walk finds the EXACT committed list — cardinality first', async () => {
  await withApp({}, async ({ app }) => {
    const found = discoverRoutes(app);
    // Never `> 0`: a walk that silently returned nothing would otherwise pass
    // every rule below it on an empty set (the AS-31 lesson).
    assert.equal(found.length, 22, `expected exactly 22 routes, found ${found.length}: ${found.join(', ')}`);
    assert.deepEqual(found, ALL_ROUTES);
  });
});

test('G1b: with NO webhook secret the surface is the same list minus the webhook route', async () => {
  // The webhook router registers nothing without a secret (AS-44), so the
  // committed list above is config-dependent and says so in both directions.
  await withApp({ secret: null }, async ({ app }) => {
    const found = discoverRoutes(app);
    assert.equal(found.length, 21, found.join(', '));
    assert.deepEqual(found, ALL_ROUTES.filter((r) => r !== 'POST /webhooks/stripe'));
  });
});

test('G2: the public/protected partition is exact in BOTH directions', async () => {
  await withApp({}, async ({ app }) => {
    const found = discoverRoutes(app);
    // Every declared public route really exists…
    const missing = PUBLIC_ROUTES.filter((r) => !found.includes(r));
    assert.deepEqual(missing, [], 'PUBLIC_ROUTES names a route that does not exist');
    // …and the partition covers the list with nothing left over.
    const protectedRoutes = found.filter((r) => !PUBLIC_ROUTES.includes(r));
    assert.equal(PUBLIC_ROUTES.length + protectedRoutes.length, found.length);
    assert.deepEqual(protectedRoutes, [
      'GET /',
      'GET /connect-stripe',
      'GET /connect-stripe/refresh',
      'GET /connect-stripe/return',
      'GET /invoices/:id/edit',
      'GET /invoices/new',
      'POST /clients',
      'POST /connect-stripe/start',
      'POST /contracts',
      'POST /invoices',
      'POST /invoices/:id',
      'POST /invoices/:id/edit',
      'POST /invoices/:id/finalize',
      'POST /invoices/:id/send',
      'POST /invoices/new',
      'POST /signout',
    ]);
  });
});

/** A path below the boundary that NOTHING registers. Nothing serves it, so
 *  whatever answers a cookieless request to it is DEFINITIONALLY the guard —
 *  which makes its answer the reference every protected member is compared
 *  against. */
const UNROUTED_PATH = '/__unrouted__';

test('G3: every protected route\'s cookieless answer is ATTRIBUTABLE to the guard, not merely shaped like one', async () => {
  await withApp({}, async ({ base, app }) => {
    const found = discoverRoutes(app);
    // ATTRIBUTION, NOT APPEARANCE. This case previously asserted `303` +
    // `Location: /signin` — what a rejection LOOKS like, which any handler may
    // reproduce and POST /signout's success path does exactly: its member
    // stayed green while the route sat ABOVE the boundary answering anonymous
    // callers, and would have stayed green with requireSession deleted. The
    // property is "if the guard's rejection changed, this route's response
    // would change", enforced here by comparing every member against the
    // guard's OWN rejection in this same app, and in §7's recipe F12 by moving
    // that rejection and requiring all eleven members to move with it.
    assert.equal(found.includes(`POST ${UNROUTED_PATH}`), false, 'something now serves the reference path — it is no longer the guard that answers it');
    const ref = await fetch(`${base}${UNROUTED_PATH}`, { method: 'POST', redirect: 'manual', headers: { origin: base } });
    const refLocation = ref.headers.get('location');
    // Cardinality on the INSTRUMENT before quantifying with it: with the guard
    // deleted this probe 404s with no Location, and eleven 404s compared against
    // a 404 would be a vacuous green.
    assert.ok(ref.status >= 300 && ref.status < 400, `the reference probe was not answered by a redirect (${ref.status}) — requireSession is not answering ${UNROUTED_PATH}`);
    assert.equal(refLocation, '/signin', 'the guard redirects to the sign-in path — the contract AS-45 renders');
    assert.equal(ref.headers.getSetCookie().length, 0, 'the guard sets NO cookie: that silence is what distinguishes it from a handler');

    const protectedRoutes = found.filter((r) => !PUBLIC_ROUTES.includes(r));
    assert.equal(protectedRoutes.length, 16, 'cardinality before quantification');
    for (const entry of protectedRoutes) {
      const [method, path] = entry.split(' ');
      const url = new URL(`${base}${path.replaceAll(':id', 'some-id')}`);
      const res = await fetch(url, { method, redirect: 'manual', headers: { origin: base } });
      // The guard's own status, not a literal 303.
      assert.equal(res.status, ref.status, `${entry}: status differs from the guard's own rejection`);
      // The byte that discriminates: POST /signout's handler emits
      // `invoicing_session=; …Expires=Thu, 01 Jan 1970…`, and the guard emits
      // nothing at all. One line, and it is the line that would have caught the
      // defect that shipped in cycle 1.
      assert.equal(res.headers.getSetCookie().length, 0, `${entry}: answered with a Set-Cookie, so a HANDLER ran and the guard never saw the request`);
      // The guard's own Location, built from the reference rather than from a
      // literal. G4's split, unchanged: a safe method carries ?next= so the
      // freelancer lands where they were going, an unsafe one does not, because
      // a POST body cannot be replayed after a redirect.
      const expected = method === 'GET' ? `${refLocation}?next=${encodeURIComponent(url.pathname)}` : refLocation;
      assert.equal(res.headers.get('location'), expected, entry);
    }
  });
});
