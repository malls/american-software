// AS-94: guard for the launchd plist templates under apps/chat/watch/.
//
// Why this file exists: before AS-94 no test read either template. A template
// that rendered to nonsense — a stray placeholder the README's sed recipe does
// not substitute, a dropped </array>, a bind on 0.0.0.0 instead of loopback —
// would still "pass" every other test in the suite, and the failure would only
// surface on a host, at bootstrap, as a crash-looping launchd job.
//
// The templates and watch/README.md are COPY'd into the test image
// (Dockerfile: `COPY watch ./watch`), so this is an ordinary node:test file:
// it renders with FIXED placeholder values, parses the result with a
// deliberately narrow plist reader, and never touches the host, launchd, or a
// real path. `plutil -lint` is the host-side half of the same check (macOS
// only, not in the tick allowlist) — see watch/README.md "Lattice dashboard".
//
// Shape borrowed from test/deploy-shape.test.js: zero deps, a strict parser
// that throws rather than shrugs, and cardinality asserted before pass counts.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WATCH_DIR = path.join(HERE, '..', 'watch');
const README = path.join(WATCH_DIR, 'README.md');
const LABEL_PREFIX = 'com.american-software.';

// Fixed render values. The superset of every placeholder name used across the
// directory — each template uses a subset, and the leftover check below is
// what bites when a template grows one nobody told the recipe about.
const VALUES = {
  __REPO_ROOT__: '/checkout',
  __NODE_BIN__: '/opt/node/bin/node',
  __LATTICE_BIN__: '/opt/lattice/bin/lattice',
  __PATH__: '/opt/lattice/bin:/usr/bin:/bin',
};

const PLACEHOLDER_RE = /__[A-Z][A-Z0-9_]*__/g;

function templateFiles() {
  return fs
    .readdirSync(WATCH_DIR)
    .filter((f) => f.endsWith('.plist.template'))
    .sort();
}

function readTemplate(name) {
  return fs.readFileSync(path.join(WATCH_DIR, name), 'utf8');
}

function placeholdersOf(text) {
  return new Set(text.match(PLACEHOLDER_RE) || []);
}

// The exact substitution the README's `sed -e "s|__NAME__|value|g"` performs.
function renderTemplate(text, values) {
  let out = text;
  for (const [name, value] of Object.entries(values)) {
    out = out.split(name).join(value);
  }
  return out;
}

// --- the narrow plist reader ------------------------------------------------
//
// Accepts exactly the shape our templates use: one top-level <dict>; each
// <key> followed by exactly one of <string>, <true/>, <false/>, an <array> of
// <string>s, or a one-level <dict> of <key>/<string> pairs. Everything else
// throws with a message starting "plist:".

function decode(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function tokenize(text) {
  const tokens = [];
  const re = /<\/([A-Za-z][\w.-]*)\s*>|<([A-Za-z][\w.-]*)([^>]*?)(\/?)>|([^<]+)/g;
  let m;
  let consumed = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index !== consumed) throw new Error('plist: unparsable content at offset ' + consumed);
    consumed = m.index + m[0].length;
    if (m[1] !== undefined) tokens.push({ type: 'close', name: m[1] });
    else if (m[2] !== undefined) tokens.push({ type: m[4] === '/' ? 'self' : 'open', name: m[2] });
    else tokens.push({ type: 'text', value: m[5] });
  }
  if (consumed !== text.length) throw new Error('plist: unparsable trailing content');
  return tokens;
}

function parseFlatPlist(text) {
  // Strip XML comments, prolog and DOCTYPE before tokenizing.
  let body = text.replace(/<!--[\s\S]*?-->/g, '');
  body = body.replace(/<\?xml[\s\S]*?\?>/g, '');
  body = body.replace(/<!DOCTYPE[^>]*>/g, '');

  const openIdx = body.indexOf('<plist');
  if (openIdx === -1) throw new Error('plist: no <plist> element');
  const closeIdx = body.lastIndexOf('</plist>');
  if (closeIdx === -1) throw new Error('plist: unclosed <plist>');
  if (body.slice(closeIdx + '</plist>'.length).trim() !== '') {
    throw new Error('plist: trailing content after </plist>');
  }
  if (body.slice(0, openIdx).trim() !== '') throw new Error('plist: content before <plist>');
  const openEnd = body.indexOf('>', openIdx);
  if (openEnd === -1) throw new Error('plist: malformed <plist> tag');

  const tokens = tokenize(body.slice(openEnd + 1, closeIdx));
  const state = { i: 0, tokens };
  skipSpace(state);
  const value = parseDict(state, 0);
  skipSpace(state);
  if (state.i !== tokens.length) throw new Error('plist: unexpected content after the root <dict>');
  return value;
}

function skipSpace(state) {
  while (state.i < state.tokens.length) {
    const t = state.tokens[state.i];
    if (t.type !== 'text') return;
    if (t.value.trim() !== '') throw new Error('plist: unexpected text ' + JSON.stringify(t.value.trim()));
    state.i += 1;
  }
}

