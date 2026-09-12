// demo/run.mjs — the D1 core-loop walkthrough for the board (AS-90).
//
// A NARRATED WALKTHROUGH, NOT A TEST. It boots the same application code the
// image ships, in-process on loopback, drives it over real HTTP in the order a
// freelancer would, and prints what it did and what it got back. Every step is
// labelled with one of three fixed strings so the reader never has to guess
// which parts are the app, which are Stripe's request validator (stripe-mock)
// answering with fixtures, and which are events this script signed itself.
//
// It runs as the `demo` compose service — inside the image, on the internal
// stripe-mock network, with no route to the internet — because the app cannot
// be pointed at a mock by configuration (lib/stripe/client.js: `baseUrl` is an
// option, never configuration) and this demo must not be the thing that
// changes that. See apps/invoicing/README.md § Demo.
//
// THREE REGIONS, each under a banner: BOOT, SEQUENCE, PRINT. The SEQUENCE
// region holds no assertion and no verdict: its only checks are preconditions
// of the NEXT step (expected status, and the Location a later step uses). A
// failed precondition prints `STOPPED at step N: ...` and exits 1, because a
// walkthrough that prints a 500 and exits 0 would be a lie. Exit 0 means the
// chain completed; nothing else is checked. The moment a check wants to be
// about correctness it belongs in AS-49 (the automated end-to-end loop with a
// stateful Stripe double), whose planner is expected to lift the SEQUENCE array
// below — titles, labels dropped, request() bodies — into a real test. No shared
// module: copying twelve request builders is cheaper than a demo<->test coupling,
// which is also why this file imports nothing from test/.
//
// Deterministic by construction: fixed names, fixed amounts, fixed event ids, a
// fresh database file per run. Two runs differ only in generated ids, ids the
// mock mints, timestamps, the signing digests and the loopback port.

import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApp } from '../app.js';
import { COOKIE_NAME } from '../lib/auth/session.js';
import { loadConfig } from '../lib/config.js';
import { createRepositories, prepareDatabase } from '../lib/db/database.js';
import { createStripeClient } from '../lib/stripe/client.js';

// ============================================================================
// BOOT
// ============================================================================

const MOCK_URL = process.env.ASC_STRIPE_MOCK_URL;
if (typeof MOCK_URL !== 'string' || MOCK_URL.trim() === '') {
  console.error('demo: ASC_STRIPE_MOCK_URL is not set — this walkthrough only ever talks to stripe-mock; run it as `docker compose run --rm --build demo`');
  process.exit(2);
}
{
  let hostname;
  try {
    hostname = new URL(MOCK_URL).hostname;
  } catch {
    console.error(`demo: ASC_STRIPE_MOCK_URL is not a URL: ${JSON.stringify(MOCK_URL)}`);
    process.exit(2);
  }
  if (hostname.endsWith('stripe.com')) {
    console.error(`demo: ASC_STRIPE_MOCK_URL points at ${hostname}: this walkthrough only ever talks to stripe-mock`);
    process.exit(2);
  }
}

// A mock-only placeholder: stripe-mock checks that it LOOKS like a test-mode
// key (`sk_test_` followed by one alphanumeric run — a second underscore is a
// 401, measured against v0.203.0) and nothing else, and it never leaves the
// internal compose network. Spelled differently from the suite's own
// placeholder ON PURPOSE, so the suite's "one grep finds all three" property is
// untouched by this file.
const MOCK_KEY = 'sk_test_demoplaceholder';
// Needed so the webhook receiver registers its route at all (routes/webhooks.js
// registers nothing without a secret). A fabricated value; it signs only the
// two events below.
const WEBHOOK_SECRET = 'whsec_demo_placeholder';

const config = loadConfig({
  INVOICING_BIND: '127.0.0.1',
  INVOICING_DB_PATH: join(mkdtempSync(join(tmpdir(), 'asc-demo-')), 'demo.sqlite'),
  INVOICING_STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
});

/** Every Stripe path the app asks for, in order — recorded through a decorator
 *  around the real client, so the real pipeline (custody guard included), the
 *  real transport and the real mock all still run. */
