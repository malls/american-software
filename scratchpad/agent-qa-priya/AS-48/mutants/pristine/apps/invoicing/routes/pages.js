// routes/pages.js — routes that belong to no capability (AS-37; rewritten by
// AS-45, plan §3.3.4 and review-cycle-1 ruling R-2; the redirect restored by
// AS-70, plan §3.5; the Dashboard landed by AS-48, plan §3.1).
//
// THE INTERIM REDIRECT IS DISCHARGED. From AS-45's review cycle 1 until AS-48,
// `/` was a 303 — first to a 404, then (AS-70) to `/connect-stripe`, the screen
// every signed-in freelancer with no Dashboard yet should be looking at. AS-48
// replaces the redirect with screen 3 for EVERY signed-in freelancer, ready or
// not (plan decision 2): the ledger's gated row "layers on top of whichever
// list state is active", which is only possible if an unready freelancer
// reaches the Dashboard at all. Connect is reached from the gated note's link,
// and the three entry points (sign-up, sign-in, a signed-in GET /signin) are
// each followed to a 200 HERE by a test, never asserted at the first hop.
// POST_SIGNIN_LANDING in lib/auth/guard.js stays `/` and, for the first time,
// names a screen.
//
// A SCREEN'S GET ROUTE JOINS ITS CAPABILITY'S AREA ROUTER, not this file —
// screen 1 lives in routes/auth.js, screen 2 in routes/connect.js, screens 4
// and 5 in routes/invoices.js. The Dashboard reads two capabilities and belongs
// to neither, which is exactly why it is the one route here: no new mount line
// in app.js, and the mount order, which is a security boundary, is undisturbed.
//
// THIN BY TEST: four repository reads, the pure view model, one render. No
// Stripe call on any GET — the readiness gate is `row.ready`, READ from the
// stored row and never re-derived (AS-70 decision 1). Any thrown error is
// S3-ERROR-SYSTEM at 500 with a Retry that GETs this same URL; there is no
// refusal a list can meet that the view model maps separately.
import { Router } from 'express';
import { actingFreelancerId } from '../lib/auth/guard.js';
import { dashboardLocals } from '../lib/screens/dashboard-view.js';

const VIEW = 'dashboard';

/**
 * @param {object} config frozen settings from lib/config.js (unread today —
 *   the signature matches the other mounts in app.js so every line reads alike)
 * @param {{ repos: object }} deps repos alone: nothing here calls Stripe.
 */
export function pageRoutes(config, { repos }) {
  const router = Router();

  router.get('/', (req, res) => {
    // Identity comes from the session and from nothing else (AS-40).
    const freelancerId = actingFreelancerId(req);
    let locals;
    try {
      locals = dashboardLocals({
        account: repos.connectedAccounts.getByFreelancer(freelancerId),
        invoices: repos.invoices.listByFreelancer(freelancerId),
        contracts: repos.contracts.listByFreelancer(freelancerId),
        clients: repos.clients.listByFreelancer(freelancerId),
      });
    } catch (err) {
      // A list that cannot be read renders the error state, never a
      // text/plain line: the freelancer's next action is Retry, not a stack.
      locals = dashboardLocals({ failure: 'system' });
    }
    res.status(locals.status).render(VIEW, locals);
  });

  return router;
}
