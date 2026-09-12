// test/contract-screens.test.js — screens 6 and 7: contract create, and
// contract detail with print and download (AS-47, plan §7).
//
// A NEW FILE, deliberately: never an addition to screens.test.js (AS-70's) or
// auth.test.js (at the 1,200-line ceiling). Screen 7's cases (20–29) are the
// first unit; screen 6's (1–19) follow in the same file (plan §6).
//
// EVERYTHING HERE RUNS OFFLINE. Contracts have no Stripe dimension; the two
// system states are reached by FAULT INJECTION on the test's own private
// database file through openDatabase (the db.test.js idiom) — the injection is
// the instrument, and the 'raw SQL' concept row does not see test/ (the
// dependency scan skips it), so this is not a hole and is not to be "cleaned
// up" into an app-level seam (plan §3.8).
//
// CARDINALITY BEFORE QUANTIFICATION, everywhere: every count is committed
// before anything is quantified over it, and every "escaped once" claim is an
// OCCURRENCE count on the served bytes, never a boolean includes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDatabase } from '../lib/db/connection.js';
import { VIEWS } from '../lib/views.js';
import { DEFAULT_TEMPLATE_ID, getTemplate } from '../lib/contracts/templates.js';
import { renderContract } from '../lib/contracts/render.js';
import { createContractGeneration } from '../lib/contracts/generation.js';
import {
  CONTRACT_DETAIL_LEDGER,
  CONTRACT_DETAIL_STATES,
  contractDetailLocals,
} from '../lib/screens/contract-detail-view.js';
import { configFor, followToTerminus, seedSignedIn, signedInHeaders, withServer } from './helpers/server.js';

/** OCCURRENCE counting, never a boolean `includes` (the screens.test.js rule). */
const occurrences = (haystack, needle) => haystack.split(needle).length - 1;

/** The one `data-state` the page carries, or null when none rendered. */
function stateOf(html) {
  const match = html.match(/data-state="([^"]*)"/);
  return match === null ? null : match[1];
}

/** Every value reachable from a locals object. */
const leaves = (value) => (value !== null && typeof value === 'object' ? Object.values(value).flatMap(leaves) : [value]);

const DESCRIPTION = 'Website redesign — phase 1: homepage and navigation.';
const START_DATE = '2026-09-08';

/** A signed-in freelancer with one client, on a fresh app. `generate` goes
 *  through the REAL generation service on the app's own repositories — the
 *  same path POST /contracts and screen 6 both call. */
async function withScreenApp(fn) {
  const config = configFor();
  await withServer(config, async (base, app, deps) => {
    const { repos } = deps;
    const { freelancer, cookie } = seedSignedIn(repos, { email: 'f@example.test', displayName: 'Freda Lancer' });
    const client = repos.clients.create(freelancer.id, { name: 'Ada Example', email: 'ada@example.test' });
    const headers = signedInHeaders(base, cookie);
    const generation = createContractGeneration({ repos });
    const generate = (formValues = { projectDescription: DESCRIPTION, startDate: START_DATE }) =>
      generation.generate(freelancer.id, { clientId: client.id, templateId: DEFAULT_TEMPLATE_ID, formValues });
    const get = (path, extra = {}) => fetch(`${base}${path}`, { redirect: 'manual', headers: { ...headers, ...extra } });
    await fn({ base, app, config, repos, freelancer, client, headers, cookie, generate, get });
  });
}

// =============================================================================
// Screen 7 — the document
// =============================================================================

/** docs/design/wireframes/02-states-ledger.md §7, all eight rows, in the
 *  document's own order. Transcribed BY HAND and INDEPENDENTLY of
 *  lib/screens/contract-detail-view.js's copy; the two are compared against
 *  each other (drift detection between two transcriptions, not a read of the
 *  design document — see the view model's header). */
const SCREEN_7_LEDGER = [
  ['S7-DEFAULT', 'rendered'],
  ['S7-LOADING', 'unrenderable — browser-supplied'],
  ['S7-EMPTY', 'n/a'],
  ['S7-ERROR-NOTFOUND', 'rendered'],
  ['S7-ERROR-SYSTEM', 'rendered'],
  ['S7-DENIED-SIGNEDOUT', 'redirect-answered'],
  ['S7-DENIED-NOTOWNER', 'rendered as S7-ERROR-NOTFOUND'],
  ['S7-ABANDON', 'n/a'],
];

