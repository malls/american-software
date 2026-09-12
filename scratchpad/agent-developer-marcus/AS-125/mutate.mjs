// AS-125 §3 battery runner — developer-marcus. Runs ONE mutant by id against
// the detached scratch worktree /tmp/AS-125-mutant (never $W), asserts the
// mutation applied at the intended site (occurrence counts, scoped to the
// named function/test body for guard mutants), runs the WHOLE host suite,
// records the red set + first failure line, restores, proves porcelain empty,
// and re-runs to confirm green. Appends to mutants.md.
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const ROOT = '/tmp/AS-125-mutant';
const CHAT = `${ROOT}/apps/chat`;
const CSS = `${CHAT}/public/style.css`;
const TEST = `${CHAT}/test/roster-truncation.test.js`;
const LOG = '/Users/forrest/Code/american-software-company/scratchpad/agent-developer-marcus/AS-125/mutants.md';

const count = (hay, needle) => hay.split(needle).length - 1;

// Extract the text of a top-level `function NAME(` body or a `test('NAME'` body.
function fnBody(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`no function ${name}`);
  const end = src.indexOf('\n}\n', start);
  return src.slice(start, end + 3);
}
function testBody(src, titlePrefix) {
  const start = src.indexOf(`test('${titlePrefix}`);
  if (start < 0) throw new Error(`no test ${titlePrefix}`);
  const end = src.indexOf('\n});\n', start);
  return src.slice(start, end + 5);
}

const append = (css, s) => css + s;

