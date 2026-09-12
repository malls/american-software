// Unit tests for public/live.js (AS-25) — the pure client-side merge that
// both SSE frames and since= catch-up rows go through. Same import-the-
// browser-module pattern as url-state.test.js / scroll.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMessage, maxLoadedId, mergeOlderPage, ensureLoaded, isLoaded, findLoaded, ENSURE_LOADED_MAX_PAGES } from '../public/live.js';

const msg = (id, conversationId, threadRootId = null, extra = {}) => ({
  id,
  conversationId,
  threadRootId,
  authorId: 'agent:cto-owen',
  body: `m${id}`,
  createdAt: '2026-08-30T12:00:00.000Z',
  refs: [],
  ...extra,
});

const payload = (convId = 7) => ({
  conversation: { id: convId, type: 'channel', name: 'eng', visibility: 'public' },
  messages: [],
  threads: {},
});

test('AS-25 live: maxLoadedId spans top-level messages and thread replies; 0 when empty', () => {
  assert.equal(maxLoadedId(null), 0);
  assert.equal(maxLoadedId(payload()), 0);
  const data = payload();
  data.messages = [msg(3, 7), msg(5, 7)];
  data.threads = { 3: [msg(9, 7, 3)], 5: [msg(6, 7, 5)] };
  assert.equal(maxLoadedId(data), 9, 'a reply can carry the max id');
  assert.equal(maxLoadedId({ messages: [msg(4, 7)] }), 4, 'threads key optional');
});

test('AS-25 live: top-level merge — appends id-ordered, normalizes replyCount, dedupes by id', () => {
  const data = payload(7);
  assert.equal(applyMessage(data, msg(10, 7)), true);
  assert.deepEqual(data.messages[0].replyCount, 0, 'frame/delta rows carry no replyCount: normalized to 0');

  // Duplicate id (frame + POST echo, frame + catch-up overlap): no-op.
  assert.equal(applyMessage(data, msg(10, 7)), false);
  assert.equal(data.messages.length, 1);

  // Wrong conversation (frame racing a conversation switch) and absent
  // payload: no-op, never a throw.
  assert.equal(applyMessage(data, msg(11, 8)), false);
  assert.equal(applyMessage(null, msg(11, 7)), false);
  assert.equal(applyMessage({ messages: [], threads: {} }, msg(11, 7)), false);

  // Out-of-order arrival (catch-up racing a live frame) re-sorts by id.
  assert.equal(applyMessage(data, msg(12, 7)), true);
  assert.equal(applyMessage(data, msg(11, 7)), true);
  assert.deepEqual(data.messages.map((m) => m.id), [10, 11, 12]);

  // A server-provided replyCount (none today) would be respected, not zeroed.
  assert.equal(applyMessage(data, msg(13, 7, null, { replyCount: 2 })), true);
  assert.equal(data.messages.at(-1).replyCount, 2);
});

test('AS-25 live: reply merge — appends to threads[root], bumps loaded root replyCount exactly once', () => {
  const data = payload(7);
  applyMessage(data, msg(1, 7));
  assert.equal(applyMessage(data, msg(2, 7, 1)), true);
  assert.deepEqual(data.threads[1].map((m) => m.id), [2]);
  assert.equal(data.messages[0].replyCount, 1);

  // Same reply again: nothing moves — the bump can never double-count.
  assert.equal(applyMessage(data, msg(2, 7, 1)), false);
  assert.equal(data.threads[1].length, 1);
  assert.equal(data.messages[0].replyCount, 1);

  // Reply whose root is not loaded (defensive): stored, no crash, no bump.
  assert.equal(applyMessage(data, msg(9, 7, 8)), true);
  assert.deepEqual(data.threads[8].map((m) => m.id), [9]);

  // Out-of-order replies in one thread re-sort by id.
  applyMessage(data, msg(5, 7, 1));
  applyMessage(data, msg(4, 7, 1));
  assert.deepEqual(data.threads[1].map((m) => m.id), [2, 4, 5]);
  assert.equal(data.messages[0].replyCount, 3);
});

test('AS-25 live: catch-up idempotency — replaying the same delta changes nothing', () => {
  const data = payload(7);
  // Cold-loaded state: one root with a reply already counted.
  applyMessage(data, msg(1, 7));
  applyMessage(data, msg(2, 7, 1));

  // A since= delta: two new top-levels and a new reply (roots precede their
  // replies in a real delta, since a reply's id always exceeds its root's).
  const delta = [msg(3, 7), msg(4, 7, 1), msg(5, 7)];
  for (const m of delta) assert.equal(applyMessage(data, m), true);
  const snapshot = structuredClone(data);

  // Replay the identical delta (dropped-connection double catch-up, or a
  // frame that raced the delta): every apply is a no-op, state is identical.
  for (const m of delta) assert.equal(applyMessage(data, m), false);
  assert.deepEqual(data, snapshot);
  assert.equal(maxLoadedId(data), 5);
  assert.equal(data.messages.find((m) => m.id === 1).replyCount, 2, 'no double-counted replies');
});

