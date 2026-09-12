// Scratch: run one AS-48 §8 recipe on a git-archive extract OUTSIDE the worktree.
//   node recipe.cjs <name> <mutator> [--service contract] [--env K=V]
// Extracts HEAD of the AS-48 worktree to /tmp/as48-<name>, mutates, asserts
// the mutation applied AT THE INTENDED SITE (occurrence counts anchored to
// the enclosing construct), runs the counted compose suite there (project
// asc-impl-as48-<name>, --build), ALWAYS tears down (down -v --rmi local),
// leak-checks, writes the log beside this file, prints the receipt and the
// exact red set.
const fs = require('fs');
const { execSync, spawnSync } = require('child_process');
const argv = process.argv.slice(2);
const [name, mutator] = argv;
const opt = { env: {}, service: 'test' };
for (let i = 2; i < argv.length; i++) {
  if (argv[i] === '--env') { const [k, v] = argv[++i].split('='); opt.env[k] = v; }
  else if (argv[i] === '--service') opt.service = argv[++i];
}
const DOCKER = '/usr/local/bin/docker';
const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-48';
const ROOT = '/Users/forrest/Code/american-software-company';
const OUT = `/tmp/as48-${name}`;
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
execSync(`git -C ${WT} archive HEAD apps/invoicing docs/design/tokens .dockerignore | tar -x -C ${OUT}`);
const app = `${OUT}/apps/invoicing`;
const count = (file, re) => (fs.readFileSync(file, 'utf8').match(re) || []).length;
const mutate = (file, fn) => fs.writeFileSync(file, fn(fs.readFileSync(file, 'utf8')));
const dash = `${app}/views/dashboard.ejs`;
const detail = `${app}/views/invoice-detail.ejs`;
const dashVm = `${app}/lib/screens/dashboard-view.js`;
const detailVm = `${app}/lib/screens/invoice-detail-view.js`;
const pages = `${app}/routes/pages.js`;
const invoices = `${app}/routes/invoices.js`;
const contracts = `${app}/routes/contracts.js`;
const money = `${app}/lib/db/money.js`;
const applied = (label, before, after, expectBefore, expectAfter) => {
  console.log(`assert-applied ${label}: ${before} -> ${after} (expected ${expectBefore} -> ${expectAfter})`);
  if (before !== expectBefore || after !== expectAfter) throw new Error('mutation did not apply at the intended site');
};
const marker = (file, re, n, what) => {
  const c = count(file, re);
  if (c !== n) throw new Error(`marker ${what}: ${c}, expected ${n}`);
};

