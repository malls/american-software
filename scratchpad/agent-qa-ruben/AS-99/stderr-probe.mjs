// stderr-probe.mjs — does a per-row git failure carry an absolute host path
// into errors[] (and so into lane.worktree.errors)? Scenario: the repo was
// relocated, so a linked worktree's .git file points at the OLD admin dir.
import { mkdtempSync, writeFileSync, rmSync, readFileSync, mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const BR = '/Users/forrest/Code/american-software-company/.worktrees/AS-99/apps/chat';
const { makeLanesOps } = await import(`${BR}/watch/advance-watcher.mjs`);
function sh(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} -> ${r.status}: ${r.stderr}`);
  return r.stdout;
}
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'as99-stderr-')));
const root = join(scratch, 'repo');
mkdirSync(root);
sh('git', ['init', '-q', '-b', 'master'], root);
sh('git', ['-c', 'user.name=probe', '-c', 'user.email=probe@x', 'commit', '-q', '--allow-empty', '-m', 'init'], root);
mkdirSync(join(root, '.worktrees'));
const wt = join(root, '.worktrees', 'AS-999');
sh('git', ['worktree', 'add', '-q', '-b', 'feat/AS-999-x', wt], root);
// Relocation: the worktree's .git file now names an admin dir that no longer exists.
writeFileSync(join(wt, '.git'), 'gitdir: /Users/somebody/old-location/repo/.git/worktrees/AS-999\n');
const statePath = join(scratch, 'worktrees.json');
const ops = makeLanesOps({ repoRoot: root, statePath });
await ops.evaluate();
const raw = readFileSync(statePath, 'utf8');
const snap = JSON.parse(raw);
for (const w of snap.worktrees) console.log('row', JSON.stringify({ relPath: w.relPath, main: w.main, ahead: w.ahead, dirtyCount: w.dirtyCount, errors: w.errors }));
console.log('snapshot contains "/Users/":', raw.includes('/Users/'));
// With realpath root, the inside rows must be repo-relative:
console.log('relPaths =', JSON.stringify(snap.worktrees.map((w) => w.relPath)));
rmSync(scratch, { recursive: true, force: true });
