// AS-121 review cycle 2 — probes past the list against a stub docker.
// Usage: node probe2.mjs [script-path]   (default: the AS-121 worktree's bin/compose-run.mjs)
// The stub appends every argv to $AS121_LOG and sleeps 2 s on whichever sites $AS121_SLOW names
// (comma list of: network, composels, run, down, images). `run` prints a summary + Built line unless
// $AS121_RUN_MODE is `fail` (fail 1, exit 1) or `nobuilt` (no Built line).
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
const SCRIPT = process.argv[2] || '/Users/forrest/Code/american-software-company/.worktrees/AS-121/apps/chat/bin/compose-run.mjs';
const STUB = `#!/bin/sh
echo "$*" >> "$AS121_LOG"
slow() { case ",$AS121_SLOW," in *",$1,"*) sleep 2 ;; esac; }
case "$*" in
  *"network ls"*) slow network; if [ -n "$AS121_MANY" ]; then i=0; while [ $i -lt 25 ]; do echo "asc-fake$i_default"; i=$((i+1)); done; fi ;;
  *"compose ls"*) slow composels; echo '[]' ;;
  *" run "*) echo started; slow run
     case "$AS121_RUN_MODE" in
       fail) printf 'ℹ tests 1\\nℹ pass 0\\nℹ fail 1\\nℹ skipped 0\\n Image asc-probe-test Built \\n'; exit 1 ;;
       nobuilt) printf 'ℹ tests 1\\nℹ pass 1\\nℹ fail 0\\nℹ skipped 0\\n' ;;
       *) printf 'ℹ tests 1\\nℹ pass 1\\nℹ fail 0\\nℹ skipped 0\\n Image asc-probe-test Built \\n' ;;
     esac ;;
  *" down "*) slow down ;;
  *"images"*) slow images ;;
esac
`;
function run(args, { slow = '', detached = false, env: extra = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'asc-as121-probe2-'));
  const bin = join(dir, 'docker'); const log = join(dir, 'argv.log');
  writeFileSync(bin, STUB, { mode: 0o755 }); writeFileSync(log, '');
  const child = spawn(process.execPath, [SCRIPT, ...args.map((a) => (a === '@DIR' ? dir : a))], {
    detached, env: { ...process.env, ADVANCE_DOCKER_BIN: bin, AS121_LOG: log, AS121_SLOW: slow, ...extra }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', (d) => { stdout += d; }); child.stderr.on('data', (d) => { stderr += d; });
  const exited = new Promise((res) => child.on('exit', (code, signal) => res({ code, signal, stdout, stderr, log: readFileSync(log, 'utf8').split('\n').filter(Boolean) })));
  const lines = () => readFileSync(log, 'utf8').split('\n').filter(Boolean);
  const until = async (re) => { for (let i = 0; i < 200; i++) { if (lines().some((l) => re.test(l))) return; await sleep(25); } throw new Error('never saw ' + re + ' in ' + lines().join(' | ')); };
  return { child, exited, until, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
const short = (l) => l.replace(/^.*docker /, '').split(' ').filter((w) => !w.startsWith('--') && !w.startsWith('{{') && w !== '-p' && !w.startsWith('asc-')).slice(0, 2).join(' ');
const show = (name, r, expect) => console.log(`\n== ${name}\n   expect: ${expect}\n   code=${r.code} signal=${r.signal}\n   log: ${r.log.map(short).join(' | ')}\n   stdout: ${r.stdout.trim().split('\n').filter((l) => /RECEIPT|exit=|leak/.test(l)).join(' / ')}\n   stderr: ${r.stderr.trim().replace(/\n/g, ' // ')}`);
const P = ['--project', 'asc-probe-c2', '--cwd', '@DIR'];

// --- window: before any docker call (signal ~immediately after spawn)
{ const p = run(P); await sleep(60); p.child.kill('SIGTERM'); const r = await p.exited; show('W0 SIGTERM ~60 ms after spawn (before/at first docker call)', r, 'dies of SIGTERM, no run, no receipt'); p.cleanup(); }
// --- window: preflight `network ls` (cycle-1 P1 verbatim), both signals
{ const p = run(P, { slow: 'network' }); await p.until(/network ls/); await sleep(300); p.child.kill('SIGTERM'); const r = await p.exited; show('P1 (cycle-1 verbatim) SIGTERM during preflight network ls', r, 'dies of SIGTERM, no run/down, no receipt, no interrupted line'); p.cleanup(); }
{ const p = run(P, { slow: 'network' }); await p.until(/network ls/); await sleep(300); p.child.kill('SIGINT'); const r = await p.exited; show('P1i SIGINT during preflight network ls', r, 'dies of SIGINT, no run'); p.cleanup(); }
// --- window: guard `compose ls`
{ const p = run(P, { slow: 'composels' }); await p.until(/compose ls/); await sleep(300); p.child.kill('SIGTERM'); const r = await p.exited; show('P1c SIGTERM during guard compose ls', r, 'dies of SIGTERM, no run'); p.cleanup(); }
// --- window: ceiling refusal path with a signal during the slow network ls
{ const p = run(P, { slow: 'network', env: { AS121_MANY: '1' } }); await p.until(/network ls/); await sleep(300); p.child.kill('SIGTERM'); const r = await p.exited; show('P1m SIGTERM during network ls that would refuse at the ceiling', r, 'dies of SIGTERM'); p.cleanup(); }
{ const p = run(P, { env: { AS121_MANY: '1' } }); const r = await p.exited; show('P1m0 ceiling refusal, no signal (off() with nothing armed)', r, 'exit 3, refusing line, no crash'); p.cleanup(); }
// --- window: during the run, parent-only, both signals; repeated
{ const p = run(P, { slow: 'run' }); await p.until(/ run /); await sleep(200); p.child.kill('SIGTERM'); const r = await p.exited; show('P2t SIGTERM mid-run (parent only)', r, 'survives; run|down|network|images; receipt; interrupted SIGTERM; exit 143'); p.cleanup(); }
{ const p = run(P, { slow: 'run' }); await p.until(/ run /); await sleep(200); p.child.kill('SIGINT'); const r = await p.exited; show('P2i SIGINT mid-run (parent only)', r, 'survives; exit 130'); p.cleanup(); }
{ const p = run(P, { slow: 'run' }); await p.until(/ run /); await sleep(200); p.child.kill('SIGINT'); await sleep(200); p.child.kill('SIGINT'); await sleep(200); p.child.kill('SIGTERM'); const r = await p.exited; show('P2 SIGINT,SIGINT,SIGTERM mid-run', r, 'survives; first wins; exit 130'); p.cleanup(); }
// --- window: during the run, group delivery, both signals
{ const p = run(P, { slow: 'run', detached: true }); await p.until(/ run /); await sleep(200); process.kill(-p.child.pid, 'SIGTERM'); const r = await p.exited; show('P2gt SIGTERM to the group mid-run', r, 'survives; run exit=null; exit 5 (NO_BUILD kept); interrupted SIGTERM'); p.cleanup(); }
{ const p = run(P, { slow: 'run', detached: true }); await p.until(/ run /); await sleep(200); process.kill(-p.child.pid, 'SIGINT'); const r = await p.exited; show('P2gi SIGINT to the group mid-run', r, 'survives; run exit=null; exit 5; interrupted SIGINT'); p.cleanup(); }
// --- window: during `down` (run completed cleanly first)
{ const p = run(P, { slow: 'down' }); await p.until(/ down /); await sleep(300); p.child.kill('SIGTERM'); const r = await p.exited; show('P4t SIGTERM during down (parent only)', r, 'survives; down completes; leak check runs; exit 143; interrupted SIGTERM'); p.cleanup(); }
{ const p = run(P, { slow: 'down' }); await p.until(/ down /); await sleep(300); p.child.kill('SIGINT'); const r = await p.exited; show('P4i SIGINT during down (parent only)', r, 'survives; exit 130'); p.cleanup(); }
{ const p = run(P, { slow: 'down', detached: true }); await p.until(/ down /); await sleep(300); process.kill(-p.child.pid, 'SIGINT'); const r = await p.exited; show('P4g SIGINT to the group during down', r, 'survives; down exit=null; leak check still runs; exit 130 (stub reports no leak)'); p.cleanup(); }
// --- window: during the leak-check `images`
{ const p = run(P, { slow: 'images' }); await p.until(/images/); await sleep(300); p.child.kill('SIGTERM'); const r = await p.exited; show('P5 SIGTERM during leak-check images', r, 'survives; exit 143; interrupted SIGTERM'); p.cleanup(); }
// --- second signal during teardown
{ const p = run(P, { slow: 'run,down' }); await p.until(/ run /); await sleep(200); p.child.kill('SIGTERM'); await p.until(/ down /); await sleep(300); p.child.kill('SIGINT'); const r = await p.exited; show('P6 SIGTERM mid-run then SIGINT during down', r, 'survives both; first wins: exit 143, interrupted SIGTERM'); p.cleanup(); }
{ const p = run(P, { slow: 'run,down', detached: true }); await p.until(/ run /); await sleep(200); p.child.kill('SIGINT'); await p.until(/ down /); await sleep(300); process.kill(-p.child.pid, 'SIGTERM'); const r = await p.exited; show('P6g SIGINT mid-run then group SIGTERM during down', r, 'survives; down exit=null; first wins: exit 130'); p.cleanup(); }
// --- lib exit non-zero is kept under a signal
{ const p = run(P, { slow: 'run', env: { AS121_RUN_MODE: 'fail' } }); await p.until(/ run /); await sleep(200); p.child.kill('SIGTERM'); const r = await p.exited; show('P10 SIGTERM mid-run, run exits 1 (fail 1)', r, 'exit 1 kept; interrupted line present'); p.cleanup(); }
{ const p = run(P, { slow: 'run', env: { AS121_RUN_MODE: 'nobuilt' } }); await p.until(/ run /); await sleep(200); p.child.kill('SIGTERM'); const r = await p.exited; show('P11 SIGTERM mid-run, run prints no Built line', r, 'exit 5 kept; no-Built line + interrupted line'); p.cleanup(); }
// --- out-of-scope signal: SIGHUP mid-run (plan names only INT/TERM)
{ const p = run(P, { slow: 'run' }); await p.until(/ run /); await sleep(200); p.child.kill('SIGHUP'); const r = await p.exited; show('P7 SIGHUP mid-run (out of scope, observation only)', r, 'dies of SIGHUP, no down (documented non-goal? README names only INT/TERM)'); p.cleanup(); }
// --- --check keeps default disposition for both signals
{ const p = run(['--check'], { slow: 'network' }); await p.until(/network ls/); await sleep(300); p.child.kill('SIGTERM'); const r = await p.exited; show('P3 --check, SIGTERM during network ls', r, 'dies of SIGTERM'); p.cleanup(); }
{ const p = run(['--check'], { slow: 'composels' }); await p.until(/compose ls/); await sleep(300); p.child.kill('SIGINT'); const r = await p.exited; show('P3i --check, SIGINT during compose ls', r, 'dies of SIGINT'); p.cleanup(); }
// --- clean run, no signal: exit 0, receipt, no interrupted line
{ const p = run(P); const r = await p.exited; show('P8 clean run, no signal', r, 'exit 0, receipt, no interrupted line'); p.cleanup(); }
