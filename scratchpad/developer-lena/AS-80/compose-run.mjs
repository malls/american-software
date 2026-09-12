import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const DOCKER = '/usr/local/bin/docker';
const COMPOSE = '/Users/forrest/Code/american-software-company/.worktrees/AS-80/apps/chat/compose.yaml';
const OUT = '/Users/forrest/Code/american-software-company/scratchpad/developer-lena/AS-80/compose.txt';

const r = spawnSync(DOCKER, ['compose', '-f', COMPOSE, '-p', 'as80test', 'run', '--build', '--rm', 'test'], { encoding: 'utf8' });
const out = (r.stdout || '') + (r.stderr || '');
writeFileSync(OUT, out);
console.log('exit status:', r.status);
console.log(out.split('\n').filter((l) => /Built|tests |pass |fail |not ok|✖/.test(l)).join('\n'));
