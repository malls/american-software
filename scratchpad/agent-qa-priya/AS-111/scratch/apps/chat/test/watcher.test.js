// AS-7 watcher decision-logic tests. Imports decide/isLockStale from the
// watcher module and drives them with fixture objects and injected clocks —
// zero child processes, zero real locks. AS-13 adds makeLockOps tests against
// real lockfiles in per-test temp dirs: container-local fs only, never a bind
// mount, so the mountless container invariant (AS-7 plan §9) still holds.
// main() is never executed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { decide, isLockStale, DEFAULTS, loadConfig, makeLockOps, tickChildEnv, tickArgv, loadPermissionRules, fireNonce, writeWatcherPid } from '../watch/advance-watcher.mjs';
// AS-92: the tick child's PATH.
import { GH_CANDIDATES, resolveGhBin, tickPathPrepend } from '../watch/advance-watcher.mjs';
// AS-75: the deploy half.
import {
  IMAGE_INPUTS, NOT_IMAGE_INPUTS, classifyImagePaths,
  DOCKER_CANDIDATES, resolveDockerBin, resolveGitBin, parseLsTree,
  watchSourceDigest, isPrunableLog, pruneLogs, decideDeploy, makeDeployOps, runDockerCompose,
} from '../watch/advance-watcher.mjs';

// AS-16: fixed per-fire nonce for the pin tests — production nonces come from
// fireNonce(); pins inject a constant so the expected strings stay exact.
const NONCE = 'deadbeefcafef00d';

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
  assert.equal(ops.acquireLock(NONCE), true);
  const written = JSON.parse(readFileSync(lockPath, 'utf8'));
  assert.equal(written.pid, 1111);
  assert.equal(written.source, 'watcher');
  assert.equal(written.nonce, NONCE, 'AS-16: lock body carries the injected per-fire nonce');
  ops.releaseLock();
  assert.ok(!existsSync(lockPath), 'release unlinks our own lock');
});

test('makeLockOps: fresh foreign lock is respected — acquire false, file untouched', (t) => {
  const { lockPath, ops } = lockFixture(t);
  const body = foreignLockBody();
  writeFileSync(lockPath, body);
  assert.equal(ops.acquireLock(NONCE), false);
  assert.equal(readFileSync(lockPath, 'utf8'), body, 'foreign lock byte-identical');
  ops.releaseLock();
  assert.ok(existsSync(lockPath), 'release never unlinks a foreign lock');
});

test('makeLockOps: stale locks (dead pid / old startedAt / unparsable) are stolen; verify passes', (t) => {
  // Dead pid.
  const dead = lockFixture(t, { isPidAlive: (pid) => pid !== 2222 });
  writeFileSync(dead.lockPath, foreignLockBody());
  assert.equal(dead.ops.acquireLock(NONCE), true);
  assert.equal(JSON.parse(readFileSync(dead.lockPath, 'utf8')).pid, 1111);
  assert.ok(dead.logs.some((l) => l.startsWith('STEAL stale lock (dead-pid')));

  // Alive but over-age.
  const old = lockFixture(t);
  writeFileSync(
    old.lockPath,
    foreignLockBody({ startedAt: new Date(Date.now() - STALE_MS - 60_000).toISOString() })
  );
  assert.equal(old.ops.acquireLock(NONCE), true);
  assert.equal(JSON.parse(readFileSync(old.lockPath, 'utf8')).pid, 1111);
  assert.ok(old.logs.some((l) => l.startsWith('STEAL stale lock (age')));

  // Unparsable lockfile.
  const junk = lockFixture(t);
  writeFileSync(junk.lockPath, 'not json{');
  assert.equal(junk.ops.acquireLock(NONCE), true);
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
  assert.equal(ops.acquireLock(NONCE), false);
  assert.ok(existsSync(lockPath), 'lock left in place for its new owner');
  assert.ok(logs.some((l) => l.startsWith('STEAL-LOST')), 'loss is logged');
  // releaseLock also sees the foreign pid through the injected reader: no-op.
  ops.releaseLock();
  assert.ok(existsSync(lockPath));
});

