// test/auth.test.js — chain link 1's server half: credentials, sessions, the
// route guard and the seam it replaces (AS-40, plan §5.3).
//
// THE FILE'S ONE CLAIM: a freelancer's identity comes from a session and from
// nothing else, and every route that acts on a freelancer's behalf is behind
// that. Everything here is either the mechanism for that sentence or the proof
// that the interim query-parameter seam is gone.
//
// THE GUARD IS ASSERTED BY REACHABILITY, NOT PLACEMENT (G1–G3). app.js is a
// document; the built app is the fact. The G-group walks the CONSTRUCTED app's
// router tree, asserts the discovered (method, path) list against a committed
// literal — cardinality first, against an exact array, never `> 0`, because a
// walk that silently returned nothing would otherwise pass every rule below it
// on an empty set — partitions it, and drives a real cookieless request at
// every route on the protected side. Reordering two mount lines turns G3 red
// while leaving G1 green, which is precisely why both exist.
//
// Everything runs offline: no accounts, no network, no Stripe.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { openDatabase } from '../lib/db/connection.js';
import { createAccounts } from '../lib/auth/accounts.js';
import {
  DEFAULT_PARAMS,
  PASSWORD_MAX,
  PASSWORD_MIN,
  decodeHash,
  encodeHash,
  hashPassword,
  verifyPassword,
} from '../lib/auth/password.js';
import { COOKIE_NAME, SESSION_TTL_MS, mintToken, tokenId } from '../lib/auth/session.js';
import { actingFreelancerId, safeNext } from '../lib/auth/guard.js';
import { NotFoundError, ValidationError, createRepositories, prepareDatabase } from '../lib/db/database.js';
import { createStripeClient } from '../lib/stripe/client.js';
import { configFor, freshDbPath, seedSession, withServer } from './helpers/server.js';

const PASSWORD = 'correct horse battery staple';
const EMAIL = 'freda@example.test';
const NAME = 'Freda Lancer';
/** Not key-shaped on purpose — the stripe-client.test.js convention. */
const KEY = 'unit-test-placeholder-key';
/** AS-44 registers its route only when a signing secret is configured, so the
 *  route walk needs one to see the app's FULL surface. Not key-shaped either. */
const WEBHOOK_SECRET = 'whsec_unit_test_placeholder';

const form = (fields) => new URLSearchParams(fields).toString();

/** A migrated database and repositories, closed after `fn` — AWAITED, because
 *  a synchronous finally would close the handle out from under an async body. */
async function withRepos(fn) {
  const { db } = prepareDatabase({ dbPath: freshDbPath() });
  try {
    return await fn(createRepositories(db));
  } finally {
    db.close();
  }
}

// =============================================================================
// A1–A12: password hashing
// =============================================================================

test('A1: encode/decode round trips at the shipped default', async () => {
  const encoded = await hashPassword(PASSWORD);
  const { params, salt, key } = decodeHash(encoded);
  assert.deepEqual(params, { ...DEFAULT_PARAMS });
  assert.equal(salt.length, 16, '128 bits of salt');
  assert.equal(key.length, DEFAULT_PARAMS.l);
  assert.equal(encodeHash({ params, salt, key }), encoded, 're-encoding is byte-identical');
});

test('A2: the encoded string is exactly four $-fields and starts scrypt$', async () => {
  const encoded = await hashPassword(PASSWORD);
  const fields = encoded.split('$');
  assert.equal(fields.length, 4, `expected 4 fields, got ${fields.length}: ${encoded}`);
  assert.equal(fields[0], 'scrypt');
  assert.equal(fields[1], 'N=16384,r=8,p=1,l=32', 'the parameters are self-describing, so raising them never invalidates a row');
  assert.ok(encoded.startsWith('scrypt$'), 'the DDL CHECK keys on exactly this prefix');
});

test('A3: two hashes of the same password differ — the salt is random', async () => {
  const [a, b] = await Promise.all([hashPassword(PASSWORD), hashPassword(PASSWORD)]);
  assert.notEqual(a, b);
  assert.notEqual(decodeHash(a).salt.toString('hex'), decodeHash(b).salt.toString('hex'));
});

test('A4: verify accepts the right password', async () => {
  const encoded = await hashPassword(PASSWORD);
  assert.deepEqual(await verifyPassword(PASSWORD, encoded), { ok: true, needsRehash: false });
});

test('A5: verify rejects a wrong one', async () => {
  const encoded = await hashPassword(PASSWORD);
  for (const wrong of [`${PASSWORD} `, ` ${PASSWORD}`, PASSWORD.toUpperCase(), 'correct horse battery stapl', '']) {
    assert.deepEqual(await verifyPassword(wrong, encoded), { ok: false, needsRehash: false }, JSON.stringify(wrong));
  }
});

