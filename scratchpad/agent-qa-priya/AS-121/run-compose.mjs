// Counted compose run for the AS-121 review; writes receipt + exit to compose-receipt.txt
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-121/apps/chat';
const OUT = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/AS-121';
const r = spawnSync(process.execPath, [`${WT}/bin/compose-run.mjs`, '--project', 'asc-review-as121', '--cwd', WT, '--log', `${OUT}/compose-run.log`], {
  cwd: WT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  env: { ...process.env, PATH: `/usr/local/bin:${process.env.PATH}`, ADVANCE_DOCKER_BIN: '/usr/local/bin/docker' },
});
writeFileSync(`${OUT}/compose-receipt.txt`, `${r.stdout}\n--- stderr ---\n${r.stderr}\nexit=${r.status} signal=${r.signal}\n`);
console.log(`exit=${r.status}`);
