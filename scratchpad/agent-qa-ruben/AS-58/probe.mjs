// probe.mjs — run an ESM snippet INSIDE the invoicing test container (WORKDIR
// /app), so every probe uses the image's node and the image's module graph.
// Usage: node probe.mjs <snippet-file> [service]
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const DOCKER = '/usr/local/bin/docker';
const COMPOSE = '/Users/forrest/Code/american-software-company/.worktrees/AS-58/apps/invoicing/compose.yaml';
const PROJ = process.env.PROJ || 'asc-ruben-as58';
const snippet = readFileSync(process.argv[2], 'utf8');
const svc = process.argv[3] || 'test';

const r = spawnSync(DOCKER, [
  'compose', '-p', PROJ, '-f', COMPOSE, 'run', '--rm', '--build', svc,
  'node', '--input-type=module', '-e', snippet,
], {
  encoding: 'utf8',
  maxBuffer: 1 << 28,
  env: { ...process.env, DOCKER_BUILDKIT: '0', COMPOSE_DOCKER_CLI_BUILD: '0' },
});
process.stdout.write(r.stdout || '');
process.stderr.write(r.stderr || '');
console.log('[probe] exit=' + r.status);
