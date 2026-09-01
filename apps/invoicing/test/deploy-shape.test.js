// deploy-shape.test.js — the deployed container's shape, asserted against the
// real manifests (AS-37, plan §9.3). Modelled on
// apps/chat/test/deploy-shape.test.js, which is this repo's proven answer to
// AS-26.
//
// WHY THIS FILE EXISTS. Every other test here can be satisfied by an app
// constructed in-process: they prove the CODE is right while saying nothing
// about whether the deployed container is built the way the code assumes. AS-26
// shipped 190 green tests over a /api/file that 404'd README.md in the only
// supported deployment, because compose mounted the wrong thing. Unit tests
// structurally could not see it. This file closes that class by reading
// compose.yaml, the Dockerfile and the repo-root .dockerignore AS DATA and
// asserting the shape they project.
//
// The manifests are COPY'd into the image (see the Dockerfile) precisely so
// these assertions run in the standard runner — `docker compose run --rm
// --build test` — and not only on a developer's host. The test service is
// mountless, so it cannot reach the host checkout; the manifests have to ride
// along.
//
// The parser is deliberately STRICT and throws on anything it does not
// recognise. A silent parse failure here would make every assertion below it
// vacuous, which is the exact trap this file exists to avoid. If compose.yaml
// grows a shape this cannot read, teach it that shape; do not loosen it into
// shrugging.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { APP_DIR } from './helpers/server.js';

const COMPOSE_TEXT = readFileSync(join(APP_DIR, 'compose.yaml'), 'utf8');
const DOCKERFILE = readFileSync(join(APP_DIR, 'Dockerfile'), 'utf8');
const DOCKERIGNORE_TEXT = readFileSync(join(APP_DIR, '.dockerignore'), 'utf8');

// A stand-in for the host checkout root. compose.yaml lives at
// <CHECKOUT>/apps/invoicing/compose.yaml, so relative paths in it resolve
// against <CHECKOUT>/apps/invoicing. Using a notional root keeps the projection
// lexical: identical on a host checkout and inside the mountless container,
// where the real checkout is not reachable.
const CHECKOUT = '/checkout';
const COMPOSE_DIR = join(CHECKOUT, 'apps', 'invoicing');

// --- a strict YAML-subset parser --------------------------------------------

/** Strip a trailing `# comment`, respecting quotes. */
function stripComment(line) {
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
}

/** A scalar: a JSON flow sequence, a quoted string, or a bare string. */
function scalar(raw) {
  const text = raw.trim();
  if (text.startsWith('[')) {
    try {
      return JSON.parse(text);
    } catch (err) {
      throw new Error(`compose: unparseable flow sequence ${JSON.stringify(text)}: ${err.message}`);
    }
  }
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  return text;
}

/** The subset: 2-space indentation, block maps, block sequences, JSON flow
 *  sequences, `key: value` scalars, `#` comments. No anchors, no multi-line
 *  scalars, no inline maps. Anything else throws. */
function parseYamlSubset(text) {
  const lines = [];
  for (const raw of text.split('\n')) {
    const stripped = stripComment(raw);
    if (stripped.trim() === '') continue;
    const indent = stripped.length - stripped.trimStart().length;
    if (indent % 2 !== 0) throw new Error(`compose: odd indentation: ${JSON.stringify(raw)}`);
    lines.push({ indent, text: stripped.trim(), raw });
  }
  if (lines.length === 0) throw new Error('compose: document is empty');

  let i = 0;
  function parseBlock(indent) {
    if (lines[i].text.startsWith('- ')) {
      const seq = [];
      while (i < lines.length && lines[i].indent === indent && lines[i].text.startsWith('- ')) {
        seq.push(scalar(lines[i].text.slice(2)));
        i += 1;
      }
      if (i < lines.length && lines[i].indent > indent) throw new Error(`compose: unexpected indent after sequence: ${JSON.stringify(lines[i].raw)}`);
      return seq;
    }
    const map = {};
    while (i < lines.length && lines[i].indent === indent) {
      const match = /^([A-Za-z0-9_.-]+):(?:[ \t]+(.*))?$/.exec(lines[i].text);
      if (!match) throw new Error(`compose: unrecognised line: ${JSON.stringify(lines[i].raw)}`);
      const [, key, inline] = match;
      if (Object.hasOwn(map, key)) throw new Error(`compose: duplicate key ${key}`);
      i += 1;
      if (inline !== undefined && inline.trim() !== '') {
        map[key] = scalar(inline);
      } else if (i < lines.length && lines[i].indent > indent) {
        map[key] = parseBlock(lines[i].indent);
      } else {
        map[key] = null;
      }
    }
    if (i < lines.length && lines[i].indent > indent) throw new Error(`compose: unexpected indent: ${JSON.stringify(lines[i].raw)}`);
    return map;
  }

  const doc = parseBlock(0);
  if (i !== lines.length) throw new Error(`compose: parser stopped at ${JSON.stringify(lines[i].raw)}`);
  return doc;
}