test('AS-84 makeLockOps: release is by pid AND source — a deploy-source instance leaves a watcher-source lock alone, and vice versa', (t) => {
  // The two instances this models are real and simultaneous: makeWatcher's lock
  // ops (source 'watcher') and makeDeployOps' own (source 'deploy'), over ONE
  // file, in ONE process — so their pids are equal by construction and a
  // pid-only release test cannot tell them apart. It used to let shutdown()
  // unlink the lock guarding a running build (AS-75 F5).
  const dir = mkdtempSync(join(tmpdir(), 'watcher-lock-source-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const lockPath = join(dir, 'advance.lock');
  const logs = [];
  const make = (source) =>
    makeLockOps({ lockPath, staleMs: STALE_MS, log: (l) => logs.push(l), pid: 1111, isPidAlive: () => true, source });
  const watcher = make('watcher');
  const deploy = make('deploy');

  assert.equal(watcher.acquireLock(NONCE), true);
  deploy.releaseLock();
  assert.ok(existsSync(lockPath), "the deploy must not release the watcher's lock");
  assert.equal(JSON.parse(readFileSync(lockPath, 'utf8')).source, 'watcher');

  // ...and the same in the other direction, which is the F5 case exactly.
  watcher.releaseLock();
  assert.ok(!existsSync(lockPath), 'its own owner still releases it');
  assert.equal(deploy.acquireLock(NONCE), true);
  watcher.releaseLock();
  assert.ok(existsSync(lockPath), "shutdown must not release the deploy's lock");
  assert.equal(JSON.parse(readFileSync(lockPath, 'utf8')).source, 'deploy');
  deploy.releaseLock();
  assert.ok(!existsSync(lockPath));
});

test('AS-84 makeLockOps: verify-after-create requires our nonce, not just our pid', (t) => {
  // Same ambiguity one function up: after our wx-create, a same-pid sibling may
  // have unlinked and re-created the lock as its own. Its body carries OUR pid,
  // so pid alone reads as success; the nonce is per-write and does not.
  const theirs = JSON.stringify({ pid: 1111, startedAt: new Date().toISOString(), source: 'deploy', nonce: 'ffffffffffffffff' });
  const { lockPath, logs, ops } = lockFixture(t, { readFile: () => theirs });
  assert.equal(ops.acquireLock(NONCE), false, 'the file on disk is not the one we wrote');
  assert.ok(existsSync(lockPath), 'left in place for its owner');
  assert.ok(logs.some((l) => l.startsWith('STEAL-LOST')), 'and the loss is logged');
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
    // the child's marker names THIS watcher/fire, not an ancestor's:
    ADVANCE_TICK_PARENT: 'watcher:99999:aaaaaaaaaaaaaaaa',
  };
  assert.deepEqual(tickChildEnv(fat, 4242, NONCE), {
    PATH: '/opt/bin:/usr/bin',
    HOME: '/Users/forrest',
    USER: 'forrest',
    LOGNAME: 'forrest',
    ADVANCE_TICK_PARENT: `watcher:4242:${NONCE}`,
  });
  // Marker format (AS-16): "watcher:<pid>:<nonce>", the exact pid and per-fire
  // nonce passed in.
  assert.match(tickChildEnv({}, 17730, NONCE).ADVANCE_TICK_PARENT, /^watcher:\d+:[0-9a-f]{16}$/);
  assert.equal(tickChildEnv({}, 17730, NONCE).ADVANCE_TICK_PARENT, `watcher:17730:${NONCE}`);
  // Default watcherPid is this process — the watcher passes its own pid.
  // Nonce has no default (a defaulted random would be nondeterministic).
  assert.equal(tickChildEnv({}, undefined, NONCE).ADVANCE_TICK_PARENT, `watcher:${process.pid}:${NONCE}`);
  // Key set is stable even when the source env is thin (launchd).
  assert.deepEqual(Object.keys(tickChildEnv({}, 1, NONCE)).sort(), [
    'ADVANCE_TICK_PARENT',
    'HOME',
    'LOGNAME',
    'PATH',
    'USER',
  ]);
  // AS-92: a non-empty prepend goes in front of the untouched original PATH;
  // the key set is still exactly five.
  assert.deepEqual(tickChildEnv(fat, 4242, NONCE, ['/usr/local/bin', '/opt/homebrew/bin']), {
    PATH: '/usr/local/bin:/opt/homebrew/bin:/opt/bin:/usr/bin',
    HOME: '/Users/forrest',
    USER: 'forrest',
    LOGNAME: 'forrest',
    ADVANCE_TICK_PARENT: `watcher:4242:${NONCE}`,
  });
});

// --- AS-92: the tick child's PATH — docker and gh directories ----------------

// The 2026-09-07 plist PATH, before it was hand-edited: node, ~/.local/bin
// (claude), /usr/bin, /bin — and nothing that holds docker or gh.
const THIN_PATH = '/Users/x/.nvm/versions/node/v24.13.1/bin:/Users/x/.local/bin:/usr/bin:/bin';
// The 2026-09-08 hand-edited plist PATH (AS-92 comment 1).
const FAT_PATH = '/Users/x/.nvm/versions/node/v24.13.1/bin:/Users/x/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin';
// This host today: docker in /usr/local/bin, gh in /opt/homebrew/bin, and
// neither in the other's directory (plan §0.3).
const hostExists = (p) => p === '/usr/local/bin/docker' || p === '/opt/homebrew/bin/gh';

test('AS-92 tickPathPrepend: a thin PATH gains the docker and gh directories, docker first', () => {
  assert.deepEqual(tickPathPrepend({ PATH: THIN_PATH }, hostExists), {
    add: ['/usr/local/bin', '/opt/homebrew/bin'],
    present: [],
    unresolved: [],
  });
});

test('AS-92 tickPathPrepend: directories already on PATH are reported present, never repeated, and PATH is not reordered', () => {
  const env = { PATH: FAT_PATH };
  const result = tickPathPrepend(env, hostExists);
  assert.deepEqual(result, {
    add: [],
    present: ['/usr/local/bin', '/opt/homebrew/bin'],
    unresolved: [],
  });
  // The plist's own order is the plist's business: nothing prepended, the
  // child's PATH is the operator's PATH byte-for-byte.
  assert.equal(tickChildEnv(env, 1, NONCE, result.add).PATH, FAT_PATH);
});

test('AS-92 tickPathPrepend: ADVANCE_TICK_PATH_EXTRA goes first, splits on \':\', drops empties, de-duplicates', () => {
  const env = { PATH: THIN_PATH, ADVANCE_TICK_PATH_EXTRA: ':/opt/tools::/usr/local/bin:' };
  const result = tickPathPrepend(env, hostExists);
  // docker's directory appears once — in the extra's position, not again
  // from the resolver — and the empties around the separators are gone.
  assert.deepEqual(result.add, ['/opt/tools', '/usr/local/bin', '/opt/homebrew/bin']);
  assert.equal(result.add.filter((d) => d === '/usr/local/bin').length, 1, 'de-duplicated');
  assert.deepEqual(result.present, []);
  assert.deepEqual(result.unresolved, []);
  // Extras are never existence-checked and never land in `unresolved`:
  // /opt/tools does not exist per hostExists and is still added.
  assert.equal(hostExists('/opt/tools'), false);
});

test('AS-92 tickPathPrepend / tickChildEnv: nothing resolvable passes PATH through verbatim', () => {
  const none = tickPathPrepend({ PATH: THIN_PATH }, () => false);
  assert.deepEqual(none, { add: [], present: [], unresolved: ['docker:not-found', 'gh:not-found'] });
  // The launchd thin-env case: an absent PATH stays absent — not '', and not
  // the string 'undefined' — because the join must never run on an empty prepend.
  const thin = tickChildEnv({}, 1, NONCE, []);
  assert.equal(thin.PATH, undefined);
  assert.equal(Object.hasOwn(thin, 'PATH'), true, 'the key is still pinned');
  assert.equal(tickChildEnv({}, 1, NONCE).PATH, undefined, 'the defaulted fourth argument is the same as []');
  // A typo'd docker override is loud in `unresolved` and contributes no directory.
  const typo = tickPathPrepend({ PATH: THIN_PATH, ADVANCE_DOCKER_BIN: '/nope' }, hostExists);
  assert.deepEqual(typo.unresolved, ['docker:override-missing']);
  assert.deepEqual(typo.add, ['/opt/homebrew/bin'], 'gh still resolves; no docker directory');
});

test('AS-92 resolveGhBin: override, override-missing (no fall-through), candidates in order, not-found; GH_CANDIDATES pinned', () => {
  const exists = (p) => p === '/opt/homebrew/bin/gh' || p === '/usr/local/bin/gh' || p === '/real/gh';
  // Cardinality first: five branches, five cases.
  const cases = [
    ['override present', { ADVANCE_GH_BIN: '/real/gh' }, exists, { bin: '/real/gh', reason: 'override' }],
    ['override missing', { ADVANCE_GH_BIN: '/typo/gh' }, exists, { bin: null, reason: 'override-missing' }],
    ['first candidate', {}, exists, { bin: '/opt/homebrew/bin/gh', reason: 'candidate' }],
    ['second candidate', {}, (p) => p === '/usr/local/bin/gh', { bin: '/usr/local/bin/gh', reason: 'candidate' }],
    ['none found', {}, () => false, { bin: null, reason: 'not-found' }],
  ];
  assert.equal(cases.length, 5, 'five branches examined');
  for (const [name, env, probe, expected] of cases) {
    assert.deepEqual(resolveGhBin(env, probe), expected, name);
  }
  // Stated twice, like docker's: a typo'd override must NOT quietly resolve to
  // a candidate that happens to exist.
  assert.equal(resolveGhBin({ ADVANCE_GH_BIN: '/typo/gh' }, exists).bin, null);
  // Pinned exactly: Homebrew first, /usr/local/bin second, nothing else.
  assert.deepEqual([...GH_CANDIDATES], ['/opt/homebrew/bin/gh', '/usr/local/bin/gh']);
  assert.ok(Object.isFrozen(GH_CANDIDATES));
});

// --- AS-20: tick spawn argv pin ----------------------------------------------

test('tickArgv: pins the exact spawn argv — marker rides as the /advance prompt argument', () => {
  // Headless ticks cannot read env vars (the permission layer denies the
  // read, AS-20), so the parent-lock marker's CONTRACT transport is the
  // /advance slash-command argument; ADVANCE_TICK_PARENT is belt only.
  // Changing this array means changing tickArgv AND this test, deliberately.
  assert.deepEqual(tickArgv(4242, NONCE, 'acceptEdits'), [
    '-p',
    `/advance watcher:4242:${NONCE}`,
    '--permission-mode',
    'acceptEdits',
    '--output-format',
    'text',
  ]);
  // Marker format (AS-16): "/advance watcher:<pid>:<nonce>", the exact pid
  // and per-fire nonce passed in — the same values acquireLock(nonce) writes
  // into advance.lock.
  assert.match(tickArgv(17730, NONCE, 'plan')[1], /^\/advance watcher:\d+:[0-9a-f]{16}$/);
  assert.equal(tickArgv(17730, NONCE, 'plan')[1], `/advance watcher:17730:${NONCE}`);
  // Permission mode passes through verbatim.
  assert.equal(tickArgv(1, NONCE, 'plan')[3], 'plan');
  // Defaults: this process's pid, DEFAULTS.permissionMode. Nonce has no
  // default — fire() always supplies one.
  assert.deepEqual(tickArgv(undefined, NONCE), [
    '-p',
    `/advance watcher:${process.pid}:${NONCE}`,
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
  assert.deepEqual(tickArgv(4242, NONCE, 'acceptEdits', rules), [
    '-p',
    `/advance watcher:4242:${NONCE}`,
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
  assert.ok(tickArgv(1, NONCE, 'plan', rules).includes('Bash(git push --force*)'));

  // allow-only: no --disallowedTools flag at all (a bare variadic flag with
  // zero args would eat whatever followed; nothing follows, but the flag is
  // still omitted when its list is empty).
  assert.deepEqual(tickArgv(4242, NONCE, 'acceptEdits', { allow: ['Bash(node *)'], deny: [] }), [
    '-p',
    `/advance watcher:4242:${NONCE}`,
    '--permission-mode',
    'acceptEdits',
    '--output-format',
    'text',
    '--allowedTools',
    'Bash(node *)',
  ]);
  // deny-only: --disallowedTools group alone.
  assert.deepEqual(tickArgv(4242, NONCE, 'acceptEdits', { allow: [], deny: ['Bash(git push -f*)'] }), [
    '-p',
    `/advance watcher:4242:${NONCE}`,
    '--permission-mode',
    'acceptEdits',
    '--output-format',
    'text',
    '--disallowedTools',
    'Bash(git push -f*)',
  ]);
  // Both empty: byte-identical to the no-rules argv (back-compat).
  assert.deepEqual(
    tickArgv(4242, NONCE, 'acceptEdits', { allow: [], deny: [] }),
    tickArgv(4242, NONCE, 'acceptEdits')
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
  const argv = tickArgv(4242, NONCE, 'acceptEdits', loadPermissionRules(path));
  assert.deepEqual(argv.slice(-4), [
    '--disallowedTools',
    'Bash(git push --force*)',
    'Bash(git push -f*)',
    'Bash(git push origin +*)',
  ]);
  assert.ok(argv.includes('--allowedTools'));
});

// --- AS-16: per-fire nonce ----------------------------------------------------

test('fireNonce: 16 lowercase hex chars (64 bits), fresh per call', () => {
  const a = fireNonce();
  const b = fireNonce();
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.match(b, /^[0-9a-f]{16}$/);
  assert.notEqual(a, b, 'two fires never share a nonce');
});

test('nonce threading: one fire\'s nonce is identical across lock body, argv marker, and env marker', (t) => {
  // Pins both sides of the contract advance.md step 0 reads (the step 0
  // matcher itself is prose, not testable JS): the lock the watcher writes
  // and the markers the spawned tick receives carry the SAME per-fire nonce,
  // so a full source+pid+nonce match is possible exactly when the tick really
  // is this lock's child.
  const nonce = fireNonce();
  const { lockPath, ops } = lockFixture(t);
  assert.equal(ops.acquireLock(nonce), true);
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  assert.equal(lock.nonce, nonce);
  assert.equal(tickArgv(1111, nonce, 'acceptEdits')[1], `/advance watcher:1111:${nonce}`);
  assert.equal(
    tickChildEnv({}, 1111, nonce).ADVANCE_TICK_PARENT,
    `watcher:1111:${nonce}`,
    'belt marker agrees with the contract marker'
  );
  // All three artifacts express the same pid:nonce pair.
  assert.equal(tickArgv(1111, nonce, 'plan')[1], `/advance ${tickChildEnv({}, 1111, nonce).ADVANCE_TICK_PARENT}`);
  assert.equal(`watcher:${lock.pid}:${lock.nonce}`, tickChildEnv({}, 1111, nonce).ADVANCE_TICK_PARENT);
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

// --- AS-27: the watcher pid file is also a heartbeat -------------------------

test('writeWatcherPid: atomic {pid, startedAt, heartbeatAt}; heartbeats advance without losing startedAt', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'watcher-pid-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'advance-watcher.pid');
  const startedAt = '2026-09-03T18:00:00.000Z';

  writeWatcherPid({ path, pid: 96123, startedAt, now: startedAt });

  // The complete body, not the presence of one member: an extra field here is
  // as much a finding as a missing one (the file is read by lib/loop-status.js
  // and by this watcher's own single-instance check).
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), {
    pid: 96123,
    startedAt,
    heartbeatAt: startedAt,
  });

  // tmp + rename left nothing behind: no partial file is ever observable, and
  // the directory holds exactly the one file we meant to write.
  assert.deepEqual(readdirSync(dir), ['advance-watcher.pid']);

  // A later heartbeat advances heartbeatAt and preserves pid + startedAt.
  const later = '2026-09-03T18:00:05.000Z';
  writeWatcherPid({ path, pid: 96123, startedAt, now: later });
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), {
    pid: 96123,
    startedAt,
    heartbeatAt: later,
  });
  assert.deepEqual(readdirSync(dir), ['advance-watcher.pid'], 'still no .tmp residue');

  // R1: the single-instance check reads `pid` and nothing else, so the added
  // key cannot change its verdict. Asserted on the real file, not a fixture.
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).pid, 96123);
});

// --- AS-75: the deploy decision and its shell --------------------------------

test('AS-75 resolveDockerBin: an override that does not exist is loud, never a fall-through', () => {
  const exists = (p) => p === '/usr/local/bin/docker' || p === '/real/docker';
  // Cardinality first: four branches, four cases.
  const cases = [
    ['override present', { ADVANCE_DOCKER_BIN: '/real/docker' }, { bin: '/real/docker', reason: 'override' }],
    ['override missing', { ADVANCE_DOCKER_BIN: '/typo/docker' }, { bin: null, reason: 'override-missing' }],
    ['first candidate', {}, { bin: '/usr/local/bin/docker', reason: 'candidate' }],
    ['none found', {}, { bin: null, reason: 'not-found' }],
  ];
  assert.equal(cases.length, 4, 'four branches examined');
  for (const [name, env, expected] of cases) {
    const probe = name === 'none found' ? () => false : exists;
    assert.deepEqual(resolveDockerBin(env, probe), expected, name);
  }

  // The override-missing case is the one worth stating twice: a typo must NOT
  // quietly resolve to a candidate that happens to exist, or the operator's
  // explicit instruction is silently ignored and the log says nothing.
  assert.equal(resolveDockerBin({ ADVANCE_DOCKER_BIN: '/typo/docker' }, exists).bin, null);

  // The candidate list is ordered and non-empty — an empty one would make the
  // 'not-found' case above pass vacuously.
  assert.ok(DOCKER_CANDIDATES.length >= 3);
  assert.equal(DOCKER_CANDIDATES[0], '/usr/local/bin/docker');
});

test('AS-75 resolveGitBin: absolute when it exists, bare name otherwise, override always wins', () => {
  assert.equal(resolveGitBin({}, (p) => p === '/usr/bin/git'), '/usr/bin/git');
  assert.equal(resolveGitBin({}, () => false), 'git');
  assert.equal(resolveGitBin({ ADVANCE_GIT_BIN: '/opt/git' }, () => false), '/opt/git');
});

test('AS-75 parseLsTree: a short input set is a refusal, and the digest ignores git output order', () => {
  const line = (i, p) => `100644 blob ${String(i % 10).repeat(40)}\tapps/chat/${p}`;
  const full = IMAGE_INPUTS.map((p, i) => line(i, p));
  assert.equal(full.length, 10, 'ten input lines built');

  const ok = parseLsTree(full.join('\n'), IMAGE_INPUTS);
  assert.equal(ok.reason, 'ok');
  assert.match(ok.id, /^[0-9a-f]{16}$/);
  assert.equal(ok.count, 10);

  // AC-3: a digest over 9 of 10 would be stable, wrong, and would stop
  // triggering rebuilds forever. It must refuse instead.
  for (const short of [full.slice(1), full.slice(0, 4), []]) {
    const r = parseLsTree(short.join('\n'), IMAGE_INPUTS);
    assert.equal(r.id, null, `${short.length} lines: no digest`);
    assert.equal(r.reason, 'inputs-missing');
    assert.equal(r.expected, 10);
  }
  // ...and so does a LONGER set (a path matched twice, or a stray line).
  assert.equal(parseLsTree([...full, line(9, 'extra')].join('\n'), IMAGE_INPUTS).reason, 'inputs-missing');

  // Order invariance: git's output order must not change the id.
  const shuffled = [...full].reverse();
  assert.notDeepEqual(shuffled, full, 'the reordering is real');
  assert.equal(parseLsTree(shuffled.join('\n'), IMAGE_INPUTS).id, ok.id);

  // Content sensitivity: a changed blob changes the id, or nothing would ever
  // trigger a rebuild.
  const changed = [...full];
  changed[3] = line(7, IMAGE_INPUTS[3]);
  assert.notEqual(parseLsTree(changed.join('\n'), IMAGE_INPUTS).id, ok.id);

  // Blank lines and trailing whitespace are not inputs.
  assert.equal(parseLsTree(full.join('\n') + '\n\n  \n', IMAGE_INPUTS).id, ok.id);
});

test('AS-86 classifyImagePaths: strays are named, roots cover their children, and names are not prefixes', () => {
  // A literal fixture, not the real index: this is the pure half of the guard,
  // and it has to be able to contain paths the real repo must never have. The
  // four strays are the realistic ones — compose auto-merges an override file,
  // compose interpolates .env, BuildKit reads a per-Dockerfile ignore file, and
  // a stray doc is the general case.
  const fixture = [
    'compose.override.yaml',
    'lib/store.js',
    '.env',
    'data/export/a.jsonl',
    'Dockerfile.dockerignore',
    '.dockerignore',
    'chat',
    'docs/x.md',
    'Dockerfile',
    'README.md',
  ];
  assert.equal(fixture.length, 10, 'ten fixture paths classified');

  const { inputs, declared, unclassified } = classifyImagePaths(fixture);
  // The point of the whole export: an unknown tracked path is NAMED, in input
  // order, not quietly absorbed into either known bucket.
  assert.deepEqual(unclassified, ['compose.override.yaml', '.env', 'Dockerfile.dockerignore', 'docs/x.md']);
  // Dockerfile.dockerignore is the name-boundary case: `Dockerfile` is an
  // image input, and a startsWith without the separator would swallow it.
  assert.deepEqual(inputs, ['lib/store.js', '.dockerignore', 'Dockerfile']);
  assert.deepEqual(declared, ['data/export/a.jsonl', 'chat', 'README.md']);
  assert.equal(inputs.length + declared.length + unclassified.length, fixture.length);

  // Roots classify as themselves, and the two root sets are disjoint, so
  // inputs-beat-declared precedence never actually decides a path.
  assert.deepEqual(classifyImagePaths(IMAGE_INPUTS).unclassified, []);
  assert.deepEqual(classifyImagePaths(NOT_IMAGE_INPUTS).inputs, []);
  assert.deepEqual(classifyImagePaths([]), { inputs: [], declared: [], unclassified: [] });
});

test('AS-75 watchSourceDigest: order-independent, content-sensitive, and name-boundary safe', () => {
  const a = [{ name: 'advance-watcher.mjs', content: 'x' }, { name: 'helper.mjs', content: 'y' }];
  const id = watchSourceDigest(a);
  assert.match(id, /^[0-9a-f]{16}$/);
  assert.equal(watchSourceDigest([...a].reverse()), id, 'readdir order is not part of the digest');
  assert.notEqual(watchSourceDigest([{ ...a[0], content: 'z' }, a[1]]), id, 'a content change moves it');
  assert.notEqual(watchSourceDigest([{ name: 'other.mjs', content: 'x' }, a[1]]), id, 'a rename moves it');
  // NUL delimiting: bytes may not migrate across the name/content boundary.
  assert.notEqual(
    watchSourceDigest([{ name: 'ab.mjs', content: 'c' }]),
    watchSourceDigest([{ name: 'a.mjs', content: 'bc' }]),
  );
  assert.equal(watchSourceDigest([]), watchSourceDigest([]), 'an empty set is stable');
});

test('AS-75 pruneLogs: tick and deploy logs share one retention rule', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'chat-prune-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  assert.equal(isPrunableLog('tick-2026.log'), true);
  assert.equal(isPrunableLog('deploy-2026.log'), true);
  assert.equal(isPrunableLog('advance-watcher.log'), false, 'the watcher log is never pruned');
  assert.equal(isPrunableLog('deploy-2026.log.old'), false);

  const names = ['tick-old.log', 'deploy-old.log', 'tick-new.log', 'deploy-new.log', 'advance-watcher.log'];
  for (const n of names) writeFileSync(join(dir, n), 'x');
  assert.equal(readdirSync(dir).length, 5, 'five files planted');

  const old = new Set(['tick-old.log', 'deploy-old.log']);
  pruneLogs(dir, 1_000, {
    readdir: () => names,
    stat: (full) => ({ mtimeMs: old.has(full.split('/').pop()) ? 0 : 2_000 }),
  });
  assert.deepEqual(readdirSync(dir).sort(), ['advance-watcher.log', 'deploy-new.log', 'tick-new.log']);
});

