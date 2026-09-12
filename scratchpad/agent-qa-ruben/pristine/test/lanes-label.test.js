// test/lanes-label.test.js — AS-99 AC-14: the words the board reads.
//
// public/lanes.js is the only place the pane's wording is decided, so this file
// is where the wording is held to account: a dash is never a zero, a lane with
// no branch cut is never "clean", and no reason code reaches the UI without a
// sentence.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeLanes, LANES_REASON_CODES, LANES_STALE_MS } from '../lib/lanes.js';
import {
  describeLanes,
  describeLane,
  describeTickLine,
  describeActivity,
  SNAPSHOT_REASONS,
  SNAPSHOT_REASON_CODES,
  ACTIVITY_DECAY_MS,
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
  assert.equal(card.stageTimer, 'no live signal yet');
  assert.equal(card.subAgent, 'no live signal yet');
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