const COMPOSE = parseYamlSubset(COMPOSE_TEXT);
const SERVICES = COMPOSE.services;

/** Non-comment, non-blank .dockerignore patterns. */
const IGNORE_PATTERNS = DOCKERIGNORE_TEXT.split('\n')
  .map((line) => line.trim())
  .filter((line) => line !== '' && !line.startsWith('#'));

/** The Dockerfile's INSTRUCTIONS, with comment lines removed. The Dockerfile
 *  documents itself heavily — including the sentence "npm ci — NEVER npm
 *  install" — so a scan of the raw text would count its own prose as code and
 *  report a violation that is not there. Comments are stripped once, here. */
const DOCKERFILE_CODE = DOCKERFILE.split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n');

/** Every COPY instruction, as { sources: string[], dest: string }. */
const COPIES = DOCKERFILE_CODE.split('\n')
  .map((line) => line.trim())
  .filter((line) => /^COPY\s/.test(line))
  .map((line) => {
    const parts = line.replace(/^COPY\s+/, '').split(/\s+/);
    if (parts.length < 2) throw new Error(`Dockerfile: unrecognised COPY: ${line}`);
    return { sources: parts.slice(0, -1), dest: parts[parts.length - 1] };
  });

// --- the parser saw what it is about to assert on (anti-vacuity) ------------

test('deploy-shape: the parsers read the manifests they are about to assert on', () => {
  // Guards against the AS-31 failure: a checker that silently read nothing and
  // "passed" every rule on an empty corpus. Exact counts, not `> 0`.
  assert.equal(COMPOSE.name, 'asc-invoicing', 'distinct project name so `compose down` cannot take asc-chat with it');
  assert.deepEqual(Object.keys(SERVICES), ['web', 'test']);
  assert.equal(COPIES.length, 9, `expected 9 COPY instructions, found ${COPIES.length}`);
  assert.equal(IGNORE_PATTERNS.length, 6, `expected 6 .dockerignore patterns, found ${IGNORE_PATTERNS.length}`);
  assert.match(DOCKERFILE_CODE, /^FROM /m);
  // The comment stripper must not have eaten the instructions it is filtering
  // for — a stripper that returned nothing would make every scan below vacuous.
  assert.ok(DOCKERFILE_CODE.includes('npm ci'), 'stripping comments left the instructions intact');
  assert.ok(DOCKERFILE.includes('NEVER npm install'), 'the raw file DOES contain the phrase the scan must not trip on');
});

test('deploy-shape: the parser rejects shapes it does not understand', () => {
  // The parser's strictness is itself load-bearing, so it is tested. A parser
  // that shrugs at an unknown line is how every assertion above it becomes
  // vacuous.
  assert.throws(() => parseYamlSubset('services:\n  web:\n    this line has no colon\n'), /unrecognised line/);
  assert.throws(() => parseYamlSubset('services:\n   web:\n'), /odd indentation/);
  assert.throws(() => parseYamlSubset('a: 1\na: 2\n'), /duplicate key/);
  assert.throws(() => parseYamlSubset('cmd: [not, json]\n'), /unparseable flow sequence/);
  // ...and it does understand the real file, which the assertions above rely on.
  assert.equal(parseYamlSubset(COMPOSE_TEXT).name, 'asc-invoicing');
});

// --- the build context is the repo root (the tokens mechanism) --------------

/** The services that BUILD this app's image, exactly. */
const BUILT = Object.entries(SERVICES).filter(([, service]) => service.build !== undefined);

test('deploy-shape: every built service builds from the REPO ROOT with this app Dockerfile', () => {
  assert.deepEqual(BUILT.map(([name]) => name), ['web', 'test']);
  for (const [name, service] of BUILT) {
    assert.equal(service.image, undefined, `${name}: a built service names no image`);
    assert.equal(service.build.context, '../..', `${name}: build context`);
    assert.equal(
      resolve(COMPOSE_DIR, service.build.context),
      CHECKOUT,
      `${name}: the context must resolve to the repo root — that is what lets the Dockerfile ` +
        'COPY docs/design/tokens/tokens.css without a second copy of it in version control',
    );
    assert.equal(service.build.dockerfile, 'apps/invoicing/Dockerfile', `${name}: dockerfile path`);
  }
});

