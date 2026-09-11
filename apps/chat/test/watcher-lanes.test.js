// test/watcher-lanes.test.js — AS-99: makeLanesOps, the watcher's snapshot writer.
//
// Every collaborator is injected (git runner, clock, writer, log), so each
// branch below is a unit test with no git, no filesystem and no worktrees.
// main() is never executed — AS-82's rule: anything left inside it is unguarded,
// which is why this factory exists at all.

import test from 'node:test';
import assert from 'node:assert/strict';

import { makeLanesOps } from '../watch/advance-watcher.mjs';

const NOW = Date.parse('2026-09-11T04:00:00.000Z');
const REPO = '/repo';

const PORCELAIN = [
  'worktree /repo',
  'HEAD f6717b8',
  'branch refs/heads/master',
  '',
  'worktree /repo/.worktrees/AS-99',
  'HEAD 3c1a000',
  'branch refs/heads/feat/AS-99-lane-view',
  '',
].join('\n');

const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
const fail = (code, stderr = 'boom') => ({ code, stdout: '', stderr });

/** A fake git. `overrides` is keyed by the first distinguishing argument, and
 *  every call is recorded so the argv pin (AC-5) can assert on it. */
function fakeGit(overrides = {}) {
  const calls = [];
  const run = (bin, args, opts) => {
    calls.push({ bin, args, cwd: opts?.cwd });
    const key = args.includes('worktree')
      ? 'worktree-list'
      : args[0] === 'rev-parse'
        ? 'rev-parse'
        : args.includes('--first-parent')
          ? 'first-parent'
          : args.includes('--left-right')
            ? 'rev-list'
            : args.includes('status')
              ? 'status'
              : args[0] === 'log'
                ? 'log'
                : args[0] === 'merge-base'
                  ? 'merge-base'
                  : 'other';
    const over = overrides[key];
    const result = typeof over === 'function' ? over(args, opts) : over;
    if (result) return result;
    return {
      'worktree-list': ok(PORCELAIN),
      'rev-parse': ok('f6717b8\n'),
      'first-parent': ok('f6717b8\nolder1\nolder2\n'),
      'rev-list': ok('2\t4\n'),
      status: ok(' M apps/chat/server.js\n?? scratch.txt\n'),
      log: ok(['3c1a000', 'developer-marcus', 'developer-marcus@agents.american-software.local', '2026-09-11T03:41:07-04:00', 'AS-99: lanes composer'].join('\0')),
      'merge-base': fail(1), // not an ancestor: the branch has its own commits
      other: ok(''),
    }[key];
  };
  return { run, calls };
}

function harness({ overrides, clock } = {}) {
  const writes = [];
  const logs = [];
  const git = fakeGit(overrides);
  let t = NOW;
  const ops = makeLanesOps({
    repoRoot: REPO,
    statePath: '/repo/apps/chat/data/worktrees.json',
    gitBin: '/usr/bin/git',
    run: git.run,
    now: clock ?? (() => t),
    writeState: (path, body) => writes.push({ path, body }),
    log: (line) => logs.push(line),
  });
  return { ops, writes, logs, calls: git.calls, advance: (ms) => (t += ms) };
}

test('watcher-lanes-happy-path: one snapshot row per linked worktree, main flagged and kept', async () => {
  const h = harness();
  await h.ops.evaluate();

  assert.equal(h.writes.length, 1, 'exactly one write per evaluate()');
  const body = h.writes[0].body;
  assert.equal(h.writes[0].path, '/repo/apps/chat/data/worktrees.json');
  assert.equal(body.schema, 1);
  assert.equal(body.source, 'watcher:git');
  assert.equal(body.generatedAt, new Date(NOW).toISOString());
  assert.equal(body.error, null);
  assert.deepEqual(body.master, { head: 'f6717b8' });
  assert.equal(body.worktrees.length, 2, 'cardinality: two records in the porcelain, two rows out');

  const [main, lane] = body.worktrees;
  assert.equal(main.relPath, '.');
  assert.equal(main.main, true);
  assert.equal(main.ahead, null, 'the main checkout is master; counting it against itself is noise');
  assert.equal(main.dirtyCount, null);

  assert.equal(lane.relPath, '.worktrees/AS-99', 'the absolute host path never reaches the snapshot');
  assert.ok(!JSON.stringify(body).includes('/repo/.worktrees'), 'no absolute path anywhere in the payload');
  assert.equal(lane.branch, 'feat/AS-99-lane-view');
  assert.equal(lane.detached, false);
  assert.equal(lane.behind, 2);
  assert.equal(lane.ahead, 4, 'rev-list --left-right --count prints behind\\tahead for master...HEAD');
  assert.equal(lane.dirtyCount, 2);
  assert.equal(lane.dirtyLattice, false);
  assert.equal(lane.merged, false);
  assert.deepEqual(lane.errors, []);
  assert.deepEqual(lane.lastCommit, {
    sha: '3c1a000',
    authorName: 'developer-marcus',
    authorEmail: 'developer-marcus@agents.american-software.local',
    committedAt: '2026-09-11T03:41:07-04:00',
    subject: 'AS-99: lanes composer',
  });
});

