// lib/db/repositories/stripe-events.js — the processed-webhook ledger (AS-39,
// plan §2.5; consumed by AS-44).
//
// The Stripe event id IS the idempotency key. recordOnce is the whole protocol:
// the first caller to insert the row wins and returns true; every later caller
// (Stripe retries, a replayed delivery) gets false and does nothing. Run it in
// the same repos.transaction as the apply it guards — a failed apply rolls the
// marker back too, so Stripe's retry is let through (E4). An idempotency marker,
// not an event store: no payload, no updated_at (plan §8 Q8).
import { mapSqliteError, assertStripeId, assertText } from '../errors.js';

function recordOnce(db, { now }, eventId, type) {
  assertStripeId(eventId, 'eventId', 'evt_');
  assertText(type, 'type');
  try {
    const { changes } = db
      .prepare('INSERT INTO stripe_events (id, type, processed_at) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING')
      .run(eventId, type, now());
    return changes === 1;
  } catch (err) {
    throw mapSqliteError(err);
  }
}

function has(db, eventId) {
  assertStripeId(eventId, 'eventId', 'evt_');
  return db.prepare('SELECT 1 FROM stripe_events WHERE id = ?').get(eventId) !== undefined;
}

export function createStripeEventsRepository(db, ctx) {
  return Object.freeze({
    recordOnce: (eventId, type) => recordOnce(db, ctx, eventId, type),
    has: (eventId) => has(db, eventId),
  });
}
