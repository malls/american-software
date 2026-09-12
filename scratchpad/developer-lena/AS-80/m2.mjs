// M2 (plan §6): delete `clearInterval(heartbeat);` from close() — proof the
// guard is not loopPoll-specific. NARROWED run only: the heartbeat is ref'd, so
// under M2 the AS-25 case at line 322 leaks a ref'd interval and the whole-file
// runner would never exit (plan §6 / §9).
import { readFileSync, writeFileSync, copyFileSync, rmSync, globSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-80';
const W = `${WT}/apps/chat`;
const S = '/Users/forrest/Code/american-software-company/scratchpad/developer-lena/AS-80';
const F = `${W}/server.js`;
const ORIG = `${F}.orig`;
const STREAM = `${W}/test/stream.test.js`;

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const occ = (s, n) => s.split(n).length - 1;
const slice = (s, a, b) => s.slice(s.indexOf(a) + a.length, s.indexOf(b));

const narrowed = (out) => {
  const r = spawnSync(process.execPath, ['--test', '--test-name-pattern', 'AS-80', STREAM],
    { encoding: 'utf8', maxBuffer: 64e6, timeout: 120000 });
  const text = (r.stdout || '') + (r.stderr || '');
  writeFileSync(out, text);
  const fails = text.split('\n').filter((l) => /^✖ /.test(l) && !/failing tests:/.test(l))
    .map((l) => l.slice(2).replace(/ \([0-9.]+m?s\)\s*$/, '').trim());
  const nums = Object.fromEntries(['tests', 'pass', 'fail', 'skipped'].map((k) =>
    [k, Number((text.match(new RegExp(`^ℹ ${k} (\\d+)`, 'm')) || [])[1])]));
  return { text, fails: [...new Set(fails)], nums, signal: r.signal, status: r.status };
};

console.log('name-pattern AS-80 matches in stream.test.js:',
  (readFileSync(STREAM, 'utf8').match(/^test\('([^']*AS-80[^']*)'/gm) || []).length);

const hashBefore = sha(F);
console.log('hash BEFORE:', hashBefore);

const control = narrowed(`${S}/m2-control.txt`);
console.log('CONTROL (unmutated, narrowed):', JSON.stringify(control.nums), 'exit', control.status, 'signal', control.signal);

copyFileSync(F, ORIG);
let observed;
try {
  const before = readFileSync(F, 'utf8');
  const NEEDLE = 'clearInterval(heartbeat);';
  assert.equal(occ(before, NEEDLE), 1, `pre: ${NEEDLE} occurs exactly once`);
  const lines = before.split('\n');
  const idx = lines.findIndex((l) => l.includes(NEEDLE));
  console.log(`M2 target: line ${idx + 1} — ${lines[idx].trim()}`);
  lines.splice(idx, 1);
  writeFileSync(F, lines.join('\n'));

  const after = readFileSync(F, 'utf8');
  assert.equal(occ(after, NEEDLE), 0, 'post: needle 1 -> 0');
  assert.equal(slice(after, 'stream responses would otherwise wedge', 'clearInterval(loopPoll)').includes('heartbeat'), false,
    'post: the close() slice ahead of clearInterval(loopPoll) no longer mentions heartbeat');
  assert.equal(occ(after, 'const heartbeat = setInterval('), 1, 'post: arming site untouched');
  assert.equal(after.split('\n').length, before.split('\n').length - 1, 'post: exactly one line removed');
  console.log('M2 APPLIED at the intended site.');

  observed = narrowed(`${S}/m2-observed.txt`);
} finally {
  copyFileSync(ORIG, F);
  rmSync(ORIG, { force: true });
}

console.log('--- observed (narrowed) ---');
console.log('failing cases:', observed.fails.length);
for (const n of observed.fails) console.log('  ✖', n);
console.log('counts:', JSON.stringify(observed.nums), 'exit', observed.status, 'signal', observed.signal,
  observed.signal ? '(TIMED OUT — the runner did not exit)' : '(runner exited on its own)');
console.log('T1 message lines:', JSON.stringify(observed.text.split('\n').filter((l) => /left \d+ interval/.test(l))));
console.log('cardinality pin (step 4) red instead?', observed.text.includes('update this number AND close() together'));

const hashAfter = sha(F);
console.log('hash AFTER:', hashAfter, hashAfter === hashBefore ? '(EQUAL)' : '(DIFFERENT — PROBLEM)');
console.log('git status --porcelain:',
  JSON.stringify(spawnSync('git', ['-C', WT, 'status', '--porcelain'], { encoding: 'utf8' }).stdout));

const files = globSync(`${W}/test/*.test.js`).sort();
const r = spawnSync(process.execPath, ['--test', ...files], { encoding: 'utf8', maxBuffer: 64e6 });
const text = (r.stdout || '') + (r.stderr || '');
console.log('post-restore whole suite:', JSON.stringify(Object.fromEntries(['tests', 'pass', 'fail'].map((k) =>
  [k, Number((text.match(new RegExp(`^ℹ ${k} (\\d+)`, 'm')) || [])[1])]))));
