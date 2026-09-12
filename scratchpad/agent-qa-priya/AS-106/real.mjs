// qa-priya AS-106 review helper: run the opt-in T11 real test (AS106_REAL=1) from a given dir.
// usage: node real.mjs <apps/chat dir> [extra env K=V ...]
import { spawnSync } from 'node:child_process';
const [dir, ...kv] = process.argv.slice(2);
const env = { ...process.env, AS106_REAL: '1', ADVANCE_DOCKER_BIN: '/usr/local/bin/docker', FORCE_COLOR: '0' };
for (const pair of kv) { const [k, v] = pair.split('='); env[k] = v; }
const r = spawnSync(process.execPath, ['--test', 'test/compose-run.test.js'], { cwd: dir, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env });
const out = (r.stdout || '') + (r.stderr || '');
process.stdout.write(out);
console.log(`status=${r.status}`);
