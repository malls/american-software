// test/roster-truncation.test.js — AS-74 item 1: the standing guard for the
// AS-32 roster-title truncation contract.
//
// Why this file exists: AS-32's CSS case (api.test.js:1332) asserts that the
// `.roster-title` rule *exists* and declares nowrap/hidden/ellipsis. Ruben's
// AS-32 cycle-1 mutant left that rule intact and appended ONE later rule
// re-enabling wrapping — suite stayed green, rows grew 60 -> 76px. The property
// the contract actually needs is not "the rule exists" but "the rule WINS", so
// this file computes the effective cascade for `.roster-title` over the whole
// stylesheet and asserts the winning value of every property that could
// re-open the line box.
//
// What it cannot see, stated plainly (plan §2): a real layout measurement.
// apps/chat is dependency-free by design (AS-2) and the compose image is
// node:24-slim with no browser, so a character-count or font-metric estimate
// would be an uncalibrated instrument passing on its own arithmetic. What T1
// evidences is the PRECONDITION the browser needs to lay the title out as one
// line box; the calibration that these preconditions do produce one line (and
// that removing one produces two) is AS-32's one-off recorded browser
// evidence — Marcus's PASS B (ROWHEIGHTS [60]/[84]) and Ruben's nowrap-deleted
// control (HEIGHTS [16,48], row +32px). This file is the standing guard over
// the inputs to that calibration, not a re-derivation of it.
//
// The cascade helper lives in this file on purpose (plan §1): compose runs bare
// `node --test`, whose default discovery sweeps `**/test/**/*.js`, so a helper
// at `test/css-cascade.js` would run as a zero-test file in the container and
// not on the host (`test/*.test.js`) — and the two counted receipts would stop
// being comparable. H1–H5 are the helper's own unit cases, because a wrong
// specificity count is a vacuous guard wearing T1's name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const STYLESHEET = resolve(dirname(fileURLToPath(import.meta.url)), '../public/style.css');

// --- the cascade helper ------------------------------------------------------
//
// Scope, deliberately: the three rules of the cascade that a hand-written
// stylesheet exercises — !important, then specificity, then source order. No
// origin or @layer handling (style.css has 0 occurrences of `@layer`), no
// shorthand expansion, no inheritance (every watched property is declared
// directly on the element, and a direct declaration beats inheritance from any
// ancestor at any specificity).

// A functional pseudo-class is unscorable without evaluating its argument, and
// its argument list also breaks naive comma splitting of a selector list. The
// stylesheet has none today (0 occurrences of each); a future one must fail
// loudly at the selector rather than be scored by a guess.
const UNSCORABLE = /:(is|where|not|has)\(/;

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

// Walk one nesting level by brace depth, returning { prelude, body } pairs.
function parseBlocks(src) {
  const blocks = [];
  let depth = 0;
  let preludeStart = 0;
  let prelude = '';
  let bodyStart = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') {
      if (depth === 0) {
        prelude = src.slice(preludeStart, i);
        bodyStart = i + 1;
      }
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        blocks.push({ prelude: prelude.trim(), body: src.slice(bodyStart, i) });
        preludeStart = i + 1;
      }
    }
  }
  return blocks;
}

function parseDecls(body) {
  const decls = new Map();
  for (const raw of body.split(';')) {
    const part = raw.trim();
    if (!part) continue;
    const colon = part.indexOf(':');
    if (colon === -1) continue;
    const prop = part.slice(0, colon).trim().toLowerCase();
    let value = part.slice(colon + 1).trim();
    let important = false;
    if (/!\s*important$/i.test(value)) {
      important = true;
      value = value.replace(/!\s*important$/i, '').trim();
    }
    decls.set(prop, { value: value.toLowerCase(), important });
  }
  return decls;
}

// Conditional at-rules are FLATTENED so every inner rule competes, tagged with
// its condition. Conservative on purpose: the contract is stated for every
// width, so a rule that re-enables wrapping under any condition is a
// violation. Other at-rules (@keyframes, @font-face) declare nothing about an
// element and are ignored wholesale — including their inner blocks, which are
// keyframe selectors, not element selectors.
const FLATTENED_AT = /^@(media|supports|container)\b/;

function parseRules(css) {
  const rules = [];
  const counter = { order: 0 };
  walk(parseBlocks(stripComments(css)), null, counter, rules);
  return rules;
}

