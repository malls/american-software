// AC-4 / AC-5 falsifiers for capture.mjs: each mutant is a SCRATCH COPY of the
// committed script with one edit, asserted applied at the intended site, run
// against a freshly restarted demo server into a scratch out dir. Records the
// exit code, the refusal line, and which PNGs were written.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = '/Users/forrest/Code/american-software-company';
const W = `${ROOT}/.worktrees/AS-130`;
const S = `${ROOT}/scratchpad/agent-developer-lena/AS-130`;
const SRC = `${W}/.claude/skills/d1-demo-artifact/capture.mjs`;
const DK = `${S}/dk.mjs`;

const dk = (...args) => spawnSync('node', [DK, '--', ...args], { encoding: 'utf8' });
const restartServer = () => {
  dk('rm', '-f', 'asc-impl-as130-web');
  const r = spawnSync('node', [DK, '--cwd', W, '--env', 'DOCKER_BUILDKIT=1', '--env', 'COMPOSE_DOCKER_CLI_BUILD=1', '--',
    'compose', '-p', 'asc-impl-as130', '-f', 'apps/invoicing/compose.yaml', '-f', '.claude/skills/d1-demo-artifact/compose.capture.yaml',
    'run', '--rm', '-d', '--build', '-p', '127.0.0.1:8349:8348', '-p', '127.0.0.1:8350:8350', '--name', 'asc-impl-as130-web', 'demo', 'node', 'demo/serve.mjs'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`server restart failed: ${r.stdout}`);
  const built = /Image asc-impl-as130-demo +Built/.test(r.stdout);
  // wait for /healthz
  const started = Date.now();
  return (async () => {
    while (Date.now() - started < 30_000) {
      try { const h = await fetch('http://127.0.0.1:8349/healthz'); if (h.status === 200) return built; } catch { /* not yet */ }
      await new Promise((res) => setTimeout(res, 300));
    }
    throw new Error('server did not come up');
  })();
};

const MUTANTS = [
  {
    name: 'AC-4 cookies cleared before #13 (S7-DEFAULT)',
    from: "  { do: generateContract },\n",
    to: "  { do: generateContract },\n  { do: async () => { await cdp.send('Network.clearBrowserCookies'); console.log('MUTANT: cookies cleared'); } },\n",
    expect: /landed on \/signin\?next=[^ ]+, expected \/contracts\/[^ ]+ .*refusing/,
    mustNotWrite: ['screen-7-default-375.png'],
    mustWrite: ['screen-6-error-validation-375.png'],
  },
  {
    name: 'AC-5a #8 expects S4-DEFAULT-CREATE at GET /invoices/new before readiness',
    from: "...both('screen-4-gated-stripenotready', '/invoices/new', 'S4-GATED-STRIPENOTREADY'),",
    to: "...both('screen-4-gated-stripenotready', '/invoices/new', 'S4-DEFAULT-CREATE'),",
    expect: /in state "S4-GATED-STRIPENOTREADY", expected S4-DEFAULT-CREATE/,
    mustNotWrite: ['screen-4-gated-stripenotready-375.png'],
    mustWrite: ['screen-2-default-notstarted-1280.png'],
  },
  {
    name: 'AC-5b #6 DOM predicate inverted (gate asserted absent on the first run)',
    from: "...both('screen-3-empty-firstrun', '/', 'S3-EMPTY-FIRSTRUN', { layer: 'S3-GATED-STRIPENOTREADY', dom: GATE_PRESENT }),",
    to: "...both('screen-3-empty-firstrun', '/', 'S3-EMPTY-FIRSTRUN', { layer: 'S3-GATED-STRIPENOTREADY', dom: GATE_ABSENT }),",
    expect: /does not show what S3-GATED-STRIPENOTREADY implies \(DOM predicate false/,
    mustNotWrite: ['screen-3-empty-firstrun-375.png'],
    mustWrite: ['screen-1-error-validation-375.png'],
  },
];

const src = readFileSync(SRC, 'utf8');
const results = [];
for (const [i, m] of MUTANTS.entries()) {
  const occurrences = src.split(m.from).length - 1;
  if (occurrences !== 1) throw new Error(`${m.name}: mutation site found ${occurrences} times, expected exactly 1`);
  const mutated = src.replace(m.from, m.to);
  if (mutated === src || !mutated.includes(m.to)) throw new Error(`${m.name}: mutation did not apply`);
  const scratch = `${S}/scratch-capture-${i + 1}.mjs`;
  writeFileSync(scratch, mutated);
  const out = `${S}/scratch-out-${i + 1}`;
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const built = await restartServer();
  const r = spawnSync('node', [scratch, '--base', 'http://127.0.0.1:8349', '--ledger', 'http://127.0.0.1:8350', '--out', out, '--commit', 'scratch'], { encoding: 'utf8', timeout: 180_000 });
  const files = readdirSync(out);
  const refusal = (r.stderr ?? '').trim().split('\n').pop();
  const red = r.status === 1 && m.expect.test(refusal) && m.mustNotWrite.every((f) => !files.includes(f)) && m.mustWrite.every((f) => files.includes(f)) && !files.includes('capture.json');
  results.push({ name: m.name, exit: r.status, refusal, written: files.length, red, serverBuilt: built });
  console.log(`${red ? 'RED (as expected)' : 'NOT RED — finding'}: ${m.name}\n  exit ${r.status}; ${files.length} files written; ${refusal}`);
}
writeFileSync(`${S}/capture-falsifiers.json`, `${JSON.stringify(results, null, 2)}\n`);
console.log(`\n${results.filter((r) => r.red).length} of ${results.length} mutants red`);
