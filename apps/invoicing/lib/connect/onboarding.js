// lib/connect/onboarding.js — the connect service: the three platform Stripe
// calls and the create-or-reuse / readiness-sync logic behind routes/connect.js
// (AS-41, plan §3.3, §3.5).
//
// THE ONLY FILE with `platform: true` call sites. That is a gate, not a
// convention: test/dependency-policy.test.js pins the construct to exactly this
// file, so a Stripe call creeping into a route (or a second service module) is
// a red test before anyone reads the diff. Every call still goes through the
// full client pipeline — the custody guard sees each of these before any key is
// touched (AS-38).
//
// Readiness discipline (plan §3.5): every snapshot written through
// updateReadiness is one freshly obtained from Stripe — the create response, or
// a read made by the same request that writes it — stamped with the injected
// clock at obtain time. Never cached, never synthesized, and never inferred
// from the fact that the user came back through return_url.
import { NotFoundError, UniqueViolationError } from '../db/database.js';
import { readinessFromAccount } from './readiness.js';

/** AS-45's screen 2 route. It dangles (404) until AS-45 lands — deliberately:
 *  the Location header is the contract, AS-45 depends on this task, and if
 *  AS-45 renames the screen this constant plus its test assertions are the
 *  whole diff (plan §9 Q2). */
const SCREEN_PATH = '/connect-stripe';

/** Name the failed step on the way out, so the route's one-line error body can
 *  say WHICH Stripe interaction failed. The client's error types carry no
 *  request material, and neither does this. */
async function labelled(step, work) {
  try {
    return await work();
  } catch (err) {
    if (err !== null && typeof err === 'object' && err.step === undefined) err.step = step;
    throw err;
  }
}

/**
 * @param {{ appBaseUrl: string, repos: object, stripe: { request: Function },
 *   now?: () => string }} deps `appBaseUrl` is config.appBaseUrl; `repos` is
 *   createRepositories()'s object; `stripe` is a createStripeClient() client.
 * @returns {{ start: Function, handleReturn: Function, handleRefresh: Function }}
 *   each takes a freelancer id and resolves to `{ redirectTo }`.
 */
