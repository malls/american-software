// AS-100 cycle 2, row (1) — the reconciler's mutants. Same scratch-copy
// harness as mutants-row1/2/5: the task worktree is never mutated, every
// pattern is asserted to hit EXACTLY ONE site, and a non-unique or non-landing
// pattern is reported as a SITE ERROR rather than as a guard result (the AS-95
// sharpening: a survivor has two explanations and they look identical).
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SRC = '/Users/forrest/Code/american-software-company/.worktrees/AS-100/apps/chat';
const W = 'watch/advance-watcher.mjs';
const E = 'lib/events.js';

const CLOSE_BLOCK = `    const stagesClosed = closeOpen(open, {
      outcome,
      exit: outcome,
      closedBy: 'watcher-settle',
      reason: null,
      nowMs,
    });`;

const MUTANTS = [
  ['M14 AC-6 a timed-out tick is reported as an error instead of a timeout', E,
    "  if (timedOut) return 'timeout';",
    "  if (timedOut) return 'error';",
    'watcher-events-outcome-timeout'],

  ['M15 AC-7 THE falsifier — settle closes a cut stage as completed', W,
    '    const outcome = stageCloseOutcome({ code, signal, timedOut });',
    "    const outcome = 'completed';",
    'watcher-events-timeout-closes-as-cut (+ unclosed/error siblings)'],

  ['M16 AC-7 ordering — tick_ended is written before the open stages are closed', W,
    CLOSE_BLOCK,
    `    emit('tick_ended', { tickId, outcome: 'timeout', code, signal, timedOut, headMoved: false, lanesTouched, stagesClosed: 0, reason: null }, nowMs);
${CLOSE_BLOCK}`,
    'watcher-events-close-before-tick-ended'],

  ['M17 AC-8 the sweep ignores a fresh lock', W,
    "    if (lockBusy(nowMs)) return { action: 'noop', reason: 'lock-fresh', closed: 0 };",
    "    if (false && lockBusy(nowMs)) return { action: 'noop', reason: 'lock-fresh', closed: 0 };",
    'watcher-events-sweep-respects-lock'],

  ['M18 AC-8 the sweep boundary is two tick boxes instead of one', W,
    '      stages: open.stages.filter((s) => ageMs(s.ts, nowMs) >= tickTimeoutMs),',
    '      stages: open.stages.filter((s) => ageMs(s.ts, nowMs) >= 2 * tickTimeoutMs),',
    'watcher-events-sweep-boundary'],

  ['M19 AC-9 the open set is cached at construction instead of derived', W,
    '    openItems: () => openItems(read().events),',
    '    openItems: (() => { let cached = null; return () => (cached ??= openItems(read().events)); })(),',
    'watcher-events-open-derived-from-stream'],

  ['M20 AC-10 a clean exit with an open stage is recorded as completed', E,
    "  return 'unclosed';",
    "  return 'completed';",
    'watcher-events-unclosed-not-completed'],
];

const lines = [];
for (const [name, file, from, to, expect] of MUTANTS) {
  const dir = mkdtempSync(join(tmpdir(), 'as100-mutant-'));
  cpSync(SRC, dir, { recursive: true });
  const path = join(dir, file);
  const src = readFileSync(path, 'utf8');
  const hits = src.split(from).length - 1;
  if (hits !== 1) {
    lines.push(`${name}: SITE ERROR — pattern occurs ${hits} times in ${file}. NOT A GUARD RESULT.`);
    rmSync(dir, { recursive: true, force: true });
    continue;
  }
  writeFileSync(path, src.replace(from, to));
  if (!readFileSync(path, 'utf8').includes(to)) {
    lines.push(`${name}: MUTATION DID NOT LAND. NOT A GUARD RESULT.`);
    rmSync(dir, { recursive: true, force: true });
    continue;
  }
  const res = spawnSync('node', ['--test'], { cwd: dir, encoding: 'utf8' });
  const out = `${res.stdout}${res.stderr}`;
  const red = [...new Set([...out.matchAll(/^✖ (.+?) \(/gm)].map((m) => m[1]).filter((n) => !/^test at /.test(n)))];
  const counts = (out.match(/ℹ (tests|pass|fail) \d+/g) ?? []).join(' ');
  lines.push(`${name}\n  file: ${file}\n  expect red: ${expect}\n  observed red: ${red.join(' | ') || 'NONE — SURVIVOR'}\n  ${counts}`);
  rmSync(dir, { recursive: true, force: true });
}
const report = lines.join('\n\n');
writeFileSync('/Users/forrest/Code/american-software-company/scratchpad/developer-lena/mutants-row6.log', `${report}\n`);
console.log(report);
