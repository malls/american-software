// dependency-policy.test.js — the stack decision §11 turned from a document
// into a gate (AS-37, plan §9.6, §11).
//
// A policy enforced by review discipline is a policy that holds until the
// reviewer is busy. Adding a third dependency, loosening a pin to a caret
// range, or reaching for an HTTP client turns this suite RED — before anyone
// reads the diff.
//
// THE CHOKEPOINT IS NOW CLOSED (AS-38). The Stripe client is the single custody
// chokepoint, and the stack decision chose a hand-rolled client precisely
// because "the only bypass is a second HTTP client, and node:http/fetch call
// sites are greppable". The product has exactly ONE outbound HTTP call
// (lib/stripe/transport.js) and exactly ONE importer of it (lib/stripe/client.js);
// both are sanctioned below by file, construct, and the whole line, and a second
// hit anywhere is a second HTTP client and a red test. The scan is lexical: it
// cannot see `process.binding`, `createRequire` tricks, or a dependency that
// phones home — the dependency budget (2) and node_modules being unscanned by
// design answer the latter; the former are review-visible (plan §2.9 item 5).
//
// THE SCAN IS CLOSED-WORLD OVER THIS DIRECTORY (AS-53). It reads app source AND
// the manifests — Dockerfile, compose.yaml, package.json — because a manifest
// can invoke an HTTP client too (a healthcheck, a RUN, a script), and the
// AS-37 review found compose.yaml's `fetch(` sitting outside an extension-list
// walker. Every file is now app source, a manifest, or listed as unscanned
// with a reason; an unclassified file fails the suite. The one legitimate hit
// (compose's loopback healthcheck) is sanctioned by a keyed, counted allowlist
// entry that must be used exactly as declared, not silently unseen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
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
 *  silently returned '' would make every scan that follows vacuous.
 *
 *  Line-preserving (AS-53): a comment's newlines survive it, so a line number
 *  in the stripped text IS the line number in the file — the scan reports
 *  `file:line`, and a number that drifts past every block comment is worse
 *  than none. */
function stripComments(source, { ejs = false } = {}) {
  let text = source;
  if (ejs) text = text.replace(/<%#[\s\S]*?%>/g, (comment) => comment.replace(/[^\n]/g, ''));
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
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        if (text[i] === '\n') out += '\n';
        i += 1;
      }
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
  // Note the retained space before the stripped `//`: the stripper removes the
  // comment, not the whitespace around it. Asserting the exact output keeps
  // this honest rather than trimming until it agrees.
  assert.equal(stripComments('a // no fetch( here\nb'), 'a \nb');
  assert.equal(stripComments('a /* no stripe */ b'), 'a  b');
  assert.equal(stripComments('<%# a comment %>x', { ejs: true }), 'x');
  // It must NOT strip a comment-looking sequence inside a string, or a real
  // call site could hide behind one.
  assert.equal(stripComments('const u = "http://x/*y*/";'), 'const u = "http://x/*y*/";');
  assert.ok(stripComments('fetch("/a") // comment').includes('fetch("/a")'));
  // Line-preserving: the newlines inside a multi-line comment survive, so
  // `fetch(` on line 3 is still reported as line 3 after stripping.
  assert.equal(stripComments('a /* x\ny */ b\nfetch('), 'a \n b\nfetch(');
  assert.equal(stripComments('<%# x\ny %>z', { ejs: true }), '\nz');
});

/** The manifest strippers' comment syntax is `#`. Full-line comments always
 *  go; a trailing ` # ...` goes only when `trailing` is set, and never inside
 *  "…" or '…'. Per file: .yaml/.yml → trailing: true; Dockerfile → trailing:
 *  false (Docker does not treat a mid-instruction `#` as a comment, so neither
 *  may we — deploy-shape.test.js makes the same choice in DOCKERFILE_CODE);
 *  .json → not stripped at all, JSON has no comment syntax and a `#` inside a
 *  JSON string is data. Line-preserving, like stripComments: a removed comment
 *  leaves its (empty) line behind. */
function stripHashComments(text, { trailing = false } = {}) {
  return text
    .split('\n')
    .map((line) => {
      if (/^\s*#/.test(line)) return '';
      if (!trailing) return line;
      let quote = null;
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (quote) {
          if (ch === quote) quote = null;
        } else if (ch === '"' || ch === "'") {
          quote = ch;
        } else if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
          return line.slice(0, i);
        }
      }
      return line;
    })
    .join('\n');
}

test('the manifest comment stripper works, in both directions', () => {
  // Removes: a full-line comment, whatever it mentions, under both settings.
  assert.equal(stripHashComments('# fetch(\nx: 1'), '\nx: 1');
  assert.equal(stripHashComments('  # fetch(\nRUN x', { trailing: true }), '\nRUN x');
  // Removes: a trailing comment — but only where the file's syntax has one.
  assert.equal(stripHashComments('a: b # fetch(', { trailing: true }), 'a: b ');
  assert.equal(stripHashComments('RUN x # fetch(', { trailing: false }), 'RUN x # fetch(');
  // Keeps: a `#` inside a string, under both settings — a real call site could
  // otherwise hide behind a quoted hash.
  assert.equal(stripHashComments('k: "a # b"', { trailing: true }), 'k: "a # b"');
  assert.equal(stripHashComments("k: 'a # b'", { trailing: true }), "k: 'a # b'");
  assert.equal(stripHashComments('k: "a # b"', { trailing: false }), 'k: "a # b"');
  // Keeps: code before the comment; `a#b` is not a comment in YAML either.
  assert.equal(stripHashComments('x: fetch( # c', { trailing: true }), 'x: fetch( ');
  assert.equal(stripHashComments('x: a#b', { trailing: true }), 'x: a#b');
  // The real compose.yaml: its 25-line prose header goes, its instructions stay.
  const composeRaw = readFileSync(join(APP_DIR, 'compose.yaml'), 'utf8');
  const compose = stripHashComments(composeRaw, { trailing: true });
  assert.ok(composeRaw.includes('BuildKit note'), 'the raw header DOES contain the prose the scan must not trip on');
  assert.ok(!compose.includes('BuildKit note'), 'the header prose is gone');
  assert.ok(compose.includes('healthcheck:'), 'the instructions survived');
  assert.equal(compose.split('\n').length, composeRaw.split('\n').length, 'line count is preserved');
  // .json is never stripped: identity, byte for byte.
  const packageRaw = readFileSync(join(APP_DIR, 'package.json'), 'utf8');
  assert.equal(strippedText(join(APP_DIR, 'package.json')), packageRaw);
});

// --- the closed-world walker (AS-53) ------------------------------------------
//
// The AS-37 review found the scan had a blind spot shaped like an extension
// list: compose.yaml carries a `fetch(` (its healthcheck) and the walker never
// read it, because it admitted .js/.ejs/.css and nothing else. Adding more
// extensions moves the blind spot; it does not remove it. So every file under
// this directory (minus the three skipped trees below) is placed in exactly ONE
// bucket, and a file in no bucket fails the suite. The next new file type is a
// decision someone writes down here, not an omission.
//
// Classification order is binding: UNSCANNED first (package-lock.json matches
// MANIFEST_NAME by extension and must be caught by name before the regex sees
// it), then SOURCE_EXT, then MANIFEST_NAME, else unknown.

/** App source: JavaScript by definition (.mjs/.cjs included — zero files today,
 *  zero cost), EJS templates, and stylesheets. Stripped by stripComments. */
