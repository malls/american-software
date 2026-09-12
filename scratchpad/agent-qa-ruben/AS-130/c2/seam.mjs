#!/usr/bin/env node
// AS-130 c2: merge seam — what master changed since the branch base vs what the branch touches.
import { execFileSync } from 'node:child_process';
const ROOT = '/Users/forrest/Code/american-software-company';
const WT = `${ROOT}/.worktrees/AS-130`;
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' });
const base = git(WT, 'merge-base', 'master', 'feat/AS-130-demo-recapture').trim();
const masterFiles = git(ROOT, 'diff', '--name-only', base, 'master', '--', '.', ':!.lattice').trim().split('\n').filter(Boolean);
const branchFiles = git(WT, 'diff', '--name-only', 'master...feat/AS-130-demo-recapture').trim().split('\n').filter(Boolean);
console.log(`base ${base.slice(0, 7)}; master since base: ${masterFiles.length} non-.lattice files; branch: ${branchFiles.length} files`);
console.log('master-since-base under apps/invoicing|docs/demo|d1-demo-artifact|tokens:');
for (const f of masterFiles.filter((f) => /apps\/invoicing|docs\/demo|d1-demo-artifact|tokens/.test(f))) console.log('  ' + f);
const overlap = masterFiles.filter((f) => branchFiles.includes(f));
console.log(`overlap (both sides touched): ${overlap.length}`);
for (const f of overlap) console.log('  ' + f);
try {
  git(WT, 'merge-tree', '--write-tree', 'master', 'feat/AS-130-demo-recapture');
  console.log('merge-tree: clean, no conflicts');
} catch (e) {
  console.log('merge-tree: CONFLICTS\n' + e.stdout);
}
