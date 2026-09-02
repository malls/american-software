// lib/db/migrate.js — the migration set and the runner (AS-39, plan §2.3).
//
// The set is a static, ordered import list — one line per migration — not a
// directory scan at boot: a reviewer sees every migration the build will run in
// one literal, and a `.sql` file would be an unclassified file to the
// closed-world dependency scan. No `down` anywhere: the product never migrates
// backwards; a bad migration is fixed forward by the next one.
//
// The ledger is a table, `schema_migrations`, readable by anyone with a sqlite3
// shell; `PRAGMA user_version` is deliberately unused because a table carries
// names and timestamps and an integer does not.
import { transaction } from './connection.js';
import { MigrationError } from './errors.js';
import m0001 from './migrations/0001-initial.js';

/** Every migration this build knows, in the order they apply. Append only. */
export const MIGRATIONS = Object.freeze([m0001]);

// Load-time check, like custody.js's: a mis-numbered, renamed-to-collide, or
// empty migration fails every import — the whole suite — instead of one boot.
const seenNames = new Set();
for (const [index, m] of MIGRATIONS.entries()) {
  if (m.version !== index + 1) {
    throw new MigrationError(`MIGRATIONS[${index}] has version ${m.version}; versions must be 1..n contiguous — refusing to load`);
  }
  if (typeof m.name !== 'string' || m.name.length === 0 || seenNames.has(m.name)) {
    throw new MigrationError(`migration ${m.version} needs a unique non-empty name — refusing to load`);
  }
  if (typeof m.up !== 'string' || m.up.trim().length === 0) {
    throw new MigrationError(`migration ${m.version} (${m.name}) has an empty up — refusing to load`);
  }
  seenNames.add(m.name);
}

/** The version a database is at after every known migration has run. */
export const SCHEMA_VERSION = MIGRATIONS.at(-1).version;

const LEDGER_DDL = 'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT';

/**
 * The schema version recorded in `db`: 0 for a database with no ledger (empty
 * file, or a file some other program made), otherwise the highest applied
 * version. Read-only — safe on a read-only connection and in the health probe.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {number}
 */
export function schemaVersion(db) {
  const ledger = db.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get();
  if (ledger === undefined) return 0;
  const row = db.prepare('SELECT COALESCE(MAX(version), 0) AS head FROM schema_migrations').get();
  return row.head;
}

/**
 * Bring `db` to the head of `migrations`, applying only what the ledger lacks.
 *
 * The ledger is created outside the transaction (CREATE TABLE IF NOT EXISTS is
 * idempotent); everything else — the read, every `up`, every ledger row — runs
 * inside one BEGIN IMMEDIATE, so a second process booting on the same file waits
 * and then finds everything applied, and a failing `up` leaves nothing behind
 * (DDL is transactional in SQLite).
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {ReadonlyArray<{version: number, name: string, up: string}>} [migrations]
 * @param {{ now?: () => string }} [options] injectable clock for the ledger
 * @returns {{ applied: number[], head: number }} the versions applied by THIS
 *   call (`[1]` on a fresh file, `[]` on every later boot) and the resulting head
 * @throws {MigrationError} when the database is at a version this build does not
 *   know (old code, newer schema), or a recorded migration's name differs from
 *   the code's (a renamed migration is a different migration)
 */
export function migrate(db, migrations = MIGRATIONS, { now = () => new Date().toISOString() } = {}) {
  db.exec(LEDGER_DDL);
  return transaction(db, () => {
    const known = migrations.at(-1)?.version ?? 0;
    const byVersion = new Map(migrations.map((m) => [m.version, m]));
    const applied = new Set();
    for (const row of db.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all()) {
      if (row.version > known) {
        throw new MigrationError(`database is at schema version ${row.version}, this build knows ${known}`);
      }
      const expected = byVersion.get(row.version);
      if (expected === undefined || expected.name !== row.name) {
        throw new MigrationError(`migration ${row.version} is recorded as '${row.name}' but this build has '${expected?.name ?? '(none)'}'`);
      }
      applied.add(row.version);
    }
    const insert = db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)');
    const ran = [];
    for (const m of migrations) {
      if (applied.has(m.version)) continue;
      db.exec(m.up);
      insert.run(m.version, m.name, now());
      ran.push(m.version);
    }
    return { applied: ran, head: known };
  });
}
