// node mutate.mjs <M1|M2|M3|restore> — applies one mutant to the scratch worktree's bin/compose-run.mjs and asserts it landed
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-121-mutant';
const FILE = `${WT}/apps/chat/bin/compose-run.mjs`;
const which = process.argv[2];
execFileSync('git', ['-C', WT, 'checkout', '--', 'apps/chat/bin/compose-run.mjs']);
if (which === 'restore') { console.log('restored'); process.exit(0); }
const src = readFileSync(FILE, 'utf8');
const M = {
  M1: ["  for (const sig of RUN_SIGNALS) process.on(sig, onSignal);\n", "  // M1: no registration\n"],
  M2: ["  if (interrupted && result.exit === 0) result.exit = 128 + os.constants.signals[interrupted];\n", "  // M2: no override\n"],
  M3: ["  await new Promise((r) => setImmediate(r));\n", "  // M3: no yield\n"],
};
const [from, to] = M[which];
if (!src.includes(from)) { console.error(`mutation site not found for ${which}`); process.exit(1); }
if (src.split(from).length !== 2) { console.error(`mutation site not unique for ${which}`); process.exit(1); }
writeFileSync(FILE, src.replace(from, to));
console.log(execFileSync('git', ['-C', WT, 'diff', '--stat'], { encoding: 'utf8' }));
console.log(execFileSync('git', ['-C', WT, 'diff', '-U0', '--', 'apps/chat/bin/compose-run.mjs'], { encoding: 'utf8' }));
