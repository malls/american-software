// screens.test.js — the view layer, and every state of screens 1 and 2
// (AS-45, plan §3.1, §3.4, §3.6, §3.7).
//
// THIS FILE'S ONE CLAIM: every row in docs/design/wireframes/02-states-ledger.md
// §1 and §2 is accounted for — rendered and asserted on a sentinel, answered by
// a redirect, named as a path into another render, or recorded as unrenderable
// with the reason.
//
// WHAT THAT IS JOINED TO, AND WHAT IT IS NOT (corrected 2026-09-03, review
// cycle 1 finding F-4; the original sentence claimed "a ledger row that appeared
// or vanished turns this red", which is stronger than what is checked). The
// table below and lib/screens/signin-view.js's SIGNIN_LEDGER are TWO
// INDEPENDENT HAND TRANSCRIPTIONS of the same document, compared against EACH
// OTHER by exact set equality and cardinality. So: a change to either copy alone
// is red, a render can never leave the closed set, and a state cannot be quietly
// dropped from the module. NOT checked, and not checkable from inside this
// suite: whether either copy still matches the design document. Nothing here
// reads it and nothing here can — the `test` service is mountless by design and
// the Dockerfile vendors exactly one file from outside the app,
// docs/design/tokens/tokens.css. The join to the document is a DATED REVIEW ACT:
// all eight screen-1 rows checked by hand against §1 on 2026-09-03 by
// agent:qa-priya. A verification a person performed, recorded with a date and a
// name, is a real control; one implied by a sentence about redness is not.
// Closing it mechanically means vendoring the ledger into the image the way
// tokens.css already is — filed as its own task, triggered by AS-70.
//
// THE SENTINEL IS `data-state` ON THE ROOT ELEMENT, never a copy fragment: a
// wording change is a design decision, and a test that breaks on one teaches
// people to assert on nothing. The value is always a member of the screen's
// frozen state list, so there is no way to assert on a state the ledger does
// not have.
//
// The escaping half is here too, and it is the DYNAMIC counterpart to
// dependency-policy.test.js's three lexical rows: those prove no template has a
// raw-output path; this drives a real request whose user-controlled value is
// markup and asserts on the served bytes.
//
// Everything runs offline: no accounts, no network, no Stripe call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VIEWS } from '../lib/views.js';
import { SIGNIN_LEDGER, SIGNIN_STATES, signinLocals } from '../lib/screens/signin-view.js';
import { CONNECT_LEDGER, CONNECT_STATES, connectLocals } from '../lib/screens/connect-view.js';
import { createStripeClient } from '../lib/stripe/client.js';
import { configFor, followToTerminus, seedSignedIn, withServer } from './helpers/server.js';

const PASSWORD = 'correct horse battery staple';
const EMAIL = 'freda@example.test';
const NAME = 'Freda Lancer';

const form = (fields) => new URLSearchParams(fields).toString();

const postForm = (url, fields, headers = {}) =>
  fetch(url, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: new URL(url).origin, ...headers },
    body: form(fields),
  });

/** OCCURRENCE counting, never a boolean `includes`. The difference matters:
 *  "the escaped form is present" is satisfied by a body that ALSO carries the
 *  raw form, and the whole claim is that the raw form appears zero times. */
const occurrences = (haystack, needle) => haystack.split(needle).length - 1;

/** The one `data-state` the page carries. Null when the response rendered none,
 *  which is itself an assertable fact (a redirect renders nothing). */
function stateOf(html) {
  const match = html.match(/data-state="([^"]*)"/);
  return match === null ? null : match[1];
}

// =============================================================================
// The ledger, transcribed. Cardinality and membership before anything else.
// =============================================================================

/** docs/design/wireframes/02-states-ledger.md §1, all eight rows, in the
 *  document's own order. Transcribed BY HAND on purpose, and INDEPENDENTLY of
 *  lib/screens/signin-view.js's copy: the two are compared against each other,
 *  so an edit to one alone is red. See the file header for what that does and
 *  does not join — it is drift detection between two transcriptions, not a read
 *  of the design document. */
const SCREEN_1_LEDGER = [
  ['S1-DEFAULT-SIGNIN', 'rendered'],
  ['S1-DEFAULT-SIGNUP', 'rendered'],
  ['S1-LOADING', 'unrenderable — browser-supplied'],
  ['S1-EMPTY', 'n/a'],
  ['S1-ERROR-VALIDATION', 'rendered'],
  ['S1-ERROR-SYSTEM', 'rendered'],
  ['S1-DENIED-AUTHENTICATED', 'redirect-answered'],
  ['S1-ABANDON', 'path-into-render'],
];

test('screen 1 accounts for all eight of its ledger rows, and exactly four of them render', () => {
  // Cardinality FIRST, against the committed number — never `> 0`.
  assert.equal(SCREEN_1_LEDGER.length, 8, 'the ledger table transcribed here has eight rows');
  assert.equal(SIGNIN_LEDGER.length, 8, `the view model accounts for ${SIGNIN_LEDGER.length} rows, expected 8`);

  // Exact set equality in both directions, id AND disposition.
  const declared = SIGNIN_LEDGER.map((row) => [row.id, row.disposition]).sort();
  assert.deepEqual(declared, [...SCREEN_1_LEDGER].sort());

  // S1-LOADING is NOT a gap. "Fields disabled, button reads 'Signing in…'" is a
  // state a page enters AFTER its bytes were served; producing it needs
  // client-side JavaScript, which this app has none of (dependency-policy's P2c
  // row keeps it that way). Its absence is therefore an assertion.
  const unrenderable = SIGNIN_LEDGER.filter((row) => row.disposition === 'unrenderable — browser-supplied');
  assert.deepEqual(unrenderable.map((row) => row.id), ['S1-LOADING']);

  assert.equal(SIGNIN_STATES.length, 4, `${SIGNIN_STATES.length} rendered states, expected 4`);
  assert.deepEqual([...SIGNIN_STATES].sort(), ['S1-DEFAULT-SIGNIN', 'S1-DEFAULT-SIGNUP', 'S1-ERROR-SYSTEM', 'S1-ERROR-VALIDATION']);
  assert.ok(Object.isFrozen(SIGNIN_STATES) && Object.isFrozen(SIGNIN_LEDGER), 'both lists are frozen');
});

