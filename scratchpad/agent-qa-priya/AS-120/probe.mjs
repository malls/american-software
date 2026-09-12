// AS-120 review (qa-priya) — M6 probes past the list. Extracts ASSIGN_OP/HREF_ASSIGN/HREF_COMPOUND/
// ALLOWED_RHS/classifyHrefAssignments/MECHANISMS VERBATIM from the branch test file and drives inputs
// the plan did not enumerate. Reports, per input: T8 count, violations, and which MECHANISMS fire.
import { readFileSync } from 'node:fs';
const src = readFileSync('/Users/forrest/Code/american-software-company/.worktrees/AS-120/apps/chat/test/link-sites.test.js', 'utf8');
function grab(re) { const m = src.match(re); if (!m) throw new Error('grab failed ' + re); return m[0]; }
const defs = [
  grab(/const ASSIGN_OP = [^\n]*\n/),
  grab(/const HREF_ASSIGN = [^\n]*\n/),
  grab(/const HREF_COMPOUND = [^\n]*\n/),
  grab(/const ALLOWED_RHS = [^\n]*\n/),
  grab(/function classifyHrefAssignments\(source\) \{[\s\S]*?\n\}\n/),
  grab(/const MECHANISMS = \[[\s\S]*?\n\];\n/),
].join('\n');
const fn = new Function(defs + '\nreturn { classifyHrefAssignments, MECHANISMS, HREF_ASSIGN, HREF_COMPOUND };');
const { classifyHrefAssignments, MECHANISMS } = fn();

const probes = {
  // honest-mistake-shaped spellings not in the plan §3 nor my AS-98 probes
  'P-newline-op':      "const pd = el('a'); pd.href\n      = task.taskId;",
  'P-default-or':      'open.href = open.href || dashHref(task.taskId);',
  'P-append-frag':     "open.href = dashHref(task.taskId) + '#top';",
  'P-ternary-rhs':     "open.href = task.taskId ? dashHref(task.taskId) : '#';",
  'P-nullish-rhs':     "const pv = el('a'); pv.href = pv.href ?? task.taskId;",
  'P-chain-assign':    'a.href = b.href = dashHref(task.taskId);',
  'P-comma-second':    'a.href = dashHref(task.taskId), b.href = task.taskId;',
  'P-ternary-assign':  'cond ? (a.href = dashHref(task.taskId)) : (b.href = task.taskId);',
  'P-paren-rhs':       'a.href = (dashHref(task.taskId));',
  'P-new-url':         'a.href = new URL(task.taskId, location).href;',
  'P-location':        'location.href = task.taskId;',
  'P-backtick-key':    'open[`href`] = task.taskId;',
  'P-backtick-setattr': 'open.setAttribute(`href`, task.taskId);',
  'P-defineProperties': 'Object.defineProperties(open, { href: { value: task.taskId } });',
  'P-attr-node':       "const at = document.createAttribute('href'); at.value = task.taskId; open.setAttributeNode(at);",
  'P-comment-between': 'a.href /* x */ = task.taskId;',
  'P-space-dot':       'a . href = task.taskId;',
  'P-dot-newline':     "document.querySelector('#x')\n  .href = task.taskId;",
  'P-spread-assign':   'Object.assign(a, { href: task.taskId });',
  'P-href-no-space':   'a.href=task.taskId;',
  'P-href-ops-nospace': 'a.href||=task.taskId;',
  'P-unicode-tab':     'a.href\t||=\ttask.taskId;',
  'P-gt-gt-gt':        'a.href >>>= task.taskId;',
  'P-star-star':       'a.href **= task.taskId;',
  'P-hrefLang':        'a.hreflang = task.taskId;',   // must NOT count
  'P-dataHref':        'a.dataset.href = task.taskId;', // counts? (.href = ... matches) — false positive, not a hole
  'P-multiline-permalink': src.match(/'a\.href = serializeChatUrl\([\s\S]*?\);'/)?.[0] ?? '(no multi-line fixture found)',
};
for (const [name, input] of Object.entries(probes)) {
  const { count, violations } = classifyHrefAssignments(input);
  const mech = MECHANISMS.filter(([, re]) => re.test(input)).map(([n]) => n);
  const t8 = count > 0 && violations.length > 0 ? 'T8-red(violation)' : count > 0 ? 'T8-red-only-if-count-moves' : 'T8-blind';
  const t9 = mech.length ? `T9-red(${mech.join(',')})` : 'T9-blind';
  console.log(`${name.padEnd(22)} count=${count} viol=${JSON.stringify(violations)} ${t8} ${t9}`);
}
