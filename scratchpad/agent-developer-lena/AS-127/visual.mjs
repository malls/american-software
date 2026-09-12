// AS-127 plan §5: the 375px inspection of screen 6, MEASURED. The AS-48 recipe
// (scratchpad/agent-developer-marcus/AS-48/visual.mjs) with the URLs, the seed
// and the drives changed: serves the branch's web service in an isolated
// compose project on 127.0.0.1:8360, signs up over HTTP, and drives headless
// Chrome over CDP at Emulation.setDeviceMetricsOverride 375 through the REAL
// form submissions (the picker toggles and intents are submit buttons), so
// every state is reached the way a freelancer reaches it. Records
// scrollWidth / clientWidth / innerWidth, every element whose box crosses the
// 375px edge, the <textarea>'s box against its container, the duplicate
// banner's two buttons, and writes a PNG per state and scheme. Zero deps.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = '/Users/forrest/Code/american-software-company';
const COMPOSE_FILE = join(ROOT, '.worktrees/AS-127/apps/invoicing/compose.yaml');
const DOCKER = '/usr/local/bin/docker';
const PROJECT = 'asc-as127-visual';
const BASE = 'http://127.0.0.1:8360';
const OUT = join(ROOT, 'scratchpad/agent-developer-lena/AS-127/visual');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const EMAIL = 'visual127@example.test';
const PASSWORD = 'correct horse battery staple';

