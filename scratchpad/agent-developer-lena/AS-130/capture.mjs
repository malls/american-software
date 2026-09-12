#!/usr/bin/env node
// Capture the D1 demo artifact's screenshots (AS-90 for screen 1, AS-130 for
// all seven screens): one walk, in the demo's order, through the same POSTs
// run.mjs issues, with a fresh GET of every page it screenshots.
//
// HOST-ONLY. This drives the host's Google Chrome over the DevTools protocol
// using node's built-in WebSocket (node >= 22) — zero dependencies, nothing
// enters apps/invoicing's image or lockfile. It needs the demo SERVER running
// (apps/invoicing/demo/serve.mjs as the `demo` compose service with the
// capture override — see SKILL.md step 2 and compose.capture.yaml): the shipped
// app beside stripe-mock, not `web`, which cannot reach the mock and 503s at
// Connect start. It refuses to write a PNG unless the page it is looking at is
// on --base, at the exact path it asked for (a redirect is refused), stamped
// with the expected `data-state`, and — where a capture says so — showing the
// DOM the label implies.
//
// Mutations are the demo's own POSTs, issued FROM THE PAGE (fetch with
// redirect:'manual', so the cookie and the Origin header come from the
// browser); their Location headers are read off the DevTools Network events,
// never followed — the Connect start Location is a fixture URL nobody can open.
// The two webhooks are signed host-side with the placeholder secret exactly as
// run.mjs signs them; the two mock-minted ids they name come from serve.mjs's
// ledger (the Stripe request paths the app made — what run.mjs prints as
// "Stripe requests the app made").
//
// Usage: node capture.mjs [--base http://127.0.0.1:8349] [--ledger http://127.0.0.1:8350]
//                         [--out docs/demo/d1]
//                         [--chrome "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
//                         [--commit <sha>]   (the branch commit to record in capture.json)
//
// Exit codes: 0 captured all; 2 the server is not up at --base; 1 anything else
// (a state mismatch, a redirect, a DOM predicate false, a CDP failure) — with
// nothing written for the capture that failed and earlier PNGs left intact.

