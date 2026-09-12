// test/clients.test.js — the HTTP surface of client creation (AS-65, plan §6).
//
// EVERYTHING HERE RUNS OFFLINE. Creating a client makes no external call at
// all — no payment-processor customer is minted until an invoice is finalized,
// which is AS-43's design and not an omission here — so this suite passes in
// the `test` service at network_mode: none by nature rather than by mocking.
//
// ONE GROUP, L, for the one route. The numbering is referenced by name from the
// plan's falsification recipes: F1 predicts L8 alone, F2 predicts L3 alone, F4
// predicts every case here except L10 — and, since review cycle 1, F3a (drop
// the check on the INPUT) predicts L6 alone while F3b (drop the check on the
// EMITTED string) predicts L12 alone. Those two are narrow on purpose: the
// route now runs two independent guards, and a recipe whose predicted set
// spanned both would hide which guard carries which property, which is the
// conflation that shipped an open redirect from here in the first place.
//
// L6, L7 and L12 partition the return-path input space, and the partition is
// the point: L6 is what safeNext REFUSES, L7 is what it accepts and
// normalization leaves alone, L12 is what it ACCEPTS and normalization CHANGES.
// The last of those is where the defect lived, and no case could observe it
// until L12 existed — L7's four inputs are identical before and after
// composition, so they cannot tell a correct composition from a broken one.
//
// CARDINALITY BEFORE QUANTIFICATION, everywhere. Every case that counts rows
// asserts a committed number, never `> 0`: a query that silently returned
// nothing would otherwise pass every rule below it on an empty set.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDatabase } from '../lib/db/connection.js';
import { createRepositories, prepareDatabase } from '../lib/db/database.js';
import { safeNext } from '../lib/auth/guard.js';
import { clientRoutes } from '../routes/clients.js';
import {
  APP_DIR,
  configFor,
  freshDbPath,
  seedSession,
  seedSignedIn,
  signedInHeaders,
  withServer,
} from './helpers/server.js';

/** The submitted fields, minus the router's own `next`. */
const CLIENT_INPUT = () => ({ name: 'Client Co', email: 'client@example.test' });

/** A contract's two required form values — L2 spends the minted id on the
 *  consumer that already existed, which is the whole point of this endpoint. */
const CONTRACT_INPUT = () => ({ projectDescription: 'Website redesign', startDate: '2026-09-08' });

/** Row counts read on a SECOND connection to the same file — the db.test.js
 *  idiom. The repositories expose no count method (app code has no use for
 *  one), and a count is exactly what "creates nothing" needs. test/ is outside
 *  the dependency scan's world, so the SQL here moves no committed literal. */
function countRows(config, table) {
  const db = openDatabase(config.dbPath);
  try {
    return db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
  } finally {
    db.close();
  }
}

/** A migrated database and repositories, closed after `fn` — AWAITED, because a
 *  synchronous finally would close the handle out from under an async body. */
async function withRepos(fn) {
  const { db } = prepareDatabase({ dbPath: freshDbPath() });
  try {
    return await fn(createRepositories(db), db);
  } finally {
    db.close();
  }
}

/** THE SEEDED FREELANCER'S SESSION. POST /clients sits below the auth boundary
 *  and no case here is about signing in, so the helper seeds a session ROW (no
 *  KDF) and every request carries its cookie and an Origin the same-origin
 *  check accepts.
 *
 *  NOTHING IS PRE-SEEDED IN THE clients TABLE, and that is deliberate: a
 *  pre-existing row sharing an email with a case's submission would make the
 *  duplicate-convergence recipe redden cases other than L3, and a recipe whose
 *  failing set is wider than predicted proves less, not more. */
const auth = { headers: {} };

async function withClientApp(fn) {
  const config = configFor();
  await withServer(config, async (base, app, deps) => {
    const { repos } = deps;
    const { freelancer, cookie } = seedSignedIn(repos, { email: 'f@example.test', displayName: 'Freda Lancer' });
    auth.headers = signedInHeaders(base, cookie);
    await fn({ base, app, config, repos, freelancer });
  });
}

