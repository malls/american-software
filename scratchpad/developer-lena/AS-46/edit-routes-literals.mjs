// one-shot: route-surface literals for the four screen routes (recount at rebase)
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
edit('test/route-surface.test.js', [
  ["  'GET /healthz',\n  'GET /signin',\n  'GET /tokens.css',\n  'POST /clients',",
    "  'GET /healthz',\n  'GET /invoices/:id/edit',\n  'GET /invoices/new',\n  'GET /signin',\n  'GET /tokens.css',\n  'POST /clients',"],
  ["  'POST /invoices',\n  'POST /invoices/:id',\n  'POST /invoices/:id/finalize',\n  'POST /invoices/:id/send',\n  'POST /signin',",
    "  'POST /invoices',\n  'POST /invoices/:id',\n  'POST /invoices/:id/edit',\n  'POST /invoices/:id/finalize',\n  'POST /invoices/:id/send',\n  'POST /invoices/new',\n  'POST /signin',"],
  ['assert.equal(found.length, 17, `expected exactly 17 routes', 'assert.equal(found.length, 21, `expected exactly 21 routes'],
  ['assert.equal(found.length, 16, found.join', 'assert.equal(found.length, 20, found.join'],
  ["      'GET /connect-stripe/return',\n      'POST /clients',", "      'GET /connect-stripe/return',\n      'GET /invoices/:id/edit',\n      'GET /invoices/new',\n      'POST /clients',"],
  ["      'POST /invoices/:id',\n      'POST /invoices/:id/finalize',\n      'POST /invoices/:id/send',\n      'POST /signout',",
    "      'POST /invoices/:id',\n      'POST /invoices/:id/edit',\n      'POST /invoices/:id/finalize',\n      'POST /invoices/:id/send',\n      'POST /invoices/new',\n      'POST /signout',"],
  ["assert.equal(protectedRoutes.length, 11, 'cardinality before quantification');", "assert.equal(protectedRoutes.length, 15, 'cardinality before quantification');"],
]);
edit('test/auth.test.js', [
  ['assert.equal(discoverRoutes(app).length, 17);', 'assert.equal(discoverRoutes(app).length, 21);'],
]);
console.log('ok');
