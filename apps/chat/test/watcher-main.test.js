// AS-82 — makeWatcher(), the factory that main() used to be.
//
// Everything main() wired is exercised here: the AS-27 heartbeat call site, the
// lock take and release, the AS-21 spawn argv/env call site, the highwater
// write, the AS-100 tick events, the tick box, and shutdown. The collaborators
// that would reach the host are injected — the clock, the pid, the liveness
// probe, the spawn, the log stream, the exit — while the lock, the loop mirror
// and the events stream are REAL files in a per-test temp dir, so the
// assertions are about bytes on disk rather than about a mock's call list.
//
// Fences, because a live watcher runs on this host: every path is under
// mkdtemp, claudeBin is a string that is never executed (spawn is a fake), and
// no port, no docker, no git and no launchd job is touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, unlinkSync, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import {
  makeWatcher,
  makeLoopOps,
  makeEventsOps,
  loadConfig,
  loadPermissionRules,
  tickArgv,
  tickChildEnv,
  readBoard,
} from '../watch/advance-watcher.mjs';
import { readStream, openItems } from '../lib/events.js';

const WATCHER_PID = 4242;

/** What exit() does in a real process: nothing after it runs. */
class ExitSignal extends Error {
  constructor(code) {
    super(`exit(${code})`);
    this.name = 'ExitSignal';
    this.code = code;
  }
}

/** The AS-21 grants fixture: one allow group, one deny group, so tickArgv's
 *  --allowedTools/--disallowedTools pair is non-empty and order-checkable. */
const SETTINGS = {
  permissions: {
    allow: ['Bash(lattice *)', 'Read'],
    deny: ['Bash(git push --force*)'],
  },
};

/** An EventEmitter that quacks like a spawned tick: pid, piped stdio, kill. */
function fakeChild(pid = 5150) {
  const proc = new EventEmitter();
  proc.pid = pid;
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.signals = [];
  proc.kill = (sig) => {
    proc.signals.push(sig);
    return true;
  };
  return proc;
}

