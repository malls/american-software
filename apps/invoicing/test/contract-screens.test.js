// test/contract-screens.test.js — screens 6 and 7: contract create, and
// contract detail with print and download (AS-47, plan §7).
//
// A NEW FILE, deliberately: never an addition to screens.test.js (AS-70's) or
// auth.test.js (at the 1,200-line ceiling). Screen 6's cases (1–19, AS-127)
// come first, in ledger order; screen 7's (20–29, AS-47) follow — AS-47 landed
// screen 7 first and AS-127 put screen 6 above it (AS-127 plan §0.4).
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
import { ValidationError } from '../lib/db/database.js';
import {
  CONTRACT_DETAIL_LEDGER,
  CONTRACT_DETAIL_STATES,
  contractDetailLocals,
} from '../lib/screens/contract-detail-view.js';
import {
  CONTRACT_FORM_LEDGER,
  CONTRACT_FORM_STATES,
  INTENTS,
  STATE_STATUS,
  contractFormLocals,
  parseContractForm,
} from '../lib/screens/contract-form-view.js';
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
    /** A form-encoded POST with the session, redirects unfollowed. `fields` is
     *  an object, or an array of [name, value] pairs when a name repeats. */
    const post = (path, fields, extra = {}) => fetch(`${base}${path}`, {
      method: 'POST',
      redirect: 'manual',
      headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded', ...extra },
      body: new URLSearchParams(Array.isArray(fields) ? fields : Object.entries(fields)).toString(),
    });
    await fn({ base, app, config, repos, freelancer, client, headers, cookie, generate, get, post });
  });
}

/** A valid screen-6 generate body for `client`. */
const validBody = (client, extra = {}) => ({
  intent: 'generate', clientId: client.id, pickerMode: 'select', projectDescription: DESCRIPTION, startDate: START_DATE, ...extra,
});

const countContracts = (repos, freelancer) => repos.contracts.listByFreelancer(freelancer.id).length;
const countClients = (repos, freelancer) => repos.clients.listByFreelancer(freelancer.id).length;

/** The declared form-sourced variables, read from the declaration in the
 *  test, never hard-coded — the fields the screen must render. */
const declaredFormVariables = () => getTemplate(DEFAULT_TEMPLATE_ID).variables.filter((v) => v.source === 'form');

// =============================================================================
// Screen 6 — the ledger and the form
// =============================================================================

/** docs/design/wireframes/02-states-ledger.md §6, all eleven rows, in the
 *  document's own order. Transcribed BY HAND and INDEPENDENTLY of
 *  lib/screens/contract-form-view.js's copy; the two are compared against each
 *  other (the SCREEN_7_LEDGER note applies). */
const SCREEN_6_LEDGER = [
  ['S6-DEFAULT', 'rendered'],
  ['S6-LOADING', 'unrenderable — browser-supplied'],
  ['S6-CLIENT-EMPTY', 'rendered'],
  ['S6-ERROR-VALIDATION', 'rendered'],
  ['S6-ERROR-SYSTEM', 'rendered'],
  ['S6-CLIENT-ERROR-VALIDATION', 'rendered'],
  ['S6-CLIENT-ERROR-DUPLICATE', 'rendered'],
  ['S6-GATED-STRIPENOTREADY', 'n/a'],
  ['S6-DENIED-SIGNEDOUT', 'redirect-answered'],
  ['S6-ABANDON', 'path-into-render'],
  ['S6-CLIENT-ABANDON', 'path-into-render'],
];

