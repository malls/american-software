// Compare the client-picker block of invoice-form.ejs and contract-form.ejs
// (plan §3.3(a): "a diff of the two blocks at review should show the label and
// indentation only").
import { readFileSync } from 'node:fs';
const V = '/Users/forrest/Code/american-software-company/.worktrees/AS-127/apps/invoicing/views/';
function block(file) {
  const lines = readFileSync(V + file, 'utf8').split('\n');
  const start = lines.findIndex((l) => l.includes('<div class="client-picker">'));
  const indent = lines[start].match(/^\s*/)[0];
  let end = start + 1;
  while (end < lines.length && lines[end] !== `${indent}</div>`) end += 1;
  return lines.slice(start, end + 1).map((l) => l.trim());
}
const a = block('invoice-form.ejs');
const b = block('contract-form.ejs');
console.log('invoice-form picker lines:', a.length, ' contract-form picker lines:', b.length);
const n = Math.max(a.length, b.length);
let diffs = 0;
for (let i = 0; i < n; i += 1) {
  if (a[i] !== b[i]) {
    diffs += 1;
    console.log(`--- line ${i + 1}\n  inv: ${a[i]}\n  con: ${b[i]}`);
  }
}
console.log('differing lines (after trim):', diffs);