function watcherHarness(t, over = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'chat-watcher-main-'));
  const dataDir = join(dir, 'apps', 'chat', 'data');
  const logsDir = join(dataDir, 'logs');
  mkdirSync(logsDir, { recursive: true });
  mkdirSync(join(dir, '.claude'), { recursive: true });

  const paths = {
    sentinel: join(dataDir, 'last-human-message.json'),
    highwater: join(dataDir, 'advance-watcher.highwater.json'),
    lock: join(dataDir, 'advance.lock'),
    pid: join(dataDir, 'advance-watcher.pid'),
    log: join(logsDir, 'advance-watcher.log'),
    settings: join(dir, '.claude', 'settings.json'),
    deployState: join(dataDir, 'deploy-state.json'),
    loopState: join(dataDir, 'advance-loop.json'),
    worktrees: join(dataDir, 'worktrees.json'),
    events: join(dataDir, 'events', 'company.jsonl'),
  };
  writeFileSync(paths.settings, JSON.stringify(SETTINGS));

  const config = {
    ...loadConfig({}),
    repoRoot: dir,
    pollS: 3600, // no interval may fire inside a test
    debounceS: 0, // poll -> debounce, next poll -> fire, deterministically
    tickTimeoutMin: 30,
    lockStaleMin: 45,
    permissionMode: 'acceptEdits',
    claudeBin: '/fake/claude',
    deployPollS: 3600,
    lanesPollS: 3600,
    eventsSweepS: 3600,
    ...over.config,
  };

  // Seeded from the REAL clock: makeLockOps stamps startedAt from Date.now()
  // and decide() compares it against this one, so they must agree to the second.
  let clock = Date.now();
  const now = () => clock;
  const logs = [];
  const log = (line) => logs.push(line);
  const calls = { spawn: [], exit: [], children: [] };
  const alive = new Set([WATCHER_PID, ...(over.alive ?? [])]);

  const tickLogs = [];
  const opened = [];
  const spawnFn = (bin, argv, opts) => {
    const proc = fakeChild();
    calls.spawn.push({ bin, argv, opts });
    calls.children.push(proc);
    return proc;
  };

  const deployOps = {
    evaluate: async () => ({ action: 'noop', reason: 'test' }),
    abort: async () => {}, // AS-84: shutdown() calls this whenever a deploy is in flight
    isDeploying: () => false,
    pendingDeploy: () => false,
    lockIsBusy: () => false,
    dockerBin: null,
    dockerReason: 'test',
    gitBin: 'git',
    baselineDigest: null,
    lastAttempt: () => null,
    ...over.deployOps,
  };
  const lanesOps = { evaluate: async () => {}, gitBin: 'git', statePath: paths.worktrees };

  // Test 5 needs to observe the ORDER of settle's three effects, which means
  // wrapping the real ops rather than stubbing them. Everything else lets
  // start() build the real lock/loop/events ops over the temp paths itself.
  const observed = { tickEndedLockPresent: null, settleSawTickEnded: null };
  let loopOpsArg;
  let eventsOpsArg;
  if (over.observeSettleOrder) {
    const realEvents = makeEventsOps({
      streamPath: paths.events,
      tickTimeoutMs: config.tickTimeoutMin * 60 * 1000,
      lockBusy: () => false,
      isBusy: () => false,
      log,
      now,
    });
    const realLoop = makeLoopOps({
      loadBoard: () => readBoard(join(config.repoRoot, '.lattice', 'tasks')),
      loadSentinel: () => (existsSync(paths.sentinel) ? JSON.parse(readFileSync(paths.sentinel, 'utf8')) : null),
      loadHighwater: () => (existsSync(paths.highwater) ? JSON.parse(readFileSync(paths.highwater, 'utf8')) : null),
      loadLock: () => (existsSync(paths.lock) ? JSON.parse(readFileSync(paths.lock, 'utf8')) : null),
      loadState: () => (existsSync(paths.loopState) ? JSON.parse(readFileSync(paths.loopState, 'utf8')) : null),
      saveState: (body) => writeFileSync(paths.loopState, JSON.stringify(body)),
      log,
      now,
      resumeGraceMs: config.tickTimeoutMin * 60 * 1000,
    });
    eventsOpsArg = {
      ...realEvents,
      tickEnded: (args) => {
        observed.tickEndedLockPresent = existsSync(paths.lock);
        return realEvents.tickEnded(args);
      },
    };
    loopOpsArg = {
      ...realLoop,
      settle: (tick) => {
        observed.settleSawTickEnded = readStream(paths.events).events.some((e) => e.type === 'tick_ended');
        return realLoop.settle(tick);
      },
    };
  }

  const watcher = makeWatcher({
    config,
    paths,
    logsDir,
    watchDir: join(dir, 'apps', 'chat', 'watch'),
    log,
    pid: WATCHER_PID,
    isPidAlive: (p) => alive.has(p),
    now,
    spawnFn,
    // The real stream, into the temp logsDir: cheap, real, and it proves the
    // tick log is opened where the config says rather than where a mock says.
    // createWriteStream opens ASYNCHRONOUSLY, so teardown waits for the open
    // before removing the dir — otherwise a test that never settles its child
    // leaves an open() in flight that lands on a deleted path.
    createLog: (path, opts) => {
      const stream = createWriteStream(path, opts);
      tickLogs.push(stream);
      opened.push(new Promise((res) => stream.once('open', res).once('error', res)));
      return stream;
    },
    exit: (code) => {
      calls.exit.push(code);
      throw new ExitSignal(code);
    },
    deployOps,
    lanesOps,
    loopOps: loopOpsArg,
    eventsOps: eventsOpsArg,
    ...over.watcher,
  });

  let started = false;
  let stopped = false;
  // AS-84: shutdown() returns a promise and finishes asynchronously whenever a
  // child is in flight, so the injected exit()'s ExitSignal arrives as a
  // REJECTION rather than a throw. Teardown has to await both shapes.
  const swallowExit = (err) => {
    if (!(err instanceof ExitSignal)) throw err;
  };
  t.after(async () => {
    if (started && !stopped) {
      try {
        const done = watcher.shutdown('SIGTERM');
        // A fake child never exits on its own, and AS-84's shutdown now waits
        // for the one it SIGTERMed. Emit the exit a real tick would, so teardown
        // settles on the tick's own path rather than on the grace timer.
        if (watcher.hasChild()) calls.children[calls.children.length - 1].emit('exit', null, 'SIGTERM');
        await done;
      } catch (err) {
        swallowExit(err);
      }
    }
    await Promise.all(opened);
    for (const stream of tickLogs) stream.destroy();
    rmSync(dir, { recursive: true, force: true });
  });

  const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);
  return {
    dir, paths, config, logs, calls, watcher, observed, alive,
    now,
    tick: (ms) => {
      clock += ms;
    },
    start: () => {
      watcher.start();
      started = true; // only a watcher that got past the single-instance gate owns anything to clean up
    },
    // AS-84: returns shutdown()'s promise. With nothing in flight it still
    // throws ExitSignal synchronously (today's fast path); with a child or a
    // deploy running the ExitSignal comes back as a rejection of this promise.
    stop: () => {
      stopped = true;
      return watcher.shutdown('SIGTERM');
    },
    writeSentinel: (body) => writeFileSync(paths.sentinel, JSON.stringify(body)),
    pidFile: () => readJson(paths.pid),
    lockFile: () => readJson(paths.lock),
    highwater: () => readJson(paths.highwater),
    loopState: () => readJson(paths.loopState),
    events: () => readStream(paths.events).events,
    lastChild: () => calls.children[calls.children.length - 1],
    logged: (re) => logs.filter((l) => re.test(l)),
  };
}