// Each mutant: { file, mutate(src) -> src', check(before, after) -> {ok, note}, predicted }
const MUTANTS = {
  A1: { file: CSS, mutate: (c) => append(c, '\n#roster-list li.roster-row div { white-space: normal; }\n'),
    check: (b, a) => [`li.roster-row div {`, count(b, 'li.roster-row div {'), count(a, 'li.roster-row div {'), 0, 1],
    predicted: '{T1} won by #roster-list li.roster-row div (spec 1,1,2, order 210)' },
  A2: { file: CSS, mutate: (c) => append(c, '\n#roster-list * { white-space: normal; }\n'),
    check: (b, a) => [`#roster-list * {`, count(b, '#roster-list * {'), count(a, '#roster-list * {'), 0, 1],
    predicted: '{T1} won by #roster-list * (spec 1,0,0, order 210)' },
  A3: { file: CSS, mutate: (c) => append(c, '\n[class~="roster-title"] { white-space: normal; }\n'),
    check: (b, a) => [`[class~="roster-title"]`, count(b, '[class~="roster-title"]'), count(a, '[class~="roster-title"]'), 0, 1],
    predicted: '{T1} won by [class~="roster-title"] (spec 0,1,0, order 210)' },
  A3b: { file: CSS, mutate: (c) => append(c, '\n[class~=roster-title] { white-space: normal; }\n'),
    check: (b, a) => [`[class~=roster-title]`, count(b, '[class~=roster-title]'), count(a, '[class~=roster-title]'), 0, 1],
    predicted: '{T1} won by [class~=roster-title] (spec 0,1,0, order 210)' },
  A4: { file: CSS, mutate: (c) => append(c, '\n.roster\\-title { white-space: normal; }\n'),
    check: (b, a) => [`.roster\\-title { (and .roster-title { stays ${count(b, '.roster-title {')}->${count(a, '.roster-title {')})`, count(b, '.roster\\-title {'), count(a, '.roster\\-title {'), 0, 1],
    extra: (b, a) => count(a, '.roster-title {') === 2 && count(b, '.roster-title {') === 2,
    predicted: '{T1} won by .roster-title (spec 0,1,0, order 210) — escape normalised' },
  B1: { file: CSS, mutate: (c) => append(c, '\n@scope (#roster-list) { .roster-title { white-space: normal; } }\n'),
    check: (b, a) => ['@scope', count(b, '@scope'), count(a, '@scope'), 0, 1],
    predicted: '{T1} thrown: cannot score unknown at-rule (neither flattened nor ignored): @scope (#roster-list)' },
  B2: { file: CSS, mutate: (c) => append(c, '\n@import url("x.css");\n.roster-title { white-space: normal; }\n'),
    check: (b, a) => ['@import', count(b, '@import'), count(a, '@import'), 0, 1],
    predicted: '{T1} thrown: cannot score: statement at-rule or stray \';\' glued into a prelude: @import url("x.css"); …' },
  B3: { file: CSS, mutate: (c) => append(c, '\n@layer x { .roster-title { white-space: normal !important; } }\n'),
    check: (b, a) => ['@layer', count(b, '@layer'), count(a, '@layer'), 0, 1],
    predicted: '{T1} thrown: …unknown at-rule…: @layer x' },
  C1: { file: CSS, mutate: (c) => append(c, '\n.roster-status::after { content: "{"; }\n.roster-title { white-space: normal; }\n'),
    check: (b, a) => ['content: "{"', count(b, 'content: "{"'), count(a, 'content: "{"'), 0, 1],
    predicted: '{T1} thrown: unbalanced braces: depth 1 at end of input (unclosed block opened by: .roster-status::after)' },
  C2: { file: CSS, mutate: (c) => append(c, '\n}\n'),
    check: (b, a) => ['} count +1', count(b, '}'), count(a, '}'), count(b, '}'), count(b, '}') + 1],
    predicted: "{T1} thrown: unbalanced braces: stray '}' at offset N" },
  C3: { file: CSS, mutate: (c) => append(c, '\n@import url("x.css");\n'),
    check: (b, a) => ['@import', count(b, '@import'), count(a, '@import'), 0, 1],
    predicted: '{T1} thrown: trailing content without a block: @import url("x.css");' },
  N1: { file: CSS, mutate: (c) => append(c, '\n#roster-list span { white-space: normal; }\n'),
    check: (b, a) => ['#roster-list span {', count(b, '#roster-list span {'), count(a, '#roster-list span {'), 0, 1],
    predicted: 'GREEN 615/613/0/2' },
  N2: { file: CSS, mutate: (c) => append(c, '\n#roster-list div.other { white-space: normal; }\n'),
    check: (b, a) => ['div.other {', count(b, 'div.other {'), count(a, 'div.other {'), 0, 1],
    predicted: 'GREEN 615/613/0/2' },
  R1: { file: CSS, mutate: (c) => append(c, '\n.roster-title { white-space: normal; }\n'),
    check: (b, a) => ['.roster-title {', count(b, '.roster-title {'), count(a, '.roster-title {'), 2, 3],
    predicted: '{T1} won by .roster-title (spec 0,1,0, order 210)' },
  R2: { file: CSS, mutate: (c) => {
      const anchor = "/* AS-32: the employee's title";
      const i = c.indexOf(anchor);
      if (i < 0) throw new Error('R2 anchor missing');
      return c.slice(0, i) + '#roster-list .roster-title { white-space: normal; }\n' + c.slice(i);
    },
    check: (b, a) => ['#roster-list .roster-title {', count(b, '#roster-list .roster-title {'), count(a, '#roster-list .roster-title {'), 0, 1],
    extra: (b, a) => a.indexOf('#roster-list .roster-title {') < a.indexOf('\n.roster-title {'),
    predicted: '{T1} won by #roster-list .roster-title (spec 1,1,0, order 50)' },
  R3: { file: CSS, mutate: (c) => append(c, '\n.roster-title { all: unset; }\n'),
    check: (b, a) => ['all: unset', count(b, 'all: unset'), count(a, 'all: unset'), 0, 1],
    predicted: '{T1} .roster-title all: effective value is unset — … the contract allows undeclared' },
  R4: { file: CSS, mutate: (c) => append(c, '\n#roster-list { .roster-title { white-space: normal; } }\n'),
    check: (b, a) => ['#roster-list { .roster-title {', count(b, '#roster-list { .roster-title {'), count(a, '#roster-list { .roster-title {'), 0, 1],
    predicted: '{T1} thrown: cannot score nested style rule (native CSS nesting) under: #roster-list' },
  G1: { file: TEST, mutate: (s) => {
      const body = fnBody(s, 'targets');
      const mutated = body.replace('lastCompound(selector.trim())', "selector.trim().split(/\\s*[\\s>+~]\\s*/).filter(Boolean).pop() || ''");
      if (mutated === body) throw new Error('G1 pattern missing in targets()');
      return s.replace(body, mutated);
    },
    check: (b, a) => ['lastCompound( in targets()', count(fnBody(b, 'targets'), 'lastCompound('), count(fnBody(a, 'targets'), 'lastCompound('), 1, 0],
    predicted: '{H9} exactly; T1 green' },
  F7: { file: TEST, mutate: (s) => {
      const body = testBody(s, 'css-cascade: unbalanced braces throw');
      const mutated = body.replace("assert.throws(\n    () => parseRules('.s::after { content: \"{\"; }\\n.t { white-space: normal; }'),\n    /unbalanced braces: depth 1/,", "assert.doesNotThrow(\n    () => parseRules('.s::after { content: \"{\"; }\\n.t { white-space: normal; }'),\n    /unbalanced braces: depth 1/,");
      if (mutated === body) throw new Error('F7 pattern missing in H7');
      return s.replace(body, mutated);
    },
    check: (b, a) => ['assert.doesNotThrow in H7 body', count(testBody(b, 'css-cascade: unbalanced braces throw'), 'assert.doesNotThrow'), count(testBody(a, 'css-cascade: unbalanced braces throw'), 'assert.doesNotThrow'), 0, 1],
    predicted: '{H7} exactly; file alone 10/9/1' },
  F8: { file: TEST, mutate: (s) => {
      const body = testBody(s, 'css-cascade: an unknown or statement at-rule');
      const mutated = body.replace("assert.throws(\n    () => parseRules('@scope (#r)", "assert.doesNotThrow(\n    () => parseRules('@scope (#r)");
      if (mutated === body) throw new Error('F8 pattern missing in H8');
      return s.replace(body, mutated);
    },
    check: (b, a) => ['assert.doesNotThrow in H8 body', count(testBody(b, 'css-cascade: an unknown or statement at-rule'), 'assert.doesNotThrow'), count(testBody(a, 'css-cascade: an unknown or statement at-rule'), 'assert.doesNotThrow'), 0, 1],
    predicted: '{H8} exactly; file alone 10/9/1' },
  F9: { file: TEST, mutate: (s) => {
      const body = testBody(s, 'css-cascade: the subject need not spell');
      const line = "    '#r li.row div',       // A1: a type subject the element is\n";
      if (!body.includes(line)) throw new Error('F9 reaches line missing');
      let mutated = body.replace(line, '');
      const missesAnchor = "  const misses = [\n";
      if (!mutated.includes(missesAnchor)) throw new Error('F9 misses anchor missing');
      mutated = mutated.replace(missesAnchor, missesAnchor + "    '#r li.row div',       // F9 mutant: expectation flipped to false\n");
      return s.replace(body, mutated);
    },
    check: (b, a) => {
      // scoped to the array LITERAL — the test body also has
      // `assert.equal(won.selector, '#r li.row div')` further down
      const missesOf = (s) => { const t = testBody(s, 'css-cascade: the subject need not spell'); const a = t.indexOf('const misses = ['); return t.slice(a, t.indexOf('];', a)); };
      return ["'#r li.row div' inside H9's misses array", count(missesOf(b), "'#r li.row div'"), count(missesOf(a), "'#r li.row div'"), 0, 1];
    },
    extra: (b, a) => { const t = testBody(a, 'css-cascade: the subject need not spell'); const reaches = t.slice(t.indexOf('const reaches = ['), t.indexOf('const misses = [')); return count(reaches, "'#r li.row div'") === 0; },
    predicted: '{H9} exactly; file alone 10/9/1' },
};

