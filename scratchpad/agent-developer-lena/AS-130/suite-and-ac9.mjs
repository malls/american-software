// AC-9 (in place: ports on the demo service -> deploy-shape red, restore,
// git diff --exit-code) and then the counted green `test` + `contract` runs
// with --build receipts. Also AC-10 (serve.mjs refusals via compose run).
import { spawnSync } from 'node:child_process';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';

const ROOT = '/Users/forrest/Code/american-software-company';
const W = `${ROOT}/.worktrees/AS-130`;
const S = `${ROOT}/scratchpad/agent-developer-lena/AS-130`;
const DK = `${S}/dk.mjs`;
const COMPOSE = `${W}/apps/invoicing/compose.yaml`;
const BACKUP = `${S}/compose.yaml.backup`;

const compose = (name, ...args) => {
  const r = spawnSync('node', [DK, '--log', `${S}/${name}.log`, '--cwd', `${W}/apps/invoicing`, '--env', 'DOCKER_BUILDKIT=1', '--env', 'COMPOSE_DOCKER_CLI_BUILD=1', '--',
    'compose', '-p', 'asc-impl-as130', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = r.stdout;
  const built = (out.match(/Image (\S+) +Built/) ?? [null, null])[1];
  const summary = {
    name, exit: r.status, built,
    tests: Number((out.match(/^# tests (\d+)/m) ?? [0, NaN])[1]),
    pass: Number((out.match(/^# pass (\d+)/m) ?? [0, NaN])[1]),
    fail: Number((out.match(/^# fail (\d+)/m) ?? [0, NaN])[1]),
    skipped: Number((out.match(/^# skipped (\d+)/m) ?? [0, NaN])[1]),
    failing: [...out.matchAll(/^not ok \d+ - (.*)$/gm)].map((m) => m[1]),
  };
  console.log(`${name}: exit ${summary.exit}; Image ${summary.built} Built; tests ${summary.tests} pass ${summary.pass} fail ${summary.fail} skipped ${summary.skipped}${summary.failing.length ? `\n  not ok: ${summary.failing.join(' | ')}` : ''}`);
  return summary;
};
const gitDiffExit = () => spawnSync('git', ['-C', W, 'diff', '--exit-code', '--', 'apps/invoicing/compose.yaml'], { encoding: 'utf8' }).status;

const results = {};
// stop the serve container first
spawnSync('node', [DK, '--', 'rm', '-f', 'asc-impl-as130-web'], { encoding: 'utf8' });

// --- AC-9: ports on the demo service (in place, backed up, restored) ---
const original = readFileSync(COMPOSE, 'utf8');
copyFileSync(COMPOSE, BACKUP);
const restore = () => { writeFileSync(COMPOSE, original); };
process.on('exit', restore);
try {
  const site = '    environment:\n      - ASC_STRIPE_MOCK_URL=http://stripe-mock:12111\n    command: ["node", "demo/run.mjs"]\n';
  if (original.split(site).length - 1 !== 1) throw new Error('AC-9: demo service site not found exactly once');
  const mutated = original.replace(site, `    ports:\n      - "127.0.0.1:8349:8348"\n${site}`);
  writeFileSync(COMPOSE, mutated);
  const applied = readFileSync(COMPOSE, 'utf8');
  const demoIdx = applied.indexOf('  demo:');
  if (!(applied.indexOf('"127.0.0.1:8349:8348"') > demoIdx)) throw new Error('AC-9: mutation not at the demo site');
  console.log('AC-9 mutation applied at the demo service (ports: 127.0.0.1:8349:8348)');
  results.ac9 = compose('ac9-test-mutant', 'run', '--rm', '--build', 'test');
} finally {
  restore();
}
results.ac9RestoredDiffExit = gitDiffExit();
console.log(`compose.yaml restored; git diff --exit-code: ${results.ac9RestoredDiffExit}`);

// --- AC-10: serve.mjs refuses like run.mjs ---
const serveRefusal = (name, envValue) => {
  const r = spawnSync('node', [DK, '--log', `${S}/${name}.log`, '--cwd', `${W}/apps/invoicing`, '--env', 'DOCKER_BUILDKIT=1', '--env', 'COMPOSE_DOCKER_CLI_BUILD=1', '--',
    'compose', '-p', 'asc-impl-as130', 'run', '--rm', '--build', '--no-deps', '-e', `ASC_STRIPE_MOCK_URL=${envValue}`, 'demo', 'node', 'demo/serve.mjs'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const line = (r.stdout.match(/demo\/serve: .*/) ?? [''])[0];
  console.log(`${name}: exit ${r.status}; ${line}`);
  return { exit: r.status, line };
};
results.ac10Stripe = serveRefusal('ac10-stripe-com', 'https://api.stripe.com');
results.ac10Unset = serveRefusal('ac10-unset', '');

// --- the counted green runs ---
results.test = compose('suite-test', 'run', '--rm', '--build', 'test');
results.contract = compose('suite-contract', 'run', '--rm', '--build', 'contract');
writeFileSync(`${S}/suite-and-ac9.json`, `${JSON.stringify(results, null, 2)}\n`);
