// test/lanes-label.test.js — AS-99 AC-14: the words the board reads.
//
// public/lanes.js is the only place the pane's wording is decided, so this file
// is where the wording is held to account: a dash is never a zero, a lane with
// no branch cut is never "clean", and no reason code reaches the UI without a
// sentence.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeLanes, LANES_REASON_CODES, LANES_STALE_MS } from '../lib/lanes.js';
import { EVENTS_REASON_CODES, STAGE_OUTCOMES, SUBAGENT_EXITS } from '../lib/events.js';
import {
  describeLanes,
  describeLane,
  describeTickLine,
  describeActivity,
  SNAPSHOT_REASONS,
  SNAPSHOT_REASON_CODES,
  EMPTY_STATES,
  EMPTY_STATE_CODES,
  ACTIVITY_DECAY_MS,
  EVENTS_REASONS,
  EVENTS_REASON_CODE_LIST,
  STAGE_OUTCOME_WORDS,
  STAGE_OUTCOME_CODES,
  SUBAGENT_EXIT_WORDS,
  SUBAGENT_EXIT_CODES,
} from '../public/lanes.js';

const NOW = Date.parse('2026-09-11T04:00:00.000Z');
const iso = (offsetMs) => new Date(NOW + offsetMs).toISOString();

function snapshot(over = {}) {
  return {
    schema: 1,
    source: 'watcher:git',
    generatedAt: iso(-8_000),
    master: { head: 'f6717b8' },
    error: null,
    worktrees: [],
    ...over,
  };
}

const wtRow = (over = {}) => ({
  relPath: '.worktrees/AS-99',
  main: false,
  head: '3c1a0000',
  branch: 'feat/AS-99-lane-view',
  detached: false,
  ahead: 4,
  behind: 2,
  dirtyCount: 3,
  dirtyLattice: false,
  merged: false,
  lastCommit: {
    sha: '3c1a0000',
    authorName: 'developer-marcus',
    authorEmail: 'developer-marcus@agents.american-software.local',
    committedAt: iso(-14 * 60_000),
    subject: 'AS-99: lanes composer',
  },
  errors: [],
  ...over,
});

test('lanes-label-null-is-dash: an unanswered fetch is a dash, never a zero', () => {
  const out = describeLanes(null, NOW);
  assert.equal(out.badge, 'Lanes · –');
  assert.ok(!out.badge.includes('0'), 'a count the UI never measured is not reported as 0');
  assert.match(out.caption, /unavailable/i);
  assert.equal(out.stale, true);

  // ...and a real answer that happens to carry no lanes IS a measured zero.
  const empty = composeLanes({ snapshot: snapshot(), tasks: [], ids: {}, nowMs: NOW });
  assert.equal(describeLanes(empty, NOW).badge, 'Lanes · 0');

  // A degraded feed (no snapshot on disk) is a dash again — the server sent
  // `lanes: null` precisely so a partial list cannot masquerade as the list.
  const missing = composeLanes({ snapshot: null, tasks: [], ids: {}, nowMs: NOW });
  assert.equal(describeLanes(missing, NOW).badge, 'Lanes · –');
});

test('lanes-label-reason-table: every snapshot reason has a sentence, and no sentence is orphaned', () => {
  assert.deepEqual([...SNAPSHOT_REASON_CODES].sort(), [...LANES_REASON_CODES].sort());
  for (const code of LANES_REASON_CODES) {
    const sentence = SNAPSHOT_REASONS[code];
    assert.equal(typeof sentence, 'string', `${code} has a sentence`);
    if (code !== 'ok') {
      assert.ok(sentence.length > 20, `${code}'s sentence explains rather than restates`);
      assert.ok(!sentence.includes(code), `${code} does not leak its own enum into the UI`);
    }
  }
});

