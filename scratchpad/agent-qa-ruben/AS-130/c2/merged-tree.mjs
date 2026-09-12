#!/usr/bin/env node
// AS-130 c2, M6 seam probe: materialise `git merge-tree master feat/AS-130-demo-recapture`
// (the tree a --no-ff merge would produce today) into /tmp, outside every scanned tree.
// Nothing is committed anywhere; the tree object is written to the object store only.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-130';
const DEST = '/tmp/as130-c2-merged';
const tree = execFileSync('git', ['merge-tree', '--write-tree', 'master', 'feat/AS-130-demo-recapture'], { cwd: WT, encoding: 'utf8' }).trim();
console.log(`merge-tree: ${tree} (master ${execFileSync('git', ['rev-parse', '--short', 'master'], { cwd: WT, encoding: 'utf8' }).trim()} + branch ${execFileSync('git', ['rev-parse', '--short', 'feat/AS-130-demo-recapture'], { cwd: WT, encoding: 'utf8' }).trim()})`);
rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });
const tar = execFileSync('git', ['archive', '--format=tar', tree], { cwd: WT, maxBuffer: 512 * 1024 * 1024 });
const r = spawnSync('tar', ['-x', '-C', DEST], { input: tar });
if (r.status !== 0) throw new Error('tar failed');
for (const f of ['apps/invoicing/Dockerfile', 'apps/invoicing/demo/serve.mjs', 'apps/invoicing/lib/screens/contract-form-view.js', '.claude/skills/d1-demo-artifact/compose.capture.yaml', 'docs/demo/d1/capture.json', '.dockerignore']) {
  console.log(`  ${existsSync(`${DEST}/${f}`) ? 'present' : 'MISSING'} ${f}`);
}
// sanity: the merged Dockerfile is master's (whole-directory COPY) and serve.mjs is the branch's
const df = execFileSync('grep', ['-c', 'COPY apps/invoicing ./', `${DEST}/apps/invoicing/Dockerfile`], { encoding: 'utf8' }).trim();
const cf = execFileSync('grep', ['-c', 'clientEmailRefused', `${DEST}/apps/invoicing/lib/screens/contract-form-view.js`], { encoding: 'utf8' }).trim();
console.log(`  merged Dockerfile has master's whole-directory COPY: ${df === '1'}; contract-form-view has AS-128's clientEmailRefused: ${cf !== '0'}`);
console.log(`materialised at ${DEST}`);
