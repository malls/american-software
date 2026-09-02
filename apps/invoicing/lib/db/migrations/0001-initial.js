// lib/db/migrations/0001-initial.js — the v1 schema (AS-39, plan §2.4).
//
// A migration is a JS module exporting { version, name, up } — a `.sql` file
// would be an unclassified file to the closed-world dependency scan, and a JS
// module keeps the migration set a static, reviewable import list in
// lib/db/migrate.js. No `down`: the product never migrates backwards; a bad
// migration is fixed forward by the next one.
//
// THIS FILE IS SHIPPED. Never edit it: a change to a shipped migration is a
// different schema on every database that already applied it. Add a table or a
// column as lib/db/migrations/0002-<name>.js plus one line in MIGRATIONS.
//
// Conventions, decided once (plan §2.4): ids are crypto.randomUUID() TEXT;
// timestamps are ISO-8601 UTC TEXT with milliseconds (lexicographic order is
// chronological order; readable in a sqlite3 shell and in JSON with no
// conversion; the apps/chat convention); booleans are INTEGER 0/1 with a
// CHECK; JSON is TEXT with json_valid; money is integer minor units (*_minor)
// with a `currency` per invoice, line items inheriting the invoice's because
// Stripe requires one currency per invoice; every table is STRICT; no soft
// delete; Stripe id prefixes are checked with substr so a swapped argument (a
// customer id in the account column) fails at the engine.
export default Object.freeze({
  version: 1,
  name: 'initial',
  up: `
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
`,
});