test('screen 7 accounts for all eight of its ledger rows: 3 + 1 + 1 + 1 + 2 = 8', () => {
  assert.equal(SCREEN_7_LEDGER.length, 8, 'the ledger table transcribed here has eight rows');
  assert.equal(CONTRACT_DETAIL_LEDGER.length, 8, `the view model accounts for ${CONTRACT_DETAIL_LEDGER.length} rows, expected 8`);
  const declared = CONTRACT_DETAIL_LEDGER.map((row) => [row.id, row.disposition]).sort();
  assert.deepEqual(declared, [...SCREEN_7_LEDGER].sort());

  // The partition, as arithmetic against a committed table (plan §3.7).
  const partition = {};
  for (const row of CONTRACT_DETAIL_LEDGER) partition[row.disposition] = (partition[row.disposition] ?? 0) + 1;
  assert.deepEqual(partition, {
    rendered: 3,
    'rendered as S7-ERROR-NOTFOUND': 1,
    'redirect-answered': 1,
    'unrenderable — browser-supplied': 1,
    'n/a': 2,
  });
  assert.equal(3 + 1 + 1 + 1 + 2, 8);
  assert.equal(Object.values(partition).reduce((a, b) => a + b, 0), CONTRACT_DETAIL_LEDGER.length);

  assert.equal(CONTRACT_DETAIL_STATES.length, 3, `${CONTRACT_DETAIL_STATES.length} rendered states, expected 3`);
  assert.deepEqual([...CONTRACT_DETAIL_STATES].sort(), ['S7-DEFAULT', 'S7-ERROR-NOTFOUND', 'S7-ERROR-SYSTEM']);
  const na = CONTRACT_DETAIL_LEDGER.filter((row) => row.disposition === 'n/a').map((row) => row.id);
  assert.deepEqual(na, ['S7-EMPTY', 'S7-ABANDON'], 'the n/a bucket is exactly the two the ledger states');
  assert.equal(CONTRACT_DETAIL_LEDGER.find((row) => row.id === 'S7-DENIED-NOTOWNER').disposition.includes('S7-ERROR-NOTFOUND'), true);
  assert.ok(Object.isFrozen(CONTRACT_DETAIL_STATES) && Object.isFrozen(CONTRACT_DETAIL_LEDGER), 'both lists are frozen');

  // AND THE TABLE IS NOT DECORATIVE: each rendered state owns exactly one
  // DISTINCTIVE MARKER in the template source (plan §3.6). The template
  // branches on booleans, not state ids, so the marker is the branch only that
  // state produces.
  const source = readFileSync(join(configFor().viewsDir, 'contract-detail.ejs'), 'utf8');
  const markers = [
    ['S7-DEFAULT', '<%- renderedHtml %>'],
    ['S7-ERROR-NOTFOUND', 'if (isNotFound)'],
    ['S7-ERROR-SYSTEM', 'if (isSystem)'],
  ];
  assert.equal(markers.length, 3, 'cardinality first: one marker row per rendered state');
  assert.deepEqual(markers.map(([state]) => state).sort(), [...CONTRACT_DETAIL_STATES].sort());
  for (const [state, marker] of markers) {
    assert.equal(occurrences(source, marker), 1, `${state}'s distinctive marker "${marker}" occurs ${occurrences(source, marker)} time(s) in the template, expected exactly 1`);
  }

  // THE ONE RAW-OUTPUT LINE: exactly once in the source, and it is the WHOLE
  // line — the shape the RAW_OUTPUT_SANCTIONED entry pins (plan §3.3).
  const rawLines = source.split('\n').filter((line) => line.includes('<%-'));
  assert.equal(rawLines.length, 1, `the raw-output tag appears on ${rawLines.length} line(s), expected exactly 1`);
  assert.match(rawLines[0], /^\s*<%- renderedHtml %>$/, 'the raw-output line carries nothing but the document');

  // The view model is total over (contract, failure, isDownload) and the flag
  // is a boolean that only S7-DEFAULT honours (plan §3.3).
  const row = { id: 'row-1', variables: { clientName: 'Ada Example' }, renderedHtml: '<article class="contract-doc"></article>' };
  const cells = [
    [{ contract: row }, 'S7-DEFAULT', false],
    [{ contract: row, isDownload: true }, 'S7-DEFAULT', true],
    [{ contract: row, isDownload: '1' }, 'S7-DEFAULT', false],
    [{ contract: row, isDownload: ['1'] }, 'S7-DEFAULT', false],
    [{ contract: null, failure: 'not-found', isDownload: true }, 'S7-ERROR-NOTFOUND', false],
    [{ contract: null, failure: 'system', isDownload: true }, 'S7-ERROR-SYSTEM', false],
    [{ contract: row, failure: 'system' }, 'S7-ERROR-SYSTEM', false],
    [{}, 'S7-ERROR-NOTFOUND', false],
  ];
  assert.equal(cells.length, 8, 'cardinality first: the committed cell count');
  for (const [input, state, isDownload] of cells) {
    const locals = contractDetailLocals(input);
    assert.equal(locals.state, state, JSON.stringify(input));
    assert.equal(locals.isDownload, isDownload, `isDownload for ${JSON.stringify(input)}`);
    assert.ok(CONTRACT_DETAIL_STATES.includes(locals.state));
    assert.equal(leaves(locals).filter((leaf) => leaf === 'row-1').length, 0, 'no local equals the row id');
  }
  assert.equal(contractDetailLocals({ contract: row }).title, 'Contract with Ada Example');
  assert.equal(VIEWS.find((v) => v.file === 'contract-detail.ejs').sampleLocals.state, 'S7-ERROR-NOTFOUND', 'the VIEWS probe renders the no-row default');
});

