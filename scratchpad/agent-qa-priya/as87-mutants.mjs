// AS-87 review: mutant battery on the SCRATCH copy (never the worktree).
// Each mutant: assert the anchored pattern occurs exactly once, apply, assert
// the file changed, run the full host suite, record the failing set, restore,
// assert restored bytes == original bytes.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const ROOT = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/as87-scratch/apps/chat';
const W = `${ROOT}/watch/advance-watcher.mjs`;
const S = `${ROOT}/server.js`;
const L = `${ROOT}/public/loop-status.js`;
const R = `${ROOT}/test/watcher-deploy-real.test.js`;

const HEARTBEAT = "      persist({ ...inflight, reason: 'deploying' });\n      return { action: 'noop', reason: 'busy' };\n";
const mutants = {
  M1: { file: W, from: HEARTBEAT, to: "      return { action: 'noop', reason: 'busy' };\n" },
  M2: { file: W, from: HEARTBEAT, to: "      persist({ reason: 'deploying' });\n      return { action: 'noop', reason: 'busy' };\n" },
  M3: { file: W, from: HEARTBEAT, to: "      persist({ ...inflight, reason: 'deploying' });\n      return { action: 'noop', reason: 'deploying' };\n" },
  M4: { file: S,
    from: "  const reason = typeof deployState.reason === 'string' ? deployState.reason : 'unreadable-state';\n",
    to: "  const KNOWN = new Set(['current','stale-build','cooldown','busy','inputs-dirty','no-git','no-docker','error']);\n  const reason = KNOWN.has(deployState.reason) ? deployState.reason : 'unreadable-state';\n" },
  M5: { file: L, from: "  deploying: 'the watcher is rebuilding it now — see apps/chat/data/logs/deploy-*.log',\n", to: '' },
  M6: { file: W, from: "['compose', '--progress', 'plain', 'up', '-d', '--build']", to: "['compose', '--progress', 'quiet', 'up', '-d', '--build']" },
  M8: { file: R, from: "{ skip, timeout: 10 * 60_000 }", to: "{ timeout: 10 * 60_000 }" },
};

const only = process.argv.slice(2);
const names = only.length ? only : Object.keys(mutants);
const extraEnv = process.env.AS87_M8_ENV ? JSON.parse(process.env.AS87_M8_ENV) : {};

for (const name of names) {
  const m = mutants[name];
  const orig = readFileSync(m.file, 'utf8');
  const count = orig.split(m.from).length - 1;
  if (count !== 1) { console.log(`${name}: ANCHOR count=${count} (expected 1) — NOT APPLIED`); continue; }
  const mutated = orig.replace(m.from, m.to);
  if (mutated === orig) { console.log(`${name}: mutation produced no change — NOT APPLIED`); continue; }
  writeFileSync(m.file, mutated);
  if (readFileSync(m.file, 'utf8') !== mutated) throw new Error(`${name}: write did not land`);
  const env = { ...process.env, ...(name === 'M8' ? extraEnv : {}) };
  const r = spawnSync(process.execPath, ['--test'], { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  writeFileSync(m.file, orig);
  if (readFileSync(m.file, 'utf8') !== orig) throw new Error(`${name}: restore failed`);
  const out = `${r.stdout}\n${r.stderr}`;
  const failing = out.split('\n').filter((l) => /^✖ /.test(l) && !/subtest/.test(l)).map((l) => l.replace(/^✖ /, '').replace(/ \(\d+(\.\d+)?ms\)$/, ''));
  const counts = out.split('\n').filter((l) => /^ℹ (tests|pass|fail|skipped)/.test(l)).join(' ');
  console.log(`${name}: exit=${r.status} ${counts}`);
  for (const f of failing) console.log(`   RED: ${f}`);
  if (failing.length === 0) console.log('   SURVIVED');
}