function expect(state, type, name) {
  const t = state.tokens[state.i];
  if (!t || t.type !== type || (name && t.name !== name)) {
    throw new Error(`plist: expected ${type} <${name || '?'}>, got ` + describe(t));
  }
  state.i += 1;
  return t;
}

function describe(t) {
  if (!t) return 'end of input';
  if (t.type === 'text') return 'text ' + JSON.stringify(t.value.trim());
  return `${t.type} <${t.name}>`;
}

function readText(state) {
  const t = state.tokens[state.i];
  if (t && t.type === 'text') {
    state.i += 1;
    return decode(t.value);
  }
  return '';
}

function parseDict(state, depth) {
  expect(state, 'open', 'dict');
  const out = {};
  for (;;) {
    skipSpace(state);
    const t = state.tokens[state.i];
    if (!t) throw new Error('plist: unclosed <dict>');
    if (t.type === 'close' && t.name === 'dict') {
      state.i += 1;
      return out;
    }
    if (t.type !== 'open' || t.name !== 'key') {
      throw new Error('plist: expected <key> inside <dict>, got ' + describe(t));
    }
    state.i += 1;
    const key = readText(state).trim();
    expect(state, 'close', 'key');
    if (key === '') throw new Error('plist: empty <key>');
    if (Object.prototype.hasOwnProperty.call(out, key)) {
      throw new Error('plist: duplicate <key> ' + JSON.stringify(key));
    }
    skipSpace(state);
    out[key] = parseValue(state, depth);
  }
}

function parseValue(state, depth) {
  const t = state.tokens[state.i];
  if (!t) throw new Error('plist: <key> with no value');
  if (t.type === 'self' && t.name === 'true') { state.i += 1; return true; }
  if (t.type === 'self' && t.name === 'false') { state.i += 1; return false; }
  if (t.type === 'open' && t.name === 'string') {
    state.i += 1;
    const value = readText(state);
    expect(state, 'close', 'string');
    return value;
  }
  if (t.type === 'open' && t.name === 'array') {
    if (depth > 0) throw new Error('plist: nested <array> is not supported');
    state.i += 1;
    const items = [];
    for (;;) {
      skipSpace(state);
      const n = state.tokens[state.i];
      if (!n) throw new Error('plist: unclosed <array>');
      if (n.type === 'close' && n.name === 'array') { state.i += 1; return items; }
      if (n.type !== 'open' || n.name !== 'string') {
        throw new Error('plist: <array> takes <string> items only, got ' + describe(n));
      }
      state.i += 1;
      items.push(readText(state));
      expect(state, 'close', 'string');
    }
  }
  if (t.type === 'open' && t.name === 'dict') {
    if (depth > 0) throw new Error('plist: <dict> nested more than one level deep');
    return parseDict(state, depth + 1);
  }
  throw new Error('plist: unsupported value ' + describe(t));
}

// --- the README install recipe ---------------------------------------------

// From watch/README.md, take the fenced `sh` block that both assigns
// LABEL=<label> and renders "$LABEL.plist.template", and return the set of
// __NAME__ tokens it substitutes with sed. Throws when no such block exists —
// a missing recipe must not read as "zero placeholders, all consistent".
function sedPlaceholdersFor(readme, label) {
  const blocks = readme.match(/```sh\n[\s\S]*?```/g) || [];
  const hits = blocks.filter(
    (b) => b.includes('$LABEL.plist.template') && b.includes('LABEL=' + label)
  );
  if (hits.length !== 1) {
    throw new Error(
      `recipe: expected exactly 1 install block for ${label} in watch/README.md, found ${hits.length}`
    );
  }
  const out = new Set();
  const re = /s\|(__[A-Z][A-Z0-9_]*__)\|/g;
  let m;
  while ((m = re.exec(hits[0])) !== null) out.add(m[1]);
  return out;
}

// --- tests ------------------------------------------------------------------

test('launchd: AS-94 — every plist template under watch/ renders clean and carries the common job shape', () => {
  const files = templateFiles();
  assert.deepEqual(
    files,
    [
      'com.american-software.advance-watcher.plist.template',
      'com.american-software.lattice-dashboard.plist.template',
    ],
    `expected exactly 2 *.plist.template under watch/, found ${files.length}: ${files.join(', ')}`
  );

  let examined = 0;
  for (const file of files) {
    const raw = readTemplate(file);
    const rendered = renderTemplate(raw, VALUES);
    const leftover = rendered.match(PLACEHOLDER_RE) || [];
    assert.deepEqual(
      leftover,
      [],
      `${file}: placeholder(s) the render values do not know about: ${leftover.join(', ')} (of ${files.length} templates examined)`
    );

    let plist;
    assert.doesNotThrow(() => {
      plist = parseFlatPlist(rendered);
    }, `${file}: rendered template must parse as a flat plist`);

    const label = LABEL_PREFIX + file.replace(/\.plist\.template$/, '').replace(LABEL_PREFIX, '');
    assert.equal(plist.Label, label, `${file}: Label must equal "${LABEL_PREFIX}" + the template basename`);
    assert.equal(plist.RunAtLoad, true, `${file}: RunAtLoad must be <true/> (starts at login/reboot)`);
    assert.equal(plist.KeepAlive, true, `${file}: KeepAlive must be <true/> (relaunched if it dies)`);
    assert.equal(plist.WorkingDirectory, '/checkout', `${file}: WorkingDirectory must be the repo root`);
    for (const key of ['StandardOutPath', 'StandardErrorPath']) {
      const value = plist[key];
      assert.equal(typeof value, 'string', `${file}: ${key} must be a string`);
      assert.ok(
        value.startsWith('/checkout/apps/chat/data/logs/') && value.endsWith('.log'),
        `${file}: ${key} must be a .log under apps/chat/data/logs/, got ${JSON.stringify(value)}`
      );
    }
    assert.equal(typeof plist.EnvironmentVariables, 'object', `${file}: EnvironmentVariables must be a dict`);
    assert.ok(
      typeof plist.EnvironmentVariables.PATH === 'string' && plist.EnvironmentVariables.PATH.length > 0,
      `${file}: EnvironmentVariables.PATH must be a non-empty string (launchd's default env is thin)`
    );
    examined += 1;
  }
  assert.equal(examined, 2, `expected to examine 2 templates, examined ${examined}`);
});

