// test/lanes.test.js — AS-99: the pure half of the lane view.
//
// Covers the porcelain parser, the merged classifier and the projection
// composer. No fs, no clock, no git: every input below is an argument.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseWorktreeList,
  classifyMerged,
  relPathOf,
  OUTSIDE_REPO,
  summarizeStatus,
} from '../watch/advance-watcher.mjs';
import { composeLanes, LANES_STALE_MS, LANES_REASON_CODES, LANE_WORKTREE_KEYS } from '../lib/lanes.js';

const NOW = Date.parse('2026-09-11T04:00:00.000Z');
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

const PORCELAIN = [
  'worktree /repo',
  'HEAD f6717b816cdc4d66539205799f779373c0f9c759',
  'branch refs/heads/master',
  '',
  'worktree /repo/.worktrees/AS-99',
  'HEAD 3c1a000000000000000000000000000000000000',
  'branch refs/heads/feat/AS-99-lane-view',
  'locked under review',
  '',
  'worktree /repo/.worktrees/scratch',
  'HEAD ab12000000000000000000000000000000000000',
  'detached',
  '',
].join('\n');

// --- AC-1: the porcelain parser --------------------------------------------

test('lanes-parse-detached: main + linked + detached rows parse to three rows', () => {
  const rows = parseWorktreeList(PORCELAIN);
  assert.equal(rows.length, 3, 'cardinality first: three worktree records in, three rows out');

  assert.equal(rows[0].main, true);
  assert.equal(rows[1].main, false);
  assert.equal(rows[2].main, false);

  assert.equal(rows[0].branch, 'master', 'refs/heads/ is stripped');
  assert.equal(rows[1].branch, 'feat/AS-99-lane-view');
  assert.equal(rows[1].locked, true);
  assert.equal(rows[1].path, '/repo/.worktrees/AS-99');

  assert.equal(rows[2].branch, null, 'a detached row has no branch');
  assert.equal(rows[2].detached, true);
  assert.equal(rows[2].head, 'ab12000000000000000000000000000000000000');
  assert.deepEqual(rows[2].errors, [], 'detached is a state, not an error');
});

test('lanes-parse-tolerant: a record missing HEAD is a row with an error, never a throw', () => {
  const rows = parseWorktreeList(
    ['worktree /repo', 'HEAD aaaa', 'branch refs/heads/master', '', 'worktree /repo/.worktrees/AS-1', ''].join('\n')
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[1].head, null);
  assert.equal(rows[1].errors.length, 2, 'no HEAD and no branch/detached marker are both recorded');
  assert.match(rows[1].errors[0], /head/);
  // A snapshot taken mid-`git worktree add` is the real-world source of this.
  assert.deepEqual(parseWorktreeList('').length, 0);
  assert.deepEqual(parseWorktreeList(null).length, 0);
});

test('lanes-parse-trailer: the final record survives a missing trailing blank line', () => {
  const rows = parseWorktreeList('worktree /repo\nHEAD aaaa\nbranch refs/heads/master');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].branch, 'master');
});

test('lanes-relpath: the absolute host path is stripped to a repo-relative one', () => {
  assert.equal(relPathOf('/repo', '/repo'), '.');
  assert.equal(relPathOf('/repo', '/repo/.worktrees/AS-99'), '.worktrees/AS-99');
  assert.equal(relPathOf('/repo/', '/repo/.worktrees/AS-99'), '.worktrees/AS-99');
  // A sibling whose name merely PREFIXES the root is outside it, not inside.
  assert.ok(!relPathOf('/repo', '/repo2/wt').startsWith('/'), 'a sibling-prefix path is not treated as a descendant');
});

