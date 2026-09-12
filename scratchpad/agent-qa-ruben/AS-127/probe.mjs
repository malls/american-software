// M6 probes against the live AS-127 web on 127.0.0.1:8361. Prints what the screen DID.
const BASE = 'http://127.0.0.1:8361';
const occ = (s, n) => s.split(n).length - 1;
const stateOf = (html) => (html.match(/data-state="([^"]+)"/) || [])[1] ?? '(no data-state)';
const titleOf = (html) => (html.match(/<title>([^<]*)<\/title>/) || [])[1] ?? '';

async function signUp(displayName, email) {
  const r = await fetch(`${BASE}/signup`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: BASE },
    body: new URLSearchParams({ displayName, email, password: 'correct-horse-battery-staple', next: '/' }).toString(),
  });
  const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  return { status: r.status, location: r.headers.get('location'), cookie };
}
const hdr = (cookie, extra = {}) => ({ cookie, origin: BASE, ...extra });
const get = (path, cookie) => fetch(`${BASE}${path}`, { redirect: 'manual', headers: hdr(cookie) });
const post = (path, fields, cookie, extra = {}) => fetch(`${BASE}${path}`, {
  method: 'POST', redirect: 'manual',
  headers: hdr(cookie, { 'content-type': 'application/x-www-form-urlencoded', ...extra }),
  body: typeof fields === 'string' ? fields : new URLSearchParams(Array.isArray(fields) ? fields : Object.entries(fields)).toString(),
});
const clientIds = (html) => [...html.matchAll(/<option value="([0-9a-f-]{36})"/g)].map((m) => m[1]);
const marked = (html) => [...html.matchAll(/id="([A-Za-z]+)-error"/g)].map((m) => m[1]);

const out = [];
const log = (k, v) => { out.push(`${k}: ${v}`); console.log(`${k}: ${v}`); };

const A = await signUp('Ruben A', 'a@rq.test');
const B = await signUp('Ruben B', 'b@rq.test');
log('signup A', `${A.status} -> ${A.location}, cookie ${A.cookie ? 'set' : 'MISSING'}`);
log('signup B', `${B.status} -> ${B.location}`);

// Clients: one each, through the screen's own add-client.
let r = await post('/contracts/new', { intent: 'add-client', pickerMode: 'new', clientName: 'Ada A', clientEmail: 'ada@rq.test' }, A.cookie);
let html = await r.text();
const aClient = clientIds(html)[0];
log('A add-client', `${r.status} ${stateOf(html)} clients=${clientIds(html).length} id=${aClient}`);
r = await post('/contracts/new', { intent: 'add-client', pickerMode: 'new', clientName: 'Bob B', clientEmail: 'bob@rq.test' }, B.cookie);
html = await r.text();
const bClient = clientIds(html)[0];
log('B add-client', `${r.status} ${stateOf(html)} clients=${clientIds(html).length} id=${bClient}`);

const valid = (extra = {}) => ({ intent: 'generate', pickerMode: 'select', clientId: aClient, projectDescription: 'Build the thing.', startDate: '2026-10-01', ...extra });

// P1 — 5,001-character description through the screen.
r = await post('/contracts/new', valid({ projectDescription: 'x'.repeat(5001) }), A.cookie); html = await r.text();
log('P1 5001-char description', `${r.status} ${stateOf(html)} marked=${marked(html).join(',')} banner="${(html.match(/banner__title">([^<]*)/) || [])[1]}" echoed5001=${occ(html, 'x'.repeat(5001))}`);

// P2 — \r\n paragraphs: the re-render, then the generated document.
const paras = 'First paragraph.\r\n\r\nSecond paragraph.';
r = await post('/contracts/new', valid({ intent: 'new-client', projectDescription: paras }), A.cookie); html = await r.text();
const ta = (html.match(/<textarea[^>]*>([\s\S]*?)<\/textarea>/) || [])[1];
log('P2 re-render textarea bytes', JSON.stringify(ta));
r = await post('/contracts/new', valid({ projectDescription: paras }), A.cookie);
log('P2 generate', `${r.status} -> ${r.headers.get('location')}`);
let doc = await get(r.headers.get('location'), A.cookie); let docHtml = await doc.text();
const docPara = docHtml.slice(docHtml.indexOf('First paragraph.'), docHtml.indexOf('Second paragraph.') + 'Second paragraph.'.length);
log('P2 document bytes around the paragraphs', JSON.stringify(docPara));
log('P2 document pre-wrap present', `${occ(docHtml, 'pre-wrap')} in html; state ${stateOf(docHtml)}`);

