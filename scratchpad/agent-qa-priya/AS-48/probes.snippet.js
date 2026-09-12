
// ===== PRIYA M6 PROBES (appended to a scratch copy; never committed) =====

test('PRIYA-1 POST /invoices/send with ANOTHER freelancer\'s real draft id: 404 text/plain, zero Stripe calls, their row untouched', async () => {
  await withReadApp({}, async ({ post, repos, calls }) => {
    const other = repos.freelancers.create({ email: 'o@example.test', displayName: 'Other' });
    const oc = repos.clients.create(other.id, { name: 'Theirs', email: 'theirs@example.test' });
    const theirs = repos.invoices.createDraft(other.id, { clientId: oc.id, daysUntilDue: 3, lineItems: [{ description: 'x', quantity: 1, unitAmountMinor: 100 }] });
    const res = await post('/invoices/send', { id: theirs.id });
    const body = await res.text();
    console.log('PRIYA-1', res.status, res.headers.get('content-type'), JSON.stringify(body), 'location=', res.headers.get('location'));
    assert.equal(res.status, 404);
    assert.match(res.headers.get('content-type'), /text\/plain/);
    assert.equal(calls.length, 0);
    const after = repos.invoices.getById(other.id, theirs.id);
    assert.equal(after.stripeInvoiceId, null);
    assert.equal(after.sentAt, null);
    assert.equal(occurrences(body, theirs.id), 0, 'id not echoed');
  });
});

test('PRIYA-2 hostile hosted links (quote, javascript:, script tag) render escaped in content and never as an href', async () => {
  await withReadApp({}, async ({ get, mirrored }) => {
    const hosted = 'javascript:alert(1)//"><script>x</script>';
    const pdf = 'https://pay.stripe.com/x"onmouseover="alert(2)';
    let invoice;
    try {
      invoice = mirrored({ ...OPEN_SNAPSHOT, hostedInvoiceUrl: hosted, invoicePdfUrl: pdf });
    } catch (err) {
      console.log('PRIYA-2 repository REFUSED the hostile snapshot:', err.constructor.name, err.message);
      return;
    }
    const res = await get(detailPath(invoice.id));
    const html = await res.text();
    console.log('PRIYA-2 status', res.status, 'state', stateOf(html));
    assert.equal(occurrences(html, '<script>'), 0, 'no raw script tag');
    assert.equal(occurrences(html, 'javascript:alert(1)//&#34;&gt;&lt;script&gt;x&lt;/script&gt;'), 1, 'escaped in content');
    assert.equal((html.match(/href="[^"]*javascript/g) ?? []).length, 0);
    assert.equal((html.match(/onmouseover=/g) ?? []).length, 0, 'the quote is escaped so no attribute is born');
  });
});

test('PRIYA-3 dashboard with a row in every mirror status renders every badge and one View form per row', async () => {
  await withReadApp({}, async ({ get, draft, mirrored }) => {
    draft(100);
    mirrored({ status: 'open', sentAt: null, hostedInvoiceUrl: null, invoicePdfUrl: null, dueAt: null });
    mirrored(OPEN_SNAPSHOT);
    mirrored(PAID_SNAPSHOT);
    mirrored({ ...OPEN_SNAPSHOT, status: 'void' });
    mirrored({ ...OPEN_SNAPSHOT, status: 'uncollectible' });
    const res = await get('/');
    const html = await res.text();
    console.log('PRIYA-3 status', res.status, 'state', stateOf(html));
    assert.equal(res.status, 200);
    assert.equal(stateOf(html), 'S3-DEFAULT-POPULATED');
    for (const label of ['Draft', 'Finalized — not yet sent', 'Sent — awaiting payment', 'Paid', 'Voided', 'Marked uncollectible']) {
      assert.equal(occurrences(html, `>${label}<`), 1, label);
    }
    assert.equal(occurrences(html, 'action="/invoices/view"'), 6);
    assert.equal(occurrences(html, 'action="/contracts/view"'), 0);
    assert.equal(occurrences(html, '<table'), 1, 'invoice table only; no contracts');
  });
});

test('PRIYA-4 redirector edge inputs: uppercase UUID, uuid with trailing NUL, repeated id, id with a query-injection tail', async () => {
  await withReadApp({}, async ({ get }) => {
    const u = randomUUID();
    const cases = [
      ['upper', `/invoices/view?id=${u.toUpperCase()}`],
      ['nul', `/invoices/view?id=${u}%00`],
      ['repeated', `/invoices/view?id=${u}&id=${u}`],
      ['tail', `/invoices/view?id=${u}%3Fx%3D1`],
      ['crlf', `/invoices/view?id=${u}%0d%0aSet-Cookie:%20a=b`],
      ['contract-upper', `/contracts/view?id=${u.toUpperCase()}`],
    ];
    for (const [name, path] of cases) {
      const res = await get(path);
      console.log('PRIYA-4', name, res.status, 'location=', res.headers.get('location'), 'set-cookie=', res.headers.get('set-cookie'));
      assert.equal(res.status, 404, name);
      assert.equal(res.headers.get('location'), null, name);
    }
    const ok = await get(`/invoices/view?id=${u}`);
    assert.equal(ok.status, 303);
    assert.equal(ok.headers.get('location'), `/invoices/${u}`);
  });
});

