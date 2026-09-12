// Extract `git archive HEAD` of the AS-127 worktree to a scratch root outside
// the scanned tree (plan §8 rules: mutate an extract, never the worktree).
//   node extract.mjs <dest>
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
const W = '/Users/forrest/Code/american-software-company/.worktrees/AS-127';
const dest = process.argv[2];
if (!dest || !dest.startsWith('/tmp/rq-as127')) { console.error('dest must be under /tmp/rq-as127'); process.exit(2); }
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
const head = spawnSync('git', ['-C', W, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
const ar = spawnSync('git', ['-C', W, 'archive', '--format=tar', 'HEAD', 'apps/invoicing', 'docs/design/tokens', '.dockerignore'], { maxBuffer: 512 * 1024 * 1024 });
if (ar.status !== 0) { console.error(ar.stderr.toString()); process.exit(ar.status); }
const tar = spawnSync('tar', ['-x', '-C', dest], { input: ar.stdout });
if (tar.status !== 0) { console.error(tar.stderr.toString()); process.exit(tar.status); }
console.log(`extracted ${head} to ${dest}`);
