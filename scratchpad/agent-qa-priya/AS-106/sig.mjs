// qa-priya AS-106 review probe: SIGTERM the script mid-run. Does `down` still run?
// Uses a throwaway compose dir WITHOUT network_mode so a default network is created
// (observable leak). Cleans up by hand afterwards with the correct down.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const D = '/usr/local/bin/docker';
const SCRIPT = '/Users/forrest/Code/american-software-company/.worktrees/AS-106/apps/chat/bin/compose-run.mjs';
const signal = process.argv[2] || 'SIGTERM';
const project = `asc-review-as106-sig${signal === 'SIGINT' ? 'int' : 'term'}`;
const dir = mkdtempSync(join(tmpdir(), 'asc-as106-sig-'));
writeFileSync(join(dir, 'Dockerfile'), `FROM alpine\nRUN echo AS106-sig-${Date.now()}\nCMD ["sh", "-c", "echo start; sleep 15; echo 'ℹ tests 1'; echo 'ℹ pass 1'; echo 'ℹ fail 0'; echo 'ℹ skipped 0'"]\n`);
writeFileSync(join(dir, 'compose.yaml'), 'services:\n  test:\n    build: .\n');

const list = () => ({
  nets: spawnSync(D, ['network', 'ls', '--format', '{{.Name}}'], { encoding: 'utf8' }).stdout.split('\n').filter((n) => n.startsWith(`${project}_`)),
  imgs: spawnSync(D, ['images', '--format', '{{.Repository}}:{{.Tag}}'], { encoding: 'utf8' }).stdout.split('\n').filter((n) => n.startsWith(`${project}-`)),
  containers: spawnSync(D, ['ps', '-a', '--format', '{{.Names}}'], { encoding: 'utf8' }).stdout.split('\n').filter((n) => n.startsWith(`${project}`)),
});

const child = spawn(process.execPath, [SCRIPT, '--project', project, '--cwd', dir], { env: { ...process.env, ADVANCE_DOCKER_BIN: D }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
child.stdout.on('data', (d) => { out += d; });
child.stderr.on('data', (d) => { out += d; });
const exited = new Promise((res) => child.on('exit', (code, sig) => res({ code, sig })));

await new Promise((r) => setTimeout(r, 7000));
console.log(`t+7s during run: ${JSON.stringify(list())}`);
console.log(`sending ${signal} to script pid ${child.pid}`);
child.kill(signal);
const ex = await exited;
console.log(`script exited: code=${ex.code} signal=${ex.sig}`);
console.log(`immediately after: ${JSON.stringify(list())}`);
await new Promise((r) => setTimeout(r, 20000));
console.log(`t+20s after: ${JSON.stringify(list())}`);
console.log(`script output:\n${out.trim() || '(none)'}`);
// hand cleanup with the correct down, then prove it
const down = spawnSync(D, ['compose', '-p', project, 'down', '-v', '--rmi', 'local', '--remove-orphans'], { cwd: dir, encoding: 'utf8' });
console.log(`hand down exit=${down.status}`);
console.log(`after hand down: ${JSON.stringify(list())}`);
rmSync(dir, { recursive: true, force: true });
