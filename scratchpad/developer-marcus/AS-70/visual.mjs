// AS-70 §9: the 375px inspection, MEASURED. Serves the branch's web service in
// an isolated compose project on 127.0.0.1:8358, signs up over HTTP, seeds the
// connected-account row for the two Stripe-derived states, and drives headless
// Chrome over CDP with Emulation.setDeviceMetricsOverride (the AS-90 capture
// path) — never --window-size, which headless Chrome clamps to 500px. For each
// rendered state and each colour scheme it records documentElement.scrollWidth
// / clientWidth / innerWidth, every element whose box crosses the 375px edge,
// and writes a PNG for eyes. Zero dependencies: node's built-in WebSocket.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = '/Users/forrest/Code/american-software-company';
const COMPOSE_FILE = join(ROOT, '.worktrees/AS-70/apps/invoicing/compose.yaml');
const DOCKER = '/usr/local/bin/docker';
const PROJECT = 'asc-as70-visual';
const BASE = 'http://127.0.0.1:8358';
const OUT = join(ROOT, 'scratchpad/developer-marcus/AS-70/visual');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const EMAIL = 'visual@example.test';
const PASSWORD = 'correct horse battery staple';

const compose = (...args) => spawnSync(DOCKER, ['compose', '-p', PROJECT, '-f', COMPOSE_FILE, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const log = [];
const say = (s) => { log.push(s); console.log(s); };

mkdirSync(OUT, { recursive: true });
let chrome = null;
const cleanup = () => {
  try { chrome?.kill('SIGKILL'); } catch { /* gone */ }
  const down = compose('down', '-v', '--rmi', 'local');
  say(`teardown: down -v --rmi local exit ${down.status}`);
  writeFileSync(join(OUT, 'inspection.log'), log.join('\n'));
};
process.on('exit', cleanup);

// --- 1. serve --------------------------------------------------------------------
const up = compose('run', '--build', '--rm', '--no-deps', '-d', '-p', '127.0.0.1:8358:8348', 'web');
say(`web: exit ${up.status}; built: ${/Built/.test(up.stdout + up.stderr)}`);
if (up.status !== 0) { console.error(up.stdout, up.stderr); process.exit(1); }
const started = Date.now();
while (Date.now() - started < 30_000) {
  try { const r = await fetch(`${BASE}/healthz`); if (r.ok) break; } catch { /* not yet */ }
  await new Promise((r) => setTimeout(r, 300));
}
say(`healthz: ${(await fetch(`${BASE}/healthz`)).status}`);

// --- 2. sign up over HTTP; carry the cookie --------------------------------------
const signup = await fetch(`${BASE}/signup`, {
  method: 'POST', redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded', origin: BASE },
  body: new URLSearchParams({ displayName: 'Visual Check', email: EMAIL, password: PASSWORD }).toString(),
});
const setCookie = signup.headers.getSetCookie()[0];
const [cookieName, cookieValue] = setCookie.split(';')[0].split('=');
say(`signup: ${signup.status} -> ${signup.headers.get('location')}; cookie ${cookieName}=<${cookieValue.length} chars>`);

// --- 3. a seeder that runs INSIDE the project against its own volume -------------
function seed(flags) {
  const script = `
    import { prepareDatabase, createRepositories } from '/app/lib/db/database.js';
    const { db } = prepareDatabase({ dbPath: '/app/data/invoicing.sqlite' });
    const repos = createRepositories(db);
    const f = repos.freelancers.findByEmail(${JSON.stringify(EMAIL)});
    if (repos.connectedAccounts.getByFreelancer(f.id) === null) repos.connectedAccounts.create({ freelancerId: f.id, stripeAccountId: 'acct_visual375' });
    const row = repos.connectedAccounts.updateReadiness('acct_visual375', ${JSON.stringify(flags)});
    console.log(JSON.stringify({ ready: row.ready }));
    db.close();
  `;
  const r = compose('run', '--rm', '--no-deps', 'web', 'node', '--input-type=module', '-e', script);
  const line = (r.stdout + r.stderr).split('\n').find((l) => l.startsWith('{'));
  say(`seed ${JSON.stringify(flags)} -> exit ${r.status} ${line ?? r.stderr.slice(0, 300)}`);
}
const flags = (chargesEnabled, due) => ({ chargesEnabled, detailsSubmitted: true, payoutsEnabled: chargesEnabled, requirementsCurrentlyDue: due, requirementsDisabledReason: due.length ? 'requirements.past_due' : null, syncedAt: new Date().toISOString() });

// --- 4. Chrome over CDP ------------------------------------------------------------
if (!existsSync(CHROME)) { console.error('no Chrome'); process.exit(1); }
const profile = mkdtempSync(join(tmpdir(), 'asc-as70-chrome-'));
chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--disable-gpu', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
process.on('exit', () => { try { rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch { /* say where */ } });
async function devtoolsPort() {
  const file = join(profile, 'DevToolsActivePort');
  const t0 = Date.now();
  while (Date.now() - t0 < 15_000) {
    if (existsSync(file)) { const [port] = readFileSync(file, 'utf8').split('\n'); if (/^\d+$/.test(port)) return Number(port); }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('no DevTools port');
}
const port = await devtoolsPort();
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
say(`chrome: ${version.Browser}`);

function connect(url) {
  const ws = new WebSocket(url);
  let nextId = 0; const pending = new Map(); const listeners = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== undefined) { const p = pending.get(msg.id); pending.delete(msg.id); if (!p) return; msg.error ? p.reject(new Error(`${p.method}: ${msg.error.message}`)) : p.resolve(msg.result); }
    else if (msg.method && listeners.has(msg.method)) for (const fn of listeners.get(msg.method)) fn(msg.params);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = (nextId += 1); pending.set(id, { resolve, reject, method }); ws.send(JSON.stringify({ id, method, params })); });
  const once = (method) => new Promise((resolve) => { const fn = (p) => { listeners.get(method).delete(fn); resolve(p); }; if (!listeners.has(method)) listeners.set(method, new Set()); listeners.get(method).add(fn); });
  const open = new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', () => reject(new Error('websocket error')), { once: true }); });
  return { send, once, open };
}
const cdp = connect(page.webSocketDebuggerUrl);
await cdp.open;
await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');
await cdp.send('Network.setCookie', { name: cookieName, value: cookieValue, url: BASE });
const evaluate = async (expr) => { const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true }); if (exceptionDetails) throw new Error(exceptionDetails.text); return result.value; };
async function navigate(url) { const loaded = cdp.once('Page.loadEventFired'); const { errorText } = await cdp.send('Page.navigate', { url }); if (errorText) throw new Error(errorText); await loaded; }

