// test/webhooks.test.js — chain link 6's state-sync half (AS-44, plan §5.3).
//
// S-cases call the verifier DIRECTLY: it is pure, so they need no server, no
// database and no clock but the one they hand it. W-cases drive the real route
// over real HTTP through withServer, against the real repositories. G1 is an
// in-file invariant, read off the source.
//
// ONE REASON PER test(). The falsification recipes in plan §7 predict EXACT
// failing sets, and they can only be exact because every negative case asserts
// exactly one refusal. A case that bundled three reasons would turn every
// prediction into a lower bound. That is a structural choice, not a style one.
//
// THERE ARE NO MOCK-GATED CASES HERE, AND THAT IS NOT AN OMISSION. stripe-mock
// validates the shape of requests we SEND; it emits no webhooks and receives
// none, so it has nothing to say about a receiver. Every case in this file is
// offline in the mountless `test` service.
//
// WHAT THIS FILE CANNOT PROVE, stated rather than implied (plan §5.5). Every
// fixture here is signed by the same understanding of Stripe's scheme that
// verifies it, so the suite agrees with itself no matter what it computes: a
// SYMMETRIC mistake is invisible to all of it. S1's committed known-answer
// vector is the defence available offline — it pins our algorithm against
// future drift — and it is NOT evidence that Stripe computes the same bytes.
// Only a real delivery settles that, and that is AS-50's, gated on AS-51. No
// Stripe account exists, none was opened, and nothing here reaches the network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDatabase } from '../lib/db/connection.js';
import { readinessFromAccount } from '../lib/connect/readiness.js';
import { createStripeClient } from '../lib/stripe/client.js';
import { DEFAULT_TOLERANCE_SECONDS, SignatureError, verifyStripeSignature } from '../lib/webhooks/signature.js';
import { HANDLED_TYPES, OUTCOMES } from '../lib/webhooks/receiver.js';
import { APP_DIR, configFor, seedSession, signedInHeaders, withServer } from './helpers/server.js';

// --- fixtures ------------------------------------------------------------------

// A FABRICATED signing secret, not a credential: it signs nothing but these
// fixtures and is never sent anywhere (the verifier is pure and offline). It
// carries the `whsec_` prefix DELIBERATELY, against the AS-38 "not key-shaped"
// convention for the API key, because the secret is used VERBATIM including the
// prefix — so a future edit that strips it must turn S1 red, and it cannot if
// the vector's secret has no prefix to strip.
const SECRET = 'whsec_unit_test_placeholder_do_not_use';
const ROTATED = 'whsec_unit_test_placeholder_rotated_out';
/** Not key-shaped, per the stripe-client.test.js convention: this one really is
 *  an API key slot, and nothing in these tests may reach a Stripe call. */
const KEY = 'unit-test-placeholder-key';

const ACCT = 'acct_fixture1';
const IN = 'in_fixture1';
const IN_TWO = 'in_fixture2';

/** Epoch seconds, and their ISO forms as COMMITTED LITERALS. The expected
 *  values are written out rather than computed with the converter under test —
 *  a test that derives its expectation from the code it is checking agrees with
 *  that code by construction. */
const DUE_EPOCH = 1234567890;
const DUE_AT = '2009-02-13T23:31:30.000Z';
const FINALIZED_EPOCH = 1788336000;
const FINALIZED_AT = '2026-09-02T08:00:00.000Z';
const PAID_EPOCH = 1788339600;
const PAID_AT = '2026-09-02T09:00:00.000Z';
/** The envelope's own `created`. Fixed, and deliberately NOT the signing time:
 *  the header's `t` is what the tolerance window judges, while `created` is
 *  what the handlers convert — and keeping them apart is what lets every
 *  timestamp assertion below be a literal. */
const EVENT_CREATED = 1788343200;
const EVENT_CREATED_AT = '2026-09-02T10:00:00.000Z';
const VOIDED_EPOCH = 1788346800;
const VOIDED_AT = '2026-09-02T11:00:00.000Z';

const ITEMS = [
  { description: 'Design work', quantity: 2, unitAmountMinor: 5000 },
  { description: 'Copy review', quantity: 1, unitAmountMinor: 2500 },
];
const ITEMS_TOTAL = 12_500;

/** A Stripe INVOICE object, as an `invoice.*` event's `data.object`. */
function invoiceObject({ id = IN, status = 'open', due = ITEMS_TOTAL, paid = 0, transitions = {} } = {}) {
  return {
    id,
    object: 'invoice',
    status,
    currency: 'usd',
    amount_due: due,
    amount_paid: paid,
    hosted_invoice_url: `https://pay.example.test/${id}`,
    invoice_pdf: `https://pay.example.test/${id}.pdf`,
    due_date: DUE_EPOCH,
    status_transitions: {
      finalized_at: FINALIZED_EPOCH,
      paid_at: null,
      voided_at: null,
      marked_uncollectible_at: null,
      ...transitions,
    },
  };
}

/** A Stripe ACCOUNT object. Snake_case, exactly as Stripe sends it: the mapped
 *  camelCase field names are AS-39's and AS-41's, and no file in this task's
 *  diff spells them (plan AC 15). */
function accountObject({ charges = true, due = [] } = {}) {
  return {
    id: ACCT,
    object: 'account',
    charges_enabled: charges,
    details_submitted: true,
    payouts_enabled: charges,
    requirements: { currently_due: due, disabled_reason: due.length === 0 ? null : 'requirements.past_due' },
  };
}

let eventSeq = 0;
const nextEventId = () => `evt_fixture${(eventSeq += 1)}`;

function event({ id = nextEventId(), type, object, created = EVENT_CREATED } = {}) {
  return { id, object: 'event', api_version: '2026-08-26.dahlia', created, type, data: { object } };
}

// --- signing -------------------------------------------------------------------

/** The suite's OWN signer — node:crypto directly, not the module under test.
 *  Read §5.5 above before trusting what agreement between the two proves. */
const digestFor = (payload, timestamp, secret = SECRET) =>
  createHmac('sha256', secret)
    .update(Buffer.concat([Buffer.from(`${timestamp}.`, 'utf8'), Buffer.from(payload)]))
    .digest('hex');

