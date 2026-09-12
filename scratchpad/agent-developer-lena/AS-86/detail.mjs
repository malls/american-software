// Apply a mutant, run ONE test file, print the failure detail, restore.
import { spawnSync } from 'node:child_process';
const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-86';
const PAD = '/Users/forrest/Code/american-software-company/scratchpad/agent-developer-lena/AS-86';
const mut = (a) => {
  const r = spawnSync('node', [PAD + '/mutate.mjs', a], { encoding: 'utf8' });
  process.stdout.write(r.stdout + r.stderr);
  if (r.status !== 0) throw new Error('mutate ' + a + ' failed');
};
const which = process.argv[2];
const file = process.argv[3];
mut('BACKUP');
let out = '';
try {
  mut(which);
  const r = spawnSync('node', ['--test', WT + '/apps/chat/test/' + file], { encoding: 'utf8', cwd: WT });
  out = r.stdout + r.stderr;
} finally {
  mut('RESTORE');
}
const lines = out.split('\n');
const from = lines.findIndex((l) => l.includes('✖') || l.includes('AssertionError') || l.includes('Error:'));
console.log(lines.slice(Math.max(0, from - 2), from + 28).join('\n'));
const g = spawnSync('git', ['-C', WT, 'diff', '--exit-code'], { encoding: 'utf8' });
console.log('tree clean after restore: ' + (g.status === 0));
