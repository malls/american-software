// AS-132 mutant battery (developer-lena). Each mutant is applied IN PLACE in
// the worktree's advance-watcher.mjs (backup + restore in a finally, plus a
// SIGINT/SIGTERM restore), asserted to have landed at the intended site (the
// pattern occurs exactly once, and the surrounding line is the one the plan
// names), then the host suite runs and the exact 'not ok' set is recorded.
// Usage: node mutants.mjs [M1 M2 ...]   (default: all)
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-132';
const CWD = `${WT}/apps/chat`;
const FILE = `${CWD}/watch/advance-watcher.mjs`;
const OUT = '/Users/forrest/Code/american-software-company/scratchpad/agent-developer-lena/AS-132';

const MUTANTS = {
  M1: {
    what: "rearmIfDue(): delete `resumeHold = true; // AS-132` (today's code)",
    from: '    resumeHold = true; // AS-132\n',
    to: '',
    site: /pending = true;\n    resumeHold = true; \/\/ AS-132\n    log\(`LOOP-REARM/,
    expect: ['as132-t1-rearm-after-resume-holds-the-lock-gate'],
  },
  M2: {
    what: 'blockedByLock(): a lock never ages out (`>= resumeGraceMs` -> `>= Infinity`)',
    from: 'now() - startedMs >= resumeGraceMs) {',
    to: 'now() - startedMs >= Infinity) {',
    site: /if \(!held \|\| !Number\.isFinite\(startedMs\) \|\| now\(\) - startedMs >= resumeGraceMs\) \{/,
    expect: ['as132-t1-rearm-after-resume-holds-the-lock-gate', 'f2-resume-fires-when-the-lock-aged-out'],
  },
  M3: {
    what: 'blockedByLock(): a missing lock is read as a fresh one',
    from: '    const held = loadLock();\n    const startedMs',
    to: '    const held = loadLock() ?? { startedAt: new Date(now()).toISOString() };\n    const startedMs',
    site: /if \(!resumeHold\) return false;\n    const held = loadLock\(\);\n    const startedMs/,
    expect: ['as132-t2-ordinary-rearm-is-not-held-with-no-lock', 'f2-resume-fires-with-no-lock', 'as129-t11 (watcher-main)'],
  },
  M4: {
    what: 'resume(): delete `resumeHold = true; // F2: ...`',
    from: '    resumeHold = true; // F2: wait out anything the dead process left running\n',
    to: '',
    site: /pending = true;\n    resumeHold = true; \/\/ F2: wait out anything the dead process left running\n    log\(`LOOP-RESUME reason=watcher-restart/,
    expect: ['as132-t3-contrast-ordinary-resume-holds', 'f2-resume-waits-out-a-live-lock', 'f2-gate-is-age-not-pid', 'f2-gate-is-resume-only'],
  },
};

const original = readFileSync(FILE, 'utf8');
const restore = () => writeFileSync(FILE, original);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { restore(); process.exit(1); });

const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(MUTANTS);
const rows = [];
for (const id of ids) {
  const m = MUTANTS[id];
  const occurrences = original.split(m.from).length - 1;
  if (occurrences !== 1) { console.log(`${id}: pattern occurs ${occurrences} times, refusing`); process.exit(2); }
  if (!m.site.test(original)) { console.log(`${id}: intended site not found, refusing`); process.exit(2); }
  const mutated = original.replace(m.from, m.to);
  if (mutated === original) { console.log(`${id}: mutation is a no-op, refusing`); process.exit(2); }
  let log = '';
  let status = null;
  try {
    writeFileSync(FILE, mutated);
    const applied = readFileSync(FILE, 'utf8');
    if (applied.includes(m.from) || !applied.includes(m.to.trim() || '\n') || m.site.test(applied)) {
      console.log(`${id}: mutation did not land at the intended site, refusing`); process.exit(2);
    }
    const diff = spawnSync('git', ['-C', WT, 'diff', '--', 'apps/chat/watch/advance-watcher.mjs'], { encoding: 'utf8' }).stdout;
    const r = spawnSync('node', ['--test'], { cwd: CWD, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    status = r.status;
    log = `=== ${id}: ${m.what}\n--- applied diff ---\n${diff}\n--- run ---\n` + (r.stdout || '') + (r.stderr || '');
  } finally {
    restore();
  }
  writeFileSync(`${OUT}/mut-${id}.log`, log);
  const summary = log.split('\n').filter((l) => /^ℹ (tests|pass|fail|skipped)/.test(l)).map((l) => l.replace('ℹ ', '')).join(' ');
  // Leaf 'not ok' lines (any indentation) minus subtest-less duplicates: keep the names.
  const red = [...new Set(log.split('\n').filter((l) => /^\s*✖ /.test(l)).map((l) => l.trim().replace(/^✖ /, '').replace(/ \(\d+(\.\d+)?ms\)$/, '')))];
  const clean = spawnSync('git', ['-C', WT, 'diff', '--exit-code', '--', 'apps/chat/watch/advance-watcher.mjs']).status === 0;
  rows.push({ id, what: m.what, exit: status, summary, red, expected: m.expect, restored: clean });
  console.log(`${id} exit=${status} ${summary} restored=${clean}\n  red (${red.length}): ${red.join(' | ')}\n  expected: ${m.expect.join(' | ')}`);
}
writeFileSync(`${OUT}/mutants-results.json`, JSON.stringify(rows, null, 2));
