// qa-priya AS-106 review: AC-1 independently — with network_mode: none on the branch compose,
// does `run --rm --build test` (command overridden to a no-op) create <p>_default? Check BEFORE any down.
import { spawnSync } from 'node:child_process';
const D = '/usr/local/bin/docker';
const CWD = '/Users/forrest/Code/american-software-company/.worktrees/AS-106/apps/chat';
const p = 'asc-review-as106-ac1';
const nets = () => spawnSync(D, ['network', 'ls', '--format', '{{.Name}}'], { encoding: 'utf8' }).stdout.split('\n').filter((n) => n.startsWith(`${p}_`));
const r = spawnSync(D, ['compose', '-p', p, 'run', '--rm', '--build', 'test', 'node', '-e', '0'], { cwd: CWD, encoding: 'utf8', env: { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' } });
const out = (r.stdout || '') + (r.stderr || '');
console.log(`run exit=${r.status}; Built line: ${JSON.stringify(out.split('\n').find((l) => /^\s*Image \S+ Built\s*$/.test(l)) || null)}`);
console.log(`networks ^${p}_ AFTER run, BEFORE down: ${JSON.stringify(nets())}`);
const d = spawnSync(D, ['compose', '-p', p, 'down', '-v', '--rmi', 'local', '--remove-orphans'], { cwd: CWD, encoding: 'utf8' });
console.log(`down exit=${d.status}; networks after down: ${JSON.stringify(nets())}`);
const imgs = spawnSync(D, ['images', '--format', '{{.Repository}}:{{.Tag}}'], { encoding: 'utf8' }).stdout.split('\n').filter((n) => n.startsWith(`${p}-`));
console.log(`images ${p}-* after down: ${JSON.stringify(imgs)}`);
