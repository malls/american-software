// AS-82 — the one property no fake can hold: the REAL entry point, in a real
// process, heartbeating on its own setInterval and shutting down cleanly on
// SIGTERM. makeWatcher's harness (watcher-main.test.js) drives poll() by hand,
// which proves the call site and not the timer; this proves the timer.
//
// Every fence is deliberate, because a supervised watcher runs on this host and
// must not be disturbed:
//   ADVANCE_REPO_ROOT      -> a mkdtemp dir, so the pid file, lock, highwater,
//                             logs and state files are all this test's own
//   ADVANCE_CLAUDE_BIN     -> a path that does not exist (nothing can be fired)
//   no sentinel file       -> nothing WANTS to fire in the first place
//   ADVANCE_DOCKER_BIN     -> a path that does not exist (no rebuild, ever)
//   ADVANCE_CHAT_URL       -> a port nothing serves
//   deploy/lanes/events polls at 3600s -> they never fire inside the test
// The child therefore takes no lock, spawns nothing, binds nothing, and its
// only writes are under the temp dir. It is safe beside the live watcher: a
// different pid file, a different lock, a different log.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { IMAGE_INPUTS } from '../watch/advance-watcher.mjs';

const WATCHER = fileURLToPath(new URL('../watch/advance-watcher.mjs', import.meta.url));
const APP_DIR = dirname(dirname(WATCHER)); // apps/chat
// The happy path is ~0.5s; the box is for the emulated linux/amd64 compose run.
const DEADLINE_MS = 20_000;

test('AS-82 entry point: the real process heartbeats on its own interval against a temp data dir, and SIGTERM removes the pid file with exit 0', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'chat-watcher-proc-'));
  const dataDir = join(root, 'apps', 'chat', 'data');
  const pidPath = join(dataDir, 'advance-watcher.pid');
  const logPath = join(dataDir, 'logs', 'advance-watcher.log');

  const child = spawn(process.execPath, [WATCHER], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ADVANCE_REPO_ROOT: root,
      ADVANCE_POLL_S: '0.2',
      ADVANCE_CHAT_URL: 'http://127.0.0.1:1',
      ADVANCE_CLAUDE_BIN: '/nonexistent/claude',
      ADVANCE_DOCKER_BIN: '/nonexistent/docker',
      ADVANCE_DEPLOY_POLL_S: '3600',
      ADVANCE_LANES_POLL_S: '3600',
      ADVANCE_EVENTS_SWEEP_S: '3600',
    },
  });
  let out = '';
  child.stdout.setEncoding('utf8').on('data', (d) => (out += d));
  child.stderr.setEncoding('utf8').on('data', (d) => (out += d));

  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await exited;
    }
    rmSync(root, { recursive: true, force: true });
  });

  // The heartbeat is an INTERVAL, not a one-shot: startedAt is stamped once at
  // start, heartbeatAt is rewritten by every poll, so heartbeatAt > startedAt
  // is only reachable if the poll interval actually ran at least twice.
  const until = Date.now() + DEADLINE_MS;
  let beat = null;
  while (Date.now() < until) {
    try {
      const body = JSON.parse(readFileSync(pidPath, 'utf8'));
      if (Date.parse(body.heartbeatAt) > Date.parse(body.startedAt)) {
        beat = body;
        break;
      }
    } catch {
      /* not written yet, or written mid-rename */
    }
    await delay(50);
  }
  assert.ok(beat, `no advancing heartbeat within ${DEADLINE_MS}ms; watcher output:\n${out}`);
  assert.equal(beat.pid, child.pid, 'the pid file names the process we started');

  child.kill('SIGTERM');
  // A plain timers/promises delay would keep the event loop open for the full
  // DEADLINE_MS after the race is already won (review, qa-ruben: the test
  // passed in ~110 ms but the file took 20.7 s); clear it once exit wins.
  let deadlineTimer = null;
  const deadline = new Promise((resolve) => {
    deadlineTimer = setTimeout(() => resolve({ code: 'timeout', signal: 'timeout' }), DEADLINE_MS);
  });
  const { code, signal } = await Promise.race([exited, deadline]);
  clearTimeout(deadlineTimer);
  assert.equal(code, 0, `expected a clean exit; watcher output:\n${out}`);
  assert.equal(signal, null);
  assert.equal(existsSync(pidPath), false, 'shutdown removed its own marker');

  const log = readFileSync(logPath, 'utf8');
  assert.match(log, new RegExp(`START watcher pid ${child.pid} `));
  assert.match(log, /STOP SIGTERM/);
});

