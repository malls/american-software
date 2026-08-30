// Unit tests for lib/store.js against a temp-dir DB per test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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

test('seeds four identities and four channels (#board private), idempotently', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'chat-store-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'chat.db');
  let store = openStore(path);
  assert.deepEqual(
    store.listIdentities().map((i) => i.id),
    ['agent:ceo-carla', 'agent:cto-owen', 'human:forrest', 'system:lattice']
  );
  // A member (founder) sees all four channels, #board marked private.
  const channels = store.listConversationsFor('human:forrest').filter((c) => c.type === 'channel');
  assert.deepEqual(
    channels.map((c) => c.name),
    ['announcements', 'board', 'engineering', 'lattice-events']
  );
  assert.deepEqual(
    channels.map((c) => c.visibility),
    ['public', 'private', 'public', 'public']
  );
  const board = store.getChannelByName('board');
  assert.deepEqual(store.dmMembers(board.id), ['agent:ceo-carla', 'agent:cto-owen', 'human:forrest']);
  store.close();
  // Re-open: seeding must not duplicate.
  store = openStore(path);
  assert.equal(store.listIdentities().length, 4);
  assert.equal(store.listConversationsFor('human:forrest').length, 4);
  assert.equal(store.dmMembers(store.getChannelByName('board').id).length, 3);
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

test('dmConversationFor: null pre-DM, the conv id post-openDm, never creates (AS-8)', (t) => {
  const { store } = tempStore(t);
  assert.equal(store.dmConversationFor('human:forrest', 'agent:cto-owen'), null);
  // The lookup itself must not have created anything.
  assert.ok(!store.listConversationsFor('human:forrest').some((c) => c.type === 'dm'));
  const dm = store.openDm('human:forrest', 'agent:cto-owen');
  assert.equal(store.dmConversationFor('human:forrest', 'agent:cto-owen'), dm.id);
  assert.equal(store.dmConversationFor('agent:cto-owen', 'human:forrest'), dm.id, 'order-insensitive');
  assert.equal(store.dmConversationFor('human:forrest', 'agent:ceo-carla'), null);
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
  const { messages, threads } = store.getMessages(eng.id, 'human:forrest');
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
  assert.equal(a.getMessages(eng, 'human:forrest').messages.length, 40);
  assert.equal(b.getMessages(eng, 'agent:cto-owen').messages.length, 40);
});

test('ingestEvent is idempotent per event id', (t) => {
  const { store } = tempStore(t);
  assert.equal(store.ingestEvent('ev_TEST1', 'AS-1: backlog → in_planning — by agent:x'), true);
  assert.equal(store.ingestEvent('ev_TEST1', 'AS-1: backlog → in_planning — by agent:x'), false);
  const chan = store.getChannelByName('lattice-events');
  assert.equal(store.getMessages(chan.id, 'human:forrest').messages.length, 1);
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
    ['conversation_members', 'conversations', 'identities', 'ingested_events', 'messages', 'read_state']
  );
  for (const line of lines) assert.doesNotThrow(() => JSON.parse(line));
});

// --- AS-6: hidden #board channel ------------------------------------------

/** Register the canonical non-member used across the AS-6 tests. */
function withNonMember(store) {
  store.registerIdentity({
    id: 'agent:developer-marcus',
    displayName: 'Marcus Webb (Engineer)',
    kind: 'agent',
  });
  return 'agent:developer-marcus';
}