const WIDTH = 375; const HEIGHT = 812;
async function inspect(label, path, expectedState) {
  for (const scheme of ['light', 'dark']) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, mobile: true });
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
    await navigate(`${BASE}${path}`);
    const info = JSON.parse(await evaluate(`JSON.stringify((() => {
      const d = document.documentElement;
      const over = [...document.querySelectorAll('body *')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > ${WIDTH} + 0.5 || r.left < -0.5); }).map((el) => el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ').join('.') : '') + ' right=' + Math.round(el.getBoundingClientRect().right));
      const controls = [...document.querySelectorAll('button, a')].map((el) => { const r = el.getBoundingClientRect(); return el.tagName.toLowerCase() + ' "' + el.textContent.trim() + '" ' + Math.round(r.left) + '..' + Math.round(r.right) + ' x ' + Math.round(r.top) + '..' + Math.round(r.bottom); });
      const longest = Math.max(0, ...[...document.querySelectorAll('p, h1')].map((el) => el.getBoundingClientRect().width));
      return { path: location.pathname + location.search, state: d.dataset.state ?? null, scrollWidth: d.scrollWidth, clientWidth: d.clientWidth, innerWidth: innerWidth, scrollHeight: d.scrollHeight, fontFamily: getComputedStyle(document.body).fontFamily, scheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light', over, controls, widestTextBlock: Math.round(longest) };
    })())`));
    if (info.state !== expectedState) throw new Error(`${label}: landed on ${info.path} in state ${info.state}, expected ${expectedState}`);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    const file = `${label}-${scheme}.png`;
    writeFileSync(join(OUT, file), Buffer.from(data, 'base64'));
    say(`${label} [${info.scheme}] ${info.path} state=${info.state} viewport innerWidth=${info.innerWidth} clientWidth=${info.clientWidth} scrollWidth=${info.scrollWidth} scrollHeight=${info.scrollHeight} widestTextBlock=${info.widestTextBlock} overflowing=${info.over.length ? info.over.join('; ') : 'none'} controls=${info.controls.length ? info.controls.join('; ') : 'none'} font=${info.fontFamily.slice(0, 40)} png=${file}`);
  }
}

try {
  await inspect('S2-DEFAULT-NOTSTARTED', '/connect-stripe', 'S2-DEFAULT-NOTSTARTED');
  await inspect('S2-ERROR-SYSTEM', '/connect-stripe?error=start', 'S2-ERROR-SYSTEM');
  seed(flags(false, ['external_account']));
  await inspect('S2-RETURN-NOTREADY', '/connect-stripe', 'S2-RETURN-NOTREADY');
  seed(flags(true, []));
  await inspect('S2-RETURN-READY', '/connect-stripe', 'S2-RETURN-READY');
  // Also: the landing chain in a real browser — / must end on the screen.
  await navigate(`${BASE}/`);
  say(`GET / in the browser landed on ${await evaluate('location.pathname')} state=${await evaluate('document.documentElement.dataset.state ?? null')}`);
} finally {
  process.exit(0);
}
