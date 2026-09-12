// Posts the prepared comment and moves AS-130 to review, running lattice from
// the MAIN checkout only.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const ROOT = '/Users/forrest/Code/american-software-company';
const text = readFileSync(`${ROOT}/scratchpad/agent-developer-lena/AS-130/lattice-comment.txt`, 'utf8').trim();
const run = (args) => {
  const r = spawnSync('lattice', args, { cwd: ROOT, encoding: 'utf8' });
  process.stdout.write(`$ lattice ${args.slice(0, 3).join(' ')} …\n${r.stdout}${r.stderr}[exit ${r.status}]\n`);
  if (r.status !== 0) process.exit(r.status ?? 1);
};
run(['comment', 'AS-130', text, '--actor', 'agent:developer-lena']);
run(['status', 'AS-130', 'review', '--actor', 'agent:developer-lena', '--no-auto-review']);
