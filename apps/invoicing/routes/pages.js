// routes/pages.js — routes that belong to no capability (AS-37; rewritten by
// AS-45, plan §3.3.4).
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
// routes belonging to no capability, which is now exactly one.
//
// INTERIM, and the hand-off is named: `/` is a 303 to the Connect Stripe
// screen, which is the correct onboarding destination while the Dashboard does
// not exist. AS-48 owns the Dashboard and owns POST_SIGNIN_LANDING in
// lib/auth/guard.js; when it lands, that constant moves and this redirect
// target is reconsidered with it. AS-45 deliberately changed neither, because
// changing POST_SIGNIN_LANDING here would move assertions in another task's
// suite to buy one saved redirect hop.
import { Router } from 'express';

/** Screen 2's path. Spelled once here; lib/connect/onboarding.js holds the copy
 *  that Stripe's return and refresh redirects are built from. */
const ONBOARDING_SCREEN = '/connect-stripe';

/** @param {object} config frozen settings from lib/config.js (unread today —
 *   the signature matches the other mounts in app.js so every line reads alike) */
export function pageRoutes(config) {
  const router = Router();

  // 303 See Other, matching every other redirect in this app — one literal.
  router.get('/', (req, res) => {
    res.redirect(303, ONBOARDING_SCREEN);
  });

  return router;
}