const postForm = (url, fields) =>
  fetch(url, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...auth.headers },
    body: typeof fields === 'string' ? fields : new URLSearchParams(fields).toString(),
  });

/** A response body is readable exactly once, so every case reads it up front
 *  and uses the text both as the assertion message and as the assertion. */
async function post(url, fields) {
  const res = await postForm(url, fields);
  return { res, body: await res.text() };
}

/** The new id as the screens will read it back: out of the Location header's
 *  own query, never out of a response body — there is no response body. */
const mintedId = (res) => new URL(res.headers.get('location'), 'http://placeholder.invalid').searchParams.get('clientId');

/** The built app's routes, by walking the router tree — the auth.test.js walk,
 *  narrowed to this task's surface. */
function discoverRoutes(app) {
  const found = [];
  const walk = (stack) => {
    for (const layer of stack) {
      if (layer.route) {
        for (const method of Object.keys(layer.route.methods)) found.push(`${method.toUpperCase()} ${layer.route.path}`);
      } else if (layer.handle?.stack) {
        walk(layer.handle.stack);
      }
    }
  };
  walk(app.router.stack);
  return found.sort();
}

const routeSource = () => readFileSync(join(APP_DIR, 'routes', 'clients.js'), 'utf8');

// =============================================================================
// L — the HTTP surface
// =============================================================================

test('L1: POST /clients creates exactly one row and redirects 303 to the submitted next carrying the new id', async () => {
  await withClientApp(async ({ base, app, config, repos, freelancer }) => {
    // Registered exactly once, and the only path in the app under /clients.
    const clientPaths = discoverRoutes(app).filter((r) => r.split(' ')[1].startsWith('/clients'));
    assert.equal(clientPaths.length, 1, `cardinality before quantification: ${clientPaths.join(', ')}`);
    assert.deepEqual(clientPaths, ['POST /clients']);

    const { res, body } = await post(`${base}/clients`, { ...CLIENT_INPUT(), next: '/invoices/new' });
    // A 400 here would be the parsed-body trap: passing req.body straight
    // through carries `next` into the repository's field allowlist and refuses
    // every valid request.
    assert.equal(res.status, 303, body);
    assert.equal((res.headers.get('content-type') ?? '').includes('json'), false, 'no JSON body — the screens re-render from the DB, never from a response');

    const rows = repos.clients.listByFreelancer(freelancer.id);
    assert.equal(rows.length, 1, 'exactly one row');
    assert.equal(countRows(config, 'clients'), 1, 'and exactly one in the whole file');
    assert.equal(rows[0].name, 'Client Co');
    assert.equal(rows[0].email, 'client@example.test');
    assert.equal(rows[0].freelancerId, freelancer.id);
    // No customer is minted on anybody's payment-processor account by this
    // route; that happens lazily at invoice finalize, which is AS-43's design.
    assert.equal(rows[0].stripeCustomerId, null);

    // THE LOCATION HEADER IS THE CONTRACT, asserted WITHOUT dereferencing it:
    // the screen it returns to is AS-46's and 404s until it lands.
    assert.equal(res.headers.get('location'), `/invoices/new?clientId=${rows[0].id}`);
    assert.equal(res.headers.get('location').includes('freelancer'), false, 'the redirect carries no identity');
  });
});