// EXTRA (not one of the §3 21): G1 + A3 together, to OBSERVE the plan's
// "A3 would survive under G1" record rather than argue it. Applies G1 to the
// test file inside mutate() via a side write; the primary file is the CSS.
MUTANTS['G1+A3'] = {
  file: CSS,
  mutate: (c) => {
    const s = readFileSync(TEST, 'utf8');
    writeFileSync(TEST, MUTANTS.G1.mutate(s));
    return MUTANTS.A3.mutate(c);
  },
  check: (b, a) => ['[class~="roster-title"] (CSS) — and lastCompound( in targets() 1->' + count(fnBody(readFileSync(TEST, 'utf8'), 'targets'), 'lastCompound('), count(b, '[class~="roster-title"]'), count(a, '[class~="roster-title"]'), 0, 1],
  extra: () => count(fnBody(readFileSync(TEST, 'utf8'), 'targets'), 'lastCompound(') === 0,
  predicted: 'EXTRA: {H9} only — T1 GREEN despite the A3 rule (plan §3 G1 note: H9 alone pins the bracket-aware scan)',
};

function runSuite() {
  const r = spawnSync('node', ['--test'], { cwd: CHAT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout || '') + (r.stderr || '');
  const lines = out.split('\n');
  const summary = {};
  for (const l of lines) { const m = l.match(/^ℹ (tests|pass|fail|skipped) (\d+)/); if (m) summary[m[1]] = +m[2]; }
  // spec reporter: a trailing "✖ failing tests:" section lists each failure as
  // `✖ <name> (<ms>)` followed by `  <ErrorType>: <first line of message>`.
  const red = [];
  const start = lines.findIndex((l) => /^✖ failing tests:/.test(l));
  if (start >= 0) {
    for (let i = start + 1; i < lines.length; i++) {
      const m = lines[i].match(/^✖ (.*?) \(\d+(\.\d+)?ms\)$/);
      if (!m) continue;
      let first = '';
      for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
        const t = lines[j].trim();
        if (!t || /^test at /.test(t)) continue;
        first = t; break;
      }
      red.push({ name: m[1], first });
    }
  }
  return { status: r.status, summary, red, out };
}

