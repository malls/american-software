// screens.test.js — the view layer, and every state of screens 1 and 2
// (AS-45, plan §3.1, §3.4, §3.6, §3.7).
//
// THIS FILE'S ONE CLAIM: every row in docs/design/wireframes/02-states-ledger.md
// §1 and §2 is accounted for — rendered and asserted on a sentinel, answered by
// a redirect, named as a path into another render, or recorded as unrenderable
// with the reason. A state that quietly stopped rendering, or a ledger row that
// appeared or vanished, turns this red.
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
import { configFor, seedSignedIn, withServer } from './helpers/server.js';

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
 *  document's own order. Transcribed BY HAND on purpose: if the ledger gains or
 *  loses a row, this list disagrees with lib/screens/signin-view.js and the
 *  suite goes red, which is the only way a design document and an
 *  implementation stay joined without a build step reading the markdown. */
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
    assert.equal(res.headers.get('location'), '/', 'POST_SIGNIN_LANDING, which routes/pages.js sends on to screen 2');
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
  const preludes = css.split('\n').filter((line) => /^\s*@media\b/.test(line));
  assert.ok(preludes.length > 0, `no media prelude found in app.css — this check is examining nothing`);

  const maxWidth = preludes.filter((line) => /max-width/.test(line));
  assert.deepEqual(maxWidth, [], `every media condition must be min-width:\n${maxWidth.join('\n')}`);

  const widths = preludes.flatMap((line) => [...line.matchAll(/min-width:\s*(\d+)px/g)].map((m) => Number(m[1])));
  assert.equal(widths.length, preludes.length, 'every prelude yielded exactly one min-width');
  assert.ok(Math.min(...widths) >= 480, `the smallest breakpoint is ${Math.min(...widths)}px — below --breakpoint-sm, so 375px would not be the base ruleset`);
});

test('no fixed-width box in app.css can force horizontal overflow at 375px', async () => {
  // max-width is excluded deliberately: it BOUNDS a box rather than forcing
  // one, and bounding is how the measure is kept readable.
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