const compose = (...args) => spawnSync(DOCKER, ['compose', '-p', PROJECT, '-f', COMPOSE_FILE, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const log = [];
const say = (s) => { log.push(s); console.log(s); };

mkdirSync(OUT, { recursive: true });
let chrome = null;
const cleanup = () => {
  try { chrome?.kill('SIGKILL'); } catch { /* gone */ }
  const down = compose('down', '-v', '--rmi', 'local');
  const leak = ['ps -a --format {{.Names}}', 'images --format {{.Repository}}', 'network ls --format {{.Name}}'].map((c) => spawnSync(DOCKER, c.split(' '), { encoding: 'utf8' }).stdout.split('\n').filter((n) => n.includes(PROJECT)));
  say(`teardown: down -v --rmi local exit ${down.status}; leak check: ${leak.flat().length ? 'LEAK ' + leak.flat().join(',') : 'clean'}`);
  writeFileSync(join(OUT, 'inspection.log'), log.join('\n'));
};
process.on('exit', cleanup);

// --- 1. serve --------------------------------------------------------------------
const up = compose('run', '--build', '--rm', '--no-deps', '-d', '-p', '127.0.0.1:8360:8348', 'web');
const builtLine = (up.stdout + up.stderr).split('\n').find((l) => /Built/.test(l));
say(`web: exit ${up.status}; built line: ${builtLine ? builtLine.trim() : 'NONE'}`);
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

// --- 3. in-container scripts against the project's own volume -------------------
function inContainer(label, script) {
  const r = compose('run', '--rm', '--no-deps', 'web', 'node', '--input-type=module', '-e', script);
  const line = (r.stdout + r.stderr).split('\n').find((l) => l.startsWith('{'));
  say(`${label} -> exit ${r.status} ${line ?? r.stderr.slice(0, 300)}`);
  return line ? JSON.parse(line) : null;
}

// --- 4. Chrome over CDP ------------------------------------------------------------
if (!existsSync(CHROME)) { console.error('no Chrome'); process.exit(1); }
const profile = mkdtempSync(join(tmpdir(), 'asc-as127-chrome-'));
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
async function submit(js) { const loaded = cdp.once('Page.loadEventFired'); await evaluate(js); await loaded; }

const WIDTH = 375; const HEIGHT = 812;
const PROBE = `JSON.stringify((() => {
  const d = document.documentElement;
  const W = ${WIDTH};
  const sel = (el) => el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ').filter(Boolean).join('.') : '');
  const box = (el) => { const r = el.getBoundingClientRect(); return Math.round(r.left) + '..' + Math.round(r.right) + ' x ' + Math.round(r.top) + '..' + Math.round(r.bottom); };
  const over = [...document.querySelectorAll('body *')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > W + 0.5 || r.left < -0.5); }).map((el) => sel(el) + ' right=' + Math.round(el.getBoundingClientRect().right));
  const controls = [...document.querySelectorAll('button, a')].map((el) => sel(el) + ' "' + el.textContent.trim().replace(/\\s+/g, ' ').slice(0, 40) + '" ' + box(el));
  const fields = [...document.querySelectorAll('textarea, select, input:not([type=hidden])')].map((el) => { const p = el.closest('.field') ?? el.parentElement; return sel(el) + '[' + (el.name || el.type) + '] ' + box(el) + ' w=' + Math.round(el.getBoundingClientRect().width) + ' container=' + sel(p) + ' ' + box(p) + ' widthCss=' + getComputedStyle(el).width + ' boxSizing=' + getComputedStyle(el).boxSizing + (el.tagName === 'TEXTAREA' ? ' resize=' + getComputedStyle(el).resize + ' rows=' + el.rows : ''); });
  const invalid = [...document.querySelectorAll('.field--invalid')].map((el) => sel(el) + ' ' + box(el) + ' msg="' + (el.querySelector('.field-error')?.textContent.trim() ?? '') + '"');
  const nav = [...document.querySelectorAll('.site-nav > *')].map((el) => sel(el) + ' ' + box(el));
  const actions = [...document.querySelectorAll('.form-actions, .banner-warning p')].map((el) => sel(el) + ' ' + box(el) + ' children=' + [...el.children].map((c) => sel(c) + ' ' + box(c)).join(', '));
  return {
    path: location.pathname + location.search, state: d.dataset.state ?? null,
    scrollWidth: d.scrollWidth, clientWidth: d.clientWidth, innerWidth: innerWidth, scrollHeight: d.scrollHeight,
    scheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    bodyBg: getComputedStyle(document.body).backgroundColor, bodyColor: getComputedStyle(document.body).color, fontFamily: getComputedStyle(document.body).fontFamily.slice(0, 30),
    styleSheets: [...document.styleSheets].map((s) => (s.href ?? 'inline') + ':' + (() => { try { return s.cssRules.length; } catch { return 'unreadable'; } })()),
    over, controls, fields, invalid, nav, actions,
    bannerText: [...document.querySelectorAll('.banner')].map((b) => b.className + ' "' + b.textContent.trim().replace(/\\s+/g, ' ') + '"'),
    h1: document.querySelector('h1') ? document.querySelector('h1').textContent.trim() : null,
    title: document.title,
    textLen: document.body.textContent.replace(/\\s+/g, ' ').trim().length,
  };
})())`;

async function shot(file) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  writeFileSync(join(OUT, file), Buffer.from(data, 'base64'));
  return file;
}
function report(label, info, png) {
  say(`${label} [${info.scheme}] ${info.path} state=${info.state} viewport innerWidth=${info.innerWidth} clientWidth=${info.clientWidth} scrollWidth=${info.scrollWidth} scrollHeight=${info.scrollHeight} bg=${info.bodyBg} fg=${info.bodyColor} font=${info.fontFamily} sheets=${info.styleSheets.join(',') || 'none'} title=${JSON.stringify(info.title)} h1=${JSON.stringify(info.h1)} banners=${info.bannerText.join(' | ') || 'none'} overflowing=${info.over.length ? info.over.join('; ') : 'none'} fields=${info.fields.join('; ') || 'none'} invalid=${info.invalid.join('; ') || 'none'} nav=${info.nav.join('; ')} actions=${info.actions.join('; ') || 'none'} controls=${info.controls.join('; ') || 'none'} textLen=${info.textLen} png=${png}`);
}
let looked = 0;
const setScheme = async (scheme) => {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, mobile: true });
  await cdp.send('Emulation.setEmulatedMedia', { media: '', features: [{ name: 'prefers-color-scheme', value: scheme }] });
};
// Each state is reached by `reach()` (a navigation and, optionally, real form
// submissions), once per scheme, so the served bytes are what a phone gets.
async function inspect(label, expectedState, reach) {
  for (const scheme of ['light', 'dark']) {
    await setScheme(scheme);
    await reach();
    const info = JSON.parse(await evaluate(PROBE));
    if (info.state !== expectedState) throw new Error(`${label}: landed on ${info.path} in state ${info.state}, expected ${expectedState}`);
    report(label, info, await shot(`${label}-${scheme}-375.png`));
    looked += 1;
  }
}
const click = (value) => submit(`document.querySelector('button[name="intent"][value="${value}"]').click()`);
const fill = (values) => evaluate(`(() => { const v = ${JSON.stringify(values)}; for (const [name, value] of Object.entries(v)) { const el = document.querySelector('[name="' + name + '"]:not([type=hidden])'); if (!el) throw new Error('no field ' + name); if (el.type === 'date') el.type = 'text'; el.value = value; } return 'ok'; })()`);
const LONG_NAME = 'Ada Lovelace Consulting Group of Greater Metropolitan Area';
const DESCRIPTION = 'Redesign of the marketing site: information architecture, visual design system, and a responsive build of six templates, handed over as static HTML with a style guide.';