// --- AS-84: SIGTERM arriving while the watcher is mid-BUILD ------------------
//
// The one property the unit tests cannot hold: that a real SIGTERM to the real
// entry point reaches a real grandchild. Before AS-84 the compose process lived
// inside runDockerCompose's closure, so shutdown() killed the tick child only —
// the build kept running, orphaned, under a lock shutdown had already unlinked
// (AS-75 F5, Ruben). What is observed here is the orphan's absence.
//
// Same fences as above, plus: the "docker" binary is a shell script this test
// writes, so the real daemon is never contacted and the real apps/chat/data is
// never touched. The compose it "runs" is a `sleep` in a temp dir.
// The marker path is BAKED IN, not read from the environment: the deploy's
// child env is the same pinned minimal set as the tick's (PATH, HOME, USER,
// LOGNAME and the three build variables), so nothing this test exports would
// reach the script.
const TRAP_HANDLES_TERM = "trap 'kill $sleeper 2>/dev/null; exit 143' TERM";
const TRAP_IGNORES_TERM = "trap '' TERM"; // Ruben's cycle-1 F1 repro: a build that will not stop
const fakeDocker = (marker, trapLine = TRAP_HANDLES_TERM) => `#!/bin/sh
# AS-84 test double for docker. Records its pid, then behaves like a long
# build. With the default trap it handles SIGTERM: reap the sleep, exit 143
# (the convention a trapping child exits with, and the case that reports
# signal null). With TRAP_IGNORES_TERM it is the child the grace exists for.
echo $$ > '${marker}'
${trapLine}
sleep 30 &
sleeper=$!
wait $sleeper
`;

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
};

/**
 * Boot a real watcher over a temp repo with a fake docker, wait until a build
 * is genuinely in flight (fake docker pid recorded, advance.lock held under
 * source:'deploy'), SIGTERM the watcher and wait for it to exit 0. Returns the
 * handles the assertions need; the caller decides what the exit must mean.
 */
async function sigtermMidBuild(t, { trapLine = TRAP_HANDLES_TERM, extraEnv = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'chat-watcher-abort-'));
  const dataDir = join(root, 'apps', 'chat', 'data');
  const marker = join(root, 'docker.pid');
  const dockerBin = join(root, 'fake-docker');

  // A real git repo holding the real image inputs: computeDesired() runs
  // `git ls-tree HEAD` over exactly IMAGE_INPUTS and refuses a short set, so
  // the fixture is built from that list rather than from a hard-coded count
  // (AS-86 is changing the set in a sibling lane).
  mkdirSync(join(root, 'apps', 'chat'), { recursive: true });
  for (const input of IMAGE_INPUTS) cpSync(join(APP_DIR, input), join(root, 'apps', 'chat', input), { recursive: true });
  const git = (...args) => {
    const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${args[0]} failed: ${r.stderr}`);
  };
  git('init', '-q');
  git('add', '-A', 'apps/chat');
  git('-c', 'user.name=test', '-c', 'user.email=test@test.invalid', 'commit', '-q', '-m', 'fixture');

  // The container the watcher probes: always a build id that is NOT master's,
  // so every deploy poll decides `stale-build` and rebuilds.
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ build: { id: 'stale' } }));
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const chatUrl = `http://127.0.0.1:${server.address().port}`;

  writeFileSync(dockerBin, fakeDocker(marker, trapLine), { mode: 0o755 });

  const child = spawn(process.execPath, [WATCHER], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ADVANCE_REPO_ROOT: root,
      ADVANCE_POLL_S: '3600', // nothing may fire a tick; only the deploy runs
      ADVANCE_CHAT_URL: chatUrl,
      ADVANCE_CLAUDE_BIN: '/nonexistent/claude',
      ADVANCE_DOCKER_BIN: dockerBin,
      ADVANCE_DEPLOY_POLL_S: '0.2',
      ADVANCE_LANES_POLL_S: '3600',
      ADVANCE_EVENTS_SWEEP_S: '3600',
      ...extraEnv,
    },
  });
  let out = '';
  child.stdout.setEncoding('utf8').on('data', (d) => (out += d));
  child.stderr.setEncoding('utf8').on('data', (d) => (out += d));

  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await exited;
    }
    // Belt: a fake docker that outlived the test is the very leak under test.
    try {
      const stray = Number(readFileSync(marker, 'utf8').trim());
      if (Number.isInteger(stray) && alive(stray)) process.kill(stray, 'SIGKILL');
    } catch {
      /* never spawned, or already gone */
    }
    await new Promise((ok) => server.close(ok));
    rmSync(root, { recursive: true, force: true });
  });

  // Wait until the build is genuinely in flight: the fake docker has recorded
  // its pid AND the deploy has taken advance.lock under its own source.
  const lockPath = join(dataDir, 'advance.lock');
  let dockerPid = null;
  const until = Date.now() + DEADLINE_MS;
  while (Date.now() < until) {
    try {
      const pid = Number(readFileSync(marker, 'utf8').trim());
      const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
      if (Number.isInteger(pid) && alive(pid) && lock.source === 'deploy') {
        dockerPid = pid;
        break;
      }
    } catch {
      /* not there yet, or caught mid-write */
    }
    await delay(50);
  }
  assert.ok(dockerPid, `no in-flight build within ${DEADLINE_MS}ms; watcher output:\n${out}`);
  assert.equal(JSON.parse(readFileSync(lockPath, 'utf8')).pid, child.pid, 'the lock is the watcher process');

  child.kill('SIGTERM');
  let deadlineTimer = null;
  const deadline = new Promise((resolve) => {
    deadlineTimer = setTimeout(() => resolve({ code: 'timeout', signal: 'timeout' }), 15_000);
  });
  const { code, signal } = await Promise.race([exited, deadline]);
  clearTimeout(deadlineTimer);
  assert.equal(code, 0, `expected a clean exit; watcher output:\n${out}`);
  assert.equal(signal, null);
  return { dockerPid, lockPath, dataDir, out: () => out };

}

