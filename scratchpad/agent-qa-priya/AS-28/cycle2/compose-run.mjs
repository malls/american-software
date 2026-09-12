// qa-priya, AS-28 cycle 2: counted compose suite run with BuildKit env set,
// under an ISOLATED project name so production (`name: asc-chat`) is never
// touched. Usage: node compose-run.mjs <cwd> <project> <logfile> [down]
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [cwd, project, logfile, mode] = process.argv.slice(2);
if (!cwd || !project || !logfile) throw new Error('usage: compose-run.mjs <cwd> <project> <logfile> [down]');
if (!project.startsWith('asc-as28-')) throw new Error('refusing: project name must be an AS-28 scratch project');

const args = mode === 'down'
  ? ['compose', '-p', project, 'down', '--rmi', 'local', '--remove-orphans']
  : ['compose', '-p', project, 'run', '--rm', '--build', 'test'];

const r = spawnSync('docker', args, {
  cwd,
  env: { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' },
  encoding: 'utf8',
  maxBuffer: 256 * 1024 * 1024,
});
const out = `$ docker ${args.join(' ')}  (cwd=${cwd})\n` + (r.stdout || '') + (r.stderr || '') + `\nexit=${r.status}\n`;
writeFileSync(logfile, out);
console.log(out.slice(-1500));
process.exit(r.status ?? 1);
