// AS-74 review mutation battery — Priya. Backups live OUTSIDE the tree (/tmp).
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const W = '/Users/forrest/Code/american-software-company/.worktrees/AS-74/apps/chat';
const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-74';
const BK = mkdtempSync(join(tmpdir(), 'as74-priya-'));
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const cnt = (s, n) => s.split(n).length - 1;
const region = (src, startNeedle) => { const s = src.indexOf(startNeedle); if (s === -1) throw new Error('region start missing: ' + startNeedle); return src.slice(s, src.indexOf('\n}\n', s)); };

function run(args) {
  const r = spawnSync('node', ['--test', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = (re) => { const x = out.match(re); return x ? Number(x[1]) : NaN; };
  const failSection = out.split('failing tests:')[1] || '';
  const reds = [...failSection.matchAll(/^✖ (.+) \(\d+(?:\.\d+)?ms\)$/gm)].map((x) => x[1]);
  return { tests: m(/ℹ tests (\d+)/), pass: m(/ℹ pass (\d+)/), fail: m(/ℹ fail (\d+)/), reds, out };
}
const porcelain = () => spawnSync('git', ['-C', WT, 'status', '--porcelain'], { encoding: 'utf8' }).stdout.trim();
const ALL = [`${W}/test/api.test.js`, `${W}/test/roster-truncation.test.js`, `${W}/test/mode.test.js`]; // full-suite glob resolved below
import { readdirSync } from 'node:fs';
const SUITE = readdirSync(`${W}/test`).filter((f) => f.endsWith('.test.js')).map((f) => `${W}/test/${f}`);

const results = [];
function mutation(name, files, edit, assertApplied, suite, expectReds, extra) {
  const paths = files.map((f) => `${W}/${f}`);
  const before = paths.map(sha);
  paths.forEach((p, i) => copyFileSync(p, `${BK}/${name}-${i}`));
  let rec = { name, expectReds };
  try {
    edit();
    const applied = assertApplied();
    rec.applied = applied;
    if (!applied.ok) throw new Error('mutation NOT applied at site: ' + JSON.stringify(applied));
    const r = run(suite);
    rec.tests = r.tests; rec.pass = r.pass; rec.fail = r.fail; rec.reds = r.reds;
    if (extra) rec.extra = extra(r);
  } catch (e) { rec.error = String(e.message || e); }
  finally {
    paths.forEach((p, i) => copyFileSync(`${BK}/${name}-${i}`, p));
    const after = paths.map(sha);
    rec.restored = after.every((h, i) => h === before[i]);
    rec.porcelain = porcelain();
    // hash of the file(s) recorded for the comment
    rec.sha = before.map((h) => h.slice(0, 12));
  }
  results.push(rec);
  console.log(JSON.stringify({ ...rec, out: undefined }));
}

const CSS = 'public/style.css', APP = 'public/app.js', DM = 'public/dm-sort.js', TM = 'public/thread-modal.js', API = 'test/api.test.js';
const rd = (f) => readFileSync(`${W}/${f}`, 'utf8');
const wr = (f, s) => writeFileSync(`${W}/${f}`, s);
const T1 = 'truncation: AS-74 — the cascade leaves .roster-title nowrap, overflow hidden, ellipsis — no later or stronger rule re-enables wrapping';
const T2 = 'api: AS-74 — served app.js keeps the org chart node label as title · class · team (the other half of the AS-32 divergence)';
const T3 = 'api: AS-74 — every served public/ module is free of markup sinks (12 examined)';
const AS32EL = 'api: AS-32 — served app.js renders the roster title through el() and shows the title ALONE — no class, no team, no separator';
const only = process.argv.slice(2);
const want = (n) => only.length === 0 || only.includes(n);

// ---- M1: later equal-specificity rule re-enabling wrapping
if (want('M1')) mutation('M1', [CSS], () => wr(CSS, rd(CSS) + '\n.roster-title { white-space: normal; }\n'), () => {
  // baseline is 2 (lines 134 and 138 both contain `.roster-title {`), not the plan's 1
  const c = rd(CSS); return { ok: cnt(c, '.roster-title {') === 3 && c.lastIndexOf('.roster-title {') > c.indexOf('.roster-status {') && c.trimEnd().endsWith('.roster-title { white-space: normal; }'), count: cnt(c, '.roster-title {') };
}, SUITE, [T1], (r) => ({ t1msg: (r.out.match(/effective value is [^\n]*/) || [''])[0].slice(0, 160) }));

// ---- M2: higher-specificity rule BEFORE the AS-32 rule
if (want('M2')) mutation('M2', [CSS], () => {
  const c = rd(CSS); const anchor = "/* AS-32: the employee's title"; if (cnt(c, anchor) !== 1) throw new Error('anchor count ' + cnt(c, anchor));
  wr(CSS, c.replace(anchor, '#roster-list .roster-title { white-space: normal; }\n' + anchor));
}, () => { const c = rd(CSS); return { ok: cnt(c, '#roster-list .roster-title {') === 1 && c.indexOf('#roster-list .roster-title {') < c.indexOf('.roster-title {'), idx: [c.indexOf('#roster-list .roster-title {'), c.indexOf('.roster-title {')] }; },
SUITE, [T1], (r) => ({ t1msg: (r.out.match(/effective value is [^\n]*/) || [''])[0].slice(0, 160) }));

// ---- M3: org label collapsed to title-only
if (want('M3')) mutation('M3', [APP], () => {
  const a = rd(APP); const needle = "const meta = [node.title, node.class, node.team].filter(Boolean).join(' \\u00b7 ');";
  if (cnt(a, needle) !== 1) throw new Error('needle count ' + cnt(a, needle));
  wr(APP, a.replace(needle, "const meta = node.title || '';"));
}, () => { const a = rd(APP); const reg = region(a, 'function orgNodeItem(node) {'); return { ok: cnt(reg, 'node.class') === 0 && cnt(reg, 'node.title || \'\'') === 1, regionCount: cnt(reg, 'node.class'), fileCount: cnt(a, 'node.class') }; },
SUITE, [T2]);

// ---- M4: double-quoted stray class in rosterRow; both ways
if (want('M4')) mutation('M4', [APP, API], () => {
  const a = rd(APP); const anchor = '  item.append(top);'; if (cnt(a, anchor) !== 1) throw new Error('anchor count ' + cnt(a, anchor));
  wr(APP, a.replace(anchor, anchor + '\n  item.append(el("div", "roster-extra"));'));
}, () => { const a = rd(APP); const reg = region(a, 'function rosterRow('); return { ok: cnt(reg, 'el("') === 1, regionCount: cnt(reg, 'el("') }; },
SUITE, [AS32EL], (r) => {
  // with the mutation still applied: master's copy of the test at the same path
  const masterCopy = spawnSync('git', ['-C', WT, 'show', 'master:apps/chat/test/api.test.js'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout;
  wr(API, masterCopy);
  const rm = run([`${W}/test/api.test.js`]);
  const masterSha = sha(`${W}/${API}`).slice(0, 12);
  spawnSync('git', ['-C', WT, 'checkout', '--', 'apps/chat/test/api.test.js']);
  return { masterTest: { tests: rm.tests, pass: rm.pass, fail: rm.fail, reds: rm.reds, masterCopySha: masterSha } };
});

// ---- M5: .innerHTML in dm-sort.js
if (want('M5')) mutation('M5', [DM], () => wr(DM, rd(DM) + "\nexport const _sink = (n) => { n.innerHTML = ''; };\n"),
  () => ({ ok: cnt(rd(DM), '.innerHTML') === 1, count: cnt(rd(DM), '.innerHTML') }), SUITE, [T3],
  (r) => ({ t3msg: (r.out.match(/zero \.innerHTML use in the served [^\n]*/) || [''])[0].slice(0, 120) }));

// ---- M6: .innerHTML in app.js rosterRow
if (want('M6')) mutation('M6', [APP], () => {
  const a = rd(APP); const needle = "const role = el('div', 'roster-title', emp.title);"; if (cnt(a, needle) !== 1) throw new Error('needle count ' + cnt(a, needle));
  wr(APP, a.replace(needle, "const role = el('div', 'roster-title'); role.innerHTML = emp.title;"));
}, () => { const a = rd(APP); const reg = region(a, 'function rosterRow('); return { ok: cnt(reg, '.innerHTML') === 1, regionCount: cnt(reg, '.innerHTML') }; },
SUITE, [T3, AS32EL], (r) => ({ as32assert: (r.out.match(/the title element is built by el\(\)[^\n]*/) || ['(not found)'])[0].slice(0, 100), sinkLineFired: /house rule holds/.test(r.out) }));

// ---- Priya's probes past the list (T1 file only, or api.test.js only — fast)
const T1FILE = [`${W}/test/roster-truncation.test.js`];
const APIFILE = [`${W}/test/api.test.js`];
const cssAppend = (name, snippet, expect) => want(name) && mutation(name, [CSS], () => wr(CSS, rd(CSS) + '\n' + snippet + '\n'),
  () => ({ ok: cnt(rd(CSS), snippet) === 1 }), T1FILE, expect, (r) => ({ t1msg: (r.out.match(/effective value is [^\n]*/) || [''])[0].slice(0, 140) }));
cssAppend('P1-display-inline', '.roster-title { display: inline; }', [T1]);
cssAppend('P2-line-clamp', '.roster-title { display: -webkit-box; -webkit-line-clamp: 2; }', [T1]);
cssAppend('P3-text-wrap', '.roster-title { text-wrap: wrap; }', [T1]);
cssAppend('P5-media', '@media (max-width: 700px) { #roster-list .roster-title { white-space: normal; overflow: visible; } }', [T1]);
cssAppend('P6-all-unset', '.roster-title { all: unset; }', [T1]);            // NOT in the contract table — expect survive
cssAppend('P7-nesting', '#roster-list { .roster-title { white-space: normal; } }', [T1]); // native nesting — expect survive
cssAppend('P8-roster-row-nested-later', 'li.roster-row .roster-title { white-space: pre-wrap; }', [T1]);
// P4: earlier !important
if (want('P4-early-important')) mutation('P4-early-important', [CSS], () => {
  const c = rd(CSS); wr(CSS, '.roster-title { white-space: normal !important; }\n' + c);
}, () => ({ ok: rd(CSS).startsWith('.roster-title { white-space: normal !important; }') }), T1FILE, [T1],
(r) => ({ t1msg: (r.out.match(/effective value is [^\n]*/) || [''])[0].slice(0, 140) }));
// P9: delete the AS-32 rule entirely — non-vacuity on the real stylesheet (zero targeting winners)
if (want('P9-delete-rule')) mutation('P9-delete-rule', [CSS], () => {
  const c = rd(CSS); const s = c.indexOf('.roster-title {'); const e = c.indexOf('}', s) + 1; wr(CSS, c.slice(0, s) + c.slice(e));
}, () => ({ ok: cnt(rd(CSS), '.roster-title {') === 1 && cnt(rd(CSS), 'text-overflow: ellipsis') === cnt(readFileSync(`${BK}/P9-delete-rule-0`, 'utf8'), 'text-overflow: ellipsis') - 1 }), T1FILE, [T1],
(r) => ({ t1msg: (r.out.match(/effective value is [^\n]*/) || [''])[0].slice(0, 140) }));
// P10: double-quoted stray class inside orgNodeItem — nothing pins that region's set
if (want('P10-org-extra')) mutation('P10-org-extra', [APP], () => {
  const a = rd(APP); const needle = "el('span', 'org-node-meta', meta)"; if (cnt(a, needle) !== 1) throw new Error('needle ' + cnt(a, needle));
  wr(APP, a.replace(needle, 'el("span", "org-extra"), ' + needle));
}, () => ({ ok: cnt(region(rd(APP), 'function orgNodeItem(node) {'), 'el("') === 1 }), APIFILE, []);
// P11: .innerHTML in thread-modal.js (never covered before)
if (want('P11-thread-modal')) mutation('P11-thread-modal', [TM], () => wr(TM, rd(TM) + "\nexport const _sink = (n) => { n.innerHTML = ''; };\n"),
  () => ({ ok: cnt(rd(TM), '.innerHTML') === 1 }), APIFILE, [T3]);

console.log('\n=== SUMMARY ===');
for (const r of results) {
  const exact = JSON.stringify([...r.reds || []].sort()) === JSON.stringify([...r.expectReds].sort());
  console.log(`${r.name}: applied=${r.applied?.ok} ${r.tests}/${r.fail}f reds=${JSON.stringify(r.reds)} expected=${JSON.stringify(r.expectReds)} EXACT=${exact} restored=${r.restored} porcelain='${r.porcelain}' ${r.error ? 'ERROR=' + r.error : ''}`);
  if (r.extra) console.log('   extra:', JSON.stringify(r.extra));
}
console.log('backups at', BK);
