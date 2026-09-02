// lib/db/repositories/clients.js — the freelancer's customers (AS-39, plan §2.5).
//
// Owner-scoped: every read by id takes the freelancerId first and answers
// NotFoundError for "missing" and "not yours" alike (S5-DENIED-NOTOWNER renders
// as not-found by design). Email is deliberately NOT unique — a duplicate is a
// non-blocking warning on the client screens, and findByEmail is what the
// warning reads. The stripe_customer_id is set lazily by AS-43, once.
import { transaction } from '../connection.js';
import {
  mapSqliteError,
  InvalidStateError,
  NotFoundError,
  ValidationError,
  assertKnownKeys,
  assertStripeId,
  assertText,
} from '../errors.js';

const COLUMNS = 'id, freelancer_id, name, email, stripe_customer_id, created_at, updated_at';

function mapRow(row) {
  return {
    id: row.id,
    freelancerId: row.freelancer_id,
    name: row.name,
    email: row.email,
    stripeCustomerId: row.stripe_customer_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function create(db, { now, newId }, freelancerId, input) {
  assertText(freelancerId, 'freelancerId');
  assertKnownKeys(input, ['name', 'email'], 'client');
  const name = assertText(input.name, 'name');
  const email = assertText(input.email, 'email');
  const id = newId();
  const at = now();
  try {
    db.prepare(`INSERT INTO clients (${COLUMNS}) VALUES (?, ?, ?, ?, NULL, ?, ?)`).run(id, freelancerId, name, email, at, at);
  } catch (err) {
    throw mapSqliteError(err);
  }
  return getById(db, freelancerId, id);
}

function getById(db, freelancerId, id) {
  assertText(freelancerId, 'freelancerId');
  assertText(id, 'id');
  const row = db.prepare(`SELECT ${COLUMNS} FROM clients WHERE freelancer_id = ? AND id = ?`).get(freelancerId, id);
  if (row === undefined) throw new NotFoundError('client', id);
  return mapRow(row);
}

/** The owner check the contracts and invoices repositories run before writing a
 *  client_id: a client that is missing OR owned by someone else is the same
 *  NotFoundError('client'). The composite FK in the DDL is the backstop. */
export function assertOwnedClient(db, freelancerId, clientId) {
  const row = db.prepare('SELECT 1 FROM clients WHERE freelancer_id = ? AND id = ?').get(freelancerId, clientId);
  if (row === undefined) throw new NotFoundError('client', clientId);
}

function listByFreelancer(db, freelancerId) {
  assertText(freelancerId, 'freelancerId');
  return db
    .prepare(`SELECT ${COLUMNS} FROM clients WHERE freelancer_id = ? ORDER BY lower(name), id`)
    .all(freelancerId)
    .map(mapRow);
}

/** Every client of this freelancer with this email, case-insensitively — the
 *  duplicate-warning source, so it returns all of them, not the first. */
function findByEmail(db, freelancerId, email) {
  assertText(freelancerId, 'freelancerId');
  assertText(email, 'email');
  return db
    .prepare(`SELECT ${COLUMNS} FROM clients WHERE freelancer_id = ? AND lower(email) = lower(?) ORDER BY created_at, id`)
    .all(freelancerId, email)
    .map(mapRow);
}

function update(db, { now }, freelancerId, id, patch) {
  assertText(freelancerId, 'freelancerId');
  assertText(id, 'id');
  assertKnownKeys(patch, ['name', 'email'], 'client');
  const assignments = [];
  const values = [];
  if (patch.name !== undefined) {
    assignments.push('name = ?');
    values.push(assertText(patch.name, 'name'));
  }
  if (patch.email !== undefined) {
    assignments.push('email = ?');
    values.push(assertText(patch.email, 'email'));
  }
  if (assignments.length === 0) throw new ValidationError('client', 'nothing to update');
  const { changes } = db
    .prepare(`UPDATE clients SET ${assignments.join(', ')}, updated_at = ? WHERE freelancer_id = ? AND id = ?`)
    .run(...values, now(), freelancerId, id);
  if (changes === 0) throw new NotFoundError('client', id);
  return getById(db, freelancerId, id);
}

/** Set once. The same id again is a no-op (AS-43 may retry after a timeout);
 *  a DIFFERENT id is an InvalidStateError — a client is one Stripe customer. */
function setStripeCustomerId(db, { now }, freelancerId, id, stripeCustomerId) {
  assertStripeId(stripeCustomerId, 'stripeCustomerId', 'cus_');
  return transaction(db, () => {
    const current = getById(db, freelancerId, id);
    if (current.stripeCustomerId === stripeCustomerId) return current;
    if (current.stripeCustomerId !== null) {
      throw new InvalidStateError(`client ${id} already has Stripe customer ${current.stripeCustomerId}`);
    }
    try {
      db.prepare('UPDATE clients SET stripe_customer_id = ?, updated_at = ? WHERE freelancer_id = ? AND id = ?').run(
        stripeCustomerId,
        now(),
        freelancerId,
        id,
      );
    } catch (err) {
      throw mapSqliteError(err);
    }
    return getById(db, freelancerId, id);
  });
}

export function createClientsRepository(db, ctx) {
  return Object.freeze({
    create: (freelancerId, input) => create(db, ctx, freelancerId, input),
    getById: (freelancerId, id) => getById(db, freelancerId, id),
    listByFreelancer: (freelancerId) => listByFreelancer(db, freelancerId),
    findByEmail: (freelancerId, email) => findByEmail(db, freelancerId, email),
    update: (freelancerId, id, patch) => update(db, ctx, freelancerId, id, patch),
    setStripeCustomerId: (freelancerId, id, stripeCustomerId) => setStripeCustomerId(db, ctx, freelancerId, id, stripeCustomerId),
  });
}
