// AS-95 AC-6 mutation battery — the loop-status derivation and the sidebar
// label. Runs against a SCRATCH COPY of apps/chat; the task worktree is never
// mutated. For each mutant: apply, ASSERT APPLIED, run node --test over the
// three files that observe the loop state (unit derivation, unit label, served
// endpoint), record the exact red set, restore, and prove the restore.
import { readFileSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-95/apps/chat';
const root = process.argv[2];
rmSync(root, { recursive: true, force: true });
cpSync(WT, root, {
  recursive: true,
  filter: (src) => !/\/(node_modules|data|\.git)$/.test(src),
});

const TESTS = ['test/loop-status.test.js', 'test/loop-label.test.js', 'test/api.test.js'];

const files = {
  lib: root + '/lib/loop-status.js',
  pub: root + '/public/loop-status.js',
  srv: root + '/server.js',
};
const orig = Object.fromEntries(Object.entries(files).map(([k, p]) => [k, readFileSync(p, 'utf8')]));

const mutants = [
  ['AC-6.1 remove the watcher-loop branch from deriveLoopStatus',
    'lib', ': inWatcherLoop\n        ? \'watcher-loop\'\n        : \'tick\'', ": 'tick'"],
  ['AC-6.2 the lock marker alone stops counting as a witness',
    'lib', "((loop !== null && loop.active) || tick.loopTicks !== null)", '(loop !== null && loop.active)'],
  ['AC-6.3 the mirror file alone stops counting as a witness',
    'lib', "((loop !== null && loop.active) || tick.loopTicks !== null)", '(tick.loopTicks !== null)'],
  ['AC-6.4 loop object is never derived (server sees no loop)',
    'lib', 'const loop = deriveLoop(loopState);', 'const loop = null;'],
  ['AC-6.5 lastLoop is dropped once the loop stops',
    'lib', 'const last = asRecord(rec.lastLoop);', 'const last = null;'],
  ['AC-6.6 remove the watcher-loop case from describeLoopStatus',
    'pub', "case 'watcher-loop': {", "case '__never__': {"],
  ['AC-6.7 label ignores the lock marker, file only',
    'pub', 'status.tick && Number.isInteger(status.tick.loopTicks) ? status.tick.loopTicks : null',
    'null'],
  ['AC-6.8 tone is not mapped (unstyled dot)',
    'pub', "return state === 'watcher-loop' ? 'loop' : state;", 'return state;'],
  ['AC-6.9 the stop-reason sentence is never rendered',
    'pub', "if (status.state !== 'watcher-loop' && status.loop", 'if (false && status.loop'],
  ['AC-6.10 server never reads advance-loop.json',
    'srv', 'loopState: readLoopFile(LOOP_STATE_PATH),', 'loopState: null,'],
];

console.log(`cardinality: ${mutants.length} mutants, ${TESTS.length} test files per run\n`);
for (const [name, key, from, to] of mutants) {
  const src = files[key];
  const base = orig[key];
  const i = base.indexOf(from);
  if (i === -1) { console.log(`${name}\n  MUTATION NOT APPLIED (anchor missing) — mutant VOID\n`); continue; }
  const mutated = base.slice(0, i) + to + base.slice(i + from.length);
  writeFileSync(src, mutated);
  const check = readFileSync(src, 'utf8');
  if (check === base || !check.includes(to)) { console.log(`${name}\n  ASSERT FAILED — mutation not in file\n`); writeFileSync(src, base); continue; }
  const r = spawnSync('node', ['--test', ...TESTS], { cwd: root, encoding: 'utf8' });
  const red = [...(r.stdout || '').matchAll(/^✖ (.+?) \(\d/gm)].map((m) => m[1].trim());
  console.log(`${name}\n  red(${red.length}): ${red.length ? red.join(' | ') : 'NONE — SURVIVED'}  [exit ${r.status}]\n`);
  writeFileSync(src, base);
  if (readFileSync(src, 'utf8') !== base) { console.log('  RESTORE FAILED — stop'); process.exit(1); }
}

// Baseline last: the restored scratch tree must be green, or every red above
// is suspect.
const b = spawnSync('node', ['--test', ...TESTS], { cwd: root, encoding: 'utf8' });
console.log('baseline after restore: exit ' + b.status + ' — ' + (b.stdout.match(/^# (pass|fail) \d+$/gm) || (b.stdout.match(/ℹ (pass|fail) \d+/g) || []).join(', ')));
