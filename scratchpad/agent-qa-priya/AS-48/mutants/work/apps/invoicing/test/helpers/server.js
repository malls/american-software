// test/helpers/server.js — the one place that knows how to start and stop an
// app under test (AS-37, plan §8.4; AS-39, plan §2.10).
//
// THE RULE THIS FILE EXISTS TO ENFORCE: teardown is registered BEFORE the
// assertions run. Measured on the spike — a probe that called srv.close() on
// the line AFTER its assertions hung forever when an assertion failed: the
// close never ran, the listener held the event loop open, and the suite
// produced no output at all until it was killed. A hung suite is worse than a
// red one; it has no exit code to report and nothing to read.
//
// try/finally satisfies that rule by construction — `fn` cannot throw past the
// close — so no test file has to remember t.after(). Callers get a base URL and
// nothing else to clean up.
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../app.js';
import { loadConfig } from '../../lib/config.js';
import { createRepositories, prepareDatabase } from '../../lib/db/database.js';
import { createStripeClient } from '../../lib/stripe/client.js';

/**
 * Start an app on an OS-assigned port, run `fn(baseUrl, app, deps)`, always
 * stop it.
 *
 * Mirrors boot (server.js): the database is opened and migrated BEFORE the app
 * exists, the deps pair is built from that handle exactly as server.js builds
 * it (AS-41, plan §3.7), and the database is closed after the listener is —
 * so a test that boots against a fresh file sees exactly what `docker compose
 * up` sees. The optional third argument lets connect tests inject a
 * fixture-transport Stripe client; with no override the client is keyless
 * (config.stripeSecretKey is null in tests), exactly like an unconfigured
 * deployment. `fn` receives the deps as its third argument so a test can seed
 * and read rows through the same repositories the app serves from.
 *
 * Port 0, never 8348: a test run alongside `docker compose up` would otherwise
 * collide with the running web service.
 *
 * @param {object} config frozen settings (see configFor)
 * @param {(baseUrl: string, app: import('express').Express, deps: { repos: object, stripe: object }) => Promise<any>} fn
 * @param {{ stripe?: object }} [overrides]
 */
