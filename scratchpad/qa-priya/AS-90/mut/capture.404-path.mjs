#!/usr/bin/env node
// Capture the five screen-1 screenshots for the D1 demo artifact (AS-90, plan §1.7).
//
// HOST-ONLY. This drives the host's Google Chrome over the DevTools protocol
// using node's built-in WebSocket (node >= 22) — zero dependencies, nothing
// enters apps/invoicing's image or lockfile. It needs a running `web`
// (docker compose up --build web, from apps/invoicing) and refuses to write a
// PNG unless the page it is looking at is the state its filename claims.
//
// Usage: node capture.mjs [--base http://127.0.0.1:8348] [--out docs/demo/d1]
//                         [--chrome "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
//                         [--commit <sha>]   (the branch commit to record in capture.json)
//
// Exit codes: 0 captured all five; 2 web is not up at --base; 1 anything else
// (a state mismatch, a redirect off-origin, a CDP failure) — with nothing
// written for the capture that failed.

import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const BASE = opt('base', 'http://127.0.0.1:8348').replace(/\/$/, '');
const OUT = resolve(opt('out', 'docs/demo/d1'));
const CHROME = opt('chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const COMMIT = opt('commit', null);

/** The AS-45 merge commit — screen 1 as merged. Recorded in capture.json so a
 *  reader can tell which code the screenshots show. */
const SCREEN1_MERGE = '95b5ee5';

/** Each capture: file name, viewport, how to reach it, the state it must be in. */
const CAPTURES = [
  { file: 'screen-1-signin-375.png', width: 375, height: 812, mobile: true, path: '/nope', state: 'S1-DEFAULT-SIGNIN' },
  { file: 'screen-1-signin-1280.png', width: 1280, height: 800, mobile: false, path: '/signin', state: 'S1-DEFAULT-SIGNIN' },
  { file: 'screen-1-signup-375.png', width: 375, height: 812, mobile: true, path: '/signin?mode=signup', state: 'S1-DEFAULT-SIGNUP' },
  { file: 'screen-1-signup-1280.png', width: 1280, height: 800, mobile: false, path: '/signin?mode=signup', state: 'S1-DEFAULT-SIGNUP' },
  // POST-only: reached by filling the email field and pressing the real
  // submit button with the password blank, never by a hand-built URL.
  { file: 'screen-1-error-validation-375.png', width: 375, height: 812, mobile: true, path: '/signin', state: 'S1-ERROR-VALIDATION', submitWithEmailOnly: 'dana@demo.example' },
];

// --- 1. web is up ---------------------------------------------------------------

let health;
try {
  health = await fetch(`${BASE}/healthz`, { signal: AbortSignal.timeout(3000) });
} catch (err) {
  console.error(`capture: ${BASE}/healthz is unreachable (${err.message}). Start the app first:\n  cd apps/invoicing && DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 docker compose up --build web`);
  process.exit(2);
}
if (health.status !== 200) {
  console.error(`capture: ${BASE}/healthz answered ${health.status}, expected 200`);
  process.exit(2);
}
if (!existsSync(CHROME)) {
  console.error(`capture: Chrome not found at ${CHROME} (pass --chrome <path>)`);
  process.exit(1);
}

// --- 2. Chrome + a CDP session --------------------------------------------------

const profile = mkdtempSync(join(tmpdir(), 'asc-demo-chrome-'));
const chrome = spawn(CHROME, [
  '--headless=new',
  '--remote-debugging-port=0',
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--hide-scrollbars',
  '--disable-gpu',
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let chromeStderr = '';
chrome.stderr.on('data', (d) => { chromeStderr += d; });

const cleanup = () => {
  try { chrome.kill('SIGKILL'); } catch { /* already gone */ }
  // Chrome's helper processes can still be writing for a moment after the
  // kill; retry, and if the profile still will not go, say where it is.
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  } catch (err) {
    console.error(`capture: could not remove the temporary Chrome profile ${profile} (${err.code}); remove it by hand`);
  }
};
process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(1));

/** Chrome writes `<port>\n<browser ws path>` here once the debugger is listening. */
async function devtoolsPort() {
  const file = join(profile, 'DevToolsActivePort');
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    if (existsSync(file)) {
      const [port] = readFileSync(file, 'utf8').split('\n');
      if (/^\d+$/.test(port)) return Number(port);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Chrome did not open a DevTools port within 15 s\n${chromeStderr}`);
}

const port = await devtoolsPort();
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
if (!page) throw new Error('no page target');
const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();

/** A minimal CDP client over the page target's own socket (no session ids). */
function connect(url) {
  const ws = new WebSocket(url);
  let nextId = 0;
  const pending = new Map();
  const listeners = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== undefined) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (!p) return;
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
      else p.resolve(msg.result);
    } else if (msg.method && listeners.has(msg.method)) {
      for (const fn of listeners.get(msg.method)) fn(msg.params);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = (nextId += 1);
    pending.set(id, { resolve, reject, method });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const once = (method) => new Promise((resolve) => {
    const fn = (params) => { listeners.get(method).delete(fn); resolve(params); };
    if (!listeners.has(method)) listeners.set(method, new Set());
    listeners.get(method).add(fn);
  });
  const open = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', (e) => reject(new Error(`websocket: ${e.message ?? 'error'}`)), { once: true });
  });
  return { send, once, open, close: () => ws.close() };
}

const cdp = connect(page.webSocketDebuggerUrl);
await cdp.open;
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');

const evaluate = async (expression) => {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression, returnByValue: true });
  if (exceptionDetails) throw new Error(`evaluate failed: ${exceptionDetails.text}`);
  return result.value;
};

async function navigate(url) {
  const loaded = cdp.once('Page.loadEventFired');
  const { errorText } = await cdp.send('Page.navigate', { url });
  if (errorText) throw new Error(`navigate ${url}: ${errorText}`);
  await loaded;
}

/** The guard of step 3: refuse to save anything that is not the named state on
 *  this origin. A redirect to a 404, a sign-in bounce, or an unstyled page all
 *  fail here rather than becoming a PNG with a misleading name. */
async function assertState(expected, expectedPath) {
  const info = await evaluate('JSON.stringify({ href: location.href, origin: location.origin, path: location.pathname + location.search, state: document.documentElement.dataset.state ?? null, styled: getComputedStyle(document.body).fontFamily })');
  const { href, origin, path, state, styled } = JSON.parse(info);
  if (origin !== BASE) throw new Error(`page is on ${origin}, expected ${BASE} (href ${href})`);
  // A redirect is refused even when it lands on a real state: a signed-out `/`
  // bounces to /signin?next=%2F, which IS S1-DEFAULT-SIGNIN — and a PNG named
  // for one URL showing another is exactly the misleading capture this guards.
  if (path !== expectedPath) throw new Error(`page landed on ${path}, expected ${expectedPath} — a redirect is not the page it was asked for; refusing to write the screenshot`);
  if (state !== expected) throw new Error(`page at ${href} is in state ${JSON.stringify(state)}, expected ${expected} — refusing to write the screenshot`);
  if (typeof styled !== 'string' || styled === '') throw new Error('page has no computed font-family — stylesheets did not load');
  return href;
}

async function fullPagePng() {
  const { cssContentSize } = await cdp.send('Page.getLayoutMetrics');
  const { data } = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: Math.ceil(cssContentSize.width), height: Math.ceil(cssContentSize.height), scale: 1 },
  });
  return Buffer.from(data, 'base64');
}

// --- 3. the five captures -------------------------------------------------------

mkdirSync(OUT, { recursive: true });
const written = [];
try {
  for (const c of CAPTURES) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: c.width, height: c.height, deviceScaleFactor: 1, mobile: c.mobile });
    await navigate(`${BASE}${c.path}`);
    if (c.submitWithEmailOnly !== undefined) {
      // The real form: fill only the email, leave the password blank, press the
      // form's own submit button, and wait for the server's re-render.
      await assertState('S1-DEFAULT-SIGNIN', c.path);
      const loaded = cdp.once('Page.loadEventFired');
      await evaluate(`(() => {
        const form = document.querySelector('form[action="/signin"]');
        form.querySelector('input[name="email"]').value = ${JSON.stringify(c.submitWithEmailOnly)};
        form.querySelector('input[name="password"]').value = '';
        form.querySelector('button[type="submit"]').click();
        return true;
      })()`);
      await loaded;
    }
    // The POST re-render answers at the form's action, which is the same path.
    const href = await assertState(c.state, c.path);
    const png = await fullPagePng();
    const target = join(OUT, c.file);
    writeFileSync(target, png);
    written.push({ file: c.file, state: c.state, width: c.width, height: c.height, url: href, bytes: png.length });
    console.log(`wrote ${target} (${c.state} @ ${c.width}px, ${(png.length / 1024).toFixed(1)} kB)`);
  }
} catch (err) {
  console.error(`capture: ${err.message}`);
  cdp.close();
  process.exit(1);
}
cdp.close();

// --- 4. capture.json ------------------------------------------------------------

const branchCommit = COMMIT ?? (() => {
  try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return null; }
})();
const record = {
  screen1MergeCommit: SCREEN1_MERGE,
  branchCommit,
  capturedAt: new Date().toISOString(),
  chrome: version.Browser,
  method: 'cdp (node built-in WebSocket; Page.captureScreenshot full page)',
  base: BASE,
  captures: written,
};
writeFileSync(join(OUT, 'capture.json'), `${JSON.stringify(record, null, 2)}\n`);
console.log(`wrote ${join(OUT, 'capture.json')} (${version.Browser}, branch ${branchCommit})`);
// Explicit: the Chrome child would otherwise keep the event loop alive forever.
// The 'exit' handler above kills it and removes the temp profile.
process.exit(0);
