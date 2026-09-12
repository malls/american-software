// AS-131 review cycle 2 probe (qa-priya): server-side edges at tip b90f2fa.
// 1. Page walk to exhaustion on a 7-root conversation with replies scattered, page 3:
//    every root exactly once, thread lists complete per page, terminal shape.
// 2. before=<reply id>, before=<oldest root id>, before=<oldest root id - 1>.
// 3. Watermark after a PARTIAL page: newest id is a reply to a root outside the page;
//    open page (before=0&limit=2) then POST /api/read with no upTo -> /api/unread 0.
//    Counter-probe: POST with upTo=maxLoadedId(page) leaves residue (proves the probe sees it).
// 4. CLI `history --limit N --json` and `history --json`, and export files: byte-identical between
//    a server booted from MASTER's server.js and one from the BRANCH's server.js on the same DB copy.
import { mkdtempSync, rmSync, copyFileSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = (cmd, args, opts) => new Promise((ok) => execFile(cmd, args, { ...opts, maxBuffer: 1 << 28 }, (err, stdout, stderr) => ok({ status: err ? err.code ?? 1 : 0, stdout: stdout ?? '', stderr: stderr ?? '' })));

const BR = '/Users/forrest/Code/american-software-company/.worktrees/AS-131/apps/chat';
const MA = '/Users/forrest/Code/american-software-company/apps/chat';
const FIXTURE_ROOT = `${BR}/test/fixtures/repo`;
const dir = mkdtempSync(join(tmpdir(), 'chat-probe2-'));
const me = 'human:forrest';
const other = 'agent:cto-owen';

async function boot(appDir, dbPath, dataDir) {
  const { createChatServer } = await import(`${appDir}/server.js`);
  const s = createChatServer({ dbPath, repoRoot: FIXTURE_ROOT, dataDir });
  await new Promise((ok) => s.server.listen(0, '127.0.0.1', ok));
  s.base = `http://127.0.0.1:${s.server.address().port}`;
  return s;
}
const mk = (base) => ({
  get: async (p) => { const r = await fetch(base + p); const t = await r.text(); let d = null; try { d = JSON.parse(t); } catch {} return { status: r.status, text: t, data: d }; },
  post: async (p, b) => { const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); return { status: r.status, data: await r.json() }; },
});

const branch = await boot(BR, join(dir, 'chat.db'), join(dir, 'data'));
const { get, post } = mk(branch.base);
const A = (await post('/api/channels', { name: 'probe-walk', actor: me })).data.conversation.id;
const roots = [];
const replies = {};
for (let i = 1; i <= 7; i++) {
  roots.push((await post('/api/messages', { conversation: A, author: me, body: `root ${i}` })).data.message.id);
  // replies on roots 1, 3, 4 (two), 7 — interleaved so reply ids exceed later roots
  if ([1, 3, 4].includes(i)) {
    (replies[roots[i - 1]] ??= []).push((await post('/api/messages', { conversation: A, author: other, body: `reply on ${i}`, threadRoot: roots[i - 1] })).data.message.id);
  }
}
(replies[roots[3]] ??= []).push((await post('/api/messages', { conversation: A, author: other, body: 'late reply on 4', threadRoot: roots[3] })).data.message.id);
(replies[roots[0]] ??= []).push((await post('/api/messages', { conversation: A, author: other, body: 'late reply on 1', threadRoot: roots[0] })).data.message.id);
console.log('roots', roots, 'replies', replies);
const q = (qs, who = me) => get(`/api/messages?conversation=${A}&me=${encodeURIComponent(who)}&${qs}`);

