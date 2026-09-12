// Counted compose runner for AS-71 (docker is off PATH in the tick environment).
// usage: node run.mjs <label> [extra docker compose run args...]
//   default: run --rm --build test      (the suite)
//   with args: run --rm --build test <args>   (e.g. grep -c X /app/vendor/states-ledger.md)
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [label, ...extra] = process.argv.slice(2);
const cwd = '/Users/forrest/Code/american-software-company/.worktrees/AS-71/apps/invoicing';
const env = { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' };
const args = ['compose', '-p', 'asc-impl-as71', 'run', '--rm', '--build', 'test', ...extra];
const r = spawnSync('/usr/local/bin/docker', args, { cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const out = (r.stdout ?? '') + (r.stderr ?? '');
const log = `/Users/forrest/Code/american-software-company/scratchpad/developer-marcus/AS-71/${label}.log`;
writeFileSync(log, out + `\nexit ${r.status}\n`);
const built = out.match(/Image [^\n]* Built/g) ?? [];
const summary = {};
for (const key of ['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
  const m = out.match(new RegExp(`^ℹ ${key} (\\d+)`, 'm'));
  if (m) summary[key] = Number(m[1]);
}
const failing = [...out.matchAll(/^✖ (.*?) \(\d+(?:\.\d+)?ms\)$/gm)].map((m) => m[1]);
console.log(JSON.stringify({ label, exit: r.status, built, summary, failing, extraOutput: extra.length ? out.trim().split('\n').slice(-3) : undefined }, null, 2));
