const fs = require('fs');
const root = '/Users/forrest/Code/american-software-company/.worktrees/AS-87/';

// --- watcher.test.js: AC-1/AC-2 heartbeat, AC-6 argv pin -------------------
const w = root + 'apps/chat/test/watcher.test.js';
fs.appendFileSync(w, `
test('AS-87 evaluate heartbeats while deploying: every poll during a build rewrites deploy-state.json with a fresh computedAt and reason "deploying"', async (t) => {
  // Ruben's AS-75 F3. evaluate() used to return before persist() for the whole
  // length of performDeploy(), so computedAt froze at the last pre-build poll
  // and a 10–15 min build read as a crashed watcher (server.js stale-state).
  let releaseDeploy;
  const gate = new Promise((ok) => { releaseDeploy = ok; });
  let deployStarted;
  const started = new Promise((ok) => { deployStarted = ok; });
  const h = deployHarness(t, {
    deploy: async (opts) => {
      h.calls.deploy.push(opts);
      deployStarted();
      await gate;
      h.state.runningId = opts.env.CHAT_BUILD_ID;
      return { code: 0, signal: null, timedOut: false };
    },
  });
  const wanted = h.ops.computeDesired().desired.id;
  const first = h.ops.evaluate(); // decides 'deploy' and awaits the gated build
  await started;
  assert.equal(h.ops.isDeploying(), true, 'the build is in flight');
  const pre = h.readState();
  assert.equal(pre.lastAttempt.outcome, 'started', "AS-84's pre-build write is the baseline");

  // AC-1: three deploy polls, 60 s apart, each a heartbeat.
  const seen = [];
  for (let i = 0; i < 3; i++) {
    h.advance(60_000);
    const decision = await h.ops.evaluate();
    // AC-3: the returned decision is still busy — pendingDeploy() and the loop's
    // yield read this, and neither changes here.
    assert.deepEqual(decision, { action: 'noop', reason: 'busy' });
    seen.push(h.readState());
  }
  assert.equal(seen.length, 3, 'three heartbeats examined');
  const stamps = [pre.computedAt, ...seen.map((s) => s.computedAt)].map((s) => Date.parse(s));
  for (let i = 1; i < stamps.length; i++) {
    assert.ok(stamps[i] > stamps[i - 1], \`computedAt advances on poll \${i}: \${stamps[i - 1]} -> \${stamps[i]}\`);
  }
  for (const s of seen) {
    assert.equal(s.reason, 'deploying');
    // AC-2: the in-flight fields, not persist()'s no-git defaults.
    assert.equal(s.desiredId, wanted);
    assert.equal(s.desiredReason, 'ok');
    assert.equal(s.runningId, 'oldoldoldoldoldo');
    assert.equal(s.lastAttempt.outcome, 'started');
  }
  // AC-9: a value was added, never a key.
  assert.deepEqual(Object.keys(seen[0]).sort(), Object.keys(pre).sort());

  releaseDeploy();
  const decision = await first;
  assert.equal(decision.action, 'deploy');
  const after = h.readState();
  assert.equal(after.lastAttempt.outcome, 'ok');
  assert.notEqual(after.reason, 'deploying', 'the final post-deploy persist is not overwritten by a heartbeat');
  assert.equal(h.ops.isDeploying(), false);
  // And once the build has settled, a poll is a normal poll again.
  h.advance(60_000);
  const next = await h.ops.evaluate();
  assert.equal(next.reason, 'current');
  assert.equal(h.readState().reason, 'current');
});

test('AS-87 runDockerCompose argv: compose is spawned with --progress plain, never quiet', async () => {
  // Ruben's AS-75 F4: --progress quiet was copied from the chat wrapper, where it
  // protects --json stdout. Into a file sink it meant a 0-byte deploy-*.log on
  // every successful build, while three README sentences promised the output.
  const { EventEmitter } = await import('node:events');
  const { PassThrough } = await import('node:stream');
  const spawns = [];
  const proc = new EventEmitter();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.kill = () => true;
  const pending = runDockerCompose({
    dockerBin: '/fake/docker', cwd: '/repo/apps/chat', env: { PATH: '/bin' }, logPath: '/nonexistent/deploy.log', timeoutMs: 60_000,
    log: () => {},
    spawnFn: (bin, args, opts) => { spawns.push({ bin, args, opts }); return proc; },
    createLog: () => new PassThrough(),
  });
  proc.emit('exit', 0, null);
  await pending;
  assert.equal(spawns.length, 1, 'one spawn examined');
  assert.equal(spawns[0].bin, '/fake/docker');
  // Exact pin on purpose: a flag reorder or a new flag is a deliberate edit here.
  assert.deepEqual(spawns[0].args, ['compose', '--progress', 'plain', 'up', '-d', '--build']);
  assert.ok(!spawns[0].args.includes('quiet'));
});
`);

