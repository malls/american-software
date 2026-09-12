// AS-80 mutation driver — agent:qa-ruben. One indivisible step per mutant:
// backup (outside the scanned tree) -> mutate -> assert applied AT THE SITE ->
// observe -> restore (finally) -> hash === before -> git porcelain empty -> green re-run.
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = '/Users/forrest/Code/american-software-company';
const W = `${ROOT}/.worktrees/AS-80/apps/chat`;
const F = `${W}/server.js`;
const SCRATCH = `${ROOT}/scratchpad/agent-qa-ruben/AS-80`;
const name = process.argv[2];
const ALL = fs.readdirSync(`${W}/test`).filter((f) => f.endsWith('.test.js')).sort().map((f) => `${W}/test/${f}`);
if (ALL.length < 10) throw new Error(`expected many test files, got ${ALL.length}`);

const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const count = (s, needle) => s.split(needle).length - 1;
const between = (s, a, b) => {
  const i = s.indexOf(a); const j = s.indexOf(b, i + a.length);
  if (i < 0 || j < 0) throw new Error(`anchor missing: ${a} / ${b}`);
  return s.slice(i + a.length, j);
};

const MUTANTS = {
  // Plan §6 M1: delete the whole line containing clearInterval(loopPoll) inside close().
  M1: {
    mutate: (s) => s.replace(/^[ \t]*clearInterval\(loopPoll\);.*\n/m, ''),
    assertApplied: (before, after) => {
      if (count(before, 'clearInterval(loopPoll)') !== 1) throw new Error('precondition: needle not unique');
      if (count(after, 'clearInterval(loopPoll)') !== 0) throw new Error('M1 not applied');
      const slice = between(after, 'clearInterval(heartbeat);', 'clearInterval(lanesPoll);');
      if (slice.includes('loopPoll')) throw new Error('M1 applied off-site');
      if (count(after, 'const loopPoll = setInterval(') !== 1) throw new Error('M1 damaged arming site');
    },
    run: ['--test', ...ALL], whole: true,
    predicted: 'exactly {T1}; 479/1; T1 message names 1 leaked; failure from step 6 (inclusion), not step 4 (count)',
  },
  // Plan §6 M2: delete clearInterval(heartbeat); — narrowed run only (heartbeat is ref'd; AS-25 case would wedge the runner).
  M2: {
    mutate: (s) => s.replace(/^[ \t]*clearInterval\(heartbeat\);.*\n/m, ''),
    assertApplied: (before, after) => {
      if (count(before, 'clearInterval(heartbeat)') !== 1) throw new Error('precondition: needle not unique');
      if (count(after, 'clearInterval(heartbeat)') !== 0) throw new Error('M2 not applied');
      const slice = between(after, 'stream responses would otherwise wedge', 'clearInterval(loopPoll)');
      if (slice.includes('heartbeat')) throw new Error('M2 applied off-site');
    },
    run: ['--test', '--test-name-pattern', 'AS-80', `${W}/test/stream.test.js`], whole: false,
    predicted: 'T1 red, 1 leaked, process exits',
  },
  // Ruben M3 (plan §10 suggestion, not in §6): clear loopPoll twice, lanesPoll never. Count of clearInterval calls stays 4.
  M3: {
    mutate: (s) => s.replace(/^([ \t]*)clearInterval\(lanesPoll\);(.*)\n/m, '$1clearInterval(loopPoll);$2\n'),
    assertApplied: (before, after) => {
      if (count(before, 'clearInterval(lanesPoll)') !== 1) throw new Error('precondition');
      if (count(after, 'clearInterval(lanesPoll)') !== 0) throw new Error('M3 not applied');
      if (count(after, 'clearInterval(loopPoll)') !== 2) throw new Error('M3 loopPoll not doubled');
      const slice = between(after, 'clearInterval(heartbeat);', 'clearInterval(eventsPoll);');
      if (count(slice, 'clearInterval(loopPoll)') !== 2 || slice.includes('lanesPoll')) throw new Error('M3 applied off-site');
      if (count(after, 'clearInterval(') !== count(before, 'clearInterval(')) throw new Error('M3 changed call count');
    },
    run: ['--test', ...ALL], whole: true,
    predicted: 'exactly {T1}; 479/1; 1 leaked (lanesPoll) — a count-based guard would pass',
  },
  // Ruben M4 (plan §10 suggestion): arm a fifth, unref'd interval in the constructor, never cleared.
  M4: {
    mutate: (s) => s.replace(/^([ \t]*)eventsPoll\.unref\(\);\n/m, '$1eventsPoll.unref();\n$1setInterval(() => {}, 1_000_000).unref(); // M4 mutant\n'),
    assertApplied: (before, after) => {
      if (count(before, 'eventsPoll.unref();') !== 1) throw new Error('precondition');
      if (count(after, '// M4 mutant') !== 1) throw new Error('M4 not applied');
      const slice = between(after, 'eventsPoll.unref();', 'const RAW_TEXT');
      if (!slice.includes('// M4 mutant')) throw new Error('M4 applied off-site');
      if (count(after, 'setInterval(') !== count(before, 'setInterval(') + 1) throw new Error('M4 arm count wrong');
    },
    run: ['--test', ...ALL], whole: true,
    predicted: 'exactly {T1}; 479/1; red from step 4 count pin (5 !== 4), before the inclusion check',
  },
};

