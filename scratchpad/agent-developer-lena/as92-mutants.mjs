// AS-92 mutant battery — runs on a scratch `git archive` copy of the branch,
// never on the worktree. For each mutant: assert the pattern occurs exactly
// once AND inside the intended enclosing function (anchor window), apply,
// assert applied, run the three test files, collect the failing set, restore
// the file from the pristine copy, assert restored.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WORKTREE = '/Users/forrest/Code/american-software-company/.worktrees/AS-92';
const scratch = mkdtempSync(join(tmpdir(), 'as92-mut-'));
const tar = execFileSync('git', ['-C', WORKTREE, 'archive', 'HEAD', 'apps/chat'], { maxBuffer: 1 << 28 });
mkdirSync(scratch, { recursive: true });
spawnSync('tar', ['-x', '-C', scratch], { input: tar });
const app = join(scratch, 'apps', 'chat');
const target = join(app, 'watch', 'advance-watcher.mjs');
const pristine = readFileSync(target, 'utf8');

const T = {
  T1: 'tickChildEnv: pins exactly',
  T2: 'AS-92 tickPathPrepend: a thin PATH gains',
  T3: 'AS-92 tickPathPrepend: directories already on PATH',
  T4: 'AS-92 tickPathPrepend: ADVANCE_TICK_PATH_EXTRA',
  T5: 'AS-92 tickPathPrepend / tickChildEnv: nothing resolvable',
  T6: 'AS-92 resolveGhBin',
  T7: 'AS-92 makeWatcher: fire() spawns the tick with the prepended PATH',
  T8: 'AS-92 real process',
  AS82PIN: 'AS-82 makeWatcher: the spawn call site passes tickArgv() and tickChildEnv() verbatim',
};

const inFn = (name, next) => ({ after: `export function ${name}(`, before: next });
const MUTANTS = [
  { id: 'M1', anchor: inFn('tickPathPrepend', 'export function resolveGitBin'),
    find: 'if (docker.bin) candidates.push(dirname(docker.bin));', repl: 'if (docker.bin) { /* M1 */ }',
    predicted: ['T2', 'T4', 'T7', 'T8'] },
  { id: 'M2', anchor: inFn('tickPathPrepend', 'export function resolveGitBin'),
    find: 'if (gh.bin) candidates.push(dirname(gh.bin));', repl: 'if (gh.bin) { /* M2 */ }',
    predicted: ['T2', 'T7', 'T8'] },
  { id: 'M3', anchor: inFn('tickPathPrepend', 'export function resolveGitBin'),
    find: 'for (const dir of unique) (onPath.has(dir) ? present : add).push(dir);', repl: 'for (const dir of unique) add.push(dir);',
    predicted: ['T3'] },
  { id: 'M4', anchor: inFn('tickPathPrepend', 'export function resolveGitBin'),
    find: "(env.ADVANCE_TICK_PATH_EXTRA ?? '')", repl: "('')",
    predicted: ['T4'] },
  { id: 'M5', anchor: inFn('tickPathPrepend', 'export function resolveGitBin'),
    find: 'const unique = [...new Set(candidates)];', repl: 'const unique = [...candidates];',
    predicted: ['T4'] },
  { id: 'M6', anchor: inFn('tickChildEnv', 'export function tickArgv'),
    find: "PATH: pathPrepend.length === 0 ? env.PATH : [...pathPrepend, ...(env.PATH ? [env.PATH] : [])].join(':'),",
    repl: "PATH: [...pathPrepend, env.PATH ?? ''].join(':'),",
    predicted: ['T5'] },
  { id: 'M7', anchor: inFn('resolveGhBin', 'export function tickPathPrepend'),
    find: "const override = env.ADVANCE_GH_BIN;\n  if (override) {\n    return exists(override) ? { bin: override, reason: 'override' } : { bin: null, reason: 'override-missing' };\n  }",
    repl: "const override = env.ADVANCE_GH_BIN;\n  if (override && exists(override)) return { bin: override, reason: 'override' };",
    predicted: ['T6'] },
  { id: 'M8', anchor: { after: 'function fire(sentinel) {', before: 'child = proc;' },
    find: 'env: tickChildEnv(env, pid, nonce, tickPath.add),', repl: 'env: tickChildEnv(env, pid, nonce),',
    predicted: ['T7'] },
  { id: 'M9', anchor: { after: 'function fire(sentinel) {', before: 'child = proc;' },
    find: "    log(`TICK-PATH add ${fmt(tickPath.add)} present ${fmt(tickPath.present)} unresolved ${fmt(tickPath.unresolved)}`);\n", repl: '',
    predicted: ['T7'] },
];

const count = (s, needle) => s.split(needle).length - 1;
function runTests() {
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'test/watcher.test.js', 'test/watcher-main.test.js', 'test/watcher-process.test.js'], { cwd: app, encoding: 'utf8', maxBuffer: 1 << 28 });
  const out = r.stdout + r.stderr;
  const failed = out.split('\n').filter((l) => /^not ok \d+ - /.test(l)).map((l) => l.replace(/^not ok \d+ - /, ''));
  const total = (out.match(/^# tests (\d+)/m) || [])[1];
  const pass = (out.match(/^# pass (\d+)/m) || [])[1];
  const fail = (out.match(/^# fail (\d+)/m) || [])[1];
  return { failed, total, pass, fail, status: r.status };
}
const label = (name) => Object.entries(T).find(([, prefix]) => name.startsWith(prefix))?.[0] ?? `?(${name})`;

// Sanity: the pristine scratch copy is green.
const base = runTests();
console.log(`pristine scratch: ${base.total}/${base.pass}/${base.fail} exit ${base.status}`);
if (base.status !== 0) { console.log(base.failed); process.exit(2); }

const results = [];
for (const m of MUTANTS) {
  const src = readFileSync(target, 'utf8');
  if (src !== pristine) throw new Error(`${m.id}: file not pristine before mutation`);
  const n = count(src, m.find);
  const at = src.indexOf(m.find);
  const a = src.indexOf(m.anchor.after);
  const b = src.indexOf(m.anchor.before, a);
  const inWindow = at > a && at < b;
  if (n !== 1 || !inWindow) throw new Error(`${m.id}: pattern count ${n}, in-window ${inWindow} — refusing to mutate`);
  const mutated = src.replace(m.find, m.repl);
  writeFileSync(target, mutated);
  const applied = readFileSync(target, 'utf8');
  if (applied === pristine || count(applied, m.find) !== 0 || (m.repl && count(applied, m.repl) < 1)) throw new Error(`${m.id}: mutation did not apply`);
  const r = runTests();
  const red = [...new Set(r.failed.map(label))].sort();
  const predicted = [...m.predicted].sort();
  const match = JSON.stringify(red) === JSON.stringify(predicted);
  results.push({ id: m.id, red, predicted, match, total: r.total, pass: r.pass, fail: r.fail, exit: r.status, as82pin: red.includes('AS82PIN') });
  console.log(`${m.id}: exit ${r.status} ${r.total}/${r.pass}/${r.fail} red=${JSON.stringify(red)} predicted=${JSON.stringify(predicted)} ${match ? 'MATCH' : 'MISMATCH'}`);
  writeFileSync(target, pristine);
  if (readFileSync(target, 'utf8') !== pristine) throw new Error(`${m.id}: restore failed`);
}
const post = runTests();
console.log(`restored scratch: ${post.total}/${post.pass}/${post.fail} exit ${post.status}`);
console.log(JSON.stringify(results, null, 1));
rmSync(scratch, { recursive: true, force: true });
