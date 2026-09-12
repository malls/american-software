// lib/webhooks/signature.js — the pure Stripe webhook signature verifier
// (AS-44, plan §3.2).
//
// PURE, like lib/stripe/custody.js: raw bytes + the Stripe-Signature header +
// the endpoint's signing secret + a clock reading go in; a verified timestamp
// comes out, or a SignatureError carrying a fixed reason code. No I/O, no
// config, no database, no clock of its own — which is what makes this the one
// genuinely unit-testable half of a task whose other half cannot be delivered
// offline at all (plan §5.5).
//
// THE SCHEME. Stripe signs `${t}.${payload}` with HMAC-SHA256 keyed on the
// endpoint's signing secret and sends
// `Stripe-Signature: t=<epoch seconds>,v1=<hex>` — possibly with several `v1`
// elements during a secret rotation, and possibly with schemes we have never
// heard of. Unknown schemes are IGNORED, never rejected: Stripe adds them on
// Stripe's schedule, and a receiver that fails on an unrecognised element
// breaks on their schedule rather than ours.
//
// THE RAW-BODY RULE, which is the whole of this module's risk. `payload` is a
// Buffer and this module REFUSES a string. The signed material is assembled as
// bytes and the request is never turned into a string before it is hashed.
// That matters twice: an upstream JSON parser would re-serialise the body and
// key order, whitespace and \uXXXX escaping all survive a JSON round trip
// unpredictably; and a payload carrying multi-byte UTF-8 hashes correctly by
// construction because no encoding is ever chosen. This app mounts no
// app-wide parser (routes/invoices.js mounts its own per route, and
// test/dependency-policy.test.js's `body parser` row keeps it that way), but
// this module does not RELY on that — refusing a string is the layer that
// still holds when someone adds one.
//
// THE SECRET IS USED VERBATIM, `whsec_` prefix included: that is Stripe's
// scheme. Stripping the prefix is a plausible-looking edit that a suite whose
// signer and verifier are the same code could never see, so the committed
// known-answer vector in test/webhooks.test.js (S1) pins the whole computation
// against a literal digest — see plan §5.5 for exactly what that does and does
// not prove.
//
// ERRORS CARRY A REASON CODE AND NOTHING ELSE — never the secret, never the
// payload, never the expected digest, never the candidate that failed.
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Stripe's own libraries and CLI assume five minutes, so a value we picked
 *  differently is a value we would have to defend to every future reader.
 *
 *  A MODULE CONSTANT, NOT A CONFIG ROW: nothing about a deployment should
 *  change it, and a setting nobody should tune is a setting that will be tuned.
 *
 *  THE BOUND IS ON THE PAST ONLY, and that is reasoned rather than copied. `t`
 *  is inside the signed material, so without the secret an attacker cannot mint
 *  a future-dated delivery — there is no security gain from a future bound,
 *  while there is a real cost: a container clock running behind would make
 *  every legitimate delivery look future-dated and the endpoint would die. The
 *  symmetric failure (a clock running more than five minutes AHEAD) rejects
 *  every delivery with `stale_timestamp`, which is the loudest possible symptom
 *  and the correct one. */
export const DEFAULT_TOLERANCE_SECONDS = 300;

/** One class, one `reason`, one `step`. The route maps the class to 400 and
 *  prints `SignatureError: verify-signature` — the house one-line body, which
 *  says a signature was refused without saying which check refused it. The
 *  reason code is for OUR logs and OUR tests, not for the caller. */
export class SignatureError extends Error {
  constructor(reason) {
    super(`webhook signature rejected: ${reason}`);
    this.name = 'SignatureError';
    this.reason = reason;
    this.step = 'verify-signature';
  }
}

/** A candidate must LOOK like a SHA-256 digest before it is converted, so
 *  timingSafeEqual can never be handed two buffers of different lengths and
 *  throw — which would turn a malformed signature into a 500. */
const SHA256_HEX = /^[0-9a-f]{64}$/i;
const DIGITS = /^\d+$/;

/**
 * Split `t=…,v1=…,v1=…` on commas, then each element on its FIRST `=` (a
 * base64-ish value could contain more). Exactly one `t` is required and it must
 * be all digits; every `v1` is collected in order; every other scheme is
 * dropped on the floor.
 *
 * @returns {{ timestamp: number, candidates: string[] }}
 */
