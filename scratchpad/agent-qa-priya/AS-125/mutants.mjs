// mutants.mjs — the §3 battery on the detached scratch worktree /tmp/AS-125-mutant.
// Per run: apply, ASSERT APPLIED AT THE INTENDED SITE, run the whole host suite, record the exact red set,
// restore with git checkout, prove porcelain empty, re-run green at 615 before the next mutant.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';

const WT = '/tmp/AS-125-mutant';
const CHAT = `${WT}/apps/chat`;
const CSS = `${CHAT}/public/style.css`;
const TEST = `${CHAT}/test/roster-truncation.test.js`;
const LOG = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/AS-125/mutants' + (process.argv.length > 2 ? '-' + process.argv.slice(2).join('_') : '') + '.log';
writeFileSync(LOG, `# mutant battery, ${new Date().toISOString()}, worktree ${WT}\n`);
let currentRaw = null;
const log = (s) => { console.log(s); appendFileSync(LOG, s + '\n'); };

const count = (hay, needle) => hay.split(needle).length - 1;
const git = (...a) => spawnSync('git', ['-C', WT, ...a], { encoding: 'utf8' });

function runSuite(fileOnly = false) {
  const args = ['--test'];
  if (fileOnly) args.push('test/roster-truncation.test.js');
  const r = spawnSync(process.execPath, args, { cwd: CHAT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const out = (r.stdout || '') + (r.stderr || '');
  const lines = out.split('\n');
  const sum = lines.filter((l) => /^ℹ (tests|pass|fail|skipped) /.test(l)).map((l) => l.replace('ℹ ', '').replace(' ', '=')).join(' ');
  // spec reporter: failures are `✖ name (ms)`; the "failing tests" section repeats each with its AssertionError text.
  const red = [];
  const failSection = out.indexOf('failing tests:');
  const tail = failSection === -1 ? '' : out.slice(failSection);
  const seen = new Set();
  for (const l of lines) {
    const m = /^\s*✖ (.*?) \(\d+(\.\d+)?ms\)/.exec(l);
    if (m && !seen.has(m[1])) {
      seen.add(m[1]);
      const idx = tail.indexOf(`✖ ${m[1]}`);
      let msg = '';
      if (idx !== -1) {
        const chunk = tail.slice(idx, idx + 4000);
        const em = /(AssertionError|Error|TypeError)[^\n]*\n?([^\n]*)/.exec(chunk);
        msg = em ? (em[0].replace(/\s+/g, ' ').slice(0, 320)) : '';
      }
      red.push({ name: m[1], msg });
    }
  }
  if (currentRaw) writeFileSync(currentRaw, out);
  return { exit: r.status, sum, red };
}

function restore() {
  git('checkout', '--', 'apps/chat');
  const p = git('status', '--porcelain').stdout.trim();
  if (p) throw new Error(`restore failed, porcelain: ${p}`);
}

// Helper to slice a named function's text out of the test file (for site-scoped applied checks).
function fnText(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`no function ${name}`);
  let depth = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (depth === 0) break; } }
  return src.slice(start, i + 1);
}
function testBody(src, titleFragment) {
  const start = src.indexOf(`test('${titleFragment}`);
  if (start === -1) throw new Error(`no test ${titleFragment}`);
  const end = src.indexOf('\n});', start);
  return src.slice(start, end + 4);
}

const AS32_COMMENT = "/* AS-32: the employee's title";

