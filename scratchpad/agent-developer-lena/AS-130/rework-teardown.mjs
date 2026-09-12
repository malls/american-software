// AS-130 rework cycle 1 — observe F1: the SKILL step-2 teardown, old line (red)
// then new line (green), against a fresh capture project. Everything is measured
// with docker ps -a / network ls / lsof, never asserted. Log: rework-teardown.log
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const ROOT = '/Users/forrest/Code/american-software-company/.worktrees/AS-130';
const LOG = '/Users/forrest/Code/american-software-company/scratchpad/agent-developer-lena/AS-130/rework-teardown.log';
const state = JSON.parse(readFileSync('/Users/forrest/Code/american-software-company/apps/chat/data/deploy-state.json', 'utf8'));
const docker = state.dockerBin;
const P = 'asc-rework-as130';
const FILES = ['-f', 'apps/invoicing/compose.yaml', '-f', '.claude/skills/d1-demo-artifact/compose.capture.yaml'];
const env = { ...process.env, PATH: `/usr/local/bin:${process.env.PATH}`, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' };

writeFileSync(LOG, `# rework-teardown ${new Date().toISOString()} project ${P}\n`);
function sh(bin, args, opts = {}) {
  const r = spawnSync(bin, args, { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const text = `$ ${bin === docker ? 'docker' : bin} ${args.join(' ')}\n${r.stdout ?? ''}${r.stderr ?? ''}[exit ${r.status}]\n`;
  appendFileSync(LOG, text);
  if (!opts.quiet) process.stdout.write(text);
  return r;
}
function measure(tag) {
  appendFileSync(LOG, `## measure: ${tag}\n`);
  process.stdout.write(`## measure: ${tag}\n`);
  const ps = sh(docker, ['ps', '-a', '--filter', `name=${P}`, '--format', '{{.Names}}\t{{.Status}}\t{{.Ports}}']);
  const net = sh(docker, ['network', 'ls', '--filter', `name=${P}`, '--format', '{{.Name}}']);
  const l49 = sh('/usr/sbin/lsof', ['-nP', '-iTCP:8349', '-sTCP:LISTEN']);
  const l50 = sh('/usr/sbin/lsof', ['-nP', '-iTCP:8350', '-sTCP:LISTEN']);
  const summary = {
    tag,
    containers: ps.stdout.trim().split('\n').filter(Boolean).length,
    networks: net.stdout.trim().split('\n').filter(Boolean).length,
    port8349Listeners: l49.stdout.trim().split('\n').filter(Boolean).length ? Math.max(0, l49.stdout.trim().split('\n').length - 1) : 0,
    port8350Listeners: l50.stdout.trim().split('\n').filter(Boolean).length ? Math.max(0, l50.stdout.trim().split('\n').length - 1) : 0,
  };
  appendFileSync(LOG, `SUMMARY ${JSON.stringify(summary)}\n`);
  process.stdout.write(`SUMMARY ${JSON.stringify(summary)}\n`);
  return summary;
}
async function up(n) {
  const r = sh(docker, ['compose', '-p', P, ...FILES, 'run', '--rm', '-d', '--build',
    '-p', '127.0.0.1:8349:8348', '-p', '127.0.0.1:8350:8350', '--name', `${P}-web`, 'demo', 'node', 'demo/serve.mjs']);
  if (r.status !== 0) throw new Error('run failed');
  for (let i = 0; i < 40; i++) {
    try {
      const a = await fetch('http://127.0.0.1:8349/signin', { redirect: 'manual' });
      const b = await fetch('http://127.0.0.1:8350/stripe-requests');
      appendFileSync(LOG, `serve reachable: /signin ${a.status}, ledger ${b.status}\n`);
      process.stdout.write(`serve reachable: /signin ${a.status}, ledger ${b.status}\n`);
      return;
    } catch { await new Promise(r => setTimeout(r, 500)); }
  }
  throw new Error('serve never became reachable');
}

const results = [];
results.push(measure('before: host baseline'));

// --- RED: the old step-2 teardown line (0188fd7 SKILL.md line 60)
await up(1);
results.push(measure('up #1 (serve one-off + stripe-mock)'));
sh(docker, ['compose', '-p', P, ...FILES, 'down', '-v']);
results.push(measure('after OLD line: down -v'));
// clean up what the old line left, using the new line, and measure that too
sh(docker, ['compose', '--profile', 'tools', '-p', P, ...FILES, 'down', '-v', '--remove-orphans']);
results.push(measure('after NEW line applied to the old line\'s leftovers'));

// --- GREEN: the new step-2 teardown line, from a fresh up
await up(2);
results.push(measure('up #2 (serve one-off + stripe-mock)'));
sh(docker, ['compose', '--profile', 'tools', '-p', P, ...FILES, 'down', '-v', '--remove-orphans']);
results.push(measure('after NEW line: --profile tools ... down -v --remove-orphans'));

// --- image cleanup (not part of the SKILL line; keeps the host tidy)
sh(docker, ['compose', '--profile', 'tools', '-p', P, ...FILES, 'down', '-v', '--rmi', 'local', '--remove-orphans']);

appendFileSync(LOG, `\n# RESULTS\n${results.map(r => JSON.stringify(r)).join('\n')}\n`);
process.stdout.write(`\n# RESULTS\n${results.map(r => JSON.stringify(r)).join('\n')}\n`);
