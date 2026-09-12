// AS-47 plan §5: the 375px + print + download inspection, MEASURED. Serves the
// branch's web service in an isolated compose project on 127.0.0.1:8359 (plan
// §5's port), signs up over HTTP, creates a client (in-container seeder, as
// AS-70 did) and a contract through the real POST /contracts, and drives
// headless Chrome over CDP with Emulation.setDeviceMetricsOverride (the AS-90
// path) — never --window-size, which headless Chrome clamps to 500px. For each
// of screen 7's three rendered states and each colour scheme it records
// documentElement.scrollWidth / clientWidth / innerWidth, every element whose
// box crosses the 375px edge, and writes a PNG for eyes. Then: the print sheet
// of S7-DEFAULT (emulated print media + Page.printToPDF) and the download
// opened from disk (file://). Zero dependencies: node's built-in WebSocket.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = '/Users/forrest/Code/american-software-company';
const COMPOSE_FILE = join(ROOT, '.worktrees/AS-47/apps/invoicing/compose.yaml');
const DOCKER = '/usr/local/bin/docker';
const PROJECT = 'asc-as47-visual';
const BASE = 'http://127.0.0.1:8359';
const OUT = join(ROOT, 'scratchpad/agent-developer-marcus/AS-47/visual');
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
const up = compose('run', '--build', '--rm', '--no-deps', '-d', '-p', '127.0.0.1:8359:8348', 'web');
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
const cookieHeader = `${cookieName}=${cookieValue}`;
say(`signup: ${signup.status} -> ${signup.headers.get('location')}; cookie ${cookieName}=<${cookieValue.length} chars>`);

// --- 3. an in-container script against the project's own volume -----------------
function inContainer(label, script) {
  const r = compose('run', '--rm', '--no-deps', 'web', 'node', '--input-type=module', '-e', script);
  const line = (r.stdout + r.stderr).split('\n').find((l) => l.startsWith('{'));
  say(`${label} -> exit ${r.status} ${line ?? r.stderr.slice(0, 300)}`);
  return line ? JSON.parse(line) : null;
}
const client = inContainer('seed client', `
  import { prepareDatabase, createRepositories } from '/app/lib/db/database.js';
  const { db } = prepareDatabase({ dbPath: '/app/data/invoicing.sqlite' });
  const repos = createRepositories(db);
  const f = repos.freelancers.findByEmail(${JSON.stringify(EMAIL)});
  const c = repos.clients.create(f.id, { name: 'Ada Lovelace Consulting Group of Greater Metropolitan Area', email: 'ada@example.test' });
  console.log(JSON.stringify({ id: c.id }));
  db.close();
`);

// --- 4. the contract, through the real POST /contracts ---------------------------
const description = 'Design and build a marketing website (6 pages), including a very-long-unbroken-identifier-ASC47-WRAP-PROBE-abcdefghijklmnopqrstuvwxyz0123456789 and <b>markup</b> that must stay text.';
const create = await fetch(`${BASE}/contracts`, {
  method: 'POST', redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded', origin: BASE, cookie: cookieHeader },
  body: new URLSearchParams({ clientId: client.id, projectDescription: description, startDate: '2026-10-01' }).toString(),
});
const detailPath = create.headers.get('location');
say(`POST /contracts: ${create.status} -> ${detailPath}`);
const contractId = detailPath.split('/').pop();