// The decision table from the plan, rule by rule. The ORDER is the
// specification, so the ordering properties are asserted explicitly rather
// than left to follow from the individual cases.
const NOW75 = Date.parse('2026-09-04T12:00:00.000Z');
const dep = (over = {}) => ({
  desired: { id: 'newnewnewnewnewn', dirty: false },
  running: { id: 'oldoldoldoldoldo' },
  watcherSourceChanged: false,
  busy: false,
  dockerBin: '/usr/local/bin/docker',
  lastAttempt: null,
  now: NOW75,
  cooldownMs: 30 * 60 * 1000,
  ...over,
});

test('AS-75 decideDeploy: every rule in the table, in the table\'s order', () => {
  const cases = [
    ['1 busy', dep({ busy: true, desired: null }), 'noop', 'busy'],
    ['2 no git', dep({ desired: null }), 'noop', 'no-git'],
    ['3 dirty', dep({ desired: { id: 'newnewnewnewnewn', dirty: true } }), 'noop', 'inputs-dirty'],
    ['4 watcher source changed', dep({ running: { id: 'newnewnewnewnewn' }, watcherSourceChanged: true }), 'restart-watcher', 'watcher-source-changed'],
    ['5 current', dep({ running: { id: 'newnewnewnewnewn' } }), 'noop', 'current'],
    ['6 no docker', dep({ dockerBin: null }), 'noop', 'no-docker'],
    ['7 cooldown', dep({ lastAttempt: { id: 'newnewnewnewnewn', outcome: 'fail', at: NOW75 - 60_000 } }), 'noop', 'cooldown'],
    ['8 stale build', dep(), 'deploy', 'stale-build'],
  ];
  assert.equal(cases.length, 8, 'eight rules examined');
  const reasons = [];
  for (const [name, input, action, reason] of cases) {
    const got = decideDeploy(input);
    assert.equal(got.action, action, `${name}: action`);
    assert.equal(got.reason, reason, `${name}: reason`);
    reasons.push(reason);
  }
  assert.equal(new Set(reasons).size, 8, 'eight distinct reasons — no rule is unreachable');

  // Rule 4 BEATS rule 5: both are eligible when the container is current, and
  // the watcher must restart rather than sit still.
  const both45 = dep({ running: { id: 'newnewnewnewnewn' }, watcherSourceChanged: true });
  assert.equal(decideDeploy(both45).action, 'restart-watcher');
  assert.equal(decideDeploy({ ...both45, watcherSourceChanged: false }).action, 'noop');

  // Rule 8 BEATS rule 4: when BOTH artifacts are stale, the container is
  // brought current first and the restart happens on a later cycle. One action
  // per evaluation, never interleaved.
  const both48 = dep({ watcherSourceChanged: true });
  assert.equal(decideDeploy(both48).action, 'deploy');
  assert.equal(decideDeploy(both48).reason, 'stale-build');

  // Rule 1 beats everything, including a deploy that would otherwise fire.
  assert.equal(decideDeploy(dep({ busy: true })).action, 'noop');
  assert.equal(decideDeploy(dep({ busy: true, watcherSourceChanged: true, running: { id: 'newnewnewnewnewn' } })).reason, 'busy');
});

