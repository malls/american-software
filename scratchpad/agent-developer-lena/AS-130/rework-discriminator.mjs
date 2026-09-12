// AS-130 rework cycle 1 — which factor makes a bare `down` skip stripe-mock?
// A: step-2 files, one-off removed by hand first, then bare `down -v`.
// B: default compose.yaml only (no override), detached --name'd one-off running, then bare `down`.
// Log: rework-discriminator.log
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const ROOT = '/Users/forrest/Code/american-software-company/.worktrees/AS-130';
const LOG = '/Users/forrest/Code/american-software-company/scratchpad/agent-developer-lena/AS-130/rework-discriminator.log';
const state = JSON.parse(readFileSync('/Users/forrest/Code/american-software-company/apps/chat/data/deploy-state.json', 'utf8'));
const docker = state.dockerBin;
const FILES = ['-f', 'apps/invoicing/compose.yaml', '-f', '.claude/skills/d1-demo-artifact/compose.capture.yaml'];
const ONE = ['-f', 'apps/invoicing/compose.yaml'];
const env = { ...process.env, PATH: `/usr/local/bin:${process.env.PATH}`, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' };
writeFileSync(LOG, `# rework-discriminator ${new Date().toISOString()}\n`);
function sh(args) {
  const r = spawnSync(docker, args, { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const text = `$ docker ${args.join(' ')}\n${r.stdout ?? ''}${r.stderr ?? ''}[exit ${r.status}]\n`;
  appendFileSync(LOG, text); process.stdout.write(text); return r;
}
function measure(P, tag) {
  const ps = sh(['ps', '-a', '--filter', `name=${P}`, '--format', '{{.Names}}\t{{.Status}}']);
  const net = sh(['network', 'ls', '--filter', `name=${P}`, '--format', '{{.Name}}']);
  const s = { tag, containers: ps.stdout.trim().split('\n').filter(Boolean).length, networks: net.stdout.trim().split('\n').filter(Boolean).length };
  appendFileSync(LOG, `SUMMARY ${JSON.stringify(s)}\n`); process.stdout.write(`SUMMARY ${JSON.stringify(s)}\n`); return s;
}
const results = [];
// A
{
  const P = 'asc-rework-as130-a';
  sh(['compose', '-p', P, ...FILES, 'run', '--rm', '-d', '--build', '-p', '127.0.0.1:8349:8348', '-p', '127.0.0.1:8350:8350', '--name', `${P}-web`, 'demo', 'node', 'demo/serve.mjs']);
  results.push(measure(P, 'A up'));
  sh(['rm', '-f', `${P}-web`]);
  results.push(measure(P, 'A one-off removed by hand'));
  sh(['compose', '-p', P, ...FILES, 'down', '-v']);
  results.push(measure(P, 'A after bare down -v (override files, no one-off)'));
  sh(['compose', '--profile', 'tools', '-p', P, ...FILES, 'down', '-v', '--rmi', 'local', '--remove-orphans']);
  results.push(measure(P, 'A cleaned'));
}
// B
{
  const P = 'asc-rework-as130-b';
  sh(['compose', '-p', P, ...ONE, 'run', '--rm', '-d', '--build', '--name', `${P}-web`, 'demo', 'node', 'demo/serve.mjs']);
  results.push(measure(P, 'B up'));
  sh(['compose', '-p', P, ...ONE, 'down']);
  results.push(measure(P, 'B after bare down (no override, one-off running)'));
  sh(['compose', '--profile', 'tools', '-p', P, ...ONE, 'down', '-v', '--rmi', 'local', '--remove-orphans']);
  results.push(measure(P, 'B cleaned'));
}
appendFileSync(LOG, `\n# RESULTS\n${results.map(r => JSON.stringify(r)).join('\n')}\n`);
process.stdout.write(`\n# RESULTS\n${results.map(r => JSON.stringify(r)).join('\n')}\n`);
