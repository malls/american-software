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

// --- AS-75: the one build sentence -------------------------------------------

const build = (over) => ({ id: 'aaaaaaaaaaaaaaaa', desiredId: 'aaaaaaaaaaaaaaaa', current: true, reason: 'current', checkedAt: iso(-5_000), ...over });

test('AS-75 label: exactly one build sentence, distinct per case, silent when current', () => {
  // Cardinality first: three cases, one sentence each (or none), all different.
  const cases = [
    ['current', build({ current: true })],
    ['behind', build({ current: false, desiredId: 'bbbbbbbbbbbbbbbb', reason: 'stale-build' })],
    ['unknown', build({ current: null, desiredId: null, reason: 'no-state' })],
  ];
  assert.equal(cases.length, 3, 'three build configurations examined');

  const sentences = [];
  for (const [name, b] of cases) {
    const detail = describeLoopStatus(status({ state: 'idle', build: b }), NOW).detail;
    // Everything the payload says about the deploy lives in ONE sentence: take
    // the tail after the watcher line and count the terminators we added.
    const added = detail.replace(describeLoopStatus(status({ state: 'idle' }), NOW).detail, '').trim();
    sentences.push(added);
    if (name === 'current') {
      assert.equal(added, '', 'a current build says nothing — silence is the good case');
    } else {
      assert.equal(added.split('. ').length, 1, `${name}: exactly one sentence`);
      assert.ok(added.endsWith('.'), `${name}: a sentence, not a fragment`);
    }
  }
  assert.equal(new Set(sentences).size, 3, 'three distinct outcomes');

  // The behind case names both ids and the plain-English reason.
  assert.match(sentences[1], /Live build is behind master \(running aaaaaaaaaaaaaaaa, master bbbbbbbbbbbbbbbb\)/);
  assert.match(sentences[1], /the watcher is about to rebuild it\.$/);

  // The unknown case never says "behind" — it says it does not know.
  assert.match(sentences[2], /^Deploy freshness unknown: /);
  assert.doesNotMatch(sentences[2], /behind/);
});

test('AS-75 label: every build reason has prose, and null is never rendered as behind', () => {
  // Every reason the watcher or the server can produce. A bare enum leaking to
  // the board is the failure this asserts against — same rule as WATCHER_REASONS.
  const reasons = [
    'current', 'stale-build', 'cooldown', 'busy', 'inputs-dirty', 'no-git', 'no-docker',
    'no-state', 'unreadable-state', 'stale-state', 'no-watcher', 'unknown-build',
  ];
  assert.equal(reasons.length, 12, 'twelve reasons examined');
  for (const reason of reasons) {
    const d = describeLoopStatus(status({ state: 'idle', build: build({ current: null, reason }) }), NOW).detail;
    assert.match(d, /Deploy freshness unknown: [a-z]/, `${reason}: prose, not an enum`);
    assert.doesNotMatch(d, new RegExp(`reason: ${reason}`), `${reason} has a written explanation`);
    assert.doesNotMatch(d, /behind master/, `${reason}: unknown is never reported as behind`);
  }

  // An unrecognised reason degrades to naming itself rather than vanishing.
  const odd = describeLoopStatus(status({ state: 'idle', build: build({ current: null, reason: 'martian' }) }), NOW).detail;
  assert.match(odd, /reason: martian/);
});

test('AS-75 label: a deploy holds the lock and says so — "Tick in flight · deploy"', () => {
  // The deploy takes advance.lock with source 'deploy', and describeLoopStatus
  // interpolates the source, so this needs no UI change — which is exactly why
  // it needs a test rather than an assumption.
  const got = describeLoopStatus(
    status({ state: 'tick', tick: { source: 'deploy', pid: 90824, startedAt: iso(-20_000), ageS: 20 } }), NOW);
  assert.equal(got.tone, 'tick');
  assert.equal(got.label, 'Tick in flight · deploy');
  assert.match(got.detail, /Tick from deploy \(pid 90824\) started 20 s ago\./);
});

// --- AS-95 / AC-6: the watcher loop reads differently from a single tick -----

test('AS-95 label: a watcher loop is "Loop active · watcher, tick N", and the count comes from the lock first', () => {
  const inLoop = describeLoopStatus(
    status({
      state: 'watcher-loop',
      tick: { source: 'watcher', pid: 17217, startedAt: iso(-40_000), ageS: 40, loopTicks: 3 },
      loop: { active: true, ticks: 3, startedAt: iso(-600_000), armedBy: 651, lastLoop: null },
    }), NOW);
  assert.equal(inLoop.label, 'Loop active · watcher, tick 3');
  // The dot is green, like the other loop: watcher-loop is a fifth STATE, not a
  // fifth colour, and an unmapped tone would render an unstyled invisible dot.
  assert.equal(inLoop.tone, 'loop');
  assert.match(inLoop.detail, /Loop tick from watcher \(pid 17217\) started 40 s ago\./);

  // The lock is the tick being reported, so its marker wins when the mirror
  // file is a poll behind. 4 vs 3 — the label must show the lock's number.
  const ahead = describeLoopStatus(
    status({
      state: 'watcher-loop',
      tick: { source: 'watcher', pid: 17217, startedAt: iso(-2_000), ageS: 2, loopTicks: 4 },
      loop: { active: true, ticks: 3, startedAt: iso(-600_000), armedBy: 651, lastLoop: null },
    }), NOW);
  assert.equal(ahead.label, 'Loop active · watcher, tick 4');

  // Marker absent (a lock written before this landed): fall back to the file.
  const fileOnly = describeLoopStatus(
    status({
      state: 'watcher-loop',
      tick: { source: 'watcher', pid: 17217, startedAt: iso(-2_000), ageS: 2, loopTicks: null },
      loop: { active: true, ticks: 6, startedAt: iso(-600_000), armedBy: 651, lastLoop: null },
    }), NOW);
  assert.equal(fileOnly.label, 'Loop active · watcher, tick 6');

  // Neither witness carries a number. The state is still true, so the label
  // still says so — it just declines to invent a tick count.
  const noCount = describeLoopStatus(
    status({ state: 'watcher-loop', tick: { source: 'watcher', pid: 1, startedAt: iso(-1_000), ageS: 1, loopTicks: null } }), NOW);
  assert.equal(noCount.label, 'Loop active · watcher');
});

