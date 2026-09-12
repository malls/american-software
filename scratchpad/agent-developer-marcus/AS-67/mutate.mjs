// mutate.mjs — apply one AS-67 falsifier in place, asserting it lands at the
// intended site exactly once. Restore is `git checkout -- <file>` by the caller.
//   node mutate.mjs <F1|F2|F3|F4>
import { readFileSync, writeFileSync } from 'node:fs';

const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-67/apps/invoicing';
const MUTANTS = {
  F1: {
    file: `${WT}/lib/db/repositories/clients.js`,
    from: "const email = assertEmail(input.email, 'email');",
    to: "const email = assertText(input.email, 'email'); /* MUTANT F1 */",
    site: /function create\(db, \{ now, newId \}, freelancerId, input\) \{[\s\S]*?MUTANT F1[\s\S]*?\n\}/,
  },
  F2: {
    file: `${WT}/lib/db/repositories/clients.js`,
    from: "values.push(assertEmail(patch.email, 'email'));",
    to: "values.push(assertText(patch.email, 'email')); /* MUTANT F2 */",
    site: /function update\(db, \{ now \}, freelancerId, id, patch\) \{[\s\S]*?MUTANT F2[\s\S]*?\n\}/,
  },
  F3: {
    file: `${WT}/lib/db/errors.js`,
    from: "  if (typeof value !== 'string' || value.length > EMAIL_MAX) return false;\n  const at = value.indexOf('@');",
    to: "  return typeof value === 'string'; /* MUTANT F3 */\n  const at = value.indexOf('@');",
    site: /export function isEmailShape\(value\) \{\n  return typeof value === 'string'; \/\* MUTANT F3 \*\//,
  },
  F4: {
    file: `${WT}/lib/db/errors.js`,
    from: 'export const EMAIL_MAX = 254;',
    to: 'export const EMAIL_MAX = 1000; /* MUTANT F4 */',
    site: /export const EMAIL_MAX = 1000; \/\* MUTANT F4 \*\//,
  },
};

const m = MUTANTS[process.argv[2]];
if (!m) { console.error('unknown mutant'); process.exit(2); }
const src = readFileSync(m.file, 'utf8');
const occurrences = src.split(m.from).length - 1;
if (occurrences !== 1) { console.error(`pattern occurs ${occurrences} times, want 1`); process.exit(3); }
const out = src.replace(m.from, m.to);
if (!m.site.test(out)) { console.error('mutation did not land at the intended site'); process.exit(4); }
writeFileSync(m.file, out);
console.log(`${process.argv[2]} applied at intended site in ${m.file}`);
