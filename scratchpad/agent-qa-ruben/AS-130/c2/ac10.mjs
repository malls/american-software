// AS-130 c2, AC-10: serve.mjs refusals inside the shipped image (--no-deps: no mock started).
import { spawnSync } from 'node:child_process';
const DOCKER = '/usr/local/bin/docker';
const W = '/Users/forrest/Code/american-software-company/.worktrees/AS-130';
const P = 'asc-c2-ac10';
const base = ['compose', '-p', P, '-f', `${W}/apps/invoicing/compose.yaml`];
const dk = (a) => spawnSync(DOCKER, a, { cwd: `${W}/apps/invoicing`, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' } });
const line = (r) => r.stderr.split('\n').filter((l) => l.startsWith('demo/serve')).join(' | ');
const a = dk([...base, 'run', '--rm', '--build', '--no-deps', '-e', 'ASC_STRIPE_MOCK_URL=https://api.stripe.com', 'demo', 'node', 'demo/serve.mjs']);
console.log(`receipt: ${(a.stdout + a.stderr).match(new RegExp(`Image ${P}-demo +Built`))?.[0] ?? 'NONE'}`);
console.log(`AC-10a api.stripe.com: exit ${a.status}; ${line(a)}`);
const b = dk([...base, 'run', '--rm', '--no-deps', 'demo', 'sh', '-c', 'unset ASC_STRIPE_MOCK_URL; node demo/serve.mjs']);
console.log(`AC-10b unset: exit ${b.status}; ${line(b)}`);
const c = dk([...base, 'run', '--rm', '--no-deps', '-e', 'ASC_STRIPE_MOCK_URL=', 'demo', 'node', 'demo/serve.mjs']);
console.log(`probe empty string: exit ${c.status}; ${line(c)}`);
dk([...base, '--profile', 'tools', 'down', '-v', '--remove-orphans']);
const left = spawnSync(DOCKER, ['ps', '-a', '--filter', `name=${P}`, '--format', '{{.Names}}'], { encoding: 'utf8' }).stdout.trim();
console.log(`teardown; containers left: ${left || 'none'}`);
const imgs = spawnSync(DOCKER, ['images', '--format', '{{.Repository}}', '--filter', `reference=${P}-*`], { encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean);
if (imgs.length) { spawnSync(DOCKER, ['rmi', ...imgs]); console.log(`images removed: ${imgs.join(', ')}`); }
