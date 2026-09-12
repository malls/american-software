// AS-35 review runner (qa-ruben). Usage: node run-suite.mjs <label> [test-file]
// Runs the token suite from the AS-35 worktree, logs to this scratchpad,
// prints counts and the exact failing-test names, then proves the tree clean.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-35';
const SP = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-35';
const label = process.argv[2];
const testFile = process.argv[3] || `${WT}/docs/design/tokens/tokens.test.mjs`;
const log = `${SP}/${label}.log`;

const r = spawnSync(process.execPath, ['--test', testFile], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const out = (r.stdout || '') + (r.stderr || '');
writeFileSync(log, out);
const counts = out.split('\n').filter((l) => /^ℹ (tests|pass|fail) /.test(l)).map((l) => l.replace(/^ℹ /, '')).join('  ');
const failing = out.split('\n').filter((l) => /^✖ /.test(l)).map((l) => l.replace(/^✖ /, '').replace(/ \([\d.]+ms\)$/, ''));
const errors = out.split('\n').filter((l) => /^\s+(error|Error|AssertionError)/.test(l)).slice(0, 12);
console.log(`== ${label}  (node ${process.version}, exit=${r.status}, log=${log})`);
console.log(counts);
console.log(`-- failing set (${failing.length}):`);
for (const f of failing) console.log(`   ${f}`);
console.log('-- first error lines:');
for (const e of errors) console.log(`   ${e.trim()}`);
const diff = spawnSync('git', ['-C', WT, 'diff', '--exit-code', '--stat'], { encoding: 'utf8' });
console.log(diff.status === 0 ? '-- worktree: CLEAN (git diff --exit-code = 0)' : `-- worktree: DIRTY\n${diff.stdout}`);
