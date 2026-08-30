// AS-7 watcher decision-logic tests. Imports decide/isLockStale from the
// watcher module and drives them with fixture objects and injected clocks —
// zero child processes, zero real locks. AS-13 adds makeLockOps tests against
// real lockfiles in per-test temp dirs: container-local fs only, never a bind
// mount, so the mountless container invariant (AS-7 plan §9) still holds.
// main() is never executed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decide, isLockStale, DEFAULTS, loadConfig, makeLockOps } from '../watch/advance-watcher.mjs';

const T0 = Date.parse('2026-08-30T12:00:00.000Z');
const CONFIG = { debounceS: 15, lockStaleMin: 45 };
const sentinel = (messageId, extra = {}) => ({
  messageId,
  authorId: 'human:forrest',
  conversationId: 7,
  createdAt: new Date(T0).toISOString(),
  ...extra,
});
const freshLock = (over = {}) => ({
  pid: 4242,
  startedAt: new Date(T0 - 60 * 1000).toISOString(), // 1 min old
  source: 'loop',
  pidAlive: true,
  ...over,
});

test('decide: missing or unparsable sentinel is a noop', () => {
  for (const s of [null, undefined, { authorId: 'human:forrest' }, { messageId: 'nope' }]) {
    const r = decide({ sentinel: s, highwater: null, lock: null, now: T0, config: CONFIG, debounceUntil: null });
    assert.equal(r.action, 'noop');
    assert.equal(r.reason, 'no-sentinel');
    assert.equal(r.debounceUntil, null);
  }
});

test('decide: sentinel at or below highwater is a noop (already fired)', () => {
  for (const hw of [{ messageId: 9 }, { messageId: 10 }]) {
    const r = decide({
      sentinel: sentinel(Math.min(hw.messageId, 9)),
      highwater: hw,
      lock: null,
      now: T0,
      config: CONFIG,
      debounceUntil: null,
    });
    assert.equal(r.action, 'noop');
    assert.equal(r.reason, 'below-highwater');
  }
  // Missing highwater file (first-ever run) counts as 0: any sentinel is new.
  const r = decide({ sentinel: sentinel(1), highwater: null, lock: null, now: T0, config: CONFIG, debounceUntil: null });
  assert.equal(r.action, 'debounce');
});

test('decide: first advance arms a 15s trailing window; further advances never extend it', () => {
  const armed = decide({
    sentinel: sentinel(10),
    highwater: { messageId: 5 },
    lock: null,
    now: T0,
    config: CONFIG,
    debounceUntil: null,
  });
  assert.equal(armed.action, 'debounce');
  assert.equal(armed.debounceUntil, T0 + 15_000);

  // 8s later a second message lands (higher id) — window must NOT move.
  const mid = decide({
    sentinel: sentinel(12),
    highwater: { messageId: 5 },
    lock: null,
    now: T0 + 8_000,
    config: CONFIG,
    debounceUntil: armed.debounceUntil,
  });
  assert.equal(mid.action, 'noop');
  assert.equal(mid.reason, 'debounce-pending');
  assert.equal(mid.debounceUntil, T0 + 15_000, 'non-extending: original expiry kept');
});

test('decide: two advances inside one window collapse to one fire at the latest messageId', () => {
  let debounceUntil = null;
  let highwater = { messageId: 5 };
  const polls = [
    { now: T0, id: 10, expect: 'debounce' },
    { now: T0 + 5_000, id: 12, expect: 'noop' }, // second message, same window
    { now: T0 + 10_000, id: 12, expect: 'noop' },
    { now: T0 + 15_000, id: 12, expect: 'fire' }, // window expired -> one fire
  ];
  let fires = 0;
  for (const p of polls) {
    const r = decide({ sentinel: sentinel(p.id), highwater, lock: null, now: p.now, config: CONFIG, debounceUntil });
    assert.equal(r.action, p.expect, `at +${(p.now - T0) / 1000}s`);
    debounceUntil = r.debounceUntil;
    if (r.action === 'fire') {
      fires++;
      highwater = { messageId: p.id }; // shell advances highwater at fire time
    }
  }
  assert.equal(fires, 1);
  assert.equal(highwater.messageId, 12, 'fired at the latest id, not the first');
  // Post-fire polls with the same sentinel: quiet.
  const after = decide({ sentinel: sentinel(12), highwater, lock: null, now: T0 + 20_000, config: CONFIG, debounceUntil });
  assert.equal(after.action, 'noop');
  assert.equal(after.reason, 'below-highwater');
});

