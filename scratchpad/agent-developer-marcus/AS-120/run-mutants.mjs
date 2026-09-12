// AS-120 mutant runner — agent:developer-marcus. Host runs (node --test) of the
// two guard files against a detached scratch worktree; never touches $W.
// Usage: node run-mutants.mjs [M1 M2 ...]   (default: all, plus M1-vs-master)
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const MUT = '/tmp/AS-120-mutant';
const APP = `${MUT}/apps/chat/public/app.js`;
const TEST = `${MUT}/apps/chat/test/link-sites.test.js`;
const A_PANEL = '    open.href = dashHref(task.taskId);\n';
const OUT = '/Users/forrest/Code/american-software-company/scratchpad/agent-developer-marcus/AS-120';

const appInsert = (id, line) => ({
  file: APP,
  apply: (src) => {
    const n = src.split(A_PANEL).length - 1;
    if (n !== 1) throw new Error(`A-panel count ${n}, expected 1`);
    return src.replace(A_PANEL, A_PANEL + `    ${line} // MUTANT-${id}\n`);
  },
});
const testReplace = (id, from, to) => ({
  file: TEST,
  apply: (src) => {
    const n = src.split(from).length - 1;
    if (n !== 1) throw new Error(`pattern count ${n} for ${JSON.stringify(from)}, expected 1`);
    return src.replace(from, `${to} // MUTANT-${id}`);
  },
});

const MUTANTS = {
  M1: appInsert('M1', "const p1 = el('a'); p1.href ||= task.taskId;"),
  M2: appInsert('M2', "const p2 = el('a'); p2.href ??= task.url;"),
  M3: appInsert('M3', "const p3 = el('a'); p3.href &&= dashHref(task.taskId);"),
  M4: appInsert('M4', "const p4 = el('a'); p4.href -= 1;"),
  M5: appInsert('M5', "Reflect.set(open, 'href', task.taskId);"),
  M6: appInsert('M6', "Object.defineProperty(open, 'href', { value: task.taskId });"),
  M7: appInsert('M7', "const p7 = el('a'); [p7.href] = [task.taskId];"),
  M8: testReplace(
    'M8',
    "const ASSIGN_OP = String.raw`\\*\\*=|<<=|>>>=|>>=|\\|\\|=|\\?\\?=|&&=|[-+*/%&|^]=|=`;",
    'const ASSIGN_OP = String.raw`\\+?=`;'
  ),
  M9: testReplace(
    'M9',
    "const HREF_COMPOUND = new RegExp(String.raw`\\.href\\s*(?:\\*\\*=|<<=|>>>=|>>=|\\|\\|=|\\?\\?=|&&=|[-+*/%&|^]=)`);",
    'const HREF_COMPOUND = /\\.href\\s*\\+=/;'
  ),
};

function git(...args) {
  const r = spawnSync('git', ['-C', MUT, ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}
function reset() {
  git('checkout', '--', '.');
  const st = git('status', '--porcelain');
  if (st.trim() !== '') throw new Error(`scratch tree not clean after reset:\n${st}`);
}
function count(file, needle) {
  return readFileSync(file, 'utf8').split(needle).length - 1;
}
function runTests(label) {
  const r = spawnSync('node', ['--test', 'test/api.test.js', 'test/link-sites.test.js'], {
    cwd: `${MUT}/apps/chat`,
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  });
  const out = r.stdout + r.stderr;
  writeFileSync(`${OUT}/mutant-${label}.log`, out);
  const failing = [...new Set([...out.matchAll(/^✖ (.+) \(\d+(?:\.\d+)?ms\)$/gm)].map((m) => m[1]))];
  const summary = Object.fromEntries(
    ['tests', 'pass', 'fail', 'skipped'].map((k) => [k, Number((out.match(new RegExp(`^ℹ ${k} (\\d+)`, 'm')) || [])[1])])
  );
  return { exit: r.status, failing, summary };
}

function runMutant(id, { testFileFrom } = {}) {
  reset();
  const m = MUTANTS[id];
  const label = testFileFrom ? `${id}-vs-${testFileFrom}` : id;
  if (testFileFrom) writeFileSync(TEST, git('show', `${testFileFrom}:apps/chat/test/link-sites.test.js`));
  const before = count(m.file, `MUTANT-${id}`);
  writeFileSync(m.file, m.apply(readFileSync(m.file, 'utf8')));
  const after = count(m.file, `MUTANT-${id}`);
  const stat = git('diff', '--stat').trim().split('\n');
  const changed = stat.filter((l) => l.includes('|')).length;
  const expectedChanged = testFileFrom ? 2 : 1;
  const aPanel = count(APP, A_PANEL);
  const applied = before === 0 && after === 1 && changed === expectedChanged && aPanel === 1;
  const diff = git('diff', '--', m.file);
  const res = runTests(label);
  const line = `${label}: applied=${applied} (MUTANT-${id} ${before}->${after}, files changed ${changed}, A-panel ${aPanel}); ` +
    `exit ${res.exit}; tests ${res.summary.tests} pass ${res.summary.pass} fail ${res.summary.fail} skipped ${res.summary.skipped}; ` +
    `RED = {${res.failing.join(' | ') || 'none'}}`;
  console.log(line);
  console.log(diff.split('\n').filter((l) => /^[+-][^+-]/.test(l)).join('\n'));
  reset();
  return line;
}

const ids = process.argv.slice(2);
const results = [];
if (ids.length === 0) {
  results.push(runMutant('M1', { testFileFrom: '0deb7fe' }));
  for (const id of Object.keys(MUTANTS)) results.push(runMutant(id));
} else {
  for (const id of ids) {
    if (id === 'M1-master') results.push(runMutant('M1', { testFileFrom: '0deb7fe' }));
    else results.push(runMutant(id));
  }
}
writeFileSync(`${OUT}/mutant-results.txt`, results.join('\n') + '\n');
console.log('\nscratch tree clean:', git('status', '--porcelain').trim() === '');
