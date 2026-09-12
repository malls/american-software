// Capture screen 6's six rendered states from the live branch web (8361) as HTML files
// with the stylesheet links pointed at the live container's public assets, then
// screenshot each with headless Chrome at a 375px-wide window.
//   node capture.mjs
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const BASE = 'http://127.0.0.1:8361';
const OUT = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-127/shots';
mkdirSync(OUT, { recursive: true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const stateOf = (html) => (html.match(/data-state="([^"]+)"/) || [])[1];
async function signUp(displayName, email) {
  const r = await fetch(`${BASE}/signup`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: BASE }, body: new URLSearchParams({ displayName, email, password: 'correct-horse-battery-staple', next: '/' }).toString() });
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}
const hdr = (cookie, extra = {}) => ({ cookie, origin: BASE, ...extra });
const get = (path, cookie) => fetch(`${BASE}${path}`, { redirect: 'manual', headers: hdr(cookie) });
const post = (path, fields, cookie) => fetch(`${BASE}${path}`, { method: 'POST', redirect: 'manual', headers: hdr(cookie, { 'content-type': 'application/x-www-form-urlencoded' }), body: new URLSearchParams(Object.entries(fields)).toString() });

function save(name, html, expected) {
  const state = stateOf(html);
  const rewritten = html.replace('href="/tokens.css"', `href="${BASE}/tokens.css"`).replace('href="/app.css"', `href="${BASE}/app.css"`);
  const file = `${OUT}/${name}.html`;
  writeFileSync(file, rewritten);
  const png = `${OUT}/${name}.png`;
  const r = spawnSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--screenshot=${png}`, '--window-size=375,1500', `file://${file}`], { encoding: 'utf8' });
  // PNG width from the IHDR chunk — the viewport, measured not assumed.
  const buf = spawnSync('node', ['-e', `const b=require('fs').readFileSync('${png}');console.log(b.readUInt32BE(16),b.readUInt32BE(20))`], { encoding: 'utf8' }).stdout.trim();
  console.log(`${name}: state=${state} expected=${expected} ${state === expected ? 'OK' : 'MISMATCH'} chrome exit ${r.status} png ${buf}px`);
}

const E = await signUp('Empty Person', 'empty@rq.test');
save('S6-CLIENT-EMPTY', await (await get('/contracts/new', E)).text(), 'S6-CLIENT-EMPTY');
const F = await signUp('Full Person With A Fairly Long Display Name', 'full@rq.test');
let html = await (await post('/contracts/new', { intent: 'add-client', pickerMode: 'new', clientName: 'A Client With A Really Quite Long Name Indeed', clientEmail: 'a-client-with-a-long-address@example-domain.test' }, F)).text();
const cid = (html.match(/<option value="([0-9a-f-]{36})"/) || [])[1];
save('S6-DEFAULT', await (await get('/contracts/new', F)).text(), 'S6-DEFAULT');
save('S6-ERROR-VALIDATION-3marks', await (await post('/contracts/new', { intent: 'generate', pickerMode: 'select', clientId: '', projectDescription: '', startDate: '2026-02-31' }, F)).text(), 'S6-ERROR-VALIDATION');
save('S6-ERROR-VALIDATION-addfirst', await (await post('/contracts/new', { intent: 'generate', pickerMode: 'new', clientId: '', clientName: 'Typed', clientEmail: 'typed@rq.test', projectDescription: 'Averyveryverylongunbrokenwordthatcouldforcehorizontaloverflowifnothingwrapsit and then normal text follows here.', startDate: '2026-10-01' }, F)).text(), 'S6-ERROR-VALIDATION');
save('S6-CLIENT-ERROR-VALIDATION', await (await post('/contracts/new', { intent: 'add-client', pickerMode: 'new', clientName: '', clientEmail: '', projectDescription: 'Kept.', startDate: '2026-10-01' }, F)).text(), 'S6-CLIENT-ERROR-VALIDATION');
save('S6-CLIENT-ERROR-DUPLICATE', await (await post('/contracts/new', { intent: 'add-client', pickerMode: 'new', clientName: 'Again', clientEmail: 'A-CLIENT-WITH-A-LONG-ADDRESS@EXAMPLE-DOMAIN.TEST', projectDescription: 'Kept.', startDate: '2026-10-01' }, F)).text(), 'S6-CLIENT-ERROR-DUPLICATE');
// S6-ERROR-SYSTEM: drop the contracts table inside MY container (asc-review-as127-web-1), then generate.
const drop = spawnSync('/usr/local/bin/docker', ['exec', 'asc-review-as127-web-1', 'node', '-e', "const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync(process.env.INVOICING_DB_PATH || '/app/data/invoicing.sqlite'); db.exec('DROP TABLE contracts'); console.log('dropped')"], { encoding: 'utf8' });
console.log(`drop: exit ${drop.status} ${drop.stdout.trim()} ${drop.stderr.trim().split('\n').pop() ?? ''}`);
save('S6-ERROR-SYSTEM', await (await post('/contracts/new', { intent: 'generate', pickerMode: 'select', clientId: cid, projectDescription: 'Will fail at the write.', startDate: '2026-10-01' }, F)).text(), 'S6-ERROR-SYSTEM');
