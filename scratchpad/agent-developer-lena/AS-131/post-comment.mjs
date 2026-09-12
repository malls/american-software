// Post comment-impl.txt on AS-131 and move it to review (--no-auto-review),
// via the lattice CLI from the main checkout.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const REPO = '/Users/forrest/Code/american-software-company';
const text = readFileSync(`${REPO}/scratchpad/agent-developer-lena/AS-131/comment-impl.txt`, 'utf8').trim();
const run = (args) => {
  const r = spawnSync('lattice', args, { cwd: REPO, encoding: 'utf8' });
  process.stdout.write(r.stdout || '');
  process.stderr.write(r.stderr || '');
  if (r.status !== 0) process.exit(r.status ?? 1);
};
run(['comment', 'AS-131', text, '--actor', 'agent:developer-lena']);
run(['status', 'AS-131', 'review', '--actor', 'agent:developer-lena', '--no-auto-review']);
