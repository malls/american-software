// AS-130 review AC-6: run the demo service twice with --build, cut at the first
// transcript line, normalise (ids, timestamps, signature digests, loopback port,
// UUIDs), compare byte-for-byte; also compare each cut run to the committed
// transcript under the same normaliser.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const DOCKER = '/usr/local/bin/docker';
const W = '/Users/forrest/Code/american-software-company/.worktrees/AS-130';
const S = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-130';
const P = 'asc-review-as130';

const normalise = (t) => t
  .replace(/acct_[A-Za-z0-9]+/g, 'acct_X')
  .replace(/in_[A-Za-z0-9]+/g, 'in_X')
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'UUID')
  .replace(/t=\d+,v1=[0-9a-f]{64}/g, 't=T,v1=SIG')
  .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, 'TS')
  .replace(/http:\/\/127\.0\.0\.1:\d+/g, 'http://127.0.0.1:PORT');

const run = (n) => {
  const args = ['compose', '-p', P, '-f', `${W}/apps/invoicing/compose.yaml`, 'run', '--rm', '--build', 'demo'];
  const r = spawnSync(DOCKER, args, { cwd: `${W}/apps/invoicing`, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' } });
  writeFileSync(`${S}/demo-run${n}.raw.txt`, `$ docker ${args.join(' ')}\nexit ${r.status}\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}\n`);
  const built = /Image asc-review-as130-demo +Built/.test(r.stderr + r.stdout);
  const idx = r.stdout.indexOf('D1 core-loop walkthrough (AS-90)');
  const cut = idx >= 0 ? r.stdout.slice(idx) : null;
  console.log(`run ${n}: exit ${r.status}, built receipt ${built}, transcript start found ${idx >= 0}, ${cut ? cut.split('\n').length : 0} lines`);
  if (cut) writeFileSync(`${S}/demo-run${n}.cut.txt`, cut);
  return { status: r.status, built, cut };
};

const a = run(1);
const b = run(2);
if (a.cut && b.cut) {
  const na = normalise(a.cut);
  const nb = normalise(b.cut);
  console.log(`two runs normalised byte-identical: ${na === nb}`);
  const committed = readFileSync(`${W}/docs/demo/d1/transcript.txt`, 'utf8');
  console.log(`run 1 normalised == committed normalised: ${na === normalise(committed)}`);
  console.log(`committed raw == run 1 raw: ${committed === a.cut} (expected false: ids/timestamps differ)`);
  if (na !== normalise(committed)) {
    const la = na.split('\n'); const lc = normalise(committed).split('\n');
    for (let i = 0; i < Math.max(la.length, lc.length); i += 1) if (la[i] !== lc[i]) { console.log(`  first diff at line ${i + 1}:\n    run: ${la[i]}\n    committed: ${lc[i]}`); break; }
  }
}
// leave nothing behind
const down = spawnSync(DOCKER, ['compose', '-p', P, '-f', `${W}/apps/invoicing/compose.yaml`, 'down', '-v', '--remove-orphans'], { cwd: `${W}/apps/invoicing`, encoding: 'utf8' });
console.log(`down -v exit ${down.status}`);
