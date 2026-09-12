// Same as probe.mjs, but against the MAIN checkout (master) — so a claimed
// regression is measured on both sides rather than assumed.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const DOCKER = '/usr/local/bin/docker';
const COMPOSE = '/Users/forrest/Code/american-software-company/apps/invoicing/compose.yaml';
const PROJ = 'asc-ruben-as58-master';
const snippet = readFileSync(process.argv[2], 'utf8');

const r = spawnSync(DOCKER, [
  'compose', '-p', PROJ, '-f', COMPOSE, 'run', '--rm', '--build', 'test',
  'node', '--input-type=module', '-e', snippet,
], {
  encoding: 'utf8',
  maxBuffer: 1 << 28,
  env: { ...process.env, DOCKER_BUILDKIT: '0', COMPOSE_DOCKER_CLI_BUILD: '0' },
});
process.stdout.write(r.stdout || '');
process.stderr.write(r.stderr || '');
console.log('[probe-master] exit=' + r.status);
