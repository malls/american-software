// Ruben's M6 route probe for AS-67 — OBSERVES, does not assert. Runs in a scratch
// copy only; never committed. Drives the three surfaces that reach
// repos.clients.create with typed input and prints exactly what comes back for a
// malformed email, a trailing-space email, and the 254/255 boundary.
import test from 'node:test';
import { createStripeClient } from '../lib/stripe/client.js';
import { readinessFromAccount } from '../lib/connect/readiness.js';
import { configFor, seedSession, signedInHeaders, withServer } from './helpers/server.js';

const ACCT = 'acct_fixture1';
const TS = '2026-09-12T10:00:00.000Z';
const account = { id: ACCT, object: 'account', charges_enabled: true, details_submitted: true, payouts_enabled: true, requirements: { currently_due: [], disabled_reason: null } };

async function withApp(fn) {
  const transport = async () => { throw new Error('probe: no Stripe call expected'); };
  const stripe = createStripeClient({ apiKey: 'unit-test-placeholder-key', transport });
  await withServer(configFor(), async (base, app, deps) => {
    const repos = deps.repos;
    const freelancer = repos.freelancers.create({ email: 'f@example.test', displayName: 'Freda' });
    repos.connectedAccounts.create({ freelancerId: freelancer.id, stripeAccountId: ACCT });
    repos.connectedAccounts.updateReadiness(ACCT, readinessFromAccount(account, TS));
    const { cookie } = seedSession(repos, freelancer.id);
    const headers = signedInHeaders(base, cookie);
    const post = (path, fields) => fetch(`${base}${path}`, {
      method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
      body: new URLSearchParams(fields).toString(),
    });
    const count = () => repos.clients.listByFreelancer(freelancer.id).length;
    await fn({ post, count, repos, freelancer });
  }, { stripe });
}

const EMAILS = {
  malformed: 'not-an-email',
  trailingSpace: 'ann@example.test ',
  leadingSpace: ' ann@example.test',
  at254: `${'x'.repeat(246)}@ex.test`,
  at255: `${'x'.repeat(247)}@ex.test`,
  good: 'ann@example.test',
};

function stateOf(html) {
  return (html.match(/data-state="([^"]+)"/) ?? [])[1] ?? (html.match(/S4-[A-Z-]+/) ?? [])[0] ?? '(no state marker)';
}

test('PROBE invoice form intent=add-client', async () => {
  await withApp(async ({ post, count }) => {
    for (const [label, clientEmail] of Object.entries(EMAILS)) {
      const before = count();
      const res = await post('/invoices/new', { intent: 'add-client', clientName: 'Ann', clientEmail, daysUntilDue: '30' });
      const text = await res.text();
      const ct = res.headers.get('content-type');
      const summary = ct?.startsWith('text/html') ? `html state=${stateOf(text)} len=${text.length}` : `body=${JSON.stringify(text.slice(0, 80))}`;
      console.log(`PROBE invoices add-client ${label.padEnd(13)} -> ${res.status} ${ct} ${summary} rows ${before}->${count()}`);
    }
  });
});

test('PROBE POST /clients (programmatic route)', async () => {
  await withApp(async ({ post, count }) => {
    for (const [label, email] of Object.entries(EMAILS)) {
      const before = count();
      const res = await post('/clients', { name: 'Ann', email, next: '/invoices/new' });
      const text = await res.text();
      console.log(`PROBE /clients ${label.padEnd(13)} -> ${res.status} ${res.headers.get('content-type')} loc=${res.headers.get('location')} body=${JSON.stringify(text.slice(0, 60))} rows ${before}->${count()}`);
    }
  });
});

test('PROBE sign-up shares the predicate', async () => {
  await withServer(configFor(), async (base) => {
    for (const [label, email] of Object.entries(EMAILS)) {
      const res = await fetch(`${base}/signup`, {
        method: 'POST', redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ displayName: 'Freda', email, password: 'correct horse battery staple' }).toString(),
      });
      const text = await res.text();
      console.log(`PROBE sign-up ${label.padEnd(13)} -> ${res.status} ${res.headers.get('content-type')} body=${JSON.stringify(text.slice(0, 60))}`);
    }
  });
});
