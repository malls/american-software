// AS-74 mutation harness (developer-lena, tick watcher:93997).
// One indivisible step per mutant: back up -> mutate -> assert applied AT the
// intended site -> observe -> restore in `finally` -> prove the tree
// byte-identical -> re-run green. `trap` is not available in this shell, so the
// restore guarantee lives in this process instead.
//
// Usage: node mutate.mjs <M1|M2|M3|M4|M5|M6>
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const W = '/Users/forrest/Code/american-software-company/.worktrees/AS-74';
const CHAT = `${W}/apps/chat`;
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const count = (s, needle) => s.split(needle).length - 1;

function region(src, header) {
  const start = src.indexOf(header);
  if (start === -1) throw new Error(`region header not found: ${header}`);
  return src.slice(start, src.indexOf('\n}\n', start));
}

function runSuite(files = [`${CHAT}/test/*.test.js`]) {
  const r = spawnSync('/bin/sh', ['-c', `node --test ${files.join(' ')} 2>&1`], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  const out = r.stdout || '';
  const red = [...new Set([...out.matchAll(/^✖ (.+?) \(\d/gm)].map((m) => m[1]))];
  const nums = {};
  for (const k of ['tests', 'pass', 'fail']) {
    const m = out.match(new RegExp(`^ℹ ${k} (\\d+)`, 'm'));
    nums[k] = m ? Number(m[1]) : null;
  }
  return { red, nums, out };
}

// Each mutant: files it touches, the edit, and an assertion that the edit
// landed at the intended site (not merely somewhere).
const MUTANTS = {
  M1: {
    files: [`${CHAT}/public/style.css`],
    predicted: ['T1'],
    apply([p]) {
      const before = readFileSync(p, 'utf8');
      writeFileSync(p, `${before}\n.roster-title { white-space: normal; }\n`);
      const after = readFileSync(p, 'utf8');
      return [
        // NB: the plan's M1 says 1 -> 2. The substring occurs TWICE on master
        // (the base rule at style.css:134 and the .active colour rule at 138),
        // so the correct site assertion is 2 -> 3.
        [`".roster-title {" occurrences ${count(before, '.roster-title {')} -> ${count(after, '.roster-title {')} (2 -> 3)`,
          count(before, '.roster-title {') === 2 && count(after, '.roster-title {') === 3],
        ['the new rule sits AFTER the AS-32 block',
          after.lastIndexOf('.roster-title {') > after.indexOf('.roster-status {')],
      ];
    },
  },
  M2: {
    files: [`${CHAT}/public/style.css`],
    predicted: ['T1'],
    apply([p]) {
      const before = readFileSync(p, 'utf8');
      const anchor = "/* AS-32: the employee's title";
      if (count(before, anchor) !== 1) throw new Error('anchor is not unique');
      const after = before.replace(anchor, `#roster-list .roster-title { white-space: normal; }\n${anchor}`);
      writeFileSync(p, after);
      return [
        ['"#roster-list .roster-title {" occurrences 0 -> 1',
          count(before, '#roster-list .roster-title {') === 0
          && count(after, '#roster-list .roster-title {') === 1],
        ['it is inserted BEFORE the base .roster-title rule',
          after.indexOf('#roster-list .roster-title {') < after.indexOf('\n.roster-title {')],
      ];
    },
  },
  M3: {
    files: [`${CHAT}/public/app.js`],
    predicted: ['T2'],
    apply([p]) {
      const before = readFileSync(p, 'utf8');
      const line = "  const meta = [node.title, node.class, node.team].filter(Boolean).join(' \\u00b7 ');";
      if (count(before, line) !== 1) throw new Error('meta line is not unique');
      const after = before.replace(line, "  const meta = node.title || '';");
      writeFileSync(p, after);
      const rb = region(before, 'function orgNodeItem(node) {');
      const ra = region(after, 'function orgNodeItem(node) {');
      return [
        [`"node.class" in the orgNodeItem region ${count(rb, 'node.class')} -> ${count(ra, 'node.class')} (1 -> 0)`,
          count(rb, 'node.class') === 1 && count(ra, 'node.class') === 0],
        [`"node.class" whole file ${count(before, 'node.class')} -> ${count(after, 'node.class')}`, true],
      ];
    },
  },
  M4: {
    files: [`${CHAT}/public/app.js`],
    predicted: ['AS-32 el() case'],
    apply([p]) {
      const before = readFileSync(p, 'utf8');
      const anchor = '  item.append(top);';
      if (count(before, anchor) !== 1) throw new Error('anchor is not unique');
      const after = before.replace(anchor, `${anchor}\n  item.append(el("div", "roster-extra"));`);
      writeFileSync(p, after);
      const rb = region(before, 'function rosterRow(emp) {');
      const ra = region(after, 'function rosterRow(emp) {');
      return [
        [`'el("' in the rosterRow region ${count(rb, 'el("')} -> ${count(ra, 'el("')} (0 -> 1)`,
          count(rb, 'el("') === 0 && count(ra, 'el("') === 1],
      ];
    },
  },
  M5: {
    files: [`${CHAT}/public/dm-sort.js`],
    predicted: ['T3'],
    apply([p]) {
      const before = readFileSync(p, 'utf8');
      writeFileSync(p, `${before}\nexport const _sink = (n) => { n.innerHTML = ''; };\n`);
      const after = readFileSync(p, 'utf8');
      return [
        [`".innerHTML" in dm-sort.js ${count(before, '.innerHTML')} -> ${count(after, '.innerHTML')} (0 -> 1)`,
          count(before, '.innerHTML') === 0 && count(after, '.innerHTML') === 1],
      ];
    },
  },
  M6: {
    files: [`${CHAT}/public/app.js`],
    predicted: ['T3', 'AS-32 el() case'],
    apply([p]) {
      const before = readFileSync(p, 'utf8');
      const line = "    const role = el('div', 'roster-title', emp.title);";
      if (count(before, line) !== 1) throw new Error('title line is not unique');
      const after = before.replace(line,
        "    const role = el('div', 'roster-title'); role.innerHTML = emp.title;");
      writeFileSync(p, after);
      const rb = region(before, 'function rosterRow(emp) {');
      const ra = region(after, 'function rosterRow(emp) {');
      return [
        [`".innerHTML" in the rosterRow region ${count(rb, '.innerHTML')} -> ${count(ra, '.innerHTML')} (0 -> 1)`,
          count(rb, '.innerHTML') === 0 && count(ra, '.innerHTML') === 1],
      ];
    },
  },
};

const name = process.argv[2];
const m = MUTANTS[name];
if (!m) throw new Error(`unknown mutant ${name}`);

const backups = m.files.map((p) => ({ p, body: readFileSync(p), hash: sha(p) }));
console.log(`== ${name} ==`);
for (const b of backups) console.log(`HASH BEFORE ${b.p.replace(CHAT, '')}: ${b.hash}`);

let applied;
try {
  applied = m.apply(m.files);
  for (const [what, ok] of applied) console.log(`ASSERT ${ok ? 'OK  ' : 'FAIL'} ${what}`);
  if (applied.some(([, ok]) => !ok)) throw new Error('mutation did not apply at the intended site');

  const { red, nums, out } = runSuite();
  console.log(`OBSERVED tests=${nums.tests} pass=${nums.pass} fail=${nums.fail}`);
  console.log(`RED SET (${red.length}):`);
  for (const r of red) console.log(`  - ${r}`);
  console.log(`PREDICTED: ${m.predicted.join(', ')}`);
  // The guard's own message — cardinality, the winning selector, the count.
  for (const line of out.split('\n')) {
    if (/effective value is|targeting selectors|served modules under|zero \S+ use in the served|the contract allows/.test(line)) {
      console.log(`MSG ${line.trim().slice(0, 400)}`);
    }
  }

  if (name === 'M4') {
    // Second leg: with the mutation still applied, show master's copy of the
    // test is blind to it. It must sit at the same path (relative imports).
    const tp = `${CHAT}/test/api.test.js`;
    const tb = { p: tp, body: readFileSync(tp), hash: sha(tp) };
    console.log(`HASH BEFORE /test/api.test.js: ${tb.hash}`);
    try {
      const show = spawnSync('git', ['-C', W, 'show', 'master:apps/chat/test/api.test.js'],
        { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
      writeFileSync(tp, show.stdout);
      console.log(`ASSERT ${sha(tp) !== tb.hash ? 'OK  ' : 'FAIL'} worktree test file replaced by master's copy`);
      const r2 = runSuite([tp]);
      console.log(`MASTER-TEST-ONLY tests=${r2.nums.tests} pass=${r2.nums.pass} fail=${r2.nums.fail}`);
      console.log(`MASTER-TEST RED SET (${r2.red.length}): ${r2.red.join(' | ') || '(none — the mutant is invisible to master)'}`);
    } finally {
      writeFileSync(tp, tb.body);
      console.log(`HASH AFTER  /test/api.test.js: ${sha(tp)} ${sha(tp) === tb.hash ? 'IDENTICAL' : 'MISMATCH'}`);
    }
  }
} finally {
  for (const b of backups) {
    writeFileSync(b.p, b.body);
    const now = sha(b.p);
    console.log(`HASH AFTER  ${b.p.replace(CHAT, '')}: ${now} ${now === b.hash ? 'IDENTICAL' : 'MISMATCH'}`);
  }
  const st = spawnSync('git', ['-C', W, 'status', '--porcelain'], { encoding: 'utf8' });
  console.log(`GIT STATUS --porcelain: ${JSON.stringify(st.stdout)}`);
}
