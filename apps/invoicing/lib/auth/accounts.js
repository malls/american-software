// lib/auth/accounts.js — the accounts service (AS-40, plan §3.7, §3.10).
//
// EVERY RULE ABOUT WHO MAY SIGN IN LIVES HERE, not in a route. routes/auth.js
// translates HTTP to these calls and error classes to statuses, exactly as
// routes/connect.js and routes/invoices.js do for their services.
//
// SIGN-IN REVEALS NOTHING, on three axes: status, body and headers are
// byte-identical for an unknown email and a wrong password, AND SO IS THE WORK
// DONE. On an unknown email the service still runs ONE hash at the default
// parameters and discards the result, so the two paths cost the same time and
// the same memory. That last axis is the one usually got wrong, and it is
// asserted structurally — the hasher arrives through the factory and a test
// injects a counting one — rather than by measuring wall-clock, which would be
// flaky and would eventually be deleted for being flaky.
//
// Sign-up reveals, unavoidably: a duplicate email is a 409 that names the
// conflict, because a system with unique emails cannot accept a duplicate
// silently without telling the person something. The standard mitigation is to
// accept and EMAIL the existing account — which needs email, which v1 does not
// have. The absence of email forces this oracle; it is not fixable here.
import { NotFoundError, UniqueViolationError } from '../db/database.js';
import { PASSWORD_MAX, PASSWORD_MIN, hashPassword, verifyPassword } from './password.js';
import { SESSION_TTL_MS, mintToken, tokenId } from './session.js';

/** A failure a caller may show a person. `step` IS the stable code — the same
 *  idiom as the Stripe services, so the house one-line body carries a legible
 *  code and routes map by class-and-step, never by message text. */
export class AuthError extends Error {
  constructor(step, message = step) {
    super(message);
    this.name = 'AuthError';
    this.step = step;
  }
}

/**
 * Deliberately weak. We cannot verify an address exists (no ESP, by two
 * independent rules), so this exists only to catch typing mistakes; anything
 * stricter rejects valid addresses and buys nothing.
 */
function assertEmailShape(email) {
  if (email.length > 254) throw new AuthError('invalid-email');
  const at = email.indexOf('@');
  if (at <= 0 || at !== email.lastIndexOf('@') || at === email.length - 1) throw new AuthError('invalid-email');
  if (/\s/.test(email)) throw new AuthError('invalid-email');
}

function requiredField(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw new AuthError('missing-field', `missing-field: ${field}`);
  return value;
}

/**
 * @param {{ repos: object, now?: () => string, hasher?: { hashPassword: Function, verifyPassword: Function } }} deps
 *   `hasher` is injectable so a test can count derivations; nothing else
 *   substitutes it.
 */