test('L2: the minted id is immediately spendable — POST /contracts takes it, and both reads find it', async () => {
  await withClientApp(async ({ base, config, repos, freelancer }) => {
    const created = await post(`${base}/clients`, { ...CLIENT_INPUT(), next: '/contracts/new' });
    assert.equal(created.res.status, 303, created.body);
    const id = mintedId(created.res);
    assert.ok(typeof id === 'string' && id.length > 0, 'the Location carries a clientId');

    // The two reads AS-46 and AS-47 build their picker and their duplicate
    // warning from.
    assert.deepEqual(repos.clients.listByFreelancer(freelancer.id).map((c) => c.id), [id]);
    assert.deepEqual(repos.clients.findByEmail(freelancer.id, 'client@example.test').map((c) => c.id), [id]);
    assert.equal(repos.clients.getById(freelancer.id, id).id, id);

    // And the consumer that already existed accepts it, in the same session.
    const contract = await post(`${base}/contracts`, { clientId: id, ...CONTRACT_INPUT() });
    assert.equal(contract.res.status, 303, contract.body);
    const contracts = repos.contracts.listByFreelancer(freelancer.id);
    assert.equal(contracts.length, 1, 'cardinality before quantification');
    assert.equal(contracts[0].clientId, id);
    assert.equal(countRows(config, 'clients'), 1, 'and spending it created no second client');
  });
});

test('L3: a repeat submission creates a SECOND row — nothing converges, and both are findByEmail hits', async () => {
  await withClientApp(async ({ base, config, repos, freelancer }) => {
    // A BYTE-IDENTICAL DOUBLE SUBMIT. The schema declined to make email unique
    // on purpose, and the states ledger requires "create a new one anyway" to
    // be reachable — an endpoint that converged could not express it.
    const first = await post(`${base}/clients`, { ...CLIENT_INPUT(), next: '/invoices/new' });
    const second = await post(`${base}/clients`, { ...CLIENT_INPUT(), next: '/invoices/new' });
    assert.equal(first.res.status, 303, first.body);
    assert.equal(second.res.status, 303, second.body);
    assert.notEqual(mintedId(first.res), mintedId(second.res), 'the second submission did NOT converge on the first row');

    // Same email, DIFFERENT name — the shared-inbox case, which is the one
    // convergence would break by returning a row the freelancer did not name.
    const third = await post(`${base}/clients`, { name: 'Client Co (Accounts)', email: 'client@example.test', next: '/invoices/new' });
    assert.equal(third.res.status, 303, third.body);

    assert.equal(countRows(config, 'clients'), 3, 'three submissions, three rows');
    const hits = repos.clients.findByEmail(freelancer.id, 'client@example.test');
    assert.equal(hits.length, 3, 'findByEmail returns all of them — it is the duplicate warning\'s source');
    assert.equal(new Set(hits.map((c) => c.id)).size, 3, 'three DISTINCT ids');
    // NOTHING WAS MUTATED: the first row still says what was first submitted.
    const firstRow = repos.clients.getById(freelancer.id, mintedId(first.res));
    assert.equal(firstRow.name, 'Client Co');
    assert.equal(firstRow.createdAt, firstRow.updatedAt, 'the first row was never rewritten');
    assert.deepEqual(hits.map((c) => c.name).sort(), ['Client Co', 'Client Co', 'Client Co (Accounts)']);
  });
});

test('L4: a missing or blank name or email is a 400 and creates nothing', async () => {
  await withClientApp(async ({ base, config, repos, freelancer }) => {
    const bodies = [
      { next: '/invoices/new' },
      { name: 'Client Co', next: '/invoices/new' },
      { email: 'client@example.test', next: '/invoices/new' },
      { name: '', email: 'client@example.test', next: '/invoices/new' },
      { name: 'Client Co', email: '', next: '/invoices/new' },
      { name: '   ', email: 'client@example.test', next: '/invoices/new' },
      { name: 'Client Co', email: ' \t ', next: '/invoices/new' },
    ];
    for (const fields of bodies) {
      const label = JSON.stringify(fields);
      const { res, body } = await post(`${base}/clients`, fields);
      assert.equal(res.status, 400, `${label}: ${body}`);
      assert.match(res.headers.get('content-type'), /text\/plain/, label);
      assert.equal(body, 'ValidationError: create\n', label);
    }
    assert.equal(countRows(config, 'clients'), 0);
    assert.deepEqual(repos.clients.listByFreelancer(freelancer.id), []);
  });
});

