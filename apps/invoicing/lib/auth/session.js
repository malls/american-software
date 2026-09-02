// lib/auth/session.js — the token, its digest, and the cookie (AS-40, plan
// §3.3.2, §3.4).
//
// THE ONLY FILE THAT MAY SET OR READ A COOKIE. A dependency-policy concept row
// pins res.cookie / clearCookie / req.headers.cookie to this file, so a second
// place learning to mint or read one is a red test rather than a review catch.
//
// The cookie carries 32 random bytes; the database stores their SHA-256 as 64
// lowercase hex characters, and that digest IS the primary key. A leaked
// database file therefore yields nothing usable.
//
// A FAST HASH IS CORRECT HERE, AND A SLOW ONE WOULD BE WRONG. The input is
// full-entropy, so there is no dictionary to iterate; the KDF's cost model in
// password.js applies to human-chosen secrets and to nothing else. This
// paragraph exists so a future reader does not "fix" the inconsistency.
import { createHash, randomBytes } from 'node:crypto';

/** Namespaced like INVOICING_* and apps/chat's CHAT_*: a bare `session` would
 *  collide with anything else served from 127.0.0.1 during development. */
export const COOKIE_NAME = 'invoicing_session';

/**
 * Fixed absolute expiry of 14 days from issue. No renewal, no sliding window.
 *
 * It must comfortably exceed the longest gap the v1 loop itself imposes — the
 * Stripe hosted-KYC detour, which can run from minutes to days while a
 * freelancer gathers documents. A session that died mid-KYC would mean Stripe's
 * return redirect lands on sign-in, the return handler never runs, and the
 * connected account is never readiness-synced.
 *
 * No renewal, because renewal makes every guarded GET a database WRITE — WAL
 * growth and a write lock on the read path — to buy convenience v1 does not
 * need. Without it the guard is a pure read and expiry is one comparison.
 */
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** 32 bytes: base64url is 43 characters and needs no percent-encoding. */
const TOKEN_BYTES = 32;

/** The digest of `token`, as the 64 lowercase hex characters the DDL requires.
 *  There is no useful timing channel on the lookup that uses it: what would
 *  leak is the digest, and knowing the digest does not produce the token. */
export function tokenId(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** @returns {{ token: string, id: string }} the cookie value and its stored key. */
export function mintToken() {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  return { token, id: tokenId(token) };
}

/**
 * `Secure` is derived from a setting the app already validates as a bare
 * origin, so a loopback HTTP deployment gets no `Secure` (the cookie works in
 * every browser, including ones that do not treat http://127.0.0.1 as
 * trustworthy) and the first HTTPS deployment gets it with NO new setting and
 * NO code change.
 */
const isSecure = (config) => config.appBaseUrl.startsWith('https:');

/**
 * Set the session cookie.
 *
 * SameSite=Lax, not Strict, and the reason is load-bearing: Stripe's hosted
 * onboarding returns the freelancer by redirecting the browser to
 * GET /connect-stripe/return — a cross-site top-level GET navigation. Under
 * Strict the cookie is not sent on that navigation, the return handler sees no
 * session, readiness is never synced, and chain link 2 silently breaks.
 *
 * Not using the __Host- prefix, deliberately: it would force Secure
 * unconditionally, which conflicts with the loopback row above, and its
 * guarantees (Path=/, no Domain) are ones we set explicitly anyway. Its real
 * value is a browser enforcing them against a sibling-subdomain attacker, and
 * we have no domain at all. The first HTTPS deployment on a real domain adopts
 * it in the same task that configures the domain.
 *
 * Max-Age is a client-side hint only; sessions.expires_at is the authority, and
 * a client that ignores it presents a token whose row has expired.
 */
export function setSessionCookie(res, token, config) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure(config),
    path: '/',
    maxAge: SESSION_TTL_MS,
  });
}

/**
 * Clear it. The attributes MUST match setSessionCookie's — httpOnly, sameSite,
 * secure and path — or a browser will not match the cookie it is meant to
 * remove. They are written out rather than shared so each call site can be
 * mutated independently under falsification; both emitted strings are asserted.
 */
export function clearSessionCookie(res, config) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure(config),
    path: '/',
  });
}

/**
 * The session token on a request, or null.
 *
 * req.cookies does not exist: cookie-parser is not a dependency and will not
 * become one. Parsed from the raw header — split on `;`, trim, split each pair
 * on its FIRST `=`, take the FIRST match for our name (RFC 6265 leaves
 * duplicate-name ordering to the client; taking the first and saying so beats
 * an unstated choice). A malformed percent-escape is an ABSENT token, not a
 * 500.
 */
export function readSessionToken(req) {
  const header = req.headers.cookie;
  if (typeof header !== 'string') return null;
  for (const pair of header.split(';')) {
    const text = pair.trim();
    const at = text.indexOf('=');
    if (at <= 0) continue;
    if (text.slice(0, at) !== COOKIE_NAME) continue;
    const raw = text.slice(at + 1);
    try {
      return decodeURIComponent(raw);
    } catch {
      return null;
    }
  }
  return null;
}