export function createAccounts({ repos, now = () => new Date().toISOString(), hasher = { hashPassword, verifyPassword } } = {}) {
  if (repos === null || typeof repos !== 'object') throw new TypeError('accounts: repos is required');
  if (typeof now !== 'function') throw new TypeError('accounts: now must be a function');
  if (hasher === null || typeof hasher !== 'object' || typeof hasher.hashPassword !== 'function' || typeof hasher.verifyPassword !== 'function') {
    throw new TypeError('accounts: hasher must expose hashPassword and verifyPassword');
  }

  /** Mint a row and return the cookie value. The opportunistic sweep rides here
   *  rather than on a scheduler: one row per sign-in, at most 14 days of them,
   *  and nothing to forget to start. */
  function issueSession(freelancerId) {
    const at = now();
    repos.sessions.deleteExpired(at);
    const { token, id } = mintToken();
    repos.sessions.create({ id, freelancerId, expiresAt: new Date(Date.parse(at) + SESSION_TTL_MS).toISOString() });
    return token;
  }

  /**
   * Create the freelancer and the credential in ONE transaction, and let the
   * unique index detect a duplicate email. findByEmail-then-create is a TOCTOU
   * race with itself; catching UniqueViolationError is race-free and one
   * branch shorter. The hash is computed BEFORE the transaction because it is
   * async and the transaction helper is synchronous — which is also the right
   * shape: no derivation happens while a write lock is held.
   */
  async function signUp({ displayName, email, password }) {
    requiredField(displayName, 'displayName');
    requiredField(email, 'email');
    requiredField(password, 'password');
    const trimmedEmail = email.trim();
    assertEmailShape(trimmedEmail);
    if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) throw new AuthError('weak-password');

    const passwordHash = await hasher.hashPassword(password);
    let freelancer;
    try {
      freelancer = repos.transaction(() => {
        const created = repos.freelancers.create({ email: trimmedEmail, displayName });
        repos.credentials.create(created.id, passwordHash);
        return created;
      });
    } catch (err) {
      if (err instanceof UniqueViolationError) throw new AuthError('email-taken');
      throw err;
    }
    return { freelancer, token: issueSession(freelancer.id) };
  }

  /**
   * ONE hash on every path, success or failure. See the header: the unknown
   * email and the absent credential both run hashPassword on the presented
   * plaintext and discard it, so the work done is the same as a real
   * verification. Hashing against a fresh salt is simpler than maintaining a
   * dummy verification target and costs exactly the same single derivation.
   */
  async function signIn({ email, password }) {
    requiredField(email, 'email');
    requiredField(password, 'password');

    const freelancer = repos.freelancers.findByEmail(email.trim());
    if (freelancer === null) {
      await hasher.hashPassword(password);
      throw new AuthError('invalid-credentials');
    }
    const credential = repos.credentials.getByFreelancer(freelancer.id);
    if (credential === null) {
      await hasher.hashPassword(password);
      throw new AuthError('invalid-credentials');
    }
    const { ok, needsRehash } = await hasher.verifyPassword(password, credential.passwordHash);
    if (!ok) throw new AuthError('invalid-credentials');
    // Upgrade-on-login: one extra derivation, only on the first sign-in after a
    // parameter change, and only for accounts that need it. Without this,
    // raising N would help new accounts only and every existing one would stay
    // at the old cost forever — which is what the self-describing format exists
    // to prevent.
    if (needsRehash) repos.credentials.updateHash(freelancer.id, await hasher.hashPassword(password));
    return { freelancer, token: issueSession(freelancer.id) };
  }

  /** Genuine revocation: the row is gone, immediately, for this session. What
   *  v1 does not have is "sign out everywhere" and an absolute cap beyond the
   *  14 days — both bound a STOLEN cookie, and the capability that makes them
   *  necessary is credential change, which v1 has none of. The first task that
   *  lets a credential change lands sessions.deleteForFreelancer and calls it. */
  function signOut(token) {
    if (typeof token !== 'string' || token === '') return false;
    return repos.sessions.delete(tokenId(token));
  }

  /**
   * The read behind every guarded request.
   *
   * An expired session behaves EXACTLY like an absent one — and the row is
   * deleted by the request that finds it expired, so the table self-cleans on
   * use. Client-side the two are indistinguishable, which is also what the
   * states ledger wants: DENIED-SIGNEDOUT is a single state.
   *
   * @returns {{ session: object, freelancer: object } | null}
   */
  function resolveSession(token) {
    if (typeof token !== 'string' || token === '') return null;
    const id = tokenId(token);
    const session = repos.sessions.getById(id);
    if (session === null) return null;
    // ISO-8601 UTC with milliseconds: lexicographic order IS chronological.
    if (session.expiresAt <= now()) {
      repos.sessions.delete(id);
      return null;
    }
    try {
      return { session, freelancer: repos.freelancers.getById(session.freelancerId) };
    } catch (err) {
      // A session naming a freelancer that no longer exists is not a 500; it is
      // a session that cannot be honoured. Delete it and answer as unsigned-in.
      if (err instanceof NotFoundError) {
        repos.sessions.delete(id);
        return null;
      }
      throw err;
    }
  }

  return Object.freeze({ signUp, signIn, signOut, resolveSession });
}
