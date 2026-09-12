// Ruben's compose runner for AS-67 review. Usage:
//   node compose.mjs run  <logfile>   -> docker compose -p asc-review-as67 run --rm --build test
//   node compose.mjs down <logfile>   -> docker compose -p asc-review-as67 down -v --rmi local --remove-orphans
//   node compose.mjs ls   <logfile>   -> docker ps -a / images / volumes / networks filtered on asc-review-as67
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const DOCKER = '/usr/local/bin/docker';
const CWD = '/Users/forrest/Code/american-software-company/.worktrees/AS-67/apps/invoicing';
const PROJECT = 'asc-review-as67';
const [mode, logfile] = process.argv.slice(2);
const env = { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' };

function run(args) {
  const r = spawnSync(DOCKER, args, { cwd: CWD, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, out: `${r.stdout ?? ''}\n--- stderr ---\n${r.stderr ?? ''}\n--- exit ${r.status} ---\n` };
}

let result;
if (mode === 'run') result = run(['compose', '-p', PROJECT, 'run', '--rm', '--build', 'test']);
else if (mode === 'down') result = run(['compose', '-p', PROJECT, 'down', '-v', '--rmi', 'local', '--remove-orphans']);
else if (mode === 'ls') {
  const a = run(['ps', '-a', '--filter', `name=${PROJECT}`, '--format', '{{.Names}}']);
  const b = run(['images', '--filter', `reference=${PROJECT}*`, '--format', '{{.Repository}}:{{.Tag}}']);
  const c = run(['volume', 'ls', '--filter', `name=${PROJECT}`, '--format', '{{.Name}}']);
  const d = run(['network', 'ls', '--filter', `name=${PROJECT}`, '--format', '{{.Name}}']);
  result = { status: 0, out: `containers:\n${a.out}\nimages:\n${b.out}\nvolumes:\n${c.out}\nnetworks:\n${d.out}` };
} else throw new Error(`unknown mode ${mode}`);

if (logfile) writeFileSync(logfile, result.out);
process.stdout.write(result.out.slice(-6000));
process.exit(result.status ?? 1);
