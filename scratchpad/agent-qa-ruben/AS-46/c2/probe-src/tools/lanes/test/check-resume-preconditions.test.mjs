// Falsification suite for check-resume-preconditions.sh — criterion (d),
// plan §7/§8. The plan's plant is the branch-link event removed; note the
// predicted failing set is TWO preconditions, deliberately: without a
// branch-link the worktree precondition is also unverifiable (there is no
// linked branch to match a worktree against), and the checker reports both
// missing facts rather than hiding one behind the other.
//
// A second plant falsifies the scaffold detector (plan file = heading +
// verbatim description, the exact shape lattice's is_scaffold_plan treats as
// unplanned) — that mirror is what a cold resume in T2 depends on.

import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import {
  makeFixtureRepo,
  destroy,
  commitOn,
  addWorktree,
  git,
  ev,
  writeEventsFile,
  write,
  runChecker,
  parseReport,
  realTreeSnapshot,
} from './fixture.mjs';

let realSnap;
before(() => {
  realSnap = realTreeSnapshot();
});
after(() => {
  assert.equal(realTreeSnapshot(), realSnap, '§8.4: real tree must be byte-identical before and after this suite');
});

const OWEN = 'agent:cto-owen';
const DESC = 'Do the thing.';

/** The durable set of a resumable in-progress task, minus whatever the test removes. */
function seedTask(root, { taskId, code, branch, withBranchLink = true, plan = 'real' }) {
  const events = [
    ev('ev_D_1', 'task_created', taskId, '2026-09-02T09:00:00Z', OWEN, {
      short_id: code, status: 'backlog', title: 'fx', description: DESC,
    }),
    ev('ev_D_2', 'status_changed', taskId, '2026-09-02T09:05:00Z', OWEN, { from: 'backlog', to: 'in_planning' }),
    ev('ev_D_3', 'status_changed', taskId, '2026-09-02T09:10:00Z', OWEN, { from: 'in_planning', to: 'planned' }),
    ev('ev_D_4', 'assignment_changed', taskId, '2026-09-02T09:11:00Z', OWEN, { from: null, to: 'agent:developer-lena' }),
    ev('ev_D_5', 'status_changed', taskId, '2026-09-02T09:15:00Z', 'agent:developer-lena', {
      from: 'planned', to: 'in_progress',
    }),
  ];
  if (withBranchLink) {
    events.push(ev('ev_D_6', 'branch_linked', taskId, '2026-09-02T09:16:00Z', OWEN, { branch }));
  }
  writeEventsFile(root, taskId, events);
  if (plan === 'real') {
    write(root, `.lattice/plans/${taskId}.md`, `# ${code}: fx\n\n## Approach\n\n- do it\n`);
  } else if (plan === 'scaffold') {
    // Exactly what lattice scaffold_plan writes: heading + description, verbatim.
    write(root, `.lattice/plans/${taskId}.md`, `# ${code}: fx\n\n${DESC}\n`);
  }
  commitOn(root, branch, { 'apps/chat/x.js': 'x\n' });
  addWorktree(root, branch, `.worktrees/${code}`);
}

test('(d) clean twin: full durable resume set PASSES with exact cardinality', () => {
  const root = makeFixtureRepo();
  try {
    seedTask(root, { taskId: 'task_FXD1', code: 'AS-971', branch: 'feat/AS-971-x' });
    const r = runChecker('check-resume-preconditions.sh', ['--repo', root, 'AS-971']);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const rep = parseReport(r.stdout);
    assert.equal(rep.first, 'examined 4 precondition(s) for AS-971 (task_FXD1)');
    assert.equal(
      rep.verdict,
      'PASS: durable resume set complete (status=in_progress, branch=feat/AS-971-x, worktree present, plan real)',
    );
    assert.deepEqual(rep.items, []);
  } finally {
    destroy(root);
  }
});

test('(d) planted branch-link removal FAILS with exactly {branch-link, worktree}', () => {
  const root = makeFixtureRepo();
  try {
    seedTask(root, { taskId: 'task_FXD2', code: 'AS-972', branch: 'feat/AS-972-x', withBranchLink: false });

    // §8.1 — the planted violation is present: no branch_linked event in the
    // raw JSONL, while the worktree DOES exist on disk (the failure is missing
    // durable knowledge, not missing disk state).
    const raw = readFileSync(join(root, '.lattice/events/task_FXD2.jsonl'), 'utf8');
    assert.ok(!raw.includes('branch_linked'), 'mutation applied: branch_linked event absent');
    assert.ok(
      git(root, 'worktree', 'list', '--porcelain').includes('branch refs/heads/feat/AS-972-x'),
      'worktree itself still exists — only the durable pointer to it is gone',
    );

    // §8.2 — prediction BEFORE the run:
    const predicted = {
      code: 1,
      first: 'examined 4 precondition(s) for AS-972 (task_FXD2)',
      verdict: 'FAIL: 2 violation(s)',
      items: ['branch-link: no branch_linked event', 'worktree: no branch-link to match'],
    };
    const r = runChecker('check-resume-preconditions.sh', ['--repo', root, 'AS-972']);
    assert.equal(r.code, predicted.code, r.stderr);
    const rep = parseReport(r.stdout);
    assert.equal(rep.first, predicted.first);
    assert.equal(rep.verdict, predicted.verdict);
    assert.deepEqual(rep.items, predicted.items, 'failing set exactly as predicted');
  } finally {
    destroy(root);
  }
});

test('(d) planted scaffold plan (heading + verbatim description) FAILS with exactly {plan}', () => {
  const root = makeFixtureRepo();
  try {
    seedTask(root, { taskId: 'task_FXD3', code: 'AS-973', branch: 'feat/AS-973-x', plan: 'scaffold' });

    // §8.1 — the planted violation is present: the plan file is byte-for-byte
    // the lattice scaffold shape (heading + the created event's description).
    const plan = readFileSync(join(root, '.lattice/plans/task_FXD3.md'), 'utf8');
    assert.equal(plan, `# AS-973: fx\n\n${DESC}\n`, 'mutation applied: plan is scaffold-shaped');
    const created = readFileSync(join(root, '.lattice/events/task_FXD3.jsonl'), 'utf8').split('\n')[0];
    assert.ok(created.includes(`"description":"${DESC}"`), 'the description the scaffold echoes');

    // §8.2 — prediction BEFORE the run:
    const predicted = {
      code: 1,
      first: 'examined 4 precondition(s) for AS-973 (task_FXD3)',
      verdict: 'FAIL: 1 violation(s)',
      items: ['plan: still scaffold'],
    };
    const r = runChecker('check-resume-preconditions.sh', ['--repo', root, 'AS-973']);
    assert.equal(r.code, predicted.code, r.stderr);
    const rep = parseReport(r.stdout);
    assert.equal(rep.first, predicted.first);
    assert.equal(rep.verdict, predicted.verdict);
    assert.deepEqual(rep.items, predicted.items, 'failing set exactly as predicted');
  } finally {
    destroy(root);
  }
});
