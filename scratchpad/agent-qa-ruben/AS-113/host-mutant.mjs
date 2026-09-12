// One indivisible host mutant step (try/finally is the trap): mutate, assert
// applied, show the mutated diff, run test/mode.test.js, restore, prove clean.
// Usage: node host-mutant.mjs M2|M3
import { spawnSync } from 'node:child_process';
const S = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-113';
const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-113';
const M = process.argv[2];
const sh = (bin, args, opts = {}) => spawnSync(bin, args, { encoding: 'utf8', ...opts });
process.on('exit', () => {
  const r = sh('node', [`${S}/mutate.mjs`, 'restore']);
  process.stdout.write(`--- ${r.stdout.trim()} ---\n`);
  const d = sh('git', ['-C', WT, 'diff', '--exit-code']);
  process.stdout.write(d.status === 0 ? 'TREE CLEAN (git diff --exit-code = 0)\n' : `TREE DIRTY:\n${d.stdout}\n`);
});
const m = sh('node', [`${S}/mutate.mjs`, M]);
process.stdout.write(m.stdout + m.stderr);
if (m.status !== 0) process.exit(9);
process.stdout.write('--- mutated diff ---\n' + sh('git', ['-C', WT, 'diff', '--', 'apps/chat/bin/chat.js']).stdout);
process.stdout.write(`--- host node --test test/mode.test.js under ${M} ---\n`);
const t = sh('node', ['--test', 'test/mode.test.js'], { cwd: `${WT}/apps/chat`, maxBuffer: 64 * 1024 * 1024 });
const lines = (t.stdout + t.stderr).split('\n').filter((l) => /^(✔|✖|ℹ (tests|pass|fail))|not ok|AssertionError|the refusal names|expected|actual/.test(l));
process.stdout.write(lines.join('\n') + '\n');
