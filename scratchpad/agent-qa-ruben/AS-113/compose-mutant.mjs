// M1 through compose (counted, --build via bin/compose-run.mjs), one indivisible
// step: mutate, assert applied, show diff, compose run, restore (on exit, even on
// failure), prove tree clean. The confirming rebuild is a separate run after this.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const S = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-113';
const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-113';
const ROOT = '/Users/forrest/Code/american-software-company';
const sh = (bin, args, opts = {}) => spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts });
let out = '';
const log = (s) => { out += s + '\n'; process.stdout.write(s + '\n'); };
process.on('exit', () => {
  const r = sh('node', [`${S}/mutate.mjs`, 'restore']);
  log(`--- ${r.stdout.trim()} ---`);
  const d = sh('git', ['-C', WT, 'diff', '--exit-code']);
  log(d.status === 0 ? 'TREE CLEAN (git diff --exit-code = 0)' : `TREE DIRTY:\n${d.stdout}`);
  writeFileSync(`${S}/compose-m1.out`, out);
});
const m = sh('node', [`${S}/mutate.mjs`, 'M1']);
log(m.stdout + m.stderr);
if (m.status !== 0) process.exit(9);
log('--- mutated diff ---\n' + sh('git', ['-C', WT, 'diff', '--', 'apps/chat/bin/chat.js']).stdout);
log('--- compose (asc-review-as113, --build) under M1 ---');
const c = sh('node', [`${ROOT}/apps/chat/bin/compose-run.mjs`, '--project', 'asc-review-as113', '--cwd', `${WT}/apps/chat`, '--log', `${S}/compose-m1.log`]);
log(c.stdout + c.stderr + `\ncompose-run exit=${c.status}`);
