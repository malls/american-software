// Runs a counted compose service under an isolated project by absolute docker path.
// Output streams to the log file as it happens (inherits the shell env — BuildKit default,
// as cycle 1 did; a forced DOCKER_BUILDKIT=0 stalled for 20 minutes on this host).
// usage: node compose.mjs <cwd> <project> <service> <logfile> [extra args...]
import { spawnSync } from 'node:child_process';
import { openSync, closeSync, readFileSync } from 'node:fs';
const [cwd, project, service, log, ...extra] = process.argv.slice(2);
const fd = openSync(log, 'w');
const r = spawnSync('/usr/local/bin/docker',
  ['compose', '-p', project, '-f', 'apps/invoicing/compose.yaml', 'run', '--build', '--rm', service, ...extra],
  { cwd, stdio: ['ignore', fd, fd] });
closeSync(fd);
const out = readFileSync(log, 'utf8') + `\nEXIT=${r.status}\n`;
const tail = out.split('\n').filter((l) => /^ℹ (tests|pass|fail|skipped)|Image .* Built|^not ok/.test(l)).join('\n');
console.log(`${project}/${service}: EXIT=${r.status}\n${tail}`);
