// AS-102 mutant battery — scratch copies under /tmp (outside the scanned tree), never the worktree.
import { cpSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SRC = '/Users/forrest/Code/american-software-company/.worktrees/AS-102/apps/chat';
const FILE = 'watch/advance-watcher.mjs';
const SETTLE_CALL = '      void deployPoll();\n';

function one(s, needle) {
  const n = s.split(needle).length - 1;
  if (n !== 1) throw new Error(`anchor count ${n} for ${JSON.stringify(needle)}`);
}

const mutants = {
  M1: (s) => { const a = '    if (evaluating !== null) return evaluating;\n'; one(s, a); return s.replace(a, ''); },
  M2: (s) => { const a = 'evaluating = evaluateGuarded(opts).finally(() => {\n      evaluating = null;\n    });'; one(s, a); return s.replace(a, 'evaluating = evaluateGuarded(opts);'); },
  M3: (s) => { one(s, SETTLE_CALL); return s.replace(SETTLE_CALL, ''); },
  M4: (s) => { one(s, SETTLE_CALL); const a = '      if (child === proc) child = null;\n      releaseLock();\n'; one(s, a); return s.replace(SETTLE_CALL, '').replace(a, '      if (child === proc) child = null;\n      void deployPoll();\n      releaseLock();\n'); },
  M5: (s) => { one(s, SETTLE_CALL); return s.replace(SETTLE_CALL, '      void deployOps.evaluate({ busy: true });\n'); },
  M6: (s) => { one(s, SETTLE_CALL); return s.replace(SETTLE_CALL, '      deployOps.evaluate({ busy: Boolean(child) });\n'); },
  M7: (s) => { const a = " || lastDecision.reason === 'stale-build'"; one(s, a); return s.replace(a, ''); },
  M8: (s) => { one(s, SETTLE_CALL); const a = '      resolveSettled();\n'; one(s, a); return s.replace(SETTLE_CALL, '').replace(a, '      resolveSettled();\n      void deployPoll();\n'); },
  // Ruben probes past the list (M6 rule)
  P1: (s) => { const a = '    if (deploying) return evaluateGuarded(opts);\n'; one(s, a); return s.replace(a, ''); },
  P2: (s) => { const a = '    if (evaluating !== null) return evaluating;\n'; one(s, a); return s.replace(a, "    if (evaluating !== null) return Promise.resolve({ action: 'noop', reason: 'busy' });\n"); },
  P3: (s) => { const a = '.evaluate({ busy: Boolean(child) })\n      .catch('; one(s, a); return s.replace(a, '.evaluate({ busy: true })\n      .catch('); },
};

const only = process.argv.slice(2);
for (const [name, fn] of Object.entries(mutants)) {
  if (only.length && !only.includes(name)) continue;
  const dir = mkdtempSync(join(tmpdir(), `as102-${name}-`));
  cpSync(SRC, dir, { recursive: true, filter: (p) => !p.includes('node_modules/.cache') });
  const orig = readFileSync(join(SRC, FILE), 'utf8');
  const mutated = fn(orig);
  if (mutated === orig) throw new Error(`${name}: mutation did not apply`);
  writeFileSync(join(dir, FILE), mutated);
  // assert applied at the intended site: diff lines
  const d = spawnSync('diff', [join(SRC, FILE), join(dir, FILE)], { encoding: 'utf8' });
  const r = spawnSync('node', ['--test', 'test/watcher.test.js', 'test/watcher-main.test.js'], { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 60000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const failing = [...out.matchAll(/^✖ (.+?) \(\d/gm)].map((m) => m[1]).concat([...out.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1]));
  if (r.error || r.signal) console.log(`=== ${name} HUNG/killed: ${r.signal || r.error?.code}`);
  const counts = { tests: out.match(/ℹ tests (\d+)/)?.[1], fail: out.match(/ℹ fail (\d+)/)?.[1] };
  console.log(`=== ${name} exit=${r.status} tests=${counts.tests} fail=${counts.fail}`);
  console.log(d.stdout.split('\n').filter((l) => /^[<>]/.test(l)).join('\n'));
  for (const f of failing) console.log('  RED:', f.slice(0, 110));
  rmSync(dir, { recursive: true, force: true });
}
