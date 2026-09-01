// dependency-policy.test.js — the stack decision §11 turned from a document
// into a gate (AS-37, plan §9.6, §11).
//
// A policy enforced by review discipline is a policy that holds until the
// reviewer is busy. Adding a third dependency, loosening a pin to a caret
// range, or reaching for an HTTP client turns this suite RED — before anyone
// reads the diff.
//
// TWO THINGS THIS FILE MUST NOT FORECLOSE (plan §11). AS-38 makes the Stripe
// client the single custody chokepoint, and the stack decision chose a
// hand-rolled client precisely because "the only bypass is a second HTTP
// client, and node:http/fetch call sites are greppable". A generic HTTP helper
// shipped in this scaffold would leak that chokepoint before AS-38 exists. So
// the source scan below is not decoration either: it is AS-38's guard, held
// open until AS-38 can close it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { APP_DIR } from './helpers/server.js';

const PACKAGE = JSON.parse(readFileSync(join(APP_DIR, 'package.json'), 'utf8'));
const LOCK = JSON.parse(readFileSync(join(APP_DIR, 'package-lock.json'), 'utf8'));

/** The measured tree, 2026-09-01. Direct: 2. Distinct name@version: 67.
 *  Instances on disk: 69. 4.0 MB. Licences: 61 MIT, 4 ISC, 1 Apache-2.0,
 *  1 BSD-3-Clause. Zero non-permissive. */
const LOCK_ENTRIES = 70; // 69 installed packages + the root ("") entry
const DIRECT_DEPENDENCIES = ['ejs', 'express'];

/** Package names that are an outbound HTTP client or a payment SDK. Matched by
 *  EXACT NAME against the bare package name — never as a substring. A substring
 *  search for "got" matches "negotiator", which express depends on; a check
 *  that fires on the wrong thing gets loosened, and a loosened check is how a
 *  real one gets waved through. */
const FORBIDDEN_PACKAGES = new Set([
  'stripe',
  'axios',
  'undici',
  'got',
  'node-fetch',
  'superagent',
  'request',
  'request-promise',
  'ky',
  'phin',
  'needle',
  'bent',
  'wretch',
]);

// --- the direct dependency budget -------------------------------------------

test('exactly two direct dependencies: express and ejs', () => {
  const direct = Object.keys(PACKAGE.dependencies ?? {}).sort();
  assert.equal(direct.length, 2, `dependency budget is 2, found ${direct.length}: ${direct.join(', ')}`);
  assert.deepEqual(direct, DIRECT_DEPENDENCIES);
  // A third dependency is not a judgement call to be made in a diff: it goes
  // through all six of the decision's §11 rules first.
});

test('every direct dependency is an EXACT literal — no caret, no tilde, no range', () => {
  // `npm install express@5.2.1` writes "^5.2.1" by default, and the decision
  // lists a caret range among the things AS-37 must not do. The obvious command
  // produces the forbidden shape silently, so this is a test and not a
  // convention: install with `npm install --save-exact`.
  const specs = Object.entries(PACKAGE.dependencies ?? {});
  assert.equal(specs.length, 2);
  for (const [name, spec] of specs) {
    assert.match(spec, /^\d+\.\d+\.\d+$/, `${name} is pinned as "${spec}" — must be an exact literal`);
  }
  assert.equal(PACKAGE.dependencies.express, '5.2.1');
  assert.equal(PACKAGE.dependencies.ejs, '6.0.1');
});

test('there are no dev, peer, optional or bundled dependencies', () => {
  // The image installs with --omit=dev; a devDependency would be present on a
  // developer host and absent in the container, which is the AS-26 shape.
  for (const field of ['devDependencies', 'peerDependencies', 'optionalDependencies', 'bundledDependencies']) {
    assert.deepEqual(Object.keys(PACKAGE[field] ?? {}), [], `${field} must be empty`);
  }
});

