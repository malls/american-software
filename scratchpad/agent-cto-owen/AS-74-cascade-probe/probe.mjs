// AS-74 planning probe (cto-owen, 2026-09-11): can a dependency-free cascade
// computation over the stylesheet see Ruben's mutant — a LATER rule that
// re-enables wrapping on .roster-title? Record, not deliverable.
import { readFileSync } from 'node:fs';

function stripComments(css) { return css.replace(/\/\*[\s\S]*?\*\//g, ''); }

// Flatten @media / @supports / @container: every inner rule competes, tagged
// with its condition. Conservative for a contract stated "at every width".
function parseRules(css) {
  const src = stripComments(css);
  const rules = [];
  function blockEnd(open) {
    let depth = 0;
    for (let j = open; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (depth === 0) return j + 1; }
    }
    throw new Error('unbalanced braces');
  }
  function walk(from, to, cond) {
    let p = from;
    while (p < to) {
      const open = src.indexOf('{', p);
      if (open === -1 || open >= to) break;
      const head = src.slice(p, open).trim();
      const end = blockEnd(open);
      if (head.startsWith('@')) {
        if (/^@(media|supports|container)/.test(head)) walk(open + 1, end - 1, cond ? `${cond} && ${head}` : head);
      } else {
        const body = src.slice(open + 1, end - 1);
        const decls = body.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
          const c = d.indexOf(':');
          const prop = d.slice(0, c).trim().toLowerCase();
          const raw = d.slice(c + 1).trim();
          const important = /!important$/i.test(raw);
          return { prop, value: raw.replace(/\s*!important$/i, '').trim(), important };
        });
        for (const sel of head.split(',').map((s) => s.trim()).filter(Boolean)) {
          rules.push({ selector: sel, decls, cond, order: rules.length });
        }
      }
      p = end;
    }
  }
  walk(0, src.length, '');
  return rules;
}

// (ids, classes, elements). Refuses selectors it cannot score.
function specificity(sel) {
  if (/:(is|where|not|has)\(/.test(sel)) throw new Error(`unscored selector: ${sel}`);
  const s = sel.replace(/\[[^\]]*\]/g, '[]');
  const ids = (s.match(/#[\w-]+/g) || []).length;
  const classes = (s.match(/\.[\w-]+|\[\]|(?<!:):[\w-]+(\([^)]*\))?/g) || []).length;
  const stripped = s.replace(/#[\w-]+|\.[\w-]+|\[\]|::?[\w-]+(\([^)]*\))?/g, ' ');
  const elements = (stripped.match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) || []).length;
  return [ids, classes, elements];
}

// Does the selector's SUBJECT (last compound) carry .cls?
function targets(sel, cls) {
  const subject = sel.split(/\s*[>+~]\s*|\s+/).filter(Boolean).at(-1);
  return subject.split(/(?=[.#:[])/).includes(`.${cls}`);
}

function cascade(rules, cls, prop) {
  let win = null;
  for (const r of rules) {
    if (!targets(r.selector, cls)) continue;
    for (const d of r.decls) {
      if (d.prop !== prop) continue;
      const cand = { ...d, selector: r.selector, cond: r.cond, order: r.order, spec: specificity(r.selector) };
      if (!win) { win = cand; continue; }
      if (cand.important !== win.important) { if (cand.important) win = cand; continue; }
      const cmp = cand.spec.map((x, k) => x - win.spec[k]).find((x) => x !== 0) ?? 0;
      if (cmp > 0 || (cmp === 0 && cand.order > win.order)) win = cand;
    }
  }
  return win;
}

const css = readFileSync(process.argv[2], 'utf8') + (process.argv[3] ? `\n${process.argv[3]}\n` : '');
const rules = parseRules(css);
const hits = rules.filter((r) => targets(r.selector, 'roster-title'));
console.log('rules parsed:', rules.length, '| targeting .roster-title:', hits.length,
  hits.map((h) => h.selector + (h.cond ? ` @ ${h.cond}` : '')));
const PROPS = ['white-space', 'overflow', 'overflow-x', 'text-overflow', 'display', 'text-wrap', 'text-wrap-mode', 'white-space-collapse', 'height', 'max-height', 'line-clamp', '-webkit-line-clamp'];
for (const p of PROPS) {
  const w = cascade(rules, 'roster-title', p);
  console.log(p.padEnd(22), w ? `${w.value}  <- ${w.selector}${w.cond ? ` @ ${w.cond}` : ''} spec=${w.spec} order=${w.order}${w.important ? ' !important' : ''}` : '(unset)');
}
