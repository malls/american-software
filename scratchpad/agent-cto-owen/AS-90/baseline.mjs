// AS-90 planning baseline. Counted --build runs of the offline `test` and the
// `contract` services under a scratch compose project (asc-inv-as90plan) so the
// main checkout's web and the chat container are untouched; then a direct read
// of stripe-mock's account and invoice fixtures (what /connect-stripe/return
// would map, and the constant amount_due the reconciliation guard must match).
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const DOCKER = '/usr/local/bin/docker';
const CWD = '/Users/forrest/Code/american-software-company/apps/invoicing';
const OUT = '/Users/forrest/Code/american-software-company/scratchpad/agent-cto-owen/AS-90';
const env = { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' };
const P = ['compose', '-p', 'asc-inv-as90plan'];

function run(args, file) {
  const r = spawnSync(DOCKER, args, { cwd: CWD, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const text = `$ docker ${args.join(' ')}\n${r.stdout ?? ''}\n--- stderr ---\n${r.stderr ?? ''}\nexit=${r.status}\n`;
  if (file) writeFileSync(`${OUT}/${file}`, text);
  return { status: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

const summary = (o) => {
  const pick = (re) => (o.match(re) ?? [null, null])[1];
  return {
    built: /Built/.test(o) || /Image .* Built/.test(o),
    tests: pick(/# tests (\d+)/), pass: pick(/# pass (\d+)/), fail: pick(/# fail (\d+)/), skipped: pick(/# skipped (\d+)/),
  };
};

const t = run([...P, 'run', '--rm', '--build', 'test'], 'baseline-test.log');
console.log('test:', t.status, JSON.stringify(summary(t.out)));
const c = run([...P, 'run', '--rm', '--build', 'contract'], 'baseline-contract.log');
console.log('contract:', c.status, JSON.stringify(summary(c.out)));
run([...P, 'down'], 'baseline-down.log');

// stripe-mock fixtures, read directly (a public image, no account, loopback only).
const id = spawnSync(DOCKER, ['run', '-d', '--rm', '-p', '127.0.0.1:12199:12111', 'stripe/stripe-mock:v0.203.0', '-strict-version-check'], { encoding: 'utf8' }).stdout.trim();
try {
  const headers = { authorization: 'Bearer sk_test_probe', 'stripe-version': '2026-08-26.dahlia' };
  let acct = null, inv = null;
  for (let i = 0; i < 50 && acct === null; i += 1) {
    try {
      const r = await fetch('http://127.0.0.1:12199/v1/accounts/acct_probe', { headers });
      acct = await r.json();
      const r2 = await fetch('http://127.0.0.1:12199/v1/invoices', { method: 'POST', headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' }, body: 'customer=cus_probe&auto_advance=false&collection_method=send_invoice&days_until_due=30&currency=usd' });
      inv = await r2.json();
    } catch { await new Promise((res) => setTimeout(res, 200)); }
  }
  const view = {
    account: acct && { id: acct.id, charges_enabled: acct.charges_enabled, details_submitted: acct.details_submitted, payouts_enabled: acct.payouts_enabled, currently_due: acct.requirements?.currently_due, disabled_reason: acct.requirements?.disabled_reason },
    invoice: inv && { id: inv.id, status: inv.status, amount_due: inv.amount_due, amount_paid: inv.amount_paid, hosted_invoice_url: inv.hosted_invoice_url, invoice_pdf: inv.invoice_pdf, due_date: inv.due_date, error: inv.error },
  };
  writeFileSync(`${OUT}/stripe-mock-fixtures.json`, JSON.stringify(view, null, 2));
  console.log('fixtures:', JSON.stringify(view));
} finally {
  spawnSync(DOCKER, ['rm', '-f', id]);
}
writeFileSync(`${OUT}/baseline.done`, 'DONE\n');
