// Real 375px renders via the Chrome DevTools protocol (Emulation.setDeviceMetricsOverride,
// mobile: true), measuring innerWidth / scrollWidth / element widths on each page.
//   node cdp-shots.mjs <name.html> ...     (files under shots/)
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const OUT = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-127/shots';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
const udd = mkdtempSync(join(tmpdir(), 'rq-chrome-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`, `--user-data-dir=${udd}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ready = false;
for (let i = 0; i < 50 && !ready; i += 1) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); ready = true; } catch { await sleep(200); } }
if (!ready) { chrome.kill(); throw new Error('chrome did not start'); }

async function render(name) {
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let id = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 800, deviceScaleFactor: 2, mobile: true });
  await send('Page.enable');
  await send('Page.navigate', { url: `file://${OUT}/${name}.html` });
  await sleep(1200);
  const probe = `JSON.stringify({ w: window.innerWidth, sw: document.documentElement.scrollWidth, bsw: document.body.scrollWidth, main: document.querySelector('main').getBoundingClientRect().width, h1: document.querySelector('h1').getBoundingClientRect().right, ta: document.querySelector('textarea') ? document.querySelector('textarea').getBoundingClientRect().right : null, date: document.querySelector('input[type=date]') ? document.querySelector('input[type=date]').getBoundingClientRect().right : null, sel: document.querySelector('select') ? document.querySelector('select').getBoundingClientRect().right : null, dupBtns: [...document.querySelectorAll('.banner-warning button')].map(b => Math.round(b.getBoundingClientRect().top)), widest: Math.max(...[...document.querySelectorAll('body *')].map(e => e.getBoundingClientRect().right)) })`;
  const ev = await send('Runtime.evaluate', { expression: probe, returnByValue: true });
  const metrics = await send('Page.getLayoutMetrics');
  const h = Math.ceil(metrics.result.cssContentSize.height);
  await send('Emulation.setDeviceMetricsOverride', { width: 375, height: h, deviceScaleFactor: 2, mobile: true });
  await sleep(300);
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  writeFileSync(`${OUT}/${name}-375cdp.png`, Buffer.from(shot.result.data, 'base64'));
  console.log(`${name}: ${ev.result.result.value} contentHeight=${h}`);
  ws.close();
  await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`);
}
try {
  for (const name of process.argv.slice(2)) await render(name);
} finally {
  chrome.kill();
  spawnSync('rm', ['-rf', udd]);
}
