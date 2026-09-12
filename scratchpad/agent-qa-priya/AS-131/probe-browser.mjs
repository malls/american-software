// AS-131 review probe (qa-priya): drive the branch's served client in headless
// Chrome (CDP over node's global WebSocket, zero deps) against a scratch server
// booted from the worktree on a random port. NOT the live 8347 deploy.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-131/apps/chat';
const FIXTURE_ROOT = `${WT}/test/fixtures/repo`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const { createChatServer } = await import(`${WT}/server.js`);
const dir = mkdtempSync(join(tmpdir(), 'chat-browser-'));
const { server, close } = createChatServer({ dbPath: join(dir, 'chat.db'), repoRoot: FIXTURE_ROOT, dataDir: join(dir, 'loop-data') });
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;
const get = async (p) => (await fetch(base + p)).json();
const post = async (p, body) => (await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();

const me = 'human:forrest';
const other = 'agent:cto-owen';
const eng = (await get(`/api/conversations?me=${me}`)).conversations.find((c) => c.name === 'engineering').id;
// 130 roots from Owen -> 3 pages (50/50/30). Replies on root 3 (old) and root 128 (newest page); the
// conversation max id is a reply to root 3 (outside the newest page) — watermark probe.
const roots = [];
for (let i = 1; i <= 130; i++) roots.push((await post('/api/messages', { conversation: eng, author: other, body: `root ${i}` })).message.id);
const rOld1 = (await post('/api/messages', { conversation: eng, author: other, body: 'old reply 1', threadRoot: roots[2] })).message.id;
const rNew1 = (await post('/api/messages', { conversation: eng, author: other, body: 'new reply 1', threadRoot: roots[127] })).message.id;
const rOld2 = (await post('/api/messages', { conversation: eng, author: other, body: 'old reply 2 (conversation max)', threadRoot: roots[2] })).message.id;
const gen = (await get(`/api/conversations?me=${me}`)).conversations.find((c) => c.name === 'announcements').id;
for (let i = 1; i <= 3; i++) await post('/api/messages', { conversation: gen, author: other, body: `announcements ${i}` });
console.log('seeded: roots', roots[0], '..', roots[129], 'replies', { rOld1, rNew1, rOld2 });

// --- headless Chrome via CDP ---
const port = 9300 + Math.floor(Math.random() * 500);
const profile = join(dir, 'chrome-profile');
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
let targets;
for (let i = 0; i < 50; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break; } catch {}
  await new Promise((r) => setTimeout(r, 200));
}
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((ok) => (ws.onopen = ok));
let seq = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const cdp = (method, params = {}) => new Promise((ok) => { const id = ++seq; pending.set(id, ok); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expr) => { const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await cdp('Page.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
const nav = async (url) => { await cdp('Page.navigate', { url }); await sleep(1200); };
const snap = () => evaluate(`(() => { const p = document.querySelector('#messages'); const msgs = [...p.querySelectorAll('.message')].map(n => Number(n.id.slice(4)));
  return { count: msgs.length, first: msgs[0], last: msgs[msgs.length-1], scrollTop: p.scrollTop, scrollHeight: p.scrollHeight, clientHeight: p.clientHeight, button: !!p.querySelector('.load-earlier'), buttonFirst: p.firstElementChild?.className, url: location.search, threadOpen: !document.querySelector('#thread-modal').hidden, threadTitle: document.querySelector('#thread-title').textContent, anchored: [...document.querySelectorAll('.message.anchored')].map(n=>n.id) }; })()`);
const rowTop = (id) => evaluate(`(() => { const n = document.querySelector('#msg-${id}'); return n ? n.getBoundingClientRect().top : null; })()`);
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name, detail ?? ''); };

// 1. Cold open of #engineering: 50 roots, newest page, at bottom, Load-earlier button first.
await nav(`${base}/?c=engineering`);
let s = await snap();
check('1 cold open = newest 50 roots', s.count === 50 && s.first === roots[80] && s.last === roots[129], JSON.stringify(s));
check('1b button rendered first while hasMore', s.button && s.buttonFirst === 'load-earlier');
check('1c opened at bottom (AS-17 scroll:bottom)', s.scrollHeight - s.scrollTop - s.clientHeight < 40, `${s.scrollTop}/${s.scrollHeight}/${s.clientHeight}`);
const unread0 = await get(`/api/unread?me=${me}`);
check('1d watermark: no unread residue after page-mode open (max is a reply to an unloaded root)', !unread0.unread.some((g) => g.conversationId === eng), JSON.stringify(unread0.unread.map((g) => [g.conversationId, g.messages.length])));

// 2. Scroll-up #1: set scrollTop to 0 -> page 2 prepends; the row that was at the top must not move.
// Measure the row's viewport offset AFTER the user's scroll to 0 but BEFORE the
// (async) scroll event fires the prepend: same synchronous evaluate.
const topRowBefore = roots[80];
const topBefore = await evaluate(`(() => { document.querySelector('#messages').scrollTop = 0; return document.querySelector('#msg-${topRowBefore}').getBoundingClientRect().top; })()`);
await sleep(900);
s = await snap(); const topAfter = await rowTop(topRowBefore);
check('2 scroll-up #1 prepends page 2 (100 rows)', s.count === 100 && s.first === roots[30], JSON.stringify({ count: s.count, first: s.first, scrollTop: s.scrollTop }));
check('2b reader row did not move (viewport offset preserved)', topBefore != null && topAfter != null && Math.abs(topAfter - topBefore) <= 1, `${topBefore} -> ${topAfter}`);
check('2c one prepend does not re-trigger (scrollTop > threshold)', s.scrollTop >= 200, String(s.scrollTop));

// 3. Scroll-up #2: page 3 (30 rows) -> 130, button gone.
await evaluate(`document.querySelector('#messages').scrollTop = 0; true`);
await sleep(900);
s = await snap();
check('3 scroll-up #2 loads the last page (130), no button', s.count === 130 && s.first === roots[0] && !s.button, JSON.stringify({ count: s.count, first: s.first, button: s.button }));
// 3b. scroll to top again: no further fetch (hasMore false) — count stays 130.
await evaluate(`document.querySelector('#messages').scrollTop = 0; true`);
await sleep(600);
s = await snap();
check('3b at top with hasMore=false: nothing happens', s.count === 130 && s.scrollTop === 0);

// 4. Post a reply while scrolled up (plan step 4): live frame merges, replyCount shows, viewport NOT yanked to bottom.
await evaluate(`document.querySelector('#messages').scrollTop = 500; true`);
await sleep(200);
const beforeReply = await snap();
const liveReply = (await post('/api/messages', { conversation: eng, author: other, body: 'live reply on root 128', threadRoot: roots[127] })).message.id;
await sleep(800);
s = await snap();
const replyLabel = await evaluate(`document.querySelector('#msg-${roots[127]} .thread-link')?.textContent ?? null`);
check('4 live reply: replyCount re-rendered on the loaded root', replyLabel === '2 replies', String(replyLabel));
check('4b live frame does not yank a scrolled-up reader (AS-17 preserve)', s.scrollTop === beforeReply.scrollTop, `${beforeReply.scrollTop} -> ${s.scrollTop}`);
// 4c. live reply on an OLD root after all pages loaded: replyCount on root 3 increments
const liveOld = (await post('/api/messages', { conversation: eng, author: other, body: 'live reply on root 3', threadRoot: roots[2] })).message.id;
await sleep(800);
const oldLabel = await evaluate(`document.querySelector('#msg-${roots[2]} .thread-link')?.textContent ?? null`);
check('4c live reply on a paged-in old root increments its count (2 -> 3)', oldLabel === '3 replies', String(oldLabel));
// 4d. new top-level live message appends (count 131) with scroll preserved
await post('/api/messages', { conversation: eng, author: other, body: 'live root 131' });
await sleep(800);
s = await snap();
check('4d live top-level appends (131) with scroll preserved', s.count === 131 && s.scrollTop === beforeReply.scrollTop, JSON.stringify({ count: s.count, scrollTop: s.scrollTop }));

// 5. Switching conversation resets paging state: open #announcements (3 msgs, no button), then back to engineering = 50 again.
await nav(`${base}/?c=announcements`);
s = await snap();
check('5 #announcements: 3 rows, no button, no leaked engineering rows', s.count === 3 && !s.button, JSON.stringify(s));
await nav(`${base}/?c=engineering`);
s = await snap();
check('5b back to engineering: fresh newest page (51 rows now), button back', s.count === 50 && s.button, JSON.stringify({ count: s.count, button: s.button, first: s.first }));

// 6. Permalink to a root in page 3 (root 3): ensureLoaded pages back before render; anchored; loaded 130+.
await nav(`${base}/?c=engineering&m=${roots[2]}`);
s = await snap();
check('6 ?m= outside the page: paged in and anchored', s.count >= 130 && s.anchored.includes(`msg-${roots[2]}`), JSON.stringify({ count: s.count, anchored: s.anchored, url: s.url }));
const anchorTop = await rowTop(roots[2]);
check('6b anchored row is in the viewport', anchorTop != null && anchorTop >= 0 && anchorTop <= 800, String(anchorTop));

// 7. ?t= thread root in page 3 (+ ?m= reply inside it): thread opens with 4 replies.
await nav(`${base}/?c=engineering&t=${roots[2]}&m=${rOld2}`);
s = await snap();
const threadCount = await evaluate(`document.querySelectorAll('#thread-messages .message').length`);
check('7 ?t=&m= outside the page: thread opens with root + all replies', s.threadOpen && threadCount === 4 && s.anchored.includes(`msg-${rOld2}`), JSON.stringify({ threadOpen: s.threadOpen, threadTitle: s.threadTitle, threadCount, anchored: s.anchored, url: s.url }));

// 8. Dead id permalink still strips like AS-9 (m=999999): no crash, URL normalized.
await nav(`${base}/?c=engineering&m=999999`);
s = await snap();
check('8 dead ?m= (past every page): loads all pages, strips m=, no crash', s.count >= 130 && !/m=/.test(s.url), JSON.stringify({ count: s.count, url: s.url }));

// 9. Race: start loading older, switch conversation before it lands -> no cross-conversation leak.
await nav(`${base}/?c=engineering`);
await evaluate(`(async () => { const p = document.querySelector('#messages'); p.scrollTop = 0; await new Promise(r => setTimeout(r, 5)); document.querySelector('#sidebar a[href*="c=announcements"], #sidebar li')?.click(); })()`);
await sleep(1500);
s = await snap();
const title = await evaluate(`document.querySelector('#conv-title').textContent`);
check('9 switch during load-older: no engineering rows in the new pane', (s.count === 3 && /announcements/.test(title)) || s.count === 50 || s.count === 100, JSON.stringify({ count: s.count, title, url: s.url }));

// 10. Click the Load-earlier button (covers the short-page path): from a fresh open, click -> 100.
await nav(`${base}/?c=engineering`);
await evaluate(`document.querySelector('#messages .load-earlier').click(); true`);
await sleep(900);
s = await snap();
check('10 Load-earlier button click prepends page 2', s.count === 100, String(s.count));
// 10b. double-click quickly: at most one extra page (guard), no duplicates
await evaluate(`const b = document.querySelector('#messages .load-earlier'); b.click(); b.click(); b.click(); true`);
await sleep(900);
s = await snap();
const dupes = await evaluate(`(() => { const ids = [...document.querySelectorAll('#messages .message')].map(n => n.id); return ids.length - new Set(ids).size; })()`);
check('10b triple-click: one fetch (131 rows), zero duplicate nodes', s.count === 131 && dupes === 0 && !s.button, JSON.stringify({ count: s.count, dupes, button: s.button }));

// 11. Zero-external-calls floor: the served client has no absolute http(s) URLs added by this diff.
const appJs = await (await fetch(base + '/app.js')).text();
const liveJs = await (await fetch(base + '/live.js')).text();
check('11 no external URLs in app.js/live.js', !/https?:\/\/(?!127\.0\.0\.1|localhost)/.test(appJs + liveJs));

console.log('\nSUMMARY', results.filter((r) => r.ok).length, 'pass /', results.length);
ws.close(); chrome.kill('SIGKILL');
await close();
rmSync(dir, { recursive: true, force: true });
process.exit(0);
