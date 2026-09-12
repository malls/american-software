// Record the cycle-2 review comment on AS-130, from the main checkout, as agent:qa-ruben.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const ROOT = '/Users/forrest/Code/american-software-company';
const text = readFileSync(`${ROOT}/scratchpad/agent-qa-ruben/AS-130/c2/comment.txt`, 'utf8').trimEnd();
console.log(`words: ${text.split(/\s+/).length}`);
const r = spawnSync('lattice', ['comment', 'AS-130', text, '--actor', 'agent:qa-ruben', '--role', 'review'], { cwd: ROOT, encoding: 'utf8' });
process.stdout.write(r.stdout);
process.stderr.write(r.stderr);
process.exit(r.status ?? 1);
