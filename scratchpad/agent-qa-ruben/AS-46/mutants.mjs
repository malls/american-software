// AS-46 mutant battery (Ruben). Runs against the scratch copy only.
import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';

const ROOT = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-46';
const SRC = `${ROOT}/src`;
const APP = `${SRC}/apps/invoicing`;
const W = '/Users/forrest/Code/american-software-company/.worktrees/AS-46';
const TIP = '3eb718f';
const DOCKER = '/usr/local/bin/docker';
const PROJECT = 'asc-review-as46-mut';

function restore() {
  rmSync(SRC, { recursive: true, force: true });
  mkdirSync(SRC, { recursive: true });
  execFileSync('sh', ['-c', `git -C ${W} archive ${TIP} | tar -x -C ${SRC}`]);
}
const count = (file, needle) => readFileSync(`${APP}/${file}`, 'utf8').split(needle).length - 1;

function runSuite(label) {
  const r = spawnSync(DOCKER, ['compose', '-p', PROJECT, '-f', `${APP}/compose.yaml`, 'run', '--build', '--rm', 'test'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout || '') + (r.stderr || '');
  writeFileSync(`${ROOT}/mut-${label}.log`, out + `\nEXIT=${r.status}\n`);
  const built = /Image \S+ Built/.test(out);
  const failing = [];
  const lines = out.split('\n');
  for (const line of lines) {
    const m = line.match(/^not ok \d+ - (.*)$/);
    if (m) failing.push(m[1]);
  }
  const sum = {};
  for (const k of ['tests', 'pass', 'fail', 'skipped']) { const m = out.match(new RegExp(`^ℹ ${k} (\\d+)`, 'm')); sum[k] = m ? Number(m[1]) : null; }
  return { built, failing, sum, exit: r.status };
}

const MUTANTS = [
  {
    id: 'F1', file: 'views/invoice-form.ejs',
    apply: (s) => s.replace(/name="lineItems\[<%= row\.index %>\]\[unitPrice\]" value="<%= row\.unitPrice %>"/g, 'name="lineItems[<%= row.index %>][unitPrice]"'),
    assert: () => count('views/invoice-form.ejs', 'name="lineItems[<%= row.index %>][unitPrice]" value="<%= row.unitPrice %>"') === 0 && count('views/invoice-form.ejs', 'value="<%= row.unitPrice %>"') === 0,
    predicted: ['S4-ERROR-VALIDATION re-renders every submitted value as typed and marks each failing field', 'S4-DEFAULT-EDIT: the stored draft is pre-populated, prices formatted from minor units, one blank row appended'],
  },
  {
    id: 'F2', file: 'views/invoice-form.ejs',
    apply: (s) => s.replace(/value="<%= row\.description %>"/g, 'value="<%- row.description %>"'),
    assert: () => count('views/invoice-form.ejs', 'value="<%- row.description %>"') === 2 && count('views/invoice-form.ejs', 'value="<%= row.description %>"') === 0,
    predicted: ['a value containing markup in a line-item description is rendered as text, not as markup', '(dependency-policy concept-row case)'],
  },
  {
    id: 'F3a', file: 'views/invoice-form.ejs',
    apply: (s) => s.replace('<meta charset="utf-8" />', '<meta charset="utf-8" />\n    <%# amount %>'),
    assert: () => count('views/invoice-form.ejs', '<%# amount %>') === 1,
    predicted: ['(dependency-policy money row: views/invoice-form.ejs unexpected)'],
  },
  {
    id: 'F3a-neg', file: 'lib/screens/invoice-form-view.js',
    apply: (s) => s.replace("import { DEFAULT_CURRENCY", "// amount\nimport { DEFAULT_CURRENCY"),
    assert: () => count('lib/screens/invoice-form-view.js', '// amount\nimport') === 1,
    predicted: [],
  },
  {
    id: 'F5-null', file: 'lib/screens/invoice-form-view.js',
    apply: (s) => s.replace("if (account === null || account.ready === false) state = 'S4-GATED-STRIPENOTREADY';", "if (account !== null && account.ready === false) state = 'S4-GATED-STRIPENOTREADY'; /* RUBEN-F5-NULL */"),
    assert: () => count('lib/screens/invoice-form-view.js', 'RUBEN-F5-NULL') === 1,
    predicted: ['S4-GATED-STRIPENOTREADY refuses to render the form for no account and for each half of not-ready, and links to /connect-stripe', '(view model exhaustive case?)', '(health /healthz sampleLocals? VIEWS default renders gated)'],
  },
  {
    id: 'F5-ready', file: 'lib/screens/invoice-form-view.js',
    apply: (s) => s.replace("if (account === null || account.ready === false) state = 'S4-GATED-STRIPENOTREADY';", "if (account === null) state = 'S4-GATED-STRIPENOTREADY'; /* RUBEN-F5-READY */"),
    assert: () => count('lib/screens/invoice-form-view.js', 'RUBEN-F5-READY') === 1,
    predicted: ['S4-GATED-STRIPENOTREADY ... (the two ready===false GETs)', 'the gate binds POST: a save from an unready account writes nothing', '(view model exhaustive case?)'],
  },
  {
    id: 'F9', file: 'routes/invoices.js',
    apply: (s) => {
      // move the two screen POST registrations below the API's POST /invoices/:id
      const start = s.indexOf("  router.post('/invoices/new', form, screen('screen-create'");
      const end = s.indexOf("  // ─── THE API (AS-43) — unchanged");
      const block = s.slice(start, end);
      let t = s.slice(0, start) + s.slice(end);
      const anchor = "  router.post('/invoices/:id/send', form, handle('send'";
      const i = t.indexOf(anchor);
      return t.slice(0, i) + '  /* RUBEN-F9 moved */\n' + block + t.slice(i);
    },
    assert: () => { const s = readFileSync(`${APP}/routes/invoices.js`, 'utf8'); return s.indexOf('RUBEN-F9') > s.indexOf("router.post('/invoices/:id', form") && s.indexOf("router.post('/invoices/new'") > s.indexOf("router.post('/invoices/:id', form"); },
    predicted: ['POST /invoices/new is served by the screen, never by the API\'s :id route', '(every case that POSTs /invoices/new)'],
  },
  {
    id: 'F10', file: 'lib/screens/invoice-form-view.js',
    apply: (s) => s.replace("const intent = typeof form.intent === 'string' && INTENTS.includes(form.intent) ? form.intent : null;", "const intent = typeof form.intent === 'string' && INTENTS.includes(form.intent) ? form.intent : 'save'; /* RUBEN-F10 */"),
    assert: () => count('lib/screens/invoice-form-view.js', 'RUBEN-F10') === 1,
    predicted: ['the intent dispatch is closed: an unknown, absent or repeated intent is refused and persists nothing', '(view model exhaustive case: unknown intent -> S4-ERROR-VALIDATION)'],
  },
  {
    id: 'R5', file: 'views/invoice-form.ejs',
    apply: (s) => s.replace('<% if (gated) { %>', "<% if (state === 'S4-GATED-STRIPENOTREADY') { %>"),
    assert: () => count('views/invoice-form.ejs', "if (state === 'S4-GATED-STRIPENOTREADY')") === 1 && count('views/invoice-form.ejs', 'if (gated)') === 0,
    predicted: ['no template branches on a state id: `state` reaches EJS code exactly once per template, as the data-state attribute'],
  },
  {
    id: 'F8', file: 'views/invoice-form.ejs',
    apply: (s) => s.replace('href="/connect-stripe"', 'href="/connect-strip"'),
    assert: () => count('views/invoice-form.ejs', 'href="/connect-strip"') === 1 && count('views/invoice-form.ejs', 'href="/connect-stripe"') === 0,
    predicted: ['every href and form action in every template names a route the app registers or a file public/ serves', 'S4-GATED-STRIPENOTREADY refuses to render the form for no account and for each half of not-ready, and links to /connect-stripe'],
  },
  {
    id: 'F4', file: 'routes/invoices.js',
    apply: (s) => s.replace("return res.redirect(303, `${editPath(invoice.id)}?error=send`);", "return res.redirect(303, editPath(invoice.id)); /* RUBEN-F4 */"),
    assert: () => count('routes/invoices.js', 'RUBEN-F4') === 1 && count('routes/invoices.js', '?error=send') === 0,
    predicted: ['S4-ERROR-SYSTEM: a send that fails at Stripe lands on the edit page with the system banner, the draft still a draft'],
  },
  {
    id: 'F6', file: 'lib/db/money.js',
    apply: (s) => s.replace("const minor = whole * MINOR_PER_MAJOR + cents;", "const minor = Math.round(Number(text.trim()) * MINOR_PER_MAJOR); /* RUBEN-F6 */"),
    assert: () => count('lib/db/money.js', 'Math.round') === 1 && count('lib/db/money.js', 'RUBEN-F6') === 1,
    predicted: ['formatMinorUnits and parseMajorUnits round-trip, reject every malformed spelling, and never touch a float', '(case 19 must stay green)'],
  },
  {
    id: 'F11', file: 'views/invoice-form.ejs',
    apply: (s) => s.replace(/<% if \(duplicate !== null\) \{ %>[\s\S]*?<% \} else \{ %>\n(\s*<div class="form-actions">\n\s*<button type="submit" name="intent" value="add-client" class="btn btn-secondary">Add client<\/button>\n\s*<\/div>\n)\s*<% \} %>/, '$1'),
    assert: () => count('views/invoice-form.ejs', 'duplicate !== null') === 0 && count('views/invoice-form.ejs', 'name="duplicateId"') === 0 && count('views/invoice-form.ejs', 'value="add-client"') === 1,
    predicted: ['S4-CLIENT-ERROR-DUPLICATE: ... warns, names the match, creates nothing, and offers both ways forward', 'the two duplicate offers work: ...', '(partition case? only if it renders)'],
  },
];

MUTANTS.push({ id: 'F3b', file: 'test/dependency-policy.test.js', apply: (t) => t.replace("      'lib/screens/invoice-form-view.js',\n", ''), assert: () => count('test/dependency-policy.test.js', "'lib/screens/invoice-form-view.js'") === 1, predicted: ['(concept-row case: view model unexpected member)'] });
const only = process.argv.slice(2);
const results = [];
for (const m of MUTANTS) {
  if (only.length > 0 && !only.includes(m.id)) continue;
  restore();
  const path = `${APP}/${m.file}`;
  const before = readFileSync(path, 'utf8');
  const after = m.apply(before);
  writeFileSync(path, after);
  const applied = after !== before && m.assert();
  console.log(`\n=== ${m.id} (${m.file}) applied=${applied}`);
  if (!applied) { results.push({ id: m.id, applied: false }); continue; }
  const r = runSuite(m.id);
  console.log(`built=${r.built} exit=${r.exit} tests=${r.sum.tests} pass=${r.sum.pass} fail=${r.sum.fail} skipped=${r.sum.skipped}`);
  console.log('RED SET:'); for (const f of r.failing) console.log('  -', f);
  console.log('predicted:', JSON.stringify(m.predicted));
  results.push({ id: m.id, applied, ...r, predicted: m.predicted });
}
restore();
writeFileSync(`${ROOT}/mutants-results.json`, JSON.stringify(results, null, 2));
console.log('\nrestored scratch to', TIP);