// --- 5. Chrome over CDP ------------------------------------------------------------
if (!existsSync(CHROME)) { console.error('no Chrome'); process.exit(1); }
const profile = mkdtempSync(join(tmpdir(), 'asc-as47-chrome-'));
chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--disable-gpu', '--allow-file-access-from-files', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
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
// Everything measured in one evaluate: viewport, overflow set, controls, the
// two places plan §5 says to look hardest (the placeholder runs — there is no
// textarea on screen 7 since the split), stylesheet count, and the document
// region's own box.
const PROBE = `JSON.stringify((() => {
  const d = document.documentElement;
  const W = ${WIDTH};
  const sel = (el) => el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ').filter(Boolean).join('.') : '');
  const box = (el) => { const r = el.getBoundingClientRect(); return Math.round(r.left) + '..' + Math.round(r.right) + ' x ' + Math.round(r.top) + '..' + Math.round(r.bottom); };
  const over = [...document.querySelectorAll('body *')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > W + 0.5 || r.left < -0.5); }).map((el) => sel(el) + ' right=' + Math.round(el.getBoundingClientRect().right));
  const controls = [...document.querySelectorAll('button, a')].map((el) => sel(el) + ' "' + el.textContent.trim() + '" ' + box(el));
  const placeholders = [...document.querySelectorAll('.doc-region strong, .doc-region b, .doc-region [class*=placeholder]')].map((el) => sel(el) + ' "' + el.textContent.trim().slice(0, 40) + '" ' + box(el) + ' w=' + Math.round(el.getBoundingClientRect().width));
  const region = document.querySelector('.doc-region');
  const wrapProbe = [...document.querySelectorAll('.doc-region *')].filter((el) => el.children.length === 0 && /ASC47-WRAP-PROBE/.test(el.textContent)).map((el) => sel(el) + ' ' + box(el) + ' scrollWidth=' + el.scrollWidth + ' clientWidth=' + el.clientWidth + ' overflow-wrap=' + getComputedStyle(el).overflowWrap + ' white-space=' + getComputedStyle(el).whiteSpace);
  const hidden = ['.site-header', '.site-nav', '.page-title', '.doc-actions', '.page-meta', '.doc-region', '.contract-doc', 'nav', 'form'].map((s) => { const el = document.querySelector(s); return s + '=' + (el ? getComputedStyle(el).display : 'absent'); });
  return {
    path: location.pathname + location.search, state: d.dataset.state ?? null,
    scrollWidth: d.scrollWidth, clientWidth: d.clientWidth, innerWidth: innerWidth, scrollHeight: d.scrollHeight,
    scheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    media: matchMedia('print').matches ? 'print' : 'screen',
    bodyBg: getComputedStyle(document.body).backgroundColor, bodyColor: getComputedStyle(document.body).color, fontFamily: getComputedStyle(document.body).fontFamily.slice(0, 40),
    styleSheets: [...document.styleSheets].map((s) => (s.href ?? 'inline') + ':' + (() => { try { return s.cssRules.length; } catch { return 'unreadable'; } })()),
    over, controls, placeholders, wrapProbe, hidden,
    region: region ? box(region) + ' w=' + Math.round(region.getBoundingClientRect().width) : 'absent',
    bannerText: document.querySelector('.banner') ? document.querySelector('.banner').textContent.trim() : null,
    h1: document.querySelector('h1') ? document.querySelector('h1').textContent.trim() : null,
    textLen: document.body.textContent.replace(/\\s+/g, ' ').trim().length,
  };
})())`;

async function shot(file) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  writeFileSync(join(OUT, file), Buffer.from(data, 'base64'));
  return file;
}
function report(label, info, png) {
  say(`${label} [${info.scheme}/${info.media}] ${info.path} state=${info.state} viewport innerWidth=${info.innerWidth} clientWidth=${info.clientWidth} scrollWidth=${info.scrollWidth} scrollHeight=${info.scrollHeight} bg=${info.bodyBg} fg=${info.bodyColor} font=${info.fontFamily} sheets=${info.styleSheets.join(',') || 'none'} h1=${JSON.stringify(info.h1)} banner=${JSON.stringify(info.bannerText)} region=${info.region} overflowing=${info.over.length ? info.over.join('; ') : 'none'} controls=${info.controls.length ? info.controls.join('; ') : 'none'} placeholders(${info.placeholders.length})=${info.placeholders.join('; ') || 'none'} wrapProbe=${info.wrapProbe.join('; ') || 'none'} display: ${info.hidden.join(' ')} textLen=${info.textLen} png=${png}`);
}

async function inspect(label, path, expectedState) {
  for (const scheme of ['light', 'dark']) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, mobile: true });
    await cdp.send('Emulation.setEmulatedMedia', { media: '', features: [{ name: 'prefers-color-scheme', value: scheme }] });
    await navigate(`${BASE}${path}`);
    const info = JSON.parse(await evaluate(PROBE));
    if (info.state !== expectedState) throw new Error(`${label}: landed on ${info.path} in state ${info.state}, expected ${expectedState}`);
    report(label, info, await shot(`${label}-${scheme}-375.png`));
  }
}