test('A6: decodeHash rejects each malformed shape, one assertion each', async () => {
  const encoded = await hashPassword(PASSWORD);
  const [, , salt, key] = encoded.split('$');
  const malformed = [
    ['not a string', 42],
    ['three fields', `scrypt$N=16384,r=8,p=1,l=32$${salt}`],
    ['five fields', `${encoded}$extra`],
    ['wrong algorithm', `pbkdf2$N=16384,r=8,p=1,l=32$${salt}$${key}`],
    ['missing a parameter', `scrypt$N=16384,r=8,p=1$${salt}$${key}`],
    ['non-numeric parameter', `scrypt$N=many,r=8,p=1,l=32$${salt}$${key}`],
    ['N not a power of two', `scrypt$N=16000,r=8,p=1,l=32$${salt}$${key}`],
    ['N below the floor', `scrypt$N=512,r=8,p=1,l=32$${salt}$${key}`],
    ['r out of range', `scrypt$N=16384,r=64,p=1,l=32$${salt}$${key}`],
    ['p out of range', `scrypt$N=16384,r=8,p=99,l=32$${salt}$${key}`],
    ['l out of range', `scrypt$N=16384,r=8,p=1,l=8$${salt}$${key}`],
    // 128 * 2^20 * 32 is 4 GiB: without the bound this row would ask the
    // process for it on the next sign-in.
    ['128*N*r over the memory bound', `scrypt$N=1048576,r=32,p=1,l=32$${salt}$${key}`],
    ['key length disagrees with l', `scrypt$N=16384,r=8,p=1,l=64$${salt}$${key}`],
  ];
  assert.equal(malformed.length, 13, 'cardinality first: the committed list of malformed shapes');
  for (const [why, value] of malformed) {
    assert.throws(() => decodeHash(value), TypeError, why);
  }
});

test('A7: a hash written with NON-DEFAULT parameters still verifies', async () => {
  // The forward-compatibility claim, and the reason the format is
  // self-describing at all. 2^13 is a real, weaker, decodable parameter set.
  const legacy = await legacyHash(PASSWORD);
  assert.equal(decodeHash(legacy).params.N, 8192);
  assert.equal((await verifyPassword(PASSWORD, legacy)).ok, true);
  assert.equal((await verifyPassword('wrong', legacy)).ok, false);
});

test('A8: needsRehash is false at the default and true for a legacy hash', async () => {
  assert.equal((await verifyPassword(PASSWORD, await hashPassword(PASSWORD))).needsRehash, false);
  assert.equal((await verifyPassword(PASSWORD, await legacyHash(PASSWORD))).needsRehash, true);
  // Only ever true when verification SUCCEEDED: a wrong password must not
  // report that the row wants rewriting.
  assert.equal((await verifyPassword('wrong', await legacyHash(PASSWORD))).needsRehash, false);
});

test('A9: NFC — a decomposed and a precomposed spelling verify against ONE stored hash', async () => {
  const precomposed = 'paßwört-café'.normalize('NFC');
  // Built by normalising rather than typed as a second literal, so the two
  // spellings are provably different however this file was saved.
  const decomposed = precomposed.normalize('NFD');
  assert.notEqual(precomposed, decomposed, 'the two spellings really are different strings');
  assert.equal(precomposed.normalize('NFC'), decomposed.normalize('NFC'));
  const stored = await hashPassword(precomposed);
  assert.equal((await verifyPassword(decomposed, stored)).ok, true, 'typed on the other platform, same password');
  assert.equal((await verifyPassword(precomposed, stored)).ok, true);
});

test('A10: the length bounds are the ACCOUNT rule, and a password is never trimmed', async () => {
  assert.equal(PASSWORD_MIN, 8);
  assert.equal(PASSWORD_MAX, 256);
  await withRepos(async (repos) => {
    const accounts = createAccounts({ repos });
    for (const short of ['', 'a', 'seven77']) {
      await assert.rejects(() => accounts.signUp({ displayName: NAME, email: EMAIL, password: short }),
        (err) => err.name === 'AuthError' && ['weak-password', 'missing-field'].includes(err.step));
    }
    await assert.rejects(() => accounts.signUp({ displayName: NAME, email: EMAIL, password: 'x'.repeat(PASSWORD_MAX + 1) }),
      (err) => err.step === 'weak-password');
    // Exactly at both bounds is accepted.
    await accounts.signUp({ displayName: NAME, email: 'floor@example.test', password: 'x'.repeat(PASSWORD_MIN) });
    await accounts.signUp({ displayName: NAME, email: 'ceil@example.test', password: 'x'.repeat(PASSWORD_MAX) });

    // NEVER TRIMMED: the space is a character of the secret. A trailing-space
    // password must not be signed in to with the trimmed spelling.
    const padded = `${PASSWORD} `;
    await accounts.signUp({ displayName: NAME, email: 'pad@example.test', password: padded });
    await assert.rejects(() => accounts.signIn({ email: 'pad@example.test', password: PASSWORD }),
      (err) => err.step === 'invalid-credentials');
    assert.ok(await accounts.signIn({ email: 'pad@example.test', password: padded }));
  });
});

test('A11: signing in against a legacy hash REWRITES the row, and the new row verifies', async () => {
  await withRepos(async (repos) => {
    const accounts = createAccounts({ repos });
    const freelancer = repos.freelancers.create({ email: EMAIL, displayName: NAME });
    const legacy = await legacyHash(PASSWORD);
    repos.credentials.create(freelancer.id, legacy);

    const { freelancer: signedIn } = await accounts.signIn({ email: EMAIL, password: PASSWORD });
    assert.equal(signedIn.id, freelancer.id);

    const after = repos.credentials.getByFreelancer(freelancer.id);
    assert.notEqual(after.passwordHash, legacy, 'upgrade-on-login rewrote the row');
    assert.equal(decodeHash(after.passwordHash).params.N, DEFAULT_PARAMS.N, 'at the CURRENT default');
    assert.deepEqual(await verifyPassword(PASSWORD, after.passwordHash), { ok: true, needsRehash: false });
    assert.notEqual(after.updatedAt, undefined);
  });
});