/** The message path, end to end: sentinel -> debounce -> fire. Returns the
 *  fake child. Two polls because debounceS is 0 and the window is not extended. */
function driveFire(h, messageId = 5) {
  h.writeSentinel({ messageId, authorId: 'human:forrest', conversationId: 7 });
  h.watcher.poll();
  h.watcher.poll();
  return h.lastChild();
}

test('AS-82 makeWatcher: start() refuses to run beside a live watcher, and otherwise writes the pid file with startedAt === heartbeatAt', (t) => {
  // A live foreign watcher owns the marker: we must not start, and must not
  // overwrite its file — a stomped pid file is how two watchers both think
  // they are the supervised one.
  const busy = watcherHarness(t, { alive: [999] });
  writeFileSync(busy.paths.pid, JSON.stringify({ pid: 999, startedAt: 'x', heartbeatAt: 'x' }));
  assert.throws(() => busy.start(), ExitSignal);
  assert.deepEqual(busy.calls.exit, [1]);
  assert.equal(busy.logged(/^FATAL another watcher is alive \(pid 999\)/).length, 1);
  assert.deepEqual(busy.pidFile(), { pid: 999, startedAt: 'x', heartbeatAt: 'x' }, 'the foreign marker is untouched');
  assert.equal(busy.calls.spawn.length, 0);

  // A free marker: we take it, and the two timestamps agree at startup — the
  // sidebar reads "up since" from one and liveness from the other (AS-27).
  const h = watcherHarness(t);
  h.start();
  const file = h.pidFile();
  assert.equal(file.pid, WATCHER_PID);
  assert.equal(file.startedAt, new Date(h.now()).toISOString());
  assert.equal(file.heartbeatAt, file.startedAt);
  assert.equal(h.logged(/^START watcher pid 4242 /).length, 1);
});

test('AS-82 makeWatcher: every poll rewrites heartbeatAt — including while our own tick is running — and never touches pid/startedAt', (t) => {
  const h = watcherHarness(t);
  h.start();
  const startedAt = h.pidFile().startedAt;

  h.tick(1000);
  h.watcher.poll();
  const beat = h.pidFile();
  assert.equal(beat.startedAt, startedAt, 'startedAt is captured once');
  assert.equal(beat.pid, WATCHER_PID);
  assert.equal(Date.parse(beat.heartbeatAt) - Date.parse(startedAt), 1000);

  // The headline property (AS-27, Priya's M3b): a tick of OURS is running, the
  // early return is taken — and the watcher is very much alive, so the beat
  // must still land. Before AS-82 nothing in the suite could see this.
  driveFire(h);
  assert.equal(h.watcher.hasChild(), true);
  h.tick(1000);
  h.watcher.poll();
  const duringTick = h.pidFile();
  assert.equal(Date.parse(duringTick.heartbeatAt) - Date.parse(startedAt), 2000, 'heartbeat advanced under the early return');
  assert.equal(duringTick.startedAt, startedAt);
  assert.equal(h.calls.spawn.length, 1, 'the in-flight poll fired nothing new');
});

