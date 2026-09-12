// AS-111 §3 mutant driver. node mutants.mjs <M1|M2|...> [...]
// For each mutant: apply an ANCHORED replacement on the scratch worktree,
// assert it applied exactly once at the intended site (print the line), run
// the full host suite, record the failing-test set, restore with git checkout,
// prove the tree clean. Never touches .worktrees/AS-111.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const S = '/tmp/AS-111-mutant';
const CHAT = join(S, 'apps/chat');

// Each mutant: { file, find (string or RegExp, must match exactly once), replace, expect }.
const MUTANTS = {
  M1: {
    desc: 'server.js readEvents: task filter BEFORE the since block (pre-b0763ad ordering)',
    file: 'server.js',
    find: /    let events = s\.events;\n    if \(since\) \{/,
    replace: "    let events = s.events;\n    if (task) events = events.filter((ev) => ev && ev.data && ev.data.task === task); // MUTANT M1\n    if (since) {",
    expect: ['api-events-since-resolves-before-task-filter'],
  },
  M2: {
    desc: 'server.js lanesKey: lastId back in the events block',
    file: 'server.js',
    find: /      events: p\.events && \{\n        reason: p\.events\.reason,\n        open: p\.events\.open,/,
    replace: '      events: p.events && {\n        reason: p.events.reason,\n        lastId: p.events.lastId, // MUTANT M2\n        open: p.events.open,',
    expect: ['stream-lanes-no-frame-for-laneless-event'],
  },
  M3: {
    desc: 'server.js lanesKey: malformed back in the events block',
    file: 'server.js',
    find: /      events: p\.events && \{\n        reason: p\.events\.reason,\n        open: p\.events\.open,/,
    replace: '      events: p.events && {\n        reason: p.events.reason,\n        malformed: p.events.malformed, // MUTANT M3\n        open: p.events.open,',
    expect: ['stream-lanes-no-frame-for-laneless-event'],
  },
  M4: {
    desc: 'server.js lanesKey: drop reason from the events block',
    file: 'server.js',
    find: /      events: p\.events && \{\n        reason: p\.events\.reason,\n        open: p\.events\.open,/,
    replace: '      events: p.events && {\n        // MUTANT M4: reason dropped\n        open: p.events.open,',
    expect: ['stream-company-replaced-new-inode', 'stream-company-replaced-same-inode'],
  },
  M5: {
    desc: 'server.js tailEvents: delete the inode compare',
    file: 'server.js',
    find: /    if \(eventsTail\.ino !== null && ino !== eventsTail\.ino\) \{\n      resetTail\('replaced'\);\n      restarted = 'replaced';\n    \}/,
    replace: "    if (false) { // MUTANT M5: inode compare deleted\n      resetTail('replaced');\n      restarted = 'replaced';\n    }",
    expect: ['stream-company-replaced-new-inode'],
  },
  M6: {
    desc: 'server.js tailEvents: delete the bytes-before-cursor compare',
    file: 'server.js',
    find: /        if \(window\.length > 0 && eventsTail\.offset >= window\.length\) \{/,
    replace: '        if (false) { // MUTANT M6: bytes compare deleted',
    expect: ['stream-company-replaced-same-inode'],
  },
  M7: {
    desc: "server.js tailEvents: report both detections as 'truncated'",
    file: 'server.js',
    find: /resetTail\('replaced'\)/g,
    replace: "resetTail('truncated')",
    expectCount: 2,
    expect: ['stream-company-replaced-new-inode', 'stream-company-replaced-same-inode'],
  },
  M8: {
    desc: 'public/lanes.js: remove the replaced sentence',
    file: 'public/lanes.js',
    find: /  replaced:\n    'the company event stream file was swapped out underneath the server[^\n]*\n[^\n]*\n/,
    replace: '',
    expect: ['lanes-label-events-reason-table'],
  },
  M9: {
    desc: 'lib/events.js matches(): delete the cycle predicate',
    file: 'lib/events.js',
    find: /  if \(ev\.data\?\.cycle != null && open\.cycle != null && ev\.data\.cycle !== open\.cycle\) return false;\n  return true;/,
    replace: '  return true; // MUTANT M9: cycle predicate deleted',
    expect: ['events-close-matches-cycle'],
  },
  M10: {
    desc: 'bin/events.js closing(): delete the cycle predicate',
    file: 'bin/events.js',
    find: /    && !\(data\.cycle != null && item\.cycle != null && data\.cycle !== item\.cycle\)\);/,
    replace: '    ); // MUTANT M10: cycle predicate deleted',
    expect: ['events-cli-close-lookup-honours-cycle'],
  },
  M11: {
    desc: 'lib/events.js matches(): a null on either side is a mismatch',
    file: 'lib/events.js',
    find: /  if \(ev\.data\?\.cycle != null && open\.cycle != null && ev\.data\.cycle !== open\.cycle\) return false;/,
    replace: '  if (ev.data?.cycle !== open.cycle) return false; // MUTANT M11: null is a mismatch',
    expect: ['events-close-matches-cycle', 'api-events-since-exclusive', 'stream-lanes-liveness-change-only', 'stream-company-truncation'],
  },
};

function sh(argv, opts = {}) {
  const [bin, ...args] = argv;
  return spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts });
}

function clean() {
  const r = sh(['git', '-C', S, 'diff', '--exit-code', '--stat']);
  return r.status === 0;
}

for (const name of process.argv.slice(2)) {
  const m = MUTANTS[name];
  if (!m) { console.log(`unknown mutant ${name}`); process.exit(2); }
  if (!clean()) { console.log(`${name}: scratch tree dirty before mutation — abort`); process.exit(2); }
  const path = join(CHAT, m.file);
  const src = readFileSync(path, 'utf8');
  const matches = src.match(m.find);
  const count = m.find.global ? (matches ? matches.length : 0) : (matches ? 1 : 0);
  const want = m.expectCount ?? 1;
  if (count !== want) { console.log(`${name}: pattern matched ${count} times (want ${want}) — NOT applied`); process.exit(2); }
  const out = src.replace(m.find, m.replace);
  if (out === src) { console.log(`${name}: replacement produced no change — NOT applied`); process.exit(2); }
  writeFileSync(path, out);
  // Assert applied at the intended site: print the diff hunk.
  const diff = sh(['git', '-C', S, 'diff', '--', `apps/chat/${m.file}`]).stdout;
  const hunkLines = diff.split('\n').filter((l) => /^[-+]/.test(l) && !/^(---|\+\+\+)/.test(l));
  console.log(`\n=== ${name}: ${m.desc}`);
  console.log(`site (${m.file}):`);
  for (const l of hunkLines) console.log('  ' + l);
  const lineNo = diff.match(/@@ -(\d+)/);
  console.log(`  @ line ${lineNo ? lineNo[1] : '?'}`);

  const r = sh(['node', '--test'], { cwd: CHAT });
  const text = (r.stdout || '') + (r.stderr || '');
  writeFileSync(join(HERE, `mutant-${name}.log`), text);
  // node's spec reporter: `ℹ tests N` and `✖ <name> (ms)` (file-level rows are `✖ test/x.test.js`).
  const summary = text.match(/ℹ tests (\d+)[\s\S]*?ℹ pass (\d+)[\s\S]*?ℹ fail (\d+)/);
  const failing = [...text.matchAll(/^✖ ([^\n]+?) \(\d+(?:\.\d+)?ms\)$/gm)]
    .map((x) => x[1])
    .filter((n) => !n.startsWith('test/'))
    .map((n) => n.replace(/:.*$/, '').trim());
  const observed = [...new Set(failing)].sort();
  const expected = [...m.expect].sort();
  const same = JSON.stringify(observed) === JSON.stringify(expected);
  console.log(`suite: ${summary ? `tests ${summary[1]} pass ${summary[2]} fail ${summary[3]}` : 'no summary'}`);
  console.log(`observed red: [${observed.join(', ')}]`);
  console.log(`predicted   : [${expected.join(', ')}]`);
  console.log(same ? 'RESULT: exact match' : 'RESULT: DEVIATION');

  sh(['git', '-C', S, 'checkout', '--', '.']);
  console.log(`restored: ${clean() ? 'tree clean' : 'TREE STILL DIRTY'}`);
}
