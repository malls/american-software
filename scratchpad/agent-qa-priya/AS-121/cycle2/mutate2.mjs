// node mutate2.mjs <M1|M2|M3|M4|restore> — applies one mutant to the scratch worktree's bin/compose-run.mjs
// (detached at a4ee15c) and prints the -U0 diff so the site can be asserted before the run.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-121-mutant';
const FILE = `${WT}/apps/chat/bin/compose-run.mjs`;
const which = process.argv[2];
execFileSync('git', ['-C', WT, 'checkout', '--', 'apps/chat/bin/compose-run.mjs']);
if (which === 'restore') { console.log('restored'); process.exit(0); }
const src = readFileSync(FILE, 'utf8');
const M = {
  // AC-1/AC-5: no registration at all
  M1: ["      for (const sig of RUN_SIGNALS) process.on(sig, onSignal);\n", "      // M1: no registration\n"],
  // AC-3: no 128+signum override
  M2: ["  if (interrupted && result.exit === 0) result.exit = 128 + os.constants.signals[interrupted];\n", "  // M2: no override\n"],
  // AC-2: no setImmediate yield
  M3: ["  await new Promise((r) => setImmediate(r));\n", "  // M3: no yield\n"],
  // AC-6: handler armed before runCounted (the cycle-0 shape)
  M4: ["  const result = runCounted(armedExec(onSignal), {\n", "  for (const sig of RUN_SIGNALS) process.on(sig, onSignal); // M4: armed before the guard\n  const result = runCounted(armedExec(onSignal), {\n"],
};
const [from, to] = M[which];
if (!src.includes(from)) { console.error(`mutation site not found for ${which}`); process.exit(1); }
if (src.split(from).length !== 2) { console.error(`mutation site not unique for ${which}`); process.exit(1); }
writeFileSync(FILE, src.replace(from, to));
console.log(execFileSync('git', ['-C', WT, 'diff', '-U0', '--', 'apps/chat/bin/compose-run.mjs'], { encoding: 'utf8' }));
