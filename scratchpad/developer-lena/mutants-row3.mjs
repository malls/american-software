// AS-100 cycle 4 mutation battery (developer-lena). Run from apps/chat inside
// the worktree:  node ../../../scratchpad/developer-lena/mutants-row3.mjs
// Each mutant: anchor to a pattern that can only hit the intended site, assert
// it applied THERE, print the applied-site diff, run test/stream.test.js, record
// the exact red set, restore, prove the tree clean.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const SERVER = 'server.js';
const original = readFileSync(SERVER, 'utf8');

const MUTANTS = [
  {
    name: 'M1 revert the priming order (AC-17 falsifier)',
    edits: [
      ['  tailEvents();\n\n  // AS-99: lanes push, change-only.', '  // AS-99: lanes push, change-only.'],
      ['  const eventsPoll = setInterval(() => {', '  tailEvents();\n  const eventsPoll = setInterval(() => {'],
    ],
  },
  {
    name: 'M2 include elapsedS in lanesKey (AC-17)',
    edits: [[
      '            lastEventId: lane.subAgent.lastEvent && lane.subAgent.lastEvent.id,\n',
      '            lastEventId: lane.subAgent.lastEvent && lane.subAgent.lastEvent.id,\n            elapsedS: lane.subAgent.elapsedS,\n',
    ]],
  },
  {
    name: 'M3 re-emit the last batch every poll (AC-13)',
    edits: [[
      '    if (!fresh.length) return;\n',
      '    if (!fresh.length) fresh = globalThis.__lastFresh || [];\n    else globalThis.__lastFresh = fresh;\n    if (!fresh.length) return;\n',
    ]],
  },
  {
    name: 'M4 throw instead of reporting truncation (AC-14)',
    edits: [[
      "    if (size < eventsTail.offset) {\n      resetTail('truncated');",
      "    if (size < eventsTail.offset) {\n      throw new Error('mutant: truncated');",
    ]],
  },
];

const runTests = () => {
  const r = spawnSync('node', ['--test', '--test-reporter=tap', 'test/stream.test.js'], { encoding: 'utf8' });
  const red = (r.stdout || '')
    .split('\n')
    .filter((l) => /^not ok \d+ - /.test(l))
    .map((l) => l.replace(/^not ok \d+ - /, '').trim());
  return { red, code: r.status };
};

for (const mut of MUTANTS) {
  let src = original;
  let ok = true;
  for (const [from, to] of mut.edits) {
    const hits = src.split(from).length - 1;
    if (hits !== 1) {
      console.log(`\n### ${mut.name}\n  ANCHOR FAILED: ${hits} matches for a pattern that must hit exactly one site`);
      ok = false;
      break;
    }
    src = src.replace(from, to);
  }
  if (!ok) continue;
  writeFileSync(SERVER, src);
  // applied-site diff, from git itself — the tree is the only witness that counts
  const diff = spawnSync('git', ['diff', '-U1', '--', 'server.js'], { encoding: 'utf8' }).stdout;
  console.log(`\n### ${mut.name}`);
  console.log(diff.split('\n').filter((l) => /^[-+@]/.test(l) && !/^[-+]{3}/.test(l)).join('\n'));
  const { red, code } = runTests();
  console.log(`  exit ${code}; red set (${red.length}): ${red.length ? red.map((n) => n.split(':')[0]).join(' | ') : 'NONE — SURVIVOR'}`);
  writeFileSync(SERVER, original);
  const clean = spawnSync('git', ['diff', '--exit-code', '--', 'server.js']).status;
  console.log(`  restored, git diff --exit-code: ${clean === 0 ? 'clean' : 'DIRTY'}`);
}
