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
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  shouldContinue, readyBacklog, readBoard, headOf, LOOP_DEFAULTS, MID_LIFECYCLE, makeLockOps, makeLoopOps, DEFAULTS,
  nextPollAction, makeDeployOps, loopLimits,
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

// AC-5: a message that lands while the loop is between ticks is fired ONCE.
// nextPollAction is the only place the two paths are ordered, so this is the
// whole property, not a sample of it: the message branch wins and returns, and
// the loop branch is unreachable in the same poll.
test('c-single-fire: a poll fires the message OR the loop, never both', () => {
  // decide() says fire (a new human message): that is the path that moves the
  // highwater. The loop owes a tick too — and must not take it.
  assert.equal(nextPollAction({ decideAction: 'fire', loopPending: true, deployPending: false }), 'fire-message');
  assert.equal(nextPollAction({ decideAction: 'fire', loopPending: false, deployPending: false }), 'fire-message');
  // Even a pending deploy does not delay the board's own message — only the
  // loop's self-scheduled tick waits.
  assert.equal(nextPollAction({ decideAction: 'fire', loopPending: true, deployPending: true }), 'fire-message');

  // Enumerated: over every combination of inputs, exactly one fire per poll.
  const decideActions = ['fire', 'debounce', 'skip-locked', 'idle'];
  const combos = [];
  for (const decideAction of decideActions) {
    for (const loopPending of [true, false]) {
      for (const deployPending of [true, false]) {
        combos.push([{ decideAction, loopPending, deployPending }, nextPollAction({ decideAction, loopPending, deployPending })]);
      }
    }
  }
  assert.equal(combos.length, 16, 'cardinality: 4 x 2 x 2 inputs examined');
  for (const [input, out] of combos) {
    assert.ok(['fire-message', 'fire-loop', 'wait-deploy', 'idle'].includes(out), JSON.stringify(input));
    const fires = (out === 'fire-message' ? 1 : 0) + (out === 'fire-loop' ? 1 : 0);
    assert.ok(fires <= 1, `${JSON.stringify(input)} -> ${out}: at most one fire`);
    if (input.decideAction === 'fire') assert.equal(out, 'fire-message', 'a message always beats the loop');
  }
  // And the loop only fires when it is actually owed one and nothing is due.
  assert.equal(combos.filter(([, out]) => out === 'fire-loop').length, 3, 'exactly the three non-fire decideActions with loopPending and no deploy');
});