test('deploy-shape: the tokens COPY is present with the exact source path', () => {
  const tokens = COPIES.filter((c) => c.sources.some((s) => s.endsWith('tokens.css')));
  assert.equal(tokens.length, 1, 'exactly one COPY brings tokens.css into the image');
  assert.deepEqual(tokens[0].sources, ['docs/design/tokens/tokens.css']);
  assert.equal(tokens[0].dest, './vendor/tokens.css');
  // vendor/, not public/: this app consumes the file and never owns it.
  assert.ok(!tokens[0].dest.includes('public'), 'vendored assets do not land in public/');
});

test('deploy-shape: the image carries no second copy of the tokens file', () => {
  const intoVendor = COPIES.filter((c) => c.dest.startsWith('./vendor'));
  assert.equal(intoVendor.length, 1, 'vendor/ is populated by exactly one COPY');
});

// --- the test service is the proof of gate (c) ------------------------------

test('deploy-shape: the test service is network-blocked and mountless', () => {
  const svc = SERVICES.test;
  assert.equal(svc.network_mode, 'none', 'network_mode: none is not negotiable (reversal trigger T3)');
  assert.equal(svc.volumes, undefined, 'the test service declares no volumes — passing mountless is the evidence');
  assert.deepEqual(svc.command, ['node', '--test'], 'node --test invoked BARE, never `node --test <dir>`');
  assert.deepEqual(svc.profiles, ['tools'], '`compose up` must not start the test service');
  assert.equal(svc.ports, undefined, 'the test service publishes nothing');
});

test('deploy-shape: the web service publishes 8348 on loopback and mounts nothing', () => {
  const svc = SERVICES.web;
  assert.deepEqual(svc.ports, ['127.0.0.1:8348:8348']);
  // Loopback is enforced on the HOST side; the container binds 0.0.0.0, or the
  // port map is dead. Both halves are asserted so neither can drift alone.
  assert.ok(svc.environment.includes('INVOICING_BIND=0.0.0.0'), 'the container must bind 0.0.0.0 internally');
  assert.ok(svc.environment.includes('INVOICING_PORT=8348'));
  // No source bind-mounts: the running container must BE the shipped image.
  // Mounting source would shadow node_modules/ and vendor/ and reintroduce the
  // AS-26 class of bug through the front door (plan §3.4).
  assert.equal(svc.volumes, undefined, 'the web service declares no volumes');
});

test('deploy-shape: no credential VALUE appears in compose.yaml, and every secret-shaped variable is a pass-through', () => {
  // The suite and the app must run with a completely empty environment: no
  // .env, no secret, no account (plan §7.3). AS-51 is an open board ask, and
  // fifteen tasks stay off its critical path only while this holds. AS-38 added
  // the key's NAME, as a pass-through whose value comes from the host shell or
  // `--env-file` — never from this file. Per-service exact lists, so a new entry
  // is a deliberate two-line change.
  assert.deepEqual(SERVICES.web.environment, [
    'INVOICING_BIND=0.0.0.0',
    'INVOICING_PORT=8348',
    'INVOICING_STRIPE_SECRET_KEY=${INVOICING_STRIPE_SECRET_KEY:-}',
  ]);
  assert.equal(SERVICES.test.environment, undefined, 'the test service sets nothing — the offline half stays offline');
  const env = Object.values(SERVICES).flatMap((s) => s.environment ?? []);
  assert.equal(env.length, 3, `expected exactly 3 environment entries, found ${env.length}: ${env.join(', ')}`);
  // Any variable whose NAME looks like a credential must be an interpolated
  // pass-through of the same name with an empty default: `${NAME:-}` and
  // nothing else. A literal value here would be a committed secret.
  let secretShaped = 0;
  for (const entry of env) {
    const [name, ...rest] = entry.split('=');
    const value = rest.join('=');
    if (/SECRET|TOKEN|KEY|PASSWORD/i.test(name)) {
      secretShaped += 1;
      assert.equal(value, `\${${name}:-}`, `${name} must be a pass-through of itself, got ${JSON.stringify(value)}`);
    }
  }
  assert.equal(secretShaped, 1, 'exactly one secret-shaped variable is passed through (the Stripe key)');
  // A credential VALUE has a recognisable shape; none of those shapes is here.
  // (The old whole-text word test — "no `stripe`, no `secret`" — is retired: the
  // variable name legitimately carries both words.)
  assert.ok(!/\b(sk|rk)_(test|live)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+/.test(COMPOSE_TEXT), 'compose.yaml carries a credential value');
  // The strict parser must have read the interpolation literally, or the
  // pass-through assertion above was made against something else.
  assert.ok(COMPOSE_TEXT.includes('INVOICING_STRIPE_SECRET_KEY=${INVOICING_STRIPE_SECRET_KEY:-}'));
});