test('AS-84 entry point: SIGTERM mid-build terminates the compose child, leaves no lock, records the abort, exits 0', async (t) => {
  const { dockerPid, lockPath, dataDir } = await sigtermMidBuild(t);

  // THE assertion: no orphan. Before AS-84 this build survived its watcher.
  for (let i = 0; i < 40 && alive(dockerPid); i++) await delay(50);
  assert.equal(alive(dockerPid), false, `the compose child (pid ${dockerPid}) outlived its watcher`);

  assert.equal(existsSync(lockPath), false, 'the deploy released its own lock');
  assert.equal(existsSync(join(dataDir, 'advance-watcher.pid')), false, 'and the watcher removed its marker');

  const state = JSON.parse(readFileSync(join(dataDir, 'deploy-state.json'), 'utf8'));
  assert.equal(state.lastAttempt.outcome, 'aborted', 'an interrupted build is not a failed one');
  assert.match(state.lastAttempt.detail, /aborted by shutdown/);

  const log = readFileSync(join(dataDir, 'logs', 'advance-watcher.log'), 'utf8');
  assert.match(log, /STOP aborting in-flight deploy/);
  assert.match(log, /DEPLOY aborted/);
});

test('AS-84 entry point: a build that ignores SIGTERM is SIGKILLed at grace expiry — no orphan, no deploy lock, exit 0', async (t) => {
  // Ruben's cycle-1 F1, observed: before the fix the watcher exited 0 with the
  // fake docker still alive and a source:'deploy' lock on disk under a dead pid.
  const { dockerPid, lockPath, dataDir } = await sigtermMidBuild(t, {
    trapLine: TRAP_IGNORES_TERM,
    extraEnv: { ADVANCE_SHUTDOWN_GRACE_S: '0.5' },
  });

  for (let i = 0; i < 40 && alive(dockerPid); i++) await delay(50);
  assert.equal(alive(dockerPid), false, `the compose child (pid ${dockerPid}) outlived its watcher's grace`);
  assert.equal(existsSync(lockPath), false, 'no source:deploy lock left on disk');
  assert.equal(existsSync(join(dataDir, 'advance-watcher.pid')), false);

  // The finally never ran, so the pre-build 'started' record is what survives —
  // it hydrates as a bounded failure at relaunch (AC-4).
  const state = JSON.parse(readFileSync(join(dataDir, 'deploy-state.json'), 'utf8'));
  assert.equal(state.lastAttempt.outcome, 'started');

  const log = readFileSync(join(dataDir, 'logs', 'advance-watcher.log'), 'utf8');
  assert.match(log, /STOP aborting in-flight deploy/);
  assert.match(log, /STOP grace expired: killing deploy child/);
});
