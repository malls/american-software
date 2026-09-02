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
 *  node_modules/ is the lockfile's job. */
const SKIPPED_DIRS = new Set(['node_modules', 'test', 'vendor']);

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
  assert.equal(source.length, 32, `expected 32 app source files, found ${source.length}: ${source.join(', ')}`);
  assert.deepEqual(source, [
    'app.js',
    'lib/config.js',
    'lib/connect/onboarding.js',
    'lib/connect/readiness.js',
    'lib/db/connection.js',
    'lib/db/database.js',
    'lib/db/errors.js',
    'lib/db/migrate.js',
    'lib/db/migrations/0001-initial.js',
    'lib/db/money.js',
    'lib/db/repositories/clients.js',
    'lib/db/repositories/connected-accounts.js',
    'lib/db/repositories/contracts.js',
    'lib/db/repositories/freelancers.js',
    'lib/db/repositories/invoices.js',
    'lib/db/repositories/stripe-events.js',
    'lib/health.js',
    'lib/invoices/lifecycle.js',
    'lib/invoices/mapping.js',
    'lib/stripe/client.js',
    'lib/stripe/custody.js',
    'lib/stripe/transport.js',
    'lib/vendor.js',
    'lib/views.js',
    'public/scaffold.css',
    'routes/assets.js',
    'routes/connect.js',
    'routes/health.js',
    'routes/invoices.js',
    'routes/pages.js',
    'server.js',
    'views/scaffold.ejs',
  ]);

  // 4. Every scanned file survives its class's stripper.
  for (const path of SCANNED) {
    assert.ok(strippedText(path).trim().length > 0, `${relative(APP_DIR, path)} stripped to nothing — the stripper is broken`);
  }
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
 *  exemption is a hole waiting for a tenant) and nowhere else. */
function scanConcept(name, pattern, allowed, { raw = false } = {}) {
  const hits = SCANNED
    .filter((p) => pattern.test(raw ? readFileSync(p, 'utf8') : strippedText(p)))
    .map((p) => relative(APP_DIR, p))
    .sort();
  assert.deepEqual(hits, [...allowed].sort(), `${name}: found in [${hits.join(', ')}], allowed in exactly [${allowed.join(', ')}]`);
}

test('the Stripe concepts live exactly where AS-38, AS-39, AS-41 and AS-43 put them, and nothing AS-44 owns has leaked in', () => {
  // The `stripe` npm module is banned everywhere, permanently: `new Stripe(key)`
  // is the documented bypass of the custody guard (stack decision §8.1).
  scanConcept('stripe module import', /(from|require\s*\(|import\s*\()\s*['"]stripe['"]/, []);
  // The key's NAME appears in exactly three places: where compose passes it
  // through, where config resolves it, and where the client says it is missing.
  scanConcept('STRIPE_ config key', /STRIPE_[A-Z_]+/, ['compose.yaml', 'lib/config.js', 'lib/stripe/client.js']);
  // The forbidden-parameter table is the only place the fee rail is even named.
  scanConcept('application_fee', /application_fee/, ['lib/stripe/custody.js']);
  // AS-44's webhook route is not here yet.
  scanConcept('/webhook route', /['"]\/webhook/, []);
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
  // Raw SQL text lives in exactly nine files: the connection module (its
  // PRAGMAs), the migration runner (its ledger), the migrations themselves, and
  // the six repositories under lib/db/repositories/ — the only modules that turn
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
      'lib/db/repositories/clients.js',
      'lib/db/repositories/connected-accounts.js',
      'lib/db/repositories/contracts.js',
      'lib/db/repositories/freelancers.js',
      'lib/db/repositories/invoices.js',
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
  // comments (RAW text, not stripped).
  scanConcept(
    'money representation',
    /amount|currency|money/i,
    [
      'lib/db/migrations/0001-initial.js',
      'lib/db/money.js',
      'lib/db/repositories/invoices.js',
      'lib/invoices/lifecycle.js',
      'lib/invoices/mapping.js',
      'lib/stripe/custody.js',
      'routes/invoices.js',
    ],
    { raw: true },
  );
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