const headerFor = (payload, timestamp, secret = SECRET) => `t=${timestamp},v1=${digestFor(payload, timestamp, secret)}`;

const nowSeconds = () => Math.floor(Date.now() / 1000);

// --- the pure verifier: S-cases ------------------------------------------------

/** Asserts the class, the reason code AND the step, so a case cannot pass
 *  because some other refusal fired first. */
function rejects(input, reason) {
  assert.throws(
    () => verifyStripeSignature(input),
    (err) => {
      assert.ok(err instanceof SignatureError, `expected SignatureError, got ${err?.name}: ${err?.message}`);
      assert.equal(err.reason, reason, `expected reason ${reason}, got ${err.reason}`);
      assert.equal(err.step, 'verify-signature');
      return true;
    },
  );
}

/** THE COMMITTED KNOWN-ANSWER VECTOR. Every field is a literal; the digest was
 *  computed once, outside this module, and pasted here. */
const VECTOR = Object.freeze({
  secret: SECRET,
  timestamp: 1788336000,
  payload: '{"id":"evt_kav1","object":"event","type":"invoice.paid","created":1788336000,"data":{"object":{"id":"in_kav1"}}}',
  bytes: 112,
  digest: '8225038d3cc36517a5c9c223775595c7ee1b655d2a9b490e8de9d358a98a3c1e',
});

test('S1: the committed known-answer vector verifies — our algorithm cannot drift', () => {
  // WHAT THIS PROVES: that this module still computes what it computed on
  // 2026-09-02. A later edit that strips the whsec_ prefix from the key,
  // changes the `${t}.` separator, hashes the payload as a string in some other
  // encoding, or switches the digest turns this red.
  //
  // WHAT IT DOES NOT PROVE: that Stripe computes the same bytes. The vector was
  // produced from the same reading of Stripe's documentation that the module
  // implements, so a mistake shared by both is invisible here and in every
  // other case in this file. Only a real delivery settles it — AS-50.
  const payload = Buffer.from(VECTOR.payload, 'utf8');
  assert.equal(payload.length, VECTOR.bytes, 'the vector payload is not the length it was committed at');
  assert.deepEqual(
    verifyStripeSignature({
      payload,
      header: `t=${VECTOR.timestamp},v1=${VECTOR.digest}`,
      secret: VECTOR.secret,
      nowMs: VECTOR.timestamp * 1000,
    }),
    { timestamp: VECTOR.timestamp },
  );
  // The suite's own signer agrees with the literal too, so a broken helper
  // cannot make every other S-case vacuous without failing here first.
  assert.equal(digestFor(VECTOR.payload, VECTOR.timestamp, VECTOR.secret), VECTOR.digest);
});

test('S2: a payload carrying multi-byte UTF-8 verifies — the Buffer path, not a string path', () => {
  // A client name with a cent sign and an emoji. Nothing in the module chooses
  // an encoding, so this works by construction rather than by luck; it is here
  // because "by construction" is exactly the kind of claim that stops being
  // true silently.
  const payload = Buffer.from(JSON.stringify({ name: 'Café ¢ \u{1F9FE} Ltd' }), 'utf8');
  assert.ok(payload.length > JSON.stringify({ name: 'Cafe c Ltd' }).length, 'the fixture really is multi-byte');
  const t = nowSeconds();
  assert.deepEqual(
    verifyStripeSignature({ payload, header: headerFor(payload, t), secret: SECRET, nowMs: t * 1000 }),
    { timestamp: t },
  );
});

test('S3: a tampered payload is rejected — one flipped byte', () => {
  const payload = Buffer.from('{"id":"evt_s3","amount_due":1000}', 'utf8');
  const t = nowSeconds();
  const header = headerFor(payload, t);
  const tampered = Buffer.from(payload);
  tampered[tampered.length - 2] ^= 0x01;
  assert.notDeepEqual(tampered, payload, 'the tamper did not change the bytes');
  rejects({ payload: tampered, header, secret: SECRET, nowMs: t * 1000 }, 'no_match');
});

test('S4: a signature computed with a different secret is rejected', () => {
  const payload = Buffer.from('{"id":"evt_s4"}', 'utf8');
  const t = nowSeconds();
  rejects({ payload, header: headerFor(payload, t, ROTATED), secret: SECRET, nowMs: t * 1000 }, 'no_match');
});

test('S5: a stale timestamp is rejected even though the signature is CORRECT for it', () => {
  // Signed for its own `t`, so it cannot be failing for the wrong reason: the
  // only thing wrong with this delivery is its age.
  const payload = Buffer.from('{"id":"evt_s5"}', 'utf8');
  const t = nowSeconds() - DEFAULT_TOLERANCE_SECONDS - 1;
  rejects({ payload, header: headerFor(payload, t), secret: SECRET, nowMs: nowSeconds() * 1000 }, 'stale_timestamp');
});

test('S6a: exactly at the tolerance boundary, a delivery is ACCEPTED', () => {
  const payload = Buffer.from('{"id":"evt_s6a"}', 'utf8');
  const t = 1788336000;
  assert.deepEqual(
    verifyStripeSignature({
      payload,
      header: headerFor(payload, t),
      secret: SECRET,
      nowMs: (t + DEFAULT_TOLERANCE_SECONDS) * 1000,
    }),
    { timestamp: t },
  );
});

test('S6b: one second past the tolerance boundary, a delivery is REJECTED', () => {
  // S6a and S6b together pin the comparison operator itself — a `<` where a
  // `<=` belongs moves exactly one of them.
  const payload = Buffer.from('{"id":"evt_s6b"}', 'utf8');
  const t = 1788336000;
  rejects(
    { payload, header: headerFor(payload, t), secret: SECRET, nowMs: (t + DEFAULT_TOLERANCE_SECONDS + 1) * 1000 },
    'stale_timestamp',
  );
});

test('S7: a FUTURE timestamp is accepted — the bound is on the past only, deliberately', () => {
  // `t` is inside the signed material, so an attacker without the secret cannot
  // mint a future-dated delivery; there is no security gain from a future
  // bound, and a real cost — a container clock running behind would make every
  // legitimate delivery look future-dated and kill the endpoint.
  const payload = Buffer.from('{"id":"evt_s7"}', 'utf8');
  const t = nowSeconds() + 3600;
  assert.deepEqual(
    verifyStripeSignature({ payload, header: headerFor(payload, t), secret: SECRET, nowMs: nowSeconds() * 1000 }),
    { timestamp: t },
  );
});