test('AS-82 makeWatcher: a message fires exactly one tick — lock taken with our pid/source/nonce/loop marker, highwater advanced, tick_started emitted', (t) => {
  const h = watcherHarness(t);
  h.start();
  const child = driveFire(h, 5);
  assert.ok(child, 'a child was spawned');
  assert.equal(h.calls.spawn.length, 1);

  const lock = h.lockFile();
  assert.equal(lock.pid, WATCHER_PID);
  assert.equal(lock.source, 'watcher');
  assert.match(lock.nonce, /^[0-9a-f]{16}$/);
  assert.deepEqual(lock.loop, { ticks: 1 });
  assert.ok(Number.isFinite(Date.parse(lock.startedAt)));

  const hw = h.highwater();
  assert.equal(hw.messageId, 5);
  assert.equal(hw.firedAt, new Date(h.now()).toISOString());

  const started = h.events().filter((e) => e.type === 'tick_started');
  assert.equal(started.length, 1, 'exactly one tick_started');
  assert.equal(started[0].data.messageId, 5);
  assert.equal(started[0].data.pid, WATCHER_PID);
  assert.equal(started[0].data.source, 'watcher');

  // Settle it, then poll again: the same message must not fire twice. (With a
  // child still running the early return would hide a highwater regression.)
  child.emit('exit', 0, null);
  h.watcher.poll();
  h.watcher.poll();
  assert.equal(h.calls.spawn.length, 1, 'below-highwater: no second tick for messageId 5');
});

test('AS-82 makeWatcher: the spawn call site passes tickArgv() and tickChildEnv() verbatim, with the settings-file grants, from the repo root', (t) => {
  const h = watcherHarness(t);
  h.start();
  driveFire(h, 11);
  const nonce = h.lockFile().nonce;
  const call = h.calls.spawn[0];

  assert.equal(call.bin, h.config.claudeBin);
  assert.deepEqual(
    call.argv,
    tickArgv(WATCHER_PID, nonce, h.config.permissionMode, loadPermissionRules(h.paths.settings)),
    'argv carries the AS-21 grants from .claude/settings.json'
  );
  assert.ok(call.argv.includes('--allowedTools'), 'allow group present');
  assert.ok(call.argv.includes('--disallowedTools'), 'deny group present');
  assert.deepEqual(call.opts.env, tickChildEnv(process.env, WATCHER_PID, nonce));
  assert.equal(call.opts.cwd, h.config.repoRoot);
  assert.deepEqual(call.opts.stdio, ['ignore', 'pipe', 'pipe']);

  // No settings file: fire anyway, say so once, and carry no grant flags — the
  // AS-21 rule is "grants are best-effort", never "a missing file stops ticks".
  const bare = watcherHarness(t);
  unlinkSync(bare.paths.settings);
  bare.start();
  driveFire(bare, 12);
  const bareNonce = bare.lockFile().nonce;
  assert.equal(bare.logged(/^WARN permission rules unavailable /).length, 1);
  assert.deepEqual(bare.calls.spawn[0].argv, tickArgv(WATCHER_PID, bareNonce, bare.config.permissionMode));
  assert.equal(bare.calls.spawn[0].argv.includes('--allowedTools'), false);
});

