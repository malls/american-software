// qa-ruben AS-70 M6 probes — run ALONE in a scratch extract, never committed.
// Every probe prints what it observed; assertions are my own expectations and
// a failure here is a lead, not automatically a defect.
import test from 'node:test';
import assert from 'node:assert/strict';
import { configFor, followToTerminus, seedSignedIn, withServer } from './helpers/server.js';
import { signedInHeaders } from './helpers/auth.js';

const occurrences = (h, n) => h.split(n).length - 1;
const stateOf = (html) => html.match(/data-state="([^"]*)"/)?.[1] ?? null;
const ACCT = 'acct_rubenprobe';
const seed = (repos, freelancerId, r) => {
  repos.connectedAccounts.create({ freelancerId, stripeAccountId: ACCT });
  return repos.connectedAccounts.updateReadiness(ACCT, {
    chargesEnabled: r.chargesEnabled, detailsSubmitted: true, payoutsEnabled: r.payoutsEnabled,
    requirementsCurrentlyDue: r.due, requirementsDisabledReason: null, syncedAt: '2026-09-12T11:00:00.000Z',
  });
};
const get = (base, cookie, q = '') => fetch(`${base}/connect-stripe${q}`, { redirect: 'manual', headers: { cookie } });

test('P-A: ?error= boundary — odd shapes never select ERROR and never echo', async () => {
  await withServer(configFor(), async (base, app, deps) => {
    const { cookie } = seedSignedIn(deps.repos);
    const long = 'A'.repeat(5000);
    const shapes = [
      '?error=start', '?error=START', '?error=Start', '?error=%73tart', '?error=start%00', '?error=start%20',
      '?error=', '?error', '?error[]=start', '?error[start]=1', '?error.x=start', '?error=start&error=start',
      '?error=start&error=nope', '?error=nope&error=start', '?error=%EF%BD%93tart', `?error=${long}`,
      '?ERROR=start', '?%65rror=start', '?error=start#frag', '?error=%22%3E%3Cscript%3E',
    ];
    const results = [];
    for (const q of shapes) {
      const res = await get(base, cookie, q);
      const html = await res.text();
      results.push([q.length > 40 ? q.slice(0, 20) + `…(${q.length})` : q, res.status, stateOf(html), occurrences(html, 'AAAA'), occurrences(html, '<script')]);
    }
    console.log(results.map((r) => r.join(' | ')).join('\n'));
    // Expectation: exactly '?error=start' and '?error=%73tart' (percent-decodes to 'start') select ERROR; '?error=start#frag' too (fragment never sent).
    const errorOnes = results.filter((r) => r[2] === 'S2-ERROR-SYSTEM').map((r) => r[0]);
    console.log('ERROR-selecting shapes:', JSON.stringify(errorOnes));
    for (const r of results) { assert.equal(r[1], 200); assert.equal(r[3], 0, 'long value echoed'); assert.equal(r[4], 0, 'script echoed'); }
  });
});

test('P-B: payouts_enabled false, charges true, due [] is READY (ready ignores payouts, AS-41)', async () => {
  await withServer(configFor(), async (base, app, deps) => {
    const { cookie, freelancer } = seedSignedIn(deps.repos);
    const row = seed(deps.repos, freelancer.id, { chargesEnabled: true, payoutsEnabled: false, due: [] });
    console.log('row.ready =', row.ready, 'payoutsEnabled =', row.payoutsEnabled);
    const html = await (await get(base, cookie)).text();
    console.log('state =', stateOf(html));
    assert.equal(stateOf(html), 'S2-RETURN-READY');
    // And ERROR outranks a READY row over HTTP (case 7 only proves this via a set, not per body).
    assert.equal(stateOf(await (await get(base, cookie, '?error=start')).text()), 'S2-ERROR-SYSTEM');
  });
});

