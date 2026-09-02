# AS-39: D1 v1: data model and persistence layer (freelancer, connected account, client, contract, invoice mirror)

Plan by `agent:cto-owen` (tech lead for this stage), 2026-09-01. Implementer:
`agent:developer-marcus`. Reviewer: `agent:qa-priya`. The task description in
Lattice (`lattice show AS-39`) is binding in every sentence; this plan says HOW.

Style and falsification conventions follow the AS-38 plan
(`.lattice/plans/task_01M1D34N011ZBKGSM2AW5X3VZN.md`, incl. its §11 correction:
recipe backups live OUTSIDE `apps/invoicing/`) and the scaffold's README: every
set-quantified assertion sits behind an exact count against a committed literal
(V2); every guard is demonstrated failing under a mutation before it is believed (§6).

Evidence gathered for this plan (all offline, in `docker run --network none
node:24.20.0-slim`, 2026-09-01 — the pinned base image, so these are facts about
the runtime the app ships on, not about a host Node):

- `node:sqlite` exports `DatabaseSync, StatementSync, Session, constants, backup`;
  SQLite **3.53.4**; **no ExperimentalWarning** on import (agrees with the stack
  decision §7's "no experimental warning").
- `PRAGMA foreign_keys` defaults **ON** in this build; set explicitly anyway (§2.2) —
  the pragma is a no-op inside a transaction, so it must run at open.
- File DB default journal is `delete`; `PRAGMA journal_mode = wal` takes and the
  `-wal`/`-shm` sidecars are removed by `close()`. `:memory:` answers `memory`.
- `busy_timeout` defaults to 0; the constructor option `{ timeout: 5000 }` sets it.
- `STRICT` tables, `CHECK`, `RETURNING`, json1 (`json_valid`) all work. STRICT
  requires a datatype on every column (a `t(x)` probe failed with "missing datatype").
- Constraint failures throw `code: 'ERR_SQLITE_ERROR'` with the **extended**
  `errcode`: 275 CHECK, 3091 STRICT datatype, 787 FK, 1555 PK, 2067 UNIQUE (also
  for an expression index such as `lower(email)`), 5 BUSY after the timeout,
  14 CANTOPEN (missing directory, or a read-only mount), 26 NOTADB.
- `db.isTransaction` works; `run()` returns `{ changes, lastInsertRowid }`;
  multi-statement `exec()` works; double-quoted string literals are rejected.
- **A `readOnly: true` connection accepts `BEGIN IMMEDIATE`** — so a transaction is
  NOT a writability probe. The health probe uses `fs.accessSync(W_OK)` instead (§2.7).
- **Named volume ownership**: an image with `RUN mkdir -p /app/data && chown
  node:node /app/data` before `USER node`, run with `-v vol:/app/data`, gives the
  fresh volume uid 1000 / mode 755; `node` created a WAL database there; a second
  container on the same volume saw the first's rows; the same image with **no**
  volume (the `test` service's situation) writes to the image's own empty
  directory; an `:ro` mount fails at open with errcode 14.

---

## 1. Scope

### 1.1 In scope

1. `apps/invoicing/lib/db/` (§2.1): one connection module (the ONLY `node:sqlite`
   import in the product), a migration runner with an ordered list of JS migration
   modules, the v1 DDL as migration 0001, the error classes, the money validator,
   six repositories (freelancers, connected accounts, clients, contracts, invoices
   with line items, Stripe events) behind `createRepositories(db)`, and
   `prepareDatabase(config)` / `probeDatabase(dbPath)` for boot and health.
2. Boot: `server.js` opens and migrates the database before `createApp`, logs the
   schema version and how many migrations it applied, and closes the connection on
   `SIGTERM` (§2.8).
3. One config row (§3.3): `INVOICING_DB_PATH`, type `path`, default
   `/app/data/invoicing.sqlite`. Not secret, not required.
4. A fourth health check, `database` (§2.7), appended to `HEALTH_CHECKS` as data.
5. Compose and Dockerfile (§3): a named volume `invoicing-data` mounted on `web` at
   `/app/data`; the image creates `/app/data` owned by `node`. The `test` service
   stays mountless and offline; it never sees a developer's data.
6. Two test files: `test/db.test.js` (connection, migrations, transaction helper,
   error mapping, probe, health wiring, the real-path V3 boot) and
   `test/repositories.test.js` (create/read/update per entity, every uniqueness
   and foreign-key constraint, the invoice state machine, raw-DDL backstops).
7. The dependency-policy guard extended (§2.9): `node:sqlite` sanctioned in exactly
   one file, the money-words exemption widened to exactly the files that must
   carry them, and a new `raw SQL` concept row so SQL outside `lib/db/` is a red test.
8. Amendments to the five existing tests whose committed literals this task moves
   (config, dependency-policy, deploy-shape, harness, health), `test/helpers/server.js`,
   and the app README.

### 1.2 Not in scope (the description's NOT list, mirrored, plus who owns it)

- **No authentication or credential handling** — **AS-40**. This task defines the
  `freelancers` row (identity: id, email, display name). Password/credential
  storage and sessions are AS-40's tables, added as migration `0002` through the
  runner defined here (§2.3 records the recommended shape; not binding).
- **No Stripe API call.** Nothing under `lib/db/` imports `lib/stripe/*`, and
  `lib/stripe/*` does not import `lib/db/*`. The mirror stores what AS-43/AS-44
  hand it; it never fetches.
- **No UI.** No route reads or writes the database in this task; `createApp(config)`
  keeps its signature (§2.8 explains why the app is not handed a handle yet).
- **Connected-account creation and readiness maintenance** — **AS-41** (`POST
  /v1/accounts`, account links, return/refresh, `account.updated`). This task
  DEFINES the readiness flags and the one derived `ready` rule (§2.6); AS-41 writes
  them through `connectedAccounts.updateReadiness`.
- **Contract templates, variables, rendering** — **AS-42**. This task stores a
  template id, a JSON variables object, and the rendered HTML, immutably.
- **Stripe customer (`cus_`), invoice items, finalize, send** — **AS-43**. This task
  provides `clients.setStripeCustomerId` (lazy `cus_`), `invoices.attachStripeInvoice`,
  and `invoices.applyStripeSnapshot` (§2.5); AS-43 decides when to call them and
  maps Stripe objects onto snapshots.
- **Webhook verification and event application** — **AS-44**. This task provides
  the idempotency table and `stripeEvents.recordOnce` (§2.4), and the
  out-of-order convergence rule in `applyStripeSnapshot` (§2.5).
- **Multi-currency, VAT, jurisdictional fields** — out of v1 (row C-32). Not
  foreclosed: §2.4 (`currency` per invoice, minor units) and §2.6 (one allowed-set).
- **Deleting anything.** No v1 screen or state (`02-states-ledger.md`) deletes a
  record; no repository exposes a delete; no soft-delete column is added (§2.4).
- **Backups of the volume, deployment of the volume** — the deploy/acceptance
  tasks (§8 Q3).

---

## 2. Design

### 2.1 Module layout (all new files under `apps/invoicing/lib/db/`)

```
lib/db/connection.js                 the ONLY `node:sqlite` import. openDatabase(path, {timeoutMs}),
                                     transaction(db, fn). PRAGMAs at open. No SQL about entities.
lib/db/errors.js                     RepositoryError + NotFoundError, UniqueViolationError,
                                     ForeignKeyViolationError, InvalidStateError, ValidationError,
                                     MigrationError; mapSqliteError(err)
lib/db/migrate.js                    MIGRATIONS (ordered, static import list), SCHEMA_VERSION,
                                     migrate(db), schemaVersion(db)
lib/db/migrations/0001-initial.js    { version: 1, name: 'initial', up: `<DDL §2.4>` }
lib/db/money.js                      SUPPORTED_CURRENCIES, DEFAULT_CURRENCY, assertSupportedCurrency,
                                     assertMinorUnits, assertPositiveInteger — the ONE place
lib/db/database.js                   prepareDatabase(config) -> { db, applied }; probeDatabase(dbPath);
                                     createRepositories(db, { now, newId }); re-exports errors
lib/db/repositories/freelancers.js
lib/db/repositories/connected-accounts.js
lib/db/repositories/clients.js
lib/db/repositories/contracts.js
lib/db/repositories/invoices.js      invoices + line items + the state machine (§2.5)
lib/db/repositories/stripe-events.js
```

Twelve files, all matched by `SOURCE_EXT` (`.js`) — **no `.sql` files anywhere**:
under the AS-53 closed-world scan a `.sql` file is `unknown` and turns the suite red.
Migrations are JS modules exporting a string for the same reason, and because a
static import list (not a directory scan at boot) keeps the migration set a
reviewable literal.

Import direction (checked by reading, and by the dependency-policy rows in §2.9):
`connection.js` imports only `node:sqlite`; `errors.js` imports nothing;
`migrate.js` imports `connection.js`, `errors.js`, and the migration modules;
repositories import `connection.js` (for `transaction`), `errors.js`, and
`invoices.js` also `money.js`; `database.js` imports all of the above and is the
only module `server.js`, `lib/health.js`, and `test/helpers/server.js` import.
Nothing under `lib/db/` imports `lib/stripe/*`, `lib/config.js`, or Express.

### 2.2 Engine, driver, connection

**Engine/driver: SQLite via `node:sqlite` `DatabaseSync`** — the stack decision's Q2
verdict, verbatim: *"SQLite via the `node:sqlite` built-in. No dependency, no
service, no account, $0. AS-39 must keep all SQL behind a data-access module so the
engine is replaceable; reversal is trigger T6."* Zero new dependencies:
`package.json` and `package-lock.json` are untouched; `LOCK_ENTRIES` stays 70.
Stability on the pinned Node: measured above (no ExperimentalWarning, full
constraint/`STRICT`/json1 support on 24.20.0); the sibling app has run the same
API across 25+ merged tasks (`apps/chat/lib/store.js`).

`openDatabase(path, { timeoutMs = 5000 } = {})`:

```js
const db = new DatabaseSync(path, { timeout: timeoutMs });   // busy handler, measured
db.exec('PRAGMA journal_mode = wal');    // readers never block the single writer; sidecars removed on close (measured)
db.exec('PRAGMA foreign_keys = ON');     // default ON in this build, but a default is not a guarantee; no-op inside a tx, so here
return db;
```

`path` is whatever the caller passes — `config.dbPath` in the app, `':memory:'`
or a `mkdtemp` file in tests. The module never creates directories (§2.8: a
missing directory is a mis-mounted volume, and must fail loudly).

`transaction(db, fn)`:

```js
if (db.isTransaction) return fn();           // JOIN an open transaction — no nesting, no savepoints
db.exec('BEGIN IMMEDIATE');                  // take the write lock now; a second writer waits busy_timeout
try { const out = fn(); db.exec('COMMIT'); return out; }
catch (err) { db.exec('ROLLBACK'); throw err; }
```

Every repository method that writes more than one row (or reads-then-writes)
runs inside `transaction(db, …)`; a caller (AS-44) wraps several repository calls in
`repos.transaction(fn)` and the inner calls join it. Rejected: nested savepoints —
nothing in v1 needs partial rollback, and the join rule is one line.

### 2.3 Migrations

- **Format.** `lib/db/migrations/NNNN-<name>.js` exporting
  `{ version: <int>, name: '<name>', up: '<SQL, possibly multi-statement>' }`.
  No `down` — the product never migrates backwards; a bad migration is fixed forward.
- **Ordering.** `migrate.js` holds `export const MIGRATIONS = Object.freeze([m0001]);`
  — a static list, one line per migration. At module load it asserts versions are
  `1..n` contiguous and names unique, or throws `MigrationError` (a mis-numbered
  file fails every test at import, like `custody.js`'s load-time check).
  `export const SCHEMA_VERSION = MIGRATIONS.at(-1).version;`
- **Ledger.** `schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL,
  applied_at TEXT NOT NULL) STRICT`, created by the runner with `CREATE TABLE IF NOT
  EXISTS` before the transaction. `PRAGMA user_version` is deliberately unused: a
  table carries names and timestamps, and is readable by anyone with `sqlite3`.
- **Runner.** `migrate(db, migrations = MIGRATIONS)` → `{ applied: number[], head }`:
  1. create the ledger if missing;
  2. `transaction(db, …)` (`BEGIN IMMEDIATE` — a second process booting on the same
     file waits, then sees everything applied);
  3. read the ledger; if any recorded version is **greater than** `SCHEMA_VERSION`
     → `MigrationError` ("database is at schema version N, this build knows M") —
     never run old code against a newer schema; if a recorded version's name differs
     from the code's → `MigrationError` (a renamed migration is a different migration);
  4. for each migration in order not in the ledger: `db.exec(up)` then insert the
     ledger row with `applied_at = now()`;
  5. commit. DDL is transactional in SQLite, so a failing `up` leaves nothing behind.
- **Run-from-empty on `docker compose up`.** `server.js` calls
  `prepareDatabase(config)` = `openDatabase(config.dbPath)` + `migrate(db)` before
  `createApp`. First boot on a fresh volume: file created, `applied: [1]`. Every later
  boot: `applied: []`. Both are printed to the container log (§2.8) — that line is the
  operator's proof, and AC 3 reads it.
- **DB file location.** In the container `/app/data/invoicing.sqlite` (the config
  default). On the host: the Docker named volume `invoicing-data` (project-prefixed:
  `asc-invoicing_invoicing-data`). Never a bind mount, never under the checkout —
  the `apps/chat/data` lesson, and deploy-shape asserts no bind mount (§3.3).
- **What the `test` service uses.** Nothing shared. `test` has no volume; its
  `/app/data` is the image's own empty directory; tests use fresh `mkdtemp` files
  (`configFor` §2.10) or `:memory:`, and exactly one V3 test writes the real default
  path inside the ephemeral container and removes it. **A developer's data is never
  reachable from the suite** — there is no path from the `test` container to the
  volume, by construction, and deploy-shape pins `test.volumes === undefined`.
- **Recommended, not binding, for AS-40:** `0002-credentials.js` adds a 1:1
  `credentials` table and a `sessions` table rather than `ALTER TABLE freelancers
  ADD COLUMN password_hash` — SQLite cannot add a `NOT NULL` column without a default
  to a populated table, and a separate table keeps `freelancers` free of secrets.

### 2.4 Schema (migration 0001, exact DDL)

Conventions, decided once: **ids** are `crypto.randomUUID()` TEXT (36 chars), generated
in the repository via an injectable `newId` (deterministic tests; no sequential ids in
URLs). **Timestamps** are ISO-8601 UTC TEXT with milliseconds, exactly what
`new Date().toISOString()` produces — lexicographic order is chronological order, it
is readable in a `sqlite3` shell and in JSON with no conversion, and it is the
convention `apps/chat/lib/store.js` already uses; integer epoch was rejected as
opaque in the CLI and inconsistent with the sibling app. Stripe's epoch seconds are
converted at the boundary by AS-43/AS-44. **Booleans** are `INTEGER` 0/1 with a CHECK.
**JSON** is TEXT with `json_valid`. **Money** is integer minor units (`*_minor`) with a
`currency` per invoice; line items inherit the invoice's currency because Stripe
requires one currency per invoice. **All tables `STRICT`.** **No soft delete** (§1.2).
**Stripe id prefixes** (`acct_`, `cus_`, `in_`, `evt_`) are checked with `substr` — a
swapped-argument bug (a customer id in the account column) fails at the engine.

```sql
CREATE TABLE freelancers (
  id           TEXT PRIMARY KEY,
  email        TEXT NOT NULL CHECK (length(trim(email)) > 0),
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
) STRICT;
-- "email already registered" (Screen 1): unique, case-insensitively. Stored as typed.
CREATE UNIQUE INDEX freelancers_email_unique ON freelancers (lower(email));

CREATE TABLE connected_accounts (
  id                           TEXT PRIMARY KEY,
  freelancer_id                TEXT NOT NULL UNIQUE REFERENCES freelancers (id),   -- one account per freelancer in v1
  stripe_account_id            TEXT NOT NULL UNIQUE CHECK (substr(stripe_account_id, 1, 5) = 'acct_'),
  charges_enabled              INTEGER NOT NULL DEFAULT 0 CHECK (charges_enabled IN (0, 1)),
  details_submitted            INTEGER NOT NULL DEFAULT 0 CHECK (details_submitted IN (0, 1)),
  payouts_enabled              INTEGER NOT NULL DEFAULT 0 CHECK (payouts_enabled IN (0, 1)),
  requirements_currently_due   TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(requirements_currently_due)),
  requirements_disabled_reason TEXT,
  readiness_synced_at          TEXT,
  created_at                   TEXT NOT NULL,
  updated_at                   TEXT NOT NULL
) STRICT;

CREATE TABLE clients (
  id                 TEXT PRIMARY KEY,
  freelancer_id      TEXT NOT NULL REFERENCES freelancers (id),
  name               TEXT NOT NULL CHECK (length(trim(name)) > 0),
  email              TEXT NOT NULL CHECK (length(trim(email)) > 0),   -- NOT unique: duplicate is a non-blocking warning (S4/S6 client-dup states)
  stripe_customer_id TEXT UNIQUE CHECK (stripe_customer_id IS NULL OR substr(stripe_customer_id, 1, 4) = 'cus_'),  -- lazy, AS-43
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  UNIQUE (freelancer_id, id)          -- target of the composite FKs below
) STRICT;
CREATE INDEX clients_owner_email ON clients (freelancer_id, lower(email));   -- findByEmail + owner-scoped list

CREATE TABLE contracts (
  id            TEXT PRIMARY KEY,
  freelancer_id TEXT NOT NULL REFERENCES freelancers (id),
  client_id     TEXT NOT NULL,
  template_id   TEXT NOT NULL CHECK (length(trim(template_id)) > 0),
  variables     TEXT NOT NULL CHECK (json_valid(variables)),
  rendered_html TEXT NOT NULL CHECK (length(rendered_html) > 0),
  created_at    TEXT NOT NULL,                                           -- no updated_at: contracts are immutable (no draft)
  FOREIGN KEY (freelancer_id, client_id) REFERENCES clients (freelancer_id, id)   -- the client must belong to the same freelancer
) STRICT;
CREATE INDEX contracts_owner_created ON contracts (freelancer_id, created_at);

CREATE TABLE invoices (
  id                      TEXT PRIMARY KEY,
  freelancer_id           TEXT NOT NULL REFERENCES freelancers (id),
  client_id               TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'paid', 'void', 'uncollectible')),
  currency                TEXT NOT NULL CHECK (length(currency) = 3 AND currency = lower(currency)),   -- SHAPE only; the allowed SET is lib/db/money.js
  days_until_due          INTEGER NOT NULL CHECK (days_until_due > 0),
  stripe_invoice_id       TEXT UNIQUE CHECK (stripe_invoice_id IS NULL OR substr(stripe_invoice_id, 1, 3) = 'in_'),
  hosted_invoice_url      TEXT,
  invoice_pdf_url         TEXT,
  amount_due_minor        INTEGER CHECK (amount_due_minor IS NULL OR amount_due_minor >= 0),    -- Stripe's, after finalize
  amount_paid_minor       INTEGER CHECK (amount_paid_minor IS NULL OR amount_paid_minor >= 0),
  due_at                  TEXT,
  finalized_at            TEXT,
  sent_at                 TEXT,
  paid_at                 TEXT,
  voided_at               TEXT,
  marked_uncollectible_at TEXT,
  last_payment_failed_at  TEXT,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL,
  FOREIGN KEY (freelancer_id, client_id) REFERENCES clients (freelancer_id, id),
  CHECK (status = 'draft' OR stripe_invoice_id IS NOT NULL)              -- every non-draft state is Stripe's
) STRICT;
CREATE INDEX invoices_owner_created ON invoices (freelancer_id, created_at);

CREATE TABLE invoice_line_items (
  id                TEXT PRIMARY KEY,
  invoice_id        TEXT NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  position          INTEGER NOT NULL CHECK (position >= 0),
  description       TEXT NOT NULL CHECK (length(trim(description)) > 0),
  quantity          INTEGER NOT NULL CHECK (quantity > 0),
  unit_amount_minor INTEGER NOT NULL CHECK (unit_amount_minor >= 0),
  UNIQUE (invoice_id, position)
) STRICT;

CREATE TABLE stripe_events (
  id           TEXT PRIMARY KEY CHECK (substr(id, 1, 4) = 'evt_'),   -- the Stripe event id IS the idempotency key (AS-44)
  type         TEXT NOT NULL CHECK (length(trim(type)) > 0),
  processed_at TEXT NOT NULL
) STRICT;
```

Why each non-obvious choice:

- `freelancers_email_unique` on `lower(email)`: uniqueness is what "email already
  registered" needs; storing as typed loses nothing. `findByEmail` uses the same
  expression so the index serves the login lookup (AS-40).
- `connected_accounts.freelancer_id UNIQUE`: v1 is one Stripe account per freelancer
  (Screen 2 has one connect flow). Lifting it later is a migration that drops one
  constraint, not a data change.
- `clients.email` deliberately NOT unique, per `02-states-ledger.md` (the duplicate
  email states are a warning with "create anyway"). `clients_owner_email` on
  `(freelancer_id, lower(email))` is what the warning's lookup and the owner-scoped
  list read.
- **Composite FKs `(freelancer_id, client_id) → clients (freelancer_id, id)`** on
  `contracts` and `invoices`: the engine enforces "the invoice's client belongs to
  the invoice's freelancer", the S5-DENIED-NOTOWNER class of bug, without an
  application check. It requires `UNIQUE (freelancer_id, id)` on `clients`.
- `contracts` has no `updated_at` and no update method: contracts have no draft
  (`00-flows.md`, Screen 6 generates atomically). `rendered_html` is stored so a
  later template change never alters an issued contract; `variables` is stored so
  AS-42 can show what was filled in.
- `invoices.status` is Stripe's five-value set, not a local vocabulary: the mirror
  stores Stripe's truth and Screen 5's three displays (`Draft`, `Sent — awaiting
  payment`, `Paid`) are a projection of it (`open` + `sent_at` → "Sent").
- `CHECK (status = 'draft' OR stripe_invoice_id IS NOT NULL)`: a row cannot leave
  draft without a Stripe invoice behind it; it is the mirror's defining invariant,
  and it is the one table-level CHECK.
- `currency` CHECK is shape only (`usd`, not `USD`). The allowed SET lives in exactly
  one place, `money.js` (§2.6) — a DDL CHECK on the set would make "add EUR" a
  table-rebuild migration (SQLite cannot alter a CHECK), which is the foreclosure
  row C-32 forbids.
- `amount_due_minor` / `amount_paid_minor` are NULL until Stripe reports them; the
  draft total is derived (`Σ quantity × unit_amount_minor`) by the mapper, never stored
  twice.
- `invoice_line_items`: surrogate id + `UNIQUE (invoice_id, position)`; replaced as a
  set inside a transaction on draft edit (S4-DEFAULT-EDIT re-populates from these
  rows). `ON DELETE CASCADE` is the only cascade in the schema — there is no delete
  path in v1, but a line item without an invoice must be impossible if one is added.
- `stripe_events`: the table the description calls "processed-webhook-event". Named
  for what the rows are — processed Stripe events — not for the delivery channel;
  AS-44's dedupe key is the `evt_` id, which is the primary key, so duplicate
  delivery is a primary-key conflict caught by `ON CONFLICT DO NOTHING` (§2.5). One
  timestamp: a row exists iff the event was processed, atomically with its effects,
  because `recordOnce` joins the caller's transaction (§2.2).
- Indexes: only what a v1 query reads. No child-column FK indexes for the FK
  parents that are never deleted or re-keyed (`freelancers`, `clients`).

### 2.5 Repository surface (signatures; the row shapes are camelCase plain objects)

`createRepositories(db, { now = () => new Date().toISOString(), newId = () => randomUUID() } = {})`
returns a frozen object with exactly these seven keys (asserted in tests, V2):

```
transaction(fn)                                           -> fn's return; BEGIN IMMEDIATE / COMMIT / ROLLBACK; joins an open tx

freelancers.create({ email, displayName })                -> Freelancer         ValidationError | UniqueViolationError
freelancers.getById(id)                                   -> Freelancer         NotFoundError
freelancers.findByEmail(email)                            -> Freelancer | null  (case-insensitive; AS-40's login lookup)
freelancers.update(id, { displayName })                   -> Freelancer         NotFoundError | ValidationError

connectedAccounts.create({ freelancerId, stripeAccountId })            -> ConnectedAccount   ForeignKeyViolationError | UniqueViolationError | ValidationError
connectedAccounts.getByFreelancer(freelancerId)                        -> ConnectedAccount | null
connectedAccounts.getByStripeAccountId(stripeAccountId)                -> ConnectedAccount | null   (AS-44 account.updated)
connectedAccounts.updateReadiness(stripeAccountId, { chargesEnabled, detailsSubmitted, payoutsEnabled,
                                  requirementsCurrentlyDue, requirementsDisabledReason, syncedAt })
                                                                       -> ConnectedAccount   NotFoundError | ValidationError

clients.create(freelancerId, { name, email })             -> Client             ForeignKeyViolationError | ValidationError
clients.getById(freelancerId, id)                         -> Client             NotFoundError (missing OR not owned — same error)
clients.listByFreelancer(freelancerId)                    -> Client[]           ordered by lower(name), id
clients.findByEmail(freelancerId, email)                  -> Client[]           case-insensitive; the duplicate-warning source
clients.update(freelancerId, id, { name?, email? })       -> Client
clients.setStripeCustomerId(freelancerId, id, cus)        -> Client             InvalidStateError if a DIFFERENT cus_ is already set; idempotent for the same

contracts.create(freelancerId, { clientId, templateId, variables, renderedHtml })
                                                          -> Contract           NotFoundError('client') | ValidationError
contracts.getById(freelancerId, id)                       -> Contract           (with variables parsed, renderedHtml)
contracts.listByFreelancer(freelancerId)                  -> ContractSummary[]  (no renderedHtml / variables), newest first

invoices.createDraft(freelancerId, { clientId, daysUntilDue, lineItems, currency = DEFAULT_CURRENCY })
                                                          -> Invoice            NotFoundError('client') | ValidationError
invoices.getById(freelancerId, id)                        -> Invoice            (lineItems included, totalMinor derived)
invoices.listByFreelancer(freelancerId)                   -> InvoiceSummary[]   (no lineItems; totalMinor derived), newest first
invoices.updateDraft(freelancerId, id, { clientId?, daysUntilDue?, lineItems? })
                                                          -> Invoice            InvalidStateError unless status='draft' AND stripeInvoiceId IS NULL
invoices.attachStripeInvoice(freelancerId, id, stripeInvoiceId)
                                                          -> Invoice            InvalidStateError unless draft with no id yet; UniqueViolationError; ValidationError
invoices.getByStripeInvoiceId(stripeInvoiceId)            -> Invoice | null     (AS-44; no owner — a webhook has no session)
invoices.applyStripeSnapshot(stripeInvoiceId, snapshot)   -> { outcome: 'applied' | 'fields' | 'stale' | 'conflict', from, to, invoice }
                                                                                NotFoundError | ValidationError (unknown status or unknown key)

stripeEvents.recordOnce(eventId, type)                    -> boolean            true = first sight (row written); false = duplicate (nothing written)
stripeEvents.has(eventId)                                 -> boolean
```

Rules that hold across the surface:

- **No raw SQL to callers.** Callers receive plain objects; SQL text exists only under
  `lib/db/` (mechanically: §2.9's `raw SQL` concept row). The `DatabaseSync` handle
  is held by the composition root for `close()` and by tests; routes get `repos`.
- **Owner scoping.** Every read of a client, contract, or invoice by id takes
  `freelancerId` first and returns `NotFoundError` for "missing" and "not yours"
  alike — S5-DENIED-NOTOWNER renders as not-found by design. Lookups by Stripe id
  (`getByStripeAccountId`, `getByStripeInvoiceId`, `applyStripeSnapshot`) take no owner
  because their caller is a webhook with no session; they are keyed on UNIQUE columns.
- **Validation before SQL.** Each method validates its inputs and throws
  `ValidationError(field, problem)` first; the DDL CHECKs are the backstop and are
  proven separately by raw-SQL tests (§2.10 X-group).
- **Timestamps** come from the injected `now()`; `updated_at` is set on every update.
  Nothing calls `datetime('now')`.
- **Errors** (`errors.js`), all `extends RepositoryError` with a stable `code`:
  `not_found`, `unique_violation`, `foreign_key_violation`, `invalid_state`,
  `validation`, `migration`. `mapSqliteError(err)` maps `ERR_SQLITE_ERROR` by
  `errcode`: 2067/1555 → `UniqueViolationError(constraint)` (constraint text parsed
  after `failed: `), 787 → `ForeignKeyViolationError`, 275 → `ValidationError`
  (a CHECK the validator should have caught — still a 4xx, never a 500), 3091 →
  `ValidationError` (STRICT type); anything else is rethrown unchanged.

**Invoice state machine** (`invoices.js`; the only writer of `status` after creation
is `applyStripeSnapshot`):

```
states  draft ─► open ─► paid
                  │  └──► uncollectible ─► paid
                  │          └──────────► void
                  └──► void
rank    draft 0 · open 1 · uncollectible 2 · paid 3 · void 3
```

The rank order encodes exactly Stripe's documented invoice transitions
(draft→open; open→paid|void|uncollectible; uncollectible→paid|void; paid and void
terminal): every allowed transition goes UP in rank, and the only same-rank pair
(`paid`, `void`) is the one pair with no transition between them.
`applyStripeSnapshot(stripeInvoiceId, snapshot)` compares `rank(snapshot.status)` to
`rank(current.status)`:

| Comparison | Outcome | Written |
|---|---|---|
| incoming > current | `applied` | `status` + every field present in the snapshot + `updated_at` |
| equal, same status | `fields` | the snapshot's fields (e.g. `sentAt` on an `open` invoice) + `updated_at` |
| equal, different status (`paid` vs `void`) | `conflict` | **nothing** |
| incoming < current | `stale` | **nothing** — not even fields; an older snapshot must not overwrite newer ones |

This is what makes the description's out-of-order case converge: `invoice.paid`
arriving before `invoice.finalized` moves the mirror `draft → paid` (skip-ahead is
just "up in rank"), and the later `finalized` snapshot is `stale`. A `conflict` is
returned, not thrown, because a webhook consumer cannot resolve it locally (§8 Q6).

Snapshot keys (exact; an unknown key is a `ValidationError`, so `invoicePdf` vs
`invoicePdfUrl` cannot silently drop a field): `status` (required),
`hostedInvoiceUrl`, `invoicePdfUrl`, `amountDueMinor`, `amountPaidMinor`, `dueAt`,
`finalizedAt`, `sentAt`, `paidAt`, `voidedAt`, `markedUncollectibleAt`,
`lastPaymentFailedAt`. Mapping a Stripe invoice object onto a snapshot (epoch
seconds → ISO, `invoice_pdf` → `invoicePdfUrl`, `status_transitions.*`) is AS-43/
AS-44's job — Stripe shapes stay out of `lib/db/`.

Who writes what: **AS-43** — `createDraft`/`updateDraft` (via the UI), `attachStripeInvoice`
after `POST /v1/invoices`, then `applyStripeSnapshot` with the finalize response
(→ `open`, urls, `finalizedAt`) and again after send (`sentAt`). **AS-44** —
`applyStripeSnapshot` for `invoice.*` events and `updateReadiness` for
`account.updated`, each inside `repos.transaction` with `stripeEvents.recordOnce`.
Draft-side fields (`client_id`, `days_until_due`, line items) are writable only by
`updateDraft`, only while `status = 'draft'` and `stripe_invoice_id IS NULL` — once
a Stripe invoice is attached the local draft is frozen (finalization in progress)
and `updateDraft` throws `InvalidStateError`.

### 2.6 Readiness flags and the multi-currency non-foreclosure

**Readiness** is stored as the three Stripe booleans plus `requirements_currently_due`
(JSON array of requirement keys) and `requirements_disabled_reason`, all written by
`updateReadiness` (AS-41 on return/refresh and AS-44 on `account.updated`). The one
derived rule lives in the row mapper, so AS-43 ("may finalize") and Screen 2 read
the same boolean:

```js
ready: chargesEnabled === true && requirementsCurrentlyDue.length === 0
```

`payouts_enabled` and `details_submitted` are stored for Screen 2's copy, not for
the gate; the gate is exactly the description's pair ("charges_enabled, outstanding
requirements"). `readiness_synced_at` records when the flags were last confirmed
against Stripe, so a stale row is distinguishable from a fresh one.

**Currency** is enforced in ONE place: `lib/db/money.js`

```js
export const SUPPORTED_CURRENCIES = Object.freeze(['usd']);
export const DEFAULT_CURRENCY = 'usd';
export function assertSupportedCurrency(code) { … ValidationError('currency', …) }
export function assertMinorUnits(value, field) { … Number.isSafeInteger(value) && value >= 0 … }
export function assertPositiveInteger(value, field) { … }
```

`invoices.createDraft` calls `assertSupportedCurrency` and stores the value on the
row; every query afterwards reads the column. No query contains the literal `'usd'`
— the dependency-policy money-words row (§2.9) confines the words to four files, and
a grep for `'usd'` in `lib/db/repositories/` must find zero hits (AC 8). Adding a
currency later is one entry in `SUPPORTED_CURRENCIES` plus whatever Stripe-side work
AS-43 needs; the schema needs nothing.

### 2.7 Health: the `database` check

`lib/health.js` gains one row, exactly as its own comment promised ("AS-39 appends a
`database` row without touching the route"):

```js
Object.freeze({ name: 'database', run(config) { return probeDatabase(config.dbPath); } }),
```

`probeDatabase(dbPath)` (in `database.js`) returns `true | { ok: false, detail }` and,
in order, so each failure names its cause:

1. `statSync(dbPath)` must succeed and be a regular file → else `detail: '<path>: ENOENT'`
   (or whatever the code is). **The probe never opens a missing file** — opening
   would create it, and a health check must never write.
2. `accessSync(dbPath, W_OK)` and `accessSync(dirname(dbPath), W_OK)` — the WAL
   sidecars need the directory; a volume remounted read-only shows here as `EROFS`,
   a wrong owner as `EACCES`. (Measured: a `readOnly` connection accepts `BEGIN
   IMMEDIATE`, so a transaction would NOT detect this.)
3. `openDatabase(dbPath, { timeoutMs: 1000 })`, `schemaVersion(db)` must equal
   `SCHEMA_VERSION` → else `detail: 'schema version N, this build expects M'`; a
   non-database file surfaces here as errcode 26 → detail carries the message.
4. `close()` in `finally`.

A second short-lived connection per `/healthz` call is the deliberate design: it
verifies the preconditions supplied from OUTSIDE the process (mount, ownership,
file, schema) — the health design rule in `health.js` — which a live handle cannot
see. When AS-40 gives the app a live handle, a `SELECT 1` on it can be added to
the same row (§8 Q1).

**AS-58 interaction, on the record:** `/healthz` returns `config.redacted()`, so the
new `dbPath` (a non-secret path) appears in the body. That is AS-58 item 4's
pre-existing exposure question, widened by one path; this task neither hides the
config nor pre-empts AS-58's decision. QA notes it in the review comment.

### 2.8 Boot and shutdown (`server.js`)

```js
const config = loadConfig();
const { db, applied } = prepareDatabase(config);      // open + migrate, BEFORE the app exists
console.log(`database ${config.dbPath}: schema v${SCHEMA_VERSION}, applied ${applied.length} migration(s)`);
const app = createApp(config);
const server = app.listen(config.port, config.bind, () => console.log(startupLogLine(config)));
process.on('SIGTERM', () => server.close(() => { db.close(); process.exit(0); }));
```

- A missing directory (`INVOICING_DB_PATH=/nonexistent/x.sqlite`) fails at
  `openDatabase` with errcode 14 and the path in the message; the process exits
  non-zero. **Never `mkdir`**: creating the directory would put the data in the
  container layer and lose it on recreate — a mis-mounted volume must be loud.
- The `SIGTERM` handler matters because `node` is PID 1 (`CMD ["node","server.js"]`,
  no init): without a handler PID 1 ignores SIGTERM and `docker compose stop` waits
  the 10 s grace then SIGKILLs. With it, `stop` returns immediately and the WAL is
  checkpointed by `close()`. AC 19 measures it.
- `createApp(config)` keeps its signature. Nothing in this task consumes a handle
  inside the app, and an unused parameter is an unused exemption. Recommended
  shape for AS-40 (first consumer), not binding: `createApp(config, { repos })` with
  `repos = createRepositories(db)` built once here, next to `prepareDatabase`.
- `server.js`'s header comment ("loadConfig() → createApp() → listen(). Anything
  more than that belongs in app.js or a route module") is amended to the new
  sequence; the principle (the entrypoint composes, it does not implement) stands.

### 2.9 Keeping the dependency-policy guard honest (`test/dependency-policy.test.js`)

1. **`node:sqlite` sanctioned in exactly one file.**
   `scanConcept('node:sqlite', /(from|require\s*\(|import\s*\()\s*['"]node:sqlite['"]/, ['lib/db/connection.js'])`.
   Green with the driver present (V2: the exemption must be USED — an empty
   `connection.js` would fail); red with a second import anywhere (M1).
2. **Money words in exactly the files that must carry them** (RAW text, comments
   count): `['lib/db/migrations/0001-initial.js', 'lib/db/money.js',
   'lib/db/repositories/invoices.js', 'lib/stripe/custody.js']`. Every other new file
   — `database.js`, `connection.js`, `errors.js`, `migrate.js`, the five other
   repositories, `health.js`, `config.js`, `compose.yaml`, `Dockerfile` — must not
   contain `amount`, `currency`, or `money` even in a comment. The implementer
   greps before committing (`grep -rniE 'amount|currency|money' apps/invoicing/lib
   apps/invoicing/compose.yaml apps/invoicing/Dockerfile` lists exactly the four).
3. **New concept row — `raw SQL`.** SQL statements may appear only under `lib/db/`:
   ```js
   scanConcept('raw SQL', /\b(SELECT\s+[\w*(),. ]+\s+FROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+(TABLE|INDEX|UNIQUE)|PRAGMA)\b/,
     ['lib/db/connection.js', 'lib/db/migrate.js', 'lib/db/migrations/0001-initial.js',
      'lib/db/repositories/clients.js', 'lib/db/repositories/connected-accounts.js', 'lib/db/repositories/contracts.js',
      'lib/db/repositories/freelancers.js', 'lib/db/repositories/invoices.js', 'lib/db/repositories/stripe-events.js']);
   ```
   Nine files, each of which MUST contain SQL (V2) — `database.js`, `errors.js`,
   `money.js` must not (the probe reads the version through `schemaVersion(db)` from
   `migrate.js`). This is the stack decision's "all SQL behind a data-access module"
   (T6) as a mechanical rule for AS-40–44. Planted SQL in a route is red (M15).
4. **Source list** `14 → 26`, exact sorted list (§4). `unknown` stays `[]` — no `.sql`,
   no stray files.
5. **Unchanged literals, asserted still true**: `LOCK_ENTRIES` 70, `DIRECT_DEPENDENCIES`
   `['ejs','express']`, manifests exactly 3, `SANCTIONED.length` 3, `/webhook route`
   `[]`, `STRIPE_ config key` list, `application_fee` list, 1,200-line cap.
6. Test name 'the Stripe concepts live exactly where AS-38 put them, and nothing
   AS-39 or AS-44 owns has leaked in' → '…where AS-38 and AS-39 put them, and nothing
   AS-44 owns has leaked in'; the comment "AS-44's webhook route and AS-39's database
   are not here yet" → "AS-44's webhook route is not here yet".

### 2.10 Tests

`test/db.test.js` (D), each against a fresh `mkdtemp` file unless stated:

| # | Asserts |
|---|---|
| D1 | `openDatabase(file)`: `journal_mode` = `wal`, `foreign_keys` = 1, `busy_timeout` = 5000; `openDatabase(':memory:')`: `foreign_keys` = 1 |
| D2 | `MIGRATIONS.length === 1`; versions contiguous from 1; names unique; `SCHEMA_VERSION === 1` |
| D3 | migrate from empty: file absent before; after: ledger exactly `[{version:1,name:'initial'}]`; `sqlite_master` tables exactly the 8 names (sorted, cardinality first); indexes exactly the 5 named ones; **every table's `sql` ends in `STRICT`** (zero non-STRICT) |
| D4 | second `migrate`: `applied` `[]`; ledger and `sqlite_master` byte-identical to D3 |
| D5 | ledger row with version `SCHEMA_VERSION + 1` → `migrate` throws `MigrationError` naming both versions; nothing applied |
| D6 | ledger row renamed → `MigrationError` |
| D7 | `transaction`: commit on return; rollback on throw (row absent, error rethrown, `isTransaction` false after); JOIN: an inner `transaction` inside an open one does not `BEGIN`, and the outer rollback undoes the inner's writes |
| D8 | `mapSqliteError` table via raw statements: 2067 (expression index), 1555, 787, 275, 3091 → the mapped class and `code`; a plain `Error` passes through unchanged |
| D9 | `probeDatabase` on a migrated file → `true` |
| D10 | missing file → `{ok:false, detail:/ENOENT/}` **and `existsSync` is still false afterwards** |
| D11 | unwritable directory (`chmodSync(dir, 0o500)`, after asserting `process.getuid() !== 0`; restored in `finally`) → detail `/EACCES/` |
| D12 | version ahead (ledger head N+1) → detail `/schema version/` |
| D13 | a file that is not a database (`writeFileSync(path, 'not a database')`) → `ok:false`, detail non-empty |
| D14 | `prepareDatabase(configFor({ dbPath: '/nonexistent/dir/x.sqlite' }))` throws; message contains the path; no directory created |
| D15 | `prepareDatabase` return shape `{ db, applied: [1] }` then `{ applied: [] }` on the same path |
| D16 | `GET /healthz` via `withServer(configFor())` → 200, exactly four checks, names `['config','vendor_assets','views','database']` |
| D17 | delete the DB file after boot → `GET /healthz` 503 with `failing === ['database']` only |
| D18 | **V3 — the real path.** `SCHEMA` default is `/app/data/invoicing.sqlite`; file absent before (the image ships no database); `process.getuid() !== 0`; `prepareDatabase(loadConfig({}))` → `applied [1]`; `withServer` on that config → healthz 200; `finally`: close, `rmSync` the file and sidecars. Runs in the mountless `test` service, so it is a statement about the image's `/app/data` ownership |

`test/repositories.test.js` — setup per test: `openDatabase(':memory:')`, `migrate`,
`createRepositories(db, { now: fixed/advanceable clock, newId: counter })`:

| Group | Cases |
|---|---|
| F freelancers (7) | create shape + ISO timestamps; getById; NotFound `code`; findByEmail case-insensitive and `null`; duplicate email exact → Unique; duplicate differing only in case → Unique; empty email / displayName → Validation; update bumps `updatedAt` with the clock advanced |
| A accounts (7) | create defaults (flags false, due `[]`, `ready` false, `syncedAt` null); second account same freelancer → Unique; same `acct_` for another freelancer → Unique; unknown freelancer → FK; malformed id → Validation; `updateReadiness` writes all fields and the **`ready` truth table** (charges × due: 4 rows, exactly one true); unknown acct → NotFound; getByStripeAccountId |
| C clients (8) | create; getById other owner → NotFound; listByFreelancer returns 2 of 3 (cardinality); findByEmail returns BOTH duplicates (email not unique — the warning, not a block); update; `setStripeCustomerId` once, same again ok, different → InvalidState, duplicate `cus_` across clients → Unique, malformed → Validation; unknown freelancer → FK |
| K contracts (5) | create + JSON round trip; client of another owner → NotFound('client'); `variables` not a plain object → Validation; getById owner-scoped; listByFreelancer summaries omit `renderedHtml`; `repos.contracts.update === undefined` (no draft, no edit) |
| I invoices (16) | createDraft 2 items → `draft`, `usd`, `totalMinor`, positions 0..1; currency `'eur'` → Validation and `SUPPORTED_CURRENCIES` deepEqual `['usd']`; zero items / qty 0 / negative unit / fractional / `daysUntilDue` 0 → Validation; client of another owner → NotFound; getById owner-scoped; list summaries with `totalMinor`; updateDraft replaces items atomically (old positions gone, count exact); updateDraft on `open` → InvalidState; attachStripeInvoice sets id; twice → InvalidState; malformed → Validation; duplicate `in_` → Unique; updateDraft after attach → InvalidState; snapshot draft→open `applied` with fields; open→paid `applied`; **paid then `open` → `stale`, nothing changed (fields and `updatedAt` identical)**; **paid-before-finalized converges**: attached draft + `paid` snapshot → `paid`; then the `open` finalize snapshot → `stale`; final `paid`, url from the first snapshot retained; same status → `fields` (`sentAt` set); `paid` vs `void` → `conflict`, nothing written; unknown status / unknown key → Validation; unknown `in_` → NotFound; getByStripeInvoiceId |
| E events (4) | recordOnce true then false; `has`; malformed id → Validation; recordOnce inside a rolled-back `repos.transaction` leaves no row (a failed apply lets Stripe's retry through) |
| X raw DDL backstops (8) | via `db.prepare` on the migrated db, bypassing validators: status `'bogus'` → 275; currency `'USD'` → 275; `open` without `stripe_invoice_id` → 275; composite FK owner mismatch → 787 (invoices AND contracts); line item qty 0 → 275; `stripe_events` bad prefix → 275; text into INTEGER → 3091; raw `DELETE FROM invoices` cascades to its line items (count before/after) |
| Z cross-cutting (3) | timestamps match `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/`; ids are UUIDs when `newId` is not injected; `Object.keys(createRepositories(db))` deepEqual the seven keys |

`test/helpers/server.js`:
- `configFor(overrides)` gains `dbPath`. **When `overrides.dbPath` is undefined it is
  set to a fresh `join(mkdtempSync(join(tmpdir(), 'asc-invoicing-db-')), 'invoicing.sqlite')`**
  — the one documented exception to "no overrides = the real container configuration",
  because `node --test` runs files in parallel processes and a shared file would make
  row counts flaky. D18 passes the real path explicitly, read from `SCHEMA`.
- `preparedConfigFor(overrides)` = `configFor` + `prepareDatabase` + `close` — a
  migrated file on disk for check-level tests that never start a server (the
  hand-built-config test in `health.test.js`).
- `withServer(config, fn)`: `const { db } = prepareDatabase(config)` BEFORE
  `createApp`, mirroring boot; `db.close()` in the `finally` after `server.close`.

---

## 3. Compose, Dockerfile, config

### 3.1 `apps/invoicing/compose.yaml` — exact additions (strict-parser subset: block
sequences of scalars, no inline maps, comments on their own lines)

Under `services.web`, after the `ports:` block:

```yaml
    # The database lives on a named volume, never a bind mount: a bind mount
    # would put the product's data in the checkout (the apps/chat/data lesson).
    # The path inside the container is the config default for INVOICING_DB_PATH;
    # test/deploy-shape.test.js pins the Dockerfile, this mount and that default
    # to one another.
    volumes:
      - invoicing-data:/app/data
```

Top level, after the `networks:` block (end of file):

```yaml
volumes:
  invoicing-data:
```

Nothing else changes: `test` gets **no** volume and **no** new environment;
`web.environment` stays exactly its three entries (the default `dbPath` is the one
source of truth — setting `INVOICING_DB_PATH` in compose would be a second copy of
the same path, §8 Q7); `stripe-mock` and `contract` untouched. The comment text
contains none of `amount|currency|money` (the compose file is a scanned manifest).

### 3.2 `apps/invoicing/Dockerfile` — exact addition, immediately before `USER node`

```dockerfile
# The database directory. A fresh named volume mounted here inherits this
# ownership (measured 2026-09-01: uid 1000, mode 755, and the `node` user creates
# the WAL database in it). Without this line the volume would be root-owned and
# the first boot would fail at open with SQLITE_CANTOPEN. The `test` service
# mounts nothing here, so the suite writes to the image's own empty copy and
# never touches a developer's data.
RUN mkdir -p /app/data && chown node:node /app/data
```

`COPIES` stays 9 (`COPY apps/invoicing/lib ./lib` already carries `lib/db/`);
`.dockerignore` (root, 6 patterns) unchanged.

### 3.3 `apps/invoicing/lib/config.js` — one SCHEMA row, inserted after `publicDir`
and before `stripeSecretKey`

```js
  { key: 'dbPath', envVar: 'INVOICING_DB_PATH', type: 'path', default: '/app/data/invoicing.sqlite' },
```

`type: 'path'` already requires a leading `/`, so `:memory:` and relative paths are
rejected at load (`ConfigError` naming `INVOICING_DB_PATH`) — a production process
cannot be pointed at an in-memory database by a typo. Not secret, not required;
`redacted()` shows it; `startupLogLine` prints it unchanged. `SCHEMA.length` 8 → 9.

### 3.4 `test/deploy-shape.test.js` pins the three together

- `web.volumes` deepEqual `['invoicing-data:/app/data']`; `Object.keys(COMPOSE.volumes)`
  deepEqual `['invoicing-data']`; `COMPOSE.volumes['invoicing-data'] === null` (a bare
  key: a plain local volume, no driver options); **no bind mounts anywhere**: every
  `volumes` entry across all services has a source that does not start with `/` or `.`.
- `test.volumes`, `stripe-mock.volumes`, `contract.volumes` remain `undefined`.
- Dockerfile: `assert.match(DOCKERFILE_CODE, /^RUN mkdir -p \/app\/data && chown node:node \/app\/data$/m)`
  and its index is less than the index of `USER node` (ownership before the user switch).
- Consistency: `dirname(SCHEMA.find((r) => r.key === 'dbPath').default) === '/app/data'`
  and equals the mount target parsed from the `web` volume string — one literal in
  config, checked against compose and Dockerfile, never a fourth copy.

---

## 4. Key files

| File | Change |
|---|---|
| `apps/invoicing/lib/db/connection.js` | NEW. The one `node:sqlite` import: `openDatabase`, `transaction` (§2.2) |
| `apps/invoicing/lib/db/errors.js` | NEW. Error classes + `mapSqliteError` (§2.5) |
| `apps/invoicing/lib/db/migrate.js` | NEW. `MIGRATIONS`, `SCHEMA_VERSION`, `migrate`, `schemaVersion`; load-time contiguity check (§2.3) |
| `apps/invoicing/lib/db/migrations/0001-initial.js` | NEW. The §2.4 DDL, verbatim, as `up` |
| `apps/invoicing/lib/db/money.js` | NEW. `SUPPORTED_CURRENCIES`, `DEFAULT_CURRENCY`, three assert helpers (§2.6) |
| `apps/invoicing/lib/db/database.js` | NEW. `prepareDatabase`, `probeDatabase`, `createRepositories`; re-exports errors and `SCHEMA_VERSION`. No SQL text |
| `apps/invoicing/lib/db/repositories/freelancers.js` | NEW (§2.5) |
| `apps/invoicing/lib/db/repositories/connected-accounts.js` | NEW; `ready` derived in the mapper (§2.6) |
| `apps/invoicing/lib/db/repositories/clients.js` | NEW; `setStripeCustomerId` idempotency rule |
| `apps/invoicing/lib/db/repositories/contracts.js` | NEW; immutable, owner pre-check → `NotFoundError('client')` |
| `apps/invoicing/lib/db/repositories/invoices.js` | NEW; line items, `STATUS_RANK`, `applyStripeSnapshot`, `assertEditableDraft(row)` on its own pinned line (§6 M8) |
| `apps/invoicing/lib/db/repositories/stripe-events.js` | NEW; `INSERT … ON CONFLICT DO NOTHING`, `changes === 1` |
| `apps/invoicing/lib/config.js` | +1 SCHEMA row `dbPath` (§3.3) |
| `apps/invoicing/lib/health.js` | +`database` row; import `probeDatabase`; line-22 comment "NOT checked… the database (AS-39's)" → removed/amended |
| `apps/invoicing/server.js` | `prepareDatabase` before `createApp`; database log line; `SIGTERM` handler; header comment amended (§2.8) |
| `apps/invoicing/compose.yaml` | `web.volumes`, top-level `volumes` (§3.1) |
| `apps/invoicing/Dockerfile` | `RUN mkdir -p /app/data && chown node:node /app/data` before `USER node` (§3.2) |
| `apps/invoicing/README.md` | Layout tree gains `lib/db/`; "AS-39 owns data" obligation bullet (lines ~228–230) rewritten as landed — how to add a migration (new file + one line in `MIGRATIONS`), where the data lives (`asc-invoicing_invoicing-data`), **`docker compose down -v` destroys it**; the four-check `/healthz` |
| `apps/invoicing/test/db.test.js` | NEW. D1–D18 (§2.10) |
| `apps/invoicing/test/repositories.test.js` | NEW. F/A/C/K/I/E/X/Z groups (§2.10) |
| `apps/invoicing/test/helpers/server.js` | `configFor` mkdtemp `dbPath` default; `preparedConfigFor`; `withServer` prepares/closes the db (§2.10) |
| `apps/invoicing/test/config.test.js` | `SCHEMA.length` 8→9; key list gains `'dbPath'` after `'publicDir'`; `prefixed.length` 7→8; defaults deepEqual + `dbPath: '/app/data/invoicing.sqlite'`; overrides deepEqual + `dbPath: '/elsewhere/data/invoicing.sqlite'` with `INVOICING_DB_PATH` in the env block; test name "exactly the eight settings AS-37 and AS-38 define" → "nine … AS-37, AS-38 and AS-39"; `required` `[]` and secrets `['INVOICING_STRIPE_SECRET_KEY']` unchanged; NEW: `INVOICING_DB_PATH=data/x.sqlite` and `:memory:` both throw `ConfigError` naming `INVOICING_DB_PATH` |
| `apps/invoicing/test/health.test.js` | `HEALTH_CHECKS.length` 3→4; names + `'database'`; line-36 `/stripe\|database\|db/i` zero-count split: stripe zero-count kept, `database` count `=== 1`; 'all three checks' → four; the hand-built-config test (line ~122) switches `configFor()` → `preparedConfigFor()` so `failing(result)` stays exactly `['config']`; database failure-path tests live in `db.test.js` (D9–D17) |
| `apps/invoicing/test/harness.test.js` | `EXPECTED_TEST_FILES` 8→10 (`db.test.js` after `config.test.js`, `repositories.test.js` after `health.test.js`); `found.length` 8→10 and the message; "these eight files" → ten |
| `apps/invoicing/test/deploy-shape.test.js` | line ~240 `web.volumes === undefined` → the §3.4 assertions; test name 'publishes 8348 on loopback and mounts nothing' → '…and mounts exactly the data volume'; comment "declares no volumes" amended; NEW Dockerfile/consistency test (§3.4); `test.volumes` undefined KEPT |
| `apps/invoicing/test/dependency-policy.test.js` | `source.length` 14→26 with the exact sorted list below; `node:sqlite` allowlist `[]`→`['lib/db/connection.js']`; money allowlist → the four files (§2.9); NEW `raw SQL` row (9 files); test name + comment (§2.9 item 6); `LOCK_ENTRIES` 70, manifests 3, `SANCTIONED` 3 unchanged |

The 26 source files (sorted, `dependency-policy.test.js` literal):
`app.js, lib/config.js, lib/db/connection.js, lib/db/database.js, lib/db/errors.js,
lib/db/migrate.js, lib/db/migrations/0001-initial.js, lib/db/money.js,
lib/db/repositories/clients.js, lib/db/repositories/connected-accounts.js,
lib/db/repositories/contracts.js, lib/db/repositories/freelancers.js,
lib/db/repositories/invoices.js, lib/db/repositories/stripe-events.js, lib/health.js,
lib/stripe/client.js, lib/stripe/custody.js, lib/stripe/transport.js, lib/vendor.js,
lib/views.js, public/scaffold.css, routes/assets.js, routes/health.js, routes/pages.js,
server.js, views/scaffold.ejs`.

Not touched: `package.json`, `package-lock.json`, `.dockerignore`, `app.js`,
`routes/*`, `lib/stripe/*`, `lib/vendor.js`, `lib/views.js`, `test/stripe-mock/*`,
`test/assets.test.js`, `test/stripe-client.test.js`, `test/stripe-mock.test.js`,
anything outside `apps/invoicing/`, any metawork-owned file (§9 has the wording).

---

## 5. Acceptance criteria

Cardinality before quantification throughout: every "all"/"none" is an exact count
against a committed literal, every guard is shown red under its §6 recipe.

1. **The suite is green, offline, with exactly ten files.** `docker compose run --rm
   test` exits 0 from a clean build; the summary reports `fail 0`, exactly 10 test
   files (`harness.test.js` V2 literal), `skipped 12` (the network-dependent
   AS-38 tests, unchanged). `docker compose run --rm contract` exits 0 and its
   summary shows the same 10 files. **V1 control:** `-e ASC_SELFTEST_MUTATE=1` exits 1.
2. **VERIFICATION, verbatim:** "migrations run from empty on docker compose up;
   repository tests cover create/read/update plus the uniqueness and foreign-key
   constraints; the suite runs with no accounts and no network." Each clause is
   proven by ACs 3, 10–13, and 1 respectively; the run happens with no
   `INVOICING_STRIPE_SECRET_KEY` set, and `test`'s `network_mode: none` is unchanged.
3. **Migrations run from empty on `docker compose up`.** With no `asc-invoicing_invoicing-data`
   volume present (`docker volume rm` first): `docker compose up --build -d web`;
   `docker compose logs web` contains `database /app/data/invoicing.sqlite: schema v1,
   applied 1 migration(s)` and the `invoicing listening on 0.0.0.0:8348 {...}` line
   whose JSON includes `"dbPath":"/app/data/invoicing.sqlite"`; `GET
   http://127.0.0.1:8348/healthz` → 200 with exactly 4 checks all `ok:true`.
4. **Idempotent and persistent.** `docker compose restart web` → log `applied 0
   migration(s)`. `docker compose down` (no `-v`) then `up -d web` → `applied 0`.
   `docker volume ls` shows `asc-invoicing_invoicing-data`; `docker compose down -v`
   removes it, and the next `up` is `applied 1` again.
5. **A mis-mounted volume is loud.** `docker compose run --rm -e
   INVOICING_DB_PATH=/nonexistent/x.sqlite --no-deps web` exits non-zero and the
   output names `/nonexistent/x.sqlite`; no directory is created. `INVOICING_DB_PATH=:memory:`
   and `INVOICING_DB_PATH=data/x.sqlite` fail at config load naming `INVOICING_DB_PATH`
   (config.test.js).
6. **Zero new dependencies.** `package.json`/`package-lock.json` byte-identical to
   master; `LOCK_ENTRIES` 70 green; `DIRECT_DEPENDENCIES` `['ejs','express']`.
7. **The dependency-policy guard sanctions the driver and stays honest.** Green with
   `node:sqlite` in exactly `lib/db/connection.js`; red under M1 (a second import);
   red under M15 (SQL in a route); source list is exactly the 26 files and `unknown`
   is `[]`. Money words appear in exactly the four allowed files (the §2.9 grep
   agrees with the test). Red when a comment containing `amount` is planted in
   `lib/db/errors.js` (P2).
8. **Currency is not hardcoded.** `grep -rn "'usd'" apps/invoicing/lib/db/repositories/`
   → zero hits; `grep -rn "'usd'" apps/invoicing/lib/db/` → hits only in `money.js`.
   `SUPPORTED_CURRENCIES` deepEqual `['usd']`; `createDraft` with `'eur'` →
   `ValidationError('currency')`. Red under M10 (cardinality moves).
9. **Every table is STRICT and the schema is exactly the DDL.** D3 asserts 8 tables
   and 5 indexes by exact sorted name, and zero tables whose `sql` lacks `STRICT`.
10. **Create/read/update per entity** — F, A, C, K, I groups green; `contracts` has no
    update (asserted absent).
11. **Uniqueness constraints fail if removed.** `freelancers` email (case-insensitive),
    `connected_accounts.freelancer_id`, `connected_accounts.stripe_account_id`,
    `clients.stripe_customer_id`, `invoices.stripe_invoice_id`, `stripe_events.id` each
    have a duplicate test; M7 (email index demoted to non-unique) turns the two email
    duplicate tests red and nothing else.
12. **Foreign-key constraints fail if removed.** Unknown freelancer on account/client
    → 787; composite owner-mismatch on `contracts` and `invoices` → 787 at the engine
    (X-group, bypassing validators) and `NotFoundError('client')` through the
    repository; M2 (`foreign_keys = OFF`) turns D1 and every FK test red; M3 (composite
    FK demoted to plain) turns exactly the two owner-mismatch X tests red.
13. **CHECK constraints fail if removed.** M4 (status set widened) turns the status
    X test red. The non-draft-without-Stripe-id, currency-shape, quantity, and `evt_`
    prefix X tests are each present and green.
14. **The state machine is exactly Stripe's graph.** I-group: `applied` up-rank,
    `fields` same status, `stale` down-rank writes nothing (fields AND `updatedAt`
    unchanged), `conflict` for paid/void writes nothing, paid-before-finalized
    converges to `paid` with the earlier snapshot's url retained. M5 turns the conflict
    tests red; M6 turns the stale and convergence tests red.
15. **Draft fields freeze on attach.** `updateDraft` after `attachStripeInvoice` or on
    a non-draft → `InvalidStateError`; M8 turns those tests red.
16. **Migration runner.** D4 idempotent (M9 turns it red — the second run re-applies
    and fails on `CREATE TABLE`); D5 refuses a newer database; D6 refuses a renamed
    migration; `MIGRATIONS.length === 1`.
17. **Readiness.** `ready` truth table (4 rows, exactly one true); `updateReadiness`
    round-trips all five fields + `syncedAt`; the derivation appears in exactly one
    source file (`grep -rn 'requirementsCurrentlyDue.length' apps/invoicing/lib` → 1 hit).
18. **Health.** `/healthz` has exactly 4 checks (M13 turns D16/health tests red);
    missing file → `['database']` only, **and the probe does not create the file**
    (M14 turns D10 red); unwritable dir, wrong version, not-a-db each `ok:false` with a
    non-empty `detail`; the hand-built-config test still fails exactly `['config']`.
19. **Shutdown.** `time docker compose stop web` completes in under 10 s (the SIGTERM
    handler; without it the 10 s grace is hit). Recorded in the implementer's comment.
20. **Compose/Dockerfile/config pinned together.** Deploy-shape green; M11 (volume
    lines removed) red; M12 (Dockerfile line removed) red in deploy-shape AND — after
    an image rebuild — D18 fails with EACCES/CANTOPEN (two witnesses, one cause); P1
    (`test` given a volume) red.
21. **Literal moves are exactly the ones in §4.** `git diff master...feat/AS-39-persistence
    -- apps/invoicing/test/` shows: `8`→`9`/`7`→`8` in config.test.js, `3`→`4` in
    health.test.js, `8`→`10` in harness.test.js, `14`→`26` in dependency-policy.test.js,
    the `web.volumes` assertion in deploy-shape.test.js. No `>`/`>=` replaces an `===`;
    no allowlist gains a file this plan does not name.
22. **Size cap.** No file under `apps/invoicing/` exceeds 1,200 lines (the existing
    dependency-policy test).
23. **Commits.** All on `feat/AS-39-persistence`, as `developer-marcus`
    (`user.name="developer-marcus"`, `user.email="developer-marcus@agents.american-software.local"`),
    every message prefixed `AS-39:`, and `git diff --stat master...feat/AS-39-persistence
    -- .lattice` is empty (two-plane rule).
24. **README** updated per §4 (Layout tree, obligations, `down -v` warning).
25. **The implementer's Lattice comment** records: the mutation quadruples actually
    run (M#, assert-applied output, failing-test set observed vs predicted, restore
    proof `git -C $WT diff --exit-code`), the `applied 1 / 0 / 0 / 1` transcript of
    AC 3–4, the `stop` timing (AC 19), and any recipe whose predicted set did not
    match (a mismatch is a finding, not a footnote).

---

## 6. Falsification recipes

House rules (AS-38 §6, corrected by its §11): **backups live OUTSIDE
`apps/invoicing/`** — the closed-world scan classifies every file under it, so an
in-tree `.bak` is itself a red `unknown` and masks the mutation you are measuring.
Mutate in the worktree, never `cd` into it (`git -C`, absolute paths). Every recipe:
back up → mutate → **assert the mutation applied** (an unapplied mutation looks
exactly like a passing guard — the BSD/GNU `sed` lesson) → run → restore → prove
the tree clean → **rebuild the image before the next recipe** (a restored tree with
a stale mutant image produced phantom failures on AS-37). Record for each: the M
number, the assert-applied output, the observed failing-test set, and whether it
matched the prediction.

Scaffold (paste once per shell; `WT` is the worktree, `BAK` is outside the repo):

```sh
WT=/Users/forrest/Code/american-software-company/.worktrees/AS-39
APP=$WT/apps/invoicing
BAK=$(mktemp -d /tmp/as39-bak.XXXXXX)          # outside the checkout — never under apps/invoicing
COMPOSE="docker compose -p asc-invoicing-as39 -f $APP/compose.yaml"
run_suite() { $COMPOSE run --rm --build test 2>&1 | tee "$BAK/run-$1.log" | grep -E '^(not ok|# (pass|fail|tests))' ; }
backup()    { for f in "$@"; do mkdir -p "$BAK/$(dirname "$f")"; cp "$APP/$f" "$BAK/$f"; done; }
restore()   { for f in "$@"; do cp "$BAK/$f" "$APP/$f"; done; git -C "$WT" diff --exit-code -- apps/invoicing && echo RESTORED-CLEAN; }
```

Baseline first: `run_suite baseline` must print `# pass N`, `# fail 0` with the
N recorded — a recipe's failing set is measured against THIS run, not against memory.

| # | File (under `apps/invoicing/`) | MUTATE (perl, one line) | ASSERT-APPLIED | Predicted failing tests |
|---|---|---|---|---|
| M1 | `routes/pages.js` | `printf '\nimport { DatabaseSync as Leak } from "node:sqlite";\nvoid Leak;\n' >> $APP/routes/pages.js` | `grep -c 'from "node:sqlite"' $APP/routes/pages.js` → `1` | dependency-policy: `node:sqlite` concept (allowlist `['lib/db/connection.js']` ≠ hits) — exactly 1 test |
| M2 | `lib/db/connection.js` | `perl -pi -e 's/PRAGMA foreign_keys = ON/PRAGMA foreign_keys = OFF/' $APP/lib/db/connection.js` | `grep -c 'foreign_keys = OFF' …` → `1` | D1 (pragma), A unknown-freelancer FK, C unknown-freelancer FK, X owner-mismatch ×2, X cascade (no cascade without FKs), K/I owner tests that rely on the backstop only if the pre-check is also removed — predicted set: D1 + 5 FK-dependent tests; a wider set is a finding |
| M3 | `lib/db/migrations/0001-initial.js` | `perl -0pi -e 's/FOREIGN KEY \(freelancer_id, client_id\) REFERENCES clients \(freelancer_id, id\)/FOREIGN KEY (client_id) REFERENCES clients (id)/g' $APP/lib/db/migrations/0001-initial.js` | `grep -c 'REFERENCES clients (id)' …` → `2` | exactly the two X owner-mismatch tests (contracts, invoices); the repository-level NotFound tests stay green (pre-check) — that split is the point |
| M4 | `lib/db/migrations/0001-initial.js` | `perl -pi -e "s/'uncollectible'\)\)/'uncollectible', 'bogus'))/" $APP/lib/db/migrations/0001-initial.js` | `grep -c "'bogus'" …` → `1` | X status-CHECK test only |
| M5 | `lib/db/repositories/invoices.js` | `perl -pi -e 's/paid: 3, void: 3/paid: 3, void: 4/' $APP/lib/db/repositories/invoices.js` | `grep -c 'void: 4' …` → `1` | I conflict test(s): paid→void now `applied` instead of `conflict` |
| M6 | `lib/db/repositories/invoices.js` | `perl -pi -e 's/^  if \(incomingRank < currentRank\) return outcome\(\x27stale\x27\);/  if (false) return outcome(\x27stale\x27);/' $APP/lib/db/repositories/invoices.js` | `grep -c 'if (false) return outcome' …` → `1` | I stale test and I convergence test (the finalize snapshot after `paid` now overwrites) |
| M7 | `lib/db/migrations/0001-initial.js` | `perl -pi -e 's/CREATE UNIQUE INDEX freelancers_email_unique/CREATE INDEX freelancers_email_unique/' $APP/lib/db/migrations/0001-initial.js` | `grep -c 'CREATE INDEX freelancers_email_unique' …` → `1` | F duplicate-email exact, F duplicate-email case-variant; D8's 2067 case if it uses this index (record which) |
| M8 | `lib/db/repositories/invoices.js` | `perl -pi -e 's/^  assertEditableDraft\(row\);$/  void row;/' $APP/lib/db/repositories/invoices.js` | `grep -c '^  void row;$' …` → `1` (and `grep -c 'assertEditableDraft(row)'` drops by exactly 1) | I updateDraft-on-open, I updateDraft-after-attach |
| M9 | `lib/db/migrate.js` | `perl -pi -e 's/if \(applied\.has\(m\.version\)\) continue;/if (false) continue;/' $APP/lib/db/migrate.js` | `grep -c 'if (false) continue;' …` → `1` | D4 (second migrate re-runs 0001 and fails on `CREATE TABLE freelancers`), D15, and every test that migrates twice — record the set |
| M10 | `lib/db/money.js` | `perl -pi -e "s/\['usd'\]/['usd', 'eur']/" $APP/lib/db/money.js` | `grep -c "'eur'" …` → `1` | I currency-rejected test, I `SUPPORTED_CURRENCIES` cardinality test |
| M11 | `compose.yaml` | `perl -0pi -e 's/    volumes:\n      - invoicing-data:\/app\/data\n//' $APP/compose.yaml` | `grep -c 'invoicing-data:/app/data' $APP/compose.yaml` → `0` | deploy-shape: web volumes test; the consistency test (mount target missing) |
| M12 | `Dockerfile` | `perl -pi -e 's/^RUN mkdir -p \/app\/data && chown node:node \/app\/data$//' $APP/Dockerfile` | `grep -c 'chown node:node /app/data' $APP/Dockerfile` → `0` | deploy-shape Dockerfile test; **after `--build`**: D18 (open fails EACCES/CANTOPEN in a root-owned or absent `/app/data`) — two witnesses |
| M13 | `lib/health.js` | `perl -0pi -e 's/  Object\.freeze\(\{ name: \x27database\x27[^\n]*\n//' $APP/lib/health.js` | `grep -c "name: 'database'" $APP/lib/health.js` → `0` | health.test.js length/names/count tests, D16, D17 |
| M14 | `lib/db/database.js` | `perl -pi -e 's/^  statSync\(dbPath\);$/  void dbPath;/' $APP/lib/db/database.js` (the probe's first line is pinned to exactly this form) | `grep -c '^  void dbPath;$' …` → `1` | D10 — the probe now opens (creates) the missing file and reports a version mismatch instead of ENOENT, and `existsSync` is true afterwards |
| M15 | `routes/health.js` | `printf '\nexport const leak = "SELECT 1 FROM freelancers";\n' >> $APP/routes/health.js` | `grep -c 'SELECT 1 FROM freelancers' $APP/routes/health.js` → `1` | dependency-policy: `raw SQL` concept — exactly 1 test |
| P1 | `compose.yaml` | `perl -0pi -e 's/(  test:\n)/$1    volumes:\n      - invoicing-data:\/app\/data\n/' $APP/compose.yaml` | `grep -c 'invoicing-data:/app/data' $APP/compose.yaml` → `2` | deploy-shape: `test.volumes` undefined — exactly 1 test |
| P2 | `lib/db/errors.js` | `printf '\n// the amount is irrelevant here\n' >> $APP/lib/db/errors.js` | `grep -c 'amount' $APP/lib/db/errors.js` → `1` | dependency-policy: `money representation` concept (RAW scan; comments count) — exactly 1 test |
| V1 | — | `$COMPOSE run --rm -e ASC_SELFTEST_MUTATE=1 test; echo EXIT=$?` | the printed `EXIT=1` | harness V1 only |

Recipe procedure per row: `backup <file>` → MUTATE → ASSERT-APPLIED (stop if the
count is wrong) → `run_suite M<n>` → compare the `not ok` lines to the prediction →
`restore <file>` → see `RESTORED-CLEAN` → next row (the `--build` in `run_suite`
rebuilds; for M12 the rebuild IS the second witness). M2/M3/M4/M7 mutate the DDL,
so `:memory:` and mkdtemp databases pick them up with no state to clear. M11 and P1
mutate compose after the parser reads it, so no rebuild is needed but the compose
project must be recreated (`$COMPOSE run` does that).

Rejected as a recipe: mutating `migrate.js` to skip `BEGIN IMMEDIATE` — there is no
single-process test that observes it (§8 Q2); its correctness rests on the measured
semantics, and D7 proves the `transaction` helper it uses.

---

## 7. Size and complexity

| Bucket | Files | Lines (est.) |
|---|---|---|
| New source under `lib/db/` | 12 | ~900 (DDL ~120, invoices repo ~220, five other repos ~300, connection/errors/migrate/money/database ~260) |
| New tests | 2 | ~650 (db ~250, repositories ~400) |
| Edited source (`config.js`, `health.js`, `server.js`) | 3 | ~30 |
| Edited tests + helper | 6 | ~120 (mostly literal moves and the new deploy-shape/config cases) |
| Compose, Dockerfile, README | 3 | ~60 |
| **Total** | **~26** | **~1,750 ± 300** |

Against the tripwires (~10 files / ~600 lines): over on both, as AS-38 (14 files,
+1,829, one review cycle, 34/34) and AS-37 (25 files, 3,113) were. Justification:
(a) the six entities are fixed by the decision rows (C-04, C-15), and the schema
must land as one migration — a half-schema is not a working data model for anyone;
(b) the repositories are homogeneous (the same create/get/list/update shape six
times) so the line count overstates the design surface; (c) every downstream task
(AS-40–44) blocks on the WHOLE set, so a split delivers nothing sooner; (d) the
guard literal moves are forced by the file count regardless of how it is split.
Complexity stays **medium**: no protocol design, no network, one engine with
measured semantics, and the only genuinely subtle piece (the rank-ordered state
machine) is ~40 lines with 16 tests around it.

**Pre-agreed split line** (used only if the branch exceeds ~2,400 lines of diff or
review reaches cycle 2 on scope grounds): AS-39 keeps infrastructure (§2.1–2.3,
§2.7–2.9, §3), the FULL migration 0001 (all eight tables — the schema is never
split), and the `freelancers`, `connectedAccounts`, `clients`, `stripeEvents`
repositories; the `contracts` and `invoices` repositories (with the state machine
and their I/K/X tests) become `AS-39b` with the same plan sections as its spec, and
AS-42/AS-43 depend on AS-39b instead. The `raw SQL` allowlist and source list shrink
accordingly in AS-39 and grow back in AS-39b.

**§7 addendum (cto-owen, 2026-09-01, at implementation-complete):** measured
diff is 26 files, +3,104/−57 = 3,161 lines — over the ~2,400 line above. The
implementer flagged it rather than splitting alone (correct). **Decision: not
split post-hoc; review whole.** Reasons: (a) the file count is exactly the
planned 26 — no scope crept in; the miss is the line estimate (source 1,418 vs
~900 from validate-before-SQL per key; tests ~1,600 vs ~650 from one test per
§2.10 row), which is a planning finding against §7, not an implementation one;
(b) the split line was a mid-implementation tripwire — carving finished, tested,
recipe-proven code out of the branch to land it again as AS-39b reviews the same
lines twice plus the carve-out churn, and delivers nothing sooner (§7 (c));
(c) AS-37 went through review whole at 3,113 lines in one cycle. The plan's
second trigger stands unchanged as the backstop: if review reaches cycle 2 on
scope grounds, the split line above applies as written. Estimate calibration for
future §7s: count one test per acceptance row, and budget validation at ~40% of
each repository module.

---

## 8. Open questions (time-boxed; each has a default that applies when the box expires)

| # | Question | Default | Box |
|---|---|---|---|
| Q1 | Should the `database` health check also exercise a LIVE connection (`SELECT 1` on the app's handle) once `createApp(config, { repos })` exists? | Not in AS-39 (the app holds no handle). AS-40 may add it to the same row; the file-level probe stays because it sees what a live handle cannot (mount, ownership, schema version). | Closes with AS-40's plan |
| Q2 | Test two processes migrating the same file concurrently (worker threads racing `migrate`)? | No. `BEGIN IMMEDIATE` + the measured `busy_timeout` cover it and the v1 deployment is one `web` replica. Becomes a test in the first task that runs two writers. | Reopens with the first multi-process task |
| Q3 | Backups of the volume (`node:sqlite`'s `backup()` exists, measured)? | Deploy/acceptance task. README states where the data lives and that `down -v` destroys it; nothing more here. | Closes with the deploy task's plan |
| Q4 | `contracts.template_version` (a template can change after issue)? | Not now — `rendered_html` is the record of what was issued. AS-42 adds a column by migration if its templates are versioned. | Closes with AS-42's plan |
| Q5 | Store Stripe invoice-item ids (`ii_`) per line item? | Not now — the local line items are the draft's; after finalize Stripe's invoice is the record. AS-43 adds `stripe_invoice_item_id` by migration if it needs to reconcile. | Closes with AS-43's plan |
| Q6 | What does AS-44 do with `outcome: 'conflict'`? | Log at error, acknowledge the webhook (200 — retries cannot fix it), and optionally `GET /v1/invoices/{id}` then `applyStripeSnapshot` with Stripe's current truth. The mirror never guesses. | Closes with AS-44's plan |
| Q7 | Set `INVOICING_DB_PATH` explicitly in `compose.yaml`? | No — the config default is the single source of truth, checked against compose and Dockerfile by deploy-shape (§3.4). An explicit env entry would be a second copy. | Decided here |
| Q8 | `updated_at` on `stripe_events` / a `payload` column? | No — the row is an idempotency marker, not a log. AS-44 may add a `payload` by migration if debugging needs it; the description asks for a processed-event TABLE, not an event store. | Decided here |

---

## 9. Proposed wording for metawork-owned files (the metawork layer applies these; the implementer does not edit them)

**`CLAUDE.md`, section "Infra"**, append:

> **Product data lives on Docker named volumes, never bind mounts into the checkout
> (decided 2026-09-01, AS-39).** The invoicing database is `/app/data/invoicing.sqlite`
> inside the `web` container, on the named volume `asc-invoicing_invoicing-data`.
> `docker compose down -v` destroys it; `down` without `-v` does not. The `test`
> service mounts nothing and cannot reach it. Adding a table or column is a new
> `apps/invoicing/lib/db/migrations/NNNN-<name>.js` plus one line in `MIGRATIONS`
> — never an edit to a shipped migration.

**Root `README.md`, Status section**: add "persistence layer (SQLite via `node:sqlite`,
migrations at boot, six repositories)" to the D1 v1 progress line when AS-39 merges.

No change proposed to `PHILOSOPHY.md` or `agents.md`.

---

## 10. Stale or wrong items found while planning (for the record, none blocking)

1. **Tasking-message paths.** `docs/design/01-screens.md`, `00-flows.md`,
   `02-states-ledger.md` live under `docs/design/wireframes/`, not `docs/design/`.
   The Lattice description is correct; only the tasking message was off.
2. **`lib/health.js` line ~22** says the database is "NOT checked … (AS-39's)"; **`test/health.test.js` line ~36**
   asserts zero matches for `/stripe|database|db/i`. Both are AS-38's forward-looking
   guards and both move in this task (§4). Not stale until this merges — recorded so
   QA does not read the move as loosening.
3. **`test/dependency-policy.test.js`** test name and comment say AS-39's database "is
   not here yet" — same status as item 2.
4. **`server.js` header comment** describes the two-step boot; becomes three steps (§2.8).
5. **`apps/invoicing/README.md` "AS-39 owns data" bullet** (lines ~228–230) states the
   obligation as unmet; rewritten as landed (§4).
6. **`test/deploy-shape.test.js` comment "declares no volumes"** — was true for AS-37/38;
   the assertion it guards moves to "exactly the data volume" (§3.4).
7. **Table naming.** The description's "processed-webhook-event" table is named
   `stripe_events` — per the milestone plan §8 note that the boundary checker once
   flagged AS-39 as Stripe-touching because of a "webhook" token in a table name, and
   because the rows are Stripe events, not deliveries.
8. **`/healthz` will publish `dbPath`** through `config.redacted()`. This is AS-58 item
   4's existing exposure question widened by one non-secret path; recorded, not
   changed here (§2.7).
9. **The stack decision (`docs/engineering/…-stack-decision.md`) §Q2** makes no claim
   this task found stale: `node:sqlite` on 24.20.0 is warning-free and the sibling
   app's usage is as described. T6 (reversal trigger) remains the only exit.
10. **`apps/chat/lib/store.js`** sets `foreign_keys=ON` explicitly and uses WAL + 5000 ms
    busy timeout — this task follows the same three settings, so a future "why do the
    two apps differ" question has the answer "they don't".
