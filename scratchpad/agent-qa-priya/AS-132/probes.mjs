// AS-132 QA probes (Priya). Drives makeLoopOps past the plan's list.
// usage: node probes.mjs <path-to-advance-watcher.mjs>
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const modPath = process.argv[2];
const { makeLoopOps, nextPollAction, LOOP_DEFAULTS } = await import(pathToFileURL(modPath).href);

const T0 = Date.parse('2026-09-10T12:00:00.000Z');
const TEN_MIN = 10 * 60 * 1000;
const MIN = 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();
const okTick = () => ({ code: 0, signal: null, timedOut: false, headBefore: 'a', headAfter: 'b' });
const task = (over = {}) => ({ id: 't1', short_id: 'AS-1', title: 'A task', status: 'review', dependsOn: [], blockedBy: [], ...over });

function harness(over = {}) {
  const logs = [];
  const saved = [];
  let clock = T0;
  const lockRef = { body: null };
  const ops = makeLoopOps({
    loadBoard: () => ({ tasks: [task()] }),
    loadSentinel: () => ({ messageId: 1 }),
    loadHighwater: () => ({ messageId: 1 }),
    loadLock: () => lockRef.body,
    loadState: () => null,
    saveState: (body) => saved.push(body),
    log: (line) => logs.push(line),
    now: () => clock,
    resumeGraceMs: 30 * MIN,
    limits: { ...LOOP_DEFAULTS, maxTicks: 2, rearmMs: TEN_MIN, maxLockWaitMs: 60 * MIN },
    ...over,
  });
  return {
    ops, logs, saved, lockRef,
    advance: (ms) => { clock += ms; },
    now: () => clock,
    lines: (p) => logs.filter((l) => l.startsWith(p)),
    lock: (ageMs, over = {}) => ({ pid: 4242, startedAt: iso(clock - ageMs), source: 'watcher', nonce: 'n', ...over }),
    poll: (decideAction = 'idle', deployPending = false) => {
      ops.rearmIfDue();
      return nextPollAction({ decideAction, loopPending: ops.pending(), deployPending, lockHeld: ops.blockedByLock() });
    },
  };
}
function driveToCap(h, messageId = 5) {
  h.ops.start({ messageId });
  h.ops.takeFire(); h.ops.settle(okTick());
  h.ops.takeFire(); h.ops.settle(okTick());
}
const cappedMirror = { active: true, ticks: 24, startedAt: iso(T0 - 60 * MIN), armedBy: 3 };

const results = [];
function probe(name, fn) {
  try { fn(); results.push(`PASS ${name}`); }
  catch (e) { results.push(`FAIL ${name}: ${e.message.split('\n')[0]}`); }
}

// P0 — Ruben's P5 exactly, through poll(): does the re-armed loop's first poll say wait-lock?
probe('P0 ruben-p5: re-arm after resume() past the cap, orphan lock 12 min old -> wait-lock', () => {
  const h = harness({ loadState: () => cappedMirror });
  h.lockRef.body = h.lock(2 * MIN, { pid: 999_999 });
  h.ops.resume();
  h.advance(TEN_MIN);
  assert.equal(h.poll(), 'wait-lock');
});

// P1 — ordinary in-process re-arm racing a FRESH lock under a LIVE pid (a manual tick).
probe('P1 ordinary re-arm vs live fresh foreign lock: waits via age gate, one line, fires at grace', () => {
  const h = harness();
  driveToCap(h);
  h.advance(TEN_MIN);
  h.lockRef.body = h.lock(1 * MIN, { pid: process.pid, source: 'manual' });
  assert.equal(h.poll(), 'wait-lock');
  for (let i = 0; i < 5; i++) { h.advance(5000); assert.equal(h.poll(), 'wait-lock'); }
  assert.equal(h.lines('LOOP-WAIT').length, 1, 'one line across six polls');
  h.advance(29 * MIN);
  assert.equal(h.poll(), 'fire-loop', 'lock aged past the grace: released to acquireLock');
  assert.equal(h.ops.snapshot().resumeHold, false);
  results.push(`  note P1 line text: ${h.lines('LOOP-WAIT')[0]}`);
});

// P2 — restart DURING the re-armed wait: mirror active:true ticks 0; resume() must re-raise the hold.
probe('P2 restart during the re-armed wait re-raises the hold from the mirror', () => {
  const h = harness({ loadState: () => cappedMirror });
  h.lockRef.body = h.lock(2 * MIN, { pid: 999_999 });
  h.ops.resume();
  h.advance(TEN_MIN);
  assert.equal(h.poll(), 'wait-lock');
  const mirror = h.saved.at(-1);
  assert.equal(mirror.active, true); assert.equal(mirror.ticks, 0);
  assert.equal('resumeHold' in mirror, false, 'the mirror never carries resumeHold');
  // second process
  const h2 = harness({ loadState: () => mirror });
  h2.advance(TEN_MIN + 5000);
  h2.lockRef.body = h.lockRef.body;
  h2.ops.resume();
  assert.equal(h2.ops.snapshot().resumeHold, true);
  assert.equal(h2.poll(), 'wait-lock');
});

