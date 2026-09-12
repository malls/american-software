// AS-128 review runner (qa-priya). One counted compose run per invocation, --build
// mandatory. Usage: node run-compose.mjs <label> <compose.yaml> <project> [-- <service>]
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const DOCKER = '/usr/local/bin/docker'; // apps/chat/data/deploy-state.json dockerBin
const OUT = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/AS-128';

const [label, compose, project, ...rest] = process.argv.slice(2);
const service = rest.includes('--') ? rest[rest.indexOf('--') + 1] : 'test';

const args = ['compose', '-p', project, '-f', compose, 'run', '--rm', '--build', service];
const t0 = Date.now();
const r = spawnSync(DOCKER, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const secs = ((Date.now() - t0) / 1000).toFixed(1);
const log = (r.stdout || '') + (r.stderr || '');
writeFileSync(`${OUT}/${label}.log`, log);

const built = log.split('\n').filter((l) => /Image .* Built/.test(l)).map((l) => l.trim());
const summary = log.split('\n').filter((l) => /^(#|ℹ) (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)/.test(l));
console.log(`label=${label} project=${project} service=${service}`);
console.log(`docker exit=${r.status} signal=${r.signal || 'none'} wall=${secs}s log=${OUT}/${label}.log (${log.length} bytes)`);
console.log(`build receipt: ${built.join(' | ') || 'NONE'}`);
console.log(summary.join('\n') || '(no node --test summary lines found)');
const notOk = log.split('\n').filter((l) => /^(not ok |✖ )/.test(l));
console.log(`top-level 'not ok' lines: ${notOk.length}`);
for (const l of notOk.slice(0, 20)) console.log('  ' + l);
