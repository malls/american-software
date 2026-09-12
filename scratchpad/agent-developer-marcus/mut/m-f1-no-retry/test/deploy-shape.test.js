// deploy-shape.test.js — the deployed container's shape, asserted against the
// real manifests (AS-26 review cycle 1).
//
// WHY THIS FILE EXISTS. Every other test in this suite is mountless by design:
// it injects a temp `repoRoot` into createChatServer, so it proves the *gate*
// in readRepoMarkdown is correct while saying nothing about whether the
// deployed container can see the files the gate would allow. Cycle 1 shipped
// 190 green tests over a /api/file that 404'd README.md, PHILOSOPHY.md,
// CLAUDE.md and apps/chat/README.md in the only supported deployment, because
// compose mounted just .lattice/ and personnel/ under the baked
// CHAT_REPO_ROOT. Unit tests structurally could not see it. This file closes
// that class: it reads compose.yaml and the Dockerfile as data and asserts the
// mount projection actually reaches every path the feature must serve.
//
// The manifests are COPY'd into the image (see Dockerfile + .dockerignore)
// precisely so these assertions run in the standard runner —
// `docker compose run --rm --build test` — and not only on a developer's host.
//
// Scope: manifests only. The path gate itself (traversal, dot-leading
// segments, symlink escape, size cap, 404 parity) is covered by api.test.js;
// nothing here duplicates it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IMAGE_INPUTS } from '../watch/advance-watcher.mjs';

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE = readFileSync(join(APP_DIR, 'compose.yaml'), 'utf8');
const DOCKERFILE = readFileSync(join(APP_DIR, 'Dockerfile'), 'utf8');

// A stand-in for the host checkout root. compose.yaml lives at
// <CHECKOUT>/apps/chat/compose.yaml, so relative host paths in its volume
// specs resolve against <CHECKOUT>/apps/chat. Using a notional root keeps the
// projection lexical: it is identical on a host checkout and inside the
// mountless test container, where the real checkout is not reachable.
const CHECKOUT = '/checkout';
const COMPOSE_DIR = join(CHECKOUT, 'apps', 'chat');

// --- manifest parsing (zero-dep; strict on purpose) --------------------------

/** Compose services -> { volumes: string[] | null, build, profiles }. A
 *  deliberate YAML subset: 2-space indentation, `services:` at column 0,
 *  service names at indent 2, keys at indent 4, nested entries at indent 6, and
 *  (only under `build.args`) map keys at indent 8. `#` comment lines skipped.
 *  Throws on anything it does not recognise — a silent parse failure here would
 *  make every assertion below vacuous, which is the exact trap this file exists
 *  to avoid. If compose.yaml grows a shape this cannot read, teach it that
 *  shape; do not loosen it into shrugging.
 *
 *  AS-75 widened it twice, both deliberate:
 *   - `build:` is now parsed (short form `build: .` and the long form with
 *     `context:` + `args:`), because the server service carries the BUILD_ID
 *     arg the deployer stamps the image with.
 *   - indents this parser does not understand now THROW. They used to fall off
 *     the end of the loop and be silently dropped, so the long `build:` form
 *     would have parsed "successfully" while contributing nothing — the exact
 *     vacuity the header warns about, present in the parser itself. */
