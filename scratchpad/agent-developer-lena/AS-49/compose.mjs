// Run a compose service in the AS-49 worktree by absolute docker path and print
// a filtered summary plus the receipt lines. Usage:
//   node compose.mjs <project> <service> [extra args...]   (always --build)
//   node compose.mjs <project> down                          (down -v --rmi local)
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const DOCKER = '/usr/local/bin/docker';
// Optional first arg `--compose=<path>` picks a different compose.yaml (a
// scratch copy for a mutant, or the main checkout for a master baseline).
const argv = process.argv.slice(2);
const composeArg = argv[0]?.startsWith('--compose=') ? argv.shift().slice('--compose='.length) : null;
const COMPOSE = composeArg ?? '/Users/forrest/Code/american-software-company/.worktrees/AS-49/apps/invoicing/compose.yaml';
const [project, service, ...rest] = argv;
const args = service === 'down'
  ? ['compose', '-p', project, '-f', COMPOSE, 'down', '-v', '--rmi', 'local']
  : ['compose', '-p', project, '-f', COMPOSE, 'run', '--rm', '--build', service, ...rest];
const env = { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' };
const r = spawnSync(DOCKER, args, { env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const out = (r.stdout ?? '') + (r.stderr ?? '');
const log = `/Users/forrest/Code/american-software-company/scratchpad/agent-developer-lena/AS-49/${project}-${service}.log`;
writeFileSync(log, out);
const lines = out.split('\n');
const keep = lines.filter((l) =>
  /Built|^# (tests|pass|fail|skipped|todo|cancelled)|^not ok|^# Subtest|error:|Error \[|expected:|actual:|^\s+message:|stripe-mock invoice fixture|AssertionError/.test(l)
  || /^\s+\+ /.test(l) || /^\s+- /.test(l)
);
console.log(keep.slice(0, 120).join('\n'));
console.log(`exit ${r.status}; full log ${log}`);
