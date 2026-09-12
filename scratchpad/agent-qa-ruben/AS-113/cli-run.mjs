// Run the AS-113 CLI against the slow fake server with a given budget, under a wall cap.
// Usage: node cli-run.mjs <budget> [capMs]
import { spawnSync } from 'node:child_process';
const CLI = '/Users/forrest/Code/american-software-company/.worktrees/AS-113/apps/chat/bin/chat.js';
const budget = process.argv[2];
const cap = Number(process.argv[3] || 10000);
const env = { ...process.env, CHAT_API: 'http://127.0.0.1:18347', CHAT_PROBE_TIMEOUT_MS: budget };
delete env.CHAT_DB; delete env.CHAT_MODE;
const t0 = Date.now();
const r = spawnSync('node', [CLI, 'channels', '--me', 'human:forrest'], { env, encoding: 'utf8', timeout: cap });
const wall = Date.now() - t0;
const err = (r.stderr || '').split('\n').filter((l) => !l.includes('ExperimentalWarning') && l.trim()).join(' | ');
console.log(`budget=${budget} status=${r.status} signal=${r.signal} wall=${wall}ms\n  stdout=${(r.stdout || '').trim().replace(/\n/g, ' | ')}\n  stderr=${err}`);
