// AS-129 review battery (qa-ruben): run the host suite in the worktree and
// summarize. Usage: node run-host.mjs <label> [test-file ...]
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CWD = '/Users/forrest/Code/american-software-company/.worktrees/AS-129/apps/chat';
const OUT = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-129';
const [label, ...files] = process.argv.slice(2);
const args = ['--test', ...files];
const t0 = Date.now();
const r = spawnSync('node', args, { cwd: CWD, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const log = (r.stdout || '') + (r.stderr || '');
writeFileSync(`${OUT}/host-${label}.log`, log);
const summary = log.split('\n').filter((l) => /^(# |ℹ )(tests|suites|pass|fail|cancelled|skipped|todo)/.test(l));
console.log(`label=${label} files=${files.join(',') || '(all)'} exit=${r.status} wall=${((Date.now() - t0) / 1000).toFixed(1)}s log=${OUT}/host-${label}.log`);
console.log(summary.join('\n'));
const notOk = log.split('\n').filter((l) => /^(not ok |✖ )/.test(l));
console.log(`top-level 'not ok' lines: ${notOk.length}`);
for (const l of notOk) console.log('  ' + l);