// 1. walk to exhaustion
console.log('\n== 1. page walk limit=3 to exhaustion');
let before = 0, seen = [], pages = 0, ok = true;
for (;;) {
  const r = await q(`before=${before}&limit=3`);
  pages++;
  const ids = r.data.messages.map((m) => m.id);
  const tkeys = Object.keys(r.data.threads).map(Number).sort((a, b) => a - b);
  const expectT = ids.filter((id) => replies[id]).sort((a, b) => a - b);
  const threadsOk = JSON.stringify(tkeys) === JSON.stringify(expectT) && expectT.every((id) => JSON.stringify(r.data.threads[id].map((m) => m.id)) === JSON.stringify(replies[id]));
  const rcOk = r.data.messages.every((m) => m.replyCount === (replies[m.id] || []).length);
  const asc = ids.every((id, i) => i === 0 || id > ids[i - 1]);
  console.log(`page ${pages} before=${before}: msgs=[${ids}] hasMore=${r.data.hasMore} next=${r.data.nextBefore} threads=${JSON.stringify(tkeys)} threadsExact=${threadsOk} replyCountExact=${rcOk} ascending=${asc}`);
  ok &&= threadsOk && rcOk && asc;
  seen.push(...ids);
  if (!r.data.hasMore) { console.log('terminal: nextBefore', r.data.nextBefore, 'msgs', ids.length); break; }
  before = r.data.nextBefore;
  if (pages > 10) { console.log('RUNAWAY'); ok = false; break; }
}
console.log('walk covers every root exactly once:', JSON.stringify([...seen].sort((a, b) => a - b)) === JSON.stringify([...roots].sort((a, b) => a - b)), '| all page invariants held:', ok);
// exhaust past the end
const past = await q(`before=${roots[0]}&limit=3`);
console.log('before=<oldest root>:', past.status, JSON.stringify({ msgs: past.data.messages.length, hasMore: past.data.hasMore, nextBefore: past.data.nextBefore, threads: past.data.threads }));
const past2 = await q(`before=${roots[0] - 1}&limit=3`);
console.log('before=<oldest root - 1>:', past2.status, JSON.stringify({ msgs: past2.data.messages.length, hasMore: past2.data.hasMore, nextBefore: past2.data.nextBefore }));

// 2. before = a reply id (late reply on 4 is > roots[6]? print both)
console.log('\n== 2. before at reply ids');
for (const rid of [replies[roots[3]][1], replies[roots[0]][0], replies[roots[0]][1]]) {
  const r = await q(`before=${rid}&limit=3`);
  console.log(`before=${rid} (reply):`, r.status, `msgs=[${r.data.messages.map((m) => m.id)}] hasMore=${r.data.hasMore} next=${r.data.nextBefore} threads=${JSON.stringify(Object.keys(r.data.threads))}`);
}

// 3. watermark after a partial page (newest id is a reply on root 1, far outside a 2-root page)
console.log('\n== 3. watermark after partial page');
await post('/api/identities', { id: 'agent:qa-priya', displayName: 'Priya', kind: 'agent' }).catch(() => {});
const reader = 'agent:qa-priya';
const before3 = (await get(`/api/unread?me=${encodeURIComponent(reader)}`)).data.unread.find((g) => g.conversation?.id === A || g.conversationId === A);
console.log('unread before open:', before3 ? (before3.messages?.length ?? JSON.stringify(before3)) : 'none');
const page = await q('before=0&limit=2', reader);
const maxLoaded = Math.max(...page.data.messages.map((m) => m.id), ...Object.values(page.data.threads).flat().map((m) => m.id));
console.log('page msgs', page.data.messages.map((m) => m.id), 'maxLoadedId(page)', maxLoaded, 'conversation max', Math.max(...Object.values(replies).flat(), ...roots));
// counter-probe first: upTo = maxLoaded (the M7 shape) -> residue expected
await post('/api/read', { me: reader, conversation: A, upTo: maxLoaded });
const resid = (await get(`/api/unread?me=${encodeURIComponent(reader)}`)).data.unread.find((g) => (g.conversation?.id ?? g.conversationId) === A);
console.log('counter-probe upTo=maxLoadedId -> unread residue:', resid ? resid.messages.map((m) => m.id) : 'none');
await post('/api/read', { me: reader, conversation: A });
const after = (await get(`/api/unread?me=${encodeURIComponent(reader)}`)).data.unread.find((g) => (g.conversation?.id ?? g.conversationId) === A);
console.log('POST /api/read no upTo -> unread:', after ? after.messages.map((m) => m.id) : 'none (0)');
// new reply on an OUTSIDE root after read: it must be unread (watermark is not "everything forever")
const later = (await post('/api/messages', { conversation: A, author: other, body: 'post-read reply on 1', threadRoot: roots[0] })).data.message.id;
const after2 = (await get(`/api/unread?me=${encodeURIComponent(reader)}`)).data.unread.find((g) => (g.conversation?.id ?? g.conversationId) === A);
console.log('reply after read on outside root', later, '-> unread:', after2 ? after2.messages.map((m) => m.id) : 'none');

