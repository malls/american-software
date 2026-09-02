// db.test.js — the connection, the migration runner, the error mapping, the
// `database` health check and boot (AS-39, plan §2.10 D1–D18).
//
// WHAT THIS FILE IS NOT: a test of the repositories. Those are in
// repositories.test.js, against an in-memory database. Everything here is about
// the FILE — opening it, bringing it to the current schema, refusing a schema
// this build does not know, and telling the truth about it from /healthz —
// so every test uses a real file under a private mkdtemp directory. `node
// --test` runs files in parallel processes; a shared file would make row
// counts flaky, which is why the helper hands out a fresh path per call.
//
// D18 is the one exception to "a private temp file": it uses the REAL default
// path, /app/data/invoicing.sqlite, and is a statement about the shipped image —
// that the Dockerfile created /app/data and gave it to the runtime user. It
// only means anything inside the mountless test service, which is the only
// supported runner (compose.yaml).
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { openDatabase, transaction } from '../lib/db/connection.js';
import {
  ForeignKeyViolationError,
  MigrationError,
  UniqueViolationError,
  ValidationError,
  mapSqliteError,
} from '../lib/db/errors.js';
import { MIGRATIONS, SCHEMA_VERSION, migrate, schemaVersion } from '../lib/db/migrate.js';
import { prepareDatabase, probeDatabase } from '../lib/db/database.js';
import { SCHEMA, loadConfig } from '../lib/config.js';
import { configFor, freshDbPath, preparedConfigFor, withServer } from './helpers/server.js';

/** The seven entity tables migration 0001 creates, plus the runner's ledger: eight. */
const TABLES = [
  'clients',
  'connected_accounts',
  'contracts',
  'freelancers',
  'invoice_line_items',
  'invoices',
  'schema_migrations',
  'stripe_events',
];

/** The named indexes in migration 0001 (the plan's prose said five; the DDL it
 *  pins has four — the count here is the DDL's, and D3 asserts it exactly). */
const NAMED_INDEXES = ['clients_owner_email', 'contracts_owner_created', 'freelancers_email_unique', 'invoices_owner_created'];

/** Rows come back as null-prototype objects; spread them so deepEqual against
 *  a literal compares values and not prototypes. */
const plain = (rows) => rows.map((row) => ({ ...row }));

const pragma = (db, name) => db.prepare(`PRAGMA ${name}`).get()[name === 'busy_timeout' ? 'timeout' : name];

/** Everything sqlite_master knows, in a stable order — the "byte-identical" comparison D4 wants. */
const catalogue = (db) => plain(db.prepare('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name').all());
const ledger = (db) => plain(db.prepare('SELECT version, name, applied_at FROM schema_migrations ORDER BY version').all());
const tableNames = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((r) => r.name);

/** Open a fresh file, run `fn(db, path)`, always close. */
function withFreshDb(fn) {
  const path = freshDbPath();
  const db = openDatabase(path);
  try {
    return fn(db, path);
  } finally {
    db.close();
  }
}

