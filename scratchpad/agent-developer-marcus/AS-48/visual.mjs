// AS-48 plan §5: the 375px inspection, MEASURED. Serves the branch's web
// service in an isolated compose project on 127.0.0.1:8360 (8359 is AS-47's),
// signs up over HTTP, seeds the mirror rows in-container through the real
// repositories (a ready account, a client, a draft, an OPEN row with long
// hosted URLs, a PAID row, a contract), and drives headless Chrome over CDP
// with Emulation.setDeviceMetricsOverride at 375 — the AS-47 recipe with the
// URLs and the seed changed. For every rendered state of both screens (plus
// the gated overlay on both list states and the send-failed overlay) and
// each colour scheme it records scrollWidth / clientWidth / innerWidth, every
// element whose box crosses the 375px edge, the table wrapper's own scroll
// (the table may scroll INSIDE .table-wrap; the page must not widen), the
// .link-text boxes, and writes a PNG for eyes. Zero dependencies.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = '/Users/forrest/Code/american-software-company';
const COMPOSE_FILE = join(ROOT, '.worktrees/AS-48/apps/invoicing/compose.yaml');
const DOCKER = '/usr/local/bin/docker';
const PROJECT = 'asc-as48-visual';
const BASE = 'http://127.0.0.1:8360';
const OUT = join(ROOT, 'scratchpad/agent-developer-marcus/AS-48/visual');
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
const PRELUDE = `
  import { prepareDatabase, createRepositories } from '/app/lib/db/database.js';
  const { db } = prepareDatabase({ dbPath: '/app/data/invoicing.sqlite' });
  const repos = createRepositories(db);
  const f = repos.freelancers.findByEmail(${JSON.stringify(EMAIL)});
  const READY = (ready) => ({ chargesEnabled: ready, detailsSubmitted: true, payoutsEnabled: ready, requirementsCurrentlyDue: ready ? [] : ['external_account'], requirementsDisabledReason: ready ? null : 'requirements.past_due', syncedAt: '2026-09-12T10:00:00.000Z' });
`;
const setReady = (ready, create = false) => inContainer(`account ready=${ready}`, `${PRELUDE}
  ${create ? "repos.connectedAccounts.create({ freelancerId: f.id, stripeAccountId: 'acct_visual48' });" : ''}
  const row = repos.connectedAccounts.updateReadiness('acct_visual48', READY(${ready}));
  console.log(JSON.stringify({ ready: row.ready }));
  db.close();
`);

