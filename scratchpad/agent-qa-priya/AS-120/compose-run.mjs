// AS-120 review runner (qa-priya). node compose-run.mjs <apps/chat dir> <project> [test file...]
// Always --build. Prints the Built receipt line, TAP summary, and any not-ok lines. Full log saved.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const [dir, proj, ...files] = process.argv.slice(2);
const r = spawnSync('/usr/local/bin/docker', [
  'compose', '-f', `${dir}/compose.yaml`, '--project-directory', dir, '-p', proj,
  'run', '--build', '--rm', 'test', 'node', '--test', '--test-reporter=tap', ...files,
], { env: { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const out = (r.stdout || '') + (r.stderr || '');
const log = `/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/AS-120/${proj}-${Date.now()}.log`;
writeFileSync(log, out);
for (const line of out.split('\n')) {
  if (/Built|^# (tests|pass|fail|skipped|cancelled|todo)|^\s*not ok/.test(line)) console.log(line.trim());
}
console.log(`exit=${r.status} log=${log}`);
