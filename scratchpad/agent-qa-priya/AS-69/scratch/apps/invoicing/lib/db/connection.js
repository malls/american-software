// lib/db/connection.js — the ONE `node:sqlite` import in the product (AS-39,
// plan §2.2).
//
// Two things live here and nothing else: how a database is opened (the three
// connection settings the sibling app has run for 25+ tasks — WAL, foreign keys
// on, a 5 s busy timeout) and how a function runs inside a write transaction.
// No SQL about entities. The engine is replaceable (stack decision Q2, reversal
// trigger T6): every other module under lib/db/ reaches the driver only through
// the handle this file returns, and test/dependency-policy.test.js pins the
// `node:sqlite` import to exactly this file.
import { DatabaseSync } from 'node:sqlite';

/**
 * Open the database at `path`, creating the FILE if it is absent. The directory
 * must already exist: this module never creates one, because a missing
 * directory is a mis-mounted volume and must fail loudly at boot rather than
 * quietly put the data in the container layer (plan §2.8).
 *
 * `PRAGMA foreign_keys` is a no-op inside a transaction, which is why both
 * settings are applied here, at open, and nowhere else. `journal_mode = wal`
 * is a property of the file: readers never block the single writer, and
 * close() removes the -wal/-shm sidecars.
 *
 * @param {string} path a filesystem path, or ':memory:' in tests
 * @param {{ timeoutMs?: number }} [options] how long a second writer waits
 *   before SQLITE_BUSY (the driver's busy handler; measured to take effect)
 * @returns {DatabaseSync} the handle; the caller owns close()
 */
export function openDatabase(path, { timeoutMs = 5000 } = {}) {
  const db = new DatabaseSync(path, { timeout: timeoutMs });
  try {
    db.exec('PRAGMA journal_mode = wal');
    db.exec('PRAGMA foreign_keys = ON');
  } catch (err) {
    // A file that is not a database fails on the first statement, not in the
    // constructor. Do not leak the handle on the way out.
    db.close();
    throw err;
  }
  return db;
}

/**
 * Run `fn` inside a write transaction and return its result. COMMIT on return,
 * ROLLBACK and rethrow on throw.
 *
 * JOIN semantics, not nesting: when a transaction is already open on `db`, `fn`
 * simply runs inside it, and the outer COMMIT or ROLLBACK decides everything.
 * There are no savepoints — nothing in v1 needs partial rollback, and the join
 * rule is one line (plan §2.2). `BEGIN IMMEDIATE` takes the write lock up
 * front, so a second writer waits `timeoutMs` instead of failing mid-way.
 *
 * @template T
 * @param {DatabaseSync} db
 * @param {() => T} fn synchronous — the driver is synchronous, so a transaction
 *   spanning an `await` would hold the lock across the event loop
 * @returns {T}
 */
export function transaction(db, fn) {
  if (db.isTransaction) return fn();
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
