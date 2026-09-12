// One-shot literal recount, from the run-1 failure messages. Run from apps/invoicing.
const fs = require('node:fs');
function edit(file, pairs) {
  let s = fs.readFileSync(file, 'utf8');
  for (const [a, b] of pairs) {
    const n = s.split(a).length - 1;
    if (n !== 1) throw new Error(`${file}: "${a.slice(0, 60)}" occurs ${n} times, expected 1`);
    s = s.replace(a, b);
  }
  fs.writeFileSync(file, s);
}
edit('test/route-surface.test.js', [
  ["  'GET /contracts/:id',\n  'GET /healthz',", "  'GET /contracts/:id',\n  'GET /contracts/new',\n  'GET /healthz',"],
  ["\n  'POST /contracts',\n  'POST /invoices',", "\n  'POST /contracts',\n  'POST /contracts/new',\n  'POST /invoices',"],
  ['assert.equal(found.length, 23, `expected exactly 23 routes', 'assert.equal(found.length, 25, `expected exactly 25 routes'],
  ["assert.equal(found.length, 22, found.join(', '));", "assert.equal(found.length, 24, found.join(', '));"],
  ["      'GET /contracts/:id',\n      'GET /invoices/:id/edit',", "      'GET /contracts/:id',\n      'GET /contracts/new',\n      'GET /invoices/:id/edit',"],
  ["      'POST /contracts',\n      'POST /invoices',", "      'POST /contracts',\n      'POST /contracts/new',\n      'POST /invoices',"],
  ["assert.equal(protectedRoutes.length, 17, 'cardinality before quantification');", "assert.equal(protectedRoutes.length, 19, 'cardinality before quantification');"],
]);
edit('test/auth.test.js', [['assert.equal(discoverRoutes(app).length, 23);', 'assert.equal(discoverRoutes(app).length, 25);']]);
edit('test/health.test.js', [
  ["  // then screen 7 (AS-47). The next screen appends here, in the same commit as\n  // its VIEWS row.\n  assert.equal(VIEWS.length, 4);\n  assert.deepEqual(VIEWS.map((v) => v.file), ['signin.ejs', 'connect-stripe.ejs', 'invoice-form.ejs', 'contract-detail.ejs']);",
    "  // then screen 7 (AS-47), then screen 6 (AS-127). The next screen appends\n  // here, in the same commit as its VIEWS row.\n  assert.equal(VIEWS.length, 5);\n  assert.deepEqual(VIEWS.map((v) => v.file), ['signin.ejs', 'connect-stripe.ejs', 'invoice-form.ejs', 'contract-detail.ejs', 'contract-form.ejs']);"],
]);
edit('test/dependency-policy.test.js', [
  ['assert.equal(source.length, 56, `expected 56 app source files', 'assert.equal(source.length, 58, `expected 58 app source files'],
  ["    'lib/screens/contract-detail-view.js',\n    'lib/screens/invoice-form-view.js',", "    'lib/screens/contract-detail-view.js',\n    'lib/screens/contract-form-view.js',\n    'lib/screens/invoice-form-view.js',"],
  ["    'views/contract-detail.ejs',\n    'views/invoice-form.ejs',", "    'views/contract-detail.ejs',\n    'views/contract-form.ejs',\n    'views/invoice-form.ejs',"],
  ["  // signin.ejs, connect-stripe.ejs, invoice-form.ejs (AS-46) and\n  // contract-detail.ejs (AS-47). The next screen moves this with its VIEWS row.\n  assert.equal(attrName.files, 4, `P4 examined ${attrName.files} template(s) under views/, expected 4`);",
    "  // signin.ejs, connect-stripe.ejs, invoice-form.ejs (AS-46),\n  // contract-detail.ejs (AS-47) and contract-form.ejs (AS-127). The next screen\n  // moves this with its VIEWS row.\n  assert.equal(attrName.files, 5, `P4 examined ${attrName.files} template(s) under views/, expected 5`);"],
]);
{
  let s = fs.readFileSync('test/dependency-policy.test.js', 'utf8');
  const n = s.split('expectFiles: 5 }').length - 1;
  if (n !== 4) throw new Error(`expectFiles: 5 occurs ${n}, expected 4`);
  s = s.split('expectFiles: 5 }').join('expectFiles: 6 }');
  fs.writeFileSync('test/dependency-policy.test.js', s);
}
edit('test/contracts.test.js', [
  ['assert.equal(contractRoutesFound.length, 2, `cardinality before quantification', 'assert.equal(contractRoutesFound.length, 4, `cardinality before quantification'],
  ["assert.deepEqual(contractRoutesFound, ['GET /contracts/:id', 'POST /contracts']);", "assert.deepEqual(contractRoutesFound, ['GET /contracts/:id', 'GET /contracts/new', 'POST /contracts', 'POST /contracts/new']);"],
  ["assert.deepEqual(routes, ['POST /contracts', 'GET /contracts/:id']);", "assert.deepEqual(routes, ['POST /contracts', 'GET /contracts/new', 'POST /contracts/new', 'GET /contracts/:id']);"],
]);
edit('test/invoice-screen.test.js', [
  ['const TEMPLATE_LINKS = 17;', 'const TEMPLATE_LINKS = 24;'],
  ["assert.equal(templates.length, 4, 'cardinality first: every registered template is examined');", "assert.equal(templates.length, 5, 'cardinality first: every registered template is examined');"],
]);
edit('routes/contracts.js', [["(the screen has no Stripe\n  // gate, by the ledger's own n/a row)", "(the screen has no\n  // processor gate, by the ledger's own n/a row)"]]);
console.log('recount applied');