test('P-C: redirect chains to their terminus — GET / signed in, POST /signout, GET / cookieless', async () => {
  await withServer(configFor(), async (base, app, deps) => {
    const { cookie } = seedSignedIn(deps.repos);
    const root = await followToTerminus(base, await fetch(`${base}/`, { redirect: 'manual', headers: { cookie } }), { cookie });
    console.log('GET / signed-in chain:', root.chain, '->', root.status, root.path, stateOf(root.body));
    assert.equal(root.status, 200); assert.equal(root.path, '/connect-stripe');
    const out = await fetch(`${base}/signout`, { method: 'POST', redirect: 'manual', headers: signedInHeaders(base, cookie) });
    console.log('POST /signout:', out.status, out.headers.get('location'), 'set-cookie:', out.headers.getSetCookie());
    const outEnd = await followToTerminus(base, out, {});
    console.log('POST /signout chain:', outEnd.chain, '->', outEnd.status, outEnd.path, stateOf(outEnd.body));
    assert.equal(outEnd.status, 200);
    // After signout, the old cookie must be refused on /connect-stripe.
    const stale = await get(base, cookie);
    console.log('stale cookie on /connect-stripe:', stale.status, stale.headers.get('location'));
    assert.equal(stale.status, 303);
    const anon = await followToTerminus(base, await fetch(`${base}/`, { redirect: 'manual' }), {});
    console.log('GET / cookieless chain:', anon.chain, '->', anon.status, anon.path, stateOf(anon.body));
  });
});

test('P-D: response headers on the screen, and other methods on the path', async () => {
  await withServer(configFor(), async (base, app, deps) => {
    const { cookie } = seedSignedIn(deps.repos);
    const res = await get(base, cookie);
    console.log('headers:', JSON.stringify(Object.fromEntries(res.headers.entries())));
    const head = await fetch(`${base}/connect-stripe`, { method: 'HEAD', redirect: 'manual', headers: { cookie } });
    console.log('HEAD:', head.status, head.headers.get('content-type'));
    const post = await fetch(`${base}/connect-stripe`, { method: 'POST', redirect: 'manual', headers: signedInHeaders(base, cookie) });
    console.log('POST /connect-stripe:', post.status, (await post.text()).slice(0, 80));
    const trailing = await fetch(`${base}/connect-stripe/`, { redirect: 'manual', headers: { cookie } });
    console.log('GET /connect-stripe/ (trailing slash):', trailing.status, stateOf(await trailing.text()));
    const upper = await fetch(`${base}/Connect-Stripe`, { redirect: 'manual', headers: { cookie } });
    console.log('GET /Connect-Stripe:', upper.status, stateOf(await upper.text()));
  });
});

test('P-E: every rendered body escapes and carries no interpolated attribute; body byte sizes', async () => {
  await withServer(configFor(), async (base, app, deps) => {
    const { cookie, freelancer } = seedSignedIn(deps.repos);
    const bodies = [];
    bodies.push(await (await get(base, cookie)).text());
    bodies.push(await (await get(base, cookie, '?error=start')).text());
    seed(deps.repos, freelancer.id, { chargesEnabled: false, payoutsEnabled: false, due: ['external_account'] });
    bodies.push(await (await get(base, cookie)).text());
    deps.repos.connectedAccounts.updateReadiness(ACCT, { chargesEnabled: true, detailsSubmitted: true, payoutsEnabled: true, requirementsCurrentlyDue: [], requirementsDisabledReason: null, syncedAt: '2026-09-12T11:00:00.000Z' });
    bodies.push(await (await get(base, cookie)).text());
    for (const html of bodies) {
      console.log(stateOf(html), html.length, 'bytes; forms:', occurrences(html, '<form'), 'anchors:', occurrences(html, '<a '), 'banners:', occurrences(html, 'class="banner'), 'h1:', occurrences(html, '<h1'), "raw apostrophes:", occurrences(html, "'"));
      assert.equal(occurrences(html, '<%'), 0);
      assert.equal(occurrences(html, 'acct_'), 0);
    }
  });
});
