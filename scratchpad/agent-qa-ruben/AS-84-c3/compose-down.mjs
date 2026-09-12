// AS-84 cycle-3 review helper (qa-ruben): tear down an isolated compose
// project this review started, removing its locally built image.
//   node compose-down.mjs <apps/chat dir> <project>
import { spawnSync } from 'node:child_process';

const [dir, project] = process.argv.slice(2);
const r = spawnSync('/usr/local/bin/docker', ['compose', '-p', project, 'down', '--rmi', 'local', '--remove-orphans'], {
  cwd: dir,
  encoding: 'utf8',
  env: { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' },
});
process.stdout.write(r.stdout ?? '');
process.stderr.write(r.stderr ?? '');
console.log(`down ${project}: status=${r.status}`);
