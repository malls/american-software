// lib/screens/connect-view.js — screen 2's PURE view model (AS-70, plan §3.2;
// the mechanism is AS-45's, plan §3.5.2).
//
// A screen is a pure view model plus a presentation-only template. This file
// exports (a) the screen's ledger, transcribed from
// docs/design/wireframes/02-states-ledger.md §2, and (b) a pure function from
// route inputs to template locals. No I/O, no clock, no req, no res.
//
// THE INPUT IS THE STORED ROW AND ONE BOOLEAN, AND NOTHING ELSE. The route
// reads `repos.connectedAccounts.getByFreelancer(...)` and passes the row (or
// null) plus `startFailed`, a boolean the ROUTE derives from `?error=start`.
// The query parameter's VALUE never enters this module as a string, so there is
// no path by which it can reach the page — a structural property, not a
// tested-for one (plan §3.2 decision 1).
//
// `ready` IS READ, NEVER RE-DERIVED. It is computed in exactly one place —
// lib/db/repositories/connected-accounts.js's mapper — and this module does not
// look at `chargesEnabled` or `requirementsCurrentlyDue` (AS-41's "one place"
// rule; test/screens.test.js plants exactly that re-derivation as a falsifier).
//
// EVERY STRING BELOW IS A RENDERER-AUTHORED CONSTANT selected by a closed enum.
// No account identifier, no timestamp and no Stripe id reaches the locals: the
// page renders the STATE, not the row.
//
// WORDING NOTE: the lede's "your clients' funds" is 00-flows.md Flow 2 step
// 1's spelling. 02-states-ledger.md §2 and the wireframe use a different noun
// there — one the dependency-policy suite confines to the files that handle
// integer minor units (scanned as RAW text, comments included), and this file
// is not one of them. The flow's own wording is the fix, not an invention.

/** Screen 2's ledger, all nine rows, each with what this app does about it.
 *
 *  WHAT THIS TRANSCRIPTION IS JOINED TO, precisely (AS-45 plan ruling R-4).
 *  This list and the table in test/screens.test.js are TWO INDEPENDENT HAND
 *  TRANSCRIPTIONS of 02-states-ledger.md §2, compared against EACH OTHER by
 *  exact set equality and cardinality. Nothing in the suite reads the design
 *  document and nothing in it can: the `test` service is mountless by design
 *  and the Dockerfile vendors exactly one file from outside the app,
 *  docs/design/tokens/tokens.css. So a row appearing or vanishing IN THE
 *  DOCUMENT does not turn the suite red — both copies would have to be
 *  hand-edited, and it is the SECOND edit the test detects. Fidelity to the
 *  document is a DATED REVIEW ACT, not a test: all nine rows transcribed by
 *  hand from §2 on 2026-09-12 by agent:developer-marcus; the reviewer's own
 *  check is recorded on the task. Closing the join means vendoring the ledger
 *  into the image the way tokens.css already is — that is AS-71, which depends
 *  on this transcription existing.
 *
 *  `rendered` rows are the members of CONNECT_STATES below; the other five are
 *  accounted for rather than silently absent:
 *   - redirect-answered: the response is a 303, so no markup is produced.
 *     S2-DENIED-SIGNEDOUT is the guard's; S2-REFRESH is routes/connect.js's
 *     refresh handler, which 303s into a fresh Stripe link and never renders
 *     this screen's own content.
 *   - path-into-render: S2-ABANDON is a way of ARRIVING at a rendered state,
 *     not a render. The ledger's prose says it renders NOTSTARTED "again"; it
 *     was written assuming no row exists until Stripe redirects back, and
 *     AS-41 creates the row at start. So after a genuine abandonment a row
 *     exists and is not ready, and the honest render is S2-RETURN-NOTREADY,
 *     whose control resumes the hosted flow where Stripe left it. How the
 *     visitor ARRIVED is not a state this screen may read: any marker on the
 *     way in is client-supplied. (Ledger wording amendment travels with AS-71.)
 *   - unrenderable — browser-supplied: S2-LOADING needs client-side
 *     JavaScript, which this app has none of and does not add.
 *   - n/a: the ledger's own "n/a — because" row; nothing renders, by decision. */
