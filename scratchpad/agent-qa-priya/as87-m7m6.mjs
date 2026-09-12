// AS-87 review: M7-with-M6 — the opt-in REAL build with --progress quiet restored,
// on the second scratch copy (re-copied fresh from the worktree).
import { cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const SRC = '/Users/forrest/Code/american-software-company/.worktrees/AS-87/apps/chat';
const ROOT = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/as87-scratch2/apps/chat';
rmSync(ROOT, { recursive: true, force: true });
cpSync(SRC, ROOT, { recursive: true, filter: (s) => !/\/apps\/chat\/data(\/|$)/.test(s) });
const W = `${ROOT}/watch/advance-watcher.mjs`;
const from = "['compose', '--progress', 'plain', 'up', '-d', '--build']";
const to = "['compose', '--progress', 'quiet', 'up', '-d', '--build']";
const orig = readFileSync(W, 'utf8');
const count = orig.split(from).length - 1;
if (count !== 1) throw new Error(`M6 anchor count=${count}`);
writeFileSync(W, orig.replace(from, to));
if (!readFileSync(W, 'utf8').includes("'--progress', 'quiet'")) throw new Error('M6 not applied');
console.log('M6 applied at runDockerCompose spawn argv (anchor count 1)');
const r = spawnSync(process.execPath, ['--test', 'test/watcher-deploy-real.test.js'], {
  cwd: ROOT,
  env: { ...process.env, AS87_REAL_BUILD: '1', ADVANCE_DOCKER_BIN: '/usr/local/bin/docker' },
  encoding: 'utf8',
});
const out = `${r.stdout}\n${r.stderr}`;
writeFileSync('/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/as87-real-m7m6.log', `${out}\n[real:m7m6] exit=${r.status}\n`);
console.log(out.split('\n').filter((l) => /^(✖|✔|ℹ (tests|pass|fail|skipped)|.*AssertionError|.*not empty|.*expected|.*actual|.*message)/.test(l)).join('\n'));
console.log(`[real:m7m6] exit=${r.status}`);
