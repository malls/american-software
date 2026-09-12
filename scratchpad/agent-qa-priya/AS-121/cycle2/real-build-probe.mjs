// Why did T11/T13's `FROM alpine` build fail? Reproduce the compose build in a throwaway project and show the tail.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const D = '/usr/local/bin/docker';
const sh = (args, opts = {}) => spawnSync(D, args, { encoding: 'utf8', ...opts });
console.log('alpine images cached:', sh(['images', '--format', '{{.Repository}}:{{.Tag}}']).stdout.split('\n').filter((l) => /alpine/.test(l)).join(', ') || 'none');
const dir = mkdtempSync(join(tmpdir(), 'asc-as121-buildprobe-'));
writeFileSync(join(dir, 'Dockerfile'), `FROM alpine\nRUN echo AS121-probe-${Date.now()}\nCMD ["true"]\n`);
writeFileSync(join(dir, 'compose.yaml'), 'services:\n  test:\n    build: .\n');
const project = 'asc-as121-buildprobe';
const r = sh(['compose', '-p', project, 'run', '--rm', '--build', 'test'], { cwd: dir, env: { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' } });
console.log('run status', r.status);
console.log('--- stdout tail ---\n' + r.stdout.split('\n').slice(-15).join('\n'));
console.log('--- stderr tail ---\n' + r.stderr.split('\n').slice(-25).join('\n'));
sh(['compose', '-p', project, 'down', '-v', '--rmi', 'local', '--remove-orphans'], { cwd: dir });
rmSync(dir, { recursive: true, force: true });