test('AS-75 decideDeploy: the cooldown suppresses only a repeat of a FAILED attempt at the SAME id', () => {
  const failed = { id: 'newnewnewnewnewn', outcome: 'fail', at: NOW75 - 60_000 };
  assert.equal(decideDeploy(dep({ lastAttempt: failed })).reason, 'cooldown');

  // A new merge changes the id — the thing that failed is not the thing being
  // asked for any more, so it retries immediately.
  assert.equal(decideDeploy(dep({ lastAttempt: { ...failed, id: 'otherotherother1' } })).action, 'deploy');
  // A SUCCESSFUL last attempt never suppresses anything (if it were current we
  // would have stopped at rule 5).
  assert.equal(decideDeploy(dep({ lastAttempt: { ...failed, outcome: 'ok' } })).action, 'deploy');
  // And the window expires.
  assert.equal(decideDeploy(dep({ lastAttempt: { ...failed, at: NOW75 - 31 * 60 * 1000 } })).action, 'deploy');
});

test('AS-75 decideDeploy: an unreadable running id is not-current, never accidentally current', () => {
  for (const running of [null, undefined, {}, { id: null }, { id: 42 }]) {
    assert.equal(decideDeploy(dep({ running })).action, 'deploy', JSON.stringify(running));
  }
  // ...and it is pure: no fs, no clock, no process. Frozen inputs, twice.
  const input = Object.freeze(dep());
  assert.deepEqual(decideDeploy(input), decideDeploy(input));
});

/** A makeDeployOps with every collaborator injected: no git, no docker, no
 *  network, no real clock. The lock is real, in a temp dir, exactly as the
 *  AS-13 makeLockOps tests do it. */
function deployHarness(t, { preState, ...over } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'chat-deployops-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // AS-84: `preState` is a deploy-state.json that exists BEFORE the ops are
  // constructed — the ctor hydrates lastAttempt out of it, so writing it after
  // makeDeployOps() would prove nothing.
  if (preState) writeFileSync(join(dir, 'deploy-state.json'), JSON.stringify(preState));
  let clock = Date.now();
  const logs = [];
  const calls = { deploy: [], exit: [] };
  const state = {
    lsTree: IMAGE_INPUTS.map((p, i) => `100644 blob ${String(i % 10).repeat(40)}\tapps/chat/${p}`).join('\n'),
    lsTreeCode: 0,
    porcelain: '',
    runningId: 'oldoldoldoldoldo',
    afterDeployId: null, // null -> the deploy serves what it was asked to build
    deployResult: { code: 0, signal: null, timedOut: false },
    sources: [{ name: 'advance-watcher.mjs', content: 'v1' }],
  };
  const ops = makeDeployOps({
    repoRoot: '/repo',
    appDir: '/repo/apps/chat',
    watchDir: '/repo/apps/chat/watch',
    logsDir: dir,
    statePath: join(dir, 'deploy-state.json'),
    lockPath: join(dir, 'advance.lock'),
    lockStaleMs: DEFAULTS.lockStaleMin * 60 * 1000,
    cooldownMs: DEFAULTS.deployCooldownMin * 60 * 1000,
    deployTimeoutMs: DEFAULTS.deployTimeoutMin * 60 * 1000,
    retentionMs: 14 * 24 * 60 * 60 * 1000,
    log: (line) => logs.push(line),
    env: { ADVANCE_DOCKER_BIN: '/fake/docker', PATH: '/bin', HOME: '/h', USER: 'u', LOGNAME: 'u', SECRET: 'nope' },
    exists: (p) => p === '/fake/docker' || p === '/usr/bin/git',
    now: () => clock,
    run: (bin, args) => {
      if (args[0] === 'ls-tree') return { code: state.lsTreeCode, stdout: state.lsTree, stderr: 'boom' };
      return { code: 0, stdout: state.porcelain, stderr: '' };
    },
    fetchJson: async () => (state.runningId === null ? null : { build: { id: state.runningId } }),
    deploy: async (opts) => {
      calls.deploy.push(opts);
      state.runningId = state.afterDeployId ?? opts.env.CHAT_BUILD_ID;
      return state.deployResult;
    },
    readSources: () => state.sources,
    exit: (code) => calls.exit.push(code),
    sleep: async () => {},
    reprobeAttempts: 2,
    reprobeDelayMs: 0,
    pid: 4242,
    isPidAlive: () => true,
    // AS-88: required, no default. 'asc-test' is deliberately NOT the production
    // name: a harness must choose, and this one never reaches a real compose.
    composeProject: 'asc-test',
    ...over,
  });
  return {
    ops, state, logs, calls, dir,
    lockPath: join(dir, 'advance.lock'),
    advance: (ms) => { clock += ms; },
    readState: () => JSON.parse(readFileSync(join(dir, 'deploy-state.json'), 'utf8')),
  };
}

