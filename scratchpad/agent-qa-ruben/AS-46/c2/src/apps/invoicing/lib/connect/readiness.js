// lib/connect/readiness.js — a Stripe account object mapped to the exact
// six-key patch connectedAccounts.updateReadiness takes (AS-41, plan §3.4).
//
// ONE definition, TWO writers: AS-41's routes call this for the create
// response and for the fresh read on return; AS-44 imports this same function
// for `account.updated`, whose `data.object` IS an account object. That reuse
// is proven by test before AS-44 exists (test/connect.test.js R1).
//
// The `ready` derivation is NOT here — it lives in AS-39's row mapper
// (lib/db/repositories/connected-accounts.js), the one place. This module maps
// shapes; it decides nothing.
//
// Strict on the three booleans: Stripe sends them on every account view, so a
// non-boolean means we are reading a shape we do not understand — TypeError,
// surfaced as 502 by the route. Tolerant on `requirements`: Stripe can omit
// the hash in some account views, so absent/null reads as nothing outstanding
// and no disabled reason (plan §9 Q3 boxes this: with `charges_enabled` false
// the row still reads not-ready, so the gate that matters fails closed).

const BOOLEAN_FIELDS = Object.freeze(['charges_enabled', 'details_submitted', 'payouts_enabled']);

/**
 * @param {object} account a Stripe account object — a create response, a GET
 *   response, or an `account.updated` event's `data.object`
 * @param {string} syncedAt the caller's clock at the moment the snapshot was
 *   OBTAINED from Stripe (never a cached or synthesized time — plan §3.5);
 *   validated downstream by updateReadiness
 * @returns the six-key readiness patch, exactly READINESS_KEYS' shape
 */
export function readinessFromAccount(account, syncedAt) {
  if (account === null || typeof account !== 'object' || Array.isArray(account)) {
    throw new TypeError('readiness: expected a Stripe account object');
  }
  for (const field of BOOLEAN_FIELDS) {
    if (typeof account[field] !== 'boolean') {
      throw new TypeError(`readiness: account.${field} is not a boolean — not a shape this app understands`);
    }
  }
  return {
    chargesEnabled: account.charges_enabled,
    detailsSubmitted: account.details_submitted,
    payoutsEnabled: account.payouts_enabled,
    requirementsCurrentlyDue: account.requirements?.currently_due ?? [],
    requirementsDisabledReason: account.requirements?.disabled_reason ?? null,
    syncedAt,
  };
}
