// Unit tests for public/live.js (AS-25) — the pure client-side merge that
// both SSE frames and since= catch-up rows go through. Same import-the-
// browser-module pattern as url-state.test.js / scroll.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMessage, maxLoadedId } from '../public/live.js';

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
