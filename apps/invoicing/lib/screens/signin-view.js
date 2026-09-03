// lib/screens/signin-view.js — screen 1's PURE view model (AS-45, plan §3.4).
//
// A screen is a pure view model plus a presentation-only template. This file
// exports (a) the screen's ledger, transcribed from
// docs/design/wireframes/02-states-ledger.md §1, and (b) a pure function from
// route inputs to template locals. No I/O, no clock, no req, no res — so every
// state is unit-testable in microseconds, before any request is made.
//
// EVERY STRING BELOW IS A RENDERER-AUTHORED CONSTANT selected by a closed enum,
// with exactly two exceptions: the freelancer's submitted `email` and
// `displayName`, re-rendered per 00-flows.md Flow 6. Both reach the template as
// element content or a double-quoted value= and are escaped by EJS. The
// PASSWORD IS NEVER PASSED and never re-rendered, in any mode, on any error
// (Flow 6 step 2) — this module has no `password` key at all, which is the
// strongest way to say it.
//
// The error taxonomy maps on AuthError's stable `step`, NEVER on message text —
// routes/auth.js's own rule, and AuthError carries no `field`.

/** Screen 1's ledger, all eight rows, each with what this app does about it.
 *
 *  WHAT THIS TRANSCRIPTION IS JOINED TO, precisely (plan ruling R-4). This list
 *  and the table in test/screens.test.js are TWO INDEPENDENT HAND
 *  TRANSCRIPTIONS of 02-states-ledger.md §1, compared against EACH OTHER by
 *  exact set equality and cardinality. Nothing in the suite reads the design
 *  document and nothing in it can: the `test` service is mountless by design and
 *  the Dockerfile vendors exactly one file from outside the app,
 *  docs/design/tokens/tokens.css. So a row appearing or vanishing IN THE
 *  DOCUMENT does not turn the suite red — both copies would have to be
 *  hand-edited, and it is the SECOND edit the test detects. Fidelity to the
 *  document is a DATED REVIEW ACT, not a test: all eight rows checked by hand
 *  against §1 on 2026-09-03 by agent:qa-priya. Closing the join means vendoring
 *  the ledger into the image the way tokens.css already is; that is filed as
 *  its own task, triggered by AS-70's second transcription.
 *  `rendered` rows are the members of SIGNIN_STATES below; the other four are
 *  accounted for rather than silently absent (plan §3.6):
 *   - redirect-answered: the response is a 303, so no markup is produced
 *   - path-into-render: a way of ARRIVING at a rendered state, not a render
 *   - unrenderable — browser-supplied: needs client-side JavaScript, which this
 *     app has none of and does not add (plan §3.6 category 3)
 *   - n/a: the ledger's own "n/a — because" row; nothing renders, by decision */
export const SIGNIN_LEDGER = Object.freeze([
  Object.freeze({ id: 'S1-DEFAULT-SIGNIN', disposition: 'rendered' }),
  Object.freeze({ id: 'S1-DEFAULT-SIGNUP', disposition: 'rendered' }),
  Object.freeze({ id: 'S1-ERROR-VALIDATION', disposition: 'rendered' }),
  Object.freeze({ id: 'S1-ERROR-SYSTEM', disposition: 'rendered' }),
  Object.freeze({ id: 'S1-DENIED-AUTHENTICATED', disposition: 'redirect-answered' }),
  Object.freeze({ id: 'S1-ABANDON', disposition: 'path-into-render' }),
  Object.freeze({ id: 'S1-LOADING', disposition: 'unrenderable — browser-supplied' }),
  Object.freeze({ id: 'S1-EMPTY', disposition: 'n/a' }),
]);

/** The states this screen actually renders. `data-state` on the page's root
 *  element is always a member, so every HTTP assertion has an exact sentinel
 *  rather than a copy fragment a wording change breaks. */
export const SIGNIN_STATES = Object.freeze(
  SIGNIN_LEDGER.filter((row) => row.disposition === 'rendered').map((row) => row.id),
);

/** The fields each mode submits, in render order. `missing-field` marks the
 *  blank ones AMONG THESE — a sign-in submission has no Name to be missing. */
const MODE_FIELDS = Object.freeze({
  signin: Object.freeze(['email', 'password']),
  signup: Object.freeze(['displayName', 'email', 'password']),
});

/** Copy, verbatim from docs/design/wireframes/screen-1-signin.html where the
 *  wireframe supplies it. `required` has no wireframe source — the wireframe
 *  illustrates only the two named messages — so it is the narrowest sentence
 *  that says the same thing (recorded as a deviation in this task's comment). */
