// AS-126 §3 mutant battery driver — developer-marcus. Runs against the detached
// scratch worktree /tmp/AS-126-mutant (never $W). Each run: apply, assert the
// token count went 0→1 ON THE ANCHORED LINE, assert `diff --name-only` names
// exactly the expected files, run the FULL host suite, record the red set, then
// `reset --hard HEAD` and assert porcelain is empty.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';

const S = '/tmp/AS-126-mutant';
const SVG = `${S}/apps/chat/public/favicon.svg`;
const TEST = `${S}/apps/chat/test/api.test.js`;
const LOG = '/Users/forrest/Code/american-software-company/scratchpad/agent-developer-marcus/AS-126/mutants.log';

const T3 = 'api: AS-28 — the favicon uses only palette hex values';
const T4 = 'api: AS-109 — the favicon carries no SMIL animation element';
const T5 = 'api: AS-126 — the favicon carries no filter element or filter= attribute';

const A_PATH = 'd="M6 3h20a4'; // survives every path-line mutation
const A_C1 = 'cx="9" cy="13"'; // survives every c1 mutation

function git(...args) {
  const r = spawnSync('git', ['-C', S, ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}
function log(s) { appendFileSync(LOG, s + '\n'); console.log(s); }

// Count occurrences of `token` on the single line containing `anchor` (or in the
// whole file when anchor is null). The line assertion is the "applied at the
// intended site" check from the AS-95 sharpening.
function countAt(file, anchor, token) {
  const text = readFileSync(file, 'utf8');
  if (anchor === null) return text.split(token).length - 1;
  const lines = text.split('\n').filter((l) => l.includes(anchor));
  if (lines.length !== 1) throw new Error(`anchor "${anchor}" matched ${lines.length} lines in ${file}`);
  return lines[0].split(token).length - 1;
}

function replaceOnce(file, from, to) {
  const text = readFileSync(file, 'utf8');
  const n = text.split(from).length - 1;
  if (n !== 1) throw new Error(`pattern "${from}" occurs ${n} times in ${file}, expected exactly 1`);
  writeFileSync(file, text.replace(from, to));
}

function runSuite() {
  const r = spawnSync('node', ['--test'], { cwd: `${S}/apps/chat`, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = r.stdout + r.stderr;
  const counts = {};
  for (const k of ['tests', 'pass', 'fail', 'skipped']) {
    const m = out.match(new RegExp(`^ℹ ${k} (\\d+)`, 'm'));
    counts[k] = m ? Number(m[1]) : null;
  }
  // The spec reporter (non-TTY default here) ends with a "✖ failing tests:"
  // section listing each failing test once, followed by its assertion line.
  const reds = [];
  const lines = out.split('\n');
  const start = lines.findIndex((l) => /^✖ failing tests:/.test(l));
  if (start >= 0) {
    for (let i = start + 1; i < lines.length; i++) {
      const m = lines[i].match(/^✖ (.+?)( \(\d[\d.]*ms\))?$/);
      if (!m) continue;
      let msg = '';
      for (let j = i + 1; j < Math.min(i + 12, lines.length); j++) {
        const mm = lines[j].match(/^\s+(\w*Error[^:]*: .*)$/);
        if (mm) { msg = mm[1]; break; }
      }
      reds.push({ name: m[1], msg });
    }
  }
  return { exit: r.status, counts, reds };
}

const runs = [
  { id: 'M1', anchor: A_C1, token: 'filter="drop-shadow', files: ['apps/chat/public/favicon.svg'],
    apply: () => replaceOnce(SVG, '<circle fill="#FFFFFF" cx="9"', '<circle fill="#FFFFFF" filter="drop-shadow(0 0 1px red)" cx="9"'),
    predict: [T5] },
  { id: 'M1-control', anchor: A_C1, token: 'filter="drop-shadow', files: ['apps/chat/public/favicon.svg', 'apps/chat/test/api.test.js'],
    apply: () => { git('checkout', 'master', '--', 'apps/chat/test/api.test.js'); replaceOnce(SVG, '<circle fill="#FFFFFF" cx="9"', '<circle fill="#FFFFFF" filter="drop-shadow(0 0 1px red)" cx="9"'); },
    predict: [], predictCounts: { tests: 613, pass: 611, fail: 0, skipped: 2 } },
  { id: 'M2', anchor: A_PATH, token: 'filter="url(#f)"', files: ['apps/chat/public/favicon.svg'],
    apply: () => replaceOnce(SVG, '  <path fill="#1C41E3" d=', '  <defs><filter id="f"><feColorMatrix type="hueRotate" values="180"/></filter></defs>\n  <path fill="#1C41E3" filter="url(#f)" d='),
    extraApplied: () => countAt(SVG, null, '<filter id="f">'),
    predict: [T5] },
  { id: 'M2-control', anchor: A_PATH, token: 'filter="url(#f)"', files: ['apps/chat/public/favicon.svg', 'apps/chat/test/api.test.js'],
    apply: () => { git('checkout', 'master', '--', 'apps/chat/test/api.test.js'); replaceOnce(SVG, '  <path fill="#1C41E3" d=', '  <defs><filter id="f"><feColorMatrix type="hueRotate" values="180"/></filter></defs>\n  <path fill="#1C41E3" filter="url(#f)" d='); },
    extraApplied: () => countAt(SVG, null, '<filter id="f">'),
    predict: [], predictCounts: { tests: 613, pass: 611, fail: 0, skipped: 2 } },
  { id: 'M3', anchor: A_C1, token: 'FILTER=', files: ['apps/chat/public/favicon.svg'],
    apply: () => replaceOnce(SVG, '<circle fill="#FFFFFF" cx="9"', '<circle fill="#FFFFFF" FILTER="drop-shadow(0 0 1px red)" cx="9"'),
    predict: [T5] },
  { id: 'M4', anchor: A_C1, token: 'filter = "', files: ['apps/chat/public/favicon.svg'],
    apply: () => replaceOnce(SVG, '<circle fill="#FFFFFF" cx="9"', '<circle fill="#FFFFFF" filter = "drop-shadow(0 0 1px red)" cx="9"'),
    predict: [T5] },
  { id: 'M5', anchor: A_C1, token: "filter='", files: ['apps/chat/public/favicon.svg'],
    apply: () => replaceOnce(SVG, '<circle fill="#FFFFFF" cx="9"', "<circle fill=\"#FFFFFF\" filter='drop-shadow(0 0 1px red)' cx=\"9\""),
    predict: [T5] },
  { id: 'M6', anchor: A_C1, token: 'style="filter:', files: ['apps/chat/public/favicon.svg'],
    apply: () => replaceOnce(SVG, '<circle fill="#FFFFFF" cx="9"', '<circle fill="#FFFFFF" style="filter:drop-shadow(0 0 1px red)" cx="9"'),
    predict: [T3] },
  { id: 'M7', anchor: A_PATH, token: 'color-interpolation-filters=', files: ['apps/chat/public/favicon.svg'],
    apply: () => replaceOnce(SVG, '<path fill="#1C41E3" d=', '<path color-interpolation-filters="linearRGB" fill="#1C41E3" d='),
    predict: [], predictCounts: { tests: 614, pass: 612, fail: 0, skipped: 2 } },
  { id: 'M8', anchor: 'AS-28 tab marker', token: 'filter="drop-shadow', files: ['apps/chat/public/favicon.svg'],
    apply: () => replaceOnce(SVG, '<!-- AS-28', '<!-- filter="drop-shadow(0 0 1px red)" AS-28'),
    predict: [], predictCounts: { tests: 614, pass: 612, fail: 0, skipped: 2 } },
  { id: 'R1', anchor: A_PATH, token: '<set ', files: ['apps/chat/public/favicon.svg'],
    apply: () => replaceOnce(SVG, '4-4z"/>', '4-4z"><set attributeName="fill" to="red"/></path>'),
    predict: [T4] },
  { id: 'G1', anchor: 'the artwork carries no filter element or filter= attribute, found', token: 'assert.ok(door,', files: ['apps/chat/test/api.test.js'],
    apply: () => replaceOnce(TEST, "assert.ok(!door, `the artwork carries no filter element", "assert.ok(door, `the artwork carries no filter element"),
    predict: [T5] },
  { id: 'Control', anchor: null, token: null, files: [],
    apply: () => {},
    predict: [], predictCounts: { tests: 614, pass: 612, fail: 0, skipped: 2 } },
];

const only = process.argv.slice(2);
writeFileSync(LOG, `# AS-126 mutant battery — ${new Date().toISOString()} — scratch ${S} at ${git('rev-parse', '--short', 'HEAD')}\n`);
const summary = [];
for (const run of runs) {
  if (only.length && !only.includes(run.id)) continue;
  log(`\n== ${run.id} ==`);
  if (git('status', '--porcelain')) throw new Error(`${run.id}: scratch not clean before apply`);
  const before = run.token ? countAt(run.anchor === null ? SVG : (run.id === 'G1' ? TEST : SVG), run.anchor, run.token) : 0;
  run.apply();
  const after = run.token ? countAt(run.anchor === null ? SVG : (run.id === 'G1' ? TEST : SVG), run.anchor, run.token) : 0;
  const extra = run.extraApplied ? run.extraApplied() : null;
  const changed = git('diff', 'HEAD', '--name-only').split('\n').filter(Boolean).sort();
  log(`applied: "${run.token}" on anchored line ${before}→${after}${extra !== null ? ` (+ "<filter id=\\"f\\">" whole-file count ${extra})` : ''}; diff --name-only = [${changed.join(', ')}]`);
  if (run.token && !(before === 0 && after === 1)) throw new Error(`${run.id}: mutation did not apply at the intended site (${before}→${after})`);
  if (changed.join(',') !== [...run.files].sort().join(',')) throw new Error(`${run.id}: unexpected changed files ${changed}`);
  const hunk = run.files.length ? git('diff', 'HEAD', '-U0', '--', ...run.files).split('\n').filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l)).join('\n') : '(none)';
  log(`hunk:\n${hunk}`);
  const res = runSuite();
  const redNames = res.reds.map((x) => x.name);
  const match = JSON.stringify([...redNames].sort()) === JSON.stringify([...run.predict].sort())
    && (!run.predictCounts || ['tests', 'pass', 'fail', 'skipped'].every((k) => res.counts[k] === run.predictCounts[k]));
  log(`suite: exit ${res.exit} ${res.counts.tests}/${res.counts.pass}/${res.counts.fail}/${res.counts.skipped}`);
  log(`red set (${res.reds.length}): ${res.reds.map((x) => `\n  - ${x.name}\n      ${x.msg}`).join('') || 'none'}`);
  log(`predicted: ${run.predict.length ? run.predict.join(' | ') : 'all green' + (run.predictCounts ? ` ${Object.values(run.predictCounts).join('/')}` : '')} → ${match ? 'MATCH' : 'MISMATCH'}`);
  git('reset', '--hard', 'HEAD');
  const dirty = git('status', '--porcelain');
  if (dirty) throw new Error(`${run.id}: scratch dirty after restore: ${dirty}`);
  log('restored: porcelain empty');
  summary.push({ id: run.id, counts: res.counts, reds: redNames, match });
}
log('\n== SUMMARY ==');
for (const s of summary) log(`${s.id}: ${Object.values(s.counts).join('/')} red=[${s.reds.map((n) => n === T3 ? 'T3' : n === T4 ? 'T4' : n === T5 ? 'T5' : n).join(', ')}] ${s.match ? 'MATCH' : 'MISMATCH'}`);
log(`runs ${summary.length}, mismatches ${summary.filter((s) => !s.match).length}`);
