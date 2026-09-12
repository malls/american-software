// AS-84 cycle-3 review helper (qa-ruben): run one node:test file with a
// chosen PATH (so `git` can be made unreachable without touching the host).
//   node run-test.mjs <test file> <PATH value>
// Prints the test output; exit code mirrors node --test's.
import { spawnSync } from 'node:child_process';

const [file, pathValue] = process.argv.slice(2);
const r = spawnSync(process.execPath, ['--test', file], {
  encoding: 'utf8',
  env: { ...process.env, PATH: pathValue },
  maxBuffer: 16 * 1024 * 1024,
});
process.stdout.write(r.stdout ?? '');
process.stderr.write(r.stderr ?? '');
console.log(`RUNNER: PATH=${JSON.stringify(pathValue)} status=${r.status}`);
process.exit(r.status ?? 1);
