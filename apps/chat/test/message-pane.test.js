// Unit tests for the incremental message-pane module (AS-135). No server, no
// DOM — the same file the browser imports is imported here directly, with a
// plain-object fake element standing in for pane and message nodes (the
// module touches only id / classList / children / insertBefore / appendChild /
// removeChild / textContent and the three scroll metrics). One test per
// acceptance criterion T1–T10; T10 pins app.js's wiring by source scan.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyMessage } from '../public/live.js';
import {
  messageIdOf,
  replyLabel,
  insertMessageNode,
  setReplyCount,
  frameTargets,
  applyFrameToPanes,
} from '../public/message-pane.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

// --- fake element -------------------------------------------------------------
// Each child is ROW px tall; scrollHeight grows with the child count so a
// sticky-bottom assertion is meaningful (T8).
const ROW = 100;

function fakeEl(cls = null, text = '') {
  const classes = new Set(cls ? [cls] : []);
  const el = {
    id: '',
    children: [],
    textContent: text,
    scrollTop: 0,
    clientHeight: 500,
    get scrollHeight() {
      return el.children.length * ROW;
    },
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    },
    appendChild(node) {
      el.children.push(node);
      return node;
    },
    insertBefore(node, ref) {
      const i = el.children.indexOf(ref);
      if (i < 0) throw new Error('insertBefore: ref not a child');
      el.children.splice(i, 0, node);
      return node;
    },
    removeChild(node) {
      const i = el.children.indexOf(node);
      if (i < 0) throw new Error('removeChild: not a child');
      el.children.splice(i, 1);
      return node;
    },
    replaceChildren(...nodes) {
      el.children = nodes;
    },
  };
  return el;
}

// Factories app.js would supply (same shape as messageNode / threadLinkNode).
const linkFor = (rootId, count) => fakeEl('thread-link', replyLabel(count));
const nodeFor = (m, { inThread = false } = {}) => {
  const n = fakeEl('message');
  n.id = `msg-${m.id}`;
  if (!inThread && m.replyCount > 0) n.appendChild(linkFor(m.id, m.replyCount));
  return n;
};
const loadEarlier = () => fakeEl('load-earlier', 'Load earlier messages');
const emptyNote = () => fakeEl('empty-note', 'No messages yet.');

const msg = (id, threadRootId = null, extra = {}) => ({
  id,
  conversationId: 7,
  threadRootId,
  authorId: 'agent:x',
  body: `m${id}`,
  createdAt: '2026-09-12T00:00:00Z',
  ...extra,
});
const payload = (rootIds, { threads = {}, hasMore = false } = {}) => ({
  conversation: { id: 7, type: 'channel', name: 'eng', visibility: 'public' },
  messages: rootIds.map((id) => msg(id, null, { replyCount: (threads[id] || []).length })),
  threads,
  hasMore,
  nextBefore: rootIds.length ? Math.min(...rootIds) : null,
});

const ids = (pane) => pane.children.map((c) => messageIdOf(c));
const labelOf = (node) => {
  const link = node.children.find((c) => c.classList.contains('thread-link'));
  return link ? link.textContent : null;
};
const labels = (pane) => pane.children.filter((c) => messageIdOf(c) != null).map((c) => [messageIdOf(c), labelOf(c)]);

/** A fresh render of `data` the way app.js's navigation path builds the panes. */
function freshMain(data) {
  const pane = fakeEl();
  if (data.hasMore) pane.appendChild(loadEarlier());
  if (data.messages.length) for (const m of data.messages) pane.appendChild(nodeFor(m));
  else pane.appendChild(emptyNote());
  return pane;
}
function freshThread(data, rootId) {
  const pane = fakeEl();
  const root = data.messages.find((m) => m.id === rootId);
  if (root) pane.appendChild(nodeFor(root, { inThread: true }));
  for (const m of data.threads[rootId] || []) pane.appendChild(nodeFor(m, { inThread: true }));
  return pane;
}

/** Wire-up mirroring app.js's renderFrame: merge, then patch the panes. */
function frame(ctx, m) {
  applyMessage(ctx.data, m);
  return applyFrameToPanes({
    data: ctx.data,
    msg: m,
    currentThreadRoot: ctx.currentThreadRoot,
    mainPane: ctx.main,
    threadPane: ctx.thread,
    nodeFor,
    linkFor,
  });
}
function openThread(ctx, rootId) {
  ctx.currentThreadRoot = rootId;
  ctx.thread = freshThread(ctx.data, rootId);
}
function context(data, { currentThreadRoot = null } = {}) {
  const ctx = { data, currentThreadRoot, main: freshMain(data), thread: fakeEl() };
  if (currentThreadRoot != null) openThread(ctx, currentThreadRoot);
  return ctx;
}

