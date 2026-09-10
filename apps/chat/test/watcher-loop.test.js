// AS-95 loop tests: the pure half — shouldContinue(), readyBacklog(),
// readBoard(), headOf(). Fixture boards are inline objects, the reader runs on
// an in-memory readdir/readFile, and headOf runs on a fake fs. No child
// processes, no real repo, main() is never executed (the AS-7 house style).
//
// Test names double as the mutation-protocol ids in the plan's §3 table
// (a-*, b-*, c-*, d-*, e-*, f-*, g-*, dep-*, reader-*, head-*): each row's
// mutant has a predicted red set stated in those ids.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldContinue, readyBacklog, readBoard, headOf, LOOP_DEFAULTS, MID_LIFECYCLE,
} from '../watch/advance-watcher.mjs';

const T0 = Date.parse('2026-09-10T12:00:00.000Z');

/** A settled tick that succeeded and moved master. */
const okTick = (over = {}) => ({ code: 0, signal: null, timedOut: false, headBefore: 'aaa', headAfter: 'bbb', ...over });
/** Loop counters as they stand before the settled tick is folded in. */
const loopAt = (over = {}) => ({ startedAt: T0, ticks: 0, noProgress: 0, failures: 0, ...over });
const task = (over = {}) => ({ id: 't1', short_id: 'AS-1', title: 'A task', status: 'backlog', priority: 'medium', dependsOn: [], ...over });

const run = (over = {}) => shouldContinue({
  board: { tasks: [] },
  sentinel: { messageId: 10 },
  highwater: { messageId: 10 },
  loop: loopAt(),
  tick: okTick(),
  now: T0 + 60_000,
  ...over,
});

// --- (a) mid-lifecycle -----------------------------------------------------

test('a-statuses: any mid-lifecycle status continues the loop', () => {
  assert.deepEqual([...MID_LIFECYCLE], ['in_planning', 'planned', 'in_progress', 'review']);
  for (const status of MID_LIFECYCLE) {
    const r = run({ board: { tasks: [task({ status })] } });
    assert.equal(r.continue, true, status);
    assert.equal(r.reason, 'mid-lifecycle', status);
    assert.deepEqual(r.detail.tasks, ['AS-1'], status);
  }
});

test('a-review: a task in review alone keeps the loop alive', () => {
  const r = run({ board: { tasks: [task({ status: 'review' }), task({ id: 't2', short_id: 'AS-2', status: 'done' })] } });
  assert.equal(r.continue, true);
  assert.equal(r.reason, 'mid-lifecycle');
  assert.deepEqual(r.detail.tasks, ['AS-1']);
});

test('a-terminal-only: done/cancelled/needs_human/blocked are not mid-lifecycle', () => {
  for (const status of ['done', 'cancelled', 'needs_human', 'blocked']) {
    const r = run({ board: { tasks: [task({ status })] } });
    assert.equal(r.reason, 'dry', status);
  }
});

// --- (b) ready backlog -----------------------------------------------------

test('b-ready: a ready backlog task continues the loop', () => {
  const r = run({ board: { tasks: [task()] } });
  assert.equal(r.continue, true);
  assert.equal(r.reason, 'backlog-ready');
  assert.deepEqual(r.detail, { chatSet: 0, other: 1 });
});

test('b-chatset-detail: chat-set membership is counted (title prefix or critical)', () => {
  const board = {
    tasks: [
      task({ id: 'a', title: 'Chat: something', priority: 'low' }),
      task({ id: 'b', title: 'D1 invoice model', priority: 'critical' }),
      task({ id: 'c', title: 'D1 contract model', priority: 'high' }),
    ],
  };
  const r = run({ board });
  assert.equal(r.reason, 'backlog-ready');
  assert.deepEqual(r.detail, { chatSet: 2, other: 1 });
});

test('b-not-ready-statuses: needs_human/blocked-only board is dry', () => {
  const r = run({ board: { tasks: [task({ status: 'needs_human' }), task({ id: 't2', status: 'blocked' })] } });
  assert.equal(r.continue, false);
  assert.equal(r.reason, 'dry');
});

// --- (c) a new message ------------------------------------------------------

test('c-new-message: sentinel above highwater continues, ranked above mid-lifecycle', () => {
  const r = run({
    sentinel: { messageId: 11 },
    highwater: { messageId: 10 },
    board: { tasks: [task({ status: 'in_progress' })] },
  });
  assert.equal(r.continue, true);
  assert.equal(r.reason, 'new-message');
  assert.deepEqual(r.detail, { messageId: 11, highwaterId: 10 });
});