test('screen 6 accounts for all eleven of its ledger rows: 6 + 1 + 2 + 1 + 1 = 11', () => {
  assert.equal(SCREEN_6_LEDGER.length, 11, 'the ledger table transcribed here has eleven rows');
  assert.equal(CONTRACT_FORM_LEDGER.length, 11, `the view model accounts for ${CONTRACT_FORM_LEDGER.length} rows, expected 11`);
  const declared = CONTRACT_FORM_LEDGER.map((row) => [row.id, row.disposition]).sort();
  assert.deepEqual(declared, [...SCREEN_6_LEDGER].sort());

  const partition = {};
  for (const row of CONTRACT_FORM_LEDGER) partition[row.disposition] = (partition[row.disposition] ?? 0) + 1;
  assert.deepEqual(partition, {
    rendered: 6,
    'redirect-answered': 1,
    'path-into-render': 2,
    'unrenderable — browser-supplied': 1,
    'n/a': 1,
  });
  assert.equal(6 + 1 + 2 + 1 + 1, 11);
  assert.equal(Object.values(partition).reduce((a, b) => a + b, 0), CONTRACT_FORM_LEDGER.length);

  assert.equal(CONTRACT_FORM_STATES.length, 6, `${CONTRACT_FORM_STATES.length} rendered states, expected 6`);
  assert.deepEqual([...CONTRACT_FORM_STATES].sort(), [
    'S6-CLIENT-EMPTY', 'S6-CLIENT-ERROR-DUPLICATE', 'S6-CLIENT-ERROR-VALIDATION', 'S6-DEFAULT', 'S6-ERROR-SYSTEM', 'S6-ERROR-VALIDATION',
  ]);
  const na = CONTRACT_FORM_LEDGER.filter((row) => row.disposition === 'n/a').map((row) => row.id);
  assert.deepEqual(na, ['S6-GATED-STRIPENOTREADY'], 'the n/a bucket has exactly one member, the ledger\'s own explicit row');
  assert.ok(Object.isFrozen(CONTRACT_FORM_STATES) && Object.isFrozen(CONTRACT_FORM_LEDGER), 'both lists are frozen');
  assert.deepEqual(Object.keys(STATE_STATUS).sort(), [...CONTRACT_FORM_STATES].sort(), 'every rendered state has a status');
  assert.deepEqual([...INTENTS], ['generate', 'new-client', 'existing-client', 'add-client']);

  // AND THE TABLE IS NOT DECORATIVE: each rendered state owns exactly one
  // DISTINCTIVE MARKER in the template source (AS-47 plan §3.6).
  const source = readFileSync(join(configFor().viewsDir, 'contract-form.ejs'), 'utf8');
  const markers = [
    ['S6-DEFAULT', '<select id="clientId" name="clientId">'],
    ['S6-CLIENT-EMPTY', 'No clients yet — add one below.'],
    ['S6-ERROR-VALIDATION', '<textarea id="<%= field.name %>" name="<%= field.name %>" rows="3" aria-invalid="true"'],
    ['S6-ERROR-SYSTEM', 'Something went wrong generating this contract. Nothing was created — try again.'],
    ['S6-CLIENT-ERROR-VALIDATION', 'id="clientName-error"'],
    ['S6-CLIENT-ERROR-DUPLICATE', 'name="duplicateId"'],
  ];
  assert.equal(markers.length, 6, 'cardinality first: one marker row per rendered state');
  assert.deepEqual(markers.map(([state]) => state).sort(), [...CONTRACT_FORM_STATES].sort());
  for (const [state, marker] of markers) {
    assert.equal(occurrences(source, marker), 1, `${state}'s distinctive marker "${marker}" occurs ${occurrences(source, marker)} time(s) in the template, expected exactly 1`);
  }
  // NO RAW LINE: screen 6 adds none to the one sanctioned in contract-detail.ejs.
  assert.equal(occurrences(source, '<%-'), 0, 'the raw-output tag appears nowhere in contract-form.ejs');
  assert.equal(VIEWS.find((v) => v.file === 'contract-form.ejs').sampleLocals.state, 'S6-CLIENT-EMPTY', 'the VIEWS probe renders the no-clients default');
});

test('the contract form view model reaches every rendered state with no HTTP, and its fields come from the declaration', () => {
  const clients = [{ id: 'c-1', name: 'Ada Example', email: 'ada@example.test' }];
  const valid = { intent: 'generate', clientId: 'c-1', projectDescription: DESCRIPTION, startDate: START_DATE };
  const cells = [
    [{ clients }, 'S6-DEFAULT'],
    [{}, 'S6-CLIENT-EMPTY'],
    [{ clients, submission: parseContractForm({ ...valid, projectDescription: '' }) }, 'S6-ERROR-VALIDATION'],
    [{ clients, submission: parseContractForm(valid), clientRefused: true }, 'S6-ERROR-VALIDATION'],
    [{ clients, submission: parseContractForm({ intent: 'drop' }) }, 'S6-ERROR-VALIDATION'],
    [{ clients, submission: parseContractForm(valid), generationFailed: true }, 'S6-ERROR-SYSTEM'],
    [{ clients, submission: parseContractForm({ intent: 'add-client', clientName: '', clientEmail: 'x@example.test' }) }, 'S6-CLIENT-ERROR-VALIDATION'],
    [{ clients, submission: parseContractForm({ intent: 'add-client', clientName: 'Bea', clientEmail: 'ADA@EXAMPLE.TEST' }), duplicate: clients[0] }, 'S6-CLIENT-ERROR-DUPLICATE'],
  ];
  assert.equal(cells.length, 8, 'cardinality first: the committed cell count');
  const reached = new Set();
  for (const [input, state] of cells) {
    const locals = contractFormLocals(input);
    assert.equal(locals.state, state, JSON.stringify(input));
    assert.equal(locals.status, STATE_STATUS[state]);
    assert.ok(CONTRACT_FORM_STATES.includes(locals.state));
    reached.add(locals.state);
  }
  assert.equal(reached.size, 6, 'every rendered state is reached from a pure input');
  assert.deepEqual(Object.values(STATE_STATUS), [200, 200, 400, 500, 400, 200]);

  // THE FIELDS ARE THE DECLARATION'S, read here from the registry, not typed.
  const declared = declaredFormVariables();
  assert.equal(declared.length, 2, `cardinality first: ${declared.length} form-sourced variables declared, expected 2`);
  const { fields } = contractFormLocals({ clients });
  assert.deepEqual(fields.map((f) => f.name), declared.map((v) => v.name), 'in declaration order');
  assert.deepEqual(fields.map((f) => f.type), declared.map((v) => v.type));
  assert.deepEqual(fields.map((f) => f.label), declared.map((v) => v.label), 'labels come from the declaration (Q3)');

  // ONLY DECLARED NAMES ARE READ: a record-sourced name and a template id in
  // the body reach neither formValues nor any local.
  const smuggled = parseContractForm({ ...valid, freelancerName: 'Someone Else', templateId: 'other' });
  assert.deepEqual(Object.keys(smuggled.formValues), declared.map((v) => v.name), 'formValues has exactly the declared keys');
  assert.equal(smuggled.errors.clientId, false);
  const locals = contractFormLocals({ clients, submission: smuggled, generationFailed: true });
  assert.equal(leaves(locals).filter((leaf) => leaf === 'Someone Else' || leaf === 'other').length, 0, 'no local equals a record-sourced or template value');
  // An unknown, absent or repeated intent is refused by the parser.
  for (const body of [{ intent: 'drop' }, {}, { intent: ['generate', 'add-client'] }]) {
    assert.equal(parseContractForm(body).intent, null, JSON.stringify(body));
    assert.equal(contractFormLocals({ clients, submission: parseContractForm(body) }).banner.message, 'Choose an action.');
  }
  // A non-object body is an empty form.
  assert.equal(parseContractForm(null).intent, null);
  assert.equal(parseContractForm('x').formValues, null);
});

