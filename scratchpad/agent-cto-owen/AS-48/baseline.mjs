// AS-48 planning baseline: cleanup of my asc-plan-as49-* leftovers, then a counted
// --build run of the offline suite on master in an isolated project, torn down after.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const DOCKER = '/usr/local/bin/docker';
const REPO = '/Users/forrest/Code/american-software-company';
const COMPOSE = `${REPO}/apps/invoicing/compose.yaml`;
const OUT = `${REPO}/scratchpad/agent-cto-owen/AS-48`;
const PROJECT = 'asc-plan-as48-owen';

function run(args, label) {
  const r = spawnSync(DOCKER, args, { encoding: 'utf8', cwd: `${REPO}/apps/invoicing`, maxBuffer: 64 * 1024 * 1024 });
  const text = `### ${label}: docker ${args.join(' ')}\nexit ${r.status}\n${r.stdout}\n${r.stderr}\n`;
  process.stdout.write(text);
  return { status: r.status, text };
}

const log = [];
// 1. leak cleanup: my earlier planning project (Lena's finding)
log.push(run(['compose', '-p', 'asc-plan-as49', '-f', COMPOSE, 'down', '-v', '--rmi', 'local', '--remove-orphans'], 'cleanup asc-plan-as49').text);
// 2. baseline
log.push(run(['compose', '-p', PROJECT, '-f', COMPOSE, 'run', '--build', '--rm', 'test'], 'baseline test').text);
// 3. teardown
log.push(run(['compose', '-p', PROJECT, '-f', COMPOSE, 'down', '-v', '--rmi', 'local', '--remove-orphans'], 'teardown').text);
// 4. leak check
const ps = spawnSync(DOCKER, ['ps', '-a', '--format', '{{.Names}}'], { encoding: 'utf8' }).stdout.split('\n').filter(l => l.includes('asc-plan-as4'));
const im = spawnSync(DOCKER, ['images', '--format', '{{.Repository}}'], { encoding: 'utf8' }).stdout.split('\n').filter(l => l.includes('asc-plan-as4'));
const leak = `### leak check\ncontainers matching asc-plan-as4*: ${JSON.stringify(ps)}\nimages matching asc-plan-as4*: ${JSON.stringify(im)}\n`;
process.stdout.write(leak);
log.push(leak);
writeFileSync(`${OUT}/baseline-test.log`, log.join('\n'));
