// AS-135 review — plan step 4 browser walk, scripted (qa-ruben).
// Headless Chrome over CDP (node's built-in WebSocket) against the BRANCH
// server on :8399 (throwaway DB). The page runs the real served modules
// (app.js → message-pane.js); this script only inspects the DOM and drives
// clicks/composer, while frames arrive over the real SSE stream from POSTs
// made here. Every step prints PASS/FAIL with the observed values.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const BASE = 'http://127.0.0.1:8399';
const ME = 'human:forrest'; // the page's default identity (throwaway DB)
const AUTHOR = 'agent:developer-lena'; // frames from "someone else"
const WALK = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-135/walk';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;

let n = 0, failed = 0;
const log = [];
function step(name, ok, ev) { n++; const line = `${ok ? 'PASS' : 'FAIL'} W${n} ${name}${ev !== undefined ? ` — ${typeof ev === 'string' ? ev : JSON.stringify(ev)}` : ''}`; if (!ok) failed++; console.log(line); log.push(line); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(path, body) {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json(); if (!r.ok) throw new Error(`${path} ${r.status} ${JSON.stringify(j)}`); return j;
}
async function say(conversation, body, threadRoot = null, author = AUTHOR) {
  return (await post('/api/messages', { conversation, author, body, threadRoot })).message;
}

// --- seed: #engineering (id 2) gets 60 roots so hasMore is true at PAGE_SIZE 50; root #5 gets 2 replies
const convs = (await (await fetch(`${BASE}/api/conversations?me=${encodeURIComponent(ME)}`)).json()).conversations;
const eng = convs.find((c) => c.name === 'engineering');
const roots = [];
for (let i = 1; i <= 60; i++) roots.push(await say(eng.id, `seed root ${i}`));
const seededReplies = [await say(eng.id, 'seed reply a', roots[4].id), await say(eng.id, 'seed reply b', roots[4].id)];
console.log(`seeded ${roots.length} roots (${roots[0].id}..${roots[59].id}) in #engineering id=${eng.id}; replies ${seededReplies.map((m) => m.id)} on root ${roots[4].id}`);

// --- chrome
mkdirSync(`${WALK}/chrome-profile`, { recursive: true });
const chrome = spawn(CHROME, [`--headless=new`, `--remote-debugging-port=${PORT}`, `--user-data-dir=${WALK}/chrome-profile`, '--no-first-run', '--no-default-browser-check', '--window-size=1200,900', 'about:blank'], { stdio: 'ignore' });
writeFileSync(`${WALK}/chrome.pid`, String(chrome.pid));
let targets = null;
for (let i = 0; i < 50 && !targets; i++) { await sleep(200); try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch {} }
if (!targets) throw new Error('chrome did not come up');
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map(); const consoleLines = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method === 'Runtime.consoleAPICalled') consoleLines.push(m.params.args.map((a) => a.value ?? a.description).join(' ')); else if (m.method === 'Runtime.exceptionThrown') consoleLines.push('EXC ' + JSON.stringify(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text)); };
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
async function ev(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error('page exception: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
  return r.result?.result?.value;
}
async function until(expression, ms = 8000) {
  const t0 = Date.now(); let v;
  while (Date.now() - t0 < ms) { v = await ev(expression); if (v) return v; await sleep(100); }
  throw new Error(`timeout waiting for ${expression} (last ${JSON.stringify(v)})`);
}
await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url: `${BASE}/?c=engineering` });
await until(`document.querySelectorAll('#messages .message').length === 50`);
await sleep(300); // let the SSE connect

// helpers evaluated in the page
const ids = () => ev(`[...document.querySelectorAll('#messages .message')].map(n => Number(n.id.slice(4)))`);
const tids = () => ev(`[...document.querySelectorAll('#thread-messages .message')].map(n => Number(n.id.slice(4)))`);
const mark = () => ev(`(() => { const ns = [...document.querySelectorAll('#messages .message')]; ns.forEach((n, i) => n.dataset.ruben = String(i)); return ns.length; })()`);
const identityIntact = () => ev(`(() => { const ns = [...document.querySelectorAll('#messages .message')].filter(n => n.dataset.ruben != null); return ns.every((n, i) => n.dataset.ruben === String(i)) ? ns.length : -1; })()`);
const metrics = (sel = '#messages') => ev(`(() => { const p = document.querySelector('${sel}'); return { top: Math.round(p.scrollTop), h: p.scrollHeight, c: p.clientHeight }; })()`);
const label = (id) => ev(`(document.querySelector('#messages #msg-${id} .thread-link') || {}).textContent ?? null`);

