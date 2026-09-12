// AS-87 cycle-2 review: counted compose receipt, absolute docker path, unique project, torn down with -v.
import { spawnSync } from 'node:child_process';
const cwd = '/Users/forrest/Code/american-software-company/.worktrees/AS-87/apps/chat';
const docker = '/usr/local/bin/docker';
const env = { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' };
const r = spawnSync(docker, ['compose', '-p', 'asc-review-as87', 'run', '--rm', '--build', 'test'], { cwd, env, stdio: 'inherit' });
console.log(`\n[receipt] compose run exit=${r.status} signal=${r.signal}`);
const d = spawnSync(docker, ['compose', '-p', 'asc-review-as87', 'down', '-v', '--remove-orphans'], { cwd, env, stdio: 'inherit' });
console.log(`[receipt] compose down exit=${d.status}`);
