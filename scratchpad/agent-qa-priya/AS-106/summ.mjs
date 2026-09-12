// qa-priya AS-106 review helper: summarize a node --test log: failing set + counts + last lines.
import { readFileSync } from 'node:fs';
for (const f of process.argv.slice(2)) {
  const out = readFileSync(f, 'utf8');
  const lines = out.split('\n');
  const red = [...new Set(lines.filter((l) => /^✖ /.test(l)).map((l) => l.replace(/ \(\d+(\.\d+)?ms\)$/, '')))];
  const sum = lines.filter((l) => /^ℹ (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) /.test(l));
  const built = lines.filter((l) => /Built|BUILT|LEAK|RECEIPT|receipt|down exit|teardown/i.test(l)).slice(0, 12);
  console.log(`=== ${f.split('/').pop()} (${lines.length} lines; last line: ${JSON.stringify(lines.filter(Boolean).at(-1)?.slice(0, 120))})`);
  console.log(`  red (${red.length}): ${JSON.stringify(red)}`);
  console.log(`  summary: ${sum.join(' | ')}`);
  if (built.length) console.log(`  receipt-ish lines:\n    ${built.join('\n    ')}`);
}