test('the test script invokes node --test BARE', () => {
  // Two of three spike implementers lost time to `node --test <dir>` failing
  // with a misleading MODULE_NOT_FOUND. npm test must agree with compose.
  assert.equal(PACKAGE.scripts.test, 'node --test');
});

// --- the lockfile ------------------------------------------------------------

test('the lockfile is committed and pins the whole tree', () => {
  // The two exact literals above pin the direct set only; the other 65 packages
  // are pinned by nothing but this file.
  assert.equal(LOCK.lockfileVersion, 3);
  const entries = Object.keys(LOCK.packages);
  // Cardinality against a committed literal, before anything is quantified over
  // it. A lockfile that silently emptied would otherwise pass every check below.
  assert.equal(entries.length, LOCK_ENTRIES, `lockfile has ${entries.length} entries, expected ${LOCK_ENTRIES}`);
  assert.ok(entries.includes(''), 'the root entry is present');
  // The lockfile's own record of the direct set must agree with package.json.
  assert.deepEqual(Object.keys(LOCK.packages[''].dependencies ?? {}).sort(), DIRECT_DEPENDENCIES);
});

test('no package in the tree is an HTTP client or a payment SDK', () => {
  const installed = Object.keys(LOCK.packages)
    .filter((key) => key !== '')
    .map((key) => key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length));

  assert.equal(installed.length, LOCK_ENTRIES - 1, 'every non-root entry yielded a package name');

  const hits = installed.filter((name) => FORBIDDEN_PACKAGES.has(name));
  assert.deepEqual(hits, [], `forbidden package(s) in the tree: ${hits.join(', ')}`);

  // The matcher is exact, and this proves it: "negotiator" IS in this tree and
  // CONTAINS "got". A substring check would fire here. If this assertion ever
  // fails, express's tree changed — do not "fix" it by loosening the matcher.
  assert.ok(installed.includes('negotiator'), 'negotiator is present — the substring trap is live');
  assert.ok(!FORBIDDEN_PACKAGES.has('negotiator'));
});

// --- the source scan: AS-38's chokepoint, held open --------------------------

/** Strip comments so a scan cannot be fooled in either direction: a comment
 *  mentioning Stripe is not a violation, and code hidden past a `//` is. The
 *  stripper handles line and block comments, single/double/backtick strings,
 *  and EJS `<%# %>` comments. It is tested below, because a stripper that
 *  silently returned '' would make every scan that follows vacuous. */
