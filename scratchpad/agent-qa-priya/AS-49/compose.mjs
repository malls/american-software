// usage: node compose.mjs <project> <compose.yaml path> <service...>
// Runs each service with --build under the given project, prints the Built
// receipt lines + the TAP summary + every `not ok`, then tears down.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [project, file, ...services] = process.argv.slice(2);
const docker = '/usr/local/bin/docker';
const env = { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' };
const receipt = [];
const log = (...a) => { const s = a.join(' '); receipt.push(s); process.stdout.write(s + '\n'); if (process.env.LOG_TO) writeFileSync(`${process.env.LOG_TO}.receipt.txt`, receipt.join('\n') + '\n'); };
for (const svc of services) {
  log(`\n=== ${project} :: ${svc} ===`);
  const r = spawnSync(docker, ['compose', '-p', project, '-f', file, 'run', '--rm', '--build', svc], {
    env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  const lines = out.split('\n');
  const built = lines.filter((l) => /Image .* Built/.test(l));
  const summary = lines.filter((l) => /^(# |ℹ )(tests|pass|fail|skipped|cancelled|todo) /.test(l));
  const notok = lines.filter((l) => /^not ok|^✖/.test(l));
  log('BUILT:', built.join(' | ') || 'NONE');
  log(summary.join('\n'));
  log('NOT OK:', notok.length ? '\n' + notok.join('\n') : 'none');
  log('EXIT:', r.status);
  if (process.env.LOG_TO) writeFileSync(`${process.env.LOG_TO}.${svc}.log`, out);
}
const d = spawnSync(docker, ['compose', '-p', project, '-f', file, '--profile', 'tools', 'down', '-v', '--rmi', 'local'], {
  env, encoding: 'utf8',
});
log('DOWN EXIT:', d.status, (d.stderr ?? '').split('\n').slice(-3).join(' '));