test('watcher-lanes-merged: an ancestor tip off master\'s first-parent chain is merged', async () => {
  const h = harness({
    overrides: {
      'rev-list': ok('0\t0\n'), // ahead 0
      'merge-base': ok(''), // exit 0: an ancestor of master
      'first-parent': ok('f6717b8\nolder1\n'), // 3c1a000 is NOT on the chain
    },
  });
  await h.ops.evaluate();
  assert.equal(h.writes[0].body.worktrees[1].merged, true);

  // The same branch, but its tip IS master's first-parent chain: a branch just
  // cut from master's tip, not a merged one.
  const fresh = harness({
    overrides: { 'rev-list': ok('0\t0\n'), 'merge-base': ok(''), 'first-parent': ok('3c1a000\nf6717b8\n') },
  });
  await fresh.ops.evaluate();
  assert.equal(fresh.writes[0].body.worktrees[1].merged, false);
});

test('watcher-lanes-generatedAt-advances: every poll writes, even with byte-identical git output', async () => {
  const h = harness();
  await h.ops.evaluate();
  h.advance(15_000);
  await h.ops.evaluate();

  assert.equal(h.writes.length, 2, 'the file is written on EVERY poll — a skipped write would fake freshness');
  assert.notEqual(h.writes[0].body.generatedAt, h.writes[1].body.generatedAt);
  assert.equal(h.writes[1].body.generatedAt, new Date(NOW + 15_000).toISOString());
  assert.deepEqual(h.writes[0].body.worktrees, h.writes[1].body.worktrees, 'identical content, two timestamps');
});

test('watcher-lanes-git-down: a failed worktree list is a timestamped fact, not a crash', async () => {
  const h = harness({ overrides: { 'worktree-list': fail(128, "fatal: not a git repository\n") } });
  await assert.doesNotReject(h.ops.evaluate());

  assert.equal(h.writes.length, 1, 'a failed poll still owes the reader an answer');
  const body = h.writes[0].body;
  assert.equal(body.error, 'worktree-list-failed: fatal: not a git repository');
  assert.deepEqual(body.worktrees, []);
  assert.deepEqual(body.master, { head: null });
  assert.equal(body.generatedAt, new Date(NOW).toISOString());
  // No git binary at all is a distinct, named reason.
  const noGit = harness({ overrides: { 'worktree-list': { code: -1, stdout: '', stderr: 'spawn ENOENT' } } });
  await noGit.ops.evaluate();
  assert.equal(noGit.writes[0].body.error, 'no-git');
});

// AC-3's second half, which the test above does NOT cover: the plan asks for
// "the assertion that evaluate never rejects", and a nonzero EXIT CODE is not
// the only way a git call fails. A runner that THROWS — spawn raising on EMFILE
// or a cwd that vanished when another lane's worktree was removed mid-poll —
// unwinds past every per-call handler into evaluate()'s outer catch, a path
// nothing exercised: a mutant replacing that catch body with `throw err`
// survived the entire 414-test suite. Both tests below kill that mutant.
test('watcher-lanes-never-rejects: a git runner that THROWS is still a timestamped fact', async () => {
  const h = harness({
    overrides: {
      'worktree-list': () => {
        throw new Error('spawn EMFILE');
      },
    },
  });

  await assert.doesNotReject(h.ops.evaluate(), 'a thrown git call never takes the watcher down with it');

  assert.equal(h.writes.length, 1, 'a poll that DIED still owes the reader an answer');
  const body = h.writes[0].body;
  assert.equal(body.error, 'worktree-list-failed: spawn EMFILE');
  assert.deepEqual(body.worktrees, []);
  assert.deepEqual(body.master, { head: null });
  assert.equal(body.generatedAt, new Date(NOW).toISOString(), 'a failed poll is a fact WITH a timestamp');
});

test('watcher-lanes-never-rejects-midway: a throw inside the row loop degrades to the error shape, never a partial list', async () => {
  // The main row and the first per-row call have already succeeded here, so a
  // half-built `worktrees` array exists in scope when the throw unwinds. The
  // snapshot must still come out as the error shape: a truncated lane set
  // presented as complete is the one failure the reader cannot detect.
  const h = harness({
    overrides: {
      status: () => {
        throw new Error('spawn EMFILE');
      },
    },
  });

  await assert.doesNotReject(h.ops.evaluate());

  assert.equal(h.writes.length, 1);
  const body = h.writes[0].body;
  assert.equal(body.error, 'worktree-list-failed: spawn EMFILE');
  assert.deepEqual(body.worktrees, [], 'a partial list must not masquerade as the list');
  assert.equal(body.generatedAt, new Date(NOW).toISOString());
});