test('AS-95 makeDeployOps: pendingDeploy() answers "a rebuild is owed and can run", and never blocks the loop forever', async (t) => {
  const h = deployHarness(t);
  // Before the first evaluate the ops have decided nothing. "No opinion" must
  // read as "do not wait" — a loop that waited on an unasked question would
  // stall on every watcher start.
  assert.equal(h.ops.pendingDeploy(), false, 'no decision yet');

  // A tick holds the lock: evaluate defers ('busy'). This is exactly the
  // between-ticks window the loop must yield in, so tick N+1 sees tick N's
  // merged code rather than the image that predates it.
  h.state.runningId = 'oldoldoldoldoldo';
  const busy = await h.ops.evaluate({ busy: true });
  assert.equal(busy.reason, 'busy');
  assert.equal(h.ops.pendingDeploy(), true, 'deferred rebuild is still owed');

  // Once it has actually deployed, nothing is owed and the loop proceeds.
  const deployed = await h.ops.evaluate({ busy: false });
  assert.equal(deployed.action, 'deploy');
  const current = await h.ops.evaluate({ busy: false });
  assert.equal(current.reason, 'current');
  assert.equal(h.ops.pendingDeploy(), false, 'the running build is master');

  // The falsifier for "never blocks forever": with no docker binary the watcher
  // CANNOT deploy, so a stale build is a permanent condition. Waiting on it
  // would hang the loop for as long as docker stayed missing — the loop must
  // run anyway, and the sidebar reports the staleness instead.
  const noDocker = deployHarness(t, { env: { PATH: '/bin', HOME: '/h', USER: 'u', LOGNAME: 'u' }, exists: (p) => p === '/usr/bin/git' });
  const stuck = await noDocker.ops.evaluate({ busy: false });
  assert.equal(stuck.reason, 'no-docker');
  assert.equal(noDocker.ops.dockerBin, null);
  assert.equal(noDocker.ops.pendingDeploy(), false, 'unresolvable docker never makes the loop wait');
});

// AS-102 — evaluate() has a second caller now (the tick's settle(), beside the
// interval), so "at most one evaluation at a time" has to be a property the
// ops hold rather than a spacing accident of one setInterval.

/** A deployHarness whose probe is gated: evaluate() parks at probeRunning()
 *  until the test releases it, and every probe is counted. */
function gatedProbeHarness(t, over = {}) {
  const gate = { release: null, probes: 0 };
  const h = deployHarness(t, {
    fetchJson: async () => {
      gate.probes += 1;
      await new Promise((ok) => { gate.release = ok; });
      return h.state.runningId === null ? null : { build: { id: h.state.runningId } };
    },
    ...over,
  });
  return { h, gate, settle: () => new Promise((ok) => setImmediate(ok)) };
}

test('AS-102 makeDeployOps: concurrent evaluate() calls coalesce — the second returns the first\'s promise and evaluateInner runs once', async (t) => {
  const { h, gate, settle } = gatedProbeHarness(t);
  h.state.runningId = h.ops.computeDesired().desired.id; // nothing owed: the decision will be 'current'

  const first = h.ops.evaluate({ busy: true });
  const second = h.ops.evaluate({ busy: false });
  assert.equal(second, first, 'the joiner gets the SAME promise, not a second evaluation');
  assert.equal(gate.probes, 1, 'one probe for two calls');

  gate.release();
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(a, { action: 'noop', reason: 'busy' }, "the first caller's busy:true won");
  assert.deepEqual(b, a);
  await settle();
  assert.equal(gate.probes, 1, 'still one probe after both resolved');
});

test('AS-102 makeDeployOps: after the in-flight evaluation resolves, the next evaluate() runs fresh (inflight is cleared on resolve AND on throw)', async (t) => {
  // On resolve.
  const { h, gate } = gatedProbeHarness(t);
  h.state.runningId = h.ops.computeDesired().desired.id;
  const first = h.ops.evaluate({});
  gate.release();
  await first;
  const next = h.ops.evaluate({});
  assert.notEqual(next, first, 'a new promise: the guard released');
  assert.equal(gate.probes, 2, 'a second probe ran');
  gate.release();
  assert.equal((await next).reason, 'current');

  // On throw. evaluate() turns a throwing collaborator into {noop, error}
  // (AS-84) — the guard must release on that path too, or one broken poll
  // would pin every later one to a stale error decision.
  let boom = true;
  const g = deployHarness(t, {
    fetchJson: async () => {
      if (boom) throw new Error('probe exploded');
      return { build: { id: g.state.runningId } };
    },
  });
  g.state.runningId = g.ops.computeDesired().desired.id;
  const errored = await g.ops.evaluate({});
  assert.equal(errored.reason, 'error');
  boom = false;
  const recovered = await g.ops.evaluate({});
  assert.equal(recovered.reason, 'current', 'the evaluation after a throw is a fresh one');
});