test('S6-DEFAULT renders the picker, the declared fields, the placeholder warning and no Stripe gate', async () => {
  await withScreenApp(async ({ get, repos, freelancer }) => {
    // NO connected-account row exists for this freelancer — that is the
    // assertion: the screen reads none and gates on nothing.
    assert.equal(repos.connectedAccounts.getByFreelancer(freelancer.id), null, 'no Connect row seeded');
    const res = await get('/contracts/new');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const html = await res.text();
    assert.equal(stateOf(html), 'S6-DEFAULT');
    assert.equal(occurrences(html, '<select id="clientId" name="clientId">'), 1);
    assert.equal(occurrences(html, '<select'), 1);
    assert.equal(occurrences(html, '<textarea'), 1);
    assert.equal(occurrences(html, 'name="projectDescription"'), 1);
    assert.equal(occurrences(html, 'type="date"'), 1);
    assert.equal(occurrences(html, 'name="startDate"'), 1);
    assert.equal(occurrences(html, 'banner-warning'), 1, 'the placeholder warning, once');
    assert.equal(occurrences(html, 'Placeholder contract text — not legal advice'), 1);
    assert.equal(occurrences(html, 'banner-error'), 0);
    assert.equal(occurrences(html, '>Generate contract</button>'), 1);
    assert.equal(occurrences(html, '<form method="post">'), 1, 'exactly one action-less POST form');
    assert.equal(occurrences(html, '<form class="site-nav__signout" method="post" action="/signout">'), 1);
    assert.equal(occurrences(html, ' action="/contracts'), 0);
    assert.equal(occurrences(html, 'templateId'), 0, 'no hidden template input');
    assert.equal(occurrences(html, 'connect-stripe'), 0, 'no gate');
    // The nav's three entries on today's master (Dashboard is AS-48's).
    assert.equal(occurrences(html, 'class="site-nav__link"'), 2);
    assert.equal(occurrences(html, 'href="/contracts/new"'), 1, 'the nav self-entry');
    assert.equal(occurrences(html, 'href="/invoices/new"'), 1);
    assert.equal(occurrences(html, 'Dashboard'), 0, 'no Dashboard entry until AS-48');
    assert.equal(occurrences(html, 'New contract'), 3, '<title>, <h1>, and the nav entry');
    // The form's named controls stay under the parser's 20-parameter limit.
    const form = html.slice(html.indexOf('<form method="post">'), html.indexOf('</form>', html.indexOf('<form method="post">')));
    const named = form.match(/<(input|select|textarea|button)\b[^>]*\bname="/g) ?? [];
    assert.ok(named.length > 0 && named.length < 20, `${named.length} named controls, under the parser's 20`);
  });
});

test('S6-CLIENT-EMPTY: with zero clients the picker opens in add-new mode and no select renders', async () => {
  await withScreenApp(async ({ base, repos }) => {
    const { cookie } = seedSignedIn(repos, { email: 'empty@example.test', displayName: 'No Clients Yet' });
    const res = await fetch(`${base}/contracts/new`, { redirect: 'manual', headers: signedInHeaders(base, cookie) });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.equal(stateOf(html), 'S6-CLIENT-EMPTY');
    assert.equal(occurrences(html, '<select'), 0, 'no select');
    assert.equal(occurrences(html, 'No clients yet — add one below.'), 1);
    assert.equal(occurrences(html, 'value="new-client"'), 0, 'no toggle to add-new mode: it is forced');
    assert.equal(occurrences(html, 'value="existing-client"'), 0, 'and none back');
    assert.equal(occurrences(html, '<input type="hidden" name="pickerMode" value="new" />'), 1);
    assert.equal(occurrences(html, 'id="clientName"'), 1);
    assert.equal(occurrences(html, '>Add client</button>'), 1);
    assert.equal(occurrences(html, 'New contract — no clients yet'), 2, 'the title, in <title> and <h1>');
  });
});

test('S6-ERROR-VALIDATION marks every failing field, counts them in the banner, and re-renders every submitted value as typed', async () => {
  await withScreenApp(async ({ post, repos, freelancer, client }) => {
    const before = countContracts(repos, freelancer);
    const res = await post('/contracts/new', { intent: 'generate', pickerMode: 'select', clientId: '', projectDescription: '', startDate: '2026-02-31' });
    assert.equal(res.status, 400);
    const html = await res.text();
    assert.equal(stateOf(html), 'S6-ERROR-VALIDATION');
    assert.equal(occurrences(html, 'field--invalid'), 3, 'three marked fields');
    assert.equal(occurrences(html, '3 fields need attention'), 1);
    assert.equal(occurrences(html, 'Select a client.'), 1);
    assert.equal(occurrences(html, 'Describe the project in a sentence or two.'), 1);
    assert.equal(occurrences(html, 'Enter a date as YYYY-MM-DD.'), 1);
    assert.equal(occurrences(html, 'value="2026-02-31"'), 1, 'the date re-rendered byte for byte');
    assert.equal(occurrences(html, 'New contract — fix the highlighted fields'), 2);
    assert.equal(countContracts(repos, freelancer), before, 'nothing created');

    // One failing field alone: the wireframe's singular sentence.
    const one = await post('/contracts/new', validBody(client, { startDate: '2026-02-31' }));
    assert.equal(one.status, 400);
    const oneHtml = await one.text();
    assert.equal(occurrences(oneHtml, 'field--invalid'), 1);
    assert.equal(occurrences(oneHtml, '1 field needs attention'), 1);
    assert.equal(occurrences(oneHtml, `value="${client.id}" selected`), 1, 'the selected client is preserved');
    assert.equal(occurrences(oneHtml, DESCRIPTION), 1, 'the description is preserved');

    // THE TEXTAREA NEWLINE (AS-127 decision 4): a value beginning with a
    // newline survives the browser's one-newline drop because the template
    // emits one literal newline after the opening tag.
    const lead = await post('/contracts/new', validBody(client, { clientId: '', projectDescription: '\nlead' }));
    assert.equal(lead.status, 400);
    assert.equal(occurrences(await lead.text(), '>\n\nlead</textarea>'), 1, 'one literal newline, then the value');
    assert.equal(countContracts(repos, freelancer), before);
  });
});

test('the screen and the API validate with the same function: what generate refuses, the screen marks, for every declared field', async () => {
  const refusedValueFor = { multiline: 'x'.repeat(5001), date: '2026-02-31', text: 'y'.repeat(201) };
  await withScreenApp(async ({ post, repos, freelancer, client, generate }) => {
    const declared = declaredFormVariables();
    assert.equal(declared.length, 2, 'cardinality first');
    const rows = declared.flatMap((v) => [[v.name, ''], [v.name, refusedValueFor[v.type]]]);
    assert.equal(rows.length, 4, 'two refused values per declared field');
    const before = countContracts(repos, freelancer);
    for (const [name, bad] of rows) {
      const label = `${name}=${JSON.stringify(bad).slice(0, 20)}`;
      // (i) The pure parser marks the field ITSELF — no HTTP, no instrument on
      //     generate (AS-127 decision 3). F6 is red here and only here.
      const parsed = parseContractForm(validBody(client, { [name]: bad }));
      assert.equal(parsed.errors[name], true, `${label}: the parser marks the field`);
      assert.equal(parsed.formValues, null, `${label}: nothing is handed to generate`);
      assert.equal(parsed.fieldErrorCount, 1, `${label}: exactly one error`);
      // (ii) The screen marks exactly that field.
      const res = await post('/contracts/new', validBody(client, { [name]: bad }));
      assert.equal(res.status, 400, label);
      const html = await res.text();
      assert.equal(stateOf(html), 'S6-ERROR-VALIDATION', label);
      assert.equal(occurrences(html, 'field--invalid'), 1, `${label}: exactly one marked field`);
      assert.equal(occurrences(html, `id="${name}-error"`), 1, `${label}: it is ${name}`);
      assert.equal(countContracts(repos, freelancer), before, `${label}: zero rows`);
      // (iii) The API refuses the same body: 400 text/plain in the API's own
      //       shape (contracts.test.js P3's body — `fail` prints the step, not
      //       the field), and the SAME function throws naming the same field
      //       (ValidationError carries it as `.field`, lib/db/errors.js).
      const api = await post('/contracts', { clientId: client.id, projectDescription: DESCRIPTION, startDate: START_DATE, [name]: bad });
      assert.equal(api.status, 400, label);
      assert.match(api.headers.get('content-type'), /text\/plain/, label);
      assert.equal(await api.text(), 'ValidationError: create\n', label);
      assert.throws(() => generate({ projectDescription: DESCRIPTION, startDate: START_DATE, [name]: bad }),
        (err) => err instanceof ValidationError && err.field === name, `${label}: generate names the field`);
      assert.equal(countContracts(repos, freelancer), before, `${label}: the API created nothing either`);
    }
  });
});

test('S6-CLIENT-ERROR-VALIDATION: blank client fields re-render with every value preserved and no client row created', async () => {
  await withScreenApp(async ({ post, repos, freelancer }) => {
    const clientsBefore = countClients(repos, freelancer);
    const res = await post('/contracts/new', { intent: 'add-client', pickerMode: 'new', clientName: '  ', clientEmail: '', projectDescription: DESCRIPTION, startDate: START_DATE });
    assert.equal(res.status, 400);
    const html = await res.text();
    assert.equal(stateOf(html), 'S6-CLIENT-ERROR-VALIDATION');
    assert.equal(occurrences(html, 'field--invalid'), 2, 'both client fields marked');
    assert.equal(occurrences(html, 'id="clientName-error"'), 1);
    assert.equal(occurrences(html, 'id="clientEmail-error"'), 1);
    assert.equal(occurrences(html, '2 fields need attention'), 1);
    assert.equal(occurrences(html, DESCRIPTION), 1, 'the description is intact');
    assert.equal(occurrences(html, `value="${START_DATE}"`), 1, 'the date is intact');
    assert.equal(occurrences(html, 'New contract — new client needs a name and email'), 2);
    assert.equal(countClients(repos, freelancer), clientsBefore, 'no client row');
    assert.equal(countContracts(repos, freelancer), 0);
  });
});

test('S6-CLIENT-ERROR-DUPLICATE: an email matching an existing client case-insensitively warns, names the match, creates nothing, and offers both ways forward', async () => {
  await withScreenApp(async ({ post, repos, freelancer, client }) => {
    const before = countClients(repos, freelancer);
    const res = await post('/contracts/new', { intent: 'add-client', pickerMode: 'new', clientName: 'Ada Again', clientEmail: 'ADA@EXAMPLE.TEST', projectDescription: DESCRIPTION, startDate: START_DATE });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.equal(stateOf(html), 'S6-CLIENT-ERROR-DUPLICATE');
    assert.equal(occurrences(html, `This matches an existing client: <strong>${client.name} (${client.email})</strong>.`), 1, 'the match, named');
    // The match is findByEmail's, not the screen's: the seeded id travels.
    assert.equal(occurrences(html, `<input type="hidden" name="duplicateId" value="${client.id}" />`), 1);
    assert.equal(occurrences(html, '<input type="hidden" name="clientConfirm" value="1" />'), 1);
    assert.equal(occurrences(html, '>Use this client instead</button>'), 1);
    assert.equal(occurrences(html, '>Create a new client anyway</button>'), 1);
    assert.equal(occurrences(html, 'value="existing-client"'), 1, 'the offer is the only existing-client control');
    assert.equal(occurrences(html, 'value="Ada Again"'), 1, 'the typed name is preserved');
    assert.equal(occurrences(html, 'New contract — this looks like an existing client'), 2);
    assert.equal(countClients(repos, freelancer), before, 'nothing created');
  });
});

test('the two duplicate offers work: "create anyway" adds a second row, "use this client instead" selects the existing one and adds none', async () => {
  await withScreenApp(async ({ post, repos, freelancer, client }) => {
    const before = countClients(repos, freelancer);
    const base = { pickerMode: 'new', clientName: 'Ada Again', clientEmail: 'ADA@EXAMPLE.TEST', duplicateId: client.id, projectDescription: DESCRIPTION, startDate: START_DATE };
    // Use this client instead: select mode, the existing row selected, none added.
    const use = await post('/contracts/new', { ...base, intent: 'existing-client' });
    assert.equal(use.status, 200);
    const useHtml = await use.text();
    assert.equal(stateOf(useHtml), 'S6-DEFAULT');
    assert.equal(occurrences(useHtml, `<option value="${client.id}" selected>`), 1);
    assert.equal(occurrences(useHtml, '<input type="hidden" name="pickerMode" value="select" />'), 1);
    assert.equal(countClients(repos, freelancer), before, 'use-this-client adds none');
    // Create anyway: the confirmation travels, a second row exists.
    const anyway = await post('/contracts/new', { ...base, intent: 'add-client', clientConfirm: '1' });
    assert.equal(anyway.status, 200);
    const anywayHtml = await anyway.text();
    assert.equal(stateOf(anywayHtml), 'S6-DEFAULT');
    assert.equal(countClients(repos, freelancer), before + 1, 'create-anyway adds exactly one');
    const added = repos.clients.listByFreelancer(freelancer.id).find((c) => c.name === 'Ada Again');
    assert.ok(added, 'the second row carries the typed name');
    assert.equal(occurrences(anywayHtml, `<option value="${added.id}" selected>`), 1, 'and is selected');
    assert.equal(occurrences(anywayHtml, DESCRIPTION), 1);
    assert.equal(countContracts(repos, freelancer), 0);
  });
});

test('add-client creates exactly one client and re-renders with it selected and every contract value preserved', async () => {
  await withScreenApp(async ({ post, repos, freelancer }) => {
    const before = countClients(repos, freelancer);
    const res = await post('/contracts/new', { intent: 'add-client', pickerMode: 'new', clientName: 'Bea Sample', clientEmail: 'bea@example.test', projectDescription: DESCRIPTION, startDate: START_DATE });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.equal(stateOf(html), 'S6-DEFAULT');
    assert.equal(countClients(repos, freelancer), before + 1, 'exactly one client row');
    const created = repos.clients.listByFreelancer(freelancer.id).find((c) => c.email === 'bea@example.test');
    assert.equal(occurrences(html, `<option value="${created.id}" selected>Bea Sample (bea@example.test)</option>`), 1);
    assert.equal(occurrences(html, '<input type="hidden" name="pickerMode" value="select" />'), 1);
    assert.equal(occurrences(html, DESCRIPTION), 1, 'the description is preserved');
    assert.equal(occurrences(html, `value="${START_DATE}"`), 1, 'the date is preserved');
    assert.equal(occurrences(html, 'field--invalid'), 0);
    assert.equal(countContracts(repos, freelancer), 0, 'add-client creates a client and nothing else');
  });
});

test('S6-ERROR-SYSTEM: a generation that fails after validation re-renders in place, names that nothing was created, and preserves every value', async () => {
  await withScreenApp(async ({ get, post, repos, freelancer, client, config }) => {
    const clientsBefore = repos.clients.listByFreelancer(freelancer.id).map((c) => c.id);
    assert.equal((await get('/contracts/new')).status, 200, 'the form renders before the injection');
    // THE INJECTION IS THE INSTRUMENT (AS-47 plan §3.8): the table is dropped
    // after the GET, so a validated generate fails at the write — something
    // that is not a client-shaped refusal.
    const db = openDatabase(config.dbPath);
    try {
      db.exec('DROP TABLE contracts');
    } finally {
      db.close();
    }
    const res = await post('/contracts/new', validBody(client));
    assert.equal(res.status, 500);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const html = await res.text();
    assert.equal(stateOf(html), 'S6-ERROR-SYSTEM');
    assert.equal(occurrences(html, 'Something went wrong generating this contract. Nothing was created — try again.'), 1);
    assert.equal(occurrences(html, 'Contract not created'), 2, 'the title, in <title> and <h1>');
    assert.equal(occurrences(html, '<form method="post">'), 1, 'the form IS the retry');
    assert.equal(occurrences(html, '>Try again</button>'), 1);
    assert.equal(occurrences(html, '>Generate contract</button>'), 0);
    assert.equal(occurrences(html, DESCRIPTION), 1, 'the description is preserved');
    assert.equal(occurrences(html, `value="${START_DATE}"`), 1, 'the date is preserved');
    assert.equal(occurrences(html, `<option value="${client.id}" selected>`), 1, 'the client is preserved');
    assert.equal(occurrences(html, 'field--invalid'), 0, 'nothing is marked: validation passed');
    assert.equal(occurrences(html, 'no such table'), 0, 'the driver message reaches nothing');
    // Nothing was written anywhere: the table is gone and the clients are as they were.
    const check = openDatabase(config.dbPath);
    try {
      assert.equal(check.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'contracts'").get().n, 0);
    } finally {
      check.close();
    }
    assert.deepEqual(repos.clients.listByFreelancer(freelancer.id).map((c) => c.id), clientsBefore, 'clients unchanged');
  });
});

test('generate creates one contract through the same path as the API, and lands on a detail page that exists', async () => {
  await withScreenApp(async ({ base, post, repos, freelancer, client, cookie }) => {
    const before = countContracts(repos, freelancer);
    const res = await post('/contracts/new', validBody(client));
    assert.equal(res.status, 303);
    assert.equal(countContracts(repos, freelancer), before + 1, 'exactly one row');
    const row = repos.contracts.listByFreelancer(freelancer.id)[0];
    assert.equal(res.headers.get('location'), `/contracts/${row.id}`, 'the API\'s own detailPath');
    const landing = await followToTerminus(base, res, { cookie });
    assert.equal(landing.hops, 1);
    assert.equal(landing.status, 200);
    assert.equal(stateOf(landing.body), 'S7-DEFAULT');
    assert.equal(row.renderedHtml, renderContract(getTemplate(row.templateId), row.variables), 'the reproduction invariant holds');
    assert.equal(row.templateId, DEFAULT_TEMPLATE_ID);
    // The same inputs through the API produce a byte-identical document.
    const api = await post('/contracts', { clientId: client.id, projectDescription: DESCRIPTION, startDate: START_DATE });
    assert.equal(api.status, 303);
    assert.equal(countContracts(repos, freelancer), before + 2);
    const apiRow = repos.contracts.getById(freelancer.id, api.headers.get('location').slice('/contracts/'.length));
    assert.equal(apiRow.renderedHtml, row.renderedHtml, 'byte-identical: one generate, two callers');
  });
});

test('S6-DENIED-SIGNEDOUT: cookieless GET and POST /contracts/new are answered by the guard, and the GET lands on screen 1 carrying next', async () => {
  await withScreenApp(async ({ base, repos, freelancer }) => {
    const res = await fetch(`${base}/contracts/new`, { redirect: 'manual' });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/signin?next=%2Fcontracts%2Fnew');
    assert.equal(res.headers.getSetCookie().length, 0, 'the guard sets no cookie');
    const landing = await followToTerminus(base, res);
    assert.equal(landing.hops, 1);
    assert.equal(landing.status, 200);
    assert.equal(stateOf(landing.body), 'S1-DEFAULT-SIGNIN');
    assert.equal(occurrences(landing.body, '<input type="hidden" name="next" value="/contracts/new" />'), 2);
    const posted = await fetch(`${base}/contracts/new`, {
      method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ intent: 'generate', projectDescription: DESCRIPTION, startDate: START_DATE }).toString(),
    });
    assert.equal(posted.status, 303);
    assert.equal(posted.headers.get('location'), '/signin', 'a POST carries no next');
    assert.equal(posted.headers.getSetCookie().length, 0);
    assert.equal(countContracts(repos, freelancer), 0);
  });
});