test('AS-82 makeWatcher: settle releases the lock, then records tick_ended, then folds the tick into the loop — in that order', (t) => {
  const h = watcherHarness(t, { observeSettleOrder: true });
  h.start();
  const child = driveFire(h, 21);
  const tickStarted = h.events().find((e) => e.type === 'tick_started');

  child.emit('exit', 0, null);

  // The stated order, observed from inside the two collaborators rather than
  // argued from the source: a consumer must never see a closed tick while the
  // lock is still held, nor a loop fold before the tick is on the record.
  assert.equal(h.observed.tickEndedLockPresent, false, 'lock already released when tick_ended ran');
  assert.equal(h.observed.settleSawTickEnded, true, 'tick_ended already on the stream when the loop folded');

  assert.equal(h.watcher.hasChild(), false);
  assert.equal(existsSync(h.paths.lock), false);
  assert.equal(h.loopState().lastTick.code, 0);

  const ended = h.events().filter((e) => e.type === 'tick_ended');
  assert.equal(ended.length, 1);
  assert.equal(ended[0].data.tickId, tickStarted.id, 'tick_ended references its own tick_started');
  assert.equal(openItems(h.events()).tick, null, 'nothing left open');
});

test('AS-82 makeWatcher: a tick that outlives the box is SIGTERMed and settles as timedOut', async (t) => {
  const h = watcherHarness(t, { config: { tickTimeoutMin: 0.0005 } }); // 30ms
  h.start();
  const child = driveFire(h, 31);

  await delay(150);
  assert.deepEqual(child.signals, ['SIGTERM'], 'the box fired exactly once');
  assert.equal(h.logged(/^TIMEOUT tick exceeded /).length, 1);

  child.emit('exit', null, 'SIGTERM');
  assert.equal(h.loopState().lastTick.timedOut, true);
  const ended = h.events().filter((e) => e.type === 'tick_ended');
  assert.equal(ended.length, 1);
  assert.equal(ended[0].data.timedOut, true);
  assert.equal(existsSync(h.paths.lock), false);
});

test('AS-82 makeWatcher: a fire that loses the lock spawns nothing and leaves the highwater alone', (t) => {
  const h = watcherHarness(t, { alive: [999] });
  h.start();
  writeFileSync(
    h.paths.lock,
    JSON.stringify({ pid: 999, startedAt: new Date(h.now()).toISOString(), source: 'manual' })
  );
  driveFire(h, 41);
  assert.equal(h.calls.spawn.length, 0, 'a fresh foreign lock means someone else is ticking');
  assert.equal(h.logged(/^SKIP lock-fresh-manual \(messageId 41\)/).length, 1);
  assert.equal(existsSync(h.paths.highwater), false, 'no fire, no highwater move');

  // The holder dies: the lock is now stale and ours to steal.
  h.alive.delete(999);
  h.watcher.poll();
  assert.equal(h.logged(/^NOTE firing over stale lock: lock-stale-dead-pid/).length, 1);
  assert.equal(h.calls.spawn.length, 1);
  assert.equal(h.highwater().messageId, 41);

  // The race branch inside fire(): acquireLock returned false (someone won the
  // steal). Nothing may be spawned and the highwater must NOT move — the
  // message has to still be deliverable on the next poll.
  const raced = watcherHarness(t, {
    watcher: { lockOps: { acquireLock: () => false, releaseLock: () => {}, readLock: () => null } },
  });
  raced.start();
  driveFire(raced, 42);
  assert.equal(raced.calls.spawn.length, 0);
  assert.equal(raced.logged(/^SKIP fire aborted: lock acquisition failed \(messageId 42\)/).length, 1);
  assert.equal(existsSync(raced.paths.highwater), false);
});

