import { readFileSync } from 'node:fs';
const A = '/Users/forrest/Code/american-software-company/.worktrees/AS-70/apps/invoicing/';
const rd = (f) => readFileSync(A + f, 'utf8');
for (const f of ['views/signin.ejs', 'views/connect-stripe.ejs']) {
  const t = rd(f);
  console.log(f, 'tags incl doctype:', (t.match(/<\/?[!A-Za-z]/g) || []).length, 'excl doctype:', (t.match(/<\/?[A-Za-z]/g) || []).length);
}
console.log('auth.test.js split("\\n").length =', rd('test/auth.test.js').split('\n').length);
const money = /amount|currency|money/gi; let tot = 0;
for (const f of ['views/signin.ejs', 'views/connect-stripe.ejs', 'public/app.css', 'lib/screens/signin-view.js', 'lib/screens/connect-view.js', 'lib/views.js', 'routes/connect.js', 'routes/pages.js']) {
  const n = (rd(f).match(money) || []).length; tot += n; if (n) console.log('MONEY HIT', f, n);
}
console.log('money-word occurrences over the AC-21 set (8 files):', tot);
console.log('<<% in views:', (rd('views/signin.ejs') + rd('views/connect-stripe.ejs')).split('<<%').length - 1);
// The ledger: compare the view model's 9 ids against docs/design/wireframes/02-states-ledger.md §2 by hand-check.
const ledger = readFileSync('/Users/forrest/Code/american-software-company/.worktrees/AS-70/docs/design/wireframes/02-states-ledger.md', 'utf8');
const ids = [...new Set(ledger.match(/S2-[A-Z-]+/g) || [])];
console.log('S2-* ids in the design ledger (' + ids.length + '):', ids.join(', '));
const vm = rd('lib/screens/connect-view.js');
const vmIds = [...new Set(vm.match(/'S2-[A-Z-]+'/g) || [])].map((s) => s.slice(1, -1));
console.log('S2-* ids in the view model (' + vmIds.length + '):', vmIds.join(', '));
console.log('doc \\ vm:', ids.filter((i) => !vmIds.includes(i)), ' vm \\ doc:', vmIds.filter((i) => !ids.includes(i)));