test('AS-6: #board is invisible to non-members on every store read path', (t) => {
  const { store } = tempStore(t);
  const N = withNonMember(store);
  const board = store.getChannelByName('board');

  // listConversationsFor: absent for N, present for members.
  assert.ok(!store.listConversationsFor(N).some((c) => c.name === 'board' || c.id === board.id));
  assert.ok(store.listConversationsFor('agent:ceo-carla').some((c) => c.name === 'board'));

  // getChannelVisibleTo: hidden resolves like nonexistent (undefined).
  assert.equal(store.getChannelVisibleTo('board', N), undefined);
  assert.equal(store.getChannelVisibleTo('no-such-channel', N), undefined);
  assert.equal(store.getChannelVisibleTo('board', 'human:forrest').id, board.id);

  // Board traffic never reaches N's inbox, even unread.
  store.postMessage({ conversation: board.id, author: 'human:forrest', body: 'board business' });
  assert.ok(!store.unreadFor(N).some((g) => g.conversationId === board.id));
  // …but members do see it as unread.
  assert.ok(store.unreadFor('agent:ceo-carla').some((g) => g.conversationId === board.id));

  // catchupAll for N completes without touching board (its read_state stays empty).
  store.catchupAll(N);
  assert.ok(!store.unreadFor(N).some((g) => g.conversationId === board.id));

  // Members can post, thread-reply, read, and their unread counts include board.
  const root = store.postMessage({ conversation: board.id, author: 'agent:cto-owen', body: 'agenda' });
  const reply = store.postMessage({
    conversation: board.id, author: 'agent:ceo-carla', body: 'noted', threadRoot: root.id,
  });
  assert.equal(reply.threadRootId, root.id);
  assert.ok(store.unreadCountFor('human:forrest', board.id) > 0);
  store.markRead('human:forrest', board.id);
  assert.equal(store.unreadCountFor('human:forrest', board.id), 0);
  const view = store.getMessages(board.id, 'human:forrest');
  assert.equal(view.messages.length, 2, 'two top-level board messages');
  assert.deepEqual(view.threads[root.id].map((m) => m.id), [reply.id]);
});

test('AS-6: hidden probes fail byte-identically to nonexistent ones (same template, same code)', (t) => {
  const { store } = tempStore(t);
  const N = withNonMember(store);
  const board = store.getChannelByName('board');
  const bogusId = 99999;

  const grab = (fn) => {
    try {
      fn();
      assert.fail('expected a throw');
    } catch (e) {
      assert.ok(e instanceof StoreError);
      return e;
    }
  };
  // The message template echoes the probed id (which the prober already
  // knows); parity = identical code + identical message modulo that echo.
  const normalize = (msg, id) => msg.replaceAll(`'${id}'`, "'<id>'");
  const checkPair = (probe) => {
    const hidden = grab(() => probe(board.id));
    const missing = grab(() => probe(bogusId));
    assert.equal(hidden.code, 'unknown_conversation');
    assert.equal(missing.code, 'unknown_conversation');
    assert.equal(hidden.message, `Unknown conversation '${board.id}'.`);
    assert.equal(normalize(hidden.message, board.id), normalize(missing.message, bogusId));
  };
  checkPair((id) => store.getMessages(id, N));
  checkPair((id) => store.postMessage({ conversation: id, author: N, body: 'probe' }));
  // Even a malformed probe (empty body) must not leak existence via a
  // different error class.
  checkPair((id) => store.postMessage({ conversation: id, author: N, body: '' }));
  checkPair((id) => store.markRead(N, id));

  // DM semantics unchanged: non-member of a DM still gets 403-style 'forbidden'.
  const dm = store.openDm('human:forrest', 'agent:cto-owen');
  const dmErr = grab(() => store.postMessage({ conversation: dm.id, author: N, body: 'hi' }));
  assert.equal(dmErr.code, 'forbidden');
});

test('AS-6: name collision with a hidden channel is uninformative; visible collision unchanged', (t) => {
  const { store } = tempStore(t);
  const N = withNonMember(store);
  // Non-member: deliberately vague — must not confirm the channel exists.
  const hiddenErr = (() => {
    try { store.createChannel({ name: 'board', actor: N }); } catch (e) { return e; }
  })();
  assert.equal(hiddenErr.code, 'conflict');
  assert.equal(hiddenErr.message, "Channel name 'board' is unavailable.");
  assert.ok(!/exist/i.test(hiddenErr.message));
  // Member: the ordinary collision message.
  assert.throws(() => store.createChannel({ name: 'board', actor: 'human:forrest' }), /already exists/);
  // Public collision unchanged for everyone.
  assert.throws(() => store.createChannel({ name: 'engineering', actor: N }), /already exists/);
});