test('lanes-relpath-outside-repo: a worktree outside the root is marked, never carried as a host path', () => {
  // `git worktree add /tmp/throwaway` is legal and the M6 probe does exactly
  // that. T4: the absolute host path is not written into the snapshot — and
  // relPath flows to the browser through lane.worktree.relPath and lane.key.
  const cases = [
    ['/Users/x/repo', '/tmp/throwaway-wt', `${OUTSIDE_REPO}/throwaway-wt`],
    ['/Users/x/repo', '/tmp/throwaway-wt/', `${OUTSIDE_REPO}/throwaway-wt`],
    ['/Users/x/repo', '/Users/x/repo2/wt', `${OUTSIDE_REPO}/wt`],
    ['/Users/x/repo', '/Users/x/other/.worktrees/AS-1', `${OUTSIDE_REPO}/AS-1`],
    ['/Users/x/repo', '/', OUTSIDE_REPO],
  ];
  assert.equal(cases.length, 5); // cardinality before quantification
  for (const [root, path, want] of cases) {
    const got = relPathOf(root, path);
    assert.equal(got, want, `${path} under ${root}`);
    assert.ok(!got.startsWith('/'), `${path} must not survive as an absolute path`);
    assert.ok(!got.includes('/Users/'), `${path} must not leak a host directory`);
  }
  // The basename is kept precisely so two outside worktrees stay distinct lanes.
  assert.notEqual(relPathOf('/repo', '/tmp/a'), relPathOf('/repo', '/tmp/b'));
});

test('lanes-status-summary: dirty count, and .lattice dirt called out by name', () => {
  assert.deepEqual(summarizeStatus(''), { dirtyCount: 0, dirtyLattice: false });
  assert.deepEqual(summarizeStatus(' M apps/chat/server.js\n?? scratch.txt\n'), {
    dirtyCount: 2,
    dirtyLattice: false,
  });
  assert.deepEqual(summarizeStatus(' M .lattice/tasks/task_x.json\n'), { dirtyCount: 1, dirtyLattice: true });
  assert.deepEqual(summarizeStatus('R  a.js -> .lattice/b.json\n'), { dirtyCount: 1, dirtyLattice: true });
});

// --- AC-6: merged classification --------------------------------------------

test('lanes-merged-fresh-branch-is-not-merged: all three facts are needed', () => {
  // A branch cut from master's tip: ahead 0 AND an ancestor AND on the
  // first-parent chain. Dropping the first-parent term calls this merged.
  assert.equal(classifyMerged({ ahead: 0, isAncestor: true, onFirstParent: true }), false);
  // --no-ff merged: the merge commit is on master's first-parent chain, the
  // branch tip itself is not.
  assert.equal(classifyMerged({ ahead: 0, isAncestor: true, onFirstParent: false }), true);
  // Live branch with commits of its own.
  assert.equal(classifyMerged({ ahead: 4, isAncestor: false, onFirstParent: false }), false);
  // Unknown inputs are never a confident false.
  assert.equal(classifyMerged({ ahead: null, isAncestor: true, onFirstParent: false }), null);
  assert.equal(classifyMerged({ ahead: 0, isAncestor: null, onFirstParent: false }), null);
  assert.equal(classifyMerged({ ahead: 0, isAncestor: true, onFirstParent: null }), null);
});

// --- the composer -----------------------------------------------------------

const commit = (authorName = 'developer-marcus') => ({
  sha: '3c1a000',
  authorName,
  authorEmail: `${authorName}@agents.american-software.local`,
  committedAt: iso(600_000),
  subject: 'AS-99: lanes composer',
});

const wt = (over = {}) => ({
  relPath: '.worktrees/AS-99',
  main: false,
  head: '3c1a000',
  branch: 'feat/AS-99-lane-view',
  detached: false,
  ahead: 4,
  behind: 2,
  dirtyCount: 3,
  dirtyLattice: false,
  merged: false,
  lastCommit: commit(),
  errors: [],
  ...over,
});

const snap = (worktrees, over = {}) => ({
  schema: 1,
  source: 'watcher:git',
  generatedAt: iso(8_000),
  master: { head: 'f6717b8' },
  error: null,
  worktrees,
  ...over,
});

const task = (over = {}) => ({
  id: 'task_99',
  short_id: 'AS-99',
  title: 'Chat: git worktree observability in the chat UI',
  status: 'in_progress',
  assigned_to: 'agent:developer-marcus',
  branch_links: [{ branch: 'feat/AS-99-lane-view' }],
  ...over,
});

