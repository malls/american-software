// routes/pages.js — routes that belong to no capability (AS-37; rewritten by
// AS-45, plan §3.3.4 and review-cycle-1 ruling R-2; the redirect restored by
// AS-70, plan §3.5).
//
// The AS-37 scaffold page is GONE, with its template and its stylesheet: it
// existed to prove the chain end to end in a browser before any real screen
// did, and screen 1 now does that for real. The obligation AS-37 recorded here,
// in lib/views.js, in public/scaffold.css and in README.md is discharged.
//
// A SCREEN'S GET ROUTE JOINS ITS CAPABILITY'S AREA ROUTER, not this file —
// screen 1 lives in routes/auth.js and screen 2 in routes/connect.js, so no new
// mount line appears in app.js and the mount order, which is a security
// boundary, is not disturbed once per screen. This file stays the home for
// routes belonging to no capability, which is exactly one.
//
// `/` IS THE ONBOARDING LANDING, UNTIL AS-48 REPLACES IT WITH THE DASHBOARD.
// It is a 303 to `/connect-stripe`, the screen every signed-in freelancer with
// no Dashboard yet should be looking at. AS-45's review cycle 1 made `/` this
// redirect while `/connect-stripe` still 404ed, so the only success path of the
// only screen ended on a 404 — measured, three entry points, two hops each —
// and the split replaced it with an interim one-line text/plain body. AS-70
// landed the screen, so the redirect is honest again: the three entry points
// (sign-up, sign-in, a signed-in GET /signin) are each followed to a 200 at
// `/connect-stripe` by a test, never asserted at the first hop.
//
// No template, no interpolation, no data-state: a redirect renders nothing, and
// this file stays outside the view layer's escaping surface.
//
// AS-48 owns POST_SIGNIN_LANDING in lib/auth/guard.js and the Dashboard, and
// replaces this route entirely. Until then POST_SIGNIN_LANDING stays `/`
// (AS-45 plan §3.3.4): moving it would buy one saved hop at the cost of moving
// assertions in another task's suite.
import { Router } from 'express';

/** @param {object} config frozen settings from lib/config.js (unread today —
 *   the signature matches the other mounts in app.js so every line reads alike) */
export function pageRoutes(config) {
  const router = Router();

  // 303 See Other, the one redirect status this app uses (routes/connect.js).
  router.get('/', (req, res) => {
    res.redirect(303, '/connect-stripe');
  });

  return router;
}
