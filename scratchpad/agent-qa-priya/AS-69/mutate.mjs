// Review helper (agent:qa-priya, AS-69): apply / restore the plan's named
// falsifiers in the SCRATCH copy only. Every mutation asserts it applied at
// the intended site; restore re-extracts the committed blob and proves the hash.
//   node mutate.mjs ac1      routes/connect.js <- master's copy (pre-change behaviour)
//   node mutate.mjs ac3      handle() default fail = plainFailure(step) -> screenFailure
//   node mutate.mjs restore  routes/connect.js <- branch blob 0c30f95, hash-checked
//   node mutate.mjs status   print counts + hash
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-69';
const BRANCH = 'feat/AS-69-connect-start-error-landing';
const FILE = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/AS-69/scratch/apps/invoicing/routes/connect.js';
const show = (ref) => {
  const r = spawnSync('git', ['-C', WT, 'show', `${ref}:apps/invoicing/routes/connect.js`], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout;
};
const count = (s, n) => s.split(n).length - 1;
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const status = (label) => {
  const s = readFileSync(FILE, 'utf8');
  console.log(`${label}: sha=${sha(s)} 'startFailed: true'=${count(s, 'startFailed: true')} screenFailure=${count(s, 'screenFailure')} 'fail = plainFailure(step)'=${count(s, 'fail = plainFailure(step)')} 'fail = screenFailure'=${count(s, 'fail = screenFailure')}`);
  return s;
};
const mode = process.argv[2];
const branchCopy = show(BRANCH);
console.log(`branch blob sha=${sha(branchCopy)}`);
if (mode === 'status') status('scratch');
if (mode === 'ac1') {
  const master = show('master');
  writeFileSync(FILE, master);
  const s = status('after ac1 (master copy)');
  if (count(s, 'startFailed: true') !== 0 || count(s, 'screenFailure') !== 0) throw new Error('ac1 NOT applied');
  console.log('ac1 applied: routes/connect.js is master\'s copy');
}
if (mode === 'ac3') {
  const before = branchCopy;
  const needle = 'const handle = (step, act, fail = plainFailure(step)) => async (req, res) => {';
  if (count(before, needle) !== 1) throw new Error(`anchor count ${count(before, needle)} != 1`);
  const after = before.replace(needle, 'const handle = (step, act, fail = screenFailure) => async (req, res) => {');
  writeFileSync(FILE, after);
  const s = status('after ac3');
  if (count(s, 'fail = screenFailure) => async') !== 1 || count(s, 'fail = plainFailure(step)') !== 0) throw new Error('ac3 NOT applied at the handle() signature');
  // The intended site is the handle() signature and nothing else: exactly one line differs.
  const diff = after.split('\n').filter((l, i) => l !== before.split('\n')[i]);
  console.log('ac3 applied; lines differing:', diff.length, JSON.stringify(diff));
}
if (mode === 'restore') {
  writeFileSync(FILE, branchCopy);
  const s = status('after restore');
  if (sha(s) !== sha(branchCopy)) throw new Error('restore FAILED');
  console.log('restored: scratch routes/connect.js == branch blob');
}
