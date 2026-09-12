// counted compose receipt for AS-85, isolated project asc-review-as85
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const OUT = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-85/compose-run.log';
const COMPOSE = '/Users/forrest/Code/american-software-company/.worktrees/AS-85/apps/chat/compose.yaml';
const env = { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' };
const run = spawnSync('/usr/local/bin/docker',
  ['compose', '-p', 'asc-review-as85', '-f', COMPOSE, 'run', '--rm', '--build', 'test'],
  { env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const log = `# exit=${run.status} signal=${run.signal} error=${run.error ? run.error.message : ''}\n--- stdout ---\n${run.stdout}\n--- stderr ---\n${run.stderr}\n`;
writeFileSync(OUT, log);
const down = spawnSync('/usr/local/bin/docker', ['compose', '-p', 'asc-review-as85', '-f', COMPOSE, 'down', '--remove-orphans'], { env, encoding: 'utf8' });
writeFileSync(OUT, log + `--- down ---\nexit=${down.status}\n${down.stdout}\n${down.stderr}\n`);
const built = (run.stdout + run.stderr).split('\n').filter((l) => /Built|# tests|# pass|# fail|# skipped/.test(l));
console.log(`exit=${run.status} error=${run.error ? run.error.message : 'none'}`);
console.log(built.join('\n'));
console.log(`down exit=${down.status}`);
