// AS-124 mutant battery (plan §3, M1–M8) — developer-lena.
// Runs against the DETACHED scratch worktree only, never .worktrees/AS-124.
// Per mutant: anchored edit (exact line text, asserted to occur exactly once and
// inside the intended function's line span), print the hunk, run the full host
// suite, record the red set + first failure line, restore, prove clean.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const SCRATCH = '/tmp/AS-124-mutant';
const APP = join(SCRATCH, 'apps/chat');
const SERVER = join(APP, 'server.js');
const WATCHER = join(APP, 'watch/advance-watcher.mjs');
const only = process.argv.slice(2);

function sh(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
}

/** Line span of `function <name>(` in file: [start, end) by brace-free heuristic: next line matching /^  function / or EOF. */
function fnSpan(src, name) {
  const lines = src.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`  function ${name}(`));
  if (start < 0) throw new Error(`no function ${name}`);
  let end = lines.findIndex((l, i) => i > start && /^  (function |\/\*\*|const |let )/.test(l));
  if (end < 0) end = lines.length;
  return { start: start + 1, end: end + 1 }; // 1-indexed, [start, end)
}

/** Apply edits: each { file, fn, find, replace, count=1 }. Asserts `find` occurs exactly `count` times in the file, and every occurrence lies inside fn's span. */
function apply(edits) {
  for (const e of edits) {
    const src = readFileSync(e.file, 'utf8');
    const idxs = [];
    let i = src.indexOf(e.find);
    while (i !== -1) { idxs.push(i); i = src.indexOf(e.find, i + 1); }
    const count = e.count ?? 1;
    if (idxs.length !== count) throw new Error(`anchor "${e.find.trim().slice(0, 60)}" occurs ${idxs.length}x, expected ${count}`);
    const span = fnSpan(src, e.fn);
    for (const at of idxs) {
      const line = src.slice(0, at).split('\n').length;
      if (line < span.start || line >= span.end) throw new Error(`anchor at line ${line} is outside ${e.fn} [${span.start}, ${span.end})`);
      console.log(`  site: ${e.file.replace(SCRATCH + '/', '')}:${line} (inside ${e.fn} lines ${span.start}-${span.end - 1})`);
    }
    writeFileSync(e.file, src.split(e.find).join(e.replace));
  }
}

const MUTANTS = {
  M1: {
    what: 'tailEvents: on inode change always resetTail(replaced) without the prefix compare (master behaviour)',
    predicted: ['stream-company-swap-identical-prefix-adopts', 'stream-company-swap-identical-prefix-with-partial'],
    edits: [{ file: SERVER, fn: 'tailEvents', find: '          if (!prefixMatches(fd, eventsTail.offset)) {', replace: '          if (true /* M1 */) {' }],
  },
  M2: {
    what: 'tailEvents: on inode change always adopt (delete the compare)',
    predicted: ['stream-company-replaced-new-inode'],
    edits: [{ file: SERVER, fn: 'tailEvents', find: '          if (!prefixMatches(fd, eventsTail.offset)) {', replace: '          if (false /* M2 */) {' }],
  },
  M3: {
    what: 'tailEvents: on inode change compare only the last TAIL_WINDOW_BYTES instead of the full prefix',
    predicted: ['stream-company-replaced-new-inode'],
    edits: [{
      file: SERVER, fn: 'tailEvents',
      find: '          if (!prefixMatches(fd, eventsTail.offset)) {',
      replace: '          if (!(() => { const w = eventsTail.lastBytes; const s = Buffer.alloc(w.length); const g = readSync(fd, s, 0, w.length, eventsTail.offset - w.length); return g === w.length && s.equals(w); })() /* M3 */) {',
    }],
  },
  M4: {
    what: 'tailEvents: hash complete lines only at the parse step instead of the raw chunk at the read step',
    predicted: ['stream-company-swap-identical-prefix-with-partial'],
    edits: [
      { file: SERVER, fn: 'tailEvents', find: '          eventsTail.hash.update(chunk);\n', replace: '' },
      { file: SERVER, fn: 'tailEvents', find: '    eventsTail.partial = buf.subarray(nl + 1);\n', replace: '    eventsTail.partial = buf.subarray(nl + 1);\n    eventsTail.hash.update(buf.subarray(0, nl + 1)); /* M4 */\n' },
    ],
  },
  M5: {
    what: 'tailEvents: inode change with size < offset → resetTail(truncated)',
    predicted: ['stream-company-replaced-shorter-new-inode'],
    edits: [{ file: SERVER, fn: 'tailEvents', find: "      resetTail(confirmIno ? 'replaced' : 'truncated');", replace: "      resetTail('truncated'); /* M5 */" }],
  },
  M6: {
    what: 'resetTail: delete eventsTail.malformed = 0',
    predicted: ['stream-company-reset-recounts-malformed'],
    edits: [{ file: SERVER, fn: 'resetTail', find: '    eventsTail.malformed = 0;\n', replace: '' }],
  },
  M7: {
    what: 'closeOpen: delete `cycle: stage.cycle ?? null` (anchored on the AS-111 F4 comment)',
    predicted: ['watcher-events-cut-close-carries-cycle'],
    control: 'watcher-events-timeout-closes-as-cut',
    edits: [{
      file: WATCHER, fn: 'closeOpen',
      find: '          // match itself is by startedId regardless.\n          cycle: stage.cycle ?? null,\n',
      replace: '          // match itself is by startedId regardless.\n',
    }],
  },
  M8: {
    what: 'closeOpen: `cycle: null` hard-coded',
    predicted: ['watcher-events-cut-close-carries-cycle'],
    edits: [{
      file: WATCHER, fn: 'closeOpen',
      find: '          // match itself is by startedId regardless.\n          cycle: stage.cycle ?? null,\n',
      replace: '          // match itself is by startedId regardless.\n          cycle: null, /* M8 */\n',
    }],
  },
};