test('launchd: AS-94 — the dashboard job binds loopback :8799 from the repo root, exactly', () => {
  const file = 'com.american-software.lattice-dashboard.plist.template';
  const raw = readTemplate(file);
  const plist = parseFlatPlist(renderTemplate(raw, VALUES));

  assert.deepEqual(
    plist.ProgramArguments,
    ['/opt/lattice/bin/lattice', 'dashboard', '--host', '127.0.0.1', '--port', '8799'],
    'bind stays 127.0.0.1 — tailnet reach is Tailscale serve only (CTO decision 1)'
  );
  assert.equal(plist.WorkingDirectory, '/checkout', 'the dashboard reads .lattice/ from its WorkingDirectory');
  assert.equal(plist.Label, 'com.american-software.lattice-dashboard');
  assert.equal(plist.StandardOutPath, '/checkout/apps/chat/data/logs/lattice-dashboard.out.log');
  assert.equal(plist.StandardErrorPath, '/checkout/apps/chat/data/logs/lattice-dashboard.err.log');
  assert.deepEqual(
    Object.keys(plist.EnvironmentVariables),
    ['PATH'],
    'the dashboard is not the watcher — no copied ADVANCE_* env keys'
  );
  assert.deepEqual(
    [...placeholdersOf(raw)].sort(),
    ['__LATTICE_BIN__', '__PATH__', '__REPO_ROOT__'],
    'the dashboard template substitutes exactly three placeholders'
  );
});

test("launchd: AS-94 — the README install recipe substitutes exactly each template's placeholders", () => {
  const readme = fs.readFileSync(README, 'utf8');
  const files = templateFiles();
  assert.equal(files.length, 2, `expected 2 templates to check recipes for, found ${files.length}`);

  let checked = 0;
  for (const file of files) {
    const label = file.replace(/\.plist\.template$/, '');
    const fromRecipe = [...sedPlaceholdersFor(readme, label)].sort();
    const fromTemplate = [...placeholdersOf(readTemplate(file))].sort();
    assert.deepEqual(
      fromRecipe,
      fromTemplate,
      `${label}: the README sed recipe and the template must substitute the same placeholders (recipe: ${fromRecipe.join(', ')} | template: ${fromTemplate.join(', ')})`
    );
    checked += 1;
  }
  assert.equal(checked, 2, `expected to check 2 recipes, checked ${checked}`);
});

test('launchd: AS-94 — the plist reader throws on forms it does not understand', () => {
  const wrap = (inner) => `<plist version="1.0">\n<dict>\n${inner}\n</dict>\n</plist>`;
  const bad = [
    ['key with no value', wrap('<key>Label</key>')],
    ['unsupported <integer> value', wrap('<key>Nice</key><integer>5</integer>')],
    ['nested array', wrap('<key>A</key><array><array><string>x</string></array></array>')],
    ['unclosed array', wrap('<key>A</key><array><string>x</string>')],
    ['dict inside an array', wrap('<key>A</key><array><dict><key>K</key><string>v</string></dict></array>')],
    ['text after </plist>', wrap('<key>A</key><string>v</string>') + '\ntrailing'],
    ['value with no key', wrap('<string>orphan</string>')],
    ['duplicate key', wrap('<key>A</key><string>1</string><key>A</key><string>2</string>')],
  ];
  assert.equal(bad.length, 8, `expected 8 malformed inputs, have ${bad.length}`);
  let threw = 0;
  for (const [name, text] of bad) {
    assert.throws(() => parseFlatPlist(text), /plist:/, `${name}: the reader must throw`);
    threw += 1;
  }
  assert.equal(threw, bad.length, `expected all ${bad.length} malformed inputs to throw, got ${threw}`);

  // ...and "everything throws" is not what makes the above pass.
  const ok = parseFlatPlist(
    wrap('<key>Label</key><string>x</string><key>RunAtLoad</key><true/><key>Off</key><false/>')
  );
  assert.deepEqual(ok, { Label: 'x', RunAtLoad: true, Off: false });
});
