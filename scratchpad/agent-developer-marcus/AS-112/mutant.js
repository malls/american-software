// AS-112 mutant driver. Usage: node mutant.js <name> [--no-restore-check]
// Every mutant edits /tmp/AS-112-mutant/apps/chat/public/{style.css,app.js} (or a
// test file for the H6 flip), asserts the mutation applied AT THE INTENDED SITE
// (region-scoped for app.js), runs the WHOLE host suite, prints the red set and the
// first failure message, restores via git checkout, proves porcelain empty, and
// re-runs green.
const { spawnSync } = require('node:child_process');
const { readFileSync, writeFileSync } = require('node:fs');
const assert = require('node:assert/strict');

const S = '/tmp/AS-112-mutant';
const CHAT = `${S}/apps/chat`;
const CSS = `${CHAT}/public/style.css`;
const APP = `${CHAT}/public/app.js`;
const T1FILE = `${CHAT}/test/roster-truncation.test.js`;

const count = (s, needle) => s.split(needle).length - 1;
const region = (app) => {
  const start = app.indexOf('function orgNodeItem(node) {');
  assert.notEqual(start, -1, 'orgNodeItem present');
  return app.slice(start, app.indexOf('\n}\n', start));
};
const META_LINE = "  const meta = [node.title, node.class, node.team].filter(Boolean).join(' \\u00b7 ');\n";
const insertBeforeMeta = (app, line) => {
  assert.equal(count(app, META_LINE), 1, 'the meta line occurs exactly once in app.js');
  return app.replace(META_LINE, line + META_LINE);
};

const MUTANTS = {
  M1: {
    file: CSS,
    mutate: (s) => s + '\n.roster-title { all: unset; }\n',
    applied: (b, a) => {
      assert.equal(count(b, '.roster-title {'), 2); assert.equal(count(a, '.roster-title {'), 3);
      assert.ok(a.lastIndexOf('.roster-title {') > a.indexOf('.roster-status {'), 'appended after .roster-status');
    },
  },
  M2: {
    file: CSS,
    mutate: (s) => s + '\n#roster-list { .roster-title { white-space: normal; } }\n',
    applied: (b, a) => { assert.equal(count(b, '#roster-list { .roster-title {'), 0); assert.equal(count(a, '#roster-list { .roster-title {'), 1); },
  },
  M2b: {
    file: CSS,
    mutate: (s) => s + '\n.roster-title { & { white-space: normal; } }\n',
    applied: (b, a) => { assert.equal(count(b, '& { white-space: normal; }'), 0); assert.equal(count(a, '& { white-space: normal; }'), 1); },
  },
  M3: {
    file: APP,
    mutate: (s) => insertBeforeMeta(s, '  row.appendChild(el("span", "org-extra"));\n'),
    applied: (b, a) => { assert.equal(count(region(b), 'el("'), 0); assert.equal(count(region(a), 'el("'), 1); },
  },
  M3b: {
    file: APP,
    mutate: (s) => insertBeforeMeta(s, "  row.appendChild(el('span', 'org-extra'));\n"),
    applied: (b, a) => { assert.equal(count(region(b), 'org-extra'), 0); assert.equal(count(region(a), 'org-extra'), 1); },
  },
  M4: {
    file: APP,
    mutate: (s) => insertBeforeMeta(s, "  row.classList.add('org-extra');\n"),
    applied: (b, a) => { assert.equal(count(region(b), 'classList.add'), 1); assert.equal(count(region(a), 'classList.add'), 2); },
  },
  R1: {
    file: CSS,
    mutate: (s) => s + '\n.roster-title { white-space: normal; }\n',
    applied: (b, a) => { assert.equal(count(b, '.roster-title {'), 2); assert.equal(count(a, '.roster-title {'), 3); },
  },
  R2: {
    file: CSS,
    mutate: (s) => {
      const anchor = "/* AS-32: the employee's title";
      assert.equal(count(s, anchor), 1, 'the AS-32 comment anchor occurs once');
      return s.replace(anchor, '#roster-list .roster-title { white-space: normal; }\n' + anchor);
    },
    applied: (b, a) => {
      const sel = '#roster-list .roster-title {';
      assert.equal(count(b, sel), 0); assert.equal(count(a, sel), 1);
      assert.ok(a.indexOf(sel) < a.indexOf('\n.roster-title {'), 'inserted ABOVE the base .roster-title rule');
    },
  },
  R3: {
    file: APP,
    mutate: (s) => { assert.equal(count(s, META_LINE), 1); return s.replace(META_LINE, "  const meta = node.title || '';\n"); },
    applied: (b, a) => { assert.equal(count(region(b), 'node.class'), 1); assert.equal(count(region(a), 'node.class'), 0); },
  },
  R4: {
    file: APP,
    mutate: (s) => {
      const anchor = '  item.append(top);\n';
      const rs = s.indexOf('function rosterRow(emp) {');
      const re = s.indexOf('\n}\n', rs);
      assert.equal(count(s.slice(rs, re), anchor.trim()), 1, 'item.append(top) occurs once inside rosterRow');
      assert.equal(count(s, anchor), 1, 'and once in the file');
      return s.replace(anchor, anchor + '  item.append(el("div", "roster-extra"));\n');
    },
    applied: (b, a) => { assert.equal(count(b, 'roster-extra'), 0); assert.equal(count(a, 'roster-extra'), 1); assert.equal(count(region(a), 'roster-extra'), 0, 'NOT in orgNodeItem'); },
  },
  // H6 flip: the new helper case must be a real red/green.
  H6flip: {
    file: T1FILE,
    mutate: (s) => {
      const from = "assert.throws(() => parseRules('#r { .t { white-space: normal; } }'), /cannot score nested style rule/);";
      assert.equal(count(s, from), 1, 'H6 line (a) occurs once');
      return s.replace(from, from.replace('assert.throws', 'assert.doesNotThrow'));
    },
    applied: (b, a) => { assert.equal(count(b, 'assert.doesNotThrow'), 0); assert.equal(count(a, 'assert.doesNotThrow'), 1); },
    only: ['test/roster-truncation.test.js'],
  },
};