const compose = (args) => composeLanes({ nowMs: NOW, ...args });

test('lanes-compose-shape: a joined lane carries exactly the projection keys', () => {
  const out = compose({ snapshot: snap([wt({ relPath: '.', main: true, branch: 'master' }), wt()]), tasks: [task()], ids: {} });
  assert.equal(out.count, 1, 'the main checkout is dropped by the projection');
  assert.equal(out.snapshot.reason, 'ok');
  assert.equal(out.snapshot.stale, false);
  assert.equal(out.snapshot.ageS, 8);
  assert.equal(out.snapshot.generatedAt, snap([]).generatedAt);
  assert.equal(out.checkedAt, new Date(NOW).toISOString());

  const lane = out.lanes[0];
  assert.deepEqual(Object.keys(lane), [
    'key',
    'task',
    'joinedBy',
    'worktree',
    'employee',
    'stale',
    'stageStartedAt',
    'subAgent',
  ]);
  assert.deepEqual(Object.keys(lane.worktree), [...LANE_WORKTREE_KEYS]);
  assert.deepEqual(Object.keys(lane.task), ['shortId', 'taskId', 'title', 'status', 'assignee']);
  assert.equal(lane.key, 'AS-99');
  assert.equal(lane.joinedBy, 'branch-link');
  assert.equal(lane.stageStartedAt, null, 'AS-100 slot, present and null');
  assert.equal(lane.subAgent, null);
});

// --- AC-7: join rule and cardinality ----------------------------------------

test('lanes-compose-unknown-task-kept: N worktree rows in, N worktree lanes out', () => {
  const rows = [
    wt({ relPath: '.', main: true, branch: 'master' }),
    wt(),
    wt({ relPath: '.worktrees/scratch', branch: null, detached: true, head: 'ab12', lastCommit: commit('someone') }),
  ];
  const out = compose({ snapshot: snap(rows), tasks: [task()], ids: { 'AS-99': 'task_99' } });
  assert.equal(out.count, 2, 'two non-main rows in, two lanes out — the unjoined row is never filtered');
  const unknown = out.lanes.find((l) => l.task === null);
  assert.ok(unknown, 'a worktree with no Lattice join is still a lane');
  assert.equal(unknown.joinedBy, null);
  assert.equal(unknown.key, '.worktrees/scratch', 'the path is the key when there is no short id');
  assert.equal(unknown.worktree.detached, true);
});

test('lanes-compose-link-beats-name: an explicit branch-link wins over a parsed short code', () => {
  // The branch NAME says AS-1; the branch LINK on AS-99 claims this branch.
  // The link is a statement, the name is a guess.
  const rows = [wt({ branch: 'feat/AS-1-misleading' })];
  const linked = task({ branch_links: [{ branch: 'feat/AS-1-misleading' }] });
  const other = { id: 'task_1', short_id: 'AS-1', title: 'other', status: 'in_progress', assigned_to: null, branch_links: [] };
  const out = compose({ snapshot: snap(rows), tasks: [linked, other], ids: { 'AS-1': 'task_1' } });
  assert.equal(out.lanes[0].task.shortId, 'AS-99');
  assert.equal(out.lanes[0].joinedBy, 'branch-link');
});

test('lanes-compose-branch-name-fallback: no link, so the short code in the name joins', () => {
  const rows = [wt({ branch: 'feat/AS-1-thing' })];
  const t = { id: 'task_1', short_id: 'AS-1', title: 'other', status: 'review', assigned_to: 'agent:qa-ruben', branch_links: [] };
  const out = compose({ snapshot: snap(rows), tasks: [t], ids: { 'AS-1': 'task_1' } });
  assert.equal(out.lanes[0].joinedBy, 'branch-name');
  assert.equal(out.lanes[0].task.shortId, 'AS-1');
  // A short code that resolves to nothing is not a join.
  const orphan = compose({ snapshot: snap([wt({ branch: 'feat/AS-777-ghost' })]), tasks: [t], ids: { 'AS-1': 'task_1' } });
  assert.equal(orphan.lanes[0].task, null);
  assert.equal(orphan.lanes[0].joinedBy, null);
});

