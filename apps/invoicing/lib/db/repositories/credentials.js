// lib/db/repositories/credentials.js — the 1:1 credential row (AS-40, plan §4.2).
//
// The house shape (freelancers.js): module-level functions taking
// (db, ctx, ...args), a row mapper from snake_case columns to a camelCase plain
// object, validation BEFORE any SQL, and a frozen factory bound to a handle and
// a clock.
//
// THE HASH GOES NO FURTHER THAN THIS FILE'S ONE CALLER. getByFreelancer has
// exactly one consumer — lib/auth/accounts.js — which is the whole reason the
// hash lives in its own table instead of on freelancers: nothing that flows
// into a route handler or a render context carries it.
//
// The `scrypt$` prefix is asserted here AND checked by the DDL. This assertion
// is the friendlier error for a caller that passed a plaintext password by
// mistake; the DDL CHECK is the one that makes it impossible. Neither is
// redundant — remove the assertion and the engine still refuses; remove the
// CHECK and the guard becomes a discipline.
import { mapSqliteError, NotFoundError, ValidationError, assertText } from '../errors.js';

const COLUMNS = 'freelancer_id, password_hash, created_at, updated_at';

/** The encoded form lib/auth/password.js produces. Checked as a prefix only:
 *  the parameter fields are that module's business, not this layer's. */
const ENCODED_PREFIX = 'scrypt$';

function mapRow(row) {
  return {
    freelancerId: row.freelancer_id,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function assertPasswordHash(value) {
  assertText(value, 'passwordHash');
  if (!value.startsWith(ENCODED_PREFIX)) {
    throw new ValidationError('passwordHash', `must be an encoded hash starting with ${ENCODED_PREFIX}`);
  }
  return value;
}

function create(db, { now }, freelancerId, passwordHash) {
  assertText(freelancerId, 'freelancerId');
  assertPasswordHash(passwordHash);
  const at = now();
  try {
    db.prepare(`INSERT INTO credentials (${COLUMNS}) VALUES (?, ?, ?, ?)`).run(freelancerId, passwordHash, at, at);
  } catch (err) {
    throw mapSqliteError(err);
  }
  return getByFreelancer(db, freelancerId);
}

/** The upgrade-on-login writer (plan §3.2.4): a successful sign-in against a
 *  hash whose parameters are not the current default rewrites the row. */
function updateHash(db, { now }, freelancerId, passwordHash) {
  assertText(freelancerId, 'freelancerId');
  assertPasswordHash(passwordHash);
  let changes;
  try {
    ({ changes } = db
      .prepare('UPDATE credentials SET password_hash = ?, updated_at = ? WHERE freelancer_id = ?')
      .run(passwordHash, now(), freelancerId));
  } catch (err) {
    throw mapSqliteError(err);
  }
  if (changes === 0) throw new NotFoundError('credential', freelancerId);
  return getByFreelancer(db, freelancerId);
}

/** null, not NotFoundError: "this freelancer has no credential" is a
 *  representable and normal state, exactly like freelancers.findByEmail. */
function getByFreelancer(db, freelancerId) {
  assertText(freelancerId, 'freelancerId');
  const row = db.prepare(`SELECT ${COLUMNS} FROM credentials WHERE freelancer_id = ?`).get(freelancerId);
  return row === undefined ? null : mapRow(row);
}

export function createCredentialsRepository(db, ctx) {
  return Object.freeze({
    create: (freelancerId, passwordHash) => create(db, ctx, freelancerId, passwordHash),
    updateHash: (freelancerId, passwordHash) => updateHash(db, ctx, freelancerId, passwordHash),
    getByFreelancer: (freelancerId) => getByFreelancer(db, freelancerId),
  });
}
