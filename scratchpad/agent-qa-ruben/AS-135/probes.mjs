// AS-135 review probes past the criteria list (qa-ruben). Imports the branch
// modules from the WORKTREE (read-only), drives inputs the tests do not:
// sticky-bottom slack edges, N-frame catch-up scrolled up, root+reply in one
// delta, reply out of order in the thread pane, foreign-conversation frame,
// orphan reply then its root paged in (R5) then a rebuild, thread close/reopen
// mid-frames, prepend racing a frame. Each probe prints PASS/FAIL + evidence.
import { applyMessage, mergeOlderPage } from '/Users/forrest/Code/american-software-company/.worktrees/AS-135/apps/chat/public/live.js';
import { prependPreservingScroll } from '/Users/forrest/Code/american-software-company/.worktrees/AS-135/apps/chat/public/scroll.js';
import {
  messageIdOf, replyLabel, insertMessageNode, setReplyCount, frameTargets, applyFrameToPanes,
} from '/Users/forrest/Code/american-software-company/.worktrees/AS-135/apps/chat/public/message-pane.js';

const ROW = 100;
function fakeEl(cls = null, text = '') {
  const classes = new Set(cls ? [cls] : []);
  const el = {
    id: '', children: [], textContent: text, scrollTop: 0, clientHeight: 500,
    get scrollHeight() { return el.children.length * ROW; },
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
    appendChild(n) { el.children.push(n); return n; },
    insertBefore(n, ref) { const i = el.children.indexOf(ref); if (i < 0) throw new Error('ref'); el.children.splice(i, 0, n); return n; },
    removeChild(n) { const i = el.children.indexOf(n); if (i < 0) throw new Error('rm'); el.children.splice(i, 1); return n; },
    replaceChildren(...nodes) { el.children = nodes; },
  };
  return el;
}
const linkFor = (rootId, count) => fakeEl('thread-link', replyLabel(count));
const nodeFor = (m, { inThread = false } = {}) => {
  const n = fakeEl('message'); n.id = `msg-${m.id}`;
  if (!inThread && m.replyCount > 0) n.appendChild(linkFor(m.id, m.replyCount));
  return n;
};
const msg = (id, threadRootId = null, extra = {}) => ({ id, conversationId: 7, threadRootId, authorId: 'agent:x', body: `m${id}`, createdAt: 't', ...extra });
const payload = (ids, { threads = {}, hasMore = false } = {}) => ({
  conversation: { id: 7, type: 'channel', name: 'eng' },
  messages: ids.map((id) => msg(id, null, { replyCount: (threads[id] || []).length })), threads, hasMore, nextBefore: ids.length ? Math.min(...ids) : null,
});
const ids = (p) => p.children.map(messageIdOf);
const labelOf = (n) => { const l = n.children.find((c) => c.classList.contains('thread-link')); return l ? l.textContent : null; };
const labels = (p) => p.children.filter((c) => messageIdOf(c) != null).map((c) => [messageIdOf(c), labelOf(c)]);
function freshMain(data) {
  const p = fakeEl(); if (data.hasMore) p.appendChild(fakeEl('load-earlier', 'Load earlier'));
  if (data.messages.length) for (const m of data.messages) p.appendChild(nodeFor(m)); else p.appendChild(fakeEl('empty-note', 'No messages yet.'));
  return p;
}
function freshThread(data, rootId) {
  const p = fakeEl(); const root = data.messages.find((m) => m.id === rootId);
  if (root) p.appendChild(nodeFor(root, { inThread: true }));
  for (const m of data.threads[rootId] || []) p.appendChild(nodeFor(m, { inThread: true }));
  return p;
}
function ctxOf(data, currentThreadRoot = null) {
  const ctx = { data, currentThreadRoot, main: freshMain(data), thread: fakeEl() };
  if (currentThreadRoot != null) ctx.thread = freshThread(data, currentThreadRoot);
  return ctx;
}
// app.js handleFrame semantics: only a merged message reaches applyFrameToPanes.
function frame(ctx, m) {
  if (!applyMessage(ctx.data, m)) return { merged: false };
  return { merged: true, ...applyFrameToPanes({ data: ctx.data, msg: m, currentThreadRoot: ctx.currentThreadRoot, mainPane: ctx.main, threadPane: ctx.thread, nodeFor, linkFor }) };
}
let n = 0, failed = 0;
function probe(name, fn) {
  n++;
  try { const ev = fn(); console.log(`PASS P${n} ${name}${ev ? ` — ${ev}` : ''}`); }
  catch (e) { failed++; console.log(`FAIL P${n} ${name} — ${e.message}`); }
}
const eq = (a, b, what) => { const ja = JSON.stringify(a), jb = JSON.stringify(b); if (ja !== jb) throw new Error(`${what}: got ${ja}, want ${jb}`); };

