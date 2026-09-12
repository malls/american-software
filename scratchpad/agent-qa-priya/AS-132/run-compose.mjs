// AS-132 QA: drive the counted compose run through the AS-106 tool with docker on an absolute path.
// usage: node run-compose.mjs <project> <worktree-apps-chat> <logfile>
import { spawnSync } from 'node:child_process';
const [project, cwd, logfile] = process.argv.slice(2);
const tool = '/Users/forrest/Code/american-software-company/.worktrees/AS-132/apps/chat/bin/compose-run.mjs';
const r = spawnSync(process.execPath, [tool, '--project', project, '--cwd', cwd, '--log', logfile], {
  encoding: 'utf8',
  maxBuffer: 256 * 1024 * 1024,
  env: { ...process.env, ADVANCE_DOCKER_BIN: '/usr/local/bin/docker' },
});
process.stdout.write(r.stdout ?? '');
process.stderr.write(r.stderr ?? '');
console.log(`exit=${r.status}`);
