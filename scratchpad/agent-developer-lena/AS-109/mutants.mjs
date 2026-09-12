// AS-109 mutant runner — agent:developer-lena. Runs on the detached scratch
// worktree /tmp/AS-109-mutant only. Each mutant: transform favicon.svg (or,
// for controls, swap api.test.js to master's), assert the mutation applied at
// the intended site, run the FULL host suite, record the exact failing set,
// restore, prove clean.
//
//   node mutants.mjs <name>...    (names below; "all" runs every one in order)
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';

const S = '/tmp/AS-109-mutant';
const CHAT = `${S}/apps/chat`;
const SVG = `${CHAT}/public/favicon.svg`;
const TEST = `${CHAT}/test/api.test.js`;
const LOG = new URL('./mutants-c1.log', import.meta.url).pathname;
const BRANCH = 'feat/AS-109-favicon-guard-quotes-smil';
const PREFIX = 'b01b4b8'; // cycle-0 tip: the branch test file before the F1 fix

const T3 = 'api: AS-28 — the favicon uses only palette hex values';
const T4 = 'api: AS-109 — the favicon carries no SMIL animation element';

// Anchors (plan §2): A-path = line 5, A-c1 = line 6 (1-based) of favicon.svg.
const A_PATH = 5, A_C1 = 6;

