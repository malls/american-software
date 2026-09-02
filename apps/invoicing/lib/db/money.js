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
// decimal string. Stripe speaks minor units too, so nothing is ever converted.
import { ValidationError } from './errors.js';

export const SUPPORTED_CURRENCIES = Object.freeze(['usd']);
export const DEFAULT_CURRENCY = 'usd';

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
