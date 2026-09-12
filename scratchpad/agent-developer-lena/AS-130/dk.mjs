// Docker runner for the AS-130 lane (docker is off PATH for sub-agents).
// Usage: node dk.mjs [--log <file>] [--cwd <dir>] [--env K=V ...] -- <docker args...>
// Prints stdout+stderr (also appended to --log when given) and exits with docker's code.
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const state = JSON.parse(readFileSync('/Users/forrest/Code/american-software-company/apps/chat/data/deploy-state.json', 'utf8'));
const docker = state.dockerBin;
const argv = process.argv.slice(2);
let log = null;
let stdoutFile = null;
let cwd = process.cwd();
const env = { ...process.env, PATH: `/usr/local/bin:${process.env.PATH}` };
while (argv.length && argv[0] !== '--') {
  const k = argv.shift();
  if (k === '--log') log = argv.shift();
  else if (k === '--stdout') stdoutFile = argv.shift();
  else if (k === '--cwd') cwd = argv.shift();
  else if (k === '--env') { const [a, ...b] = argv.shift().split('='); env[a] = b.join('='); }
  else throw new Error(`unknown option ${k}`);
}
argv.shift();
const r = spawnSync(docker, argv, { cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const text = `$ docker ${argv.join(' ')}\n${r.stdout ?? ''}${r.stderr ?? ''}[exit ${r.status}]\n`;
if (log) appendFileSync(log, text);
if (stdoutFile) writeFileSync(stdoutFile, r.stdout ?? '');
process.stdout.write(text);
process.exit(r.status ?? 1);