function parseComposeServices(text) {
  const services = new Map();
  let inServices = false;
  let current = null;
  let section = null; // the indent-4 key currently open
  let subsection = null; // the indent-6 key currently open (only build.args)
  const LIST_KEYS = new Set(['volumes', 'ports', 'environment', 'profiles', 'command', 'entrypoint']);
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const indent = raw.length - raw.trimStart().length;
    if (indent === 0) {
      inServices = line === 'services:';
      current = null;
      section = null;
      subsection = null;
      continue;
    }
    if (!inServices) continue;
    if (indent === 2) {
      if (!line.endsWith(':')) throw new Error(`compose: unrecognised service line: ${raw}`);
      current = line.slice(0, -1);
      services.set(current, { volumes: null, build: null, profiles: null });
      section = null;
      subsection = null;
      continue;
    }
    if (indent === 4) {
      if (!current) throw new Error(`compose: key outside a service: ${raw}`);
      const colon = line.indexOf(':');
      if (colon < 1) throw new Error(`compose: unrecognised service key: ${raw}`);
      section = line.slice(0, colon);
      subsection = null;
      const inline = line.slice(colon + 1).trim();
      const svc = services.get(current);
      if (section === 'volumes' && inline === '') svc.volumes = [];
      else if (section === 'build') svc.build = inline === '' ? { args: null } : { context: inline, args: null };
      else if (section === 'profiles' && inline !== '') svc.profiles = parseInlineList(inline, raw);
      else if (LIST_KEYS.has(section) && inline !== '') {
        // an inline JSON-ish list for a key we do not otherwise read
        parseInlineList(inline, raw);
      }
      continue;
    }
    if (indent === 6) {
      if (!section) throw new Error(`compose: nested entry outside a key: ${raw}`);
      if (section === 'volumes') {
        if (!line.startsWith('- ')) throw new Error(`compose: unrecognised volume entry: ${raw}`);
        services.get(current).volumes.push(line.slice(2).trim());
        continue;
      }
      if (section === 'build') {
        const colon = line.indexOf(':');
        if (colon < 1) throw new Error(`compose: unrecognised build entry: ${raw}`);
        const key = line.slice(0, colon);
        const value = line.slice(colon + 1).trim();
        if (key === 'args' && value === '') {
          subsection = 'args';
          services.get(current).build.args = {};
        } else if (key === 'context') {
          services.get(current).build.context = value;
        } else {
          throw new Error(`compose: unrecognised build key: ${raw}`);
        }
        continue;
      }
      if (line.startsWith('- ') || line.includes(':')) continue; // ports/env/healthcheck detail we do not read
      throw new Error(`compose: unrecognised nested entry: ${raw}`);
    }
    if (indent === 8 && section === 'build' && subsection === 'args') {
      const colon = line.indexOf(':');
      if (colon < 1) throw new Error(`compose: unrecognised build arg: ${raw}`);
      services.get(current).build.args[line.slice(0, colon)] = line.slice(colon + 1).trim();
      continue;
    }
    throw new Error(`compose: unrecognised indentation (${indent}): ${raw}`);
  }
  if (services.size === 0) throw new Error('compose: no services parsed');
  return services;
}

/** `["tools"]` -> ['tools']. Strict: the only inline list form compose.yaml
 *  uses. Throws rather than returning [] on anything else. */
function parseInlineList(inline, raw) {
  if (!inline.startsWith('[') || !inline.endsWith(']')) {
    throw new Error(`compose: unrecognised inline list: ${raw}`);
  }
  const body = inline.slice(1, -1).trim();
  if (body === '') return [];
  return body.split(',').map((part) => {
    const t = part.trim();
    if (!/^"[^"]*"$/.test(t)) throw new Error(`compose: unrecognised inline list item: ${raw}`);
    return t.slice(1, -1);
  });
}

/** AS-75: the Dockerfile's COPY source paths, in order, as one flat list.
 *  `COPY a b ./` contributes 'a' and 'b'; the destination argument is dropped.
 *
 *  Strict on purpose. Every COPY form this parser does not understand THROWS
 *  rather than being skipped: a skipped line would make the IMAGE_INPUTS
 *  equality below vacuous in the one direction that matters (an input the
 *  digest never covers, so a merge touching it never triggers a rebuild —
 *  silent, permanent, and exactly the failure this whole task exists to
 *  delete). Teach it new forms; do not let it shrug. */
function parseCopySources(text) {
  const sources = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!/^COPY(\s|$)/i.test(line)) continue;
    if (line.endsWith('\\')) throw new Error(`Dockerfile: line-continuation COPY unsupported: ${line}`);
    if (line.includes('<<')) throw new Error(`Dockerfile: heredoc COPY unsupported: ${line}`);
    const rest = line.slice(4).trim();
    if (rest.startsWith('--')) throw new Error(`Dockerfile: flagged COPY unsupported: ${line}`);
    if (rest.startsWith('[')) throw new Error(`Dockerfile: JSON-array COPY unsupported: ${line}`);
    const parts = rest.split(/\s+/).filter(Boolean);
    if (parts.length < 2) throw new Error(`Dockerfile: COPY needs a source and a destination: ${line}`);
    for (const src of parts.slice(0, -1)) {
      if (/[*?[\]]/.test(src)) throw new Error(`Dockerfile: glob COPY unsupported: ${line}`);
      if (src.includes('"')) throw new Error(`Dockerfile: quoted COPY path unsupported: ${line}`);
      sources.push(src);
    }
  }
  return sources;
}

/** "../..:/repo:ro" -> { host, container, mode }. Mode defaults to rw, as Docker does. */
function parseMount(spec) {
  const parts = spec.split(':');
  if (parts.length < 2 || parts.length > 3) throw new Error(`compose: unrecognised mount spec: ${spec}`);
  return { host: parts[0], container: parts[1], mode: parts[2] || 'rw' };
}

function mountsOf(services, service) {
  const svc = services.get(service);
  assert.ok(svc, `compose has a "${service}" service`);
  return (svc.volumes || []).map(parseMount);
}

/** Where does <containerPath> come from on the host, under these mounts?
 *  Longest-container-prefix wins, as Docker resolves overlapping binds.
 *  null = no mount covers it, i.e. the path does not exist in the container —
 *  which is exactly how README.md 404'd in cycle 1. */