// --- T1: one node, at the end, identity preserved (criterion 1) -----------------

test('T1 AS-135: a top-level frame adds exactly one main-pane child, at the end, and every existing child keeps its identity', () => {
  const ctx = context(payload([10, 20, 30], { hasMore: true }));
  const before = [...ctx.main.children];
  assert.equal(before.length, 4, 'btn + 3 rows');
  frame(ctx, msg(40));
  assert.equal(ctx.main.children.length, before.length + 1, 'exactly one child added');
  assert.deepEqual(ids(ctx.main), [null, 10, 20, 30, 40]);
  for (let i = 0; i < before.length; i++) {
    assert.equal(ctx.main.children[i], before[i], `child ${i} is the same node object`);
  }
  assert.equal(messageIdOf(ctx.main.children[4]), 40, 'the new node is last');
  assert.equal(messageIdOf(loadEarlier()), null);
  assert.equal(messageIdOf({ id: 'msg-x' }), null);
  assert.equal(messageIdOf(null), null);
});

// --- T2: id order, including below every loaded row (criterion 2) ---------------

test('T2 AS-135: an out-of-order id lands in id order; an id below every loaded row lands after the load-earlier button', () => {
  const pane = fakeEl();
  pane.appendChild(loadEarlier());
  pane.appendChild(nodeFor(msg(10)));
  pane.appendChild(nodeFor(msg(30)));
  assert.equal(insertMessageNode(pane, nodeFor(msg(20))), true);
  assert.deepEqual(ids(pane), [null, 10, 20, 30]);
  assert.equal(insertMessageNode(pane, nodeFor(msg(5))), true);
  assert.deepEqual(ids(pane), [null, 5, 10, 20, 30], 'below every row: after the button, never before it');
  assert.equal(insertMessageNode(pane, nodeFor(msg(40))), true);
  assert.deepEqual(ids(pane), [null, 5, 10, 20, 30, 40], 'append is the hot path');
  // No button: an id below every row lands first.
  const bare = fakeEl();
  bare.appendChild(nodeFor(msg(10)));
  insertMessageNode(bare, nodeFor(msg(3)));
  assert.deepEqual(ids(bare), [3, 10]);
});

// --- T3: DOM-level idempotence (criterion 3) --------------------------------------

test('T3 AS-135: inserting an id already present returns false and leaves the child count unchanged', () => {
  const pane = fakeEl();
  pane.appendChild(nodeFor(msg(10)));
  pane.appendChild(nodeFor(msg(20)));
  const dup = nodeFor(msg(20));
  assert.equal(insertMessageNode(pane, dup), false);
  assert.equal(pane.children.length, 2);
  assert.deepEqual(ids(pane), [10, 20]);
  assert.ok(!pane.children.includes(dup), 'the duplicate node is not in the pane');
  assert.equal(insertMessageNode(pane, nodeFor(msg(10))), false, 'a non-last duplicate is also refused');
  assert.equal(pane.children.length, 2);
  assert.equal(insertMessageNode(pane, fakeEl('message')), false, 'a node without a msg-<id> is refused');
});

// --- T4: first message removes the empty note (criterion 4) -----------------------

test('T4 AS-135: the first message into an empty pane removes the .empty-note', () => {
  const ctx = context(payload([]));
  assert.deepEqual(
    ctx.main.children.map((c) => c.classList.contains('empty-note')),
    [true],
    'precondition: only the note'
  );
  frame(ctx, msg(1));
  assert.deepEqual(ids(ctx.main), [1]);
  assert.equal(ctx.main.children.some((c) => c.classList.contains('empty-note')), false, 'note removed');
  frame(ctx, msg(2));
  assert.deepEqual(ids(ctx.main), [1, 2]);
});

// --- T5: reply patches only its root (criterion 5) ---------------------------------

test('T5 AS-135: a reply frame patches only its root — label 1 reply / 2 replies, same link node on the second patch; other roots untouched', () => {
  const ctx = context(payload([3, 5, 7]));
  const [n3, n5, n7] = ctx.main.children;
  assert.deepEqual(labels(ctx.main), [[3, null], [5, null], [7, null]], 'precondition: no links');
  frame(ctx, msg(8, 5));
  assert.equal(labelOf(n5), '1 reply');
  const link = n5.children.find((c) => c.classList.contains('thread-link'));
  frame(ctx, msg(9, 5));
  assert.equal(labelOf(n5), '2 replies');
  assert.equal(n5.children.find((c) => c.classList.contains('thread-link')), link, 'patched in place, same link node');
  assert.equal(n5.children.filter((c) => c.classList.contains('thread-link')).length, 1, 'never a second link');
  assert.equal(labelOf(n3), null, 'root 3 untouched');
  assert.equal(labelOf(n7), null, 'root 7 untouched');
  assert.equal(n3.children.length, 0);
  assert.equal(n7.children.length, 0);
  assert.deepEqual(ids(ctx.main), [3, 5, 7], 'a reply never enters the main pane');
  // Direct API: unknown root → false; a root with a pre-rendered link is edited in place.
  assert.equal(setReplyCount(ctx.main, 99, 1, linkFor), false);
  assert.equal(replyLabel(0), '0 replies');
  assert.equal(replyLabel(1), '1 reply');
  assert.equal(replyLabel(2), '2 replies');
});

