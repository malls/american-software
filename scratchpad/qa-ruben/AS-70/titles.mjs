// Extract the failing-case titles (✖ lines, top level) from a mutant's saved log.
import { readFileSync } from 'node:fs';
const R = '/Users/forrest/Code/american-software-company/scratchpad/qa-ruben/AS-70/mut';
for (const name of process.argv.slice(2)) {
  const out = readFileSync(`${R}/${name}.log`, 'utf8');
  const titles = [...new Set(out.split('\n').filter((l) => /^✖ /.test(l)).map((l) => l.replace(/^✖ /, '').replace(/ \(\d+(\.\d+)?ms\)\s*$/, '')))];
  console.log(`${name} (${titles.length}):`);
  for (const t of titles) console.log(`  - ${t}`);
}
