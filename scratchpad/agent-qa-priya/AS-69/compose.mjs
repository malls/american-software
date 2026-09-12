// Review helper (agent:qa-priya, AS-69): run a compose service with --build,
// streaming the full output to a log file as it happens; on exit print the
// receipt lines (Image ... Built, the node --test summary, any not ok) and the
// exit code. stdin is ignored (an open pipe stalls `compose run`), -T disables
// the pseudo-TTY. Usage:
//   node compose.mjs <compose.yaml> <project> <service> <log> [cmd <argv...> | down]
import { spawn } from 'node:child_process';
import { createWriteStream, readFileSync } from 'node:fs';

const [file, project, service, log, mode, ...extra] = process.argv.slice(2);
const DOCKER = '/usr/local/bin/docker';
const args = mode === 'down'
  ? ['compose', '-f', file, '-p', project, 'down', '-v', '--rmi', 'local', '--remove-orphans']
  : ['compose', '-f', file, '-p', project, 'run', '--build', '-T', '--rm', service, ...(mode === 'cmd' ? extra : [])];
const out = createWriteStream(log);
out.write(`$ ${DOCKER} ${args.join(' ')}\n`);
const child = spawn(DOCKER, args, { stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.pipe(out, { end: false });
child.stderr.pipe(out, { end: false });
child.on('close', (code) => {
  out.end(`\nexit=${code}\n`, () => {
    const text = readFileSync(log, 'utf8');
    const receipt = text.split('\n').filter((l) => /Image .* Built|Built$|^# (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)|^not ok|PROBE-|error:|expected|actual|Error/.test(l));
    console.log(receipt.join('\n'));
    console.log(`exit=${code}`);
    process.exit(code ?? 1);
  });
});
