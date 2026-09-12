// AS-98 §3 mutant driver — host runs in the detached scratch worktree.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const MT = '/tmp/AS-98-mutant';
const APP = `${MT}/apps/chat/public/app.js`;
const LS = `${MT}/apps/chat/test/link-sites.test.js`;
const A_PANEL = 'open.href = dashHref(task.taskId);';
const A_ROSTER = 'a.href = dashHref(emp.work.taskId);';
const A_BODY = 'function bodyNode(message) {';

const NAMES = {
  T7: 'api: AS-93 — all four dashboard link sites',
  T8: 'every href in public/*.js comes from an allowlisted source',
  T9: 'sets href by any mechanism other than',
  T10: 'reads the server-baked url field',
  T11: 'the classifier itself rejects',
};

const count = (s, needle) => s.split(needle).length - 1;
const insertAfter = (src, anchor, line) => {
  if (count(src, anchor) !== 1) throw new Error(`anchor not unique: ${anchor}`);
  return src.replace(anchor, `${anchor}\n    ${line}`);
};

const MUTANTS = [
  ['M1', (s) => insertAfter(s, A_PANEL, "const shadow = el('a', 'lattice-open', 'x'); shadow.href=task.url; // MUTANT-M1"), ['T7', 'T8', 'T10']],
  ['M2', (s) => insertAfter(s, A_PANEL, "open.setAttribute('href', task.url); // MUTANT-M2"), ['T9', 'T10']],
  ['M3', (s) => insertAfter(s, A_PANEL, 'Object.assign(open, { href: task.url }); // MUTANT-M3'), ['T9', 'T10']],
  ['M4', (s) => insertAfter(s, A_PANEL, "const s4 = el('a'); s4.href = 'http://localhost:' + (8000 + 799); // MUTANT-M4"), ['T7', 'T8']],
  ['M5', (s) => insertAfter(s, A_PANEL, "const s5 = el('a'); s5.href = 'https://forrests-newer-macbook.tail3f3c29.ts.net/'; // MUTANT-M5"), ['T7', 'T8']],
  ['M6', (s) => insertAfter(s, A_PANEL, "const { url } = task; const s6 = el('a'); s6.href = url; // MUTANT-M6"), ['T8']],
  ['M7', (s) => insertAfter(s, A_PANEL, "const s7 = el('a'); s7.href = 'http://' + '127.0.0' + '.1:87' + '99/#/task/' + task.taskId; // MUTANT-M7"), ['T8']],
  ['M8', (s) => { if (count(s, A_ROSTER) !== 1) throw new Error('A-roster'); return s.replace(A_ROSTER, 'a.href = emp.work.url; // MUTANT-M8'); }, ['T7', 'T8', 'T10']],
  ['M9', (s) => insertAfter(s, A_BODY, "const cp = el('a', 'copyable', 'x'); cp.href = '#'; // MUTANT-M9"), ['T8']],
  ['M10', (s) => insertAfter(s, A_PANEL, "open['href'] = task.taskId; // MUTANT-M10"), ['T9']],
  ['M11', (s) => insertAfter(s, A_PANEL, "const { url } = task; const s6 = el('a'); s6.href = url; // MUTANT-M6"), [], true],
  ['M11-revert', null, ['T8'], 'revert-test-only'],
  ['AC5-extra', null, ['T11'], 'ac5'],
];

function git(...args) {
  return spawnSync('git', ['-C', MT, ...args], { encoding: 'utf8' });
}
function runTests() {
  const r = spawnSync('node', ['--test', 'test/link-sites.test.js', 'test/api.test.js'], {
    cwd: `${MT}/apps/chat`, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  const out = r.stdout + r.stderr;
  const failing = out.split('\n').filter((l) => /^\s*(✖|not ok)/.test(l) && !/^\s*not ok/.test(l));
  const red = new Set();
  for (const [k, needle] of Object.entries(NAMES)) if (failing.some((l) => l.includes(needle))) red.add(k);
  const other = failing.filter((l) => !Object.values(NAMES).some((n) => l.includes(n)));
  const m = out.match(/ℹ tests (\d+)[\s\S]*?ℹ pass (\d+)[\s\S]*?ℹ fail (\d+)/);
  return { red: [...red].sort(), other, totals: m ? `${m[1]}/${m[2]}/${m[3]}` : '?', t7msg: (out.match(/rosterRow[^\n]*/) || [''])[0] };
}

const base = readFileSync(APP, 'utf8');
const lsBase = readFileSync(LS, 'utf8');
const rows = [];
let m11Test = null;
for (const [id, mutate, predicted, mode] of MUTANTS) {
  let applied = '';
  if (mode === 'ac5') {
    // AC-5 extra: remove (?!=) from HREF_ASSIGN in the scratch tree.
    const src = lsBase.replace('(\\+?=)(?!=)\\s*', '(\\+?=)\\s*');
    if (src === lsBase) throw new Error('AC5 mutation not applied');
    writeFileSync(LS, src);
    applied = `(?!=) removed: ${count(src, '(?!=)')} left (was ${count(lsBase, '(?!=)')})`;
  } else if (mode === 'revert-test-only') {
    // M11 revert: restore only link-sites.test.js, keep M6 insertion in app.js.
    writeFileSync(APP, m11Test.app);
    writeFileSync(LS, lsBase);
    applied = `app.js MUTANT-M6 marker ${count(m11Test.app, 'MUTANT-M6')}; test restored, MUTANT-M11 marker ${count(lsBase, 'MUTANT-M11')}`;
  } else {
    const src = mutate(base);
    writeFileSync(APP, src);
    const marker = id === 'M11' ? 'MUTANT-M6' : `MUTANT-${id}`;
    const anchor = id === 'M8' ? A_ROSTER : id === 'M9' ? A_BODY : A_PANEL;
    applied = `marker ${count(base, marker)}->${count(src, marker)}; anchor '${anchor.slice(0, 20)}…' ${count(base, anchor)}->${count(src, anchor)}`;
    if (id === 'M11') {
      const ls = lsBase.replace('/^serializeChatUrl\\(/];', '/^serializeChatUrl\\(/, /^url\\b/ /* MUTANT-M11 */];');
      if (ls === lsBase) throw new Error('M11 test mutation not applied');
      writeFileSync(LS, ls);
      applied += `; test MUTANT-M11 marker 0->${count(ls, 'MUTANT-M11')}`;
      m11Test = { app: src };
    }
  }
  const stat = git('diff', '--stat').stdout.trim().split('\n').filter((l) => l.includes('|')).map((l) => l.trim().split(' ')[0]);
  const res = runTests();
  const verdict = JSON.stringify(res.red) === JSON.stringify(predicted) ? 'AS PREDICTED' : 'MISMATCH';
  rows.push({ id, applied, stat: stat.join(','), red: res.red.join(',') || '(green)', predicted: predicted.join(',') || '(green)', verdict, other: res.other.length, totals: res.totals, t7msg: res.t7msg });
  console.log(`${id}: applied[${applied}] diffstat[${stat.join(',')}] red={${res.red.join(',')}} predicted={${predicted.join(',')}} ${verdict} totals=${res.totals} other=${res.other.length}${res.t7msg ? ' t7:' + res.t7msg.slice(0, 80) : ''}`);
  git('checkout', '--', '.');
  const clean = git('diff', '--exit-code').status === 0;
  console.log(`  restored clean=${clean}`);
}
