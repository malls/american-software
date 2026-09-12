// client.js — the Stripe client the rest of the product calls (AS-38, plan §2.2–§2.3).
//
// One entry point, `createStripeClient(...).request(call)`, and a seven-step
// pipeline with a fixed order:
//
//   validateCall → buildUnsigned → guardRequest → requireKey → sign → transport → interpret
//
// The order is the design. The custody guard (./custody.js) runs on the fully
// materialised wire request — method, absolute URL with query, headers, encoded
// body — BEFORE the key is even looked at, so a custody violation is reported on
// a machine with no key configured, and the guard never sees a key. Signing adds
// exactly one header, and no error raised after signing carries headers.
//
// `baseUrl` is an option, never configuration: an env-settable base URL would
// send the secret key wherever the environment says. Only tests pass one (a
// loopback listener, the stripe-mock service).
import { ConfigError } from '../config.js';
import { StripeCustodyError, guardRequest } from './custody.js';
import { fetchTransport } from './transport.js';

export { StripeCustodyError };

/** The Stripe API version every allowlisted shape was validated against
 *  (stripe-mock v0.203.0, strict version check). */
const API_VERSION = '2026-08-26.dahlia';
const DEFAULT_BASE_URL = 'https://api.stripe.com';
const METHODS = new Set(['GET', 'POST']);
const CALL_FIELDS = new Set(['method', 'path', 'account', 'platform', 'params', 'idempotencyKey']);
/** A bare /v1 path: no query, fragment, percent-escapes, dots, dashes or `//`. */
const PATH = /^\/v1(\/[A-Za-z0-9_]+)+$/;
const TRANSPORT_CODES = new Set(['network', 'timeout', 'redirect']);

/** Stripe answered, and the answer is an error (status ≥ 400 or an `error`
 *  body). Carries what Stripe said about it — never what we sent. */
export class StripeApiError extends Error {
  constructor({ status, requestId = null, type = null, code = null, param = null, stripeMessage = null }) {
    const detail = [type, code && `(${code})`, param && `on ${param}`].filter(Boolean).join(' ');
    super(`Stripe ${status}${detail ? ' ' + detail : ''}: ${stripeMessage ?? '(no message)'}`);
    this.name = 'StripeApiError';
    this.status = status;
    this.requestId = requestId;
    this.type = type;
    this.code = code;
    this.param = param;
    this.stripeMessage = stripeMessage;
  }
}

/** Stripe did not answer usably. `code` ∈ {network, timeout, redirect,
 *  invalid_json}; `cause` is the underlying error. */
export class StripeTransportError extends Error {
  constructor(code, { cause, status = null } = {}) {
    super(`Stripe transport ${code}${cause?.message ? ': ' + cause.message : ''}`, cause === undefined ? undefined : { cause });
    this.name = 'StripeTransportError';
    this.code = code;
    this.status = status;
  }
}

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;

/**
 * Encode params in Stripe's bracket notation: nested objects → `a[b][c]`, arrays
 * → `a[0]`, `a[1]`; strings verbatim; finite numbers and booleans stringified;
 * `null` → `''` (Stripe's "unset"); `undefined` omitted. Anything else — Date,
 * BigInt, function, symbol, a non-finite number — is a TypeError, not a guess.
 * The result is what goes on the wire, and what the guard reads.
 */
export function encodeForm(params) {
  if (!isPlainObject(params)) throw new TypeError('stripe: encodeForm takes a plain object');
  const out = new URLSearchParams();
  const walk = (value, key) => {
    if (value === undefined) return;
    if (value === null) return out.append(key, '');
    if (typeof value === 'string') return out.append(key, value);
    if (typeof value === 'boolean') return out.append(key, String(value));
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new TypeError(`stripe: cannot encode non-finite number at ${key}`);
      return out.append(key, String(value));
    }
    if (Array.isArray(value)) return value.forEach((item, i) => walk(item, `${key}[${i}]`));
    if (isPlainObject(value)) {
      for (const [k, v] of Object.entries(value)) walk(v, `${key}[${k}]`);
      return;
    }
    throw new TypeError(`stripe: cannot encode a ${describe(value)} at ${key}`);
  };
  for (const [k, v] of Object.entries(params)) walk(v, k);
  return out.toString();
}

function describe(value) {
  if (typeof value !== 'object') return typeof value;
  return value.constructor?.name ?? 'object';
}

/**
 * Build a client. Every option is validated here so a bad one fails at
 * construction, not on the first call.
 *
 * @param {{ apiKey?: string | null, baseUrl?: string, transport?: Function, timeoutMs?: number, apiVersion?: string }} options
 * @returns {{ request: (call: object) => Promise<{ status: number, requestId: string | null, data: object }> }}
 */
export function createStripeClient({
  apiKey = null,
  baseUrl = DEFAULT_BASE_URL,
  transport = fetchTransport,
  timeoutMs = 30_000,
  apiVersion = API_VERSION,
} = {}) {
  if (apiKey !== null && typeof apiKey !== 'string') throw new TypeError('stripe: apiKey must be a string or null');
  if (typeof transport !== 'function') throw new TypeError('stripe: transport must be a function');
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new TypeError('stripe: timeoutMs must be a positive integer');
  if (typeof apiVersion !== 'string' || apiVersion.trim() === '') throw new TypeError('stripe: apiVersion must be a non-empty string');
  const options = Object.freeze({ apiKey, base: validateBaseUrl(baseUrl), transport, timeoutMs, apiVersion });
  return Object.freeze({ request: (call) => request(options, call) });
}

