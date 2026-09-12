// Re-derive the failing set + summary block from an existing battery log.
// usage: node analyze.mjs <log-file> [...]
import { readFileSync } from 'node:fs';

for (const path of process.argv.slice(2)) {
  const out = readFileSync(path, 'utf8');
  const all = out.split('\n');
  const headingAt = all.findIndex((l) => l.trim().endsWith('failing tests:'));
  const lines = headingAt === -1 ? all : all.slice(0, headingAt);
  const failed = lines.filter((l) => l.startsWith('✖ ')).map((l) => l.slice(2).replace(/ \([\d.]+ms\)$/, ''));
  const summary = lines.filter((l) => /^ℹ (tests|pass|fail|duration_ms)/.test(l));
  const msgs = new Set();
  for (const l of all) {
    const m = l.match(/AS-\d+(?:\/AS-\d+)? on-connect contract: [^']*/);
    if (m) msgs.add(m[0].trim().replace(/[,'"]+$/, ''));
  }
  console.log(`=== ${path}`);
  console.log(`has ℹ tests summary: ${/^ℹ tests/m.test(out)}`);
  console.log(summary.length ? summary.join('\n') : '(no summary block)');
  console.log(`failing cardinality: ${failed.length}`);
  for (const f of failed) console.log(`  - ${f}`);
  console.log('contract messages seen:');
  for (const m of msgs) console.log(`  * ${m}`);
  console.log('');
}
