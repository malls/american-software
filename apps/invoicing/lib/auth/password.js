// lib/auth/password.js — credential hashing (AS-40, plan §3.2).
//
// scrypt from node:crypto, so this adds no dependency. The choice over pbkdf2
// is memory hardness, and that is the whole reason: pbkdf2 is compute-hard
// only and maps almost perfectly onto GPUs, where an attacker's parallelism is
// bounded by arithmetic units. scrypt at N=16384, r=8 needs ~16 MiB of working
// memory PER GUESS, so their parallelism is bounded by memory capacity and
// bandwidth instead — on the order of a thousand concurrent instances on a
// large card, against millions of pbkdf2 lanes. That ratio is the decision.
//
// The realistic compromise this defends against is OFFLINE: someone obtains the
// SQLite file and grinds the stored values on their own hardware. Online
// guessing is a different threat with a different answer (plan §3.8, and the
// deployment shape it rests on). Read the two together.
//
// ASYNC scrypt, NEVER scryptSync. The synchronous form blocks the event loop
// for the full ~40 ms, so N concurrent sign-ins serialise AND stall every other
// request in this single-process server. That is a correctness property, not a
// style preference; the callback form runs on libuv's threadpool.
//
// The stored value is SELF-DESCRIBING, so raising the parameters never
// invalidates an existing account — see encodeHash's shape and the
// upgrade-on-login path in lib/auth/accounts.js.
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * The shipped default. N=2^14 rather than 2^15 for one specific reason: at
 * 2^15 a single derivation needs 32 MiB, which EXCEEDS Node's default `maxmem`
 * and throws ERR_CRYPTO_INVALID_SCRYPT_PARAMS (measured). That makes 2^15 a
 * parameter set which only works while every call site remembers to pass
 * `maxmem`. 2^14 is the strongest set whose failure mode under omission is
 * benign. We pass `maxmem` explicitly anyway, so raising N later is a
 * one-character change — but we do not ship a set that a forgotten argument
 * turns into an outage.
 *
 * p=1 deliberately: raising p buys more of OUR cpu without raising the memory
 * ceiling, which is the parameter that costs us most per unit of attacker cost.
 * Raise N first, always. l=32 is 256 bits, matching this design's security
 * level; 64 is a habit inherited from other schemes and stores twice the bytes
 * for nothing.
 */
export const DEFAULT_PARAMS = Object.freeze({ N: 16384, r: 8, p: 1, l: 32 });

/** 128 bits of salt, from randomBytes: precomputation across users is worthless
 *  and per-user collisions do not occur. */
const SALT_BYTES = 16;

/** Passed explicitly at every derivation (see DEFAULT_PARAMS). Generous enough
 *  to verify any hash decodeHash will accept, which is bounded at 64 MiB. */
const MAXMEM = 128 * 1024 * 1024;

/** The bound decodeHash enforces on 128*N*r. Without it a row carrying
 *  N=2^20,r=32 would ask the process for gigabytes on the next sign-in. The row
 *  is not attacker-writable today; the bound removes the class anyway. */
const MAX_DERIVATION_BYTES = 64 * 1024 * 1024;

/** The account rules, exported for lib/auth/accounts.js — which is where they
 *  are enforced, because "how long may a password be" is a rule about signing
 *  up, not about hashing. Counted on the RAW string, before normalisation. */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 256;

const ALGORITHM = 'scrypt';
const PARAMS_SHAPE = /^N=(\d+),r=(\d+),p=(\d+),l=(\d+)$/;

/**
 * NFC at BOTH ends, forever. A password typed with combining characters on one
 * platform and precomposed on another is the same password to the person
 * typing it; without normalisation it is not the same password to us. Changing
 * this later would invalidate every stored hash, so it is decided now.
 *
 * NEVER trimmed: a leading or trailing space is a character of the secret, and
 * trimming silently changes it. (Emails ARE trimmed — a different thing.)
 */
function normalise(password) {
  if (typeof password !== 'string') throw new TypeError('password: must be a string');
  return password.normalize('NFC');
}

