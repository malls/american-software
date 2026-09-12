// M1 (plan §6): delete `clearInterval(loopPoll)` from close(); the whole suite
// must go 479/1 with T1 the only red. Backup + try/finally restore stands in
// for the shell trap; the hash pair and `git status` prove the restore.
import { readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { globSync } from 'node:fs';
import assert from 'node:assert/strict';

const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-80';
const W = `${WT}/apps/chat`;
const S = '/Users/forrest/Code/american-software-company/scratchpad/developer-lena/AS-80';
const F = `${W}/server.js`;
const ORIG = `${F}.orig`;

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const occ = (s, n) => s.split(n).length - 1;
const slice = (s, a, b) => s.slice(s.indexOf(a) + a.length, s.indexOf(b));
const testFiles = globSync(`${W}/test/*.test.js`).sort();

const runSuite = (args, out) => {
  const r = spawnSync(process.execPath, ['--test', ...args], { encoding: 'utf8', maxBuffer: 64e6 });
  const text = (r.stdout || '') + (r.stderr || '');
  writeFileSync(out, text);
  const fails = text.split('\n').filter((l) => /^✖ /.test(l)).map((l) => l.slice(2).replace(/ \([0-9.]+m?s\)\s*$/, '').trim());
  const nums = Object.fromEntries(['tests', 'pass', 'fail'].map((k) => [k, Number((text.match(new RegExp(`^ℹ ${k} (\\d+)`, 'm')) || [])[1])]));
  return { text, fails, nums };
};

console.log(`test files examined: ${testFiles.length}`);
const before = readFileSync(F, 'utf8');
const hashBefore = sha(F);
console.log('hash BEFORE:', hashBefore);

copyFileSync(F, ORIG);
let observed;
try {
  // --- mutate, site-anchored -------------------------------------------------
  const NEEDLE = 'clearInterval(loopPoll)';
  assert.equal(occ(before, NEEDLE), 1, `pre: ${NEEDLE} occurs exactly once`);
  const lines = before.split('\n');
  const idx = lines.findIndex((l) => l.includes(NEEDLE));
  console.log(`M1 target: line ${idx + 1} — ${lines[idx].trim()}`);
  lines.splice(idx, 1);
  writeFileSync(F, lines.join('\n'));

  // --- assert applied AT the site -------------------------------------------
  const after = readFileSync(F, 'utf8');
  assert.equal(occ(after, NEEDLE), 0, 'post: needle 1 -> 0');
  assert.equal(slice(after, 'clearInterval(heartbeat);', 'clearInterval(lanesPoll);').includes('loopPoll'), false,
    'post: close() slice between heartbeat and lanesPoll no longer mentions loopPoll');
  assert.equal(occ(after, 'const loopPoll = setInterval('), 1, 'post: arming site untouched');
  assert.equal(after.split('\n').length, before.split('\n').length - 1, 'post: exactly one line removed');
  console.log('M1 APPLIED at the intended site.');

  // --- observe ---------------------------------------------------------------
  observed = runSuite(testFiles, `${S}/m1-observed.txt`);
} finally {
  copyFileSync(ORIG, F);
  rmSync(ORIG, { force: true });
}

console.log('--- observed failing set (cardinality first) ---');
console.log('failing cases:', observed.fails.length);
for (const n of observed.fails) console.log('  ✖', n);
console.log('counts:', JSON.stringify(observed.nums));
const msg = observed.text.split('\n').filter((l) => /left \d+ interval/.test(l));
console.log('T1 message lines:', JSON.stringify(msg));
const fromStep4 = observed.text.includes('update this number AND close() together');
console.log('did the cardinality pin (step 4) red instead?', fromStep4);

// --- prove the restore -------------------------------------------------------
const hashAfter = sha(F);
console.log('hash AFTER:', hashAfter, hashAfter === hashBefore ? '(EQUAL)' : '(DIFFERENT — PROBLEM)');
const st = spawnSync('git', ['-C', WT, 'status', '--porcelain'], { encoding: 'utf8' }).stdout;
console.log('git status --porcelain:', JSON.stringify(st));
const green = runSuite(testFiles, `${S}/m1-restored.txt`);
console.log('post-restore counts:', JSON.stringify(green.nums));
