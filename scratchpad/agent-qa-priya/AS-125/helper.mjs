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

const STYLESHEET = '/Users/forrest/Code/american-software-company/.worktrees/AS-125/apps/chat/public/style.css';

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
//
// AS-125 (AS-112 review C1): the parser does not tokenise strings, so a `{`
// or `}` inside a quoted value counts as a delimiter. Every way that can go
// wrong is made loud rather than left to mis-nest the rest of the file
// silently: an unclosed block at end of input (depth > 0), a stray `}` at
// depth 0 (depth < 0), and non-blank text after the last `}` (a statement
// at-rule at EOF, which no block ever picks up). Because walk() recurses into
// at-rule bodies through this function, the checks apply at every level.
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
      if (depth < 0) throw new Error(`unbalanced braces: stray '}' at offset ${i}`);
      if (depth === 0) {
        blocks.push({ prelude: prelude.trim(), body: src.slice(bodyStart, i) });
        preludeStart = i + 1;
      }
    }
  }
  if (depth !== 0) {
    throw new Error(`unbalanced braces: depth ${depth} at end of input (unclosed block opened by: ${prelude.trim()})`);
  }
  const trailing = src.slice(preludeStart).trim();
  if (trailing) throw new Error(`trailing content without a block: ${trailing}`);
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
// violation.
const FLATTENED_AT = /^@(media|supports|container)\b/;

// AS-125 (AS-112 review B1/B3): at-rules that declare nothing about an element
// are IGNORED wholesale — including their inner blocks, which are keyframe
// selectors or descriptors, not element selectors. This is an explicit list
// that grows deliberately: the two shapes the stylesheet uses plus the vendor
// twin. Anything else (`@scope`, block-form `@layer`, `@page`, `@property`,
// `@starting-style`, …) throws in walk() until someone adds it to one list or
// the other on purpose, because a swallowed `@scope (#r) { .t { … } }` is a
// rule the browser applies and the guard never scores.
const IGNORED_AT = /^@(-webkit-)?(keyframes|font-face)\b/;

function parseRules(css) {
  const rules = [];
  const counter = { order: 0 };
  walk(parseBlocks(stripComments(css)), null, counter, rules);
  return rules;
}

// AS-125 (AS-112 review A4): `.roster\-title` is the same class as
// `.roster-title` to a browser but not to a regex, so the escape is
// normalised when the rule is recorded. Only `\-` and `\_` are unescaped —
// silently unescaping `.md\:flex` into `.md:flex` would mis-score it as a
// pseudo-class, and a hex escape (`\2d `) needs a real tokeniser. Loud beats
// wrong: any other backslash throws.
function unescapeSelector(raw) {
  const out = raw.replace(/\\([-_])/g, '$1');
  if (out.includes('\\')) throw new Error(`cannot score selector (unsupported escape): ${raw}`);
  return out;
}

function walk(blocks, condition, counter, rules) {
  for (const { prelude, body } of blocks) {
    // AS-125 (AS-112 review B2): a `;` in a prelude is the signature of a
    // statement at-rule (`@import`, `@charset`, `@namespace`, `@layer a, b;`)
    // glued onto the next block's selector by parseBlocks — checked before
    // the `@` test because the glued prelude may or may not start with `@`.
    if (prelude.includes(';')) {
      throw new Error(`cannot score: statement at-rule or stray ';' glued into a prelude: ${prelude}`);
    }
    if (prelude.startsWith('@')) {
      if (FLATTENED_AT.test(prelude)) {
        const inner = condition ? `${condition} and ${prelude}` : prelude;
        walk(parseBlocks(body), inner, counter, rules);
        continue;
      }
      if (IGNORED_AT.test(prelude)) continue;
      throw new Error(`cannot score unknown at-rule (neither flattened nor ignored): ${prelude}`);
    }
    if (UNSCORABLE.test(prelude)) {
      throw new Error(`cannot score selector list (functional pseudo-class): ${prelude}`);
    }
    // AS-112 (AS-74 review P7): a style rule nested inside a style rule —
    // `#r { .t { … } }` or `.t { &:hover { … } }` — is valid CSS in every
    // current browser, but parseDecls would swallow it as one garbage
    // declaration and the inner rule would never compete. Fail loudly here,
    // where the prelude is in hand for the message, rather than score a
    // stylesheet this parser cannot read. (@keyframes/@font-face bodies are
    // skipped above and stay ignored wholesale.)
    if (body.includes('{')) {
      throw new Error(`cannot score nested style rule (native CSS nesting) under: ${prelude}`);
    }
    const decls = parseDecls(body);
    for (const raw of prelude.split(',').map((s) => s.trim()).filter(Boolean)) {
      rules.push({ selector: unescapeSelector(raw), condition, order: counter.order++, decls });
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

// The SUBJECT of a selector is its last compound: the text after the last
// combinator (whitespace, `>`, `+`, `~`) that sits OUTSIDE `[]` and `()`.
// A naive split on combinator characters cuts `[class~="roster-title"]` at
// its own `~` and examines `="roster-title"]` — which is how AS-112 review A3
// got past the old guard even after `[class…]` was recognised (AS-125 §0).
function lastCompound(selector) {
  let depth = 0;
  let cut = -1;
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (ch === '[' || ch === '(') depth++;
    else if (ch === ']' || ch === ')') depth--;
    else if (depth === 0 && /[\s>+~]/.test(ch)) cut = i;
  }
  return selector.slice(cut + 1).trim();
}

// Does a selector's SUBJECT reach an element whose class set includes `cls`?
// The title element (app.js rosterRow) is a `div` with exactly one class and
// a `title` attribute, so — AS-125 (AS-112 review A1–A4) — the subject targets
// it when any of:
//   (a) it carries the class literal (`.roster-title`, `div.roster-title:hover`);
//   (b) it carries an attribute selector on `class` — `[class~="roster-title"]`
//       and, conservatively, ANY `[class…]` operator, because the guard does
//       not evaluate attribute values and `[class^="roster-"]` really matches;
//   (c) after removing attribute selectors and pseudo-classes/elements, what
//       remains is empty, `*`, or `div` (case-insensitive) and the compound
//       carries no id and no other class. Pseudo-classes (`div:hover`,
//       `:first-child`) and non-class attribute selectors (`[title]` — the
//       element HAS one) are treated as matchable, not as ruling it out.
// Ancestors are NOT evaluated (`#nonexistent .roster-title` targets, and so
// does `.roster-title *` — the title holds a text node only, so a watched
// property on that shape has no legitimate use and the cost of the false
// positive is a loud red naming the selector). Pseudo-elements on the subject
// (`.roster-title::after`) are treated as targeting — unchanged from AS-74: a
// future pseudo-element rule declaring a watched property should come through
// this test rather than past it.
function targets(selector, cls) {
  assert.match(cls, /^[-\w]+$/, 'class name must be a plain identifier');
  const compound = lastCompound(selector.trim());
  if (new RegExp(`\\.${cls}(?![-\\w])`).test(compound)) return true;
  if (/\[\s*class\b/i.test(compound)) return true;
  let rest = compound.replace(/\[[^\]]*\]/g, '');
  if (/[.#]/.test(rest)) return false;
  rest = rest.replace(/::?[-\w]+(\([^)]*\))?/g, '');
  return rest === '' || rest === '*' || rest.toLowerCase() === 'div';
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


export { STYLESHEET, parseBlocks, parseDecls, parseRules, unescapeSelector, walk, specificity, lastCompound, targets, cascade, stripComments, UNSCORABLE, FLATTENED_AT, IGNORED_AT };