test('decide: expired window with a fresh foreign lock skips, then fires once the lock clears', () => {
  const expired = T0 + 15_000;
  const skipped = decide({
    sentinel: sentinel(10),
    highwater: { messageId: 5 },
    lock: freshLock(),
    now: expired,
    config: CONFIG,
    debounceUntil: expired,
  });
  assert.equal(skipped.action, 'skip-locked');
  assert.equal(skipped.reason, 'lock-fresh-loop');
  assert.equal(skipped.debounceUntil, expired, 'expired window kept — no second debounce wait');

  // Lock released before the next poll: immediate fire, no re-arm.
  const next = decide({
    sentinel: sentinel(10),
    highwater: { messageId: 5 },
    lock: null,
    now: expired + 5_000,
    config: CONFIG,
    debounceUntil: skipped.debounceUntil,
  });
  assert.equal(next.action, 'fire');
  assert.equal(next.debounceUntil, null);
});

test('decide: stale locks (dead pid / age) are fired over, not respected', () => {
  const expired = T0 + 15_000;
  const base = {
    sentinel: sentinel(10),
    highwater: { messageId: 5 },
    now: expired,
    config: CONFIG,
    debounceUntil: expired,
  };
  const deadPid = decide({ ...base, lock: freshLock({ pidAlive: false }) });
  assert.equal(deadPid.action, 'fire');
  assert.equal(deadPid.reason, 'lock-stale-dead-pid');

  const tooOld = decide({
    ...base,
    lock: freshLock({ startedAt: new Date(expired - 46 * 60 * 1000).toISOString() }),
  });
  assert.equal(tooOld.action, 'fire');
  assert.equal(tooOld.reason, 'lock-stale-age');
});

test('decide: missed-while-down recovery fires exactly once from persisted state', () => {
  // Watcher restarts: highwater persisted at 5, sentinel advanced to 9 while
  // it was down. Startup poll arms, expiry fires, then quiet.
  let debounceUntil = null;
  let highwater = { messageId: 5 };
  let fires = 0;
  for (const now of [T0, T0 + 15_000, T0 + 20_000, T0 + 25_000]) {
    const r = decide({ sentinel: sentinel(9), highwater, lock: null, now, config: CONFIG, debounceUntil });
    debounceUntil = r.debounceUntil;
    if (r.action === 'fire') {
      fires++;
      highwater = { messageId: 9 };
    }
  }
  assert.equal(fires, 1, 'a message sent while down fires exactly one tick');
});

test('isLockStale: fresh, dead-pid, over-age, and unparsable startedAt', () => {
  const staleMs = 45 * 60 * 1000;
  const fresh = isLockStale(freshLock(), T0, staleMs);
  assert.deepEqual(fresh, { stale: false, reason: 'fresh' });

  assert.deepEqual(isLockStale(freshLock({ pidAlive: false }), T0, staleMs), {
    stale: true,
    reason: 'dead-pid',
  });
  const old = freshLock({ startedAt: new Date(T0 - staleMs - 1).toISOString() });
  assert.deepEqual(isLockStale(old, T0, staleMs), { stale: true, reason: 'age' });
  // Exactly at the limit: still fresh (strictly-older-than semantics).
  const atLimit = freshLock({ startedAt: new Date(T0 - staleMs).toISOString() });
  assert.equal(isLockStale(atLimit, T0, staleMs).stale, false);
  // Garbage startedAt is stale — a lock we cannot age must not wedge the company.
  assert.deepEqual(isLockStale(freshLock({ startedAt: 'garbage' }), T0, staleMs), {
    stale: true,
    reason: 'age',
  });
});

// --- AS-13: makeLockOps against a real temp-dir lockfile --------------------

const STALE_MS = 45 * 60 * 1000;

function lockFixture(t, over = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'watcher-lock-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const lockPath = join(dir, 'advance.lock');
  const logs = [];
  const ops = makeLockOps({
    lockPath,
    staleMs: STALE_MS,
    log: (line) => logs.push(line),
    pid: 1111,
    isPidAlive: () => true,
    ...over,
  });
  return { dir, lockPath, logs, ops };
}

const foreignLockBody = (over = {}) =>
  JSON.stringify({
    pid: 2222,
    startedAt: new Date().toISOString(),
    source: 'loop',
    ...over,
  });

test('makeLockOps: clean acquire creates the lock with our pid; release removes it', (t) => {
  const { lockPath, ops } = lockFixture(t);
  assert.equal(ops.acquireLock(), true);
  const written = JSON.parse(readFileSync(lockPath, 'utf8'));
  assert.equal(written.pid, 1111);
  assert.equal(written.source, 'watcher');
  ops.releaseLock();
  assert.ok(!existsSync(lockPath), 'release unlinks our own lock');
});

