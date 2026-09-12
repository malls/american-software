// Runs M1..M4 against the scratch worktree: mutate, assert the site, run test/compose-run.test.js, record the red set, restore.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const HERE = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/AS-121/cycle2';
const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-121-mutant';
const real = process.argv[2] === 'real';
const list = real ? ['M1'] : ['M1', 'M2', 'M3', 'M4'];
const summary = [];
for (const m of list) {
  const mut = spawnSync(process.execPath, [`${HERE}/mutate2.mjs`, m], { encoding: 'utf8' });
  if (mut.status !== 0) { console.error(mut.stderr); process.exit(1); }
  const env = { ...process.env, ADVANCE_DOCKER_BIN: '/usr/local/bin/docker' };
  if (real) env.AS106_REAL = '1';
  const r = spawnSync(process.execPath, ['--test', 'test/compose-run.test.js'], { cwd: `${WT}/apps/chat`, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const text = `--- mutation diff ---\n${mut.stdout}\n--- test output ---\n${r.stdout}\n--- stderr ---\n${r.stderr}\nexit=${r.status}\n`;
  writeFileSync(`${HERE}/mutant-${m}${real ? '-real' : ''}.txt`, text);
  const red = [...r.stdout.matchAll(/^✖ (T\d+[a-z]?)/gm)].map((x) => x[1]);
  const counts = [...r.stdout.matchAll(/^ℹ (tests|pass|fail|skipped) (\d+)/gm)].map((x) => `${x[1]}=${x[2]}`).join(' ');
  summary.push(`${m}${real ? ' (AS106_REAL=1)' : ''}: red {${red.join(', ')}}  ${counts}  exit=${r.status}`);
  console.log(mut.stdout.split('\n').filter((l) => /^[+-][^+-]/.test(l)).join('\n'));
  console.log(summary[summary.length - 1], '\n');
}
spawnSync(process.execPath, [`${HERE}/mutate2.mjs`, 'restore']);
const clean = spawnSync('git', ['-C', WT, 'diff', '--exit-code', '--stat'], { encoding: 'utf8' });
console.log('restore: git diff --exit-code ->', clean.status === 0 ? 'clean' : `DIRTY\n${clean.stdout}`);
console.log('\n' + summary.join('\n'));