function git(...args) {
  const r = spawnSync('git', ['-C', S, ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

function lines() { return readFileSync(SVG, 'utf8').split('\n'); }
function setLine(n, fn) { const L = lines(); L[n - 1] = fn(L[n - 1]); writeFileSync(SVG, L.join('\n')); }
function countAt(n, token) { return lines()[n - 1].split(token).length - 1; }
function countFile(token) { return readFileSync(SVG, 'utf8').split(token).length - 1; }

// Each mutant: { edit(), applied() -> string describing the applied-assertion
// (throws if not applied), files: expected `diff --stat` names, predicted }.
const MUTANTS = {
  'M1-control': {
    desc: "M1 against master's api.test.js (control — expected all-green: the hole)",
    edit() {
      git('checkout', 'master', '--', 'apps/chat/test/api.test.js');
      setLine(A_PATH, l => l.replace('<path fill="#1C41E3"', '<path stroke="#1C41E3" fill="#1C41E3"'));
      setLine(A_C1, l => l.replace('fill="#FFFFFF"', "fill='red'"));
    },
    applied() {
      const t = readFileSync(TEST, 'utf8');
      if (t.includes('AS-109')) throw new Error('api.test.js is not master\'s');
      if (countAt(A_PATH, 'stroke="#1C41E3"') !== 1) throw new Error('stroke not at A-path');
      if (countAt(A_C1, "fill='red'") !== 1) throw new Error("fill='red' not at A-c1");
      return `api.test.js = master (no AS-109 marker); stroke at L${A_PATH} 0->1; fill='red' at L${A_C1} 0->1`;
    },
    files: ['apps/chat/public/favicon.svg', 'apps/chat/test/api.test.js'],
    predicted: [],
  },
  'M1': {
    desc: "A-path gains stroke=\"#1C41E3\"; A-c1 fill=\"#FFFFFF\" -> fill='red'",
    edit() {
      setLine(A_PATH, l => l.replace('<path fill="#1C41E3"', '<path stroke="#1C41E3" fill="#1C41E3"'));
      setLine(A_C1, l => l.replace('fill="#FFFFFF"', "fill='red'"));
    },
    applied() {
      if (countAt(A_PATH, 'stroke="#1C41E3"') !== 1) throw new Error('stroke not at A-path');
      if (countAt(A_C1, "fill='red'") !== 1) throw new Error("fill='red' not at A-c1");
      return `stroke at L${A_PATH} 0->1; fill='red' at L${A_C1} 0->1`;
    },
    predicted: [T3],
  },
  'M2': {
    desc: "A-c1 fill=\"#FFFFFF\" -> fill='red' only",
    edit() { setLine(A_C1, l => l.replace('fill="#FFFFFF"', "fill='red'")); },
    applied() {
      if (countAt(A_C1, "fill='red'") !== 1) throw new Error("fill='red' not at A-c1");
      return `fill='red' at L${A_C1} 0->1`;
    },
    predicted: [T3],
  },
  'M3': {
    desc: "A-c1 fill=\"#FFFFFF\" -> fill='#FFFFFF' (boundary — expected GREEN)",
    edit() { setLine(A_C1, l => l.replace('fill="#FFFFFF"', "fill='#FFFFFF'")); },
    applied() {
      if (countAt(A_C1, "fill='#FFFFFF'") !== 1) throw new Error("single-quoted fill not at A-c1");
      return `fill='#FFFFFF' at L${A_C1} 0->1`;
    },
    predicted: [],
  },
  'M4-control': {
    desc: "M4 against master's api.test.js (control — expected all-green: the hole)",
    edit() {
      git('checkout', 'master', '--', 'apps/chat/test/api.test.js');
      setLine(A_PATH, l => l.replace('-4z"/>', '-4z"><set attributeName="fill" to="red"/></path>'));
    },
    applied() {
      const t = readFileSync(TEST, 'utf8');
      if (t.includes('AS-109')) throw new Error('api.test.js is not master\'s');
      if (countAt(A_PATH, '<set attributeName="fill" to="red"/>') !== 1) throw new Error('set not at A-path');
      return `api.test.js = master; <set> at L${A_PATH} 0->1`;
    },
    files: ['apps/chat/public/favicon.svg', 'apps/chat/test/api.test.js'],
    predicted: [],
  },
  'M4': {
    desc: 'A-path ...v-4z"/> -> ...v-4z"><set attributeName="fill" to="red"/></path>',
    edit() { setLine(A_PATH, l => l.replace('-4z"/>', '-4z"><set attributeName="fill" to="red"/></path>')); },
    applied() {
      if (countAt(A_PATH, '<set attributeName="fill" to="red"/>') !== 1) throw new Error('set not at A-path');
      return `<set> at L${A_PATH} 0->1`;
    },
    predicted: [T4],
  },
  'M5': {
    desc: 'A-c1 becomes a container with <animate attributeName="fill" values="#1C41E3;red" dur="1s"/> as child',
    edit() { setLine(A_C1, l => l.replace('r="2.5"/>', 'r="2.5"><animate attributeName="fill" values="#1C41E3;red" dur="1s"/></circle>')); },
    applied() {
      if (countAt(A_C1, '<animate attributeName="fill"') !== 1) throw new Error('animate not at A-c1');
      return `<animate> at L${A_C1} 0->1`;
    },
    predicted: [T4],
  },
  'M6': {
    desc: 'as M5 with <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="1s"/>',
    edit() { setLine(A_C1, l => l.replace('r="2.5"/>', 'r="2.5"><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="1s"/></circle>')); },
    applied() {
      if (countAt(A_C1, '<animateTransform attributeName="transform"') !== 1) throw new Error('animateTransform not at A-c1');
      return `<animateTransform> at L${A_C1} 0->1`;
    },
    predicted: [T4],
  },
  'M2-master-extra': {
    desc: "EXTRA (not one of the 15): M2 against master's api.test.js — plan §2 says red via the floor at 3",
    edit() {
      git('checkout', 'master', '--', 'apps/chat/test/api.test.js');
      setLine(A_C1, l => l.replace('fill="#FFFFFF"', "fill='red'"));
    },
    applied() {
      if (readFileSync(TEST, 'utf8').includes('AS-109')) throw new Error('api.test.js is not master\'s');
      if (countAt(A_C1, "fill='red'") !== 1) throw new Error("fill='red' not at A-c1");
      return `api.test.js = master; fill='red' at L${A_C1} 0->1`;
    },
    files: ['apps/chat/public/favicon.svg', 'apps/chat/test/api.test.js'],
    predicted: [T3],
  },
  'M3-master-extra': {
    desc: "EXTRA (not one of the 15): M3 against master's api.test.js — plan §2 says red via the floor at 3",
    edit() {
      git('checkout', 'master', '--', 'apps/chat/test/api.test.js');
      setLine(A_C1, l => l.replace('fill="#FFFFFF"', "fill='#FFFFFF'"));
    },
    applied() {
      if (readFileSync(TEST, 'utf8').includes('AS-109')) throw new Error('api.test.js is not master\'s');
      if (countAt(A_C1, "fill='#FFFFFF'") !== 1) throw new Error('single-quoted fill not at A-c1');
      return `api.test.js = master; fill='#FFFFFF' at L${A_C1} 0->1`;
    },
    files: ['apps/chat/public/favicon.svg', 'apps/chat/test/api.test.js'],
    predicted: [T3],
  },
  'P1-control': {
    desc: "P1 against the PRE-FIX branch test file (b01b4b8) — control, expected all-green: Ruben's hole",
    edit() {
      git('checkout', PREFIX, '--', 'apps/chat/test/api.test.js');
      const L = lines(); L.splice(8, 0, '  <circle cx="16" cy="20" r="2"/>'); writeFileSync(SVG, L.join('\n'));
    },
    applied() {
      const t = readFileSync(TEST, 'utf8');
      if (t.includes('shape elements examined')) throw new Error('api.test.js is not b01b4b8\'s');
      if (!t.includes('AS-109')) throw new Error('api.test.js is not the branch\'s');
      if (countAt(9, '<circle cx="16" cy="20" r="2"/>') !== 1) throw new Error('paintless circle not at L9');
      if (/fill/.test(lines()[8])) throw new Error('L9 carries a fill');
      return `api.test.js = b01b4b8 (AS-109 marker, no shape floor); paintless <circle> at L9 0->1`;
    },
    files: ['apps/chat/public/favicon.svg', 'apps/chat/test/api.test.js'],
    predicted: [],
  },
  'P1': {
    desc: "Ruben F1: append '  <circle cx=\"16\" cy=\"20\" r=\"2\"/>' as L9 (no paint attribute)",
    edit() { const L = lines(); L.splice(8, 0, '  <circle cx="16" cy="20" r="2"/>'); writeFileSync(SVG, L.join('\n')); },
    applied() {
      if (countAt(9, '<circle cx="16" cy="20" r="2"/>') !== 1) throw new Error('paintless circle not at L9');
      if (/fill/.test(lines()[8])) throw new Error('L9 carries a fill');
      if (countFile('<circle') !== 4) throw new Error('expected 4 circles');
      return `paintless <circle> at L9 0->1; <circle x4, </svg> now L10`;
    },
    predicted: [T3],
  },
  'M3a': {
    desc: 'A-path fill -> #FF0000',
    edit() { setLine(A_PATH, l => l.replace('fill="#1C41E3"', 'fill="#FF0000"')); },
    applied() {
      if (countAt(A_PATH, 'fill="#FF0000"') !== 1) throw new Error('#FF0000 not at A-path');
      return `fill="#FF0000" at L${A_PATH} 0->1`;
    },
    predicted: [T3],
  },
  'M3b': {
    desc: 'every hex stripped file-wide (fills -> none; comment hex removed too)',
    edit() {
      const s = readFileSync(SVG, 'utf8').replace(/fill="#[0-9A-Fa-f]{6}"/g, 'fill="none"').replace(/#[0-9A-Fa-f]{6}/g, '');
      writeFileSync(SVG, s);
    },
    applied() {
      if (countFile('fill="none"') !== 4) throw new Error('expected 4 fill="none"');
      if (/#[0-9A-Fa-f]{6}/.test(readFileSync(SVG, 'utf8'))) throw new Error('hex survives');
      return 'fill="none" x4 (L5-L8); zero 6-hex strings file-wide (comment included)';
    },
    predicted: [T3],
  },
  'M3c': {
    desc: 'fills -> red (path) / lime (circles), comment intact',
    edit() {
      setLine(A_PATH, l => l.replace('fill="#1C41E3"', 'fill="red"'));
      for (const n of [6, 7, 8]) setLine(n, l => l.replace('fill="#FFFFFF"', 'fill="lime"'));
    },
    applied() {
      if (countAt(A_PATH, 'fill="red"') !== 1) throw new Error('red not at A-path');
      if (countFile('fill="lime"') !== 3) throw new Error('expected 3 lime');
      if (countFile('#1C41E3') !== 1 || countFile('#FFFFFF') !== 1) throw new Error('comment hex not intact');
      return `fill="red" at L${A_PATH}; fill="lime" x3 at L6-8; comment still carries #1C41E3 and #FFFFFF once each`;
    },
    predicted: [T3],
  },
  'M3d': {
    desc: 'A-path fill -> #1C41E3FF',
    edit() { setLine(A_PATH, l => l.replace('fill="#1C41E3"', 'fill="#1C41E3FF"')); },
    applied() {
      if (countAt(A_PATH, 'fill="#1C41E3FF"') !== 1) throw new Error('#1C41E3FF not at A-path');
      return `fill="#1C41E3FF" at L${A_PATH} 0->1`;
    },
    predicted: [T3],
  },
  'M3e': {
    desc: 'every paint attribute removed',
    edit() { writeFileSync(SVG, readFileSync(SVG, 'utf8').replace(/ fill="#[0-9A-Fa-f]{6}"/g, '')); },
    applied() {
      if (/\sfill\s*=/.test(readFileSync(SVG, 'utf8'))) throw new Error('a fill survives');
      if (countFile('<path d=') !== 1 || countFile('<circle cx=') !== 3) throw new Error('elements not intact');
      return 'zero fill= attributes; <path d= x1, <circle cx= x3 intact';
    },
    predicted: [T3],
  },
  'M3f': {
    desc: 'style="fill:red" added to A-path, fills intact',
    edit() { setLine(A_PATH, l => l.replace('<path fill="#1C41E3"', '<path style="fill:red" fill="#1C41E3"')); },
    applied() {
      if (countAt(A_PATH, 'style="fill:red"') !== 1) throw new Error('style not at A-path');
      if (countAt(A_PATH, 'fill="#1C41E3"') !== 1) throw new Error('A-path fill not intact');
      return `style="fill:red" at L${A_PATH} 0->1; fill="#1C41E3" still at L${A_PATH}`;
    },
    predicted: [T3],
  },
};

function runSuite() {
  const r = spawnSync('node', ['--test'], { cwd: CHAT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const out = r.stdout + r.stderr;
  const summary = Object.fromEntries(
    out.split('\n').filter(l => /^ℹ (tests|pass|fail|skipped) /.test(l)).map(l => { const [, k, v] = l.match(/^ℹ (\w+) (\d+)/); return [k, Number(v)]; })
  );
  // spec reporter: failing tests are "✖ <name> (ms)" lines at top level; also a
  // "✖ failing tests:" section repeats them. Collect unique names.
  const red = [...new Set(out.split('\n').filter(l => /^✖ /.test(l) && !/failing tests/.test(l)).map(l => l.replace(/^✖ /, '').replace(/ \([\d.]+ms\)$/, '')))];
  const messages = out.split('\n').filter(l => /paint attributes examined|shape elements examined|SMIL animation element|declares no style|is an SVG document/.test(l) && !/^\s*(\/\/|assert)/.test(l)).slice(0, 4);
  return { status: r.status, summary, red, messages };
}

function restore() {
  git('reset', '--hard', 'HEAD'); // index + worktree (the controls stage another commit's test file) — Ruben N4
  const clean = git('status', '--porcelain');
  if (clean.trim() !== '') throw new Error(`scratch not clean after restore:\n${clean}`);
  const head = git('rev-parse', 'HEAD').trim();
  const tip = git('rev-parse', BRANCH).trim();
  if (head !== tip) throw new Error(`scratch HEAD ${head} != branch tip ${tip}`);
}

function sameSet(a, b) { return a.length === b.length && a.every(x => b.includes(x)); }

const names = process.argv.slice(2).flatMap(n => n === 'all' ? Object.keys(MUTANTS) : [n]);
for (const name of names) {
  const m = MUTANTS[name];
  if (!m) throw new Error(`unknown mutant ${name}`);
  restore();
  let report;
  try {
    m.edit();
    const applied = m.applied();
    const stat = git('diff', 'HEAD', '--name-only').trim().split('\n').filter(Boolean);
    const expectFiles = m.files || ['apps/chat/public/favicon.svg'];
    if (!sameSet(stat, expectFiles)) throw new Error(`diff names ${stat.join(',')} not ${expectFiles.join(',')}`);
    const { status, summary, red, messages } = runSuite();
    const match = sameSet(red, m.predicted);
    report = [
      `## ${name} — ${m.desc}`,
      `applied: ${applied}; diff --name-only = ${stat.join(', ')}`,
      `suite: exit ${status}; tests ${summary.tests} pass ${summary.pass} fail ${summary.fail} skipped ${summary.skipped}`,
      `red set (${red.length}): ${red.length ? red.map(r => `"${r}"`).join(', ') : '{} (all green)'}`,
      `predicted (${m.predicted.length}): ${m.predicted.length ? m.predicted.map(r => `"${r}"`).join(', ') : '{} (all green)'}`,
      `verdict: ${match ? 'AS PREDICTED' : 'MISMATCH — finding'}`,
      messages.length ? `messages: ${messages.map(s => s.trim()).join(' | ')}` : 'messages: (none matched)',
      '',
    ].join('\n');
  } finally {
    restore();
  }
  report += `restored: status --porcelain empty, HEAD == ${BRANCH}\n\n`;
  appendFileSync(LOG, report);
  process.stdout.write(report);
}
