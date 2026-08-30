// lib/store.js — all domain logic for the chat app (AS-2).
// Single SQLite store via node:sqlite. Both the HTTP server and the CLI go
// through this module; no SQL lives anywhere else (portability seam per plan §8).

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
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

const SEED_IDENTITIES = [
  { id: 'human:forrest', displayName: 'Forrest (Investor)', kind: 'human' },
  { id: 'agent:ceo-carla', displayName: 'Carla Voss (CEO)', kind: 'agent' },
  { id: 'agent:cto-owen', displayName: 'Owen Kessler (CTO)', kind: 'agent' },
  { id: 'system:lattice', displayName: 'Lattice', kind: 'system' },
];

const SEED_CHANNELS = [
  { name: 'announcements', purpose: 'Company-wide announcements' },
  { name: 'engineering', purpose: 'Engineering discussion' },
  {
    name: 'lattice-events',
    purpose: 'Automated feed of Lattice task events; read-only by convention',
  },
];

export const EVENTS_CHANNEL = 'lattice-events';
export const SYSTEM_IDENTITY = 'system:lattice';

/** Error whose message is safe to show to the caller (maps to HTTP 4xx). */
export class StoreError extends Error {
  constructor(message, code = 'bad_request') {
    super(message);
    this.code = code;
  }
}

function nowIso() {
  return new Date().toISOString();
}

export function dmKeyFor(a, b) {
  return [a, b].sort().join('|');
}

