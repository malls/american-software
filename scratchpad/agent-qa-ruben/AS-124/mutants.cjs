// AS-124 review (qa-ruben): plan §3 mutation battery. Runs on a scratch detached
// worktree (never $W), anchors each mutant on text that can only hit the intended
// site, asserts the mutation applied (exactly one occurrence, then the file
// changed), runs the FULL host suite, records the exact red set, restores with
// `git checkout -- .` and proves the tree with `git diff --exit-code`.
const { spawnSync } = require('node:child_process');
const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const SCRATCH = process.argv[2];
const only = process.argv[3] ? process.argv[3].split(',') : null;
const APP = path.join(SCRATCH, 'apps/chat');
const SERVER = path.join(APP, 'server.js');
const WATCHER = path.join(APP, 'watch/advance-watcher.mjs');

const M3_WINDOW_ONLY = `if (!(() => {
            const window = eventsTail.lastBytes;
            if (window.length === 0 || eventsTail.offset < window.length) return true;
            const seen = Buffer.alloc(window.length);
            const got = readSync(fd, seen, 0, window.length, eventsTail.offset - window.length);
            return got === window.length && seen.equals(window);
          })()) {`;

const MUTANTS = {
  M1: { file: SERVER, from: `if (!prefixMatches(fd, eventsTail.offset)) {`, to: `if (true || !prefixMatches(fd, eventsTail.offset)) {`,
        predicted: ['stream-company-swap-identical-prefix-adopts', 'stream-company-swap-identical-prefix-with-partial'] },
  M2: { file: SERVER, from: `if (!prefixMatches(fd, eventsTail.offset)) {`, to: `if (false && !prefixMatches(fd, eventsTail.offset)) {`,
        predicted: ['stream-company-replaced-new-inode'] },
  M3: { file: SERVER, from: `if (!prefixMatches(fd, eventsTail.offset)) {`, to: M3_WINDOW_ONLY,
        predicted: ['stream-company-replaced-new-inode'] },
  M4: { file: SERVER, edits: [
          { from: `          eventsTail.hash.update(chunk);\n`, to: `` },
          { from: `    const { events, malformed } = parseJsonl(buf.subarray(0, nl + 1).toString('utf8'));`,
            to: `    eventsTail.hash.update(buf.subarray(0, nl + 1));\n    const { events, malformed } = parseJsonl(buf.subarray(0, nl + 1).toString('utf8'));` },
        ],
        predicted: ['stream-company-swap-identical-prefix-with-partial'] },
  M5: { file: SERVER, from: `resetTail(confirmIno ? 'replaced' : 'truncated');`, to: `resetTail('truncated');`,
        predicted: ['stream-company-replaced-shorter-new-inode'] },
  M6: { file: SERVER, from: `    eventsTail.malformed = 0;\n    eventsTail.ino = null;`, to: `    eventsTail.ino = null;`,
        predicted: ['stream-company-reset-recounts-malformed'] },
  M7: { file: WATCHER, from: `          cycle: stage.cycle ?? null,\n`, to: ``,
        predicted: ['watcher-events-cut-close-carries-cycle'] },
  R9: { file: SERVER, from: `if (size === eventsTail.offset && !confirmIno) {`, to: `if (size === eventsTail.offset) {`, predicted: ['(equivalent? deferred confirm)'] },
  R11: { file: SERVER, from: `    eventsTail.lastBytes = Buffer.alloc(0);\n    eventsTail.hash = createHash('sha256');`, to: `    eventsTail.lastBytes = Buffer.alloc(0);`, predicted: ['(no test predicted: hash not reset after a reset)'] },
  R13: { file: SERVER, from: `    if (!confirmIno) eventsTail.ino = ino;`, to: `    eventsTail.ino = ino;`, predicted: ['(no test predicted: adopt before confirm)'] },
  M8: { file: WATCHER, from: `          cycle: stage.cycle ?? null,\n`, to: `          cycle: null,\n`,
        predicted: ['watcher-events-cut-close-carries-cycle'] },
};

function count(hay, needle) { return hay.split(needle).length - 1; }

function apply(name, m) {
  const edits = m.edits || [{ from: m.from, to: m.to }];
  const before = readFileSync(m.file, 'utf8');
  let text = before;
  for (const e of edits) {
    const n = count(text, e.from);
    if (n !== 1) throw new Error(`${name}: anchor matched ${n} times, expected exactly 1: ${JSON.stringify(e.from.slice(0, 60))}`);
    text = text.replace(e.from, e.to);
  }
  if (text === before) throw new Error(`${name}: mutation did not change the file`);
  writeFileSync(m.file, text);
  // Assert applied AT THE SITE: the anchor text is gone / replaced, and print the hunk.
  const after = readFileSync(m.file, 'utf8');
  for (const e of edits) {
    if (count(after, e.to) !== count(text, e.to)) throw new Error(`${name}: written file does not carry the replacement`);
    if (!e.to.includes(e.from) && count(after, e.from) !== 0) throw new Error(`${name}: anchor still present after write`);
  }
  const diff = spawnSync('git', ['-C', SCRATCH, 'diff', '--unified=1', '--', path.relative(SCRATCH, m.file)], { encoding: 'utf8' }).stdout;
  console.log(`--- ${name} applied to ${path.relative(SCRATCH, m.file)}; hunk:`);
  console.log(diff.split('\n').filter((l) => /^(@@|[-+][^-+])/.test(l)).join('\n'));
}

function runSuite() {
  const r = spawnSync('node', ['--test'], { cwd: APP, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const out = (r.stdout || '') + (r.stderr || '');
  const grab = (k) => (out.match(new RegExp(`ℹ ${k} (\\d+)`)) || [])[1];
  const idx = out.indexOf('✖ failing tests:');
  const failing = idx === -1 ? [] : [...out.slice(idx).matchAll(/^✖ ([^:\n]+)/gm)].map((x) => x[1].replace(/\s*\([\d.]+ms\)\s*$/, '').trim()).filter((n) => n !== 'failing tests');
  return { status: r.status, tests: grab('tests'), pass: grab('pass'), fail: grab('fail'), skipped: grab('skipped'), failing: [...new Set(failing)] };
}

function restore() {
  spawnSync('git', ['-C', SCRATCH, 'checkout', '--', '.'], { encoding: 'utf8' });
  const clean = spawnSync('git', ['-C', SCRATCH, 'diff', '--exit-code'], { encoding: 'utf8' });
  if (clean.status !== 0) throw new Error('scratch tree NOT clean after restore');
  return true;
}

const results = [];
for (const [name, m] of Object.entries(MUTANTS)) {
  if (only && !only.includes(name)) continue;
  try {
    apply(name, m);
    const r = runSuite();
    const red = r.failing.sort();
    const predicted = [...m.predicted].sort();
    const match = JSON.stringify(red) === JSON.stringify(predicted);
    results.push({ name, ...r, red, predicted, match });
    console.log(`${name}: tests=${r.tests} pass=${r.pass} fail=${r.fail} skipped=${r.skipped} red=${JSON.stringify(red)} predicted=${JSON.stringify(predicted)} ${match ? 'MATCH' : 'MISMATCH'}`);
  } finally {
    restore();
    console.log(`${name}: restored; git diff --exit-code clean`);
  }
}
console.log('\nSUMMARY');
for (const r of results) console.log(`${r.name} fail=${r.fail} red=${JSON.stringify(r.red)} ${r.match ? 'MATCH' : 'MISMATCH'}`);
