#!/usr/bin/env node
// Ruben's counted compose runner for AS-127 review (mirrors apps/chat/lib/compose-run.js's
// discipline: --build, always down -v --rmi local --remove-orphans, leak check, Built line
// is the receipt). Adds what the tool lacks: a service, extra env, and a command override.
//
//   node run.mjs --project asc-review-as127-<x> --cwd <dir>/apps/invoicing [--service test|contract]
//                [--env K=V ...] [--log file] [-- node --test test/foo.test.js]
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const DOCKER = '/usr/local/bin/docker';
const argv = process.argv.slice(2);
const opts = { project: null, cwd: null, service: 'test', env: [], log: null, cmd: [] };
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a === '--project') opts.project = argv[++i];
  else if (a === '--cwd') opts.cwd = argv[++i];
  else if (a === '--service') opts.service = argv[++i];
  else if (a === '--env') opts.env.push(argv[++i]);
  else if (a === '--log') opts.log = argv[++i];
  else if (a === '--') { opts.cmd = argv.slice(i + 1); break; }
  else { console.error(`unknown arg ${a}`); process.exit(2); }
}
if (!opts.project || !opts.cwd) { console.error('usage'); process.exit(2); }
if (!/^asc-review-as127-[a-z0-9-]+$/.test(opts.project)) { console.error(`refusing project ${opts.project}`); process.exit(2); }

const env = { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' };
const exec = (args) => {
  const r = spawnSync(DOCKER, args, { cwd: opts.cwd, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.error) throw r.error;
  return r;
};

const runArgs = ['compose', '-p', opts.project, 'run', '--rm', '--build'];
for (const e of opts.env) runArgs.push('-e', e);
runArgs.push(opts.service, ...opts.cmd);
const started = Date.now();
const run = exec(runArgs);
const out = `${run.stdout}\n${run.stderr}`;
if (opts.log) writeFileSync(opts.log, out);
const down = exec(['compose', '-p', opts.project, 'down', '-v', '--rmi', 'local', '--remove-orphans']);
const nets = exec(['network', 'ls', '--format', '{{.Name}}']).stdout.split('\n').filter((n) => n.startsWith(`${opts.project}_`) || n === `${opts.project}_default`);
const imgs = exec(['image', 'ls', '--format', '{{.Repository}}']).stdout.split('\n').filter((n) => n.startsWith(`${opts.project}-`));

const lines = out.split('\n');
const built = lines.find((l) => /^\s*Image \S+ Built\s*$/.test(l)) || null;
const summary = lines.filter((l) => /^[ℹ#] ?(tests|pass|fail|skipped|cancelled) [0-9]+/.test(l.trim())).map((l) => l.trim());
const failingIdx = lines.findIndex((l) => /✖ failing tests:/.test(l));
const notOk = failingIdx >= 0
  ? lines.slice(failingIdx + 1).filter((l) => /^\s*✖ /.test(l)).map((l) => l.trim().replace(/ \([0-9.]+ms\)$/, ''))
  : lines.filter((l) => /^\s*not ok /.test(l)).map((l) => l.trim());
console.log(`project ${opts.project} service ${opts.service} cmd ${opts.cmd.join(' ') || '(default)'} env ${opts.env.join(',') || '-'}`);
console.log(`Built line: ${built ? built.trim() : 'NONE — NOT A RECEIPT'}`);
console.log(`run exit ${run.status}, down exit ${down.status}, leak check: ${nets.length} networks, ${imgs.length} images, ${Math.round((Date.now() - started) / 1000)}s`);
console.log(summary.join(' | '));
if (notOk.length) console.log(`not ok (${notOk.length}):\n  ${notOk.join('\n  ')}`);
process.exit(built ? run.status : 5);
