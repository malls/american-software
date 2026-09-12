// config.test.js — settings resolution (AS-37, plan §7, §9.2).
//
// The property that matters most here: the app resolves a complete, valid
// configuration from a COMPLETELY EMPTY environment. No .env, no exported
// variable, no secret, no account. That is what keeps AS-51 (the Stripe account
// board ask) off the critical path of fifteen downstream tasks, and it is
// asserted below against an empty object literal rather than process.env.
//
// The secret/required machinery is exercised against a FIXTURE schema: it was
// built at AS-37 before the first real secret existed (plan §7.3), and the
// fixture keeps those tests independent of which real secrets exist. AS-38 added
// the first live secret row — the Stripe key, as a NAME only — and the two tests
// at the end of this file pin how the live schema treats it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError, SCHEMA, loadConfig, startupLogLine, validateResolved } from '../lib/config.js';

// --- V2: cardinality before quantification ----------------------------------

test('the schema is exactly the eleven settings AS-37, AS-38, AS-39, AS-41 and AS-44 define', () => {
  assert.equal(SCHEMA.length, 11);
  assert.deepEqual(
    SCHEMA.map((row) => row.key),
    ['port', 'bind', 'env', 'logLevel', 'vendorDir', 'viewsDir', 'publicDir', 'dbPath', 'appBaseUrl', 'stripeSecretKey', 'webhookSecret'],
  );
  // Every env var is INVOICING_-prefixed except NODE_ENV, which is a platform
  // convention. The prefix keeps the monorepo's namespaces disjoint from
  // apps/chat's CHAT_.
  const prefixed = SCHEMA.filter((row) => row.envVar.startsWith('INVOICING_'));
  assert.equal(prefixed.length, 10);
  assert.deepEqual(SCHEMA.filter((row) => !row.envVar.startsWith('INVOICING_')).map((r) => r.envVar), ['NODE_ENV']);
});

test('no setting is required, and the only secrets are the two Stripe secret names (AS-38, AS-44)', () => {
  // The app boots from an empty environment: nothing is required. Exactly two
  // rows are secrets — the API key and the webhook signing secret, both
  // optional and both defaulting to null. AS-40 predicted a SESSION_SECRET
  // here and does not add one: it signs nothing, so it needs no secret.
  // Nothing else belongs on this list.
  assert.deepEqual(SCHEMA.filter((row) => row.required).map((r) => r.envVar), []);
  assert.deepEqual(
    SCHEMA.filter((row) => row.secret).map((r) => r.envVar),
    ['INVOICING_STRIPE_SECRET_KEY', 'INVOICING_STRIPE_WEBHOOK_SECRET'],
  );
  const stripe = SCHEMA.find((row) => row.envVar === 'INVOICING_STRIPE_SECRET_KEY');
  assert.deepEqual(stripe, { key: 'stripeSecretKey', envVar: 'INVOICING_STRIPE_SECRET_KEY', type: 'string', default: null, required: false, secret: true });
  // The AS-44 row, exactly. `type: 'string'` and NO format validation on the
  // value: a prefix check would hard-code a Stripe convention Stripe can
  // change, and would buy nothing — a wrong secret already fails every delivery
  // immediately, at the only place that matters.
  const webhook = SCHEMA.find((row) => row.envVar === 'INVOICING_STRIPE_WEBHOOK_SECRET');
  assert.deepEqual(webhook, { key: 'webhookSecret', envVar: 'INVOICING_STRIPE_WEBHOOK_SECRET', type: 'string', default: null, required: false, secret: true });
});

// --- the empty-environment property -----------------------------------------

test('defaults resolve from a COMPLETELY EMPTY environment', () => {
  const config = loadConfig({});
  assert.deepEqual({ ...config }, {
    port: 8348,
    bind: '127.0.0.1',
    env: 'development',
    logLevel: 'info',
    vendorDir: '/app/vendor',
    viewsDir: '/app/views',
    publicDir: '/app/public',
    dbPath: '/app/data/invoicing.sqlite',
    appBaseUrl: 'http://127.0.0.1:8348',
    stripeSecretKey: null,
    webhookSecret: null,
  });
  // Enumerable keys are exactly the schema keys — redacted() is non-enumerable
  // so it cannot leak into a JSON body as a stray property.
  assert.deepEqual(Object.keys(config).sort(), SCHEMA.map((r) => r.key).sort());
  assert.equal(validateResolved(config).length, 0);
});

test('the resolved config is frozen', () => {
  const config = loadConfig({});
  assert.ok(Object.isFrozen(config));
  assert.throws(() => {
    'use strict';
    config.port = 1;
  }, TypeError);
});

test('the app default bind is loopback, so a misconfigured run fails closed', () => {
  // compose overrides this to 0.0.0.0 INSIDE the container; loopback is enforced
  // on the HOST side of the port map instead.
  assert.equal(loadConfig({}).bind, '127.0.0.1');
});

