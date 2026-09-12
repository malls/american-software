// AS-128 probe runner (qa-priya): compose run --build of the test image with the
// command overridden to a single test file. Usage: node run-probe.mjs <label> <file>
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const DOCKER = '/usr/local/bin/docker';
const COMPOSE = '/Users/forrest/Code/american-software-company/.worktrees/AS-128/apps/invoicing/compose.yaml';
const OUT = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/AS-128';
const [label, file] = process.argv.slice(2);

const args = ['compose', '-p', 'asc-review-as128', '-f', COMPOSE, 'run', '--rm', '--build', 'test', 'node', '--test', file];
const r = spawnSync(DOCKER, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const log = (r.stdout || '') + (r.stderr || '');
writeFileSync(`${OUT}/${label}.log`, log);
const built = log.split('\n').filter((l) => /Image .* Built/.test(l)).map((l) => l.trim());
console.log(`label=${label} exit=${r.status} log=${OUT}/${label}.log`);
console.log(`build receipt: ${built.join(' | ') || 'NONE'}`);
for (const l of log.split('\n')) if (/^(ℹ (tests|pass|fail)|✖ |PROBE-OUT)/.test(l)) console.log(l);