function runSuite() {
  const files = readdirSync(join(APP, 'test')).filter((f) => f.endsWith('.test.js')).map((f) => join('test', f));
  const r = sh('node', ['--test', ...files], { cwd: APP });
  const out = r.stdout + r.stderr;
  const counts = {};
  for (const k of ['tests', 'pass', 'fail', 'skipped']) counts[k] = Number((out.match(new RegExp(`^ℹ ${k} (\\d+)`, 'm')) || [])[1]);
  // node's reporter prints each ✖ twice (inline, then under a "✖ failing tests:" header): dedupe, drop the header.
  const red = [...new Set([...out.matchAll(/^✖ (.+?)(?: \(\d+(?:\.\d+)?ms\))?$/gm)].map((m) => m[1]).filter((t) => t !== 'failing tests:'))];
  const firstFail = (out.match(/^\s+(AssertionError.*|Error.*)$/m) || [])[1] ?? null;
  const failBlock = (out.match(/not ok[\s\S]*?(?=\n(?:not ok|ok |ℹ ))/) || [])[0] ?? '';
  return { counts, red, firstFail, failBlock, status: r.status };
}

const clean = sh('git', ['-C', SCRATCH, 'status', '--porcelain']).stdout.trim();
if (clean) throw new Error(`scratch not clean at start:\n${clean}`);

const results = [];
for (const [id, m] of Object.entries(MUTANTS)) {
  if (only.length && !only.includes(id)) continue;
  console.log(`\n=== ${id}: ${m.what}`);
  apply(m.edits);
  const diff = sh('git', ['-C', SCRATCH, 'diff', '--', 'apps/chat/server.js', 'apps/chat/watch/advance-watcher.mjs']).stdout;
  if (!diff.trim()) throw new Error(`${id}: mutation did not apply`);
  console.log(diff.split('\n').filter((l) => /^[-+@]/.test(l) && !/^(---|\+\+\+)/.test(l)).join('\n'));
  const r = runSuite();
  const redIds = r.red.map((t) => t.split(':')[0]);
  const predicted = [...m.predicted].sort();
  const observed = [...redIds].sort();
  const match = JSON.stringify(predicted) === JSON.stringify(observed);
  console.log(`  counts: ${r.counts.tests}/${r.counts.pass}/${r.counts.fail}/${r.counts.skipped}  exit=${r.status}`);
  console.log(`  red set (${observed.length}): ${observed.join(', ') || '(none — SURVIVOR)'}`);
  console.log(`  predicted: ${predicted.join(', ')}  → ${match ? 'MATCH' : 'MISMATCH'}`);
  if (r.firstFail) console.log(`  first failure: ${r.firstFail}`);
  if (m.control) console.log(`  control ${m.control}: ${redIds.includes(m.control) ? 'RED (unexpected)' : 'green'}`);
  results.push({ id, counts: r.counts, red: observed, predicted, match, firstFail: r.firstFail, control: m.control ? !redIds.includes(m.control) : null, failBlock: r.failBlock });
  sh('git', ['-C', SCRATCH, 'checkout', '--', '.']);
  const proof = sh('git', ['-C', SCRATCH, 'diff', '--exit-code']);
  console.log(`  restored: git diff --exit-code → ${proof.status === 0 ? 'clean' : 'DIRTY'}`);
  if (proof.status !== 0) throw new Error('scratch dirty after restore');
}
writeFileSync(new URL('./mutants-result.json', import.meta.url), JSON.stringify(results, null, 2));
console.log(`\nSUMMARY: ${results.length} mutants, ${results.filter((r) => r.red.length).length} red, ${results.filter((r) => !r.red.length).length} survivors, ${results.filter((r) => !r.match).length} mismatches vs §3`);
