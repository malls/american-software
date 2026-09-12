// AS-132 (developer-lena): run the host suite inside the worktree's apps/chat
// and summarize. Usage: node run-host.mjs <label> [test-file ...]
// (cwd is passed to spawnSync — sub-agent shells reset cwd between calls.)
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CWD = '/Users/forrest/Code/american-software-company/.worktrees/AS-132/apps/chat';
const OUT = '/Users/forrest/Code/american-software-company/scratchpad/agent-developer-lena/AS-132';
const [label, ...files] = process.argv.slice(2);
const t0 = Date.now();
const r = spawnSync('node', ['--test', ...files], { cwd: CWD, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const log = (r.stdout || '') + (r.stderr || '');
writeFileSync(`${OUT}/host-${label}.log`, log);
const summary = log.split('\n').filter((l) => /^(# |ℹ )(tests|suites|pass|fail|cancelled|skipped|todo)/.test(l));
console.log(`label=${label} files=${files.join(',') || '(all)'} exit=${r.status} wall=${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(summary.join('\n'));
const notOk = log.split('\n').filter((l) => /^(not ok |✖ )/.test(l));
console.log(`top-level 'not ok' lines: ${notOk.length}`);
for (const l of notOk) console.log('  ' + l);