// --- overrides ---------------------------------------------------------------

test('INVOICING_* overrides win over defaults', () => {
  const config = loadConfig({
    INVOICING_PORT: '9999',
    INVOICING_BIND: '0.0.0.0',
    NODE_ENV: 'production',
    INVOICING_LOG_LEVEL: 'warn',
    INVOICING_VENDOR_DIR: '/elsewhere/vendor',
    INVOICING_VIEWS_DIR: '/elsewhere/views',
    INVOICING_PUBLIC_DIR: '/elsewhere/public',
    INVOICING_DB_PATH: '/elsewhere/data/invoicing.sqlite',
    INVOICING_APP_BASE_URL: 'https://d1.example.test',
    // Deliberately NOT whsec_-shaped (plan §4): the schema applies no format
    // check to this row, and a placeholder that looked like a real signing
    // secret would make that absence invisible.
    INVOICING_STRIPE_WEBHOOK_SECRET: 'unit-test-placeholder-webhook-secret',
  });
  assert.deepEqual({ ...config }, {
    port: 9999,
    bind: '0.0.0.0',
    env: 'production',
    logLevel: 'warn',
    vendorDir: '/elsewhere/vendor',
    viewsDir: '/elsewhere/views',
    publicDir: '/elsewhere/public',
    dbPath: '/elsewhere/data/invoicing.sqlite',
    appBaseUrl: 'https://d1.example.test',
    stripeSecretKey: null,
    webhookSecret: 'unit-test-placeholder-webhook-secret',
  });
});

test('an empty or whitespace-only value is treated as absent', () => {
  assert.equal(loadConfig({ INVOICING_PORT: '' }).port, 8348);
  assert.equal(loadConfig({ INVOICING_PORT: '   ' }).port, 8348);
});

test('loadConfig does not read process.env when handed an env object', () => {
  // The property that lets tests inject settings without mutating the
  // environment (plan §3.3b). process.env in the test service carries
  // NODE_ENV=production from the Dockerfile; an empty object must not see it.
  assert.equal(process.env.NODE_ENV, 'production', 'the image bakes NODE_ENV=production');
  assert.equal(loadConfig({}).env, 'development');
});

// --- validation fails loudly, naming the env var -----------------------------

test('a bad port throws, naming INVOICING_PORT', () => {
  assert.throws(() => loadConfig({ INVOICING_PORT: 'eight-three-four-eight' }), (err) => {
    assert.ok(err instanceof ConfigError);
    assert.equal(err.envVar, 'INVOICING_PORT');
    assert.match(err.message, /INVOICING_PORT/);
    return true;
  });
});

test('an out-of-range port throws, naming INVOICING_PORT', () => {
  assert.throws(() => loadConfig({ INVOICING_PORT: '70000' }), /INVOICING_PORT/);
  assert.throws(() => loadConfig({ INVOICING_PORT: '0' }), /INVOICING_PORT/);
});

test('an out-of-range enum throws, naming its env var', () => {
  assert.throws(() => loadConfig({ INVOICING_LOG_LEVEL: 'chatty' }), /INVOICING_LOG_LEVEL/);
  assert.throws(() => loadConfig({ NODE_ENV: 'staging' }), /NODE_ENV/);
});

test('a relative path throws, naming its env var', () => {
  assert.throws(() => loadConfig({ INVOICING_VENDOR_DIR: 'vendor' }), /INVOICING_VENDOR_DIR/);
});

test('a malformed app base URL throws, naming INVOICING_APP_BASE_URL (AS-41)', () => {
  // The base minted Stripe onboarding links redirect back to. One accepted
  // spelling: a bare http(s) origin. A path, query, fragment, credential or
  // trailing slash is rejected at load — never trimmed into compliance.
  for (const value of [
    'not a url',
    'd1.example.test',
    'ftp://d1.example.test',
    'http://d1.example.test/app',
    'http://d1.example.test/?x=1',
    'http://d1.example.test/#frag',
    'http://user:pw@d1.example.test',
    'http://user@d1.example.test',
    'http://d1.example.test/',
    'https://d1.example.test/app/',
  ]) {
    assert.throws(() => loadConfig({ INVOICING_APP_BASE_URL: value }), (err) => {
      assert.ok(err instanceof ConfigError);
      assert.equal(err.envVar, 'INVOICING_APP_BASE_URL');
      assert.match(err.message, /INVOICING_APP_BASE_URL/);
      return true;
    }, `INVOICING_APP_BASE_URL=${value} was accepted`);
  }
  // Accepted: bare origins, either scheme, with or without an explicit port,
  // stored exactly as given.
  assert.equal(loadConfig({ INVOICING_APP_BASE_URL: 'https://d1.example.test' }).appBaseUrl, 'https://d1.example.test');
  assert.equal(loadConfig({ INVOICING_APP_BASE_URL: 'http://127.0.0.1:9999' }).appBaseUrl, 'http://127.0.0.1:9999');
});

