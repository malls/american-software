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
// the host port; apps/invoicing/compose.yaml itself publishes nothing.
//
// Same rules as run.mjs: refuses to start without ASC_STRIPE_MOCK_URL or with
// one that points at stripe.com (exit 2), a fresh database file per run, and
// nothing imported from test/ or from run.mjs (the BOOT region is copied, not
// shared — the demo<->test coupling run.mjs refuses is refused here too).

import { mkdtempSync } from 'node:fs';
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

const stripe = createStripeClient({ apiKey: MOCK_KEY, baseUrl: MOCK_URL });

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
  const server = app.listen(config.port, config.bind, () => {
    process.stdout.write(`demo/serve: listening on ${config.bind}:${config.port} (stripe host ${MOCK_URL}, fresh database ${config.dbPath})\n`);
  });
  const stop = () => {
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
