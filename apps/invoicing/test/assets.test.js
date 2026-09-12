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
/** Distinct custom-property NAMES in tokens.css. Smaller than the declaration
 *  count because blocks 2-4 re-declare the same semantic names for light, dark
 *  and explicit-dark. It is the SET that a var() reference has to resolve
 *  against, so it gets its own committed literal. */
const TOKEN_NAMES = 127;
/** Files in public/. */
const PUBLIC_FILES = ['app.css'];
/** Declarations in public/app.css, measured when the file was finished. */
const APP_CSS_DECLARATIONS = 184;
/** var(--…) references in public/app.css, measured at the same moment. */
const APP_CSS_VAR_REFERENCES = 143;

const countDeclarations = (css) => (css.match(/^[ \t]*--[A-Za-z0-9_-]+[ \t]*:/gm) ?? []).length;

/** The CSS <named-color> keywords (CSS Color 4). `transparent` and
 *  `currentcolor` are deliberately NOT members: they carry no design value and
 *  cannot drift from the token file, which is what this list is for. */
const NAMED_COLOURS = new Set((
  'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown '
  + 'burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan '
  + 'darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid '
  + 'darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet '
  + 'deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro '
  + 'ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki '
  + 'lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow '
  + 'lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray '
  + 'lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine '
  + 'mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise '
  + 'mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab '
  + 'orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru '
  + 'pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown '
  + 'seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan '
  + 'teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'
).split(' '));

/** A number immediately followed by a length unit — the "magic value" shape. */
const DIMENSIONAL_LITERAL = /\d(px|em|rem|ch|ex|vh|vw|vmin|vmax|pt|pc|cm|mm|in)\b/;
/** Every way of typing a colour that is not a token reference. */
const COLOUR_FUNCTION = /#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?|oklch|oklab|lab|lch|color)\s*\(/;

/** Strip CSS block comments. The MEDIA check below reads the RAW text instead,
 *  because the breakpoint carve-out lives in a trailing comment. */
const stripCssComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every `prop: value;` in a stylesheet. A media prelude carries no `;` before
 *  its `{`, so preludes are structurally excluded rather than filtered out. */
function declarations(css) {
  return [...stripCssComments(css).matchAll(/([a-zA-Z-]+)\s*:\s*([^;{}]+);/g)]
    .map((m) => ({ property: m[1], value: m[2].trim() }));
}

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

