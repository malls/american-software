// demo/serve.mjs — the walkthrough's BOOT region as a server (AS-130).
//
// The screenshot capture (.claude/skills/d1-demo-artifact/capture.mjs) drives a
// real browser through the same path run.mjs walks, so it needs the same
// target run.mjs has: the shipped app code, booted in-process, next to
// stripe-mock, with the placeholder key and webhook secret. `web` cannot be
// that target — it is deliberately off the mock network and its client is
// built against api.stripe.com (lib/stripe/client.js: `baseUrl` is an option,
// never configuration) — so this file boots run.mjs's BOOT region and LISTENS
// instead of walking. It is run as the `demo` compose service with the
// capture override (compose.capture.yaml under the skill), which is what adds
// the host ports; apps/invoicing/compose.yaml itself publishes nothing.
//
// Two listeners: the app on 8348, exactly as shipped, and a read-only ledger
// on 8350 that answers the Stripe request paths the app has made so far (the
// list run.mjs prints as "Stripe requests the app made"). The capture reads
// the two mock-minted ids it needs to sign the demo's two events from there.
//
// Same rules as run.mjs: refuses to start without ASC_STRIPE_MOCK_URL or with
// one that points at stripe.com (exit 2), a fresh database file per run, and
// nothing imported from test/ or from run.mjs (the BOOT region is copied, not
// shared — the demo<->test coupling run.mjs refuses is refused here too).

import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApp } from '../app.js';
import { loadConfig } from '../lib/config.js';
import { createRepositories, prepareDatabase } from '../lib/db/database.js';
import { createStripeClient } from '../lib/stripe/client.js';

// ============================================================================
// BOOT — copied from run.mjs
// ============================================================================

const MOCK_URL = process.env.ASC_STRIPE_MOCK_URL;
if (typeof MOCK_URL !== 'string' || MOCK_URL.trim() === '') {
  console.error('demo/serve: ASC_STRIPE_MOCK_URL is not set — this server only ever talks to stripe-mock; run it as the `demo` compose service with the capture override');
  process.exit(2);
}
{
  let hostname;
  try {
    hostname = new URL(MOCK_URL).hostname;
  } catch {
    console.error(`demo/serve: ASC_STRIPE_MOCK_URL is not a URL: ${JSON.stringify(MOCK_URL)}`);
    process.exit(2);
  }
  if (hostname.endsWith('stripe.com')) {
    console.error(`demo/serve: ASC_STRIPE_MOCK_URL points at ${hostname}: this server only ever talks to stripe-mock`);
    process.exit(2);
  }
}

// The same mock-only placeholders run.mjs uses, for the same reasons (see the
// comments there): stripe-mock checks the key's shape and nothing else; the
// webhook secret exists so the receiver registers its route, and it signs only
// the events the capture posts to it — the same two run.mjs signs.
const MOCK_KEY = 'sk_test_demoplaceholder';
const WEBHOOK_SECRET = 'whsec_demo_placeholder';

const config = loadConfig({
  INVOICING_BIND: '0.0.0.0',
  INVOICING_PORT: '8348',
  INVOICING_DB_PATH: join(mkdtempSync(join(tmpdir(), 'asc-demo-serve-')), 'demo.sqlite'),
  INVOICING_STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
});

/** Every Stripe path the app asks for, in order — run.mjs's decorator around
 *  the real client, so the real pipeline (custody guard included), transport
 *  and mock all still run. run.mjs prints these under "Stripe requests the app
 *  made"; here they are answered on the ledger port below, because the
 *  capture needs two of the ids the mock minted (the connected account, the
 *  Stripe invoice) to sign the same two events run.mjs signs, and no screen
 *  renders them. */
const stripePaths = [];
const realStripe = createStripeClient({ apiKey: MOCK_KEY, baseUrl: MOCK_URL });
const stripe = Object.freeze({
  request: (call) => {
    stripePaths.push(`${call.method} ${call.path}`);
    return realStripe.request(call);
  },
});

// The ledger: a second, read-only listener answering `GET /stripe-requests`
// with the array above as JSON, on its own port so the app on 8348 is exactly
// the shipped app (app.js is untouched). Anything else is a 404.
const LEDGER_PORT = 8350;
const ledger = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/stripe-requests') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(stripePaths));
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('demo/serve: only GET /stripe-requests is served here\n');
});

async function mockReady() {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < 10_000) {
    try {
      await fetch(`${MOCK_URL}/v1/customers`, { signal: AbortSignal.timeout(1000) });
      return;
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`stripe-mock at ${MOCK_URL} did not answer within 10 s`, { cause: lastError });
}

// ============================================================================
// LISTEN — instead of run.mjs's SEQUENCE and PRINT
// ============================================================================

async function main() {
  await mockReady();
  const { db } = prepareDatabase(config);
  const repos = createRepositories(db);
  const app = createApp(config, { repos, stripe });
  const server = app.listen(config.port, config.bind);
  await once(server, 'listening');
  ledger.listen(LEDGER_PORT, config.bind);
  await once(ledger, 'listening');
  process.stdout.write(`demo/serve: app on ${config.bind}:${config.port}, ledger on ${config.bind}:${LEDGER_PORT} (stripe host ${MOCK_URL}, fresh database ${config.dbPath})\n`);
  const stop = () => {
    ledger.close();
    server.close(() => {
      db.close();
      process.exit(0);
    });
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch((err) => {
  console.error(`demo/serve: ${err.name}: ${err.message}`);
  process.exit(1);
});
