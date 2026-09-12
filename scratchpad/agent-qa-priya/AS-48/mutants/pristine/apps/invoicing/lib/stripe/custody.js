// custody.js — "never in the flow of funds", as data plus one pure function
// (AS-38, plan §2.4–§2.5, §2.7).
//
// The product sends invoices on the freelancer's own Stripe account and is never
// the merchant of record, never holds a balance, never routes a payment. Stripe's
// API will not hold that boundary for us (spike §1: it returns 200 to the
// forbidden shape), so this file does. Three frozen tables and one regex ARE the
// policy; guardRequest() applies them to the fully materialised wire request —
// method, absolute URL including query, headers, encoded body — and either
// returns that same object or throws a StripeCustodyError. Values are never
// inspected: `expand[0]=transfer_data` is a read expansion and legitimate.
//
// PURE BY CONSTRUCTION: no imports, no I/O, no state. That is what lets the
// guard be tested without a client, so a client-level bypass (plan §6 M1) shows
// up as "guard-level green, client-level red" instead of green everywhere.
//
// Rows are added one at a time, by the dependent task that needs them, each
// with a reason — never a wildcard. `grep "scope: 'platform'"` here and
// `grep "platform: true"` across the codebase list every call that executes as
// us rather than as the freelancer.

/** A connected account id, and nothing that merely resembles one. */
export const ACCOUNT_ID = /^acct_[A-Za-z0-9]+$/;

/** Every endpoint the product may call, as `method path scope`. Exactly three
 *  are `platform` (no Stripe-Account header, executes as us) — all onboarding,
 *  because you cannot authenticate as an account that does not exist yet, and
 *  none of the three moves money. Everything else is `connected`: it carries
 *  `Stripe-Account: acct_…` and executes on the freelancer's account, where the
 *  money is theirs (spike §1: direct charges, Standard defaults).
 *  `{id}` matches exactly one segment of /[A-Za-z0-9_]+/. */
export const ALLOWED_ENDPOINTS = Object.freeze([
  { method: 'POST', path: '/v1/accounts', scope: 'platform', reason: 'create the freelancer\'s connected account; no account to act as yet; moves no money' },
  { method: 'POST', path: '/v1/account_links', scope: 'platform', reason: 'Stripe-hosted onboarding link; platform-created by Stripe\'s design' },
  { method: 'GET', path: '/v1/accounts/{id}', scope: 'platform', reason: 'onboarding status read (charges_enabled, details_submitted)' },
  { method: 'POST', path: '/v1/customers', scope: 'connected', reason: 'the freelancer\'s client, on the freelancer\'s account' },
  { method: 'POST', path: '/v1/invoiceitems', scope: 'connected', reason: 'line items' },
  { method: 'POST', path: '/v1/invoices', scope: 'connected', reason: 'collection_method=send_invoice; Stripe hosts the payment page' },
  { method: 'POST', path: '/v1/invoices/{id}/finalize', scope: 'connected', reason: 'finalize before send' },
  { method: 'POST', path: '/v1/invoices/{id}/send', scope: 'connected', reason: 'Stripe emails the client; we are never the sender of record' },
  { method: 'GET', path: '/v1/invoices/{id}', scope: 'connected', reason: 'status read; expand[] allowed' },
]);

/** Paths that may NEVER appear in ALLOWED_ENDPOINTS. Checked at module load
 *  (below): a row matching one of these fails the boot, not the first call. */
export const FORBIDDEN_ENDPOINT_PREFIXES = Object.freeze([
  '/v1/transfers', // separate charges & transfers: moves balance between accounts
  '/v1/payouts', // moving balance out of an account
  '/v1/topups', // moving money into a balance
  '/v1/application_fees', // the fee rail the board has not ruled on (A2)
  '/v1/charges', // we never create charges: Stripe's hosted invoice page does, on the connected account
  '/v1/payment_intents', // same
  '/v1/treasury', // stored balances
  '/v1/issuing', // cards
  '/v1/balance', // our own balance is not a product concern — nothing should land on it
]);

