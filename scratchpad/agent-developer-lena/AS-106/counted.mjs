// AS-106 AC-13: --check, the counted run through the new script, --check again.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const W = '/Users/forrest/Code/american-software-company/.worktrees/AS-106';
const S = `${W}/apps/chat/bin/compose-run.mjs`;
const SP = '/Users/forrest/Code/american-software-company/scratchpad/agent-developer-lena/AS-106';
const env = { ...process.env, ADVANCE_DOCKER_BIN: '/usr/local/bin/docker' };
const go = (args) => { const r = spawnSync('node', [S, ...args], { encoding: 'utf8', env, cwd: W }); return `$ compose-run ${args.join(' ')}\n${r.stdout}${r.stderr}exit=${r.status}\n`; };
let out = go(['--check']);
out += go(['--project', 'asc-impl-as106', '--cwd', `${W}/apps/chat`, '--log', `${SP}/compose-asc-impl-as106.log`]);
out += go(['--check']);
writeFileSync(`${SP}/counted-run.txt`, out);
console.log(out);
