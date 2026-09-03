// lib/auth/guard.js — the route guard, and the only sanctioned way a handler
// learns who it is acting for (AS-40, plan §3.5, §3.6).
//
// THE BOUNDARY IS PROVEN BY REACHABILITY, NOT BY PLACEMENT. app.js mounts
// requireSession once, with a banner naming it — but a middleware mounted
// "before the protected routers" is an argument about a file, not a fact about
// the running app. test/auth.test.js enumerates the BUILT app's routes against
// a committed list, partitions them, and drives a real cookieless request at
// every route on the protected side. Reordering two mount lines turns the suite
// red; if it did not, the boundary would be a comment.
//
// THE ONLY FILE THAT NAMES req.currentUser. A dependency-policy concept row
// pins it here, so no route module may read it directly and bypass
// actingFreelancerId's assertion.
import { readSessionToken } from './session.js';

/** Screen 1's path. AS-45 landed it: `GET /signin` is served by
 *  publicAuthRoutes, ABOVE the auth boundary, because it is where this
 *  middleware SENDS people and a guarded sign-in page is an infinite redirect.
 *  If a later task renames the screen, this constant plus its assertions are
 *  the whole diff. */
export const SIGNIN_PATH = '/signin';

/** Where a successful sign-in lands when it carries no `next` (plan §9 Q4).
 *  AS-48 lands the Dashboard route and changes this one constant and its
 *  assertions. AS-45 deliberately declined to: `/` is a 303 to
 *  `/connect-stripe` (routes/pages.js), which is the correct onboarding
 *  destination until the Dashboard exists. */
export const POST_SIGNIN_LANDING = '/';

/** Methods that do not change state, so the origin check does not apply. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const line = (res, status, body) => res.status(status).type('text/plain').send(`${body}\n`);

/**
 * Validate a `next` at CONSUMPTION.
 *
 * It is generated from req.originalUrl (server-side, safe) but consumed from
 * whatever the client sends back, so it is checked here: accept only a string
 * beginning with a single `/`, rejecting `//` and `/\` (protocol-relative), any
 * control character, and anything containing `://`.
 *
 * @returns {string | null} the safe path, or null — callers fall back to
 *   POST_SIGNIN_LANDING.
 */
export function safeNext(raw) {
  if (typeof raw !== 'string' || raw === '') return null;
  if (raw[0] !== '/') return null;
  if (raw[1] === '/' || raw[1] === '\\') return null;
  if (raw.includes('://')) return null;
  // Control characters, rejected by codepoint rather than through a regex
  // character class: CR and LF in a redirect target are how a crafted value
  // splits a Location header, and a class written with literal escapes is a
  // byte an editor or a careless edit can get wrong without it being visible.
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return null;
  }
  return raw;
}

/**
 * Populate req.currentUser when a valid session cookie is present. NEVER
 * rejects: it is mounted above the public routes too, so that a signed-in
 * freelancer visiting a public page is still known, and so that the guard below
 * it has nothing left to do but decide.
 *
 * Reads only req.headers.cookie — it never touches the body, which is the
 * property AS-44's signature verification depends on. It is mounted BELOW the
 * webhook anyway, so that property is structural rather than argued.
 *
 * @param {{ resolveSession: Function }} accounts
 */
export function loadSession(accounts) {
  return function loadSessionMiddleware(req, res, next) {
    const token = readSessionToken(req);
    const resolved = token === null ? null : accounts.resolveSession(token);
    if (resolved !== null) {
      req.currentUser = resolved.freelancer;
      req.currentSession = resolved.session;
    }
    next();
  };
}

/**
 * The CSRF defence (plan §3.6). SameSite=Lax closes the classic cross-site form
 * POST, but it is a BROWSER behaviour rather than a server guarantee, it does
 * not close login CSRF at all (that targets the public routes), and at least
 * one major browser has shipped a grace window in which a freshly set cookie is
 * sent on cross-site POSTs. The routes below the boundary finalize and send
 * invoices on the freelancer's own Stripe account, so "mostly closed" is not
 * the right posture.
 *
 * Compare Origin's HOST to the request's Host header — not to
 * config.appBaseUrl, because tests and any deployment on a non-default port run
 * on an ephemeral port and would reject every POST. It is also the sounder
 * check: a browser sets Origin honestly and cannot be made to lie about it by
 * another origin's page, while a non-browser attacker who can forge both does
 * not have the victim's cookie and is therefore not doing CSRF at all.
 *
 * HOST ONLY, not scheme+host, with the residual named: a same-host
 * cross-SCHEME attacker is not caught. That attacker is an active network MITM
 * who has already won by other routes. Comparing schemes would additionally
 * require app.set('trust proxy', …) the moment a TLS-terminating proxy appears,
 * and would fail closed on every POST in the app until someone realised. The
 * task that first puts TLS in front of this app adopts both together.
 *
 * No CSRF token in v1: a per-session token in a hidden field needs EVERY form
 * template to render it — four cross-task obligations whose failure mode is a
 * broken form discovered late. The trigger to add one is the first form
 * submitted to us from a page we do not render.
 *
 * @param {object} config frozen settings. Nothing here reads one today — the
 *   comparison is between two request headers — but the signature matches the
 *   other mounts in app.js so every line there reads alike.
 */
