// Falsification suite for check-git-identity.sh — criterion (f), plan §7/§8.
//
// The planted violation is the exact drift AS-53 settled: a commit authored
// as developer-marcus-webb instead of the actor-id form developer-marcus.
// A second plant falsifies the email half of the rule (a correct name with a
// non-canonical email), because a rule that has never been seen failing is
// decoration.

import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  makeFixtureRepo,
  destroy,
  commitOn,
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

function configFor(root) {
  const p = join(root, 'trial-config.json');
  writeConfig(p, {
    tasks: {
      'AS-941': {
        task_id: 'task_FXLA',
        branch: BRANCH,
        worktree: '.worktrees/AS-941',
        allowed_prefixes: ['apps/invoicing/'],
        expected_authors: ['developer-marcus'],
        expected_actors: ['agent:developer-marcus', 'agent:cto-owen'],
      },
    },
  });
  return p;
}

test('(f) planted AS-53 drift (developer-marcus-webb) FAILS with exactly that commit', () => {
  const root = makeFixtureRepo();
  try {
    const cfg = configFor(root);
    const sha = commitOn(root, BRANCH, { 'apps/invoicing/a.js': 'a\n' }, { author: 'developer-marcus-webb' });

    // §8.1 — the planted violation is present (raw git, not the checker):
    assert.equal(git(root, 'log', '-1', '--format=%an', BRANCH).trim(), 'developer-marcus-webb', 'mutation applied');

    // §8.2 — prediction BEFORE the run:
    const predicted = {
      code: 1,
      first: `examined 1 commit(s) on ${BRANCH} (master..${BRANCH})`,
      verdict: 'FAIL: 1 violation(s)',
      items: [`${sha.slice(0, 7)}: author.name 'developer-marcus-webb' not in expected set (developer-marcus)`],
    };
    const r = runChecker('check-git-identity.sh', ['--repo', root, BRANCH, cfg]);
    assert.equal(r.code, predicted.code, r.stderr);
    const rep = parseReport(r.stdout);
    assert.equal(rep.first, predicted.first);
    assert.equal(rep.verdict, predicted.verdict);
    assert.deepEqual(rep.items, predicted.items, 'failing set exactly as predicted');
  } finally {
    destroy(root);
  }
});

test('(f) planted non-canonical email FAILS with exactly that commit', () => {
  const root = makeFixtureRepo();
  try {
    const cfg = configFor(root);
    const sha = commitOn(
      root,
      BRANCH,
      { 'apps/invoicing/a.js': 'a\n' },
      { author: 'developer-marcus', email: 'marcus@wrong.host' },
    );

    // §8.1 — the planted violation is present:
    assert.equal(git(root, 'log', '-1', '--format=%ae', BRANCH).trim(), 'marcus@wrong.host', 'mutation applied');

    // §8.2 — prediction BEFORE the run:
    const predicted = {
      code: 1,
      first: `examined 1 commit(s) on ${BRANCH} (master..${BRANCH})`,
      verdict: 'FAIL: 1 violation(s)',
      items: [`${sha.slice(0, 7)}: author.email 'marcus@wrong.host' != 'developer-marcus@agents.american-software.local'`],
    };
    const r = runChecker('check-git-identity.sh', ['--repo', root, BRANCH, cfg]);
    assert.equal(r.code, predicted.code, r.stderr);
    const rep = parseReport(r.stdout);
    assert.equal(rep.first, predicted.first);
    assert.equal(rep.verdict, predicted.verdict);
    assert.deepEqual(rep.items, predicted.items, 'failing set exactly as predicted');
  } finally {
    destroy(root);
  }
});

test('(f) clean twin: canonical identities on every commit PASS with exact cardinality', () => {
  const root = makeFixtureRepo();
  try {
    const cfg = configFor(root);
    commitOn(root, BRANCH, { 'apps/invoicing/a.js': 'a\n' }, { author: 'developer-marcus' });
    commitOn(root, BRANCH, { 'apps/invoicing/b.js': 'b\n' }, { author: 'developer-marcus' });
    const r = runChecker('check-git-identity.sh', ['--repo', root, BRANCH, cfg]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const rep = parseReport(r.stdout);
    assert.equal(rep.first, `examined 2 commit(s) on ${BRANCH} (master..${BRANCH})`);
    assert.equal(rep.verdict, 'PASS: all commit identities in expected set with canonical emails');
    assert.deepEqual(rep.items, []);
  } finally {
    destroy(root);
  }
});