// --- T6: routing (criterion 6) ------------------------------------------------------

test('T6 AS-135: frameTargets routes top-level / loaded reply (thread closed, open, other open) / orphan reply', () => {
  const data = payload([10, 20]);
  const none = { insertMain: false, patchRoot: null, insertThread: false };
  assert.deepEqual(frameTargets(data, msg(30), null), { insertMain: true, patchRoot: null, insertThread: false });
  assert.deepEqual(frameTargets(data, msg(30), 10), { insertMain: true, patchRoot: null, insertThread: false }, 'top-level ignores the open thread');
  applyMessage(data, msg(11, 10));
  assert.deepEqual(frameTargets(data, msg(11, 10), null), { insertMain: false, patchRoot: { id: 10, count: 1 }, insertThread: false }, 'reply, thread closed → patch only');
  assert.deepEqual(frameTargets(data, msg(11, 10), 10), { insertMain: false, patchRoot: { id: 10, count: 1 }, insertThread: true }, 'reply, its thread open → patch + insertThread');
  assert.deepEqual(frameTargets(data, msg(11, 10), 20), { insertMain: false, patchRoot: { id: 10, count: 1 }, insertThread: false }, 'reply, a different thread open → patch only');
  applyMessage(data, msg(99, 50)); // orphan: root 50 not loaded
  assert.deepEqual(frameTargets(data, msg(99, 50), null), none, 'orphan reply → nothing');
  assert.deepEqual(frameTargets(data, msg(99, 50), 50), none, 'orphan reply even with its root id "open" → nothing');
});

// --- T7: incremental == fresh render (criterion 7) -----------------------------------

test('T7 AS-135: a scripted incremental sequence yields the same ids and labels as a fresh render of the final data', () => {
  const ctx = context(payload([10, 30], { hasMore: true }));
  frame(ctx, msg(40)); // append
  frame(ctx, msg(20)); // out of order
  frame(ctx, msg(40)); // duplicate (applyMessage refuses; the DOM insert must too)
  frame(ctx, msg(41, 10)); // reply on 10, thread closed
  frame(ctx, msg(42, 30)); // reply on 30
  openThread(ctx, 10); // thread 10 opens mid-sequence (fresh render of [10, 41])
  frame(ctx, msg(43, 10)); // reply on 10 while its thread is open
  frame(ctx, msg(43, 10)); // duplicate reply
  frame(ctx, msg(44, 30)); // reply on 30 while thread 10 is open
  frame(ctx, msg(50)); // one more top-level with a thread open
  assert.deepEqual(ctx.data.messages.map((m) => m.id), [10, 20, 30, 40, 50], 'data precondition');

  const main = freshMain(ctx.data);
  const thread = freshThread(ctx.data, 10);
  assert.deepEqual(ids(ctx.main), ids(main), 'main pane ids == fresh render');
  assert.deepEqual(ids(ctx.main), [null, 10, 20, 30, 40, 50]);
  assert.deepEqual(labels(ctx.main), labels(main), 'main pane labels == fresh render');
  assert.deepEqual(labels(ctx.main), [[10, '2 replies'], [20, null], [30, '2 replies'], [40, null], [50, null]]);
  assert.deepEqual(ids(ctx.thread), ids(thread), 'thread pane ids == fresh render');
  assert.deepEqual(ids(ctx.thread), [10, 41, 43]);
  assert.equal(ctx.main.children.length, main.children.length, 'no duplicate rows');
  assert.equal(ctx.thread.children.length, thread.children.length, 'no duplicate replies');
});

// --- T8: sticky-bottom survives an insert (criterion 8) ------------------------------

