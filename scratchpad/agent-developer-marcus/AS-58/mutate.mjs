// mutate.mjs — apply one AS-58 falsifier in place, asserting it lands at the
// intended site exactly once. Restore is `git -C .worktrees/AS-58 checkout --
// apps/invoicing` by the caller, then `git diff --exit-code`.
//   node mutate.mjs <F1|F2|F3|F4>
import { readFileSync, writeFileSync } from 'node:fs';

const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-58/apps/invoicing';

const MUTANTS = {
  // AC 1: the client sets a user-agent of its own.
  F1: {
    file: `${WT}/lib/stripe/client.js`,
    from: "  const headers = { accept: 'application/json', 'stripe-version': apiVersion };",
    to: "  const headers = { accept: 'application/json', 'stripe-version': apiVersion, 'user-agent': 'asc' }; /* MUTANT F1 */",
    site: /function buildUnsigned\(\{ base, apiVersion \}, call\) \{\n  const url = new URL\(call\.path, base\);\n  const headers = \{[^\n]*MUTANT F1/,
  },
  // AC 2: an UNSET secret redacts to "[redacted]" instead of staying null.
  F2: {
    file: `${WT}/lib/config.js`,
    from: "      for (const row of schema) out[row.key] = row.secret && resolved[row.key] !== null ? '[redacted]' : resolved[row.key];",
    to: "      for (const row of schema) out[row.key] = row.secret ? '[redacted]' : resolved[row.key]; /* MUTANT F2 */",
    site: /Object\.defineProperty\(resolved, 'redacted', \{[\s\S]*?MUTANT F2 \*\/\n      return out;/,
  },
  // AC 3: the separator set reverts to `&` only.
  F3: {
    file: `${WT}/lib/stripe/custody.js`,
    from: 'const PAIR_SEPARATOR = /[&;]/g;',
    to: 'const PAIR_SEPARATOR = /[&]/g; /* MUTANT F3 */',
    site: /MUTANT F3 \*\/\n\nfunction decodeForm\(text\) \{\n  return new URLSearchParams\(text\.replace\(PAIR_SEPARATOR, '&'\)\);/,
  },
  // AC 4: the config object comes back onto /healthz.
  F4: {
    file: `${WT}/routes/health.js`,
    from: '    res.status(result.ok ? 200 : 503).json({ ok: result.ok, checks: result.checks });',
    to: '    res.status(result.ok ? 200 : 503).json({ ok: result.ok, checks: result.checks, config: config.redacted?.() ?? null }); /* MUTANT F4 */',
    site: /router\.get\('\/healthz', \(req, res\) => \{[\s\S]*?config: config\.redacted\?\.\(\) \?\? null \}\); \/\* MUTANT F4 \*\//,
  },
};

const m = MUTANTS[process.argv[2]];
if (!m) { console.error('unknown mutant'); process.exit(2); }
const src = readFileSync(m.file, 'utf8');
const occurrences = src.split(m.from).length - 1;
if (occurrences !== 1) { console.error(`pattern occurs ${occurrences} times, want 1`); process.exit(3); }
const out = src.replace(m.from, m.to);
if (out === src || !m.site.test(out)) { console.error('mutation did not land at the intended site'); process.exit(4); }
writeFileSync(m.file, out);
console.log(`${process.argv[2]} applied at intended site in ${m.file}`);
