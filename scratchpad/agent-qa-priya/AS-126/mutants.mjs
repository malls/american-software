// AS-126 review mutant battery — agent:qa-priya. Runs on the detached scratch
// worktree /tmp/AS-126-mutant, never on $W. Each run: reset scratch to HEAD,
// optionally swap in master's api.test.js, apply an ANCHORED mutation via
// string replace (must match exactly once), assert applied at the intended
// site (token count 0->1 on the anchored line; git diff --name-only names the
// exact expected files), run the FULL host suite, record summary + failing
// test names.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';

const S = '/tmp/AS-126-mutant';
const APP = S + '/apps/chat';
const SVG = APP + '/public/favicon.svg';
const TEST = APP + '/test/api.test.js';
const LOG = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/AS-126/mutants.log';
const FULL = !process.argv.includes('--subset');
const only = process.argv.filter(a => !a.startsWith('--')).slice(2);

const PATH_ANCHOR = '<path fill="#1C41E3" d=';
const C1_ANCHOR = '<circle fill="#FFFFFF" cx="9"';

function git(...args) {
  const r = spawnSync('git', ['-C', S, ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function replaceOnce(file, from, to, label) {
  const src = readFileSync(file, 'utf8');
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`${label}: anchor "${from}" matched ${n} times in ${file}, expected 1`);
  writeFileSync(file, src.replace(from, to));
}

function countOn(file, token) {
  return readFileSync(file, 'utf8').split(token).length - 1;
}

function lineOf(file, token) {
  const lines = readFileSync(file, 'utf8').split('\n');
  return lines.findIndex(l => l.includes(token)) + 1;
}

const runs = {
  Control: { desc: 'unmutated branch tip', files: [] },
  M1: { desc: 'A-c1 filter="drop-shadow" attr', svgFrom: C1_ANCHOR, svgTo: '<circle fill="#FFFFFF" filter="drop-shadow(0 0 1px red)" cx="9"', token: 'filter="drop-shadow', anchorLine: 6, files: ['apps/chat/public/favicon.svg'] },
  'M1-control': { desc: 'M1 with master api.test.js', swap: true, svgFrom: C1_ANCHOR, svgTo: '<circle fill="#FFFFFF" filter="drop-shadow(0 0 1px red)" cx="9"', token: 'filter="drop-shadow', anchorLine: 6, files: ['apps/chat/public/favicon.svg', 'apps/chat/test/api.test.js'] },
  M2: { desc: 'A-path <defs><filter> + filter="url(#f)"', svgFrom: PATH_ANCHOR, svgTo: '<defs><filter id="f"><feColorMatrix type="hueRotate" values="180"/></filter></defs>\n  <path fill="#1C41E3" filter="url(#f)" d=', token: '<filter id="f">', anchorLine: 5, files: ['apps/chat/public/favicon.svg'] },
  'M2-control': { desc: 'M2 with master api.test.js', swap: true, svgFrom: PATH_ANCHOR, svgTo: '<defs><filter id="f"><feColorMatrix type="hueRotate" values="180"/></filter></defs>\n  <path fill="#1C41E3" filter="url(#f)" d=', token: '<filter id="f">', anchorLine: 5, files: ['apps/chat/public/favicon.svg', 'apps/chat/test/api.test.js'] },
  M3: { desc: 'A-c1 FILTER= uppercase', svgFrom: C1_ANCHOR, svgTo: '<circle fill="#FFFFFF" FILTER="drop-shadow(0 0 1px red)" cx="9"', token: 'FILTER=', anchorLine: 6, files: ['apps/chat/public/favicon.svg'] },
  M4: { desc: 'A-c1 filter = "..." spaced', svgFrom: C1_ANCHOR, svgTo: '<circle fill="#FFFFFF" filter = "drop-shadow(0 0 1px red)" cx="9"', token: 'filter = "', anchorLine: 6, files: ['apps/chat/public/favicon.svg'] },
  M5: { desc: "A-c1 filter='...' single-quoted", svgFrom: C1_ANCHOR, svgTo: "<circle fill=\"#FFFFFF\" filter='drop-shadow(0 0 1px red)' cx=\"9\"", token: "filter='", anchorLine: 6, files: ['apps/chat/public/favicon.svg'] },
  M6: { desc: 'A-c1 style="filter:..." (narrowness)', svgFrom: C1_ANCHOR, svgTo: '<circle fill="#FFFFFF" style="filter:drop-shadow(0 0 1px red)" cx="9"', token: 'style="filter:', anchorLine: 6, files: ['apps/chat/public/favicon.svg'] },
  M7: { desc: 'A-path color-interpolation-filters= (precision, expect green)', svgFrom: PATH_ANCHOR, svgTo: '<path color-interpolation-filters="linearRGB" fill="#1C41E3" d=', token: 'color-interpolation-filters=', anchorLine: 5, files: ['apps/chat/public/favicon.svg'] },
  M8: { desc: 'filter= inside the XML comment (precision, expect green)', svgFrom: '<!-- AS-28', svgTo: '<!-- filter="drop-shadow(0 0 1px red)" AS-28', token: 'filter="drop-shadow', anchorLine: 2, files: ['apps/chat/public/favicon.svg'] },
  R1: { desc: 'A-path <set> SMIL child (regression T4)', svgFrom: '4-4z"/>', svgTo: '4-4z"><set attributeName="fill" to="red"/></path>', token: '<set ', anchorLine: 5, files: ['apps/chat/public/favicon.svg'] },
  G1: { desc: 'guard-on-guard: T5 assert.ok(!door -> assert.ok(door', testFrom: 'assert.ok(!door,', testTo: 'assert.ok(door,', token: 'assert.ok(door,', files: ['apps/chat/test/api.test.js'] },
  // --- Priya's §6 probes (beyond the plan's list) ---
  P1: { desc: '<style>circle{filter:...}</style> element (expect {T3}, T5 green)', svgFrom: PATH_ANCHOR, svgTo: '<style>circle{filter:drop-shadow(0 0 1px red)}</style>\n  <path fill="#1C41E3" d=', token: '<style>circle{filter:', anchorLine: 5, files: ['apps/chat/public/favicon.svg'] },
  P2: { desc: 'bare <filter> at root (no defs) + url(#f)', svgFrom: PATH_ANCHOR, svgTo: '<filter id="f"><feColorMatrix type="hueRotate" values="180"/></filter>\n  <path fill="#1C41E3" filter="url(#f)" d=', token: '<filter id="f">', anchorLine: 5, files: ['apps/chat/public/favicon.svg'] },
  P3: { desc: '<filter/> self-closing, no attribute use', svgFrom: PATH_ANCHOR, svgTo: '<filter/>\n  <path fill="#1C41E3" d=', token: '<filter/>', anchorLine: 5, files: ['apps/chat/public/favicon.svg'] },
  P4: { desc: 'false positive: aria-label value contains " filter=x"', svgFrom: 'aria-label="ASC Chat"', svgTo: 'aria-label="ASC Chat filter=x"', token: 'filter=x', anchorLine: 1, files: ['apps/chat/public/favicon.svg'] },
  P5: { desc: 'sibling door: mask="url(#m)" with <mask> (expect survivor -> record)', svgFrom: PATH_ANCHOR, svgTo: '<defs><mask id="m"><rect width="32" height="32" fill="#FFFFFF"/></mask></defs>\n  <path fill="#1C41E3" mask="url(#m)" d=', token: 'mask="url(#m)"', anchorLine: 6, files: ['apps/chat/public/favicon.svg'] },
  P6: { desc: 'sibling door: opacity="0.2" on path (expect survivor -> record)', svgFrom: PATH_ANCHOR, svgTo: '<path opacity="0.2" fill="#1C41E3" d=', token: 'opacity="0.2"', anchorLine: 5, files: ['apps/chat/public/favicon.svg'] },
  P7: { desc: '<feDropShadow/> bare outside any <filter> (expect green: inert)', svgFrom: PATH_ANCHOR, svgTo: '<feDropShadow dx="0" dy="0" stdDeviation="1"/>\n  <path fill="#1C41E3" d=', token: '<feDropShadow', anchorLine: 5, files: ['apps/chat/public/favicon.svg'] },
  P8: { desc: '<feFlood flood-color="red"/> bare (expect {T3})', svgFrom: PATH_ANCHOR, svgTo: '<feFlood flood-color="red"/>\n  <path fill="#1C41E3" d=', token: '<feFlood', anchorLine: 5, files: ['apps/chat/public/favicon.svg'] },
  P9: { desc: 'case: <Filter id="f"> element + Filter= attr', svgFrom: PATH_ANCHOR, svgTo: '<Filter id="f"><feColorMatrix type="hueRotate" values="180"/></Filter>\n  <path fill="#1C41E3" Filter="url(#f)" d=', token: '<Filter id="f">', anchorLine: 5, files: ['apps/chat/public/favicon.svg'] },
  P10: { desc: 'filter= as FIRST thing after tab/newline separator (\\n\\tfilter=)', svgFrom: C1_ANCHOR, svgTo: '<circle fill="#FFFFFF"\n\tfilter="drop-shadow(0 0 1px red)" cx="9"', token: '\tfilter="drop-shadow', anchorLine: 7, files: ['apps/chat/public/favicon.svg'] },
  P11: { desc: 'svg:filter prefixed element (adversarial, recorded out of scope; expect survivor)', svgFrom: PATH_ANCHOR, svgTo: '<svg:filter id="f"><feColorMatrix type="hueRotate" values="180"/></svg:filter>\n  <path fill="#1C41E3" filter="url(#f)" d=', token: '<svg:filter id="f">', anchorLine: 5, files: ['apps/chat/public/favicon.svg'] },
  P13: { desc: 'svg:filter element + svg:filter= prefixed ATTRIBUTE (adversarial; expect survivor — a namespaced attr is not a presentation attribute)', svgFrom: PATH_ANCHOR, svgTo: '<svg:filter id="f"><feColorMatrix type="hueRotate" values="180"/></svg:filter>\n  <path fill="#1C41E3" svg:filter="url(#f)" d=', token: '<svg:filter id="f">', anchorLine: 5, files: ['apps/chat/public/favicon.svg'] },
  P14: { desc: 'fill-opacity="0.3" on circle (sibling of P6, expect survivor)', svgFrom: C1_ANCHOR, svgTo: '<circle fill="#FFFFFF" fill-opacity="0.3" cx="9"', token: 'fill-opacity=', anchorLine: 6, files: ['apps/chat/public/favicon.svg'] },
  P12: { desc: 'filter attr with NO whitespace before it after a quoted value? (filter= glued: fill="#FFFFFF"filter=) — malformed XML, expect survivor?', svgFrom: C1_ANCHOR, svgTo: '<circle fill="#FFFFFF"filter="drop-shadow(0 0 1px red)" cx="9"', token: '"filter="drop-shadow', anchorLine: 6, files: ['apps/chat/public/favicon.svg'] },
};

function runSuite() {
  const args = FULL ? ['--test'] : ['--test', '--test-name-pattern', 'favicon', 'test/api.test.js'];
  const r = spawnSync('node', args, { cwd: APP, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env } });
  const out = r.stdout + '\n' + r.stderr;
  const sum = {};
  for (const k of ['tests', 'pass', 'fail', 'skipped']) {
    const m = out.match(new RegExp(`^ℹ ${k} (\\d+)`, 'm'));
    sum[k] = m ? Number(m[1]) : null;
  }
  // failing test names + first message line
  const fails = [];
  const tail = out.slice(out.indexOf('✖ failing tests:'));
  const re = /^\s*✖ (.+?) \([\d.]+ms\)$/gm;
  let m;
  while ((m = re.exec(tail))) {
    const name = m[1].trim();
    const after = tail.slice(m.index, m.index + 4000);
    const msg = after.match(/AssertionError \[ERR_ASSERTION\]: (.+)/) || after.match(/(?:Error|error):\s*(.+)/);
    fails.push(`${name} :: ${msg ? msg[1].trim().slice(0, 200) : '(no message parsed)'}`);
  }
  return { exit: r.status, sum, fails };
}

const list = only.length ? only : Object.keys(runs);
for (const id of list) {
  const run = runs[id];
  if (!run) throw new Error('unknown run ' + id);
  git('reset', '--hard', 'HEAD');
  git('clean', '-fdq');
  let applied = '';
  if (run.swap) git('checkout', 'master', '--', 'apps/chat/test/api.test.js');
  if (run.svgFrom) {
    const before = countOn(SVG, run.token);
    replaceOnce(SVG, run.svgFrom, run.svgTo, id);
    const after = countOn(SVG, run.token);
    const line = lineOf(SVG, run.token);
    if (!(before === 0 && after === 1)) throw new Error(`${id}: token count ${before}->${after}, expected 0->1`);
    if (run.anchorLine && line !== run.anchorLine) throw new Error(`${id}: token landed on line ${line}, expected ${run.anchorLine}`);
    applied += `svg token "${run.token}" ${before}->${after} at line ${line}; `;
  }
  if (run.testFrom) {
    const before = countOn(TEST, run.token);
    replaceOnce(TEST, run.testFrom, run.testTo, id);
    const after = countOn(TEST, run.token);
    const line = lineOf(TEST, run.token);
    if (!(before === 0 && after === 1)) throw new Error(`${id}: test token count ${before}->${after}`);
    // must be inside T5's body: after T5's title line
    const t5 = lineOf(TEST, "test('api: AS-126 —");
    if (!(line > t5 && line < t5 + 20)) throw new Error(`${id}: mutation at line ${line} not inside T5 (title at ${t5})`);
    applied += `test token "${run.token}" ${before}->${after} at line ${line} (T5 title line ${t5}); `;
  }
  const changed = git('diff', 'HEAD', '--name-only').split('\n').filter(Boolean).sort();
  const expected = [...run.files].sort();
  if (JSON.stringify(changed) !== JSON.stringify(expected)) throw new Error(`${id}: diff names ${changed} expected ${expected}`);
  applied += `diff --name-only = [${changed.join(', ')}]`;
  const t0 = Date.now();
  const res = runSuite();
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  const line = `${id} | ${run.desc}\n  applied: ${applied}\n  ${FULL ? 'FULL' : 'SUBSET'} exit=${res.exit} tests/pass/fail/skipped=${res.sum.tests}/${res.sum.pass}/${res.sum.fail}/${res.sum.skipped} (${secs}s)\n  red set: ${res.fails.length ? '\n    ' + res.fails.join('\n    ') : '{} (all green)'}\n`;
  console.log(line);
  appendFileSync(LOG, line + '\n');
  git('reset', '--hard', 'HEAD');
  git('clean', '-fdq');
  const clean = git('status', '--porcelain');
  if (clean) throw new Error(`${id}: scratch not clean after restore: ${clean}`);
}
console.log('scratch clean after last run:', git('status', '--porcelain') === '' ? 'yes' : 'NO');