const SOURCE_EXT = /\.(js|mjs|cjs|ejs|css)$/;

/** Manifests — the places a manifest can invoke an HTTP client (HEALTHCHECK,
 *  healthcheck:, RUN, CMD, command:, a package.json script). Dockerfile(\..+)?
 *  deliberately matches a stray Dockerfile.bak: a manifest-shaped file is
 *  scanned by default, which is the right default. Both Dockerfile and
 *  compose.yaml are COPY'd to /app, so this set is identical host-side and
 *  in-container. MUST stay a single-line constant beginning
 *  `const MANIFEST_NAME = `: the M0 falsification (AS-53 plan §4.3) rewrites
 *  this exact line with a one-line perl any reviewer can run cold. */
const MANIFEST_NAME = /^(Dockerfile(\..+)?|.+\.ya?ml|.+\.json)$/;

/** Files the walker accounts for but never reads. ALLOWED-IF-PRESENT, not an
 *  expected list: README.md exists only on the host and .dockerignore only in
 *  the image, and the suite must pass in both places.
 *   - package-lock.json: generated, no executable content, and guarded by the
 *     right tool for its shape — LOCK_ENTRIES plus exact-name matching above.
 *     A regex over 898 lines adds noise and no coverage.
 *   - README.md: prose cannot execute, and it is not COPY'd into the image, so
 *     scanning it would break host/container parity of the scanned set.
 *   - .dockerignore: a pattern list; cannot execute; already parsed as data by
 *     deploy-shape.test.js. Present only at /app (COPY'd from the repo root). */
const UNSCANNED = new Set(['package-lock.json', 'README.md', '.dockerignore']);

/** Not walked at all, as before AS-53: test/ legitimately fetches its own
 *  loopback listener; vendor/ is not ours and exists only inside the image
 *  (including it would make the file set differ between host and container —
 *  what lands there is bounded by VENDOR_ASSETS, pinned by assets.test.js);
 *  node_modules/ is the lockfile's job. demo/ (AS-90) is the board's
 *  walkthrough: like test/ it drives its own loopback listener with `fetch`
 *  and is never imported by app code — which the closed-world case below
 *  asserts rather than assumes, so skipping the directory cannot quietly make
 *  it an import path for lib/ or routes/. */
const SKIPPED_DIRS = new Set(['node_modules', 'test', 'vendor', 'demo']);

/** Walk `dir` and bucket every file by basename. */
function classifyTree(dir) {
  const buckets = { source: [], manifest: [], unscanned: [], unknown: [] };
  for (const entry of readdirSync(dir).sort()) {
    if (SKIPPED_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      const sub = classifyTree(path);
      for (const key of Object.keys(buckets)) buckets[key].push(...sub[key]);
    } else if (UNSCANNED.has(entry)) {
      buckets.unscanned.push(path);
    } else if (SOURCE_EXT.test(entry)) {
      buckets.source.push(path);
    } else if (MANIFEST_NAME.test(entry)) {
      buckets.manifest.push(path);
    } else {
      buckets.unknown.push(path);
    }
  }
  return buckets;
}

const FILES = classifyTree(APP_DIR);
/** What the scans below read: app source and manifests, in that order. */
const SCANNED = [...FILES.source, ...FILES.manifest];

/** A scanned file's text with its class's comment syntax removed. */
function strippedText(path) {
  const name = basename(path);
  const text = readFileSync(path, 'utf8');
  if (SOURCE_EXT.test(name)) return stripComments(text, { ejs: name.endsWith('.ejs') });
  if (/\.ya?ml$/.test(name)) return stripHashComments(text, { trailing: true });
  if (/^Dockerfile(\..+)?$/.test(name)) return stripHashComments(text, { trailing: false });
  return text; // .json: no comment syntax, so nothing to strip
}