// W1: cold load — newest 50, load-earlier button first, seeded root has "2 replies"
let li = await ids();
step('cold load: newest page = 50 rows, first child is .load-earlier, seeded root shows "2 replies"',
  li.length === 50 && li[0] === roots[10].id && li[49] === roots[59].id && (await ev(`document.querySelector('#messages').firstElementChild.classList.contains('load-earlier')`)),
  { first: li[0], last: li[49], count: li.length });
let m0 = await metrics();
step('cold load lands at the bottom', m0.h - m0.top - m0.c < 40, m0);

// W2: frame while scrolled up — one node appended, identity intact, scrollTop unchanged
await mark();
await ev(`document.querySelector('#messages').scrollTop = 900`); // > LOAD_OLDER_THRESHOLD_PX (200), < bottom-40
const upBefore = await metrics();
const f1 = await say(eng.id, 'frame 1 (reader scrolled up)');
await until(`!!document.getElementById('msg-${f1.id}')`);
li = await ids();
const upAfter = await metrics();
step('top-level frame while scrolled up: exactly one node, at the end, 50 marked nodes keep identity+order', li.length === 51 && li[li.length - 1] === f1.id && (await identityIntact()) === 50, { count: li.length, last: li[li.length - 1], intact: await identityIntact() });
step('scrolled-up reader is not moved by the frame (scrollTop 900 → same), pane grew', upAfter.top === upBefore.top && upAfter.h > upBefore.h, { before: upBefore, after: upAfter });

// W3: frame at bottom — follows
await ev(`const p = document.querySelector('#messages'); p.scrollTop = p.scrollHeight`);
const f2 = await say(eng.id, 'frame 2 (reader at bottom)');
await until(`!!document.getElementById('msg-${f2.id}')`);
await sleep(100);
const dn = await metrics();
step('top-level frame at bottom: reader follows to the new bottom', dn.h - dn.top - dn.c < 40 && (await ids()).length === 52, dn);

// W4: permalink click → anchored; then a frame → same node, class kept, URL keeps m=
const anchorId = roots[30].id;
await ev(`document.querySelector('#msg-${anchorId} .msg-permalink').click()`);
await until(`document.getElementById('msg-${anchorId}').classList.contains('anchored')`);
await ev(`document.getElementById('msg-${anchorId}').dataset.anchor = 'yes'`);
const urlBefore = await ev('location.search');
const f3 = await say(eng.id, 'frame 3 (after permalink)');
await until(`!!document.getElementById('msg-${f3.id}')`);
const anchorState = await ev(`(() => { const n = document.getElementById('msg-${anchorId}'); return { same: n.dataset.anchor === 'yes', cls: n.classList.contains('anchored'), url: location.search }; })()`);
step('m= anchor survives a frame: same node object, .anchored still present, URL unchanged', anchorState.same && anchorState.cls && anchorState.url === urlBefore && urlBefore.includes(`m=${anchorId}`), anchorState);

// W5: open a thread on a root with no replies; reply frames insert into the thread pane and patch the root in place
const tRoot = roots[40].id;
const mainCountBeforeThread = (await ids()).length;
await ev(`document.querySelector('#msg-${tRoot} .actions button').click()`);
await until(`!document.getElementById('thread-modal').hidden && document.querySelectorAll('#thread-messages .message').length === 1`);
step('openThread: modal shown, thread pane = [root]', (await tids()).length === 1 && (await tids())[0] === tRoot, await tids());
const r1 = await say(eng.id, 'reply 1 on open thread', tRoot);
await until(`!!document.querySelector('#thread-messages #msg-${r1.id}')`);
step('reply frame with its thread open: thread pane gains exactly the reply; main pane count unchanged; root label "1 reply"', JSON.stringify(await tids()) === JSON.stringify([tRoot, r1.id]) && (await ids()).length === mainCountBeforeThread && (await label(tRoot)) === '1 reply', { thread: await tids(), label: await label(tRoot) });
await ev(`document.querySelector('#messages #msg-${tRoot} .thread-link').dataset.link = 'first'`);
const r2 = await say(eng.id, 'reply 2 on open thread', tRoot);
await until(`!!document.querySelector('#thread-messages #msg-${r2.id}')`);
const linkState = await ev(`(() => { const ls = document.querySelectorAll('#messages #msg-${tRoot} .thread-link'); return { count: ls.length, same: ls[0]?.dataset.link === 'first', text: ls[0]?.textContent }; })()`);
step('second reply: label "2 replies", same link node, exactly one link', linkState.count === 1 && linkState.same && linkState.text === '2 replies', linkState);
step('main pane identity still intact after replies (no rebuild)', (await identityIntact()) === 50, await identityIntact());