// P3 — another freelancer's client with intent=generate.
r = await post('/contracts/new', valid({ clientId: bClient }), A.cookie); html = await r.text();
log('P3 foreign clientId', `${r.status} ${stateOf(html)} "Select a client."=${occ(html, 'Select a client.')} marked=${marked(html).join(',')} title="${titleOf(html)}"`);
// Was a row created? Count A's contracts via the dashboard (rows link /contracts/view?id=).
let dash = await (await get('/', A.cookie)).text();
log('P3 A dashboard contract links after foreign attempt', `${occ(dash, '/contracts/view?id=')}`);

// P4 — the redirect chain to S7-DEFAULT then ?download=1 in one session.
r = await post('/contracts/new', valid(), A.cookie);
const loc = r.headers.get('location');
doc = await get(loc, A.cookie); docHtml = await doc.text();
const dl = await get(`${loc}?download=1`, A.cookie); const dlHtml = await dl.text();
log('P4 chain', `303 -> ${loc}; GET ${doc.status} ${stateOf(docHtml)}; ?download=1 ${dl.status} disposition=${dl.headers.get('content-disposition')} type=${dl.headers.get('content-type')} same-bytes=${dlHtml === docHtml}`);

// P5 — startDate=0026-01-01.
r = await post('/contracts/new', valid({ startDate: '0026-01-01' }), A.cookie); html = await r.text();
log('P5 startDate=0026-01-01', `${r.status} ${r.status === 303 ? '-> ' + r.headers.get('location') : stateOf(html) + ' marked=' + marked(html).join(',')}`);

// P6 — GET /contracts/new?download=1 is ignored.
r = await get('/contracts/new?download=1', A.cookie); html = await r.text();
log('P6 GET ?download=1', `${r.status} ${stateOf(html)} disposition=${r.headers.get('content-disposition')}`);

// P7 — add-client with 21 parameters.
const many = [['intent', 'add-client'], ['pickerMode', 'new'], ['clientName', 'Twenty One'], ['clientEmail', 'twentyone@rq.test']];
for (let i = 0; i < 17; i += 1) many.push([`extra${i}`, 'v']);
r = await post('/contracts/new', many, A.cookie); html = await r.text();
log('P7 21 params', `${many.length} params -> ${r.status} ${r.headers.get('content-type')} body=${JSON.stringify(html.slice(0, 80))}`);
dash = await (await get('/contracts/new', A.cookie)).text();
log('P7 clients after', `${clientIds(dash).length} (Twenty One present=${occ(dash, 'Twenty One')})`);

// P8 — intent=generate&intent=generate.
r = await post('/contracts/new', [['intent', 'generate'], ['intent', 'generate'], ['clientId', aClient], ['projectDescription', 'Dup intent'], ['startDate', '2026-10-01']], A.cookie); html = await r.text();
log('P8 repeated intent', `${r.status} ${stateOf(html)} "Choose an action."=${occ(html, 'Choose an action.')}`);

// P9 — clientConfirm=1 WITHOUT duplicateId on add-client, email matching an existing client.
const before9 = clientIds(dash).length;
r = await post('/contracts/new', { intent: 'add-client', pickerMode: 'new', clientName: 'Ada Twin', clientEmail: 'ADA@RQ.TEST', clientConfirm: '1' }, A.cookie); html = await r.text();
log('P9 clientConfirm without duplicateId', `${r.status} ${stateOf(html)} clients ${before9} -> ${clientIds(html).length}; "Ada Twin" selected=${occ(html, 'Ada Twin (ADA@RQ.TEST)</option>')}`);

// P10 — pickerMode=new + intent=generate + valid clientId.
r = await post('/contracts/new', valid({ pickerMode: 'new', clientName: 'Typed Not Added', clientEmail: 'typed@rq.test' }), A.cookie); html = await r.text();
log('P10 pickerMode=new + generate + clientId', `${r.status} ${r.status === 303 ? '-> ' + r.headers.get('location') : stateOf(html) + ' marked=' + marked(html).join(',') + ' clientError=' + ((html.match(/id="client-error">([^<]*)/) || [])[1])}`);
dash = await (await get('/contracts/new', A.cookie)).text();
log('P10 clients after', `${clientIds(dash).length} (Typed Not Added present=${occ(dash, 'Typed Not Added')})`);

