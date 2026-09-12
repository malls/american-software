// AS-86 review: host counted run inside the worktree (cwd is per-spawn, never the shell's).
const { spawnSync } = require('child_process');
const fs = require('fs');
const dir = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/AS-86';
const cwd = '/Users/forrest/Code/american-software-company/.worktrees/AS-86/apps/chat';
const files = fs.readdirSync(cwd + '/test').filter((f) => f.endsWith('.test.js')).map((f) => 'test/' + f);
const out = process.argv[2] || 'host-run.log';
const r = spawnSync('node', ['--test', ...files], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
fs.writeFileSync(dir + '/' + out, (r.stdout || '') + '\n--- STDERR ---\n' + (r.stderr || '') + '\nEXIT ' + r.status + '\n');
const tail = (r.stdout || '').split('\n').filter((l) => /^# (tests|pass|fail|skipped|todo)/.test(l)).join(' | ');
const reds = (r.stdout || '').split('\n').filter((l) => /^not ok/.test(l)).join('\n');
console.log(files.length + ' test files; exit ' + r.status + '\n' + tail + '\nRED:\n' + reds);