function run(files = []) {
  const r = spawnSync('node', ['--test', ...files], { cwd: CHAT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const lines = (r.stdout + r.stderr).split('\n');
  const summary = lines.filter((l) => /^ℹ (tests|pass|fail|skipped) /.test(l)).map((l) => l.replace('ℹ ', '')).join(' | ');
  // The spec reporter recaps every failure under "✖ failing tests:", each ✖
  // line followed by its error line. Read the recap, not the live stream.
  const recap = lines.findIndex((l) => /✖ failing tests:/.test(l));
  const reds = [];
  const messages = [];
  if (recap !== -1) {
    for (let i = recap + 1; i < lines.length; i++) {
      if (/^\s*✖ /.test(lines[i])) {
        reds.push(lines[i].trim().replace(/\s*\([\d.]+ms\)$/, '').replace(/^✖ /, ''));
        const err = lines.slice(i + 1, i + 4).find((l) => /Error/.test(l)) || '';
        messages.push(err.trim().slice(0, 600));
      }
    }
  }
  return { summary, reds, exit: r.status, messages };
}

function porcelain() {
  return spawnSync('git', ['-C', S, 'status', '--porcelain'], { encoding: 'utf8' }).stdout.trim();
}

const name = process.argv[2];
const m = MUTANTS[name];
if (!m) { console.error('unknown mutant', name, Object.keys(MUTANTS)); process.exit(2); }
assert.equal(porcelain(), '', 'scratch tree is clean before mutating');

const before = readFileSync(m.file, 'utf8');
const after = m.mutate(before);
assert.notEqual(after, before, 'mutation changed the file');
writeFileSync(m.file, after);
m.applied(before, readFileSync(m.file, 'utf8'));
console.log(`[${name}] applied at the intended site: OK (${m.file.replace(S + '/', '')})`);

const res = run(m.only || []);
console.log(`[${name}] MUTANT RUN: ${res.summary} | exit ${res.exit}`);
console.log(`[${name}] RED SET (${res.reds.length}):`);
res.reds.forEach((t, i) => { console.log('   - ' + t); console.log('       ' + res.messages[i]); });

// restore
spawnSync('git', ['-C', S, 'checkout', '--', 'apps/chat/public', 'apps/chat/test'], { encoding: 'utf8' });
const p = porcelain();
console.log(`[${name}] restored; porcelain: ${p === '' ? 'EMPTY' : 'DIRTY: ' + p}`);
assert.equal(p, '');
if (!process.argv.includes('--no-restore-check')) {
  const g = run(m.only || []);
  console.log(`[${name}] POST-RESTORE RUN: ${g.summary} | exit ${g.exit} | red ${g.reds.length}`);
}
