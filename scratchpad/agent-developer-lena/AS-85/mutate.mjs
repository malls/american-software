// AS-85 mutation helper. Literal, single-site replace with a hard assertion
// that the site was unique — a mutation that lands somewhere else looks exactly
// like a passing guard (CLAUDE.md, AS-95 rework cycle 1).
import { readFileSync, writeFileSync } from 'node:fs';
const [file, find, replace] = process.argv.slice(2);
const src = readFileSync(file, 'utf8');
const n = src.split(find).length - 1;
if (n !== 1) {
  console.error(`ABORT: anchor matched ${n} times in ${file} (need exactly 1)`);
  process.exit(2);
}
writeFileSync(file, src.replace(find, replace));
const after = readFileSync(file, 'utf8');
console.log(`anchor-before=1 anchor-after=${after.split(find).length - 1} mutant-after=${after.split(replace).length - 1}`);
