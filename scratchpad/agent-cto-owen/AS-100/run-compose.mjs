// AS-100 merge-receipt runner (cto-owen, watcher:25355 loop tick 13). One counted
// `docker compose run --rm --build test` on the branch tip in an isolated -p project,
// full log captured, Image Built line + node --test summary printed, project torn down.
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const DOCKER = '/usr/local/bin/docker';
const CWD = '/Users/forrest/Code/american-software-company/.worktrees/AS-100/apps/chat';
const OUT = '/Users/forrest/Code/american-software-company/scratchpad/agent-cto-owen/AS-100';
const PROJECT = 'asc-as100-merge';
mkdirSync(OUT, { recursive: true });

const env = { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' };
const t0 = Date.now();
const r = spawnSync(DOCKER, ['compose', '-p', PROJECT, 'run', '--rm', '--build', 'test'], {
  cwd: CWD, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
});
const secs = ((Date.now() - t0) / 1000).toFixed(1);
const log = (r.stdout || '') + (r.stderr || '');
writeFileSync(`${OUT}/compose-b0763ad.log`, log);

const built = log.split('\n').filter((l) => /Image .* Built/.test(l));
const summary = log.split('\n').filter((l) => /^# (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)/.test(l));
const notOk = log.split('\n').filter((l) => /^not ok /.test(l));
console.log(`docker exit=${r.status} signal=${r.signal || 'none'} error=${r.error ? r.error.message : 'none'} wall=${secs}s log bytes=${log.length}`);
console.log('BUILT LINES:'); console.log(built.join('\n') || '(none — receipt VOID)');
console.log('SUMMARY:'); console.log(summary.join('\n') || '(no node --test summary lines found)');
console.log(`top-level 'not ok' lines: ${notOk.length}`);
for (const l of notOk.slice(0, 20)) console.log('  ' + l);

const d = spawnSync(DOCKER, ['compose', '-p', PROJECT, 'down', '--remove-orphans'], { cwd: CWD, env, encoding: 'utf8' });
console.log(`teardown exit=${d.status}`);