// --- AC-8: task-only lanes --------------------------------------------------

test('lanes-compose-task-only-membership: mid-lifecycle without a worktree is a lane; a queue is not', () => {
  const mk = (id, short, status, assignee = null) => ({
    id,
    short_id: short,
    title: short,
    status,
    assigned_to: assignee,
    branch_links: [],
  });
  const tasks = [
    mk('task_100', 'AS-100', 'in_planning', 'agent:cto-owen'),
    mk('task_101', 'AS-101', 'planned'),
    mk('task_102', 'AS-102', 'review'),
    mk('task_103', 'AS-103', 'backlog'),
    mk('task_104', 'AS-104', 'done'),
    mk('task_105', 'AS-105', 'needs_human'),
    mk('task_106', 'AS-106', 'blocked'),
    mk('task_107', 'AS-107', 'cancelled'),
  ];
  const out = compose({ snapshot: snap([]), tasks, ids: {} });
  assert.equal(out.count, 3, 'cardinality: 8 tasks in, 3 mid-lifecycle lanes out');
  assert.deepEqual(out.lanes.map((l) => l.key), ['AS-100', 'AS-101', 'AS-102']);
  const lane = out.lanes[0];
  assert.equal(lane.joinedBy, 'task-only');
  assert.equal(lane.worktree, null, 'no worktree means null, never a zeroed one');
  assert.equal(lane.employee.assignee, 'agent:cto-owen');
  assert.equal(lane.employee.lastCommitAuthor, null);
  assert.equal(lane.employee.agree, null);
});

test('lanes-compose-task-only-with-worktree: needs_human WITH a worktree is a lane', () => {
  const t = task({ status: 'needs_human' });
  const out = compose({ snapshot: snap([wt()]), tasks: [t], ids: {} });
  assert.equal(out.count, 1);
  assert.equal(out.lanes[0].task.status, 'needs_human');
  assert.equal(out.lanes[0].joinedBy, 'branch-link', 'the worktree exists, so the board sees it');
});

test('lanes-compose-no-double-count: a mid-lifecycle task joined to a worktree yields ONE lane', () => {
  const out = compose({ snapshot: snap([wt()]), tasks: [task()], ids: {} });
  assert.equal(out.count, 1);
});

test('lanes-compose-order: worktree lanes by path, then task-only lanes by short id', () => {
  const rows = [wt({ relPath: '.worktrees/AS-9', branch: 'feat/AS-9-b' }), wt({ relPath: '.worktrees/AS-1', branch: 'feat/AS-1-a' })];
  const tasks = [
    { id: 'task_100', short_id: 'AS-100', title: 't', status: 'planned', assigned_to: null, branch_links: [] },
    { id: 'task_20', short_id: 'AS-20', title: 't', status: 'planned', assigned_to: null, branch_links: [] },
  ];
  const out = compose({ snapshot: snap(rows), tasks, ids: {} });
  assert.deepEqual(out.lanes.map((l) => l.key), ['.worktrees/AS-1', '.worktrees/AS-9', 'AS-20', 'AS-100']);
});

// --- AC-9: STALE ------------------------------------------------------------

test('lanes-stale-reasons: done, cancelled and merged each flag; a live lane does not', () => {
  const live = compose({ snapshot: snap([wt()]), tasks: [task()], ids: {} }).lanes[0];
  assert.deepEqual(live.stale, { flag: false, reasons: [] }, 'in_progress + unmerged is not stale');

  const done = compose({ snapshot: snap([wt()]), tasks: [task({ status: 'done' })], ids: {} }).lanes[0];
  assert.deepEqual(done.stale.reasons, ['task-done']);

  const merged = compose({ snapshot: snap([wt({ merged: true })]), tasks: [task()], ids: {} }).lanes[0];
  assert.deepEqual(merged.stale.reasons, ['merged']);

  const both = compose({ snapshot: snap([wt({ merged: true })]), tasks: [task({ status: 'done' })], ids: {} }).lanes[0];
  assert.deepEqual(both.stale.reasons, ['task-done', 'merged']);
  assert.equal(both.stale.flag, true);

  const cancelled = compose({ snapshot: snap([wt()]), tasks: [task({ status: 'cancelled' })], ids: {} }).lanes[0];
  assert.deepEqual(cancelled.stale.reasons, ['task-cancelled']);

  // ahead 0 alone is NOT stale: a branch cut a minute ago has no commits yet.
  const fresh = compose({ snapshot: snap([wt({ ahead: 0, merged: false })]), tasks: [task()], ids: {} }).lanes[0];
  assert.equal(fresh.stale.flag, false);
});

