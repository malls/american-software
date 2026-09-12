// AS-130 review AC-6: run the demo service twice with --build, cut at the first
// transcript line, normalise (ids, timestamps, signature digests, loopback port,
// UUIDs), compare byte-for-byte; also compare each cut run to the committed
// transcript under the same normaliser.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const DOCKER = '/usr/local/bin/docker';
const W = '/Users/forrest/Code/american-software-company/.worktrees/AS-130';
const S = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-130/c2';
const P = 'asc-c2-step1';

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
  const built = /Image asc-c2-step1-demo +Built/.test(r.stderr + r.stdout);
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
// F1, SKILL.md step 1 / demo/README.md line 7: the bare `docker compose down` (master's line,
// the red) versus `docker compose --profile tools down` (the rework's line), verbatim modulo -p/-f.
const state = (label) => {
  const ps = spawnSync(DOCKER, ['ps', '-a', '--filter', `name=${P}`, '--format', '{{.Names}}\t{{.Status}}'], { encoding: 'utf8' }).stdout.trim();
  const nets = spawnSync(DOCKER, ['network', 'ls', '--format', '{{.Name}}'], { encoding: 'utf8' }).stdout.split('\n').filter((n) => n.startsWith(`${P}_`));
  const containers = ps ? ps.split('\n') : [];
  console.log(`  [${label}] containers=${containers.length} networks=${nets.length}${containers.length ? '\n     ' + containers.join('\n     ') : ''}${nets.length ? '\n     net ' + nets.join('\n     net ') : ''}`);
  return { containers, nets };
};
state('after the two runs (run --rm removed each demo one-off; the mock depends_on started stays)');
const bare = spawnSync(DOCKER, ['compose', '-p', P, '-f', `${W}/apps/invoicing/compose.yaml`, 'down'], { cwd: `${W}/apps/invoicing`, encoding: 'utf8' });
writeFileSync(`${S}/step1-baredown.log`, `exit ${bare.status}\n${bare.stdout}\n${bare.stderr}`);
console.log(`bare "docker compose down" exit ${bare.status}; "still in use": ${/still in use/.test(bare.stderr)}`);
const s1 = state('after bare down');
console.log(`step 1 OLD line red as predicted (mock + its network remain): ${s1.containers.length === 1 && /stripe-mock/.test(s1.containers[0]) && s1.nets.length === 1}`);
const prof = spawnSync(DOCKER, ['compose', '--profile', 'tools', '-p', P, '-f', `${W}/apps/invoicing/compose.yaml`, 'down'], { cwd: `${W}/apps/invoicing`, encoding: 'utf8' });
writeFileSync(`${S}/step1-profiledown.log`, `exit ${prof.status}\n${prof.stdout}\n${prof.stderr}`);
console.log(`"docker compose --profile tools down" exit ${prof.status}`);
const s2 = state('after --profile tools down');
console.log(`step 1 NEW line leaves nothing (SKILL's check "docker ps -a --filter name=<project>" empty): ${s2.containers.length === 0 && s2.nets.length === 0}`);
const imgs = spawnSync(DOCKER, ['images', '--format', '{{.Repository}}', '--filter', `reference=${P}-*`], { encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean);
if (imgs.length) { spawnSync(DOCKER, ['rmi', ...imgs]); console.log(`hygiene: removed images ${imgs.join(', ')}`); }
