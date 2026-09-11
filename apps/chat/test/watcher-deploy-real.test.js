// AS-87: the two AS-75 findings (F3 heartbeat, F4 empty log) demonstrated
// against a REAL `docker compose up -d --build`, not argued from the code.
//
// Opt-in: AS87_REAL_BUILD=1 plus a docker binary (ADVANCE_DOCKER_BIN or the
// resolver's candidate list). Otherwise it registers as one SKIPPED test — the
// compose test image has no docker, and the default host run must not pay for
// a ~90 s build. Never a failure when not enabled (AC-8).
//
//   AS87_REAL_BUILD=1 ADVANCE_DOCKER_BIN=/usr/local/bin/docker \
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
const skip = !enabled ? 'opt-in: set AS87_REAL_BUILD=1' : (docker.bin ? false : `docker not runnable: ${docker.reason}`);

test('AS-87 real build: the state file heartbeats through the build and deploy-*.log carries the BuildKit output', { skip, timeout: 10 * 60_000 }, async (t) => {
  // Project isolation is by directory name: no `name:` in compose.yaml, no
  // COMPOSE_PROJECT_NAME (the deploy's env allowlist scrubs it — AS-88 pins
  // that), so compose falls back to this temp dir's basename.
  const dir = mkdtempSync(join(tmpdir(), `asc-as87-${process.pid}-`));
  const project = dir.split('/').pop().toLowerCase();
  const app = join(dir, 'app');
  mkdirSync(app);
  const logsDir = join(dir, 'logs');
  mkdirSync(logsDir);
  writeFileSync(join(app, 'Dockerfile'), 'FROM alpine\nRUN echo AS87-MARKER && sleep 75\nCMD ["sleep", "3600"]\n');
  writeFileSync(join(app, 'compose.yaml'), 'services:\n  as87:\n    build: .\n');
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
      ? { code: 0, stdout: Array.from({ length: 10 }, (_, i) => `100644 blob ${String(i).repeat(40)}\tapps/chat/${i}`).join('\n'), stderr: '' }
      : { code: 0, stdout: '', stderr: '' }),
    // The "running" server: stale until the build has finished, then current.
    fetchJson: async () => ({ build: { id: served } }),
    // The real thing. `served` flips only after compose has exited 0, which
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
  assert.ok(heartbeats.length >= 5, `${heartbeats.length} heartbeats examined (>= 5 expected)`);
  for (const s of heartbeats) assert.equal(s.reason, 'deploying');
  for (let i = 1; i < heartbeats.length; i++) {
    assert.ok(Date.parse(heartbeats[i].computedAt) > Date.parse(heartbeats[i - 1].computedAt), `computedAt advances at heartbeat ${i}`);
  }
  // (c) the outcome
  assert.equal(decision.action, 'deploy');
  const final = JSON.parse(readFileSync(statePath, 'utf8'));
  assert.equal(final.lastAttempt.outcome, 'ok', `outcome ok — log: ${logs.join(' | ')}`);
  // (b) the log file is not empty and carries the BuildKit steps
  const logLine = logs.find((l) => l.startsWith('DEPLOY building'));
  const logPath = logLine.split(' -> ')[1];
  const body = readFileSync(logPath, 'utf8');
  assert.ok(body.length > 0, 'deploy-*.log is not empty');
  assert.match(body, /AS87-MARKER/, 'the RUN step output is in the log');
  assert.match(body, /^#\d+ /m, 'a BuildKit step line is in the log');
});
