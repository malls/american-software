// AS-131 review probe (qa-priya): orphan-thread path. With the newest page open,
// a LIVE reply lands on a root outside the page (applyMessage stores it under
// threads[root] with no root loaded). Then a msg-ref to that reply is clicked:
// goToMessage step 1 finds it "loaded" and opens the thread WITHOUT paging the
// root in. Compare with master's behaviour (all roots loaded -> root present).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-131/apps/chat';
const FIXTURE_ROOT = `${WT}/test/fixtures/repo`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const { createChatServer } = await import(`${WT}/server.js`);
const dir = mkdtempSync(join(tmpdir(), 'chat-orphan-'));
const { server, close } = createChatServer({ dbPath: join(dir, 'chat.db'), repoRoot: FIXTURE_ROOT, dataDir: join(dir, 'loop-data') });
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;
const get = async (p) => (await fetch(base + p)).json();
const post = async (p, body) => (await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
const me = 'human:forrest', other = 'agent:cto-owen';
const eng = (await get(`/api/conversations?me=${me}`)).conversations.find((c) => c.name === 'engineering').id;
const roots = [];
for (let i = 1; i <= 60; i++) roots.push((await post('/api/messages', { conversation: eng, author: other, body: `root ${i}` })).message.id);
const oldRoot = roots[2];
const earlier = (await post('/api/messages', { conversation: eng, author: other, body: 'earlier reply on root 3', threadRoot: oldRoot })).message.id;

const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${join(dir, 'prof')}`, 'about:blank'], { stdio: 'ignore' });
let targets; for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((ok) => (ws.onopen = ok));
let seq = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const cdp = (method, params = {}) => new Promise((ok) => { const id = ++seq; pending.set(id, ok); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expr) => { const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await cdp('Page.enable'); await cdp('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
await cdp('Page.navigate', { url: `${base}/?c=engineering` }); await sleep(1200);
console.log('loaded rows', await evaluate(`document.querySelectorAll('#messages .message').length`), '(root 3 =', oldRoot, 'is outside the page)');

// Live reply to the unloaded root, then a top-level message referencing it.
const live = (await post('/api/messages', { conversation: eng, author: other, body: 'LIVE reply on root 3', threadRoot: oldRoot })).message.id;
await post('/api/messages', { conversation: eng, author: other, body: `see msg ${live}` });
await sleep(900);
console.log('msg-ref links:', await evaluate(`[...document.querySelectorAll('#messages a.msg-ref')].map(a => a.textContent)`));
await evaluate(`[...document.querySelectorAll('#messages a.msg-ref')].find(a => a.textContent.includes('${live}')).click(); true`);
await sleep(1200);
const r = await evaluate(`(() => ({ threadOpen: !document.querySelector('#thread-modal').hidden, title: document.querySelector('#thread-title').textContent,
  threadNodes: [...document.querySelectorAll('#thread-messages .message')].map(n => n.id + ':' + n.querySelector('.body, .text, div:last-child')?.textContent?.slice(0,40)),
  url: location.search, mainRows: document.querySelectorAll('#messages .message').length, rootInMain: !!document.querySelector('#msg-${oldRoot}') }))()`);
console.log('AFTER msg-ref click ->', JSON.stringify(r, null, 1));
console.log('expected on master: thread modal shows root', oldRoot, '+ replies', [earlier, live], '(3 nodes). Root present?', r.threadNodes.some((n) => n.startsWith(`msg-${oldRoot}:`)), '| earlier reply present?', r.threadNodes.some((n) => n.startsWith(`msg-${earlier}:`)));

// Same scenario via the thread's own "reply" permalink path is not reachable (no root row). Also probe: open the
// thread link on the referencing message -> fine. Now the reload path: ?t=<oldRoot>&m=<live> pages in correctly?
await cdp('Page.navigate', { url: `${base}/?c=engineering&t=${oldRoot}&m=${live}` }); await sleep(1500);
const r2 = await evaluate(`(() => ({ threadOpen: !document.querySelector('#thread-modal').hidden, n: document.querySelectorAll('#thread-messages .message').length, url: location.search }))()`);
console.log('permalink reload path ->', JSON.stringify(r2));
ws.close(); chrome.kill('SIGKILL'); await close(); rmSync(dir, { recursive: true, force: true }); process.exit(0);
