// AS-124 AC-3 — the bind-mount run (plan §1 N1 "Environment proof").
// Runs the three stream-company-replaced-* and two stream-company-swap-* tests
// INSIDE node:24-slim with the app tree mounted :ro and TMPDIR on the
// apps/chat/data bind mount of the main checkout — the mount the running
// asc-chat-server-1 container shares, which is where the transient inode lives.
// Branch three times (bar: 3/3 green), master once (expected: replaced-new-inode red 6 !== 3).
// Docker is off PATH: absolute binary from deploy-state.json's dockerBin.
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync } from 'node:fs';

const DOCKER = '/usr/local/bin/docker';
const M = '/Users/forrest/Code/american-software-company';
const W = `${M}/.worktrees/AS-124`;
const DATA = `${M}/apps/chat/data`;
const SCRATCH_NAME = 'as124-lena-scratch';
const SCRATCH = `${DATA}/${SCRATCH_NAME}`;
const PATTERN = 'stream-company-replaced-|stream-company-swap-';

function run(label, appDir) {
  mkdirSync(SCRATCH, { recursive: true });
  const args = [
    'run', '--rm',
    '-v', `${appDir}:/app:ro`,
    '-v', `${DATA}:/app/data`,
    '-e', `TMPDIR=/app/data/${SCRATCH_NAME}`,
    '-w', '/app',
    'node:24-slim',
    'node', '--test', `--test-name-pattern=${PATTERN}`, 'test/stream.test.js',
  ];
  const r = spawnSync(DOCKER, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout || '') + (r.stderr || '');
  const counts = {};
  for (const k of ['tests', 'pass', 'fail', 'skipped']) counts[k] = Number((out.match(new RegExp(`^ℹ ${k} (\\d+)`, 'm')) || [])[1]);
  const red = [...new Set([...out.matchAll(/^✖ (.+?)(?: \(\d+(?:\.\d+)?ms\))?$/gm)].map((m) => m[1].split(':')[0]).filter((t) => t !== 'failing tests'))];
  const firstFail = (out.match(/^\s+(AssertionError.*)$/m) || [])[1] ?? null;
  const expected = (out.match(/^\s+expected: (.*)$/m) || [])[1] ?? null;
  const actual = (out.match(/^\s+actual: (.*)$/m) || [])[1] ?? null;
  console.log(`bind mount [${label}] tests=${counts.tests} pass=${counts.pass} fail=${counts.fail} skipped=${counts.skipped} exit=${r.status}${r.error ? ` error=${r.error.message}` : ''}`);
  if (red.length) console.log(`  red: ${red.join(', ')}\n  ${firstFail}${actual !== null ? ` (actual ${actual}, expected ${expected})` : ''}`);
  if (Number.isNaN(counts.tests)) console.log(out.slice(-2000));
  return { label, counts, red, status: r.status };
}

const probe = spawnSync(DOCKER, ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' });
if (probe.status !== 0) {
  console.log(`docker unreachable at ${DOCKER}: ${(probe.stderr || probe.error?.message || '').trim()} — AC-3 left open`);
  process.exit(2);
}
console.log(`docker server ${probe.stdout.trim()} via ${DOCKER}; data mount ${DATA}; scratch ${SCRATCH}`);

const results = [];
try {
  for (let i = 1; i <= 3; i++) results.push(run(`branch run ${i}/3`, `${W}/apps/chat`));
  results.push(run('master run 1/1', `${M}/apps/chat`));
} finally {
  rmSync(SCRATCH, { recursive: true, force: true });
  console.log(`scratch removed: ${!existsSync(SCRATCH)}`);
}
