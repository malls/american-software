// AS-86 mutant runner (developer-lena). One indivisible step: back up, apply the
// named mutant (asserting it landed at the intended site), run the FULL host
// suite, restore in `finally` (the shell's `trap` is unavailable here), then
// prove the tree clean with `git diff --exit-code` and re-run the suite green.
import { spawnSync } from 'node:child_process';

const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-86';
const PAD = '/Users/forrest/Code/american-software-company/scratchpad/agent-developer-lena/AS-86';
const GLOB = WT + '/apps/chat/test';
const FILES = ['api', 'chat', 'cli', 'deploy-inputs-git', 'deploy-shape', 'events', 'lanes', 'loop-status',
  'personnel', 'stream', 'watcher', 'watcher-main'];

function mut(arg) {
  const r = spawnSync('node', [PAD + '/mutate.mjs', arg], { encoding: 'utf8' });
  process.stdout.write(r.stdout + r.stderr);
  if (r.status !== 0) throw new Error('mutate ' + arg + ' failed');
}

function suite() {
  const r = spawnSync('node', ['--test', ...testFiles()], { encoding: 'utf8', cwd: WT });
  const out = r.stdout + r.stderr;
  // the spec reporter prints each failure twice (inline + summary) — dedupe
  const red = [...new Set([...out.matchAll(/^✖ (.+?) \(\d/gm)].map((m) => m[1]))];
  const num = (k) => (out.match(new RegExp('^. ' + k + ' (\\d+)$', 'm')) || [])[1];
  return { red, tests: num('tests'), pass: num('pass'), fail: num('fail'), skipped: num('skipped') };
}

function testFiles() {
  const r = spawnSync('sh', ['-c', 'ls ' + GLOB + '/*.test.js'], { encoding: 'utf8' });
  return r.stdout.split('\n').filter(Boolean);
}

function gitClean() {
  const r = spawnSync('git', ['-C', WT, 'diff', '--exit-code'], { encoding: 'utf8' });
  return r.status === 0;
}

const which = process.argv[2];
mut('BACKUP');
let result;
try {
  mut(which);
  result = suite();
} finally {
  mut('RESTORE');
}
console.log('\n=== ' + which + ' red set (' + result.red.length + ') ===');
for (const name of result.red) console.log('  RED: ' + name);
console.log('counts: tests=' + result.tests + ' pass=' + result.pass + ' fail=' + result.fail + ' skipped=' + result.skipped);
console.log('tree clean after restore (git diff --exit-code): ' + gitClean());
const after = suite();
console.log('post-restore suite: tests=' + after.tests + ' pass=' + after.pass + ' fail=' + after.fail +
  ' skipped=' + after.skipped + ' red=' + after.red.length);
if (!gitClean() || after.fail !== '0') process.exitCode = 1;