test('S6-ABANDON: two GETs are byte-identical, a non-persisting re-render is forgotten, and nothing was created', async () => {
  await withScreenApp(async ({ get, post, repos, freelancer, client }) => {
    const first = await (await get('/contracts/new')).text();
    const second = await (await get('/contracts/new')).text();
    assert.equal(first, second, 'two successive GETs are byte-identical — a read creates no state');
    const rerender = await post('/contracts/new', validBody(client, { intent: 'new-client', projectDescription: 'Typed, then abandoned — ASC127ABANDON' }));
    assert.equal(rerender.status, 200);
    assert.equal(occurrences(await rerender.text(), 'ASC127ABANDON'), 1, 'the re-render carries the typed value');
    const third = await (await get('/contracts/new')).text();
    assert.equal(third, first, 'the next GET starts blank: there is no draft');
    assert.equal(occurrences(third, 'ASC127ABANDON'), 0);
    assert.equal(countContracts(repos, freelancer), 0);
    assert.equal(countClients(repos, freelancer), 1);
  });
});

test('S6-CLIENT-ABANDON: a new-client re-render creates no client, and the next GET starts the picker at its default variant', async () => {
  await withScreenApp(async ({ get, post, repos, freelancer, client }) => {
    const clientsBefore = countClients(repos, freelancer);
    const contractsBefore = countContracts(repos, freelancer);
    for (const intent of ['new-client', 'existing-client']) {
      const res = await post('/contracts/new', validBody(client, { intent, clientName: 'Typed Name', clientEmail: 'typed@example.test' }));
      assert.equal(res.status, 200, intent);
      const html = await res.text();
      assert.equal(stateOf(html), 'S6-DEFAULT', intent);
      assert.equal(occurrences(html, `<input type="hidden" name="pickerMode" value="${intent === 'new-client' ? 'new' : 'select'}" />`), 1, intent);
      assert.equal(countClients(repos, freelancer), clientsBefore, `${intent} creates no client`);
      assert.equal(countContracts(repos, freelancer), contractsBefore, `${intent} creates no contract`);
    }
    const next = await (await get('/contracts/new')).text();
    assert.equal(occurrences(next, '<input type="hidden" name="pickerMode" value="select" />'), 1, 'the default variant: select mode');
    assert.equal(occurrences(next, 'Typed Name'), 0, 'the typed client is forgotten');
  });
});