test('validateResolved flags a malformed appBaseUrl (AS-41)', () => {
  // `null` is NOT in this list: validateResolved treats null as the legitimate
  // "unconfigured optional" state for every non-required row, url included.
  for (const bad of ['http://d1.example.test/app', 'http://d1.example.test/', 'not a url', 'ftp://d1.example.test', 42]) {
    const config = { ...loadConfig({}), appBaseUrl: bad };
    assert.match(validateResolved(config).join(' '), /appBaseUrl/, `appBaseUrl=${JSON.stringify(bad)} passed validateResolved`);
  }
  assert.deepEqual(validateResolved({ ...loadConfig({}), appBaseUrl: 'https://d1.example.test' }), []);
});

test('the database path must be absolute: a relative path and :memory: both throw, naming INVOICING_DB_PATH (AS-39)', () => {
  // A production process cannot be pointed at an in-memory database — or at a
  // file relative to whatever cwd it happens to have — by a typo. Both fail at
  // config load, before anything is opened.
  for (const value of ['data/x.sqlite', ':memory:']) {
    assert.throws(() => loadConfig({ INVOICING_DB_PATH: value }), (err) => {
      assert.ok(err instanceof ConfigError);
      assert.equal(err.envVar, 'INVOICING_DB_PATH');
      assert.match(err.message, /INVOICING_DB_PATH/);
      return true;
    }, `INVOICING_DB_PATH=${value} was accepted`);
  }
});

// --- the secret mechanism, pinned before the first secret exists -------------

// A fixture schema, NOT the live one. No real credential is named anywhere in
// this app (plan §7.3 item 2) — including in tests, where a placeholder shaped
// like a real key is how a fake key ends up in a real call.
const FIXTURE_SCHEMA = Object.freeze([
  { key: 'plain', envVar: 'FIXTURE_PLAIN', type: 'string', default: 'visible' },
  { key: 'token', envVar: 'FIXTURE_TOKEN', type: 'string', secret: true },
  { key: 'mandatory', envVar: 'FIXTURE_MANDATORY', type: 'string', required: true },
].map(Object.freeze));

const OPTIONAL_FIXTURE = FIXTURE_SCHEMA.filter((row) => !row.required);
const FIXTURE_SECRET_VALUE = 'fixture-secret-value-must-not-appear-anywhere';

test('an absent optional secret resolves to null — not empty string, not undefined', () => {
  const config = loadConfig({}, OPTIONAL_FIXTURE);
  assert.equal(config.token, null);
  assert.notEqual(config.token, '');
  assert.notEqual(config.token, undefined);
  // null is a first-class "unconfigured" state: `if (config.token)` is false,
  // and a caller that passes it on cannot mistake it for a real value.
  assert.equal(typeof config.token, 'object');
});

test('a required setting that is absent throws, naming its env var', () => {
  assert.throws(() => loadConfig({ FIXTURE_TOKEN: 'x' }, FIXTURE_SCHEMA), /FIXTURE_MANDATORY/);
});

test('redacted() masks secrets and leaves everything else intact', () => {
  const config = loadConfig({ FIXTURE_TOKEN: FIXTURE_SECRET_VALUE }, OPTIONAL_FIXTURE);
  assert.equal(config.token, FIXTURE_SECRET_VALUE, 'the app itself still sees the real value');
  const redacted = config.redacted();
  assert.deepEqual(redacted, { plain: 'visible', token: '[redacted]' });
});

test('a secret value appears in NEITHER the redacted object NOR the startup log line', () => {
  // Redaction has to exist before the first secret does; it is unaddable in
  // retrospect, because by then it has already been logged (plan §7.3 item 4).
  const config = loadConfig({ FIXTURE_TOKEN: FIXTURE_SECRET_VALUE, FIXTURE_PLAIN: 'visible' }, OPTIONAL_FIXTURE);
  const serialisedRedacted = JSON.stringify(config.redacted());
  const logLine = startupLogLine(config);

  assert.ok(!serialisedRedacted.includes(FIXTURE_SECRET_VALUE), `redacted object leaked the secret: ${serialisedRedacted}`);
  assert.ok(!logLine.includes(FIXTURE_SECRET_VALUE), `startup log line leaked the secret: ${logLine}`);
  // ...and the guard is not vacuous: the raw config really does contain it, so
  // the two assertions above had something to catch.
  assert.ok(JSON.stringify({ ...config }).includes(FIXTURE_SECRET_VALUE));
  assert.match(logLine, /\[redacted\]/);
});

