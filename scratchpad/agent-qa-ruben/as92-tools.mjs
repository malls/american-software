// qa-ruben AS-92 review helper: scratch copies, test runs, anchored mutants.
// Usage: node as92-tools.mjs <cmd> [...args]
//   archive <ref> <dir>     git archive apps/chat of <ref> into <dir>
//   test <dir>              run node --test in <dir>/apps/chat; print summary + failing test names
//   mutate <dir> <name>     apply named mutant to <dir> (asserts applied at intended site)
//   restore <dir>           re-extract pristine files from the branch and verify identical
//   cmp <dir>               cmp the 4 touched files against the worktree
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO = '/Users/forrest/Code/american-software-company';
const BRANCH = 'feat/AS-92-tick-path-prepend';
const WT = join(REPO, '.worktrees/AS-92/apps/chat');
const FILES = ['watch/advance-watcher.mjs', 'test/watcher.test.js', 'test/watcher-main.test.js', 'test/watcher-process.test.js'];

const [cmd, ...args] = process.argv.slice(2);

function archive(ref, dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const tar = execFileSync('git', ['-C', REPO, 'archive', ref, 'apps/chat'], { maxBuffer: 1 << 28 });
  const r = spawnSync('tar', ['-x', '-C', dir], { input: tar });
  if (r.status !== 0) throw new Error('tar failed: ' + r.stderr);
  console.log(`archived ${ref} -> ${dir}`);
}

function cmp(dir) {
  let same = true;
  for (const f of FILES) {
    const a = readFileSync(join(dir, 'apps/chat', f), 'utf8');
    const b = readFileSync(join(WT, f), 'utf8');
    const eq = a === b;
    same = same && eq;
    console.log(`${eq ? 'same' : 'DIFF'}: ${f}`);
  }
  return same;
}

function test(dir) {
  const cwd = join(dir, 'apps/chat');
  const r = spawnSync(process.execPath, ['--test'], { cwd, encoding: 'utf8', maxBuffer: 1 << 28, env: process.env });
  const out = r.stdout + r.stderr;
  const summary = out.split('\n').filter((l) => /^ℹ (tests|pass|fail|skipped|cancelled)/.test(l)).join(' | ');
  const failing = out.split('\n').filter((l) => /^✖ /.test(l)).map((l) => l.replace(/^✖ /, '').replace(/ \(\d+(\.\d+)?ms\)$/, ''));
  console.log(`SUMMARY ${summary}`);
  console.log(`EXIT ${r.status}`);
  console.log(`RED SET (${failing.length}):`);
  for (const f of failing) console.log(`  - ${f}`);
}

