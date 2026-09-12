// Scratch, never committed. Renders screen 4 in each of its eight rendered
// states through the REAL app server (test/helpers/server.js withServer —
// same template, same routes, same stylesheets served by the app), inlines
// /tokens.css and /app.css in place of the two <link>s so a file:// load in a
// browser sees exactly what the server serves, and writes each page to
// /scratch/states/<state>.html for the 375px inspection (plan §5, AC 31).
// Runs inside the compose `test` image: node /scratch/capture-375.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { readinessFromAccount } from '/app/lib/connect/readiness.js';
import { createStripeClient } from '/app/lib/stripe/client.js';
import { configFor, seedSession, signedInHeaders, withServer } from '/app/test/helpers/server.js';

const KEY = 'unit-test-placeholder-key';
const TS = '2026-09-12T10:00:00.000Z';
const ACCT = 'acct_fixture1';
const OUT = '/scratch/states';
mkdirSync(OUT, { recursive: true });

function stripeAccount({ charges = true, due = [] } = {}) {
  return {
    id: ACCT, object: 'account', charges_enabled: charges, details_submitted: true, payouts_enabled: charges,
    requirements: { currently_due: due, disabled_reason: due.length === 0 ? null : 'requirements.past_due' },
  };
}
const json = (data, status = 200) => ({ status, headers: { 'request-id': 'req_fixture' }, body: JSON.stringify(data) });
function fixtureTransport() {
  let seq = 0;
  const nextId = (prefix) => `${prefix}_fixture${(seq += 1)}`;
  return async (signed) => {
    const path = signed.url.pathname;
    if (path === '/v1/customers') return json({ id: nextId('cus'), object: 'customer' });
    throw new Error(`fixture transport: unexpected ${signed.method} ${path}`);
  };
}

async function withScreenApp({ connected = true, clients = 1 } = {}, fn) {
  const stripe = createStripeClient({ apiKey: KEY, transport: fixtureTransport() });
  await withServer(configFor(), async (base, app, deps) => {
    const repos = deps.repos;
    const freelancer = repos.freelancers.create({ email: 'f@example.test', displayName: 'Freda Lancer' });
    if (connected) {
      repos.connectedAccounts.create({ freelancerId: freelancer.id, stripeAccountId: ACCT });
      repos.connectedAccounts.updateReadiness(ACCT, readinessFromAccount(stripeAccount(), TS));
    }
    const seeded = [];
    for (let i = 0; i < clients; i += 1) {
      seeded.push(repos.clients.create(freelancer.id, { name: `Client ${i + 1} With A Fairly Long Business Name LLC`, email: `client${i + 1}@example.test` }));
    }
    const { cookie } = seedSession(repos, freelancer.id);
    const headers = signedInHeaders(base, cookie);
    const get = (path) => fetch(`${base}${path}`, { redirect: 'manual', headers });
    const post = (path, fields) => fetch(`${base}${path}`, {
      method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
      body: new URLSearchParams(fields).toString(),
    });
    const css = {
      tokens: await (await fetch(`${base}/tokens.css`)).text(),
      app: await (await fetch(`${base}/app.css`)).text(),
    };
    const save = async (name, res) => {
      let html = await res.text();
      const state = (html.match(/data-state="([^"]*)"/) || [])[1];
      html = html
        .replace('<link rel="stylesheet" href="/tokens.css" />', `<style>\n${css.tokens}\n</style>`)
        .replace('<link rel="stylesheet" href="/app.css" />', `<style>\n${css.app}\n</style>`);
      writeFileSync(`${OUT}/${name}.html`, html);
      console.log(`${name}: HTTP ${res.status} data-state=${state} -> ${OUT}/${name}.html`);
    };
    await fn({ get, post, save, repos, freelancer, client: seeded[0] ?? null });
  }, { stripe });
}

const items = (rows) => {
  const out = {};
  rows.forEach((r, i) => { out[`lineItems[${i}][description]`] = r.d; out[`lineItems[${i}][quantity]`] = r.q; out[`lineItems[${i}][unitPrice]`] = r.p; });
  return out;
};

// 1. S4-DEFAULT-CREATE, 2. S4-DEFAULT-EDIT, 3. S4-ERROR-SYSTEM (via a saved draft)
await withScreenApp({}, async ({ get, post, save, repos, freelancer, client }) => {
  await save('S4-DEFAULT-CREATE', await get('/invoices/new'));
  const saved = await post('/invoices/new', {
    intent: 'save', clientId: client.id, daysUntilDue: '30',
    ...items([{ d: 'Website redesign — phase 1, discovery and wireframes', q: '1', p: '1200.00' }, { d: 'Hosting', q: '12', p: '19.99' }]),
  });
  console.log('save ->', saved.status, saved.headers.get('location'));
  const [draft] = repos.invoices.listByFreelancer(freelancer.id);
  await save('S4-DEFAULT-EDIT', await get(`/invoices/${draft.id}/edit`));
  await save('S4-ERROR-SYSTEM', await get(`/invoices/${draft.id}/edit?error=send`));
  // 4. S4-ERROR-VALIDATION, the wireframe's many-field shape (select mode)
  await save('S4-ERROR-VALIDATION', await post('/invoices/new', {
    intent: 'save', clientId: '', daysUntilDue: '0', pickerMode: 'select',
    ...items([{ d: '', q: '1.5', p: 'abc' }, { d: '', q: '', p: '' }, { d: '', q: '', p: '' }]),
  }));
  // 4b. S4-ERROR-VALIDATION in add-new mode — the D1 slot, one client toggled
  await save('S4-ERROR-VALIDATION-addnew-toggled', await post('/invoices/new', {
    intent: 'send', pickerMode: 'new', clientName: 'Dee Example', clientEmail: 'dee@example.test', daysUntilDue: '30',
    ...items([{ d: 'Work', q: '1', p: '10.00' }]),
  }));
  // 5. S4-CLIENT-ERROR-VALIDATION
  await save('S4-CLIENT-ERROR-VALIDATION', await post('/invoices/new', {
    intent: 'add-client', pickerMode: 'new', clientName: '', clientEmail: '', daysUntilDue: '30', ...items([{ d: '', q: '', p: '' }]),
  }));
  // 6. S4-CLIENT-ERROR-DUPLICATE
  await save('S4-CLIENT-ERROR-DUPLICATE', await post('/invoices/new', {
    intent: 'add-client', pickerMode: 'new', clientName: 'Client One Again', clientEmail: 'CLIENT1@EXAMPLE.TEST', daysUntilDue: '30', ...items([{ d: '', q: '', p: '' }]),
  }));
});
// 7. S4-CLIENT-EMPTY, and 7b the D1 slot in the zero-clients state
await withScreenApp({ clients: 0 }, async ({ get, post, save }) => {
  await save('S4-CLIENT-EMPTY', await get('/invoices/new'));
  await save('S4-ERROR-VALIDATION-addnew-empty', await post('/invoices/new', {
    intent: 'save', pickerMode: 'new', daysUntilDue: '30', ...items([{ d: 'Work', q: '1', p: '10.00' }]),
  }));
});
// 8. S4-GATED-STRIPENOTREADY
await withScreenApp({ connected: false }, async ({ get, save }) => {
  await save('S4-GATED-STRIPENOTREADY', await get('/invoices/new'));
});
