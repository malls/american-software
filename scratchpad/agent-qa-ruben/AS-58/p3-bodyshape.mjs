// P3 — the SAME four out-of-contract body shapes, run on whichever tree this
// container was built from, so the before/after is measured not assumed.
import { guardRequest, StripeCustodyError } from './lib/stripe/custody.js';

const req = (body) => ({
  method: 'POST',
  url: new URL('/v1/invoices', 'https://api.stripe.com'),
  headers: { 'stripe-account': 'acct_123' },
  body,
  meta: { platform: false },
});

const cases = [
  ['record object', { transfer_data: 'x' }],
  ['array of pairs', [['transfer_data', 'x']]],
  ['URLSearchParams', new URLSearchParams('transfer_data=x')],
  ['Buffer', Buffer.from('transfer_data=x')],
  ['string (the contract)', 'transfer_data=x'],
];

for (const [label, body] of cases) {
  try {
    guardRequest(req(body));
    console.log(`P3 PASSED-THROUGH  ${label}`);
  } catch (err) {
    if (err instanceof StripeCustodyError) console.log(`P3 REFUSED ${err.code} seg=${JSON.stringify(err.detail.segment)}  ${label}`);
    else console.log(`P3 THREW ${err.name}: ${err.message}  ${label}`);
  }
}
