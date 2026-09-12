// AC-5 §7: committed export set == scratch export set; every committed file is a byte-prefix of its scratch counterpart.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const committed = '/Users/forrest/Code/american-software-company/.worktrees/AS-91/apps/chat/data/export';
const scratch = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/db/export';
const a = readdirSync(committed).sort();
const b = readdirSync(scratch).sort();
console.log('committed:', a.length, 'scratch:', b.length);
console.log('sets equal:', JSON.stringify(a) === JSON.stringify(b));
console.log('human names in scratch:', b.filter((n) => n.includes('~~human~') || n.startsWith('dm-human~')));
let ok = 0, bad = 0;
for (const f of a) {
  const c = readFileSync(join(committed, f));
  const s = readFileSync(join(scratch, f));
  const isPrefix = s.length >= c.length && c.equals(s.subarray(0, c.length));
  if (isPrefix) ok++; else { bad++; console.log('NOT PREFIX:', f, c.length, s.length); }
}
console.log('prefix ok:', ok, 'bad:', bad);
