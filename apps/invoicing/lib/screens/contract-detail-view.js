// lib/screens/contract-detail-view.js — screen 7's PURE view model (AS-47,
// plan §3.3; the mechanism is AS-45's, plan §3.5.2).
//
// A screen is a pure view model plus a presentation-only template. This file
// exports (a) the screen's ledger, transcribed from
// docs/design/wireframes/02-states-ledger.md §7, and (b) a pure function from
// route inputs to template locals. No I/O, no clock, no req, no res.
//
// THE INPUT IS THE STORED ROW, A FAILURE ENUM AND ONE BOOLEAN, AND NOTHING
// ELSE. The route reads `repos.contracts.getById(...)`, classifies what it
// threw (a NotFoundError is 'not-found'; anything else is 'system'), and
// passes `isDownload`, a boolean the ROUTE derives from `?download=1`. The
// query parameter's VALUE never enters this module as a string, so there is no
// path by which it can reach the page — the AS-70 shape, reused (plan §3.4).
//
// THE PAGE RENDERS THE DOCUMENT, NOT THE ROW. No id, no timestamps and no
// template id reach the locals. `renderedHtml` is the ONE local the template
// emits raw — it is already HTML, produced by lib/contracts/render.js's one
// escaper, and escaping it again would render the document's own tags as
// text. The raw-output line is sanctioned by exact line in
// test/dependency-policy.test.js (RAW_OUTPUT_SANCTIONED); every other local
// here is a renderer-authored constant or a stored, EJS-escaped string.

/** Screen 7's ledger, all eight rows, each with what this app does about it.
 *
 *  WHAT THIS TRANSCRIPTION IS JOINED TO, precisely (AS-45 plan ruling R-4).
 *  This list and the table in test/contract-screens.test.js are TWO
 *  INDEPENDENT HAND TRANSCRIPTIONS of 02-states-ledger.md §7, compared against
 *  EACH OTHER by exact set equality and cardinality — that pins the
 *  DISPOSITIONS, which are this app's answer to each row. Fidelity to the
 *  design document itself is mechanical since AS-71 (the same join as
 *  SIGNIN_LEDGER and CONNECT_LEDGER): test/states-ledger.test.js reads the
 *  vendored 02-states-ledger.md and joins this list to §7 by id, n/a row and
 *  LOADING row. (Before AS-71 that join was a dated review act: all eight rows
 *  transcribed by hand from §7 on 2026-09-12 by agent:developer-marcus.)
 *
 *  `rendered` rows are the members of CONTRACT_DETAIL_STATES below; the other
 *  five are accounted for rather than silently absent:
 *   - rendered as S7-ERROR-NOTFOUND: S7-DENIED-NOTOWNER is the ledger's own
 *     alias of NOTFOUND. The repository scopes getById by freelancer and throws
 *     the same NotFoundError for "missing" and "not yours", so the route CANNOT
 *     tell them apart and the two bodies are byte-identical by construction —
 *     a guessed id confirms nothing about whether it exists.
 *   - redirect-answered: S7-DENIED-SIGNEDOUT is the guard's 303; no markup.
 *   - unrenderable — browser-supplied: S7-LOADING needs client-side
 *     JavaScript, which this app has none of and does not add (P2c).
 *   - n/a: S7-EMPTY (a detail screen for one record has no collection) and
 *     S7-ABANDON (a read screen creates no in-progress state) — the ledger's
 *     own "n/a — because" rows; nothing renders, by decision.
 *
 *  THE DOWNLOAD VARIANT IS NOT A ROW. `?download=1` selects a chrome-free
 *  rendering of S7-DEFAULT answered as an attachment — the ledger's own
 *  framing of print ("a CSS rendering variant of whichever state is active,
 *  not a distinct state") applied to the file. It stamps data-state
 *  S7-DEFAULT, so every render stays inside the closed set. */
export const CONTRACT_DETAIL_LEDGER = Object.freeze([
  Object.freeze({ id: 'S7-DEFAULT', disposition: 'rendered' }),
  Object.freeze({ id: 'S7-LOADING', disposition: 'unrenderable — browser-supplied' }),
  Object.freeze({ id: 'S7-EMPTY', disposition: 'n/a' }),
  Object.freeze({ id: 'S7-ERROR-NOTFOUND', disposition: 'rendered' }),
  Object.freeze({ id: 'S7-ERROR-SYSTEM', disposition: 'rendered' }),
  Object.freeze({ id: 'S7-DENIED-SIGNEDOUT', disposition: 'redirect-answered' }),
  Object.freeze({ id: 'S7-DENIED-NOTOWNER', disposition: 'rendered as S7-ERROR-NOTFOUND' }),
  Object.freeze({ id: 'S7-ABANDON', disposition: 'n/a' }),
]);

