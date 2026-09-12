// P1 — custody guard separator probes, past the criteria list.
import { guardRequest, StripeCustodyError, FORBIDDEN_PARAMS } from './lib/stripe/custody.js';

const VERSION = '2026-08-26.dahlia';
function wire({ method = 'POST', path, account, platform = false, body = null, query = '' }) {
  const url = new URL(path, 'https://api.stripe.com');
  if (query !== '') url.search = query;
  const headers = { accept: 'application/json', 'stripe-version': VERSION };
  if (method === 'POST') headers['content-type'] = 'application/x-www-form-urlencoded';
  if (account !== undefined) headers['stripe-account'] = account;
  return Object.freeze({ method, url, headers: Object.freeze(headers), body: method === 'POST' ? body ?? '' : null, meta: Object.freeze({ platform }) });
}

let n = 0;
function probe(label, req) {
  n += 1;
  try {
    guardRequest(req);
    console.log(`P1.${n} PASSED-THROUGH  ${label}`);
    return { outcome: 'pass' };
  } catch (err) {
    const kind = err instanceof StripeCustodyError ? `REFUSED ${err.code} key=${JSON.stringify(err.detail.key)} seg=${JSON.stringify(err.detail.segment)}` : `THREW ${err.name}: ${err.message}`;
    console.log(`P1.${n} ${kind}  ${label}`);
    return { outcome: err instanceof StripeCustodyError ? 'refused' : 'threw', err };
  }
}

const P = { path: '/v1/invoices', account: 'acct_123' };

console.log('--- separators the guard is claimed to honour ---');
probe('body raw ";"', wire({ ...P, body: 'customer=cus_1;transfer_data[destination]=acct_x' }));
probe('query raw ";"', wire({ method: 'GET', path: '/v1/invoices/in_1', account: 'acct_123', query: 'expand[0]=customer;on_behalf_of=acct_x' }));
probe('query leading ";"', wire({ method: 'GET', path: '/v1/invoices/in_1', account: 'acct_123', query: ';on_behalf_of=acct_x' }));
probe('body leading ";"', wire({ ...P, body: ';transfer_data=1' }));
probe('body double ";;"', wire({ ...P, body: 'a=1;;transfer_data=1' }));
probe('body ";" + percent-encoded key', wire({ ...P, body: 'a=1;subscription_data%5Btransfer_data%5D=1' }));
probe('body ";" + UPPERCASE key', wire({ ...P, body: 'a=1;TRANSFER_DATA=1' }));
probe('body ";" + dotted key', wire({ ...P, body: 'a=1;payment_intent_data.transfer_data=1' }));

console.log('--- encoded ";" must stay a VALUE (no false refusal) ---');
probe('encoded ";" in a value', wire({ ...P, body: 'customer=cus_1&description=a%3Btransfer_data%5Bdestination%5D%3Dacct_x' }));
probe('encoded ";" in query value', wire({ method: 'GET', path: '/v1/invoices/in_1', account: 'acct_123', query: 'expand%5B0%5D=a%3Bon_behalf_of%3Dx' }));

console.log('--- separators a ";"-tolerant parser family might ALSO honour ---');
probe('body raw "," ', wire({ ...P, body: 'customer=cus_1,transfer_data[destination]=acct_x' }));
probe('body newline', wire({ ...P, body: 'customer=cus_1\ntransfer_data[destination]=acct_x' }));
probe('body raw space', wire({ ...P, body: 'customer=cus_1 transfer_data[destination]=acct_x' }));

console.log('--- body shapes outside the documented contract ---');
probe('body as an OBJECT (pre-AS-58 this was parsed as a record)', { method: 'POST', url: new URL('/v1/invoices', 'https://api.stripe.com'), headers: { 'stripe-account': 'acct_123' }, body: { transfer_data: 'x' }, meta: { platform: false } });
probe('body as an ARRAY of pairs', { method: 'POST', url: new URL('/v1/invoices', 'https://api.stripe.com'), headers: { 'stripe-account': 'acct_123' }, body: [['transfer_data', 'x']], meta: { platform: false } });
probe('body as a URLSearchParams', { method: 'POST', url: new URL('/v1/invoices', 'https://api.stripe.com'), headers: { 'stripe-account': 'acct_123' }, body: new URLSearchParams('transfer_data=x'), meta: { platform: false } });
probe('body as a Buffer', { method: 'POST', url: new URL('/v1/invoices', 'https://api.stripe.com'), headers: { 'stripe-account': 'acct_123' }, body: Buffer.from('transfer_data=x'), meta: { platform: false } });

console.log('--- allowed name after ";" still passes ---');
probe('benign after ";"', wire({ ...P, body: 'customer=cus_1;collection_method=send_invoice' }));

console.log('--- regex /g statefulness: same input twice, then alternating ---');
const a = wire({ ...P, body: 'a=1;transfer_data=1' });
const b = wire({ ...P, body: 'b=2;on_behalf_of=1' });
for (let i = 0; i < 3; i += 1) { probe(`repeat ${i} A`, a); probe(`repeat ${i} B`, b); }

console.log(`[P1] ${n} probes driven; banned names in the table: ${FORBIDDEN_PARAMS.length}`);
