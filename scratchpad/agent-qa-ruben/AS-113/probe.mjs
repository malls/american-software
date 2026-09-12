import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const CLI = '/Users/forrest/Code/american-software-company/.worktrees/AS-113/apps/chat/bin/chat.js';
const cases = [
  ['unset', undefined], ['empty', ''], ['ws-only', '  '], ['0', '0'], ['1', '1'],
  ['3000', '3000'], ['ceil', '2147483647'], ['ceil+1', '2147483648'], ['2^32', '4294967296'],
  ['huge', '99999999999999999999'], ['1e9', '1e9'], ['+5', '+5'], ['-5', '-5'], [' 5', ' 5'], ['5 ', '5 '],
  ['1.5', '1.5'], ['0x10', '0x10'], ['1_000', '1_000'], ['Infinity', 'Infinity'], ['NaN', 'NaN'], ['007', '007'],
  ['ceil-leading-zero', '02147483647'], ['ceil+1-leading-zero', '02147483648'], ['arabic-digit', '٥'],
];
const rows = [];
for (const [label, val] of cases) {
  const dir = mkdtempSync(join(tmpdir(), 'as113-probe-'));
  const db = join(dir, 'chat.db');
  const env = { ...process.env, CHAT_DB: db };
  delete env.CHAT_API; delete env.CHAT_MODE; delete env.CHAT_PROBE_TIMEOUT_MS;
  if (val !== undefined) env.CHAT_PROBE_TIMEOUT_MS = val;
  const r = spawnSync('node', [CLI, 'channels', '--me', 'human:forrest'], { env, encoding: 'utf8' });
  const touched = existsSync(db) || existsSync(db + '-wal') || existsSync(db + '-shm');
  const err = ((r.stderr || '').split('\n').find((l) => l.startsWith('chat:')) || '').slice(0, 150);
  rows.push(`| ${label} | ${JSON.stringify(val)} | ${r.status} | ${touched ? 'yes' : 'no'} | ${err || '(none)'} |`);
  rmSync(dir, { recursive: true, force: true });
}
console.log('| case | value | exit | db created | stderr (first line) |\n|---|---|---|---|---|');
console.log(rows.join('\n'));
