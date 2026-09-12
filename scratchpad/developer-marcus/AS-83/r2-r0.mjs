// AS-83 R2 + R0 driver (scratch, not committed). Tick watcher:93997 loop tick 20.
// R2: counted compose suite (--build) on the fixed branch WHILE a
//     `compose build --no-cache server` runs from the same worktree, 3 runs.
// R0: probe latency p50/p99/max inside the test container, three conditions:
//     concurrent build / cpu-burn siblings / quiet.
// Docker is OFF PATH: absolute binary, project -p as83test.
import { writeFileSync, appendFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';

const DOCKER = '/usr/local/bin/docker';
const APP = '/Users/forrest/Code/american-software-company/.worktrees/AS-83/apps/chat';
const OUT = '/Users/forrest/Code/american-software-company/scratchpad/developer-marcus/AS-83';
const P = ['compose', '-p', 'as83test'];

const log = (s) => {
  console.log(s);
  appendFileSync(`${OUT}/r2-r0.log`, s + '\n');
};
const now = () => new Date().toISOString().slice(11, 19) + 'Z';

// --- R0 measurement script, executed INSIDE the test container via node -e.
// CJS (node -e) + dynamic import of the app's ESM. R0_MODE=quiet|burn|build.
const R0 = `
(async () => {
  const os = require('node:os'), fs = require('node:fs'), path = require('node:path');
  const { spawn } = require('node:child_process');
  const { createChatServer } = await import('/app/server.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r0-'));
  const { server, close } = createChatServer({ dbPath: path.join(dir, 'chat.db'), repoRoot: '/app/test/fixtures/repo' });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = 'http://127.0.0.1:' + server.address().port;
  const nproc = os.availableParallelism();
  const burners = [];
  if (process.env.R0_MODE === 'burn') {
    for (let i = 0; i < 2 * nproc; i++) burners.push(spawn(process.execPath, ['-e', 'for(;;){}'], { stdio: 'ignore' }));
    await new Promise((r) => setTimeout(r, 1500));
  }
  const xs = [];
  for (let i = 0; i < 50; i++) {
    const t0 = performance.now();
    const res = await fetch(base + '/api/identities', { signal: AbortSignal.timeout(30000) });
    await res.json();
    xs.push(performance.now() - t0);
  }
  for (const b of burners) b.kill('SIGKILL');
  xs.sort((a, b) => a - b);
  const q = (p) => xs[Math.min(xs.length - 1, Math.ceil((p / 100) * xs.length) - 1)];
  console.log('R0RESULT ' + JSON.stringify({
    mode: process.env.R0_MODE || 'quiet', nproc, burners: burners.length, n: xs.length,
    p50: +q(50).toFixed(1), p99: +q(99).toFixed(1), max: +xs[xs.length - 1].toFixed(1),
  }));
  await close();
  fs.rmSync(dir, { recursive: true, force: true });
})().catch((e) => { console.error('R0FAIL', e); process.exit(1); });
`;

function sh(args, tag) {
  const t0 = Date.now();
  const r = spawnSync(DOCKER, args, { cwd: APP, encoding: 'utf8', maxBuffer: 1 << 28 });
  const out = (r.stdout || '') + (r.stderr || '');
  writeFileSync(`${OUT}/${tag}.txt`, out);
  return { out, status: r.status, secs: Math.round((Date.now() - t0) / 10) / 100 };
}

let build = null;
function startBuild(tag) {
  const child = spawn(DOCKER, [...P, 'build', '--no-cache', 'server'], {
    cwd: APP, stdio: ['ignore', 'pipe', 'pipe'], detached: false,
  });
  let buf = '';
  child.stdout.on('data', (d) => (buf += d));
  child.stderr.on('data', (d) => (buf += d));
  child.on('close', (code) => {
    writeFileSync(`${OUT}/${tag}.txt`, buf);
    log(`[${now()}] background build ${tag} exited ${code}`);
  });
  log(`[${now()}] background build ${tag} started (pid ${child.pid})`);
  return child;
}
const buildAlive = () => build && build.exitCode === null && build.signalCode === null;

function siblings() {
  const r = spawnSync(DOCKER, ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' });
  return (r.stdout || '').trim().split('\n').filter((n) => n && !n.startsWith('as83test'));
}

const counts = (out) => {
  const g = (k) => {
    const m = out.match(new RegExp('^# ' + k + ' (\\d+)$', 'm')) || out.match(new RegExp('^ℹ ' + k + ' (\\d+)$', 'm'));
    return m ? +m[1] : null;
  };
  return { tests: g('tests'), pass: g('pass'), fail: g('fail') };
};
const builtLine = (out) => {
  const m = out.match(/^.*Image as83test-test\s+Built.*$/m) || out.match(/^.* Built\s*$/m);
  return m ? m[0].trim() : 'NO BUILD LINE';
};

const results = { r2: [], r0: [] };
let n = 0;

// ---------------- R2: counted suite under a concurrent --no-cache build -------
for (let i = 1; i <= 3; i++) {
  if (!buildAlive()) build = startBuild(`r2-build-${++n}`);
  const sibsBefore = siblings();
  log(`[${now()}] R2 run ${i}: build alive=${buildAlive()}, siblings=${JSON.stringify(sibsBefore)}`);
  const r = sh([...P, 'run', '--build', '--rm', 'test'], `r2-run-${i}`);
  const c = counts(r.out);
  const rec = {
    run: i, ...c, exit: r.status, secs: r.secs, built: builtLine(r.out),
    buildAliveAtStart: true, buildAliveAtEnd: buildAlive(), siblings: sibsBefore,
  };
  results.r2.push(rec);
  log(`[${now()}] R2 run ${i} -> tests=${c.tests} pass=${c.pass} fail=${c.fail} exit=${r.status} ${r.secs}s | ${rec.built} | buildStillRunning=${rec.buildAliveAtEnd}`);
}

// ---------------- R0: probe latency, three conditions -----------------------
for (const mode of ['build', 'burn', 'quiet']) {
  if (mode === 'build') {
    if (!buildAlive()) build = startBuild(`r0-build-${++n}`);
  } else if (buildAlive()) {
    log(`[${now()}] killing background build before R0 ${mode}`);
    build.kill('SIGKILL');
    await new Promise((r) => setTimeout(r, 1200));
  }
  const sibs = siblings();
  log(`[${now()}] R0 ${mode}: build alive=${buildAlive()}, siblings=${JSON.stringify(sibs)}`);
  const r = sh([...P, 'run', '--build', '--rm', '-e', `R0_MODE=${mode}`, 'test', 'node', '-e', R0], `r0-${mode}`);
  const m = r.out.match(/R0RESULT (\{.*\})/);
  const rec = m ? JSON.parse(m[1]) : { mode, error: 'no R0RESULT', exit: r.status };
  rec.buildAlive = buildAlive();
  rec.siblings = sibs;
  rec.built = builtLine(r.out);
  results.r0.push(rec);
  log(`[${now()}] R0 ${mode} -> ${JSON.stringify(rec)}`);
}

if (buildAlive()) build.kill('SIGKILL');
writeFileSync(`${OUT}/r2-r0-results.json`, JSON.stringify(results, null, 2));
log(`[${now()}] DONE\n` + JSON.stringify(results, null, 2));
