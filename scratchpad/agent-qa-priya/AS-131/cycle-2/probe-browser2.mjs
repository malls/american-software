// AS-131 review cycle 2 browser probe (qa-priya): F1 fix at b90f2fa and its neighbours,
// driven in headless Chrome (CDP, zero deps) against a scratch server booted from the
// worktree on a random port. Never the live 8347 deploy. window.fetch is wrapped after
// load so the number of /api/messages fetches per action is observable.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-131/apps/chat';
const FIXTURE_ROOT = `${WT}/test/fixtures/repo`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const { createChatServer } = await import(`${WT}/server.js`);
const dir = mkdtempSync(join(tmpdir(), 'chat-browser2-'));
const { server, close } = createChatServer({ dbPath: join(dir, 'chat.db'), repoRoot: FIXTURE_ROOT, dataDir: join(dir, 'loop-data') });
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;
const get = async (p) => (await fetch(base + p)).json();
const post = async (p, body) => (await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
const me = 'human:forrest', other = 'agent:cto-owen';
const convs = (await get(`/api/conversations?me=${me}`)).conversations;
const eng = convs.find((c) => c.name === 'engineering').id;
const ann = convs.find((c) => c.name === 'announcements').id;
// engineering: 130 roots (3 pages: 50/50/30). root 3 (page 3) has one earlier reply.
const roots = [];
for (let i = 1; i <= 130; i++) roots.push((await post('/api/messages', { conversation: eng, author: other, body: `root ${i}` })).message.id);
const deepRoot = roots[2];
const earlier = (await post('/api/messages', { conversation: eng, author: other, body: 'earlier reply on root 3', threadRoot: deepRoot })).message.id;
// announcements: 120 roots, root 5 deep, with one reply — cross-conversation target.
const aRoots = [];
for (let i = 1; i <= 120; i++) aRoots.push((await post('/api/messages', { conversation: ann, author: other, body: `ann ${i}` })).message.id);
const aDeepReply = (await post('/api/messages', { conversation: ann, author: other, body: 'deep ann reply', threadRoot: aRoots[4] })).message.id;
console.log('seeded eng roots', roots[0], '..', roots[129], 'deepRoot', deepRoot, 'earlier', earlier, '| ann deep root', aRoots[4], 'reply', aDeepReply);

const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${port}`, `--user-data-dir=${join(dir, 'prof')}`, 'about:blank'], { stdio: 'ignore' });
let targets; for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((ok) => (ws.onopen = ok));
let seq = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const cdp = (method, params = {}) => new Promise((ok) => { const id = ++seq; pending.set(id, ok); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expr) => { const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await cdp('Page.enable'); await cdp('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
const nav = async (url) => { await cdp('Page.navigate', { url }); await sleep(1300); await evaluate(`window.__f = []; const _f = window.fetch; window.fetch = (u, o) => { window.__f.push(String(u)); return _f(u, o); }; true`); };
const fetches = () => evaluate(`(() => { const f = window.__f.slice(); window.__f = []; return f; })()`);
const snap = () => evaluate(`(() => { const p = document.querySelector('#messages'); const msgs = [...p.querySelectorAll('.message')].map(n => Number(n.id.slice(4)));
  return { count: msgs.length, first: msgs[0], last: msgs[msgs.length-1], url: location.search, threadOpen: !document.querySelector('#thread-modal').hidden, threadTitle: document.querySelector('#thread-title').textContent,
    threadNodes: [...document.querySelectorAll('#thread-messages .message')].map(n => Number(n.id.slice(4))), anchored: [...document.querySelectorAll('.message.anchored')].map(n=>n.id), convTitle: document.querySelector('#conv-title').textContent }; })()`);
const clickRef = (id) => evaluate(`(() => { const a = [...document.querySelectorAll('#messages a.msg-ref, #thread-messages a.msg-ref')].find(a => a.textContent.trim().endsWith(' ${id}') || a.textContent.trim() === 'msg ${id}'); if (!a) return false; a.click(); return true; })()`);
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name, detail ?? ''); };

// ---- A. F1 exact repro: newest page open, LIVE reply lands on deepRoot (outside the page), msg-ref to it is clicked.
await nav(`${base}/?c=engineering`);
let s = await snap();
check('A0 cold open: 50 rows, deepRoot not loaded', s.count === 50 && s.first === roots[80] && !(await evaluate(`!!document.querySelector('#msg-${deepRoot}')`)), JSON.stringify({ count: s.count, first: s.first }));
const live = (await post('/api/messages', { conversation: eng, author: other, body: 'LIVE reply on root 3', threadRoot: deepRoot })).message.id;
const refRow = (await post('/api/messages', { conversation: eng, author: other, body: `see msg ${live}` })).message.id;
await sleep(900);
await fetches();
check('A1 msg-ref rendered for the live reply', await clickRef(live), '');
await sleep(1500);
s = await snap();
let f = await fetches();
const apiMsgFetches = f.filter((u) => u.includes('/api/messages?'));
check('A2 F1 FIXED: thread modal shows root + earlier + live (3 nodes) in order', s.threadOpen && JSON.stringify(s.threadNodes) === JSON.stringify([deepRoot, earlier, live]), JSON.stringify({ threadOpen: s.threadOpen, title: s.threadTitle, nodes: s.threadNodes }));
check('A3 root paged into the main pane (all 3 pages), reply anchored, URL carries t= and m=', s.count >= 131 && s.anchored.includes(`msg-${live}`) && s.url.includes(`t=${deepRoot}`) && s.url.includes(`m=${live}`), JSON.stringify({ count: s.count, anchored: s.anchored, url: s.url }));
check('A4 network: one /api/message/<id> resolve + page fetches 0,then back to root (4 pages)', f.some((u) => u.includes(`/api/message/${live}?`)) && apiMsgFetches.length === 3, JSON.stringify(f));
const replyLabel = await evaluate(`document.querySelector('#msg-${deepRoot} .thread-link')?.textContent ?? null`);
check('A5 deepRoot replyCount in main pane = 2 (server list authoritative, includes the live reply)', replyLabel === '2 replies', String(replyLabel));

// ---- B. Now the orphan is loaded: same ref again -> no network at all (step 1).
await evaluate(`document.querySelector('#thread-close').click(); true`); await sleep(300); await fetches();
check('B1 second click on the same ref (now loaded)', await clickRef(live)); await sleep(700);
s = await snap(); f = await fetches();
check('B2 opens the thread whole with ZERO fetches', s.threadOpen && JSON.stringify(s.threadNodes) === JSON.stringify([deepRoot, earlier, live]) && f.length === 0, JSON.stringify({ nodes: s.threadNodes, fetches: f }));

// ---- C. Regression: live reply on a LOADED root, ref click -> thread opens via step 1, zero fetches.
await nav(`${base}/?c=engineering`);
const liveNew = (await post('/api/messages', { conversation: eng, author: other, body: 'LIVE reply on root 128', threadRoot: roots[127] })).message.id;
await post('/api/messages', { conversation: eng, author: other, body: `and see msg ${liveNew}` });
await sleep(900); await fetches();
check('C1 ref for live reply on loaded root rendered', await clickRef(liveNew)); await sleep(700);
s = await snap(); f = await fetches();
check('C2 loaded-root live reply: thread opens whole with ZERO fetches (cycle-0 shortcut intact)', s.threadOpen && JSON.stringify(s.threadNodes) === JSON.stringify([roots[127], liveNew]) && f.length === 0 && s.anchored.includes(`msg-${liveNew}`), JSON.stringify({ nodes: s.threadNodes, fetches: f, anchored: s.anchored }));

// ---- D. Same-conversation ref to a TOP-LEVEL root outside the page (root 10): pages back, anchored.
await nav(`${base}/?c=engineering`);
await post('/api/messages', { conversation: eng, author: other, body: `top-level ref msg ${roots[9]}` });
await sleep(900); await fetches();
check('D1 ref to deep top-level rendered', await clickRef(roots[9])); await sleep(1500);
s = await snap(); f = await fetches();
check('D2 deep top-level ref: paged in, anchored, no thread, URL m= only', s.count >= 130 && s.anchored.includes(`msg-${roots[9]}`) && !s.threadOpen && s.url.includes(`m=${roots[9]}`) && !s.url.includes('t='), JSON.stringify({ count: s.count, anchored: s.anchored, url: s.url, threadOpen: s.threadOpen }));
check('D3 network: resolve + 3 page fetches', f.filter((u) => u.includes('/api/messages?')).length === 3, JSON.stringify(f));

// ---- E. Cross-conversation ref to a reply whose root is deep in #announcements.
await nav(`${base}/?c=engineering`);
await post('/api/messages', { conversation: eng, author: other, body: `cross msg ${aDeepReply}` });
await sleep(900); await fetches();
check('E1 cross-conversation ref rendered', await clickRef(aDeepReply)); await sleep(1800);
s = await snap(); f = await fetches();
check('E2 cross-conversation deep reply: announcements open, thread whole, anchored', /announcements/.test(s.convTitle) && s.threadOpen && JSON.stringify(s.threadNodes) === JSON.stringify([aRoots[4], aDeepReply]) && s.anchored.includes(`msg-${aDeepReply}`) && s.url.includes('c=announcements') && s.url.includes(`t=${aRoots[4]}`), JSON.stringify({ title: s.convTitle, nodes: s.threadNodes, url: s.url, count: s.count }));

// ---- F. Orphan then scroll-up merge: the live reply must survive the page merge (server list includes it).
await nav(`${base}/?c=engineering`);
const live2 = (await post('/api/messages', { conversation: eng, author: other, body: 'LIVE reply #2 on root 3', threadRoot: deepRoot })).message.id;
await sleep(700);
for (let i = 0; i < 3; i++) { await evaluate(`document.querySelector('#messages').scrollTop = 0; true`); await sleep(900); }
s = await snap();
const label2 = await evaluate(`document.querySelector('#msg-${deepRoot} .thread-link')?.textContent ?? null`);
await evaluate(`document.querySelector('#msg-${deepRoot} .thread-link').click(); true`); await sleep(500);
s = await snap();
check('F1 orphan reply + scroll-up merge: root shows 3 replies and thread lists all of them', s.count >= 130 && label2 === '3 replies' && JSON.stringify(s.threadNodes) === JSON.stringify([deepRoot, earlier, live, live2]), JSON.stringify({ label: label2, nodes: s.threadNodes, count: s.count }));

// ---- G. ?c&t=<deep root> without m=: thread opens whole (restoreFromUrl path)
await nav(`${base}/?c=engineering&t=${deepRoot}`);
s = await snap();
check('G1 ?t= deep root: thread opens with root + 3 replies', s.threadOpen && s.threadNodes[0] === deepRoot && s.threadNodes.length === 4, JSON.stringify({ nodes: s.threadNodes, url: s.url }));
// ?c&m=<reply id> without t=: reply is not renderable in the main pane -> m stripped, conversation open (AS-9 behaviour), no crash
await nav(`${base}/?c=engineering&m=${earlier}`);
s = await snap();
check('G2 ?m=<reply> without t=: conversation open, m stripped like AS-9, no crash', s.count >= 50 && !s.threadOpen && !/m=/.test(s.url), JSON.stringify({ count: s.count, url: s.url }));

// ---- H. Watermark after the ref navigation: no unread residue for engineering
const unread = await get(`/api/unread?me=${me}`);
check('H1 no unread residue for engineering after navigations', !unread.unread.some((g) => g.conversationId === eng), JSON.stringify(unread.unread.map((g) => [g.conversationId, g.messages.length])));

console.log('\nSUMMARY', results.filter((r) => r.ok).length, 'pass /', results.length);
ws.close(); chrome.kill('SIGKILL'); await close(); rmSync(dir, { recursive: true, force: true }); process.exit(0);
