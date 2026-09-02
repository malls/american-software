// test/helpers/auth.js — a signed-in freelancer, without paying for a KDF
// (AS-40, plan §5.1).
//
// Every suite whose routes now sit behind the auth boundary needs a session
// cookie, and none of them are testing sign-in. Going through POST /signin
// would cost one scrypt derivation (~40 ms, 16 MiB) per case — on the order of
// a hundred of them across connect/invoices/webhooks — to prove something those
// suites do not claim. So this mints the session ROW directly through the same
// repository the service uses, and hands back the cookie header the browser
// would have been sent.
//
// The one thing this deliberately does NOT do is fabricate a cookie value: the
// token comes from the real mintToken, and its digest is what is stored, so a
// suite using this exercises the real readSessionToken/resolveSession path.
import { COOKIE_NAME, SESSION_TTL_MS, mintToken } from '../../lib/auth/session.js';

/**
 * Seed a session for an existing freelancer.
 *
 * @param {object} repos createRepositories()'s object
 * @param {string} freelancerId
 * @param {{ expiresAt?: string }} [options] an explicit expiry — pass a past
 *   timestamp to build an expired session without waiting for one.
 * @returns {{ token: string, id: string, cookie: string }} `cookie` is ready to
 *   use as a `Cookie` request header.
 */
export function seedSession(repos, freelancerId, { expiresAt } = {}) {
  const { token, id } = mintToken();
  repos.sessions.create({
    id,
    freelancerId,
    expiresAt: expiresAt ?? new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  });
  return { token, id, cookie: `${COOKIE_NAME}=${token}` };
}

/**
 * Create a freelancer AND a session for them in one step — the shape most
 * suites want.
 *
 * @param {object} repos
 * @param {{ email?: string, displayName?: string }} [attrs]
 * @returns {{ freelancer: object, token: string, id: string, cookie: string }}
 */
export function seedSignedIn(repos, { email = 'f@example.test', displayName = 'Freda Lancer' } = {}) {
  const freelancer = repos.freelancers.create({ email, displayName });
  return { freelancer, ...seedSession(repos, freelancer.id) };
}

/**
 * The headers an unsafe-method request needs to satisfy BOTH middlewares: the
 * session cookie, and an Origin the same-origin check accepts.
 *
 * requireSameOrigin compares Origin's host to the request's Host header, so the
 * base URL a suite is already using IS the correct origin — which is why this
 * takes it rather than reading config.
 *
 * @param {string} baseUrl the withServer base, e.g. http://127.0.0.1:54321
 * @param {string} cookie from seedSession / seedSignedIn
 * @param {object} [extra] merged last
 */
export function signedInHeaders(baseUrl, cookie, extra = {}) {
  return { cookie, origin: baseUrl, ...extra };
}