test('AS-6: createChannel supports private channels at store level, with validation', (t) => {
  const { store } = tempStore(t);
  const N = withNonMember(store);
  // Validation: private requires members, including the actor; members must exist.
  assert.throws(
    () => store.createChannel({ name: 'sec', actor: 'human:forrest', visibility: 'private' }),
    /non-empty members list/
  );
  assert.throws(
    () => store.createChannel({
      name: 'sec', actor: 'human:forrest', visibility: 'private', members: ['agent:cto-owen'],
    }),
    /must include the creating actor/
  );
  assert.throws(
    () => store.createChannel({
      name: 'sec', actor: 'human:forrest', visibility: 'private',
      members: ['human:forrest', 'agent:ghost'],
    }),
    /Unknown identity/
  );
  assert.throws(
    () => store.createChannel({ name: 'sec', actor: 'human:forrest', visibility: 'sneaky' }),
    /Invalid visibility/
  );
  // Happy path: members gate visibility exactly like #board.
  const sec = store.createChannel({
    name: 'sec', actor: 'human:forrest', visibility: 'private',
    members: ['human:forrest', 'agent:cto-owen'],
  });
  assert.equal(sec.visibility, 'private');
  assert.deepEqual(store.dmMembers(sec.id), ['agent:cto-owen', 'human:forrest']);
  assert.ok(store.listConversationsFor('agent:cto-owen').some((c) => c.name === 'sec'));
  assert.ok(!store.listConversationsFor(N).some((c) => c.name === 'sec'));
  assert.ok(!store.listConversationsFor('agent:ceo-carla').some((c) => c.name === 'sec'));
});

test('AS-6: founders are re-seeded into #board on every open (lockout-proof)', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'chat-store-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'chat.db');
  let store = openStore(path);
  const boardId = store.getChannelByName('board').id;
  store.close();
  // Sabotage membership directly in the DB (the raw-access tier).
  const raw = new DatabaseSync(path);
  raw.exec(`DELETE FROM conversation_members WHERE conversation_id = ${boardId}`);
  raw.close();
  // Re-open: the seed restores exactly the three founders.
  store = openStore(path);
  assert.deepEqual(store.dmMembers(boardId), ['agent:ceo-carla', 'agent:cto-owen', 'human:forrest']);
  store.close();
});

test('AS-6: lattice ingestion only ever posts to #lattice-events, never #board', (t) => {
  const { store } = tempStore(t);
  const board = store.getChannelByName('board');
  const before = store.getMessages(board.id, 'human:forrest').messages.length;
  store.ingestEvent('ev_BOARD_PROBE', 'AS-6: planned → in_progress — by agent:developer-marcus');
  assert.equal(store.getMessages(board.id, 'human:forrest').messages.length, before);
  const events = store.getChannelByName('lattice-events');
  const msgs = store.getMessages(events.id, 'human:forrest').messages;
  assert.equal(msgs.at(-1).body, 'AS-6: planned → in_progress — by agent:developer-marcus');
});

// --- AS-6: v0 -> v1 migration ----------------------------------------------

// The pre-AS-6 schema, verbatim from git history (store.js at c002d75).
const V0_SCHEMA = `
CREATE TABLE IF NOT EXISTS identities (
  id           TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('human','agent','system')),
  created_at   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS conversations (
  id          INTEGER PRIMARY KEY,
  type        TEXT NOT NULL CHECK (type IN ('channel','dm')),
  name        TEXT UNIQUE,
  purpose     TEXT,
  dm_key      TEXT UNIQUE,
  created_by  TEXT NOT NULL REFERENCES identities(id),
  created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS dm_members (
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  identity_id     TEXT NOT NULL REFERENCES identities(id),
  PRIMARY KEY (conversation_id, identity_id)
);
CREATE TABLE IF NOT EXISTS messages (
  id              INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  thread_root_id  INTEGER REFERENCES messages(id),
  author_id       TEXT NOT NULL REFERENCES identities(id),
  body            TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, id);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_root_id);
CREATE TABLE IF NOT EXISTS read_state (
  identity_id     TEXT NOT NULL REFERENCES identities(id),
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  last_read_id    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (identity_id, conversation_id)
);
CREATE TABLE IF NOT EXISTS ingested_events (
  event_id    TEXT PRIMARY KEY,
  ingested_at TEXT NOT NULL
);
`;

/** Hand-build a realistic v0 database: channels, a DM with members, messages,
 *  read_state, ingested_events — PRAGMA user_version left at 0. */
