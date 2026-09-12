// AS-120 review mutator (qa-priya). node mutate.mjs <id>
// Operates ONLY on the detached scratch worktree. Cleans the tree first, applies one
// mutant, then asserts: the marker appears exactly once, at the intended site (line
// number recorded), `git diff --stat` names exactly one file, and for app.js insertions
// the A-panel line is still present exactly once.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const SW = '/Users/forrest/Code/american-software-company/.worktrees/AS-120-mutant';
const APP = `${SW}/apps/chat/public/app.js`;
const TEST = `${SW}/apps/chat/test/link-sites.test.js`;
const APANEL = '    open.href = dashHref(task.taskId);';
const id = process.argv[2];

execFileSync('git', ['-C', SW, 'checkout', '--', '.']);
execFileSync('git', ['-C', SW, 'clean', '-fdq', '--', 'apps/chat/public', 'apps/chat/test']);

function insertAfterAPanel(line) {
  const src = readFileSync(APP, 'utf8');
  const lines = src.split('\n');
  const idx = lines.indexOf(APANEL);
  if (idx < 0 || lines.lastIndexOf(APANEL) !== idx) throw new Error('A-panel not unique');
  lines.splice(idx + 1, 0, line);
  writeFileSync(APP, lines.join('\n'));
  return { file: APP, line: idx + 2 };
}
function replaceAPanel(line) {
  const src = readFileSync(APP, 'utf8');
  const lines = src.split('\n');
  const idx = lines.indexOf(APANEL);
  if (idx < 0 || lines.lastIndexOf(APANEL) !== idx) throw new Error('A-panel not unique');
  lines[idx] = line;
  writeFileSync(APP, lines.join('\n'));
  return { file: APP, line: idx + 1, replaced: true };
}
function replaceTestLine(startsWith, line) {
  const src = readFileSync(TEST, 'utf8');
  const lines = src.split('\n');
  const hits = lines.map((l, i) => (l.startsWith(startsWith) ? i : -1)).filter((i) => i >= 0);
  if (hits.length !== 1) throw new Error(`expected 1 line starting ${startsWith}, got ${hits.length}`);
  lines[hits[0]] = line;
  writeFileSync(TEST, lines.join('\n'));
  return { file: TEST, line: hits[0] + 1, replaced: true };
}

const MUT = {
  M1: () => insertAfterAPanel("    const p1 = el('a'); p1.href ||= task.taskId; // MUTANT-M1"),
  M2: () => insertAfterAPanel("    const p2 = el('a'); p2.href ??= task.url; // MUTANT-M2"),
  M3: () => insertAfterAPanel("    const p3 = el('a'); p3.href &&= dashHref(task.taskId); // MUTANT-M3"),
  M4: () => insertAfterAPanel("    const p4 = el('a'); p4.href -= 1; // MUTANT-M4"),
  M5: () => insertAfterAPanel("    Reflect.set(open, 'href', task.taskId); // MUTANT-M5"),
  M6: () => insertAfterAPanel("    Object.defineProperty(open, 'href', { value: task.taskId }); // MUTANT-M6"),
  M7: () => insertAfterAPanel("    const p7 = el('a'); [p7.href] = [task.taskId]; // MUTANT-M7"),
  M7b: () => replaceAPanel('    [open.href] = [task.taskId]; // MUTANT-M7b'),
  M8: () => replaceTestLine('const ASSIGN_OP = ', 'const ASSIGN_OP = String.raw`\\+?=`; // MUTANT-M8'),
  M9: () => replaceTestLine('const HREF_COMPOUND = ', 'const HREF_COMPOUND = /\\.href\\s*\\+=/; // MUTANT-M9'),
  // M1 against master's test file (AC-1's "observed all-green on master")
  M1master: () => {
    const r = insertAfterAPanel("    const p1 = el('a'); p1.href ||= task.taskId; // MUTANT-M1");
    const masterTest = execFileSync('git', ['-C', SW, 'show', 'master:apps/chat/test/link-sites.test.js'], { encoding: 'utf8' });
    writeFileSync(TEST, masterTest);
    return { ...r, note: 'link-sites.test.js replaced with master copy' };
  },
  // --- M6 probes past the list (qa-priya, not in the plan) ---
  PA: () => replaceAPanel('    open.href = open.href || dashHref(task.taskId); // MUTANT-PA'),
  PB: () => replaceAPanel("    open.href = dashHref(task.taskId) + '#top'; // MUTANT-PB"),
  PC: () => insertAfterAPanel("    open.setAttribute(`href`, task.taskId); // MUTANT-PC"),
  PD: () => insertAfterAPanel("    const pd = el('a'); pd.href\n      = task.taskId; // MUTANT-PD"),
  PK: () => replaceAPanel("    open.href = task.taskId ? dashHref(task.taskId) : '#'; // MUTANT-PK"),
  PQ: () => insertAfterAPanel("    open[`href`] = task.taskId; // MUTANT-PQ"),
  PT: () => insertAfterAPanel("    const at = document.createAttribute('href'); at.value = task.taskId; open.setAttributeNode(at); // MUTANT-PT"),
  PU: () => insertAfterAPanel("    Object.defineProperties(open, { href: { value: task.taskId } }); // MUTANT-PU"),
  PV: () => insertAfterAPanel("    const pv = el('a'); pv.href = pv.href ?? task.taskId; // MUTANT-PV"),
};
if (!MUT[id]) throw new Error(`unknown mutant ${id}`);
const r = MUT[id]();

// Assertions: applied, at the site, one file (two for M1master), A-panel intact for insertions.
const stat = execFileSync('git', ['-C', SW, 'diff', '--stat'], { encoding: 'utf8' }).trim();
const marker = `MUTANT-${id === 'M1master' ? 'M1' : id}`;
const target = readFileSync(r.file, 'utf8');
const markerCount = target.split(marker).length - 1;
const lineAt = target.split('\n').findIndex((l) => l.includes(marker)) + 1;
const apanelCount = readFileSync(APP, 'utf8').split('\n').filter((l) => l === APANEL).length;
const filesChanged = stat.split('\n').filter((l) => l.includes('|')).length;
const expectFiles = id === 'M1master' ? 2 : 1;
const expectAPanel = r.replaced && r.file === APP ? 0 : 1; // A-panel only disappears for app.js replacements
const ok = markerCount === 1 && filesChanged === expectFiles && apanelCount === expectAPanel && lineAt === r.line;
console.log(`${id}: marker x${markerCount} at ${r.file.replace(SW + '/', '')}:${lineAt} (intended ${r.line}); files changed ${filesChanged} (expect ${expectFiles}); A-panel x${apanelCount} (expect ${expectAPanel}); ${r.note || ''} => ${ok ? 'APPLIED' : 'NOT APPLIED'}`);
console.log(stat);
if (!ok) process.exit(2);
