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
import { join, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeDeployOps, runDockerCompose, resolveDockerBin, DEFAULTS } from '/Users/forrest/Code/american-software-company/.worktrees/AS-87/apps/chat/watch/advance-watcher.mjs';

const enabled = process.env.AS87_REAL_BUILD === '1';
const docker = resolveDockerBin(process.env, existsSync);
const skip = !enabled ? 'opt-in: set AS87_REAL_BUILD=1' : (docker.bin ? false : `docker not runnable: ${docker.reason}`);

test('AS-87 real build: the state file heartbeats through the build and deploy-*.log carries the BuildKit output', { skip, timeout: 10 * 60_000 }, async (t) => {
  // Project isolation is by directory name. compose.yaml has no `name:` and the
  // deploy's env allowlist scrubs COMPOSE_PROJECT_NAME (AS-88 pins that), so
  // compose derives the project from the basename of the directory it is RUN
  // IN — which is `appDir`, the cwd performDeploy hands runDockerCompose — not
  // from the temp dir above it. The app directory is therefore named after
  // `project`, so the `-p project` teardown below addresses the project the
  // build actually created (Priya's cycle-1 F1: a subdir called `app` left an
  // `app` project running on the host after every run).
  const dir = mkdtempSync(join(tmpdir(), `asc-as87-${process.pid}-`));
  const project = basename(dir).toLowerCase();
  const app = join(dir, 'app'); // M9
  mkdirSync(app);
  const logsDir = join(dir, 'logs');
  mkdirSync(logsDir);
  // The nonce defeats BuildKit's layer cache: without it a second run of this
  // test builds in ~5 s from cache, 0 heartbeats fire, and a mutant that
  // empties the log goes red for the wrong reason (observed 2026-09-11).
  writeFileSync(join(app, 'Dockerfile'), `FROM alpine\nRUN echo AS87-MARKER-${Date.now()} && sleep 75\nCMD ["sleep", "3600"]\n`);
  writeFileSync(join(app, 'compose.yaml'), 'services:\n  as87:\n    build: .\n');
  let tornDown = false;
  const teardown = () => {
    if (tornDown) return;
    tornDown = true;
    spawnSync(docker.bin, ['compose', '-p', project, 'down', '--rmi', 'local', '-v', '--remove-orphans'], { cwd: app, stdio: 'ignore' });
    rmSync(dir, { recursive: true, force: true });
  };
  t.after(teardown);
  // AC-11's probe is deliberately NOT keyed on `project`: a leak is precisely a
  // project compose named differently from what we tear down, so the probe
  // matches on this run's temp-dir basename (unique per run) wherever compose
  // records it — the container's working_dir label and the project's config
  // path. Images carry no such label, so they are listed by the service label
  // and the expected `<project>-as87` name is checked among them.
  const docker$ = (args) => spawnSync(docker.bin, args, { encoding: 'utf8' }).stdout ?? '';
  const footprint = () => ({
    containers: docker$(['ps', '-a', '--filter', 'label=com.docker.compose.service=as87', '--format',
      '{{.Names}}\tproject={{.Label "com.docker.compose.project"}}\tworking_dir={{.Label "com.docker.compose.project.working_dir"}}'])
      .split('\n').filter((row) => row.includes(basename(dir))),
    projects: JSON.parse(docker$(['compose', 'ls', '-a', '--format', 'json']) || '[]')
      .filter((p) => p.Name === project || String(p.ConfigFiles).includes(basename(dir)))
      .map((p) => `${p.Name} ${p.ConfigFiles}`),
    images: docker$(['images', '--filter', 'label=com.docker.compose.service=as87', '--format', '{{.Repository}}:{{.Tag}}'])
      .split('\n').filter(Boolean),
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
  // Fail fast if the first evaluate() refuses (no docker, dirty inputs, no git,
  // a held lock): it then resolves without ever setting `deploying`, and a bare
  // spin on isDeploying() would sit out the whole 10-minute timeout instead of
  // failing (Priya's cycle-1 N2 — observed as a 10-minute hang under M8). A
  // deploy sets `deploying` synchronously before its first await, so the
  // decision settling BEFORE we see it deploying can only mean it did not.
  const settled = first.then((decision) => ({ decision }));
  while (!ops.isDeploying()) {
    const early = await Promise.race([settled, new Promise((r) => setTimeout(r, 200, null))]);
    if (early !== null) assert.fail(`the first evaluate() never started a build: ${JSON.stringify(early.decision)} — log: ${logs.join(' | ')}`);
  }
  // Poll every 5 s while the build runs — the production interval is 60 s; the
  // shape (evaluate() while isDeploying()) is identical.
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

  // (d) AC-11: the teardown addresses the project the build created, so the
  //     host is left as it was found. Cardinality first — the probe must see
  //     the project while it is up, or an empty answer after teardown proves
  //     nothing (a mistyped label filter would pass vacuously).
  const up = footprint();
  assert.equal(up.containers.length, 1, `one container from this run examined before teardown: ${JSON.stringify(up.containers)}`);
  assert.equal(up.projects.length, 1, `one compose project from this run examined before teardown: ${JSON.stringify(up.projects)}`);
  assert.ok(up.images.length >= 1, `at least one as87 image examined before teardown: ${JSON.stringify(up.images)}`);
  teardown();
  const left = footprint();
  assert.deepEqual(left.containers, [], 'AC-11: no container from this run survives teardown');
  assert.deepEqual(left.projects, [], 'AC-11: docker compose ls -a no longer lists this run');
  assert.deepEqual(left.images.filter((i) => i.startsWith(`${project}-`)), [], 'AC-11: --rmi local removed the image the build produced');
});