test('every visual value in public/ CSS traces to a token that exists', async () => {
  // REPLACES the naive check this file shipped with, which asserted (a) no hex
  // literal and (b) `body.includes('var(--')`. A stylesheet of
  // `color: rgb(0,0,0); padding: 12px;` plus one var() anywhere passed both.
  // Two halves are new and each is separately falsifiable (plan §7 F4-F6):
  // DIMENSIONAL literals are caught, and every var() NAME IS RESOLVED against
  // the vendored token file — CSS ignores an unknown custom property silently,
  // so `var(--color-text-primaryy)` renders unstyled and passes any no-literals
  // check ever written.
  //
  // THE SCOPE IS public/*.css, and that is sound because two guards hold each
  // other up: dependency-policy.test.js's P2c row bans <style> elements in
  // views/ and its P2a row bans style= interpolation, so there is nowhere else
  // in this app a visual value can hide.
  const config = configFor();

  // --- cardinality before quantification, in four steps, in this order ------
  // 1. The directory really holds what is committed. A check reading a
  //    directory nobody wrote to fails HERE, before it can pass on nothing.
  const onDisk = (await readdir(config.publicDir)).sort();
  assert.deepEqual(onDisk, PUBLIC_FILES, `public/ holds [${onDisk.join(', ')}]`);

  // 2. The token file in the IMAGE yields exactly the committed number of
  //    declarations and the committed number of distinct names. Everything
  //    below resolves against this set, so an empty or truncated token file
  //    must fail before it can make every resolution vacuously true.
  const tokensCss = await readFile(join(config.vendorDir, 'tokens.css'), 'utf8');
  assert.equal(countDeclarations(tokensCss), TOKENS_DECLARATIONS, 'the vendored token file is the one this check resolves against');
  const tokenValues = new Map();
  for (const m of tokensCss.matchAll(/^[ \t]*(--[A-Za-z0-9_-]+)[ \t]*:([^;]*);/gm)) {
    tokenValues.set(m[1], m[2].trim());
  }
  assert.equal(
    [...tokensCss.matchAll(/^[ \t]*(--[A-Za-z0-9_-]+)[ \t]*:([^;]*);/gm)].length,
    TOKENS_DECLARATIONS,
    'every declaration parsed into a name/value pair',
  );
  assert.equal(tokenValues.size, TOKEN_NAMES, `tokens.css declares ${tokenValues.size} distinct names, expected ${TOKEN_NAMES}`);

  const css = await readFile(join(config.publicDir, 'app.css'), 'utf8');

  // 3. The scanned declaration count. A truncated stylesheet fails here.
  const decls = declarations(css);
  assert.equal(decls.length, APP_CSS_DECLARATIONS, `app.css has ${decls.length} declarations, expected ${APP_CSS_DECLARATIONS}`);

  // 4. The var() reference count. A stylesheet that dropped all its tokens
  //    fails here rather than passing the conformance sweep on an empty set.
  const references = [...stripCssComments(css).matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)].map((m) => m[1]);
  assert.equal(references.length, APP_CSS_VAR_REFERENCES, `app.css makes ${references.length} var() references, expected ${APP_CSS_VAR_REFERENCES}`);

  // --- now, and only now, quantify -----------------------------------------

  // (a) No magic values. Unitless numbers, percentages and keywords are
  //     conformant: they carry layout structure, not design values, and a check
  //     that fired on `display: flex` would get loosened — and a loosened check
  //     is how a real one gets waved through.
  const magic = [];
  for (const { property, value } of decls) {
    if (DIMENSIONAL_LITERAL.test(value)) magic.push(`${property}: ${value} — dimensional literal`);
    else if (COLOUR_FUNCTION.test(value)) magic.push(`${property}: ${value} — colour literal`);
    else {
      const named = value.split(/[^A-Za-z-]+/).filter((w) => NAMED_COLOURS.has(w.toLowerCase()));
      if (named.length > 0) magic.push(`${property}: ${value} — named colour ${named.join(', ')}`);
    }
  }
  assert.deepEqual(magic, [], `app.css must reference var(--token), never a re-typed value:\n${magic.join('\n')}`);

  // (b) THE HALF THE NAIVE CHECK STRUCTURALLY COULD NOT DO. Every referenced
  //     name must exist in the vendored file.
  const unresolved = [...new Set(references.filter((name) => !tokenValues.has(name)))];
  assert.deepEqual(unresolved, [], `app.css references custom propert(ies) that tokens.css does not declare: ${unresolved.join(', ')}`);

  // (c) THE @media CARVE-OUT, WITH TEETH. var() is invalid inside a media
  //     condition, so a px literal is permitted there — but ONLY on a line
  //     carrying a trailing `--breakpoint-<name>` comment, and only when the
  //     literal EQUALS that token's value read from tokens.css. The comment is
  //     resolved, never taken on faith.
  const preludes = css.split('\n').filter((line) => /^\s*@media\b/.test(line));
  assert.ok(preludes.length > 0, 'no media prelude was examined — this check is reading nothing');
  const breakpointProblems = [];
  for (const line of preludes) {
    const named = line.match(/\/\*\s*(--breakpoint-[a-z]+)\s*\*\//);
    for (const [literal] of line.matchAll(/\d+px\b/g)) {
      if (named === null) {
        breakpointProblems.push(`${literal} in "${line.trim()}" carries no --breakpoint-<name> comment`);
        continue;
      }
      const declared = tokenValues.get(named[1]);
      if (declared === undefined) breakpointProblems.push(`${named[1]} is not declared in tokens.css`);
      else if (declared !== literal) breakpointProblems.push(`${literal} does not equal ${named[1]}'s ${declared}`);
    }
  }
  assert.deepEqual(breakpointProblems, [], `media preludes must resolve to a breakpoint token:\n${breakpointProblems.join('\n')}`);
});