try {
  // --- the three rendered states at a measured 375px, both schemes ---------------
  await inspect('S7-DEFAULT', detailPath, 'S7-DEFAULT');
  await inspect('S7-ERROR-NOTFOUND', '/contracts/00000000-0000-4000-8000-000000000000', 'S7-ERROR-NOTFOUND');

  // --- print preview of S7-DEFAULT: emulated print media on a letter-width sheet,
  //     then the real thing — Page.printToPDF — saved to disk ---------------------
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 816, height: 1056, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Emulation.setEmulatedMedia', { media: 'print', features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await navigate(`${BASE}${detailPath}`);
  const printInfo = JSON.parse(await evaluate(PROBE));
  report('S7-DEFAULT-PRINT-EMULATED', printInfo, await shot('S7-DEFAULT-print-emulated-816.png'));
  const pdf = await cdp.send('Page.printToPDF', { printBackground: false, preferCSSPageSize: true });
  const pdfBytes = Buffer.from(pdf.data, 'base64');
  writeFileSync(join(OUT, 'S7-DEFAULT-print.pdf'), pdfBytes);
  const pdfText = pdfBytes.toString('latin1');
  const pageCount = (pdfText.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  say(`S7-DEFAULT-PRINT-PDF: ${pdfBytes.length} bytes, /Type /Page objects=${pageCount}, file=S7-DEFAULT-print.pdf`);
  // Also the print sheet at 375 (a phone printing) — same media, phone width.
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, mobile: true });
  await navigate(`${BASE}${detailPath}`);
  const printInfo375 = JSON.parse(await evaluate(PROBE));
  report('S7-DEFAULT-PRINT-EMULATED-375', printInfo375, await shot('S7-DEFAULT-print-emulated-375.png'));

  // --- the download, fetched with the session cookie, written to disk, opened
  //     from disk over file:// ----------------------------------------------------
  const dl = await fetch(`${BASE}${detailPath}?download=1`, { headers: { cookie: cookieHeader } });
  const dlBody = await dl.text();
  const dlName = /filename="([^"]+)"/.exec(dl.headers.get('content-disposition') ?? '')?.[1] ?? 'download.html';
  const dlPath = join(OUT, dlName);
  writeFileSync(dlPath, dlBody);
  say(`download: ${dl.status} content-type=${dl.headers.get('content-type')} content-disposition=${dl.headers.get('content-disposition')} bytes=${dlBody.length} saved=${dlName} nav=${(dlBody.match(/<nav/g) ?? []).length} form=${(dlBody.match(/<form/g) ?? []).length} links=${(dlBody.match(/<link /g) ?? []).length} '://'=${(dlBody.match(/:\/\//g) ?? []).length}`);
  // The file:// page's own resource timeline says what it tried to fetch: the
  // two root-relative stylesheet links resolve against file:// and reach nothing.
  for (const scheme of ['light', 'dark']) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, mobile: true });
    await cdp.send('Emulation.setEmulatedMedia', { media: '', features: [{ name: 'prefers-color-scheme', value: scheme }] });
    await navigate(`file://${dlPath}`);
    const info = JSON.parse(await evaluate(PROBE));
    const perf = await evaluate(`JSON.stringify(performance.getEntriesByType('resource').map((e) => e.name))`);
    say(`DOWNLOAD-FROM-DISK resources requested: ${perf}`);
    report('S7-DEFAULT-DOWNLOAD-FROM-DISK', info, await shot(`S7-DEFAULT-download-from-disk-${scheme}-375.png`));
  }
  // and the download at a desktop width, since that is where a client opens it
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Emulation.setEmulatedMedia', { media: '', features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await navigate(`file://${dlPath}`);
  report('S7-DEFAULT-DOWNLOAD-FROM-DISK-1024', JSON.parse(await evaluate(PROBE)), await shot('S7-DEFAULT-download-from-disk-light-1024.png'));

  // --- S7-ERROR-SYSTEM: drop the table after the row exists (case 25's recipe) --
  inContainer('drop contracts', `
    import { prepareDatabase } from '/app/lib/db/database.js';
    const { db } = prepareDatabase({ dbPath: '/app/data/invoicing.sqlite' });
    db.exec('DROP TABLE contracts');
    console.log(JSON.stringify({ tables: db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'contracts'").get().n }));
    db.close();
  `);
  await inspect('S7-ERROR-SYSTEM', detailPath, 'S7-ERROR-SYSTEM');
} finally {
  process.exit(0);
}