export function openStore(dbPath) {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode=WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(SCHEMA);

  function tx(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  // --- identities ---------------------------------------------------------

  function getIdentity(id) {
    return db
      .prepare('SELECT id, display_name AS displayName, kind, created_at AS createdAt FROM identities WHERE id = ?')
      .get(id);
  }

  function requireIdentity(id) {
    const row = getIdentity(id);
    if (!row) {
      throw new StoreError(
        `Unknown identity '${id}'. Register it first (chat register / POST /api/identities).`,
        'unknown_identity'
      );
    }
    return row;
  }

  function listIdentities() {
    return db
      .prepare('SELECT id, display_name AS displayName, kind, created_at AS createdAt FROM identities ORDER BY id')
      .all();
  }

  function registerIdentity({ id, displayName, kind }) {
    if (typeof id !== 'string' || !/^(human|agent|system):[a-z0-9][a-z0-9._-]*$/.test(id)) {
      throw new StoreError(
        `Invalid identity id '${id}'. Expected '<kind>:<name>' like 'agent:developer-marcus' (lowercase).`
      );
    }
    if (!['human', 'agent', 'system'].includes(kind)) {
      throw new StoreError(`Invalid kind '${kind}'. Must be one of: human, agent, system.`);
    }
    if (!id.startsWith(kind + ':')) {
      throw new StoreError(`Identity id '${id}' must start with its kind prefix '${kind}:'.`);
    }
    if (typeof displayName !== 'string' || displayName.trim() === '') {
      throw new StoreError('displayName must be a non-empty string.');
    }
    if (getIdentity(id)) {
      throw new StoreError(`Identity '${id}' already exists.`, 'conflict');
    }
    db.prepare('INSERT INTO identities (id, display_name, kind, created_at) VALUES (?, ?, ?, ?)').run(
      id,
      displayName.trim(),
      kind,
      nowIso()
    );
    return getIdentity(id);
  }

  // --- conversations ------------------------------------------------------

  function getConversation(id) {
    return db
      .prepare(
        `SELECT id, type, name, purpose, dm_key AS dmKey, created_by AS createdBy, created_at AS createdAt
         FROM conversations WHERE id = ?`
      )
      .get(id);
  }

  function requireConversation(id) {
    const row = getConversation(Number(id));
    if (!row) throw new StoreError(`Unknown conversation '${id}'.`, 'unknown_conversation');
    return row;
  }

  function getChannelByName(name) {
    return db
      .prepare(
        `SELECT id, type, name, purpose, dm_key AS dmKey, created_by AS createdBy, created_at AS createdAt
         FROM conversations WHERE type = 'channel' AND name = ?`
      )
      .get(name);
  }

  function createChannel({ name, purpose, actor }) {
    requireIdentity(actor);
    if (typeof name !== 'string' || !/^[a-z0-9-]+$/.test(name)) {
      throw new StoreError(
        `Invalid channel name '${name}'. Use lowercase letters, digits, and hyphens only (e.g. 'engineering').`
      );
    }
    if (getChannelByName(name)) {
      throw new StoreError(`Channel '${name}' already exists.`, 'conflict');
    }
    db.prepare(
      `INSERT INTO conversations (type, name, purpose, created_by, created_at) VALUES ('channel', ?, ?, ?, ?)`
    ).run(name, purpose ?? null, actor, nowIso());
    return getChannelByName(name);
  }

  function dmMembers(conversationId) {
    return db
      .prepare('SELECT identity_id FROM dm_members WHERE conversation_id = ? ORDER BY identity_id')
      .all(conversationId)
      .map((r) => r.identity_id);
  }

  function isDmMember(conversationId, identityId) {
    return !!db
      .prepare('SELECT 1 FROM dm_members WHERE conversation_id = ? AND identity_id = ?')
      .get(conversationId, identityId);
  }

  function openDm(me, other) {
    requireIdentity(me);
    requireIdentity(other);
    if (me === other) throw new StoreError('Cannot open a DM with yourself.');
    const key = dmKeyFor(me, other);
    const existing = db
      .prepare(
        `SELECT id, type, name, purpose, dm_key AS dmKey, created_by AS createdBy, created_at AS createdAt
         FROM conversations WHERE dm_key = ?`
      )
      .get(key);
    if (existing) return { ...existing, members: dmMembers(existing.id) };
    return tx(() => {
      db.prepare(
        `INSERT INTO conversations (type, dm_key, created_by, created_at) VALUES ('dm', ?, ?, ?)`
      ).run(key, me, nowIso());
      const conv = db
        .prepare(
          `SELECT id, type, name, purpose, dm_key AS dmKey, created_by AS createdBy, created_at AS createdAt
           FROM conversations WHERE dm_key = ?`
        )
        .get(key);
      const ins = db.prepare('INSERT INTO dm_members (conversation_id, identity_id) VALUES (?, ?)');
      ins.run(conv.id, me);
      ins.run(conv.id, other);
      return { ...conv, members: dmMembers(conv.id) };
    });
  }

  function requireVisible(conversation, identityId) {
    if (conversation.type === 'dm' && !isDmMember(conversation.id, identityId)) {
      throw new StoreError(`Identity '${identityId}' is not a member of that DM.`, 'forbidden');
    }
  }

  function unreadCountFor(me, conversationId) {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n FROM messages m
         WHERE m.conversation_id = ?
           AND m.author_id != ?
           AND m.id > COALESCE(
             (SELECT last_read_id FROM read_state WHERE identity_id = ? AND conversation_id = ?), 0)`
      )
      .get(conversationId, me, me, conversationId);
    return Number(row.n);
  }

  function listConversationsFor(me) {
    requireIdentity(me);
    const channels = db
      .prepare(
        `SELECT id, type, name, purpose, dm_key AS dmKey, created_by AS createdBy, created_at AS createdAt
         FROM conversations WHERE type = 'channel' ORDER BY name`
      )
      .all();
    const dms = db
      .prepare(
        `SELECT c.id, c.type, c.name, c.purpose, c.dm_key AS dmKey, c.created_by AS createdBy, c.created_at AS createdAt
         FROM conversations c
         JOIN dm_members dm ON dm.conversation_id = c.id
         WHERE c.type = 'dm' AND dm.identity_id = ?
         ORDER BY c.id`
      )
      .all(me);
    return [...channels, ...dms].map((c) => ({
      ...c,
      members: c.type === 'dm' ? dmMembers(c.id) : undefined,
      unread: unreadCountFor(me, c.id),
    }));
  }

  // --- messages / threads -------------------------------------------------

  function getMessage(id) {
    return db
      .prepare(
        `SELECT id, conversation_id AS conversationId, thread_root_id AS threadRootId,
                author_id AS authorId, body, created_at AS createdAt
         FROM messages WHERE id = ?`
      )
      .get(Number(id));
  }

  function postMessage({ conversation, author, body, threadRoot }) {
    requireIdentity(author);
    const conv = requireConversation(conversation);
    if (typeof body !== 'string' || body.trim() === '') {
      throw new StoreError('Message body must be a non-empty string.');
    }
    if (conv.type === 'dm' && !isDmMember(conv.id, author)) {
      throw new StoreError(`Identity '${author}' is not a member of that DM.`, 'forbidden');
    }
    let rootId = null;
    if (threadRoot != null) {
      const root = getMessage(threadRoot);
      if (!root) throw new StoreError(`Unknown thread root message '${threadRoot}'.`);
      if (root.conversationId !== conv.id) {
        throw new StoreError(
          `Message ${threadRoot} belongs to a different conversation; thread replies stay in their conversation.`
        );
      }
      // Threads do not nest: a reply to a reply attaches to the top-level root.
      rootId = root.threadRootId ?? root.id;
    }
    if (conv.name === EVENTS_CHANNEL && rootId === null && author !== SYSTEM_IDENTITY) {
      throw new StoreError(
        `Only ${SYSTEM_IDENTITY} posts top-level messages in #${EVENTS_CHANNEL}; reply in a thread instead.`,
        'forbidden'
      );
    }
    return tx(() => {
      db.prepare(
        `INSERT INTO messages (conversation_id, thread_root_id, author_id, body, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(conv.id, rootId, author, body, nowIso());
      const id = db.prepare('SELECT last_insert_rowid() AS id').get().id;
      return getMessage(Number(id));
    });
  }

  function getMessages(conversation, { limit } = {}) {
    const conv = requireConversation(conversation);
    let topLevel = db
      .prepare(
        `SELECT m.id, m.conversation_id AS conversationId, m.thread_root_id AS threadRootId,
                m.author_id AS authorId, m.body, m.created_at AS createdAt,
                (SELECT COUNT(*) FROM messages r WHERE r.thread_root_id = m.id) AS replyCount
         FROM messages m
         WHERE m.conversation_id = ? AND m.thread_root_id IS NULL
         ORDER BY m.id`
      )
      .all(conv.id)
      .map((m) => ({ ...m, replyCount: Number(m.replyCount) }));
    if (limit != null && topLevel.length > limit) topLevel = topLevel.slice(-limit);
    const replies = db
      .prepare(
        `SELECT id, conversation_id AS conversationId, thread_root_id AS threadRootId,
                author_id AS authorId, body, created_at AS createdAt
         FROM messages
         WHERE conversation_id = ? AND thread_root_id IS NOT NULL
         ORDER BY id`
      )
      .all(conv.id);
    const threads = {};
    for (const r of replies) {
      (threads[r.threadRootId] ??= []).push(r);
    }
    return { conversation: conv, messages: topLevel, threads };
  }

  function maxMessageId(conversationId) {
    const row = db
      .prepare('SELECT COALESCE(MAX(id), 0) AS maxId FROM messages WHERE conversation_id = ?')
      .get(conversationId);
    return Number(row.maxId);
  }

  // --- read-state / unread ------------------------------------------------

  function markRead(me, conversation, upTo) {
    requireIdentity(me);
    const conv = requireConversation(conversation);
    requireVisible(conv, me);
    const target = upTo == null ? maxMessageId(conv.id) : Number(upTo);
    if (!Number.isInteger(target) || target < 0) {
      throw new StoreError(`Invalid upTo '${upTo}'.`);
    }
    tx(() => {
      db.prepare(
        `INSERT INTO read_state (identity_id, conversation_id, last_read_id) VALUES (?, ?, ?)
         ON CONFLICT (identity_id, conversation_id)
         DO UPDATE SET last_read_id = MAX(last_read_id, excluded.last_read_id)`
      ).run(me, conv.id, target);
    });
    return { conversation: conv.id, lastReadId: target };
  }

  function catchupAll(me) {
    requireIdentity(me);
    const convs = listConversationsFor(me);
    for (const c of convs) markRead(me, c.id);
    return convs.length;
  }

  /**
   * "What's new for me": every message X hasn't read, in a conversation
   * visible to X, not authored by X. Grouped by conversation, ordered by id.
   */
  function unreadFor(me) {
    requireIdentity(me);
    const rows = db
      .prepare(
        `SELECT m.id, m.conversation_id AS conversationId, m.thread_root_id AS threadRootId,
                m.author_id AS authorId, m.body, m.created_at AS createdAt,
                c.type AS convType, c.name AS convName, c.dm_key AS dmKey
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         WHERE m.author_id != ?
           AND m.id > COALESCE(
             (SELECT last_read_id FROM read_state
              WHERE identity_id = ? AND conversation_id = m.conversation_id), 0)
           AND (c.type = 'channel'
                OR EXISTS (SELECT 1 FROM dm_members dm
                           WHERE dm.conversation_id = c.id AND dm.identity_id = ?))
         ORDER BY m.conversation_id, m.id`
      )
      .all(me, me, me);
    const groups = [];
    let current = null;
    for (const r of rows) {
      if (!current || current.conversationId !== r.conversationId) {
        current = {
          conversationId: r.conversationId,
          type: r.convType,
          name: r.convName,
          dmKey: r.dmKey,
          members: r.convType === 'dm' ? dmMembers(r.conversationId) : undefined,
          messages: [],
        };
        groups.push(current);
      }
      current.messages.push({
        id: r.id,
        conversationId: r.conversationId,
        threadRootId: r.threadRootId,
        authorId: r.authorId,
        body: r.body,
        createdAt: r.createdAt,
      });
    }
    return groups;
  }

  // --- lattice event ingestion primitives ---------------------------------

  function hasIngested(eventId) {
    return !!db.prepare('SELECT 1 FROM ingested_events WHERE event_id = ?').get(eventId);
  }

  /** Record an event id and post its message to lattice-events, atomically. */
  function ingestEvent(eventId, body) {
    if (hasIngested(eventId)) return false;
    const chan = getChannelByName(EVENTS_CHANNEL);
    tx(() => {
      db.prepare('INSERT INTO ingested_events (event_id, ingested_at) VALUES (?, ?)').run(
        eventId,
        nowIso()
      );
      db.prepare(
        `INSERT INTO messages (conversation_id, thread_root_id, author_id, body, created_at)
         VALUES (?, NULL, ?, ?, ?)`
      ).run(chan.id, SYSTEM_IDENTITY, body, nowIso());
    });
    return true;
  }

  // --- dump ---------------------------------------------------------------

  /** Whole store as deterministic JSONL lines (backup/debug/migration). */
  function dumpLines() {
    const lines = [];
    const tables = [
      ['identities', 'SELECT * FROM identities ORDER BY id'],
      ['conversations', 'SELECT * FROM conversations ORDER BY id'],
      ['dm_members', 'SELECT * FROM dm_members ORDER BY conversation_id, identity_id'],
      ['messages', 'SELECT * FROM messages ORDER BY id'],
      ['read_state', 'SELECT * FROM read_state ORDER BY identity_id, conversation_id'],
      ['ingested_events', 'SELECT * FROM ingested_events ORDER BY event_id'],
    ];
    for (const [table, sql] of tables) {
      for (const row of db.prepare(sql).all()) {
        // node:sqlite returns INTEGER as number here (values are small); normalize BigInt just in case.
        const clean = {};
        for (const [k, v] of Object.entries(row)) clean[k] = typeof v === 'bigint' ? Number(v) : v;
        lines.push(JSON.stringify({ table, row: clean }));
      }
    }
    return lines;
  }

  // --- seeding ------------------------------------------------------------

  tx(() => {
    const now = nowIso();
    const insId = db.prepare(
      'INSERT OR IGNORE INTO identities (id, display_name, kind, created_at) VALUES (?, ?, ?, ?)'
    );
    for (const s of SEED_IDENTITIES) insId.run(s.id, s.displayName, s.kind, now);
    const insChan = db.prepare(
      `INSERT OR IGNORE INTO conversations (type, name, purpose, created_by, created_at)
       VALUES ('channel', ?, ?, 'system:lattice', ?)`
    );
    for (const c of SEED_CHANNELS) insChan.run(c.name, c.purpose, now);
  });

  return {
    close: () => db.close(),
    listIdentities,
    getIdentity,
    requireIdentity,
    registerIdentity,
    createChannel,
    getChannelByName,
    getConversation,
    requireConversation,
    openDm,
    dmMembers,
    listConversationsFor,
    postMessage,
    getMessage,
    getMessages,
    maxMessageId,
    markRead,
    catchupAll,
    unreadFor,
    unreadCountFor,
    hasIngested,
    ingestEvent,
    dumpLines,
  };
}
