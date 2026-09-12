// Host suite (or a single file) in the AS-83 worktree. Usage: node host-run.mjs [file]
import { spawnSync } from 'node:child_process';
const W = '/Users/forrest/Code/american-software-company/.worktrees/AS-83/apps/chat';
process.chdir(W);
const file = process.argv[2];
const r = spawnSync(process.execPath, file ? ['--test', file] : ['--test'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const lines = (r.stdout || '').split('\n');
console.log(lines.filter((l) => /^# (tests|pass|fail|duration_ms)|^not ok|^    not ok|^  not ok/.test(l)).join('\n'));
// print the names of failing tests with their assertion message head
const fails = [];
for (let i = 0; i < lines.length; i++) {
  if (/^\s*not ok/.test(lines[i])) {
    const name = lines[i].replace(/^\s*not ok \d+ - /, '');
    const ctx = lines.slice(i, i + 40).filter((l) => /message:|error:|actual|expected|operator|exit \d|after \d+ ms|timed out/.test(l)).slice(0, 8).map((l) => '      ' + l.trim());
    fails.push(name + '\n' + ctx.join('\n'));
  }
}
if (fails.length) console.log('FAILING SET (' + fails.length + '):\n' + fails.join('\n'));
console.log('exit', r.status);