test('the view model reaches every rendered state, exhaustively, with no HTTP at all', () => {
  // The state machine is a pure function, so it is testable in microseconds
  // before any request is made — which is most of why the split exists.
  const reached = new Set([
    signinLocals().state,
    signinLocals({ mode: 'signup' }).state,
    signinLocals({ mode: 'signup', failure: { step: 'invalid-email' } }).state,
    signinLocals({ failure: { step: 'invalid-credentials' } }).state,
  ]);
  assert.deepEqual([...reached].sort(), [...SIGNIN_STATES].sort(), 'every rendered state is reachable from route inputs alone');

  // A step this app has never met renders the SYSTEM error, never a crash and
  // never the error's own message.
  assert.equal(signinLocals({ failure: { step: 'some-future-step' } }).state, 'S1-ERROR-SYSTEM');
  // The mode is the ledger's stated default whenever `mode` is not exactly
  // 'signup' — including the array a `?mode[]=` query produces.
  assert.equal(signinLocals({ mode: ['signup'] }).state, 'S1-DEFAULT-SIGNIN');
  assert.equal(signinLocals({ mode: 'SIGNUP' }).state, 'S1-DEFAULT-SIGNIN');
  // THE LOCALS HAVE NO PASSWORD KEY, in any state. Not "it is not rendered" —
  // it does not exist to be rendered.
  for (const locals of [signinLocals(), signinLocals({ mode: 'signup', failure: { step: 'weak-password' } })]) {
    assert.equal(Object.keys(locals).includes('password'), false, 'the view model has no password key');
  }
});

/** THE ERROR TAXONOMY, MADE EXECUTABLE (plan §3.5.1's table; review cycle 1
 *  required case 1). Every failure step this app can produce, plus one token it
 *  has never met, crossed with both modes. `message` is the banner's system
 *  message — null for the validation rows, whose banner carries a COUNT rather
 *  than a sentence, and null for `email-taken`, whose banner names the
 *  submitted address instead. */
const FAILURE_TAXONOMY = [
  ['invalid-email', 'S1-ERROR-VALIDATION', null],
  ['weak-password', 'S1-ERROR-VALIDATION', null],
  ['missing-field', 'S1-ERROR-VALIDATION', null],
  ['email-taken', 'S1-ERROR-SYSTEM', null],
  ['invalid-credentials', 'S1-ERROR-SYSTEM', 'Email or password is incorrect.'],
  ['parse-body', 'S1-ERROR-SYSTEM', 'Something went wrong. Try again.'],
  ['no-such-step', 'S1-ERROR-SYSTEM', 'Something went wrong. Try again.'],
];

test('every failure step maps to exactly one system message, and mode never selects one', () => {
  // THE CRITERION CLASS BOTH CYCLE-1 DEFECTS ESCAPED. Plan §3.5.1 wrote this
  // table as BINDING and not one numbered criterion covered a row of it, so a
  // row implemented backwards passed a full sweep of twenty-seven: the
  // `default:` branch reached for a PER-MODE message, and every unmapped
  // failure on either route told the freelancer their password was wrong.
  //
  // The fix is structural — there is no per-mode message left to reach for —
  // and this is the assertion that keeps it that way. The mode axis is the
  // point: each step is asserted to produce the SAME message in both modes.
  const modes = ['signin', 'signup'];
  // Cardinality before quantification, against the committed cell count.
  assert.equal(FAILURE_TAXONOMY.length, 7, `the committed step list has ${FAILURE_TAXONOMY.length} rows, expected 7`);
  assert.equal(modes.length, 2);
  const cells = FAILURE_TAXONOMY.length * modes.length;
  assert.equal(cells, 14, `expected 14 cells (7 steps x 2 modes), computed ${cells}`);

  let examined = 0;
  for (const [step, state, message] of FAILURE_TAXONOMY) {
    const seen = new Set();
    for (const mode of modes) {
      const locals = signinLocals({ mode, failure: { step, email: 'x@example.test' } });
      assert.equal(locals.state, state, `${step} in ${mode} mode rendered ${locals.state}`);
      const actual = locals.banner === null ? null : locals.banner.message;
      assert.equal(actual, message, `${step} in ${mode} mode said ${JSON.stringify(actual)}`);
      seen.add(actual);
      examined += 1;
    }
    // The mode axis, stated as its own claim rather than inferred from the two
    // assertions above agreeing: ONE message per step, whatever the mode.
    assert.equal(seen.size, 1, `${step} produces ${seen.size} different messages across modes: ${[...seen].join(' | ')}`);
  }
  assert.equal(examined, cells, `examined ${examined} cells, expected ${cells}`);

  // And the two system sentences are DISTINCT — the property the fix exists
  // for. Its HTTP-level sibling is auth.test.js's 'a parse-body failure and an
  // invalid-credentials failure are distinguishable'.
  const credentials = signinLocals({ failure: { step: 'invalid-credentials' } }).banner.message;
  const generic = signinLocals({ failure: { step: 'parse-body' } }).banner.message;
  assert.notEqual(credentials, generic, 'the credentials sentence and the generic one must not be the same string');
});

// =============================================================================
// Screen 1 over HTTP
// =============================================================================

test('S1-DEFAULT-SIGNIN and S1-DEFAULT-SIGNUP are the two modes of one route', async () => {
  await withServer(configFor(), async (base) => {
    const signin = await fetch(`${base}/signin`);
    assert.equal(signin.status, 200);
    assert.match(signin.headers.get('content-type'), /text\/html/);
    const signinHtml = await signin.text();
    assert.equal(stateOf(signinHtml), 'S1-DEFAULT-SIGNIN');
    // Counted, not `includes`: the mode-switch form's action is "/signin" in
    // BOTH modes, so a boolean would be true either way and prove nothing.
    assert.equal(occurrences(signinHtml, 'action="/signup"'), 0, 'sign-in mode never posts to /signup');
    assert.equal(occurrences(signinHtml, 'name="displayName"'), 0, 'sign-in mode has no Name field');

    const signup = await fetch(`${base}/signin?mode=signup`);
    assert.equal(signup.status, 200);
    const signupHtml = await signup.text();
    assert.equal(stateOf(signupHtml), 'S1-DEFAULT-SIGNUP');
    assert.equal(occurrences(signupHtml, 'action="/signup"'), 1, 'sign-up mode posts to /signup, exactly once');
    assert.equal(occurrences(signupHtml, 'name="displayName"'), 1, 'sign-up mode has exactly one Name field');

    // The mode switch is a BUTTON in a GET form, not an anchor — an anchor that
    // preserved `next` would need it in a URL position, which P2a forbids.
    assert.ok(signinHtml.includes('<form method="get" action="/signin"'), 'the mode switch is a GET form');
    assert.ok(signinHtml.includes('name="mode" value="signup"'), 'sign-in offers the switch to sign-up');
    assert.ok(signupHtml.includes('name="mode" value="signin"'), 'and back again');
  });
});

test('S1-ERROR-VALIDATION re-renders every non-sensitive submitted value and marks the failing field', async () => {
  await withServer(configFor(), async (base) => {
    // 'ada@example' is the wireframe's illustration but lib/auth/accounts.js
    // ACCEPTS it (a dotless domain is legal), so this uses a spelling the server
    // really rejects — measured, not assumed.
    const res = await postForm(`${base}/signup`, { displayName: NAME, email: 'ada-at-example', password: PASSWORD });
    assert.equal(res.status, 400);
    const html = await res.text();
    assert.equal(stateOf(html), 'S1-ERROR-VALIDATION');
    // 00-flows.md Flow 6: every non-sensitive submitted value survives.
    assert.ok(html.includes(`value="${NAME}"`), 'the submitted name survives');
    assert.ok(html.includes('value="ada-at-example"'), 'the submitted email survives');
    assert.ok(html.includes('Enter a complete email address.'), 'the field carries its own error text');
    assert.ok(html.includes('class="field field--invalid"'), 'and the field is marked');
    assert.ok(html.includes('1 field needs attention'), 'the banner counts what the page actually marked');
  });
});