/** Parameter NAMES refused at every nesting depth, in body and query. Citations
 *  are to the OpenAPI spec bundled with stripe-mock v0.203.0 (API version
 *  2026-08-26.dahlia); counts are request-parameter occurrences across it. */
export const FORBIDDEN_PARAMS = Object.freeze([
  { name: 'transfer_data', cite: 'spec: 23 occurrences incl. POST /v1/invoices ("the funds from the invoice will be transferred to the destination"), payment_intent_data.transfer_data, subscription_data.transfer_data; spike §1 "the forbidden shape"', reason: 'destination charge: client money lands on OUR balance first' },
  { name: 'destination', cite: 'spec: 22 occurrences — transfer_data.destination, legacy top-level on POST /v1/charges, /v1/transfers, /v1/payouts', reason: 'the account money is routed to; banned as a segment so transfer_data[destination] is caught by two rows' },
  { name: 'on_behalf_of', cite: 'spec: 22 occurrences incl. POST /v1/invoices ("the account (if any) for which the funds of the invoice payment are intended"), payment_intent_data., setup_intent_data., subscription_data.', reason: 'settlement merchant override — the platform-side invoice shape' },
  { name: 'application_fee_amount', cite: 'spec: 13 occurrences incl. POST /v1/invoices ("transferred to the application owner\'s Stripe account. The request must be made with an OAuth key or the Stripe-Account header"); decision memo §4.2; board decision §3.2', reason: 'A2: no application-fee path until the board rules' },
  { name: 'application_fee_percent', cite: 'spec: 14 occurrences — subscriptions, subscription_schedules, payment_links, quotes, subscription_data.', reason: 'A2, the percentage form' },
  { name: 'application_fee', cite: 'spec: 2 occurrences — legacy POST /v1/charges and capture', reason: 'A2, the legacy form' },
  { name: 'transfer_group', cite: 'spec: 10 occurrences — charges, payment_intents, topups, transfers', reason: 'separate charges & transfers: groups money for later platform-side transfers' },
  { name: 'source_transaction', cite: 'spec: 1 occurrence — POST /v1/transfers ("transfer funds from a charge before they are added to your available balance")', reason: 'transfers funded from a charge on OUR balance' },
  { name: 'issuer', cite: 'spec: 20 occurrences incl. POST /v1/invoices ("The connected account that issues the invoice"), invoice_settings.issuer, invoice_creation.invoice_data.issuer', reason: 'a platform-owned invoice presented as the connected account\'s — funds on our balance; not named in the task description, found in the spec' },
  { name: 'controller', cite: 'spec: POST /v1/accounts controller[fees][payer], controller[losses][payments], controller[requirement_collection]; spike §1 documentary evidence: Standard-equivalent defaults are exactly what a bare POST /v1/accounts gives', reason: 'any controller override moves fee or loss liability onto us; AS-41 creates accounts with the defaults and sends no controller[...]' },
]);

// The tables above are frozen as arrays; freeze the rows too, so a row cannot
// be edited in place at runtime. Done here rather than with `.map(Object.freeze)`
// so each table stays `export const X = Object.freeze([` … `]);` — the shape the
// falsification recipes in plan §6 (M2, M7) rewrite with a one-line perl.
for (const row of [...ALLOWED_ENDPOINTS, ...FORBIDDEN_PARAMS]) Object.freeze(row);

/** A custody refusal. `code` is one of the values in plan §2.7 (plus
 *  `unexpected_platform`, the mirror of `unexpected_account`); `detail` is plain
 *  data — method, path, and for a banned parameter the key and the segment that
 *  tripped it. It never carries headers, header values, the body, or the key:
 *  this error is meant to be logged. */