// Each mutant: file, a function that transforms the text, and an "applied" assertion.
const MUTANTS = {
  M1: { // tickPathPrepend: delete docker dirname push
    file: 'watch/advance-watcher.mjs',
    apply: (s) => s.replace('  if (docker.bin) candidates.push(dirname(docker.bin));\n', '  if (docker.bin) { /* M1 */ }\n'),
    check: (s) => s.includes('/* M1 */') && !s.includes('candidates.push(dirname(docker.bin))'),
  },
  M2: { // delete gh dirname push
    file: 'watch/advance-watcher.mjs',
    apply: (s) => s.replace('  if (gh.bin) candidates.push(dirname(gh.bin));\n', '  if (gh.bin) { /* M2 */ }\n'),
    check: (s) => s.includes('/* M2 */') && !s.includes('candidates.push(dirname(gh.bin))'),
  },
  M3: { // remove partition against env.PATH — everything goes to add
    file: 'watch/advance-watcher.mjs',
    apply: (s) => s.replace('  for (const dir of unique) (onPath.has(dir) ? present : add).push(dir);\n', '  for (const dir of unique) add.push(dir); /* M3 */\n'),
    check: (s) => s.includes('/* M3 */') && !s.includes('(onPath.has(dir) ? present : add).push(dir)'),
  },
  M4: { // delete the ADVANCE_TICK_PATH_EXTRA read
    file: 'watch/advance-watcher.mjs',
    apply: (s) => s.replace("  const candidates = (env.ADVANCE_TICK_PATH_EXTRA ?? '')\n", "  const candidates = ('' /* M4 */)\n"),
    check: (s) => s.includes('/* M4 */') && !s.includes('env.ADVANCE_TICK_PATH_EXTRA ??'),
  },
  M5: { // delete de-duplication
    file: 'watch/advance-watcher.mjs',
    apply: (s) => s.replace('  const unique = [...new Set(candidates)];\n', '  const unique = candidates; /* M5 */\n'),
    check: (s) => s.includes('/* M5 */') && !s.includes('new Set(candidates)'),
  },
  M6: { // tickChildEnv: unconditional join
    file: 'watch/advance-watcher.mjs',
    apply: (s) => s.replace("    PATH: pathPrepend.length === 0 ? env.PATH : [...pathPrepend, ...(env.PATH ? [env.PATH] : [])].join(':'),\n", "    PATH: [...pathPrepend, env.PATH ?? ''].join(':'), /* M6 */\n"),
    check: (s) => s.includes('/* M6 */') && !s.includes('pathPrepend.length === 0 ? env.PATH'),
  },
  M7: { // resolveGhBin: override-missing falls through
    file: 'watch/advance-watcher.mjs',
    apply: (s) => {
      const fn = s.indexOf('export function resolveGhBin(env, exists) {');
      const head = s.slice(0, fn), tail = s.slice(fn);
      return head + tail.replace("    return exists(override) ? { bin: override, reason: 'override' } : { bin: null, reason: 'override-missing' };\n", "    if (exists(override)) return { bin: override, reason: 'override' }; /* M7 */\n");
    },
    check: (s) => {
      const fn = s.indexOf('export function resolveGhBin(env, exists) {');
      const body = s.slice(fn, s.indexOf('export function tickPathPrepend'));
      return body.includes('/* M7 */') && !body.includes('override-missing');
    },
  },
  M8: { // spawn site: drop fourth arg
    file: 'watch/advance-watcher.mjs',
    apply: (s) => s.replace('        env: tickChildEnv(env, pid, nonce, tickPath.add),\n', '        env: tickChildEnv(env, pid, nonce), /* M8 */\n'),
    check: (s) => s.includes('/* M8 */') && !s.includes('tickChildEnv(env, pid, nonce, tickPath.add)'),
  },
  M9: { // delete the TICK-PATH log line
    file: 'watch/advance-watcher.mjs',
    apply: (s) => s.replace("    log(`TICK-PATH add ${fmt(tickPath.add)} present ${fmt(tickPath.present)} unresolved ${fmt(tickPath.unresolved)}`);\n", '    /* M9 */\n'),
    check: (s) => s.includes('/* M9 */') && !s.includes('log(`TICK-PATH add'),
  },
  // --- probes past the list (Ruben) ---
  P1: { // move the TICK-PATH log AFTER the spawn call — does any test pin "before the spawn"?
    file: 'watch/advance-watcher.mjs',
    apply: (s) => {
      const line = "    log(`TICK-PATH add ${fmt(tickPath.add)} present ${fmt(tickPath.present)} unresolved ${fmt(tickPath.unresolved)}`);\n";
      s = s.replace(line, '    /* P1 moved */\n');
      // insert after the spawnFn(...) call closes: find "stdio: ['ignore', 'pipe', 'pipe'],\n      }\n    );\n" following 'const proc = spawnFn('
      // Anchor: the TICK spawn, not the deploy's compose spawn at :795 (first probe hit the loop evaluator).
      const anchor = '    const proc = spawnFn(\n      config.claudeBin,';
      const at = s.indexOf(anchor);
      if (at < 0 || s.indexOf(anchor, at + 1) >= 0) throw new Error('P1 anchor not unique');
      const close = s.indexOf("    );\n", at) + "    );\n".length;
      return s.slice(0, close) + line.replace('log(', 'log(/* P1 after spawn */') + s.slice(close);
    },
    check: (s) => {
      const anchor = '    const proc = spawnFn(\n      config.claudeBin,';
      const at = s.indexOf(anchor);
      const p = s.indexOf('/* P1 after spawn */');
      // must be after the tick spawn and within 400 chars of it (i.e. same block)
      return s.includes('/* P1 moved */') && at > 0 && p > at && p - at < 400;
    },
  },
};

function mutate(dir, name) {
  const m = MUTANTS[name];
  if (!m) throw new Error('unknown mutant ' + name);
  const p = join(dir, 'apps/chat', m.file);
  const before = readFileSync(p, 'utf8');
  const after = m.apply(before);
  if (after === before) throw new Error(`${name}: pattern did not match — mutation NOT applied`);
  if (!m.check(after)) throw new Error(`${name}: applied-check failed — mutation landed at the wrong site`);
  writeFileSync(p, after);
  // show the hunk
  const d = spawnSync('diff', ['-u', join(WT, m.file), p], { encoding: 'utf8' });
  console.log(`${name} APPLIED at intended site (${m.file}); diff vs worktree:`);
  console.log(d.stdout.split('\n').filter((l) => /^[-+]/.test(l) && !/^(---|\+\+\+)/.test(l)).join('\n'));
}

function restore(dir) {
  for (const f of FILES) {
    const src = execFileSync('git', ['-C', REPO, 'show', `${BRANCH}:apps/chat/${f}`], { maxBuffer: 1 << 28 });
    writeFileSync(join(dir, 'apps/chat', f), src);
  }
  const ok = cmp(dir);
  console.log(ok ? 'RESTORED: scratch identical to worktree' : 'RESTORE FAILED');
  if (!ok) process.exit(2);
}

switch (cmd) {
  case 'archive': archive(args[0], args[1]); break;
  case 'test': test(args[0]); break;
  case 'mutate': mutate(args[0], args[1]); break;
  case 'restore': restore(args[0]); break;
  case 'cmp': process.exit(cmp(args[0]) ? 0 : 1);
  default: throw new Error('unknown cmd ' + cmd);
}
