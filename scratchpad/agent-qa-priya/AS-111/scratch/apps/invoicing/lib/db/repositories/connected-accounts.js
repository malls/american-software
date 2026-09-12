// lib/db/repositories/connected-accounts.js — the freelancer's Stripe Connect
// account and its readiness flags (AS-39, plan §2.5–2.6).
//
// One account per freelancer in v1 (UNIQUE freelancer_id). The row stores the
// three Stripe booleans, the outstanding requirement keys and the disabled
// reason exactly as Stripe reports them; the ONE derived rule — `ready` — lives
// in the mapper below so AS-41 (Screen 2) and AS-43 ("may finalize") read the
// same boolean. Lookups by acct_ take no owner: their caller is a webhook.
import {
  mapSqliteError,
  NotFoundError,
  assertBoolean,
  assertKnownKeys,
  assertOptionalText,
  assertStringArray,
  assertStripeId,
  assertText,
  assertTimestamp,
} from '../errors.js';

const COLUMNS =
  'id, freelancer_id, stripe_account_id, charges_enabled, details_submitted, payouts_enabled, ' +
  'requirements_currently_due, requirements_disabled_reason, readiness_synced_at, created_at, updated_at';

const READINESS_KEYS = Object.freeze([
  'chargesEnabled',
  'detailsSubmitted',
  'payoutsEnabled',
  'requirementsCurrentlyDue',
  'requirementsDisabledReason',
  'syncedAt',
]);

function mapRow(row) {
  const chargesEnabled = row.charges_enabled === 1;
  const requirementsCurrentlyDue = JSON.parse(row.requirements_currently_due);
  return {
    id: row.id,
    freelancerId: row.freelancer_id,
    stripeAccountId: row.stripe_account_id,
    chargesEnabled,
    detailsSubmitted: row.details_submitted === 1,
    payoutsEnabled: row.payouts_enabled === 1,
    requirementsCurrentlyDue,
    requirementsDisabledReason: row.requirements_disabled_reason,
    syncedAt: row.readiness_synced_at,
    // The gate is exactly the description's pair: charges on, nothing outstanding.
    ready: chargesEnabled === true && requirementsCurrentlyDue.length === 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function create(db, { now, newId }, input) {
  assertKnownKeys(input, ['freelancerId', 'stripeAccountId'], 'connectedAccount');
  const freelancerId = assertText(input.freelancerId, 'freelancerId');
  const stripeAccountId = assertStripeId(input.stripeAccountId, 'stripeAccountId', 'acct_');
  const id = newId();
  const at = now();
  try {
    db.prepare(
      'INSERT INTO connected_accounts (id, freelancer_id, stripe_account_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(id, freelancerId, stripeAccountId, at, at);
  } catch (err) {
    throw mapSqliteError(err);
  }
  return getByStripeAccountId(db, stripeAccountId);
}

function getByFreelancer(db, freelancerId) {
  assertText(freelancerId, 'freelancerId');
  const row = db.prepare(`SELECT ${COLUMNS} FROM connected_accounts WHERE freelancer_id = ?`).get(freelancerId);
  return row === undefined ? null : mapRow(row);
}

function getByStripeAccountId(db, stripeAccountId) {
  assertText(stripeAccountId, 'stripeAccountId');
  const row = db.prepare(`SELECT ${COLUMNS} FROM connected_accounts WHERE stripe_account_id = ?`).get(stripeAccountId);
  return row === undefined ? null : mapRow(row);
}

/** All six readiness fields, every time: a partial update would let one field
 *  describe one Stripe snapshot and its neighbour another. */
function updateReadiness(db, { now }, stripeAccountId, patch) {
  assertText(stripeAccountId, 'stripeAccountId');
  assertKnownKeys(patch, READINESS_KEYS, 'readiness');
  const chargesEnabled = assertBoolean(patch.chargesEnabled, 'chargesEnabled');
  const detailsSubmitted = assertBoolean(patch.detailsSubmitted, 'detailsSubmitted');
  const payoutsEnabled = assertBoolean(patch.payoutsEnabled, 'payoutsEnabled');
  const requirementsCurrentlyDue = assertStringArray(patch.requirementsCurrentlyDue, 'requirementsCurrentlyDue');
  const requirementsDisabledReason = assertOptionalText(patch.requirementsDisabledReason, 'requirementsDisabledReason');
  const syncedAt = assertTimestamp(patch.syncedAt, 'syncedAt');
  const { changes } = db
    .prepare(
      'UPDATE connected_accounts SET charges_enabled = ?, details_submitted = ?, payouts_enabled = ?, ' +
        'requirements_currently_due = ?, requirements_disabled_reason = ?, readiness_synced_at = ?, updated_at = ? ' +
        'WHERE stripe_account_id = ?',
    )
    .run(
      chargesEnabled ? 1 : 0,
      detailsSubmitted ? 1 : 0,
      payoutsEnabled ? 1 : 0,
      JSON.stringify(requirementsCurrentlyDue),
      requirementsDisabledReason,
      syncedAt,
      now(),
      stripeAccountId,
    );
  if (changes === 0) throw new NotFoundError('connected account', stripeAccountId);
  return getByStripeAccountId(db, stripeAccountId);
}

export function createConnectedAccountsRepository(db, ctx) {
  return Object.freeze({
    create: (input) => create(db, ctx, input),
    getByFreelancer: (freelancerId) => getByFreelancer(db, freelancerId),
    getByStripeAccountId: (stripeAccountId) => getByStripeAccountId(db, stripeAccountId),
    updateReadiness: (stripeAccountId, patch) => updateReadiness(db, ctx, stripeAccountId, patch),
  });
}