// --- AS-131: page mode -------------------------------------------------------

/** A page payload as GET /api/messages?before= returns it. */
const pageOf = (rootIds, { threads = {}, hasMore = true, convId = 7 } = {}) => ({
  conversation: { id: convId, type: 'channel', name: 'eng', visibility: 'public' },
  messages: rootIds.map((id) => msg(id, convId, null, { replyCount: (threads[id] || []).length })),
  threads,
  hasMore,
  nextBefore: rootIds.length ? Math.min(...rootIds) : null,
});

test('AS-131 live: mergeOlderPage prepends id-ordered, dedupes, adopts the cursor, and replaces only the page roots\' threads', () => {
  // Newest page loaded: roots 30, 40 (40 has a live reply 41 already merged).
  const data = pageOf([30, 40], { threads: { 40: [msg(41, 7, 40)] }, hasMore: true });
  assert.equal(data.nextBefore, 30);

  // Older page: roots 10, 20 with 20's replies; prepends in front, in order.
  const older = pageOf([10, 20], { threads: { 20: [msg(21, 7, 20), msg(22, 7, 20)] }, hasMore: true });
  assert.equal(mergeOlderPage(data, older), 2);
  assert.deepEqual(data.messages.map((m) => m.id), [10, 20, 30, 40], 'older rows go in FRONT, ascending');
  assert.deepEqual(data.threads[20].map((m) => m.id), [21, 22], 'page root threads installed');
  assert.deepEqual(data.threads[40].map((m) => m.id), [41], 'an already-loaded root keeps its thread');
  assert.equal(data.hasMore, true);
  assert.equal(data.nextBefore, 10, 'cursor adopted from the page');
  assert.equal(maxLoadedId(data), 41, 'since= watermark unchanged by an older page');

  // Overlapping page (a re-fetch, or a row that arrived by frame meanwhile):
  // already-present rows are skipped, nothing duplicates, length holds.
  const overlap = pageOf([5, 10, 20], { threads: { 10: [msg(11, 7, 10)] }, hasMore: false });
  assert.equal(mergeOlderPage(data, overlap), 1);
  assert.deepEqual(data.messages.map((m) => m.id), [5, 10, 20, 30, 40]);
  assert.equal(data.messages.length, 5, 'no duplicate rows');
  assert.equal(data.hasMore, false);
  assert.equal(data.nextBefore, 5);
  assert.deepEqual(data.threads[10], [], 'a deduped (already loaded) root keeps its list; the overlap page\'s [11] is not installed');
  assert.deepEqual(data.threads[20].map((m) => m.id), [21, 22]);

  // Terminal empty page: no rows, hasMore false, cursor null; loaded set intact.
  assert.equal(mergeOlderPage(data, pageOf([], { hasMore: false })), 0);
  assert.deepEqual(data.messages.map((m) => m.id), [5, 10, 20, 30, 40]);
  assert.equal(data.nextBefore, null);
  assert.equal(data.hasMore, false);
  // The ordinary live path still works on the merged set.
  assert.equal(applyMessage(data, msg(23, 7, 20)), true);
  assert.equal(data.messages.find((m) => m.id === 20).replyCount, 3);
});

