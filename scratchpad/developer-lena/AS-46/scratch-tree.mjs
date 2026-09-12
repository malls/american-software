// scratch-tree.mjs — copy the AS-46 worktree's app + vendored tokens into a
// scratch dir (never the worktree), optionally restoring files from a git ref.
// usage: node scratch-tree.mjs <targetDir> [--ref HEAD --restore path1,path2] [--drop path1,path2]
import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-46';
const args = process.argv.slice(2);
const target = args[0];
if (!target || !target.startsWith('/Users/forrest/Code/american-software-company/scratchpad/developer-lena/')) {
  throw new Error('target must be under my scratchpad');
}
const opt = (name) => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };
const ref = opt('--ref') ?? 'HEAD';
const restore = (opt('--restore') ?? '').split(',').filter(Boolean);
const drop = (opt('--drop') ?? '').split(',').filter(Boolean);

rmSync(target, { recursive: true, force: true });
mkdirSync(join(target, 'docs/design'), { recursive: true });
cpSync(join(WT, 'apps'), join(target, 'apps'), { recursive: true });
cpSync(join(WT, 'docs/design/tokens'), join(target, 'docs/design/tokens'), { recursive: true });
cpSync(join(WT, '.dockerignore'), join(target, '.dockerignore'));
for (const rel of restore) {
  const content = execFileSync('git', ['-C', WT, 'show', `${ref}:${rel}`]);
  mkdirSync(dirname(join(target, rel)), { recursive: true });
  writeFileSync(join(target, rel), content);
}
for (const rel of drop) {
  if (existsSync(join(target, rel))) rmSync(join(target, rel));
}
console.log(`scratch tree at ${target} (restored ${restore.length} from ${ref}, dropped ${drop.length})`);