test('c-equal-not-new: sentinel equal to highwater is not a new message', () => {
  const r = run({ sentinel: { messageId: 10 }, highwater: { messageId: 10 }, board: { tasks: [] } });
  assert.equal(r.reason, 'dry');
});

test('c-no-highwater: a first message with no highwater is new', () => {
  const r = run({ sentinel: { messageId: 1 }, highwater: null });
  assert.equal(r.reason, 'new-message');
});

// --- (d) dry ----------------------------------------------------------------

test('d-dry: an empty board with nothing new stops the loop', () => {
  const r = run({ board: { tasks: [] } });
  assert.equal(r.continue, false);
  assert.equal(r.reason, 'dry');
  assert.equal(r.detail.ticks, 1);
});

// --- (e) no progress --------------------------------------------------------

test('e-one-continues: one unmoved HEAD continues with noProgress 1', () => {
  const r = run({
    tick: okTick({ headBefore: 'aaa', headAfter: 'aaa' }),
    board: { tasks: [task({ status: 'in_progress' })] },
  });
  assert.equal(r.continue, true);
  assert.equal(r.reason, 'mid-lifecycle');
  assert.equal(r.loop.noProgress, 1);
});

test('e-two: two consecutive unmoved HEADs stop the loop even with work left', () => {
  const r = run({
    tick: okTick({ headBefore: 'aaa', headAfter: 'aaa' }),
    loop: loopAt({ ticks: 1, noProgress: 1 }),
    board: { tasks: [task({ status: 'in_progress' })] },
  });
  assert.equal(r.continue, false);
  assert.equal(r.reason, 'no-progress');
  assert.equal(r.detail.noProgress, 2);
  // the detail names the condition it saw (which of a/b/c held) — plan §2.2 rule 2
  assert.deepEqual(r.detail.midLifecycle, ['AS-1']);
  assert.equal(r.detail.newMessage, false);
  assert.equal(r.detail.ready, 0);
});

test('e-reset: a moved HEAD resets the no-progress counter', () => {
  const r = run({ loop: loopAt({ ticks: 1, noProgress: 1 }), board: { tasks: [task({ status: 'in_progress' })] } });
  assert.equal(r.continue, true);
  assert.equal(r.loop.noProgress, 0);
});

test('e-unknown-head: an unreadable HEAD counts as no progress', () => {
  const r = run({
    tick: okTick({ headBefore: null, headAfter: null }),
    board: { tasks: [task({ status: 'in_progress' })] },
  });
  assert.equal(r.loop.noProgress, 1);
  const second = run({
    tick: okTick({ headBefore: null, headAfter: null }),
    loop: loopAt({ ticks: 1, noProgress: 1 }),
    board: { tasks: [task({ status: 'in_progress' })] },
  });
  assert.equal(second.continue, false);
  assert.equal(second.reason, 'no-progress');
  assert.equal(second.detail.headKnown, false);
});

// --- (f) the cap ------------------------------------------------------------

test('f-23: the 23rd tick still continues', () => {
  const r = run({ loop: loopAt({ ticks: 22 }), board: { tasks: [task({ status: 'in_progress' })] } });
  assert.equal(r.loop.ticks, 23);
  assert.equal(r.continue, true);
});

test('f-24: the 24th tick hits the cap', () => {
  const r = run({ loop: loopAt({ ticks: 23 }), board: { tasks: [task({ status: 'in_progress' })] } });
  assert.equal(r.continue, false);
  assert.equal(r.reason, 'cap-hit');
  assert.equal(r.detail.ticks, 24);
  assert.equal(r.loop.ticks, LOOP_DEFAULTS.maxTicks);
});

test('f-8h: eight hours elapsed hits the cap regardless of tick count', () => {
  const r = run({
    loop: loopAt({ ticks: 2 }),
    now: T0 + LOOP_DEFAULTS.maxMs,
    board: { tasks: [task({ status: 'in_progress' })] },
  });
  assert.equal(r.continue, false);
  assert.equal(r.reason, 'cap-hit');
  assert.equal(r.detail.elapsedMs, LOOP_DEFAULTS.maxMs);
});