// Each mutant: { id, apply(): {before, after} for the applied-assert, expect: string, fileOnly?: bool }
const mutants = [
  { id: 'A1', css: '\n#roster-list li.roster-row div { white-space: normal; }\n', anchor: 'li.roster-row div {', expect: 'exactly {T1}: won by #roster-list li.roster-row div (spec 1,1,2, order 210)' },
  { id: 'A2', css: '\n#roster-list * { white-space: normal; }\n', anchor: '#roster-list * {', expect: 'exactly {T1}: won by #roster-list * (spec 1,0,0, order 210)' },
  { id: 'A3', css: '\n[class~="roster-title"] { white-space: normal; }\n', anchor: '[class~="roster-title"]', expect: 'exactly {T1}: won by [class~="roster-title"] (spec 0,1,0, order 210)' },
  { id: 'A3b', css: '\n[class~=roster-title] { white-space: normal; }\n', anchor: '[class~=roster-title]', expect: 'exactly {T1}: won by [class~=roster-title] (spec 0,1,0, order 210)' },
  { id: 'A4', css: '\n.roster\\-title { white-space: normal; }\n', anchor: '.roster\\-title {', also: ['.roster-title {', 2, 2], expect: 'exactly {T1}: won by .roster-title (spec 0,1,0, order 210); .roster-title { stays 2' },
  { id: 'B1', css: '\n@scope (#roster-list) { .roster-title { white-space: normal; } }\n', anchor: '@scope', expect: 'exactly {T1} thrown: unknown at-rule … @scope (#roster-list)' },
  { id: 'B2', css: '\n@import url("x.css");\n.roster-title { white-space: normal; }\n', anchor: '@import', expect: 'exactly {T1} thrown: statement at-rule or stray \';\' glued … @import url("x.css");' },
  { id: 'B3', css: '\n@layer x { .roster-title { white-space: normal !important; } }\n', anchor: '@layer', expect: 'exactly {T1} thrown: unknown at-rule … @layer x' },
  { id: 'C1', css: '\n.roster-status::after { content: "{"; }\n.roster-title { white-space: normal; }\n', anchor: 'content: "{"', expect: 'exactly {T1} thrown: unbalanced braces: depth 1 … opened by: .roster-status::after' },
  { id: 'C2', css: '\n}\n', anchor: '}', delta: 1, expect: 'exactly {T1} thrown: unbalanced braces: stray \'}\' at offset N' },
  { id: 'C3', css: '\n@import url("x.css");\n', anchor: '@import', expect: 'exactly {T1} thrown: trailing content without a block: @import url("x.css");' },
  { id: 'N1', css: '\n#roster-list span { white-space: normal; }\n', anchor: '#roster-list span {', expect: 'GREEN 615/613/0/2' },
  { id: 'N2', css: '\n#roster-list div.other { white-space: normal; }\n', anchor: 'div.other {', expect: 'GREEN 615/613/0/2' },
  { id: 'R1', css: '\n.roster-title { white-space: normal; }\n', anchor: '.roster-title {', from: 2, to: 3, expect: 'exactly {T1}: won by .roster-title (spec 0,1,0, order 210)' },
  { id: 'R2', insertAbove: AS32_COMMENT, css: '#roster-list .roster-title { white-space: normal; }\n', anchor: '#roster-list .roster-title {', expect: 'exactly {T1}: won by #roster-list .roster-title (spec 1,1,0, order 50)' },
  { id: 'R3', css: '\n.roster-title { all: unset; }\n', anchor: 'all: unset', expect: 'exactly {T1}: .roster-title all: effective value is unset' },
  { id: 'R4', css: '\n#roster-list { .roster-title { white-space: normal; } }\n', anchor: '#roster-list { .roster-title {', expect: 'exactly {T1} thrown: cannot score nested style rule … under: #roster-list' },
  { id: 'G1', guard: true, expect: 'exactly {H9}; T1 green' },
  { id: 'F7', guard: true, fileOnly: true, expect: 'exactly {H7}; 10/9/1 in the file alone' },
  { id: 'F8', guard: true, fileOnly: true, expect: 'exactly {H8}; 10/9/1 in the file alone' },
  { id: 'F9', guard: true, fileOnly: true, expect: 'exactly {H9}; 10/9/1 in the file alone' },
];

function applyGuard(id) {
  let src = readFileSync(TEST, 'utf8');
  let before, after, site;
  if (id === 'G1') {
    const t = fnText(src, 'targets');
    before = count(t, 'lastCompound(');
    const t2 = t.replace('const compound = lastCompound(selector.trim());', "const compound = selector.trim().split(/\\s*[\\s>+~]\\s*/).filter(Boolean).pop() || '';");
    src = src.replace(t, t2);
    after = count(fnText(src, 'targets'), 'lastCompound(');
    site = 'targets(): lastCompound( count';
    if (!(before === 1 && after === 0)) throw new Error(`G1 not applied at site: ${before}->${after}`);
  } else if (id === 'F7') {
    const body = testBody(src, 'css-cascade: unbalanced braces throw');
    before = count(body, 'assert.doesNotThrow');
    const b2 = body.replace("assert.throws(\n    () => parseRules('.s::after { content: \"{\"; }\\n.t { white-space: normal; }'),\n    /unbalanced braces: depth 1/,", "assert.doesNotThrow(\n    () => parseRules('.s::after { content: \"{\"; }\\n.t { white-space: normal; }'),\n    /unbalanced braces: depth 1/,");
    src = src.replace(body, b2);
    after = count(testBody(src, 'css-cascade: unbalanced braces throw'), 'assert.doesNotThrow');
    site = 'H7 body: assert.doesNotThrow count';
    if (!(before === 0 && after === 1)) throw new Error(`F7 not applied at site: ${before}->${after}`);
  } else if (id === 'F8') {
    const body = testBody(src, 'css-cascade: an unknown or statement at-rule');
    before = count(body, 'assert.doesNotThrow');
    const b2 = body.replace("assert.throws(\n    () => parseRules('@scope (#r) { .t { white-space: normal; } }'),", "assert.doesNotThrow(\n    () => parseRules('@scope (#r) { .t { white-space: normal; } }'),");
    src = src.replace(body, b2);
    after = count(testBody(src, 'css-cascade: an unknown or statement at-rule'), 'assert.doesNotThrow');
    site = 'H8 body: assert.doesNotThrow count';
    if (!(before === 0 && after === 1)) throw new Error(`F8 not applied at site: ${before}->${after}`);
  } else if (id === 'F9') {
    const body = testBody(src, 'css-cascade: the subject need not spell the class');
    const line = "    '#r li.row div',       // A1: a type subject the element is\n";
    const missesIdx = body.indexOf('const misses = [');
    before = body.indexOf(line) < missesIdx ? 'in reaches' : 'not in reaches';
    let b2 = body.replace(line, '');
    b2 = b2.replace('const misses = [\n', "const misses = [\n    '#r li.row div',       // F9 mutant: flipped to false\n");
    src = src.replace(body, b2);
    const nb = testBody(src, 'css-cascade: the subject need not spell the class');
    after = nb.indexOf("'#r li.row div'") > nb.indexOf('const misses = [') ? 'in misses' : 'not in misses';
    site = 'H9 body: position of \'#r li.row div\' relative to const misses';
    if (!(before === 'in reaches' && after === 'in misses' && count(nb, "'#r li.row div',") === 1)) throw new Error(`F9 not applied at site: ${before}->${after}`);
  }
  writeFileSync(TEST, src);
  return { before, after, site };
}

