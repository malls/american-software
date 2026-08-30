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
import { decide, isLockStale, DEFAULTS, loadConfig, makeLockOps, tickChildEnv, tickArgv, loadPermissionRules } from '../watch/advance-watcher.mjs';

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

// --- AS-14: tick child env pin ----------------------------------------------

test('tickChildEnv: pins exactly {PATH, HOME, USER, LOGNAME, ADVANCE_TICK_PARENT} — no more, no less', () => {
  // USER/LOGNAME earn their place via claude's macOS Keychain auth (AS-14);
  // PATH/HOME per the AS-7 minimal-env rule; ADVANCE_TICK_PARENT is the
  // watcher's parent marker so a spawned tick recognizes its parent's
  // advance.lock (AS-15). Changing this set means changing tickChildEnv AND
  // this test — a deliberate act with a stated reason.
  const fat = {
    PATH: '/opt/bin:/usr/bin',
    HOME: '/Users/forrest',
    USER: 'forrest',
    LOGNAME: 'forrest',
    // Present in a real login env but must NOT leak into the child:
    SHELL: '/bin/zsh',
    TMPDIR: '/var/folders/xx',
    SSH_AUTH_SOCK: '/tmp/agent.sock',
    ANTHROPIC_MODEL: 'nope',
    // Even a pre-existing marker in the source env must not leak through —
    // the child's marker names THIS watcher, not an ancestor's:
    ADVANCE_TICK_PARENT: 'watcher:99999',
  };
  assert.deepEqual(tickChildEnv(fat, 4242), {
    PATH: '/opt/bin:/usr/bin',
    HOME: '/Users/forrest',
    USER: 'forrest',
    LOGNAME: 'forrest',
    ADVANCE_TICK_PARENT: 'watcher:4242',
  });
  // Marker format: "watcher:<pid>", the exact pid passed in.
  assert.match(tickChildEnv({}, 17730).ADVANCE_TICK_PARENT, /^watcher:\d+$/);
  assert.equal(tickChildEnv({}, 17730).ADVANCE_TICK_PARENT, 'watcher:17730');
  // Default watcherPid is this process — the watcher passes its own pid.
  assert.equal(tickChildEnv({}).ADVANCE_TICK_PARENT, `watcher:${process.pid}`);
  // Key set is stable even when the source env is thin (launchd).
  assert.deepEqual(Object.keys(tickChildEnv({}, 1)).sort(), [
    'ADVANCE_TICK_PARENT',
    'HOME',
    'LOGNAME',
    'PATH',
    'USER',
  ]);
});

// --- AS-20: tick spawn argv pin ----------------------------------------------

test('tickArgv: pins the exact spawn argv — marker rides as the /advance prompt argument', () => {
  // Headless ticks cannot read env vars (the permission layer denies the
  // read, AS-20), so the parent-lock marker's CONTRACT transport is the
  // /advance slash-command argument; ADVANCE_TICK_PARENT is belt only.
  // Changing this array means changing tickArgv AND this test, deliberately.
  assert.deepEqual(tickArgv(4242, 'acceptEdits'), [
    '-p',
    '/advance watcher:4242',
    '--permission-mode',
    'acceptEdits',
    '--output-format',
    'text',
  ]);
  // Marker format: "/advance watcher:<pid>", the exact pid passed in — the
  // same pid acquireLock() writes into advance.lock.
  assert.match(tickArgv(17730, 'plan')[1], /^\/advance watcher:\d+$/);
  assert.equal(tickArgv(17730, 'plan')[1], '/advance watcher:17730');
  // Permission mode passes through verbatim.
  assert.equal(tickArgv(1, 'plan')[3], 'plan');
  // Defaults: this process's pid, DEFAULTS.permissionMode.
  assert.deepEqual(tickArgv(), [
    '-p',
    `/advance watcher:${process.pid}`,
    '--permission-mode',
    DEFAULTS.permissionMode,
    '--output-format',
    'text',
  ]);
});

// --- AS-21: permission grants on the spawn argv -------------------------------

