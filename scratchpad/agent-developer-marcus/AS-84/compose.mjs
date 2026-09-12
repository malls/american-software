// Counted compose receipt / teardown for AS-84 rework 2.
//   node compose.mjs run   -> docker compose -p asc-rework-as84 run --build --rm test
//   node compose.mjs down  -> docker compose -p asc-rework-as84 down --remove-orphans --rmi local
// Docker is off PATH in the lane; the absolute binary is the one deploy-state.json names.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DOCKER = '/usr/local/bin/docker';
const APP = '/Users/forrest/Code/american-software-company/.worktrees/AS-84/apps/chat';
const PROJECT = 'asc-rework-as84';
const mode = process.argv[2];

const args =
  mode === 'run'
    ? ['compose', '-p', PROJECT, 'run', '--build', '--rm', 'test']
    : ['compose', '-p', PROJECT, 'down', '--remove-orphans', '--rmi', 'local'];

const r = spawnSync(DOCKER, args, { cwd: APP, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const out = (r.stdout || '') + '\n--- stderr ---\n' + (r.stderr || '');
writeFileSync(join(here, `compose-${mode}.log`), out);
for (const l of out.split('\n')) {
  if (/Built|ℹ (tests|pass|fail|skipped|cancelled)|^[✖﹣] |git not runnable|Error|error/.test(l)) console.log(l.trim());
}
console.log(`exit=${r.status} signal=${r.signal} error=${r.error ? r.error.message : 'none'}`);
