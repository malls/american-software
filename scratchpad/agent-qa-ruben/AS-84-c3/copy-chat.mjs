// AS-84 cycle-3 review helper (qa-ruben): scratch copy of apps/chat minus
// data/ and node_modules/, so mutations never touch the task worktree.
//   node copy-chat.mjs <src apps/chat> <dst dir>
import { cpSync, rmSync } from 'node:fs';
import { basename } from 'node:path';

const [src, dst] = process.argv.slice(2);
rmSync(dst, { recursive: true, force: true });
cpSync(src, dst, {
  recursive: true,
  filter: (p) => !['data', 'node_modules'].includes(basename(p)),
});
console.log(`copied ${src} -> ${dst}`);
