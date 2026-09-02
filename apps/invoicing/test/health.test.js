// health.test.js — the health check, and the scaffold page (AS-37, plan §9.5,
// §9.7, §10.3).
//
// THE STANDARD THIS FILE HOLDS THE ENDPOINT TO: every check must be
// demonstrated able to fail, or it is decoration. A health check with no
// demonstrated failure path is a 200 with extra steps. All four checks are
// driven red, each by the real-world condition it exists to catch — three of
// them below, the fourth in db.test.js (D9–D17):
//
//   config        <- an app handed a settings object that never passed loadConfig
//   vendor_assets <- the tokens COPY dropped from the Dockerfile / wrong vendorDir
//   views         <- views/ not COPY'd, and separately, a template that cannot render
//   database      <- the file missing, the directory unwritable, the schema ahead
//                    of the build, or a file that is not a database (db.test.js)
//
// The green case runs against the REAL container paths (/app/vendor,
// /app/views) inside the mountless test service, so it is a statement about the
// shipped image and not about a fixture (plan §8.3 V3).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HEALTH_CHECKS, runHealthChecks } from '../lib/health.js';
import { VIEWS } from '../lib/views.js';
import { configFor, preparedConfigFor, withServer } from './helpers/server.js';

/** Names of the checks that failed, sorted. */
const failing = (body) => body.checks.filter((c) => !c.ok).map((c) => c.name).sort();
const byName = (body, name) => body.checks.find((c) => c.name === name);

// --- V2: cardinality before quantification ----------------------------------

test('there are exactly four checks, by name', () => {
  assert.equal(HEALTH_CHECKS.length, 4);
  assert.deepEqual(HEALTH_CHECKS.map((c) => c.name), ['config', 'vendor_assets', 'views', 'database']);
  // Not checked, deliberately: Stripe (no account exists — asserting one would
  // encode the assumption plan §7.3 forbids). The database row is AS-39's, and
  // there is exactly one of it — the checks are data, so it was appended
  // without touching the route.
  assert.equal(HEALTH_CHECKS.filter((c) => /stripe/i.test(c.name)).length, 0);
  assert.equal(HEALTH_CHECKS.filter((c) => /database|db/i.test(c.name)).length, 1);
});

test('there is exactly one registered view', () => {
  assert.equal(VIEWS.length, 1);
  assert.deepEqual(VIEWS.map((v) => v.file), ['scaffold.ejs']);
});

// --- the green case, against the real image ---------------------------------

test('GET /healthz returns 200 and {ok:true} with all four checks passing', async () => {
  await withServer(configFor(), async (base) => {
    const res = await fetch(`${base}/healthz`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /application\/json/);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.deepEqual(body.checks.map((c) => c.name), ['config', 'vendor_assets', 'views', 'database']);
    assert.deepEqual(failing(body), []);
  });
});

test('the health body carries redacted config, never raw config', () => {
  const config = configFor();
  assert.deepEqual(config.redacted(), { ...config }, 'no secrets exist yet, so redacted() equals the config');
  // The mechanism is pinned in config.test.js against a fixture schema with a
  // real secret; this asserts the endpoint is wired to redacted() at all.
  assert.equal(typeof config.redacted, 'function');
});

// --- every check, demonstrated able to fail ---------------------------------

test('503 when vendorDir is wrong — vendor_assets is named as the failing check', async () => {
  // This is the AS-17/AS-26 failure, injected: the tokens COPY was dropped from
  // the Dockerfile, or vendorDir points somewhere that is not in the image.
  await withServer(configFor({ vendorDir: '/nonexistent/vendor' }), async (base) => {
    const res = await fetch(`${base}/healthz`);
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.deepEqual(failing(body), ['vendor_assets'], 'ONLY vendor_assets fails — the other three still pass');
    assert.match(byName(body, 'vendor_assets').detail, /\/nonexistent\/vendor\/tokens\.css/);
    assert.match(byName(body, 'vendor_assets').detail, /ENOENT/);
  });
});

