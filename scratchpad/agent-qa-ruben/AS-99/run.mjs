// run.mjs — spawn a command with explicit cwd + env, tee output to a log.
// Usage: node run.mjs <logfile> <cwd> <cmd> [args...]
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';

const [, , logfile, cwd, cmd, ...args] = process.argv;
const out = createWriteStream(logfile);
const child = spawn(cmd, args, {
  cwd,
  env: { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (d) => { out.write(d); process.stdout.write(d); });
child.stderr.on('data', (d) => { out.write(d); process.stderr.write(d); });
child.on('close', (code) => { out.end(`\n[exit ${code}]\n`); process.exitCode = code ?? 1; });