test('L5: an unknown body field is a 400 and creates nothing — the route contributes NO allowlist of its own', async () => {
  await withClientApp(async ({ base, config, repos, freelancer }) => {
    // Cardinality before quantification — six unknown-field bodies, one request
    // each. `constructor` and `__proto__[polluted]` are here because they are
    // the inherited-name neighbours of the carve-out below: both DO reach the
    // repository's allowlist, and both must keep answering 400 for that
    // carve-out to be about the parser rather than about this route.
    const unknown = [
      { phone: '555' },
      { Name: 'wrong case' },
      { notes: 'hello' },
      { 'contacts[0][name]': 'x' },
      { constructor: 'x' },
      { '__proto__[polluted]': '1' },
    ];
    assert.equal(unknown.length, 6);
    for (const extra of unknown) {
      const label = JSON.stringify(extra);
      const { res, body } = await post(`${base}/clients`, { ...CLIENT_INPUT(), ...extra, next: '/invoices/new' });
      assert.equal(res.status, 400, `${label}: ${body}`);
      assert.equal(body, 'ValidationError: create\n', label);
    }
    assert.equal(countRows(config, 'clients'), 0);
    assert.deepEqual(repos.clients.listByFreelancer(freelancer.id), []);
    // THE REFUSAL IS THE REPOSITORY'S, not a second list in the route: the same
    // key names ITSELF there, which is where a drifting copy would show up.
    assert.throws(
      () => repos.clients.create(freelancer.id, { ...CLIENT_INPUT(), phone: '555' }),
      (err) => err.name === 'ValidationError' && err.field === 'client.phone',
    );

    // THE ONE CARVE-OUT, PINNED RATHER THAN FIXED (review cycle 1, finding
    // F-3). A bare `__proto__` is the single unknown field that answers 303:
    // the body parser drops the key before the route sees a body at all, so it
    // never reaches the repository's allowlist. The route adds no allowlist of
    // its own and must not grow one for this — a route-level copy is the second
    // source of truth the design refuses.
    //
    // THREE ASSERTIONS, NOT ONE. Pinning only the 303 would stay green on the
    // day a parser upgrade lets the key back into the parsed body, which is the
    // exact event this pin exists to catch: it would then be vacuous in
    // precisely the way L7 was. So the status, the absence of pollution, and
    // the neighbours' 400s are asserted together. The raw body string is
    // deliberate — `{ __proto__: 'x' }` in an object literal sets a prototype
    // instead of a key, so a literal could not send this field at all.
    const before = { ...Object.prototype };
    const carveOut = await post(`${base}/clients`, 'name=Client+Co&email=client%40example.test&next=%2Finvoices%2Fnew&__proto__=polluted');
    assert.equal(carveOut.res.status, 303, carveOut.body);
    assert.equal(Object.prototype.polluted, undefined, 'Object.prototype was polluted');
    assert.equal({}.polluted, undefined, 'a fresh object inherited a polluted key');
    assert.deepEqual({ ...Object.prototype }, before, 'Object.prototype gained an own key');
    const rows = repos.clients.listByFreelancer(freelancer.id);
    assert.equal(rows.length, 1, 'the carve-out creates exactly one row, and it is the first of this case');
    assert.equal(Object.getPrototypeOf(rows[0]), Object.prototype, 'the created row carries a poisoned prototype');
    assert.equal(rows[0].name, 'Client Co');
    assert.equal(countRows(config, 'clients'), 1);
  });
});