test('makeLockOps: fresh foreign lock is respected — acquire false, file untouched', (t) => {
  const { lockPath, ops } = lockFixture(t);
  const body = foreignLockBody();
  writeFileSync(lockPath, body);
  assert.equal(ops.acquireLock(), false);
  assert.equal(readFileSync(lockPath, 'utf8'), body, 'foreign lock byte-identical');
  ops.releaseLock();
  assert.ok(existsSync(lockPath), 'release never unlinks a foreign lock');
});

test('makeLockOps: stale locks (dead pid / old startedAt / unparsable) are stolen; verify passes', (t) => {
  // Dead pid.
  const dead = lockFixture(t, { isPidAlive: (pid) => pid !== 2222 });
  writeFileSync(dead.lockPath, foreignLockBody());
  assert.equal(dead.ops.acquireLock(), true);
  assert.equal(JSON.parse(readFileSync(dead.lockPath, 'utf8')).pid, 1111);
  assert.ok(dead.logs.some((l) => l.startsWith('STEAL stale lock (dead-pid')));

  // Alive but over-age.
  const old = lockFixture(t);
  writeFileSync(
    old.lockPath,
    foreignLockBody({ startedAt: new Date(Date.now() - STALE_MS - 60_000).toISOString() })
  );
  assert.equal(old.ops.acquireLock(), true);
  assert.equal(JSON.parse(readFileSync(old.lockPath, 'utf8')).pid, 1111);
  assert.ok(old.logs.some((l) => l.startsWith('STEAL stale lock (age')));

  // Unparsable lockfile.
  const junk = lockFixture(t);
  writeFileSync(junk.lockPath, 'not json{');
  assert.equal(junk.ops.acquireLock(), true);
  assert.equal(JSON.parse(readFileSync(junk.lockPath, 'utf8')).pid, 1111);
  assert.ok(junk.logs.some((l) => l.startsWith('STEAL stale lock (unparsable')));
});

test('makeLockOps: foreign overwrite between create and verify yields without unlink', (t) => {
  // Injected reader simulates the race: our wx-create succeeded, but by the
  // time we re-read, a stale-stealer has unlinked our lock and re-created it
  // as its own. The file is theirs — acquire must return false and must NOT
  // unlink it.
  const foreign = foreignLockBody();
  const { lockPath, logs, ops } = lockFixture(t, { readFile: () => foreign });
  assert.equal(ops.acquireLock(), false);
  assert.ok(existsSync(lockPath), 'lock left in place for its new owner');
  assert.ok(logs.some((l) => l.startsWith('STEAL-LOST')), 'loss is logged');
  // releaseLock also sees the foreign pid through the injected reader: no-op.
  ops.releaseLock();
  assert.ok(existsSync(lockPath));
});

test('config: defaults match the plan; env overrides apply; junk env falls back', () => {
  assert.equal(DEFAULTS.pollS, 5);
  assert.equal(DEFAULTS.debounceS, 15);
  assert.equal(DEFAULTS.tickTimeoutMin, 30);
  assert.equal(DEFAULTS.lockStaleMin, 45);
  assert.equal(DEFAULTS.permissionMode, 'acceptEdits');
  assert.ok(DEFAULTS.lockStaleMin > DEFAULTS.tickTimeoutMin, 'stale > timeout: child reaped before steal');

  const saved = { ...process.env };
  try {
    process.env.ADVANCE_DEBOUNCE_S = '20';
    process.env.ADVANCE_POLL_S = 'not-a-number';
    process.env.ADVANCE_PERMISSION_MODE = '';
    const cfg = loadConfig(process.env);
    assert.equal(cfg.debounceS, 20);
    assert.equal(cfg.pollS, 5, 'junk numeric env falls back to default');
    assert.equal(cfg.permissionMode, 'acceptEdits', 'empty mode falls back');
  } finally {
    process.env.ADVANCE_DEBOUNCE_S = saved.ADVANCE_DEBOUNCE_S ?? '';
    delete process.env.ADVANCE_DEBOUNCE_S;
    delete process.env.ADVANCE_POLL_S;
    delete process.env.ADVANCE_PERMISSION_MODE;
    if (saved.ADVANCE_DEBOUNCE_S !== undefined) process.env.ADVANCE_DEBOUNCE_S = saved.ADVANCE_DEBOUNCE_S;
    if (saved.ADVANCE_POLL_S !== undefined) process.env.ADVANCE_POLL_S = saved.ADVANCE_POLL_S;
    if (saved.ADVANCE_PERMISSION_MODE !== undefined) process.env.ADVANCE_PERMISSION_MODE = saved.ADVANCE_PERMISSION_MODE;
  }
});
