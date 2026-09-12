// Ruben's compose runner for the AS-58 review. Isolated project name, absolute
// dockerBin from apps/chat/data/deploy-state.json, --build on every counted run.
import { spawnSync } from 'node:child_process';

const DOCKER = '/usr/local/bin/docker';
const COMPOSE = '/Users/forrest/Code/american-software-company/.worktrees/AS-58/apps/invoicing/compose.yaml';
const PROJ = process.env.PROJ || 'asc-ruben-as58';
const svc = process.argv[2] || 'test';
const extra = process.argv.slice(3);

const args = ['compose', '-p', PROJ, '-f', COMPOSE, 'run', '--rm', '--build', svc, ...extra];
const r = spawnSync(DOCKER, args, {
  encoding: 'utf8',
  maxBuffer: 1 << 28,
  env: { ...process.env, DOCKER_BUILDKIT: '0', COMPOSE_DOCKER_CLI_BUILD: '0' },
});
process.stdout.write(r.stdout || '');
process.stderr.write(r.stderr || '');
console.log('[runner] exit=' + r.status + ' signal=' + (r.signal || 'none'));
