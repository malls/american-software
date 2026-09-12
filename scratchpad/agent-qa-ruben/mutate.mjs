// AS-95 cycle-2 mutation battery — qa-ruben. Host node runner (docker denied in this tick).
// Each mutant: assert pattern occurs EXACTLY once (site assertion), write, run full suite,
// parse `not ok` names, restore original bytes, assert restored === original.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const APP = '/Users/forrest/Code/american-software-company/.worktrees/AS-95/apps/chat';
const W = `${APP}/watch/advance-watcher.mjs`;
const L = `${APP}/lib/loop-status.js`;

const M = [
  // AC-1 (a)-(g)
  ['a-midlifecycle', W, ".filter((x) => MID_LIFECYCLE.includes(x.status))", ".filter((x) => false)"],
  ['b-ready', W, "if (ready.length > 0) {\n    const chatSet", "if (ready.length < 0) {\n    const chatSet"],
  ['c-newmsg', W, "sentinel.messageId > highwaterId;", "sentinel.messageId >= highwaterId;"],
  ['d-dry', W, "return stop('dry', { ticks });", "return go('dry', { ticks });"],
  ['e-noprogress-deleted', W, "if (noProgress >= limits.maxNoProgress) {", "if (false && noProgress >= limits.maxNoProgress) {"],
  ['f-cap-boundary', W, "if (ticks >= limits.maxTicks || elapsedMs >= limits.maxMs) {", "if (ticks > limits.maxTicks || elapsedMs >= limits.maxMs) {"],
  ['f-cap-8h', W, "if (ticks >= limits.maxTicks || elapsedMs >= limits.maxMs) {", "if (ticks >= limits.maxTicks || elapsedMs > limits.maxMs + 1) {"],
  ['g-failures', W, "if (failures >= limits.maxFailures) {", "if (failures > limits.maxFailures) {"],
  ['g-timeout-not-failure', W, "const failed = t.code !== 0 || Boolean(t.signal) || Boolean(t.timedOut);", "const failed = t.code !== 0 || Boolean(t.signal);"],
  // AC-4
  ['ac4-depends-deleted', W, "return Boolean(dep) && TERMINAL.includes(dep.status);", "return true;"],
  // AC-5 single fire ordering
  ['ac5-loop-before-message', W, "if (decideAction === 'fire') return 'fire-message';\n  if (!loopPending) return 'idle';", "if (loopPending && !lockHeld && !deployPending) return 'fire-loop';\n  if (decideAction === 'fire') return 'fire-message';\n  if (!loopPending) return 'idle';"],
  // F1 aborted-fire retry
  ['f1-abort-drops-debt', W, "if (loop === null) return; // an aborted MESSAGE fire: pre-loop behaviour, untouched\n    pending = true;", "if (loop === null) return; // an aborted MESSAGE fire: pre-loop behaviour, untouched\n    pending = false;"],
  ['f1-abort-unbounded', W, "if (at - waitingSince >= limits.maxLockWaitMs) {", "if (false) {"],
  // F2 resume gate
  ['f2-gate-removed', W, "function blockedByLock() {\n    if (!resumeHold) return false;", "function blockedByLock() {\n    if (!resumeHold || true) return false;"],
  ['f2-gate-pid-not-age', W, "if (!held || !Number.isFinite(startedMs) || now() - startedMs >= resumeGraceMs) {", "if (!held || !Number.isFinite(startedMs) || now() - startedMs >= 0) {"],
  // F3 mirror writes
  ['f3-no-mirror-at-start', W, "which is the exact symptom this task exists to remove.\n    mirror();", "which is the exact symptom this task exists to remove.\n"],
  ['f3-no-mirror-at-settle', W, "stop('error', { message: err.message });\n    }\n    mirror();\n  }", "stop('error', { message: err.message });\n    }\n  }"],
  // AC-6 label branch
  ['ac6-loop-branch-removed', L, "const inWatcherLoop = tick !== null && tick.source === 'watcher' && ((loop !== null && loop.active) || tick.loopTicks !== null);", "const inWatcherLoop = false;"],
];

const originals = new Map([[W, readFileSync(W)], [L, readFileSync(L)]]);
const results = [];
const restore = () => { for (const [p, b] of originals) writeFileSync(p, b); };
process.on('exit', restore);
process.on('SIGINT', () => process.exit(130));

for (const [name, file, from, to] of M) {
  const src = originals.get(file).toString('utf8');
  const count = src.split(from).length - 1;
  if (count !== 1) { results.push({ name, site: `PATTERN x${count} (NOT APPLIED)`, failing: [], survived: 'n/a' }); continue; }
  const mutated = src.replace(from, to);
  if (mutated === src) { results.push({ name, site: 'NO-OP', failing: [], survived: 'n/a' }); continue; }
  writeFileSync(file, mutated);
  const applied = readFileSync(file, 'utf8').includes(to) && !readFileSync(file, 'utf8').includes(from);
  const r = spawnSync('node', ['--test'], { cwd: APP, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  restore();
  const same = readFileSync(file).equals(originals.get(file));
  const out = r.stdout + r.stderr;
  const failing = [...out.matchAll(/^✖ (.+?) \(/gm)].map((m) => m[1]);
  const total = (out.match(/ℹ tests (\d+)/) || [])[1];
  const fail = (out.match(/ℹ fail (\d+)/) || [])[1];
  results.push({ name, site: applied ? 'applied@1site' : 'APPLY-CHECK-FAILED', restored: same, total, fail, failing });
}
for (const r of results) {
  console.log(`${r.name} | ${r.site} | restored=${r.restored} | tests=${r.total} fail=${r.fail} | survived=${r.fail === '0' ? 'YES' : 'no'} | ${r.failing.join('; ')}`);
}
