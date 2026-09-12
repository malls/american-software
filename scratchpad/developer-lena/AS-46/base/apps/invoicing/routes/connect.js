// routes/connect.js — chain link 2, server side: start onboarding, take
// Stripe's return redirect, take Stripe's refresh redirect (AS-41, plan
// §3.1–§3.2). Paths align with the wireframes' provisional route table so
// AS-45 (screen 2, GET /connect-stripe) and this task converge on the same
// names without a rename.
//
// THIN BY TEST, not just by intent: every Stripe call lives in
// lib/connect/onboarding.js — the dependency-policy concept row holds the
// `platform` declarations to that one file — so these handlers only translate
// HTTP to service calls and error classes to statuses.
//
// All redirects are 303 See Other: semantically required for the POST, used
// uniformly for the GETs — one literal. Error bodies are one-line text/plain
// (the routes/assets.js precedent) carrying the error class and the step that
// failed, never the key and never request material; screens render states from
// the DB row, not from these bodies.
import { Router } from 'express';
import { ConfigError } from '../lib/config.js';
import { NotFoundError, ValidationError } from '../lib/db/database.js';
import { StripeApiError, StripeCustodyError, StripeTransportError } from '../lib/stripe/client.js';
import { createOnboarding } from '../lib/connect/onboarding.js';
import { actingFreelancerId } from '../lib/auth/guard.js';

/** Plan §3.2's error taxonomy, mapped by error class — never by message text. */
function statusFor(err) {
  // Unknown freelancer, or return/refresh for a freelancer with no
  // connected-account row (impossible in a legitimate flow — §3.3).
  if (err instanceof NotFoundError) return 404;
  // Stripe key unconfigured (the client's requireKey step): a deploy/config
  // problem, the same class as a missing vendored asset.
  if (err instanceof ConfigError) return 503;
  // Unreachable in normal operation — these routes compose only allowlisted
  // calls. If it fires, something is genuinely wrong and it must be loud.
  if (err instanceof StripeCustodyError) return 500;
  // Stripe answered with an error, or did not answer usably.
  if (err instanceof StripeApiError || err instanceof StripeTransportError) return 502;
  // A repository refused a Stripe-supplied value (e.g. a non-acct_ id): on
  // these routes repo inputs come from Stripe, not from the user.
  if (err instanceof ValidationError) return 502;
  // The readiness mapper met an account shape it does not understand (§3.4).
  if (err instanceof TypeError) return 502;
  return 500;
}

/**
 * @param {object} config frozen settings from lib/config.js (appBaseUrl is read)
 * @param {{ repos: object, stripe: object }} deps built in server.js / withServer
 */
export function connectRoutes(config, { repos, stripe }) {
  const onboarding = createOnboarding({ appBaseUrl: config.appBaseUrl, repos, stripe });
  const router = Router();

  // Identity comes from the session and from nothing else (AS-40). These routes
  // are mounted below the auth boundary in app.js, so actingFreelancerId cannot
  // return null — it THROWS if it is ever reached without one, which would mean
  // this router was mounted above the boundary.
  const handle = (step, act) => async (req, res) => {
    const freelancerId = actingFreelancerId(req);
    try {
      const { redirectTo } = await act(freelancerId);
      res.redirect(303, redirectTo);
    } catch (err) {
      res.status(statusFor(err)).type('text/plain').send(`${err?.name ?? 'Error'}: ${err?.step ?? step}\n`);
    }
  };

  router.post('/connect-stripe/start', handle('start', (id) => onboarding.start(id)));
  router.get('/connect-stripe/return', handle('return', (id) => onboarding.handleReturn(id)));
  router.get('/connect-stripe/refresh', handle('refresh', (id) => onboarding.handleRefresh(id)));

  return router;
}
