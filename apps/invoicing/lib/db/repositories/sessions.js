// lib/db/repositories/sessions.js — session rows and the expiry sweep (AS-40,
// plan §4.2). The house shape, as in freelancers.js.
//
// THE PRIMARY KEY IS A DIGEST, NEVER A TOKEN. lib/auth/session.js mints 32
// random bytes for the cookie and stores their SHA-256 as 64 lowercase hex
// characters; that digest IS the key. A leaked database file therefore yields
// nothing usable — recovering a token from its digest is a preimage problem
// against a uniformly random 256-bit input. The DDL refuses anything that is
// not 64 hex characters, so a 43-character base64url token fails on length
// before it can be written.
//
// No deleteForFreelancer ("sign out everywhere"): plan §3.3.4 defers it to the
// first task that lets a credential change, together with the caller that needs
// it. An unused method is an unused exemption.
import { mapSqliteError, ValidationError, assertText, assertTimestamp } from '../errors.js';

const COLUMNS = 'id, freelancer_id, created_at, expires_at';

/** The stored shape, mirroring the DDL CHECK. Asserted here so a caller that
 *  passed the raw token gets a named field back instead of a CHECK message. */
const DIGEST = /^[0-9a-f]{64}$/;

function mapRow(row) {
  return {
    id: row.id,
    freelancerId: row.freelancer_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

function assertDigest(value, field) {
  if (typeof value !== 'string' || !DIGEST.test(value)) {
    throw new ValidationError(field, 'must be a SHA-256 digest as 64 lowercase hex characters');
  }
  return value;
}

function create(db, { now }, input) {
  if (input === null || typeof input !== 'object') throw new ValidationError('session', 'must be a plain object');
  assertDigest(input.id, 'id');
  assertText(input.freelancerId, 'freelancerId');
  assertTimestamp(input.expiresAt, 'expiresAt');
  try {
    db.prepare(`INSERT INTO sessions (${COLUMNS}) VALUES (?, ?, ?, ?)`).run(input.id, input.freelancerId, now(), input.expiresAt);
  } catch (err) {
    throw mapSqliteError(err);
  }
  return getById(db, input.id);
}

/** null, not NotFoundError: an unknown digest is what a stale or forged cookie
 *  looks like, and the guard treats it exactly like an absent one. */
function getById(db, id) {
  assertDigest(id, 'id');
  const row = db.prepare(`SELECT ${COLUMNS} FROM sessions WHERE id = ?`).get(id);
  return row === undefined ? null : mapRow(row);
}

/** true when a row was removed. Sign-out and the expired-session path both use
 *  it, and neither cares which — a session that is already gone is gone. */
function remove(db, id) {
  assertDigest(id, 'id');
  const { changes } = db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  return changes === 1;
}

/** The opportunistic sweep, run on every successful sign-in (plan §3.3.3): one
 *  row per sign-in, at most 14 days of them, and no scheduler to forget to
 *  start. sessions_expires makes it proportional to what it deletes. */
function deleteExpired(db, nowIso) {
  assertTimestamp(nowIso, 'now');
  const { changes } = db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso);
  return changes;
}

export function createSessionsRepository(db, ctx) {
  return Object.freeze({
    create: (input) => create(db, ctx, input),
    getById: (id) => getById(db, id),
    delete: (id) => remove(db, id),
    deleteExpired: (nowIso) => deleteExpired(db, nowIso),
  });
}