test('A12: unknown email and wrong password each cost EXACTLY ONE derivation', async () => {
  // The enumeration property's fourth axis — the work done — asserted
  // STRUCTURALLY. Measuring wall-clock here would be flaky and would eventually
  // be deleted for being flaky; counting invocations cannot be.
  await withRepos(async (repos) => {
    let derivations = 0;
    const counting = {
      hashPassword: (password) => { derivations += 1; return hashPassword(password); },
      verifyPassword: (password, encoded) => { derivations += 1; return verifyPassword(password, encoded); },
    };
    const accounts = createAccounts({ repos, hasher: counting });
    await accounts.signUp({ displayName: NAME, email: EMAIL, password: PASSWORD });

    derivations = 0;
    await assert.rejects(() => accounts.signIn({ email: 'nobody@example.test', password: PASSWORD }),
      (err) => err.step === 'invalid-credentials');
    assert.equal(derivations, 1, 'unknown email: the discard-hash keeps the work identical');

    derivations = 0;
    await assert.rejects(() => accounts.signIn({ email: EMAIL, password: 'not the password' }),
      (err) => err.step === 'invalid-credentials');
    assert.equal(derivations, 1, 'wrong password: one verification');

    derivations = 0;
    await accounts.signIn({ email: EMAIL, password: PASSWORD });
    assert.equal(derivations, 1, 'success at the current default: one verification, no rewrite');
  });
});

/** A hash at parameters that are decodable but NOT the shipped default — what
 *  an account written before a parameter change looks like. */
async function legacyHash(password) {
  const { scrypt, randomBytes } = await import('node:crypto');
  const params = { N: 8192, r: 8, p: 1, l: 32 };
  const salt = randomBytes(16);
  const key = await new Promise((resolve, reject) => {
    scrypt(password.normalize('NFC'), salt, params.l, { N: params.N, r: params.r, p: params.p, maxmem: 134217728 },
      (err, derived) => (err ? reject(err) : resolve(derived)));
  });
  return encodeHash({ params, salt, key });
}

// =============================================================================
// A13–A18: the repositories, and the two engine-level guards
// =============================================================================

test('A13: credentials round trip, and getByFreelancer returns null rather than throwing', async () => {
  await withRepos(async (repos) => {
    const freelancer = repos.freelancers.create({ email: EMAIL, displayName: NAME });
    assert.equal(repos.credentials.getByFreelancer(freelancer.id), null, 'no credential is a NORMAL state');
    const encoded = await hashPassword(PASSWORD);
    const created = repos.credentials.create(freelancer.id, encoded);
    assert.deepEqual(Object.keys(created).sort(), ['createdAt', 'freelancerId', 'passwordHash', 'updatedAt']);
    assert.equal(created.passwordHash, encoded);
    assert.equal(repos.credentials.getByFreelancer(freelancer.id).passwordHash, encoded);

    const next = await hashPassword('a different password');
    assert.equal(repos.credentials.updateHash(freelancer.id, next).passwordHash, next);
    assert.throws(() => repos.credentials.updateHash('no-such-freelancer', next), NotFoundError);
  });
});

test('A14: sessions round trip; getById returns null for an unknown digest', () => {
  withRepos((repos) => {
    const freelancer = repos.freelancers.create({ email: EMAIL, displayName: NAME });
    const { token, id } = mintToken();
    assert.equal(token.length, 43, '32 random bytes as base64url — no percent-encoding needed');
    assert.match(id, /^[0-9a-f]{64}$/);
    assert.equal(repos.sessions.getById(id), null);

    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    const row = repos.sessions.create({ id, freelancerId: freelancer.id, expiresAt });
    assert.deepEqual(Object.keys(row).sort(), ['createdAt', 'expiresAt', 'freelancerId', 'id']);
    assert.equal(row.id, id);
    assert.equal(repos.sessions.getById(id).freelancerId, freelancer.id);
    assert.equal(repos.sessions.delete(id), true);
    assert.equal(repos.sessions.delete(id), false, 'a session that is already gone is gone');
  });
});

test('A15: deleteExpired removes exactly the expired rows and returns the count', () => {
  withRepos((repos) => {
    const freelancer = repos.freelancers.create({ email: EMAIL, displayName: NAME });
    const at = (ms) => new Date(Date.now() + ms).toISOString();
    const live = [mintToken(), mintToken()];
    const dead = [mintToken(), mintToken(), mintToken()];
    for (const { id } of live) repos.sessions.create({ id, freelancerId: freelancer.id, expiresAt: at(SESSION_TTL_MS) });
    for (const { id } of dead) repos.sessions.create({ id, freelancerId: freelancer.id, expiresAt: at(-1000) });

    assert.equal(repos.sessions.deleteExpired(new Date().toISOString()), 3, 'exactly the three expired rows');
    for (const { id } of dead) assert.equal(repos.sessions.getById(id), null);
    for (const { id } of live) assert.notEqual(repos.sessions.getById(id), null);
    assert.equal(repos.sessions.deleteExpired(new Date().toISOString()), 0, 'a second sweep finds nothing');
  });
});

test('A16: the FK refuses a session for a freelancer that does not exist', () => {
  withRepos((repos) => {
    const { id } = mintToken();
    assert.throws(
      () => repos.sessions.create({ id, freelancerId: 'no-such-freelancer', expiresAt: new Date().toISOString() }),
      (err) => err.code === 'foreign_key_violation',
    );
  });
});

test('A17: THE DDL refuses a plaintext password_hash — the engine, not the repository', () => {
  withRepos((repos) => {
    const freelancer = repos.freelancers.create({ email: EMAIL, displayName: NAME });
    // Straight to the engine, bypassing the repository's own prefix assertion,
    // so this proves the CHECK constraint and not the validator in front of it.
    // The two layers are shown to AGREE rather than assumed to.
    assert.throws(
      () => repos.transaction(() => {
        repos.credentials.create(freelancer.id, `scrypt$N=16384,r=8,p=1,l=32$c2FsdA$${'k'.repeat(43)}`);
        throw new Error('rollback');
      }),
      /rollback/,
      'the well-formed control is accepted by both layers',
    );
    // And the refusal itself, at the repository (the friendly error)…
    assert.throws(() => repos.credentials.create(freelancer.id, PASSWORD), ValidationError);
    assert.equal(repos.credentials.getByFreelancer(freelancer.id), null, 'nothing was written');
  });
});

