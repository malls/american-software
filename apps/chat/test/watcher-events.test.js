// AS-100 — the reconciler (T2). makeEventsOps only, on injected fs/clock/lock:
// never main(), never a real file, never a real lock. The property under test
// is the one the description names — a stage cut by the tick timeout is
// recorded as `cut_by_timeout`, never as `completed` — and every criterion
// below names the mutant that must turn it red.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeEventsOps } from '../watch/advance-watcher.mjs';
import { makeEvent, serialiseEvent, EVENT_SHAPES } from '../lib/events.js';

const T0 = Date.parse('2026-09-11T05:00:00.000Z');
const MIN = 60 * 1000;
const TICK_BOX = 30 * MIN;

function ev(type, data, atMs, actor = 'system:watcher') {
  return makeEvent({ type, actor, data, now: new Date(atMs) });
}

function tickStartedEv(atMs = T0) {
  return ev('tick_started', { source: 'watcher', pid: 4242, startedAt: new Date(atMs).toISOString(), messageId: 7, loopTick: 1 }, atMs);
}

function stageStartedEv({ task = 'AS-95', stage = 'implement', actor = 'agent:developer-marcus', atMs = T0 + 1000 } = {}) {
  return ev(
    'stage_started',
    { task, stage, actor, worktree: `.worktrees/${task}`, branch: `feat/${task}-slug`, cycle: null },
    atMs,
    'agent:cto-owen'
  );
}

function subSpawnedEv({ task = 'AS-95', stage = 'implement', actor = 'agent:developer-marcus', atMs = T0 + 2000 } = {}) {
  return ev('subagent_spawned', { task, stage, actor, model: null }, atMs, 'agent:cto-owen');
}

function plant(...events) {
  return events.map((e) => serialiseEvent(e) + '\n').join('');
}

/** Injected fs + clock + lock. The stream is a string in memory; `file: null`
 *  is a stream that does not exist yet (ENOENT, the pre-AS-100 watcher). */
function harness({ file = null, nowMs = T0 + 5 * MIN, lockBusy = () => false, isBusy = () => false, tickTimeoutMs = TICK_BOX } = {}) {
  const state = { file, mkdirs: [], logs: [] };
  const ops = makeEventsOps({
    streamPath: '/scratch/events/company.jsonl',
    tickTimeoutMs,
    lockBusy,
    isBusy,
    now: () => nowMs,
    readFile: () => {
      if (state.file === null) {
        const err = new Error('ENOENT: no such file');
        err.code = 'ENOENT';
        throw err;
      }
      return state.file;
    },
    append: (_path, chunk) => {
      state.file = (state.file ?? '') + chunk;
    },
    mkdir: (path) => state.mkdirs.push(path),
    log: (line) => state.logs.push(line),
  });
  const before = state.file ?? '';
  return {
    ops,
    state,
    /** every line now in the stream */
    lines: () => (state.file ?? '').split('\n').filter(Boolean).map((l) => JSON.parse(l)),
    /** only the lines this call appended — the "the file GAINS exactly N" assertion */
    gained: () => (state.file ?? '').slice(before.length).split('\n').filter(Boolean).map((l) => JSON.parse(l)),
  };
}

// AC-6 (the tickOutcome / stageCloseOutcome mapping) is owned by
// test/events.test.js's `watcher-events-outcome-timeout` — the functions are
// pure core, and one id must name exactly one test or a red set stops saying
// which guard fired. What lives here is the reconciler that CALLS them.

test('watcher-events-tick-started-shape', () => {
  const h = harness();
  const written = h.ops.tickStarted({ pid: 99, messageId: 12, loopTick: 3 });
  const [line] = h.gained();
  assert.equal(line.type, 'tick_started');
  assert.equal(line.actor, 'system:watcher', 'a process is not an employee');
  assert.equal(line.id, written.id);
  // Sorted key order, like Lattice's own lines (T1): the serialiser sorts, so
  // the parsed line's key order is the shape list sorted, not the list as declared.
  assert.deepEqual(Object.keys(line.data), [...EVENT_SHAPES.tick_started].sort());
  assert.equal(line.data.source, 'watcher');
  assert.equal(line.data.pid, 99);
  assert.equal(line.data.loopTick, 3);
  // T1 §1: the fire nonce is the lock's anti-spoof token and never reaches a reader.
  assert.ok(!JSON.stringify(line).includes('nonce'));
  assert.equal(h.state.mkdirs.length, 1, 'the first append creates events/');
});

// --- AC-7: THE falsifier from the description -------------------------------

