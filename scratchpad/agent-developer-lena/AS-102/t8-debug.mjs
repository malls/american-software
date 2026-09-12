// Scratch: copy watcher-main.test.js next to the real one with a log dump in T8.
import { readFileSync, writeFileSync } from 'node:fs';
const src = '/Users/forrest/Code/american-software-company/.worktrees/AS-102/apps/chat/test/watcher-main.test.js';
let s = readFileSync(src, 'utf8');
s = s.replace(
  "assert.equal(h.logged(/^LOOP-WAIT deploy pending$/).length, 1, 'yields while the rebuild runs');",
  "console.error('LOGS', JSON.stringify(h.logs, null, 1)); assert.equal(h.logged(/^LOOP-WAIT deploy pending$/).length, 1, 'yields while the rebuild runs');"
);
writeFileSync('/Users/forrest/Code/american-software-company/.worktrees/AS-102/apps/chat/test/zz-as102-debug.test.js', s);
