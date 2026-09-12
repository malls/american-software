// AS-131 review probe (qa-priya): byte-identity of the legacy paths (?limit=,
// ?since=, bare cold load, 404 bodies) between master's server and the branch's,
// on the SAME seeded sqlite file. Also CLI `history --limit --json` parity.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const MAIN = '/Users/forrest/Code/american-software-company/apps/chat';
const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-131/apps/chat';
const FIXTURE_ROOT = `${WT}/test/fixtures/repo`;
const dir = mkdtempSync(join(tmpdir(), 'chat-parity-'));
const dbPath = join(dir, 'chat.db');

async function boot(appDir) {
  const { createChatServer } = await import(`${appDir}/server.js`);
  const { server, close } = createChatServer({ dbPath, repoRoot: FIXTURE_ROOT, dataDir: join(dir, 'loop-data') });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (path) => { const r = await fetch(base + path); return { status: r.status, text: await r.text() }; };
  const post = async (path, body) => { const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return r.json(); };
  return { base, get, post, close };
}

const me = 'human:forrest';
let s = await boot(WT);
const A = (await s.post('/api/channels', { name: 'parity', actor: me })).conversation.id;
const ids = [];
for (let i = 1; i <= 5; i++) ids.push((await s.post('/api/messages', { conversation: A, author: me, body: `root ${i} sees msg 3 and AS-131` })).message.id);
await s.post('/api/messages', { conversation: A, author: 'agent:cto-owen', body: 'reply on 2', threadRoot: ids[1] });
await s.post('/api/messages', { conversation: A, author: 'agent:cto-owen', body: 'reply on 5', threadRoot: ids[4] });
await s.post('/api/identities', { id: 'agent:developer-marcus', displayName: 'Marcus', kind: 'agent' });
const N = 'agent:developer-marcus';
const board = JSON.parse((await s.get(`/api/conversations?me=${me}`)).text).conversations.find((c) => c.name === 'board').id;
const paths = [
  `/api/messages?conversation=${A}&me=${me}`,
  `/api/messages?conversation=${A}&me=${me}&limit=2`,
  `/api/messages?conversation=${A}&me=${me}&limit=abc`,
  `/api/messages?conversation=${A}&me=${me}&limit=0`,
  `/api/messages?conversation=${A}&me=${me}&since=0`,
  `/api/messages?conversation=${A}&me=${me}&since=${ids[2]}`,
  `/api/messages?conversation=${board}&me=${N}`,
  `/api/messages?conversation=${board}&me=${N}&limit=2`,
  `/api/messages?conversation=${board}&me=${N}&since=abc`,
  `/api/messages?conversation=99999&me=${N}`,
  `/api/messages?conversation=99999&me=${N}&before=abc`,
  `/api/messages?conversation=${board}&me=${N}&before=abc`,
  `/api/dump`,
  `/api/export`,
  `/api/unread?me=${me}`,
];
const branch = {};
for (const p of paths) branch[p] = await s.get(p);
await s.close();

s = await boot(MAIN);
const master = {};
for (const p of paths) master[p] = await s.get(p);
await s.close();

let diffs = 0;
for (const p of paths) {
  const same = branch[p].status === master[p].status && branch[p].text === master[p].text;
  if (!same) diffs++;
  console.log(same ? 'IDENTICAL' : 'DIFF     ', branch[p].status, master[p].status, p);
  if (!same) console.log('  branch:', branch[p].text.slice(0, 300), '\n  master:', master[p].text.slice(0, 300));
}
// Note: the two 404 rows with before=abc are expected to DIFFER between
// master and branch only if master answered the bare cold load (200) — that is
// the new branch, not a regression. Reported for the record.
console.log('http diffs', diffs);

// CLI parity: bin/chat.js history --limit N --json on the same db, both trees.
for (const args of [['history', 'parity', '--limit', '2', '--json'], ['history', 'parity', '--json']]) {
  const run = (appDir) => spawnSync('node', [`${appDir}/bin/chat.js`, ...args], { env: { ...process.env, CHAT_DB: dbPath, CHAT_MODE: 'direct', CHAT_ME: me }, encoding: 'utf8' });
  const b = run(WT), m = run(MAIN);
  console.log('CLI', args.join(' '), '| status', b.status, m.status, '| identical:', b.stdout === m.stdout && b.stderr === m.stderr, '| bytes', b.stdout.length, m.stdout.length);
  if (b.stdout !== m.stdout) console.log(' branch:', b.stdout.slice(0, 200), b.stderr.slice(0, 200), '\n master:', m.stdout.slice(0, 200), m.stderr.slice(0, 200));
}
rmSync(dir, { recursive: true, force: true });