function buildV0Db(path) {
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA journal_mode=WAL');
  raw.exec(V0_SCHEMA);
  raw.exec(`
    INSERT INTO identities (id, display_name, kind, created_at) VALUES
      ('human:forrest', 'Forrest (Investor)', 'human', '2026-08-29T00:00:00.000Z'),
      ('agent:ceo-carla', 'Carla Voss (CEO)', 'agent', '2026-08-29T00:00:00.000Z'),
      ('agent:cto-owen', 'Owen Kessler (CTO)', 'agent', '2026-08-29T00:00:00.000Z'),
      ('system:lattice', 'Lattice', 'system', '2026-08-29T00:00:00.000Z'),
      ('agent:developer-marcus', 'Marcus Webb (Engineer)', 'agent', '2026-08-29T12:00:00.000Z');
    INSERT INTO conversations (id, type, name, purpose, dm_key, created_by, created_at) VALUES
      (1, 'channel', 'announcements', 'Company-wide announcements', NULL, 'system:lattice', '2026-08-29T00:00:00.000Z'),
      (2, 'channel', 'engineering', 'Engineering discussion', NULL, 'system:lattice', '2026-08-29T00:00:00.000Z'),
      (3, 'channel', 'lattice-events', 'Automated feed of Lattice task events; read-only by convention', NULL, 'system:lattice', '2026-08-29T00:00:00.000Z'),
      (4, 'dm', NULL, NULL, 'agent:cto-owen|human:forrest', 'human:forrest', '2026-08-29T01:00:00.000Z');
    INSERT INTO dm_members (conversation_id, identity_id) VALUES
      (4, 'agent:cto-owen'), (4, 'human:forrest');
    INSERT INTO messages (id, conversation_id, thread_root_id, author_id, body, created_at) VALUES
      (1, 2, NULL, 'human:forrest', 'pre-migration channel message', '2026-08-29T02:00:00.000Z'),
      (2, 4, NULL, 'human:forrest', 'pre-migration dm message', '2026-08-29T03:00:00.000Z'),
      (3, 2, 1, 'agent:cto-owen', 'pre-migration thread reply', '2026-08-29T04:00:00.000Z');
    INSERT INTO read_state (identity_id, conversation_id, last_read_id) VALUES
      ('agent:cto-owen', 2, 3);
    INSERT INTO ingested_events (event_id, ingested_at) VALUES
      ('ev_V0', '2026-08-29T05:00:00.000Z');
  `);
  raw.close();
}

test('AS-6: v0 database migrates in place to v1, preserving all data; re-open is a no-op', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'chat-migrate-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'chat.db');
  buildV0Db(path);

  let store = openStore(path);
  // Structural: version bumped, dm_members gone, conversation_members present.
  const raw1 = new DatabaseSync(path);
  assert.equal(Number(raw1.prepare('PRAGMA user_version').get().user_version), 1);
  const tables = raw1
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((r) => r.name);
  assert.ok(!tables.includes('dm_members'), 'legacy dm_members dropped');
  assert.ok(tables.includes('conversation_members'));
  raw1.close();

  // Data preserved: conversations, messages (incl. thread link), DM members, read_state.
  assert.equal(store.getMessage(1).body, 'pre-migration channel message');
  assert.equal(store.getMessage(3).threadRootId, 1);
  const dm = store.getConversation(4);
  assert.equal(dm.type, 'dm');
  assert.equal(dm.visibility, 'private', 'existing DMs become private');
  assert.deepEqual(store.dmMembers(4), ['agent:cto-owen', 'human:forrest']);
  assert.equal(store.getConversation(2).visibility, 'public', 'existing channels stay public');
  assert.equal(store.unreadCountFor('agent:cto-owen', 2), 0, 'read_state carried over');
  assert.equal(store.hasIngested('ev_V0'), true);

  // #board seeded private with exactly the three founders; hidden from the
  // pre-existing non-founder identity.
  const board = store.getChannelByName('board');
  assert.equal(board.visibility, 'private');
  assert.deepEqual(store.dmMembers(board.id), ['agent:ceo-carla', 'agent:cto-owen', 'human:forrest']);
  assert.ok(!store.listConversationsFor('agent:developer-marcus').some((c) => c.name === 'board'));

  // Old data still flows through the visibility predicate correctly.
  assert.ok(store.listConversationsFor('human:forrest').some((c) => c.id === 4));
  assert.ok(!store.listConversationsFor('agent:ceo-carla').some((c) => c.id === 4));

  const snapshot = store.dumpLines();
  store.close();

  // Second open: a pure no-op (idempotent migration + idempotent seeds).
  store = openStore(path);
  assert.deepEqual(store.dumpLines(), snapshot);
  const raw2 = new DatabaseSync(path);
  assert.equal(Number(raw2.prepare('PRAGMA user_version').get().user_version), 1);
  raw2.close();
  store.close();
});

// --- AS-7 sentinel: last-human-message.json ---------------------------------

