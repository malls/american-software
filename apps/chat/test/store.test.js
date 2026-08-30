// Unit tests for lib/store.js against a temp-dir DB per test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, dmKeyFor, StoreError } from '../lib/store.js';

function tempStore(t) {
  const dir = mkdtempSync(join(tmpdir(), 'chat-store-'));
  const store = openStore(join(dir, 'chat.db'));
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { store, dir };
}

test('seeds four identities and three channels, idempotently', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'chat-store-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'chat.db');
  let store = openStore(path);
  assert.deepEqual(
    store.listIdentities().map((i) => i.id),
    ['agent:ceo-carla', 'agent:cto-owen', 'human:forrest', 'system:lattice']
  );
  const channels = store.listConversationsFor('human:forrest').filter((c) => c.type === 'channel');
  assert.deepEqual(
    channels.map((c) => c.name),
    ['announcements', 'engineering', 'lattice-events']
  );
  store.close();
  // Re-open: seeding must not duplicate.
  store = openStore(path);
  assert.equal(store.listIdentities().length, 4);
  assert.equal(store.listConversationsFor('human:forrest').length, 3);
  store.close();
});

test('registerIdentity validates and rejects duplicates', (t) => {
  const { store } = tempStore(t);
  const id = store.registerIdentity({
    id: 'agent:developer-marcus',
    displayName: 'Marcus Webb (Engineer)',
    kind: 'agent',
  });
  assert.equal(id.displayName, 'Marcus Webb (Engineer)');
  assert.throws(
    () => store.registerIdentity({ id: 'agent:developer-marcus', displayName: 'x', kind: 'agent' }),
    /already exists/
  );
  assert.throws(() => store.registerIdentity({ id: 'Bad Id!', displayName: 'x', kind: 'agent' }), StoreError);
  assert.throws(
    () => store.registerIdentity({ id: 'human:marcus', displayName: 'x', kind: 'agent' }),
    /kind prefix/
  );
});

test('createChannel validates name and uniqueness', (t) => {
  const { store } = tempStore(t);
  const ch = store.createChannel({ name: 'general', purpose: 'Chit chat', actor: 'human:forrest' });
  assert.equal(ch.type, 'channel');
  assert.throws(() => store.createChannel({ name: 'general', actor: 'human:forrest' }), /already exists/);
  assert.throws(() => store.createChannel({ name: 'Bad Name', actor: 'human:forrest' }), /lowercase/);
  assert.throws(() => store.createChannel({ name: 'ok', actor: 'agent:nobody' }), /Unknown identity/);
});

test('DM is get-or-create on the normalized pair', (t) => {
  const { store } = tempStore(t);
  const a = store.openDm('human:forrest', 'agent:cto-owen');
  const b = store.openDm('agent:cto-owen', 'human:forrest');
  assert.equal(a.id, b.id);
  assert.equal(a.dmKey, dmKeyFor('agent:cto-owen', 'human:forrest'));
  assert.deepEqual(a.members, ['agent:cto-owen', 'human:forrest']);
  assert.throws(() => store.openDm('human:forrest', 'human:forrest'), /yourself/);
  // Non-members can't post into it.
  assert.throws(
    () => store.postMessage({ conversation: a.id, author: 'agent:ceo-carla', body: 'hi' }),
    /not a member/
  );
});

test('posting, threads flatten to one level, reply counts', (t) => {
  const { store } = tempStore(t);
  const eng = store.getChannelByName('engineering');
  const m1 = store.postMessage({ conversation: eng.id, author: 'human:forrest', body: 'top level' });
  const r1 = store.postMessage({
    conversation: eng.id,
    author: 'agent:cto-owen',
    body: 'reply',
    threadRoot: m1.id,
  });
  // Reply to a reply attaches to the top-level root (no nesting).
  const r2 = store.postMessage({
    conversation: eng.id,
    author: 'human:forrest',
    body: 'reply to reply',
    threadRoot: r1.id,
  });
  assert.equal(r1.threadRootId, m1.id);
  assert.equal(r2.threadRootId, m1.id);
  const { messages, threads } = store.getMessages(eng.id);
  assert.deepEqual(messages.map((m) => m.id), [m1.id]); // replies never top-level
  assert.equal(messages[0].replyCount, 2);
  assert.deepEqual(threads[m1.id].map((m) => m.id), [r1.id, r2.id]);
  // Cross-conversation thread roots rejected.
  const ann = store.getChannelByName('announcements');
  assert.throws(
    () => store.postMessage({ conversation: ann.id, author: 'human:forrest', body: 'x', threadRoot: m1.id }),
    /different conversation/
  );
  // Bad inputs rejected with clear errors.
  assert.throws(() => store.postMessage({ conversation: eng.id, author: 'human:forrest', body: '  ' }), /non-empty/);
  assert.throws(() => store.postMessage({ conversation: 9999, author: 'human:forrest', body: 'x' }), /Unknown conversation/);
  assert.throws(() => store.postMessage({ conversation: eng.id, author: 'agent:ghost', body: 'x' }), /Unknown identity/);
});

test('lattice-events channel: only system posts top-level; threads open to all', (t) => {
  const { store } = tempStore(t);
  const chan = store.getChannelByName('lattice-events');
  assert.throws(
    () => store.postMessage({ conversation: chan.id, author: 'human:forrest', body: 'manual post' }),
    /Only system:lattice/
  );
  const ev = store.postMessage({ conversation: chan.id, author: 'system:lattice', body: 'AS-1 created' });
  const reply = store.postMessage({
    conversation: chan.id,
    author: 'human:forrest',
    body: 'discussing this event',
    threadRoot: ev.id,
  });
  assert.equal(reply.threadRootId, ev.id);
});

