// AC4 falsifier: old assets.test.js pins (12199/183/127) against the NEW tokens.css,
// in a scratch copy of the branch tip, via compose --build under its own project name.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const W = '/Users/forrest/Code/american-software-company/.worktrees/AS-56';
const dir = mkdtempSync(join(tmpdir(), 'as56-ac4-'));
spawnSync('tar', ['-x', '-C', dir], { input: execFileSync('git', ['-C', W, 'archive', 'HEAD'], { maxBuffer: 1 << 28 }) });
const p = join(dir, 'apps/invoicing/test/assets.test.js');
let t = readFileSync(p, 'utf8');
const subs = [
  ['const TOKENS_BYTES = 12350;', 'const TOKENS_BYTES = 12199;'],
  ['const TOKENS_DECLARATIONS = 184;', 'const TOKENS_DECLARATIONS = 183;'],
  ['const TOKEN_NAMES = 128;', 'const TOKEN_NAMES = 127;'],
];
for (const [from, to] of subs) {
  const n = t.split(from).length - 1;
  if (n !== 1) throw new Error(`mutation not applied at intended site: ${from} x${n}`);
  t = t.replace(from, to);
}
writeFileSync(p, t);
console.log('scratch:', dir, '— pins reverted to 12199/183/127; tokens.css is the new 12350-byte file');
try {
  const r = spawnSync('node', [join(W, '..', '..', 'scratchpad/agent-developer-marcus/AS-56/compose.mjs'), dir, 'asc-impl-as56-oldpins', 'apps/invoicing/compose.yaml', 'test'], { stdio: 'inherit', timeout: 600000 });
  spawnSync('node', [join(W, '..', '..', 'scratchpad/agent-developer-marcus/AS-56/compose.mjs'), dir, 'asc-impl-as56-oldpins', 'apps/invoicing/compose.yaml', 'test', 'down'], { stdio: 'inherit' });
} finally {
  rmSync(dir, { recursive: true, force: true });
}
