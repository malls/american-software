// Counted compose receipt: docker compose -p <project> -f <file> run --rm --build -T <service>
// Usage: node compose.mjs <repoRoot> <project> <relComposeFile> [service=test] [down]
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
const DOCKER = '/usr/local/bin/docker';
const [root, project, rel, service = 'test', down] = process.argv.slice(2);
const file = join(root, rel);
if (down === 'down') {
  const d = spawnSync(DOCKER, ['compose', '-p', project, '-f', file, 'down', '-v', '--remove-orphans'], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  console.log(`[down ${project}] exit ${d.status}`, (d.stdout + d.stderr).trim().split('\n').slice(-3).join(' | '));
  process.exit(d.status);
}
const args = ['compose', '-p', project, '-f', file, 'run', '--rm', '--build', '-T', service];
const r = spawnSync(DOCKER, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 1 << 28, timeout: 540000 });
const out = r.stdout + r.stderr;
const built = out.match(/Image [^\n]*Built/g) || [];
const summary = {};
for (const k of ['tests', 'pass', 'fail', 'skipped', 'cancelled']) { const m = out.match(new RegExp(`ℹ ${k} (\\d+)`)); summary[k] = m ? Number(m[1]) : null; }
const failing = [...out.matchAll(/^✖ (.+?) \(/gm)].map((m) => m[1]);
console.log(`[${project}] exit ${r.status}; receipt: ${built.join(' ; ') || 'NO BUILT LINE — VOID'}`);
console.log(`[${project}] tests/pass/fail/skipped = ${summary.tests}/${summary.pass}/${summary.fail}/${summary.skipped}`);
for (const f of failing) console.log(`[${project}] RED: ${f}`);
if (process.env.RAW) console.log(out);
// print assertion lines for failures, briefly
for (const m of out.matchAll(/^\s+error: ['"]?(.{0,200})/gm)) console.log(`[${project}] msg: ${m[1]}`);
