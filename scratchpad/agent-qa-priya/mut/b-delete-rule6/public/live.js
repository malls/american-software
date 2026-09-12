// live.js — pure merge logic for push delivery (AS-25).
// No DOM, no fetch, no globals: importable from the browser (app.js) and
// from node:test alike (same pattern as url-state.js / scroll.js). Operates
// on the /api/messages payload shape ({ conversation, messages, threads })
// that app.js keeps in state.lastData.

/**
 * Highest message id present in a loaded conversation payload — top-level
 * messages AND thread replies. This is the `since=` value for catch-up.
 *
 * @param {{ messages?: object[], threads?: Record<string, object[]> }|null} data
 * @returns {number} 0 when nothing is loaded.
 */
export function maxLoadedId(data) {
  let max = 0;
  if (!data) return max;
  for (const m of data.messages || []) if (m.id > max) max = m.id;
  for (const arr of Object.values(data.threads || {})) {
    for (const m of arr) if (m.id > max) max = m.id;
  }
  return max;
}

/** Insert msg keeping the array id-ordered; append is the hot path. */
function insertOrdered(arr, msg) {
  arr.push(msg);
  if (arr.length > 1 && arr[arr.length - 2].id > msg.id) {
    arr.sort((a, b) => a.id - b.id);
  }
}

/**
 * Idempotent merge of one message into a conversation payload — THE single
 * code path for live SSE frames, `since=` catch-up rows, and the POST
 * /api/messages response (whose own frame then dedupes by id).
 *
 * - Wrong/absent conversation: no-op (a frame can race a conversation
 *   switch whose fetch hasn't landed yet — the fetch will include it).
 * - Duplicate id: no-op (frame + catch-up overlap, frame + POST echo).
 * - Top-level: appended to messages, replyCount normalized to 0 when the
 *   source carried none (frames and delta rows don't).
 * - Reply: appended to threads[root], bumping the root's replyCount iff the
 *   root is loaded. Safe against double-count: the bump happens only on a
 *   NEW reply id. Ordering: a reply's id always exceeds its root's, so a
 *   catch-up delta always delivers roots before their replies.
 *
 * @param {{ conversation?: {id:number}, messages: object[], threads: Record<string, object[]> }|null} data
 * @param {object} msg  Message row (id, conversationId, threadRootId, ...).
 * @returns {boolean} true iff the payload changed.
 */
export function applyMessage(data, msg) {
  if (!data || !data.conversation || data.conversation.id !== msg.conversationId) return false;
  if (msg.threadRootId == null) {
    if (data.messages.some((m) => m.id === msg.id)) return false;
    insertOrdered(data.messages, { ...msg, replyCount: msg.replyCount ?? 0 });
    return true;
  }
  const arr = (data.threads[msg.threadRootId] ??= []);
  if (arr.some((m) => m.id === msg.id)) return false;
  insertOrdered(arr, msg);
  const root = data.messages.find((m) => m.id === msg.threadRootId);
  if (root) root.replyCount = (root.replyCount || 0) + 1;
  return true;
}
