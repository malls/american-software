// AS-87 review probe (plan §4 candidate 3): with --progress plain, is the
// FAILURE-path log still a superset — does compose's error text still land?
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runDockerCompose } from '/Users/forrest/Code/american-software-company/.worktrees/AS-87/apps/chat/watch/advance-watcher.mjs';

const docker = '/usr/local/bin/docker';
const dir = mkdtempSync(join(tmpdir(), `asc-as87fail-${process.pid}-`));
const project = dir.split('/').pop().toLowerCase();
const app = join(dir, 'app'); mkdirSync(app);
writeFileSync(join(app, 'Dockerfile'), `FROM alpine\nRUN echo AS87-FAIL-MARKER-${Date.now()} && exit 7\nCMD ["sleep","3600"]\n`);
writeFileSync(join(app, 'compose.yaml'), 'services:\n  as87fail:\n    build: .\n');
const logPath = join(dir, 'deploy-fail.log');
const env = { PATH: process.env.PATH, HOME: process.env.HOME, USER: process.env.USER, LOGNAME: process.env.LOGNAME, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1', CHAT_BUILD_ID: 'x' };
const result = await runDockerCompose({ dockerBin: docker, cwd: app, env, logPath, timeoutMs: 120_000, log: (l) => console.log('LOG', l) });
await new Promise((r) => setTimeout(r, 300));
const body = readFileSync(logPath, 'utf8');
console.log('result', JSON.stringify(result));
console.log('log bytes', statSync(logPath).size);
console.log('has marker', /AS87-FAIL-MARKER/.test(body), '| has step line', /^#\d+ /m.test(body), '| mentions exit code 7', /exit code: 7|code: 7|returned a non-zero code: 7/.test(body));
console.log('--- last 6 lines ---');
console.log(body.trim().split('\n').slice(-6).join('\n'));
spawnSync(docker, ['compose', '-p', project, 'down', '--rmi', 'local', '-v', '--remove-orphans'], { cwd: app, stdio: 'ignore' });
rmSync(dir, { recursive: true, force: true });