const m = MUTANTS[name];
if (!m) { console.error('unknown mutant', name); process.exit(2); }

const run = (args, label) => {
  const r = spawnSync('node', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 180_000 });
  const out = (r.stdout || '') + (r.stderr || '');
  fs.writeFileSync(`${SCRATCH}/${name}-${label}.txt`, out + `\n===STATUS ${r.status} SIGNAL ${r.signal}===\n`);
  const tail = out.split('\n').filter((l) => /^ℹ (tests|pass|fail|cancelled)/.test(l)).join(' | ');
  const failing = out.split('\n').filter((l) => /^✖ /.test(l)).map((l) => l.replace(/\s*\([\d.]+ms\)\s*$/, '').trim());
  const notOk = out.split('\n').filter((l) => /^not ok/.test(l));
  return { status: r.status, signal: r.signal, tail, failing: [...new Set(failing)], notOk, out };
};

const hashBefore = sha(F);
const before = fs.readFileSync(F, 'utf8');
const backup = `${SCRATCH}/server.js.${name}.orig`;
fs.copyFileSync(F, backup);
console.log(`[${name}] hash before: ${hashBefore}`);
console.log(`[${name}] predicted: ${m.predicted}`);
let observed;
try {
  const after = m.mutate(before);
  if (after === before) throw new Error('mutation produced no change');
  fs.writeFileSync(F, after);
  m.assertApplied(before, fs.readFileSync(F, 'utf8'));
  console.log(`[${name}] mutation applied at the intended site (asserted)`);
  observed = run(m.run, 'observe');
  console.log(`[${name}] observed: ${observed.tail} | status=${observed.status} signal=${observed.signal}`);
  console.log(`[${name}] failing set (${observed.failing.length}): ${JSON.stringify(observed.failing)}`);
  const msgs = observed.out.split('\n').filter((l) => /leaked|interval\(s\) armed|update this number|Expected values to be strictly equal|\+ actual|- expected|^\s*[+-] \d/.test(l)).slice(0, 12);
  console.log(`[${name}] failure lines:\n  ${msgs.join('\n  ')}`);
} finally {
  fs.copyFileSync(backup, F);
  fs.unlinkSync(backup);
  const hashAfter = sha(F);
  console.log(`[${name}] hash after:  ${hashAfter} (${hashAfter === hashBefore ? 'IDENTICAL' : 'MISMATCH!'})`);
  const st = spawnSync('git', ['-C', `${ROOT}/.worktrees/AS-80`, 'status', '--porcelain'], { encoding: 'utf8' });
  console.log(`[${name}] git porcelain: ${JSON.stringify(st.stdout)} (${st.stdout.trim() === '' ? 'CLEAN' : 'DIRTY!'})`);
  const green = run(['--test', ...ALL], 'restored');
  console.log(`[${name}] post-restore whole suite: ${green.tail} | status=${green.status}`);
}
