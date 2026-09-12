// AS-108 review: plan §3 mutant battery, run in a scratch copy (never the worktree).
// Each mutant: fresh copy, anchored replacement, assert exactly one hit at the intended
// site, run the three test files that import the changed symbols, record the red set.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const M = '/Users/forrest/Code/american-software-company';
const SRC = M + '/.worktrees/AS-108/apps/chat';
const SCRATCH = '/tmp/as108-ruben-mut';
const W = 'watch/advance-watcher.mjs';
const L = 'lib/lanes.js';
const TESTS = ['test/lanes.test.js', 'test/watcher-lanes.test.js', 'test/api.test.js'];

// Anchored: `within` is a regex that must match exactly once and the mutation is
// applied inside that match only, so the edit cannot land at a sibling site.
const mutants = [
  { id: 'M1', file: W, within: /async function evaluate\(\)[\s\S]*?const root = canonRoot\(\);\n(\s*)const list = git\(\['worktree', 'list'/, find: 'const root = canonRoot();', repl: 'const root = repoRoot;', expect: ['T1', 'T6'] },
  { id: 'M2', file: W, within: /async function evaluate\(\)[\s\S]*?const root = canonRoot\(\);\n(\s*)const list = git\(\['worktree', 'list'/, find: 'const root = canonRoot();', repl: 'const root = ROOT_ONCE;', extra: (s) => s.replace(/(\n  function persist\(body\) \{)/, '\n  const ROOT_ONCE = canonRoot();$1'), expect: ['T1'] },
  { id: 'M3a', file: W, within: /function canonRoot\(\) \{[\s\S]*?return repoRoot;\n\s*\}\n\s*\}/, find: 'return repoRoot;', repl: "return '';", expect: ['T2'] },
  { id: 'M3b', file: W, within: /function canonRoot\(\) \{[\s\S]*?if \(lastRealpathWarn !== key\) \{/, find: 'if (lastRealpathWarn !== key) {', repl: 'if (true) {', expect: ['T2'] },
  { id: 'M5', file: W, within: /export function makeLanesOps\(\{[\s\S]*?realpath = defaultRealpath,/, find: 'realpath = defaultRealpath,', repl: 'realpath = (p) => p,', expect: ['T6'] },
  { id: 'M6', file: W, within: /export function relPathOf\([\s\S]*?return `\$\{OUTSIDE_REPO\}\/\$\{base\}#\$\{digest\}`;/, find: 'return `${OUTSIDE_REPO}/${base}#${digest}`;', repl: 'return `${OUTSIDE_REPO}/${base}`;', expect: ['T3', 'T4', 'outside-repo'] },
  { id: 'M7', file: W, within: /export function relPathOf\([\s\S]*?\.update\(stripped\)/, find: '.update(stripped)', repl: '.update(p)', expect: ['T4', 'outside-repo'] },
  { id: 'M8', file: W, within: /export function relPathOf\([\s\S]*?\.digest\('hex'\)\.slice\(0, 8\);/, find: ".digest('hex').slice(0, 8);", repl: ".digest('hex').slice(0, 8).replace(/./, () => Math.random().toString(16).slice(2, 3));", expect: ['T4', 'outside-repo'] },
  { id: 'M9', file: W, within: /export function relPathOf\([\s\S]*?return `\$\{OUTSIDE_REPO\}\/\$\{base\}#\$\{digest\}`;/, find: 'return `${OUTSIDE_REPO}/${base}#${digest}`;', repl: 'return `${OUTSIDE_REPO}/${p}`;', expect: ['outside-repo', 'T3'] },
  { id: 'M10', file: L, within: /const key = task\?\.short_id \?\? view\.relPath \?\? row\.relPath \?\? null;/, find: 'view.relPath ??', repl: "view.relPath?.split('#')[0] ??", expect: ['T5'] },
];

const NAMES = { T1: 'watcher-lanes-symlinked-root', T2: 'watcher-lanes-realpath-fallback', T3: 'lanes-relpath-outside-distinct-basenames', T4: 'lanes-relpath-outside-suffix-stable', T5: 'lanes-compose-outside-lanes-distinct-keys', T6: 'watcher-lanes-realpath-default-wiring', 'outside-repo': 'lanes-relpath-outside-repo' };

function fresh() {
  fs.rmSync(SCRATCH, { recursive: true, force: true });
  fs.cpSync(SRC, SCRATCH, { recursive: true });
}
const report = [];
let applied = 0, asPredicted = 0, deviations = 0;
for (const m of mutants) {
  fresh();
  const fp = path.join(SCRATCH, m.file);
  let s = fs.readFileSync(fp, 'utf8');
  const hits = s.match(new RegExp(m.within.source, 'g')) || [];
  if (hits.length !== 1) { report.push(`${m.id}: ANCHOR matched ${hits.length} times — NOT APPLIED`); deviations++; continue; }
  const region = hits[0];
  if (region.split(m.find).length !== 2) { report.push(`${m.id}: find string occurs ${region.split(m.find).length - 1} times in anchor region — NOT APPLIED`); deviations++; continue; }
  let mutated = s.replace(region, region.replace(m.find, m.repl));
  if (m.extra) mutated = m.extra(mutated);
  if (mutated === s) { report.push(`${m.id}: mutation produced no change — NOT APPLIED`); deviations++; continue; }
  fs.writeFileSync(fp, mutated);
  // assert applied at the intended site: the line number of the replacement
  const lineNo = mutated.slice(0, mutated.indexOf(m.repl)).split('\n').length;
  const diff = spawnSync('diff', [path.join(SRC, m.file), fp], { encoding: 'utf8' }).stdout.trim().split('\n').length;
  applied++;
  const r = spawnSync('node', ['--test', ...TESTS], { cwd: SCRATCH, encoding: 'utf8' });
  const all = r.stdout + r.stderr;
  const red = [...new Set(all.split('\n').filter((l) => /^✖ /.test(l)).map((l) => l.replace(/^✖ /, '').replace(/:.*$/, '').replace(/ \(.*$/, '')))];
  const summary = all.split('\n').filter((l) => /^ℹ (tests|pass|fail) /.test(l)).join(' ');
  const expected = m.expect.map((k) => NAMES[k]).sort();
  const got = red.sort();
  const exact = JSON.stringify(expected) === JSON.stringify(got);
  if (exact) asPredicted++; else deviations++;
  report.push(`${m.id} [${m.file}:${lineNo}, diff lines ${diff}] ${summary} | red: ${got.join(', ') || '(NONE — SURVIVOR)'} | ${exact ? 'exact' : 'DEVIATION vs ' + expected.join(', ')}`);
}
fresh();
fs.rmSync(SCRATCH, { recursive: true, force: true });
report.push(`battery: ${mutants.length} named / ${applied} applied / ${asPredicted} red as predicted / ${deviations} deviations`);
const text = report.join('\n') + '\n';
fs.writeFileSync(M + '/scratchpad/agent-qa-ruben/AS-108/mutants.txt', text);
console.log(text);