test('S1-ERROR-VALIDATION marks EVERY blank field, and the banner agrees with the count', async () => {
  await withServer(configFor(), async (base) => {
    // Two blanks: `missing-field` carries no field name, so the count is derived
    // in the handler from the submitted body, never by parsing a message.
    const res = await postForm(`${base}/signup`, { displayName: '', email: '', password: PASSWORD });
    assert.equal(res.status, 400);
    const html = await res.text();
    assert.equal(stateOf(html), 'S1-ERROR-VALIDATION');
    assert.ok(html.includes('2 fields need attention'), 'plural, and the number is what was marked');
    assert.equal(occurrences(html, 'class="field field--invalid"'), 2, 'exactly two fields are marked');
  });
});

test('S1-ERROR-SYSTEM renders both of its triggers, and the sign-in variant names neither cause', async () => {
  await withServer(configFor(), async (base) => {
    await postForm(`${base}/signup`, { displayName: NAME, email: EMAIL, password: PASSWORD });

    // Sign-up: the conflict is named plainly, in sign-up mode.
    const taken = await postForm(`${base}/signup`, { displayName: 'Someone Else', email: EMAIL, password: PASSWORD });
    assert.equal(taken.status, 409);
    const takenHtml = await taken.text();
    assert.equal(stateOf(takenHtml), 'S1-ERROR-SYSTEM');
    assert.ok(takenHtml.includes('An account already exists for '), 'the conflict is named');
    assert.ok(takenHtml.includes(`<strong>${EMAIL}</strong>`), 'and it names the address');
    assert.equal(occurrences(takenHtml, 'action="/signup"'), 1, 're-rendered in the mode that failed');

    // Sign-in: ONE message for "no such account" and "wrong password" alike.
    const wrong = await postForm(`${base}/signin`, { email: EMAIL, password: 'not the password' });
    assert.equal(wrong.status, 401);
    const wrongHtml = await wrong.text();
    assert.equal(stateOf(wrongHtml), 'S1-ERROR-SYSTEM');
    assert.ok(wrongHtml.includes('Email or password is incorrect.'), 'the deliberately generic message');
    assert.equal(occurrences(wrongHtml, 'action="/signup"'), 0, 're-rendered in sign-in mode');
    // Never the error class, never the step, never a message from an exception.
    assert.equal(occurrences(wrongHtml, 'AuthError'), 0, 'the error class is not copy');
    assert.equal(occurrences(wrongHtml, 'invalid-credentials'), 0, 'neither is the step');
  });
});

test('a value containing markup is rendered as text, not as markup', async () => {
  // THE DYNAMIC HALF of the escaping guarantee. The lexical half — no template
  // contains a raw-output path at all — is dependency-policy.test.js's P1 row.
  // This drives a real request whose user-controlled value IS markup and counts
  // occurrences in the served bytes: the escaped form exactly once, the raw
  // form exactly zero times. A boolean `includes` would pass on a body that
  // carried both.
  await withServer(configFor(), async (base) => {
    const res = await postForm(`${base}/signup`, {
      displayName: 'ASC45MARK"><b>x</b>',
      email: 'not-an-email',
      password: PASSWORD,
    });
    assert.equal(res.status, 400);
    const html = await res.text();
    assert.equal(stateOf(html), 'S1-ERROR-VALIDATION', 'the page really did re-render the submitted value');
    assert.equal(occurrences(html, 'ASC45MARK&#34;&gt;&lt;b&gt;'), 1, 'the value is present, escaped');
    assert.equal(occurrences(html, 'ASC45MARK"><b>'), 0, 'and the raw form appears nowhere');
    assert.equal(occurrences(html, '<b>x</b>'), 0, 'no element was created from the submitted value');
  });
});

test('the submitted password is never re-rendered, on either mode, on any failure', async () => {
  // AC 5, and the single most important line in the template. The marker is
  // password-shaped and unique, so its presence anywhere in a body is a
  // failure; the password input is separately asserted to carry no value= at
  // all, because an empty value= plus a future edit is how this regresses.
  const marker = 'Zq7-AS45-PASSWORD-MARKER-9x';
  await withServer(configFor(), async (base) => {
    await postForm(`${base}/signup`, { displayName: NAME, email: EMAIL, password: marker });
    const bodies = [
      await (await postForm(`${base}/signup`, { displayName: NAME, email: 'bad', password: marker })).text(),
      await (await postForm(`${base}/signup`, { displayName: NAME, email: EMAIL, password: marker })).text(),
      await (await postForm(`${base}/signup`, { displayName: '', email: '', password: marker })).text(),
      await (await postForm(`${base}/signin`, { email: EMAIL, password: marker + 'x' })).text(),
      await (await postForm(`${base}/signin`, { email: 'nobody@example.test', password: marker })).text(),
      await (await fetch(`${base}/signin`)).text(),
      await (await fetch(`${base}/signin?mode=signup`)).text(),
    ];
    assert.equal(bodies.length, 7, 'cardinality first: the committed list of bodies examined');
    for (const html of bodies) {
      assert.equal(occurrences(html, marker), 0, 'the submitted password reached the page');
      // Every password input, in every branch, with no value= anywhere in it.
      const inputs = html.match(/<input[^>]*type="password"[^>]*>/g) ?? [];
      assert.equal(inputs.length, 1, `expected exactly one password input, found ${inputs.length}`);
      assert.equal(occurrences(inputs[0], 'value='), 0, `the password input carries a value: ${inputs[0]}`);
    }
  });
});

test('S1-ABANDON: two successive GET /signin return byte-identical bodies — there is no resumed draft', async () => {
  await withServer(configFor(), async (base) => {
    const first = await (await fetch(`${base}/signin`)).text();
    const second = await (await fetch(`${base}/signin`)).text();
    assert.equal(first, second, 'nothing is created server-side until a submit succeeds');
    assert.equal(stateOf(first), 'S1-DEFAULT-SIGNIN');
  });
});