test('watcher-lanes-row-isolation: one broken worktree never blanks its neighbours', async () => {
  const three = [
    'worktree /repo',
    'HEAD f6717b8',
    'branch refs/heads/master',
    '',
    'worktree /repo/.worktrees/AS-A',
    'HEAD aaa',
    'branch refs/heads/feat/AS-1-a',
    '',
    'worktree /repo/.worktrees/AS-B',
    'HEAD bbb',
    'branch refs/heads/feat/AS-2-b',
    '',
    'worktree /repo/.worktrees/AS-C',
    'HEAD ccc',
    'branch refs/heads/feat/AS-3-c',
    '',
  ].join('\n');
  const h = harness({
    overrides: {
      'worktree-list': ok(three),
      status: (args, opts) => (opts.cwd === '/repo/.worktrees/AS-B' ? fail(128, 'fatal: bad index\n') : ok(' M a.js\n')),
    },
  });
  await h.ops.evaluate();

  const rows = h.writes[0].body.worktrees;
  assert.equal(rows.length, 4);
  const [, a, b, c] = rows;
  assert.equal(b.dirtyCount, null, 'the failed call yields null');
  assert.equal(b.dirtyLattice, null);
  assert.equal(b.errors.length, 1);
  assert.match(b.errors[0], /^status: exit 128 fatal: bad index$/);
  assert.equal(b.ahead, 4, 'its other fields are still filled');
  assert.ok(b.lastCommit);
  for (const row of [a, c]) {
    assert.equal(row.dirtyCount, 1, 'neighbours are complete');
    assert.deepEqual(row.errors, []);
  }
});

test('watcher-lanes-argv-pin: the status call carries --no-optional-locks, always', async () => {
  const h = harness();
  await h.ops.evaluate();

  const statusCalls = h.calls.filter((c) => c.args.includes('status'));
  assert.equal(statusCalls.length, 1, 'one status call per linked worktree, none for the main checkout');
  assert.deepEqual(statusCalls[0].args, ['--no-optional-locks', 'status', '--porcelain']);
  assert.equal(statusCalls[0].cwd, '/repo/.worktrees/AS-99', 'run in the worktree, not the repo root');
  assert.equal(statusCalls[0].bin, '/usr/bin/git');
  // Nothing this poll runs may write: the flag above is what keeps a background
  // status out of a worktree's index while an employee is committing in it.
  for (const call of h.calls) {
    assert.ok(
      !call.args.some((a) => ['add', 'commit', 'checkout', 'fetch', 'gc', 'prune', 'reset'].includes(a)),
      `read-only only, saw: ${call.args.join(' ')}`
    );
  }
});

test('watcher-lanes-dirty-lattice: board state on a task branch is surfaced by name', async () => {
  const h = harness({ overrides: { status: ok(' M .lattice/tasks/task_x.json\n M apps/chat/server.js\n') } });
  await h.ops.evaluate();
  const lane = h.writes[0].body.worktrees[1];
  assert.equal(lane.dirtyCount, 2);
  assert.equal(lane.dirtyLattice, true);
});

test('watcher-lanes-unwritable: an unwritable snapshot warns once and never throws', async () => {
  const h = harness();
  const ops = makeLanesOps({
    repoRoot: REPO,
    statePath: '/nope/worktrees.json',
    run: fakeGit().run,
    now: () => NOW,
    writeState: () => {
      throw new Error('EACCES');
    },
    log: (line) => h.logs.push(line),
  });
  await assert.doesNotReject(ops.evaluate());
  await ops.evaluate();
  assert.equal(h.logs.filter((l) => l.startsWith('WARN')).length, 1, 'one WARN per condition, not one per poll');
});

test('watcher-lanes-detached: a worktree with no branch is still measured, off its HEAD', async () => {
  const detached = [
    'worktree /repo',
    'HEAD f6717b8',
    'branch refs/heads/master',
    '',
    'worktree /repo/.worktrees/scratch',
    'HEAD ab12',
    'detached',
    '',
  ].join('\n');
  const h = harness({ overrides: { 'worktree-list': ok(detached) } });
  await h.ops.evaluate();
  const row = h.writes[0].body.worktrees[1];
  assert.equal(row.branch, null);
  assert.equal(row.detached, true);
  assert.equal(row.ahead, 4, 'the range is computed against HEAD when there is no branch name');
  const range = h.calls.find((c) => c.args.includes('--left-right'));
  assert.deepEqual(range.args, ['rev-list', '--left-right', '--count', 'master...ab12']);
});
