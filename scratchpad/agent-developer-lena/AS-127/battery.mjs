#!/usr/bin/env node
// battery.mjs — AS-127 plan §8 mutant battery, developer-lena, stage 2.
//   node battery.mjs <worktree> <extractRoot> <resultsFile> [recipeId ...]
// Each recipe: re-extract `git archive HEAD` (apps/invoicing, docs/design/tokens,
// .dockerignore) into <extractRoot>, mutate with an ANCHORED pattern, assert the
// mutation applied on disk with an occurrence-accurate count, run the offline
// `test` service with --build in an isolated project (asc-mut-as127-<id>), assert
// the mutation is present IN THE BUILT IMAGE (a second `run` without --build reuses
// the image just built), record the failing set, tear down (down -v --rmi local +
// image rm by name), and append a JSON line to <resultsFile>. Predictions are
// written into the recipe table BEFORE any run and never widened after.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DOCKER = process.env.ADVANCE_DOCKER_BIN || '/usr/local/bin/docker';
const [worktree, extractRoot, resultsFile, ...only] = process.argv.slice(2);
if (!worktree || !extractRoot || !resultsFile) { console.error('usage'); process.exit(2); }
const APP = join(extractRoot, 'apps', 'invoicing');
const count = (file, needle) => readFileSync(join(APP, file), 'utf8').split(needle).length - 1;
const edit = (file, fn) => { const p = join(APP, file); const before = readFileSync(p, 'utf8'); const after = fn(before); if (after === before) throw new Error(`${file}: mutation produced no change`); writeFileSync(p, after); };
const replaceOnce = (file, from, to) => edit(file, (s) => { const n = s.split(from).length - 1; if (n !== 1) throw new Error(`${file}: anchor "${String(from).slice(0, 60)}" matched ${n} times, expected 1`); return s.replace(from, to); });