test('L6: a next that is absent or refused by safeNext is a 400 and creates nothing', async () => {
  await withClientApp(async ({ base, config, repos, freelancer }) => {
    // VALIDATED BEFORE THE INSERT — the row count at the end is the assertion
    // that matters, not the status. Required rather than defaulted: there is no
    // meaningful default landing for client creation, and falling back to `/`
    // would silently discard the invoice or contract in progress.
    const refused = [
      undefined,
      '',
      'invoices/new',
      '//evil.test/steal',
      '/\\evil.test/steal',
      'https://evil.test/steal',
      '/invoices/new?to=x://y',
      '/invoices/new\r\nSet-Cookie: a=b',
    ];
    for (const next of refused) {
      const label = JSON.stringify(next);
      const fields = { ...CLIENT_INPUT() };
      if (next !== undefined) fields.next = next;
      const { res, body } = await post(`${base}/clients`, fields);
      assert.equal(res.status, 400, `${label}: ${body}`);
      assert.equal(body, 'ValidationError: create\n', label);
    }
    // A REPEATED next arrives as an array and is refused for the same reason.
    const repeated = await post(`${base}/clients`, 'name=Client+Co&email=c%40example.test&next=%2Fa&next=%2Fb');
    assert.equal(repeated.res.status, 400, repeated.body);
    assert.equal(countRows(config, 'clients'), 0, 'a refused return path leaves NO row behind');
    assert.deepEqual(repos.clients.listByFreelancer(freelancer.id), []);
  });
});

test('L7: every accepted next composes to an app-relative Location that keeps the screen\'s own query', async () => {
  await withClientApp(async ({ base, config }) => {
    const cases = [
      { next: '/invoices/new', expect: (id) => `/invoices/new?clientId=${id}` },
      // The sanctioned mechanism for carrying a half-filled form across the
      // round trip: the caller's own query survives, in its own order.
      { next: '/invoices/new?draft=inv_1&issueDate=2026-09-08', expect: (id) => `/invoices/new?draft=inv_1&issueDate=2026-09-08&clientId=${id}` },
      { next: '/contracts/new?templateId=agreement%401#scope', expect: (id) => `/contracts/new?templateId=agreement%401&clientId=${id}#scope` },
      // SET, not append: a stale id from a previous round trip is replaced,
      // never duplicated.
      { next: '/invoices/new?clientId=stale&keep=1', expect: (id) => `/invoices/new?clientId=${id}&keep=1` },
    ];
    let n = 0;
    for (const { next, expect } of cases) {
      n += 1;
      // A DISTINCT email per case, so this stays green under the duplicate
      // recipe and reddens for its own reason alone.
      const { res, body } = await post(`${base}/clients`, { name: `Client ${n}`, email: `client${n}@example.test`, next });
      assert.equal(res.status, 303, `${next}: ${body}`);
      const location = res.headers.get('location');
      assert.equal(location, expect(mintedId(res)), next);
      // App-relative, four independent ways.
      assert.equal(location.startsWith('/'), true, next);
      assert.equal(location.startsWith('//'), false, next);
      assert.equal(location.includes('://'), false, next);
      const parsed = new URL(location, 'http://placeholder.invalid');
      assert.equal(parsed.host, 'placeholder.invalid', next);
      assert.equal(parsed.searchParams.getAll('clientId').length, 1, next);
    }
    assert.equal(countRows(config, 'clients'), cases.length, 'cardinality before quantification');
  });
});

