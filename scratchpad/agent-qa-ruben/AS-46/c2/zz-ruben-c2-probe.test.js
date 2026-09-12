// Ruben's cycle-2 probes for AS-46 (M6). Copied into a scratch archive's test/
// dir and run alone: node --test test/zz-ruben-c2-probe.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { invoiceFormLocals, parseInvoiceForm } from '../lib/screens/invoice-form-view.js';
import { readinessFromAccount } from '../lib/connect/readiness.js';
import { createStripeClient } from '../lib/stripe/client.js';
import { configFor, seedSession, signedInHeaders, withServer } from './helpers/server.js';

const KEY = 'unit-test-placeholder-key';
const TS = '2026-09-12T10:00:00.000Z';
const ACCT = 'acct_fixture1';
const NEW = '/invoices/new';
const occ = (h, n) => h.split(n).length - 1;
const stateOf = (html) => (html.match(/data-state="([^"]*)"/) || [null, null])[1];
const bannerCount = (html) => { const m = html.match(/(\d+) fields? needs? attention/); return m ? Number(m[1]) : null; };
const markers = (html) => occ(html, 'class="field field--invalid"');
const account = (charges) => ({ id: ACCT, object: 'account', charges_enabled: charges, details_submitted: true, payouts_enabled: charges, requirements: { currently_due: [], disabled_reason: null } });
const json = (data, status = 200) => ({ status, headers: { 'request-id': 'req_fixture' }, body: JSON.stringify(data) });

async function withApp({ clients = 1 } = {}, fn) {
  const transport = async (signed) => { throw new Error(`probe transport: unexpected ${signed.method} ${signed.url.pathname}`); };
  const stripe = createStripeClient({ apiKey: KEY, transport });
  await withServer(configFor(), async (base, app, deps) => {
    const repos = deps.repos;
    const freelancer = repos.freelancers.create({ email: 'f@example.test', displayName: 'Freda Lancer' });
    repos.connectedAccounts.create({ freelancerId: freelancer.id, stripeAccountId: ACCT });
    repos.connectedAccounts.updateReadiness(ACCT, readinessFromAccount(account(true), TS));
    const seeded = [];
    for (let i = 0; i < clients; i += 1) seeded.push(repos.clients.create(freelancer.id, { name: `Client ${i + 1}`, email: `client${i + 1}@example.test` }));
    const { cookie } = seedSession(repos, freelancer.id);
    const headers = signedInHeaders(base, cookie);
    const get = (path) => fetch(`${base}${path}`, { redirect: 'manual', headers });
    const post = (path, fields) => fetch(`${base}${path}`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: typeof fields === 'string' ? fields : new URLSearchParams(fields).toString() });
    await fn({ base, repos, freelancer, clients: seeded, get, post });
  }, { stripe });
}
const item = (i, d, q, p) => ({ [`lineItems[${i}][description]`]: d, [`lineItems[${i}][quantity]`]: q, [`lineItems[${i}][unitPrice]`]: p });
const valid = { daysUntilDue: '30', ...item(0, 'Work', '1', '10.00') };

test('P1 (re-run) zero clients, valid form, intent=save, no client', async () => {
  await withApp({ clients: 0 }, async ({ post, repos, freelancer }) => {
    const res = await post(NEW, { intent: 'save', pickerMode: 'new', ...valid });
    const html = await res.text();
    console.log('P1', res.status, stateOf(html), 'markers', markers(html), 'banner', bannerCount(html), 'AddFirst', occ(html, 'Add the client first.'), 'Select', occ(html, 'Select a client.'));
    assert.equal(res.status, 400); assert.equal(markers(html), 1); assert.equal(bannerCount(html), 1);
    assert.equal(repos.invoices.listByFreelancer(freelancer.id).length, 0);
  });
});

test('P2 (re-run) one client, picker toggled to new, intent=send, no client', async () => {
  await withApp({ clients: 1 }, async ({ post, repos, freelancer }) => {
    const res = await post(NEW, { intent: 'send', pickerMode: 'new', ...valid });
    const html = await res.text();
    console.log('P2', res.status, stateOf(html), 'markers', markers(html), 'banner', bannerCount(html), 'AddFirst', occ(html, 'Add the client first.'), 'toggle', occ(html, 'value="existing-client"'), 'select', occ(html, '<select'));
    assert.equal(res.status, 400); assert.equal(markers(html), 1); assert.equal(bannerCount(html), 1);
    assert.equal(repos.invoices.listByFreelancer(freelancer.id).length, 0);
  });
});