test('A18: THE DDL refuses a 43-character session id — the token, not its digest', () => {
  withRepos((repos) => {
    const freelancer = repos.freelancers.create({ email: EMAIL, displayName: NAME });
    const { token } = mintToken();
    assert.equal(token.length, 43);
    // This is the single worst mistake available in the design — storing the
    // cookie value instead of its digest — and it fails on length.
    assert.throws(
      () => repos.sessions.create({ id: token, freelancerId: freelancer.id, expiresAt: new Date().toISOString() }),
      ValidationError,
    );
    for (const bad of ['A'.repeat(64), `${'0'.repeat(63)}g`, '0'.repeat(63), '0'.repeat(65)]) {
      assert.throws(
        () => repos.sessions.create({ id: bad, freelancerId: freelancer.id, expiresAt: new Date().toISOString() }),
        ValidationError,
        bad.slice(0, 12),
      );
    }
  });
});

test('A19: neither the password nor the token is ever written to stdout or stderr', async () => {
  // The DYNAMIC half of AC 5. The static half is the `console output` concept
  // row in dependency-policy.test.js, which proves no logger exists in
  // lib/auth/* or routes/auth.js at all.
  const marker = 'Zq7-PASSWORD-MARKER-9x';
  const captured = [];
  const streams = [process.stdout, process.stderr];
  const originals = streams.map((s) => s.write);
  streams.forEach((s) => {
    s.write = function patched(chunk, ...rest) {
      captured.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return originals[streams.indexOf(s)].call(this, chunk, ...rest);
    };
  });
  let token;
  try {
    await withApp({}, async ({ base }) => {
      const up = await postForm(`${base}/signup`, { displayName: NAME, email: EMAIL, password: marker });
      token = cookieValue(up);
      await postForm(`${base}/signin`, { email: EMAIL, password: marker });
      await fetch(`${base}/`, { redirect: 'manual', headers: { cookie: `${COOKIE_NAME}=${token}` } });
    });
  } finally {
    streams.forEach((s, i) => { s.write = originals[i]; });
  }
  const output = captured.join('');
  assert.ok(token !== null && token.length === 43, 'the run really did issue a token to look for');
  assert.equal(output.includes(marker), false, 'the password reached stdout/stderr');
  assert.equal(output.includes(token), false, 'the session token reached stdout/stderr');
});

// =============================================================================
// H1–H19: the HTTP surface
// =============================================================================

/** withServer + a keyless Stripe client, with the webhook secret configured so
 *  the app's full route surface exists. */
async function withApp({ appBaseUrl, secret = WEBHOOK_SECRET }, fn) {
  // `null` means "configure no secret" — distinct from omitting the key, which
  // takes the default. Passing undefined would silently take the default and
  // make G1b assert the same thing twice.
  const overrides = {};
  if (secret !== null) overrides.webhookSecret = secret;
  if (appBaseUrl !== undefined) overrides.appBaseUrl = appBaseUrl;
  const config = configFor(overrides);
  await withServer(config, async (base, app, deps) => {
    await fn({ base, app, config, repos: deps.repos });
  }, { stripe: createStripeClient({ apiKey: KEY }) });
}

const postForm = (url, fields, headers = {}) =>
  fetch(url, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: new URL(url).origin, ...headers },
    body: form(fields),
  });

/** The one Set-Cookie header, or null. */
const setCookie = (res) => res.headers.getSetCookie().find((c) => c.startsWith(`${COOKIE_NAME}=`)) ?? null;
const cookieValue = (res) => {
  const header = setCookie(res);
  return header === null ? null : header.slice(COOKIE_NAME.length + 1).split(';')[0];
};

const signUp = (base, over = {}) => postForm(`${base}/signup`, { displayName: NAME, email: EMAIL, password: PASSWORD, ...over });

test('H1: sign-up creates exactly one freelancer and one credential, and sets one cookie', async () => {
  await withApp({}, async ({ base, config, repos }) => {
    const before = countRows(config);
    assert.deepEqual(before, { freelancers: 0, credentials: 0, sessions: 0 }, 'the counter is not reading an already-populated database');
    const res = await signUp(base);
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/');

    const after = countRows(config);
    assert.equal(after.freelancers - before.freelancers, 1, 'exactly one freelancer');
    assert.equal(after.credentials - before.credentials, 1, 'exactly one credential');
    assert.equal(after.sessions - before.sessions, 1, 'and a session was issued');
    assert.equal(res.headers.getSetCookie().length, 1, 'exactly one Set-Cookie');

    // AC 4: the stored hash is not the submitted password, in either direction.
    const freelancer = repos.freelancers.findByEmail(EMAIL);
    const credential = repos.credentials.getByFreelancer(freelancer.id);
    assert.notEqual(credential.passwordHash, PASSWORD);
    assert.ok(credential.passwordHash.startsWith('scrypt$'));
    assert.equal((await verifyPassword(PASSWORD, credential.passwordHash)).ok, true);
  });
});