test('L8: identity is the session\'s, and the minted id is inert for every other freelancer', async () => {
  await withClientApp(async ({ base, config, repos, freelancer }) => {
    const other = repos.freelancers.create({ email: 'otto@example.test', displayName: 'Otto Ther' });

    // (a) THE QUERY STRING IS NEVER READ FOR IDENTITY. The row is the session's.
    const named = await post(
      `${base}/clients?freelancerId=${encodeURIComponent(other.id)}&freelancer=${encodeURIComponent(other.id)}`,
      { ...CLIENT_INPUT(), next: '/invoices/new' },
    );
    assert.equal(named.res.status, 303, named.body);
    assert.deepEqual(repos.clients.listByFreelancer(other.id), [], 'NOT created for the NAMED freelancer');
    const ours = repos.clients.listByFreelancer(freelancer.id);
    assert.equal(ours.length, 1, 'created for the SESSION\'s freelancer');
    assert.equal(ours[0].freelancerId, freelancer.id);
    assert.equal(named.res.headers.get('location').includes('freelancer'), false);

    // (b) NOR IS THE BODY — and because the route adds no allowlist of its own,
    // the repository's refuses the key outright: no row for anyone.
    const inBody = await post(`${base}/clients`, {
      name: 'Their Co',
      email: 'theirs@example.test',
      freelancerId: other.id,
      next: '/invoices/new',
    });
    assert.equal(inBody.res.status, 400, inBody.body);
    assert.equal(inBody.body, 'ValidationError: create\n');
    assert.equal(countRows(config, 'clients'), 1, 'no row for anyone — the count is unchanged');
    assert.deepEqual(repos.clients.listByFreelancer(other.id), []);

    // (c) THE MINTED ID IS INERT FOR EVERY OTHER FREELANCER, and says so in the
    // same bytes a nonexistent client does.
    const { cookie: theirCookie } = seedSession(repos, other.id);
    const theirHeaders = {
      'content-type': 'application/x-www-form-urlencoded',
      ...signedInHeaders(base, theirCookie),
    };
    const asOther = async (fields) => {
      const res = await fetch(`${base}/contracts`, {
        method: 'POST',
        redirect: 'manual',
        headers: theirHeaders,
        body: new URLSearchParams(fields).toString(),
      });
      return { res, body: await res.text() };
    };
    const stolen = await asOther({ clientId: ours[0].id, ...CONTRACT_INPUT() });
    assert.equal(stolen.res.status, 404, stolen.body);
    assert.equal(stolen.body, 'NotFoundError: create\n');
    const missing = await asOther({ clientId: 'no-such-client', ...CONTRACT_INPUT() });
    assert.equal(missing.res.status, 404, missing.body);
    assert.equal(missing.body, 'NotFoundError: create\n', 'byte-identical to a client that does not exist');
    assert.equal(countRows(config, 'contracts'), 0);
  });
});

test('L9: a body past the parser\'s limit answers with the parser\'s own status and creates nothing', async () => {
  await withClientApp(async ({ base, config, repos, freelancer }) => {
    // Past the 32kb router-scoped limit: it never reaches a handler, so it
    // needs the router's own error middleware to land in the house shape.
    const huge = await post(`${base}/clients`, `name=${'x'.repeat(40_000)}`);
    assert.equal(huge.res.status, 413, huge.body);
    assert.match(huge.res.headers.get('content-type'), /text\/plain/);
    assert.match(huge.body, /parse-body/);
    // Past the 20-parameter limit: the parser's own status again.
    const manyFields = {};
    for (let i = 0; i < 40; i += 1) manyFields[`f${i}`] = 'x';
    const many = await post(`${base}/clients`, { ...CLIENT_INPUT(), next: '/invoices/new', ...manyFields });
    assert.equal(many.res.status, 413, many.body);
    assert.match(many.body, /parse-body/);
    assert.equal(countRows(config, 'clients'), 0);
    assert.deepEqual(repos.clients.listByFreelancer(freelancer.id), []);
  });
});

