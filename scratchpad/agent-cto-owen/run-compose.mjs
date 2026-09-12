// AS-45 condition runner (cto-owen, tick watcher:17217). One compose run per
// invocation; captures the full log, prints the node --test summary lines and
// the exit code. Usage: node run-compose.mjs <label> [env KEY=VAL ...] -- <service>
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const COMPOSE = '/Users/forrest/Code/american-software-company/.worktrees/AS-45/apps/invoicing/compose.yaml';
const OUT = '/Users/forrest/Code/american-software-company/scratchpad/agent-cto-owen';

const argv = process.argv.slice(2);
const label = argv.shift();
const sep = argv.indexOf('--');
const envPairs = argv.slice(0, sep);
const service = argv[sep + 1];

// --build is mandatory: without it `compose run` reuses whatever image the tag
// last pointed at (first run this tick measured a 2026-09-02 image, 287 tests,
// against a branch with 17 test files — the stale-image trap in CLAUDE.md).
const args = ['compose', '-f', COMPOSE, 'run', '--rm', '--build'];
for (const kv of envPairs) args.push('-e', kv);
args.push(service);

const t0 = Date.now();
const r = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const secs = ((Date.now() - t0) / 1000).toFixed(1);
const log = (r.stdout || '') + (r.stderr || '');
writeFileSync(`${OUT}/as45-${label}.log`, log);

const summary = log.split('\n').filter((l) => /^# (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)/.test(l));
console.log(`label=${label} service=${service} env=${JSON.stringify(envPairs)}`);
console.log(`docker exit=${r.status} signal=${r.signal || 'none'} wall=${secs}s log=${OUT}/as45-${label}.log (${log.length} bytes)`);
console.log(summary.join('\n') || '(no node --test summary lines found)');
const notOk = log.split('\n').filter((l) => /^not ok /.test(l));
console.log(`top-level 'not ok' lines: ${notOk.length}`);
for (const l of notOk.slice(0, 20)) console.log('  ' + l);