import { createHmac } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const BASE = opt('base', 'http://127.0.0.1:8349').replace(/\/$/, '');
const LEDGER = opt('ledger', 'http://127.0.0.1:8350').replace(/\/$/, '');
const OUT = resolve(opt('out', 'docs/demo/d1'));
const CHROME = opt('chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const COMMIT = opt('commit', null);

/** The merge commit of each screen — recorded in capture.json so a reader can
 *  tell which code the screenshots show. */
const SCREEN_MERGE_COMMITS = Object.freeze({
  1: '95b5ee5', // AS-45 sign in / sign up
  2: '46eea90', // AS-70 Connect Stripe
  3: '4f4ef1b', // AS-48 dashboard
  4: '7e680f8', // AS-46 invoice form
  5: '4f4ef1b', // AS-48 invoice detail
  6: '944c2ac', // AS-127 contract form
  7: '45ab932', // AS-47 contract detail
});
const TARGET = 'demo service (serve.mjs) beside stripe-mock; default network added for the host port only';

// --- the demo's fixed values (run.mjs plan §1.4) — the same walk, the same data ----

const FREELANCER = { displayName: 'Dana Reyes', email: 'dana@demo.example', password: 'correct-horse-battery' };
const CLIENT = { name: 'Northwind Studio', email: 'billing@northwind.example' };
const CONTRACT = {
  templateId: 'independent-contractor-agreement@1',
  projectDescription: 'Redesign of the Northwind Studio marketing website. Milestone 1 covers the home page and the contact form.',
  startDate: '2026-10-01',
};
const LINE_ITEM = { description: 'Website redesign — milestone 1', quantity: 1, unitAmountMinor: 1000 };
const DAYS_UNTIL_DUE = 30;
const EVENT_ACCOUNT_READY = 'evt_demo_account_ready';
const EVENT_INVOICE_PAID = 'evt_demo_invoice_paid';
/** serve.mjs's (and run.mjs's) placeholder: it signs only the two events below. */
const WEBHOOK_SECRET = 'whsec_demo_placeholder';

/** What earlier steps hand to later ones. */
const walk = { clientId: null, contractId: null, invoiceId: null, stripeAccountId: null, stripeInvoiceId: null };

const PHONE = { width: 375, height: 812, mobile: true };
const DESKTOP = { width: 1280, height: 800, mobile: false };

/** The gate layer on screen 3: the "New invoice" nav item is a disabled span,
 *  never a link, until the account is ready (dashboard-view.js). It is a layer,
 *  not a stamped state, so it is asserted on the DOM. */
const GATE_PRESENT = `document.querySelector('.site-nav__item--disabled') !== null && document.querySelector('a[href="/invoices/new"]') === null`;
const GATE_ABSENT = `document.querySelector('.site-nav__item--disabled') === null && document.querySelector('a[href="/invoices/new"]') !== null`;

/** A pair of captures at both widths for one path and state. */
const both = (slug, path, state, extra = {}) => [
  { file: `${slug}-375.png`, ...PHONE, path, state, ...extra },
  { file: `${slug}-1280.png`, ...DESKTOP, path, state, ...extra },
];

/** The walk: `do` steps mutate (through the demo's own POSTs), capture steps
 *  screenshot a fresh GET of `path` (a string, or a function of the walk
 *  state). `submit` presses a real form button on the page and screenshots the
 *  server's re-render (POST-only states, never a hand-built URL). */
const WALK = [
  // screen 1, signed out, first (unchanged from AS-90)
  ...both('screen-1-signin', '/signin', 'S1-DEFAULT-SIGNIN'),
  ...both('screen-1-signup', '/signin?mode=signup', 'S1-DEFAULT-SIGNUP'),
  {
    file: 'screen-1-error-validation-375.png', ...PHONE, path: '/signin', state: 'S1-ERROR-VALIDATION',
    submit: { before: 'S1-DEFAULT-SIGNIN', form: 'form[action="/signin"]', fill: { 'input[name="email"]': FREELANCER.email, 'input[name="password"]': '' }, button: 'button[type="submit"]' },
  },
  // sign up through the real form (demo step 1); the browser follows the 303 to /
  { do: signUp },
  // #6 first run: the dashboard's empty state, with the Stripe gate layered on
  ...both('screen-3-empty-firstrun', '/', 'S3-EMPTY-FIRSTRUN', { layer: 'S3-GATED-STRIPENOTREADY', dom: GATE_PRESENT }),
  // #7, #8 before Connect
  ...both('screen-2-default-notstarted', '/connect-stripe', 'S2-DEFAULT-NOTSTARTED'),
  ...both('screen-4-gated-stripenotready', '/invoices/new', 'S4-GATED-STRIPENOTREADY'),
  // #9 demo steps 3–4: start (Location never followed) and return
  { do: connectStartAndReturn },
  ...both('screen-2-return-notready', '/connect-stripe', 'S2-RETURN-NOTREADY'),
  // #10 demo step 5: the self-signed account.updated
  { do: readiness },
  ...both('screen-2-return-ready', '/connect-stripe', 'S2-RETURN-READY'),
  // #11, #12 demo step 6, then the contract form
  { do: addClient },
  ...both('screen-6-default', '/contracts/new', 'S6-DEFAULT'),
  {
    file: 'screen-6-error-validation-375.png', ...PHONE, path: '/contracts/new', state: 'S6-ERROR-VALIDATION',
    submit: { before: 'S6-DEFAULT', form: 'main form[method="post"]', fill: { '[name="projectDescription"]': '' }, button: 'button[name="intent"][value="generate"]' },
  },
  // #13 demo step 7, then the contract document (and its print view)
  { do: generateContract },
  ...both('screen-7-default', (s) => `/contracts/${s.contractId}`, 'S7-DEFAULT'),
  { file: 'screen-7-default-1280-print.png', ...DESKTOP, path: (s) => `/contracts/${s.contractId}`, state: 'S7-DEFAULT', media: 'print' },
  // #14, #15 the invoice form, ready and with a client
  ...both('screen-4-default-create', '/invoices/new', 'S4-DEFAULT-CREATE'),
  {
    file: 'screen-4-error-validation-375.png', ...PHONE, path: '/invoices/new', state: 'S4-ERROR-VALIDATION',
    submit: { before: 'S4-DEFAULT-CREATE', form: 'main form[method="post"]', fill: { 'input[name="lineItems[0][description]"]': '' }, button: 'button[name="intent"][value="save"]' },
  },
  // #16 demo step 8: the draft, on its edit form and its detail page
  { do: draftInvoice },
  ...both('screen-4-default-edit', (s) => `/invoices/${s.invoiceId}/edit`, 'S4-DEFAULT-EDIT'),
  ...both('screen-5-default-draft', (s) => `/invoices/${s.invoiceId}`, 'S5-DEFAULT-DRAFT'),
  // #17 demo steps 9–10: finalize + send (the fixture answered)
  { do: finalizeAndSend },
  ...both('screen-5-default-open', (s) => `/invoices/${s.invoiceId}`, 'S5-DEFAULT-OPEN'),
  // #18 demo step 11: the self-signed invoice.paid
  { do: paid },
  ...both('screen-5-default-paid', (s) => `/invoices/${s.invoiceId}`, 'S5-DEFAULT-PAID'),
  // #19 the dashboard last: contract and paid invoice in the tables, gate off
  ...both('screen-3-default-populated', '/', 'S3-DEFAULT-POPULATED', { dom: GATE_ABSENT }),
];

// --- 1. the server is up ---------------------------------------------------------

let health;
try {
  health = await fetch(`${BASE}/healthz`, { signal: AbortSignal.timeout(3000) });
} catch (err) {
  console.error(`capture: ${BASE}/healthz is unreachable (${err.message}). Start the demo server first (SKILL.md step 2):\n  docker compose -p <scratch> -f apps/invoicing/compose.yaml -f .claude/skills/d1-demo-artifact/compose.capture.yaml run --rm -d --build -p 127.0.0.1:8349:8348 -p 127.0.0.1:8350:8350 --name <scratch>-web demo node demo/serve.mjs`);
  process.exit(2);
}
if (health.status !== 200) {
  console.error(`capture: ${BASE}/healthz answered ${health.status}, expected 200`);
  process.exit(2);
}
try {
  const ledger = await fetch(`${LEDGER}/stripe-requests`, { signal: AbortSignal.timeout(3000) });
  if (ledger.status !== 200) throw new Error(`answered ${ledger.status}`);
} catch (err) {
  console.error(`capture: ${LEDGER}/stripe-requests is unreachable (${err.message}) — is the demo server serve.mjs, with its ledger port published?`);
  process.exit(2);
}
if (!existsSync(CHROME)) {
  console.error(`capture: Chrome not found at ${CHROME} (pass --chrome <path>)`);
  process.exit(1);
}

// --- 2. Chrome + a CDP session --------------------------------------------------

const profile = mkdtempSync(join(tmpdir(), 'asc-demo-chrome-'));
const chrome = spawn(CHROME, [
  '--headless=new',
  '--remote-debugging-port=0',
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--hide-scrollbars',
  '--disable-gpu',
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let chromeStderr = '';
chrome.stderr.on('data', (d) => { chromeStderr += d; });

const cleanup = () => {
  try { chrome.kill('SIGKILL'); } catch { /* already gone */ }
  // Chrome's helper processes can still be writing for a moment after the
  // kill; retry, and if the profile still will not go, say where it is.
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  } catch (err) {
    console.error(`capture: could not remove the temporary Chrome profile ${profile} (${err.code}); remove it by hand`);
  }
};
process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(1));

/** Chrome writes `<port>\n<browser ws path>` here once the debugger is listening. */
async function devtoolsPort() {
  const file = join(profile, 'DevToolsActivePort');
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    if (existsSync(file)) {
      const [port] = readFileSync(file, 'utf8').split('\n');
      if (/^\d+$/.test(port)) return Number(port);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Chrome did not open a DevTools port within 15 s\n${chromeStderr}`);
}

const port = await devtoolsPort();
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
if (!page) throw new Error('no page target');
const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();

/** A minimal CDP client over the page target's own socket (no session ids). */
function connect(url) {
  const ws = new WebSocket(url);
  let nextId = 0;
  const pending = new Map();
  const listeners = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== undefined) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (!p) return;
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
      else p.resolve(msg.result);
    } else if (msg.method && listeners.has(msg.method)) {
      for (const fn of [...listeners.get(msg.method)]) fn(msg.params);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = (nextId += 1);
    pending.set(id, { resolve, reject, method });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const on = (method, fn) => {
    if (!listeners.has(method)) listeners.set(method, new Set());
    listeners.get(method).add(fn);
    return () => listeners.get(method).delete(fn);
  };
  const once = (method) => new Promise((resolve) => {
    const off = on(method, (params) => { off(); resolve(params); });
  });
  const open = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', (e) => reject(new Error(`websocket: ${e.message ?? 'error'}`)), { once: true });
  });
  return { send, on, once, open, close: () => ws.close() };
}

const cdp = connect(page.webSocketDebuggerUrl);
await cdp.open;
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Network.enable');

const evaluate = async (expression, { awaitPromise = false } = {}) => {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  if (exceptionDetails) throw new Error(`evaluate failed: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
  return result.value;
};

async function navigate(url) {
  const loaded = cdp.once('Page.loadEventFired');
  const { errorText } = await cdp.send('Page.navigate', { url });
  if (errorText) throw new Error(`navigate ${url}: ${errorText}`);
  await loaded;
}

/** The guard of step 3: refuse to save anything that is not the named state on
 *  this origin. A redirect to a 404, a sign-in bounce, or an unstyled page all
 *  fail here rather than becoming a PNG with a misleading name. */
async function assertState(expected, expectedPath) {
  const info = await evaluate('JSON.stringify({ href: location.href, origin: location.origin, path: location.pathname + location.search, state: document.documentElement.dataset.state ?? null, styled: getComputedStyle(document.body).fontFamily })');
  const { href, origin, path, state, styled } = JSON.parse(info);
  if (origin !== BASE) throw new Error(`page is on ${origin}, expected ${BASE} (href ${href})`);
  // A redirect is refused even when it lands on a real state: a signed-out `/`
  // bounces to /signin?next=%2F, which IS S1-DEFAULT-SIGNIN — and a PNG named
  // for one URL showing another is exactly the misleading capture this guards.
  if (path !== expectedPath) throw new Error(`page landed on ${path}, expected ${expectedPath} — a redirect is not the page it was asked for; refusing to write the screenshot`);
  if (state !== expected) throw new Error(`page at ${href} is in state ${JSON.stringify(state)}, expected ${expected} — refusing to write the screenshot`);
  if (typeof styled !== 'string' || styled === '') throw new Error('page has no computed font-family — stylesheets did not load');
  return href;
}

/** A layer the label implies but the root does not stamp (screen 3's Stripe
 *  gate) is asserted on the DOM, or the PNG is refused. */
async function assertDom(predicate, label) {
  const ok = await evaluate(`Boolean(${predicate})`);
  if (ok !== true) throw new Error(`page does not show what ${label} implies (DOM predicate false: ${predicate}) — refusing to write the screenshot`);
}

async function fullPagePng() {
  const { cssContentSize } = await cdp.send('Page.getLayoutMetrics');
  const { data } = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: Math.ceil(cssContentSize.width), height: Math.ceil(cssContentSize.height), scale: 1 },
  });
  return Buffer.from(data, 'base64');
}

