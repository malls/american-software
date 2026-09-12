// Create the AS-131 follow-up task (plan Decision 4) via the lattice CLI from
// the main checkout, description read from followup-description.txt.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const REPO = '/Users/forrest/Code/american-software-company';
const desc = readFileSync(`${REPO}/scratchpad/agent-developer-lena/AS-131/followup-description.txt`, 'utf8').trim();
const r = spawnSync('lattice', [
  'create', 'Chat: incremental message DOM — stop rebuilding the pane on live frames',
  '--actor', 'agent:developer-lena', '--priority', 'medium', '--complexity', 'medium', '--type', 'task',
  '--description', desc,
  '--reason', 'AS-131 plan Decision 4: incremental DOM split into its own task at review',
], { cwd: REPO, encoding: 'utf8' });
process.stdout.write(r.stdout || '');
process.stderr.write(r.stderr || '');
process.exit(r.status ?? 1);
