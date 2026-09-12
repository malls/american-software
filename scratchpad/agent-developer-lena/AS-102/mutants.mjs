// AS-102 mutant battery. Runs in a SCRATCH copy of the worktree's apps/chat —
// never in the worktree. Each mutant is applied by a pattern that can only
// match its intended site (the file has two `settle` functions; the watcher
// one is anchored on its resolveSettled() neighbour), the application is
// asserted, the watcher test files are run, and the failing-test set recorded.
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const W = '/Users/forrest/Code/american-software-company/.worktrees/AS-102/apps/chat';
const scratch = mkdtempSync(join(tmpdir(), 'as102-mutants-'));
cpSync(W, scratch, { recursive: true, filter: (p) => !p.includes('node_modules') && !p.includes('/data/') });
const file = join(scratch, 'watch', 'advance-watcher.mjs');
const pristine = readFileSync(file, 'utf8');

const SETTLE_TAIL = `      void deployPoll();
      // AS-84, last: a shutdown waiting on this tick may exit the process the
      // moment this resolves, so everything above must already have happened.
      if (settled === thisSettled) settled = null;
      resolveSettled();
    }`;

const mutants = {
  M1: {
    desc: 'evaluate: delete `if (evaluating !== null) return evaluating;`',
    from: `    if (evaluating !== null) return evaluating;\n`,
    to: '',
    predicted: ['T1', 'T3'],
  },
  M2: {
    desc: 'evaluate: delete the finally that clears `evaluating`',
    from: `    evaluating = evaluateGuarded(opts).finally(() => {\n      evaluating = null;\n    });`,
    to: `    evaluating = evaluateGuarded(opts);`,
    predicted: ['T2', 'T4', 'T6', 'T8'],
  },
  M3: {
    desc: 'settle (watcher): delete `void deployPoll();`',
    from: SETTLE_TAIL,
    to: SETTLE_TAIL.replace('      void deployPoll();\n', ''),
    predicted: ['T5', 'T6'],
  },
  M4: {
    desc: 'settle (watcher): move `void deployPoll();` before releaseLock()',
    from: `      if (child === proc) child = null;\n      releaseLock();`,
    to: `      if (child === proc) child = null;\n      void deployPoll();\n      releaseLock();`,
    also: { from: SETTLE_TAIL, to: SETTLE_TAIL.replace('      void deployPoll();\n', '') },
    predicted: ['T5', 'T6'],
  },
  M5: {
    desc: 'settle (watcher): call deployOps.evaluate({ busy: true }) instead of deployPoll()',
    from: SETTLE_TAIL,
    to: SETTLE_TAIL.replace('void deployPoll();', 'void deployOps.evaluate({ busy: true }).catch(() => {});'),
    predicted: ['T5', 'T6'],
  },
  M6: {
    desc: 'settle (watcher): bare deployOps.evaluate({ busy: false }) — bypass the F6 catch',
    from: SETTLE_TAIL,
    to: SETTLE_TAIL.replace('void deployPoll();', 'void deployOps.evaluate({ busy: false });'),
    predicted: ['T7'],
  },
  M7: {
    desc: "pendingDeploy: drop `|| lastDecision.reason === 'stale-build'`",
    from: `(lastDecision.reason === 'busy' || lastDecision.reason === 'stale-build')`,
    to: `(lastDecision.reason === 'busy')`,
    predicted: ['T8', 'AS-95 pendingDeploy'],
  },
  M8: {
    desc: 'settle (watcher): move `void deployPoll();` after resolveSettled()',
    from: SETTLE_TAIL,
    to: SETTLE_TAIL.replace('      void deployPoll();\n', '').replace('      resolveSettled();\n    }', '      resolveSettled();\n      void deployPoll();\n    }'),
    predicted: ['T5'],
  },
  M9: {
    desc: 'evaluate: delete the `if (deploying)` pre-check (heartbeat must precede the guard)',
    from: `    if (deploying) return evaluateGuarded(opts);\n`,
    to: '',
    predicted: ['AS-87 heartbeat (timeout)'],
  },
};

const results = {};
for (const [name, m] of Object.entries(mutants)) {
  let src = pristine;
  const count = src.split(m.from).length - 1;
  if (count !== 1) throw new Error(`${name}: pattern matched ${count} times, want exactly 1`);
  src = src.replace(m.from, m.to);
  if (m.also) {
    const c2 = src.split(m.also.from).length - 1;
    if (c2 !== 1) throw new Error(`${name}: secondary pattern matched ${c2} times`);
    src = src.replace(m.also.from, m.also.to);
  }
  if (src === pristine) throw new Error(`${name}: mutation did not change the file`);
  writeFileSync(file, src);
  // Assert applied AT THE SITE: the 'to' text is present and 'from' is gone.
  const applied = readFileSync(file, 'utf8');
  if (applied.includes(m.from) || (m.to && !applied.includes(m.to))) throw new Error(`${name}: not applied at site`);
  const run = spawnSync('node', ['--test', '--test-timeout=15000', 'test/watcher.test.js', 'test/watcher-main.test.js', 'test/watcher-loop.test.js'], { cwd: scratch, encoding: 'utf8', maxBuffer: 64 << 20 });
  const out = run.stdout + run.stderr;
  const failing = [...out.matchAll(/^✖ (.+?) \(\d/gm)].map((x) => x[1]);
  const counts = /ℹ tests (\d+)[\s\S]*?ℹ pass (\d+)[\s\S]*?ℹ fail (\d+)/.exec(out);
  results[name] = { desc: m.desc, predicted: m.predicted, tests: counts ? counts[1] : '?', fail: counts ? counts[3] : '?', red: [...new Set(failing)] };
  console.log(`${name} ${m.desc}\n  tests=${results[name].tests} fail=${results[name].fail}\n  red: ${results[name].red.map((s) => '\n    - ' + s).join('')}\n`);
  writeFileSync(file, pristine);
}
if (readFileSync(file, 'utf8') !== pristine) throw new Error('scratch not restored');
writeFileSync('/Users/forrest/Code/american-software-company/scratchpad/agent-developer-lena/AS-102/mutants.json', JSON.stringify(results, null, 2));
rmSync(scratch, { recursive: true, force: true });
console.log('done');