test('c-single-fire-deploy-yield: the loop waits for a pending rebuild, but only when it owes a tick', () => {
  assert.equal(nextPollAction({ decideAction: 'idle', loopPending: true, deployPending: true }), 'wait-deploy');
  assert.equal(nextPollAction({ decideAction: 'idle', loopPending: true, deployPending: false }), 'fire-loop');
  // Nothing owed: a pending deploy is the deploy poll's business, not a reason
  // for this poll to report anything at all.
  assert.equal(nextPollAction({ decideAction: 'idle', loopPending: false, deployPending: true }), 'idle');
  // decide() debouncing a message is NOT a fire: the loop still owes its tick,
  // and taking it here is what keeps the company moving during the 15s window.
  assert.equal(nextPollAction({ decideAction: 'debounce', loopPending: true, deployPending: false }), 'fire-loop');
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

// --- the lock's loop marker (real lockfile in a temp dir, AS-13 house style) --

function lockOps() {
  const dir = mkdtempSync(join(tmpdir(), 'as95-lock-'));
  const lockPath = join(dir, 'advance.lock');
  return { lockPath, ops: makeLockOps({ lockPath, staleMs: 45 * 60 * 1000, log: () => {}, pid: 4242 }) };
}

test('lock-marker: a loop tick stamps loop.ticks into the lock body, source unchanged', () => {
  const { lockPath, ops } = lockOps();
  assert.equal(ops.acquireLock('deadbeefcafef00d', { loop: { ticks: 3 } }), true);
  const body = JSON.parse(readFileSync(lockPath, 'utf8'));
  assert.equal(body.source, 'watcher'); // AS-84/advance.md step 0 must not shift
  assert.equal(body.nonce, 'deadbeefcafef00d');
  assert.equal(body.pid, 4242);
  assert.deepEqual(body.loop, { ticks: 3 });
});

test('lock-marker-absent: acquiring without the marker leaves the body exactly as it was', () => {
  const { lockPath, ops } = lockOps();
  assert.equal(ops.acquireLock('deadbeefcafef00d'), true);
  const body = JSON.parse(readFileSync(lockPath, 'utf8'));
  assert.deepEqual(Object.keys(body).sort(), ['nonce', 'pid', 'source', 'startedAt']);
});

test('head-unreadable: an unreadable repo yields null, never a throw', () => {
  assert.equal(headOf('/repo', fakeHead({})), null);
  assert.equal(headOf('/repo', fakeHead({ '/repo/.git/HEAD': 'ref: refs/heads/master\n' })), null);
});

// --- makeLoopOps: the state machine, and the three cycle-1 defects ----------
//
// The predicate above was never what failed. What failed was the wiring around
// it — armed here, resumed there, aborted somewhere else — which lived inside
// main() where no test could reach it. These cases are the falsifiers for the
// three defects the cycle-1 review found there (F1, F2, F3); each one fails
// against the code as it stood before its fix, and the mutation log in the
// implementation comment records which case each mutant reddens.

/** A loop-ops under a fake clock, fake files and a captured log. Defaults are
 *  the run3/run4b situation: one task in flight, one message already fired. */
function loopHarness(over = {}) {
  const logs = [];
  const saved = [];
  let clock = T0;
  const ops = makeLoopOps({
    loadBoard: () => ({ tasks: [task({ status: 'in_progress' })] }),
    loadSentinel: () => ({ messageId: 1 }),
    loadHighwater: () => ({ messageId: 1 }),
    loadLock: () => null,
    loadState: () => null,
    saveState: (body) => saved.push(body),
    log: (line) => logs.push(line),
    now: () => clock,
    resumeGraceMs: 30 * 60 * 1000,
    limits: { ...LOOP_DEFAULTS, maxLockWaitMs: 60 * 60 * 1000 },
    ...over,
  });
  return {
    ops,
    logs,
    saved,
    advance: (ms) => {
      clock += ms;
    },
    lines: (prefix) => logs.filter((l) => l.startsWith(prefix)),
  };
}

/** A lock body as makeLockOps writes it, `ageMs` old. */
const lockBody = (ageMs, over = {}) => ({
  pid: 4242,
  startedAt: new Date(T0 - ageMs).toISOString(),
  source: 'watcher',
  nonce: 'deadbeefcafef00d',
  ...over,
});

// F3 — the mirror is what a restarted watcher resumes from. Written only at
// settle, it does not exist yet while tick 1 runs, so a death during tick 1
// loses the loop entirely (observed: the watcher came back idle and the
// company sat still until the next message).

test('f3-mirror-at-start: arming a loop mirrors it immediately, before its first tick runs', () => {
  const h = loopHarness();
  h.ops.start({ messageId: 7 });
  assert.equal(h.saved.length, 1, 'LOOP-START must write advance-loop.json');
  assert.equal(h.saved[0].active, true);
  assert.equal(h.saved[0].ticks, 0);
  assert.equal(h.saved[0].armedBy, 7);
});

test('f3-mirror-is-resumable: what start() writes is what resume() re-enters', () => {
  const first = loopHarness();
  first.ops.start({ messageId: 7 });
  const mirror = first.saved.at(-1);
  const second = loopHarness({ loadState: () => mirror });
  second.ops.resume();
  assert.equal(second.ops.active(), true);
  assert.equal(second.ops.pending(), true);
  assert.equal(second.ops.snapshot().ticks, 0);
  assert.equal(second.lines('LOOP-RESUME').length, 1);
});

// F1 — a loop tick that loses the lock. fire() aborted without telling the loop
// anything, so nothing re-evaluated the predicate: no further tick, no
// LOOP-STOP, a mirror frozen at active:true, and a board with no way to see
// that the company had stopped.

test('f1-abort-retries: an aborted loop fire keeps the debt and says so once', () => {
  const h = loopHarness();
  h.ops.start({ messageId: 1 });
  h.ops.takeFire();
  assert.equal(h.ops.pending(), false, 'poll() has taken the owed tick');
  h.ops.aborted();
  assert.equal(h.ops.pending(), true, 'the loop still owes a tick: retry on the next poll');
  assert.equal(h.ops.active(), true);
  assert.equal(h.lines('LOOP-WAIT lock').length, 1);
  h.advance(5_000);
  h.ops.aborted();
  assert.equal(h.lines('LOOP-WAIT lock').length, 1, 'one line per wait episode, not one per poll');
  assert.equal(h.ops.pending(), true);
});

test('f1-abort-bounded: a lock that never frees stops the loop with a reason the board can read', () => {
  const h = loopHarness();
  h.ops.start({ messageId: 1 });
  h.ops.takeFire();
  h.ops.aborted();
  h.advance(60 * 60 * 1000);
  h.ops.aborted();
  assert.equal(h.ops.active(), false);
  assert.equal(h.ops.pending(), false);
  const stops = h.lines('LOOP-STOP');
  assert.equal(stops.length, 1, 'every stop is logged, this one included');
  assert.match(stops[0], /reason=lock-unavailable/);
  assert.equal(h.ops.snapshot().lastLoop.reason, 'lock-unavailable');
  assert.equal(h.saved.at(-1).active, false, 'the mirror stops claiming a live loop');
  assert.equal(h.saved.at(-1).lastLoop.reason, 'lock-unavailable');
});

test('f1-abort-clears-on-success: a fire that gets the lock ends the wait episode', () => {
  const h = loopHarness();
  h.ops.start({ messageId: 1 });
  h.ops.takeFire();
  h.ops.aborted();
  h.advance(59 * 60 * 1000);
  h.ops.takeFire();
  h.ops.start({ messageId: 1 }); // fire() succeeded: the loop is going ahead
  h.advance(59 * 60 * 1000); // ... so the OLD wait must not carry over and stop it
  h.ops.aborted();
  assert.equal(h.ops.active(), true, 'the wait clock restarts with the new episode');
  assert.equal(h.lines('LOOP-STOP').length, 0);
  assert.equal(h.lines('LOOP-WAIT lock').length, 2, 'a new episode logs again');
});

test('f1-abort-outside-a-loop: an aborted message fire arms nothing and stops nothing', () => {
  const h = loopHarness();
  h.ops.aborted();
  assert.equal(h.ops.active(), false);
  assert.deepEqual(h.logs, []);
  assert.deepEqual(h.saved, []);
});

// AS-129 T10 (replaces f1-limit-default). The old 60-min literal was shorter
// than the host's 75-min staleness rule alone once the plist moved to 60/75:
// the wait is DERIVED from the config it has to outlive, never a literal.
test('as129-t10-limits-derived: maxLockWaitMs is the tick timeout plus the lock staleness, from config, never a literal', () => {
  const host = loopLimits({ tickTimeoutMin: 60, lockStaleMin: 75, loopRearmMin: 10 });
  assert.equal(host.maxLockWaitMs, 8_100_000, '135 min on the host\'s 60/75');
  assert.equal(host.rearmMs, 600_000);
  assert.equal(host.maxTicks, LOOP_DEFAULTS.maxTicks, 'everything else is the base');
  assert.equal(loopLimits(DEFAULTS).maxLockWaitMs, 4_500_000, '75 min on the 30/45 defaults');
  assert.equal(LOOP_DEFAULTS.maxLockWaitMs, (DEFAULTS.tickTimeoutMin + DEFAULTS.lockStaleMin) * 60_000);
  assert.equal(LOOP_DEFAULTS.rearmMs, DEFAULTS.loopRearmMin * 60_000);
  assert.ok(LOOP_DEFAULTS.maxLockWaitMs > DEFAULTS.tickTimeoutMin * 60 * 1000);
  assert.ok(LOOP_DEFAULTS.maxLockWaitMs > DEFAULTS.lockStaleMin * 60 * 1000);
});

// F2 — resume over an orphan. A SIGKILLed watcher leaves its tick running and
// its lock behind; the lock's pid is the DEAD watcher's, so the stale-steal
// rule fires and the resumed loop starts a second tick beside the first. The
// gate is lock AGE, deliberately not pid liveness: the pid in that file belongs
// to the watcher, and whether the watcher is alive says nothing about whether
// its child is (AS-84 owns the pid-vs-source question).

const resumeState = { active: true, ticks: 1, startedAt: new Date(T0 - 60_000).toISOString(), armedBy: 3 };

test('f2-resume-waits-out-a-live-lock: a young lock blocks the resumed fire, once, loudly', () => {
  const h = loopHarness({ loadState: () => resumeState, loadLock: () => lockBody(5_000) });
  h.ops.resume();
  assert.equal(h.ops.pending(), true);
  assert.equal(h.ops.blockedByLock(), true, 'the dead watcher may have left a live tick behind');
  assert.equal(h.lines('LOOP-WAIT lock').length, 1);
  assert.equal(h.ops.blockedByLock(), true);
  assert.equal(h.lines('LOOP-WAIT lock').length, 1, 'one line per episode');
});

test('f2-resume-fires-when-the-lock-aged-out: older than a whole tick timeout is not a live tick', () => {
  const h = loopHarness({ loadState: () => resumeState, loadLock: () => lockBody(31 * 60 * 1000) });
  h.ops.resume();
  assert.equal(h.ops.blockedByLock(), false);
  assert.equal(h.lines('LOOP-WAIT lock').length, 0);
});

test('f2-resume-fires-with-no-lock: nothing held means nothing to wait for', () => {
  const h = loopHarness({ loadState: () => resumeState });
  h.ops.resume();
  assert.equal(h.ops.blockedByLock(), false);
});

test('f2-gate-is-age-not-pid: a young lock whose owner pid is long dead still blocks', () => {
  // This is the run4b lock exactly: written by the watcher that was SIGKILLed,
  // so its pid is dead — and its claude child is not. Anything that consulted
  // pid liveness here would fire straight over it.
  const h = loopHarness({ loadState: () => resumeState, loadLock: () => lockBody(3_000, { pid: 999_999 }) });
  h.ops.resume();
  assert.equal(h.ops.blockedByLock(), true);
});

test('f2-undatable-lock-does-not-block-forever: a lock with no readable age is left to the steal rule', () => {
  const h = loopHarness({ loadState: () => resumeState, loadLock: () => lockBody(0, { startedAt: 'not-a-date' }) });
  h.ops.resume();
  assert.equal(h.ops.blockedByLock(), false, 'an undatable lock never ages out; blocking on it would hang the loop');
});

test('f2-gate-is-resume-only: once the resumed loop fires its own tick, the gate is gone', () => {
  const h = loopHarness({ loadState: () => resumeState, loadLock: () => lockBody(5_000) });
  h.ops.resume();
  assert.equal(h.ops.blockedByLock(), true);
  h.ops.takeFire();
  h.ops.start({ messageId: 3 }); // fire() got the lock; this one is ours
  assert.equal(h.ops.blockedByLock(), false, 'our own tick’s lock must not block our own loop');
  assert.equal(h.ops.snapshot().resumeHold, false);
});

test('f2-poll-order: a held lock outranks a pending deploy, and a message outranks both', () => {
  const base = { decideAction: 'idle', loopPending: true, deployPending: false, lockHeld: false };
  assert.equal(nextPollAction({ ...base, lockHeld: true, deployPending: true }), 'wait-lock');
  assert.equal(nextPollAction({ ...base, lockHeld: true }), 'wait-lock');
  assert.equal(nextPollAction({ ...base, deployPending: true }), 'wait-deploy');
  assert.equal(nextPollAction(base), 'fire-loop');
  // A message is the one thing a person is waiting on; decide() owns the lock
  // question on that path (and has since AS-7), so the gate never delays it.
  assert.equal(nextPollAction({ ...base, decideAction: 'fire', lockHeld: true }), 'fire-message');
  // Nothing owed: a held lock is not this poll's business.
  assert.equal(nextPollAction({ ...base, loopPending: false, lockHeld: true }), 'idle');
});

test('f1-retry-is-quiet: the retries inside a wait episode do not re-announce the tick', () => {
  const h = loopHarness();
  h.ops.start({ messageId: 1 });
  h.ops.takeFire();
  assert.deepEqual(h.lines('LOOP-FIRE'), ['LOOP-FIRE tick 1']);
  h.ops.aborted();
  h.ops.takeFire();
  h.ops.aborted();
  h.ops.takeFire();
  assert.equal(h.lines('LOOP-FIRE').length, 1, 'a 5s poll that retries must not flood the log');
  assert.equal(h.lines('LOOP-WAIT lock').length, 1);
});

// The mirror is the loop's only durable witness: the sidebar reads it, and a
// restarted watcher resumes from it. Every evaluation must reach it — a mutant
// that deleted settle()'s write survived the whole suite while this file had
// only the LOOP-START half.

test('f3-mirror-after-every-settle: a settled tick is in the file before the next one fires', () => {
  const h = loopHarness();
  h.ops.start({ messageId: 9 });
  h.ops.takeFire();
  h.advance(120_000);
  h.ops.settle(okTick());
  const mirror = h.saved.at(-1);
  assert.equal(h.saved.length, 2, 'armed, then settled');
  assert.equal(mirror.active, true);
  assert.equal(mirror.ticks, 1, 'the tick that just ran is counted in the file, not only in memory');
  assert.equal(mirror.armedBy, 9);
  assert.equal(mirror.lastTick.headMoved, true);
  assert.equal(mirror.lastTick.code, 0);
  assert.equal(mirror.lastLoop, null);
});

test('f3-mirror-records-the-stop: the file says the loop ended and why', () => {
  const h = loopHarness({ loadBoard: () => ({ tasks: [] }) });
  h.ops.start({ messageId: 9 });
  h.ops.takeFire();
  h.ops.settle(okTick());
  const mirror = h.saved.at(-1);
  assert.equal(mirror.active, false, 'a stopped loop must not go on claiming the sidebar');
  assert.equal(mirror.ticks, 0);
  assert.equal(mirror.lastLoop.reason, 'dry');
  assert.equal(mirror.lastLoop.ticks, 1);
  assert.equal(h.lines('LOOP-STOP').length, 1);
});

test('f3-mirror-outside-a-loop: a tick with no loop still refreshes lastTick', () => {
  const h = loopHarness();
  h.ops.settle(okTick({ headAfter: 'aaa' }));
  assert.equal(h.saved.length, 1);
  assert.equal(h.saved[0].active, false);
  assert.equal(h.saved[0].lastTick.headMoved, false);
  assert.equal(h.lines('LOOP-EVAL').length, 0, 'no loop, no evaluation');
});

// --- AS-129: the cap is a runaway guard, not a stop rule ---------------------
//
// The live loop stopped `cap-hit` at 11:21Z on 2026-09-12 after 15 ticks with
// work mid-lifecycle, and the company sat idle until the board spoke again.
// The cap still stops THAT loop (stop() stays the only way to clear `loop`);
// with work remaining the stop is followed by a cooldown, and a fresh loop
// fires when it elapses. Test ids are the plan's T1–T9; the mutant table in
// the plan names which of these each mutant reddens.

const TEN_MIN = 10 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();

/** A loop-ops with a two-tick cap and a ten-minute cooldown, one task in review. */
function capHarness(over = {}) {
  return loopHarness({
    loadBoard: () => ({ tasks: [task({ status: 'review' })] }),
    limits: { ...LOOP_DEFAULTS, maxTicks: 2, rearmMs: TEN_MIN },
    ...over,
  });
}

/** Arm a loop and settle it into the cap: two ticks against maxTicks 2. */
function driveToCap(h, messageId = 5) {
  h.ops.start({ messageId });
  h.ops.takeFire();
  h.ops.settle(okTick());
  h.ops.takeFire();
  h.ops.settle(okTick());
}

test('as129-t1-cap-with-mid-lifecycle: the cap-hit detail says to re-arm when a task is in flight', () => {
  const r = run({ board: { tasks: [task({ status: 'review' })] }, loop: loopAt({ ticks: 23 }) });
  assert.equal(r.continue, false);
  assert.equal(r.reason, 'cap-hit');
  assert.equal(r.detail.rearm, true);
  assert.equal(r.detail.ticks, 24);
});

test('as129-t2-cap-with-ready-backlog: a ready backlog task alone is enough to re-arm', () => {
  const r = run({ board: { tasks: [task({ status: 'backlog' })] }, loop: loopAt({ ticks: 23 }) });
  assert.equal(r.reason, 'cap-hit');
  assert.equal(r.detail.rearm, true);
  // Elapsed cap, same answer.
  const e = run({ board: { tasks: [task({ status: 'backlog' })] }, now: T0 + LOOP_DEFAULTS.maxMs });
  assert.equal(e.reason, 'cap-hit');
  assert.equal(e.detail.rearm, true);
});

test('as129-t3-cap-on-a-dry-board: no work means no re-arm — needs_human is waiting on the board, not work', () => {
  const empty = run({ board: { tasks: [] }, loop: loopAt({ ticks: 23 }) });
  assert.equal(empty.reason, 'cap-hit');
  assert.equal(empty.detail.rearm, false);
  const waiting = run({ board: { tasks: [task({ status: 'needs_human' }), task({ id: 't2', status: 'done' })] }, loop: loopAt({ ticks: 23 }) });
  assert.equal(waiting.reason, 'cap-hit');
  assert.equal(waiting.detail.rearm, false);
  // A blocked backlog task is not ready either.
  const blocked = run({ board: { tasks: [task({ dependsOn: ['nope'] })] }, loop: loopAt({ ticks: 23 }) });
  assert.equal(blocked.detail.rearm, false);
});

test('as129-t4-settle-enters-the-cooldown: cap-hit with work stops the loop, logs the cooldown, and mirrors rearmAt', () => {
  const h = capHarness();
  driveToCap(h, 5);
  assert.equal(h.ops.active(), false, 'the cap DID stop the loop');
  assert.equal(h.ops.pending(), false);
  const stops = h.lines('LOOP-STOP');
  assert.equal(stops.length, 1);
  assert.match(stops[0], /reason=cap-hit after 2 ticks/);
  assert.match(stops[0], /"rearm":true/);
  assert.deepEqual(h.lines('LOOP-COOLDOWN'), [
    `LOOP-COOLDOWN until ${iso(T0 + TEN_MIN)} armedBy messageId 5 (cap-hit with work remaining)`,
  ]);
  const mirror = h.saved.at(-1);
  assert.equal(mirror.active, false);
  assert.equal(mirror.rearmAt, iso(T0 + TEN_MIN));
  assert.equal(mirror.armedBy, 5, 'the message stays on the file while cooling');
  assert.equal(mirror.lastLoop.reason, 'cap-hit');
  assert.equal(mirror.lastLoop.ticks, 2);
  assert.equal(h.ops.snapshot().rearmAt, iso(T0 + TEN_MIN));
});

test('as129-t5-rearm-when-due: after the cooldown a FRESH loop is armed — ticks 0, new startedAt, same message, one tick owed', () => {
  const h = capHarness();
  driveToCap(h, 5);
  h.advance(TEN_MIN - 1000);
  assert.equal(h.ops.rearmIfDue(), false, '9 min 59 s: not yet');
  assert.equal(h.ops.active(), false);
  assert.equal(h.lines('LOOP-REARM').length, 0);
  h.advance(1000);
  assert.equal(h.ops.rearmIfDue(), true, '10 min: due');
  assert.equal(h.ops.active(), true);
  assert.equal(h.ops.pending(), true, 'the re-armed loop owes its first tick');
  assert.equal(h.ops.snapshot().ticks, 0, 'a fresh loop, not the capped one continued');
  assert.equal(h.ops.snapshot().rearmAt, null);
  assert.deepEqual(h.lines('LOOP-REARM'), ['LOOP-REARM armedBy messageId 5 after cap-hit cooldown']);
  const mirror = h.saved.at(-1);
  assert.equal(mirror.active, true);
  assert.equal(mirror.ticks, 0);
  assert.equal(mirror.startedAt, iso(T0 + TEN_MIN), 'the cap counts from the re-arm, not the original message');
  assert.equal(mirror.armedBy, 5);
  assert.equal(mirror.rearmAt, null);
  assert.equal(mirror.lastLoop.reason, 'cap-hit', 'the previous loop\'s stop is still on record');
  h.ops.takeFire();
  assert.deepEqual(h.lines('LOOP-FIRE'), ['LOOP-FIRE tick 1', 'LOOP-FIRE tick 2', 'LOOP-FIRE tick 1'], 'the new loop fires tick 1');
  assert.equal(h.ops.rearmIfDue(), false, 'once');
});

test('as129-t6-no-work-no-rearm: a cap-hit on a dry board stops for good — no cooldown, nothing ever re-arms', () => {
  // Stop rules run before work rules, so a dry board with a two-tick cap
  // would stop `dry` at tick 1; a one-tick cap makes the cap the reason.
  const h = capHarness({ loadBoard: () => ({ tasks: [] }), limits: { ...LOOP_DEFAULTS, maxTicks: 1, rearmMs: TEN_MIN } });
  h.ops.start({ messageId: 5 });
  h.ops.takeFire();
  h.ops.settle(okTick());
  assert.match(h.lines('LOOP-STOP')[0], /reason=cap-hit/);
  assert.match(h.lines('LOOP-STOP')[0], /"rearm":false/);
  assert.equal(h.lines('LOOP-COOLDOWN').length, 0);
  assert.equal(h.saved.at(-1).rearmAt, null);
  assert.equal(h.saved.at(-1).armedBy, null);
  assert.equal(h.ops.snapshot().rearmAt, null);
  h.advance(TEN_MIN);
  assert.equal(h.ops.rearmIfDue(), false);
  h.advance(8 * 60 * 60 * 1000);
  assert.equal(h.ops.rearmIfDue(), false);
  assert.equal(h.ops.active(), false);
  assert.equal(h.lines('LOOP-REARM').length, 0);
});

test('as129-t7-message-during-cooldown-wins: a board message arms a loop and cancels the pending re-arm', () => {
  const h = capHarness();
  driveToCap(h, 5);
  h.advance(60_000);
  h.ops.start({ messageId: 9 }); // fire() got the lock for message 9
  assert.equal(h.ops.active(), true);
  assert.equal(h.ops.snapshot().rearmAt, null);
  const mirror = h.saved.at(-1);
  assert.equal(mirror.active, true);
  assert.equal(mirror.armedBy, 9);
  assert.equal(mirror.rearmAt, null);
  h.advance(TEN_MIN);
  assert.equal(h.ops.rearmIfDue(), false, 'the cooldown is gone, not merely masked by the live loop');
  assert.equal(h.lines('LOOP-REARM').length, 0);
  // ... and it stays gone after that loop ends.
  h.ops.takeFire();
  h.ops.settle(okTick());
  h.ops.takeFire();
  h.ops.settle(okTick());
  assert.equal(h.ops.active(), false, 'message 9\'s loop hit the cap too');
  assert.equal(h.saved.at(-1).armedBy, 9, 'and ITS cooldown belongs to message 9');
});

test('as129-t8-cooldown-survives-a-restart: an inactive mirror with rearmAt resumes into the cooldown', () => {
  const mirror = {
    active: false, startedAt: null, ticks: 0, armedBy: 3, rearmAt: iso(T0 + 5 * 60 * 1000),
    lastTick: null, lastLoop: { stoppedAt: iso(T0), reason: 'cap-hit', ticks: 24, detail: { rearm: true } },
  };
  const h = capHarness({ loadState: () => mirror });
  h.ops.resume();
  assert.equal(h.ops.active(), false);
  assert.equal(h.ops.pending(), false, 'a cooldown owes nothing yet');
  assert.deepEqual(h.lines('LOOP-RESUME'), [`LOOP-RESUME reason=cooldown until ${iso(T0 + 5 * 60 * 1000)} armedBy 3`]);
  assert.equal(h.ops.snapshot().rearmAt, iso(T0 + 5 * 60 * 1000));
  assert.equal(h.ops.snapshot().lastLoop.reason, 'cap-hit');
  assert.equal(h.ops.rearmIfDue(), false, 'T0: not due');
  h.advance(5 * 60 * 1000);
  assert.equal(h.ops.rearmIfDue(), true, 'T0+5 min: the file\'s deadline, not a fresh ten minutes');
  assert.equal(h.ops.pending(), true);
  assert.equal(h.saved.at(-1).armedBy, 3, 'the re-armed loop carries the file\'s message');
});

// AS-104, subsumed: resume() used to re-enter an active mirror past the cap
// and owe a tick, so settle() stopped cap-hit one tick LATE.
const cappedMirror = { active: true, ticks: 24, startedAt: iso(T0 - 60 * 60 * 1000), armedBy: 3 };

test('as129-t9a-resume-past-the-cap-with-work: no tick is owed; the cap is logged and the cooldown starts now', () => {
  const h = capHarness({ loadState: () => cappedMirror });
  h.ops.resume();
  assert.equal(h.ops.pending(), false, 'AS-104: not one extra tick');
  assert.equal(h.ops.active(), false);
  assert.equal(h.ops.snapshot().resumeHold, false);
  const stops = h.lines('LOOP-STOP');
  assert.equal(stops.length, 1);
  assert.match(stops[0], /reason=cap-hit after 24 ticks/);
  assert.equal(h.lines('LOOP-RESUME').length, 0, 'nothing was resumed');
  assert.equal(h.ops.snapshot().rearmAt, iso(T0 + TEN_MIN));
  assert.equal(h.lines('LOOP-COOLDOWN').length, 1);
  const mirror = h.saved.at(-1);
  assert.equal(mirror.active, false, 'the file stops claiming the dead loop');
  assert.equal(mirror.rearmAt, iso(T0 + TEN_MIN));
  assert.equal(mirror.armedBy, 3);
  assert.equal(mirror.lastLoop.reason, 'cap-hit');
});

test('as129-t9b-resume-past-the-cap-dry: no tick is owed and nothing re-arms', () => {
  const h = capHarness({ loadState: () => cappedMirror, loadBoard: () => ({ tasks: [] }) });
  h.ops.resume();
  assert.equal(h.ops.pending(), false);
  assert.equal(h.ops.active(), false);
  assert.match(h.lines('LOOP-STOP')[0], /reason=cap-hit/);
  assert.equal(h.ops.snapshot().rearmAt, null);
  assert.equal(h.lines('LOOP-COOLDOWN').length, 0);
  assert.equal(h.saved.at(-1).active, false);
  assert.equal(h.saved.at(-1).rearmAt, null);
  h.advance(TEN_MIN);
  assert.equal(h.ops.rearmIfDue(), false);
});

// --- AS-132: the re-armed loop's first tick goes through the F2 lock gate ----
//
// Ruben's AS-129 probe P5: the watcher dies mid-tick with the loop past the
// cap; on relaunch resume() goes straight into the cooldown (t9a) and never
// raises resumeHold, so ten minutes later the re-armed loop's first fire skips
// blockedByLock() and acquireLock's dead-pid steal takes the orphan's lock —
// a second tick beside a child that may run to the tick timeout. The lock
// below is that lock exactly: written by the dead watcher (pid dead), 2 min
// old at T0, 12 min old at the re-arm, well under the 30-min grace.

const orphanLock = () => lockBody(2 * 60 * 1000, { pid: 999_999 });

test('as132-t1-rearm-after-resume-holds-the-lock-gate: a cooldown entered from resume() re-arms behind the orphan\'s lock, not over it', () => {
  const h = capHarness({ loadState: () => cappedMirror, loadLock: orphanLock });
  h.ops.resume();
  assert.equal(h.ops.pending(), false, 'past the cap: cooling, nothing owed yet (t9a)');
  h.advance(TEN_MIN);
  assert.equal(h.ops.rearmIfDue(), true);
  assert.equal(h.ops.pending(), true);
  assert.equal(h.ops.blockedByLock(), true, 'a 12-min-old lock under a dead pid may still have a tick behind it');
  assert.equal(
    nextPollAction({ decideAction: 'idle', loopPending: h.ops.pending(), deployPending: false, lockHeld: h.ops.blockedByLock() }),
    'wait-lock'
  );
  assert.equal(h.lines('LOOP-WAIT lock held by pid 999999').length, 1, 'one line per episode');
  assert.equal(h.ops.pending(), true, 'the owed tick survives the wait');
  h.advance(18 * 60 * 1000); // the lock is now 30 min old: the whole grace, aged out
  assert.equal(h.ops.blockedByLock(), false);
  assert.equal(h.ops.pending(), true);
  assert.equal(h.ops.snapshot().resumeHold, false);
  assert.equal(h.lines('LOOP-WAIT lock').length, 1);
  h.ops.takeFire();
  assert.deepEqual(h.lines('LOOP-FIRE'), ['LOOP-FIRE tick 1']);
});

test('as132-t2-ordinary-rearm-is-not-held-with-no-lock: an in-process cooldown re-arms and fires on the same poll', () => {
  const h = capHarness();
  driveToCap(h, 5);
  h.advance(TEN_MIN);
  assert.equal(h.ops.rearmIfDue(), true);
  assert.equal(h.ops.blockedByLock(), false, 'our last tick released the lock; nothing to wait for');
  assert.equal(h.lines('LOOP-WAIT').length, 0);
  assert.equal(h.ops.snapshot().resumeHold, false, 'the hold cleared itself on the first look');
  assert.equal(h.ops.pending(), true);
});

test('as132-t3-contrast-ordinary-resume-holds: the same lock under a not-past-cap resume is held as before', () => {
  const h = capHarness({ loadState: () => resumeState, loadLock: orphanLock });
  h.ops.resume();
  assert.equal(h.ops.pending(), true);
  assert.equal(h.ops.blockedByLock(), true);
  assert.equal(h.lines('LOOP-WAIT lock held by pid 999999').length, 1);
});