// --- api.test.js: AC-4 ------------------------------------------------------
const a = root + 'apps/chat/test/api.test.js';
let at = fs.readFileSync(a, 'utf8');
const anchor = "test('api: AS-93 — /api/config exposes exactly the dashboard override";
if (!at.includes(anchor)) throw new Error('api anchor');
at = at.replace(anchor, `test("api: AS-87 — composeBuild passes 'deploying' through when fresh, and still overrides to stale-state when not", () => {
  // The watcher's heartbeat writes a reason the server has never seen. The
  // server must neither rename it nor let it bypass the freshness check.
  const now = Date.parse('2026-09-11T19:00:00.000Z');
  const state = (over = {}) => ({
    desiredId: 'bbbbbbbbbbbbbbbb', dirty: false, reason: 'deploying', desiredReason: 'ok',
    runningId: 'aaaaaaaaaaaaaaaa', computedAt: new Date(now - 30_000).toISOString(), ...over,
  });
  const call = (over = {}) =>
    composeBuild({ buildId: 'aaaaaaaaaaaaaaaa', deployState: state(), watcherListening: true, nowMs: now, ...over });

  const fresh = call();
  assert.equal(fresh.reason, 'deploying', 'an unknown-to-the-server reason passes through untouched');
  assert.equal(fresh.current, false, 'ids differ during the build, so it is honestly behind');
  const stale = call({ deployState: state({ computedAt: new Date(now - 11 * 60_000).toISOString() }) });
  assert.equal(stale.reason, 'stale-state', 'eleven minutes without a heartbeat is still a stale report');
  assert.equal(stale.current, null);
});

` + anchor);
fs.writeFileSync(a, at);

// --- loop-label.test.js: AC-5 ----------------------------------------------
const l = root + 'apps/chat/test/loop-label.test.js';
let lt = fs.readFileSync(l, 'utf8');
const old1 = "    'no-state', 'unreadable-state', 'stale-state', 'no-watcher', 'unknown-build',\n  ];\n  assert.equal(reasons.length, 12, 'twelve reasons examined');";
if (!lt.includes(old1)) throw new Error('label anchor');
lt = lt.replace(old1, "    'no-state', 'unreadable-state', 'stale-state', 'no-watcher', 'unknown-build',\n    'deploying', // AS-87: the heartbeat's reason\n  ];\n  assert.equal(reasons.length, 13, 'thirteen reasons examined');");
const old2 = "  // An unrecognised reason degrades to naming itself rather than vanishing.\n  const odd = describeLoopStatus(status({ state: 'idle', build: build({ current: null, reason: 'martian' }) }), NOW).detail;\n  assert.match(odd, /reason: martian/);\n});";
if (!lt.includes(old2)) throw new Error('label anchor 2');
lt = lt.replace(old2, old2 + `

test('AS-87 label: "deploying" says a rebuild is running now and points at the build log', () => {
  // The heartbeat's whole purpose is that a long build stops reading as a
  // crashed watcher; the sentence must say what is happening and where to look.
  const d = describeLoopStatus(
    status({ state: 'idle', build: build({ current: false, id: 'aaaaaaaaaaaaaaaa', desiredId: 'bbbbbbbbbbbbbbbb', reason: 'deploying' }) }), NOW).detail;
  assert.match(d, /the watcher is rebuilding it now/);
  assert.match(d, /deploy-\\*\\.log/, 'names the log file the build writes');
  assert.doesNotMatch(d, /crashed|asleep/, 'a build in flight is not a dead watcher');
});`);
fs.writeFileSync(l, lt);

