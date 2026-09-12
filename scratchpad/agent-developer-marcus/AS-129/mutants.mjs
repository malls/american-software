// AS-129 mutant battery (developer-marcus). In-place mutation of the worktree's
// advance-watcher.mjs with backup + restore; each mutation must land at exactly
// one site (asserted by occurrence count and by `git diff --stat`), the FULL
// apps/chat suite runs, the red set is recorded, the file is restored and
// `git diff --exit-code` must be clean before the next mutant.
//
// Usage: node mutants.mjs [M1 M2 ...]   (default: all)
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-129';
const APP = `${WT}/apps/chat`;
const FILE = `${APP}/watch/advance-watcher.mjs`;
const OUT = '/Users/forrest/Code/american-software-company/scratchpad/agent-developer-marcus/AS-129/mutants.log';

const MUTANTS = {
  M1: { desc: 'workRemains always true', from: 'return midLifecycle || readyBacklog(board).length > 0;', to: 'return true;', expect: ['T3', 'T6', 'T12'] },
  M2: { desc: 'settle() never schedules the cooldown', from: "if (verdict.reason === 'cap-hit' && verdict.detail.rearm === true) cooldown(armedBy, now());", to: '/* M2 */', expect: ['T4', 'T5', 'T7', 'T11'] },
  M3: { desc: 'rearmIfDue() ignores the clock', from: 'if (now() < rearm.at) return false;', to: '/* M3 */', expect: ['T5', 'T11'] },
  M4: { desc: 'rearmIfDue() always false', from: 'function rearmIfDue() {\n    if (rearm === null) return false;', to: 'function rearmIfDue() {\n    return false;', expect: ['T5', 'T8', 'T11'] },
  M5: { desc: 're-armed loop keeps the old ticks', from: 'loop = { startedAt: now(), ticks: 0, noProgress: 0, failures: 0, armedBy };\n    pending = true;\n    log(`LOOP-REARM', to: 'loop = { startedAt: now(), ticks: lastLoop ? lastLoop.ticks : 0, noProgress: 0, failures: 0, armedBy };\n    pending = true;\n    log(`LOOP-REARM', expect: ['T5', 'T11'] },
  M6: { desc: 'start() does not clear rearm', from: '    rearm = null; // AS-129: a message during the cooldown wins\n', to: '', expect: ['T7'] },
  M7: { desc: 'resume() ignores rearmAt', from: 'if (Number.isFinite(rearmAt)) {', to: 'if (false) {', expect: ['T8'] },
  M8: { desc: 'resume() skips the cap check (AS-104)', from: 'if (capReached(loop, now(), limits)) {', to: 'if (false) {', expect: ['T9a', 'T9b'] },
  M9: { desc: 'main() passes no limits', from: '        limits: loopLimits(config), // AS-129: lock wait = tick box + staleness; cap cooldown\n', to: '', expect: ['T13'] },
  M10: { desc: 'loopLimits returns the 60-min literal', from: 'maxLockWaitMs: (config.tickTimeoutMin + config.lockStaleMin) * 60_000,', to: 'maxLockWaitMs: 60 * 60 * 1000,', expect: ['T10', 'T13'] },
  M11: { desc: 'poll() drops rearmIfDue()', from: '    loopOps.rearmIfDue();\n', to: '', expect: ['T11'] },
  M12: { desc: 'TICK_TIMEOUT via envNum', from: "envMinutes(env, 'ADVANCE_TICK_TIMEOUT_MIN'", to: "envNum(env, 'ADVANCE_TICK_TIMEOUT_MIN'", expect: ['T14 ADVANCE_TICK_TIMEOUT_MIN'] },
  M13: { desc: 'LOCK_STALE via envNum', from: "envMinutes(env, 'ADVANCE_LOCK_STALE_MIN'", to: "envNum(env, 'ADVANCE_LOCK_STALE_MIN'", expect: ['T14 ADVANCE_LOCK_STALE_MIN'] },
  M14: { desc: 'DEPLOY_TIMEOUT via envNum', from: "envMinutes(env, 'ADVANCE_DEPLOY_TIMEOUT_MIN'", to: "envNum(env, 'ADVANCE_DEPLOY_TIMEOUT_MIN'", expect: ['T14 ADVANCE_DEPLOY_TIMEOUT_MIN'] },
  M15: { desc: 'DEPLOY_COOLDOWN via envNum', from: "envMinutes(env, 'ADVANCE_DEPLOY_COOLDOWN_MIN'", to: "envNum(env, 'ADVANCE_DEPLOY_COOLDOWN_MIN'", expect: ['T14 ADVANCE_DEPLOY_COOLDOWN_MIN'] },
  M16: { desc: 'LOOP_REARM via envNum', from: "envMinutes(env, 'ADVANCE_LOOP_REARM_MIN'", to: "envNum(env, 'ADVANCE_LOOP_REARM_MIN'", expect: ['T14 ADVANCE_LOOP_REARM_MIN'] },
  M17: { desc: 'envMinutes clamps instead of throwing', from: 'if (v * 60_000 > MAX_TIMER_MS) {\n    throw new Error(', to: 'if (v * 60_000 > MAX_TIMER_MS) {\n    return Math.floor(MAX_TIMER_MS / 60_000);\n    throw new Error(', expect: ['T14 x5'] },
};