test('S1-DENIED-AUTHENTICATED: a signed-in caller is redirected and no form renders', async () => {
  await withServer(configFor(), async (base, app, deps) => {
    const { cookie } = seedSignedIn(deps.repos);
    const res = await fetch(`${base}/signin`, { redirect: 'manual', headers: { cookie } });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/', 'POST_SIGNIN_LANDING — whose terminus is asserted separately, below');
    const body = await res.text();
    assert.equal(stateOf(body), null, 'the redirect happens BEFORE any markup is served');
    assert.equal(occurrences(body, '<form'), 0, 'no form renders');

    // A signed-in caller carrying a safe `next` lands where they were going.
    const withNext = await fetch(`${base}/signin?next=%2Finvoices%2Fabc`, { redirect: 'manual', headers: { cookie } });
    assert.equal(withNext.headers.get('location'), '/invoices/abc');
    // A hostile `next` is discarded by the SAME safeNext the POST handlers use.
    const hostile = await fetch(`${base}/signin?next=https%3A%2F%2Fevil.test`, { redirect: 'manual', headers: { cookie } });
    assert.equal(hostile.headers.get('location'), '/', 'no open redirect through the screen route');
  });
});

test('S1-EMPTY renders no section: the screen has no collection, and shows none', async () => {
  // The ledger's own "n/a — because" row, asserted rather than assumed. A
  // credentials form has nothing to list, so a list, a table or an empty-state
  // block appearing here would be scope nobody asked for.
  await withServer(configFor(), async (base) => {
    const html = await (await fetch(`${base}/signin`)).text();
    // Matched with a delimiter, not as a bare prefix: '<li' is also the first
    // three characters of '<link', which this page legitimately has two of.
    for (const tag of ['table', 'ul', 'ol', 'li']) {
      const found = html.match(new RegExp(`<${tag}[\\s>]`, 'g')) ?? [];
      assert.deepEqual(found, [], `screen 1 renders no <${tag}> — it has no collection`);
    }
  });
});

test('a cookieless request for a guarded route lands on screen 1 carrying next in a hidden input', async () => {
  // 00-flows.md Flow 4, end to end: the guard supplies ?next=, the screen puts
  // it in a HIDDEN INPUT and never in a URL, and the page says why the
  // freelancer is here.
  await withServer(configFor(), async (base) => {
    const guarded = await fetch(`${base}/`, { redirect: 'manual' });
    assert.equal(guarded.status, 303);
    const location = guarded.headers.get('location');
    assert.equal(location, '/signin?next=%2F');

    const html = await (await fetch(`${base}${location}`)).text();
    assert.equal(stateOf(html), 'S1-DEFAULT-SIGNIN', 'sign-in mode, per Flow 4 step 2');
    assert.ok(html.includes('<input type="hidden" name="next" value="/" />'), 'next travels in a hidden input');
    assert.ok(html.includes('Sign in to continue.'), 'a one-line reason, not a bare bounce');
    // And nowhere else: never in an href, never as visible text of its own.
    assert.equal(occurrences(html, 'href="/"'), 0, 'next never reaches a URL position');
  });
});

// =============================================================================
// Terminal states: where a person actually ends up (review cycle 1, AC 20a)
// =============================================================================
//
// A Location header is a STEP, not an outcome. Cycle 1 asserted the first hop
// out of `/` and stopped, and the journey ended on a 404 for every one of the
// screen's three success paths while twenty-seven of twenty-seven criteria
// passed. followToTerminus (test/helpers/server.js) is the ONE shared
// chain-follower these cases and auth.test.js's two share.

test('a signed-in GET /signin lands on a page that exists', async () => {
  // S1-DENIED-AUTHENTICATED, followed to the end. The redirect itself is
  // asserted above; this asserts the destination: `/signin` -> `/` ->
  // `/connect-stripe`, two hops, ending on screen 2's no-row state (seedSignedIn
  // creates no connected account).
  await withServer(configFor(), async (base, app, deps) => {
    const { cookie } = seedSignedIn(deps.repos);
    const res = await fetch(`${base}/signin`, { redirect: 'manual', headers: { cookie } });
    const end = await followToTerminus(base, res, { cookie });
    assert.equal(end.hops, 2, `committed hop count: the chain was ${end.chain.join(' , ')}`);
    assert.equal(end.status, 200, `terminal status ${end.status} at ${end.path} — never a 3xx, never a 404`);
    assert.equal(end.path, '/connect-stripe');
    assert.equal(occurrences(end.body, 'data-state="S2-DEFAULT-NOTSTARTED"'), 1);
  });
});

test('GET / redirects a signed-in caller to the Connect screen, and renders nothing itself', async () => {
  // THE REDIRECT AS-45's REVIEW CYCLE 1 PROMISED, restored by AS-70 now that
  // `/connect-stripe` exists (plan §3.5). `/` is a hop, not a page: no template,
  // no data-state, no markup — so it stays outside the view layer's escaping
  // surface, and AS-48 replaces one line when the Dashboard lands.
  await withServer(configFor(), async (base, app, deps) => {
    const { cookie } = seedSignedIn(deps.repos);
    const res = await fetch(`${base}/`, { redirect: 'manual', headers: { cookie } });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/connect-stripe');
    const body = await res.text();
    assert.equal(occurrences(body, 'data-state'), 0, 'a redirect stamps no state — it has no ledger row');
    assert.equal(stateOf(body), null);
    // No template was rendered: an EJS render of any view in this app produces
    // a document, and every one of them opens with `<`.
    assert.equal(occurrences(body, '<'), 0, 'no markup at all, so no template was rendered');
  });
});

// =============================================================================
// Screen 2 — Connect Stripe (AS-70). The ledger, transcribed.
// =============================================================================

/** docs/design/wireframes/02-states-ledger.md §2, all nine rows, in the
 *  document's own order. Transcribed BY HAND on purpose, and INDEPENDENTLY of
 *  lib/screens/connect-view.js's copy: the two are compared against each other,
 *  so an edit to one alone is red. Drift detection between two transcriptions,
 *  not a read of the design document (file header). S2-ABANDON's disposition
 *  is `path-into-render`, not `rendered`: the ledger's prose names a render it
 *  re-enters, and which one is decided by the stored row (the view model's
 *  header says why it is NOTREADY rather than the prose's NOTSTARTED). */
const SCREEN_2_LEDGER = [
  ['S2-DEFAULT-NOTSTARTED', 'rendered'],
  ['S2-RETURN-READY', 'rendered'],
  ['S2-LOADING', 'unrenderable — browser-supplied'],
  ['S2-EMPTY', 'n/a'],
  ['S2-ERROR-SYSTEM', 'rendered'],
  ['S2-RETURN-NOTREADY', 'rendered'],
  ['S2-DENIED-SIGNEDOUT', 'redirect-answered'],
  ['S2-REFRESH', 'redirect-answered'],
  ['S2-ABANDON', 'path-into-render'],
];

/** The connected-account row every screen-2 case seeds, in the shape AS-41's
 *  own tests use: `create` then `updateReadiness` with ALL SIX readiness keys,
 *  because a partial patch is refused by the repository. `ready` is derived by
 *  the repository's mapper and nowhere else; these helpers only choose inputs. */
