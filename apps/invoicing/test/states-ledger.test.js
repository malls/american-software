// states-ledger.test.js — the join between every screen's frozen ledger and the
// DESIGN DOCUMENT itself (AS-71).
//
// THIS FILE'S ONE CLAIM: a row that appears, vanishes, is renamed, becomes or
// stops being n/a, or changes category to or from LOADING in
// docs/design/wireframes/02-states-ledger.md turns this suite red. (A category
// change between the other five shorthands is NOT joined — the module ledgers
// carry no category — and is red only when it leaves a screen without one of
// the six; AS-71 review probe P3.)
// Before this task that sentence was false, and screens.test.js's header said so
// in as many words: the view module and the test each carried a hand
// transcription of the ledger and the suite compared those two copies to each
// other, while the document itself was unreachable — the `test` service is
// mountless by design. The Dockerfile now vendors the document into the image
// beside tokens.css (`/app/vendor/states-ledger.md`, resolved through
// config.vendorDir exactly as assets.test.js reaches tokens.css), and this file
// reads it through test/helpers/states-ledger.js's strict parser.
//
// WHAT IS JOINED. Per screen: the module ledger's id set is the document's id
// set, both directions, cardinality first against the committed number; the
// module's `n/a` rows are the document's n/a rows; the module's `unrenderable —
// browser-supplied` rows are the document's LOADING rows — so the absence of
// those states stays an ASSERTION against the design document, never a gap.
//
// WHAT IS NOT JOINED, on purpose. Dispositions other than those (rendered,
// redirect-answered, path-into-render, layered, rendered-as-NOTFOUND) are the
// PRODUCT's answer to a row, not something the document states, so they stay
// pinned by the hand transcriptions in screens.test.js, read-screens.test.js,
// invoice-screen.test.js and contract-screens.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VENDOR_DOCUMENTS } from '../lib/vendor.js';
import { SIGNIN_LEDGER, SIGNIN_STATES } from '../lib/screens/signin-view.js';
import { CONNECT_LEDGER, CONNECT_STATES } from '../lib/screens/connect-view.js';
import { DASHBOARD_LEDGER, DASHBOARD_STATES } from '../lib/screens/dashboard-view.js';
import { INVOICE_FORM_LEDGER, INVOICE_FORM_STATES } from '../lib/screens/invoice-form-view.js';
import { INVOICE_DETAIL_LEDGER, INVOICE_DETAIL_STATES } from '../lib/screens/invoice-detail-view.js';
import { CONTRACT_FORM_LEDGER, CONTRACT_FORM_STATES } from '../lib/screens/contract-form-view.js';
import { CONTRACT_DETAIL_LEDGER, CONTRACT_DETAIL_STATES } from '../lib/screens/contract-detail-view.js';
import { CATEGORIES, parseStatesLedger } from './helpers/states-ledger.js';
import { configFor } from './helpers/server.js';

const UNRENDERABLE = 'unrenderable — browser-supplied';

/** The committed shape of the document: §8's own arithmetic, pinned here so a
 *  parse returning fewer rows is red against a NUMBER, never against `> 0`. */
const ROWS_PER_SCREEN = Object.freeze({ 1: 8, 2: 9, 3: 7, 4: 12, 5: 10, 6: 11, 7: 8 });
const TOTAL_ROWS = 65;
const NA_ROWS = Object.freeze([
  'S1-EMPTY', 'S2-EMPTY', 'S3-ABANDON', 'S5-EMPTY', 'S5-ABANDON', 'S6-GATED-STRIPENOTREADY', 'S7-EMPTY', 'S7-ABANDON',
]);

/** Each screen's module ledger and rendered-state list, keyed by screen number. */
const MODULES = Object.freeze({
  1: { ledger: SIGNIN_LEDGER, states: SIGNIN_STATES },
  2: { ledger: CONNECT_LEDGER, states: CONNECT_STATES },
  3: { ledger: DASHBOARD_LEDGER, states: DASHBOARD_STATES },
  4: { ledger: INVOICE_FORM_LEDGER, states: INVOICE_FORM_STATES },
  5: { ledger: INVOICE_DETAIL_LEDGER, states: INVOICE_DETAIL_STATES },
  6: { ledger: CONTRACT_FORM_LEDGER, states: CONTRACT_FORM_STATES },
  7: { ledger: CONTRACT_DETAIL_LEDGER, states: CONTRACT_DETAIL_STATES },
});