test('AS-84 makeWatcher: shutdown clears the intervals, SIGTERMs the child and WAITS for its settle — tick_ended before exit 0', async (t) => {
  // Was the AS-82 shutdown test; AS-84 changes what it asserts. Before this,
  // shutdown() killed the child and called exit(0) synchronously, so the
  // child's own 'exit' handler never ran: no tick_ended, no loop fold, and
  // AS-100's sweep later closed the tick as `unclosed` from another process
  // (AS-82 F3). The fix is to let settle() run, not to duplicate it here.
  const h = watcherHarness(t);
  h.start();
  const child = driveFire(h, 51);
  assert.equal(existsSync(h.paths.lock), true);

  const cleared = t.mock.method(globalThis, 'clearInterval');
  const done = h.stop();

  // Four intervals are armed by start(): poll, deploy, lanes, events. A
  // shutdown that leaves one behind keeps the process alive after SIGTERM.
  assert.equal(cleared.mock.callCount(), 4);
  const handles = cleared.mock.calls.map((c) => c.arguments[0]);
  assert.equal(new Set(handles).size, 4, 'four distinct handles');
  assert.equal(handles.filter((x) => x === null || x === undefined).length, 0);

  // The headline: SIGTERM is sent, and we have NOT exited — the tick is still
  // settling, and everything it owns is still in place.
  assert.deepEqual(child.signals, ['SIGTERM']);
  assert.deepEqual(h.calls.exit, [], 'exit deferred until the tick settles');
  assert.equal(h.events().filter((e) => e.type === 'tick_ended').length, 0);
  assert.equal(existsSync(h.paths.lock), true, 'the tick still holds its lock');
  assert.equal(existsSync(h.paths.pid), true);

  child.emit('exit', null, 'SIGTERM');
  await assert.rejects(done, ExitSignal); // the injected exit() throws; the real one does not return

  const ended = h.events().filter((e) => e.type === 'tick_ended');
  assert.equal(ended.length, 1, 'exactly one tick_ended, written by the tick that fired');
  assert.equal(ended[0].data.signal, 'SIGTERM');
  assert.equal(openItems(h.events()).tick, null, 'nothing left open for the sweep to guess at');
  assert.equal(h.loopState().lastTick.signal, 'SIGTERM', 'and the loop folded it in');
  assert.deepEqual(h.calls.exit, [0]);
  assert.equal(existsSync(h.paths.lock), false);
  assert.equal(existsSync(h.paths.pid), false);
  assert.equal(h.logged(/^STOP SIGTERM$/).length, 1);
  assert.equal(h.logged(/^STOP terminating in-flight tick$/).length, 1);
  assert.equal(h.logged(/^STOP grace expired$/).length, 0, 'the tick settled well inside the grace');
});

test('AS-84 makeWatcher: shutdown with a deploy in flight aborts it and waits for it before exiting', async (t) => {
  // AS-75 F5, first half: the compose child lived inside runDockerCompose's
  // closure, so shutdown() could not signal it. It can now, through abort() —
  // and it must not exit until the deploy has recorded its abort and released
  // its own lock, which is what abort()'s promise means.
  let releaseAbort;
  const aborted = [];
  const h = watcherHarness(t, {
    deployOps: {
      isDeploying: () => true,
      abort: (signal) => {
        aborted.push(signal);
        return new Promise((ok) => {
          releaseAbort = ok;
        });
      },
    },
  });
  h.start();
  const done = h.stop();

  assert.deepEqual(aborted, ['SIGTERM'], 'abort() called exactly once, with SIGTERM');
  assert.equal(h.logged(/^STOP aborting in-flight deploy$/).length, 1);
  await null; // microtasks only: a macrotask turn here would let the grace timer in
  await null;
  assert.deepEqual(h.calls.exit, [], 'still waiting on the deploy');
  assert.equal(existsSync(h.paths.pid), true);

  releaseAbort();
  await assert.rejects(done, ExitSignal);
  assert.deepEqual(h.calls.exit, [0]);
  assert.equal(existsSync(h.paths.pid), false);
});

test('AS-84 makeWatcher: shutdown never releases a lock it does not own — a deploy-source lock survives', async (t) => {
  // AS-75 F5, second half. Same pid, different `source`: the lock on disk
  // belongs to the deploy ops instance, and releaseLock() used to test pid
  // alone, so shutdown unlinked the lock guarding a build that was still
  // running. Here the lock is the ONLY evidence of the deploy — isDeploying()
  // is false — because that is the case where a pid-only test looks correct.
  const h = watcherHarness(t);
  h.start();
  const body = JSON.stringify({
    pid: WATCHER_PID,
    startedAt: new Date(h.now()).toISOString(),
    source: 'deploy',
    nonce: 'abcdef0123456789',
  });
  writeFileSync(h.paths.lock, body);

  await assert.rejects(async () => h.stop(), ExitSignal); // no child, no deploy: the synchronous path
  assert.deepEqual(h.calls.exit, [0]);
  assert.equal(existsSync(h.paths.lock), true, "the deploy's lock is not ours to unlink");
  assert.equal(readFileSync(h.paths.lock, 'utf8'), body, 'byte-identical');
  assert.equal(existsSync(h.paths.pid), false, 'our own marker is still removed');
});