export function createOnboarding({ appBaseUrl, repos, stripe, now = () => new Date().toISOString() } = {}) {
  if (typeof appBaseUrl !== 'string' || appBaseUrl.trim() === '') throw new TypeError('connect: appBaseUrl must be a non-empty string');
  if (repos === null || typeof repos !== 'object') throw new TypeError('connect: repos is required');
  if (stripe === null || typeof stripe !== 'object' || typeof stripe.request !== 'function') throw new TypeError('connect: stripe must be a client exposing request()');
  if (typeof now !== 'function') throw new TypeError('connect: now must be a function');

  /** Constructed, never concatenated (plan §3.3). AS-40 removed the freelancer
   *  query parameter these URLs used to carry: Stripe's return and refresh are
   *  top-level GET navigations, so they arrive with the session cookie under
   *  SameSite=Lax and the handlers read identity from that. The Stripe
   *  parameter NAMES are untouched. */
  function routeUrl(path) {
    return new URL(path, appBaseUrl).toString();
  }

  /** POST /v1/account_links with exactly the four parameters K8 validates. */
  async function mintLink(stripeAccountId) {
    const link = await labelled('mint-onboarding-link', () => stripe.request({
      method: 'POST', path: '/v1/account_links', platform: true,
      params: {
        account: stripeAccountId,
        type: 'account_onboarding',
        refresh_url: routeUrl('/connect-stripe/refresh'),
        return_url: routeUrl('/connect-stripe/return'),
      },
    }));
    return link.data.url;
  }

  /** A return/refresh for a freelancer with no row is impossible in a
   *  legitimate flow — the row exists before any link does (§3.3) — so it is a
   *  404, never a create. */
  function requireRow(freelancerId) {
    const row = repos.connectedAccounts.getByFreelancer(freelancerId);
    if (row === null) throw new NotFoundError('connected account', freelancerId);
    return row;
  }

  async function start(freelancerId) {
    repos.freelancers.getById(freelancerId); // throws NotFoundError for an unknown id
    const existing = repos.connectedAccounts.getByFreelancer(freelancerId);
    if (existing !== null) {
      // §3.3 layer 1, the row check: a second start reuses, never creates —
      // UNIQUE (freelancer_id) makes one-account-per-freelancer a database fact.
      if (existing.ready) return { redirectTo: SCREEN_PATH }; // nothing to onboard; zero Stripe calls
      return { redirectTo: await mintLink(existing.stripeAccountId) };
    }
    // No row. Stripe first, row after: a refused create leaves nothing behind
    // (R10). `params: {}` is load-bearing — the bare POST is what yields the
    // Standard-equivalent controller defaults; the guard bans `controller[...]`
    // outright, so drift here throws rather than shifting liability (§3.3).
    // §3.3 layer 3: the stable idempotency key bounds the Stripe side of any
    // create race — a replay inside Stripe's idempotency window returns the
    // SAME account id.
    const created = await labelled('create-account', () => stripe.request({
      method: 'POST', path: '/v1/accounts', platform: true,
      params: {}, idempotencyKey: `acct-create-${freelancerId}`,
    }));
    let stripeAccountId = created.data.id;
    try {
      repos.connectedAccounts.create({ freelancerId, stripeAccountId });
      // Seed readiness from the CREATE RESPONSE (§3.5): syncedAt is non-null
      // from birth, and the mapper is exercised on a real response shape.
      repos.connectedAccounts.updateReadiness(stripeAccountId, readinessFromAccount(created.data, now()));
    } catch (err) {
      if (!(err instanceof UniqueViolationError)) throw err;
      // §3.3 layer 2: lost the check-then-insert race. The winner's row is the
      // truth — re-read it and continue against the STORED account, no seed.
      // The loser's account is an inert test-mode shell referenced by nothing.
      const winner = repos.connectedAccounts.getByFreelancer(freelancerId);
      if (winner === null) throw err;
      stripeAccountId = winner.stripeAccountId;
    }
    return { redirectTo: await mintLink(stripeAccountId) };
  }

  async function handleReturn(freelancerId) {
    repos.freelancers.getById(freelancerId);
    const row = requireRow(freelancerId);
    // The description's core rule: NEVER trust the return. Stripe sends the
    // user back whether or not requirements are complete, so coming back
    // proves nothing. The only readiness action here is a fresh read of what
    // Stripe says right now, then a write of exactly that (§3.5; R6, F4).
    const read = await labelled('read-account', () => stripe.request({
      method: 'GET', path: `/v1/accounts/${row.stripeAccountId}`, platform: true,
    }));
    repos.connectedAccounts.updateReadiness(row.stripeAccountId, readinessFromAccount(read.data, now()));
    return { redirectTo: SCREEN_PATH };
  }

  async function handleRefresh(freelancerId) {
    repos.freelancers.getById(freelancerId);
    const row = requireRow(freelancerId);
    // A ready row has nothing to onboard, so nothing to mint: this makes the
    // §9 Q1 invariant — no code path mints a link for a ready account —
    // enforced rather than assumed (a stale bookmark lands on the screen).
    if (row.ready) return { redirectTo: SCREEN_PATH };
    // S2-REFRESH: account links are single-use and expire in minutes; Stripe
    // calls refresh_url when the link is no longer valid. The freelancer did
    // nothing wrong — mint a fresh link and put them straight back into the
    // hosted flow. No readiness write: mid-onboarding, a read adds latency and
    // no information; creation and return are the sync moments (§3.5).
    return { redirectTo: await mintLink(row.stripeAccountId) };
  }

  return Object.freeze({ start, handleReturn, handleRefresh });
}
