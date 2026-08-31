// lib/store.js — all domain logic for the chat app (AS-2).
// Single SQLite store via node:sqlite. Both the HTTP server and the CLI go
// through this module; no SQL lives anywhere else (portability seam per plan §8).

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Schema v1 (AS-6): conversations carry visibility; dm_members generalized to
// conversation_members. v0 DBs (pre-AS-6) are migrated in place in openStore,
// gated on PRAGMA user_version.
const SCHEMA_VERSION = 1;

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
  visibility  TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private')),
  created_by  TEXT NOT NULL REFERENCES identities(id),
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversation_members (
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
  { id: 'human:forrest', displayName: 'Forrest (Board)', kind: 'human' },
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
  // AS-6 board decision: #board is private and HIDDEN from non-members on
  // every surface. Membership is seed-defined (no mutation API exists);
  // founders are re-added on every open so they can never be locked out.
  {
    name: 'board',
    purpose: 'Board & founders. Restricted: visible to members only.',
    visibility: 'private',
    members: ['human:forrest', 'agent:ceo-carla', 'agent:cto-owen'],
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

/**
 * dm_key -> filesystem-safe export filename fragment (AS-5): ':' -> '~',
 * '|' -> '~~'. The identity alphabet ([a-z0-9._-] plus kind prefixes)
 * contains neither '~', ':' nor '|', and ':' is never adjacent to '|' in a
 * valid dm_key, so the mapping is injective — distinct DMs never collide.
 */
function dmExportName(dmKey) {
  return dmKey.replaceAll('|', '~~').replaceAll(':', '~');
}

export function openStore(dbPath) {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode=WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA foreign_keys=ON');

  // --- schema versioning & in-place migration (AS-6) -----------------------
  // v0 (pre-AS-6): dm_members table, no conversations.visibility.
  // v1: conversation_members + visibility. Idempotent by construction: the
  // whole migration runs inside one BEGIN IMMEDIATE tx, gated on user_version
  // (re-checked under the write lock, so a concurrent open can't double-run).
  const userVersion = () => Number(db.prepare('PRAGMA user_version').get().user_version);
  if (userVersion() < SCHEMA_VERSION) {
    db.exec('BEGIN IMMEDIATE');
    try {
      if (userVersion() < SCHEMA_VERSION) {
        db.exec(SCHEMA); // fresh DBs get v1 directly (CREATE IF NOT EXISTS)
        const hasTable = (name) =>
          !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
        if (hasTable('dm_members')) {
          db.exec(
            'INSERT OR IGNORE INTO conversation_members (conversation_id, identity_id) SELECT conversation_id, identity_id FROM dm_members'
          );
          db.exec('DROP TABLE dm_members');
        }
        const convCols = db.prepare('PRAGMA table_info(conversations)').all().map((c) => c.name);
        if (!convCols.includes('visibility')) {
          db.exec(
            "ALTER TABLE conversations ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private'))"
          );
          db.exec("UPDATE conversations SET visibility = 'private' WHERE type = 'dm'");
        }
        db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  } else {
    db.exec(SCHEMA);
  }

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

  const CONV_COLS = `id, type, name, purpose, dm_key AS dmKey, visibility, created_by AS createdBy, created_at AS createdAt`;

  function getConversation(id) {
    return db.prepare(`SELECT ${CONV_COLS} FROM conversations WHERE id = ?`).get(id);
  }

  function requireConversation(id) {
    const row = getConversation(Number(id));
    if (!row) throw new StoreError(`Unknown conversation '${id}'.`, 'unknown_conversation');
    return row;
  }

  function getChannelByName(name) {
    return db
      .prepare(`SELECT ${CONV_COLS} FROM conversations WHERE type = 'channel' AND name = ?`)
      .get(name);
  }

  /**
   * Channel lookup through the visibility boundary (AS-6): returns the channel
   * only if `me` may see it — public, or private with `me` a member. A hidden
   * channel returns undefined, exactly like a nonexistent one. Every
   * name-addressed caller surface (CLI post/history/read/reply) goes through
   * this, never getChannelByName.
   */
  function getChannelVisibleTo(name, me) {
    return db
      .prepare(
        `SELECT ${CONV_COLS} FROM conversations c
         WHERE c.type = 'channel' AND c.name = ?
           AND (c.visibility = 'public' OR EXISTS (
             SELECT 1 FROM conversation_members cm
             WHERE cm.conversation_id = c.id AND cm.identity_id = ?))`
      )
      .get(name, me);
  }

  function createChannel({ name, purpose, actor, visibility = 'public', members = null }) {
    requireIdentity(actor);
    if (typeof name !== 'string' || !/^[a-z0-9-]+$/.test(name)) {
      throw new StoreError(
        `Invalid channel name '${name}'. Use lowercase letters, digits, and hyphens only (e.g. 'engineering').`
      );
    }
    if (!['public', 'private'].includes(visibility)) {
      throw new StoreError(`Invalid visibility '${visibility}'. Must be 'public' or 'private'.`);
    }
    // AS-24 (rule promoted from the AS-22 CLI preflight): a members list on a
    // non-private channel is an error at the store level, so the CLI and the
    // HTTP API enforce it identically. Silently ignoring members would create
    // the worst failure mode — a "restricted" channel that is actually public.
    if (visibility !== 'private' && members != null) {
      throw new StoreError("A members list requires visibility 'private'.");
    }
    if (visibility === 'private') {
      // Store-level only in AS-6: no CLI/HTTP/UI surface exposes these params.
      if (!Array.isArray(members) || members.length === 0) {
        throw new StoreError('Private channels require a non-empty members list.');
      }
      if (!members.includes(actor)) {
        throw new StoreError(`Private channel members must include the creating actor '${actor}'.`);
      }
      for (const m of members) requireIdentity(m);
    }
    const existing = getChannelByName(name);
    if (existing) {
      // Name collision against a channel hidden from the actor must not be an
      // existence proof: deliberately uninformative wording (name reserved vs
      // channel exists — indistinguishable). Documented residual one-bit leak.
      if (existing.visibility === 'private' && !isMember(existing.id, actor)) {
        throw new StoreError(`Channel name '${name}' is unavailable.`, 'conflict');
      }
      throw new StoreError(`Channel '${name}' already exists.`, 'conflict');
    }
    return tx(() => {
      db.prepare(
        `INSERT INTO conversations (type, name, purpose, visibility, created_by, created_at)
         VALUES ('channel', ?, ?, ?, ?, ?)`
      ).run(name, purpose ?? null, visibility, actor, nowIso());
      const chan = getChannelByName(name);
      if (visibility === 'private') {
        const ins = db.prepare(
          'INSERT OR IGNORE INTO conversation_members (conversation_id, identity_id) VALUES (?, ?)'
        );
        for (const m of members) ins.run(chan.id, m);
      }
      return chan;
    });
  }

  /** Members of a conversation (DMs always; private channels too). Name kept
   *  from the v0 API — reads conversation_members since AS-6. */
  function dmMembers(conversationId) {
    return db
      .prepare(
        'SELECT identity_id FROM conversation_members WHERE conversation_id = ? ORDER BY identity_id'
      )
      .all(conversationId)
      .map((r) => r.identity_id);
  }

  function isMember(conversationId, identityId) {
    return !!db
      .prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND identity_id = ?')
      .get(conversationId, identityId);
  }

  /** Existing DM conversation id for the pair, or null. Pure lookup by
   *  dm_key — never creates (AS-8 roster join; openDm stays the create path). */
  function dmConversationFor(me, other) {
    const row = db.prepare('SELECT id FROM conversations WHERE dm_key = ?').get(dmKeyFor(me, other));
    return row ? Number(row.id) : null;
  }

  function openDm(me, other) {
    requireIdentity(me);
    requireIdentity(other);
    if (me === other) throw new StoreError('Cannot open a DM with yourself.');
    const key = dmKeyFor(me, other);
    const existing = db.prepare(`SELECT ${CONV_COLS} FROM conversations WHERE dm_key = ?`).get(key);
    if (existing) return { ...existing, members: dmMembers(existing.id) };
    return tx(() => {
      db.prepare(
        `INSERT INTO conversations (type, dm_key, visibility, created_by, created_at)
         VALUES ('dm', ?, 'private', ?, ?)`
      ).run(key, me, nowIso());
      const conv = db.prepare(`SELECT ${CONV_COLS} FROM conversations WHERE dm_key = ?`).get(key);
      const ins = db.prepare(
        'INSERT INTO conversation_members (conversation_id, identity_id) VALUES (?, ?)'
      );
      ins.run(conv.id, me);
      ins.run(conv.id, other);
      return { ...conv, members: dmMembers(conv.id) };
    });
  }

  /**
   * One gate for every id-addressed read/write path (AS-6). Public: pass.
   * Private + member: pass. DM non-member: 403 'forbidden' (pre-AS-6
   * semantics, deliberately unchanged — the deterministic dm_key already
   * makes DM existence computable, so 403 proves nothing secret). Hidden
   * channel: 'unknown_conversation' with the byte-same message template as a
   * nonexistent id — never 403, which would be an existence proof. `ref` is
   * the caller-supplied conversation reference so the echoed id matches what
   * requireConversation would echo for a nonexistent one.
   */
  function requireVisible(conversation, identityId, ref = conversation.id) {
    if (conversation.visibility === 'public') return;
    if (isMember(conversation.id, identityId)) return;
    if (conversation.type === 'dm') {
      throw new StoreError(`Identity '${identityId}' is not a member of that DM.`, 'forbidden');
    }
    throw new StoreError(`Unknown conversation '${ref}'.`, 'unknown_conversation');
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
        `SELECT ${CONV_COLS} FROM conversations c
         WHERE c.type = 'channel'
           AND (c.visibility = 'public' OR EXISTS (
             SELECT 1 FROM conversation_members cm
             WHERE cm.conversation_id = c.id AND cm.identity_id = ?))
         ORDER BY c.name`
      )
      .all(me);
    const dms = db
      .prepare(
        `SELECT c.id, c.type, c.name, c.purpose, c.dm_key AS dmKey, c.visibility, c.created_by AS createdBy, c.created_at AS createdAt
         FROM conversations c
         JOIN conversation_members cm ON cm.conversation_id = c.id
         WHERE c.type = 'dm' AND cm.identity_id = ?
         ORDER BY c.id`
      )
      .all(me);
    return [...channels, ...dms].map((c) => ({
      ...c,
      members: c.type === 'dm' ? dmMembers(c.id) : undefined,
      unread: unreadCountFor(me, c.id),
    }));
  }

  // --- AS-7 sentinel: the container→host signal seam -----------------------
  // The one deliberate fs impurity in this otherwise fs-free module. On every
  // human-authored post, drop a tiny JSON marker in the data dir (bind-mounted
  // to the host) so the host-side advance watcher (apps/chat/watch/) can react
  // without touching chat.db. Lives here — not in the server — so the CLI
  // post path is covered too. tmp+rename keeps the write atomic (the watcher
  // can never read a torn file); any failure is swallowed because a sentinel
  // write failure must NEVER fail the post. Skipped for :memory: stores.
  const sentinelPath =
    dbPath === ':memory:' ? null : join(dirname(dbPath), 'last-human-message.json');

  function writeHumanSentinel(msg) {
    if (sentinelPath === null) return;
    // AS-13: unique tmp suffix (pid + random) — the server and CLI containers
    // share the bind-mounted data dir, and a fixed tmp name let two processes
    // interleave write/rename (spurious ENOENT on the loser's rename). This
    // fixes the tmp-file collision only: two processes can still rename in
    // either order, so the sentinel briefly holding the lower messageId stays
    // possible and stays fine (inbox sweep + sentinel > highwater re-trigger
    // deliver the message regardless).
    const tmp =
      sentinelPath + '.' + process.pid + '.' + Math.random().toString(36).slice(2) + '.tmp';
    try {
      writeFileSync(
        tmp,
        JSON.stringify({
          messageId: msg.id,
          authorId: msg.authorId,
          conversationId: msg.conversationId,
          createdAt: msg.createdAt,
        }) + '\n'
      );
      renameSync(tmp, sentinelPath);
    } catch {
      // Non-fatal by design: chat keeps working if the data dir is unwritable.
      // Best-effort orphan cleanup — a failed rename must not strand the
      // uniquely named tmp file.
      try {
        unlinkSync(tmp);
      } catch {
        /* nothing to clean, or the dir itself is unwritable */
      }
    }
  }

  // --- post-commit message hook (AS-25) -------------------------------------
  // The push-delivery event source. Subscribers are invoked AFTER the write
  // transaction commits, from both message-creating paths (postMessage and
  // ingestEvent) — since AS-24 the server process is the single live writer,
  // so an in-process hook observes every message while stream clients exist.
  // Same swallow-discipline as the AS-7 sentinel: a subscriber throw must
  // never fail the write.

  const messageSubscribers = [];

  function onMessage(cb) {
    messageSubscribers.push(cb);
  }

  function emitMessage(msg) {
    for (const cb of messageSubscribers) {
      try {
        cb(msg);
      } catch {
        // A broken subscriber must never fail (or appear to fail) the post.
      }
    }
  }

  /**
   * Delivery-time visibility predicate (AS-25): may `identityId` see messages
   * in `conversationId`? Same logic requireVisible/listConversationsFor apply,
   * as a boolean for the stream fan-out — evaluated per frame at delivery
   * time, never cached, so membership changes take effect immediately.
   * Unknown conversation is false (deliver nothing), never a throw.
   */
  function visibleTo(conversationId, identityId) {
    const conv = getConversation(Number(conversationId));
    if (!conv) return false;
    if (conv.visibility === 'public') return true;
    return isMember(conv.id, identityId);
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
    // Visibility gate BEFORE any input validation: a hidden channel must fail
    // exactly like a nonexistent id on every probe, including malformed ones —
    // a 400 for a bad body where a nonexistent id gives 404 would leak existence.
    requireVisible(conv, author, conversation);
    if (typeof body !== 'string' || body.trim() === '') {
      throw new StoreError('Message body must be a non-empty string.');
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
    const msg = tx(() => {
      db.prepare(
        `INSERT INTO messages (conversation_id, thread_root_id, author_id, body, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(conv.id, rootId, author, body, nowIso());
      const id = db.prepare('SELECT last_insert_rowid() AS id').get().id;
      return getMessage(Number(id));
    });
    // AS-7: after the tx commits, signal the host watcher for human authors
    // only. The registerIdentity regex guarantees the id prefix matches the
    // stored kind, so the prefix test is authoritative — no extra query.
    if (author.startsWith('human:')) writeHumanSentinel(msg);
    emitMessage(msg); // AS-25: push-delivery hook, post-commit
    return msg;
  }

  function getMessages(conversation, me, { limit } = {}) {
    requireIdentity(me);
    const conv = requireConversation(conversation);
    requireVisible(conv, me, conversation);
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

  /**
   * Delta read (AS-25): every message — top-level AND replies, flat — in the
   * conversation with id > sinceId, ordered by id. The reconnect catch-up
   * path; the client merges rows through the same applyMessage used for
   * stream frames. Gates exactly like getMessages (a hidden channel 404s
   * byte-identically to a nonexistent one), and the gate runs BEFORE since
   * validation so a malformed since can't distinguish hidden from missing.
   * No replyCount on rows: a reply's id always exceeds its root's, so a root
   * in the delta has all its replies in the delta — the client counts them.
   */
  function messagesSince(conversation, me, sinceId) {
    requireIdentity(me);
    const conv = requireConversation(conversation);
    requireVisible(conv, me, conversation);
    const since = Number(sinceId);
    if (!Number.isInteger(since) || since < 0) {
      throw new StoreError(`Invalid since '${sinceId}'.`);
    }
    const messages = db
      .prepare(
        `SELECT id, conversation_id AS conversationId, thread_root_id AS threadRootId,
                author_id AS authorId, body, created_at AS createdAt
         FROM messages
         WHERE conversation_id = ? AND id > ?
         ORDER BY id`
      )
      .all(conv.id, since);
    return { conversation: conv, messages };
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
    requireVisible(conv, me, conversation);
    // AS-3: validation lives inside the tx so the bounds check and the upsert
    // see the same max under BEGIN IMMEDIATE. Ids are insert-only and only
    // grow, so an over-max upTo can never come from a legitimately observed
    // message — it is always a caller bug. Reject rather than clamp: the
    // monotonic MAX() upsert below would otherwise make a poisoned watermark
    // irreversible through the public API.
    return tx(() => {
      const max = maxMessageId(conv.id);
      const target = upTo == null ? max : Number(upTo);
      if (!Number.isInteger(target) || target < 0) {
        throw new StoreError(`Invalid upTo '${upTo}'.`);
      }
      if (target > max) {
        throw new StoreError(
          `Invalid upTo '${upTo}': last message id in conversation ${conv.id} is ${max}.`
        );
      }
      db.prepare(
        `INSERT INTO read_state (identity_id, conversation_id, last_read_id) VALUES (?, ?, ?)
         ON CONFLICT (identity_id, conversation_id)
         DO UPDATE SET last_read_id = MAX(last_read_id, excluded.last_read_id)`
      ).run(me, conv.id, target);
      return { conversation: conv.id, lastReadId: target };
    });
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
           AND (c.visibility = 'public'
                OR EXISTS (SELECT 1 FROM conversation_members cm
                           WHERE cm.conversation_id = c.id AND cm.identity_id = ?))
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
    const msg = tx(() => {
      db.prepare('INSERT INTO ingested_events (event_id, ingested_at) VALUES (?, ?)').run(
        eventId,
        nowIso()
      );
      db.prepare(
        `INSERT INTO messages (conversation_id, thread_root_id, author_id, body, created_at)
         VALUES (?, NULL, ?, ?, ?)`
      ).run(chan.id, SYSTEM_IDENTITY, body, nowIso());
      const id = db.prepare('SELECT last_insert_rowid() AS id').get().id;
      return getMessage(Number(id));
    });
    emitMessage(msg); // AS-25: same post-commit hook as postMessage
    return true;
  }

  // --- dump ---------------------------------------------------------------

  /** Whole store as deterministic JSONL lines (backup/debug/migration). */
  function dumpLines() {
    const lines = [];
    const tables = [
      ['identities', 'SELECT * FROM identities ORDER BY id'],
      ['conversations', 'SELECT * FROM conversations ORDER BY id'],
      ['conversation_members', 'SELECT * FROM conversation_members ORDER BY conversation_id, identity_id'],
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

  // --- export (AS-5) ------------------------------------------------------

  /**
   * Append-only JSONL export of the insert-only tables (identities,
   * conversations, messages) for committing to git. Returns
   * [{ filename, lines: [string…] }, …] in deterministic order: identities
   * first, then conversations by id. Pure data — no filesystem access.
   *
   * Determinism contract: hand-built objects with fixed key order, ORDER BY
   * id everywhere, no export-run timestamps. Message ids are monotonic per
   * conversation and rows are never mutated, so a re-run emits every prior
   * file as a byte-identical prefix plus appended lines. (Exception:
   * identities.jsonl is ordered by text id, so a new identity can insert a
   * line mid-file — still deterministic, still a clean one-line diff.)
   */
  function exportFiles() {
    const num = (v) => (typeof v === 'bigint' ? Number(v) : v);
    const files = [];

    const identities = db
      .prepare('SELECT id, display_name, kind, created_at FROM identities ORDER BY id')
      .all();
    files.push({
      filename: 'identities.jsonl',
      lines: identities.map((r) =>
        JSON.stringify({
          type: 'identity',
          id: r.id,
          display_name: r.display_name,
          kind: r.kind,
          created_at: r.created_at,
        })
      ),
    });

    // AS-6: private channels are excluded outright — no file, no counts.
    // Hidden includes the git export (board decision); their only durable
    // copies are the live DB and manual `chat dump` backups. DMs keep
    // exporting exactly as before (pre-existing AS-5 behavior). The header
    // line format deliberately does NOT gain a visibility key: adding one
    // would rewrite line 1 of every previously committed export file and
    // break the byte-identical-prefix contract.
    const convs = db
      .prepare(
        `SELECT id, type, name, purpose, dm_key, created_by, created_at FROM conversations
         WHERE NOT (type = 'channel' AND visibility = 'private') ORDER BY id`
      )
      .all();
    const selectMsgs = db.prepare(
      `SELECT id, thread_root_id, author_id, body, created_at
       FROM messages WHERE conversation_id = ? ORDER BY id`
    );
    for (const c of convs) {
      const convId = num(c.id);
      const filename =
        c.type === 'channel' ? `channel-${c.name}.jsonl` : `dm-${dmExportName(c.dm_key)}.jsonl`;
      const lines = [
        JSON.stringify({
          type: 'conversation',
          id: convId,
          conv_type: c.type,
          name: c.name,
          purpose: c.purpose,
          dm_key: c.dm_key,
          members: c.type === 'dm' ? dmMembers(convId) : null,
          created_by: c.created_by,
          created_at: c.created_at,
        }),
      ];
      for (const m of selectMsgs.all(convId)) {
        lines.push(
          JSON.stringify({
            type: 'message',
            id: num(m.id),
            thread_root_id: m.thread_root_id == null ? null : num(m.thread_root_id),
            author: m.author_id,
            body: m.body,
            created_at: m.created_at,
          })
        );
      }
      files.push({ filename, lines });
    }
    return files;
  }

  // --- seeding ------------------------------------------------------------

  tx(() => {
    const now = nowIso();
    const insId = db.prepare(
      'INSERT OR IGNORE INTO identities (id, display_name, kind, created_at) VALUES (?, ?, ?, ?)'
    );
    for (const s of SEED_IDENTITIES) insId.run(s.id, s.displayName, s.kind, now);
    const insChan = db.prepare(
      `INSERT OR IGNORE INTO conversations (type, name, purpose, visibility, created_by, created_at)
       VALUES ('channel', ?, ?, ?, 'system:lattice', ?)`
    );
    const insMember = db.prepare(
      'INSERT OR IGNORE INTO conversation_members (conversation_id, identity_id) VALUES (?, ?)'
    );
    for (const c of SEED_CHANNELS) {
      insChan.run(c.name, c.purpose, c.visibility ?? 'public', now);
      if (c.members) {
        // Re-run on every open: seed members can never be locked out of a
        // seed channel by DB fiddling (deliberate — recorded in the AS-6 plan).
        const { id } = db
          .prepare("SELECT id FROM conversations WHERE type = 'channel' AND name = ?")
          .get(c.name);
        for (const m of c.members) insMember.run(id, m);
      }
    }
  });

  return {
    close: () => db.close(),
    listIdentities,
    getIdentity,
    requireIdentity,
    registerIdentity,
    createChannel,
    getChannelByName,
    getChannelVisibleTo,
    getConversation,
    requireConversation,
    openDm,
    dmConversationFor,
    dmMembers,
    listConversationsFor,
    postMessage,
    getMessage,
    getMessages,
    messagesSince,
    onMessage,
    visibleTo,
    maxMessageId,
    markRead,
    catchupAll,
    unreadFor,
    unreadCountFor,
    hasIngested,
    ingestEvent,
    dumpLines,
    exportFiles,
  };
}
