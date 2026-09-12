// AS-49 planning: baseline compose receipt on master (cto-owen scratchpad).
// Runs the counted `test` and `contract` suites with --build under a private
// project name, then tears the project down. Absolute docker path per the
// headless-tick rule; nothing here touches the main checkout's running web.
import { spawnSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';

const REPO = '/Users/forrest/Code/american-software-company';
const APP = `${REPO}/apps/invoicing`;
const log = `${REPO}/scratchpad/agent-cto-owen/as49/baseline-master.log`;
const env = { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' };

const head = spawnSync('git', ['-C', REPO, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
writeFileSync(log, `baseline on master, HEAD=${head} ${new Date().toISOString()}\n`);

const run = (args) => {
  appendFileSync(log, `\n$ docker ${args.join(' ')}\n`);
  const r = spawnSync('/usr/local/bin/docker', args, { cwd: APP, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  appendFileSync(log, (r.stdout || '') + (r.stderr || '') + `\n[exit ${r.status}]\n`);
  return r.status;
};

const base = ['compose', '-p', 'asc-plan-as49', '-f', `${APP}/compose.yaml`];
const t = run([...base, 'run', '--rm', '--build', 'test']);
const c = run([...base, 'run', '--rm', '--build', 'contract']);
const d = run([...base, 'down', '-v', '--rmi', 'local']);
appendFileSync(log, `\nSUMMARY test=${t} contract=${c} down=${d}\n`);