test('lanes-label-git-error-is-not-a-measured-zero: git refusing is not "nothing in flight"', () => {
  // The watcher reached git and git refused: a real generatedAt, a real error,
  // and an empty list that NOBODY MEASURED. A task is mid-lifecycle the whole
  // time, so "0" would be wrong as well as unmeasured (F1, cycle 1).
  const p = composeLanes({
    snapshot: snapshot({ error: 'worktree-list-failed: exit 128', worktrees: [] }),
    tasks: [{ id: 'task_a', short_id: 'AS-99', title: 'Chat: lanes', status: 'in_progress', assigned_to: 'agent:developer-marcus', branch_links: [] }],
    ids: { 'AS-99': 'task_a' },
    nowMs: NOW,
  });
  assert.equal(p.snapshot.reason, 'git-error');
  assert.deepEqual(p.lanes, [], 'the projection reports the refusal as an empty list, per T4');

  const out = describeLanes(p, NOW);
  assert.equal(out.badge, 'Lanes · –', 'a refused enumeration is a dash, never a count');
  assert.ok(!out.badge.includes('0'));
  assert.match(out.caption, /^Lane data unavailable — /);
  assert.match(out.caption, /git refused/, 'the caption names what happened');
  assert.match(out.caption, /Snapshot 8 s old\./, 'a failed poll is still a fact with a timestamp');
  assert.equal(out.stale, true);
  assert.equal(out.emptyText, EMPTY_STATES['git-error']);
  assert.notEqual(out.emptyText, EMPTY_STATES.ok, 'the pane does not claim nothing is in flight');

  // ...while a snapshot git DID answer keeps its measured zero, badge and all.
  const measured = describeLanes(composeLanes({ snapshot: snapshot(), tasks: [], ids: {}, nowMs: NOW }), NOW);
  assert.equal(measured.badge, 'Lanes · 0');
  assert.equal(measured.emptyText, 'No lanes in flight.');
  assert.equal(measured.reason, 'ok');
});

test('lanes-label-empty-state-table: every reason has its own empty-state sentence, and only `ok` claims a measurement', () => {
  assert.deepEqual([...EMPTY_STATE_CODES].sort(), [...LANES_REASON_CODES].sort());
  for (const code of LANES_REASON_CODES) {
    const sentence = EMPTY_STATES[code];
    assert.equal(typeof sentence, 'string', `${code} has an empty-state sentence`);
    assert.ok(!sentence.includes(code), `${code} does not leak its own enum into the UI`);
    if (code !== 'ok') {
      assert.notEqual(sentence, EMPTY_STATES.ok, `${code} must not read as a measured zero`);
      assert.ok(!/^No lanes in flight/.test(sentence), `${code} must not assert what is in flight`);
    }
  }
});

test('lanes-label-stale-caption: a stale snapshot says so, in age and in words', () => {
  const stale = composeLanes({
    snapshot: snapshot({ generatedAt: iso(-(LANES_STALE_MS + 5_000)) }),
    tasks: [],
    ids: {},
    nowMs: NOW,
  });
  const out = describeLanes(stale, NOW);
  assert.match(out.caption, /^Snapshot 1 min old — /);
  assert.match(out.caption, /watcher/, 'the caption names what stopped, not the enum');
  assert.equal(out.stale, true);

  const fresh = describeLanes(composeLanes({ snapshot: snapshot(), tasks: [], ids: {}, nowMs: NOW }), NOW);
  assert.equal(fresh.caption, 'Snapshot 8 s old.');
  assert.equal(fresh.stale, false);
});

test('lanes-label-task-only-not-cut-yet: a lane with no branch never reads 0 or clean', () => {
  const p = composeLanes({
    snapshot: snapshot(),
    tasks: [{ id: 'task_a', short_id: 'AS-100', title: 'Chat: events feed', status: 'in_planning', assigned_to: 'agent:cto-owen', branch_links: [] }],
    ids: { 'AS-100': 'task_a' },
    nowMs: NOW,
  });
  const card = describeLane(p.lanes[0], NOW);
  for (const field of ['worktree', 'branch', 'ahead', 'dirty', 'lastCommit']) {
    assert.equal(card[field], 'not cut yet', `${field} states the absence`);
  }
  assert.ok(!Object.values(card).includes('clean'), 'nothing about an uncut lane reads clean');
  assert.equal(card.stage, 'in_planning');
  assert.equal(card.employee, 'agent:cto-owen');
  // AS-100 AC-18 replaced AS-99's shared placeholder: with a readable stream
  // and no stage events for this lane, the slot says which of the two it is.
  assert.equal(card.stageTimer, 'no stage events yet');
  assert.equal(card.subAgent, 'no stage events yet');
});

