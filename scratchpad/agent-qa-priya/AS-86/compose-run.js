// AS-86 review: counted compose run with --build (receipt = Built line).
const { spawnSync } = require('child_process');
const fs = require('fs');
const dir = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/AS-86';
const r = spawnSync('/usr/local/bin/docker', [
  'compose', '-p', 'asc-review-as86',
  '-f', '/Users/forrest/Code/american-software-company/.worktrees/AS-86/apps/chat/compose.yaml',
  'run', '--rm', '--build', 'test',
], { env: { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
fs.writeFileSync(dir + '/compose.log', (r.stdout || '') + '\n--- STDERR ---\n' + (r.stderr || '') + '\nEXIT ' + r.status + ' ERR ' + (r.error ? String(r.error) : 'none') + '\n');
console.log('exit', r.status, r.error ? String(r.error) : '');
const d = spawnSync('/usr/local/bin/docker', ['compose', '-p', 'asc-review-as86', 'down', '--remove-orphans'], { encoding: 'utf8' });
fs.writeFileSync(dir + '/compose-down.log', (d.stdout || '') + (d.stderr || '') + '\nEXIT ' + d.status + '\n');
console.log('down exit', d.status);
