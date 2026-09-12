// AS-50 (developer-marcus): one counted compose run of the invoicing suite with --build.
// Usage: node run-suite.mjs <label>   -> log at scratchpad/agent-developer-marcus/AS-50/suite-<label>.log
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const COMPOSE = '/Users/forrest/Code/american-software-company/.worktrees/AS-50/apps/invoicing/compose.yaml';
const OUT = '/Users/forrest/Code/american-software-company/scratchpad/agent-developer-marcus/AS-50';
const label = process.argv[2] ?? 'run';
const t0 = Date.now();
const r = spawnSync('/usr/local/bin/docker', ['compose', '-f', COMPOSE, 'run', '--rm', '--build', 'test'], {
  encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' },
});
const log = (r.stdout || '') + (r.stderr || '');
writeFileSync(`${OUT}/suite-${label}.log`, log);
console.log(`label=${label} exit=${r.status} wall=${((Date.now() - t0) / 1000).toFixed(1)}s log=${OUT}/suite-${label}.log`);
console.log(log.split('\n').filter((l) => /Image .* Built/.test(l)).map((l) => l.trim()).join('\n') || '(NO BUILD RECEIPT)');
console.log(log.split('\n').filter((l) => /^# (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)/.test(l)).join('\n'));
const notOk = log.split('\n').filter((l) => /^not ok /.test(l));
console.log(`top-level 'not ok' lines: ${notOk.length}`);
for (const l of notOk.slice(0, 20)) console.log('  ' + l);
