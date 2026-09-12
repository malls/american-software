// lib/screens/dates.js — the ONE place a stored timestamp becomes the date a
// person reads on a read screen (AS-48, plan §2, §3.2): 'Aug 28, 2026'.
//
// Shared by the two read-screen view models (dashboard-view.js's Created
// column, invoice-detail-view.js's due and paid dates). UTC, always: the mirror
// stores Date#toISOString values, the app has no notion of a freelancer's
// time zone, and a date that shifted with the server's zone would be a second
// source of truth. The input is a UTC ISO-8601 timestamp — with or without
// milliseconds, so both the repository's stored form and a hand-written
// fixture render — and anything else throws rather than rendering "Invalid
// Date" into a page: a malformed timestamp reaching a view model is a bug in
// the writer, not a state.
//
// Intl.DateTimeFormat rather than lib/contracts/render.js's month table: that
// table is part of a FROZEN document format (a contract must render the same
// bytes for ever), and this string is screen furniture that may follow the
// runtime's data. 'en-US' is pinned so the output is a constant the tests can
// name; the format is built once at module load.

/** ISO-8601, UTC, seconds required, milliseconds optional. */
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

const FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

/**
 * @param {string} iso a UTC ISO-8601 timestamp, e.g. '2026-08-28T00:00:00.000Z'
 * @returns {string} 'Aug 28, 2026'
 * @throws {TypeError} on anything that is not a well-formed UTC timestamp
 */
export function formatDate(iso) {
  if (typeof iso !== 'string' || !UTC_TIMESTAMP.test(iso)) {
    throw new TypeError(`formatDate: expected a UTC ISO-8601 timestamp, got ${JSON.stringify(iso)}`);
  }
  const date = new Date(iso);
  // '2026-13-45T00:00:00Z' passes the shape test and parses to NaN.
  if (Number.isNaN(date.getTime())) throw new TypeError(`formatDate: not a real date: ${iso}`);
  return FORMAT.format(date);
}
