// AS-85 mutation battery. One indivisible step per mutant: back up, mutate,
// ASSERT THE MUTATION APPLIED AT THE INTENDED SITE (unique literal + line
// number), run the counted host suite, record the exact failing set, restore,
// prove the tree clean with `git diff --exit-code`.
import { readFileSync, writeFileSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { globSync } from 'node:fs';

const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-85';
const PAD = '/Users/forrest/Code/american-software-company/scratchpad/agent-developer-lena/AS-85';
const SERVER = `${WT}/apps/chat/server.js`;
const STREAM = `${WT}/apps/chat/test/stream.test.js`;
const TESTS = globSync(`${WT}/apps/chat/test/*.test.js`).sort();

const KEY_LINE =
  'build: { id: s.build.id, desiredId: s.build.desiredId, current: s.build.current, reason: s.build.reason },';

const MUTANTS = [
  ['F1', STREAM,
    'const { base, get } = await bootServer(t, FIXTURE_ROOT, buildBootOpts(dataDir));',
    'const { base, get } = await bootServer(t, FIXTURE_ROOT, { ...buildBootOpts(dataDir), buildId: null });'],
  ['F2', STREAM,
    'computedAt: new Date(Date.now() + i + 1).toISOString(),',
    'computedAt: firstCheckedAt,'],
  ['M1', SERVER, KEY_LINE,
    'build: { id: s.build.id, desiredId: s.build.desiredId, current: s.build.current, reason: s.build.reason, checkedAt: s.build.checkedAt },'],
  ['M2', SERVER, KEY_LINE,
    'build: { id: s.build.id, desiredId: s.build.desiredId, reason: s.build.reason },'],
  ['M3', SERVER, KEY_LINE,
    'build: { id: s.build.id, current: s.build.current, reason: s.build.reason },'],
  ['M4', SERVER, KEY_LINE,
    'build: { id: s.build.id, desiredId: s.build.desiredId, current: s.build.current },'],
  ['M5', SERVER, KEY_LINE, 'build: null,'],
];

const only = process.argv.slice(2);
const count = (hay, needle) => hay.split(needle).length - 1;
const lineOf = (src, needle) => src.split('\n').findIndex((l) => l.includes(needle)) + 1;

for (const [label, file, find, repl] of MUTANTS) {
  if (only.length && !only.includes(label)) continue;
  const bak = `${PAD}/${label}.bak`;
  const before = readFileSync(file, 'utf8');
  copyFileSync(file, bak);
  const restore = () => { if (existsSync(bak)) { copyFileSync(bak, file); rmSync(bak); } };
  process.on('exit', restore);
  try {
    const nBefore = count(before, find);
    if (nBefore !== 1) throw new Error(`ABORT ${label}: anchor matched ${nBefore}x (need 1)`);
    const mutated = before.replace(find, repl);
    writeFileSync(file, mutated);
    const after = readFileSync(file, 'utf8');
    console.log(`=== ${label} — ${file.replace(WT + '/', '')} ===`);
    console.log(`grep -c anchor BEFORE = ${nBefore}`);
    console.log(`grep -c anchor AFTER  = ${count(after, find)}`);
    console.log(`grep -c mutant AFTER  = ${count(after, repl)}  (line ${lineOf(after, repl)})`);
    console.log(`mutant line: ${after.split('\n')[lineOf(after, repl) - 1].trim()}`);

    const r = spawnSync(process.execPath, ['--test', ...TESTS], { encoding: 'utf8', cwd: WT, maxBuffer: 64 * 1024 * 1024 });
    const out = (r.stdout || '') + (r.stderr || '');
    writeFileSync(`${PAD}/${label}.out`, out);
    const tally = out.match(/^. (tests|pass|fail) \d+$/gm) || [];
    const failing = (out.match(/^✖ .*$/gm) || [])
      .map((l) => l.replace(/ \([0-9.]+ms\)$/, '').replace(/^✖ /, ''))
      .filter((n) => !/^[a-z-]+\.test\.js$/.test(n));
    console.log(`suite exit=${r.status}  ${tally.join('  ')}`);
    console.log(`FAILING SET (${failing.length}):`);
    for (const f of failing) console.log(`  - ${f}`);
  } finally {
    restore();
    process.removeAllListeners('exit');
    const g = spawnSync('git', ['-C', WT, 'diff', '--exit-code', '--stat'], { encoding: 'utf8' });
    console.log(g.status === 0 ? 'tree clean after restore (git diff --exit-code = 0)\n' : `TREE DIRTY:\n${g.stdout}\n`);
  }
}
