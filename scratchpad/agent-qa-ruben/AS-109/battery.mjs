// AS-109 cycle-2 review battery — qa-ruben. Runs in the detached scratch
// worktree only. Each mutant: edit favicon.svg by line anchor, ASSERT the
// mutation applied at the intended line (token count 0 -> 1 at that line,
// git diff --stat names exactly favicon.svg), run the full host suite,
// record the exact red set + first assertion line, restore, prove clean.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const S = '/tmp/AS-109-mutant';
const SVG = `${S}/apps/chat/public/favicon.svg`;
const TEST = 'apps/chat/test/api.test.js';
const LOG = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-109/battery.log';
const only = process.argv.slice(2);

const git = (...a) => spawnSync('git', ['-C', S, ...a], { encoding: 'utf8' });
const T3 = 'api: AS-28 — the favicon uses only palette hex values';
const T4 = 'api: AS-109 — the favicon carries no SMIL animation element';

// line numbers are 1-based as in `cat -n`
const A_PATH = 5, A_C1 = 6, LAST = 9; // line 9 = </svg>

const SET = '<set attributeName="fill" to="red"/>';
const ANIM = '<animate attributeName="fill" values="#1C41E3;red" dur="1s"/>';
const ANIMT = '<animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="1s"/>';

// mutant: { name, testFile: 'branch'|'master', expect: [] | [T3] | [T4], edit(lines) -> {line, token} }
const mutants = [
  { name: 'M1-control(master test)', testFile: 'master', expect: [], edit: m1 },
  { name: 'M1', testFile: 'branch', expect: [T3], edit: m1 },
  { name: 'M2', testFile: 'branch', expect: [T3], edit: (L) => rep(L, A_C1, 'fill="#FFFFFF"', "fill='red'") },
  { name: 'M3-on-master', testFile: 'master', expect: [T3], edit: (L) => rep(L, A_C1, 'fill="#FFFFFF"', "fill='#FFFFFF'") },
  { name: 'M3', testFile: 'branch', expect: [], edit: (L) => rep(L, A_C1, 'fill="#FFFFFF"', "fill='#FFFFFF'") },
  { name: 'M4-control(master test)', testFile: 'master', expect: [], edit: m4 },
  { name: 'M4', testFile: 'branch', expect: [T4], edit: m4 },
  { name: 'M5', testFile: 'branch', expect: [T4], edit: (L) => rep(L, A_C1, 'r="2.5"/>', `r="2.5">${ANIM}</circle>`) },
  { name: 'M6', testFile: 'branch', expect: [T4], edit: (L) => rep(L, A_C1, 'r="2.5"/>', `r="2.5">${ANIMT}</circle>`) },
  { name: 'M3a', testFile: 'branch', expect: [T3], edit: (L) => rep(L, A_PATH, 'fill="#1C41E3"', 'fill="#FF0000"') },
  { name: 'M3b', testFile: 'branch', expect: [T3], edit: (L) => {
      // every hex stripped file-wide; fills -> none. Anchor assert on A_PATH.
      for (let i = 0; i < L.length; i++) L[i] = L[i].replace(/#1C41E3|#FFFFFF/g, (m, off, s) => /fill="$/.test(s.slice(0, off)) ? 'none' : 'none');
      return { line: A_PATH, token: 'fill="none"', absentEverywhere: /#1C41E3|#FFFFFF/ };
    } },
  { name: 'M3c', testFile: 'branch', expect: [T3], edit: (L) => {
      L[A_PATH - 1] = L[A_PATH - 1].replace('fill="#1C41E3"', 'fill="red"');
      for (const i of [6, 7, 8]) L[i - 1] = L[i - 1].replace('fill="#FFFFFF"', 'fill="lime"');
      return { line: A_PATH, token: 'fill="red"' };
    } },
  { name: 'M3d', testFile: 'branch', expect: [T3], edit: (L) => rep(L, A_PATH, 'fill="#1C41E3"', 'fill="#1C41E3FF"') },
  { name: 'M3e', testFile: 'branch', expect: [T3], edit: (L) => {
      for (let i = 0; i < L.length; i++) L[i] = L[i].replace(/\s(fill|stroke)="[^"]*"/g, '');
      return { line: A_PATH, token: '<path d="M6', absentEverywhere: /\sfill=|\sstroke=/ };
    } },
  { name: 'M3f', testFile: 'branch', expect: [T3], edit: (L) => rep(L, A_PATH, '<path fill="#1C41E3"', '<path style="fill:red" fill="#1C41E3"') },
  { name: 'P1', testFile: 'branch', expect: [T3], edit: (L) => {
      assert.equal(L[LAST - 1], '</svg>');
      L.splice(LAST - 1, 0, '  <circle cx="16" cy="20" r="2"/>');
      return { line: LAST, token: '<circle cx="16" cy="20" r="2"/>' };
    } },
  { name: 'P1-control(unmutated branch)', testFile: 'branch', expect: [], edit: (L) => ({ line: A_PATH, token: '<path fill="#1C41E3"', noop: true }) },
];

function m1(L) {
  rep(L, A_PATH, '<path fill="#1C41E3"', '<path fill="#1C41E3" stroke="#1C41E3"');
  return rep(L, A_C1, 'fill="#FFFFFF"', "fill='red'");
}
function m4(L) { return rep(L, A_PATH, '4-4z"/>', `4-4z">${SET}</path>`); }
function rep(L, line, from, to) {
  const i = line - 1;
  assert.ok(L[i].includes(from), `${from} not on line ${line}: ${L[i]}`);
  L[i] = L[i].replace(from, to);
  return { line, token: to };
}

function countAt(text, line, token) {
  const L = text.split('\n');
  return (L[line - 1] ?? '').split(token).length - 1;
}

function run(m) {
  const orig = readFileSync(SVG, 'utf8');
  const L = orig.split('\n');
  const { line, token, absentEverywhere, noop } = m.edit(L);
  const mutated = L.join('\n');
  if (!noop) {
    assert.equal(countAt(orig, line, token), 0, `${m.name}: token already present on line ${line}`);
    assert.equal(countAt(mutated, line, token), 1, `${m.name}: token not applied exactly once on line ${line}`);
    if (absentEverywhere) assert.ok(!absentEverywhere.test(mutated), `${m.name}: leftover match`);
    writeFileSync(SVG, mutated);
  }
  if (m.testFile === 'master') assert.equal(git('checkout', 'dd6a41e', '--', TEST).status, 0);
  const stat = git('diff', 'HEAD', '--stat').stdout.trim();
  const files = (git('diff', 'HEAD', '--name-only').stdout.trim().split('\n').filter(Boolean));
  const expectFiles = [...(noop ? [] : ['apps/chat/public/favicon.svg']), ...(m.testFile === 'master' ? [TEST] : [])].sort();
  assert.deepEqual(files.sort(), expectFiles, `${m.name}: diff names ${files} expected ${expectFiles}`);
  const t0 = Date.now();
  const r = spawnSync('node', ['--test', '--test-reporter=spec'], { cwd: `${S}/apps/chat`, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout || '') + (r.stderr || '');
  const counts = {};
  for (const k of ['tests', 'pass', 'fail', 'skipped']) counts[k] = Number((out.match(new RegExp(`ℹ ${k} (\\d+)`)) || [])[1]);
  const lines = out.split('\n');
  const red = []; const msgs = [];
  for (let i = 0; i < lines.length; i++) {
    const mm = /^✖ (.+?) \(\d/.exec(lines[i]);
    if (mm && !red.includes(mm[1])) red.push(mm[1]);
    if (/^\s+AssertionError/.test(lines[i])) msgs.push(lines[i].trim());
  }
  // restore + prove clean
  git('checkout', 'HEAD', '--', '.');
  const clean = git('diff', 'HEAD', '--exit-code').status === 0 && git('status', '--short').stdout.trim() === '';
  const match = JSON.stringify(red) === JSON.stringify(m.expect);
  const rec = { name: m.name, testFile: m.testFile, line, applied: !noop, diff: stat.replace(/\n/g, ' | '), counts, exit: r.status, red, msgs, expect: m.expect, match, clean, ms: Date.now() - t0 };
  appendFileSync(LOG, JSON.stringify(rec) + '\n');
  console.log(`${match ? 'OK ' : '!! '} ${m.name.padEnd(28)} ${counts.tests}/${counts.pass}/${counts.fail}/${counts.skipped} red=${JSON.stringify(red)} clean=${clean}`);
  for (const s of msgs) console.log('      ' + s.slice(0, 200));
  assert.ok(clean, `${m.name}: tree not clean after restore`);
}

for (const m of mutants) if (!only.length || only.includes(m.name)) run(m);