test('S7-DEFAULT embeds the stored document byte-for-byte inside the document region, with the notice first and the attribution last', async () => {
  await withScreenApp(async ({ get, generate, client }) => {
    const contract = generate();
    const template = getTemplate(contract.templateId);
    const res = await get(`/contracts/${contract.id}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.equal(res.headers.get('content-disposition'), null, 'the page is not an attachment');
    const html = await res.text();
    assert.equal(stateOf(html), 'S7-DEFAULT');
    assert.equal(occurrences(html, contract.renderedHtml), 1, 'the stored document is embedded exactly once, byte for byte');
    assert.equal(occurrences(html, '<article class="contract-doc">'), 1);
    assert.equal(occurrences(html, template.notice.title), 1, 'the placeholder notice title');
    assert.equal(occurrences(html, '[PLACEHOLDER'), 3, 'the three placeholder markers');
    assert.equal(occurrences(html, template.attribution), 1, 'the attribution line');
    // Notice first, attribution last, INSIDE the document region.
    const region = html.indexOf('<div class="doc-region">');
    assert.ok(region > 0, 'the document region exists');
    assert.ok(html.indexOf('contract-doc__notice') > region, 'the notice is inside the region');
    assert.ok(html.indexOf('contract-doc__notice') < html.indexOf('contract-doc__title'), 'notice before title');
    assert.ok(html.lastIndexOf('contract-doc__attribution') > html.lastIndexOf('contract-doc__body'), 'attribution after body');
    assert.equal(occurrences(html, `Contract with ${client.name}`), 2, 'the title, in <title> and <h1>');
    // The Download form: a GET of the page's own URL carrying one constant.
    assert.equal(occurrences(html, '<form method="get">'), 1, 'exactly one action-less GET form');
    assert.equal(occurrences(html, '<input type="hidden" name="download" value="1" />'), 1);
    assert.equal(occurrences(html, '>Download</button>'), 1);
    // EJS escapes the apostrophe: the served bytes carry &#39;, and that is
    // what is counted (P4's own measurement — apostrophes in element content).
    assert.equal(occurrences(html, 'use your browser&#39;s Print command.'), 1, 'the print sentence');
    // The page renders the document, not the row.
    assert.equal(occurrences(html, contract.id), 0, 'the row id appears nowhere in the body');
    assert.equal(occurrences(html, 'stripeAccountId'), 0);
    assert.equal(occurrences(html, 'acct_'), 0);
    // The nav.
    assert.equal(occurrences(html, '<nav class="site-nav"'), 1);
    assert.equal(occurrences(html, 'href="/invoices/new"'), 1);
    // No link to a route this branch does not serve: the "New contract" entry
    // lands with /contracts/new itself (AS-127), never ahead of it.
    assert.equal(occurrences(html, 'href="/contracts/new"'), 0, 'no nav link to /contracts/new until AS-127 serves it');
    assert.equal(occurrences(html, '<form class="site-nav__signout" method="post" action="/signout">'), 1);
  });
});

test('markup in a stored description reaches the page escaped exactly once and raw zero times', async () => {
  // The dynamic half of the sanctioned raw-output line (plan §3.3): the
  // safety argument is render.js's escaper, and this is what makes it a
  // MEASURED claim on the served bytes rather than a cited one.
  await withScreenApp(async ({ get, generate }) => {
    const contract = generate({ projectDescription: 'Scope: <b>ASC47</b> & more', startDate: START_DATE });
    const res = await get(`/contracts/${contract.id}`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.equal(stateOf(html), 'S7-DEFAULT');
    assert.equal(occurrences(html, '&lt;b&gt;ASC47&lt;/b&gt;'), 1, 'the escaped form, exactly once');
    assert.equal(occurrences(html, '<b>ASC47</b>'), 0, 'the raw form, zero times');
    assert.equal(occurrences(html, '&amp;lt;'), 0, 'not double-escaped — the document is emitted raw, once');
  });
});

test('?download=1 answers the same document as an attachment named for the row, chrome-free and phoning nobody; any other value is the page', async () => {
  await withScreenApp(async ({ get, generate }) => {
    const contract = generate();
    const res = await get(`/contracts/${contract.id}?download=1`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(res.headers.get('content-disposition'), `attachment; filename="contract-${contract.id}.html"`);
    const body = await res.text();
    assert.equal(stateOf(body), 'S7-DEFAULT', 'the variant stamps the state it is a rendering of');
    assert.equal(occurrences(body, contract.renderedHtml), 1, 'the same document, byte for byte');
    assert.equal(occurrences(body, '<nav'), 0, 'no nav');
    assert.equal(occurrences(body, '<form'), 0, 'no form');
    assert.equal(occurrences(body, '<header'), 0, 'no header');
    assert.equal(occurrences(body, 'page-title'), 0, 'no page heading');
    assert.equal(occurrences(body, 'doc-actions'), 0, 'no actions');
    assert.equal(occurrences(body, '://'), 0, 'zero absolute URLs — opened from disk the file phones nobody');
    assert.equal(occurrences(body, '<div class="doc-region">'), 1);

    // Any other spelling is the page: the flag is a presence flag read as a
    // boolean, and the value never reaches the body.
    for (const query of ['?download=ASC47MARK', '?download[]=1', '?download=true', '?download=']) {
      const page = await get(`/contracts/${contract.id}${query}`);
      assert.equal(page.status, 200, query);
      assert.equal(page.headers.get('content-disposition'), null, `${query}: not an attachment`);
      const html = await page.text();
      assert.equal(stateOf(html), 'S7-DEFAULT');
      assert.equal(occurrences(html, '<nav class="site-nav"'), 1, `${query}: the full page`);
      assert.equal(occurrences(html, 'ASC47MARK'), 0, `${query}: the value has no path into the body`);
    }

    // A download of a contract that does not exist is the inline not-found
    // page — never an attachment named for a row that is not there.
    const missing = await get('/contracts/00000000-0000-4000-8000-000000000000?download=1');
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get('content-disposition'), null);
    assert.match(missing.headers.get('content-type'), /text\/html/);
    assert.equal(stateOf(await missing.text()), 'S7-ERROR-NOTFOUND');
  });
});

test('S7-ERROR-NOTFOUND and S7-DENIED-NOTOWNER: an unknown id and another freelancer\'s id are answered identically, as HTML, at 404', async () => {
  await withScreenApp(async ({ get, repos, generate }) => {
    // Another freelancer's contract — its id is real, and not ours.
    const other = repos.freelancers.create({ email: 'other@example.test', displayName: 'Someone Else' });
    const otherClient = repos.clients.create(other.id, { name: 'Their Client', email: 'their@example.test' });
    const theirs = createContractGeneration({ repos }).generate(other.id, {
      clientId: otherClient.id,
      templateId: DEFAULT_TEMPLATE_ID,
      formValues: { projectDescription: 'Theirs, not ours — ASC47SECRET', startDate: START_DATE },
    });
    generate(); // ours exists too, so "no contracts at all" is not what 404s
    const unknown = await get('/contracts/00000000-0000-4000-8000-000000000000');
    const notOwner = await get(`/contracts/${theirs.id}`);
    const bodies = [];
    for (const [label, res] of [['unknown', unknown], ['not-owner', notOwner]]) {
      assert.equal(res.status, 404, label);
      assert.match(res.headers.get('content-type'), /text\/html/, label);
      const html = await res.text();
      assert.equal(stateOf(html), 'S7-ERROR-NOTFOUND', label);
      assert.equal(occurrences(html, 'contract-doc'), 0, `${label}: no document`);
      assert.equal(occurrences(html, 'We couldn&#39;t find that contract.'), 1, `${label}: the wireframe's sentence (apostrophe EJS-escaped)`);
      assert.equal(occurrences(html, 'Contract not found'), 2, `${label}: the title, in <title> and <h1>`);
      // AS-48 landed screen 3: the nav's Dashboard anchor and NOTFOUND's
      // "Back to Dashboard" line (the wireframe's), both constant hrefs to `/`.
      assert.equal(occurrences(html, 'Dashboard'), 2, `${label}: the nav anchor and Back to Dashboard (AS-48)`);
      assert.equal(occurrences(html, '<a href="/">Back to Dashboard</a>'), 1, `${label}: the wireframe's line, once`);
      assert.equal(occurrences(html, 'ASC47SECRET'), 0, `${label}: nothing of the other freelancer's document`);
      assert.equal(occurrences(html, '>Retry</button>'), 0, `${label}: not-found has no retry`);
      bodies.push(html);
    }
    assert.equal(bodies[0], bodies[1], 'byte-identical bodies: a guessed id confirms nothing');

    // The way out is followed to its terminus (AS-47's hand-off to AS-48): the
    // Back to Dashboard href is `/`, and `/` is a screen now, not a redirect.
    const home = await get('/');
    assert.equal(home.status, 200, 'Back to Dashboard lands on a rendered page');
    assert.match(stateOf(await home.text()), /^S3-/, 'the Dashboard, in one of its own states');
  });
});