const NOW = '2026-09-01T12:00:00.000Z';
const insertFreelancer = (db, id, email) =>
  db.prepare('INSERT INTO freelancers (id, email, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, email, 'Name', NOW, NOW);

// --- D1–D2: the connection and the migration set --------------------------------

test('D1: openDatabase applies WAL, foreign keys ON and the 5 s busy timeout; :memory: still gets foreign keys', () => {
  withFreshDb((db) => {
    assert.equal(pragma(db, 'journal_mode'), 'wal');
    assert.equal(pragma(db, 'foreign_keys'), 1);
    assert.equal(pragma(db, 'busy_timeout'), 5000);
  });
  const mem = openDatabase(':memory:');
  try {
    // journal_mode is `memory` for an in-memory database — WAL is a property of
    // a file — but the referential setting must hold there too, or every
    // repositories.test.js FK case would be vacuous.
    assert.equal(pragma(mem, 'foreign_keys'), 1);
    assert.equal(pragma(mem, 'journal_mode'), 'memory');
  } finally {
    mem.close();
  }
  const slow = openDatabase(':memory:', { timeoutMs: 250 });
  try {
    assert.equal(pragma(slow, 'busy_timeout'), 250, 'the timeout is the option, not a constant');
  } finally {
    slow.close();
  }
});

test('D2: the migration set is exactly one migration, contiguous from 1, uniquely named; SCHEMA_VERSION is its head', () => {
  assert.equal(MIGRATIONS.length, 1, `expected exactly 1 migration, found ${MIGRATIONS.length}`);
  MIGRATIONS.forEach((m, i) => {
    assert.equal(m.version, i + 1, `MIGRATIONS[${i}] must be version ${i + 1}`);
    assert.equal(typeof m.name, 'string');
    assert.ok(m.name.length > 0);
    assert.ok(m.up.trim().length > 0, `migration ${m.version} has an empty up`);
  });
  assert.equal(new Set(MIGRATIONS.map((m) => m.name)).size, MIGRATIONS.length, 'migration names are unique');
  assert.deepEqual(MIGRATIONS.map((m) => m.name), ['initial']);
  assert.equal(SCHEMA_VERSION, 1);
  assert.ok(Object.isFrozen(MIGRATIONS), 'the set is append-only in code, and frozen at runtime');
});

// --- D3–D6: the runner ----------------------------------------------------------

test('D3: migrating an empty file creates exactly the seven entity tables plus the ledger, the four named indexes — every table STRICT', () => {
  const path = freshDbPath();
  assert.equal(existsSync(path), false, 'the file does not exist before open');
  const db = openDatabase(path);
  try {
    assert.equal(schemaVersion(db), 0, 'a database with no ledger is at version 0');
    const result = migrate(db, MIGRATIONS, { now: () => NOW });
    assert.deepEqual(result, { applied: [1], head: 1 });
    assert.equal(schemaVersion(db), SCHEMA_VERSION);
    assert.deepEqual(ledger(db), [{ version: 1, name: 'initial', applied_at: NOW }]);

    // Cardinality first, against committed literals — never `> 0`.
    const tables = tableNames(db);
    assert.equal(tables.length, 8, `expected 8 tables (7 + the ledger), found ${tables.length}: ${tables.join(', ')}`);
    assert.deepEqual(tables, TABLES);

    const named = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY name").all().map((r) => r.name);
    assert.equal(named.length, 4, `expected 4 named indexes, found ${named.length}: ${named.join(', ')}`);
    assert.deepEqual(named, NAMED_INDEXES);
    // The implicit ones — every PRIMARY KEY and UNIQUE on a TEXT key gets one.
    // Pinned so a dropped UNIQUE shows up as a count, not as a silently
    // duplicable stripe_account_id.
    const auto = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND sql IS NULL").all();
    assert.equal(auto.length, 13, `expected 13 autoindexes, found ${auto.length}`);

    // STRICT everywhere: a non-STRICT table would accept 'seven' in an INTEGER
    // column and store it as text. Zero exceptions, the ledger included.
    const lax = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table'").all().filter((r) => !/\)\s*STRICT\s*$/.test(r.sql));
    assert.deepEqual(lax.map((r) => r.name), [], `non-STRICT tables: ${lax.map((r) => r.name).join(', ')}`);
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'").get().n, 8);
  } finally {
    db.close();
  }
});

test('D4: a second migrate applies nothing and changes nothing — ledger and catalogue identical', () => {
  withFreshDb((db) => {
    migrate(db, MIGRATIONS, { now: () => NOW });
    const before = { ledger: ledger(db), catalogue: catalogue(db) };
    assert.equal(before.catalogue.length, 8 + 4 + 13, 'the catalogue has the tables, the named indexes and the autoindexes');
    const second = migrate(db, MIGRATIONS, { now: () => '2030-01-01T00:00:00.000Z' });
    assert.deepEqual(second, { applied: [], head: 1 });
    assert.deepEqual(ledger(db), before.ledger, 'the ledger row keeps its ORIGINAL applied_at');
    assert.deepEqual(catalogue(db), before.catalogue);
    assert.equal(db.isTransaction, false);
  });
});

test('D5: a database ahead of the build (ledger head N+1) is refused, naming both versions, with nothing applied', () => {
  withFreshDb((db) => {
    // An empty migration set creates the ledger and nothing else; then a row
    // from a future build is planted by hand.
    assert.deepEqual(migrate(db, []), { applied: [], head: 0 });
    assert.deepEqual(tableNames(db), ['schema_migrations']);
    db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(SCHEMA_VERSION + 1, 'from-the-future', NOW);

    assert.throws(
      () => migrate(db),
      (err) => err instanceof MigrationError
        && err.code === 'migration'
        && err.message.includes(`schema version ${SCHEMA_VERSION + 1}`)
        && err.message.includes(`this build knows ${SCHEMA_VERSION}`),
    );
    assert.equal(db.isTransaction, false, 'the failed run rolled back');
    assert.deepEqual(tableNames(db), ['schema_migrations'], 'nothing was applied — old code must not touch a newer schema');
    assert.deepEqual(plain(db.prepare('SELECT version, name FROM schema_migrations').all()), [{ version: 2, name: 'from-the-future' }]);
  });
});

test('D6: a recorded migration whose name differs from the code is a different migration, and is refused', () => {
  withFreshDb((db) => {
    migrate(db);
    db.prepare("UPDATE schema_migrations SET name = 'renamed' WHERE version = 1").run();
    assert.throws(
      () => migrate(db),
      (err) => err instanceof MigrationError && /recorded as 'renamed' but this build has 'initial'/.test(err.message),
    );
    assert.equal(db.isTransaction, false);
  });
});

// --- D7: transactions -----------------------------------------------------------

test('D7: transaction commits on return, rolls back and rethrows on throw, and JOINS an open transaction instead of nesting', () => {
  withFreshDb((db) => {
    migrate(db);
    const count = () => db.prepare('SELECT count(*) AS n FROM freelancers').get().n;

    // Commit on return, and the return value comes through.
    assert.equal(transaction(db, () => { insertFreelancer(db, 'f1', 'one@example.com'); return 'out'; }), 'out');
    assert.equal(count(), 1);
    assert.equal(db.isTransaction, false);

    // Rollback on throw: the row is gone, the error is the caller's own.
    const boom = new Error('boom');
    assert.throws(() => transaction(db, () => { insertFreelancer(db, 'f2', 'two@example.com'); throw boom; }), (err) => err === boom);
    assert.equal(count(), 1, 'the write inside the failed transaction was rolled back');
    assert.equal(db.isTransaction, false, 'no transaction is left open after the rollback');

    // Join: the inner call does not BEGIN (which would throw "cannot start a
    // transaction within a transaction"), and the OUTER rollback undoes the
    // inner's writes — there is one transaction, not two.
    assert.throws(
      () => transaction(db, () => {
        insertFreelancer(db, 'f3', 'three@example.com');
        const inner = transaction(db, () => {
          assert.equal(db.isTransaction, true, 'the inner body runs inside the outer transaction');
          insertFreelancer(db, 'f4', 'four@example.com');
          return 'inner';
        });
        assert.equal(inner, 'inner');
        assert.equal(db.isTransaction, true, 'the inner return did not COMMIT the outer transaction');
        assert.equal(count(), 3, 'both writes are visible inside the transaction');
        throw boom;
      }),
      (err) => err === boom,
    );
    assert.equal(count(), 1, 'the outer rollback undid the inner write too');
    assert.equal(db.isTransaction, false);
  });
});

// --- D8: the driver's errors, mapped -----------------------------------------------

test('D8: mapSqliteError maps 2067, 1555, 787, 275 and 3091 to the repository vocabulary, and passes everything else through', () => {
  withFreshDb((db) => {
    migrate(db);
    insertFreelancer(db, 'f1', 'Ada@example.com');
    const mapped = (fn) => {
      try {
        fn();
      } catch (err) {
        return { mapped: mapSqliteError(err), raw: err };
      }
      throw new Error('the statement was expected to throw');
    };

    // 2067 UNIQUE on the expression index: the same email in a different case.
    const unique = mapped(() => insertFreelancer(db, 'f2', 'ada@example.com'));
    assert.equal(unique.raw.errcode, 2067);
    assert.ok(unique.mapped instanceof UniqueViolationError);
    assert.equal(unique.mapped.code, 'unique_violation');
    assert.equal(unique.mapped.constraint, "index 'freelancers_email_unique'");
    assert.equal(unique.mapped.cause, unique.raw, 'the driver error rides along as cause');

    // 1555 PRIMARY KEY.
    const pk = mapped(() => insertFreelancer(db, 'f1', 'other@example.com'));
    assert.equal(pk.raw.errcode, 1555);
    assert.ok(pk.mapped instanceof UniqueViolationError);
    assert.equal(pk.mapped.constraint, 'freelancers.id');

    // 787 FOREIGN KEY.
    const fk = mapped(() => db
      .prepare('INSERT INTO clients (id, freelancer_id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('c1', 'no-such-freelancer', 'Client', 'client@example.com', NOW, NOW));
    assert.equal(fk.raw.errcode, 787);
    assert.ok(fk.mapped instanceof ForeignKeyViolationError);
    assert.equal(fk.mapped.code, 'foreign_key_violation');

    // 275 CHECK: a Stripe event id without its prefix.
    const check = mapped(() => db.prepare('INSERT INTO stripe_events (id, type, processed_at) VALUES (?, ?, ?)').run('bogus', 'invoice.paid', NOW));
    assert.equal(check.raw.errcode, 275);
    assert.ok(check.mapped instanceof ValidationError);
    assert.equal(check.mapped.code, 'validation');
    assert.equal(check.mapped.field, 'check');
    assert.equal(check.mapped.message, "check: substr(id, 1, 4) = 'evt_'");

    // 3091 STRICT datatype: text where an integer is declared. Needs the chain
    // down to a line item — which doubles as a smoke test of the DDL's shape.
    db.prepare('INSERT INTO clients (id, freelancer_id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('c1', 'f1', 'Client', 'client@example.com', NOW, NOW);
    db.prepare('INSERT INTO invoices (id, freelancer_id, client_id, currency, days_until_due, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('i1', 'f1', 'c1', 'usd', 30, NOW, NOW);
    const datatype = mapped(() => db
      .prepare('INSERT INTO invoice_line_items (id, invoice_id, position, description, quantity, unit_amount_minor) VALUES (?, ?, ?, ?, ?, ?)')
      .run('l1', 'i1', 0, 'Design', 'two', 15000));
    assert.equal(datatype.raw.errcode, 3091);
    assert.ok(datatype.mapped instanceof ValidationError);
    assert.equal(datatype.mapped.field, 'invoice_line_items.quantity');
    assert.match(datatype.mapped.message, /cannot store TEXT value in INTEGER column invoice_line_items\.quantity/);

    // Anything that is not an engine error is returned untouched — the caller
    // rethrows the unknown failure it is.
    const plainError = new Error('not sqlite');
    assert.equal(mapSqliteError(plainError), plainError);
    const otherEngine = Object.assign(new Error('disk I/O error'), { code: 'ERR_SQLITE_ERROR', errcode: 10 });
    assert.equal(mapSqliteError(otherEngine), otherEngine, 'an engine error outside the five constraint codes passes through');
    assert.equal(mapSqliteError(null), null);
  });
});

// --- D9–D13: the database health check, driven red every way it can fail ---------

test('D9: probeDatabase on a migrated file is true', () => {
  const config = preparedConfigFor();
  assert.equal(probeDatabase(config.dbPath), true);
});

test('D10: a missing file is reported as ENOENT — and the probe did NOT create it', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'asc-invoicing-db-')), 'missing.sqlite');
  const result = probeDatabase(path);
  assert.equal(result.ok, false);
  assert.match(result.detail, /ENOENT/);
  assert.ok(result.detail.includes(path), 'the detail names the path');
  assert.equal(existsSync(path), false, 'a health check never writes: opening would have created the file');
});

test('D11: an unwritable data directory is reported as EACCES', () => {
  // root ignores mode bits, so as root this test could not produce the
  // condition and would be vacuous. The supported runner drops to `node`
  // (Dockerfile USER node); anything else is asserted against, not skipped.
  assert.notEqual(process.getuid(), 0, 'the suite must run as the runtime user for directory permissions to mean anything');
  const config = preparedConfigFor();
  const dir = dirname(config.dbPath);
  chmodSync(dir, 0o500);
  try {
    const result = probeDatabase(config.dbPath);
    assert.equal(result.ok, false);
    assert.match(result.detail, /EACCES/);
    assert.ok(result.detail.includes(config.dbPath));
  } finally {
    chmodSync(dir, 0o700);
  }
  assert.equal(probeDatabase(config.dbPath), true, 'and it recovers once the directory is writable again');
});

test('D12: a schema ahead of the build is reported by version, not by a crash', () => {
  const config = preparedConfigFor();
  const db = openDatabase(config.dbPath);
  try {
    db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(SCHEMA_VERSION + 1, 'from-the-future', NOW);
  } finally {
    db.close();
  }
  const result = probeDatabase(config.dbPath);
  assert.equal(result.ok, false);
  assert.match(result.detail, /schema version/);
  assert.match(result.detail, new RegExp(`schema version ${SCHEMA_VERSION + 1}, this build expects ${SCHEMA_VERSION}`));
});

test('D13: a file that is not a database is reported, with the path and the cause', () => {
  const path = freshDbPath();
  writeFileSync(path, 'not a database');
  const result = probeDatabase(path);
  assert.equal(result.ok, false);
  assert.ok(result.detail.length > 0);
  assert.ok(result.detail.includes(path));
  assert.match(result.detail, /not a database/);
});

// --- D14–D15: boot ----------------------------------------------------------------

test('D14: prepareDatabase against a missing directory throws, names the path, and creates nothing', () => {
  const dbPath = '/nonexistent/dir/x.sqlite';
  assert.equal(existsSync('/nonexistent'), false, 'precondition: the directory really is absent');
  assert.throws(
    () => prepareDatabase(configFor({ dbPath })),
    (err) => err.message.includes(dbPath) && err.cause?.code === 'ERR_SQLITE_ERROR',
  );
  assert.equal(existsSync('/nonexistent'), false, 'a mis-mounted volume must fail loudly, never be papered over with mkdir');
});

test('D15: prepareDatabase returns { db, applied: [1] } on a fresh file and { applied: [] } on the next boot', () => {
  const config = configFor();
  const first = prepareDatabase(config);
  try {
    assert.deepEqual(Object.keys(first).sort(), ['applied', 'db']);
    assert.deepEqual(first.applied, [1]);
    assert.equal(typeof first.db.close, 'function');
    assert.equal(schemaVersion(first.db), SCHEMA_VERSION);
  } finally {
    first.db.close();
  }
  const second = prepareDatabase(config);
  try {
    assert.deepEqual(second.applied, []);
  } finally {
    second.db.close();
  }
});

// --- D16–D17: /healthz over HTTP ----------------------------------------------------

test('D16: GET /healthz on a booted server is 200 with exactly the four checks, database included', async () => {
  await withServer(configFor(), async (base) => {
    const res = await fetch(`${base}/healthz`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.checks.length, 4);
    assert.deepEqual(body.checks.map((c) => c.name), ['config', 'vendor_assets', 'views', 'database']);
    assert.deepEqual(body.checks.filter((c) => !c.ok), []);
  });
});

test('D17: the database file deleted under a running server turns /healthz 503 with ONLY database failing', async () => {
  const config = configFor();
  await withServer(config, async (base) => {
    assert.equal((await fetch(`${base}/healthz`)).status, 200, 'green before the file goes');
    rmSync(config.dbPath);
    const res = await fetch(`${base}/healthz`);
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.deepEqual(body.checks.filter((c) => !c.ok).map((c) => c.name), ['database']);
    const database = body.checks.find((c) => c.name === 'database');
    assert.match(database.detail, /ENOENT/);
    assert.ok(database.detail.includes(config.dbPath));
  });
});

// --- D18: V3 — the real path, inside the real image -----------------------------------

test('D18: the image ships /app/data owned by the runtime user — the DEFAULT path boots, migrates and serves a green /healthz', async () => {
  // This is the assertion the compose mount, the Dockerfile mkdir/chown and the
  // config default exist to satisfy, run where it counts: as `node`, in the
  // mountless test service, against the path a real `docker compose up` uses.
  // deploy-shape.test.js pins the three files to each other; this proves the
  // image they describe actually works.
  const dbDefault = SCHEMA.find((r) => r.key === 'dbPath').default;
  assert.equal(dbDefault, '/app/data/invoicing.sqlite');
  assert.equal(existsSync(dbDefault), false, 'the image ships no database — the file is created on first boot');
  assert.notEqual(process.getuid(), 0, 'the suite runs as the runtime user, not root, or /app/data ownership is untested');

  const config = loadConfig({});
  assert.equal(config.dbPath, dbDefault);
  const sidecars = [dbDefault, `${dbDefault}-wal`, `${dbDefault}-shm`];
  try {
    const { db, applied } = prepareDatabase(config);
    db.close();
    assert.deepEqual(applied, [1]);
    assert.equal(existsSync(dbDefault), true);
    await withServer(config, async (base) => {
      const res = await fetch(`${base}/healthz`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.checks.find((c) => c.name === 'database').ok, true);
    });
  } finally {
    for (const file of sidecars) rmSync(file, { force: true });
  }
  assert.equal(existsSync(dbDefault), false, 'left the image directory as it was found');
});
