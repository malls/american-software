// AS-87 review: M8 — remove the skip guard on the opt-in real-build test and
// run it with NO opt-in and NO resolvable docker (ADVANCE_DOCKER_BIN pointed at
// a path that does not exist), which is the compose container's situation.
// Bounded at 25 s: with the guard gone the test does not skip; it enters its
// `while (!ops.isDeploying())` spin and only its own 10-minute timeout ends it.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const ROOT = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/as87-scratch/apps/chat';
const R = `${ROOT}/test/watcher-deploy-real.test.js`;
const from = '{ skip, timeout: 10 * 60_000 }';
const to = '{ timeout: 10 * 60_000 }';
const orig = readFileSync(R, 'utf8');
const count = orig.split(from).length - 1;
if (count !== 1) throw new Error(`M8 anchor count=${count}`);
writeFileSync(R, orig.replace(from, to));
if (readFileSync(R, 'utf8').includes('{ skip,')) throw new Error('M8 not applied');
console.log('M8 applied: skip guard removed from the real-build test options');
const env = { ...process.env, ADVANCE_DOCKER_BIN: '/nonexistent/docker' };
delete env.AS87_REAL_BUILD;
// Control first: unmutated file, same env -> must SKIP.
writeFileSync(R, orig);
const ctl = spawnSync(process.execPath, ['--test', 'test/watcher-deploy-real.test.js'], { cwd: ROOT, env, encoding: 'utf8', timeout: 25_000 });
console.log('CONTROL (guard present):', ctl.stdout.split('\n').filter((l) => /^(ok|not ok|ℹ (tests|pass|fail|skipped)|﹣|✔|✖)/.test(l)).join(' | '), 'exit', ctl.status, ctl.signal || '');
// Mutant.
writeFileSync(R, orig.replace(from, to));
const r = spawnSync(process.execPath, ['--test', 'test/watcher-deploy-real.test.js'], { cwd: ROOT, env, encoding: 'utf8', timeout: 25_000 });
writeFileSync(R, orig);
if (readFileSync(R, 'utf8') !== orig) throw new Error('restore failed');
console.log('MUTANT (guard removed):', (r.stdout || '').split('\n').filter((l) => /^(ok|not ok|ℹ (tests|pass|fail|skipped)|﹣|✔|✖)/.test(l)).join(' | ') || '(no result line within 25 s)', 'exit', r.status, r.signal || '', r.error ? r.error.code : '');
console.log('restored; scratch file bytes == original');