test('AS-95 label: a stopped loop says WHY, in words, and only while no loop is running', () => {
  const stopped = (reason, ticks) =>
    describeLoopStatus(
      status({ state: 'idle', loop: { active: false, ticks: 0, startedAt: null, armedBy: null, lastLoop: { reason, ticks, stoppedAt: iso(-120_000) } } }),
      NOW).detail;

  assert.match(stopped('dry', 7), /Last loop stopped after 7 ticks, 2 min ago: nothing was left to do\./);
  assert.match(stopped('no-progress', 2), /two ticks in a row ended without a commit on master/);
  assert.match(stopped('cap-hit', 24), /the safety cap was reached/);
  assert.match(stopped('tick-failed-twice', 2), /two ticks in a row failed or hit the tick timeout/);
  // Every reason shouldContinue() and the loop ops can emit has words here; the
  // hour-long lock wait is the one that does not come from the predicate.
  assert.match(stopped('lock-unavailable', 3), /another tick held the advance lock for an hour/);
  assert.match(stopped('error', 1), /unexpected error while evaluating the loop/);
  assert.match(stopped('dry', 1), /after 1 tick,/, 'one tick, not "1 ticks"');
  // An unknown reason is still a stop worth showing, named rather than hidden.
  assert.match(stopped('something-new', 3), /reason: something-new/);

  // While a loop IS running, the previous loop's epitaph is noise.
  const running = describeLoopStatus(
    status({
      state: 'watcher-loop',
      tick: { source: 'watcher', pid: 1, startedAt: iso(-1_000), ageS: 1, loopTicks: 2 },
      loop: { active: true, ticks: 2, startedAt: iso(-60_000), armedBy: 651, lastLoop: { reason: 'dry', ticks: 7, stoppedAt: iso(-600_000) } },
    }), NOW).detail;
  assert.equal(/Last loop stopped/.test(running), false);
});

test('AS-95 label: an absent or malformed loop key changes nothing (pre-AS-95 server parity)', () => {
  const baseline = describeLoopStatus(status({ state: 'idle' }), NOW);
  for (const bad of [undefined, null, 'nope', 42, [], { active: false }, { active: false, lastLoop: null }]) {
    const got = describeLoopStatus(status({ state: 'idle', loop: bad }), NOW);
    assert.equal(got.detail, baseline.detail, `loop=${JSON.stringify(bad)}: no sentence, no throw`);
    assert.equal(got.tone, 'idle');
  }
});

test('AS-75 label: an absent or malformed build key changes nothing', () => {
  // A pre-AS-75 server (no build key at all) must render exactly as before.
  const baseline = describeLoopStatus(status({ state: 'idle' }), NOW);
  for (const bad of [undefined, null, 'nope', 42, []]) {
    const got = describeLoopStatus(status({ state: 'idle', build: bad }), NOW);
    assert.equal(got.detail, baseline.detail, `build=${JSON.stringify(bad)}: no sentence, no throw`);
    assert.equal(got.tone, 'idle');
  }
});

// F5 (cycle-1 review): between two loop ticks nothing holds the lock, and the
// sidebar used to read "Idle · watcher listening" — the company mid-run,
// reported as stopped, at the moment the board is most likely to be watching.

test('f5-between-ticks-label: the gap between loop ticks reads as a loop, and says it is a gap', () => {
  const between = describeLoopStatus(
    status({
      state: 'watcher-loop',
      tick: null,
      loop: { active: true, ticks: 3, startedAt: iso(-600_000), armedBy: 651, lastLoop: null },
      lastTick: { source: 'watcher', startedAt: iso(-40_000), endedAt: iso(-4_000) },
    }), NOW);
  assert.equal(between.label, 'Loop active · watcher, tick 3');
  assert.equal(between.tone, 'loop');
  assert.match(between.detail, /Between loop ticks/);
  assert.match(between.detail, /Last tick: watcher, ended 4 s ago\./);
  // C5's "a running loop reads as idle in that gap" explained the OLD defect.
  // It is still true of a /loop session (nothing mirrors that one) and must not
  // be said here, where the line above has just said the opposite.
  assert.doesNotMatch(between.detail, /reads as idle in that gap/);
  assert.doesNotMatch(between.detail, /Idle/);
});

test('f5-idle-keeps-its-own-words: a session loop between ticks still gets C5’s explanation', () => {
  const sessionGap = describeLoopStatus(
    status({ state: 'idle', lastTick: { source: 'loop', startedAt: iso(-300_000), endedAt: iso(-40_000) } }), NOW);
  assert.equal(sessionGap.label, 'Idle · watcher listening');
  assert.match(sessionGap.detail, /reads as idle in that gap/);
});
