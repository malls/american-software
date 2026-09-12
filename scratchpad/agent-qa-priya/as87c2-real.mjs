// AS-87 cycle-2 review: run the opt-in real-build test against a given test file path.
// usage: node as87c2-real.mjs <test-file> <log-out>
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const [file, out] = process.argv.slice(2);
const cwd = '/Users/forrest/Code/american-software-company/.worktrees/AS-87/apps/chat';
const env = { ...process.env, AS87_REAL_BUILD: '1', ADVANCE_DOCKER_BIN: '/usr/local/bin/docker' };
const t0 = Date.now();
const r = spawnSync(process.execPath, ['--test', file], { cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const secs = ((Date.now() - t0) / 1000).toFixed(1);
writeFileSync(out, `${r.stdout}\n${r.stderr}\n[real] exit=${r.status} signal=${r.signal} wall=${secs}s\n`);
console.log(`[real] ${file} exit=${r.status} wall=${secs}s -> ${out}`);
