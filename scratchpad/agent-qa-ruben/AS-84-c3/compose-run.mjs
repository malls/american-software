// AS-84 cycle-3 review helper (qa-ruben): run the counted compose --build suite
// from a given apps/chat directory under an isolated project name, tee the
// output to a log, and print the exit code. Usage:
//   node compose-run.mjs <apps/chat dir> <project> <log path>
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [dir, project, logPath] = process.argv.slice(2);
const r = spawnSync(
  '/usr/local/bin/docker',
  ['compose', '-p', project, 'run', '--build', '--rm', 'test'],
  {
    cwd: dir,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' },
  }
);
const body = `${r.stdout ?? ''}\n--- stderr ---\n${r.stderr ?? ''}\nEXIT=${r.status} SIGNAL=${r.signal} ERROR=${r.error ? r.error.message : ''}\n`;
writeFileSync(logPath, body);
console.log(`compose done: status=${r.status} signal=${r.signal} error=${r.error ? r.error.message : 'none'} log=${logPath}`);
