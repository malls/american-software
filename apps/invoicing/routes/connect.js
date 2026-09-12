// routes/connect.js — chain link 2, server side: start onboarding, take
// Stripe's return redirect, take Stripe's refresh redirect (AS-41, plan
// §3.1–§3.2), and the screen those redirects land on (AS-70, GET
// /connect-stripe). Paths align with the wireframes' provisional route table,
// so the screen joined the three handlers without a rename.
//
// THIN BY TEST, not just by intent: every Stripe call lives in
// lib/connect/onboarding.js — the dependency-policy concept row holds the
// `platform` declarations to that one file — so these handlers only translate
// HTTP to service calls and error classes to statuses.
//
// All redirects are 303 See Other: semantically required for the POST, used
// uniformly for the GETs — one literal. Error bodies for return and refresh are
// one-line text/plain (the routes/assets.js precedent) carrying the error class
// and the step that failed, never the key and never request material; screens
// render states from the DB row, not from these bodies.
//
// REVISED BY AS-69, in the open: a FAILED START renders screen 2 in its
// S2-ERROR-SYSTEM state — banner and "Try again" control — at the SAME status
// statusFor() already picks, instead of the one-line body. The status taxonomy
// did not move (the routes/auth.js precedent from AS-45: render the screen,
// keep the status), so a Stripe outage is still a 5xx on the wire and the
// freelancer still gets the ledger's retry affordance. The error class and step
// no longer appear on the wire for that one route; the screen renders
// renderer-authored constants only.
import { Router } from 'express';
import { ConfigError } from '../lib/config.js';
import { NotFoundError, ValidationError } from '../lib/db/database.js';
import { StripeApiError, StripeCustodyError, StripeTransportError } from '../lib/stripe/client.js';
import { createOnboarding } from '../lib/connect/onboarding.js';
import { actingFreelancerId } from '../lib/auth/guard.js';
import { connectLocals } from '../lib/screens/connect-view.js';

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
  //
  // `fail` is what the step answers with when the service throws; the status
  // is statusFor's in both shapes. The one-line body is the default; start
  // overrides it with the screen (AS-69).
  const plainFailure = (step) => (req, res, err) => {
    res.status(statusFor(err)).type('text/plain').send(`${err?.name ?? 'Error'}: ${err?.step ?? step}\n`);
  };
  // S2-ERROR-SYSTEM at the POST, status kept. The row is read so the locals
  // are honest about it, though the error flag outranks it in the view model
  // (connectLocals' precedence) — every row state gets the same screen, whose
  // one control re-POSTs here.
  const screenFailure = (req, res, err) => {
    const account = repos.connectedAccounts.getByFreelancer(actingFreelancerId(req));
    res.status(statusFor(err)).render('connect-stripe', connectLocals({ account, startFailed: true }));
  };
  const handle = (step, act, fail = plainFailure(step)) => async (req, res) => {
    const freelancerId = actingFreelancerId(req);
    try {
      const { redirectTo } = await act(freelancerId);
      res.redirect(303, redirectTo);
    } catch (err) {
      fail(req, res, err);
    }
  };

  router.post('/connect-stripe/start', handle('start', (id) => onboarding.start(id), screenFailure));
  router.get('/connect-stripe/return', handle('return', (id) => onboarding.handleReturn(id)));
  router.get('/connect-stripe/refresh', handle('refresh', (id) => onboarding.handleRefresh(id)));

  // Screen 2 (AS-70). A PURE FUNCTION OF THE STORED ROW: no Stripe call, no
  // write. Readiness is written only from a snapshot the writing request
  // fetched itself (AS-41) — creation and return are the sync moments; a page
  // view is not one. Not through handle(): that wrapper exists for redirect
  // actions and maps Stripe error classes to text/plain statuses, and a render
  // has no Stripe error to map. Protected by POSITION alone — this router is
  // mounted below the auth boundary — adding no third publicness mechanism.
  //
  // `?error=start` is the documented URL for S2-ERROR-SYSTEM (AS-45 plan
  // §3.5.3): the parameter is a PRESENCE FLAG selecting a state. It crosses
  // into the view model as a boolean, never as its value, so nothing the
  // freelancer typed can reach the page. A closed enum with one member, and
  // AS-69 added none: a failed POST renders the state in place (screenFailure
  // above) rather than travelling through this parameter, which stays as the
  // documented direct URL for the state.
  router.get('/connect-stripe', (req, res) => {
    const account = repos.connectedAccounts.getByFreelancer(actingFreelancerId(req));
    res.render('connect-stripe', connectLocals({ account, startFailed: req.query.error === 'start' }));
  });

  return router;
}