// --- the demo's own requests, from the page ---------------------------------------

/** One request issued by the page itself: fetch with redirect:'manual', so the
 *  browser supplies the session cookie and the Origin header and never follows
 *  a Location. The status and the Location come from the DevTools Network
 *  events for that request (the page cannot read an opaque redirect). */
async function pageRequest(method, path, fields = null) {
  const url = `${BASE}${path}`;
  let requestId = null;
  const answer = new Promise((resolve, reject) => {
    const offs = [];
    const done = (value, err) => { for (const off of offs) off(); err ? reject(err) : resolve(value); };
    offs.push(cdp.on('Network.requestWillBeSent', (p) => {
      if (requestId === null && p.request.method === method && p.request.url === url) requestId = p.requestId;
      else if (p.requestId === requestId && p.redirectResponse) {
        done({ status: p.redirectResponse.status, location: p.redirectResponse.headers.location ?? p.redirectResponse.headers.Location ?? null });
      }
    }));
    offs.push(cdp.on('Network.responseReceived', (p) => {
      if (p.requestId !== requestId) return;
      done({ status: p.response.status, location: p.response.headers.location ?? p.response.headers.Location ?? null });
    }));
    offs.push(cdp.on('Network.loadingFailed', (p) => {
      if (p.requestId === requestId) done(null, new Error(`${method} ${path}: ${p.errorText}`));
    }));
    setTimeout(() => done(null, new Error(`${method} ${path}: no response event within 15 s`)), 15_000).unref();
  });
  const init = { method, redirect: 'manual', credentials: 'same-origin' };
  if (method === 'POST') {
    init.headers = { 'content-type': 'application/x-www-form-urlencoded' };
    init.body = new URLSearchParams(fields ?? {}).toString();
  }
  await evaluate(`fetch(${JSON.stringify(url)}, ${JSON.stringify(init)}).then((r) => r.type)`, { awaitPromise: true });
  return answer;
}