test('the intent dispatch is closed: an unknown, absent or repeated intent is refused and persists nothing', async () => {
  await withScreenApp(async ({ post, repos, freelancer, client }) => {
    const bodies = [
      ['unknown', [['intent', 'drop'], ['clientId', client.id], ['projectDescription', DESCRIPTION], ['startDate', START_DATE]]],
      ['absent', [['clientId', client.id], ['projectDescription', DESCRIPTION], ['startDate', START_DATE]]],
      ['repeated', [['intent', 'generate'], ['intent', 'add-client'], ['clientId', client.id], ['clientName', 'X'], ['clientEmail', 'x@example.test'], ['projectDescription', DESCRIPTION], ['startDate', START_DATE]]],
    ];
    assert.equal(bodies.length, 3, 'cardinality first');
    for (const [label, fields] of bodies) {
      const res = await post('/contracts/new', fields);
      assert.equal(res.status, 400, label);
      const html = await res.text();
      assert.equal(stateOf(html), 'S6-ERROR-VALIDATION', label);
      assert.equal(occurrences(html, 'Choose an action.'), 1, label);
      assert.equal(occurrences(html, 'field--invalid'), 0, `${label}: values back, unmarked`);
      assert.equal(occurrences(html, DESCRIPTION), 1, label);
    }
    assert.equal(countContracts(repos, freelancer), 0);
    assert.equal(countClients(repos, freelancer), 1);
  });
});

