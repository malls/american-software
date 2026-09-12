// render-states.mjs — render screen 4's eight states to static HTML for a
// 375px inspection by someone with a browser. Runs INSIDE the test image
// (ejs lives there), via `docker compose run --rm test node -e "<this>"`.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';

const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-46';
const OUT = '/Users/forrest/Code/american-software-company/scratchpad/developer-lena/AS-46/states';
mkdirSync(OUT, { recursive: true });

const inner = `
import ejs from 'ejs';
import { readFileSync } from 'node:fs';
import { invoiceFormLocals, parseInvoiceForm } from '/app/lib/screens/invoice-form-view.js';
const tpl = readFileSync('/app/views/invoice-form.ejs', 'utf8');
const READY = { ready: true };
const CLIENTS = [{ id: 'c1', name: 'Ada Example', email: 'ada@example.test' }, { id: 'c2', name: 'Bea Sample', email: 'bea@example.test' }];
const draft = { clientId: 'c2', daysUntilDue: 14, lineItems: [{ description: 'Logo concepts', quantity: 1, unitAmountMinor: 8000 }, { description: 'A very long description that should wrap rather than widen the row at three hundred and seventy-five pixels', quantity: 12, unitAmountMinor: 123456 }] };
const states = {
  'S4-DEFAULT-CREATE': invoiceFormLocals({ account: READY, clients: CLIENTS }),
  'S4-DEFAULT-EDIT': invoiceFormLocals({ mode: 'edit', account: READY, clients: CLIENTS, draft }),
  'S4-CLIENT-EMPTY': invoiceFormLocals({ account: READY, clients: [] }),
  'S4-ERROR-VALIDATION': invoiceFormLocals({ account: READY, clients: CLIENTS, submission: parseInvoiceForm({ intent: 'save', clientId: '', daysUntilDue: '0', lineItems: [{ description: '', quantity: '1.5', unitPrice: 'abc' }, { description: 'Fine', quantity: '1', unitPrice: '10.00' }] }) }),
  'S4-ERROR-SYSTEM': invoiceFormLocals({ mode: 'edit', account: READY, clients: CLIENTS, draft, sendFailed: true }),
  'S4-CLIENT-ERROR-VALIDATION': invoiceFormLocals({ account: READY, clients: [], submission: parseInvoiceForm({ intent: 'add-client', clientName: 'Dee Newclient', clientEmail: '' }) }),
  'S4-CLIENT-ERROR-DUPLICATE': invoiceFormLocals({ account: READY, clients: CLIENTS, submission: parseInvoiceForm({ intent: 'add-client', clientName: 'Ada E.', clientEmail: 'ADA@EXAMPLE.TEST' }), duplicate: CLIENTS[0] }),
  'S4-GATED-STRIPENOTREADY': invoiceFormLocals({ account: null, clients: CLIENTS }),
};
const out = {};
for (const [state, locals] of Object.entries(states)) {
  out[state] = ejs.render(tpl, { ...locals }, { filename: '/app/views/invoice-form.ejs' }).replaceAll('href="/tokens.css"', 'href="tokens.css"').replaceAll('href="/app.css"', 'href="app.css"');
}
process.stdout.write('@@JSON@@' + JSON.stringify(out));
`;
const project = 'asc-inv-as46-render';
const args = ['compose', '-p', project, '-f', `${WT}/apps/invoicing/compose.yaml`, 'run', '--build', '--rm', '--entrypoint', 'node', 'test', '--input-type=module', '-e', inner];
const res = spawnSync('/usr/local/bin/docker', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
spawnSync('/usr/local/bin/docker', ['compose', '-p', project, '-f', `${WT}/apps/invoicing/compose.yaml`, 'down', '--rmi', 'local', '--remove-orphans'], { encoding: 'utf8' });
const out = `${res.stdout ?? ''}`;
const at = out.indexOf('@@JSON@@');
if (at === -1) { console.error(res.stderr, out.slice(-2000)); process.exit(1); }
const states = JSON.parse(out.slice(at + 8));
for (const [state, html] of Object.entries(states)) writeFileSync(`${OUT}/${state}.html`, html);
copyFileSync(`${WT}/docs/design/tokens/tokens.css`, `${OUT}/tokens.css`);
copyFileSync(`${WT}/apps/invoicing/public/app.css`, `${OUT}/app.css`);
writeFileSync(`${OUT}/index.html`, `<!doctype html><meta charset="utf-8"><title>AS-46 states</title><h1>Screen 4 — eight rendered states (open each at a 375px viewport)</h1><ul>${Object.keys(states).map((s) => `<li><a href="${s}.html">${s}</a></li>`).join('')}</ul>`);
console.log(`rendered ${Object.keys(states).length} states into ${OUT}`);
