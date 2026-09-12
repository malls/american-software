// AS-130 review: live falsifiers against serve.mjs (AC-4, AC-5, AC-13, control
// re-capture, AC-10). One fresh serve container per capture run (a run signs up
// the same email; the DB must be fresh), always torn down with `down -v`.
// usage: node live.mjs <variant>   variant = control | ac4 | ac5a | ac5b | ac10 | inspect
import { spawnSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const DOCKER = '/usr/local/bin/docker';
const W = '/Users/forrest/Code/american-software-company/.worktrees/AS-130';
const S = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-130';
const SKILL = join(W, '.claude', 'skills', 'd1-demo-artifact');
const P = 'asc-review-as130-cap';
const NAME = `${P}-web`;
const variant = process.argv[2];
const env = { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' };
const cwd = join(W, 'apps', 'invoicing');
const composeBase = ['compose', '-p', P, '-f', join(W, 'apps/invoicing/compose.yaml'), '-f', join(SKILL, 'compose.capture.yaml')];
const dk = (args, opts = {}) => spawnSync(DOCKER, args, { cwd, encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024, ...opts });

const log = [];
const say = (s) => { console.log(s); log.push(s); };

function up() {
  const r = dk([...composeBase, 'run', '--rm', '-d', '--build', '-p', '127.0.0.1:8349:8348', '-p', '127.0.0.1:8350:8350', '--name', NAME, 'demo', 'node', 'demo/serve.mjs']);
  const built = /Image asc-review-as130-cap-demo +Built/.test(r.stderr + r.stdout);
  say(`up: exit ${r.status}, receipt 'Image asc-review-as130-cap-demo Built' present: ${built}`);
  if (r.status !== 0) { say(r.stderr); throw new Error('up failed'); }
  return built;
}
async function waitHealthz() {
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    try { const r = await fetch('http://127.0.0.1:8349/healthz', { signal: AbortSignal.timeout(1000) }); if (r.status === 200) { say(`healthz 200 after ${Date.now() - started} ms`); return; } } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('serve never became healthy');
}
function down() {
  // F1 evidence: the documented teardown (SKILL step 2 / plan AC-13) first —
  // observe what it leaves — then the one that works on Compose v5.3.0.
  const bare = dk([...composeBase, 'down', '-v', '--remove-orphans']);
  const left = dk(['ps', '-a', '--filter', `name=${P}`, '--format', '{{.Names}}']).stdout.trim().split('\n').filter(Boolean);
  say(`down -v (as documented, no --profile): exit ${bare.status}; stderr: ${bare.stderr.trim().split('\n').join(' | ')}; containers still present: ${left.length} [${left.join(', ')}]`);
  const r = dk(['compose', '--profile', 'tools', ...composeBase.slice(1), 'down', '-v', '--remove-orphans']);
  say(`down -v --profile tools: exit ${r.status}; ${r.stderr.trim().split('\n').filter((l) => /Removed/.test(l)).length} 'Removed' lines`);
}
function inspectEnv() {
  const r = dk(['inspect', NAME, '--format', '{{json .Config.Env}}|{{json .NetworkSettings.Networks}}|{{json .HostConfig.PortBindings}}|{{.Config.Image}}|{{json .Config.Cmd}}']);
  const [envJson, netsJson, portsJson, image, cmd] = r.stdout.trim().split('|');
  const envList = JSON.parse(envJson);
  const nets = Object.keys(JSON.parse(netsJson));
  say(`inspect ${NAME}: image ${image}, cmd ${cmd}`);
  say(`  Env (${envList.length}): ${envList.join(' ; ')}`);
  say(`  ASC_STRIPE_MOCK_URL present: ${envList.some((e) => e.startsWith('ASC_STRIPE_MOCK_URL='))}; INVOICING_STRIPE_* entries: ${envList.filter((e) => /^INVOICING_STRIPE_/.test(e)).length}; any INVOICING_*: ${envList.filter((e) => /^INVOICING_/.test(e)).join(',') || 'none'}`);
  say(`  networks: ${nets.join(', ')}; port bindings: ${portsJson}`);
  // the transcript's demo container shape for contrast: what compose.yaml alone gives `demo`
  const cfg = dk(['compose', '--profile', 'tools', ...composeBase.slice(1), 'config', '--format', 'json']);
  const j = JSON.parse(cfg.stdout);
  say(`  merged config (profile tools) demo.networks: ${JSON.stringify(Object.keys(j.services.demo.networks ?? {}))}; demo.ports: ${JSON.stringify(j.services.demo.ports ?? null)}; web.networks: ${JSON.stringify(Object.keys(j.services.web.networks ?? {}))}; web.ports: ${JSON.stringify(j.services.web.ports?.map((p) => p.published ?? p) ?? null)}`);
}
function chromeProfiles() { return readdirSync(tmpdir()).filter((f) => f.startsWith('asc-demo-chrome-')); }

/** Run a capture script (path) into an out dir; return exit, stderr tail, PNG list. */
function runCapture(script, out, label) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const before = chromeProfiles();
  const r = spawnSync('node', [script, '--base', 'http://127.0.0.1:8349', '--ledger', 'http://127.0.0.1:8350', '--out', out, '--commit', 'review'], { cwd: W, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  writeFileSync(join(S, `capture-${label}.log`), `exit ${r.status}\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}\n`);
  const pngs = readdirSync(out).filter((f) => f.endsWith('.png')).sort();
  const after = chromeProfiles();
  const leaked = after.filter((f) => !before.includes(f));
  say(`${label}: exit ${r.status}; PNGs written ${pngs.length}; capture.json written ${existsSync(join(out, 'capture.json'))}; chrome profiles leaked: ${leaked.length}`);
  const lastErr = r.stderr.trim().split('\n').filter((l) => l.startsWith('capture:')).pop();
  if (lastErr) say(`  stderr: ${lastErr.slice(0, 300)}`);
  return { status: r.status, pngs, stdout: r.stdout, stderr: r.stderr };
}

function mutant(name, from, to) {
  const src = readFileSync(join(SKILL, 'capture.mjs'), 'utf8');
  if (!src.includes(from)) throw new Error(`${name}: anchor not found`);
  const m = src.replace(from, to);
  if (m === src) throw new Error(`${name}: mutation did not apply`);
  // capture.mjs imports only node builtins, so a scratch copy runs from anywhere
  const p = join(S, `mutant-${name}.capture.mjs`);
  writeFileSync(p, m);
  const check = readFileSync(p, 'utf8');
  say(`  [${name}] mutation applied at intended site: ${check.includes(to) && !check.includes(from)}`);
  return p;
}

async function main() {
  say(`=== variant ${variant} @ ${new Date().toISOString()} ===`);
  if (variant === 'ac10') {
    // serve.mjs refusals, no listener needed (--no-deps: no mock started)
    const a = dk([...composeBase, 'run', '--rm', '--no-deps', '-e', 'ASC_STRIPE_MOCK_URL=https://api.stripe.com', 'demo', 'node', 'demo/serve.mjs']);
    say(`AC-10a ASC_STRIPE_MOCK_URL=https://api.stripe.com: exit ${a.status}; stderr: ${a.stderr.split('\n').filter((l) => l.startsWith('demo/serve')).join(' | ')}`);
    const b = dk([...composeBase, 'run', '--rm', '--no-deps', 'demo', 'sh', '-c', 'unset ASC_STRIPE_MOCK_URL; node demo/serve.mjs']);
    say(`AC-10b unset: exit ${b.status}; stderr: ${b.stderr.split('\n').filter((l) => l.startsWith('demo/serve')).join(' | ')}`);
    const c = dk([...composeBase, 'run', '--rm', '--no-deps', '-e', 'ASC_STRIPE_MOCK_URL=https://checkout.stripe.com/x', 'demo', 'node', 'demo/serve.mjs']);
    say(`probe subdomain checkout.stripe.com: exit ${c.status}; stderr: ${c.stderr.split('\n').filter((l) => l.startsWith('demo/serve')).join(' | ')}`);
    const d = dk([...composeBase, 'run', '--rm', '--no-deps', '-e', 'ASC_STRIPE_MOCK_URL=not a url', 'demo', 'node', 'demo/serve.mjs']);
    say(`probe not-a-url: exit ${d.status}; stderr: ${d.stderr.split('\n').filter((l) => l.startsWith('demo/serve')).join(' | ')}`);
    // ports/listening never reached: a listener on 8348 in the container would need the mock; with --no-deps and a bogus mock, mockReady throws -> exit 1 after 10 s
    const e = dk([...composeBase, 'run', '--rm', '--no-deps', '-e', 'ASC_STRIPE_MOCK_URL=http://127.0.0.1:1', 'demo', 'node', 'demo/serve.mjs']);
    say(`probe mock unreachable: exit ${e.status}; stderr: ${e.stderr.split('\n').filter((l) => l.startsWith('demo/serve')).join(' | ')}`);
    down();
    return;
  }

  const built = up();
  try {
    await waitHealthz();
    inspectEnv();
    if (variant === 'control') {
      const out = join(S, 'recapture');
      const r = runCapture(join(SKILL, 'capture.mjs'), out, 'control');
      if (r.status === 0) {
        const mine = JSON.parse(readFileSync(join(out, 'capture.json'), 'utf8'));
        const theirs = JSON.parse(readFileSync(join(W, 'docs/demo/d1/capture.json'), 'utf8'));
        const key = (c) => c.captures.map((x) => `${x.file}|${x.state}|${x.width}|${x.height}|${x.layer ?? ''}|${x.media ?? ''}|${x.url.replace(/[0-9a-f-]{36}/g, 'UUID')}`).join('\n');
        say(`re-capture vs committed: files/states/widths/layer/media/urls(UUID-normalised) identical: ${key(mine) === key(theirs)}; count ${mine.captures.length} vs ${theirs.captures.length}; chrome ${mine.chrome} vs ${theirs.chrome}`);
        const dims = mine.captures.map((x) => { const t = theirs.captures.find((y) => y.file === x.file); return `${x.file}: ${x.bytes} vs ${t.bytes} (${(100 * (x.bytes - t.bytes) / t.bytes).toFixed(1)}%)`; });
        writeFileSync(join(S, 'recapture-bytes.txt'), dims.join('\n'));
        // build against the re-captured record: scratch root = tokens + re-captured dir + committed transcript
        const root = join(S, 'scratch-recapture-root');
        rmSync(root, { recursive: true, force: true });
        mkdirSync(join(root, 'docs/design/tokens'), { recursive: true });
        mkdirSync(join(root, 'docs/demo'), { recursive: true });
        spawnSync('cp', [join(W, 'docs/design/tokens/tokens.css'), join(root, 'docs/design/tokens/tokens.css')]);
        spawnSync('cp', ['-R', out, join(root, 'docs/demo/d1')]);
        spawnSync('cp', [join(W, 'docs/demo/d1/transcript.txt'), join(root, 'docs/demo/d1/transcript.txt')]);
        const b = spawnSync('node', [join(SKILL, 'build.mjs'), root, join(root, 'out.html')], { encoding: 'utf8' });
        say(`build.mjs on the re-captured record: exit ${b.status}; ${b.stdout.split('\n').slice(0, 3).join(' / ')}`);
        rmSync(root, { recursive: true, force: true });
      }
    } else if (variant === 'ac4') {
      const p = mutant('ac4', "  { do: generateContract },\n  ...both('screen-7-default'", "  { do: generateContract },\n  { do: async () => { await cdp.send('Network.clearBrowserCookies'); console.log('MUTANT: cookies cleared before #13'); } },\n  ...both('screen-7-default'");
      const r = runCapture(p, join(S, 'out-ac4'), 'ac4');
      say(`  screen-7 PNGs present: ${r.pngs.filter((f) => f.startsWith('screen-7')).length}; earlier PNGs: ${r.pngs.length} (${r.pngs.join(', ')})`);
      say(`  mutant line ran: ${r.stdout.includes('MUTANT: cookies cleared')}`);
    } else if (variant === 'ac5a') {
      const p = mutant('ac5a', "...both('screen-4-gated-stripenotready', '/invoices/new', 'S4-GATED-STRIPENOTREADY')", "...both('screen-4-gated-stripenotready', '/invoices/new', 'S4-DEFAULT-CREATE')");
      const r = runCapture(p, join(S, 'out-ac5a'), 'ac5a');
      say(`  screen-4 PNGs present: ${r.pngs.filter((f) => f.startsWith('screen-4')).length}; PNGs: ${r.pngs.join(', ')}`);
    } else if (variant === 'ac5b') {
      const p = mutant('ac5b', "{ layer: 'S3-GATED-STRIPENOTREADY', dom: GATE_PRESENT }", "{ layer: 'S3-GATED-STRIPENOTREADY', dom: GATE_ABSENT }");
      const r = runCapture(p, join(S, 'out-ac5b'), 'ac5b');
      say(`  screen-3 PNGs present: ${r.pngs.filter((f) => f.startsWith('screen-3')).length}; PNGs: ${r.pngs.join(', ')}`);
    } else if (variant === 'inspect') {
      // ledger probe: what does it answer, and is it reachable only on loopback
      const l = await (await fetch('http://127.0.0.1:8350/stripe-requests')).json();
      say(`ledger before any walk: ${JSON.stringify(l)}`);
      const other = await fetch('http://127.0.0.1:8350/anything-else');
      say(`ledger other path: ${other.status}`);
    }
  } finally {
    down();
    const leftovers = dk(['ps', '-a', '--filter', `name=${P}`, '--format', '{{.Names}}']).stdout.trim();
    const nets = dk(['network', 'ls', '--filter', `name=${P}`, '--format', '{{.Name}}']).stdout.trim();
    say(`leftovers after down: containers [${leftovers}] networks [${nets}]`);
  }
}

main().catch((e) => { say(`FAILED: ${e.message}`); process.exitCode = 1; }).finally(() => {
  writeFileSync(join(S, `live-${variant}.txt`), `${log.join('\n')}\n`);
});
