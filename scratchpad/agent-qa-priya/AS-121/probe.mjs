// Probes past the list (AS-121 review). Stub docker: sleeps on `network ls` (preflight) and on `run`.
//   P1: SIGTERM during the preflight `network ls` (guard window) — does the run then proceed?
//   P2: SIGINT twice, then SIGTERM, all mid-run — survives all; first signal wins; exit 130.
//   P3: --check with SIGTERM during `network ls` — default disposition (dies of the signal).
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
const SCRIPT = '/Users/forrest/Code/american-software-company/.worktrees/AS-121/apps/chat/bin/compose-run.mjs';
const STUB = `#!/bin/sh
echo "$*" >> "$AS121_LOG"
case "$*" in
  *"network ls"*) sleep 2 ;;
  *" run "*) echo started; sleep 2; printf 'ℹ tests 1\\nℹ pass 1\\nℹ fail 0\\nℹ skipped 0\\n Image asc-probe-test Built \\n' ;;
  *"compose ls"*) echo '[]' ;;
esac
`;
function run(args) {
  const dir = mkdtempSync(join(tmpdir(), 'asc-as121-probe-'));
  const bin = join(dir, 'docker'); const log = join(dir, 'argv.log');
  writeFileSync(bin, STUB, { mode: 0o755 }); writeFileSync(log, '');
  const child = spawn(process.execPath, [SCRIPT, ...args.map((a) => (a === '@DIR' ? dir : a))], { env: { ...process.env, ADVANCE_DOCKER_BIN: bin, AS121_LOG: log }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', (d) => { stdout += d; }); child.stderr.on('data', (d) => { stderr += d; });
  const exited = new Promise((res) => child.on('exit', (code, signal) => res({ code, signal, stdout, stderr, log: readFileSync(log, 'utf8').split('\n').filter(Boolean) })));
  const lines = () => readFileSync(log, 'utf8').split('\n').filter(Boolean);
  const until = async (re) => { for (let i = 0; i < 200; i++) { if (lines().some((l) => re.test(l))) return; await sleep(25); } throw new Error('never saw ' + re); };
  return { child, exited, until, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
const show = (name, r) => console.log(`\n== ${name}\ncode=${r.code} signal=${r.signal}\nlog: ${r.log.map((l) => l.replace(/^.*docker /, '').split(' ').slice(0, 3).join(' ')).join(' | ')}\nstdout: ${r.stdout.trim().split('\n').slice(0, 2).join(' / ')}\nstderr: ${r.stderr.trim()}`);

// P1
{ const p = run(['--project', 'asc-probe-p1', '--cwd', '@DIR']); await p.until(/network ls/); await sleep(300); p.child.kill('SIGTERM'); const r = await p.exited; show('P1 SIGTERM during preflight network ls', r); p.cleanup(); }
// P2
{ const p = run(['--project', 'asc-probe-p2', '--cwd', '@DIR']); await p.until(/ run /); await sleep(200); p.child.kill('SIGINT'); await sleep(200); p.child.kill('SIGINT'); await sleep(200); p.child.kill('SIGTERM'); const r = await p.exited; show('P2 SIGINT,SIGINT,SIGTERM mid-run', r); p.cleanup(); }
// P3
{ const p = run(['--check']); await p.until(/network ls/); await sleep(300); p.child.kill('SIGTERM'); const r = await p.exited; show('P3 --check, SIGTERM during network ls', r); p.cleanup(); }
