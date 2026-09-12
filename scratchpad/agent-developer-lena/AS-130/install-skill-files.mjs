// One-off helper: copies the skill scripts authored in this scratchpad into the
// AS-130 worktree's .claude/skills/d1-demo-artifact/ (the Edit/Write tools
// treat .claude/ as sensitive). Usage: node install-skill-files.mjs [names...]
import { copyFileSync } from 'node:fs';
import { join } from 'node:path';

const here = '/Users/forrest/Code/american-software-company/scratchpad/agent-developer-lena/AS-130';
const dest = '/Users/forrest/Code/american-software-company/.worktrees/AS-130/.claude/skills/d1-demo-artifact';
const names = process.argv.slice(2).length ? process.argv.slice(2) : ['capture.mjs', 'build.mjs'];
for (const name of names) {
  copyFileSync(join(here, name), join(dest, name));
  console.log(`installed ${name} -> ${dest}`);
}