export function requireSameOrigin(config) {
  return function requireSameOriginMiddleware(req, res, next) {
    if (SAFE_METHODS.has(req.method)) return next();
    const host = req.headers.host;
    const source = req.headers.origin ?? req.headers.referer;
    // Fail CLOSED: both headers absent is a refusal, not a pass.
    if (typeof host !== 'string' || typeof source !== 'string') {
      return line(res, 403, 'AuthError: forbidden-origin');
    }
    let sourceHost;
    try {
      ({ host: sourceHost } = new URL(source));
    } catch {
      return line(res, 403, 'AuthError: forbidden-origin');
    }
    if (sourceHost !== host) return line(res, 403, 'AuthError: forbidden-origin');
    return next();
  };
}

/**
 * The boundary. Everything mounted below this in app.js requires a session.
 *
 * A safe method carries ?next= so a signed-in freelancer lands where they were
 * going (the states ledger's Flow 4). An unsafe method does NOT: a POST body
 * cannot be replayed after a redirect, so offering to resume it would be a lie.
 *
 * @param {object} config frozen settings (unread today — see requireSameOrigin)
 */
export function requireSession(config) {
  return function requireSessionMiddleware(req, res, next) {
    if (req.currentUser !== undefined) return next();
    // THE SIGN-IN PATH IS NEVER GUARDED. It is where this middleware SENDS
    // people, so guarding it is an infinite redirect loop.
    //
    // SINCE AS-45, GET /signin IS SERVED ABOVE THIS BOUNDARY (routes/auth.js,
    // publicAuthRoutes), so this middleware never sees that request and the
    // line is dead for the case it was written for. IT IS KEPT ON PURPOSE: it
    // still answers every UNREGISTERED METHOD on that path — PUT /signin,
    // DELETE /signin — which would otherwise redirect to itself, and it costs
    // one comparison. (Note the ordering, measured in review: for an
    // unregistered method the origin check runs FIRST, so this line is reached
    // only after requireSameOrigin has let the request past.)
    //
    // CORRECTED 2026-09-03 (AS-45 review cycle 1, finding F-5). This comment
    // used to claim: "test/auth.test.js's G3 exercises the interaction: move
    // GET /signin below the boundary and this carve-out lets a cookieless
    // request through to the handler, which turns G3 red." THAT IS FALSE, and it was falsified twice independently — moving
    // the route below the boundary leaves the whole suite GREEN. Two reasons,
    // either sufficient alone: G2/G3 derive the protected set by filtering the
    // discovered routes against the PUBLIC_ROUTES literal, which names
    // 'GET /signin' regardless of which sub-router registered it; and this
    // carve-out returns next() before requireSession can redirect, so a
    // cookieless GET answers 200 from either side. THE CARVE-OUT DOES NOT TEST
    // THE MOUNT POSITION — IT MAKES THE POSITION UNOBSERVABLE FOR THIS PATH.
    //
    // What the partition guarantee IS, one-directionally: a route that should
    // be protected but is mounted public is caught, PROVIDED nobody also adds
    // it to PUBLIC_ROUTES. That proviso is the hinge, and the two-file
    // discipline (a new route requires a PUBLIC_ROUTES edit with a written
    // reason) is what enforces it. The residual — publicness by placement
    // versus publicness by carve-out — is bounded rather than closed, by
    // auth.test.js's 'requireSession has exactly one path carve-out': a second
    // path cannot join the unobservable set without moving a committed number.
    // That case is required by review cycle 1 and lands with the rework; if you
    // are reading this and it does not exist, that is itself a finding.
    if (req.path === SIGNIN_PATH) return next();
    const target = SAFE_METHODS.has(req.method)
      ? `${SIGNIN_PATH}?next=${encodeURIComponent(req.originalUrl)}`
      : SIGNIN_PATH;
    return res.redirect(303, target);
  };
}

/**
 * Is a session present? The non-throwing counterpart to actingFreelancerId,
 * for a PUBLIC page that renders differently for a signed-in caller (AS-45:
 * `GET /signin` answers S1-DENIED-AUTHENTICATED with a 303).
 *
 * It lives HERE rather than in the route because the `current user` concept row
 * pins req.currentUser to this file alone — a route module reading it directly
 * would be a red test, and that is the property that keeps every impersonation
 * question answerable from one file.
 */
export function hasSession(req) {
  return req.currentUser !== undefined;
}

/**
 * The ONLY sanctioned way for a handler to learn who it is acting for.
 *
 * It THROWS when there is no current user, because reaching a guarded handler
 * without a session means a router was mounted above the boundary — a wiring
 * bug, which must be a loud 500, never a silent action taken as nobody. This is
 * the third layer: the mount order is layer 1, the enumeration test is layer 2,
 * and a handler that quietly does without the guard cannot.
 */
export function actingFreelancerId(req) {
  if (req.currentUser === undefined) {
    throw new Error('actingFreelancerId: no current user — this handler is mounted above the auth boundary in app.js');
  }
  return req.currentUser.id;
}