test('f-limits-injectable: a caller can tighten the caps', () => {
  const r = run({ loop: loopAt({ ticks: 1 }), limits: { ...LOOP_DEFAULTS, maxTicks: 2 }, board: { tasks: [task({ status: 'in_progress' })] } });
  assert.equal(r.reason, 'cap-hit');
});

// --- (g) failures -----------------------------------------------------------

test('g-one: a single failed tick continues with failures 1', () => {
  const r = run({ tick: okTick({ code: 1 }), board: { tasks: [task({ status: 'in_progress' })] } });
  assert.equal(r.continue, true);
  assert.equal(r.loop.failures, 1);
});

test('g-two: two failed ticks stop the loop', () => {
  const r = run({
    tick: okTick({ code: 1 }),
    loop: loopAt({ ticks: 1, failures: 1 }),
    board: { tasks: [task({ status: 'in_progress' })] },
  });
  assert.equal(r.continue, false);
  assert.equal(r.reason, 'tick-failed-twice');
  assert.equal(r.detail.code, 1);
});

test('g-timeout: a timed-out tick counts as a failure, as does a signal', () => {
  for (const over of [{ timedOut: true }, { signal: 'SIGTERM' }]) {
    const first = run({ tick: okTick(over), board: { tasks: [task({ status: 'in_progress' })] } });
    assert.equal(first.loop.failures, 1, JSON.stringify(over));
    const second = run({
      tick: okTick(over),
      loop: loopAt({ ticks: 1, failures: 1 }),
      board: { tasks: [task({ status: 'in_progress' })] },
    });
    assert.equal(second.continue, false, JSON.stringify(over));
    assert.equal(second.reason, 'tick-failed-twice', JSON.stringify(over));
  }
});

test('g-reset: a clean tick resets the failure counter', () => {
  const r = run({ loop: loopAt({ ticks: 1, failures: 1 }), board: { tasks: [task({ status: 'in_progress' })] } });
  assert.equal(r.loop.failures, 0);
  assert.equal(r.continue, true);
});

test('g-precedence: failures stop the loop even when a new message is waiting', () => {
  const r = run({
    tick: okTick({ code: 2 }),
    loop: loopAt({ ticks: 1, failures: 1 }),
    sentinel: { messageId: 99 },
    highwater: { messageId: 10 },
    board: { tasks: [task({ status: 'in_progress' })] },
  });
  assert.equal(r.continue, false);
  assert.equal(r.reason, 'tick-failed-twice');
});

// --- AC-4: dependency readiness --------------------------------------------

test('dep-unmet-out: a backlog task with an unmet depends_on is not ready', () => {
  const board = { tasks: [task({ id: 'a', dependsOn: ['b'] }), task({ id: 'b', status: 'in_planning' })] };
  assert.deepEqual(readyBacklog(board).map((t) => t.id), []);
});

test('dep-met: a backlog task whose deps are done/cancelled is ready', () => {
  for (const status of ['done', 'cancelled']) {
    const board = { tasks: [task({ id: 'a', dependsOn: ['b'] }), task({ id: 'b', status })] };
    assert.deepEqual(readyBacklog(board).map((t) => t.id), ['a'], status);
  }
});

test('dep-missing-target: an unresolvable dependency is unmet, not ignored', () => {
  const board = { tasks: [task({ id: 'a', dependsOn: ['ghost'] })] };
  assert.deepEqual(readyBacklog(board).map((t) => t.id), []);
  assert.equal(shouldContinue({ board, sentinel: null, highwater: null, loop: loopAt(), tick: okTick(), now: T0 }).reason, 'dry');
});

test('dep-unmet-in: an inverse "blocks" edge makes the blocked task unready', () => {
  const dir = {
    'a.json': JSON.stringify({ id: 'a', short_id: 'AS-1', title: 'blocked one', status: 'backlog', priority: 'high', relationships_out: [] }),
    'b.json': JSON.stringify({
      id: 'b', short_id: 'AS-2', title: 'blocker', status: 'in_progress', priority: 'high',
      relationships_out: [{ type: 'blocks', target_task_id: 'a' }],
    }),
  };
  const board = readBoard('/tasks', fakeFs(dir));
  assert.deepEqual(board.tasks.find((t) => t.id === 'a').dependsOn, ['b']);
  assert.deepEqual(readyBacklog(board).map((t) => t.id), []);
});

// --- the reader -------------------------------------------------------------

