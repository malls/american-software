// one-shot: bump the small-file literals for AS-46 (run from anywhere)
import { readFileSync, writeFileSync } from 'node:fs';
const W = '/Users/forrest/Code/american-software-company/.worktrees/AS-46/apps/invoicing/';
const edit = (p, pairs) => {
  let s = readFileSync(W + p, 'utf8');
  for (const [a, b] of pairs) {
    if (!s.includes(a)) throw new Error(`${p} anchor: ${a.slice(0, 60)}`);
    s = s.replace(a, b);
  }
  writeFileSync(W + p, s);
};
edit('test/harness.test.js', [
  ["  'health.test.js',\n  'invoices.test.js',", "  'health.test.js',\n  'invoice-screen.test.js',\n  'invoices.test.js',"],
  ['assert.equal(found.length, 18, `expected exactly 18 test files', 'assert.equal(found.length, 19, `expected exactly 19 test files'],
  ['these eighteen files ran', 'these nineteen files ran'],
]);
edit('test/health.test.js', [
  ["test('there is exactly one registered view', () => {\n  assert.equal(VIEWS.length, 1);\n  assert.deepEqual(VIEWS.map((v) => v.file), ['signin.ejs']);",
    "test('there are exactly two registered views, in declaration order', () => {\n  assert.equal(VIEWS.length, 2);\n  assert.deepEqual(VIEWS.map((v) => v.file), ['signin.ejs', 'invoice-form.ejs']);"],
]);
edit('test/dependency-policy.test.js', [
  ['assert.equal(source.length, 50, `expected 50 app source files', 'assert.equal(source.length, 52, `expected 52 app source files'],
  ["    'lib/screens/signin-view.js',\n", "    'lib/screens/invoice-form-view.js',\n    'lib/screens/signin-view.js',\n"],
  ["    'server.js',\n    'views/signin.ejs',\n  ]);", "    'server.js',\n    'views/invoice-form.ejs',\n    'views/signin.ejs',\n  ]);"],
  ["test('the concepts live exactly where AS-38, AS-39, AS-40, AS-41, AS-42, AS-43, AS-44 and AS-45 put them'",
    "test('the concepts live exactly where AS-38, AS-39, AS-40, AS-41, AS-42, AS-43, AS-44, AS-45 and AS-46 put them'"],
  [`  // comments (RAW text, not stripped).
  scanConcept(
    'money representation',
    /amount|currency|money/i,
    [
      'lib/db/migrations/0001-initial.js',
      'lib/db/money.js',
      'lib/db/repositories/invoices.js',
      'lib/invoices/lifecycle.js',
      'lib/invoices/mapping.js',
      'lib/stripe/custody.js',
      'routes/invoices.js',
    ],
    { raw: true },
  );`,
  `  // comments (RAW text, not stripped). AS-46 adds ONE member: screen 4's view
  // model is the human-to-minor-units boundary — it imports both conversions
  // from money.js and is the only place that knows the form's unitPrice is the
  // repository's unitAmountMinor. NOT added, and measured to stay clear
  // (comments included): views/invoice-form.ejs and public/app.css, which
  // receive formatted strings and a priceLabel built in the view model.
  scanConcept(
    'money representation',
    /amount|currency|money/i,
    [
      'lib/db/migrations/0001-initial.js',
      'lib/db/money.js',
      'lib/db/repositories/invoices.js',
      'lib/invoices/lifecycle.js',
      'lib/invoices/mapping.js',
      'lib/screens/invoice-form-view.js',
      'lib/stripe/custody.js',
      'routes/invoices.js',
    ],
    { raw: true },
  );`],
]);
console.log('ok');
