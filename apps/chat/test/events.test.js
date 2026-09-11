// test/events.test.js — AS-100 pure core. Test names are the AC ids from the
// plan's T7; each one is a guard that has been driven red by its named mutant
// on a scratch copy before being trusted (CLAUDE.md § "A guard is proven by
// breaking it").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  ENVELOPE_KEYS,
  EVENT_SHAPES,
  EVENT_TYPES,
  MAX_LINE_BYTES,
  appendEvent,
  emptyFold,
  foldEvent,
  foldEvents,
  makeEvent,
  openItems,
  parseJsonl,
  projectEvent,
  readStream,
  reduceLiveness,
  serialiseEvent,
  sortEvents,
  stageCloseOutcome,
  tickOutcome,
  ulid,
} from '../lib/events.js';
import { readTaskEvents } from '../lib/lattice.js';

const here = dirname(fileURLToPath(import.meta.url));

/** An in-memory fs pair, the injected-effect harness this whole module is
 *  written for: no temp dirs, no clock, no process. */
function memFs() {
  const files = new Map();
  const dirs = [];
  return {
    files,
    dirs,
    mkdir: (dir) => { dirs.push(dir); },
    append: (path, chunk) => { files.set(path, (files.get(path) ?? '') + chunk); },
    readFile: (path) => {
      if (!files.has(path)) {
        const err = new Error(`ENOENT: ${path}`);
        err.code = 'ENOENT';
        throw err;
      }
      return files.get(path);
    },
  };
}

const STAGE_DATA = {
  task: 'AS-100',
  stage: 'implement',
  actor: 'agent:developer-lena',
  worktree: '.worktrees/AS-100',
  branch: 'feat/AS-100-events-feed',
  cycle: null,
};

function stageStarted(overrides = {}) {
  return makeEvent({
    type: 'stage_started',
    actor: 'agent:cto-owen',
    taskId: 'task_abc',
    data: { ...STAGE_DATA, ...(overrides.data ?? {}) },
    now: new Date(overrides.ts ?? '2026-09-11T05:00:00.000Z'),
    id: overrides.id ?? 'cev_00000000000000000000000001',
  });
}

// --- AC-1 envelope compatibility -------------------------------------------

test('events-envelope-keys', () => {
  const ev = stageStarted();
  const line = serialiseEvent(ev);
  const { events, malformed } = parseJsonl(`${line}\n`);
  assert.equal(malformed, 0);
  assert.equal(events.length, 1);
  assert.deepEqual(Object.keys(events[0]), ENVELOPE_KEYS);
  assert.equal(events[0].schema_version, 1);
  assert.ok(Number.isFinite(Date.parse(events[0].ts)));
  assert.deepEqual(Object.keys(events[0].data), [...EVENT_SHAPES.stage_started].sort());
  // A Lattice line and a company line parse into one sorted list.
  const latticeLine = JSON.stringify({
    id: 'ev_01',
    ts: '2026-09-11T04:00:00Z',
    type: 'status_changed',
    actor: 'agent:cto-owen',
    data: {},
  });
  const mixed = parseJsonl(`${latticeLine}\n${line}\n`);
  assert.equal(mixed.events.length, 2);
  const sorted = sortEvents(mixed.events);
  assert.deepEqual(sorted.map((e) => e.id), ['ev_01', ev.id]);
});

test('lattice-events-share-parser', () => {
  // Structural: readTaskEvents must USE parseJsonl, not a private copy of it.
  // One parser for both streams is AC-1's mechanism, and a second copy is how
  // the two dialects start drifting.
  const src = readFileSync(join(here, '..', 'lib', 'lattice.js'), 'utf8');
  assert.match(src, /import\s*\{[^}]*parseJsonl[^}]*\}\s*from\s*'\.\/events\.js'/);
  assert.match(src, /parseJsonl\(text\)/);
  assert.doesNotMatch(src, /JSON\.parse\(line\)/);
  // And it still reads a real .lattice tree the same way it always did.
  assert.ok(Array.isArray(readTaskEvents(join(here, 'fixtures', 'repo'))));
});

// --- AC-2 ids ---------------------------------------------------------------