test('T8 AS-135: sticky-bottom — scrolled-up main/thread panes keep scrollTop across an insert; at-bottom panes follow to the new bottom', () => {
  // Main pane, scrolled up: 10 rows = 1000 tall, viewport 500, top at 300.
  const up = context(payload([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
  assert.equal(up.main.scrollHeight, 1000);
  up.main.scrollTop = 300;
  frame(up, msg(11));
  assert.equal(up.main.scrollHeight, 1100, 'the pane grew');
  assert.equal(up.main.scrollTop, 300, 'scrolled-up reader stays put');
  // Main pane, at bottom.
  const down = context(payload([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
  down.main.scrollTop = 500; // 1000 - 500
  frame(down, msg(11));
  assert.equal(down.main.scrollTop, 1100, 'at-bottom reader follows to the new bottom');
  // Thread pane, both ways (root + 9 replies = 10 rows).
  const replies = (root) => Array.from({ length: 9 }, (_, i) => msg(root * 100 + i + 1, root));
  const tUp = context(payload([1], { threads: { 1: replies(1) } }), { currentThreadRoot: 1 });
  assert.equal(tUp.thread.scrollHeight, 1000);
  tUp.thread.scrollTop = 300;
  frame(tUp, msg(150, 1));
  assert.equal(tUp.thread.scrollHeight, 1100);
  assert.equal(tUp.thread.scrollTop, 300, 'scrolled-up thread reader stays put');
  const tDown = context(payload([1], { threads: { 1: replies(1) } }), { currentThreadRoot: 1 });
  tDown.thread.scrollTop = 500;
  frame(tDown, msg(150, 1));
  assert.equal(tDown.thread.scrollTop, 1100, 'at-bottom thread reader follows');
  // A reply frame with the thread closed never touches the main pane's scroll.
  const closed = context(payload([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
  closed.main.scrollTop = 300;
  frame(closed, msg(150, 1));
  assert.equal(closed.main.scrollHeight, 1000);
  assert.equal(closed.main.scrollTop, 300);
});

// --- T9: anchor survives a frame (criterion 9) ----------------------------------------

test('T9 AS-135: an anchored node survives a frame — same node object, class still present', () => {
  const ctx = context(payload([10, 20, 30]));
  const anchored = ctx.main.children[1];
  anchored.classList.add('anchored');
  frame(ctx, msg(40));
  frame(ctx, msg(21, 20)); // a reply on the anchored root patches it in place
  assert.equal(ctx.main.children[1], anchored, 'same node object after a frame');
  assert.equal(anchored.classList.contains('anchored'), true, 'highlight class survives');
  assert.equal(labelOf(anchored), '1 reply');
  // Same in the thread pane.
  const t = context(payload([1], { threads: { 1: [msg(2, 1)] } }), { currentThreadRoot: 1 });
  const reply = t.thread.children[1];
  reply.classList.add('anchored');
  frame(t, msg(3, 1));
  assert.equal(t.thread.children[1], reply);
  assert.equal(reply.classList.contains('anchored'), true);
});

// --- T10: navigation rebuilds, frames never do (criterion 10, source pins) --------------

test('T10 AS-135: app.js has one renderConversation( call site (selectConversation); handleFrame/sendMessage/catchUp use renderFrame(, which applies the anchor', () => {
  const app = readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  const fnBody = (name) => {
    const m = app.match(new RegExp(`\\n(?:async )?function ${name}\\([\\s\\S]*?(?=\\n(?:async )?function |\\n// --- )`));
    assert.ok(m, `function ${name} is defined`);
    return m[0];
  };
  const calls = (app.match(/renderConversation\(/g) || []).length;
  const defs = (app.match(/function renderConversation\(/g) || []).length;
  assert.equal(defs, 1, 'renderConversation is defined once');
  assert.equal(calls - defs, 1, `exactly one renderConversation( call site (got ${calls - defs})`);
  assert.match(fnBody('selectConversation'), /renderConversation\(/, 'the one call site is selectConversation');
  for (const name of ['handleFrame', 'sendMessage', 'catchUp']) {
    const body = fnBody(name);
    assert.match(body, /renderFrame\(/, `${name} calls renderFrame(`);
    assert.doesNotMatch(body, /renderConversation\(/, `${name} never rebuilds`);
    assert.doesNotMatch(body, /replaceChildren\(/, `${name} never replaces children`);
  }
  const rf = fnBody('renderFrame');
  assert.match(rf, /applyFrameToPanes\(/, 'renderFrame delegates to applyFrameToPanes');
  assert.match(rf, /applyAnchor\(\)/, 'renderFrame applies the one-shot anchor');
  assert.doesNotMatch(rf, /replaceChildren\(/);
  assert.match(app, /import \{[^}]*applyFrameToPanes[^}]*\} from '\.\/message-pane\.js'/, 'app.js imports the module');
  assert.match(app, /import \{[^}]*replyLabel[^}]*\} from '\.\/message-pane\.js'/, 'one label source: messageNode uses replyLabel');
  assert.doesNotMatch(app, /'reply' : 'replies'/, 'no second reply-label source in app.js');
});
