// AS-61 mutation driver. Applies ONE named mutant to a file, anchored to the
// body of readRepoMarkdown, and asserts it landed at the intended site.
// Usage: node as61-mutate.mjs <server.js path> <M-A|M-B|M-C|M-D>
import { readFileSync, writeFileSync } from 'node:fs';

const [file, name] = process.argv.slice(2);
const src = readFileSync(file, 'utf8');

// Anchor: the body of readRepoMarkdown only. Every mutation below must match
// inside this window, so a same-looking line elsewhere cannot absorb the edit
// (the AS-95 sharpening: assert the mutation applied at the INTENDED site).
const fnStart = src.indexOf('function readRepoMarkdown(');
if (fnStart === -1) throw new Error('readRepoMarkdown not found');
const fnEnd = src.indexOf('\n}\n', fnStart);
if (fnEnd === -1) throw new Error('readRepoMarkdown end not found');
const body = src.slice(fnStart, fnEnd);

const MUTANTS = {
  // Delete check 4b entirely.
  'M-A': [/^ {2}if \(st\.nlink !== 1\) throw fail\(\); \/\/ 4b .*$/m, ''],
  // Invert the guard: serve only multi-linked files.
  'M-B': [/if \(st\.nlink !== 1\)/, 'if (st.nlink === 1)'],
  // Relax the dot-segment rule to also allow a first segment '.claude'.
  'M-C': [/!\(i === 0 && s === '\.lattice'\)/, "!(i === 0 && (s === '.lattice' || s === '.claude'))"],
  // 4b throws a DISTINCT not_found — same status, different body.
  'M-D': [/if \(st\.nlink !== 1\) throw fail\(\);/, "if (st.nlink !== 1) throw new StoreError('hard link', 'not_found');"],
};
const [pattern, replacement] = MUTANTS[name] || (() => { throw new Error('unknown mutant ' + name); })();

const hits = body.match(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g'));
if (!hits || hits.length !== 1) throw new Error(`${name}: expected exactly 1 match inside readRepoMarkdown, got ${hits ? hits.length : 0}`);

const offsetInBody = body.search(pattern);
const absOffset = fnStart + offsetInBody;
const line = src.slice(0, absOffset).split('\n').length;
const mutatedBody = body.replace(pattern, replacement);
if (mutatedBody === body) throw new Error(`${name}: replacement was a no-op`);
const out = src.slice(0, fnStart) + mutatedBody + src.slice(fnEnd);
writeFileSync(file, out);

// Receipt: the intended site, by line number and by text, before and after.
const before = src.split('\n')[line - 1];
const after = out.split('\n')[line - 1];
console.log(`${name}: mutated at line ${line} of ${file}`);
console.log(`  before: ${before}`);
console.log(`  after : ${after}`);