// R1 — repeated projectDescription (array) with generate.
r = await post('/contracts/new', [['intent', 'generate'], ['clientId', aClient], ['projectDescription', 'a'], ['projectDescription', 'b'], ['startDate', '2026-10-01']], A.cookie); html = await r.text();
log('R1 array projectDescription', `${r.status} ${stateOf(html)} marked=${marked(html).join(',')} textarea=${JSON.stringify((html.match(/<textarea[^>]*>([\s\S]*?)<\/textarea>/) || [])[1])}`);

// R2 — repeated clientId (array) with generate.
r = await post('/contracts/new', [['intent', 'generate'], ['clientId', aClient], ['clientId', aClient], ['projectDescription', 'ok'], ['startDate', '2026-10-01']], A.cookie); html = await r.text();
log('R2 array clientId', `${r.status} ${stateOf(html)} "Select a client."=${occ(html, 'Select a client.')}`);

// R3 — pickerMode=new + generate + NO clientId with clients present: the add-first message.
r = await post('/contracts/new', valid({ pickerMode: 'new', clientId: '' }), A.cookie); html = await r.text();
log('R3 pickerMode=new + generate + no clientId', `${r.status} ${stateOf(html)} "Add the client first."=${occ(html, 'Add the client first.')} field--invalid=${occ(html, 'field--invalid')} banner="${(html.match(/banner__title">([^<]*)/) || [])[1]}"`);

// R4 — existing-client with a foreign duplicateId: what gets selected?
r = await post('/contracts/new', { intent: 'existing-client', pickerMode: 'new', duplicateId: bClient, projectDescription: 'x', startDate: '2026-10-01' }, A.cookie); html = await r.text();
log('R4 existing-client with foreign duplicateId', `${r.status} ${stateOf(html)} selected=${occ(html, 'selected>')} foreignIdInPage=${occ(html, bClient)}`);

// R5 — add-client with markup in the name: escaped on the re-render and in the option label.
r = await post('/contracts/new', { intent: 'add-client', pickerMode: 'new', clientName: 'Eve <b>x</b>', clientEmail: 'eve@rq.test' }, A.cookie); html = await r.text();
log('R5 markup in client name', `${r.status} raw=${occ(html, '<b>x</b>')} escaped=${occ(html, '&lt;b&gt;x&lt;/b&gt;')}`);

// R6 — add-client with clientConfirm=1 and a WRONG duplicateId (not the match): does it still create?
const before6 = clientIds(html).length;
r = await post('/contracts/new', { intent: 'add-client', pickerMode: 'new', clientName: 'Ada Third', clientEmail: 'ada@rq.test', clientConfirm: '1', duplicateId: 'not-a-real-id' }, A.cookie); html = await r.text();
log('R6 clientConfirm=1 with bogus duplicateId', `${r.status} ${stateOf(html)} clients ${before6} -> ${clientIds(html).length}`);

// R7 — POST /contracts/new with a JSON content-type body: the router's form parser ignores it.
r = await fetch(`${BASE}/contracts/new`, { method: 'POST', redirect: 'manual', headers: hdr(A.cookie, { 'content-type': 'application/json' }), body: JSON.stringify(valid()) }); html = await r.text();
log('R7 JSON body', `${r.status} ${stateOf(html)} "Choose an action."=${occ(html, 'Choose an action.')}`);

// R8 — the whole-page count of hrefs to /contracts/new on S6 and title/h1 agreement.
html = await (await get('/contracts/new', A.cookie)).text();
log('R8 S6-DEFAULT nav', `site-nav__link=${occ(html, 'class="site-nav__link"')} title="${titleOf(html)}" h1=${(html.match(/<h1[^>]*>([^<]*)/) || [])[1]}`);

// R9 — signout via the nav then GET /contracts/new: guard.
r = await post('/signout', {}, B.cookie);
const after = await get('/contracts/new', B.cookie);
log('R9 after signout', `signout ${r.status} -> ${r.headers.get('location')}; GET /contracts/new ${after.status} -> ${after.headers.get('location')}`);

console.log('\n--- done ---');
