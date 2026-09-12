#!/usr/bin/env node
// compose.mjs — developer-lena's counted compose runner for AS-127 (stage 2).
//   node compose.mjs <project> <cwd> <service> [logfile]
// Runs `compose -p <project> run --rm --build -T <service>`, then ALWAYS
// `down -v --rmi local --remove-orphans`, then removes the run-built image by
// name and reports what is left. Docker by absolute path (off PATH in ticks).
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const DOCKER = process.env.ADVANCE_DOCKER_BIN || '/usr/local/bin/docker';
const [project, cwd, service, logfile] = process.argv.slice(2);
if (!project || !cwd || !service) { console.error('usage: compose.mjs <project> <cwd> <service> [logfile]'); process.exit(2); }
if (!/^asc-(impl|mut|as127)-/.test(project)) { console.error('refusing non-scratch project name'); process.exit(2); }

const sh = (args, extra = {}) => spawnSync(DOCKER, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...extra });

const run = sh(['compose', '-p', project, 'run', '--rm', '--build', '-T', service]);
const out = (run.stdout || '') + (run.stderr || '');
if (logfile) writeFileSync(logfile, out);
const built = out.match(/Image \S+ Built/g) || [];
const summary = {};
for (const key of ['tests', 'pass', 'fail', 'skipped']) {
  const m = out.match(new RegExp(`^(?:# |ℹ )${key} (\\d+)`, 'm'));
  summary[key] = m ? Number(m[1]) : null;
}
// Spec reporter: a failing test is a top-level `✖ <title> (…ms)` line; the
// failure-detail block at the end repeats them, so dedupe by title.
const headEnd = out.search(/^ℹ tests /m);
const failing = [...out.slice(0, headEnd === -1 ? out.length : headEnd).matchAll(/^✖ (.*?) \(\d+(?:\.\d+)?ms\)$/mg)].map((m) => m[1]);
const down = sh(['compose', '-p', project, 'down', '-v', '--rmi', 'local', '--remove-orphans']);
const rmi = sh(['image', 'rm', '-f', `${project}-${service}`]);
const left = sh(['image', 'ls', '--format', '{{.Repository}}', '--filter', `reference=${project}*`]);
const leftImages = (left.stdout || '').trim().split('\n').filter(Boolean);
console.log(`RECEIPT project=${project} service=${service}`);
console.log(`  built: ${built.join(' | ') || 'NONE — VOID'}`);
console.log(`  tests=${summary.tests} pass=${summary.pass} fail=${summary.fail} skipped=${summary.skipped}`);
if (failing.length) console.log(`  failing (${failing.length}):\n    ${failing.join('\n    ')}`);
console.log(`  run exit=${run.status} down exit=${down.status} rmi exit=${rmi.status} images left=${leftImages.length}${leftImages.length ? ' ' + leftImages.join(',') : ''}`);
process.exit(run.status === 0 && built.length > 0 && down.status === 0 ? 0 : 1);