test('S8a: a missing Stripe-Signature header is missing_header', () => {
  const payload = Buffer.from('{"id":"evt_s8a"}', 'utf8');
  rejects({ payload, header: undefined, secret: SECRET, nowMs: Date.now() }, 'missing_header');
});

test('S8b: a header that does not parse is malformed_header', () => {
  const payload = Buffer.from('{"id":"evt_s8b"}', 'utf8');
  const t = nowSeconds();
  const v1 = digestFor(payload, t);
  for (const header of [
    '',
    `v1=${v1}`,
    `t=,v1=${v1}`,
    `t=not-a-number,v1=${v1}`,
    `t=${t}.5,v1=${v1}`,
    `t=${t},t=${t},v1=${v1}`,
    `${t},v1=${v1}`,
  ]) {
    rejects({ payload, header, secret: SECRET, nowMs: t * 1000 }, 'malformed_header');
  }
});

test('S9: an unknown scheme is IGNORED, not an error — a header with no v1 is no_v1', () => {
  // Stripe adds schemes on Stripe's schedule. A receiver that rejected an
  // unrecognised element would break on their schedule rather than ours.
  const payload = Buffer.from('{"id":"evt_s9"}', 'utf8');
  const t = nowSeconds();
  rejects({ payload, header: `t=${t},v0=${digestFor(payload, t)}`, secret: SECRET, nowMs: t * 1000 }, 'no_v1');
});

test('S10a: during a rotation, the SECOND of two v1 values may be the match', () => {
  const payload = Buffer.from('{"id":"evt_s10a"}', 'utf8');
  const t = nowSeconds();
  const header = `t=${t},v1=${digestFor(payload, t, ROTATED)},v1=${digestFor(payload, t)}`;
  assert.deepEqual(verifyStripeSignature({ payload, header, secret: SECRET, nowMs: t * 1000 }), { timestamp: t });
});

test('S10b: two v1 values and NEITHER matches is no_match', () => {
  const payload = Buffer.from('{"id":"evt_s10b"}', 'utf8');
  const t = nowSeconds();
  const header = `t=${t},v1=${digestFor(payload, t, ROTATED)},v1=${digestFor(payload, t, 'whsec_third')}`;
  rejects({ payload, header, secret: SECRET, nowMs: t * 1000 }, 'no_match');
});

test('S11: a malformed v1 candidate does not throw — the shape check keeps the comparison safe', () => {
  // timingSafeEqual throws on a length mismatch, which would turn a malformed
  // signature into a 500. Every candidate passes a hex-and-length check before
  // it is converted; one that fails is skipped, not thrown on.
  const payload = Buffer.from('{"id":"evt_s11"}', 'utf8');
  const t = nowSeconds();
  const header = `t=${t},v1=abcd,v1=${'z'.repeat(64)}`;
  rejects({ payload, header, secret: SECRET, nowMs: t * 1000 }, 'no_match');
});

test('S12: a STRING payload is refused outright — not_raw', () => {
  // The layer that still holds when someone mounts an app-wide body parser: a
  // re-serialised body cannot silently verify, because it is not bytes.
  const payload = '{"id":"evt_s12"}';
  const t = nowSeconds();
  rejects({ payload, header: headerFor(payload, t), secret: SECRET, nowMs: t * 1000 }, 'not_raw');
  // ...and the same bytes, as a Buffer, DO verify — so S12 is refusing the
  // type, not a broken fixture.
  const bytes = Buffer.from(payload, 'utf8');
  assert.deepEqual(
    verifyStripeSignature({ payload: bytes, header: headerFor(bytes, t), secret: SECRET, nowMs: t * 1000 }),
    { timestamp: t },
  );
});

test('S13: the error carries a reason code and nothing else — no secret, no payload, no digest', () => {
  // Built on the stale_timestamp path on purpose: that reason is unreachable
  // under the F1 recipe, so this case stays a stable instrument while F1 is
  // making the digest comparison always succeed.
  const payload = Buffer.from('{"id":"evt_s13","secret_looking":"payload material"}', 'utf8');
  const t = nowSeconds() - DEFAULT_TOLERANCE_SECONDS - 60;
  const header = headerFor(payload, t);
  const expected = digestFor(payload, t);
  assert.throws(
    () => verifyStripeSignature({ payload, header, secret: SECRET, nowMs: Date.now() }),
    (err) => {
      const serialised = `${err.message} ${err.stack ?? ''} ${JSON.stringify(err)} ${JSON.stringify({ ...err })}`;
      assert.ok(!serialised.includes(SECRET), `the error leaked the signing secret: ${serialised}`);
      assert.ok(!serialised.includes(expected), 'the error leaked the expected digest');
      assert.ok(!serialised.includes('payload material'), 'the error leaked request material');
      assert.equal(err.reason, 'stale_timestamp');
      // ...and the guard is not vacuous: those strings really are in scope here.
      assert.ok(`${SECRET}${expected}`.length > 0 && header.includes(expected));
      return true;
    },
  );
});

// --- the route: W-cases --------------------------------------------------------

/** Every W-case but W17 injects THIS transport. It counts and then throws, so
 *  a Stripe call cannot pass unnoticed either by succeeding or by being
 *  swallowed. W18 reads the counter. */
let stripeCalls = 0;
let appsBuilt = 0;
const refusingTransport = async () => {
  stripeCalls += 1;
  throw new Error('a webhook must make no Stripe call');
};

/** Rows the W-cases start from. `invoice` seeds a local draft, attaches a
 *  Stripe id, and optionally applies a snapshot to move it — every write
 *  through the same repositories the app serves from. */
