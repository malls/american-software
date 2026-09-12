// Comparison renders: screen 4 (invoice form, on master) at 375 via the same method,
// and screen 6's three-mark state at 600 and via a real device-emulation route
// (Chrome's --window-size at 375 vs the served page measured with a scroll-width probe).
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
const BASE = 'http://127.0.0.1:8361';
const OUT = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-127/shots';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
async function signUp(displayName, email) {
  const r = await fetch(`${BASE}/signup`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: BASE }, body: new URLSearchParams({ displayName, email, password: 'correct-horse-battery-staple', next: '/' }).toString() });
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}
const hdr = (cookie, extra = {}) => ({ cookie, origin: BASE, ...extra });
const get = (path, cookie) => fetch(`${BASE}${path}`, { redirect: 'manual', headers: hdr(cookie) });
const post = (path, fields, cookie) => fetch(`${BASE}${path}`, { method: 'POST', redirect: 'manual', headers: hdr(cookie, { 'content-type': 'application/x-www-form-urlencoded' }), body: new URLSearchParams(Object.entries(fields)).toString() });
const rewrite = (html) => html.replace('href="/tokens.css"', `href="${BASE}/tokens.css"`).replace('href="/app.css"', `href="${BASE}/app.css"`);
function shot(name, html, width) {
  const file = `${OUT}/${name}.html`;
  writeFileSync(file, rewrite(html));
  const png = `${OUT}/${name}-${width}.png`;
  const r = spawnSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--screenshot=${png}`, `--window-size=${width},1500`, `file://${file}`], { encoding: 'utf8' });
  console.log(`${name} @${width}: chrome exit ${r.status}`);
}
// Measure the document's scrollWidth vs innerWidth at 375 with --dump-dom after injecting a probe.
function measure(name) {
  const file = `${OUT}/${name}.html`;
  const probe = readFileSync(file, 'utf8').replace('</body>', `<script>window.addEventListener('load',()=>{document.title='W:'+window.innerWidth+' SW:'+document.documentElement.scrollWidth+' MAIN:'+document.querySelector('main').getBoundingClientRect().width+' TA:'+(document.querySelector('textarea')?.getBoundingClientRect().width??'-')+' DATE:'+(document.querySelector('input[type=date]')?.getBoundingClientRect().width??'-')+' H1:'+document.querySelector('h1').getBoundingClientRect().width})</script></body>`);
  const pfile = `${OUT}/${name}-probe.html`;
  writeFileSync(pfile, probe);
  const r = spawnSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=375,1500', '--virtual-time-budget=3000', '--dump-dom', `file://${pfile}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  console.log(`${name} measured: ${(r.stdout.match(/<title>([^<]*)<\/title>/) || [])[1]}`);
}
const G = await signUp('Compare Person', 'compare@rq.test');
await post('/contracts/new', { intent: 'add-client', pickerMode: 'new', clientName: 'Cmp', clientEmail: 'cmp@rq.test' }, G);
const s4 = await (await post('/invoices/new', { intent: 'save', pickerMode: 'select', clientId: '', amount: '', description: '' }, G)).text();
shot('S4-invoice-form-compare', s4, 375);
measure('S4-invoice-form-compare');
shot('S6-ERROR-VALIDATION-3marks', readFileSync(`${OUT}/S6-ERROR-VALIDATION-3marks.html`, 'utf8').replaceAll(`${BASE}/`, '/'), 600);
measure('S6-ERROR-VALIDATION-3marks');
measure('S6-DEFAULT');
measure('S6-CLIENT-ERROR-DUPLICATE');
const s3 = await (await get('/', G)).text();
shot('S3-dashboard-compare', s3, 375);
measure('S3-dashboard-compare');
