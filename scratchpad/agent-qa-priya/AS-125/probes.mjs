// probes.mjs — M6 probes against the branch helper (scratch copy; $W untouched).
import { readFileSync } from 'node:fs';
import { STYLESHEET, parseRules, targets, cascade, specificity, lastCompound } from './helper.mjs';

const results = [];
function probe(id, desc, fn) {
  let out;
  try { out = { ok: true, value: fn() }; } catch (e) { out = { ok: false, error: e.message }; }
  results.push({ id, desc, ...out });
  console.log(`${id}  ${desc}\n    -> ${out.ok ? JSON.stringify(out.value) : 'THROW: ' + out.error}`);
}
const win = (css, prop = 'white-space') => {
  const w = cascade(parseRules(css), 'roster-title', prop);
  return w === null ? null : `${w.value} by ${w.selector} spec ${w.spec.join(',')} order ${w.order}${w.condition ? ' cond ' + w.condition : ''}`;
};

// --- cardinality on the real stylesheet
const css = readFileSync(STYLESHEET, 'utf8');
const rules = parseRules(css);
const targeting = rules.filter((r) => targets(r.selector, 'roster-title'));
console.log(`STYLESHEET: ${rules.length} rules parsed; ${targeting.length} target .roster-title: ${targeting.map((r) => `${r.condition ? r.condition + ' ' : ''}${r.selector} [${specificity(r.selector).join(',')}, order ${r.order}]`).join(' | ')}`);
const subjects = new Map();
for (const r of rules) { const c = lastCompound(r.selector); subjects.set(c, (subjects.get(c) || 0) + 1); }
const typeOrUniversal = [...subjects.keys()].filter((c) => !/[.#]/.test(c.replace(/\[[^\]]*\]/g, '')));
console.log(`STYLESHEET: ${subjects.size} distinct subject compounds; type/universal/attr-only subjects: ${JSON.stringify(typeOrUniversal)}`);

// --- the eight routes, driven directly (base rule present so the winner must beat it)
const BASE = '.roster-title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }\n';
probe('A1', 'type subject with id ancestor', () => win(BASE + '#roster-list li.roster-row div { white-space: normal; }'));
probe('A2', 'universal subject', () => win(BASE + '#roster-list * { white-space: normal; }'));
probe('A3', 'attribute class selector, quoted', () => win(BASE + '[class~="roster-title"] { white-space: normal; }'));
probe('A3b', 'attribute class selector, unquoted', () => win(BASE + '[class~=roster-title] { white-space: normal; }'));
probe('A4', 'escaped hyphen', () => win(BASE + '.roster\\-title { white-space: normal; }'));
probe('B1', '@scope', () => win(BASE + '@scope (#roster-list) { .roster-title { white-space: normal; } }'));
probe('B2', '@import glued', () => win(BASE + '@import url("x.css");\n.roster-title { white-space: normal; }'));
probe('B3', '@layer block', () => win(BASE + '@layer x { .roster-title { white-space: normal !important; } }'));
probe('C1', 'unbalanced { in string', () => win(BASE + '.roster-status::after { content: "{"; }\n.roster-title { white-space: normal; }'));

// --- §6 probes
probe('P1', 'comment containing a brace before a wrapping rule', () => win(BASE + '/* { */ .roster-title { white-space: normal; }'));
probe('P2a', '/* inside a string, unbalanced (swallows to next */)', () => win(BASE + '.x::after { content: "/*"; }\n.roster-title { white-space: normal; }\n.y::after { content: "*/"; }'));
probe('P2b', '/* inside a string, balanced within the declaration', () => win(BASE + '.x::after { content: "/* */"; }\n.roster-title { white-space: normal; }'));
probe('P2c', '/* inside a string, never closed', () => win(BASE + '.x::after { content: "/*"; }\n.roster-title { white-space: normal; }'));
probe('P3a', '@supports nesting @media', () => win(BASE + '@supports (display: grid) { @media (min-width: 1px) { .roster-title { white-space: normal; } } }'));
probe('P3b', '@media nesting @supports', () => win(BASE + '@media (min-width: 1px) { @supports (display: grid) { .roster-title { white-space: normal; } } }'));
probe('P3c', '@media nested INSIDE a style rule', () => win(BASE + '.roster-title { @media (min-width: 1px) { white-space: normal; } }'));
probe('P4a', ':where(.roster-title)', () => win(BASE + ':where(.roster-title) { white-space: normal; }'));
probe('P4b', ':is(.roster-title)', () => win(BASE + ':is(.roster-title) { white-space: normal; }'));
probe('P4c', 'div:where(.roster-title) as subject', () => win(BASE + 'div:where(.roster-title) { white-space: normal; }'));
probe('P5a', 'custom-property indirection on the subject', () => win(BASE + '.roster-title { --ws: normal; white-space: var(--ws); }'));
probe('P5b', 'var defined on ancestor, used on subject', () => win(BASE + '#roster-list { --ws: normal; }\n.roster-title { white-space: var(--ws); }'));
probe('P5c', 'white-space: inherit on the subject', () => win(BASE + '.roster-title { white-space: inherit; }'));
probe('P6a', 'selector list with attribute member', () => win(BASE + 'a, [class~="roster-title"] { white-space: normal; }'));
probe('P6b', 'comma in an ancestor attribute value, AFTER base', () => win(BASE + '[title="a,b"] .roster-title { white-space: normal; }'));
probe('P6c', 'comma in an ancestor attribute value, BEFORE base (real spec 0,2,0 beats base 0,1,0)', () => win('[title="a,b"] .roster-title { white-space: normal; }\n' + BASE));
probe('P6d', 'same shape without the comma, BEFORE base (control: guard scores 0,2,0)', () => win('[title="ab"] .roster-title { white-space: normal; }\n' + BASE));
probe('P7a', 'DIV uppercase type', () => win(BASE + '#roster-list DIV { white-space: normal; }'));
probe('P7b', 'Div:Hover', () => win(BASE + '#roster-list Div:Hover { white-space: normal; }'));
probe('P7c', '*::before', () => win(BASE + '#roster-list *::before { white-space: normal; }'));
probe('P7d', '[CLASS~="roster-title"]', () => win(BASE + '[CLASS~="roster-title"] { white-space: normal; }'));
probe('P7e', '[class~="roster-title" i]', () => win(BASE + '[class~="roster-title" i] { white-space: normal; }'));
probe('P7f', '@-webkit-keyframes ignored not thrown', () => parseRules('@-webkit-keyframes p { from { white-space: normal; } }').length);
probe('P7g', '@FONT-FACE (case)', () => parseRules('@FONT-FACE { font-family: x; }').length);
probe('P7h', '@MEDIA (case)', () => win(BASE + '@MEDIA (min-width: 1px) { .roster-title { white-space: normal; } }'));
probe('P7i', '@-moz-keyframes (vendor not listed)', () => parseRules('@-moz-keyframes p { from { x: 1; } }').length);
probe('P8a', 'known FP: [hidden] { display: none }', () => win(BASE + '[hidden] { display: none; }', 'display'));
probe('P8b', 'known FP: [class^="org-"] { display: flex }', () => win(BASE + '[class^="org-"] { display: flex; }', 'display'));
probe('P8c', 'known false throw: [title=";"]', () => win(BASE + '[title=";"] { color: red; }'));
probe('P8d', 'known false throw: .md\\:flex', () => win(BASE + '.md\\:flex { display: flex; }'));
probe('P9a', 'unclosed inner block under @media — which call throws, is the inner prelude named', () => win(BASE + '@media (min-width: 1px) { .roster-title { white-space: normal; }'));
probe('P9b', 'unclosed inner block under @media, outer closed', () => win(BASE + '@media (min-width: 1px) { .roster-title { white-space: normal; } \n.x { color: red; }'));
probe('P10a', '#nonexistent .roster-title (ancestors not evaluated)', () => win(BASE + '#nonexistent .roster-title { white-space: normal; }'));
probe('P10b', '.roster-title * (the recorded change)', () => win(BASE + '.roster-title * { white-space: normal; }'));
probe('P10c', '.roster-title span (type rules it out)', () => win(BASE + '.roster-title span { white-space: normal; }'));

// --- my own cold edges
probe('Q1', ':root subject counts as targeting?', () => targets(':root', 'roster-title'));
probe('Q2', '*|div namespace-prefixed type subject', () => win(BASE + '*|div { white-space: normal !important; }'));
probe('Q2b', '*|* namespace-prefixed universal', () => win(BASE + '#roster-list *|* { white-space: normal !important; }'));
probe('Q3', '#r>div no-space child combinator', () => targets('#r>div', 'roster-title'));
probe('Q3b', '#r+div', () => targets('#r+div', 'roster-title'));
probe('Q3c', '#r~div', () => targets('#r~div', 'roster-title'));
probe('Q4', '.ROSTER-TITLE uppercase class (must NOT target: classes are case-sensitive)', () => targets('.ROSTER-TITLE', 'roster-title'));
probe('Q5', '[title="a]b"] — ] inside a value', () => targets('[title="a]b"]', 'roster-title'));
probe('Q6', 'empty prelude { white-space: normal }', () => parseRules('{ white-space: normal; }').length);
probe('Q7', 'div[title] subject', () => targets('#r div[title]', 'roster-title'));
probe('Q8', 'li.roster-row > :first-child', () => targets('li.roster-row > :first-child', 'roster-title'));
probe('Q9', 'li.roster-row > :nth-child(2n+1) — + inside parens must not cut', () => targets('li.roster-row > :nth-child(2n+1)', 'roster-title'));
probe('Q10', 'selector with newline as descendant combinator', () => targets('#r\n  div', 'roster-title'));
probe('Q11', '.roster-title.other compound (existing conservatism)', () => targets('.roster-title.other', 'roster-title'));
probe('Q12', 'escaped comma splits: .a\\,b', () => parseRules('.a\\,b { color: red; }').length);
probe('Q13', 'stray ; between rules at top level', () => parseRules('.a { color: red; } ; .b { color: blue; }').length);
probe('Q14', 'statement at-rule inside @media body at EOF of body', () => parseRules('@media (x) { .a { color: red; } @import url(x); }').length);
probe('Q15', 'declaration value with url(data:...;base64,...) — ; split noise', () => win(BASE + '.roster-title { background: url(data:image/png;base64,AAAA); }'));
probe('Q16', 'nested selector via & at top level (invalid CSS, browser drops)', () => targets('&.roster-title', 'roster-title'));
probe('Q17', 'div.roster-title::after pseudo-element subject', () => targets('div.roster-title::after', 'roster-title'));
probe('Q18', 'attribute subject with escaped bracket in value [title="a\\]b"]', () => targets('[title="a\\]b"]', 'roster-title'));
probe('Q19', 'white-space property in UPPERCASE', () => win(BASE + '.roster-title { WHITE-SPACE: NORMAL; }'));
probe('Q20', 'property with trailing space before colon', () => win(BASE + '.roster-title { white-space : normal ; }'));
probe('Q21', 'the escape normaliser on an ancestor: .foo\\-bar .roster-title', () => parseRules('.foo\\-bar .roster-title { color: red; }')[0].selector);
probe('Q22', '\\_ unescape', () => parseRules('.roster\\_title { color: red; }')[0].selector);
probe('Q23', 'double backslash then hyphen .a\\\\-b', () => parseRules('.a\\\\-b { color: red; }').length);
