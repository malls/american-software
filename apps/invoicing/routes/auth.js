// routes/auth.js — chain link 1, server side: sign up, sign in, sign out
// (AS-40, plan §3.7). Paths align with the wireframes' provisional route table
// so AS-45 (screen 1) and this task converge on the same names.
//
// THIN BY TEST, not just by intent: every credential rule lives in
// lib/auth/accounts.js and every cookie in lib/auth/session.js, so these
// handlers only translate HTTP to service calls and error classes to statuses —
// the routes/connect.js and routes/invoices.js precedent.
//
// All redirects are 303 See Other, semantically required for a POST. Error
// bodies are the house one-line text/plain carrying the error class and the
// step that failed, never the credential and never request material.
//
// TWO ROUTERS, ONE PER SIDE OF THE AUTH BOUNDARY. One Express router cannot be
// on both sides of a middleware: publicAuthRoutes carries POST /signup and
// POST /signin and mounts ABOVE requireSession, sessionAuthRoutes carries
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
import { POST_SIGNIN_LANDING, SIGNIN_PATH, safeNext } from '../lib/auth/guard.js';
import { clearSessionCookie, readSessionToken, setSessionCookie } from '../lib/auth/session.js';

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
 * AS-45 OBLIGATION: replace this function's BODY with a render of the sign-in
 * template. It must preserve `email` and `next` — the two fields that survive a
 * failure — and NEVER the password (states ledger, Flow 6). Every failure on
 * these routes is emitted through here, so that replacement is one function and
 * one point — the same idiom AS-41 used for its interim identity seam, which
 * worked, and which this task is now retiring on schedule.
 *
 * v1 renders the house one-line text/plain, because /signin does not exist yet.
 *
 * @param {import('express').Response} res
 * @param {{ status: number, error: Error, step: string, email?: string,
 *   next?: string }} view `step` names the failing interaction when the error
 *   carries no stable code of its own (a body-parser refusal).
 */
function renderSignIn(res, view) {
  res.status(view.status).type('text/plain').send(`${view.error?.name ?? 'Error'}: ${view.error?.step ?? view.step}\n`);
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
      renderSignIn(res, { status: statusFor(err), error: err, step, email: field(body, 'email'), next: field(body, 'next') });
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

  // A body-parser refusal never reaches a handler, so it needs its own landing:
  // the same one-line shape as every other failure on these routes.
  router.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    renderSignIn(res, { status: statusFor(err), error: err, step: 'parse-body' });
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
