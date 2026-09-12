// run-suite.mjs — one counted compose run, always --build, receipt to a log.
// usage: node run-suite.mjs <service> <logname> [composeDir]
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [service = 'test', logName = 'receipt', composeDir = '/Users/forrest/Code/american-software-company/.worktrees/AS-46/apps/invoicing'] = process.argv.slice(2);
const project = `asc-inv-as46-${service}`;
const logPath = `/Users/forrest/Code/american-software-company/scratchpad/developer-lena/AS-46/${logName}.log`;
const args = ['compose', '-p', project, '-f', `${composeDir}/compose.yaml`, 'run', '--build', '--rm', service];
const res = spawnSync('/usr/local/bin/docker', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
writeFileSync(logPath, out);
const lines = out.split('\n');
const built = lines.filter((l) => /Image .* Built/.test(l));
const summary = lines.filter((l) => /^# (tests|pass|fail|skipped|todo)/.test(l));
const notOk = lines.filter((l) => /^not ok/.test(l));
console.log(`exit=${res.status}`);
console.log(built.join('\n') || 'NO BUILT LINE — RUN IS VOID');
console.log(summary.join('\n'));
if (notOk.length) console.log(`not ok (${notOk.length}):\n${notOk.slice(0, 40).join('\n')}`);
// teardown the project's containers/images so lanes do not collide on disk
spawnSync('/usr/local/bin/docker', ['compose', '-p', project, '-f', `${composeDir}/compose.yaml`, 'down', '--rmi', 'local', '--remove-orphans'], { encoding: 'utf8' });
process.exit(res.status ?? 1);
