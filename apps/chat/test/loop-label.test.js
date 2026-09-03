// AS-27 unit tests for public/loop-status.js — the browser module that turns
// a /api/loop-status payload into the tone, label and detail the sidebar
// renders. Same import-the-browser-module pattern as live.test.js.
//
// This file is where "the four states are distinguishable" is proven at the
// level the board actually experiences: four different labels, not four
// different enum values.
import test from 'node:test';
import assert from 'node:assert/strict';
import { describeLoopStatus } from '../public/loop-status.js';

const NOW = Date.parse('2026-09-03T18:00:00.000Z');
const iso = (offsetMs) => new Date(NOW + offsetMs).toISOString();

const listening = { listening: true, heartbeatAt: iso(-3_000), ageS: 3 };
const status = (over) => ({ tick: null, staleLock: null, watcher: listening, lastTick: null, checkedAt: iso(0), ...over });

test('AS-27 label: the four states produce four distinct tones and labels', () => {
  const cases = [
    [status({ state: 'loop', tick: { source: 'loop', pid: 5285, startedAt: iso(-60_000), ageS: 60 } }),
      'loop', 'Loop active'],
    [status({ state: 'tick', tick: { source: 'watcher', pid: 4242, startedAt: iso(-5_000), ageS: 5 } }),
      'tick', 'Tick in flight · watcher'],
    [status({ state: 'idle' }), 'idle', 'Idle · watcher listening'],
    [status({ state: 'off', watcher: { listening: false, heartbeatAt: null, ageS: null, reason: 'no-pidfile' } }),
      'off', 'Off · no watcher'],
  ];
  assert.equal(cases.length, 4, 'four configurations examined');

  const tones = [];
  const labels = [];
  for (const [input, tone, label] of cases) {
    const got = describeLoopStatus(input, NOW);
    assert.equal(got.tone, tone);
    assert.equal(got.label, label);
    assert.ok(got.detail.length > 0, `${tone}: detail is never empty`);
    tones.push(got.tone);
    labels.push(got.label);
  }
  // The vacuity check this task's whole shape invites: an indicator that
  // renders the same thing in every state would satisfy nothing above if the
  // expectations happened to coincide. They must all differ.
  assert.equal(new Set(tones).size, 4, 'four distinct tones');
  assert.equal(new Set(labels).size, 4, 'four distinct labels');

  // A manual tick names its source too — 'tick' is not one undifferentiated
  // bucket.
  const manual = describeLoopStatus(
    status({ state: 'tick', tick: { source: 'manual', pid: 9, startedAt: iso(-5_000), ageS: 5 } }), NOW);
  assert.equal(manual.label, 'Tick in flight · manual');
  assert.notEqual(manual.label, labels[1]);
});

test('AS-27 label: detail carries the evidence — ages, pid, and the source', () => {
  const d = describeLoopStatus(
    status({ state: 'loop', tick: { source: 'loop', pid: 5285, startedAt: iso(-90_000), ageS: 90 } }), NOW).detail;
  assert.match(d, /Loop tick from loop \(pid 5285\) started 2 min ago\./);
  assert.match(d, /Watcher heartbeat 3 s ago\./);

  // Age is recomputed against the passed clock, which is what lets the client
  // refresh the text locally between push frames.
  const later = describeLoopStatus(
    status({ state: 'loop', tick: { source: 'loop', pid: 5285, startedAt: iso(-90_000), ageS: 90 } }),
    NOW + 600_000).detail;
  assert.match(later, /started 12 min ago/, 'the same payload ages with the clock');
});

test('AS-27 label: a stale lock names its source and says stale, without becoming a tick', () => {
  const got = describeLoopStatus(
    status({
      state: 'idle',
      staleLock: { source: 'watcher', startedAt: iso(-46 * 60 * 1000), ageS: 2760, reason: 'age' },
    }), NOW);
  assert.equal(got.tone, 'idle', 'a stale lock is never a tick');
  assert.equal(got.label, 'Idle · watcher listening');
  assert.match(got.detail, /stale lock from watcher/i);
  assert.match(got.detail, /stale/);
  assert.match(got.detail, /will be stolen/);
  assert.match(got.detail, /46 min old/);
});

test('AS-27 label: the no-heartbeat watcher yields the off tone and names the restart', () => {
  const got = describeLoopStatus(
    status({ state: 'off', watcher: { listening: false, heartbeatAt: null, ageS: null, reason: 'no-heartbeat' } }),
    NOW);
  assert.equal(got.tone, 'off');
  assert.equal(got.label, 'Off · no watcher');
  assert.match(got.detail, /pre-AS-27 code/);
  assert.match(got.detail, /restart it/);
  assert.match(got.detail, /launchctl bootout/, 'the detail names the actual host action');

  // Every non-listening reason gets a sentence — no bare enum leaks to the UI.
  for (const reason of ['no-pidfile', 'no-heartbeat', 'bad-heartbeat', 'unparsable', 'stale-heartbeat']) {
    const d = describeLoopStatus(
      status({ state: 'off', watcher: { listening: false, heartbeatAt: null, ageS: null, reason } }), NOW).detail;
    assert.match(d, /^.*Watcher: [a-z]/, `${reason}: prose, not an enum`);
    assert.doesNotMatch(d, new RegExp(`not listening \\(${reason}\\)`), `${reason} has a written explanation`);
  }
});

test('AS-27 label: the between-ticks gap is described as a limit, not hidden', () => {
  // C5: a /loop session releases the lock between ticks, so the honest read is
  // 'idle'. lastTick is the mitigation and it must say what it is.
  const got = describeLoopStatus(
    status({ state: 'idle', lastTick: { source: 'loop', startedAt: iso(-300_000), endedAt: iso(-40_000) } }), NOW);
  assert.equal(got.tone, 'idle', 'the state is still the truthful one');
  assert.match(got.detail, /Last tick: loop, ended 40 s ago\./);
  assert.match(got.detail, /releases the lock between ticks/);

  // While a tick IS running, lastTick is not repeated — the live fact wins.
  const running = describeLoopStatus(
    status({
      state: 'loop',
      tick: { source: 'loop', pid: 1, startedAt: iso(-1_000), ageS: 1 },
      lastTick: { source: 'loop', startedAt: iso(-300_000), endedAt: iso(-40_000) },
    }), NOW);
  assert.doesNotMatch(running.detail, /Last tick/);
});

test('AS-27 label: an unavailable status degrades to off/unavailable, never a throw', () => {
  for (const bad of [null, undefined, {}, 'nope', 42, { state: 7 }]) {
    const got = describeLoopStatus(bad, NOW);
    assert.equal(got.tone, 'off');
    assert.equal(got.label, 'Status unavailable');
    assert.match(got.detail, /did not answer/);
  }
  // An UNKNOWN state string is not the same as an absent payload: it is a
  // server we can reach but do not understand, so it falls to the off label
  // rather than claiming the loop is running.
  const weird = describeLoopStatus(status({ state: 'quantum' }), NOW);
  assert.equal(weird.label, 'Off · no watcher');
  assert.equal(weird.tone, 'quantum', 'tone mirrors the server so an unknown state cannot masquerade as a known dot');
});
