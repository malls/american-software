// Falsification suite for check-disjoint.sh — criterion (b'), plan §7/§8.
//
// Two plants, per the plan's table: a config whose prefix sets overlap, and
// a pair of branches that both touch one shared file. Disjointness is the
// standing gate before any fan (§6.0.5), so both halves must be seen red.

import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
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

const BR_A = 'feat/AS-941-onboard';
const BR_B = 'feat/AS-934-symlink';

function configFor(root, prefixesA, prefixesB) {
  const p = join(root, 'fx-config.json');
  writeConfig(p, {
    tasks: {
      'AS-941': { task_id: 'task_FXLA', branch: BR_A, worktree: '.worktrees/AS-941', allowed_prefixes: prefixesA },
      'AS-934': { task_id: 'task_FXLB', branch: BR_B, worktree: '.worktrees/AS-934', allowed_prefixes: prefixesB },
    },
  });
  return p;
}

test("(b') planted overlapping prefix sets FAIL with exactly that pair", () => {
  const root = makeFixtureRepo();
  try {
    const cfg = configFor(root, ['apps/invoicing/', 'apps/shared/'], ['apps/chat/', 'apps/shared/']);
    commitOn(root, BR_A, { 'apps/invoicing/a.js': 'a\n' });
    commitOn(root, BR_B, { 'apps/chat/b.js': 'b\n' });

    // §8.1 — the planted violation is present (read the config back, raw):
    const written = JSON.parse(readFileSync(cfg, 'utf8'));
    assert.ok(
      written.tasks['AS-941'].allowed_prefixes.includes('apps/shared/') &&
        written.tasks['AS-934'].allowed_prefixes.includes('apps/shared/'),
      'mutation applied: both tasks claim apps/shared/',
    );

    // §8.2 — prediction BEFORE the run:
    const predicted = {
      code: 1,
      first: 'examined 2 task(s) / 1 pair(s) / 2 diff path(s)',
      verdict: 'FAIL: 1 violation(s)',
      items: ["prefix overlap AS-941/AS-934: 'apps/shared/' vs 'apps/shared/'"],
    };
    const r = runChecker('check-disjoint.sh', ['--repo', root, cfg]);
    assert.equal(r.code, predicted.code, r.stderr);
    const rep = parseReport(r.stdout);
    assert.equal(rep.first, predicted.first);
    assert.equal(rep.verdict, predicted.verdict);
    assert.deepEqual(rep.items, predicted.items, 'failing set exactly as predicted');
  } finally {
    destroy(root);
  }
});

test("(b') planted shared diff path FAILS with exactly that path", () => {
  const root = makeFixtureRepo();
  try {
    const cfg = configFor(root, ['apps/invoicing/'], ['apps/chat/']);
    commitOn(root, BR_A, { 'apps/invoicing/a.js': 'a\n', 'apps/common.txt': 'A\n' });
    commitOn(root, BR_B, { 'apps/chat/b.js': 'b\n', 'apps/common.txt': 'B\n' });

    // §8.1 — the planted violation is present (raw git on both branches):
    const diffA = git(root, 'diff', '--name-only', `master...${BR_A}`).trim().split('\n');
    const diffB = git(root, 'diff', '--name-only', `master...${BR_B}`).trim().split('\n');
    assert.ok(diffA.includes('apps/common.txt') && diffB.includes('apps/common.txt'), 'mutation applied: shared path');

    // §8.2 — prediction BEFORE the run:
    const predicted = {
      code: 1,
      first: 'examined 2 task(s) / 1 pair(s) / 4 diff path(s)',
      verdict: 'FAIL: 1 violation(s)',
      items: ['shared path AS-941/AS-934: apps/common.txt'],
    };
    const r = runChecker('check-disjoint.sh', ['--repo', root, cfg]);
    assert.equal(r.code, predicted.code, r.stderr);
    const rep = parseReport(r.stdout);
    assert.equal(rep.first, predicted.first);
    assert.equal(rep.verdict, predicted.verdict);
    assert.deepEqual(rep.items, predicted.items, 'failing set exactly as predicted');
  } finally {
    destroy(root);
  }
});

test("(b') clean twin: disjoint prefixes and disjoint diffs PASS with exact cardinality", () => {
  const root = makeFixtureRepo();
  try {
    const cfg = configFor(root, ['apps/invoicing/'], ['apps/chat/']);
    commitOn(root, BR_A, { 'apps/invoicing/a.js': 'a\n' });
    commitOn(root, BR_B, { 'apps/chat/b.js': 'b\n' });
    const r = runChecker('check-disjoint.sh', ['--repo', root, cfg]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const rep = parseReport(r.stdout);
    assert.equal(rep.first, 'examined 2 task(s) / 1 pair(s) / 2 diff path(s)');
    assert.equal(rep.verdict, 'PASS: allowed-prefix sets and branch diff sets pairwise disjoint');
    assert.deepEqual(rep.items, []);
  } finally {
    destroy(root);
  }
});