function seedRows(repos, { connected = true, ready = false, customerId = null, invoices = [] } = {}) {
  const freelancer = repos.freelancers.create({ email: 'f@example.test', displayName: 'Freda Lancer' });
  if (connected) {
    repos.connectedAccounts.create({ freelancerId: freelancer.id, stripeAccountId: ACCT });
    if (ready) repos.connectedAccounts.updateReadiness(ACCT, readinessFromAccount(accountObject(), EVENT_CREATED_AT));
  }
  const client = repos.clients.create(freelancer.id, { name: 'Client Co', email: 'client@example.test' });
  if (customerId !== null) repos.clients.setStripeCustomerId(freelancer.id, client.id, customerId);
  const seeded = invoices.map(({ stripeInvoiceId = IN, snapshot = null }) => {
    const draft = repos.invoices.createDraft(freelancer.id, { clientId: client.id, daysUntilDue: 30, lineItems: ITEMS });
    repos.invoices.attachStripeInvoice(freelancer.id, draft.id, stripeInvoiceId);
    if (snapshot !== null) repos.invoices.applyStripeSnapshot(stripeInvoiceId, snapshot);
    return repos.invoices.getById(freelancer.id, draft.id);
  });
  return { freelancer, client, invoices: seeded };
}

/** How many rows the processed-event ledger holds. A second read-only handle on
 *  the same WAL file: `has(id)` answers "was THIS event recorded", and the
 *  cardinality question ("was anything ELSE recorded") needs a count. */
function ledgerCount(config) {
  const db = openDatabase(config.dbPath);
  try {
    return db.prepare('SELECT count(*) AS n FROM stripe_events').get().n;
  } finally {
    db.close();
  }
}

async function withWebhookApp({ secret = SECRET, transport = refusingTransport, ...seed } = {}, fn) {
  appsBuilt += 1;
  const config = configFor(secret === null ? {} : { webhookSecret: secret });
  const stripe = createStripeClient({ apiKey: KEY, transport });
  await withServer(
    config,
    async (base, app, deps) => {
      const rows = seedRows(deps.repos, seed);
      // AS-40: W17 alone drives AS-43's send route, which is now behind the
      // auth boundary, so it needs a session. Every OTHER case here posts to
      // /webhooks/stripe, which is mounted ABOVE that boundary and is
      // authenticated by signature — no cookie and no Origin — which is the
      // property G8 in auth.test.js regression-tests.
      const session = signedInHeaders(base, seedSession(deps.repos, rows.freelancer.id).cookie);
      await fn({ base, config, repos: deps.repos, ...rows, session });
    },
    { stripe },
  );
}

/** POST the exact bytes, with the signature the suite computes over them. `t`
 *  defaults to NOW — the tolerance judges the header, never the envelope. */
async function deliver(base, body, { secret = SECRET, timestamp = nowSeconds(), header, headers = {} } = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  const res = await fetch(`${base}/webhooks/stripe`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/json',
      ...(header === null ? {} : { 'stripe-signature': header ?? headerFor(payload, timestamp, secret) }),
      ...headers,
    },
    body: payload,
  });
  return { status: res.status, body: await res.text() };
}

const invoiceEvent = (type, object, id) => event({ type, object, id });

test('W1: with NO signing secret configured the endpoint does not exist — 404, and nothing is reachable', async () => {
  await withWebhookApp({ secret: null, invoices: [{}] }, async ({ base, config, repos, freelancer, invoices, session }) => {
    // AS-40: both probes carry a session and an Origin. This case's claim is
    // about ROUTING — that an unconfigured deployment registers no route at all
    // — so auth is removed from the question. Without them the unrouted request
    // is answered by the app-wide middlewares first (403 for an origin-less
    // POST, a sign-in redirect for a signed-out GET), and the case would be
    // asserting the guard rather than the absence of the route.
    const body = JSON.stringify(invoiceEvent('invoice.finalized', invoiceObject()));
    const posted = await deliver(base, body, { headers: session });
    assert.equal(posted.status, 404, 'a configured deployment answers 400; an unconfigured one must not exist');
    const got = await fetch(`${base}/webhooks/stripe`, { method: 'GET', redirect: 'manual', headers: session });
    assert.equal(got.status, 404);
    assert.equal(ledgerCount(config), 0);
    assert.equal(repos.invoices.getById(freelancer.id, invoices[0].id).status, 'draft');
  });
});

test('W2: a valid invoice.finalized for a known in_ is applied to the mirror', async () => {
  await withWebhookApp({ invoices: [{}] }, async ({ base, config, repos }) => {
    const evt = invoiceEvent('invoice.finalized', invoiceObject());
    const res = await deliver(base, evt);
    assert.equal(res.status, 200);
    assert.equal(res.body, 'ok: applied\n');
    const row = repos.invoices.getByStripeInvoiceId(IN);
    assert.equal(row.status, 'open');
    assert.equal(row.hostedInvoiceUrl, `https://pay.example.test/${IN}`);
    assert.equal(row.invoicePdfUrl, `https://pay.example.test/${IN}.pdf`);
    assert.equal(row.amountDueMinor, ITEMS_TOTAL);
    assert.equal(row.amountPaidMinor, 0);
    assert.equal(row.dueAt, DUE_AT);
    assert.equal(row.finalizedAt, FINALIZED_AT);
    assert.equal(row.sentAt, null, 'invoice.finalized is not a send');
    assert.equal(ledgerCount(config), 1);
    assert.equal(repos.stripeEvents.has(evt.id), true);
  });
});

test('W3: a TAMPERED body is refused — the security guard shown rejecting, over HTTP', async () => {
  await withWebhookApp({ invoices: [{}] }, async ({ base, config, repos }) => {
    const before = repos.invoices.getByStripeInvoiceId(IN);
    const body = JSON.stringify(invoiceEvent('invoice.finalized', invoiceObject()));
    const header = headerFor(body, nowSeconds());
    const res = await deliver(base, body.replace('"open"', '"paid"'), { header });
    assert.equal(res.status, 400);
    assert.equal(res.body, 'SignatureError: verify-signature\n');
    assert.deepEqual(repos.invoices.getByStripeInvoiceId(IN), before, 'the mirror moved on a rejected delivery');
    assert.equal(ledgerCount(config), 0);
  });
});

test('W4a: a missing Stripe-Signature header is 400 and writes nothing', async () => {
  await withWebhookApp({ invoices: [{}] }, async ({ base, config, repos }) => {
    const before = repos.invoices.getByStripeInvoiceId(IN);
    const res = await deliver(base, invoiceEvent('invoice.finalized', invoiceObject()), { header: null });
    assert.equal(res.status, 400);
    assert.deepEqual(repos.invoices.getByStripeInvoiceId(IN), before);
    assert.equal(ledgerCount(config), 0);
  });
});

