// AS-106 M1: remove `network_mode: none` from the worktree's compose.yaml in
// place (backup + restore in finally), rerun the probe under a distinct
// project, and observe whether `<p>_default` appears. Asserts the mutation
// applied at the intended site (the `test:` service block) before running.
import { readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const APP = '/Users/forrest/Code/american-software-company/.worktrees/AS-106/apps/chat';
const FILE = `${APP}/compose.yaml`;
const BAK = `${FILE}.as106-m1.bak`;
copyFileSync(FILE, BAK);
const restore = () => { copyFileSync(BAK, FILE); unlinkSync(BAK); };
process.on('exit', restore);
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));
try {
  const src = readFileSync(FILE, 'utf8');
  const testBlock = src.indexOf('\n  test:\n');
  if (testBlock < 0) throw new Error('no test: block');
  const mutated = src.slice(0, testBlock) + src.slice(testBlock).replace('    network_mode: none\n', '');
  if (mutated === src) throw new Error('mutation did not apply');
  if (/network_mode: none/.test(mutated.slice(testBlock))) throw new Error('mutation left the line in the test block');
  writeFileSync(FILE, mutated);
  const diff = spawnSync('git', ['-C', APP, 'diff', '--', 'compose.yaml'], { encoding: 'utf8' }).stdout;
  console.log('--- M1 applied diff ---\n' + diff);
  if (!/^-\s+network_mode: none$/m.test(diff)) throw new Error('diff does not show the removal');
  const r = spawnSync('node', ['/Users/forrest/Code/american-software-company/scratchpad/agent-developer-lena/AS-106/probe.mjs', 'asc-as106-m1', APP], { encoding: 'utf8', stdio: 'inherit' });
  console.log('probe exit', r.status);
} finally {
  restore();
  process.removeListener('exit', restore);
  const clean = spawnSync('git', ['-C', APP, 'diff', '--exit-code', '--', 'compose.yaml']);
  console.log('restored; git diff --exit-code compose.yaml =>', clean.status);
}