test('S7-ERROR-SYSTEM: a stored row that cannot be read renders the system state at 500 with a retry that is a GET of the same page', async () => {
  await withScreenApp(async ({ get, generate, config }) => {
    const contract = generate();
    // THE INJECTION IS THE INSTRUMENT (plan §3.8). The plan named a `variables`
    // column that is not JSON; the schema REFUSES that (0001-initial.js:
    // `CHECK (json_valid(variables))` — measured here, not assumed: the UPDATE
    // throws `CHECK constraint failed`), which is a stronger guarantee than the
    // plan credited it with. So the row is made unreadable the way the same
    // plan reaches S6-ERROR-SYSTEM: the table is dropped after the row exists,
    // and the read throws something that is not a NotFoundError — "fetch fails
    // for a reason other than nonexistence". Nothing references contracts, so
    // the drop is clean; getById prepares its statement at call time.
    const db = openDatabase(config.dbPath);
    try {
      assert.throws(() => db.prepare('UPDATE contracts SET variables = ? WHERE id = ?').run('ASC47-NOT-JSON{', contract.id), /CHECK constraint failed: json_valid/);
      db.exec('DROP TABLE contracts');
    } finally {
      db.close();
    }
    const res = await get(`/contracts/${contract.id}`);
    assert.equal(res.status, 500);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.equal(res.headers.get('content-disposition'), null);
    const html = await res.text();
    assert.equal(stateOf(html), 'S7-ERROR-SYSTEM');
    assert.equal(occurrences(html, 'Something went wrong loading this contract.'), 1);
    assert.equal(occurrences(html, 'Couldn&#39;t load this contract'), 2, 'the title, in <title> and <h1> (apostrophe EJS-escaped)');
    assert.equal(occurrences(html, '<form method="get">'), 1, 'the retry: an action-less GET of the page');
    assert.equal(occurrences(html, ' action="/contracts'), 0);
    assert.equal(occurrences(html, '>Retry</button>'), 1);
    assert.equal(occurrences(html, 'contract-doc'), 0, 'no document');
    assert.equal(occurrences(html, 'no such table'), 0, 'the driver message reaches nothing');
    assert.equal(occurrences(html, 'name="download"'), 0, 'no download control on a failed read');
    // The download flag on a failed read is ignored: no attachment for a row
    // that could not be read.
    const dl = await get(`/contracts/${contract.id}?download=1`);
    assert.equal(dl.status, 500);
    assert.equal(dl.headers.get('content-disposition'), null);
  });
});