export async function withServer(config, fn, { stripe } = {}) {
  const { db } = prepareDatabase(config);
  try {
    const deps = {
      repos: createRepositories(db),
      stripe: stripe ?? createStripeClient({ apiKey: config.stripeSecretKey }),
    };
    const app = createApp(config, deps);
    const server = app.listen(0, '127.0.0.1');
    try {
      await once(server, 'listening');
      const { port } = server.address();
      return await fn(`http://127.0.0.1:${port}`, app, deps);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    db.close();
  }
}

/**
 * Build settings the way the app really builds them — through loadConfig, from
 * an env object — rather than hand-assembling an object. Tests that inject a
 * substitute path still exercise the real resolution and validation path.
 *
 * With no overrides this returns the REAL container configuration
 * (/app/vendor, /app/views, /app/public), which is what the V3 tests use to
 * assert against the real image (plan §8.3) — with ONE documented exception:
 * `dbPath` defaults to a fresh file under a private mkdtemp directory, because
 * `node --test` runs files in parallel processes and a shared database would
 * make every row count flaky. The real default path is exercised by exactly one
 * test (db.test.js D18), which passes it explicitly, read from SCHEMA.
 *
 * `webhookSecret` (AS-44) is the one override with no real default: unset means
 * the receiver registers no route at all, which is the normal state of every
 * test that is not about webhooks.
 *
 * @param {{vendorDir?: string, viewsDir?: string, publicDir?: string, dbPath?: string, appBaseUrl?: string, port?: number|string, bind?: string, logLevel?: string, env?: string, webhookSecret?: string}} overrides
 */
export function configFor(overrides = {}) {
  const env = {};
  if (overrides.vendorDir !== undefined) env.INVOICING_VENDOR_DIR = overrides.vendorDir;
  if (overrides.viewsDir !== undefined) env.INVOICING_VIEWS_DIR = overrides.viewsDir;
  if (overrides.publicDir !== undefined) env.INVOICING_PUBLIC_DIR = overrides.publicDir;
  if (overrides.appBaseUrl !== undefined) env.INVOICING_APP_BASE_URL = overrides.appBaseUrl;
  env.INVOICING_DB_PATH = overrides.dbPath !== undefined ? overrides.dbPath : freshDbPath();
  if (overrides.port !== undefined) env.INVOICING_PORT = String(overrides.port);
  if (overrides.bind !== undefined) env.INVOICING_BIND = overrides.bind;
  if (overrides.logLevel !== undefined) env.INVOICING_LOG_LEVEL = overrides.logLevel;
  if (overrides.env !== undefined) env.NODE_ENV = overrides.env;
  if (overrides.webhookSecret !== undefined) env.INVOICING_STRIPE_WEBHOOK_SECRET = overrides.webhookSecret;
  return loadConfig(env);
}

/**
 * configFor + a migrated database on disk at its `dbPath`, handle already
 * closed — for check-level tests that never start a server but need the
 * `database` health check to pass (the hand-built-config test in health.test.js).
 */
export function preparedConfigFor(overrides = {}) {
  const config = configFor(overrides);
  const { db } = prepareDatabase(config);
  db.close();
  return config;
}

/** A database path nothing else in the run shares: a new temp directory per call. */
export function freshDbPath() {
  return join(mkdtempSync(join(tmpdir(), 'asc-invoicing-db-')), 'invoicing.sqlite');
}

/** The app's root directory inside the image (and in a checkout): /app. */
export const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The test directory itself: /app/test. */
export const TEST_DIR = resolve(APP_DIR, 'test');

/**
 * FOLLOW A REDIRECT CHAIN TO ITS TERMINUS, and report the terminus.
 *
 * AS-45 review cycle 1, defect F-2: `POST /signup` answered `303 /`, `/`
 * answered `303 /connect-stripe`, and that route is AS-70's — so the only
 * success path of the only screen ended on a 404 while every numbered
 * acceptance criterion passed. The criterion that would have caught it asserted
 * a `Location` header and stopped. A Location is a STEP; this is the OUTCOME.
 *
 * It lives here, in the one helper both test files already import, because the
 * finding requires ONE shared implementation rather than three copies — three
 * copies of a chain-follower are three chances to stop one hop short in
 * different ways. (This is the one file this rework touches that plan §2 does
 * not name; recorded as a deviation in the cycle's Lattice comment.)
 *
 * `hopLimit` is a HARD CAP that throws rather than looping — a redirect cycle
 * must be a red test, not a hung suite (the helpers/server.js rule at the top of
 * this file). Callers assert on the returned `hops` against a COMMITTED number,
 * so a chain that silently grows a hop is red even though it still terminates.
 *
 * @param {string} base the withServer base URL
 * @param {Response} response a response already fetched with redirect: 'manual'
 * @param {{ cookie?: string | null, hopLimit?: number }} [options] `cookie` is
 *   carried on every hop — a landing behind the auth boundary needs the session
 *   the first response set.
 * @returns {Promise<{ status: number, path: string, body: string, hops: number,
 *   chain: string[], contentType: string | null }>}
 */
export async function followToTerminus(base, response, { cookie = null, hopLimit = 5 } = {}) {
  const headers = cookie === null ? {} : { cookie };
  const chain = [];
  let current = response;
  let hops = 0;
  while (current.status >= 300 && current.status < 400) {
    const location = current.headers.get('location');
    if (typeof location !== 'string' || location === '') {
      throw new Error(`followToTerminus: ${current.status} with no Location after ${chain.join(', ')}`);
    }
    if (hops >= hopLimit) {
      throw new Error(`followToTerminus: more than ${hopLimit} hops — ${chain.join(', ')}`);
    }
    chain.push(`${current.status} -> ${location}`);
    current = await fetch(new URL(location, base), { redirect: 'manual', headers });
    hops += 1;
  }
  return {
    status: current.status,
    path: new URL(current.url).pathname,
    body: await current.text(),
    contentType: current.headers.get('content-type'),
    hops,
    chain,
  };
}

// AS-40: re-exported here so a suite that needs a signed-in freelancer imports
// from the one helper it already imports. seedSignedIn mints the session ROW
// directly, so a suite that is not testing sign-in pays no KDF cost.
export { seedSession, seedSignedIn, signedInHeaders } from './auth.js';
