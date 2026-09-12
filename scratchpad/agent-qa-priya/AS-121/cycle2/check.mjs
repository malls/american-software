// --check before/after the counted run (AS-121 cycle 2)
import { spawnSync } from 'node:child_process';
const r = spawnSync(process.execPath, ['/Users/forrest/Code/american-software-company/.worktrees/AS-121/apps/chat/bin/compose-run.mjs', '--check'], {
  encoding: 'utf8', env: { ...process.env, ADVANCE_DOCKER_BIN: '/usr/local/bin/docker' },
});
process.stdout.write(r.stdout + r.stderr + `exit=${r.status}\n`);