export class StripeCustodyError extends Error {
  constructor(code, detail = {}) {
    const where = detail.method && detail.path ? ` on ${detail.method} ${detail.path}` : '';
    const what = detail.key !== undefined ? ` — parameter ${JSON.stringify(detail.key)} (segment ${JSON.stringify(detail.segment)})` : '';
    super(`CUSTODY: ${code}${where}${what}`);
    this.name = 'StripeCustodyError';
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

const BANNED = new Set(FORBIDDEN_PARAMS.map((row) => row.name));

/** Compile an allowlist path into an exact-match regex: `{id}` is one segment. */
function compilePath(path) {
  const source = path
    .split('/')
    .map((segment) => (segment === '{id}' ? '[A-Za-z0-9_]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return new RegExp(`^${source}$`);
}

const MATCHERS = ALLOWED_ENDPOINTS.map((row) => ({ row, pattern: compilePath(row.path) }));

// Fail closed at boot, not at first call: an allowlist row that reaches into a
// forbidden family is a policy error, and the process should not come up.
for (const row of ALLOWED_ENDPOINTS) {
  const prefix = FORBIDDEN_ENDPOINT_PREFIXES.find((p) => row.path.startsWith(p));
  if (prefix !== undefined) {
    throw new Error(`CUSTODY: ALLOWED_ENDPOINTS row ${row.method} ${row.path} matches forbidden prefix ${prefix} — refusing to load`);
  }
}

/**
 * Apply the policy to a materialised, unsigned wire request:
 * `{ method, url: URL, headers: { lower-case names }, body: string | null,
 * meta: { platform: boolean } }`. Order is binding (plan §2.7): endpoint, then
 * scope, then parameters — a request that is both off-allowlist and carrying
 * `transfer_data` reports `endpoint_not_allowed`.
 *
 * @returns the SAME object it was handed (so a caller can prove, by identity,
 *   that what was guarded is what was signed), or throws StripeCustodyError.
 */
export function guardRequest(request) {
  const where = { method: request.method, path: request.url.pathname };
  const match = MATCHERS.find((m) => m.row.method === where.method && m.pattern.test(where.path));
  if (match === undefined) throw new StripeCustodyError('endpoint_not_allowed', where);
  const row = match.row;
  checkScope(row, request);
  checkParams(request, where);
  return request;
}

/** Connected rows need a well-formed Stripe-Account and must not be declared
 *  platform; platform rows must carry no Stripe-Account and MUST be declared
 *  `platform: true` at the call site (so the declaration is greppable). */
function checkScope(row, request) {
  const where = { method: request.method, path: request.url.pathname };
  const account = request.headers['stripe-account'];
  if (row.scope === 'platform') {
    if (account !== undefined) throw new StripeCustodyError('unexpected_account', where);
    if (request.meta.platform !== true) throw new StripeCustodyError('platform_not_declared', where);
    return;
  }
  if (request.meta.platform === true) throw new StripeCustodyError('unexpected_platform', where);
  if (account === undefined) throw new StripeCustodyError('missing_account', where);
  if (typeof account !== 'string' || !ACCOUNT_ID.test(account)) throw new StripeCustodyError('invalid_account_id', where);
}

/** The wire form, decoded: every key in the encoded body and in the query, split
 *  into bracket/dot segments, each segment compared case-insensitively against
 *  the banned names. `transfer_data[destination]`, `TRANSFER_DATA`,
 *  `subscription_data%5Btransfer_data%5D%5Bamount%5D`, `phases[0][transfer_data]`
 *  and `?on_behalf_of=` all reach the same refusal. */
function checkParams(request, where) {
  const sources = [new URLSearchParams(request.body ?? ''), request.url.searchParams];
  for (const params of sources) {
    for (const key of params.keys()) {
      const segments = key.split(/[\[\].]+/).filter((s) => s.length > 0).map((s) => s.trim().toLowerCase());
      const segment = segments.find((s) => BANNED.has(s));
      if (segment !== undefined) throw new StripeCustodyError('banned_parameter', { ...where, key, segment });
    }
  }
}
