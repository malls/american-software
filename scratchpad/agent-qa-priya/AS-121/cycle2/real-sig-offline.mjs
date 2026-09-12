// Offline variant of T13's shape (registry unreachable today, BuildKit metadata lookups time out):
// compose `image:` from a local-only tag, pull_policy: never, no build. The script's run yields no Built
// line (lib exit 5 kept), but the signal mechanism and the network teardown are real.
// Usage: node real-sig-offline.mjs <bin/compose-run.mjs path> <label>
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
const [SCRIPT, label = 'fix'] = process.argv.slice(2);
const D = '/usr/local/bin/docker';
const dir = mkdtempSync(join(tmpdir(), 'asc-as121-realoff-'));
const project = `asc-as121-realoff-${label}-${process.pid}`;
writeFileSync(join(dir, 'compose.yaml'), `services:\n  test:\n    image: asc-as121-localbase:1\n    pull_policy: never\n    command: ["sh", "-c", "echo start; sleep 8; echo done"]\n`);
const child = spawn(process.execPath, [SCRIPT, '--project', project, '--cwd', dir], { env: { ...process.env, ADVANCE_DOCKER_BIN: D }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
child.stdout.on('data', (d) => { out += d; });
child.stderr.on('data', (d) => { out += d; });
const exited = new Promise((res) => child.on('exit', (code, signal) => res({ code, signal })));
const psNames = () => spawnSync(D, ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' }).stdout.split('\n').filter((n) => n.startsWith(project));
const nets = () => spawnSync(D, ['network', 'ls', '--format', '{{.Name}}'], { encoding: 'utf8' }).stdout.split('\n').filter((n) => n.startsWith(`${project}_`));
let up = false;
for (let i = 0; i < 60 && !(up = psNames().length > 0); i++) await sleep(500);
console.log('container up:', psNames(), 'network:', nets());
const t0 = Date.now();
child.kill('SIGTERM');
const r = await exited;
console.log(`exit code=${r.code} signal=${r.signal} after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
console.log(out.split('\n').filter((l) => /RECEIPT|built:|run exit|down exit|leak check|exit=|compose-run:/.test(l)).join('\n'));
for (let i = 0; i < 40 && psNames().length > 0; i++) await sleep(500);
console.log(`survivors after the container ended: networks=${JSON.stringify(nets())}`);
if (nets().length) {
  const dn = spawnSync(D, ['compose', '-p', project, 'down', '-v', '--remove-orphans'], { cwd: dir, encoding: 'utf8' });
  console.log(`hand cleanup: down exit=${dn.status}; networks now=${JSON.stringify(nets())}`);
}
rmSync(dir, { recursive: true, force: true });