test('watcher-events-timeout-closes-as-cut', () => {
  const started = tickStartedEv();
  const stage = stageStartedEv();
  const h = harness({ file: plant(started, stage), nowMs: T0 + TICK_BOX });

  h.ops.tickEnded({ timedOut: true, code: null, signal: 'SIGTERM', headBefore: 'a', headAfter: 'a' });

  const gained = h.gained();
  assert.equal(gained.length, 2, 'exactly one stage_ended and one tick_ended');
  const [ended, tickEnded] = gained;

  assert.equal(ended.type, 'stage_ended');
  assert.equal(ended.data.outcome, 'cut_by_timeout');
  assert.notEqual(ended.data.outcome, 'completed', 'a cut stage must never be recorded as completed');
  assert.equal(ended.data.closedBy, 'watcher-settle');
  assert.equal(ended.data.startedId, stage.id);
  assert.equal(ended.data.task, 'AS-95');
  assert.equal(ended.data.actor, 'agent:developer-marcus', 'data.actor is who was doing the stage');
  assert.equal(ended.actor, 'system:watcher', 'the emitter is the watcher');
  assert.equal(ended.data.durationS, TICK_BOX / 1000 - 1);

  assert.equal(tickEnded.type, 'tick_ended');
  assert.equal(tickEnded.data.outcome, 'timeout');
  assert.deepEqual(tickEnded.data.lanesTouched, ['AS-95']);
  assert.equal(tickEnded.data.stagesClosed, 1);
  assert.equal(tickEnded.data.tickId, started.id);
  assert.equal(tickEnded.data.timedOut, true);
  assert.equal(tickEnded.data.headMoved, false);
});

test('watcher-events-close-before-tick-ended', () => {
  // The stated ordering property: a consumer must never observe a closed tick
  // with a stage still open. Asserted on the gained slice, in file order.
  const h = harness({ file: plant(tickStartedEv(), stageStartedEv(), stageStartedEv({ task: 'AS-61', actor: 'agent:developer-lena' })), nowMs: T0 + TICK_BOX });
  h.ops.tickEnded({ timedOut: true });
  const types = h.gained().map((l) => l.type);
  assert.deepEqual(types, ['stage_ended', 'stage_ended', 'tick_ended']);
  assert.equal(types.indexOf('tick_ended'), types.length - 1, 'tick_ended is last, always');
  const closed = h.gained().filter((l) => l.type === 'stage_ended');
  assert.deepEqual(closed.map((l) => l.data.task).sort(), ['AS-61', 'AS-95']);
  assert.equal(h.gained().at(-1).data.stagesClosed, 2);
  assert.deepEqual(h.gained().at(-1).data.lanesTouched.sort(), ['AS-61', 'AS-95']);
});

test('watcher-events-timeout-closes-subagent-as-cut', () => {
  const stage = stageStartedEv();
  const sub = subSpawnedEv();
  const h = harness({ file: plant(tickStartedEv(), stage, sub), nowMs: T0 + TICK_BOX });
  h.ops.tickEnded({ timedOut: true });
  const gained = h.gained();
  assert.deepEqual(gained.map((l) => l.type), ['subagent_exited', 'stage_ended', 'tick_ended']);
  const exited = gained[0];
  assert.equal(exited.data.exit, 'cut_by_timeout');
  assert.notEqual(exited.data.exit, 'ok');
  assert.equal(exited.data.spawnedId, sub.id);
  assert.equal(exited.data.closedBy, 'watcher-settle');
  assert.equal(exited.data.tokens, null, 'reserved slot, still null');
  assert.equal(exited.data.costUsd, null);
});

// --- AC-10: a clean exit with an open stage is `unclosed` -------------------

test('watcher-events-unclosed-not-completed', () => {
  const h = harness({ file: plant(tickStartedEv(), stageStartedEv()), nowMs: T0 + 4 * MIN });
  h.ops.tickEnded({ code: 0, signal: null, timedOut: false, headBefore: 'a', headAfter: 'b' });
  const [ended, tickEnded] = h.gained();
  assert.equal(ended.data.outcome, 'unclosed');
  assert.notEqual(ended.data.outcome, 'completed', 'the orchestrator never said the stage finished');
  assert.notEqual(ended.data.outcome, 'error', 'and the stage is not to blame for the omission');
  assert.equal(tickEnded.data.outcome, 'ok');
  assert.equal(tickEnded.data.headMoved, true);
});

test('watcher-events-error-exit-closes-as-error', () => {
  const h = harness({ file: plant(tickStartedEv(), stageStartedEv()), nowMs: T0 + 4 * MIN });
  h.ops.tickEnded({ code: 1 });
  assert.equal(h.gained()[0].data.outcome, 'error');
  assert.equal(h.gained()[1].data.outcome, 'error');
});

test('watcher-events-tick-ended-noop-and-no-stream', () => {
  // A tick that started no stage and moved no commit is a noop — the honest
  // word. And a tick over an absent stream still records itself.
  const h = harness({ file: plant(tickStartedEv()), nowMs: T0 + MIN });
  h.ops.tickEnded({ code: 0, headBefore: 'a', headAfter: 'a' });
  assert.equal(h.gained()[0].data.outcome, 'noop');

  const empty = harness({ file: null });
  empty.ops.tickEnded({ code: 0 });
  const gained = empty.gained();
  assert.equal(gained.length, 1);
  assert.equal(gained[0].data.tickId, null, 'no tick_started to reference');
  assert.deepEqual(gained[0].data.lanesTouched, []);
});

