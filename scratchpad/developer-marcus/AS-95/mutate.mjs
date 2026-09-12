// AS-95 mutation battery. Runs against a SCRATCH COPY of apps/chat only.
// For each mutant: apply, assert applied, run node --test, record the red set,
// restore. Never touches the task worktree.
import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// Build the scratch tree from the worktree: the two files the suite needs.
const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-95/apps/chat';
const root = process.argv[2];
mkdirSync(root + '/watch', { recursive: true });
mkdirSync(root + '/test', { recursive: true });
cpSync(WT + '/watch/advance-watcher.mjs', root + '/watch/advance-watcher.mjs');
cpSync(WT + '/test/watcher-loop.test.js', root + '/test/watcher-loop.test.js');
const SRC = root + '/watch/advance-watcher.mjs';
const orig = readFileSync(SRC, 'utf8');
const mutants = [
  ['a  drop review from MID_LIFECYCLE', "'in_progress', 'review']", "'in_progress']"],
  ['b  delete rule 6 (backlog-ready)', 'if (ready.length > 0) {', 'if (false) {'],
  ['c  new-message > becomes >=', 'sentinel.messageId > highwaterId', 'sentinel.messageId >= highwaterId'],
  ['d  dry returns continue', "return stop('dry', { ticks });", "return go('dry', { ticks });"],
  ['e  delete rule 2 (no-progress)', 'if (noProgress >= limits.maxNoProgress) {', 'if (false) {'],
  ['f1 cap ticks >= becomes >', 'ticks >= limits.maxTicks', 'ticks > limits.maxTicks'],
  ['f2 cap elapsed >= becomes >', 'elapsedMs >= limits.maxMs', 'elapsedMs > limits.maxMs'],
  ['g  delete rule 1 (failures)', 'if (failures >= limits.maxFailures) {', 'if (false) {'],
  ['AC-4 drop dependsOn check', 'return (t.dependsOn ?? []).every((id) => {', 'return [].every((id) => {'],
  ['reader throws instead of skipping', 'unreadable += 1; // half-written', 'throw new Error("boom"); // half-written'],
  ['head-ref stops following symbolic refs', 'if (!ref) return', 'if (ref) return null; if (!ref) return'],
  ['lock drops the loop marker spread', 'source, nonce, ...extra });', 'source, nonce });'],
];

for (const [name, from, to] of mutants) {
  const i = orig.indexOf(from);
  if (i === -1) { console.log(name + '\n  MUTATION NOT APPLIED (anchor missing)'); continue; }
  const mutated = orig.slice(0, i) + to + orig.slice(i + from.length);
  writeFileSync(SRC, mutated);
  const check = readFileSync(SRC, 'utf8');
  if (!check.includes(to) || check === orig) { console.log(name + '\n  ASSERT FAILED — mutation not in file'); writeFileSync(SRC, orig); continue; }
  const r = spawnSync('node', ['--test', 'test/watcher-loop.test.js'], { cwd: root, encoding: 'utf8' });
  const red = [...(r.stdout || '').matchAll(/^✖ ([^(]+?) \(/gm)].map((m) => m[1].trim());
  const note = red.length ? red.join(' | ') : (r.status === 0 ? 'NONE — SURVIVED' : 'no per-test red; exit ' + r.status);
  console.log(name + '\n  exit=' + r.status + ' red(' + red.length + '): ' + note);
  writeFileSync(SRC, orig);
}
console.log('restored: ' + (readFileSync(SRC, 'utf8') === orig));
