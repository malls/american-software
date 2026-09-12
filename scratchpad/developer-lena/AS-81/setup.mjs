// Build the scratch app copies for the AS-81 mutation battery.
// The worktree itself is NEVER mutated: every mutant is a copy.
// `data/` is excluded so no run can read or write the real apps/chat state.
import { cpSync, rmSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SP = '/Users/forrest/Code/american-software-company/scratchpad/developer-lena/AS-81';
const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-81/apps/chat';

rmSync(join(SP, 'base'), { recursive: true, force: true });
mkdirSync(join(SP, 'base'), { recursive: true });
cpSync(WT, join(SP, 'base'), {
  recursive: true,
  filter: (src) => !src.startsWith(join(WT, 'data')),
});

// ctlroot keeps the apps/chat nesting so `git --work-tree` can drop master's
// stream.test.js straight into it at the right path.
for (const v of ['m1', 'm2', 'm3a', 'm3b', 'm4']) {
  rmSync(join(SP, v), { recursive: true, force: true });
  cpSync(join(SP, 'base'), join(SP, v), { recursive: true });
}
rmSync(join(SP, 'ctlroot'), { recursive: true, force: true });
cpSync(join(SP, 'base'), join(SP, 'ctlroot', 'apps', 'chat'), { recursive: true });

console.log('variants:', readdirSync(SP).join(' '));
console.log('base entries:', readdirSync(join(SP, 'base')).join(' '));
console.log('data excluded:', !readdirSync(join(SP, 'base')).includes('data'));
