// AS-50 diagnostic (developer-marcus): replay the app's exact first Connect call
// from the host — POST /v1/accounts, empty body, Stripe-Version pinned — to
// learn WHY the container's call answered 502 (the app renders a constant
// screen and logs nothing). The key is read into memory only; the output is
// status + error type/code/message with any key-shaped token redacted.
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(readFileSync('/Users/forrest/Code/american-software-company/apps/invoicing/.env.local', 'utf8')
  .split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const key = env.INVOICING_STRIPE_SECRET_KEY;
const redact = (s) => String(s).replace(/(sk|pk|rk)_(test|live)_[A-Za-z0-9]+/g, '$1_$2_[redacted]').replace(/whsec_[A-Za-z0-9]+/g, 'whsec_[redacted]');

const mode = process.argv[2] ?? 'account';
const req = mode === 'create'
  ? { method: 'POST', path: '/v1/accounts', body: '', extra: { 'idempotency-key': `acct-create-diag-${Date.now()}` } }
  : { method: 'GET', path: '/v1/account', body: undefined, extra: {} };
const res = await fetch(`https://api.stripe.com${req.path}`, {
  method: req.method,
  headers: { authorization: `Bearer ${key}`, 'stripe-version': '2026-08-26.dahlia', accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', ...req.extra },
  body: req.body,
});
const json = await res.json();
if (mode === 'create') {
  console.log(redact(JSON.stringify({ status: res.status, requestId: res.headers.get('request-id'), id: json.id ?? null, controller: json.controller ?? null, error: json.error ?? null }, null, 2)));
} else {
  console.log(redact(JSON.stringify({ status: res.status, id: json.id ?? null, country: json.country ?? null, charges_enabled: json.charges_enabled, details_submitted: json.details_submitted, error: json.error ?? null }, null, 2)));
}
