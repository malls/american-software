// AS-124 N1 (cto-owen): run the two AS-111 `replaced` stream tests plus the
// truncation test INSIDE a container with os.tmpdir() redirected onto a Docker
// Desktop bind mount, so the server's tail reads company.jsonl over the mount.
// Read-only mount of the main checkout's apps/chat; nothing is written there.
const { spawnSync } = require('node:child_process');
const sp = '/Users/forrest/Code/american-software-company/scratchpad/agent-cto-owen/AS-124';
const app = '/Users/forrest/Code/american-software-company/apps/chat';
const pattern = process.argv[2] || 'stream-company-(replaced|truncation)';
const r = spawnSync(
  '/usr/local/bin/docker',
  [
    'run', '--rm', '--platform', 'linux/amd64',
    '-v', app + ':/app:ro',
    '-v', sp + '/mnt:/mnt',
    '-e', 'TMPDIR=/mnt',
    '-w', '/app',
    'node:24-slim',
    'node', '--test', '--test-name-pattern=' + pattern, 'test/stream.test.js',
  ],
  { encoding: 'utf8', timeout: 300000 }
);
console.log('exit', r.status);
console.log(r.stdout);
console.log(r.stderr.slice(0, 4000));
