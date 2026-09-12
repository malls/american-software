// Scratch server launcher for AS-115 manual checks: port 8399, scratch DB, never the live DB.
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
const D = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-115/data';
mkdirSync(D, { recursive: true });
const child = spawn('node', ['server.js'], {
  cwd: '/Users/forrest/Code/american-software-company/.worktrees/AS-115/apps/chat',
  env: { ...process.env, PORT: '8399', CHAT_BIND: '127.0.0.1', CHAT_DB: D + '/chat.db', CHAT_EVENTS_PATH: D + '/company.jsonl', CHAT_REPO_ROOT: '/Users/forrest/Code/american-software-company/.worktrees/AS-115' },
  stdio: ['ignore', 'inherit', 'inherit'], detached: true,
});
writeFileSync(D + '/server.pid', String(child.pid));
console.log('scratch server pid', child.pid);
child.unref();