function git(args) {
  return spawnSync('git', ['-C', WT, ...args], { encoding: 'utf8' });
}

function runSuite() {
  const res = spawnSync('node', ['--test', '--test-reporter=tap'], { cwd: APP, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = res.stdout + res.stderr;
  const red = [...out.matchAll(/^not ok \d+ - (.*)$/gm)].map((m) => m[1]);
  const counts = {};
  for (const k of ['tests', 'pass', 'fail', 'skipped']) counts[k] = Number((out.match(new RegExp(`^# ${k} (\\d+)`, 'm')) ?? [])[1]);
  return { red, counts };
}

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(MUTANTS);
const original = readFileSync(FILE, 'utf8');
const lines = [];
const say = (s) => { lines.push(s); process.stdout.write(s + '\n'); };

const restore = () => {
  writeFileSync(FILE, original);
};
process.on('SIGINT', () => { restore(); process.exit(130); });
process.on('SIGTERM', () => { restore(); process.exit(143); });

say(`# AS-129 mutant battery ${new Date().toISOString()} on ${git(['rev-parse', '--short', 'HEAD']).stdout.trim()}`);
const pre = git(['diff', '--exit-code', '--stat']);
if (pre.status !== 0) { say('ABORT: worktree dirty before the battery'); process.exit(2); }

for (const id of wanted) {
  const m = MUTANTS[id];
  if (!m) { say(`${id}: unknown`); continue; }
  const occurrences = original.split(m.from).length - 1;
  if (occurrences !== 1) { say(`${id}: ABORT mutation site count ${occurrences} (expected 1)`); continue; }
  const mutated = original.replace(m.from, m.to);
  try {
    writeFileSync(FILE, mutated);
    const stat = git(['diff', '--stat']).stdout.trim().split('\n')[0];
    const numstat = git(['diff', '--numstat']).stdout.trim();
    const diff = git(['diff', '-U0', '--', 'apps/chat/watch/advance-watcher.mjs']).stdout;
    const hunk = diff.split('\n').filter((l) => /^[-+]/.test(l) && !/^(---|\+\+\+)/.test(l)).join('\n      ');
    say(`\n## ${id} — ${m.desc}\n   applied: ${stat} [${numstat.replace(/\s+/g, ' ')}]\n   hunk:\n      ${hunk}`);
    const { red, counts } = runSuite();
    say(`   suite: ${counts.tests}/${counts.pass}/${counts.fail}/${counts.skipped}`);
    say(`   expected red: ${m.expect.join(', ')}`);
    say(`   observed red (${red.length}):`);
    for (const r of red) say(`     - ${r}`);
  } finally {
    restore();
    const post = git(['diff', '--exit-code', '--stat']);
    say(`   restored: git diff --exit-code -> ${post.status === 0 ? 'clean' : 'DIRTY'}`);
    if (post.status !== 0) { say('ABORT: restore failed'); process.exit(3); }
  }
}
writeFileSync(OUT, lines.join('\n') + '\n', { flag: process.argv.slice(2).length ? 'a' : 'w' });
say(`\n# written ${OUT}`);