function runFileAlone() {
  const r = spawnSync('node', ['--test', TEST], { cwd: CHAT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout || '') + (r.stderr || '');
  const summary = {};
  for (const l of out.split('\n')) { const m = l.match(/^ℹ (tests|pass|fail|skipped) (\d+)/); if (m) summary[m[1]] = +m[2]; }
  return summary;
}

const fmt = (s) => `${s.tests}/${s.pass}/${s.fail}/${s.skipped}`;

const id = process.argv[2];
const m = MUTANTS[id];
if (!m) { console.error(`unknown mutant ${id}`); process.exit(2); }

const porcelain = () => spawnSync('git', ['-C', ROOT, 'status', '--porcelain'], { encoding: 'utf8' }).stdout.trim();
if (porcelain()) { console.error('scratch worktree not clean before run:\n' + porcelain()); process.exit(3); }

const before = readFileSync(m.file, 'utf8');
const after = m.mutate(before);
writeFileSync(m.file, after);
const onDisk = readFileSync(m.file, 'utf8');
const [site, cb, ca, eb, ea] = m.check(before, onDisk);
const applied = cb === eb && ca === ea && (!m.extra || m.extra(before, onDisk));
const diffStat = spawnSync('git', ['-C', ROOT, 'diff', '--stat'], { encoding: 'utf8' }).stdout.trim();

let record = `\n### ${id}\n- file: ${m.file.replace(ROOT + '/', '')}\n- applied check (${site}): ${cb} -> ${ca} (expected ${eb} -> ${ea})${m.extra ? `, extra site assert ${m.extra(before, onDisk)}` : ''} => ${applied ? 'APPLIED' : 'NOT APPLIED'}\n- diff --stat: ${diffStat.split('\n').pop()}\n- predicted: ${m.predicted}\n`;

if (!applied) {
  record += '- ABORTED: mutation did not apply at the intended site; restoring\n';
} else {
  const res = runSuite();
  record += `- host (whole suite): ${fmt(res.summary)} exit ${res.status}\n- red set: ${res.red.length ? res.red.map((r) => `\`${r.name}\``).join(', ') : '(none — GREEN)'}\n`;
  for (const r of res.red) record += `  - ${r.name}: ${r.first.slice(0, 400)}\n`;
  if (m.file === TEST) {
    const alone = runFileAlone();
    record += `- roster-truncation.test.js alone: ${fmt(alone)}\n`;
  }
}

// restore
spawnSync('git', ['-C', ROOT, 'checkout', '--', 'apps/chat']);
const p = porcelain();
record += `- restored: porcelain ${p ? 'NOT EMPTY: ' + p : 'empty'}\n`;
const green = runSuite();
record += `- post-restore host: ${fmt(green.summary)} exit ${green.status}${green.red.length ? ' RED: ' + green.red.map((r) => r.name).join(', ') : ''}\n`;

appendFileSync(LOG, record);
process.stdout.write(record);
