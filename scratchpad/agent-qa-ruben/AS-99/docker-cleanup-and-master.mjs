// Tear down ONLY my own leftover compose projects (attributable to qa-ruben's
// earlier reviews by project name), then run master's counted compose suite.
import { spawnSync } from 'node:child_process';
import { writeFileSync, appendFileSync } from 'node:fs';

const COMPOSE = '/Users/forrest/Code/american-software-company/apps/chat/compose.yaml';
const MINE = [
  'asc-as93-ruben', 'asc-as93-ruben-base', 'asc-as93-ruben-mac1', 'asc-as93-ruben-mac2', 'asc-as93-ruben-mac3',
  'asc-as93-ruben-mac4', 'asc-as93-ruben-mac5', 'asc-as93-ruben-mac8', 'asc-as93-ruben-mac9',
  'asc-as93-ruben-mbaseline', 'asc-as93-ruben-mm6', 'asc-as94-ruben', 'asc-qa-ruben-as75',
  'asc-as99-review-master',
];
const LOG = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-99/docker-cleanup.log';
writeFileSync(LOG, '');
const env = { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' };
for (const p of MINE) {
  const r = spawnSync('docker', ['compose', '-p', p, '-f', COMPOSE, 'down', '--rmi', 'local'], { encoding: 'utf8', env });
  appendFileSync(LOG, `--- down ${p} (exit ${r.status})\n${r.stdout}${r.stderr}\n`);
}
const ls = spawnSync('docker', ['network', 'ls', '--format', '{{.Name}}'], { encoding: 'utf8' });
const asc = ls.stdout.split('\n').filter((n) => n.startsWith('asc-'));
appendFileSync(LOG, `asc-* networks remaining: ${asc.length}\n${asc.join('\n')}\n`);
console.log(`asc-* networks remaining: ${asc.length}`);

const mode = process.argv[2];
if (mode === 'master') {
  const OUT = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-99/compose-master.log';
  const r = spawnSync('docker', ['compose', '-p', 'asc-as99-review-master', 'run', '--rm', '--build', 'test'], {
    cwd: '/Users/forrest/Code/american-software-company/apps/chat', encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024,
  });
  writeFileSync(OUT, `${r.stdout}\n${r.stderr}\n[exit ${r.status}]\n`);
  const lines = (r.stdout + '\n' + r.stderr).split('\n').filter((l) => /Built|Building|^ℹ (tests|pass|fail|cancelled|skipped)|^✖|Error|not ok/.test(l));
  console.log(lines.join('\n'));
  console.log(`[exit ${r.status}]`);
  const d = spawnSync('docker', ['compose', '-p', 'asc-as99-review-master', '-f', COMPOSE, 'down', '--rmi', 'local'], { encoding: 'utf8', env });
  appendFileSync(LOG, `--- final down asc-as99-review-master (exit ${d.status})\n${d.stdout}${d.stderr}\n`);
}
