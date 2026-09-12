// AS-87 review: M7-with-M1 — the opt-in REAL build with the heartbeat deleted,
// on a second scratch copy so the M1-M6 battery cannot race it.
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const SRC = '/Users/forrest/Code/american-software-company/.worktrees/AS-87/apps/chat';
const ROOT = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/as87-scratch2/apps/chat';
cpSync(SRC, ROOT, { recursive: true, filter: (s) => !/\/apps\/chat\/data(\/|$)/.test(s) });
const W = `${ROOT}/watch/advance-watcher.mjs`;
const from = "      persist({ ...inflight, reason: 'deploying' });\n      return { action: 'noop', reason: 'busy' };\n";
const to = "      return { action: 'noop', reason: 'busy' };\n";
const orig = readFileSync(W, 'utf8');
const count = orig.split(from).length - 1;
if (count !== 1) throw new Error(`M1 anchor count=${count}`);
writeFileSync(W, orig.replace(from, to));
const after = readFileSync(W, 'utf8');
if (after === orig || after.includes("reason: 'deploying'")) throw new Error('M1 not applied');
console.log('M1 applied at evaluateInner deploying branch (anchor count 1, persist line gone)');
const r = spawnSync(process.execPath, ['--test', 'test/watcher-deploy-real.test.js'], {
  cwd: ROOT,
  env: { ...process.env, AS87_REAL_BUILD: '1', ADVANCE_DOCKER_BIN: '/usr/local/bin/docker' },
  encoding: 'utf8',
});
const out = `${r.stdout}\n${r.stderr}`;
writeFileSync('/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/as87-real-m7m1.log', `${out}\n[real:m7m1] exit=${r.status}\n`);
console.log(out.split('\n').filter((l) => /^(not ok|ok |✖|✔|ℹ (tests|pass|fail|skipped)|.*AssertionError|.*heartbeats|.*expected|.*actual|.*message)/.test(l)).join('\n'));
console.log(`[real:m7m1] exit=${r.status}`);
