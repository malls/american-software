// harness.mjs — AS-57 cycle-2 review battery (qa-ruben).
// One indivisible step per mutant: back up OUTSIDE the scanned tree, apply,
// ASSERT the mutation applied at the intended site, counted run with --build,
// restore under an exit trap, prove the tree clean, print the exact red set.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, lstatSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

export const ROOT = '/Users/forrest/Code/american-software-company';
export const WT = join(ROOT, '.worktrees', 'AS-57');
export const APP = join(WT, 'apps', 'invoicing');
export const SP = join(ROOT, 'scratchpad', 'agent-qa-ruben', 'AS-57', 'c2');
const BK = '/tmp/asc-qa-as57-c2-backup';

const sh = (argv, opts = {}) => spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
export const git = (...args) => sh(['git', '-C', WT, ...args]).stdout.trim();

/** Exact failing-test names from a log (deduped; the summary repeats them). */
export function reds(logPath) {
  const out = new Set();
  for (const line of readFileSync(logPath, 'utf8').split('\n')) {
    const m = /^\s*(?:✖|not ok \d+ -)\s+(.*?)(?:\s+\(\d[\d.]*ms\))?\s*$/.exec(line);
    if (m && !/^failing tests:?$/.test(m[1]) && !/# subtest/.test(line)) out.add(m[1]);
  }
  return [...out];
}

/** Counted compose run; returns receipt lines. */
export function countedRun(suffix, logName, cwd = APP) {
  const log = join(SP, logName);
  const r = sh(['node', join(ROOT, 'apps/chat/bin/compose-run.mjs'), '--project', `asc-qa-as57-c2-${suffix}`, '--cwd', cwd, '--log', log], { cwd: ROOT });
  const lines = (r.stdout + r.stderr).split('\n').filter((l) => /built:|Built|tests=|leak check|exit=/.test(l));
  return { lines, log, counts: (lines.find((l) => /tests=/.test(l)) || '').trim(), built: lines.find((l) => /Built/.test(l)) || 'NO BUILD LINE' };
}

/**
 * spec: { name, suffix, log, touch: [abs paths the mutation creates/edits],
 *         apply(): void, applied(): boolean (re-read the mutated site), predict: string }
 */
export function mutant(spec) {
  const { name, suffix, log, touch, apply, applied, predict } = spec;
  mkdirSync(BK, { recursive: true });
  const before = git('status', '--porcelain');
  if (before) { console.error(`REFUSING: tree dirty before ${name}: ${before}`); process.exit(2); }
  // backup: record which paths pre-exist and copy them out of tree
  const saved = touch.map((p, i) => {
    const existed = existsSync(p) || (() => { try { lstatSync(p); return true; } catch { return false; } })();
    const bk = join(BK, `${suffix}-${i}`);
    if (existed) { rmSync(bk, { recursive: true, force: true }); cpSync(p, bk, { recursive: true, verbatimSymlinks: true }); }
    return { p, existed, bk };
  });
  let restored = false;
  const restore = () => {
    if (restored) return; restored = true;
    for (const { p, existed, bk } of saved.slice().reverse()) {
      rmSync(p, { recursive: true, force: true });
      if (existed) cpSync(bk, p, { recursive: true, verbatimSymlinks: true });
    }
  };
  process.on('exit', restore);
  for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { restore(); process.exit(130); });
  console.log(`=== ${name}\npredict: ${predict}`);
  try {
    apply();
    if (!applied()) { console.error('MUTATION DID NOT APPLY at the intended site'); process.exit(3); }
    console.log(`applied (porcelain): ${git('status', '--porcelain').split('\n').join(' | ')}`);
    const d = git('diff', '--', ...touch.filter((p) => existsSync(p))).split('\n').filter((l) => /^[-+]/.test(l) && !/^[-+]{3}/.test(l));
    if (d.length) console.log('applied (diff):\n' + d.join('\n'));
    const r = countedRun(suffix, log);
    console.log(r.lines.join('\n'));
    console.log(`red set (${reds(r.log).length}):\n` + reds(r.log).map((t) => `  - ${t}`).join('\n'));
  } finally {
    restore();
    const after = git('status', '--porcelain');
    const diffExit = sh(['git', '-C', WT, 'diff', '--exit-code']).status;
    console.log(after === '' && diffExit === 0 ? 'TREE CLEAN after restore' : `TREE DIRTY after restore: ${after} (diff exit ${diffExit})`);
  }
}

export const read = (p) => readFileSync(p, 'utf8');
export const write = (p, t) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, t); };
export const rel = (p) => relative(APP, p);