function expectStatus(res, status, what) {
  if (res.status !== status) throw new Error(`${what}: expected ${status}, got ${res.status}`);
}

/** The two events, signed host-side with the placeholder secret exactly as
 *  run.mjs signs them: `t=<unix>,v1=<hex sha256 HMAC(secret, "<t>.<raw body>")>`. */
async function deliver(event) {
  const payload = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', WEBHOOK_SECRET).update(`${t}.${payload}`, 'utf8').digest('hex');
  const res = await fetch(`${BASE}/webhooks/stripe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': `t=${t},v1=${v1}` },
    body: payload,
    redirect: 'manual',
  });
  return { status: res.status, body: await res.text() };
}

const envelope = (id, type, object) => ({ id, object: 'event', api_version: '2026-08-26.dahlia', created: Math.floor(Date.now() / 1000), type, data: { object } });

/** The Stripe paths the app has made so far, from serve.mjs's ledger. */
async function ledgerMatch(pattern, what) {
  const paths = await (await fetch(`${LEDGER}/stripe-requests`)).json();
  const hit = paths.map((p) => pattern.exec(p)).filter(Boolean).pop();
  if (!hit) throw new Error(`${what}: no Stripe request matching ${pattern} in the ledger (${paths.length} requests)`);
  return hit[1];
}

// --- the `do` steps, in the demo's order -------------------------------------------

async function signUp() {
  await cdp.send('Emulation.setDeviceMetricsOverride', { ...DESKTOP, deviceScaleFactor: 1 });
  await navigate(`${BASE}/signin?mode=signup`);
  await assertState('S1-DEFAULT-SIGNUP', '/signin?mode=signup');
  const loaded = cdp.once('Page.loadEventFired');
  await evaluate(`(() => {
    const form = document.querySelector('form[action="/signup"]');
    form.querySelector('input[name="displayName"]').value = ${JSON.stringify(FREELANCER.displayName)};
    form.querySelector('input[name="email"]').value = ${JSON.stringify(FREELANCER.email)};
    form.querySelector('input[name="password"]').value = ${JSON.stringify(FREELANCER.password)};
    form.querySelector('button[type="submit"]').click();
    return true;
  })()`);
  await loaded;
  // The form's own 303 lands on the dashboard; the captures below are fresh GETs.
  await assertState('S3-EMPTY-FIRSTRUN', '/');
  console.log(`signed up ${FREELANCER.email} through the real form`);
}

async function connectStartAndReturn() {
  const start = await pageRequest('POST', '/connect-stripe/start');
  expectStatus(start, 303, 'POST /connect-stripe/start');
  if (typeof start.location !== 'string' || start.location.startsWith(BASE) || start.location.startsWith('/')) {
    throw new Error(`POST /connect-stripe/start: expected a hosted-onboarding Location off this origin, got ${JSON.stringify(start.location)}`);
  }
  // Never followed: it is the validator's fixture URL, not a page anyone can open.
  const ret = await pageRequest('GET', '/connect-stripe/return');
  expectStatus(ret, 303, 'GET /connect-stripe/return');
  walk.stripeAccountId = await ledgerMatch(/^GET \/v1\/accounts\/(acct_[A-Za-z0-9]+)$/, 'Connect return');
  console.log(`connect started (Location not followed) and returned; account ${walk.stripeAccountId}`);
}

async function readiness() {
  const event = envelope(EVENT_ACCOUNT_READY, 'account.updated', {
    id: walk.stripeAccountId,
    object: 'account',
    charges_enabled: true,
    details_submitted: true,
    payouts_enabled: true,
    requirements: { currently_due: [], disabled_reason: null },
  });
  const res = await deliver(event);
  expectStatus(res, 200, `POST /webhooks/stripe (${event.id})`);
  console.log(`delivered ${event.id} (${event.type}) — signed by us`);
}

async function addClient() {
  const res = await pageRequest('POST', '/clients', { ...CLIENT, next: '/' });
  expectStatus(res, 303, 'POST /clients');
  const m = /^\/\?clientId=([^&]+)$/.exec(res.location ?? '');
  if (!m) throw new Error(`POST /clients: expected Location /?clientId=…, got ${JSON.stringify(res.location)}`);
  walk.clientId = decodeURIComponent(m[1]);
  console.log(`client ${walk.clientId}`);
}

async function generateContract() {
  const res = await pageRequest('POST', '/contracts', { clientId: walk.clientId, ...CONTRACT });
  expectStatus(res, 303, 'POST /contracts');
  const m = /^\/contracts\/([^/?]+)$/.exec(res.location ?? '');
  if (!m) throw new Error(`POST /contracts: expected Location /contracts/<id>, got ${JSON.stringify(res.location)}`);
  walk.contractId = decodeURIComponent(m[1]);
  console.log(`contract ${walk.contractId}`);
}

async function draftInvoice() {
  const res = await pageRequest('POST', '/invoices', {
    clientId: walk.clientId,
    daysUntilDue: String(DAYS_UNTIL_DUE),
    currency: 'usd',
    'lineItems[0][description]': LINE_ITEM.description,
    'lineItems[0][quantity]': String(LINE_ITEM.quantity),
    'lineItems[0][unitAmountMinor]': String(LINE_ITEM.unitAmountMinor),
  });
  expectStatus(res, 303, 'POST /invoices');
  const m = /^\/invoices\/([^/?]+)\/edit$/.exec(res.location ?? '');
  if (!m) throw new Error(`POST /invoices: expected Location /invoices/<id>/edit, got ${JSON.stringify(res.location)}`);
  walk.invoiceId = decodeURIComponent(m[1]);
  console.log(`invoice draft ${walk.invoiceId}`);
}

async function finalizeAndSend() {
  const id = encodeURIComponent(walk.invoiceId);
  expectStatus(await pageRequest('POST', `/invoices/${id}/finalize`), 303, 'POST /invoices/:id/finalize');
  expectStatus(await pageRequest('POST', `/invoices/${id}/send`), 303, 'POST /invoices/:id/send');
  walk.stripeInvoiceId = await ledgerMatch(/^POST \/v1\/invoices\/(in_[A-Za-z0-9]+)\/finalize$/, 'finalize');
  console.log(`finalized and sent; Stripe invoice ${walk.stripeInvoiceId} (the fixture answered)`);
}

async function paid() {
  const paidAt = Math.floor(Date.now() / 1000);
  const amount = LINE_ITEM.quantity * LINE_ITEM.unitAmountMinor;
  const event = envelope(EVENT_INVOICE_PAID, 'invoice.paid', {
    id: walk.stripeInvoiceId,
    object: 'invoice',
    status: 'paid',
    currency: 'usd',
    amount_due: amount,
    amount_paid: amount,
    hosted_invoice_url: null,
    invoice_pdf: null,
    due_date: paidAt + DAYS_UNTIL_DUE * 86_400,
    status_transitions: { finalized_at: paidAt - 60, paid_at: paidAt, voided_at: null, marked_uncollectible_at: null },
  });
  const res = await deliver(event);
  expectStatus(res, 200, `POST /webhooks/stripe (${event.id})`);
  console.log(`delivered ${event.id} (${event.type}) — signed by us`);
}

// --- 3. the walk --------------------------------------------------------------------

mkdirSync(OUT, { recursive: true });
const written = [];
try {
  for (const step of WALK) {
    if (step.do) {
      await step.do();
      continue;
    }
    const c = step;
    const path = typeof c.path === 'function' ? c.path(walk) : c.path;
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: c.width, height: c.height, deviceScaleFactor: 1, mobile: c.mobile });
    await navigate(`${BASE}${path}`);
    if (c.submit !== undefined) {
      // The real form: fill what the capture says, press the form's own
      // button, and wait for the server's re-render — which answers at the
      // same path (POST-only states are never reached by a hand-built URL).
      await assertState(c.submit.before, path);
      const loaded = cdp.once('Page.loadEventFired');
      await evaluate(`(() => {
        const form = document.querySelector(${JSON.stringify(c.submit.form)});
        for (const [sel, value] of Object.entries(${JSON.stringify(c.submit.fill)})) form.querySelector(sel).value = value;
        form.querySelector(${JSON.stringify(c.submit.button)}).click();
        return true;
      })()`);
      await loaded;
    }
    const href = await assertState(c.state, path);
    if (c.dom !== undefined) await assertDom(c.dom, c.layer ?? c.state);
    if (c.media !== undefined) await cdp.send('Emulation.setEmulatedMedia', { media: c.media });
    let png;
    try {
      png = await fullPagePng();
    } finally {
      if (c.media !== undefined) await cdp.send('Emulation.setEmulatedMedia', { media: '' });
    }
    const target = join(OUT, c.file);
    writeFileSync(target, png);
    const record = { file: c.file, state: c.state, width: c.width, height: c.height, url: href, bytes: png.length };
    if (c.layer !== undefined) record.layer = c.layer;
    if (c.media !== undefined) record.media = c.media;
    written.push(record);
    console.log(`wrote ${target} (${c.state}${c.layer ? ` + ${c.layer}` : ''}${c.media ? `, ${c.media} media` : ''} @ ${c.width}px, ${(png.length / 1024).toFixed(1)} kB)`);
  }
} catch (err) {
  console.error(`capture: ${err.message}`);
  cdp.close();
  process.exit(1);
}
cdp.close();

// --- 4. capture.json ------------------------------------------------------------

const branchCommit = COMMIT ?? (() => {
  try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return null; }
})();
const record = {
  screenMergeCommits: SCREEN_MERGE_COMMITS,
  branchCommit,
  capturedAt: new Date().toISOString(),
  chrome: version.Browser,
  method: 'cdp (node built-in WebSocket; Page.captureScreenshot full page)',
  base: BASE,
  target: TARGET,
  captures: written,
};
writeFileSync(join(OUT, 'capture.json'), `${JSON.stringify(record, null, 2)}\n`);
console.log(`wrote ${join(OUT, 'capture.json')} (${written.length} captures, ${version.Browser}, branch ${branchCommit})`);
// Explicit: the Chrome child would otherwise keep the event loop alive forever.
// The 'exit' handler above kills it and removes the temp profile.
process.exit(0);