const ACCT = 'acct_screen2marker';
const SYNCED_AT = '2026-09-12T10:00:00.000Z';
const readiness = ({ chargesEnabled, requirementsCurrentlyDue }) => ({
  chargesEnabled,
  detailsSubmitted: true,
  payoutsEnabled: chargesEnabled,
  requirementsCurrentlyDue,
  requirementsDisabledReason: requirementsCurrentlyDue.length === 0 ? null : 'requirements.past_due',
  syncedAt: SYNCED_AT,
});
const seedAccount = (repos, freelancerId, flags) => {
  repos.connectedAccounts.create({ freelancerId, stripeAccountId: ACCT });
  return repos.connectedAccounts.updateReadiness(ACCT, readiness(flags));
};
const getScreen = (base, cookie, query = '') => fetch(`${base}/connect-stripe${query}`, { redirect: 'manual', headers: { cookie } });

test('screen 2 accounts for all nine of its ledger rows, and exactly four of them render', () => {
  // Cardinality FIRST, against the committed number — never `> 0`.
  assert.equal(SCREEN_2_LEDGER.length, 9, 'the ledger table transcribed here has nine rows');
  assert.equal(CONNECT_LEDGER.length, 9, `the view model accounts for ${CONNECT_LEDGER.length} rows, expected 9`);

  // Exact set equality in both directions, id AND disposition.
  const declared = CONNECT_LEDGER.map((row) => [row.id, row.disposition]).sort();
  assert.deepEqual(declared, [...SCREEN_2_LEDGER].sort());

  // S2-LOADING is NOT a gap: "Redirecting to Stripe…" is a state a page enters
  // AFTER its bytes were served, and this app has no client-side JavaScript to
  // produce it (dependency-policy's P2c row keeps it that way).
  const unrenderable = CONNECT_LEDGER.filter((row) => row.disposition === 'unrenderable — browser-supplied');
  assert.deepEqual(unrenderable.map((row) => row.id), ['S2-LOADING']);

  assert.equal(CONNECT_STATES.length, 4, `${CONNECT_STATES.length} rendered states, expected 4`);
  assert.deepEqual([...CONNECT_STATES].sort(), ['S2-DEFAULT-NOTSTARTED', 'S2-ERROR-SYSTEM', 'S2-RETURN-NOTREADY', 'S2-RETURN-READY']);
  assert.ok(Object.isFrozen(CONNECT_STATES) && Object.isFrozen(CONNECT_LEDGER), 'both lists are frozen');
});

test("screen 2's nine ledger rows partition 4 + 2 + 1 + 1 + 1", () => {
  // THE PARTITION IS ARITHMETIC AGAINST A COMMITTED TABLE (AS-45 plan §3.5.2,
  // AC 12), computed over the view model's dispositions so a disposition edit
  // on either transcription is red here as well as in the set comparison.
  const count = (disposition) => CONNECT_LEDGER.filter((row) => row.disposition === disposition).length;
  const partition = {
    rendered: count('rendered'),
    'redirect-answered': count('redirect-answered'),
    'path-into-render': count('path-into-render'),
    'unrenderable — browser-supplied': count('unrenderable — browser-supplied'),
    'n/a': count('n/a'),
  };
  assert.deepEqual(partition, {
    rendered: 4,
    'redirect-answered': 2,
    'path-into-render': 1,
    'unrenderable — browser-supplied': 1,
    'n/a': 1,
  });
  assert.equal(4 + 2 + 1 + 1 + 1, 9);
  assert.equal(Object.values(partition).reduce((a, b) => a + b, 0), CONNECT_LEDGER.length, 'the five dispositions cover every row with nothing left over');

  // AND THE TABLE IS NOT DECORATIVE: each rendered state owns exactly one
  // DISTINCTIVE MARKER in the template source (plan §3.3). The template does
  // not branch on state ids — the locals carry the copy — so the marker is the
  // markup only that state produces: a constant banner class per tone, and the
  // lede branch for the one state that has no banner. Deleting a branch moves a
  // count from 1 to 0 here. A claim about the template's SHAPE, not its copy,
  // so a wording change does not break it.
  const source = readFileSync(join(configFor().viewsDir, 'connect-stripe.ejs'), 'utf8');
  const markers = [
    ['S2-RETURN-READY', 'banner-success'],
    ['S2-RETURN-NOTREADY', 'banner-warning'],
    ['S2-ERROR-SYSTEM', 'banner-error'],
    ['S2-DEFAULT-NOTSTARTED', 'if (lede !== null)'],
  ];
  assert.equal(markers.length, 4, 'cardinality first: one marker row per rendered state');
  assert.deepEqual(markers.map(([state]) => state).sort(), [...CONNECT_STATES].sort(), 'every rendered state has a marker row, and no other state does');
  for (const [state, marker] of markers) {
    assert.equal(occurrences(source, marker), 1, `${state}'s distinctive marker "${marker}" occurs ${occurrences(source, marker)} time(s) in the template, expected exactly 1`);
  }
});

/** Every value reachable from a locals object, so "no local equals X" is a
 *  claim about the whole tree and not about the top level. */
const leaves = (value) => (value !== null && typeof value === 'object' ? Object.values(value).flatMap(leaves) : [value]);

test('the Connect view model is a total function of the row and the error flag, and the flag is a boolean', () => {
  // THE 12-CELL TABLE (plan §3.2): three row shapes x four flag spellings. The
  // flag is true ONLY when it is literally `true` — the route passes a boolean
  // it derived from `?error=start`, and a string or an array reaching the view
  // model by mistake must select the ROW-DERIVED state, never the error.
  const rows = [
    [null, 'S2-DEFAULT-NOTSTARTED'],
    [{ ready: true }, 'S2-RETURN-READY'],
    [{ ready: false }, 'S2-RETURN-NOTREADY'],
  ];
  const flags = [
    [undefined, false],
    [true, true],
    ['start', false],
    [['start'], false],
  ];
  assert.equal(rows.length * flags.length, 12, 'cardinality first: the committed cell count');

  let examined = 0;
  for (const [account, rowState] of rows) {
    for (const [startFailed, isError] of flags) {
      const locals = connectLocals({ account, startFailed });
      const expected = isError ? 'S2-ERROR-SYSTEM' : rowState;
      assert.equal(locals.state, expected, `account=${JSON.stringify(account)} startFailed=${JSON.stringify(startFailed)} rendered ${locals.state}`);
      assert.ok(CONNECT_STATES.includes(locals.state), 'the state is always a member of the closed set');
      // The parameter's VALUE has no path into the locals, in any cell.
      assert.equal(leaves(locals).filter((leaf) => leaf === 'start').length, 0, 'a local equals the raw flag value');
      examined += 1;
    }
  }
  assert.equal(examined, 12, `examined ${examined} cells, expected 12`);

  // The error flag OUTRANKS the row, in every row state (plan §3.2's precedence).
  for (const [account] of rows) assert.equal(connectLocals({ account, startFailed: true }).state, 'S2-ERROR-SYSTEM');
  // The default input is the no-row default state — the VIEWS probe relies on it.
  assert.equal(connectLocals().state, 'S2-DEFAULT-NOTSTARTED');
  // The locals carry the state, not the row: no key that could hold an id or a timestamp.
  assert.deepEqual(Object.keys(connectLocals({ account: { ready: true, id: 'x', stripeAccountId: ACCT } })).sort(), ['action', 'banner', 'lede', 'state', 'title']);
});