test('W4b: a signature computed with a DIFFERENT secret is 400 and writes nothing', async () => {
  await withWebhookApp({ invoices: [{}] }, async ({ base, config, repos }) => {
    const before = repos.invoices.getByStripeInvoiceId(IN);
    const res = await deliver(base, invoiceEvent('invoice.finalized', invoiceObject()), { secret: ROTATED });
    assert.equal(res.status, 400);
    assert.deepEqual(repos.invoices.getByStripeInvoiceId(IN), before);
    assert.equal(ledgerCount(config), 0);
  });
});

test('W4c: a STALE timestamp, correctly signed, is 400 and writes nothing', async () => {
  await withWebhookApp({ invoices: [{}] }, async ({ base, config, repos }) => {
    const before = repos.invoices.getByStripeInvoiceId(IN);
    const res = await deliver(base, invoiceEvent('invoice.finalized', invoiceObject()), {
      timestamp: nowSeconds() - DEFAULT_TOLERANCE_SECONDS - 60,
    });
    assert.equal(res.status, 400);
    assert.deepEqual(repos.invoices.getByStripeInvoiceId(IN), before);
    assert.equal(ledgerCount(config), 0);
  });
});

test('W5: the SAME event delivered twice is applied exactly once', async () => {
  await withWebhookApp({ invoices: [{}] }, async ({ base, config, repos }) => {
    const evt = invoiceEvent('invoice.finalized', invoiceObject());
    const first = await deliver(base, evt);
    const applied = repos.invoices.getByStripeInvoiceId(IN);
    const second = await deliver(base, evt);
    const after = repos.invoices.getByStripeInvoiceId(IN);
    assert.deepEqual([first.status, first.body], [200, 'ok: applied\n']);
    assert.deepEqual([second.status, second.body], [200, 'ok: duplicate\n']);
    assert.equal(ledgerCount(config), 1, 'the second delivery must not add a ledger row');
    assert.equal(after.updatedAt, applied.updatedAt, 'the redelivery touched the row');
    assert.deepEqual(after, applied);
  });
});

test('W6: paid BEFORE finalized converges to paid, and loses nothing', async () => {
  await withWebhookApp({ invoices: [{}] }, async ({ base, config, repos }) => {
    // The description's own out-of-order case. A paid Stripe invoice still
    // carries both URLs and its finalized_at, so discarding the later,
    // lower-ranked snapshot costs nothing — which is exactly why the discard is
    // safe rather than merely convenient.
    const paid = invoiceEvent(
      'invoice.paid',
      invoiceObject({ status: 'paid', paid: ITEMS_TOTAL, transitions: { paid_at: PAID_EPOCH } }),
    );
    const finalized = invoiceEvent('invoice.finalized', invoiceObject({ status: 'open' }));

    assert.deepEqual(await deliver(base, paid), { status: 200, body: 'ok: applied\n' });
    const afterPaid = repos.invoices.getByStripeInvoiceId(IN);
    assert.deepEqual(await deliver(base, finalized), { status: 200, body: 'ok: stale\n' });
    const row = repos.invoices.getByStripeInvoiceId(IN);

    assert.equal(row.status, 'paid');
    assert.deepEqual(row, afterPaid, 'the stale snapshot wrote something');
    assert.equal(row.paidAt, PAID_AT);
    assert.equal(row.finalizedAt, FINALIZED_AT, 'the paid event carried finalized_at itself');
    assert.equal(row.hostedInvoiceUrl, `https://pay.example.test/${IN}`);
    assert.equal(row.invoicePdfUrl, `https://pay.example.test/${IN}.pdf`);
    assert.equal(row.amountPaidMinor, ITEMS_TOTAL);
    // A third delivery — the paid event again — is a duplicate, not a re-apply.
    assert.deepEqual(await deliver(base, paid), { status: 200, body: 'ok: duplicate\n' });
    assert.equal(ledgerCount(config), 2);
  });
});

test('W7: an unhandled event type is 200 ignored and is NOT recorded', async () => {
  await withWebhookApp({ invoices: [{}] }, async ({ base, config, repos }) => {
    const before = repos.invoices.getByStripeInvoiceId(IN);
    const evt = invoiceEvent('charge.succeeded', { id: 'ch_fixture1', object: 'charge' });
    const res = await deliver(base, evt);
    assert.deepEqual(res, { status: 200, body: 'ok: ignored\n' });
    // AS-39's invariant: a row exists IFF the event was processed. An ignored
    // event has no effects, so a row would be a false statement about our own
    // history — and a trap for the day a handler is added for that type.
    assert.equal(repos.stripeEvents.has(evt.id), false);
    assert.equal(ledgerCount(config), 0);
    assert.deepEqual(repos.invoices.getByStripeInvoiceId(IN), before);

    // ...and "unhandled" includes the names every object literal inherits. A
    // bare HANDLERS[type] resolves `constructor` and friends to a member of
    // Object.prototype — truthy, with no `locate` — and dispatch throws a
    // TypeError the route answers with 500. Stripe cannot send these (its types
    // all contain a dot) and reaching the dispatch takes a valid signature, but
    // 500 is the one answer an unhandled type must never get: Stripe retries a
    // 5xx for three days and can disable the endpoint over it. Cardinality
    // first — six names, one delivery each.
    const inherited = ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf', 'isPrototypeOf'];
    assert.equal(inherited.length, 6);
    for (const type of inherited) {
      const poison = invoiceEvent(type, invoiceObject());
      assert.deepEqual(await deliver(base, poison), { status: 200, body: 'ok: ignored\n' }, `type ${type}`);
      assert.equal(repos.stripeEvents.has(poison.id), false, `type ${type} was recorded`);
    }
    assert.equal(ledgerCount(config), 0);
    assert.deepEqual(repos.invoices.getByStripeInvoiceId(IN), before);
  });
});