// --- AC-10: employee is two fields ------------------------------------------

test('lanes-employee-both-fields: assignee and git author are never merged', () => {
  const disagree = compose({
    snapshot: snap([wt({ lastCommit: commit('developer-lena') })]),
    tasks: [task()],
    ids: {},
  }).lanes[0];
  assert.equal(disagree.employee.assignee, 'agent:developer-marcus');
  assert.equal(disagree.employee.lastCommitAuthor, 'developer-lena');
  assert.equal(disagree.employee.agree, false, 'disagreement is information, not noise to resolve');

  const agree = compose({ snapshot: snap([wt()]), tasks: [task()], ids: {} }).lanes[0];
  assert.equal(agree.employee.agree, true, 'agent:developer-marcus and %an developer-marcus are one person');

  const noAssignee = compose({ snapshot: snap([wt()]), tasks: [task({ assigned_to: null })], ids: {} }).lanes[0];
  assert.equal(noAssignee.employee.agree, null, 'a missing side is unknown, never false');

  const noCommit = compose({ snapshot: snap([wt({ lastCommit: null })]), tasks: [task()], ids: {} }).lanes[0];
  assert.equal(noCommit.employee.lastCommitAuthor, null);
  assert.equal(noCommit.employee.agree, null);
});

// --- AC-2/AC-11: the freshness boundary, at the composer level ---------------

test('lanes-stale-boundary: the boundary is LANES_STALE_MS, taken from generatedAt', () => {
  const under = compose({ snapshot: snap([wt()], { generatedAt: iso(LANES_STALE_MS - 1_000) }), tasks: [], ids: {} });
  assert.equal(under.snapshot.stale, false);
  assert.equal(under.snapshot.reason, 'ok');

  const at = compose({ snapshot: snap([wt()], { generatedAt: iso(LANES_STALE_MS) }), tasks: [], ids: {} });
  assert.equal(at.snapshot.stale, false, 'exactly at the threshold is still current');

  const over = compose({ snapshot: snap([wt()], { generatedAt: iso(LANES_STALE_MS + 1_000) }), tasks: [], ids: {} });
  assert.equal(over.snapshot.stale, true);
  assert.equal(over.snapshot.reason, 'stale-snapshot');
  assert.equal(over.count, 1, 'a stale snapshot still renders its lanes, with the age caption');
});

test('lanes-degradation: every unreadable feed is a named reason, never a short list', () => {
  const missing = compose({ snapshot: null, tasks: [task()], ids: {} });
  assert.equal(missing.snapshot.reason, 'no-snapshot');
  assert.equal(missing.lanes, null, 'a partial list must not masquerade as the list');
  assert.equal(missing.count, null);

  for (const garbage of [{ error: 'unparsable' }, { generatedAt: 'not-a-date', worktrees: [] }, { generatedAt: iso(0) }, []]) {
    const out = compose({ snapshot: garbage, tasks: [task()], ids: {} });
    assert.equal(out.snapshot.reason, 'unreadable-snapshot', `unreadable: ${JSON.stringify(garbage)}`);
    assert.equal(out.lanes, null);
  }

  const gitDown = compose({ snapshot: snap([], { error: 'worktree-list-failed: exit 128' }), tasks: [task()], ids: {} });
  assert.equal(gitDown.snapshot.reason, 'git-error');
  assert.equal(gitDown.snapshot.error, 'worktree-list-failed: exit 128');
  assert.deepEqual(gitDown.lanes, []);
  assert.equal(gitDown.count, 0);

  // Every reason the composer can emit has a code in the exported table.
  const emitted = new Set([
    missing.snapshot.reason,
    gitDown.snapshot.reason,
    'unreadable-snapshot',
    compose({ snapshot: snap([]), tasks: [], ids: {} }).snapshot.reason,
    compose({ snapshot: snap([], { generatedAt: iso(600_000) }), tasks: [], ids: {} }).snapshot.reason,
  ]);
  assert.deepEqual([...emitted].sort(), [...LANES_REASON_CODES].sort());
});