probe('sticky slack edge: 39px from bottom counts as at-bottom (follows); 40px does not (stays)', () => {
  const a = ctxOf(payload([1,2,3,4,5,6,7,8,9,10])); a.main.scrollTop = 461; frame(a, msg(11)); eq(a.main.scrollTop, 1100, '39px follows');
  const b = ctxOf(payload([1,2,3,4,5,6,7,8,9,10])); b.main.scrollTop = 460; frame(b, msg(11)); eq(b.main.scrollTop, 460, '40px stays');
  return 'scrollTop 461→1100, 460→460';
});
probe('catch-up of 5 frames with the reader scrolled up: scrollTop unchanged after every insert; at-bottom follows all 5', () => {
  const up = ctxOf(payload([1,2,3,4,5,6,7,8,9,10])); up.main.scrollTop = 300;
  for (const id of [11,12,13,14,15]) { frame(up, msg(id)); eq(up.main.scrollTop, 300, `after ${id}`); }
  eq(up.main.scrollHeight, 1500, 'grew 5 rows');
  const dn = ctxOf(payload([1,2,3,4,5,6,7,8,9,10])); dn.main.scrollTop = 500;
  for (const id of [11,12,13,14,15]) frame(dn, msg(id));
  eq(dn.main.scrollTop, 1500, 'at bottom after 5');
});
probe('catch-up delta carrying a root AND its reply in id order: root inserted without link, then link appended "1 reply"; equals fresh render', () => {
  const c = ctxOf(payload([10])); frame(c, msg(20)); frame(c, msg(21, 20));
  eq(labels(c.main), labels(freshMain(c.data)), 'labels'); eq(labels(c.main), [[10, null], [20, '1 reply']], 'literal');
});
probe('thread pane: out-of-order reply (101, 103 loaded; 102 arrives) lands in id order', () => {
  const c = ctxOf(payload([100], { threads: { 100: [msg(101, 100), msg(103, 100)] } }), 100);
  frame(c, msg(102, 100)); eq(ids(c.thread), [100, 101, 102, 103], 'thread ids'); eq(labelOf(c.main.children[0]), '3 replies', 'root count');
});
probe('foreign-conversation frame: applyMessage refuses, so nothing reaches the panes (app.js contract)', () => {
  const c = ctxOf(payload([10])); const r = frame(c, { ...msg(11), conversationId: 8 });
  eq(r.merged, false, 'merged'); eq(ids(c.main), [10], 'main untouched');
});
probe('module boundary: applyFrameToPanes does NOT check conversation itself (documented: caller contract, after applyMessage)', () => {
  const c = ctxOf(payload([10]));
  const t = applyFrameToPanes({ data: c.data, msg: { ...msg(11), conversationId: 8 }, currentThreadRoot: null, mainPane: c.main, threadPane: c.thread, nodeFor, linkFor });
  return `insertMain=${t.insertMain}, main ids now ${JSON.stringify(ids(c.main))} — the guard lives in applyMessage's return value, not here`;
});
probe('orphan reply: no DOM change; then its root pages in (R5 union) and the prepend rebuild shows the merged count', () => {
  const c = ctxOf(payload([30], { hasMore: true })); c.main.scrollTop = 0;
  const r = frame(c, msg(27, 20)); eq(r.merged, true, 'merged as orphan'); eq(r.patchRoot, null, 'no patch'); eq(ids(c.main), [null, 30], 'main untouched');
  const older = { messages: [msg(10, null, { replyCount: 0 }), msg(20, null, { replyCount: 2 })], threads: { 10: [], 20: [msg(21, 20), msg(22, 20)] }, hasMore: false, nextBefore: null };
  eq(mergeOlderPage(c.data, older), 2, 'added');
  const before = c.main.scrollHeight; prependPreservingScroll(c.main, () => c.main.replaceChildren(...freshMain(c.data).children));
  eq(labels(c.main), [[10, null], [20, '3 replies'], [30, null]], 'rebuilt labels'); eq(c.main.scrollTop, c.main.scrollHeight - before, 'row held');
  frame(c, msg(28, 20)); eq(labelOf(c.main.children[1]), '4 replies', 'live continues on merged list');
});
probe('R5 edge: orphans present, page carries NO threads entry for the root → merged = orphans, replyCount = orphans.length', () => {
  const d = payload([30], { hasMore: true }); applyMessage(d, msg(25, 20));
  mergeOlderPage(d, { messages: [msg(20, null, { replyCount: 0 })], threads: {}, hasMore: false, nextBefore: null });
  eq(d.threads[20].map((m) => m.id), [25], 'list'); eq(d.messages.find((m) => m.id === 20).replyCount, 1, 'count');
});
probe('R5 edge: orphans all overlap the page list → count = page count, no double', () => {
  const d = payload([30], { hasMore: true }); applyMessage(d, msg(21, 20));
  mergeOlderPage(d, { messages: [msg(20, null, { replyCount: 1 })], threads: { 20: [msg(21, 20)] }, hasMore: false, nextBefore: null });
  eq(d.threads[20].length, 1, 'len'); eq(d.messages.find((m) => m.id === 20).replyCount, 1, 'count');
});
probe('thread close then reopen mid-frames: replies while closed patch only; reopen (fresh render) shows them; frames after reopen insert', () => {
  const c = ctxOf(payload([10]), 10); frame(c, msg(11, 10)); eq(ids(c.thread), [10, 11], 'open insert');
  c.currentThreadRoot = null; // closeThread
  const r = frame(c, msg(12, 10)); eq(r.insertThread, false, 'closed: no thread insert'); eq(labelOf(c.main.children[0]), '2 replies', 'closed: patched');
  c.currentThreadRoot = 10; c.thread = freshThread(c.data, 10); eq(ids(c.thread), [10, 11, 12], 'reopen rebuild');
  frame(c, msg(13, 10)); eq(ids(c.thread), [10, 11, 12, 13], 'after reopen');
});
probe('switch open thread from root 10 to root 20 (renderThread rebuild): a reply on 10 no longer enters the pane, a reply on 20 does', () => {
  const c = ctxOf(payload([10, 20]), 10); c.currentThreadRoot = 20; c.thread = freshThread(c.data, 20);
  frame(c, msg(21, 10)); eq(ids(c.thread), [20], 'reply on 10 stays out'); frame(c, msg(22, 20)); eq(ids(c.thread), [20, 22], 'reply on 20 in');
  eq(labels(c.main), [[10, '1 reply'], [20, '1 reply']], 'both roots patched');
});
probe('prepend racing a frame: frame lands between page fetch and merge; rebuild from data holds the reader row and keeps the frame row', () => {
  // 10 loaded rows (1000 tall > 500 viewport) so the reader at the top is genuinely scrolled up.
  const loaded = [30, 31, 32, 33, 34, 35, 36, 37, 38, 39];
  const c = ctxOf(payload(loaded, { hasMore: true })); c.main.scrollTop = 0;
  const page = { messages: [msg(10, null, { replyCount: 0 }), msg(20, null, { replyCount: 0 })], threads: { 10: [], 20: [] }, hasMore: false, nextBefore: null };
  frame(c, msg(40)); eq(ids(c.main), [null, ...loaded, 40], 'frame in'); eq(c.main.scrollTop, 0, 'scrolled-up reader not moved by the frame');
  mergeOlderPage(c.data, page); eq(c.data.messages.map((m) => m.id), [10, 20, ...loaded, 40], 'data ordered');
  const before = c.main.scrollHeight; prependPreservingScroll(c.main, () => c.main.replaceChildren(...freshMain(c.data).children));
  eq(ids(c.main), [10, 20, ...loaded, 40], 'rebuild'); eq(c.main.scrollTop, c.main.scrollHeight - before, 'row held by exactly the prepended height');
  eq(c.main.scrollTop, 100, '2 rows in, button out = +100');
});
probe('send echo racing the SSE frame (either order): exactly one node, one count bump', () => {
  const a = ctxOf(payload([10])); const post = msg(11, 10); frame(a, post); frame(a, { ...post }); eq(labelOf(a.main.children[0]), '1 reply', 'POST then SSE');
  const b = ctxOf(payload([10])); frame(b, { ...post }); frame(b, post); eq(labelOf(b.main.children[0]), '1 reply', 'SSE then POST');
  const c = ctxOf(payload([10])); frame(c, msg(11)); frame(c, msg(11)); eq(ids(c.main), [10, 11], 'top-level twice');
});
probe('DOM-level belt: a node already in the pane but NOT in data (data/DOM drift) is still refused', () => {
  const c = ctxOf(payload([10])); c.main.appendChild(nodeFor(msg(11)));
  const r = frame(c, msg(11)); eq(r.merged, true, 'data merged'); eq(ids(c.main), [10, 11], 'no duplicate row');
});
probe('empty conversation with a reply frame first (root unloaded, pane shows empty-note): note stays, nothing inserted', () => {
  const c = ctxOf(payload([])); const r = frame(c, msg(5, 4)); eq(r.merged, true, 'orphan merged'); eq(c.main.children.length, 1, 'note kept');
  eq(c.main.children[0].classList.contains('empty-note'), true, 'is the note');
});
probe('anchored REPLY node in the thread pane survives a top-level frame and a reply frame on another root', () => {
  const c = ctxOf(payload([1, 2], { threads: { 1: [msg(3, 1)] } }), 1); const reply = c.thread.children[1]; reply.classList.add('anchored');
  frame(c, msg(4)); frame(c, msg(5, 2)); eq(c.thread.children[1] === reply, true, 'identity'); eq(ids(c.thread), [1, 3], 'thread untouched');
});
probe('setReplyCount count 0 on a root with a link (should never happen — replyCount never decreases): label becomes "0 replies"', () => {
  const p = fakeEl(); p.appendChild(nodeFor(msg(1, null, { replyCount: 2 })));
  setReplyCount(p, 1, 0, linkFor); return `label now "${labelOf(p.children[0])}" — unreachable from applyMessage, noted only`;
});
probe('frameTargets on a top-level frame while a thread is open: main only; the thread pane is not touched', () => {
  const c = ctxOf(payload([1], { threads: { 1: [msg(2, 1)] } }), 1); const t = frame(c, msg(3));
  eq([t.insertMain, t.patchRoot, t.insertThread], [true, null, false], 'targets'); eq(ids(c.thread), [1, 2], 'thread');
});
probe('a frame whose id is below the load-earlier button boundary but above nothing (pane = [btn] only, hasMore with 0 rows — degenerate)', () => {
  const p = fakeEl(); p.appendChild(fakeEl('load-earlier')); insertMessageNode(p, nodeFor(msg(5))); eq(ids(p), [null, 5], 'after btn');
});
probe('messageIdOf edge ids: "msg-0" → 0 (a truthy check would drop it), "msg-1e3" → 1000 (Number() exponent form; unreachable, ids come from messageNode), "msg-12.5" → null, "msg--1" → -1', () => {
  eq([messageIdOf({ id: 'msg-0' }), messageIdOf({ id: 'msg-1e3' }), messageIdOf({ id: 'msg-12.5' }), messageIdOf({ id: 'msg--1' })], [0, 1000, null, -1], 'ids');
  const p = fakeEl(); p.appendChild(nodeFor(msg(0))); eq(insertMessageNode(p, nodeFor(msg(0))), false, 'id 0 dedupes (== null check, not falsy)');
});
console.log(`\nprobes: ${n} run, ${n - failed} pass, ${failed} fail`);
process.exit(failed ? 1 : 0);