function parseHeader(header) {
  let timestamp = null;
  const candidates = [];
  for (const element of header.split(',')) {
    const at = element.indexOf('=');
    if (at === -1) throw new SignatureError('malformed_header');
    const key = element.slice(0, at).trim();
    const value = element.slice(at + 1).trim();
    if (key === 't') {
      // Two `t` elements is not a rotation, it is a mangled header: refuse
      // rather than pick one, because picking one is picking which signature
      // the digest is checked against.
      if (timestamp !== null) throw new SignatureError('malformed_header');
      if (!DIGITS.test(value)) throw new SignatureError('malformed_header');
      timestamp = Number(value);
      if (!Number.isSafeInteger(timestamp)) throw new SignatureError('malformed_header');
    } else if (key === 'v1') {
      candidates.push(value);
    }
  }
  if (timestamp === null) throw new SignatureError('malformed_header');
  return { timestamp, candidates };
}

/**
 * Verify a Stripe webhook delivery.
 *
 * Six ordered steps, each with its own reason code, and the order is
 * load-bearing: nothing about the event — not its type, not its id — is read
 * before the signature is checked, and no database work happens before this
 * function returns.
 *
 *   1 payload is a Buffer, secret is a non-empty string  -> not_raw
 *   2 header is present and a string                     -> missing_header
 *   3 the header parses, with exactly one integer `t`    -> malformed_header
 *   4 at least one v1 element                            -> no_v1
 *   5 `t` is no older than the tolerance (past only)     -> stale_timestamp
 *   6 some v1 candidate equals the digest                -> no_match
 *
 * @param {{ payload: Buffer, header: unknown, secret: unknown, nowMs: number,
 *   toleranceSeconds?: number }} input
 * @returns {{ timestamp: number }} the verified signing time, in epoch seconds
 * @throws {SignatureError} with `reason` set to one of the codes above
 */
export function verifyStripeSignature({ payload, header, secret, nowMs, toleranceSeconds = DEFAULT_TOLERANCE_SECONDS }) {
  // 1. THE RAW-BODY GUARD. A string here means something upstream parsed and
  //    re-serialised the request, and a digest over re-serialised bytes is a
  //    digest over a different document.
  if (!Buffer.isBuffer(payload)) throw new SignatureError('not_raw');
  if (typeof secret !== 'string' || secret.trim() === '') throw new SignatureError('not_raw');
  // The clock is the CALLER'S, always supplied. A missing or nonsensical
  // reading is a programming error, not a bad request: a TypeError (the
  // lib/invoices/mapping.js convention) rather than a refusal that would let
  // step 5 silently pass on NaN.
  if (!Number.isFinite(nowMs)) throw new TypeError('webhook signature: nowMs must be a finite epoch-milliseconds reading');

  // 2-3. The header.
  if (typeof header !== 'string') throw new SignatureError('missing_header');
  const { timestamp, candidates } = parseHeader(header);

  // 4. A delivery signed only under a scheme we do not implement is not
  //    malformed — it is unverifiable by us, and it says so.
  if (candidates.length === 0) throw new SignatureError('no_v1');

  // 5. Past-only tolerance (see DEFAULT_TOLERANCE_SECONDS).
  if (Math.floor(nowMs / 1000) - timestamp > toleranceSeconds) throw new SignatureError('stale_timestamp');

  // 6. THE COMPARISON. The signed material is built from BYTES: the ASCII
  //    prefix `${t}.` concatenated with the request exactly as it arrived.
  const signed = Buffer.concat([Buffer.from(`${timestamp}.`, 'utf8'), payload]);
  const expected = createHmac('sha256', secret).update(signed).digest();
  for (const candidate of candidates) {
    // The shape check runs for EVERY candidate on every call, in this loop,
    // ahead of the conversion — there is no path to timingSafeEqual that skips
    // it. A candidate that fails is skipped, never thrown on: one malformed
    // element among several must not decide the whole delivery.
    if (!SHA256_HEX.test(candidate)) continue;
    const supplied = Buffer.from(candidate, 'hex');
    if (supplied.length === expected.length && timingSafeEqual(supplied, expected)) return { timestamp };
  }
  throw new SignatureError('no_match');
}