// =============================================================================
// Screen 2 over HTTP
// =============================================================================

test('S2-DEFAULT-NOTSTARTED renders for a signed-in freelancer with no connected account', async () => {
  await withServer(configFor(), async (base, app, deps) => {
    const { cookie } = seedSignedIn(deps.repos);
    const res = await getScreen(base, cookie);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const html = await res.text();
    assert.equal(occurrences(html, 'data-state="S2-DEFAULT-NOTSTARTED"'), 1);
    assert.equal(occurrences(html, 'action="/connect-stripe/start"'), 1, 'the one control posts to start, exactly once');
    assert.equal(occurrences(html, 'Connect with Stripe'), 1);
    // The lede is present. Asserted on the halves AROUND the substituted noun,
    // deliberately: which noun the sentence uses is the dependency-policy
    // suite's `money representation` row's claim (AS-70 plan §5 and recipe
    // F7), and this case must stay green when that row goes red — two cases
    // asserting the same copy would make one of them decorative.
    assert.equal(occurrences(html, 'We never hold or move your clients&#39; '), 1, 'the lede sentence, escaped apostrophe and all');
    assert.equal(occurrences(html, ' — Stripe pays you directly.'), 1);
    assert.equal(occurrences(html, 'class="banner'), 0, 'the default state carries no banner');
  });
});

test('S2-RETURN-NOTREADY renders when charges are disabled', async () => {
  // HALF ONE of `ready` (AS-45 plan AC 13): charges off, nothing due.
  await withServer(configFor(), async (base, app, deps) => {
    const { cookie, freelancer } = seedSignedIn(deps.repos);
    const row = seedAccount(deps.repos, freelancer.id, { chargesEnabled: false, requirementsCurrentlyDue: [] });
    assert.equal(row.ready, false, 'the repository derives not-ready from this input');
    const res = await getScreen(base, cookie);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.equal(occurrences(html, 'data-state="S2-RETURN-NOTREADY"'), 1);
    assert.equal(occurrences(html, 'banner-warning'), 1);
    assert.equal(occurrences(html, 'Finish setup on Stripe'), 1);
    assert.equal(occurrences(html, 'action="/connect-stripe/start"'), 1, 'the control re-enters the hosted flow through start');
  });
});

test('S2-RETURN-NOTREADY renders when charges are enabled but requirements are still due', async () => {
  // HALF TWO of `ready`: charges on, something still due — the C-11 gate.
  await withServer(configFor(), async (base, app, deps) => {
    const { cookie, freelancer } = seedSignedIn(deps.repos);
    const row = seedAccount(deps.repos, freelancer.id, { chargesEnabled: true, requirementsCurrentlyDue: ['external_account'] });
    assert.equal(row.ready, false, 'the repository derives not-ready from this input');
    const res = await getScreen(base, cookie);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.equal(occurrences(html, 'data-state="S2-RETURN-NOTREADY"'), 1);
    assert.equal(occurrences(html, 'banner-warning'), 1);
    assert.equal(occurrences(html, 'Finish setup on Stripe'), 1);
  });
});

test('S2-RETURN-READY renders for a ready row, and the screen reads ready rather than re-deriving it', async () => {
  await withServer(configFor(), async (base, app, deps) => {
    const { cookie, freelancer } = seedSignedIn(deps.repos);
    const row = seedAccount(deps.repos, freelancer.id, { chargesEnabled: true, requirementsCurrentlyDue: [] });
    assert.equal(row.ready, true, 'the repository derives ready from this input');
    const res = await getScreen(base, cookie);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.equal(occurrences(html, 'data-state="S2-RETURN-READY"'), 1);
    assert.equal(occurrences(html, 'banner-success'), 1);
    // AC 9: NO CONTROL until the Dashboard exists (plan §3.4). A link to `/`
    // would land here again; any other target 404s. AS-48 adds the anchor.
    assert.equal(occurrences(html, '<form'), 0, 'READY renders no form');
    assert.equal(occurrences(html, '<a '), 0, 'READY renders no anchor');
    assert.equal(occurrences(html, 'Continue to Dashboard'), 0);
  });

  // THE UNIT HALF, and the reason it exists: on a real row the repository's
  // `ready` and a re-derivation from its inputs always agree, so an HTTP case
  // cannot tell them apart. This object lies — ready says yes, the inputs say
  // no — and the view model must believe `ready`, the one place it is derived.
  const contradictory = connectLocals({ account: { ready: true, chargesEnabled: false, requirementsCurrentlyDue: ['x'] } });
  assert.equal(contradictory.state, 'S2-RETURN-READY', 'the view model re-derived ready from the inputs instead of reading it');
  const reverse = connectLocals({ account: { ready: false, chargesEnabled: true, requirementsCurrentlyDue: [] } });
  assert.equal(reverse.state, 'S2-RETURN-NOTREADY');
});

test('the Connect screen makes no Stripe call, writes nothing, and never renders the account id', async () => {
  // AS-41's rule, asserted from the screen's side: a page view is NOT a sync
  // moment. The transport COUNTS and THROWS, so a call from the handler is both
  // visible and loud; the row's updatedAt is compared byte-for-byte across two
  // views; and the seeded acct_ id must appear in no rendered state — the page
  // renders the STATE, not the row.
  let calls = 0;
  const stripe = createStripeClient({
    apiKey: 'unit-test-placeholder-key',
    transport: async () => { calls += 1; throw new Error('the Connect screen reached the Stripe transport'); },
  });
  await withServer(configFor(), async (base, app, deps) => {
    const withRow = seedSignedIn(deps.repos, { email: 'row@example.test' });
    const without = seedSignedIn(deps.repos, { email: 'norow@example.test' });
    // Not-ready FIRST: this is the row state in which a refresh or a start would
    // mint a link, so it is the state where a stray Stripe call is reachable.
    const before = seedAccount(deps.repos, withRow.freelancer.id, { chargesEnabled: false, requirementsCurrentlyDue: ['external_account'] });
    const bodies = [];
    bodies.push(await (await getScreen(base, withRow.cookie)).text());
    bodies.push(await (await getScreen(base, withRow.cookie)).text());
    const after = deps.repos.connectedAccounts.getByFreelancer(withRow.freelancer.id);
    assert.equal(after.updatedAt, before.updatedAt, 'viewing the screen wrote to the row');
    assert.equal(after.syncedAt, before.syncedAt, 'viewing the screen re-synced readiness');
    deps.repos.connectedAccounts.updateReadiness(ACCT, readiness({ chargesEnabled: true, requirementsCurrentlyDue: [] }));
    bodies.push(await (await getScreen(base, withRow.cookie)).text());
    bodies.push(await (await getScreen(base, without.cookie)).text());
    bodies.push(await (await getScreen(base, withRow.cookie, '?error=start')).text());
    bodies.push(await (await getScreen(base, without.cookie, '?error=start')).text());

    assert.equal(bodies.length, 6, 'cardinality first: the committed list of bodies examined');
    const states = new Set(bodies.map(stateOf));
    assert.deepEqual([...states].sort(), [...CONNECT_STATES].sort(), 'every rendered state was examined');
    for (const html of bodies) {
      assert.equal(occurrences(html, ACCT), 0, 'the seeded account id reached the page');
      assert.equal(occurrences(html, 'acct_'), 0, 'an acct_ prefix reached the page');
      assert.equal(occurrences(html, SYNCED_AT), 0, 'a row timestamp reached the page');
    }
    assert.equal(calls, 0, `the screen made ${calls} Stripe transport call(s); a page view is not a sync moment`);
  }, { stripe });
});

