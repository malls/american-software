// Ruben's AS-127 mutation battery. Each mutant: fresh copy of /tmp/rq-as127/base,
// one targeted edit anchored to its intended site, an assert-applied count on disk,
// then a counted --build run of the FULL suite from an isolated project. The worktree
// is never touched.
//   node mutate.mjs <name>      (F6 | F9 | F19 | Fta | F11a | Fnav-a | Fnav-b | F4 | F15 | F8dup | Fcount | F10 | Fnav48)
import { cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const BASE = '/tmp/rq-as127/base';
const name = process.argv[2];
const root = `/tmp/rq-as127/${name}`;
const APP = `${root}/apps/invoicing`;
const count = (s, needle) => s.split(needle).length - 1;
const file = (p) => `${APP}/${p}`;
const rd = (p) => readFileSync(file(p), 'utf8');
const wr = (p, s) => writeFileSync(file(p), s);
function assertEq(a, b, what) { if (a !== b) { console.error(`ASSERT-APPLIED FAILED: ${what}: got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`); process.exit(3); } console.log(`assert-applied ok: ${what} = ${JSON.stringify(a)}`); }

const MUTANTS = {
  // F6 — the parser validates the date with its own regex instead of validateFormValue.
  F6() {
    const p = 'lib/screens/contract-form-view.js';
    let s = rd(p);
    const anchor = '      stored = validateFormValue(variable, raw);\n';
    assertEq(count(s, anchor), 1, 'anchor (the one validateFormValue call in parseContractForm) occurs once');
    s = s.replace(anchor, "      if (variable.type === 'date') { if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(raw ?? '')) throw new Error('bad'); stored = raw; } else stored = validateFormValue(variable, raw);\n");
    wr(p, s);
    assertEq(count(rd(p), '/^\\d{4}-\\d{2}-\\d{2}$/'), 1, 'regex literal in contract-form-view.js 0 -> 1');
  },
  // F9 — both /contracts/new registrations moved below GET /contracts/:id.
  F9() {
    const p = 'routes/contracts.js';
    let s = rd(p);
    const start = s.indexOf('  // SCREEN 6 (AS-127;');
    const end = s.indexOf("  // THE DASHBOARD'S REDIRECTOR");
    if (start < 0 || end < 0 || end < start) { console.error('F9 anchors not found'); process.exit(3); }
    const block = s.slice(start, end);
    assertEq(count(block, "router.get('/contracts/new'"), 1, 'block carries the GET');
    assertEq(count(block, "router.post('/contracts/new'"), 1, 'block carries the POST');
    s = s.slice(0, start) + s.slice(end);
    const tail = '  // A parser refusal (too large';
    assertEq(count(s, tail), 1, 'tail anchor once');
    s = s.replace(tail, block + tail);
    wr(p, s);
    const lines = rd(p).split('\n');
    const idLine = lines.findIndex((l) => l.includes("router.get('/contracts/:id'"));
    const getLine = lines.findIndex((l) => l.includes("router.get('/contracts/new'"));
    const postLine = lines.findIndex((l) => l.includes("router.post('/contracts/new'"));
    console.log(`grep -n: :id at ${idLine + 1}, GET /contracts/new at ${getLine + 1}, POST /contracts/new at ${postLine + 1}`);
    if (!(getLine > idLine && postLine > idLine)) { console.error('F9 not applied'); process.exit(3); }
  },
  // F19 — formValues built from every non-picker body key, not the declaration.
  F19() {
    const p = 'lib/screens/contract-form-view.js';
    let s = rd(p);
    const anchor = '  return { intent, values, fields, errors, fieldErrorCount, formValues: fieldErrorCount === 0 ? formValues : null };\n';
    assertEq(count(s, anchor), 1, 'the parser return line occurs once');
    s = s.replace(anchor, "  for (const [k, v] of Object.entries(form)) { if (!['intent', 'clientId', 'clientName', 'clientEmail', 'duplicateId', 'clientConfirm', 'pickerMode'].includes(k) && !(k in formValues)) formValues[k] = v; }\n" + anchor);
    wr(p, s);
    assertEq(count(rd(p), 'Object.entries(form)'), 1, 'body-walk loop 0 -> 1');
    // Prove the mutant reads freelancerName: run the parser in-process.
    const r = spawnSync('node', ['--input-type=module', '-e', `import { parseContractForm } from '${file(p)}'; const r = parseContractForm({ intent: 'generate', clientId: 'x', projectDescription: 'ok', startDate: '2026-09-08', freelancerName: 'Someone Else' }); console.log(JSON.stringify(Object.keys(r.formValues)));`], { encoding: 'utf8', cwd: APP });
    console.log(`mutant parser formValues keys: ${r.stdout.trim()} ${r.stderr.trim()}`);
    if (!r.stdout.includes('freelancerName')) { console.error('F19 did not reach freelancerName'); process.exit(3); }
  },
  // F-ta — the literal newline after <textarea ...> removed, BOTH branches.
  Fta() {
    const p = 'views/contract-form.ejs';
    let s = rd(p);
    assertEq(count(s, '<textarea'), 2, 'textarea open tags before');
    assertEq(count(s, '>\n<%= field.value %></textarea>'), 2, 'newline-then-value before (both branches)');
    s = s.replaceAll('>\n<%= field.value %></textarea>', '><%= field.value %></textarea>');
    wr(p, s);
    assertEq(count(rd(p), '<textarea'), 2, 'textarea open tags after (unchanged)');
    assertEq(count(rd(p), '>\n<%= field.value %></textarea>'), 0, 'newline-then-value after');
    assertEq(count(rd(p), '><%= field.value %></textarea>'), 2, 'joined after');
  },
  // F11a — the duplicateId hidden input deleted.
  F11a() {
    const p = 'views/contract-form.ejs';
    let s = rd(p);
    const line = '              <input type="hidden" name="duplicateId" value="<%= duplicateId %>" />\n';
    assertEq(count(s, line), 1, 'the hidden-input line occurs once');
    assertEq(count(s, 'duplicateId'), 2, 'duplicateId occurrences before');
    s = s.replace(line, '');
    wr(p, s);
    assertEq(count(rd(p), 'duplicateId'), 0, 'duplicateId occurrences after');
  },
  // F-nav (a) — contract-form.ejs's own nav link misspelled; contract-detail.ejs untouched.
  'Fnav-a'() {
    const p = 'views/contract-form.ejs';
    let s = rd(p);
    assertEq(count(s, 'href="/contracts/new"'), 1, 'contract-form.ejs link before');
    s = s.replace('href="/contracts/new"', 'href="/contracts/nwe"');
    wr(p, s);
    assertEq(count(rd(p), 'href="/contracts/new"'), 0, 'contract-form.ejs link after');
    assertEq(count(rd('views/contract-detail.ejs'), 'href="/contracts/new"'), 1, 'contract-detail.ejs untouched');
  },
  // F-nav (b) — contract-detail.ejs's nav link misspelled; contract-form.ejs untouched.
  'Fnav-b'() {
    const p = 'views/contract-detail.ejs';
    let s = rd(p);
    assertEq(count(s, 'href="/contracts/new"'), 1, 'contract-detail.ejs link before');
    s = s.replace('href="/contracts/new"', 'href="/contracts/nwe"');
    wr(p, s);
    assertEq(count(rd(p), 'href="/contracts/new"'), 0, 'contract-detail.ejs link after');
    assertEq(count(rd('views/contract-form.ejs'), 'href="/contracts/new"'), 1, 'contract-form.ejs untouched');
  },
  // F-nav-48 — the Dashboard's first-run CTA link misspelled (one of AS-48's three).
  Fnav48() {
    const p = 'views/dashboard.ejs';
    let s = rd(p);
    const line = '<a href="/contracts/new" class="btn btn-primary">Create your first contract</a>';
    assertEq(count(s, line), 1, 'the CTA line occurs once');
    s = s.replace(line, line.replace('/contracts/new', '/contracts/nwe'));
    wr(p, s);
    assertEq(count(rd(p), 'href="/contracts/new"'), 1, 'dashboard.ejs: the nav anchor remains, the CTA is misspelled');
    assertEq(count(rd(p), '/contracts/nwe'), 1, 'misspelling present once');
  },
  // F4 — every generate error routed to clientRefused.
  F4() {
    const p = 'routes/contracts.js';
    let s = rd(p);
    const anchor = "          if (err instanceof NotFoundError && err.entity === 'client') {";
    assertEq(count(s, anchor), 1, 'the entity test occurs once');
    s = s.replace(anchor, '          if (true) {');
    wr(p, s);
    assertEq(count(rd(p), "err.entity === 'client'"), 0, 'entity test gone');
    assertEq(count(rd(p), '          if (true) {'), 1, 'replacement present');
  },
  // F15 — intent=new-client persists a client.
  F15() {
    const p = 'routes/contracts.js';
    let s = rd(p);
    const anchor = '      default:\n        return renderForm(res, contractFormLocals(base));';
    assertEq(count(s, anchor), 1, 'the default arm occurs once');
    s = s.replace(anchor, "      case 'new-client':\n        repos.clients.create(freelancerId, { name: submission.values.clientName || 'x', email: submission.values.clientEmail || 'x@x' });\n        return renderForm(res, contractFormLocals(base));\n" + anchor);
    wr(p, s);
    assertEq(count(rd(p), "case 'new-client':"), 1, 'new-client arm present');
  },
  // F8-dup — findByEmail replaced with no lookup.
  F8dup() {
    const p = 'routes/contracts.js';
    let s = rd(p);
    const anchor = '          const matches = repos.clients.findByEmail(freelancerId, clientEmail);';
    assertEq(count(s, anchor), 1, 'the findByEmail call occurs once');
    s = s.replace(anchor, '          const matches = [];');
    wr(p, s);
    assertEq(count(rd(p), 'findByEmail'), 0, 'findByEmail gone from routes/contracts.js');
  },
  // F-count — the validation banner stops counting.
  Fcount() {
    const p = 'lib/screens/contract-form-view.js';
    let s = rd(p);
    const anchor = "      : { tone: 'error', title: attentionTitle(errorCount), message: VALIDATION_MESSAGE };";
    assertEq(count(s, anchor), 1, 'the S6-ERROR-VALIDATION banner site occurs once');
    s = s.replace(anchor, "      : { tone: 'error', title: attentionTitle(1), message: VALIDATION_MESSAGE };");
    wr(p, s);
    assertEq(count(rd(p), 'attentionTitle(errorCount)'), 0, 'count call gone');
  },
  // F10 — an unknown intent is treated as generate.
  F10() {
    const p = 'routes/contracts.js';
    let s = rd(p);
    const anchor = '    switch (submission.intent) {';
    assertEq(count(s, anchor), 1, 'the POST dispatch occurs once');
    s = s.replace(anchor, "    switch (submission.intent ?? 'generate') {");
    wr(p, s);
    assertEq(count(rd(p), "switch (submission.intent ?? 'generate')"), 1, 'unknown/absent intent dispatched as generate');
  },
};

if (!MUTANTS[name]) { console.error(`unknown mutant ${name}; known: ${Object.keys(MUTANTS).join(' ')}`); process.exit(2); }
rmSync(root, { recursive: true, force: true });
cpSync(BASE, root, { recursive: true });
MUTANTS[name]();
console.log(`mutant ${name} applied at ${root}`);