function stripComments(source, { ejs = false } = {}) {
  let text = source;
  if (ejs) text = text.replace(/<%#[\s\S]*?%>/g, '');
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      out += ch;
      i += 1;
      while (i < text.length) {
        if (text[i] === '\\') {
          out += text.slice(i, i + 2);
          i += 2;
          continue;
        }
        out += text[i];
        if (text[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

test('the comment stripper works, in both directions', () => {
  assert.equal(stripComments('a // no fetch( here\nb').trim(), 'a\nb');
  assert.equal(stripComments('a /* no stripe */ b'), 'a  b');
  assert.equal(stripComments('<%# a comment %>x', { ejs: true }), 'x');
  // It must NOT strip a comment-looking sequence inside a string, or a real
  // call site could hide behind one.
  assert.equal(stripComments('const u = "http://x/*y*/";'), 'const u = "http://x/*y*/";');
  assert.ok(stripComments('fetch("/a") // comment').includes('fetch("/a")'));
});

/** Every app source file — deliberately NOT test/, where the helper legitimately
 *  fetches its own loopback listener. */
function appSourceFiles(dir = APP_DIR) {
  const found = [];
  for (const entry of readdirSync(dir).sort()) {
    if (entry === 'node_modules' || entry === 'test') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      found.push(...appSourceFiles(path));
    } else if (/\.(js|ejs|css)$/.test(entry)) {
      found.push(path);
    }
  }
  return found;
}

const APP_SOURCES = appSourceFiles();

test('the source scan examines exactly the files it is supposed to', () => {
  // V2, applied to the scan itself: a scan that examines zero things must not
  // be able to report success. This is the AS-31 failure — a checker that read
  // the wrong key, saw an empty graph, and passed three rules on nothing.
  const names = APP_SOURCES.map((p) => relative(APP_DIR, p)).sort();
  assert.equal(names.length, 11, `expected 11 app source files, found ${names.length}: ${names.join(', ')}`);
  assert.deepEqual(names, [
    'app.js',
    'lib/config.js',
    'lib/health.js',
    'lib/vendor.js',
    'lib/views.js',
    'public/scaffold.css',
    'routes/assets.js',
    'routes/health.js',
    'routes/pages.js',
    'server.js',
    'views/scaffold.ejs',
  ]);
  for (const path of APP_SOURCES) {
    const code = stripComments(readFileSync(path, 'utf8'), { ejs: path.endsWith('.ejs') });
    assert.ok(code.trim().length > 0, `${path} stripped to nothing — the stripper is broken`);
  }
});

test('no app source outside test/ contains an outbound HTTP client', () => {
  // The custody chokepoint AS-38 will build depends on there being exactly one
  // place that talks to the wire. Every hit here is a finding.
  const forbidden = [
    { name: 'fetch(', pattern: /\bfetch\s*\(/ },
    { name: 'http.request(', pattern: /\bhttps?\s*\.\s*request\s*\(/ },
    { name: "import 'node:http'", pattern: /(from|require\s*\()\s*['"]node:https?['"]/ },
    { name: 'axios', pattern: /(from|require\s*\()\s*['"]axios['"]/ },
    { name: 'undici', pattern: /(from|require\s*\()\s*['"]undici['"]/ },
  ];
  const hits = [];
  for (const path of APP_SOURCES) {
    const code = stripComments(readFileSync(path, 'utf8'), { ejs: path.endsWith('.ejs') });
    for (const { name, pattern } of forbidden) {
      if (pattern.test(code)) hits.push(`${relative(APP_DIR, path)}: ${name}`);
    }
  }
  assert.deepEqual(hits, [], `outbound HTTP client in app source: ${hits.join('; ')}`);
});

test('nothing AS-38 or AS-39 owns has leaked into the scaffold', () => {
  const forbidden = [
    { name: 'stripe module', pattern: /(from|require\s*\()\s*['"]stripe['"]/ },
    { name: 'STRIPE_ config key', pattern: /STRIPE_[A-Z_]+/ },
    { name: 'application_fee', pattern: /application_fee/ },
    { name: '/webhook route', pattern: /['"]\/webhook/ },
    { name: 'node:sqlite', pattern: /(from|require\s*\()\s*['"]node:sqlite['"]/ },
  ];
  const hits = [];
  for (const path of APP_SOURCES) {
    const code = stripComments(readFileSync(path, 'utf8'), { ejs: path.endsWith('.ejs') });
    for (const { name, pattern } of forbidden) {
      if (pattern.test(code)) hits.push(`${relative(APP_DIR, path)}: ${name}`);
    }
  }
  assert.deepEqual(hits, [], `AS-38/AS-39 concepts in the scaffold: ${hits.join('; ')}`);
  // Money is AS-39's: integer minor units with an explicit currency column. A
  // scaffold that guessed a representation would have to be undone.
  assert.deepEqual(
    APP_SOURCES.filter((p) => /amount|currency|money/i.test(readFileSync(p, 'utf8'))).map((p) => relative(APP_DIR, p)),
    [],
  );
});

test('no file in apps/invoicing exceeds 1,200 lines', () => {
  // Stack decision §10.4 item 1, trigger T7 — the measured size of
  // apps/chat/public/app.js. At scaffold size this is not close; it is checked
  // anyway, because it is the check nobody runs until it is too late.
  const oversized = [];
  for (const path of [...APP_SOURCES, ...appSourceFiles(join(APP_DIR, 'test'))]) {
    const lines = readFileSync(path, 'utf8').split('\n').length;
    if (lines > 1200) oversized.push(`${relative(APP_DIR, path)} (${lines})`);
  }
  assert.deepEqual(oversized, []);
});