test('S2-ERROR-SYSTEM renders at ?error=start, and the parameter value never reaches the page', async () => {
  // The documented URL (AS-45 plan §3.5.3). The parameter is a PRESENCE FLAG:
  // the route turns it into a boolean, so the view model never sees the value.
  await withServer(configFor(), async (base, app, deps) => {
    const without = seedSignedIn(deps.repos, { email: 'norow@example.test' });
    const withRow = seedSignedIn(deps.repos, { email: 'row@example.test' });
    seedAccount(deps.repos, withRow.freelancer.id, { chargesEnabled: false, requirementsCurrentlyDue: [] });

    for (const { cookie } of [without, withRow]) {
      const res = await getScreen(base, cookie, '?error=start');
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.equal(occurrences(html, 'data-state="S2-ERROR-SYSTEM"'), 1, 'the error outranks the row, with and without one');
      assert.equal(occurrences(html, 'banner-error'), 1);
      assert.equal(occurrences(html, 'Try again'), 1);
      assert.equal(occurrences(html, 'action="/connect-stripe/start"'), 1, 'try again posts to start');
    }

    // A value that is not `start` selects NOTHING — the row-derived state
    // renders — and the value itself is nowhere in the body, escaped or raw.
    // The marker's letters are the same in both forms, so one count covers both.
    const marker = 'ASC70MARK"><b>';
    const probe = await getScreen(base, without.cookie, `?error=${encodeURIComponent(marker)}`);
    assert.equal(probe.status, 200);
    const html = await probe.text();
    assert.equal(stateOf(html), 'S2-DEFAULT-NOTSTARTED', 'an unknown value is not the error state');
    assert.equal(occurrences(html, 'ASC70MARK'), 0, 'the parameter value reached the page');
    assert.equal(occurrences(html, '<b>'), 0);
    // The closed enum is case-sensitive and scalar: neither of these is `start`.
    for (const query of ['?error=START', '?error[]=start', '?error=start&error=start']) {
      const other = await getScreen(base, without.cookie, query);
      assert.equal(stateOf(await other.text()), 'S2-DEFAULT-NOTSTARTED', `${query} selected the error state`);
    }
  });
});

test('S2-DENIED-SIGNEDOUT: a cookieless GET /connect-stripe is answered by the guard and lands on screen 1 carrying next', async () => {
  // Protected by POSITION — the connect router is mounted below the auth
  // boundary — so the guard answers before the handler exists to the request.
  // Its answer is the guard's own shape (auth.test.js G3 attributes it): 303,
  // Location with ?next=, and NO Set-Cookie.
  await withServer(configFor(), async (base) => {
    const denied = await fetch(`${base}/connect-stripe`, { redirect: 'manual' });
    assert.equal(denied.status, 303);
    assert.equal(denied.headers.get('location'), '/signin?next=%2Fconnect-stripe');
    assert.equal(denied.headers.getSetCookie().length, 0, 'the guard sets no cookie');
    assert.equal(stateOf(await denied.text()), null, 'nothing rendered before the redirect');

    const html = await (await fetch(`${base}${denied.headers.get('location')}`)).text();
    assert.equal(stateOf(html), 'S1-DEFAULT-SIGNIN', 'sign-in mode, per Flow 4 step 2');
    assert.ok(html.includes('<input type="hidden" name="next" value="/connect-stripe" />'), 'next travels in a hidden input');
    assert.equal(occurrences(html, 'href="/connect-stripe"'), 0, 'and never in a URL position');
  });
});

test('S2-REFRESH and S2-LOADING never render this screen', async () => {
  // S2-REFRESH is `redirect-answered`: routes/connect.js's refresh handler
  // 303s into a fresh Stripe link (connect.test.js 'R9: refresh mints a fresh
  // link for the stored account and writes no readiness; no row is 404',
  // 'R9b: refresh for an already-ready row short-circuits to the screen — no
  // code path mints a link for a ready account (§9 Q1)', and stripe-mock's
  // 'M3: refresh against stripe-mock — 303 back into the hosted flow, no
  // readiness write'). This suite adds NO Stripe case and must not duplicate
  // one; it asserts the NEGATIVE half only — whatever refresh answers offline
  // with no key, it is not this screen's markup.
  // S2-LOADING is `unrenderable — browser-supplied`: it needs client-side
  // JavaScript, which P2c forbids.
  assert.equal(CONNECT_LEDGER.find((row) => row.id === 'S2-REFRESH').disposition, 'redirect-answered');
  assert.equal(CONNECT_LEDGER.find((row) => row.id === 'S2-LOADING').disposition, 'unrenderable — browser-supplied');
  assert.equal(CONNECT_STATES.includes('S2-REFRESH') || CONNECT_STATES.includes('S2-LOADING'), false, 'neither is a rendered state');

  await withServer(configFor(), async (base, app, deps) => {
    const { cookie, freelancer } = seedSignedIn(deps.repos);
    seedAccount(deps.repos, freelancer.id, { chargesEnabled: false, requirementsCurrentlyDue: ['external_account'] });
    const res = await fetch(`${base}/connect-stripe/refresh`, { redirect: 'manual', headers: { cookie } });
    const body = await res.text();
    assert.notEqual(res.status, 200, `refresh answered 200 — it never serves a page of its own (got ${res.status})`);
    assert.doesNotMatch(res.headers.get('content-type') ?? '', /text\/html/, 'refresh serves no HTML');
    assert.equal(occurrences(body, 'data-state'), 0, 'refresh stamps no state');
    assert.equal(stateOf(body), null);
  });
});

test('S2-ABANDON: returning directly after an abandoned onboarding renders the stored row, unchanged', async () => {
  // A PATH INTO A RENDER, not a fourth render (view model header). After start
  // created the row and the freelancer closed the tab, a direct return finds a
  // row that exists and is not ready; two views are byte-identical because
  // viewing creates nothing and changes nothing.
  await withServer(configFor(), async (base, app, deps) => {
    const { cookie, freelancer } = seedSignedIn(deps.repos);
    seedAccount(deps.repos, freelancer.id, { chargesEnabled: false, requirementsCurrentlyDue: ['individual.verification.document'] });
    const first = await (await getScreen(base, cookie)).text();
    const second = await (await getScreen(base, cookie)).text();
    assert.equal(first, second, 'nothing is created or changed server-side by viewing');
    assert.equal(stateOf(first), 'S2-RETURN-NOTREADY', 'the honest render for a half-built account: finish setup, not start over');
    assert.equal(CONNECT_LEDGER.find((row) => row.id === 'S2-ABANDON').disposition, 'path-into-render');
  });
});

