const { spawnSync } = require('node:child_process');
const sp = '/Users/forrest/Code/american-software-company/scratchpad/agent-cto-owen/AS-124';
const r = spawnSync(
  '/usr/local/bin/docker',
  ['run', '--rm', '--platform', 'linux/amd64', '-v', sp + ':/probe', 'node:24-slim', 'node', '/probe/ino-probe.mjs', '/probe/mnt'],
  { encoding: 'utf8', timeout: 120000 }
);
console.log('exit', r.status);
console.log(r.stdout);
console.log(r.stderr.slice(0, 2000));