function walk(blocks, condition, counter, rules) {
  for (const { prelude, body } of blocks) {
    if (prelude.startsWith('@')) {
      if (FLATTENED_AT.test(prelude)) {
        const inner = condition ? `${condition} and ${prelude}` : prelude;
        walk(parseBlocks(body), inner, counter, rules);
      }
      continue;
    }
    if (UNSCORABLE.test(prelude)) {
      throw new Error(`cannot score selector list (functional pseudo-class): ${prelude}`);
    }
    const decls = parseDecls(body);
    for (const selector of prelude.split(',').map((s) => s.trim()).filter(Boolean)) {
      rules.push({ selector, condition, order: counter.order++, decls });
    }
  }
}

// (ids, classes/attributes/pseudo-classes, elements)
function specificity(selector) {
  if (UNSCORABLE.test(selector)) {
    throw new Error(`cannot score selector (functional pseudo-class): ${selector}`);
  }
  let ids = 0;
  let classes = 0;
  let elements = 0;
  let rest = selector;
  // Attribute selectors first: their contents can hold quotes, dots and colons.
  rest = rest.replace(/\[[^\]]*\]/g, () => { classes++; return ' '; });
  rest = rest.replace(/::[-\w]+/g, () => { elements++; return ' '; });
  rest = rest.replace(/:[-\w]+(\([^)]*\))?/g, () => { classes++; return ' '; });
  rest = rest.replace(/#[-\w]+/g, () => { ids++; return ' '; });
  rest = rest.replace(/\.[-\w]+/g, () => { classes++; return ' '; });
  for (const token of rest.split(/[\s>+~]+/)) {
    const t = token.trim();
    if (!t || t === '*') continue;
    if (/^[-\w]+$/.test(t)) elements++;
  }
  return [ids, classes, elements];
}

const compareSpecificity = (a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]);

// The SUBJECT of the selector (its last compound) must carry the class: a
// descendant rule like `.roster-title *` styles a child, not the element.
// Deliberate omission (plan §10 style): a subject carrying a pseudo-element
// (`.roster-title::after`) is treated as targeting the element. There are 0
// `::` occurrences in the stylesheet today, and a future pseudo-element rule
// that declares a watched property should come through this test rather than
// past it.
function targets(selector, cls) {
  assert.match(cls, /^[-\w]+$/, 'class name must be a plain identifier');
  const compound = selector.trim().split(/\s*[\s>+~]\s*/).filter(Boolean).pop() || '';
  return new RegExp(`\\.${cls}(?![-\\w])`).test(compound);
}

// The winning declaration for `prop` on an element whose class set includes
// `cls`, or null when no rule declares it (the property is unset).
function cascade(rules, cls, prop) {
  let winner = null;
  for (const rule of rules) {
    if (!targets(rule.selector, cls)) continue;
    const decl = rule.decls.get(prop);
    if (!decl) continue;
    const candidate = {
      value: decl.value,
      important: decl.important,
      selector: rule.selector,
      order: rule.order,
      condition: rule.condition,
      spec: specificity(rule.selector),
    };
    if (winner === null || beats(candidate, winner)) winner = candidate;
  }
  return winner;
}

function beats(a, b) {
  if (a.important !== b.important) return a.important;
  const spec = compareSpecificity(a.spec, b.spec);
  if (spec !== 0) return spec > 0;
  return a.order > b.order;
}

// --- H1–H5: the helper's own unit cases --------------------------------------

test('css-cascade: a later rule of equal specificity wins', () => {
  const rules = parseRules(`
    .t { white-space: nowrap; }
    .t { white-space: normal; }
  `);
  assert.equal(rules.length, 2);
  const won = cascade(rules, 't', 'white-space');
  assert.equal(won.value, 'normal');
  assert.equal(won.order, 1);
});

test('css-cascade: higher specificity beats source order', () => {
  const rules = parseRules(`
    #r .t { white-space: normal; }
    .t { white-space: nowrap; }
  `);
  const won = cascade(rules, 't', 'white-space');
  assert.deepEqual(won.spec, [1, 1, 0]);
  assert.equal(won.value, 'normal');
  assert.equal(won.selector, '#r .t');
});

