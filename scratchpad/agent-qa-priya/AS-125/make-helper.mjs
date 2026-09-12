// make-helper.mjs — copy the branch's cascade helper (verbatim, up to the H1 marker) into a scratch ESM module with exports.
import { readFileSync, writeFileSync } from 'node:fs';
const src = readFileSync('/Users/forrest/Code/american-software-company/.worktrees/AS-125/apps/chat/test/roster-truncation.test.js', 'utf8');
const cut = src.indexOf('// --- H1–H5');
if (cut === -1) throw new Error('marker not found');
let head = src.slice(0, cut);
// keep STYLESHEET pointing at the worktree's real file
head = head.replace("resolve(dirname(fileURLToPath(import.meta.url)), '../public/style.css')", "'/Users/forrest/Code/american-software-company/.worktrees/AS-125/apps/chat/public/style.css'");
head += '\nexport { STYLESHEET, parseBlocks, parseDecls, parseRules, unescapeSelector, walk, specificity, lastCompound, targets, cascade, stripComments, UNSCORABLE, FLATTENED_AT, IGNORED_AT };\n';
writeFileSync('/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/AS-125/helper.mjs', head);
console.log('helper.mjs written, lines:', head.split('\n').length);