if (mutator === 'none') {
  console.log('no mutation');
} else if (mutator === 'f1') {
  // F1: the invoice row's View form -> an anchor with the id in the href.
  const site = /<form class="inline-form" method="get" action="\/invoices\/view">\n\s*<input type="hidden" name="id" value="<%= row\.id %>" \/>\n\s*<button type="submit" class="btn-link">View<\/button>\n\s*<\/form>/;
  const b = count(dash, site);
  mutate(dash, (s) => s.replace(site, '<a href="/invoices/<%= row.id %>">View</a>'));
  applied('invoice View form in dashboard.ejs', b, count(dash, site), 1, 0);
  marker(dash, /href="\/invoices\/<%/g, 1, 'href="/invoices/<%');
  marker(dash, /action="\/contracts\/view"/g, 1, 'the contract form untouched');
} else if (mutator === 'f2') {
  // F2: hostedInvoiceUrl rendered as an anchor's href.
  const site = '<code class="link-text"><%= hostedInvoiceUrl %></code>';
  const b = count(detail, new RegExp(site.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'));
  mutate(detail, (s) => s.replace(site, '<a href="<%= hostedInvoiceUrl %>">open</a>'));
  applied('hosted link code element', b, count(detail, /<code class="link-text"><%= hostedInvoiceUrl %><\/code>/g), 1, 0);
  marker(detail, /href="<%= hostedInvoiceUrl %>"/g, 1, 'the href');
} else if (mutator === 'f3') {
  // F3: the view model drops the hosted URL (null always) — anchored to the
  // one line in invoiceDetailLocals that reads it.
  const site = 'const hostedInvoiceUrl = rendersRow ? invoice.hostedInvoiceUrl ?? null : null;';
  const b = count(detailVm, new RegExp(site.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'));
  mutate(detailVm, (s) => s.replace(site, 'const hostedInvoiceUrl = null;'));
  applied('hostedInvoiceUrl local', b, count(detailVm, /const hostedInvoiceUrl = rendersRow/g), 1, 0);
  marker(detailVm, /const hostedInvoiceUrl = null;/g, 1, 'the null');
} else if (mutator === 'f3a') {
  // F3a: the literal label in the template instead of the local.
  const b = count(detail, /<%= totalLabel %>/g);
  mutate(detail, (s) => s.replace('<p><%= totalLabel %>: <%= totalText %>', '<p>Amount: <%= totalText %>'));
  applied('totalLabel interpolation', b, count(detail, /<%= totalLabel %>/g), 1, 0);
  marker(detail, /<p>Amount: /g, 1, 'the literal');
} else if (mutator === 'f4a') {
  // F4a: pages.js swallows the repository error and renders the list state.
  const site = "      locals = dashboardLocals({ failure: 'system' });";
  const b = count(pages, /failure: 'system'/g);
  mutate(pages, (s) => s.replace(site, '      locals = dashboardLocals({ account: null });'));
  applied("failure: 'system' in pages.js", b, count(pages, /failure: 'system'/g), 1, 0);
} else if (mutator === 'f4b') {
  // F4b: the detail route's second catch (client/account) renders NOTFOUND
  // instead of SYSTEM, and the first catch's non-NotFound branch too.
  const b = count(invoices, /invoiceDetailLocals\(\{ failure: 'system' \}\)/g);
  mutate(invoices, (s) => s.split("invoiceDetailLocals({ failure: 'system' })").join("invoiceDetailLocals({ failure: 'not-found' })"));
  applied("failure: 'system' in the detail route", b, count(invoices, /invoiceDetailLocals\(\{ failure: 'system' \}\)/g), 2, 0);
  marker(invoices, /invoiceDetailLocals\(\{ failure: 'not-found' \}\)/g, 3, 'not-found renders (1 original + 2 mutated)');
} else if (mutator === 'f5') {
  // F5: stripeReady = true unconditionally in dashboard-view.js.
  const site = 'const stripeReady = account !== null && account.ready === true;';
  const b = count(dashVm, new RegExp(site.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'));
  mutate(dashVm, (s) => s.replace(site, 'const stripeReady = true;'));
  applied('stripeReady in dashboard-view.js', b, count(dashVm, /const stripeReady = account !== null/g), 1, 0);
  marker(dashVm, /const stripeReady = true;/g, 1, 'the constant');
} else if (mutator === 'f6') {
  // F6: canSend ignores readiness in invoice-detail-view.js.
  const site = 'const canSend = sendable && stripeReady;';
  const b = count(detailVm, /const canSend = sendable && stripeReady;/g);
  mutate(detailVm, (s) => s.replace(site, 'const canSend = sendable;'));
  applied('canSend guard', b, count(detailVm, /const canSend = sendable && stripeReady;/g), 1, 0);
  marker(detailVm, /const canSend = sendable;/g, 1, 'the unguarded form');
} else if (mutator === 'f7') {
  // F7: a New contract anchor in dashboard.ejs before AS-127.
  const b = count(dash, /href="\/contracts\/new"/g);
  mutate(dash, (s) => s.replace('<a class="site-nav__link" href="/">Dashboard</a>', '<a class="site-nav__link" href="/">Dashboard</a>\n          <a class="site-nav__link" href="/contracts/new">New contract</a>'));
  applied('/contracts/new anchor', b, count(dash, /href="\/contracts\/new"/g), 0, 1);
} else if (mutator === 'f8') {
  // F8: the redirectors drop the UUID_SHAPE test (any string redirects).
  const bI = count(invoices, /if \(typeof id !== 'string' \|\| !UUID_SHAPE\.test\(id\)\) return fail\(res, step, new NotFoundError\('invoice'\)\);/g);
  mutate(invoices, (s) => s.replace("if (typeof id !== 'string' || !UUID_SHAPE.test(id)) return fail(res, step, new NotFoundError('invoice'));", "if (typeof id !== 'string') return fail(res, step, new NotFoundError('invoice'));"));
  applied('UUID_SHAPE test in the invoices redirector', bI, count(invoices, /if \(typeof id !== 'string' \|\| !UUID_SHAPE\.test\(id\)\) return fail\(res, step, new NotFoundError\('invoice'\)\);/g), 1, 0);
  const bC = count(contracts, /!UUID_SHAPE\.test\(id\)/g);
  mutate(contracts, (s) => s.replace("if (typeof id !== 'string' || !UUID_SHAPE.test(id)) return fail(res, 'screen-view', new NotFoundError('contract'));", "if (typeof id !== 'string') return fail(res, 'screen-view', new NotFoundError('contract'));"));
  applied('UUID_SHAPE test in the contracts redirector', bC, count(contracts, /!UUID_SHAPE\.test\(id\)/g), 1, 0);
  marker(invoices, /!UUID_SHAPE\.test\(id\)/g, 1, 'the send route still checks (only the redirector was mutated)');
} else if (mutator === 'f9') {
  // F9: register GET /invoices/view AFTER GET /invoices/:id — move the one
  // registration line to just before the API banner.
  const line = "  router.get('/invoices/view', redirector('screen-view', detailPath));\n";
  const b = count(invoices, /router\.get\('\/invoices\/view'/g);
  mutate(invoices, (s) => s.replace(line, '').replace('  // ─── THE API (AS-43) — unchanged', `${line}\n  // ─── THE API (AS-43) — unchanged`));
  applied('GET /invoices/view registration', b, count(invoices, /router\.get\('\/invoices\/view'/g), 1, 1);
  const src = fs.readFileSync(invoices, 'utf8');
  if (src.indexOf("router.get('/invoices/view'") < src.indexOf("router.get('/invoices/:id'")) throw new Error('view still registered before :id');
  console.log('assert-applied order: /invoices/view now registered AFTER /invoices/:id');
} else if (mutator === 'f10') {
  // F10 (first half): group with toLocaleString.
  const site = "return `${CURRENCY_SYMBOLS[currency]}${whole.replace(THOUSANDS, ',')}.${cents}`;";
  const b = count(money, /whole\.replace\(THOUSANDS, ','\)/g);
  mutate(money, (s) => s.replace(site, "return `${CURRENCY_SYMBOLS[currency]}${Number(whole).toLocaleString('de-DE')}.${cents}`;"));
  applied('thousands grouping', b, count(money, /whole\.replace\(THOUSANDS, ','\)/g), 1, 0);
  marker(money, /toLocaleString\('de-DE'\)/g, 1, 'the locale call');
} else if (mutator === 'f10b') {
  // F10 (second half): MINOR_DIGITS 2 -> 3.
  const b = count(money, /export const MINOR_DIGITS = 2;/g);
  mutate(money, (s) => s.replace('export const MINOR_DIGITS = 2;', 'export const MINOR_DIGITS = 3;'));
  applied('MINOR_DIGITS', b, count(money, /export const MINOR_DIGITS = 2;/g), 1, 0);
} else if (mutator === 'f11a') {
  const b = count(dashVm, /id: 'S3-ABANDON'/g);
  mutate(dashVm, (s) => s.replace("  Object.freeze({ id: 'S3-ABANDON', disposition: 'n/a' }),\n", ''));
  applied('S3-ABANDON row', b, count(dashVm, /id: 'S3-ABANDON'/g), 1, 0);
} else if (mutator === 'f11b') {
  const b = count(detailVm, /id: 'S5-ABANDON'/g);
  mutate(detailVm, (s) => s.replace("  Object.freeze({ id: 'S5-ABANDON', disposition: 'n/a' }),\n", ''));
  applied('S5-ABANDON row', b, count(detailVm, /id: 'S5-ABANDON'/g), 1, 0);
} else if (mutator === 'f12') {
  // F12: NOTOWNER renders differently from NOTFOUND. No repository call can
  // see another owner's row (that is the design), so the mutant does the one
  // thing a route COULD do to make the two renders differ: echo the requested
  // id in the title — the leak the byte-equality case exists to forbid.
  const site = "      if (err instanceof NotFoundError) return renderDetail(res, invoiceDetailLocals({ failure: 'not-found' }));";
  const b = count(invoices, /failure: 'not-found' \}\)\);/g);
  mutate(invoices, (s) => s.replace(site, "      if (err instanceof NotFoundError) return renderDetail(res, { ...invoiceDetailLocals({ failure: 'not-found' }), title: `Invoice not found: ${req.params.id}` });"));
  applied('the NotFound branch of the detail route', b, count(invoices, /failure: 'not-found' \}\)\);/g), 1, 0);
  marker(invoices, /Invoice not found: \$\{req\.params\.id\}/g, 1, 'the echoed id');
} else if (mutator === 'f13') {
  // F13: paid checked before failure in selectState.
  const site = "  if (failure === 'not-found') return 'S5-ERROR-NOTFOUND';\n  if (failure === 'system') return 'S5-ERROR-SYSTEM';\n  if (invoice === null) return 'S5-ERROR-NOTFOUND';\n  if (invoice.status === 'paid') return 'S5-DEFAULT-PAID';";
  const b = count(detailVm, /if \(failure === 'not-found'\) return 'S5-ERROR-NOTFOUND';\n  if \(failure === 'system'\)/g);
  mutate(detailVm, (s) => s.replace(site, "  if (invoice !== null && invoice.status === 'paid') return 'S5-DEFAULT-PAID';\n  if (failure === 'not-found') return 'S5-ERROR-NOTFOUND';\n  if (failure === 'system') return 'S5-ERROR-SYSTEM';\n  if (invoice === null) return 'S5-ERROR-NOTFOUND';"));
  applied('selectState precedence', b, count(detailVm, /if \(failure === 'not-found'\) return 'S5-ERROR-NOTFOUND';\n  if \(failure === 'system'\)/g), 1, 1);
  const src = fs.readFileSync(detailVm, 'utf8');
  if (src.indexOf("invoice.status === 'paid') return 'S5-DEFAULT-PAID'") > src.indexOf("if (failure === 'not-found')")) throw new Error('paid not moved ahead of failure');
  console.log('assert-applied order: paid now checked before failure');
} else {
  throw new Error(`unknown mutator ${mutator}`);
}

const log = `${ROOT}/scratchpad/agent-developer-marcus/AS-48/recipe-${name}.log`;
const project = `asc-impl-as48-${name}`;
const env = { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' };
const runArgs = ['compose', '-p', project, 'run', '--rm', '--build'];
for (const [k, v] of Object.entries(opt.env)) runArgs.push('-e', `${k}=${v}`);
runArgs.push(opt.service);
console.log(`docker ${runArgs.join(' ')}`);
const r = spawnSync(DOCKER, runArgs, { encoding: 'utf8', cwd: app, env, maxBuffer: 64 * 1024 * 1024 });
const out = (r.stdout || '') + (r.stderr || '');
const d = spawnSync(DOCKER, ['compose', '-p', project, 'down', '-v', '--rmi', 'local', '--remove-orphans'], { encoding: 'utf8', cwd: app, env });
const nets = spawnSync(DOCKER, ['network', 'ls', '--format', '{{.Name}}'], { encoding: 'utf8' }).stdout.split('\n').filter((n) => n.startsWith(`${project}_`));
const imgs = spawnSync(DOCKER, ['images', '--format', '{{.Repository}}:{{.Tag}}'], { encoding: 'utf8' }).stdout.split('\n').filter((n) => n.startsWith(`${project}-`));
const ctrs = spawnSync(DOCKER, ['ps', '-a', '--format', '{{.Names}}'], { encoding: 'utf8' }).stdout.split('\n').filter((n) => n.startsWith(`${project}-`));
fs.writeFileSync(log, out);
const built = out.split('\n').filter((l) => /Image .* Built/.test(l)).map((l) => l.trim());
const sum = (k) => (out.match(new RegExp(`^ℹ ${k} (\\d+)`, 'm')) || [])[1];
console.log(`RECEIPT project=${project}\n  built: ${built.join(' | ') || 'missing'}\n  tests=${sum('tests')} pass=${sum('pass')} fail=${sum('fail')} skipped=${sum('skipped')}\n  run exit=${r.status}\n  down exit=${d.status}\n  leak check: ${nets.length + imgs.length + ctrs.length ? 'LEAK ' + [...nets, ...imgs, ...ctrs].join(',') : 'clean'}`);
const failed = out.split('\n').filter((l) => /^✖/.test(l) && !/^✖ (failing tests:|test\/)/.test(l));
const seen = new Set();
for (const l of failed) seen.add(l.replace(/ \([0-9.]+ms\)$/, ''));
console.log(`RED SET (${seen.size}):`);
for (const l of seen) console.log('  ' + l);
