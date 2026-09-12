// mutate.mjs — apply one AS-128 falsifier in place, asserting it lands at the
// intended site exactly once. Restore is `git -C .worktrees/AS-128 checkout --
// apps/invoicing` by the caller, then `git diff --exit-code`.
//   node mutate.mjs <M1|M2|M3|M4|M5|M6>
import { readFileSync, writeFileSync } from 'node:fs';

const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-128/apps/invoicing';

// Today's code: the bare call, no try. The catch is deleted, not shadowed, so
// a valid email still creates exactly one row and only the refusal changes.
const bareCreate = (locals) => ({
  from: new RegExp(`        let created;\n        try \\{\n          created = repos\\.clients\\.create\\(freelancerId, \\{ name: clientName, email \\}\\);\n        \\} catch \\(err\\) \\{\n(?:          //.*\n)*          if \\(err instanceof ValidationError && err\\.field === 'email'\\) \\{\n            return \\w+\\(res, ${locals}\\(\\{ \\.\\.\\.base, clientEmailRefused: true \\}\\)\\);\n          \\}\n          throw err;\n        \\}\n`, 'g'),
  to: `        const created = repos.clients.create(freelancerId, { name: clientName, email }); /* MUTANT bare */\n`,
  site: new RegExp(`case 'add-client': \\{[\\s\\S]*?MUTANT bare \\*/\n        return \\w+\\(res, ${locals}\\(\\{\n          \\.\\.\\.base,`),
});
const noTrim = () => ({
  from: '        const email = clientEmail.trim();',
  to: '        const email = clientEmail; /* MUTANT notrim */',
  site: /case 'add-client': \{[\s\S]*?MUTANT notrim[\s\S]*?findByEmail\(freelancerId, email\)/,
});
const ignoreFlag = () => ({
  from: "  const clientEmailRefused = intent === 'add-client' && input.clientEmailRefused === true;",
  to: "  const clientEmailRefused = false; /* MUTANT flag */",
  site: /const clientEmailRefused = false; \/\* MUTANT flag \*\/\n  const clientErrors = intent === 'add-client' \? clientFieldErrors\(values, clientEmailRefused\)/,
});

const MUTANTS = {
  M1: { file: `${WT}/routes/invoices.js`, ...bareCreate('invoiceFormLocals') },
  M2: { file: `${WT}/routes/invoices.js`, ...noTrim() },
  M3: { file: `${WT}/routes/contracts.js`, ...bareCreate('contractFormLocals') },
  M4: { file: `${WT}/routes/contracts.js`, ...noTrim() },
  M5: { file: `${WT}/lib/screens/invoice-form-view.js`, ...ignoreFlag() },
  M6: { file: `${WT}/lib/screens/contract-form-view.js`, ...ignoreFlag() },
};

const m = MUTANTS[process.argv[2]];
if (!m) { console.error('unknown mutant'); process.exit(2); }
const src = readFileSync(m.file, 'utf8');
const occurrences = m.from instanceof RegExp ? (src.match(m.from) ?? []).length : src.split(m.from).length - 1;
if (occurrences !== 1) { console.error(`pattern occurs ${occurrences} times, want 1`); process.exit(3); }
const out = src.replace(m.from, m.to);
if (out === src || !m.site.test(out)) { console.error('mutation did not land at the intended site'); process.exit(4); }
if ((out.match(/repos\.clients\.create\(/g) ?? []).length !== (src.match(/repos\.clients\.create\(/g) ?? []).length) {
  console.error('mutation changed the number of create calls'); process.exit(5);
}
writeFileSync(m.file, out);
console.log(`${process.argv[2]} applied at intended site in ${m.file}`);