// P3 — a board message during the re-armed wait outranks the gate (F2 design) and clears the hold.
probe('P3 message during the re-armed wait: fire-message, start() clears the hold', () => {
  const h = harness({ loadState: () => cappedMirror });
  h.lockRef.body = h.lock(2 * MIN, { pid: 999_999 });
  h.ops.resume(); h.advance(TEN_MIN);
  assert.equal(h.poll(), 'wait-lock');
  assert.equal(h.poll('fire'), 'fire-message');
  h.ops.start({ messageId: 9 });
  assert.equal(h.ops.snapshot().resumeHold, false);
  assert.equal(h.ops.snapshot().ticks, 0);
});

// P4 — no leak: once the re-armed loop has fired its own tick, a lock on disk no longer gates it.
probe('P4 hold does not leak past the re-armed loop\'s own first tick', () => {
  const h = harness();
  driveToCap(h); h.advance(TEN_MIN);
  assert.equal(h.poll(), 'fire-loop');
  h.ops.takeFire(); h.ops.start({ messageId: 5 });
  h.lockRef.body = h.lock(0, { pid: process.pid }); // our own tick's lock
  assert.equal(h.ops.blockedByLock(), false);
  h.ops.settle(okTick());
  assert.equal(h.ops.pending(), true);
  h.lockRef.body = h.lock(0, { pid: 999_999 }); // a foreign fresh lock between our ticks
  assert.equal(h.poll(), 'fire-loop', 'between our own ticks the F1 abort path owns this, not the gate');
  assert.equal(h.lines('LOOP-WAIT').length, 0);
});

// P5 — undatable lock at the re-arm: not held (left to the steal rule), no hang.
probe('P5 undatable lock at the re-arm does not hold', () => {
  const h = harness({ loadState: () => cappedMirror });
  h.lockRef.body = h.lock(0, { startedAt: 'nope', pid: 999_999 });
  h.ops.resume(); h.advance(TEN_MIN);
  assert.equal(h.poll(), 'fire-loop');
  assert.equal(h.ops.snapshot().resumeHold, false);
});

// P6 — lock released mid-wait (the orphan child finished and its own cleanup unlinked it): clears on the next poll.
probe('P6 lock vanishing mid-wait clears the hold on the next poll', () => {
  const h = harness({ loadState: () => cappedMirror });
  h.lockRef.body = h.lock(2 * MIN, { pid: 999_999 });
  h.ops.resume(); h.advance(TEN_MIN);
  assert.equal(h.poll(), 'wait-lock');
  h.lockRef.body = null;
  h.advance(5000);
  assert.equal(h.poll(), 'fire-loop');
  assert.equal(h.ops.pending(), true);
});

// P7 — rearmIfDue() twice in one poll: second is a no-op; hold unchanged.
probe('P7 rearmIfDue twice: second returns false, hold still true', () => {
  const h = harness({ loadState: () => cappedMirror });
  h.lockRef.body = h.lock(2 * MIN, { pid: 999_999 });
  h.ops.resume(); h.advance(TEN_MIN);
  assert.equal(h.ops.rearmIfDue(), true);
  assert.equal(h.ops.rearmIfDue(), false);
  assert.equal(h.ops.snapshot().resumeHold, true);
});

// P8 — a re-arm held, then a wait-lock followed by a deploy pending: lock outranks deploy (existing order).
probe('P8 held re-arm outranks a pending deploy', () => {
  const h = harness({ loadState: () => cappedMirror });
  h.lockRef.body = h.lock(2 * MIN, { pid: 999_999 });
  h.ops.resume(); h.advance(TEN_MIN);
  assert.equal(h.poll('idle', true), 'wait-lock');
});

// P9 — the wait is bounded: at exactly resumeGraceMs the gate opens (>=, not >).
probe('P9 gate opens at exactly grace (>=)', () => {
  const h = harness({ loadState: () => cappedMirror });
  h.lockRef.body = h.lock(2 * MIN, { pid: 999_999 });
  h.ops.resume(); h.advance(TEN_MIN);
  assert.equal(h.poll(), 'wait-lock');
  h.advance(18 * MIN - 1);
  assert.equal(h.poll(), 'wait-lock', '1 ms short');
  h.advance(1);
  assert.equal(h.poll(), 'fire-loop', 'exactly grace');
});

console.log(results.join('\n'));
const fails = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`probes: ${results.filter((r) => r.startsWith('PASS')).length} pass, ${fails} fail`);
process.exit(fails ? 1 : 0);