test('tickArgv: injected rules append --allowedTools/--disallowedTools, each rule its own element, denies last', () => {
  // Rules are always INJECTED here, never read from the repo's live settings
  // file — the pin stays an exact-array assertion under test control.
  const rules = {
    allow: ['Bash(lattice *)', 'Bash(git *)'],
    deny: ['Bash(git push --force*)'],
  };
  assert.deepEqual(tickArgv(4242, 'acceptEdits', rules), [
    '-p',
    '/advance watcher:4242',
    '--permission-mode',
    'acceptEdits',
    '--output-format',
    'text',
    '--allowedTools',
    'Bash(lattice *)',
    'Bash(git *)',
    '--disallowedTools',
    'Bash(git push --force*)',
  ]);
  // The flags are variadic and we spawn without a shell: a rule with internal
  // spaces must stay ONE argv element, never split or quoted.
  assert.ok(tickArgv(1, 'plan', rules).includes('Bash(git push --force*)'));

  // allow-only: no --disallowedTools flag at all (a bare variadic flag with
  // zero args would eat whatever followed; nothing follows, but the flag is
  // still omitted when its list is empty).
  assert.deepEqual(tickArgv(4242, 'acceptEdits', { allow: ['Bash(node *)'], deny: [] }), [
    '-p',
    '/advance watcher:4242',
    '--permission-mode',
    'acceptEdits',
    '--output-format',
    'text',
    '--allowedTools',
    'Bash(node *)',
  ]);
  // deny-only: --disallowedTools group alone.
  assert.deepEqual(tickArgv(4242, 'acceptEdits', { allow: [], deny: ['Bash(git push -f*)'] }), [
    '-p',
    '/advance watcher:4242',
    '--permission-mode',
    'acceptEdits',
    '--output-format',
    'text',
    '--disallowedTools',
    'Bash(git push -f*)',
  ]);
  // Both empty: byte-identical to the no-rules argv (back-compat).
  assert.deepEqual(
    tickArgv(4242, 'acceptEdits', { allow: [], deny: [] }),
    tickArgv(4242, 'acceptEdits')
  );
});

function settingsFixture(t, content) {
  const dir = mkdtempSync(join(tmpdir(), 'watcher-settings-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'settings.json');
  if (content !== undefined) writeFileSync(path, content);
  return path;
}

test('loadPermissionRules: valid settings file yields exact {allow, deny} from one parse', (t) => {
  const path = settingsFixture(
    t,
    JSON.stringify({
      permissions: {
        allow: ['Bash(lattice *)', 'Bash(node *)', 'Bash(git *)'],
        deny: ['Bash(git push --force*)', 'Bash(git push -f*)', 'Bash(git push origin +*)'],
      },
    })
  );
  assert.deepEqual(loadPermissionRules(path), {
    allow: ['Bash(lattice *)', 'Bash(node *)', 'Bash(git *)'],
    deny: ['Bash(git push --force*)', 'Bash(git push -f*)', 'Bash(git push origin +*)'],
  });
});

test('loadPermissionRules: missing file, malformed JSON, and non-object JSON all yield null', (t) => {
  assert.equal(loadPermissionRules(settingsFixture(t)), null, 'missing file');
  assert.equal(loadPermissionRules(settingsFixture(t, 'not json{')), null, 'malformed JSON');
  assert.equal(loadPermissionRules(settingsFixture(t, '"just a string"')), null, 'non-object JSON');
  assert.equal(loadPermissionRules(settingsFixture(t, 'null')), null, 'JSON null');
});

test('loadPermissionRules: absent/partial permissions default to empty lists; non-strings filtered', (t) => {
  assert.deepEqual(loadPermissionRules(settingsFixture(t, '{}')), { allow: [], deny: [] });
  assert.deepEqual(
    loadPermissionRules(settingsFixture(t, JSON.stringify({ permissions: { allow: ['Bash(rtk *)'] } }))),
    { allow: ['Bash(rtk *)'], deny: [] }
  );
  assert.deepEqual(
    loadPermissionRules(
      settingsFixture(t, JSON.stringify({ permissions: { allow: ['ok', 7, null, { x: 1 }], deny: 'not-an-array' } }))
    ),
    { allow: ['ok'], deny: [] }
  );
});

test('loadPermissionRules -> tickArgv composition: force-push denies ride as trailing argv elements whenever allows do', (t) => {
  // The methodology invariant (git push --force is always needs_human),
  // pinned: allows and denies come from the SAME parse of the SAME file, so
  // a tick can never fire with allows but without the force-push denies.
  const path = settingsFixture(
    t,
    JSON.stringify({
      permissions: {
        allow: ['Bash(lattice *)', 'Bash(git *)'],
        deny: ['Bash(git push --force*)', 'Bash(git push -f*)', 'Bash(git push origin +*)'],
      },
    })
  );
  const argv = tickArgv(4242, 'acceptEdits', loadPermissionRules(path));
  assert.deepEqual(argv.slice(-4), [
    '--disallowedTools',
    'Bash(git push --force*)',
    'Bash(git push -f*)',
    'Bash(git push origin +*)',
  ]);
  assert.ok(argv.includes('--allowedTools'));
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
