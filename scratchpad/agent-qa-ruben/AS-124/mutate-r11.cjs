// R11 mutant: delete `eventsTail.hash = createHash('sha256');` INSIDE resetTail.
// Anchored: the needle is the lastBytes reset immediately followed by the hash
// reset, and it must occur exactly once inside the resetTail body and exactly
// once in the whole file (the initial `eventsTail = {...}` literal uses
// `hash: createHash(...)` — a different string — so it cannot match).
const fs = require('node:fs');
const f = process.argv[2];
const src = fs.readFileSync(f, 'utf8');
const fnStart = src.indexOf('  function resetTail(reason) {');
if (fnStart < 0) { console.error('resetTail not found'); process.exit(1); }
const fnEnd = src.indexOf('\n  }\n', fnStart) + 4;
const body = src.slice(fnStart, fnEnd);
const needle = "    eventsTail.lastBytes = Buffer.alloc(0);\n    eventsTail.hash = createHash('sha256');\n";
const inBody = body.split(needle).length - 1;
const inFile = src.split(needle).length - 1;
console.log(`occurrences: in resetTail body = ${inBody} | whole file = ${inFile}`);
if (inBody !== 1 || inFile !== 1) { console.error('ANCHOR NOT UNIQUE'); process.exit(1); }
const lineNo = src.slice(0, src.indexOf(needle)).split('\n').length + 1;
const mutated = src.replace(needle, '    eventsTail.lastBytes = Buffer.alloc(0);\n');
fs.writeFileSync(f, mutated);
const after = fs.readFileSync(f, 'utf8');
const stillThere = after.slice(fnStart, fnStart + body.length).includes("eventsTail.hash = createHash('sha256')");
if (after === src || stillThere) { console.error('MUTATION DID NOT APPLY AT SITE'); process.exit(1); }
console.log(`mutation applied: deleted server.js:${lineNo} inside resetTail`);
