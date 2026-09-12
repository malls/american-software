// AS-131 review probe (qa-priya): drive untested inputs against ?before=/limit
// on a scratch server booted from the worktree. Read-only w.r.t. the repo.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createChatServer } from '/Users/forrest/Code/american-software-company/.worktrees/AS-131/apps/chat/server.js';

const FIXTURE_ROOT = '/Users/forrest/Code/american-software-company/.worktrees/AS-131/apps/chat/test/fixtures/repo';
const dir = mkdtempSync(join(tmpdir(), 'chat-probe-'));
const { server, store, close } = createChatServer({ dbPath: join(dir, 'chat.db'), repoRoot: FIXTURE_ROOT, dataDir: join(dir, 'loop-data') });
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;
const get = async (path) => { const r = await fetch(base + path); const t = await r.text(); return { status: r.status, text: t, data: (() => { try { return JSON.parse(t); } catch { return null; } })() }; };
const post = async (path, body) => { const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, data: await r.json() }; };

const me = 'human:forrest';
const A = (await post('/api/channels', { name: 'probe-a', actor: me })).data.conversation.id;
const B = (await post('/api/channels', { name: 'probe-b', actor: me })).data.conversation.id;
const ids = [];
for (let i = 1; i <= 5; i++) ids.push((await post('/api/messages', { conversation: A, author: me, body: `A root ${i}` })).data.message.id);
const bIds = [];
for (let i = 1; i <= 3; i++) bIds.push((await post('/api/messages', { conversation: B, author: me, body: `B root ${i}` })).data.message.id);
// replies: on A root 2 and A root 5, and B root 1 — newest rows of A are all replies
const rep = async (conv, root, body) => (await post('/api/messages', { conversation: conv, author: 'agent:cto-owen', body, threadRoot: root })).data.message.id;
const a2r1 = await rep(A, ids[1], 'a2 reply 1');
const a5r1 = await rep(A, ids[4], 'a5 reply 1');
const a2r2 = await rep(A, ids[1], 'a2 reply 2');
const b1r1 = await rep(B, bIds[0], 'b1 reply 1');
console.log('A roots', ids, 'B roots', bIds, 'replies', { a2r1, a5r1, a2r2, b1r1 });

const q = (conv, qs) => get(`/api/messages?conversation=${conv}&me=${encodeURIComponent(me)}&${qs}`);
const show = (label, r) => console.log(label.padEnd(44), r.status, r.data ? (r.data.error ?? `msgs=[${(r.data.messages||[]).map(m=>m.id)}] threads=${JSON.stringify(Object.keys(r.data.threads||{}))} hasMore=${r.data.hasMore} next=${r.data.nextBefore} keys=${Object.keys(r.data).sort()}`) : r.text.slice(0,80));

for (const qs of [
  'before=0', 'before=', 'before=%20', 'before=-1', 'before=1.5', 'before=1e2', 'before=0x10', 'before=abc',
  'before=99999999999999999999', 'before=1e308', 'before=Infinity', 'before=NaN', 'before=null', 'before=true',
  'before=0&limit=', 'before=0&limit=%20', 'before=0&limit=1e1', 'before=0&limit=0x5', 'before=0&limit=-1', 'before=0&limit=2.0', 'before=0&limit=200', 'before=0&limit=201', 'before=0&limit=1',
  `before=${bIds[1]}`, // id from ANOTHER conversation (B root 2) used as cursor in A
  `before=${a2r2}`, // before pointing at a reply id
  `before=${a5r1}`,
  `before=${ids[0]}`, // before oldest root -> empty
  'before=0&before=5', // duplicate param
  'before=0&since=0', // since wins?
  'before=0&limit=2&since=0',
  'limit=2', 'limit=abc', 'limit=0', // legacy limit path (no before) — must be untouched
  'since=0',
]) show(qs, await q(A, qs));

// Conversation whose newest rows are all replies: A's max id is a2r2 (reply to root 2). Page limit 1 -> root 5 with its reply.
show('A newest page limit=1', await q(A, 'before=0&limit=1'));
// 404 parity: hidden vs missing with weird cursors, for a non-member
await post('/api/identities', { id: 'agent:developer-marcus', displayName: 'Marcus', kind: 'agent' });
const N = 'agent:developer-marcus';
const convs = (await get(`/api/conversations?me=${me}`)).data.conversations;
const board = convs.find((c) => c.name === 'board');
for (const qs of ['before=', 'before=1e308', 'before=0&limit=', 'before=0&limit=-1', 'before=0&before=abc']) {
  const h = await get(`/api/messages?conversation=${board.id}&me=${encodeURIComponent(N)}&${qs}`);
  const m = await get(`/api/messages?conversation=99999&me=${encodeURIComponent(N)}&${qs}`);
  const norm = (t, id) => t.replaceAll(`'${id}'`, "'<id>'");
  console.log('parity', qs.padEnd(24), h.status, m.status, norm(h.text, board.id) === norm(m.text, 99999) ? 'IDENTICAL' : `DIFF: ${h.text} vs ${m.text}`);
}
// Compare legacy responses with master's server for byte-identity: dump raw text for ?limit=2, ?since=0, no-params
const legacy = {};
for (const qs of ['limit=2', 'since=0', '', 'limit=abc']) legacy[qs] = (await q(A, qs)).text;
console.log('LEGACY_JSON', JSON.stringify(legacy));
await close();
rmSync(dir, { recursive: true, force: true });
