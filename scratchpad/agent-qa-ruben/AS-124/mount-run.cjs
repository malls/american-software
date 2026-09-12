// AS-124 review (qa-ruben): run the swap/replaced tests INSIDE node:24-slim with
// TMPDIR on the apps/chat/data bind mount (the mount the running chat container
// also mounts), so the real tail reads the real fixture over Docker Desktop's
// bind mount. Usage: node mount-run.cjs <appDir> <label> [repeats]
const { spawnSync } = require('node:child_process');
const { mkdirSync, rmSync, existsSync } = require('node:fs');
const path = require('node:path');

const DOCKER = '/usr/local/bin/docker';
const M = '/Users/forrest/Code/american-software-company';
const appDir = process.argv[2];
const label = process.argv[3] || 'run';
const repeats = Number(process.argv[4] || 1);
const scratch = path.join(M, 'apps/chat/data', 'ruben-as124-scratch');
const TESTS = [
  'stream-company-replaced-new-inode',
  'stream-company-replaced-same-inode',
  'stream-company-replaced-shorter-new-inode',
  'stream-company-swap-identical-prefix-adopts',
  'stream-company-swap-identical-prefix-with-partial',
];
const pattern = TESTS.map((t) => `^${t}`).join('|');

function once(i) {
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });
  const r = spawnSync(DOCKER, [
    'run', '--rm', '--name', `asc-ruben-as124-mount-${label}-${i}`,
    '-v', `${appDir}:/app:ro`,
    '-v', `${scratch}:/scratch`,
    '-e', 'TMPDIR=/scratch',
    '-w', '/app',
    'node:24-slim',
    'node', '--test', '--test-name-pattern', pattern, 'test/stream.test.js',
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout || '') + (r.stderr || '');
  const grab = (k) => (out.match(new RegExp(`ℹ ${k} (\\d+)`)) || [])[1];
  const failing = [...out.matchAll(/^✖ (.+?) \(/gm)].map((m) => m[1]);
  const detail = [...out.matchAll(/(Expected values to be strictly equal:[\s\S]{0,120}|\+ actual - expected[\s\S]{0,80})/g)].map((m) => m[1].replace(/\s+/g, ' ').slice(0, 100));
  console.log(`[bind mount ${label} #${i}] exit=${r.status} tests=${grab('tests')} pass=${grab('pass')} fail=${grab('fail')} skipped=${grab('skipped')} failing=${JSON.stringify(failing)}`);
  for (const d of detail) console.log(`    ${d}`);
  if (r.status !== 0 && !grab('tests')) console.log(out.slice(-2000));
  rmSync(scratch, { recursive: true, force: true });
  return r.status;
}

for (let i = 1; i <= repeats; i++) once(i);
if (existsSync(scratch)) rmSync(scratch, { recursive: true, force: true });