function derive(password, salt, { N, r, p, l }) {
  return new Promise((resolve, reject) => {
    scrypt(normalise(password), salt, l, { N, r, p, maxmem: MAXMEM }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

/** `scrypt$N=…,r=…,p=…,l=…$<salt base64url>$<key base64url>` — four
 *  $-separated fields, roughly 96 characters. */
export function encodeHash({ params, salt, key }) {
  const { N, r, p, l } = params;
  return [ALGORITHM, `N=${N},r=${r},p=${p},l=${l}`, salt.toString('base64url'), key.toString('base64url')].join('$');
}

/**
 * STRICT, and bounded. Every field is checked, because this parses a value that
 * decides how much memory the next derivation asks for.
 *
 * @throws {TypeError} on any malformed shape — a corrupt credential row is a
 *   500, never a silently weaker verification.
 */
export function decodeHash(encoded) {
  if (typeof encoded !== 'string') throw new TypeError('hash: must be a string');
  const fields = encoded.split('$');
  if (fields.length !== 4) throw new TypeError(`hash: expected 4 $-separated fields, got ${fields.length}`);
  const [algorithm, paramText, saltText, keyText] = fields;
  if (algorithm !== ALGORITHM) throw new TypeError(`hash: algorithm must be ${ALGORITHM}, got ${algorithm}`);
  const match = PARAMS_SHAPE.exec(paramText);
  if (match === null) throw new TypeError(`hash: parameters must match N=…,r=…,p=…,l=…, got ${paramText}`);
  const [N, r, p, l] = match.slice(1, 5).map(Number);
  if (!Number.isInteger(Math.log2(N)) || N < 1024 || N > 1048576) throw new TypeError(`hash: N must be a power of two in 2^10…2^20, got ${N}`);
  if (r < 1 || r > 32) throw new TypeError(`hash: r must be in 1…32, got ${r}`);
  if (p < 1 || p > 16) throw new TypeError(`hash: p must be in 1…16, got ${p}`);
  if (l < 16 || l > 64) throw new TypeError(`hash: l must be in 16…64, got ${l}`);
  if (128 * N * r > MAX_DERIVATION_BYTES) throw new TypeError(`hash: 128*N*r exceeds the ${MAX_DERIVATION_BYTES}-byte bound`);
  const salt = Buffer.from(saltText, 'base64url');
  const key = Buffer.from(keyText, 'base64url');
  if (salt.length === 0) throw new TypeError('hash: salt is empty');
  if (key.length !== l) throw new TypeError(`hash: key is ${key.length} bytes, parameters say ${l}`);
  return { params: { N, r, p, l }, salt, key };
}

/**
 * Hash at the current default. Pure and importable with no server dependency —
 * which is what makes the operator's forgotten-password procedure (README) work
 * today and the M3 reset flow reuse it tomorrow.
 *
 * @param {string} password
 * @returns {Promise<string>} the encoded form
 */
export async function hashPassword(password) {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, DEFAULT_PARAMS);
  return encodeHash({ params: DEFAULT_PARAMS, salt, key });
}

/**
 * Verify, and say whether the stored parameters are behind the current default.
 *
 * The comparison is timingSafeEqual after a length check. The timing channel
 * here is weaker than in an HMAC verification — an attacker cannot choose the
 * value being compared without inverting scrypt — but arguing that inside a
 * security boundary is exactly the reasoning that ages badly, and the
 * constant-time primitive is free.
 *
 * @param {string} password the presented plaintext
 * @param {string} encoded the stored value
 * @returns {Promise<{ ok: boolean, needsRehash: boolean }>} `needsRehash` is
 *   true only when verification SUCCEEDED and the decoded parameters differ
 *   from the current default.
 */
export async function verifyPassword(password, encoded) {
  const { params, salt, key } = decodeHash(encoded);
  const derived = await derive(password, salt, params);
  const ok = derived.length === key.length && timingSafeEqual(derived, key);
  return { ok, needsRehash: ok && !sameParams(params, DEFAULT_PARAMS) };
}

function sameParams(a, b) {
  return a.N === b.N && a.r === b.r && a.p === b.p && a.l === b.l;
}
