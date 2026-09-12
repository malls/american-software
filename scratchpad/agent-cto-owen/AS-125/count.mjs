// AS-125 planning spike (cto-owen): proposed parser/targets changes, measured
// against style.css and Ruben's eight routes. Throwaway — the real edit lands
// in test/roster-truncation.test.js.
import { readFileSync } from 'node:fs';
const STYLESHEET = new URL('../../../apps/chat/public/style.css', import.meta.url);
const UNSCORABLE = /:(is|where|not|has)\(/;
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

function parseBlocks(src) {
  const blocks = [];
  let depth = 0, preludeStart = 0, prelude = '', bodyStart = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') {
      if (depth === 0) { prelude = src.slice(preludeStart, i); bodyStart = i + 1; }
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth < 0) throw new Error(`unbalanced braces: stray '}' at offset ${i}`);
      if (depth === 0) { blocks.push({ prelude: prelude.trim(), body: src.slice(bodyStart, i) }); preludeStart = i + 1; }
    }
  }
  if (depth !== 0) throw new Error(`unbalanced braces: depth ${depth} at end of input (unclosed block opened by: ${prelude.trim()})`);
  const trailing = src.slice(preludeStart).trim();
  if (trailing) throw new Error(`trailing content without a block: ${trailing}`);
  return blocks;
}
function parseDecls(body) {
  const decls = new Map();
  for (const raw of body.split(';')) {
    const part = raw.trim(); if (!part) continue;
    const colon = part.indexOf(':'); if (colon === -1) continue;
    const prop = part.slice(0, colon).trim().toLowerCase();
    let value = part.slice(colon + 1).trim(); let important = false;
    if (/!\s*important$/i.test(value)) { important = true; value = value.replace(/!\s*important$/i, '').trim(); }
    decls.set(prop, { value: value.toLowerCase(), important });
  }
  return decls;
}
const FLATTENED_AT = /^@(media|supports|container)\b/;
const IGNORED_AT = /^@(-webkit-)?(keyframes|font-face)\b/;
function parseRules(css) { const rules = []; walk(parseBlocks(stripComments(css)), null, { order: 0 }, rules); return rules; }
// CSS identifier escapes: `\-` -> `-`. Only the single-character form; a hex
// escape (`\2d `) or anything else left with a backslash throws.
function unescapeSelector(raw) {
  const out = raw.replace(/\\([^0-9a-fA-F\s])/g, '$1');
  if (out.includes('\\')) throw new Error(`cannot score selector (unsupported escape): ${raw}`);
  return out;
}
function walk(blocks, condition, counter, rules) {
  for (const { prelude, body } of blocks) {
    if (prelude.includes(';')) throw new Error(`cannot score: statement at-rule or stray ';' glued into a prelude: ${prelude}`);
    if (prelude.startsWith('@')) {
      if (FLATTENED_AT.test(prelude)) { walk(parseBlocks(body), condition ? `${condition} and ${prelude}` : prelude, counter, rules); continue; }
      if (IGNORED_AT.test(prelude)) continue;
      throw new Error(`cannot score unknown at-rule (neither flattened nor ignored): ${prelude}`);
    }
    if (UNSCORABLE.test(prelude)) throw new Error(`cannot score selector list (functional pseudo-class): ${prelude}`);
    if (body.includes('{')) throw new Error(`cannot score nested style rule (native CSS nesting) under: ${prelude}`);
    const decls = parseDecls(body);
    for (const raw of prelude.split(',').map((s) => s.trim()).filter(Boolean)) {
      rules.push({ selector: unescapeSelector(raw), raw, condition, order: counter.order++, decls });
    }
  }
}
function specificity(selector) {
  if (UNSCORABLE.test(selector)) throw new Error(`cannot score selector (functional pseudo-class): ${selector}`);
  let ids = 0, classes = 0, elements = 0, rest = selector;
  rest = rest.replace(/\[[^\]]*\]/g, () => { classes++; return ' '; });
  rest = rest.replace(/::[-\w]+/g, () => { elements++; return ' '; });
  rest = rest.replace(/:[-\w]+(\([^)]*\))?/g, () => { classes++; return ' '; });
  rest = rest.replace(/#[-\w]+/g, () => { ids++; return ' '; });
  rest = rest.replace(/\.[-\w]+/g, () => { classes++; return ' '; });
  for (const token of rest.split(/[\s>+~]+/)) { const t = token.trim(); if (!t || t === '*') continue; if (/^[-\w]+$/.test(t)) elements++; }
  return [ids, classes, elements];
}
// The element is a <div class="roster-title" title="…"> (app.js rosterRow).
// A subject compound targets it when: (a) it carries the class literal;
// (b) it carries an attribute selector on `class` (any operator — conservative);
// (c) it constrains the element by nothing that rules the div out: no id, no
// other class, and a type of `div`, `*`, or none. Pseudo-classes and other
// attribute selectors (the div has a `title` attribute) are assumed matchable.
// The subject is the last compound: everything after the last combinator that
// sits OUTSIDE brackets/parens. A naive split on [\s>+~] cuts `[class~="x"]`
// at its `~` (observed in the AS-125 spike: A3 survived for this reason too).
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
function targets(selector, cls) {
  const compound = lastCompound(selector.trim());
  if (new RegExp(`\\.${cls}(?![-\\w])`).test(compound)) return true;
  if (/\[\s*class\b/i.test(compound)) return true;
  let rest = compound.replace(/\[[^\]]*\]/g, '');
  if (/[.#]/.test(rest)) return false;
  rest = rest.replace(/::?[-\w]+(\([^)]*\))?/g, '');
  return rest === '' || rest === '*' || rest.toLowerCase() === 'div';
}
function cascade(rules, cls, prop) {
  let winner = null;
  for (const rule of rules) {
    if (!targets(rule.selector, cls)) continue;
    const decl = rule.decls.get(prop); if (!decl) continue;
    const c = { value: decl.value, important: decl.important, selector: rule.selector, order: rule.order, condition: rule.condition, spec: specificity(rule.selector) };
    if (winner === null || beats(c, winner)) winner = c;
  }
  return winner;
}
const cmp = (a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]);
function beats(a, b) { if (a.important !== b.important) return a.important; const s = cmp(a.spec, b.spec); if (s !== 0) return s > 0; return a.order > b.order; }
const CONTRACT = [['white-space',['nowrap']],['overflow',['hidden']],['overflow-x',[null,'hidden']],['text-overflow',['ellipsis']],['display',[null,'block']],['text-wrap',[null,'nowrap']],['text-wrap-mode',[null,'nowrap']],['white-space-collapse',[null]],['line-clamp',[null]],['-webkit-line-clamp',[null]],['height',[null]],['max-height',[null]],['all',[null]]];

function t1(css) {
  const rules = parseRules(css);
  const targeting = rules.filter((r) => targets(r.selector, 'roster-title'));
  const fails = [];
  for (const [prop, allowed] of CONTRACT) {
    const won = cascade(rules, 'roster-title', prop);
    const v = won === null ? null : won.value;
    if (!allowed.includes(v)) fails.push(`${prop}=${v} by ${won.selector} spec ${won.spec} order ${won.order}${won.important ? ' !important' : ''}`);
  }
  return { rules: rules.length, targeting: targeting.map((r) => `${r.condition ? r.condition + ' ' : ''}${r.selector} [${specificity(r.selector)}]`), fails };
}


const oldT=(sel,cls)=>{const c=sel.trim().split(/\s*[\s>+~]\s*/).filter(Boolean).pop()||"";return new RegExp(`\\.${cls}(?![-\\w])`).test(c)};
const rules=parseRules(readFileSync(STYLESHEET,"utf8"));console.log("rules",rules.length,"old targeting:",rules.filter(r=>oldT(r.selector,"roster-title")).map(r=>(r.condition||"")+" "+r.selector));console.log("new targeting:",rules.filter(r=>targets(r.selector,"roster-title")).map(r=>(r.condition||"")+" "+r.selector));