function fakeFs(dir) {
  return {
    readdir: (p) => {
      if (p !== '/tasks') throw new Error(`ENOENT ${p}`);
      return Object.keys(dir);
    },
    readFile: (p) => {
      const name = p.split('/').pop();
      if (!(name in dir)) throw new Error(`ENOENT ${p}`);
      return dir[name];
    },
  };
}

test('reader-shape: readBoard projects the fields the predicate needs', () => {
  const dir = {
    'a.json': JSON.stringify({
      id: 'a', short_id: 'AS-1', title: 'Chat: loop', status: 'backlog', priority: 'critical',
      relationships_out: [{ type: 'depends_on', target_task_id: 'b' }, { type: 'subtask_of', target_task_id: 'b' }],
      description: 'ignored', assignee: 'agent:developer-marcus',
    }),
    'b.json': JSON.stringify({ id: 'b', short_id: 'AS-2', title: 'dep', status: 'done', priority: 'low' }),
    'notes.txt': 'not json — never listed',
  };
  const board = readBoard('/tasks', fakeFs(dir));
  assert.equal(board.tasks.length, 2);
  assert.deepEqual(board.tasks[0], {
    id: 'a', short_id: 'AS-1', title: 'Chat: loop', status: 'backlog', priority: 'critical', dependsOn: ['b'],
  });
  assert.equal(board.unreadable, 0);
  assert.deepEqual(readyBacklog(board).map((t) => t.id), ['a']);
});

test('reader-unparsable: a half-written task file is skipped and counted', () => {
  const dir = {
    'a.json': '{"id":"a","status":"backlog","title":"t","priority":"low"}',
    'half.json': '{"id":"b","stat', // mid-write, tmp+rename not landed
    'weird.json': '"a bare string"',
  };
  const board = readBoard('/tasks', fakeFs(dir));
  assert.equal(board.tasks.length, 1);
  assert.equal(board.unreadable, 2);
});

test('reader-missing-dir: a missing tasks dir yields an empty board, no throw', () => {
  const board = readBoard('/nope', fakeFs({}));
  assert.deepEqual(board.tasks, []);
  assert.equal(board.missingDir, true);
  assert.equal(shouldContinue({
    board, sentinel: null, highwater: null, loop: loopAt(), tick: okTick(), now: T0,
  }).reason, 'dry');
});

// --- headOf -----------------------------------------------------------------

function fakeHead(files) {
  return {
    readFile: (p) => {
      if (!(p in files)) { const e = new Error(`ENOENT ${p}`); throw e; }
      return files[p];
    },
  };
}

test('head-ref: a symbolic HEAD resolves through .git/refs', () => {
  const sha = '1'.repeat(40);
  const r = headOf('/repo', fakeHead({
    '/repo/.git/HEAD': 'ref: refs/heads/master\n',
    '/repo/.git/refs/heads/master': `${sha}\n`,
  }));
  assert.equal(r, sha);
});

test('head-packed: a HEAD with no loose ref falls back to packed-refs', () => {
  const sha = '2'.repeat(40);
  const r = headOf('/repo', fakeHead({
    '/repo/.git/HEAD': 'ref: refs/heads/master\n',
    '/repo/.git/packed-refs': `# pack-refs with: peeled fully-peeled sorted \n${sha} refs/heads/master\n`,
  }));
  assert.equal(r, sha);
});

test('head-detached: a detached HEAD returns the sha itself', () => {
  const sha = '3'.repeat(40);
  assert.equal(headOf('/repo', fakeHead({ '/repo/.git/HEAD': `${sha}\n` })), sha);
});

test('head-worktree: a gitdir: pointer file is followed', () => {
  const sha = '4'.repeat(40);
  const r = headOf('/repo/.worktrees/AS-95', fakeHead({
    '/repo/.worktrees/AS-95/.git': 'gitdir: /repo/.git/worktrees/AS-95\n',
    '/repo/.git/worktrees/AS-95/HEAD': 'ref: refs/heads/feat/AS-95-watcher-loop\n',
    '/repo/.git/worktrees/AS-95/refs/heads/feat/AS-95-watcher-loop': `${sha}\n`,
  }));
  assert.equal(r, sha);
});

test('head-unreadable: an unreadable repo yields null, never a throw', () => {
  assert.equal(headOf('/repo', fakeHead({})), null);
  assert.equal(headOf('/repo', fakeHead({ '/repo/.git/HEAD': 'ref: refs/heads/master\n' })), null);
});
