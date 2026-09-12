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

// --- AS-131: page mode -----------------------------------------------------
// The cold load is now GET /api/messages?before=0&limit=50 — the same
// { conversation, messages, threads } shape plus hasMore/nextBefore. Older
// pages (before=nextBefore) are merged in front of the loaded set here.

/** Ceiling on pages ensureLoaded will walk back for one target (50 × 20 = 1,000 roots). */
export const ENSURE_LOADED_MAX_PAGES = 20;

/**
 * Merge one OLDER page into the loaded payload: prepend the page's top-level
 * rows that are not already present (the result stays id-ordered), install
 * the page's threads for each newly-added root (the server list is
 * authoritative at fetch time; a root already loaded keeps the list it has,
 * which may include live replies newer than this fetch), and adopt the page's
 * hasMore/nextBefore as the new cursor. maxLoadedId is unaffected by design:
 * a prepended page is older than everything loaded, so `since=` catch-up
 * still resumes from the newest id.
 *
 * @param {{ messages: object[], threads: Record<string, object[]>, hasMore?: boolean, nextBefore?: number|null }} data
 * @param {{ messages: object[], threads: Record<string, object[]>, hasMore: boolean, nextBefore: number|null }} page
 * @returns {number} how many top-level rows were added.
 */
export function mergeOlderPage(data, page) {
  const have = new Set(data.messages.map((m) => m.id));
  const fresh = (page.messages || []).filter((m) => !have.has(m.id));
  if (fresh.length) {
    const wasOrdered = !data.messages.length || fresh[fresh.length - 1].id < data.messages[0].id;
    data.messages.unshift(...fresh);
    if (!wasOrdered) data.messages.sort((a, b) => a.id - b.id);
    for (const root of fresh) data.threads[root.id] = (page.threads && page.threads[root.id]) || [];
  }
  data.hasMore = Boolean(page.hasMore);
  data.nextBefore = page.nextBefore ?? null;
  return fresh.length;
}

/**
 * The loaded message with this id, or null. A top-level row is loaded when
 * it is in `messages`; a reply is loaded only when its root is a loaded
 * top-level row. A reply whose root is outside the loaded pages can still
 * sit in `threads` (a live frame or `since=` catch-up stores it as an orphan
 * so nothing is lost when the root pages in) — but it is NOT loaded: opening
 * it would show a thread without its root, so callers must page the root in.
 *
 * @param {{ messages: object[], threads?: Record<string, object[]> }|null} data
 * @param {number} id
 * @returns {object|null}
 */
export function findLoaded(data, id) {
  if (!data) return null;
  const top = data.messages.find((m) => m.id === id);
  if (top) return top;
  for (const arr of Object.values(data.threads || {})) {
    const hit = arr.find((m) => m.id === id);
    if (hit) return data.messages.some((m) => m.id === hit.threadRootId) ? hit : null;
  }
  return null;
}

/** Is message `id` loaded — a top-level row, or a reply whose root is one? */
export function isLoaded(data, id) {
  return findLoaded(data, id) != null;
}

/**
 * Page backward until `targetId` is loaded (Decision 7: one direction of
 * paging, one code path — permalinks, thread-open and goToMessage all use
 * it). Stops when the target is present, when the server says there is no
 * older page, or at `maxPages` fetches; a target past the cap is dropped by
 * the caller exactly as a dead id is today (AS-9).
 *
 * @param {object} data           The loaded payload (mutated by mergeOlderPage).
 * @param {number} targetId       Root or reply id to bring into the loaded set.
 * @param {(before: number|null) => Promise<object>} fetchPage  Fetches the page older than `before`.
 * @param {{ maxPages?: number }} [opts]
 * @returns {Promise<boolean>} true iff the target is loaded on return.
 */
export async function ensureLoaded(data, targetId, fetchPage, { maxPages = ENSURE_LOADED_MAX_PAGES } = {}) {
  let pages = 0;
  while (!isLoaded(data, targetId)) {
    if (!data.hasMore || pages >= maxPages) return false;
    const page = await fetchPage(data.nextBefore);
    pages += 1;
    mergeOlderPage(data, page);
  }
  return true;
}
