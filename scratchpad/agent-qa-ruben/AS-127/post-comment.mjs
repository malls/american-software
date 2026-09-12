// Post the review comment from the MAIN checkout (never the worktree) as agent:qa-ruben.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const ROOT = '/Users/forrest/Code/american-software-company';
const text = readFileSync(`${ROOT}/scratchpad/agent-qa-ruben/AS-127/review-comment.txt`, 'utf8').trim();
const r = spawnSync('lattice', ['comment', 'AS-127', text, '--role', 'review', '--actor', 'agent:qa-ruben'], { cwd: ROOT, encoding: 'utf8' });
console.log(r.stdout, r.stderr, `exit ${r.status}`);