/** The states this screen actually renders. `data-state` on the page's root
 *  element is always a member, so every HTTP assertion has an exact sentinel
 *  rather than a copy fragment a wording change breaks. */
export const CONTRACT_DETAIL_STATES = Object.freeze(
  CONTRACT_DETAIL_LEDGER.filter((row) => row.disposition === 'rendered').map((row) => row.id),
);

/** Copy, verbatim from docs/design/wireframes/screen-7-contract-detail.html
 *  where it supplies it. Apostrophes are in element content only, where they
 *  are safe (P4's own measurement). The wireframe's Print button is a script
 *  affordance (window.print) and is NOT built — P2c leaves this app with no
 *  script — so S7-DEFAULT carries one sentence instead, a renderer-authored
 *  constant with no wireframe source (recorded deviation, plan §3.5, §11 Q1).
 *  The wireframe's NOTFOUND "Back to Dashboard" link waits for AS-48 (there is
 *  no dashboard to point at; `/` redirects to /connect-stripe after AS-70). */
const COPY = Object.freeze({
  'S7-ERROR-NOTFOUND': Object.freeze({
    title: 'Contract not found',
    banner: "We couldn't find that contract.",
  }),
  'S7-ERROR-SYSTEM': Object.freeze({
    title: "Couldn't load this contract",
    banner: 'Something went wrong loading this contract.',
    retryLabel: 'Retry',
  }),
});

const PRINT_HELP = "To print, or to save as a PDF, use your browser's Print command.";
const DOWNLOAD_LABEL = 'Download';

/** THE ONE PLACE THE STATE IS DECIDED. Total over (contract, failure), with
 *  the precedence stated: a classified failure outranks the row (a route that
 *  caught an error has no row to show), and a null row with no failure is
 *  nothing to show — NOTFOUND, which is also what the VIEWS health probe
 *  renders from the default input. S7-DEFAULT requires a row. */
function selectState(contract, failure) {
  if (failure === 'not-found') return 'S7-ERROR-NOTFOUND';
  if (failure === 'system') return 'S7-ERROR-SYSTEM';
  if (contract === null) return 'S7-ERROR-NOTFOUND';
  return 'S7-DEFAULT';
}

/**
 * Route inputs -> template locals. Pure.
 *
 * @param {{
 *   contract?: { renderedHtml: string, variables: { clientName: string } } | null,
 *   failure?: 'not-found' | 'system' | null,
 *   isDownload?: unknown,
 * }} [input] `contract` is the contracts repository row, or null. `failure`
 *   is the route's classification of what the read threw, or null when it
 *   threw nothing. `isDownload` is true ONLY when the route saw exactly
 *   `?download=1` AND the state is S7-DEFAULT; anything that is not literally
 *   `true` — a string, an array from `?download[]=`, undefined — is false
 *   here, so the parameter's value has no path into the locals even if a
 *   caller passes it by mistake, and a `?download=1` on a missing id renders
 *   the not-found page inline, never an attachment named for a contract that
 *   does not exist.
 * @returns {object} the template's locals. `state` is a member of
 *   CONTRACT_DETAIL_STATES. Deliberately NOT frozen — express's res.render
 *   adds `_locals` to the object it is handed (measured under AS-45).
 */
export function contractDetailLocals(input = {}) {
  const contract = input.contract ?? null;
  const failure = input.failure ?? null;
  const state = selectState(contract, failure);
  const isDefault = state === 'S7-DEFAULT';
  const isDownload = isDefault && input.isDownload === true;
  const copy = isDefault ? null : COPY[state];

  // The template branches on these three booleans — one per rendered state,
  // exactly one true — and never on state ids, so there is no `state === '…'`
  // in the template to drift from this module.
  return {
    state,
    isDefault,
    isNotFound: state === 'S7-ERROR-NOTFOUND',
    isSystem: state === 'S7-ERROR-SYSTEM',
    title: isDefault ? `Contract with ${contract.variables.clientName}` : copy.title,
    banner: isDefault ? null : copy.banner,
    retryLabel: state === 'S7-ERROR-SYSTEM' ? copy.retryLabel : null,
    // The ONE local the template emits raw (plan §3.3, decision 1).
    renderedHtml: isDefault ? contract.renderedHtml : null,
    isDownload,
    printHelp: isDefault ? PRINT_HELP : null,
    downloadLabel: isDefault ? DOWNLOAD_LABEL : null,
  };
}