test('AS-7 sentinel: human post writes last-human-message.json; later human post overwrites', (t) => {
  const { store, dir } = tempStore(t);
  const sentinelPath = join(dir, 'last-human-message.json');
  assert.ok(!existsSync(sentinelPath), 'no sentinel before any human post');

  const eng = store.getChannelByName('engineering');
  const m1 = store.postMessage({ conversation: eng.id, author: 'human:forrest', body: 'first' });
  assert.ok(existsSync(sentinelPath));
  assert.deepEqual(JSON.parse(readFileSync(sentinelPath, 'utf8')), {
    messageId: m1.id,
    authorId: 'human:forrest',
    conversationId: eng.id,
    createdAt: m1.createdAt,
  });
  assert.ok(!existsSync(sentinelPath + '.tmp'), 'tmp file renamed away');

  const m2 = store.postMessage({ conversation: eng.id, author: 'human:forrest', body: 'second' });
  assert.ok(m2.id > m1.id);
  assert.equal(JSON.parse(readFileSync(sentinelPath, 'utf8')).messageId, m2.id);
});

test('AS-7 sentinel: agent and system authors (incl. ingestEvent) never touch it', (t) => {
  const { store, dir } = tempStore(t);
  const sentinelPath = join(dir, 'last-human-message.json');
  const eng = store.getChannelByName('engineering');

  store.postMessage({ conversation: eng.id, author: 'agent:cto-owen', body: 'agent post' });
  assert.ok(!existsSync(sentinelPath), 'agent post writes no sentinel');
  const events = store.getChannelByName('lattice-events');
  store.postMessage({ conversation: events.id, author: 'system:lattice', body: 'system post' });
  assert.ok(!existsSync(sentinelPath), 'system post writes no sentinel');
  store.ingestEvent('ev_sentinel_1', 'ingested event');
  assert.ok(!existsSync(sentinelPath), 'ingestEvent writes no sentinel');

  // Existing sentinel is left unchanged by subsequent non-human traffic.
  const human = store.postMessage({ conversation: eng.id, author: 'human:forrest', body: 'hi' });
  store.postMessage({ conversation: eng.id, author: 'agent:cto-owen', body: 'reply-ish' });
  store.ingestEvent('ev_sentinel_2', 'another event');
  assert.equal(JSON.parse(readFileSync(sentinelPath, 'utf8')).messageId, human.id);
});

test('AS-7 sentinel: a human thread reply updates it (any human message counts)', (t) => {
  const { store, dir } = tempStore(t);
  const sentinelPath = join(dir, 'last-human-message.json');
  const eng = store.getChannelByName('engineering');
  const root = store.postMessage({ conversation: eng.id, author: 'agent:cto-owen', body: 'root' });
  assert.ok(!existsSync(sentinelPath));
  const reply = store.postMessage({
    conversation: eng.id,
    author: 'human:forrest',
    body: 'thread reply',
    threadRoot: root.id,
  });
  const sentinel = JSON.parse(readFileSync(sentinelPath, 'utf8'));
  assert.equal(sentinel.messageId, reply.id);
  assert.equal(sentinel.authorId, 'human:forrest');
  assert.equal(sentinel.conversationId, eng.id);
});

test('AS-7 sentinel: :memory: store never writes; a failing write never fails the post', (t) => {
  // :memory: — no data dir, no sentinel attempt (cwd stays clean).
  const mem = openStore(':memory:');
  t.after(() => mem.close());
  const eng = mem.getChannelByName('engineering');
  const posted = mem.postMessage({ conversation: eng.id, author: 'human:forrest', body: 'in memory' });
  assert.ok(posted.id > 0);
  assert.ok(!existsSync('last-human-message.json'), ':memory: store wrote no sentinel in cwd');

  // Failure injection: squat the tmp path with a directory so writeFileSync
  // throws EISDIR inside writeHumanSentinel. The post must still succeed.
  const { store, dir } = tempStore(t);
  const sentinelPath = join(dir, 'last-human-message.json');
  mkdirSync(sentinelPath + '.tmp');
  const eng2 = store.getChannelByName('engineering');
  const msg = store.postMessage({ conversation: eng2.id, author: 'human:forrest', body: 'still posts' });
  assert.equal(store.getMessage(msg.id).body, 'still posts');
  assert.ok(!existsSync(sentinelPath), 'sentinel absent after injected write failure');
});
