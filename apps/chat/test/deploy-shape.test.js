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

/** Compose services -> { volumes: string[] | null }. A deliberate YAML subset:
 *  2-space indentation, `services:` at column 0, service names at indent 2,
 *  keys at indent 4, list items at indent 6, `#` comment lines skipped. Throws
 *  on anything it does not recognise — a silent parse failure here would make
 *  every assertion below vacuous, which is the exact trap this file exists to
 *  avoid. If compose.yaml grows a shape this cannot read, teach it that shape;
 *  do not loosen it into shrugging. */
function parseComposeServices(text) {
  const services = new Map();
  let inServices = false;
  let current = null;
  let inVolumes = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const indent = raw.length - raw.trimStart().length;
    if (indent === 0) {
      inServices = line === 'services:';
      current = null;
      inVolumes = false;
      continue;
    }
    if (!inServices) continue;
    if (indent === 2) {
      if (!line.endsWith(':')) throw new Error(`compose: unrecognised service line: ${raw}`);
      current = line.slice(0, -1);
      services.set(current, { volumes: null });
      inVolumes = false;
      continue;
    }
    if (indent === 4) {
      if (!current) throw new Error(`compose: key outside a service: ${raw}`);
      inVolumes = line === 'volumes:';
      if (inVolumes) services.get(current).volumes = [];
      continue;
    }
    if (indent === 6 && inVolumes) {
      if (!line.startsWith('- ')) throw new Error(`compose: unrecognised volume entry: ${raw}`);
      services.get(current).volumes.push(line.slice(2).trim());
    }
  }
  if (services.size === 0) throw new Error('compose: no services parsed');
  return services;
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