test('lanes-label-card-fields: a worktree lane renders all eight durable fields in words', () => {
  const task = {
    id: 'task_b',
    short_id: 'AS-99',
    title: 'Chat: git worktree observability in the chat UI',
    status: 'in_progress',
    assigned_to: 'agent:developer-marcus',
    branch_links: [{ branch: 'feat/AS-99-lane-view' }],
  };
  const p = composeLanes({ snapshot: snapshot({ worktrees: [wtRow()] }), tasks: [task], ids: {}, nowMs: NOW });
  const card = describeLane(p.lanes[0], NOW);
  assert.equal(card.taskText, 'AS-99');
  assert.equal(card.unknownTask, false);
  assert.equal(card.stage, 'in_progress');
  assert.equal(card.employee, 'agent:developer-marcus', 'agreement is silent — only disagreement is labelled');
  assert.equal(card.worktree, '.worktrees/AS-99');
  assert.equal(card.branch, 'feat/AS-99-lane-view');
  assert.equal(card.ahead, '4 ahead of master · 2 behind');
  assert.equal(card.dirty, 'dirty · 3 files');
  assert.match(card.lastCommit, /^developer-marcus, 14 min ago — AS-99: lanes composer$/);
  assert.equal(card.staleFlag, false);
  assert.equal(card.staleText, '');
});

test('lanes-label-employee-disagreement-is-shown: two identities, assignee first', () => {
  const task = { id: 'task_c', short_id: 'AS-99', title: 't', status: 'review', assigned_to: 'agent:developer-lena', branch_links: [{ branch: 'feat/AS-99-lane-view' }] };
  const p = composeLanes({ snapshot: snapshot({ worktrees: [wtRow()] }), tasks: [task], ids: {}, nowMs: NOW });
  const card = describeLane(p.lanes[0], NOW);
  assert.equal(card.employee, 'agent:developer-lena · last commit by developer-marcus');
});

test('lanes-label-dirty-lattice-and-errors: the two-plane violation and a failed git call are said out loud', () => {
  const row = wtRow({ dirtyCount: 2, dirtyLattice: true, errors: ['status: exit 128 fatal: not a git repository'] });
  const p = composeLanes({ snapshot: snapshot({ worktrees: [row] }), tasks: [], ids: {}, nowMs: NOW });
  const card = describeLane(p.lanes[0], NOW);
  assert.equal(card.dirty, 'dirty · 2 files · incl. .lattice');
  assert.match(card.errorsText, /git could not answer: status: exit 128/);
});

test('lanes-label-unknown-task-and-detached: a lane with no join still renders a card', () => {
  const row = wtRow({ branch: null, detached: true, head: 'abcdef1234', lastCommit: null, ahead: null, dirtyCount: null, relPath: '.worktrees/scratch' });
  const p = composeLanes({ snapshot: snapshot({ worktrees: [row] }), tasks: [], ids: {}, nowMs: NOW });
  const card = describeLane(p.lanes[0], NOW);
  assert.equal(card.unknownTask, true);
  assert.equal(card.taskText, '.worktrees/scratch', 'the path stands in for the missing task id');
  assert.equal(card.stage, 'no task joined');
  assert.equal(card.branch, 'detached at abcdef12');
  assert.equal(card.ahead, 'unknown');
  assert.equal(card.dirty, 'unknown');
  assert.equal(card.employee, 'unassigned');
});

test('lanes-label-stale-badge-says-why: the STALE flag is never a bare word', () => {
  const task = { id: 'task_d', short_id: 'AS-99', title: 't', status: 'done', assigned_to: null, branch_links: [{ branch: 'feat/AS-99-lane-view' }] };
  const p = composeLanes({ snapshot: snapshot({ worktrees: [wtRow({ merged: true, ahead: 0 })] }), tasks: [task], ids: {}, nowMs: NOW });
  const card = describeLane(p.lanes[0], NOW);
  assert.equal(card.staleFlag, true);
  assert.equal(card.staleText, 'STALE — its task is done and its branch is already merged into master');
  assert.match(card.lastCommit, /^no commits on branch yet/, 'ahead 0 does not pretend that author worked in the lane');
});