test('W8: an invoice event for an in_ we do not know is 200 unknown-target, with no ledger row', async () => {
  await withWebhookApp({ invoices: [{}] }, async ({ base, config, repos }) => {
    // NORMAL, not exceptional: a Standard-controller account gives the
    // freelancer their own full Stripe Dashboard, so they can and will create
    // invoices we never made. A non-2xx here would eventually make Stripe
    // disable our endpoint over their ordinary dashboard activity.
    const evt = invoiceEvent('invoice.paid', invoiceObject({ id: 'in_not_ours', status: 'paid' }));
    assert.deepEqual(await deliver(base, evt), { status: 200, body: 'ok: unknown-target\n' });
    assert.equal(repos.stripeEvents.has(evt.id), false);
    assert.equal(ledgerCount(config), 0);
    assert.equal(repos.invoices.getByStripeInvoiceId('in_not_ours'), null, 'no row was created');
    assert.equal(repos.invoices.getByStripeInvoiceId(IN).status, 'draft');
  });
});

test('W9: account.updated writes readiness from the event, stamped with the EVENT\'s time', async () => {
  await withWebhookApp({}, async ({ base, config, repos }) => {
    const object = accountObject();
    const evt = event({ type: 'account.updated', object });
    assert.deepEqual(await deliver(base, evt), { status: 200, body: 'ok: readiness\n' });

    const row = repos.connectedAccounts.getByStripeAccountId(ACCT);
    // The six fields, compared against AS-41's mapper rather than re-derived:
    // this task imports that mapper unchanged, and naming its output keys here
    // would be the second definition the whole arrangement exists to avoid.
    const expected = readinessFromAccount(object, EVENT_CREATED_AT);
    assert.equal(Object.keys(expected).length, 6);
    for (const [key, value] of Object.entries(expected)) assert.deepEqual(row[key], value, `readiness field ${key}`);
    // `ready` is AS-39's ONE derivation, read and never re-derived here.
    assert.equal(row.ready, true);
    // THE POINT OF THIS CASE: the sync time is the event's own `created`, not
    // our receipt time. A three-day-old redelivery must not claim to be fresh.
    assert.equal(row.syncedAt, EVENT_CREATED_AT);
    assert.equal(ledgerCount(config), 1);
  });
});

test('W10: account.updated for an acct_ we do not know is 200 unknown-target, with no ledger row', async () => {
  await withWebhookApp({ connected: false }, async ({ base, config, repos }) => {
    const evt = event({ type: 'account.updated', object: accountObject() });
    assert.deepEqual(await deliver(base, evt), { status: 200, body: 'ok: unknown-target\n' });
    assert.equal(ledgerCount(config), 0);
    assert.equal(repos.connectedAccounts.getByStripeAccountId(ACCT), null);
  });
});

test('W11: invoice.payment_failed records the failure time from the EVENT and leaves the status alone', async () => {
  await withWebhookApp({ invoices: [{ snapshot: { status: 'open' } }] }, async ({ base, repos }) => {
    const evt = invoiceEvent('invoice.payment_failed', invoiceObject({ status: 'open' }));
    assert.deepEqual(await deliver(base, evt), { status: 200, body: 'ok: fields\n' });
    const row = repos.invoices.getByStripeInvoiceId(IN);
    assert.equal(row.status, 'open');
    // Against the literal, never against "not null": the value is the event's
    // own `created`, which is what makes a redelivery write the same bytes.
    assert.equal(row.lastPaymentFailedAt, EVENT_CREATED_AT);
    assert.equal(row.paidAt, null);
  });
});

test('W12a: invoice.sent does NOT overwrite a sentAt the mirror already records', async () => {
  const recorded = '2026-09-01T07:00:00.000Z';
  await withWebhookApp({ invoices: [{ snapshot: { status: 'open', sentAt: recorded } }] }, async ({ base, repos }) => {
    const evt = invoiceEvent('invoice.sent', invoiceObject({ status: 'open' }));
    assert.deepEqual(await deliver(base, evt), { status: 200, body: 'ok: fields\n' });
    assert.equal(repos.invoices.getByStripeInvoiceId(IN).sentAt, recorded, 'a recorded fact was erased');
  });
});

test('W12b: invoice.sent records sentAt from the event when the mirror has none', async () => {
  await withWebhookApp({ invoices: [{ snapshot: { status: 'open' } }] }, async ({ base, repos }) => {
    // This is the hole AS-43's idempotency key can only close inside Stripe's
    // ~24 h window: a send that succeeded at Stripe but died before our mirror
    // write. invoice.sent closes it permanently, from the one source of truth
    // about whether Stripe sent the email.
    assert.equal(repos.invoices.getByStripeInvoiceId(IN).sentAt, null);
    const evt = invoiceEvent('invoice.sent', invoiceObject({ status: 'open' }));
    assert.deepEqual(await deliver(base, evt), { status: 200, body: 'ok: fields\n' });
    assert.equal(repos.invoices.getByStripeInvoiceId(IN).sentAt, EVENT_CREATED_AT);
  });
});

test('W13: a terminal-state conflict answers 200, records the event, and writes NOTHING', async () => {
  await withWebhookApp({ invoices: [{ snapshot: { status: 'open' } }] }, async ({ base, config, repos }) => {
    const voided = invoiceEvent(
      'invoice.voided',
      invoiceObject({ status: 'void', transitions: { voided_at: VOIDED_EPOCH } }),
    );
    assert.deepEqual(await deliver(base, voided), { status: 200, body: 'ok: applied\n' });
    const afterVoid = repos.invoices.getByStripeInvoiceId(IN);
    assert.equal(afterVoid.status, 'void');
    assert.equal(afterVoid.voidedAt, VOIDED_AT);

    // paid and void are the same rank because they are the one pair with no
    // transition between them. We cannot rank them, so we refuse to guess —
    // and a 200 is right because a conflict is a decision we made, not a
    // failure we suffered: a retry would deliver the same bytes and reach the
    // same decision, while a non-2xx would loop for three days.
    const paid = invoiceEvent('invoice.paid', invoiceObject({ status: 'paid', paid: ITEMS_TOTAL }));
    const res = await deliver(base, paid);
    assert.equal(res.status, 200, 'a conflict must not be answered with a retryable status');
    assert.equal(res.body, 'ok: conflict\n');
    assert.deepEqual(repos.invoices.getByStripeInvoiceId(IN), afterVoid, 'the conflicting snapshot wrote something');
    // The event WAS processed — the correct effect was "write nothing" — so its
    // ledger row is recorded and a redelivery is a duplicate.
    assert.equal(repos.stripeEvents.has(paid.id), true);
    assert.equal(ledgerCount(config), 2);
    assert.deepEqual(await deliver(base, paid), { status: 200, body: 'ok: duplicate\n' });
  });
});