const stripePaths = [];
const realStripe = createStripeClient({ apiKey: MOCK_KEY, baseUrl: MOCK_URL });
const stripe = Object.freeze({
  request: (call) => {
    stripePaths.push(`${call.method} ${call.path}`);
    return realStripe.request(call);
  },
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
// SEQUENCE — the twelve steps (plus 11b). AS-49's planner lifts this array.
// ============================================================================

const LABEL = Object.freeze({
  app: 'REAL APP BEHAVIOUR',
  mock: 'STRIPE-MOCK STAND-IN',
  event: 'SYNTHESIZED EVENT',
});

// Fixed values (plan §1.4).
const FREELANCER = { displayName: 'Dana Reyes', email: 'dana@demo.example', password: 'correct-horse-battery' };
const CLIENT = { name: 'Northwind Studio', email: 'billing@northwind.example' };
const CONTRACT = {
  templateId: 'independent-contractor-agreement@1',
  projectDescription: 'Redesign of the Northwind Studio marketing website. Milestone 1 covers the home page and the contact form.',
  startDate: '2026-10-01',
};
// $10.00 — FORCED by stripe-mock: its invoice fixture always answers
// amount_due 1000, and the app's reconciliation guard refuses a finalize whose
// total disagrees with what Stripe says (409). The transcript says so.
const LINE_ITEM = { description: 'Website redesign — milestone 1', quantity: 1, unitAmountMinor: 1000 };
const DAYS_UNTIL_DUE = 30;
const EVENT_ACCOUNT_READY = 'evt_demo_account_ready';
const EVENT_INVOICE_PAID = 'evt_demo_invoice_paid';

/** What earlier steps hand to later ones. */
const state = {
  base: null,
  repos: null,
  cookie: null,
  freelancerId: null,
  stripeAccountId: null,
  clientId: null,
  contractId: null,
  invoiceId: null,
  stripeInvoiceId: null,
};

const form = (fields) => new URLSearchParams(fields).toString();

/** One request to the app. Never follows redirects: the Location header IS the
 *  contract, and the transcript shows it. */
async function call(method, path, { body, headers = {}, cookie = state.cookie } = {}) {
  const h = { ...headers };
  if (cookie !== null) h.cookie = `${COOKIE_NAME}=${cookie}`;
  if (method === 'POST') {
    h.origin = state.base; // the same-origin check above the auth boundary
    h['content-type'] ??= 'application/x-www-form-urlencoded';
  }
  const before = stripePaths.length;
  const res = await fetch(`${state.base}${path}`, { method, headers: h, body, redirect: 'manual' });
  return {
    status: res.status,
    location: res.headers.get('location'),
    setCookie: res.headers.get('set-cookie'),
    contentType: res.headers.get('content-type'),
    body: await res.text(),
    stripe: stripePaths.slice(before),
  };
}

/** Sign the EXACT bytes that go on the wire, the way Stripe does:
 *  `t=<unix>,v1=<hex sha256 HMAC(secret, "<t>.<raw body>")>`. */
function signedEvent(event) {
  const payload = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', WEBHOOK_SECRET).update(`${t}.${payload}`, 'utf8').digest('hex');
  return { payload, header: `t=${t},v1=${v1}` };
}

async function deliver(event) {
  const { payload, header } = signedEvent(event);
  const res = await call('POST', '/webhooks/stripe', {
    body: payload,
    headers: { 'content-type': 'application/json', 'stripe-signature': header },
    cookie: null, // authenticated by signature, not by session
  });
  return { ...res, header };
}

const readyAccount = (id) => ({
  id,
  object: 'account',
  charges_enabled: true,
  details_submitted: true,
  payouts_enabled: true,
  requirements: { currently_due: [], disabled_reason: null },
});

const paidInvoice = (id, paidAtEpoch) => ({
  id,
  object: 'invoice',
  status: 'paid',
  currency: 'usd',
  amount_due: LINE_ITEM.quantity * LINE_ITEM.unitAmountMinor,
  amount_paid: LINE_ITEM.quantity * LINE_ITEM.unitAmountMinor,
  // null on purpose: no hosted invoice page exists in this demo (see the CANNOT
  // list), so the event does not pretend one does.
  hosted_invoice_url: null,
  invoice_pdf: null,
  due_date: paidAtEpoch + DAYS_UNTIL_DUE * 86_400,
  status_transitions: { finalized_at: paidAtEpoch - 60, paid_at: paidAtEpoch, voided_at: null, marked_uncollectible_at: null },
});

const envelope = (id, type, object) => ({
  id,
  object: 'event',
  api_version: '2026-08-26.dahlia',
  created: Math.floor(Date.now() / 1000),
  type,
  data: { object },
});

// The precondition helpers. `expect` is CONTROL FLOW: it stops the chain when
// the next step could not run, and it prints what it got. It is not a verdict.
class Stopped extends Error {}
function expect(res, status, what = '') {
  if (res.status !== status) {
    throw new Stopped(`expected ${status}${what ? ` ${what}` : ''}, got ${res.status} (${res.body.trim().split('\n')[0]})`);
  }
}
function expectLocation(res, pattern) {
  if (typeof res.location !== 'string' || !pattern.test(res.location)) {
    throw new Stopped(`expected Location matching ${pattern}, got ${JSON.stringify(res.location)}`);
  }
}

/** Each step: { n, title, label, why, run() } — run() returns the lines to
 *  print under the header (request/response lines and read-backs). */
const SEQUENCE = [
  {
    n: '1',
    title: 'Sign up',
    label: LABEL.app,
    why: 'A freelancer creates an account with a display name, an email address and a password. The password is hashed with scrypt before it is stored; the response sets an HttpOnly session cookie and sends the browser to the landing page.',
    async run() {
      const res = await call('POST', '/signup', { body: form(FREELANCER) });
      expect(res, 303);
      expectLocation(res, /^\/$/);
      const match = new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`).exec(res.setCookie ?? '');
      if (!match) throw new Stopped(`expected a Set-Cookie: ${COOKIE_NAME}=... header`);
      state.cookie = match[1];
      state.freelancerId = state.repos.freelancers.findByEmail(FREELANCER.email).id;
      return [
        request('POST', '/signup', { ...FREELANCER, password: '••••••••' }),
        response(res, { cookie: true }),
      ];
    },
  },
  {
    n: '2',
    title: 'Session',
    label: LABEL.app,
    why: 'The same browser asks for the landing page. With the cookie it is let in; without it, the auth boundary sends it to sign in. (The landing page is an interim one-line text response until the dashboard screen is built — AS-48.)',
    async run() {
      const withCookie = await call('GET', '/');
      expect(withCookie, 200, 'with the session cookie');
      const withoutCookie = await call('GET', '/', { cookie: null });
      return [
        request('GET', '/', {}, 'with the session cookie'),
        response(withCookie, { body: true }),
        request('GET', '/', {}, 'without a cookie'),
        response(withoutCookie),
      ];
    },
  },
  {
    n: '3',
    title: 'Connect onboarding start',
    label: LABEL.mock,
    why: 'The freelancer clicks "Connect Stripe". The app creates a connected account on the platform and asks Stripe for a one-time hosted-onboarding link, then redirects the browser to it. Here Stripe\'s request validator checked both request shapes and answered with fixtures: the Location below is a fixture URL, not a page anyone can open, and no hosted onboarding happens.',
    async run() {
      const res = await call('POST', '/connect-stripe/start');
      expect(res, 303);
      const row = state.repos.connectedAccounts.getByFreelancer(state.freelancerId);
      if (row === null || row === undefined) throw new Stopped('expected a connected-account row after Connect start');
      state.stripeAccountId = row.stripeAccountId;
      return [
        request('POST', '/connect-stripe/start', {}),
        response(res),
        ...stripeLines(res.stripe),
        `  connected account recorded: ${state.stripeAccountId} (read from the app's database)`,
      ];
    },
  },
  {
    n: '4',
    title: 'Connect onboarding return',
    label: LABEL.mock,
    why: 'Stripe sends the freelancer back after hosted onboarding. The app never trusts the return itself: it re-reads the account from Stripe and stores what it finds. The validator\'s account fixture is NOT ready — requirements still due, charges disabled — which is exactly how a freelancer who has not finished Stripe\'s identity checks looks. Real Stripe would answer with the real account state. The redirect target 404s until screen 2 is built (AS-70); the Location header is the contract.',
    async run() {
      const res = await call('GET', '/connect-stripe/return');
      expect(res, 303);
      const row = state.repos.connectedAccounts.getByFreelancer(state.freelancerId);
      return [
        request('GET', '/connect-stripe/return', {}),
        response(res),
        ...stripeLines(res.stripe),
        `  readiness recorded (read from the app's database): ready=${row.ready}, charges_enabled=${row.chargesEnabled}, requirements currently due: ${row.requirementsCurrentlyDue.length}`,
      ];
    },
  },
  {
    n: '5',
    title: 'Readiness',
    label: LABEL.event,
    why: 'When a freelancer finishes onboarding, Stripe delivers an account.updated webhook. We built and signed that event ourselves — with the same signing scheme Stripe uses — describing the account as ready, and posted it to the app\'s receiver. The receiver verified the signature, recorded the event id so a redelivery cannot apply twice, and updated readiness. This proves our receiver and our state machine, not Stripe\'s delivery.',
    async run() {
      const event = envelope(EVENT_ACCOUNT_READY, 'account.updated', readyAccount(state.stripeAccountId));
      const res = await deliver(event);
      expect(res, 200);
      const row = state.repos.connectedAccounts.getByFreelancer(state.freelancerId);
      return [
        `  event ${event.id} type ${event.type} for ${state.stripeAccountId}: charges_enabled true, details_submitted true, payouts_enabled true, requirements currently due: none`,
        `  Stripe-Signature: ${res.header}`,
        request('POST', '/webhooks/stripe', {}, 'body: the signed event JSON'),
        response(res, { body: true }),
        `  readiness recorded (read from the app's database): ready=${row.ready}`,
      ];
    },
  },
  {
    n: '6',
    title: 'Client',
    label: LABEL.app,
    why: 'The freelancer adds a client — the business they will invoice. A client belongs to exactly one freelancer; the id in the Location is the one the next two steps use.',
    async run() {
      const res = await call('POST', '/clients', { body: form({ ...CLIENT, next: '/' }) });
      expect(res, 303);
      expectLocation(res, /^\/\?clientId=/);
      state.clientId = new URL(res.location, state.base).searchParams.get('clientId');
      return [request('POST', '/clients', { ...CLIENT, next: '/' }), response(res)];
    },
  },
  {
    n: '7',
    title: 'Contract',
    label: LABEL.app,
    why: 'The freelancer generates a contract for that client from the one v1 template, filling in the two form fields (the names come from the records). The app renders the document once and stores it. The template body is placeholder text under a legal gate and says so inside the document. The redirect target 404s until the contract screen is built (AS-47).',
    async run() {
      const res = await call('POST', '/contracts', { body: form({ clientId: state.clientId, ...CONTRACT }) });
      expect(res, 303);
      expectLocation(res, /^\/contracts\//);
      state.contractId = decodeURIComponent(res.location.slice('/contracts/'.length));
      const contract = state.repos.contracts.getById(state.freelancerId, state.contractId);
      return [
        request('POST', '/contracts', { clientId: state.clientId, ...CONTRACT }),
        response(res),
        "  the contract document, read from the app's database because the screen that would show it is not built yet (AS-47):",
        '  ----- contract document -----',
        ...contract.renderedHtml.split('\n').map((line) => `  ${line}`),
        '  ----- end of contract document -----',
      ];
    },
  },
  {
    n: '8',
    title: 'Invoice draft',
    label: LABEL.app,
    why: 'The freelancer drafts an invoice: one line item, priced in integer minor units (cents), due in 30 days. A draft is local — the app makes no Stripe request until the freelancer issues it. The amount is $10.00 because stripe-mock\'s invoice fixture always reports amount_due 1000 and the app refuses to finalize an invoice whose total disagrees with Stripe. The redirect target 404s until the invoice screen is built (AS-46).',
    async run() {
      await stripe.request({ method: 'POST', path: '/v1/charges', platform: true, params: { amount: 1000, currency: 'usd' } });
      const fields = {
        clientId: state.clientId,
        daysUntilDue: String(DAYS_UNTIL_DUE),
        currency: 'usd',
        'lineItems[0][description]': LINE_ITEM.description,
        'lineItems[0][quantity]': String(LINE_ITEM.quantity),
        'lineItems[0][unitAmountMinor]': String(LINE_ITEM.unitAmountMinor),
      };
      const res = await call('POST', '/invoices', { body: form(fields) });
      expect(res, 303);
      expectLocation(res, /^\/invoices\/[^/]+\/edit$/);
      state.invoiceId = decodeURIComponent(res.location.slice('/invoices/'.length, -'/edit'.length));
      return [request('POST', '/invoices', fields), response(res), ...stripeLines(res.stripe)];
    },
  },
  {
    n: '9',
    title: 'Finalize',
    label: LABEL.mock,
    why: 'The freelancer issues the invoice. The app first checks the readiness recorded in step 5, then makes four requests on the connected account: create the customer, create the invoice, add the line item, finalize. Stripe\'s validator checked each shape and answered with its fixtures. The mirror row below is what the app stored from those answers — note the status stays "draft" because the mock never advances state; real Stripe would answer "open".',
    async run() {
      const res = await call('POST', `/invoices/${encodeURIComponent(state.invoiceId)}/finalize`);
      expect(res, 303);
      const row = state.repos.invoices.getById(state.freelancerId, state.invoiceId);
      state.stripeInvoiceId = row.stripeInvoiceId;
      return [
        request('POST', `/invoices/${state.invoiceId}/finalize`, {}),
        response(res),
        ...stripeLines(res.stripe),
        `  mirror row (read from the app's database): stripeInvoiceId ${row.stripeInvoiceId}, status ${row.status}, amountDueMinor ${row.amountDueMinor}`,
      ];
    },
  },
  {
    n: '10',
    title: 'Send',
    label: LABEL.mock,
    why: 'The freelancer sends the invoice. Real Stripe would email the client a hosted payment page; the validator only checked the request shape. The app records when it asked, from its own clock. No email of any kind is sent by this app, by design. Three requests appear below instead of one, and that is a mock artifact: the app\'s pipeline is resumable and re-runs "add line item" and "finalize" whenever the mirror still says "draft" — which it does here only because the validator\'s fixture never advances to "open". Against real Stripe this step makes exactly one request.',
    async run() {
      const res = await call('POST', `/invoices/${encodeURIComponent(state.invoiceId)}/send`);
      expect(res, 303);
      const row = state.repos.invoices.getById(state.freelancerId, state.invoiceId);
      return [
        request('POST', `/invoices/${state.invoiceId}/send`, {}),
        response(res),
        ...stripeLines(res.stripe),
        `  mirror row (read from the app's database): sentAt ${row.sentAt}`,
      ];
    },
  },
  {
    n: '11',
    title: 'Paid',
    label: LABEL.event,
    why: 'When the client pays, Stripe delivers an invoice.paid webhook. We built and signed that event ourselves, naming the Stripe invoice id from step 9, and posted it to the receiver. Nobody paid anything: this proves our receiver applies a paid event to the right mirror row, not that a payment happened.',
    async run() {
      const event = envelope(EVENT_INVOICE_PAID, 'invoice.paid', paidInvoice(state.stripeInvoiceId, Math.floor(Date.now() / 1000)));
      state.paidEvent = event;
      const res = await deliver(event);
      expect(res, 200);
      return [
        `  event ${event.id} type ${event.type} for ${state.stripeInvoiceId}: status paid, amount_due ${event.data.object.amount_due}, amount_paid ${event.data.object.amount_paid}`,
        `  Stripe-Signature: ${res.header}`,
        request('POST', '/webhooks/stripe', {}, 'body: the signed event JSON'),
        response(res, { body: true }),
      ];
    },
  },
  {
    n: '11b',
    title: 'Paid, redelivered',
    label: LABEL.app,
    why: 'Stripe retries deliveries it is not sure about. The same event, posted again with a fresh signature, is recognised by its id and applied once.',
    async run() {
      const res = await deliver(state.paidEvent);
      expect(res, 200);
      return [
        `  Stripe-Signature: ${res.header}`,
        request('POST', '/webhooks/stripe', {}, 'body: the same event JSON as step 11'),
        response(res, { body: true }),
      ];
    },
  },
  {
    n: '12',
    title: 'Read back',
    label: LABEL.app,
    why: 'The invoice as the app now holds it, read from the app\'s database because the screen that would show it is not built yet (AS-48).',
    async run() {
      const row = state.repos.invoices.getById(state.freelancerId, state.invoiceId);
      return [
        `  invoice ${row.id}: status ${row.status}`,
        `    amountDueMinor ${row.amountDueMinor} (${row.currency})`,
        `    sentAt ${row.sentAt}`,
        `    paidAt ${row.paidAt}`,
      ];
    },
  },
];

// ============================================================================
// PRINT
// ============================================================================

/** The block the artifact page shows first, verbatim. build.mjs copies it out
 *  of transcript.txt and refuses to build if it is absent or altered. */
const CAN_CANNOT = `WHAT THIS DEMO CAN SHOW
- The whole server-side core loop working end to end on this codebase: sign up, session,
  Connect onboarding start, readiness, client, contract, invoice draft -> finalize -> send -> paid.
- One real screen (sign in / sign up) in a real browser.
- The contract document the app generates.
- The custody guard: the platform key never charges anyone. Every Stripe request the app made
  is listed at the end, and none of them moves money.
WHAT THIS DEMO CANNOT SHOW
- Screens 2-7. They are not built.
- A real Stripe onboarding round trip, a real hosted invoice page, a real payment, or a real
  webhook delivery. There is no Stripe test-mode account (AS-51 is on the board's desk); every
  Stripe call here goes to Stripe's own request validator (stripe-mock), which checks shapes and
  answers with fixtures.
- Email of any kind. There is no email provider, by design.
- The "paid" state at the end is produced by an event WE signed. It proves our receiver and our
  state machine, not Stripe's delivery.`;

const EPILOGUE_SENTENCE = 'None of these creates a charge, a payment intent, or a transfer; the platform key never touches money.';

function request(method, path, fields, note = '') {
  const pairs = Object.entries(fields).map(([k, v]) => `${k}=${v}`).join('  ');
  return `  > ${method} ${path}${pairs ? `  ${pairs}` : ''}${note ? `  (${note})` : ''}`;
}

function response(res, { cookie = false, body = false } = {}) {
  const parts = [`  < ${res.status}`];
  if (res.location !== null) parts.push(`Location: ${res.location}`);
  if (cookie && res.setCookie) {
    const flags = res.setCookie.split(';').slice(1).map((s) => s.trim()).filter((s) => !/^(expires|max-age)=/i.test(s));
    parts.push(`Set-Cookie: ${COOKIE_NAME}=… (${flags.join('; ')})`);
  }
  if (body) parts.push(`body: ${JSON.stringify(res.body.trimEnd())}`);
  return parts.join('  ');
}

function stripeLines(paths) {
  if (paths.length === 0) return ['  Stripe requests the app made: none'];
  return ['  Stripe requests the app made:', ...paths.map((p) => `    ${p}`)];
}

const out = (line = '') => process.stdout.write(`${line}\n`);

function preamble() {
  out('D1 core-loop walkthrough (AS-90)');
  out('================================');
  out();
  out(CAN_CANNOT);
  out();
  out('This walkthrough boots the same application code, from the same shipped image, inside a container that sits next to a Stripe request validator and has no route to the internet. Every request below is a real HTTP request to the real routes; the database is a fresh file created for this run.');
  out();
  out('Every step carries one of three labels:');
  out(`  ${LABEL.app} — the app's own code did this; it would do the same against real Stripe.`);
  out(`  ${LABEL.mock} — Stripe's request validator answered with a fixture; real Stripe would answer with real data, and the step says what would differ.`);
  out(`  ${LABEL.event} — we built and signed this event ourselves; it proves our receiver and state machine, not Stripe's delivery.`);
  out();
  out(`App: ${state.base} (loopback, inside the container). Stripe host: ${MOCK_URL} (stripe-mock).`);
  out(`Freelancer: ${FREELANCER.displayName} <${FREELANCER.email}>. Client: ${CLIENT.name} <${CLIENT.email}>.`);
  out();
}

function epilogue() {
  out('Epilogue: every Stripe request the app made during this run, in order');
  out('---------------------------------------------------------------------');
  for (const [i, p] of stripePaths.entries()) out(`  ${String(i + 1).padStart(2)}. ${p}`);
  out();
  out(EPILOGUE_SENTENCE);
}

async function main() {
  await mockReady();
  const { db } = prepareDatabase(config);
  const repos = createRepositories(db);
  const app = createApp(config, { repos, stripe });
  const server = app.listen(0, config.bind);
  await once(server, 'listening');
  state.base = `http://127.0.0.1:${server.address().port}`;
  state.repos = repos;
  let exitCode = 0;
  try {
    preamble();
    for (const step of SEQUENCE) {
      out(`[${step.n}/12] ${step.title}`);
      out(step.label);
      out(`  ${step.why}`);
      try {
        for (const line of await step.run()) out(line);
      } catch (err) {
        if (err instanceof Stopped) {
          out(`STOPPED at step ${step.n}: ${err.message}`);
        } else {
          out(`STOPPED at step ${step.n}: ${err.name}: ${err.message}`);
        }
        exitCode = 1;
        break;
      }
      out();
    }
    if (exitCode === 0) epilogue();
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error(`demo: ${err.name}: ${err.message}`);
  process.exit(1);
});
