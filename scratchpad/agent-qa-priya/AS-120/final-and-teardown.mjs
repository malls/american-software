// AS-120 review (qa-priya): final counted compose run from $W (--build), then teardown of this project,
// the leaked last-tick project asc-review-as120, dangling asc-review-as120-* images, and network ls after.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const SP = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/AS-120';
const DIR = '/Users/forrest/Code/american-software-company/.worktrees/AS-120/apps/chat';
const env = { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' };
const docker = (args) => spawnSync('/usr/local/bin/docker', args, { env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const proj = 'asc-review-as120-final';
const r = docker(['compose', '-f', `${DIR}/compose.yaml`, '--project-directory', DIR, '-p', proj, 'run', '--build', '--rm', 'test', 'node', '--test', '--test-reporter=tap']);
const out = (r.stdout || '') + (r.stderr || '');
writeFileSync(`${SP}/${proj}-${Date.now()}.log`, out);
for (const l of out.split('\n')) if (/Built|^# (tests|pass|fail|skipped|cancelled) |^\s*not ok/.test(l)) console.log(l.trim());
console.log(`final exit=${r.status}`);
for (const p of [proj, 'asc-review-as120']) {
  const d = docker(['compose', '-f', `${DIR}/compose.yaml`, '--project-directory', DIR, '-p', p, 'down', '-v', '--rmi', 'local', '--remove-orphans']);
  console.log(`down ${p}: exit=${d.status} ${(d.stderr || '').trim().split('\n').slice(-2).join(' | ')}`);
}
const imgs = docker(['images', '--format', '{{.Repository}}:{{.Tag}}']).stdout.split('\n').filter((l) => /as120/.test(l));
for (const i of imgs) { const x = docker(['rmi', i]); console.log(`rmi ${i}: exit=${x.status}`); }
console.log('as120 images after:', docker(['images', '--format', '{{.Repository}}:{{.Tag}}']).stdout.split('\n').filter((l) => /as120/.test(l)).join(',') || 'none');
console.log('--- docker network ls (after):');
console.log(docker(['network', 'ls', '--format', '{{.Name}}']).stdout.trim());
