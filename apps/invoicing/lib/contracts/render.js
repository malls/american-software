// lib/contracts/render.js — declaration + resolved values -> one HTML document
// string (AS-42, plan §3.5).
//
// A PURE FUNCTION OF ITS TWO ARGUMENTS. No I/O, no clock, no randomness, no
// logging, no module-level state. That is what makes determinism provable
// rather than probable: identical inputs produce byte-identical output, which
// is the invariant a stored, re-renderable document rests on.
//
// HOW INJECTION IS PREVENTED — three properties, in order of strength:
//
//  1. THERE IS NO TEMPLATE PARSER. The body is structured data — segments that
//     are either template-authored text or a named slot — not a string with
//     markers. No caller-supplied text is ever SCANNED for substitution syntax,
//     so there is nothing to escape out of and no second-order injection: a
//     value containing {{...}} or %s is simply text.
//  2. EVERY TEXT NODE GOES THROUGH ONE ESCAPE FUNCTION — template-authored and
//     user-supplied alike. Not "user values are escaped": everything is. There
//     is no raw-output path in this file, so there is no site an author could
//     reach for. A dependency-policy concept row pins escapeHtml to this file.
//  3. NO DATA REACHES AN ATTRIBUTE POSITION AT ALL. Every attribute below is a
//     renderer-authored constant. This is the strongest of the three, because
//     attribute-context escaping is the thing people get wrong, and here there
//     is no attribute-context escaping to get wrong.
//
// WHAT THE OUTPUT IS SAFE TO BE EMBEDDED IN, and nothing else: HTML element
// content (flow content) in a UTF-8 document. It is NOT safe in an attribute
// value, a <script> or <style> body, a URL, a srcdoc, an innerHTML assignment
// on a node with different parsing rules, or a JSON string emitted into a
// script tag. AS-47 emits it with EJS raw output exactly once, inside the
// document region; every other value on those screens uses escaping output.
//
// THE CLASS NAMES ARE A FROZEN CONTRACT, and this is the price of storing
// rendered output: a contract issued today carries these names forever. They
// may be ADDED TO; they may NEVER be renamed, or every already-issued document
// loses its styling.
import { ValidationError } from '../db/database.js';

/** All five, including the two an element-content context does not strictly
 *  need. Escaping " and ' is deliberate over-coverage, so the output does not
 *  become unsafe if a future reader places it somewhere narrower. */
const ESCAPES = Object.freeze({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' });
const ESCAPABLE = /[&<>"']/g;

/**
 * The ONE escaper. Every text node in the output passes through it.
 *
 * @param {string} value
 * @returns {string}
 */
export function escapeHtml(value) {
  if (typeof value !== 'string') throw new ValidationError('text', 'must be a string to be escaped');
  return value.replace(ESCAPABLE, (character) => ESCAPES[character]);
}

/** A 12-entry constant, NOT Intl / toLocaleDateString: formatting must be
 *  byte-deterministic across environments, and ICU data version and ambient
 *  timezone are not things this app depends on for a document it stores
 *  forever. */
const MONTHS = Object.freeze([
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]);

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The ONE date rule, exported so the generation service validates with exactly
 * what the renderer will later format with — two copies of a calendar check are
 * two copies that can drift.
 *
 * A UTC round-trip is what rejects 2026-02-31: Date.UTC rolls it forward to
 * March 3, and the parts no longer agree with what was asked for. It rejects
 * 0026-01-01 too, by the four-digit shape plus the same agreement.
 *
 * @param {string} value a date spelled YYYY-MM-DD
 * @param {string} field the variable name, so the refusal names it
 * @returns {[number, number, number]} year, month (1-12), day
 */
export function assertCalendarDate(value, field) {
  const parts = typeof value === 'string' ? YMD.exec(value) : null;
  if (parts === null) throw new ValidationError(field, 'must be a date spelled YYYY-MM-DD');
  const [year, month, day] = parts.slice(1).map(Number);
  const at = new Date(Date.UTC(year, month - 1, day));
  if (at.getUTCFullYear() !== year || at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day) {
    throw new ValidationError(field, `must be a real calendar date, not ${value}`);
  }
  return [year, month, day];
}

/** `2026-09-08` -> `September 8, 2026`, matching the wireframe. */
function formatDate(value, field) {
  const [year, month, day] = assertCalendarDate(value, field);
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

/** The closed tag vocabulary's only attribute values. A class name added here
 *  is added to the frozen contract above and can never be renamed. */
const CLASS = Object.freeze({
  root: 'contract-doc',
  notice: 'contract-doc__notice',
  noticeTitle: 'contract-doc__notice-title',
  title: 'contract-doc__title',
  body: 'contract-doc__body',
  attribution: 'contract-doc__attribution',
  multiline: 'contract-doc__multiline',
});

/** <strong> wraps <span>, never the other way round: emphasis is the outer
 *  role and the pre-wrap span must stay the element whose whitespace rule
 *  applies to the text. No template declares both today. */
const strongly = (html, strong) => (strong === true ? `<strong>${html}</strong>` : html);

/** One resolved value, rendered by its declared type. Every branch ends in
 *  escapeHtml — there is no path out of this function that emits raw input. */
function renderValue(variable, raw) {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new ValidationError(variable.name, 'has no value — a slot never renders blank');
  }
  if (variable.type === 'date') return escapeHtml(formatDate(raw, variable.name));
  if (variable.type === 'multiline') return `<span class="${CLASS.multiline}">${escapeHtml(raw)}</span>`;
  return escapeHtml(raw);
}

/**
 * Render a declaration with a complete set of resolved values.
 *
 * Output shape: one element per line, joined with \n, no trailing newline and
 * no indentation — indentation inside a <p> would be a whitespace difference in
 * the document's own text.
 *
 * @param {object} template a declaration from lib/contracts/templates.js
 * @param {Record<string, string>} values every declared variable, resolved
 * @returns {string} an HTML fragment: one <article class="contract-doc">
 */
export function renderContract(template, values) {
  const byName = new Map(template.variables.map((variable) => [variable.name, variable]));
  const supplied = values === null || typeof values !== 'object' ? {} : values;

  const lines = [];
  lines.push(`<article class="${CLASS.root}">`);

  // The notice is INSIDE the document region, so it survives print and
  // download — never in page chrome a screen could restyle away.
  lines.push(`<section class="${CLASS.notice}">`);
  lines.push(`<p class="${CLASS.noticeTitle}">${escapeHtml(template.notice.title)}</p>`);
  for (const paragraph of template.notice.paragraphs) lines.push(`<p>${escapeHtml(paragraph)}</p>`);
  lines.push('</section>');

  lines.push(`<h1 class="${CLASS.title}">${escapeHtml(template.title)}</h1>`);

  lines.push(`<section class="${CLASS.body}">`);
  for (const block of template.body) {
    const parts = block.map((segment) => {
      if (segment.slot !== undefined) {
        const variable = byName.get(segment.slot);
        // Unreachable while assertTemplate holds — kept because a slot with no
        // declaration must crash rather than render an empty document.
        if (variable === undefined) throw new ValidationError(segment.slot, 'is not a declared variable');
        return strongly(renderValue(variable, supplied[segment.slot]), segment.strong);
      }
      return strongly(escapeHtml(segment.text), segment.strong);
    });
    lines.push(`<p>${parts.join('')}</p>`);
  }
  lines.push('</section>');

  // Always emitted, and always inside the document region (plan §3.3 point 4).
  lines.push(`<p class="${CLASS.attribution}">${escapeHtml(template.attribution)}</p>`);
  lines.push('</article>');
  return lines.join('\n');
}
