// AS-132 QA mutant battery (Priya). Each mutant: back up, apply (assert exactly one
// site), record the mutated diff, run the full host suite, collect the red set,
// restore (also on SIGINT/SIGTERM/uncaught), assert `git diff --exit-code` clean.
// usage: node mutants.mjs [M1 M2 ...]
import { spawnSync } from 'node:child_process';
import { copyFileSync, readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';

const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-132';
const FILE = `${WT}/apps/chat/watch/advance-watcher.mjs`;
const BAK = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/AS-132/advance-watcher.mjs.bak';
const OUT = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/AS-132';

const MUTANTS = {
  M1: {
    what: 'delete `resumeHold = true` in rearmIfDue() (today\'s code)',
    from: '    resumeHold = true; // AS-132\n',
    to: '',
    expect: ['as132-t1'],
  },
  M2: {
    what: 'blockedByLock() never ages a lock out (>= resumeGraceMs -> >= Infinity)',
    from: 'now() - startedMs >= resumeGraceMs',
    to: 'now() - startedMs >= Infinity',
    expect: ['as132-t1', 'f2-resume-fires-when-the-lock-aged-out'],
  },
  M3: {
    what: 'blockedByLock() treats a missing lock as a fresh one',
    from: '    const held = loadLock();\n    const startedMs',
    to: '    const held = loadLock() ?? { startedAt: new Date(now()).toISOString() };\n    const startedMs',
    expect: ['as132-t2', 'f2-resume-fires-with-no-lock', 'AS-129 T11'],
  },
  M4: {
    what: 'delete `resumeHold = true` in resume()',
    from: '    resumeHold = true; // F2: wait out anything the dead process left running\n',
    to: '',
    expect: ['as132-t3', 'f2-resume-waits-out-a-live-lock', 'f2-gate-is-age-not-pid', 'f2-gate-is-resume-only'],
  },
};

let mutated = false;
function restore() {
  if (mutated && existsSync(BAK)) {
    copyFileSync(BAK, FILE);
    mutated = false;
  }
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { restore(); process.exit(130); });
process.on('uncaughtException', (e) => { restore(); console.error(e); process.exit(1); });
process.on('exit', restore);

const git = (...args) => spawnSync('git', ['-C', WT, ...args], { encoding: 'utf8' });

function runSuite() {
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap'], {
    cwd: `${WT}/apps/chat`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
  });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  const red = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^\s*not ok \d+ - (.*)$/);
    if (!m) continue;
    const name = m[1].trim();
    if (/\.test\.js$/.test(name)) continue; // file-level aggregate
    red.push(name);
  }
  const summary = {};
  for (const k of ['tests', 'pass', 'fail', 'skipped']) {
    const m = out.match(new RegExp(`^# ${k} (\\d+)`, 'm'));
    summary[k] = m ? Number(m[1]) : null;
  }
  return { out, red, summary, status: r.status };
}

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(MUTANTS);
const report = [];
const clean0 = git('diff', '--exit-code', '--', 'apps/chat/watch/advance-watcher.mjs');
if (clean0.status !== 0) { console.error('worktree not clean before battery; aborting'); process.exit(2); }

for (const id of wanted) {
  const m = MUTANTS[id];
  const original = readFileSync(FILE, 'utf8');
  copyFileSync(FILE, BAK);
  const count = original.split(m.from).length - 1;
  if (count !== 1) { report.push(`${id}: ABORT — pattern found ${count} times, need exactly 1`); continue; }
  writeFileSync(FILE, original.replace(m.from, m.to));
  mutated = true;
  const diff = git('diff', '--', 'apps/chat/watch/advance-watcher.mjs').stdout;
  writeFileSync(`${OUT}/${id}.diff`, diff);
  // Assert applied at the intended site: the diff hunk must mention the function.
  const site = { M1: 'function rearmIfDue', M2: 'function blockedByLock', M3: 'function blockedByLock', M4: 'function resume' }[id];
  const applied = diff.includes(site) && diff.split('\n').filter((l) => /^[-+][^-+]/.test(l)).length >= 1;
  const res = runSuite();
  writeFileSync(`${OUT}/${id}.log`, res.out);
  restore();
  const clean = git('diff', '--exit-code', '--', 'apps/chat/watch/advance-watcher.mjs').status === 0;
  const redSet = [...new Set(res.red)].sort();
  const short = redSet.map((n) => n.split(':')[0].trim());
  const expectHit = m.expect.map((e) => `${e}=${short.some((s) => s.startsWith(e)) ? 'RED' : 'green'}`);
  report.push(
    `${id} — ${m.what}\n` +
    `  applied at site (${site}): ${applied}; hunk lines: ${diff.split('\n').filter((l) => /^[-+][^-+]/.test(l)).join(' | ')}\n` +
    `  suite: tests=${res.summary.tests} pass=${res.summary.pass} fail=${res.summary.fail} skipped=${res.summary.skipped} exit=${res.status}\n` +
    `  red set (${redSet.length}): ${short.join(' ; ') || '(none)'}\n` +
    `  expected: ${expectHit.join(', ')}\n` +
    `  restored, git diff --exit-code clean: ${clean}`
  );
}
if (existsSync(BAK)) unlinkSync(BAK);
const text = report.join('\n\n');
writeFileSync(`${OUT}/mutants-report.txt`, text + '\n');
console.log(text);
