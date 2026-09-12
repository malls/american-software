#!/usr/bin/env node
// AS-130 c2, F1 closure for SKILL.md step 2 — measured against a real compose run.
// Round A: SKILL's exact run line (project asc-capture-c2) → capture at the new tip into
//          scratch → docker inspect Env (AC-13) → the OLD bare `down -v` (expected red: 2
//          containers + 2 networks remain) → the NEW line (expected: nothing remains).
// Round B: run line again → the NEW line straight from a pristine state → nothing remains.
// Usage: node f1-step2.mjs [root=<repo root to run against>] [tag=<c2|merged>]
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const argOf = (k, d) => (process.argv.find((a) => a.startsWith(`${k}=`)) ?? `${k}=${d}`).slice(k.length + 1);
const ROOT = argOf('root', '/Users/forrest/Code/american-software-company/.worktrees/AS-130');
const TAG = argOf('tag', 'c2');
const S = `/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-130/c2`;
const DOCKER = '/usr/local/bin/docker';
const P = `asc-capture-${TAG}`;
const OVR = `${ROOT}/.claude/skills/d1-demo-artifact/compose.capture.yaml`;
const COMPOSE = `${ROOT}/apps/invoicing/compose.yaml`;
const OUT = `${S}/recapture-${TAG}`;
const log = [];
const say = (s) => { console.log(s); log.push(s); };
const dk = (...a) => spawnSync(DOCKER, a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' } });
const sh = (cmd, a) => spawnSync(cmd, a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const state = () => {
  const ps = dk('ps', '-a', '--filter', `name=${P}`, '--format', '{{.Names}}\t{{.Status}}\t{{.Ports}}').stdout.trim();
  const nets = dk('network', 'ls', '--format', '{{.Name}}').stdout.split('\n').filter((n) => n.startsWith(`${P}_`));
  const vols = dk('volume', 'ls', '--format', '{{.Name}}').stdout.split('\n').filter((n) => n.startsWith(`${P}_`));
  const containers = ps ? ps.split('\n') : [];
  return { containers, nets, vols };
};
const show = (label) => {
  const s = state();
  say(`  [${label}] containers=${s.containers.length} networks=${s.nets.length} volumes=${s.vols.length}`);
  for (const c of s.containers) say(`     ${c}`);
  for (const n of s.nets) say(`     net ${n}`);
  return s;
};
const allContainers = () => dk('ps', '-a', '--format', '{{.Names}}').stdout.trim().split('\n').filter(Boolean).sort();
const chromeProfiles = () => readdirSync('/tmp').filter((f) => f.startsWith('asc-demo-chrome-')).sort();

const baselineContainers = allContainers();
const baselineChrome = chromeProfiles();
say(`baseline: ${baselineContainers.length} containers on host (none named ${P}: ${!baselineContainers.some((c) => c.startsWith(P))}), chrome profiles ${JSON.stringify(baselineChrome)}`);

// SKILL.md step 2, run line, verbatim modulo <n> and the compose/override paths made absolute
const RUN = ['compose', '-p', P, '-f', COMPOSE, '-f', OVR, 'run', '--rm', '-d', '--build', '-p', '127.0.0.1:8349:8348', '-p', '127.0.0.1:8350:8350', '--name', `${P}-web`, 'demo', 'node', 'demo/serve.mjs'];
// the OLD teardown (cycle-1 F1) and the NEW one (rework d4cd9a5), verbatim modulo paths
const OLD_DOWN = ['compose', '-p', P, '-f', COMPOSE, '-f', OVR, 'down', '-v'];
const NEW_DOWN = ['compose', '--profile', 'tools', '-p', P, '-f', COMPOSE, '-f', OVR, 'down', '-v', '--remove-orphans'];

async function waitHealthy() {
  const t0 = Date.now();
  while (Date.now() - t0 < 60_000) {
    try { const r = await fetch('http://127.0.0.1:8349/healthz', { signal: AbortSignal.timeout(1000) }); if (r.status === 200) return true; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function startServe(label) {
  const r = dk(...RUN);
  writeFileSync(`${S}/f1-step2-${TAG}-run-${label}.log`, `$ docker ${RUN.join(' ')}\nexit ${r.status}\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}\n`);
  const receipt = (r.stdout + r.stderr).match(new RegExp(`Image ${P}-demo +Built`))?.[0] ?? null;
  say(`${label}: run line exit ${r.status}; receipt: ${receipt ?? 'NONE'}`);
  say(`${label}: healthz 200 within 60 s: ${await waitHealthy()}`);
  return r.status;
}

// ---------------- Round A ----------------
say('== Round A: run → capture → inspect → OLD down (red) → NEW down (green)');
await startServe('A');
show('after run');

// capture at the new tip (byte-identity with the committed record checked after)
mkdirSync(OUT, { recursive: true });
const tip = sh('git', ['rev-parse', '--short', 'HEAD']).stdout.trim() || 'unknown';
const cap = sh('node', [`${ROOT}/.claude/skills/d1-demo-artifact/capture.mjs`, '--base', 'http://127.0.0.1:8349', '--ledger', 'http://127.0.0.1:8350', '--commit', tip, '--out', OUT]);
writeFileSync(`${S}/f1-step2-${TAG}-capture.log`, `exit ${cap.status}\n--- stdout ---\n${cap.stdout}\n--- stderr ---\n${cap.stderr}\n`);
say(`A: capture.mjs exit ${cap.status}, wrote ${(cap.stdout.match(/^wrote .*\.png/gm) ?? []).length} PNGs; chrome profiles after: ${JSON.stringify(chromeProfiles())} (baseline ${JSON.stringify(baselineChrome)})`);
// byte-compare with the committed record
{
  const committed = `${ROOT}/docs/demo/d1`;
  const files = readdirSync(committed).filter((f) => f.endsWith('.png')).sort();
  let same = 0; const diff = [];
  for (const f of files) {
    if (!existsSync(`${OUT}/${f}`)) { diff.push(`${f} (missing)`); continue; }
    if (readFileSync(`${committed}/${f}`).equals(readFileSync(`${OUT}/${f}`))) same += 1; else diff.push(f);
  }
  const extra = readdirSync(OUT).filter((f) => f.endsWith('.png') && !files.includes(f));
  say(`A: committed PNGs ${files.length}; re-captured byte-identical ${same}/${files.length}; differing ${diff.length} ${JSON.stringify(diff)}; extra ${extra.length}`);
  if (existsSync(`${OUT}/capture.json`)) {
    const a = JSON.parse(readFileSync(`${committed}/capture.json`, 'utf8'));
    const b = JSON.parse(readFileSync(`${OUT}/capture.json`, 'utf8'));
    const key = (c) => c.captures.map((x) => [x.file, x.state, x.width, x.height, x.layer ?? null, x.media ?? null, x.url.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'UUID')].join('|')).join('\n');
    say(`A: capture.json (file,state,width,height,layer,media,url/UUID) identical: ${key(a) === key(b)}; branchCommit committed=${a.branchCommit} now=${b.branchCommit}; bytes equal per entry: ${a.captures.every((x) => b.captures.find((y) => y.file === x.file)?.bytes === x.bytes)}`);
  }
}

// AC-13: the serve container's Env
{
  const r = dk('inspect', '--format', '{{json .Config.Env}}', `${P}-web`);
  const env = JSON.parse(r.stdout || '[]');
  say(`A: inspect Env (${env.length}): ${env.map((e) => e.split('=')[0]).join(', ')} — INVOICING_STRIPE_* entries: ${env.filter((e) => e.startsWith('INVOICING_STRIPE_')).length}; ASC_STRIPE_MOCK_URL present: ${env.some((e) => e.startsWith('ASC_STRIPE_MOCK_URL='))}`);
  const nets = dk('inspect', '--format', '{{json .NetworkSettings.Networks}}', `${P}-web`);
  say(`A: networks attached: ${Object.keys(JSON.parse(nets.stdout || '{}')).join(', ')}`);
}

// OLD line — the cycle-1 red, measured again as the "before"
{
  const r = dk(...OLD_DOWN);
  writeFileSync(`${S}/f1-step2-${TAG}-olddown.log`, `$ docker ${OLD_DOWN.join(' ')}\nexit ${r.status}\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}\n`);
  say(`A: OLD bare down -v exit ${r.status}; stderr mentions "still in use": ${/still in use/.test(r.stderr)}`);
  const s = show('after OLD down');
  say(`A: OLD line red as predicted (2 containers + 2 networks remain): ${s.containers.length === 2 && s.nets.length === 2}`);
}
// NEW line
{
  const r = dk(...NEW_DOWN);
  writeFileSync(`${S}/f1-step2-${TAG}-newdown-A.log`, `$ docker ${NEW_DOWN.join(' ')}\nexit ${r.status}\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}\n`);
  say(`A: NEW down exit ${r.status}`);
  const s = show('after NEW down');
  say(`A: NEW line leaves nothing (SKILL's check "docker ps -a --filter name=${P}" empty, networks 0, volumes 0): ${s.containers.length === 0 && s.nets.length === 0 && s.vols.length === 0}`);
}

// ---------------- Round B ----------------
say('== Round B: run → NEW down straight from a pristine state');
await startServe('B');
show('after run');
{
  const r = dk(...NEW_DOWN);
  writeFileSync(`${S}/f1-step2-${TAG}-newdown-B.log`, `$ docker ${NEW_DOWN.join(' ')}\nexit ${r.status}\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}\n`);
  say(`B: NEW down exit ${r.status}; removed lines: ${(r.stderr.match(/Removed/g) ?? []).length}`);
  const s = show('after NEW down');
  say(`B: NEW line leaves nothing: ${s.containers.length === 0 && s.nets.length === 0 && s.vols.length === 0}`);
}

// hygiene: ports free, host containers untouched, chrome profiles unchanged
{
  let free = false;
  try { await fetch('http://127.0.0.1:8349/healthz', { signal: AbortSignal.timeout(500) }); } catch { free = true; }
  const after = allContainers();
  say(`hygiene: 8349 refuses after teardown: ${free}; host containers ${baselineContainers.length} → ${after.length}, same set: ${JSON.stringify(after) === JSON.stringify(baselineContainers)}; chrome profiles unchanged: ${JSON.stringify(chromeProfiles()) === JSON.stringify(baselineChrome)}`);
  // images from this project, removed so nothing of mine stays
  const imgs = dk('images', '--format', '{{.Repository}}', '--filter', `reference=${P}-*`).stdout.trim().split('\n').filter(Boolean);
  if (imgs.length) { dk('rmi', ...imgs); say(`hygiene: removed images ${imgs.join(', ')}`); }
}
writeFileSync(`${S}/f1-step2-${TAG}.txt`, log.join('\n') + '\n');