test('S7-DENIED-SIGNEDOUT: a cookieless GET /contracts/<id> is answered by the guard and lands on screen 1 carrying next', async () => {
  await withScreenApp(async ({ base, generate }) => {
    const contract = generate();
    const res = await fetch(`${base}/contracts/${contract.id}`, { redirect: 'manual' });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), `/signin?next=${encodeURIComponent(`/contracts/${contract.id}`)}`);
    assert.equal(res.headers.getSetCookie().length, 0, 'the guard sets no cookie');
    const landing = await followToTerminus(base, res);
    assert.equal(landing.hops, 1);
    assert.equal(landing.status, 200);
    assert.equal(stateOf(landing.body), 'S1-DEFAULT-SIGNIN');
    // Twice: the sign-in form and the mode-switch form both carry it (AS-45).
    assert.equal(occurrences(landing.body, `<input type="hidden" name="next" value="/contracts/${contract.id}" />`), 2, 'screen 1 carries next in its hidden inputs');
    assert.equal(occurrences(landing.body, 'contract-doc'), 0);
  });
});

test('S7-EMPTY and S7-ABANDON are n/a and S7-LOADING is browser-supplied: a read creates no state and renders no collection', async () => {
  await withScreenApp(async ({ get, generate, repos, freelancer }) => {
    const contract = generate();
    const before = repos.contracts.listByFreelancer(freelancer.id).length;
    const first = await (await get(`/contracts/${contract.id}`)).text();
    const second = await (await get(`/contracts/${contract.id}`)).text();
    assert.equal(first, second, 'two successive reads are byte-identical — a read creates no state');
    assert.equal(repos.contracts.listByFreelancer(freelancer.id).length, before, 'and no row');
    for (const tag of ['table', 'ul', 'ol', 'li']) {
      const found = first.match(new RegExp(`<${tag}[\\s>]`, 'g')) ?? [];
      assert.deepEqual(found, [], `S7-DEFAULT renders no <${tag}> — it has no collection`);
    }
    const dispositions = Object.fromEntries(CONTRACT_DETAIL_LEDGER.map((row) => [row.id, row.disposition]));
    assert.equal(dispositions['S7-EMPTY'], 'n/a');
    assert.equal(dispositions['S7-ABANDON'], 'n/a');
    assert.equal(dispositions['S7-LOADING'], 'unrenderable — browser-supplied');
  });
});