test('a value containing markup in the description is rendered as text on the re-render, not as markup', async () => {
  await withScreenApp(async ({ post, client }) => {
    const res = await post('/contracts/new', validBody(client, { clientId: '', projectDescription: 'Scope: <b>ASC127</b> & more' }));
    assert.equal(res.status, 400);
    const html = await res.text();
    assert.equal(occurrences(html, '&lt;b&gt;ASC127&lt;/b&gt; &amp; more'), 1, 'the escaped form, exactly once');
    assert.equal(occurrences(html, '<b>ASC127</b>'), 0, 'the raw form, zero times');
  });
});

test('GET and POST /contracts/new are served by the screen, never captured by /contracts/:id, and POST /contracts is unchanged', async () => {
  await withScreenApp(async ({ get, post }) => {
    const page = await get('/contracts/new');
    assert.equal(page.status, 200);
    assert.equal(stateOf(await page.text()), 'S6-DEFAULT', 'the form, not S7-ERROR-NOTFOUND');
    const bad = { intent: 'generate', clientId: '', projectDescription: '', startDate: '' };
    const screen = await post('/contracts/new', bad);
    assert.equal(screen.status, 400);
    assert.match(screen.headers.get('content-type'), /text\/html/);
    assert.equal(stateOf(await screen.text()), 'S6-ERROR-VALIDATION');
    // The API's own shape, unchanged (contracts.test.js P2/P3).
    const api = await post('/contracts', bad);
    assert.equal(api.status, 400);
    assert.match(api.headers.get('content-type'), /text\/plain/);
    assert.equal(await api.text(), 'ValidationError: create\n');
  });
});