test('lanes-label-tick-line-is-whole-company: the liveness line refuses to imply per-lane', () => {
  const running = describeTickLine({ state: 'tick', tick: { source: 'watcher:76266', pid: 4242, startedAt: iso(-120_000) } }, NOW);
  assert.equal(running.text, 'Tick running for 2 min · watcher:76266 (pid 4242)');
  assert.equal(running.caption, '(whole company, not per-lane)');
  assert.equal(describeTickLine({ state: 'idle' }, NOW).text, 'No tick running.');
  assert.equal(describeTickLine(null, NOW).text, 'Tick state unknown.');
});

test('lanes-label-activity-has-no-producer-yet: blank, live and decayed at the 15 s boundary', () => {
  assert.equal(ACTIVITY_DECAY_MS, 15_000);
  assert.deepEqual(describeActivity(null, NOW), { state: 'blank', text: '' });
  assert.deepEqual(describeActivity({ text: 'running tests', at: iso(-1_000) }, NOW), { state: 'live', text: 'now: running tests' });
  assert.equal(describeActivity({ text: 'running tests', at: iso(-(ACTIVITY_DECAY_MS + 1_000)) }, NOW).state, 'decayed');
});

// --- AS-100 AC-18: the words the board reads about a LIVE stage -------------
//
// Same house rule as the snapshot tables above, one input over: no reason code
// and no outcome enum reaches the board without a sentence, and the key-set
// assertions are what links this browser-side table to lib/events.js — which
// this file may import and public/lanes.js may not, since it is node-only.

const live = (over = {}) => ({
  actor: 'agent:developer-lena',
  stage: 'implement',
  alive: true,
  startedAt: iso(-252_000),
  elapsedS: 252,
  lastEvent: { id: 'cev_1', type: 'subagent_spawned', ts: iso(-252_000), outcome: null },
  ...over,
});

const laneWith = (subAgent) => ({
  key: 'AS-100',
  task: { taskId: 'task_a', shortId: 'AS-100', title: 'Chat: events feed', status: 'in_progress' },
  worktree: null,
  employee: { assignee: 'agent:developer-lena', lastCommitAuthor: null, agree: null },
  stale: { flag: false, reasons: [] },
  stageStartedAt: subAgent ? subAgent.startedAt : null,
  subAgent,
});

test('lanes-label-events-reason-table: every stream reason has a sentence, and no sentence is orphaned', () => {
  assert.deepEqual([...EVENTS_REASON_CODE_LIST].sort(), [...EVENTS_REASON_CODES].sort());
  for (const code of EVENTS_REASON_CODES) {
    const sentence = EVENTS_REASONS[code];
    assert.equal(typeof sentence, 'string', `${code} has a sentence`);
    if (code !== 'ok') {
      assert.ok(sentence.length > 20, `${code}'s sentence explains rather than restates`);
      assert.ok(!sentence.includes(code), `${code} does not leak its own enum into the UI`);
    }
  }

  // ...and the caption the pane draws is the STREAM's own, not the snapshot's:
  // a healthy git snapshot with a missing stream degrades two fields, not the
  // pane, and must not make a fresh lane list read as stale.
  const p = composeLanes({ snapshot: snapshot(), tasks: [], ids: {}, nowMs: NOW });
  const out = describeLanes(p, NOW);
  assert.equal(out.eventsReason, 'no-stream');
  assert.match(out.eventsCaption, /^Live stage signal unavailable — /);
  assert.match(out.eventsCaption, /watcher/, 'the caption names what to do, not the enum');
  assert.equal(out.caption, 'Snapshot 8 s old.', "the git half's caption is untouched by the stream's state");
  assert.equal(out.stale, false, 'a missing event stream does not make a fresh snapshot stale');

  const ok = describeLanes({ ...p, events: { ...p.events, reason: 'ok' } }, NOW);
  assert.equal(ok.eventsCaption, '', 'a healthy stream says nothing');
});

test('lanes-label-outcome-tables: every stage outcome and sub-agent exit has a sentence', () => {
  assert.deepEqual([...STAGE_OUTCOME_CODES].sort(), [...STAGE_OUTCOMES].sort());
  assert.deepEqual([...SUBAGENT_EXIT_CODES].sort(), [...SUBAGENT_EXITS].sort());
  for (const [table, codes] of [[STAGE_OUTCOME_WORDS, STAGE_OUTCOMES], [SUBAGENT_EXIT_WORDS, SUBAGENT_EXITS]]) {
    for (const code of codes) {
      const word = table[code];
      assert.equal(typeof word, 'string', `${code} has a sentence`);
      assert.ok(!word.includes('_'), `${code} does not leak its snake_case enum into the UI`);
    }
  }
  // The two tables are separate because the enums overlap in meaning but not in
  // spelling: one table would have to pick a single word for `ok` and
  // `completed`, which is how a sub-agent's exit starts describing its stage.
  assert.notEqual(SUBAGENT_EXIT_WORDS.ok, STAGE_OUTCOME_WORDS.completed);
});