/** The vendored document's text, read from the REAL vendor directory — the one
 *  the image was built with — through the registry entry the Dockerfile COPY
 *  is pinned to. Read per call, not at module load: a missing file is then a
 *  red case with a readable message, not a suite that fails to import. */
function ledgerText() {
  assert.equal(VENDOR_DOCUMENTS.length, 1, 'exactly one vendored document is registered');
  assert.equal(VENDOR_DOCUMENTS[0].file, 'states-ledger.md');
  return readFileSync(join(configFor().vendorDir, VENDOR_DOCUMENTS[0].file), 'utf8');
}

const ids = (rows) => rows.map((row) => row.id).sort();

test('states-ledger: the vendored document is in the image and parses to exactly 65 rows across 7 screens', () => {
  const doc = parseStatesLedger(ledgerText());

  // Cardinality FIRST, against the committed numbers, and against the
  // document's own §8 count — three independent statements of one fact.
  assert.deepEqual([...doc.screens.keys()], [1, 2, 3, 4, 5, 6, 7], 'seven screen sections, in order');
  assert.equal(doc.rows.length, TOTAL_ROWS, `${doc.rows.length} rows parsed, expected ${TOTAL_ROWS}`);
  assert.deepEqual(doc.declared, { rows: TOTAL_ROWS, screens: 7 }, '§8 declares the same count this file pins');
  for (const [screen, expected] of Object.entries(ROWS_PER_SCREEN)) {
    const rows = doc.screens.get(Number(screen)).rows;
    assert.equal(rows.length, expected, `screen ${screen}: ${rows.length} rows, expected ${expected}`);
  }
  assert.equal(Object.values(ROWS_PER_SCREEN).reduce((a, b) => a + b, 0), TOTAL_ROWS, 'the per-screen pins sum to the total');

  // Every id is unique and belongs to its section (the parser throws otherwise;
  // asserted here too so the property is visible in this file, not only in the
  // helper's error paths).
  assert.equal(new Set(doc.rows.map((row) => row.id)).size, TOTAL_ROWS, 'row ids are unique');
  for (const row of doc.rows) assert.ok(row.id.startsWith(`S${row.screen}-`), `${row.id} sits under screen ${row.screen}`);

  // Every category is one of the six the preamble defines, and every screen
  // has at least one row in each — the document's own rule ("Six required
  // categories per screen"), now checked rather than trusted.
  for (const [screen, { rows }] of doc.screens) {
    const present = new Set(rows.map((row) => row.category));
    assert.deepEqual([...present].sort(), [...CATEGORIES].sort(), `screen ${screen} covers all six categories`);
  }

  // The n/a rows and the LOADING rows, by exact list. These are the two kinds
  // of row no screen renders, and their absence downstream is asserted against
  // THIS list — a gap here would be a gap in the design document, not in the app.
  assert.deepEqual(ids(doc.rows.filter((row) => row.na)), [...NA_ROWS].sort());
  assert.equal(NA_ROWS.length, 8, 'eight n/a rows, §8');
  assert.deepEqual(ids(doc.rows.filter((row) => row.category === 'LOADING')), [1, 2, 3, 4, 5, 6, 7].map((n) => `S${n}-LOADING`));
  assert.deepEqual(doc.rows.filter((row) => row.na && row.category === 'LOADING'), [], 'no LOADING row is n/a — the two sets are disjoint');
});

