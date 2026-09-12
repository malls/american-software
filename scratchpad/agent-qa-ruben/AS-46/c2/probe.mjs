// Runs Ruben's cycle-2 probe file against a fresh scratch archive of the tip.
import { spawnSync, execFileSync } from 'node:child_process';
import { rmSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
const ROOT = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-46/c2';
const SRC = `${ROOT}/probe-src`;
const W = '/Users/forrest/Code/american-software-company/.worktrees/AS-46';
const TIP = process.argv[2] || '7d5751c';
rmSync(SRC, { recursive: true, force: true });
mkdirSync(SRC, { recursive: true });
execFileSync('sh', ['-c', `git -C ${W} archive ${TIP} | tar -x -C ${SRC}`]);
copyFileSync(`${ROOT}/zz-ruben-c2-probe.test.js`, `${SRC}/apps/invoicing/test/zz-ruben-c2-probe.test.js`);
const r = spawnSync('/usr/local/bin/docker', ['compose', '-p', 'asc-review-as46-c2-probe', '-f', `${SRC}/apps/invoicing/compose.yaml`, 'run', '--build', '--rm', 'test', 'node', '--test', 'test/zz-ruben-c2-probe.test.js'],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const out = `${r.stdout}\n=====STDERR=====\n${r.stderr}\nEXIT=${r.status}\n`;
writeFileSync(`${ROOT}/probe-${TIP}.log`, out);
console.log(out.split('\n').filter((l) => /^(P\d+|✔|✖|ℹ (tests|pass|fail)|not ok|\s+\d+ \||.*Built|EXIT)/.test(l) || /^\d+ \| /.test(l)).join('\n'));
