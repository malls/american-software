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
  assert.equal(source.length, 11, `expected 11 app source files, found ${source.length}: ${source.join(', ')}`);
  assert.deepEqual(source, [
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
 *  loosen the pattern. */
const OUTBOUND_CLIENTS = [
  { name: 'fetch(', pattern: /\bfetch\s*\(/ },
  { name: 'http.request(', pattern: /\bhttps?\s*\.\s*request\s*\(/ },
  { name: "import 'node:http'", pattern: /(from|require\s*\()\s*['"]node:https?['"]/ },
  { name: 'axios', pattern: /(from|require\s*\()\s*['"]axios['"]/ },
  { name: 'undici', pattern: /(from|require\s*\()\s*['"]undici['"]/ },
  { name: 'curl', pattern: /\bcurl\b/ },
  { name: 'wget', pattern: /\bwget\b/ },
];

/** The allowlist. Keyed on file + construct + the WHOLE line a hit must sit on
 *  + how many hits it may absorb — never a bare file exclusion. Every entry
 *  must be used exactly `count` times (asserted below): a sanction that
 *  sanctions nothing is a hole waiting for a tenant, so the allowlist cannot
 *  outlive what it sanctions. AS-38 adds its legitimate call sites here, each
 *  with a reason, and the entry count literal in the test moves with it. */
const SANCTIONED = [
  {
    file: 'compose.yaml',
    construct: 'fetch(',
    count: 1,
    line: /^\s+test: \["CMD", "node", "-e", "fetch\('http:\/\/127\.0\.0\.1:8348\/healthz'\)/,
    reason:
      "the web service's compose healthcheck probes ITS OWN /healthz over loopback so " +
      'compose can learn the container is alive. It is a self-probe, not an outbound ' +
      'client: the target is pinned to 127.0.0.1:8348 by the line shape, so pointing it ' +
      'anywhere else, or moving the fetch( to another key, un-sanctions it.',
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
  assert.equal(SANCTIONED.length, 1, `expected 1 SANCTIONED entry, found ${SANCTIONED.length}`);
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
  // The custody chokepoint AS-38 will build depends on there being exactly one
  // place that talks to the wire. Every unsanctioned hit here is a finding.
  const { findings } = scanForbidden(OUTBOUND_CLIENTS);
  assert.deepEqual(findings, [], `outbound HTTP client in app source or manifest: ${findings.join('; ')}`);
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
  for (const path of SCANNED) {
    const code = strippedText(path);
    for (const { name, pattern } of forbidden) {
      if (pattern.test(code)) hits.push(`${relative(APP_DIR, path)}: ${name}`);
    }
  }
  assert.deepEqual(hits, [], `AS-38/AS-39 concepts in the scaffold: ${hits.join('; ')}`);
  // Money is AS-39's: integer minor units with an explicit currency column. A
  // scaffold that guessed a representation would have to be undone.
  assert.deepEqual(
    SCANNED.filter((p) => /amount|currency|money/i.test(readFileSync(p, 'utf8'))).map((p) => relative(APP_DIR, p)),
    [],
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