try {
  // 1. S6-CLIENT-EMPTY: a fresh sign-up has zero clients.
  await inspect('S6-CLIENT-EMPTY', 'S6-CLIENT-EMPTY', () => navigate(`${BASE}/contracts/new`));
  // 2. S6-CLIENT-ERROR-VALIDATION: Add client with both fields blank, from the empty picker.
  await inspect('S6-CLIENT-ERROR-VALIDATION', 'S6-CLIENT-ERROR-VALIDATION', async () => { await navigate(`${BASE}/contracts/new`); await fill({ projectDescription: DESCRIPTION, startDate: '2026-10-01' }); await click('add-client'); });
  // 3. S6-DEFAULT: add the (long-named) client, which re-renders the picker in select mode with it selected.
  let added = false;
  await inspect('S6-DEFAULT-after-add-client', 'S6-DEFAULT', async () => {
    if (!added) { await navigate(`${BASE}/contracts/new`); await fill({ clientName: LONG_NAME, clientEmail: 'ada@example.test', projectDescription: DESCRIPTION, startDate: '2026-10-01' }); await click('add-client'); added = true; }
    else await navigate(`${BASE}/contracts/new`);
  });
  // 4. S6-CLIENT-ERROR-DUPLICATE: switch to add-new, type the same email in another case.
  await inspect('S6-CLIENT-ERROR-DUPLICATE', 'S6-CLIENT-ERROR-DUPLICATE', async () => { await navigate(`${BASE}/contracts/new`); await fill({ projectDescription: DESCRIPTION, startDate: '2026-10-01' }); await click('new-client'); await fill({ clientName: 'Ada Again', clientEmail: 'ADA@EXAMPLE.TEST' }); await click('add-client'); });
  // 5. S6-ERROR-VALIDATION with all three marks: no client, blank description, an impossible date.
  await inspect('S6-ERROR-VALIDATION', 'S6-ERROR-VALIDATION', async () => { await navigate(`${BASE}/contracts/new`); await fill({ clientId: '', projectDescription: '', startDate: '2026-02-31' }); await click('generate'); });
  // 6. S6-ERROR-SYSTEM: drop the contracts table under the running server, then generate a valid body.
  const dropped = inContainer('drop contracts table', `
    import { openDatabase } from '/app/lib/db/connection.js';
    const db = openDatabase('/app/data/invoicing.sqlite');
    db.exec('DROP TABLE contracts');
    console.log(JSON.stringify({ tables: db.prepare("select name from sqlite_master where type='table' and name='contracts'").all().length }));
    db.close();
  `);
  if (!dropped || dropped.tables !== 0) throw new Error('contracts table not dropped');
  await inspect('S6-ERROR-SYSTEM', 'S6-ERROR-SYSTEM', async () => { await navigate(`${BASE}/contracts/new`); await evaluate(`(() => { const s = document.querySelector('select[name="clientId"]'); s.selectedIndex = 1; return s.value; })()`); await fill({ projectDescription: DESCRIPTION, startDate: '2026-10-01' }); await click('generate'); });
  say(`looked at ${looked} renders (6 states x 2 schemes) at a measured ${WIDTH}px; not looked at: S6-LOADING (browser-supplied), S6-ABANDON / S6-CLIENT-ABANDON (paths, not renders), S6-GATED-STRIPENOTREADY (n/a), S6-DENIED-SIGNEDOUT (screen 1's render), and the generated document's screen-7 render (AS-47's inspection).`);
} catch (e) {
  say(`ERROR ${e.stack ?? e}`);
  process.exitCode = 1;
}
// The CDP WebSocket keeps the loop alive; exit explicitly so the 'exit'
// cleanup (compose down, leak check, inspection.log) actually runs.
process.exit(process.exitCode ?? 0);
