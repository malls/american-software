// message-pane.js — incremental DOM updates for the chat panes (AS-135).
// No DOM construction, no fetch, no globals: importable from the browser
// (app.js) and from node:test alike (same pattern as scroll.js / live.js).
// app.js supplies the panes and the node factories; this module touches only
// `id`, `classList`, `children`, `insertBefore`, `appendChild`, `removeChild`,
// `textContent` and the three scroll metrics — so a plain-object fake element
// is a faithful double and every property here is a host test.
//
// Mirror invariant (Decision 2): the main pane's `.message` children equal
// data.messages in id order; the thread pane equals [root, ...threads[root]].
// Navigation and an older-page prepend rebuild from data; a live frame, a
// send echo or a since= catch-up row patches through applyFrameToPanes.
import { renderPreservingScroll } from './scroll.js';

/** Numeric message id of a `msg-<id>` node, or null for anything else (the load-earlier button, the empty note). */
export function messageIdOf(node) {
  const id = node && typeof node.id === 'string' ? node.id : '';
  if (!id.startsWith('msg-')) return null;
  const n = Number(id.slice(4));
  return Number.isInteger(n) ? n : null;
}

/** The one label source for a root's reply count (Decision 5). */
export function replyLabel(count) {
  return `${count} ${count === 1 ? 'reply' : 'replies'}`;
}

/** Does `list` (a live `children` collection) contain a node with this class? */
function findByClass(list, cls) {
  for (const child of list) if (child.classList && child.classList.contains(cls)) return child;
  return null;
}

/** The `msg-<id>` child of `pane`, or null. */
function findMessage(pane, id) {
  for (const child of pane.children) if (messageIdOf(child) === id) return child;
  return null;
}

/**
 * Insert one message node into a pane in id order (Decision 4). Idempotent at
 * the DOM level: an id already present is a no-op. Append is the hot path —
 * one comparison against the last child — and an out-of-order id walks
 * backwards from the end. Non-message children (`.load-earlier` button) stay
 * first; an `.empty-note` is removed on the first insert.
 *
 * @param {Element|object} pane
 * @param {Element|object} node  A `msg-<id>` node.
 * @returns {boolean} true iff the node was inserted.
 */
export function insertMessageNode(pane, node) {
  const id = messageIdOf(node);
  if (id == null || findMessage(pane, id)) return false;
  const note = findByClass(pane.children, 'empty-note');
  if (note) pane.removeChild(note);
  const kids = pane.children;
  let before = null;
  for (let i = kids.length - 1; i >= 0; i--) {
    const cid = messageIdOf(kids[i]);
    if (cid == null) break; // walked past every message row: land right after the non-message head
    if (cid < id) break;
    before = kids[i];
  }
  if (before) pane.insertBefore(node, before);
  else pane.appendChild(node);
  return true;
}

/**
 * Patch one root's reply-count link in place (Decision 5). Edits the existing
 * `.thread-link` text, or appends one via `makeLink(rootId, count)` when the
 * root had none. No count-0 branch: replyCount never decreases.
 *
 * @returns {boolean} true iff the root was found in the pane.
 */
export function setReplyCount(pane, rootId, count, makeLink) {
  const root = findMessage(pane, rootId);
  if (!root) return false;
  const link = findByClass(root.children, 'thread-link');
  if (link) link.textContent = replyLabel(count);
  else root.appendChild(makeLink(rootId, count));
  return true;
}

/**
 * Where one merged message goes (Decision 6). Pure: reads `data` after
 * applyMessage has merged `msg`.
 *
 * @returns {{ insertMain: boolean, patchRoot: {id:number, count:number}|null, insertThread: boolean }}
 */
export function frameTargets(data, msg, currentThreadRoot) {
  if (msg.threadRootId == null) return { insertMain: true, patchRoot: null, insertThread: false };
  const root = data.messages.find((m) => m.id === msg.threadRootId);
  if (!root) return { insertMain: false, patchRoot: null, insertThread: false }; // orphan reply: root not loaded
  return {
    insertMain: false,
    patchRoot: { id: root.id, count: root.replyCount || 0 },
    insertThread: currentThreadRoot === msg.threadRootId,
  };
}

/**
 * Apply one merged message to the panes: the entry point app.js calls after a
 * successful applyMessage. Each insert runs under renderPreservingScroll
 * (Decision 3) so sticky-bottom holds per pane: at-bottom follows, scrolled-up
 * restores exactly.
 *
 * @param {object} args
 * @param {object} args.data                 state.lastData after the merge.
 * @param {object} args.msg                  The merged message row.
 * @param {number|null} args.currentThreadRoot  Open thread's root id, or null.
 * @param {Element|object} args.mainPane
 * @param {Element|object} args.threadPane
 * @param {(m: object, opts: { inThread: boolean }) => Element} args.nodeFor
 * @param {(rootId: number, count: number) => Element} args.linkFor
 * @returns {{ insertMain: boolean, patchRoot: object|null, insertThread: boolean }} the targets applied.
 */
export function applyFrameToPanes({ data, msg, currentThreadRoot, mainPane, threadPane, nodeFor, linkFor }) {
  const t = frameTargets(data, msg, currentThreadRoot);
  if (t.insertMain) {
    renderPreservingScroll(mainPane, () => insertMessageNode(mainPane, nodeFor(msg, { inThread: false })));
  }
  if (t.patchRoot) setReplyCount(mainPane, t.patchRoot.id, t.patchRoot.count, linkFor);
  if (t.insertThread) {
    renderPreservingScroll(threadPane, () => insertMessageNode(threadPane, nodeFor(msg, { inThread: true })));
  }
  return t;
}
