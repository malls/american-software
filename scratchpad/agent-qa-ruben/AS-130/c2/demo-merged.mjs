// AS-130 c2: one demo run on the merged tree, normalised against the committed transcript.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
const DOCKER = '/usr/local/bin/docker';
const ROOT = '/tmp/as130-c2-merged';
const S = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-130/c2';
const P = 'asc-c2-mergeddemo';
const normalise = (t) => t
  .replace(/acct_[A-Za-z0-9]+/g, 'acct_X').replace(/in_[A-Za-z0-9]+/g, 'in_X')
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'UUID')
  .replace(/t=\d+,v1=[0-9a-f]{64}/g, 't=T,v1=SIG')
  .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, 'TS')
  .replace(/http:\/\/127\.0\.0\.1:\d+/g, 'http://127.0.0.1:PORT');
const dk = (...a) => spawnSync(DOCKER, ['compose', '-p', P, '-f', `${ROOT}/apps/invoicing/compose.yaml`, ...a], { cwd: `${ROOT}/apps/invoicing`, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' } });
const r = dk('run', '--rm', '--build', 'demo');
writeFileSync(`${S}/demo-merged.raw.txt`, `exit ${r.status}\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}\n`);
const receipt = (r.stdout + r.stderr).match(new RegExp(`Image ${P}-demo +Built`))?.[0] ?? 'NONE';
const idx = r.stdout.indexOf('D1 core-loop walkthrough (AS-90)');
const cut = r.stdout.slice(idx);
writeFileSync(`${S}/demo-merged.cut.txt`, cut);
const committed = readFileSync(`${ROOT}/docs/demo/d1/transcript.txt`, 'utf8');
console.log(`merged demo: exit ${r.status}; receipt ${receipt}; ${cut.split('\n').length} lines; normalised == committed transcript: ${normalise(cut) === normalise(committed)}; grep -c 'not built|404s': ${(cut.match(/not built|404s/g) ?? []).length}`);
const down = dk('--profile', 'tools', 'down', '-v', '--remove-orphans');
const left = spawnSync(DOCKER, ['ps', '-a', '--filter', `name=${P}`, '--format', '{{.Names}}'], { encoding: 'utf8' }).stdout.trim();
console.log(`teardown exit ${down.status}; containers left: ${left || 'none'}`);
const imgs = spawnSync(DOCKER, ['images', '--format', '{{.Repository}}', '--filter', `reference=${P}-*`], { encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean);
if (imgs.length) { spawnSync(DOCKER, ['rmi', ...imgs]); console.log(`images removed: ${imgs.join(', ')}`); }
