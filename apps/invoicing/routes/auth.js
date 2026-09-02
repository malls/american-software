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
// POST /signout takes no allowlist entry and needs none: it is mounted BELOW
// the boundary in app.js and is therefore guarded by construction. It is a POST
// rather than a GET precisely because SameSite=Lax sends cookies on top-level
// GET navigations, which would make a GET /signout triggerable from a link.
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
 * @param {object} config frozen settings from lib/config.js (appBaseUrl decides
 *   the cookie's Secure flag, through lib/auth/session.js)
 * @param {{ repos: object }} deps built in app.js from the same repos every
 *   other router receives
 */
export function authRoutes(config, { repos, accounts = createAccounts({ repos }) } = {}) {
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

  // Guarded by construction (mounted below the boundary). Clearing the cookie
  // uses the SAME attributes it was set with, or a browser will not match the
  // cookie it is meant to remove.
  router.post('/signout', (req, res) => {
    accounts.signOut(readSessionToken(req));
    clearSessionCookie(res, config);
    res.redirect(303, SIGNIN_PATH);
  });

  // A body-parser refusal never reaches a handler, so it needs its own landing:
  // the same one-line shape as every other failure on these routes.
  router.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    renderSignIn(res, { status: statusFor(err), error: err, step: 'parse-body' });
  });

  return router;
}