/** Every href and form action in a template's SOURCE. A stylesheet link is a
 *  GET like any other; a form with no action posts to the page's own URL and
 *  is not a link to examine. */
function templateLinks(file) {
  const source = readFileSync(join(configFor().viewsDir, file), 'utf8').replace(/<%#[\s\S]*?%>/g, '');
  const links = [];
  for (const m of source.matchAll(/<(a|link|form)\b([^>]*)>/g)) {
    const attrs = m[2];
    const href = attrs.match(/\bhref="([^"]*)"/);
    const action = attrs.match(/\baction="([^"]*)"/);
    const method = attrs.match(/\bmethod="([^"]*)"/);
    if (m[1] === 'form') {
      if (action !== null) links.push({ file, method: (method?.[1] ?? 'get').toUpperCase(), path: action[1] });
    } else if (href !== null) {
      links.push({ file, method: 'GET', path: href[1] });
    }
  }
  return links;
}

test('every href and form action in the two contract templates names a route the app registers', async () => {
  // The AS-46 case-25 instrument applied from this side of the seam: every
  // link is DRIVEN at the built app with a session, and a 404 is a finding.
  // Red on /invoices/new while AS-46 is not in this branch's history — the
  // merge-order ruling (plan §10) made mechanical.
  const links = templateLinks('contract-detail.ejs');
  // 4 at AS-47's merge; 6 once AS-48 landed the nav's Dashboard anchor and
  // NOTFOUND's Back to Dashboard — both `GET /`, both driven below.
  assert.equal(links.length, 6, `cardinality first: ${links.length} links examined in contract-detail.ejs (${links.map((l) => `${l.method} ${l.path}`).join(', ')}), expected 6`);
  await withScreenApp(async ({ base, headers }) => {
    // EVERY link is driven and EVERY failure is named, so a second dead link
    // is never hidden behind the first: under F8 on a tip without AS-46 the
    // seam's /invoices/new and the mutant's /contracts/nwe are both reported
    // (a first-failure assert masked the mutant — measured, tick 7).
    const unserved = [];
    for (const link of links) {
      assert.ok(link.path.startsWith('/') && !link.path.includes('<%'), `${link.file}: ${link.path} is a constant app-relative path`);
      const res = await fetch(`${base}${link.path}`, { method: link.method, redirect: 'manual', headers });
      if (res.status === 404) unserved.push(`${link.file}: ${link.method} ${link.path} is served by nothing`);
      else if (res.status >= 500) unserved.push(`${link.file}: ${link.method} ${link.path} answered ${res.status}`);
    }
    assert.deepEqual(unserved, [], `${unserved.length} of ${links.length} links unserved: ${unserved.join('; ')}`);
  });
});

