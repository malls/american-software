// AS-27 unit tests for lib/loop-status.js — the pure derivation behind the
// sidebar's loop indicator. Fixture objects and an injected clock only: no fs,
// no server, no sleeps. The staleness boundary is asserted BY CONSTRUCTION
// against the watcher's own isLockStale (the same import the module under test
// uses), so this file cannot accidentally become a second, drifting copy of
// the freshness rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveLoopStatus, WATCHER_STALE_MS } from '../lib/loop-status.js';
import { isLockStale, DEFAULTS } from '../watch/advance-watcher.mjs';

const NOW = Date.parse('2026-09-03T18:00:00.000Z');
const STALE_MS = DEFAULTS.lockStaleMin * 60 * 1000;

const iso = (ms) => new Date(ms).toISOString();
const lockAt = (ageMs, over = {}) => ({ pid: 5285, startedAt: iso(NOW - ageMs), source: 'loop', ...over });
const pidAt = (ageMs, over = {}) => ({ pid: 96123, startedAt: iso(NOW - 3_600_000), heartbeatAt: iso(NOW - ageMs), ...over });
const derive = (lock, watcher, over = {}) =>
  deriveLoopStatus({ lock, watcher, nowMs: NOW, lockStaleMs: STALE_MS, ...over });

// --- AC-1: the four states are distinguishable ------------------------------

test('AS-27 loop-status: the four states, each from the inputs that produce it', () => {
  // 1. loop — fresh lock, source "loop".
  const loop = derive(lockAt(60_000), pidAt(3_000));
  assert.equal(loop.state, 'loop');
  assert.deepEqual(loop.tick, { source: 'loop', pid: 5285, startedAt: iso(NOW - 60_000), ageS: 60 });
  assert.equal(loop.staleLock, null);

  // 2. tick — fresh lock, any other source. Both real non-loop sources.
  for (const source of ['watcher', 'manual']) {
    const t = derive(lockAt(5_000, { source, pid: 4242 }), pidAt(3_000));
    assert.equal(t.state, 'tick', `source ${source} is a tick, not a loop`);
    assert.deepEqual(t.tick, { source, pid: 4242, startedAt: iso(NOW - 5_000), ageS: 5 });
  }

  // 3. idle — no lock at all, watcher heartbeating.
  const idle = derive(null, pidAt(3_000));
  assert.equal(idle.state, 'idle');
  assert.equal(idle.tick, null);
  assert.equal(idle.staleLock, null);
  assert.deepEqual(idle.watcher, { listening: true, heartbeatAt: iso(NOW - 3_000), ageS: 3 });

  // 4. off — no lock, no watcher pid file.
  const off = derive(null, null);
  assert.equal(off.state, 'off');
  assert.deepEqual(off.watcher, { listening: false, heartbeatAt: null, ageS: null, reason: 'no-pidfile' });

  // The states really are four distinct values (a status indicator that
  // renders the same thing everywhere is the vacuity shape of this task).
  assert.deepEqual([loop.state, derive(lockAt(5_000, { source: 'watcher' }), pidAt(3_000)).state, idle.state, off.state],
    ['loop', 'tick', 'idle', 'off']);
  assert.equal(loop.checkedAt, iso(NOW));
});

test('AS-27 loop-status: staleness boundary is the watcher\'s, not a second comparison', () => {
  // Exactly at the limit is fresh; one ms older is stale. Both legs are
  // asserted against isLockStale itself — if the watcher ever changes to
  // >=-semantics, this test follows it rather than contradicting it.
  for (const ageMs of [STALE_MS, STALE_MS + 1]) {
    const lock = lockAt(ageMs);
    const expectedStale = isLockStale({ ...lock, pidAlive: true }, NOW, STALE_MS).stale;
    const got = derive(lock, pidAt(3_000));
    assert.equal(got.tick === null, expectedStale, `age ${ageMs}ms: tick presence tracks isLockStale`);
    assert.equal(got.staleLock === null, !expectedStale, `age ${ageMs}ms: exactly one of tick/staleLock`);
  }
  // And the resulting states, spelled out.
  assert.equal(derive(lockAt(STALE_MS), pidAt(3_000)).state, 'loop');
  const stale = derive(lockAt(STALE_MS + 1), pidAt(3_000));
  assert.equal(stale.state, 'idle', 'a stale lock is not a tick — the state falls through to the watcher');
  assert.deepEqual(stale.staleLock,
    { source: 'loop', startedAt: iso(NOW - STALE_MS - 1), ageS: 2700, reason: 'age' });

  // A stale lock with no watcher is 'off', not 'tick': staleness wins twice.
  assert.equal(derive(lockAt(STALE_MS + 1), null).state, 'off');
});

