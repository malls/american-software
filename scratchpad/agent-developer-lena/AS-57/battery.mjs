#!/usr/bin/env node
// AS-57 cycle 2: run a list of mutate.mjs recipes back to back, printing only the
// receipt line, the counts, the red set, and the porcelain check for each.
//   node battery.mjs <prefix> <recipe> [<recipe> ...]
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const SP = '/Users/forrest/Code/american-software-company/scratchpad/agent-developer-lena/AS-57';
const [prefix, ...recipes] = process.argv.slice(2);
if (!prefix || recipes.length === 0) { console.error('usage: battery.mjs <prefix> <recipe>...'); process.exit(2); }
let worst = 0;
for (const recipe of recipes) {
  console.log(`### ${recipe}`);
  const r = spawnSync('node', [join(SP, 'mutate.mjs'), `${prefix}-${recipe}`, recipe], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = `${r.stdout}${r.stderr}`;
  for (const line of out.split('\n')) {
    if (/built:|tests=|^✖|porcelain|^--- end|DID NOT|check-ignore/.test(line)) console.log(line);
  }
  if (r.status === 99 || r.status === 2) worst = r.status;
}
process.exit(worst);