test('P12 add-new mode with a line-item error too: banner 2, markers 2, typed client name/email preserved', async () => {
  await withApp({ clients: 0 }, async ({ post }) => {
    const res = await post(NEW, { intent: 'save', pickerMode: 'new', clientName: 'Ada "Q" <b>', clientEmail: 'ada@example.test', daysUntilDue: '30', ...item(0, 'Work', '1', 'abc') });
    const html = await res.text();
    console.log('P12', res.status, stateOf(html), 'markers', markers(html), 'banner', bannerCount(html), 'name preserved', occ(html, 'value="Ada &#34;Q&#34; &lt;b&gt;"'), 'email preserved', occ(html, 'value="ada@example.test"'), 'raw <b>', occ(html, 'value="Ada "Q" <b>"'));
    assert.equal(res.status, 400); assert.equal(markers(html), 2); assert.equal(bannerCount(html), 2);
    assert.equal(occ(html, 'value="ada@example.test"'), 1);
  });
});

test('P13 add-new mode, foreign clientId smuggled in with intent=save: refused, marked once with the add-new copy, nothing written', async () => {
  await withApp({ clients: 1 }, async ({ post, repos, freelancer, base }) => {
    const other = repos.freelancers.create({ email: 'o@example.test', displayName: 'Other' });
    const foreign = repos.clients.create(other.id, { name: 'Foreign', email: 'x@example.test' });
    const res = await post(NEW, { intent: 'save', pickerMode: 'new', clientId: foreign.id, ...valid });
    const html = await res.text();
    console.log('P13', res.status, stateOf(html), 'markers', markers(html), 'banner', bannerCount(html), 'AddFirst', occ(html, 'Add the client first.'), 'Select', occ(html, 'Select a client.'), 'foreign id in html', occ(html, foreign.id));
    assert.equal(res.status, 400); assert.equal(markers(html), 1); assert.equal(bannerCount(html), 1);
    assert.equal(occ(html, foreign.id), 0);
    assert.equal(repos.invoices.listByFreelancer(freelancer.id).length, 0);
  });
});

test('P14 edit mode: POST …/edit in add-new mode without a client is marked the same way; the draft is unchanged', async () => {
  await withApp({ clients: 1 }, async ({ post, get, repos, freelancer, clients }) => {
    const draft = repos.invoices.createDraft(freelancer.id, { clientId: clients[0].id, daysUntilDue: 30, lineItems: [{ description: 'Old', quantity: 1, unitAmountMinor: 100 }] });
    const res = await post(`/invoices/${draft.id}/edit`, { intent: 'save', pickerMode: 'new', ...valid });
    const html = await res.text();
    const after = repos.invoices.getById(freelancer.id, draft.id);
    console.log('P14', res.status, stateOf(html), 'markers', markers(html), 'banner', bannerCount(html), 'AddFirst', occ(html, 'Add the client first.'), 'draft desc', after.lineItems[0].description, 'draft client', after.clientId === clients[0].id);
    assert.equal(res.status, 400); assert.equal(markers(html), 1); assert.equal(bannerCount(html), 1);
    assert.equal(after.lineItems[0].description, 'Old');
  });
});

test('P15 the slot does not leak into non-persisting intents in new mode (add-row / new-client / add-client blank)', async () => {
  await withApp({ clients: 1 }, async ({ post }) => {
    for (const intent of ['add-row', 'new-client']) {
      const res = await post(NEW, { intent, pickerMode: 'new', ...valid });
      const html = await res.text();
      console.log('P15', intent, res.status, stateOf(html), 'markers', markers(html), 'AddFirst', occ(html, 'Add the client first.'), 'client-error id', occ(html, 'id="client-error"'));
      assert.equal(res.status, 200); assert.equal(markers(html), 0); assert.equal(occ(html, 'id="client-error"'), 0);
    }
    // add-client with blank fields: the sub-form's own errors, not the picker slot.
    const res = await post(NEW, { intent: 'add-client', pickerMode: 'new', clientName: '', clientEmail: '', ...valid });
    const html = await res.text();
    console.log('P15 add-client blank', res.status, stateOf(html), 'markers', markers(html), 'AddFirst', occ(html, 'Add the client first.'), 'required', occ(html, 'This field is required.'));
    assert.equal(res.status, 400); assert.equal(stateOf(html), 'S4-CLIENT-ERROR-VALIDATION'); assert.equal(occ(html, 'id="client-error"'), 0);
  });
});