test('the print block hides the chrome and the actions, touches no contract-doc class, and pre-wrap holds outside it', () => {
  const css = readFileSync(join(configFor().publicDir, 'app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  // Exactly one print block, extracted by brace depth from its prelude.
  const starts = [...css.matchAll(/@media\s+print\s*\{/g)];
  assert.equal(starts.length, 1, `expected exactly 1 @media print block, found ${starts.length}`);
  let depth = 1;
  let i = starts[0].index + starts[0][0].length;
  const open = i;
  for (; i < css.length && depth > 0; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') depth -= 1;
  }
  assert.equal(depth, 0, 'the print block closes');
  const block = css.slice(open, i - 1);
  const rules = [...block.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: m[1].split(',').map((s) => s.trim()).filter(Boolean),
    body: m[2].trim(),
  }));
  assert.equal(rules.length, 2, `cardinality first: ${rules.length} rules in the print block, expected 2`);
  const hidden = rules.filter((r) => /display\s*:\s*none/.test(r.body)).flatMap((r) => r.selectors).sort();
  assert.deepEqual(hidden, ['.doc-actions', '.page-meta', '.page-title', '.site-header', '.site-nav'], 'the hidden-selector set is exactly the committed set');
  const touchingDoc = rules.flatMap((r) => r.selectors).filter((s) => s.includes('contract-doc'));
  assert.deepEqual(touchingDoc, [], 'no selector inside the print block names a contract-doc class — the notice and the attribution survive because nothing touches them');
  const region = rules.find((r) => r.selectors.includes('.doc-region'));
  assert.ok(region !== undefined, 'the document region drops its frame in print');
  assert.match(region.body, /border\s*:\s*none/);

  // pre-wrap holds in the BASE ruleset, outside the block.
  const base = css.slice(0, starts[0].index) + css.slice(i);
  assert.match(base, /\.contract-doc__multiline\s*\{[^}]*white-space\s*:\s*pre-wrap/, 'pre-wrap on the multiline span, in the base ruleset');

  // Every class render.js emits has a rule: the frozen contract is the SOURCE.
  // The names are read from a real render of the v1 declaration, imported
  // from nowhere.
  const template = getTemplate(DEFAULT_TEMPLATE_ID);
  const html = renderContract(template, {
    freelancerName: 'Freda Lancer', clientName: 'Ada Example', projectDescription: DESCRIPTION, startDate: START_DATE,
  });
  const classes = [...new Set([...html.matchAll(/class="([^"]+)"/g)].map((m) => m[1]))].sort();
  assert.equal(classes.length, 7, `cardinality first: render.js emits ${classes.length} class names, expected 7`);
  for (const name of classes) {
    assert.match(base, new RegExp(`\\.${name.replace(/[-]/g, '\\-')}(?![\\w-])[^{]*\\{`), `.${name} has a rule in app.css`);
  }
});