test('events-id-monotonic', () => {
  const ids = [];
  for (let i = 0; i < 1000; i += 1) ids.push(ulid());
  for (const id of ids) assert.match(id, /^cev_[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.equal(new Set(ids).size, 1000);
  for (let i = 1; i < ids.length; i += 1) {
    assert.ok(ids[i] > ids[i - 1], `id ${i} (${ids[i]}) not greater than ${ids[i - 1]}`);
  }
  // Same-ms collisions are the case that matters: pin the clock and check the
  // random part still increments.
  const a = ulid({ nowMs: 1_800_000_000_000 });
  const b = ulid({ nowMs: 1_800_000_000_000 });
  assert.ok(b > a);
  assert.equal(a.slice(0, 14), b.slice(0, 14));
});

// --- AC-3 append-only -------------------------------------------------------

test('events-append-only', () => {
  const fs = memFs();
  const path = '/tmp/scratch/events/company.jsonl';
  appendEvent(path, stageStarted(), fs);
  const afterA = fs.files.get(path);
  appendEvent(path, stageStarted({ id: 'cev_00000000000000000000000002', ts: '2026-09-11T05:00:01.000Z' }), fs);
  const afterB = fs.files.get(path);
  assert.equal(afterB.slice(0, afterA.length), afterA);
  assert.equal(afterB.trimEnd().split('\n').length, 2);
  // A pre-existing file whose last line has no newline still gets a fresh line
  // out of the append (the writer always terminates its own line).
  assert.ok(afterA.endsWith('\n'));
  // The cap refuses a grown line rather than tearing it.
  assert.throws(
    () => appendEvent(path, stageStarted({ data: { branch: 'x'.repeat(MAX_LINE_BYTES) } }), fs),
    /byte cap/
  );
  assert.equal(fs.files.get(path), afterB, 'a refused line writes zero bytes');
});

test('events-no-truncating-path', () => {
  for (const rel of [['lib', 'events.js'], ['bin', 'events.js']]) {
    let src;
    try {
      src = readFileSync(join(here, '..', ...rel), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT' && rel[0] === 'bin') continue; // CLI lands in its own commit
      throw err;
    }
    // The plan's grep is `truncate|writeFileSync`; it is narrowed to CALL
    // sites here because the reader's `'truncated'` reason code is a string
    // literal, not a path that can shorten a file. Any call of either shape
    // is still a failure.
    const hits = src.split('\n').filter((l) => /(^|[^\w])(f?truncate|writeFileSync)\s*\(/.test(l));
    assert.deepEqual(hits, [], `${rel.join('/')} has a file-shortening path: ${hits.join(' | ')}`);
  }
});

// --- AC-4/AC-5 shared validation (the CLI's own table is events-cli.test.js) --

test('events-make-validates', () => {
  const bad = [
    () => makeEvent({ type: 'nope', actor: 'agent:cto-owen' }),
    () => makeEvent({ type: 'stage_started', actor: 'owen', data: STAGE_DATA }),
    () => makeEvent({ type: 'stage_started', actor: 'agent:cto-owen', data: { ...STAGE_DATA, stage: 'qa' } }),
    () => makeEvent({ type: 'stage_started', actor: 'agent:cto-owen', data: { ...STAGE_DATA, cycle: 0 } }),
    () => makeEvent({ type: 'stage_started', actor: 'agent:cto-owen', data: { ...STAGE_DATA, secret: 1 } }),
    () => makeEvent({ type: 'stage_ended', actor: 'agent:cto-owen', data: { ...STAGE_DATA, outcome: 'nope' } }),
  ];
  assert.equal(bad.length, 6);
  for (const [i, fn] of bad.entries()) assert.throws(fn, undefined, `case ${i} should have been refused`);
  // Missing optional keys are filled with null, never dropped.
  const ev = makeEvent({ type: 'subagent_spawned', actor: 'agent:cto-owen', data: { task: 'AS-1', stage: 'plan', actor: 'agent:qa-priya' } });
  assert.deepEqual(Object.keys(ev.data).sort(), [...EVENT_SHAPES.subagent_spawned].sort());
  assert.equal(ev.data.model, null);
});

// --- AC-6 tick outcome mapping ---------------------------------------------

test('watcher-events-outcome-timeout', () => {
  assert.equal(tickOutcome({ timedOut: true, code: null, signal: 'SIGTERM' }), 'timeout');
  assert.equal(tickOutcome({ timedOut: true, code: 0 }), 'timeout', 'a timeout that also exited 0 is still a timeout');
  assert.equal(tickOutcome({ code: 1 }), 'error');
  assert.equal(tickOutcome({ code: null, signal: 'SIGTERM' }), 'error');
  assert.equal(tickOutcome({ code: 0, stagesStarted: 0, headMoved: false }), 'noop');
  assert.equal(tickOutcome({ code: 0, stagesStarted: 1 }), 'ok');
  assert.equal(tickOutcome({ code: 0, headMoved: true }), 'ok');
  assert.equal(stageCloseOutcome({ timedOut: true }), 'cut_by_timeout');
  assert.equal(stageCloseOutcome({ code: 1 }), 'error');
  assert.equal(stageCloseOutcome({ code: 0 }), 'unclosed');
});

// --- AC-9 the open set is derived ------------------------------------------

test('events-open-derived-from-stream', () => {
  const started = stageStarted();
  assert.deepEqual(openItems([started]).stages.map((s) => s.task), ['AS-100']);
  const ended = makeEvent({
    type: 'stage_ended',
    actor: 'agent:cto-owen',
    data: { task: 'AS-100', stage: 'implement', actor: 'agent:developer-lena', outcome: 'completed', closedBy: 'orchestrator', startedId: started.id },
    now: new Date('2026-09-11T05:10:00.000Z'),
  });
  assert.deepEqual(openItems([started, ended]).stages, []);
});

// --- AC-15 liveness reducer -------------------------------------------------

const T0 = Date.parse('2026-09-11T05:00:00.000Z');
const TICK_BOX = 30 * 60_000;

test('events-liveness-bound', () => {
  const started = stageStarted();
  const open5 = reduceLiveness([started], { nowMs: T0 + 5 * 60_000, tickLive: false, tickTimeoutMs: TICK_BOX });
  assert.equal(open5['AS-100'].subAgent.alive, true);
  assert.equal(open5['AS-100'].stageStartedAt, started.ts);

  const open31 = reduceLiveness([started], { nowMs: T0 + 31 * 60_000, tickLive: false, tickTimeoutMs: TICK_BOX });
  assert.equal(open31['AS-100'].subAgent.alive, false);
  assert.equal(open31['AS-100'].subAgent.lastEvent.type, 'stage_started');

  const live31 = reduceLiveness([started], { nowMs: T0 + 31 * 60_000, tickLive: true, tickTimeoutMs: TICK_BOX });
  assert.equal(live31['AS-100'].subAgent.alive, true);
});

test('events-liveness-shapes', () => {
  const started = stageStarted();
  const ended = makeEvent({
    type: 'stage_ended',
    actor: 'agent:cto-owen',
    data: { task: 'AS-100', stage: 'implement', actor: 'agent:developer-lena', outcome: 'completed', closedBy: 'orchestrator', startedId: started.id, durationS: 600 },
    now: new Date(T0 + 600_000),
  });
  const done = reduceLiveness([started, ended], { nowMs: T0 + 30 * 60_000, tickTimeoutMs: TICK_BOX });
  assert.equal(done['AS-100'].subAgent.alive, false);
  assert.equal(done['AS-100'].subAgent.elapsedS, 600);
  assert.equal(done['AS-100'].subAgent.lastEvent.outcome, 'completed');
  assert.deepEqual(Object.keys(done['AS-100'].subAgent), ['actor', 'stage', 'alive', 'startedAt', 'elapsedS', 'lastEvent']);
  assert.deepEqual(Object.keys(done['AS-100'].subAgent.lastEvent), ['id', 'type', 'ts', 'outcome']);

  // A spawned sub-agent is who the lane is "doing" — not the stage's employee.
  const spawned = makeEvent({
    type: 'subagent_spawned',
    actor: 'agent:cto-owen',
    data: { task: 'AS-100', stage: 'implement', actor: 'agent:qa-ruben' },
    now: new Date(T0 + 60_000),
  });
  const withSub = reduceLiveness([started, spawned], { nowMs: T0 + 120_000, tickTimeoutMs: TICK_BOX });
  assert.equal(withSub['AS-100'].subAgent.actor, 'agent:qa-ruben');
  assert.equal(withSub['AS-100'].subAgent.startedAt, spawned.ts);
  assert.equal(withSub['AS-100'].stageStartedAt, started.ts);

  // Two lanes are independent.
  const other = stageStarted({ id: 'cev_00000000000000000000000009', data: { task: 'AS-99', actor: 'agent:developer-marcus' } });
  const both = reduceLiveness([started, other, spawned], { nowMs: T0 + 120_000, tickTimeoutMs: TICK_BOX });
  assert.deepEqual(Object.keys(both).sort(), ['AS-100', 'AS-99']);
  assert.equal(both['AS-99'].subAgent.actor, 'agent:developer-marcus');

  // An orphan exit invents no lane and throws nothing.
  const orphan = makeEvent({
    type: 'subagent_exited',
    actor: 'agent:cto-owen',
    data: { task: 'AS-77', stage: 'plan', actor: 'agent:pm-bob', exit: 'ok' },
    now: new Date(T0),
  });
  const orphaned = reduceLiveness([orphan], { nowMs: T0, tickTimeoutMs: TICK_BOX });
  assert.deepEqual(orphaned, {});
});

test('events-fold-incremental-equals-batch', () => {
  const started = stageStarted();
  const spawned = makeEvent({
    type: 'subagent_spawned', actor: 'agent:cto-owen',
    data: { task: 'AS-100', stage: 'implement', actor: 'agent:developer-lena' },
    now: new Date(T0 + 60_000),
  });
  const exited = makeEvent({
    type: 'subagent_exited', actor: 'agent:cto-owen',
    data: { task: 'AS-100', stage: 'implement', actor: 'agent:developer-lena', exit: 'ok', closedBy: 'orchestrator', spawnedId: spawned.id },
    now: new Date(T0 + 300_000),
  });
  const ended = makeEvent({
    type: 'stage_ended', actor: 'agent:cto-owen',
    data: { task: 'AS-100', stage: 'implement', actor: 'agent:developer-lena', outcome: 'completed', closedBy: 'orchestrator', startedId: started.id },
    now: new Date(T0 + 360_000),
  });
  const all = [started, spawned, exited, ended];
  const opts = { nowMs: T0 + 400_000, tickTimeoutMs: TICK_BOX };
  const batch = reduceLiveness(all, opts);
  for (let split = 0; split <= all.length; split += 1) {
    const state = emptyFold();
    for (const ev of all.slice(0, split)) foldEvent(state, ev);
    for (const ev of all.slice(split)) foldEvent(state, ev);
    assert.deepEqual(reduceLiveness(state, opts), batch, `split at ${split} diverged`);
  }
  assert.equal(batch['AS-100'].subAgent.lastEvent.type, 'stage_ended');
});

// --- projection whitelist (the lib half of AC-12) ---------------------------

test('events-project-whitelists-keys', () => {
  assert.equal(EVENT_TYPES.length, 6);
  for (const type of EVENT_TYPES) {
    const grown = {
      actor: 'agent:cto-owen',
      data: Object.fromEntries([...EVENT_SHAPES[type].map((k) => [k, null]), ['secret', 'leak']]),
      id: 'cev_x',
      schema_version: 1,
      task_id: null,
      ts: '2026-09-11T05:00:00.000Z',
      type,
      host: '/Users/forrest/secret/path',
    };
    const projected = projectEvent(grown);
    assert.deepEqual(Object.keys(projected), ENVELOPE_KEYS);
    assert.deepEqual(Object.keys(projected.data), [...EVENT_SHAPES[type]]);
    const json = JSON.stringify(projected);
    assert.ok(!json.includes('secret'), `${type} leaked data.secret`);
    assert.ok(!json.includes('/Users/forrest'), `${type} leaked the host path`);
  }
  assert.equal(projectEvent({ type: 'not_a_type', id: 'x' }), null);
});

// --- reader reasons ---------------------------------------------------------

test('events-read-stream-reasons', () => {
  const fs = memFs();
  assert.equal(readStream('/nope/company.jsonl', fs).reason, 'no-stream');
  fs.files.set('/s/company.jsonl', 'not json\n{also not\n');
  const garbage = readStream('/s/company.jsonl', fs);
  assert.equal(garbage.reason, 'unreadable-stream');
  assert.equal(garbage.malformed, 2);
  fs.files.set('/s/company.jsonl', `${serialiseEvent(stageStarted())}\nbroken\n`);
  const mixed = readStream('/s/company.jsonl', fs);
  assert.equal(mixed.reason, 'ok');
  assert.equal(mixed.malformed, 1);
  assert.equal(mixed.events.length, 1);
  assert.equal(foldEvents(mixed.events).lanes['AS-100'].stage.open, true);
});