test('lanes-label-no-stream-fills-both-slots: the missing input is named, not blanked', () => {
  const card = describeLane(laneWith(null), NOW, 'no-stream');
  assert.equal(card.stageTimer, 'no event stream');
  assert.equal(card.subAgent, 'no event stream');
  assert.equal(card.liveTone, 'none');
  // The git half of the same card is unaffected — two inputs, two fates.
  assert.equal(card.stage, 'in_progress');
  assert.equal(card.employee, 'agent:developer-lena');

  // "no stream" and "this lane has emitted nothing" are different facts and
  // must not render the same (the AS-99 dash-vs-zero rule, one field over).
  const noEvents = describeLane(laneWith(null), NOW, 'ok');
  assert.equal(noEvents.stageTimer, 'no stage events yet');
  assert.notEqual(noEvents.stageTimer, card.stageTimer);
});

test('lanes-label-stale-open-not-running: an expired tick box is never reported as running', () => {
  // alive:false with the last event still an OPENING one — the tick died and
  // the sweep has not closed the stage yet. The board reads "no signal", and
  // the word "running" must not appear anywhere on the card.
  const card = describeLane(laneWith(live({ alive: false })), NOW, 'ok');
  assert.equal(card.stageTimer, 'implement — no signal since 03:55Z (tick box expired)');
  assert.equal(card.subAgent, 'agent:developer-lena · no signal since 03:55Z');
  assert.equal(card.liveTone, 'alert');
  for (const [field, value] of Object.entries(card)) {
    if (typeof value === 'string') assert.ok(!/running/i.test(value), `${field} must not claim it is running`);
  }

  // The same shape with `stage_started` as the last event (no sub-agent event
  // ever landed) reads the same way — both opening types are "no signal".
  const stageOnly = describeLane(
    laneWith(live({ alive: false, lastEvent: { id: 'cev_0', type: 'stage_started', ts: iso(-252_000), outcome: null } })),
    NOW,
    'ok',
  );
  assert.match(stageOnly.stageTimer, /no signal since 03:55Z/);
  assert.ok(!/running/i.test(stageOnly.stageTimer));
});

test('lanes-label-live-counts-up-and-ended-says-its-outcome', () => {
  // Alive: elapsed is recomputed from startedAt against the CLIENT clock, so
  // the card counts up on the 15 s render timer without a new request — the
  // payload's own elapsedS is a convenience for non-browser consumers (AS-27).
  const card = describeLane(laneWith(live({ elapsedS: 9_999 })), NOW, 'ok');
  assert.equal(card.stageTimer, 'implement running for 4 min');
  assert.equal(card.subAgent, 'agent:developer-lena · working');
  assert.equal(card.liveTone, 'live');
  assert.ok(!card.stageTimer.includes('167'), 'the payload elapsedS is not what was rendered');

  const done = describeLane(
    laneWith(live({
      alive: false,
      elapsedS: 252,
      lastEvent: { id: 'cev_2', type: 'subagent_exited', ts: iso(-1_000), outcome: 'ok' },
    })),
    NOW,
    'ok',
  );
  assert.equal(done.subAgent, 'agent:developer-lena · finished');
  assert.equal(done.stageTimer, 'implement ran 4 min');
  assert.equal(done.liveTone, 'done');

  const cut = describeLane(
    laneWith(live({
      alive: false,
      elapsedS: 1_800,
      lastEvent: { id: 'cev_3', type: 'stage_ended', ts: iso(-1_000), outcome: 'cut_by_timeout' },
    })),
    NOW,
    'ok',
  );
  assert.equal(cut.stageTimer, 'implement cut off when the tick hit its timeout · ran 30 min');
  assert.equal(cut.liveTone, 'alert', 'nobody closed this cleanly, and the card is toned so it can be found');
  assert.ok(!cut.stageTimer.includes('cut_by_timeout'));
});
