// Priya's M6 probe runner: scratch extract of the branch, probe file appended
// to a copy of read-screens.test.js, run ONLY the PRIYA-* names in the image.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const REPO = '/Users/forrest/Code/american-software-company';
const WT = `${REPO}/.worktrees/AS-48`;
const OUT = `${REPO}/scratchpad/agent-qa-priya/AS-48`;
const SCRATCH = `${OUT}/probe-tree`;
const APP = 'apps/invoicing';
const DOCKER = '/usr/local/bin/docker';
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });

fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(SCRATCH, { recursive: true });
const ar = sh('sh', ['-c', `git -C ${WT} archive HEAD | tar -x -C ${SCRATCH}`]);
if (ar.status !== 0) { console.error(ar.stderr); process.exit(3); }

const src = fs.readFileSync(path.join(SCRATCH, APP, 'test/read-screens.test.js'), 'utf8');
const probes = fs.readFileSync(`${OUT}/probes.snippet.js`, 'utf8');
fs.writeFileSync(path.join(SCRATCH, APP, 'test/zz-priya-probe.test.js'), src + '\n' + probes);

const proj = 'asc-review-as48-priya-probe';
const run = sh(DOCKER, ['compose', '-p', proj, 'run', '--rm', '--build', 'test', 'node', '--test', '--test-name-pattern=PRIYA-', 'test/zz-priya-probe.test.js'], {
  cwd: path.join(SCRATCH, APP), env: { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' },
});
fs.writeFileSync(`${OUT}/probe.log`, (run.stdout || '') + '\n--- STDERR ---\n' + (run.stderr || '') + `\nEXIT=${run.status}\n`);
const all = (run.stdout || '') + (run.stderr || '');
console.log('built=', /Image .*Built/.test(all), 'exit=', run.status);
console.log(all.split('\n').filter((l) => /PRIYA-|^not ok|^ok|ℹ (tests|pass|fail)|Error|expected|actual/.test(l)).join('\n'));
sh(DOCKER, ['compose', '-p', proj, 'down', '-v', '--rmi', 'local'], { cwd: path.join(SCRATCH, APP) });