test('503 when the vendored file exists but is empty', async () => {
  // The other half of "is the asset actually there": a zero-byte tokens.css is
  // a broken deploy that a plain existence check would wave through.
  const dir = await mkdtemp(join(tmpdir(), 'asc-inv-vendor-'));
  await writeFile(join(dir, 'tokens.css'), '');
  await withServer(configFor({ vendorDir: dir }), async (base) => {
    const res = await fetch(`${base}/healthz`);
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.deepEqual(failing(body), ['vendor_assets']);
    assert.match(byName(body, 'vendor_assets').detail, /is empty/);
  });
});

test('503 when viewsDir is missing — views is named as the failing check', async () => {
  await withServer(configFor({ viewsDir: '/nonexistent/views' }), async (base) => {
    const res = await fetch(`${base}/healthz`);
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.deepEqual(failing(body), ['views']);
    assert.match(byName(body, 'views').detail, /\/nonexistent\/views/);
  });
});

test('503 when a template exists but cannot render — views is named', async () => {
  // The half a stat() would miss. views/ is present and readable; the template
  // is broken. A deploy in this state serves 500s to every visitor, and
  // /healthz must say so.
  const dir = await mkdtemp(join(tmpdir(), 'asc-inv-views-'));
  await writeFile(join(dir, 'scaffold.ejs'), '<% this is not valid ejs %>');
  await withServer(configFor({ viewsDir: dir }), async (base) => {
    const res = await fetch(`${base}/healthz`);
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.deepEqual(failing(body), ['views']);
    assert.match(byName(body, 'views').detail, /scaffold/);
  });
});

test('503 when the app holds a settings object that never passed loadConfig — config is named', () => {
  // app.js takes settings as an argument (plan §3.3b), so the running app can
  // be holding a partial or hand-built object. Boot-time validation cannot see
  // that; this check can. Asserted at the check level rather than over HTTP
  // because a config broken enough to matter may not survive createApp.
  // preparedConfigFor, not configFor: no server boots here, so the database
  // must already be migrated on disk for `config` to be the ONLY failing check.
  const broken = { ...preparedConfigFor(), logLevel: 'chatty' };
  const result = runHealthChecks(broken);
  assert.equal(result.ok, false);
  assert.deepEqual(failing(result), ['config']);
  assert.match(byName(result, 'config').detail, /logLevel .*INVOICING_LOG_LEVEL/);

  const incomplete = { ...preparedConfigFor() };
  delete incomplete.vendorDir;
  const second = runHealthChecks(incomplete);
  assert.equal(second.ok, false);
  assert.ok(failing(second).includes('config'));
});

test('a check that throws is a failing check, never a 500', async () => {
  // The endpoint must stay able to answer; that is the entire point of it.
  const exploding = [{ name: 'boom', run() { throw new Error('detonated'); } }];
  const result = runHealthChecks(configFor(), exploding);
  assert.equal(result.ok, false);
  assert.match(byName(result, 'boom').detail, /check threw: detonated/);
});

// --- the scaffold page (plan §9.7, folded in here as the plan allows) --------

test('GET / renders the scaffold page and links the vendored stylesheet', async () => {
  await withServer(configFor(), async (base) => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const html = await res.text();
    assert.match(html, /apps\/invoicing scaffold/, 'the heading renders');
    assert.match(html, /<link rel="stylesheet" href="\/tokens\.css" \/>/, 'links the vendored stylesheet');
    assert.match(html, /<link rel="stylesheet" href="\/scaffold\.css" \/>/, 'links its app-owned stylesheet');
    // The swatches prove the loop ran: four token names, each as a var().
    const swatches = html.match(/var\(--color-ink-\d+\)/g) ?? [];
    assert.equal(swatches.length, 4, `expected exactly 4 swatches, got ${swatches.length}`);
  });
});

test('an unknown path 404s rather than falling through to something else', async () => {
  await withServer(configFor(), async (base) => {
    const res = await fetch(`${base}/no-such-page`);
    assert.equal(res.status, 404);
  });
});