test('AS-27 loop-status: watcher freshness window is WATCHER_STALE_MS (12 watcher polls)', () => {
  assert.equal(WATCHER_STALE_MS, 60_000);
  assert.equal(WATCHER_STALE_MS / (DEFAULTS.pollS * 1000), 12, 'derived from the watcher poll cadence');
  assert.equal(derive(null, pidAt(WATCHER_STALE_MS)).state, 'idle', 'exactly at the window: still listening');
  const stale = derive(null, pidAt(WATCHER_STALE_MS + 1));
  assert.equal(stale.state, 'off');
  assert.deepEqual(stale.watcher, {
    listening: false,
    heartbeatAt: iso(NOW - WATCHER_STALE_MS - 1),
    ageS: 60,
    reason: 'stale-heartbeat',
  });
  // Overridable for tests/callers, but the default is the one place it lives.
  assert.equal(derive(null, pidAt(90_000), { watcherStaleMs: 120_000 }).state, 'idle');
});

// --- AC-2: malformed input never throws -------------------------------------

test('AS-27 loop-status: malformed lock and pid files degrade to a reason, never a throw', () => {
  const bad = [
    ['unparsable file', { error: 'unparsable' }, 'unparsable'],
    ['JSON that is not an object', 'a string', 'unparsable'],
    ['JSON array', [1, 2], 'unparsable'],
    ['missing startedAt', { pid: 1, source: 'loop' }, 'bad-startedAt'],
    ['non-ISO startedAt', { pid: 1, source: 'loop', startedAt: 'yesterday' }, 'bad-startedAt'],
    ['null startedAt', { pid: 1, source: 'loop', startedAt: null }, 'bad-startedAt'],
  ];
  for (const [name, lock, reason] of bad) {
    const got = derive(lock, pidAt(3_000));
    assert.equal(got.tick, null, `${name}: never a tick`);
    assert.equal(got.state, 'idle', `${name}: falls through to the watcher`);
    assert.equal(got.staleLock.reason, reason, name);
    assert.equal(typeof got.staleLock.reason, 'string', `${name}: reason is a string`);
  }

  const badWatcher = [
    ['unparsable file', { error: 'unparsable' }, 'unparsable'],
    ['JSON that is not an object', 42, 'unparsable'],
    ['no heartbeatAt (pre-AS-27 watcher)', { pid: 96123, startedAt: iso(NOW) }, 'no-heartbeat'],
    ['non-ISO heartbeatAt', { pid: 1, heartbeatAt: 'now-ish' }, 'bad-heartbeat'],
  ];
  for (const [name, watcher, reason] of badWatcher) {
    const got = derive(null, watcher);
    assert.equal(got.state, 'off', `${name}: not listening`);
    assert.equal(got.watcher.listening, false, name);
    assert.equal(got.watcher.reason, reason, name);
  }

  // Both files garbage at once, and both absent: still a well-formed answer.
  for (const [lock, watcher] of [[{ error: 'x' }, { error: 'x' }], [null, null], [undefined, undefined]]) {
    const got = derive(lock, watcher);
    assert.deepEqual(Object.keys(got).sort(), ['checkedAt', 'staleLock', 'state', 'tick', 'watcher']);
    assert.ok(['loop', 'tick', 'idle', 'off'].includes(got.state));
  }
});

// --- AC-3: the nonce never leaves the server --------------------------------

test('AS-27 loop-status: the AS-16 nonce is never copied into the derived object', () => {
  const NONCE = 'deadbeefcafef00d';
  // Fresh and stale legs both: a nonce must not ride out on either path.
  for (const ageMs of [60_000, STALE_MS + 1]) {
    const status = derive(lockAt(ageMs, { nonce: NONCE, source: 'watcher' }), pidAt(3_000, { nonce: NONCE }));
    const json = JSON.stringify(status);
    assert.equal(json.includes(NONCE), false, `age ${ageMs}ms: nonce value absent from the payload`);
    assert.equal(json.includes('nonce'), false, `age ${ageMs}ms: not even the key`);
  }
  // The tick object is a fixed, enumerated field set — a lock body that grows
  // a new secret cannot be shipped by accident.
  const t = derive(lockAt(60_000, { nonce: NONCE, secret: 'hunter2' }), pidAt(3_000)).tick;
  assert.deepEqual(Object.keys(t).sort(), ['ageS', 'pid', 'source', 'startedAt']);
});

test('AS-27 loop-status: a startedAt in the future (host clock skew) reads as age 0, never negative', () => {
  const skewed = derive(lockAt(-30_000), pidAt(-5_000));
  assert.equal(skewed.tick.ageS, 0);
  assert.equal(skewed.watcher.ageS, 0);
  assert.equal(skewed.state, 'loop', 'skew does not invent a stale lock');
});