const FIELD_MESSAGE = Object.freeze({
  email: 'Enter a complete email address.',
  password: 'Password must be at least 8 characters.',
  required: 'This field is required.',
});

/** Sign-in's system error is ONE message for "no such account" and "wrong
 *  password" alike — naming which would confirm to an attacker which addresses
 *  have accounts (ledger §1, and lib/auth/accounts.js's own enumeration note).
 *  THE INDISTINGUISHABILITY REQUIREMENT IS SCOPED TO THOSE TWO OUTCOMES and to
 *  nothing else: same message, same status, same state, bodies differing only
 *  in the freelancer's own submitted address (test/auth.test.js H8). It does
 *  NOT extend to request-level failures — see GENERIC_SYSTEM_MESSAGE. */
const SIGNIN_SYSTEM_MESSAGE = 'Email or password is incorrect.';

/** Anything unmapped — a body-parser refusal, a repository failure, a bug.
 *  NEVER error.message: it is not copy and may carry request material.
 *  DELIBERATELY DISTINGUISHABLE from SIGNIN_SYSTEM_MESSAGE, and
 *  test/auth.test.js asserts that direction so a later "simplification" cannot
 *  re-conflate them. It is the sibling of H8, which asserts the opposite for
 *  the credential check's own two outcomes; each case names the other. */
const GENERIC_SYSTEM_MESSAGE = 'Something went wrong. Try again.';

/** Sign-up's conflict, split so the submitted address can be emphasised without
 *  putting markup in the data. The wireframe's inline "Sign in instead" link is
 *  rendered as plain text: a link cannot carry `next` without putting it in a
 *  URL position, which plan §3.1 P2a forbids without exception. The equivalent
 *  control is the mode-switch button directly below the form. */
const EMAIL_TAKEN_BEFORE = 'An account already exists for ';
const EMAIL_TAKEN_AFTER = '. Sign in instead, or use a different email.';

/** 00-flows.md Flow 4 step 2: a guard redirect arrives with a one-line reason
 *  rather than as a bare bounce. `next` present IS that arrival. */
const CONTINUE_REASON = 'Sign in to continue.';

/** MODE SELECTS THE FORM; STEP SELECTS THE MESSAGE. There is deliberately NO
 *  message key in this table, and that absence is the fix for review cycle 1's
 *  D1 (plan ruling R-1): cycle 1 carried a `systemMessage` per mode, the
 *  `default:` branch below reached for it, and every unmapped failure on either
 *  route therefore rendered sign-in's credentials sentence — telling a
 *  freelancer whose body the parser refused that their password was wrong. The
 *  constant is REMOVED rather than branched around: a `default:` branch that
 *  reaches for a per-mode message is the defect, and removing the constant
 *  removes the reach. A future unmapped step has nothing mode-scoped to
 *  inherit. */
const MODE_COPY = Object.freeze({
  signin: Object.freeze({
    title: 'Sign in',
    submitLabel: 'Sign in',
    switchPrompt: 'New here?',
    switchLabel: 'Create an account',
    switchMode: 'signup',
    passwordAutocomplete: 'current-password',
    defaultState: 'S1-DEFAULT-SIGNIN',
  }),
  signup: Object.freeze({
    title: 'Create your account',
    submitLabel: 'Create account',
    switchPrompt: 'Already have an account?',
    switchLabel: 'Sign in',
    switchMode: 'signin',
    passwordAutocomplete: 'new-password',
    defaultState: 'S1-DEFAULT-SIGNUP',
  }),
});

/** A submitted value, or ''. Never null and never undefined: the template
 *  writes it into a double-quoted value= and an undefined would render the
 *  string "undefined" into the freelancer's own field. */
const text = (value) => (typeof value === 'string' ? value : '');

/** THE ONE PLACE MODE IS DECIDED, for a GET and for a failed POST alike.
 *  Anything that is not exactly 'signup' — absent, an array from `?mode[]=`, a
 *  typo — is sign-in, which is the ledger's stated default when `mode` is
 *  absent. A 'parse-body' failure is NOT in that list any more: cycle 1 said it
 *  "cannot know which form was submitted", and the router's error middleware
 *  can — it has req.path (routes/auth.js, and plan ruling R-1's B3 half). */
const normaliseMode = (raw) => (raw === 'signup' ? 'signup' : 'signin');

const banner = (title, message, email) => Object.freeze({
  title: title ?? null,
  message: message ?? null,
  email: email ?? null,
  emailBefore: email === undefined || email === null ? null : EMAIL_TAKEN_BEFORE,
  emailAfter: email === undefined || email === null ? null : EMAIL_TAKEN_AFTER,
});