function project(mounts, containerPath) {
  let best = null;
  for (const m of mounts) {
    const covers = containerPath === m.container || containerPath.startsWith(m.container + '/');
    if (covers && (!best || m.container.length > best.container.length)) best = m;
  }
  if (!best) return null;
  const rel = containerPath.slice(best.container.length).replace(/^\//, '');
  const base = resolve(COMPOSE_DIR, best.host);
  return { host: rel ? join(base, rel) : base, mode: best.mode };
}

const SERVICES = parseComposeServices(COMPOSE);

/** The repo root the image bakes in; /api/file resolves every path against it. */
function bakedRepoRoot() {
  const m = /\bCHAT_REPO_ROOT=([^\s\\]+)/.exec(DOCKERFILE);
  assert.ok(m, 'Dockerfile bakes CHAT_REPO_ROOT');
  return m[1];
}

// --- the assertions ----------------------------------------------------------

test('deploy-shape: parser sees the manifests it is about to assert on', () => {
  // Guards against a vacuous pass: if the parser silently read nothing, every
  // projection below would still "hold" by finding no mounts to contradict it.
  assert.deepEqual([...SERVICES.keys()], ['server', 'cli', 'test']);
  assert.ok(mountsOf(SERVICES, 'server').length > 0, 'server declares volumes');
  assert.match(COMPOSE, /^name: asc-chat$/m);
});

test('deploy-shape: /api/file reaches every repo markdown path the app links', () => {
  const root = bakedRepoRoot();
  assert.equal(root, '/repo');
  const mounts = mountsOf(SERVICES, 'server');

  // The paths /api/file must serve. The first four are the plan's own named
  // examples and the cycle-1 blocking finding; the last two are the pre-AS-26
  // reads (lattice task/event data, AS-8 roster dossiers) that the widened
  // mount must not drop. Each must resolve to its real repo-relative location
  // on the host, read-only.
  const required = {
    'README.md': 'README.md',
    'PHILOSOPHY.md': 'PHILOSOPHY.md',
    'CLAUDE.md': 'CLAUDE.md',
    'apps/chat/README.md': 'apps/chat/README.md',
    '.lattice': '.lattice',
    personnel: 'personnel',
  };
  for (const [repoRelative, hostRelative] of Object.entries(required)) {
    const containerPath = `${root}/${repoRelative}`;
    assert.deepEqual(
      project(mounts, containerPath),
      { host: join(CHECKOUT, hostRelative), mode: 'ro' },
      `${containerPath} must be mounted read-only from ${hostRelative} — narrowing the ` +
        'server mount here is what made /api/file 404 for repo-root markdown in cycle 1',
    );
  }
});

test('deploy-shape: the repo mount is the whole checkout, read-only', () => {
  const root = bakedRepoRoot();
  const mounts = mountsOf(SERVICES, 'server');
  const repoMount = mounts.find((m) => m.container === root);
  assert.ok(repoMount, `server mounts something at the baked CHAT_REPO_ROOT (${root})`);
  assert.equal(resolve(COMPOSE_DIR, repoMount.host), CHECKOUT, 'host side is the checkout root');
  // :ro is half of the safety story for the wide mount (the other half is the
  // /api/file gate, tested in api.test.js). The kernel must refuse writes.
  assert.equal(repoMount.mode, 'ro');
  // Chat's own operational state is NOT part of the read-only repo view.
  const data = project(mounts, '/app/data');
  assert.deepEqual(data, { host: join(COMPOSE_DIR, 'data'), mode: 'rw' });
});

test('deploy-shape: cli keeps its lattice + personnel reads; test service stays mountless', () => {
  const root = bakedRepoRoot();
  const cli = mountsOf(SERVICES, 'cli');
  assert.deepEqual(project(cli, `${root}/.lattice`), { host: join(CHECKOUT, '.lattice'), mode: 'ro' });
  assert.deepEqual(project(cli, `${root}/personnel`), { host: join(CHECKOUT, 'personnel'), mode: 'ro' });

  // The test service mounts nothing by design — passing with zero mounts is
  // the evidence that the suite touches no real state. It is also the reason
  // this file has to assert the manifests instead of the filesystem.
  assert.deepEqual(SERVICES.get('test').volumes, null, 'test service declares no volumes');
});

// --- AS-75: the image-inputs manifest and the build-id stamp -----------------

test('deploy-shape: IMAGE_INPUTS is exactly the set the Dockerfile COPYs', () => {
  // Cardinality FIRST. A COPY parser that silently matched nothing would make
  // the set comparison below pass against an empty set — the vacuous-pass shape
  // this file exists to catch. Both counts are asserted before anything is
  // compared, so a parser that stops seeing the file fails here, loudly.
  const sources = parseCopySources(DOCKERFILE);
  const copyLines = DOCKERFILE.split('\n').filter((l) => /^COPY(\s|$)/i.test(l.trim()));
  // 7, not the plan §3.1's "6": the plan miscounted the COPY lines. The source
  // count (9) it named is right, and that is the one IMAGE_INPUTS must match.
  assert.equal(copyLines.length, 7, '7 COPY lines parsed');
  assert.equal(sources.length, 9, '9 COPY source paths parsed');
  assert.equal(IMAGE_INPUTS.length, 9, 'IMAGE_INPUTS declares 9 paths');

  // The actual guard: the watcher's digest must cover every input the image is
  // built from, and nothing that is not one. A path in the Dockerfile but not
  // here means merges to it never trigger a rebuild (silent stale deploy); a
  // path here but not in the Dockerfile means rebuilds fire for bytes the image
  // does not contain.
  assert.deepEqual(new Set(sources), new Set(IMAGE_INPUTS));
  assert.equal(new Set(sources).size, sources.length, 'no path is COPY\'d twice');
});

test('deploy-shape: the COPY parser throws on forms it does not understand', () => {
  // The parser is only trustworthy if it refuses to shrug. Each of these is a
  // real Dockerfile COPY form whose source set this parser would get wrong.
  const unrecognised = [
    ['multi-stage flag', 'FROM x\nCOPY --from=builder /a ./a\n'],
    ['chown flag', 'FROM x\nCOPY --chown=node:node lib ./lib\n'],
    ['glob', 'FROM x\nCOPY *.json ./\n'],
    ['bracket glob', 'FROM x\nCOPY lib[0-9] ./lib\n'],
    ['JSON array form', 'FROM x\nCOPY ["server.js", "./"]\n'],
    ['line continuation', 'FROM x\nCOPY lib \\\n  ./lib\n'],
    ['heredoc', 'FROM x\nCOPY <<EOT /app/x\nhi\nEOT\n'],
    ['no destination', 'FROM x\nCOPY server.js\n'],
  ];
  assert.equal(unrecognised.length, 8, 'eight unrecognised forms examined');
  for (const [name, text] of unrecognised) {
    assert.throws(() => parseCopySources(text), /Dockerfile:/, `${name} must throw, not be skipped`);
  }

  // ...and it does parse the forms the real file uses, or the throws above
  // would be meaningless (everything throwing is not a discriminating test).
  assert.deepEqual(parseCopySources('FROM x\nCOPY a b ./\nCOPY lib ./lib\n'), ['a', 'b', 'lib']);
});

test('deploy-shape: the server image is stamped with the build id the deployer computes', () => {
  // The Dockerfile end of the contract: an ARG defaulting to `unknown` (honest
  // for a hand build) surfaced as the CHAT_BUILD_ID env the server reports at
  // /api/build.
  assert.match(DOCKERFILE, /^ARG BUILD_ID=unknown$/m);
  assert.match(DOCKERFILE, /^ENV CHAT_BUILD_ID=\$BUILD_ID$/m);

  // Placement is load-bearing, not cosmetic: an ARG before the COPYs would
  // invalidate the layer cache on every rebuild, and the id changes by
  // definition whenever the inputs do.
  const lines = DOCKERFILE.split('\n');
  const lastCopy = lines.findLastIndex((l) => /^COPY(\s|$)/i.test(l.trim()));
  const argAt = lines.findIndex((l) => /^ARG BUILD_ID=/.test(l.trim()));
  assert.ok(lastCopy >= 0 && argAt >= 0);
  assert.ok(argAt > lastCopy, 'ARG BUILD_ID comes after every COPY');

  // The compose end: `docker compose up` has no --build-arg, so the id rides
  // in through the environment via the long build form.
  const build = SERVICES.get('server').build;
  assert.deepEqual(build, { context: '.', args: { BUILD_ID: '${CHAT_BUILD_ID:-unknown}' } });
  // The other two services keep the short form — nothing about them changed.
  assert.deepEqual(SERVICES.get('cli').build, { context: '.', args: null });
  assert.deepEqual(SERVICES.get('test').build, { context: '.', args: null });
});

test('deploy-shape: `up -d --build` starts the server alone — cli and test stay behind the tools profile', () => {
  // Q6: the watcher runs `docker compose up -d --build` with no --profile, so
  // anything NOT behind a profile would be started by a deploy. Only the server
  // may be.
  assert.equal(SERVICES.get('server').profiles, null, 'server has no profile gate');
  assert.deepEqual(SERVICES.get('cli').profiles, ['tools']);
  assert.deepEqual(SERVICES.get('test').profiles, ['tools']);
});
