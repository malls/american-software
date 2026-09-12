// AS-130 rework cycle 1 — observe F1's step-1 clause: after the transcript run
// (`docker compose run --rm --build demo`), a bare `down` (old, red) vs
// `--profile tools down` (new, green). Log: rework-step1-teardown.log
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const CWD = '/Users/forrest/Code/american-software-company/.worktrees/AS-130/apps/invoicing';
const DIR = '/Users/forrest/Code/american-software-company/scratchpad/agent-developer-lena/AS-130';
const LOG = `${DIR}/rework-step1-teardown.log`;
const state = JSON.parse(readFileSync('/Users/forrest/Code/american-software-company/apps/chat/data/deploy-state.json', 'utf8'));
const docker = state.dockerBin;
const P = 'asc-rework-as130-t';
const env = { ...process.env, PATH: `/usr/local/bin:${process.env.PATH}`, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' };

writeFileSync(LOG, `# rework-step1-teardown ${new Date().toISOString()} project ${P}\n`);
function sh(args, stdoutFile) {
  const r = spawnSync(docker, args, { cwd: CWD, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const text = `$ docker ${args.join(' ')}\n${stdoutFile ? '(stdout -> ' + stdoutFile + ')\n' : r.stdout ?? ''}${r.stderr ?? ''}[exit ${r.status}]\n`;
  if (stdoutFile) writeFileSync(stdoutFile, r.stdout ?? '');
  appendFileSync(LOG, text);
  process.stdout.write(text);
  return r;
}
function measure(tag) {
  const ps = sh(['ps', '-a', '--filter', `name=${P}`, '--format', '{{.Names}}\t{{.Status}}']);
  const net = sh(['network', 'ls', '--filter', `name=${P}`, '--format', '{{.Name}}']);
  const s = { tag, containers: ps.stdout.trim().split('\n').filter(Boolean).length, networks: net.stdout.trim().split('\n').filter(Boolean).length };
  appendFileSync(LOG, `SUMMARY ${JSON.stringify(s)}\n`); process.stdout.write(`SUMMARY ${JSON.stringify(s)}\n`);
  return s;
}
const results = [];
results.push(measure('before'));
const run = sh(['compose', '-p', P, 'run', '--rm', '--build', 'demo'], `${DIR}/transcript-rework-run.stdout`);
appendFileSync(LOG, `demo run exit ${run.status}\n`);
results.push(measure('after run --rm --build demo'));
sh(['compose', '-p', P, 'down']);
results.push(measure('after OLD step-1 line: down'));
sh(['compose', '-p', P, '--profile', 'tools', 'down']);
results.push(measure('after NEW step-1 line: --profile tools down'));
sh(['compose', '-p', P, '--profile', 'tools', 'down', '-v', '--rmi', 'local', '--remove-orphans']);
appendFileSync(LOG, `\n# RESULTS\n${results.map(r => JSON.stringify(r)).join('\n')}\n`);
process.stdout.write(`\n# RESULTS\n${results.map(r => JSON.stringify(r)).join('\n')}\n`);