test('the startup log line names the bind and port', () => {
  assert.match(startupLogLine(loadConfig({})), /127\.0\.0\.1:8348/);
});

// --- the live secret row (AS-38) ----------------------------------------------

test('an unconfigured Stripe key is null in the config AND in redacted(), so the startup line says which it is', () => {
  // `null` and `[redacted]` are different facts — "no key" versus "a key you may
  // not see" — and an operator reading the startup line or /healthz needs to tell
  // them apart without a debugger. Nothing about the value is ever said.
  const config = loadConfig({});
  assert.equal(config.stripeSecretKey, null);
  assert.equal(config.redacted().stripeSecretKey, null);
  assert.match(startupLogLine(config), /"stripeSecretKey":null/);
  // An empty or whitespace value is "unconfigured" too — never an empty key that
  // reaches a real call as `Bearer `.
  assert.equal(loadConfig({ INVOICING_STRIPE_SECRET_KEY: '' }).stripeSecretKey, null);
  assert.equal(loadConfig({ INVOICING_STRIPE_SECRET_KEY: '   ' }).stripeSecretKey, null);
});

test('a configured Stripe key is [redacted] in redacted() and the startup line, and never appears in either', () => {
  // Deliberately NOT key-shaped (plan §2.8): a value that looks like a real key
  // is how a fake key ends up in a real call, and AC 34 greps for the shape.
  const value = 'configured-stripe-key-placeholder-value';
  const config = loadConfig({ INVOICING_STRIPE_SECRET_KEY: `  ${value}  ` });
  assert.equal(config.stripeSecretKey, value, 'the app itself sees the trimmed real value');
  assert.equal(config.redacted().stripeSecretKey, '[redacted]');
  const logLine = startupLogLine(config);
  assert.match(logLine, /"stripeSecretKey":"\[redacted\]"/);
  assert.ok(!logLine.includes(value), `startup log line leaked the key: ${logLine}`);
  assert.ok(!JSON.stringify(config.redacted()).includes(value));
  // ...and the guard is not vacuous: the raw config really does contain it.
  assert.ok(JSON.stringify({ ...config }).includes(value));
  assert.deepEqual(validateResolved(config), []);
});

test('the webhook signing secret is [redacted] when set and null when not — the operator\'s only signal (AS-44)', () => {
  // routes/webhooks.js registers NO ROUTE when this is unset, so an
  // unconfigured deployment answers 404 and tells an unauthenticated caller
  // nothing. That is deliberate, and it is why the operator's signal has to
  // live on the authenticated side: the startup line and /healthz, through
  // redacted() and nothing else. No new health check, no new log line.
  const unset = loadConfig({});
  assert.equal(unset.webhookSecret, null);
  assert.equal(unset.redacted().webhookSecret, null);
  assert.match(startupLogLine(unset), /"webhookSecret":null/);

  const value = 'configured-webhook-secret-placeholder-value';
  const set = loadConfig({ INVOICING_STRIPE_WEBHOOK_SECRET: `  ${value}  ` });
  assert.equal(set.webhookSecret, value, 'the app itself sees the trimmed real value');
  assert.equal(set.redacted().webhookSecret, '[redacted]');
  const logLine = startupLogLine(set);
  assert.match(logLine, /"webhookSecret":"\[redacted\]"/);
  assert.ok(!logLine.includes(value), `startup log line leaked the signing secret: ${logLine}`);
  assert.ok(!JSON.stringify(set.redacted()).includes(value));
  // ...and the guard is not vacuous: the raw config really does contain it.
  assert.ok(JSON.stringify({ ...set }).includes(value));
  // An empty or whitespace value is "unconfigured" too — never an empty secret
  // that verifies nothing against every delivery.
  assert.equal(loadConfig({ INVOICING_STRIPE_WEBHOOK_SECRET: '' }).webhookSecret, null);
  assert.equal(loadConfig({ INVOICING_STRIPE_WEBHOOK_SECRET: '   ' }).webhookSecret, null);
  assert.deepEqual(validateResolved(set), []);
});

// --- validateResolved: the health check's config check, at unit level --------

test('validateResolved accepts a well-formed config and rejects a broken one', () => {
  assert.deepEqual(validateResolved(loadConfig({})), []);

  const missing = { ...loadConfig({}) };
  delete missing.logLevel;
  assert.match(validateResolved(missing).join(' '), /logLevel .*INVOICING_LOG_LEVEL.* is missing/);

  const wrongType = { ...loadConfig({}), port: 'not-a-number' };
  assert.match(validateResolved(wrongType).join(' '), /port .*is not an integer/);

  const relative = { ...loadConfig({}), vendorDir: 'vendor' };
  assert.match(validateResolved(relative).join(' '), /vendorDir .*is not an absolute path/);

  assert.match(validateResolved(null).join(' '), /not an object/);
});