test('AS-131 live: ensureLoaded pages back until the target is loaded, stops on hasMore:false, and caps at 20 pages', async () => {
  // Fixture: 10 pages of 2 roots (ids 2..40 by twos) — page k (from newest)
  // holds roots [40-2k-1... ] — plus a reply 27 on root 26 (page 3 from newest).
  const all = [];
  for (let id = 2; id <= 40; id += 2) all.push(id);
  const threads = { 26: [msg(27, 7, 26)] };
  const fetcher = () => {
    const calls = [];
    const fetchPage = async (before) => {
      calls.push(before);
      const older = all.filter((id) => before === 0 || before == null || id < before);
      const roots = older.slice(-2);
      const t = {};
      for (const r of roots) if (threads[r]) t[r] = threads[r];
      return pageOf(roots, { threads: t, hasMore: older.length > 2 });
    };
    return { calls, fetchPage };
  };

  // Target root 30 sits in page 3 (pages: [38,40] loaded, then [34,36], [30,32]).
  {
    const data = pageOf([38, 40], { hasMore: true });
    const { calls, fetchPage } = fetcher();
    assert.equal(await ensureLoaded(data, 30, fetchPage), true);
    assert.deepEqual(calls, [38, 34], 'two fetches (pages 2 and 3) after the loaded page 1');
    assert.deepEqual(data.messages.map((m) => m.id), [30, 32, 34, 36, 38, 40]);
    assert.equal(data.nextBefore, 30);
  }
  // Already loaded: zero fetches.
  {
    const data = pageOf([38, 40], { hasMore: true });
    const { calls, fetchPage } = fetcher();
    assert.equal(await ensureLoaded(data, 40, fetchPage), true);
    assert.deepEqual(calls, []);
  }
  // A reply id counts as loaded once its root's page is in.
  {
    const data = pageOf([38, 40], { hasMore: true });
    const { calls, fetchPage } = fetcher();
    assert.equal(await ensureLoaded(data, 27, fetchPage), true);
    assert.deepEqual(calls, [38, 34, 30], 'stops as soon as the reply\'s root page (26, 28) is in');
    assert.equal(isLoaded(data, 27), true);
    assert.equal(isLoaded(data, 25), false);
  }
  // Absent target on a short history: stops when the server says no more.
  {
    const data = pageOf([38, 40], { hasMore: true });
    const short = [30, 32, 34, 36, 38, 40]; // three pages of two
    const calls = [];
    const fetchPage = async (before) => {
      calls.push(before);
      const older = short.filter((id) => id < before);
      return pageOf(older.slice(-2), { hasMore: older.length > 2 });
    };
    assert.equal(await ensureLoaded(data, 999, fetchPage), false);
    assert.deepEqual(calls, [38, 34], 'exactly 2 fetches: hasMore:false on the second page stops the walk');
    assert.deepEqual(data.messages.map((m) => m.id), [30, 32, 34, 36, 38, 40]);
    assert.equal(data.hasMore, false);
  }
  // Runaway guard: a server that always says hasMore:true is cut off at the cap.
  {
    const data = pageOf([38, 40], { hasMore: true });
    let n = 0;
    const fetchPage = async (before) => {
      n += 1;
      return pageOf([before - 2, before - 1], { hasMore: true });
    };
    assert.equal(ENSURE_LOADED_MAX_PAGES, 20);
    assert.equal(await ensureLoaded(data, 9999, fetchPage), false);
    assert.equal(n, 20, 'capped at 20 fetches');
    assert.equal(data.messages.length, 42);
  }
});

test('AS-131 live: a reply whose root is outside the loaded pages is not loaded — findLoaded/isLoaded fall through so ensureLoaded pages the root in (criterion 12, F1)', async () => {
  // Newest page [38, 40] open; a LIVE reply 41 lands on root 26, which is
  // outside the page. applyMessage keeps it as an orphan threads[26] entry.
  const data = pageOf([38, 40], { hasMore: true });
  assert.equal(applyMessage(data, msg(41, 7, 26)), true);
  assert.deepEqual(data.threads[26].map((m) => m.id), [41], 'orphan reply kept under its root key');
  // Orphan reply: NOT loaded (opening it would show a thread without its root).
  assert.equal(findLoaded(data, 41), null);
  assert.equal(isLoaded(data, 41), false);
  // Loaded reply on a loaded root: still loaded (the ordinary case is unchanged).
  assert.equal(applyMessage(data, msg(42, 7, 40)), true);
  assert.equal(findLoaded(data, 42).id, 42);
  assert.equal(isLoaded(data, 42), true);
  // Top-level rows are unaffected; unknown ids stay null.
  assert.equal(findLoaded(data, 40).id, 40);
  assert.equal(findLoaded(data, 26), null);
  assert.equal(findLoaded(null, 41), null);

  // ensureLoaded therefore walks back until root 26's page is in, then stops.
  // The fake server's thread list for 26 is what the real one returns at
  // click time: every committed reply, including the live one (41) — the
  // server list is authoritative at fetch time (Approach, live.js).
  const all = [];
  for (let id = 2; id <= 40; id += 2) all.push(id);
  const calls = [];
  const fetchPage = async (before) => {
    calls.push(before);
    const older = all.filter((id) => id < before);
    const roots = older.slice(-2);
    const t = {};
    if (roots.includes(26)) t[26] = [msg(27, 7, 26), msg(41, 7, 26)];
    return pageOf(roots, { threads: t, hasMore: older.length > 2 });
  };
  assert.equal(await ensureLoaded(data, 41, fetchPage), true);
  assert.deepEqual(calls, [38, 34, 30], 'three fetches: pages [34,36], [30,32], [26,28]');
  assert.equal(findLoaded(data, 41).id, 41);
  assert.equal(isLoaded(data, 41), true);
  assert.equal(data.messages.find((m) => m.id === 26).replyCount, 2, 'root 26 carries the server replyCount');
  assert.deepEqual(data.threads[26].map((m) => m.id), [27, 41], 'root and its complete reply list are loaded — the thread can open whole');
});
