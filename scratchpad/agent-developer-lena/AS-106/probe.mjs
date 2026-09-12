// AS-106 AC-1 / M1 probe: does `run --rm --build test` under `-p <project>` leave
// `<project>_default` behind? Usage: node probe.mjs <project> <cwd-of-compose>
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const [project, cwd] = process.argv.slice(2);
if (!/^asc-as106-/.test(project)) throw new Error('refusing: probe projects are asc-as106-*');
const D = '/usr/local/bin/docker';
const env = { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' };
const t0 = Date.now();
const run = spawnSync(D, ['compose', '-p', project, 'run', '--rm', '--build', 'test'], { cwd, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const all = (run.stdout || '') + (run.stderr || '');
const built = all.split('\n').filter((l) => /Built/.test(l));
const summary = all.split('\n').filter((l) => /^# (tests|pass|fail|skipped)/.test(l));
const nets = spawnSync(D, ['network', 'ls', '--format', '{{.Name}}'], { encoding: 'utf8' }).stdout.split('\n').filter((n) => n.startsWith(project));
const out = [
  `project=${project} cwd=${cwd} run.exit=${run.status} secs=${((Date.now() - t0) / 1000).toFixed(0)}`,
  `Built lines: ${JSON.stringify(built)}`,
  `summary: ${JSON.stringify(summary)}`,
  `network ls (filtered ^${project}) AFTER run, BEFORE down: ${JSON.stringify(nets)}`,
].join('\n');
const down = spawnSync(D, ['compose', '-p', project, 'down', '-v', '--rmi', 'local', '--remove-orphans'], { cwd, env, encoding: 'utf8' });
const nets2 = spawnSync(D, ['network', 'ls', '--format', '{{.Name}}'], { encoding: 'utf8' }).stdout.split('\n').filter((n) => n.startsWith(project));
const final = out + `\ndown.exit=${down.status}\nnetwork ls AFTER down: ${JSON.stringify(nets2)}\n`;
writeFileSync(`/Users/forrest/Code/american-software-company/scratchpad/agent-developer-lena/AS-106/probe-${project}.txt`, final + '\n--- raw tail ---\n' + all.slice(-3000));
console.log(final);
