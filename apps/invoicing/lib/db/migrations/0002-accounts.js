// lib/db/migrations/0002-accounts.js — credentials and sessions (AS-40, plan §4.2).
//
// A NEW FILE, never an edit to 0001-initial.js: a change to a shipped migration
// is a different schema on every database that already applied it. Same
// conventions as 0001 — TEXT ids, ISO-8601 UTC timestamps with milliseconds,
// STRICT everywhere, no `down`.
//
// TWO CHECK CONSTRAINTS DO REAL WORK HERE, and neither is decoration:
//
//  * credentials.password_hash must begin `scrypt$`. Storing a plaintext
//    password is refused BY THE ENGINE, not by review — which is what makes
//    "credentials are never stored in plaintext" a fact rather than a claim.
//  * sessions.id must be 64 lowercase hex characters. The cookie carries a
//    43-character base64url token; the table stores its SHA-256 digest. Writing
//    the token itself is the single worst mistake available in this design, and
//    it fails on length before it can happen.
//
// A separate credentials table rather than a column on freelancers, for two
// reasons (plan §4.2): ALTER TABLE ... ADD COLUMN NOT NULL needs a DEFAULT and
// there is no honest default for a password hash; and, the important one, a
// hash on freelancers would ride in every row that repository returns — into
// route handlers and, from AS-45, into render contexts. A separate repository
// whose read method has exactly one caller keeps it out structurally.
//
// No ON DELETE CASCADE: there is no delete path for a freelancer in v1, and the
// schema uses CASCADE in exactly one place (invoice_line_items), which is where
// it belongs.
export default Object.freeze({
  version: 2,
  name: 'accounts',
  up: `
CREATE TABLE credentials (
  freelancer_id TEXT PRIMARY KEY REFERENCES freelancers (id),
  password_hash TEXT NOT NULL CHECK (substr(password_hash, 1, 7) = 'scrypt$'),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
) STRICT;

CREATE TABLE sessions (
  id            TEXT PRIMARY KEY
                CHECK (length(id) = 64 AND id = lower(id) AND id NOT GLOB '*[^0-9a-f]*'),
  freelancer_id TEXT NOT NULL REFERENCES freelancers (id),
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL
) STRICT;
-- The opportunistic sweep on sign-in deletes by expiry; this makes that
-- proportional to what it deletes rather than to the table.
CREATE INDEX sessions_expires ON sessions (expires_at);
`,
});
