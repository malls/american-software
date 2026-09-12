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
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const WATCHER = fileURLToPath(new URL('../watch/advance-watcher.mjs', import.meta.url));
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