test('L10: clientRoutes is constructed from repos alone and nothing on this path names a payment processor', async () => {
  await withRepos(async (repos) => {
    // It CONSTRUCTS with no second dependency at all — not "tolerates a missing
    // one": there is nothing to miss.
    const router = clientRoutes(configFor(), { repos });
    assert.equal(typeof router, 'function');
    const routes = router.stack
      .filter((layer) => layer.route)
      .map((layer) => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`);
    assert.deepEqual(routes, ['POST /clients']);
    assert.equal(clientRoutes.length, 2, 'the (config, deps) shape every mount line in app.js uses');
    // A client is born with no customer on anybody's account.
    const freelancer = repos.freelancers.create({ email: 'f@example.test', displayName: 'Freda Lancer' });
    assert.equal(repos.clients.create(freelancer.id, CLIENT_INPUT()).stripeCustomerId, null);
  });
  // Raw text, comments included — the dependency-policy row that pins the
  // processor's name to seven files does not list this one, and this is its
  // local witness.
  const source = routeSource();
  assert.ok(source.length > 0, 'routes/clients.js is empty — the scan is reading nothing');
  assert.deepEqual(source.match(/stripe/gi) ?? [], [], 'the client-creation path names the payment processor');
  // And app.js never hands this router a second dependency. Stated as an
  // ABSENCE, so that deleting the mount line cannot make this case red for a
  // reason it is not about — that partition is auth.test.js's to guard.
  const appSource = readFileSync(join(APP_DIR, 'app.js'), 'utf8');
  assert.equal(/clientRoutes\([^)]*stripe/.test(appSource), false, 'clientRoutes is never handed a stripe dependency');
});

test('L11: the error taxonomy is exact in BOTH directions', async () => {
  const source = routeSource();
  // DIRECTION 1 — every class this route MAPS is named here, and there is
  // exactly one. Read off the CODE, not off a comment: the banner names the
  // classes it deliberately does not map, and that prose must not be able to
  // satisfy this assertion.
  const mapped = [...source.matchAll(/instanceof\s+(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(mapped, ['ValidationError'], `statusFor maps [${mapped.join(', ')}]`);
  // The parser's own status is the one non-class branch.
  assert.equal((source.match(/Number\.isInteger\(err\?\.status\)/g) ?? []).length, 1);
  // Nothing else is IMPORTED to be mapped: an unreachable mapping would have to
  // bring its class in, and this is where that would show.
  const imported = source.match(/import \{ ([^}]+) \} from '\.\.\/lib\/db\/database\.js';/)[1];
  assert.deepEqual(imported.split(',').map((s) => s.trim()), ['ValidationError']);

  // DIRECTION 2 — every class it maps is REACHED from this file, and the
  // reachable status set is exactly the three the plan declares. A 404 or a 409
  // appearing here would mean a mapping arrived without a case.
  await withClientApp(async ({ base, config }) => {
    const seen = new Set();
    seen.add((await post(`${base}/clients`, { name: 'Client Co', email: '', next: '/invoices/new' })).res.status);
    seen.add((await post(`${base}/clients`, `name=${'x'.repeat(40_000)}`)).res.status);
    seen.add((await post(`${base}/clients`, { ...CLIENT_INPUT(), next: '/invoices/new' })).res.status);
    assert.deepEqual([...seen].sort(), [303, 400, 413], 'the reachable status set');
    assert.equal(countRows(config, 'clients'), 1, 'only the accepted submission wrote a row');
  });
});

test('L12: a next safeNext ACCEPTS but normalization turns hostile is refused at emission — and the row it already wrote stays', async () => {
  await withClientApp(async ({ base, config, repos, freelancer }) => {
    // THE CLASS NO CASE COULD SEE. RFC 3986 §4.2 decides "network-path
    // reference" on the RAW reference, before §5.2.4 dot-segment removal — so
    // `/.//evil.test` is path-absolute, stays on this origin if it is emitted
    // as it arrived, and safeNext accepts it CORRECTLY. `new URL(...)` performs
    // that removal and hands back `//evil.test`, which re-emitted standalone is
    // a network-path reference to somebody else's host. The escape is not in
    // the input; composition manufactures it, and only a check on the composed
    // string can see it.
    //
    // CLASS (b) IS NOT DECORATION. Without it, "refuse anything normalization
    // touched" would pass this case — a different and more brittle rule than
    // the one this route implements, and one that 400s legitimate screens.
    // Class (c) is what tells a working route from one that refuses everything.
    const cases = [
      // (a) accepted, and normalization makes it hostile.
      { klass: 'a', next: '/.//evil.test' },
      { klass: 'a', next: '/..//evil.test' },
      { klass: 'a', next: '/%2e//evil.test' },
      { klass: 'a', next: '/%2E%2E//evil.test' },
      { klass: 'a', next: '/a/..//evil.test' },
      { klass: 'a', next: '/.//user:pass@evil.test/x' },
      { klass: 'a', next: '/.//evil.test:8080/x' },
      { klass: 'a', next: '/.//evil.test/path?a=b#frag' },
      { klass: 'a', next: '/.//' },
      // (b) accepted, normalization CHANGES it, and the result is benign.
      { klass: 'b', next: '/a/../invoices/new', expect: (id) => `/invoices/new?clientId=${id}` },
      { klass: 'b', next: '/invoices/./new', expect: (id) => `/invoices/new?clientId=${id}` },
      // (c) accepted, normalization changes nothing — the control.
      { klass: 'c', next: '/contracts/new', expect: (id) => `/contracts/new?clientId=${id}` },
    ];
    // CARDINALITY BEFORE QUANTIFICATION, and per class: an input set is
    // specified by the discriminating inputs it must contain, never by a count,
    // so the count of each CLASS is what is pinned here.
    assert.equal(cases.length, 12);
    assert.equal(cases.filter((c) => c.klass === 'a').length, 9);
    assert.equal(cases.filter((c) => c.klass === 'b').length, 2);
    assert.equal(cases.filter((c) => c.klass === 'c').length, 1);

    let n = 0;
    for (const { klass, next, expect } of cases) {
      n += 1;
      // A DISTINCT email per input, so this case stays green under the
      // duplicate-convergence recipe and reddens for its own reason alone.
      const email = `l12-${n}@example.test`;
      // EVERY INPUT IS IN THE ACCEPTED CLASS, asserted rather than claimed:
      // safeNext returns the value unchanged, so a 400 below can only have come
      // from the check on the EMITTED string.
      assert.equal(safeNext(next), next, `${next} is not in the accepted class`);
      const normalized = new URL(next, 'http://placeholder.invalid').pathname;
      if (klass === 'a') {
        assert.equal(normalized.startsWith('//'), true, `${next} does not normalize to a network-path reference`);
      } else if (klass === 'b') {
        assert.notEqual(normalized, next.split('?')[0], `${next} is not changed by normalization`);
        assert.equal(normalized.startsWith('//'), false, `${next} is not benign after normalization`);
      } else {
        assert.equal(normalized, next, `${next} is changed by normalization`);
      }

      const { res, body } = await post(`${base}/clients`, { name: `Client ${n}`, email, next });
      if (klass === 'a') {
        assert.equal(res.status, 400, `${next}: ${body}`);
        assert.match(res.headers.get('content-type'), /text\/plain/, next);
        // BY CLASS, NEVER BY TEXT — the same body the input check answers with.
        // Which guard fired is told apart by the row count, below, not here.
        assert.equal(body, 'ValidationError: create\n', next);
        assert.equal(res.headers.get('location'), null, `${next} emitted a Location anyway`);
      } else {
        assert.equal(res.status, 303, `${next}: ${body}`);
        const location = res.headers.get('location');
        assert.equal(location, expect(mintedId(res)), next);
        assert.equal(location.startsWith('//'), false, next);
        assert.equal(location.includes('://'), false, next);
        assert.equal(new URL(location, 'http://placeholder.invalid').host, 'placeholder.invalid', next);
      }

      // A REFUSAL AT THE SECOND CHECK LEAVES THE ROW, and that is the ruled,
      // accepted cost — asserted as an EXISTENCE, deliberately. An implementer
      // reading "400" as "no row" would move that check somewhere it can no
      // longer see what is emitted, which is exactly how the defect happened:
      // this route creates unconditionally by design, and here only the return
      // trip failed. The row is fully formed and owned by the session.
      const written = repos.clients.findByEmail(freelancer.id, email);
      assert.equal(written.length, 1, `${next}: exactly one row for this input`);
      assert.equal(written[0].name, `Client ${n}`, next);
      assert.equal(written[0].freelancerId, freelancer.id, next);
      assert.equal(countRows(config, 'clients'), n, `${next}: one row per input, cumulative`);
    }
    assert.equal(countRows(config, 'clients'), cases.length, 'twelve inputs, twelve rows');
    assert.equal(repos.clients.listByFreelancer(freelancer.id).length, cases.length);
  });
});
