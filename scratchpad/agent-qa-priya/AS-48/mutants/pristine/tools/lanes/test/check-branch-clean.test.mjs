// Falsification suite for check-branch-clean.sh — criterion (a), plan §7/§8.
//
// Contract per test (§8): build the fixture, ASSERT the planted violation is
// actually present (an unapplied mutation looks exactly like a passing
// checker), predict the exact failing set BEFORE running, then match
// prediction to observation — a wider or narrower failing set than predicted
// fails the test and is itself a finding. Clean twin must PASS with the
// expected cardinality line. The whole suite must leave the real tree
// byte-identical (§8.4).

import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeFixtureRepo,
  destroy,
  commitOn,
  git,
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

test('(a) planted .lattice/ commit on a task branch FAILS with exactly that path', () => {
  const root = makeFixtureRepo();
  try {
    commitOn(root, 'feat/AS-901-x', {
      'apps/invoicing/routes.js': 'r\n',
      '.lattice/events/task_FXSTRAY.jsonl': '{"stray":true}\n',
    });

    // §8.1 — the planted violation is present (proven with raw git, not the checker):
    const diff = git(root, 'diff', '--name-only', 'master...feat/AS-901-x').trim().split('\n');
    assert.ok(diff.includes('.lattice/events/task_FXSTRAY.jsonl'), 'mutation applied: .lattice/ path is on the branch');

    // §8.2 — prediction BEFORE the run:
    const predicted = {
      code: 1,
      first: 'examined 2 changed file(s) on feat/AS-901-x (master...feat/AS-901-x)',
      verdict: 'FAIL: 1 violation(s)',
      items: ['.lattice/events/task_FXSTRAY.jsonl: .lattice/ path committed on task branch'],
    };
    const r = runChecker('check-branch-clean.sh', ['--repo', root, 'feat/AS-901-x']);
    assert.equal(r.code, predicted.code, r.stderr);
    const rep = parseReport(r.stdout);
    assert.equal(rep.first, predicted.first);
    assert.equal(rep.verdict, predicted.verdict);
    assert.deepEqual(rep.items, predicted.items, 'failing set exactly as predicted');
  } finally {
    destroy(root);
  }
});

test('(a) clean twin: branch touching only app files PASSES with exact cardinality', () => {
  const root = makeFixtureRepo();
  try {
    commitOn(root, 'feat/AS-902-y', {
      'apps/invoicing/routes.js': 'r\n',
      'apps/invoicing/lib/util.js': 'u\n',
    });
    const r = runChecker('check-branch-clean.sh', ['--repo', root, 'feat/AS-902-y']);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const rep = parseReport(r.stdout);
    assert.equal(rep.first, 'examined 2 changed file(s) on feat/AS-902-y (master...feat/AS-902-y)');
    assert.equal(rep.verdict, 'PASS: no .lattice/ paths in branch diff');
    assert.deepEqual(rep.items, []);
  } finally {
    destroy(root);
  }
});
