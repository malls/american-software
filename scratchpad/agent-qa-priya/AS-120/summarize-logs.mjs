// AS-120 review (qa-priya): summarize surviving compose logs — Built line, TAP totals, not-ok test names.
import { readdirSync, readFileSync } from 'node:fs';
const dir = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/AS-120';
for (const f of readdirSync(dir).filter((n) => n.endsWith('.log')).sort()) {
  const out = readFileSync(`${dir}/${f}`, 'utf8');
  const lines = out.split('\n');
  const built = lines.filter((l) => /Built/.test(l)).map((l) => l.trim());
  const totals = lines.filter((l) => /^# (tests|pass|fail|skipped|cancelled|todo) /.test(l)).map((l) => l.trim());
  const notok = lines.filter((l) => /^\s*not ok/.test(l)).map((l) => l.trim());
  // Files actually run: node --test prints "# Subtest: <file>" only for top-level; find test file names referenced
  const files = new Set();
  for (const l of lines) { const m = l.match(/(apps\/chat\/)?test\/([\w.-]+\.test\.js)/); if (m) files.add(m[2]); }
  // Which mutant: look for failure messages naming an operator/mechanism
  const msgs = lines.filter((l) => /error:|MUTANT|expected|actual|violation|mechanism|op:/i.test(l)).slice(0, 12).map((l) => l.trim());
  console.log(`=== ${f} (${out.length} bytes, ${lines.length} lines)`);
  console.log('Built:', built.join(' | ') || '(NONE)');
  console.log('Totals:', totals.join(' ') || '(NONE)');
  console.log('Files referenced:', [...files].join(', '));
  console.log('not ok:', notok.length ? notok.join('\n        ') : '(none)');
  if (notok.length) console.log('msgs:', msgs.join('\n      '));
  console.log('tail:', lines.slice(-3).join(' / '));
}
