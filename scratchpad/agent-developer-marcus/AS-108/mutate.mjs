// AS-108 mutant battery driver (developer-marcus). One indivisible step per
// mutant: back up, mutate, ASSERT the mutation applied at the intended site
// (exactly one match, inside the named enclosing function), run the full
// host suite, record the exact failing set, restore, prove with
// `git diff --exit-code`. Usage: node mutate.mjs [M1 M2 ...] (default: all).
import { readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const W = '/Users/forrest/Code/american-software-company/.worktrees/AS-108';
const WATCHER = `${W}/apps/chat/watch/advance-watcher.mjs`;
const LANES = `${W}/apps/chat/lib/lanes.js`;

// Enclosing-function anchor: the match must lie between `function <name>` and
// the next top-level `function`/`export function` line after it.
function fnRange(src, name, from = 0) {
  const lines = src.split('\n');
  const start = lines.findIndex((l, i) => i >= from && new RegExp(`^\\s*(export )?(async )?function ${name}\\b`).test(l));
  if (start < 0) throw new Error(`no function ${name}`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^(export )?(async )?function \w+/.test(lines[i]) || /^  (async )?function \w+/.test(lines[i])) { end = i; break; }
  }
  return { start: start + 1, end: end + 1 };
}

const MUTANTS = {
  M1: { file: WATCHER, fn: 'evaluate', edits: [['      const root = canonRoot();', '      const root = repoRoot;']],
        expect: ['watcher-lanes-symlinked-root', 'watcher-lanes-realpath-default-wiring'] },
  M2: { file: WATCHER, fn: 'evaluate', edits: [
          ['      const root = canonRoot();', '      const root = rootOnce;'],
        ], extra: [['  function persist(body) {', '  const rootOnce = canonRoot();\n  function persist(body) {']],
        expect: ['watcher-lanes-symlinked-root'] },
  M3a: { file: WATCHER, fn: 'canonRoot', edits: [['      return repoRoot;\n    }\n  }', "      return '';\n    }\n  }"]],
        expect: ['watcher-lanes-realpath-fallback'] },
  M3b: { file: WATCHER, fn: 'canonRoot', edits: [['      if (lastRealpathWarn !== key) {', '      if (true || lastRealpathWarn !== key) {']],
        expect: ['watcher-lanes-realpath-fallback'] },
  M5: { file: WATCHER, fn: 'makeLanesOps', edits: [['  realpath = defaultRealpath,', '  realpath = (p) => p,']],
        expect: ['watcher-lanes-realpath-default-wiring'] },
  M6: { file: WATCHER, fn: 'relPathOf', edits: [['  return `${OUTSIDE_REPO}/${base}#${digest}`;', '  return `${OUTSIDE_REPO}/${base}`;']],
        expect: ['lanes-relpath-outside-repo', 'lanes-relpath-outside-distinct-basenames', 'lanes-relpath-outside-suffix-stable'] },
  M7: { file: WATCHER, fn: 'relPathOf', edits: [["  const digest = createHash('sha256').update(stripped)", "  const digest = createHash('sha256').update(p)"]],
        expect: ['lanes-relpath-outside-repo', 'lanes-relpath-outside-suffix-stable'] },
  M8: { file: WATCHER, fn: 'relPathOf', edits: [["  const digest = createHash('sha256').update(stripped).digest('hex').slice(0, 8);", '  const digest = Math.random().toString(16).slice(2, 10);']],
        expect: ['lanes-relpath-outside-repo', 'lanes-relpath-outside-suffix-stable'] },
  M9: { file: WATCHER, fn: 'relPathOf', edits: [['  return `${OUTSIDE_REPO}/${base}#${digest}`;', '  return `${OUTSIDE_REPO}/${p}`;']],
        expect: ['lanes-relpath-outside-repo', 'lanes-relpath-outside-distinct-basenames'] },
  M10: { file: LANES, fn: 'composeLanes', edits: [['    const key = task?.short_id ?? view.relPath ?? row.relPath ?? null;', "    const key = task?.short_id ?? view.relPath?.split('#')[0] ?? row.relPath ?? null;"]],
        expect: ['lanes-compose-outside-lanes-distinct-keys'] },
};

