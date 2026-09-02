// transport.js — the product's ONE outbound HTTP call (AS-38, plan §2.3 step 6).
//
// Everything that leaves this process for Stripe goes through send() below, on
// the one line the dependency policy sanctions (test/dependency-policy.test.js,
// SANCTIONED). A second `fetch` token anywhere in product source is a second
// HTTP client and a red test. Only lib/stripe/client.js may import this file;
// that import is itself a guarded construct.
//
// What this file does NOT do, on purpose: retry (plan §8 Q2 — a retry without an
// idempotency key is a duplicate invoice; AS-43 decides), follow redirects (a
// redirect would carry the key to another host), or read any configuration.
// It has no imports and knows nothing about Stripe: it moves bytes.

/**
 * Send a signed request and return the raw response.
 *
 * @param {{ method: string, url: URL, headers: object, body: string | null }} request
 * @param {{ timeoutMs: number }} options
 * @returns {Promise<{ status: number, headers: object, body: string }>}
 *   `headers` is a plain object with lower-case names; `body` is the response
 *   text, unparsed (the client interprets it).
 * @throws {Error} with `code` ∈ {`network`, `timeout`, `redirect`} and `cause`
 *   set to the underlying error. The client wraps it in StripeTransportError;
 *   it is a plain Error here so this file imports nothing.
 */
export async function fetchTransport(request, { timeoutMs }) {
  return send(request, timeoutMs).catch((err) => {
    throw classify(err);
  });
}

// Top-level, so the sanctioned line sits at exactly two spaces of indent — the
// dependency policy pins it byte-for-byte, and the falsification recipe (plan
// §6 M6) rewrites it with a one-line perl.
async function send(request, timeoutMs) {
  const init = {
    method: request.method,
    headers: request.headers,
    body: request.body ?? undefined,
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  };
  const response = await fetch(request.url, init);
  const body = await response.text();
  return { status: response.status, headers: Object.fromEntries(response.headers), body };
}

/** Map the runtime's failure shapes onto the three codes the client knows. */
function classify(err) {
  let code = 'network';
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') code = 'timeout';
  else if (/redirect/i.test(err?.cause?.message ?? '')) code = 'redirect';
  const wrapped = new Error(`transport ${code}: ${err?.cause?.message ?? err?.message ?? String(err)}`, { cause: err });
  wrapped.code = code;
  return wrapped;
}
