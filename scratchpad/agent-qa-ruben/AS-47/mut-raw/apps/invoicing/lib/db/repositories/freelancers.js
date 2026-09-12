// lib/db/repositories/freelancers.js — the account holder (AS-39, plan §2.5).
//
// The shape every repository under this directory follows: module-level
// functions taking (db, ctx, ...args), a row mapper from snake_case columns to
// a camelCase plain object, validation BEFORE any SQL, and a factory that binds
// the functions to a handle and a clock. `ctx` is { now, newId } — injected so
// tests fix the clock and the ids; nothing here calls datetime('now').
import { mapSqliteError, NotFoundError, assertKnownKeys, assertText } from '../errors.js';

const COLUMNS = 'id, email, display_name, created_at, updated_at';

function mapRow(row) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function create(db, { now, newId }, input) {
  assertKnownKeys(input, ['email', 'displayName'], 'freelancer');
  const email = assertText(input.email, 'email');
  const displayName = assertText(input.displayName, 'displayName');
  const id = newId();
  const at = now();
  try {
    db.prepare(`INSERT INTO freelancers (${COLUMNS}) VALUES (?, ?, ?, ?, ?)`).run(id, email, displayName, at, at);
  } catch (err) {
    throw mapSqliteError(err);
  }
  return getById(db, id);
}

function getById(db, id) {
  assertText(id, 'id');
  const row = db.prepare(`SELECT ${COLUMNS} FROM freelancers WHERE id = ?`).get(id);
  if (row === undefined) throw new NotFoundError('freelancer', id);
  return mapRow(row);
}

/** Case-insensitive, through the same lower(email) expression the unique index
 *  is built on — the login lookup and the "already registered" check agree. */
function findByEmail(db, email) {
  assertText(email, 'email');
  const row = db.prepare(`SELECT ${COLUMNS} FROM freelancers WHERE lower(email) = lower(?)`).get(email);
  return row === undefined ? null : mapRow(row);
}

function update(db, { now }, id, patch) {
  assertText(id, 'id');
  assertKnownKeys(patch, ['displayName'], 'freelancer');
  const displayName = assertText(patch.displayName, 'displayName');
  const { changes } = db
    .prepare('UPDATE freelancers SET display_name = ?, updated_at = ? WHERE id = ?')
    .run(displayName, now(), id);
  if (changes === 0) throw new NotFoundError('freelancer', id);
  return getById(db, id);
}

export function createFreelancersRepository(db, ctx) {
  return Object.freeze({
    create: (input) => create(db, ctx, input),
    getById: (id) => getById(db, id),
    findByEmail: (email) => findByEmail(db, email),
    update: (id, patch) => update(db, ctx, id, patch),
  });
}
