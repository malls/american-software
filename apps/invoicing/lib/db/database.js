// lib/db/database.js — the persistence layer's front door (AS-39, plan §2.1).
//
// The only module under lib/db/ that server.js, lib/health.js and the test
// helper import. Three things: prepareDatabase (open + migrate, what boot
// calls), probeDatabase (what /healthz calls), and createRepositories (what a
// route module will be handed). No SQL text lives here — the probe reads the
// version through schemaVersion() from migrate.js — and nothing here imports
// lib/config.js, lib/stripe/* or Express: the layer takes a settings object
// and a path, never the environment.
import { accessSync, constants, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { openDatabase } from './connection.js';
import { migrate, schemaVersion, SCHEMA_VERSION } from './migrate.js';

export {
  RepositoryError,
  NotFoundError,
  UniqueViolationError,
  ForeignKeyViolationError,
  InvalidStateError,
  ValidationError,
  MigrationError,
} from './errors.js';
export { SCHEMA_VERSION } from './migrate.js';

/**
 * Open the configured database and bring it to the current schema. Called by
 * server.js BEFORE createApp, so a process that cannot reach its data never
 * listens (plan §2.8).
 *
 * The directory is never created: a missing directory is a mis-mounted volume,
 * and creating it would put the data in the container layer, to be lost on the
 * next recreate. The driver's own message ("unable to open database file")
 * does not say which file, so the path is added here — the error is read from
 * a container log by someone who cannot attach a debugger.
 *
 * @param {{ dbPath: string }} config the resolved settings (only dbPath is read)
 * @returns {{ db: import('node:sqlite').DatabaseSync, applied: number[] }} the
 *   open handle (the caller owns close()) and the migration versions applied by
 *   this boot — [1] on a fresh file, [] on every later one
 */
export function prepareDatabase(config) {
  let db;
  try {
    db = openDatabase(config.dbPath);
  } catch (err) {
    throw new Error(`cannot open database ${config.dbPath}: ${err.message}`, { cause: err });
  }
  try {
    const { applied } = migrate(db);
    return { db, applied };
  } catch (err) {
    db.close();
    throw err;
  }
}

/**
 * The `database` health check (plan §2.7): the preconditions supplied from
 * OUTSIDE the process — mount, ownership, file, schema — which a live handle
 * cannot see, verified on a second short-lived connection. Each step fails with
 * its own cause, in this order:
 *
 *  1. the file exists (statSync). The probe never opens a missing file —
 *     opening would create it, and a health check must never write;
 *  2. the directory is writable (accessSync W_OK) — the WAL sidecars live there,
 *     so a volume remounted read-only shows as EROFS and a wrong owner as EACCES
 *     (measured: a readOnly connection accepts BEGIN IMMEDIATE, so a transaction
 *     would NOT detect this);
 *  3. it opens and is a database (a file that is not one fails here, errcode
 *     26), and the file itself is writable;
 *  4. its schema version is this build's.
 *
 * Returns true, or { ok: false, detail } with the path and the cause.
 *
 * @param {string} dbPath
 * @returns {true | { ok: false, detail: string }}
 */
export function probeDatabase(dbPath) {
  try {
    return probe(dbPath);
  } catch (err) {
    const cause = err.code === 'ERR_SQLITE_ERROR' ? err.message : (err.code ?? err.message);
    return { ok: false, detail: `${dbPath}: ${cause}` };
  }
}

function probe(dbPath) {
  statSync(dbPath);
  accessSync(dirname(dbPath), constants.W_OK);
  const db = openDatabase(dbPath, { timeoutMs: 1000 });
  try {
    accessSync(dbPath, constants.W_OK);
    const version = schemaVersion(db);
    if (version !== SCHEMA_VERSION) {
      return { ok: false, detail: `${dbPath}: schema version ${version}, this build expects ${SCHEMA_VERSION}` };
    }
    return true;
  } finally {
    db.close();
  }
}