test('unread semantics: exactly the AC6 scenario', (t) => {
  const { store } = tempStore(t);
  const me = 'agent:ceo-carla';
  const eng = store.getChannelByName('engineering');
  // Some pre-existing traffic, then I read everything.
  store.postMessage({ conversation: eng.id, author: 'human:forrest', body: 'old news' });
  const dm = store.openDm(me, 'human:forrest');
  store.postMessage({ conversation: dm.id, author: 'human:forrest', body: 'old dm' });
  const rootMsg = store.postMessage({ conversation: eng.id, author: me, body: 'my thread root' });
  store.catchupAll(me);
  assert.deepEqual(store.unreadFor(me), []);
  // Now: one channel message, one DM, one thread reply — and my own post (never unread).
  const chMsg = store.postMessage({ conversation: eng.id, author: 'human:forrest', body: 'new in channel' });
  const dmMsg = store.postMessage({ conversation: dm.id, author: 'human:forrest', body: 'new dm' });
  const thMsg = store.postMessage({
    conversation: eng.id,
    author: 'agent:cto-owen',
    body: 'reply in your thread',
    threadRoot: rootMsg.id,
  });
  store.postMessage({ conversation: eng.id, author: me, body: 'my own words' });
  const groups = store.unreadFor(me);
  const ids = groups.flatMap((g) => g.messages.map((m) => m.id)).sort((a, b) => a - b);
  assert.deepEqual(ids, [chMsg.id, dmMsg.id, thMsg.id]); // exactly three, no more, no fewer
  // A DM between two other parties is not mine to see.
  const otherDm = store.openDm('human:forrest', 'agent:cto-owen');
  store.postMessage({ conversation: otherDm.id, author: 'human:forrest', body: 'private' });
  const ids2 = store.unreadFor(me).flatMap((g) => g.messages.map((m) => m.id));
  assert.equal(ids2.length, 3);
});

test('markRead advances the watermark monotonically', (t) => {
  const { store } = tempStore(t);
  const eng = store.getChannelByName('engineering');
  const m1 = store.postMessage({ conversation: eng.id, author: 'human:forrest', body: 'one' });
  const m2 = store.postMessage({ conversation: eng.id, author: 'human:forrest', body: 'two' });
  store.markRead('agent:cto-owen', eng.id, m1.id);
  assert.equal(store.unreadCountFor('agent:cto-owen', eng.id), 1);
  // Cannot regress the watermark.
  store.markRead('agent:cto-owen', eng.id, 0);
  assert.equal(store.unreadCountFor('agent:cto-owen', eng.id), 1);
  store.markRead('agent:cto-owen', eng.id); // default: up to max
  assert.equal(store.unreadCountFor('agent:cto-owen', eng.id), 0);
  assert.equal(store.unreadCountFor('agent:ceo-carla', eng.id), 2, 'per-identity watermarks');
  void m2;
});

test('data survives close and reopen (restart durability)', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'chat-store-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'chat.db');
  let store = openStore(path);
  const eng = store.getChannelByName('engineering');
  const m = store.postMessage({ conversation: eng.id, author: 'human:forrest', body: 'durable' });
  store.markRead('agent:cto-owen', eng.id, m.id);
  store.close();
  store = openStore(path);
  assert.equal(store.getMessage(m.id).body, 'durable');
  assert.equal(store.unreadCountFor('agent:cto-owen', store.getChannelByName('engineering').id), 0);
  store.close();
});

test('two connections interleave writes under WAL (concurrency smoke)', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'chat-store-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'chat.db');
  const a = openStore(path);
  const b = openStore(path);
  t.after(() => {
    a.close();
    b.close();
  });
  const eng = a.getChannelByName('engineering').id;
  for (let i = 0; i < 20; i++) {
    a.postMessage({ conversation: eng, author: 'human:forrest', body: `a${i}` });
    b.postMessage({ conversation: eng, author: 'agent:cto-owen', body: `b${i}` });
  }
  assert.equal(a.getMessages(eng).messages.length, 40);
  assert.equal(b.getMessages(eng).messages.length, 40);
});

test('ingestEvent is idempotent per event id', (t) => {
  const { store } = tempStore(t);
  assert.equal(store.ingestEvent('ev_TEST1', 'AS-1: backlog → in_planning — by agent:x'), true);
  assert.equal(store.ingestEvent('ev_TEST1', 'AS-1: backlog → in_planning — by agent:x'), false);
  const chan = store.getChannelByName('lattice-events');
  assert.equal(store.getMessages(chan.id).messages.length, 1);
});

test('dumpLines emits valid JSONL covering every table', (t) => {
  const { store } = tempStore(t);
  const eng = store.getChannelByName('engineering');
  const m = store.postMessage({ conversation: eng.id, author: 'human:forrest', body: 'dump me' });
  store.openDm('human:forrest', 'agent:cto-owen');
  store.markRead('human:forrest', eng.id, m.id);
  store.ingestEvent('ev_DUMP', 'AS-1 created by human:forrest — "x" [backlog]');
  const lines = store.dumpLines();
  const tables = new Set(lines.map((l) => JSON.parse(l).table));
  assert.deepEqual(
    [...tables].sort(),
    ['conversations', 'dm_members', 'identities', 'ingested_events', 'messages', 'read_state']
  );
  for (const line of lines) assert.doesNotThrow(() => JSON.parse(line));
});
