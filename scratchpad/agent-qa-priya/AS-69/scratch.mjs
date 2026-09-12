// Review helper (agent:qa-priya, AS-69): materialise a scratch copy of the
// branch via `git archive` (never the worktree), then report hashes so the
// copy is provably the committed tree. Usage: node scratch.mjs <dest>
import { spawnSync } from 'node:child_process';
import { rmSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-69';
const BRANCH = 'feat/AS-69-connect-start-error-landing';
const dest = process.argv[2];
const sh = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
};
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
const tar = spawnSync('git', ['-C', WT, 'archive', BRANCH], { maxBuffer: 512 * 1024 * 1024 });
if (tar.status !== 0) throw new Error(tar.stderr.toString());
const un = spawnSync('tar', ['-x', '-C', dest], { input: tar.stdout });
if (un.status !== 0) throw new Error(un.stderr.toString());
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
console.log('branch tip', sh('git', ['-C', WT, 'rev-parse', BRANCH]).trim());
console.log('committed blob routes/connect.js', sh('git', ['-C', WT, 'rev-parse', `${BRANCH}:apps/invoicing/routes/connect.js`]).trim());
for (const f of ['apps/invoicing/routes/connect.js', 'apps/invoicing/test/connect.test.js', 'apps/invoicing/README.md']) {
  console.log(f, 'scratch', sha(`${dest}/${f}`).slice(0, 16), 'worktree', sha(`${WT}/${f}`).slice(0, 16));
}
console.log('dockerignore present:', spawnSync('test', ['-f', `${dest}/.dockerignore`]).status === 0);