function applyCss(m) {
  let css = readFileSync(CSS, 'utf8');
  const before = count(css, m.anchor);
  const alsoBefore = m.also ? count(css, m.also[0]) : null;
  if (m.insertAbove) {
    const i = css.indexOf(m.insertAbove);
    if (i === -1) throw new Error(`anchor comment not found for ${m.id}`);
    css = css.slice(0, i) + m.css + css.slice(i);
  } else {
    css += m.css;
  }
  writeFileSync(CSS, css);
  const after = count(readFileSync(CSS, 'utf8'), m.anchor);
  const alsoAfter = m.also ? count(css, m.also[0]) : null;
  const expFrom = m.from ?? (m.delta ? before : 0), expTo = m.to ?? (m.delta ? before + m.delta : 1);
  if (!(before === expFrom && after === expTo)) throw new Error(`${m.id} not applied at site: '${m.anchor}' ${before}->${after}, expected ${expFrom}->${expTo}`);
  if (m.also && !(alsoBefore === m.also[1] && alsoAfter === m.also[2])) throw new Error(`${m.id} side-anchor moved: '${m.also[0]}' ${alsoBefore}->${alsoAfter}`);
  let site = `style.css '${m.anchor}' ${before}->${after}`;
  if (m.also) site += `; '${m.also[0]}' ${alsoBefore}->${alsoAfter}`;
  if (m.insertAbove) site += `; inserted above AS-32 comment at index ${css.indexOf(m.css)} < base rule index ${css.indexOf('\n.roster-title {')}`;
  return { before, after, site };
}

// baseline
if (git('status', '--porcelain').stdout.trim()) throw new Error('scratch worktree dirty at start');
const base = runSuite();
log(`BASELINE scratch: exit=${base.exit} ${base.sum} red=${JSON.stringify(base.red.map((r) => r.name))}`);
if (base.sum !== 'tests=615 pass=613 fail=0 skipped=2') throw new Error('baseline is not 615/613/0/2');

const only = process.argv.slice(2);
for (const m of mutants) {
  if (only.length && !only.includes(m.id)) continue;
  let applied;
  try {
    applied = m.guard ? applyGuard(m.id) : applyCss(m);
  } catch (e) {
    log(`${m.id} APPLY FAILED: ${e.message}`); restore(); continue;
  }
  currentRaw = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/AS-125/raw-' + m.id + (m.fileOnly ? '-file' : '') + '.log';
  const r = runSuite(m.fileOnly);
  currentRaw = null;
  log(`${m.id} applied[${applied.site}] -> exit=${r.exit} ${r.sum}`);
  log(`${m.id}   red set: ${JSON.stringify(r.red.map((x) => x.name))}`);
  for (const x of r.red) log(`${m.id}   msg: ${x.msg}`);
  log(`${m.id}   expected: ${m.expect}`);
  if (m.fileOnly) {
    currentRaw = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/AS-125/raw-' + m.id + '-whole.log';
    const whole = runSuite(false);
    currentRaw = null;
    log(`${m.id}   whole suite: exit=${whole.exit} ${whole.sum} red=${JSON.stringify(whole.red.map((x) => x.name))}`);
  }
  restore();
  const porcelain = git('status', '--porcelain').stdout.trim();
  const g = runSuite();
  log(`${m.id}   restored: porcelain='${porcelain}' post-restore ${g.sum} exit=${g.exit}`);
  if (g.sum !== 'tests=615 pass=613 fail=0 skipped=2') throw new Error(`post-restore not green after ${m.id}`);
}
log('DONE');
