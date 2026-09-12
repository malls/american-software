// AS-73 mutation battery M1–M3 (qa-ruben), on the SCRATCH COPY of the branch's
// apps/chat — never the worktree. Per mutation: hash before, anchored edit,
// assert applied AT the site (occurrence counts via split().length-1), run the
// suite, record the exact failing set vs predicted, restore, prove hash equal,
// re-run to green. Control run first (expect 474/0).
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash as sha } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const APP = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-73-scratch/branch';
const LOG = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-73-mutations.log';
const out = [];
const log = (...a) => { const s = a.join(' '); out.push(s); console.log(s); };
const hash = (p) => sha('sha256').update(readFileSync(p)).digest('hex');
const count = (hay, needle) => hay.split(needle).length - 1;

function runSuite(label) {
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap'], { cwd: APP, encoding: 'utf8', maxBuffer: 64e6 });
  const text = r.stdout + r.stderr;
  writeFileSync(`${LOG}.${label}.txt`, text);
  const failing = [...text.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1]);
  const tests = /^# tests (\d+)/m.exec(text)?.[1];
  const pass = /^# pass (\d+)/m.exec(text)?.[1];
  const fail = /^# fail (\d+)/m.exec(text)?.[1];
  log(`  [${label}] tests=${tests} pass=${pass} fail=${fail} exit=${r.status}`);
  return { failing, tests, pass, fail };
}

function assertEq(a, b, msg) { if (a !== b) throw new Error(`ASSERT ${msg}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }

const control = runSuite('control');
assertEq(control.fail, '0', 'control fail');
assertEq(control.tests, '474', 'control tests');

const mutations = [
  {
    name: 'M1',
    file: 'lib/personnel.js',
    predicted: [
      'readPersonnel: fence whitespace and a BOM never hide a broken dossier',
      'check-org: reports the examined count and every unclassifiable person on a scratch root',
    ],
    mustStayGreen: ['check-org: exits 1 and names every violation on the dirty fixture root'],
    apply(t) {
      const from = "if (hasLeadingFence(text)) skipped.push({ file, reason: 'malformed_frontmatter' });";
      const to = "if (/^---\\r?\\n/.test(text)) skipped.push({ file, reason: 'malformed_frontmatter' });";
      assertEq(count(t, "reason: 'malformed_frontmatter'"), 1, 'M1 anchor occurs once before');
      assertEq(count(t, from), 1, 'M1 from occurs once');
      return t.replace(from, to);
    },
    assertApplied(t) {
      // Whole-file count is 2, not the plan's 1: hasLeadingFence's doc comment
      // quotes the old regex in prose (line 38). The site-anchored count below
      // is the assertion that matters (CLAUDE.md AS-95 sharpening).
      assertEq(count(t, '/^---\\r?\\n/'), 2, 'M1 regex fence: 1 in doc comment + 1 mutated code line');
      assertEq(count(t, 'hasLeadingFence(text)) skipped'), 0, 'M1 predicate call at classifier site gone');
      // site check: the regex sits inside readPersonnel, after the parseFrontmatter call
      const body = t.slice(t.indexOf('export function readPersonnel'), t.indexOf('export function readRoster'));
      assertEq(count(body, '/^---\\r?\\n/'), 1, 'M1 regex inside readPersonnel');
    },
  },
  {
    name: 'M2',
    file: 'lib/personnel.js',
    predicted: [
      'readPersonnel: fence whitespace and a BOM never hide a broken dossier',
      'readPersonnel: examined counts every .md file, dossier or not',
      'check-org: reports the examined count and every unclassifiable person on a scratch root',
      'check-org: exits 0 on a clean fixture root',
      'check-org: exits 1 and names every violation on the dirty fixture root',
    ],
    mustStayGreen: ['check-org: a root with no personnel/ is exit 0 and says so'],
    apply(t) {
      const inc = "    if (!file.endsWith('.md')) continue;\n    examined++;\n";
      const ret = '  return { roster, skipped, sources, examined };';
      assertEq(count(t, inc), 1, 'M2 increment site occurs once');
      assertEq(count(t, ret), 1, 'M2 return occurs once');
      return t
        .replace(inc, "    if (!file.endsWith('.md')) continue;\n")
        .replace(ret, '  examined = roster.length + skipped.length;\n' + ret);
    },
    assertApplied(t) {
      assertEq(count(t, 'examined = roster.length + skipped.length'), 1, 'M2 new assignment once');
      assertEq(count(t, '    examined++;\n'), 0, 'M2 increment gone');
      const body = t.slice(t.indexOf('export function readPersonnel'), t.indexOf('export function readRoster'));
      assertEq(count(body, 'examined = roster.length + skipped.length'), 1, 'M2 assignment inside readPersonnel');
    },
  },
  {
    name: 'M3',
    file: 'bin/chat.js',
    predicted: ['parity: the CLI roster row is the server roster row minus self, in direct and api mode'],
    mustStayGreen: ['cli: roster prints the active company roster with work status (AS-8)'],
    apply(t) {
      const line = '            reportsTo: e.reportsTo,\n';
      assertEq(count(t, 'reportsTo: e.reportsTo'), 1, 'M3 reportsTo occurs once in bin/chat.js');
      assertEq(count(t, line), 1, 'M3 exact line once');
      return t.replace(line, '');
    },
    assertApplied(t) {
      assertEq(count(t, 'reportsTo: e.reportsTo'), 0, 'M3 reportsTo gone');
      const a = t.indexOf('rosterRows(me) {');
      const b = t.indexOf('registerIdentity:', a);
      if (a < 0 || b < 0) throw new Error('M3 anchors missing');
      assertEq(count(t.slice(a, b), 'reportsTo'), 0, 'M3 no reportsTo between rosterRows and registerIdentity');
    },
  },
];

const results = [];
for (const m of mutations) {
  const p = `${APP}/${m.file}`;
  const orig = readFileSync(p, 'utf8');
  const before = hash(p);
  log(`\n== ${m.name} on ${m.file}  sha256(before)=${before}`);
  let ok = false;
  try {
    const mutated = m.apply(orig);
    if (mutated === orig) throw new Error(`${m.name}: mutation produced no change`);
    writeFileSync(p, mutated);
    m.assertApplied(readFileSync(p, 'utf8'));
    log(`  applied at site: yes (occurrence-accurate)`);
    const r = runSuite(m.name);
    const observed = r.failing.sort();
    const predicted = [...m.predicted].sort();
    const exact = JSON.stringify(observed) === JSON.stringify(predicted);
    const greenOk = m.mustStayGreen.every((n) => !observed.includes(n));
    log(`  predicted red (${predicted.length}): ${predicted.join(' | ')}`);
    log(`  observed  red (${observed.length}): ${observed.join(' | ')}`);
    log(`  exact match: ${exact}; must-stay-green held: ${greenOk}`);
    results.push({ name: m.name, exact, greenOk, observed, predicted });
    ok = true;
  } finally {
    writeFileSync(p, orig);
    const after = hash(p);
    log(`  restored: sha256(after)=${after} equal=${after === before}`);
    if (after !== before) throw new Error('restore failed');
  }
  const g = runSuite(`${m.name}-restored`);
  assertEq(g.fail, '0', `${m.name} green after restore`);
  assertEq(g.tests, '474', `${m.name} count after restore`);
}
log('\nSUMMARY ' + JSON.stringify(results.map((r) => ({ name: r.name, exact: r.exact, greenOk: r.greenOk, observed: r.observed.length, predicted: r.predicted.length }))));
writeFileSync(LOG, out.join('\n') + '\n');
