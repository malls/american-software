// scratchpad/qa-priya/AS-90/compose.mjs — run a compose command by absolute docker
// path (docker is off PATH for sub-agents) and tee stdout+stderr to a log.
// usage: node compose.mjs <cwd> <logfile> <project> <compose args...>
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [cwd, logfile, project, ...args] = process.argv.slice(2);
const r = spawnSync('/usr/local/bin/docker', ['compose', '-p', project, ...args], {
  cwd,
  env: { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' },
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
const out = `${r.stdout ?? ''}\n--- stderr ---\n${r.stderr ?? ''}\nexit=${r.status}\n`;
if (logfile !== '-') writeFileSync(logfile, out);
else process.stdout.write(out);
process.exit(r.status ?? 1);
