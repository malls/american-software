// AS-87 cycle-2 review: host suite in the worktree.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const cwd = '/Users/forrest/Code/american-software-company/.worktrees/AS-87/apps/chat';
const r = spawnSync(process.execPath, ['--test'], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
writeFileSync('/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/as87c2-host.log', `${r.stdout}\n${r.stderr}\n[host] exit=${r.status}\n`);
console.log(`[host] exit=${r.status}`);