function validateBaseUrl(baseUrl) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch (err) {
    throw new TypeError(`stripe: baseUrl is not a URL: ${JSON.stringify(baseUrl)}`, { cause: err });
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new TypeError('stripe: baseUrl must be http: or https:');
  if (url.pathname !== '/') throw new TypeError('stripe: baseUrl must have no path');
  if (url.search !== '' || url.hash !== '') throw new TypeError('stripe: baseUrl must have no query or fragment');
  if (url.username !== '' || url.password !== '') throw new TypeError('stripe: baseUrl must carry no credentials');
  return url;
}

// --- the pipeline, in order ---------------------------------------------------

async function request(options, call) {
  validateCall(call);
  const unsigned = buildUnsigned(options, call);
  const guarded = guardRequest(unsigned);
  requireKey(options.apiKey);
  const signed = sign(guarded, options.apiKey);
  const response = await deliver(options, signed);
  return interpret(response);
}

/** Step 1 — shape, not policy. Every refusal here is a TypeError. */
function validateCall(call) {
  if (!isPlainObject(call)) throw new TypeError('stripe: request() takes a plain call object');
  for (const field of Object.keys(call)) {
    if (!CALL_FIELDS.has(field)) throw new TypeError(`stripe: unknown call field ${JSON.stringify(field)}`);
  }
  const { method, path, account, platform, params, idempotencyKey } = call;
  if (!METHODS.has(method)) throw new TypeError(`stripe: method must be GET or POST, got ${JSON.stringify(method)}`);
  if (typeof path !== 'string' || !PATH.test(path)) throw new TypeError(`stripe: path must be a bare /v1 path, got ${JSON.stringify(path)}`);
  if (params !== undefined && !isPlainObject(params)) throw new TypeError('stripe: params must be a plain object when given');
  if (account !== undefined && typeof account !== 'string') throw new TypeError('stripe: account must be a string when given');
  if (platform !== undefined && platform !== true) throw new TypeError('stripe: platform must be exactly true when given');
  if (idempotencyKey !== undefined) {
    if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 1 || idempotencyKey.length > 255) {
      throw new TypeError('stripe: idempotencyKey must be a string of 1 to 255 characters');
    }
    if (method !== 'POST') throw new TypeError('stripe: idempotencyKey is only meaningful on POST');
  }
}

/** Step 2 — the wire request, unsigned and frozen. GET params go in the query,
 *  POST params in the body; a parameterless POST still sends an empty
 *  form-encoded body with content-type set, because Stripe (and stripe-mock)
 *  reject a POST without it. Optional headers are added only when given, so no
 *  `undefined` is ever serialised onto the wire. */
function buildUnsigned({ base, apiVersion }, call) {
  const url = new URL(call.path, base);
  const headers = { accept: 'application/json', 'stripe-version': apiVersion };
  let body = null;
  if (call.method === 'GET') {
    if (call.params !== undefined) url.search = encodeForm(call.params);
  } else {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    body = encodeForm(call.params ?? {});
  }
  if (call.account !== undefined) headers['stripe-account'] = call.account;
  if (call.idempotencyKey !== undefined) headers['idempotency-key'] = call.idempotencyKey;
  return Object.freeze({
    method: call.method,
    url,
    headers: Object.freeze(headers),
    body,
    meta: Object.freeze({ platform: call.platform === true }),
  });
}

// Step 3 is guardRequest(), imported from ./custody.js and called in request().

/** Step 4 — only reached by a request the guard has already passed. */
function requireKey(apiKey) {
  if (typeof apiKey !== 'string' || apiKey.trim() === '') {
    throw new ConfigError('INVOICING_STRIPE_SECRET_KEY', 'is not configured; see apps/invoicing/README.md § Giving the app a key');
  }
}

/** Step 5 — the guarded request plus exactly one header. */
function sign(unsigned, apiKey) {
  const headers = { ...unsigned.headers, authorization: 'Bearer ' + apiKey };
  return Object.freeze({ ...unsigned, headers: Object.freeze(headers) });
}

/** Step 6 — hand the signed request to the transport; anything it throws is a
 *  StripeTransportError with the transport's code, or `network` if it had none. */
async function deliver({ transport, timeoutMs }, signed) {
  try {
    return await transport(signed, { timeoutMs });
  } catch (err) {
    throw new StripeTransportError(TRANSPORT_CODES.has(err?.code) ? err.code : 'network', { cause: err });
  }
}

/** Step 7 — parse and classify. Only named fields are copied out of Stripe's
 *  error object; nothing from the request is attached. */
function interpret(response) {
  const status = response?.status;
  const headers = response?.headers ?? {};
  let data;
  try {
    data = JSON.parse(response?.body);
  } catch (err) {
    throw new StripeTransportError('invalid_json', { cause: err, status });
  }
  if (!isPlainObject(data)) throw new StripeTransportError('invalid_json', { status });
  const requestId = typeof headers['request-id'] === 'string' ? headers['request-id'] : null;
  if (status >= 400 || data.error !== undefined) {
    const e = isPlainObject(data.error) ? data.error : {};
    throw new StripeApiError({ status, requestId, type: e.type ?? null, code: e.code ?? null, param: e.param ?? null, stripeMessage: e.message ?? null });
  }
  return { status, requestId, data };
}
