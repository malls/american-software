// Cut two compose stdouts at the walkthrough banner, write the first as the
// transcript candidate, and compare the two normalised (SKILL step 1 rules:
// ids, timestamps, signature digests, loopback port, plus UUIDs).
import { readFileSync, writeFileSync } from 'node:fs';

const [a, b, outFile] = process.argv.slice(2);
const BANNER = 'D1 core-loop walkthrough (AS-90)';
const cut = (p) => {
  const s = readFileSync(p, 'utf8');
  const i = s.indexOf(BANNER);
  if (i < 0) throw new Error(`${p}: no banner`);
  return s.slice(i);
};
const norm = (s) => s
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>')
  .replace(/\b(acct|in|cus|ii|il|evt|sub|pi|ch|tr)_[A-Za-z0-9]+/g, '$1_<id>')
  .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<iso>')
  .replace(/t=\d+,v1=[0-9a-f]+/g, 't=<t>,v1=<hex>')
  .replace(/127\.0\.0\.1:\d+/g, '127.0.0.1:<port>')
  .replace(/\b1[0-9]{9}\b/g, '<epoch>');
const ta = cut(a);
const tb = cut(b);
if (outFile) writeFileSync(outFile, ta);
const na = norm(ta).split('\n');
const nb = norm(tb).split('\n');
let diffs = 0;
for (let i = 0; i < Math.max(na.length, nb.length); i += 1) {
  if (na[i] !== nb[i]) { diffs += 1; if (diffs <= 10) console.log(`line ${i + 1}:\n  A: ${na[i]}\n  B: ${nb[i]}`); }
}
console.log(`cut A: ${ta.split('\n').length} lines; cut B: ${tb.split('\n').length} lines; normalised differing lines: ${diffs}; byte-identical normalised: ${norm(ta) === norm(tb)}`);