export const CONNECT_LEDGER = Object.freeze([
  Object.freeze({ id: 'S2-DEFAULT-NOTSTARTED', disposition: 'rendered' }),
  Object.freeze({ id: 'S2-RETURN-READY', disposition: 'rendered' }),
  Object.freeze({ id: 'S2-LOADING', disposition: 'unrenderable — browser-supplied' }),
  Object.freeze({ id: 'S2-EMPTY', disposition: 'n/a' }),
  Object.freeze({ id: 'S2-ERROR-SYSTEM', disposition: 'rendered' }),
  Object.freeze({ id: 'S2-RETURN-NOTREADY', disposition: 'rendered' }),
  Object.freeze({ id: 'S2-DENIED-SIGNEDOUT', disposition: 'redirect-answered' }),
  Object.freeze({ id: 'S2-REFRESH', disposition: 'redirect-answered' }),
  Object.freeze({ id: 'S2-ABANDON', disposition: 'path-into-render' }),
]);

/** The states this screen actually renders. `data-state` on the page's root
 *  element is always a member, so every HTTP assertion has an exact sentinel
 *  rather than a copy fragment a wording change breaks. */
export const CONNECT_STATES = Object.freeze(
  CONNECT_LEDGER.filter((row) => row.disposition === 'rendered').map((row) => row.id),
);

/** Copy, verbatim from docs/design/wireframes/screen-2-connect-stripe.html,
 *  with exactly one substitution in the lede (see the wording note above).
 *  Apostrophes are in element content only, where they are safe (P4's own
 *  measurement). Every state has a title; exactly one has a lede; three have a
 *  banner; three have the one POST control, labelled per state. READY has NO
 *  control until the Dashboard exists (AS-48) — a control pointing at a route
 *  nothing serves is the defect AS-45's review cycle 1 found, one screen later
 *  (plan §3.4). */
const COPY = Object.freeze({
  'S2-DEFAULT-NOTSTARTED': Object.freeze({
    title: 'Connect your Stripe account',
    lede: "You'll be taken to Stripe to verify your identity and add payout details. We never hold or move your clients' funds — Stripe pays you directly.",
    banner: null,
    action: Object.freeze({ label: 'Connect with Stripe' }),
  }),
  'S2-RETURN-READY': Object.freeze({
    title: "You're connected",
    lede: null,
    banner: Object.freeze({ tone: 'success', message: 'Your Stripe account is ready to accept payments.' }),
    action: null,
  }),
  'S2-RETURN-NOTREADY': Object.freeze({
    title: 'Almost there — Stripe needs more information',
    lede: null,
    banner: Object.freeze({
      tone: 'warning',
      message: "Stripe still needs more information before you can accept payments. You can't send invoices until this is finished.",
    }),
    action: Object.freeze({ label: 'Finish setup on Stripe' }),
  }),
  'S2-ERROR-SYSTEM': Object.freeze({
    title: "Couldn't reach Stripe",
    lede: null,
    banner: Object.freeze({
      tone: 'error',
      message: "Something went wrong starting Stripe setup. You haven't left this page — try again.",
    }),
    action: Object.freeze({ label: 'Try again' }),
  }),
});

/** THE ONE PLACE THE STATE IS DECIDED. Total over (account, startFailed), with
 *  the precedence stated: the error flag outranks the row, deliberately — a
 *  start that failed is the most recent fact the visitor has, and its "Try
 *  again" control (a POST to /connect-stripe/start) is correct in every row
 *  state: no row creates, not-ready resumes, ready short-circuits back here
 *  with zero Stripe calls (routes/connect.js R5). */
function selectState(account, startFailed) {
  if (startFailed) return 'S2-ERROR-SYSTEM';
  if (account === null) return 'S2-DEFAULT-NOTSTARTED';
  return account.ready === true ? 'S2-RETURN-READY' : 'S2-RETURN-NOTREADY';
}

/**
 * Route inputs -> template locals. Pure.
 *
 * @param {{
 *   account?: { ready: boolean } | null,
 *   startFailed?: unknown,
 * }} [input] `account` is the connected-accounts repository row, or null when
 *   the freelancer has none. `startFailed` is true ONLY when the route saw
 *   exactly `?error=start`; anything that is not literally `true` — a string,
 *   an array from `?error[]=`, undefined — is false here, so the parameter's
 *   value has no path into the locals even if a caller passes it by mistake.
 * @returns {object} the template's locals. `state` is a member of
 *   CONNECT_STATES. Deliberately NOT frozen — see the note at the return.
 */
export function connectLocals(input = {}) {
  const account = input.account ?? null;
  const startFailed = input.startFailed === true;
  const state = selectState(account, startFailed);
  const copy = COPY[state];

  // NOT frozen: express's res.render adds `_locals` to the object it is handed,
  // so a frozen locals object throws on every request (measured under AS-45).
  // The nested `banner` and `action` ARE frozen, and so are the two exported
  // lists.
  return {
    state,
    title: copy.title,
    lede: copy.lede,
    banner: copy.banner,
    action: copy.action,
  };
}