test('AS-102 makeDeployOps: a coalesced call cannot start a second performDeploy — one build, one lock take, one running-id re-probe', async (t) => {
  // Two callers arrive while the first is still probing, and the container is
  // stale, so the decision is 'deploy'. Before the guard both could pass the
  // `deploying` check (it is set inside performDeploy, two awaits past entry),
  // both decide deploy, and race for the lock.
  let takes = 0;
  const dir = mkdtempSync(join(tmpdir(), 'chat-as102-lock-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const lockPath = join(dir, 'advance.lock');
  const realLock = makeLockOps({ lockPath, staleMs: 60_000, log: () => {}, pid: 4242, isPidAlive: () => true, source: 'deploy' });
  const lockOps = { ...realLock, acquireLock: (nonce) => { takes += 1; return realLock.acquireLock(nonce); } };
  const { h, gate } = gatedProbeHarness(t, { lockOps, lockPath });

  const first = h.ops.evaluate({});
  const second = h.ops.evaluate({});
  assert.equal(second, first);
  gate.release(); // the initial probe
  // performDeploy's reprobe() probes again after the build and parks at the
  // gate too (reprobeAttempts is 2; the first attempt succeeds). Release it.
  while (gate.probes < 2) await new Promise((ok) => setImmediate(ok));
  gate.release();
  const decision = await first;
  assert.equal(decision.action, 'deploy');
  assert.equal(h.calls.deploy.length, 1, 'ONE build');
  assert.equal(takes, 1, 'ONE deploy-source lock take');
  assert.equal(gate.probes, 2, 'one pre-decision probe plus one re-probe — a second evaluation would have added two more');
  assert.equal(existsSync(lockPath), false, 'and the lock was given back');
});

test('AS-102 makeDeployOps: evaluate({busy:false}) after a \'busy\' record overwrites lastDecision, so pendingDeploy() reads false when nothing is owed', async (t) => {
  // The symptom: every poll that overlapped a tick recorded 'busy', and nothing
  // re-decided until the next interval. settle() now calls evaluate again with
  // busy:false; this is the half that makes that call worth making.
  const h = deployHarness(t);
  h.state.runningId = h.ops.computeDesired().desired.id; // the running build IS master
  assert.deepEqual(await h.ops.evaluate({ busy: true }), { action: 'noop', reason: 'busy' });
  assert.equal(h.ops.pendingDeploy(), true, 'the record says busy');
  assert.deepEqual(await h.ops.evaluate({ busy: false }), { action: 'noop', reason: 'current' });
  assert.equal(h.ops.pendingDeploy(), false, 'one honest evaluation clears it');
  assert.equal(h.calls.deploy.length, 0, 'nothing was owed, nothing was built');
});

test('AS-75 makeDeployOps: a stale container is rebuilt with the right env, and success means the RUNNING id changed', async (t) => {
  const h = deployHarness(t);
  const decision = await h.ops.evaluate({ busy: false });
  assert.equal(decision.action, 'deploy');
  assert.equal(decision.reason, 'stale-build');
  assert.equal(h.calls.deploy.length, 1, 'exactly one deploy');

  const call = h.calls.deploy[0];
  assert.equal(call.dockerBin, '/fake/docker');
  assert.equal(call.cwd, '/repo/apps/chat');
  assert.match(call.logPath, /\/deploy-.*\.log$/);
  // The two BuildKit toggles are mandatory: under the legacy builder compose
  // ignores the linux/amd64 pin at build time and the image refuses to start.
  assert.equal(call.env.DOCKER_BUILDKIT, '1');
  assert.equal(call.env.COMPOSE_DOCKER_CLI_BUILD, '1');
  // The build id rides in through the environment — `docker compose up` has no
  // --build-arg.
  assert.match(call.env.CHAT_BUILD_ID, /^[0-9a-f]{16}$/);
  // Minimal env, same principle as tickChildEnv: an unrelated host variable
  // must not leak into the build.
  assert.deepEqual(Object.keys(call.env).sort(),
    ['CHAT_BUILD_ID', 'COMPOSE_DOCKER_CLI_BUILD', 'DOCKER_BUILDKIT', 'HOME', 'LOGNAME', 'PATH', 'USER']);

  assert.equal(h.ops.lastAttempt().outcome, 'ok');
  assert.equal(h.ops.lastAttempt().id, call.env.CHAT_BUILD_ID);
  assert.equal(h.ops.isDeploying(), false, 'the flag is cleared afterwards');

  // The lock was taken and given back.
  assert.equal(existsSync(h.lockPath), false, 'released');

  // A second evaluate now finds the container current and does nothing.
  const second = await h.ops.evaluate({});
  assert.deepEqual(second, { action: 'noop', reason: 'current' });
  assert.equal(h.calls.deploy.length, 1, 'still exactly one deploy');
});

test('AS-75 makeDeployOps: exit code 0 with a mismatched re-probe is a FAILURE, not a success', async (t) => {
  // AC-12. A deploy is not successful because a command exited 0 — it is
  // successful because the thing that is running changed. This is the case
  // where compose reports victory and the old container is still serving.
  const h = deployHarness(t, {});
  h.state.afterDeployId = 'stillthesameold1';

  const decision = await h.ops.evaluate({});
  assert.equal(decision.action, 'deploy');
  assert.equal(h.calls.deploy.length, 1);
  assert.equal(h.state.deployResult.code, 0, 'the command really did exit 0');

  const attempt = h.ops.lastAttempt();
  assert.equal(attempt.outcome, 'fail');
  assert.match(attempt.detail, /^id-mismatch/);
  assert.match(attempt.detail, /stillthesameold1/, 'the detail names what is actually serving');

  // ...and the cooldown now suppresses the retry at that same id.
  const second = await h.ops.evaluate({});
  assert.deepEqual(second, { action: 'noop', reason: 'cooldown' });
  assert.equal(h.calls.deploy.length, 1, 'no second attempt inside the cooldown');

  // A non-zero exit is also a failure, with its code named.
  const g = deployHarness(t);
  g.state.deployResult = { code: 137, signal: 'SIGKILL', timedOut: true };
  await g.ops.evaluate({});
  assert.equal(g.ops.lastAttempt().outcome, 'fail');
  assert.match(g.ops.lastAttempt().detail, /exit 137 \(timeout\)/);
});

test('AS-75 makeDeployOps: a deploy takes advance.lock with source "deploy" for its duration', async (t) => {
  // AC-10, second half. Real lockfile, observed from inside the deploy.
  let observed = null;
  const inner = deployHarness(t, {
    deploy: async (opts) => {
      observed = JSON.parse(readFileSync(inner.lockPath, 'utf8'));
      inner.state.runningId = opts.env.CHAT_BUILD_ID;
      return { code: 0, signal: null, timedOut: false };
    },
  });
  await inner.ops.evaluate({});
  assert.ok(observed, 'the lock file existed while the build ran');
  assert.equal(observed.source, 'deploy', 'the sidebar reads "Tick in flight · deploy"');
  assert.equal(observed.pid, 4242);
  assert.match(observed.nonce, /^[0-9a-f]{16}$/, 'the AS-16 nonce is present, like any other lock');
  assert.equal(existsSync(inner.lockPath), false, 'and released on the way out');
});

test('AS-75 makeDeployOps: a fresh foreign lock yields noop/busy and spawns nothing', async (t) => {
  // AC-10, first half. A /loop session mid-tick may be writing to the chat API;
  // rebuilding under it would restart the server mid-write.
  const h = deployHarness(t);
  writeFileSync(h.lockPath, JSON.stringify({ pid: 5285, startedAt: new Date().toISOString(), source: 'loop', nonce: 'aa' }));

  assert.deepEqual(await h.ops.evaluate({}), { action: 'noop', reason: 'busy' });
  assert.equal(h.calls.deploy.length, 0, 'nothing spawned');
  assert.equal(h.readState().reason, 'busy', 'and the board is told why');

  // Our own in-flight tick counts too, via the caller's flag.
  const g = deployHarness(t);
  assert.deepEqual(await g.ops.evaluate({ busy: true }), { action: 'noop', reason: 'busy' });
  assert.equal(g.calls.deploy.length, 0);

  // A STALE foreign lock does not block: it belonged to a crashed tick.
  const stale = deployHarness(t);
  writeFileSync(stale.lockPath, JSON.stringify({
    pid: 5285, source: 'loop', nonce: 'aa',
    startedAt: new Date(Date.now() - (DEFAULTS.lockStaleMin + 5) * 60 * 1000).toISOString(),
  }));
  assert.equal((await stale.ops.evaluate({})).action, 'deploy');
});

test('AS-75 makeDeployOps: a dirty image-input tree refuses, and a broken git refuses differently', async (t) => {
  // AC-11. "Merged code is live" means COMMITTED code; deploying a dirty tree
  // would bake uncommitted bytes under a label claiming to be HEAD.
  const h = deployHarness(t);
  h.state.porcelain = ' M apps/chat/server.js\n';
  assert.deepEqual(await h.ops.evaluate({}), { action: 'noop', reason: 'inputs-dirty' });
  assert.equal(h.calls.deploy.length, 0, 'no spawn');
  assert.equal(h.readState().dirty, true);
  assert.ok(h.logs.some((l) => /dirty/.test(l)), 'and it is logged');

  // git unavailable.
  const g = deployHarness(t);
  g.state.lsTreeCode = 128;
  assert.deepEqual(await g.ops.evaluate({}), { action: 'noop', reason: 'no-git' });
  assert.equal(g.calls.deploy.length, 0);
  assert.equal(g.readState().desiredReason, 'no-git');

  // A SHORT input set is its own refusal, distinguishable in the state file —
  // it is the digest going quietly wrong, not git being absent.
  const s = deployHarness(t);
  s.state.lsTree = s.state.lsTree.split('\n').slice(1).join('\n');
  assert.deepEqual(await s.ops.evaluate({}), { action: 'noop', reason: 'no-git' });
  assert.equal(s.readState().desiredReason, 'inputs-missing');
  assert.ok(s.logs.some((l) => /9 of 10 image inputs/.test(l)));
});

test('AS-75 makeDeployOps: no docker binary is a refusal that names the remedy, not a crash', async (t) => {
  const h = deployHarness(t, { env: { PATH: '/bin' }, exists: (p) => p === '/usr/bin/git' });
  assert.deepEqual(await h.ops.evaluate({}), { action: 'noop', reason: 'no-docker' });
  assert.equal(h.calls.deploy.length, 0);
  const st = h.readState();
  assert.equal(st.dockerBin, null);
  assert.equal(st.dockerReason, 'not-found');
  assert.equal(st.reason, 'no-docker');
});

test('AS-75 makeDeployOps: a watcher-source change exits 70 and leaves the pid file alone', async (t) => {
  // The container must be current first — rule 8 beats rule 4 — so bring it
  // current, then change the source.
  const h = deployHarness(t);
  await h.ops.evaluate({});
  assert.equal(h.calls.exit.length, 0, 'no restart while the container was stale');

  h.state.sources = [{ name: 'advance-watcher.mjs', content: 'v2' }];
  const decision = await h.ops.evaluate({});
  assert.deepEqual(decision, { action: 'restart-watcher', reason: 'watcher-source-changed' });
  assert.deepEqual(h.calls.exit, [70], 'non-zero: relaunches under KeepAlive:true AND {SuccessfulExit:false}');
  assert.ok(h.logs.some((l) => /RESTART watcher source changed/.test(l)));
  assert.equal(existsSync(h.lockPath), false, 'any lock we held is released first');
  // The pid file is NOT ours to unlink here: a gap would blink the sidebar to
  // 'Off · no watcher' on every self-update.
  assert.equal(h.logs.some((l) => /unlink/.test(l)), false);

  // A non-.mjs change is the caller's business (readSources filters), but an
  // unreadable source directory must never trigger a restart on its own.
  const g = deployHarness(t, { readSources: () => { throw new Error('EACCES'); } });
  assert.equal((await g.ops.evaluate({})).action, 'deploy', 'still deploys the container');
  assert.equal(g.calls.exit.length, 0, 'but never restarts itself on a digest it cannot compute');
});

test('AS-75 makeDeployOps: deploy-state.json is written on every poll, atomically, for the server to read', async (t) => {
  const h = deployHarness(t);
  await h.ops.evaluate({});
  const st = h.readState();
  // The exact contract server.js reads. An extra or missing key here is as much
  // a finding as a wrong value.
  assert.deepEqual(Object.keys(st).sort(), [
    'computedAt', 'desiredId', 'desiredReason', 'dirty', 'dockerBin', 'dockerReason',
    'lastAttempt', 'reason', 'runningId',
  ]);
  assert.match(st.desiredId, /^[0-9a-f]{16}$/);
  assert.equal(st.dirty, false);
  assert.equal(st.dockerBin, '/fake/docker');
  assert.ok(Number.isFinite(Date.parse(st.computedAt)));
  assert.equal(st.lastAttempt.outcome, 'ok');
  assert.ok(Number.isFinite(Date.parse(st.lastAttempt.at)), 'lastAttempt.at is an ISO string, not ms');
  // tmp + rename left nothing behind.
  assert.equal(readdirSync(h.dir).some((n) => n.endsWith('.tmp')), false);
});

// --- AS-84: the deploy survives its own watcher's restart, and its shutdown --

/** The desired id the default harness fixture digests to. Computed rather than
 *  hard-coded: it is a digest of IMAGE_INPUTS, and AS-86 is changing that set
 *  in a sibling lane. */
function desiredIdOf(t) {
  return deployHarness(t).ops.computeDesired().desired.id;
}

/** Spin (microtask + macrotask) until `pred` or the bound runs out. Used to
 *  reach the inside of an in-flight deploy without sleeping on a real clock. */
async function until(pred, what, turns = 200) {
  for (let i = 0; i < turns; i++) {
    if (pred()) return;
    await new Promise((ok) => setImmediate(ok));
  }
  assert.fail(`never reached: ${what}`);
}

test('AS-84 makeDeployOps: lastAttempt is hydrated from deploy-state.json — a failed attempt at the desired id, inside the cooldown, refuses without building', async (t) => {
  // lastAttempt used to be memory-only: persist() wrote it and nothing read it
  // back, so a watchdog-relaunched watcher started with a blank cooldown and
  // re-ran a build that had just failed — the crash loop the cooldown exists to
  // bound, restarted from zero by every relaunch.
  const id = desiredIdOf(t);
  const at = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const h = deployHarness(t, {
    preState: { lastAttempt: { id, at, outcome: 'fail', detail: 'exit 1' } },
  });

  assert.deepEqual(await h.ops.evaluate({}), { action: 'noop', reason: 'cooldown' });
  assert.equal(h.calls.deploy.length, 0, 'nothing was built');
  const hydrated = h.ops.lastAttempt();
  assert.equal(hydrated.id, id);
  assert.equal(hydrated.outcome, 'fail');
  assert.equal(hydrated.at, Date.parse(at), 'at comes back as ms — decideDeploy does arithmetic on it');

  // And it is a COOLDOWN, not a permanent refusal: past the window it builds.
  h.advance(31 * 60 * 1000);
  assert.equal((await h.ops.evaluate({})).action, 'deploy');
});

test("AS-84 makeDeployOps: an interrupted attempt ('started' on disk) counts as a failure for the cooldown", async (t) => {
  // The record performDeploy writes before spawning compose. Finding one still
  // saying 'started' means the process died under its own build — no `finally`
  // ran — which is exactly the case a blank slate would retry immediately.
  const id = desiredIdOf(t);
  const at = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const h = deployHarness(t, {
    preState: { lastAttempt: { id, at, outcome: 'started', detail: 'building' } },
  });

  assert.deepEqual(await h.ops.evaluate({}), { action: 'noop', reason: 'cooldown' });
  assert.equal(h.calls.deploy.length, 0);
  assert.equal(h.ops.lastAttempt().outcome, 'fail', 'an unfinished attempt is a failed one');
  assert.match(h.ops.lastAttempt().detail, /interrupted/);

  // Junk in that slot is not a cooldown at all — a record we cannot date must
  // never suppress a deploy.
  for (const bad of [null, 'nope', {}, { id, at: 'not-a-date', outcome: 'fail' }, { id, at, outcome: 'weird' }]) {
    const g = deployHarness(t, { preState: { lastAttempt: bad } });
    assert.equal(g.ops.lastAttempt(), null, JSON.stringify(bad));
    assert.equal((await g.ops.evaluate({})).action, 'deploy', JSON.stringify(bad));
  }
});

test("AS-84 makeDeployOps: the 'started' record is on disk before compose is spawned", async (t) => {
  // Observed from INSIDE the deploy, which is the only place the ordering is
  // visible: if the write happened after, a SIGKILLed watcher would leave the
  // previous attempt's record and the relaunch would read a stale verdict.
  let seen = null;
  let building = null;
  const h = deployHarness(t, {
    deploy: async (opts) => {
      seen = JSON.parse(readFileSync(join(h.dir, 'deploy-state.json'), 'utf8')).lastAttempt;
      building = opts.env.CHAT_BUILD_ID;
      h.state.runningId = opts.env.CHAT_BUILD_ID;
      return { code: 0, signal: null, timedOut: false };
    },
  });

  const decision = await h.ops.evaluate({});
  assert.equal(decision.action, 'deploy');
  assert.ok(seen, 'a state file existed when compose was spawned');
  assert.equal(seen.outcome, 'started');
  assert.equal(seen.id, building, 'and it names the build being started');
  assert.equal(seen.detail, 'building');
  assert.ok(Number.isFinite(Date.parse(seen.at)), 'ISO on disk, like every other attempt record');
  // The finished attempt overwrites it — 'started' is a window, not a state.
  assert.equal(h.readState().lastAttempt.outcome, 'ok');
  assert.equal(h.ops.lastAttempt().outcome, 'ok');
});

test('AS-84 makeDeployOps: abort() signals the running build, records an abort rather than a failure, and gives the lock back', async (t) => {
  // AS-75 F5: the compose child lived inside runDockerCompose's closure, so
  // shutdown() could not signal it — the build kept running under a lock that
  // shutdown had already unlinked. onSpawn hands the child out; abort() signals
  // it and resolves only once the deploy has settled itself.
  const fake = { signals: [], kill(sig) { this.signals.push(sig); return true; } };
  let resolveDeploy = null;
  let builds = 0;
  const h = deployHarness(t, {
    deploy: (opts) => {
      builds += 1;
      if (builds === 1) {
        opts.onSpawn(fake);
        return new Promise((ok) => { resolveDeploy = ok; });
      }
      h.state.runningId = opts.env.CHAT_BUILD_ID; // the retry succeeds
      return Promise.resolve({ code: 0, signal: null, timedOut: false });
    },
  });

  const evaluating = h.ops.evaluate({});
  await until(() => h.ops.isDeploying() && resolveDeploy !== null, 'the build started');
  assert.ok(existsSync(h.lockPath), 'the deploy holds its own lock while it builds');

  const aborting = h.ops.abort();
  assert.deepEqual(fake.signals, ['SIGTERM'], 'the compose child was signalled');
  resolveDeploy({ code: null, signal: 'SIGTERM', timedOut: false });
  await aborting;

  // abort() resolving MEANS settled: the attempt is recorded and the lock is
  // back. A promise that resolved earlier would let shutdown exit mid-build.
  assert.equal(h.ops.lastAttempt().outcome, 'aborted');
  assert.match(h.ops.lastAttempt().detail, /aborted by shutdown \(SIGTERM\)/);
  assert.equal(existsSync(h.lockPath), false, 'released by its owner');
  assert.equal(h.ops.isDeploying(), false);
  await evaluating;

  // And it is NOT a cooldown. A build the operator interrupted must retry at
  // once — otherwise `launchctl kickstart -k` mid-build delays the very deploy
  // it was meant to hurry (decideDeploy rule 7 matches 'fail' only).
  const retry = await h.ops.evaluate({});
  assert.equal(retry.action, 'deploy');
  assert.equal(retry.reason, 'stale-build');
  assert.equal(builds, 2);
  assert.equal(h.ops.lastAttempt().outcome, 'ok');

  // A child that TRAPS SIGTERM and exits with a code reports signal null, so
  // "aborted" has to follow the request we made, not the manner of the death —
  // reading result.signal here would record 143 as a plain failure and put the
  // merge in a cooldown. (Both real compose and the process test's fake docker
  // exit this way.)
  const trapped = deployHarness(t, {
    deploy: async (opts) => {
      opts.onSpawn(fake);
      queueMicrotask(() => void trapped.ops.abort());
      return new Promise((ok) => setImmediate(() => ok({ code: 143, signal: null, timedOut: false })));
    },
  });
  await trapped.ops.evaluate({});
  assert.equal(trapped.ops.lastAttempt().outcome, 'aborted');

  // A TIMEOUT is still a failure: nobody asked for that one, and the cooldown
  // is what stops the watcher from re-running a 15-minute build on every poll.
  const g = deployHarness(t, {
    deploy: async (opts) => {
      opts.onSpawn(fake);
      return { code: null, signal: 'SIGTERM', timedOut: true };
    },
  });
  await g.ops.evaluate({});
  assert.equal(g.ops.lastAttempt().outcome, 'fail');
  assert.match(g.ops.lastAttempt().detail, /timeout/);
});

test('AS-84 makeDeployOps: abort() while idle resolves immediately and touches nothing', async (t) => {
  // shutdown() calls abort() whenever isDeploying() says so, but a watcher that
  // is merely idle must not acquire a lock, write a state file or log a line on
  // its way out — the quiet path has to stay quiet.
  const h = deployHarness(t);
  await h.ops.abort();
  assert.equal(existsSync(h.lockPath), false, 'no lock taken');
  assert.equal(existsSync(join(h.dir, 'deploy-state.json')), false, 'no state written');
  assert.deepEqual(h.logs, [], 'and nothing logged');
  assert.equal(h.ops.lastAttempt(), null);
});

test('AS-84 makeDeployOps: evaluate() never rejects — a throwing collaborator becomes {noop, error}, persisted, logged once', async (t) => {
  // AS-75 F6. The call site is a setInterval callback and Node terminates on an
  // unhandled rejection, so a throw anywhere in the poll would take down the
  // watcher — and with it every future tick.
  const h = deployHarness(t, {
    run: () => { throw new Error('git exploded'); },
  });

  const first = await h.ops.evaluate({});
  assert.equal(first.action, 'noop');
  assert.equal(first.reason, 'error');
  assert.equal(first.detail, 'git exploded');
  assert.equal(h.readState().reason, 'error', 'the sidebar is told, in the same file as every other reason');
  assert.equal(h.readState().desiredReason, 'error');

  // A broken poll must not make the AS-95 loop wait forever for a rebuild that
  // is never going to happen.
  assert.equal(h.ops.pendingDeploy(), false);

  // One WARN per condition, not one per 60s poll (AS-13 #4's rule).
  await h.ops.evaluate({});
  assert.equal(h.logs.filter((l) => /^WARN deploy poll failed: git exploded$/.test(l)).length, 1);
  assert.equal(h.calls.deploy.length, 0);
});

test('AS-84 runDockerCompose: a compose log stream error is logged, not thrown — the build still resolves', async () => {
  // Ruben's cycle-1 F2. `createLog(logPath)` is a WriteStream; an EACCES/ENOENT
  // on logsDir arrives as an EventEmitter 'error' event, which is an uncaught
  // exception (not a rejection) when nothing listens — outside evaluate()'s
  // try/catch and deployPoll's .catch, so it took the whole watcher down.
  const { EventEmitter, once } = await import('node:events');
  const { PassThrough } = await import('node:stream');
  const logs = [];
  const out = new PassThrough();
  const proc = new EventEmitter();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.kill = () => true;
  const pending = runDockerCompose({
    dockerBin: '/nonexistent/docker', cwd: '/', env: {}, logPath: '/nonexistent/deploy.log', timeoutMs: 60_000,
    log: (l) => logs.push(l),
    composeProject: 'asc-test', // AS-88: required; spawn is faked
    spawnFn: () => proc,
    createLog: () => out,
  });
  // The stream fails the way fs does: asynchronously, while the build is running.
  const seen = once(out, 'error').catch(() => {});
  out.emit('error', new Error('EACCES: permission denied, open deploy.log'));
  await seen;
  proc.emit('exit', 0, null);
  const result = await pending;
  assert.deepEqual(result, { code: 0, signal: null, timedOut: false });
  assert.deepEqual(logs, ['WARN deploy log stream error: EACCES: permission denied, open deploy.log']);
});

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
    assert.ok(stamps[i] > stamps[i - 1], `computedAt advances on poll ${i}: ${stamps[i - 1]} -> ${stamps[i]}`);
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
    composeProject: 'asc-chat', // AS-88: required; this pin is the production shape
    spawnFn: (bin, args, opts) => { spawns.push({ bin, args, opts }); return proc; },
    createLog: () => new PassThrough(),
  });
  proc.emit('exit', 0, null);
  await pending;
  assert.equal(spawns.length, 1, 'one spawn examined');
  assert.equal(spawns[0].bin, '/fake/docker');
  // Exact pin on purpose: a flag reorder or a new flag is a deliberate edit here.
  // AS-88 edited it (AS-87 owns the test): `-p <project>` now precedes the
  // subcommand — a compose global flag — so the target is explicit in argv.
  assert.deepEqual(spawns[0].args, ['compose', '-p', 'asc-chat', '--progress', 'plain', 'up', '-d', '--build']);
  assert.ok(!spawns[0].args.includes('quiet'));
});