test('deploy-shape: the amd64 platform pin is set where it actually takes effect', () => {
  // MEASURED 2026-09-01 on Docker 29.6.1 / compose v5.3.0: a service-level
  // `platform:` alone produced a linux/arm64 image despite the pin — the build
  // silently ignored it, and the image then differs from the deploy target.
  // `build.platforms` is what makes it take, and it works under both
  // DOCKER_BUILDKIT=1 and DOCKER_BUILDKIT=0. Both are asserted so a future edit
  // cannot drop the half that does the work. The runtime pin is on every
  // service; the BUILD pin on every service that builds.
  assert.equal(Object.keys(SERVICES).length, 2);
  for (const [name, service] of Object.entries(SERVICES)) {
    assert.equal(service.platform, 'linux/amd64', `${name}: runtime platform pin`);
  }
  assert.equal(BUILT.length, 2);
  for (const [name, service] of BUILT) {
    assert.deepEqual(service.build.platforms, ['linux/amd64'], `${name}: BUILD platform pin`);
  }
});

// --- the Dockerfile ----------------------------------------------------------

test('deploy-shape: the base image is pinned to an exact patch, not a floating tag', () => {
  const from = /^FROM\s+(\S+)/m.exec(DOCKERFILE_CODE);
  assert.ok(from, 'Dockerfile has a FROM');
  assert.equal(from[1], 'node:24.20.0-slim');
  assert.match(from[1], /^node:\d+\.\d+\.\d+-slim$/, 'exact patch pin — a floating tag is how a runtime changes under us');
});

test('deploy-shape: dependencies are installed with npm ci, never npm install', () => {
  // npm install can rewrite the lockfile mid-build, which would silently
  // un-pin the 65 transitive packages the lockfile is there to pin.
  assert.match(DOCKERFILE_CODE, /npm ci\b/);
  assert.ok(!/npm\s+install/.test(DOCKERFILE_CODE), 'npm install must not appear in the Dockerfile');
  assert.equal(COPIES.filter((c) => c.sources.some((s) => s.endsWith('package-lock.json'))).length, 1, 'the lockfile is COPY\'d before the install');
});

test('deploy-shape: the manifests ride along as data, which is why this test can run', () => {
  const dest = new Set(COPIES.flatMap((c) => c.sources));
  for (const manifest of ['apps/invoicing/compose.yaml', 'apps/invoicing/Dockerfile', '.dockerignore']) {
    assert.ok(dest.has(manifest), `${manifest} must be COPY'd into the image for this test to read it`);
  }
  // The test directory ships too: the test service runs the exact bits the
  // image ships (the AS-26 lesson generalised).
  assert.ok(dest.has('apps/invoicing/test'));
});

// --- the repo-root .dockerignore --------------------------------------------

test('deploy-shape: the repo-root .dockerignore keeps the live chat database out', () => {
  // THE LINE THAT MATTERS. A repo-root build context means Docker resolves
  // .dockerignore at the repo root, and there was none before this task. Without
  // apps/chat/data, the company's live internal chat database is inside the
  // build context of a product image.
  assert.ok(IGNORE_PATTERNS.includes('apps/chat/data'), '.dockerignore must exclude the live chat database');
  assert.ok(IGNORE_PATTERNS.includes('.git'), '.dockerignore must exclude git history');
  assert.ok(IGNORE_PATTERNS.includes('**/node_modules'), '.dockerignore must exclude node_modules — the image runs npm ci itself');
  assert.ok(IGNORE_PATTERNS.includes('.worktrees'), '.dockerignore must exclude in-flight task worktrees');
  assert.ok(IGNORE_PATTERNS.includes('.claude'), '.dockerignore must exclude .claude');
  // AS-38: the optional local key file must never enter a build context. The
  // pattern is `**/` so it holds wherever a future app keeps its own.
  assert.ok(IGNORE_PATTERNS.includes('**/.env.local'), '.dockerignore must exclude every .env.local');
  // .dockerignore must NOT exclude itself or the manifests: the test above
  // depends on them being COPY-able.
  for (const needed of ['.dockerignore', 'apps/invoicing/compose.yaml', 'apps/invoicing/Dockerfile']) {
    assert.ok(!IGNORE_PATTERNS.includes(needed), `${needed} must stay in the build context`);
  }
});