test('AS-84 makeWatcher: the shutdown grace is a bound — a child that ignores SIGTERM is SIGKILLed and we still exit 0', { timeout: 5000 }, async (t) => {
  // launchd SIGKILLs the watcher 20s after SIGTERM, so the wait above can never
  // be open-ended: a tick that ignores SIGTERM must not cost us our own clean
  // exit (the pid file would be left behind, and the sidebar would read a live
  // watcher that no longer exists).
  const h = watcherHarness(t, { config: { shutdownGraceS: 0.01 } });
  h.start();
  const child = driveFire(h, 71); // never emits 'exit'
  await assert.rejects(h.stop(), ExitSignal);

  assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL'], 'TERM first, KILL only after the grace');
  assert.equal(h.logged(/^STOP grace expired$/).length, 1);
  assert.deepEqual(h.calls.exit, [0]);
  assert.equal(existsSync(h.paths.pid), false);
});

test('AS-84 makeWatcher: the shutdown grace bounds the deploy child too — a build that ignores SIGTERM is SIGKILLed and we still exit 0', { timeout: 5000 }, async (t) => {
  // Ruben's cycle-1 F1: finish() SIGKILLed only the tick child, so a compose
  // child that trapped TERM kept building against the live project after the
  // watcher exited 0. The deploy gets the same bound: abort('SIGKILL'), fired
  // un-awaited at grace expiry, then exit.
  const aborted = [];
  const h = watcherHarness(t, {
    config: { shutdownGraceS: 0.01 },
    deployOps: {
      isDeploying: () => true,
      abort: (signal) => {
        aborted.push(signal);
        return new Promise(() => {}); // never settles: the build ignores SIGTERM
      },
    },
  });
  h.start();
  await assert.rejects(h.stop(), ExitSignal);

  assert.deepEqual(aborted, ['SIGTERM', 'SIGKILL'], 'TERM first, KILL only after the grace');
  assert.equal(h.logged(/^STOP grace expired: killing deploy child$/).length, 1);
  assert.deepEqual(h.calls.exit, [0]);
  assert.equal(existsSync(h.paths.pid), false);
});

test('AS-84 makeWatcher: deployPoll() survives a rejecting evaluate — no unhandled rejection, one ERROR line', async (t) => {
  // F6, the suspenders. The deploy poll runs inside setInterval; an unhandled
  // rejection there ends the watcher process, and the watcher is the thing that
  // fires ticks.
  const h = watcherHarness(t, {
    deployOps: { evaluate: async () => { throw new Error('boom'); } },
  });
  h.start();

  const unhandled = [];
  const sentinel = (err) => unhandled.push(err);
  process.once('unhandledRejection', sentinel);
  t.after(() => process.removeListener('unhandledRejection', sentinel));

  await h.watcher.deployPoll();
  await new Promise((ok) => setImmediate(ok)); // an unhandled rejection is reported a turn later
  assert.deepEqual(unhandled, [], 'the rejection was handled');
  assert.equal(h.logged(/^ERROR deploy poll rejected: boom$/).length, 1);
});

test('AS-82 makeWatcher: a spawn error settles the tick and frees the lock', (t) => {
  const h = watcherHarness(t);
  h.start();
  const child = driveFire(h, 61);

  child.emit('error', new Error('ENOENT'));
  assert.equal(h.logged(/^ERROR tick spawn failed: ENOENT /).length, 1);
  assert.equal(existsSync(h.paths.lock), false);
  assert.equal(h.watcher.hasChild(), false);
  const ended = h.events().filter((e) => e.type === 'tick_ended');
  assert.equal(ended.length, 1);
  assert.equal(ended[0].data.code, null);
});