/** AS-88: a runDockerCompose with the spawn and the log sink faked, returning
 *  what it captured. `proc` is emitted `exit` by the caller. */
function fakeCompose(over = {}) {
  const spawns = [];
  const logsOpened = [];
  const proc = new EventEmitter();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.kill = () => true;
  const run = () => runDockerCompose({
    dockerBin: '/fake/docker', cwd: '/repo/apps/chat', env: { PATH: '/bin' }, logPath: '/nonexistent/deploy.log', timeoutMs: 60_000,
    log: () => {},
    spawnFn: (bin, args, opts) => { spawns.push({ bin, args, opts }); return proc; },
    createLog: (path) => { logsOpened.push(path); return new PassThrough(); },
    ...over,
  });
  return { run, proc, spawns, logsOpened };
}

test('AS-88 runDockerCompose names the caller\'s project: -p carries composeProject, not a literal', async () => {
  // AC-1's second half. With only the pin above, replacing `composeProject` in
  // argv with the literal 'asc-chat' would still pass; a custom name here makes
  // "dropped -p" and "hard-coded asc-chat" distinguishable mutants.
  const c = fakeCompose({ composeProject: 'asc-scratch-1' });
  const pending = c.run();
  c.proc.emit('exit', 0, null);
  const result = await pending;
  assert.equal(c.spawns.length, 1, 'one spawn examined');
  assert.deepEqual(c.spawns[0].args, ['compose', '-p', 'asc-scratch-1', '--progress', 'plain', 'up', '-d', '--build']);
  assert.equal(result.code, 0);
});