// ---- the recipes ------------------------------------------------------------
// predicted: executable case titles (substrings), fixed before the first run.
const RECIPES = [
  { id: 'f1', name: 'F1 date value= removed (both date branches)',
    predicted: ['S6-ERROR-VALIDATION marks every failing field', 'S6-CLIENT-ERROR-VALIDATION: blank client fields', 'add-client creates exactly one client', 'S6-ERROR-SYSTEM: a generation that fails after validation'],
    mutate() {
      const f = 'views/contract-form.ejs';
      const before = count(f, 'type="date"');
      if (before !== 2) throw new Error(`expected 2 type="date" inputs, found ${before}`);
      edit(f, (s) => s.replace(/(<input type="date" id="<%= field\.name %>" name="<%= field\.name %>") value="<%= field\.value %>"/g, '$1'));
      return { 'type="date" lines carrying value=': `2 -> ${count(f, 'type="date" id="<%= field.name %>" name="<%= field.name %>" value=')}` };
    },
    inImage: ['views/contract-form.ejs', 'type="date" id="<%= field.name %>" name="<%= field.name %>" value=', 0] },
  { id: 'f2', name: 'F2 textarea <%= -> <%- (both textarea branches)',
    predicted: ['a value containing markup in the description is rendered as text', 'the concepts live exactly where'],
    mutate() {
      const f = 'views/contract-form.ejs';
      if (count(f, '<%-') !== 0) throw new Error('pre: <%- already present');
      edit(f, (s) => s.replace(/(rows="3"(?: aria-invalid="true" aria-describedby="<%= field\.name %>-error")?>\n)<%= field\.value %><\/textarea>/g, '$1<%- field.value %></textarea>'));
      return { '<%- in contract-form.ejs': `0 -> ${count(f, '<%-')}` };
    },
    inImage: ['views/contract-form.ejs', '<%-', 2] },
  { id: 'f4', name: 'F4 every generate error -> clientRefused',
    predicted: ['S6-ERROR-SYSTEM: a generation that fails after validation'],
    mutate() {
      replaceOnce('routes/contracts.js', "if (err instanceof NotFoundError && err.entity === 'client') {", "if (true || (err instanceof NotFoundError && err.entity === 'client')) {");
      return { "route catch 'if (true ||'": count('routes/contracts.js', 'if (true ||') };
    },
    inImage: ['routes/contracts.js', 'if (true ||', 1] },
  { id: 'f6', name: 'F6 parser validates date with a regex instead of validateFormValue',
    predicted: ['the screen and the API validate with the same function'],
    mutate() {
      replaceOnce('lib/screens/contract-form-view.js', '      stored = validateFormValue(variable, raw);', "      if (variable.type === 'date') { if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(String(raw ?? ''))) throw new Error('shape'); stored = String(raw); } else stored = validateFormValue(variable, raw);");
      return { 'regex in lib/screens/': count('lib/screens/contract-form-view.js', '/^\\d{4}-\\d{2}-\\d{2}$/') };
    },
    inImage: ['lib/screens/contract-form-view.js', '\\d{4}-\\d{2}-\\d{2}', 1] },
  { id: 'f9', name: 'F9 both /contracts/new registrations moved below GET /contracts/:id',
    // Run 1 (tip 3166ba5) predicted ~18 (every case that GETs OR POSTs) and observed 7:
    // {3, 4, 11, 15, 18, 28, Y2}. Narrower because no POST /contracts/:id exists to
    // capture the POST literal — only GET-driven cases can go red. Case 14 stayed green
    // on two byte-identical 404s (a hole; fixed at fe95641). Run 2 prediction, fixed
    // BEFORE the re-run: the 7 plus case 14 = 8.
    predicted: ['S6-DEFAULT renders the picker', 'S6-CLIENT-EMPTY: with zero clients', 'S6-ERROR-SYSTEM: a generation that fails after validation',
      'S6-ABANDON: two GETs are byte-identical', 'S6-CLIENT-ABANDON: a new-client re-render', 'GET and POST /contracts/new are served by the screen',
      'every href and form action in the two contract templates', 'Y2: contractRoutes is constructed from repos alone'],
    mutate() {
      const f = 'routes/contracts.js';
      edit(f, (s) => {
        const start = s.indexOf('  // SCREEN 6 (AS-127;');
        const end = s.indexOf("  // THE DASHBOARD'S REDIRECTOR");
        if (start < 0 || end < 0 || end < start) throw new Error('screen-6 block not found');
        const block = s.slice(start, end);
        const rest = s.slice(0, start) + s.slice(end);
        const ret = rest.lastIndexOf('  return router;');
        if (ret < 0) throw new Error('return router not found');
        return rest.slice(0, ret) + block + rest.slice(ret);
      });
      const src = readFileSync(join(APP, f), 'utf8');
      const line = (needle) => src.slice(0, src.indexOf(needle)).split('\n').length;
      return { 'line GET /contracts/new': line("router.get('/contracts/new'"), 'line POST /contracts/new': line("router.post('/contracts/new'"), 'line GET /contracts/:id': line("router.get('/contracts/:id'") };
    },
    inImage: null,
    inImageCheck: "awk '/router.get\\(.\\/contracts\\/:id./{a=NR} /router.get\\(.\\/contracts\\/new./{b=NR} END{print (a<b)?1:0}' routes/contracts.js", inImageExpect: '1' },
  { id: 'f10', name: 'F10 unknown/absent intent dispatched as generate',
    predicted: ['the intent dispatch is closed'],
    mutate() {
      replaceOnce('routes/contracts.js', '    switch (submission.intent) {', "    switch (submission.intent ?? 'generate') {");
      return { "switch (submission.intent ?? 'generate')": count('routes/contracts.js', "switch (submission.intent ?? 'generate')") };
    },
    inImage: ['routes/contracts.js', "submission.intent ?? 'generate'", 1] },
  { id: 'f11a', name: 'F11a duplicateId hidden input deleted from contract-form.ejs',
    predicted: ['screen 6 accounts for all eleven of its ledger rows', 'S6-CLIENT-ERROR-DUPLICATE: an email matching', 'the concepts live exactly where'],
    mutate() {
      const f = 'views/contract-form.ejs';
      const before = count(f, 'duplicateId');
      replaceOnce(f, '              <input type="hidden" name="duplicateId" value="<%= duplicateId %>" />\n', '');
      return { 'duplicateId in contract-form.ejs': `${before} -> ${count(f, 'duplicateId')}` };
    },
    inImage: ['views/contract-form.ejs', 'duplicateId', 0] },
  { id: 'f19', name: 'F19 formValues built from every non-picker body key',
    predicted: ['the contract form view model reaches every rendered state with no HTTP', 'a record-sourced name posted to the screen is not read'],
    mutate() {
      replaceOnce('lib/screens/contract-form-view.js', '\n  return { intent, values, fields, errors, fieldErrorCount, formValues: fieldErrorCount === 0 ? formValues : null };',
        "\n  for (const [k, v] of Object.entries(form)) if (!['intent', 'clientId', 'clientName', 'clientEmail', 'duplicateId', 'clientConfirm', 'pickerMode'].includes(k) && !(k in formValues)) formValues[k] = v; // F19 MUTANT\n  return { intent, values, fields, errors, fieldErrorCount, formValues: fieldErrorCount === 0 ? formValues : null };");
      return { 'F19 MUTANT lines': count('lib/screens/contract-form-view.js', 'F19 MUTANT') };
    },
    inImage: ['lib/screens/contract-form-view.js', 'F19 MUTANT', 1] },
  { id: 'fta', name: 'F-ta the literal newline after <textarea ...> removed (both branches)',
    predicted: ['S6-ERROR-VALIDATION marks every failing field'],
    mutate() {
      const f = 'views/contract-form.ejs';
      const ta = count(f, '<textarea');
      edit(f, (s) => s.replace(/(<textarea [^\n]*>)\n<%= field\.value %><\/textarea>/g, '$1<%= field.value %></textarea>'));
      return { '<textarea count (unchanged)': `${ta} -> ${count(f, '<textarea')}`, 'joined lines': count(f, '><%= field.value %></textarea>') };
    },
    inImage: ['views/contract-form.ejs', '><%= field.value %></textarea>', 2] },
  { id: 'f15', name: 'F15 intent=new-client creates a client',
    predicted: ['S6-CLIENT-ABANDON: a new-client re-render'],
    mutate() {
      replaceOnce('routes/contracts.js', '      default:\n        return renderForm(res, contractFormLocals(base));',
        "      case 'new-client': // F15 MUTANT\n        repos.clients.create(freelancerId, { name: submission.values.clientName, email: submission.values.clientEmail });\n        return renderForm(res, contractFormLocals(base));\n      default:\n        return renderForm(res, contractFormLocals(base));");
      return { 'F15 MUTANT': count('routes/contracts.js', 'F15 MUTANT') };
    },
    inImage: ['routes/contracts.js', 'F15 MUTANT', 1] },
  { id: 'f8dup', name: 'F8-dup findByEmail never consulted (-> [])',
    predicted: ['S6-CLIENT-ERROR-DUPLICATE: an email matching'],
    mutate() {
      replaceOnce('routes/contracts.js', '          const matches = repos.clients.findByEmail(freelancerId, clientEmail);', '          const matches = []; // F8-dup MUTANT');
      return { 'findByEmail in routes/contracts.js': count('routes/contracts.js', 'findByEmail(') };
    },
    inImage: ['routes/contracts.js', 'F8-dup MUTANT', 1] },
  { id: 'fcount', name: 'F-count banner does not count (attentionTitle(1) at the S6-ERROR-VALIDATION site)',
    predicted: ['S6-ERROR-VALIDATION marks every failing field'],
    mutate() {
      replaceOnce('lib/screens/contract-form-view.js', "      : { tone: 'error', title: attentionTitle(errorCount), message: VALIDATION_MESSAGE };", "      : { tone: 'error', title: attentionTitle(1), message: VALIDATION_MESSAGE };");
      return { 'attentionTitle(errorCount)': count('lib/screens/contract-form-view.js', 'attentionTitle(errorCount)'), 'attentionTitle(1)': count('lib/screens/contract-form-view.js', 'attentionTitle(1)') };
    },
    inImage: ['lib/screens/contract-form-view.js', 'attentionTitle(1)', 1] },
  { id: 'fnav-a', name: 'F-nav (a) contract-form.ejs nav href -> /contracts/nwe',
    // Run 1 (tip 3166ba5): predicted {3, 28, invoice-screen walker}, observed {3, walker}
    // — case 28 SURVIVED. Re-read: the drive loop posts /signout mid-way, so the second
    // file's links were driven cookieless and the guard's 303 read as served. Instrument
    // fixed at 4563f42 (sign-out last + lost-session tripwire). Run 2 prediction unchanged.
    predicted: ['every href and form action in the two contract templates', 'S6-DEFAULT renders the picker', 'every href and form action in every template names a route'],
    mutate() {
      replaceOnce('views/contract-form.ejs', 'href="/contracts/new"', 'href="/contracts/nwe"');
      return { 'href="/contracts/new" in contract-form.ejs': count('views/contract-form.ejs', 'href="/contracts/new"'), 'in contract-detail.ejs (untouched)': count('views/contract-detail.ejs', 'href="/contracts/new"') };
    },
    inImage: ['views/contract-form.ejs', '/contracts/nwe', 1] },
  { id: 'fnav-b', name: 'F-nav (b) contract-detail.ejs nav href -> /contracts/nwe',
    predicted: ['every href and form action in the two contract templates', 'S7-DEFAULT renders the document', 'every href and form action in every template names a route'],
    mutate() {
      replaceOnce('views/contract-detail.ejs', 'href="/contracts/new"', 'href="/contracts/nwe"');
      return { 'href="/contracts/new" in contract-detail.ejs': count('views/contract-detail.ejs', 'href="/contracts/new"'), 'in contract-form.ejs (untouched)': count('views/contract-form.ejs', 'href="/contracts/new"') };
    },
    inImage: ['views/contract-detail.ejs', '/contracts/nwe', 1] },
  { id: 'fnav48', name: 'F-nav-48 dashboard.ejs nav href -> /contracts/nwe (CTA untouched)',
    predicted: ['every href and form action in every template names a route the app registers or a file public/ serves', 'every href and form action in every template names a route'],
    mutate() {
      replaceOnce('views/dashboard.ejs', '<a class="site-nav__link" href="/contracts/new">New contract</a>', '<a class="site-nav__link" href="/contracts/nwe">New contract</a>');
      return { 'href="/contracts/new" in dashboard.ejs (the CTA remains)': count('views/dashboard.ejs', 'href="/contracts/new"'), '/contracts/nwe': count('views/dashboard.ejs', '/contracts/nwe') };
    },
    inImage: ['views/dashboard.ejs', '/contracts/nwe', 1] },
  { id: 'f12', name: 'F12 ASC_SELFTEST_MUTATE=1 (the runner can fail)', predicted: ['V1: the runner can fail'], env: { ASC_SELFTEST_MUTATE: '1' }, mutate() { return { 'source mutation': 'none — env switch' }; }, inImage: null },
];