// --- watcher-deploy-real.test.js: AC-7/AC-8 (opt-in) -----------------------
fs.writeFileSync(root + 'apps/chat/test/watcher-deploy-real.test.js', `// AS-87: the two AS-75 findings (F3 heartbeat, F4 empty log) demonstrated
// against a REAL \`docker compose up -d --build\`, not argued from the code.
//
// Opt-in: AS87_REAL_BUILD=1 plus a docker binary (ADVANCE_DOCKER_BIN or the
// resolver's candidate list). Otherwise it registers as one SKIPPED test — the
// compose test image has no docker, and the default host run must not pay for
// a ~90 s build. Never a failure when not enabled (AC-8).
//
//   AS87_REAL_BUILD=1 ADVANCE_DOCKER_BIN=/usr/local/bin/docker \\
//     node --test apps/chat/test/watcher-deploy-real.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeDeployOps, runDockerCompose, resolveDockerBin, DEFAULTS } from '../watch/advance-watcher.mjs';

const enabled = process.env.AS87_REAL_BUILD === '1';
const docker = resolveDockerBin(process.env, existsSync);
const skip = !enabled ? 'opt-in: set AS87_REAL_BUILD=1' : (docker.bin ? false : \`docker not runnable: \${docker.reason}\`);

test('AS-87 real build: the state file heartbeats through the build and deploy-*.log carries the BuildKit output', { skip, timeout: 10 * 60_000 }, async (t) => {
  // Project isolation is by directory name: no \`name:\` in compose.yaml, no
  // COMPOSE_PROJECT_NAME (the deploy's env allowlist scrubs it — AS-88 pins
  // that), so compose falls back to this temp dir's basename.
  const dir = mkdtempSync(join(tmpdir(), \`asc-as87-\${process.pid}-\`));
  const project = dir.split('/').pop().toLowerCase();
  const app = join(dir, 'app');
  mkdirSync(app);
  const logsDir = join(dir, 'logs');
  mkdirSync(logsDir);
  writeFileSync(join(app, 'Dockerfile'), 'FROM alpine\\nRUN echo AS87-MARKER && sleep 75\\nCMD ["sleep", "3600"]\\n');
  writeFileSync(join(app, 'compose.yaml'), 'services:\\n  as87:\\n    build: .\\n');
  t.after(() => {
    spawnSync(docker.bin, ['compose', '-p', project, 'down', '--rmi', 'local', '-v', '--remove-orphans'], { cwd: app, stdio: 'ignore' });
    rmSync(dir, { recursive: true, force: true });
  });

  let served = 'oldoldoldoldoldo';
  const logs = [];
  const heartbeats = [];
  const statePath = join(dir, 'deploy-state.json');
  const ops = makeDeployOps({
    repoRoot: dir,
    appDir: app,
    watchDir: app,
    logsDir,
    statePath,
    lockPath: join(dir, 'advance.lock'),
    lockStaleMs: DEFAULTS.lockStaleMin * 60 * 1000,
    cooldownMs: DEFAULTS.deployCooldownMin * 60 * 1000,
    deployTimeoutMs: 8 * 60 * 1000,
    retentionMs: 14 * 24 * 60 * 60 * 1000,
    log: (line) => logs.push(line),
    env: { ...process.env, ADVANCE_DOCKER_BIN: docker.bin },
    exists: existsSync,
    // git is faked: one line per image input, so the desired id is stable.
    run: (bin, args) => (args[0] === 'ls-tree'
      ? { code: 0, stdout: Array.from({ length: 10 }, (_, i) => \`100644 blob \${String(i).repeat(40)}\\tapps/chat/\${i}\`).join('\\n'), stderr: '' }
      : { code: 0, stdout: '', stderr: '' }),
    // The "running" server: stale until the build has finished, then current.
    fetchJson: async () => ({ build: { id: served } }),
    // The real thing. \`served\` flips only after compose has exited 0, which
    // is when a real server would come back up on the new image.
    deploy: async (opts) => { const r = await runDockerCompose(opts); if (r.code === 0) served = opts.env.CHAT_BUILD_ID; return r; },
    readSources: () => [],
    exit: () => {},
    reprobeAttempts: 1,
    reprobeDelayMs: 0,
    pid: process.pid,
    isPidAlive: () => true,
  });
  const first = ops.evaluate();
  // Poll every 5 s while the build runs — the production interval is 60 s; the
  // shape (evaluate() while isDeploying()) is identical.
  while (!ops.isDeploying()) await new Promise((r) => setTimeout(r, 200));
  while (ops.isDeploying()) {
    await new Promise((r) => setTimeout(r, 5_000));
    if (!ops.isDeploying()) break;
    await ops.evaluate();
    heartbeats.push(JSON.parse(readFileSync(statePath, 'utf8')));
  }
  const decision = await first;

  // (a) the heartbeat: at least five polls during a 75 s+ build, each 'deploying',
  //     each with a computedAt later than the previous.
  assert.ok(heartbeats.length >= 5, \`\${heartbeats.length} heartbeats examined (>= 5 expected)\`);
  for (const s of heartbeats) assert.equal(s.reason, 'deploying');
  for (let i = 1; i < heartbeats.length; i++) {
    assert.ok(Date.parse(heartbeats[i].computedAt) > Date.parse(heartbeats[i - 1].computedAt), \`computedAt advances at heartbeat \${i}\`);
  }
  // (c) the outcome
  assert.equal(decision.action, 'deploy');
  const final = JSON.parse(readFileSync(statePath, 'utf8'));
  assert.equal(final.lastAttempt.outcome, 'ok', \`outcome ok — log: \${logs.join(' | ')}\`);
  // (b) the log file is not empty and carries the BuildKit steps
  const logLine = logs.find((l) => l.startsWith('DEPLOY building'));
  const logPath = logLine.split(' -> ')[1];
  const body = readFileSync(logPath, 'utf8');
  assert.ok(body.length > 0, 'deploy-*.log is not empty');
  assert.match(body, /AS87-MARKER/, 'the RUN step output is in the log');
  assert.match(body, /^#\\d+ /m, 'a BuildKit step line is in the log');
});
`);
console.log('ok');