test('S2-EMPTY renders no section: the screen has no collection, and shows none', async () => {
  // The ledger's own "n/a — because" row, asserted rather than assumed, in
  // every rendered state (a single-status screen has nothing to list).
  await withServer(configFor(), async (base, app, deps) => {
    const { cookie, freelancer } = seedSignedIn(deps.repos);
    const bodies = [await (await getScreen(base, cookie)).text(), await (await getScreen(base, cookie, '?error=start')).text()];
    seedAccount(deps.repos, freelancer.id, { chargesEnabled: false, requirementsCurrentlyDue: [] });
    bodies.push(await (await getScreen(base, cookie)).text());
    deps.repos.connectedAccounts.updateReadiness(ACCT, readiness({ chargesEnabled: true, requirementsCurrentlyDue: [] }));
    bodies.push(await (await getScreen(base, cookie)).text());
    assert.deepEqual(bodies.map(stateOf).sort(), [...CONNECT_STATES].sort(), 'all four rendered states examined');
    for (const html of bodies) {
      // Delimited, not a bare prefix: '<li' is the start of '<link'.
      for (const tag of ['table', 'ul', 'ol', 'li']) {
        const found = html.match(new RegExp(`<${tag}[\\s>]`, 'g')) ?? [];
        assert.deepEqual(found, [], `${stateOf(html)} renders no <${tag}> — it has no collection`);
      }
    }
  });
});

// =============================================================================
// The view layer's shared properties
// =============================================================================

test('every registered template carries the viewport meta and links both stylesheets', async () => {
  // This is what replaces a shared <head> partial. A partial would be raw
  // output (P1); this assertion catches everything the partial protected
  // against AND the case a partial cannot — one that stopped being included.
  const config = configFor();
  assert.ok(VIEWS.length > 0, 'the check is not examining an empty registry');
  for (const view of VIEWS) {
    const source = readFileSync(join(config.viewsDir, view.file), 'utf8');
    assert.ok(
      source.includes('<meta name="viewport" content="width=device-width, initial-scale=1" />'),
      `${view.file} has no viewport meta — without it mobile Safari renders at 980px and every other responsive check is theatre`,
    );
    assert.ok(source.includes('<link rel="stylesheet" href="/tokens.css" />'), `${view.file} does not link the vendored tokens`);
    assert.ok(source.includes('<link rel="stylesheet" href="/app.css" />'), `${view.file} does not link the app stylesheet`);
    assert.ok(source.includes('<html lang="en" data-state="'), `${view.file} does not stamp data-state on its root element`);
  }
});

test('app.css is mobile-first: every media condition is min-width, and none is below 480px', async () => {
  // The MECHANICAL half of "renders sensibly at 375px" (plan §3.7), and it is
  // stated as what it does and does not establish. Zero max-width conditions
  // plus a smallest min-width of 480 means the base ruleset IS the ruleset at
  // 375px, with margin on both sides — by construction, not by inspection.
  //
  // It does NOT establish that the result is legible, that tap targets are
  // reachable, or that a long unbroken string wraps. Those need eyes on pixels
  // and there is no browser in this suite; they are recorded in this task's
  // Lattice comment instead.
  const config = configFor();
  const css = readFileSync(join(config.publicDir, 'app.css'), 'utf8');
  // Preludes are selected LINE-WISE, so a prelude wrapped across two lines is
  // invisible to this and to the breakpoint carve-out in assets.test.js alike.
  // app.css has none today; both checks would need a real tokenizer to be
  // immune, and neither is worth one at one stylesheet.
  const allPreludes = css.split('\n').filter((line) => /^\s*@media\b/.test(line));
  assert.ok(allPreludes.length > 0, `no media prelude found in app.css — this check is examining nothing`);

  // A media TYPE is not a width condition (AS-47, plan §3.5). The print block
  // applies to no screen viewport, so it cannot move the 375px claim either
  // way; it is partitioned out and COUNTED — exactly one, screen 7's — so a
  // second print prelude is red here and a print prelude that vanished is too.
  const printPreludes = allPreludes.filter((line) => /^\s*@media\s+print\s*\{/.test(line));
  assert.equal(printPreludes.length, 1, `expected exactly 1 @media print prelude (AS-47), found ${printPreludes.length}`);
  const preludes = allPreludes.filter((line) => !printPreludes.includes(line));
  assert.ok(preludes.length > 0, 'no width prelude remains — the width assertions below would examine nothing');

  const maxWidth = preludes.filter((line) => /max-width/.test(line));
  assert.deepEqual(maxWidth, [], `every media condition must be min-width:\n${maxWidth.join('\n')}`);

  const widths = preludes.flatMap((line) => [...line.matchAll(/min-width:\s*(\d+)px/g)].map((m) => Number(m[1])));
  assert.equal(widths.length, preludes.length, 'every prelude yielded exactly one min-width');
  assert.ok(Math.min(...widths) >= 480, `the smallest breakpoint is ${Math.min(...widths)}px — below --breakpoint-sm, so 375px would not be the base ruleset`);
});

test('no fixed-width box in app.css can force horizontal overflow at 375px', async () => {
  // max-width is excluded deliberately: it BOUNDS a box rather than forcing
  // one, and bounding is how the measure is kept readable.
  //
  // WHICH CHECK IS CARRYING THE CLAIM, said out loud (review cycle 1, B4). This
  // case policies three property names carrying a length literal, so
  // `flex: 0 0 320px`, `inline-size` and `grid-template-columns: 300px 1fr`
  // would all pass it. The property holds today because assets.test.js's TOKEN
  // check forbids every length literal in app.css outright — that check is
  // doing the work, and this one is a second, narrower statement of the same
  // thing. Recorded, not widened: the token check carries the claim outright;
  // widen this case only if a second stylesheet ever lands in public/ (every
  // screen shares app.css by design, so a screen task never trips that).
  const config = configFor();
  const css = readFileSync(join(config.publicDir, 'app.css'), 'utf8');
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const decls = [...body.matchAll(/([a-zA-Z-]+)\s*:\s*([^;{}]+);/g)];
  assert.ok(decls.length > 0, 'no declaration was examined');
  const fixed = decls
    .filter(([, property, value]) => ['width', 'min-width', 'flex-basis'].includes(property) && /\d+(px|rem|em)\b/.test(value))
    .map(([, property, value]) => `${property}: ${value}`);
  assert.deepEqual(fixed, [], `a fixed-width box can overflow a 375px viewport:\n${fixed.join('\n')}`);
});