test('states-ledger: the parser rejects shapes it does not understand', () => {
  // The parser's strictness is load-bearing (a shrug makes every join above
  // vacuous), so it is tested. Each input is the real document with ONE thing
  // wrong, so the rejection is for that thing and not for a toy fixture.
  const real = ledgerText();
  assert.doesNotThrow(() => parseStatesLedger(real), 'the real document parses');

  const once = (needle, replacement) => {
    assert.equal(real.split(needle).length - 1, 1, `${JSON.stringify(needle)} occurs exactly once, so the edit lands where intended`);
    return real.replace(needle, replacement);
  };
  // A row under the wrong screen.
  assert.throws(() => parseStatesLedger(once('| `S3-ERROR-SYSTEM` |', '| `S4-ERROR-SYSTEM-X` |')), /row S4-ERROR-SYSTEM-X sits under Screen 3/);
  // An unknown category.
  assert.throws(() => parseStatesLedger(once('| `S7-DEFAULT` | DEFAULT |', '| `S7-DEFAULT` | POPULATED |')), /unknown category "POPULATED" on S7-DEFAULT/);
  // A duplicate id.
  assert.throws(() => parseStatesLedger(once('| `S7-LOADING` |', '| `S7-DEFAULT` |')), /duplicate row id S7-DEFAULT/);
  // An n/a Trigger whose "What renders" cell does not say so.
  assert.throws(() => parseStatesLedger(once('| *(n/a row — see `S5-ERROR-NOTFOUND`', '| *(see `S5-ERROR-NOTFOUND`')), /S5-EMPTY is n\/a in Trigger but not the other/);
  // A row id that is not backticked.
  assert.throws(() => parseStatesLedger(once('| `S6-ABANDON` |', '| S6-ABANDON |')), /unrecognised row id "S6-ABANDON"/);
  // A table header it does not know.
  assert.throws(() => parseStatesLedger(once('## 5. Screen 5 — Invoice detail + status\n', '## 5. Screen 5 — Invoice detail + status\n| Row | Cat |\n|---|---|\n| x | y |\n')), /a table line outside a recognised table/);
  // A section whose two numbers disagree.
  assert.throws(() => parseStatesLedger(once('## 6. Screen 6 —', '## 6. Screen 7 —')), /section 6 names Screen 7/);
  // The §8 count gone.
  assert.throws(() => parseStatesLedger(once('= **65 states across 7 screens.**', '= sixty-five states.')), /no declared count/);
  // No rows at all: a document of prose only.
  assert.throws(() => parseStatesLedger(real.split('\n').filter((line) => !line.startsWith('|')).join('\n')), /yields no rows/);
  assert.throws(() => parseStatesLedger(''), /yields no rows/);
});

for (const screen of [1, 2, 3, 4, 5, 6, 7]) {
  test(`states-ledger: screen ${screen} — the view module's rows are the document's rows, n/a and LOADING included`, () => {
    const doc = parseStatesLedger(ledgerText()).screens.get(screen);
    const { ledger, states } = MODULES[screen];
    assert.ok(doc, `the document has a Screen ${screen} section`);

    // Cardinality first, on both sides, against the committed number.
    assert.equal(doc.rows.length, ROWS_PER_SCREEN[screen], `document: ${doc.rows.length} rows, expected ${ROWS_PER_SCREEN[screen]}`);
    assert.equal(ledger.length, ROWS_PER_SCREEN[screen], `module: ${ledger.length} rows, expected ${ROWS_PER_SCREEN[screen]}`);

    // The id set, exactly, in both directions.
    assert.deepEqual(ids(ledger), ids(doc.rows), `screen ${screen}: the module's rows are the document's rows`);

    // The document's n/a rows are exactly the rows the module marks n/a.
    assert.deepEqual(ids(ledger.filter((row) => row.disposition === 'n/a')), ids(doc.rows.filter((row) => row.na)), `screen ${screen}: n/a rows`);

    // The document's LOADING rows are exactly the rows the module records as
    // unrenderable. "Fields disabled, button reads 'Saving…'" is a state a page
    // enters AFTER its bytes were served; with no client-side JavaScript
    // (dependency-policy's P2c row) the interval is the browser's own. Their
    // absence is an assertion against the design document, not a gap.
    assert.deepEqual(ids(ledger.filter((row) => row.disposition === UNRENDERABLE)), ids(doc.rows.filter((row) => row.category === 'LOADING')), `screen ${screen}: unrenderable rows are the LOADING rows`);

    // Every rendered state is a document row that is neither n/a nor LOADING.
    const renderable = new Set(doc.rows.filter((row) => !row.na && row.category !== 'LOADING').map((row) => row.id));
    assert.ok(states.length > 0, `screen ${screen} renders at least one state`);
    for (const id of states) assert.ok(renderable.has(id), `${id} is a renderable document row`);
  });
}