// 4. CLI + export parity master vs branch on the same DB
console.log('\n== 4. CLI history/export byte parity (master server vs branch server, same DB copy)');
await branch.close();
copyFileSync(join(dir, 'chat.db'), join(dir, 'chat-master.db'));
const bs = await boot(BR, join(dir, 'chat.db'), join(dir, 'data-b'));
const ms = await boot(MA, join(dir, 'chat-master.db'), join(dir, 'data-m'));
const cli = async (appDir, base, args) => {
  const r = await run('node', [`${appDir}/bin/chat.js`, ...args], { encoding: 'utf8', env: { ...process.env, CHAT_MODE: 'api', CHAT_API: base } });
  return { out: r.stdout, err: r.stderr.replace(/\(node:\d+\) ExperimentalWarning[^\n]*\n\(Use[^\n]*\n?/g, '').slice(0, 300), status: r.status };
};
// Discover the env var the CLI uses for the server URL
const clientSrc = readFileSync(`${BR}/lib/client.js`, 'utf8') + readFileSync(`${BR}/bin/chat.js`, 'utf8');
const envVars = [...clientSrc.matchAll(/process\.env\.([A-Z_]+)/g)].map((m) => m[1]);
console.log('CLI env vars referenced:', [...new Set(envVars)].join(', '));
const strip = (s) => s.replace(/"createdAt":"[^"]+"/g, '"createdAt":"<t>"');
for (const args of [['history', 'probe-walk', '--me', me, '--limit', '3', '--json'], ['history', 'probe-walk', '--me', me, '--json'], ['history', 'probe-walk', '--me', me, '--limit', '3'], ['channels', '--me', me, '--json']]) {
  const b = await cli(BR, bs.base, args), m = await cli(MA, ms.base, args);
  console.log(args.join(' ').padEnd(60), `branch exit=${b.status} master exit=${m.status} bytes=${b.out.length} msgs=${(b.out.match(/"threadRootId"/g)||[]).length}`, b.out === m.out ? 'BYTE-IDENTICAL' : strip(b.out) === strip(m.out) ? 'identical modulo createdAt' : `DIFF\n--- branch\n${b.out.slice(0, 400)}\n--- master\n${m.out.slice(0, 400)}`, b.err ? `\n  branch stderr: ${b.err}` : '', m.err ? `\n  master stderr: ${m.err}` : '');
}
// export: call store.exportFiles if present, else the CLI export subcommand
for (const [label, s, appDir] of [['branch', bs, BR], ['master', ms, MA]]) {
  const r = await run('node', [`${appDir}/bin/chat.js`, 'export', '--out', join(dir, `export-${label}`)], { encoding: 'utf8', env: { ...process.env, CHAT_MODE: 'api', CHAT_API: s.base } });
  console.log(`export ${label}: exit=${r.status}`, r.stderr.slice(0, 160).replace(/\n/g, ' '));
}
if (existsSync(join(dir, 'export-branch')) && existsSync(join(dir, 'export-master'))) {
  const files = (d) => readdirSync(d, { recursive: true }).filter((f) => !f.endsWith('/'));
  const fb = files(join(dir, 'export-branch')).sort(), fm = files(join(dir, 'export-master')).sort();
  console.log('export file lists identical:', JSON.stringify(fb) === JSON.stringify(fm), fb.length, 'files');
  let same = 0, diff = [];
  for (const f of fb) { try { if (readFileSync(join(dir, 'export-branch', f), 'utf8') === readFileSync(join(dir, 'export-master', f), 'utf8')) same++; else diff.push(f); } catch { diff.push(f + ' (unreadable)'); } }
  console.log('export files byte-identical:', same, '/', fb.length, diff.length ? 'DIFF: ' + diff.join(', ') : '');
}
await bs.close(); await ms.close();
rmSync(dir, { recursive: true, force: true });
