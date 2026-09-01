// assets.test.js — the vendored asset, and public/ enumeration (AS-37, plan
// §9.4, §5.3, §3.3c).
//
// THIS IS THE V3 TEST: the container is the subject. It runs inside the
// mountless, network-blocked `test` service and fetches tokens.css out of the
// REAL image through the REAL serving path — not from a fixture directory, and
// not by reading the compose manifest and believing it. The mechanism it proves
// (repo-root build context -> COPY docs/design/tokens/tokens.css -> explicit
// route) has been mutation-tested: delete the COPY line, rebuild, and this file
// turns the suite red.
//
// The literals below (12199 bytes, 183 declarations, 1 public file) are
// committed numbers, not thresholds. tokens.css is governed by
// docs/design/tokens/tokens.test.mjs and derived from BRANDING.md; when design
// changes it, this file goes red and the numbers are updated deliberately in
// the same commit. That is the intended coupling — the stack decision requires
// byte-identical service, and a byte count is how you assert it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VENDOR_ASSETS } from '../lib/vendor.js';
import { configFor, withServer } from './helpers/server.js';

/** The exact byte length the stack decision names for tokens.css. */
const TOKENS_BYTES = 12199;
/** Custom-property DECLARATIONS in tokens.css. A truncated file would sail
 *  through a "non-empty" check; it cannot sail through an exact count. */
const TOKENS_DECLARATIONS = 183;
/** Files in public/. */
const PUBLIC_FILES = ['scaffold.css'];

const countDeclarations = (css) => (css.match(/^[ \t]*--[A-Za-z0-9_-]+[ \t]*:/gm) ?? []).length;

// --- V2: cardinality before quantification ----------------------------------

test('exactly one vendored asset is registered', () => {
  assert.equal(VENDOR_ASSETS.length, 1);
  assert.deepEqual(VENDOR_ASSETS.map((a) => a.route), ['/tokens.css']);
  assert.deepEqual(VENDOR_ASSETS.map((a) => a.file), ['tokens.css']);
});

// --- the vendored asset, served out of the real image -----------------------

test('GET /tokens.css serves the vendored file byte-identically', async () => {
  const config = configFor();
  const onDisk = await readFile(join(config.vendorDir, 'tokens.css'));

  // The file that shipped in the image is itself the committed length. If this
  // fails, the COPY is wrong or the source moved — before any HTTP is involved.
  assert.equal(onDisk.length, TOKENS_BYTES, `image copy is ${onDisk.length} bytes, expected ${TOKENS_BYTES}`);

  await withServer(config, async (base) => {
    const res = await fetch(`${base}/tokens.css`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/css; charset=utf-8');

    const served = Buffer.from(await res.arrayBuffer());
    // Byte-identical, not "looks similar": no transform, no minify, no hash.
    assert.ok(served.equals(onDisk), 'served bytes differ from the file in the image');
    assert.equal(served.length, TOKENS_BYTES);
    // The header must agree with the body, and with the decision's number.
    assert.equal(res.headers.get('content-length'), String(TOKENS_BYTES));
  });
});

test('the served stylesheet is the real token file, not a plausible stand-in', async () => {
  await withServer(configFor(), async (base) => {
    const css = await (await fetch(`${base}/tokens.css`)).text();
    // Sentinel: a specific token that exists in the real file.
    assert.ok(css.includes('--color-ink-500:'), 'sentinel token missing');
    // Cardinality before quantification: an exact declaration count. A file
    // truncated to its first block would pass every check above except this.
    assert.equal(countDeclarations(css), TOKENS_DECLARATIONS);
    assert.ok(css.includes('BRANDING.md'), 'the provenance header is intact');
  });
});

test('HEAD /tokens.css reports the length without a body', async () => {
  // This is what `curl -sI http://127.0.0.1:8348/tokens.css` does, which is the
  // acceptance criterion's own command.
  await withServer(configFor(), async (base) => {
    const res = await fetch(`${base}/tokens.css`, { method: 'HEAD' });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-length'), String(TOKENS_BYTES));
    assert.equal((await res.arrayBuffer()).byteLength, 0);
  });
});

test('a missing vendored asset is a 503, not a silent 404', async () => {
  // A vendored asset absent from the image is a deploy failure. It must be
  // loud, and it must match what /healthz says about the same condition.
  await withServer(configFor({ vendorDir: '/nonexistent/vendor' }), async (base) => {
    const res = await fetch(`${base}/tokens.css`);
    assert.equal(res.status, 503);
    assert.match(await res.text(), /vendored asset unavailable: tokens\.css/);
  });
});

test('a file in public/ cannot shadow a vendored route', async () => {
  // The reason vendored assets are explicit named routes registered BEFORE
  // express.static (plan §3.3d): a stray public/tokens.css must lose.
  const decoyPublic = await mkdtemp(join(tmpdir(), 'asc-inv-public-'));
  await writeFile(join(decoyPublic, 'tokens.css'), '/* decoy: this must never be served */\n');
  await withServer(configFor({ publicDir: decoyPublic }), async (base) => {
    const css = await (await fetch(`${base}/tokens.css`)).text();
    assert.ok(!css.includes('decoy'), 'express.static shadowed the vendored route');
    assert.equal(countDeclarations(css), TOKENS_DECLARATIONS);
  });
});

// --- public/ enumeration: the AS-17 guard -----------------------------------

test('every file in public/ is served, and public/ is exactly what is committed', async () => {
  // AS-17 was a public module absent from an allowlist: it 404'd at runtime
  // while every unit test passed. express.static removes the allowlist, and
  // this closes the other direction — the served set must EQUAL the on-disk
  // set, with a committed count so a scan of nothing cannot report success.
  const config = configFor();
  const onDisk = (await readdir(config.publicDir, { withFileTypes: true, recursive: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();

  assert.equal(onDisk.length, PUBLIC_FILES.length, `public/ holds ${onDisk.length} files: ${onDisk.join(', ')}`);
  assert.deepEqual(onDisk, PUBLIC_FILES);

  await withServer(config, async (base) => {
    for (const name of onDisk) {
      const res = await fetch(`${base}/${name}`);
      assert.equal(res.status, 200, `public/${name} is not reachable over HTTP`);
      const served = Buffer.from(await res.arrayBuffer());
      const expected = await readFile(join(config.publicDir, name));
      assert.ok(served.equals(expected), `public/${name} is not served byte-identically`);
    }
  });
});

test('public/ styles reference tokens rather than re-typing values', async () => {
  // The app owns public/scaffold.css, but the VALUES stay in the vendored
  // token file. A hex literal here is drift from the single source of visual
  // truth (AS-29), so it is a test rather than a review note.
  const config = configFor();
  const css = await readFile(join(config.publicDir, 'scaffold.css'), 'utf8');
  const body = css.replace(/\/\*[\s\S]*?\*\//g, ''); // strip comments
  const hexLiterals = body.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
  assert.deepEqual(hexLiterals, [], 'app CSS must reference var(--token), never a re-typed colour');
  assert.ok(body.includes('var(--'), 'app CSS references tokens');
});
