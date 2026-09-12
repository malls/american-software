// lib/db/money.js — the ONE place the currency set and the minor-unit rules
// live (AS-39, plan §2.6).
//
// The DDL checks the SHAPE of a currency code (three lowercase letters); the
// allowed SET is decided here, so adding a currency is one entry below plus
// whatever Stripe-side work AS-43 needs — the schema needs nothing. No other
// module under lib/db/ may carry the literal 'usd' (AC 8), and the
// dependency-policy money-words scan confines the words amount/currency/money
// to this file, the DDL, the invoices repository and lib/stripe/custody.js.
//
// Amounts are integer minor units (cents for usd) — never a float, never a
// decimal string. Stripe speaks minor units too, so nothing is converted ON THE
// WIRE; the ONE conversion in the app is at the human boundary — a freelancer
// types "1200.00" and reads "19.99" — and it lives here, in formatMinorUnits
// and parseMajorUnits (AS-46, plan §4.3). Their only caller is screen 4's view
// model, lib/screens/invoice-form-view.js, which is on the money-words row for
// exactly that reason. AS-48 adds the DISPLAY form beside them —
// formatDisplayMinorUnits, '$1,200.00' — whose callers are the two read-screen
// view models (plan §4), on the same row for the same reason.
import { ValidationError } from './errors.js';

export const SUPPORTED_CURRENCIES = Object.freeze(['usd']);
export const DEFAULT_CURRENCY = 'usd';

/** The symbol a person reads in front of a displayed total, per supported
 *  currency (AS-48, plan §4). Kept beside DEFAULT_CURRENCY so a second currency
 *  adds its symbol in the same edit as its code; a code with no symbol here is
 *  refused by formatDisplayMinorUnits rather than rendered bare. */
export const CURRENCY_SYMBOLS = Object.freeze({ usd: '$' });

/** How many minor-unit digits the default currency carries — a fact about the
 *  currency, kept beside it so a second currency moves the exponent with it.
 *  `10 ** MINOR_DIGITS` is the only place the 100 is written. */
export const MINOR_DIGITS = 2;
const MINOR_PER_MAJOR = 10 ** MINOR_DIGITS;

/** A typed major-units string, exactly: digits, optionally a point and one or
 *  two fraction digits. No sign, no thousands separator, no currency symbol, no
 *  exponent, no leading or trailing point. */
const MAJOR_UNITS = /^(\d+)(?:\.(\d{1,2}))?$/;

/** The code must be one of SUPPORTED_CURRENCIES, exactly as written there. */
export function assertSupportedCurrency(code) {
  if (typeof code !== 'string' || !SUPPORTED_CURRENCIES.includes(code)) {
    throw new ValidationError('currency', `unsupported currency; supported: ${SUPPORTED_CURRENCIES.join(', ')}`);
  }
  return code;
}

/** A minor-unit amount: a safe non-negative integer. Zero is allowed (a free
 *  line item is a real thing on an invoice); a fraction or a negative is not. */
export function assertMinorUnits(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ValidationError(field, 'must be a non-negative integer of minor units');
  }
  return value;
}

/** Quantities and day counts: a safe integer of at least 1. */
export function assertPositiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ValidationError(field, 'must be a positive integer');
  }
  return value;
}

/**
 * Minor units -> the string a person reads: 120000 -> '1200.00', 5 -> '0.05'.
 * Integer division and remainder only — no toFixed, no division by a float —
 * so the output is exact for every safe integer. Refuses exactly what
 * assertMinorUnits refuses.
 */
export function formatMinorUnits(minor) {
  assertMinorUnits(minor, 'minor');
  const whole = Math.trunc(minor / MINOR_PER_MAJOR);
  const cents = minor - whole * MINOR_PER_MAJOR;
  return `${whole}.${String(cents).padStart(MINOR_DIGITS, '0')}`;
}

/** Digits grouped by thousands with a comma: '1234567' -> '1,234,567'. A
 *  regex over the digit STRING, so no locale is consulted and no float is
 *  formed. `toLocaleString` is deliberately not used: its output depends on
 *  the process's ICU data and locale, which makes it untestable as a constant. */
const THOUSANDS = /\B(?=(\d{3})+(?!\d))/g;

/**
 * Minor units -> the string a person reads ON A READ SCREEN, symbol and
 * thousands separators included: 120000 -> '$1,200.00', 5 -> '$0.05',
 * 123456789 -> '$1,234,567.89' (AS-48, plan §4). Built on formatMinorUnits, so
 * it refuses exactly what assertMinorUnits refuses, and on assertSupportedCurrency,
 * so an unsupported code throws rather than rendering with no symbol.
 */
export function formatDisplayMinorUnits(minor, currency = DEFAULT_CURRENCY) {
  assertSupportedCurrency(currency);
  const [whole, cents] = formatMinorUnits(minor).split('.');
  return `${CURRENCY_SYMBOLS[currency]}${whole.replace(THOUSANDS, ',')}.${cents}`;
}

/**
 * The string a person typed -> minor units, or null when it is not a price.
 * '1200.00' -> 120000, '12.5' -> 1250, '0' -> 0. Built from the digit strings
 * (whole * 100 + cents), never from Number(text) * 100: 0.1 + 0.2 is why the
 * app stores integers at all, and this is the one place that rule could be
 * lost. Refuses '', '.50', '12.', '1,200', '$12', '-1', '1e3', '12.345', and
 * anything whose result is not a safe integer.
 */
export function parseMajorUnits(text) {
  if (typeof text !== 'string') return null;
  const match = MAJOR_UNITS.exec(text.trim());
  if (match === null) return null;
  const [, wholeDigits, fraction = ''] = match;
  const whole = Number(wholeDigits);
  const cents = Number(fraction.padEnd(MINOR_DIGITS, '0'));
  const minor = whole * MINOR_PER_MAJOR + cents;
  return Number.isSafeInteger(minor) ? minor : null;
}
