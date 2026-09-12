// AS-87 review: run the opt-in real-build test from the worktree's apps/chat.
// usage: node as87-real.mjs <label>
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const cwd = '/Users/forrest/Code/american-software-company/.worktrees/AS-87/apps/chat';
const label = process.argv[2] || 'run';
const r = spawnSync(process.execPath, ['--test', 'test/watcher-deploy-real.test.js'], {
  cwd,
  env: { ...process.env, AS87_REAL_BUILD: '1', ADVANCE_DOCKER_BIN: '/usr/local/bin/docker' },
  encoding: 'utf8',
});
const out = `${r.stdout}\n${r.stderr}\n[real:${label}] exit=${r.status}\n`;
writeFileSync(`/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/as87-real-${label}.log`, out);
console.log(out.split('\n').filter((l) => /^(not ok|ok|# |ℹ|\[real|.*expected|.*actual|.*heartbeats|.*not empty|.*Error)/.test(l)).join('\n'));
