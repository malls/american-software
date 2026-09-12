#!/usr/bin/env node
// AS-130 c2, AC-7: `test` and `contract` with --build on a given root; receipts + counts.
// usage: node suites.mjs <project> <root>
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const [project, ROOT] = process.argv.slice(2);
const S = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-130/c2';
const DOCKER = '/usr/local/bin/docker';
const dk = (...a) => spawnSync(DOCKER, ['compose', '-p', project, '-f', `${ROOT}/apps/invoicing/compose.yaml`, ...a], { cwd: `${ROOT}/apps/invoicing`, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' } });
const counts = (out) => Object.fromEntries(['tests', 'pass', 'fail', 'skipped'].map((k) => [k, Number((out.match(new RegExp(`^ℹ ${k} (\\d+)`, 'm')) ?? [])[1] ?? NaN)]));
for (const svc of ['test', 'contract']) {
  const r = dk('run', '--rm', '--build', svc);
  writeFileSync(`${S}/${project}-${svc}.log`, `$ docker compose -p ${project} -f ${ROOT}/apps/invoicing/compose.yaml run --rm --build ${svc}\nexit ${r.status}\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}\n`);
  const receipt = (r.stdout + r.stderr).match(new RegExp(`Image ${project}-${svc} +Built`))?.[0] ?? 'NONE';
  const c = counts(r.stdout);
  const notOk = (r.stdout.match(/^not ok .*/gm) ?? []);
  console.log(`${project} ${svc}: exit ${r.status}; receipt ${receipt}; ${c.tests}/${c.pass}/${c.fail}/${c.skipped}${notOk.length ? `\n  red set (${notOk.length}):\n  ` + notOk.join('\n  ') : ''}`);
}
const down = dk('--profile', 'tools', 'down', '-v', '--remove-orphans');
const left = spawnSync(DOCKER, ['ps', '-a', '--filter', `name=${project}`, '--format', '{{.Names}}'], { encoding: 'utf8' }).stdout.trim();
console.log(`${project} teardown exit ${down.status}; containers left: ${left ? left : 'none'}`);
const imgs = spawnSync(DOCKER, ['images', '--format', '{{.Repository}}', '--filter', `reference=${project}-*`], { encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean);
if (imgs.length) { spawnSync(DOCKER, ['rmi', ...imgs]); console.log(`${project} images removed: ${imgs.join(', ')}`); }
