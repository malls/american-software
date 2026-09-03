// routes/auth.js — chain link 1, server side: sign up, sign in, sign out
// (AS-40, plan §3.7). Paths align with the wireframes' provisional route table
// so AS-45 (screen 1) and this task converge on the same names.
//
// THIN BY TEST, not just by intent: every credential rule lives in
// lib/auth/accounts.js and every cookie in lib/auth/session.js, so these
// handlers only translate HTTP to service calls and error classes to statuses —
// the routes/connect.js and routes/invoices.js precedent.
//
// All redirects are 303 See Other, semantically required for a POST. Since
// AS-45 a failure RENDERS SCREEN 1 rather than emitting the house one-line
// text/plain body; the STATUS taxonomy below is unchanged, and the rendered
// page still carries the error class nowhere and request material nowhere —
// every string on it is a renderer-authored constant except the freelancer's
// own submitted email and name (lib/screens/signin-view.js). The one-line
// text/plain shape survives in requireSameOrigin's 403, which is the guard's.
//
// TWO ROUTERS, ONE PER SIDE OF THE AUTH BOUNDARY. One Express router cannot be
// on both sides of a middleware: publicAuthRoutes carries GET /signin (screen
// 1, AS-45), POST /signup and POST /signin and mounts ABOVE requireSession,
// sessionAuthRoutes carries
// POST /signout alone and mounts BELOW it. Signout is therefore protected
// POSITIONALLY, like every other guarded route, so "everything below the
// boundary line requires a session" stays a COMPLETE description of what is
// guarded — no reader of app.js has to open this file to learn which of its
// routes are exceptions. Cycle 1 shipped all three routes in one router above
// the boundary, described as "guarded by construction": that phrase asserted
// the conclusion and named no mechanism, so nothing contradicted it when the
// mechanism was absent, and POST /signout ran its handler for anonymous
// callers. The split is cheap because signout shares nothing with the public
// pair — no body parser, no status mapping, no renderSignIn seam, no
// router-level error handler.
//
// POST /signout is a POST rather than a GET precisely because SameSite=Lax
// sends cookies on top-level GET navigations, which would make a GET /signout
// triggerable from a link.
import express, { Router } from 'express';
import { AuthError, createAccounts } from '../lib/auth/accounts.js';
import { POST_SIGNIN_LANDING, SIGNIN_PATH, hasSession, safeNext } from '../lib/auth/guard.js';
import { clearSessionCookie, readSessionToken, setSessionCookie } from '../lib/auth/session.js';
import { signinLocals } from '../lib/screens/signin-view.js';

/** The sign-up route's own path, spelled once. The sign-in path is
 *  lib/auth/guard.js's SIGNIN_PATH because the guard redirects to it; nothing
 *  outside this file needs this one. */
const SIGNUP_PATH = '/signup';

/** Plan §3.7's error taxonomy, mapped by the AuthError's stable `step` — never
 *  by message text. Unknown email and wrong password share ONE code on purpose;
 *  see the enumeration note in lib/auth/accounts.js. */
const STATUS_BY_STEP = Object.freeze({
  'invalid-credentials': 401,
  'email-taken': 409,
  'invalid-email': 400,
  'weak-password': 400,
  'missing-field': 400,
});

function statusFor(err) {
  if (err instanceof AuthError) return STATUS_BY_STEP[err.step] ?? 400;
  // A body-parser refusal (too large, too many parameters) carries its own
  // status — the routes/invoices.js precedent.
  if (Number.isInteger(err?.status)) return err.status;
  return 500;
}

/**
 * AS-45 DISCHARGED THIS SEAM. Every failure on these routes still lands in ONE
 * place; that place now renders screen 1 instead of a one-line text/plain body.
 * The STATUS is unchanged — the taxonomy above still decides it — so nothing
 * that asserted on a status moved.
 *
 * THE MAPPING IS ON `step`, NEVER ON MESSAGE TEXT, and it is made in
 * lib/screens/signin-view.js, not here: this function translates the handler's
 * failure record into that module's input shape and renders. `error.step` is an
 * AuthError's stable code; `view.step` names the failing interaction when the
 * error carries none of its own (a body-parser refusal).
 *
 * WHAT SURVIVES A FAILURE: `email`, `displayName` and `next` — every
 * non-sensitive submitted value (00-flows.md Flow 6). THE PASSWORD IS NEVER
 * PASSED, in any mode, on any error; the view model has no key for it.
 *
 * MODE SELECTS THE FORM, STEP SELECTS THE MESSAGE (plan ruling R-1). The two
 * are supplied separately and lib/screens/signin-view.js has no per-mode
 * message left to reach for, so an unmapped step cannot inherit sign-in's
 * credentials sentence the way it did in cycle 1.
 *
 * @param {import('express').Response} res
 * @param {{ status: number, error: Error, step: string, mode: 'signin'|'signup',
 *   email?: string, displayName?: string, next?: string,
 *   invalidFields?: string[] }} view
 */
function renderSignIn(res, view) {
  res.status(view.status).render('signin', signinLocals({
    // THE CALLER SUPPLIES THE MODE. It is not derived from `step` here any
    // more: `step` also names the failing interaction, and a modeless
    // 'parse-body' therefore fell to sign-in on BOTH routes — cycle 1's B3,
    // "sign-up rejected, here is a sign-in form". Every call site below knows
    // which form was submitted, including the error middleware, which has
    // req.path.
    mode: view.mode,
    next: safeNext(view.next),
    failure: {
      step: view.error?.step ?? view.step,
      email: view.email,
      displayName: view.displayName,
      invalidFields: view.invalidFields,
    },
  }));
}