test('W14: the body really is RAW — a payload whose JSON round trip would differ still verifies', async () => {
  await withWebhookApp({ invoices: [{}] }, async ({ base, repos }) => {
    // Non-canonical whitespace, unsorted keys, and an escaped e-acute. Every
    // one of those survives JSON.parse/JSON.stringify differently, so a
    // re-serialised body would hash to something else.
    const body =
      '{ "type" :"invoice.finalized",\n  "id":"evt_w14",  "created": 1788343200 ,\n'
      + '  "data" : { "object" : ' + JSON.stringify(invoiceObject({ status: 'open' })) + ' },\n'
      + '  "note":"caf\\u00e9" }';
    assert.notEqual(JSON.stringify(JSON.parse(body)), body, 'the fixture round-trips unchanged — it proves nothing');
    assert.deepEqual(await deliver(base, body), { status: 200, body: 'ok: applied\n' });
    assert.equal(repos.invoices.getByStripeInvoiceId(IN).status, 'open');
  });
});

test('W15: a verified body that is not an event envelope is 400 parse-event, with no ledger row', async () => {
  await withWebhookApp({ invoices: [{}] }, async ({ base, config }) => {
    const object = invoiceObject();
    for (const body of [
      'not json at all',
      JSON.stringify([1, 2, 3]),
      JSON.stringify({ type: 'invoice.finalized', created: EVENT_CREATED, data: { object } }),
      JSON.stringify({ id: 'in_fixture1', type: 'invoice.finalized', created: EVENT_CREATED, data: { object } }),
      JSON.stringify({ id: 'evt_w15', created: EVENT_CREATED, data: { object } }),
      JSON.stringify({ id: 'evt_w15', type: 'invoice.finalized', data: { object } }),
      JSON.stringify({ id: 'evt_w15', type: 'invoice.finalized', created: EVENT_CREATED }),
      JSON.stringify({ id: 'evt_w15', type: 'invoice.finalized', created: EVENT_CREATED, data: { object: null } }),
    ]) {
      const res = await deliver(base, body);
      assert.equal(res.status, 400, `accepted a non-envelope: ${body.slice(0, 60)}`);
      assert.equal(res.body, 'WebhookEventError: parse-event\n');
    }
    assert.equal(ledgerCount(config), 0);
  });
});

test('W16: an object shape we do not understand is 500 and is NOT recorded — so the fix can be redelivered', async () => {
  await withWebhookApp({ invoices: [{}] }, async ({ base, config, repos }) => {
    // A well-formed envelope carrying an object we cannot map is a Stripe-side
    // surprise, not a bad request: 500 makes Stripe retry, and because the
    // failed apply never committed, a deploy that fixes the mapper gets the
    // event redelivered and applied. The cost — a poison pill if the fix never
    // comes — is accepted for a v1 with one operator watching.
    const id = 'evt_w16';
    const broken = await deliver(base, event({ id, type: 'invoice.finalized', object: { ...invoiceObject(), status: 42 } }));
    assert.equal(broken.status, 500);
    assert.equal(repos.stripeEvents.has(id), false, 'a failed apply must roll its ledger row back');
    assert.equal(ledgerCount(config), 0);
    assert.equal(repos.invoices.getByStripeInvoiceId(IN).status, 'draft');

    const fixed = await deliver(base, event({ id, type: 'invoice.finalized', object: invoiceObject() }));
    assert.deepEqual(fixed, { status: 200, body: 'ok: applied\n' });
    assert.equal(ledgerCount(config), 1);
    assert.equal(repos.invoices.getByStripeInvoiceId(IN).status, 'open');
  });
});

test('W17: an invoice THIS task moved to open is reconciled by AS-43 before it can be sent', async () => {
  // The cross-task consequence AS-43's review cycle 1 created: its
  // reconciliation guard was moved onto the MIRROR ROW with no predicate of its
  // own, so it holds on paths AS-43 does not own. This task is the first code
  // that makes that sentence true, so this task tests it — in both directions.
  const calls = [];
  const transport = async (signed) => {
    calls.push(`${signed.method} ${signed.url.pathname}`);
    const send = signed.url.pathname.match(/^\/v1\/invoices\/([^/]+)\/send$/);
    if (signed.method === 'POST' && send !== null) {
      return {
        status: 200,
        headers: { 'request-id': 'req_fixture' },
        body: JSON.stringify(invoiceObject({ id: send[1], status: 'open' })),
      };
    }
    throw new Error(`W17 fixture: unexpected ${signed.method} ${signed.url.pathname}`);
  };

  await withWebhookApp(
    {
      transport,
      ready: true,
      customerId: 'cus_fixture1',
      invoices: [{ stripeInvoiceId: IN }, { stripeInvoiceId: IN_TWO }],
    },
    async ({ base, repos, invoices, session }) => {
      const send = (invoice) =>
        fetch(`${base}/invoices/${invoice.id}/send`, {
          method: 'POST',
          redirect: 'manual',
          headers: session,
        });

      // AGREEING: our finalize timed out but Stripe finalized, the webhook
      // moves the mirror to open with Stripe's own number, and the freelancer
      // re-submits the form.
      await deliver(base, invoiceEvent('invoice.finalized', invoiceObject({ id: IN, due: ITEMS_TOTAL })));
      const agreeing = repos.invoices.getByStripeInvoiceId(IN);
      assert.equal(agreeing.status, 'open');
      assert.equal(agreeing.amountDueMinor, agreeing.totalMinor);
      const ok = await send(invoices[0]);
      assert.equal(ok.status, 303);
      assert.deepEqual(calls, [`POST /v1/invoices/${IN}/send`], 'exactly one send call');

      // DISAGREEING: this task can put a wrong number on the mirror — it cannot
      // invent one, it writes what a SIGNED Stripe event says — and AS-43's
      // guard is what stands between that value and an email to the client.
      await deliver(base, invoiceEvent('invoice.finalized', invoiceObject({ id: IN_TWO, due: ITEMS_TOTAL + 1 })));
      const disagreeing = repos.invoices.getByStripeInvoiceId(IN_TWO);
      assert.equal(disagreeing.status, 'open');
      assert.notEqual(disagreeing.amountDueMinor, disagreeing.totalMinor);
      const refused = await send(invoices[1]);
      assert.equal(refused.status, 409);
      assert.equal(await refused.text(), 'AmountMismatchError: reconcile\n');
      assert.deepEqual(calls, [`POST /v1/invoices/${IN}/send`], 'a refused invoice must make no send call');
      assert.equal(repos.invoices.getByStripeInvoiceId(IN_TWO).sentAt, null);
    },
  );
});