function count(hay, needle) { return hay.split(needle).length - 1; }

function apply(id) {
  const m = MUTANTS[id];
  const orig = readFileSync(m.file, 'utf8');
  let src = orig;
  // Inner functions of makeLanesOps share names with makeDeployOps's (evaluate,
  // persist): anchor the search to start AFTER makeLanesOps's own line.
  const outerFrom = m.file === WATCHER && m.fn !== 'relPathOf' && m.fn !== 'makeLanesOps'
    ? fnRange(orig, 'makeLanesOps').start - 1
    : 0;
  const range = fnRange(orig, m.fn, outerFrom);
  for (const [from, to] of m.edits) {
    const n = count(src, from);
    if (n !== 1) throw new Error(`${id}: pattern matched ${n} times, need exactly 1: ${from}`);
    const line = src.slice(0, src.indexOf(from)).split('\n').length;
    if (line < range.start || line >= range.end) throw new Error(`${id}: match at line ${line} is outside ${m.fn} [${range.start},${range.end})`);
    src = src.replace(from, to);
    console.log(`  applied at ${m.file.split('/').slice(-1)[0]}:${line} inside ${m.fn} [${range.start},${range.end})`);
  }
  for (const [from, to] of m.extra ?? []) {
    const n = count(src, from);
    if (n !== 1) throw new Error(`${id}: extra pattern matched ${n} times: ${from}`);
    src = src.replace(from, to);
    console.log(`  extra edit applied`);
  }
  if (src === orig) throw new Error(`${id}: mutation did not change the file`);
  return { m, orig, src };
}

function runSuite() {
  const r = spawnSync('node', ['--test'], { cwd: `${W}/apps/chat`, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = r.stdout + r.stderr;
  const tests = Number(/^ℹ tests (\d+)/m.exec(out)?.[1]);
  const pass = Number(/^ℹ pass (\d+)/m.exec(out)?.[1]);
  const fail = Number(/^ℹ fail (\d+)/m.exec(out)?.[1]);
  const failing = [...new Set([...out.matchAll(/^✖ (.+?): /gm)].map((x) => x[1]))];
  return { code: r.status, tests, pass, fail, failing };
}

const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(MUTANTS);
const summary = [];
for (const id of ids) {
  console.log(`\n== ${id}`);
  const { m, orig, src } = apply(id);
  const bak = m.file + '.as108bak';
  copyFileSync(m.file, bak);
  const restore = () => { writeFileSync(m.file, orig); try { unlinkSync(bak); } catch {} };
  process.on('exit', restore);
  try {
    writeFileSync(m.file, src);
    const after = readFileSync(m.file, 'utf8');
    if (after !== src || after === orig) throw new Error(`${id}: mutated file not on disk`);
    const r = runSuite();
    const red = r.failing.sort();
    const want = [...m.expect].sort();
    const same = JSON.stringify(red) === JSON.stringify(want);
    console.log(`  suite: ${r.tests} examined / ${r.pass} pass / ${r.fail} fail (exit ${r.code})`);
    console.log(`  red:      ${red.join(', ') || '(none — SURVIVOR)'}`);
    console.log(`  expected: ${want.join(', ')}`);
    console.log(`  verdict:  ${same ? 'as predicted' : red.length === 0 ? 'SURVIVOR' : 'DEVIATION'}`);
    summary.push({ id, red, want, same, survivor: red.length === 0 });
  } finally {
    restore();
    process.off('exit', restore);
    const d = spawnSync('git', ['-C', W, 'diff', '--exit-code', '--', m.file], { encoding: 'utf8' });
    console.log(`  restored: git diff --exit-code -> ${d.status === 0 ? 'clean' : 'DIRTY'}`);
    if (d.status !== 0) throw new Error(`${id}: worktree dirty after restore`);
  }
}
console.log('\n== summary');
for (const s of summary) console.log(`${s.id}: ${s.survivor ? 'SURVIVOR' : s.same ? 'red as predicted' : 'DEVIATION'} — red [${s.red.join(', ')}] expected [${s.want.join(', ')}]`);
console.log(`${summary.length} applied / ${summary.filter((s) => s.same).length} red as predicted / ${summary.filter((s) => !s.same).length} deviations`);