/**
 * The PUBLIC half: the two ways in. Mounted ABOVE the auth boundary.
 *
 * @param {object} config frozen settings from lib/config.js (appBaseUrl decides
 *   the cookie's Secure flag, through lib/auth/session.js)
 * @param {{ repos: object }} deps built in app.js from the same repos every
 *   other router receives
 */
export function publicAuthRoutes(config, { repos, accounts = createAccounts({ repos }) } = {}) {
  const router = Router();

  // MOUNTED PER ROUTE, NOT APP-WIDE — the AS-44 raw-body rule: an app-wide
  // parser is the classic way to break webhook signature verification,
  // discovered late. `extended: false` because a credentials form has no nested
  // structure, which keeps the parsed surface on the app's only unauthenticated
  // write endpoints as small as it can be; the limits bound them further.
  const form = express.urlencoded({ extended: false, limit: '8kb', parameterLimit: 20 });

  const field = (body, name) => (typeof body?.[name] === 'string' ? body[name] : undefined);

  const landing = (body) => safeNext(field(body, 'next')) ?? POST_SIGNIN_LANDING;

  /** The fields each mode submits. `missing-field` carries no field name —
   *  AuthError has `step` only, and reading its message is forbidden — so the
   *  screen's "N fields need attention" count is derived HERE, from the body,
   *  which is honest and needs no change to lib/auth/accounts.js. */
  const MODE_FIELDS = Object.freeze({
    'sign-up': ['displayName', 'email', 'password'],
    'sign-in': ['email', 'password'],
  });

  const blankFields = (body, step) => (MODE_FIELDS[step] ?? []).filter((name) => (field(body, name) ?? '') === '');

  // SCREEN 1 (AS-45), mounted in the PUBLIC router on purpose: this is where
  // requireSession sends every signed-out visitor, so a guarded sign-in page
  // would be an infinite redirect. It joins the router that already holds the
  // two ways in, which keeps app.js's comment 7 true.
  //
  // S1-DENIED-AUTHENTICATED: an already-signed-in freelancer is redirected
  // rather than shown a form. hasSession, never req.currentUser — the `current
  // user` concept row pins that identifier to lib/auth/guard.js alone.
  router.get('/signin', (req, res) => {
    const next = safeNext(req.query.next);
    if (hasSession(req)) return res.redirect(303, next ?? POST_SIGNIN_LANDING);
    return res.render('signin', signinLocals({ mode: req.query.mode, next }));
  });

  // The routes/connect.js `handle` shape: every failure lands in ONE place, and
  // a non-AuthError (a repository refusal, a bug) is a 500 named by this route's
  // step rather than an unhandled rejection.
  const enter = (step, act) => async (req, res) => {
    const body = req.body ?? {};
    try {
      const { token } = await act(body);
      setSessionCookie(res, token, config);
      res.redirect(303, landing(body));
    } catch (err) {
      renderSignIn(res, {
        status: statusFor(err),
        error: err,
        step,
        // The form that was submitted, from the handler that serves it.
        mode: step === 'sign-up' ? 'signup' : 'signin',
        email: field(body, 'email'),
        // AS-45: sign-up has a Name field, and Flow 6 preserves every
        // non-sensitive submitted value. Its omission from the AS-40 obligation
        // comment was an oversight in the comment, not a decision.
        displayName: field(body, 'displayName'),
        next: field(body, 'next'),
        invalidFields: blankFields(body, step),
      });
    }
  };

  router.post('/signup', form, enter('sign-up', (body) => accounts.signUp({
    displayName: field(body, 'displayName'),
    email: field(body, 'email'),
    password: field(body, 'password'),
  })));

  router.post('/signin', form, enter('sign-in', (body) => accounts.signIn({
    email: field(body, 'email'),
    password: field(body, 'password'),
  })));

  // A body-parser refusal never reaches a handler, so it needs its own landing.
  //
  // THE MODE COMES FROM THE ROUTE THE SUBMISSION WAS MADE TO, and req.path is
  // the property that carries it — MEASURED, not assumed (plan ruling R-1).
  // publicAuthRoutes is mounted at the app root in app.js with no mount path,
  // so inside this middleware req.baseUrl is '' and req.path is the whole
  // request path. Measured 2026-09-03 by driving a 300 KB urlencoded body at
  // both routes against a container built from this branch: req.path was
  // '/signup' and '/signin' respectively, req.originalUrl the same, req.baseUrl
  // ''. If this router ever gains a mount path, req.path stays relative to the
  // mount and this comparison still holds; req.originalUrl would not.
  router.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    renderSignIn(res, {
      status: statusFor(err),
      error: err,
      step: 'parse-body',
      mode: req.path === SIGNUP_PATH ? 'signup' : 'signin',
    });
  });

  return router;
}

/**
 * The GUARDED half: sign-out alone. Mounted BELOW the auth boundary in app.js,
 * which is the whole of its protection — an anonymous POST /signout is answered
 * by requireSession (303 to /signin, and NO Set-Cookie) and never reaches this
 * handler. test/auth.test.js's G3 asserts that difference on the byte that
 * carries it: the guard sets no cookie and this handler always does.
 *
 * Same signature as publicAuthRoutes so both mounts in app.js read alike.
 *
 * @param {object} config frozen settings from lib/config.js
 * @param {{ repos: object }} deps as above
 */
export function sessionAuthRoutes(config, { repos, accounts = createAccounts({ repos }) } = {}) {
  const router = Router();

  // No body parser: sign-out reads the cookie and nothing else. Clearing that
  // cookie uses the SAME attributes it was set with, or a browser will not
  // match the cookie it is meant to remove.
  router.post('/signout', (req, res) => {
    accounts.signOut(readSessionToken(req));
    clearSessionCookie(res, config);
    res.redirect(303, SIGNIN_PATH);
  });

  return router;
}
