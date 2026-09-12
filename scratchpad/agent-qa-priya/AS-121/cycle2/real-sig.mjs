// T13's shape against real docker with a base whose BuildKit metadata is cached (node:24-slim; alpine's
// registry lookup times out today). Usage: node real-sig.mjs <bin/compose-run.mjs path> <label>
// SIGTERM to the script alone once its container is up; then: exit code, receipt, stderr line, and whether
// any <project>_* network or <project>-* image survived.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
const [SCRIPT, label = 'fix'] = process.argv.slice(2);
const D = '/usr/local/bin/docker';
const dir = mkdtempSync(join(tmpdir(), 'asc-as121-realsig-'));
const project = `asc-as121-realsig-${label}-${process.pid}`;
writeFileSync(join(dir, 'Dockerfile'), `FROM node:24-slim\nRUN echo AS121-${Date.now()}\nCMD ["sh", "-c", "echo start; sleep 8; echo 'ℹ tests 1'; echo 'ℹ pass 1'; echo 'ℹ fail 0'; echo 'ℹ skipped 0'"]\n`);
writeFileSync(join(dir, 'compose.yaml'), 'services:\n  test:\n    build: .\n');
const child = spawn(process.execPath, [SCRIPT, '--project', project, '--cwd', dir], { env: { ...process.env, ADVANCE_DOCKER_BIN: D }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
child.stdout.on('data', (d) => { out += d; });
child.stderr.on('data', (d) => { out += d; });
const exited = new Promise((res) => child.on('exit', (code, signal) => res({ code, signal })));
const psNames = () => spawnSync(D, ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' }).stdout.split('\n').filter((n) => n.startsWith(project));
for (let i = 0; i < 240 && psNames().length === 0; i++) await sleep(500);
console.log('container up:', psNames());
const t0 = Date.now();
child.kill('SIGTERM');
const r = await exited;
console.log(`exit code=${r.code} signal=${r.signal} after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
console.log(out.split('\n').filter((l) => /RECEIPT|built:|run exit|down exit|leak check|exit=|compose-run:/.test(l)).join('\n'));
// let an orphaned compose client (mutant case) finish before measuring
for (let i = 0; i < 40 && psNames().length > 0; i++) await sleep(500);
const nets = spawnSync(D, ['network', 'ls', '--format', '{{.Name}}'], { encoding: 'utf8' }).stdout.split('\n').filter((n) => n.startsWith(`${project}_`));
const imgs = spawnSync(D, ['images', '--format', '{{.Repository}}'], { encoding: 'utf8' }).stdout.split('\n').filter((n) => n.startsWith(`${project}-`));
console.log(`survivors: networks=${JSON.stringify(nets)} images=${JSON.stringify(imgs)}`);
if (nets.length || imgs.length) {
  const dn = spawnSync(D, ['compose', '-p', project, 'down', '-v', '--rmi', 'local', '--remove-orphans'], { cwd: dir, encoding: 'utf8' });
  console.log(`hand cleanup: down exit=${dn.status}`);
}
rmSync(dir, { recursive: true, force: true });
