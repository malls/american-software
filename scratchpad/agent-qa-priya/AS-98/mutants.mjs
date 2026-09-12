// AS-98 review mutants (qa-priya). Scratch worktree only; host runs of the two guard files.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const W = '/tmp/AS-98-priya';
const CHAT = `${W}/apps/chat`;
const APP = `${CHAT}/public/app.js`;
const LS = `${CHAT}/test/link-sites.test.js`;
const A_PANEL = 'open.href = dashHref(task.taskId);';
const A_ROSTER = 'a.href = dashHref(emp.work.taskId);';

function git(...a) { return spawnSync('git', ['-C', W, ...a], { encoding: 'utf8' }); }
function count(file, needle) { return readFileSync(file, 'utf8').split(needle).length - 1; }

function insertAfter(file, anchor, line) {
  const src = readFileSync(file, 'utf8');
  if (count(file, anchor) !== 1) throw new Error(`anchor not unique in ${file}: ${anchor}`);
  writeFileSync(file, src.replace(anchor, anchor + '\n  ' + line));
}
function replaceLine(file, anchor, line) {
  const src = readFileSync(file, 'utf8');
  if (count(file, anchor) !== 1) throw new Error(`anchor not unique: ${anchor}`);
  writeFileSync(file, src.replace(anchor, line));
}

function runGuards() {
  const r = spawnSync('node', ['--test', '--test-reporter=tap', 'test/link-sites.test.js', 'test/api.test.js'], { cwd: CHAT, encoding: 'utf8', maxBuffer: 64 << 20 });
  const out = r.stdout + r.stderr;
  const failing = [...out.matchAll(/^not ok \d+ - (.*)$/gm)].map((m) => m[1]);
  const tag = (t) => (t.startsWith('api: AS-93') ? 'T7' : t.includes('allowlisted source') ? 'T8' : t.includes('mechanism') ? 'T9' : t.includes('server-baked url') ? 'T10' : t.includes('classifier itself') ? 'T11' : t);
  const m = out.match(/^# tests (\d+)[\s\S]*?^# pass (\d+)[\s\S]*?^# fail (\d+)/m);
  return { red: [...new Set(failing.map(tag))].sort(), totals: m ? `${m[1]}/${m[2]}/${m[3]}` : '?', status: r.status };
}

const mutants = {
  M1: () => insertAfter(APP, A_PANEL, "const shadow = el('a', 'lattice-open', 'x'); shadow.href=task.url; // MUTANT-M1"),
  M2: () => insertAfter(APP, A_PANEL, "open.setAttribute('href', task.url); // MUTANT-M2"),
  M3: () => insertAfter(APP, A_PANEL, "Object.assign(open, { href: task.url }); // MUTANT-M3"),
  M4: () => insertAfter(APP, A_PANEL, "const s4 = el('a'); s4.href = 'http://localhost:' + (8000 + 799); // MUTANT-M4"),
  M5: () => insertAfter(APP, A_PANEL, "const s5 = el('a'); s5.href = 'https://forrests-newer-macbook.tail3f3c29.ts.net/'; // MUTANT-M5"),
  M6: () => insertAfter(APP, A_PANEL, "const { url } = task; const s6 = el('a'); s6.href = url; // MUTANT-M6"),
  M7: () => insertAfter(APP, A_PANEL, "const s7 = el('a'); s7.href = 'http://' + '127.0.0' + '.1:87' + '99/#/task/' + task.taskId; // MUTANT-M7"),
  M8: () => replaceLine(APP, A_ROSTER, 'a.href = emp.work.url; // MUTANT-M8'),
  M9: () => insertAfter(APP, 'function bodyNode(', "const cp = el('a', 'copyable', 'x'); cp.href = '#'; // MUTANT-M9"),
  M10: () => insertAfter(APP, A_PANEL, "open['href'] = task.taskId; // MUTANT-M10"),
  M11: () => { insertAfter(APP, A_PANEL, "const { url } = task; const s6 = el('a'); s6.href = url; // MUTANT-M6"); replaceLine(LS, "const ALLOWED_RHS = [/^dashHref\\(/, /^tok\\.href\\b/, /^`\\?m=/, /^serializeChatUrl\\(/];", "const ALLOWED_RHS = [/^dashHref\\(/, /^tok\\.href\\b/, /^`\\?m=/, /^serializeChatUrl\\(/, /^url\\b/]; // MUTANT-M11"); },
  'M11-revert': () => insertAfter(APP, A_PANEL, "const { url } = task; const s6 = el('a'); s6.href = url; // MUTANT-M6"),
  AC5: () => replaceLine(LS, 'const HREF_ASSIGN = /\\.href\\s*(\\+?=)(?!=)\\s*([^;\\n]*)/g;', 'const HREF_ASSIGN = /\\.href\\s*(\\+?=)\\s*([^;\\n]*)/g; // MUTANT-AC5'),
  // Priya's own probes (M6-style hunting)
  P1: () => insertAfter(APP, A_PANEL, "const p1 = el('a'); p1.href ||= task.taskId; // MUTANT-P1 logical assignment"),
  P2: () => insertAfter(APP, A_PANEL, "const p2 = el('a'); p2.href = dashHref(task.taskId) + '?x=' + task.url; // MUTANT-P2 allowlisted head, .url tail"),
  P3: () => insertAfter(APP, A_PANEL, "const p3 = el('a'); p3.href =\n    task.url; // MUTANT-P3 rhs on next line"),
  P4: () => insertAfter(APP, A_PANEL, "const p4 = el('a'); p4.href = /* dashboard */ task.url; // MUTANT-P4 comment before rhs"),
  P5: () => insertAfter(APP, A_PANEL, "const p5 = el('a'); p5[\"href\"] = task.taskId; // MUTANT-P5 double-quoted bracket"),
  P7: () => replaceLine(APP, A_PANEL, 'const { url } = task; open.href = url; // MUTANT-P7 count-preserving destructured rhs'),
  P8: () => replaceLine(APP, A_PANEL, 'open.href ??= dashHref(task.taskId); // MUTANT-P8 nullish assignment on a real site'),
  P6: () => insertAfter(APP, A_PANEL, "const p6 = el('a'); p6.href = `${location.origin}/x`; // MUTANT-P6 template, no literal"),
};

const only = process.argv.slice(2);
for (const [id, apply] of Object.entries(mutants)) {
  if (only.length && !only.includes(id)) continue;
  git('checkout', '--', '.');
  apply();
  const marker = id === 'M11-revert' ? 'MUTANT-M6' : id === 'M11' ? 'MUTANT-M11' : `MUTANT-${id}`;
  const applied = count(APP, marker) + count(LS, marker);
  const stat = git('diff', '--stat').stdout.trim().split('\n').filter((l) => l.includes('|')).map((l) => l.trim().split(' ')[0]);
  const anchorOk = (id === 'M8' || id === 'P7' || id === 'P8') ? (id === 'M8' ? count(APP, A_ROSTER) === 0 : count(APP, A_PANEL) === 0) : count(APP, A_PANEL) === 1;
  const r = runGuards();
  console.log(`${id}: applied=${applied} files=${JSON.stringify(stat)} anchorOk=${anchorOk} red=${JSON.stringify(r.red)} totals=${r.totals}`);
}
git('checkout', '--', '.');
console.log('final scratch diff:', JSON.stringify(git('status', '--short').stdout.trim()));
