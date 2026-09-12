// AC-4 falsifier: revert the three tokens pins in apps/invoicing/test/assets.test.js to the
// pre-AS-56 numbers, rebuild via compose-run (always --build, always torn down), record the
// exact red set, restore, prove the tree clean.
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const ROOT = '/Users/forrest/Code/american-software-company';
const W = `${ROOT}/.worktrees/AS-56`;
const OUT = `${ROOT}/scratchpad/agent-qa-priya/AS-56`;
const T = `${W}/apps/invoicing/test/assets.test.js`;
copyFileSync(T, `${OUT}/assets.test.js.bak`);
const restore = () => copyFileSync(`${OUT}/assets.test.js.bak`, T);
process.on('exit', restore);
let s = readFileSync(T, 'utf8');
const subs = [['const TOKENS_BYTES = 12350;', 'const TOKENS_BYTES = 12199;'], ['const TOKENS_DECLARATIONS = 184;', 'const TOKENS_DECLARATIONS = 183;'], ['const TOKEN_NAMES = 128;', 'const TOKEN_NAMES = 127;']];
for (const [a, b] of subs) { const n = s.split(a).length - 1; if (n !== 1) { console.log('NOT applied:', a, n); process.exit(9); } s = s.split(a).join(b); }
writeFileSync(T, s);
const check = readFileSync(T, 'utf8');
console.log('AC-4 mutant applied:', subs.every(([, b]) => check.includes(b)), '| lines:', check.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /^const (TOKENS_BYTES|TOKENS_DECLARATIONS|TOKEN_NAMES) =/.test(l)).map(([n, l]) => `L${n} ${l}`).join(' ; '));
const r = spawnSync('node', [`${ROOT}/apps/chat/bin/compose-run.mjs`, '--project', 'asc-review-as56-invmut', '--cwd', `${W}/apps/invoicing`, '--log', `${OUT}/compose-invoicing-mutant.log`], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
console.log((r.stdout + r.stderr).split('\n').filter((l) => /RECEIPT|built:|tests=|exit=|leak/.test(l)).join('\n'));
const log = readFileSync(`${OUT}/compose-invoicing-mutant.log`, 'utf8');
console.log('--- red set ---');
console.log(log.split('\n').filter((l) => /^not ok|^\s+not ok|✖|AssertionError|expected:|actual:|^\s+[+-] \d+$/.test(l)).slice(0, 40).join('\n'));
restore();
const c = spawnSync('git', ['-C', W, 'diff', '--exit-code', '--stat'], { encoding: 'utf8' });
console.log('AC-4: tree', c.status === 0 ? 'CLEAN' : 'DIRTY\n' + c.stdout);
