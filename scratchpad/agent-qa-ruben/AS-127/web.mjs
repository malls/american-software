// Boot / tear down an isolated `web` of the AS-127 worktree on 127.0.0.1:8361 (never 8348).
//   node web.mjs up | down
import { spawnSync } from 'node:child_process';
const DOCKER = '/usr/local/bin/docker';
const PROJECT = 'asc-review-as127-web';
const CWD = '/Users/forrest/Code/american-software-company/.worktrees/AS-127/apps/invoicing';
const env = { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' };
const exec = (args) => { const r = spawnSync(DOCKER, args, { cwd: CWD, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); return r; };
const mode = process.argv[2];
if (mode === 'up') {
  const r = exec(['compose', '-p', PROJECT, 'run', '--rm', '--build', '-d', '--no-deps', '-p', '127.0.0.1:8361:8348', '--name', `${PROJECT}-web-1`, 'web']);
  const built = `${r.stdout}\n${r.stderr}`.split('\n').find((l) => /^\s*Image \S+ Built\s*$/.test(l));
  console.log(`Built line: ${built ? built.trim() : 'NONE'}`);
  console.log(`container: ${r.stdout.trim()} exit ${r.status}`);
  if (r.status !== 0) console.error(r.stderr);
} else if (mode === 'down') {
  const r = exec(['compose', '-p', PROJECT, 'down', '-v', '--rmi', 'local', '--remove-orphans']);
  console.log(`down exit ${r.status}`);
  const nets = exec(['network', 'ls', '--format', '{{.Name}}']).stdout.split('\n').filter((n) => n.startsWith(PROJECT));
  const imgs = exec(['image', 'ls', '--format', '{{.Repository}}']).stdout.split('\n').filter((n) => n.startsWith(PROJECT));
  const cts = exec(['ps', '-a', '--format', '{{.Names}}']).stdout.split('\n').filter((n) => n.startsWith(PROJECT));
  console.log(`leak check: ${nets.length} networks, ${imgs.length} images, ${cts.length} containers`);
} else {
  console.error('usage: web.mjs up|down');
  process.exit(2);
}