/** "2 fields need attention" — the wireframe's own banner, agreeing with itself
 *  about number. n is what the page actually marks, never a guess. */
function attentionTitle(n) {
  if (n === 0) return 'Check your details and try again.';
  return n === 1 ? '1 field needs attention' : `${n} fields need attention`;
}

/**
 * Route inputs -> template locals. Pure.
 *
 * @param {{
 *   mode?: unknown,
 *   next?: string | null,
 *   failure?: { step?: string, email?: unknown, displayName?: unknown,
 *     invalidFields?: string[] } | null,
 * }} [input] `mode` is the raw query value on a GET and the mode the failed
 *   submission was in on a POST — the caller supplies it either way, and this
 *   module normalises it. `next` is ALREADY validated by lib/auth/guard.js's
 *   safeNext at the call site; this module does not re-derive safety, it only
 *   renders. `failure` absent means a plain GET.
 * @returns {object} the template's locals. `state` is a member of
 *   SIGNIN_STATES. Deliberately NOT frozen — see the note at the return.
 */
export function signinLocals(input = {}) {
  const failure = input.failure ?? null;
  const mode = normaliseMode(input.mode);
  const copy = MODE_COPY[mode];
  const next = typeof input.next === 'string' ? input.next : '';

  const email = text(failure?.email);
  const displayName = text(failure?.displayName);
  const submittedBlank = Array.isArray(failure?.invalidFields) ? failure.invalidFields : [];

  let state = copy.defaultState;
  let marked = [];
  let pageBanner = null;

  if (failure !== null) {
    switch (failure.step) {
      case 'invalid-email':
        state = 'S1-ERROR-VALIDATION';
        marked = ['email'];
        break;
      case 'weak-password':
        state = 'S1-ERROR-VALIDATION';
        marked = ['password'];
        break;
      case 'missing-field':
        state = 'S1-ERROR-VALIDATION';
        marked = MODE_FIELDS[mode].filter((name) => submittedBlank.includes(name));
        break;
      case 'email-taken':
        state = 'S1-ERROR-SYSTEM';
        pageBanner = banner(null, null, email);
        break;
      case 'invalid-credentials':
        // ONE message for "no such account" and "wrong password" alike, chosen
        // by the STEP and unconditionally — never through the mode. Sign-up
        // cannot produce this step (accounts.signUp does not check credentials),
        // so the case is reachable in sign-in mode only, by construction rather
        // than by a mode test.
        state = 'S1-ERROR-SYSTEM';
        pageBanner = banner(null, SIGNIN_SYSTEM_MESSAGE, null);
        break;
      default:
        // parse-body, and anything this app has not met. The generic sentence,
        // in BOTH modes. Conflating a request-level failure with a credential
        // failure buys no enumeration resistance — enumeration compares two
        // sign-in submissions that differ only in whether the account exists,
        // and an attacker making that comparison controls their own request
        // shape and never sends a malformed body. It costs a lie to a real
        // person and buys nothing (plan ruling R-1).
        state = 'S1-ERROR-SYSTEM';
        pageBanner = banner(null, GENERIC_SYSTEM_MESSAGE, null);
    }
    if (state === 'S1-ERROR-VALIDATION') pageBanner = banner(attentionTitle(marked.length), null, null);
  }

  const messageFor = (name) => {
    if (!marked.includes(name)) return null;
    if (name === 'email' && failure?.step === 'invalid-email') return FIELD_MESSAGE.email;
    if (name === 'password' && failure?.step === 'weak-password') return FIELD_MESSAGE.password;
    return FIELD_MESSAGE.required;
  };

  // NOT frozen, and that is a measured constraint rather than an oversight:
  // express's res.render adds `_locals` to the object it is handed, so a frozen
  // locals object throws "Cannot add property _locals, object is not
  // extensible" on every request. The nested `banner` IS frozen — express never
  // reaches into it — and so are the two exported lists.
  return {
    state,
    isSignUp: mode === 'signup',
    title: state === 'S1-ERROR-VALIDATION' ? `${copy.title} — fix the highlighted fields` : copy.title,
    submitLabel: copy.submitLabel,
    switchPrompt: copy.switchPrompt,
    switchLabel: copy.switchLabel,
    switchMode: copy.switchMode,
    passwordAutocomplete: copy.passwordAutocomplete,
    reason: next === '' ? null : CONTINUE_REASON,
    banner: pageBanner,
    next,
    email,
    displayName,
    displayNameError: messageFor('displayName'),
    emailError: messageFor('email'),
    passwordError: messageFor('password'),
  };
}
