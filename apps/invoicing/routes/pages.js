// routes/pages.js — routes that belong to no capability (AS-37; rewritten by
// AS-45, plan §3.3.4 and review-cycle-1 ruling R-2).
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
// `/` IS AN INTERIM RESPONSE, NOT A PLACEHOLDER SCREEN, and the distinction is
// load-bearing. Cycle 1 made `/` a 303 to `/connect-stripe`; the pre-agreed
// split moved that screen to AS-70, so the only success path of the only screen
// this product has ended on a 404 — measured, three entry points, two hops
// each. A second screen with no wireframe would be worse: it would ship a
// template, a stylesheet surface, a state with no ledger row and an escaping
// surface, all decided by an implementer mid-rework, and AS-48 would inherit a
// page to delete. So this is one committed line of text/plain — the shape this
// app already serves in lib/auth/guard.js's line() and in connect's one-line
// 502 — with no template, no interpolation and no data-state.
//
// TWO HAND-OFFS, both named:
//   AS-70 restores the redirect when /connect-stripe exists: one line here,
//         plus SIX cases across THREE test files, named in full so AS-70 does
//         not have to rediscover them (measured by recipe F15, which pointed
//         this route at a path nothing serves; corrected here in review cycle 2,
//         finding F-D, from an earlier note that said "the terminal-state
//         assertions" and undercounted by two — in the direction that makes a
//         follow-up look cheaper than it is):
//           test/screens.test.js  'GET / is an interim text/plain line, not a screen'
//           test/screens.test.js  'a signed-in GET /signin lands on a page that exists'
//           test/auth.test.js     'a successful sign-up with no next lands on a page that exists'
//           test/auth.test.js     'a successful sign-in with no next lands on a page that exists'
//           test/auth.test.js     'H11: a garbage cookie is refused exactly like an absent one'
//           test/health.test.js   'GET / answers a signed-in caller rather than 404ing'
//         The last two are NOT terminal-state cases and sit in files the note
//         used to give no hint of: H11 is the admitted-200 control, and
//         health.test.js's case asserts / answers a signed-in caller at all.
//   AS-48 owns POST_SIGNIN_LANDING in lib/auth/guard.js and the Dashboard, and
//         replaces this route entirely. The interim body is precisely what it
//         was already going to replace, so it pays nothing extra.
import { Router } from 'express';

/** The whole body, spelled once. No interpolation reaches it — it is a
 *  constant, which is what keeps this route out of the view layer's escaping
 *  surface. test/screens.test.js commits its own independent transcription. */
const INTERIM_LANDING = 'Signed in — the onboarding screen is not built yet.';

/** @param {object} config frozen settings from lib/config.js (unread today —
 *   the signature matches the other mounts in app.js so every line reads alike) */
export function pageRoutes(config) {
  const router = Router();

  // Trailing newline, matching lib/auth/guard.js's line(): every one-line
  // text/plain body this app serves ends in one.
  router.get('/', (req, res) => {
    res.status(200).type('text/plain').send(`${INTERIM_LANDING}\n`);
  });

  return router;
}
