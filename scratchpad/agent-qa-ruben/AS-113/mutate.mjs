// In-place mutants for the AS-113 falsifiers, applied only inside the
// `function probeBudget` … `async function resolveBackend` slice of bin/chat.js.
// Usage: node mutate.mjs M1|M2|M3   (asserts the mutation applied at the site)
//        node mutate.mjs restore    (restores from the scratchpad backup)
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
const FILE = '/Users/forrest/Code/american-software-company/.worktrees/AS-113/apps/chat/bin/chat.js';
const BACKUP = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-113/chat.js.bak';
const which = process.argv[2];
if (which === 'restore') { copyFileSync(BACKUP, FILE); console.log('restored'); process.exit(0); }
copyFileSync(FILE, BACKUP);
const src = readFileSync(FILE, 'utf8');
const a = src.indexOf('function probeBudget');
const b = src.indexOf('async function resolveBackend');
if (a < 0 || b < 0 || b < a) throw new Error('slice anchors not found');
const slice = src.slice(a, b);
const count = (s, re) => (s.match(re) || []).length;
let out;
if (which === 'M1') {
  const before = count(slice, /MAX_PROBE_TIMEOUT_MS/g);
  out = slice.replace(/  if \(ms > MAX_PROBE_TIMEOUT_MS\) \{\n[^\n]*\n  \}\n/, '');
  const after = count(out, /MAX_PROBE_TIMEOUT_MS/g);
  console.log(`M1 MAX_PROBE_TIMEOUT_MS in slice: ${before} -> ${after}`);
  // Plan says 1->0; the slice actually holds the token twice (the `if` and the
  // message template), both inside the deleted block, so the true count is 2->0.
  if (!(before === 2 && after === 0)) throw new Error('M1 did not apply');
} else if (which === 'M2') {
  const before = count(slice, /\$\{MAX_PROBE_TIMEOUT_MS\}/g);
  out = slice.replace('above ${MAX_PROBE_TIMEOUT_MS} ms', 'above the ceiling');
  const after = count(out, /\$\{MAX_PROBE_TIMEOUT_MS\}/g);
  console.log(`M2 \${MAX_PROBE_TIMEOUT_MS} in slice: ${before} -> ${after}`);
  if (!(before === 1 && after === 0)) throw new Error('M2 did not apply');
} else if (which === 'M3') {
  const before = count(slice, /ms >= MAX_PROBE_TIMEOUT_MS/g);
  out = slice.replace('ms > MAX_PROBE_TIMEOUT_MS', 'ms >= MAX_PROBE_TIMEOUT_MS');
  const after = count(out, /ms >= MAX_PROBE_TIMEOUT_MS/g);
  console.log(`M3 'ms >= MAX_PROBE_TIMEOUT_MS' in slice: ${before} -> ${after}`);
  if (!(before === 0 && after === 1)) throw new Error('M3 did not apply');
} else throw new Error('unknown mutant');
writeFileSync(FILE, src.slice(0, a) + out + src.slice(b));
console.log(`${which} applied`);