// ---- the runner ---------------------------------------------------------------
const sh = (args, opts = {}) => spawnSync(args[0], args.slice(1), { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
function extract() {
  rmSync(extractRoot, { recursive: true, force: true });
  mkdirSync(extractRoot, { recursive: true });
  const ar = sh(['git', '-C', worktree, 'archive', '--format=tar', '-o', join(extractRoot, 'src.tar'), 'HEAD', 'apps/invoicing', 'docs/design/tokens', '.dockerignore']);
  if (ar.status !== 0) throw new Error('git archive failed: ' + ar.stderr);
  const tx = sh(['tar', '-xf', join(extractRoot, 'src.tar'), '-C', extractRoot]);
  if (tx.status !== 0) throw new Error('tar failed: ' + tx.stderr);
  rmSync(join(extractRoot, 'src.tar'));
}
function compose(project, args, extra = {}) {
  return spawnSync(DOCKER, ['compose', '-p', project, ...args], { cwd: APP, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...extra });
}
const wanted = only.length ? RECIPES.filter((r) => only.includes(r.id)) : RECIPES;
for (const r of wanted) {
  const t0 = Date.now();
  const project = `asc-mut-as127-${r.id}`;
  const rec = { id: r.id, name: r.name, predicted: r.predicted, project };
  try {
    extract();
    rec.applied = r.mutate();
    const envArgs = r.env ? Object.entries(r.env).flatMap(([k, v]) => ['-e', `${k}=${v}`]) : [];
    const run = compose(project, ['run', '--rm', '--build', '-T', ...envArgs, 'test']);
    const out = (run.stdout || '') + (run.stderr || '');
    writeFileSync(join(extractRoot, '..', `mut-${r.id}.log`), out);
    rec.built = (out.match(/Image \S+ Built/g) || []).join(' | ');
    const num = (k) => { const m = out.match(new RegExp(`^ℹ ${k} (\\d+)`, 'm')); return m ? Number(m[1]) : null; };
    rec.summary = { tests: num('tests'), pass: num('pass'), fail: num('fail'), skipped: num('skipped') };
    rec.exit = run.status;
    // Only the top-level report (before the `ℹ tests` summary): the trailing
    // "failing tests" block repeats every title. NOT deduped — two files carry
    // the same link-walker title (invoice-screen, read-screens) and both count.
    const head = out.slice(0, out.search(/^ℹ tests /m) === -1 ? out.length : out.search(/^ℹ tests /m));
    rec.failing = [...head.matchAll(/^✖ (.*?) \(\d+(?:\.\d+)?ms\)$/mg)].map((m) => m[1]);
    // In-image assertion: reuse the image just built (no --build).
    if (r.inImage) {
      const [file, needle, expect] = r.inImage;
      const g = compose(project, ['run', '--rm', '-T', '--no-deps', '--entrypoint', 'node', 'test', '-e', `const s=require('fs').readFileSync(${JSON.stringify(file)},'utf8');console.log(s.split(${JSON.stringify(needle)}).length-1)`]);
      rec.inImage = { file, needle, expect, observed: (g.stdout || '').trim(), ok: (g.stdout || '').trim() === String(expect) };
    } else if (r.inImageCheck) {
      const g = compose(project, ['run', '--rm', '-T', '--no-deps', '--entrypoint', 'sh', 'test', '-c', r.inImageCheck]);
      rec.inImage = { check: r.inImageCheck, expect: r.inImageExpect, observed: (g.stdout || '').trim(), ok: (g.stdout || '').trim() === r.inImageExpect };
    }
  } catch (e) {
    rec.error = String(e && e.stack || e);
  } finally {
    const down = compose(project, ['down', '-v', '--rmi', 'local', '--remove-orphans']);
    const rmi = sh([DOCKER, 'image', 'rm', '-f', `${project}-test`]);
    const left = sh([DOCKER, 'image', 'ls', '--format', '{{.Repository}}', '--filter', `reference=${project}*`]);
    rec.teardown = { down: down.status, rmi: rmi.status, imagesLeft: (left.stdout || '').trim().split('\n').filter(Boolean).length };
  }
  rec.seconds = Math.round((Date.now() - t0) / 1000);
  appendFileSync(resultsFile, JSON.stringify(rec) + '\n');
  console.log(`[${r.id}] ${rec.built || 'NO BUILD LINE'} tests=${rec.summary?.tests} fail=${rec.summary?.fail} exit=${rec.exit} red=${JSON.stringify(rec.failing)} inImage=${rec.inImage ? (rec.inImage.ok ? 'ok' : 'MISMATCH ' + rec.inImage.observed) : 'n/a'} teardown=${JSON.stringify(rec.teardown)} ${rec.error ? 'ERROR ' + rec.error.split('\n')[0] : ''} (${rec.seconds}s)`);
}
rmSync(extractRoot, { recursive: true, force: true });
console.log('battery done; extract removed');
