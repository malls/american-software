const BASE = 'http://127.0.0.1:8361';
const occ = (s, n) => s.split(n).length - 1;
const stateOf = (html) => (html.match(/data-state="([^"]+)"/) || [])[1];
async function signUp(displayName, email) {
  const r = await fetch(`${BASE}/signup`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: BASE }, body: new URLSearchParams({ displayName, email, password: 'correct-horse-battery-staple', next: '/' }).toString() });
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}
const hdr = (cookie, extra = {}) => ({ cookie, origin: BASE, ...extra });
const get = (path, cookie) => fetch(`${BASE}${path}`, { redirect: 'manual', headers: hdr(cookie) });
const post = (path, fields, cookie) => fetch(`${BASE}${path}`, { method: 'POST', redirect: 'manual', headers: hdr(cookie, { 'content-type': 'application/x-www-form-urlencoded' }), body: new URLSearchParams(Object.entries(fields)).toString() });
const rows = (html) => occ(html, 'action="/contracts/view"');

const C = await signUp('Ruben C', 'c@rq.test');
const D = await signUp('Ruben D', 'd@rq.test');
let html = await (await post('/contracts/new', { intent: 'add-client', pickerMode: 'new', clientName: 'Dee D', clientEmail: 'dee@rq.test' }, D)).text();
const dClient = (html.match(/<option value="([0-9a-f-]{36})"/) || [])[1];
html = await (await post('/contracts/new', { intent: 'add-client', pickerMode: 'new', clientName: 'Cee C', clientEmail: 'cee@rq.test' }, C)).text();
console.log(`C dashboard rows before: ${rows(await (await get('/', C)).text())}`);
const r = await post('/contracts/new', { intent: 'generate', pickerMode: 'select', clientId: dClient, projectDescription: 'Steal', startDate: '2026-10-01' }, C);
html = await r.text();
console.log(`P3 C uses D's client: ${r.status} ${stateOf(html)} "Select a client."=${occ(html, 'Select a client.')} 404-page=${occ(html, 'S7-ERROR-NOTFOUND')} Dee-on-page=${occ(html, 'Dee D')}`);
console.log(`C dashboard rows after: ${rows(await (await get('/', C)).text())}; D dashboard rows: ${rows(await (await get('/', D)).text())}`);
// And through the API with the same foreign id, for the contrast.
const api = await post('/contracts', { clientId: dClient, projectDescription: 'Steal', startDate: '2026-10-01' }, C);
console.log(`API with D's client: ${api.status} ${JSON.stringify(await api.text())}`);
// 5,000 exactly is accepted by the screen (boundary).
const ok = await post('/contracts/new', { intent: 'generate', pickerMode: 'select', clientId: (html.match(/<option value="([0-9a-f-]{36})"/) || [])[1], projectDescription: 'y'.repeat(5000), startDate: '2026-10-01' }, C);
console.log(`5000-char description: ${ok.status} -> ${ok.headers.get('location')}`);
console.log(`C dashboard rows now: ${rows(await (await get('/', C)).text())}`);
