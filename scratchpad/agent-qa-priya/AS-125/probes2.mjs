import { parseRules, targets, cascade } from './helper.mjs';
const win = (css, prop = 'white-space') => {
  const w = cascade(parseRules(css), 'roster-title', prop);
  return w === null ? null : `${w.value} by ${w.selector} spec ${w.spec.join(',')} order ${w.order}${w.important ? ' !important' : ''}`;
};
const BASE = '.roster-title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }\n';
const p = (id, d, f) => { try { console.log(id, d, '->', JSON.stringify(f())); } catch (e) { console.log(id, d, '-> THROW:', e.message); } };
p('N1a', 'comma in the SUBJECT attribute value, AFTER base, !important', () => win(BASE + '[title="a,b"] { white-space: normal !important; }'));
p('N1b', 'split halves recorded as', () => parseRules('[title="a,b"] { white-space: normal; }').map((r) => r.selector));
p('N1c', 'div[title*=","] AFTER base', () => win(BASE + 'div[title*=","] { white-space: normal; }'));
p('N1d', 'comma in an ANCESTOR value BEFORE base', () => win('[data-x="a,b"] .roster-title { white-space: normal; }\n' + BASE));
p('N2a', '*|div AFTER base, no !important', () => win(BASE + '#roster-list *|div { white-space: normal; }'));
p('N2b', 'targets("*|div")', () => targets('*|div', 'roster-title'));
p('N2c', 'targets("|div") (no-namespace: does NOT match HTML elements in a browser)', () => targets('|div', 'roster-title'));
p('N2d', 'targets("svg|*")', () => targets('svg|*', 'roster-title'));
p('X1', 'H4 control .t span -> null', () => cascade(parseRules('.t span { white-space: normal; }'), 't', 'white-space'));
p('X2', 'attribute value containing a combinator on the SUBJECT: [title="a>b"]', () => targets('[title="a>b"]', 'roster-title'));
p('X3', 'attribute value with ] in it on subject: [title="a]b"] — recorded direction', () => win(BASE + '[title="a]b"] { white-space: normal !important; }'));
