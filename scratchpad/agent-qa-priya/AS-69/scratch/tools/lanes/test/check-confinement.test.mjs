// Falsification suite for check-confinement.sh — criterion (b), plan §7/§8.
//
// Three plants (the two the plan names, plus the main-checkout half of the
// clean-trees rule, which would otherwise never have been seen failing):
//   1. a branch commit outside the task's allowed prefixes;
//   2. a dirty task worktree;
//   3. a dirty main checkout.

import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import {
  makeFixtureRepo,
  destroy,
  commitOn,
  addWorktree,
  git,
  writeConfig,
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

const BRANCH = 'feat/AS-941-onboard';
const WT = '.worktrees/AS-941';

function configFor(root) {
  const p = join(root, 'fx-config.json');
  writeConfig(p, {
    tasks: {
      'AS-941': {
        task_id: 'task_FXLA',
        branch: BRANCH,
        worktree: WT,
        allowed_prefixes: ['apps/invoicing/'],
        expected_authors: ['developer-marcus'],
        expected_actors: ['agent:developer-marcus', 'agent:cto-owen'],
      },
    },
  });
  return p;
}

// The config file lives in the fixture root untracked, so every confinement
// fixture would report main-checkout dirt from the config itself. Keep the
// config out of the porcelain by ignoring it in the fixture repo.
function makeRepoWithIgnoredConfig() {
  const root = makeFixtureRepo();
  commitOn(root, 'master', { '.gitignore': '.worktrees/\nfx-config.json\n' }, { msg: 'ignore fixture config' });
  return root;
}

test('(b) planted out-of-prefix commit FAILS with exactly that path', () => {
  const root = makeRepoWithIgnoredConfig();
  try {
    const cfg = configFor(root);
    commitOn(root, BRANCH, { 'apps/invoicing/a.js': 'a\n', 'apps/chat/oops.js': 'o\n' });
    addWorktree(root, BRANCH, WT);

    // §8.1 — the planted violation is present:
    const diff = git(root, 'diff', '--name-only', `master...${BRANCH}`).trim().split('\n');
    assert.ok(diff.includes('apps/chat/oops.js'), 'mutation applied: out-of-prefix path on the branch');

    // §8.2 — prediction BEFORE the run:
    const predicted = {
      code: 1,
      first: `examined 2 changed file(s) on ${BRANCH} / 2 working tree(s)`,
      verdict: 'FAIL: 1 violation(s)',
      items: ['apps/chat/oops.js: outside allowed prefixes (apps/invoicing/)'],
    };
    const r = runChecker('check-confinement.sh', ['--repo', root, BRANCH, cfg]);
    assert.equal(r.code, predicted.code, r.stderr);
    const rep = parseReport(r.stdout);
    assert.equal(rep.first, predicted.first);
    assert.equal(rep.verdict, predicted.verdict);
    assert.deepEqual(rep.items, predicted.items, 'failing set exactly as predicted');
  } finally {
    destroy(root);
  }
});

test('(b) planted dirty worktree FAILS with exactly that porcelain entry', () => {
  const root = makeRepoWithIgnoredConfig();
  try {
    const cfg = configFor(root);
    commitOn(root, BRANCH, { 'apps/invoicing/a.js': 'a\n' });
    const wt = addWorktree(root, BRANCH, WT);
    writeFileSync(join(wt, 'apps/invoicing/scratch.txt'), 'uncommitted\n');

    // §8.1 — the planted violation is present:
    assert.equal(git(wt, 'status', '--porcelain'), '?? apps/invoicing/scratch.txt\n', 'mutation applied: worktree dirty');

    // §8.2 — prediction BEFORE the run:
    const predicted = {
      code: 1,
      first: `examined 1 changed file(s) on ${BRANCH} / 2 working tree(s)`,
      verdict: 'FAIL: 1 violation(s)',
      items: [`worktree ${WT}: dirty: "?? apps/invoicing/scratch.txt"`],
    };
    const r = runChecker('check-confinement.sh', ['--repo', root, BRANCH, cfg]);
    assert.equal(r.code, predicted.code, r.stderr);
    const rep = parseReport(r.stdout);
    assert.equal(rep.first, predicted.first);
    assert.equal(rep.verdict, predicted.verdict);
    assert.deepEqual(rep.items, predicted.items, 'failing set exactly as predicted');
  } finally {
    destroy(root);
  }
});

test('(b) planted dirty main checkout FAILS with exactly that porcelain entry', () => {
  const root = makeRepoWithIgnoredConfig();
  try {
    const cfg = configFor(root);
    commitOn(root, BRANCH, { 'apps/invoicing/a.js': 'a\n' });
    addWorktree(root, BRANCH, WT);
    writeFileSync(join(root, 'scratch.txt'), 'uncommitted\n');

    // §8.1 — the planted violation is present:
    assert.equal(git(root, 'status', '--porcelain'), '?? scratch.txt\n', 'mutation applied: main checkout dirty');

    // §8.2 — prediction BEFORE the run:
    const predicted = {
      code: 1,
      first: `examined 1 changed file(s) on ${BRANCH} / 2 working tree(s)`,
      verdict: 'FAIL: 1 violation(s)',
      items: ['main checkout: dirty: "?? scratch.txt"'],
    };
    const r = runChecker('check-confinement.sh', ['--repo', root, BRANCH, cfg]);
    assert.equal(r.code, predicted.code, r.stderr);
    const rep = parseReport(r.stdout);
    assert.equal(rep.first, predicted.first);
    assert.equal(rep.verdict, predicted.verdict);
    assert.deepEqual(rep.items, predicted.items, 'failing set exactly as predicted');
  } finally {
    destroy(root);
  }
});

test('(b) clean twin: confined diff, clean worktree, clean main PASSES with exact cardinality', () => {
  const root = makeRepoWithIgnoredConfig();
  try {
    const cfg = configFor(root);
    commitOn(root, BRANCH, { 'apps/invoicing/a.js': 'a\n' });
    addWorktree(root, BRANCH, WT);
    const r = runChecker('check-confinement.sh', ['--repo', root, BRANCH, cfg]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const rep = parseReport(r.stdout);
    assert.equal(rep.first, `examined 1 changed file(s) on ${BRANCH} / 2 working tree(s)`);
    assert.equal(rep.verdict, 'PASS: diff confined to allowed prefixes; worktree and main checkout clean');
    assert.deepEqual(rep.items, []);
  } finally {
    destroy(root);
  }
});
