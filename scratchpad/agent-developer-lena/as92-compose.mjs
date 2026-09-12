// AS-92 counted compose receipt — absolute docker path (docker is off PATH here).
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const cwd = '/Users/forrest/Code/american-software-company/.worktrees/AS-92/apps/chat';
const mode = process.argv[2] ?? 'run';
const argv = mode === 'down'
  ? ['compose', '-p', 'asc-impl-as92', 'down', '--rmi', 'local', '-v']
  : ['compose', '-p', 'asc-impl-as92', 'run', '--build', '--rm', 'test'];
const r = spawnSync('/usr/local/bin/docker', argv, { cwd, encoding: 'utf8', maxBuffer: 1 << 28 });
const out = (r.stdout || '') + '\n--- stderr ---\n' + (r.stderr || '');
writeFileSync(`/Users/forrest/Code/american-software-company/scratchpad/agent-developer-lena/as92-compose-${mode}.log`, out);
console.log('exit', r.status);
for (const l of out.split('\n')) if (/ Built|^ℹ (tests|pass|fail|skipped)|Container .* (Created|Removed|Stopped)|Network .* (Created|Removed)|Image .* Removed|Volume .* Removed/.test(l)) console.log(l.trim());