test('a record-sourced name posted to the screen is not read: the document says the session freelancer\'s name', async () => {
  await withScreenApp(async ({ base, post, repos, freelancer, client, cookie }) => {
    const res = await post('/contracts/new', validBody(client, { freelancerName: 'Someone Else' }));
    assert.equal(res.status, 303, 'not read, so not refused: the API would 400 this body');
    const row = repos.contracts.listByFreelancer(freelancer.id)[0];
    assert.equal(row.variables.freelancerName, freelancer.displayName);
    assert.equal(occurrences(row.renderedHtml, 'Someone Else'), 0);
    const landing = await followToTerminus(base, res, { cookie });
    assert.equal(landing.status, 200);
    assert.equal(occurrences(landing.body, 'Someone Else'), 0, 'the served page carries nothing of it');
    assert.equal(occurrences(landing.body, freelancer.displayName), 1);
  });
});

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
    assert.equal(occurrences(html, 'href="/contracts/new"'), 1, 'the New contract entry, landed with its route (AS-127)');
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
  // Both contract templates, each with its own committed cardinality (AS-127):
  // two stylesheets, the nav's three anchors (Dashboard — AS-48's, New
  // invoice, New contract) and the sign-out action on each; contract-detail.ejs
  // also carries NOTFOUND's Back to Dashboard (AS-48). 4 at AS-47's merge, 6
  // after AS-48, 7 with screen 6's nav entry.
  const expected = [['contract-detail.ejs', 7], ['contract-form.ejs', 6]];
  const links = [];
  for (const [file, count] of expected) {
    const found = templateLinks(file);
    assert.equal(found.length, count, `cardinality first: ${found.length} links examined in ${file} (${found.map((l) => `${l.method} ${l.path}`).join(', ')}), expected ${count}`);
    links.push(...found);
  }
  assert.equal(links.length, 13);
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
