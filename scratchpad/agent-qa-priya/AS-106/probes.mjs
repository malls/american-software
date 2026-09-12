// qa-priya AS-106 review: probes past the list, against the real script + real docker (read-only paths).
import { spawnSync } from 'node:child_process';
const D = '/usr/local/bin/docker';
const SCRIPT = '/Users/forrest/Code/american-software-company/.worktrees/AS-106/apps/chat/bin/compose-run.mjs';
const CWD = '/Users/forrest/Code/american-software-company/.worktrees/AS-106/apps/chat';
const run = (args, env = {}) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, ADVANCE_DOCKER_BIN: D, ...env } });
  return { status: r.status, out: ((r.stdout || '') + (r.stderr || '')).trim().split('\n').slice(0, 4).join(' | ') };
};
const before = spawnSync(D, ['network', 'ls', '--format', '{{.Name}}'], { encoding: 'utf8' }).stdout.split('\n').filter((n) => n.startsWith('asc-'));
console.log(`P0 asc-* networks now: ${before.length}`);
console.log('P1 production name asc-chat        ->', run(['--project', 'asc-chat', '--cwd', CWD]));
console.log('P2 production name asc-invoicing   ->', run(['--project', 'asc-invoicing', '--cwd', CWD]));
console.log('P3 uppercase / slash / space       ->', run(['--project', 'asc-Review/as 106', '--cwd', CWD]));
console.log('P4 missing --cwd                   ->', run(['--project', 'asc-review-as106-x']));
console.log('P5 unknown flag                    ->', run(['--projekt', 'asc-review-as106-x']));
console.log(`P6 ceiling=${before.length} (== current count) ->`, run(['--project', 'asc-review-as106-x', '--cwd', CWD], { ASC_NETWORK_CEILING: String(before.length) }));
console.log('P7 ceiling=0 (falsy -> default 20?) ->', run(['--check'], { ASC_NETWORK_CEILING: '0' }).out.split(' | ')[0]);
console.log('P8 docker bin missing              ->', run(['--check'], { ADVANCE_DOCKER_BIN: '/nonexistent/docker' }));
const after = spawnSync(D, ['network', 'ls', '--format', '{{.Name}}'], { encoding: 'utf8' }).stdout.split('\n').filter((n) => n.startsWith('asc-'));
console.log(`P9 asc-* networks after probes: ${after.length} (unchanged: ${JSON.stringify(before) === JSON.stringify(after)})`);
const imgs = spawnSync(D, ['images', '--format', '{{.Repository}}:{{.Tag}}'], { encoding: 'utf8' }).stdout.split('\n').filter((n) => /as106/.test(n));
console.log(`P10 images matching as106 after all runs: ${JSON.stringify(imgs)}`);