// --- 4. Chrome over CDP ------------------------------------------------------------
if (!existsSync(CHROME)) { console.error('no Chrome'); process.exit(1); }
const profile = mkdtempSync(join(tmpdir(), 'asc-as48-chrome-'));
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
const PROBE = `JSON.stringify((() => {
  const d = document.documentElement;
  const W = ${WIDTH};
  const sel = (el) => el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ').filter(Boolean).join('.') : '');
  const box = (el) => { const r = el.getBoundingClientRect(); return Math.round(r.left) + '..' + Math.round(r.right) + ' x ' + Math.round(r.top) + '..' + Math.round(r.bottom); };
  const over = [...document.querySelectorAll('body *')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > W + 0.5 || r.left < -0.5); }).map((el) => sel(el) + ' right=' + Math.round(el.getBoundingClientRect().right));
  const controls = [...document.querySelectorAll('button, a')].map((el) => sel(el) + ' "' + el.textContent.trim().replace(/\\s+/g, ' ').slice(0, 40) + '" ' + box(el));
  const wraps = [...document.querySelectorAll('.table-wrap')].map((el) => sel(el) + ' ' + box(el) + ' scrollWidth=' + el.scrollWidth + ' clientWidth=' + el.clientWidth + ' overflow-x=' + getComputedStyle(el).overflowX + ' cols=' + el.querySelectorAll('thead th').length + ' rows=' + el.querySelectorAll('tbody tr').length);
  const links = [...document.querySelectorAll('.link-text')].map((el) => sel(el) + ' ' + box(el) + ' w=' + Math.round(el.getBoundingClientRect().width) + ' lines~' + Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight || '20')) + ' overflow-wrap=' + getComputedStyle(el).overflowWrap + ' len=' + el.textContent.length);
  const badges = [...document.querySelectorAll('.badge')].map((el) => sel(el) + ' "' + el.textContent.trim() + '" ' + box(el));
  const nav = [...document.querySelectorAll('.site-nav > *')].map((el) => sel(el) + ' ' + box(el));
  return {
    path: location.pathname + location.search, state: d.dataset.state ?? null,
    scrollWidth: d.scrollWidth, clientWidth: d.clientWidth, innerWidth: innerWidth, scrollHeight: d.scrollHeight,
    scheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    bodyBg: getComputedStyle(document.body).backgroundColor, bodyColor: getComputedStyle(document.body).color, fontFamily: getComputedStyle(document.body).fontFamily.slice(0, 30),
    styleSheets: [...document.styleSheets].map((s) => (s.href ?? 'inline') + ':' + (() => { try { return s.cssRules.length; } catch { return 'unreadable'; } })()),
    over, controls, wraps, links, badges, nav,
    bannerText: [...document.querySelectorAll('.banner')].map((b) => b.className + ' "' + b.textContent.trim().replace(/\\s+/g, ' ') + '"'),
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
  say(`${label} [${info.scheme}] ${info.path} state=${info.state} viewport innerWidth=${info.innerWidth} clientWidth=${info.clientWidth} scrollWidth=${info.scrollWidth} scrollHeight=${info.scrollHeight} bg=${info.bodyBg} fg=${info.bodyColor} font=${info.fontFamily} sheets=${info.styleSheets.join(',') || 'none'} h1=${JSON.stringify(info.h1)} banners=${info.bannerText.join(' | ') || 'none'} overflowing=${info.over.length ? info.over.join('; ') : 'none'} tableWraps=${info.wraps.join('; ') || 'none'} linkText=${info.links.join('; ') || 'none'} badges=${info.badges.join('; ') || 'none'} nav=${info.nav.join('; ')} controls=${info.controls.join('; ') || 'none'} textLen=${info.textLen} png=${png}`);
}
let looked = 0;
async function inspect(label, path, expectedState) {
  for (const scheme of ['light', 'dark']) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, mobile: true });
    await cdp.send('Emulation.setEmulatedMedia', { media: '', features: [{ name: 'prefers-color-scheme', value: scheme }] });
    await navigate(`${BASE}${path}`);
    const info = JSON.parse(await evaluate(PROBE));
    if (info.state !== expectedState) throw new Error(`${label}: landed on ${info.path} in state ${info.state}, expected ${expectedState}`);
    report(label, info, await shot(`${label}-${scheme}-375.png`));
    looked += 1;
  }
}

try {
  // Screen 3, empty, gated (no account row — the state every sign-up lands on).
  await inspect('S3-EMPTY-FIRSTRUN-gated', '/', 'S3-EMPTY-FIRSTRUN');
  setReady(true, true);
  await inspect('S3-EMPTY-FIRSTRUN-ready', '/', 'S3-EMPTY-FIRSTRUN');

  // Seed: a client, a draft, an OPEN row with long hosted URLs, a PAID row, a contract.
  const seeded = inContainer('seed rows', `${PRELUDE}
    const c = repos.clients.create(f.id, { name: 'Ada Lovelace Consulting Group of Greater Metropolitan Area', email: 'ada@example.test' });
    const line = (minor) => [{ description: 'Website redesign — phase 1', quantity: 1, unitAmountMinor: minor }];
    const draft = repos.invoices.createDraft(f.id, { clientId: c.id, daysUntilDue: 14, lineItems: line(8000) });
    const open = repos.invoices.createDraft(f.id, { clientId: c.id, daysUntilDue: 30, lineItems: line(45000) });
    repos.invoices.attachStripeInvoice(f.id, open.id, 'in_visual48open');
    repos.invoices.applyStripeSnapshot('in_visual48open', { status: 'open', sentAt: '2026-09-01T09:30:00.000Z', dueAt: '2026-09-15T00:00:00.000Z', hostedInvoiceUrl: 'https://invoice.stripe.com/i/acct_1Visual48Example/test_YWNjdF8xVmlzdWFsNDhFeGFtcGxlLF9UZXN0SG9zdGVkSW52b2ljZVVybFRoYXRJc1ZlcnlMb25nMDEyMzQ1Njc4OTAxMjM0NTY3ODk,abcdefghij?s=ap', invoicePdfUrl: 'https://pay.stripe.com/invoice/acct_1Visual48Example/test_YWNjdF8xVmlzdWFsNDhFeGFtcGxlLF9UZXN0SW52b2ljZVBkZlVybFRoYXRJc0Fsc29WZXJ5TG9uZzAxMjM0NTY3ODk/pdf?s=ap' });
    const paid = repos.invoices.createDraft(f.id, { clientId: c.id, daysUntilDue: 30, lineItems: line(120000) });
    repos.invoices.attachStripeInvoice(f.id, paid.id, 'in_visual48paid');
    repos.invoices.applyStripeSnapshot('in_visual48paid', { status: 'paid', sentAt: '2026-08-20T09:30:00.000Z', paidAt: '2026-08-30T15:00:00.000Z', amountPaidMinor: 120000, hostedInvoiceUrl: 'https://invoice.stripe.com/i/acct_1Visual48Example/test_paid', invoicePdfUrl: 'https://pay.stripe.com/invoice/acct_1Visual48Example/test_paid/pdf' });
    const contract = repos.contracts.create(f.id, { clientId: c.id, templateId: 'independent-contractor-agreement', variables: {}, renderedHtml: '<p>x</p>' });
    console.log(JSON.stringify({ draft: draft.id, open: open.id, paid: paid.id, contract: contract.id }));
    db.close();
  `);

  await inspect('S3-DEFAULT-POPULATED-ready', '/', 'S3-DEFAULT-POPULATED');
  await inspect('S5-DEFAULT-DRAFT', `/invoices/${seeded.draft}`, 'S5-DEFAULT-DRAFT');
  await inspect('S5-DEFAULT-DRAFT-sendfailed', `/invoices/${seeded.draft}?error=send`, 'S5-DEFAULT-DRAFT');
  await inspect('S5-DEFAULT-OPEN', `/invoices/${seeded.open}`, 'S5-DEFAULT-OPEN');
  await inspect('S5-DEFAULT-PAID', `/invoices/${seeded.paid}`, 'S5-DEFAULT-PAID');
  await inspect('S5-ERROR-NOTFOUND', '/invoices/00000000-0000-4000-8000-000000000000', 'S5-ERROR-NOTFOUND');

  setReady(false);
  await inspect('S3-DEFAULT-POPULATED-gated', '/', 'S3-DEFAULT-POPULATED');
  await inspect('S5-DEFAULT-DRAFT-gated', `/invoices/${seeded.draft}`, 'S5-DEFAULT-DRAFT');

  // The two system states, by the suite's own fault injection.
  inContainer('drop invoice_line_items', `${PRELUDE} db.exec('DROP TABLE invoice_line_items'); console.log(JSON.stringify({ ok: true })); db.close();`);
  await inspect('S5-ERROR-SYSTEM', `/invoices/${seeded.draft}`, 'S5-ERROR-SYSTEM');
  inContainer('drop contracts', `${PRELUDE} db.exec('DROP TABLE contracts'); console.log(JSON.stringify({ ok: true })); db.close();`);
  await inspect('S3-ERROR-SYSTEM', '/', 'S3-ERROR-SYSTEM');
  say(`LOOKED AT: ${looked} renders (${looked / 2} states x 2 schemes) at a measured ${WIDTH}px`);
} finally {
  process.exit(0);
}