test('css-cascade: !important beats specificity and order', () => {
  const rules = parseRules(`
    .t { white-space: normal !important; }
    #r div.t:hover { white-space: nowrap; }
  `);
  const won = cascade(rules, 't', 'white-space');
  assert.equal(won.important, true);
  assert.equal(won.value, 'normal');
  // The loser outranks it on both other legs, so this is not an order artefact.
  assert.deepEqual(specificity('#r div.t:hover'), [1, 2, 1]);
});

test('css-cascade: rules inside @media compete, tagged with their condition', () => {
  const rules = parseRules(`
    .t { white-space: nowrap; }
    @media (max-width: 700px) {
      .t { white-space: normal; }
    }
    @keyframes pulse { from { white-space: normal; } to { white-space: normal; } }
  `);
  // @keyframes contributes nothing — its inner blocks are keyframe selectors.
  assert.equal(rules.length, 2, rules.map((r) => r.selector).join(' | '));
  const won = cascade(rules, 't', 'white-space');
  assert.equal(won.value, 'normal');
  assert.equal(won.condition, '@media (max-width: 700px)');
  // A descendant of the element is not the element.
  assert.equal(cascade(parseRules('.t * { white-space: normal; }'), 't', 'white-space'), null);
});

test('css-cascade: a selector it cannot score throws instead of guessing', () => {
  assert.throws(() => specificity('.t:not(.u)'), /cannot score selector/);
  assert.throws(() => specificity(':is(#a, .b) .t'), /cannot score selector/);
  assert.throws(() => parseRules('.t:has(> .u) { white-space: normal; }'), /cannot score selector/);
});

// --- T1: the standing guard --------------------------------------------------

// property -> the winners the contract allows. `null` means "unset": no rule
// targeting .roster-title may declare it at all, because any explicit value is
// a change to the contract and must come through this test.
const CONTRACT = [
  // the wrap switch
  ['white-space', ['nowrap']],
  // text-overflow is inert unless overflow is non-visible
  ['overflow', ['hidden']],
  // the longhand that can quietly re-open the inline axis
  ['overflow-x', [null, 'hidden']],
  // the visible half of the contract
  ['text-overflow', ['ellipsis']],
  // `inline` disables overflow/ellipsis; `-webkit-box` is the line-clamp door
  ['display', [null, 'block']],
  // modern longhands of white-space: a later `text-wrap: wrap` re-enables
  // wrapping with `white-space` untouched
  ['text-wrap', [null, 'nowrap']],
  ['text-wrap-mode', [null, 'nowrap']],
  ['white-space-collapse', [null]],
  ['line-clamp', [null]],
  ['-webkit-line-clamp', [null]],
  ['height', [null]],
  ['max-height', [null]],
];

test('truncation: AS-74 — the cascade leaves .roster-title nowrap, overflow hidden, ellipsis — no later or stronger rule re-enables wrapping', () => {
  const css = readFileSync(STYLESHEET, 'utf8');
  const rules = parseRules(css);

  // Cardinality before quantification (CLAUDE.md): how much was examined.
  const targeting = rules.filter((r) => targets(r.selector, 'roster-title'));
  const where = targeting
    .map((r) => `${r.condition ? `${r.condition} ` : ''}${r.selector} [spec ${specificity(r.selector).join(',')}, order ${r.order}]`)
    .join(' | ');
  assert.ok(rules.length > 100, `parsed only ${rules.length} rules from style.css — the parser, not the stylesheet, is suspect`);
  assert.ok(
    targeting.some((r) => r.selector === '.roster-title'),
    `the base .roster-title rule must be among the ${targeting.length} targeting selectors: ${where}`,
  );

  // Non-vacuous by construction: the assertion is on the WINNER'S VALUE, not
  // on a set. With zero rules targeting .roster-title every winner is unset
  // and `white-space` fails on its own — there is no empty-set way to pass.
  for (const [prop, allowed] of CONTRACT) {
    const won = cascade(rules, 'roster-title', prop);
    const value = won === null ? null : won.value;
    const by = won === null
      ? 'unset (no rule declares it)'
      : `${won.value} — won by ${won.condition ? `${won.condition} ` : ''}${won.selector} (spec ${won.spec.join(',')}, order ${won.order}${won.important ? ', !important' : ''})`;
    assert.ok(
      allowed.includes(value),
      `.roster-title ${prop}: effective value is ${by}; the contract allows ${allowed.map((a) => (a === null ? 'unset' : a)).join(' or ')}. `
      + `${rules.length} rules parsed, ${targeting.length} target .roster-title: ${where}`,
    );
  }
});