test('AS-88 runDockerCompose refuses an implicit project: no composeProject -> throws before opening the log or spawning', () => {
  // AC-2. The order matters: the guard sits above createLog, so a refused call
  // leaves no empty deploy-*.log behind and no compose child running.
  const shapes = [{}, { composeProject: undefined }, { composeProject: '' }, { composeProject: '   ' }, { composeProject: 42 }];
  assert.equal(shapes.length, 5, 'five implicit shapes examined');
  for (const over of shapes) {
    const c = fakeCompose(over);
    assert.throws(() => c.run(), /composeProject is required/, `throws for ${JSON.stringify(over)}`);
    assert.equal(c.spawns.length, 0, `no spawn for ${JSON.stringify(over)}`);
    assert.equal(c.logsOpened.length, 0, `no log opened for ${JSON.stringify(over)}`);
  }
});

test('AS-88 performDeploy passes composeProject through to deploy() and names it in the DEPLOY building line', async (t) => {
  // AC-3. The harness never reaches a real compose; what it proves is that the
  // project the ops were constructed with is the one every deploy carries.
  const h = deployHarness(t, { composeProject: 'asc-scratch-1' });
  const decision = await h.ops.evaluate({ busy: false });
  assert.equal(decision.action, 'deploy');
  assert.equal(h.calls.deploy.length, 1, 'one deploy examined');
  assert.equal(h.calls.deploy[0].composeProject, 'asc-scratch-1');
  assert.equal(h.ops.composeProject, 'asc-scratch-1', 'the returned field agrees');
  const building = h.logs.filter((l) => l.startsWith('DEPLOY building'));
  assert.equal(building.length, 1, 'one building line examined');
  assert.match(building[0], /^DEPLOY building [0-9a-f]{16} \(project asc-scratch-1\) -> /);
});

test('AS-88 makeDeployOps refuses a COMPOSE_PROJECT_NAME the scrub would discard (AS-75 review F8)', (t) => {
  // AC-4, the F8 headline, with Ruben's exact input: the harness expressed
  // isolation through the variable, the ops were built for the live project.
  // Before AS-88 this constructed silently and the deploy hit `asc-chat`.
  const env = { ADVANCE_DOCKER_BIN: '/fake/docker', PATH: '/bin', HOME: '/h', USER: 'u', LOGNAME: 'u', COMPOSE_PROJECT_NAME: 'asc-scratch-1' };
  let calls = null;
  assert.throws(
    () => { const h = deployHarness(t, { env, composeProject: 'asc-chat' }); calls = h.calls; },
    (err) => {
      assert.match(err.message, /COMPOSE_PROJECT_NAME=asc-scratch-1/);
      assert.match(err.message, /'asc-chat'/);
      assert.match(err.message, /pass composeProject/);
      return true;
    },
  );
  assert.equal(calls, null, 'construction never returned, so no deploy could have been called');
  // The disagreement is symmetric: the PRODUCTION name in the variable with a
  // scratch composeProject is still two intents, and still refused.
  assert.throws(
    () => deployHarness(t, { env: { ...env, COMPOSE_PROJECT_NAME: 'asc-chat' }, composeProject: 'asc-scratch-1' }),
    /COMPOSE_PROJECT_NAME=asc-chat .* would target 'asc-scratch-1'/,
  );
});

test('AS-88 makeDeployOps accepts an agreeing or empty COMPOSE_PROJECT_NAME', (t) => {
  // AC-5: the refusal is not over-broad. Unset, '' (compose treats both as
  // unset — measured, plan §0.1), whitespace (NOT unset to compose: `docker
  // compose config` rejects "  " as an invalid project name — measured in the
  // AS-88 review; the guard reads it as no intent because the scrub drops it
  // before compose could ever object) and an EQUAL value all construct.
  const base = { ADVANCE_DOCKER_BIN: '/fake/docker', PATH: '/bin', HOME: '/h', USER: 'u', LOGNAME: 'u' };
  const cases = [
    { env: base, composeProject: 'asc-chat' },
    { env: { ...base, COMPOSE_PROJECT_NAME: '' }, composeProject: 'asc-chat' },
    { env: { ...base, COMPOSE_PROJECT_NAME: '  ' }, composeProject: 'asc-chat' },
    { env: { ...base, COMPOSE_PROJECT_NAME: 'asc-chat' }, composeProject: 'asc-chat' },
    { env: { ...base, COMPOSE_PROJECT_NAME: 'asc-scratch-1' }, composeProject: 'asc-scratch-1' },
  ];
  assert.equal(cases.length, 5, 'five constructions examined');
  for (const c of cases) {
    const h = deployHarness(t, c);
    assert.equal(h.ops.composeProject, c.composeProject, `constructs for ${JSON.stringify(c.env.COMPOSE_PROJECT_NAME)}`);
  }
});

test('AS-88 makeDeployOps requires composeProject: no default, throws at construction', (t) => {
  // AC-7. `over` spreads after the harness's own 'asc-test', so undefined here
  // really does reach the factory as "not provided".
  const shapes = [{ composeProject: undefined }, { composeProject: '' }, { composeProject: ' ' }, { composeProject: null }];
  assert.equal(shapes.length, 4, 'four implicit shapes examined');
  for (const over of shapes) {
    assert.throws(() => deployHarness(t, over), /composeProject is required/, `throws for ${JSON.stringify(over)}`);
  }
});