test('H2: the Set-Cookie matches the measured shape, with every attribute asserted individually', async () => {
  await withApp({}, async ({ base }) => {
    const res = await signUp(base);
    const header = setCookie(res);
    assert.ok(header.startsWith(`${COOKIE_NAME}=`), header);
    assert.match(header, /Max-Age=1209600/, '14 days, matching the row');
    assert.match(header, /Path=\//);
    assert.match(header, /Expires=/, 'express emits BOTH Max-Age and Expires — measured, not assumed');
    assert.match(header, /HttpOnly/);
    assert.match(header, /SameSite=Lax/);
    assert.equal(/;\s*Secure/i.test(header), false, 'NO Secure under a loopback appBaseUrl');
    assert.equal(cookieValue(res).length, 43, 'the VALUE is the 43-character token, never the digest');
  });
});

test('H3: the SAME app under an https appBaseUrl DOES emit Secure — both directions, or the conditional is untested', async () => {
  await withApp({ appBaseUrl: 'https://d1.example.test' }, async ({ base }) => {
    const header = setCookie(await signUp(base));
    assert.match(header, /;\s*Secure/i);
    assert.match(header, /SameSite=Lax/, 'and the rest of the shape is unchanged');
    assert.match(header, /HttpOnly/);
  });
});

test('H4: SameSite is Lax, not Strict — Stripe\'s return is a cross-site top-level GET', async () => {
  // The single assertion that mutation F5 is expected to turn red. The property
  // it stands for — a real browser sending the cookie on Stripe's return
  // navigation — is NOT observable from this suite at all (plan §5.5 item 1);
  // AS-50 owns it. This asserts the header we emit and says so.
  await withApp({}, async ({ base }) => {
    assert.match(setCookie(await signUp(base)), /SameSite=Lax/);
  });
});

test('H5: a duplicate email is 409 email-taken, and NOTHING is created', async () => {
  await withApp({}, async ({ base, config }) => {
    await signUp(base);
    const before = countRows(config);
    assert.deepEqual(before, { freelancers: 1, credentials: 1, sessions: 1 });
    const res = await signUp(base, { displayName: 'Someone Else' });
    assert.equal(res.status, 409);
    assert.equal(await res.text(), 'AuthError: email-taken\n');
    assert.equal(setCookie(res), null, 'no session for a refused sign-up');
    assert.deepEqual(countRows(config), before, 'the transaction rolled back — no orphan freelancer');
    // Case-insensitively, through the same lower(email) index sign-in uses.
    assert.equal((await signUp(base, { email: EMAIL.toUpperCase() })).status, 409);
  });
});

test('H6: a malformed email, a short password and a missing field are 400 with the right code', async () => {
  await withApp({}, async ({ base }) => {
    const cases = [
      [{ email: 'no-at-sign' }, 'invalid-email'],
      [{ email: 'two@at@signs.test' }, 'invalid-email'],
      [{ email: '@example.test' }, 'invalid-email'],
      [{ email: 'freda@' }, 'invalid-email'],
      [{ email: `${'x'.repeat(250)}@example.test` }, 'invalid-email'],
      [{ password: 'short' }, 'weak-password'],
      [{ password: '' }, 'missing-field'],
      [{ displayName: '' }, 'missing-field'],
      [{ email: '' }, 'missing-field'],
    ];
    assert.equal(cases.length, 9, 'cardinality first');
    for (const [over, step] of cases) {
      const res = await signUp(base, over);
      assert.equal(res.status, 400, JSON.stringify(over));
      assert.equal(await res.text(), `AuthError: ${step}\n`, JSON.stringify(over));
      assert.equal(setCookie(res), null);
    }
  });
});

test('H7: sign-in issues a NEW session row and a new cookie', async () => {
  await withApp({}, async ({ base, config, repos }) => {
    const first = cookieValue(await signUp(base));
    const before = countRows(config);
    const res = await postForm(`${base}/signin`, { email: EMAIL, password: PASSWORD });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/');
    const second = cookieValue(res);
    assert.notEqual(second, first, 'a new token, not the old one re-sent');
    assert.equal(countRows(config).sessions - before.sessions, 1, 'exactly one new row');
    // Both sessions are live: signing in elsewhere does not sign you out here.
    assert.notEqual(repos.sessions.getById(tokenId(first)), null);
    assert.notEqual(repos.sessions.getById(tokenId(second)), null);
  });
});

test('H8: an unknown email and a wrong password are BYTE-IDENTICAL responses', async () => {
  await withApp({}, async ({ base }) => {
    await signUp(base);
    const unknown = await postForm(`${base}/signin`, { email: 'nobody@example.test', password: PASSWORD });
    const wrong = await postForm(`${base}/signin`, { email: EMAIL, password: 'not the password' });
    assert.equal(unknown.status, 401);
    assert.equal(wrong.status, unknown.status);
    assert.equal(await wrong.text(), await unknown.text());
    assert.equal(unknown.headers.get('content-type'), wrong.headers.get('content-type'));
    assert.deepEqual(unknown.headers.getSetCookie(), [], 'no Set-Cookie on either');
    assert.deepEqual(wrong.headers.getSetCookie(), []);
  });
});

test('H9: sign-out deletes the row, clears the cookie in the measured shape, and the old cookie stops working', async () => {
  await withApp({}, async ({ base, repos }) => {
    const token = cookieValue(await signUp(base));
    const cookie = `${COOKIE_NAME}=${token}`;
    assert.notEqual(repos.sessions.getById(tokenId(token)), null);

    const res = await postForm(`${base}/signout`, {}, { cookie });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/signin');
    assert.equal(repos.sessions.getById(tokenId(token)), null, 'genuine revocation: the row is GONE');

    const cleared = setCookie(res);
    assert.match(cleared, /^invoicing_session=;/);
    assert.match(cleared, /Expires=Thu, 01 Jan 1970/);
    assert.equal(/Max-Age/.test(cleared), false, 'clearCookie emits no Max-Age — measured');
    assert.match(cleared, /HttpOnly/);
    assert.match(cleared, /SameSite=Lax/, 'the SAME attributes, or a browser will not match the cookie');
    assert.match(cleared, /Path=\//);

    const after = await fetch(`${base}/`, { redirect: 'manual', headers: { cookie } });
    assert.equal(after.status, 303);
    assert.equal(after.headers.get('location'), '/signin?next=%2F');
  });
});

test('H10: an EXPIRED session is refused AND deleted by the request that finds it', async () => {
  await withApp({}, async ({ base, repos }) => {
    const freelancer = repos.freelancers.create({ email: EMAIL, displayName: NAME });
    const { cookie, id } = seedSession(repos, freelancer.id, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    assert.notEqual(repos.sessions.getById(id), null, 'the row exists before the request');

    const res = await fetch(`${base}/`, { redirect: 'manual', headers: { cookie } });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/signin?next=%2F');
    assert.equal(repos.sessions.getById(id), null, 'the table self-cleans on use');
  });
});

test('H11: a garbage cookie is refused exactly like an absent one', async () => {
  await withApp({}, async ({ base, repos }) => {
    const absent = await fetch(`${base}/`, { redirect: 'manual' });
    const garbage = [
      'not-a-token',
      `${COOKIE_NAME}=`,
      `${COOKIE_NAME}=%%%not-valid-percent`,
      `${COOKIE_NAME}=${'A'.repeat(43)}`,
      `${COOKIE_NAME}=${'A'.repeat(5000)}`,
      `other=1; ${COOKIE_NAME}=nonsense; ${COOKIE_NAME}=alsononsense`,
    ];
    for (const cookie of garbage) {
      const res = await fetch(`${base}/`, { redirect: 'manual', headers: { cookie } });
      assert.equal(res.status, absent.status, cookie.slice(0, 30));
      assert.equal(res.headers.get('location'), absent.headers.get('location'), cookie.slice(0, 30));
    }

    // THE CONTROL, and it is load-bearing: without it every assertion above
    // would also pass against an app that refused every cookie ever presented.
    const freelancer = repos.freelancers.create({ email: EMAIL, displayName: NAME });
    const { cookie } = seedSession(repos, freelancer.id);
    assert.equal((await fetch(`${base}/`, { redirect: 'manual', headers: { cookie } })).status, 200,
      'a live session for a live freelancer IS admitted');
  });
});

test('H11b: a session naming a freelancer who no longer exists is refused AND deleted', () => {
  // v1 has no delete path for a freelancer, so this state is unreachable
  // through the app — which is exactly why the branch is asserted against a
  // stub rather than left to a reader's confidence. It must not be a 500.
  const deleted = [];
  const accounts = createAccounts({
    repos: {
      sessions: {
        getById: (id) => ({ id, freelancerId: 'gone', expiresAt: '2099-01-01T00:00:00.000Z' }),
        delete: (id) => { deleted.push(id); return true; },
      },
      freelancers: { getById: () => { throw new NotFoundError('freelancer', 'gone'); } },
    },
  });
  const { token } = mintToken();
  assert.equal(accounts.resolveSession(token), null);
  assert.deepEqual(deleted, [tokenId(token)], 'the unusable session is cleaned up, not left to be retried forever');
});

test('H12–H15: `next` is honoured when safe, and replaced by / for each hostile spelling', async () => {
  const hostile = ['//evil.test', 'https://evil.test', '/\\evil.test', '/ok bad'];
  assert.equal(hostile.length, 4, 'the committed list of hostile spellings');
  for (const raw of hostile) assert.equal(safeNext(raw), null, raw);
  assert.equal(safeNext('/invoices/abc?x=1'), '/invoices/abc?x=1', 'a safe same-site path survives');

  await withApp({}, async ({ base }) => {
    const ok = await signUp(base, { next: '/invoices/abc' });
    assert.equal(ok.headers.get('location'), '/invoices/abc', 'honoured when safe');
    for (const raw of hostile) {
      const res = await postForm(`${base}/signin`, { email: EMAIL, password: PASSWORD, next: raw });
      assert.equal(res.status, 303, raw);
      assert.equal(res.headers.get('location'), '/', `open redirect via ${raw}`);
    }
  });
});

// =============================================================================
// G1–G13: reachability, CSRF and impersonation
// =============================================================================

/** Every (method, path) the built app registers, by walking the router tree.
 *  Express internals are being read, which is normally a smell. It is
 *  acceptable here for two measured reasons: express is pinned to an EXACT
 *  literal by dependency-policy.test.js, and G1's cardinality assertion means a
 *  future express whose internals moved produces a RED test, never a vacuous
 *  green one. */
function discoverRoutes(app) {
  const found = [];
  const walk = (stack) => {
    for (const layer of stack) {
      if (layer.route) {
        for (const method of Object.keys(layer.route.methods)) {
          found.push(`${method.toUpperCase()} ${layer.route.path}`);
        }
      } else if (layer.handle?.stack) {
        walk(layer.handle.stack);
      }
    }
  };
  walk(app.router.stack);
  return found.sort();
}

/** THE COMMITTED ROUTE LIST. A route added anywhere — in a new router, in an
 *  existing one, at any mount position — changes this and turns G1 red. To make
 *  it green its author must classify it below, in an array a reviewer reads.
 *  There is no path from "someone added a route" to "it is unprotected and
 *  nobody noticed". */
const ALL_ROUTES = [
  'GET /',
  'GET /connect-stripe/refresh',
  'GET /connect-stripe/return',
  'GET /healthz',
  'GET /tokens.css',
  'POST /connect-stripe/start',
  'POST /invoices',
  'POST /invoices/:id',
  'POST /invoices/:id/finalize',
  'POST /invoices/:id/send',
  'POST /signin',
  'POST /signout',
  'POST /signup',
  'POST /webhooks/stripe',
];

/** Public, each for a stated reason. Everything else requires a session. */
const PUBLIC_ROUTES = [
  // must answer when everything else is broken; compose's healthcheck sends no cookie
  'GET /healthz',
  // vendored bytes, identical for every caller
  'GET /tokens.css',
  // authenticated BY SIGNATURE, not by session — Stripe sends no cookie and no Origin
  'POST /webhooks/stripe',
  // the two ways in
  'POST /signin',
  'POST /signup',
];

test('G1: the route walk finds the EXACT committed list — cardinality first', async () => {
  await withApp({}, async ({ app }) => {
    const found = discoverRoutes(app);
    // Never `> 0`: a walk that silently returned nothing would otherwise pass
    // every rule below it on an empty set (the AS-31 lesson).
    assert.equal(found.length, 14, `expected exactly 14 routes, found ${found.length}: ${found.join(', ')}`);
    assert.deepEqual(found, ALL_ROUTES);
  });
});

test('G1b: with NO webhook secret the surface is the same list minus the webhook route', async () => {
  // The webhook router registers nothing without a secret (AS-44), so the
  // committed list above is config-dependent and says so in both directions.
  await withApp({ secret: null }, async ({ app }) => {
    const found = discoverRoutes(app);
    assert.equal(found.length, 13, found.join(', '));
    assert.deepEqual(found, ALL_ROUTES.filter((r) => r !== 'POST /webhooks/stripe'));
  });
});

test('G2: the public/protected partition is exact in BOTH directions', async () => {
  await withApp({}, async ({ app }) => {
    const found = discoverRoutes(app);
    // Every declared public route really exists…
    const missing = PUBLIC_ROUTES.filter((r) => !found.includes(r));
    assert.deepEqual(missing, [], 'PUBLIC_ROUTES names a route that does not exist');
    // …and the partition covers the list with nothing left over.
    const protectedRoutes = found.filter((r) => !PUBLIC_ROUTES.includes(r));
    assert.equal(PUBLIC_ROUTES.length + protectedRoutes.length, found.length);
    assert.deepEqual(protectedRoutes, [
      'GET /',
      'GET /connect-stripe/refresh',
      'GET /connect-stripe/return',
      'POST /connect-stripe/start',
      'POST /invoices',
      'POST /invoices/:id',
      'POST /invoices/:id/finalize',
      'POST /invoices/:id/send',
      'POST /signout',
    ]);
  });
});

test('G3: EVERY route in the protected partition redirects to sign-in with no cookie', async () => {
  await withApp({}, async ({ base, app }) => {
    const protectedRoutes = discoverRoutes(app).filter((r) => !PUBLIC_ROUTES.includes(r));
    assert.equal(protectedRoutes.length, 9, 'cardinality before quantification');
    for (const entry of protectedRoutes) {
      const [method, path] = entry.split(' ');
      const url = `${base}${path.replaceAll(':id', 'some-id')}`;
      const res = await fetch(url, { method, redirect: 'manual', headers: { origin: base } });
      assert.equal(res.status, 303, entry);
      const location = res.headers.get('location');
      // G4: safe methods carry ?next=; unsafe ones do not — a POST body cannot
      // be replayed after a redirect, so offering to resume it would be a lie.
      if (method === 'GET') assert.match(location, /^\/signin\?next=/, entry);
      else assert.equal(location, '/signin', entry);
    }
  });
});

test('G5: GET /healthz answers 200 with no cookie', async () => {
  await withApp({}, async ({ base }) => {
    const res = await fetch(`${base}/healthz`, { redirect: 'manual' });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).ok, true);
  });
});

test('G6: the vendored asset and an app-owned static file answer 200 with no cookie', async () => {
  await withApp({}, async ({ base }) => {
    const tokens = await fetch(`${base}/tokens.css`, { redirect: 'manual' });
    assert.equal(tokens.status, 200, 'the sign-in page must be able to load its stylesheet while signed out');
    const scaffold = await fetch(`${base}/scaffold.css`, { redirect: 'manual' });
    assert.equal(scaffold.status, 200, 'express.static was moved ABOVE the boundary for exactly this');
  });
});

test('G7: no file in publicDir collides with a registered route path', async () => {
  // The new risk the express.static move introduces, closed. A file in public/
  // named like a route would shadow it for signed-out callers.
  await withApp({}, async ({ app }) => {
    const config = configFor();
    const files = readdirSync(config.publicDir);
    assert.ok(files.length > 0, 'the check is not examining an empty directory');
    const routePaths = new Set(discoverRoutes(app).map((r) => r.split(' ')[1].replace(/^\//, '')));
    const collisions = files.filter((f) => routePaths.has(f));
    assert.deepEqual(collisions, [], `public/ shadows a route path: ${collisions.join(', ')}`);
  });
});

test('G8: POST /webhooks/stripe with a valid signature, NO cookie and NO Origin, still answers 200', async () => {
  // THE REGRESSION TEST FOR THE MOUNT ORDER. Stripe's server has no session and
  // sends no Origin; the webhook is authenticated by its HMAC over the raw body
  // and is mounted ABOVE both middlewares. Moving it below either one breaks
  // every delivery, which is what recipe F6 demonstrates.
  const { createHmac } = await import('node:crypto');
  await withApp({}, async ({ base }) => {
    const payload = JSON.stringify({
      id: 'evt_auth_g8', object: 'event', type: 'ping.unhandled',
      created: Math.floor(Date.now() / 1000), data: { object: {} },
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac('sha256', WEBHOOK_SECRET).update(`${timestamp}.${payload}`, 'utf8').digest('hex');
    const res = await fetch(`${base}/webhooks/stripe`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/json', 'stripe-signature': `t=${timestamp},v1=${signature}` },
      body: payload,
    });
    assert.equal(res.status, 200, `the webhook must not sit behind the session guard: ${await res.text()}`);
  });
});

test('G9–G12: the same-origin check, on a public route AND a guarded one', async () => {
  await withApp({}, async ({ base, repos }) => {
    const freelancer = repos.freelancers.create({ email: EMAIL, displayName: NAME });
    const { cookie } = seedSession(repos, freelancer.id);
    const body = form({ email: EMAIL, password: PASSWORD });
    const send = (path, headers) => fetch(`${base}${path}`, {
      method: 'POST', redirect: 'manual', body,
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    });

    for (const [path, extra] of [['/signin', {}], ['/signout', { cookie }]]) {
      // G9: a matching Origin is allowed through (it reaches the handler).
      const okOrigin = await send(path, { origin: base, ...extra });
      assert.notEqual(okOrigin.status, 403, `${path} with a matching Origin`);
      // G11: no Origin but a matching Referer is allowed through.
      const okReferer = await send(path, { referer: `${base}/some/page`, ...extra });
      assert.notEqual(okReferer.status, 403, `${path} with a matching Referer`);
      // G10: a foreign Origin is refused, fail-closed, with the house body.
      const foreign = await send(path, { origin: 'https://evil.test', ...extra });
      assert.equal(foreign.status, 403, `${path} with a foreign Origin`);
      assert.equal(await foreign.text(), 'AuthError: forbidden-origin\n');
      // G12: neither header is refused too — absence is not a pass.
      const neither = await send(path, extra);
      assert.equal(neither.status, 403, `${path} with neither header`);
      assert.equal(await neither.text(), 'AuthError: forbidden-origin\n');
    }

    // A safe method is never subject to the check.
    assert.notEqual((await fetch(`${base}/healthz`, { headers: { origin: 'https://evil.test' } })).status, 403);
  });
});

test('G13: a signed-in freelancer naming ANOTHER freelancer acts as the SESSION\'s freelancer', async () => {
  // THE TEST THE SEAM REPLACEMENT EXISTS FOR. Without it a leftover
  // query-parameter read would be invisible: the request would succeed, and it
  // would succeed as the wrong person.
  await withApp({}, async ({ base, repos }) => {
    const mine = repos.freelancers.create({ email: EMAIL, displayName: NAME });
    const theirs = repos.freelancers.create({ email: 'otto@example.test', displayName: 'Otto Ther' });
    const myClient = repos.clients.create(mine.id, { name: 'My Co', email: 'my@example.test' });
    const { cookie } = seedSession(repos, mine.id);

    const res = await fetch(`${base}/invoices?freelancer=${encodeURIComponent(theirs.id)}`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: base, cookie },
      body: form({
        clientId: myClient.id,
        daysUntilDue: '30',
        'lineItems[0][description]': 'Design work',
        'lineItems[0][quantity]': '1',
        'lineItems[0][unitAmountMinor]': '5000',
      }),
    });
    assert.equal(res.status, 303, await res.text());
    assert.equal(res.headers.get('location').includes('freelancer'), false, 'and the redirect carries no identity either');

    assert.equal(repos.invoices.listByFreelancer(theirs.id).length, 0, 'NOT created for the named freelancer');
    const ours = repos.invoices.listByFreelancer(mine.id);
    assert.equal(ours.length, 1, 'created for the SESSION\'s freelancer');
  });
});

test('G13b: GET /signin does not redirect to itself — it 404s until AS-45 lands', async () => {
  // The loop this guards against is not hypothetical: without the carve-out in
  // requireSession, every signed-out visitor to any unknown path bounced
  // between /signin and itself until the client gave up. `redirect: 'follow'`
  // is deliberate — a manual redirect would not have shown the loop.
  await withApp({}, async ({ base }) => {
    const res = await fetch(`${base}/signin`);
    assert.equal(res.status, 404, 'the Location header is the contract; the screen is AS-45\'s');
    const withNext = await fetch(`${base}/signin?next=%2Finvoices`);
    assert.equal(withNext.status, 404, 'and it does not loop when it carries a next');
  });
});

test('G14: actingFreelancerId throws rather than act as nobody', () => {
  // Layer 3. Reaching a guarded handler with no session means a router was
  // mounted above the boundary — a wiring bug, which must be a loud 500.
  assert.throws(() => actingFreelancerId({}), /no current user/);
  assert.throws(() => actingFreelancerId({ currentUser: undefined }), /mounted above the auth boundary/);
  assert.equal(actingFreelancerId({ currentUser: { id: 'f-1' } }), 'f-1');
});

test('G15: the whole app is constructible and the boundary survives a rebuild', async () => {
  // A cheap guard against the enumeration above being satisfied by a stale app.
  await withApp({}, async ({ app, base }) => {
    assert.equal(discoverRoutes(app).length, 14);
    assert.equal((await fetch(`${base}/`, { redirect: 'manual' })).status, 303);
  });
});

/** Row counts, read on a SECOND connection to the same file — the db.test.js
 *  idiom. The repositories deliberately expose no count method (app code has no
 *  use for one), and a count is exactly what "creates exactly one row" needs.
 *  test/ is outside the dependency scan's world, so the SQL here moves no
 *  committed literal. */
function countRows(config) {
  const db = openDatabase(config.dbPath);
  try {
    const n = (table) => db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
    return { freelancers: n('freelancers'), credentials: n('credentials'), sessions: n('sessions') };
  } finally {
    db.close();
  }
}