test('P16 unknown intent in new mode: dispatch banner, no field markers, no slot', async () => {
  await withApp({ clients: 0 }, async ({ post }) => {
    const res = await post(NEW, { intent: 'drop', pickerMode: 'new', ...valid });
    const html = await res.text();
    console.log('P16', res.status, stateOf(html), 'markers', markers(html), 'Choose', occ(html, 'Choose an action.'), 'slot', occ(html, 'id="client-error"'));
    assert.equal(res.status, 400); assert.equal(markers(html), 0); assert.equal(occ(html, 'id="client-error"'), 0);
  });
});

test('P17 recovery path: new-mode save fails -> add-client from the same page -> save succeeds with the new client selected', async () => {
  await withApp({ clients: 0 }, async ({ post, repos, freelancer }) => {
    const r1 = await post(NEW, { intent: 'save', pickerMode: 'new', clientName: 'Ada', clientEmail: 'ada@example.test', ...valid });
    const h1 = await r1.text();
    const r2 = await post(NEW, { intent: 'add-client', pickerMode: 'new', clientName: 'Ada', clientEmail: 'ada@example.test', ...valid });
    const h2 = await r2.text();
    const created = repos.clients.listByFreelancer(freelancer.id);
    const selected = (h2.match(/<option value="([^"]+)" selected>/) || [])[1];
    const r3 = await post(NEW, { intent: 'save', pickerMode: 'select', clientId: selected, ...valid });
    console.log('P17', r1.status, stateOf(h1), 'AddFirst', occ(h1, 'Add the client first.'), '| add-client', r2.status, stateOf(h2), 'created', created.length, 'selected==created', selected === created[0]?.id, 'slot gone', occ(h2, 'id="client-error"'), '| save', r3.status, r3.headers.get('location'));
    assert.equal(r2.status, 200); assert.equal(occ(h2, 'id="client-error"'), 0); assert.equal(r3.status, 303);
  });
});

test('P18 pure: view model, every combination of pickerMode x persisting intent x clientId error', () => {
  const clients = [{ id: 'c1', name: 'A', email: 'a@x.test' }];
  const body = (over) => ({ intent: 'save', daysUntilDue: '30', lineItems: [{ description: 'w', quantity: '1', unitPrice: '1' }], ...over });
  const out = [];
  for (const cl of [[], clients]) for (const pickerMode of ['select', 'new', 'junk']) for (const intent of ['save', 'send']) {
    const l = invoiceFormLocals({ account: { ready: true }, clients: cl, submission: parseInvoiceForm(body({ intent, pickerMode, clientId: '' })) });
    out.push([cl.length, pickerMode, intent, l.state, l.status, l.pickerMode, l.clientError, l.banner && l.banner.title].join(' | '));
  }
  console.log('P18\n' + out.join('\n'));
  for (const line of out) assert.match(line, /S4-ERROR-VALIDATION \| 400/);
});

test('P19 ids: client-error and clientId-error never both render; aria-describedby target exists when a select is marked', async () => {
  await withApp({ clients: 1 }, async ({ post }) => {
    const a = await (await post(NEW, { intent: 'save', pickerMode: 'select', clientId: '', ...valid })).text();
    const b = await (await post(NEW, { intent: 'save', pickerMode: 'new', ...valid })).text();
    console.log('P19 select-mode ids', occ(a, 'id="clientId-error"'), occ(a, 'id="client-error"'), 'describedby', occ(a, 'aria-describedby="clientId-error"'), '| new-mode ids', occ(b, 'id="clientId-error"'), occ(b, 'id="client-error"'), 'aria-invalid', occ(b, 'aria-invalid'));
    assert.equal(occ(a, 'id="client-error"'), 0); assert.equal(occ(b, 'id="clientId-error"'), 0);
  });
});