test('PRIYA-5 ?edit=1 on another freelancer\'s draft is 404, not a redirect to their edit page; ?edit=1 on a finalized-unsent row renders', async () => {
  await withReadApp({}, async ({ get, repos, mirrored }) => {
    const other = repos.freelancers.create({ email: 'o2@example.test', displayName: 'Other2' });
    const oc = repos.clients.create(other.id, { name: 'Theirs2', email: 'theirs2@example.test' });
    const theirs = repos.invoices.createDraft(other.id, { clientId: oc.id, daysUntilDue: 3, lineItems: [{ description: 'x', quantity: 1, unitAmountMinor: 100 }] });
    const res = await get(`${detailPath(theirs.id)}?edit=1`);
    console.log('PRIYA-5 foreign edit', res.status, res.headers.get('location'));
    assert.equal(res.status, 404);
    assert.equal(res.headers.get('location'), null);
    const unsent = mirrored({ status: 'open', sentAt: null, hostedInvoiceUrl: null, invoicePdfUrl: null, dueAt: null });
    const r2 = await get(`${detailPath(unsent.id)}?edit=1`);
    const html = await r2.text();
    console.log('PRIYA-5 unsent edit', r2.status, stateOf(html), 'edit forms:', occurrences(html, 'name="edit"'), 'send forms:', occurrences(html, 'action="/invoices/send"'));
    assert.equal(r2.status, 200);
    assert.equal(stateOf(html), 'S5-DEFAULT-OPEN');
    assert.equal(occurrences(html, 'name="edit"'), 0, 'no Edit control on a finalized row');
    assert.equal(occurrences(html, 'action="/invoices/send"'), 1, 'Send control present (resume)');
  });
});

test('PRIYA-6 POST /invoices/send on a PAID row: what does it do?', async () => {
  await withReadApp({}, async ({ get, post, mirrored, calls }) => {
    const paid = mirrored(PAID_SNAPSHOT);
    const res = await post('/invoices/send', { id: paid.id });
    console.log('PRIYA-6 paid send', res.status, res.headers.get('location'), 'stripe calls', calls.length);
    const follow = await get(res.headers.get('location') ?? detailPath(paid.id));
    const html = await follow.text();
    console.log('PRIYA-6 follow', follow.status, stateOf(html), 'banner-error', occurrences(html, 'banner-error'), 'banner-success', occurrences(html, 'banner-success'));
  });
});

test('PRIYA-7 dashboard is fine when the connected account row is missing AND rows exist (populated + gated)', async () => {
  await withReadApp({ connected: false }, async ({ get, draft }) => {
    draft(250000);
    const res = await get('/');
    const html = await res.text();
    console.log('PRIYA-7', res.status, stateOf(html), 'note', occurrences(html, 'Connect Stripe before invoicing'), 'href new', occurrences(html, 'href="/invoices/new"'));
    assert.equal(res.status, 200);
    assert.equal(stateOf(html), 'S3-DEFAULT-POPULATED');
    assert.equal(occurrences(html, '$2,500.00'), 1);
    assert.equal(occurrences(html, 'href="/invoices/new"'), 0);
    // and the detail page of that draft while unready: Edit yes, Send no, setup note yes
    const id = html.match(/name="id" value="([^"]+)"/)[1];
    const d = await get(detailPath(id));
    const dh = await d.text();
    console.log('PRIYA-7 detail', d.status, stateOf(dh), 'edit', occurrences(dh, 'name="edit"'), 'send', occurrences(dh, 'action="/invoices/send"'), 'setup', occurrences(dh, 'Connect Stripe before sending'));
    assert.equal(occurrences(dh, 'name="edit"'), 1);
    assert.equal(occurrences(dh, 'action="/invoices/send"'), 0);
    assert.equal(occurrences(dh, 'Connect Stripe before sending'), 1);
  });
});

test('PRIYA-8 GET /invoices/view chain terminus for a foreign id: 303 then 404, nothing leaks', async () => {
  await withReadApp({}, async ({ get, repos }) => {
    const other = repos.freelancers.create({ email: 'o3@example.test', displayName: 'Other3' });
    const oc = repos.clients.create(other.id, { name: 'Theirs3', email: 't3@example.test' });
    const theirs = repos.invoices.createDraft(other.id, { clientId: oc.id, daysUntilDue: 3, lineItems: [{ description: 'x', quantity: 1, unitAmountMinor: 100 }] });
    const hop = await get(`/invoices/view?id=${theirs.id}`);
    assert.equal(hop.status, 303);
    const end = await get(hop.headers.get('location'));
    const html = await end.text();
    console.log('PRIYA-8', hop.status, hop.headers.get('location'), '->', end.status, stateOf(html));
    assert.equal(end.status, 404);
    assert.equal(occurrences(html, 'Theirs3'), 0);
  });
});
