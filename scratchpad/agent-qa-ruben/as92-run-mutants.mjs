// Run a list of mutants end to end: mutate -> test -> restore -> verify.
import { spawnSync } from 'node:child_process';
const T = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/as92-tools.mjs';
const S = '/tmp/as92-scratch-ruben';
for (const m of process.argv.slice(2)) {
  console.log(`=============== ${m}`);
  const mut = spawnSync(process.execPath, [T, 'mutate', S, m], { encoding: 'utf8' });
  process.stdout.write(mut.stdout + mut.stderr);
  if (mut.status === 0) {
    const t = spawnSync(process.execPath, [T, 'test', S], { encoding: 'utf8', maxBuffer: 1 << 28 });
    process.stdout.write(t.stdout + t.stderr);
  } else {
    console.log(`${m}: MUTATION NOT APPLIED — skipping run`);
  }
  const r = spawnSync(process.execPath, [T, 'restore', S], { encoding: 'utf8' });
  process.stdout.write(r.stdout.split('\n').slice(-2).join('\n') + '\n' + r.stderr);
}