test('the scan examines exactly the files it is supposed to — source, manifests, and nothing unclassified', () => {
  // V2, applied to the scan itself: a scan that examines zero things must not
  // be able to report success. This is the AS-31 failure — a checker that read
  // the wrong key, saw an empty graph, and passed three rules on nothing.
  // Exact lists per class, not minimums: a new .yaml file is a visible,
  // deliberate two-line change (the file, and the list here).
  const rel = (paths) => paths.map((p) => relative(APP_DIR, p)).sort();

  // 1. The closed world: nothing is unclassified. This is the load-bearing one.
  const unknown = rel(FILES.unknown);
  assert.deepEqual(
    unknown,
    [],
    unknown
      .map((f) => `${f} is neither app source, a manifest, nor listed in UNSCANNED — classify it (SOURCE_EXT / MANIFEST_NAME) or list it with a reason`)
      .join('\n'),
  );

  // 2. The manifests, exactly.
  const manifest = rel(FILES.manifest);
  assert.equal(manifest.length, 3, `expected 3 manifests, found ${manifest.length}: ${manifest.join(', ')}`);
  assert.deepEqual(manifest, ['Dockerfile', 'compose.yaml', 'package.json']);

  // 3. The app source, exactly.
  const source = rel(FILES.source);
  assert.equal(source.length, 63, `expected 63 app source files, found ${source.length}: ${source.join(', ')}`);
  assert.deepEqual(source, [
    'app.js',
    'lib/auth/accounts.js',
    'lib/auth/guard.js',
    'lib/auth/password.js',
    'lib/auth/session.js',
    'lib/config.js',
    'lib/connect/onboarding.js',
    'lib/connect/readiness.js',
    'lib/contracts/generation.js',
    'lib/contracts/render.js',
    'lib/contracts/templates.js',
    'lib/contracts/templates/independent-contractor-agreement.js',
    'lib/db/connection.js',
    'lib/db/database.js',
    'lib/db/errors.js',
    'lib/db/migrate.js',
    'lib/db/migrations/0001-initial.js',
    'lib/db/migrations/0002-accounts.js',
    'lib/db/money.js',
    'lib/db/repositories/clients.js',
    'lib/db/repositories/connected-accounts.js',
    'lib/db/repositories/contracts.js',
    'lib/db/repositories/credentials.js',
    'lib/db/repositories/freelancers.js',
    'lib/db/repositories/invoices.js',
    'lib/db/repositories/sessions.js',
    'lib/db/repositories/stripe-events.js',
    'lib/health.js',
    'lib/invoices/lifecycle.js',
    'lib/invoices/mapping.js',
    'lib/screens/connect-view.js',
    'lib/screens/contract-detail-view.js',
    'lib/screens/contract-form-view.js',
    'lib/screens/dashboard-view.js',
    'lib/screens/dates.js',
    'lib/screens/invoice-detail-view.js',
    'lib/screens/invoice-form-view.js',
    'lib/screens/signin-view.js',
    'lib/stripe/client.js',
    'lib/stripe/custody.js',
    'lib/stripe/transport.js',
    'lib/vendor.js',
    'lib/views.js',
    'lib/webhooks/receiver.js',
    'lib/webhooks/signature.js',
    'public/app.css',
    'routes/assets.js',
    'routes/auth.js',
    'routes/clients.js',
    'routes/connect.js',
    'routes/contracts.js',
    'routes/health.js',
    'routes/invoices.js',
    'routes/pages.js',
    'routes/webhooks.js',
    'server.js',
    'views/connect-stripe.ejs',
    'views/contract-detail.ejs',
    'views/contract-form.ejs',
    'views/dashboard.ejs',
    'views/invoice-detail.ejs',
    'views/invoice-form.ejs',
    'views/signin.ejs',
  ]);

  // 4. Every scanned file survives its class's stripper.
  for (const path of SCANNED) {
    assert.ok(strippedText(path).trim().length > 0, `${relative(APP_DIR, path)} stripped to nothing — the stripper is broken`);
  }

  // 5. A SKIPPED directory is not an import path for app code (AS-90). demo/
  // is skipped like test/, so nothing above scans it — which is exactly why
  // this is asserted: a `demo/` import from lib/ or routes/ would pull unscanned
  // code (a second `fetch` user) into the runtime through a door the walker
  // deliberately does not look behind. Whole-text on the STRIPPED source so a
  // comment naming the directory (the Dockerfile's, this file's) is not a hit;
  // the specifier form (`from '…demo/…'`, `import('…demo/…')`) is what is
  // matched. Cardinality first: the set examined is the closed world above.
  assert.equal(SCANNED.length, source.length + manifest.length);
  const demoImports = SCANNED.filter((path) => /(from|import\s*\()\s*['"][^'"]*\bdemo\/[^'"]*['"]/.test(strippedText(path)));
  assert.deepEqual(demoImports.map((p) => relative(APP_DIR, p)), [], 'app source imports from demo/ — the walkthrough is not runtime code');
});

// --- outbound HTTP clients, and the one hit that is allowed ------------------

/** Constructs that talk to the wire. Node-shaped ones for source; `curl` and
 *  `wget` because a manifest cannot `import axios` — what a manifest can do is
 *  `RUN curl` or `CMD wget`. The only curl/wget token in the scanned set is a
 *  `//` comment in routes/assets.js, which stripComments removes first; if
 *  either pattern ever reports a hit there, the stripper regressed — do not
 *  loosen the pattern.
 *
 *  `fetch` is matched as a bare TOKEN, not a call (AS-38, plan §2.9 item 1):
 *  `const f = fetch; f(url)`, `globalThis.fetch` and `const { fetch } =
 *  globalThis` are all a second HTTP client, and `/\bfetch\s*\(/` saw none of
 *  them. `fetchTransport` is one word and does not match. The import rows catch
 *  dynamic `import(...)` and the un-prefixed `'http'` spelling; the sockets, http2
 *  and child_process rows are here because a raw socket, an h2 session, or a
 *  shelled-out curl is an HTTP client wearing a different coat. The transport
 *  import is itself a guarded construct, so a route that reaches past the
 *  client to the transport is a finding, not a style issue. */
const OUTBOUND_CLIENTS = [
  { name: 'fetch', pattern: /\bfetch\b/ },
  { name: 'http.request(', pattern: /\bhttps?\s*\.\s*(request|get)\s*\(/ },
  { name: "import 'node:http'", pattern: /(from|require\s*\(|import\s*\()\s*['"](node:)?https?['"]/ },
  { name: "import 'node:http2'", pattern: /(from|require\s*\(|import\s*\()\s*['"](node:)?http2['"]/ },
  { name: "import 'node:net' / 'node:tls'", pattern: /(from|require\s*\(|import\s*\()\s*['"](node:)?(net|tls)['"]/ },
  { name: "import 'node:child_process'", pattern: /(from|require\s*\(|import\s*\()\s*['"](node:)?child_process['"]/ },
  { name: 'WebSocket', pattern: /\bWebSocket\b/ },
  { name: 'stripe transport import', pattern: /['"][^'"]*\btransport\.js['"]/ },
  { name: 'axios', pattern: /(from|require\s*\(|import\s*\()\s*['"]axios['"]/ },
  { name: 'undici', pattern: /(from|require\s*\(|import\s*\()\s*['"]undici['"]/ },
  { name: 'curl', pattern: /\bcurl\b/ },
  { name: 'wget', pattern: /\bwget\b/ },
];

/** The allowlist. Keyed on file + construct + the WHOLE line a hit must sit on
 *  + how many hits it may absorb — never a bare file exclusion. Every entry
 *  must be used exactly `count` times (asserted below): a sanction that
 *  sanctions nothing is a hole waiting for a tenant, so the allowlist cannot
 *  outlive what it sanctions. The two AS-38 entries pin the product's only
 *  egress and its only importer byte-for-byte; the falsification recipes in the
 *  AS-38 plan (§6 M5, M6) rewrite exactly those lines. */
const SANCTIONED = [
  {
    file: 'compose.yaml',
    construct: 'fetch',
    count: 1,
    line: /^\s+test: \["CMD", "node", "-e", "fetch\('http:\/\/127\.0\.0\.1:8348\/healthz'\)/,
    reason:
      "the web service's compose healthcheck probes ITS OWN /healthz over loopback so " +
      'compose can learn the container is alive. It is a self-probe, not an outbound ' +
      'client: the target is pinned to 127.0.0.1:8348 by the line shape, so pointing it ' +
      'anywhere else, or moving the fetch( to another key, un-sanctions it.',
  },
  {
    file: 'lib/stripe/transport.js',
    construct: 'fetch',
    count: 1,
    line: /^  const response = await fetch\(request\.url, init\);$/,
    reason:
      'AS-38: the one outbound HTTP call in the product (stack decision §11 chokepoint ' +
      'corollary, §12). A second hit anywhere is a second HTTP client.',
  },
  {
    file: 'lib/stripe/client.js',
    construct: 'stripe transport import',
    count: 1,
    line: /^import \{ fetchTransport \} from '\.\/transport\.js';$/,
    reason: 'AS-38: only the client may reach the transport; routes and services call the client.',
  },
];

/** Scan every file in SCANNED for `patterns`. Detection is whole-text against
 *  the stripped file (so `fetch\n(` cannot hide from a line-oriented scan);
 *  localisation is per match — each hit is mapped to the 1-based line it starts
 *  on, and that line is what a SANCTIONED entry's `line` is tested against. A
 *  hit is sanctioned only when file, construct AND line all match one entry;
 *  every other hit is a finding.
 *  @returns {{ findings: string[], seen: number[] }} findings, and per
 *  SANCTIONED entry how many hits it absorbed. */
function scanForbidden(patterns) {
  const seen = SANCTIONED.map(() => 0);
  const findings = [];
  for (const path of SCANNED) {
    const file = relative(APP_DIR, path);
    const code = strippedText(path);
    const lines = code.split('\n');
    for (const { name, pattern } of patterns) {
      const global = pattern.flags.includes('g') ? pattern : new RegExp(pattern.source, `${pattern.flags}g`);
      for (const match of code.matchAll(global)) {
        const lineNumber = code.slice(0, match.index).split('\n').length;
        const line = lines[lineNumber - 1];
        const entry = SANCTIONED.findIndex((s) => s.file === file && s.construct === name && s.line.test(line));
        if (entry === -1) {
          findings.push(
            `${file}:${lineNumber}: ${name} — not sanctioned — ${line.trim()} — remove it, or if it is ` +
              'genuinely not an outbound client add a SANCTIONED entry with a reason',
          );
        } else {
          seen[entry] += 1;
        }
      }
    }
  }
  return { findings, seen };
}

test('every sanctioned construct is present exactly where it is declared', () => {
  // Cardinality first: adding a sanction is a deliberate two-line change — the
  // entry, and this literal.
  assert.equal(SANCTIONED.length, 3, `expected 3 SANCTIONED entries, found ${SANCTIONED.length}`);
  const { seen } = scanForbidden(OUTBOUND_CLIENTS);
  SANCTIONED.forEach((entry, i) => {
    const key = `SANCTIONED entry ${entry.file} / ${entry.construct}`;
    // "Documented" is enforced, not hoped for.
    assert.ok(typeof entry.reason === 'string' && entry.reason.trim().length > 0, `${key} carries no reason`);
    assert.ok(Number.isInteger(entry.count) && entry.count > 0, `${key} must sanction a positive number of hits, not ${entry.count}`);
    // Exactly `count`: fewer means the allowlist outlived what it sanctioned;
    // more means a new hit is hiding behind an old justification.
    const remedy = seen[i] < entry.count
      ? 'the entry is stale: remove it, or restore what it sanctioned'
      : 'the entry is over-used: a new hit is hiding behind it — remove the hit, or sanction it separately with its own reason';
    assert.equal(seen[i], entry.count, `${key} matched ${seen[i]} line(s), expected ${entry.count} — ${remedy}`);
  });
});

test('no app source or manifest outside test/ contains an outbound HTTP client', () => {
  // The custody chokepoint depends on there being exactly one place that talks
  // to the wire, and exactly one place that reaches it. Every unsanctioned hit
  // here is a finding, reported as `file:line: construct`.
  const { findings } = scanForbidden(OUTBOUND_CLIENTS);
  assert.deepEqual(findings, [], `outbound HTTP client in app source or manifest: ${findings.join('; ')}`);
});

/** Where a concept is allowed to appear, it must appear there (V2: an unused
 *  exemption is a hole waiting for a tenant) and nowhere else.
 *
 *  `only` narrows the scanned set to the files whose repo-relative path matches
 *  (AS-45: the view-layer rows are lexical properties of TEMPLATES and
 *  STYLESHEETS, and two of their patterns have false positives in JavaScript —
 *  `\son[a-z]+\s*=` matches ` once =`). Narrowing the SET is safe in a way
 *  narrowing a PATTERN is not, and it carries its own cardinality check:
 *  `expectFiles` is the COMMITTED number of files the scoped set must contain
 *  (AS-70, the B5 debt from AS-45's review). A `> 0` floor could not tell
 *  "examined 1 of 3 files" from "examined 3" — with a second template, the
 *  committed count is cheaper than the argument. A scoped row without
 *  `expectFiles` is refused: a floor is not a count. */
function scanConcept(name, pattern, allowed, { raw = false, only = null, expectFiles = null } = {}) {
  const files = only === null ? SCANNED : SCANNED.filter((p) => only.test(relative(APP_DIR, p)));
  if (only !== null) {
    assert.ok(Number.isInteger(expectFiles) && expectFiles > 0, `${name}: a scoped row must commit to a file count (expectFiles), not a floor`);
    assert.equal(files.length, expectFiles, `${name}: examined ${files.length} files, expected ${expectFiles} — a template or stylesheet was added, removed, or fell outside the scope`);
  }
  const hits = files
    .filter((p) => pattern.test(raw ? readFileSync(p, 'utf8') : strippedText(p)))
    .map((p) => relative(APP_DIR, p))
    .sort();
  assert.deepEqual(hits, [...allowed].sort(), `${name}: found in [${hits.join(', ')}], allowed in exactly [${allowed.join(', ')}]`);
}

// --- AS-45: the view layer's raw-output gate ---------------------------------
//
// EJS has exactly two output tags: one escapes the five HTML characters, the
// other does not. Relying on "we use the escaping one" is relying on every
// author, forever, remembering to. So the non-escaping tag is banned as a
// LEXICAL PROPERTY of the scanned set — property P1 (README.md § The view
// layer) — and the ban is absolute today.
//
// It is not a blanket ban, because lib/contracts/render.js's header already
// commits AS-47 to emitting a rendered contract with raw output exactly once,
// inside the document region. A blanket ban would either block that task or be
// quietly widened by whoever hit it. So raw output is GATED by the same
// instrument as SANCTIONED above — keyed on file + the WHOLE line the hit must
// sit on + how many hits it may absorb — and AS-45 lands it with ZERO entries,
// on a MEASURED baseline of zero (the single occurrence in the tree,
// lib/health.js:80, is inside a `//` comment that stripComments removes).
//
// AS-47's one raw-output site IS the first entry: reviewed on its own merits,
// pinned to one exact line, and unable to sanction a second occurrence. The
// line regex anchors BOTH ends, so a second expression sharing the line
// un-sanctions it, and `count: 1` means a verbatim duplicate on the next line
// is reported as over-use. The dynamic half — a stored description containing
// markup, driven through the real generate and counted in the served bytes —
// is test/contract-screens.test.js's.
const RAW_OUTPUT_SANCTIONED = [
  {
    file: 'views/contract-detail.ejs',
    count: 1,
    line: /^\s*<%- renderedHtml %>$/,
    reason: 'AS-47: the stored contract document (lib/contracts/render.js) is emitted once, inside the document region. Every text node in it went through render.js\'s one escapeHtml and no data reaches an attribute position there; it is safe in element content and nowhere else, which is the only position this line puts it in. The line regex is the WHOLE line, so nothing else can share it.',
  },
];

/** The non-escaping EJS output tag. Spelled literally: test/ is outside the
 *  walker's world (SKIPPED_DIRS), so this file cannot be its own first hit. */
const RAW_OUTPUT_TAG = /<%-/g;

/** Same shape as scanForbidden, for the one construct whose allowlist is
 *  separate. @returns {{ findings: string[], seen: number[] }} */
function scanRawOutput() {
  const seen = RAW_OUTPUT_SANCTIONED.map(() => 0);
  const findings = [];
  for (const path of SCANNED) {
    const file = relative(APP_DIR, path);
    const code = strippedText(path);
    const lines = code.split('\n');
    for (const match of code.matchAll(RAW_OUTPUT_TAG)) {
      const lineNumber = code.slice(0, match.index).split('\n').length;
      const line = lines[lineNumber - 1];
      const entry = RAW_OUTPUT_SANCTIONED.findIndex((s) => s.file === file && s.line.test(line));
      if (entry === -1) {
        findings.push(
          `${file}:${lineNumber}: EJS raw output — not sanctioned — ${line.trim()} — every interpolation `
            + 'must be escaped; if this one genuinely must not be, add a RAW_OUTPUT_SANCTIONED entry pinned '
            + 'to this exact line, with a reason',
        );
      } else {
        seen[entry] += 1;
      }
    }
  }
  return { findings, seen };
}

// --- AS-45: P4, the TAG-NAME and ATTRIBUTE-NAME positions -------------------
//
// EJS escapes exactly five characters — & < > " ' — and does NOT escape `=` or
// a space. So an interpolation that sits between attributes, rather than inside
// an attribute VALUE, renders a user-supplied string as markup STRUCTURE:
//
//     <span class="app-label" INTERPOLATION>
//
// with a submitted value of `x onmouseover=alert(1)` becomes a live event
// handler. Demonstrated by agent:qa-priya against a container built from a
// mutated image during review cycle 1, with P1, P2a, P2b, P2c and P3 all green:
// P2b scans template SOURCE for an on*= attribute, and at source time the text
// is an EJS output tag — the dangerous attribute exists only at render time.
// P2a and P3 police attribute VALUES. Nothing policed the position where an
// attribute NAME goes. It is not exploitable today (no template does this); the
// finding is the WRITTEN GUARANTEE README.md § The view layer hands to AS-46,
// AS-47 and AS-48, which claimed the position was covered.
//
// P4 — WITHIN ANY START TAG, EVERY EJS OUTPUT TAG SITS INSIDE AN ATTRIBUTE
// VALUE. An output tag anywhere in the tag's name-or-attribute-name region is
// forbidden, and BOTH HALVES ARE ENFORCED — which they were not when this row
// first landed. The attribute-name half is enforced by the in-tag walk below.
// The tag-name half is enforced by an explicit TAG-START RULE, stated here in
// the same breath as the property because the gap between the English and the
// algorithm is exactly what review cycle 2 found: a `<` immediately followed by
// an EJS open tag opens a start tag whose NAME is interpolated, and is a
// FINDING rather than text. The CLOSING-tag name region (a closing tag whose
// name is interpolated) is covered too, by the same in-tag walk, because a
// closing tag's two-character opener begins a scanned tag region.
//
// FINDING F-A, so the reason survives: the first version of this row treated a
// `<` followed by an EJS open tag as ordinary text, because `<` is not in its
// tag-start character class. Planting `<INTERPOLATION class="app-label">`
// produced NO finding with all four lexical rows green, and a container built
// from that image served `<div onmouseover=alert(1) autofocus …>` out of a
// submitted value — no angle bracket and no quote required. The property was
// stated more widely than the mechanism enforced it. Ruling R-6: the mechanism
// comes up to meet the property, and the property is not narrowed.
//
// IT IS SOUND *BECAUSE P3 HOLDS*, and that dependency is the whole design — the
// same shape as §3.2's stylesheet scope being sound because P2a and P2c hold.
// The scan walks each file left to right and skips quoted spans, so a `>` or a
// `<%` inside an attribute value is harmless. Skipping SINGLE-quoted spans
// would hide an interpolation inside one — except P3 already forbids exactly
// that, so the two rows partition the space with nothing between them.
//
// LEXICAL, and it inherits P1-P3's stated limit: it does not stop a route from
// res.send-ing a hand-built string, and it does not stop a view model from
// computing markup. The dynamic half is the falsification recipe, not this row.
//
// CARDINALITY BEFORE QUANTIFICATION, and it is not decoration here. The
// instrument that can silently narrow this scan is THIS ROW'S OWN WALKER. The
// walk skips quoted spans ONLY INSIDE A TAG REGION, so the placement that opens
// a runaway span is an apostrophe that sits INSIDE A TAG REGION AND OUTSIDE A
// QUOTED VALUE — `<span ' class="app-label">`. It opens a span that runs to the
// next apostrophe anywhere in the file, and every tag between them goes
// unexamined. Committing the START TAG COUNT makes that failure loud instead of
// vacuous, and it does: planting exactly that construct in views/signin.ejs
// collapses the 87 examined start tags to 14 and this assertion fires first.
//
// MEASURED 2026-09-07 by developer-lena, at the placement this sentence
// describes, not transcribed: `<span class="app-label">` -> `<span ' class=
// "app-label">` in a scratch extract, then the row run — it reported
// `P4 examined 14 start tags across 1 template(s), expected 87`. The number
// beside a sentence must be reproducible from that sentence; 14 is.
//
// TWO PLACEMENTS THAT DO *NOT* COLLAPSE IT, measured the same way, because the
// wrong one was published twice (findings F-B and F-G) and cost two cycles:
// an apostrophe in ELEMENT CONTENT (`>Don't panic</span>`) holds the count at
// 87 and the suite green — element content is never scanned for quotes at all —
// and so does an apostrophe INSIDE a double-quoted attribute value. Prose copy
// carrying an apostrophe is NOT a hazard here, and a template author should not
// be avoiding one.
//
// THERE IS NO BUG IN stripComments — DO NOT GO LOOKING FOR ONE (finding F-B).
// This paragraph used to claim that the stripper treats an apostrophe in element
// content as a string delimiter and would swallow the rest of the file. It does
// not: its quote branch appends every character it consumes, so its output is
// byte-for-byte its input, measured directly on a file carrying all three
// hazards. P1-P3 are not narrowed by an apostrophe in element content at all.
// Right instinct, wrong instrument.
const VIEW_FILES = /^views\//;

/** The number of start tags P4 examines across views/. Measured at the moment
 *  the template was finished, written down after the grep, and moved
 *  deliberately when a template gains or loses an element. A scan that suddenly
 *  examines fewer tags is examining less than it says it is.
 *
 *  MEASURED 2026-09-03, three instruments agreeing on views/signin.ejs: this
 *  scan reported 87; `perl -0777 -ne 's/<%#.*?%>//gs; $n++ while /<[A-Za-z!\/]/g'`
 *  reported 87; `grep -oE '</?[A-Za-z]' | wc -l` reported 86, which is 87 less
 *  the `<!doctype` its character class cannot see. Closing tags are counted
 *  too: they carry no attributes, so scanning them costs nothing and excluding
 *  them would be a second rule to get wrong.
 *
 *  RE-MEASURED 2026-09-12 (AS-70), the same three instruments on
 *  views/connect-stripe.ejs: 43 / 43 / 42 (+1 doctype). signin.ejs re-run
 *  alongside still reads 87 / 87 / 86. The constant is the SUM over views/.
 *  Deleting one banner branch from screen 2 (a div and a p, open and
 *  close) moves it by 4, which is how the partition case's falsifier reaches
 *  this row too.
 *
 *  RE-MEASURED 2026-09-12 (AS-46, at the rebase onto AS-70's merge) with
 *  views/invoice-form.ejs in the set: this scan reported 87 + 43 + 202 across
 *  the three templates — 202 for invoice-form.ejs — written down after the
 *  run, never before. Re-measured again at AS-46's review cycle 1: the client
 *  error slot in the add-new branch (a div and a span, open and close) moved
 *  invoice-form.ejs to 206; the scan reported 336 and this line followed it.
 *  RE-MEASURED 2026-09-12 (AS-47, at the rebase onto AS-46's merge), the same
 *  three instruments on views/contract-detail.ejs: 58 / 58 / 57 (+1 doctype)
 *  — two fewer than its first measurement (60) after the "New contract" nav
 *  anchor moved to AS-127 with its route: the scan counts the open AND the
 *  close tag, so one removed anchor moves it by 2.
<<<<<<< HEAD
 *
 *  RE-MEASURED 2026-09-12 (AS-48, at the rebase onto AS-47's merge) with
 *  views/dashboard.ejs and views/invoice-detail.ejs in the set, and the nav
 *  obligations landed in the three existing chrome-bearing templates:
 *  connect-stripe.ejs 43 -> 47 (the Continue-to-Dashboard div + anchor, open
 *  and close), invoice-form.ejs 206 -> 208 (the Dashboard anchor),
 *  contract-detail.ejs 58 -> 64 (the Dashboard anchor, +2, and NOTFOUND's
 *  `<p><a>Back to Dashboard</a></p>`, +4), dashboard.ejs 131,
 *  invoice-detail.ejs 101 — the same instrument, calibrated against the
 *  committed numbers above before it was read on the new files, then confirmed
 *  by the run. The constant is the SUM over views/, in declaration order.
 *
 *  RE-MEASURED 2026-09-12 (AS-127, at the rebase onto AS-48's merge) with
 *  views/contract-form.ejs in the set (185: its own chrome including the
 *  Dashboard anchor) and the "New contract" nav anchor on the four
 *  chrome-bearing templates (+2 each, open and close): invoice-form.ejs
 *  208 -> 210, contract-detail.ejs 64 -> 66, invoice-detail.ejs 101 -> 103,
 *  dashboard.ejs 131 -> 135 (the nav anchor and the first-run contract CTA
 *  anchor) — predicted before the run, then read off it. */
const VIEW_START_TAGS = 87 + 47 + 210 + 66 + 135 + 103 + 185;

const lineAt = (text, index) => text.slice(0, index).split('\n').length;

/** @returns {{ findings: string[], tags: number, files: number }} */
function scanAttributeNamePosition() {
  const findings = [];
  const files = SCANNED.filter((path) => VIEW_FILES.test(relative(APP_DIR, path)));
  let tags = 0;
  for (const path of files) {
    const file = relative(APP_DIR, path);
    const code = strippedText(path);
    let i = 0;
    while (i < code.length) {
      if (code[i] !== '<') { i += 1; continue; }
      // An EJS tag in ELEMENT CONTENT is not a start tag. Skip the whole tag,
      // so a `<` or `>` inside the expression cannot be mistaken for markup.
      if (code.startsWith('<%', i)) {
        const close = code.indexOf('%>', i);
        i = close === -1 ? code.length : close + 2;
        continue;
      }
      // TAG-NAME POSITION (review cycle 2, ruling R-6). A `<` immediately
      // followed by an EJS open tag is not text: at render time it opens ONE
      // start tag whose NAME came out of the expression. It is COUNTED as a
      // start tag for that reason — the construct does not move the committed
      // cardinality, so the findings assertion below is the sole detector and
      // fires on its own merits. Scanning then continues through the rest of
      // the tag region, so a second violation inside the same tag also reports.
      const tagNamed = code.startsWith('<%', i + 1);
      if (tagNamed) {
        const close = code.indexOf('%>', i + 1);
        findings.push(
          `${file}:${lineAt(code, i)}: EJS interpolation in TAG-NAME position — `
            + `${code.slice(i + 1, close === -1 ? code.length : close + 2)} — `
            + 'the element NAME comes out of the expression, so a submitted value renders as markup '
            + 'STRUCTURE here; an element name must be a literal',
        );
        tags += 1;
        i = close === -1 ? code.length : close + 2;
      } else {
        // A `<` followed by anything that cannot begin a tag name is text.
        if (!/[A-Za-z!/]/.test(code[i + 1] ?? '')) { i += 1; continue; }
        tags += 1;
        i += 1;
      }
      while (i < code.length && code[i] !== '>') {
        if (code[i] === '"' || code[i] === "'") {
          const quote = code[i];
          const close = code.indexOf(quote, i + 1);
          if (close === -1) {
            findings.push(`${file}:${lineAt(code, i)}: unterminated ${quote} attribute value — the tag scan cannot be trusted past here`);
            i = code.length;
            break;
          }
          i = close + 1;
          continue;
        }
        if (code.startsWith('<%', i)) {
          findings.push(
            `${file}:${lineAt(code, i)}: EJS interpolation in ATTRIBUTE-NAME position — ${code.slice(i, code.indexOf('%>', i) + 2)} — `
              + 'EJS does not escape `=` or a space, so a submitted value renders as markup STRUCTURE here; '
              + 'move it inside a double-quoted attribute value',
          );
          const close = code.indexOf('%>', i);
          i = close === -1 ? code.length : close + 2;
          continue;
        }
        i += 1;
      }
      i += 1;
    }
  }
  return { findings, tags, files: files.length };
}

test('the concepts live exactly where AS-38, AS-39, AS-40, AS-41, AS-42, AS-43, AS-44, AS-45, AS-46 and AS-47 put them', () => {
  // The `stripe` npm module is banned everywhere, permanently: `new Stripe(key)`
  // is the documented bypass of the custody guard (stack decision §8.1).
  scanConcept('stripe module import', /(from|require\s*\(|import\s*\()\s*['"]stripe['"]/, []);
  // The key's NAME appears in exactly three places: where compose passes it
  // through, where config resolves it, and where the client says it is missing.
  scanConcept('STRIPE_ config key', /STRIPE_[A-Z_]+/, ['compose.yaml', 'lib/config.js', 'lib/stripe/client.js']);
  // The forbidden-parameter table is the only place the fee rail is even named.
  scanConcept('application_fee', /application_fee/, ['lib/stripe/custody.js']);
  // AS-44's webhook route, landed: exactly one file may name the path Stripe
  // is configured to POST to, so the app.js mount line carries no path string
  // and a second endpoint cannot appear quietly. The used-exemption rule cuts
  // both ways — renaming the path in routes/webhooks.js fails this row too.
  scanConcept('/webhook route', /['"]\/webhook/, ['routes/webhooks.js']);
  // THE RAW-BODY GUARD, made mechanical (AS-44). AS-43 mounts its parser per
  // route and AS-44's signature verification depends on nothing upstream
  // touching the bytes. An app-wide express.json() in app.js is a red test, not
  // a review catch.
  // AS-42 adds routes/contracts.js: its form parser is mounted PER ROUTE for
  // exactly the reason this row exists. Widening the row is the only way to
  // mount a parser at all; what the row actually guards — no app-wide parser
  // in app.js — is unchanged, and app.js is still not a member.
  // AS-65 adds routes/clients.js on the same terms: its form parser is
  // mounted PER ROUTE for exactly the reason this row exists, and app.js is
  // still not a member.
  scanConcept('body parser', /express\.(json|urlencoded|raw|text)\s*\(/, ['routes/auth.js', 'routes/clients.js', 'routes/contracts.js', 'routes/invoices.js', 'routes/webhooks.js']);
  // ONE verifier, not two. Measured before AS-44: zero hits anywhere. A second,
  // home-rolled comparison in the route or the receiver is the `new Stripe(key)`
  // of this boundary.
  //
  // SPLIT BY AS-40, AND THIS IS NOT A WEAKENING. createHmac stays pinned to
  // exactly one file, so the row's stated purpose — ONE verifier — is carried
  // entirely by that half, and AS-44's own falsification recipe still works byte
  // for byte. The second half is a NARROWER row than the original disjunction:
  // it names the two files that may compare a secret in constant time, and it
  // keeps the used-exemption property in both directions. AS-40 needs
  // timingSafeEqual for password verification and must not be able to borrow
  // createHmac by sharing a row with it.
  scanConcept('webhook signature HMAC', /\bcreateHmac\b/, ['lib/webhooks/signature.js']);
  scanConcept('constant-time compare', /\btimingSafeEqual\b/, ['lib/auth/password.js', 'lib/webhooks/signature.js']);
  // ONE state machine. AS-43 and AS-44 both call applyStripeSnapshot; neither
  // may reimplement the ranking that decides which snapshot wins.
  scanConcept('invoice status rank', /STATUS_RANK/, ['lib/db/repositories/invoices.js']);
  // The platform-scoped Stripe calls (AS-41). The custody guard already
  // requires `platform: true` at every platform call site (custody.js
  // checkScope) — this row pins WHERE those declarations may exist, so a
  // Stripe call creeping into a route or a second service module is a red
  // test, not a review catch. Stripped text: custody.js and client.js mention
  // the construct only in comments, and client.js's own meta line reads
  // `platform: call.platform === true`, which the pattern does not match.
  // The used-exemption rule cuts both ways: an onboarding.js that stopped
  // calling Stripe would fail this row too.
  scanConcept('platform Stripe call', /platform:\s*true/, ['lib/connect/onboarding.js']);
  // The database (AS-39). `node:sqlite` is imported in exactly one file — the
  // connection module — so the driver has one seam to change and one place to
  // stub (stack decision §5.3 chokepoint corollary). A repository that imports
  // it directly is the `new Stripe(key)` of the persistence layer.
  scanConcept('node:sqlite', /(from|require\s*\(|import\s*\()\s*['"]node:sqlite['"]/, ['lib/db/connection.js']);
  // Raw SQL text lives in exactly twelve files: the connection module (its
  // PRAGMAs), the migration runner (its ledger), the two migrations, and the
  // eight repositories under lib/db/repositories/ — the only modules that turn
  // a method into a statement. database.js composes those without a byte of SQL,
  // and health.js/server.js/routes never see any. Stripped text, so a comment
  // that quotes SQL does not count.
  scanConcept(
    'raw SQL',
    /\b(SELECT\s+[\w*(),. ]+\s+FROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+(TABLE|INDEX|UNIQUE)|PRAGMA)\b/,
    [
      'lib/db/connection.js',
      'lib/db/migrate.js',
      'lib/db/migrations/0001-initial.js',
      'lib/db/migrations/0002-accounts.js',
      'lib/db/repositories/clients.js',
      'lib/db/repositories/connected-accounts.js',
      'lib/db/repositories/contracts.js',
      'lib/db/repositories/credentials.js',
      'lib/db/repositories/freelancers.js',
      'lib/db/repositories/invoices.js',
      'lib/db/repositories/sessions.js',
      'lib/db/repositories/stripe-events.js',
    ],
  );
  // Money is AS-39's: integer minor units with an explicit currency column. The
  // schema that declares those columns, money.js (the supported-currency set and
  // the minor-unit validators — the ONE place a currency code is spelled out),
  // and the invoices repository (the only one with an amount or a currency in
  // its rows) are the database files allowed to say so; the other five
  // repositories and database.js never touch the words. The custody table is
  // exempt because its citations quote Stripe's own parameter names
  // (application_fee_amount) and reasons — and it MUST match there, or the
  // exemption is stale. AS-43 adds the three files that carry a line total onto
  // the wire and back: the lifecycle builds each item's extended amount, the
  // mapper maps amount_due/amount_paid, and the route parses unitAmountMinor.
  // app.js is deliberately NOT among them — the mount line and its comment are
  // money-word-free, and that is a claim this row checks. Everything else,
  // client.js and transport.js included, stays clear of the words even in
  // comments (RAW text, not stripped). AS-46 adds ONE member: screen 4's view
  // model is the human-to-minor-units boundary — it imports both conversions
  // from money.js and is the only place that knows the form's unitPrice is the
  // repository's unitAmountMinor. NOT added, and measured to stay clear
  // (comments included): views/invoice-form.ejs and public/app.css, which
  // receive formatted strings and a priceLabel built in the view model.
  // AS-48 adds TWO members on the same terms: the Dashboard and invoice-detail
  // view models read each row's total and currency and are the only callers of
  // money.js's display formatter — the human boundary for DISPLAY, as screen
  // 4's is for input. NOT added, and measured to stay clear (comments
  // included): views/dashboard.ejs, views/invoice-detail.ejs, routes/pages.js,
  // routes/contracts.js and lib/screens/dates.js — the templates receive the
  // column header and the label as locals (`totalLabel`).
  scanConcept(
    'money representation',
    /amount|currency|money/i,
    [
      'lib/db/migrations/0001-initial.js',
      'lib/db/money.js',
      'lib/db/repositories/invoices.js',
      'lib/invoices/lifecycle.js',
      'lib/invoices/mapping.js',
      'lib/screens/dashboard-view.js',
      'lib/screens/invoice-detail-view.js',
      'lib/screens/invoice-form-view.js',
      'lib/stripe/custody.js',
      'routes/invoices.js',
    ],
    { raw: true },
  );
  // --- AS-40: the accounts boundary -----------------------------------------
  // Each of these landed on a MEASURED baseline of zero files, so each is a
  // used exemption from the moment it ships and cannot quietly decay into a
  // hole waiting for a tenant.
  //
  // ONE KDF, in one file. scryptSync is in the pattern deliberately: it is the
  // spelling that would block the event loop for ~40 ms per sign-in, and the
  // row makes reaching for it visible. pbkdf2 is here because swapping the KDF
  // is a decision (plan §3.2.2), not a diff.
  //
  // The trailing (?!\$) excludes the STORED FORMAT PREFIX 'scrypt$', which the
  // migration's CHECK constraint and the credentials repository's assertion both
  // spell out and neither of which is a call — `$` cannot follow an identifier
  // in one. The alternative was to allowlist those two files, and that would be
  // strictly worse: it would let a real KDF call hide in either of them. Narrow
  // the pattern, never the allowlist.
  scanConcept('password KDF', /\b(scrypt|scryptSync|pbkdf2|pbkdf2Sync)\b(?!\$)/, ['lib/auth/password.js']);
  // Randomness for a secret comes from exactly two places: the salt and the
  // session token. A third site is either a third secret or a mistake.
  scanConcept('random bytes', /\brandomBytes\b/, ['lib/auth/password.js', 'lib/auth/session.js']);
  // The session token is stored as its digest and never in the clear; the file
  // that mints the token is the only one that may compute it.
  scanConcept('session token digest', /\bcreateHash\b/, ['lib/auth/session.js']);
  // ONE place sets or reads the cookie. A second minting site is a second
  // session mechanism, and a second reader is a parser that can disagree.
  scanConcept('session cookie', /\bres\.cookie\b|\bclearCookie\b|\breq\.headers\.cookie\b/, ['lib/auth/session.js']);
  // THE IMPERSONATION GUARD. req.currentUser belongs to the guard alone, so no
  // route module can read it directly and skip actingFreelancerId's assertion —
  // which is what turns "this handler is behind the boundary" from a comment
  // into a loud 500 when it is not.
  scanConcept('current user', /\breq\.currentUser\b/, ['lib/auth/guard.js']);
  // --- AS-42: the contract renderer -----------------------------------------
  // ONE ESCAPER, in one file. Every text node of a rendered contract —
  // template-authored and user-supplied alike — goes through escapeHtml, so
  // there is no raw-output path an author could reach for. A second escaper
  // anywhere (in the route, in the generation service, in a future screen
  // helper) is the `new Stripe(key)` of this boundary: two implementations that
  // can disagree about what is safe. MEASURED BASELINE BEFORE THIS ROW: zero
  // occurrences of escapeHtml anywhere under apps/invoicing, so it is a used
  // exemption from the moment it ships. The used-exemption rule cuts both ways
  // — a render.js that stopped escaping would fail this row too.
  scanConcept('contract HTML escape', /\bescapeHtml\b/, ['lib/contracts/render.js']);
  // NOTHING IN THE ACCOUNTS PATH LOGS. The allowlist is the measured current
  // set, so "no logger exists in lib/auth/* or routes/auth.js" is mechanical
  // rather than a review catch — and the stdout/stderr capture in
  // test/auth.test.js is its dynamic half.
  scanConcept('console output', /\bconsole\.\w+/, ['lib/invoices/lifecycle.js', 'lib/webhooks/receiver.js', 'server.js']);
  // --- AS-45: the view layer's three escaping properties ---------------------
  // This is the first task in this app that renders HTML for a human, and the
  // three remaining screen tasks inherit whatever it decides. Each row below
  // landed on a MEASURED baseline of zero, run against the tree before the
  // number was written down, so each is a real property from the moment it
  // ships rather than a hole waiting for a tenant.
  //
  // P1 — THERE IS NO RAW-OUTPUT PATH. Not a plain scanConcept row: raw output
  // is gated by a keyed, counted, line-pinned allowlist (above), because AS-47
  // has a committed need for exactly one sanctioned site. Cardinality on the
  // allowlist FIRST — a row that quantified over an unread allowlist would pass
  // on anything.
  assert.equal(
    RAW_OUTPUT_SANCTIONED.length,
    1,
    `expected 1 RAW_OUTPUT_SANCTIONED entry (AS-47's document region), found ${RAW_OUTPUT_SANCTIONED.length} — a second entry sanctions a second exact line and is a second deliberate, reviewable decision`,
  );
  const rawOutput = scanRawOutput();
  assert.deepEqual(rawOutput.findings, [], `EJS raw output: ${rawOutput.findings.join('; ')}`);
  RAW_OUTPUT_SANCTIONED.forEach((entry, i) => {
    assert.ok(typeof entry.reason === 'string' && entry.reason.trim().length > 0, `RAW_OUTPUT_SANCTIONED ${entry.file} carries no reason`);
    assert.ok(Number.isInteger(entry.count) && entry.count > 0, `RAW_OUTPUT_SANCTIONED ${entry.file} must sanction a positive number of hits, not ${entry.count}`);
    const remedy = rawOutput.seen[i] < entry.count
      ? 'the entry is stale: remove it, or restore what it sanctioned'
      : 'the entry is over-used: a second raw-output site is hiding behind it';
    assert.equal(rawOutput.seen[i], entry.count, `RAW_OUTPUT_SANCTIONED ${entry.file} matched ${rawOutput.seen[i]} line(s), expected ${entry.count} — ${remedy}`);
  });
  // P2a — NO INTERPOLATION WHERE ESCAPING IS NOT ENOUGH. EJS's five-character
  // escape is correct for element content and for a double-quoted attribute
  // value; it is NOT sufficient in a URL or a style context, where `javascript:`
  // and `expression(` need no angle bracket. Measured baseline before AS-45:
  // ONE hit, views/scaffold.ejs:38's `style="background: var(--…)"`, which is
  // why retiring the scaffold page was a precondition for this row rather than
  // housekeeping bundled alongside it. A path that must survive a round trip
  // (`next`) travels in a hidden value= input, never in a URL.
  //
  // THE MATCH IS CASE-FOLDED BECAUSE HTML'S IS (review cycle 3, finding F-F).
  // An HTML attribute name is case-insensitive, so `HREF=`, `Style=` and
  // `FormAction=` are the same attributes to a browser as `href=`, `style=` and
  // `formaction=`. Without the `i` flag this row saw only the lowercase
  // spellings and the property was stated more widely than the mechanism
  // enforced it — the third instance of that shape on this branch, after the
  // attribute-name position (F-3) and the tag-name position (F-A). The flag
  // landed on a re-measured baseline of ZERO hits across the scoped set.
  //
  // THE FIVE NAMES ARE A CLOSED ENUMERATION, not a category (reviewer's bounded
  // observation, review cycle 3). URL-bearing attributes are not five: `srcset`,
  // `poster`, `ping`, `xlink:href` and `<object data=>` all take a URL and none
  // is in the alternation. That is a BOUND honestly presented as one — no
  // template uses any of them — and not a false sentence. A template that ever
  // needs one of them adds it HERE, in the same commit.
  scanConcept(
    'interpolation in a URL or style attribute',
    /(href|src|action|formaction|style)\s*=\s*"[^"]*<%/i,
    [],
    { only: /^(views|public)\//, expectFiles: 8 },
  );
  // P2b — no event-handler attribute. Scoped to templates and stylesheets: the
  // pattern matches ` once =` in JavaScript, and narrowing the pattern to avoid
  // that would be narrowing the thing that catches a real ` onclick=`.
  //
  // CASE-FOLDED FOR THE SAME REASON AS P2a, and this is the row F-F was found
  // on: `ONMOUSEOVER="alert(1)"` is a live event handler that this row, written
  // `[a-z]` with no flag, could not see — and the payload `alert(1)` contains
  // none of the five characters EJS escapes, so the escape is a no-op against
  // it. P2c three lines below always carried `/i`; the omission here and on P2a
  // was an oversight, not a decision. Re-measured baseline after the flag: ZERO.
  scanConcept('event-handler attribute', /\son[a-z]+\s*=/i, [], { only: /^(views|public)\//, expectFiles: 8 });
  // P2c — THE NO-CLIENT-SIDE-JAVASCRIPT ASSUMPTION, MADE MECHANICAL. Two ledger
  // rows (S1-LOADING, S2-LOADING) are unimplementable under it and are recorded
  // as `unrenderable — browser-supplied` rather than silently skipped. This row
  // is what stops the assumption decaying into a comment.
  scanConcept('script or style element', /<(script|style)\b/i, [], { only: /^(views|public)\//, expectFiles: 8 });
  // P3 — an attribute value that carries data is DOUBLE-quoted, because
  // escaping `"` is only load-bearing if `"` is the delimiter. This row catches
  // the two spellings that break that: a single-quoted value, and an unquoted
  // one.
  scanConcept(
    'interpolation in an unquoted or single-quoted attribute value',
    /=\s*'[^']*<%|=\s*<%/,
    [],
    { only: /^(views|public)\//, expectFiles: 8 },
  );
  // P4 — NO INTERPOLATION IN THE TAG-NAME OR ATTRIBUTE-NAME REGION (review
  // cycle 1, F-3; the tag-name half added by review cycle 2, ruling R-6).
  // Scoped to views/ alone rather than views/ + public/: a stylesheet has no
  // start tags, so including it would add only false-positive surface (`a > b`)
  // and no coverage. Cardinality on the instrument FIRST — a walker whose in-tag
  // quote skipping has run away examines a collapsed number of tags and must be
  // red, not green. And note what the cardinality deliberately does NOT do: an
  // interpolated tag name is counted as a start tag, so planting one leaves this
  // number unmoved and the findings assertion is the only thing that can catch it.
  const attrName = scanAttributeNamePosition();
  // A COMMITTED COUNT, not a `> 0` floor (AS-70, B5): seven templates today —
  // signin.ejs, connect-stripe.ejs, invoice-form.ejs (AS-46), contract-detail.ejs
  // (AS-47), dashboard.ejs and invoice-detail.ejs (AS-48), contract-form.ejs
  // (AS-127). The next screen moves this with its VIEWS row.
  assert.equal(attrName.files, 7, `P4 examined ${attrName.files} template(s) under views/, expected 7`);
  assert.equal(
    attrName.tags,
    VIEW_START_TAGS,
    `P4 examined ${attrName.tags} start tags across ${attrName.files} template(s), expected ${VIEW_START_TAGS} — `
      + 'a template gained or lost an element, or the scan is seeing less of a file than it should',
  );
  assert.deepEqual(attrName.findings, [], `interpolation in the tag-name or attribute-name region: ${attrName.findings.join('; ')}`);
});

test('no file in apps/invoicing exceeds 1,200 lines', () => {
  // Stack decision §10.4 item 1, trigger T7 — the measured size of
  // apps/chat/public/app.js. At scaffold size this is not close; it is checked
  // anyway, because it is the check nobody runs until it is too late.
  const oversized = [];
  // test/ is skipped by the walker above, so it gets its own walk here — the
  // limit applies to test files too (same source-extension filter as before).
  for (const path of [...SCANNED, ...classifyTree(join(APP_DIR, 'test')).source]) {
    const lines = readFileSync(path, 'utf8').split('\n').length;
    if (lines > 1200) oversized.push(`${relative(APP_DIR, path)} (${lines})`);
  }
  assert.deepEqual(oversized, []);
});
