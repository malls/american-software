// AC-7 direct check (qa-priya): the watcher's cut close carries the open stage's cycle.
// The existing watcher-events-timeout-closes-as-cut fixture plants cycle: null, so it
// cannot see a wrong or missing value; this plants cycle 3 and null and reads both back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEventsOps } from '/Users/forrest/Code/american-software-company/.worktrees/AS-111/apps/chat/watch/advance-watcher.mjs';
import { makeEvent, serialiseEvent } from '/Users/forrest/Code/american-software-company/.worktrees/AS-111/apps/chat/lib/events.js';

const MIN = 60_000;
const T0 = Date.parse('2026-09-11T10:00:00.000Z');
const TICK_BOX = 30 * MIN;
const ev = (type, data, atMs, actor) => makeEvent({ type, actor, data, now: new Date(atMs) });

for (const cycle of [3, null]) {
  test(`ac7: cut close carries cycle=${cycle}`, () => {
    const tick = ev('tick_started', { source: 'watcher', pid: 4242, startedAt: new Date(T0).toISOString(), messageId: 7, loopTick: 1 }, T0, 'system:watcher');
    const stage = ev('stage_started', { task: 'AS-95', stage: 'implement', actor: 'agent:developer-marcus', worktree: '.worktrees/AS-95', branch: 'feat/AS-95-slug', cycle }, T0 + 1000, 'agent:cto-owen');
    const state = { file: [tick, stage].map((e) => serialiseEvent(e) + '\n').join('') };
    const ops = makeEventsOps({
      streamPath: '/scratch/events/company.jsonl', tickTimeoutMs: TICK_BOX, lockBusy: () => false, isBusy: () => false,
      now: () => T0 + TICK_BOX, readFile: () => state.file, append: (_p, chunk) => { state.file += chunk; }, mkdir: () => {}, log: () => {},
    });
    const before = state.file.length;
    ops.tickEnded({ timedOut: true, code: null, signal: 'SIGTERM', headBefore: 'a', headAfter: 'a' });
    const gained = state.file.slice(before).split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const ended = gained.find((e) => e.type === 'stage_ended');
    assert.ok(ended, 'a stage_ended was written');
    assert.ok(Object.hasOwn(ended.data, 'cycle'), 'the key is present');
    assert.equal(ended.data.cycle, cycle);
    assert.equal(ended.data.startedId, stage.id);
  });
}