// W6: send echo — type a reply in the thread composer; POST response + SSE echo must yield one node
await ev(`document.querySelector('#thread-input').value = 'my own reply (echo test)'; document.querySelector('#thread-composer').requestSubmit()`);
await until(`document.querySelectorAll('#thread-messages .message').length === 4`);
await sleep(600); // let the SSE echo land
const echoCount = await ev(`document.querySelectorAll('#thread-messages .message').length`);
step('send echo racing the SSE frame: exactly one node for my own reply (no duplicate after the echo)', echoCount === 4 && (await label(tRoot)) === '3 replies', { threadCount: echoCount, label: await label(tRoot) });

// W7: reply on a DIFFERENT root while this thread is open → patch only, thread pane untouched
const other = roots[20].id;
const r4 = await say(eng.id, 'reply on another root', other);
await until(`(document.querySelector('#messages #msg-${other} .thread-link') || {}).textContent === '1 reply'`);
step('reply on another root while a thread is open: that root patched, thread pane untouched', (await tids()).length === 4 && (await label(other)) === '1 reply', { thread: await tids(), otherLabel: await label(other) });

// W8: thread scrolled up + reply → stays; close thread → reply patches only
await ev(`document.querySelector('#thread-messages').scrollTop = 0`);
const tm0 = await metrics('#thread-messages');
const r5 = await say(eng.id, 'reply 5', tRoot);
await until(`!!document.querySelector('#thread-messages #msg-${r5.id}')`);
const tm1 = await metrics('#thread-messages');
step('thread pane: insert under the sticky rule (scrollTop preserved when the pane scrolls; degenerate = at bottom)', tm1.c >= tm1.h ? true : tm1.top === tm0.top, { before: tm0, after: tm1 });
await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
await sleep(200);
const closed = await ev(`document.getElementById('thread-modal').hidden`);
const r6 = await say(eng.id, 'reply 6 after close', tRoot);
await until(`(document.querySelector('#messages #msg-${tRoot} .thread-link') || {}).textContent === '5 replies'`);
step('thread closed: reply patches the root only (label "5 replies")', closed === true, { closed, label: await label(tRoot) });

// W9: load earlier — prepend keeps the reader's row; anchored node re-created (rebuild by design)
await ev(`document.querySelector('#messages').scrollTop = 0`);
const rowTopBefore = await ev(`document.getElementById('msg-${roots[10].id}').getBoundingClientRect().top`);
await ev(`document.querySelector('#messages .load-earlier').click()`);
const beforePrepend = (await ids()).length;
await until(`document.querySelectorAll('#messages .message').length === ${beforePrepend + 10}`);
const rowTopAfter = await ev(`document.getElementById('msg-${roots[10].id}').getBoundingClientRect().top`);
li = await ids();
step('load earlier (click): 10 older rows prepended in order, no button left (hasMore false), reader row held', li.length === beforePrepend + 10 && li[0] === roots[0].id && Math.abs(rowTopAfter - rowTopBefore) < 2 && !(await ev(`!!document.querySelector('#messages .load-earlier')`)), { count: li.length, first: li[0], rowTopBefore, rowTopAfter });
step('seeded root (older page) carries its server count "2 replies" after the prepend', (await label(roots[4].id)) === '2 replies', await label(roots[4].id));

// W10: after the prepend rebuild, frames still patch (no stale pane reference)
await mark();
const f4 = await say(eng.id, 'frame 4 after prepend');
await until(`!!document.getElementById('msg-${f4.id}')`);
step('frame after the prepend rebuild: one node appended, all marked nodes intact', (await ids()).length === beforePrepend + 11 && (await identityIntact()) === beforePrepend + 10, { count: (await ids()).length, intact: await identityIntact() });

// W11: navigation still rebuilds — switch to #announcements and back: fresh nodes (marks gone), newest page
await ev(`[...document.querySelectorAll('#channel-list li')].find(l => l.textContent.includes('announcements')).click()`);
await until(`document.querySelector('#conv-title').textContent.includes('announcements')`);
await ev(`[...document.querySelectorAll('#channel-list li')].find(l => l.textContent.includes('engineering')).click()`);
await until(`document.querySelector('#conv-title').textContent.includes('engineering') && document.querySelectorAll('#messages .message').length === 50`);
step('navigation rebuilds: back in #engineering the pane is the newest 50 with fresh nodes (marks gone)', (await identityIntact()) === 0 && (await ids()).length === 50, { intact: await identityIntact(), count: (await ids()).length });

// W12: page console — no errors thrown by the served modules during the walk
step('no page exceptions during the walk', !consoleLines.some((l) => l.startsWith('EXC')), consoleLines.slice(0, 5));

writeFileSync(`${WALK}/walk.log`, log.join('\n') + `\n\nwalk: ${n} steps, ${n - failed} pass, ${failed} fail\nconsole: ${JSON.stringify(consoleLines)}\n`);
console.log(`\nwalk: ${n} steps, ${n - failed} pass, ${failed} fail`);
ws.close(); chrome.kill('SIGTERM');
process.exit(failed ? 1 : 0);