test('lanes-compose-tolerant: hostile and half-written rows never throw', () => {
  const out = compose({
    snapshot: snap([null, 'nope', {}, wt({ errors: ['status: exit 128'], dirtyCount: null })]),
    tasks: [task(), null, { id: 'x' }],
    ids: {},
  });
  assert.equal(out.count, 2, 'the two object rows survive; null and the string are skipped');
  const broken = out.lanes.find((l) => l.worktree && l.worktree.errors.length > 0);
  assert.deepEqual(broken.worktree.errors, ['status: exit 128']);
  assert.equal(broken.worktree.dirtyCount, null, 'the failed call yields null, the others are still filled');
});

// --- AS-100 AC-16: the composer gains an input, not a shape -----------------

test('lanes-liveness-shape-unchanged', () => {
  // The card's key list, written out rather than compared to another card from
  // the same run: a mutant that adds a key adds it to BOTH cards, and a
  // self-comparison would stay green through it (observed, M12).
  const LANE_KEYS = ['key', 'task', 'joinedBy', 'worktree', 'employee', 'stale', 'stageStartedAt', 'subAgent'];
  const args = { snapshot: snap([wt({ relPath: '.', main: true, branch: 'master' }), wt()]), tasks: [task()], ids: {} };
  const without = compose(args);
  const bare = without.lanes[0];
  assert.deepEqual(Object.keys(bare), LANE_KEYS);
  assert.equal(bare.key, 'AS-99');
  assert.equal(bare.stageStartedAt, null, 'the reserved slot stays null with no stream');
  assert.equal(bare.subAgent, null);
  assert.equal(without.events.reason, 'no-stream', 'no stream is a fact, not an error');
  assert.deepEqual(Object.keys(without), ['checkedAt', 'snapshot', 'count', 'lanes', 'events']);

  const liveness = {
    'AS-99': {
      stageStartedAt: '2026-09-11T03:50:00.000Z',
      subAgent: {
        actor: 'agent:developer-marcus',
        stage: 'implement',
        alive: true,
        startedAt: '2026-09-11T03:52:00.000Z',
        elapsedS: 480,
        lastEvent: { id: 'cev_1', type: 'subagent_spawned', ts: '2026-09-11T03:52:00.000Z', outcome: null },
      },
    },
  };
  const withLiveness = compose({ ...args, liveness, events: { ...without.events, reason: 'ok', lastId: 'cev_1' } });
  const lane = withLiveness.lanes[0];
  // THE contract: filling the slots adds no key to the card, which is why
  // AS-99's own api-lanes-key-whitelist test needs no edit.
  assert.deepEqual(Object.keys(lane), LANE_KEYS);
  assert.equal(lane.stageStartedAt, liveness['AS-99'].stageStartedAt);
  assert.deepEqual(Object.keys(lane.subAgent), ['actor', 'stage', 'alive', 'startedAt', 'elapsedS', 'lastEvent']);
  assert.deepEqual(Object.keys(lane.subAgent.lastEvent), ['id', 'type', 'ts', 'outcome']);
  assert.equal(lane.subAgent.alive, true);
  assert.equal(withLiveness.events.reason, 'ok');

  // A lane the stream says nothing about keeps its null slots — liveness is
  // joined on the lane key, never smeared across the list.
  const other = compose({ ...args, liveness: { 'AS-42': liveness['AS-99'] } });
  assert.equal(other.lanes[0].stageStartedAt, null);
  assert.equal(other.lanes[0].subAgent, null);
});