// --- AC-8: the sweep honours the tick box and the lock ---------------------

function sweepCase({ ageMin, lockBusy = () => false, isBusy = () => false }) {
  const at = T0;
  const h = harness({
    file: plant(stageStartedEv({ atMs: at })),
    nowMs: at + ageMin * MIN,
    lockBusy,
    isBusy,
  });
  h.ops.sweep();
  return h;
}

test('watcher-events-sweep-boundary', () => {
  const old = sweepCase({ ageMin: 31 });
  assert.equal(old.gained().length, 1);
  assert.equal(old.gained()[0].type, 'stage_ended');
  assert.equal(old.gained()[0].data.outcome, 'cut_by_timeout');
  assert.equal(old.gained()[0].data.closedBy, 'watcher-sweep');

  const young = sweepCase({ ageMin: 29 });
  assert.equal(young.gained().length, 0, 'younger than the tick box: an orchestrator may be about to emit');
});

test('watcher-events-sweep-respects-lock', () => {
  const locked = sweepCase({ ageMin: 31, lockBusy: () => true });
  assert.equal(locked.gained().length, 0, 'a fresh lock means a tick is running: leave its stages alone');

  const busy = sweepCase({ ageMin: 31, isBusy: () => true });
  assert.equal(busy.gained().length, 0, 'our own child is running');

  // …and the same stream with neither gate set does close, so the two cases
  // above are guarded by the gate and not by an empty open set.
  const free = sweepCase({ ageMin: 31 });
  assert.equal(free.gained().length, 1);
});

test('watcher-events-sweep-closes-open-tick-as-error', () => {
  // The watcher died mid-tick and was relaunched: no fresh lock, tick still open.
  const started = tickStartedEv();
  const h = harness({ file: plant(started, stageStartedEv()), nowMs: T0 + 31 * MIN });
  h.ops.sweep();
  const gained = h.gained();
  assert.deepEqual(gained.map((l) => l.type), ['stage_ended', 'tick_ended']);
  assert.equal(gained[1].data.outcome, 'error');
  assert.equal(gained[1].data.reason, 'watcher-restarted');
  assert.equal(gained[1].data.tickId, started.id);
  assert.equal(gained[0].data.outcome, 'cut_by_timeout');

  // A stream whose tick is already closed gains nothing on a second sweep.
  const again = h.ops.sweep();
  assert.equal(again.action, 'noop');
});

// --- AC-9: the open set is derived, never stored ---------------------------

test('watcher-events-open-derived-from-stream', () => {
  const stage = stageStartedEv();
  const h = harness({ file: plant(tickStartedEv(), stage), nowMs: T0 + MIN });

  const first = h.ops.openItems();
  assert.equal(first.stages.length, 1);
  assert.equal(first.stages[0].id, stage.id);
  assert.equal(first.stages[0].task, 'AS-95');

  // The orchestrator's own emit, appended by hand — nothing tells eventsOps.
  h.state.file += plant(
    ev(
      'stage_ended',
      {
        task: 'AS-95',
        stage: 'implement',
        actor: 'agent:developer-marcus',
        outcome: 'completed',
        reason: null,
        closedBy: 'orchestrator',
        startedId: stage.id,
        durationS: 60,
      },
      T0 + 90 * 1000,
      'agent:cto-owen'
    )
  );

  const second = h.ops.openItems();
  assert.equal(second.stages.length, 0, 'no method was called: the fold simply sees it closed');

  // …and a settle now closes nothing, so tick_ended is the only line gained.
  const before = h.state.file.length;
  h.ops.tickEnded({ timedOut: true });
  const gained = h.state.file.slice(before).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.deepEqual(gained.map((l) => l.type), ['tick_ended']);
  assert.equal(gained[0].data.stagesClosed, 0);
});

test('watcher-events-append-failure-degrades-feed-not-tick', () => {
  // The persist() rule: a full disk costs the feed, never the watcher.
  const logs = [];
  const ops = makeEventsOps({
    streamPath: '/scratch/events/company.jsonl',
    readFile: () => '',
    append: () => {
      throw new Error('ENOSPC: no space left on device');
    },
    mkdir: () => {},
    now: () => T0,
    log: (line) => logs.push(line),
  });
  assert.doesNotThrow(() => ops.tickStarted({ pid: 1 }));
  assert.doesNotThrow(() => ops.tickEnded({ code: 0 }));
  assert.doesNotThrow(() => ops.sweep());
  assert.equal(logs.filter((l) => l.startsWith('WARN')).length, 1, 'warned once, not per append');
});
