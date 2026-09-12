#!/usr/bin/env node
// AS-130 c2, AC-9: in-place mutation of the worktree's compose.yaml — a `ports:` entry on the
// demo service must turn deploy-shape red ('the demo publishes nothing to the host').
// Backup outside the scanned tree, restore on exit (any path), assert the mutation applied,
// observe with --build, restore, prove the tree clean, rebuild, re-run.
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const W = '/Users/forrest/Code/american-software-company/.worktrees/AS-130';
const S = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-130/c2';
const F = `${W}/apps/invoicing/compose.yaml`;
const DOCKER = '/usr/local/bin/docker';
const P = 'asc-c2-m9';
const bkdir = mkdtempSync('/tmp/asc-ruben-as130-c2-');
const BK = join(bkdir, 'compose.yaml.bak');
copyFileSync(F, BK);
let restored = false;
const restore = () => { if (!restored) { copyFileSync(BK, F); restored = true; console.log(`[restore] compose.yaml restored from ${BK}`); } };
process.on('exit', restore);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(1));

const anchor = '  demo:\n    build:\n      context: ../..\n      dockerfile: apps/invoicing/Dockerfile\n      platforms:\n        - linux/amd64\n    platform: linux/amd64\n';
const t = readFileSync(F, 'utf8');
if (!t.includes(anchor)) { console.error('anchor missing'); process.exit(1); }
writeFileSync(F, t.replace(anchor, `${anchor}    ports:\n      - "127.0.0.1:8349:8348"\n`));
const applied = execFileSync('git', ['-C', W, 'diff', '--', 'apps/invoicing/compose.yaml'], { encoding: 'utf8' });
console.log('[assert] mutation applied — added lines in the worktree diff:');
console.log(applied.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).join('\n'));

const run = (label) => {
  const r = spawnSync(DOCKER, ['compose', '-p', P, '-f', F, 'run', '--rm', '--build', 'test'], { cwd: `${W}/apps/invoicing`, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' } });
  writeFileSync(`${S}/compose-test-m9-${label}.log`, `exit ${r.status}\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}\n`);
  const receipt = (r.stdout + r.stderr).match(new RegExp(`Image ${P}-test +Built`))?.[0] ?? 'NONE';
  const c = Object.fromEntries(['tests', 'pass', 'fail', 'skipped'].map((k) => [k, (r.stdout.match(new RegExp(`^ℹ ${k} (\\d+)`, 'm')) ?? [])[1]]));
  const red = r.stdout.match(/^not ok .*/gm) ?? [];
  console.log(`[${label}] exit ${r.status}; receipt ${receipt}; ${c.tests}/${c.pass}/${c.fail}/${c.skipped}`);
  if (red.length) console.log(`[${label}] red set (${red.length}):\n  ${red.join('\n  ')}`);
  const msg = (r.stdout.match(/publishes nothing to the host[^\n]*/) ?? [])[0];
  if (msg) console.log(`[${label}] message: ${msg}`);
  return { status: r.status, red };
};
const mutated = run('mutated');
restore();
const clean = spawnSync('git', ['-C', W, 'diff', '--exit-code', '--', 'apps/invoicing/compose.yaml']);
console.log(`[clean] git diff --exit-code on compose.yaml: ${clean.status === 0 ? 'tree clean' : 'DIRTY'}`);
const rerun = run('restored');
console.log(`AC-9: mutant red set is exactly one deploy-shape test: ${mutated.red.length === 1 && /deploy-shape|demo/.test(mutated.red[0])}; restored run green: ${rerun.status === 0 && rerun.red.length === 0}`);
spawnSync(DOCKER, ['compose', '--profile', 'tools', '-p', P, '-f', F, 'down', '-v', '--remove-orphans'], { cwd: `${W}/apps/invoicing` });
const imgs = spawnSync(DOCKER, ['images', '--format', '{{.Repository}}', '--filter', `reference=${P}-*`], { encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean);
if (imgs.length) { spawnSync(DOCKER, ['rmi', ...imgs]); console.log(`images removed: ${imgs.join(', ')}`); }
rmSync(bkdir, { recursive: true, force: true });