test('W18: ZERO Stripe calls across every W-case above — asserted as a count', async () => {
  // The transport every case but W17 injects counts before it throws, so this
  // is a count of zero rather than an absence of errors. Cardinality first: if
  // the app count is wrong, the zero above it was measured over the wrong set.
  assert.equal(appsBuilt, 20, `expected 20 apps built by W1-W17, got ${appsBuilt}`);
  assert.equal(stripeCalls, 0, 'a webhook made a Stripe call');
});

test('W19: a body over the size limit is refused by the parser, not by us', async () => {
  await withWebhookApp({ invoices: [{}] }, async ({ base, config }) => {
    const body = `{"filler":"${'x'.repeat(2 * 1024 * 1024)}"}`;
    const res = await deliver(base, body);
    assert.equal(res.status, 413);
    assert.equal(ledgerCount(config), 0);
  });
});

test('W20: a request with no content-type never becomes a Buffer, and the guard says so', async () => {
  await withWebhookApp({ invoices: [{}] }, async ({ base, config }) => {
    // A BufferSource body carries no content-type, so nothing the raw parser
    // matches on is present and req.body is never set. The Buffer guard is what
    // turns that into a named 400 instead of an "empty payload" mystery.
    const payload = JSON.stringify(invoiceEvent('invoice.finalized', invoiceObject()));
    const res = await fetch(`${base}/webhooks/stripe`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'stripe-signature': headerFor(payload, nowSeconds()) },
      body: new Uint8Array(Buffer.from(payload, 'utf8')),
    });
    assert.equal(res.headers.get('content-type'), 'text/plain; charset=utf-8');
    assert.equal(res.status, 400);
    assert.equal(await res.text(), 'SignatureError: verify-signature\n');
    assert.equal(ledgerCount(config), 0);
  });
});

// --- in-file invariants: G-cases -----------------------------------------------

test('G1: the receiver is synchronous and reads NO clock', () => {
  // Both halves are load-bearing and neither is observable from outside. The
  // transaction helper COMMITs when its callback returns, so an async callback
  // would commit before the work; and every value the handlers write comes from
  // the event's own bytes, which is what makes a redelivery a strict no-op.
  const path = join(APP_DIR, 'lib/webhooks/receiver.js');
  const source = readFileSync(path, 'utf8');
  const forbidden = [
    ['async', /\basync\b/, 'the transaction callback must be synchronous — COMMIT runs when it returns'],
    ['await', /\bawait\b/, 'the transaction callback must be synchronous — COMMIT runs when it returns'],
    ['Date.now(', /Date\.now\s*\(/, 'the receiver reads no clock — every timestamp comes from the event'],
    ['new Date(', /new\s+Date\s*\(/, 'the receiver reads no clock — every timestamp comes from the event'],
  ];
  for (const [name, pattern, why] of forbidden) {
    assert.ok(!pattern.test(source), `lib/webhooks/receiver.js contains ${name}: ${why}`);
  }
  // NOT VACUOUS, in two directions: the file really was read, and these
  // patterns really can find what they are looking for — lib/invoices/
  // lifecycle.js is the neighbour that legitimately has all four.
  assert.ok(source.includes('createWebhookReceiver'), `${path} is not the file this test means`);
  const neighbour = readFileSync(join(APP_DIR, 'lib/invoices/lifecycle.js'), 'utf8');
  const found = forbidden.filter(([, pattern]) => pattern.test(neighbour)).map(([name]) => name);
  assert.deepEqual(found, ['async', 'await', 'new Date('], 'the patterns cannot see what they are meant to catch');
});

test('G2: the handled types and the outcome vocabulary are exactly what is committed here', () => {
  // Cardinality before quantification, for the two lists the route's response
  // bodies and the README are written against.
  assert.equal(HANDLED_TYPES.length, 8, `expected 8 handled types, got ${HANDLED_TYPES.join(', ')}`);
  assert.deepEqual(HANDLED_TYPES, [
    'invoice.created',
    'invoice.finalized',
    'invoice.sent',
    'invoice.paid',
    'invoice.payment_failed',
    'invoice.voided',
    'invoice.marked_uncollectible',
    'account.updated',
  ]);
  assert.equal(OUTCOMES.length, 8);
  assert.deepEqual(OUTCOMES, [
    'ignored',
    'unknown-target',
    'duplicate',
    'applied',
    'fields',
    'stale',
    'conflict',
    'readiness',
  ]);
});

test('G3: every handled invoice type reaches the mirror through the ONE snapshot writer', async () => {
  // Two rows of the §3.4 table have no case of their own above — created, and
  // marked_uncollectible — and a table row nothing exercises is a row nobody
  // would notice losing. One delivery each, on its own mirror.
  for (const [type, status] of [
    ['invoice.created', 'draft'],
    ['invoice.marked_uncollectible', 'uncollectible'],
  ]) {
    await withWebhookApp({ invoices: [{ snapshot: { status: 'open' } }] }, async ({ base, repos }) => {
      const object = invoiceObject({ status, transitions: { marked_uncollectible_at: VOIDED_EPOCH } });
      const res = await deliver(base, invoiceEvent(type, object));
      assert.equal(res.status, 200, `${type} was not handled`);
      const row = repos.invoices.getByStripeInvoiceId(IN);
      // `created` on an already-open mirror is older than the mirror and is
      // discarded by rank; `marked_uncollectible` is above it and applies.
      assert.equal(row.status, status === 'draft' ? 'open' : 'uncollectible');
      assert.equal(res.body, status === 'draft' ? 'ok: stale\n' : 'ok: applied\n');
    });
  }
});
